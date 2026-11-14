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

test('every bounties.catalog entry has localized EN and FR titles and Day-1 progression filtering excludes locked modes', () => {
  const en = loadJson('./locales/en.json');
  const fr = loadJson('./locales/fr.json');
  const enItems = en?.modals?.play?.bounties?.items || {};
  const frItems = fr?.modals?.play?.bounties?.items || {};

  for (const entry of gameConfig.bounties.catalog) {
    assert.equal(typeof enItems[entry.id]?.title, 'string', `missing EN bounty title for ${entry.id}`);
    assert.equal(typeof frItems[entry.id]?.title, 'string', `missing FR bounty title for ${entry.id}`);
    assert.ok(enItems[entry.id].title.length > 0);
    assert.ok(frItems[entry.id].title.length > 0);
  }

  const dayOneUnlocked = new Set(['campaign', 'daily']);
  for (let day = 1; day <= 30; day++) {
    const dateKey = `2026-11-${String(day).padStart(2, '0')}`;
    const rolled = pickDailyBounties(gameConfig.bounties, dateKey, { unlockedModes: dayOneUnlocked });
    assert.equal(rolled.length, gameConfig.bounties.dailyCount);
    for (const item of rolled) {
      assert.ok(
        item.mode === null || dayOneUnlocked.has(item.mode),
        `Day-1 roll on ${dateKey} included locked mode ${item.mode} (${item.id})`
      );
    }
  }
});

test('normalizeBountiesState and StorageManager preserve valid daily contracts across mid-day unlocks and sanitize tampered backups', () => {
  const sm = createTestStorage();
  const dateKey = '2026-11-15';

  // Fresh Day-1 player (0 campaign levels cleared) rolls only unlocked contracts.
  const morning = sm.getDailyBountiesState(dateKey);
  assert.equal(morning.items.length, gameConfig.bounties.dailyCount);
  for (const item of morning.items) {
    assert.ok(item.mode === null || item.mode === 'campaign' || item.mode === 'daily');
  }

  // Record partial progress, then clear campaign levels mid-day to unlock new modes.
  const tracked = morning.items[0];
  sm.recordBountyProgress(tracked.eventKey, 1, dateKey);
  for (let lvl = 1; lvl <= 17; lvl++) {
    sm.saveLevelResult(lvl, 5000, 3);
  }
  sm.syncEarnedModeUnlocks();

  const afternoon = sm.getDailyBountiesState(dateKey);
  assert.deepEqual(
    afternoon.items.map((item) => item.id),
    morning.items.map((item) => item.id),
    'mid-day mode unlocks must not wipe or reroll today contracts'
  );
  assert.equal(afternoon.items[0].progress, Math.min(tracked.target, 1));

  // Tampered or stale backup items are re-hydrated from canonical catalog and unknown IDs replaced.
  const tampered = normalizeBountiesState(
    {
      dateKey,
      items: [
        { id: 'nonexistent_contract', progress: 99, completed: true, coins: 99999 },
        { id: 'daily_clear', progress: 0, completed: false, coins: 99999, target: 0 }
      ]
    },
    gameConfig.bounties,
    dateKey,
    { unlockedModes: new Set(['campaign', 'daily']) }
  );
  assert.equal(tampered.items.length, gameConfig.bounties.dailyCount);
  assert.equal(tampered.items.some((item) => item.id === 'nonexistent_contract'), false);
  const dailyItem = tampered.items.find((item) => item.id === 'daily_clear');
  assert.ok(dailyItem);
  assert.equal(dailyItem.coins, 50);
  assert.equal(dailyItem.target, 1);

  // Stale 0-progress locked contracts are replaced, while started progress on a locked contract is kept.
  const staleLocked = normalizeBountiesState(
    {
      dateKey,
      items: [
        { id: 'pinball_cores', progress: 0, completed: false },
        { id: 'convoy_snapbacks', progress: 2, completed: false }
      ]
    },
    gameConfig.bounties,
    dateKey,
    { unlockedModes: new Set(['campaign', 'daily']) }
  );
  assert.equal(staleLocked.items.some((item) => item.id === 'pinball_cores'), false);
  const keptStarted = staleLocked.items.find((item) => item.id === 'convoy_snapbacks');
  assert.ok(keptStarted);
  assert.equal(keptStarted.progress, 2);
});
