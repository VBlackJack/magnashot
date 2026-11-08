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
  OBJECTIVE_TYPES,
  GAME_STATES,
  SPECIAL_TYPES,
  CLUSTER_MODIFIERS,
  GAME_OVER_REASONS,
  MATH_CONSTANTS
} from '../core/Constants.js';
import { t } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { Ball } from '../entities/Ball.js';
import { ParticleSystem } from '../entities/ParticleSystem.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { SpecialBallController } from './SpecialBallController.js';
import { captureRunSnapshot, isValidRunSnapshot, applyRunSnapshot, isRunSnapshotable } from './RunSnapshot.js';
import { LevelCatalog } from './LevelCatalog.js';
import { DISCOVERY_INTERACTIONS } from './Discovery.js';

const ACHIEVEMENT_TIER_ORDER = Object.freeze(['bronze', 'silver', 'gold']);

import { installMethods } from '../core/installMethods.js';
import { engineModeMethods, FLUX_PERK_IDS } from './EngineModes.js';
import { engineBoardMethods } from './EngineBoard.js';
import { engineLauncherMethods } from './EngineLauncher.js';
import { engineDiscoveryMethods } from './EngineDiscovery.js';
import { engineControlsMethods } from './EngineControls.js';
import { engineTurnResolutionMethods } from './EngineTurnResolution.js';
import { engineRoundFlowMethods } from './EngineRoundFlow.js';

/** What a run is measured by when it is compared with the mode's record. */
export const RUN_BEST_METRICS = Object.freeze({
  STAGE: 'stage',
  WAVE: 'wave',
  SCORE: 'score'
});

export { FLUX_PERK_IDS };

export class GameEngine {
  constructor({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    campaignConfig,
    campaignTuning = null,
    fluxConfig,
    audioManager,
    storageManager,
    onStateChange
  }) {
    this.gameConfig = gameConfig;
    this.physicsConfig = physicsConfig;
    this.ballsConfig = ballsConfig;
    this.obstaclesConfig = obstaclesConfig;
    this.levelsConfig = levelsConfig;
    this.fluxConfig = fluxConfig;
    this.levelCatalog = new LevelCatalog({
      levelsConfig,
      campaignConfig,
      campaignTuning,
      fluxConfig,
      obstaclesConfig,
      ballRadius: physicsConfig.ball.radius
    });
    this.audioManager = audioManager;
    this.storageManager = storageManager;
    this.onStateChange = onStateChange;

    this.physicsWorld = new PhysicsWorld(physicsConfig, gameConfig, ballsConfig);
    // Daily runs draw avalanche drift from the seeded stream so scores stay reproducible
    this.physicsWorld.setRandomSource(() => this.random());
    this.particleSystem = new ParticleSystem(gameConfig.juice);
    this.isReducedMotion = false;
    this.animationSpeed = gameConfig.defaults?.animationSpeed ?? 1;
    if (this.storageManager && typeof this.storageManager.getReducedMotion === 'function') {
      this.setReducedMotion(this.storageManager.getReducedMotion());
    }
    if (this.storageManager && typeof this.storageManager.getAnimationSpeed === 'function') {
      this.setAnimationSpeed(this.storageManager.getAnimationSpeed());
    }
    this.specialController = new SpecialBallController(ballsConfig, gameConfig);

    this.mode = GAME_MODES.CAMPAIGN;
    this.state = GAME_STATES.READY;
    this.currentLevelId = 1;
    this.score = 0;
    this.combo = 0;
    this.maxComboInRound = 0;
    this.runCoinsEarned = 0;
    this.overcharge = 0;
    this.shotsRemaining = 0;
    this.waveCount = 1;
    this.waveLog = [];
    this.endlessRowParity = 0;
    this.shotsUntilWave = 0;
    this.freezeTurnsRemaining = 0;
    this.chainCooldown = 0;
    this.pendingRunCoins = 0;
    // A Boss Rush wave clear waiting for the shot in flight to land.
    this.pendingBossRushWave = false;
    // True for a Flux run started from a shared seed link.
    this.isSharedFluxRun = false;
    this.anvilCrushCount = 0;
    this.isCoreFreezeApplied = false;
    this.outOfShotsGraceFrames = 0;
    this.victoryCelebrationFrames = 0;
    this.victorySummary = null;
    this.gameOverSummary = null;
    this.runBestBaseline = null;
    this.hitStopFrames = 0;
    this.specialSlowMoFrames = 0;
    this.specialSlowMoTotalFrames = 0;
    this.specialSlowMoMinScale = 1.0;
    this.specialSlowMoColor = null;
    this.isSteppingPhysics = false;
    this.pendingRoundEnd = false;
    this.hadDroppingBalls = false;
    this.detonationOrigin = null;
    this.impactWave = null;
    this.trailFrameCounter = 0;
    this.hasFiredInRound = false;
    this.hasUsedContinue = false;
    this.bossesDestroyedInRun = 0;
    this.activeDiscoveryId = null;
    this.discoveryTurnCount = 0;
    // Run-scoped and tolerant in snapshots: hints shown without being learned, the hint
    // being replayed from the HUD, and the first-play banner of a campaign level.
    this.discoveryShownIds = new Set();
    this.isActiveHintLearned = false;
    this.isHintShownThisTurn = false;
    this.hintReplayQueue = [];
    this.isReplayingHints = false;
    this.levelIntro = null;
    /** Mechanics sharing the hint on screen, kept while that hint stays (read every flight step). */
    this.proximityGroupHintId = null;
    this.proximityGroup = null;
    // Levels whose banner already showed in this session, so a retry after a defeat is quiet.
    this.introducedLevelIds = new Set();
    this.introducedDailySeeds = new Set();
    this.levelTutorialKey = null;
    this.isAimCancelled = false;
    this.isAimLocked = false;
    this.aimLockOrigin = null;
    this.isPolarityFlipped = false;
    this.activeMutatorKey = null;
    this.dailySeedKey = null;
    this.seededRng = null;
    this.scopedRng = null;
    this.fluxSeed = null;
    this.fluxStage = 0;
    this.fluxFamily = null;
    this.fluxPreviousFamily = null;
    this.fluxShapeIds = [];
    this.fluxIsBossStage = false;
    this.fluxPerks = {};
    this.fluxPerkOffer = null;
    this.stageTransitionFrames = 0;
    this.stageIntroFrames = 0;
    this.currentObjective = OBJECTIVE_TYPES.CLEAR_ALL;
    this.targetCoreCount = 0;
    this.rescuedCores = 0;
    this.currentPuzzleStage = 1;
    this.puzzleQueue = [];
    this.blitzFramesRemaining = 0;
    this.blitzWaveTimerFrames = 0;
    this.blitzIdleFrames = 0;
    this.bossRushWave = 1;
    this.cascadeWave = 1;
    this.cascadeTurnsUntilDrop = 0;

    this.activePalette = [];
    this.specialInventory = {};
    this.currentBall = null;
    this.stashedRegularColorId = null;
    this.nextBall = null;
    this.aimAngle = -Math.PI * MATH_CONSTANTS.HALF;
    this.aimPoints = [];
    // Colors of the balls queued after nextBall, shown beside the launcher.
    this.upcomingColorIds = [];
    this.levelStartBallCount = 0;
    this.isAimPreviewStale = false;
    this.laserBonuses = { distanceBonus: 0, bouncesBonus: 0 };
    this.stepCallbacks = null;
    this.isRestoringRun = false;
    this.seedDiscoveriesFromProgress();
  }

  random() {
    const source = this.scopedRng || this.seededRng;
    return source ? source.next() : Math.random();
  }

  /**
   * Runs `build` with board generation drawing from its own deterministic stream, so a
   * shared seed gives the same stage or wave whatever shots were played before it.
   * Unseeded runs keep drawing from the ambient source.
   * @param {string|null} streamKey - Stream suffix derived from seed + index; null disables scoping.
   * @param {() => T} build - Generation callback.
   * @returns {T} The callback result.
   * @template T
   */
  withScopedRandom(streamKey, build) {
    if (!this.seededRng || !streamKey) {
      return build();
    }
    const previous = this.scopedRng;
    this.scopedRng = new SeededRandom(streamKey);
    try {
      return build();
    } finally {
      this.scopedRng = previous;
    }
  }

  isSurvivalMode() {
    return this.mode === GAME_MODES.ENDLESS || this.mode === GAME_MODES.DAILY;
  }

  /** True for modes where every shot spends a limited reserve (Campaign, Flux and Puzzle). */
  usesShotBudget() {
    return (
      this.mode === GAME_MODES.CAMPAIGN
      || this.mode === GAME_MODES.FLUX
      || this.mode === GAME_MODES.PUZZLE
    );
  }

  /**
   * True while a cleared Flux shape gives way to the next one: the outgoing balls fall,
   * then the new shape slides in. Shooting waits until the new shape is in place.
   */
  isStageChanging() {
    return this.stageTransitionFrames > 0 || this.stageIntroFrames > 0;
  }

  /**
   * Progress of the incoming Flux shape's entrance, from 0 (just spawned) to 1 (in place).
   */
  getStageIntroProgress() {
    const introFrames = this.fluxConfig?.transition.introFrames || 0;
    if (this.stageIntroFrames <= 0 || introFrames <= 0) {
      return 1;
    }
    return 1 - this.stageIntroFrames / introFrames;
  }

  /**
   * Starts or extends a cinematic slow-motion window after a high-impact special ball
   * detonation. Ignored when reduced motion is active.
   * @param {number} frames - Number of fixed simulation steps to dilate.
   * @param {number} timeScale - Minimum simulation time scale during the detonation.
   * @param {string|null} [color] - Highlight color for the slow-motion perimeter glow.
   */
  triggerSpecialSlowMo(frames, timeScale, color = null) {
    if (this.isReducedMotion || !frames || frames <= 0 || !Number.isFinite(timeScale) || timeScale >= 1) {
      return;
    }
    this.specialSlowMoFrames = Math.max(this.specialSlowMoFrames, frames);
    this.specialSlowMoTotalFrames = Math.max(this.specialSlowMoTotalFrames, this.specialSlowMoFrames);
    this.specialSlowMoMinScale = Math.min(this.specialSlowMoMinScale, timeScale);
    if (color) {
      this.specialSlowMoColor = color;
    }
  }

  /**
   * Simulation speed factor read by the game loop. Time slows down after an explosive
   * special ball detonation (easing smoothly back to normal speed) and while a shot flies
   * close to one of the last few spheres of a shot-limited board; reduced motion keeps normal speed.
   * @returns {number} 1 for normal speed, below 1 for slow motion.
   */
  getTimeScale() {
    if (this.isReducedMotion || this.state !== GAME_STATES.PLAYING || this.hitStopFrames > 0) {
      return 1;
    }
    const slowMotion = this.gameConfig.juice.slowMotion;
    let scale = 1;
    if (this.specialSlowMoFrames > 0 && this.specialSlowMoTotalFrames > 0) {
      const progress = 1 - this.specialSlowMoFrames / this.specialSlowMoTotalFrames;
      const holdRatio = slowMotion.detonationHoldRatio ?? MATH_CONSTANTS.HALF;
      if (progress <= holdRatio) {
        scale = this.specialSlowMoMinScale;
      } else {
        const easeRatio = (progress - holdRatio) / Math.max(MATH_CONSTANTS.EPSILON, 1 - holdRatio);
        scale = this.specialSlowMoMinScale + (1 - this.specialSlowMoMinScale) * easeRatio;
      }
    }
    const projectile = this.physicsWorld.projectile;
    if (projectile && this.usesShotBudget()) {
      const balls = this.physicsWorld.balls;
      if (balls.length > 0 && balls.length <= slowMotion.maxRemainingBalls) {
        const isNearTarget = balls.some(
          (b) => Math.hypot(b.x - projectile.x, b.y - projectile.y) <= slowMotion.triggerDistance
        );
        if (isNearTarget) {
          scale = Math.min(scale, slowMotion.timeScale);
        }
      }
    }
    return scale;
  }

  /**
   * True only while a run is being played; every score, coin and state transition
   * is gated on it so that a finished run can never be resolved or rewarded twice.
   */
  isRunPlaying() {
    return this.state === GAME_STATES.PLAYING;
  }

  /**
   * True during the short pause after a campaign victory in which the last matches,
   * falling balls and particles keep animating before the victory modal is shown.
   */
  isVictoryCelebrating() {
    return this.state === GAME_STATES.VICTORY && this.victoryCelebrationFrames > 0;
  }

  /**
   * The metric the current mode's record is kept in, with the value reached so far.
   * @returns {{metric: string, current: number}|null} null for modes without a record.
   */
  getRunBestMetric() {
    switch (this.mode) {
      case GAME_MODES.FLUX:
        return { metric: RUN_BEST_METRICS.STAGE, current: this.fluxStage };
      case GAME_MODES.BOSS_RUSH:
        return { metric: RUN_BEST_METRICS.WAVE, current: this.bossRushWave };
      case GAME_MODES.ENDLESS:
      case GAME_MODES.DAILY:
      case GAME_MODES.CASCADE:
      case GAME_MODES.BLITZ:
        return { metric: RUN_BEST_METRICS.SCORE, current: this.score };
      default:
        return null;
    }
  }

  /**
   * The mode's record as it stood when the run started (captured once, before the run
   * first writes its own progress to storage).
   * @returns {{metric: string, best: number}|null}
   */
  getRunBestBaseline() {
    if (this.runBestBaseline) {
      return this.runBestBaseline;
    }
    const measured = this.getRunBestMetric();
    if (!measured) {
      return null;
    }
    const storage = this.storageManager;
    let best = 0;
    if (this.mode === GAME_MODES.FLUX) {
      best = storage.getFluxBestStage?.() || 0;
    } else if (this.mode === GAME_MODES.BOSS_RUSH) {
      best = storage.getBossRushBestWave?.() || 0;
    } else if (this.mode === GAME_MODES.ENDLESS) {
      best = storage.getEndlessHighScore?.() || 0;
    } else if (this.mode === GAME_MODES.DAILY) {
      best = storage.getDailyHighScore?.(this.dailySeedKey || SeededRandom.getTodayDateKey()) || 0;
    } else if (this.mode === GAME_MODES.CASCADE) {
      best = storage.getCascadeHighScore?.() || 0;
    } else if (this.mode === GAME_MODES.BLITZ) {
      best = storage.getBlitzHighScore?.() || 0;
    }
    this.runBestBaseline = { metric: measured.metric, best };
    return this.runBestBaseline;
  }

  /**
   * Puts back the record a stored run started against. Ignored when it is damaged or was
   * measured in another metric than this mode's.
   * @param {{metric?: string, best?: number}|null|undefined} saved - Baseline from a run snapshot.
   */
  restoreRunBestBaseline(saved) {
    const measured = this.getRunBestMetric();
    if (
      measured
      && saved
      && saved.metric === measured.metric
      && Number.isFinite(saved.best)
      && saved.best >= 0
    ) {
      this.runBestBaseline = { metric: saved.metric, best: saved.best };
    }
  }

  /**
   * Best-run marker for the HUD during a run.
   * @returns {{metric: string, best: number, current: number}|null} null without a record to beat.
   */
  getRunBestMarker() {
    const measured = this.getRunBestMetric();
    const baseline = measured ? this.getRunBestBaseline() : null;
    if (!measured || !baseline || baseline.best <= 0) {
      return null;
    }
    return { metric: measured.metric, best: baseline.best, current: measured.current };
  }

  /**
   * How far a finished run fell short of the record. Informational only.
   * @returns {{metric: string, current: number, best: number, gap: number}|null}
   */
  computeNearMiss() {
    const marker = this.getRunBestMarker();
    if (!marker || marker.current >= marker.best) {
      return null;
    }
    // A run far below the record is not a near miss: the line would read as a taunt.
    const maxGapRatio = this.gameConfig.scoring.nearMissMaxGapRatio;
    if ((marker.best - marker.current) / marker.best > maxGapRatio) {
      return null;
    }
    return {
      metric: marker.metric,
      current: marker.current,
      best: marker.best,
      gap: marker.best - marker.current
    };
  }

  /**
   * Persists the current survival run score as a high score when it beats the stored one.
   * Called when a run ends or is left, never on every score event.
   */
  persistRunHighScore() {
    // The record in storage moves with the run: keep the one the run started against.
    this.getRunBestBaseline();
    if (this.mode === GAME_MODES.ENDLESS) {
      this.storageManager.setEndlessHighScore(this.score);
    } else if (this.mode === GAME_MODES.DAILY) {
      this.storageManager.setDailyHighScore(this.score, this.dailySeedKey);
    } else if (this.mode === GAME_MODES.FLUX) {
      this.storageManager.setFluxRecord(this.score, this.fluxStage);
    } else if (this.mode === GAME_MODES.BLITZ) {
      this.storageManager.setBlitzHighScore?.(this.score);
    } else if (this.mode === GAME_MODES.BOSS_RUSH) {
      this.storageManager.setBossRushRecord?.(this.score, this.bossRushWave);
    } else if (this.mode === GAME_MODES.CASCADE) {
      this.storageManager.setCascadeHighScore?.(this.score);
    } else if (this.mode === GAME_MODES.PUZZLE) {
      const totalPuzzles = this.gameConfig.puzzles?.length || 1;
      const reachedStage = this.state === GAME_STATES.VICTORY && this.currentPuzzleStage < totalPuzzles
        ? this.currentPuzzleStage + 1
        : this.currentPuzzleStage;
      this.storageManager.setPuzzleRecord?.(this.score, reachedStage);
    }
  }

  /**
   * Stores the run so it survives a reload or the tab being discarded. Only runs with at
   * least one shot are kept, and only between shots (see isRunSnapshotable): a run that
   * cannot be captured right now keeps its last stored snapshot.
   * @param {{force?: boolean}} [options] - force also stores a run before its first shot:
   *   a new Flux shape, a restored run (starting its board cleared the stored one) or a
   *   purchase, which a reload must not lose.
   */
  saveRunSnapshot({ force = false } = {}) {
    if (!force && !this.hasFiredInRound) {
      return;
    }
    const snapshot = captureRunSnapshot(this, this.storageManager.getRunSnapshotVersion());
    if (snapshot) {
      this.storageManager.saveRunSnapshot(snapshot);
      this.flushPendingRunCoins();
    }
  }

  /**
   * Pays coins earned in the run. Coins earned while the run cannot be captured (a shot
   * in flight, a Flux shape being replaced) are held until the next snapshot: the stored
   * run still predates them, so a reload at that moment would replay the shot and pay
   * them a second time.
   * @param {number} amount - Coins to pay.
   */
  awardRunCoins(amount) {
    if (amount <= 0) {
      return;
    }
    this.runCoinsEarned += amount;
    if (isRunSnapshotable(this)) {
      this.storageManager.addCoins(amount);
    } else {
      this.pendingRunCoins += amount;
    }
  }

  /** Writes the coins held by awardRunCoins once the run they belong to is settled. */
  flushPendingRunCoins() {
    if (this.pendingRunCoins > 0) {
      this.storageManager.addCoins(this.pendingRunCoins);
    }
    this.pendingRunCoins = 0;
  }

  /**
   * Resumes the stored run, paused, in place of the current one.
   * @returns {boolean} True when a stored run was restored; false when there was none or it
   *   was unusable, in which case it is discarded and the caller starts a run normally.
   */
  restoreSavedRun() {
    const snapshot = this.storageManager.loadRunSnapshot();
    if (!snapshot) {
      return false;
    }
    if (!isValidRunSnapshot(snapshot, this.storageManager.getRunSnapshotVersion())) {
      this.storageManager.clearRunSnapshot();
      return false;
    }
    let isRestored = false;
    this.isRestoringRun = true;
    try {
      isRestored = applyRunSnapshot(this, snapshot);
    } catch (err) {
      console.error('Saved run could not be restored:', err);
    } finally {
      this.isRestoringRun = false;
    }
    if (!isRestored) {
      this.storageManager.clearRunSnapshot();
      return false;
    }
    this.levelIntro = null;
    this.isActiveHintLearned = Boolean(
      this.activeDiscoveryId && this.storageManager.getDiscoveries()[this.activeDiscoveryId]
    );
    this.refreshDiscovery();
    this.saveRunSnapshot({ force: true });
    this.notifyUI();
    return true;
  }

  /**
   * Saves the outgoing run's high score, then resets every per-run counter shared by all modes.
   * @param {string} mode - Game mode of the run being started.
   */
  resetRunState(mode) {
    this.persistRunHighScore();
    this.flushPendingRunCoins();
    this.storageManager.clearRunSnapshot();
    this.mode = mode;
    this.runBestBaseline = null;
    // clear() keeps the tilt: a run must not start leaning from the previous run's last reading.
    this.physicsWorld.tiltFactor = 0;
    this.score = 0;
    this.combo = 0;
    this.maxComboInRound = 0;
    this.runCoinsEarned = 0;
    this.overcharge = 0;
    this.freezeTurnsRemaining = 0;
    this.chainCooldown = 0;
    this.pendingRunCoins = 0;
    // A Boss Rush wave clear waiting for the shot in flight to land.
    this.pendingBossRushWave = false;
    // True for a Flux run started from a shared seed link.
    this.isSharedFluxRun = false;
    this.anvilCrushCount = 0;
    this.isCoreFreezeApplied = false;
    this.outOfShotsGraceFrames = 0;
    this.victoryCelebrationFrames = 0;
    this.victorySummary = null;
    this.gameOverSummary = null;
    this.hitStopFrames = 0;
    this.specialSlowMoFrames = 0;
    this.specialSlowMoTotalFrames = 0;
    this.specialSlowMoMinScale = 1.0;
    this.specialSlowMoColor = null;
    this.isSteppingPhysics = false;
    this.pendingRoundEnd = false;
    this.hadDroppingBalls = false;
    this.detonationOrigin = null;
    this.impactWave = null;
    this.hasFiredInRound = false;
    this.hasUsedContinue = false;
    this.bossesDestroyedInRun = 0;
    this.activeDiscoveryId = null;
    this.discoveryTurnCount = 0;
    this.discoveryShownIds = new Set();
    this.isActiveHintLearned = false;
    this.isHintShownThisTurn = false;
    this.hintReplayQueue = [];
    this.isReplayingHints = false;
    this.levelIntro = null;
    this.levelTutorialKey = null;
    this.isAimCancelled = false;
    this.isAimLocked = false;
    this.aimLockOrigin = null;
    this.isPolarityFlipped = false;
    this.activeMutatorKey = null;
    this.dailySeedKey = null;
    this.seededRng = null;
    this.scopedRng = null;
    this.waveLog = [];
    this.stashedRegularColorId = null;
    this.fluxSeed = null;
    this.fluxStage = 0;
    this.fluxFamily = null;
    this.fluxPreviousFamily = null;
    this.fluxShapeIds = [];
    this.fluxIsBossStage = false;
    this.fluxPerks = {};
    this.fluxPerkOffer = null;
    this.stageTransitionFrames = 0;
    this.stageIntroFrames = 0;
    this.currentObjective = OBJECTIVE_TYPES.CLEAR_ALL;
    this.targetCoreCount = 0;
    this.rescuedCores = 0;
    this.currentPuzzleStage = 1;
    this.puzzleQueue = [];
    this.blitzFramesRemaining = 0;
    this.blitzWaveTimerFrames = 0;
    this.blitzIdleFrames = 0;
    this.bossRushWave = 1;
    this.cascadeWave = 1;
    this.cascadeTurnsUntilDrop = 0;
    this.physicsWorld.gravityMultiplier = 1.0;
    this.physicsWorld.magnetismMultiplier = 1.0;
    this.physicsWorld.rotorSpeedMultiplier = 1.0;
  }

  /**
   * Unlocks every tier of an achievement family whose threshold the value reaches, lowest
   * first, and announces the tiers unlocked by this call once (one popup, one announcement).
   *
   * What counts depends on the family:
   * - Per-run record families (combo, avalanche, boss slayer, sharpshooter, survivor waves,
   *   flux shapes, Boss Rush waves) only count from play: the caller passes the value the
   *   run just reached, so a record stored before the update never pays anything.
   * - Cumulative families (`cumulative: true` in the achievement config, e.g. stars) measure
   *   earned progress, so the caller passes the running total. A veteran whose total already
   *   passes a tier gets it on the next call, once, as an intended catch-up.
   * @param {string} baseId - Id of the family's base (bronze) achievement.
   * @param {number} value - Value reached in play just now, or the running total for a
   *   cumulative family.
   */
  unlockAchievementTiers(baseId, value) {
    const rank = (tier) => ACHIEVEMENT_TIER_ORDER.indexOf(tier);
    const tiers = Object.values(this.gameConfig.achievements || {})
      .filter((spec) => spec.tierOf === baseId)
      .sort((a, b) => rank(a.tier) - rank(b.tier));
    const unlockedIds = [];
    for (const spec of tiers) {
      if (value >= spec.threshold && this.unlockAchievementSilently(spec.id)) {
        unlockedIds.push(spec.id);
      }
    }
    this.announceAchievementUnlocks(unlockedIds);
  }

  /**
   * Stores an achievement as unlocked (and pays its reward) without announcing it.
   * @param {string} achievementId - Achievement to unlock.
   * @returns {boolean} True when it was newly unlocked.
   */
  unlockAchievementSilently(achievementId) {
    return Boolean(this.storageManager.unlockAchievement(achievementId));
  }

  /**
   * One popup, one sound and one screen-reader announcement for the achievements unlocked
   * together.
   * @param {string[]} achievementIds - Ids just unlocked, lowest tier first.
   */
  announceAchievementUnlocks(achievementIds) {
    if (achievementIds.length === 0) {
      return;
    }
    const names = achievementIds.map((id) => t(`modals.shop.achievements.items.${id}.name`));
    const rewardCoins = achievementIds.reduce(
      (sum, id) => sum + (this.gameConfig.achievements?.[id]?.rewardCoins || 0),
      0
    );
    const popupKey = achievementIds.length === 1
      ? 'gameplay.feedback.achievement.unlocked'
      : 'gameplay.feedback.achievement.unlockedMany';
    this.audioManager.playEffect('achievement');
    this.particleSystem.spawnFloatingText(
      this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      this.gameConfig.canvas.launcherY + this.gameConfig.canvas.anvilPopupOffsetY,
      t(popupKey, { name: names.join(t('gameplay.feedback.achievement.listSeparator')), coins: rewardCoins }),
      this.gameConfig.theme.coinPopupColor
    );
    this.notifyUI({ unlockedAchievementIds: [...achievementIds] });
  }

  checkAndUnlockAchievement(achievementId) {
    if (this.unlockAchievementSilently(achievementId)) {
      this.announceAchievementUnlocks([achievementId]);
    }
  }

  getBlastRadiusMultiplier() {
    const lvl = this.storageManager.getUpgradeLevel('blastRadius');
    const spec = this.gameConfig.upgrades.blastRadius;
    return 1 + lvl * spec.radiusMultiplierPerLevel + this.getFluxPerkBonus(FLUX_PERK_IDS.BLAST);
  }

  getOverchargeMultiplier() {
    const lvl = this.storageManager.getUpgradeLevel('overchargeRate');
    const spec = this.gameConfig.upgrades.overchargeRate;
    return 1 + lvl * spec.rateMultiplierPerLevel + this.getFluxPerkBonus(FLUX_PERK_IDS.OVERCHARGE);
  }

  /**
   * Laser Sight reach bonuses. The returned object is reused across calls (the aim preview
   * asks every frame): read it right away, do not keep it.
   */
  getLaserBonuses() {
    const lvl = this.storageManager.getUpgradeLevel('laserSight');
    const spec = this.gameConfig.upgrades.laserSight;
    this.laserBonuses.distanceBonus = lvl * spec.distanceBonusPerLevel;
    this.laserBonuses.bouncesBonus = lvl * spec.bouncesBonusPerLevel;
    return this.laserBonuses;
  }

  getStartingShotsBonus() {
    const lvl = this.storageManager.getUpgradeLevel('startingShots');
    const spec = this.gameConfig.upgrades.startingShots;
    return lvl * spec.shotsPerLevel;
  }

  getCollectorBonusPoints() {
    const base = this.gameConfig.scoring.collector?.bonusPointsPerBall || 0;
    const lvl = this.storageManager.getUpgradeLevel('collectorMagnet');
    const step = this.gameConfig.upgrades?.collectorMagnet?.pointsBonusPerLevel || 0;
    return base + lvl * step;
  }

  getCollectorOvercharge() {
    const base = this.gameConfig.scoring.collector?.overchargePerBall || 0;
    const lvl = this.storageManager.getUpgradeLevel('collectorMagnet');
    const step = this.gameConfig.upgrades?.collectorMagnet?.overchargeBonusPerLevel || 0;
    return base + lvl * step;
  }

  /**
   * Applies a newly purchased Workshop upgrade to the active run so the player
   * benefits immediately without having to restart the level.
   * @param {string} upgradeKey - Purchased upgrade identifier.
   */
  applyUpgradePurchase(upgradeKey) {
    if (
      upgradeKey === 'startingShots' &&
      this.usesShotBudget() &&
      this.mode !== GAME_MODES.PUZZLE &&
      (this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.PAUSED)
    ) {
      const shotsBonus = this.gameConfig.upgrades?.startingShots?.shotsPerLevel || 0;
      if (shotsBonus > 0) {
        this.shotsRemaining += shotsBonus;
        if (this.shotsRemaining > 0) {
          this.outOfShotsGraceFrames = 0;
        }
        this.saveRunSnapshot({ force: true });
      }
    }
    this.updateAimFromAngle(this.aimAngle);
  }

  /**
   * True when a Workshop purchase can be applied to the active run and stored with its debit.
   * Only the startingShots bonus changes a run; it waits for a capturable run, like special ammo.
   * @param {string} upgradeKey - Upgrade identifier.
   */
  canBuyUpgrade(upgradeKey) {
    const affectsRun =
      upgradeKey === 'startingShots' &&
      this.usesShotBudget() &&
      this.mode !== GAME_MODES.PUZZLE &&
      (this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.PAUSED);
    return !affectsRun || this.canBuySpecialAmmo();
  }

  /** Shield hits a ball starts with for its modifier (0 when it has no armor). */
  getInitialArmor(mod) {
    if (mod === CLUSTER_MODIFIERS.ARMORED) {
      return this.ballsConfig.clusterModifiers.armored.initialArmor;
    }
    if (mod === CLUSTER_MODIFIERS.BOSS_CORE) {
      return this.ballsConfig.clusterModifiers.bossCore.initialArmor;
    }
    return 0;
  }

  /**
   * True for a modifier whose ball never takes part in a color match (rust, neutral
   * anchor): such a ball must carry no color, or it would still count in color checks.
   */
  isColorlessModifier(mod) {
    return mod === CLUSTER_MODIFIERS.RUST || mod === CLUSTER_MODIFIERS.NEUTRAL_ANCHOR;
  }

  createClusterBall(options) {
    const mod = options.clusterModifier || null;
    const initialArmor = this.getInitialArmor(mod);
    const isColorless = Boolean(options.specialType) || this.isColorlessModifier(mod);
    const safeColorId = isColorless
      ? null
      : this.pickSpawnColorForPosition(options.x, options.y, options.colorId);
    return new Ball({
      ...options,
      colorId: safeColorId,
      clusterModifier: mod,
      armorHits: options.armorHits !== undefined ? options.armorHits : initialArmor
    });
  }

  pickSpawnColorForPosition(x, y, preferredColor = null) {
    if (this.activePalette.length === 0) {
      return preferredColor;
    }
    const r = this.physicsConfig.ball.radius;
    const bondRange = r * this.physicsConfig.simulation.bondCreationDistanceFactor;
    const maxSameNeighbors = this.gameConfig.defaults.matchMinCount - 1;

    const existingBalls = this.physicsWorld.balls;
    const directNeighbors = [];
    for (const b of existingBalls) {
      if (Math.hypot(b.x - x, b.y - y) <= bondRange) {
        directNeighbors.push(b);
      }
    }

    if (directNeighbors.length === 0) {
      return preferredColor || this.pickPaletteColor();
    }

    const candidates = [...this.activePalette];
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    const countClusterSizeWithColor = (testColor) => {
      const visited = new Set();
      const queue = [];
      for (const n of directNeighbors) {
        if (n.colorId === testColor && !visited.has(n.id)) {
          visited.add(n.id);
          queue.push(n);
        }
      }
      let head = 0;
      while (head < queue.length) {
        const curr = queue[head++];
        for (const other of existingBalls) {
          if (other.colorId === testColor && !visited.has(other.id)) {
            if (Math.hypot(other.x - curr.x, other.y - curr.y) <= bondRange) {
              visited.add(other.id);
              queue.push(other);
            }
          }
        }
      }
      return visited.size;
    };

    for (const col of candidates) {
      if (countClusterSizeWithColor(col) < maxSameNeighbors) {
        return col;
      }
    }

    return candidates[0];
  }

  equipSpecialBall(specialType) {
    if (this.state !== GAME_STATES.PLAYING || this.physicsWorld.projectile) {
      return;
    }
    if (this.currentBall && this.currentBall.specialType === specialType) {
      this.specialInventory[specialType] = (this.specialInventory[specialType] || 0) + 1;
      this.currentBall = this.createRandomLauncherBall(null, this.stashedRegularColorId);
      this.stashedRegularColorId = null;
      this.audioManager.playEffect('snap');
      this.updateAimFromAngle(this.aimAngle);
      this.saveRunSnapshot({ force: true });
      this.notifyUI();
      return;
    }
    const count = this.specialInventory[specialType] || 0;
    if (count <= 0) {
      return;
    }
    if (this.currentBall && this.currentBall.specialType) {
      const prevType = this.currentBall.specialType;
      this.specialInventory[prevType] = (this.specialInventory[prevType] || 0) + 1;
    } else if (this.currentBall && this.currentBall.colorId) {
      this.stashedRegularColorId = this.currentBall.colorId;
    }
    this.specialInventory[specialType] = count - 1;
    this.currentBall = this.createRandomLauncherBall(specialType);
    this.audioManager.playEffect('snap');
    this.updateAimFromAngle(this.aimAngle);
    this.saveRunSnapshot({ force: true });
    this.notifyUI();
  }

  /**
   * Physics callbacks of the fixed step, built once: creating these closures on every
   * update allocated eight functions per step for the garbage collector.
   */
  getStepCallbacks() {
    if (this.stepCallbacks) {
      return this.stepCallbacks;
    }
    const theme = this.gameConfig.theme;
    const juice = this.gameConfig.juice;
    this.stepCallbacks = {
      onBounce: (x, y) => {
        this.audioManager.playEffect('bounce');
        this.particleSystem.spawnBurst(
          x,
          y,
          theme.bounceParticleColor,
          juice.bounceBurstCount,
          juice.bounceBurstSpeed
        );
        this.crackWallAt(x, y);
      },
      onBallDroppedOut: (ball) => {
        this.particleSystem.splashLiquid(ball.x / this.gameConfig.canvas.logicalWidth, ball.vy);
      },
      onCollectorBinPass: (ball) => {
        if (!this.isRunPlaying()) {
          return;
        }
        const collectorCfg = this.gameConfig.scoring.collector;
        if (!collectorCfg) {
          return;
        }
        const bonusPts = Math.round(this.getCollectorBonusPoints() * Math.max(1, this.combo));
        this.addScore(bonusPts);
        this.addOvercharge(this.getCollectorOvercharge());
        this.particleSystem.spawnFloatingText(
          ball.x,
          this.gameConfig.canvas.logicalHeight - collectorCfg.zoneHeight + this.gameConfig.canvas.floatingTextOffsetY,
          t('gameplay.feedback.collector.bin', { points: bonusPts }),
          this.gameConfig.theme.avalanchePopupColor
        );
      },
      onPortalWarp: (entryPortal, exitPortal) => {
        const portalCfg = this.obstaclesConfig.types.portal;
        this.audioManager.playEffect('portal');
        this.particleSystem.spawnBurst(
          entryPortal.x,
          entryPortal.y,
          portalCfg.ringColor,
          portalCfg.burstCount,
          portalCfg.burstSpeed
        );
        this.particleSystem.spawnBurst(
          exitPortal.x,
          exitPortal.y,
          portalCfg.ringColor,
          portalCfg.burstCount,
          portalCfg.burstSpeed
        );
        this.particleSystem.spawnFloatingText(
          exitPortal.x,
          exitPortal.y + this.gameConfig.canvas.floatingTextOffsetY,
          t('gameplay.feedback.portal.warp'),
          theme.portalPopupColor
        );
      },
      onAnvilCrush: (target) => {
        const anvilSpecs = this.ballsConfig.specialTypes.anvil;
        this.particleSystem.spawnExplosion?.(
          target.x,
          target.y,
          target.radius * anvilSpecs.crushShockwaveFactor,
          anvilSpecs.highlight
        );
        this.particleSystem.spawnFlash?.(
          target.x,
          target.y,
          anvilSpecs.highlight,
          target.radius * anvilSpecs.crushFlashRadiusFactor
        );
        this.particleSystem.spawnShockwave(
          target.x,
          target.y,
          anvilSpecs.highlight,
          target.radius * anvilSpecs.crushShockwaveFactor,
          { lineWidth: anvilSpecs.crushRingLineWidth }
        );
        this.particleSystem.spawnBurst(
          target.x,
          target.y,
          anvilSpecs.highlight,
          anvilSpecs.crushBurstCount,
          anvilSpecs.crushBurstSpeed
        );
        const prevOrigin = this.detonationOrigin;
        this.detonationOrigin = this.physicsWorld.projectile || target;
        const crushed = this.destroyClusterBall(target, anvilSpecs.highlight, true);
        this.detonationOrigin = prevOrigin;
        if (crushed) {
          this.anvilCrushCount++;
          this.addScore(anvilSpecs.pointsPerBall);
          this.addOvercharge(this.gameConfig.scoring.overchargePerMatchedBall);
          this.triggerSpecialSlowMo(anvilSpecs.slowMoFrames, anvilSpecs.slowMoTimeScale, anvilSpecs.highlight);
          this.audioManager.playEffect('snap');
        }
      },
      onAnvilComplete: () => {
        const anvilSpecs = this.ballsConfig.specialTypes.anvil;
        const canvasCfg = this.gameConfig.canvas;
        this.particleSystem.spawnFloatingText(
          canvasCfg.launcherX,
          canvasCfg.launcherY + canvasCfg.anvilPopupOffsetY,
          t('gameplay.feedback.special.anvil'),
          anvilSpecs.highlight
        );
        this.particleSystem.addScreenShake(juice.anvilShake, juice.maxShakeOffset);
        this.hitStopFrames = juice.hitStopFramesSpecial;
        // An anvil that crushed nothing is a miss: it breaks the combo and counts toward the next wave.
        const madeMatch = this.anvilCrushCount > 0;
        if (madeMatch) {
          this.triggerSpecialSlowMo(anvilSpecs.slowMoFrames, anvilSpecs.slowMoTimeScale, anvilSpecs.highlight);
        } else {
          this.combo = 0;
        }
        this.handlePostTurnCleanup(madeMatch);
      },
      onProjectileSnapped: (snappedBall, hitTarget) => {
        this.handleProjectileSnapped(snappedBall, hitTarget);
      },
      onProjectileMissed: () => {
        this.combo = 0;
        this.handlePostTurnCleanup(false);
      },
      onSingularityCapture: (capturedBall, singularityObs) => {
        if (!this.isRunPlaying()) {
          return;
        }
        const singCfg = this.obstaclesConfig.types.singularity;
        const baseDropPts = this.gameConfig.scoring.droppedBallPoints;
        const bonusPts = Math.round(baseDropPts * singularityObs.scoreMultiplier * Math.max(1, this.combo));
        this.addScore(bonusPts);
        this.addOvercharge(singularityObs.bonusOvercharge);
        this.audioManager.playEffect('portal');
        this.particleSystem.spawnBurst(
          singularityObs.x,
          singularityObs.y,
          singCfg.ringColor,
          singCfg.burstCount,
          singCfg.burstSpeed
        );
        this.particleSystem.spawnFloatingText(
          singularityObs.x,
          singularityObs.y + this.gameConfig.canvas.floatingTextOffsetY,
          t('gameplay.feedback.singularity.absorbed', { points: bonusPts }),
          this.gameConfig.theme.singularityPopupColor
        );
        this.notifyUI();
      }
    };
    return this.stepCallbacks;
  }

  shoot() {
    if (this.state !== GAME_STATES.PLAYING || this.physicsWorld.projectile || !this.currentBall) {
      return;
    }
    if (this.isAimCancelled) {
      this.isAimCancelled = false;
      return;
    }
    if (this.isAwaitingPerk() || this.isStageChanging() || (this.usesShotBudget() && this.shotsRemaining <= 0)) {
      return;
    }
    const ballCfg = this.physicsConfig.ball;
    const projectile = this.currentBall;
    this.levelIntro = null;
    this.isHintShownThisTurn = false;
    this.recordDiscoveryInteraction(DISCOVERY_INTERACTIONS.SHOT);
    if (projectile.specialType) {
      this.recordDiscoveryInteraction(DISCOVERY_INTERACTIONS.USE, projectile.specialType);
    }
    projectile.isProjectile = true;
    projectile.isPolarityFlipped = this.isPolarityFlipped;
    projectile.x = this.gameConfig.canvas.launcherX;
    projectile.y = this.gameConfig.canvas.launcherY;
    projectile.savePreviousPosition();

    const speed = projectile.specialType === SPECIAL_TYPES.ANVIL
      ? ballCfg.anvilSpeed
      : ballCfg.projectileSpeed;

    projectile.vx = Math.cos(this.aimAngle) * speed;
    projectile.vy = Math.sin(this.aimAngle) * speed;

    this.physicsWorld.projectile = projectile;
    this.anvilCrushCount = 0;
    this.stashedRegularColorId = null;
    this.currentBall = this.nextBall;
    const upcoming = this.takeUpcomingBall();
    this.nextBall = this.createRandomLauncherBall(upcoming.specialType, upcoming.colorId);

    if (this.usesShotBudget()) {
      this.shotsRemaining = Math.max(0, this.shotsRemaining - 1);
    }

    this.blitzIdleFrames = 0;
    this.hasFiredInRound = true;
    this.physicsWorld.allowTensionBreak = true;
    this.audioManager.playEffect('shoot');
    this.updateAimFromAngle(this.aimAngle);
    this.notifyUI();
  }

  update() {
    if (this.isVictoryCelebrating()) {
      this.updateVictoryCelebration();
      return;
    }
    if (this.state !== GAME_STATES.PLAYING) {
      return;
    }
    if (this.isAwaitingPerk()) {
      this.particleSystem.update(this.gameConfig.juice.shakeDecay);
      return;
    }
    if (this.stageTransitionFrames > 0) {
      this.updateStageTransition();
      return;
    }
    if (this.stageIntroFrames > 0) {
      this.stageIntroFrames--;
    }

    const theme = this.gameConfig.theme;
    const juice = this.gameConfig.juice;

    this.updateImpactWave();

    if (this.hitStopFrames > 0) {
      this.hitStopFrames--;
      this.particleSystem.updateShakeOnly(juice.shakeDecay);
      return;
    }

    if (this.specialSlowMoFrames > 0) {
      // Slow animation speeds must not stretch the slow motion in real time (free aiming
      // time in Blitz): the countdown never runs slower than one frame per step.
      this.specialSlowMoFrames = Math.max(0, this.specialSlowMoFrames - Math.max(1, this.animationSpeed));
      if (this.specialSlowMoFrames <= 0) {
        this.specialSlowMoTotalFrames = 0;
        this.specialSlowMoMinScale = 1.0;
        this.specialSlowMoColor = null;
      }
    }

    if (this.physicsWorld.projectile) {
      this.trackDiscoveryProximity(this.physicsWorld.projectile);
      this.trailFrameCounter++;
      if (this.trailFrameCounter >= juice.trailSpawnInterval) {
        this.trailFrameCounter = 0;
        const p = this.physicsWorld.projectile;
        const palette = p.specialType
          ? this.ballsConfig.specialTypes[p.specialType]
          : this.ballsConfig.standardColors.find((c) => c.id === p.colorId);
        this.particleSystem.spawnTrail(
          p.x,
          p.y,
          p.radius,
          palette ? palette.highlight : theme.defaultTrailColor
        );
      }
    }

    // Step callbacks must not tear the world down mid-step: a round end they trigger
    // (an overcharge strike on the boss) is deferred until the step has returned.
    this.isSteppingPhysics = true;
    try {
      this.physicsWorld.step(this.getStepCallbacks());
    } finally {
      this.isSteppingPhysics = false;
    }
    if (this.pendingRoundEnd || (this.pendingBossRushWave && !this.physicsWorld.projectile)) {
      this.evaluateRoundEnd();
    }

    if (this.physicsWorld.hasBrokenBondThisStep) {
      this.physicsWorld.hasBrokenBondThisStep = false;
      this.detachAndRewardAvalanche();
      this.discardBetweenTurnsCoreFreeze();
      // A board cleared by a bond break must not end the round with the shot frozen
      // mid-air: the post-turn cleanup of that shot comes back to evaluateRoundEnd.
      const isShotHoldingRoundEnd = Boolean(this.physicsWorld.projectile) && this.isClearBasedMode();
      if (!isShotHoldingRoundEnd) {
        this.evaluateRoundEnd();
      }
      this.saveRunSnapshot();
      this.notifyUI();
    }

    // Falling balls still pay score and overcharge until they land: store the run once
    // the last one is gone, so a reload cannot lose those rewards.
    const hasDroppingBalls = this.physicsWorld.droppingBalls.length > 0;
    if (this.hadDroppingBalls && !hasDroppingBalls) {
      this.saveRunSnapshot();
    }
    this.hadDroppingBalls = hasDroppingBalls;

    if (!this.isRunPlaying()) {
      this.particleSystem.update(juice.shakeDecay);
      return;
    }

    if (!this.physicsWorld.projectile) {
      // The board moved, but the preview is only drawn once per frame: the game loop
      // recomputes it through refreshAimPreview instead of once per fixed step.
      this.isAimPreviewStale = true;
      if (!this.hasFiredInRound) {
        this.physicsWorld.pendingChainCandidateIds.clear();
      } else {
        this.chainCooldown++;
        if (this.chainCooldown >= this.physicsConfig.simulation.chainCheckCooldownFrames) {
          this.chainCooldown = 0;
          this.evaluateAutomaticChainReactions();
          this.discardBetweenTurnsCoreFreeze();
        }
      }

      if (this.outOfShotsGraceFrames > 0) {
        this.outOfShotsGraceFrames--;
        if (this.isObjectiveCleared()) {
          this.outOfShotsGraceFrames = 0;
          this.evaluateRoundEnd();
        } else if (this.outOfShotsGraceFrames === 0) {
          this.triggerGameOver(GAME_OVER_REASONS.OUT_OF_SHOTS);
        }
      }
    }

    if (this.mode === GAME_MODES.BLITZ && this.isRunPlaying()) {
      const blitzCfg = this.gameConfig.blitz;
      this.blitzFramesRemaining = Math.max(0, this.blitzFramesRemaining - 1);
      if (this.blitzFramesRemaining <= 0) {
        this.particleSystem.update(juice.shakeDecay);
        this.triggerGameOver(GAME_OVER_REASONS.TIME_UP);
        return;
      }
      if (this.blitzFramesRemaining % blitzCfg.framesPerSecond === 0) {
        this.notifyUI();
      }
      this.blitzWaveTimerFrames--;
      if (this.blitzWaveTimerFrames <= 0 || this.physicsWorld.balls.length < blitzCfg.minSpheresBeforeWave) {
        this.blitzWaveTimerFrames = blitzCfg.waveIntervalFrames;
        this.spawnEndlessWave();
        this.refreshStaleLauncherColors();
        this.saveRunSnapshot();
        this.notifyUI();
      }
      if (!this.physicsWorld.projectile && this.physicsWorld.droppingBalls.length === 0) {
        this.blitzIdleFrames++;
        if (this.blitzIdleFrames >= blitzCfg.autoFireFrames) {
          this.blitzIdleFrames = 0;
          const canvasCfg = this.gameConfig.canvas;
          this.particleSystem.spawnFloatingText(
            canvasCfg.launcherX,
            canvasCfg.launcherY + canvasCfg.launcherPopupOffsetY,
            t('gameplay.feedback.blitz.autoFire'),
            theme.wavePopupColor
          );
          this.shoot();
        }
      }
    }

    this.particleSystem.update(juice.shakeDecay);
    this.checkDangerLineBreach();
  }

  /**
   * Advances the post-victory scene only: falling balls and particles. Nothing is scored
   * because the run has ended; the victory modal is revealed when the countdown expires.
   */
  updateVictoryCelebration() {
    this.physicsWorld.stepDroppingBalls(this.getStepCallbacks());
    this.particleSystem.update(this.gameConfig.juice.shakeDecay);
    this.victoryCelebrationFrames--;
    if (this.victoryCelebrationFrames === 0) {
      this.notifyUI(this.victorySummary);
    }
  }

  /**
   * Adds mutator-scaled points to the running score. A no-op once the run has ended.
   * High scores are only persisted when the run ends or is left (see persistRunHighScore);
   * the HUD shows the larger of the stored best and the live score.
   */
  addScore(points) {
    if (!this.isRunPlaying()) {
      return;
    }
    let mult = 1.0;
    if (this.activeMutatorKey && this.gameConfig.daily?.mutators?.[this.activeMutatorKey]?.scoreMultiplier) {
      mult = this.gameConfig.daily.mutators[this.activeMutatorKey].scoreMultiplier;
    }
    this.score += Math.round(points * mult);
  }

  togglePause() {
    if (this.state === GAME_STATES.PLAYING) {
      this.state = GAME_STATES.PAUSED;
      this.notifyUI();
    } else if (this.state === GAME_STATES.PAUSED) {
      this.state = GAME_STATES.PLAYING;
      this.notifyUI();
    }
  }

  restartCurrent() {
    if (this.mode === GAME_MODES.CAMPAIGN) {
      this.startCampaignLevel(this.currentLevelId);
    } else if (this.mode === GAME_MODES.DAILY) {
      this.startDailyChallenge(this.dailySeedKey, true);
    } else if (this.mode === GAME_MODES.FLUX) {
      this.startFluxRun();
    } else if (this.mode === GAME_MODES.PUZZLE) {
      this.startPuzzleMode(this.currentPuzzleStage);
    } else if (this.mode === GAME_MODES.BLITZ) {
      this.startBlitzMode();
    } else if (this.mode === GAME_MODES.BOSS_RUSH) {
      this.startBossRushMode(1);
    } else if (this.mode === GAME_MODES.CASCADE) {
      this.startCascadeMode();
    } else {
      this.startEndlessMode();
    }
  }

  notifyUI(extra = {}) {
    if (this.onStateChange) {
      this.onStateChange(this, extra);
    }
  }
}

installMethods(GameEngine, engineModeMethods);
installMethods(GameEngine, engineBoardMethods);
installMethods(GameEngine, engineLauncherMethods);
installMethods(GameEngine, engineDiscoveryMethods);
installMethods(GameEngine, engineControlsMethods);
installMethods(GameEngine, engineTurnResolutionMethods);
installMethods(GameEngine, engineRoundFlowMethods);
