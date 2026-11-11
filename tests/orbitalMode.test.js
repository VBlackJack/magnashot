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
import { GAME_MODES, GAME_OVER_REASONS, GAME_STATES, SPECIAL_TYPES } from '../src/core/Constants.js';
import { Ball } from '../src/entities/Ball.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { orbitalBehavior } from '../src/game/modes/OrbitalBehavior.js';

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

test('Orbital Spin starts in Zero-G with a free-spinning central core and allows all special spheres', () => {
  const engine = createEngine();
  engine.startOrbitalMode();

  assert.equal(engine.mode, GAME_MODES.ORBITAL);
  assert.equal(engine.state, GAME_STATES.PLAYING);
  assert.equal(engine.physicsWorld.gravityMultiplier, 0);
  assert.equal(engine.offersSpecialBalls(), true);
  for (const type of Object.values(SPECIAL_TYPES)) {
    assert.equal(engine.isSpecialTypeAllowed(type), true, `${type} allowed in Orbital`);
  }

  const corePivot = orbitalBehavior.getCorePivot(engine);
  assert.ok(corePivot, 'central core pivot exists');
  assert.equal(corePivot.motorAngularSpeed, 0);
  assert.ok(engine.physicsWorld.balls.length > 0);
});

test('Off-center impacts impart angular momentum to the central core with opposing signs on opposite sides', () => {
  const engineLeft = createEngine();
  engineLeft.startOrbitalMode();
  const pivotLeft = orbitalBehavior.getCorePivot(engineLeft);
  orbitalBehavior.applyImpactAngularImpulse(engineLeft, pivotLeft.x - 60, pivotLeft.y, 0, -14);

  const engineRight = createEngine();
  engineRight.startOrbitalMode();
  const pivotRight = orbitalBehavior.getCorePivot(engineRight);
  orbitalBehavior.applyImpactAngularImpulse(engineRight, pivotRight.x + 60, pivotRight.y, 0, -14);

  assert.notEqual(pivotLeft.angularVelocity, 0);
  assert.equal(Math.sign(pivotLeft.angularVelocity), -Math.sign(pivotRight.angularVelocity));
});

test('Detached spheres drift radially outward in 360 degrees and score when caught by Collector Arcs', () => {
  const engine = createEngine();
  engine.startOrbitalMode();
  const cfg = modesConfig.orbital;
  const r = physicsConfig.ball.radius;

  // Simulate a detached sphere along collectorPhase angle so it flies directly into Collector Arc #0
  const phase = engine.modeState.collectorPhase;
  const detached = new Ball({
    x: cfg.coreX + Math.cos(phase) * (cfg.dangerRadius - 20),
    y: cfg.coreY + Math.sin(phase) * (cfg.dangerRadius - 20),
    radius: r,
    colorId: 'crimson'
  });
  detached.isDropping = true;
  engine.physicsWorld.droppingBalls.push(detached);

  orbitalBehavior.captureDetachedIntoRadialDrift(engine);
  assert.equal(engine.physicsWorld.droppingBalls.length, 0);
  assert.equal(engine.modeState.driftingBalls.length, 1);

  const scoreBefore = engine.score;
  const overchargeBefore = engine.overcharge;
  for (let i = 0; i < 30 && engine.modeState.driftingBalls.length > 0; i++) {
    orbitalBehavior.onAfterPhysicsStep(engine, 1 / 60);
  }
  assert.equal(engine.modeState.driftingBalls.length, 0);
  assert.ok(engine.score >= scoreBefore + cfg.collectorBonusPoints);
  assert.ok(engine.overcharge > overchargeBefore);
});

test('Orbital triggers RING_BREACHED when an anchored cluster sphere crosses the containment ring', () => {
  const engine = createEngine();
  engine.startOrbitalMode();
  const cfg = modesConfig.orbital;
  const corePivot = orbitalBehavior.getCorePivot(engine);
  const r = physicsConfig.ball.radius;

  // Bond a chain reaching dangerRadius to an anchored inner ball
  const inner = engine.physicsWorld.balls.find((b) => b.isAnchor);
  const breacher = new Ball({
    x: cfg.coreX + cfg.dangerRadius - r + 4,
    y: corePivot.y,
    radius: r,
    colorId: 'cobalt'
  });
  engine.physicsWorld.addBall(breacher);
  engine.physicsWorld.createBond(inner, breacher, false);

  orbitalBehavior.checkRingBreach(engine);
  assert.equal(engine.state, GAME_STATES.GAME_OVER);
  assert.equal(engine.gameOverSummary?.reasonKey, GAME_OVER_REASONS.RING_BREACHED);
});

test('Orbital snapshot preserves wave countdown, collector phase, and zero-G physics on restore', () => {
  const engine = createEngine();
  engine.startOrbitalMode();
  engine.hasFiredInRound = true;
  engine.modeState.turnsUntilWave = 3;
  engine.modeState.collectorPhase = 1.25;
  engine.saveRunSnapshot({ force: true });

  const restored = createEngine();
  restored.storageManager = engine.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.mode, GAME_MODES.ORBITAL);
  assert.equal(restored.physicsWorld.gravityMultiplier, 0);
  assert.equal(restored.modeState.turnsUntilWave, 3);
  assert.equal(restored.modeState.collectorPhase, 1.25);
});
