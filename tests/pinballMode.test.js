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
import { pinballBehavior } from '../src/game/modes/PinballBehavior.js';

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

test('Pinball mounts a top downward cannon, uses a shot budget, and filters non-kinetic specials', () => {
  const engine = createEngine();
  engine.startPinballMode(1);

  assert.equal(engine.mode, GAME_MODES.PINBALL);
  assert.equal(engine.usesShotBudget(), true);
  assert.equal(engine.getLauncherSpec().posture, LAUNCHER_POSTURES.DOWNWARD);
  assert.ok(engine.physicsWorld.projectileGravity > 0);
  assert.equal(engine.physicsWorld.disableBounceCap, true);

  for (const allowed of [SPECIAL_TYPES.BOMB, SPECIAL_TYPES.LIGHTNING, SPECIAL_TYPES.ANVIL, SPECIAL_TYPES.ROCKET]) {
    assert.equal(engine.isSpecialTypeAllowed(allowed), true, `${allowed} allowed`);
  }
  for (const disallowed of [SPECIAL_TYPES.RAINBOW, SPECIAL_TYPES.BRUSH, SPECIAL_TYPES.FREEZE]) {
    assert.equal(engine.isSpecialTypeAllowed(disallowed), false, `${disallowed} excluded`);
  }
});

test('Pinball live mid-flight polarity flip updates the airborne projectile only in Pinball, not Campaign, and recenterAim points straight down', () => {
  const engine = createEngine();
  engine.startPinballMode(1);
  engine.updateAim(modesConfig.pinball.launcherX + 100, modesConfig.pinball.launcherY + 200);
  assert.notEqual(engine.aimAngle, modesConfig.pinball.defaultAimAngleRad);
  engine.recenterAim();
  assert.equal(engine.aimAngle, modesConfig.pinball.defaultAimAngleRad);

  engine.shoot();
  const proj = engine.physicsWorld.projectile;
  assert.ok(proj, 'projectile is airborne');
  assert.equal(proj.isPolarityFlipped, false);

  engine.togglePolarityFlip();
  assert.equal(engine.isPolarityFlipped, true);
  assert.equal(proj.isPolarityFlipped, true, 'Pinball projectile bends live mid-flight');

  // Verify Campaign shots remain polarity-locked at launch
  const campaignEngine = createEngine();
  campaignEngine.startCampaignLevel(1);
  campaignEngine.shoot();
  const campaignProj = campaignEngine.physicsWorld.projectile;
  assert.ok(campaignProj);
  assert.equal(campaignProj.isPolarityFlipped, false);
  campaignEngine.togglePolarityFlip();
  assert.equal(campaignProj.isPolarityFlipped, false, 'Campaign projectile keeps its launch polarity');
});

test('Pinball scales maxShotsCap with startingShots upgrades so Free Ball catches never subtract shots', () => {
  const engine = createEngine();
  engine.storageManager.setCoins(50000);
  while (engine.storageManager.purchaseUpgrade('startingShots')) {
    // max out startingShots
  }
  engine.startPinballMode(1);
  assert.ok(engine.shotsRemaining > modesConfig.pinball.maxShotsCap);
  engine.shotsRemaining -= 1;
  const beforeCatch = engine.shotsRemaining;
  pinballBehavior.refundBucketCatch(engine, modesConfig.pinball.launcherX, modesConfig.pinball.bucketY);
  assert.equal(engine.shotsRemaining, beforeCatch + 1);
});

test('Pinball bucket catch refunds +1 shot, lighting all Core Pegs advances stage, and 0 shots triggers Game Over', () => {
  const engine = createEngine();
  engine.startPinballMode(1);
  const cfg = modesConfig.pinball;

  // Test Magnetic Collector Bucket catch refund
  engine.shotsRemaining = 4;
  engine.modeState.bucketX = cfg.launcherX;
  const falling = new Ball({
    x: cfg.launcherX,
    y: cfg.bucketY,
    vx: 0,
    vy: 6,
    radius: physicsConfig.ball.radius,
    colorId: 'crimson',
    isProjectile: true
  });
  engine.physicsWorld.projectile = falling;
  const handled = pinballBehavior.stepPinballProjectile(engine, falling, 1 / 6, {});
  assert.equal(handled, true);
  assert.equal(engine.shotsRemaining, 5, 'bucket catch refunded +1 shot');

  // Light all Core Pegs and settle turn -> stage advances to 2
  for (const peg of engine.physicsWorld.balls) {
    if (peg.pinballCore) {
      pinballBehavior.lightPeg(engine, peg);
    }
  }
  pinballBehavior.settlePinballTurn(engine, true);
  assert.equal(engine.pinballStage, 2);
  assert.ok(engine.physicsWorld.obstacles.length >= 1, 'stage 2 spawns arcade bumpers');

  // Exhaust shots with unlit Core Pegs -> OUT_OF_SHOTS Game Over
  engine.shotsRemaining = 0;
  pinballBehavior.settlePinballTurn(engine, false);
  assert.equal(engine.state, GAME_STATES.GAME_OVER);
  assert.equal(engine.gameOverSummary?.reasonKey, GAME_OVER_REASONS.OUT_OF_SHOTS);
});

test('Pinball stage transition keeps avalanche pegs dropping without phantom collector payouts', () => {
  const engine = createEngine();
  engine.startPinballMode(1);
  const nonCoreBefore = engine.physicsWorld.balls.filter((b) => !b.pinballCore).length;
  assert.ok(nonCoreBefore > 0);
  for (const peg of engine.physicsWorld.balls) {
    if (peg.pinballCore) {
      pinballBehavior.lightPeg(engine, peg);
    }
  }
  pinballBehavior.settlePinballTurn(engine, true);
  assert.equal(engine.pinballStage, 2);
  assert.equal(engine.physicsWorld.droppingBalls.length, nonCoreBefore);
  const scoreBefore = engine.score;
  engine.getStepCallbacks().onCollectorBinPass({ x: 120 });
  assert.equal(engine.score, scoreBefore);
});

test('Pinball snapshot preserves stage, bucket state, and Core Peg assignments on restore', () => {
  const engine = createEngine();
  engine.startPinballMode(2);
  engine.hasFiredInRound = true;
  engine.modeState.bucketX = 190;
  engine.modeState.bucketDir = -1;
  const coreCountBefore = engine.modeState.corePegsRemaining;
  engine.saveRunSnapshot({ force: true });

  const restored = createEngine();
  restored.storageManager = engine.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.mode, GAME_MODES.PINBALL);
  assert.equal(restored.pinballStage, 2);
  assert.equal(restored.modeState.bucketX, 190);
  assert.equal(restored.modeState.bucketDir, -1);
  assert.equal(restored.modeState.corePegsRemaining, coreCountBefore);
});

test('Pinball 1-bounce ballistic aim reflects off first peg, avoids snapTarget, and collectorMagnet widens bucket & adds overcharge', () => {
  const engine = createEngine();
  engine.startPinballMode(1);
  const cfg = modesConfig.pinball;
  // Position a single peg directly below the downward aim line
  engine.physicsWorld.balls = [engine.physicsWorld.balls[0]];
  engine.physicsWorld.ballMap.clear();
  const peg = engine.physicsWorld.balls[0];
  peg.x = cfg.launcherX + 10;
  peg.y = 280;
  engine.physicsWorld.ballMap.set(peg.id, peg);
  engine.physicsWorld.aimCacheValid = false;

  engine.updateAimFromAngle(Math.PI * 0.5);
  assert.ok(engine.aimPoints.length > 5);
  assert.equal(engine.aimPoints.snapTarget, null, 'pinball aim must never highlight pegs as snap cluster targets');
  assert.ok(engine.aimPoints.some((pt) => pt.isBounce), 'pinball aim traces through first peg ricochet');

  const baseWidth = pinballBehavior.getEffectiveBucketWidth(engine);
  assert.equal(baseWidth, cfg.bucketWidth);
  engine.storageManager.safeSetItem(
    gameConfig.storage.keys.upgrades,
    JSON.stringify({ collectorMagnet: 3 })
  );
  engine.storageManager.upgradesCache = null;
  const upgradedWidth = pinballBehavior.getEffectiveBucketWidth(engine);
  assert.equal(upgradedWidth, cfg.bucketWidth + 3 * cfg.bucketWidthPerLevel);

  const overchargeBefore = engine.overcharge;
  pinballBehavior.refundBucketCatch(engine, cfg.launcherX, cfg.bucketY);
  assert.ok(engine.overcharge > overchargeBefore, 'collector bucket catch grants overcharge');
});
