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
import { StorageManager } from '../src/core/StorageManager.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import {
  GAME_MODES,
  GAME_OVER_REASONS,
  GAME_STATES,
  LAUNCHER_POSTURES,
  SPECIAL_TYPES
} from '../src/core/Constants.js';
import { Ball } from '../src/entities/Ball.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { slingshotBehavior } from '../src/game/modes/SlingshotBehavior.js';

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
    audioManager: {
      playEffect: () => {},
      stopAll: () => {},
      isMuted: () => true
    },
    storageManager,
    onStateChange: () => {}
  });
};

const createMockCtx = () => ({
  save: () => {},
  restore: () => {},
  beginPath: () => {},
  closePath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  arc: () => {},
  fill: () => {},
  stroke: () => {},
  setLineDash: () => {},
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  lineCap: 'butt',
  globalAlpha: 1
});

test('Magnetic Slingshot configures zero-gravity upward arena, Dipole Wells, Radiant Cores, and stage 2+ barriers', () => {
  const engine = createEngine();
  engine.startSlingshotMode();

  assert.equal(engine.mode, GAME_MODES.SLINGSHOT);
  assert.equal(engine.state, GAME_STATES.PLAYING);
  assert.equal(engine.slingshotStage, 1);
  assert.equal(engine.usesShotBudget(), true);
  assert.equal(engine.getLauncherSpec().posture, LAUNCHER_POSTURES.UPWARD);
  assert.equal(engine.physicsWorld.gravityMultiplier, 0);
  assert.equal(engine.physicsWorld.projectileGravity, 0);
  assert.equal(engine.physicsWorld.disableMagneticCurve, true);
  assert.equal(engine.physicsWorld.disableBounceCap, true);

  assert.equal(slingshotBehavior.isSpecialTypeAllowed(SPECIAL_TYPES.BOMB), true);
  assert.equal(slingshotBehavior.isSpecialTypeAllowed(SPECIAL_TYPES.LIGHTNING), true);
  assert.equal(slingshotBehavior.isSpecialTypeAllowed(SPECIAL_TYPES.RAINBOW), true);
  assert.equal(slingshotBehavior.isSpecialTypeAllowed(SPECIAL_TYPES.ROCKET), true);
  assert.equal(slingshotBehavior.isSpecialTypeAllowed(SPECIAL_TYPES.FREEZE), false);
  assert.equal(slingshotBehavior.isSpecialTypeAllowed(SPECIAL_TYPES.ANVIL), false);

  const cores = engine.physicsWorld.balls.filter((b) => b.slingshotCore);
  const guards = engine.physicsWorld.balls.filter((b) => !b.slingshotCore);
  assert.equal(cores.length, modesConfig.slingshot.minConstellations);
  assert.equal(guards.length, cores.length * modesConfig.slingshot.guardCount);
  assert.ok(guards.every((g) => g.isAnchor === true));
  assert.equal(engine.modeState.wells.length, 1);
  assert.equal(engine.physicsWorld.obstacles.length, 1);

  engine.slingshotStage = 2;
  slingshotBehavior.buildStageBoard(engine);
  assert.equal(engine.modeState.wells.length, 2);
  assert.equal(engine.physicsWorld.obstacles.length, 2, 'Even stages introduce dual flanking Deflector Barriers');
});

test('Magnetic Slingshot Dipole Wells bend aim preview with exact flight parity and reverse on pre-shot Polarity flip', () => {
  const engine = createEngine();
  engine.startSlingshotMode();

  // Clear board balls and obstacles so trajectory bends purely around a single central Dipole Well.
  for (const b of [...engine.physicsWorld.balls]) {
    engine.physicsWorld.removeBall(b);
  }
  engine.physicsWorld.obstacles = [];
  engine.modeState.wells = [{
    id: 0,
    x: gameConfig.canvas.logicalWidth * 0.5 + 70,
    y: 380,
    polarity: 1,
    fieldRadius: 170,
    strength: 0.24
  }];
  slingshotBehavior.configureWorldHooks(engine);

  const launcher = engine.getLauncherSpec();
  const angle = -Math.PI * 0.5;
  engine.updateAimFromAngle(angle);
  const previewNormal = engine.aimPoints.map((p) => ({ ...p }));
  assert.ok(previewNormal.length > 4);
  const lastPreviewNormal = previewNormal[previewNormal.length - 1];
  assert.ok(
    lastPreviewNormal.x > launcher.x + 5,
    'Attractive well to the right bends upward shot rightward'
  );

  // Flip pre-shot polarity: well becomes repulsive and bends shot leftward.
  engine.togglePolarityFlip();
  engine.updateAimFromAngle(angle);
  const previewFlipped = engine.aimPoints.map((p) => ({ ...p }));
  const lastPreviewFlipped = previewFlipped[previewFlipped.length - 1];
  assert.ok(
    lastPreviewFlipped.x < launcher.x - 5,
    'Pre-shot Polarity flip reverses Dipole Well force and bends shot leftward'
  );

  // Verify exact floating-point step parity between preview points and actual projectile flight.
  engine.shoot();
  const proj = engine.physicsWorld.projectile;
  assert.ok(proj);
  engine.physicsWorld.stepProjectile(1 / physicsConfig.simulation.substeps, {});
  assert.ok(Math.abs(proj.x - previewFlipped[1].x) < 1e-9);
  assert.ok(Math.abs(proj.y - previewFlipped[1].y) < 1e-9);
});

test('Magnetic Slingshot mid-flight Polarity Whip boosts speed, scales radius with collectorMagnet, grants Overcharge, and caps once per well', () => {
  const engine = createEngine();
  engine.startSlingshotMode();

  const baseRadius = slingshotBehavior.getEffectiveWhipRadius(engine);
  assert.equal(baseRadius, modesConfig.slingshot.whipRadius);

  engine.storageManager.safeSetItem(
    gameConfig.storage.keys.upgrades,
    JSON.stringify({ collectorMagnet: 3 })
  );
  engine.storageManager.upgradesCache = null;
  const upgradedRadius = slingshotBehavior.getEffectiveWhipRadius(engine);
  assert.equal(
    upgradedRadius,
    modesConfig.slingshot.whipRadius + 3 * modesConfig.slingshot.whipRadiusPerLevel
  );

  engine.aimAngle = -Math.PI * 0.5;
  engine.shoot();
  const proj = engine.physicsWorld.projectile;
  const well = engine.modeState.wells[0];
  proj.x = well.x + baseRadius + 10;
  proj.y = well.y;
  proj.vx = 0;
  proj.vy = -10;
  proj.flightSteps = 3;

  const overchargeBefore = engine.overcharge;
  engine.togglePolarityFlip();
  const boostedSpeed = Math.hypot(proj.vx, proj.vy);
  assert.equal(engine.modeState.shotWhipped, true);
  assert.deepEqual(engine.modeState.whippedWellIds, [well.id]);
  assert.ok(
    Math.abs(boostedSpeed - 10 * modesConfig.slingshot.whipBoostFactor) < 1e-6,
    'Mid-flight Polarity Whip boosts projectile velocity inside upgraded whip radius'
  );
  assert.ok(engine.overcharge > overchargeBefore, 'Polarity Whip awards Overcharge');

  // Toggling polarity again inside the same well must not stack a second whip boost on the same well.
  engine.togglePolarityFlip();
  assert.ok(Math.abs(Math.hypot(proj.vx, proj.vy) - boostedSpeed) < 1e-9);
});

test('Magnetic Slingshot shatters Radiant Cores via direct hit or guard avalanche, applies whip multiplier, advances stage, and triggers OUT_OF_SHOTS', () => {
  const engine = createEngine();
  const recordedBounties = [];
  engine.storageManager.recordBountyProgress = (eventKey, amount) => {
    recordedBounties.push([eventKey, amount]);
    return [];
  };
  engine.startSlingshotMode();

  const cores = engine.physicsWorld.balls.filter((b) => b.slingshotCore);
  assert.equal(cores.length, 2);

  // 1. Direct projectile impact on first Radiant Core with shotWhipped active.
  engine.modeState.shotWhipped = true;
  const snapped = new Ball({
    x: cores[0].x,
    y: cores[0].y + cores[0].radius * 2,
    radius: physicsConfig.ball.radius,
    colorId: engine.activePalette[0]
  });
  engine.physicsWorld.addBall(snapped);
  const scoreBefore = engine.score;
  const settledHandled = slingshotBehavior.onProjectileSettled(engine, {
    snappedBall: snapped,
    hitTarget: cores[0]
  });
  assert.equal(settledHandled, true);
  assert.equal(engine.physicsWorld.ballMap.has(cores[0].id), false);
  const expectedWhipCorePts = Math.round(
    modesConfig.slingshot.corePoints * modesConfig.slingshot.whipScoreMultiplier
  );
  assert.ok(engine.score >= scoreBefore + expectedWhipCorePts);
  assert.deepEqual(recordedBounties, [['slingshot_core_shattered', 1]]);

  // 2. Shatter all guards around the second Radiant Core so it drops by avalanche and clears stage 1.
  engine.modeState.shotWhipped = false;
  for (const guard of [...engine.physicsWorld.balls]) {
    if (!guard.slingshotCore) {
      engine.destroyClusterBall(guard, '#ffffff', true);
    }
  }
  const shotsBeforeClear = 3;
  engine.shotsRemaining = shotsBeforeClear;
  engine.handlePostTurnCleanup(true);

  assert.equal(engine.slingshotStage, 2, 'Clearing all Radiant Cores advances to Stage 2');
  assert.ok(engine.shotsRemaining > shotsBeforeClear, 'Stage clear refills shot budget');
  assert.equal(engine.storageManager.getSlingshotBestStage(), 2);

  // 3. Exhausting shots while Radiant Cores remain ends the run with OUT_OF_SHOTS.
  engine.shotsRemaining = 0;
  engine.evaluateRoundEnd();
  assert.equal(engine.state, GAME_STATES.GAME_OVER);
  assert.equal(engine.gameOverSummary?.reasonKey, GAME_OVER_REASONS.OUT_OF_SHOTS);
});

test('Magnetic Slingshot enforces maxFlightSubsteps anti-orbit timeout, renders cleanly, and round-trips RunSnapshot', () => {
  const engine = createEngine();
  engine.startSlingshotMode();

  const ctx = createMockCtx();
  const ballCountBefore = engine.physicsWorld.balls.length;
  slingshotBehavior.drawUnderlay(ctx, engine, null, gameConfig.theme, 1000);
  slingshotBehavior.drawOverlay(ctx, engine, null, gameConfig.theme, 1000);
  assert.equal(engine.physicsWorld.balls.length, ballCountBefore);

  // Anti-orbit safety timeout clears a trapped projectile cleanly.
  engine.aimAngle = -Math.PI * 0.5;
  engine.shoot();
  engine.modeState.flightSubsteps = modesConfig.slingshot.maxFlightSubsteps - 1;
  let missedCalled = false;
  engine.physicsWorld.stepProjectile(1, {
    onProjectileMissed: () => {
      missedCalled = true;
    }
  });
  assert.equal(engine.physicsWorld.projectile, null);
  assert.equal(missedCalled, true);

  // Snapshot round-trip preserves stage, Dipole Wells, and Radiant Core flags.
  engine.slingshotStage = 3;
  slingshotBehavior.buildStageBoard(engine);
  engine.hasFiredInRound = true;
  const expectedWells = engine.modeState.wells.map((w) => ({ ...w }));
  const expectedCores = engine.physicsWorld.balls.filter((b) => b.slingshotCore).length;
  engine.saveRunSnapshot({ force: true });

  const restored = createEngine();
  restored.storageManager = engine.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.mode, GAME_MODES.SLINGSHOT);
  assert.equal(restored.slingshotStage, 3);
  assert.deepEqual(restored.modeState.wells, expectedWells);
  assert.equal(restored.physicsWorld.balls.filter((b) => b.slingshotCore).length, expectedCores);

  // Corrupted snapshots with 0 coreFlags or mismatched length are rejected instead of awarding a free stage clear.
  const rawSnap = JSON.parse(engine.storageManager.safeGetItem(gameConfig.storage.keys.runSnapshot));
  rawSnap.modeState.coreFlags = rawSnap.modeState.coreFlags.map(() => 0);
  engine.storageManager.safeSetItem(gameConfig.storage.keys.runSnapshot, JSON.stringify(rawSnap));
  const rejectedZero = createEngine();
  rejectedZero.storageManager = engine.storageManager;
  assert.equal(rejectedZero.restoreSavedRun(), false);

  const rawSnapShort = JSON.parse(JSON.stringify(rawSnap));
  rawSnapShort.modeState.coreFlags = [1];
  engine.storageManager.safeSetItem(gameConfig.storage.keys.runSnapshot, JSON.stringify(rawSnapShort));
  const rejectedShort = createEngine();
  rejectedShort.storageManager = engine.storageManager;
  assert.equal(rejectedShort.restoreSavedRun(), false);
});
