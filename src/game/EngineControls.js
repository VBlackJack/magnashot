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
  GAME_STATES,
  LAUNCHER_POSTURES,
  MATH_CONSTANTS
} from '../core/Constants.js';
import { isRunSnapshotable } from './RunSnapshot.js';
import { DISCOVERY_INTERACTIONS } from './Discovery.js';
import { truncateAimAtCharges } from './ImpactPreview.js';
import { resolveChargeHit, shotPolarity } from './VersusRules.js';

/** Methods of GameEngine that belong to this domain, installed on its prototype. */
export const engineControlsMethods = {
  /**
   * False on a campaign level that hands out no special ball while the run holds none and
   * none is loaded: the special ball slots stay out of sight until there is one to use.
   * @returns {boolean} True when the special ball slots belong on screen.
   */
  offersSpecialBalls() {
    if (this.mode === GAME_MODES.CLASSIC) {
      return false;
    }
    const modeOverride = this.getModeBehavior().offersSpecialBalls(this);
    if (modeOverride !== null) {
      return modeOverride;
    }
    if (this.mode !== GAME_MODES.CAMPAIGN) {
      return true;
    }
    const levelDef = this.levelCatalog.get(this.currentLevelId);
    const grants = Object.values(levelDef?.specialInventory || {}).some((count) => count > 0);
    const holds = Object.values(this.specialInventory).some((count) => count > 0);
    return grants || holds || Boolean(this.currentBall?.specialType);
  },

  /** True while shop ammo is switched off: Daily fairness, Classic, or purist Arcade behavior modes. */
  isDailyAmmoLocked() {
    if (this.mode === GAME_MODES.CLASSIC || this.getModeBehavior().offersSpecialBalls(this) === false) {
      return true;
    }
    return this.mode === GAME_MODES.DAILY && !this.gameConfig.seededFairness?.dailyAllowsSpecialAmmo;
  },

  /**
   * True while the Workshop upgrades count for nothing in the current run: Classic always,
   * purist Arcade behavior modes, and the Daily Challenge / Puzzle while they hold a zero baseline.
   */
  areUpgradesNeutralised() {
    if (this.getModeBehavior().neutralizesWorkshopUpgrades(this)) {
      return true;
    }
    if (this.mode === GAME_MODES.PUZZLE) {
      // Mirrors the Daily check: neutralised while every baseline level is 0 (missing config counts as 0).
      return Object.keys(this.gameConfig.upgrades || {}).every(
        (key) => (this.gameConfig.seededFairness?.puzzleUpgradeLevels?.[key] ?? 0) === 0
      );
    }
    return this.mode === GAME_MODES.CLASSIC || this.areDailyUpgradesNeutralised();
  },

  /** True in the Daily Challenge while every Workshop upgrade is held at a zero baseline. */
  areDailyUpgradesNeutralised() {
    if (this.mode !== GAME_MODES.DAILY) {
      return false;
    }
    const levels = Object.keys(this.gameConfig.upgrades || {}).map(
      (key) => this.gameConfig.seededFairness?.dailyUpgradeLevels?.[key] ?? 0
    );
    return levels.every((level) => level === 0);
  },

  /**
   * True when a special ball can be bought now: the run is active and can be captured, so
   * the purchase is stored with its debit (no shot in flight, no Flux shape change or perk
   * choice pending).
   */
  canBuySpecialAmmo() {
    return (
      !this.isDailyAmmoLocked()
      && this.mode !== GAME_MODES.PUZZLE
      && isRunSnapshotable(this)
      && !this.isStageChanging()
      && !this.isAwaitingPerk()
    );
  },

  /**
   * Why a special ball cannot be bought right now, for the shop to explain.
   * @returns {'fairPlay'|'shotInFlight'|'stageChanging'|'perkChoice'|null} Null when it can, or when no run is active.
   */
  getSpecialAmmoBlockReason() {
    if (this.state !== GAME_STATES.PLAYING && this.state !== GAME_STATES.PAUSED) {
      return null;
    }
    if (this.mode === GAME_MODES.PUZZLE) {
      return null;
    }
    if (this.isDailyAmmoLocked()) {
      return 'fairPlay';
    }
    if (this.physicsWorld.projectile || this.pendingBossRushWave) {
      return 'shotInFlight';
    }
    if (this.isAwaitingPerk()) {
      return 'perkChoice';
    }
    if (!this.canBuySpecialAmmo()) {
      return 'stageChanging';
    }
    return null;
  },

  /**
   * Buys one special ball for the active run.
   * @param {string} specialType - Special ball type to buy.
   * @returns {boolean} True when coins were debited and the ball added; false when no run is
   *   active (only PLAYING or PAUSED runs accept purchases), the item is not for sale, or coins are short.
   */
  buySpecialAmmo(specialType) {
    if (!this.canBuySpecialAmmo() || !this.isSpecialTypeAllowed(specialType)) {
      return false;
    }
    if (this.mode === GAME_MODES.PUZZLE) {
      return false;
    }
    const cost = this.gameConfig.specialShopCosts?.[specialType];
    if (!Number.isFinite(cost) || cost <= 0) {
      return false;
    }
    const coins = this.storageManager.getCoins();
    if (coins < cost) {
      return false;
    }
    this.storageManager.setCoins(coins - cost);
    this.specialInventory[specialType] = (this.specialInventory[specialType] || 0) + 1;
    this.specialAmmoBoughtInRun++;
    // Stored right away, even before the first shot: a reload must not keep the debit and
    // lose the ball it paid for.
    this.saveRunSnapshot({ force: true });
    this.audioManager.playEffect('overcharge');
    this.notifyUI();
    return true;
  },

  setReducedMotion(enabled) {
    this.isReducedMotion = Boolean(enabled);
    if (this.isReducedMotion) {
      this.specialSlowMoFrames = 0;
      this.specialSlowMoTotalFrames = 0;
      this.specialSlowMoMinScale = 1.0;
      this.specialSlowMoColor = null;
    }
    this.particleSystem.setReducedMotion(enabled);
  },

  /**
   * Sets the visual playback speed multiplier for explosions, shatters, shockwaves,
   * particles and detonation slow-motion duration.
   * @param {number} speed - Positive animation speed multiplier (e.g. 0.5, 1, 1.5, 2).
   */
  setAnimationSpeed(speed) {
    const valid = Number.isFinite(speed) && speed > 0 ? speed : 1;
    this.animationSpeed = valid;
    this.particleSystem.setAnimationSpeed(valid);
  },

  swapLauncherBalls() {
    if (
      this.state !== GAME_STATES.PLAYING ||
      this.physicsWorld.projectile ||
      !this.currentBall ||
      !this.nextBall ||
      this.mode === GAME_MODES.PUZZLE
    ) {
      return;
    }
    const temp = this.currentBall;
    this.currentBall = this.nextBall;
    this.nextBall = temp;
    if (this.mode === GAME_MODES.MERGE) {
      const behavior = this.getModeBehavior();
      behavior.syncLauncherBallTier?.(this, this.currentBall);
      behavior.syncLauncherBallTier?.(this, this.nextBall);
      this.mergeDropX = behavior.clampDropX(this, this.mergeDropX, this.currentBall.radius);
    }
    this.audioManager.playEffect('snap');
    this.updateAimFromAngle(this.aimAngle);
    this.saveRunSnapshot({ force: true });
    this.notifyUI();
  },

  togglePolarityFlip() {
    if (this.state !== GAME_STATES.PLAYING) {
      return;
    }
    this.isPolarityFlipped = !this.isPolarityFlipped;
    this.getModeBehavior().onPolarityFlipped(this);
    this.recordDiscoveryInteraction(DISCOVERY_INTERACTIONS.TOGGLE);
    this.audioManager.playEffect('snap');
    this.updateAimFromAngle(this.aimAngle);
    this.saveRunSnapshot({ force: true });
    this.notifyUI();
  },

  /**
   * Turns the aim by a keyboard step and locks it against small mouse movements, so a
   * fine adjustment survives a hand resting on the mouse (see followPointer).
   * @param {number} deltaRad - Signed angle step.
   */
  adjustAimByDelta(deltaRad) {
    if (this.state !== GAME_STATES.PLAYING) {
      return;
    }
    this.isAimCancelled = false;
    this.isAimLocked = true;
    this.aimLockOrigin = null;
    const spec = this.getLauncherSpec();
    if (spec.posture === LAUNCHER_POSTURES.DROP_RAIL) {
      const behavior = this.getModeBehavior();
      const radius = this.currentBall?.radius || this.physicsConfig.ball.radius;
      const baseStepRad = this.gameConfig.canvas.keyboardAimStepRad;
      const dropStepPx = this.modesConfig.merge.dropStepPx;
      const stepPx = (deltaRad / baseStepRad) * dropStepPx;
      this.mergeDropX = behavior.clampDropX
        ? behavior.clampDropX(this, this.mergeDropX + stepPx, radius)
        : this.mergeDropX + stepPx;
      this.updateAimFromAngle(spec.defaultAngle);
      return;
    }
    if (spec.posture === LAUNCHER_POSTURES.OMNI_360) {
      let wrapped = (this.aimAngle + deltaRad) % MATH_CONSTANTS.TWO_PI;
      if (wrapped > Math.PI) {
        wrapped -= MATH_CONSTANTS.TWO_PI;
      } else if (wrapped < -Math.PI) {
        wrapped += MATH_CONSTANTS.TWO_PI;
      }
      this.updateAimFromAngle(wrapped);
      return;
    }
    if (spec.posture === LAUNCHER_POSTURES.DOWNWARD) {
      // In downward cannon posture, angle increases from right (0.18) to left (2.96):
      // invert deltaRad so Right key still moves aim rightward and Left key moves aim leftward.
      const clampedDown = Math.max(spec.minAngle, Math.min(spec.maxAngle, this.aimAngle - deltaRad));
      this.updateAimFromAngle(clampedDown);
      return;
    }
    const clamped = Math.max(spec.minAngle, Math.min(spec.maxAngle, this.aimAngle + deltaRad));
    this.updateAimFromAngle(clamped);
  },

  /** Centers the aim along the active launcher posture's default direction or drop-rail center. */
  recenterAim() {
    if (this.state !== GAME_STATES.PLAYING) {
      return;
    }
    this.isAimCancelled = false;
    this.isAimLocked = true;
    this.aimLockOrigin = null;
    const spec = this.getLauncherSpec();
    if (spec.posture === LAUNCHER_POSTURES.DROP_RAIL) {
      this.mergeDropX = spec.x;
    }
    this.updateAimFromAngle(spec.defaultAngle);
  },

  /**
   * Whether a mouse position should drive the aim. After a keyboard adjustment the aim
   * stays put until the pointer travels farther than canvas.pointerAimUnlockDistance from
   * where it was first seen; the lock then lifts and the pointer drives the aim again.
   * @param {number} x - Pointer position in logical coordinates.
   * @param {number} y - Pointer position in logical coordinates.
   * @returns {boolean} True when the caller should aim at the pointer.
   */
  followPointer(x, y) {
    if (!this.isAimLocked) {
      return true;
    }
    if (!this.aimLockOrigin) {
      this.aimLockOrigin = { x, y };
      return false;
    }
    const travel = Math.hypot(x - this.aimLockOrigin.x, y - this.aimLockOrigin.y);
    if (travel <= this.gameConfig.canvas.pointerAimUnlockDistance) {
      return false;
    }
    this.releaseAimLock();
    return true;
  },

  /** Hands the aim back to the pointer, as a touch or a long mouse movement does. */
  releaseAimLock() {
    this.isAimLocked = false;
    this.aimLockOrigin = null;
  },

  updateAim(targetX, targetY) {
    const spec = this.getLauncherSpec();
    if (spec.posture === LAUNCHER_POSTURES.DROP_RAIL) {
      if (spec.cancelOffset > 0 && targetY < spec.y - spec.cancelOffset) {
        this.isAimCancelled = true;
        return;
      }
      this.isAimCancelled = false;
      const behavior = this.getModeBehavior();
      const radius = this.currentBall?.radius || this.physicsConfig.ball.radius;
      this.mergeDropX = behavior.clampDropX
        ? behavior.clampDropX(this, targetX, radius)
        : targetX;
      this.updateAimFromAngle(spec.defaultAngle);
      return;
    }
    if (spec.posture === LAUNCHER_POSTURES.OMNI_360) {
      const dx = targetX - spec.x;
      const dy = targetY - spec.y;
      if (spec.cancelRadius > 0 && Math.hypot(dx, dy) <= spec.cancelRadius) {
        this.isAimCancelled = true;
        return;
      }
      this.isAimCancelled = false;
      this.updateAimFromAngle(Math.atan2(dy, dx));
      return;
    }
    if (spec.posture === LAUNCHER_POSTURES.DOWNWARD) {
      if (targetY < spec.y - spec.cancelOffset) {
        this.isAimCancelled = true;
        return;
      }
      this.isAimCancelled = false;
      const dx = targetX - spec.x;
      const dy = targetY - spec.y;
      let angle = Math.atan2(dy, dx);
      if (angle < 0) {
        angle = dx >= 0 ? spec.minAngle : spec.maxAngle;
      }
      angle = Math.max(spec.minAngle, Math.min(spec.maxAngle, angle));
      this.updateAimFromAngle(angle);
      return;
    }
    const canvasCfg = this.gameConfig.canvas;
    const cancelThresholdY = spec.y + canvasCfg.cancelAimOffsetY;
    if (targetY > cancelThresholdY) {
      this.isAimCancelled = true;
      return;
    }
    this.isAimCancelled = false;
    const dx = targetX - spec.x;
    const dy = targetY - spec.y;
    let angle = Math.atan2(dy, dx);
    if (angle > spec.maxAngle) {
      angle = dx >= 0 ? spec.maxAngle : spec.minAngle;
    }
    angle = Math.max(spec.minAngle, Math.min(spec.maxAngle, angle));
    this.updateAimFromAngle(angle);
  },

  updateAimFromAngle(angle) {
    this.aimAngle = angle;
    this.isAimPreviewStale = false;
    const spec = this.getLauncherSpec();
    if (spec.posture === LAUNCHER_POSTURES.DROP_RAIL) {
      this.aimPoints = [];
      return;
    }
    const bonuses = this.getLaserBonuses();
    this.aimPoints = this.physicsWorld.computeAimTrajectory(
      spec.x,
      spec.y,
      this.aimAngle,
      this.currentBall,
      bonuses.distanceBonus,
      bonuses.bouncesBonus,
      this.isPolarityFlipped
    );
    if (this.versus) {
      this.applyVersusAimPreview();
    } else if (this.magnetar && this.magnetar.charges.length > 0 && !this.currentBall?.specialType) {
      const hitRadius = this.getChargeRadius() + this.physicsConfig.ball.radius;
      const cut = truncateAimAtCharges(this.aimPoints, this.magnetar.charges, hitRadius);
      if (cut.hit) {
        const shot = shotPolarity(
          this.currentBall?.colorId,
          this.isPolarityFlipped,
          this.gameConfig.versus,
          this.physicsWorld.polarityMap
        );
        this.aimPreview = {
          chargeHit: {
            x: cut.hit.x,
            y: cut.hit.y,
            polarity: cut.hit.charge.polarity,
            outcome: shot === null ? null : resolveChargeHit(cut.hit.charge, { polarity: shot }).outcome
          }
        };
        this.aimPoints = cut.points;
      } else if (this.aimPreview) {
        this.aimPreview = undefined;
      }
    } else if (this.aimPreview) {
      this.aimPreview = undefined;
    }
  },

  /** A bounce against a side wall cracks it; ceiling and obstacle bounces do not. */
  crackWallAt(x, y) {
    const canvasCfg = this.gameConfig.canvas;
    const wallReach = canvasCfg.wallMargin + this.physicsConfig.ball.radius;
    if (x <= wallReach) {
      this.particleSystem.addWallCrack(canvasCfg.wallMargin, y, 1);
    } else if (x >= canvasCfg.logicalWidth - wallReach) {
      this.particleSystem.addWallCrack(canvasCfg.logicalWidth - canvasCfg.wallMargin, y, -1);
    }
  },

  /** True when the device tilt is ignored: Daily, Classic, Puzzle, locked behavior modes, and shared-seed Flux. */
  isTiltLocked() {
    return (
      this.mode === GAME_MODES.DAILY
      || this.mode === GAME_MODES.CLASSIC
      || this.mode === GAME_MODES.PUZZLE
      || (this.mode === GAME_MODES.FLUX && this.isSharedFluxRun)
      || this.getModeBehavior().isTiltLocked(this)
    );
  },

  /**
   * Tilts gravity sideways from the device orientation: a share of the cluster gravity,
   * clamped to tilt.maxGravityShare, pushes the hanging spheres left or right.
   * @param {number} share - Signed share of gravity, positive to the right.
   */
  setTilt(share) {
    if (this.isTiltLocked()) {
      this.physicsWorld.tiltFactor = 0;
      return;
    }
    const maxShare = this.gameConfig.tilt.maxGravityShare;
    this.physicsWorld.tiltFactor = Math.max(-maxShare, Math.min(maxShare, Number(share) || 0));
  },

  /**
   * Recomputes the aim preview if the board moved since it was last traced. Called once
   * per rendered frame, however many fixed steps the frame ran.
   */
  refreshAimPreview() {
    if (!this.isAimPreviewStale) {
      return;
    }
    this.isAimPreviewStale = false;
    if (this.state === GAME_STATES.PLAYING && !this.physicsWorld.projectile && !this.isAimCancelled) {
      this.updateAimFromAngle(this.aimAngle);
    }
  },
};
