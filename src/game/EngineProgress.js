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

import { GAME_MODES, GAME_STATES, MATH_CONSTANTS } from '../core/Constants.js';
import { t } from '../core/I18n.js';
import { getUtcIsoWeekKey, getWeeklyFluxSeed } from './WeeklyFlux.js';
import { buildRunOutcomeDelta } from './PlayerStats.js';
import { createShotTimeline, appendTimelineSample, markTimelineComplete } from './ShotTimeline.js';

const OUTCOME_LOSS = 'loss';
const OUTCOME_QUIT = 'quit';

/** Run progress methods installed on GameEngine: local stats, weekly Flux and shot timelines. */
export const engineProgressMethods = {
  /**
   * Counts the finished run once (win, loss or quit) and flushes the buffered shots and
   * play time with it. Later calls for the same run are ignored.
   * @param {'win'|'loss'|'quit'} outcome - How the run ended.
   */
  recordRunOutcome(outcome) {
    if (this.runOutcomeRecorded) {
      return;
    }
    const run = {
      mode: this.mode,
      levelId: this.mode === GAME_MODES.CAMPAIGN ? this.currentLevelId : null,
      outcome
    };
    const delta = buildRunOutcomeDelta(run, 1);
    if (!delta) {
      return;
    }
    this.runOutcomeRecorded = true;
    this.lastRunOutcome = run;
    delta.shots = this.pendingShots;
    delta.playMs = this.pendingPlayMs;
    this.pendingShots = 0;
    this.pendingPlayMs = 0;
    this.storageManager.applyPlayerStatsDelta?.(delta);
  },

  /** Undoes the loss counted at game over when the player continues the run. */
  retractRunOutcome() {
    const run = this.lastRunOutcome;
    if (!this.runOutcomeRecorded || !run || run.outcome !== OUTCOME_LOSS) {
      return;
    }
    const delta = buildRunOutcomeDelta(run, -1);
    if (delta) {
      this.storageManager.applyPlayerStatsDelta?.(delta);
    }
    this.runOutcomeRecorded = false;
    this.lastRunOutcome = null;
    // The run is live again: its timeline is no longer a finished one.
    if (this.shotTimeline) {
      this.shotTimeline = { ...this.shotTimeline, c: 0 };
    }
  },

  /** Counts the outgoing run as left when it was started, played and never finished. */
  recordAbandonedRun() {
    const isLive = this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.PAUSED;
    const hasFired = this.hasFiredInRound || this.runShotsFired > 0;
    if (this.isRestoringRun || this.runOutcomeRecorded || !isLive || !hasFired) {
      return;
    }
    this.recordRunOutcome(OUTCOME_QUIT);
  },

  countShotForStats() {
    this.runShotsFired += 1;
    this.pendingShots += 1;
    if (this.pendingShots >= this.gameConfig.playerStats.flushEveryShots) {
      this.flushPlayerStats();
    }
  },

  /**
   * @param {number} ms - Play time to add (one fixed simulation step per update).
   */
  countPlayTimeForStats(ms) {
    this.pendingPlayMs += ms;
    if (this.pendingPlayMs >= this.gameConfig.playerStats.flushEveryPlayMs) {
      this.flushPlayerStats();
    }
  },

  /** Writes the buffered shots and play time to storage. */
  flushPlayerStats() {
    if (this.pendingShots <= 0 && this.pendingPlayMs <= 0) {
      return;
    }
    const delta = { shots: this.pendingShots, playMs: this.pendingPlayMs };
    this.pendingShots = 0;
    this.pendingPlayMs = 0;
    this.storageManager.applyPlayerStatsDelta?.(delta);
  },

  /**
   * Marks the run just built as the weekly Flux run when its seed is this week's seed.
   * A weekly run is a shared run: tilt locked, Workshop kept, assists shown in the share text.
   * @param {string} seed - Flux seed of the run.
   * @param {string} [weekKey] - Week to compare with (this week by default).
   * @returns {boolean} True when the run is the weekly one.
   */
  detectWeeklyFlux(seed, weekKey = getUtcIsoWeekKey(Date.now())) {
    const weeklyCfg = this.gameConfig.weeklyFlux;
    const isWeekly = Boolean(seed)
      && seed === getWeeklyFluxSeed(weekKey, this.fluxConfig.seed, weeklyCfg.seedSalt);
    this.isWeeklyFluxRun = isWeekly;
    this.weeklyWeekKey = isWeekly ? weekKey : null;
    if (isWeekly) {
      this.isSharedFluxRun = true;
    }
    // The record to beat differs for a weekly run: measure it again.
    this.runBestBaseline = null;
    return isWeekly;
  },

  /**
   * Starts the Flux run of this week. The one-time weekly bonus is paid by startFluxRun, so
   * every way of starting this week's seed pays the same way.
   * @param {{isRestart?: boolean}} [options] - A restart keeps the running week and never pays.
   */
  startWeeklyFlux({ isRestart = false } = {}) {
    const weeklyCfg = this.gameConfig.weeklyFlux;
    const weekKey = isRestart && this.weeklyWeekKey ? this.weeklyWeekKey : getUtcIsoWeekKey(Date.now());
    const seed = getWeeklyFluxSeed(weekKey, this.fluxConfig.seed, weeklyCfg.seedSalt);
    this.startFluxRun(seed, { isShared: true, weekKey, isRestart });
  },

  /**
   * Pays the once-per-week bonus of the first start of this week's Flux seed, with a floating text.
   * @param {string} weekKey - Week of the run just started.
   * @returns {boolean} True when the bonus was paid now.
   */
  payWeeklyFluxBonus(weekKey) {
    const bonusCoins = this.gameConfig.weeklyFlux?.firstPlayBonusCoins;
    if (!(bonusCoins > 0) || !this.storageManager.claimWeeklyFluxBonus?.(weekKey, bonusCoins)) {
      return false;
    }
    this.audioManager.playEffect('achievement');
    this.particleSystem.spawnFloatingText(
      this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      this.gameConfig.canvas.launcherY + this.gameConfig.canvas.launcherPopupOffsetY,
      t('gameplay.feedback.weeklyBonus.claimed', { coins: bonusCoins }),
      this.gameConfig.theme.coinPopupColor
    );
    return true;
  },

  /**
   * Records the state after the previous shot (Daily and weekly Flux runs only).
   * @param {boolean} [isFinal] - True at game over: the timeline is then complete.
   */
  sampleShotTimeline(isFinal = false) {
    const isDaily = this.mode === GAME_MODES.DAILY;
    if (!isDaily && !this.isWeeklyFluxRun) {
      return;
    }
    const cfg = this.gameConfig.shotTimeline;
    if (!this.shotTimeline) {
      this.shotTimeline = createShotTimeline(isDaily ? GAME_MODES.DAILY : GAME_MODES.FLUX, cfg);
    }
    appendTimelineSample(this.shotTimeline, this.score, this.physicsWorld.balls.length, cfg);
    if (isFinal) {
      this.shotTimeline = markTimelineComplete(this.shotTimeline);
    }
  }
};
