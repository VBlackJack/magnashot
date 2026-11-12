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
import { i18n, t } from '../src/core/I18n.js';
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
  MATH_CONSTANTS,
  SPECIAL_TYPES
} from '../src/core/Constants.js';
import { Ball } from '../src/entities/Ball.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { mergeBehavior } from '../src/game/modes/MergeBehavior.js';
import { getMergeEventLocaleId } from '../src/game/modes/MergeEvents.js';
import { getMergeContractPluralKey } from '../src/game/modes/MergeContracts.js';
import { resolveModesConfig } from '../src/game/modes/ModeConfig.js';
import { uiHudRefreshMethods } from '../src/ui/UIHudRefresh.js';

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

/** Roll that draws the classic basin: the first shape of the configured list. */
const CLASSIC_SHAPE_ROLL = 0;

/** Engine whose shape draw is pinned to a roll, so a test never depends on the ambient random source. */
const createEngine = (shapeRoll = CLASSIC_SHAPE_ROLL) => {
  const storageManager = new StorageManager();
  storageManager.init();
  const engine = new GameEngine({
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
  const drawSeededRoll = engine.drawSeededRoll.bind(engine);
  engine.drawSeededRoll = (stream, index) => (stream === 'mergeShape' ? shapeRoll : drawSeededRoll(stream, index));
  return engine;
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

test('Merge Basin fuses touching identical tiers into tier + 1 and triggers Supernova on the last tier pair', () => {
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

  // Now fuse two max-tier spheres -> Supernova!
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
  assert.ok(left.mergePulseSec > 0);
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

test('Pause words the keyboard line for the basin and leaves the other hints alone', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const behavior = engine.getModeBehavior();
  const generic = 'modals.pause.instructions.keyboard';
  const key = behavior.getInputHintKey(generic);
  assert.notEqual(key, generic);
  for (const locale of ['en', 'fr']) {
    i18n.currentLocale = locale;
    for (const inputMode of ['pointer', 'touch']) {
      assert.notEqual(i18n.t(`${key}.${inputMode}`), `${key}.${inputMode}`, `${locale} ${inputMode} wording exists`);
    }
  }
  i18n.currentLocale = 'en';
  assert.equal(behavior.getInputHintKey('modals.pause.instructions.aim'), 'modals.pause.instructions.aim');

  const campaign = createEngine();
  campaign.mode = GAME_MODES.CAMPAIGN;
  assert.equal(campaign.getModeBehavior().getInputHintKey(generic), generic);
});

/** Builds the same seeded pile twice, then runs it with and without a polarity flip. */
const pulseComparison = (seed) => {
  const cfg = modesConfig.merge;
  const run = (flip) => {
    const engine = createEngine();
    const random = new SeededRandom(seed);
    engine.random = () => random.next();
    engine.startMergeMode();
    for (let drop = 0; drop < cfg.shake.rechargeDrops * 4 && engine.isRunPlaying(); drop += 1) {
      engine.updateAim(cfg.basinLeftX + random.next() * (cfg.basinRightX - cfg.basinLeftX), cfg.launcherY);
      engine.modeState.dropCooldownSec = 0;
      engine.shoot();
      for (let frame = 0; frame < 45; frame += 1) engine.update();
    }
    assert.ok(engine.isRunPlaying());
    const merges = engine.modeState.mergesCount;
    if (flip) {
      engine.togglePolarityFlip();
    }
    for (let frame = 0; frame < 90 && engine.isRunPlaying(); frame += 1) engine.update();
    assert.ok(engine.isRunPlaying());
    return engine.modeState.mergesCount - merges;
  };
  return { flipped: run(true), still: run(false) };
};

test('Every polarity press pulses the basin, in both directions', () => {
  const engine = createEngine();
  engine.startMergeMode();
  engine.shoot();
  const [ball] = engine.physicsWorld.balls;
  for (let press = 0; press < 2; press += 1) {
    ball.mergePulseSec = 0;
    engine.togglePolarityFlip();
    assert.equal(ball.mergePulseSec, modesConfig.merge.polarityPulseSec, `press ${press + 1} pulses`);
  }
  assert.equal(engine.isPolarityFlipped, false);
});

test('A polarity pulse fuses more of a settled pile than leaving it alone', () => {
  let flipped = 0;
  let still = 0;
  for (const seed of ['pulse-a', 'pulse-b', 'pulse-c', 'pulse-d']) {
    const result = pulseComparison(seed);
    flipped += result.flipped;
    still += result.still;
  }
  assert.ok(still > 0, 'the piles keep fusing on their own');
  assert.ok(flipped >= still * 2, `${flipped} merges with a pulse against ${still} without`);
});

test('A polarity pulse on a nearly full basin does not overflow it', () => {
  const cfg = modesConfig.merge;
  // Calibres chosen so that no two neighbours, side by side, stacked or diagonal, share one.
  const tierPattern = [2, 3, 4, 5];
  const rowSettleFrames = 60;
  const watchFrames = 120;
  const fill = (flip) => {
    const engine = createEngine();
    engine.startMergeMode();
    const cell = cfg.tiers[tierPattern.at(-1)].radius * 2;
    const columns = Math.floor((cfg.basinRightX - cfg.basinLeftX) / cell);
    const pileTop = () => Math.min(cfg.basinFloorY, ...engine.physicsWorld.balls.map((ball) => ball.y - ball.radius));
    // Rows are stacked one at a time, each settling, until the pile is within one cell of the line.
    for (let row = 0; pileTop() > cfg.overflowLineY + cell; row += 1) {
      const rowY = pileTop() - cell * MATH_CONSTANTS.HALF;
      for (let col = 0; col < columns; col += 1) {
        const spec = cfg.tiers[tierPattern[(row * 2 + col) % tierPattern.length]];
        const ball = new Ball({ x: cfg.basinLeftX + (col + MATH_CONSTANTS.HALF) * cell, y: rowY, radius: spec.radius, colorId: spec.id });
        ball.mergeTier = spec.tier;
        ball.mergeGraceSec = 0;
        ball.mergeOverflowSec = 0;
        engine.physicsWorld.addBall(ball);
      }
      for (let frame = 0; frame < rowSettleFrames; frame += 1) engine.update();
      assert.ok(engine.isRunPlaying(), `row ${row + 1} settles below the line`);
    }
    assert.ok(pileTop() < cfg.overflowLineY + cell, 'the pile reaches within one cell of the overflow line');
    if (flip) {
      engine.togglePolarityFlip();
    }
    for (let frame = 0; frame < watchFrames && engine.isRunPlaying(); frame += 1) engine.update();
    return engine.isRunPlaying();
  };
  assert.equal(fill(false), true, 'the full pile holds without a pulse');
  assert.equal(fill(true), true, 'a pulse does not push it over the line');
});

test('A polarity pulse rings each pulsing sphere, with reduced motion too', () => {
  const engine = createEngine();
  engine.startMergeMode();
  engine.particleSystem.setReducedMotion?.(true);
  engine.shoot();
  const [ball] = engine.physicsWorld.balls;
  const arcs = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, stroke() {},
    arc: (x, y, radius) => arcs.push({ x, y, radius })
  };
  const theme = gameConfig.theme;

  mergeBehavior.drawOverlay(ctx, engine, null, theme);
  assert.equal(arcs.length, 0, 'no ring without a pulse');

  engine.togglePolarityFlip();
  mergeBehavior.drawOverlay(ctx, engine, null, theme);
  assert.deepEqual(arcs.map(({ x, y }) => [x, y]), [[ball.x, ball.y]]);
  assert.ok(arcs[0].radius > ball.radius, 'the ring sits outside the sphere');

  arcs.length = 0;
  ball.mergePulseSec = 0;
  mergeBehavior.drawOverlay(ctx, engine, null, theme);
  assert.equal(arcs.length, 0, 'the ring goes when the pulse ends');
});

const MERGE_EVENTS = modesConfig.merge.events;
const MERGE_EVENT_IDS_LIST = Object.keys(MERGE_EVENTS.pool);
const PHYSICS_DT = 1 / 60;

const dropOnce = (engine) => {
  engine.modeState.dropCooldownSec = 0;
  engine.shoot();
};

const createEventEngine = (seed = 'merge-events') => {
  const engine = createEngine();
  const random = new SeededRandom(seed);
  engine.random = () => random.next();
  engine.startMergeMode();
  return engine;
};

const placeBall = (engine, tier, x, y, extra = {}) => {
  const spec = modesConfig.merge.tiers[tier];
  const ball = new Ball({ x, y, radius: spec.radius, colorId: spec.id });
  ball.mergeTier = tier;
  ball.mergeGraceSec = 0;
  Object.assign(ball, extra);
  engine.physicsWorld.addBall(ball);
  return ball;
};

const placeTouchingPair = (engine, tier, x) => {
  const spec = modesConfig.merge.tiers[tier];
  const y = modesConfig.merge.basinFloorY - spec.radius;
  placeBall(engine, tier, x, y);
  placeBall(engine, tier, x + spec.radius * 2 - 0.5, y);
};

const withEvent = (engine, id, direction = 1) => {
  engine.modeState.event = { id, direction, dropsLeft: MERGE_EVENTS.durationDrops };
};

test('The default Merge config carries the same events and chain as configs/modes.json', () => {
  const defaults = resolveModesConfig(null).merge;
  assert.deepEqual(defaults.events, MERGE_EVENTS);
  assert.deepEqual(defaults.chain, modesConfig.merge.chain);
});

test('A Basin event is telegraphed one drop ahead, runs its drops, never repeats, then a new gap follows', () => {
  const engine = createEventEngine();
  const state = engine.modeState;
  const seen = new Set();
  let previous = null;

  for (let cycle = 0; cycle < 30; cycle += 1) {
    const gap = state.dropsUntilEvent;
    assert.ok(gap >= MERGE_EVENTS.gapMinDrops && gap <= MERGE_EVENTS.gapMaxDrops, `gap ${gap} is in range`);
    assert.equal(state.event, null);
    let drops = 0;
    let telegraphedAt = null;
    while (!state.event) {
      dropOnce(engine);
      drops += 1;
      if (state.upcomingEvent && telegraphedAt === null) {
        telegraphedAt = drops;
      }
    }
    assert.equal(drops, gap, 'the event starts after exactly the drawn gap');
    assert.equal(telegraphedAt, drops - 1, 'telegraphed exactly one drop before it starts');
    assert.equal(state.upcomingEvent, null);
    assert.equal(state.event.dropsLeft, MERGE_EVENTS.durationDrops);
    assert.notEqual(state.event.id, previous, 'never the same event twice in a row');
    assert.ok(MERGE_EVENT_IDS_LIST.includes(state.event.id));
    seen.add(state.event.id);
    previous = state.event.id;

    for (let i = 1; i < MERGE_EVENTS.durationDrops; i += 1) {
      dropOnce(engine);
      assert.equal(state.event.dropsLeft, MERGE_EVENTS.durationDrops - i);
    }
    dropOnce(engine);
    assert.equal(state.event, null, 'the event ends after its last drop');
    assert.ok(
      state.dropsUntilEvent >= MERGE_EVENTS.gapMinDrops && state.dropsUntilEvent <= MERGE_EVENTS.gapMaxDrops,
      'a new gap follows'
    );
  }
  assert.equal(seen.size, MERGE_EVENT_IDS_LIST.length, 'every event of the pool comes up');
  assert.equal(engine.getMergeEventState().active, null);
});

test('The event cycle is a pure function of the random source', () => {
  const play = () => {
    const engine = createEventEngine('merge-events-replay');
    const timeline = [];
    for (let i = 0; i < 40; i += 1) {
      dropOnce(engine);
      timeline.push(JSON.stringify([engine.modeState.event, engine.modeState.upcomingEvent]));
    }
    return timeline;
  };
  assert.deepEqual(play(), play());
});

test('Wind pushes spheres along its direction on top of the tilt, low gravity slows the fall', () => {
  const stepWith = (id, direction) => {
    const engine = createEngine();
    engine.startMergeMode();
    if (id) {
      withEvent(engine, id, direction);
    }
    const ball = placeBall(engine, 0, 200, 400);
    mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
    return ball;
  };
  const calm = stepWith(null);
  const left = stepWith('wind', -1);
  const right = stepWith('wind', 1);
  const acceleration = MERGE_EVENTS.pool.wind.acceleration;
  const expected = acceleration * PHYSICS_DT * modesConfig.merge.linearDamping;
  assert.ok(Math.abs(right.vx - calm.vx - expected) < 1e-9);
  assert.ok(Math.abs(calm.vx - left.vx - expected) < 1e-9);
  assert.ok(left.vx < 0 && right.vx > 0);

  const light = stepWith('lowGravity');
  assert.ok(light.vy < calm.vy);
  assert.ok(Math.abs(light.vy / calm.vy - MERGE_EVENTS.pool.lowGravity.gravityFactor) < 1e-9);
  assert.equal(light.vx, calm.vx, 'only the wind pushes sideways');
});

test('Bouncy spheres rebound from the floor, the walls and each other with the event restitution', () => {
  const reboundOffFloor = (bouncy) => {
    const engine = createEngine();
    engine.startMergeMode();
    if (bouncy) {
      withEvent(engine, 'bouncy');
    }
    const ball = placeBall(engine, 0, 200, modesConfig.merge.basinFloorY - modesConfig.merge.tiers[0].radius - 1, {
      vy: 300
    });
    mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
    return ball.vy;
  };
  const calm = reboundOffFloor(false);
  const bouncy = reboundOffFloor(true);
  assert.ok(calm < 0 && bouncy < calm);
  assert.ok(Math.abs(bouncy / calm - MERGE_EVENTS.pool.bouncy.restitution / modesConfig.merge.floorRestitution) < 1e-9);

  const reboundOffWall = (isBouncy) => {
    const engine = createEngine();
    engine.startMergeMode();
    if (isBouncy) {
      withEvent(engine, 'bouncy');
    }
    const ball = placeBall(engine, 0, modesConfig.merge.basinLeftX + 14, 300, { vx: -400 });
    mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
    return ball.vx;
  };
  assert.ok(reboundOffWall(true) > reboundOffWall(false) && reboundOffWall(false) > 0);

  const separation = (isBouncy) => {
    const engine = createEngine();
    engine.startMergeMode();
    if (isBouncy) {
      withEvent(engine, 'bouncy');
    }
    const a = placeBall(engine, 0, 200, 400, { vx: 200 });
    const b = placeBall(engine, 1, 200 + 14 + 18 - 2, 400);
    mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
    return b.vx - a.vx;
  };
  assert.ok(separation(true) > separation(false));
});

test('Golden multiplies fusion points but leaves the Supernova bonus alone', () => {
  const fusionPoints = (id, tier) => {
    const engine = createEngine();
    engine.startMergeMode();
    if (id) {
      withEvent(engine, id);
    }
    const spec = modesConfig.merge.tiers[tier];
    const y = tier === modesConfig.merge.tiers.length - 1 ? 500 : modesConfig.merge.basinFloorY - spec.radius;
    placeBall(engine, tier, 200, y);
    placeBall(engine, tier, 200 + spec.radius * 2 - 0.5, y);
    const before = engine.score;
    mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
    return engine.score - before;
  };
  const calm = fusionPoints(null, 0);
  const golden = fusionPoints('golden', 0);
  assert.equal(calm, modesConfig.merge.tiers[1].points);
  assert.equal(golden, Math.round(calm * MERGE_EVENTS.pool.golden.pointsFactor));
  assert.equal(Number.isInteger(golden), true);
  assert.equal(
    fusionPoints('golden', 5),
    Math.round(modesConfig.merge.tiers[6].points * MERGE_EVENTS.pool.golden.pointsFactor)
  );

  const last = modesConfig.merge.tiers.length - 1;
  assert.equal(fusionPoints('golden', last), fusionPoints(null, last), 'the Supernova bonus is not multiplied');
  assert.equal(fusionPoints(null, last), modesConfig.merge.supernovaBonus);
});

test('Big drops recolor the launcher into the bigger pool, and back at the end, without a queue draw', () => {
  const engine = createEventEngine();
  const state = engine.modeState;
  const { tiers } = modesConfig.merge;
  const bigMax = MERGE_EVENTS.pool.bigDrops.spawnMaxTierIndex;
  const normalMax = modesConfig.merge.spawnMaxTierIndex;
  const tierOf = (colorId) => tiers.findIndex((spec) => spec.id === colorId);
  const launcherTiers = () => [
    tierOf(engine.currentBall.colorId),
    tierOf(engine.nextBall.colorId),
    ...engine.upcomingColorIds.map(tierOf)
  ];
  engine.drawSeededRoll = () => 0.999;

  state.upcomingEvent = { id: 'bigDrops', direction: 1 };
  state.dropsUntilEvent = 1;
  const drawIndex = engine.launcherDrawIndex;
  mergeBehavior.advanceEventCycle(engine);
  assert.equal(state.event.id, 'bigDrops');
  assert.equal(engine.launcherDrawIndex, drawIndex, 'a recolor never advances the draw counter');
  assert.deepEqual(launcherTiers(), launcherTiers().map(() => bigMax));
  assert.equal(engine.currentBall.radius, tiers[bigMax].radius);
  assert.equal(engine.nextBall.mergeTier, bigMax);
  assert.equal(engine.upcomingColorIds.length, gameConfig.canvas.launcherPreviewCount);

  // New draws under the event come from the bigger pool, and a real drop keeps the preview honest.
  assert.ok(tierOf(engine.drawLauncherColor()) <= bigMax);
  dropOnce(engine);
  assert.deepEqual(launcherTiers(), launcherTiers().map(() => bigMax));

  state.event.dropsLeft = 1;
  const endIndex = engine.launcherDrawIndex;
  mergeBehavior.advanceEventCycle(engine);
  assert.equal(state.event, null);
  assert.equal(engine.launcherDrawIndex, endIndex);
  assert.deepEqual(launcherTiers(), launcherTiers().map(() => normalMax));
  assert.equal(engine.currentBall.radius, tiers[normalMax].radius);
  assert.equal(modesConfig.merge.spawnMaxTierIndex, normalMax, 'the config is never mutated');
});

test('A snapshot keeps a running event, a telegraphed one, and restores a legacy snapshot with defaults', () => {
  const restoreFrom = (mutate) => {
    const source = createEngine();
    source.startMergeMode();
    source.shoot();
    mutate(source.modeState);
    source.saveRunSnapshot({ force: true });
    const restored = createEngine();
    restored.storageManager = source.storageManager;
    assert.equal(restored.restoreSavedRun(), true);
    return { source, restored };
  };

  const running = restoreFrom((state) => {
    state.event = { id: 'wind', direction: -1, dropsLeft: 4 };
    state.eventCount = 3;
    state.dropsUntilEvent = 0;
    state.lastEventId = 'golden';
  });
  assert.deepEqual(running.restored.modeState.event, { id: 'wind', direction: -1, dropsLeft: 4 });
  assert.equal(running.restored.modeState.eventCount, 3);
  assert.equal(running.restored.modeState.lastEventId, 'golden');
  assert.deepEqual(running.restored.getMergeEventState(), {
    eventCount: 3,
    active: { id: 'wind', direction: -1, dropsLeft: 4 },
    upcoming: null
  });

  const telegraphed = restoreFrom((state) => {
    state.upcomingEvent = { id: 'bouncy', direction: 1 };
    state.dropsUntilEvent = 1;
    state.eventCount = 2;
  });
  assert.deepEqual(telegraphed.restored.modeState.upcomingEvent, { id: 'bouncy', direction: 1 });
  assert.equal(telegraphed.restored.modeState.dropsUntilEvent, 1);
  assert.equal(telegraphed.restored.modeState.event, null);

  const hostile = restoreFrom((state) => {
    state.event = { id: 'meteor', direction: 7, dropsLeft: 4 };
    state.upcomingEvent = { id: 'wind', direction: 7 };
    state.dropsUntilEvent = 9999;
    state.eventCount = -4;
  });
  assert.equal(hostile.restored.modeState.event, null);
  assert.deepEqual(hostile.restored.modeState.upcomingEvent, { id: 'wind', direction: 1 });
  assert.equal(hostile.restored.modeState.dropsUntilEvent, MERGE_EVENTS.gapMaxDrops);
  assert.equal(hostile.restored.modeState.eventCount, 0);

  const legacySource = createEngine();
  legacySource.startMergeMode();
  legacySource.shoot();
  legacySource.saveRunSnapshot({ force: true });
  const snapshot = legacySource.storageManager.loadRunSnapshot();
  for (const field of ['event', 'upcomingEvent', 'dropsUntilEvent', 'eventCount', 'lastEventId']) {
    delete snapshot.modeState[field];
  }
  legacySource.storageManager.saveRunSnapshot(snapshot);
  const legacy = createEngine();
  legacy.storageManager = legacySource.storageManager;
  assert.equal(legacy.restoreSavedRun(), true);
  assert.equal(legacy.modeState.event, null);
  assert.equal(legacy.modeState.upcomingEvent, null);
  assert.equal(legacy.modeState.eventCount, 0);
  assert.ok(
    legacy.modeState.dropsUntilEvent >= MERGE_EVENTS.gapMinDrops
      && legacy.modeState.dropsUntilEvent <= MERGE_EVENTS.gapMaxDrops
  );
});

test('The second fusion of a drop speaks of a chain, and the third advances a charging shake once', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const texts = [];
  engine.particleSystem.spawnFloatingText = (x, y, text) => texts.push(text);
  const cfg = modesConfig.merge;
  engine.modeState.shakeRemaining = 3;

  [60, 160, 260].forEach((x) => placeTouchingPair(engine, 0, x));
  mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
  assert.equal(engine.combo, 3);
  assert.equal(texts[0], t('gameplay.feedback.merge.fused', { tier: 2, points: cfg.tiers[1].points }));
  assert.equal(texts[1], t('gameplay.feedback.merge.chain', { chain: 2, points: cfg.tiers[1].points * 2 }));
  assert.ok(texts.includes(t('gameplay.feedback.merge.chain', { chain: 3, points: cfg.tiers[1].points * 3 })));
  assert.equal(texts.filter((text) => text === t('gameplay.feedback.merge.chainShake')).length, 1);
  assert.equal(engine.getMergeShakeRemaining(), 2, 'advanced by exactly one');

  placeTouchingPair(engine, 0, 360);
  mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
  assert.equal(engine.combo, 4);
  assert.equal(engine.getMergeShakeRemaining(), 2, 'a drop rewards its chain once');

  // The next drop is eligible again (the drop itself charges the shake by one).
  dropOnce(engine);
  assert.equal(engine.modeState.chainRewardGranted, false);
  assert.equal(engine.getMergeShakeRemaining(), 1);
  engine.physicsWorld.balls.length = 0;
  engine.physicsWorld.ballMap.clear();
  [60, 160, 260].forEach((x) => placeTouchingPair(engine, 0, x));
  mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
  assert.equal(engine.getMergeShakeRemaining(), 0);
});

test('A chain does not touch a shake that is already ready', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const texts = [];
  engine.particleSystem.spawnFloatingText = (x, y, text) => texts.push(text);
  engine.modeState.shakeRemaining = 0;

  [60, 160, 260].forEach((x) => placeTouchingPair(engine, 0, x));
  mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
  assert.equal(engine.combo, 3);
  assert.equal(engine.getMergeShakeRemaining(), 0);
  assert.equal(engine.modeState.chainRewardGranted, false);
  assert.equal(texts.includes(t('gameplay.feedback.merge.chainShake')), false);
});

test('Every Basin event and chain text exists in English and French', () => {
  const keys = [
    'gameplay.feedback.merge.chain',
    'gameplay.feedback.merge.chainShake',
    'gameplay.feedback.merge.eventStart',
    'gameplay.feedback.merge.eventStartAnnounce',
    'gameplay.feedback.merge.eventEnd',
    'gameplay.feedback.merge.eventUpcoming',
    'hud.stats.mergeEvent.active',
    'hud.stats.mergeEvent.upcoming',
    'hud.stats.mergeEvent.next',
    'hud.stats.mergeEvent.aria.one',
    'hud.stats.mergeEvent.aria.other',
    'hud.stats.mergeEvent.upcomingAria'
  ];
  for (const id of ['windLeft', 'windRight', ...MERGE_EVENT_IDS_LIST.filter((eventId) => eventId !== 'wind')]) {
    for (const field of ['name', 'description', 'icon']) {
      keys.push(`gameplay.merge.events.${id}.${field}`);
    }
  }
  for (const locale of ['en', 'fr']) {
    const dictionary = loadJson(`./locales/${locale}.json`);
    for (const key of keys) {
      const value = key.split('.').reduce((node, part) => node?.[part], dictionary);
      assert.equal(typeof value, 'string', `${locale} has ${key}`);
      assert.ok(value.length > 0, `${locale} ${key} is not empty`);
    }
  }
  for (const id of MERGE_EVENT_IDS_LIST) {
    const localeIds = id === 'wind' ? ['windLeft', 'windRight'] : [id];
    for (const localeId of localeIds) {
      const event = { id, direction: localeId === 'windLeft' ? -1 : 1 };
      assert.equal(getMergeEventLocaleId(event), localeId);
    }
  }
});

test('A partial Merge config keeps the default events and chain numbers', () => {
  const partial = resolveModesConfig({ merge: { events: { pool: { wind: {} } }, chain: {} } }).merge;
  const defaults = resolveModesConfig(null).merge;
  assert.deepEqual(partial.chain, defaults.chain);
  assert.deepEqual(partial.events.pool.wind, defaults.events.pool.wind);
  assert.equal(partial.events.gapMinDrops, defaults.events.gapMinDrops);
  assert.equal(partial.events.durationDrops, defaults.events.durationDrops);
  assert.equal(partial.eventTextOffsetY, defaults.eventTextOffsetY);

  const noPool = resolveModesConfig({ merge: { events: { gapMinDrops: 3, gapMaxDrops: 4 } } }).merge;
  assert.deepEqual(Object.keys(noPool.events.pool), Object.keys(defaults.events.pool));
  assert.equal(noPool.events.gapMinDrops, 3);
  assert.equal(resolveModesConfig({ merge: { events: null } }).merge.events.durationDrops, defaults.events.durationDrops);

  const engine = createEngine();
  engine.modesConfig = resolveModesConfig({
    merge: { ...modesConfig.merge, events: { pool: { wind: {} } }, chain: {} }
  });
  engine.startMergeMode();
  withEvent(engine, 'wind', 1);
  const ball = placeBall(engine, 0, 200, 400);
  mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
  assert.ok(Number.isFinite(ball.vx) && ball.vx > 0, 'the wind falls back to its default strength');
});

test('The event view is gone once the run is over', () => {
  const engine = createEngine();
  engine.startMergeMode();
  withEvent(engine, 'bouncy');
  assert.equal(engine.getMergeEventState().active.id, 'bouncy');
  engine.triggerGameOver(GAME_OVER_REASONS.BASIN_OVERFLOW);
  assert.equal(engine.getMergeEventState(), null);
});

test('A restored telegraphed event never repeats the last one', () => {
  const source = createEngine();
  source.startMergeMode();
  source.shoot();
  source.modeState.lastEventId = 'golden';
  source.modeState.upcomingEvent = { id: 'golden', direction: 1 };
  source.modeState.dropsUntilEvent = 1;
  source.saveRunSnapshot({ force: true });
  const restored = createEngine();
  restored.storageManager = source.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.modeState.upcomingEvent, null);
  assert.equal(restored.modeState.lastEventId, 'golden');
});

test('The HUD announces a telegraphed, started and ended event once each, and nothing after a restart', () => {
  const spoken = [];
  const hud = { announce: (text) => spoken.push(text) };
  const refresh = (view) => uiHudRefreshMethods.announceMergeEventChanges.call(hud, view);
  const idle = (eventCount) => ({ eventCount, active: null, upcoming: null });
  const upcoming = (eventCount) => ({ eventCount, active: null, upcoming: { id: 'bouncy', direction: 1 } });
  const active = (eventCount, dropsLeft) => ({
    eventCount,
    active: { id: 'bouncy', direction: 1, dropsLeft },
    upcoming: null
  });
  const name = t('gameplay.merge.events.bouncy.name');

  for (let i = 0; i < 5; i += 1) {
    refresh(idle(0));
  }
  assert.deepEqual(spoken, [], 'the first refresh only records');
  for (let i = 0; i < 4; i += 1) {
    refresh(upcoming(0));
  }
  assert.deepEqual(spoken, [t('gameplay.feedback.merge.eventUpcoming', { name })]);
  for (let dropsLeft = 6; dropsLeft >= 1; dropsLeft -= 1) {
    refresh(active(1, dropsLeft));
    refresh(active(1, dropsLeft));
  }
  assert.equal(spoken.length, 2);
  assert.equal(spoken[1], t('gameplay.feedback.merge.eventStartAnnounce', {
    name,
    description: t('gameplay.merge.events.bouncy.description')
  }));
  for (let i = 0; i < 4; i += 1) {
    refresh(idle(1));
  }
  assert.equal(spoken.length, 3);
  assert.equal(spoken[2], t('gameplay.feedback.merge.eventEnd', { name }));

  // A new run replaces the old one in the middle of an event: nothing is said for the swap.
  refresh(active(2, 3));
  const before = spoken.length;
  refresh(idle(0));
  refresh(idle(0));
  assert.equal(spoken.length, before);
  refresh(null);
  refresh(active(1, 6));
  assert.equal(spoken.length, before, 'leaving the Basin forgets the old state');
});

const PRESSURE = modesConfig.merge.pressure;

const createDrawContext = () => {
  const calls = { moves: [], fills: [] };
  const ctx = {
    save() {}, restore() {}, beginPath() {}, stroke() {}, lineTo() {}, setLineDash() {},
    moveTo: (x, y) => calls.moves.push({ x, y }),
    fillRect: (x, y, w, h) => calls.fills.push({ x, y, w, h })
  };
  return { ctx, calls };
};

const dropUntilPressureApplied = (engine, limit = 40) => {
  let drops = 0;
  while (engine.modeState.lineOffsetPx === 0 && drops < limit) {
    dropOnce(engine);
    drops += 1;
  }
  return drops;
};

test('The default Merge config carries the same pressure as configs/modes.json, and a partial one keeps defaults', () => {
  assert.deepEqual(resolveModesConfig(null).merge.pressure, PRESSURE);
  const partial = resolveModesConfig({ merge: { pressure: { warnDrops: 5 } } }).merge;
  assert.equal(partial.pressure.warnDrops, 5);
  assert.equal(partial.pressure.maxOffsetPx, PRESSURE.maxOffsetPx);
  assert.equal(resolveModesConfig({ merge: { pressure: null } }).merge.pressure.pxPerTier, PRESSURE.pxPerTier);
});

test('Only fusions raise the best calibre, a drop of a big calibre never does', () => {
  const engine = createEngine();
  engine.startMergeMode();
  assert.equal(engine.mergeBestTier, 1);
  const big = modesConfig.merge.tiers.at(-1);
  engine.currentBall.colorId = big.id;
  dropOnce(engine);
  assert.equal(engine.physicsWorld.balls.at(-1).mergeTier, big.tier);
  assert.equal(engine.mergeBestTier, 1, 'a drop leaves the best calibre alone');

  engine.physicsWorld.balls.length = 0;
  engine.physicsWorld.ballMap.clear();
  placeTouchingPair(engine, 0, 200);
  mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
  assert.equal(engine.mergeBestTier, 2, 'a fusion raises it');
});

test('The pressure offset grows per fused calibre, then by steps after the top calibre, up to the cap', () => {
  const offset = (best, drops) => mergeBehavior.computeTargetOffset(PRESSURE, best, drops);
  assert.equal(offset(1, null), 0);
  assert.equal(offset(PRESSURE.fromFusedTier, null), 0);
  assert.equal(offset(PRESSURE.fromFusedTier + 1, null), PRESSURE.pxPerTier);
  assert.equal(offset(PRESSURE.topTier, null), (PRESSURE.topTier - PRESSURE.fromFusedTier) * PRESSURE.pxPerTier);
  const top = offset(PRESSURE.topTier, 0);
  assert.equal(offset(PRESSURE.topTier, PRESSURE.topTierStepDrops - 1), top);
  assert.equal(offset(PRESSURE.topTier, PRESSURE.topTierStepDrops), top + PRESSURE.pxPerStep);
  assert.equal(offset(PRESSURE.topTier, PRESSURE.topTierStepDrops * 3), top + PRESSURE.pxPerStep * 3);
  assert.equal(offset(PRESSURE.topTier, PRESSURE.topTierStepDrops * 1000), PRESSURE.maxOffsetPx);

  const engine = createEngine();
  engine.startMergeMode();
  mergeBehavior.recordFusedCalibre(engine, PRESSURE.topTier - 1);
  assert.equal(engine.modeState.topTierDrops, null);
  mergeBehavior.recordFusedCalibre(engine, PRESSURE.topTier);
  assert.equal(engine.modeState.topTierDrops, 0, 'the first fusion of the top calibre starts the count');
  dropOnce(engine);
  assert.equal(engine.modeState.topTierDrops, 1);
});

test('A rising target is pending for exactly warnDrops drops, then the line comes down at once', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const texts = [];
  engine.particleSystem.spawnFloatingText = (x, y, text) => texts.push({ y, text });
  mergeBehavior.recordFusedCalibre(engine, PRESSURE.fromFusedTier + 2);
  const target = 2 * PRESSURE.pxPerTier;
  assert.equal(engine.modeState.lineOffsetPx, 0, 'a fusion alone never moves the line');

  dropOnce(engine);
  assert.equal(engine.modeState.pendingOffsetPx, target);
  assert.equal(engine.modeState.pendingDropsLeft, PRESSURE.warnDrops);
  for (let drop = 1; drop < PRESSURE.warnDrops; drop += 1) {
    dropOnce(engine);
    assert.equal(engine.modeState.lineOffsetPx, 0);
    assert.equal(engine.modeState.pendingDropsLeft, PRESSURE.warnDrops - drop);
  }
  dropOnce(engine);
  assert.equal(engine.modeState.lineOffsetPx, target);
  assert.equal(engine.modeState.pendingOffsetPx, null);
  assert.deepEqual(engine.getMergePressureState(), { lineOffsetPx: target, pendingOffsetPx: null, pendingDropsLeft: 0 });
  const stepText = texts.find(({ text }) => text === t('gameplay.feedback.merge.pressureStep'));
  assert.ok(stepText, 'a floating text marks the step');
  assert.equal(
    stepText.y,
    modesConfig.merge.overflowLineY + modesConfig.merge.eventTextOffsetY - gameConfig.canvas.floatingTextOffsetY,
    'it sits at the base line, one text line below the event text'
  );
  assert.equal(engine.modesConfig.merge.overflowLineY, modesConfig.merge.overflowLineY, 'the config is never mutated');
});

test('A fusion mid-cascade does not jump the line, it goes through the telegraph', () => {
  const engine = createEngine();
  engine.startMergeMode();
  placeTouchingPair(engine, 0, 200);
  mergeBehavior.recordFusedCalibre(engine, PRESSURE.topTier);
  mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
  assert.equal(engine.modeState.lineOffsetPx, 0);
  assert.equal(engine.modeState.pendingOffsetPx, null, 'nothing is pending before the next drop');
});

test('A settled sphere in the way holds the step for holdMaxDrops, then it applies with extra grace', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const cfg = modesConfig.merge;
  const state = engine.modeState;
  mergeBehavior.recordFusedCalibre(engine, PRESSURE.fromFusedTier + 1);
  const target = PRESSURE.pxPerTier;
  dropOnce(engine);
  const spec = cfg.tiers[3];
  const heldY = cfg.overflowLineY + 5 + spec.radius;
  const held = placeBall(engine, 3, 235, heldY, { vy: 0 });
  for (let drop = 0; drop < PRESSURE.warnDrops; drop += 1) {
    dropOnce(engine);
  }
  assert.equal(state.lineOffsetPx, 0, 'held by the settled sphere');
  assert.equal(state.holdDrops, 1);
  for (let hold = 2; hold <= PRESSURE.holdMaxDrops; hold += 1) {
    dropOnce(engine);
    assert.equal(state.holdDrops, hold);
    assert.equal(state.lineOffsetPx, 0);
  }
  held.mergeOverflowSec = 1;
  dropOnce(engine);
  assert.equal(state.lineOffsetPx, target, 'applied anyway once the hold is spent');
  assert.equal(state.holdDrops, 0);
  assert.equal(held.mergeOverflowSec, 0, 'overflow timers restart');
  assert.ok(held.mergeGraceSec >= cfg.overflowGraceSec * PRESSURE.stepGraceFactor);

  for (const ball of [...engine.physicsWorld.balls]) {
    if (ball !== held) {
      engine.physicsWorld.removeBall(ball);
    }
  }
  const stepDt = 0.1;
  for (let elapsed = 0; elapsed < cfg.overflowGraceSec * PRESSURE.stepGraceFactor - stepDt * 2; elapsed += stepDt) {
    held.y = heldY;
    held.vy = 0;
    mergeBehavior.onBeforePhysicsStep(engine, stepDt);
    assert.equal(engine.state, GAME_STATES.PLAYING, 'no game over within the extended grace');
  }
});

test('A clear path applies the step as soon as the telegraph ends, and graces spheres above the new line', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const cfg = modesConfig.merge;
  mergeBehavior.recordFusedCalibre(engine, PRESSURE.fromFusedTier + 1);
  dropOnce(engine);
  const moving = placeBall(engine, 3, 235, cfg.overflowLineY + 5 + cfg.tiers[3].radius, { vy: 400 });
  const drops = dropUntilPressureApplied(engine);
  assert.equal(drops, PRESSURE.warnDrops, 'a moving sphere does not hold the step');
  assert.ok(
    moving.mergeGraceSec >= cfg.overflowGraceSec * PRESSURE.stepGraceFactor,
    'every step graces the spheres above the new line'
  );
});

test('A higher target replaces a pending step without restarting its countdown', () => {
  const engine = createEngine();
  engine.startMergeMode();
  mergeBehavior.recordFusedCalibre(engine, PRESSURE.fromFusedTier + 1);
  dropOnce(engine);
  dropOnce(engine);
  assert.equal(engine.modeState.pendingOffsetPx, PRESSURE.pxPerTier);
  const left = engine.modeState.pendingDropsLeft;
  mergeBehavior.recordFusedCalibre(engine, PRESSURE.fromFusedTier + 3);
  dropOnce(engine);
  assert.equal(engine.modeState.pendingOffsetPx, 3 * PRESSURE.pxPerTier);
  assert.equal(engine.modeState.pendingDropsLeft, left - 1, 'the countdown keeps running');
});

test('A restore graces spheres above the restored line and drops a no-op pending step', () => {
  const cfg = modesConfig.merge;
  const source = createEngine();
  source.startMergeMode();
  source.shoot();
  placeBall(source, 2, 235, cfg.overflowLineY + 30 + cfg.tiers[2].radius);
  Object.assign(source.modeState, {
    lineOffsetPx: 4 * PRESSURE.pxPerTier,
    pendingOffsetPx: 2 * PRESSURE.pxPerTier,
    pendingDropsLeft: 2
  });
  source.saveRunSnapshot({ force: true });
  const restored = createEngine();
  restored.storageManager = source.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.modeState.pendingOffsetPx, null, 'a pending step that is not below the line is dropped');
  const lineY = mergeBehavior.getOverflowLineY(restored);
  const above = restored.physicsWorld.balls.filter((ball) => ball.y - ball.radius < lineY);
  assert.ok(above.length > 0);
  for (const ball of above) {
    assert.ok(ball.mergeGraceSec >= cfg.overflowGraceSec * PRESSURE.stepGraceFactor);
  }
});

test('Grace pauses the overflow timer but the danger line still reacts', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const cfg = modesConfig.merge;
  const ball = placeBall(engine, 2, 235, cfg.overflowLineY + 10, { mergeGraceSec: PRESSURE.shakeGraceSec });
  mergeBehavior.onBeforePhysicsStep(engine, 0.05);
  assert.ok(engine.modeState.maxOverflowRatio > 0, 'the ratio is not hidden by grace');
  assert.equal(ball.mergeOverflowSec || 0, 0, 'the timer itself stays paused');
  assert.equal(engine.state, GAME_STATES.PLAYING);
});

test('A dropped sphere keeps its entry grace until it passes below the lowered line, capped', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const cfg = modesConfig.merge;
  engine.modeState.lineOffsetPx = 4 * PRESSURE.pxPerTier;
  const lineY = mergeBehavior.getOverflowLineY(engine);
  assert.equal(lineY, cfg.overflowLineY + 4 * PRESSURE.pxPerTier);
  dropOnce(engine);
  const [first] = engine.physicsWorld.balls;
  const holdAbove = (ball, seconds) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
      ball.y = cfg.launcherY + 20;
      ball.vy = 0;
      mergeBehavior.onBeforePhysicsStep(engine, 0.1);
    }
  };
  holdAbove(first, 1.5);
  assert.ok(first.mergeGraceSec > 0, 'still protected after the fixed 0.85 s while above the line');
  first.y = lineY + first.radius + 10;
  mergeBehavior.onBeforePhysicsStep(engine, 0.1);
  mergeBehavior.onBeforePhysicsStep(engine, 0.1);
  assert.equal(first.mergeEntering, false);
  assert.equal(first.mergeGraceSec, 0, 'the grace ends once it is below the line');

  engine.physicsWorld.removeBall(first);
  dropOnce(engine);
  const [capped] = engine.physicsWorld.balls;
  holdAbove(capped, PRESSURE.entryGraceMaxSec + 0.5);
  assert.equal(capped.mergeEntering, false, 'the entry grace is capped');
  assert.equal(capped.mergeGraceSec, 0);
});

test('A shake gives every sphere grace, and never shortens a longer one', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const plain = placeBall(engine, 1, 100, 400);
  const longer = placeBall(engine, 1, 200, 400, { mergeGraceSec: PRESSURE.shakeGraceSec + 3 });
  assert.equal(mergeBehavior.shake(engine), true);
  assert.equal(plain.mergeGraceSec, PRESSURE.shakeGraceSec);
  assert.equal(longer.mergeGraceSec, PRESSURE.shakeGraceSec + 3);
});

test('Overflow detection uses the lowered line, while walls and event text keep the base line', () => {
  const cfg = modesConfig.merge;
  const lowered = 4 * PRESSURE.pxPerTier;
  const run = (offset) => {
    const engine = createEngine();
    engine.startMergeMode();
    engine.modeState.lineOffsetPx = offset;
    const spec = cfg.tiers[2];
    const ball = placeBall(engine, 2, 235, cfg.overflowLineY + 30 + spec.radius);
    ball.mergeOverflowSec = cfg.overflowGraceSec - 0.05;
    mergeBehavior.onBeforePhysicsStep(engine, 0.1);
    return engine;
  };
  assert.equal(run(0).state, GAME_STATES.PLAYING, 'below the base line is safe on the base line');
  const over = run(lowered);
  assert.equal(over.state, GAME_STATES.GAME_OVER);
  assert.equal(over.gameOverSummary?.reasonKey, GAME_OVER_REASONS.BASIN_OVERFLOW);

  const engine = createEngine();
  engine.startMergeMode();
  engine.modeState.lineOffsetPx = lowered;
  engine.modeState.pendingOffsetPx = lowered + PRESSURE.pxPerTier;
  const { ctx, calls } = createDrawContext();
  mergeBehavior.drawUnderlay(ctx, engine, null, gameConfig.theme);
  const points = calls.moves.map(({ x, y }) => `${x}:${y}`);
  const pendingY = cfg.overflowLineY + lowered + PRESSURE.pxPerTier;
  assert.ok(points.includes(`${cfg.basinLeftX}:${cfg.overflowLineY - 24}`), 'the walls start at the base line');
  assert.ok(points.includes(`${cfg.basinLeftX + 4}:${cfg.overflowLineY + lowered}`), 'the danger line is lowered');
  assert.ok(points.includes(`${cfg.basinLeftX + 4}:${pendingY}`), 'the pending line is drawn dashed');
  assert.ok(
    points.includes(`${cfg.basinLeftX}:${pendingY}`) && points.includes(`${cfg.basinRightX}:${pendingY}`),
    'tick marks sit on both walls'
  );
  assert.ok(
    calls.fills.some(({ y, h }) => y === cfg.overflowLineY && h === lowered),
    'the band between the base and the lowered line is shaded'
  );

  const texts = [];
  engine.particleSystem.spawnFloatingText = (x, y) => texts.push(y);
  mergeBehavior.startEvent(engine);
  assert.equal(texts[0], cfg.overflowLineY + cfg.eventTextOffsetY, 'event text keeps the base line');
});

test('A snapshot keeps a pending step and the top calibre count, and a legacy snapshot derives the line', () => {
  const source = createEngine();
  source.startMergeMode();
  source.shoot();
  Object.assign(source.modeState, {
    lineOffsetPx: 2 * PRESSURE.pxPerTier,
    pendingOffsetPx: 3 * PRESSURE.pxPerTier,
    pendingDropsLeft: 2,
    holdDrops: 1,
    topTierDrops: 7
  });
  source.saveRunSnapshot({ force: true });
  const restored = createEngine();
  restored.storageManager = source.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.modeState.lineOffsetPx, 2 * PRESSURE.pxPerTier);
  assert.equal(restored.modeState.pendingOffsetPx, 3 * PRESSURE.pxPerTier);
  assert.equal(restored.modeState.pendingDropsLeft, 2);
  assert.equal(restored.modeState.holdDrops, 1);
  assert.equal(restored.modeState.topTierDrops, 7);

  const legacyFrom = (bestTier) => {
    const legacySource = createEngine();
    legacySource.startMergeMode();
    legacySource.shoot();
    legacySource.mergeBestTier = bestTier;
    legacySource.saveRunSnapshot({ force: true });
    const snapshot = legacySource.storageManager.loadRunSnapshot();
    for (const field of ['lineOffsetPx', 'pendingOffsetPx', 'pendingDropsLeft', 'holdDrops', 'topTierDrops']) {
      delete snapshot.modeState[field];
    }
    snapshot.modeState.bestTier = bestTier;
    legacySource.storageManager.saveRunSnapshot(snapshot);
    const legacy = createEngine();
    legacy.storageManager = legacySource.storageManager;
    assert.equal(legacy.restoreSavedRun(), true);
    return legacy;
  };
  const low = legacyFrom(PRESSURE.fromFusedTier);
  assert.equal(low.modeState.lineOffsetPx, 0);
  assert.equal(low.modeState.topTierDrops, null);
  const high = legacyFrom(PRESSURE.topTier);
  assert.equal(
    high.modeState.lineOffsetPx,
    (PRESSURE.topTier - PRESSURE.fromFusedTier) * PRESSURE.pxPerTier
  );
  assert.equal(high.modeState.topTierDrops, 0);
  assert.equal(high.modeState.pendingOffsetPx, null);
  assert.equal(high.mergeBestTier, PRESSURE.topTier, 'a legacy best calibre is kept as saved');
});

test('The pressure view is gone outside a live Basin run', () => {
  const engine = createEngine();
  assert.equal(engine.getMergePressureState(), null);
  engine.startMergeMode();
  assert.deepEqual(engine.getMergePressureState(), { lineOffsetPx: 0, pendingOffsetPx: null, pendingDropsLeft: 0 });
  engine.triggerGameOver(GAME_OVER_REASONS.BASIN_OVERFLOW);
  assert.equal(engine.getMergePressureState(), null);
});

test('The HUD announces a telegraphed step and the line coming down once each, and nothing after a restart', () => {
  const spoken = [];
  const hud = { announce: (text) => spoken.push(text) };
  const refresh = (view) => uiHudRefreshMethods.announceMergePressureChanges.call(hud, view);
  const view = (lineOffsetPx, pendingOffsetPx = null, pendingDropsLeft = 0) => ({
    lineOffsetPx, pendingOffsetPx, pendingDropsLeft
  });

  for (let i = 0; i < 4; i += 1) {
    refresh(view(0));
  }
  assert.deepEqual(spoken, [], 'the first refresh only records');
  for (let i = 0; i < 4; i += 1) {
    refresh(view(0, 15, PRESSURE.warnDrops));
  }
  refresh(view(0, 15, PRESSURE.warnDrops - 1));
  assert.deepEqual(spoken, [t('gameplay.feedback.merge.pressureWarning.other', { count: PRESSURE.warnDrops })]);
  refresh(view(15));
  refresh(view(15));
  assert.equal(spoken.length, 2);
  assert.equal(spoken[1], t('gameplay.feedback.merge.pressureStepAnnounce'));

  refresh(view(0, 15, 1));
  refresh(view(0));
  assert.equal(spoken.length, 2, 'a lower offset is a new run');
  refresh(null);
  refresh(view(30));
  assert.equal(spoken.length, 2, 'leaving the Basin forgets the old state');
  refresh(view(30, 45, 1));
  assert.equal(spoken[2], t('gameplay.feedback.merge.pressureWarning.one', { count: 1 }));
});

test('Every pressure text exists in English and French', () => {
  const keys = [
    'gameplay.feedback.merge.pressureStep',
    'gameplay.feedback.merge.pressureStepAnnounce',
    'gameplay.feedback.merge.pressureWarning.one',
    'gameplay.feedback.merge.pressureWarning.other'
  ];
  for (const locale of ['en', 'fr']) {
    const dictionary = loadJson(`./locales/${locale}.json`);
    for (const key of keys) {
      const value = key.split('.').reduce((node, part) => node?.[part], dictionary);
      assert.equal(typeof value, 'string', `${locale} has ${key}`);
      assert.ok(value.length > 0, `${locale} ${key} is not empty`);
    }
  }
  const fr = loadJson('./locales/fr.json').gameplay.feedback.merge.pressureWarning;
  assert.ok(fr.one.includes('lâcher') && fr.other.includes('lâchers'));
});

test('Merge Basin has twelve calibres, each with a distinct fill and a symbol', () => {
  const { tiers } = modesConfig.merge;
  assert.equal(tiers.length, 12);
  assert.equal(new Set(tiers.map((spec) => spec.fill.toLowerCase())).size, tiers.length, 'fills are all distinct');
  assert.equal(new Set(tiers.map((spec) => spec.id)).size, tiers.length);
  tiers.forEach((spec, index) => {
    assert.equal(spec.tier, index);
    assert.equal(spec.symbol, String(index + 1), 'the symbol is the non-colour cue');
    assert.ok(spec.radius > 0 && spec.points > 0);
    if (index > 0) {
      assert.ok(spec.radius > tiers[index - 1].radius && spec.points > tiers[index - 1].points);
      assert.equal(spec.polarity, -tiers[index - 1].polarity, 'polarity alternates');
    }
  });
});

test('The default Merge tiers and Supernova numbers match configs/modes.json', () => {
  const defaults = resolveModesConfig(null).merge;
  const { tiers } = modesConfig.merge;
  assert.equal(defaults.tiers.length, tiers.length);
  tiers.forEach((spec, index) => {
    for (const field of ['id', 'tier', 'radius', 'points', 'symbol', 'polarity', 'fill', 'highlight', 'shadow', 'glow', 'pattern']) {
      assert.equal(defaults.tiers[index][field], spec[field], `${spec.id}.${field}`);
    }
  });
  assert.equal(defaults.supernovaBonus, modesConfig.merge.supernovaBonus);
  assert.equal(defaults.pressure.topTier, modesConfig.merge.pressure.topTier);
  assert.equal(modesConfig.merge.pressure.topTier, tiers.length - 1);
});

test('Two calibre 11 spheres fuse into calibre 12', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const eleven = modesConfig.merge.tiers.length - 2;
  const spec = modesConfig.merge.tiers[eleven];
  const y = modesConfig.merge.basinFloorY - spec.radius;
  placeBall(engine, eleven, 200, y);
  placeBall(engine, eleven, 200 + spec.radius * 2 - 0.5, y);
  mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
  assert.equal(engine.physicsWorld.balls.length, 1);
  assert.equal(engine.physicsWorld.balls[0].mergeTier, eleven + 1);
  assert.equal(engine.mergeBestTier, eleven + 2);
});

test('Two calibre 12 spheres trigger a Supernova worth the bonus times the combo', () => {
  const engine = createEngine();
  engine.startMergeMode();
  const last = modesConfig.merge.tiers.length - 1;
  const spec = modesConfig.merge.tiers[last];
  placeBall(engine, last, 200, 500);
  placeBall(engine, last, 200 + spec.radius * 2 - 1, 500);
  const before = engine.score;
  mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
  assert.equal(engine.physicsWorld.balls.length, 0);
  assert.equal(engine.modeState.supernovas, 1);
  assert.equal(engine.score - before, modesConfig.merge.supernovaBonus * Math.max(1, engine.combo));
});

const SHAPES = modesConfig.merge.shapes;
const SHAPE_IDS = SHAPES.ids;
/** Roll that lands on a shape: the middle of its slice of the equally weighted list. */
const rollFor = (id) => (SHAPE_IDS.indexOf(id) + MATH_CONSTANTS.HALF) / SHAPE_IDS.length;
/** Overlap with a wall or a peg that stays unnoticeable: one solver pass can leave a sliver. */
const SHAPE_OVERLAP_TOLERANCE_PX = 1.5;
const SHAPE_DROP_COUNT = 24;
const SHAPE_SETTLE_FRAMES = 40;
/** Every this many drops, a top calibre sphere is thrown at a wall. */
const SHAPE_WALL_THROW_EVERY = 8;
const SHAPE_WALL_THROW_SPEED = 300;

const startShape = (id) => {
  const engine = createEngine(rollFor(id));
  engine.startMergeMode();
  return engine;
};

test('Every shape is drawn from its own slice of the shape roll, and the run keeps it', () => {
  for (const id of SHAPE_IDS) {
    const engine = startShape(id);
    assert.equal(engine.modeState.shapeId, id);
    assert.equal(engine.getMergeShapeState().shapeId, id);
  }
  assert.deepEqual(SHAPE_IDS, ['classic', 'narrow', 'pegs']);
  assert.equal(mergeBehavior.pickShapeId(startShape('classic'), 0.999), 'pegs');
});

test('Unequal weights shift the draw, and an unknown id list falls back to the classic basin', () => {
  const engine = startShape('classic');
  engine.modesConfig = resolveModesConfig({ merge: { shapes: { weights: { classic: 0, narrow: 3, pegs: 1 } } } });
  assert.equal(mergeBehavior.pickShapeId(engine, 0), 'narrow');
  assert.equal(mergeBehavior.pickShapeId(engine, 0.9), 'pegs');
  engine.modesConfig = resolveModesConfig({ merge: { shapes: { ids: ['bogus'] } } });
  assert.equal(mergeBehavior.pickShapeId(engine, 0.5), 'classic');
});

test('The geometry of each shape is derived from the config and never mutates it', () => {
  const cfg = modesConfig.merge;
  const before = JSON.stringify(cfg);
  const classic = mergeBehavior.getBasinGeometry(startShape('classic'));
  assert.deepEqual(classic, { left: cfg.basinLeftX, right: cfg.basinRightX, floor: cfg.basinFloorY, pegs: [] });
  const narrow = mergeBehavior.getBasinGeometry(startShape('narrow'));
  assert.equal(narrow.left, cfg.basinLeftX + SHAPES.narrow.insetPx);
  assert.equal(narrow.right, cfg.basinRightX - SHAPES.narrow.insetPx);
  assert.equal(narrow.pegs.length, 0);
  const pegged = mergeBehavior.getBasinGeometry(startShape('pegs'));
  assert.equal(pegged.left, cfg.basinLeftX);
  assert.equal(pegged.pegs.length, SHAPES.pegs.positions.length);
  pegged.pegs.forEach((peg, index) => {
    const spec = SHAPES.pegs.positions[index];
    assert.equal(peg.x, cfg.basinLeftX + spec.xFrac * (cfg.basinRightX - cfg.basinLeftX));
    assert.equal(peg.y, cfg.basinFloorY - spec.yFromFloorPx);
    assert.equal(peg.radius, SHAPES.pegs.radius);
  });
  assert.equal(JSON.stringify(cfg), before);
});

test('Peg gaps never trap a sphere: each is at least the largest diameter, or under the smallest', () => {
  const cfg = modesConfig.merge;
  const diameters = cfg.tiers.map((spec) => spec.radius * 2);
  const smallest = Math.min(...diameters);
  const largest = Math.max(...diameters);
  const { pegs } = mergeBehavior.getBasinGeometry(startShape('pegs'));
  const { radius } = SHAPES.pegs;
  const gaps = [];
  for (const peg of pegs) {
    gaps.push(peg.x - radius - cfg.basinLeftX, cfg.basinRightX - peg.x - radius, cfg.basinFloorY - peg.y - radius);
  }
  for (let i = 0; i < pegs.length; i += 1) {
    for (let j = i + 1; j < pegs.length; j += 1) {
      gaps.push(Math.hypot(pegs[i].x - pegs[j].x, pegs[i].y - pegs[j].y) - radius * 2);
    }
  }
  assert.ok(gaps.length > 0);
  for (const gap of gaps) {
    assert.ok(gap >= largest || gap < smallest, `gap ${gap} must be >= ${largest} or < ${smallest}`);
  }
  const middleY = (cfg.overflowLineY + cfg.basinFloorY) * MATH_CONSTANTS.HALF;
  for (const peg of pegs) {
    assert.ok(peg.y >= middleY, 'pegs sit in the lower half');
  }
});

test('The drop clamp follows the shape: the narrow walls hold the rail in', () => {
  const engine = startShape('narrow');
  const { left, right } = mergeBehavior.getBasinGeometry(engine);
  engine.updateAim(-500, 300);
  assert.equal(engine.mergeDropX, left + engine.currentBall.radius);
  engine.updateAim(5000, 300);
  assert.equal(engine.mergeDropX, right - engine.currentBall.radius);
  assert.ok(left > modesConfig.merge.basinLeftX);
});

for (const id of SHAPE_IDS) {
  test(`No sphere leaves the ${id} basin or sinks into a peg, calibre 12 at the walls included`, () => {
    const cfg = modesConfig.merge;
    const engine = startShape(id);
    const geometry = mergeBehavior.getBasinGeometry(engine);
    const random = new SeededRandom(`shape-containment-${id}`);
    engine.random = () => random.next();
    const check = () => {
      for (const ball of engine.physicsWorld.balls) {
        assert.ok(geometry.left <= ball.x - ball.radius + SHAPE_OVERLAP_TOLERANCE_PX, 'left wall');
        assert.ok(ball.x + ball.radius <= geometry.right + SHAPE_OVERLAP_TOLERANCE_PX, 'right wall');
        assert.ok(ball.y + ball.radius <= geometry.floor + SHAPE_OVERLAP_TOLERANCE_PX, `floor ${ball.y + ball.radius - geometry.floor} r${ball.radius}`);
        for (const peg of geometry.pegs) {
          const overlap = ball.radius + peg.radius - Math.hypot(ball.x - peg.x, ball.y - peg.y);
          assert.ok(overlap <= SHAPE_OVERLAP_TOLERANCE_PX, `peg overlap ${overlap}`);
        }
      }
    };
    const biggest = cfg.tiers.length - 1;
    for (let drop = 0; drop < SHAPE_DROP_COUNT; drop += 1) {
      engine.updateAim(geometry.left + random.next() * (geometry.right - geometry.left), cfg.launcherY);
      engine.modeState.dropCooldownSec = 0;
      engine.shoot();
      if (drop % SHAPE_WALL_THROW_EVERY === 0) {
        const towardsLeft = drop % (SHAPE_WALL_THROW_EVERY * 2) === 0;
        const edge = towardsLeft ? geometry.left : geometry.right;
        placeBall(engine, biggest, edge, cfg.launcherY * 2, {
          vx: towardsLeft ? -SHAPE_WALL_THROW_SPEED : SHAPE_WALL_THROW_SPEED,
          vy: SHAPE_WALL_THROW_SPEED
        });
      }
      for (let frame = 0; frame < SHAPE_SETTLE_FRAMES; frame += 1) {
        engine.update();
        if (!engine.isRunPlaying()) break;
        check();
      }
      if (!engine.isRunPlaying()) break;
    }
    assert.ok(engine.physicsWorld.balls.length > 0);
  });
}

test('A peg deflects a falling sphere and bounces it by the peg restitution', () => {
  const engine = startShape('pegs');
  const [peg] = mergeBehavior.getBasinGeometry(engine).pegs;
  const spec = modesConfig.merge.tiers[0];
  const speed = 300;
  const ball = new Ball({ x: peg.x, y: peg.y - peg.radius - spec.radius + 1, vx: 0, vy: speed, radius: spec.radius, colorId: spec.id });
  mergeBehavior.collideWithPeg(ball, peg, SHAPES.pegs.restitution);
  assert.ok(ball.vy < 0, 'a head-on hit reverses the fall');
  assert.ok(Math.abs(ball.vy + speed * SHAPES.pegs.restitution) < 1e-6);
  assert.ok(Math.hypot(ball.x - peg.x, ball.y - peg.y) >= peg.radius + spec.radius - 1e-6, 'pushed out of the peg');

  const free = startShape('classic');
  const fall = (engineUnderTest) => {
    const dropped = placeBall(engineUnderTest, 0, peg.x + peg.radius, peg.y - 140, { vy: 120 });
    for (let frame = 0; frame < 60; frame += 1) engineUnderTest.update();
    return dropped.x;
  };
  assert.ok(Math.abs(fall(engine) - fall(free)) > spec.radius, 'the peg sends the sphere sideways');
});

test('A snapshot keeps the shape, a legacy snapshot restores the classic basin, and an unknown id is sanitized', () => {
  for (const id of SHAPE_IDS) {
    const source = startShape(id);
    source.shoot();
    source.saveRunSnapshot({ force: true });
    assert.equal(source.storageManager.loadRunSnapshot().modeState.shapeId, id);
    const restored = createEngine(rollFor('classic'));
    restored.storageManager = source.storageManager;
    assert.equal(restored.restoreSavedRun(), true);
    assert.equal(restored.modeState.shapeId, id);
    assert.deepEqual(mergeBehavior.getBasinGeometry(restored), mergeBehavior.getBasinGeometry(source));
    assert.equal(restored.getMergeShapeState().announceSerial, null, 'a restored run is not announced again');
  }
  const legacySource = startShape('pegs');
  legacySource.shoot();
  legacySource.saveRunSnapshot({ force: true });
  const snapshot = legacySource.storageManager.loadRunSnapshot();
  delete snapshot.modeState.shapeId;
  legacySource.storageManager.saveRunSnapshot(snapshot);
  const legacy = createEngine(rollFor('pegs'));
  legacy.storageManager = legacySource.storageManager;
  assert.equal(legacy.restoreSavedRun(), true);
  assert.equal(legacy.modeState.shapeId, 'classic');
  snapshot.modeState.shapeId = 'bogus';
  legacySource.storageManager.saveRunSnapshot(snapshot);
  const bogus = createEngine(rollFor('pegs'));
  bogus.storageManager = legacySource.storageManager;
  assert.equal(bogus.restoreSavedRun(), true);
  assert.equal(bogus.modeState.shapeId, 'classic');
});

test('A per-shape pressure override is merged over the base pressure for that shape only', () => {
  const engine = startShape('classic');
  assert.deepEqual(mergeBehavior.getPressureConfig(engine), modesConfig.merge.pressure, 'no override keeps the base numbers');
  engine.modeState.shapeId = 'narrow';
  const override = { warnDrops: PRESSURE.warnDrops + 2 };
  engine.modesConfig = resolveModesConfig({
    merge: { shapes: { narrow: { pressure: override }, pegs: { pressure: { warnDrops: 1 } } } }
  });
  const merged = mergeBehavior.getPressureConfig(engine);
  assert.equal(merged.warnDrops, override.warnDrops);
  assert.equal(merged.pxPerStep, PRESSURE.pxPerStep);
  engine.modeState.shapeId = 'classic';
  assert.equal(mergeBehavior.getPressureConfig(engine).warnDrops, PRESSURE.warnDrops);
  engine.modeState.shapeId = 'narrow';
  engine.mergeBestTier = PRESSURE.fromFusedTier + 1;
  mergeBehavior.advancePressure(engine);
  assert.equal(engine.modeState.pendingDropsLeft, override.warnDrops, 'the telegraph uses the shape numbers');
});

test('The default Merge config carries the same shapes as configs/modes.json, and a partial config keeps the rest', () => {
  assert.deepEqual(resolveModesConfig(null).merge.shapes, SHAPES);
  const partial = resolveModesConfig({ merge: { shapes: { narrow: { insetPx: 10 } } } }).merge.shapes;
  assert.equal(partial.narrow.insetPx, 10);
  assert.deepEqual(partial.pegs, SHAPES.pegs);
  assert.deepEqual(partial.ids, SHAPE_IDS);
});

test('A fresh run names its shape in a floating text, and the HUD announces it once', () => {
  const texts = [];
  const engine = createEngine(rollFor('narrow'));
  engine.particleSystem.spawnFloatingText = (x, y, text) => texts.push(text);
  engine.startMergeMode();
  assert.ok(texts.includes(t('gameplay.feedback.merge.shapeStart', { name: t('gameplay.merge.shapes.narrow.name') })));

  const spoken = [];
  const hud = { announce: (text) => spoken.push(text) };
  const announce = (view) => uiHudRefreshMethods.announceMergeShape.call(hud, view);
  announce(engine.getMergeShapeState());
  announce(engine.getMergeShapeState());
  assert.deepEqual(spoken, [t('gameplay.feedback.merge.shapeAnnounce', {
    name: t('gameplay.merge.shapes.narrow.name'),
    description: t('gameplay.merge.shapes.narrow.description')
  })]);
  announce(null);
  announce(engine.getMergeShapeState());
  assert.equal(spoken.length, 2, 'leaving the Basin forgets what was announced');
  announce({ shapeId: 'pegs', announceSerial: null });
  assert.equal(spoken.length, 2, 'a restored run stays silent');
});

test('Every shape text exists in English and French, with the Basin vocabulary', () => {
  const keys = ['gameplay.feedback.merge.shapeStart', 'gameplay.feedback.merge.shapeAnnounce'];
  for (const id of SHAPE_IDS) {
    keys.push(`gameplay.merge.shapes.${id}.name`, `gameplay.merge.shapes.${id}.description`);
  }
  const read = (dictionary, key) => key.split('.').reduce((node, part) => node?.[part], dictionary);
  for (const locale of ['en', 'fr']) {
    const dictionary = loadJson(`./locales/${locale}.json`);
    for (const key of keys) {
      const value = read(dictionary, key);
      assert.equal(typeof value, 'string', `${locale} has ${key}`);
      assert.ok(value.length > 0);
    }
  }
  const fr = loadJson('./locales/fr.json');
  assert.ok(read(fr, 'gameplay.feedback.merge.shapeStart').startsWith('Bassin'));
  assert.ok(read(fr, 'gameplay.merge.shapes.narrow.name').length > 0);
});

test('Restoring a saved Basin run announces nothing and spawns no shape text, and keeps the saved shape', () => {
  const source = startShape('pegs');
  source.shoot();
  source.saveRunSnapshot({ force: true });

  const texts = [];
  const spoken = [];
  const hud = { announce: (text) => spoken.push(text) };
  const restored = createEngine(rollFor('classic'));
  restored.storageManager = source.storageManager;
  restored.particleSystem.spawnFloatingText = (x, y, text) => texts.push(text);
  restored.onStateChange = () => uiHudRefreshMethods.announceMergeShape.call(hud, restored.getMergeShapeState());
  assert.equal(restored.restoreSavedRun(), true);
  uiHudRefreshMethods.announceMergeShape.call(hud, restored.getMergeShapeState());
  assert.equal(restored.modeState.shapeId, 'pegs');
  assert.deepEqual(spoken, []);
  assert.equal(texts.some((text) => text.includes(t('gameplay.merge.shapes.classic.name'))), false);
  assert.equal(texts.some((text) => text === t('gameplay.feedback.merge.shapeStart', { name: t('gameplay.merge.shapes.pegs.name') })), false);
});

test('Two fresh runs of one engine get distinct announce serials', () => {
  const engine = startShape('classic');
  const first = engine.getMergeShapeState().announceSerial;
  engine.startMergeMode();
  assert.ok(engine.getMergeShapeState().announceSerial > first);
});

test('A step ends with every sphere inside the basin and no velocity heading into the floor', () => {
  const engine = startShape('classic');
  const { floor } = mergeBehavior.getBasinGeometry(engine);
  const spec = modesConfig.merge.tiers[0];
  const ball = placeBall(engine, 0, 200, floor - spec.radius, { vx: 50, vy: 400 });
  mergeBehavior.onBeforePhysicsStep(engine, 1 / 60);
  assert.ok(ball.y + ball.radius <= floor);
  assert.ok(ball.vy <= 0);
});

test('A fused sphere born on a peg is pushed out of it and stays inside the basin', () => {
  const engine = startShape('pegs');
  const geometry = mergeBehavior.getBasinGeometry(engine);
  const [peg] = geometry.pegs;
  const spec = modesConfig.merge.tiers[0];
  const a = placeBall(engine, 0, peg.x - spec.radius, peg.y, {});
  const b = placeBall(engine, 0, peg.x + spec.radius, peg.y, {});
  mergeBehavior.resolveMergePairs(engine, [[a, b]]);
  const [merged] = engine.physicsWorld.balls;
  assert.equal(merged.mergeTier, 1);
  assert.ok(Math.hypot(merged.x - peg.x, merged.y - peg.y) >= merged.radius + peg.radius - 1e-6);
  assert.ok(merged.x - merged.radius >= geometry.left && merged.y + merged.radius <= geometry.floor);
});

test('A malformed peg list falls back to the default positions or skips the bad entries', () => {
  const engine = startShape('pegs');
  const defaults = SHAPES.pegs.positions.length;
  const geometryFor = (positions) => {
    const { merge } = engine.modesConfig;
    engine.modesConfig = {
      ...engine.modesConfig,
      merge: { ...merge, shapes: { ...merge.shapes, pegs: { ...SHAPES.pegs, positions } } }
    };
    return mergeBehavior.getBasinGeometry(engine);
  };
  assert.equal(geometryFor('nope').pegs.length, defaults);
  assert.equal(geometryFor([null, { xFrac: 'a' }]).pegs.length, defaults);
  const mixed = geometryFor([{ xFrac: 0.5, yFromFloorPx: 200 }, { xFrac: Number.NaN, yFromFloorPx: 1 }]);
  assert.equal(mixed.pegs.length, 1);
  assert.ok(mixed.pegs.every((peg) => Number.isFinite(peg.x) && Number.isFinite(peg.y)));
});

test('The narrow and pegs shapes carry gentler pressure, and the classic basin keeps the base numbers', () => {
  assert.deepEqual(mergeBehavior.getPressureConfig(startShape('classic')), PRESSURE);
  const narrow = mergeBehavior.getPressureConfig(startShape('narrow'));
  assert.equal(narrow.topTierStepDrops, 50);
  assert.equal(narrow.pxPerTier, 12);
  assert.equal(narrow.maxOffsetPx, 180);
  const pegs = mergeBehavior.getPressureConfig(startShape('pegs'));
  assert.equal(pegs.topTierStepDrops, 50);
  assert.equal(pegs.pxPerTier, PRESSURE.pxPerTier);
  assert.equal(pegs.maxOffsetPx, 180);
});

const CONTRACTS = modesConfig.merge.contracts;
const CONTRACT_TYPE_IDS = Object.keys(CONTRACTS.types);
const SHAKE_FULL = modesConfig.merge.shake.rechargeDrops;
const ROLL_FIRST_TYPE = 0;

/** Engine whose contract type roll is forced, so a test picks the type of the next contract. */
const createContractEngine = (typeRoll = ROLL_FIRST_TYPE, seed = 'merge-contracts') => {
  const engine = createEventEngine(seed);
  const drawSeededRoll = engine.drawSeededRoll.bind(engine);
  engine.drawSeededRoll = (stream, index) => (
    stream === 'mergeContract' ? typeRoll : drawSeededRoll(stream, index)
  );
  return engine;
};

const dropUntilContract = (engine, limit = 60) => {
  let drops = 0;
  while (!engine.modeState.contract && drops < limit) {
    dropOnce(engine);
    drops += 1;
  }
  return drops;
};

const forceContract = (engine, contract) => {
  engine.modeState.contract = { progress: 0, dropsLeft: CONTRACTS.durationDrops, ...contract };
  engine.modeState.contractCount = 1;
};

const stepFusions = (engine) => mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);

test('The default Merge config carries the same contracts as configs/modes.json, and a partial one keeps defaults', () => {
  const defaults = resolveModesConfig(null).merge;
  assert.deepEqual(defaults.contracts, CONTRACTS);
  const partial = resolveModesConfig({ merge: { contracts: { types: { fusionCount: { count: 3 } } } } }).merge;
  assert.equal(partial.contracts.types.fusionCount.count, 3);
  assert.equal(partial.contracts.types.fusionCount.points, CONTRACTS.types.fusionCount.points);
  assert.equal(partial.contracts.durationDrops, CONTRACTS.durationDrops);
  assert.equal(resolveModesConfig({ merge: { contracts: null } }).merge.contracts.firstAfterDrops, CONTRACTS.firstAfterDrops);
});

test('A contract comes after the configured drops, lasts its drops, fails without penalty and a gap follows', () => {
  const engine = createContractEngine();
  const state = engine.modeState;
  assert.equal(engine.getMergeContractState().active, null);
  assert.equal(state.dropsUntilContract, CONTRACTS.firstAfterDrops);

  assert.equal(dropUntilContract(engine), CONTRACTS.firstAfterDrops, 'the first contract starts after the configured drops');
  assert.equal(state.contract.dropsLeft, CONTRACTS.durationDrops);
  assert.equal(state.contractCount, 1);
  assert.equal(engine.getMergeContractState().active.type, state.contract.type);

  const scoreBefore = engine.score;
  for (let cycle = 0; cycle < 12; cycle += 1) {
    for (let i = 1; i < CONTRACTS.durationDrops; i += 1) {
      dropOnce(engine);
      assert.equal(state.contract.dropsLeft, CONTRACTS.durationDrops - i);
    }
    dropOnce(engine);
    assert.equal(state.contract.dropsLeft, 0, 'the last drop is still settling, the contract stays open');
    mergeBehavior.expireStalledContract(engine, CONTRACTS.lastDropGraceSec - 0.1);
    assert.ok(state.contract, 'still open inside the grace time');
    mergeBehavior.expireStalledContract(engine, 0.2);
    assert.equal(state.contract, null, 'the contract fails once the grace time of its last drop has run out');
    assert.equal(state.contractResult.outcome, 'failure');
    assert.equal(state.contractResult.points, 0);
    assert.equal(engine.score, scoreBefore, 'a failed contract costs nothing');
    const gap = state.dropsUntilContract;
    assert.ok(gap >= CONTRACTS.gapMinDrops && gap <= CONTRACTS.gapMaxDrops, `gap ${gap} is in range`);
    assert.equal(dropUntilContract(engine), gap, 'the next contract starts after exactly the drawn gap');
  }
  assert.equal(state.contractCount, 13);
  engine.triggerGameOver(GAME_OVER_REASONS.BASIN_OVERFLOW);
  assert.equal(engine.getMergeContractState(), null);
});

test('A contract never has the same type twice in a row and every type comes up', () => {
  const engine = createEventEngine('merge-contract-types');
  const seen = [];
  for (let cycle = 0; cycle < 20; cycle += 1) {
    dropUntilContract(engine);
    seen.push(engine.modeState.contract.type);
    for (let i = 0; i < CONTRACTS.durationDrops; i += 1) {
      dropOnce(engine);
    }
    mergeBehavior.expireStalledContract(engine, CONTRACTS.lastDropGraceSec);
  }
  seen.forEach((type, index) => {
    assert.ok(CONTRACT_TYPE_IDS.includes(type));
    if (index > 0) {
      assert.notEqual(type, seen[index - 1], 'never the same contract twice in a row');
    }
  });
  assert.equal(new Set(seen).size, CONTRACT_TYPE_IDS.length);
});

test('The calibre target sits below the best fused calibre, clamped to the configured bounds', () => {
  const targetFor = (best, config) => {
    const engine = createContractEngine(ROLL_FIRST_TYPE);
    if (config) {
      engine.modesConfig = resolveModesConfig({ merge: { ...modesConfig.merge, contracts: config } });
    }
    engine.mergeBestTier = best;
    engine.modeState.dropsUntilContract = 1;
    dropOnce(engine);
    assert.equal(engine.modeState.contract.type, 'fuseCalibre');
    return engine.modeState.contract.target;
  };
  const { offsetBelowBest, minCalibre, maxCalibre } = CONTRACTS.types.fuseCalibre;
  assert.equal(targetFor(1), minCalibre, 'a young run is held at the minimum');
  assert.equal(targetFor(minCalibre), minCalibre);
  assert.equal(targetFor(9), 9 - offsetBelowBest);
  assert.equal(targetFor(12), Math.min(maxCalibre, 12 - offsetBelowBest));
  assert.equal(targetFor(12, { types: { fuseCalibre: { offsetBelowBest: 0 } } }), maxCalibre, 'the maximum clamps a high best');
});

test('A fusion reaching the calibre target completes the contract, even in the middle of a chain', () => {
  const engine = createContractEngine();
  engine.modeState.shakeRemaining = SHAKE_FULL;
  const calibre = 3;
  forceContract(engine, { type: 'fuseCalibre', target: calibre });
  const texts = [];
  engine.particleSystem.spawnFloatingText = (x, y, text) => texts.push(text);

  placeTouchingPair(engine, 0, 60);
  stepFusions(engine);
  assert.equal(engine.modeState.contract.progress, 2, 'a calibre 2 fusion is not enough');
  assert.equal(engine.modeState.contractResult, null);

  // Two calibre 2 spheres fuse into the calibre 3 target while the chain is still running.
  placeTouchingPair(engine, 1, 200);
  const scoreBefore = engine.score;
  stepFusions(engine);
  const reward = calibre * CONTRACTS.types.fuseCalibre.pointsPerCalibre;
  assert.equal(engine.modeState.contract, null);
  assert.deepEqual(engine.modeState.contractResult, {
    id: 1, type: 'fuseCalibre', outcome: 'success', points: reward
  });
  assert.equal(
    engine.score - scoreBefore,
    Math.round(modesConfig.merge.tiers[2].points * engine.combo) + reward
  );
  assert.ok(texts.includes(t('gameplay.feedback.merge.contractDone', { points: reward })));
  assert.equal(engine.getMergeShakeRemaining(), Math.max(0, SHAKE_FULL - CONTRACTS.rewardShakeDrops));
});

test('Fusions count towards a fusion contract, a Supernova counts as one, and the last one pays at once', () => {
  const engine = createContractEngine();
  const goal = CONTRACTS.types.fusionCount.count;
  forceContract(engine, { type: 'fusionCount', target: goal });

  placeTouchingPair(engine, 0, 60);
  placeTouchingPair(engine, 0, 160);
  stepFusions(engine);
  assert.equal(engine.modeState.contract.progress, 2);

  placeTouchingPair(engine, modesConfig.merge.tiers.length - 1, 120);
  stepFusions(engine);
  assert.equal(engine.modeState.contract.progress, 3, 'a Supernova is one fusion');
  assert.equal(engine.modeState.supernovas, 1);

  for (let remaining = goal - 3; remaining > 0; remaining -= 1) {
    assert.ok(engine.modeState.contract, 'still running before the last fusion');
    placeTouchingPair(engine, 0, 60);
    stepFusions(engine);
  }
  assert.equal(engine.modeState.contract, null);
  assert.equal(engine.modeState.contractResult.outcome, 'success');
  assert.equal(engine.modeState.contractResult.points, CONTRACTS.types.fusionCount.points);
});

test('A Supernova satisfies a calibre contract', () => {
  const engine = createContractEngine();
  forceContract(engine, { type: 'fuseCalibre', target: CONTRACTS.types.fuseCalibre.maxCalibre });
  placeTouchingPair(engine, modesConfig.merge.tiers.length - 1, 120);
  stepFusions(engine);
  assert.equal(engine.modeState.contractResult.outcome, 'success');
});

test('The contract reward ignores the combo and the golden event, and the Shake advance floors at zero', () => {
  const run = (shake, golden) => {
    const engine = createContractEngine();
    engine.modeState.shakeRemaining = shake;
    if (golden) {
      withEvent(engine, 'golden');
    }
    forceContract(engine, { type: 'fusionCount', target: 2 });
    [60, 160].forEach((x) => placeTouchingPair(engine, 0, x));
    stepFusions(engine);
    assert.equal(engine.combo, 2, 'a combo above one, below the chain that charges the Shake on its own');
    assert.equal(engine.modeState.contractResult.outcome, 'success');
    const factor = golden ? MERGE_EVENTS.pool.golden.pointsFactor : 1;
    const fusions = [1, 2].reduce(
      (sum, combo) => sum + Math.round(modesConfig.merge.tiers[1].points * combo * factor),
      0
    );
    assert.equal(engine.score, fusions + CONTRACTS.types.fusionCount.points, 'the reward is a flat sum');
    return engine;
  };
  assert.equal(run(SHAKE_FULL, false).getMergeShakeRemaining(), SHAKE_FULL - CONTRACTS.rewardShakeDrops);
  assert.equal(run(SHAKE_FULL, true).getMergeShakeRemaining(), SHAKE_FULL - CONTRACTS.rewardShakeDrops);
  assert.equal(run(1, false).getMergeShakeRemaining(), 0, 'the Shake never goes below zero');
  assert.equal(run(0, false).getMergeShakeRemaining(), 0);
  assert.equal(run(null, false).getMergeShakeRemaining(), null, 'a Shake that is not tracked stays so');
});

test('A snapshot keeps an active contract and restores a legacy or hostile one with safe defaults', () => {
  const source = createContractEngine();
  source.shoot();
  source.modeState.contract = { type: 'fusionCount', target: 6, progress: 2, dropsLeft: 5 };
  source.modeState.contractCount = 4;
  source.modeState.lastContractType = 'fuseCalibre';
  source.modeState.dropsUntilContract = 7;
  source.saveRunSnapshot({ force: true });
  const restored = createEngine();
  restored.storageManager = source.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.deepEqual(restored.modeState.contract, { type: 'fusionCount', target: 6, progress: 2, dropsLeft: 5 });
  assert.equal(restored.modeState.contractCount, 4);
  assert.equal(restored.modeState.lastContractType, 'fuseCalibre');
  assert.equal(restored.modeState.dropsUntilContract, 7);
  assert.equal(restored.modeState.contractResult, null);
  assert.deepEqual(restored.getMergeContractState(), {
    contractCount: 4,
    active: { type: 'fusionCount', target: 6, progress: 2, dropsLeft: 5 },
    result: null
  });

  const restoreRaw = (mutate) => {
    const engine = createEngine();
    engine.startMergeMode();
    const raw = { ...mergeBehavior.serializeModeState(engine) };
    mutate(raw);
    assert.equal(mergeBehavior.validateModeState(raw), true);
    mergeBehavior.restoreModeState(engine, raw);
    return engine.modeState;
  };
  const legacy = restoreRaw((raw) => {
    for (const key of ['contract', 'dropsUntilContract', 'contractCount', 'lastContractType']) {
      delete raw[key];
    }
  });
  assert.equal(legacy.contract, null);
  assert.equal(legacy.contractCount, 0);
  assert.equal(legacy.lastContractType, null);
  assert.equal(legacy.dropsUntilContract, CONTRACTS.firstAfterDrops);

  const hostile = restoreRaw((raw) => {
    raw.contract = { type: 'fuseCalibre', target: 99, progress: 50, dropsLeft: 999 };
    raw.contractCount = -3;
    raw.lastContractType = 'nonsense';
    raw.dropsUntilContract = 9999;
  });
  assert.deepEqual(hostile.contract, {
    type: 'fuseCalibre',
    target: CONTRACTS.types.fuseCalibre.maxCalibre,
    progress: CONTRACTS.types.fuseCalibre.maxCalibre - 1,
    dropsLeft: CONTRACTS.durationDrops
  });
  assert.equal(hostile.contractCount, 0);
  assert.equal(hostile.lastContractType, null);
  assert.equal(hostile.dropsUntilContract, Math.max(CONTRACTS.firstAfterDrops, CONTRACTS.gapMaxDrops));
  assert.equal(restoreRaw((raw) => { raw.dropsUntilContract = CONTRACTS.firstAfterDrops; }).dropsUntilContract, CONTRACTS.firstAfterDrops);
  assert.equal(
    restoreRaw((raw) => { raw.contract = { type: 'fusionCount', target: 3, progress: 0, dropsLeft: -4 }; }).contract.dropsLeft,
    0
  );
  assert.equal(restoreRaw((raw) => { raw.contract = { type: 'meteor', target: 3, dropsLeft: 3 }; }).contract, null);
  assert.equal(restoreRaw((raw) => { raw.contract = { type: 'fusionCount', target: 3 }; }).contract, null);
});

test('The HUD announces a contract once when it starts and once when it ends, and nothing after a restart', () => {
  const spoken = [];
  const hud = { announce: (text) => spoken.push(text) };
  const refresh = (view) => uiHudRefreshMethods.announceMergeContractChanges.call(hud, view);
  const idle = (contractCount, result = null) => ({ contractCount, active: null, result });
  const active = (contractCount, type, dropsLeft) => ({
    contractCount,
    active: { type, target: 9, progress: 0, dropsLeft },
    result: null
  });
  const done = (id, outcome, points) => ({ id, type: 'fuseCalibre', outcome, points });

  for (let i = 0; i < 4; i += 1) {
    refresh(idle(0));
  }
  assert.deepEqual(spoken, [], 'the first refresh only records');
  for (let dropsLeft = CONTRACTS.durationDrops; dropsLeft >= 3; dropsLeft -= 1) {
    refresh(active(1, 'fuseCalibre', dropsLeft));
    refresh(active(1, 'fuseCalibre', dropsLeft));
  }
  assert.deepEqual(spoken, [
    t('gameplay.feedback.merge.contractStart.fuseCalibre.other', { target: 9, count: CONTRACTS.durationDrops })
  ]);
  for (let i = 0; i < 4; i += 1) {
    refresh(idle(1, done(1, 'success', 2700)));
  }
  assert.equal(spoken.length, 2);
  assert.equal(spoken[1], t('gameplay.feedback.merge.contractSuccess', { points: 2700 }));

  refresh(active(2, 'fusionCount', CONTRACTS.durationDrops));
  assert.equal(spoken.length, 3);
  assert.equal(spoken[2], t('gameplay.feedback.merge.contractStart.fusionCount.other', {
    target: 9, count: CONTRACTS.durationDrops
  }));
  for (let i = 0; i < 4; i += 1) {
    refresh(idle(2, done(2, 'failure', 0)));
  }
  assert.equal(spoken.length, 4);
  assert.equal(spoken[3], t('gameplay.feedback.merge.contractFailure', { points: 0 }));

  // A new run replaces the old one in the middle of a contract: nothing is said for the swap.
  refresh(active(3, 'fuseCalibre', 4));
  const before = spoken.length;
  refresh(idle(0));
  refresh(idle(0));
  assert.equal(spoken.length, before);
  refresh(null);
  refresh(active(1, 'fuseCalibre', CONTRACTS.durationDrops));
  assert.equal(spoken.length, before, 'leaving the Basin forgets the old state');
});

test('Every Basin contract text exists in English and French, in both plural forms', () => {
  const keys = [
    'gameplay.feedback.merge.contractDone',
    'gameplay.feedback.merge.contractSuccess',
    'gameplay.feedback.merge.contractFailure'
  ];
  for (const type of CONTRACT_TYPE_IDS) {
    keys.push(`hud.stats.mergeContract.${type}`);
    keys.push(`hud.stats.mergeContract.aria.${type}.last`);
    for (const plural of ['one', 'other']) {
      keys.push(`hud.stats.mergeContract.aria.${type}.${plural}`, `gameplay.feedback.merge.contractStart.${type}.${plural}`);
    }
  }
  const lookup = (dictionary, key) => key.split('.').reduce((node, part) => node?.[part], dictionary);
  for (const locale of ['en', 'fr']) {
    const dictionary = loadJson(`./locales/${locale}.json`);
    for (const key of keys) {
      const value = lookup(dictionary, key);
      assert.equal(typeof value, 'string', `${locale} has ${key}`);
      assert.ok(value.length > 0, `${locale} ${key} is not empty`);
    }
  }
  const french = loadJson('./locales/fr.json');
  assert.match(lookup(french, 'gameplay.feedback.merge.contractStart.fuseCalibre.other'), /lâchers/);
  assert.match(lookup(french, 'gameplay.feedback.merge.contractStart.fuseCalibre.one'), /lâcher\./);
  assert.match(lookup(french, 'hud.stats.mergeContract.aria.fuseCalibre.other'), /lâchers restants/);
  assert.match(lookup(french, 'hud.stats.mergeContract.aria.fuseCalibre.one'), /lâcher restant/);
});

test('A fusion caused by the last drop still counts, and the next drop fails a contract left open', () => {
  const engine = createContractEngine();
  forceContract(engine, { type: 'fusionCount', target: 1, dropsLeft: 1 });
  dropOnce(engine);
  assert.equal(engine.modeState.contract.dropsLeft, 0);
  placeTouchingPair(engine, 0, 60);
  stepFusions(engine);
  assert.equal(engine.modeState.contractResult.outcome, 'success');

  const stalled = createContractEngine();
  forceContract(stalled, { type: 'fusionCount', target: 6, dropsLeft: 1 });
  dropOnce(stalled);
  assert.equal(stalled.modeState.contract.dropsLeft, 0);
  dropOnce(stalled);
  assert.equal(stalled.modeState.contract, null);
  assert.equal(stalled.modeState.contractResult.outcome, 'failure');
  assert.equal(stalled.getMergeContractState().result.outcome, 'failure');
});

test('A stalled contract expires from the physics step, whatever the player does with Polarity or the Shake', () => {
  const engine = createContractEngine();
  forceContract(engine, { type: 'fusionCount', target: 6, dropsLeft: 1 });
  dropOnce(engine);
  const steps = Math.ceil(CONTRACTS.lastDropGraceSec / PHYSICS_DT) + 1;
  for (let i = 0; i < steps && engine.modeState.contract; i += 1) {
    mergeBehavior.onBeforePhysicsStep(engine, PHYSICS_DT);
  }
  assert.equal(engine.modeState.contract, null);
  assert.equal(engine.modeState.contractResult.outcome, 'failure');
});

test('The contract plural key follows the plural rules of the current locale and says last drop at zero', () => {
  const locale = i18n.getLocale();
  try {
    i18n.currentLocale = 'en';
    assert.deepEqual([0, 1, 2].map(getMergeContractPluralKey), ['last', 'one', 'other']);
    i18n.currentLocale = 'fr';
    assert.deepEqual([0, 1, 2].map(getMergeContractPluralKey), ['last', 'one', 'other']);
    assert.equal(new Intl.PluralRules('fr').select(0), 'one', 'French reads zero as singular');
  } finally {
    i18n.currentLocale = locale;
  }
});
