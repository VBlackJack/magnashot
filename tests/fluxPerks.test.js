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
import { GameEngine, FLUX_PERK_IDS } from '../src/game/GameEngine.js';
import { GAME_MODES, GAME_STATES } from '../src/core/Constants.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const campaignConfig = loadJson('./configs/campaign.json');
const campaignTuning = loadJson('./configs/campaignTuning.json');
const audioConfig = loadJson('./configs/audio.json');
const fluxConfig = loadJson('./configs/flux.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('campaign', campaignConfig);
configRegistry.configs.set('audio', audioConfig);
configRegistry.configs.set('flux', fluxConfig);

const perksCfg = fluxConfig.perks;
const PERK_SEED = 'perk-seed';
const ALL_PERK_IDS = Object.values(FLUX_PERK_IDS);
const DETERMINISM_SEED_COUNT = 20;
const FROZEN_FRAME_COUNT = 30;
const FLOAT_TOLERANCE = 1e-9;
/** Cleared shapes that follow the first offer, enough to reach the second one. */
const STAGES_TO_SECOND_OFFER = perksCfg.interval * 2;

const createStorage = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  return storageManager;
};

const createEngine = (storageManager = createStorage(), onStateChange = () => {}) =>
  new GameEngine({
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
    onStateChange
  });

const startRun = (seed = PERK_SEED, storage = createStorage()) => {
  const engine = createEngine(storage);
  engine.startFluxRun(seed);
  return engine;
};

/** Clears the current shape and plays the transition until the next one is built. */
const clearStage = (engine) => {
  for (const ball of [...engine.physicsWorld.balls]) {
    engine.physicsWorld.removeBall(ball);
  }
  engine.evaluateRoundEnd();
  while (engine.stageTransitionFrames > 0) {
    engine.update();
  }
};

/** Clears shapes up to the first offer and leaves it pending. */
const reachFirstOffer = (engine) => {
  for (let i = 0; i < perksCfg.interval; i++) {
    clearStage(engine);
  }
  return engine;
};

const countSpecials = (engine) => Object.values(engine.specialInventory).reduce((sum, n) => sum + n, 0);

/** Puts a one-perk offer in place without going through a draw. */
const offer = (engine, perkId) => {
  engine.fluxPerkOffer = [perkId];
};

test('An offer comes after every third cleared shape and not after the first two', () => {
  const engine = startRun();
  for (let cleared = 1; cleared <= STAGES_TO_SECOND_OFFER; cleared++) {
    clearStage(engine);
    const isDue = cleared % perksCfg.interval === 0;
    assert.equal(engine.isAwaitingPerk(), isDue, `stage ${cleared} cleared`);
    if (isDue) {
      assert.ok(engine.fluxPerkOffer.length >= 1 && engine.fluxPerkOffer.length <= perksCfg.offerSize);
      assert.equal(new Set(engine.fluxPerkOffer).size, engine.fluxPerkOffer.length, 'offered perks are distinct');
      assert.ok(engine.fluxPerkOffer.every((id) => perksCfg.order.includes(id)));
      engine.chooseFluxPerk(engine.fluxPerkOffer[0]);
      assert.equal(engine.isAwaitingPerk(), false);
    }
  }
});

test('The board is frozen and shooting is refused while a perk is pending', () => {
  const engine = reachFirstOffer(startRun());
  assert.equal(engine.isAwaitingPerk(), true);
  assert.equal(engine.state, GAME_STATES.PLAYING);

  const shots = engine.shotsRemaining;
  const intro = engine.stageIntroFrames;
  const positions = engine.physicsWorld.balls.map((b) => [b.x, b.y]);
  for (let frame = 0; frame < FROZEN_FRAME_COUNT; frame++) {
    engine.update();
  }
  engine.shoot();

  assert.equal(engine.physicsWorld.projectile, null);
  assert.equal(engine.shotsRemaining, shots);
  assert.equal(engine.stageIntroFrames, intro, 'the intro does not run under the choice');
  assert.deepEqual(
    engine.physicsWorld.balls.map((b) => [b.x, b.y]),
    positions
  );

  assert.equal(engine.chooseFluxPerk(engine.fluxPerkOffer[0]), true);
  for (let frame = 0; frame < intro; frame++) {
    engine.update();
  }
  engine.shoot();
  assert.ok(engine.physicsWorld.projectile, 'shooting resumes once the perk is taken');
});

test('chooseFluxPerk rejects ids outside the offer and calls without an offer', () => {
  const engine = startRun();
  assert.equal(engine.chooseFluxPerk(FLUX_PERK_IDS.RESERVE), false, 'no offer pending');

  reachFirstOffer(engine);
  const offered = [...engine.fluxPerkOffer];
  const notOffered = ALL_PERK_IDS.find((id) => !offered.includes(id));
  const shots = engine.shotsRemaining;
  if (notOffered) {
    assert.equal(engine.chooseFluxPerk(notOffered), false);
  }
  assert.equal(engine.chooseFluxPerk('nonexistent'), false);
  assert.deepEqual(engine.fluxPerkOffer, offered, 'a refused pick keeps the offer');
  assert.equal(engine.shotsRemaining, shots);
  assert.deepEqual(engine.fluxPerks, {});
});

test('Taking a perk clears the offer, counts a stack, stores the run and notifies the UI', () => {
  let lastExtra = {};
  const storage = createStorage();
  const engine = createEngine(storage, (_engine, extra) => {
    lastExtra = extra || {};
  });
  engine.startFluxRun(PERK_SEED);
  reachFirstOffer(engine);
  const pick = engine.fluxPerkOffer[0];

  assert.equal(engine.chooseFluxPerk(pick), true);
  assert.equal(lastExtra.fluxPerkChosen, pick);
  assert.equal(engine.fluxPerkOffer, null);
  assert.equal(engine.getFluxPerkStacks(pick), 1);
  const stored = storage.loadRunSnapshot();
  assert.equal(stored.fluxPerkOffer, null);
  assert.equal(stored.fluxPerks[pick], 1);
});

test('Reserve adds its shots right away', () => {
  const engine = startRun();
  const shots = engine.shotsRemaining;
  offer(engine, FLUX_PERK_IDS.RESERVE);
  engine.chooseFluxPerk(FLUX_PERK_IDS.RESERVE);
  assert.equal(engine.shotsRemaining, shots + perksCfg.catalog.reserve.step);
});

test('Refill adds shots on every later shape clear, scaled by stacks', () => {
  const engine = startRun();
  const { step } = perksCfg.catalog.refill;
  for (let stacks = 1; stacks <= 2; stacks++) {
    offer(engine, FLUX_PERK_IDS.REFILL);
    engine.chooseFluxPerk(FLUX_PERK_IDS.REFILL);
    const before = engine.shotsRemaining;
    const stage = engine.fluxStage;
    engine.completeFluxStage();
    assert.equal(engine.shotsRemaining - before, engine.getFluxShotRefill(stage) + step * stacks);
    engine.stageTransitionFrames = 0;
  }
});

test('Blast and overcharge raise their multipliers additively', () => {
  const engine = startRun();
  const blastBase = engine.getBlastRadiusMultiplier();
  const chargeBase = engine.getOverchargeMultiplier();

  offer(engine, FLUX_PERK_IDS.BLAST);
  engine.chooseFluxPerk(FLUX_PERK_IDS.BLAST);
  offer(engine, FLUX_PERK_IDS.BLAST);
  engine.chooseFluxPerk(FLUX_PERK_IDS.BLAST);
  offer(engine, FLUX_PERK_IDS.OVERCHARGE);
  engine.chooseFluxPerk(FLUX_PERK_IDS.OVERCHARGE);

  assert.ok(Math.abs(engine.getBlastRadiusMultiplier() - (blastBase + 2 * perksCfg.catalog.blast.step)) < FLOAT_TOLERANCE);
  assert.ok(Math.abs(engine.getOverchargeMultiplier() - (chargeBase + perksCfg.catalog.overcharge.step)) < FLOAT_TOLERANCE);
});

test('Perk multipliers apply in Flux only', () => {
  const engine = startRun();
  const preFlux = engine.getBlastRadiusMultiplier();
  offer(engine, FLUX_PERK_IDS.BLAST);
  engine.chooseFluxPerk(FLUX_PERK_IDS.BLAST);
  const inFlux = engine.getBlastRadiusMultiplier();

  engine.startCampaignLevel(1);
  assert.equal(engine.mode, GAME_MODES.CAMPAIGN);
  assert.deepEqual(engine.fluxPerks, {});
  assert.ok(inFlux > preFlux);
  assert.equal(engine.getBlastRadiusMultiplier(), preFlux, 'outside Flux the multiplier is the plain one');
  assert.equal(engine.getFluxPerkStacks(FLUX_PERK_IDS.BLAST), 0);
});

test('Arsenal grants only the special balls the run starts with, with one popup and sound', () => {
  const startingTypes = Object.entries(fluxConfig.initialSpecialCounts)
    .filter(([, count]) => count > 0)
    .map(([type]) => type);
  const emptyTypes = Object.entries(fluxConfig.initialSpecialCounts)
    .filter(([, count]) => count === 0)
    .map(([type]) => type);
  assert.ok(emptyTypes.length > 0, 'the config has types the run does not start with');

  for (let seed = 0; seed < DETERMINISM_SEED_COUNT; seed++) {
    const engine = startRun(`arsenal-${seed}`);
    const sounds = [];
    const popups = [];
    engine.audioManager.playEffect = (name) => sounds.push(name);
    engine.particleSystem.spawnFloatingText = (x, y, text) => popups.push(text);
    const before = { ...engine.specialInventory };
    const total = countSpecials(engine);
    offer(engine, FLUX_PERK_IDS.ARSENAL);
    engine.chooseFluxPerk(FLUX_PERK_IDS.ARSENAL);

    assert.equal(countSpecials(engine), total + perksCfg.catalog.arsenal.step);
    for (const type of emptyTypes) {
      assert.equal(engine.specialInventory[type] || 0, before[type] || 0, `seed ${seed}: ${type} is never granted`);
    }
    for (const [type, count] of Object.entries(engine.specialInventory)) {
      if (count > (before[type] || 0)) {
        assert.ok(startingTypes.includes(type), `${type} is a starting type`);
      }
    }
    assert.equal(sounds.length, 1, 'one sound per pick');
    assert.equal(popups.length, 1, 'one popup per pick');
  }
});

test('Golden adds coins on every later shape clear, scaled by stacks', () => {
  const engine = startRun();
  const { step } = perksCfg.catalog.golden;
  const base = fluxConfig.rewards.stageClearCoins;

  engine.completeFluxStage();
  assert.equal(engine.runCoinsEarned, base);

  engine.stageTransitionFrames = 0;
  offer(engine, FLUX_PERK_IDS.GOLDEN);
  engine.chooseFluxPerk(FLUX_PERK_IDS.GOLDEN);
  const before = engine.runCoinsEarned;
  engine.completeFluxStage();
  assert.equal(engine.runCoinsEarned - before, base + step);
});

test('A perk at its stack cap is never offered and an empty pool gives no offer', () => {
  const engine = startRun();
  const capped = FLUX_PERK_IDS.RESERVE;
  engine.fluxPerks = { [capped]: perksCfg.catalog[capped].maxStacks };
  for (let seed = 0; seed < DETERMINISM_SEED_COUNT; seed++) {
    engine.fluxSeed = `cap-${seed}`;
    const drawn = engine.drawFluxPerkOffer(perksCfg.interval);
    assert.ok(drawn && !drawn.includes(capped), `seed ${seed} offers a capped perk`);
  }

  engine.fluxPerks = Object.fromEntries(ALL_PERK_IDS.map((id) => [id, perksCfg.catalog[id].maxStacks]));
  assert.equal(engine.drawFluxPerkOffer(perksCfg.interval), null);

  engine.fluxStage = perksCfg.interval;
  clearStage(engine);
  assert.equal(engine.isAwaitingPerk(), false, 'a run with every perk capped is never frozen');
});

test('A smaller pool is offered whole', () => {
  const engine = startRun();
  const keep = ALL_PERK_IDS.slice(0, 2);
  engine.fluxPerks = Object.fromEntries(
    ALL_PERK_IDS.filter((id) => !keep.includes(id)).map((id) => [id, perksCfg.catalog[id].maxStacks])
  );
  assert.deepEqual([...engine.drawFluxPerkOffer(perksCfg.interval)].sort(), [...keep].sort());
});

test('The offer depends only on the seed, the cleared stage and the perks held', () => {
  for (let seed = 0; seed < DETERMINISM_SEED_COUNT; seed++) {
    const first = startRun(`det-${seed}`);
    const second = startRun(`det-${seed}`);
    assert.deepEqual(first.drawFluxPerkOffer(perksCfg.interval), second.drawFluxPerkOffer(perksCfg.interval));
    assert.equal(first.drawFluxPerkOffer(1), null);
    assert.equal(first.drawFluxPerkOffer(perksCfg.interval + 1), null);
  }
  const a = reachFirstOffer(startRun('det-run'));
  const b = reachFirstOffer(startRun('det-run'));
  assert.deepEqual(a.fluxPerkOffer, b.fluxPerkOffer);
});

test('A run stored with a pending offer resumes on the same offer', () => {
  const storage = createStorage();
  const engine = reachFirstOffer(startRun(PERK_SEED, storage));
  const pending = [...engine.fluxPerkOffer];
  assert.deepEqual(storage.loadRunSnapshot().fluxPerkOffer, pending);

  const resumed = createEngine(storage);
  assert.equal(resumed.restoreSavedRun(), true);
  assert.equal(resumed.mode, GAME_MODES.FLUX);
  assert.deepEqual(resumed.fluxPerkOffer, pending);
  assert.equal(resumed.isAwaitingPerk(), true);
  assert.equal(resumed.chooseFluxPerk(pending[0]), true);
});

test('A run stored with perks resumes with the same stacks', () => {
  const storage = createStorage();
  const engine = startRun(PERK_SEED, storage);
  offer(engine, FLUX_PERK_IDS.REFILL);
  engine.chooseFluxPerk(FLUX_PERK_IDS.REFILL);
  offer(engine, FLUX_PERK_IDS.REFILL);
  engine.chooseFluxPerk(FLUX_PERK_IDS.REFILL);
  offer(engine, FLUX_PERK_IDS.GOLDEN);
  engine.chooseFluxPerk(FLUX_PERK_IDS.GOLDEN);

  const resumed = createEngine(storage);
  assert.equal(resumed.restoreSavedRun(), true);
  assert.deepEqual(resumed.fluxPerks, { [FLUX_PERK_IDS.REFILL]: 2, [FLUX_PERK_IDS.GOLDEN]: 1 });
  assert.equal(resumed.fluxPerkOffer, null);
  assert.equal(resumed.getFluxPerkBonus(FLUX_PERK_IDS.REFILL), 2 * perksCfg.catalog.refill.step);
});

test('A run stored before perks existed still resumes', () => {
  const storage = createStorage();
  startRun(PERK_SEED, storage).saveRunSnapshot({ force: true });
  const snapshot = storage.loadRunSnapshot();
  delete snapshot.fluxPerks;
  delete snapshot.fluxPerkOffer;
  storage.saveRunSnapshot(snapshot);

  const resumed = createEngine(storage);
  assert.equal(resumed.restoreSavedRun(), true);
  assert.deepEqual(resumed.fluxPerks, {});
  assert.equal(resumed.fluxPerkOffer, null);
  assert.equal(resumed.isAwaitingPerk(), false);
});

test('Damaged perk fields are sanitized instead of rejecting the run', () => {
  const storage = createStorage();
  startRun(PERK_SEED, storage).saveRunSnapshot({ force: true });
  const maxStacks = perksCfg.catalog.golden.maxStacks;
  const snapshot = storage.loadRunSnapshot();
  snapshot.fluxPerks = { golden: maxStacks + 5, reserve: -2, bogus: 3, blast: 'two' };
  snapshot.fluxPerkOffer = ['golden', 'refill'];
  storage.saveRunSnapshot(snapshot);

  const resumed = createEngine(storage);
  assert.equal(resumed.restoreSavedRun(), true);
  assert.deepEqual(resumed.fluxPerks, { golden: maxStacks });
  assert.equal(resumed.fluxPerkOffer, null, 'an offer naming a capped perk is dropped');

  const badOffers = [[], 'refill', ['refill', 'refill'], ['refill', 'unknown'], ALL_PERK_IDS, [7]];
  for (const badOffer of badOffers) {
    snapshot.fluxPerks = {};
    snapshot.fluxPerkOffer = badOffer;
    storage.saveRunSnapshot(snapshot);
    const again = createEngine(storage);
    assert.equal(again.restoreSavedRun(), true);
    assert.equal(again.fluxPerkOffer, null, `offer ${JSON.stringify(badOffer)} is dropped`);
  }
});

test('Starting a new run wipes the perks and any pending offer', () => {
  const engine = reachFirstOffer(startRun());
  assert.equal(engine.isAwaitingPerk(), true);
  engine.chooseFluxPerk(engine.fluxPerkOffer[0]);
  assert.notDeepEqual(engine.fluxPerks, {});

  engine.startFluxRun('another-seed');
  assert.deepEqual(engine.fluxPerks, {});
  assert.equal(engine.fluxPerkOffer, null);
  assert.equal(engine.isAwaitingPerk(), false);
});

test('Arsenal then a reload gives the same inventory and the same random state', () => {
  const storage = createStorage();
  const engine = startRun(PERK_SEED, storage);
  offer(engine, FLUX_PERK_IDS.ARSENAL);
  engine.chooseFluxPerk(FLUX_PERK_IDS.ARSENAL);

  const resumed = createEngine(storage);
  assert.equal(resumed.restoreSavedRun(), true);
  assert.deepEqual(resumed.specialInventory, engine.specialInventory);
  assert.equal(resumed.seededRng.state, engine.seededRng.state);
});

test('A perk bonus reads zero on an engine without a Flux config', () => {
  const engine = createEngine();
  engine.fluxConfig = undefined;
  assert.equal(engine.getFluxPerkBonus(FLUX_PERK_IDS.BLAST), 0);
});
