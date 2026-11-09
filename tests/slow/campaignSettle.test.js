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

import { LevelCatalog } from '../../src/game/LevelCatalog.js';
import { applyWorldGeometry } from '../../src/core/WorldGeometry.js';

const loadJson = (name) => JSON.parse(fs.readFileSync(new URL(`../../configs/${name}`, import.meta.url), 'utf8'));
const WORKER_URL = new URL('./settleWorker.mjs', import.meta.url);
/** Cores left free for the rest of the machine. */
const SPARE_CORES = 2;
const MIN_WORKERS = 1;

/** Settles every level on worker threads, one interleaved share of the ids each. */
async function settleAll(levelIds) {
  const count = Math.max(MIN_WORKERS, Math.min(levelIds.length, os.cpus().length - SPARE_CORES));
  const shares = Array.from({ length: count }, () => []);
  levelIds.forEach((id, index) => shares[index % count].push(id));
  const parts = await Promise.all(shares.map((share) => new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: { levelIds: share } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => code !== 0 && reject(new Error(`settle worker exited with code ${code}`)));
  })));
  return Object.assign({}, ...parts);
}

test('Every campaign level, left idle, settles clear of the danger warning band', async () => {
  const levelsConfig = loadJson('levels.json');
  const campaignConfig = loadJson('campaign.json');
  const gameConfig = applyWorldGeometry(loadJson('game.json'));
  const catalog = new LevelCatalog({
    levelsConfig,
    campaignConfig,
    fluxConfig: loadJson('flux.json'),
    obstaclesConfig: loadJson('obstacles.json'),
    ballRadius: loadJson('physics.json').ball.radius
  });
  const levelIds = [];
  for (let id = catalog.firstId; id <= catalog.lastId; id++) {
    levelIds.push(id);
  }
  const required = gameConfig.canvas.dangerWarningMarginY;
  const margins = await settleAll(levelIds);

  assert.equal(Object.keys(margins).length, levelIds.length, 'every level was settled');
  const sagging = levelIds
    .filter((id) => !(margins[id] >= required))
    .map((id) => `${id} (${margins[id].toFixed(1)} px)`);
  assert.deepEqual(sagging, [], `levels that settle closer than ${required} px to the danger line, idle`);
});
