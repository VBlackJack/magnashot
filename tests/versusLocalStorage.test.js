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
import { createVersusStorageView } from '../src/core/StorageView.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

const { prefix, keys } = gameConfig.storage;
const MATCHES_KEY = `${prefix}${keys.versusLocalMatches}`;
const CORRUPT_VALUES = ['abc', '-4', ''];
const EXPECTED_COUNT = 3;
const SEEDED_COUNT = '5';

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

test('the local match counter key comes from the configuration', () => {
  assert.equal(keys.versusLocalMatches, 'versus_local_matches');
});

test('a fresh profile has played no local match', () => {
  withManager(null, (manager) => assert.equal(manager.getVersusLocalMatches(), 0));
});

test('each recorded local match increments the counter and persists it', () => {
  withManager(null, (manager, storage) => {
    for (let i = 0; i < EXPECTED_COUNT; i += 1) {
      manager.recordVersusLocalMatch();
    }
    assert.equal(manager.getVersusLocalMatches(), EXPECTED_COUNT);
    assert.equal(storage.getItem(MATCHES_KEY), String(EXPECTED_COUNT));
  });
});

test('a corrupt stored counter reads as zero and recovers on the next record', () => {
  for (const bad of CORRUPT_VALUES) {
    withManager((s) => s.setItem(MATCHES_KEY, bad), (manager) => {
      assert.equal(manager.getVersusLocalMatches(), 0, bad);
      manager.recordVersusLocalMatch();
      assert.equal(manager.getVersusLocalMatches(), 1, bad);
    });
  }
});

test('the local counter does not touch the CPU records', () => {
  withManager(null, (manager) => {
    manager.recordVersusLocalMatch();
    assert.ok(Object.values(manager.getVersusRecords()).every((r) => r.w === 0 && r.l === 0));
  });
});

test('the versus storage view reads zero and writes nothing', () => {
  withManager((s) => s.setItem(MATCHES_KEY, SEEDED_COUNT), (manager, storage) => {
    const view = createVersusStorageView(manager);
    assert.equal(view.getVersusLocalMatches(), 0);
    view.recordVersusLocalMatch();
    assert.equal(storage.getItem(MATCHES_KEY), SEEDED_COUNT);
  });
});
