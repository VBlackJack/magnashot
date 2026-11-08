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
import { getUtcIsoWeekKey, getWeeklyFluxSeed } from '../src/game/WeeklyFlux.js';
import { GAME_MODES, GAME_STATES, GAME_OVER_REASONS } from '../src/core/Constants.js';
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

const DAILY_SEED = '2026-11-02';
const SHOTS_FIRED = 4;
const TOP_UP_COINS = 10_000;
const FIRST_LEVEL = 1;
const SECOND_LEVEL = 2;
const UNLOCK_LEVEL = 3;
const WEEKLY_BONUS = gameConfig.weeklyFlux.firstPlayBonusCoins;
const STATS_CFG = gameConfig.playerStats;

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

/** Runs fn with a fresh storage and engine, restoring the global localStorage afterwards. */
const withEngine = (fn) => {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: createFakeStorage(), configurable: true, writable: true });
  try {
    const storageManager = new StorageManager();
    storageManager.init();
    const audioManager = { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} };
    const engine = new GameEngine({
      gameConfig,
      physicsConfig,
      ballsConfig,
      obstaclesConfig,
      levelsConfig,
      campaignConfig,
      campaignTuning,
      fluxConfig,
      audioManager,
      storageManager,
      onStateChange: () => {}
    });
    return fn(engine, storageManager);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  }
};

/** Fires shots one after the other, as if each had settled before the next. */
const fireShots = (engine, count) => {
  for (let i = 0; i < count; i++) {
    engine.physicsWorld.projectile = null;
    // A Flux shape's entrance blocks shots for a moment; the test does not wait for it.
    engine.stageIntroFrames = 0;
    engine.shoot();
  }
  engine.physicsWorld.projectile = null;
};

test('a lost campaign level is counted once, with its level', () => {
  withEngine((engine, storage) => {
    engine.startCampaignLevel(SECOND_LEVEL);
    fireShots(engine, SHOTS_FIRED);
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    const stats = storage.getPlayerStats();
    assert.deepEqual(stats.modes[GAME_MODES.CAMPAIGN], { runs: 1, wins: 0, losses: 1, quits: 0 });
    assert.equal(stats.levels[SECOND_LEVEL].f, 1);
    assert.equal(stats.shots, SHOTS_FIRED);
  });
});

test('a cleared campaign level is a win and reports the modes it unlocked', () => {
  withEngine((engine, storage) => {
    engine.startCampaignLevel(UNLOCK_LEVEL);
    fireShots(engine, 1);
    for (const ball of [...engine.physicsWorld.balls]) {
      engine.physicsWorld.removeBall(ball);
    }
    engine.evaluateRoundEnd();
    assert.equal(engine.state, GAME_STATES.VICTORY);
    assert.deepEqual(storage.getPlayerStats().modes[GAME_MODES.CAMPAIGN], { runs: 1, wins: 1, losses: 0, quits: 0 });
    assert.deepEqual(engine.victorySummary.unlockedModes, [GAME_MODES.ENDLESS]);
    assert.equal(storage.getModeAccess()[GAME_MODES.ENDLESS].isNew, true);
  });
});

test('leaving a run after a shot counts a quit; leaving before any shot does not', () => {
  withEngine((engine, storage) => {
    engine.startCampaignLevel(FIRST_LEVEL);
    engine.startCampaignLevel(SECOND_LEVEL);
    assert.equal(storage.getPlayerStats().modes[GAME_MODES.CAMPAIGN], undefined);
    fireShots(engine, 1);
    engine.startCampaignLevel(FIRST_LEVEL);
    const stats = storage.getPlayerStats();
    assert.deepEqual(stats.modes[GAME_MODES.CAMPAIGN], { runs: 1, wins: 0, losses: 0, quits: 1 });
    assert.equal(stats.levels[SECOND_LEVEL].q, 1);
  });
});

test('a lost run is not counted again as a quit when the next run starts', () => {
  withEngine((engine, storage) => {
    engine.startCampaignLevel(FIRST_LEVEL);
    fireShots(engine, 1);
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    engine.startCampaignLevel(FIRST_LEVEL);
    assert.deepEqual(storage.getPlayerStats().modes[GAME_MODES.CAMPAIGN], { runs: 1, wins: 0, losses: 1, quits: 0 });
  });
});

test('continuing out of shots retracts the loss', () => {
  withEngine((engine, storage) => {
    engine.startCampaignLevel(FIRST_LEVEL);
    fireShots(engine, 1);
    storage.setCoins(TOP_UP_COINS);
    engine.shotsRemaining = 0;
    engine.triggerGameOver(GAME_OVER_REASONS.OUT_OF_SHOTS);
    assert.equal(storage.getPlayerStats().modes[GAME_MODES.CAMPAIGN].losses, 1);
    assert.equal(engine.continueOutOfShots(), true);
    assert.equal(storage.getPlayerStats().modes[GAME_MODES.CAMPAIGN].losses, 0);
    assert.equal(engine.runOutcomeRecorded, false);
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    assert.equal(storage.getPlayerStats().modes[GAME_MODES.CAMPAIGN].losses, 1);
  });
});

test('a restored run is not counted as a quit', () => {
  withEngine((engine, storage) => {
    engine.startCampaignLevel(SECOND_LEVEL);
    fireShots(engine, 1);
    engine.saveRunSnapshot({ force: true });
    engine.flushPlayerStats();
    const before = storage.getPlayerStats();
    assert.equal(engine.restoreSavedRun(), true);
    assert.equal(storage.getPlayerStats().modes[GAME_MODES.CAMPAIGN], before.modes[GAME_MODES.CAMPAIGN]);
    assert.equal(engine.state, GAME_STATES.PAUSED);
  });
});

test('shots and play time are buffered, then flushed at the thresholds', () => {
  withEngine((engine, storage) => {
    engine.startCampaignLevel(FIRST_LEVEL);
    for (let i = 0; i < STATS_CFG.flushEveryShots - 1; i++) {
      engine.countShotForStats();
    }
    assert.equal(storage.getPlayerStats().shots, 0);
    engine.countShotForStats();
    assert.equal(storage.getPlayerStats().shots, STATS_CFG.flushEveryShots);
    engine.countPlayTimeForStats(STATS_CFG.flushEveryPlayMs - 1);
    assert.equal(storage.getPlayerStats().playMs, 0);
    engine.countPlayTimeForStats(1);
    assert.equal(storage.getPlayerStats().playMs, STATS_CFG.flushEveryPlayMs);
    engine.countPlayTimeForStats(5);
    engine.flushPlayerStats();
    assert.equal(storage.getPlayerStats().playMs, STATS_CFG.flushEveryPlayMs + 5);
  });
});

test('update adds one fixed step of play time while playing, none while paused', () => {
  withEngine((engine) => {
    engine.startCampaignLevel(FIRST_LEVEL);
    engine.update();
    assert.equal(engine.pendingPlayMs, physicsConfig.simulation.fixedStepMs);
    engine.togglePause();
    engine.update();
    assert.equal(engine.pendingPlayMs, physicsConfig.simulation.fixedStepMs);
  });
});

test('starting a mode unlocks it for good', () => {
  withEngine((engine, storage) => {
    assert.equal(storage.getModeAccess()[GAME_MODES.FLUX].unlocked, false);
    engine.startFluxRun('abc123', { isShared: true });
    assert.equal(storage.getModeAccess()[GAME_MODES.FLUX].unlocked, true);
  });
});

test('a Daily run of k shots records k samples plus the final one, and keeps them in the history', () => {
  withEngine((engine, storage) => {
    engine.startDailyChallenge(DAILY_SEED, true);
    fireShots(engine, SHOTS_FIRED);
    engine.score = 1234;
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    assert.equal(engine.shotTimeline.n, SHOTS_FIRED + 1);
    assert.equal(engine.shotTimeline.c, 1);
    const [entry] = storage.getDailyHistory();
    assert.equal(entry.d, DAILY_SEED);
    assert.equal(entry.s, 1234);
    assert.equal(entry.tl.n, SHOTS_FIRED + 1);
    assert.equal(entry.tl.s.at(-1), 1234);
  });
});

test('a Daily timeline written mid-run is incomplete and survives a snapshot restore', () => {
  withEngine((engine, storage) => {
    engine.startDailyChallenge(DAILY_SEED, true);
    fireShots(engine, SHOTS_FIRED);
    engine.persistRunHighScore();
    assert.equal(storage.getDailyHistory()[0].tl.c, 0);
    const snapshot = captureRunSnapshot(engine, storage.getRunSnapshotVersion());
    assert.ok(isValidRunSnapshot(snapshot, storage.getRunSnapshotVersion()));
    engine.startEndlessMode();
    assert.equal(engine.shotTimeline, null);
    assert.ok(applyRunSnapshot(engine, JSON.parse(JSON.stringify(snapshot))));
    assert.equal(engine.shotTimeline.n, SHOTS_FIRED);
  });
});

test('an old snapshot without progress fields restores with an empty timeline and no weekly flag', () => {
  withEngine((engine, storage) => {
    engine.startDailyChallenge(DAILY_SEED, true);
    fireShots(engine, 1);
    const snapshot = JSON.parse(JSON.stringify(captureRunSnapshot(engine, storage.getRunSnapshotVersion())));
    delete snapshot.isWeeklyFluxRun;
    delete snapshot.weeklyWeekKey;
    delete snapshot.shotTimeline;
    assert.ok(isValidRunSnapshot(snapshot, storage.getRunSnapshotVersion()));
    assert.ok(applyRunSnapshot(engine, snapshot));
    assert.equal(engine.shotTimeline, null);
    assert.equal(engine.isWeeklyFluxRun, false);
    engine.togglePause();
    fireShots(engine, 1);
    assert.equal(engine.shotTimeline.n, 1);
  });
});

test('Campaign and a normal Flux run record no timeline and no daily history', () => {
  withEngine((engine, storage) => {
    engine.startCampaignLevel(FIRST_LEVEL);
    fireShots(engine, SHOTS_FIRED);
    assert.equal(engine.shotTimeline, null);
    engine.startFluxRun('abc123');
    fireShots(engine, SHOTS_FIRED);
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    assert.equal(engine.shotTimeline, null);
    assert.equal(engine.isWeeklyFluxRun, false);
    assert.deepEqual(storage.getDailyHistory(), []);
    assert.equal(storage.getWeeklyFluxBest(getUtcIsoWeekKey(Date.now())), null);
  });
});

test('startWeeklyFlux runs the seed of the week, pays the bonus once and locks it as a shared run', () => {
  withEngine((engine, storage) => {
    const weekKey = getUtcIsoWeekKey(Date.now());
    const seed = getWeeklyFluxSeed(weekKey, fluxConfig.seed, gameConfig.weeklyFlux.seedSalt);
    const coinsBefore = storage.getCoins();
    engine.startWeeklyFlux();
    assert.equal(engine.mode, GAME_MODES.FLUX);
    assert.equal(engine.fluxSeed, seed);
    assert.equal(engine.isWeeklyFluxRun, true);
    assert.equal(engine.weeklyWeekKey, weekKey);
    assert.equal(engine.isSharedFluxRun, true);
    assert.equal(storage.getCoins(), coinsBefore + WEEKLY_BONUS);
    assert.equal(storage.getModeAccess()[GAME_MODES.FLUX].unlocked, true);
    engine.startWeeklyFlux();
    assert.equal(storage.getCoins(), coinsBefore + WEEKLY_BONUS);
    engine.startWeeklyFlux({ isRestart: true });
    assert.equal(engine.fluxSeed, seed);
    assert.equal(engine.isWeeklyFluxRun, true);
  });
});

test('restartCurrent on a weekly run keeps the seed and does not pay again', () => {
  withEngine((engine, storage) => {
    engine.startWeeklyFlux();
    const seed = engine.fluxSeed;
    const coins = storage.getCoins();
    engine.restartCurrent();
    assert.equal(engine.fluxSeed, seed);
    assert.equal(engine.isWeeklyFluxRun, true);
    assert.equal(storage.getCoins(), coins);
  });
});

test('any start on the weekly seed is the weekly run, without a bonus', () => {
  withEngine((engine, storage) => {
    const weekKey = getUtcIsoWeekKey(Date.now());
    const seed = getWeeklyFluxSeed(weekKey, fluxConfig.seed, gameConfig.weeklyFlux.seedSalt);
    const coins = storage.getCoins();
    engine.startFluxRun(seed);
    assert.equal(engine.isWeeklyFluxRun, true);
    assert.equal(engine.isSharedFluxRun, true);
    assert.equal(storage.getCoins(), coins);
    engine.startFluxRun('abc123');
    assert.equal(engine.isWeeklyFluxRun, false);
    assert.equal(engine.weeklyWeekKey, null);
    assert.equal(engine.isSharedFluxRun, false);
  });
});

test('a weekly run keeps its own best and timeline, and also feeds the normal Flux record', () => {
  withEngine((engine, storage) => {
    const weekKey = getUtcIsoWeekKey(Date.now());
    engine.startWeeklyFlux();
    fireShots(engine, SHOTS_FIRED);
    engine.score = 777;
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    const best = storage.getWeeklyFluxBest(weekKey);
    assert.equal(best.score, 777);
    assert.equal(best.tl.c, 1);
    assert.equal(best.tl.n, SHOTS_FIRED + 1);
    assert.equal(storage.getFluxHighScore(), 777);
    assert.equal(engine.gameOverSummary.isNewRecord, false);
    engine.startWeeklyFlux({ isRestart: true });
    fireShots(engine, 1);
    engine.score = 900;
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    assert.equal(engine.gameOverSummary.isNewRecord, true);
    assert.equal(storage.getWeeklyFluxBest(weekKey).score, 900);
  });
});

test('the weekly flag and week key survive a snapshot restore', () => {
  withEngine((engine, storage) => {
    const weekKey = getUtcIsoWeekKey(Date.now());
    engine.startWeeklyFlux();
    fireShots(engine, SHOTS_FIRED);
    const snapshot = JSON.parse(JSON.stringify(captureRunSnapshot(engine, storage.getRunSnapshotVersion())));
    engine.startEndlessMode();
    assert.equal(engine.isWeeklyFluxRun, false);
    assert.ok(applyRunSnapshot(engine, snapshot));
    assert.equal(engine.isWeeklyFluxRun, true);
    assert.equal(engine.weeklyWeekKey, weekKey);
    assert.equal(engine.shotTimeline.mode, GAME_MODES.FLUX);
    assert.equal(engine.shotTimeline.n, SHOTS_FIRED);
  });
});

test('a damaged weekly key in a snapshot is ignored', () => {
  withEngine((engine, storage) => {
    engine.startWeeklyFlux();
    fireShots(engine, 1);
    const snapshot = JSON.parse(JSON.stringify(captureRunSnapshot(engine, storage.getRunSnapshotVersion())));
    snapshot.weeklyWeekKey = 'not a week';
    assert.ok(applyRunSnapshot(engine, snapshot));
    assert.equal(engine.isWeeklyFluxRun, false);
    assert.equal(engine.weeklyWeekKey, null);
  });
});
