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

const { prefix, keys, legacyMigration } = gameConfig.storage;
const LEGACY = legacyMigration.prefixes[0];
const FOREIGN_KEY = 'otherproject_v1_coins';
const OLD_COINS = '321';
const NEW_COINS = '999';
const OLD_UNLOCKED = '7';

const createFakeStorage = ({ throwing = false } = {}) => {
  const data = new Map();
  const guard = () => {
    if (throwing) {
      throw new Error('storage unavailable');
    }
  };
  return {
    data,
    get length() { guard(); return data.size; },
    key(i) { guard(); return [...data.keys()][i] ?? null; },
    getItem(k) { guard(); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { guard(); data.set(k, String(v)); },
    removeItem(k) { guard(); data.delete(k); },
    clear() { guard(); data.clear(); }
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

const initManager = () => {
  const manager = new StorageManager();
  manager.init();
  return manager;
};

test('legacy keys are copied under the current prefix when absent', () => {
  const storage = createFakeStorage();
  storage.setItem(`${LEGACY}${keys.coins}`, OLD_COINS);
  storage.setItem(`${LEGACY}${keys.unlockedLevel}`, OLD_UNLOCKED);
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(`${prefix}${keys.coins}`), OLD_COINS);
    assert.equal(storage.getItem(`${prefix}${keys.unlockedLevel}`), OLD_UNLOCKED);
    assert.equal(storage.getItem(`${LEGACY}${keys.coins}`), OLD_COINS, 'old keys are kept');
  });
});

test('existing current-prefix data is never overwritten', () => {
  const storage = createFakeStorage();
  storage.setItem(`${LEGACY}${keys.coins}`, OLD_COINS);
  storage.setItem(`${prefix}${keys.coins}`, NEW_COINS);
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(`${prefix}${keys.coins}`), NEW_COINS);
  });
});

test('foreign prefixes are ignored', () => {
  const storage = createFakeStorage();
  storage.setItem(FOREIGN_KEY, OLD_COINS);
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(FOREIGN_KEY), OLD_COINS);
    assert.equal(storage.getItem(`${prefix}otherproject_v1_coins`), null);
    assert.equal(storage.getItem(`${prefix}${keys.coins}`), null);
  });
});

test('migration runs once, guarded by the marker', () => {
  const storage = createFakeStorage();
  storage.setItem(`${LEGACY}${keys.coins}`, OLD_COINS);
  withStorage(storage, () => {
    initManager();
    assert.notEqual(storage.getItem(`${prefix}${legacyMigration.markerKey}`), null);
    storage.removeItem(`${prefix}${keys.coins}`);
    initManager();
    assert.equal(storage.getItem(`${prefix}${keys.coins}`), null, 'second init does not rerun');
  });
});

test('a throwing storage does not break init', () => {
  const storage = createFakeStorage({ throwing: true });
  withStorage(storage, () => {
    assert.doesNotThrow(() => initManager());
  });
});

test('recovered progress is readable through StorageManager', () => {
  const storage = createFakeStorage();
  storage.setItem(`${LEGACY}${keys.coins}`, OLD_COINS);
  withStorage(storage, () => {
    const manager = initManager();
    assert.equal(manager.safeGetItem(keys.coins), OLD_COINS);
  });
});
