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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configRegistry } from '../src/core/ConfigRegistry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { GAME_MODES } from '../src/core/Constants.js';
import { createShotTimeline, appendTimelineSample, markTimelineComplete } from '../src/core/ShotTimeline.js';
import { pickWeeklyMasteryTrio } from '../src/core/BountiesStore.js';
import { buildPersonalBestGhost } from '../src/game/EngineGhostDuel.js';

const loadJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('balls', loadJson('./configs/balls.json'));
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

test('pickWeeklyMasteryTrio deterministically picks 3 scaled distinct-event objectives per ISO week', () => {
  const a = pickWeeklyMasteryTrio(gameConfig.bounties, '2026-W47');
  const b = pickWeeklyMasteryTrio(gameConfig.bounties, '2026-W47');
  assert.equal(a.length, 3);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((i) => i.eventKey)).size, 3);
});

test('StorageManager tracks Weekly Mastery Trio progress, pays chest bonus once, and rolls over on new week', () => {
  const storage = new StorageManager();
  storage.init();
  const startCoins = storage.getCoins();
  const state = storage.getWeeklyMasteryState('2026-W47');
  assert.equal(state.items.length, 3);
  assert.equal(state.chestClaimed, false);

  let expectedCoins = 0;
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    const res = storage.recordWeeklyMasteryProgress(item.eventKey, item.target, '2026-W47');
    assert.equal(res.completed.length, 1);
    expectedCoins += item.coins;
    if (i < state.items.length - 1) {
      assert.equal(res.chestAwarded, 0);
    } else {
      assert.equal(res.chestAwarded, gameConfig.bounties.weeklyChestBonusCoins);
      expectedCoins += res.chestAwarded;
    }
  }
  assert.equal(storage.getCoins(), startCoins + expectedCoins);
  assert.equal(storage.getWeeklyMasteryState('2026-W47').chestClaimed, true);

  // Next ISO week resets cleanly
  const nextWeek = storage.getWeeklyMasteryState('2026-W48');
  assert.equal(nextWeek.chestClaimed, false);
  assert.ok(nextWeek.items.every((item) => item.progress === 0 && !item.completed));
});

test('StorageCosmetics tracks cosmetic count, daily puzzle clears, and PB timelines for Survival and Slingshot', () => {
  const storage = new StorageManager();
  storage.init();
  assert.equal(storage.getUnlockedCosmeticCount(), 3);
  assert.equal(storage.getDailyPuzzlesCleared(), 0);
  assert.equal(storage.incrementDailyPuzzlesCleared(), 1);
  assert.equal(storage.getDailyPuzzlesCleared(), 1);

  const makeTl = (mode) => {
    const tl = createShotTimeline(mode, gameConfig.shotTimeline);
    appendTimelineSample(tl, 120, 10, gameConfig.shotTimeline);
    appendTimelineSample(tl, 450, 6, gameConfig.shotTimeline);
    appendTimelineSample(tl, 890, 0, gameConfig.shotTimeline);
    return markTimelineComplete(tl);
  };
  assert.equal(storage.setPbTimeline(GAME_MODES.ENDLESS, 890, makeTl(GAME_MODES.ENDLESS)), true);
  assert.equal(storage.setPbTimeline(GAME_MODES.SLINGSHOT, 890, makeTl(GAME_MODES.SLINGSHOT)), true);

  const survivalPb = buildPersonalBestGhost(storage, GAME_MODES.ENDLESS, GAME_MODES.ENDLESS, gameConfig, 'PB');
  const slingshotPb = buildPersonalBestGhost(storage, GAME_MODES.SLINGSHOT, GAME_MODES.SLINGSHOT, gameConfig, 'PB');
  assert.equal(survivalPb?.isPersonalBest, true);
  assert.equal(survivalPb?.final, 890);
  assert.equal(slingshotPb?.isPersonalBest, true);
  assert.equal(slingshotPb?.final, 890);
});
