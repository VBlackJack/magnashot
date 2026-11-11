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
