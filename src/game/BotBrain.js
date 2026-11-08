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
 * Pure decision logic of the bots: where to aim and which ball to shoot. It lives in the
 * shipped game so the versus CPU opponent can reuse it. Randomness (aim jitter) comes from
 * an injected `rng` so a seeded stream makes every decision reproducible.
 *
 * - greedy: aims the loaded color where most spheres of that color sit, never touches a
 *   special ball. It sets the floor: a level it cannot win gets more shots.
 * - arsenal: reads the aim preview the player sees (what a shot destroys and drops) for
 *   the loaded color and for every special ball in stock, and equips a special when it
 *   clearly beats the best color shot. It sets the star thresholds.
 */

import { SPECIAL_TYPES } from '../core/Constants.js';
import { predictImpact, truncateAimAtCharges } from './ImpactPreview.js';
import { pickRocketTargets } from './SpecialBallController.js';
import { shotPolarity } from './VersusRules.js';

export const BOT_POLICIES = Object.freeze({ GREEDY: 'greedy', ARSENAL: 'arsenal' });

/** Aim angles the bot tries, from right to left across the upper half-plane. */
function sampleAngles(bot) {
  return Array.from(
    { length: bot.aimSamples + 1 },
    (_, i) => -Math.PI * (bot.aimArcStart + (bot.aimArcSpan * i) / bot.aimSamples)
  );
}

/** Sum of +sameColorScore / +otherColorScore over the spheres around a point. */
function neighborhoodScore(engine, bot, reach, end, colorId) {
  let score = 0;
  for (const ball of engine.physicsWorld.balls) {
    if (Math.hypot(ball.x - end.x, ball.y - end.y) < reach) {
      score += ball.colorId === colorId ? bot.sameColorScore : bot.otherColorScore;
    }
  }
  return score;
}

/**
 * Scan of the greedy bot: aims where the most spheres of the loaded color sit around the
 * end of the trajectory. One yield per angle tried, so a caller can spread the scan.
 */
function* scanGreedy(engine, bot, reach, rng, out) {
  let bestScore = -Infinity;
  out.angle = null;
  for (const angle of sampleAngles(bot)) {
    engine.updateAimFromAngle(angle);
    const end = engine.aimPoints.at(-1);
    if (end) {
      const score = rng() * bot.aimJitter + neighborhoodScore(engine, bot, reach, end, engine.currentBall.colorId);
      if (score > bestScore) {
        bestScore = score;
        out.angle = angle;
      }
    }
    yield;
  }
}

/** Aims where the most spheres of the loaded color sit around the end of the trajectory. */
export function pickGreedyAngle(engine, bot, reach, rng = Math.random) {
  const out = { angle: null };
  for (const unused of scanGreedy(engine, bot, reach, rng, out)) {
    void unused;
  }
  return out.angle;
}

/**
 * What the loaded ball would take off the board along the current aim, as spheres:
 * those it destroys, plus the ones that drop after, weighted by `avalancheWeight`. A
 * freeze destroys nothing and is worth `freezeValuePerSphere` for each sphere it holds.
 */
export function shotValue(engine, arsenal) {
  const points = engine.aimPoints;
  const end = points.at(-1);
  if (!end) {
    return 0;
  }
  const ball = engine.currentBall;
  const physicsWorld = engine.physicsWorld;
  let destroyedIds;
  if (ball.specialType === SPECIAL_TYPES.ROCKET) {
    const specs = engine.ballsConfig.specialTypes[SPECIAL_TYPES.ROCKET];
    destroyedIds = new Set(pickRocketTargets(end, physicsWorld.balls, specs.rocketCount).map((target) => target.id));
  } else {
    const impact = predictImpact({
      points,
      currentBall: ball,
      physicsWorld,
      endX: end.x,
      endY: end.y,
      blastMult: engine.getBlastRadiusMultiplier(),
      specialTypes: engine.ballsConfig.specialTypes,
      matchMinCount: engine.gameConfig.defaults.matchMinCount
    });
    if (ball.specialType === SPECIAL_TYPES.FREEZE) {
      return impact.highlight.length * arsenal.freezeValuePerSphere;
    }
    destroyedIds = impact.destroyedIds;
  }
  if (destroyedIds.size === 0) {
    return 0;
  }
  return destroyedIds.size + physicsWorld.findDetachedIfRemoved(destroyedIds).length * arsenal.avalancheWeight;
}

/**
 * Scan of the best angle for the loaded color: the greedy neighborhood score, plus what the
 * aim preview says the shot takes off now. Fills out.color with {angle, value}, value being
 * the preview part alone.
 */
function* scanArsenalColor(engine, bot, reach, rng, out) {
  const arsenal = bot.arsenal;
  out.color = { angle: null, value: 0 };
  let bestScore = -Infinity;
  for (const angle of sampleAngles(bot)) {
    engine.updateAimFromAngle(angle);
    const end = engine.aimPoints.at(-1);
    if (end) {
      const value = shotValue(engine, arsenal);
      const score = rng() * bot.aimJitter
        + neighborhoodScore(engine, bot, reach, end, engine.currentBall.colorId)
        + value * arsenal.colorPreviewWeight;
      if (score > bestScore) {
        bestScore = score;
        out.color = { angle, value };
      }
    }
    yield;
  }
}

/**
 * Scan of the best special ball in stock and its angle, by preview value. The launcher
 * holds the real ball between two yields: a probe ball stands in for the special only
 * while one angle is evaluated, so the trajectory bends as it would.
 */
function* scanSpecials(engine, bot, out) {
  const arsenal = bot.arsenal;
  out.special = null;
  const angles = sampleAngles(bot);
  for (const [specialType, count] of Object.entries(engine.specialInventory)) {
    if (count <= 0) {
      continue;
    }
    const probe = engine.createRandomLauncherBall(specialType);
    for (const angle of angles) {
      const loaded = engine.currentBall;
      engine.currentBall = probe;
      let value;
      try {
        engine.updateAimFromAngle(angle);
        value = shotValue(engine, arsenal);
      } finally {
        engine.currentBall = loaded;
      }
      if (!out.special || value > out.special.value) {
        out.special = { specialType, angle, value };
      }
      yield;
    }
  }
}

/**
 * Scan of the arsenal bot: a special replaces the color shot when it takes off at least
 * `specialMinValue` spheres and `specialMinGain` more than the color shot; once the shots
 * left no longer outnumber the specials in stock, any gain is enough.
 */
function* scanArsenal(engine, bot, reach, rng, out) {
  yield* scanArsenalColor(engine, bot, reach, rng, out);
  yield* scanSpecials(engine, bot, out);
  const arsenal = bot.arsenal;
  const { color, special } = out;
  out.plan = { angle: color.angle, specialType: null };
  if (special) {
    const specialsLeft = Object.values(engine.specialInventory).reduce((sum, count) => sum + Math.max(0, count), 0);
    const isEndgame = engine.shotsRemaining <= specialsLeft;
    const minGain = isEndgame ? 0 : arsenal.specialMinGain;
    if (special.value >= arsenal.specialMinValue && special.value > color.value + minGain) {
      out.plan = { angle: special.angle, specialType: special.specialType };
    }
  }
}

/**
 * The arsenal bot's next shot.
 * @param {() => number} [rng] - Random stream in [0, 1) for the aim jitter.
 * @returns {{angle: number|null, specialType: string|null}}
 */
export function planArsenalShot(engine, bot, reach, rng = Math.random) {
  const out = {};
  for (const unused of scanArsenal(engine, bot, reach, rng, out)) {
    void unused;
  }
  return out.plan;
}

/**
 * A shot decision that can be computed a few angles per call, so a CPU opponent spreads
 * the aim search over its think time instead of stalling one frame.
 * @param {object} engine - The board the bot plays.
 * @param {object} bot - Bot tuning (calibration.bot, possibly with its own aimSamples).
 * @param {number} reach - Neighborhood radius in logical pixels.
 * @param {() => number} rng - Random stream in [0, 1).
 * @param {string} policy - One of BOT_POLICIES.
 * @returns {{step: (angles?: number) => boolean, result: () => {angle: number|null, specialType: string|null}}}
 *   step() evaluates up to `angles` angles and returns true once the scan is complete.
 */
export function createShotPlanner(engine, bot, reach, rng, policy) {
  const out = {};
  const isArsenal = policy === BOT_POLICIES.ARSENAL;
  const scan = isArsenal ? scanArsenal(engine, bot, reach, rng, out) : scanGreedy(engine, bot, reach, rng, out);
  let isDone = false;
  return {
    step(angles = Infinity) {
      for (let i = 0; i < angles && !isDone; i++) {
        isDone = scan.next().done;
      }
      return isDone;
    },
    result() {
      return isArsenal ? out.plan : { angle: out.angle, specialType: null };
    }
  };
}

/**
 * Angle evaluations a full scan takes, to size the part of the think time spent scanning.
 * @returns {number}
 */
export function countPlannerWork(engine, bot, policy) {
  const perPass = bot.aimSamples + 1;
  if (policy !== BOT_POLICIES.ARSENAL) {
    return perPass;
  }
  const stocked = Object.values(engine.specialInventory).filter((count) => count > 0).length;
  return perPass * (1 + stocked);
}

/**
 * Picks the charge a CPU wants to stop: among the charges close to landing, the one nearest
 * to landing that a seeded roll against `chance` selected. A charge is rolled once.
 * @param {object[]} charges - engine.versus.charges.
 * @param {Map<number, boolean>} decided - Roll results by charge id, kept by the caller.
 * @param {number} chance - Probability in [0, 1] to answer a threatening charge.
 * @param {() => number} rng - Random stream in [0, 1).
 * @returns {object|null}
 */
export function pickGuardCharge(charges, decided, chance, rng) {
  let chosen = null;
  for (const charge of charges) {
    if (!charge.threatening) {
      continue;
    }
    if (!decided.has(charge.id)) {
      decided.set(charge.id, rng() < chance);
    }
    if (decided.get(charge.id) && (!chosen || charge.progress > chosen.progress)) {
      chosen = charge;
    }
  }
  return chosen;
}

/**
 * Looks for an aim angle that sends the loaded color ball through a charge with the opposite
 * polarity. With `canFlip` a same-polarity ball may be flipped first. The aim preview of
 * the engine is the judge, so the curve of a flipped shot is accounted for.
 * @param {object} engine - A versus board.
 * @param {object} charge - The charge to stop.
 * @param {boolean} canFlip - Whether the CPU may flip the polarity of the shot.
 * @returns {{angle: number, flip: boolean}|null} The shot, null when none reaches the charge.
 */
export function planGuardShot(engine, charge, canFlip) {
  const ball = engine.currentBall;
  if (!ball || ball.specialType || !engine.versus) {
    return null;
  }
  const cfg = engine.gameConfig.versus;
  const canvasCfg = engine.gameConfig.canvas;
  const flipNeeded = shotPolarity(ball.colorId, engine.isPolarityFlipped, cfg) === charge.polarity;
  if (flipNeeded && !canFlip) {
    return null;
  }
  const wasFlipped = engine.isPolarityFlipped;
  const hitRadius = engine.getChargeRadius() + engine.physicsConfig.ball.radius;
  const direct = Math.atan2(charge.y - canvasCfg.launcherY, charge.x - canvasCfg.launcherX);
  let found = null;
  try {
    engine.isPolarityFlipped = flipNeeded ? !wasFlipped : wasFlipped;
    for (const offset of cfg.guardAimOffsetsRad) {
      const angle = Math.max(-canvasCfg.maxAimAngleRad, Math.min(-canvasCfg.minAimAngleRad, direct + offset));
      engine.updateAimFromAngle(angle);
      const cut = truncateAimAtCharges(engine.aimPoints, engine.versus.charges, hitRadius);
      const shot = shotPolarity(ball.colorId, engine.isPolarityFlipped, cfg);
      if (cut.hit && cut.hit.charge.polarity !== shot) {
        found = { angle, flip: flipNeeded };
        break;
      }
    }
  } finally {
    engine.isPolarityFlipped = wasFlipped;
    engine.updateAimFromAngle(engine.aimAngle);
  }
  return found;
}
