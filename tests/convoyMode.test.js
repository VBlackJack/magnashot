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
import {
  buildConvoyTrackLut,
  convoyBehavior,
  sampleTrackAt
} from '../src/game/modes/ConvoyBehavior.js';

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

test('Convoy builds smooth arc-length LUTs for all 4 tracks and aims 360 degrees from the center turret', () => {
  const cfg = modesConfig.convoy;
  const r = physicsConfig.ball.radius;
  for (const trackId of cfg.tracks) {
    const lut = buildConvoyTrackLut(trackId, cfg.turretX, cfg.turretY, cfg.lutSamples);
    assert.ok(lut.totalLength > 800, `${trackId} has substantial rail length`);
    for (let s = 0; s <= lut.totalLength; s += 25) {
      const pt = sampleTrackAt(lut, s);
      assert.ok(pt.x - r >= gameConfig.canvas.wallMargin, `${trackId} inside left wall`);
      assert.ok(pt.x + r <= gameConfig.canvas.logicalWidth - gameConfig.canvas.wallMargin, `${trackId} inside right wall`);
    }
  }

  const engine = createEngine();
  engine.startConvoyMode();
  assert.equal(engine.getLauncherSpec().posture, LAUNCHER_POSTURES.OMNI_360);
  for (const type of Object.values(SPECIAL_TYPES)) {
    assert.equal(engine.isSpecialTypeAllowed(type), true);
  }

  // Aim downward (+PI/2) and upward (-PI/2) from center turret
  engine.updateAim(cfg.turretX, cfg.turretY + 120);
  assert.equal(engine.isAimCancelled, false);
  assert.ok(engine.aimAngle > 1.4 && engine.aimAngle < 1.7);

  // Inside cancelRadius cancels the shot
  engine.updateAim(cfg.turretX + 5, cfg.turretY + 5);
  assert.equal(engine.isAimCancelled, true);
});

test('Convoy Magnetic Gap Snapback pulls matching exposed ends together into a chain combo', () => {
  const engine = createEngine();
  engine.startConvoyMode();
  const cfg = modesConfig.convoy;
  const r = physicsConfig.ball.radius;
  const world = engine.physicsWorld;
  const lut = convoyBehavior.getTrackLut(engine, engine.modeState.trackId);

  world.balls.length = 0;
  world.ballMap.clear();
  engine.modeState.spawnRemaining = 0;

  const placeAt = (s, colorId) => {
    const pt = sampleTrackAt(lut, s);
    const b = new Ball({ x: pt.x, y: pt.y, radius: r, colorId, isAnchor: true });
    b.convoyS = s;
    b.convoyRecoil = 0;
    world.addBall(b);
    return b;
  };

  // Rear segment: 2 crimson spheres; Gap of 120 px; Front segment: 1 crimson sphere -> snapback forms a 3-match!
  placeAt(100, 'crimson');
  placeAt(100 + cfg.ballSpacing, 'crimson');
  placeAt(100 + cfg.ballSpacing + 120, 'crimson');
  convoyBehavior.sortAndSyncConvoy(engine, lut);

  const scoreBefore = engine.score;
  for (let i = 0; i < 60 && engine.waveCount === 1; i++) {
    convoyBehavior.onBeforePhysicsStep(engine, 1 / 60);
  }

  assert.equal(engine.waveCount, 2, 'snapback matched all 3 crimson spheres and cleared wave 1');
  assert.ok(engine.score > scoreBefore + cfg.snapbackBonusPoints);
});

test('Convoy triggers VORTEX_REACHED when the lead sphere reaches the Singularity drain', () => {
  const engine = createEngine();
  engine.startConvoyMode();
  const lut = convoyBehavior.getTrackLut(engine, engine.modeState.trackId);

  const lead = engine.physicsWorld.balls[engine.physicsWorld.balls.length - 1];
  lead.convoyS = lut.totalLength + 2;
  convoyBehavior.onBeforePhysicsStep(engine, 1 / 60);

  assert.equal(engine.state, GAME_STATES.GAME_OVER);
  assert.equal(engine.gameOverSummary?.reasonKey, GAME_OVER_REASONS.VORTEX_REACHED);
});

test('Convoy snapshot preserves trackId, spawnRemaining, and sphere arc-length positions on restore', () => {
  const engine = createEngine();
  engine.startConvoyMode();
  for (let i = 0; i < 20; i++) {
    engine.update();
  }
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot({ force: true });

  const expectedS = engine.physicsWorld.balls.map((b) => b.convoyS);
  const expectedTrack = engine.modeState.trackId;
  const expectedRemaining = engine.modeState.spawnRemaining;

  const restored = createEngine();
  restored.storageManager = engine.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.mode, GAME_MODES.CONVOY);
  assert.equal(restored.modeState.trackId, expectedTrack);
  assert.equal(restored.modeState.spawnRemaining, expectedRemaining);
  assert.deepEqual(
    restored.physicsWorld.balls.map((b) => b.convoyS),
    expectedS
  );
});

test('Convoy special spheres do not push lead spheres into the Singularity and mid-wave board clears stay snapshotable', () => {
  const engine = createEngine();
  engine.startConvoyMode();
  const lut = convoyBehavior.getTrackLut(engine, engine.modeState.trackId);
  const lead = engine.physicsWorld.balls[engine.physicsWorld.balls.length - 1];
  const nearDrainS = lut.totalLength - 10;
  lead.convoyS = nearDrainS;

  const specialBall = new Ball({
    x: lead.x,
    y: lead.y,
    radius: physicsConfig.ball.radius,
    colorId: 'crimson',
    specialType: 'freeze'
  });
  engine.physicsWorld.addBall(specialBall);
  const settled = convoyBehavior.onProjectileSettled(engine, { snappedBall: specialBall, hitTarget: lead });
  assert.equal(settled, false, 'special sphere delegates to SpecialBallController without convoy insertion');
  assert.equal(lead.convoyS, nearDrainS, 'lead sphere was not pushed forward toward the Singularity');

  // Clear all visible balls while spawnRemaining > 0 -> spawns next sphere & saves valid snapshot
  engine.physicsWorld.balls.length = 0;
  engine.physicsWorld.ballMap.clear();
  engine.modeState.spawnRemaining = 5;
  convoyBehavior.onTurnCleanedUp(engine);
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot({ force: true });

  const restored = createEngine();
  restored.storageManager = engine.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.mode, GAME_MODES.CONVOY);
  assert.ok(restored.physicsWorld.balls.length >= 1);
});

test('Convoy drawUnderlay highlights attracted Snapback gaps along LUT without mutating balls', () => {
  const engine = createEngine();
  engine.startConvoyMode();
  const cfg = modesConfig.convoy;
  const lut = convoyBehavior.getTrackLut(engine, engine.modeState.trackId);
  engine.physicsWorld.balls = [];
  engine.physicsWorld.ballMap.clear();
  const addConvoy = (s, colorId) => {
    const pt = convoyBehavior.getTrackLut(engine, engine.modeState.trackId);
    const ball = new Ball({ x: pt.xs[0], y: pt.ys[0], radius: physicsConfig.ball.radius, colorId });
    ball.convoyS = s;
    engine.physicsWorld.addBall(ball);
  };
  addConvoy(120, 'crimson');
  addConvoy(120 + cfg.ballSpacing + 90, 'crimson');
  convoyBehavior.sortAndSyncConvoy(engine, lut);
  const originalOrder = engine.physicsWorld.balls.map((b) => b.id);

  let strokes = 0;
  let pathPoints = 0;
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    setLineDash() {},
    beginPath() {},
    moveTo() { pathPoints++; },
    lineTo() { pathPoints++; },
    arc() {},
    stroke() { strokes++; }
  };
  convoyBehavior.drawUnderlay(ctx, engine, null, {
    launcherAccentColor: '#7be0ff',
    overchargePopupColor: '#56e39f',
    dangerLineColor: '#ff4757'
  });
  assert.deepEqual(engine.physicsWorld.balls.map((b) => b.id), originalOrder);
  assert.ok(strokes >= 3 && pathPoints > 4, 'draws rail, LUT snapback bridge, and singularity vortex');
});

test('Convoy Chain Snapback Surge escalates chain multiplier, pushes surviving spheres back on chain >= 2, and round-trips in RunSnapshot', () => {
  const engine = createEngine();
  engine.startConvoyMode();
  const cfg = modesConfig.convoy;
  const lut = convoyBehavior.getTrackLut(engine, engine.modeState.trackId);

  engine.physicsWorld.balls = [];
  engine.physicsWorld.ballMap.clear();
  engine.modeState.spawnRemaining = 0;

  const makeBall = (s, colorId) => {
    const b = new Ball({ x: lut.xs[0], y: lut.ys[0], radius: physicsConfig.ball.radius, colorId, isAnchor: true });
    b.convoyS = s;
    engine.physicsWorld.addBall(b);
    return b;
  };

  // Build two nested same-color snapback groups plus a surviving lead sphere at s = 300.
  makeBall(60, 'amber');
  const firstImpact = makeBall(60 + cfg.ballSpacing, 'crimson');
  makeBall(60 + cfg.ballSpacing * 2, 'crimson');
  makeBall(60 + cfg.ballSpacing * 3, 'crimson');
  const secondImpact = makeBall(60 + cfg.ballSpacing * 4, 'amber');
  makeBall(60 + cfg.ballSpacing * 5, 'amber');
  const survivor = makeBall(360, 'cobalt');
  convoyBehavior.sortAndSyncConvoy(engine, lut);

  // Chain 1: base snapback bonus (chainMultiplier = 1), no chain pushback yet.
  engine.combo = 0;
  convoyBehavior.resolveSnapbackCollision(engine, firstImpact, lut);
  assert.equal(engine.modeState.snapbackChain, 1);
  assert.equal(survivor.convoyS, 360);

  // Close the gap between the two amber spheres so they form a 3-cluster with a third amber sphere, then resolve Chain 2.
  const extraAmber = makeBall(60 + cfg.ballSpacing * 2, 'amber');
  secondImpact.convoyS = 60 + cfg.ballSpacing;
  engine.physicsWorld.balls.find((b) => b.colorId === 'amber' && b !== secondImpact && b !== extraAmber && b.convoyS > 60).convoyS =
    60 + cfg.ballSpacing * 3;
  convoyBehavior.sortAndSyncConvoy(engine, lut);

  const scoreBeforeChain2 = engine.score;
  engine.combo = 0;
  convoyBehavior.resolveSnapbackCollision(engine, secondImpact, lut);
  assert.equal(engine.modeState.snapbackChain, 2);
  const expectedChain2Bonus = Math.round(cfg.snapbackBonusPoints * (1 + cfg.chainBonusStep));
  assert.ok(engine.score >= scoreBeforeChain2 + expectedChain2Bonus);
  assert.equal(survivor.convoyS, 360 - cfg.chainPushbackPx);

  // Snapshot preserves snapbackChain.
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot({ force: true });
  const restored = createEngine();
  restored.storageManager = engine.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.modeState.snapbackChain, 2);
});
