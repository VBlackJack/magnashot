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
import { configRegistry } from '../src/core/ConfigRegistry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { createVersusStorageView, VERSUS_STORAGE_POLICY, STORAGE_POLICIES } from '../src/core/StorageView.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

const { prefix, keys } = gameConfig.storage;
const STATS_KEY = `${prefix}${keys.puzzleStageStats}`;
const STAGE = 3;
const OTHER_STAGE = 5;
const LOW_SCORE = 400;
const HIGH_SCORE = 900;
const ONE_STAR = gameConfig.scoring.minVictoryStars;
const TWO_STARS = 2;
const THREE_STARS = gameConfig.scoring.maxStars;
const ATTEMPTS_BEFORE_WIN = 4;

const createFakeStorage = () => {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); },
    clear() { data.clear(); }
  };
};

const withManager = (fn, storage = createFakeStorage()) => {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    const manager = new StorageManager();
    manager.init();
    return fn(manager, storage);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  }
};

test('a fresh profile has no stage stats and no stars', () => {
  withManager((manager) => {
    assert.deepEqual(manager.getPuzzleStageStats(), {});
    assert.equal(manager.getPuzzleTotalStars(), 0);
  });
});

test('a saved result round-trips with every field normalised', () => {
  withManager((manager) => {
    assert.deepEqual(manager.savePuzzleStageResult(STAGE, HIGH_SCORE, THREE_STARS), { newlyEarnedStars: THREE_STARS });
    assert.deepEqual(manager.getPuzzleStageStats(), {
      [STAGE]: { bestScore: HIGH_SCORE, stars: THREE_STARS, attempts: 0, cleared: true }
    });
  });
});

test('garbage storage reads as empty and incomplete entries take their defaults', () => {
  const storage = createFakeStorage();
  storage.setItem(STATS_KEY, '{not json');
  withManager((manager) => assert.deepEqual(manager.getPuzzleStageStats(), {}), storage);
  storage.setItem(STATS_KEY, JSON.stringify({ [STAGE]: { bestScore: HIGH_SCORE }, [OTHER_STAGE]: 'broken', 7: { stars: ONE_STAR } }));
  withManager((manager) => {
    assert.deepEqual(manager.getPuzzleStageStats(), {
      [STAGE]: { bestScore: HIGH_SCORE, stars: 0, attempts: 0, cleared: false },
      7: { bestScore: 0, stars: ONE_STAR, attempts: 0, cleared: true }
    });
  }, storage);
});

test('attempts grow while the stage is not cleared, then freeze at the first win', () => {
  withManager((manager) => {
    for (let attempt = 1; attempt <= ATTEMPTS_BEFORE_WIN; attempt += 1) {
      assert.equal(manager.recordPuzzleAttempt(STAGE).attempts, attempt);
    }
    manager.savePuzzleStageResult(STAGE, LOW_SCORE, ONE_STAR);
    assert.equal(manager.recordPuzzleAttempt(STAGE).attempts, ATTEMPTS_BEFORE_WIN, 'frozen once cleared');
    assert.equal(manager.getPuzzleStageStats()[STAGE].attempts, ATTEMPTS_BEFORE_WIN);
    assert.equal(manager.getPuzzleStageStats()[STAGE].cleared, true);
  });
});

test('attempts are counted per stage', () => {
  withManager((manager) => {
    manager.recordPuzzleAttempt(STAGE);
    manager.recordPuzzleAttempt(STAGE);
    manager.recordPuzzleAttempt(OTHER_STAGE);
    const stats = manager.getPuzzleStageStats();
    assert.equal(stats[STAGE].attempts, 2);
    assert.equal(stats[OTHER_STAGE].attempts, 1);
    assert.equal(stats[OTHER_STAGE].cleared, false);
  });
});

test('a later win keeps the maximum stars and best score and pays only new stars', () => {
  withManager((manager) => {
    assert.deepEqual(manager.savePuzzleStageResult(STAGE, HIGH_SCORE, TWO_STARS), { newlyEarnedStars: TWO_STARS });
    assert.deepEqual(manager.savePuzzleStageResult(STAGE, LOW_SCORE, ONE_STAR), { newlyEarnedStars: 0 });
    assert.deepEqual(manager.getPuzzleStageStats()[STAGE], {
      bestScore: HIGH_SCORE, stars: TWO_STARS, attempts: 0, cleared: true
    });
    assert.deepEqual(manager.savePuzzleStageResult(STAGE, LOW_SCORE, THREE_STARS), { newlyEarnedStars: THREE_STARS - TWO_STARS });
    assert.deepEqual(manager.getPuzzleStageStats()[STAGE], {
      bestScore: HIGH_SCORE, stars: THREE_STARS, attempts: 0, cleared: true
    });
  });
});

test('a win keeps the attempts counted before it', () => {
  withManager((manager) => {
    manager.recordPuzzleAttempt(STAGE);
    manager.recordPuzzleAttempt(STAGE);
    manager.savePuzzleStageResult(STAGE, HIGH_SCORE, TWO_STARS);
    assert.equal(manager.getPuzzleStageStats()[STAGE].attempts, 2);
  });
});

test('bad inputs are sanitised', () => {
  withManager((manager) => {
    assert.deepEqual(manager.savePuzzleStageResult(STAGE, -50.9, -2), { newlyEarnedStars: 0 });
    assert.deepEqual(manager.getPuzzleStageStats()[STAGE], { bestScore: 0, stars: 0, attempts: 0, cleared: true });
    manager.savePuzzleStageResult(OTHER_STAGE, 'many', 'lots');
    assert.equal(manager.getPuzzleStageStats()[OTHER_STAGE].bestScore, 0);
  });
});

test('the total stars add up every stage', () => {
  withManager((manager) => {
    manager.savePuzzleStageResult(STAGE, HIGH_SCORE, THREE_STARS);
    manager.savePuzzleStageResult(OTHER_STAGE, LOW_SCORE, ONE_STAR);
    manager.recordPuzzleAttempt(7);
    assert.equal(manager.getPuzzleTotalStars(), THREE_STARS + ONE_STAR);
  });
});

test('the stage stats survive a new manager on the same storage', () => {
  const storage = createFakeStorage();
  withManager((manager) => manager.savePuzzleStageResult(STAGE, HIGH_SCORE, TWO_STARS), storage);
  withManager((manager) => {
    assert.equal(manager.getPuzzleStageStats()[STAGE].bestScore, HIGH_SCORE);
    assert.equal(manager.getPuzzleTotalStars(), TWO_STARS);
  }, storage);
});

test('the existing Puzzle records are unchanged', () => {
  withManager((manager) => {
    manager.setPuzzleRecord(HIGH_SCORE, STAGE);
    manager.setPuzzleRecord(LOW_SCORE, 1);
    assert.equal(manager.getPuzzleHighScore(), HIGH_SCORE);
    assert.equal(manager.getPuzzleBestStage(), STAGE);
  });
});

test('the config carries the attempt star limits and the third star only on the score stages', () => {
  const { threeStarMaxAttempts, twoStarMaxAttempts } = gameConfig.puzzleStars;
  assert.ok(threeStarMaxAttempts >= 1 && twoStarMaxAttempts >= threeStarMaxAttempts);
  const thirdStarByStage = Object.fromEntries(gameConfig.puzzles.map((puzzle) => [puzzle.id, puzzle.starThresholds]));
  for (const [stage, thresholds] of Object.entries(thirdStarByStage)) {
    assert.equal(thresholds[0], 0, `stage ${stage}`);
    assert.equal(thresholds[1], 0, `stage ${stage}`);
  }
  const scored = Object.entries(thirdStarByStage).filter(([, thresholds]) => thresholds[2] > 0).map(([stage]) => Number(stage));
  assert.deepEqual(scored, [3, 7, 9]);
});

test('Versus view policies: the new methods are covered and write nothing', () => {
  assert.equal(VERSUS_STORAGE_POLICY.getPuzzleStageStats, STORAGE_POLICIES.EMPTY_OBJECT);
  assert.equal(VERSUS_STORAGE_POLICY.recordPuzzleAttempt, STORAGE_POLICIES.EMPTY_OBJECT);
  assert.equal(VERSUS_STORAGE_POLICY.savePuzzleStageResult, STORAGE_POLICIES.LEVEL_RESULT);
  assert.equal(VERSUS_STORAGE_POLICY.getPuzzleTotalStars, STORAGE_POLICIES.ZERO);
  assert.equal(VERSUS_STORAGE_POLICY.seedPuzzleStageStats, STORAGE_POLICIES.INTERNAL);
  withManager((manager, storage) => {
    const view = createVersusStorageView(manager);
    const before = [...storage.data.entries()].join('|');
    assert.deepEqual(view.getPuzzleStageStats(), {});
    assert.deepEqual(view.recordPuzzleAttempt(STAGE), {});
    assert.deepEqual(view.savePuzzleStageResult(STAGE, HIGH_SCORE, THREE_STARS), { newlyEarnedStars: 0 });
    assert.equal(view.getPuzzleTotalStars(), 0);
    assert.equal([...storage.data.entries()].join('|'), before, 'the view never writes');
    assert.equal(view.seedPuzzleStageStats, undefined, 'internal plumbing is not exposed');
  });
});
