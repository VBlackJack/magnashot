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
import os from 'node:os';
import { Worker } from 'node:worker_threads';

import { FLUX_FAMILIES } from '../../src/game/layouts/FluxStageGenerator.js';

const loadJson = (name) => JSON.parse(fs.readFileSync(new URL(`../../configs/${name}`, import.meta.url), 'utf8'));
const WORKER_URL = new URL('./fluxSettleWorker.mjs', import.meta.url);
/** Cores left free for the rest of the machine. */
const SPARE_CORES = 2;
const MIN_WORKERS = 1;
const RUN_COUNT = 200;
const STAGE_COUNT = 24;
/** Smallest margin a generated stage may settle to, below the 96 px of its shape (modifiers and bosses move it). */
const MIN_GENERATED_MARGIN_PX = 72;
/** A stage that settles past the danger line is lost with no shot fired. */
const LOST_MARGIN_PX = 0;
const SEED_PREFIX = 'slow-settle-';

/** Settles every run on worker threads, one interleaved share of the runs each. */
async function settleAll(runs, stageCount, frames) {
  const count = Math.max(MIN_WORKERS, Math.min(runs.length, os.cpus().length - SPARE_CORES));
  const shares = Array.from({ length: count }, () => []);
  runs.forEach((run, index) => shares[index % count].push(run));
  const parts = await Promise.all(shares.map((share) => new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: { runs: share, stageCount, frames, useTuning: true } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => code !== 0 && reject(new Error(`settle worker exited with code ${code}`)));
  })));
  return Object.assign({}, ...parts);
}

test('Flux stages, left idle, settle clear of the danger line, bosses and modifiers included', async () => {
  const fluxConfig = loadJson('flux.json');
  const { frames, settleSeedBase } = fluxConfig.shapeSettle;
  const runs = Array.from({ length: RUN_COUNT }, (_, index) => ({
    seed: `${SEED_PREFIX}${index}`,
    lcgSeed: settleSeedBase + index
  }));
  const settled = await settleAll(runs, STAGE_COUNT, frames);

  assert.equal(Object.keys(settled).length, RUN_COUNT, 'every run was settled');
  const stages = Object.entries(settled).flatMap(([seed, list]) => list.map((entry) => ({ seed, ...entry })));
  assert.equal(stages.length, RUN_COUNT * STAGE_COUNT, 'every stage was settled');

  const lowest = (list) => list.reduce((min, entry) => Math.min(min, entry.margin), Infinity);
  const generated = stages.filter((entry) => entry.family === FLUX_FAMILIES.GENERATED);
  const shipAnchors = stages.filter((entry) => entry.shapeIds.some((id) => id.includes('shipAnchor')));
  // Reported, not asserted: the hand-drawn shapes are outside the settled pool.
  console.log(
    `Flux idle settle: ${stages.length} stages, lowest margin ${lowest(stages).toFixed(1)} px ` +
      `(boss ${lowest(stages.filter((entry) => entry.isBoss)).toFixed(1)}, ` +
      `non-boss ${lowest(stages.filter((entry) => !entry.isBoss)).toFixed(1)}); ` +
      `generated ${generated.length} stages, lowest ${lowest(generated).toFixed(1)} px; ` +
      `shipAnchor ${shipAnchors.length} stages, lowest ${shipAnchors.length > 0 ? lowest(shipAnchors).toFixed(1) : 'n/a'} px`
  );

  const lost = stages.filter((entry) => !(entry.margin >= LOST_MARGIN_PX));
  assert.deepEqual(
    lost.map((entry) => `${entry.seed} stage ${entry.stage} ${entry.shapeIds[0]} (${entry.margin.toFixed(1)} px)`),
    [],
    'stages that cross the danger line, idle'
  );
  const tooLow = generated.filter((entry) => !(entry.margin >= MIN_GENERATED_MARGIN_PX));
  assert.deepEqual(
    tooLow.map((entry) => `${entry.seed} stage ${entry.stage} ${entry.shapeIds[0]} (${entry.margin.toFixed(1)} px)`),
    [],
    `generated stages that settle closer than ${MIN_GENERATED_MARGIN_PX} px to the danger line, idle`
  );
});
