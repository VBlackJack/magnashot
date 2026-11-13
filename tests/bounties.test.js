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
import { pickDailyBounties, normalizeBountiesState, reportBountyEvent } from '../src/game/Bounties.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

const createTestStorage = () => {
  const map = new Map();
  const mockLocalStorage = {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); }
  };
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, configurable: true, writable: true });
  const sm = new StorageManager();
  sm.init();
  Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  sm.safeGetItem = (suffix) => mockLocalStorage.getItem(sm.buildKey(suffix));
  sm.safeSetItem = (suffix, value) => mockLocalStorage.setItem(sm.buildKey(suffix), value);
  return sm;
};

test('pickDailyBounties deterministically picks dailyCount distinct-event contracts per UTC date', () => {
  const dayA1 = pickDailyBounties(gameConfig.bounties, '2026-11-13');
  const dayA2 = pickDailyBounties(gameConfig.bounties, '2026-11-13');
  const dayB = pickDailyBounties(gameConfig.bounties, '2026-11-14');

  assert.equal(dayA1.length, gameConfig.bounties.dailyCount);
  assert.deepEqual(dayA1, dayA2);
  assert.equal(new Set(dayA1.map((b) => b.eventKey)).size, dayA1.length);
  assert.ok(dayB.length === gameConfig.bounties.dailyCount);
});

test('normalizeBountiesState resets progress when UTC date rolls over', () => {
  const prev = {
    dateKey: '2026-11-12',
    items: [{ id: 'pinball_cores', progress: 5, completed: false }]
  };
  const next = normalizeBountiesState(prev, gameConfig.bounties, '2026-11-13');
  assert.equal(next.dateKey, '2026-11-13');
  assert.ok(next.items.every((item) => item.progress === 0 && item.completed === false));
});

test('StorageManager tracks bounty progress, pays coins once on completion, and blocks versus/restore', () => {
  const sm = createTestStorage();
  const dateKey = '2026-11-13';
  const state = sm.getDailyBountiesState(dateKey);
  const targetBounty = state.items[0];
  const coinsStart = sm.getCoins();

  if (targetBounty.target > 1) {
    const partial = sm.recordBountyProgress(targetBounty.eventKey, 1, dateKey);
    assert.deepEqual(partial, []);
    assert.equal(sm.getCoins(), coinsStart);
  }

  const done = sm.recordBountyProgress(targetBounty.eventKey, targetBounty.target, dateKey);
  assert.equal(done.length, 1);
  assert.equal(done[0].id, targetBounty.id);
  assert.equal(sm.getCoins(), coinsStart + targetBounty.coins);

  // Re-triggering after completion pays nothing.
  const repeat = sm.recordBountyProgress(targetBounty.eventKey, targetBounty.target, dateKey);
  assert.deepEqual(repeat, []);
  assert.equal(sm.getCoins(), coinsStart + targetBounty.coins);

  // Versus and restoring runs are ignored cleanly by reportBountyEvent.
  const second = state.items[1];
  const mockEngine = { isVersusRole: true, isRestoringRun: false, storageManager: sm };
  assert.deepEqual(reportBountyEvent(mockEngine, second.eventKey, second.target), []);
  mockEngine.isVersusRole = false;
  mockEngine.isRestoringRun = true;
  assert.deepEqual(reportBountyEvent(mockEngine, second.eventKey, second.target), []);
});
