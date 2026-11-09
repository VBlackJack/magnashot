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
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { GAME_OVER_REASONS, GAME_STATES } from '../src/core/Constants.js';
import { createVersusMatch, MATCH_EVENTS, MATCH_PHASES } from '../src/game/VersusMatch.js';

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

/** Frames a whole best-of-three match may take before a test calls it stuck. */
const MATCH_FRAME_CAP = 150000;
/** Frames one round may take: sudden death must end it long before. */
const ROUND_FRAME_CAP = 40000;
const HARD_VS_EASY_QUICK_GAMES = 10;
const HARD_VS_EASY_QUICK_MIN_WINS = 7;
const CPU_BOARD = 1;
const SPY_AUDIO = { playEffect() {}, stopAll() {}, isMuted: () => true, setMuted() {} };

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

const createManager = () => {
  const manager = new StorageManager();
  manager.init();
  return manager;
};

const createCpuMatch = (seed, cpuTiers, extra = {}) =>
  createVersusMatch({
    seed,
    mode: 'cpu',
    playerBoard: null,
    cpuTiers,
    configs,
    storageManager: createManager(),
    audioManager: SPY_AUDIO,
    ...extra
  });

/** Compact, comparable form of an event log. */
const summariseLog = (match) =>
  match.getEventLog().map((event) => [event.frame, event.type, event.board ?? null, event.winner ?? null]);

/** Plays a match to its end and returns what is worth comparing. */
const playOut = (match) => {
  const result = match.run(MATCH_FRAME_CAP);
  return { result, log: summariseLog(match), state: match.getState() };
};

test('a CPU vs CPU match with the same seed gives the same event log and outcome twice', () => {
  withStorage(createSpyStorage(), () => {
    const first = playOut(createCpuMatch('det-1', ['normal', 'easy']));
    const second = playOut(createCpuMatch('det-1', ['normal', 'easy']));
    assert.ok(first.result.isOver, 'the match must end');
    assert.ok(first.log.length > 10, 'the match must produce announcements');
    assert.deepEqual(second.result, first.result);
    assert.deepEqual(second.log, first.log);
    const other = playOut(createCpuMatch('det-2', ['normal', 'easy']));
    assert.notDeepEqual(other.log, first.log, 'another seed plays another match');
  });
});

test('every round ends before the frame cap, sudden death included', () => {
  withStorage(createSpyStorage(), () => {
    for (const seed of ['cap-1', 'cap-2', 'cap-3']) {
      const match = createCpuMatch(seed, ['easy', 'easy']);
      let roundStart = 0;
      let longest = 0;
      while (match.getState().phase !== MATCH_PHASES.MATCH_OVER && match.getState().frame < MATCH_FRAME_CAP) {
        match.step();
        const state = match.getState();
        longest = Math.max(longest, state.roundFrame);
        assert.ok(state.roundFrame <= ROUND_FRAME_CAP, `round of ${seed} ran past ${ROUND_FRAME_CAP} frames`);
        roundStart = state.frame;
      }
      assert.equal(match.getState().phase, MATCH_PHASES.MATCH_OVER, `match ${seed} must end (stopped at ${roundStart})`);
    }
  });
});

test('the match follows best of three with a winner and announcements', () => {
  withStorage(createSpyStorage(), () => {
    const match = createCpuMatch('flow-1', ['hard', 'easy']);
    const { result } = playOut(match);
    assert.ok(result.isOver);
    const state = match.getState();
    assert.equal(state.phase, MATCH_PHASES.MATCH_OVER);
    assert.equal(state.round.wins[state.matchWinner], gameConfig.versus.roundsToWin);
    const types = new Set(match.getEventLog().map((event) => event.type));
    for (const expected of [MATCH_EVENTS.ROUND_START, MATCH_EVENTS.CHARGE_INCOMING, MATCH_EVENTS.ROUND_WON]) {
      assert.ok(types.has(expected), `missing announcement ${expected}`);
    }
    assert.ok(types.has(MATCH_EVENTS.MATCH_WON) || types.has(MATCH_EVENTS.MATCH_LOST));
  });
});

test('getState exposes the HUD view of both boards', () => {
  withStorage(createSpyStorage(), () => {
    const match = createCpuMatch('state-1', ['normal', 'normal']);
    for (let i = 0; i < 600; i++) {
      match.step();
    }
    const state = match.getState();
    assert.equal(state.phase, MATCH_PHASES.PLAYING);
    assert.equal(state.boards.length, 2);
    assert.equal(state.round.roundsToWin, gameConfig.versus.roundsToWin);
    assert.equal(state.timerSeconds, Math.floor(state.roundFrame / gameConfig.versus.framesPerSecond));
    for (const board of state.boards) {
      assert.ok(Array.isArray(board.charges));
      assert.equal(typeof board.incoming, 'number');
      assert.ok(board.pulse.max === gameConfig.scoring.overchargeMax * gameConfig.versus.overchargeMaxMultiplier);
      assert.ok(board.pulse.ratio >= 0 && board.pulse.ratio <= 1);
      assert.equal(board.isCpu, true);
    }
  });
});

test('pause freezes the match and resume continues it', () => {
  withStorage(createSpyStorage(), () => {
    const match = createCpuMatch('pause-1', ['normal', 'normal']);
    for (let i = 0; i < 50; i++) {
      match.step();
    }
    match.pause();
    const frozen = match.getState().frame;
    for (let i = 0; i < 50; i++) {
      match.step();
    }
    assert.equal(match.getState().frame, frozen);
    assert.equal(match.isPaused(), true);
    match.resume();
    match.step();
    assert.equal(match.getState().frame, frozen + 1);
  });
});

test('a human board is not driven by a bot and the CPU board plays at its tier', () => {
  withStorage(createSpyStorage(), () => {
    const match = createVersusMatch({
      seed: 'human-1',
      mode: 'cpu',
      playerBoard: 0,
      cpuTier: 'hard',
      configs,
      storageManager: createManager(),
      audioManager: SPY_AUDIO
    });
    for (let i = 0; i < 900; i++) {
      match.step();
    }
    const [human, cpu] = match.engines;
    assert.equal(human.hasFiredInRound, false, 'nobody shoots on the human board');
    assert.equal(cpu.hasFiredInRound, true, 'the CPU board plays');
    const state = match.getState();
    assert.equal(state.boards[0].isPlayer, true);
    assert.equal(state.boards[CPU_BOARD].tier, 'hard');
    // The human board shoots through the engine, as the UI will.
    human.updateAimFromAngle(-Math.PI / 2);
    human.shoot();
    assert.ok(human.physicsWorld.projectile);
    assert.equal(human.versus.isAimTruncated, true);
  });
});

test('restart gives a fresh match on the same seed and the event listener can unsubscribe', () => {
  withStorage(createSpyStorage(), () => {
    const match = createCpuMatch('restart-1', ['normal', 'easy']);
    const seen = [];
    const off = match.onEvent((event) => seen.push(event.type));
    for (let i = 0; i < 400; i++) {
      match.step();
    }
    const firstFrames = match.getEventLog().map((event) => event.frame);
    match.restart();
    assert.equal(match.getState().frame, 0);
    assert.equal(match.getState().round.wins[0] + match.getState().round.wins[1], 0);
    for (let i = 0; i < 400; i++) {
      match.step();
    }
    assert.deepEqual(match.getEventLog().map((event) => event.frame), firstFrames);
    off();
    const count = seen.length;
    match.step();
    match.restart();
    assert.equal(seen.length, count, 'an unsubscribed listener hears nothing');
  });
});

test('a simultaneous loss replays the round and nobody scores', () => {
  withStorage(createSpyStorage(), () => {
    const match = createCpuMatch('replay-1', ['normal', 'normal']);
    const [first, second] = match.engines;
    for (let i = 0; i < 5; i++) {
      match.step();
    }
    // Both boards fall on the same step.
    first.triggerGameOver('lineCrossed');
    second.triggerGameOver('lineCrossed');
    match.step();
    const state = match.getState();
    assert.equal(state.phase, MATCH_PHASES.ROUND_OVER);
    assert.deepEqual(state.round.wins, [0, 0]);
    assert.ok(match.getEventLog().some((event) => event.type === MATCH_EVENTS.ROUND_REPLAY));
    assert.equal(match.advance(), true);
    assert.equal(match.engines[0].state, GAME_STATES.PLAYING);
  });
});

test('the storage view writes nothing during a full match', () => {
  const storage = createSpyStorage();
  withStorage(storage, () => {
    const manager = createManager();
    const before = { writes: storage.spy.writes, removals: storage.spy.removals, keys: storage.data.size };
    const match = createVersusMatch({
      seed: 'storage-1',
      mode: 'cpu',
      playerBoard: null,
      cpuTiers: ['hard', 'normal'],
      configs,
      storageManager: manager,
      audioManager: SPY_AUDIO
    });
    const result = match.run(MATCH_FRAME_CAP);
    assert.ok(result.isOver);
    assert.equal(storage.spy.writes, before.writes);
    assert.equal(storage.spy.removals, before.removals);
    assert.equal(storage.data.size, before.keys);
  });
});

/** Plays seeded Hard vs Easy games, sides alternating, and counts the Hard wins. */
const countHardWins = (games) => {
  let hardWins = 0;
  for (let g = 0; g < games; g++) {
    const hardBoard = g % 2;
    const tiers = hardBoard === 0 ? ['hard', 'easy'] : ['easy', 'hard'];
    const match = createCpuMatch(`strength-${g}`, tiers);
    const result = match.run(MATCH_FRAME_CAP);
    assert.ok(result.isOver, `game ${g} must end`);
    if (result.winner === hardBoard) {
      hardWins += 1;
    }
  }
  return hardWins;
};

test('Hard beats Easy in at least 7 of 10 seeded games (quick version)', () => {
  withStorage(createSpyStorage(), () => {
    const hardWins = countHardWins(HARD_VS_EASY_QUICK_GAMES);
    console.log(`versus strength: Hard won ${hardWins}/${HARD_VS_EASY_QUICK_GAMES} against Easy`);
    assert.ok(hardWins >= HARD_VS_EASY_QUICK_MIN_WINS, `Hard won only ${hardWins} of ${HARD_VS_EASY_QUICK_GAMES}`);
  });
});

test('a full match stays inside a generous time budget', () => {
  withStorage(createSpyStorage(), () => {
    const match = createCpuMatch('perf-1', ['hard', 'normal']);
    const startedAt = performance.now();
    const result = match.run(MATCH_FRAME_CAP);
    const elapsedMs = performance.now() - startedAt;
    console.log(`versus perf: full match of ${result.frames} frames (${result.rounds} rounds) in ${Math.round(elapsedMs)} ms`);
    assert.ok(result.isOver);
    assert.ok(elapsedMs < 60000, `a full match took ${Math.round(elapsedMs)} ms`);
  });
});

test('matchStats add up every round of the match and equal the announced events', () => {
  withStorage(createSpyStorage(), () => {
    let sawLaterRoundMatter = false;
    for (const seed of ['flow-1', 'stats-2']) {
      const match = createCpuMatch(seed, ['hard', 'normal']);
      match.run(MATCH_FRAME_CAP);
      const state = match.getState();
      assert.ok(state.round.decided.length >= gameConfig.versus.roundsToWin, `${seed} must play several rounds`);
      const log = match.getEventLog();
      for (const board of state.boards) {
        const count = (type) => log.filter((event) => event.type === type && event.board === board.index).length;
        assert.equal(board.matchStats.neutralised, count(MATCH_EVENTS.CHARGE_NEUTRALISED), `${seed} neutralised of board ${board.index}`);
        assert.equal(board.matchStats.pulsesSent, count(MATCH_EVENTS.PULSE_SENT), `${seed} pulses of board ${board.index}`);
        assert.ok(board.matchStats.neutralised >= board.stats.neutralised);
        sawLaterRoundMatter ||= board.matchStats.neutralised > board.stats.neutralised;
      }
    }
    assert.ok(sawLaterRoundMatter, 'the match total is more than the last round alone');
  });
});

test('a listener passed as onEvent hears the roundStart of round 1', () => {
  withStorage(createSpyStorage(), () => {
    const heard = [];
    const match = createCpuMatch('listen-1', ['easy', 'easy'], { onEvent: (event) => heard.push(event) });
    assert.equal(heard[0]?.type, MATCH_EVENTS.ROUND_START);
    assert.equal(heard[0].number, 1);
    match.restart();
    assert.equal(heard.filter((event) => event.type === MATCH_EVENTS.ROUND_START).length, 2, 'later restarts are heard too');
  });
});

// Frozen vs-CPU event logs: captured from the code before the local two-player mode.
const FROZEN_FIXTURE_PATH = './tests/fixtures/versusCpuLogs.v1.20.0.json';
const FROZEN_REGENERATE_FLAG = 'VERSUS_FIXTURE_REGENERATE';
const FROZEN_SCENARIOS = Object.freeze([
  { name: 'cpu-vs-cpu normal/easy det-1', seed: 'det-1', playerBoard: null, cpuTiers: ['normal', 'easy'] },
  { name: 'cpu-vs-cpu hard/normal flow-1', seed: 'flow-1', playerBoard: null, cpuTiers: ['hard', 'normal'] },
  { name: 'cpu-vs-cpu easy/hard frozen-3', seed: 'frozen-3', playerBoard: null, cpuTiers: ['easy', 'hard'] },
  { name: 'idle player 0 vs easy frozen-4', seed: 'frozen-4', playerBoard: 0, cpuTier: 'easy' },
  { name: 'idle player 1 vs hard frozen-5', seed: 'frozen-5', playerBoard: 1, cpuTier: 'hard' }
]);

const playFrozenScenario = ({ name, ...options }) => {
  const match = createVersusMatch({
    mode: 'cpu',
    configs,
    storageManager: createManager(),
    audioManager: SPY_AUDIO,
    // The fixture predates Resonance: it is replayed with the match option off.
    resonance: false,
    ...options
  });
  const result = match.run(MATCH_FRAME_CAP);
  return { name, result, log: JSON.parse(JSON.stringify(match.getEventLog())) };
};

test('vs CPU event logs are unchanged from the frozen fixture', () => {
  withStorage(createSpyStorage(), () => {
    const actual = FROZEN_SCENARIOS.map(playFrozenScenario);
    if (process.env[FROZEN_REGENERATE_FLAG]) {
      fs.writeFileSync(FROZEN_FIXTURE_PATH, `${JSON.stringify(actual)}\n`);
    }
    const frozen = loadJson(FROZEN_FIXTURE_PATH);
    assert.equal(frozen.length, FROZEN_SCENARIOS.length);
    for (let i = 0; i < frozen.length; i++) {
      assert.ok(frozen[i].log.length > 10, `${frozen[i].name} fixture must hold a real log`);
      assert.deepEqual(actual[i], frozen[i], `${frozen[i].name} must replay the frozen log`);
    }
  });
});

// Local two-player mode.

const LOCAL_RISE_PROBE_CAP = 5000;
const PROBE_ATTACK = Object.freeze({ count: 1, strength: 1, polarity: 1 });

const createLocalMatch = (seed, extra = {}) =>
  createVersusMatch({
    seed,
    mode: 'local',
    configs,
    storageManager: createManager(),
    audioManager: SPY_AUDIO,
    ...extra
  });

/** Ends a board the way the rails do. */
const dropBoard = (match, board) => {
  match.engines[board].triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
  match.step();
};

/** Plays a scripted local match: board 1 falls twice, board 0 wins 2-0. */
const playScriptedLocalMatch = (match) => {
  dropBoard(match, 1);
  match.advance();
  dropBoard(match, 1);
};

/** Frame at which a probe charge sent to `board` lands (nobody shoots). */
const landingFrameOf = (match, board) => {
  match.engines[board].receiveVersusAttack(PROBE_ATTACK);
  for (let i = 0; i < LOCAL_RISE_PROBE_CAP; i++) {
    const landed = match.step().find((event) => event.type === MATCH_EVENTS.CHARGE_LANDED && event.board === board);
    if (landed) {
      return landed.frame;
    }
  }
  return null;
};

test('local mode: two human boards, no player, truncated aim and both boards audible', () => {
  withStorage(createSpyStorage(), () => {
    const match = createLocalMatch('local-1');
    const state = match.getState();
    assert.equal(state.mode, 'local');
    assert.deepEqual(state.humanBoards, [0, 1]);
    assert.equal(state.playerBoard, null);
    for (const board of state.boards) {
      assert.equal(board.isHuman, true);
      assert.equal(board.isCpu, false);
      assert.equal(board.isPlayer, false);
      assert.equal(board.tier, null);
    }
    for (const engine of match.engines) {
      assert.equal(engine.versus.isAimTruncated, true);
    }
    for (let i = 0; i < 600; i++) {
      match.step();
    }
    assert.equal(match.engines[0].hasFiredInRound, false, 'no bot drives the first board');
    assert.equal(match.engines[1].hasFiredInRound, false, 'no bot drives the second board');
    assert.equal(match.getState().phase, MATCH_PHASES.PLAYING);
  });
});

test('getState reports the mode and the human boards of cpu and cpuVsCpu matches', () => {
  withStorage(createSpyStorage(), () => {
    const cpuVsCpu = createCpuMatch('mode-1', ['easy', 'easy']).getState();
    assert.equal(cpuVsCpu.mode, 'cpuVsCpu');
    assert.deepEqual(cpuVsCpu.humanBoards, []);
    assert.deepEqual(cpuVsCpu.boards.map((board) => board.isHuman), [false, false]);
    const vsCpu = createVersusMatch({
      seed: 'mode-2',
      mode: 'cpu',
      playerBoard: 1,
      cpuTier: 'easy',
      configs,
      storageManager: createManager(),
      audioManager: SPY_AUDIO
    }).getState();
    assert.equal(vsCpu.mode, 'cpu');
    assert.deepEqual(vsCpu.humanBoards, [1]);
    assert.deepEqual(vsCpu.boards.map((board) => board.isHuman), [false, true]);
  });
});

test('local mode: only decided events, never won or lost, and no isPlayer flag', () => {
  withStorage(createSpyStorage(), () => {
    const match = createLocalMatch('local-2');
    playScriptedLocalMatch(match);
    const log = match.getEventLog();
    const types = log.map((event) => event.type);
    assert.equal(match.getState().phase, MATCH_PHASES.MATCH_OVER);
    assert.equal(types.filter((type) => type === MATCH_EVENTS.ROUND_DECIDED).length, 2);
    assert.equal(types.filter((type) => type === MATCH_EVENTS.MATCH_DECIDED).length, 1);
    for (const forbidden of [MATCH_EVENTS.ROUND_WON, MATCH_EVENTS.ROUND_LOST, MATCH_EVENTS.MATCH_WON, MATCH_EVENTS.MATCH_LOST]) {
      assert.ok(!types.includes(forbidden), `${forbidden} must not be emitted in local mode`);
    }
    for (const event of log) {
      assert.ok(!('isPlayer' in event), `${event.type} must not carry isPlayer`);
    }
    const firstRound = log.find((event) => event.type === MATCH_EVENTS.ROUND_DECIDED);
    assert.equal(firstRound.winner, 0);
    assert.equal(firstRound.loser, 1);
    assert.deepEqual(firstRound.wins, [1, 0]);
    const decided = log.find((event) => event.type === MATCH_EVENTS.MATCH_DECIDED);
    assert.equal(decided.winner, 0);
    assert.deepEqual(decided.wins, [gameConfig.versus.roundsToWin, 0]);
  });
});

test('local mode: a simultaneous loss replays the round and rounds wait for advance()', () => {
  withStorage(createSpyStorage(), () => {
    const match = createLocalMatch('local-3');
    match.engines[0].triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    match.engines[1].triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
    match.step();
    assert.ok(match.getEventLog().some((event) => event.type === MATCH_EVENTS.ROUND_REPLAY));
    assert.equal(match.getState().phase, MATCH_PHASES.ROUND_OVER);
    for (let i = 0; i < gameConfig.versus.roundBreakFrames * 2; i++) {
      match.step();
    }
    assert.equal(match.getState().phase, MATCH_PHASES.ROUND_OVER, 'a local round never advances by itself');
    assert.equal(match.advance(), true);
    assert.equal(match.getState().phase, MATCH_PHASES.PLAYING);
  });
});

test('local mode: the rise multiplier delays only the charges that arrive on that board', () => {
  withStorage(createSpyStorage(), () => {
    const baseline = [landingFrameOf(createLocalMatch('rise-1'), 0), landingFrameOf(createLocalMatch('rise-1'), 1)];
    assert.ok(baseline[0] !== null && baseline[1] !== null, 'a probe charge must land');
    const slowed = [
      landingFrameOf(createLocalMatch('rise-1', { riseMultipliers: [1.5, 1] }), 0),
      landingFrameOf(createLocalMatch('rise-1', { riseMultipliers: [1.5, 1] }), 1)
    ];
    assert.ok(slowed[0] > baseline[0], 'the handicapped board receives its charges later');
    assert.equal(slowed[1], baseline[1], 'the other board is untouched');
    const none = landingFrameOf(createLocalMatch('rise-1', { riseMultipliers: [1, 1] }), 0);
    assert.equal(none, baseline[0], 'multiplier 1 is no handicap');
  });
});

test('local mode: the multiplier survives round changes', () => {
  withStorage(createSpyStorage(), () => {
    const match = createLocalMatch('rise-2', { riseMultipliers: [1, 1.25] });
    dropBoard(match, 0);
    match.advance();
    assert.equal(match.engines[1].versusRiseMultiplier, 1.25);
    assert.equal(match.engines[0].versusRiseMultiplier, 1);
  });
});

test('local mode: the same seed gives the same event log twice', () => {
  withStorage(createSpyStorage(), () => {
    const play = (seed) => {
      const match = createLocalMatch(seed, { riseMultipliers: [1, 1.25] });
      match.engines[0].receiveVersusAttack(PROBE_ATTACK);
      for (let i = 0; i < 900; i++) {
        match.step();
      }
      playScriptedLocalMatch(match);
      return JSON.parse(JSON.stringify(match.getEventLog()));
    };
    const first = play('local-det');
    assert.deepEqual(play('local-det'), first);
    assert.ok(first.length > 4);
  });
});

test('local mode: nothing is written to the profile', () => {
  const storage = createSpyStorage();
  withStorage(storage, () => {
    const match = createLocalMatch('local-4');
    const before = { writes: storage.spy.writes, removals: storage.spy.removals };
    playScriptedLocalMatch(match);
    assert.equal(storage.spy.writes, before.writes);
    assert.equal(storage.spy.removals, before.removals);
  });
});
