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
import { getRegisteredModeBehavior, resolveModesConfig } from './modes/index.js';

const ACHIEVEMENT_TIER_ORDER = Object.freeze(['bronze', 'silver', 'gold']);
const MS_PER_SECOND = 1000;
const FALLBACK_FIXED_STEP_MS = 16.6667;

import { installMethods } from '../core/installMethods.js';
import { engineModeMethods, FLUX_PERK_IDS } from './EngineModes.js';
import { engineBoardMethods } from './EngineBoard.js';
import { engineLauncherMethods } from './EngineLauncher.js';
import { engineDiscoveryMethods } from './EngineDiscovery.js';
import { engineControlsMethods } from './EngineControls.js';
import { engineVersusMethods } from './EngineVersus.js';
import { engineMagnetarMethods } from './EngineMagnetar.js';
import { engineTurnResolutionMethods, getOccupiedPlatformIndices } from './EngineTurnResolution.js';
import { engineRoundFlowMethods } from './EngineRoundFlow.js';
import { engineProgressMethods } from './EngineProgress.js';
import { engineGhostDuelMethods } from './EngineGhostDuel.js';
import { enginePulseMethods } from './EnginePulse.js';

/** What a run is measured by when it is compared with the mode's record. */
export const RUN_BEST_METRICS = Object.freeze({
  STAGE: 'stage',
  WAVE: 'wave',
  SCORE: 'score'
});

export { FLUX_PERK_IDS };

/**
 * What an engine is for. A main engine is the player's own game: it reads and writes the
 * profile. A versus engine plays one board of a duel: it keeps no hints, shot timeline, ghost
 * or statistics, so a duel never touches the player's profile.
 */
export const ENGINE_ROLES = Object.freeze({
  MAIN: 'main',
  VERSUS: 'versus'
});

const RUN_BEST_READERS = new Map([
  [GAME_MODES.CLASSIC, (storage) => storage.getClassicBestStage?.()],
  [GAME_MODES.BOSS_RUSH, (storage) => storage.getBossRushBestWave?.()],
  [GAME_MODES.ENDLESS, (storage) => storage.getEndlessHighScore?.()],
  [GAME_MODES.DAILY, (storage, engine) => storage.getDailyHighScore?.(engine.dailySeedKey || SeededRandom.getTodayDateKey())],
  [GAME_MODES.CASCADE, (storage) => storage.getCascadeHighScore?.()],
  [GAME_MODES.BLITZ, (storage) => storage.getBlitzHighScore?.()],
  [GAME_MODES.HEX_GRID, (storage) => storage.getHexGridBestWave?.()],
  [GAME_MODES.ORBITAL, (storage) => storage.getOrbitalBestWave?.()],
  [GAME_MODES.PINBALL, (storage) => storage.getPinballBestStage?.()],
  [GAME_MODES.CONVOY, (storage) => storage.getConvoyBestWave?.()],
  [GAME_MODES.MERGE, (storage) => storage.getMergeHighScore?.()],
  [GAME_MODES.SLINGSHOT, (storage) => storage.getSlingshotBestStage?.()]
]);

const PERSIST_HIGH_SCORE_HANDLERS = new Map([
  [GAME_MODES.ENDLESS, (engine) => engine.storageManager.setEndlessHighScore(engine.score)],
  [GAME_MODES.DAILY, (engine) => persistDailyRunHighScore(engine)],
  [GAME_MODES.FLUX, (engine) => persistFluxRunHighScore(engine)],
  [GAME_MODES.CLASSIC, (engine) => engine.storageManager.setClassicRecord?.(engine.score, engine.classicStage)],
  [GAME_MODES.BLITZ, (engine) => engine.storageManager.setBlitzHighScore?.(engine.score)],
  [GAME_MODES.BOSS_RUSH, (engine) => engine.storageManager.setBossRushRecord?.(engine.score, engine.bossRushWave)],
  [GAME_MODES.CASCADE, (engine) => engine.storageManager.setCascadeHighScore?.(engine.score)],
  [GAME_MODES.PUZZLE, (engine) => persistPuzzleRunHighScore(engine)],
  [GAME_MODES.HEX_GRID, (engine) => persistWaveRecordAndTier(engine, 'setHexGridRecord', 'hexGridWaves')],
  [GAME_MODES.ORBITAL, (engine) => persistWaveRecordAndTier(engine, 'setOrbitalRecord', 'orbitalWaves')],
  [GAME_MODES.PINBALL, (engine) => persistStageRecordAndTier(engine, 'setPinballRecord', 'pinballStages', engine.pinballStage)],
  [GAME_MODES.CONVOY, (engine) => persistWaveRecordAndTier(engine, 'setConvoyRecord', 'convoyWaves')],
  [GAME_MODES.MERGE, (engine) => persistMergeRunHighScore(engine)],
  [GAME_MODES.SLINGSHOT, (engine) => persistStageRecordAndTier(engine, 'setSlingshotRecord', 'slingshotStages', engine.slingshotStage)]
]);

const RESTART_MODE_HANDLERS = new Map([
  [GAME_MODES.CAMPAIGN, (engine) => engine.startCampaignLevel(engine.currentLevelId)],
  [GAME_MODES.DAILY, (engine) => engine.startDailyChallenge(engine.dailySeedKey, true, { isRematch: engine.isDailyRematch })],
  [GAME_MODES.PUZZLE, (engine) => engine.startPuzzleMode(
    engine.currentPuzzleStage,
    engine.isCustomPuzzle && engine.customPuzzleSpec ? { customSpec: engine.customPuzzleSpec } : null
  )],
  [GAME_MODES.BLITZ, (engine) => engine.startBlitzMode()],
  [GAME_MODES.BOSS_RUSH, (engine) => engine.startBossRushMode(1)],
  [GAME_MODES.CASCADE, (engine) => engine.startCascadeMode()],
  [GAME_MODES.CLASSIC, (engine) => engine.startClassicMode(1)],
  [GAME_MODES.HEX_GRID, (engine) => engine.startHexGridMode()],
  [GAME_MODES.ORBITAL, (engine) => engine.startOrbitalMode()],
  [GAME_MODES.PINBALL, (engine) => engine.startPinballMode(1)],
  [GAME_MODES.CONVOY, (engine) => engine.startConvoyMode()],
  [GAME_MODES.MERGE, (engine) => engine.startMergeMode()],
  [GAME_MODES.SLINGSHOT, (engine) => engine.startSlingshotMode(1)]
]);

function persistDailyRunHighScore(engine) {
  // A rematch of a past Daily writes no daily high score, streak or history.
  if (engine.isDailyRematch) {
    return;
  }
  engine.storageManager.setDailyHighScore(engine.score, engine.dailySeedKey);
  if (engine.hasFiredInRound || engine.runShotsFired > 0) {
    engine.storageManager.recordDailyResult?.({
      dateKey: engine.dailySeedKey,
      score: engine.score,
      wave: engine.waveCount,
      mutatorKey: engine.activeMutatorKey,
      tl: engine.shotTimeline
    });
  }
}

function persistFluxRunHighScore(engine) {
  // Do not stamp stage 1 as a personal Flux record (which unlocks Flux) when leaving before playing.
  if (engine.hasFiredInRound || engine.runShotsFired > 0 || engine.score > 0 || engine.fluxStage > 1) {
    engine.storageManager.setFluxRecord(engine.score, engine.fluxStage);
  }
  if (engine.isWeeklyFluxRun && engine.weeklyWeekKey && (engine.hasFiredInRound || engine.runShotsFired > 0)) {
    engine.storageManager.setWeeklyFluxBest?.(
      engine.weeklyWeekKey,
      engine.fluxSeed,
      engine.score,
      engine.fluxStage,
      engine.shotTimeline
    );
  }
}

function persistPuzzleRunHighScore(engine) {
  if (engine.isCustomPuzzle) {
    return;
  }
  const puzzles = engine.gameConfig.puzzles;
  const totalPuzzles = puzzles ? puzzles.length || 1 : 1;
  const reachedStage = engine.state === GAME_STATES.VICTORY && engine.currentPuzzleStage < totalPuzzles
    ? engine.currentPuzzleStage + 1
    : engine.currentPuzzleStage;
  engine.storageManager.setPuzzleRecord?.(engine.score, reachedStage);
}

function persistWaveRecordAndTier(engine, method, achievementFamily) {
  engine.storageManager[method]?.(engine.score, engine.waveCount);
  engine.unlockAchievementTiers(achievementFamily, engine.waveCount);
}

function persistStageRecordAndTier(engine, method, achievementFamily, stageValue) {
  engine.storageManager[method]?.(engine.score, stageValue);
  engine.unlockAchievementTiers(achievementFamily, stageValue);
}

function persistMergeRunHighScore(engine) {
  engine.storageManager.setMergeRecord?.(engine.score, engine.mergeBestTier);
  const storedBest = engine.storageManager.getMergeBestTier ? engine.storageManager.getMergeBestTier() : 0;
  engine.unlockAchievementTiers('mergeTiers', Math.max(engine.mergeBestTier, storedBest || 0));
}

function initEngineDependencies(engine, options) {
  const {
    gameConfig, physicsConfig, ballsConfig, obstaclesConfig, levelsConfig, campaignConfig,
    campaignTuning = null, fluxShapeTuning = null, fluxConfig, modesConfig = null,
    audioManager, storageManager, onStateChange, role = ENGINE_ROLES.MAIN, seedSource = null
  } = options;
  engine.gameConfig = gameConfig;
  engine.physicsConfig = physicsConfig;
  engine.ballsConfig = ballsConfig;
  engine.obstaclesConfig = obstaclesConfig;
  engine.levelsConfig = levelsConfig;
  engine.fluxConfig = fluxConfig;
  engine.modesConfig = resolveModesConfig(modesConfig);
  /** Idle settle margins of the generated Flux shapes (configs/fluxShapeTuning.json); null draws every shape. */
  engine.fluxShapeTuning = fluxShapeTuning;
  engine.levelCatalog = new LevelCatalog({
    levelsConfig, campaignConfig, campaignTuning, fluxConfig, obstaclesConfig,
    ballRadius: physicsConfig.ball.radius
  });
  engine.audioManager = audioManager;
  engine.storageManager = storageManager;
  engine.onStateChange = onStateChange;
  engine.role = role === ENGINE_ROLES.VERSUS ? ENGINE_ROLES.VERSUS : ENGINE_ROLES.MAIN;
  /** True when this engine plays a board of a duel (no hints, timeline, ghost or stats). */
  engine.isVersusRole = engine.role === ENGINE_ROLES.VERSUS;
  /** Optional () => number in [0, 1) feeding the unseeded run streams; Math.random when null. */
  engine.seedSource = typeof seedSource === 'function' ? seedSource : null;
  /** Versus state of a duel board (charges, attack counters); null outside a duel. */
  engine.versus = null;
  /** Magnetar boss state (Boss Rush, Flux boss stages); null elsewhere (see EngineMagnetar.js). */
  engine.magnetar = null;
  engine.physicsWorld = new PhysicsWorld(physicsConfig, gameConfig, ballsConfig, engine.modesConfig);
  // Daily runs draw avalanche drift from the seeded stream so scores stay reproducible
  engine.physicsWorld.setRandomSource(() => engine.random());
  engine.particleSystem = new ParticleSystem(gameConfig.juice);
  engine.isReducedMotion = false;
  engine.animationSpeed = gameConfig.defaults?.animationSpeed ?? 1;
  if (storageManager && typeof storageManager.getReducedMotion === 'function') {
    engine.setReducedMotion(storageManager.getReducedMotion());
  }
  if (storageManager && typeof storageManager.getAnimationSpeed === 'function') {
    engine.setAnimationSpeed(storageManager.getAnimationSpeed());
  }
  engine.specialController = new SpecialBallController(ballsConfig, gameConfig);
}

function resetRunCounterFields(engine) {
  engine.score = 0;
  engine.combo = 0;
  engine.maxComboInRound = 0;
  engine.runCoinsEarned = 0;
  engine.overcharge = 0;
  engine.sagLevel = 0;
  engine.railDrops = 0;
  engine.classicRailDropsTotal = 0;
  engine.railLowerFrames = 0;
  engine.classicStage = 0;
  engine.freezeTurnsRemaining = 0;
  engine.chainCooldown = 0;
  engine.pendingRunCoins = 0;
  // A Boss Rush wave clear waiting for the shot in flight to land.
  engine.pendingBossRushWave = false;
  // True for a Flux run started from a shared seed link.
  engine.isSharedFluxRun = false;
  engine.runOutcomeRecorded = false;
  engine.lastRunOutcome = null;
  engine.runShotsFired = 0;
  // Weekly Flux: set when the run's seed is the seed of the week it was started in.
  engine.isWeeklyFluxRun = false;
  engine.weeklyWeekKey = null;
  // Outcomes of the shots of a Daily or weekly Flux run (see ShotTimeline.js).
  engine.shotTimeline = null;
  // Ghost Duel: the rival run being raced (see EngineGhostDuel.js) and the replay of a past Daily.
  engine.ghostDuel = null;
  engine.isDailyRematch = false;
  engine.beatFrame = 0;
  engine.turnResonant = false;
  engine.turnOverchargeEarned = 0;
  engine.resonanceFlashFrames = 0;
  engine.botResonanceRoll = null;
  engine.anvilCrushCount = 0;
  engine.isCoreFreezeApplied = false;
  engine.outOfShotsGraceFrames = 0;
  engine.victoryCelebrationFrames = 0;
  engine.victorySummary = null;
  engine.gameOverSummary = null;
  engine.runBestBaseline = null;
}

function resetRoundTransientFields(engine) {
  engine.hitStopFrames = 0;
  engine.specialSlowMoFrames = 0;
  engine.specialSlowMoTotalFrames = 0;
  engine.specialSlowMoMinScale = 1.0;
  engine.specialSlowMoColor = null;
  engine.isSteppingPhysics = false;
  engine.pendingRoundEnd = false;
  engine.hadDroppingBalls = false;
  engine.detonationOrigin = null;
  engine.impactWave = null;
  engine.hasFiredInRound = false;
  engine.hasUsedContinue = false;
  engine.bossesDestroyedInRun = 0;
  engine.activeDiscoveryId = null;
  engine.discoveryTurnCount = 0;
  engine.discoveryShownIds = new Set();
  engine.isActiveHintLearned = false;
  engine.isHintShownThisTurn = false;
  engine.hintReplayQueue = [];
  engine.isReplayingHints = false;
  engine.levelIntro = null;
  engine.levelTutorialKey = null;
  engine.isAimCancelled = false;
  engine.isAimLocked = false;
  engine.aimLockOrigin = null;
  engine.isPolarityFlipped = false;
  engine.activeMutatorKey = null;
  engine.dailySeedKey = null;
  engine.seededRng = null;
  engine.scopedRng = null;
  engine.launcherDrawIndex = 0;
  engine.specialGrantIndex = 0;
  engine.specialAmmoBoughtInRun = 0;
}

function resetModeProgressionFields(engine) {
  engine.fluxSeed = null;
  engine.fluxContentVersion = engine.gameConfig.ghostDuel.contentVersion.flux;
  engine.fluxStage = 0;
  engine.fluxFamily = null;
  engine.fluxPreviousFamily = null;
  engine.fluxShapeIds = [];
  engine.fluxIsBossStage = false;
  engine.fluxPerks = {};
  engine.fluxPerkOffer = null;
  engine.stageTransitionFrames = 0;
  engine.stageIntroFrames = 0;
  engine.currentObjective = OBJECTIVE_TYPES.CLEAR_ALL;
  engine.targetCoreCount = 0;
  engine.rescuedCores = 0;
  engine.currentPuzzleStage = 1;
  engine.puzzleQueue = [];
  engine.blitzFramesRemaining = 0;
  engine.blitzWaveTimerFrames = 0;
  engine.blitzIdleFrames = 0;
  engine.blitzBonusFramesEarned = 0;
  engine.blitzHitStreak = 0;
  engine.bossRushWave = 1;
  engine.cascadeWave = 1;
  engine.cascadeTurnsUntilDrop = 0;
  engine.cascadeOccupiedPlatforms = new Set();
  engine.modeState = null;
  engine.pinballStage = 1;
  engine.slingshotStage = 1;
  engine.mergeDropX = engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF;
  engine.mergeBestTier = 1;
}

function initSessionFields(engine, gameConfig) {
  engine.mode = GAME_MODES.CAMPAIGN;
  engine.state = GAME_STATES.READY;
  engine.currentLevelId = 1;
  engine.shotsRemaining = 0;
  engine.waveCount = 1;
  engine.waveLog = [];
  engine.endlessRowParity = 0;
  engine.pendingShots = 0;
  engine.pendingPlayMs = 0;
  const stats = engine.storageManager?.getPlayerStats?.();
  const storedMilestones = stats ? stats.m : null;
  engine.avalancheMilestoneStamped = Boolean(
    storedMilestones && (storedMilestones.avalanche !== undefined || storedMilestones.legacy === true)
  );
  engine.versusResonanceOption = undefined;
  engine.isBotResonanceBoard = false;
  engine.trailFrameCounter = 0;
  /** Mechanics sharing the hint on screen, kept while that hint stays (read every flight step). */
  engine.proximityGroupHintId = null;
  engine.proximityGroup = null;
  // Levels whose banner already showed in this session, so a retry after a defeat is quiet.
  engine.introducedLevelIds = new Set();
  engine.introducedDailySeeds = new Set();
  engine.introducedModes = new Set();
  engine.modeIntroReplaySeq = 0;
  engine.activePalette = [];
  engine.specialInventory = {};
  engine.currentBall = null;
  engine.stashedRegularColorId = null;
  engine.nextBall = null;
  engine.aimAngle = -Math.PI * MATH_CONSTANTS.HALF;
  engine.aimPoints = [];
  // Colors of the balls queued after nextBall, shown beside the launcher.
  engine.upcomingColorIds = [];
  engine.levelStartBallCount = 0;
  engine.isAimPreviewStale = false;
  engine.laserBonuses = { distanceBonus: 0, bouncesBonus: 0 };
  engine.stepCallbacks = null;
  engine.isRestoringRun = false;
  void gameConfig;
}

function handleCollectorBinPass(engine, ball) {
  if (!engine.isRunPlaying() || engine.getModeBehavior().getRenderChrome(engine).collectorBins === false) {
    return;
  }
  const collectorCfg = engine.gameConfig.scoring.collector;
  if (!collectorCfg) {
    return;
  }
  const bonusPts = Math.round(engine.getCollectorBonusPoints() * Math.max(1, engine.combo));
  engine.addScore(bonusPts);
  engine.addOvercharge(engine.getCollectorOvercharge());
  engine.particleSystem.spawnFloatingText(
    ball.x,
    engine.gameConfig.canvas.logicalHeight - collectorCfg.zoneHeight + engine.gameConfig.canvas.floatingTextOffsetY,
    t('gameplay.feedback.collector.bin', { points: bonusPts }),
    engine.gameConfig.theme.avalanchePopupColor
  );
}

function handlePortalWarp(engine, entryPortal, exitPortal) {
  const portalCfg = engine.obstaclesConfig.types.portal;
  engine.audioManager.playEffect('portal');
  for (const portal of [entryPortal, exitPortal]) {
    engine.particleSystem.spawnBurst(portal.x, portal.y, portalCfg.ringColor, portalCfg.burstCount, portalCfg.burstSpeed);
  }
  engine.particleSystem.spawnFloatingText(
    exitPortal.x,
    exitPortal.y + engine.gameConfig.canvas.floatingTextOffsetY,
    t('gameplay.feedback.portal.warp'),
    engine.gameConfig.theme.portalPopupColor
  );
}

function handleAnvilCrush(engine, target) {
  const anvilSpecs = engine.ballsConfig.specialTypes.anvil;
  const { particleSystem } = engine;
  particleSystem.spawnExplosion?.(target.x, target.y, target.radius * anvilSpecs.crushShockwaveFactor, anvilSpecs.highlight);
  particleSystem.spawnFlash?.(target.x, target.y, anvilSpecs.highlight, target.radius * anvilSpecs.crushFlashRadiusFactor);
  particleSystem.spawnShockwave(
    target.x,
    target.y,
    anvilSpecs.highlight,
    target.radius * anvilSpecs.crushShockwaveFactor,
    { lineWidth: anvilSpecs.crushRingLineWidth }
  );
  particleSystem.spawnBurst(target.x, target.y, anvilSpecs.highlight, anvilSpecs.crushBurstCount, anvilSpecs.crushBurstSpeed);
  const prevOrigin = engine.detonationOrigin;
  engine.detonationOrigin = engine.physicsWorld.projectile || target;
  const crushed = engine.destroyClusterBall(target, anvilSpecs.highlight, true);
  engine.detonationOrigin = prevOrigin;
  if (crushed) {
    engine.anvilCrushCount++;
    engine.addScore(anvilSpecs.pointsPerBall);
    engine.addOvercharge(engine.gameConfig.scoring.overchargePerMatchedBall);
    engine.triggerSpecialSlowMo(anvilSpecs.slowMoFrames, anvilSpecs.slowMoTimeScale, anvilSpecs.highlight);
    engine.audioManager.playEffect('snap');
  }
}

function handleAnvilComplete(engine) {
  const anvilSpecs = engine.ballsConfig.specialTypes.anvil;
  const juice = engine.gameConfig.juice;
  const launcherSpec = engine.getLauncherSpec();
  engine.particleSystem.spawnFloatingText(
    launcherSpec.x,
    launcherSpec.y + engine.gameConfig.canvas.anvilPopupOffsetY,
    t('gameplay.feedback.special.anvil'),
    anvilSpecs.highlight
  );
  engine.particleSystem.addScreenShake(juice.anvilShake, juice.maxShakeOffset);
  // A versus board never freezes: both boards must keep stepping in lockstep.
  engine.hitStopFrames = engine.isVersusRole ? 0 : juice.hitStopFramesSpecial;
  // An anvil that crushed nothing is a miss: it breaks the combo and counts toward the next wave.
  const madeMatch = engine.anvilCrushCount > 0;
  if (madeMatch) {
    engine.triggerSpecialSlowMo(anvilSpecs.slowMoFrames, anvilSpecs.slowMoTimeScale, anvilSpecs.highlight);
  } else {
    engine.combo = 0;
  }
  const behavior = engine.getModeBehavior();
  if (typeof behavior.onAnvilSettled === 'function') {
    behavior.onAnvilSettled(engine, madeMatch);
  } else {
    engine.handlePostTurnCleanup(madeMatch);
  }
}

function handleSingularityCapture(engine, capturedBall, singularityObs) {
  if (!engine.isRunPlaying()) {
    return;
  }
  const singCfg = engine.obstaclesConfig.types.singularity;
  const baseDropPts = engine.gameConfig.scoring.droppedBallPoints;
  const bonusPts = Math.round(baseDropPts * singularityObs.scoreMultiplier * Math.max(1, engine.combo));
  engine.addScore(bonusPts);
  engine.addOvercharge(singularityObs.bonusOvercharge);
  engine.audioManager.playEffect('portal');
  engine.particleSystem.spawnBurst(
    singularityObs.x,
    singularityObs.y,
    singCfg.ringColor,
    singCfg.burstCount,
    singCfg.burstSpeed
  );
  engine.particleSystem.spawnFloatingText(
    singularityObs.x,
    singularityObs.y + engine.gameConfig.canvas.floatingTextOffsetY,
    t('gameplay.feedback.singularity.absorbed', { points: bonusPts }),
    engine.gameConfig.theme.singularityPopupColor
  );
  engine.notifyUI();
  void capturedBall;
}

function launchPreparedProjectile(engine) {
  const ballCfg = engine.physicsConfig.ball;
  const launcherSpec = engine.getLauncherSpec();
  const projectile = engine.currentBall;
  engine.levelIntro = null;
  engine.isHintShownThisTurn = false;
  engine.recordDiscoveryInteraction(DISCOVERY_INTERACTIONS.SHOT);
  if (projectile.specialType) {
    engine.recordDiscoveryInteraction(DISCOVERY_INTERACTIONS.USE, projectile.specialType);
  }
  projectile.isProjectile = true;
  projectile.isPolarityFlipped = engine.isPolarityFlipped;
  engine.markResonantShot(projectile);
  projectile.x = launcherSpec.x;
  projectile.y = launcherSpec.y;
  projectile.savePreviousPosition();
  const baseSpeed = engine.physicsWorld.projectileLaunchSpeedOverride > 0
    ? engine.physicsWorld.projectileLaunchSpeedOverride
    : ballCfg.projectileSpeed;
  const speed = projectile.specialType === SPECIAL_TYPES.ANVIL ? ballCfg.anvilSpeed : baseSpeed;
  projectile.vx = Math.cos(engine.aimAngle) * speed;
  projectile.vy = Math.sin(engine.aimAngle) * speed;
  engine.physicsWorld.projectile = projectile;
  engine.anvilCrushCount = 0;
  engine.stashedRegularColorId = null;
  engine.currentBall = engine.nextBall;
  const upcoming = engine.takeUpcomingBall();
  engine.nextBall = engine.createRandomLauncherBall(upcoming.specialType, upcoming.colorId);
}

function finalizeFiredProjectile(engine) {
  if (engine.usesShotBudget()) {
    engine.shotsRemaining = Math.max(0, engine.shotsRemaining - 1);
  }
  engine.blitzIdleFrames = 0;
  if (engine.mode === GAME_MODES.PUZZLE && !engine.hasFiredInRound && !engine.isCustomPuzzle) {
    // An attempt is the first shot of a round; a restored round already carries the flag.
    engine.storageManager.recordPuzzleAttempt?.(engine.currentPuzzleStage);
  }
  engine.hasFiredInRound = true;
  engine.physicsWorld.allowTensionBreak = true;
  engine.audioManager.playEffect('shoot');
  engine.updateAimFromAngle(engine.aimAngle);
  engine.notifyUI();
}

function advanceFrameTimers(engine) {
  const isFirstPlayedFrame = engine.beatFrame === 0;
  engine.beatFrame += engine.getBeatAdvance();
  if (isFirstPlayedFrame) {
    engine.announceResonanceDisabled();
  }
  if (engine.resonanceFlashFrames > 0) {
    engine.resonanceFlashFrames--;
  }
  const simCfg = engine.physicsConfig.simulation;
  engine.countPlayTimeForStats(simCfg ? simCfg.fixedStepMs || 0 : 0);
  if (engine.railLowerFrames > 0) {
    engine.railLowerFrames--;
  }
}

function updateSlowMoAndProjectileTrail(engine, juice, theme) {
  if (engine.specialSlowMoFrames > 0) {
    // Countdown never runs slower than one frame per step (free aiming time in Blitz).
    engine.specialSlowMoFrames = Math.max(0, engine.specialSlowMoFrames - Math.max(1, engine.animationSpeed));
    if (engine.specialSlowMoFrames <= 0) {
      engine.specialSlowMoTotalFrames = 0;
      engine.specialSlowMoMinScale = 1.0;
      engine.specialSlowMoColor = null;
    }
  }
  const p = engine.physicsWorld.projectile;
  if (!p) {
    return;
  }
  engine.trackDiscoveryProximity(p);
  engine.trailFrameCounter++;
  if (engine.trailFrameCounter < juice.trailSpawnInterval) {
    return;
  }
  engine.trailFrameCounter = 0;
  const palette = p.specialType
    ? engine.ballsConfig.specialTypes[p.specialType]
    : (
      engine.ballsConfig.standardColors.find((c) => c.id === p.colorId)
      || engine.modesConfig.merge.tiers.find((c) => c.id === p.colorId)
    );
  engine.particleSystem.spawnTrail(p.x, p.y, p.radius, palette ? palette.highlight : theme.defaultTrailColor);
}

function executePhysicsStepAndPostHooks(engine, juice) {
  const simCfg = engine.physicsConfig.simulation;
  const dtSec = (simCfg ? simCfg.fixedStepMs || FALLBACK_FIXED_STEP_MS : FALLBACK_FIXED_STEP_MS) / MS_PER_SECOND;
  const behavior = engine.getModeBehavior();
  behavior.onBeforePhysicsStep(engine, dtSec);
  if (!engine.isRunPlaying()) {
    engine.particleSystem.update(juice.shakeDecay);
    return false;
  }
  if (engine.versus) {
    engine.stepVersusBefore();
  }
  const flyingProjectile = engine.physicsWorld.projectile;
  engine.isSteppingPhysics = true;
  try {
    engine.physicsWorld.step(engine.getStepCallbacks());
  } finally {
    engine.isSteppingPhysics = false;
  }
  behavior.onAfterPhysicsStep(engine, dtSec);
  if (engine.versus) {
    engine.stepVersusAfter(flyingProjectile);
  }
  if (engine.magnetar) {
    engine.stepMagnetarAfter(flyingProjectile);
  }
  if (engine.pendingRoundEnd || (engine.pendingBossRushWave && !engine.physicsWorld.projectile)) {
    engine.evaluateRoundEnd();
  }
  return true;
}

function syncBrokenBondsAndDroppingBalls(engine) {
  if (engine.physicsWorld.hasBrokenBondThisStep) {
    engine.physicsWorld.hasBrokenBondThisStep = false;
    engine.detachAndRewardAvalanche();
    engine.refreshMoorings();
    engine.discardBetweenTurnsCoreFreeze();
    // A board cleared by a bond break must not end the round with the shot frozen mid-air.
    const isShotHoldingRoundEnd = Boolean(engine.physicsWorld.projectile) && engine.isClearBasedMode();
    if (!isShotHoldingRoundEnd) {
      engine.evaluateRoundEnd();
    }
    engine.saveRunSnapshot();
    engine.notifyUI();
  }
  // Falling balls still pay score and overcharge until they land: save once the last is gone.
  const hasDroppingBalls = engine.physicsWorld.droppingBalls.length > 0;
  if (engine.hadDroppingBalls && !hasDroppingBalls) {
    engine.saveRunSnapshot();
  }
  engine.hadDroppingBalls = hasDroppingBalls;
}

function updateBetweenShotsState(engine) {
  if (engine.physicsWorld.projectile) {
    return;
  }
  // Preview recomputes once per render frame through refreshAimPreview instead of per fixed step.
  engine.isAimPreviewStale = true;
  if (!engine.hasFiredInRound) {
    engine.physicsWorld.pendingChainCandidateIds.clear();
  } else {
    engine.chainCooldown++;
    if (engine.chainCooldown >= engine.physicsConfig.simulation.chainCheckCooldownFrames) {
      engine.chainCooldown = 0;
      engine.evaluateAutomaticChainReactions();
      engine.discardBetweenTurnsCoreFreeze();
    }
  }
  if (engine.outOfShotsGraceFrames > 0) {
    engine.outOfShotsGraceFrames--;
    if (engine.isObjectiveCleared()) {
      engine.outOfShotsGraceFrames = 0;
      engine.evaluateRoundEnd();
    } else if (engine.outOfShotsGraceFrames === 0) {
      engine.triggerGameOver(GAME_OVER_REASONS.OUT_OF_SHOTS);
    }
  }
}

function stepBlitzUpdate(engine, juice, theme) {
  const blitzCfg = engine.gameConfig.blitz;
  engine.blitzFramesRemaining = Math.max(0, engine.blitzFramesRemaining - 1);
  if (engine.blitzFramesRemaining <= 0) {
    engine.particleSystem.update(juice.shakeDecay);
    engine.triggerGameOver(GAME_OVER_REASONS.TIME_UP);
    return false;
  }
  if (engine.blitzFramesRemaining % blitzCfg.framesPerSecond === 0) {
    const secondsLeft = Math.ceil(engine.blitzFramesRemaining / blitzCfg.framesPerSecond);
    if (secondsLeft > 0 && secondsLeft <= blitzCfg.urgentAudioSeconds) {
      engine.audioManager.playEffect('blitzTick');
    }
    engine.notifyUI();
  }
  engine.blitzWaveTimerFrames--;
  if (engine.blitzWaveTimerFrames <= 0 || engine.physicsWorld.balls.length < blitzCfg.minSpheresBeforeWave) {
    engine.blitzWaveTimerFrames = blitzCfg.waveIntervalFrames;
    engine.spawnEndlessWave();
    engine.refreshStaleLauncherColors();
    engine.saveRunSnapshot();
    engine.notifyUI();
  }
  if (!engine.physicsWorld.projectile && engine.physicsWorld.droppingBalls.length === 0) {
    engine.blitzIdleFrames++;
    if (engine.blitzIdleFrames >= blitzCfg.autoFireFrames) {
      engine.blitzIdleFrames = 0;
      const canvasCfg = engine.gameConfig.canvas;
      engine.particleSystem.spawnFloatingText(
        canvasCfg.launcherX,
        canvasCfg.launcherY + canvasCfg.launcherPopupOffsetY,
        t('gameplay.feedback.blitz.autoFire'),
        theme.wavePopupColor
      );
      engine.shoot();
    }
  }
  return true;
}

export class GameEngine {
  constructor(options) {
    initEngineDependencies(this, options);
    resetRunCounterFields(this);
    resetRoundTransientFields(this);
    resetModeProgressionFields(this);
    initSessionFields(this, options.gameConfig);
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

  getModeBehavior() {
    return getRegisteredModeBehavior(this.mode);
  }

  getLauncherSpec() {
    return this.getModeBehavior().getLauncherSpec(this);
  }

  isSpecialTypeAllowed(specialType) {
    if (!specialType || !Object.values(SPECIAL_TYPES).includes(specialType)) {
      return false;
    }
    if (this.mode === GAME_MODES.CLASSIC && !this.versus) {
      return false;
    }
    if (this.getModeBehavior().offersSpecialBalls(this) === false) {
      return false;
    }
    return this.getModeBehavior().isSpecialTypeAllowed(specialType, this);
  }

  /** True for modes where every shot spends a limited reserve (Campaign, Flux, Puzzle, Pinball and Slingshot). */
  usesShotBudget() {
    return (
      this.mode === GAME_MODES.CAMPAIGN
      || this.mode === GAME_MODES.FLUX
      || this.mode === GAME_MODES.PUZZLE
      || this.mode === GAME_MODES.PINBALL
      || this.mode === GAME_MODES.SLINGSHOT
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

  getMergeShakeRemaining() {
    return this.mode === GAME_MODES.MERGE ? this.modeState?.shakeRemaining ?? null : null;
  }

  /**
   * Event cycle of the Merge Basin for the HUD.
   * @returns {{eventCount: number, active: object|null, upcoming: object|null}|null} Null outside a live Basin run.
   */
  getMergeEventState() {
    const live = this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.PAUSED;
    return this.mode === GAME_MODES.MERGE && live ? this.getModeBehavior().getEventView(this) : null;
  }

  /**
   * Mini-contract of the Merge Basin for the HUD.
   * @returns {{contractCount: number, active: object|null, result: object|null}|null} Null outside a live Basin run.
   */
  getMergeContractState() {
    const live = this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.PAUSED;
    return this.mode === GAME_MODES.MERGE && live ? this.getModeBehavior().getContractView(this) : null;
  }

  /**
   * Overflow line pressure of the Merge Basin for the HUD.
   * @returns {{lineOffsetPx: number, pendingOffsetPx: number|null, pendingDropsLeft: number}|null} Null outside a live Basin run.
   */
  getMergePressureState() {
    const live = this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.PAUSED;
    return this.mode === GAME_MODES.MERGE && live ? this.getModeBehavior().getPressureView(this) : null;
  }

  /**
   * Basin shape of the Merge Basin for the HUD.
   * @returns {{shapeId: string, announceSerial: number|null}|null} Null outside a live Basin run.
   */
  getMergeShapeState() {
    const live = this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.PAUSED;
    return this.mode === GAME_MODES.MERGE && live ? this.getModeBehavior().getShapeView(this) : null;
  }

  /**
   * Latest special sphere announcement of the Merge Basin for the HUD.
   * @returns {{kind: string|null, announceSerial: number|null}|null} Null outside a live Basin run.
   */
  getMergeSpecialState() {
    const live = this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.PAUSED;
    return this.mode === GAME_MODES.MERGE && live ? this.getModeBehavior().getSpecialView(this) : null;
  }

  /**
   * Walls, floor and pegs of the Merge Basin run's shape.
   * @returns {{left: number, right: number, floor: number, pegs: Array<{x: number, y: number, radius: number}>}|null} Null outside the Basin.
   */
  getMergeBasinGeometry() {
    return this.mode === GAME_MODES.MERGE ? this.getModeBehavior().getBasinGeometry(this) : null;
  }

  tryMergeShake() {
    if (this.getMergeShakeRemaining() !== 0 || !this.isRunPlaying()) {
      return false;
    }
    return this.getModeBehavior().shake(this);
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
        // A weekly run is measured against the week's best (same metric as the Flux record).
        return { metric: RUN_BEST_METRICS.STAGE, current: this.fluxStage };
      case GAME_MODES.CLASSIC:
        return { metric: RUN_BEST_METRICS.STAGE, current: this.classicStage };
      case GAME_MODES.PINBALL:
        return { metric: RUN_BEST_METRICS.STAGE, current: this.pinballStage };
      case GAME_MODES.SLINGSHOT:
        return { metric: RUN_BEST_METRICS.STAGE, current: this.slingshotStage };
      case GAME_MODES.BOSS_RUSH:
        return { metric: RUN_BEST_METRICS.WAVE, current: this.bossRushWave };
      case GAME_MODES.HEX_GRID:
      case GAME_MODES.ORBITAL:
      case GAME_MODES.CONVOY:
        return { metric: RUN_BEST_METRICS.WAVE, current: this.waveCount };
      case GAME_MODES.ENDLESS:
      case GAME_MODES.DAILY:
      case GAME_MODES.CASCADE:
      case GAME_MODES.BLITZ:
      case GAME_MODES.MERGE:
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
    let best;
    if (this.mode === GAME_MODES.FLUX) {
      best = this.isWeeklyFluxRun
        ? storage.getWeeklyFluxBest?.(this.weeklyWeekKey)?.stage || 0
        : storage.getFluxBestStage?.() || 0;
    } else {
      const reader = RUN_BEST_READERS.get(this.mode);
      best = reader ? reader(storage, this) || 0 : 0;
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
    if (this.activeLabMutators?.length > 0) {
      return;
    }
    // The record in storage moves with the run: keep the one the run started against.
    this.getRunBestBaseline();
    const handler = PERSIST_HIGH_SCORE_HANDLERS.get(this.mode);
    if (handler) {
      handler(this);
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
    // Puzzle pays only its star rewards at victory, never run coins.
    if (amount <= 0 || this.mode === GAME_MODES.PUZZLE) {
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
   * @param {{markModeSeen?: boolean}} [options] - markModeSeen false keeps the mode's unlock
   *   state untouched (a Weekly Flux run, playable before Flux itself unlocks).
   */
  resetRunState(mode, { markModeSeen = true } = {}) {
    this.persistRunHighScore();
    this.recordAbandonedRun();
    if (markModeSeen) {
      this.storageManager.ensureModeUnlocked?.(mode);
    }
    this.flushPendingRunCoins();
    this.storageManager.clearRunSnapshot();
    this.mode = mode;
    this.isCustomPuzzle = false;
    this.customPuzzleSpec = null;
    this.activeLabMutators = [];
    // startVersusBoard sets the versus state again after this reset.
    this.versus = null;
    this.clearMagnetar();
    this.refreshPulseSettings();
    // clear() keeps the tilt: a run must not start leaning from the previous run's last reading.
    this.physicsWorld.tiltFactor = 0;
    resetRunCounterFields(this);
    resetRoundTransientFields(this);
    resetModeProgressionFields(this);
    this.waveLog = [];
    this.stashedRegularColorId = null;
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

  /**
   * Workshop level that counts in this run: the Daily Challenge and Puzzle fix every upgrade at
   * their configured baseline so all players start equal; other modes use the owned level.
   * @param {string} upgradeKey - Upgrade identifier.
   * @returns {number}
   */
  getEffectiveUpgradeLevel(upgradeKey) {
    // Classic and purist Arcade behavior modes keep Workshop upgrades neutralised.
    if (this.mode === GAME_MODES.CLASSIC || this.getModeBehavior().neutralizesWorkshopUpgrades(this)) {
      return 0;
    }
    if (this.mode === GAME_MODES.DAILY) {
      return this.gameConfig.seededFairness?.dailyUpgradeLevels?.[upgradeKey] ?? 0;
    }
    if (this.mode === GAME_MODES.PUZZLE) {
      return this.gameConfig.seededFairness?.puzzleUpgradeLevels?.[upgradeKey] ?? 0;
    }
    return this.storageManager.getUpgradeLevel(upgradeKey);
  }

  getBlastRadiusMultiplier() {
    const lvl = this.getEffectiveUpgradeLevel('blastRadius');
    const spec = this.gameConfig.upgrades.blastRadius;
    return 1 + lvl * spec.radiusMultiplierPerLevel + this.getFluxPerkBonus(FLUX_PERK_IDS.BLAST);
  }

  getOverchargeMultiplier() {
    // Classic, Puzzle and purist Arcade behavior modes have no earned specials; a duel board still charges its pulse.
    if (
      (this.mode === GAME_MODES.CLASSIC && !this.versus)
      || this.mode === GAME_MODES.PUZZLE
      || this.getModeBehavior().hidesOvercharge(this)
    ) {
      return 0;
    }
    const lvl = this.getEffectiveUpgradeLevel('overchargeRate');
    const spec = this.gameConfig.upgrades.overchargeRate;
    return 1 + lvl * spec.rateMultiplierPerLevel + this.getFluxPerkBonus(FLUX_PERK_IDS.OVERCHARGE);
  }

  /**
   * Laser Sight reach bonuses. The returned object is reused across calls (the aim preview
   * asks every frame): read it right away, do not keep it.
   */
  getLaserBonuses() {
    const lvl = this.getEffectiveUpgradeLevel('laserSight');
    const spec = this.gameConfig.upgrades.laserSight;
    this.laserBonuses.distanceBonus = lvl * spec.distanceBonusPerLevel;
    this.laserBonuses.bouncesBonus = lvl * spec.bouncesBonusPerLevel;
    return this.laserBonuses;
  }

  getStartingShotsBonus() {
    const lvl = this.getEffectiveUpgradeLevel('startingShots');
    const spec = this.gameConfig.upgrades.startingShots;
    return lvl * spec.shotsPerLevel;
  }

  getCollectorBonusPoints() {
    const base = this.gameConfig.scoring.collector?.bonusPointsPerBall || 0;
    const lvl = this.getEffectiveUpgradeLevel('collectorMagnet');
    const step = this.gameConfig.upgrades?.collectorMagnet?.pointsBonusPerLevel || 0;
    return base + lvl * step;
  }

  getCollectorOvercharge() {
    const base = this.gameConfig.scoring.collector?.overchargePerBall || 0;
    const lvl = this.getEffectiveUpgradeLevel('collectorMagnet');
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
    // A Magnetar has no shield: it is never broken, only dropped.
    return 0;
  }

  /**
   * True for a modifier whose ball never takes part in a color match (rust, neutral
   * anchor): such a ball must carry no color, or it would still count in color checks.
   */
  isColorlessModifier(mod) {
    return mod === CLUSTER_MODIFIERS.RUST || mod === CLUSTER_MODIFIERS.NEUTRAL_ANCHOR || mod === CLUSTER_MODIFIERS.MAGNETAR;
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
    if (
      this.state !== GAME_STATES.PLAYING
      || this.physicsWorld.projectile
      || !this.isSpecialTypeAllowed(specialType)
    ) {
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
        this.particleSystem.spawnBurst(x, y, theme.bounceParticleColor, juice.bounceBurstCount, juice.bounceBurstSpeed);
        this.crackWallAt(x, y);
      },
      onBallDroppedOut: (ball) => {
        this.particleSystem.splashLiquid(ball.x / this.gameConfig.canvas.logicalWidth, ball.vy);
      },
      onCollectorBinPass: (ball) => handleCollectorBinPass(this, ball),
      onPortalWarp: (entryPortal, exitPortal) => handlePortalWarp(this, entryPortal, exitPortal),
      onAnvilCrush: (target) => handleAnvilCrush(this, target),
      onAnvilComplete: () => handleAnvilComplete(this),
      onProjectileSnapped: (snappedBall, hitTarget, impactVx, impactVy) => {
        if (this.getModeBehavior().onProjectileSettled(this, { snappedBall, hitTarget, impactVx, impactVy })) {
          return;
        }
        this.handleProjectileSnapped(snappedBall, hitTarget);
      },
      onProjectileMissed: () => {
        this.combo = 0;
        this.handlePostTurnCleanup(false);
      },
      onSingularityCapture: (capturedBall, singularityObs) => handleSingularityCapture(this, capturedBall, singularityObs)
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
    const behavior = this.getModeBehavior();
    if (behavior.canFire(this) === false || behavior.fire(this)) {
      return;
    }
    if (this.mode === GAME_MODES.CASCADE) {
      this.cascadeOccupiedPlatforms = getOccupiedPlatformIndices(this.physicsWorld);
    }
    // The previous shot has settled: this is the state it left behind.
    this.sampleShotTimeline();
    this.evaluateGhostShot();
    this.countShotForStats();
    this.beginVersusTurn(this.currentBall);
    launchPreparedProjectile(this);
    finalizeFiredProjectile(this);
  }

  update() {
    if (this.isVictoryCelebrating()) {
      this.updateVictoryCelebration();
      return;
    }
    if (this.state !== GAME_STATES.PLAYING) {
      return;
    }
    advanceFrameTimers(this);
    const theme = this.gameConfig.theme;
    const juice = this.gameConfig.juice;
    if (this.isAwaitingPerk()) {
      this.particleSystem.update(juice.shakeDecay);
      return;
    }
    if (this.stageTransitionFrames > 0) {
      this.updateStageTransition();
      return;
    }
    if (this.stageIntroFrames > 0) {
      this.stageIntroFrames--;
    }
    this.updateImpactWave();
    if (this.isVersusRole) {
      // Both boards of a duel must keep stepping in lockstep: no hit-stop freeze.
      this.hitStopFrames = 0;
    }
    if (this.hitStopFrames > 0) {
      this.hitStopFrames--;
      this.particleSystem.updateShakeOnly(juice.shakeDecay);
      return;
    }
    updateSlowMoAndProjectileTrail(this, juice, theme);
    if (!executePhysicsStepAndPostHooks(this, juice)) {
      return;
    }
    syncBrokenBondsAndDroppingBalls(this);
    if (!this.isRunPlaying()) {
      this.particleSystem.update(juice.shakeDecay);
      return;
    }
    updateBetweenShotsState(this);
    if (this.mode === GAME_MODES.BLITZ && this.isRunPlaying() && !stepBlitzUpdate(this, juice, theme)) {
      return;
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
    if (this.activeLabMutators?.length > 0) {
      const step = this.gameConfig.mutatorLab?.scoreMultiplierPerMutator ?? 0.25;
      mult = 1.0 + this.activeLabMutators.length * step;
    } else if (this.activeMutatorKey && this.gameConfig.daily?.mutators?.[this.activeMutatorKey]?.scoreMultiplier) {
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
    // A restart on the same board keeps the ghost; any other start clears it (resetRunState).
    const ghost = this.ghostDuel?.ghost ?? null;
    const labMutators = this.activeLabMutators?.length > 0 ? [...this.activeLabMutators] : null;
    if (this.mode === GAME_MODES.FLUX) {
      restartFluxMode(this, ghost, labMutators);
    } else if (labMutators && this.mode === GAME_MODES.ENDLESS) {
      this.startEndlessMode({ mutators: labMutators });
    } else if (labMutators && this.mode === GAME_MODES.CLASSIC) {
      this.startClassicMode(1, { mutators: labMutators });
    } else {
      const handler = RESTART_MODE_HANDLERS.get(this.mode);
      if (handler) {
        handler(this);
      } else {
        this.startEndlessMode();
      }
    }
    if (ghost) {
      this.attachGhost(ghost);
    }
  }

  notifyUI(extra = {}) {
    if (this.onStateChange) {
      this.onStateChange(this, extra);
    }
  }
}

function restartFluxMode(engine, ghost, labMutators) {
  if (ghost) {
    // Same board, same shapes: a duel replayed on older shapes restarts on them.
    engine.startFluxRun(engine.fluxSeed, {
      isShared: true,
      isRestart: true,
      weekKey: engine.weeklyWeekKey ?? undefined,
      contentVersion: engine.fluxContentVersion
    });
  } else if (engine.isWeeklyFluxRun) {
    engine.startWeeklyFlux({ isRestart: true });
  } else {
    engine.startFluxRun(null, labMutators ? { mutators: labMutators } : undefined);
  }
}

installMethods(GameEngine, engineModeMethods);
installMethods(GameEngine, engineBoardMethods);
installMethods(GameEngine, engineLauncherMethods);
installMethods(GameEngine, engineDiscoveryMethods);
installMethods(GameEngine, engineControlsMethods);
installMethods(GameEngine, engineTurnResolutionMethods);
installMethods(GameEngine, engineRoundFlowMethods);
installMethods(GameEngine, engineProgressMethods);
installMethods(GameEngine, engineGhostDuelMethods);
installMethods(GameEngine, engineVersusMethods);
installMethods(GameEngine, engineMagnetarMethods);
installMethods(GameEngine, enginePulseMethods);
