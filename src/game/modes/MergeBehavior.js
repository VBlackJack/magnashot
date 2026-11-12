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

import {
  GAME_MODES,
  GAME_OVER_REASONS,
  LAUNCHER_POSTURES,
  MATH_CONSTANTS,
  SEPARATION_FALLBACK_AXIS,
  SPECIAL_TYPES
} from '../../core/Constants.js';
import { t } from '../../core/I18n.js';
import { Ball } from '../../entities/Ball.js';
import { ModeBehavior, registerModeBehavior } from './ModeBehavior.js';

const INITIAL_DROP_VY = 45;
const ENTRY_GRACE_SEC = 0.85;
const MERGE_POP_SCALE = 1.28;
const POP_DECAY_PER_SEC = 1.8;
const TOUCH_MERGE_TOLERANCE_PX = 1.5;
const WALL_LINE_WIDTH = 3;
const OVERFLOW_DASH = Object.freeze([8, 6]);
const DROP_GUIDE_DASH = Object.freeze([5, 6]);
const OVERFLOW_LINE_ALPHA = 0.72;
const DROP_GUIDE_ALPHA = 0.36;
const BASIN_GLOW_ALPHA = 0.14;
const ACTIVE_POLARITY_PULSE_SEC = 0.65;

const MERGE_CHROME = Object.freeze({
  ambientLiquid: false,
  collectorBins: false,
  dangerZone: false,
  aimLine: false
});

export class MergeBehavior extends ModeBehavior {
  constructor() {
    super(GAME_MODES.MERGE);
  }

  getLauncherSpec(engine) {
    const cfg = engine.modesConfig.merge;
    return {
      x: engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      y: cfg.launcherY,
      posture: LAUNCHER_POSTURES.DROP_RAIL,
      minAngle: Math.PI * MATH_CONSTANTS.HALF,
      maxAngle: Math.PI * MATH_CONSTANTS.HALF,
      defaultAngle: Math.PI * MATH_CONSTANTS.HALF,
      nextOffsetX: cfg.nextOffsetX,
      nextOffsetY: cfg.nextOffsetY,
      compactQueue: true,
      cancelOffset: 0,
      cancelRadius: 0
    };
  }

  getRenderChrome() {
    return MERGE_CHROME;
  }

  offersSpecialBalls() {
    return false;
  }

  isSpecialTypeAllowed() {
    return false;
  }

  hidesOvercharge() {
    return true;
  }

  /** Spheres fuse by calibre and nothing hangs from anchors, so the basics hint does not apply. */
  teachesMatchBasics() {
    return false;
  }

  neutralizesWorkshopUpgrades() {
    return true;
  }

  isTiltLocked() {
    return false;
  }

  allowsEmptyBoardSnapshot() {
    return true;
  }

  getTierSpecById(engine, colorId) {
    const tiers = engine.modesConfig.merge.tiers;
    return tiers.find((item) => item.id === colorId) || tiers[0];
  }

  getTierSpecByIndex(engine, tierIndex) {
    const tiers = engine.modesConfig.merge.tiers;
    const clamped = Math.max(0, Math.min(tiers.length - 1, tierIndex));
    return tiers[clamped];
  }

  pickLauncherColor(engine, roll = engine.random()) {
    const cfg = engine.modesConfig.merge;
    const spawnCount = Math.min(cfg.tiers.length, cfg.spawnMaxTierIndex + 1);
    const idx = Math.min(spawnCount - 1, Math.floor(roll * spawnCount));
    return cfg.tiers[idx].id;
  }

  syncLauncherBallTier(engine, ball) {
    if (!ball || ball.specialType) {
      return;
    }
    const spec = this.getTierSpecById(engine, ball.colorId);
    ball.colorId = spec.id;
    ball.radius = spec.radius;
    ball.mergeTier = spec.tier;
  }

  clampDropX(engine, rawX, radius) {
    const cfg = engine.modesConfig.merge;
    return Math.max(cfg.basinLeftX + radius, Math.min(cfg.basinRightX - radius, rawX));
  }

  setupMode(engine) {
    const cfg = engine.modesConfig.merge;
    const world = engine.physicsWorld;
    world.clear();
    world.skipClusterStep = true;

    const spawnPool = cfg.tiers.slice(0, cfg.spawnMaxTierIndex + 1).map((item) => item.id);
    engine.activePalette = spawnPool;
    engine.specialInventory = Object.fromEntries(Object.values(SPECIAL_TYPES).map((type) => [type, 0]));
    engine.mergeDropX = engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF;
    engine.mergeBestTier = 1;
    engine.waveCount = 1;

    engine.modeState = {
      dropCooldownSec: 0,
      shakeRemaining: cfg.shake.rechargeDrops,
      mergesCount: 0,
      supernovas: 0,
      maxOverflowRatio: 0
    };
  }

  canFire(engine) {
    return (engine.modeState?.dropCooldownSec ?? 0) <= 0;
  }

  fire(engine) {
    if (!this.canFire(engine) || !engine.currentBall) {
      return true;
    }
    const cfg = engine.modesConfig.merge;
    this.syncLauncherBallTier(engine, engine.currentBall);
    const tierSpec = this.getTierSpecById(engine, engine.currentBall.colorId);
    const dropX = this.clampDropX(engine, engine.mergeDropX, tierSpec.radius);

    engine.sampleShotTimeline();
    engine.evaluateGhostShot();
    engine.countShotForStats();

    const dropped = new Ball({
      x: dropX,
      y: cfg.launcherY,
      vx: 0,
      vy: INITIAL_DROP_VY,
      radius: tierSpec.radius,
      colorId: tierSpec.id,
      isAnchor: false
    });
    dropped.mergeTier = tierSpec.tier;
    dropped.mergeGraceSec = ENTRY_GRACE_SEC;
    dropped.mergeOverflowSec = 0;
    dropped.mergePolaritySec = engine.isPolarityFlipped ? cfg.polarityWindowSec : 0;
    engine.physicsWorld.addBall(dropped);
    if (engine.modeState.shakeRemaining > 0) {
      engine.modeState.shakeRemaining -= 1;
    }

    engine.mergeBestTier = Math.max(engine.mergeBestTier || 1, tierSpec.tier + 1);
    engine.modeState.dropCooldownSec = cfg.dropCooldownSec;
    engine.combo = 0;

    engine.currentBall = engine.nextBall;
    const upcoming = engine.takeUpcomingBall();
    engine.nextBall = engine.createRandomLauncherBall(null, upcoming.colorId);
    this.syncLauncherBallTier(engine, engine.currentBall);
    this.syncLauncherBallTier(engine, engine.nextBall);
    engine.mergeDropX = this.clampDropX(engine, engine.mergeDropX, engine.currentBall.radius);

    engine.hasFiredInRound = true;
    engine.audioManager.playEffect('shoot');
    engine.saveRunSnapshot();
    engine.notifyUI();
    return true;
  }

  /**
   * Throws the pile towards the emptier side with a small hop that frees it from floor
   * friction, smaller spheres moving more.
   */
  shake(engine) {
    const { balls } = engine.physicsWorld;
    if (balls.length === 0) {
      return false;
    }
    const cfg = engine.modesConfig.merge;
    const midpoint = (cfg.basinLeftX + cfg.basinRightX) * MATH_CONSTANTS.HALF;
    const averageX = balls.reduce((sum, ball) => sum + ball.x, 0) / balls.length;
    const direction = averageX > midpoint ? -1 : 1;
    for (const ball of balls) {
      const sizeFactor = cfg.tiers[0].radius / ball.radius;
      ball.vx += direction * cfg.shake.maxImpulsePxPerSec * sizeFactor;
      ball.vy -= cfg.shake.liftImpulsePxPerSec * sizeFactor;
    }
    engine.modeState.shakeRemaining = cfg.shake.rechargeDrops;
    engine.saveRunSnapshot();
    engine.notifyUI();
    return true;
  }

  onPolarityFlipped(engine) {
    if (!engine.isRunPlaying()) {
      return;
    }
    const balls = engine.physicsWorld.balls;
    if (balls.length > 0 && engine.isPolarityFlipped) {
      for (const b of balls) {
        b.mergePolaritySec = Math.max(b.mergePolaritySec || 0, ACTIVE_POLARITY_PULSE_SEC);
      }
      const latest = balls[balls.length - 1];
      engine.particleSystem.spawnShockwave(
        latest.x,
        latest.y,
        engine.gameConfig.theme.overchargePopupColor,
        latest.radius * 2.4
      );
    }
  }

  applyPolarityBiasForces(engine, balls, dtSec) {
    const cfg = engine.modesConfig.merge;
    const rangeSq = cfg.polarityBiasRange * cfg.polarityBiasRange;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if ((a.mergePolaritySec || 0) <= 0 && (b.mergePolaritySec || 0) <= 0) {
          continue;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= MATH_CONSTANTS.EPSILON || distSq >= rangeSq) {
          continue;
        }
        const dist = Math.sqrt(distSq);
        const falloff = 1 - dist / cfg.polarityBiasRange;
        // Same tier pulls together to complete merges; mismatched tiers nudge apart to clear blockers.
        const sign = a.mergeTier === b.mergeTier ? 1 : -0.55;
        const accel = cfg.polarityBiasAcceleration * falloff * sign * dtSec;
        const nx = dx / dist;
        const ny = dy / dist;
        a.vx += nx * accel;
        a.vy += ny * accel;
        b.vx -= nx * accel;
        b.vy -= ny * accel;
      }
    }
  }

  emitMergeShockwave(engine, cx, cy, sourceRadius, impulse, targetTier) {
    const cfg = engine.modesConfig.merge;
    const maxDist = sourceRadius * cfg.shockwaveRadiusFactor;
    for (const other of engine.physicsWorld.balls) {
      const dx = other.x - cx;
      const dy = other.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist <= MATH_CONSTANTS.EPSILON || dist > maxDist) {
        continue;
      }
      const falloff = 1 - dist / maxDist;
      const massScale = (sourceRadius * sourceRadius) / Math.max(196, other.radius * other.radius);
      const dirSign = other.mergeTier === targetTier ? -0.45 : 1;
      const push = impulse * falloff * Math.min(1.4, massScale) * dirSign;
      other.vx += (dx / dist) * push;
      other.vy += (dy / dist) * push;
    }
  }

  onBeforePhysicsStep(engine, dtSec) {
    if (!engine.isRunPlaying() || !engine.modeState) {
      return;
    }
    this.syncLauncherBallTier(engine, engine.currentBall);
    this.syncLauncherBallTier(engine, engine.nextBall);

    const cfg = engine.modesConfig.merge;
    const state = engine.modeState;
    const world = engine.physicsWorld;
    const balls = world.balls;

    if (state.dropCooldownSec > 0) {
      state.dropCooldownSec = Math.max(0, state.dropCooldownSec - dtSec);
    }
    if (balls.length === 0) {
      state.maxOverflowRatio = 0;
      return;
    }

    for (const b of balls) {
      if (b.mergeGraceSec > 0) {
        b.mergeGraceSec = Math.max(0, b.mergeGraceSec - dtSec);
      }
      if (b.mergePolaritySec > 0) {
        b.mergePolaritySec = Math.max(0, b.mergePolaritySec - dtSec);
      }
      if (b.impactScale > 1) {
        b.impactScale = Math.max(1, b.impactScale - POP_DECAY_PER_SEC * dtSec);
      }
      b.vy += cfg.gravity * dtSec;
      b.vx += cfg.tiltAcceleration * world.tiltFactor * dtSec;
    }

    this.applyPolarityBiasForces(engine, balls, dtSec);

    for (const b of balls) {
      b.vx *= cfg.linearDamping;
      b.vy *= cfg.linearDamping;
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
    }

    const mergePairs = [];
    const mergedIds = new Set();

    for (let iter = 0; iter < cfg.solverIterations; iter++) {
      for (const b of balls) {
        const minX = cfg.basinLeftX + b.radius;
        const maxX = cfg.basinRightX - b.radius;
        const maxY = cfg.basinFloorY - b.radius;
        if (b.x < minX) {
          b.x = minX;
          if (b.vx < 0) {
            b.vx = -b.vx * cfg.wallRestitution;
          }
        } else if (b.x > maxX) {
          b.x = maxX;
          if (b.vx > 0) {
            b.vx = -b.vx * cfg.wallRestitution;
          }
        }
        if (b.y > maxY) {
          b.y = maxY;
          if (b.vy > 0) {
            b.vy = -b.vy * cfg.floorRestitution;
          }
          b.vx *= cfg.floorFriction;
        }
      }

      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (mergedIds.has(a.id)) {
          continue;
        }
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (mergedIds.has(b.id)) {
            continue;
          }
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minDist = a.radius + b.radius;
          const distSq = dx * dx + dy * dy;

          if (
            iter === 0
            && a.mergeTier === b.mergeTier
            && distSq <= (minDist + TOUCH_MERGE_TOLERANCE_PX) * (minDist + TOUCH_MERGE_TOLERANCE_PX)
          ) {
            mergedIds.add(a.id);
            mergedIds.add(b.id);
            mergePairs.push([a, b]);
            break;
          }

          if (distSq >= minDist * minDist) {
            continue;
          }
          let nx = SEPARATION_FALLBACK_AXIS.X;
          let ny = SEPARATION_FALLBACK_AXIS.Y;
          let dist = 0;
          if (distSq > MATH_CONSTANTS.EPSILON) {
            dist = Math.sqrt(distSq);
            nx = dx / dist;
            ny = dy / dist;
          }
          const overlap = minDist - dist;
          const massA = a.radius * a.radius;
          const massB = b.radius * b.radius;
          const invMassSum = 1 / massA + 1 / massB;
          const shareA = (1 / massA) / invMassSum;
          const shareB = (1 / massB) / invMassSum;

          a.x -= nx * overlap * shareA;
          a.y -= ny * overlap * shareA;
          b.x += nx * overlap * shareB;
          b.y += ny * overlap * shareB;

          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const relNormal = rvx * nx + rvy * ny;
          if (relNormal < 0) {
            const jImpulse = -(1 + cfg.ballRestitution) * relNormal / invMassSum;
            a.vx -= (jImpulse / massA) * nx;
            a.vy -= (jImpulse / massA) * ny;
            b.vx += (jImpulse / massB) * nx;
            b.vy += (jImpulse / massB) * ny;
          }
        }
      }
    }

    if (mergePairs.length > 0) {
      this.resolveMergePairs(engine, mergePairs);
    }

    // Check top overflow danger line with grace timer
    let worstRatio = 0;
    for (const b of world.balls) {
      if ((b.mergeGraceSec || 0) > 0) {
        continue;
      }
      if (b.y - b.radius < cfg.overflowLineY) {
        b.mergeOverflowSec = (b.mergeOverflowSec || 0) + dtSec;
        worstRatio = Math.max(worstRatio, b.mergeOverflowSec / cfg.overflowGraceSec);
        if (b.mergeOverflowSec >= cfg.overflowGraceSec) {
          engine.triggerGameOver(GAME_OVER_REASONS.BASIN_OVERFLOW);
          return;
        }
      } else if (b.mergeOverflowSec > 0) {
        b.mergeOverflowSec = Math.max(0, b.mergeOverflowSec - dtSec * 2);
        worstRatio = Math.max(worstRatio, b.mergeOverflowSec / cfg.overflowGraceSec);
      }
    }
    state.maxOverflowRatio = Math.min(1, worstRatio);
  }

  resolveMergePairs(engine, mergePairs) {
    const cfg = engine.modesConfig.merge;
    const scoring = engine.gameConfig.scoring;
    const world = engine.physicsWorld;

    for (const [a, b] of mergePairs) {
      if (!world.ballMap.has(a.id) || !world.ballMap.has(b.id)) {
        continue;
      }
      const mx = (a.x + b.x) * MATH_CONSTANTS.HALF;
      const my = (a.y + b.y) * MATH_CONSTANTS.HALF;
      const avgVx = (a.vx + b.vx) * MATH_CONSTANTS.HALF * 0.5;
      const avgVy = (a.vy + b.vy) * MATH_CONSTANTS.HALF * 0.5;
      const tierIndex = a.mergeTier ?? 0;

      world.removeBall(a);
      world.removeBall(b);

      engine.combo = Math.min(engine.combo + scoring.comboIncrement, scoring.maxComboMultiplier);
      engine.maxComboInRound = Math.max(engine.maxComboInRound, engine.combo);
      engine.modeState.mergesCount = (engine.modeState.mergesCount || 0) + 1;

      if (tierIndex >= cfg.tiers.length - 1) {
        // Two max-calibre spheres trigger a Supernova!
        const pts = cfg.supernovaBonus * Math.max(1, engine.combo);
        engine.addScore(pts);
        engine.modeState.supernovas = (engine.modeState.supernovas || 0) + 1;
        engine.mergeBestTier = Math.max(engine.mergeBestTier || 1, cfg.tiers.length);
        engine.audioManager.playEffect('victory');
        engine.particleSystem.spawnShockwave(
          mx,
          my,
          engine.gameConfig.theme.victoryPopupColor,
          a.radius * cfg.shockwaveRadiusFactor
        );
        engine.particleSystem.spawnBurst(
          mx,
          my,
          engine.gameConfig.theme.victoryPopupColor,
          engine.gameConfig.juice.matchBurstCount * 2,
          engine.gameConfig.juice.matchBurstSpeed
        );
        engine.particleSystem.spawnFloatingText(
          mx,
          my + engine.gameConfig.canvas.floatingTextOffsetY,
          t('gameplay.feedback.merge.supernova', { points: pts }),
          engine.gameConfig.theme.victoryPopupColor
        );
        this.emitMergeShockwave(engine, mx, my, a.radius, cfg.supernovaShockwaveImpulse, -1);
        engine.unlockAchievementTiers('mergeTiers', cfg.tiers.length);
        continue;
      }

      const nextSpec = this.getTierSpecByIndex(engine, tierIndex + 1);
      const clampedX = Math.max(
        cfg.basinLeftX + nextSpec.radius,
        Math.min(cfg.basinRightX - nextSpec.radius, mx)
      );
      const clampedY = Math.min(cfg.basinFloorY - nextSpec.radius, my);

      const merged = new Ball({
        x: clampedX,
        y: clampedY,
        vx: avgVx,
        vy: avgVy,
        radius: nextSpec.radius,
        colorId: nextSpec.id,
        isAnchor: false
      });
      merged.mergeTier = nextSpec.tier;
      merged.mergeGraceSec = 0.25;
      merged.mergeOverflowSec = 0;
      merged.mergePolaritySec = 0.35;
      merged.impactScale = MERGE_POP_SCALE;
      world.addBall(merged);

      const pts = nextSpec.points * Math.max(1, engine.combo);
      engine.addScore(pts);
      engine.mergeBestTier = Math.max(engine.mergeBestTier || 1, nextSpec.tier + 1);
      engine.waveCount = engine.mergeBestTier;

      engine.audioManager.playEffect('match', engine.combo);
      engine.particleSystem.spawnShockwave(
        clampedX,
        clampedY,
        nextSpec.highlight,
        nextSpec.radius * cfg.shockwaveRadiusFactor * 0.75
      );
      engine.particleSystem.spawnBurst(
        clampedX,
        clampedY,
        nextSpec.highlight,
        engine.gameConfig.juice.matchBurstCount,
        engine.gameConfig.juice.matchBurstSpeed
      );
      engine.particleSystem.spawnFloatingText(
        clampedX,
        clampedY + engine.gameConfig.canvas.floatingTextOffsetY,
        t('gameplay.feedback.merge.fused', { tier: nextSpec.tier + 1, points: pts }),
        nextSpec.highlight
      );

      this.emitMergeShockwave(engine, clampedX, clampedY, nextSpec.radius, cfg.shockwaveImpulse, nextSpec.tier);
      engine.unlockAchievementTiers('mergeTiers', engine.mergeBestTier);
      engine.storageManager?.recordAchievementProgress?.({ maxCombo: engine.combo });
      engine.unlockAchievementTiers('comboMaster', engine.combo);
    }

    engine.persistRunHighScore();
    engine.saveRunSnapshot();
    engine.notifyUI();
  }

  evaluateBoardState() {
    return true;
  }

  serializeModeState(engine) {
    const state = engine.modeState || {};
    return {
      dropX: engine.mergeDropX ?? engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      bestTier: engine.mergeBestTier ?? 1,
      mergesCount: state.mergesCount ?? 0,
      supernovas: state.supernovas ?? 0,
      ...(Number.isInteger(state.shakeRemaining) ? { shakeRemaining: state.shakeRemaining } : {}),
      ballTiers: engine.physicsWorld.balls.map((b) => (Number.isInteger(b.mergeTier) ? b.mergeTier : 0))
    };
  }

  validateModeState(rawState) {
    return Boolean(
      rawState
      && typeof rawState === 'object'
      && Number.isFinite(rawState.dropX)
      && Number.isInteger(rawState.bestTier)
      && rawState.bestTier >= 1
      && Array.isArray(rawState.ballTiers)
    );
  }

  restoreModeState(engine, rawState) {
    const cfg = engine.modesConfig.merge;
    engine.physicsWorld.skipClusterStep = true;
    engine.activePalette = cfg.tiers.slice(0, cfg.spawnMaxTierIndex + 1).map((item) => item.id);
    engine.mergeDropX = rawState.dropX;
    engine.mergeBestTier = rawState.bestTier;
    engine.waveCount = rawState.bestTier;

    engine.modeState = {
      dropCooldownSec: 0,
      shakeRemaining: Number.isInteger(rawState.shakeRemaining)
        ? Math.min(cfg.shake.rechargeDrops, Math.max(0, rawState.shakeRemaining))
        : cfg.shake.rechargeDrops,
      mergesCount: Math.max(0, rawState.mergesCount || 0),
      supernovas: Math.max(0, rawState.supernovas || 0),
      maxOverflowRatio: 0
    };

    const balls = engine.physicsWorld.balls;
    for (let i = 0; i < balls.length; i++) {
      const savedTier = Number.isInteger(rawState.ballTiers[i]) ? rawState.ballTiers[i] : 0;
      const spec = this.getTierSpecByIndex(engine, savedTier);
      balls[i].mergeTier = spec.tier;
      balls[i].colorId = spec.id;
      balls[i].radius = spec.radius;
      balls[i].mergeGraceSec = 0;
      balls[i].mergeOverflowSec = 0;
      balls[i].mergePolaritySec = 0;
    }
    this.syncLauncherBallTier(engine, engine.currentBall);
    this.syncLauncherBallTier(engine, engine.nextBall);
  }

  drawUnderlay(ctx, engine, renderer, theme) {
    const cfg = engine.modesConfig.merge;
    const basinW = cfg.basinRightX - cfg.basinLeftX;
    const basinH = cfg.basinFloorY - cfg.overflowLineY;

    ctx.save();
    // Subtle magnetic containment chamber fill
    ctx.fillStyle = theme.aimLineColor;
    ctx.globalAlpha = BASIN_GLOW_ALPHA * 0.35;
    ctx.fillRect(cfg.basinLeftX, cfg.overflowLineY, basinW, basinH);

    // Basin walls & floor
    ctx.strokeStyle = theme.aimLineColor;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = WALL_LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cfg.basinLeftX, cfg.overflowLineY - 24);
    ctx.lineTo(cfg.basinLeftX, cfg.basinFloorY);
    ctx.lineTo(cfg.basinRightX, cfg.basinFloorY);
    ctx.lineTo(cfg.basinRightX, cfg.overflowLineY - 24);
    ctx.stroke();

    // Top overflow danger line
    const overflowRatio = engine.modeState?.maxOverflowRatio ?? 0;
    ctx.strokeStyle = theme.dangerZoneColor;
    ctx.globalAlpha = OVERFLOW_LINE_ALPHA + overflowRatio * 0.25;
    ctx.lineWidth = overflowRatio > 0 ? 2.5 : 1.5;
    ctx.setLineDash(OVERFLOW_DASH);
    ctx.beginPath();
    ctx.moveTo(cfg.basinLeftX + 4, cfg.overflowLineY);
    ctx.lineTo(cfg.basinRightX - 4, cfg.overflowLineY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Vertical drop guide from top rail cursor
    if (engine.isRunPlaying() && engine.currentBall && !engine.isAimCancelled) {
      const dropX = this.clampDropX(engine, engine.mergeDropX, engine.currentBall.radius);
      ctx.strokeStyle = engine.isPolarityFlipped ? theme.overchargePopupColor : theme.aimLineColor;
      ctx.globalAlpha = DROP_GUIDE_ALPHA;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(DROP_GUIDE_DASH);
      ctx.beginPath();
      ctx.moveTo(dropX, cfg.launcherY + engine.currentBall.radius);
      ctx.lineTo(dropX, cfg.basinFloorY - 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

export const mergeBehavior = new MergeBehavior();
registerModeBehavior(GAME_MODES.MERGE, mergeBehavior);
