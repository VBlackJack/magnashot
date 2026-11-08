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
import { t } from '../core/I18n.js';

/**
 * The spheres a rocket strikes from where it lands: modifier spheres first, then
 * anchors, then the rest, the nearest first in each group.
 * @param {{x: number, y: number}} origin - Where the rocket lands.
 * @param {Iterable<object>} balls - Spheres on the board.
 * @param {number} count - Rockets fired.
 * @returns {object[]}
 */
export function pickRocketTargets(origin, balls, count) {
  const rank = (target) => (target.clusterModifier ? 0 : target.isAnchor ? 1 : 2);
  const distance = (target) => Math.hypot(target.x - origin.x, target.y - origin.y);
  return [...balls]
    .sort((a, b) => rank(a) - rank(b) || distance(a) - distance(b))
    .slice(0, count);
}

export class SpecialBallController {
  constructor(ballsConfig, gameConfig) {
    this.ballsConfig = ballsConfig;
    this.gameConfig = gameConfig;
  }

  resolveSpecialImpact(ball, physicsWorld, particleSystem, audioManager, radiusMultiplier, destroyBallFn) {
    const specialType = ball.specialType;
    const specs = this.ballsConfig.specialTypes[specialType];
    if (!specs) {
      return { destroyed: [], scoreDelta: 0, freezeTurns: 0 };
    }

    if (specialType === SPECIAL_TYPES.BOMB) {
      return this.triggerBomb(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier, destroyBallFn);
    }
    if (specialType === SPECIAL_TYPES.LIGHTNING) {
      return this.triggerLightning(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier, destroyBallFn);
    }
    if (specialType === SPECIAL_TYPES.RAINBOW) {
      return this.triggerRainbow(ball, specs, physicsWorld, particleSystem, audioManager, destroyBallFn);
    }
    if (specialType === SPECIAL_TYPES.FREEZE) {
      return this.triggerFreeze(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier);
    }
    if (specialType === SPECIAL_TYPES.ROCKET) {
      return this.triggerRocket(ball, specs, physicsWorld, particleSystem, audioManager, destroyBallFn);
    }
    if (specialType === SPECIAL_TYPES.BRUSH) {
      return this.triggerBrush(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier);
    }

    return { destroyed: [], scoreDelta: 0, freezeTurns: 0 };
  }

  triggerBomb(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier, destroyBallFn) {
    const blastRadius = ball.radius * specs.blastRadiusFactor * radiusMultiplier;
    const shockwaveOuterRadius = blastRadius * specs.shockwaveRadiusMultiplier;
    const targetsInBlast = [];

    if (physicsWorld.ballMap.has(ball.id)) {
      physicsWorld.removeBall(ball);
    }

    for (const target of [...physicsWorld.balls]) {
      const dx = target.x - ball.x;
      const dy = target.y - ball.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= blastRadius) {
        targetsInBlast.push(target);
      } else if (dist <= shockwaveOuterRadius && !target.isAnchor && dist > 0) {
        const push = ((shockwaveOuterRadius - dist) / shockwaveOuterRadius) * specs.shockwaveForce;
        target.vx += (dx / dist) * push;
        target.vy += (dy / dist) * push;
      }
    }

    const destroyed = [];
    for (const target of targetsInBlast) {
      if (destroyBallFn(target, specs.highlight, true, specs.burstCount, specs.burstSpeed)) {
        destroyed.push(target);
      }
    }
    this.breakChainsInBlast(ball.x, ball.y, shockwaveOuterRadius, physicsWorld, particleSystem);

    particleSystem.spawnExplosion?.(ball.x, ball.y, blastRadius, specs.highlight);
    particleSystem.spawnFlash?.(ball.x, ball.y, specs.highlight, blastRadius * specs.flashRadiusFactor);
    particleSystem.spawnShockwave(ball.x, ball.y, specs.highlight, blastRadius * specs.visualShockwaveFactor, {
      lineWidth: specs.outerRingLineWidth
    });
    particleSystem.spawnShockwave(
      ball.x,
      ball.y,
      specs.innerRingColor,
      blastRadius * specs.innerShockwaveFactor,
      { expandRate: specs.innerRingExpandRate }
    );
    particleSystem.spawnBurst(ball.x, ball.y, specs.innerRingColor, specs.coreBurstCount, specs.coreBurstSpeed);
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.special.bomb'),
      specs.highlight
    );
    particleSystem.addScreenShake(this.gameConfig.juice.bombShake, this.gameConfig.juice.maxShakeOffset);
    audioManager.playEffect('bomb');

    return {
      destroyed,
      scoreDelta: destroyed.length * specs.pointsPerBall,
      freezeTurns: 0,
      slowMoFrames: specs.slowMoFrames,
      slowMoTimeScale: specs.slowMoTimeScale,
      slowMoColor: specs.highlight
    };
  }

  /**
   * A Rocket shot fires a salvo at the hardest targets on the board: special spheres
   * first (modifiers, then anchors), nearest first within each rank. Each rocket hits like
   * a blast: armor breaks, and a Boss Core loses one shield.
   */
  triggerRocket(ball, specs, physicsWorld, particleSystem, audioManager, destroyBallFn) {
    if (physicsWorld.ballMap.has(ball.id)) {
      physicsWorld.removeBall(ball);
    }
    particleSystem.spawnExplosion?.(ball.x, ball.y, ball.radius * specs.launchShockwaveFactor, specs.highlight);
    particleSystem.spawnFlash?.(ball.x, ball.y, specs.highlight, ball.radius * specs.launchFlashRadiusFactor);
    particleSystem.spawnShockwave(ball.x, ball.y, specs.highlight, ball.radius * specs.launchShockwaveFactor);
    const targets = pickRocketTargets(ball, physicsWorld.balls, specs.rocketCount);
    const destroyed = [];
    for (const target of targets) {
      particleSystem.spawnStreak(ball.x, ball.y, target.x, target.y, specs.highlight, 1);
      particleSystem.spawnStreak(ball.x, ball.y, target.x, target.y, specs.secondaryStreakColor, -1);
      particleSystem.spawnExplosion?.(target.x, target.y, target.radius * specs.targetShockwaveFactor, specs.highlight);
      particleSystem.spawnFlash?.(
        target.x,
        target.y,
        specs.highlight,
        target.radius * specs.targetFlashRadiusFactor
      );
      particleSystem.spawnShockwave(
        target.x,
        target.y,
        specs.highlight,
        target.radius * specs.targetShockwaveFactor,
        { lineWidth: specs.outerRingLineWidth }
      );
      if (destroyBallFn(target, specs.highlight, true, specs.burstCount, specs.burstSpeed)) {
        destroyed.push(target);
      }
    }
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.special.rocket'),
      specs.highlight
    );
    particleSystem.addScreenShake(this.gameConfig.juice.bombShake, this.gameConfig.juice.maxShakeOffset);
    audioManager.playEffect('bomb');
    return {
      destroyed,
      scoreDelta: destroyed.length * specs.pointsPerBall,
      freezeTurns: 0,
      slowMoFrames: specs.slowMoFrames,
      slowMoTimeScale: specs.slowMoTimeScale,
      slowMoColor: specs.highlight
    };
  }

  /**
   * An explosion is the only thing that breaks chains without destroying the ball: every
   * chained ball that survives inside the blast loses its chains.
   */
  breakChainsInBlast(x, y, radius, physicsWorld, particleSystem) {
    const chainSpec = this.ballsConfig.clusterModifiers.chained;
    for (const target of physicsWorld.balls) {
      if (target.clusterModifier === CLUSTER_MODIFIERS.CHAINED && Math.hypot(target.x - x, target.y - y) <= radius) {
        target.clusterModifier = null;
        particleSystem.spawnBurst(target.x, target.y, chainSpec.linkColor, chainSpec.breakBurstCount, chainSpec.breakBurstSpeed);
      }
    }
  }

  /**
   * Repaints the colored balls around a Paint Core in the core's color. Nothing is
   * destroyed: the repainted balls are queued for the delayed chain check, so the new
   * groups they form go off on their own a moment later.
   * @returns {{painted: Array, scoreDelta: number}}
   */
  triggerPaint(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier = 1) {
    const paintRadius = ball.radius * specs.paintRadiusFactor * radiusMultiplier;
    const color = ball.colorId;
    const painted = [];
    if (color) {
      for (const target of physicsWorld.balls) {
        const isRust = target.clusterModifier === CLUSTER_MODIFIERS.RUST;
        if (target.id === ball.id || (!target.colorId && !isRust) || target.specialType || target.colorId === color) {
          continue;
        }
        if (Math.hypot(target.x - ball.x, target.y - ball.y) <= paintRadius) {
          if (isRust) {
            // Paint scrubs rust off: the sphere comes back as a plain colored one.
            target.clusterModifier = null;
          }
          target.colorId = color;
          physicsWorld.pendingChainCandidateIds.add(target.id);
          painted.push(target);
        }
      }
    }
    particleSystem.spawnShockwave(ball.x, ball.y, specs.highlight, paintRadius);
    particleSystem.spawnBurst(ball.x, ball.y, specs.highlight, specs.burstCount, specs.burstSpeed);
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.core.paint', { count: painted.length }),
      specs.highlight
    );
    audioManager.playEffect('snap');
    return { painted, scoreDelta: painted.length * specs.pointsPerBall };
  }

  /**
   * Repaints spheres within the Brush radius into a single unifying color (and scrubs
   * rust off rusted spheres), then queues them for delayed chain matching.
   */
  triggerBrush(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier) {
    const paintRadius = ball.radius * specs.paintRadiusFactor * radiusMultiplier;
    if (physicsWorld.ballMap.has(ball.id)) {
      physicsWorld.removeBall(ball);
    }

    const targetsInRadius = [];
    const colorCounts = new Map();
    for (const target of physicsWorld.balls) {
      if (target.id === ball.id || target.specialType) {
        continue;
      }
      const isRust = target.clusterModifier === CLUSTER_MODIFIERS.RUST;
      if (!target.colorId && !isRust) {
        continue;
      }
      if (Math.hypot(target.x - ball.x, target.y - ball.y) <= paintRadius) {
        targetsInRadius.push(target);
        if (target.colorId) {
          colorCounts.set(target.colorId, (colorCounts.get(target.colorId) || 0) + 1);
        }
      }
    }

    let targetColor = ball.colorId || null;
    if (!targetColor) {
      let bestCount = 0;
      for (const [colorId, count] of colorCounts.entries()) {
        if (count > bestCount) {
          bestCount = count;
          targetColor = colorId;
        }
      }
    }
    if (!targetColor) {
      for (const other of physicsWorld.balls) {
        if (other.colorId) {
          targetColor = other.colorId;
          break;
        }
      }
    }
    if (!targetColor) {
      targetColor = this.ballsConfig.standardColors[0]?.id || null;
    }

    const painted = [];
    if (targetColor) {
      for (const target of targetsInRadius) {
        const isRust = target.clusterModifier === CLUSTER_MODIFIERS.RUST;
        if (!isRust && target.colorId === targetColor) {
          // Already the unifying color: nothing changed, so it neither scores nor
          // overcharges, but it still joins the delayed chain check.
          physicsWorld.pendingChainCandidateIds.add(target.id);
          continue;
        }
        if (isRust) {
          target.clusterModifier = null;
        }
        target.colorId = targetColor;
        physicsWorld.pendingChainCandidateIds.add(target.id);
        painted.push(target);
      }
    }

    const paintPalette = this.ballsConfig.standardColors.find((c) => c.id === targetColor);
    const paintHex = paintPalette?.highlight || specs.highlight;
    particleSystem.spawnFlash?.(ball.x, ball.y, paintHex, paintRadius * specs.flashRadiusFactor);
    particleSystem.spawnShockwave(ball.x, ball.y, specs.highlight, paintRadius);
    particleSystem.spawnShockwave(ball.x, ball.y, paintHex, paintRadius * specs.innerShockwaveFactor);
    particleSystem.spawnBurst(ball.x, ball.y, specs.highlight, specs.burstCount, specs.burstSpeed);
    for (const target of painted) {
      particleSystem.spawnStreak(ball.x, ball.y, target.x, target.y, paintHex);
      particleSystem.spawnBurst(
        target.x,
        target.y,
        paintHex,
        specs.targetPaintBurstCount,
        specs.targetPaintBurstSpeed
      );
    }
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.special.brush', { count: painted.length }),
      specs.highlight
    );
    audioManager.playEffect('snap');
    return {
      destroyed: [],
      painted,
      scoreDelta: painted.length * specs.pointsPerBall,
      freezeTurns: 0,
      slowMoFrames: specs.slowMoFrames,
      slowMoTimeScale: specs.slowMoTimeScale
    };
  }

  triggerLightning(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier, destroyBallFn) {
    const bandHalf = ball.radius * specs.bandHalfHeightFactor * radiusMultiplier;
    const targetsInBand = [];

    if (physicsWorld.ballMap.has(ball.id)) {
      physicsWorld.removeBall(ball);
    }

    for (const target of [...physicsWorld.balls]) {
      if (Math.abs(target.y - ball.y) <= bandHalf) {
        targetsInBand.push(target);
      }
    }

    const destroyed = [];
    for (const target of targetsInBand) {
      particleSystem.spawnLightningArc?.(ball.x, ball.y, target.x, target.y, specs.highlight);
      particleSystem.spawnShockwave(target.x, target.y, specs.highlight, target.radius * specs.targetRingFactor);
      if (destroyBallFn(target, specs.highlight, true, specs.burstCount, specs.burstSpeed)) {
        destroyed.push(target);
      }
    }

    const leftX = this.gameConfig.canvas.wallMargin;
    const rightX = this.gameConfig.canvas.logicalWidth - this.gameConfig.canvas.wallMargin;
    particleSystem.spawnExplosion?.(ball.x, ball.y, ball.radius * specs.flashRadiusFactor, specs.highlight);
    particleSystem.spawnFlash?.(ball.x, ball.y, specs.highlight, ball.radius * specs.flashRadiusFactor);
    particleSystem.spawnLightning(ball.y, leftX, rightX, specs.highlight);
    particleSystem.spawnLightning(ball.y, leftX, rightX, specs.secondaryArcColor);
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.special.lightning'),
      specs.highlight
    );
    particleSystem.addScreenShake(this.gameConfig.juice.anvilShake, this.gameConfig.juice.maxShakeOffset);
    audioManager.playEffect('lightning');

    return {
      destroyed,
      scoreDelta: destroyed.length * specs.pointsPerBall,
      freezeTurns: 0,
      slowMoFrames: specs.slowMoFrames,
      slowMoTimeScale: specs.slowMoTimeScale,
      slowMoColor: specs.highlight
    };
  }

  triggerRainbow(ball, specs, physicsWorld, particleSystem, audioManager, destroyBallFn) {
    const matchedIds = new Set([ball.id]);
    const candidateNeighbors = [];
    const neighborRadius = ball.radius * specs.neighborRadiusFactor;

    for (const neighborId of ball.bonds) {
      const neighbor = physicsWorld.ballMap.get(neighborId);
      if (neighbor && neighbor.colorId) {
        candidateNeighbors.push(neighbor);
      }
    }

    for (const other of physicsWorld.balls) {
      if (other.id !== ball.id && other.colorId && !matchedIds.has(other.id)) {
        if (Math.hypot(other.x - ball.x, other.y - ball.y) <= neighborRadius) {
          candidateNeighbors.push(other);
        }
      }
    }

    const targetsToProcess = [];
    for (const neighbor of candidateNeighbors) {
      const cluster = physicsWorld.findColorCluster(neighbor);
      for (const member of cluster) {
        if (!matchedIds.has(member.id)) {
          matchedIds.add(member.id);
          targetsToProcess.push(member);
        }
      }
    }

    if (physicsWorld.ballMap.has(ball.id)) {
      particleSystem.spawnBurst(ball.x, ball.y, specs.highlight, specs.burstCount, specs.burstSpeed);
      physicsWorld.removeBall(ball);
    }

    const destroyed = [];
    for (const target of targetsToProcess) {
      const targetColor = this.ballsConfig.standardColors.find((c) => c.id === target.colorId);
      const arcColor = targetColor?.highlight || specs.highlight;
      particleSystem.spawnLightningArc?.(ball.x, ball.y, target.x, target.y, arcColor);
      if (destroyBallFn(target, arcColor, false, specs.burstCount, specs.burstSpeed)) {
        destroyed.push(target);
      }
    }

    particleSystem.spawnExplosion?.(ball.x, ball.y, ball.radius * specs.flashRadiusFactor, specs.highlight);
    particleSystem.spawnFlash?.(ball.x, ball.y, specs.highlight, ball.radius * specs.flashRadiusFactor);
    const palette = this.ballsConfig.standardColors;
    const baseRadius = ball.radius * specs.visualShockwaveFactor;
    const baseExpand = this.gameConfig.juice.particles.shockwaveExpandRate;
    for (let i = 0; i < specs.prismRingCount; i++) {
      const ringColor = palette[i % palette.length]?.highlight || specs.fill;
      const ringRadius = baseRadius * (1 - i * specs.prismRingStepFactor);
      particleSystem.spawnShockwave(ball.x, ball.y, ringColor, ringRadius, {
        expandRate: Math.max(specs.prismRingExpandStep, baseExpand - i * specs.prismRingExpandStep)
      });
    }
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.special.rainbow'),
      specs.highlight
    );
    particleSystem.addScreenShake(this.gameConfig.juice.matchShake, this.gameConfig.juice.maxShakeOffset);
    audioManager.playEffect('match', specs.matchAudioCombo);

    return {
      destroyed,
      scoreDelta: destroyed.length * specs.pointsPerBall,
      freezeTurns: 0,
      slowMoFrames: destroyed.length > 0 ? specs.slowMoFrames : 0,
      slowMoTimeScale: specs.slowMoTimeScale,
      slowMoColor: specs.highlight
    };
  }

  triggerFreeze(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier) {
    const freezeRadius = ball.radius * specs.freezeRadiusFactor * radiusMultiplier;
    let frozenCount = 0;

    for (const target of physicsWorld.balls) {
      if (target.id === ball.id) {
        continue;
      }
      const dist = Math.hypot(target.x - ball.x, target.y - ball.y);
      if (dist <= freezeRadius) {
        frozenCount++;
        target.isFrozen = true;
        target.vx *= specs.velocityDampingFactor;
        target.vy *= specs.velocityDampingFactor;
        particleSystem.spawnBurst(
          target.x,
          target.y,
          specs.highlight,
          specs.targetFrostBurstCount,
          specs.targetFrostBurstSpeed
        );
        particleSystem.spawnShockwave(target.x, target.y, specs.highlight, target.radius * specs.targetRingFactor);
      }
    }

    physicsWorld.removeBall(ball);
    particleSystem.spawnFlash?.(ball.x, ball.y, specs.highlight, freezeRadius * specs.flashRadiusFactor);
    particleSystem.spawnShockwave(ball.x, ball.y, specs.highlight, freezeRadius);
    particleSystem.spawnShockwave(
      ball.x,
      ball.y,
      specs.fill || specs.ringColor,
      freezeRadius * specs.innerShockwaveFactor
    );
    particleSystem.spawnBurst(ball.x, ball.y, specs.highlight, specs.burstCount, specs.burstSpeed);
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.special.freeze'),
      specs.highlight
    );
    audioManager.playEffect('freeze');

    return {
      destroyed: [],
      scoreDelta: frozenCount > 0 ? specs.pointsPerBall * specs.scoreMultiplier : 0,
      freezeTurns: specs.freezeTurns,
      slowMoFrames: specs.slowMoFrames || 0,
      slowMoTimeScale: specs.slowMoTimeScale || 1.0,
      slowMoColor: specs.highlight
    };
  }
}
