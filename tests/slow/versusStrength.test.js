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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { configRegistry } from '../../src/core/ConfigRegistry.js';
import { StorageManager } from '../../src/core/StorageManager.js';
import { applyWorldGeometry } from '../../src/core/WorldGeometry.js';
import { createVersusMatch } from '../../src/game/VersusMatch.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const campaignConfig = loadJson('./configs/campaign.json');
const campaignTuning = loadJson('./configs/campaignTuning.json');
const fluxConfig = loadJson('./configs/flux.json');
const audioConfig = loadJson('./configs/audio.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('campaign', campaignConfig);
configRegistry.configs.set('audio', audioConfig);
configRegistry.configs.set('flux', fluxConfig);

const configs = {
  gameConfig,
  physicsConfig,
  ballsConfig,
  obstaclesConfig,
  levelsConfig,
  campaignConfig,
  campaignTuning,
  fluxConfig
};

/** Frames a whole best-of-three match may take before a test calls it stuck. */
const MATCH_FRAME_CAP = 150000;
const SPY_AUDIO = { playEffect() {}, stopAll() {}, isMuted: () => true, setMuted() {} };

/** localStorage stand-in that counts every write and removal. */
const createSpyStorage = () => {
  const data = new Map();
  const spy = { writes: 0, removals: 0 };
  return {
    data,
    spy,
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { spy.writes += 1; data.set(k, String(v)); },
    removeItem(k) { spy.removals += 1; data.delete(k); },
    clear() { data.clear(); }
  };
};

const withStorage = (storage, fn) => {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  }
};

const createManager = () => {
  const manager = new StorageManager();
  manager.init();
  return manager;
};

const HARD_VS_EASY_GAMES = 50;
const HARD_VS_EASY_MIN_SHARE = 0.8;

/*
 * Slow strength gate of the CPU tiers (npm run test:slow): Hard must beat Easy in at least
 * 80% of 50 seeded games, sides alternating. The default suite keeps a 10-game version.
 */
test('Hard beats Easy in at least 80% of 50 seeded games', () => {
  withStorage(createSpyStorage(), () => {
    let hardWins = 0;
    for (let g = 0; g < HARD_VS_EASY_GAMES; g++) {
      const hardBoard = g % 2;
      const match = createVersusMatch({
        seed: `strength-${g}`,
        mode: 'cpu',
        playerBoard: null,
        cpuTiers: hardBoard === 0 ? ['hard', 'easy'] : ['easy', 'hard'],
        configs,
        storageManager: createManager(),
        audioManager: SPY_AUDIO
      });
      const result = match.run(MATCH_FRAME_CAP);
      assert.ok(result.isOver, `game ${g} must end`);
      if (result.winner === hardBoard) {
        hardWins += 1;
      }
    }
    console.log(`versus strength: Hard won ${hardWins}/${HARD_VS_EASY_GAMES} against Easy`);
    assert.ok(hardWins / HARD_VS_EASY_GAMES >= HARD_VS_EASY_MIN_SHARE, `Hard won only ${hardWins} of ${HARD_VS_EASY_GAMES}`);
  });
});
