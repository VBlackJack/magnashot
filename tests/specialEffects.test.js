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
import { predictImpact } from '../src/game/ImpactPreview.js';
import { CLUSTER_MODIFIERS, SPECIAL_TYPES } from '../src/core/Constants.js';
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

const RADIUS = physicsConfig.ball.radius;
const REST_DISTANCE = RADIUS * physicsConfig.simulation.bondRestDistanceFactor;
const ORIGIN_X = 200;
const ORIGIN_Y = 200;
const FAR_X = 500;
const FAR_Y = 600;
const BOSS_SHIELD_HITS = 3;
const [COLOR_A, COLOR_B] = ballsConfig.standardColors.map((c) => c.id);

const createBoard = () => {
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
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager,
    onStateChange: () => {}
  });
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  return engine;
};

const addBall = (engine, x, y, options = {}) =>
  engine.physicsWorld.addBall(new Ball({ x, y, radius: RADIUS, colorId: COLOR_A, ...options }));

/** Anchored, bonded horizontal run of spheres starting at (x, y). */
const addBondedRun = (engine, x, y, colors) => {
  const run = colors.map((colorId, i) => addBall(engine, x + i * REST_DISTANCE, y, { colorId, isAnchor: true }));
  for (let i = 1; i < run.length; i++) {
    engine.physicsWorld.createBond(run[i - 1], run[i], false);
  }
  return run;
};

const preview = (engine, shot) =>
  predictImpact({
    points: [{ x: shot.x, y: shot.y + RADIUS }, { x: shot.x, y: shot.y }],
    currentBall: shot,
    physicsWorld: engine.physicsWorld,
    endX: shot.x,
    endY: shot.y,
    blastMult: 1,
    specialTypes: ballsConfig.specialTypes,
    matchMinCount: gameConfig.defaults.matchMinCount
  });

test('A Prism shot that hits a sphere destroys the touching colour cluster and scores', () => {
  const engine = createBoard();
  addBall(engine, FAR_X, FAR_Y, { isAnchor: true, colorId: COLOR_B });
  const cluster = addBondedRun(engine, ORIGIN_X, ORIGIN_Y, [COLOR_A, COLOR_A, COLOR_A]);
  const shot = addBall(engine, ORIGIN_X, ORIGIN_Y + REST_DISTANCE, { colorId: null, specialType: SPECIAL_TYPES.RAINBOW });

  engine.handleProjectileSnapped(shot, cluster[0]);

  for (const member of cluster) {
    assert.equal(engine.physicsWorld.ballMap.has(member.id), false, 'every sphere of the touched cluster is destroyed');
  }
  assert.equal(engine.physicsWorld.ballMap.has(shot.id), false, 'the Prism ball is consumed');
  assert.ok(engine.score > 0, 'the destroyed cluster scores');
});

test('Brush reports only the spheres it actually recoloured', () => {
  const engine = createBoard();
  const [odd, ...same] = addBondedRun(engine, ORIGIN_X, ORIGIN_Y, [COLOR_A, COLOR_B, COLOR_B]);
  const brush = new Ball({
    x: ORIGIN_X + REST_DISTANCE,
    y: ORIGIN_Y + REST_DISTANCE * 0.5,
    radius: RADIUS,
    colorId: null,
    specialType: SPECIAL_TYPES.BRUSH
  });
  engine.physicsWorld.addBall(brush);
  const specs = ballsConfig.specialTypes.brush;

  const result = engine.specialController.triggerBrush(
    brush,
    specs,
    engine.physicsWorld,
    engine.particleSystem,
    { playEffect: () => {} },
    1
  );

  assert.deepEqual(result.painted, [odd], 'only the sphere that changed colour is reported');
  assert.equal(result.scoreDelta, specs.pointsPerBall);
  assert.equal(odd.colorId, COLOR_B);
  for (const member of same) {
    assert.ok(engine.physicsWorld.pendingChainCandidateIds.has(member.id), 'same-colour spheres still join the chain check');
  }
});

test('Impact previews do not mark a shielded Boss Core as destroyed, and do once its last shield is left', () => {
  for (const specialType of [SPECIAL_TYPES.BOMB, SPECIAL_TYPES.LIGHTNING, SPECIAL_TYPES.ANVIL, SPECIAL_TYPES.ROCKET]) {
    const engine = createBoard();
    const boss = addBall(engine, ORIGIN_X, ORIGIN_Y, {
      isAnchor: true,
      clusterModifier: CLUSTER_MODIFIERS.BOSS_CORE,
      armorHits: BOSS_SHIELD_HITS
    });
    const plain = addBall(engine, ORIGIN_X + REST_DISTANCE, ORIGIN_Y, { isAnchor: true });
    const shot = new Ball({ x: ORIGIN_X, y: ORIGIN_Y, radius: RADIUS, colorId: null, specialType });

    let result = preview(engine, shot);
    assert.ok(result.highlight.includes(boss), `${specialType}: the core is highlighted`);
    assert.equal(result.destroyedIds.has(boss.id), false, `${specialType}: a shielded core survives the preview`);
    assert.ok(result.destroyedIds.has(plain.id), `${specialType}: an ordinary sphere is still destroyed`);

    boss.armorHits = 1;
    result = preview(engine, shot);
    assert.ok(result.destroyedIds.has(boss.id), `${specialType}: a core on its last shield is destroyed`);
  }
});

test('The platform support tolerance is read from the physics config', () => {
  assert.ok(Number.isFinite(physicsConfig.simulation.platformSupportTolerancePx));
  assert.ok(physicsConfig.simulation.platformSupportTolerancePx > 0);
});
