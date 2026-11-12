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
import { i18n } from '../src/core/I18n.js';
import { SeededRandom } from '../src/core/SeededRandom.js';
import { createShakeDetector } from '../src/ui/UISettingsControls.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import {
  BOARD_MECHANICS,
  GAME_MODES,
  GAME_OVER_REASONS,
  GAME_STATES,
  LAUNCHER_POSTURES,
  SPECIAL_TYPES
} from '../src/core/Constants.js';
import { Ball } from '../src/entities/Ball.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { mergeBehavior } from '../src/game/modes/MergeBehavior.js';

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
const modesConfig = loadJson('./configs/modes.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('campaign', campaignConfig);
configRegistry.configs.set('audio', audioConfig);
configRegistry.configs.set('flux', fluxConfig);
configRegistry.configs.set('modes', modesConfig);

i18n.dictionaries.set('en', loadJson('./locales/en.json'));
i18n.dictionaries.set('fr', loadJson('./locales/fr.json'));
i18n.currentLocale = 'en';

const createEngine = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  return new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    campaignConfig,
    campaignTuning,
    fluxConfig,
    modesConfig,
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager,
    onStateChange: () => {}
  });
};

test('Merge Basin uses a horizontal Drop Rail, purist fair-play rules, and enables device tilt', () => {
  const engine = createEngine();
  engine.startMergeMode();

  assert.equal(engine.mode, GAME_MODES.MERGE);
  assert.equal(engine.getLauncherSpec().posture, LAUNCHER_POSTURES.DROP_RAIL);
  assert.equal(engine.offersSpecialBalls(), false);
  assert.equal(engine.isSpecialTypeAllowed(SPECIAL_TYPES.BOMB), false);
  assert.equal(engine.areUpgradesNeutralised(), true);
  assert.equal(engine.getOverchargeMultiplier(), 0);
  assert.equal(engine.isTiltLocked(), false);

  // Aiming clamps X inside basin walls
  engine.updateAim(-500, 300);
  assert.equal(engine.mergeDropX, modesConfig.merge.basinLeftX + engine.currentBall.radius);
  engine.updateAim(5000, 300);
  assert.equal(engine.mergeDropX, modesConfig.merge.basinRightX - engine.currentBall.radius);
});

test('Merge Basin fuses touching identical tiers into tier + 1 and triggers Supernova on tier 9 + tier 9', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const cfg = modesConfig.merge;
  const world = engine.physicsWorld;

  const t0 = cfg.tiers[0];
  const a = new Ball({ x: 200, y: cfg.basinFloorY - t0.radius, radius: t0.radius, colorId: t0.id });
  a.mergeTier = 0;
  a.mergeGraceSec = 0;
  const b = new Ball({ x: 200 + t0.radius * 2 - 0.5, y: cfg.basinFloorY - t0.radius, radius: t0.radius, colorId: t0.id });
  b.mergeTier = 0;
  b.mergeGraceSec = 0;
  world.addBall(a);
  world.addBall(b);

  mergeBehavior.onBeforePhysicsStep(engine, 1 / 60);

  assert.equal(world.balls.length, 1);
  assert.equal(world.balls[0].mergeTier, 1);
  assert.equal(world.balls[0].colorId, cfg.tiers[1].id);
  assert.equal(world.balls[0].radius, cfg.tiers[1].radius);
  assert.equal(engine.mergeBestTier, 2);

  // Now fuse two max-tier (tier 9) spheres -> Supernova!
  world.balls.length = 0;
  world.ballMap.clear();
  const maxTier = cfg.tiers[cfg.tiers.length - 1];
  const m1 = new Ball({ x: 200, y: 500, radius: maxTier.radius, colorId: maxTier.id });
  m1.mergeTier = maxTier.tier;
  m1.mergeGraceSec = 0;
  const m2 = new Ball({ x: 200 + maxTier.radius * 2 - 1, y: 500, radius: maxTier.radius, colorId: maxTier.id });
  m2.mergeTier = maxTier.tier;
  m2.mergeGraceSec = 0;
  world.addBall(m1);
  world.addBall(m2);

  const scoreBefore = engine.score;
  mergeBehavior.onBeforePhysicsStep(engine, 1 / 60);
  assert.equal(world.balls.length, 0, 'Supernova annihilates both max-calibre spheres');
  assert.equal(engine.modeState.supernovas, 1);
  assert.ok(engine.score >= scoreBefore + cfg.supernovaBonus);
});

test('Merge Basin Polarity Bias pulls same-tier spheres together and sustained overflow ends the run', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const cfg = modesConfig.merge;
  const t2 = cfg.tiers[2];

  const left = new Ball({ x: 180, y: 500, radius: t2.radius, colorId: t2.id });
  left.mergeTier = 2;
  left.mergeGraceSec = 0;
  const right = new Ball({ x: 260, y: 500, radius: t2.radius, colorId: t2.id });
  right.mergeTier = 2;
  right.mergeGraceSec = 0;
  engine.physicsWorld.addBall(left);
  engine.physicsWorld.addBall(right);

  engine.togglePolarityFlip();
  assert.ok(left.mergePolaritySec > 0);
  mergeBehavior.applyPolarityBiasForces(engine, engine.physicsWorld.balls, 0.1);
  assert.ok(left.vx > 0 && right.vx < 0, 'same-tier spheres are magnetically pulled toward each other');

  // Overflow sphere above overflowLineY past overflowGraceSec -> BASIN_OVERFLOW
  const high = new Ball({ x: 235, y: cfg.overflowLineY - 5, radius: t2.radius, colorId: t2.id });
  high.mergeTier = 2;
  high.mergeGraceSec = 0;
  high.mergeOverflowSec = cfg.overflowGraceSec;
  engine.physicsWorld.addBall(high);

  mergeBehavior.onBeforePhysicsStep(engine, 0.1);
  assert.equal(engine.state, GAME_STATES.GAME_OVER);
  assert.equal(engine.gameOverSummary?.reasonKey, GAME_OVER_REASONS.BASIN_OVERFLOW);
});

test('Merge Basin snapshot preserves drop rail X, best calibre, and sphere tiers on restore', () => {
  const engine = createEngine();
  engine.startMergeMode();
  engine.updateAim(160, 200);
  engine.shoot();
  for (let i = 0; i < 30; i++) {
    engine.update();
  }
  engine.saveRunSnapshot({ force: true });

  const savedTiers = engine.physicsWorld.balls.map((b) => b.mergeTier);
  const savedRadii = engine.physicsWorld.balls.map((b) => b.radius);
  const savedDropX = engine.mergeDropX;

  const restored = createEngine();
  restored.storageManager = engine.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.mode, GAME_MODES.MERGE);
  assert.equal(restored.mergeDropX, savedDropX);
  assert.deepEqual(restored.physicsWorld.balls.map((b) => b.mergeTier), savedTiers);
  assert.deepEqual(restored.physicsWorld.balls.map((b) => b.radius), savedRadii);
});

test('Merge Basin drops spheres with initial velocity, scales fine vs coarse rail steps, recenters, and blocks Resonance', () => {
  const engine = createEngine();
  engine.startMergeMode();
  assert.equal(engine.getResonanceBlockReason(), 'ruleset');

  const centerX = engine.mergeDropX;
  engine.adjustAimByDelta(gameConfig.canvas.keyboardAimFineStepRad);
  const fineDelta = engine.mergeDropX - centerX;
  assert.ok(fineDelta > 0 && fineDelta < modesConfig.merge.dropStepPx);

  const beforeCoarse = engine.mergeDropX;
  engine.adjustAimByDelta(gameConfig.canvas.keyboardAimStepRad);
  assert.ok(Math.abs((engine.mergeDropX - beforeCoarse) - modesConfig.merge.dropStepPx) < 1e-6);

  engine.recenterAim();
  assert.equal(engine.mergeDropX, centerX);

  engine.shoot();
  assert.equal(engine.physicsWorld.balls.length, 1);
  assert.ok(engine.physicsWorld.balls[0].vy > 0, 'dropped sphere starts with downward velocity');
});

test('An unused shake leaves a seeded game identical through overflow', () => {
  const play = (keepShake) => {
    const engine = createEngine();
    const random = new SeededRandom('merge-shake-comparison');
    engine.random = () => random.next();
    engine.startMergeMode();
    if (!keepShake) {
      engine.modeState.shakeRemaining = null;
    }
    const timeline = [];

    for (let drop = 0; drop < 24 && engine.isRunPlaying(); drop += 1) {
      engine.updateAim(modesConfig.merge.basinLeftX, modesConfig.merge.launcherY);
      engine.shoot();
      for (let frame = 0; frame < 25 && engine.isRunPlaying(); frame += 1) {
        engine.update();
        timeline.push({
          score: engine.score,
          merges: engine.modeState.mergesCount,
          bestTier: engine.mergeBestTier,
          overflow: engine.modeState.maxOverflowRatio,
          balls: engine.physicsWorld.balls.map(({ x, y, vx, vy, mergeTier }) => [x, y, vx, vy, mergeTier])
        });
      }
    }
    assert.ok(engine.modeState.mergesCount > 0);
    const cfg = modesConfig.merge;
    const tier = cfg.tiers.at(-1);
    const overflow = new Ball({ x: cfg.basinRightX - tier.radius, y: cfg.launcherY, radius: tier.radius, colorId: tier.id });
    overflow.mergeTier = tier.tier;
    overflow.mergeOverflowSec = cfg.overflowGraceSec - 0.05;
    engine.physicsWorld.addBall(overflow);
    let overflowFrames = 0;
    while (overflowFrames < 20 && engine.isRunPlaying()) {
      engine.update();
      overflowFrames += 1;
    }
    assert.equal(engine.gameOverSummary?.reasonKey, GAME_OVER_REASONS.BASIN_OVERFLOW);
    timeline.push({ overflowFrames });
    assert.equal(engine.getMergeShakeRemaining(), keepShake ? 0 : null);
    return timeline;
  };

  assert.deepEqual(play(true), play(false));
});

test('Only successful drops charge the shake and only one input consumes it', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const cfg = modesConfig.merge.shake;

  for (let i = 0; i < cfg.rechargeDrops; i += 1) {
    engine.modeState.dropCooldownSec = 0;
    engine.shoot();
    engine.shoot(); // The second attempt hits the drop cooldown.
    assert.equal(engine.getMergeShakeRemaining(), cfg.rechargeDrops - i - 1);
  }
  const balls = engine.physicsWorld.balls;
  const before = balls.map(({ x, y, vx, vy, mergeOverflowSec }) => [x, y, vx, vy, mergeOverflowSec]);
  engine.togglePause();
  assert.equal(engine.tryMergeShake(), false);
  engine.togglePause();
  assert.equal(engine.tryMergeShake(), true);
  assert.equal(engine.tryMergeShake(), false);
  assert.equal(engine.getMergeShakeRemaining(), cfg.rechargeDrops);
  balls.forEach((ball, i) => {
    const [x, y, vx, vy, overflow] = before[i];
    const sizeFactor = modesConfig.merge.tiers[0].radius / ball.radius;
    assert.deepEqual([ball.x, ball.y, ball.mergeOverflowSec], [x, y, overflow]);
    assert.ok(Math.abs(Math.abs(ball.vx - vx) - cfg.maxImpulsePxPerSec * sizeFactor) < 1e-9);
    assert.ok(Math.abs((vy - ball.vy) - cfg.liftImpulsePxPerSec * sizeFactor) < 1e-9, 'the pile hops');
  });

  const restored = createEngine();
  restored.storageManager = engine.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.getMergeShakeRemaining(), cfg.rechargeDrops);
  assert.equal(restored.tryMergeShake(), false);
  assert.deepEqual(restored.physicsWorld.balls.map((b) => b.vx), balls.map((b) => b.vx));
});

test('A legacy snapshot restores uncharged and legacy prototype records fold into the main record', () => {
  const cfg = modesConfig.merge.shake;
  const source = createEngine();
  source.startMergeMode();
  source.shoot();
  source.score = 45;
  source.mergeBestTier = 3;
  source.saveRunSnapshot();
  const snapshot = source.storageManager.loadRunSnapshot();
  assert.ok(Number.isInteger(snapshot.modeState.shakeRemaining));
  delete snapshot.modeState.shakeRemaining;
  source.storageManager.saveRunSnapshot(snapshot);

  const restored = createEngine();
  restored.storageManager = source.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.getMergeShakeRemaining(), cfg.rechargeDrops);

  const storage = source.storageManager;
  const keys = storage.storageConfig.keys;
  storage.safeSetItem(keys.mergeShakeHighScore, 100);
  storage.safeSetItem(keys.mergeShakeBestTier, 4);
  assert.equal(storage.getMergeHighScore(), 100);
  assert.equal(storage.getMergeBestTier(), 4);

  storage.setMergeRecord(150, 5);
  assert.equal(storage.getMergeHighScore(), 150);
  assert.equal(storage.getMergeBestTier(), 5);
  assert.equal(storage.readNonNegativeInt(keys.mergeHighScore), 150);
  assert.equal(storage.readNonNegativeInt(keys.mergeBestTier), 5);
  assert.equal(storage.readNonNegativeInt(keys.mergeShakeHighScore), 100);
  assert.equal(storage.readNonNegativeInt(keys.mergeShakeBestTier), 4);
});

test('Shake motion rejects slow tilt and isolated spikes, then latches until quiet', () => {
  const cfg = modesConfig.merge.shake.gesture;
  const detect = createShakeDetector(cfg);
  const peak = cfg.peakAcceleration * 2;
  const read = (timeStamp, x, y = 0) => detect({ timeStamp, acceleration: { x, y } });

  for (let i = 0; i <= 20; i += 1) {
    assert.equal(detect({ timeStamp: i * 20, accelerationIncludingGravity: { x: i / 2, y: 0 } }), false);
  }
  assert.equal(read(500, peak), false);
  assert.equal(read(500 + cfg.reversalWindowMs + 1, -peak), false);
  assert.equal(read(1000, 0, peak), false);
  assert.equal(read(1050, 0, -peak), true);
  assert.equal(read(1100, 0, peak), false);
  assert.equal(read(1150, 0, -peak), false);
  assert.equal(read(1200, 0), false);
  assert.equal(read(1200 + cfg.quietWindowMs, 0), false);
  assert.equal(read(1500, peak), false);
  assert.equal(read(1550, -peak), true);
});

test('A Basin run never shows the colour-match basics hint', () => {
  const engine = createEngine();
  engine.startMergeMode();
  assert.equal(engine.storageManager.getDiscoveries()[BOARD_MECHANICS.BASICS], undefined, 'the hint is still unlearned');
  assert.equal(engine.listPresentMechanics().has(BOARD_MECHANICS.BASICS), false);
  assert.notEqual(engine.activeDiscoveryId, BOARD_MECHANICS.BASICS);

  engine.shoot();
  engine.refreshDiscovery();
  assert.notEqual(engine.activeDiscoveryId, BOARD_MECHANICS.BASICS);
});

test('A shake moves a settled pile by more than the smallest sphere radius', () => {
  const cfg = modesConfig.merge;
  const settleFrames = 45;
  const watchFrames = 90;
  const drift = (shake) => {
    const engine = createEngine();
    const random = new SeededRandom('merge-shake-strength');
    engine.random = () => random.next();
    engine.startMergeMode();
    for (let drop = 0; drop < cfg.shake.rechargeDrops * 4; drop += 1) {
      engine.updateAim(cfg.basinLeftX + random.next() * (cfg.basinRightX - cfg.basinLeftX), cfg.launcherY);
      engine.modeState.dropCooldownSec = 0;
      engine.shoot();
      for (let frame = 0; frame < settleFrames; frame += 1) engine.update();
    }
    assert.ok(engine.isRunPlaying());
    const before = new Map(engine.physicsWorld.balls.map((ball) => [ball, ball.x]));
    if (shake) {
      engine.modeState.shakeRemaining = 0;
      assert.equal(engine.tryMergeShake(), true);
    }
    for (let frame = 0; frame < watchFrames; frame += 1) engine.update();
    assert.ok(engine.isRunPlaying(), 'the hop never overflows the basin');
    const kept = [...before].filter(([ball]) => engine.physicsWorld.balls.includes(ball));
    return kept.reduce((sum, [ball, x]) => sum + Math.abs(ball.x - x), 0) / kept.length;
  };
  assert.ok(drift(true) - drift(false) > cfg.tiers[0].radius);
});

test('Pause shows a Basin tip instead of the anchors and rotors tip', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const key = engine.getModeBehavior().getPauseTipKey();
  assert.notEqual(key, 'modals.pause.instructions.physics');
  for (const locale of ['en', 'fr']) {
    i18n.currentLocale = locale;
    assert.notEqual(i18n.t(key), key, `${locale} has the Basin tip`);
  }
  i18n.currentLocale = 'en';

  const campaign = createEngine();
  campaign.mode = GAME_MODES.CAMPAIGN;
  assert.equal(campaign.getModeBehavior().getPauseTipKey(), 'modals.pause.instructions.physics');
});
