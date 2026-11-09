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


/*
 * Polarity Duel match controller. Two versus-role boards are stepped in lockstep at the
 * fixed timestep; each board is driven either by external input (the human) or by a BotBrain
 * CPU with its own seeded stream. The controller routes the attacks and field pulses between
 * the boards, runs the rounds (best of three, replay on a simultaneous loss), the sudden
 * death and the announcements. Pure and deterministic: nothing here reads the clock, the DOM
 * or an ambient random source, and nothing is written to the player's profile (the engines
 * only see the versus storage view).
 *
 * Three entry points share the file: createVersusMatch({mode: 'cpu', ...}) builds the full
 * controller against a CPU (or CPU vs CPU), createVersusMatch({mode: 'local', ...}) builds it
 * for two humans on one device, and createVersusMatch({tiers, ...}) keeps the one-round
 * headless duel of the multi-board foundation (run() with a frame cap).
 */

import { GAME_STATES } from '../core/Constants.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { createVersusStorageView } from '../core/StorageView.js';
import { createAudioChannel } from '../core/AudioChannel.js';
import { GameEngine, ENGINE_ROLES } from './GameEngine.js';
import { VERSUS_ENGINE_EVENTS } from './EngineVersus.js';
import {
  countPlannerWork,
  createShotPlanner,
  pickGuardCharge,
  planGuardShot
} from './BotBrain.js';
import {
  ROUND_RESULTS,
  applyBoardLoss,
  createRoundState,
  isMatchOver,
  matchWinner,
  suddenDeathDue
} from './VersusRules.js';

const BOARD_COUNT = 2;
const FIRST_ROUND = 0;
const OUTCOMES = Object.freeze({ DRAW: 'draw', CAPPED: 'capped' });
/** Aim angles are logged as integers at this precision (radians x this). */
const LOG_ANGLE_PRECISION = 1e6;
/** Stereo pan of each board: the first board on the left, the second on the right. */
const BOARD_PANS = Object.freeze([-1, 1]);
const NO_PLAYER = null;
/** Match modes of the controller (exposed by getState). */
export const MATCH_MODES = Object.freeze({ CPU: 'cpu', LOCAL: 'local', CPU_VS_CPU: 'cpuVsCpu' });
/** Charge rise time factor of a board without a handicap. */
const NO_HANDICAP = 1;
const ALL_ANGLES = Infinity;

/** Phases of a match controller. */
export const MATCH_PHASES = Object.freeze({
  PLAYING: 'playing',
  ROUND_OVER: 'roundOver',
  MATCH_OVER: 'matchOver'
});

/** Announcements a controller sends to onEvent listeners. */
export const MATCH_EVENTS = Object.freeze({
  ROUND_START: 'roundStart',
  CHARGE_INCOMING: VERSUS_ENGINE_EVENTS.CHARGE_INCOMING,
  CHARGE_NEUTRALISED: VERSUS_ENGINE_EVENTS.CHARGE_NEUTRALISED,
  CHARGE_WEAKENED: VERSUS_ENGINE_EVENTS.CHARGE_WEAKENED,
  CHARGE_DEFLECTED: VERSUS_ENGINE_EVENTS.CHARGE_DEFLECTED,
  CHARGE_LANDED: VERSUS_ENGINE_EVENTS.CHARGE_LANDED,
  ATTACK_SENT: VERSUS_ENGINE_EVENTS.ATTACK_SENT,
  GUARD_SPECIAL: VERSUS_ENGINE_EVENTS.GUARD_SPECIAL,
  PULSE_SENT: VERSUS_ENGINE_EVENTS.PULSE_SENT,
  PULSE_RECEIVED: VERSUS_ENGINE_EVENTS.PULSE_RECEIVED,
  SUDDEN_DEATH: 'suddenDeath',
  ROUND_WON: 'roundWon',
  ROUND_LOST: 'roundLost',
  ROUND_REPLAY: 'roundReplay',
  MATCH_WON: 'matchWon',
  MATCH_LOST: 'matchLost',
  // Local mode: there is no viewpoint, so a result names the winner and the loser instead.
  ROUND_DECIDED: 'roundDecided',
  MATCH_DECIDED: 'matchDecided'
});

/** Engine reports passed on as announcements as they are. */
const FORWARDED_ENGINE_EVENTS = new Set([
  VERSUS_ENGINE_EVENTS.CHARGE_INCOMING,
  VERSUS_ENGINE_EVENTS.CHARGE_NEUTRALISED,
  VERSUS_ENGINE_EVENTS.CHARGE_WEAKENED,
  VERSUS_ENGINE_EVENTS.CHARGE_DEFLECTED,
  VERSUS_ENGINE_EVENTS.CHARGE_LANDED,
  VERSUS_ENGINE_EVENTS.ATTACK_SENT,
  VERSUS_ENGINE_EVENTS.GUARD_SPECIAL,
  VERSUS_ENGINE_EVENTS.PULSE_RECEIVED
]);

/** Counters of one board over a match, all zero. */
function createEmptyStats() {
  return { neutralised: 0, weakened: 0, deflected: 0, landed: 0, pulsesSent: 0, pulsesReceived: 0, specialsGranted: 0 };
}

/** Sum of two stats objects (a key missing on one side counts as zero). */
function addStats(total, extra) {
  const sum = { ...total };
  for (const [key, value] of Object.entries(extra ?? {})) {
    sum[key] = (sum[key] ?? 0) + value;
  }
  return sum;
}

const NOT_FOUND = -1;
const NO_CHANCE = 0;
// Name of the seeded stream of the CPU's Resonance rolls (apart from every other stream).
const RESONANCE_STREAM = 'resonance-bot';

/** Seeded stream as a () => number in [0, 1). */
function createRng(key) {
  const stream = new SeededRandom(key);
  return () => stream.next();
}

/**
 * Normalises a CPU tier: a name of gameConfig.versus.cpu, a config entry, or a tier already in
 * the flat form {thinkFrames, thinkJitterFrames, noiseRad, aimSamples, anglesPerFrame, policy,
 * guardChance, flipChance}.
 * @param {object} gameConfig - Game config.
 * @param {string|object} tier - Tier name or tier object.
 * @returns {object} The flat tier.
 */
export function resolveCpuTier(gameConfig, tier) {
  const spec = typeof tier === 'string' ? gameConfig.versus.cpu[tier] : tier;
  if (!spec) {
    throw new Error(`Unknown CPU tier: ${String(tier)}`);
  }
  if (typeof spec.thinkFrames === 'object') {
    // The Resonance chance of a named tier sits at its rank in the tier list.
    const rank = typeof tier === 'string' ? Object.keys(gameConfig.versus.cpu).indexOf(tier) : NOT_FOUND;
    return {
      resonanceChance: gameConfig.resonance?.botChance?.[rank] ?? NO_CHANCE,
      thinkFrames: spec.thinkFrames.mean,
      thinkJitterFrames: spec.thinkFrames.jitter,
      noiseRad: spec.aimNoiseRad,
      aimSamples: spec.angleSamples,
      anglesPerFrame: spec.anglesPerFrame,
      policy: spec.policy,
      guardChance: spec.guardChance,
      flipChance: spec.flipChance
    };
  }
  return {
    guardChance: 0,
    flipChance: 0,
    anglesPerFrame: ALL_ANGLES,
    ...spec
  };
}

/** Frames the CPU waits before it aims: the tier's think time plus or minus its jitter. */
function rollThinkFrames(tier, rng) {
  const jitter = (rng() * 2 - 1) * (tier.thinkJitterFrames ?? 0);
  return Math.max(0, Math.round(tier.thinkFrames + jitter));
}

/**
 * One CPU: thinks, spreads its aim search over the end of the think time, answers a
 * threatening charge with the tier's chance (flipping the polarity when it may), then aims
 * with the tier's noise and shoots. step() returns the angle of the shot, or null.
 */
function createCpu({ tier, bot, rng, reach, resonanceRng }) {
  const tierBot = { ...bot, aimSamples: tier.aimSamples ?? bot.aimSamples };
  const anglesPerFrame = tier.anglesPerFrame ?? ALL_ANGLES;
  const guardDecisions = new Map();
  const flipDecisions = new Map();
  let thinkLeft = rollThinkFrames(tier, rng);
  let planner = null;

  const unflip = (engine) => {
    if (engine.isPolarityFlipped) {
      engine.togglePolarityFlip();
    }
  };

  // The Resonance roll of a shot comes from its own stream, so it never moves the stream
  // that drives the CPU's decisions (or the board's seeded draws).
  const shoot = (engine) => {
    engine.queueBotResonanceRoll(resonanceRng() < (tier.resonanceChance ?? NO_CHANCE));
    engine.shoot();
  };

  const fire = (engine) => {
    const guardCharge = engine.versus
      ? pickGuardCharge(engine.versus.charges, guardDecisions, tier.guardChance ?? 0, rng)
      : null;
    if (guardCharge) {
      if (!flipDecisions.has(guardCharge.id)) {
        flipDecisions.set(guardCharge.id, rng() < (tier.flipChance ?? 0));
      }
      const guardShot = planGuardShot(engine, guardCharge, flipDecisions.get(guardCharge.id));
      if (guardShot) {
        if (guardShot.flip) {
          engine.togglePolarityFlip();
        }
        engine.updateAimFromAngle(guardShot.angle);
        shoot(engine);
        thinkLeft = rollThinkFrames(tier, rng);
        planner = null;
        return guardShot.angle;
      }
    }
    unflip(engine);
    if (!planner) {
      planner = createShotPlanner(engine, tierBot, reach, rng, tier.policy);
    }
    planner.step(ALL_ANGLES);
    const plan = planner.result();
    planner = null;
    if (plan.angle === null) {
      return null;
    }
    thinkLeft = rollThinkFrames(tier, rng);
    if (plan.specialType) {
      engine.equipSpecialBall(plan.specialType);
    }
    const angle = plan.angle + (rng() * 2 - 1) * (tier.noiseRad ?? 0);
    engine.updateAimFromAngle(angle);
    shoot(engine);
    return angle;
  };

  return {
    step(engine) {
      if (engine.state !== GAME_STATES.PLAYING || engine.physicsWorld.projectile) {
        planner = null;
        return null;
      }
      if (thinkLeft > 0) {
        thinkLeft -= 1;
        const scanFrames = Math.ceil(countPlannerWork(engine, tierBot, tier.policy) / anglesPerFrame);
        if (thinkLeft <= scanFrames) {
          if (!planner) {
            unflip(engine);
            planner = createShotPlanner(engine, tierBot, reach, rng, tier.policy);
          }
          planner.step(anglesPerFrame);
        }
        return null;
      }
      return fire(engine);
    }
  };
}

/** Builds one versus-role engine for a board of a match. */
function createBoardEngine({ configs, storageManager, audioManager, isMuted, boardIndex, onStateChange, resonance, isCpu }) {
  const engine = new GameEngine({
    ...configs,
    storageManager: createVersusStorageView(storageManager),
    audioManager: createAudioChannel(audioManager, { muted: isMuted, pan: BOARD_PANS[boardIndex] }),
    onStateChange: (engine, extra) => onStateChange(boardIndex, engine, extra),
    role: ENGINE_ROLES.VERSUS
  });
  engine.setVersusResonanceOption(resonance);
  engine.setBotResonanceDriven(isCpu);
  return engine;
}

/**
 * Builds a Polarity Duel match controller.
 *
 * Controller API:
 *   engines                        the two boards (stable across rounds)
 *   step()                         one fixed step of both boards; returns the events it produced
 *   getState()                     read-only snapshot for the HUD (see below)
 *   pause() / resume() / isPaused()
 *   restart(seed?)                 a fresh match, same seed unless one is given
 *   advance()                      starts the next round once a round is over (no-op otherwise)
 *   onEvent(callback)              announcements; returns the function that unsubscribes
 *   run(frameCap)                  headless: steps (advancing rounds) until the match is over
 *   getScene(renderers)            {boards, versus: true, step} for a game loop
 *   getEventLog()                  every announcement of the match
 *
 * getState() returns {phase, isPaused, frame, roundFrame, timerSeconds, isSuddenDeath,
 *   playerBoard, mode ('cpu'|'local'|'cpuVsCpu'), humanBoards:[boardIndex...],
 *   round: {number, wins:[n,n], roundsToWin, decided:[winnerIndex...], lastResult},
 *   matchWinner, boards:[{index, isPlayer, isHuman, isCpu, tier, state, score, incoming, charges:[{id,
 *   polarity, strength, progress, threatening}], pulse:{value, max, ratio}, sag, guardStreak,
 *   stats (this round), matchStats (whole match)}], lastEvents}.
 *
 * @param {object} options
 * @param {string|number} options.seed - Match seed; round n plays on `versus:<seed>:r<n>`.
 * @param {string} [options.mode] - 'cpu' or 'local' for the controller; omitted for the foundation duel.
 *   In 'local' both boards are driven by external input (two humans): no board is "the player",
 *   rounds and the match end with ROUND_DECIDED / MATCH_DECIDED, and the rounds never advance by themselves.
 * @param {number|null} [options.playerBoard=0] - Board driven by external input; null for CPU vs CPU (ignored in 'local').
 * @param {number[]} [options.riseMultipliers] - Local handicap: charge rise time factor of each board (default none).
 * @param {string|object} [options.cpuTier='normal'] - Tier of the CPU opposite the player.
 * @param {Array<string|object>} [options.cpuTiers] - Both tiers for CPU vs CPU.
 * @param {object} options.configs - {gameConfig, physicsConfig, ballsConfig, obstaclesConfig, levelsConfig, campaignConfig, campaignTuning, fluxConfig}.
 * @param {object} [options.bot] - Bot tuning, default campaignConfig.generated.calibration.bot.
 * @param {object} options.storageManager - Real storage manager, seen only through the versus view.
 * @param {object} [options.audioManager] - Shared audio manager, seen only through channels.
 * @param {boolean[]} [options.mutedBoards] - Muted flags per board; default: only the player's board is audible.
 * @param {boolean} [options.resonance] - Resonance match option: true or false forces it for both boards, omitted follows the player's setting.
 * @param {boolean} [options.autoAdvance] - Start the next round by itself after the round break (default: CPU vs CPU only).
 * @param {Function} [options.onBoardChange] - (boardIndex, engine, extra) for the HUD of each board.
 * @param {Function} [options.onEvent] - Announcement listener, subscribed before the first round starts (so roundStart of round 1 is received).
 * @returns {object} The controller.
 */
export function createVersusMatch(options) {
  if (options.mode === undefined && Array.isArray(options.tiers)) {
    return createHeadlessDuel(options);
  }
  const {
    seed,
    riseMultipliers = [NO_HANDICAP, NO_HANDICAP],
    playerBoard: requestedPlayerBoard = 0,
    cpuTier = 'normal',
    cpuTiers,
    configs,
    storageManager,
    audioManager,
    mutedBoards,
    resonance,
    onBoardChange = () => {},
    onEvent = null
  } = options;
  const gameConfig = configs.gameConfig;
  const cfg = gameConfig.versus;
  const bot = options.bot ?? configs.campaignConfig.generated.calibration.bot;
  const isLocal = options.mode === MATCH_MODES.LOCAL;
  const playerBoard = isLocal ? NO_PLAYER : requestedPlayerBoard;
  const hasPlayer = playerBoard === 0 || playerBoard === 1;
  const matchMode = isLocal ? MATCH_MODES.LOCAL : (hasPlayer ? MATCH_MODES.CPU : MATCH_MODES.CPU_VS_CPU);
  const autoAdvance = options.autoAdvance ?? (!hasPlayer && !isLocal);
  const viewpoint = hasPlayer ? playerBoard : 0;
  const reach = configs.physicsConfig.ball.radius * bot.neighborhoodRadii;

  const tiers = [0, 1].map((b) => {
    if (isLocal || (hasPlayer && b === playerBoard)) {
      return null;
    }
    const chosen = hasPlayer ? cpuTier : (cpuTiers ?? [cpuTier, cpuTier])[b];
    return { name: typeof chosen === 'string' ? chosen : null, spec: resolveCpuTier(gameConfig, chosen) };
  });
  const muted = mutedBoards ?? [0, 1].map((b) => !isLocal && (!hasPlayer || b !== playerBoard));
  const engines = [0, 1].map((b) => createBoardEngine({
    configs,
    storageManager,
    audioManager,
    isMuted: muted[b],
    boardIndex: b,
    onStateChange: onBoardChange,
    resonance,
    isCpu: tiers[b] !== null
  }));

  const listeners = new Set();
  if (onEvent) {
    listeners.add(onEvent);
  }
  const eventLog = [];
  // Stats of the rounds already played, per board; the round in progress is added on top in getState().
  let bankedStats = [createEmptyStats(), createEmptyStats()];
  let matchSeed = seed;
  let roundState = createRoundState(cfg);
  let attempt = FIRST_ROUND;
  let phase = MATCH_PHASES.PLAYING;
  let isPaused = false;
  let frame = 0;
  let roundFrame = 0;
  let lastPulseFrame = null;
  let breakLeft = 0;
  let cpus = [null, null];
  let stepEvents = [];
  let lastEvents = [];
  let isSuddenDeath = false;
  let lossesHandled = [false, false];

  const emit = (type, data = {}) => {
    const event = { type, frame, round: attempt, ...data };
    stepEvents.push(event);
    eventLog.push(event);
    for (const listener of listeners) {
      listener(event);
    }
  };

  const markPlayer = (board) => (hasPlayer ? { isPlayer: board === playerBoard } : {});

  /** Builds the boards and the CPUs of the round that is about to start. */
  const startRound = () => {
    const seedKey = `versus:${matchSeed}:r${attempt}`;
    cpus = engines.map((engine, b) => {
      engine.setVersusRiseMultiplier(riseMultipliers[b] ?? NO_HANDICAP);
      engine.startVersusBoard({ seedKey, boardIndex: b });
      if (isLocal || (hasPlayer && b === playerBoard)) {
        engine.setVersusAimTruncation(true);
      }
      return tiers[b]
        ? createCpu({
          tier: tiers[b].spec,
          bot,
          rng: createRng(`${seedKey}:cpu:${b}`),
          reach,
          resonanceRng: createRng(`${seedKey}:${RESONANCE_STREAM}:${b}`)
        })
        : null;
    });
    roundFrame = 0;
    lastPulseFrame = null;
    isSuddenDeath = false;
    lossesHandled = [false, false];
    phase = MATCH_PHASES.PLAYING;
    emit(MATCH_EVENTS.ROUND_START, { number: attempt + 1 });
  };

  /** Moves the outbox of each board to the other one, then turns the engine reports into announcements. */
  const routeAndAnnounce = () => {
    const outputs = engines.map((engine) => engine.drainVersusOutput());
    for (let b = 0; b < BOARD_COUNT; b++) {
      const target = engines[1 - b];
      for (const item of outputs[b].outbox) {
        if (item.type === 'pulse') {
          target.receiveFieldPulse('pulse');
        } else {
          target.receiveVersusAttack(item);
        }
      }
    }
    // Pulses received during the routing are reported by the engine in the same step.
    const lateEvents = engines.map((engine) => engine.drainVersusOutput().events);
    for (let b = 0; b < BOARD_COUNT; b++) {
      for (const event of [...outputs[b].events, ...lateEvents[b]]) {
        const { type, board, ...data } = event;
        if (type === VERSUS_ENGINE_EVENTS.PULSE_SENT) {
          emit(MATCH_EVENTS.PULSE_SENT, { board, target: 1 - board, ...markPlayer(board), ...data });
        } else if (FORWARDED_ENGINE_EVENTS.has(type)) {
          emit(type, { board, ...markPlayer(board), ...data });
        }
      }
    }
  };

  /** Sudden death: both rails lower together on the configured clock. */
  const runSuddenDeath = () => {
    if (!suddenDeathDue(roundFrame, lastPulseFrame, cfg)) {
      return;
    }
    lastPulseFrame = roundFrame;
    isSuddenDeath = true;
    emit(MATCH_EVENTS.SUDDEN_DEATH, {});
    for (const engine of engines) {
      engine.receiveFieldPulse('suddenDeath');
    }
    for (const engine of engines) {
      for (const event of engine.drainVersusOutput().events) {
        if (event.type === VERSUS_ENGINE_EVENTS.PULSE_RECEIVED) {
          emit(MATCH_EVENTS.PULSE_RECEIVED, { board: event.board, source: event.source, ...markPlayer(event.board) });
        }
      }
    }
  };

  /** Records the boards that fell this step; a double loss replays the round. */
  const settleLosses = () => {
    let lastLoser = null;
    for (let b = 0; b < BOARD_COUNT; b++) {
      if (!lossesHandled[b] && engines[b].state === GAME_STATES.GAME_OVER) {
        lossesHandled[b] = true;
        roundState = applyBoardLoss(roundState, b, roundFrame);
        lastLoser = b;
      }
    }
    if (lastLoser === null) {
      return;
    }
    for (const engine of engines) {
      engine.closeVersusTurn();
    }
    // The round is over for good: its counters join the match totals before the board is rebuilt.
    bankedStats = bankedStats.map((total, b) => addStats(total, engines[b].versus.stats));
    const result = roundState.lastResult;
    breakLeft = cfg.roundBreakFrames;
    if (result.type === ROUND_RESULTS.REPLAY) {
      phase = MATCH_PHASES.ROUND_OVER;
      attempt += 1;
      emit(MATCH_EVENTS.ROUND_REPLAY, {});
      return;
    }
    const roundOutcome = {
      winner: result.winner,
      loser: result.loser,
      wins: [...roundState.wins]
    };
    if (isLocal) {
      emit(MATCH_EVENTS.ROUND_DECIDED, roundOutcome);
    } else {
      emit(result.winner === viewpoint ? MATCH_EVENTS.ROUND_WON : MATCH_EVENTS.ROUND_LOST, roundOutcome);
    }
    attempt += 1;
    if (isMatchOver(roundState)) {
      phase = MATCH_PHASES.MATCH_OVER;
      const winner = matchWinner(roundState);
      const matchOutcome = { winner, wins: [...roundState.wins] };
      if (isLocal) {
        emit(MATCH_EVENTS.MATCH_DECIDED, matchOutcome);
      } else {
        emit(winner === viewpoint ? MATCH_EVENTS.MATCH_WON : MATCH_EVENTS.MATCH_LOST, matchOutcome);
      }
    } else {
      phase = MATCH_PHASES.ROUND_OVER;
    }
  };

  const controller = {
    engines,
    seed,

    step() {
      stepEvents = [];
      if (isPaused || phase === MATCH_PHASES.MATCH_OVER) {
        lastEvents = stepEvents;
        return stepEvents;
      }
      frame += 1;
      if (phase === MATCH_PHASES.ROUND_OVER) {
        breakLeft -= 1;
        if (autoAdvance && breakLeft <= 0) {
          controller.advance();
        }
        lastEvents = stepEvents;
        return stepEvents;
      }
      roundFrame += 1;
      for (let b = 0; b < BOARD_COUNT; b++) {
        cpus[b]?.step(engines[b]);
        engines[b].update();
      }
      routeAndAnnounce();
      runSuddenDeath();
      settleLosses();
      lastEvents = stepEvents;
      return stepEvents;
    },

    advance() {
      if (phase !== MATCH_PHASES.ROUND_OVER) {
        return false;
      }
      startRound();
      return true;
    },

    pause() {
      isPaused = true;
    },

    resume() {
      isPaused = false;
    },

    isPaused() {
      return isPaused;
    },

    restart(newSeed = matchSeed) {
      matchSeed = newSeed;
      roundState = createRoundState(cfg);
      attempt = FIRST_ROUND;
      frame = 0;
      bankedStats = [createEmptyStats(), createEmptyStats()];
      eventLog.length = 0;
      isPaused = false;
      stepEvents = [];
      lastEvents = [];
      startRound();
    },

    onEvent(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    getEventLog() {
      return eventLog;
    },

    getScene(renderers) {
      return {
        boards: engines.map((engine, b) => ({ engine, renderer: renderers?.[b] })),
        versus: true,
        step: () => controller.step()
      };
    },

    run(frameCap) {
      const startFrame = frame;
      while (phase !== MATCH_PHASES.MATCH_OVER && frame - startFrame < frameCap) {
        controller.step();
        if (phase === MATCH_PHASES.ROUND_OVER && !autoAdvance) {
          controller.advance();
        }
      }
      return {
        isOver: phase === MATCH_PHASES.MATCH_OVER,
        winner: matchWinner(roundState),
        wins: [...roundState.wins],
        frames: frame - startFrame,
        rounds: roundState.decided.length
      };
    },

    getState() {
      const fps = cfg.framesPerSecond;
      return {
        phase,
        isPaused,
        frame,
        roundFrame,
        timerSeconds: Math.floor(roundFrame / fps),
        isSuddenDeath,
        playerBoard: hasPlayer ? playerBoard : NO_PLAYER,
        mode: matchMode,
        humanBoards: isLocal ? [0, 1] : (hasPlayer ? [playerBoard] : []),
        round: {
          number: roundState.decided.length + 1,
          wins: [...roundState.wins],
          roundsToWin: roundState.roundsToWin,
          decided: [...roundState.decided],
          lastResult: roundState.lastResult
        },
        matchWinner: matchWinner(roundState),
        boards: engines.map((engine, b) => {
          const versus = engine.versus;
          const max = engine.getOverchargeCap();
          return {
            index: b,
            isPlayer: hasPlayer && b === playerBoard,
            isHuman: tiers[b] === null,
            isCpu: tiers[b] !== null,
            tier: tiers[b]?.name ?? null,
            state: engine.state,
            score: engine.score,
            incoming: versus.charges.length + versus.incoming.reduce((sum, item) => sum + item.count, 0),
            charges: versus.charges.map((charge) => ({
              id: charge.id,
              polarity: charge.polarity,
              strength: charge.strength,
              progress: charge.progress,
              threatening: charge.threatening
            })),
            pulse: { value: engine.overcharge, max, ratio: max > 0 ? engine.overcharge / max : 0 },
            sag: engine.getSagState(),
            guardStreak: versus.guard?.streak ?? 0,
            stats: { ...versus.stats },
            matchStats: phase === MATCH_PHASES.PLAYING ? addStats(bankedStats[b], versus.stats) : { ...bankedStats[b] }
          };
        }),
        lastEvents
      };
    }
  };

  controller.restart(seed);
  return controller;
}

/**
 * The one-round headless duel of the multi-board foundation: two CPUs on `versus:<seed>:r<round>`,
 * stepped until one board falls or the frame cap is reached. No charges are exchanged.
 * @param {object} options - See createVersusMatch; `tiers` are two flat CPU tiers, `frameCap` the cap.
 * @returns {{engines: GameEngine[], seedKey: string, run: () => object}}
 */
function createHeadlessDuel({ seed, round = FIRST_ROUND, tiers, bot, configs, storageManager, audioManager, frameCap }) {
  if (!Array.isArray(tiers) || tiers.length !== BOARD_COUNT) {
    throw new Error('A versus match needs exactly two CPU tiers');
  }
  const seedKey = `versus:${seed}:r${round}`;
  const reach = configs.physicsConfig.ball.radius * bot.neighborhoodRadii;
  const engines = [];
  const cpus = [];
  for (let b = 0; b < BOARD_COUNT; b++) {
    const engine = createBoardEngine({
      configs,
      storageManager,
      audioManager,
      isMuted: true,
      boardIndex: b,
      onStateChange: () => {},
      // No charge is exchanged here: Resonance has nothing to act on and stays off.
      resonance: false,
      isCpu: true
    });
    engine.startVersusBoard({ seedKey, boardIndex: b });
    engines.push(engine);
    cpus.push(createCpu({
      tier: resolveCpuTier(configs.gameConfig, tiers[b]),
      bot,
      rng: createRng(`${seedKey}:cpu:${b}`),
      reach,
      resonanceRng: createRng(`${seedKey}:${RESONANCE_STREAM}:${b}`)
    }));
  }

  /** Steps both boards until one loses or the cap is reached. */
  function run() {
    const log = [];
    let frame = 0;
    for (; frame < frameCap; frame++) {
      for (let b = 0; b < BOARD_COUNT; b++) {
        const angle = cpus[b].step(engines[b]);
        if (angle !== null) {
          log.push([frame, b, Math.round(angle * LOG_ANGLE_PRECISION)]);
        }
        engines[b].update();
      }
      if (engines.some((engine) => engine.state !== GAME_STATES.PLAYING)) {
        break;
      }
    }
    const lost = engines.map((engine) => engine.state !== GAME_STATES.PLAYING);
    let outcome = OUTCOMES.CAPPED;
    if (lost[0] && lost[1]) {
      outcome = OUTCOMES.DRAW;
    } else if (lost[0] || lost[1]) {
      outcome = lost[0] ? 1 : 0;
    }
    return {
      seedKey,
      frames: frame,
      outcome,
      log,
      scores: engines.map((engine) => engine.score),
      stages: engines.map((engine) => engine.classicStage),
      attacks: engines.map((engine) => engine.getVersusAttack())
    };
  }

  return { engines, seedKey, run };
}

