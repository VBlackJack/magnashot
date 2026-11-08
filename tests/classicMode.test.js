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
import { Obstacle } from '../src/entities/Obstacle.js';
import { captureRunSnapshot, isValidRunSnapshot, applyRunSnapshot } from '../src/game/RunSnapshot.js';
import { GAME_MODES, GAME_STATES, GAME_OVER_REASONS, OBSTACLE_TYPES, SPECIAL_TYPES } from '../src/core/Constants.js';
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
configRegistry.configs.set('flux', fluxConfig);

const classicCfg = gameConfig.classic;
const SNAPSHOT_VERSION = 1;
const MULBERRY_INCREMENT = 0x6d2b79f5;
const MULBERRY_SHIFT_A = 15;
const MULBERRY_SHIFT_B = 7;
const MULBERRY_SHIFT_C = 14;
const MULBERRY_MIX = 61;
const UINT32_RANGE = 4294967296;
const RANDOM_SEED = 20260;
const MAX_SHOT_FRAMES = 2000;
const SCRIPTED_ANGLES = [-1.9, -1.3, -1.57, -1.2, -1.8, -1.45, -1.7, -1.35, -1.6, -1.25];
const MAXED_UPGRADE_LEVEL = 5;
const MANY_DRAWS = 57;
const SAVED_SAG_LEVEL = 3;
const SAVED_RAIL_DROPS = 2;
const SAVED_SCORE = 4321;
const LEGACY_SHOTS_UNTIL_WAVE = 2;
const PLATFORM_X = 100;
const PLATFORM_Y = 300;
const PIVOT_X = 200;
const PIVOT_Y = 200;
const PIVOT_RADIUS = 60;
const TILT_SHARE = 0.5;
const RICH_COINS = 1000000;
const OVERCHARGE_BURSTS = 3;
const FAR_STAGE = 1000;

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

const boardSignature = (engine) =>
  engine.physicsWorld.balls.map((b) => [b.x, b.y, b.colorId, b.clusterModifier, b.isAnchor]);

/** Small deterministic generator standing in for Math.random (launcher draws are unseeded). */
const createGenerator = (seed) => {
  let state = seed;
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> MULBERRY_SHIFT_A), z | 1);
    z ^= z + Math.imul(z ^ (z >>> MULBERRY_SHIFT_B), z | MULBERRY_MIX);
    return ((z ^ (z >>> MULBERRY_SHIFT_C)) >>> 0) / UINT32_RANGE;
  };
};

const withFixedRandom = (seed, run) => {
  const original = Math.random;
  Math.random = createGenerator(seed);
  try {
    return run();
  } finally {
    Math.random = original;
  }
};

const clearBoard = (engine) => {
  for (const ball of [...engine.physicsWorld.balls]) {
    engine.physicsWorld.removeBall(ball);
  }
};

/** Plays the scripted shots; returns the per-shot [sagLevel, score, spheres, railDrops] timeline. */
const playScriptedShots = (engine) => {
  const timeline = [];
  for (const angle of SCRIPTED_ANGLES) {
    if (engine.state !== GAME_STATES.PLAYING) {
      break;
    }
    engine.updateAimFromAngle(angle);
    engine.shoot();
    for (let frame = 0; frame < MAX_SHOT_FRAMES && engine.state === GAME_STATES.PLAYING; frame++) {
      engine.update();
      if (!engine.physicsWorld.projectile) {
        break;
      }
    }
    timeline.push([engine.sagLevel, engine.score, engine.physicsWorld.balls.length, engine.railDrops]);
  }
  return timeline;
};

test('Classic starts on a seeded stage board: full anchored ceiling, no modifiers, no obstacles', () => {
  const engine = createTestEngine();
  engine.startClassicMode();
  assert.equal(engine.mode, GAME_MODES.CLASSIC);
  assert.equal(engine.state, GAME_STATES.PLAYING);
  assert.equal(engine.classicStage, 1);
  const balls = engine.physicsWorld.balls;
  assert.equal(balls.length, classicCfg.baseRows * classicCfg.columns);
  assert.equal(balls.filter((b) => b.isAnchor).length, classicCfg.columns);
  assert.ok(balls.every((b) => b.clusterModifier === null));
  assert.equal(engine.physicsWorld.obstacles.length, 0);
  assert.equal(engine.activePalette.length, classicCfg.basePalette);
});

test('Classic stages grow by one row up to the cap and add a color every other stage', () => {
  const engine = createTestEngine();
  const lastCappedStage = classicCfg.maxRows - classicCfg.baseRows + 1;
  engine.startClassicMode(lastCappedStage + 1);
  assert.equal(engine.physicsWorld.balls.length, classicCfg.maxRows * classicCfg.columns);
  engine.startClassicMode(1 + classicCfg.paletteStepStages);
  assert.equal(engine.activePalette.length, classicCfg.basePalette + 1);
  engine.startClassicMode(FAR_STAGE);
  assert.equal(engine.activePalette.length, classicCfg.maxPalette);
});

test('A Classic stage board is the same whatever was drawn before it', () => {
  const build = (draws) => {
    const engine = createTestEngine();
    engine.startClassicMode(2);
    for (let i = 0; i < draws; i++) {
      engine.random();
    }
    engine.buildClassicStage(2);
    return boardSignature(engine);
  };
  assert.deepEqual(build(0), build(MANY_DRAWS));
  const stageOne = createTestEngine();
  stageOne.startClassicMode(1);
  assert.notDeepEqual(boardSignature(stageOne), build(0));
});

test('Classic holds no specials: empty inventory, no ammo, no overcharge, no Continue, no shot budget', () => {
  const engine = createTestEngine();
  engine.storageManager.setCoins(RICH_COINS);
  engine.startClassicMode();
  assert.ok(Object.values(SPECIAL_TYPES).every((type) => engine.specialInventory[type] === 0));
  assert.equal(engine.isDailyAmmoLocked(), true);
  assert.equal(engine.buySpecialAmmo(Object.values(SPECIAL_TYPES)[0]), false);
  assert.equal(engine.getOverchargeMultiplier(), 0);
  engine.addOvercharge(gameConfig.scoring.overchargeMax * OVERCHARGE_BURSTS);
  assert.ok(Object.values(SPECIAL_TYPES).every((type) => engine.specialInventory[type] === 0));
  assert.equal(engine.usesShotBudget(), false);
  assert.equal(engine.canContinueOutOfShots(), false);
});

test('Classic ignores the Workshop and the device tilt', () => {
  const levels = Object.fromEntries(Object.keys(gameConfig.upgrades).map((key) => [key, MAXED_UPGRADE_LEVEL]));
  const engine = createTestEngine(levels);
  engine.startEndlessMode();
  assert.ok(Object.keys(levels).some((key) => engine.getEffectiveUpgradeLevel(key) > 0));
  engine.startClassicMode();
  for (const key of Object.keys(levels)) {
    assert.equal(engine.getEffectiveUpgradeLevel(key), 0);
  }
  assert.equal(engine.isTiltLocked(), true);
  engine.setTilt(TILT_SHARE);
  assert.equal(engine.physicsWorld.tiltFactor, 0);
});

test('lowerAnchorRail moves anchors and pivots down by one step and leaves platforms where they are', () => {
  const engine = createTestEngine();
  engine.startClassicMode();
  const world = engine.physicsWorld;
  const platform = new Obstacle({ type: OBSTACLE_TYPES.PLATFORM, x: PLATFORM_X, y: PLATFORM_Y }, obstaclesConfig);
  const pivot = new Obstacle({ type: OBSTACLE_TYPES.PIVOT, x: PIVOT_X, y: PIVOT_Y }, obstaclesConfig);
  world.obstacles.push(platform, pivot);
  const pivotBall = engine.createClusterBall({
    x: PIVOT_X,
    y: PIVOT_Y + PIVOT_RADIUS,
    radius: physicsConfig.ball.radius,
    colorId: engine.activePalette[0],
    clusterModifier: null,
    isAnchor: false,
    pivotRef: pivot,
    pivotRadius: PIVOT_RADIUS,
    pivotAngle: 0
  });
  world.addBall(pivotBall);
  const anchorsBefore = world.balls.filter((b) => b.isAnchor).map((b) => [b.id, b.y]);
  const pivotY = pivot.y;
  const pivotBallY = pivotBall.y;
  const platformY = platform.y;

  engine.lowerAnchorRail();

  assert.equal(engine.railDrops, 1);
  assert.equal(platform.y, platformY);
  assert.equal(pivot.y, pivotY + classicCfg.descentStepY);
  assert.equal(pivotBall.y, pivotBallY + classicCfg.descentStepY);
  assert.equal(anchorsBefore.length, classicCfg.columns);
  for (const [id, y] of anchorsBefore) {
    const ball = world.ballMap.get(id);
    assert.equal(ball.y, y + classicCfg.descentStepY);
    assert.equal(ball.isAnchor, true);
  }
});

test('Classic whiffs fill the meter and a full meter lowers the rail instead of adding a row', () => {
  const engine = createTestEngine();
  engine.startClassicMode();
  const size = gameConfig.sag.modes[GAME_MODES.CLASSIC].size;
  const spheres = engine.physicsWorld.balls.length;
  for (let i = 0; i < size - 1; i++) {
    engine.handlePostTurnCleanup(false);
  }
  assert.equal(engine.sagLevel, size - 1);
  assert.equal(engine.railDrops, 0);
  engine.handlePostTurnCleanup(false);
  assert.equal(engine.sagLevel, 0);
  assert.equal(engine.railDrops, 1);
  assert.equal(engine.physicsWorld.balls.length, spheres);
  assert.equal(engine.state, GAME_STATES.PLAYING);
});

test('A Classic cluster that crosses the danger line ends the run with LINE_CROSSED', () => {
  const engine = createTestEngine();
  engine.startClassicMode();
  for (let i = 0; i < MAX_SHOT_FRAMES && engine.state === GAME_STATES.PLAYING; i++) {
    engine.lowerAnchorRail();
  }
  assert.equal(engine.state, GAME_STATES.GAME_OVER);
  assert.equal(engine.gameOverSummary.reasonKey, GAME_OVER_REASONS.LINE_CROSSED);
});

test('Clearing a Classic board pays the stage bonus, builds the next stage and resets the meter', () => {
  const engine = createTestEngine();
  engine.startClassicMode();
  engine.sagLevel = SAVED_SAG_LEVEL;
  engine.railDrops = SAVED_RAIL_DROPS;
  engine.lowerAnchorRail();
  clearBoard(engine);
  const scoreBefore = engine.score;
  engine.evaluateRoundEnd();
  assert.equal(engine.state, GAME_STATES.PLAYING);
  assert.equal(engine.classicStage, 2);
  assert.equal(engine.score, scoreBefore + classicCfg.stageClearBonusBase);
  assert.equal(engine.sagLevel, 0);
  assert.equal(engine.railDrops, 0);
  assert.equal(engine.physicsWorld.balls.length, (classicCfg.baseRows + classicCfg.rowsPerStage) * classicCfg.columns);
  const topRow = Math.min(...engine.physicsWorld.balls.map((b) => b.y));
  assert.equal(topRow, classicCfg.startY);
  assert.equal(engine.storageManager.getClassicBestStage(), 2);
});

test('Classic runs with the same scripted shots are identical from stage 1 into stage 2', () => {
  const run = () =>
    withFixedRandom(RANDOM_SEED, () => {
      const engine = createTestEngine();
      engine.startClassicMode();
      const timeline = playScriptedShots(engine);
      clearBoard(engine);
      engine.state = GAME_STATES.PLAYING;
      engine.evaluateRoundEnd();
      return { timeline, stage: engine.classicStage, score: engine.score, stageTwo: boardSignature(engine) };
    });
  const first = run();
  const second = run();
  assert.ok(first.timeline.length > 0);
  assert.equal(first.stage, 2);
  assert.deepEqual(first, second);
});

test('A Classic run snapshot restores the stage, the meter, the rail and the board', () => {
  const engine = createTestEngine();
  engine.startClassicMode(2);
  engine.lowerAnchorRail();
  engine.sagLevel = SAVED_SAG_LEVEL;
  engine.score = SAVED_SCORE;
  const snapshot = JSON.parse(JSON.stringify(captureRunSnapshot(engine, SNAPSHOT_VERSION)));
  assert.ok(isValidRunSnapshot(snapshot, SNAPSHOT_VERSION));
  assert.equal(snapshot.mode, GAME_MODES.CLASSIC);

  const fresh = createTestEngine();
  assert.equal(applyRunSnapshot(fresh, snapshot), true);
  assert.equal(fresh.mode, GAME_MODES.CLASSIC);
  assert.equal(fresh.classicStage, 2);
  assert.equal(fresh.sagLevel, SAVED_SAG_LEVEL);
  assert.equal(fresh.railDrops, 1);
  assert.equal(fresh.score, SAVED_SCORE);
  assert.deepEqual(boardSignature(fresh), boardSignature(engine));
  assert.ok(Object.values(SPECIAL_TYPES).every((type) => fresh.specialInventory[type] === 0));
});

test('A Survival run saved with the old wave countdown restores the matching meter level', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  const snapshot = JSON.parse(JSON.stringify(captureRunSnapshot(engine, SNAPSHOT_VERSION)));
  delete snapshot.engine.sagLevel;
  delete snapshot.engine.railDrops;
  delete snapshot.engine.classicStage;
  snapshot.engine.shotsUntilWave = LEGACY_SHOTS_UNTIL_WAVE;
  assert.ok(isValidRunSnapshot(snapshot, SNAPSHOT_VERSION));

  const fresh = createTestEngine();
  assert.equal(applyRunSnapshot(fresh, snapshot), true);
  assert.equal(fresh.sagLevel, gameConfig.sag.modes[GAME_MODES.ENDLESS].size - LEGACY_SHOTS_UNTIL_WAVE);
  assert.equal(fresh.sagLevel, SAVED_SAG_LEVEL);
});
