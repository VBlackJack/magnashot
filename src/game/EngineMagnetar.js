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

import { CLUSTER_MODIFIERS, GAME_MODES } from '../core/Constants.js';
import { t } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { CHARGE_OUTCOMES, resolveChargeHit, segmentCircleHitT, shotPolarity } from './VersusRules.js';
import {
  MAGNETAR_BEHAVIOURS,
  MAGNETAR_MODES,
  MAGNETAR_PHASES,
  advanceSchedule,
  advanceTurnCharges,
  fallReward,
  findMoorings,
  pickMooringToSnap,
  planBarrage,
  regrowSlots,
  tierFor
} from './MagnetarRules.js';

const FIRST_CHARGE_ID = 1;
const NO_COUNT = 0;
const LAST_MOORING = 1;
const FULL_PROGRESS = 1;
/** Slots closer than this many radii to a sphere are taken. */
const SLOT_FREE_RADII = 1.8;

/** Kinds of the `magnetarAnnouncement` payload sent to the UI through notifyUI. */
export const MAGNETAR_ANNOUNCEMENTS = Object.freeze({
  ARMED: 'armed',
  LAST_MOORING: 'lastMooring',
  DOWN: 'down'
});

/** Saved fields of the Magnetar state (the Mooring ids are rebuilt from the board). */
const SAVED_FIELDS = ['key', 'tier', 'step', 'phase', 'restLeft', 'armed', 'previous', 'chargeSeq'];

const isCount = (value) => Number.isInteger(value) && value >= NO_COUNT;

/**
 * Validates a saved Magnetar state against the engine's own fresh one (same wave or stage).
 * @returns {boolean} True when it can replace the fresh state.
 */
function isUsableSavedState(saved, fresh, cfg) {
  if (!saved || typeof saved !== 'object' || saved.key !== fresh.key || saved.tier !== fresh.tier) {
    return false;
  }
  const behaviours = Object.values(MAGNETAR_BEHAVIOURS);
  const phases = Object.values(MAGNETAR_PHASES);
  const isBehaviourOrNull = (value) => value === null || behaviours.includes(value);
  return (
    isCount(saved.step) &&
    isCount(saved.restLeft) &&
    isCount(saved.chargeSeq) &&
    saved.restLeft <= cfg.cadenceByTier[saved.tier] &&
    phases.includes(saved.phase) &&
    isBehaviourOrNull(saved.armed) &&
    isBehaviourOrNull(saved.previous) &&
    (saved.phase !== MAGNETAR_PHASES.ARMED || saved.armed !== null) &&
    Array.isArray(saved.charges) &&
    saved.charges.every((c) => c && Number.isFinite(c.x) && Number.isFinite(c.y) && isCount(c.turnsLeft) && isCount(c.strength))
  );
}

/** Methods of GameEngine for the Magnetar bosses, installed on its prototype. */
export const engineMagnetarMethods = {
  /** True when a boss of this run is a Magnetar: Boss Rush, or a Flux boss stage; never a duel. */
  shouldUseMagnetar() {
    if (!this.gameConfig.magnetar || this.versus || this.isVersusRole) {
      return false;
    }
    return this.mode === GAME_MODES.BOSS_RUSH || (this.mode === GAME_MODES.FLUX && this.fluxIsBossStage);
  },

  /** Run key of the Magnetar streams for the current wave or stage. */
  getMagnetarKey() {
    return this.mode === GAME_MODES.FLUX
      ? `${this.fluxSeed}:magnetar:${this.fluxStage}`
      : `bossRush:magnetar:${this.bossRushWave}`;
  },

  /** Tier of the Magnetar of the current wave or stage. */
  getMagnetarTier() {
    const cfg = this.gameConfig.magnetar;
    return this.mode === GAME_MODES.FLUX
      ? tierFor(MAGNETAR_MODES.FLUX, this.fluxStage, cfg)
      : tierFor(MAGNETAR_MODES.BOSS_RUSH, this.bossRushWave, cfg);
  },

  /**
   * Starts the Magnetar state around a ball that already carries the MAGNETAR modifier.
   * @param {import('../entities/Ball.js').Ball} ball - The Magnetar.
   * @param {{key: string, tier: number}} options - Stream key and tier.
   */
  initMagnetar(ball, { key, tier }) {
    const cfg = this.gameConfig.magnetar;
    this.clearMagnetarEffects();
    this.magnetar = {
      ballId: ball.id,
      key,
      tier,
      step: NO_COUNT,
      phase: MAGNETAR_PHASES.REST,
      restLeft: cfg.cadenceByTier[tier],
      armed: null,
      previous: null,
      charges: [],
      chargeSeq: FIRST_CHARGE_ID,
      mooringIds: null,
      plan: null
    };
  },

  /**
   * Turns one ball of a freshly built Flux board into the Magnetar. A boss ball that is an
   * anchor (a shape made only of anchors) could never fall, so it stays a legacy Boss Core.
   * @param {Array<import('../entities/Ball.js').Ball>} balls - The board's balls, in spec order.
   * @param {number|null} bossBallIndex - Index of the boss ball.
   * @param {{key: string, tier: number}} options - Stream key and tier.
   */
  makeMagnetar(balls, bossBallIndex, options) {
    if (bossBallIndex === null || bossBallIndex === undefined) {
      return;
    }
    const ball = balls[bossBallIndex];
    if (ball.isAnchor || ball.pivotRef) {
      this.makeBossCore(balls, bossBallIndex);
      return;
    }
    ball.clusterModifier = CLUSTER_MODIFIERS.MAGNETAR;
    ball.colorId = null;
    ball.armorHits = 0;
    this.initMagnetar(ball, options);
  },

  /** Forgets the Magnetar and its fields (a wave or stage change, or a legacy snapshot). */
  clearMagnetar() {
    this.magnetar = null;
    this.clearMagnetarEffects();
  },

  /** Switches the field flags of the physics world off. */
  clearMagnetarEffects() {
    this.physicsWorld.boardPolarityInverted = false;
    this.physicsWorld.projectileFields.length = 0;
    this.physicsWorld.aimCacheValid = false;
  },

  /** @returns {import('../entities/Ball.js').Ball|null} The Magnetar ball while it is on the board. */
  getMagnetarBall() {
    return this.magnetar ? this.physicsWorld.ballMap.get(this.magnetar.ballId) ?? null : null;
  },

  /**
   * Recounts the Moorings: the anchors still holding the Magnetar through bonds. The count
   * only goes down (a sphere bridging an anchor back is not counted). Called at turn end and
   * after a bond break, never every frame.
   * @param {boolean} [announce] - Show the "mooring snapped" feedback when the count dropped.
   * @returns {number[]} The Mooring ids.
   */
  refreshMoorings(announce = true) {
    const magnetar = this.magnetar;
    if (!magnetar) {
      return [];
    }
    const world = this.physicsWorld;
    const found = findMoorings(world.balls, world.ballMap, magnetar.ballId);
    const before = magnetar.mooringIds;
    magnetar.mooringIds = found;
    const left = magnetar.mooringIds.length;
    const ball = this.getMagnetarBall();
    if (announce && before !== null && left < before.length && ball) {
      if (left > NO_COUNT) {
        this.particleSystem.spawnFloatingText(
          ball.x,
          ball.y + this.gameConfig.canvas.floatingTextOffsetY,
          t('gameplay.feedback.magnetar.moorings', { left }),
          this.ballsConfig.clusterModifiers.magnetar.highlight
        );
      }
      if (left === LAST_MOORING) {
        this.notifyUI({ magnetarAnnouncement: { kind: MAGNETAR_ANNOUNCEMENTS.LAST_MOORING } });
      }
    }
    return magnetar.mooringIds;
  },

  /**
   * Overcharge strike on a Magnetar: snaps the lowest-id Mooring.
   * @returns {boolean} True when a Mooring was snapped.
   */
  snapMagnetarMooring() {
    const magnetar = this.magnetar;
    const ball = this.getMagnetarBall();
    if (!magnetar || !ball) {
      return false;
    }
    const mooringId = pickMooringToSnap(this.refreshMoorings(false));
    const mooring = mooringId === null ? null : this.physicsWorld.ballMap.get(mooringId);
    if (!mooring) {
      return false;
    }
    this.particleSystem.spawnFloatingText(
      ball.x,
      ball.y - ball.radius + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.bossRush.overchargeStrike'),
      this.gameConfig.theme.overchargePopupColor
    );
    const spec = this.ballsConfig.clusterModifiers.magnetar;
    const snapped = this.destroyClusterBall(mooring, spec.ringColor, true);
    if (snapped) {
      this.refreshMoorings(true);
      if (this.isSteppingPhysics) {
        // The avalanche runs once the physics step has returned (see update()).
        this.physicsWorld.hasBrokenBondThisStep = true;
      } else {
        this.detachAndRewardAvalanche();
        this.evaluateRoundEnd();
      }
    }
    return snapped;
  },

  /**
   * Applies the armed behaviour that works while the player aims: Reverse Field flips the curve
   * pull, Undertow adds a field around the (frozen) core. The preview reads the same flags.
   */
  applyMagnetarArmedEffects() {
    this.clearMagnetarEffects();
    const magnetar = this.magnetar;
    if (!magnetar || magnetar.phase !== MAGNETAR_PHASES.ARMED || !magnetar.plan) {
      return;
    }
    const cfg = this.gameConfig.magnetar;
    if (magnetar.armed === MAGNETAR_BEHAVIOURS.INVERT) {
      this.physicsWorld.boardPolarityInverted = true;
    } else if (magnetar.armed === MAGNETAR_BEHAVIOURS.UNDERTOW) {
      this.physicsWorld.projectileFields.push({
        x: magnetar.plan.center.x,
        y: magnetar.plan.center.y,
        radius: cfg.undertow.radiusFactor * this.physicsConfig.ball.radius,
        force: cfg.undertow.force
      });
    }
  },

  /** Playfield limits a Regrow slot must stay inside. */
  getMagnetarBounds() {
    const canvasCfg = this.gameConfig.canvas;
    return {
      minX: canvasCfg.wallMargin,
      maxX: canvasCfg.logicalWidth - canvasCfg.wallMargin,
      minY: 0,
      maxY: canvasCfg.dangerLineY
    };
  },

  /** Plans what the armed behaviour will do, so the warning can show exact slots and lanes. */
  planMagnetarBehaviour(ball) {
    const magnetar = this.magnetar;
    const cfg = this.gameConfig.magnetar;
    const r = this.physicsConfig.ball.radius;
    const plan = { center: { x: ball.x, y: ball.y }, slots: [], barrage: [] };
    if (magnetar.armed === MAGNETAR_BEHAVIOURS.REGROW) {
      const rng = new SeededRandom(`${magnetar.key}:${magnetar.step}:regrow`);
      plan.slots = regrowSlots(ball, this.physicsWorld.balls, r, cfg.regrow.count, rng, this.getMagnetarBounds(), cfg.regrow.maxShells)
        .map(({ x, y }) => ({ x, y }));
    } else if (magnetar.armed === MAGNETAR_BEHAVIOURS.BARRAGE) {
      const canvasCfg = this.gameConfig.canvas;
      const margin = canvasCfg.wallMargin + r;
      const rng = new SeededRandom(`${magnetar.key}:${magnetar.step}:barrage`);
      plan.barrage = planBarrage(magnetar.tier, cfg, rng, {
        minX: margin,
        maxX: canvasCfg.logicalWidth - margin,
        startY: canvasCfg.dangerLineY,
        targetY: this.getClusterUndersideY(),
        idStart: magnetar.chargeSeq
      });
    }
    return plan;
  },

  /** Regrow acts: spheres appear in the planned slots that are still free. Never anchors. */
  growMagnetarSpheres() {
    const magnetar = this.magnetar;
    const world = this.physicsWorld;
    const r = this.physicsConfig.ball.radius;
    const bondRange = r * this.physicsConfig.simulation.bondCreationDistanceFactor;
    const colorRng = new SeededRandom(`${magnetar.key}:${magnetar.step}:regrow:colors`);
    const spec = this.ballsConfig.clusterModifiers.magnetar;
    this.withMagnetarRandom(`${magnetar.key}:${magnetar.step}:regrow:spawn`, () => {
      for (const slot of magnetar.plan?.slots ?? []) {
        const isFree = world.balls.every((other) => Math.hypot(other.x - slot.x, other.y - slot.y) >= r * SLOT_FREE_RADII);
        if (!isFree || this.activePalette.length === NO_COUNT) {
          continue;
        }
        const preferred = this.activePalette[Math.floor(colorRng.next() * this.activePalette.length)];
        const grown = this.createClusterBall({
          x: slot.x,
          y: slot.y,
          radius: r,
          colorId: preferred,
          clusterModifier: null,
          isAnchor: false
        });
        world.addBall(grown);
        for (const other of world.balls) {
          if (other.id !== grown.id && Math.hypot(other.x - grown.x, other.y - grown.y) <= bondRange) {
            world.createBond(grown, other, false);
          }
        }
        this.particleSystem.spawnBurst(grown.x, grown.y, spec.highlight, this.gameConfig.juice.matchBurstCount, this.gameConfig.juice.matchBurstSpeed);
      }
    });
    this.audioManager.playEffect?.('snap');
    this.refreshStaleLauncherColors();
    // Keep the pull of the new spheres out of the preview cache.
    world.aimCacheValid = false;
  },

  /** Runs `build` with this.random() drawing from a Magnetar stream, seeded run or not. */
  withMagnetarRandom(streamKey, build) {
    const previous = this.scopedRng;
    this.scopedRng = new SeededRandom(streamKey);
    try {
      return build();
    } finally {
      this.scopedRng = previous;
    }
  },

  /** Barrage acts: the planned charges leave the danger line. */
  launchMagnetarBarrage() {
    const magnetar = this.magnetar;
    const planned = magnetar.plan?.barrage ?? [];
    magnetar.charges.push(...planned);
    magnetar.chargeSeq += planned.length;
  },

  /** Lands the charges that finished their rise. */
  landMagnetarCharges(landed) {
    const magnetar = this.magnetar;
    const targetY = this.getClusterUndersideY();
    for (const charge of landed) {
      const rng = new SeededRandom(`${magnetar.key}:${magnetar.step}:land:${charge.id}`);
      this.snapChargeIntoCluster({ ...charge, y: targetY }, rng);
    }
  },

  /**
   * Advances the Magnetar by one resolved turn: rising charges move or land, then the schedule
   * either arms a behaviour (the warning, whose field effects work at once) or lets the armed
   * one act. Called from the post-turn cleanup, before the round end is evaluated.
   */
  advanceMagnetarTurn() {
    const magnetar = this.magnetar;
    if (!magnetar || !this.isRunPlaying()) {
      return;
    }
    const ball = this.getMagnetarBall();
    if (!ball) {
      this.clearMagnetarEffects();
      magnetar.charges = [];
      return;
    }
    const cfg = this.gameConfig.magnetar;
    this.refreshMoorings(true);

    const moved = advanceTurnCharges(magnetar.charges);
    magnetar.charges = moved.charges;
    this.landMagnetarCharges(moved.landed);

    const result = advanceSchedule(
      {
        tier: magnetar.tier,
        step: magnetar.step,
        phase: magnetar.phase,
        restLeft: magnetar.restLeft,
        armed: magnetar.armed,
        previous: magnetar.previous
      },
      cfg,
      magnetar.key
    );
    const wasArmed = magnetar.armed;
    Object.assign(magnetar, result.state);
    if (result.acted) {
      if (wasArmed === MAGNETAR_BEHAVIOURS.REGROW) {
        this.growMagnetarSpheres();
      } else if (wasArmed === MAGNETAR_BEHAVIOURS.BARRAGE) {
        this.launchMagnetarBarrage();
      }
      magnetar.plan = null;
      this.clearMagnetarEffects();
    } else if (result.armed) {
      magnetar.plan = this.planMagnetarBehaviour(ball);
      this.applyMagnetarArmedEffects();
      this.notifyUI({
        magnetarAnnouncement: { kind: MAGNETAR_ANNOUNCEMENTS.ARMED, behaviour: result.armed }
      });
    }
  },

  /**
   * Checks the flying shot against the Barrage charges after a physics step. The first charge
   * the shot crosses wins: the opposite polarity wears it down (and a shattered charge pays
   * Overcharge), the same polarity bounces the shot away.
   * @param {object|null} projectile - The shot that was in flight before the step.
   */
  stepMagnetarAfter(projectile) {
    const magnetar = this.magnetar;
    if (!magnetar || !projectile || this.physicsWorld.projectile !== projectile || projectile.specialType || magnetar.charges.length === NO_COUNT) {
      return;
    }
    const hitRadius = this.getChargeRadius() + projectile.radius;
    if (!projectile.magnetarHitIds) {
      projectile.magnetarHitIds = new Set();
    }
    const hitIds = projectile.magnetarHitIds;
    let best = null;
    for (const charge of magnetar.charges) {
      if (hitIds.has(charge.id)) {
        continue;
      }
      const hitT = segmentCircleHitT(projectile.prevX, projectile.prevY, projectile.x, projectile.y, charge.x, charge.y, hitRadius);
      if (hitT !== null && (best === null || hitT < best.t)) {
        best = { t: hitT, charge };
      }
    }
    if (!best) {
      return;
    }
    const versusCfg = this.gameConfig.versus;
    const shot = shotPolarity(projectile.colorId, projectile.isPolarityFlipped, versusCfg, this.physicsWorld.polarityMap);
    const result = resolveChargeHit(best.charge, { polarity: shot });
    hitIds.add(best.charge.id);
    if (result.outcome === CHARGE_OUTCOMES.DEFLECTED) {
      projectile.x = projectile.prevX + (projectile.x - projectile.prevX) * best.t;
      projectile.y = projectile.prevY + (projectile.y - projectile.prevY) * best.t;
      projectile.vx = -projectile.vx;
      this.audioManager.playEffect('bounce');
      return;
    }
    if (result.outcome === CHARGE_OUTCOMES.NEUTRALISED) {
      magnetar.charges.splice(magnetar.charges.indexOf(best.charge), 1);
      this.particleSystem.spawnBurst(
        best.charge.x,
        best.charge.y,
        this.gameConfig.theme.defaultTrailColor,
        this.gameConfig.juice.matchBurstCount,
        this.gameConfig.juice.matchBurstSpeed
      );
      this.addOvercharge(versusCfg.neutraliseOverchargeGain * this.getOverchargeCap());
    } else {
      best.charge.strength = result.charge.strength;
    }
    this.audioManager.playEffect('match');
    if (result.projectileConsumed) {
      this.physicsWorld.projectile = null;
      projectile.isProjectile = false;
      // A shot that took a charge down is not a whiff.
      this.handlePostTurnCleanup(true);
    }
  },

  /**
   * Pays a Magnetar that fell in an avalanche: points per sphere, coins, the bossSlayer
   * progress and the lifetime Magnetar achievements.
   * @param {import('../entities/Ball.js').Ball} ball - The Magnetar, where it was lost.
   * @param {number} dropped - Spheres in the same avalanche, the Magnetar not included.
   */
  rewardMagnetarFall(ball, dropped) {
    const cfg = this.gameConfig.magnetar;
    const spec = this.ballsConfig.clusterModifiers.magnetar;
    const reward = fallReward(dropped, cfg);
    this.addScore(reward.points);
    this.awardRunCoins(reward.coins);
    this.particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.magnetar.down', { points: reward.points }),
      this.gameConfig.theme.bossPopupColor
    );
    if (!this.isReducedMotion) {
      this.particleSystem.spawnBurst(ball.x, ball.y, spec.highlight, cfg.render.fallExplosionBurst, this.gameConfig.juice.matchBurstSpeed);
      this.particleSystem.spawnExplosion?.(ball.x, ball.y, cfg.render.fallShockwaveRadius, spec.ringColor);
      this.particleSystem.spawnFlash?.(ball.x, ball.y, spec.ringColor, cfg.render.fallShockwaveRadius);
      this.particleSystem.spawnShockwave(ball.x, ball.y, spec.ringColor, cfg.render.fallShockwaveRadius);
      this.triggerSpecialSlowMo(cfg.render.fallSlowMoFrames, cfg.render.fallSlowMoTimeScale, spec.ringColor);
    }
    this.bossesDestroyedInRun++;
    this.storageManager?.recordAchievementProgress?.({ bossesDestroyed: this.bossesDestroyedInRun });
    this.unlockAchievementTiers('bossSlayer', this.bossesDestroyedInRun);
    this.countMagnetarAchievement('magnetarsGrounded');
    if (reward.landslide) {
      this.countMagnetarAchievement('magnetarLandslide');
    }
    if (this.magnetar) {
      this.magnetar.charges = [];
    }
    this.clearMagnetarEffects();
    this.notifyUI({ magnetarAnnouncement: { kind: MAGNETAR_ANNOUNCEMENTS.DOWN } });
  },

  /** Adds one to a lifetime Magnetar counter and unlocks the tiers it reaches. */
  countMagnetarAchievement(family) {
    const records = this.storageManager?.getAchievementRecords?.() ?? {};
    const total = (Number(records[family]) || NO_COUNT) + 1;
    this.storageManager?.recordAchievementProgress?.({ [family]: total });
    this.unlockAchievementTiers(family, total);
  },

  /**
   * Restores the Magnetar state of a saved run onto the fresh one the mode start built.
   * @param {object|null} saved - Saved state (see getMagnetarSnapshot).
   * @param {number} ballId - Id of the restored Magnetar ball.
   */
  restoreMagnetar(saved, ballId) {
    const fresh = this.magnetar;
    if (!fresh) {
      return;
    }
    fresh.ballId = ballId;
    if (isUsableSavedState(saved, fresh, this.gameConfig.magnetar)) {
      for (const field of SAVED_FIELDS) {
        fresh[field] = saved[field];
      }
      fresh.charges = saved.charges.map((charge) => ({ ...charge }));
      fresh.plan = saved.plan ?? null;
      if (fresh.phase === MAGNETAR_PHASES.ARMED && !fresh.plan) {
        fresh.plan = this.planMagnetarBehaviour(this.physicsWorld.ballMap.get(ballId));
      }
    }
    fresh.mooringIds = null;
    this.refreshMoorings(false);
    this.applyMagnetarArmedEffects();
  },

  /** @returns {object|null} The saved form of the Magnetar state, without the Mooring ids. */
  getMagnetarSnapshot() {
    const magnetar = this.magnetar;
    if (!magnetar) {
      return null;
    }
    const saved = JSON.parse(JSON.stringify(magnetar));
    delete saved.mooringIds;
    delete saved.ballId;
    return saved;
  },

  /**
   * What the renderer and the HUD draw for the Magnetar.
   * @returns {{ballId:number, x:number, y:number, tier:number, phase:string, armed:(string|null),
   *   mooringIds:number[], moorings:number, regrowSlots:Array<{x:number,y:number}>,
   *   undertow:({x:number,y:number,radius:number}|null),
   *   barrageMarkers:Array<{x:number,polarity:number}>,
   *   charges:Array<{id:number,polarity:number,strength:number,x:number,y:number,progress:number}>}|null}
   *   null when the run has no Magnetar on the board.
   */
  getMagnetarView() {
    const magnetar = this.magnetar;
    const ball = this.getMagnetarBall();
    if (!magnetar || !ball) {
      return null;
    }
    const world = this.physicsWorld;
    const mooringIds = (magnetar.mooringIds ?? []).filter((id) => world.ballMap.has(id));
    const isArmed = magnetar.phase === MAGNETAR_PHASES.ARMED;
    const plan = isArmed ? magnetar.plan : null;
    const field = isArmed && magnetar.armed === MAGNETAR_BEHAVIOURS.UNDERTOW && plan
      ? {
          x: plan.center.x,
          y: plan.center.y,
          radius: this.gameConfig.magnetar.undertow.radiusFactor * this.physicsConfig.ball.radius
        }
      : null;
    return {
      ballId: magnetar.ballId,
      x: ball.x,
      y: ball.y,
      tier: magnetar.tier,
      phase: magnetar.phase,
      armed: isArmed ? magnetar.armed : null,
      mooringIds,
      moorings: mooringIds.length,
      regrowSlots: isArmed && magnetar.armed === MAGNETAR_BEHAVIOURS.REGROW && plan ? plan.slots.map((s) => ({ ...s })) : [],
      undertow: field,
      barrageMarkers: isArmed && magnetar.armed === MAGNETAR_BEHAVIOURS.BARRAGE && plan
        ? plan.barrage.map((c) => ({ x: c.x, polarity: c.polarity }))
        : [],
      charges: magnetar.charges.map((charge) => ({
        id: charge.id,
        polarity: charge.polarity,
        strength: charge.strength,
        x: charge.x,
        y: charge.y,
        progress: charge.riseFrames > NO_COUNT ? FULL_PROGRESS - charge.turnsLeft / charge.riseFrames : FULL_PROGRESS
      }))
    };
  }
};
