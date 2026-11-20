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

import { SPECIAL_TYPES, CLUSTER_MODIFIERS } from '../core/Constants.js';
import { pickRocketTargets } from './SpecialBallController.js';
import { segmentCircleHitT } from './VersusRules.js';

/**
 * A Boss Core with shields left loses one shield per hit instead of being destroyed; a
 * Magnetar is never destroyed by a shot at all.
 */
const isShieldedBossCore = (ball) =>
  ball.clusterModifier === CLUSTER_MODIFIERS.MAGNETAR
  || (ball.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE && ball.armorHits > 1);

/**
 * What a shot along an aim trajectory would hit, as the aim preview shows it: the spheres
 * highlighted, and among them the ones the shot destroys. Shared by the renderer and the
 * calibration bot, so the bot weighs a shot the way the player sees it.
 * @param {object} options
 * @param {Array<{x: number, y: number}>} options.points - Aim trajectory; its `snapTarget`
 *   is the sphere a regular ball would land against.
 * @param {object} options.currentBall - The loaded ball.
 * @param {object} options.physicsWorld - The board.
 * @param {number} options.endX - Trajectory end, x.
 * @param {number} options.endY - Trajectory end, y.
 * @param {number} options.blastMult - Blast radius upgrade multiplier.
 * @param {object} options.specialTypes - ballsConfig.specialTypes.
 * @param {number} options.matchMinCount - Spheres a match needs.
 * @param {{highlight: object[], destroyedIds: Set<number>}} [out] - Containers to fill,
 *   cleared first; the renderer reuses its own between frames.
 * @returns {{highlight: object[], destroyedIds: Set<number>, isMatch: boolean}}
 */
function predictRadiusSpecial(specType, specCfg, ctx, out) {
  const radiusFactor = specType === SPECIAL_TYPES.BOMB ? specCfg.blastRadiusFactor : specCfg.freezeRadiusFactor;
  const aoeRadius = ctx.currentBall.radius * radiusFactor * ctx.blastMult;
  for (const b of ctx.physicsWorld.balls) {
    if (Math.hypot(b.x - ctx.endX, b.y - ctx.endY) <= aoeRadius) {
      out.highlight.push(b);
      if (specType === SPECIAL_TYPES.BOMB && !isShieldedBossCore(b)) {
        out.destroyedIds.add(b.id);
      }
    }
  }
}

function predictLightningSpecial(specCfg, ctx, out) {
  const bandHalf = ctx.currentBall.radius * specCfg.bandHalfHeightFactor * ctx.blastMult;
  for (const b of ctx.physicsWorld.balls) {
    if (Math.abs(b.y - ctx.endY) <= bandHalf) {
      out.highlight.push(b);
      if (!isShieldedBossCore(b)) {
        out.destroyedIds.add(b.id);
      }
    }
  }
}

function predictRainbowSpecial(specCfg, ctx, out) {
  const neighborRadius = ctx.currentBall.radius * specCfg.neighborRadiusFactor;
  const seen = new Set();
  for (const other of ctx.physicsWorld.balls) {
    if (seen.has(other.id) || !other.colorId || Math.hypot(other.x - ctx.endX, other.y - ctx.endY) > neighborRadius) {
      continue;
    }
    for (const member of ctx.physicsWorld.findColorCluster(other)) {
      if (!seen.has(member.id)) {
        seen.add(member.id);
        out.highlight.push(member);
        if (member.armorHits <= 1 && !isShieldedBossCore(member)) {
          out.destroyedIds.add(member.id);
        }
      }
    }
  }
}

function predictAnvilSpecial(specCfg, ctx, out) {
  const pierceRadius = ctx.currentBall.radius * specCfg.pierceRadiusFactor;
  const pierceRadiusSq = pierceRadius * pierceRadius;
  for (const b of ctx.physicsWorld.balls) {
    const hit = ctx.points.some((pt) => (b.x - pt.x) ** 2 + (b.y - pt.y) ** 2 <= pierceRadiusSq);
    if (hit) {
      out.highlight.push(b);
      if (!isShieldedBossCore(b)) {
        out.destroyedIds.add(b.id);
      }
    }
  }
}

function predictRocketSpecial(specCfg, ctx, out) {
  const targets = pickRocketTargets({ x: ctx.endX, y: ctx.endY }, ctx.physicsWorld.balls, specCfg.rocketCount);
  for (const target of targets) {
    out.highlight.push(target);
    if (!isShieldedBossCore(target)) {
      out.destroyedIds.add(target.id);
    }
  }
}

function predictBrushSpecial(specCfg, ctx, out) {
  const aoeRadius = ctx.currentBall.radius * specCfg.paintRadiusFactor * ctx.blastMult;
  for (const b of ctx.physicsWorld.balls) {
    if ((b.colorId || b.clusterModifier === CLUSTER_MODIFIERS.RUST) && Math.hypot(b.x - ctx.endX, b.y - ctx.endY) <= aoeRadius) {
      out.highlight.push(b);
    }
  }
}

const SPECIAL_IMPACT_PREDICTORS = Object.freeze({
  [SPECIAL_TYPES.BOMB]: (specCfg, ctx, out) => predictRadiusSpecial(SPECIAL_TYPES.BOMB, specCfg, ctx, out),
  [SPECIAL_TYPES.FREEZE]: (specCfg, ctx, out) => predictRadiusSpecial(SPECIAL_TYPES.FREEZE, specCfg, ctx, out),
  [SPECIAL_TYPES.LIGHTNING]: predictLightningSpecial,
  [SPECIAL_TYPES.RAINBOW]: predictRainbowSpecial,
  [SPECIAL_TYPES.ANVIL]: predictAnvilSpecial,
  [SPECIAL_TYPES.ROCKET]: predictRocketSpecial,
  [SPECIAL_TYPES.BRUSH]: predictBrushSpecial
});

function predictRegularSnapImpact(ctx, out) {
  const target = ctx.points.snapTarget;
  const isMatchingColor = Boolean(ctx.currentBall.colorId && ctx.currentBall.colorId === target.colorId);
  if (isMatchingColor) {
    out.highlight.push(...ctx.physicsWorld.findColorCluster(target));
  } else {
    out.highlight.push(target);
  }
  const isMatch = Boolean(isMatchingColor && out.highlight.length + 1 >= ctx.matchMinCount);
  if (isMatch) {
    for (const member of out.highlight) {
      if (member.armorHits <= 1 && !isShieldedBossCore(member)) {
        out.destroyedIds.add(member.id);
      }
    }
  }
  return isMatch;
}

export function predictImpact(
  ctx,
  out = { highlight: [], destroyedIds: new Set() }
) {
  const { highlight, destroyedIds } = out;
  highlight.length = 0;
  destroyedIds.clear();
  let isMatch = false;

  if (ctx.currentBall.specialType) {
    const specType = ctx.currentBall.specialType;
    SPECIAL_IMPACT_PREDICTORS[specType]?.(ctx.specialTypes[specType], ctx, out);
    isMatch = true;
  } else if (ctx.points.snapTarget) {
    isMatch = predictRegularSnapImpact(ctx, out);
  }

  return { highlight, destroyedIds, isMatch };
}

/**
 * Cuts an aim path at the first charged sphere it crosses (Polarity Duel only). Pure: the
 * input path is not changed; a cut path is a new array without the snap target of the
 * original, since a shot that stops at a charge snaps nowhere.
 * @param {Array<{x: number, y: number}>} points - Aim trajectory.
 * @param {Array<{x: number, y: number, polarity: number}>} charges - Charges on the board.
 * @param {number} hitRadius - Charge radius plus the projectile radius.
 * @returns {{points: object[], hit: ({x: number, y: number, charge: object}|null)}}
 */
export function truncateAimAtCharges(points, charges, hitRadius) {
  if (!points || points.length < 2 || charges.length === 0) {
    return { points, hit: null };
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b.warpBreak) {
      continue;
    }
    let best = null;
    for (const charge of charges) {
      const t = segmentCircleHitT(a.x, a.y, b.x, b.y, charge.x, charge.y, hitRadius);
      if (t !== null && (best === null || t < best.t)) {
        best = { t, charge };
      }
    }
    if (best) {
      const end = { ...b, x: a.x + (b.x - a.x) * best.t, y: a.y + (b.y - a.y) * best.t, isBounce: false };
      const cut = [...points.slice(0, i + 1), end];
      return { points: cut, hit: { x: end.x, y: end.y, charge: best.charge } };
    }
  }
  return { points, hit: null };
}
