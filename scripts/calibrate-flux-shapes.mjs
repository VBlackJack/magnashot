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
 * Settles every generated Flux shape idle, once, and writes how far its lowest sphere stays
 * above the danger line to configs/fluxShapeTuning.json.
 *
 * A shape hanging from few anchors sags after the first frame, so a Flux stage can be lost
 * with no shot fired. Flux runs draw only the shapes whose margin reaches
 * `flux.shapeSettle.minMarginPx`; the campaign keeps drawing from all of them. The settle is
 * integer data measured offline, so every device draws the same shapes.
 * The file carries the fingerprint of everything the settle depends on, the pool hash of the
 * shapes the threshold keeps, and one integer margin per shape;
 * tests/fluxGenerator.test.js fails when the file no longer matches the configs. Changing the
 * pool or the threshold requires a `ghostDuel.contentVersion.flux` bump.
 *
 * Usage: node scripts/calibrate-flux-shapes.mjs [--workers <n>] [--dry-run]
 * --dry-run prints the summary and writes nothing. Bad options exit with code 2 and the usage
 * line; a worker that fails exits with code 1 and nothing is written.
 */

import fs from 'node:fs';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import {
  fluxPoolHash,
  fluxShapeTuningFingerprint,
  fluxShapeTuningId,
  idleSettleFluxShape,
  listFluxShapesToSettle
} from './bot/SettleProbe.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TUNING_PATH = `${REPO_ROOT}configs/fluxShapeTuning.json`;
const DRY_RUN_FLAG = '--dry-run';
const WORKERS_FLAG = '--workers';
const USAGE = 'Usage: node scripts/calibrate-flux-shapes.mjs [--workers <n>] [--dry-run]';
const INTEGER_PATTERN = /^\d+$/;
const EXIT_CODES = Object.freeze({ FAILURE: 1, USAGE: 2 });
const MIN_WORKERS = 1;
/** Workers left free for the rest of the machine. */
const SPARE_CORES = 2;
const JSON_INDENT = '  ';
const PERCENT = 100;
const SUMMARY_DIGITS = 1;
const MS_PER_SECOND = 1000;

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
  // StorageManager reads the shared registry, as the app does.
  for (const [key, value] of Object.entries(configs)) {
    configRegistry.configs.set(key, value);
  }
  return configs;
}

function parseOptions(argv) {
  const options = { workers: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === DRY_RUN_FLAG) {
      options.dryRun = true;
    } else if (argv[i] === WORKERS_FLAG && INTEGER_PATTERN.test(argv[i + 1] ?? '')) {
      options.workers = Math.max(MIN_WORKERS, Number(argv[++i]));
    } else {
      return null;
    }
  }
  return options;
}

/** Worker thread: settles its interleaved share of the shapes and posts back [index, margin] pairs. */
function runWorker() {
  const configs = loadConfigs();
  const shapes = listFluxShapesToSettle(configs.flux);
  const results = workerData.indices.map((index) => [index, idleSettleFluxShape(configs, shapes[index]).margin]);
  parentPort.postMessage(results);
}

function settleOnWorkers(count, workerCount) {
  const shares = Array.from({ length: workerCount }, () => []);
  for (let index = 0; index < count; index++) {
    shares[index % workerCount].push(index);
  }
  return Promise.all(shares.map((indices) => new Promise((resolve, reject) => {
    const worker = new Worker(SCRIPT_PATH, { workerData: { indices } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => code !== 0 && reject(new Error(`settle worker exited with code ${code}`)));
  })));
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    console.error(USAGE);
    process.exit(EXIT_CODES.USAGE);
  }
  const startedAt = Date.now();
  const configs = loadConfigs();
  const settle = configs.flux.shapeSettle;
  const shapes = listFluxShapesToSettle(configs.flux);
  const workerCount = Math.max(MIN_WORKERS, Math.min(shapes.length, options.workers ?? os.cpus().length - SPARE_CORES));
  console.log(`Settling ${shapes.length} generated Flux shapes for ${settle.frames} frames on ${workerCount} workers...`);

  const rawMargins = new Array(shapes.length);
  for (const part of await settleOnWorkers(shapes.length, workerCount)) {
    for (const [index, margin] of part) {
      rawMargins[index] = margin;
    }
  }
  if (rawMargins.some((margin) => !Number.isFinite(margin))) {
    console.error('Some shapes were not settled; nothing written.');
    process.exit(EXIT_CODES.FAILURE);
  }

  // Whole pixels, rounded down: a shape is never credited with more room than it has.
  const margins = {};
  shapes.forEach((params, index) => {
    margins[fluxShapeTuningId(params)] = Math.floor(rawMargins[index]);
  });
  const accepted = Object.keys(margins).filter((id) => margins[id] >= settle.minMarginPx);
  const tuning = {
    fingerprint: fluxShapeTuningFingerprint(configs),
    frames: settle.frames,
    poolHash: fluxPoolHash(accepted),
    margins
  };
  const seconds = ((Date.now() - startedAt) / MS_PER_SECOND).toFixed(SUMMARY_DIGITS);
  const share = ((accepted.length / shapes.length) * PERCENT).toFixed(SUMMARY_DIGITS);
  console.log(`${accepted.length} of ${shapes.length} shapes keep ${settle.minMarginPx} px or more (${share}%), in ${seconds} s.`);
  console.log(`fingerprint ${tuning.fingerprint}, pool hash ${tuning.poolHash}`);
  if (options.dryRun) {
    return;
  }
  fs.writeFileSync(TUNING_PATH, `${JSON.stringify(tuning, null, JSON_INDENT)}\n`);
  console.log(`Wrote ${TUNING_PATH}`);
}

if (isMainThread) {
  main().catch((error) => {
    console.error(error);
    process.exit(EXIT_CODES.FAILURE);
  });
} else {
  runWorker();
}
