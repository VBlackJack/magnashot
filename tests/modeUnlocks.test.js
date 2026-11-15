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
import { GAME_MODES } from '../src/core/Constants.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { resolveModeAccess, computeNewlyEarned } from '../src/core/ModeUnlocks.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { captureRunSnapshot, applyRunSnapshot } from '../src/game/RunSnapshot.js';
import { getUtcIsoWeekKey, getWeeklyFluxSeed } from '../src/game/WeeklyFlux.js';

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

const cfg = gameConfig.modeUnlocks;
const { prefix, keys } = gameConfig.storage;
const UNLOCKS_KEY = `${prefix}${keys.modeUnlocks}`;
const STATE_NEW = cfg.stateNew;
const STATE_SEEN = cfg.stateSeen;
const THRESHOLDS = cfg.campaignLevelCleared;
const ALWAYS = cfg.always;

const createFakeStorage = () => {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); },
    clear() { data.clear(); }
  };
};

const withManager = (seed, fn) => {
  const storage = createFakeStorage();
  seed?.(storage);
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    const manager = new StorageManager();
    manager.init();
    return fn(manager, storage);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  }
};

const CLASSIC_MODE = 'classic';

test('config lists only real game modes', () => {
  const realModes = new Set(Object.values(GAME_MODES));
  for (const mode of cfg.order) {
    assert.ok(realModes.has(mode), mode);
  }
  assert.equal(new Set(cfg.order).size, cfg.order.length);
  for (const mode of Object.keys(THRESHOLDS)) {
    assert.ok(cfg.order.includes(mode), mode);
  }
  for (const mode of ALWAYS) {
    assert.ok(cfg.order.includes(mode), mode);
  }
});

test('every gated mode follows its threshold exactly', () => {
  for (const [mode, level] of Object.entries(THRESHOLDS)) {
    assert.equal(resolveModeAccess({}, level - 1, cfg)[mode].unlocked, false, `${mode} below`);
    assert.equal(resolveModeAccess({}, level, cfg)[mode].unlocked, true, `${mode} at`);
    assert.equal(resolveModeAccess({}, level - 1, cfg)[mode].requiredLevel, level);
  }
  assert.deepEqual(THRESHOLDS, {
    [GAME_MODES.ENDLESS]: 3,
    [CLASSIC_MODE]: 4,
    [GAME_MODES.PUZZLE]: 5,
    [GAME_MODES.VERSUS]: 6,
    [GAME_MODES.BLITZ]: 7,
    [GAME_MODES.FLUX]: 8,
    [GAME_MODES.CASCADE]: 8,
    [GAME_MODES.BOSS_RUSH]: 9,
    [GAME_MODES.HEX_GRID]: 9,
    [GAME_MODES.PINBALL]: 10,
    [GAME_MODES.ORBITAL]: 10,
    [GAME_MODES.CONVOY]: 11,
    [GAME_MODES.MERGE]: 11,
    [GAME_MODES.SLINGSHOT]: 12
  });
});

test('Campaign and Daily are always available', () => {
  const access = resolveModeAccess({}, 0, cfg);
  for (const mode of ALWAYS) {
    assert.deepEqual(access[mode], { unlocked: true, isNew: false, requiredLevel: 0 });
  }
});

test('a stored entry unlocks for good and "new" is flagged until seen', () => {
  const stored = { [GAME_MODES.FLUX]: STATE_NEW, [GAME_MODES.BLITZ]: STATE_SEEN };
  const access = resolveModeAccess(stored, 0, cfg);
  assert.equal(access[GAME_MODES.FLUX].unlocked, true);
  assert.equal(access[GAME_MODES.FLUX].isNew, true);
  assert.equal(access[GAME_MODES.BLITZ].unlocked, true);
  assert.equal(access[GAME_MODES.BLITZ].isNew, false);
  assert.equal(access[GAME_MODES.ENDLESS].unlocked, false);
});

test('newly earned modes are listed in configured order and exclude stored ones', () => {
  assert.deepEqual(computeNewlyEarned({}, 0, cfg), []);
  assert.deepEqual(computeNewlyEarned({}, 5, cfg), [GAME_MODES.ENDLESS, CLASSIC_MODE, GAME_MODES.PUZZLE]);
  assert.deepEqual(computeNewlyEarned({ [GAME_MODES.ENDLESS]: STATE_SEEN }, 5, cfg), [CLASSIC_MODE, GAME_MODES.PUZZLE]);
  assert.deepEqual(computeNewlyEarned({ [GAME_MODES.ENDLESS]: STATE_SEEN, [CLASSIC_MODE]: STATE_NEW }, 5, cfg), [GAME_MODES.PUZZLE]);
  assert.deepEqual(computeNewlyEarned({}, 99, cfg), cfg.order.filter((mode) => !ALWAYS.includes(mode)));
});

test('storage: a fresh profile has only Campaign and Daily', () => {
  withManager(null, (manager) => {
    const access = manager.getModeAccess();
    for (const mode of cfg.order) {
      assert.equal(access[mode].unlocked, ALWAYS.includes(mode), mode);
    }
  });
});

test('storage: campaign progress unlocks live even without a stored entry', () => {
  withManager((storage) => storage.setItem(`${prefix}${keys.unlockedLevel}`, '4'), (manager, storage) => {
    // The grandfather step stored every mode; drop it to mimic a migration that could not write.
    storage.removeItem(UNLOCKS_KEY);
    manager.memoryFallback.delete(UNLOCKS_KEY);
    assert.equal(manager.getClearedCampaignLevel(), 3);
    assert.equal(manager.getModeAccess()[GAME_MODES.ENDLESS].unlocked, true);
    assert.equal(manager.getModeAccess()[GAME_MODES.BLITZ].unlocked, false);
  });
});

test('storage: syncEarnedModeUnlocks returns new modes once and stores them as new', () => {
  withManager(null, (manager, storage) => {
    manager.saveLevelResult(3, 1000, 1);
    manager.unlockLevel(4);
    assert.deepEqual(manager.syncEarnedModeUnlocks(), [GAME_MODES.ENDLESS]);
    assert.deepEqual(manager.syncEarnedModeUnlocks(), []);
    assert.equal(JSON.parse(storage.getItem(UNLOCKS_KEY))[GAME_MODES.ENDLESS], STATE_NEW);
    assert.equal(manager.getModeAccess()[GAME_MODES.ENDLESS].isNew, true);
  });
});

test('storage: ensureModeUnlocked marks seen, writes only on change, ignores always-on modes', () => {
  withManager(null, (manager, storage) => {
    manager.ensureModeUnlocked(GAME_MODES.CAMPAIGN);
    manager.ensureModeUnlocked('unknown');
    assert.equal(storage.getItem(UNLOCKS_KEY), null);
    manager.ensureModeUnlocked(GAME_MODES.FLUX);
    assert.equal(manager.getModeAccess()[GAME_MODES.FLUX].unlocked, true);
    assert.equal(manager.getModeAccess()[GAME_MODES.FLUX].isNew, false);
    const written = storage.getItem(UNLOCKS_KEY);
    manager.ensureModeUnlocked(GAME_MODES.FLUX);
    assert.equal(storage.getItem(UNLOCKS_KEY), written);
  });
});

test('storage: playing a "new" mode clears its badge', () => {
  withManager((storage) => storage.setItem(UNLOCKS_KEY, JSON.stringify({ [GAME_MODES.BLITZ]: STATE_NEW })), (manager) => {
    assert.equal(manager.getModeAccess()[GAME_MODES.BLITZ].isNew, true);
    manager.ensureModeUnlocked(GAME_MODES.BLITZ);
    assert.equal(manager.getModeAccess()[GAME_MODES.BLITZ].isNew, false);
  });
});

test('storage: corrupt or foreign unlock values are ignored', () => {
  withManager((storage) => storage.setItem(UNLOCKS_KEY, '{"flux":"hacked","blitz":"seen","__proto__":"seen"}'), (manager) => {
    const stored = manager.getModeUnlocks();
    assert.deepEqual(stored[GAME_MODES.FLUX], undefined);
    assert.equal(stored[GAME_MODES.BLITZ], STATE_SEEN);
  });
  withManager((storage) => storage.setItem(UNLOCKS_KEY, 'not json'), (manager) => {
    assert.deepEqual(manager.getModeUnlocks(), {});
  });
});

test('storage: a mode with a record of its own is open without a stored unlock', () => {
  assert.deepEqual(Object.keys(cfg.recordKeys).sort(), Object.keys(THRESHOLDS).sort());
  for (const [mode, keyNames] of Object.entries(cfg.recordKeys)) {
    for (const keyName of keyNames) {
      assert.equal(typeof keys[keyName], 'string', `${mode}: ${keyName} is a real storage key`);
    }
  }
  withManager(null, (manager, storage) => {
    assert.equal(manager.getModeAccess()[GAME_MODES.BLITZ].unlocked, false);
    assert.equal(manager.getModeAccess()[GAME_MODES.BOSS_RUSH].unlocked, false);
    storage.setItem(`${prefix}${keys.blitzHighScore}`, '1200');
    storage.setItem(`${prefix}${keys.bossRushBestWave}`, '3');
    manager.memoryFallback.clear();
    const access = manager.getModeAccess();
    assert.equal(access[GAME_MODES.BLITZ].unlocked, true);
    assert.equal(access[GAME_MODES.BOSS_RUSH].unlocked, true);
    assert.equal(access[GAME_MODES.ENDLESS].unlocked, false, 'a mode without a record stays locked');
    storage.setItem(`${prefix}${keys.endlessHighScore}`, '0');
    manager.memoryFallback.clear();
    assert.equal(manager.getModeAccess()[GAME_MODES.ENDLESS].unlocked, false, 'a zero record unlocks nothing');
  });
});

test('classic: unlocks at campaign level 4, right after Survival, and is announced as introduced', () => {
  assert.equal(cfg.order.indexOf(CLASSIC_MODE), cfg.order.indexOf(GAME_MODES.ENDLESS) + 1);
  assert.equal(cfg.campaignLevelCleared[CLASSIC_MODE], 4);
  assert.deepEqual(cfg.introduced, {
    [CLASSIC_MODE]: 4,
    [GAME_MODES.VERSUS]: 6,
    [GAME_MODES.HEX_GRID]: 9,
    [GAME_MODES.PINBALL]: 10,
    [GAME_MODES.ORBITAL]: 10,
    [GAME_MODES.CONVOY]: 11,
    [GAME_MODES.MERGE]: 11,
    [GAME_MODES.SLINGSHOT]: 12
  });
  assert.deepEqual(cfg.recordKeys[CLASSIC_MODE], ['classicHighScore', 'classicBestStage']);
  assert.equal(resolveModeAccess({}, 3, cfg)[CLASSIC_MODE].unlocked, false);
  assert.equal(resolveModeAccess({}, 4, cfg)[CLASSIC_MODE].unlocked, true);
});

test('arcade behavior modes: records only ever rise and a record opens each mode', () => {
  withManager(null, (manager) => {
    manager.setHexGridRecord(1200, 4);
    manager.setPinballRecord(1500, 3);
    manager.setOrbitalRecord(1800, 5);
    manager.setConvoyRecord(2100, 6);
    manager.setMergeRecord(2400, 7);
    manager.setSlingshotRecord(2700, 4);
    assert.equal(manager.getHexGridBestWave(), 4);
    assert.equal(manager.getPinballBestStage(), 3);
    assert.equal(manager.getOrbitalBestWave(), 5);
    assert.equal(manager.getConvoyBestWave(), 6);
    assert.equal(manager.getMergeBestTier(), 7);
    assert.equal(manager.getSlingshotBestStage(), 4);
    const access = manager.getModeAccess();
    assert.equal(access[GAME_MODES.HEX_GRID].unlocked, true);
    assert.equal(access[GAME_MODES.PINBALL].unlocked, true);
    assert.equal(access[GAME_MODES.ORBITAL].unlocked, true);
    assert.equal(access[GAME_MODES.CONVOY].unlocked, true);
    assert.equal(access[GAME_MODES.MERGE].unlocked, true);
    assert.equal(access[GAME_MODES.SLINGSHOT].unlocked, true);
  });
});

test('classic: records only ever rise and a record opens the mode', () => {
  withManager(null, (manager) => {
    assert.equal(manager.getClassicHighScore(), 0);
    assert.equal(manager.getClassicBestStage(), 0);
    manager.setClassicRecord(900, 3);
    manager.setClassicRecord(400, 5);
    manager.setClassicRecord(-5, 'x');
    assert.equal(manager.getClassicHighScore(), 900);
    assert.equal(manager.getClassicBestStage(), 5);
    assert.equal(manager.getModeAccess()[CLASSIC_MODE].unlocked, true);
  });
});

test('versus: unlocks at campaign level 6, right after Purist, and is announced as introduced', () => {
  assert.equal(GAME_MODES.VERSUS, 'versus');
  assert.equal(cfg.order.indexOf(GAME_MODES.VERSUS), cfg.order.indexOf(CLASSIC_MODE) + 1);
  assert.equal(cfg.campaignLevelCleared[GAME_MODES.VERSUS], 6);
  assert.equal(cfg.introduced[GAME_MODES.VERSUS], 6);
  assert.deepEqual(cfg.recordKeys[GAME_MODES.VERSUS], ['versusRecords']);
  assert.ok(cfg.grandfather.progressKeys.includes('versusRecords'));
  assert.equal(resolveModeAccess({}, 5, cfg)[GAME_MODES.VERSUS].unlocked, false);
  assert.equal(resolveModeAccess({}, 6, cfg)[GAME_MODES.VERSUS].unlocked, true);
});

test('versus: a stored match result opens the mode', () => {
  withManager(null, (manager) => {
    assert.equal(manager.getModeAccess()[GAME_MODES.VERSUS].unlocked, false);
    manager.recordVersusResult('easy', false);
    assert.equal(manager.getModeAccess()[GAME_MODES.VERSUS].unlocked, true);
  });
});

// Weekly Flux opens at a lower campaign level than Flux: playing or restoring it must leave Flux untouched.
const WEEKLY_UNLOCK_LEVEL = gameConfig.weeklyFlux.unlockAfterCampaignLevel;
const SHARED_SEED = 'abc123';

const withFluxEngine = (fn) => withManager(
  (storage) => storage.setItem(`${prefix}${keys.unlockedLevel}`, String(WEEKLY_UNLOCK_LEVEL + 1)),
  (manager, storage) => {
    storage.removeItem(UNLOCKS_KEY);
    manager.memoryFallback.delete(UNLOCKS_KEY);
    const audioManager = { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} };
    const engine = new GameEngine({
      gameConfig, physicsConfig, ballsConfig, obstaclesConfig, levelsConfig, campaignConfig,
      campaignTuning, fluxConfig, audioManager, storageManager: manager, onStateChange: () => {}
    });
    return fn(engine, manager);
  }
);

const fluxAccess = (manager) => manager.getModeAccess()[GAME_MODES.FLUX];

test('engine: a Weekly Flux run before Flux unlocks does not mark Flux as seen', () => {
  withFluxEngine((engine, manager) => {
    assert.equal(manager.getClearedCampaignLevel(), WEEKLY_UNLOCK_LEVEL);
    assert.equal(fluxAccess(manager).unlocked, false);
    engine.startWeeklyFlux();
    assert.equal(engine.isWeeklyFluxRun, true);
    assert.equal(fluxAccess(manager).unlocked, false);
    assert.equal(manager.getModeUnlocks()[GAME_MODES.FLUX], undefined);
    // Leaving Weekly Flux before firing must not record stage 1 as a Flux unlock either.
    engine.startCampaignLevel(1);
    assert.equal(fluxAccess(manager).unlocked, false);
    assert.equal(manager.getModeUnlocks()[GAME_MODES.FLUX], undefined);
  });
});

test('engine: restoring a Weekly Flux snapshot across weeks leaves Flux untouched', () => {
  withFluxEngine((engine, manager) => {
    engine.startWeeklyFlux();
    const snapshot = JSON.parse(JSON.stringify(captureRunSnapshot(engine, manager.getRunSnapshotVersion())));
    snapshot.weeklyWeekKey = '2025-W01';
    assert.ok(applyRunSnapshot(engine, snapshot));
    assert.equal(engine.isWeeklyFluxRun, true);
    assert.equal(engine.weeklyWeekKey, '2025-W01');
    assert.equal(fluxAccess(manager).unlocked, false);
    assert.equal(manager.getModeUnlocks()[GAME_MODES.FLUX], undefined);
  });
});

test('engine: a normal or shared Flux run still marks Flux as seen', () => {
  withFluxEngine((engine, manager) => {
    engine.startFluxRun();
    assert.equal(fluxAccess(manager).unlocked, true);
  });
  withFluxEngine((engine, manager) => {
    engine.startFluxRun(SHARED_SEED, { isShared: true });
    assert.equal(engine.isWeeklyFluxRun, false);
    assert.equal(fluxAccess(manager).unlocked, true);
  });
  withFluxEngine((engine, manager) => {
    const weekKey = getUtcIsoWeekKey(Date.now());
    const otherSeed = getWeeklyFluxSeed(weekKey, fluxConfig.seed, `${gameConfig.weeklyFlux.seedSalt}-other`);
    engine.startFluxRun(otherSeed, { isShared: true });
    assert.equal(fluxAccess(manager).unlocked, true);
  });
});
