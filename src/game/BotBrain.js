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
import { predictImpact } from './ImpactPreview.js';
import { pickRocketTargets } from './SpecialBallController.js';

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

/** Aims where the most spheres of the loaded color sit around the end of the trajectory. */
export function pickGreedyAngle(engine, bot, reach, rng = Math.random) {
  let bestAngle = null;
  let bestScore = -Infinity;
  for (const angle of sampleAngles(bot)) {
    engine.updateAimFromAngle(angle);
    const end = engine.aimPoints.at(-1);
    if (!end) {
      continue;
    }
    const score = rng() * bot.aimJitter + neighborhoodScore(engine, bot, reach, end, engine.currentBall.colorId);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  return bestAngle;
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
 * Best angle for the loaded color: the greedy neighborhood score, plus what the aim
 * preview says the shot takes off now.
 * @returns {{angle: number|null, value: number}} value is the preview part alone.
 */
function pickArsenalColorShot(engine, bot, reach, angles, rng) {
  const arsenal = bot.arsenal;
  let best = { angle: null, value: 0 };
  let bestScore = -Infinity;
  for (const angle of angles) {
    engine.updateAimFromAngle(angle);
    const end = engine.aimPoints.at(-1);
    if (!end) {
      continue;
    }
    const value = shotValue(engine, arsenal);
    const score = rng() * bot.aimJitter
      + neighborhoodScore(engine, bot, reach, end, engine.currentBall.colorId)
      + value * arsenal.colorPreviewWeight;
    if (score > bestScore) {
      bestScore = score;
      best = { angle, value };
    }
  }
  return best;
}

/** Best special ball in stock and its angle, by preview value; null with none in stock. */
function pickSpecialShot(engine, arsenal, angles) {
  const loaded = engine.currentBall;
  let best = null;
  try {
    for (const [specialType, count] of Object.entries(engine.specialInventory)) {
      if (count <= 0) {
        continue;
      }
      // A probe ball stands in for the special so the trajectory bends as it would.
      engine.currentBall = engine.createRandomLauncherBall(specialType);
      for (const angle of angles) {
        engine.updateAimFromAngle(angle);
        const value = shotValue(engine, arsenal);
        if (!best || value > best.value) {
          best = { specialType, angle, value };
        }
      }
    }
  } finally {
    engine.currentBall = loaded;
  }
  return best;
}

/**
 * The arsenal bot's next shot. A special replaces the color shot when it takes off at
 * least `specialMinValue` spheres and `specialMinGain` more than the color shot; once
 * the shots left no longer outnumber the specials in stock, any gain is enough.
 * @param {() => number} [rng] - Random stream in [0, 1) for the aim jitter.
 * @returns {{angle: number|null, specialType: string|null}}
 */
export function planArsenalShot(engine, bot, reach, rng = Math.random) {
  const arsenal = bot.arsenal;
  const angles = sampleAngles(bot);
  const color = pickArsenalColorShot(engine, bot, reach, angles, rng);
  const special = pickSpecialShot(engine, arsenal, angles);
  if (special) {
    const specialsLeft = Object.values(engine.specialInventory).reduce((sum, count) => sum + Math.max(0, count), 0);
    const isEndgame = engine.shotsRemaining <= specialsLeft;
    const minGain = isEndgame ? 0 : arsenal.specialMinGain;
    if (special.value >= arsenal.specialMinValue && special.value > color.value + minGain) {
      return { angle: special.angle, specialType: special.specialType };
    }
  }
  return { angle: color.angle, specialType: null };
}
