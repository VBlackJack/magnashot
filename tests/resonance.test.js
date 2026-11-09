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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beatPhase,
  framesPerBeat,
  isInBeatWindow,
  isResonanceAllowed,
  offsetMsToFrames,
  resonantStrengthLoss,
  ringVisual
} from '../src/game/Resonance.js';
import { GAME_MODES } from '../src/core/Constants.js';

const STEP_MS = 1000 / 60;
const WINDOW_FRAMES = 7;
const MAX_OFFSET_MS = 200;
const BPM = 120;
const CFG = {
  versusStrengthLoss: 2,
  ring: { startScale: 1.7, idleOpacity: 0.4, windowOpacity: 1 }
};
const FPB = framesPerBeat(BPM, STEP_MS);

test('framesPerBeat converts a tempo into engine frames', () => {
  assert.ok(Math.abs(FPB - 30) < 1e-9);
  assert.ok(Math.abs(framesPerBeat(60, STEP_MS) - 60) < 1e-9);
});

test('beatPhase stays in [0, 1) and wraps negative frames', () => {
  assert.equal(beatPhase(0, FPB), 0);
  assert.ok(Math.abs(beatPhase(15, FPB) - 0.5) < 1e-9);
  assert.ok(Math.abs(beatPhase(-15, FPB) - 0.5) < 1e-9);
  assert.ok(beatPhase(29.999, FPB) < 1);
  assert.equal(beatPhase(10, 0), 0);
});

test('isInBeatWindow accepts frames on both sides of a beat and wraps around', () => {
  assert.equal(isInBeatWindow(0, 0, FPB, WINDOW_FRAMES), true);
  assert.equal(isInBeatWindow(7, 0, FPB, WINDOW_FRAMES), true);
  assert.equal(isInBeatWindow(8, 0, FPB, WINDOW_FRAMES), false);
  assert.equal(isInBeatWindow(30 - 7, 0, FPB, WINDOW_FRAMES), true);
  assert.equal(isInBeatWindow(30 - 8, 0, FPB, WINDOW_FRAMES), false);
  assert.equal(isInBeatWindow(15, 0, FPB, WINDOW_FRAMES), false);
  assert.equal(isInBeatWindow(30 * 5 + 3, 0, FPB, WINDOW_FRAMES), true);
});

test('isInBeatWindow shifts the judged frame by the calibration offset', () => {
  // A positive offset means the player is late: frame f is judged as f - offset.
  assert.equal(isInBeatWindow(12, 0, FPB, WINDOW_FRAMES), false);
  assert.equal(isInBeatWindow(12, 6, FPB, WINDOW_FRAMES), true);
  // Negative offset (early player): frame 20 is judged as 30, exactly on a beat.
  assert.equal(isInBeatWindow(20, 0, FPB, WINDOW_FRAMES), false);
  assert.equal(isInBeatWindow(20, -10, FPB, WINDOW_FRAMES), true);
  assert.equal(isInBeatWindow(5, 0, 0, WINDOW_FRAMES), false);
});

test('offsetMsToFrames rounds to frames and clamps to the maximum offset', () => {
  assert.equal(offsetMsToFrames(0, STEP_MS, MAX_OFFSET_MS), 0);
  assert.equal(offsetMsToFrames(50, STEP_MS, MAX_OFFSET_MS), 3);
  assert.equal(offsetMsToFrames(-50, STEP_MS, MAX_OFFSET_MS), -3);
  assert.equal(offsetMsToFrames(9999, STEP_MS, MAX_OFFSET_MS), 12);
  assert.equal(offsetMsToFrames(-9999, STEP_MS, MAX_OFFSET_MS), -12);
  assert.equal(offsetMsToFrames('x', STEP_MS, MAX_OFFSET_MS), 0);
});

const ALL_MODES = Object.values(GAME_MODES);
const COMPETITIVE_FLAGS = [
  { isDailyRematch: true },
  { isWeeklyFluxRun: true },
  { isSharedFluxRun: true },
  { ghostDuel: true }
];

test('isResonanceAllowed matrix: every mode with the setting on and no flag', () => {
  for (const mode of ALL_MODES) {
    const expected = mode !== GAME_MODES.DAILY;
    assert.equal(isResonanceAllowed({ mode, setting: true }), expected, mode);
  }
});

test('isResonanceAllowed matrix: setting off disables every mode', () => {
  for (const mode of ALL_MODES) {
    assert.equal(isResonanceAllowed({ mode, setting: false }), false, mode);
  }
});

test('isResonanceAllowed matrix: each competitive flag disables every mode', () => {
  for (const mode of ALL_MODES) {
    for (const flags of COMPETITIVE_FLAGS) {
      assert.equal(isResonanceAllowed({ mode, setting: true, ...flags }), false, `${mode} ${JSON.stringify(flags)}`);
    }
  }
});

test('isResonanceAllowed: versus option can turn it off and otherwise follows the setting', () => {
  assert.equal(isResonanceAllowed({ mode: GAME_MODES.VERSUS, setting: true, versusOption: false }), false);
  assert.equal(isResonanceAllowed({ mode: GAME_MODES.VERSUS, setting: true, versusOption: true }), true);
  assert.equal(isResonanceAllowed({ mode: GAME_MODES.VERSUS, setting: true }), true);
  assert.equal(isResonanceAllowed({ mode: GAME_MODES.VERSUS, setting: false, versusOption: true }), false);
  // The option only concerns versus.
  assert.equal(isResonanceAllowed({ mode: GAME_MODES.CAMPAIGN, setting: true, versusOption: false }), true);
});

test('isResonanceAllowed: unseeded Flux is on, an unknown mode is off', () => {
  assert.equal(isResonanceAllowed({ mode: GAME_MODES.FLUX, setting: true }), true);
  assert.equal(isResonanceAllowed({ mode: 'nope', setting: true }), false);
});

test('resonantStrengthLoss returns the configured loss only when Resonant', () => {
  assert.equal(resonantStrengthLoss(1, true, CFG), 2);
  assert.equal(resonantStrengthLoss(1, false, CFG), 1);
});

test('ringVisual shrinks from startScale to 1 across a beat and is solid in the window', () => {
  const opts = { offsetFrames: 0, framesPerBeat: FPB, windowFrames: WINDOW_FRAMES, cfg: CFG };
  const justOutside = ringVisual(8, opts);
  assert.equal(justOutside.inWindow, false);
  assert.ok(justOutside.radiusScale > 1.5 && justOutside.radiusScale <= 1.7);
  const mid = ringVisual(15, opts);
  assert.ok(mid.radiusScale < justOutside.radiusScale);
  const before = ringVisual(23, opts);
  assert.equal(before.inWindow, true);
  assert.equal(before.radiusScale, 1);
  assert.equal(before.opacity, CFG.ring.windowOpacity);
  assert.equal(ringVisual(15, opts).opacity, CFG.ring.idleOpacity);
});

test('ringVisual under reduced motion keeps a fixed radius and fades opacity toward the beat', () => {
  const opts = { offsetFrames: 0, framesPerBeat: FPB, windowFrames: WINDOW_FRAMES, reducedMotion: true, cfg: CFG };
  const early = ringVisual(8, opts);
  const late = ringVisual(21, opts);
  assert.equal(early.radiusScale, 1);
  assert.equal(late.radiusScale, 1);
  assert.ok(late.opacity > early.opacity);
  assert.ok(early.opacity >= CFG.ring.idleOpacity && late.opacity < CFG.ring.windowOpacity);
  assert.equal(ringVisual(0, opts).opacity, CFG.ring.windowOpacity);
});

test('ringVisual ignores the calibration offset: the ring keeps the beat clock, only the judgement shifts', () => {
  const plain = { offsetFrames: 0, framesPerBeat: FPB, windowFrames: WINDOW_FRAMES, cfg: CFG };
  const calibrated = { ...plain, offsetFrames: 6 };
  for (const frame of [0, 5, 12, 21, 29]) {
    assert.deepEqual(ringVisual(frame, calibrated), ringVisual(frame, plain), `frame ${frame}`);
  }
  assert.equal(ringVisual(12, calibrated).inWindow, false);
  assert.equal(ringVisual(3, calibrated).inWindow, true);
});
