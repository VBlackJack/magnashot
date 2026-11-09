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
 * Strength and pace gate of the Polarity Duel CPU tiers (npm run calibrate:versus).
 *
 * The CPU plays itself headless over `--seeds` seeded matches per tier pair, sides alternating.
 * The script prints the win rate of the stronger tier of each pair and the average number of
 * field pulses per round, and exits with code 1 when a threshold of `versus.calibration` in
 * configs/game.json is missed: Hard must beat Easy, Normal must beat Easy, and a round must see
 * a sensible number of pulses (a duel that never pulses, or pulses all the time, is mistuned).
 *
 * Usage: node scripts/calibrate-versus.mjs [--seeds <n>]
 * Bad options exit with code 2 and the usage line; a missed threshold exits with code 1.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { MATCH_EVENTS, createVersusMatch } from '../src/game/VersusMatch.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const USAGE = 'Usage: node scripts/calibrate-versus.mjs [--seeds <n>]';
const SEEDS_FLAG = '--seeds';
const INTEGER_PATTERN = /^\d+$/;
const EXIT_CODES = Object.freeze({ MISSED: 1, USAGE: 2 });
const PERCENT = 100;
const SIDES = 2;
const FIRST_SIDE = 0;
const NO_ROUNDS = 0;

/** The pairs played: the stronger tier is listed first, and its threshold key in versus.calibration. */
export const PAIRS = Object.freeze([
  Object.freeze({ strong: 'hard', weak: 'easy', thresholdKey: 'hardBeatsEasyMin' }),
  Object.freeze({ strong: 'normal', weak: 'easy', thresholdKey: 'normalBeatsEasyMin' })
]);

export class UsageError extends Error {}

const loadJson = (name) => JSON.parse(fs.readFileSync(`${REPO_ROOT}configs/${name}`, 'utf8'));

function loadConfigs() {
  const gameConfig = applyWorldGeometry(loadJson('game.json'));
  const configs = {
    gameConfig,
    physicsConfig: loadJson('physics.json'),
    ballsConfig: loadJson('balls.json'),
    obstaclesConfig: loadJson('obstacles.json'),
    levelsConfig: loadJson('levels.json'),
    campaignConfig: loadJson('campaign.json'),
    campaignTuning: loadJson('campaignTuning.json'),
    fluxConfig: loadJson('flux.json')
  };
  const registered = {
    game: gameConfig,
    physics: configs.physicsConfig,
    balls: configs.ballsConfig,
    obstacles: configs.obstaclesConfig,
    levels: configs.levelsConfig,
    campaign: configs.campaignConfig,
    audio: loadJson('audio.json'),
    flux: configs.fluxConfig
  };
  for (const [key, value] of Object.entries(registered)) {
    configRegistry.configs.set(key, value);
  }
  return configs;
}

const SILENT_AUDIO = Object.freeze({ playEffect() {}, stopAll() {}, isMuted: () => true, setMuted() {} });

/** In-memory localStorage so a headless match never touches a real store. */
function installMemoryStorage() {
  const data = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      get length() {
        return data.size;
      },
      key: (i) => [...data.keys()][i] ?? null,
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: (k) => data.delete(k),
      clear: () => data.clear()
    }
  });
}

/**
 * Parses the command line.
 * @param {string[]} argv - Arguments after the script name.
 * @param {number} defaultSeeds - Seed count when `--seeds` is absent.
 * @returns {{seeds: number}}
 * @throws {UsageError} On an unknown option or a seed count that is not a positive integer.
 */
export function parseArgs(argv, defaultSeeds) {
  let seeds = defaultSeeds;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== SEEDS_FLAG) {
      throw new UsageError(`Unknown option: ${argv[i]}`);
    }
    const value = argv[++i];
    if (!INTEGER_PATTERN.test(value ?? '') || Number(value) < 1) {
      throw new UsageError(`${SEEDS_FLAG} needs a positive integer`);
    }
    seeds = Number(value);
  }
  return { seeds };
}

/**
 * Whether a summary meets the thresholds of `versus.calibration`.
 * @param {{pairs: Array<{thresholdKey: string, share: number}>, pulsesPerRound: number}} summary
 * @param {object} calibration - versus.calibration of the game config.
 * @returns {{pairs: boolean[], pulses: boolean, ok: boolean}}
 */
export function checkThresholds(summary, calibration) {
  const pairs = summary.pairs.map((pair) => pair.share >= calibration[pair.thresholdKey]);
  const { min, max } = calibration.pulsesPerRound;
  const pulses = summary.pulsesPerRound >= min && summary.pulsesPerRound <= max;
  return { pairs, pulses, ok: pairs.every(Boolean) && pulses };
}

/** Plays one headless match and returns who won, and how many rounds and pulses it saw. */
function playMatch({ seed, cpuTiers, configs, calibration }) {
  const storageManager = new StorageManager();
  storageManager.init();
  const match = createVersusMatch({
    seed,
    mode: 'cpu',
    playerBoard: null,
    cpuTiers,
    configs,
    storageManager,
    audioManager: SILENT_AUDIO
  });
  const result = match.run(calibration.frameCap);
  const log = match.getEventLog();
  return {
    isOver: result.isOver,
    winner: result.winner,
    rounds: log.filter((event) => event.type === MATCH_EVENTS.ROUND_START).length,
    pulses: log.filter((event) => event.type === MATCH_EVENTS.PULSE_SENT).length
  };
}

/**
 * Plays every pair over `seeds` matches, alternating the side of the stronger tier.
 * @returns {{pairs: Array<object>, pulsesPerRound: number, stuck: number}}
 */
export function runCalibration(configs, seeds) {
  const calibration = configs.gameConfig.versus.calibration;
  let totalRounds = NO_ROUNDS;
  let totalPulses = 0;
  let stuck = 0;
  const pairs = PAIRS.map((pair) => {
    let strongWins = 0;
    for (let g = 0; g < seeds; g++) {
      const strongBoard = g % SIDES;
      const outcome = playMatch({
        seed: `${calibration.baseSeed}-${pair.strong}-${pair.weak}-${g}`,
        cpuTiers: strongBoard === FIRST_SIDE ? [pair.strong, pair.weak] : [pair.weak, pair.strong],
        configs,
        calibration
      });
      totalRounds += outcome.rounds;
      totalPulses += outcome.pulses;
      if (!outcome.isOver) {
        stuck += 1;
      } else if (outcome.winner === strongBoard) {
        strongWins += 1;
      }
    }
    return { ...pair, wins: strongWins, games: seeds, share: strongWins / seeds };
  });
  return { pairs, pulsesPerRound: totalRounds > NO_ROUNDS ? totalPulses / totalRounds : 0, stuck };
}

const formatShare = (share) => `${(share * PERCENT).toFixed(1)}%`;

function runMain() {
  const configs = loadConfigs();
  const calibration = configs.gameConfig.versus.calibration;
  let options;
  try {
    options = parseArgs(process.argv.slice(2), calibration.defaultSeeds);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
      process.exitCode = EXIT_CODES.USAGE;
      return;
    }
    throw error;
  }
  installMemoryStorage();
  const summary = runCalibration(configs, options.seeds);
  const verdict = checkThresholds(summary, calibration);
  const mark = (ok) => (ok ? 'ok' : 'MISSED');
  console.log(`Polarity Duel, CPU vs CPU, ${options.seeds} seeds per pair`);
  summary.pairs.forEach((pair, i) => {
    console.log(
      `${pair.strong} beats ${pair.weak}: ${pair.wins}/${pair.games} (${formatShare(pair.share)},`
      + ` target >= ${formatShare(calibration[pair.thresholdKey])}) ${mark(verdict.pairs[i])}`
    );
  });
  const { min, max } = calibration.pulsesPerRound;
  console.log(
    `Pulses per round: ${summary.pulsesPerRound.toFixed(2)} (target ${min} to ${max}) ${mark(verdict.pulses)}`
  );
  if (summary.stuck > 0) {
    console.error(`${summary.stuck} match(es) did not end within ${calibration.frameCap} frames`);
  }
  if (!verdict.ok || summary.stuck > 0) {
    process.exitCode = EXIT_CODES.MISSED;
  }
}

/** True when this file is the script node was started with, not a module imported by a test. */
const isEntryPoint = () => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(SCRIPT_PATH);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

if (isEntryPoint()) {
  runMain();
}
