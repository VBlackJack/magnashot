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
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/calibrate-classic.mjs', import.meta.url));
const SEEDS = '20';
/** Measured on master before Pulse landed, with Resonance off: the calibrated Classic difficulty. */
const EXPECTED_CLEAR_STAGE_1 = 'Clear stage 1: 80.0%';
const EXPECTED_REACH_STAGE_3 = 'Reach stage 3+: 15.0%';

test('Classic calibration keeps its pre-Pulse results because the bots play with Resonance off', () => {
  const run = spawnSync(process.execPath, [SCRIPT, '--seeds', SEEDS], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(EXPECTED_CLEAR_STAGE_1), run.stdout);
  assert.ok(run.stdout.includes(EXPECTED_REACH_STAGE_3), run.stdout);
});
