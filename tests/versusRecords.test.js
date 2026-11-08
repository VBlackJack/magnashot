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

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

const { prefix, keys } = gameConfig.storage;
const RECORDS_KEY = `${prefix}${keys.versusRecords}`;

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

const EMPTY = { easy: { w: 0, l: 0 }, normal: { w: 0, l: 0 }, hard: { w: 0, l: 0 } };

test('storage key and tiers come from the configuration', () => {
  assert.equal(keys.versusRecords, 'versus_records');
  assert.deepEqual(gameConfig.versus.records.tiers, ['easy', 'normal', 'hard']);
  assert.deepEqual(Object.keys(gameConfig.versus.cpu), gameConfig.versus.records.tiers);
});

test('every Classic palette colour has a polarity and both polarities exist', () => {
  const balls = loadJson('./configs/balls.json');
  const classic = gameConfig.classic;
  const palette = balls.standardColors.slice(0, classic.maxPalette).map((c) => c.id);
  const polarities = gameConfig.versus.colorPolarities;
  for (const id of palette) {
    assert.ok(polarities[id] === 1 || polarities[id] === -1, id);
  }
  const startPalette = palette.slice(0, classic.basePalette).map((id) => polarities[id]);
  assert.ok(startPalette.includes(1) && startPalette.includes(-1));
  assert.equal(gameConfig.versus.fallbackPolarity, 1);
  assert.equal(gameConfig.versus.guardStreakSize, 3);
  assert.equal(gameConfig.versus.framesPerSecond, 60);
  assert.equal(gameConfig.versus.roundsToWin, 2);
});

test('a fresh profile has empty records and writes nothing', () => {
  withManager(null, (manager, storage) => {
    assert.deepEqual(manager.getVersusRecords(), EMPTY);
    assert.equal(storage.getItem(RECORDS_KEY), null);
  });
});

test('results accumulate per tier', () => {
  withManager(null, (manager) => {
    manager.recordVersusResult('normal', true);
    manager.recordVersusResult('normal', true);
    manager.recordVersusResult('normal', false);
    manager.recordVersusResult('easy', false);
    assert.deepEqual(manager.getVersusRecords(), {
      easy: { w: 0, l: 1 },
      normal: { w: 2, l: 1 },
      hard: { w: 0, l: 0 }
    });
  });
});

test('an unknown tier is ignored', () => {
  withManager(null, (manager, storage) => {
    manager.recordVersusResult('impossible', true);
    manager.recordVersusResult(undefined, true);
    assert.equal(storage.getItem(RECORDS_KEY), null);
    assert.deepEqual(manager.getVersusRecords(), EMPTY);
  });
});

test('corrupt stored records are sanitized', () => {
  const corrupt = JSON.stringify({ easy: { w: -3, l: 'x' }, normal: 7, hard: { w: 2.9, l: null }, extra: { w: 5 } });
  const cases = [
    ['not json', EMPTY],
    ['[]', EMPTY],
    ['"x"', EMPTY],
    [corrupt, { easy: { w: 0, l: 0 }, normal: { w: 0, l: 0 }, hard: { w: 2, l: 0 } }]
  ];
  for (const [raw, expected] of cases) {
    withManager((storage) => storage.setItem(RECORDS_KEY, raw), (manager) => {
      assert.deepEqual(manager.getVersusRecords(), expected, raw);
    });
  }
});

test('Hard unlocks after one win against Normal, and only then', () => {
  withManager(null, (manager) => {
    assert.equal(manager.isVersusTierUnlocked('easy'), true);
    assert.equal(manager.isVersusTierUnlocked('normal'), true);
    assert.equal(manager.isVersusTierUnlocked('hard'), false);
    manager.recordVersusResult('easy', true);
    manager.recordVersusResult('normal', false);
    manager.recordVersusResult('hard', true);
    assert.equal(manager.isVersusTierUnlocked('hard'), false, 'only a Normal win counts');
    manager.recordVersusResult('normal', true);
    assert.equal(manager.isVersusTierUnlocked('hard'), true);
    assert.equal(manager.isVersusTierUnlocked('unknown'), false);
  });
});

test('a stored record counts as progress for the mode access', () => {
  withManager(null, (manager) => {
    manager.recordVersusResult('easy', true);
    assert.equal(manager.getModeAccess().versus.unlocked, true);
  });
});
