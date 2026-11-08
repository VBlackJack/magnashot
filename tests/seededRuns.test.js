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
import { captureRunSnapshot, isValidRunSnapshot, applyRunSnapshot } from '../src/game/RunSnapshot.js';
import { GAME_MODES } from '../src/core/Constants.js';
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

const SHARED_FLUX_SEED = 'shared1';
const DAILY_TEST_SEED = '2025-03-14';
const TARGET_FLUX_STAGE = 2;
const FEW_DRAWS = 3;
const MANY_DRAWS = 57;
const SNAPSHOT_VERSION = 1;

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

/** Colours, modifiers and positions of the board, in creation order. */
const boardSignature = (engine) =>
  engine.physicsWorld.balls.map((b) => [b.x, b.y, b.colorId, b.clusterModifier, b.isAnchor]);

/** Plays the run stream differently, as shots would, without touching the board. */
const burnRunDraws = (engine, count) => {
  for (let i = 0; i < count; i++) {
    engine.random();
  }
};

const buildFluxStageTwo = (draws) => {
  const engine = createTestEngine();
  engine.startFluxRun(SHARED_FLUX_SEED, { isShared: true });
  burnRunDraws(engine, draws);
  engine.fluxStage = TARGET_FLUX_STAGE;
  engine.buildFluxStage({ persist: false });
  return engine;
};

test('shared Flux seed builds the same stage whatever was played before it', () => {
  const a = buildFluxStageTwo(FEW_DRAWS);
  const b = buildFluxStageTwo(MANY_DRAWS);
  assert.ok(boardSignature(a).length > 0);
  assert.deepEqual(boardSignature(a), boardSignature(b));
});

test('scoped board stream is restored after generation', () => {
  const engine = buildFluxStageTwo(FEW_DRAWS);
  assert.equal(engine.scopedRng, null);
});

const buildDailyWaveTwo = (draws) => {
  const engine = createTestEngine();
  engine.startDailyChallenge(DAILY_TEST_SEED, true);
  const initial = boardSignature(engine);
  burnRunDraws(engine, draws);
  engine.spawnEndlessWave();
  return { initial, afterWave: boardSignature(engine) };
};

test('Daily Challenge wave content is identical for every player of the day', () => {
  const a = buildDailyWaveTwo(FEW_DRAWS);
  const b = buildDailyWaveTwo(MANY_DRAWS);
  assert.deepEqual(a.initial, b.initial);
  assert.ok(a.afterWave.length > a.initial.length);
  assert.deepEqual(a.afterWave, b.afterWave);
});

test('a snapshot saved before the optional fields existed still restores', () => {
  const engine = createTestEngine();
  engine.startFluxRun(SHARED_FLUX_SEED, { isShared: true });
  const snapshot = JSON.parse(JSON.stringify(captureRunSnapshot(engine, SNAPSHOT_VERSION)));
  delete snapshot.engine.isCoreFreezeApplied;
  assert.ok(isValidRunSnapshot(snapshot, SNAPSHOT_VERSION));

  const fresh = createTestEngine();
  assert.equal(applyRunSnapshot(fresh, snapshot), true);
  assert.equal(fresh.mode, GAME_MODES.FLUX);
  assert.equal(fresh.isCoreFreezeApplied, false);
  assert.equal(fresh.physicsWorld.balls.length, snapshot.balls.length);
});

test('a Classic stage board is identical for every run whatever was played before it', () => {
  const buildStageTwo = (draws) => {
    const engine = createTestEngine();
    engine.startClassicMode(2);
    burnRunDraws(engine, draws);
    engine.buildClassicStage(2);
    return boardSignature(engine);
  };
  const a = buildStageTwo(FEW_DRAWS);
  const b = buildStageTwo(MANY_DRAWS);
  assert.ok(a.length > 0);
  assert.deepEqual(a, b);
});

test('a Classic run restores the launcher stream it was saved with', () => {
  const engine = createTestEngine();
  engine.startClassicMode();
  burnRunDraws(engine, FEW_DRAWS);
  const snapshot = JSON.parse(JSON.stringify(captureRunSnapshot(engine, SNAPSHOT_VERSION)));
  assert.ok(isValidRunSnapshot(snapshot, SNAPSHOT_VERSION));
  const fresh = createTestEngine();
  assert.equal(applyRunSnapshot(fresh, snapshot), true);
  assert.equal(fresh.mode, GAME_MODES.CLASSIC);
  assert.equal(fresh.seededRng.state, engine.seededRng.state);
});
