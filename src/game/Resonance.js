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

/** Why Resonance is off on a board; null from getResonanceBlock means it is live. */
export const RESONANCE_BLOCKS = Object.freeze({
  SETTING: 'setting',
  COMPETITIVE: 'competitive',
  RULESET: 'ruleset',
  OPTION: 'option',
  LOCKED: 'locked'
});

/**
 * The reason Resonance is off for a run, or null when it is live. The setting and the match
 * option can switch it off; the competitive runs (Daily, Weekly Flux, shared Flux seed, Ghost
 * Duel) never use it whatever the setting says, so their scores stay comparable; Classic
 * keeps its own ruleset; and solo boards wait for the campaign unlock (duel boards ignore it).
 *
 * @param {object} params
 * @param {string} params.mode Game mode id (a duel board reports Versus).
 * @param {boolean} [params.isDailyRematch] Daily rematch run.
 * @param {boolean} [params.isWeeklyFluxRun] Weekly Flux run.
 * @param {boolean} [params.isSharedFluxRun] Flux run from a shared seed link.
 * @param {boolean} [params.ghostDuel] Ghost Duel run.
 * @param {boolean} [params.versusOption] Versus match option; undefined follows the setting.
 * @param {boolean} params.setting Player's Resonance setting.
 * @param {boolean} [params.isUnlocked] Whether the campaign unlock is reached (solo boards).
 * @returns {string|null}
 */
export function getResonanceBlock({
  mode,
  isDailyRematch = false,
  isWeeklyFluxRun = false,
  isSharedFluxRun = false,
  ghostDuel = false,
  versusOption,
  setting,
  isUnlocked = true
} = {}) {
  const isVersus = mode === GAME_MODES.VERSUS;
  if (isVersus && versusOption === false) {
    return RESONANCE_BLOCKS.OPTION;
  }
  if (!setting) {
    return RESONANCE_BLOCKS.SETTING;
  }
  if (mode === GAME_MODES.DAILY || isDailyRematch || isWeeklyFluxRun || isSharedFluxRun || ghostDuel) {
    return RESONANCE_BLOCKS.COMPETITIVE;
  }
  if (mode === GAME_MODES.CLASSIC || mode === GAME_MODES.PUZZLE || !Object.values(GAME_MODES).includes(mode)) {
    return RESONANCE_BLOCKS.RULESET;
  }
  if (!isVersus && !isUnlocked) {
    return RESONANCE_BLOCKS.LOCKED;
  }
  return null;
}

/** Whether Resonance applies to a run at all (see getResonanceBlock). */
export function isResonanceAllowed(params = {}) {
  return getResonanceBlock(params) === null;
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
export function ringVisual(frame, { framesPerBeat: fpb, windowFrames, reducedMotion = false, cfg }) {
  // The ring runs on the raw beat clock: the calibration offset only shifts the shot judgement.
  const inWindow = isInBeatWindow(frame, 0, fpb, windowFrames);
  const phase = beatPhase(frame, fpb);
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

/**
 * Median of the signed tap deviations (a tap after the beat is positive), clamped to the
 * allowed offset and rounded to whole milliseconds. Null when there is nothing to measure.
 * The median ignores a stray tap that a mean would follow.
 *
 * @param {number[]} deviationsMs Signed deviations of the taps from the pulses, in ms.
 * @param {number} maxOffsetMs Largest offset magnitude allowed.
 * @returns {number|null}
 */
export function medianOffsetMs(deviationsMs, maxOffsetMs) {
  const values = deviationsMs.filter(Number.isFinite).sort((a, b) => a - b);
  if (values.length === 0) {
    return null;
  }
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return Math.round(Math.max(-maxOffsetMs, Math.min(maxOffsetMs, median)));
}

/**
 * Signed distance in ms from a tap to the nearest pulse of a regular pulse train.
 * @param {number} tapMs Tap time.
 * @param {number} firstBeatMs Time of the first pulse.
 * @param {number} beatMs Time between two pulses.
 */
export function tapDeviationMs(tapMs, firstBeatMs, beatMs) {
  const sinceFirst = tapMs - firstBeatMs;
  const nearest = Math.round(sinceFirst / beatMs);
  return sinceFirst - nearest * beatMs;
}

/**
 * Highest of the intensity sources, kept in [0, 1]. Each source is already a share of its
 * own scale; the music follows whichever pressure is greatest.
 * @param {number[]} sources
 */
export function combineIntensity(sources) {
  return sources.reduce((top, value) => Math.max(top, Math.max(0, Math.min(1, Number(value) || 0))), 0);
}
