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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { configRegistry } from '../src/core/ConfigRegistry.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { GAME_MODES } from '../src/core/Constants.js';
import { encodeCustomPuzzle, decodeCustomPuzzle } from '../src/game/PuzzleShareCodec.js';
import { applyTouchFineAim } from '../src/ui/CanvasInput.js';
import { resolvePlayHubSpotlight } from '../src/ui/PlayHubView.js';

const loadJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

const gameConfig = applyWorldGeometry(loadJson('../configs/game.json'));
const physicsConfig = loadJson('../configs/physics.json');
const ballsConfig = loadJson('../configs/balls.json');
const obstaclesConfig = loadJson('../configs/obstacles.json');
const levelsConfig = loadJson('../configs/levels.json');
const campaignConfig = loadJson('../configs/campaign.json');
const campaignTuning = loadJson('../configs/campaignTuning.json');
const fluxConfig = loadJson('../configs/flux.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('campaign', campaignConfig);
configRegistry.configs.set('campaignTuning', campaignTuning);
configRegistry.configs.set('flux', fluxConfig);

function createTestStorage() {
  const storage = new StorageManager();
  storage.init();
  return storage;
}

function createTestEngine(storageManager = createTestStorage()) {
  const audioManager = {
    play: () => {},
    playBounce: () => {},
    playMatch: () => {},
    playCombo: () => {},
    playVictory: () => {},
    playGameOver: () => {},
    playClick: () => {},
    stopAll: () => {},
    setMusicIntensity: () => {},
    notifyPulseEvent: () => {}
  };
  return new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    campaignConfig,
    campaignTuning,
    fluxConfig,
    audioManager,
    storageManager
  });
}

describe('v1.36 Signature Evolutions', () => {
  describe('Mutator Lab', () => {
    it('applies score multiplier, caps at 3 mutators, preserves on restart, and isolates standard high scores', () => {
      const storage = createTestStorage();
      const engine = createTestEngine(storage);

      engine.startEndlessMode({
        mutators: ['hyperGravity', 'superMagnetism', 'bumperPinball', 'cryoSurge']
      });
      assert.equal(engine.mode, GAME_MODES.ENDLESS);
      assert.equal(engine.activeLabMutators.length, 3, 'Mutator Lab must cap active mutators at 3');
      assert.ok(engine.physicsWorld.obstacles.length > 0, 'bumperPinball mutator should spawn bumpers');

      engine.score = 0;
      engine.addScore(100);
      assert.equal(engine.score, 175, '3 active lab mutators should apply a 1.75x score multiplier');

      engine.persistRunHighScore();
      assert.equal(storage.getEndlessHighScore(), 0, 'Mutator Lab runs must not overwrite standard high scores');

      engine.restartCurrent();
      assert.deepEqual(
        engine.activeLabMutators,
        ['hyperGravity', 'superMagnetism', 'bumperPinball'],
        'restartCurrent() should preserve active Mutator Lab modifiers'
      );
    });
  });

  describe('Puzzle Builder v3 codec & free obstacles', () => {
    it('round-trips verified flag and up to 3 free obstacles in v2 share payloads and rejects >3', () => {
      const spec = {
        shots: 3,
        queue: ['crimson', 'cobalt', 'crimson'],
        verified: true,
        obstacles: [
          { t: 'bumper', x: 180, y: 320 },
          { t: 'repulsor', x: 360, y: 320 },
          { t: 'attractor', x: 270, y: 260 }
        ],
        balls: [
          { x: 220, y: 160, c: 'crimson', a: true },
          { x: 270, y: 160, c: 'crimson', k: true }
        ]
      };
      const code = encodeCustomPuzzle(spec);
      assert.ok(code, 'Encoded v2 puzzle payload should be non-null');
      const decoded = decodeCustomPuzzle(code);
      assert.ok(decoded, 'Decoded v2 puzzle payload should be valid');
      assert.equal(decoded.verified, true);
      assert.equal(decoded.obstacles.length, 3);
      assert.equal(decoded.obstacles[0].t, 'bumper');
      assert.equal(decoded.obstacles[1].t, 'repulsor');
      assert.equal(decoded.obstacles[2].t, 'attractor');

      const oversized = { ...spec, obstacles: [...spec.obstacles, { t: 'bumper', x: 140, y: 200 }] };
      assert.equal(encodeCustomPuzzle(oversized), null, 'Payloads with >3 free obstacles must be rejected');

      const engine = createTestEngine();
      engine.startPuzzleMode(1, { customSpec: decoded });
      assert.equal(engine.isCustomPuzzle, true);
      assert.equal(engine.customPuzzleSpec.verified, true);
      assert.equal(engine.physicsWorld.obstacles.length, 3, 'Free obstacles should spawn in physicsWorld');
    });
  });

  describe('Touch Fine-Aim (Vernier)', () => {
    it('dampens small drags near the launcher and preserves fast far drags', () => {
      const launcher = { x: 270, y: 760 };
      const cfg = gameConfig.canvas.touchFineAim;

      const nearPrev = { x: 270, y: 680 };
      const nearNext = { x: 274, y: 678 };
      const damped = applyTouchFineAim(nearPrev, nearNext, launcher, cfg);
      assert.ok(Math.abs(damped.x - nearPrev.x) < Math.abs(nearNext.x - nearPrev.x), 'Small near drag should be damped');
      assert.equal(Number((damped.x - nearPrev.x).toFixed(2)), Number((4 * cfg.slowdownFactor).toFixed(2)));

      const farPrev = { x: 270, y: 400 };
      const farNext = { x: 320, y: 390 };
      const raw = applyTouchFineAim(farPrev, farNext, launcher, cfg);
      assert.deepEqual(raw, farNext, 'Fast far drag should pass through unmodified');
    });
  });

  describe('Dynamic Audio intensity escalation', () => {
    it('escalates getMusicIntensity on 5x/10x combos and active Mutator Lab runs', () => {
      const engine = createTestEngine();
      engine.startEndlessMode();
      engine.physicsWorld.balls = [];
      const base = engine.getMusicIntensity();
      assert.equal(base, 0);

      engine.combo = 5;
      assert.ok(engine.getMusicIntensity() >= 0.55, 'Combo 5x should lift intensity to at least 0.55');

      engine.combo = 10;
      assert.ok(engine.getMusicIntensity() >= 0.95, 'Combo 10x should lift intensity to at least 0.95');

      engine.startEndlessMode({ mutators: ['hyperGravity', 'superMagnetism', 'bumperPinball'] });
      engine.physicsWorld.balls = [];
      engine.combo = 0;
      assert.ok(engine.getMusicIntensity() >= 0.44, '3 lab mutators should raise baseline intensity to ~0.45');
    });
  });

  describe('Play Hub Spotlight resolution', () => {
    it('prioritizes unclaimed Daily Puzzle, then Weekly Mastery, then Campaign unlock proximity', () => {
      const storage = createTestStorage();

      const first = resolvePlayHubSpotlight(storage, gameConfig);
      assert.equal(first?.kind, 'dailyPuzzle');

      storage.hasClaimedDailyPuzzle = () => true;
      storage.getWeeklyMasteryState = () => ({
        bounties: [{ id: 'pop_spheres', target: 40, progress: 10, completed: false }]
      });
      const second = resolvePlayHubSpotlight(storage, gameConfig);
      assert.equal(second?.kind, 'weeklyMastery');

      storage.getWeeklyMasteryState = () => ({
        bounties: [{ id: 'pop_spheres', target: 40, progress: 40, completed: true }]
      });
      storage.getUnlockedLevel = () => 2;
      const third = resolvePlayHubSpotlight(storage, gameConfig);
      assert.equal(third?.kind, 'campaign');
    });
  });
});
