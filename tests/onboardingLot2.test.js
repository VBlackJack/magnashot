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
import { BOARD_MECHANICS, OBSTACLE_TYPES, SPECIAL_TYPES } from '../src/core/Constants.js';
import { POLARITY_MECHANIC_ID, toSpecialMechanicId } from '../src/game/Discovery.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { i18n, t } from '../src/core/I18n.js';
import { buildLevelIntroText } from '../src/ui/UIManager.js';

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

const onboarding = gameConfig.onboarding;
const levels = levelsConfig.levels;

const FIRST_LEVEL = 1;
const SECOND_LEVEL = 2;
const THIRD_LEVEL = 3;
const POLARITY_LEVEL = 5;
const VETERAN_PAST_POLARITY_LEVEL = 6;
const LEGACY_VERSION_LEVEL = 3;
const FAR_AWAY = -10000;
const PROJECTILE_RADIUS = 10;
const SURVIVAL_SCORE = 500;
const RESULT_SCORE = 100;
const RESULT_STARS = 1;
const MAX_NEW_SPECIALS_PER_EARLY_LEVEL = 1;

const createTestStorage = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  return storageManager;
};

const createTestEngine = (storageManager = createTestStorage()) =>
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
    onStateChange: () => {}
  });

/** Plays one turn without physics: the engine's own end-of-turn path runs. */
const playTurn = (engine, madeMatch = true) => {
  engine.hasFiredInRound = true;
  engine.handlePostTurnCleanup(madeMatch);
};

/** Marks every mechanic of the discovery order as learned except the given ones. */
const learnAllExcept = (storage, ...kept) => {
  storage.markDiscovered(onboarding.order.filter((id) => !kept.includes(id)));
};

test('Levels 1 to 3 add at most one special ball type each, and level 3 keeps four colors', () => {
  const early = levels.slice(0, THIRD_LEVEL);
  const stocked = (level) => Object.keys(level.specialInventory).filter((type) => level.specialInventory[type] > 0);
  const met = new Set();
  for (const level of early) {
    const types = stocked(level);
    const fresh = types.filter((type) => !met.has(type));
    assert.ok(fresh.length <= MAX_NEW_SPECIALS_PER_EARLY_LEVEL, `level ${level.id} adds ${fresh.join(', ')}`);
    types.forEach((type) => met.add(type));
  }
  assert.deepEqual(stocked(levels[FIRST_LEVEL - 1]), []);
  assert.deepEqual(stocked(levels[SECOND_LEVEL - 1]), [SPECIAL_TYPES.BOMB], 'level 2 grants only a bomb');
  assert.equal(levels[THIRD_LEVEL - 1].paletteCount, levels[SECOND_LEVEL - 1].paletteCount, 'level 3 keeps 4 colors');
  assert.equal(levels[THIRD_LEVEL - 1].paletteCount, 4);
  for (const level of early) {
    const [none, two, three] = level.starThresholds;
    assert.equal(none, 0);
    assert.ok(two > 0 && three > two, `level ${level.id} star thresholds rise`);
  }
});

test('Level 3 carries the bank-shot tip, a technique tip rather than a mechanic', () => {
  const third = levels[THIRD_LEVEL - 1];
  assert.equal(third.tutorialKey, 'gameplay.tutorial.bankShot');
  assert.ok(onboarding.techniqueTips.includes(third.tutorialKey));
  assert.ok(!Object.values(onboarding.mechanics).some((entry) => entry.hintKey === third.tutorialKey));
});

test('Polarity and every special ball have a discovery entry with its pulse target', () => {
  assert.equal(onboarding.mechanics[POLARITY_MECHANIC_ID].hintKey, 'gameplay.tutorial.polarity');
  assert.equal(onboarding.mechanics[POLARITY_MECHANIC_ID].pulseTarget, 'polarity');
  for (const type of Object.values(SPECIAL_TYPES)) {
    const entry = onboarding.mechanics[toSpecialMechanicId(type)];
    assert.equal(entry.hintKey, `gameplay.tutorial.specials.${type}`);
    assert.equal(entry.pulseTarget, `special:${type}`);
    assert.ok(onboarding.order.includes(toSpecialMechanicId(type)));
  }
});

test('The polarity lesson sits on the first level with a full mix of colors and carries no level tutorial', () => {
  // Level 5 is the first level after the ramp with all five colors, so both polarities are
  // on the board; levels 3 and 4 already carry the bank-shot tip and the repulsor lesson.
  const polarityLevels = levels.filter((level) => level.teachesMechanics?.includes(POLARITY_MECHANIC_ID));
  assert.deepEqual(polarityLevels.map((level) => level.id), [POLARITY_LEVEL]);
  assert.ok(!polarityLevels[0].tutorialKey);
});

test('A new player is taught polarity on its level, and pressing the button counts as learning it', () => {
  const storage = createTestStorage();
  learnAllExcept(storage, POLARITY_MECHANIC_ID);
  const engine = createTestEngine(storage);
  engine.startCampaignLevel(POLARITY_LEVEL);
  assert.equal(engine.activeDiscoveryId, POLARITY_MECHANIC_ID);
  assert.equal(engine.getDiscoveryPulseTarget(), 'polarity');
  assert.equal(storage.getDiscoveries()[POLARITY_MECHANIC_ID], undefined, 'shown, not learned');

  engine.togglePolarityFlip();
  assert.equal(storage.getDiscoveries()[POLARITY_MECHANIC_ID], true);
  assert.equal(engine.getDiscoveryPulseTarget(), null, 'the pulse stops once the button was used');
  playTurn(engine);
  assert.equal(engine.activeDiscoveryId, null, 'the lesson gives way after the turn');
});

test('A player who learned levels 1 to 4 is taught polarity first on level 5, and its intro features it', () => {
  const storage = createTestStorage();
  storage.unlockLevel(POLARITY_LEVEL);
  const engine = createTestEngine(storage);
  assert.equal(storage.getDiscoveries()[POLARITY_MECHANIC_ID], undefined, 'polarity is not behind them');
  engine.startCampaignLevel(POLARITY_LEVEL);
  assert.equal(engine.activeDiscoveryId, POLARITY_MECHANIC_ID, 'polarity comes before any other lesson');
  assert.equal(engine.levelIntro, null, 'the hint is the only banner');
  const intro = engine.buildLevelIntro(engine.levelCatalog.get(POLARITY_LEVEL));
  assert.equal(intro.featuredMechanicId, POLARITY_MECHANIC_ID);
});

test('The intro of a generated level reads with the real translator, without a name key', () => {
  i18n.dictionaries.set('en', loadJson('./locales/en.json'));
  i18n.currentLocale = 'en';
  const storage = createTestStorage();
  storage.markDiscovered(onboarding.order);
  const engine = createTestEngine(storage);
  const generatedId = levels[levels.length - 1].id + 1;
  assert.ok(engine.levelCatalog.isGenerated(generatedId));
  engine.startCampaignLevel(generatedId);
  assert.ok(engine.levelIntro, 'a first play with nothing to learn');
  const text = buildLevelIntroText(engine.levelIntro, t);
  assert.ok(text.startsWith(`Level ${generatedId}: `));
  assert.doesNotMatch(text, /undefined|levels\.generated/);
});

test('Polarity is not taught on the levels before its own', () => {
  const storage = createTestStorage();
  learnAllExcept(storage, POLARITY_MECHANIC_ID);
  const engine = createTestEngine(storage);
  for (const level of levels.filter((lvl) => lvl.id < POLARITY_LEVEL)) {
    engine.startCampaignLevel(level.id);
    assert.notEqual(engine.activeDiscoveryId, POLARITY_MECHANIC_ID, `level ${level.id}`);
  }
});

test('A special ball is explained the first time it is in stock, and firing it counts as learning it', () => {
  const storage = createTestStorage();
  storage.markDiscovered([BOARD_MECHANICS.BASICS, OBSTACLE_TYPES.PIVOT]);
  const engine = createTestEngine(storage);
  engine.startCampaignLevel(SECOND_LEVEL);
  const bombId = toSpecialMechanicId(SPECIAL_TYPES.BOMB);
  assert.equal(engine.activeDiscoveryId, bombId);
  assert.equal(engine.getDiscoveryPulseTarget(), bombId);
  engine.equipSpecialBall(SPECIAL_TYPES.BOMB);
  assert.equal(storage.getDiscoveries()[bombId], undefined, 'loading it is not using it');
  engine.shoot();
  assert.equal(storage.getDiscoveries()[bombId], true);
  assert.equal(engine.getDiscoveryPulseTarget(), null);
});

test('A level hands its lessons out in order, one per turn, with its special ball after the rotor', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(SECOND_LEVEL);
  const bombId = toSpecialMechanicId(SPECIAL_TYPES.BOMB);
  assert.equal(engine.activeDiscoveryId, BOARD_MECHANICS.BASICS);
  engine.dismissDiscovery();
  playTurn(engine);
  assert.equal(engine.activeDiscoveryId, OBSTACLE_TYPES.PIVOT);
  engine.dismissDiscovery();
  engine.refreshDiscovery();
  assert.equal(engine.activeDiscoveryId, null, 'no second hint within the same turn');
  playTurn(engine);
  assert.equal(engine.activeDiscoveryId, bombId);
});

test('A shot that flies past the obstacle being explained counts as meeting it', () => {
  const storage = createTestStorage();
  storage.markDiscovered([BOARD_MECHANICS.BASICS]);
  const engine = createTestEngine(storage);
  engine.startCampaignLevel(THIRD_LEVEL);
  assert.equal(engine.activeDiscoveryId, OBSTACLE_TYPES.BUMPER);
  const bumper = engine.physicsWorld.obstacles.find((obstacle) => obstacle.type === OBSTACLE_TYPES.BUMPER);

  engine.trackDiscoveryProximity({ x: FAR_AWAY, y: FAR_AWAY, radius: PROJECTILE_RADIUS });
  assert.equal(storage.getDiscoveries()[OBSTACLE_TYPES.BUMPER], undefined, 'a shot far away teaches nothing');

  engine.trackDiscoveryProximity({ x: bumper.x, y: bumper.y, radius: PROJECTILE_RADIUS });
  assert.equal(storage.getDiscoveries()[OBSTACLE_TYPES.BUMPER], true);
  playTurn(engine);
  assert.notEqual(engine.activeDiscoveryId, OBSTACLE_TYPES.BUMPER, 'the learned hint gives way at turn end');
});

test('The basics hint is learned by a shot that clears something, not by a miss', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(FIRST_LEVEL);
  playTurn(engine, false);
  assert.equal(engine.storageManager.getDiscoveries()[BOARD_MECHANICS.BASICS], undefined);
  playTurn(engine, true);
  assert.equal(engine.storageManager.getDiscoveries()[BOARD_MECHANICS.BASICS], true);
});

test('Replaying the level hints walks the board one hint at a time and learns nothing', () => {
  const storage = createTestStorage();
  storage.markDiscovered(onboarding.order);
  const engine = createTestEngine(storage);
  assert.equal(engine.hasLevelHints(), false, 'no run, no hints');
  engine.startCampaignLevel(THIRD_LEVEL);
  assert.equal(engine.activeDiscoveryId, null);
  assert.equal(engine.hasLevelHints(), true);
  const before = { ...storage.getDiscoveries() };

  assert.equal(engine.replayLevelHints(), true);
  const shown = [];
  while (engine.activeDiscoveryId) {
    shown.push(engine.activeDiscoveryId);
    engine.dismissDiscovery();
  }
  assert.ok(shown.length >= 2, 'the basics, the bumpers and the specials of level 3');
  assert.equal(shown[0], BOARD_MECHANICS.BASICS);
  assert.ok(shown.includes(OBSTACLE_TYPES.BUMPER));
  assert.equal(new Set(shown).size, shown.length);
  assert.equal(engine.isReplayingHints, false);
  assert.deepEqual(storage.getDiscoveries(), before, 'a replay changes no learned state');
});

test('A replayed hint gives way to the next after the turn allowance, still without learning', () => {
  const storage = createTestStorage();
  storage.markDiscovered(onboarding.order);
  const engine = createTestEngine(storage);
  engine.startCampaignLevel(THIRD_LEVEL);
  engine.replayLevelHints();
  const first = engine.activeDiscoveryId;
  for (let i = 0; i < onboarding.hintShotLimit; i++) {
    playTurn(engine);
  }
  assert.notEqual(engine.activeDiscoveryId, first);
  assert.equal(engine.isReplayingHints, true);
});

test('A first play of a campaign level carries an intro that the first shot closes', () => {
  const storage = createTestStorage();
  storage.markDiscovered(onboarding.order);
  const engine = createTestEngine(storage);
  engine.startCampaignLevel(FIRST_LEVEL);
  assert.equal(engine.activeDiscoveryId, null, 'no hint is up');
  assert.deepEqual(engine.levelIntro, {
    levelId: FIRST_LEVEL,
    summary: engine.levelCatalog.summarize(FIRST_LEVEL),
    maxShots: engine.shotsRemaining,
    featuredMechanicId: BOARD_MECHANICS.BASICS
  });
  engine.shoot();
  assert.equal(engine.levelIntro, null);

  engine.startCampaignLevel(THIRD_LEVEL);
  assert.ok(engine.levelIntro);
  engine.dismissLevelIntro();
  assert.equal(engine.levelIntro, null);
});

test('The replay button is offered only where the board has a hint beyond the basics', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(FIRST_LEVEL);
  assert.equal(engine.hasLevelHints(), false, 'level 1 only has the basics');
  engine.startCampaignLevel(THIRD_LEVEL);
  assert.equal(engine.hasLevelHints(), true);
});

test('The level intro gives way to a hint that is up when the level starts', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(FIRST_LEVEL);
  assert.equal(engine.activeDiscoveryId, BOARD_MECHANICS.BASICS);
  assert.equal(engine.levelIntro, null, 'one banner at a time');
});

test('The level intro features the level tutorial mechanic once the player has learned everything', () => {
  const storage = createTestStorage();
  storage.markDiscovered(onboarding.order);
  const engine = createTestEngine(storage);
  engine.startCampaignLevel(SECOND_LEVEL);
  assert.equal(engine.levelIntro.featuredMechanicId, OBSTACLE_TYPES.PIVOT, 'the level tutorial mechanic');
  engine.startCampaignLevel(SECOND_LEVEL);
  assert.equal(engine.levelIntro, null, 'seen once in this session already');
});

test('The level intro never shows on a replay, in another mode or on a restored run', () => {
  const storage = createTestStorage();
  storage.saveLevelResult(FIRST_LEVEL, RESULT_SCORE, RESULT_STARS);
  const engine = createTestEngine(storage);
  engine.startCampaignLevel(FIRST_LEVEL);
  assert.equal(engine.levelIntro, null, 'a level with a stored result');

  storage.markDiscovered(onboarding.order);
  engine.startCampaignLevel(SECOND_LEVEL);
  assert.ok(engine.levelIntro);
  engine.startCampaignLevel(SECOND_LEVEL);
  assert.equal(engine.levelIntro, null, 'a retry in the same session');

  engine.startEndlessMode();
  assert.equal(engine.levelIntro, null);

  engine.startCampaignLevel(THIRD_LEVEL);
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot({ force: true });
  const resumed = createTestEngine(storage);
  assert.equal(resumed.restoreSavedRun(), true);
  assert.equal(resumed.levelIntro, null);
});

test('A veteran with existing keys gets the new mechanics they already passed, and nothing else', () => {
  const storage = createTestStorage();
  storage.unlockLevel(VETERAN_PAST_POLARITY_LEVEL);
  storage.markDiscovered([BOARD_MECHANICS.BASICS, OBSTACLE_TYPES.PIVOT]);
  assert.equal(storage.getDiscoveriesVersion(), 0, 'the keys predate versioning');

  createTestEngine(storage);
  const seen = storage.getDiscoveries();
  assert.equal(seen[POLARITY_MECHANIC_ID], true, 'the polarity level is behind them');
  assert.equal(seen[toSpecialMechanicId(SPECIAL_TYPES.BOMB)], true);
  assert.equal(seen[toSpecialMechanicId(SPECIAL_TYPES.LIGHTNING)], true);
  assert.equal(seen[toSpecialMechanicId(SPECIAL_TYPES.ROCKET)], undefined, 'never handed out by a passed level');
  assert.equal(seen[OBSTACLE_TYPES.PORTAL], undefined, 'a mechanic of a later level stays new');
  assert.equal(storage.getDiscoveriesVersion(), onboarding.discoveriesVersion);

  const engine = createTestEngine(storage);
  engine.startCampaignLevel(POLARITY_LEVEL);
  assert.notEqual(engine.activeDiscoveryId, POLARITY_MECHANIC_ID, 'no beginner hint for a veteran');
});

test('A veteran who stopped before the polarity level still gets that lesson', () => {
  const storage = createTestStorage();
  storage.unlockLevel(LEGACY_VERSION_LEVEL);
  storage.markDiscovered([BOARD_MECHANICS.BASICS]);
  createTestEngine(storage);
  const seen = storage.getDiscoveries();
  assert.equal(seen[toSpecialMechanicId(SPECIAL_TYPES.BOMB)], true, 'level 2 handed out a bomb');
  assert.equal(seen[toSpecialMechanicId(SPECIAL_TYPES.LIGHTNING)], undefined, 'level 3 is not passed');
  assert.equal(seen[POLARITY_MECHANIC_ID], undefined);
});

test('A veteran of the survival modes already knows every special ball', () => {
  const storage = createTestStorage();
  storage.setEndlessHighScore(SURVIVAL_SCORE);
  storage.markDiscovered([BOARD_MECHANICS.BASICS]);
  createTestEngine(storage);
  const seen = storage.getDiscoveries();
  for (const type of Object.values(SPECIAL_TYPES)) {
    assert.equal(seen[toSpecialMechanicId(type)], true, type);
  }
  assert.equal(seen[POLARITY_MECHANIC_ID], undefined);
});

test('The seeding runs once per version: a new player is stamped, and a reset is not re-credited', () => {
  const storage = createTestStorage();
  const engine = createTestEngine(storage);
  assert.equal(storage.getDiscoveriesVersion(), onboarding.discoveriesVersion);
  assert.deepEqual(storage.getDiscoveries(), {});

  storage.unlockLevel(VETERAN_PAST_POLARITY_LEVEL);
  engine.resetDiscoveries();
  assert.equal(storage.getDiscoveriesVersion(), onboarding.discoveriesVersion);
  createTestEngine(storage);
  assert.equal(storage.getDiscoveries()[POLARITY_MECHANIC_ID], undefined, 'the reset stays a reset');
});

test('A saved run keeps the hints already shown, and a run saved without them restores', () => {
  const storage = createTestStorage();
  const engine = createTestEngine(storage);
  engine.startCampaignLevel(SECOND_LEVEL);
  for (let i = 0; i < onboarding.hintShotLimit; i++) {
    playTurn(engine, false);
  }
  assert.ok(engine.discoveryShownIds.has(BOARD_MECHANICS.BASICS));
  engine.saveRunSnapshot({ force: true });

  const resumed = createTestEngine(storage);
  assert.equal(resumed.restoreSavedRun(), true);
  assert.ok(resumed.discoveryShownIds.has(BOARD_MECHANICS.BASICS), 'it does not come back after a reload');

  const snapshot = storage.loadRunSnapshot();
  delete snapshot.discoveryShownIds;
  storage.saveRunSnapshot(snapshot);
  const legacy = createTestEngine(storage);
  assert.equal(legacy.restoreSavedRun(), true);
  assert.equal(legacy.discoveryShownIds.size, 0);
});
