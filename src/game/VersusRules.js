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
 * Pure rules of the Polarity Duel. No DOM, no engine, no random source: every tunable is read
 * from the `cfg` argument (the `versus` section of the game config). Keys read here:
 *   attack            attack table (see computeVersusAttack)
 *   (colour polarities come from the ball palette: a Map colourId -> polarity, see physicsWorld.polarityMap)
 *   fallbackPolarity  polarity of a colour that has none
 *   threatRatio       a charge is threatening below this share of its rise left to travel
 *   guardStreakSize   neutralised charges needed for one granted special
 *   roundsToWin       rounds a player must win to take the match
 *   framesPerSecond   fixed simulation rate
 *   suddenDeath       { startSeconds, intervalSeconds }
 */

const SINGLE_BALL = 1;
const DOUBLE_BALL = 2;
const OPPOSITE_STRENGTH_LOSS = 1;
const NO_STRENGTH = 0;
const FULL_PROGRESS = 1;
const NO_PROGRESS = 0;
const FLIPPED_SIGN = -1;
const STRAIGHT_SIGN = 1;
const FIRST_BOARD = 0;
const SECOND_BOARD = 1;

/** Charge outcome names. */
export const CHARGE_OUTCOMES = Object.freeze({
  NEUTRALISED: 'neutralised',
  WEAKENED: 'weakened',
  DEFLECTED: 'deflected'
});

/** Round result names. */
export const ROUND_RESULTS = Object.freeze({
  WIN: 'win',
  REPLAY: 'replay'
});

/**
 * Pure attack of one resolved turn.
 * @param {{dropped:number, links:number, isSpecial:boolean}} turn - What the turn did.
 * @param {object} attackConfig - gameConfig.versus.attack.
 * @returns {{raw:number, sent:number, isStrong:boolean}} Raw attack, charges sent, strong flag.
 */
export function computeVersusAttack(turn, attackConfig) {
  if (turn.dropped <= 0) {
    // A match that drops nothing sends nothing, whatever the chain did.
    return { raw: 0, sent: 0, isStrong: false };
  }
  const base =
    Math.max(0, turn.dropped - attackConfig.freeDroppedSpheres) * attackConfig.dropWeight
    + turn.links * attackConfig.linkWeight;
  const raw = turn.isSpecial ? base * attackConfig.specialMultiplier : base;
  const sent = Math.min(attackConfig.maxChargesPerTurn, Math.floor(raw / attackConfig.rawPerCharge));
  return { raw, sent, isStrong: raw >= attackConfig.strongChargeRaw };
}

/**
 * Polarity of the charge caused by an avalanche of a colour.
 * @param {string|number} colorId - Colour that caused the avalanche.
 * @param {object} cfg - Versus config.
 * @param {Map<string|number, number>} polarities - Polarity of each palette colour (balls config).
 * @returns {number} +1 or -1.
 */
export function chargePolarityForColor(colorId, cfg, polarities) {
  const polarity = polarities?.get(colorId);
  return polarity === undefined || polarity === 0 ? cfg.fallbackPolarity : Math.sign(polarity);
}

/**
 * Polarity of a shot: the colour polarity, inverted when the polarity flip is armed.
 * @returns {number} +1 or -1.
 */
export function shotPolarity(colorId, flipped, cfg, polarities) {
  return chargePolarityForColor(colorId, cfg, polarities) * (flipped ? FLIPPED_SIGN : STRAIGHT_SIGN);
}

/**
 * A charged sphere rising from the defender's danger line toward the underside of the cluster.
 * @param {{polarity:number, strength:number, x:number, startY:number, targetY:number,
 *   riseFrames:number, id:(string|number)}} options
 * @returns {object} The charge, at its start height.
 */
export function createCharge({ polarity, strength, x, startY, targetY, riseFrames, id }) {
  return { id, polarity, strength, x, startY, targetY, riseFrames, y: startY };
}

/**
 * Position of a charge after a number of frames since it appeared. Pure: the charge is not changed.
 * @param {object} charge - From createCharge.
 * @param {number} frames - Frames elapsed since it appeared.
 * @returns {{y:number, progress:number, landed:boolean}}
 */
export function advanceCharge(charge, frames) {
  const raw = charge.riseFrames > 0 ? frames / charge.riseFrames : FULL_PROGRESS;
  const progress = Math.min(FULL_PROGRESS, Math.max(NO_PROGRESS, raw));
  const y = charge.startY + (charge.targetY - charge.startY) * progress;
  return { y, progress, landed: progress >= FULL_PROGRESS };
}

/** Share of the rise already travelled, from the charge's current height. */
function travelledProgress(charge) {
  const span = charge.targetY - charge.startY;
  if (span === 0) {
    return FULL_PROGRESS;
  }
  return Math.min(FULL_PROGRESS, Math.max(NO_PROGRESS, (charge.y - charge.startY) / span));
}

/**
 * True when the charge is close to landing (less than `threatRatio` of its rise is left).
 * @param {object} charge - With its current `y`.
 * @param {object} cfg - Versus config.
 */
export function isChargeThreatening(charge, cfg) {
  return FULL_PROGRESS - travelledProgress(charge) < cfg.threatRatio;
}

/**
 * Result of a projectile reaching a charge. The charge is returned as a new object.
 * Opposite polarity: strength drops, the projectile is consumed; at zero the charge shatters.
 * Same polarity: the charge is untouched and the projectile is pushed away, still flying.
 * @param {object} charge - From createCharge.
 * @param {{polarity:number}} shot - Shot polarity (see shotPolarity).
 * @returns {{outcome:string, charge:object, projectileConsumed:boolean, projectileVxFlip:boolean}}
 */
export function resolveChargeHit(charge, shot) {
  if (shot.polarity === charge.polarity) {
    return {
      outcome: CHARGE_OUTCOMES.DEFLECTED,
      charge,
      projectileConsumed: false,
      projectileVxFlip: true
    };
  }
  const strength = Math.max(NO_STRENGTH, charge.strength - OPPOSITE_STRENGTH_LOSS);
  return {
    outcome: strength === NO_STRENGTH ? CHARGE_OUTCOMES.NEUTRALISED : CHARGE_OUTCOMES.WEAKENED,
    charge: { ...charge, strength },
    projectileConsumed: true,
    projectileVxFlip: false
  };
}

/**
 * Charges inside a blast (bomb or lightning), borders included.
 * @returns {object[]} Matching charges, in input order.
 */
export function chargesInBlastRadius(charges, x, y, r) {
  return charges.filter((charge) => Math.hypot(charge.x - x, charge.y - y) <= r);
}

/**
 * Where a segment first enters a circle, as a share of the segment.
 * @returns {number|null} t in [0, 1], 0 when the start is inside; null on a miss.
 */
export function segmentCircleHitT(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) {
    return 0;
  }
  if (a === 0) {
    return null;
  }
  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** True when the segment touches the circle (aim preview stops at the first charge crossed). */
export function segmentHitsCircle(x1, y1, x2, y2, cx, cy, r) {
  return segmentCircleHitT(x1, y1, x2, y2, cx, cy, r) !== null;
}

/** Cluster balls a landed charge becomes: 1, or 2 for a strong charge. */
export function landingBalls(charge) {
  return charge.strength >= DOUBLE_BALL ? DOUBLE_BALL : SINGLE_BALL;
}

/**
 * Guard streak: every `guardStreakSize` neutralised charges grants a special.
 * @param {{streak:number}|null} state - Previous state, null at the start.
 * @param {number} neutralisedCount - Charges neutralised since the last call.
 * @param {object} cfg - Versus config.
 * @returns {{state:{streak:number}, grantSpecial:boolean, grantCount:number}}
 */
export function guardStreak(state, neutralisedCount, cfg) {
  const total = (state?.streak ?? 0) + neutralisedCount;
  const grantCount = Math.floor(total / cfg.guardStreakSize);
  return {
    state: { streak: total - grantCount * cfg.guardStreakSize },
    grantSpecial: grantCount > 0,
    grantCount
  };
}

/**
 * Fresh state of a match.
 * @returns {{roundsToWin:number, wins:number[], decided:number[], lastLoss:?object, lastResult:?object}}
 */
export function createRoundState(cfg) {
  return { roundsToWin: cfg.roundsToWin, wins: [0, 0], decided: [], lastLoss: null, lastResult: null };
}

/**
 * Records the loss of a board. A second board lost on the same frame cancels the round
 * (replay): both fell together, nobody scores. Pure: a new state is returned.
 * @param {object} roundState - From createRoundState.
 * @param {number} boardIndex - 0 or 1, the board that lost.
 * @param {number} frame - Frame of the loss.
 * @returns {object} New state; `lastResult` is {type:'win'|'replay', winner, loser}.
 */
export function applyBoardLoss(roundState, boardIndex, frame) {
  const previous = roundState.lastLoss;
  const isSimultaneous = previous !== null
    && previous.frame === frame
    && previous.boardIndex !== boardIndex
    && roundState.decided.length > 0
    && roundState.lastResult?.type === ROUND_RESULTS.WIN;
  const wins = [...roundState.wins];
  if (isSimultaneous) {
    wins[roundState.decided[roundState.decided.length - 1]] -= 1;
    return {
      ...roundState,
      wins,
      decided: roundState.decided.slice(0, -1),
      lastLoss: { boardIndex, frame },
      lastResult: { type: ROUND_RESULTS.REPLAY, winner: null, loser: null }
    };
  }
  const winner = boardIndex === FIRST_BOARD ? SECOND_BOARD : FIRST_BOARD;
  wins[winner] += 1;
  return {
    ...roundState,
    wins,
    decided: [...roundState.decided, winner],
    lastLoss: { boardIndex, frame },
    lastResult: { type: ROUND_RESULTS.WIN, winner, loser: boardIndex }
  };
}

/** True once a player holds the rounds needed to win (best of 3 with roundsToWin 2). */
export function isMatchOver(roundState) {
  return roundState.wins.some((count) => count >= roundState.roundsToWin);
}

/** Index of the match winner, null while the match is open. */
export function matchWinner(roundState) {
  const index = roundState.wins.findIndex((count) => count >= roundState.roundsToWin);
  return index < 0 ? null : index;
}

/**
 * True when a sudden-death field pulse must fire now: from the start time, then every interval.
 * @param {number} elapsedFrames - Frames since the round began.
 * @param {number|null} lastPulseFrame - Frame of the previous pulse, null before the first.
 * @param {object} cfg - Versus config.
 */
export function suddenDeathDue(elapsedFrames, lastPulseFrame, cfg) {
  const fps = cfg.framesPerSecond;
  const startFrames = cfg.suddenDeath.startSeconds * fps;
  if (elapsedFrames < startFrames) {
    return false;
  }
  if (lastPulseFrame === null || lastPulseFrame === undefined) {
    return true;
  }
  return elapsedFrames - lastPulseFrame >= cfg.suddenDeath.intervalSeconds * fps;
}
