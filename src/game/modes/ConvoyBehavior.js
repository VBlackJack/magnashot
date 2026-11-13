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
  MATH_CONSTANTS
} from '../../core/Constants.js';
import { t } from '../../core/I18n.js';
import { Ball } from '../../entities/Ball.js';
import { ModeBehavior, registerModeBehavior } from './ModeBehavior.js';
import { reportBountyEvent } from '../Bounties.js';

const INITIAL_SPAWNED_COUNT = 8;
const TOUCH_TOLERANCE_PX = 2.0;
const BOND_TOLERANCE_FACTOR = 1.18;
const RAIL_OUTER_WIDTH = 14;
const RAIL_INNER_WIDTH = 3;
const RAIL_OUTER_ALPHA = 0.16;
const RAIL_INNER_ALPHA = 0.42;
const VORTEX_SPIN_SPEED = 0.003;
const VORTEX_ARMS = 4;
const VORTEX_RING_ALPHA = 0.88;
const VORTEX_LINE_WIDTH = 2.5;
const VORTEX_INNER_RADIUS_FACTOR = 0.62;
const VORTEX_ARM_ARC_RAD = 1.1;
const CLUMP_NEIGHBOR_CHANCE = 0.35;
const WAVE_CLEAR_POPUP_OFFSET_Y = 70;
const SUPERELLIPSE_EXP = 0.76;
const SNAP_BRIDGE_MIN_ALPHA = 0.55;
const SNAP_BRIDGE_AMP_ALPHA = 0.35;
const SNAP_BRIDGE_STATIC_ALPHA = 0.85;
const SNAP_BRIDGE_PULSE_SPEED = 0.009;
const SNAP_BRIDGE_LINE_WIDTH = 5;
const SNAP_BRIDGE_DASH = Object.freeze([8, 6]);
const SNAP_BRIDGE_DASH_SPEED = 0.035;

const CONVOY_CHROME = Object.freeze({
  ambientLiquid: false,
  collectorBins: false,
  dangerZone: false,
  aimLine: true
});

function evaluateTrackPoint(trackId, u, cx, cy) {
  if (trackId === 'serpent') {
    const theta = Math.PI + u * Math.PI * 2.65;
    const rx = 176 - u * 72;
    const ry = 290 - u * 162;
    return {
      x: cx + Math.cos(theta) * rx,
      y: cy + Math.sin(theta) * ry
    };
  }
  if (trackId === 'figure8') {
    const theta = -Math.PI * MATH_CONSTANTS.HALF + u * Math.PI * 2.85;
    const lobe = 1 + 0.11 * Math.cos(2 * theta);
    const rx = (162 - u * 62) * lobe;
    const ry = (268 - u * 146) * lobe;
    return {
      x: cx + Math.cos(theta) * rx,
      y: cy + Math.sin(theta) * ry
    };
  }
  if (trackId === 'orbitLoop') {
    const theta = Math.PI * MATH_CONSTANTS.HALF + u * Math.PI * 3.1;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const sx = Math.sign(cosT) * Math.pow(Math.abs(cosT), SUPERELLIPSE_EXP);
    const sy = Math.sign(sinT) * Math.pow(Math.abs(sinT), SUPERELLIPSE_EXP);
    const rx = 174 - u * 70;
    const ry = 288 - u * 160;
    return {
      x: cx + sx * rx,
      y: cy + sy * ry
    };
  }
  // Default: 'spiral'
  const theta = -Math.PI * MATH_CONSTANTS.HALF + u * Math.PI * 3.25;
  const rx = 178 - u * 74;
  const ry = 294 - u * 168;
  return {
    x: cx + Math.cos(theta) * rx,
    y: cy + Math.sin(theta) * ry
  };
}

export function buildConvoyTrackLut(trackId, cx, cy, sampleCount) {
  const count = Math.max(32, sampleCount);
  const xs = new Float64Array(count + 1);
  const ys = new Float64Array(count + 1);
  const arcS = new Float64Array(count + 1);

  let cumulative = 0;
  for (let i = 0; i <= count; i++) {
    const u = i / count;
    const pt = evaluateTrackPoint(trackId, u, cx, cy);
    xs[i] = pt.x;
    ys[i] = pt.y;
    if (i > 0) {
      cumulative += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
    arcS[i] = cumulative;
  }

  return {
    trackId,
    count,
    xs,
    ys,
    arcS,
    totalLength: cumulative,
    endX: xs[count],
    endY: ys[count]
  };
}

export function sampleTrackAt(lut, s) {
  const clamped = Math.max(0, Math.min(lut.totalLength, s));
  let low = 0;
  let high = lut.count;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (lut.arcS[mid] <= clamped) {
      low = mid;
    } else {
      high = mid;
    }
  }
  const segLen = lut.arcS[high] - lut.arcS[low];
  const tRatio = segLen > MATH_CONSTANTS.EPSILON ? (clamped - lut.arcS[low]) / segLen : 0;
  const x = lut.xs[low] + (lut.xs[high] - lut.xs[low]) * tRatio;
  const y = lut.ys[low] + (lut.ys[high] - lut.ys[low]) * tRatio;
  const dx = lut.xs[high] - lut.xs[low];
  const dy = lut.ys[high] - lut.ys[low];
  const norm = Math.hypot(dx, dy) || 1;
  return {
    x,
    y,
    tx: dx / norm,
    ty: dy / norm
  };
}

export class ConvoyBehavior extends ModeBehavior {
  constructor() {
    super(GAME_MODES.CONVOY);
    this.lutCache = new Map();
  }

  getTrackLut(engine, trackId) {
    const cfg = engine.modesConfig.convoy;
    const key = `${trackId}:${cfg.turretX}:${cfg.turretY}:${cfg.lutSamples}`;
    let lut = this.lutCache.get(key);
    if (!lut) {
      lut = buildConvoyTrackLut(trackId, cfg.turretX, cfg.turretY, cfg.lutSamples);
      this.lutCache.set(key, lut);
    }
    return lut;
  }

  getLauncherSpec(engine) {
    const cfg = engine.modesConfig.convoy;
    return {
      x: cfg.turretX,
      y: cfg.turretY,
      posture: LAUNCHER_POSTURES.OMNI_360,
      minAngle: -Math.PI,
      maxAngle: Math.PI,
      defaultAngle: -Math.PI * MATH_CONSTANTS.HALF,
      nextOffsetX: cfg.nextOffsetX,
      nextOffsetY: cfg.nextOffsetY,
      compactQueue: true,
      cancelOffset: 0,
      cancelRadius: cfg.cancelRadius
    };
  }

  getRenderChrome() {
    return CONVOY_CHROME;
  }

  offersSpecialBalls() {
    return true;
  }

  isTiltLocked() {
    return true;
  }

  allowsEmptyBoardSnapshot() {
    return true;
  }

  getPaletteCountForWave(wave, cfg, totalColors) {
    const extra = Math.floor(Math.max(0, wave - 1) / Math.max(1, cfg.wavesPerExtraColor));
    return Math.min(totalColors, cfg.maxColorCount, cfg.initialColorCount + extra);
  }

  getAdvanceSpeedForWave(wave, cfg) {
    return Math.min(cfg.maxAdvanceSpeed, cfg.baseAdvanceSpeed + Math.max(0, wave - 1) * cfg.speedPerWave);
  }

  getWaveQuota(wave, cfg) {
    return Math.min(cfg.maxWaveSpheres, cfg.initialWaveSpheres + Math.max(0, wave - 1) * cfg.spheresPerWave);
  }

  setupMode(engine) {
    engine.waveCount = 1;
    this.startConvoyWave(engine, 1);
  }

  startConvoyWave(engine, wave) {
    const cfg = engine.modesConfig.convoy;
    const world = engine.physicsWorld;
    world.clear();
    world.skipClusterStep = true;

    const paletteSize = this.getPaletteCountForWave(wave, cfg, engine.ballsConfig.standardColors.length);
    engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);

    const tracks = cfg.tracks;
    const trackId = tracks[(wave - 1) % tracks.length];
    const lut = this.getTrackLut(engine, trackId);
    const quota = this.getWaveQuota(wave, cfg);
    const initialCount = Math.min(quota, INITIAL_SPAWNED_COUNT);

    engine.modeState = {
      trackId,
      spawnRemaining: quota - initialCount,
      freezeTimerSec: 0,
      recoilSpeed: 0,
      lastSpawnColorId: ''
    };

    for (let i = 0; i < initialCount; i++) {
      const s = (initialCount - 1 - i) * cfg.ballSpacing;
      this.spawnConvoyBallAt(engine, lut, s);
    }
    this.sortAndSyncConvoy(engine, lut);
  }

  pickTrainColor(engine, neighborColor = null) {
    // Favor slight 2-sphere clumping without creating automatic 3-matches on spawn.
    const balls = engine.physicsWorld.balls;
    if (balls.length >= 2) {
      const c0 = balls[0]?.colorId;
      const c1 = balls[1]?.colorId;
      if (c0 && c0 === c1) {
        const filtered = engine.activePalette.filter((id) => id !== c0);
        if (filtered.length > 0) {
          return filtered[Math.floor(engine.random() * filtered.length)];
        }
      }
    }
    if (neighborColor && engine.random() < CLUMP_NEIGHBOR_CHANCE && engine.activePalette.includes(neighborColor)) {
      return neighborColor;
    }
    return engine.activePalette[Math.floor(engine.random() * engine.activePalette.length)];
  }

  spawnConvoyBallAt(engine, lut, s) {
    const r = engine.physicsConfig.ball.radius;
    const pt = sampleTrackAt(lut, Math.max(0, s));
    const rearNeighborColor = engine.physicsWorld.balls[0]?.colorId ?? null;
    const colorId = this.pickTrainColor(engine, rearNeighborColor);
    const ball = new Ball({
      x: pt.x,
      y: pt.y,
      radius: r,
      colorId,
      isAnchor: true
    });
    ball.convoyS = s;
    ball.convoyRecoil = 0;
    engine.physicsWorld.balls.unshift(ball);
    engine.physicsWorld.ballMap.set(ball.id, ball);
    return ball;
  }

  areEndsMagneticallyAttracted(engine, rearBall, frontBall) {
    if (!rearBall?.colorId || !frontBall?.colorId) {
      return false;
    }
    if (rearBall.colorId === frontBall.colorId) {
      return true;
    }
    const polA = engine.physicsWorld.polarityMap.get(rearBall.colorId) || 0;
    const polB = engine.physicsWorld.polarityMap.get(frontBall.colorId) || 0;
    return polA * polB < 0;
  }

  sortAndSyncConvoy(engine, lut) {
    const cfg = engine.modesConfig.convoy;
    const world = engine.physicsWorld;
    world.balls.sort((a, b) => (a.convoyS ?? 0) - (b.convoyS ?? 0));

    for (const ball of world.balls) {
      ball.bonds.clear();
      ball.isAnchor = true;
      const sample = sampleTrackAt(lut, Math.max(0, ball.convoyS));
      ball.x = sample.x;
      ball.y = sample.y;
      ball.anchorX = sample.x;
      ball.anchorY = sample.y;
      ball.vx = 0;
      ball.vy = 0;
    }

    const maxBondGap = cfg.ballSpacing * BOND_TOLERANCE_FACTOR;
    for (let i = 0; i < world.balls.length - 1; i++) {
      const a = world.balls[i];
      const b = world.balls[i + 1];
      if (b.convoyS - a.convoyS <= maxBondGap) {
        world.createBond(a, b, false);
      }
    }
    world.aimCacheValid = false;
  }

  onBeforePhysicsStep(engine, dtSec) {
    if (!engine.isRunPlaying() || !engine.modeState) {
      return;
    }
    const cfg = engine.modesConfig.convoy;
    const state = engine.modeState;
    const world = engine.physicsWorld;
    const lut = this.getTrackLut(engine, state.trackId);

    if (state.freezeTimerSec > 0) {
      state.freezeTimerSec = Math.max(0, state.freezeTimerSec - dtSec);
      if (state.freezeTimerSec === 0) {
        for (const b of world.balls) {
          b.isFrozen = false;
        }
      }
    }

    // Spawn queued rear spheres whenever space opens at s = 0
    while (
      state.spawnRemaining > 0
      && (world.balls.length === 0 || world.balls[0].convoyS >= cfg.ballSpacing)
    ) {
      const nextS = world.balls.length === 0 ? 0 : world.balls[0].convoyS - cfg.ballSpacing;
      this.spawnConvoyBallAt(engine, lut, nextS);
      state.spawnRemaining--;
    }

    if (world.balls.length === 0) {
      if (state.nearDanger) {
        state.nearDanger = false;
        engine.notifyUI();
      }
      if (state.spawnRemaining <= 0 && !world.projectile) {
        this.completeConvoyWave(engine);
      }
      return;
    }

    world.balls.sort((a, b) => a.convoyS - b.convoyS);

    const isFrozen = state.freezeTimerSec > 0 || engine.freezeTurnsRemaining > 0;
    const speedMult = isFrozen ? cfg.freezeSpeedFactor : 1;
    let pushSpeed = this.getAdvanceSpeedForWave(engine.waveCount, cfg) * speedMult;
    const leadS = world.balls[world.balls.length - 1].convoyS;
    if (leadS < cfg.entryBoostLength) {
      pushSpeed *= cfg.entryBoostMultiplier;
    }

    // Group spheres into contiguous touching segments
    const segments = [];
    let segStart = 0;
    for (let i = 1; i < world.balls.length; i++) {
      if (world.balls[i].convoyS - world.balls[i - 1].convoyS > cfg.ballSpacing + TOUCH_TOLERANCE_PX) {
        segments.push({ start: segStart, end: i - 1 });
        segStart = i;
      }
    }
    segments.push({ start: segStart, end: world.balls.length - 1 });

    // Rear segment always advances driven by the convoy engine
    const rearSeg = segments[0];
    const rearDelta = pushSpeed * dtSec;
    for (let i = rearSeg.start; i <= rearSeg.end; i++) {
      world.balls[i].convoyS += rearDelta;
      world.balls[i].convoyRecoil = 0;
    }

    // Forward segments separated by a gap either snap backward magnetically or wait
    let snapbackImpactBall = null;
    for (let sIdx = 1; sIdx < segments.length; sIdx++) {
      const prevSeg = segments[sIdx - 1];
      const currSeg = segments[sIdx];
      const rearBall = world.balls[prevSeg.end];
      const frontBall = world.balls[currSeg.start];

      if (this.areEndsMagneticallyAttracted(engine, rearBall, frontBall)) {
        const nextRecoil = Math.min(
          cfg.maxRecoilSpeed,
          (frontBall.convoyRecoil || 0) + cfg.recoilAcceleration * dtSec
        );
        const recoilDelta = nextRecoil * dtSec;
        for (let i = currSeg.start; i <= currSeg.end; i++) {
          world.balls[i].convoyS -= recoilDelta;
          world.balls[i].convoyRecoil = nextRecoil;
        }
      } else {
        for (let i = currSeg.start; i <= currSeg.end; i++) {
          world.balls[i].convoyRecoil = 0;
        }
      }

      // Check collision / merge between prevSeg and currSeg (same threshold as segment split so no deadband exists)
      const gap = world.balls[currSeg.start].convoyS - world.balls[prevSeg.end].convoyS;
      if (gap <= cfg.ballSpacing + TOUCH_TOLERANCE_PX) {
        const wasRecoiling = (frontBall.convoyRecoil || 0) > 0;
        const correction = cfg.ballSpacing - gap;
        for (let i = currSeg.start; i <= currSeg.end; i++) {
          world.balls[i].convoyS += correction;
          world.balls[i].convoyRecoil = 0;
        }
        if (wasRecoiling && !snapbackImpactBall) {
          snapbackImpactBall = rearBall;
        }
      }
    }

    // Enforce minimum spacing across the whole train
    for (let i = 1; i < world.balls.length; i++) {
      if (world.balls[i].convoyS - world.balls[i - 1].convoyS < cfg.ballSpacing) {
        world.balls[i].convoyS = world.balls[i - 1].convoyS + cfg.ballSpacing;
      }
    }

    this.sortAndSyncConvoy(engine, lut);

    if (snapbackImpactBall && world.ballMap.has(snapbackImpactBall.id)) {
      this.resolveSnapbackCollision(engine, snapbackImpactBall, lut);
    }

    // Check Singularity drain defeat & near-danger transition
    if (engine.isRunPlaying() && world.balls.length > 0) {
      const frontMost = world.balls[world.balls.length - 1];
      const progress = lut.totalLength > 0 ? frontMost.convoyS / lut.totalLength : 0;
      const nextDanger = progress >= cfg.nearMissProgress;
      if (nextDanger !== Boolean(state.nearDanger)) {
        state.nearDanger = nextDanger;
        engine.notifyUI();
      }
      if (frontMost.convoyS >= lut.totalLength) {
        engine.triggerGameOver(GAME_OVER_REASONS.VORTEX_REACHED);
      }
    } else if (state.nearDanger) {
      state.nearDanger = false;
      engine.notifyUI();
    }
  }

  resolveSnapbackCollision(engine, impactBall, lut) {
    const cfg = engine.modesConfig.convoy;
    const world = engine.physicsWorld;
    engine.audioManager.playEffect('convoySnapback');
    reportBountyEvent(engine, 'convoy_snapback', 1);
    engine.particleSystem.spawnShockwave(
      impactBall.x,
      impactBall.y,
      engine.gameConfig.theme.chainPopupColor,
      impactBall.radius * 3
    );

    const cluster = world.findColorCluster(impactBall);
    const minMatch = engine.gameConfig.defaults.matchMinCount;
    if (cluster.length >= minMatch) {
      const pts = cfg.snapbackBonusPoints * Math.max(1, engine.combo + 1);
      engine.addScore(pts);
      engine.particleSystem.spawnFloatingText(
        impactBall.x,
        impactBall.y + engine.gameConfig.canvas.floatingTextOffsetY,
        t('gameplay.feedback.convoy.snapback', { points: pts }),
        engine.gameConfig.theme.chainPopupColor
      );
      engine.resolveColorMatchCluster(cluster, impactBall, true);
      this.ensureVisibleConvoyBall(engine, lut);
      this.sortAndSyncConvoy(engine, lut);
      if (world.balls.length === 0 && engine.modeState.spawnRemaining <= 0 && !world.projectile) {
        this.completeConvoyWave(engine);
      }
      engine.refreshStaleLauncherColors();
      engine.saveRunSnapshot();
      engine.notifyUI();
    }
  }

  ensureVisibleConvoyBall(engine, lut) {
    if (engine.physicsWorld.balls.length === 0 && engine.modeState?.spawnRemaining > 0) {
      this.spawnConvoyBallAt(engine, lut, 0);
      engine.modeState.spawnRemaining--;
    }
  }

  onProjectileSettled(engine, { snappedBall, hitTarget }) {
    if (!snappedBall || !engine.modeState) {
      return false;
    }
    if (snappedBall.specialType) {
      // Special spheres detonate in place without inserting into the train or pushing lead spheres forward
      const prevFreeze = engine.freezeTurnsRemaining;
      engine.modeState.pendingSpecialType = snappedBall.specialType;
      engine.modeState.prevFreezeTurns = prevFreeze;
      return false;
    }
    const cfg = engine.modesConfig.convoy;
    const world = engine.physicsWorld;
    const lut = this.getTrackLut(engine, engine.modeState.trackId);

    // Determine exact insertion arc-length along the convoy rail
    let target = hitTarget;
    if (!target && world.balls.length > 1) {
      let bestDist = Infinity;
      for (const b of world.balls) {
        if (b.id === snappedBall.id) {
          continue;
        }
        const d = Math.hypot(b.x - snappedBall.x, b.y - snappedBall.y);
        if (d < bestDist) {
          bestDist = d;
          target = b;
        }
      }
    }

    if (target && Number.isFinite(target.convoyS)) {
      const sample = sampleTrackAt(lut, target.convoyS);
      const dot = (snappedBall.x - sample.x) * sample.tx + (snappedBall.y - sample.y) * sample.ty;
      const targetIndex = world.balls.indexOf(target);
      const insertAhead = dot >= 0;
      snappedBall.convoyS = insertAhead
        ? target.convoyS + cfg.ballSpacing * MATH_CONSTANTS.HALF
        : Math.max(0, target.convoyS - cfg.ballSpacing * MATH_CONSTANTS.HALF);
      snappedBall.convoyRecoil = 0;
      snappedBall.isAnchor = true;

      // Sort and push forward spheres ahead smoothly so the inserted ball opens space cleanly
      world.balls.sort((a, b) => (a.convoyS ?? 0) - (b.convoyS ?? 0));
      const insertedIdx = world.balls.indexOf(snappedBall);
      if (insertedIdx > 0) {
        const prev = world.balls[insertedIdx - 1];
        if (snappedBall.convoyS - prev.convoyS < cfg.ballSpacing) {
          snappedBall.convoyS = prev.convoyS + cfg.ballSpacing;
        }
      }
      for (let i = Math.max(1, insertedIdx + 1); i < world.balls.length; i++) {
        if (world.balls[i].convoyS - world.balls[i - 1].convoyS < cfg.ballSpacing) {
          world.balls[i].convoyS = world.balls[i - 1].convoyS + cfg.ballSpacing;
        }
      }
      if (targetIndex === -1) {
        snappedBall.convoyS = 0;
      }
    } else {
      snappedBall.convoyS = 0;
      snappedBall.convoyRecoil = 0;
      snappedBall.isAnchor = true;
    }

    this.sortAndSyncConvoy(engine, lut);

    engine.audioManager.playEffect('snap');
    engine.startImpactWave(snappedBall);
    engine.particleSystem.addScreenShake(engine.gameConfig.juice.snapShake, engine.gameConfig.juice.maxShakeOffset);

    const cluster = world.findColorCluster(snappedBall);
    const minMatch = engine.gameConfig.defaults.matchMinCount;
    let madeMatch = false;
    if (cluster.length >= minMatch) {
      madeMatch = engine.resolveColorMatchCluster(cluster, snappedBall, false) > 0;
      this.ensureVisibleConvoyBall(engine, lut);
      this.sortAndSyncConvoy(engine, lut);
    } else {
      engine.combo = 0;
    }

    engine.settleTurnResonance(madeMatch);
    if (world.balls.length === 0 && engine.modeState.spawnRemaining <= 0) {
      this.completeConvoyWave(engine);
    } else {
      engine.refreshStaleLauncherColors();
      engine.updateAimFromAngle(engine.aimAngle);
      engine.saveRunSnapshot();
    }
    engine.notifyUI();
    return true;
  }

  onTurnCleanedUp(engine) {
    if (!engine.isRunPlaying() || !engine.modeState) {
      return;
    }
    const cfg = engine.modesConfig.convoy;
    const lut = this.getTrackLut(engine, engine.modeState.trackId);
    if (engine.freezeTurnsRemaining > 0) {
      engine.modeState.freezeTimerSec = cfg.freezeDurationSec;
      engine.freezeTurnsRemaining = 0;
    }
    engine.modeState.pendingSpecialType = null;
    this.ensureVisibleConvoyBall(engine, lut);
    this.sortAndSyncConvoy(engine, lut);
    if (engine.physicsWorld.balls.length === 0 && engine.modeState.spawnRemaining <= 0) {
      this.completeConvoyWave(engine);
    }
  }

  completeConvoyWave(engine) {
    const cfg = engine.modesConfig.convoy;
    const clearedWave = engine.waveCount;
    const bonus = cfg.waveClearBonus * clearedWave;
    engine.addScore(bonus);
    engine.audioManager.playEffect('victory');
    engine.particleSystem.spawnFloatingText(
      cfg.turretX,
      cfg.turretY - WAVE_CLEAR_POPUP_OFFSET_Y,
      t('gameplay.feedback.convoy.waveCleared', { points: bonus }),
      engine.gameConfig.theme.victoryPopupColor
    );

    engine.waveCount = clearedWave + 1;
    this.startConvoyWave(engine, engine.waveCount);
    engine.refreshStaleLauncherColors();
    engine.unlockAchievementTiers('convoyWaves', engine.waveCount);
    engine.persistRunHighScore();
    engine.updateAimFromAngle(engine.aimAngle);
    engine.saveRunSnapshot({ force: true });
    engine.notifyUI({ convoyWaveCleared: clearedWave });
  }

  evaluateBoardState(engine) {
    if (!engine.isRunPlaying() || !engine.modeState) {
      return true;
    }
    const lut = this.getTrackLut(engine, engine.modeState.trackId);
    const balls = engine.physicsWorld.balls;
    if (balls.length === 0 && engine.modeState.spawnRemaining <= 0 && !engine.physicsWorld.projectile) {
      this.completeConvoyWave(engine);
      return true;
    }
    if (balls.length > 0 && balls[balls.length - 1].convoyS >= lut.totalLength) {
      engine.triggerGameOver(GAME_OVER_REASONS.VORTEX_REACHED);
    }
    return true;
  }

  serializeModeState(engine) {
    const state = engine.modeState || {};
    return {
      trackId: state.trackId || engine.modesConfig.convoy.tracks[0],
      spawnRemaining: state.spawnRemaining ?? 0,
      freezeTimerSec: state.freezeTimerSec ?? 0,
      positionsS: engine.physicsWorld.balls.map((b) => (Number.isFinite(b.convoyS) ? b.convoyS : 0))
    };
  }

  validateModeState(rawState) {
    return Boolean(
      rawState
      && typeof rawState === 'object'
      && typeof rawState.trackId === 'string'
      && Number.isInteger(rawState.spawnRemaining)
      && rawState.spawnRemaining >= 0
      && Array.isArray(rawState.positionsS)
      && (rawState.positionsS.length > 0 || rawState.spawnRemaining > 0)
    );
  }

  restoreModeState(engine, rawState) {
    const cfg = engine.modesConfig.convoy;
    const paletteSize = this.getPaletteCountForWave(
      engine.waveCount,
      cfg,
      engine.ballsConfig.standardColors.length
    );
    engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);
    engine.physicsWorld.skipClusterStep = true;

    const validTrack = cfg.tracks.includes(rawState.trackId) ? rawState.trackId : cfg.tracks[0];
    const lut = this.getTrackLut(engine, validTrack);

    engine.modeState = {
      trackId: validTrack,
      spawnRemaining: rawState.spawnRemaining,
      freezeTimerSec: Math.max(0, Number(rawState.freezeTimerSec) || 0),
      recoilSpeed: 0,
      lastSpawnColorId: ''
    };

    const balls = engine.physicsWorld.balls;
    for (let i = 0; i < balls.length; i++) {
      balls[i].convoyS = Number.isFinite(rawState.positionsS[i]) ? rawState.positionsS[i] : i * cfg.ballSpacing;
      balls[i].convoyRecoil = 0;
    }
    this.ensureVisibleConvoyBall(engine, lut);
    this.sortAndSyncConvoy(engine, lut);
  }

  drawUnderlay(ctx, engine, renderer, theme, now = 0) {
    const cfg = engine.modesConfig.convoy;
    const trackId = engine.modeState?.trackId || cfg.tracks[0];
    const lut = this.getTrackLut(engine, trackId);
    const railColor = theme.launcherAccentColor || theme.aimLineColor;
    const vortexColor = theme.dangerLineColor || theme.dangerZoneColor;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(lut.xs[0], lut.ys[0]);
    for (let i = 1; i <= lut.count; i++) {
      ctx.lineTo(lut.xs[i], lut.ys[i]);
    }
    ctx.strokeStyle = railColor;
    ctx.globalAlpha = RAIL_OUTER_ALPHA;
    ctx.lineWidth = RAIL_OUTER_WIDTH;
    ctx.stroke();

    ctx.globalAlpha = RAIL_INNER_ALPHA;
    ctx.lineWidth = RAIL_INNER_WIDTH;
    ctx.stroke();

    // Highlight magnetically attracted Snapback gaps along the LUT curve
    const balls = engine.physicsWorld?.balls;
    if (balls && balls.length > 1) {
      const sorted = [...balls].sort((a, b) => a.convoyS - b.convoyS);
      ctx.save();
      ctx.strokeStyle = theme.overchargePopupColor;
      ctx.lineWidth = SNAP_BRIDGE_LINE_WIDTH;
      ctx.setLineDash(SNAP_BRIDGE_DASH);
      ctx.lineDashOffset = engine.isReducedMotion ? 0 : -(now * SNAP_BRIDGE_DASH_SPEED);
      ctx.globalAlpha = engine.isReducedMotion
        ? SNAP_BRIDGE_STATIC_ALPHA
        : SNAP_BRIDGE_MIN_ALPHA
          + (Math.sin(now * SNAP_BRIDGE_PULSE_SPEED) * 0.5 + 0.5) * SNAP_BRIDGE_AMP_ALPHA;
      for (let i = 1; i < sorted.length; i++) {
        const rear = sorted[i - 1];
        const front = sorted[i];
        if (front.convoyS - rear.convoyS <= cfg.ballSpacing + TOUCH_TOLERANCE_PX) {
          continue;
        }
        if (!this.areEndsMagneticallyAttracted(engine, rear, front)) {
          continue;
        }
        const startS = Math.max(0, rear.convoyS);
        const endS = Math.min(lut.totalLength, front.convoyS);
        if (endS <= startS) {
          continue;
        }
        const startPt = sampleTrackAt(lut, startS);
        const endPt = sampleTrackAt(lut, endS);
        ctx.beginPath();
        ctx.moveTo(startPt.x, startPt.y);
        for (let k = 0; k <= lut.count; k++) {
          if (lut.arcS[k] > startS && lut.arcS[k] < endS) {
            ctx.lineTo(lut.xs[k], lut.ys[k]);
          }
        }
        ctx.lineTo(endPt.x, endPt.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw Singularity Vortex at end of rail
    const spin = engine.isReducedMotion ? 0 : now * VORTEX_SPIN_SPEED;
    ctx.translate(lut.endX, lut.endY);
    ctx.rotate(spin);
    ctx.strokeStyle = vortexColor;
    ctx.globalAlpha = VORTEX_RING_ALPHA;
    ctx.lineWidth = VORTEX_LINE_WIDTH;
    ctx.beginPath();
    ctx.arc(0, 0, cfg.vortexRadius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.stroke();

    for (let a = 0; a < VORTEX_ARMS; a++) {
      const armAngle = (a / VORTEX_ARMS) * MATH_CONSTANTS.TWO_PI;
      ctx.beginPath();
      ctx.arc(0, 0, cfg.vortexRadius * VORTEX_INNER_RADIUS_FACTOR, armAngle, armAngle + VORTEX_ARM_ARC_RAD);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Continuous progress of the front-most convoy sphere toward the vortex drain. */
  getPressureState(engine) {
    const cfg = engine.modesConfig?.convoy;
    const world = engine.physicsWorld;
    const state = engine.modeState;
    if (!cfg || !world || !state) {
      return null;
    }
    if (!world.balls.length) {
      return { active: true, modeKey: 'convoy', ratio: 0, danger: false, critical: false };
    }
    const lut = this.getTrackLut(engine, state.trackId || cfg.tracks[0]);
    if (!lut || lut.totalLength <= 0) {
      return { active: true, modeKey: 'convoy', ratio: 0, danger: false, critical: false };
    }
    let maxS = 0;
    for (const ball of world.balls) {
      if (Number.isFinite(ball.convoyS) && ball.convoyS > maxS) {
        maxS = ball.convoyS;
      }
    }
    const ratio = Math.max(0, Math.min(1, maxS / lut.totalLength));
    const danger = Boolean(state.nearDanger) || ratio >= cfg.nearMissProgress;
    return {
      active: true,
      modeKey: 'convoy',
      ratio,
      danger,
      critical: ratio >= (1 + cfg.nearMissProgress) * MATH_CONSTANTS.HALF
    };
  }
}

export const convoyBehavior = new ConvoyBehavior();
registerModeBehavior(GAME_MODES.CONVOY, convoyBehavior);
