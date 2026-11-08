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
 * Pure comparison logic for Ghost Duels. A ghost is the decoded timeline of a rival run:
 * { mode, key, cv, n, step, s: cumulative score per point, final, assists, alias }.
 * Timeline semantics (see ShotTimeline.js): sample m is the state after shot m-1, and point j
 * covers samples up to min((j + 1) * step, n). The score after k own shots is therefore the
 * ghost score at sample k + 1.
 */

const ORIGIN_SAMPLE = 1;
const ORIGIN_SCORE = 0;
const SIDE_AHEAD = 'ahead';
const SIDE_BEHIND = 'behind';
const SIDE_TIED = 'tied';
const SIGN_AHEAD = 1;
const SIGN_BEHIND = -1;
const SIGN_NONE = 0;
const OUTCOME_WON = 'won';
const OUTCOME_LOST = 'lost';
const OUTCOME_TIE = 'tie';
const ANNOUNCE_AHEAD = 'ahead';
const ANNOUNCE_BEHIND = 'behind';
const ANNOUNCE_ENDED = 'ended';
const ANNOUNCE_PASSED = 'passed';
const DEFAULT_ANNOUNCE_MIN_SHOTS = 3;

function toCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * @param {object} ghost - Decoded ghost.
 * @param {number} shots - Shots fired by the player so far.
 * @returns {number} Ghost score after the same number of shots (integer, monotone).
 */
export function ghostScoreAfterShots(ghost, shots) {
  const final = toCount(ghost?.final);
  const points = Array.isArray(ghost?.s) ? ghost.s : [];
  const n = toCount(ghost?.n);
  const step = toCount(ghost?.step) || 1;
  if (points.length === 0 || n === 0) {
    return final;
  }
  const sample = toCount(shots) + ORIGIN_SAMPLE;
  if (sample <= ORIGIN_SAMPLE) {
    return ORIGIN_SCORE;
  }
  if (sample >= n) {
    return final;
  }
  let prevSample = ORIGIN_SAMPLE;
  let prevScore = ORIGIN_SCORE;
  for (let j = 0; j < points.length; j++) {
    const x = Math.min((j + 1) * step, n);
    const y = toCount(points[j]);
    if (sample <= x) {
      if (x <= prevSample) {
        return y;
      }
      return prevScore + Math.floor(((y - prevScore) * (sample - prevSample)) / (x - prevSample));
    }
    prevSample = x;
    prevScore = y;
  }
  return final;
}

/**
 * @param {number} score - Player score.
 * @param {number} shots - Shots fired by the player (own shotTimeline.n).
 * @param {object} ghost - Decoded ghost.
 * @returns {object} { gap (absolute), side, ghostScore, ghostFinished, plus score, shots, ghostFinal }.
 */
export function compareToGhost(score, shots, ghost) {
  const own = toCount(score);
  const ownShots = toCount(shots);
  const ghostScore = ghostScoreAfterShots(ghost, ownShots);
  const diff = own - ghostScore;
  let side = SIDE_TIED;
  if (diff > 0) {
    side = SIDE_AHEAD;
  } else if (diff < 0) {
    side = SIDE_BEHIND;
  }
  return {
    gap: Math.abs(diff),
    side,
    ghostScore,
    ghostFinished: ownShots + ORIGIN_SAMPLE >= toCount(ghost?.n),
    score: own,
    shots: ownShots,
    ghostFinal: toCount(ghost?.final)
  };
}

/** @returns {object} Initial announcement state for a new duel. */
export function createDuelAnnouncementState() {
  return { lastSign: SIGN_NONE, lastFlipShot: 0, endedDone: false, passedDone: false };
}

function sideSign(side) {
  if (side === SIDE_AHEAD) {
    return SIGN_AHEAD;
  }
  return side === SIDE_BEHIND ? SIGN_BEHIND : SIGN_NONE;
}

/**
 * Decides which announcement (at most one) to make after a shot. Priority: ghost ended,
 * player passed the ghost's final score, lead flip. Ties never reset the last sign, and two
 * flips are at least `announceMinShots` shots apart.
 * @param {object} state - From createDuelAnnouncementState or a previous call.
 * @param {object} cmp - From compareToGhost.
 * @param {object} cfg - The `ghostDuel` config section.
 * @returns {object} { announcement: 'ahead'|'behind'|'ended'|'passed'|null, state }.
 */
export function nextDuelAnnouncement(state, cmp, cfg) {
  const prev = { ...createDuelAnnouncementState(), ...state };
  const minShots = cfg?.announceMinShots >= 0 ? cfg.announceMinShots : DEFAULT_ANNOUNCE_MIN_SHOTS;
  if (cmp.ghostFinished && !prev.endedDone) {
    return { announcement: ANNOUNCE_ENDED, state: { ...prev, endedDone: true } };
  }
  if (cmp.score > cmp.ghostFinal && !prev.passedDone) {
    return { announcement: ANNOUNCE_PASSED, state: { ...prev, passedDone: true } };
  }
  const sign = sideSign(cmp.side);
  if (sign === SIGN_NONE) {
    return { announcement: null, state: prev };
  }
  if (prev.lastSign === SIGN_NONE) {
    return { announcement: null, state: { ...prev, lastSign: sign, lastFlipShot: cmp.shots } };
  }
  if (sign !== prev.lastSign && cmp.shots - prev.lastFlipShot >= minShots) {
    return {
      announcement: sign === SIGN_AHEAD ? ANNOUNCE_AHEAD : ANNOUNCE_BEHIND,
      state: { ...prev, lastSign: sign, lastFlipShot: cmp.shots }
    };
  }
  return { announcement: null, state: prev };
}

/**
 * @param {number} finalScore - Player final score.
 * @param {object} ghost - Decoded ghost.
 * @returns {object} { outcome: 'won'|'lost'|'tie', gap (absolute) }.
 */
export function settleDuel(finalScore, ghost) {
  const diff = toCount(finalScore) - toCount(ghost?.final);
  let outcome = OUTCOME_TIE;
  if (diff > 0) {
    outcome = OUTCOME_WON;
  } else if (diff < 0) {
    outcome = OUTCOME_LOST;
  }
  return { outcome, gap: Math.abs(diff) };
}
