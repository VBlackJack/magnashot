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
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { GameEngine } from '../src/game/GameEngine.js';
import * as BotBrain from '../src/game/BotBrain.js';
import * as CampaignBot from '../scripts/bot/CampaignBot.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const configs = {
  game: applyWorldGeometry(loadJson('./configs/game.json')),
  physics: loadJson('./configs/physics.json'),
  balls: loadJson('./configs/balls.json'),
  obstacles: loadJson('./configs/obstacles.json'),
  levels: loadJson('./configs/levels.json'),
  campaign: loadJson('./configs/campaign.json'),
  audio: loadJson('./configs/audio.json'),
  flux: loadJson('./configs/flux.json')
};
const campaignTuning = loadJson('./configs/campaignTuning.json');
for (const [key, value] of Object.entries(configs)) {
  configRegistry.configs.set(key, value);
}

const bot = configs.campaign.generated.calibration.bot;
const REACH = configs.physics.ball.radius * bot.neighborhoodRadii;
/** An authored level with a full stock of special balls, so the board never changes. */
const DENSE_LEVEL_ID = 11;
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const LCG_MODULUS = 4294967296;
/** Jitter large enough to dominate the neighborhood score, so the stream decides the angle. */
const DOMINANT_JITTER = 1e6;
const SEED_A = 7;
const SEED_B = 3;
const SEED_C = 11;

const createEngine = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  // Calibrated difficulty is measured without the Resonance bonus, which is for humans only.
  storageManager.setResonanceEnabled(false);
  const engine = new GameEngine({
    gameConfig: configs.game,
    physicsConfig: configs.physics,
    ballsConfig: configs.balls,
    obstaclesConfig: configs.obstacles,
    levelsConfig: configs.levels,
    campaignConfig: configs.campaign,
    campaignTuning,
    fluxConfig: configs.flux,
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager,
    onStateChange: () => {}
  });
  engine.startCampaignLevel(DENSE_LEVEL_ID);
  return engine;
};

/** A seeded linear congruential stream in [0, 1). */
const seededRng = (seed) => {
  let state = seed;
  return () => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state / LCG_MODULUS;
  };
};

/** The aim angles the bot samples that produce a trajectory end. */
const reachableAngles = (engine) => {
  const angles = Array.from(
    { length: bot.aimSamples + 1 },
    (_, i) => -Math.PI * (bot.aimArcStart + (bot.aimArcSpan * i) / bot.aimSamples)
  );
  return angles.filter((angle) => {
    engine.updateAimFromAngle(angle);
    return Boolean(engine.aimPoints.at(-1));
  });
};

test('The campaign script re-exports the very same decision functions', () => {
  for (const name of ['BOT_POLICIES', 'pickGreedyAngle', 'shotValue', 'planArsenalShot']) {
    assert.equal(CampaignBot[name], BotBrain[name], `${name} is shared`);
  }
});

test('A seeded rng makes the greedy and arsenal decisions reproducible', () => {
  const engine = createEngine();
  const greedy = (seed) => BotBrain.pickGreedyAngle(engine, bot, REACH, seededRng(seed));
  const arsenal = (seed) => BotBrain.planArsenalShot(engine, bot, REACH, seededRng(seed));
  assert.equal(greedy(SEED_A), greedy(SEED_A));
  assert.deepEqual(arsenal(SEED_A), arsenal(SEED_A));
});

test('The default rng is Math.random, read at call time', () => {
  const engine = createEngine();
  const expectedAngle = BotBrain.pickGreedyAngle(engine, bot, REACH, seededRng(SEED_B));
  const expectedShot = BotBrain.planArsenalShot(engine, bot, REACH, seededRng(SEED_B));
  const original = Math.random;
  try {
    Math.random = seededRng(SEED_B);
    assert.equal(BotBrain.pickGreedyAngle(engine, bot, REACH), expectedAngle);
    Math.random = seededRng(SEED_B);
    assert.deepEqual(BotBrain.planArsenalShot(engine, bot, REACH), expectedShot);
  } finally {
    Math.random = original;
  }
});

test('The injected rng drives the aim jitter', () => {
  const engine = createEngine();
  const jittery = { ...bot, aimJitter: DOMINANT_JITTER };
  const reachable = reachableAngles(engine);
  assert.ok(reachable.length > 1, 'several angles end somewhere');
  // The stream is drawn once per reachable angle, in order: a single high draw picks that angle.
  for (const winner of [0, 2, reachable.length - 1]) {
    let calls = 0;
    const spike = () => (calls++ === winner ? 1 : 0);
    assert.equal(BotBrain.pickGreedyAngle(engine, jittery, REACH, spike), reachable[winner]);
  }
});

test('Planning returns a color shot or a stocked special', () => {
  const engine = createEngine();
  const shot = BotBrain.planArsenalShot(engine, bot, REACH, seededRng(SEED_C));
  assert.ok(shot.specialType === null || engine.specialInventory[shot.specialType] > 0);
  assert.notEqual(shot.angle, null);
});
