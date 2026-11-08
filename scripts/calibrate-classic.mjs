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
 * Reports how hard Classic is for the greedy bot, outside CI (scripts/bot).
 *
 * The greedy bot plays `--seeds` Classic runs (default: calibration.runs of the campaign
 * config) with the current `sag.modes.classic` and `classic` configs, and the script prints
 * the share of runs that clear stage 1 and the share that reach stage 3 or more, against
 * the targets in TARGETS. It only prints: it never writes a config, tuning is done by hand.
 * Classic boards come from a seeded stream per stage, so the seeds vary the launcher draws.
 *
 * Usage: node scripts/calibrate-classic.mjs [--seeds <n>]
 * Bad options exit with code 2 and the usage line; a missed target exits with code 1.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { playClassic } from './bot/CampaignBot.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const USAGE = 'Usage: node scripts/calibrate-classic.mjs [--seeds <n>]';
const SEEDS_FLAG = '--seeds';
const INTEGER_PATTERN = /^\d+$/;
const EXIT_CODES = Object.freeze({ MISSED: 1, USAGE: 2 });
const FIRST_STAGE = 1;
/** Stage from which a run counts as having got far (the "3+" share). */
const FAR_STAGE = 3;
/** Spec targets: at least this share clears stage 1, less than this share reaches FAR_STAGE. */
export const TARGETS = Object.freeze({ minClearStage1: 0.7, maxReachFarStage: 0.4 });
/** Linear congruential generator (Numerical Recipes), so every run can be replayed. */
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_RANGE = 4294967296;
const PERCENT = 100;

export class UsageError extends Error {}

const loadJson = (name) => JSON.parse(fs.readFileSync(`${REPO_ROOT}configs/${name}`, 'utf8'));

function loadConfigs() {
  const configs = {
    game: applyWorldGeometry(loadJson('game.json')),
    physics: loadJson('physics.json'),
    balls: loadJson('balls.json'),
    obstacles: loadJson('obstacles.json'),
    levels: loadJson('levels.json'),
    campaign: loadJson('campaign.json'),
    audio: loadJson('audio.json'),
    flux: loadJson('flux.json')
  };
  for (const [key, value] of Object.entries(configs)) {
    configRegistry.configs.set(key, value);
  }
  return configs;
}

const SILENT_AUDIO = Object.freeze({ playEffect() {}, stopAll() {}, isMuted: () => true, setMuted() {} });

function createEngine(configs) {
  const storageManager = new StorageManager();
  storageManager.init();
  return new GameEngine({
    gameConfig: configs.game,
    physicsConfig: configs.physics,
    ballsConfig: configs.balls,
    obstaclesConfig: configs.obstacles,
    levelsConfig: configs.levels,
    campaignConfig: configs.campaign,
    campaignTuning: { levels: {} },
    fluxConfig: configs.flux,
    audioManager: SILENT_AUDIO,
    storageManager,
    onStateChange() {}
  });
}

/**
 * Reads the command line.
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
 * Shares of runs that cleared stage 1 and reached the far stage.
 * @param {Array<{stageReached: number, clearedFirst: boolean}>} results - One per run.
 * @returns {{clearStage1: number, reachFarStage: number}} Shares between 0 and 1.
 */
export function summarize(results) {
  if (results.length === 0) {
    return { clearStage1: 0, reachFarStage: 0 };
  }
  const share = (predicate) => results.filter(predicate).length / results.length;
  return {
    clearStage1: share((r) => r.clearedFirst),
    reachFarStage: share((r) => r.stageReached >= FAR_STAGE)
  };
}

/**
 * Whether a summary meets the spec targets.
 * @param {{clearStage1: number, reachFarStage: number}} summary - From summarize.
 * @returns {{clearStage1: boolean, reachFarStage: boolean, ok: boolean}}
 */
export function checkTargets(summary) {
  const clearStage1 = summary.clearStage1 >= TARGETS.minClearStage1;
  const reachFarStage = summary.reachFarStage < TARGETS.maxReachFarStage;
  return { clearStage1, reachFarStage, ok: clearStage1 && reachFarStage };
}

const formatShare = (share) => `${(share * PERCENT).toFixed(1)}%`;

/** Plays `seeds` runs of the greedy bot and returns one result per run. */
function playRuns(configs, seeds) {
  const bot = configs.campaign.generated.calibration.bot;
  let seed = bot.randomSeedBase;
  const original = Math.random;
  Math.random = () => {
    seed = (Math.imul(seed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return seed / UINT32_RANGE;
  };
  try {
    return Array.from({ length: seeds }, () => playClassic(createEngine(configs), FIRST_STAGE, bot, { stopStage: FAR_STAGE }));
  } finally {
    Math.random = original;
  }
}

function runMain() {
  const configs = loadConfigs();
  let options;
  try {
    options = parseArgs(process.argv.slice(2), configs.campaign.generated.calibration.runs);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
      process.exitCode = EXIT_CODES.USAGE;
      return;
    }
    throw error;
  }
  if (typeof GameEngine.prototype.startClassicMode !== 'function') {
    console.error('This build has no Classic mode (GameEngine.startClassicMode is missing).');
    process.exitCode = EXIT_CODES.MISSED;
    return;
  }
  const results = playRuns(configs, options.seeds);
  const summary = summarize(results);
  const verdict = checkTargets(summary);
  const mark = (ok) => (ok ? 'ok' : 'MISSED');
  console.log(`Classic, greedy bot, ${options.seeds} seeds, sag ${JSON.stringify(configs.game.sag.modes.classic)}`);
  console.log(
    `Clear stage ${FIRST_STAGE}: ${formatShare(summary.clearStage1)}`
    + ` (target >= ${formatShare(TARGETS.minClearStage1)}) ${mark(verdict.clearStage1)}`
  );
  console.log(
    `Reach stage ${FAR_STAGE}+: ${formatShare(summary.reachFarStage)}`
    + ` (target < ${formatShare(TARGETS.maxReachFarStage)}) ${mark(verdict.reachFarStage)}`
  );
  if (!verdict.ok) {
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
