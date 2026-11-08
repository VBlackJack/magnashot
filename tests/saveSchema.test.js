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
    assert.equal(storage.getItem(VERSION_KEY), String(CURRENT_SAVE_SCHEMA_VERSION));
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

// ---- Migration v2 (grandfather mode unlocks) and v3 (seed daily history) ----

const UNLOCKS_KEY = `${prefix}${keys.modeUnlocks}`;
const HISTORY_KEY = `${prefix}${keys.dailyHistory}`;
const GATED_MODES = Object.keys(gameConfig.modeUnlocks.campaignLevelCleared);
const STATE_SEEN = gameConfig.modeUnlocks.stateSeen;
const STATE_NEW = gameConfig.modeUnlocks.stateNew;
const SCHEMA_V1 = '1';
const SCHEMA_V2 = '2';
const PROGRESS_LEVEL = '2';
const SEED_DATE = '2026-11-02';
const SEED_SCORE = 4321;
const SEED_STREAK = 4;
const readUnlocks = (storage) => JSON.parse(storage.getItem(UNLOCKS_KEY) || '{}');
const allSeen = Object.fromEntries(GATED_MODES.map((mode) => [mode, STATE_SEEN]));

test('v2: a fresh install stores no mode unlocks', () => {
  const storage = createFakeStorage();
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(UNLOCKS_KEY), null);
  });
});

test('v2: settings only, and the legacy marker alone, do not count as progress', () => {
  const storage = createFakeStorage();
  storage.setItem(`${prefix}${keys.language}`, 'fr');
  storage.setItem(`${prefix}${keys.muted}`, 'true');
  storage.setItem(`${prefix}${keys.discoveriesVersion}`, '3');
  storage.setItem(`${prefix}${keys.activeBallStyle}`, 'classic');
  storage.setItem(MARKER_KEY, 'true');
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(UNLOCKS_KEY), null);
  });
});

test('v2: empty-looking progress values do not count', () => {
  const storage = createFakeStorage();
  storage.setItem(`${prefix}${keys.levelStats}`, '{}');
  storage.setItem(`${prefix}${keys.coins}`, '0');
  storage.setItem(`${prefix}${keys.achievements}`, '[]');
  storage.setItem(`${prefix}${keys.upgrades}`, ' null ');
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(UNLOCKS_KEY), null);
  });
});

test('v2: an unlocked level above 1 unlocks every gated mode as seen', () => {
  const storage = createFakeStorage();
  storage.setItem(`${prefix}${keys.unlockedLevel}`, PROGRESS_LEVEL);
  storage.setItem(VERSION_KEY, SCHEMA_V1);
  withStorage(storage, () => {
    initManager();
    assert.deepEqual(readUnlocks(storage), allSeen);
    assert.equal(storage.getItem(VERSION_KEY), String(CURRENT_SAVE_SCHEMA_VERSION));
  });
});

test('v2: coins, discoveries or a run snapshot alone are enough', () => {
  for (const name of ['coins', 'discoveries', 'runSnapshot']) {
    const storage = createFakeStorage();
    storage.setItem(`${prefix}${keys[name]}`, name === 'coins' ? '75' : '{"a":1}');
    withStorage(storage, () => {
      initManager();
      assert.deepEqual(readUnlocks(storage), allSeen, name);
    });
  }
});

test('v2: legacy-prefix progress copied by v1 is seen by v2 in the same launch', () => {
  const storage = createFakeStorage();
  storage.setItem(`${LEGACY}${keys.coins}`, LEGACY_COINS);
  withStorage(storage, () => {
    initManager();
    assert.deepEqual(readUnlocks(storage), allSeen);
  });
});

test('v2: stored entries are merged, never shrunk or downgraded', () => {
  const storage = createFakeStorage();
  storage.setItem(`${prefix}${keys.coins}`, '10');
  storage.setItem(UNLOCKS_KEY, JSON.stringify({ flux: STATE_NEW, extra: STATE_SEEN }));
  withStorage(storage, () => {
    initManager();
    const stored = readUnlocks(storage);
    assert.equal(stored.flux, STATE_NEW);
    assert.equal(stored.extra, STATE_SEEN);
    for (const mode of GATED_MODES.filter((name) => name !== 'flux')) {
      assert.equal(stored[mode], STATE_SEEN);
    }
  });
});

test('v2: rerunning the step is idempotent', () => {
  const storage = createFakeStorage();
  storage.setItem(`${prefix}${keys.coins}`, '10');
  withStorage(storage, () => {
    const manager = initManager();
    const first = storage.getItem(UNLOCKS_KEY);
    assert.equal(manager.grandfatherModeUnlocks(), true);
    assert.equal(manager.grandfatherModeUnlocks(), true);
    assert.equal(storage.getItem(UNLOCKS_KEY), first);
  });
});

test('v2: a failing write leaves the version at 1 and the next launch retries', () => {
  let reject = true;
  const storage = createFakeStorage({ failWrite: (k) => reject && k === UNLOCKS_KEY });
  storage.setItem(`${prefix}${keys.coins}`, '10');
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(VERSION_KEY), SCHEMA_V1);
    assert.equal(storage.getItem(UNLOCKS_KEY), null);
    reject = false;
    initManager();
    assert.deepEqual(readUnlocks(storage), allSeen);
    assert.equal(storage.getItem(VERSION_KEY), String(CURRENT_SAVE_SCHEMA_VERSION));
  });
});

test('v2: a newer stored version is left untouched', () => {
  const storage = createFakeStorage();
  storage.setItem(VERSION_KEY, FUTURE_VERSION);
  storage.setItem(`${prefix}${keys.coins}`, '10');
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(UNLOCKS_KEY), null);
    assert.equal(storage.getItem(VERSION_KEY), FUTURE_VERSION);
  });
});

test('v3: seeds the history once from the stored daily best', () => {
  const storage = createFakeStorage();
  storage.setItem(VERSION_KEY, SCHEMA_V2);
  storage.setItem(`${prefix}${keys.dailyBest}`, String(SEED_SCORE));
  storage.setItem(`${prefix}${keys.dailyBestDate}`, SEED_DATE);
  storage.setItem(`${prefix}${keys.dailyStreak}`, String(SEED_STREAK));
  storage.setItem(`${prefix}${keys.dailyStreakDate}`, SEED_DATE);
  withStorage(storage, () => {
    const manager = initManager();
    const expected = [{ d: SEED_DATE, s: SEED_SCORE, w: null, m: null, k: SEED_STREAK, g: false }];
    assert.deepEqual(JSON.parse(storage.getItem(HISTORY_KEY)), expected);
    assert.deepEqual(manager.getDailyHistory(), expected);
    assert.equal(manager.seedDailyHistory(), true);
    assert.deepEqual(JSON.parse(storage.getItem(HISTORY_KEY)), expected);
  });
});

test('v3: the streak is null when it belongs to another date, and nothing is seeded without a best', () => {
  const storage = createFakeStorage();
  storage.setItem(VERSION_KEY, SCHEMA_V2);
  storage.setItem(`${prefix}${keys.dailyBest}`, String(SEED_SCORE));
  storage.setItem(`${prefix}${keys.dailyBestDate}`, SEED_DATE);
  storage.setItem(`${prefix}${keys.dailyStreak}`, String(SEED_STREAK));
  storage.setItem(`${prefix}${keys.dailyStreakDate}`, '2026-10-01');
  withStorage(storage, () => {
    initManager();
    assert.equal(JSON.parse(storage.getItem(HISTORY_KEY))[0].k, null);
  });
  const empty = createFakeStorage();
  empty.setItem(VERSION_KEY, SCHEMA_V2);
  withStorage(empty, () => {
    initManager();
    assert.equal(empty.getItem(HISTORY_KEY), null);
  });
});

test('v3: an existing history is never overwritten', () => {
  const storage = createFakeStorage();
  storage.setItem(VERSION_KEY, SCHEMA_V2);
  storage.setItem(HISTORY_KEY, '[]');
  storage.setItem(`${prefix}${keys.dailyBest}`, String(SEED_SCORE));
  storage.setItem(`${prefix}${keys.dailyBestDate}`, SEED_DATE);
  withStorage(storage, () => {
    initManager();
    assert.equal(storage.getItem(HISTORY_KEY), '[]');
  });
});
