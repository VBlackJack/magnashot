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
  GAME_STATES
} from '../core/Constants.js';
import { isRunSnapshotable } from './RunSnapshot.js';
import { DISCOVERY_INTERACTIONS } from './Discovery.js';

/** Methods of GameEngine that belong to this domain, installed on its prototype. */
export const engineControlsMethods = {
  /**
   * False on a campaign level that hands out no special ball while the run holds none and
   * none is loaded: the special ball slots stay out of sight until there is one to use.
   * @returns {boolean} True when the special ball slots belong on screen.
   */
  offersSpecialBalls() {
    if (this.mode !== GAME_MODES.CAMPAIGN) {
      return true;
    }
    const levelDef = this.levelCatalog.get(this.currentLevelId);
    const grants = Object.values(levelDef?.specialInventory || {}).some((count) => count > 0);
    const holds = Object.values(this.specialInventory).some((count) => count > 0);
    return grants || holds || Boolean(this.currentBall?.specialType);
  },

  /** True in the Daily Challenge while shop ammo is switched off for fairness. */
  isDailyAmmoLocked() {
    return this.mode === GAME_MODES.DAILY && !this.gameConfig.seededFairness?.dailyAllowsSpecialAmmo;
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
    return !this.isDailyAmmoLocked() && isRunSnapshotable(this) && !this.isStageChanging() && !this.isAwaitingPerk();
  },

  /**
   * Why a special ball cannot be bought right now, for the shop to explain.
   * @returns {'fairPlay'|'shotInFlight'|'stageChanging'|'perkChoice'|null} Null when it can, or when no run is active.
   */
  getSpecialAmmoBlockReason() {
    if (this.state !== GAME_STATES.PLAYING && this.state !== GAME_STATES.PAUSED) {
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
    if (!this.canBuySpecialAmmo()) {
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
      (this.mode === GAME_MODES.PUZZLE && this.shotsRemaining <= 1)
    ) {
      return;
    }
    const temp = this.currentBall;
    this.currentBall = this.nextBall;
    this.nextBall = temp;
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
    const canvasCfg = this.gameConfig.canvas;
    const clamped = Math.max(-canvasCfg.maxAimAngleRad, Math.min(-canvasCfg.minAimAngleRad, this.aimAngle + deltaRad));
    this.updateAimFromAngle(clamped);
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
    const canvasCfg = this.gameConfig.canvas;
    const cancelThresholdY = canvasCfg.launcherY + canvasCfg.cancelAimOffsetY;
    if (targetY > cancelThresholdY) {
      this.isAimCancelled = true;
      return;
    }
    this.isAimCancelled = false;
    const dx = targetX - canvasCfg.launcherX;
    const dy = targetY - canvasCfg.launcherY;
    let angle = Math.atan2(dy, dx);
    if (angle > -canvasCfg.minAimAngleRad) {
      angle = dx >= 0 ? -canvasCfg.minAimAngleRad : -canvasCfg.maxAimAngleRad;
    }
    angle = Math.max(-canvasCfg.maxAimAngleRad, Math.min(-canvasCfg.minAimAngleRad, angle));
    this.updateAimFromAngle(angle);
  },

  updateAimFromAngle(angle) {
    this.aimAngle = angle;
    this.isAimPreviewStale = false;
    const canvasCfg = this.gameConfig.canvas;
    const bonuses = this.getLaserBonuses();
    this.aimPoints = this.physicsWorld.computeAimTrajectory(
      canvasCfg.launcherX,
      canvasCfg.launcherY,
      this.aimAngle,
      this.currentBall,
      bonuses.distanceBonus,
      bonuses.bouncesBonus,
      this.isPolarityFlipped
    );
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

  /** True when the device tilt is ignored: Daily and shared-seed Flux runs share one physics. */
  isTiltLocked() {
    return this.mode === GAME_MODES.DAILY || (this.mode === GAME_MODES.FLUX && this.isSharedFluxRun);
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
