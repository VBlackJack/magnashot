/*
 * Copyright 2026 Julien Bombled
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configRegistry } from '../src/core/ConfigRegistry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { isRunSnapshotable } from '../src/game/RunSnapshot.js';
import { reportBountyEvent } from '../src/game/Bounties.js';
import {
  MAX_PAYLOAD_CHARS,
  encodeCustomPuzzle,
  decodeCustomPuzzle,
  extractPuzzlePayload,
  hasCustomPuzzleParam
} from '../src/game/PuzzleShareCodec.js';
import {
  buildSpecFromBuilderState,
  applySpecToBuilderState
} from '../src/ui/PuzzleBuilderView.js';

const loadJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const configs = {
  game: loadJson('./configs/game.json'),
  physics: loadJson('./configs/physics.json'),
  balls: loadJson('./configs/balls.json'),
  obstacles: loadJson('./configs/obstacles.json'),
  levels: loadJson('./configs/levels.json'),
  campaign: loadJson('./configs/campaign.json'),
  flux: loadJson('./configs/flux.json'),
  modes: loadJson('./configs/modes.json')
};
for (const [k, v] of Object.entries(configs)) {
  configRegistry.configs.set(k, v);
}

const SILENT_AUDIO = Object.freeze({ playEffect() {}, stopAll() {}, isMuted: () => true, setMuted() {} });

test('PuzzleShareCodec v2 encodes full 28-cell boards with anchors, cores, and obstacles under 512 chars', () => {
  const balls = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 7; c++) {
      balls.push({
        x: 115 + c * 40,
        y: 120 + r * 38,
        c: ['crimson', 'cobalt', 'emerald', 'amber', 'violet', 'cyan'][(r * 7 + c) % 6],
        ...(r === 0 ? { a: true } : {}),
        ...(r === 3 && c === 3 ? { k: true } : {})
      });
    }
  }
  const spec = { shots: 6, queue: ['crimson', 'cobalt', 'emerald', 'amber', 'violet', 'cyan'], balls, obstaclePreset: 'portal' };
  const encoded = encodeCustomPuzzle(spec);
  assert.ok(encoded && encoded.length <= MAX_PAYLOAD_CHARS, `expected <= ${MAX_PAYLOAD_CHARS} chars, got ${encoded?.length}`);
  assert.deepEqual(decodeCustomPuzzle(encoded), spec);

  const url = `https://vblackjack.github.io/magnashot/?puzzle=${encoded}`;
  assert.equal(extractPuzzlePayload(url), encoded);
  assert.equal(extractPuzzlePayload(encoded), encoded);
  assert.equal(hasCustomPuzzleParam(`?puzzle=${encoded}`), true);
  assert.equal(hasCustomPuzzleParam('?flux=abc123'), false);
});

test('PuzzleBuilderView buildSpecFromBuilderState and applySpecToBuilderState round-trip anchors, cores, and obstacles', () => {
  const state = {
    activeColor: 'crimson',
    activeTool: 'sphere',
    shots: 3,
    obstaclePreset: 'repulsor',
    queue: ['crimson', 'cobalt', 'emerald'],
    cells: new Map([
      ['2,0', { c: 'crimson', a: true, k: false }],
      ['3,1', { c: 'cobalt', a: false, k: true }]
    ])
  };
  const spec = buildSpecFromBuilderState(state, configs.game.puzzleBuilder);
  assert.equal(spec.obstaclePreset, 'repulsor');
  assert.equal(spec.balls.length, 2);

  const hydrated = { activeColor: 'crimson', activeTool: 'sphere', shots: 1, obstaclePreset: 'none', queue: [], cells: new Map() };
  applySpecToBuilderState(hydrated, spec, configs.game.puzzleBuilder);
  assert.equal(hydrated.shots, 3);
  assert.equal(hydrated.obstaclePreset, 'repulsor');
  assert.deepEqual(hydrated.cells.get('2,0'), { c: 'crimson', a: true, k: false });
  assert.deepEqual(hydrated.cells.get('3,1'), { c: 'cobalt', a: false, k: true });
});

test('Custom Puzzle runs are isolated from official Stage 1 stats, coins, bounties, snapshots, and replay cleanly', () => {
  const storage = new StorageManager();
  storage.init();
  const initialCoins = storage.getCoins();
  const engine = new GameEngine({
    gameConfig: configs.game,
    physicsConfig: configs.physics,
    ballsConfig: configs.balls,
    obstaclesConfig: configs.obstacles,
    levelsConfig: configs.levels,
    campaignConfig: configs.campaign,
    fluxConfig: configs.flux,
    modesConfig: configs.modes,
    audioManager: SILENT_AUDIO,
    storageManager: storage
  });
  const customSpec = {
    shots: 2,
    queue: ['crimson', 'crimson'],
    balls: [
      { x: 235, y: 120, c: 'crimson', a: true },
      { x: 271, y: 120, c: 'crimson', a: true }
    ]
  };
  engine.startPuzzleMode(1, { customSpec });
  assert.equal(engine.isCustomPuzzle, true);
  assert.equal(isRunSnapshotable(engine), false);
  assert.deepEqual(reportBountyEvent(engine, 'puzzle_stage_cleared', 1), []);

  // Simulate victory clear on the custom puzzle
  engine.physicsWorld.balls.length = 0;
  engine.evaluateRoundEnd();
  assert.equal(engine.state, 'victory');
  assert.equal(engine.victorySummary?.isCustomPuzzle, true);
  assert.equal(engine.victorySummary?.earnedCoins, 0);
  assert.equal(storage.getCoins(), initialCoins);
  assert.equal(storage.getPuzzleStageStats()[1], undefined);

  // Restarting replays the custom puzzle instead of Stage 1
  engine.restartCurrent();
  assert.equal(engine.isCustomPuzzle, true);
  assert.equal(engine.physicsWorld.balls.length, 2);
});
