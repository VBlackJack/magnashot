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
  OBSTACLE_TYPES,
  SPECIAL_TYPES
} from '../../core/Constants.js';
import { t } from '../../core/I18n.js';
import { Obstacle } from '../../entities/Obstacle.js';
import { ModeBehavior, registerModeBehavior } from './ModeBehavior.js';
import { reportBountyEvent } from '../Bounties.js';

const VALID_SPECIAL_TYPES = new Set(Object.values(SPECIAL_TYPES));

const INNER_ANCHOR_COUNT = 6;
const INNER_RADIUS_FACTOR = 1.18;
const ARC_ROTATION_SPEED_RAD_SEC = 0.22;
const DRIFT_DESPAWN_MARGIN_PX = 48;
const RING_DASH_PATTERN = Object.freeze([8, 6]);
const RING_LINE_WIDTH = 2.5;
const COLLECTOR_ARC_LINE_WIDTH = 6;
const NEAR_MISS_RING_ALPHA = 0.22;
const CONTAINMENT_RING_ALPHA = 0.72;
const NEAR_DANGER_RING_MIN_ALPHA = 0.56;
const NEAR_DANGER_RING_AMP_ALPHA = 0.4;
const NEAR_DANGER_RING_STATIC_ALPHA = 0.94;
const NEAR_DANGER_RING_LINE_WIDTH = 3.5;
const NEAR_DANGER_PULSE_SPEED = 0.008;
const COLLECTOR_ARC_ALPHA = 0.85;
const DEFAULT_ARC_CLAMP_RATIO = 0.92;
const CORE_PIVOT_RADIUS = 20;
const NEXT_BALL_OFFSET_X = 60;
const NEXT_BALL_OFFSET_Y = 12;

/** Half-angular span of each Orbital collector arc, widened cleanly by collectorMagnet. */
function getCollectorHalfSpan(cfg, collectorMagnetLevel = 0) {
  const span =
    cfg.collectorArcSpanRad + Math.max(0, collectorMagnetLevel) * (cfg.collectorArcSpanPerLevel || 0);
  const maxHalfSpan =
    (Math.PI / Math.max(1, cfg.collectorArcCount)) * (cfg.collectorArcClampRatio || DEFAULT_ARC_CLAMP_RATIO);
  return Math.min(maxHalfSpan, span * MATH_CONSTANTS.HALF);
}

const ORBITAL_CHROME = Object.freeze({
  ambientLiquid: false,
  collectorBins: false,
  dangerZone: false,
  aimLine: true
});

function normalizeSignedAngle(angle) {
  let a = angle % MATH_CONSTANTS.TWO_PI;
  if (a > Math.PI) {
    a -= MATH_CONSTANTS.TWO_PI;
  } else if (a < -Math.PI) {
    a += MATH_CONSTANTS.TWO_PI;
  }
  return a;
}

export class OrbitalBehavior extends ModeBehavior {
  constructor() {
    super(GAME_MODES.ORBITAL);
  }

  getLauncherSpec(engine) {
    const base = super.getLauncherSpec(engine);
    const cfg = engine.modesConfig.orbital;
    return {
      ...base,
      x: cfg.coreX,
      y: cfg.launcherY,
      posture: LAUNCHER_POSTURES.UPWARD,
      nextOffsetX: NEXT_BALL_OFFSET_X,
      nextOffsetY: NEXT_BALL_OFFSET_Y
    };
  }

  getRenderChrome() {
    return ORBITAL_CHROME;
  }

  offersSpecialBalls() {
    return true;
  }

  isTiltLocked() {
    return true;
  }

  getPaletteCountForWave(wave, cfg, totalColors) {
    const extra = Math.floor(Math.max(0, wave - 1) / Math.max(1, cfg.wavesPerExtraColor));
    return Math.min(totalColors, cfg.maxColorCount, cfg.initialColorCount + extra);
  }

  getShotsPerWave(wave, cfg) {
    const drop = Math.floor(Math.max(0, wave - 1) / Math.max(1, cfg.wavesPerCadenceDrop));
    return Math.max(cfg.shotsPerRingMin, cfg.shotsPerRingWave - drop);
  }

  setupMode(engine) {
    const cfg = engine.modesConfig.orbital;
    const world = engine.physicsWorld;
    world.clear();
    world.gravityMultiplier = 0;
    world.customPivotDamping = cfg.angularDamping;

    const corePivot = new Obstacle(
      {
        type: OBSTACLE_TYPES.PIVOT,
        x: cfg.coreX,
        y: cfg.coreY,
        radius: CORE_PIVOT_RADIUS,
        angularSpeed: 0
      },
      engine.obstaclesConfig
    );
    world.obstacles.push(corePivot);

    engine.waveCount = 1;
    const paletteSize = this.getPaletteCountForWave(1, cfg, engine.ballsConfig.standardColors.length);
    engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);

    const cadence = this.getShotsPerWave(1, cfg);
    engine.modeState = {
      turnsUntilWave: cadence,
      waveCadence: cadence,
      collectorPhase: MATH_CONSTANTS.QUARTER_PI,
      driftingBalls: []
    };

    this.spawnCoreCluster(engine, cfg.initialRings);
  }

  getCorePivot(engine) {
    return engine.physicsWorld.obstacles.find((obs) => obs.type === OBSTACLE_TYPES.PIVOT) || null;
  }

  computeMomentOfInertia(engine, corePivot) {
    const cfg = engine.modesConfig.orbital;
    let sumSq = 0;
    for (const ball of engine.physicsWorld.balls) {
      const dx = ball.x - corePivot.x;
      const dy = ball.y - corePivot.y;
      sumSq += (dx * dx + dy * dy) * cfg.ballInertiaScale;
    }
    return Math.max(1, cfg.baseMomentOfInertia + sumSq);
  }

  applyImpactAngularImpulse(engine, impactX, impactY, vx, vy) {
    const cfg = engine.modesConfig.orbital;
    const corePivot = this.getCorePivot(engine);
    if (!corePivot) {
      return;
    }
    const rx = impactX - corePivot.x;
    const ry = impactY - corePivot.y;
    const inertia = this.computeMomentOfInertia(engine, corePivot);
    const deltaOmega = ((rx * vy - ry * vx) * cfg.impactTorqueScale * cfg.baseMomentOfInertia) / inertia;
    corePivot.applyTorque(deltaOmega, cfg.maxAngularVelocity);
  }

  spawnCoreCluster(engine, ringCount) {
    const cfg = engine.modesConfig.orbital;
    const world = engine.physicsWorld;
    const corePivot = this.getCorePivot(engine);
    if (!corePivot) {
      return;
    }
    const r = engine.physicsConfig.ball.radius;
    const baseAngle = corePivot.angle;

    for (let ring = 1; ring <= ringCount; ring++) {
      const count = INNER_ANCHOR_COUNT * ring;
      const ringRadius = ring === 1
        ? cfg.ringSpacing * INNER_RADIUS_FACTOR
        : cfg.ringSpacing * (INNER_RADIUS_FACTOR + (ring - 1));
      const angleOffset = (ring % 2) * (Math.PI / count);
      for (let i = 0; i < count; i++) {
        const theta = baseAngle + angleOffset + (i / count) * MATH_CONSTANTS.TWO_PI;
        const x = corePivot.x + Math.cos(theta) * ringRadius;
        const y = corePivot.y + Math.sin(theta) * ringRadius;
        const isInner = ring === 1;
        const ball = engine.createClusterBall({
          x,
          y,
          radius: r,
          isAnchor: isInner,
          pivotRef: isInner ? corePivot : null,
          pivotRadius: isInner ? ringRadius : 0,
          pivotAngle: isInner ? theta : 0
        });
        world.addBall(ball);
      }
    }
    world.rebuildInitialBonds();
  }

  spawnReinforcementWave(engine) {
    const cfg = engine.modesConfig.orbital;
    const world = engine.physicsWorld;
    const corePivot = this.getCorePivot(engine);
    if (!corePivot) {
      return;
    }
    engine.waveCount++;
    const paletteSize = this.getPaletteCountForWave(
      engine.waveCount,
      cfg,
      engine.ballsConfig.standardColors.length
    );
    engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);
    const cadence = this.getShotsPerWave(engine.waveCount, cfg);
    engine.modeState.waveCadence = cadence;
    engine.modeState.turnsUntilWave = cadence;

    const r = engine.physicsConfig.ball.radius;
    const minSpacing = r * engine.physicsConfig.simulation.collisionDistanceFactor;

    // First restore any missing inner core anchors so the asteroid stays moored.
    const innerRadius = cfg.ringSpacing * INNER_RADIUS_FACTOR;
    let addedCount = 0;
    for (let i = 0; i < INNER_ANCHOR_COUNT; i++) {
      const theta = corePivot.angle + (i / INNER_ANCHOR_COUNT) * MATH_CONSTANTS.TWO_PI;
      const x = corePivot.x + Math.cos(theta) * innerRadius;
      const y = corePivot.y + Math.sin(theta) * innerRadius;
      const occupied = world.balls.some((b) => Math.hypot(b.x - x, b.y - y) < minSpacing * 0.85);
      if (!occupied) {
        const ball = engine.createClusterBall({
          x,
          y,
          radius: r,
          isAnchor: true,
          pivotRef: corePivot,
          pivotRadius: innerRadius,
          pivotAngle: theta
        });
        world.addBall(ball);
        addedCount++;
      }
    }

    // Add outer asteroid shell spheres around existing cluster perimeter, staying inside nearMissRadius.
    const targetAdditions = INNER_ANCHOR_COUNT + Math.min(INNER_ANCHOR_COUNT, engine.waveCount);
    const existingSnapshot = [...world.balls];
    for (let i = 0; i < targetAdditions && addedCount < targetAdditions; i++) {
      const host = existingSnapshot[Math.floor(engine.random() * existingSnapshot.length)];
      if (!host) {
        break;
      }
      const outwardAngle = Math.atan2(host.y - corePivot.y, host.x - corePivot.x)
        + (engine.random() - MATH_CONSTANTS.HALF) * 0.9;
      const dist = r * engine.physicsConfig.simulation.bondRestDistanceFactor;
      const nx = host.x + Math.cos(outwardAngle) * dist;
      const ny = host.y + Math.sin(outwardAngle) * dist;
      const radialDist = Math.hypot(nx - corePivot.x, ny - corePivot.y);
      if (radialDist + r >= cfg.dangerRadius - r * MATH_CONSTANTS.HALF) {
        continue;
      }
      const overlaps = world.balls.some((b) => Math.hypot(b.x - nx, b.y - ny) < minSpacing * 0.88);
      if (overlaps) {
        continue;
      }
      const ball = engine.createClusterBall({
        x: nx,
        y: ny,
        radius: r,
        isAnchor: false
      });
      world.addBall(ball);
      world.createBond(host, ball, false);
      addedCount++;
    }

    world.rebuildInitialBonds();
    engine.particleSystem.spawnFloatingText(
      corePivot.x,
      corePivot.y - cfg.dangerRadius * MATH_CONSTANTS.HALF,
      t('gameplay.feedback.wave.incoming'),
      engine.gameConfig.theme.wavePopupColor
    );
    engine.unlockAchievementTiers('orbitalWaves', engine.waveCount);
  }

  captureDetachedIntoRadialDrift(engine) {
    const cfg = engine.modesConfig.orbital;
    const world = engine.physicsWorld;
    if (world.droppingBalls.length === 0) {
      return;
    }
    const corePivot = this.getCorePivot(engine);
    const cx = corePivot ? corePivot.x : cfg.coreX;
    const cy = corePivot ? corePivot.y : cfg.coreY;
    const omega = corePivot ? corePivot.angularVelocity : 0;

    while (world.droppingBalls.length > 0) {
      const ball = world.droppingBalls.pop();
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      const tangentVx = -dy * omega * 60;
      const tangentVy = dx * omega * 60;
      engine.modeState.driftingBalls.push({
        x: ball.x,
        y: ball.y,
        vx: ux * cfg.radialDriftSpeed + tangentVx,
        vy: uy * cfg.radialDriftSpeed + tangentVy,
        radius: ball.radius,
        colorId: ball.colorId,
        specialType: ball.specialType
      });
    }
  }

  isAngleInsideCollectorArc(angle, phase, cfg, collectorMagnetLevel = 0) {
    const halfSpan = getCollectorHalfSpan(cfg, collectorMagnetLevel);
    const step = MATH_CONSTANTS.TWO_PI / cfg.collectorArcCount;
    for (let i = 0; i < cfg.collectorArcCount; i++) {
      const center = phase + i * step;
      if (Math.abs(normalizeSignedAngle(angle - center)) <= halfSpan) {
        return true;
      }
    }
    return false;
  }

  onProjectileSettled(engine, { snappedBall, impactVx, impactVy }) {
    if (snappedBall) {
      this.applyImpactAngularImpulse(
        engine,
        snappedBall.x,
        snappedBall.y,
        Number.isFinite(impactVx) ? impactVx : snappedBall.vx,
        Number.isFinite(impactVy) ? impactVy : snappedBall.vy
      );
      // If the core had 0 balls or no nearby bond, moor directly to inner orbit if within inner range.
      const corePivot = this.getCorePivot(engine);
      if (corePivot && snappedBall.bonds.size === 0) {
        const dist = Math.hypot(snappedBall.x - corePivot.x, snappedBall.y - corePivot.y);
        snappedBall.isAnchor = true;
        snappedBall.pivotRef = corePivot;
        snappedBall.pivotRadius = dist;
        snappedBall.pivotAngle = Math.atan2(snappedBall.y - corePivot.y, snappedBall.x - corePivot.x);
      }
    }
    // Return false so standard EngineTurnResolution handles special balls, matches & avalanches!
    return false;
  }

  onAfterPhysicsStep(engine, dtSec) {
    if (!engine.isRunPlaying() || !engine.modeState) {
      return;
    }
    const cfg = engine.modesConfig.orbital;
    this.captureDetachedIntoRadialDrift(engine);

    engine.modeState.collectorPhase =
      (engine.modeState.collectorPhase + ARC_ROTATION_SPEED_RAD_SEC * dtSec) % MATH_CONSTANTS.TWO_PI;

    const drifting = engine.modeState.driftingBalls;
    for (let i = drifting.length - 1; i >= 0; i--) {
      const b = drifting[i];
      const dx = b.x - cfg.coreX;
      const dy = b.y - cfg.coreY;
      const dist = Math.hypot(dx, dy) || 1;
      b.vx += (dx / dist) * cfg.radialDriftAccel * dtSec;
      b.vy += (dy / dist) * cfg.radialDriftAccel * dtSec;
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;

      const newDist = Math.hypot(b.x - cfg.coreX, b.y - cfg.coreY);
      if (newDist >= cfg.dangerRadius - cfg.collectorCatchThickness * MATH_CONSTANTS.HALF) {
        const angle = Math.atan2(b.y - cfg.coreY, b.x - cfg.coreX);
        const collectorLvl = engine.getEffectiveUpgradeLevel?.('collectorMagnet') || 0;
        if (this.isAngleInsideCollectorArc(angle, engine.modeState.collectorPhase, cfg, collectorLvl)) {
          const pts = Math.round(cfg.collectorBonusPoints * Math.max(1, engine.combo));
          engine.addScore(pts);
          engine.addOvercharge(cfg.collectorOverchargeGain);
          engine.audioManager.playEffect('orbitalCatch');
          reportBountyEvent(engine, 'orbital_arc_catch', 1);
          engine.particleSystem.spawnBurst(
            b.x,
            b.y,
            engine.gameConfig.theme.overchargePopupColor,
            engine.gameConfig.juice.bounceBurstCount,
            engine.gameConfig.juice.bounceBurstSpeed
          );
          engine.particleSystem.spawnFloatingText(
            b.x,
            b.y + engine.gameConfig.canvas.floatingTextOffsetY,
            t('gameplay.feedback.orbital.arcCatch', { points: pts }),
            engine.gameConfig.theme.overchargePopupColor
          );
          drifting.splice(i, 1);
          engine.notifyUI();
          continue;
        }
      }
      if (newDist > cfg.dangerRadius + DRIFT_DESPAWN_MARGIN_PX) {
        drifting.splice(i, 1);
      }
    }

    if (!engine.physicsWorld.projectile) {
      this.checkRingBreach(engine);
    }
  }

  checkRingBreach(engine) {
    if (!engine.isRunPlaying()) {
      return;
    }
    const cfg = engine.modesConfig.orbital;
    const anchoredSet = engine.physicsWorld.getAnchoredBallIds();
    let nearDanger = false;
    for (const ball of engine.physicsWorld.balls) {
      if (!anchoredSet.has(ball.id)) {
        continue;
      }
      const dist = Math.hypot(ball.x - cfg.coreX, ball.y - cfg.coreY) + ball.radius;
      if (dist >= cfg.dangerRadius) {
        engine.triggerGameOver(GAME_OVER_REASONS.RING_BREACHED);
        return;
      }
      if (dist >= cfg.nearMissRadius) {
        nearDanger = true;
      }
    }
    if (engine.modeState && nearDanger !== Boolean(engine.modeState.nearDanger)) {
      engine.modeState.nearDanger = nearDanger;
      engine.notifyUI();
    }
  }

  onTurnCleanedUp(engine, { madeMatch, dropped, wasFrozen }) {
    if (!engine.isRunPlaying() || !engine.modeState) {
      return;
    }
    this.captureDetachedIntoRadialDrift(engine);
    const cfg = engine.modesConfig.orbital;

    if (engine.physicsWorld.balls.length === 0) {
      const bonus = cfg.waveClearBonus * engine.waveCount;
      engine.addScore(bonus);
      engine.waveCount++;
      const paletteSize = this.getPaletteCountForWave(
        engine.waveCount,
        cfg,
        engine.ballsConfig.standardColors.length
      );
      engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);
      const cadence = this.getShotsPerWave(engine.waveCount, cfg);
      engine.modeState.waveCadence = cadence;
      engine.modeState.turnsUntilWave = cadence;
      const rings = Math.min(cfg.maxSpawnRings, cfg.initialRings + Math.floor((engine.waveCount - 1) / 2));
      this.spawnCoreCluster(engine, rings);
      engine.refreshStaleLauncherColors();
      engine.particleSystem.spawnFloatingText(
        cfg.coreX,
        cfg.coreY,
        t('gameplay.feedback.orbital.waveCleared', { points: bonus }),
        engine.gameConfig.theme.victoryPopupColor
      );
      engine.unlockAchievementTiers('orbitalWaves', engine.waveCount);
      engine.persistRunHighScore();
      return;
    }

    if (!madeMatch && dropped === 0 && !wasFrozen) {
      engine.modeState.turnsUntilWave = Math.max(0, engine.modeState.turnsUntilWave - 1);
      if (engine.modeState.turnsUntilWave <= 0) {
        this.spawnReinforcementWave(engine);
        engine.refreshStaleLauncherColors();
      }
    }
    this.checkRingBreach(engine);
  }

  evaluateBoardState(engine) {
    this.checkRingBreach(engine);
    return true;
  }

  serializeModeState(engine) {
    const state = engine.modeState || {};
    return {
      turnsUntilWave: state.turnsUntilWave ?? 1,
      waveCadence: state.waveCadence ?? 1,
      collectorPhase: state.collectorPhase ?? MATH_CONSTANTS.QUARTER_PI,
      driftingBalls: Array.isArray(state.driftingBalls)
        ? state.driftingBalls.map(({ x, y, vx, vy, radius, colorId, specialType }) => ({
          x,
          y,
          vx,
          vy,
          radius,
          colorId: colorId ?? null,
          specialType: specialType ?? null
        }))
        : []
    };
  }

  validateModeState(rawState) {
    if (!(
      rawState
      && typeof rawState === 'object'
      && Number.isInteger(rawState.turnsUntilWave)
      && rawState.turnsUntilWave >= 0
      && Number.isFinite(rawState.collectorPhase)
    )) {
      return false;
    }
    if (rawState.driftingBalls === undefined) {
      return true;
    }
    if (!Array.isArray(rawState.driftingBalls)) {
      return false;
    }
    return rawState.driftingBalls.every((entry) => (
      entry
      && typeof entry === 'object'
      && Number.isFinite(entry.x)
      && Number.isFinite(entry.y)
      && Number.isFinite(entry.vx)
      && Number.isFinite(entry.vy)
      && Number.isFinite(entry.radius)
      && entry.radius > 0
      && (entry.colorId === null || typeof entry.colorId === 'string')
      && (entry.specialType === null || entry.specialType === undefined || VALID_SPECIAL_TYPES.has(entry.specialType))
    ));
  }

  restoreModeState(engine, rawState) {
    const cfg = engine.modesConfig.orbital;
    const paletteSize = this.getPaletteCountForWave(
      engine.waveCount,
      cfg,
      engine.ballsConfig.standardColors.length
    );
    engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);
    engine.physicsWorld.gravityMultiplier = 0;
    engine.physicsWorld.customPivotDamping = cfg.angularDamping;
    const driftingBalls = Array.isArray(rawState.driftingBalls)
      ? rawState.driftingBalls.map((entry) => ({
        x: entry.x,
        y: entry.y,
        vx: entry.vx,
        vy: entry.vy,
        radius: entry.radius,
        colorId: entry.colorId ?? null,
        specialType: entry.specialType ?? null
      }))
      : [];
    engine.modeState = {
      turnsUntilWave: Math.max(1, rawState.turnsUntilWave),
      waveCadence: Math.max(1, rawState.waveCadence || cfg.shotsPerRingWave),
      collectorPhase: rawState.collectorPhase,
      driftingBalls
    };
  }

  drawUnderlay(ctx, engine, renderer, theme, now = 0) {
    const cfg = engine.modesConfig.orbital;
    const phase = engine.modeState?.collectorPhase ?? MATH_CONSTANTS.QUARTER_PI;
    const collectorLvl = engine.getEffectiveUpgradeLevel?.('collectorMagnet') || 0;
    const halfSpan = getCollectorHalfSpan(cfg, collectorLvl);
    const step = MATH_CONSTANTS.TWO_PI / cfg.collectorArcCount;
    const dangerColor = theme.dangerLineColor || theme.dangerZoneColor;
    const nearDanger = Boolean(engine.modeState?.nearDanger);

    ctx.save();
    // Subtle warning halo inside containment boundary
    ctx.strokeStyle = dangerColor;
    ctx.globalAlpha = nearDanger ? NEAR_MISS_RING_ALPHA * 1.8 : NEAR_MISS_RING_ALPHA;
    ctx.lineWidth = nearDanger ? 1.5 : 1;
    ctx.setLineDash(RING_DASH_PATTERN);
    ctx.beginPath();
    ctx.arc(cfg.coreX, cfg.coreY, cfg.nearMissRadius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.stroke();

    // Outer containment ring (pulses urgently when anchored spheres cross nearMissRadius)
    if (nearDanger) {
      ctx.globalAlpha = engine.isReducedMotion
        ? NEAR_DANGER_RING_STATIC_ALPHA
        : NEAR_DANGER_RING_MIN_ALPHA
          + (Math.sin(now * NEAR_DANGER_PULSE_SPEED) * 0.5 + 0.5) * NEAR_DANGER_RING_AMP_ALPHA;
      ctx.lineWidth = NEAR_DANGER_RING_LINE_WIDTH;
    } else {
      ctx.globalAlpha = CONTAINMENT_RING_ALPHA;
      ctx.lineWidth = RING_LINE_WIDTH;
    }
    ctx.beginPath();
    ctx.arc(cfg.coreX, cfg.coreY, cfg.dangerRadius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4 peripheral Magnetic Collector Arcs
    ctx.strokeStyle = theme.overchargePopupColor;
    ctx.globalAlpha = COLLECTOR_ARC_ALPHA;
    ctx.lineWidth = COLLECTOR_ARC_LINE_WIDTH;
    ctx.lineCap = 'round';
    for (let i = 0; i < cfg.collectorArcCount; i++) {
      const center = phase + i * step;
      ctx.beginPath();
      ctx.arc(cfg.coreX, cfg.coreY, cfg.dangerRadius, center - halfSpan, center + halfSpan);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawOverlay(ctx, engine, renderer) {
    const drifting = engine.modeState?.driftingBalls;
    if (!drifting || drifting.length === 0) {
      return;
    }
    for (const d of drifting) {
      renderer.drawDetachedPreviewBall(ctx, d.x, d.y, d.radius, d.colorId, d.specialType);
    }
  }

  /** Continuous perimeter ratio of the outermost anchored sphere vs containment radius. */
  getPressureState(engine) {
    const cfg = engine.modesConfig?.orbital;
    const world = engine.physicsWorld;
    const state = engine.modeState;
    if (!cfg || !world || !state || !cfg.dangerRadius) {
      return null;
    }
    const anchoredSet = world.getAnchoredBallIds?.() || new Set();
    let maxOuterDist = 0;
    for (const ball of world.balls) {
      if (!anchoredSet.has(ball.id)) {
        continue;
      }
      const dist = Math.hypot(ball.x - cfg.coreX, ball.y - cfg.coreY) + ball.radius;
      if (dist > maxOuterDist) {
        maxOuterDist = dist;
      }
    }
    const ratio = Math.max(0, Math.min(1, maxOuterDist / cfg.dangerRadius));
    const warnThreshold = cfg.nearMissRadius / cfg.dangerRadius;
    const danger = Boolean(state.nearDanger) || ratio >= warnThreshold;
    return {
      active: true,
      modeKey: 'orbital',
      ratio,
      danger,
      critical: ratio >= (1 + warnThreshold) * MATH_CONSTANTS.HALF
    };
  }
}

export const orbitalBehavior = new OrbitalBehavior();
registerModeBehavior(GAME_MODES.ORBITAL, orbitalBehavior);
