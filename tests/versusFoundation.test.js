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
import { createVersusStorageView } from '../src/core/StorageView.js';
import { createAudioChannel } from '../src/core/AudioChannel.js';
import { GameEngine, ENGINE_ROLES } from '../src/game/GameEngine.js';
import { createVersusMatch } from '../src/game/VersusMatch.js';
import { computeVersusAttack } from '../src/game/EngineVersus.js';
import { BOT_POLICIES, pickGreedyAngle } from '../src/game/BotBrain.js';
import { SeededRandom } from '../src/core/SeededRandom.js';
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

const configs = {
  gameConfig,
  physicsConfig,
  ballsConfig,
  obstaclesConfig,
  levelsConfig,
  campaignConfig,
  campaignTuning,
  fluxConfig
};
const bot = campaignConfig.generated.calibration.bot;

const MATCH_SEED = 'foundation-1';
const SEED_KEY = 'versus:foundation-1:r0';
const CPU_TIERS = [
  { thinkFrames: 30, thinkJitterFrames: 8, noiseRad: 0.02, aimSamples: 24, policy: BOT_POLICIES.GREEDY },
  { thinkFrames: 24, thinkJitterFrames: 6, noiseRad: 0.01, aimSamples: 24, policy: BOT_POLICIES.ARSENAL }
];
const MATCH_FRAME_CAP = 3000;
const PERF_FRAME_CAP = 600;
/** Generous for a loaded CI machine: two boards, 600 fixed steps, bot included. */
const PERF_BUDGET_MS = 4000;
const SINGLE_PLAYER_FRAME_CAP = 4000;
const SINGLE_PLAYER_SEED_VALUE = 0.4242;
const DAILY_TEST_DATE = '2025-03-14';
const SCRIPTED_SHOT_FRAMES = 400;
const AMBIENT_PROBE_FRAMES = 900;
const AMBIENT_LOW = 0.01;
const AMBIENT_HIGH = 0.99;
const AMBIENT_CYCLE = 7;
const PRECISION_ROUNDING = 1e6;

/** Results recorded from the engine before the multi-board foundation (the regression anchor). */
const GOLDEN_DAILY = { frame: 870, score: 9602, state: GAME_STATES.GAME_OVER, balls: 117, stage: 0, sag: 4, aim: -2676637 };
const GOLDEN_CLASSIC = { frame: 1165, score: 12800, state: GAME_STATES.GAME_OVER, balls: 36, stage: 1, sag: 0, aim: -234572 };

/** localStorage stand-in that counts every write and removal. */
const createSpyStorage = () => {
  const data = new Map();
  const spy = { writes: 0, removals: 0 };
  return {
    data,
    spy,
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { spy.writes += 1; data.set(k, String(v)); },
    removeItem(k) { spy.removals += 1; data.delete(k); },
    clear() { data.clear(); }
  };
};

const withStorage = (storage, fn) => {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  }
};

const createSpyAudio = () => {
  const calls = { playEffect: 0, stopAll: 0 };
  return {
    calls,
    playEffect: () => { calls.playEffect += 1; },
    stopAll: () => { calls.stopAll += 1; },
    isMuted: () => true,
    setMuted: () => {}
  };
};

const createEngine = (options) =>
  new GameEngine({ ...configs, onStateChange: () => {}, ...options });

const createMatch = (storageManager, audioManager, frameCap = MATCH_FRAME_CAP) =>
  createVersusMatch({
    seed: MATCH_SEED,
    tiers: CPU_TIERS,
    bot,
    configs,
    storageManager,
    audioManager,
    frameCap
  });

const boardSignature = (engine) =>
  engine.physicsWorld.balls.map((b) => [b.x, b.y, b.colorId, b.isAnchor]);

const launcherSignature = (engine) => [
  engine.currentBall.colorId,
  engine.nextBall.colorId,
  [...engine.upcomingColorIds]
];

const createVersusEngine = (manager, audio, boardIndex) => {
  const engine = createEngine({
    storageManager: createVersusStorageView(manager),
    audioManager: createAudioChannel(audio, { muted: true }),
    role: ENGINE_ROLES.VERSUS
  });
  engine.startVersusBoard({ seedKey: SEED_KEY, boardIndex });
  return engine;
};

const createManager = () => {
  const manager = new StorageManager();
  manager.init();
  return manager;
};

test('a versus board is Classic-style, seeded and carries a versus state', () => {
  withStorage(createSpyStorage(), () => {
    const engine = createVersusEngine(createManager(), createSpyAudio(), 0);
    assert.equal(engine.mode, GAME_MODES.CLASSIC);
    assert.equal(engine.state, GAME_STATES.PLAYING);
    assert.equal(engine.versus.seedKey, SEED_KEY);
    assert.deepEqual(engine.versus.charges, []);
    assert.ok(engine.physicsWorld.balls.some((b) => b.isAnchor));
    assert.equal(engine.getClassicStageStreamKey(2), `${SEED_KEY}:board:2`);
  });
});

test('two versus engines side by side start identical and share no state', () => {
  withStorage(createSpyStorage(), () => {
    const manager = createManager();
    const audio = createSpyAudio();
    const first = createVersusEngine(manager, audio, 0);
    const second = createVersusEngine(manager, audio, 1);
    assert.notEqual(first.physicsWorld, second.physicsWorld);
    assert.notEqual(first.versus, second.versus);
    assert.deepEqual(boardSignature(first), boardSignature(second));
    assert.deepEqual(launcherSignature(first), launcherSignature(second));

    // Playing board 0 moves neither the stream, the balls nor the score of board 1.
    // `twin` is an untouched copy of board 1.
    const twin = createVersusEngine(manager, audio, 1);
    const reach = physicsConfig.ball.radius * bot.neighborhoodRadii;
    first.updateAimFromAngle(pickGreedyAngle(first, bot, reach, () => 0.5));
    first.shoot();
    for (let i = 0; i < SCRIPTED_SHOT_FRAMES && first.physicsWorld.projectile; i++) {
      first.update();
    }
    assert.equal(second.score, 0);
    assert.equal(second.physicsWorld.projectile, null);
    assert.deepEqual(boardSignature(second), boardSignature(twin));
    assert.equal(second.random(), twin.random(), 'the streams of board 1 and its twin stay in step');
  });
});

test('a versus board plays the same whatever the ambient random source returns', () => {
  const playWithAmbient = (ambient) => {
    const original = Math.random;
    Math.random = ambient;
    try {
      return withStorage(createSpyStorage(), () => {
        const engine = createVersusEngine(createManager(), createSpyAudio(), 0);
        const rng = new SeededRandom('probe');
        const reach = physicsConfig.ball.radius * bot.neighborhoodRadii;
        for (let frame = 0; frame < AMBIENT_PROBE_FRAMES && engine.state === GAME_STATES.PLAYING; frame++) {
          if (!engine.physicsWorld.projectile) {
            engine.updateAimFromAngle(pickGreedyAngle(engine, bot, reach, () => rng.next()));
            engine.shoot();
          }
          engine.update();
        }
        return { score: engine.score, board: boardSignature(engine), launcher: launcherSignature(engine) };
      });
    } finally {
      Math.random = original;
    }
  };
  let counter = 0;
  const first = playWithAmbient(() => AMBIENT_LOW);
  const second = playWithAmbient(() => AMBIENT_HIGH);
  const third = playWithAmbient(() => (counter++ % AMBIENT_CYCLE) / AMBIENT_CYCLE);
  assert.ok(first.score > 0, 'the probe must score');
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

test('the attack formula follows the configured table', () => {
  const attack = gameConfig.versus.attack;
  assert.deepEqual(
    computeVersusAttack({ dropped: 0, links: 3, isSpecial: false }, attack),
    { raw: 0, sent: 0, isStrong: false }
  );
  assert.equal(computeVersusAttack({ dropped: 1, links: 0, isSpecial: false }, attack).sent, 0);
  assert.equal(computeVersusAttack({ dropped: 3, links: 0, isSpecial: false }, attack).sent, 1);
  assert.equal(computeVersusAttack({ dropped: 3, links: 2, isSpecial: false }, attack).sent, 3);
  const special = computeVersusAttack({ dropped: 3, links: 0, isSpecial: true }, attack);
  assert.equal(special.raw, 2 * attack.specialMultiplier);
  assert.equal(
    computeVersusAttack({ dropped: 40, links: 5, isSpecial: false }, attack).sent,
    attack.maxChargesPerTurn
  );
  assert.equal(computeVersusAttack({ dropped: 9, links: 0, isSpecial: false }, attack).isStrong, true);
});

test('an engine turn feeds the attack counters and a cleared board sends the configured charges', () => {
  withStorage(createSpyStorage(), () => {
    const engine = createVersusEngine(createManager(), createSpyAudio(), 0);
    engine.beginVersusTurn(engine.currentBall);
    engine.noteVersusDrop(4);
    engine.noteVersusLink();
    const totals = engine.getVersusAttack();
    assert.equal(totals.turns, 1);
    assert.equal(totals.dropped, 4);
    assert.equal(totals.links, 1);
    assert.equal(totals.raw, 4 - 1 + 2);
    assert.equal(totals.sent, 2);
    engine.noteVersusBoardClear();
    assert.equal(engine.getVersusAttack().sent, 2 + gameConfig.versus.attack.boardClearCharges);
    assert.equal(engine.getVersusAttack().clears, 1);
  });
});

test('a headless match is deterministic per seed', () => {
  withStorage(createSpyStorage(), () => {
    const manager = createManager();
    const first = createMatch(manager, createSpyAudio()).run();
    const second = createMatch(manager, createSpyAudio()).run();
    assert.ok(first.log.length > 0, 'the CPUs must fire shots');
    assert.deepEqual(second, first);
    assert.equal(first.attacks.length, 2);
    assert.ok(first.frames <= MATCH_FRAME_CAP);

    const other = createVersusMatch({
      seed: 'foundation-2',
      tiers: CPU_TIERS,
      bot,
      configs,
      storageManager: manager,
      audioManager: createSpyAudio(),
      frameCap: MATCH_FRAME_CAP
    }).run();
    assert.notDeepEqual(other.log, first.log, 'another seed plays another match');
  });
});

test('both boards of a match open on the same board and launcher sequence', () => {
  withStorage(createSpyStorage(), () => {
    const { engines } = createMatch(createManager(), createSpyAudio());
    assert.deepEqual(boardSignature(engines[0]), boardSignature(engines[1]));
    assert.deepEqual(launcherSignature(engines[0]), launcherSignature(engines[1]));
  });
});

test('a full headless match writes nothing to storage and never stops the shared audio', () => {
  const storage = createSpyStorage();
  withStorage(storage, () => {
    const manager = createManager();
    const before = { writes: storage.spy.writes, removals: storage.spy.removals, keys: storage.data.size };
    const audio = createSpyAudio();
    const result = createMatch(manager, audio).run();
    assert.ok(result.frames > 0);
    assert.equal(storage.spy.writes, before.writes);
    assert.equal(storage.spy.removals, before.removals);
    assert.equal(storage.data.size, before.keys);
    assert.equal(audio.calls.stopAll, 0, 'a channel never calls the shared stopAll');
    assert.equal(audio.calls.playEffect, 0, 'the match channels are muted');
  });
});

test('two versus boards stay inside the time budget for 600 fixed steps', () => {
  withStorage(createSpyStorage(), () => {
    const match = createMatch(createManager(), createSpyAudio(), PERF_FRAME_CAP);
    const startedAt = performance.now();
    const result = match.run();
    const elapsedMs = performance.now() - startedAt;
    assert.equal(result.frames, PERF_FRAME_CAP);
    assert.ok(elapsedMs < PERF_BUDGET_MS, `600 steps of two boards took ${Math.round(elapsedMs)} ms`);
    console.log(`versus perf: 2 boards x ${PERF_FRAME_CAP} steps in ${Math.round(elapsedMs)} ms`);
  });
});

/** Plays a seeded single-player run with the greedy bot and summarises where it ended. */
const playSeededRun = (start) => {
  const engine = createEngine({
    storageManager: createManager(),
    audioManager: createSpyAudio(),
    seedSource: () => SINGLE_PLAYER_SEED_VALUE
  });
  start(engine);
  const rng = new SeededRandom('single-player-bot');
  const reach = physicsConfig.ball.radius * bot.neighborhoodRadii;
  let frame = 0;
  for (; frame < SINGLE_PLAYER_FRAME_CAP && engine.state === GAME_STATES.PLAYING; frame++) {
    if (!engine.physicsWorld.projectile) {
      const angle = pickGreedyAngle(engine, bot, reach, () => rng.next());
      if (angle !== null) {
        engine.updateAimFromAngle(angle);
        engine.shoot();
      }
    }
    engine.update();
  }
  return {
    frame,
    score: engine.score,
    state: engine.state,
    balls: engine.physicsWorld.balls.length,
    stage: engine.classicStage,
    sag: engine.sagLevel,
    aim: Math.round(engine.aimAngle * PRECISION_ROUNDING),
    versus: engine.versus
  };
};

const withoutVersus = ({ versus, ...rest }) => {
  assert.equal(versus, null, 'a single-player engine carries no versus state');
  return rest;
};

test('single player regression: a seeded Daily run gives the golden result', () => {
  withStorage(createSpyStorage(), () => {
    const result = playSeededRun((engine) => engine.startDailyChallenge(DAILY_TEST_DATE, true));
    assert.deepEqual(withoutVersus(result), GOLDEN_DAILY);
  });
});

test('single player regression: a seeded Classic run gives the golden result', () => {
  withStorage(createSpyStorage(), () => {
    const result = playSeededRun((engine) => engine.startClassicMode());
    assert.deepEqual(withoutVersus(result), GOLDEN_CLASSIC);
  });
});
