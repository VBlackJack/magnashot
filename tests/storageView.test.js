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
import {
  createVersusStorageView,
  VERSUS_STORAGE_POLICY,
  STORAGE_POLICIES
} from '../src/core/StorageView.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
configRegistry.configs.set('game', loadJson('./configs/game.json'));
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

const COINS = 250;
const RECORD_SCORE = 9000;
const RECORD_STAGE = 4;
const STARS = 3;
const UPGRADE_LEVEL = 3;
const PROBE_ARGS = [1, 2, 3];

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

const managerMethodNames = () => Object.getOwnPropertyNames(StorageManager.prototype);

test('every StorageManager method is classified (a new method must be classified here)', () => {
  const unclassified = managerMethodNames().filter((name) => !Object.hasOwn(VERSUS_STORAGE_POLICY, name));
  assert.deepEqual(unclassified, [], 'classify new StorageManager methods in VERSUS_STORAGE_POLICY');
});

test('the policy table lists no method that StorageManager no longer has', () => {
  const names = new Set(managerMethodNames());
  const stale = Object.keys(VERSUS_STORAGE_POLICY).filter((name) => !names.has(name));
  assert.deepEqual(stale, []);
});

test('every policy used in the table is a known policy', () => {
  const known = new Set(Object.values(STORAGE_POLICIES));
  for (const [name, policy] of Object.entries(VERSUS_STORAGE_POLICY)) {
    assert.ok(known.has(policy), `${name} uses unknown policy ${policy}`);
  }
});

test('the view exposes every non-internal method and hides the internal ones', () => {
  withStorage(createSpyStorage(), () => {
    const manager = new StorageManager();
    manager.init();
    const view = createVersusStorageView(manager);
    for (const [name, policy] of Object.entries(VERSUS_STORAGE_POLICY)) {
      if (policy === STORAGE_POLICIES.INTERNAL) {
        assert.equal(Object.hasOwn(view, name), false, `${name} must not be exposed`);
      } else {
        assert.equal(typeof view[name], 'function', `${name} must be exposed`);
      }
    }
  });
});

test('settings reads are forwarded to the real manager', () => {
  withStorage(createSpyStorage(), () => {
    const manager = new StorageManager();
    manager.init();
    manager.setReducedMotion(true);
    manager.setColorPatterns(true);
    manager.setHighContrast(true);
    const view = createVersusStorageView(manager);
    assert.equal(view.getReducedMotion(), true);
    assert.equal(view.getColorPatterns(), true);
    assert.equal(view.getHighContrast(), true);
    assert.equal(view.getAnimationSpeed(), manager.getAnimationSpeed());
    assert.equal(view.getRunSnapshotVersion(), manager.getRunSnapshotVersion());
  });
});

test('progress reads answer like a brand-new profile even on a rich profile', () => {
  withStorage(createSpyStorage(), () => {
    const manager = new StorageManager();
    manager.init();
    manager.setCoins(COINS);
    manager.setEndlessHighScore(RECORD_SCORE);
    manager.setClassicRecord(RECORD_SCORE, RECORD_STAGE);
    manager.upgradesCache = { aim: UPGRADE_LEVEL };
    const view = createVersusStorageView(manager);
    assert.equal(manager.getCoins(), COINS);
    assert.equal(view.getCoins(), 0);
    assert.equal(view.getUpgradeLevel('aim'), 0);
    assert.equal(view.getEndlessHighScore(), 0);
    assert.equal(view.getClassicHighScore(), 0);
    assert.equal(view.getClassicBestStage(), 0);
    assert.equal(view.loadRunSnapshot(), null);
    assert.equal(view.hasDiscoveries(), false);
    assert.deepEqual(view.getDiscoveries(), {});
    assert.deepEqual(view.saveLevelResult(1, RECORD_SCORE, STARS), { newlyEarnedStars: 0 });
  });
});

test('no view method writes to localStorage, whatever the arguments', () => {
  const storage = createSpyStorage();
  withStorage(storage, () => {
    const manager = new StorageManager();
    manager.init();
    const before = { writes: storage.spy.writes, removals: storage.spy.removals };
    const view = createVersusStorageView(manager);
    for (const [name, policy] of Object.entries(VERSUS_STORAGE_POLICY)) {
      if (policy === STORAGE_POLICIES.INTERNAL || typeof view[name] !== 'function') {
        continue;
      }
      view[name](...PROBE_ARGS);
      view[name]({ shots: 1 });
    }
    assert.equal(storage.spy.writes, before.writes, 'the view must not write');
    assert.equal(storage.spy.removals, before.removals, 'the view must not remove');
  });
});

test('answers are fresh objects, so a caller cannot corrupt the next answer', () => {
  const view = createVersusStorageView(null);
  view.getLevelStats().x = 1;
  view.getUnlockedAchievements().push('a');
  assert.deepEqual(view.getLevelStats(), {});
  assert.deepEqual(view.getUnlockedAchievements(), []);
});
