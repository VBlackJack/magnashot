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
  OBSTACLE_TYPES,
  SPECIAL_TYPES,
  CLUSTER_MODIFIERS,
  MATH_CONSTANTS
} from '../core/Constants.js';
import { t } from '../core/I18n.js';
import { DISCOVERY_INTERACTIONS } from './Discovery.js';
import { applyTurn, SAG_STEPS } from './SagMeter.js';
import { reportBountyEvent } from './Bounties.js';

/** Methods of GameEngine that belong to this domain, installed on its prototype. */
export const engineTurnResolutionMethods = {
  /**
   * Resolves a matched color cluster of 3+ balls, incrementing combo, awarding score
   * and overcharge, triggering screen shake, hit-stop, and combo achievements.
   * @param {Array<import('../entities/Ball.js').Ball>} cluster - Connected same-color balls.
   * @param {import('../entities/Ball.js').Ball} originBall - Ball where popup text should spawn.
   * @param {boolean} isChainReaction - True if triggered automatically by post-settle bonding.
   * @returns {number} Number of balls actually destroyed; 0 means the match only cracked armor
   *   and awarded nothing.
   */
  resolveColorMatchCluster(cluster, originBall, isChainReaction = false) {
    const minMatch = this.gameConfig.defaults.matchMinCount;
    const scoring = this.gameConfig.scoring;
    const juice = this.gameConfig.juice;
    const theme = this.gameConfig.theme;
    const canvasCfg = this.gameConfig.canvas;

    const palette = this.ballsConfig.standardColors.find((c) => c.id === originBall.colorId);
    const burstColor = palette ? palette.highlight : theme.anchorCoreColor;

    const prevOrigin = this.detonationOrigin;
    this.detonationOrigin = originBall;
    let destroyedCount = 0;
    for (const member of cluster) {
      if (this.destroyClusterBall(member, burstColor, false)) {
        destroyedCount++;
      }
    }
    this.detonationOrigin = prevOrigin;
    if (destroyedCount === 0) {
      return 0;
    }
    reportBountyEvent(this, 'match_group_cleared', 1);

    this.combo = Math.min(
      this.combo + scoring.comboIncrement,
      scoring.maxComboMultiplier
    );
    this.maxComboInRound = Math.max(this.maxComboInRound, this.combo);

    const basePoints = scoring.baseMatchPoints + (cluster.length - minMatch) * scoring.extraBallMultiplier;
    const points = basePoints * destroyedCount * this.combo;
    this.addScore(points);
    this.addOvercharge(destroyedCount * scoring.overchargePerMatchedBall);

    if (isChainReaction) {
      this.particleSystem.spawnFloatingText(
        originBall.x,
        originBall.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.chain.popup', { points }),
        theme.chainPopupColor
      );
    } else if (this.combo > 1) {
      this.particleSystem.spawnFloatingText(
        originBall.x,
        originBall.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.combo.popup', { combo: this.combo, points }),
        burstColor
      );
    }

    this.particleSystem.addScreenShake(juice.matchShake, juice.maxShakeOffset);
    this.audioManager.playEffect('match', this.combo);
    if (this.combo >= juice.hitStopMinCombo) {
      this.hitStopFrames = this.isVersusRole ? 0 : juice.hitStopFramesCombo;
    }
    this.storageManager?.recordAchievementProgress?.({ maxCombo: this.combo });
    this.unlockAchievementTiers('comboMaster', this.combo);
    return destroyedCount;
  },

  /**
   * Resolves at most one chain-reaction cluster per check. The candidates left over are
   * queued again so the next cluster goes off one cooldown later: a cascade plays out step
   * by step instead of in a single frame.
   */
  /** Modes whose round is won by clearing the board (Campaign, Puzzle, Flux). */
  isClearBasedMode() {
    return this.mode === GAME_MODES.CAMPAIGN || this.mode === GAME_MODES.PUZZLE || this.mode === GAME_MODES.FLUX;
  },

  /**
   * A Freeze Core that goes off between turns (no shot in flight) must not skip the next
   * shot's countdown: only a core set off during a turn is covered by that turn's cleanup.
   */
  discardBetweenTurnsCoreFreeze() {
    if (!this.physicsWorld.projectile) {
      this.isCoreFreezeApplied = false;
    }
  },

  evaluateAutomaticChainReactions() {
    const candidates = this.physicsWorld.consumeChainCandidates();
    if (candidates.length === 0) {
      return;
    }

    const minMatch = this.gameConfig.defaults.matchMinCount;
    let anyChainMatched = false;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (!this.physicsWorld.ballMap.has(candidate.id)) {
        continue;
      }
      const cluster = this.physicsWorld.findColorCluster(candidate);
      if (cluster.length >= minMatch && this.resolveColorMatchCluster(cluster, candidate, true) > 0) {
        anyChainMatched = true;
        for (let j = i + 1; j < candidates.length; j++) {
          if (this.physicsWorld.ballMap.has(candidates[j].id)) {
            this.physicsWorld.pendingChainCandidateIds.add(candidates[j].id);
          }
        }
        break;
      }
    }

    if (anyChainMatched) {
      this.noteVersusLink();
      this.detachAndRewardAvalanche();
      if (this.outOfShotsGraceFrames > 0 && this.physicsWorld.balls.length > 0) {
        this.outOfShotsGraceFrames = this.physicsConfig.simulation.outOfShotsGraceFrames;
      }
      this.evaluateRoundEnd();
      // Paid between shots, so stored now: the stored run would otherwise still hold the
      // candidates and pay this chain again after a reload.
      this.saveRunSnapshot();
      this.notifyUI();
    }
  },

  destroyClusterBall(
    ball,
    burstColor,
    ignoreArmor = false,
    burstCount = this.gameConfig.juice.matchBurstCount,
    burstSpeed = this.gameConfig.juice.matchBurstSpeed
  ) {
    if (!this.isRunPlaying() || !this.physicsWorld.ballMap.has(ball.id)) {
      return false;
    }

    const canvasCfg = this.gameConfig.canvas;

    if (ball.clusterModifier === CLUSTER_MODIFIERS.MAGNETAR) {
      // Immune to every strike, whatever ignores armor: only losing its Moorings brings it down.
      const magnetarSpec = this.ballsConfig.clusterModifiers.magnetar;
      this.particleSystem.spawnFloatingText(
        ball.x,
        ball.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.magnetar.immune'),
        magnetarSpec.highlight
      );
      return false;
    }

    if (!ignoreArmor && ball.clusterModifier === CLUSTER_MODIFIERS.ARMORED && ball.armorHits > 1) {
      ball.armorHits--;
      const armoredSpec = this.ballsConfig.clusterModifiers.armored;
      this.audioManager.playEffect('armorCrack');
      this.particleSystem.spawnBurst(
        ball.x,
        ball.y,
        armoredSpec.ringColor,
        armoredSpec.crackBurstCount,
        armoredSpec.crackBurstSpeed
      );
      this.particleSystem.spawnFloatingText(
        ball.x,
        ball.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.armor.cracked'),
        armoredSpec.ringColor
      );
      return false;
    }

    if (ball.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE && ball.armorHits > 1) {
      ball.armorHits--;
      const bossSpec = this.ballsConfig.clusterModifiers.bossCore;
      this.audioManager.playEffect('armorCrack');
      this.particleSystem.spawnBurst(
        ball.x,
        ball.y,
        bossSpec.ringColor,
        bossSpec.crackBurstCount,
        bossSpec.crackBurstSpeed
      );
      this.particleSystem.spawnShockwave(ball.x, ball.y, bossSpec.ringColor, bossSpec.crackShockwaveRadius);
      this.particleSystem.spawnFloatingText(
        ball.x,
        ball.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.boss.shield'),
        bossSpec.ringColor
      );
      return false;
    }

    const pCfg = this.gameConfig.juice.particles;
    let pushVx = 0;
    let pushVy = 0;
    if (this.detonationOrigin && this.detonationOrigin !== ball) {
      const dx = ball.x - this.detonationOrigin.x;
      const dy = ball.y - this.detonationOrigin.y;
      const dist = Math.hypot(dx, dy);
      if (dist > MATH_CONSTANTS.EPSILON) {
        const pushSpeed = pCfg.shatterPushSpeed || 0;
        pushVx = (dx / dist) * pushSpeed;
        pushVy = (dy / dist) * pushSpeed;
      }
    }
    this.particleSystem.spawnShatterBall?.(ball, burstColor, pushVx, pushVy);
    this.particleSystem.spawnBurst(ball.x, ball.y, burstColor, burstCount, burstSpeed);
    this.popBubblesAround(ball);
    this.physicsWorld.removeBall(ball);

    if (ball.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE) {
      this.rewardBossCore(ball);
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.COIN_CORE) {
      const reward = this.ballsConfig.clusterModifiers.coinCore.coinReward;
      this.awardRunCoins(reward);
      this.particleSystem.spawnFloatingText(
        ball.x,
        ball.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.coins.gain', { coins: reward }),
        this.gameConfig.theme.coinPopupColor
      );
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.DORMANT_BOMB) {
      const dormantSpecs = this.ballsConfig.clusterModifiers.dormantBomb;
      const prevOrigin = this.detonationOrigin;
      this.detonationOrigin = ball;
      const bombResult = this.specialController.triggerBomb(
        ball,
        dormantSpecs,
        this.physicsWorld,
        this.particleSystem,
        this.audioManager,
        this.getBlastRadiusMultiplier(),
        (target, color, ignArmor, count, speed) => this.destroyClusterBall(target, color, ignArmor, count, speed)
      );
      this.detonationOrigin = prevOrigin;
      if (bombResult.scoreDelta > 0) {
        this.addScore(bombResult.scoreDelta);
      }
      if (bombResult.destroyed.length > 0) {
        this.addOvercharge(bombResult.destroyed.length * this.gameConfig.scoring.overchargePerMatchedBall);
        this.triggerSpecialSlowMo(dormantSpecs.slowMoFrames, dormantSpecs.slowMoTimeScale, dormantSpecs.highlight);
      }
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.LASER_LOCK) {
      const lockSpec = this.ballsConfig.clusterModifiers.laserLock;
      this.addScore(lockSpec.pointsBonus);
      this.particleSystem.spawnShockwave(ball.x, ball.y, lockSpec.ringColor, lockSpec.shockwaveRadius);
      this.releaseBarriersWhenLocksCleared();
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.FREEZE_CORE) {
      this.triggerFreezeCore(ball);
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.LIGHTNING_CORE) {
      this.triggerLightningCore(ball);
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.PAINT_CORE) {
      const paintSpec = this.ballsConfig.clusterModifiers.paintCore;
      const paintResult = this.specialController.triggerPaint(ball, paintSpec, this.physicsWorld, this.particleSystem, this.audioManager, this.getBlastRadiusMultiplier());
      this.addScore(paintResult.scoreDelta);
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.RESCUE_CORE) {
      this.rewardRescueCore(ball);
    }

    return true;
  },

  rewardRescueCore(ball) {
    const rescueSpec = this.ballsConfig.clusterModifiers.rescueCore;
    this.rescuedCores++;
    this.awardRunCoins(rescueSpec.coinsReward);
    this.addScore(rescueSpec.pointsPerCore);
    this.particleSystem.spawnBurst(ball.x, ball.y, rescueSpec.highlight, rescueSpec.burstCount, rescueSpec.burstSpeed);
    this.particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.rescueCore.freed', {
        points: rescueSpec.pointsPerCore
      }),
      rescueSpec.highlight
    );
  },

  isObjectiveCleared() {
    if (this.currentObjective === OBJECTIVE_TYPES.CORE_RESCUE && this.targetCoreCount > 0) {
      return !this.physicsWorld.balls.some((b) => b.clusterModifier === CLUSTER_MODIFIERS.RESCUE_CORE);
    }
    return this.physicsWorld.balls.length === 0;
  },

  releaseRemainingBoardAsAvalanche() {
    const remaining = [...this.physicsWorld.balls];
    if (remaining.length === 0) {
      return;
    }
    const sim = this.physicsConfig.simulation;
    this.physicsWorld.balls.length = 0;
    for (const ball of remaining) {
      this.physicsWorld.releaseBall(ball);
      ball.isAnchor = false;
      ball.pivotRef = null;
      ball.isDropping = true;
      ball.vx += (this.random() - MATH_CONSTANTS.HALF) * sim.dropHorizontalSpread;
      ball.vy = Math.max(ball.vy, sim.dropMinVerticalSpeed);
      this.physicsWorld.droppingBalls.push(ball);
    }
    const dropPoints = remaining.length * this.gameConfig.scoring.droppedBallPoints;
    this.addScore(dropPoints);
  },

  /**
   * Frees every bubbled ball bonded to a ball that is about to leave the board: a group
   * going off next to a bubble bursts it, and the ball inside can then join groups.
   * @param {Ball} ball - The ball being destroyed, still bonded to its neighbors.
   */
  popBubblesAround(ball) {
    for (const neighborId of ball.bonds) {
      const neighbor = this.physicsWorld.ballMap.get(neighborId);
      if (neighbor && neighbor.clusterModifier === CLUSTER_MODIFIERS.BUBBLE) {
        this.popBubble(neighbor);
      }
    }
  },

  /** Bursts a bubble; the freed ball is queued for the delayed chain check. */
  popBubble(ball) {
    const bubbleSpec = this.ballsConfig.clusterModifiers.bubble;
    ball.clusterModifier = null;
    this.addScore(bubbleSpec.pointsBonus);
    this.particleSystem.spawnBurst(ball.x, ball.y, bubbleSpec.ringColor, bubbleSpec.popBurstCount, bubbleSpec.popBurstSpeed);
    this.physicsWorld.pendingChainCandidateIds.add(ball.id);
  },

  /**
   * A Freeze Core freezes the balls around it for a few turns. The turn it goes off does
   * not count down the freeze, like a Freeze shot.
   */
  triggerFreezeCore(ball) {
    const freezeSpec = this.ballsConfig.clusterModifiers.freezeCore;
    const result = this.specialController.triggerFreeze(
      ball,
      freezeSpec,
      this.physicsWorld,
      this.particleSystem,
      this.audioManager,
      this.getBlastRadiusMultiplier()
    );
    this.addScore(result.scoreDelta);
    this.freezeTurnsRemaining = Math.max(this.freezeTurnsRemaining, result.freezeTurns);
    this.isCoreFreezeApplied = true;
  },

  /** A Lightning Core strikes the horizontal band it sits in, like a Lightning shot. */
  triggerLightningCore(ball) {
    const lightningSpec = this.ballsConfig.clusterModifiers.lightningCore;
    const prevOrigin = this.detonationOrigin;
    this.detonationOrigin = ball;
    const result = this.specialController.triggerLightning(
      ball,
      lightningSpec,
      this.physicsWorld,
      this.particleSystem,
      this.audioManager,
      this.getBlastRadiusMultiplier(),
      (target, color, ignArmor, count, speed) => this.destroyClusterBall(target, color, ignArmor, count, speed)
    );
    this.detonationOrigin = prevOrigin;
    this.addScore(result.scoreDelta);
    if (result.destroyed.length > 0) {
      this.addOvercharge(result.destroyed.length * this.gameConfig.scoring.overchargePerMatchedBall);
      this.triggerSpecialSlowMo(lightningSpec.slowMoFrames, lightningSpec.slowMoTimeScale, lightningSpec.highlight);
    }
  },

  /**
   * Pays a Boss Core that left the board, destroyed or fallen in an avalanche: coins,
   * points and progress toward the bossSlayer achievement.
   * @param {Ball} ball - The Boss Core, at the position where it was lost.
   */
  rewardBossCore(ball) {
    const bossSpec = this.ballsConfig.clusterModifiers.bossCore;
    this.awardRunCoins(bossSpec.coinReward);
    this.addScore(bossSpec.pointsBonus);
    this.particleSystem.spawnExplosion?.(ball.x, ball.y, bossSpec.shockwaveRadius, bossSpec.ringColor);
    this.particleSystem.spawnFlash?.(ball.x, ball.y, bossSpec.ringColor, bossSpec.shockwaveRadius);
    this.particleSystem.spawnShockwave(ball.x, ball.y, bossSpec.ringColor, bossSpec.shockwaveRadius);
    this.triggerSpecialSlowMo(bossSpec.slowMoFrames, bossSpec.slowMoTimeScale, bossSpec.ringColor);
    this.particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.boss.destroyed', { coins: bossSpec.coinReward }),
      this.gameConfig.theme.bossPopupColor
    );
    this.bossesDestroyedInRun++;
    this.storageManager?.recordAchievementProgress?.({ bossesDestroyed: this.bossesDestroyedInRun });
    this.unlockAchievementTiers('bossSlayer', this.bossesDestroyedInRun);
  },

  /**
   * Turns the energy barriers off once no Lock Core is left on the board, whether the
   * last one was destroyed or fell in an avalanche. Boards that never had a Lock Core
   * keep their barriers: callers only invoke this after a Lock Core left the board.
   */
  releaseBarriersWhenLocksCleared() {
    const anyLockRemaining = this.physicsWorld.balls.some(
      (b) => b.clusterModifier === CLUSTER_MODIFIERS.LASER_LOCK
    );
    if (anyLockRemaining) {
      return;
    }
    const lockSpec = this.ballsConfig.clusterModifiers.laserLock;
    const canvasCfg = this.gameConfig.canvas;
    for (const obs of this.physicsWorld.obstacles) {
      if (obs.type === OBSTACLE_TYPES.BARRIER && !obs.disabled) {
        obs.disabled = true;
        this.particleSystem.spawnShockwave(obs.x, obs.y, lockSpec.ringColor, obs.width);
        this.particleSystem.spawnFloatingText(
          obs.x,
          obs.y + canvasCfg.floatingTextOffsetY,
          t('gameplay.feedback.lock.released'),
          this.gameConfig.theme.lockPopupColor
        );
      }
    }
  },

  handleProjectileSnapped(snappedBall, hitTarget = null) {
    this.audioManager.playEffect('snap');
    this.startImpactWave(snappedBall);
    this.particleSystem.addScreenShake(this.gameConfig.juice.snapShake, this.gameConfig.juice.maxShakeOffset);
    // A shot that lands on a bubble bursts it before the match is checked.
    if (
      !snappedBall.specialType &&
      hitTarget?.clusterModifier === CLUSTER_MODIFIERS.BUBBLE &&
      this.physicsWorld.ballMap.has(hitTarget.id)
    ) {
      this.popBubble(hitTarget);
    }

    if (snappedBall.specialType) {
      const prevOrigin = this.detonationOrigin;
      this.detonationOrigin = snappedBall;
      if (this.versus) {
        this.neutraliseChargesBySpecial(snappedBall.specialType, snappedBall.x, snappedBall.y);
      }
      const result = this.specialController.resolveSpecialImpact(
        snappedBall,
        this.physicsWorld,
        this.particleSystem,
        this.audioManager,
        this.getBlastRadiusMultiplier(),
        (target, color, ignoreArmor, count, speed) => this.destroyClusterBall(target, color, ignoreArmor, count, speed)
      );
      this.detonationOrigin = prevOrigin;
      if (result.scoreDelta > 0) {
        this.addScore(result.scoreDelta);
      }
      if (result.destroyed.length > 0) {
        this.addOvercharge(result.destroyed.length * this.gameConfig.scoring.overchargePerMatchedBall);
        this.hitStopFrames = this.isVersusRole ? 0 : this.gameConfig.juice.hitStopFramesSpecial;
        if (result.slowMoFrames > 0) {
          this.triggerSpecialSlowMo(result.slowMoFrames, result.slowMoTimeScale, result.slowMoColor);
        }
      }
      if (result.painted?.length > 0) {
        this.addOvercharge(result.painted.length * this.gameConfig.scoring.overchargePerDroppedBall);
      }
      if (result.freezeTurns > 0) {
        this.freezeTurnsRemaining = result.freezeTurns;
      }
      const madeProgress = result.destroyed.length > 0 || (result.painted?.length || 0) > 0;
      this.handlePostTurnCleanup(madeProgress, result.freezeTurns > 0);
      return;
    }

    const cluster = this.physicsWorld.findColorCluster(snappedBall);
    const minMatch = this.gameConfig.defaults.matchMinCount;

    if (cluster.length >= minMatch) {
      const destroyedCount = this.resolveColorMatchCluster(cluster, snappedBall, false);
      this.handlePostTurnCleanup(destroyedCount > 0);
    } else {
      this.combo = 0;
      this.handlePostTurnCleanup(false);
    }
  },

  /**
   * Sends a swelling wave through the cluster from the sphere that just landed, one bond
   * hop at a time and weaker at each hop. The wave only scales how spheres are drawn: their
   * positions, and so the game, are untouched. Reduced motion skips it.
   * @param {import('../entities/Ball.js').Ball} origin - The sphere that just landed.
   */
  startImpactWave(origin) {
    this.clearImpactWave();
    if (this.isReducedMotion) {
      return;
    }
    const maxHops = this.gameConfig.juice.impactWave.maxHops;
    const hops = new Map([[origin.id, 0]]);
    let frontier = [origin];
    for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
      const next = [];
      for (const ball of frontier) {
        for (const neighborId of ball.bonds) {
          const neighbor = this.physicsWorld.ballMap.get(neighborId);
          if (neighbor && !hops.has(neighborId)) {
            hops.set(neighborId, hop);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
    this.impactWave = { frame: 0, hops };
  },

  /** Advances the impact wave by one frame and sets each reached sphere's drawing scale. */
  updateImpactWave() {
    if (!this.impactWave) {
      return;
    }
    const waveCfg = this.gameConfig.juice.impactWave;
    const wave = this.impactWave;
    wave.frame += this.animationSpeed;
    if (wave.frame > waveCfg.maxHops * waveCfg.hopDelayFrames + waveCfg.durationFrames) {
      this.clearImpactWave();
      return;
    }
    for (const [ballId, hop] of wave.hops) {
      const ball = this.physicsWorld.ballMap.get(ballId);
      if (!ball) {
        continue;
      }
      const localFrame = wave.frame - hop * waveCfg.hopDelayFrames;
      const isSwelling = localFrame > 0 && localFrame < waveCfg.durationFrames;
      const envelope = isSwelling ? Math.sin((Math.PI * localFrame) / waveCfg.durationFrames) : 0;
      ball.impactScale = 1 + waveCfg.amplitude * Math.pow(waveCfg.hopFalloff, hop) * envelope;
    }
  },

  clearImpactWave() {
    if (!this.impactWave) {
      return;
    }
    for (const ballId of this.impactWave.hops.keys()) {
      const ball = this.physicsWorld.ballMap.get(ballId);
      if (ball) {
        ball.impactScale = 1;
      }
    }
    this.impactWave = null;
  },

  /** @returns {number} How many spheres the avalanche dropped. */
  detachAndRewardAvalanche() {
    if (!this.isRunPlaying()) {
      return 0;
    }
    const detached = this.physicsWorld.detachUnanchoredBalls();
    if (detached.length > 0) {
      const scoring = this.gameConfig.scoring;
      const juice = this.gameConfig.juice;
      this.noteVersusDrop(detached.length, detached[0].colorId);
      const funnelCfg = this.gameConfig.playerStats.funnel;
      if (!this.avalancheMilestoneStamped && !this.isVersusRole && !this.isRestoringRun
        && detached.length >= funnelCfg.avalancheMinDrops) {
        // Local first-avalanche milestone: written once per session, with the buffered play time.
        this.avalancheMilestoneStamped = true;
        const milestoneDelta = { playMs: this.pendingPlayMs, m: { avalanche: true } };
        this.pendingPlayMs = 0;
        this.storageManager.applyPlayerStatsDelta?.(milestoneDelta);
      }
      const dropPoints = detached.length * scoring.droppedBallPoints * Math.max(1, this.combo);
      this.addScore(dropPoints);
      this.addOvercharge(detached.length * scoring.overchargePerDroppedBall);

      let bonusCoins = detached.length * scoring.coinsPerAvalancheBall;
      for (const d of detached) {
        if (d.clusterModifier === CLUSTER_MODIFIERS.COIN_CORE) {
          bonusCoins += this.ballsConfig.clusterModifiers.coinCore.coinReward;
        }
      }
      this.awardRunCoins(bonusCoins);
      for (const d of detached) {
        if (d.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE) {
          this.rewardBossCore(d);
        } else if (d.clusterModifier === CLUSTER_MODIFIERS.MAGNETAR) {
          this.rewardMagnetarFall(d, detached.length - 1);
        } else if (d.clusterModifier === CLUSTER_MODIFIERS.RESCUE_CORE) {
          this.rewardRescueCore(d);
        }
      }
      if (detached.some((d) => d.clusterModifier === CLUSTER_MODIFIERS.LASER_LOCK)) {
        this.releaseBarriersWhenLocksCleared();
      }

      const sample = detached[0];
      this.particleSystem.spawnFloatingText(
        sample.x,
        sample.y,
        t('gameplay.feedback.drop.popup', { points: dropPoints }),
        this.gameConfig.theme.avalanchePopupColor
      );
      this.particleSystem.addScreenShake(juice.avalancheShake, juice.maxShakeOffset);

      this.storageManager?.recordAchievementProgress?.({ maxAvalanche: detached.length });
      this.unlockAchievementTiers('firstAvalanche', detached.length);
      reportBountyEvent(this, 'avalanche_balls', detached.length);

      if (this.mode === GAME_MODES.BLITZ) {
        const blitzCfg = this.gameConfig.blitz;
        const minSpheres = blitzCfg.avalancheTimeBonusMinSpheres;
        const bonusStep = blitzCfg.avalancheTimeBonusFrames;
        const maxBonus = blitzCfg.maxBonusDurationFrames;
        if (detached.length >= minSpheres && bonusStep > 0 && maxBonus > 0) {
          const earned = this.blitzBonusFramesEarned || 0;
          const granted = Math.min(bonusStep, Math.max(0, maxBonus - earned));
          if (granted > 0) {
            this.blitzFramesRemaining += granted;
            this.blitzBonusFramesEarned = earned + granted;
            const bonusSeconds = Math.max(1, Math.round(granted / blitzCfg.framesPerSecond));
            this.audioManager?.playEffect('blitzTimeBonus');
            this.particleSystem.spawnFloatingText(
              sample.x,
              sample.y + this.gameConfig.canvas.floatingTextOffsetY,
              t('gameplay.feedback.blitz.timeBonus', { seconds: bonusSeconds }),
              this.gameConfig.theme.wavePopupColor
            );
            this.notifyUI();
          }
        }
      }

      if (this.isSurvivalMode() && this.random() < scoring.specialDropChanceEndless) {
        this.grantRandomSpecialBall();
      }
    }
    this.crumbleLooseNeutralAnchors();
    return detached.length;
  },

  /**
   * A neutral anchor that no longer holds any ball crumbles away. Matches cannot break
   * it, so without this a board could never be cleared without a bomb or the anvil.
   */
  crumbleLooseNeutralAnchors() {
    const world = this.physicsWorld;
    const neutralSpec = this.ballsConfig.clusterModifiers.neutralAnchor;
    const loose = world.balls.filter(
      (ball) =>
        ball.clusterModifier === CLUSTER_MODIFIERS.NEUTRAL_ANCHOR &&
        ![...ball.bonds].some((id) => {
          // Rust holds nothing up for this rule: a neutral anchor holding only rust lets it fall.
          const neighbor = world.ballMap.get(id);
          // A Magnetar is no reason to stay either: it must be able to fall.
          return (
            neighbor &&
            !neighbor.isAnchor &&
            neighbor.clusterModifier !== CLUSTER_MODIFIERS.RUST &&
            neighbor.clusterModifier !== CLUSTER_MODIFIERS.MAGNETAR
          );
        })
    );
    for (const ball of loose) {
      this.particleSystem.spawnBurst(ball.x, ball.y, neutralSpec.ringColor, neutralSpec.crumbleBurstCount, neutralSpec.crumbleBurstSpeed);
      world.removeBall(ball);
    }
  },

  grantRandomSpecialBall() {
    const canvasCfg = this.gameConfig.canvas;
    const launcherSpec = this.getLauncherSpec();
    const types = Object.values(SPECIAL_TYPES).filter((type) => this.isSpecialTypeAllowed(type));
    if (types.length === 0) {
      return;
    }
    const granted = types[Math.floor(this.drawSeededRoll('special', this.specialGrantIndex++) * types.length)];
    const amount = this.gameConfig.scoring.specialChargePerMatch;
    this.specialInventory[granted] = (this.specialInventory[granted] || 0) + amount;
    this.audioManager.playEffect('overcharge');
    const specialName = t(`hud.powerups.${granted}.name`);
    this.particleSystem.spawnFloatingText(
      launcherSpec.x,
      launcherSpec.y + canvasCfg.launcherPopupOffsetY,
      t('gameplay.feedback.overcharge.ready', { name: specialName }),
      this.gameConfig.theme.overchargePopupColor
    );
  },

  shiftChameleonBalls() {
    if (this.activePalette.length < this.ballsConfig.clusterModifiers.chameleon.minPaletteSize) {
      return;
    }
    for (const ball of this.physicsWorld.balls) {
      if (ball.clusterModifier === CLUSTER_MODIFIERS.CHAMELEON) {
        const idx = this.activePalette.indexOf(ball.colorId);
        const nextIdx = (idx + 1) % this.activePalette.length;
        ball.colorId = this.activePalette[nextIdx];
      }
    }
  },

  addOvercharge(rawAmount) {
    if (!this.isRunPlaying()) {
      return;
    }
    const gained = rawAmount * this.getOverchargeMultiplier();
    if (this.turnResonant) {
      // What this turn earned, so a Resonant turn that matched or dropped can be topped up.
      this.turnOverchargeEarned += gained;
    }
    this.settleOvercharge(gained);
  },

  /** Adds Overcharge already scaled by the perks and pays out every full meter. */
  settleOvercharge(gained) {
    const max = this.getOverchargeCap();
    // A strike can clear the wave: later iterations still grant their special ball but
    // must not hit the next wave's boss.
    const startWave = this.bossRushWave;
    this.overcharge += gained;
    while (this.overcharge >= max) {
      this.overcharge -= max;
      if (this.versus) {
        // In a duel a full meter fires the field pulse at the other board.
        this.fireVersusPulse();
        continue;
      }
      this.grantRandomSpecialBall();
      reportBountyEvent(this, 'overcharge_full', 1);
      if (this.mode === GAME_MODES.BOSS_RUSH && this.bossRushWave === startWave) {
        const bossBall = this.physicsWorld.balls.find((b) => b.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE);
        if (this.magnetar) {
          this.snapMagnetarMooring();
        } else if (bossBall) {
          const bossSpec = this.ballsConfig.clusterModifiers.bossCore;
          const canvasCfg = this.gameConfig.canvas;
          this.particleSystem.spawnFloatingText(
            bossBall.x,
            bossBall.y - bossBall.radius + canvasCfg.floatingTextOffsetY,
            t('gameplay.feedback.bossRush.overchargeStrike'),
            this.gameConfig.theme.overchargePopupColor
          );
          const destroyed = this.destroyClusterBall(bossBall, bossSpec.ringColor, false);
          if (destroyed) {
            // Inside a physics step the next wave would clear the world under the loop
            // that called us: update() runs the round end once the step has returned.
            if (this.isSteppingPhysics) {
              this.pendingRoundEnd = true;
            } else {
              this.evaluateRoundEnd();
            }
          }
        }
      }
    }
  },

  /**
   * Applies one finished turn to the Sag meter and lowers the cluster when it fills up.
   * Pure function of the turn outcome: no random draw.
   * @param {{removed:boolean, dropped:number, frozen:boolean}} outcome
   */
  resolveSagTurn(outcome) {
    const spec = this.getSagSpecCached();
    if (!spec) {
      return;
    }
    const result = applyTurn({ level: this.sagLevel ?? 0 }, outcome, spec);
    this.sagLevel = result.level;
    const canvasCfg = this.gameConfig.canvas;
    if (result.drained > 0) {
      this.particleSystem.spawnFloatingText(
        canvasCfg.launcherX,
        canvasCfg.launcherY + canvasCfg.launcherPopupOffsetY,
        t('gameplay.feedback.sag.drained', { amount: result.drained }),
        this.gameConfig.theme.overchargePopupColor
      );
    }
    if (result.lowered) {
      const isRail = spec.step === SAG_STEPS.RAIL;
      // A board emptied by this very turn is about to be paid as a cleared stage: the rail
      // does not drop on it.
      if (isRail && this.physicsWorld.balls.length === 0 && !this.physicsWorld.projectile) {
        return;
      }
      if (isRail) {
        this.lowerAnchorRail();
      } else {
        this.spawnEndlessWave();
        // A wave on a cleared board brings colors back that the first refresh could not
        // compare against. On a non-empty board the wave only adds balls, so every launcher
        // color is still present and this second pass draws nothing from the seeded random.
        this.refreshStaleLauncherColors();
      }
      // The step may have ended the run (rail past the danger line): no creak, shake or
      // text on the end screen, and the cluster stays where it really is.
      if (!this.isRunPlaying()) {
        this.railLowerFrames = 0;
        return;
      }
      this.railLowerFrames = this.gameConfig.sag?.lowerFrames ?? 0;
      this.audioManager.playEffect?.('creak');
      const shake = this.gameConfig.sag?.lowerShake;
      if (shake) {
        this.particleSystem.addScreenShake(shake, this.gameConfig.juice.maxShakeOffset);
      }
      if (this.gameConfig.sag) {
        this.particleSystem.spawnFloatingText(
          canvasCfg.logicalWidth * MATH_CONSTANTS.HALF,
          this.gameConfig.endless.startY + canvasCfg.wavePopupOffsetY,
          t(isRail ? 'gameplay.feedback.sag.lowered' : 'gameplay.feedback.sag.dropped'),
          this.gameConfig.theme.wavePopupColor
        );
      }
    } else if (result.warned) {
      this.audioManager.playEffect?.('sagWarn');
    }
  },

  handlePostTurnCleanup(madeMatch, appliedFreeze = false) {
    const dropped = this.detachAndRewardAvalanche();
    this.settleTurnResonance(madeMatch || dropped > 0);
    this.shiftChameleonBalls();
    // A Freeze Core that went off during this turn (the shot or its avalanche) counts as a
    // freeze applied this turn. Read after the avalanche so a core it sets off is consumed here.
    const freezeAppliedThisTurn = appliedFreeze || this.isCoreFreezeApplied;
    this.isCoreFreezeApplied = false;

    this.refreshStaleLauncherColors();

    const wasFrozen = this.freezeTurnsRemaining > 0 || freezeAppliedThisTurn;
    if (!freezeAppliedThisTurn && this.freezeTurnsRemaining > 0) {
      this.freezeTurnsRemaining--;
      if (this.freezeTurnsRemaining === 0) {
        for (const b of this.physicsWorld.balls) {
          b.isFrozen = false;
        }
      }
    }

    if (this.isSurvivalMode() || this.mode === GAME_MODES.CLASSIC) {
      this.resolveSagTurn({ removed: madeMatch, dropped, frozen: wasFrozen });
    } else if (this.mode === GAME_MODES.CASCADE && !wasFrozen) {
      this.cascadeTurnsUntilDrop--;
      if (this.cascadeTurnsUntilDrop <= 0) {
        this.cascadeWave++;
        this.waveCount = this.cascadeWave;
        this.spawnCascadeDropWave(0);
        this.refreshStaleLauncherColors();
        this.cascadeTurnsUntilDrop = this.gameConfig.cascade.shotsBeforeDrop;
        this.particleSystem.spawnFloatingText(
          this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
          this.gameConfig.cascade.startY + this.gameConfig.canvas.wavePopupOffsetY,
          t('gameplay.feedback.wave.incoming'),
          this.gameConfig.theme.wavePopupColor
        );
      }
    }

    this.advanceMagnetarTurn();
    this.getModeBehavior().onTurnCleanedUp?.(this, { madeMatch, dropped, wasFrozen });
    this.evaluateRoundEnd();
    this.updateAimFromAngle(this.aimAngle);
    if (madeMatch) {
      this.recordDiscoveryInteraction(DISCOVERY_INTERACTIONS.MATCH);
    }
    this.isHintShownThisTurn = false;
    this.countDiscoveryTurn();
    this.refreshDiscovery();
    this.saveRunSnapshot();
    this.notifyUI();
  },
};
