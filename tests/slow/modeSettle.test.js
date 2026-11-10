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

import { GAME_STATES } from '../../src/core/Constants.js';
import { configRegistry } from '../../src/core/ConfigRegistry.js';
import { applyWorldGeometry } from '../../src/core/WorldGeometry.js';
import { idleSettleMode, IDLE_SETTLE_MODES } from '../../scripts/bot/SettleProbe.js';

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

const SEED_COUNT = 20;
const SEED_BASE = configs.campaign.generated.calibration.settleSeedBase;
const FRAMES = configs.campaign.generated.calibration.settleFrames;
// Boss Rush waves all start from the same idle board (the Magnetar is always used, a wave only
// matters once shots are fired), so wave 1 stands for them.
const BOSS_RUSH_WAVES = [1];
// Cascade drop waves stack upward, so the margin rises with each extra wave (case 0 is the lowest).
const CASCADE_EXTRA_DROP_WAVES = [0, 1, 2, 3];

const cases = [
  ...BOSS_RUSH_WAVES.map((wave) => ({ label: `Boss Rush wave ${wave}`, mode: IDLE_SETTLE_MODES.BOSS_RUSH, wave })),
  ...CASCADE_EXTRA_DROP_WAVES.map((extraDropWaves) => ({
    label: `Cascade with ${extraDropWaves} extra drop waves`,
    mode: IDLE_SETTLE_MODES.CASCADE,
    extraDropWaves
  }))
];

for (const { label, ...options } of cases) {
  test(`${label}, left idle, settles clear of the danger warning band`, () => {
    const required = configs.game.canvas.dangerWarningMarginY;
    let worst = Infinity;
    for (let index = 0; index < SEED_COUNT; index++) {
      const result = idleSettleMode(configs, { ...options, lcgSeed: SEED_BASE + index, frames: FRAMES });
      assert.equal(result.state, GAME_STATES.PLAYING, `${label} seed ${index} ended in state ${result.state}`);
      assert.ok(result.balls > 0, `${label} seed ${index} has no sphere left`);
      if (options.mode === IDLE_SETTLE_MODES.BOSS_RUSH) {
        assert.equal(result.magnetar, true, `${label} seed ${index} has no Magnetar`);
      }
      worst = Math.min(worst, result.margin);
    }
    console.log(`${label}: minimum margin ${worst.toFixed(1)} px over ${SEED_COUNT} seeds`);
    assert.ok(worst >= required, `${label} settles ${worst.toFixed(1)} px from the line, needs ${required}`);
  });
}
