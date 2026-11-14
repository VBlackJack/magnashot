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
  MATH_CONSTANTS,
  OBSTACLE_TYPES,
  SLINGSHOT_ALLOWED_SPECIALS
} from '../../core/Constants.js';
import { t } from '../../core/I18n.js';
import { Ball } from '../../entities/Ball.js';
import { Obstacle } from '../../entities/Obstacle.js';
import { ModeBehavior, registerModeBehavior } from './ModeBehavior.js';
import { reportBountyEvent } from '../Bounties.js';

const SLINGSHOT_CHROME = Object.freeze({
  ambientLiquid: true,
  collectorBins: true,
  dangerZone: false,
  aimLine: true
});

const SAFE_WALL_BUFFER_PX = 5;
const TWO_SLOT_LEFT_FRAC = 0.16;
const TWO_SLOT_RIGHT_FRAC = 0.84;
const FOUR_SLOT_TOP_INNER_FRAC = 0.55;
const FOUR_SLOT_BOTTOM_INNER_FRAC = 0.275;
const BARRIER_BELOW_CONSTELLATION_OFFSET = 82;
const BARRIER_LEFT_FRAC = 0.24;
const BARRIER_RIGHT_FRAC = 0.76;
const WELL_TRIPLE_LEFT_FRAC = 0.18;
const WELL_TRIPLE_RIGHT_FRAC = 0.82;
const WELL_DUAL_LEFT_FRAC = 0.28;
const WELL_DUAL_RIGHT_FRAC = 0.72;
const WELL_FIELD_DASH = Object.freeze([6, 6]);
const WHIP_RING_DASH = Object.freeze([4, 4]);
const WELL_FIELD_LINE_WIDTH = 1.5;
const WELL_CORE_LINE_WIDTH = 2.5;
const WELL_GLYPH_SIZE_FACTOR = 0.48;
const WELL_GLYPH_LINE_WIDTH = 2.6;
const WELL_PULSE_SPEED = 0.0032;
const WELL_PULSE_MIN_RATIO = 0.28;
const WELL_PULSE_SPAN_RATIO = 0.68;
const WELL_FIELD_ALPHA = 0.26;
const WELL_PULSE_ALPHA = 0.34;
const WELL_WHIP_READY_ALPHA = 0.65;
const WELL_CORE_FILL_ALPHA = 0.22;
const CORE_HALO_OFFSET = 5;
const CORE_OUTER_HALO_OFFSET = 9;
const CORE_HALO_LINE_WIDTH = 2.4;
const CORE_PULSE_MIN_ALPHA = 0.52;
const CORE_PULSE_AMP_ALPHA = 0.36;
const CORE_PULSE_SPEED = 0.005;
const CORE_CROSSHAIR_SIZE_FACTOR = 0.44;
const CORE_CROSSHAIR_ALPHA = 0.92;
const WHIP_SHOCKWAVE_FACTOR = 0.85;
const DIRECT_CORE_BURST_FACTOR = 2.8;

/**
 * Magnetic Slingshot mode (`slingshot`):
 * - Upward trick-shot arena driven by stationary Dipole Gravity Wells (`+` / `-`) and Deflector Barriers.
 * - Pre-shot Polarity (`F`) flips every Dipole Well polarity, curving the exact live preview in reverse.
 * - Mid-flight Polarity (`F`) inside a Dipole Well's whip zone triggers a Polarity Whip speed surge
 *   and awards a `whipScoreMultiplier` bonus on Radiant Cores shattered that turn.
 * - Clearing all Radiant Cores (`ball.slingshotCore`) advances to the next stage and refills shots.
 */
export class SlingshotBehavior extends ModeBehavior {
  constructor() {
    super(GAME_MODES.SLINGSHOT);
  }

  getRenderChrome() {
    return SLINGSHOT_CHROME;
  }

  offersSpecialBalls() {
    return true;
  }

  isSpecialTypeAllowed(specialType) {
    return SLINGSHOT_ALLOWED_SPECIALS.includes(specialType);
  }

  getPauseTipKey() {
    return 'modals.pause.instructions.slingshotTip';
  }

  isTiltLocked() {
    return true;
  }

  getPaletteCountForStage(stage, cfg, totalColors) {
    const extra = Math.floor(Math.max(0, stage - 1) / Math.max(1, cfg.stagesPerExtraColor));
    return Math.min(totalColors, cfg.maxColorCount, cfg.initialColorCount + extra);
  }

  getConstellationCountForStage(stage, cfg) {
    const extra = Math.floor(Math.max(0, stage - 1) / Math.max(1, cfg.stagesPerExtraConstellation));
    return Math.min(cfg.maxConstellations, Math.max(cfg.minConstellations, cfg.minConstellations + extra));
  }

  getEffectiveWhipRadius(engine) {
    const cfg = engine.modesConfig.slingshot;
    const magnetLevel = engine.getEffectiveUpgradeLevel?.('collectorMagnet') || 0;
    return cfg.whipRadius + magnetLevel * cfg.whipRadiusPerLevel;
  }

  syncWorldWellFields(engine) {
    const world = engine.physicsWorld;
    const wells = engine.modeState?.wells;
    if (!Array.isArray(wells) || wells.length === 0) {
      world.projectileFields = [];
      world.aimCacheValid = false;
      return;
    }
    const flipSign = engine.isPolarityFlipped ? -1 : 1;
    world.projectileFields = wells.map((well) => ({
      x: well.x,
      y: well.y,
      radius: well.fieldRadius,
      force: well.strength * well.polarity * flipSign
    }));
    world.aimCacheValid = false;
  }

  configureWorldHooks(engine) {
    const cfg = engine.modesConfig.slingshot;
    const world = engine.physicsWorld;
    world.gravityMultiplier = 0;
    world.disableMagneticCurve = true;
    world.disableBounceCap = true;
    world.customProjectileStep = (projectile, _dt, callbacks) => {
      if (!engine.modeState) {
        return null;
      }
      engine.modeState.flightSubsteps = (engine.modeState.flightSubsteps || 0) + 1;
      const outY = engine.gameConfig.canvas.logicalHeight + projectile.radius * cfg.floorOutMarginFactor;
      if (projectile.y > outY || engine.modeState.flightSubsteps >= cfg.maxFlightSubsteps) {
        world.projectile = null;
        if (callbacks?.onProjectileMissed) {
          callbacks.onProjectileMissed(projectile);
        }
        return true;
      }
      return null;
    };
    this.syncWorldWellFields(engine);
  }

  setupMode(engine, { stage = 1 } = {}) {
    const cfg = engine.modesConfig.slingshot;
    engine.slingshotStage = Math.max(1, stage);
    engine.waveCount = engine.slingshotStage;
    engine.shotsRemaining = cfg.startingShots + engine.getStartingShotsBonus();
    this.buildStageBoard(engine, engine.slingshotStage);
  }

  buildConstellationSpecs(stage, count, cfg, canvasCfg, restDist, ballRadius) {
    const minSafeX = Math.max(
      cfg.constellationMarginX,
      canvasCfg.wallMargin + restDist + ballRadius + SAFE_WALL_BUFFER_PX
    );
    const maxSafeX = Math.min(
      canvasCfg.logicalWidth - cfg.constellationMarginX,
      canvasCfg.logicalWidth - canvasCfg.wallMargin - restDist - ballRadius - SAFE_WALL_BUFFER_PX
    );
    const leftX = Math.min(minSafeX, canvasCfg.logicalWidth * MATH_CONSTANTS.HALF);
    const rightX = Math.max(maxSafeX, leftX);
    const spanX = Math.max(0, rightX - leftX);
    const centerX = canvasCfg.logicalWidth * MATH_CONSTANTS.HALF;
    const midY = (cfg.constellationTopY + cfg.constellationBottomY) * MATH_CONSTANTS.HALF;
    const parity = stage % 2 === 0 ? -1 : 1;

    if (count <= 2) {
      return [
        {
          x: leftX + spanX * TWO_SLOT_LEFT_FRAC,
          y: midY,
          openAngle: parity > 0 ? 0 : -MATH_CONSTANTS.QUARTER_PI
        },
        {
          x: leftX + spanX * TWO_SLOT_RIGHT_FRAC,
          y: midY,
          openAngle: parity > 0 ? Math.PI : Math.PI + MATH_CONSTANTS.QUARTER_PI
        }
      ];
    }

    if (count === 3) {
      return [
        { x: leftX, y: cfg.constellationTopY, openAngle: MATH_CONSTANTS.QUARTER_PI },
        {
          x: centerX,
          y: cfg.constellationBottomY,
          openAngle: parity > 0 ? 0 : Math.PI
        },
        { x: rightX, y: cfg.constellationTopY, openAngle: Math.PI - MATH_CONSTANTS.QUARTER_PI }
      ];
    }

    return [
      { x: leftX, y: cfg.constellationTopY, openAngle: MATH_CONSTANTS.QUARTER_PI },
      {
        x: leftX + spanX * FOUR_SLOT_TOP_INNER_FRAC,
        y: cfg.constellationTopY,
        openAngle: -Math.PI * MATH_CONSTANTS.HALF
      },
      {
        x: leftX + spanX * FOUR_SLOT_BOTTOM_INNER_FRAC,
        y: cfg.constellationBottomY,
        openAngle: Math.PI
      },
      { x: rightX, y: cfg.constellationBottomY, openAngle: Math.PI - MATH_CONSTANTS.QUARTER_PI }
    ];
  }

  buildDipoleWells(stage, cfg, canvasCfg) {
    const minWellX = Math.max(cfg.wellMarginX, canvasCfg.wallMargin + cfg.wellCoreRadius + SAFE_WALL_BUFFER_PX);
    const maxWellX = Math.min(
      canvasCfg.logicalWidth - cfg.wellMarginX,
      canvasCfg.logicalWidth - canvasCfg.wallMargin - cfg.wellCoreRadius - SAFE_WALL_BUFFER_PX
    );
    const spanX = Math.max(0, maxWellX - minWellX);
    const centerX = canvasCfg.logicalWidth * MATH_CONSTANTS.HALF;
    const midY = (cfg.wellBandTopY + cfg.wellBandBottomY) * MATH_CONSTANTS.HALF;
    const leadPol = stage % 2 === 1 ? 1 : -1;

    if (stage === 1) {
      return [
        {
          id: 1,
          x: centerX,
          y: midY,
          coreRadius: cfg.wellCoreRadius,
          fieldRadius: cfg.wellFieldRadius,
          strength: cfg.wellStrength,
          polarity: leadPol
        }
      ];
    }

    if (stage % 3 !== 0) {
      return [
        {
          id: 1,
          x: minWellX + spanX * WELL_DUAL_LEFT_FRAC,
          y: cfg.wellBandTopY,
          coreRadius: cfg.wellCoreRadius,
          fieldRadius: cfg.wellFieldRadius,
          strength: cfg.wellStrength,
          polarity: leadPol
        },
        {
          id: 2,
          x: minWellX + spanX * WELL_DUAL_RIGHT_FRAC,
          y: cfg.wellBandBottomY,
          coreRadius: cfg.wellCoreRadius,
          fieldRadius: cfg.wellFieldRadius,
          strength: cfg.wellStrength,
          polarity: -leadPol
        }
      ];
    }

    return [
      {
        id: 1,
        x: minWellX + spanX * WELL_TRIPLE_LEFT_FRAC,
        y: cfg.wellBandBottomY,
        coreRadius: cfg.wellCoreRadius,
        fieldRadius: cfg.wellFieldRadius,
        strength: cfg.wellStrength,
        polarity: leadPol
      },
      {
        id: 2,
        x: centerX,
        y: cfg.wellBandTopY,
        coreRadius: cfg.wellCoreRadius,
        fieldRadius: cfg.wellFieldRadius,
        strength: cfg.wellStrength,
        polarity: -leadPol
      },
      {
        id: 3,
        x: minWellX + spanX * WELL_TRIPLE_RIGHT_FRAC,
        y: cfg.wellBandBottomY,
        coreRadius: cfg.wellCoreRadius,
        fieldRadius: cfg.wellFieldRadius,
        strength: cfg.wellStrength,
        polarity: leadPol
      }
    ];
  }

  buildStageObstacles(stage, cfg, canvasCfg, obstaclesConfig) {
    const halfW = cfg.barrierWidth * MATH_CONSTANTS.HALF;
    const minObsX = Math.max(cfg.barrierMarginX, canvasCfg.wallMargin + halfW + SAFE_WALL_BUFFER_PX);
    const maxObsX = Math.min(
      canvasCfg.logicalWidth - cfg.barrierMarginX,
      canvasCfg.logicalWidth - canvasCfg.wallMargin - halfW - SAFE_WALL_BUFFER_PX
    );
    const spanX = Math.max(0, maxObsX - minObsX);
    const barrierY = Math.max(cfg.barrierBandY, cfg.constellationBottomY + BARRIER_BELOW_CONSTELLATION_OFFSET);

    if (stage % 2 === 1) {
      return [
        new Obstacle(
          {
            type: OBSTACLE_TYPES.BARRIER,
            x: canvasCfg.logicalWidth * MATH_CONSTANTS.HALF,
            y: barrierY,
            width: cfg.barrierWidth,
            height: cfg.barrierHeight
          },
          obstaclesConfig
        )
      ];
    }

    return [
      new Obstacle(
        {
          type: OBSTACLE_TYPES.BARRIER,
          x: minObsX + spanX * BARRIER_LEFT_FRAC,
          y: barrierY,
          width: cfg.barrierWidth,
          height: cfg.barrierHeight
        },
        obstaclesConfig
      ),
      new Obstacle(
        {
          type: OBSTACLE_TYPES.BARRIER,
          x: minObsX + spanX * BARRIER_RIGHT_FRAC,
          y: barrierY,
          width: cfg.barrierWidth,
          height: cfg.barrierHeight
        },
        obstaclesConfig
      )
    ];
  }

  buildStageBoard(engine, stage = engine.slingshotStage || 1, { keepDroppingBalls = false } = {}) {
    const cfg = engine.modesConfig.slingshot;
    const world = engine.physicsWorld;
    const canvasCfg = engine.gameConfig.canvas;
    const r = engine.physicsConfig.ball.radius;
    const restDist = r * engine.physicsConfig.simulation.bondRestDistanceFactor;

    world.clear({ keepDroppingBalls });

    const paletteSize = this.getPaletteCountForStage(stage, cfg, engine.ballsConfig.standardColors.length);
    engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);

    const constellationCount = this.getConstellationCountForStage(stage, cfg);
    const specs = this.buildConstellationSpecs(stage, constellationCount, cfg, canvasCfg, restDist, r);
    const arcSpan = Math.max(MATH_CONSTANTS.EPSILON, MATH_CONSTANTS.TWO_PI - cfg.guardWindowHalfRad * 2);
    const guardSteps = Math.max(1, cfg.guardCount - 1);

    for (let idx = 0; idx < specs.length; idx++) {
      const spec = specs[idx];
      const coreColor = engine.activePalette[(idx + stage) % engine.activePalette.length];
      const colorA = engine.activePalette[Math.floor(engine.random() * engine.activePalette.length)];
      let colorB = engine.activePalette[Math.floor(engine.random() * engine.activePalette.length)];
      if (engine.activePalette.length > 1 && colorB === colorA) {
        colorB = engine.activePalette[(engine.activePalette.indexOf(colorA) + 1) % engine.activePalette.length];
      }

      const core = new Ball({
        x: spec.x,
        y: spec.y,
        radius: r,
        colorId: coreColor,
        isAnchor: false
      });
      core.slingshotCore = true;
      world.addBall(core);

      const guards = [];
      for (let g = 0; g < cfg.guardCount; g++) {
        const angle = spec.openAngle + cfg.guardWindowHalfRad + (g / guardSteps) * arcSpan;
        const gx = spec.x + Math.cos(angle) * restDist;
        const gy = spec.y + Math.sin(angle) * restDist;
        const guardColor = g < Math.ceil(cfg.guardCount * MATH_CONSTANTS.HALF) ? colorA : colorB;
        const guard = new Ball({
          x: gx,
          y: gy,
          radius: r,
          colorId: guardColor,
          isAnchor: true
        });
        guard.slingshotCore = false;
        world.addBall(guard);
        world.createBond(core, guard, false);
        if (guards.length > 0) {
          world.createBond(guards[guards.length - 1], guard, false);
        }
        guards.push(guard);
      }
    }

    const obstacles = this.buildStageObstacles(stage, cfg, canvasCfg, engine.obstaclesConfig);
    for (const obs of obstacles) {
      world.obstacles.push(obs);
    }

    const wells = this.buildDipoleWells(stage, cfg, canvasCfg);
    engine.modeState = {
      wells,
      coresTotal: specs.length,
      coresAwarded: 0,
      flightSubsteps: 0,
      shotWhipped: false,
      whippedWellIds: []
    };
    this.configureWorldHooks(engine);
  }

  onBeforePhysicsStep(engine) {
    const p = engine.physicsWorld.projectile;
    if (p && p.flightSteps === 0 && engine.modeState) {
      engine.modeState.flightSubsteps = 0;
      engine.modeState.shotWhipped = false;
      engine.modeState.whippedWellIds = [];
    }
  }

  onPolarityFlipped(engine) {
    if (!engine.modeState) {
      return;
    }
    this.syncWorldWellFields(engine);
    const p = engine.physicsWorld.projectile;
    if (!p) {
      return;
    }
    p.isPolarityFlipped = engine.isPolarityFlipped;

    const cfg = engine.modesConfig.slingshot;
    const whipRadius = this.getEffectiveWhipRadius(engine);
    const whippedIds = engine.modeState.whippedWellIds || [];

    for (const well of engine.modeState.wells) {
      if (whippedIds.includes(well.id)) {
        continue;
      }
      const dist = Math.hypot(p.x - well.x, p.y - well.y);
      if (dist <= whipRadius) {
        whippedIds.push(well.id);
        engine.modeState.whippedWellIds = whippedIds;
        engine.modeState.shotWhipped = true;

        const speed = Math.hypot(p.vx, p.vy);
        if (speed > MATH_CONSTANTS.EPSILON) {
          const targetSpeed = Math.min(cfg.maxProjectileSpeed, speed * cfg.whipBoostFactor);
          const scale = targetSpeed / speed;
          p.vx *= scale;
          p.vy *= scale;
        }

        const overchargeGain = engine.getCollectorOvercharge?.() || 0;
        if (overchargeGain > 0) {
          engine.addOvercharge(overchargeGain);
        }
        engine.audioManager.playEffect?.('slingshotWhip');
        engine.particleSystem.spawnShockwave(
          p.x,
          p.y,
          engine.gameConfig.theme.overchargePopupColor,
          whipRadius * WHIP_SHOCKWAVE_FACTOR
        );
        engine.particleSystem.spawnFloatingText(
          p.x,
          p.y + engine.gameConfig.canvas.floatingTextOffsetY,
          t('gameplay.feedback.slingshot.whip'),
          engine.gameConfig.theme.overchargePopupColor
        );
        break;
      }
    }
  }

  onProjectileSettled(engine, { snappedBall, hitTarget }) {
    if (!snappedBall || snappedBall.specialType) {
      return false;
    }
    const world = engine.physicsWorld;
    if (hitTarget?.slingshotCore && world.ballMap.has(hitTarget.id)) {
      world.removeBall(snappedBall);
      engine.audioManager.playEffect('snap');
      engine.particleSystem.addScreenShake(
        engine.gameConfig.juice.matchShake,
        engine.gameConfig.juice.maxShakeOffset
      );
      engine.particleSystem.spawnShockwave(
        hitTarget.x,
        hitTarget.y,
        engine.gameConfig.theme.coinPopupColor,
        hitTarget.radius * DIRECT_CORE_BURST_FACTOR
      );
      engine.destroyClusterBall(hitTarget, engine.gameConfig.theme.coinPopupColor, true);
      engine.combo = Math.min(
        engine.combo + engine.gameConfig.scoring.comboIncrement,
        engine.gameConfig.scoring.maxComboMultiplier
      );
      engine.maxComboInRound = Math.max(engine.maxComboInRound, engine.combo);
      engine.storageManager?.recordAchievementProgress?.({ maxCombo: engine.combo });
      engine.unlockAchievementTiers('comboMaster', engine.combo);
      engine.handlePostTurnCleanup(true);
      return true;
    }
    return false;
  }

  reconcileSlingshotCores(engine) {
    const state = engine.modeState;
    if (!state) {
      return 0;
    }
    const cfg = engine.modesConfig.slingshot;
    let remaining = 0;
    for (const ball of engine.physicsWorld.balls) {
      if (ball.slingshotCore) {
        remaining++;
      }
    }
    const newlyCleared = Math.max(0, state.coresTotal - state.coresAwarded - remaining);
    if (newlyCleared > 0 && engine.isRunPlaying()) {
      state.coresAwarded += newlyCleared;
      const whipMult = state.shotWhipped ? cfg.whipScoreMultiplier : 1;
      const pts = Math.round(newlyCleared * cfg.corePoints * Math.max(1, engine.slingshotStage) * whipMult);
      engine.addScore(pts);
      engine.addOvercharge(newlyCleared * engine.gameConfig.scoring.overchargePerMatchedBall);
      reportBountyEvent(engine, 'slingshot_core_shattered', newlyCleared);
      const textKey = state.shotWhipped
        ? 'gameplay.feedback.slingshot.whipCore'
        : 'gameplay.feedback.slingshot.coreShattered';
      engine.particleSystem.spawnFloatingText(
        engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
        cfg.constellationBottomY,
        t(textKey, { points: pts }),
        state.shotWhipped ? engine.gameConfig.theme.overchargePopupColor : engine.gameConfig.theme.coinPopupColor
      );
    }
    return remaining;
  }

  onTurnCleanedUp(engine) {
    this.reconcileSlingshotCores(engine);
    if (engine.modeState) {
      engine.modeState.flightSubsteps = 0;
      engine.modeState.shotWhipped = false;
      engine.modeState.whippedWellIds = [];
    }
  }

  completeSlingshotStage(engine) {
    const cfg = engine.modesConfig.slingshot;
    const clearedStage = engine.slingshotStage;

    engine.releaseRemainingBoardAsAvalanche();

    const bonus = cfg.stageClearBonusBase * clearedStage + engine.shotsRemaining * cfg.stageClearShotBonus;
    engine.addScore(bonus);
    engine.audioManager.playEffect('victory');
    engine.particleSystem.spawnFloatingText(
      engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      engine.gameConfig.canvas.logicalHeight * MATH_CONSTANTS.HALF,
      t('gameplay.feedback.slingshot.stageCleared', { points: bonus }),
      engine.gameConfig.theme.victoryPopupColor
    );

    engine.slingshotStage = clearedStage + 1;
    engine.waveCount = engine.slingshotStage;
    const baseStart = cfg.startingShots + engine.getStartingShotsBonus();
    const maxShots = cfg.maxShotsCap + engine.getStartingShotsBonus();
    engine.shotsRemaining = Math.min(
      maxShots,
      Math.max(baseStart, engine.shotsRemaining + cfg.stageRefillShots)
    );
    engine.combo = 0;

    this.buildStageBoard(engine, engine.slingshotStage, { keepDroppingBalls: true });
    engine.refreshStaleLauncherColors();
    engine.unlockAchievementTiers('slingshotStages', engine.slingshotStage);
    engine.persistRunHighScore();
    engine.updateAimFromAngle(engine.aimAngle);
    engine.saveRunSnapshot({ force: true });
    engine.notifyUI({ slingshotStageCleared: clearedStage });
  }

  evaluateBoardState(engine) {
    if (!engine.isRunPlaying() || engine.physicsWorld.projectile) {
      return true;
    }
    const remaining = this.reconcileSlingshotCores(engine);
    if (remaining === 0) {
      this.completeSlingshotStage(engine);
    } else if (engine.shotsRemaining <= 0 && engine.physicsWorld.pendingChainCandidateIds.size === 0) {
      engine.triggerGameOver(GAME_OVER_REASONS.OUT_OF_SHOTS);
    }
    return true;
  }

  serializeModeState(engine) {
    const state = engine.modeState || {};
    return {
      wells: (state.wells || []).map((w) => ({
        id: w.id,
        x: w.x,
        y: w.y,
        coreRadius: w.coreRadius,
        fieldRadius: w.fieldRadius,
        strength: w.strength,
        polarity: w.polarity
      })),
      coresTotal: state.coresTotal ?? 0,
      coresAwarded: state.coresAwarded ?? 0,
      coreFlags: engine.physicsWorld.balls.map((b) => (b.slingshotCore ? 1 : 0))
    };
  }

  validateModeState(rawState) {
    return Boolean(
      rawState
      && typeof rawState === 'object'
      && Array.isArray(rawState.wells)
      && rawState.wells.length > 0
      && rawState.wells.every(
        (w) => w
          && Number.isFinite(w.x)
          && Number.isFinite(w.y)
          && Number.isFinite(w.fieldRadius)
          && Number.isFinite(w.strength)
          && (w.polarity === 1 || w.polarity === -1)
      )
      && Array.isArray(rawState.coreFlags)
      && rawState.coreFlags.length > 0
      && rawState.coreFlags.some((f) => f === 1)
      && rawState.coreFlags.every((f) => f === 0 || f === 1)
    );
  }

  restoreModeState(engine, rawState) {
    const cfg = engine.modesConfig.slingshot;
    const paletteSize = this.getPaletteCountForStage(
      engine.slingshotStage,
      cfg,
      engine.ballsConfig.standardColors.length
    );
    engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);

    const balls = engine.physicsWorld.balls;
    let remainingCores = 0;
    for (let i = 0; i < balls.length; i++) {
      balls[i].slingshotCore = rawState.coreFlags[i] === 1;
      if (balls[i].slingshotCore) {
        remainingCores++;
      }
    }

    const wells = rawState.wells.map((w, idx) => ({
      id: Number.isInteger(w.id) ? w.id : idx + 1,
      x: w.x,
      y: w.y,
      coreRadius: Number.isFinite(w.coreRadius) ? w.coreRadius : cfg.wellCoreRadius,
      fieldRadius: w.fieldRadius,
      strength: w.strength,
      polarity: w.polarity === -1 ? -1 : 1
    }));

    const coresTotal = Math.max(remainingCores, Number.parseInt(rawState.coresTotal, 10) || remainingCores);
    const coresAwarded = Math.min(
      coresTotal - remainingCores,
      Math.max(0, Number.parseInt(rawState.coresAwarded, 10) || 0)
    );

    engine.modeState = {
      wells,
      coresTotal,
      coresAwarded,
      flightSubsteps: 0,
      shotWhipped: false,
      whippedWellIds: []
    };
    this.configureWorldHooks(engine);
  }

  drawUnderlay(ctx, engine, _renderer, theme, now = 0) {
    const wells = engine.modeState?.wells;
    if (!Array.isArray(wells) || wells.length === 0) {
      return;
    }
    const flipSign = engine.isPolarityFlipped ? -1 : 1;
    const whipRadius = this.getEffectiveWhipRadius(engine);
    const whippedIds = engine.modeState?.whippedWellIds || [];
    const hasProjectile = Boolean(engine.physicsWorld.projectile);
    const phase = engine.isReducedMotion ? MATH_CONSTANTS.HALF : (now * WELL_PULSE_SPEED) % 1;

    ctx.save();
    for (const well of wells) {
      const effectivePol = well.polarity * flipSign;
      const accent = effectivePol > 0 ? theme.coinPopupColor : theme.aimLineColor;

      // Outer Dipole field boundary
      ctx.strokeStyle = accent;
      ctx.globalAlpha = WELL_FIELD_ALPHA;
      ctx.lineWidth = WELL_FIELD_LINE_WIDTH;
      ctx.setLineDash(WELL_FIELD_DASH);
      ctx.beginPath();
      ctx.arc(well.x, well.y, well.fieldRadius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
      ctx.setLineDash([]);

      // Directional field wave (inward for attracting `+`, outward for repelling `-`)
      const waveFrac = effectivePol > 0 ? 1 - phase : phase;
      const waveRadius = well.coreRadius + (well.fieldRadius - well.coreRadius)
        * (WELL_PULSE_MIN_RATIO + waveFrac * WELL_PULSE_SPAN_RATIO);
      ctx.globalAlpha = WELL_PULSE_ALPHA * (1 - waveFrac * MATH_CONSTANTS.HALF);
      ctx.beginPath();
      ctx.arc(well.x, well.y, waveRadius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();

      // Polarity Whip zone indicator while a projectile is in flight
      if (hasProjectile && !whippedIds.includes(well.id)) {
        ctx.strokeStyle = theme.overchargePopupColor;
        ctx.globalAlpha = WELL_WHIP_READY_ALPHA;
        ctx.setLineDash(WHIP_RING_DASH);
        ctx.beginPath();
        ctx.arc(well.x, well.y, whipRadius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Dipole core disc + `+` / `-` glyph
      ctx.fillStyle = accent;
      ctx.globalAlpha = WELL_CORE_FILL_ALPHA;
      ctx.beginPath();
      ctx.arc(well.x, well.y, well.coreRadius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();

      ctx.strokeStyle = accent;
      ctx.globalAlpha = 1;
      ctx.lineWidth = WELL_CORE_LINE_WIDTH;
      ctx.beginPath();
      ctx.arc(well.x, well.y, well.coreRadius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();

      const arm = well.coreRadius * WELL_GLYPH_SIZE_FACTOR;
      ctx.strokeStyle = theme.anchorCoreColor;
      ctx.lineWidth = WELL_GLYPH_LINE_WIDTH;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(well.x - arm, well.y);
      ctx.lineTo(well.x + arm, well.y);
      if (effectivePol > 0) {
        ctx.moveTo(well.x, well.y - arm);
        ctx.lineTo(well.x, well.y + arm);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawOverlay(ctx, engine, _renderer, theme, now = 0) {
    const pulse = CORE_PULSE_MIN_ALPHA
      + (engine.isReducedMotion ? 0 : Math.sin(now * CORE_PULSE_SPEED) * CORE_PULSE_AMP_ALPHA);

    ctx.save();
    for (const ball of engine.physicsWorld.balls) {
      if (!ball.slingshotCore) {
        continue;
      }
      ctx.strokeStyle = theme.coinPopupColor;
      ctx.globalAlpha = pulse;
      ctx.lineWidth = CORE_HALO_LINE_WIDTH;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius + CORE_HALO_OFFSET, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();

      ctx.globalAlpha = pulse * MATH_CONSTANTS.HALF;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius + CORE_OUTER_HALO_OFFSET, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();

      const arm = ball.radius * CORE_CROSSHAIR_SIZE_FACTOR;
      ctx.strokeStyle = theme.anchorCoreColor;
      ctx.globalAlpha = CORE_CROSSHAIR_ALPHA;
      ctx.lineWidth = WELL_FIELD_LINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(ball.x - arm, ball.y);
      ctx.lineTo(ball.x + arm, ball.y);
      ctx.moveTo(ball.x, ball.y - arm);
      ctx.lineTo(ball.x, ball.y + arm);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export const slingshotBehavior = new SlingshotBehavior();
registerModeBehavior(GAME_MODES.SLINGSHOT, slingshotBehavior);
