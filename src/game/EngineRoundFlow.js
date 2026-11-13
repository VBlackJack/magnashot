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
  OBSTACLE_TYPES,
  CLUSTER_MODIFIERS,
  GAME_OVER_REASONS,
  MATH_CONSTANTS,
  WAVE_TYPES
} from '../core/Constants.js';
import { t } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { getSagSpec, getSagPhase, SAG_PHASES } from './SagMeter.js';
import { reportBountyEvent } from './Bounties.js';

/**
 * Stars a Puzzle attempt count allows: the fewer attempts before the first clear, the higher
 * the cap. Thresholds come from game.json puzzleStars.
 * @param {number} attempts - Attempts started on the stage up to its first clear.
 * @param {{threeStarMaxAttempts: number, twoStarMaxAttempts: number}} puzzleStars
 * @param {{minVictoryStars: number, maxStars: number}} scoring
 * @returns {number}
 */
export function attemptStars(attempts, puzzleStars, scoring) {
  if (attempts <= puzzleStars.threeStarMaxAttempts) {
    return scoring.maxStars;
  }
  if (attempts <= puzzleStars.twoStarMaxAttempts) {
    return scoring.maxStars - 1;
  }
  return scoring.minVictoryStars;
}

/**
 * Stars of a Puzzle win: the lower of the attempt cap and the score stars.
 * @param {{attempts: number, scoreStars: number, puzzleStars: Object, scoring: Object}} input
 * @returns {number}
 */
export function computePuzzleStars({ attempts, scoreStars, puzzleStars, scoring }) {
  return Math.min(attemptStars(attempts, puzzleStars, scoring), scoreStars);
}

/**
 * Next-star hint of a Puzzle win. Only a win whose attempts still allow the top star but whose
 * score misses the top threshold gets one; it targets that threshold.
 * @returns {{nextStarTarget: ?number, nextStarNumber: ?number}}
 */
export function getPuzzleNextStarHint({ attempts, score, thresholds, puzzleStars, scoring }) {
  const topThreshold = thresholds[thresholds.length - 1] ?? 0;
  const capIsTop = attemptStars(attempts, puzzleStars, scoring) >= scoring.maxStars;
  if (!capIsTop || !(topThreshold > score)) {
    return { nextStarTarget: null, nextStarNumber: null };
  }
  return {
    nextStarTarget: topThreshold,
    nextStarNumber: thresholds.filter((th) => th <= topThreshold).length
  };
}

/** Methods of GameEngine that belong to this domain, installed on its prototype. */
export const engineRoundFlowMethods = {
  findClosestBall(sourceBall, candidates) {
    if (!candidates || candidates.length === 0) {
      return null;
    }
    let closest = candidates[0];
    let minDist = Math.hypot(sourceBall.x - closest.x, sourceBall.y - closest.y);
    for (let i = 1; i < candidates.length; i++) {
      const d = Math.hypot(sourceBall.x - candidates[i].x, sourceBall.y - candidates[i].y);
      if (d < minDist) {
        minDist = d;
        closest = candidates[i];
      }
    }
    return closest;
  },

  /**
   * Kind of a survival wave, decided by its number alone: a boss wave wins over a gold rush.
   * @param {number} waveNumber - 1-based wave number.
   * @returns {string} One of WAVE_TYPES.
   */
  getWaveType(waveNumber) {
    const endlessCfg = this.gameConfig.endless;
    if (endlessCfg.bossWaveInterval > 0 && waveNumber % endlessCfg.bossWaveInterval === 0) {
      return WAVE_TYPES.BOSS;
    }
    if (endlessCfg.goldRushWaveInterval > 0 && waveNumber % endlessCfg.goldRushWaveInterval === 0) {
      return WAVE_TYPES.GOLD_RUSH;
    }
    return WAVE_TYPES.NORMAL;
  },

  /**
   * Moves the whole cluster (pivot obstacles and every ball) down one rigid step and strips
   * the anchor flag from the balls that held it. Fixed fixtures do not move.
   * @param {number} stepY - Vertical distance of the step.
   * @returns {object[]} The balls that were anchors before the step.
   */
  shiftClusterDown(stepY) {
    const previousAnchors = [];
    for (const obs of this.physicsWorld.obstacles) {
      if (obs.type === OBSTACLE_TYPES.PIVOT) {
        obs.baseY += stepY;
        obs.y += stepY;
        obs.prevY += stepY;
      }
    }
    for (const b of this.physicsWorld.balls) {
      if (b.pivotRef) {
        b.y += stepY;
        b.prevY += stepY;
        b.anchorY += stepY;
        continue;
      }
      if (b.isAnchor) {
        previousAnchors.push(b);
      }
      b.isAnchor = false;
      b.y += stepY;
      b.anchorY += stepY;
    }

    return previousAnchors;
  },

  /**
   * Classic sag step: the whole cluster, ceiling included, drops one step and no row is added.
   * The balls that held the ceiling keep their anchor flag at the new height.
   */
  lowerAnchorRail() {
    const endlessCfg = this.gameConfig.endless;
    const stepY = this.gameConfig.classic?.descentStepY ?? endlessCfg.descentStepY;
    const previousAnchors = this.shiftClusterDown(stepY);
    for (const anchor of previousAnchors) {
      anchor.isAnchor = true;
    }
    this.railDrops = (this.railDrops ?? 0) + 1;
    this.classicRailDropsTotal = (this.classicRailDropsTotal ?? 0) + 1;
    this.checkDangerLineBreach();
  },

  /**
   * Sag spec of the current mode, memoised: the renderer and the HUD ask every frame.
   * Rebuilt when the mode or the config sections change.
   */
  getSagSpecCached() {
    const cache = this.sagSpecCache;
    const sagCfg = this.gameConfig.sag;
    const endlessCfg = this.gameConfig.endless;
    if (cache && cache.mode === this.mode && cache.sagCfg === sagCfg && cache.endlessCfg === endlessCfg) {
      return cache.spec;
    }
    const spec = getSagSpec(this.mode, sagCfg, endlessCfg);
    this.sagSpecCache = { mode: this.mode, sagCfg, endlessCfg, spec };
    return spec;
  },

  /**
   * Read-only view of the Sag meter for the HUD and the renderer.
   * @returns {{active:boolean, level:number, size:number, phase:string, railDrops:number}}
   */
  getSagState() {
    const spec = this.getSagSpecCached();
    const railDrops = this.railDrops ?? 0;
    if (!spec) {
      return { active: false, level: 0, size: 0, phase: 'calm', railDrops };
    }
    // The meter resets the moment it fills; while the step is still easing in it reads as full.
    if ((this.railLowerFrames ?? 0) > 0) {
      return { active: true, level: spec.size, size: spec.size, phase: SAG_PHASES.FULL, railDrops };
    }
    const level = this.sagLevel ?? 0;
    return { active: true, level, size: spec.size, phase: getSagPhase(level, spec, spec.warnAt), railDrops };
  },

  spawnEndlessWave() {
    const endlessCfg = this.gameConfig.endless;
    const waveCfg = this.mode === GAME_MODES.BLITZ ? this.gameConfig.blitz : endlessCfg;
    const descentStepY = waveCfg.descentStepY ?? endlessCfg.descentStepY;
    const startY = waveCfg.startY ?? endlessCfg.startY;
    this.waveCount++;
    this.endlessRowParity = (this.endlessRowParity + 1) % 2;

    const previousAnchors = this.shiftClusterDown(descentStepY);

    const cols = waveCfg.columns ?? endlessCfg.columns;
    const waveType = this.getWaveType(this.waveCount);
    this.waveLog.push(waveType);
    const isBossWave = waveType === WAVE_TYPES.BOSS;
    const isGoldRushWave = waveType === WAVE_TYPES.GOLD_RUSH;
    let remainingGoldCores = isGoldRushWave ? endlessCfg.goldRushCoinCoreCount : 0;
    let bossCorePlaced = false;

    const waveStream = this.mode === GAME_MODES.DAILY ? `${this.dailySeedKey}:wave:${this.waveCount}` : null;
    const newRowBalls = this.withScopedRandom(waveStream, () =>
      this.spawnEndlessRow(startY, this.endlessRowParity, true, (col) => {
        if (isBossWave && !bossCorePlaced && col >= Math.floor(cols * MATH_CONSTANTS.HALF)) {
          bossCorePlaced = true;
          return CLUSTER_MODIFIERS.BOSS_CORE;
        }
        if (remainingGoldCores > 0) {
          remainingGoldCores--;
          return CLUSTER_MODIFIERS.COIN_CORE;
        }
        return this.rollEndlessModifier();
      })
    );
    const newRowIds = new Set(newRowBalls.map((b) => b.id));

    this.physicsWorld.rebuildInitialBonds();

    if (newRowBalls.length > 0) {
      for (const oldAnchor of previousAnchors) {
        let linkedToNewRow = false;
        for (const neighborId of oldAnchor.bonds) {
          if (newRowIds.has(neighborId)) {
            linkedToNewRow = true;
            break;
          }
        }
        if (!linkedToNewRow) {
          const closest = this.findClosestBall(oldAnchor, newRowBalls);
          if (closest) {
            this.physicsWorld.createBond(oldAnchor, closest, false);
          }
        }
      }

      let anchoredSet = this.physicsWorld.getAnchoredBallIds();
      for (const ball of this.physicsWorld.balls) {
        if (!anchoredSet.has(ball.id)) {
          const closest = this.findClosestBall(ball, newRowBalls);
          if (closest) {
            this.physicsWorld.createBond(ball, closest, false);
            anchoredSet = this.physicsWorld.getAnchoredBallIds();
          }
        }
      }
    }

    if (this.mode === GAME_MODES.ENDLESS) {
      this.storageManager?.recordAchievementProgress?.({ endlessWave: this.waveCount });
    }
    if (this.isSurvivalMode()) {
      this.unlockAchievementTiers('survivorWave10', this.waveCount);
    }

    let waveBannerKey = 'gameplay.feedback.wave.incoming';
    let waveBannerColor = this.gameConfig.theme.wavePopupColor;
    if (isBossWave) {
      waveBannerKey = 'gameplay.feedback.wave.bossWave';
      waveBannerColor = this.gameConfig.theme.bossPopupColor;
    } else if (isGoldRushWave) {
      waveBannerKey = 'gameplay.feedback.wave.goldRush';
      waveBannerColor = this.gameConfig.theme.coinPopupColor;
    }

    this.particleSystem.spawnFloatingText(
      this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      startY + this.gameConfig.canvas.wavePopupOffsetY,
      t(waveBannerKey),
      waveBannerColor
    );
  },

  checkDangerLineBreach() {
    if (!this.isRunPlaying()) {
      return;
    }
    if (this.getModeBehavior().evaluateBoardState(this)) {
      return;
    }
    const dangerY = this.gameConfig.canvas.dangerLineY;
    for (const b of this.physicsWorld.balls) {
      if (!b.isDropping && b.y + b.radius >= dangerY) {
        const anchoredSet = this.physicsWorld.getAnchoredBallIds();
        if (!anchoredSet.has(b.id)) {
          this.detachAndRewardAvalanche();
          this.evaluateRoundEnd();
          this.saveRunSnapshot();
          this.notifyUI();
          return;
        }
        this.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
        return;
      }
    }
  },

  evaluateRoundEnd() {
    this.pendingRoundEnd = false;
    // A cleared Flux shape is paid once: later checks in the same frame see the empty
    // board of the transition, not a second clear.
    if (!this.isRunPlaying() || this.stageTransitionFrames > 0) {
      return;
    }
    if (this.getModeBehavior().evaluateBoardState(this)) {
      return;
    }
    if (this.mode === GAME_MODES.CAMPAIGN) {
      if (this.isObjectiveCleared()) {
        this.outOfShotsGraceFrames = 0;
        this.releaseRemainingBoardAsAvalanche();
        this.storageManager?.recordAchievementProgress?.({ shotsRemainingOnClear: this.shotsRemaining });
        this.unlockAchievementTiers('sharpshooter', this.shotsRemaining);
        const bonus = this.shotsRemaining * this.gameConfig.scoring.remainingShotBonus;
        this.addScore(bonus);
        const stars = this.computeStars(this.score);
        const previousStats = this.storageManager.getLevelStats()[this.currentLevelId] || { bestScore: 0, stars: 0 };
        const isNewRecord = previousStats.bestScore > 0 && this.score > previousStats.bestScore;
        const thresholds = this.getStarThresholds();
        const nextStarTarget = thresholds.find((th) => th > this.score) ?? null;
        const nextStarNumber = nextStarTarget !== null ? stars + 1 : null;
        const pointsToNextStar = nextStarTarget !== null ? Math.max(1, nextStarTarget - this.score) : 0;
        const { newlyEarnedStars } = this.storageManager.saveLevelResult(this.currentLevelId, this.score, stars);
        const firstStarBonus = newlyEarnedStars * this.gameConfig.scoring.firstTimeStarCoinBonus;
        const earnedCoins = stars * this.gameConfig.scoring.coinsPerVictoryStar + firstStarBonus;
        this.storageManager.addCoins(earnedCoins);
        this.flushPendingRunCoins();
        this.storageManager.unlockLevel(Math.min(this.currentLevelId + 1, this.levelCatalog.lastId));
        this.unlockAchievementTiers('starCollector', this.storageManager.getTotalStars());
        this.state = GAME_STATES.VICTORY;
        this.persistRunHighScore();
        this.recordRunOutcome('win');
        this.storageManager.clearRunSnapshot();
        this.audioManager.playEffect('victory');
        this.victorySummary = {
          victoryBonus: bonus,
          stars,
          earnedCoins,
          isNewRecord,
          nextStarTarget,
          nextStarNumber,
          pointsToNextStar,
          unlockedModes: this.storageManager.syncEarnedModeUnlocks?.() ?? []
        };
        this.victoryCelebrationFrames = this.gameConfig.victory.celebrationFrames;
        this.particleSystem.spawnFloatingText(
          this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
          this.gameConfig.canvas.logicalHeight * MATH_CONSTANTS.HALF,
          t('gameplay.feedback.victory.cleared'),
          this.gameConfig.theme.victoryPopupColor
        );
        this.notifyUI(this.victorySummary);
        return;
      }

      this.startOutOfShotsGraceIfNeeded();
    } else if (this.mode === GAME_MODES.PUZZLE) {
      if (this.isObjectiveCleared()) {
        this.outOfShotsGraceFrames = 0;
        this.releaseRemainingBoardAsAvalanche();
        const bonus = this.shotsRemaining * this.gameConfig.scoring.remainingShotBonus;
        this.addScore(bonus);
        const stage = this.currentPuzzleStage;
        const previous = this.storageManager.getPuzzleStageStats()[stage] || { bestScore: 0, stars: 0, attempts: 0 };
        const scoring = this.gameConfig.scoring;
        // A snapshot saved before attempts were counted on the first shot holds 0: never better than a first try.
        const attemptsForStars = Math.max(1, previous.attempts);
        const stars = computePuzzleStars({
          attempts: attemptsForStars,
          scoreStars: this.computeStars(this.score),
          puzzleStars: this.gameConfig.puzzleStars,
          scoring
        });
        const isNewRecord = previous.bestScore > 0 && this.score > previous.bestScore;
        const { nextStarTarget, nextStarNumber } = getPuzzleNextStarHint({
          attempts: attemptsForStars,
          score: this.score,
          thresholds: this.getStarThresholds(),
          puzzleStars: this.gameConfig.puzzleStars,
          scoring
        });
        const pointsToNextStar = nextStarTarget !== null ? Math.max(1, nextStarTarget - this.score) : 0;
        const { newlyEarnedStars } = this.storageManager.savePuzzleStageResult(stage, this.score, stars);
        const earnedCoins = newlyEarnedStars * (scoring.coinsPerVictoryStar + scoring.firstTimeStarCoinBonus);
        this.storageManager.addCoins(earnedCoins);
        this.flushPendingRunCoins();
        this.state = GAME_STATES.VICTORY;
        this.persistRunHighScore();
        this.recordRunOutcome('win');
        this.storageManager.clearRunSnapshot();
        this.audioManager.playEffect('victory');
        this.victorySummary = {
          victoryBonus: bonus,
          stars,
          earnedCoins,
          isNewRecord,
          nextStarTarget,
          nextStarNumber,
          pointsToNextStar
        };
        this.victoryCelebrationFrames = this.gameConfig.victory.celebrationFrames;
        this.particleSystem.spawnFloatingText(
          this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
          this.gameConfig.canvas.logicalHeight * MATH_CONSTANTS.HALF,
          t('gameplay.feedback.victory.cleared'),
          this.gameConfig.theme.victoryPopupColor
        );
        this.notifyUI(this.victorySummary);
        return;
      }
      this.startOutOfShotsGraceIfNeeded();
    } else if (this.mode === GAME_MODES.FLUX) {
      if (this.magnetar && !this.getMagnetarBall() && this.physicsWorld.balls.length > 0) {
        // The Magnetar fell: whatever else is left of the shape goes with it and the stage is won.
        this.releaseRemainingBoardAsAvalanche();
      }
      if (this.physicsWorld.balls.length === 0) {
        this.outOfShotsGraceFrames = 0;
        this.completeFluxStage();
        return;
      }
      this.startOutOfShotsGraceIfNeeded();
    } else if (this.mode === GAME_MODES.CLASSIC) {
      if (this.physicsWorld.balls.length === 0 && !this.physicsWorld.projectile) {
        this.completeClassicStage();
      }
    } else if (this.mode === GAME_MODES.BOSS_RUSH) {
      const bossBall = this.getBossBall();
      if (!bossBall) {
        if (this.physicsWorld.projectile) {
          // The next wave would wipe the shot in flight: wait for it to land (update() and
          // the post-turn cleanup both come back here). The run is not capturable meanwhile
          // (see isRunSnapshotable), so this flag is never saved.
          this.pendingBossRushWave = true;
          return;
        }
        this.pendingBossRushWave = false;
        const bossRushCfg = this.gameConfig.bossRush;
        const canvasCfg = this.gameConfig.canvas;
        this.releaseRemainingBoardAsAvalanche();
        const waveBonus = bossRushCfg.waveClearBonusBase * this.bossRushWave;
        this.addScore(waveBonus);
        this.awardRunCoins(bossRushCfg.waveClearCoinBonus);
        this.particleSystem.spawnFloatingText(
          canvasCfg.logicalWidth * MATH_CONSTANTS.HALF,
          canvasCfg.logicalHeight * MATH_CONSTANTS.HALF,
          t('gameplay.feedback.bossRush.waveCleared', { points: waveBonus }),
          this.gameConfig.theme.victoryPopupColor
        );
        this.bossRushWave++;
        this.waveCount = this.bossRushWave;
        this.unlockAchievementTiers('bossRushWaves', this.bossRushWave);
        this.persistRunHighScore();
        this.spawnBossRushWave();
        this.refreshStaleLauncherColors();
        this.refreshDiscovery();
        this.saveRunSnapshot({ force: true });
        this.notifyUI();
      } else if (this.physicsWorld.balls.length === 1 && !this.magnetar) {
        const bossRushCfg = this.gameConfig.bossRush;
        const r = this.physicsConfig.ball.radius;
        const centralPivot = this.physicsWorld.obstacles.find((o) => o.type === OBSTACLE_TYPES.PIVOT) || null;
        this.spawnConcentricRings(
          bossBall.x,
          bossBall.y,
          [{ radius: r * bossRushCfg.innerRingRadiusFactor, count: bossRushCfg.innerRingCount }],
          centralPivot,
          this.gameConfig.endless.modifierWeights
        );
        for (const ball of this.physicsWorld.balls) {
          if (ball.id !== bossBall.id) {
            this.physicsWorld.createBond(bossBall, ball, false);
          }
        }
        this.physicsWorld.rebuildInitialBonds();
        this.refreshStaleLauncherColors();
      }
    } else if (this.mode === GAME_MODES.CASCADE) {
      if (this.physicsWorld.balls.length === 0) {
        const cascadeCfg = this.gameConfig.cascade;
        this.cascadeWave++;
        this.waveCount = this.cascadeWave;
        this.cascadeTurnsUntilDrop = cascadeCfg.shotsBeforeDrop;
        for (let row = 0; row < cascadeCfg.initialDropRows; row++) {
          this.spawnCascadeDropWave(0);
        }
        this.refreshStaleLauncherColors();
        this.particleSystem.spawnFloatingText(
          this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
          cascadeCfg.startY + this.gameConfig.canvas.wavePopupOffsetY,
          t('gameplay.feedback.wave.incoming'),
          this.gameConfig.theme.wavePopupColor
        );
        this.saveRunSnapshot();
        this.notifyUI();
      }
    } else if ((this.isSurvivalMode() || this.mode === GAME_MODES.BLITZ) && this.physicsWorld.balls.length === 0) {
      this.spawnEndlessWave();
    }
  },

  /**
   * With the reserve empty and nothing in flight, waits a short grace period for chain
   * reactions to clear the board before the run is lost (see update()).
   */
  startOutOfShotsGraceIfNeeded() {
    if (this.shotsRemaining <= 0 && !this.physicsWorld.projectile && this.outOfShotsGraceFrames === 0) {
      this.outOfShotsGraceFrames = this.physicsConfig.simulation.outOfShotsGraceFrames;
    }
  },

  triggerGameOver(reasonKey) {
    if (this.state === GAME_STATES.GAME_OVER || this.state === GAME_STATES.VICTORY) {
      return;
    }
    // The final board is shown where it really is: no lowering ease on the end screen.
    this.railLowerFrames = 0;
    let previousBestScore = 0;
    if (this.mode === GAME_MODES.ENDLESS) {
      previousBestScore = this.storageManager.getEndlessHighScore();
    } else if (this.mode === GAME_MODES.DAILY) {
      previousBestScore = this.storageManager.getDailyHighScore(this.dailySeedKey || SeededRandom.getTodayDateKey());
    } else if (this.mode === GAME_MODES.FLUX && this.isWeeklyFluxRun) {
      previousBestScore = this.storageManager.getWeeklyFluxBest?.(this.weeklyWeekKey)?.score || 0;
    } else if (this.mode === GAME_MODES.FLUX) {
      previousBestScore = this.storageManager.getFluxHighScore();
    } else if (this.mode === GAME_MODES.BLITZ) {
      previousBestScore = this.storageManager.getBlitzHighScore?.() || 0;
    } else if (this.mode === GAME_MODES.BOSS_RUSH) {
      previousBestScore = this.storageManager.getBossRushHighScore?.() || 0;
    } else if (this.mode === GAME_MODES.CASCADE) {
      previousBestScore = this.storageManager.getCascadeHighScore?.() || 0;
    } else if (this.mode === GAME_MODES.PUZZLE) {
      previousBestScore = this.storageManager.getPuzzleHighScore?.() || 0;
    } else if (this.mode === GAME_MODES.CLASSIC) {
      previousBestScore = this.storageManager.getClassicHighScore?.() || 0;
    } else if (this.mode === GAME_MODES.HEX_GRID) {
      previousBestScore = this.storageManager.getHexGridHighScore?.() || 0;
    } else if (this.mode === GAME_MODES.ORBITAL) {
      previousBestScore = this.storageManager.getOrbitalHighScore?.() || 0;
    } else if (this.mode === GAME_MODES.PINBALL) {
      previousBestScore = this.storageManager.getPinballHighScore?.() || 0;
    } else if (this.mode === GAME_MODES.CONVOY) {
      previousBestScore = this.storageManager.getConvoyHighScore?.() || 0;
    } else if (this.mode === GAME_MODES.MERGE) {
      previousBestScore = this.storageManager.getMergeHighScore?.() || 0;
    }
    // A Daily rematch persists nothing, so it never sets a record.
    const isNewRecord = this.mode !== GAME_MODES.CAMPAIGN && this.mode !== GAME_MODES.PUZZLE && !this.isDailyRematch && previousBestScore > 0 && this.score > previousBestScore;
    const remainingSpheres = this.physicsWorld.balls.length;
    this.gameOverSummary = {
      reasonKey,
      isNewRecord,
      remainingSpheres,
      maxCombo: this.maxComboInRound,
      earnedCoins: this.runCoinsEarned,
      nearMiss: this.computeNearMiss()
    };
    this.state = GAME_STATES.GAME_OVER;
    // The state the last shot left behind, written as a finished timeline.
    this.sampleShotTimeline(true);
    this.settleGhostDuel();
    this.persistRunHighScore();
    this.recordRunOutcome('loss');
    if (this.mode === GAME_MODES.DAILY && !this.isDailyRematch && this.hasFiredInRound) {
      reportBountyEvent(this, 'daily_run_finished', 1);
    }
    this.flushPendingRunCoins();
    this.storageManager.clearRunSnapshot();
    this.audioManager.playEffect('gameOver');
    this.noteVersusBoardLost(reasonKey);
    this.notifyUI({ gameOverReason: reasonKey });
  },

  getContinuePackSpec() {
    return this.gameConfig.scoring.continuePack;
  },

  canContinueOutOfShots() {
    return Boolean(
      this.state === GAME_STATES.GAME_OVER
      && this.usesShotBudget()
      && this.mode !== GAME_MODES.PUZZLE
      && this.gameOverSummary?.reasonKey === GAME_OVER_REASONS.OUT_OF_SHOTS
      && !this.hasUsedContinue
      && this.physicsWorld.balls.length > 0
    );
  },

  continueOutOfShots() {
    if (!this.canContinueOutOfShots()) {
      return false;
    }
    const pack = this.getContinuePackSpec();
    const coins = this.storageManager.getCoins();
    if (coins < pack.costCoins) {
      return false;
    }
    this.storageManager.setCoins(coins - pack.costCoins);
    this.hasUsedContinue = true;
    this.retractRunOutcome();
    this.retractGhostDuel();
    this.shotsRemaining = pack.shots;
    this.outOfShotsGraceFrames = 0;
    this.gameOverSummary = null;
    this.state = GAME_STATES.PLAYING;
    if (!this.currentBall) {
      this.currentBall = this.createRandomLauncherBall();
    }
    if (!this.nextBall) {
      this.nextBall = this.createRandomLauncherBall();
    }
    this.updateAimFromAngle(this.aimAngle);
    this.audioManager.playEffect('upgrade');
    this.saveRunSnapshot({ force: true });
    this.notifyUI({ continuedOutOfShots: true });
    return true;
  },

  /**
   * Star thresholds of the current level. A level that declares none gets them from its
   * starting sphere count (scoring.autoStarPointsPerBall), so a new level is playable
   * before its thresholds are tuned.
   */
  getStarThresholds() {
    if (this.mode === GAME_MODES.PUZZLE) {
      const puzzles = this.gameConfig.puzzles || [];
      const puzzleDef = puzzles[(this.currentPuzzleStage - 1) % Math.max(1, puzzles.length)];
      if (puzzleDef?.starThresholds) {
        return puzzleDef.starThresholds;
      }
    }
    const levelDef = this.levelCatalog.get(this.currentLevelId);
    if (levelDef?.starThresholds) {
      return levelDef.starThresholds;
    }
    const perBall = this.gameConfig.scoring.autoStarPointsPerBall;
    if (levelDef && perBall && this.levelStartBallCount > 0) {
      return perBall.map((points) => Math.round(points * this.levelStartBallCount));
    }
    return this.gameConfig.scoring.starThresholds;
  },

  computeStars(score) {
    const thresholds = this.getStarThresholds();
    let stars = this.gameConfig.scoring.minVictoryStars;
    for (let i = 0; i < thresholds.length; i++) {
      if (score >= thresholds[i]) {
        stars = i + 1;
      }
    }
    return Math.min(stars, this.gameConfig.scoring.maxStars);
  },
};
