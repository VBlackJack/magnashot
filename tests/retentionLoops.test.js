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
import { GameEngine, RUN_BEST_METRICS } from '../src/game/GameEngine.js';
import { GAME_MODES, GAME_STATES } from '../src/core/Constants.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';

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

const GAME_OVER_REASON = 'testReason';
const FLUX_SEED = '123456';
const DAILY_SEED = '2026-11-01';
const KEYS = gameConfig.storage.keys;
const DAILY = gameConfig.daily;
const DAY_1 = '2026-11-01';
const DAY_2 = '2026-11-02';
const DAY_3 = '2026-11-03';
const DAY_4 = '2026-11-04';
const DAY_5 = '2026-11-05';
const VETERAN_STREAK = 5;
const HUGE_STREAK = 50;

const createStorage = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  return storageManager;
};

const createEngine = (storageManager = createStorage()) => new GameEngine({
  gameConfig,
  physicsConfig,
  ballsConfig,
  obstaclesConfig,
  levelsConfig,
  campaignConfig,
  campaignTuning,
  fluxConfig,
  audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
  storageManager,
  onStateChange: () => {}
});

const claim = (storage, dateKey) => storage.claimDailyPlayBonus(dateKey, DAILY.firstPlayBonusCoins, DAILY);

const tierRewards = (baseId, upTo) => {
  const tiers = Object.values(gameConfig.achievements).filter((spec) => spec.tierOf === baseId);
  return tiers.slice(0, upTo).reduce((sum, spec) => sum + spec.rewardCoins, 0);
};

// --- Near miss and best marker ---------------------------------------------------------

test('Flux near miss reports the shapes short of the best stage', () => {
  const storage = createStorage();
  storage.setFluxRecord(0, 10);
  const engine = createEngine(storage);
  engine.startFluxRun(FLUX_SEED);
  engine.fluxStage = 7;
  engine.triggerGameOver(GAME_OVER_REASON);
  assert.deepEqual(engine.gameOverSummary.nearMiss, {
    metric: RUN_BEST_METRICS.STAGE, current: 7, best: 10, gap: 3
  });
});

test('Boss Rush near miss uses waves', () => {
  const storage = createStorage();
  storage.setBossRushRecord(0, 6);
  const engine = createEngine(storage);
  engine.startBossRushMode();
  engine.bossRushWave = 4;
  engine.triggerGameOver(GAME_OVER_REASON);
  assert.deepEqual(engine.gameOverSummary.nearMiss, {
    metric: RUN_BEST_METRICS.WAVE, current: 4, best: 6, gap: 2
  });
});

test('Score-based modes report a score near miss', () => {
  const scoreModes = [
    [GAME_MODES.ENDLESS, (s, e) => { s.setEndlessHighScore(1000); e.startEndlessMode(); }],
    [GAME_MODES.DAILY, (s, e) => { s.setDailyHighScore(1000, DAILY_SEED); e.startDailyChallenge(DAILY_SEED); }],
    [GAME_MODES.CASCADE, (s, e) => { s.setCascadeHighScore(1000); e.startCascadeMode(); }],
    [GAME_MODES.BLITZ, (s, e) => { s.setBlitzHighScore(1000); e.startBlitzMode(); }]
  ];
  for (const [mode, start] of scoreModes) {
    const storage = createStorage();
    const engine = createEngine(storage);
    start(storage, engine);
    assert.equal(engine.mode, mode);
    engine.score = 700;
    engine.triggerGameOver(GAME_OVER_REASON);
    assert.deepEqual(engine.gameOverSummary.nearMiss, {
      metric: RUN_BEST_METRICS.SCORE, current: 700, best: 1000, gap: 300
    }, mode);
  }
});

test('A run far below the record is not a near miss: the gap ratio comes from config', () => {
  const ratio = gameConfig.scoring.nearMissMaxGapRatio;
  assert.equal(ratio, 0.5);
  const best = 1000;
  const reachedAt = (score) => {
    const storage = createStorage();
    storage.setEndlessHighScore(best);
    const engine = createEngine(storage);
    engine.startEndlessMode();
    engine.score = score;
    engine.triggerGameOver(GAME_OVER_REASON);
    return engine.gameOverSummary.nearMiss;
  };
  assert.equal(reachedAt(best * (1 - ratio) - 1), null, 'just past the ratio');
  assert.equal(reachedAt(best * (1 - ratio))?.gap, best * ratio, 'exactly at the ratio still shows');
});

test('Near miss is null without a previous best, on a new record, on a tie and in the campaign', () => {
  const noBest = createEngine();
  noBest.startFluxRun(FLUX_SEED);
  noBest.triggerGameOver(GAME_OVER_REASON);
  assert.equal(noBest.gameOverSummary.nearMiss, null);

  const storage = createStorage();
  storage.setEndlessHighScore(500);
  const record = createEngine(storage);
  record.startEndlessMode();
  record.score = 900;
  record.triggerGameOver(GAME_OVER_REASON);
  assert.equal(record.gameOverSummary.nearMiss, null);

  const tieStorage = createStorage();
  tieStorage.setEndlessHighScore(500);
  const tie = createEngine(tieStorage);
  tie.startEndlessMode();
  tie.score = 500;
  tie.triggerGameOver(GAME_OVER_REASON);
  assert.equal(tie.gameOverSummary.nearMiss, null);

  const campaign = createEngine();
  campaign.startCampaignLevel(1);
  assert.equal(campaign.getRunBestMarker(), null);
  campaign.triggerGameOver(GAME_OVER_REASON);
  assert.equal(campaign.gameOverSummary.nearMiss, null);
});

test('Best marker shows the record the run started against, even after the run saves progress', () => {
  const storage = createStorage();
  storage.setEndlessHighScore(1000);
  const engine = createEngine(storage);
  engine.startEndlessMode();
  engine.score = 300;
  assert.deepEqual(engine.getRunBestMarker(), { metric: RUN_BEST_METRICS.SCORE, best: 1000, current: 300 });

  engine.score = 1500;
  engine.persistRunHighScore();
  assert.equal(storage.getEndlessHighScore(), 1500);
  assert.deepEqual(engine.getRunBestMarker(), { metric: RUN_BEST_METRICS.SCORE, best: 1000, current: 1500 });

  engine.startEndlessMode();
  assert.equal(engine.getRunBestMarker().best, 1500, 'the next run starts against the new record');
});

test('persistRunHighScore before the first marker read keeps the record the run started against', () => {
  const storage = createStorage();
  storage.setFluxRecord(0, 10);
  const engine = createEngine(storage);
  engine.startFluxRun(FLUX_SEED);
  engine.runBestBaseline = null;
  engine.fluxStage = 12;
  engine.persistRunHighScore();
  assert.equal(storage.getFluxBestStage(), 12);
  assert.deepEqual(engine.getRunBestMarker(), { metric: RUN_BEST_METRICS.STAGE, best: 10, current: 12 });
});

test('A reloaded run keeps its run-best baseline instead of comparing against itself', () => {
  const storage = createStorage();
  storage.setEndlessHighScore(1000);
  const engine = createEngine(storage);
  engine.startEndlessMode();
  assert.equal(engine.getRunBestMarker().best, 1000);
  engine.score = 1500;
  engine.persistRunHighScore();
  engine.saveRunSnapshot({ force: true });
  assert.deepEqual(storage.loadRunSnapshot().runBestBaseline, { metric: RUN_BEST_METRICS.SCORE, best: 1000 });

  const reloaded = createEngine(storage);
  assert.equal(reloaded.restoreSavedRun(), true);
  assert.equal(reloaded.score, 1500);
  assert.deepEqual(reloaded.getRunBestMarker(), { metric: RUN_BEST_METRICS.SCORE, best: 1000, current: 1500 });

  // A snapshot from before the baseline existed, or a damaged one, falls back to storage.
  const stored = storage.loadRunSnapshot();
  delete stored.runBestBaseline;
  storage.saveRunSnapshot(stored);
  const legacy = createEngine(storage);
  assert.equal(legacy.restoreSavedRun(), true);
  assert.equal(legacy.getRunBestMarker().best, 1500);
  stored.runBestBaseline = { metric: RUN_BEST_METRICS.WAVE, best: 3 };
  storage.saveRunSnapshot(stored);
  const damaged = createEngine(storage);
  assert.equal(damaged.restoreSavedRun(), true);
  assert.equal(damaged.getRunBestMarker().best, 1500, 'a baseline of another metric is ignored');
});

test('Best marker is null with no record yet', () => {
  const engine = createEngine();
  engine.startFluxRun(FLUX_SEED);
  assert.equal(engine.getRunBestMarker(), null);
});

// --- Forgiving daily streak ------------------------------------------------------------

test('Daily streak with no missed day keeps counting and never uses grace', () => {
  const storage = createStorage();
  claim(storage, DAY_1);
  claim(storage, DAY_2);
  assert.equal(storage.getDailyStreak(DAY_2), 2);
  assert.deepEqual(storage.getDailyStreakGrace(DAY_2), { available: true, usedOn: null, daysUntilAvailable: 0 });
});

test('Daily streak forgives one missed day: getDailyStreak and the claim agree', () => {
  const storage = createStorage();
  claim(storage, DAY_1);
  claim(storage, DAY_2);
  assert.equal(storage.getDailyStreak(DAY_4), 2, 'still alive before the claim');
  storage.setCoins(0);
  assert.equal(claim(storage, DAY_4), true);
  assert.equal(storage.getDailyStreak(DAY_4), 3, 'keeps counting from the last played day');
  assert.deepEqual(storage.getDailyStreakGrace(DAY_4), {
    available: false, usedOn: DAY_4, daysUntilAvailable: DAILY.streakGraceWindowDays
  });
  const expected = DAILY.firstPlayBonusCoins + Math.min(DAILY.maxStreakBonusCoins, 2 * DAILY.streakStepCoins);
  assert.equal(storage.getCoins(), expected);
});

test('Daily streak resets after two missed days', () => {
  const storage = createStorage();
  claim(storage, DAY_1);
  claim(storage, DAY_2);
  assert.equal(storage.getDailyStreak(DAY_5), 0);
  claim(storage, DAY_5);
  assert.equal(storage.getDailyStreak(DAY_5), 1);
  assert.equal(storage.getDailyStreakGrace(DAY_5).usedOn, null, 'a reset does not spend the grace');
});

test('Grace is not reusable inside its window and comes back after it', () => {
  const storage = createStorage();
  claim(storage, DAY_1);
  claim(storage, DAY_3);
  assert.equal(storage.getDailyStreak(DAY_3), 2);
  assert.equal(storage.getDailyStreakGrace(DAY_3).usedOn, DAY_3);

  // A second miss inside the window breaks the streak.
  assert.equal(storage.getDailyStreak(DAY_5), 0);
  claim(storage, DAY_5);
  assert.equal(storage.getDailyStreak(DAY_5), 1);

  // After the window the grace is back.
  const windowDays = DAILY.streakGraceWindowDays;
  assert.ok(windowDays >= 1);
  const later = createStorage();
  later.safeSetItem(KEYS.dailyStreak, VETERAN_STREAK);
  later.safeSetItem(KEYS.dailyStreakDate, DAY_1);
  later.safeSetItem(KEYS.dailyLastPlayedDate, DAY_1);
  later.safeSetItem(KEYS.dailyStreakGraceDate, '2026-10-25');
  assert.equal(later.getDailyStreakGrace(DAY_3).available, true);
  assert.equal(later.getDailyStreak(DAY_3), VETERAN_STREAK);
  later.safeSetItem(KEYS.dailyStreakGraceDate, '2026-10-28');
  assert.equal(later.getDailyStreakGrace(DAY_3).available, false);
  assert.equal(later.getDailyStreak(DAY_3), 0);
});

test('A veteran with streak keys and no grace key is forgiven once', () => {
  const storage = createStorage();
  storage.safeSetItem(KEYS.dailyStreak, VETERAN_STREAK);
  storage.safeSetItem(KEYS.dailyStreakDate, DAY_1);
  storage.safeSetItem(KEYS.dailyLastPlayedDate, DAY_1);
  assert.equal(storage.getDailyStreak(DAY_3), VETERAN_STREAK);
  claim(storage, DAY_3);
  assert.equal(storage.getDailyStreak(DAY_3), VETERAN_STREAK + 1);
  assert.equal(storage.getDailyStreakGrace(DAY_3).usedOn, DAY_3);
});

test('Streak coins stay under the existing cap when the streak is forgiven', () => {
  const storage = createStorage();
  storage.safeSetItem(KEYS.dailyStreak, HUGE_STREAK);
  storage.safeSetItem(KEYS.dailyStreakDate, DAY_1);
  storage.safeSetItem(KEYS.dailyLastPlayedDate, DAY_1);
  storage.setCoins(0);
  claim(storage, DAY_3);
  assert.equal(storage.getCoins(), DAILY.firstPlayBonusCoins + DAILY.maxStreakBonusCoins);
});

test('Disabling the grace in config restores the strict streak', () => {
  const storage = createStorage();
  storage.dailyConfig = { ...DAILY, streakGraceDays: 0 };
  claim(storage, DAY_1);
  assert.equal(storage.getDailyStreak(DAY_3), 0);
  assert.deepEqual(storage.getDailyStreakGrace(DAY_3), { available: false, usedOn: null, daysUntilAvailable: 0 });
});

// --- Tiered achievements ---------------------------------------------------------------

test('Every achievement is a tier of a family; legacy ids are the bronze of themselves', () => {
  const legacyIds = ['firstAvalanche', 'comboMaster', 'bossSlayer', 'sharpshooter', 'survivorWave10', 'starCollector'];
  for (const id of legacyIds) {
    assert.equal(gameConfig.achievements[id].tierOf, id);
    assert.equal(gameConfig.achievements[id].tier, 'bronze');
  }
  const families = new Map();
  for (const spec of Object.values(gameConfig.achievements)) {
    assert.ok(['bronze', 'silver', 'gold'].includes(spec.tier), spec.id);
    assert.ok(gameConfig.achievements[spec.tierOf], `${spec.id} points at an existing base`);
    assert.ok(spec.rewardCoins > 0 && spec.threshold > 0, spec.id);
    families.set(spec.tierOf, [...(families.get(spec.tierOf) || []), spec]);
  }
  for (const [base, tiers] of families) {
    assert.deepEqual(tiers.map((spec) => spec.tier), ['bronze', 'silver', 'gold'], base);
    assert.ok(tiers[0].threshold < tiers[1].threshold && tiers[1].threshold < tiers[2].threshold, base);
  }
  assert.ok(families.has('fluxShapes') && families.has('bossRushWaves') && families.has('firstAvalanche'));
});

test('Tiers unlock in order with their own rewards', () => {
  const storage = createStorage();
  const engine = createEngine(storage);
  const tiers = Object.values(gameConfig.achievements).filter((spec) => spec.tierOf === 'comboMaster');
  const before = storage.getCoins();

  engine.unlockAchievementTiers('comboMaster', tiers[0].threshold);
  assert.deepEqual(Object.keys(storage.getUnlockedAchievements()), [tiers[0].id]);
  assert.equal(storage.getCoins(), before + tiers[0].rewardCoins);

  engine.unlockAchievementTiers('comboMaster', tiers[1].threshold);
  assert.equal(storage.getUnlockedAchievements()[tiers[1].id], true);
  assert.equal(storage.getUnlockedAchievements()[tiers[2].id], undefined);
  assert.equal(storage.getCoins(), before + tiers[0].rewardCoins + tiers[1].rewardCoins);

  engine.unlockAchievementTiers('comboMaster', tiers[2].threshold);
  assert.equal(storage.getCoins(), before + tierRewards('comboMaster', 3));
  engine.unlockAchievementTiers('comboMaster', tiers[2].threshold);
  assert.equal(storage.getCoins(), before + tierRewards('comboMaster', 3), 'no double payment');
});

test('A jump past several thresholds unlocks the lower tiers too, in order', () => {
  const storage = createStorage();
  const engine = createEngine(storage);
  const seen = [];
  const announcements = [];
  const original = engine.unlockAchievementSilently.bind(engine);
  engine.unlockAchievementSilently = (id) => { seen.push(id); return original(id); };
  engine.announceAchievementUnlocks = (ids) => announcements.push(ids);
  engine.unlockAchievementTiers('survivorWave10', Number.MAX_SAFE_INTEGER);
  const family = Object.values(gameConfig.achievements)
    .filter((spec) => spec.tierOf === 'survivorWave10').map((spec) => spec.id);
  assert.deepEqual(seen, family);
  assert.deepEqual(announcements, [family], 'one grouped announcement for the whole jump');
});

test('Several tiers unlocked in one tick give one popup, one sound and one UI announcement', () => {
  const storage = createStorage();
  const notifications = [];
  const engine = createEngine(storage);
  engine.notifyUI = (extra) => notifications.push(extra);
  let sounds = 0;
  engine.audioManager.playEffect = () => { sounds += 1; };
  const popups = [];
  engine.particleSystem.spawnFloatingText = (x, y, text) => popups.push(text);
  const family = Object.values(gameConfig.achievements).filter((spec) => spec.tierOf === 'comboMaster');
  engine.unlockAchievementTiers('comboMaster', family[1].threshold);
  assert.equal(sounds, 1);
  assert.equal(popups.length, 1);
  const grouped = notifications.filter((extra) => extra?.unlockedAchievementIds);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].unlockedAchievementIds, [family[0].id, family[1].id]);

  engine.unlockAchievementTiers('comboMaster', family[2].threshold);
  assert.equal(sounds, 2, 'a later single unlock announces on its own');
  assert.deepEqual(
    notifications.filter((extra) => extra?.unlockedAchievementIds).at(-1).unlockedAchievementIds,
    [family[2].id]
  );
});

test('A veteran with legacy keys and past records gets no bulk payout', () => {
  const storage = createStorage();
  storage.safeSetItem(KEYS.achievements, JSON.stringify({ comboMaster: true, bossSlayer: true }));
  storage.safeSetItem(KEYS.achievementRecords, JSON.stringify({ maxCombo: 99, bossesDestroyed: 99 }));
  storage.setBossRushRecord(0, 99);
  storage.setFluxRecord(0, 99);
  const coins = storage.getCoins();
  const engine = createEngine(storage);
  assert.equal(storage.getCoins(), coins, 'loading pays nothing');
  assert.deepEqual(storage.getUnlockedAchievements(), { comboMaster: true, bossSlayer: true });

  // The bronze they own is not paid again; only the tier the play reaches is.
  engine.unlockAchievementTiers('comboMaster', gameConfig.achievements.comboMasterSilver.threshold);
  assert.equal(storage.getCoins(), coins + gameConfig.achievements.comboMasterSilver.rewardCoins);
  assert.equal(storage.getUnlockedAchievements().comboMasterGold, undefined);
});

test('Clearing a Flux shape unlocks the Flux shapes tier', () => {
  const storage = createStorage();
  const engine = createEngine(storage);
  engine.startFluxRun(FLUX_SEED);
  engine.fluxStage = gameConfig.achievements.fluxShapes.threshold - 1;
  engine.completeFluxStage();
  assert.equal(storage.getUnlockedAchievements().fluxShapes, true);
  assert.equal(storage.getUnlockedAchievements().fluxShapesSilver, undefined);
});

test('Stars are cumulative: a veteran at 150 stars gets Silver and Gold on the next victory, in one popup', () => {
  const stars = gameConfig.achievements.starCollectorGold.threshold + 30;
  const stats = {};
  for (let levelId = 2; levelId < 2 + stars / 3; levelId += 1) {
    stats[levelId] = { bestScore: 1, stars: 3 };
  }
  const storage = createStorage();
  storage.safeSetItem(KEYS.levelStats, JSON.stringify(stats));
  storage.safeSetItem(KEYS.achievements, JSON.stringify({ starCollector: true }));
  assert.equal(storage.getTotalStars(), stars);
  assert.ok(gameConfig.achievements.starCollectorSilver.cumulative && gameConfig.achievements.starCollectorGold.cumulative);
  const coins = storage.getCoins();
  const engine = createEngine(storage);
  assert.deepEqual(storage.getUnlockedAchievements(), { starCollector: true }, 'loading pays nothing');

  const starAnnouncements = [];
  const announce = engine.announceAchievementUnlocks.bind(engine);
  engine.announceAchievementUnlocks = (ids) => {
    if (ids.some((id) => id.startsWith('starCollector'))) {
      starAnnouncements.push(ids);
    }
    announce(ids);
  };
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  engine.evaluateRoundEnd();
  assert.equal(engine.state, GAME_STATES.VICTORY);
  assert.equal(storage.getUnlockedAchievements().starCollectorSilver, true);
  assert.equal(storage.getUnlockedAchievements().starCollectorGold, true);
  assert.deepEqual(starAnnouncements, [['starCollectorSilver', 'starCollectorGold']]);
  const starReward = gameConfig.achievements.starCollectorSilver.rewardCoins
    + gameConfig.achievements.starCollectorGold.rewardCoins;
  assert.ok(storage.getCoins() >= coins + starReward, 'the catch-up pays both tiers once');
});

test('A per-run record above a tier is not paid retroactively on later play', () => {
  const storage = createStorage();
  storage.safeSetItem(KEYS.achievements, JSON.stringify({ comboMaster: true }));
  storage.safeSetItem(KEYS.achievementRecords, JSON.stringify({ maxCombo: 99 }));
  const engine = createEngine(storage);
  const silver = gameConfig.achievements.comboMasterSilver;
  assert.ok(!silver.cumulative);
  engine.unlockAchievementTiers('comboMaster', silver.threshold - 1);
  assert.deepEqual(storage.getUnlockedAchievements(), { comboMaster: true });
});

test('Reaching a Boss Rush wave through gameplay unlocks its tier', () => {
  const storage = createStorage();
  const engine = createEngine(storage);
  engine.startBossRushMode();
  engine.bossRushWave = gameConfig.achievements.bossRushWaves.threshold - 1;
  engine.physicsWorld.clear();
  engine.evaluateRoundEnd();
  assert.equal(engine.bossRushWave, gameConfig.achievements.bossRushWaves.threshold);
  assert.equal(storage.getUnlockedAchievements().bossRushWaves, true);
  assert.equal(storage.getUnlockedAchievements().bossRushWavesSilver, undefined);
});
