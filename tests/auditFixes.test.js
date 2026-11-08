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
import { GameEngine } from '../src/game/GameEngine.js';
import { GAME_MODES, GAME_STATES, SPECIAL_TYPES, CLUSTER_MODIFIERS, DAILY_MUTATORS, OBSTACLE_TYPES } from '../src/core/Constants.js';
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

const SHOP_TEST_COINS = 500;
const FLUX_TEST_SEED = 'tilt01';
const PAST_DAILY_SEED = '2025-01-01';
const DAILY_SEARCH_MAX_DAYS = 60;
const DAILY_SEARCH_SEED_PREFIX = '2026-12-';
const EXPECTED_PAIR_OBSTACLE_COUNT = 2;
const EXPECTED_PUZZLE_STAGE_COUNT = 10;
const MIN_PUZZLE_CLUSTER_BALLS = 3;
const STAGE_10_ROTOR_ANCHORS = 3;
const FALLING_BALL_Y = 400;
const FALLING_BALL_X = 150;
const TILT_TEST_SHARE = 0.5;
const OVERCHARGE_STRIKES = 2;
const TRANSITION_TEST_FRAMES = 5;

const createTestEngine = () => {
  const storageManager = new StorageManager();
  storageManager.init();
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

const makeProjectile = () =>
  new Ball({
    x: FALLING_BALL_X,
    y: FALLING_BALL_Y,
    radius: physicsConfig.ball.radius,
    colorId: ballsConfig.standardColors[0].id,
    isProjectile: true
  });

const makeFallingBall = () => {
  const ball = new Ball({
    x: FALLING_BALL_X,
    y: FALLING_BALL_Y,
    radius: physicsConfig.ball.radius,
    colorId: ballsConfig.standardColors[0].id,
    isDropping: true
  });
  ball.vy = 1;
  return ball;
};

/** A fresh engine resuming the run another engine stored. */
const resumeFrom = (engine) => {
  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  assert.equal(resumed.restoreSavedRun(), true);
  return resumed;
};

const getBoss = (engine) => engine.physicsWorld.balls.find((b) => b.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE);

const getWaveArmor = (wave) => {
  const cfg = gameConfig.bossRush;
  return Math.min(cfg.maxBossArmor, cfg.baseBossArmor + (wave - 1) * cfg.armorStepPerWave);
};

test('B1: special ammo is refused with no debit while a shot is in flight', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.storageManager.setCoins(SHOP_TEST_COINS);
  engine.physicsWorld.projectile = makeProjectile();
  const stock = engine.specialInventory[SPECIAL_TYPES.BOMB];

  assert.equal(engine.canBuySpecialAmmo(), false);
  assert.equal(engine.getSpecialAmmoBlockReason(), 'shotInFlight');
  assert.equal(engine.buySpecialAmmo(SPECIAL_TYPES.BOMB), false);
  assert.equal(engine.storageManager.getCoins(), SHOP_TEST_COINS);
  assert.equal(engine.specialInventory[SPECIAL_TYPES.BOMB], stock);

  engine.physicsWorld.projectile = null;
  assert.equal(engine.canBuySpecialAmmo(), true);
  assert.equal(engine.getSpecialAmmoBlockReason(), null);
  assert.equal(engine.buySpecialAmmo(SPECIAL_TYPES.BOMB), true);
});

test('B1: special ammo is refused during a Flux stage change and a pending perk choice', () => {
  const engine = createTestEngine();
  engine.startFluxRun(FLUX_TEST_SEED);
  engine.storageManager.setCoins(SHOP_TEST_COINS);

  engine.stageTransitionFrames = TRANSITION_TEST_FRAMES;
  assert.equal(engine.canBuySpecialAmmo(), false);
  assert.equal(engine.getSpecialAmmoBlockReason(), 'stageChanging');
  assert.equal(engine.buySpecialAmmo(SPECIAL_TYPES.BOMB), false);

  engine.stageTransitionFrames = 0;
  engine.fluxPerkOffer = [Object.keys(fluxConfig.perks.catalog)[0]];
  assert.equal(engine.canBuySpecialAmmo(), false);
  assert.equal(engine.getSpecialAmmoBlockReason(), 'perkChoice');
  assert.equal(engine.storageManager.getCoins(), SHOP_TEST_COINS);
});

test('B1: a startingShots purchase is refused while the run cannot be saved, with no change to the run', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.physicsWorld.projectile = makeProjectile();
  assert.equal(engine.canBuyUpgrade('startingShots'), false);
  assert.equal(engine.canBuyUpgrade('laserSight'), true, 'an upgrade that leaves the run alone is never held');

  engine.physicsWorld.projectile = null;
  assert.equal(engine.canBuyUpgrade('startingShots'), true);
});

test('B1: a startingShots purchase is never held outside a run', () => {
  const engine = createTestEngine();
  assert.equal(engine.canBuyUpgrade('startingShots'), true);
});

test('B1: a startingShots bonus bought between shots applies and is stored at once', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const shotsBefore = engine.shotsRemaining;
  engine.applyUpgradePurchase('startingShots');
  assert.equal(engine.shotsRemaining, shotsBefore + gameConfig.upgrades.startingShots.shotsPerLevel);
  assert.equal(engine.storageManager.loadRunSnapshot().engine.shotsRemaining, engine.shotsRemaining);
});

test('B4 and B6: a wave cleared mid-shot waits for the shot, keeps falling balls and spares the next boss', () => {
  const engine = createTestEngine();
  engine.startBossRushMode(1);
  const world = engine.physicsWorld;
  getBoss(engine).armorHits = 1;
  const projectile = makeProjectile();
  const falling = makeFallingBall();
  world.projectile = projectile;
  world.droppingBalls.push(falling);
  engine.overcharge = 0;

  engine.addOvercharge(gameConfig.scoring.overchargeMax * OVERCHARGE_STRIKES);

  assert.equal(engine.bossRushWave, 1, 'the next wave waits for the shot in flight');
  assert.equal(engine.pendingBossRushWave, true);
  assert.equal(world.projectile, projectile, 'the shot in flight survives');
  assert.ok(world.droppingBalls.includes(falling), 'the falling ball survives');
  assert.equal(getBoss(engine), undefined, 'no new boss exists to be struck by the remaining iteration');
  assert.equal(engine.canBuySpecialAmmo(), false);
  assert.equal(engine.getSpecialAmmoBlockReason(), 'shotInFlight');

  world.projectile = null;
  engine.update();

  assert.equal(engine.bossRushWave, 2);
  assert.equal(engine.pendingBossRushWave, false);
  assert.ok(world.droppingBalls.includes(falling), 'the new wave keeps the falling ball');
  assert.equal(getBoss(engine).armorHits, getWaveArmor(2), 'the new boss was not struck');
});

test('B6: overcharge left over after a wave change does not strike the next boss', () => {
  const engine = createTestEngine();
  engine.startBossRushMode(1);
  getBoss(engine).armorHits = 1;
  engine.overcharge = 0;

  engine.addOvercharge(gameConfig.scoring.overchargeMax * OVERCHARGE_STRIKES);

  assert.equal(engine.bossRushWave, 2);
  assert.equal(getBoss(engine).armorHits, getWaveArmor(2));
});

test('B4: clearing the world can keep the falling balls and still bumps the clear epoch', () => {
  const engine = createTestEngine();
  engine.startBossRushMode(1);
  const world = engine.physicsWorld;
  world.droppingBalls.push(makeFallingBall());
  const epoch = world.clearEpoch;

  world.clear({ keepDroppingBalls: true });
  assert.equal(world.droppingBalls.length, 1);
  assert.equal(world.clearEpoch, epoch + 1);

  world.clear();
  assert.equal(world.droppingBalls.length, 0);
});

test('B7: tilt is ignored in Daily runs and in shared-seed Flux runs only', () => {
  const engine = createTestEngine();
  engine.startDailyChallenge(PAST_DAILY_SEED, true);
  assert.equal(engine.isTiltLocked(), true);
  engine.setTilt(TILT_TEST_SHARE);
  assert.equal(engine.physicsWorld.tiltFactor, 0);

  engine.startFluxRun(FLUX_TEST_SEED, { isShared: true });
  assert.equal(engine.isTiltLocked(), true);
  engine.setTilt(TILT_TEST_SHARE);
  assert.equal(engine.physicsWorld.tiltFactor, 0);

  engine.startFluxRun(FLUX_TEST_SEED);
  assert.equal(engine.isTiltLocked(), false, 'a run not started from a link keeps the tilt');
  engine.setTilt(TILT_TEST_SHARE);
  assert.ok(engine.physicsWorld.tiltFactor > 0);
});

test('B7: the tilt resets at every run start', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  engine.setTilt(TILT_TEST_SHARE);
  assert.ok(engine.physicsWorld.tiltFactor > 0);

  engine.startDailyChallenge(PAST_DAILY_SEED, true);
  assert.equal(engine.physicsWorld.tiltFactor, 0);
});

test('B7: a shared Flux run stays tilt-locked after a reload, and a run saved before the flag restores unlocked', () => {
  const engine = createTestEngine();
  engine.startFluxRun(FLUX_TEST_SEED, { isShared: true });
  engine.saveRunSnapshot({ force: true });
  assert.equal(engine.storageManager.loadRunSnapshot().engine.isSharedFluxRun, true);

  const resumed = resumeFrom(engine);
  assert.equal(resumed.isTiltLocked(), true);
  assert.equal(resumed.state, GAME_STATES.PAUSED);

  const veteran = engine.storageManager.loadRunSnapshot();
  delete veteran.engine.isSharedFluxRun;
  engine.storageManager.saveRunSnapshot(veteran);
  const veteranResumed = resumeFrom(engine);
  assert.equal(veteranResumed.mode, GAME_MODES.FLUX);
  assert.equal(veteranResumed.isTiltLocked(), false);
});

test('A Boss Rush snapshot saved before the audit fixes restores, and the transient wave flag is never stored', () => {
  const engine = createTestEngine();
  engine.startBossRushMode(1);
  engine.saveRunSnapshot({ force: true });
  const veteran = engine.storageManager.loadRunSnapshot();
  assert.equal('pendingBossRushWave' in veteran.engine, false);

  const resumed = resumeFrom(engine);
  assert.equal(resumed.mode, GAME_MODES.BOSS_RUSH);
  assert.equal(resumed.pendingBossRushWave, false);
});

test('B4: a wave waiting for the shot is cleared by a restart and by a mode switch', () => {
  const engine = createTestEngine();
  engine.startBossRushMode(1);
  engine.pendingBossRushWave = true;
  engine.restartCurrent();
  assert.equal(engine.pendingBossRushWave, false, 'restart');

  engine.pendingBossRushWave = true;
  engine.startEndlessMode();
  assert.equal(engine.pendingBossRushWave, false, 'mode switch');
});

test('B4: a Boss Rush wave held for the shot spawns when that shot lands through the real path', () => {
  const engine = createTestEngine();
  engine.startBossRushMode(1);
  const world = engine.physicsWorld;
  getBoss(engine).armorHits = 1;
  world.projectile = makeProjectile();
  engine.overcharge = 0;
  engine.addOvercharge(gameConfig.scoring.overchargeMax * OVERCHARGE_STRIKES);
  assert.equal(engine.pendingBossRushWave, true);
  assert.equal(engine.bossRushWave, 1);

  // The shot snaps: the physics step clears the projectile, then reports the landing.
  const shot = makeProjectile();
  shot.isProjectile = false;
  shot.colorId = ballsConfig.standardColors[0].id;
  world.projectile = null;
  world.addBall(shot);
  engine.handleProjectileSnapped(shot);

  assert.equal(engine.bossRushWave, 2, 'the post-turn evaluation spawns the next wave');
  assert.equal(engine.pendingBossRushWave, false);
  assert.equal(getBoss(engine).armorHits, getWaveArmor(2));
});

test('Paint Core radius scales with the blast radius multiplier', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const world = engine.physicsWorld;
  world.clear();

  const r = physicsConfig.ball.radius;
  const paintSpec = ballsConfig.clusterModifiers.paintCore;
  const maxUpgradeLevel = gameConfig.upgrades.blastRadius.maxLevel;
  engine.storageManager.safeSetItem(gameConfig.storage.keys.upgrades, JSON.stringify({ blastRadius: maxUpgradeLevel }));
  engine.storageManager.upgradesCache = null;
  const mult = engine.getBlastRadiusMultiplier();
  assert.ok(mult > 1);

  const coreColor = ballsConfig.standardColors[0].id;
  const otherColor = ballsConfig.standardColors[1].id;
  const core = new Ball({
    x: FALLING_BALL_X,
    y: FALLING_BALL_Y,
    radius: r,
    colorId: coreColor,
    clusterModifier: CLUSTER_MODIFIERS.PAINT_CORE
  });
  // Place target outside base radius but inside amplified radius.
  const dist = r * paintSpec.paintRadiusFactor * (1 + mult) * TILT_TEST_SHARE;
  const target = new Ball({ x: FALLING_BALL_X + dist, y: FALLING_BALL_Y, radius: r, colorId: otherColor });
  world.addBall(core);
  world.addBall(target);

  engine.destroyClusterBall(core, paintSpec.highlight, true);
  assert.equal(target.colorId, coreColor, 'amplified Paint Core repaints sphere beyond base radius');
});

test('collectorMagnet upgrade increases collector bin bonus points and overcharge', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const basePts = gameConfig.scoring.collector.bonusPointsPerBall;
  const baseOc = gameConfig.scoring.collector.overchargePerBall;
  assert.equal(engine.getCollectorBonusPoints(), basePts);
  assert.equal(engine.getCollectorOvercharge(), baseOc);

  const spec = gameConfig.upgrades.collectorMagnet;
  engine.storageManager.safeSetItem(
    gameConfig.storage.keys.upgrades,
    JSON.stringify({ collectorMagnet: spec.maxLevel })
  );
  engine.storageManager.upgradesCache = null;

  const expectedPts = basePts + spec.maxLevel * spec.pointsBonusPerLevel;
  const expectedOc = baseOc + spec.maxLevel * spec.overchargeBonusPerLevel;
  assert.equal(engine.getCollectorBonusPoints(), expectedPts);
  assert.equal(engine.getCollectorOvercharge(), expectedOc);

  const scoreBefore = engine.score;
  engine.overcharge = 0;
  engine.getStepCallbacks().onCollectorBinPass({ x: FALLING_BALL_X });
  assert.equal(engine.score, scoreBefore + expectedPts);
  assert.equal(engine.overcharge, expectedOc);
});

test('Daily Challenge supports portalMatrix, bumperPinball, cryoSurge, and session-first mutator intro banner', () => {
  const engine = createTestEngine();
  engine.storageManager.markDiscovered(gameConfig.onboarding.order);

  engine.startDailyChallenge(PAST_DAILY_SEED, false);
  assert.deepEqual(engine.levelIntro, {
    dailySeed: PAST_DAILY_SEED,
    mutatorKey: engine.activeMutatorKey
  });
  engine.startDailyChallenge(PAST_DAILY_SEED, false);
  assert.equal(engine.levelIntro, null, 'same daily seed is only introduced once per session');

  // Verify obstacle mutators by finding seeds that select portalMatrix and bumperPinball, or testing config keys.
  assert.ok(gameConfig.daily.mutators[DAILY_MUTATORS.PORTAL_MATRIX].portalPair);
  assert.ok(gameConfig.daily.mutators[DAILY_MUTATORS.BUMPER_PINBALL].bumperPair);
  assert.ok(gameConfig.daily.mutators[DAILY_MUTATORS.CRYO_SURGE].extraCoreWeight > 0);

  let foundPortal = false;
  let foundBumper = false;
  for (let day = 1; day <= DAILY_SEARCH_MAX_DAYS && (!foundPortal || !foundBumper); day++) {
    const seed = `${DAILY_SEARCH_SEED_PREFIX}${String(day).padStart(EXPECTED_PAIR_OBSTACLE_COUNT, '0')}`;
    engine.startDailyChallenge(seed, true);
    if (engine.activeMutatorKey === DAILY_MUTATORS.PORTAL_MATRIX) {
      const portals = engine.physicsWorld.obstacles.filter((o) => o.type === OBSTACLE_TYPES.PORTAL);
      assert.equal(portals.length, EXPECTED_PAIR_OBSTACLE_COUNT);
      foundPortal = true;
    } else if (engine.activeMutatorKey === DAILY_MUTATORS.BUMPER_PINBALL) {
      const bumpers = engine.physicsWorld.obstacles.filter((o) => o.type === OBSTACLE_TYPES.BUMPER);
      assert.equal(bumpers.length, EXPECTED_PAIR_OBSTACLE_COUNT);
      foundBumper = true;
    }
  }
  assert.ok(foundPortal, 'a daily seed selects portalMatrix and spawns two linked portals');
  assert.ok(foundBumper, 'a daily seed selects bumperPinball and spawns two bumpers');
});

test('All 10 Puzzle stages build valid anchored boards and Stage 10 attaches rotor anchors to the pivot obstacle', () => {
  const engine = createTestEngine();
  assert.equal(gameConfig.puzzles.length, EXPECTED_PUZZLE_STAGE_COUNT);
  for (let stage = 1; stage <= gameConfig.puzzles.length; stage++) {
    engine.startPuzzleMode(stage);
    assert.equal(engine.currentPuzzleStage, stage);
    assert.ok(
      engine.physicsWorld.balls.length >= MIN_PUZZLE_CLUSTER_BALLS,
      `Puzzle stage ${stage} spawns cluster balls`
    );
    const hasPlatform = engine.physicsWorld.obstacles.some((o) => o.type === OBSTACLE_TYPES.PLATFORM);
    if (!hasPlatform) {
      assert.equal(
        engine.physicsWorld.getAnchoredBallIds().size,
        engine.physicsWorld.balls.length,
        `Puzzle stage ${stage} anchors all balls at frame 0`
      );
    }
  }
  const stage10Pivots = engine.physicsWorld.obstacles.filter((o) => o.type === OBSTACLE_TYPES.PIVOT);
  assert.equal(stage10Pivots.length, 1);
  const rotorAnchors = engine.physicsWorld.balls.filter((b) => b.pivotRef === stage10Pivots[0]);
  assert.equal(
    rotorAnchors.length,
    STAGE_10_ROTOR_ANCHORS,
    'Stage 10 attaches its 3 inner anchors to the central rotor'
  );
});
