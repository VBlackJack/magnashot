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
import { Ball } from '../src/entities/Ball.js';
import { Obstacle } from '../src/entities/Obstacle.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { GAME_MODES, GAME_STATES, SPECIAL_TYPES, CLUSTER_MODIFIERS, OBSTACLE_TYPES, WAVE_TYPES } from '../src/core/Constants.js';
import { getSagSpec } from '../src/game/SagMeter.js';
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

const PAST_DAILY_SEED = '2025-01-01';
const FAR_POSITION = 100;
const OTHER_POSITION = 400;
const TEST_FLUX_SEED = 'abc123';
const SHOP_TEST_COINS = 500;

const createTestEngine = (configOverride = gameConfig) => {
  const storageManager = new StorageManager();
  storageManager.init();
  const dummyAudio = {
    playEffect: () => {},
    stopAll: () => {},
    isMuted: () => true,
    setMuted: () => {}
  };
  return new GameEngine({
    gameConfig: configOverride,
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

const makeBoardBall = (x, y, options = {}) =>
  new Ball({ x, y, radius: physicsConfig.ball.radius, colorId: ballsConfig.standardColors[0].id, ...options });

/**
 * Installs a localStorage double whose writes always fail with a quota error,
 * and returns a function that restores the previous global.
 */
const installQuotaExceededStorage = (initialEntries) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const persisted = new Map(Object.entries(initialEntries));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (persisted.has(key) ? persisted.get(key) : null),
      setItem: () => {
        throw new Error('QuotaExceededError');
      }
    }
  });
  return () => {
    if (previous) {
      Object.defineProperty(globalThis, 'localStorage', previous);
    } else {
      delete globalThis.localStorage;
    }
  };
};

test('Victory is resolved once: a second evaluateRoundEnd on an empty board credits nothing', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  const coinsBefore = engine.storageManager.getCoins();

  engine.evaluateRoundEnd();
  assert.equal(engine.state, GAME_STATES.VICTORY);
  const coinsAfterFirst = engine.storageManager.getCoins();
  const scoreAfterFirst = engine.score;
  assert.ok(coinsAfterFirst > coinsBefore);

  engine.evaluateRoundEnd();
  assert.equal(engine.storageManager.getCoins(), coinsAfterFirst);
  assert.equal(engine.score, scoreAfterFirst);

  engine.addScore(1000);
  assert.equal(engine.score, scoreAfterFirst, 'Score must be frozen after victory');
});

test('Victory keeps the scene animating for the celebration before revealing the modal', () => {
  const engine = createTestEngine();
  const notifications = [];
  engine.onStateChange = (_engine, extra) => notifications.push(extra);
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  const fallingBall = makeBoardBall(FAR_POSITION, FAR_POSITION);
  engine.physicsWorld.droppingBalls.push(fallingBall);

  engine.evaluateRoundEnd();
  assert.equal(engine.state, GAME_STATES.VICTORY);
  assert.ok(engine.isVictoryCelebrating());
  assert.ok(engine.victorySummary.stars >= gameConfig.scoring.minVictoryStars);

  engine.update();
  assert.ok(fallingBall.y > FAR_POSITION, 'falling balls keep moving after the victory');

  notifications.length = 0;
  for (let i = 1; i < gameConfig.victory.celebrationFrames; i++) {
    engine.update();
  }
  assert.equal(engine.isVictoryCelebrating(), false);
  assert.equal(notifications.length, 1, 'the UI is notified once, when the celebration ends');

  engine.startCampaignLevel(1);
  assert.equal(engine.victorySummary, null);
});

test('No victory, score or coins after Game Over, even if the board is emptied', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.triggerGameOver('outOfShots');
  const coins = engine.storageManager.getCoins();

  engine.physicsWorld.clear();
  engine.evaluateRoundEnd();
  engine.checkDangerLineBreach();
  engine.detachAndRewardAvalanche();
  engine.addScore(1000);
  engine.addOvercharge(gameConfig.scoring.overchargeMax);

  assert.equal(engine.state, GAME_STATES.GAME_OVER);
  assert.equal(engine.score, 0);
  assert.equal(engine.overcharge, 0);
  assert.equal(engine.storageManager.getCoins(), coins);
});

test('Storage quota failure keeps the debited coin balance authoritative', () => {
  const sm = new StorageManager();
  sm.init();
  const coinsKey = sm.buildKey(gameConfig.storage.keys.coins);
  const restore = installQuotaExceededStorage({ [coinsKey]: '500' });
  try {
    assert.equal(sm.getCoins(), 500);
    const cost = sm.getUpgradeCost('laserSight');
    assert.equal(sm.purchaseUpgrade('laserSight'), true);
    assert.equal(sm.getCoins(), 500 - cost);
    assert.equal(sm.getUpgradeLevel('laserSight'), 1);
    assert.equal(sm.hasQuotaExceeded(), true);
  } finally {
    restore();
  }

  const engineStorage = new StorageManager();
  engineStorage.init();
  const engine = new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    campaignConfig,
    campaignTuning,
    fluxConfig,
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager: engineStorage
  });
  engine.startPuzzleMode(1);
  assert.equal(engine.canBuySpecialAmmo(), false);
  assert.equal(engine.getSpecialAmmoBlockReason(), null);
});

test('Corrupted JSON shapes ("null", arrays, numbers, bad entries) never throw and totals stay numeric', () => {
  const sm = new StorageManager();
  sm.init();
  const keys = gameConfig.storage.keys;

  sm.safeSetItem(keys.levelStats, 'null');
  sm.safeSetItem(keys.achievements, '[1,2,3]');
  sm.safeSetItem(keys.upgrades, '42');
  sm.upgradesCache = null;
  assert.deepEqual(sm.getLevelStats(), {});
  assert.deepEqual(sm.getUnlockedAchievements(), {});
  assert.equal(sm.getTotalStars(), 0);
  assert.equal(sm.getUpgradeLevel('laserSight'), 0);
  assert.equal(sm.unlockAchievement('comboMaster'), true);
  assert.deepEqual(sm.saveLevelResult(1, 100, 2), { newlyEarnedStars: 2 });

  sm.safeSetItem(keys.levelStats, JSON.stringify({ 1: { stars: 'x' }, 2: null, 3: { bestScore: 10, stars: 2 }, 4: [] }));
  const total = sm.getTotalStars();
  assert.equal(Number.isFinite(total), true);
  assert.equal(total, 2);
});

test('buySpecialAmmo is refused once the run is over and does not debit coins', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.storageManager.setCoins(500);
  engine.triggerGameOver('lineCrossed');
  const before = engine.specialInventory[SPECIAL_TYPES.BOMB];

  assert.equal(engine.buySpecialAmmo(SPECIAL_TYPES.BOMB), false);
  assert.equal(engine.storageManager.getCoins(), 500);
  assert.equal(engine.specialInventory[SPECIAL_TYPES.BOMB], before);

  engine.restartCurrent();
  engine.togglePause();
  assert.equal(engine.state, GAME_STATES.PAUSED);
  assert.equal(engine.buySpecialAmmo(SPECIAL_TYPES.BOMB), true);
});

test('Daily restart keeps the running seed and never re-grants the first-play bonus', () => {
  const engine = createTestEngine();
  engine.startDailyChallenge(PAST_DAILY_SEED);
  const coinsAfterStart = engine.storageManager.getCoins();
  const firstColors = engine.physicsWorld.balls.map((b) => b.colorId);

  // Simulate the stored last-played date moving on (UTC midnight rollover in another tab).
  engine.storageManager.safeSetItem(gameConfig.storage.keys.dailyLastPlayedDate, 'rolled-over');
  engine.restartCurrent();

  assert.equal(engine.mode, GAME_MODES.DAILY);
  assert.equal(engine.dailySeedKey, PAST_DAILY_SEED);
  assert.deepEqual(engine.physicsWorld.balls.map((b) => b.colorId), firstColors);
  assert.equal(engine.storageManager.getCoins(), coinsAfterStart);
});

test('A rainbow or freeze shot that hits nothing is not a match', () => {
  for (const specialType of [SPECIAL_TYPES.RAINBOW, SPECIAL_TYPES.FREEZE]) {
    const engine = createTestEngine();
    engine.startCampaignLevel(1);
    engine.physicsWorld.clear();
    engine.physicsWorld.addBall(makeBoardBall(FAR_POSITION, FAR_POSITION, { isAnchor: true }));
    const shot = makeBoardBall(OTHER_POSITION, OTHER_POSITION, { colorId: null, specialType });
    engine.physicsWorld.addBall(shot);

    let reportedMatch = null;
    const originalCleanup = engine.handlePostTurnCleanup.bind(engine);
    engine.handlePostTurnCleanup = (madeMatch, appliedFreeze) => {
      reportedMatch = madeMatch;
      originalCleanup(madeMatch, appliedFreeze);
    };

    engine.handleProjectileSnapped(shot);
    assert.equal(reportedMatch, false, `${specialType} with no target must not count as a match`);
    assert.equal(engine.score, 0, `${specialType} with no target must not score`);
    assert.equal(engine.overcharge, 0);
    assert.equal(engine.hitStopFrames, 0);
  }
});

test('Chain reactions resolve one cluster per check so a cascade plays out step by step', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  const world = engine.physicsWorld;
  const spacing = physicsConfig.ball.radius * physicsConfig.simulation.bondRestDistanceFactor;
  const buildCluster = (originX) => {
    const cluster = [0, 1, 2].map((i) => makeBoardBall(originX + i * spacing, FAR_POSITION, { isAnchor: true }));
    cluster.forEach((b) => world.addBall(b));
    world.createBond(cluster[0], cluster[1], false);
    world.createBond(cluster[1], cluster[2], false);
    return cluster;
  };
  const first = buildCluster(FAR_POSITION);
  const second = buildCluster(OTHER_POSITION);
  world.addBall(
    makeBoardBall(FAR_POSITION, OTHER_POSITION, { isAnchor: true, colorId: ballsConfig.standardColors[1].id })
  );
  world.pendingChainCandidateIds.add(first[0].id);
  world.pendingChainCandidateIds.add(second[0].id);

  engine.evaluateAutomaticChainReactions();
  assert.equal(first.some((b) => world.ballMap.has(b.id)), false, 'the first cluster goes off');
  assert.ok(second.every((b) => world.ballMap.has(b.id)), 'the second cluster waits for the next check');
  assert.ok(world.pendingChainCandidateIds.has(second[0].id));

  engine.evaluateAutomaticChainReactions();
  assert.equal(second.some((b) => world.ballMap.has(b.id)), false);
  assert.equal(engine.state, GAME_STATES.PLAYING);
});

test('An all-armored match that destroys nothing awards no points and no combo', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  const spacing = physicsConfig.ball.radius * physicsConfig.simulation.bondRestDistanceFactor;
  const armorHits = ballsConfig.clusterModifiers.armored.initialArmor;
  const cluster = [0, 1, 2].map((i) =>
    makeBoardBall(FAR_POSITION + i * spacing, FAR_POSITION, { clusterModifier: CLUSTER_MODIFIERS.ARMORED, armorHits })
  );
  cluster.forEach((b) => engine.physicsWorld.addBall(b));

  assert.equal(engine.resolveColorMatchCluster(cluster, cluster[0], false), 0);
  assert.equal(engine.score, 0);
  assert.equal(engine.combo, 0);
  assert.equal(engine.overcharge, 0);
});

test('Survival high score is persisted when the run ends, not on every score event', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  engine.addScore(1000);
  assert.equal(engine.storageManager.getEndlessHighScore(), 0);
  engine.triggerGameOver('lineCrossed');
  assert.equal(engine.storageManager.getEndlessHighScore(), 1000);

  const daily = createTestEngine();
  daily.startDailyChallenge(PAST_DAILY_SEED);
  daily.addScore(500);
  assert.equal(daily.storageManager.getDailyHighScore(PAST_DAILY_SEED), 0);
  daily.startEndlessMode();
  assert.ok(daily.storageManager.getDailyHighScore(PAST_DAILY_SEED) >= 500, 'Leaving a run persists its best');
});

test('bossSlayer achievement honors its configured threshold', () => {
  const config = structuredClone(gameConfig);
  config.achievements.bossSlayer.threshold = 2;
  const engine = createTestEngine(config);
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();

  const spawnBoss = (x) => {
    const boss = makeBoardBall(x, FAR_POSITION, { clusterModifier: CLUSTER_MODIFIERS.BOSS_CORE, armorHits: 1 });
    engine.physicsWorld.addBall(boss);
    return boss;
  };
  const keepBoardBusy = makeBoardBall(OTHER_POSITION, OTHER_POSITION, { isAnchor: true });
  engine.physicsWorld.addBall(keepBoardBusy);

  assert.equal(engine.destroyClusterBall(spawnBoss(FAR_POSITION), '#ffffff', true), true);
  assert.equal(engine.storageManager.getUnlockedAchievements().bossSlayer, undefined);
  assert.equal(engine.destroyClusterBall(spawnBoss(OTHER_POSITION), '#ffffff', true), true);
  assert.equal(engine.storageManager.getUnlockedAchievements().bossSlayer, true);
});

test('An anvil crushing a dormant bomb survives the balls the blast removes mid-pass', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(16);
  const world = engine.physicsWorld;
  // Level 16 rolls its modifiers at random; armored neighbours would survive the blast.
  for (const ball of world.balls) {
    ball.clusterModifier = null;
    ball.armorHits = 0;
  }
  // The anvil pass walks the balls from the end, so the bomb is the first one it crushes.
  const bomb = world.balls[world.balls.length - 1];
  bomb.clusterModifier = CLUSTER_MODIFIERS.DORMANT_BOMB;
  const ballsBefore = world.balls.length;
  const anvil = new Ball({
    x: bomb.x,
    y: bomb.y,
    radius: physicsConfig.ball.radius,
    colorId: null,
    specialType: SPECIAL_TYPES.ANVIL,
    isProjectile: true
  });
  anvil.vy = -physicsConfig.ball.anvilSpeed;
  world.projectile = anvil;

  assert.doesNotThrow(() => engine.update());
  assert.equal(world.ballMap.has(bomb.id), false);
  assert.ok(world.balls.length < ballsBefore - 1, 'the blast should remove neighbours of the bomb');
  assert.equal(engine.state, GAME_STATES.PLAYING);
});

test('The energy barrier turns off when the last Lock Core falls in an avalanche', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(13);
  const world = engine.physicsWorld;
  const barriers = world.obstacles.filter((obs) => obs.type === OBSTACLE_TYPES.BARRIER);
  assert.ok(barriers.length > 0, 'level 13 has a barrier');
  world.balls.length = 0;
  world.ballMap.clear();
  world.addBall(makeBoardBall(OTHER_POSITION, FAR_POSITION, { isAnchor: true }));
  // A lone Lock Core with no bond to an anchor falls on the next avalanche check.
  world.addBall(makeBoardBall(FAR_POSITION, FAR_POSITION, { clusterModifier: CLUSTER_MODIFIERS.LASER_LOCK }));

  engine.detachAndRewardAvalanche();

  assert.ok(barriers.every((obs) => obs.disabled), 'no Lock Core is left, so the barrier must be off');
});

test('A barrier without any Lock Core stays up after an avalanche', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(5);
  const world = engine.physicsWorld;
  const barriers = world.obstacles.filter((obs) => obs.type === OBSTACLE_TYPES.BARRIER);
  world.balls.length = 0;
  world.ballMap.clear();
  world.addBall(makeBoardBall(OTHER_POSITION, FAR_POSITION, { isAnchor: true }));
  world.addBall(makeBoardBall(FAR_POSITION, FAR_POSITION));

  engine.detachAndRewardAvalanche();

  assert.ok(barriers.length > 0 && barriers.every((obs) => !obs.disabled));
});

test('Launcher colors that left the board are replaced on both balls and in the stash', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const world = engine.physicsWorld;
  const [boardColor, clearedColor] = ballsConfig.standardColors.map((c) => c.id);
  world.balls.length = 0;
  world.ballMap.clear();
  world.addBall(makeBoardBall(FAR_POSITION, FAR_POSITION, { isAnchor: true, colorId: boardColor }));
  engine.currentBall.colorId = clearedColor;
  engine.nextBall.colorId = clearedColor;
  engine.stashedRegularColorId = clearedColor;

  engine.refreshStaleLauncherColors();

  assert.equal(engine.currentBall.colorId, boardColor);
  assert.equal(engine.nextBall.colorId, boardColor);
  assert.equal(engine.stashedRegularColorId, boardColor);
});

test('An anvil that crushes nothing breaks the combo and counts toward the next wave', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  const world = engine.physicsWorld;
  world.balls.length = 0;
  world.ballMap.clear();
  world.addBall(makeBoardBall(OTHER_POSITION, FAR_POSITION, { isAnchor: true }));
  engine.combo = 3;
  engine.sagLevel = 0;
  const anvil = new Ball({
    x: FAR_POSITION,
    y: engine.gameConfig.canvas.launcherY,
    radius: physicsConfig.ball.radius,
    colorId: null,
    specialType: SPECIAL_TYPES.ANVIL,
    isProjectile: true
  });
  anvil.vy = -physicsConfig.ball.anvilSpeed;
  world.projectile = anvil;
  engine.anvilCrushCount = 0;

  const maxFrames = 1000;
  for (let frame = 0; frame < maxFrames && world.projectile; frame++) {
    engine.update();
  }

  assert.equal(world.projectile, null, 'the anvil leaves the board');
  assert.equal(engine.combo, 0);
  assert.equal(engine.sagLevel, 1);
});

test('A Survival wave on a cleared board leaves no launcher color missing from the new board', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  const world = engine.physicsWorld;
  world.balls.length = 0;
  world.ballMap.clear();
  // No wave can spawn this color, so the assertion below cannot pass by luck.
  const staleColor = 'stale-test-color';
  engine.currentBall.specialType = null;
  engine.currentBall.colorId = staleColor;
  engine.nextBall.specialType = null;
  engine.nextBall.colorId = staleColor;
  engine.upcomingColorIds = engine.upcomingColorIds.map(() => staleColor);
  assert.ok(engine.upcomingColorIds.length > 0, 'the upcoming queue is part of the check');
  engine.freezeTurnsRemaining = 0;
  engine.sagLevel = getSagSpec(engine.mode, engine.gameConfig.sag, engine.gameConfig.endless).size - 1;
  const wavesBefore = engine.waveCount;

  engine.handlePostTurnCleanup(false);

  assert.equal(engine.waveCount, wavesBefore + 1, 'the cleanup spawned a wave');
  assert.ok(world.balls.length > 0, 'the wave refilled the board');
  const boardColors = new Set(world.balls.map((b) => b.colorId).filter(Boolean));
  const launcherColors = [engine.currentBall.colorId, engine.nextBall.colorId, ...engine.upcomingColorIds];
  for (const color of launcherColors) {
    assert.ok(boardColors.has(color), `launcher color ${color} must be on the board`);
  }
});

test('Coins earned while a shot is in flight are written only once the run is saved again', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const coinsBefore = engine.storageManager.getCoins();
  engine.hasFiredInRound = true;
  engine.physicsWorld.projectile = engine.currentBall;

  engine.awardRunCoins(FAR_POSITION);
  assert.equal(engine.storageManager.getCoins(), coinsBefore, 'a reload now would replay the shot');

  engine.physicsWorld.projectile = null;
  engine.saveRunSnapshot();
  assert.equal(engine.storageManager.getCoins(), coinsBefore + FAR_POSITION);
  assert.equal(engine.pendingRunCoins, 0);
});

test('A chain reaction between shots is paid once: the run stored after it has nothing left to replay', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  const world = engine.physicsWorld;
  const spacing = physicsConfig.ball.radius * physicsConfig.simulation.bondRestDistanceFactor;
  const cluster = [0, 1, 2].map((i) => makeBoardBall(FAR_POSITION + i * spacing, FAR_POSITION, { isAnchor: true }));
  cluster.forEach((b) => world.addBall(b));
  world.createBond(cluster[0], cluster[1], false);
  world.createBond(cluster[1], cluster[2], false);
  const hanging = makeBoardBall(FAR_POSITION, FAR_POSITION + spacing, { colorId: ballsConfig.standardColors[1].id });
  world.addBall(hanging);
  world.createBond(cluster[0], hanging, false);
  world.addBall(makeBoardBall(OTHER_POSITION, OTHER_POSITION, { isAnchor: true, colorId: ballsConfig.standardColors[1].id }));
  engine.hasFiredInRound = true;
  world.pendingChainCandidateIds.add(cluster[0].id);
  engine.saveRunSnapshot();
  const coinsBefore = engine.storageManager.getCoins();

  engine.evaluateAutomaticChainReactions();
  const coinsAfterChain = engine.storageManager.getCoins();
  assert.equal(coinsAfterChain, coinsBefore + gameConfig.scoring.coinsPerAvalancheBall, 'the falling sphere pays');
  const stored = engine.storageManager.loadRunSnapshot();
  assert.deepEqual(stored.pendingChainCandidateIds, [], 'the stored run no longer holds the chain');
  assert.equal(stored.balls.length, world.balls.length);

  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  assert.equal(resumed.restoreSavedRun(), true);
  resumed.evaluateAutomaticChainReactions();
  assert.equal(resumed.storageManager.getCoins(), coinsAfterChain, 'a reload does not pay the chain again');
});

test('A Flux run stored at the start of a stage is still stored once it is resumed', () => {
  const engine = createTestEngine();
  engine.startFluxRun(TEST_FLUX_SEED);
  const coinsBefore = engine.storageManager.getCoins();

  engine.completeFluxStage();
  assert.equal(engine.storageManager.getCoins(), coinsBefore, 'stage-clear coins wait for the next shape to be stored');
  while (engine.stageTransitionFrames > 0) {
    engine.update();
  }
  assert.equal(engine.storageManager.getCoins(), coinsBefore + fluxConfig.rewards.stageClearCoins);
  const stored = engine.storageManager.loadRunSnapshot();
  assert.equal(stored.engine.hasFiredInRound, false, 'stored before the first shot of the new shape');

  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  assert.equal(resumed.restoreSavedRun(), true);
  assert.notEqual(resumed.storageManager.loadRunSnapshot(), null, 'a second reload still finds the run');
  assert.equal(resumed.fluxStage, engine.fluxStage);
});

test('A special ball bought before the first shot is stored with the run', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.storageManager.setCoins(SHOP_TEST_COINS);

  assert.equal(engine.buySpecialAmmo(SPECIAL_TYPES.BOMB), true);
  const stored = engine.storageManager.loadRunSnapshot();
  assert.notEqual(stored, null, 'the debit is not kept without the ball it paid for');
  assert.equal(stored.specialInventory[SPECIAL_TYPES.BOMB], engine.specialInventory[SPECIAL_TYPES.BOMB]);

  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  assert.equal(resumed.restoreSavedRun(), true);
  assert.equal(resumed.specialInventory[SPECIAL_TYPES.BOMB], engine.specialInventory[SPECIAL_TYPES.BOMB]);
});

test('A write from another tab replaces the cached value instead of being overwritten', () => {
  const storage = new StorageManager();
  storage.init();
  const coinsKey = storage.buildKey(gameConfig.storage.keys.coins);
  const upgradesKey = storage.buildKey(gameConfig.storage.keys.upgrades);
  const otherTabCoins = 300;
  const earnedHere = 5;
  storage.getCoins();
  storage.getUpgrades();

  storage.handleExternalStorageChange({ key: coinsKey, newValue: String(otherTabCoins) });
  storage.addCoins(earnedHere);
  assert.equal(storage.getCoins(), otherTabCoins + earnedHere);

  const upgradeId = Object.keys(gameConfig.upgrades)[0];
  storage.handleExternalStorageChange({ key: upgradesKey, newValue: JSON.stringify({ [upgradeId]: 1 }) });
  assert.equal(storage.getUpgradeLevel(upgradeId), 1);

  storage.handleExternalStorageChange({ key: 'unrelated-app-key', newValue: 'x' });
  storage.handleExternalStorageChange({ key: null, newValue: null });
  assert.equal(storage.memoryFallback.size, 0, 'a storage clear in another tab drops the cache');
});

test('A Boss Core lost in an avalanche pays like a destroyed one', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const world = engine.physicsWorld;
  const bossSpec = ballsConfig.clusterModifiers.bossCore;
  world.balls.length = 0;
  world.ballMap.clear();
  world.addBall(makeBoardBall(OTHER_POSITION, FAR_POSITION, { isAnchor: true }));
  world.addBall(makeBoardBall(FAR_POSITION, FAR_POSITION, { clusterModifier: CLUSTER_MODIFIERS.BOSS_CORE, armorHits: 1 }));
  const coinsBefore = engine.storageManager.getCoins();

  engine.detachAndRewardAvalanche();

  assert.equal(engine.bossesDestroyedInRun, 1);
  assert.ok(engine.score >= bossSpec.pointsBonus);
  assert.ok(engine.storageManager.getCoins() >= coinsBefore + bossSpec.coinReward);
});

test('A zero or missing tuning value that would hang the game is rejected at load', async () => {
  const { validateConfigs } = await import('../src/core/ConfigRegistry.js');
  const configs = new Map([
    ['game', structuredClone(gameConfig)],
    ['physics', structuredClone(physicsConfig)]
  ]);
  assert.doesNotThrow(() => validateConfigs(configs));
  configs.get('game').scoring.overchargeMax = 0;
  assert.throws(() => validateConfigs(configs), /overchargeMax/);
  configs.get('game').scoring.overchargeMax = gameConfig.scoring.overchargeMax;
  delete configs.get('physics').simulation.fixedStepMs;
  assert.throws(() => validateConfigs(configs), /fixedStepMs/);
  configs.get('physics').simulation.fixedStepMs = physicsConfig.simulation.fixedStepMs;

  configs.get('physics').simulation.clusterFieldFactor = 0;
  assert.doesNotThrow(() => validateConfigs(configs), 'fields may be turned off');
  delete configs.get('physics').simulation.clusterFieldFactor;
  assert.throws(() => validateConfigs(configs), /clusterFieldFactor/);
});

test('A saved run whose values have the wrong type is discarded instead of restored', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot();
  const snapshot = engine.storageManager.loadRunSnapshot();
  snapshot.engine.score = '1200';
  engine.storageManager.saveRunSnapshot(snapshot);

  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(resumed.restoreSavedRun(), false);
  } finally {
    console.error = originalError;
  }
  assert.equal(engine.storageManager.loadRunSnapshot(), null);
  assert.notEqual(resumed.score, '01200');

  engine.saveRunSnapshot();
  const textPosition = engine.storageManager.loadRunSnapshot();
  // The fields a ball derives from its position are saved as text too, so only the type
  // check on the position itself can catch it.
  for (const field of ['x', 'prevX', 'anchorX']) {
    textPosition.balls[0][field] = '120';
  }
  engine.storageManager.saveRunSnapshot(textPosition);
  const withTextPosition = createTestEngine();
  withTextPosition.storageManager = engine.storageManager;
  console.error = () => {};
  try {
    assert.equal(withTextPosition.restoreSavedRun(), false, 'a text position is rejected like any other field');
  } finally {
    console.error = originalError;
  }
  assert.equal(engine.storageManager.loadRunSnapshot(), null);
});

test('A saved run with its discovery hint dismissed restores without it', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  assert.notEqual(engine.activeDiscoveryId, null, 'a new player gets the basics hint');
  engine.dismissDiscovery();
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot();

  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  assert.equal(resumed.restoreSavedRun(), true);
  assert.equal(resumed.activeDiscoveryId, null);
});

test('A keyboard aim step locks the aim until the mouse travels past the unlock distance', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const canvasCfg = gameConfig.canvas;
  const unlock = canvasCfg.pointerAimUnlockDistance;

  engine.updateAimFromAngle(-Math.PI / 2);
  engine.adjustAimByDelta(canvasCfg.keyboardAimFineStepRad);
  const lockedAngle = engine.aimAngle;
  assert.ok(Math.abs(lockedAngle + Math.PI / 2 - canvasCfg.keyboardAimFineStepRad) < 1e-9, 'one fine step');

  const origin = { x: 100, y: 300 };
  assert.equal(engine.followPointer(origin.x, origin.y), false, 'the first pointer position only sets the origin');
  assert.equal(engine.followPointer(origin.x + unlock, origin.y), false, 'a small movement keeps the lock');
  assert.equal(engine.aimAngle, lockedAngle);
  assert.equal(engine.followPointer(origin.x + unlock + 1, origin.y), true, 'a long movement lifts the lock');
  assert.equal(engine.isAimLocked, false);
  assert.equal(engine.followPointer(origin.x, origin.y), true, 'the pointer drives the aim again');
});

test('The fine keyboard step is smaller than the Shift step', () => {
  const canvasCfg = gameConfig.canvas;
  assert.ok(canvasCfg.keyboardAimFineStepRad > 0);
  assert.ok(canvasCfg.keyboardAimFineStepRad < canvasCfg.keyboardAimStepRad);
});

test('A new run starts with the aim unlocked', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.adjustAimByDelta(gameConfig.canvas.keyboardAimStepRad);
  assert.equal(engine.isAimLocked, true);
  engine.startCampaignLevel(1);
  assert.equal(engine.isAimLocked, false);
});

/** Lands a sphere next to a bonded neighbor of the level and returns both. */
const landBondedSphere = (engine) => {
  const neighbor = engine.physicsWorld.balls.find((b) => !b.isAnchor && b.bonds.size > 0);
  const landed = engine.physicsWorld.balls.find((b) => neighbor.bonds.has(b.id));
  engine.handleProjectileSnapped(landed, neighbor);
  return { landed, neighbor };
};

test('A landing sphere sends a drawing-only wave through its cluster, weaker one hop away', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const waveCfg = gameConfig.juice.impactWave;
  const before = engine.physicsWorld.balls.map((b) => ({ x: b.x, y: b.y }));

  const neighbor = engine.physicsWorld.balls.find((b) => !b.isAnchor && b.bonds.size > 0);
  const landed = engine.physicsWorld.balls.find((b) => neighbor.bonds.has(b.id));
  engine.startImpactWave(landed);
  assert.equal(engine.impactWave.hops.get(landed.id), 0);
  assert.equal(engine.impactWave.hops.get(neighbor.id), 1);

  let peakLanded = 1;
  let peakNeighbor = 1;
  const lastFrame = waveCfg.maxHops * waveCfg.hopDelayFrames + waveCfg.durationFrames + 1;
  for (let frame = 0; frame < lastFrame; frame++) {
    engine.updateImpactWave();
    peakLanded = Math.max(peakLanded, landed.impactScale);
    peakNeighbor = Math.max(peakNeighbor, neighbor.impactScale);
  }
  assert.ok(peakLanded > 1 && peakLanded <= 1 + waveCfg.amplitude, 'the landed sphere swells');
  assert.ok(peakNeighbor > 1 && peakNeighbor < peakLanded, 'its neighbor swells less');
  assert.equal(engine.impactWave, null, 'the wave ends');
  assert.ok(engine.physicsWorld.balls.every((b) => b.impactScale === 1), 'every sphere is back to scale');
  engine.physicsWorld.balls.forEach((b, i) => {
    assert.equal(b.x, before[i].x);
    assert.equal(b.y, before[i].y);
  });
});

test('Every landing shakes the screen a little and starts a wave, unless motion is reduced', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.particleSystem.shakeIntensity = 0;
  landBondedSphere(engine);
  assert.ok(engine.particleSystem.shakeIntensity >= gameConfig.juice.snapShake, 'a landing shakes the screen');
  assert.notEqual(engine.impactWave, null);

  const calm = createTestEngine();
  calm.setReducedMotion(true);
  calm.startCampaignLevel(1);
  landBondedSphere(calm);
  assert.equal(calm.impactWave, null, 'reduced motion keeps the cluster still');
  assert.equal(calm.particleSystem.shakeIntensity, 0);
});

test('Survival waves log their kind, and a new run starts with an empty log', () => {
  const engine = createTestEngine();
  engine.startDailyChallenge(PAST_DAILY_SEED);
  assert.deepEqual(engine.waveLog, []);
  const lastWave = gameConfig.endless.bossWaveInterval + 1;
  while (engine.waveCount < lastWave) {
    engine.spawnEndlessWave();
  }
  const expected = [];
  for (let wave = 2; wave <= lastWave; wave++) {
    expected.push(engine.getWaveType(wave));
  }
  assert.deepEqual(engine.waveLog, expected);
  assert.ok(engine.waveLog.includes(WAVE_TYPES.BOSS), 'the boss wave is logged');
  assert.ok(engine.waveLog.includes(WAVE_TYPES.GOLD_RUSH), 'the gold rush wave is logged');

  engine.restartCurrent();
  assert.deepEqual(engine.waveLog, []);
});

test('A resumed Daily run keeps its wave log, and an older save rebuilds it', () => {
  const engine = createTestEngine();
  engine.startDailyChallenge(PAST_DAILY_SEED);
  engine.spawnEndlessWave();
  engine.spawnEndlessWave();
  engine.spawnEndlessWave();
  const log = [...engine.waveLog];
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot();

  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  assert.equal(resumed.restoreSavedRun(), true);
  assert.deepEqual(resumed.waveLog, log);

  const snapshot = engine.storageManager.loadRunSnapshot();
  delete snapshot.waveLog;
  engine.storageManager.saveRunSnapshot(snapshot);
  const older = createTestEngine();
  older.storageManager = engine.storageManager;
  assert.equal(older.restoreSavedRun(), true);
  assert.deepEqual(older.waveLog, log);
});

test('A Flux stage transition refreshes launcher and stashed colors absent from the new board', () => {
  const engine = createTestEngine();
  engine.startFluxRun(TEST_FLUX_SEED);
  const absentColor = 'nonexistent-board-color';
  engine.specialInventory[SPECIAL_TYPES.BOMB] = 1;
  engine.currentBall.colorId = absentColor;
  engine.equipSpecialBall(SPECIAL_TYPES.BOMB);
  assert.equal(engine.stashedRegularColorId, absentColor);
  engine.nextBall.colorId = absentColor;
  engine.upcomingColorIds = [absentColor, absentColor];

  engine.fluxStage = 2;
  engine.buildFluxStage({ persist: true });

  const boardColors = new Set(engine.physicsWorld.balls.map((b) => b.colorId).filter(Boolean));
  assert.ok(boardColors.size > 0);
  assert.ok(boardColors.has(engine.stashedRegularColorId), 'stashed regular color is refreshed to a board color');
  assert.ok(boardColors.has(engine.nextBall.colorId), 'next launcher ball is refreshed to a board color');
  assert.ok(
    engine.upcomingColorIds.every((color) => boardColors.has(color)),
    'upcoming queue colors are refreshed to board colors'
  );
});

test('Launcher preparation actions (swap, polarity flip, equip/unequip special) persist the run snapshot', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const initialCurrentColor = ballsConfig.standardColors[0].id;
  const initialNextColor = ballsConfig.standardColors[1].id;
  engine.currentBall.colorId = initialCurrentColor;
  engine.nextBall.colorId = initialNextColor;

  engine.swapLauncherBalls();
  let snapshot = engine.storageManager.loadRunSnapshot();
  assert.ok(snapshot, 'swapLauncherBalls saves a snapshot');
  assert.equal(snapshot.currentBall.colorId, initialNextColor);
  assert.equal(snapshot.nextBall.colorId, initialCurrentColor);

  engine.togglePolarityFlip();
  snapshot = engine.storageManager.loadRunSnapshot();
  assert.equal(snapshot.engine.isPolarityFlipped, true, 'togglePolarityFlip updates the snapshot');

  engine.specialInventory[SPECIAL_TYPES.BOMB] = 1;
  engine.equipSpecialBall(SPECIAL_TYPES.BOMB);
  snapshot = engine.storageManager.loadRunSnapshot();
  assert.equal(snapshot.currentBall.specialType, SPECIAL_TYPES.BOMB, 'equipping a special ball updates the snapshot');
  assert.equal(snapshot.engine.stashedRegularColorId, initialNextColor);

  engine.equipSpecialBall(SPECIAL_TYPES.BOMB);
  snapshot = engine.storageManager.loadRunSnapshot();
  assert.equal(snapshot.currentBall.specialType, null, 'unequipping a special ball updates the snapshot');
  assert.equal(snapshot.currentBall.colorId, initialNextColor);
  assert.equal(snapshot.engine.stashedRegularColorId, null);
});

test('StorageManager floors decimal scores and stars to non-negative integers', () => {
  const storage = new StorageManager();
  storage.init();

  storage.setEndlessHighScore(1234.89);
  assert.equal(storage.getEndlessHighScore(), 1234);
  assert.equal(storage.safeGetItem(gameConfig.storage.keys.endlessHighScore), '1234');

  const { newlyEarnedStars } = storage.saveLevelResult(1, 2500.75, 2.9);
  assert.equal(newlyEarnedStars, 2);
  const stats = storage.getLevelStats();
  assert.deepEqual(stats[1], { bestScore: 2500, stars: 2 });
});

test('victorySummary computes nextStarTarget, pointsToNextStar and isNewRecord', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const thresholds = engine.getStarThresholds();
  engine.shotsRemaining = 0;
  engine.score = thresholds[1] - 500;
  engine.physicsWorld.clear();
  engine.evaluateRoundEnd();

  assert.equal(engine.state, GAME_STATES.VICTORY);
  assert.equal(engine.victorySummary.isNewRecord, false, 'first clear is not flagged as beating an existing record');
  assert.equal(engine.victorySummary.nextStarTarget, thresholds[1]);
  assert.equal(engine.victorySummary.nextStarNumber, 2);
  assert.equal(engine.victorySummary.pointsToNextStar, 500);

  // Second clear beating the stored record and reaching 3 stars
  engine.startCampaignLevel(1);
  engine.shotsRemaining = 0;
  engine.score = thresholds[2] + 1000;
  engine.physicsWorld.clear();
  engine.evaluateRoundEnd();

  assert.equal(engine.victorySummary.isNewRecord, true, 'beating a positive bestScore sets isNewRecord');
  assert.equal(engine.victorySummary.nextStarTarget, null);
  assert.equal(engine.victorySummary.nextStarNumber, null);
  assert.equal(engine.victorySummary.pointsToNextStar, 0);
});

test('gameOverSummary records remainingSpheres and detects isNewRecord before persisting high score', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const initialBalls = engine.physicsWorld.balls.length;
  assert.ok(initialBalls > 0);
  engine.score = 5000;
  engine.triggerGameOver('outOfShots');

  assert.equal(engine.gameOverSummary.remainingSpheres, initialBalls);
  assert.equal(engine.gameOverSummary.isNewRecord, false, 'Campaign defeats never flag a new record');

  // Survival mode: first run establishes a baseline record
  engine.startEndlessMode();
  assert.equal(engine.gameOverSummary, null, 'resetRunState clears gameOverSummary');
  engine.score = 1200;
  engine.triggerGameOver('lineCrossed');
  assert.equal(engine.gameOverSummary.isNewRecord, false, 'first Survival score from 0 is not flagged as beating a record');
  assert.equal(engine.storageManager.getEndlessHighScore(), 1200);

  // Second Survival run beats the 1200 record
  engine.startEndlessMode();
  engine.score = 2500;
  engine.triggerGameOver('lineCrossed');
  assert.equal(engine.gameOverSummary.isNewRecord, true, 'beating existing Endless high score sets isNewRecord');
  assert.equal(engine.storageManager.getEndlessHighScore(), 2500);
});


test('Puzzle mode enforces fixed shot budget, clamps stage index, and blocks continues and 1-shot swaps', () => {
  const engine = createTestEngine();
  const totalPuzzles = gameConfig.puzzles.length;
  engine.startPuzzleMode(totalPuzzles + 2);
  assert.equal(engine.currentPuzzleStage, 2, 'stage index wraps into [1..puzzles.length]');
  assert.equal(engine.shotsRemaining, 1, 'Puzzle stage 2 starts with 1 shot');

  engine.applyUpgradePurchase('startingShots');
  assert.equal(engine.shotsRemaining, 1, 'startingShots upgrade does not alter Puzzle shot budget');

  engine.currentBall.colorId = 'crimson';
  engine.nextBall.colorId = 'cobalt';
  engine.swapLauncherBalls();
  assert.equal(engine.currentBall.colorId, 'crimson', 'swapLauncherBalls is ignored on a 1-shot puzzle');

  engine.triggerGameOver('outOfShots');
  assert.equal(engine.canContinueOutOfShots(), false, 'Puzzle mode refuses out-of-shots continue pack');
});

test('Boss Rush Overcharge strikes the Titan and wave clear persists a snapshot', () => {
  const engine = createTestEngine();
  engine.startBossRushMode(1);
  const boss = engine.getBossBall();
  assert.equal(boss.clusterModifier, CLUSTER_MODIFIERS.MAGNETAR, 'Boss Rush wave 1 spawns a Magnetar');
  const initialMoorings = engine.getMagnetarView().moorings;
  engine.addOvercharge(gameConfig.scoring.overchargeMax);
  assert.equal(engine.getMagnetarView().moorings, initialMoorings - 1, '100% Overcharge snaps 1 Mooring');

  while (engine.bossRushWave === 1) {
    engine.addOvercharge(gameConfig.scoring.overchargeMax);
  }
  assert.equal(engine.bossRushWave, 2, 'dropping the Magnetar advances to Boss Rush wave 2');
  const snapshot = engine.storageManager.loadRunSnapshot();
  assert.ok(snapshot, 'Boss Rush wave clear force-saves a run snapshot');
  assert.equal(snapshot.engine.bossRushWave, 2);
});

const OVERCHARGE_STRIKE_MARGIN = 0.000001;
const DROPPING_BALL_COUNT = 3;
const SLOW_MO_TEST_FRAMES = 9;

/** Boss Rush wave 1 with the Magnetar held by one Mooring and Overcharge just under full. */
const createBossRushNearStrike = () => {
  const engine = createTestEngine();
  engine.startBossRushMode(1);
  const boss = engine.getBossBall();
  for (const id of engine.refreshMoorings(false).slice(1)) {
    engine.physicsWorld.removeBall(engine.physicsWorld.ballMap.get(id));
  }
  engine.refreshMoorings(false);
  engine.overcharge = gameConfig.scoring.overchargeMax - OVERCHARGE_STRIKE_MARGIN;
  return { engine, boss };
};

const makeDroppingBall = (x, y) => {
  const ball = makeBoardBall(x, y, { isDropping: true });
  ball.vy = 1;
  return ball;
};

const assertBossRushAdvancedCleanly = (engine) => {
  assert.equal(engine.bossRushWave, 2, 'the strike on the Titan advances to wave 2');
  assert.ok(engine.physicsWorld.droppingBalls.every(Boolean), 'no hole is left in the dropping balls');
  assert.equal(engine.storageManager.loadRunSnapshot().engine.bossRushWave, 2, 'the forced snapshot holds wave 2');
};

test('Boss Rush: dropping balls reaching the collector bin can strike the Titan without breaking the step', () => {
  const { engine } = createBossRushNearStrike();
  const canvasCfg = gameConfig.canvas;
  const binY = canvasCfg.logicalHeight - gameConfig.scoring.collector.zoneHeight;
  for (let i = 0; i < DROPPING_BALL_COUNT; i++) {
    engine.physicsWorld.droppingBalls.push(makeDroppingBall(FAR_POSITION + i * OTHER_POSITION / DROPPING_BALL_COUNT, binY));
  }

  assert.doesNotThrow(() => engine.update());
  assertBossRushAdvancedCleanly(engine);
});

test('Boss Rush: dropping balls captured by a singularity can strike the Titan without breaking the step', () => {
  const { engine } = createBossRushNearStrike();
  const singularity = new Obstacle(
    { type: OBSTACLE_TYPES.SINGULARITY, x: OTHER_POSITION, y: OTHER_POSITION },
    obstaclesConfig
  );
  engine.physicsWorld.obstacles.push(singularity);
  for (let i = 0; i < DROPPING_BALL_COUNT; i++) {
    engine.physicsWorld.droppingBalls.push(makeDroppingBall(OTHER_POSITION, OTHER_POSITION));
  }
  assert.doesNotThrow(() => engine.update());
  assertBossRushAdvancedCleanly(engine);
});

test('Boss Rush: an anvil crush that fills Overcharge defers the wave change and still runs the post-turn cleanup', () => {
  const { engine, boss } = createBossRushNearStrike();
  const world = engine.physicsWorld;
  const anvilCfg = ballsConfig.specialTypes.anvil;
  const minWallY = gameConfig.canvas.wallMargin + physicsConfig.ball.radius;
  const targetX = boss.x < gameConfig.canvas.logicalWidth / 2 ? gameConfig.canvas.logicalWidth - OTHER_POSITION : OTHER_POSITION;
  const target = makeBoardBall(targetX, minWallY);
  world.addBall(target);
  assert.ok(
    Math.hypot(target.x - boss.x, target.y - boss.y) > physicsConfig.ball.radius * anvilCfg.pierceRadiusFactor,
    'the crushed sphere is not the Titan itself'
  );
  const anvil = new Ball({
    x: target.x,
    y: minWallY,
    radius: physicsConfig.ball.radius,
    colorId: null,
    specialType: SPECIAL_TYPES.ANVIL,
    isProjectile: true
  });
  anvil.vy = -physicsConfig.ball.anvilSpeed;
  world.projectile = anvil;
  let cleanups = 0;
  const originalCleanup = engine.handlePostTurnCleanup.bind(engine);
  engine.handlePostTurnCleanup = (...args) => {
    cleanups++;
    originalCleanup(...args);
  };

  assert.doesNotThrow(() => engine.update());
  assert.equal(world.projectile, null, 'the anvil left the board');
  assert.equal(cleanups, 1, 'the post-turn cleanup ran once');
  assert.equal(engine.anvilCrushCount, 1);
  assertBossRushAdvancedCleanly(engine);
  assert.equal(engine.pendingRoundEnd, false);
});

test('Boss Rush: a strike outside a physics step still ends the round at once', () => {
  const { engine } = createBossRushNearStrike();
  engine.addOvercharge(gameConfig.scoring.overchargeMax);
  assert.equal(engine.bossRushWave, 2);
  assert.equal(engine.pendingRoundEnd, false);
});

test('Special slow motion never runs slower than one frame per step at 0.5x animation speed', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  engine.animationSpeed = 0.5;
  const startFrames = SLOW_MO_TEST_FRAMES;
  engine.specialSlowMoFrames = startFrames;
  engine.specialSlowMoTotalFrames = startFrames;

  engine.update();

  assert.equal(engine.specialSlowMoFrames, startFrames - 1);
});

test('The run is stored again once the last falling ball is gone', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  engine.hasFiredInRound = true;
  let saves = 0;
  const originalSave = engine.saveRunSnapshot.bind(engine);
  engine.saveRunSnapshot = (...args) => {
    saves++;
    return originalSave(...args);
  };
  engine.physicsWorld.droppingBalls.push(makeDroppingBall(FAR_POSITION, FAR_POSITION));

  engine.update();
  const savesWhileFalling = saves;
  engine.physicsWorld.droppingBalls.length = 0;
  engine.update();
  const savesOnLanding = saves;
  engine.update();

  assert.equal(savesOnLanding - savesWhileFalling, 1, 'one snapshot on the transition to no falling ball');
  assert.equal(saves, savesOnLanding, 'no further snapshot while the board stays quiet');
});

test('Cascade Drop waves stack on platforms without detached floating spheres and refill on board clear', () => {
  const engine = createTestEngine();
  engine.startCascadeMode();
  const initialCount = engine.physicsWorld.balls.length;
  assert.ok(initialCount > 0);
  assert.equal(
    engine.physicsWorld.getAnchoredBallIds().size,
    initialCount,
    'all initial Cascade spheres are anchored to the platforms'
  );

  const spawned = engine.spawnCascadeDropWave(0);
  assert.ok(spawned.length > 0, 'periodic Cascade drop wave spawns spheres onto existing columns');
  const afterWaveCount = engine.physicsWorld.balls.length;
  assert.equal(afterWaveCount, initialCount + spawned.length);
  assert.equal(
    engine.physicsWorld.getAnchoredBallIds().size,
    afterWaveCount,
    'periodic Cascade drop wave stacks onto existing rows without floating'
  );

  engine.physicsWorld.balls = [];
  engine.physicsWorld.ballMap.clear();
  engine.cascadeTurnsUntilDrop = 1;
  engine.evaluateRoundEnd();
  assert.equal(engine.state, GAME_STATES.PLAYING, 'Cascade continues on board clear instead of stalling');
  assert.equal(engine.cascadeTurnsUntilDrop, gameConfig.cascade.shotsBeforeDrop);
  assert.equal(engine.physicsWorld.balls.length, initialCount, 'empty Cascade board spawns a fresh multi-row wave');
});

test('Puzzle 4 initial spheres rest on the center shelf and RunSnapshot restores puzzleQueue', () => {
  const engine = createTestEngine();
  engine.startPuzzleMode(4);
  assert.equal(engine.physicsWorld.balls.length, 3);
  assert.equal(
    engine.physicsWorld.getAnchoredBallIds().size,
    3,
    'Puzzle 4 initial spheres are supported by the shelf at frame 0'
  );

  engine.saveRunSnapshot({ force: true });
  const restored = engine.restoreSavedRun();
  assert.equal(restored, true);
  assert.equal(
    engine.puzzleQueue.length,
    engine.upcomingColorIds.length,
    'applyRunSnapshot synchronizes puzzleQueue with upcomingColorIds'
  );
});

test('Blitz mode uses Blitz descent geometry and does not unlock Survival wave achievements', () => {
  const engine = createTestEngine();
  engine.startBlitzMode();
  const minYBefore = Math.min(...engine.physicsWorld.balls.map((b) => b.y));
  engine.waveCount = 9;
  engine.spawnEndlessWave();
  const maxYAfter = Math.max(...engine.physicsWorld.balls.map((b) => b.y));
  assert.ok(maxYAfter >= minYBefore + gameConfig.blitz.descentStepY - 1, 'Blitz wave advances by blitz.descentStepY');
  assert.equal(
    Boolean(engine.storageManager.getUnlockedAchievements().survivorWave10),
    false,
    'Blitz wave 10 does not unlock the Survival wave 10 achievement'
  );
});

test('Boss Rush respawns inner guard ring when only the Boss Core remains on the board', () => {
  const engine = createTestEngine();
  engine.startBossRushMode(1);
  // A Boss Rush board now starts with a Magnetar; the Boss Core path stays for runs saved before
  // Magnetars, so this board is turned into that legacy shape.
  const boss = engine.getBossBall();
  engine.clearMagnetar();
  boss.clusterModifier = CLUSTER_MODIFIERS.BOSS_CORE;
  boss.isAnchor = true;
  boss.colorId = ballsConfig.standardColors[0].id;
  boss.armorHits = ballsConfig.clusterModifiers.bossCore.initialArmor;
  engine.physicsWorld.balls = [boss];
  engine.physicsWorld.bonds = [];
  engine.evaluateRoundEnd();
  assert.ok(engine.physicsWorld.balls.length > 1, 'stranded Boss Core respawns its inner guard ring');
});

const GOLDEN_DAILY_DATE = '2025-03-14';
const GOLDEN_WAVES = 2;
const GOLDEN_COORD_DECIMALS = 3;
// Captured from spawnEndlessWave before the shiftClusterDown extraction: [x, y, anchorY, isAnchor, colorId].
const GOLDEN_WAVE_BALLS = [
  [53.2, 171, 171, 0, "crimson"],
  [93.6, 171, 171, 0, "crimson"],
  [134, 171, 171, 0, "violet"],
  [174.4, 171, 171, 0, "emerald"],
  [214.8, 171, 171, 0, "violet"],
  [255.2, 171, 171, 0, "crimson"],
  [295.6, 171, 171, 0, "cobalt"],
  [336, 171, 171, 0, "violet"],
  [376.4, 171, 171, 0, "violet"],
  [416.8, 171, 171, 0, "emerald"],
  [63.2, 211, 211, 0, "amber"],
  [103.6, 211, 211, 0, "violet"],
  [144, 211, 211, 0, "crimson"],
  [184.4, 211, 211, 0, "crimson"],
  [224.8, 211, 211, 0, "violet"],
  [265.2, 211, 211, 0, "crimson"],
  [305.6, 211, 211, 0, "cobalt"],
  [346, 211, 211, 0, "crimson"],
  [386.4, 211, 211, 0, "cobalt"],
  [426.8, 211, 211, 0, "violet"],
  [53.2, 251, 251, 0, "amber"],
  [93.6, 251, 251, 0, "cobalt"],
  [134, 251, 251, 0, "cobalt"],
  [174.4, 251, 251, 0, "emerald"],
  [214.8, 251, 251, 0, "crimson"],
  [255.2, 251, 251, 0, "cobalt"],
  [295.6, 251, 251, 0, "violet"],
  [336, 251, 251, 0, "crimson"],
  [376.4, 251, 251, 0, "cobalt"],
  [416.8, 251, 251, 0, "crimson"],
  [63.2, 291, 291, 0, "cobalt"],
  [103.6, 291, 291, 0, "violet"],
  [144, 291, 291, 0, "emerald"],
  [184.4, 291, 291, 0, "amber"],
  [224.8, 291, 291, 0, "amber"],
  [265.2, 291, 291, 0, "violet"],
  [305.6, 291, 291, 0, "cobalt"],
  [346, 291, 291, 0, "emerald"],
  [386.4, 291, 291, 0, "crimson"],
  [426.8, 291, 291, 0, "cobalt"],
  [53.2, 331, 331, 0, "violet"],
  [93.6, 331, 331, 0, "cobalt"],
  [134, 331, 331, 0, "cobalt"],
  [174.4, 331, 331, 0, "violet"],
  [214.8, 331, 331, 0, "emerald"],
  [255.2, 331, 331, 0, "crimson"],
  [295.6, 331, 331, 0, "emerald"],
  [336, 331, 331, 0, "cobalt"],
  [376.4, 331, 331, 0, "emerald"],
  [416.8, 331, 331, 0, "crimson"],
  [283, 421, 421, 1, "violet"],
  [259, 462.569, 462.569, 1, "crimson"],
  [211, 462.569, 462.569, 1, "emerald"],
  [187, 421, 421, 1, "crimson"],
  [211, 379.431, 379.431, 1, "amber"],
  [259, 379.431, 379.431, 1, "amber"],
  [63.2, 133, 133, 0, "cobalt"],
  [103.6, 133, 133, 0, "violet"],
  [144, 133, 133, 0, "crimson"],
  [184.4, 133, 133, 0, "emerald"],
  [224.8, 133, 133, 0, "amber"],
  [265.2, 133, 133, 0, "amber"],
  [305.6, 133, 133, 0, "emerald"],
  [346, 133, 133, 0, "crimson"],
  [386.4, 133, 133, 0, "crimson"],
  [426.8, 133, 133, 0, "cobalt"],
  [53.2, 95, 95, 0, "crimson"],
  [93.6, 95, 95, 0, "amber"],
  [134, 95, 95, 1, "crimson"],
  [174.4, 95, 95, 0, "violet"],
  [214.8, 95, 95, 0, "violet"],
  [255.2, 95, 95, 1, "crimson"],
  [295.6, 95, 95, 0, null],
  [336, 95, 95, 0, "emerald"],
  [376.4, 95, 95, 1, "amber"],
  [416.8, 95, 95, 0, "cobalt"]
];
const GOLDEN_WAVE_OBSTACLES = [["singularity", 575, 575], ["singularity", 575, 575], ["pivot", 421, 421], ["portal", 510, 510], ["portal", 88, 88]];

test('spawnEndlessWave produces the same board before and after the shiftClusterDown extraction', () => {
  const engine = createTestEngine();
  engine.startDailyChallenge(GOLDEN_DAILY_DATE, true);
  for (let i = 0; i < GOLDEN_WAVES; i++) {
    engine.spawnEndlessWave();
  }
  const scale = 10 ** GOLDEN_COORD_DECIMALS;
  const round = (v) => Math.round(v * scale) / scale;
  const balls = engine.physicsWorld.balls.map((b) => [round(b.x), round(b.y), round(b.anchorY), b.isAnchor ? 1 : 0, b.colorId]);
  const obstacles = engine.physicsWorld.obstacles.map((o) => [o.type, round(o.y), round(o.baseY ?? 0)]);
  assert.deepEqual(balls, GOLDEN_WAVE_BALLS);
  assert.deepEqual(obstacles, GOLDEN_WAVE_OBSTACLES);
});

test('Survival: a full run of whiffs spawns exactly one wave and resets the meter', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  engine.freezeTurnsRemaining = 0;
  const { size } = getSagSpec(engine.mode, engine.gameConfig.sag, engine.gameConfig.endless);
  const wavesBefore = engine.waveCount;
  for (let i = 0; i < size - 1; i++) {
    engine.handlePostTurnCleanup(false);
    assert.equal(engine.waveCount, wavesBefore);
  }
  engine.handlePostTurnCleanup(false);
  assert.equal(engine.waveCount, wavesBefore + 1);
  assert.equal(engine.sagLevel, 0);
});

test('A match is neutral for the Sag meter', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  engine.freezeTurnsRemaining = 0;
  engine.sagLevel = 2;
  engine.handlePostTurnCleanup(true);
  assert.equal(engine.sagLevel, 2);
});

test('Survival avalanche drains the meter when the sag config enables it', () => {
  const sagCfg = { modes: { endless: { size: 5, dropsPerDrain: 4, maxDrainPerTurn: 1, step: 'wave' } }, warnAt: 1 };
  const engine = createTestEngine({ ...gameConfig, sag: sagCfg });
  engine.startEndlessMode();
  engine.freezeTurnsRemaining = 0;
  engine.sagLevel = 3;
  const world = engine.physicsWorld;
  world.balls.length = 0;
  world.ballMap.clear();
  world.addBall(makeBoardBall(OTHER_POSITION, FAR_POSITION, { isAnchor: true }));
  const dropCount = 4;
  for (let i = 0; i < dropCount; i++) {
    world.addBall(makeBoardBall(OTHER_POSITION + 50 * i, FAR_POSITION + 200, { isAnchor: false }));
  }
  engine.handlePostTurnCleanup(false);
  assert.equal(engine.sagLevel, 2);
});

test('lowerAnchorRail moves the cluster by one step, keeps the ceiling anchored and leaves fixtures alone', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  const world = engine.physicsWorld;
  const anchorsBefore = world.balls.filter((b) => b.isAnchor).map((b) => [b.id, b.y]);
  const platform = new Obstacle({ type: OBSTACLE_TYPES.PLATFORM, x: 100, y: 300 }, obstaclesConfig);
  world.obstacles.push(platform);
  const platformY = platform.y;
  const stepY = engine.gameConfig.classic?.descentStepY ?? engine.gameConfig.endless.descentStepY;
  engine.lowerAnchorRail();
  assert.equal(engine.railDrops, 1);
  assert.equal(platform.y, platformY);
  assert.ok(anchorsBefore.length > 0);
  for (const [id, y] of anchorsBefore) {
    const ball = world.ballMap.get(id);
    assert.equal(ball.y, y + stepY);
    assert.equal(ball.isAnchor, true);
  }
  assert.equal(engine.getSagState().railDrops, 1);
});

test('Daily sag timelines are identical across two runs of the same seed', () => {
  const run = () => {
    const engine = createTestEngine();
    engine.startDailyChallenge(GOLDEN_DAILY_DATE, true);
    engine.freezeTurnsRemaining = 0;
    const timeline = [];
    const turns = 12;
    for (let i = 0; i < turns; i++) {
      engine.handlePostTurnCleanup(i % 4 === 3);
      timeline.push([engine.sagLevel, engine.waveCount, engine.score]);
    }
    return timeline;
  };
  assert.deepEqual(run(), run());
});
