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
 * Worker thread of campaignSettle.test.js: settles the campaign levels it is given, idle, with
 * the committed tuning, and posts back each level's settled margin.
 */

import fs from 'node:fs';
import { URL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

import { configRegistry } from '../../src/core/ConfigRegistry.js';
import { applyWorldGeometry } from '../../src/core/WorldGeometry.js';
import { idleSettleMargin } from '../../scripts/bot/SettleProbe.js';

const loadJson = (name) => JSON.parse(fs.readFileSync(new URL(`../../configs/${name}`, import.meta.url), 'utf8'));

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
// StorageManager reads the shared registry, as the app and the calibration script do.
for (const [key, value] of Object.entries(configs)) {
  configRegistry.configs.set(key, value);
}
const campaignTuning = loadJson('campaignTuning.json');

const margins = {};
for (const levelId of workerData.levelIds) {
  margins[levelId] = idleSettleMargin(configs, campaignTuning, levelId).margin;
}
parentPort.postMessage(margins);
