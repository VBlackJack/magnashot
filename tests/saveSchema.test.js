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
import { StorageManager, CURRENT_SAVE_SCHEMA_VERSION } from '../src/core/StorageManager.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

const { prefix, keys, legacyMigration } = gameConfig.storage;
const LEGACY = legacyMigration.prefixes[0];
const VERSION_KEY = `${prefix}${keys.schemaVersion}`;
const MARKER_KEY = `${prefix}${legacyMigration.markerKey}`;
const COINS_KEY = `${prefix}${keys.coins}`;
const LEGACY_COINS = '321';
const UNRELATED_KEY = 'otherproject_v1_coins';
const UNRELATED_VALUE = '5';
const FUTURE_VERSION = String(CURRENT_SAVE_SCHEMA_VERSION + 1);

const createFakeStorage = ({ throwing = false, failWrite = () => false } = {}) => {
  const data = new Map();
  const guard = () => {
    if (throwing) {
      throw new Error('storage unavailable');
    }
  };
  return {
    data,
    writes: [],
    get length() { guard(); return data.size; },
    key(i) { guard(); return [...data.keys()][i] ?? null; },
    getItem(k) { guard(); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) {
      guard();
      if (failWrite(k)) {
        throw new Error('write rejected');
      }
      this.writes.push(k);
      data.set(k, String(v));
    },
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

test('fresh install ends at the current schema version with the marker', () => {
  const storage = createFakeStorage();
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(VERSION_KEY), String(CURRENT_SAVE_SCHEMA_VERSION));
    assert.notEqual(storage.getItem(MARKER_KEY), null);
  });
});

test('marker without version: version set, legacy coins not copied', () => {
  const storage = createFakeStorage();
  storage.setItem(MARKER_KEY, 'true');
  storage.setItem(`${LEGACY}${keys.coins}`, LEGACY_COINS);
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(VERSION_KEY), '1');
    assert.equal(storage.getItem(COINS_KEY), null);
  });
});

test('version 1 with the marker deleted does not merge again', () => {
  const storage = createFakeStorage();
  storage.setItem(VERSION_KEY, '1');
  storage.setItem(`${LEGACY}${keys.coins}`, LEGACY_COINS);
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(COINS_KEY), null);
    assert.equal(storage.getItem(MARKER_KEY), null);
  });
});

test('a newer stored version is left untouched', () => {
  const storage = createFakeStorage();
  storage.setItem(VERSION_KEY, FUTURE_VERSION);
  storage.setItem(`${LEGACY}${keys.coins}`, LEGACY_COINS);
  withStorage(storage, () => {
    const before = storage.writes.length;
    initManager();
    assert.equal(storage.getItem(VERSION_KEY), FUTURE_VERSION);
    assert.equal(storage.writes.length, before);
    assert.equal(storage.getItem(COINS_KEY), null);
  });
});

test('a throwing storage neither throws nor writes', () => {
  const storage = createFakeStorage({ throwing: true });
  withStorage(storage, () => {
    assert.doesNotThrow(() => initManager());
    assert.equal(storage.writes.length, 0);
  });
});

test('a failing step leaves the version unset and the next init retries', () => {
  let reject = true;
  const storage = createFakeStorage({ failWrite: (k) => reject && k === COINS_KEY });
  storage.setItem(`${LEGACY}${keys.coins}`, LEGACY_COINS);
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(VERSION_KEY), null);
    reject = false;
    initManager();
    assert.equal(storage.getItem(COINS_KEY), LEGACY_COINS);
    assert.equal(storage.getItem(VERSION_KEY), String(CURRENT_SAVE_SCHEMA_VERSION));
  });
});

test('a rejected version write leaves it unset and the rerun is the same', () => {
  let reject = true;
  const storage = createFakeStorage({ failWrite: (k) => reject && k === VERSION_KEY });
  storage.setItem(`${LEGACY}${keys.coins}`, LEGACY_COINS);
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(VERSION_KEY), null);
    reject = false;
    initManager();
    assert.equal(storage.getItem(COINS_KEY), LEGACY_COINS);
    assert.equal(storage.getItem(VERSION_KEY), String(CURRENT_SAVE_SCHEMA_VERSION));
  });
});

test('without the schemaVersion config key the legacy merge still runs', () => {
  const storage = createFakeStorage();
  storage.setItem(`${LEGACY}${keys.coins}`, LEGACY_COINS);
  const saved = keys.schemaVersion;
  delete keys.schemaVersion;
  try {
    withStorage(storage, () => {
      initManager();
      assert.equal(storage.getItem(COINS_KEY), LEGACY_COINS);
      assert.equal(storage.getItem(VERSION_KEY), null);
    });
  } finally {
    keys.schemaVersion = saved;
  }
});

test('unrelated keys survive', () => {
  const storage = createFakeStorage();
  storage.setItem(UNRELATED_KEY, UNRELATED_VALUE);
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(UNRELATED_KEY), UNRELATED_VALUE);
  });
});
