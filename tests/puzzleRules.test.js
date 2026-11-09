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
import { GAME_MODES } from '../src/core/Constants.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { getResonanceBlock, RESONANCE_BLOCKS } from '../src/game/Resonance.js';

const loadJson = (path) => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

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

const TWO_SHOT_STAGE = 4;
const TILT_TEST_SHARE = 0.5;
const OVERCHARGE_TEST_AMOUNT = 1000;
const COIN_TEST_AMOUNT = 50;
const UPGRADE_KEYS = Object.keys(gameConfig.upgrades);

const createPuzzleEngine = (stage = 1) => {
  const storageManager = new StorageManager();
  storageManager.init();
  const dummyAudio = { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} };
  const engine = new GameEngine({
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
  engine.startPuzzleMode(stage);
  return engine;
};

/** Sets every Workshop upgrade to its maximum level on the engine's storage. */
const maxOutUpgrades = (engine) => {
  const levels = {};
  for (const key of UPGRADE_KEYS) {
    levels[key] = gameConfig.upgrades[key].maxLevel;
  }
  engine.storageManager.upgradesCache = levels;
};

const readEffectiveRules = (engine) => ({
  levels: UPGRADE_KEYS.map((key) => engine.getEffectiveUpgradeLevel(key)),
  blast: engine.getBlastRadiusMultiplier(),
  laser: { ...engine.getLaserBonuses() },
  collectorPoints: engine.getCollectorBonusPoints(),
  collectorOvercharge: engine.getCollectorOvercharge(),
  startingShots: engine.getStartingShotsBonus()
});

test('Puzzle ignores the Workshop: maxed upgrades give the same effective rules as none', () => {
  const baseline = createPuzzleEngine();
  const maxed = createPuzzleEngine();
  maxOutUpgrades(maxed);
  assert.deepEqual(readEffectiveRules(maxed), readEffectiveRules(baseline));
  assert.ok(maxed.getEffectiveUpgradeLevel(UPGRADE_KEYS[0]) === 0);
  assert.equal(maxed.areUpgradesNeutralised(), true);
});

test('Puzzle device tilt is locked and the tilt factor stays zero', () => {
  const engine = createPuzzleEngine();
  assert.equal(engine.isTiltLocked(), true);
  engine.setTilt(TILT_TEST_SHARE);
  assert.equal(engine.physicsWorld.tiltFactor, 0);
});

test('Puzzle earns no Overcharge and grants no special ball', () => {
  const engine = createPuzzleEngine();
  assert.equal(engine.getOverchargeMultiplier(), 0);
  const inventoryBefore = JSON.stringify(engine.specialInventory);
  engine.addOvercharge(OVERCHARGE_TEST_AMOUNT);
  assert.equal(engine.overcharge, 0);
  assert.equal(JSON.stringify(engine.specialInventory), inventoryBefore);
});

test('Resonance is blocked by the ruleset in Puzzle', () => {
  assert.equal(getResonanceBlock({ mode: GAME_MODES.PUZZLE, setting: true }), RESONANCE_BLOCKS.RULESET);
});

test('Puzzle ignores the launcher swap on a two-shot stage', () => {
  const engine = createPuzzleEngine(TWO_SHOT_STAGE);
  assert.ok(engine.shotsRemaining > 1, 'stage has more than one shot');
  const { currentBall, nextBall } = engine;
  assert.ok(currentBall && nextBall, 'both launcher balls exist');
  engine.swapLauncherBalls();
  assert.equal(engine.currentBall, currentBall);
  assert.equal(engine.nextBall, nextBall);
});

test('Puzzle pays no run coins', () => {
  const engine = createPuzzleEngine();
  const coinsBefore = engine.storageManager.getCoins();
  engine.awardRunCoins(COIN_TEST_AMOUNT);
  assert.equal(engine.runCoinsEarned, 0);
  assert.equal(engine.pendingRunCoins, 0);
  assert.equal(engine.storageManager.getCoins(), coinsBefore);
});
