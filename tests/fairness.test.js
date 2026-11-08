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
import { GameEngine } from '../src/game/GameEngine.js';
import { captureRunSnapshot, isValidRunSnapshot, applyRunSnapshot } from '../src/game/RunSnapshot.js';
import { buildShareText } from '../src/game/DailyShare.js';
import { GAME_MODES } from '../src/core/Constants.js';
import { i18n, t } from '../src/core/I18n.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { SPECIAL_AMMO_BLOCK_REASON_KEYS, buildLevelIntroText } from '../src/ui/UIHelpers.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const campaignConfig = loadJson('./configs/campaign.json');
const campaignTuning = loadJson('./configs/campaignTuning.json');
const fluxConfig = loadJson('./configs/flux.json');
const audioConfig = loadJson('./configs/audio.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('campaign', campaignConfig);
configRegistry.configs.set('audio', audioConfig);
configRegistry.configs.set('flux', fluxConfig);

i18n.dictionaries.set('en', loadJson('./locales/en.json'));
i18n.currentLocale = 'en';

const DAILY_SEED = '2025-03-14';
const FLUX_SEED = 'fair01';
const SNAPSHOT_VERSION = 1;
const DRAW_COUNT = 21;
const QUEUE_PULLS = 10;
const MANY_DRAWS = 57;
const SPECIAL_GRANTS = 6;
const GONE_COLOR = 'definitely-gone';
const SNAPSHOT_FIELDS = ['launcherDrawIndex', 'specialGrantIndex', 'specialAmmoBoughtInRun'];
const RICH_COINS = 100000;

const createTestEngine = (upgradeLevels = null) => {
  const storageManager = new StorageManager();
  storageManager.init();
  if (upgradeLevels) {
    storageManager.upgradesCache = { ...upgradeLevels };
  }
  const dummyAudio = { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} };
  return new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    campaignConfig,
    campaignTuning,
    fluxConfig,
    audioManager: dummyAudio,
    storageManager,
    onStateChange: () => {}
  });
};

const burnRunDraws = (engine, count) => {
  for (let i = 0; i < count; i++) {
    engine.random();
  }
};

const maxUpgrades = () =>
  Object.fromEntries(Object.entries(gameConfig.upgrades).map(([key, spec]) => [key, spec.maxLevel]));
const zeroUpgrades = () => Object.fromEntries(Object.keys(gameConfig.upgrades).map((key) => [key, 0]));

const startDaily = (engine) => engine.startDailyChallenge(DAILY_SEED, true);
const startFlux = (engine) => engine.startFluxRun(FLUX_SEED, { isShared: true });
const startEndless = (engine) => engine.startEndlessMode();

const pullQueue = (engine, count) => {
  const colors = [];
  for (let i = 0; i < count; i++) {
    colors.push(engine.takeUpcomingBall().colorId);
  }
  return colors;
};

test('Daily launcher rolls and queue are identical whatever was played', () => {
  const a = createTestEngine();
  const b = createTestEngine();
  startDaily(a);
  startDaily(b);
  burnRunDraws(b, MANY_DRAWS);
  for (let index = 0; index < DRAW_COUNT; index++) {
    assert.equal(a.drawSeededRoll('launcher', index), b.drawSeededRoll('launcher', index));
  }
  assert.deepEqual(pullQueue(a, QUEUE_PULLS), pullQueue(b, QUEUE_PULLS));
});

test('Flux launcher queue ignores the physics drift consumed from the run stream', () => {
  const a = createTestEngine();
  const b = createTestEngine();
  startFlux(a);
  startFlux(b);
  burnRunDraws(b, MANY_DRAWS);
  assert.deepEqual(pullQueue(a, QUEUE_PULLS), pullQueue(b, QUEUE_PULLS));
});

test('Unseeded modes have no seed key and still draw a launcher color', () => {
  const engine = createTestEngine();
  startEndless(engine);
  assert.equal(engine.getRunSeedKey(), null);
  assert.ok(engine.activePalette.includes(engine.drawLauncherColor()));
});

test('Recoloring stale launcher colors does not advance the queue counter', () => {
  const engine = createTestEngine();
  startFlux(engine);
  const before = engine.launcherDrawIndex;
  assert.ok(before > 0);
  engine.currentBall.colorId = GONE_COLOR;
  engine.upcomingColorIds = [GONE_COLOR, GONE_COLOR];
  engine.refreshStaleLauncherColors();
  assert.equal(engine.launcherDrawIndex, before);
  assert.notEqual(engine.currentBall.colorId, GONE_COLOR);
  assert.ok(!engine.upcomingColorIds.includes(GONE_COLOR));
});

test('Daily gameplay getters ignore Workshop levels while Endless and Flux honour them', () => {
  const read = (engine) => ({
    blast: engine.getBlastRadiusMultiplier(),
    overcharge: engine.getOverchargeMultiplier(),
    laser: { ...engine.getLaserBonuses() },
    startingShots: engine.getStartingShotsBonus(),
    collectorPoints: engine.getCollectorBonusPoints(),
    collectorOvercharge: engine.getCollectorOvercharge()
  });
  const forMode = (start, levels) => {
    const engine = createTestEngine(levels);
    start(engine);
    return read(engine);
  };
  assert.deepEqual(forMode(startDaily, maxUpgrades()), forMode(startDaily, zeroUpgrades()));
  assert.notDeepEqual(forMode(startEndless, maxUpgrades()), forMode(startEndless, zeroUpgrades()));
  assert.notDeepEqual(forMode(startFlux, maxUpgrades()), forMode(startFlux, zeroUpgrades()));
});

test('Shop ammo is refused in the Daily Challenge with the fair play reason', () => {
  const engine = createTestEngine();
  startDaily(engine);
  engine.storageManager.setCoins(RICH_COINS);
  const before = engine.storageManager.getCoins();
  const type = Object.keys(gameConfig.specialShopCosts)[0];
  assert.equal(engine.canBuySpecialAmmo(), false);
  assert.equal(engine.buySpecialAmmo(type), false);
  assert.equal(engine.storageManager.getCoins(), before);
  assert.equal(engine.getSpecialAmmoBlockReason(), 'fairPlay');
  assert.equal(t(SPECIAL_AMMO_BLOCK_REASON_KEYS.fairPlay), 'Shop ammo is off in the Daily Challenge so every player starts equal.');
});

test('Flux still sells ammo and counts the purchases of the run', () => {
  const engine = createTestEngine();
  startFlux(engine);
  engine.stageIntroFrames = 0;
  engine.storageManager.setCoins(RICH_COINS);
  const type = Object.keys(gameConfig.specialShopCosts)[0];
  assert.equal(engine.buySpecialAmmo(type), true);
  assert.equal(engine.specialAmmoBoughtInRun, 1);
});

test('The nth random special grant is the same for two same-seed runs played differently', () => {
  const grantTypes = (engine, burn) => {
    burnRunDraws(engine, burn);
    const types = [];
    for (let i = 0; i < SPECIAL_GRANTS; i++) {
      const before = { ...engine.specialInventory };
      engine.grantRandomSpecialBall();
      types.push(Object.keys(engine.specialInventory).find((key) => engine.specialInventory[key] !== (before[key] || 0)));
    }
    return types;
  };
  const a = createTestEngine();
  const b = createTestEngine();
  startFlux(a);
  startFlux(b);
  assert.deepEqual(grantTypes(a, 0), grantTypes(b, MANY_DRAWS));
});

test('A run saved before the fairness counters restores them at zero', () => {
  const engine = createTestEngine();
  startFlux(engine);
  const snapshot = JSON.parse(JSON.stringify(captureRunSnapshot(engine, SNAPSHOT_VERSION)));
  for (const field of SNAPSHOT_FIELDS) {
    assert.ok(field in snapshot.engine, `${field} is saved`);
    delete snapshot.engine[field];
  }
  assert.ok(isValidRunSnapshot(snapshot, SNAPSHOT_VERSION));
  const fresh = createTestEngine();
  assert.equal(applyRunSnapshot(fresh, snapshot), true);
  assert.equal(fresh.launcherDrawIndex, 0);
  assert.equal(fresh.specialGrantIndex, 0);
  assert.equal(fresh.specialAmmoBoughtInRun, 0);
});

test('A saved launcher counter survives a restore', () => {
  const engine = createTestEngine();
  startDaily(engine);
  engine.takeUpcomingBall();
  const expected = engine.launcherDrawIndex;
  const snapshot = JSON.parse(JSON.stringify(captureRunSnapshot(engine, SNAPSHOT_VERSION)));
  const fresh = createTestEngine();
  assert.equal(applyRunSnapshot(fresh, snapshot), true);
  assert.equal(fresh.launcherDrawIndex, expected);
});

test('The Flux share text lists assists only when there are some', () => {
  const shareConfig = gameConfig.share;
  const base = { mode: GAME_MODES.FLUX, stage: 4, score: 900, seed: FLUX_SEED, url: shareConfig.url };
  const clean = buildShareText({ ...base, workshopLevels: 0, ammoBought: 0, continues: 0 }, shareConfig);
  assert.ok(!clean.includes('Assists'));
  assert.equal(buildShareText(base, shareConfig), clean);
  const assisted = buildShareText({ ...base, workshopLevels: 3, ammoBought: 2, continues: 1 }, shareConfig).split('\n');
  assert.equal(assisted.length, clean.split('\n').length + 1);
  assert.equal(assisted[assisted.length - 2], 'Assists: Workshop +3 - Ammo 2 - Continue 1');
  assert.ok(assisted[assisted.length - 1].includes(FLUX_SEED));
});

test('The Daily share text is unchanged by the assist fields', () => {
  const shareConfig = gameConfig.share;
  const run = { mode: GAME_MODES.DAILY, dateKey: DAILY_SEED, mutatorKey: null, wave: 3, score: 100, waveLog: [], url: shareConfig.url };
  assert.equal(
    buildShareText({ ...run, workshopLevels: 5, ammoBought: 5, continues: 1 }, shareConfig),
    buildShareText(run, shareConfig)
  );
});

test('The Daily intro states the fair play rule', () => {
  const intro = { mutatorKey: Object.keys(gameConfig.daily.mutators)[0] };
  const text = buildLevelIntroText(intro, t);
  assert.ok(text.includes('Workshop upgrades and shop ammo are off today.'));
  assert.ok(t('modals.shop.upgrades.dailyBaselineNote') !== 'modals.shop.upgrades.dailyBaselineNote');
});
