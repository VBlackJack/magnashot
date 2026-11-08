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
import { parseFluxSeedInput } from '../src/game/DailyShare.js';
import { createShotTimeline, appendTimelineSample, markTimelineComplete } from '../src/game/ShotTimeline.js';
import { getUtcIsoWeekKey, getWeeklyFluxSeed, getMsUntilNextWeekly } from '../src/game/WeeklyFlux.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
const fluxConfig = loadJson('./configs/flux.json');
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

const SEED_CFG = fluxConfig.seed;
const { seedSalt, firstPlayBonusCoins } = gameConfig.weeklyFlux;
const TIMELINE_CFG = gameConfig.shotTimeline;
const utc = (iso) => Date.parse(iso);
const MS_PER_WEEK = 604_800_000;
const WEEK_ONE_MONDAY = '2025-12-29T00:00:00Z';
const WEEK = '2026-W45';
const OTHER_WEEK = '2026-W46';

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

const withManager = (fn) => {
  const storage = createFakeStorage();
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

test('ISO week keys around the year boundary', () => {
  assert.equal(getUtcIsoWeekKey(utc('2025-12-28T23:59:59Z')), '2025-W52');
  assert.equal(getUtcIsoWeekKey(utc(WEEK_ONE_MONDAY)), '2026-W01');
  assert.equal(getUtcIsoWeekKey(utc('2026-12-31T12:00:00Z')), '2026-W53');
  assert.equal(getUtcIsoWeekKey(utc('2027-01-01T12:00:00Z')), '2026-W53');
  assert.equal(getUtcIsoWeekKey(utc('2027-01-04T00:00:00Z')), '2027-W01');
});

test('the week changes exactly on Monday 00:00 UTC', () => {
  assert.equal(getUtcIsoWeekKey(utc('2026-11-08T23:59:59.999Z')), WEEK);
  assert.equal(getUtcIsoWeekKey(utc('2026-11-09T00:00:00.000Z')), OTHER_WEEK);
  assert.equal(getMsUntilNextWeekly(utc('2026-11-08T23:59:59.999Z')), 1);
  assert.equal(getMsUntilNextWeekly(utc('2026-11-09T00:00:00.000Z')), MS_PER_WEEK);
});

test('every instant of a week shares its key and the countdown stays in range', () => {
  const monday = utc(WEEK_ONE_MONDAY);
  for (let offset = 0; offset < MS_PER_WEEK; offset += MS_PER_WEEK / 28) {
    assert.equal(getUtcIsoWeekKey(monday + offset), '2026-W01');
    const remaining = getMsUntilNextWeekly(monday + offset);
    assert.ok(remaining > 0 && remaining <= MS_PER_WEEK);
    assert.equal(getUtcIsoWeekKey(monday + offset + remaining), '2026-W02');
  }
});

test('fixed weekly seeds are valid Flux seeds and differ from week to week', () => {
  const expected = { '2026-W01': 'cw4k0i', '2026-W45': 'gp21ju', '2026-W46': 'gf2fuv', '2026-W53': 'ejk72p' };
  for (const [week, seed] of Object.entries(expected)) {
    assert.equal(getWeeklyFluxSeed(week, SEED_CFG, seedSalt), seed, week);
    assert.equal(parseFluxSeedInput(seed, SEED_CFG), seed, week);
    assert.equal(parseFluxSeedInput(`#${seed.toUpperCase()}`, SEED_CFG), seed, week);
  }
  assert.equal(new Set(Object.values(expected)).size, Object.keys(expected).length);
});

test('the seed is deterministic (a restart keeps it) and depends on the salt', () => {
  assert.equal(getWeeklyFluxSeed(WEEK, SEED_CFG, seedSalt), getWeeklyFluxSeed(WEEK, SEED_CFG, seedSalt));
  assert.notEqual(getWeeklyFluxSeed(WEEK, SEED_CFG, seedSalt), getWeeklyFluxSeed(WEEK, SEED_CFG, `${seedSalt}-other`));
});

test('seeds of many weeks always satisfy the seed length and charset', () => {
  const monday = utc(WEEK_ONE_MONDAY);
  for (let week = 0; week < 520; week++) {
    const key = getUtcIsoWeekKey(monday + week * MS_PER_WEEK);
    const seed = getWeeklyFluxSeed(key, SEED_CFG, seedSalt);
    assert.equal(parseFluxSeedInput(seed, SEED_CFG), seed, key);
  }
});

test('the first-play bonus is paid once per week', () => {
  withManager((manager) => {
    const before = manager.getCoins();
    assert.equal(manager.claimWeeklyFluxBonus(WEEK, firstPlayBonusCoins), true);
    assert.equal(manager.getCoins(), before + firstPlayBonusCoins);
    assert.equal(manager.claimWeeklyFluxBonus(WEEK, firstPlayBonusCoins), false);
    assert.equal(manager.getCoins(), before + firstPlayBonusCoins);
    assert.equal(manager.claimWeeklyFluxBonus(OTHER_WEEK, firstPlayBonusCoins), true);
    assert.equal(manager.getCoins(), before + 2 * firstPlayBonusCoins);
  });
});

test('the weekly best is one slot per week and keeps the best score and stage', () => {
  withManager((manager) => {
    assert.equal(manager.getWeeklyFluxBest(WEEK), null);
    const seed = getWeeklyFluxSeed(WEEK, SEED_CFG, seedSalt);
    manager.setWeeklyFluxBest(WEEK, seed, 500, 3);
    manager.setWeeklyFluxBest(WEEK, seed, 300, 5);
    assert.deepEqual(manager.getWeeklyFluxBest(WEEK), { week: WEEK, seed, score: 500, stage: 5 });
    manager.setWeeklyFluxBest(WEEK, seed, 800, 2);
    assert.deepEqual(manager.getWeeklyFluxBest(WEEK), { week: WEEK, seed, score: 800, stage: 5 });
    assert.equal(manager.getWeeklyFluxBest(OTHER_WEEK), null);
    manager.setWeeklyFluxBest(OTHER_WEEK, 'aaaaaa', 10, 1);
    assert.equal(manager.getWeeklyFluxBest(WEEK), null);
    assert.equal(manager.getWeeklyFluxBest(OTHER_WEEK).score, 10);
  });
});

test('the weekly timeline follows the score', () => {
  withManager((manager) => {
    const build = (shots) => {
      const tl = createShotTimeline('flux', TIMELINE_CFG);
      for (let i = 1; i <= shots; i++) {
        appendTimelineSample(tl, i, shots - i, TIMELINE_CFG);
      }
      return tl;
    };
    manager.setWeeklyFluxBest(WEEK, 'aaaaaa', 100, 1, build(2));
    manager.setWeeklyFluxBest(WEEK, 'aaaaaa', 50, 1, build(4));
    assert.equal(manager.getWeeklyFluxBest(WEEK).tl.n, 2);
    manager.setWeeklyFluxBest(WEEK, 'aaaaaa', 150, 1, build(4));
    assert.equal(manager.getWeeklyFluxBest(WEEK).tl.n, 4);
  });
});

test('hasClaimedWeeklyFluxBonus follows the weekly claim', () => {
  withManager((manager) => {
    assert.equal(manager.hasClaimedWeeklyFluxBonus(WEEK), false);
    manager.claimWeeklyFluxBonus(WEEK, firstPlayBonusCoins);
    assert.equal(manager.hasClaimedWeeklyFluxBonus(WEEK), true);
    assert.equal(manager.hasClaimedWeeklyFluxBonus(OTHER_WEEK), false);
    assert.equal(manager.hasClaimedWeeklyFluxBonus(''), false);
  });
});

test('at an equal weekly score a complete timeline replaces a partial one', () => {
  withManager((manager) => {
    const build = (shots) => {
      const tl = createShotTimeline('flux', TIMELINE_CFG);
      for (let i = 1; i <= shots; i++) {
        appendTimelineSample(tl, i, shots - i, TIMELINE_CFG);
      }
      return tl;
    };
    manager.setWeeklyFluxBest(WEEK, 'aaaaaa', 100, 1, build(2));
    assert.equal(manager.getWeeklyFluxBest(WEEK).tl.c, 0);
    manager.setWeeklyFluxBest(WEEK, 'aaaaaa', 100, 1, markTimelineComplete(build(4)));
    assert.equal(manager.getWeeklyFluxBest(WEEK).tl.c, 1);
    assert.equal(manager.getWeeklyFluxBest(WEEK).tl.n, 4);
    manager.setWeeklyFluxBest(WEEK, 'aaaaaa', 100, 1, build(6));
    assert.equal(manager.getWeeklyFluxBest(WEEK).tl.n, 4);
  });
});
