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

import { GAME_MODES } from '../core/Constants.js';

/*
 * Resonance rules: pure functions, no DOM and no random draw. The beat clock is the engine
 * frame counter, so every judgement is a function of frames and replays the same way.
 */

const MS_PER_MINUTE = 60000;
const PHASE_ORIGIN = 0;
const FULL_PHASE = 1;
const UNIT_SCALE = 1;
// Absorbs float rounding in the phase maths so a frame exactly at the window edge counts.
const FRAME_EPSILON = 1e-9;

/**
 * Position inside the current beat, from 0 (on the beat) up to but excluding 1.
 * Negative frames wrap, so an offset-shifted frame stays in range.
 */
export function beatPhase(frame, framesPerBeat) {
  if (!(framesPerBeat > 0)) {
    return PHASE_ORIGIN;
  }
  const wrapped = ((frame % framesPerBeat) + framesPerBeat) % framesPerBeat;
  return wrapped / framesPerBeat;
}

/** Frames between two beats for a tempo, given the fixed engine step in milliseconds. */
export function framesPerBeat(bpm, stepMs) {
  return MS_PER_MINUTE / bpm / stepMs;
}

/** Converts a calibration offset to whole frames, clamped to the allowed range. */
export function offsetMsToFrames(offsetMs, stepMs, maxOffsetMs) {
  const clamped = Math.max(-maxOffsetMs, Math.min(maxOffsetMs, Number(offsetMs) || 0));
  return Math.round(clamped / stepMs);
}

/**
 * Circular distance in frames from a frame (shifted back by the calibration offset) to the
 * nearest beat, so a frame just before a beat and one just after it are both close.
 */
function distanceToNearestBeat(frame, offsetFrames, framesPerBeatValue) {
  const phase = beatPhase(frame - offsetFrames, framesPerBeatValue);
  const phaseFrames = phase * framesPerBeatValue;
  return Math.min(phaseFrames, framesPerBeatValue - phaseFrames);
}

/** True when the offset-shifted frame lies within windowFrames of a beat. */
export function isInBeatWindow(frame, offsetFrames, framesPerBeatValue, windowFrames) {
  if (!(framesPerBeatValue > 0)) {
    return false;
  }
  return distanceToNearestBeat(frame, offsetFrames, framesPerBeatValue) <= windowFrames + FRAME_EPSILON;
}

/**
 * Whether Resonance applies to a run at all. The setting and the match option can switch it
 * off; the competitive runs (Daily, Weekly Flux, shared Flux seed, Ghost Duel) never use it
 * whatever the setting says, so their scores stay comparable.
 *
 * @param {object} params
 * @param {string} params.mode Game mode id.
 * @param {boolean} [params.isDailyRematch] Daily rematch run.
 * @param {boolean} [params.isWeeklyFluxRun] Weekly Flux run.
 * @param {boolean} [params.isSharedFluxRun] Flux run from a shared seed link.
 * @param {boolean} [params.ghostDuel] Ghost Duel run.
 * @param {boolean} [params.versusOption] Versus match option; undefined follows the setting.
 * @param {boolean} params.setting Player's Resonance setting.
 */
export function isResonanceAllowed({
  mode,
  isDailyRematch = false,
  isWeeklyFluxRun = false,
  isSharedFluxRun = false,
  ghostDuel = false,
  versusOption,
  setting
} = {}) {
  if (!setting) {
    return false;
  }
  if (mode === GAME_MODES.DAILY || isDailyRematch || isWeeklyFluxRun || isSharedFluxRun || ghostDuel) {
    return false;
  }
  if (mode === GAME_MODES.VERSUS && versusOption === false) {
    return false;
  }
  return Object.values(GAME_MODES).includes(mode);
}

/** Strength a charge loses from a hit: the configured amount when Resonant, else the base. */
export function resonantStrengthLoss(base, isResonant, cfg) {
  return isResonant ? cfg.versusStrengthLoss : base;
}

/**
 * Beat ring state for one frame.
 *
 * Normally the ring shrinks from ring.startScale to 1 over each beat and is solid and fully
 * opaque while the window is open. With reduced motion the radius stays fixed and only the
 * opacity rises toward the beat.
 *
 * @returns {{radiusScale: number, inWindow: boolean, opacity: number}}
 */
export function ringVisual(frame, { offsetFrames = 0, framesPerBeat: fpb, windowFrames, reducedMotion = false, cfg }) {
  const inWindow = isInBeatWindow(frame, offsetFrames, fpb, windowFrames);
  const phase = beatPhase(frame - offsetFrames, fpb);
  const untilBeat = phase === PHASE_ORIGIN ? PHASE_ORIGIN : FULL_PHASE - phase;
  const ring = cfg.ring;
  if (inWindow) {
    return { radiusScale: UNIT_SCALE, inWindow, opacity: ring.windowOpacity };
  }
  if (reducedMotion) {
    const opacity = ring.idleOpacity + (ring.windowOpacity - ring.idleOpacity) * (FULL_PHASE - untilBeat);
    return { radiusScale: UNIT_SCALE, inWindow, opacity };
  }
  return {
    radiusScale: UNIT_SCALE + (ring.startScale - UNIT_SCALE) * untilBeat,
    inWindow,
    opacity: ring.idleOpacity
  };
}
