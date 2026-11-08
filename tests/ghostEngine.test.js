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
import { SeededRandom } from '../src/core/SeededRandom.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { captureRunSnapshot, isValidRunSnapshot, applyRunSnapshot } from '../src/game/RunSnapshot.js';
import { ghostFromTimeline } from '../src/game/GhostCodec.js';
import { GAME_MODES, GAME_OVER_REASONS } from '../src/core/Constants.js';
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

const DUEL_CFG = gameConfig.ghostDuel;
const FLUX_SEED = 'abc123';
const PAST_DAYS = 3;
const MS_PER_DAY = 86_400_000;
const GHOST_FINAL = 50;
const GHOST_SHOT_COUNT = 2;
const SHOTS_FIRED = 3;
const TOP_UP_COINS = 10_000;

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

/** Runs fn with a fresh storage and engine; the duel history is a stub (it lives in the storage lot). */
const withEngine = (fn) => {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: createFakeStorage(), configurable: true, writable: true });
  try {
    const storageManager = new StorageManager();
    storageManager.init();
    const duelCalls = { recorded: [], retracted: 0 };
    storageManager.recordGhostDuel = (entry) => duelCalls.recorded.push(entry);
    storageManager.retractLastGhostDuel = () => { duelCalls.retracted += 1; };
    const audioManager = { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} };
    const extras = [];
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
      onStateChange: (_engine, extra) => extras.push(extra)
    });
    return fn(engine, storageManager, duelCalls, extras);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  }
};

/** Fires shots one after the other, as if each had settled before the next. */
const fireShots = (engine, count) => {
  for (let i = 0; i < count; i++) {
    engine.physicsWorld.projectile = null;
    engine.stageIntroFrames = 0;
    engine.shoot();
  }
  engine.physicsWorld.projectile = null;
};

const pastDateKey = () => new Date(Date.now() - PAST_DAYS * MS_PER_DAY).toISOString().slice(0, 10);

const makeGhost = (mode, key, alias = 'Sam') => {
  const tl = {
    v: gameConfig.shotTimeline.formatVersion,
    mode,
    c: 1,
    n: GHOST_SHOT_COUNT,
    step: 1,
    s: [0, GHOST_FINAL],
    b: [10, 9]
  };
  const ctx = {
    todayKey: SeededRandom.getTodayDateKey(),
    epochDateKey: gameConfig.share.epochDateKey,
    seed: fluxConfig.seed,
    maxPoints: gameConfig.shotTimeline.maxPoints
  };
  const ghost = ghostFromTimeline(tl, { key, cv: DUEL_CFG.contentVersion, alias }, DUEL_CFG, ctx);
  assert.ok(ghost, 'the test ghost must be encodable');
  return ghost;
};

test('a duel on today\'s Daily records normally', () => {
  withEngine((engine, storage, duelCalls) => {
    const today = SeededRandom.getTodayDateKey();
    assert.equal(engine.startGhostDuel(makeGhost('daily', today)), true);
    assert.equal(engine.mode, GAME_MODES.DAILY);
    assert.equal(engine.isDailyRematch, false);
    assert.ok(engine.ghostDuel);
    assert.equal(storage.getDailyStreak(today), 1);
    fireShots(engine, SHOTS_FIRED);
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    assert.ok(storage.getDailyHistory().some((entry) => entry.d === today));
    assert.equal(duelCalls.recorded.length, 1);
    assert.equal(duelCalls.recorded[0].key, today);
    assert.equal(duelCalls.recorded[0].alias, 'Sam');
    assert.equal(duelCalls.recorded[0].ghostScore, GHOST_FINAL);
    assert.equal(duelCalls.recorded[0].outcome, 'lost');
  });
});

test('a rematch of a past Daily pays no bonus and writes no streak, history or daily score', () => {
  withEngine((engine, storage, duelCalls) => {
    const past = pastDateKey();
    const coinsBefore = storage.getCoins();
    assert.equal(engine.startGhostDuel(makeGhost('daily', past)), true);
    assert.equal(engine.isDailyRematch, true);
    assert.equal(engine.dailySeedKey, past);
    assert.equal(storage.getCoins(), coinsBefore);
    assert.equal(storage.getDailyStreak(past), 0);
    fireShots(engine, SHOTS_FIRED);
    engine.score = 120;
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    assert.equal(storage.getDailyHistory().length, 0);
    assert.equal(storage.getDailyHighScore(past), 0);
    assert.equal(storage.hasPlayedDailyToday(past), false);
    assert.equal(engine.gameOverSummary.duel.isRematch, true);
    assert.equal(duelCalls.recorded.length, 1);
    assert.equal(duelCalls.recorded[0].outcome, 'won');
  });
});

test('a Flux duel locks the device tilt', () => {
  withEngine((engine) => {
    assert.equal(engine.startGhostDuel(makeGhost('flux', FLUX_SEED)), true);
    assert.equal(engine.mode, GAME_MODES.FLUX);
    assert.equal(engine.fluxSeed, FLUX_SEED);
    assert.equal(engine.isTiltLocked(), true);
    engine.setTilt(0.5);
    assert.equal(engine.physicsWorld.tiltFactor, 0);
  });
});

test('a restart keeps the ghost and a mode change clears it', () => {
  withEngine((engine) => {
    const dailyGhost = makeGhost('daily', pastDateKey());
    engine.startGhostDuel(dailyGhost);
    engine.restartCurrent();
    assert.equal(engine.ghostDuel?.ghost, dailyGhost);
    assert.equal(engine.isDailyRematch, true);

    const fluxGhost = makeGhost('flux', FLUX_SEED);
    engine.startGhostDuel(fluxGhost);
    engine.restartCurrent();
    assert.equal(engine.ghostDuel?.ghost, fluxGhost);
    assert.equal(engine.fluxSeed, FLUX_SEED);
    assert.equal(engine.isTiltLocked(), true);

    engine.startEndlessMode();
    assert.equal(engine.ghostDuel, null);
    assert.equal(engine.isDailyRematch, false);
  });
});

test('attachGhost refuses a ghost from another board', () => {
  withEngine((engine) => {
    engine.startFluxRun(FLUX_SEED, { isShared: true });
    assert.equal(engine.attachGhost(makeGhost('flux', 'zzz999')), false);
    assert.equal(engine.ghostDuel, null);
    assert.equal(engine.attachGhost(makeGhost('flux', FLUX_SEED)), true);
  });
});

test('a restored run keeps the ghost, the rematch flag and the shot count', () => {
  withEngine((engine, storage) => {
    const ghost = makeGhost('daily', pastDateKey());
    engine.startGhostDuel(ghost);
    fireShots(engine, SHOTS_FIRED);
    const snapshot = captureRunSnapshot(engine, storage.getRunSnapshotVersion());
    assert.ok(isValidRunSnapshot(snapshot, storage.getRunSnapshotVersion()));
    assert.equal(typeof snapshot.ghostDuelCode, 'string');
    engine.startEndlessMode();
    assert.equal(engine.ghostDuel, null);
    assert.ok(applyRunSnapshot(engine, JSON.parse(JSON.stringify(snapshot))));
    assert.equal(engine.ghostDuel?.ghost.final, ghost.final);
    assert.equal(engine.ghostDuel?.ghost.key, ghost.key);
    assert.equal(engine.isDailyRematch, true);
    assert.equal(engine.shotTimeline.n, SHOTS_FIRED);
  });
});

test('a restored Flux duel stays tilt-locked, and a snapshot without a ghost restores without one', () => {
  withEngine((engine, storage) => {
    engine.startGhostDuel(makeGhost('flux', FLUX_SEED));
    fireShots(engine, SHOTS_FIRED);
    const snapshot = JSON.parse(JSON.stringify(captureRunSnapshot(engine, storage.getRunSnapshotVersion())));
    engine.startEndlessMode();
    assert.ok(applyRunSnapshot(engine, snapshot));
    assert.ok(engine.ghostDuel);
    assert.equal(engine.isTiltLocked(), true);
    assert.equal(engine.shotTimeline.n, SHOTS_FIRED);

    const plain = JSON.parse(JSON.stringify(snapshot));
    delete plain.ghostDuelCode;
    delete plain.isDailyRematch;
    engine.startEndlessMode();
    assert.ok(applyRunSnapshot(engine, plain));
    assert.equal(engine.ghostDuel, null);
  });
});

test('continuing out of shots retracts the duel record', () => {
  withEngine((engine, storage, duelCalls) => {
    engine.startGhostDuel(makeGhost('flux', FLUX_SEED));
    fireShots(engine, 1);
    storage.setCoins(TOP_UP_COINS);
    engine.shotsRemaining = 0;
    engine.triggerGameOver(GAME_OVER_REASONS.OUT_OF_SHOTS);
    assert.equal(duelCalls.recorded.length, 1);
    assert.ok(engine.gameOverSummary.duel);
    assert.equal(engine.continueOutOfShots(), true);
    assert.equal(duelCalls.retracted, 1);
    assert.equal(engine.getGhostDuelStatus().result, null);
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    assert.equal(duelCalls.recorded.length, 2);
  });
});

test('a non-weekly Flux run samples its timeline but does not persist it', () => {
  withEngine((engine, storage) => {
    engine.startFluxRun(FLUX_SEED);
    assert.equal(engine.isWeeklyFluxRun, false);
    fireShots(engine, SHOTS_FIRED);
    assert.equal(engine.shotTimeline.n, SHOTS_FIRED);
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    assert.equal(engine.shotTimeline.c, 1);
    assert.equal(storage.getDailyHistory().length, 0);
    assert.ok(!storage.getWeeklyFluxBest(engine.weeklyWeekKey ?? ''));
  });
});

test('gameOverSummary.duel carries the settled result', () => {
  withEngine((engine) => {
    engine.startGhostDuel(makeGhost('flux', FLUX_SEED, ''));
    fireShots(engine, SHOTS_FIRED);
    engine.score = GHOST_FINAL;
    engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    const duel = engine.gameOverSummary.duel;
    assert.equal(duel.outcome, 'tie');
    assert.equal(duel.gap, 0);
    assert.equal(duel.myScore, GHOST_FINAL);
    assert.equal(duel.ghostScore, GHOST_FINAL);
    assert.equal(duel.mode, 'flux');
    assert.equal(duel.key, FLUX_SEED);
    assert.equal(duel.isRematch, false);
    assert.equal(typeof duel.name, 'string');
    assert.ok(duel.name.length > 0);
  });
});

test('quitting a duel records nothing', () => {
  withEngine((engine, storage, duelCalls) => {
    engine.startGhostDuel(makeGhost('flux', FLUX_SEED));
    fireShots(engine, SHOTS_FIRED);
    engine.startEndlessMode();
    assert.equal(duelCalls.recorded.length, 0);
    assert.ok(storage);
  });
});

test('evaluateGhostShot announces at most once per shot', () => {
  withEngine((engine, _storage, _calls, extras) => {
    engine.startGhostDuel(makeGhost('flux', FLUX_SEED, 'Sam'));
    const announcements = () => extras.filter((extra) => extra?.ghostAnnouncement);
    let previous = 0;
    for (let shot = 1; shot <= SHOTS_FIRED + 1; shot++) {
      fireShots(engine, 1);
      const now = announcements().length;
      assert.ok(now - previous <= 1, 'at most one announcement per shot');
      previous = now;
      assert.equal(engine.evaluateGhostShot(), null, 'a second evaluation of the same shot is silent');
      assert.equal(announcements().length, now);
    }
    const ended = announcements().find((extra) => extra.ghostAnnouncement.kind === 'ended');
    assert.ok(ended, 'the end of the ghost run is announced');
    assert.equal(ended.ghostAnnouncement.name, 'Sam');
    assert.equal(ended.ghostAnnouncement.score, GHOST_FINAL);
  });
});
