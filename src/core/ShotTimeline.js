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

/**
 * Compact outcome-only timeline of a run (score and spheres left after each sampled shot).
 * Only outcomes are stored, never inputs. Shape:
 * { v, mode, c: 0|1 (1 = complete), n: samples taken, step: samples per point (power of 2),
 *   s: score per point (non-decreasing), b: spheres left per point }.
 */

const TIMELINE_MODES = Object.freeze(['daily', 'flux']);
const COMPLETE_FLAG = 1;
const INCOMPLETE_FLAG = 0;
const INITIAL_STEP = 1;
const STEP_GROWTH = 2;
const DEFAULT_FORMAT_VERSION = 1;
const DEFAULT_MAX_POINTS = 120;

function getFormatVersion(cfg) {
  return cfg?.formatVersion ?? DEFAULT_FORMAT_VERSION;
}

function getMaxPoints(cfg) {
  return cfg?.maxPoints > 0 ? cfg.maxPoints : DEFAULT_MAX_POINTS;
}

function toCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER) : 0;
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPowerOfTwo(value) {
  return Number.isSafeInteger(value) && value >= INITIAL_STEP && (value & (value - 1)) === 0;
}

/**
 * @param {string} [mode] - "daily" or "flux".
 * @param {object} [cfg] - The `shotTimeline` section of configs/game.json.
 * @returns {object} An empty, incomplete timeline.
 */
export function createShotTimeline(mode = TIMELINE_MODES[0], cfg = null) {
  return { v: getFormatVersion(cfg), mode, c: INCOMPLETE_FLAG, n: 0, step: INITIAL_STEP, s: [], b: [] };
}

/** Keeps the later point of each consecutive pair and doubles the step. */
function compressTimeline(tl) {
  const s = [];
  const b = [];
  for (let i = 0; i < tl.s.length; i += STEP_GROWTH) {
    const last = Math.min(i + STEP_GROWTH - 1, tl.s.length - 1);
    s.push(tl.s[last]);
    b.push(tl.b[last]);
  }
  tl.s = s;
  tl.b = b;
  tl.step *= STEP_GROWTH;
}

/**
 * Records one sample (a real post-shot state). Consecutive samples fold into one point of
 * `step` samples that keeps the last values; when the point list is full it is halved.
 * Mutates and returns the timeline.
 * @param {object} tl - Timeline from createShotTimeline.
 * @param {number} score - Score after the shot.
 * @param {number} ballsLeft - Spheres left after the shot.
 * @param {object} cfg - The `shotTimeline` section of configs/game.json.
 * @returns {object} The same timeline.
 */
export function appendTimelineSample(tl, score, ballsLeft, cfg) {
  const previousScore = tl.s.length > 0 ? tl.s[tl.s.length - 1] : 0;
  const cleanScore = Math.max(previousScore, toCount(score));
  const cleanBalls = toCount(ballsLeft);
  const startsNewPoint = tl.n % tl.step === 0;
  tl.n += 1;
  if (!startsNewPoint) {
    tl.s[tl.s.length - 1] = cleanScore;
    tl.b[tl.b.length - 1] = cleanBalls;
    return tl;
  }
  if (tl.s.length >= getMaxPoints(cfg)) {
    compressTimeline(tl);
  }
  tl.s.push(cleanScore);
  tl.b.push(cleanBalls);
  return tl;
}

/**
 * @param {object} tl - Timeline from createShotTimeline.
 * @returns {object} A copy flagged complete (written at game over).
 */
export function markTimelineComplete(tl) {
  return { ...tl, s: [...tl.s], b: [...tl.b], c: COMPLETE_FLAG };
}

/**
 * Validates an untrusted timeline (storage or snapshot).
 * @param {unknown} raw - Candidate value.
 * @param {object} cfg - The `shotTimeline` section of configs/game.json.
 * @returns {object|null} A clean copy, or null when anything is invalid.
 */
export function normalizeShotTimeline(raw, cfg) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  if (raw.v !== getFormatVersion(cfg) || !TIMELINE_MODES.includes(raw.mode)) {
    return null;
  }
  if (raw.c !== COMPLETE_FLAG && raw.c !== INCOMPLETE_FLAG) {
    return null;
  }
  if (!isCount(raw.n) || !isPowerOfTwo(raw.step)) {
    return null;
  }
  if (!Array.isArray(raw.s) || !Array.isArray(raw.b) || raw.s.length !== raw.b.length) {
    return null;
  }
  if (raw.s.length > getMaxPoints(cfg)) {
    return null;
  }
  if (!raw.s.every(isCount) || !raw.b.every(isCount)) {
    return null;
  }
  for (let i = 1; i < raw.s.length; i++) {
    if (raw.s[i] < raw.s[i - 1]) {
      return null;
    }
  }
  return { v: raw.v, mode: raw.mode, c: raw.c, n: raw.n, step: raw.step, s: [...raw.s], b: [...raw.b] };
}
