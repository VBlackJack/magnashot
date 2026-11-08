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
import { createShotTimeline, appendTimelineSample } from '../src/game/ShotTimeline.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

const { prefix, keys } = gameConfig.storage;
const HISTORY_KEY = `${prefix}${keys.dailyHistory}`;
const GRACE_KEY = `${prefix}${keys.dailyStreakGraceDate}`;
const { maxEntries, timelineEntries } = gameConfig.dailyHistory;
const TIMELINE_CFG = gameConfig.shotTimeline;
const BASE_DAY_MS = Date.UTC(2026, 0, 1);
const MS_PER_DAY = 86_400_000;
const MUTATOR = 'hyperGravity';
const OTHER_MUTATOR = 'turboRotors';

const dateKeyAt = (offset) => new Date(BASE_DAY_MS + offset * MS_PER_DAY).toISOString().slice(0, 10);

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

const withManager = (seed, fn) => {
  const storage = createFakeStorage();
  seed?.(storage);
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

const buildTimeline = (shots) => {
  const tl = createShotTimeline('daily', TIMELINE_CFG);
  for (let i = 1; i <= shots; i++) {
    appendTimelineSample(tl, i * 10, shots - i, TIMELINE_CFG);
  }
  return tl;
};

test('an empty profile has an empty history', () => {
  withManager(null, (manager) => {
    assert.deepEqual(manager.getDailyHistory(), []);
  });
});

test('a result is recorded with its fields, newest date first', () => {
  withManager(null, (manager) => {
    manager.recordDailyResult({ dateKey: dateKeyAt(0), score: 100, wave: 2, mutatorKey: MUTATOR });
    manager.recordDailyResult({ dateKey: dateKeyAt(1), score: 200, wave: 3, mutatorKey: null });
    const history = manager.getDailyHistory();
    assert.deepEqual(history.map((entry) => entry.d), [dateKeyAt(1), dateKeyAt(0)]);
    assert.deepEqual(history[1], { d: dateKeyAt(0), s: 100, w: 2, m: MUTATOR, k: null, g: false });
    assert.equal(history[0].m, null);
  });
});

test('the higher score is kept per date with the wave and mutator of that run', () => {
  withManager(null, (manager) => {
    const date = dateKeyAt(0);
    manager.recordDailyResult({ dateKey: date, score: 500, wave: 5, mutatorKey: MUTATOR });
    manager.recordDailyResult({ dateKey: date, score: 300, wave: 9, mutatorKey: OTHER_MUTATOR });
    let [entry] = manager.getDailyHistory();
    assert.equal(manager.getDailyHistory().length, 1);
    assert.deepEqual([entry.s, entry.w, entry.m], [500, 5, MUTATOR]);
    manager.recordDailyResult({ dateKey: date, score: 900, wave: 7, mutatorKey: OTHER_MUTATOR });
    [entry] = manager.getDailyHistory();
    assert.deepEqual([entry.s, entry.w, entry.m], [900, 7, OTHER_MUTATOR]);
  });
});

test('the history is trimmed to the configured maximum, dropping the oldest', () => {
  withManager(null, (manager) => {
    for (let day = 0; day < maxEntries + 5; day++) {
      manager.recordDailyResult({ dateKey: dateKeyAt(day), score: day + 1, wave: 1, mutatorKey: null });
    }
    const history = manager.getDailyHistory();
    assert.equal(history.length, maxEntries);
    assert.equal(history[0].d, dateKeyAt(maxEntries + 4));
    assert.equal(history.at(-1).d, dateKeyAt(5));
  });
});

test('corrupt JSON and invalid entries give an empty or filtered list', () => {
  withManager((storage) => storage.setItem(HISTORY_KEY, '{not json'), (manager) => {
    assert.deepEqual(manager.getDailyHistory(), []);
    manager.recordDailyResult({ dateKey: dateKeyAt(0), score: 10 });
    assert.equal(manager.getDailyHistory().length, 1);
  });
  withManager((storage) => storage.setItem(HISTORY_KEY, JSON.stringify({ not: 'an array' })), (manager) => {
    assert.deepEqual(manager.getDailyHistory(), []);
  });
  withManager((storage) => storage.setItem(HISTORY_KEY, JSON.stringify([null, 3, { d: 'bad', s: 4 }, { d: dateKeyAt(0), s: -4 }])), (manager) => {
    assert.deepEqual(manager.getDailyHistory().map((entry) => entry.d), [dateKeyAt(0)]);
    assert.equal(manager.getDailyHistory()[0].s, 0);
  });
});

test('an invalid date key is ignored', () => {
  withManager(null, (manager) => {
    manager.recordDailyResult({ dateKey: 'yesterday', score: 10 });
    assert.deepEqual(manager.getDailyHistory(), []);
  });
});

test('the streak of the day and the grace flag are recorded', () => {
  withManager(null, (manager) => {
    const first = dateKeyAt(0);
    const third = dateKeyAt(2);
    manager.claimDailyPlayBonus(first, 0, null);
    manager.recordDailyResult({ dateKey: first, score: 100 });
    manager.claimDailyPlayBonus(third, 0, null);
    manager.recordDailyResult({ dateKey: third, score: 100 });
    const byDate = Object.fromEntries(manager.getDailyHistory().map((entry) => [entry.d, entry]));
    assert.equal(byDate[first].k, 1);
    assert.equal(byDate[first].g, false);
    assert.equal(byDate[third].k, 2);
    assert.equal(byDate[third].g, true);
    assert.equal(manager.safeGetItem(keys.dailyStreakGraceDate), third);
  });
  withManager((storage) => storage.setItem(GRACE_KEY, dateKeyAt(0)), (manager) => {
    manager.recordDailyResult({ dateKey: dateKeyAt(0), score: 1 });
    assert.equal(manager.getDailyHistory()[0].g, true);
  });
});

test('the timeline is replaced only when the score improves', () => {
  withManager(null, (manager) => {
    const date = dateKeyAt(0);
    const firstTimeline = buildTimeline(3);
    const secondTimeline = buildTimeline(5);
    manager.recordDailyResult({ dateKey: date, score: 100, tl: firstTimeline });
    manager.recordDailyResult({ dateKey: date, score: 50, tl: secondTimeline });
    assert.equal(manager.getDailyHistory()[0].tl.n, firstTimeline.n);
    manager.recordDailyResult({ dateKey: date, score: 150, tl: secondTimeline });
    assert.equal(manager.getDailyHistory()[0].tl.n, secondTimeline.n);
  });
});

test('an invalid timeline is dropped while the entry is kept', () => {
  withManager(null, (manager) => {
    manager.recordDailyResult({ dateKey: dateKeyAt(0), score: 10, tl: { v: 99 } });
    const [entry] = manager.getDailyHistory();
    assert.equal(entry.s, 10);
    assert.equal('tl' in entry, false);
  });
});

test('only the most recent entries keep their timeline', () => {
  withManager(null, (manager) => {
    const total = timelineEntries + 4;
    for (let day = 0; day < total; day++) {
      manager.recordDailyResult({ dateKey: dateKeyAt(day), score: 10, tl: buildTimeline(2) });
    }
    const history = manager.getDailyHistory();
    assert.equal(history.length, total);
    history.forEach((entry, position) => {
      assert.equal('tl' in entry, position < timelineEntries, `position ${position}`);
    });
  });
});
