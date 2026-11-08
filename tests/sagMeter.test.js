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

import { GAME_MODES } from '../src/core/Constants.js';
import { getSagSpec, isWhiff, applyTurn, getSagPhase, SAG_PHASES, SAG_STEPS } from '../src/game/SagMeter.js';

const SIZE = 5;
const SPEC = { size: SIZE, dropsPerDrain: 4, maxDrainPerTurn: 1, step: SAG_STEPS.WAVE, warnAt: 1 };
const SAG_CFG = {
  modes: {
    endless: { size: SIZE, dropsPerDrain: 4, maxDrainPerTurn: 1, step: 'wave' },
    classic: { size: 6, dropsPerDrain: 3, maxDrainPerTurn: 2, step: 'rail' }
  },
  warnAt: 1
};
const ENDLESS_CFG = { shotsBeforeWave: 7 };
const WHIFF = { removed: false, dropped: 0, frozen: false };

test('whiff matrix: match, special that hit nothing, painted, anvil, missed shot, frozen, avalanche only', () => {
  const cases = [
    ['match', { removed: true, dropped: 0, frozen: false }, false],
    ['special that hit nothing', WHIFF, true],
    ['painted something', { removed: true, dropped: 0, frozen: false }, false],
    ['anvil that crushed nothing', WHIFF, true],
    ['shot that left the board', WHIFF, true],
    ['frozen turn', { removed: false, dropped: 0, frozen: true }, false],
    ['avalanche only', { removed: false, dropped: 3, frozen: false }, false]
  ];
  for (const [label, outcome, expected] of cases) {
    assert.equal(isWhiff(outcome), expected, label);
  }
});

test('each whiff fills one segment and a match changes nothing', () => {
  assert.equal(applyTurn({ level: 1 }, WHIFF, SPEC).level, 2);
  assert.equal(applyTurn({ level: 2 }, { ...WHIFF, removed: true }, SPEC).level, 2);
});

test('a full meter lowers once and resets to zero', () => {
  let state = { level: 0 };
  let lowered = 0;
  for (let i = 0; i < SIZE; i++) {
    const result = applyTurn(state, WHIFF, SPEC);
    state = { level: result.level };
    lowered += result.lowered ? 1 : 0;
  }
  assert.equal(lowered, 1);
  assert.equal(state.level, 0);
});

test('avalanche drain is floored, capped per turn and never below zero', () => {
  const avalanche = (dropped) => ({ removed: false, dropped, frozen: false });
  assert.equal(applyTurn({ level: 3 }, avalanche(3), SPEC).drained, 0);
  assert.equal(applyTurn({ level: 3 }, avalanche(4), SPEC).level, 2);
  assert.equal(applyTurn({ level: 3 }, avalanche(40), SPEC).level, 2, 'capped at maxDrainPerTurn');
  assert.equal(applyTurn({ level: 0 }, avalanche(40), SPEC).level, 0);
});

test('warning phase starts warnAt segments before full and fires once', () => {
  assert.equal(getSagPhase(SIZE - 2, SPEC, 1), SAG_PHASES.CALM);
  assert.equal(getSagPhase(SIZE - 1, SPEC, 1), SAG_PHASES.WARN);
  assert.equal(getSagPhase(SIZE, SPEC, 1), SAG_PHASES.FULL);
  assert.equal(applyTurn({ level: SIZE - 2 }, WHIFF, SPEC).warned, true);
  assert.equal(applyTurn({ level: SIZE - 1 }, { ...WHIFF, removed: true }, SPEC).warned, false);
});

test('getSagSpec resolves modes, and falls back to the endless counter without a sag section', () => {
  assert.equal(getSagSpec(GAME_MODES.CLASSIC, SAG_CFG, ENDLESS_CFG).step, SAG_STEPS.RAIL);
  assert.equal(getSagSpec(GAME_MODES.CASCADE, SAG_CFG, ENDLESS_CFG), null);
  assert.equal(getSagSpec(GAME_MODES.CAMPAIGN, SAG_CFG, ENDLESS_CFG), null);
  const legacy = getSagSpec(GAME_MODES.ENDLESS, undefined, ENDLESS_CFG);
  assert.equal(legacy.size, ENDLESS_CFG.shotsBeforeWave);
  assert.equal(legacy.step, SAG_STEPS.WAVE);
  assert.equal(legacy.maxDrainPerTurn, 0);
  assert.ok(getSagSpec(GAME_MODES.DAILY, undefined, ENDLESS_CFG));
  assert.equal(getSagSpec(GAME_MODES.BLITZ, undefined, ENDLESS_CFG), null);
});
