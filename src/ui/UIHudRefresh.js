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

import { GAME_MODES, GAME_STATES, OBJECTIVE_TYPES } from '../core/Constants.js';
import { t, formatNumber } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { resolveHintText } from '../game/Discovery.js';
import { SAG_PHASES } from '../game/SagMeter.js';
import { getUtcIsoWeekKey } from '../game/WeeklyFlux.js';
import { FULL_PERCENT } from './WorkshopView.js';
import { syncFluxPerkModal } from './FluxPerkView.js';
import {
  MODE_BUTTON_KEYS,
  MODE_NAME_KEYS,
  MODE_LOCK_BUTTON_KEYS,
  isCurrentWeeklyRun,
  ARCADE_CARD_SPECS,
  MODE_LOCKED_CLASS,
  MODE_NEW_CLASS,
  describeModeLock,
  setModeLabel,
  formatUnlockedModesText,
  formatUnlockedModeNames,
  splitRefreshExtra,
  formatNearMissText,
  formatBestRunMarker,
  formatStreakGraceText,
  gameOverReasonKey,
  revealLiveRegion,
  scheduleNextFrame,
  setTextIfChanged,
  setAttributeIfChanged
} from './UIHelpers.js';

/** Sag phases (see SagMeter.getSagPhase) and the HUD meter class each one sets. */
const SAG_METER_CLASS_BY_PHASE = Object.freeze({
  [SAG_PHASES.WARN]: 'warning',
  [SAG_PHASES.FULL]: 'critical'
});

/** Methods installed on UIManager.prototype by UIManager.js. */
export const uiHudRefreshMethods = {
  /**
   * Shows the Sag box: label, level/size value, the segmented meter and its accessible
   * value text. Speaks the warning once per cycle and every lowering.
   * @param {object} engine - Game engine.
   * @param {{level:number, size:number, phase:string}} sag - Engine sag state.
   */
  refreshSagMeter(engine, sag) {
    const meter = this.elements.sagMeter;
    if (this.elements.shotsLabel) {
      setTextIfChanged(this.elements.shotsLabel, t('hud.stats.sag.label'));
    }
    setTextIfChanged(
      this.elements.shotsValue,
      t('hud.stats.sag.value', { level: formatNumber(sag.level), size: formatNumber(sag.size) })
    );
    this.elements.shotsValue.classList.toggle('warning', sag.phase !== SAG_PHASES.CALM);
    if (meter) {
      const remaining = Math.max(0, sag.size - sag.level);
      setAttributeIfChanged(meter, 'aria-valuemax', String(sag.size));
      setAttributeIfChanged(meter, 'aria-valuenow', String(sag.level));
      setAttributeIfChanged(
        meter,
        'aria-valuetext',
        t(remaining === 1 ? 'hud.stats.sag.ariaOne' : 'hud.stats.sag.aria', {
          level: formatNumber(sag.level),
          size: formatNumber(sag.size),
          remaining: formatNumber(remaining)
        })
      );
      meter.style.setProperty('--sag-size', String(sag.size));
      meter.style.setProperty('--sag-level', String(sag.level));
      for (const [phase, className] of Object.entries(SAG_METER_CLASS_BY_PHASE)) {
        meter.classList.toggle(className, sag.phase === phase);
      }
      meter.classList.remove('hidden');
    }
    this.announceSagChanges(engine, sag);
  },

  /** Hides the meter and forgets what the announcer saw, outside the Sag modes. */
  hideSagMeter() {
    this.elements.sagMeter?.classList.add('hidden');
    this.sagAnnouncerState = null;
  },

  /**
   * Polite announcements: the warning once per cycle (a cycle ends when the cluster drops
   * or the meter empties), and every lowering. The first refresh of a run only records.
   */
  announceSagChanges(engine, sag) {
    const lowerKey = engine.mode === GAME_MODES.CLASSIC ? engine.classicRailDropsTotal : engine.waveCount;
    const seen = this.sagAnnouncerState;
    this.sagAnnouncerState = {
      mode: engine.mode,
      lowerKey,
      phase: sag.phase,
      warned: seen && seen.mode === engine.mode ? seen.warned : false
    };
    if (!seen || seen.mode !== engine.mode) {
      this.sagAnnouncerState.warned = sag.phase === SAG_PHASES.WARN;
      return;
    }
    if (lowerKey > seen.lowerKey) {
      this.sagAnnouncerState.warned = false;
      this.announce(t('gameplay.feedback.sag.lowered'));
      return;
    }
    if (sag.level === 0) {
      this.sagAnnouncerState.warned = false;
    }
    if (sag.phase === SAG_PHASES.WARN && !this.sagAnnouncerState.warned) {
      this.sagAnnouncerState.warned = true;
      this.announce(t('gameplay.feedback.sag.warning'));
    }
  },

  refresh(engine, extra = {}) {
    // One-shot extras (an unlocked achievement, a cleared Flux stage) must not replay
    // when refresh is re-run with lastExtra (language change, input mode change, shop
    // purchase): they are read from this call only.
    const { oneShot: { unlockedAchievementIds, fluxStageCleared, classicStageCleared, fluxPerkChosen }, persistentExtra } =
      splitRefreshExtra(extra);
    this.lastExtra = persistentExtra;
    setTextIfChanged(this.elements.scoreValue, formatNumber(engine.score));
    setTextIfChanged(
      this.elements.coinsValue,
      t('hud.stats.coins.value', { coins: formatNumber(this.storageManager.getCoins()) })
    );

    const affordableCount = this.getAffordableUpgradeCount();
    setTextIfChanged(
      this.elements.btnShop,
      affordableCount > 0
        ? t('app.nav.button.shopBadge', { count: formatNumber(affordableCount) })
        : t('app.nav.button.shop')
    );
    this.elements.btnShop.classList.toggle('has-affordable', affordableCount > 0);

    // Only the mode being played stands out, and says so to screen readers.
    for (const [mode, elementKeys] of Object.entries(MODE_BUTTON_KEYS)) {
      const isActive = engine.mode === mode;
      for (const elementKey of elementKeys) {
        const button = this.elements[elementKey];
        if (button) {
          button.classList.toggle('active-mode', isActive);
          if (isActive) {
            setAttributeIfChanged(button, 'aria-current', 'true');
          } else {
            button.removeAttribute('aria-current');
          }
        }
      }
    }
    // A Weekly Flux run highlights its own button, not the plain Flux one.
    const isWeeklyRun = engine.mode === GAME_MODES.FLUX && engine.isWeeklyFluxRun === true;
    // Only the run of the current week lights the Weekly button: a run of last week, still
    // open after Monday 00:00 UTC, is plain Flux for the menu.
    const isCurrentWeekRun = isCurrentWeeklyRun(engine, getUtcIsoWeekKey(Date.now()));
    for (const [elementKey, isActive] of [
      ['btnFlux', engine.mode === GAME_MODES.FLUX && !isCurrentWeekRun],
      ['btnWeekly', isCurrentWeekRun]
    ]) {
      const button = this.elements[elementKey];
      if (button) {
        button.classList.toggle('active-mode', isActive);
        if (isActive) {
          setAttributeIfChanged(button, 'aria-current', 'true');
        } else {
          button.removeAttribute('aria-current');
        }
      }
    }
    this.refreshModeLocks(this.getModeAccess());
    if (this.elements.btnDaily) {
      const todayKey = SeededRandom.getTodayDateKey();
      const dailyBonusCoins = this.gameConfig.daily?.firstPlayBonusCoins || 0;
      const streak = this.storageManager.getDailyStreak?.(todayKey) || 0;
      let dailyLabel = t('app.nav.button.daily');
      if (this.storageManager.hasPlayedDailyToday(todayKey)) {
        // Today's challenge is done: say so rather than fall back to the plain label.
        dailyLabel = streak > 1
          ? t('app.nav.button.dailyPlayedStreakBadge', { streak: formatNumber(streak) })
          : t('app.nav.button.dailyPlayedBadge');
      } else if (dailyBonusCoins > 0) {
        dailyLabel = t('app.nav.button.dailyBonusBadge', { coins: formatNumber(dailyBonusCoins) });
      }
      setTextIfChanged(this.elements.btnDaily, dailyLabel);
      const graceHint = formatStreakGraceText(streak, this.storageManager.getDailyStreakGrace?.(todayKey), todayKey);
      if (graceHint) {
        setAttributeIfChanged(this.elements.btnDaily, 'title', graceHint);
      } else {
        this.elements.btnDaily.removeAttribute?.('title');
      }
    }

    const overchargePct = Math.min(
      FULL_PERCENT,
      Math.round((engine.overcharge / this.gameConfig.scoring.overchargeMax) * FULL_PERCENT)
    );
    setTextIfChanged(this.elements.overchargePct, t('hud.stats.overcharge.pct', { pct: overchargePct }));
    this.elements.overchargeFill.style.width = `${overchargePct}%`;

    let bestScore;
    if (engine.mode === GAME_MODES.CAMPAIGN) {
      bestScore = this.storageManager.getLevelStats()[engine.currentLevelId]?.bestScore || 0;
    } else if (engine.mode === GAME_MODES.DAILY) {
      bestScore = this.storageManager.getDailyHighScore(engine.dailySeedKey || SeededRandom.getTodayDateKey());
    } else if (engine.mode === GAME_MODES.FLUX) {
      // A Weekly Flux run is measured against this week's best, not the all-time Flux record.
      bestScore = isWeeklyRun
        ? this.getWeeklyFluxBestScore(engine.weeklyWeekKey)
        : this.storageManager.getFluxHighScore();
    } else if (engine.mode === GAME_MODES.PUZZLE) {
      bestScore = this.storageManager.getPuzzleHighScore();
    } else if (engine.mode === GAME_MODES.BLITZ) {
      bestScore = this.storageManager.getBlitzHighScore();
    } else if (engine.mode === GAME_MODES.BOSS_RUSH) {
      bestScore = this.storageManager.getBossRushHighScore();
    } else if (engine.mode === GAME_MODES.CASCADE) {
      bestScore = this.storageManager.getCascadeHighScore();
    } else if (engine.mode === GAME_MODES.CLASSIC) {
      bestScore = this.storageManager.getClassicHighScore();
    } else {
      bestScore = this.storageManager.getEndlessHighScore();
    }

    setTextIfChanged(this.elements.highScoreValue, formatNumber(Math.max(bestScore, engine.score)));

    if (this.elements.polarityBtn) {
      const polState = engine.isPolarityFlipped ? 'inverted' : 'normal';
      this.setLauncherButton(
        this.elements.polarityBtn,
        'hud.launcher.polarity.icon',
        `hud.launcher.polarity.${polState}`,
        'hud.launcher.polarity.shortcut',
        `hud.launcher.polarity.caption.${polState}`
      );
      this.elements.polarityBtn.classList.toggle('active', Boolean(engine.isPolarityFlipped));
    }

    if (this.elements.swapBtn) {
      const isSwapLocked = engine.mode === GAME_MODES.PUZZLE && engine.shotsRemaining <= 1;
      this.elements.swapBtn.disabled = isSwapLocked;
    }

    const warningShotsThreshold = this.gameConfig.canvas.survivalWaveWarningThreshold;

    const coreRescueSuffix =
      engine.currentObjective === OBJECTIVE_TYPES.CORE_RESCUE && engine.targetCoreCount > 0
        ? ` • ${t('hud.stats.mode.coreRescueProgress', {
            rescued: formatNumber(Math.min(engine.targetCoreCount, engine.rescuedCores || 0)),
            total: formatNumber(engine.targetCoreCount)
          })}`
        : '';

    if (engine.mode === GAME_MODES.CAMPAIGN) {
      const lvl = engine.levelCatalog.summarize(engine.currentLevelId);
      setTextIfChanged(
        this.elements.modeBanner,
        `${t('hud.stats.mode.campaign', {
          level: engine.currentLevelId,
          name: lvl ? this.formatLevelName(lvl) : ''
        })}${coreRescueSuffix}`
      );
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.shots.label'));
      }
      setTextIfChanged(this.elements.shotsValue, formatNumber(engine.shotsRemaining));
      this.elements.shotsValue.classList.toggle(
        'warning',
        engine.shotsRemaining <= warningShotsThreshold
      );

      if (this.elements.starProgress) {
        const thresholds = engine.getStarThresholds();
        const maxStars = this.gameConfig.scoring.maxStars;
        const currentStars = engine.computeStars(engine.score);
        const nextThreshold = thresholds.find((th) => th > engine.score);
        this.updateStarMeter(engine.score, thresholds, nextThreshold);
        // Two unbreakable parts, so a narrow HUD wraps between them and never inside one.
        this.renderStarGlyphs(this.elements.starGlyphs, currentStars, maxStars);
        // The glyphs are hidden from screen readers; this hidden text states the count.
        setTextIfChanged(
          this.elements.starCount,
          t('hud.stats.score.starsAria', {
            stars: formatNumber(Math.max(0, Math.min(maxStars, currentStars))),
            maxStars: formatNumber(maxStars)
          })
        );
        setTextIfChanged(
          this.elements.starNext,
          nextThreshold !== undefined
            ? t('hud.stats.score.nextThreshold', { next: formatNumber(nextThreshold) })
            : t('hud.stats.score.maxReached')
        );
        this.elements.starProgress.classList.remove('hidden');
      }
    } else if (engine.mode === GAME_MODES.PUZZLE) {
      setTextIfChanged(
        this.elements.modeBanner,
        `${t('hud.stats.mode.puzzle', {
          stage: engine.currentPuzzleStage,
          total: this.gameConfig.puzzles?.length || 1
        })}${coreRescueSuffix}`
      );
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.shots.label'));
      }
      setTextIfChanged(this.elements.shotsValue, formatNumber(engine.shotsRemaining));
      this.elements.shotsValue.classList.toggle('warning', engine.shotsRemaining <= warningShotsThreshold);
      if (this.elements.starProgress) {
        const thresholds = engine.getStarThresholds();
        const maxStars = this.gameConfig.scoring.maxStars;
        const currentStars = engine.computeStars(engine.score);
        const nextThreshold = thresholds.find((th) => th > engine.score);
        this.updateStarMeter(engine.score, thresholds, nextThreshold);
        this.renderStarGlyphs(this.elements.starGlyphs, currentStars, maxStars);
        setTextIfChanged(
          this.elements.starCount,
          t('hud.stats.score.starsAria', {
            stars: formatNumber(Math.max(0, Math.min(maxStars, currentStars))),
            maxStars: formatNumber(maxStars)
          })
        );
        setTextIfChanged(
          this.elements.starNext,
          nextThreshold !== undefined
            ? t('hud.stats.score.nextThreshold', { next: formatNumber(nextThreshold) })
            : t('hud.stats.score.maxReached')
        );
        this.elements.starProgress.classList.remove('hidden');
      }
    } else if (engine.mode === GAME_MODES.BLITZ) {
      const fps = this.gameConfig.blitz.framesPerSecond;
      const secondsLeft = Math.max(0, Math.ceil(engine.blitzFramesRemaining / fps));
      setTextIfChanged(
        this.elements.modeBanner,
        t('hud.stats.mode.blitz', { wave: formatNumber(engine.waveCount) })
      );
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.time.label'));
      }
      setTextIfChanged(this.elements.shotsValue, t('hud.stats.time.seconds', { seconds: formatNumber(secondsLeft) }));
      this.elements.shotsValue.classList.toggle(
        'warning',
        secondsLeft <= this.gameConfig.blitz.warningSeconds
      );
      if (this.elements.starProgress) {
        this.elements.starProgress.classList.add('hidden');
      }
    } else if (engine.mode === GAME_MODES.FLUX) {
      setTextIfChanged(
        this.elements.modeBanner,
        t(engine.fluxIsBossStage ? 'hud.stats.mode.fluxBoss' : 'hud.stats.mode.flux', {
          stage: engine.fluxStage,
          shape: this.formatFluxShapeName(engine.fluxShapeIds)
        })
      );
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.shots.label'));
      }
      setTextIfChanged(this.elements.shotsValue, formatNumber(engine.shotsRemaining));
      this.elements.shotsValue.classList.toggle('warning', engine.shotsRemaining <= warningShotsThreshold);
      if (this.elements.starProgress) {
        this.elements.starProgress.classList.add('hidden');
      }
    } else {
      if (engine.mode === GAME_MODES.DAILY) {
        const mutatorLabel = engine.activeMutatorKey
          ? t(`gameplay.mutators.${engine.activeMutatorKey}`)
          : '';
        setTextIfChanged(
          this.elements.modeBanner,
          t('hud.stats.mode.daily', {
            mutator: mutatorLabel,
            wave: engine.waveCount
          })
        );
      } else if (engine.mode === GAME_MODES.BOSS_RUSH) {
        const shields = engine.getBossBall()?.armorHits || 0;
        setTextIfChanged(
          this.elements.modeBanner,
          t('hud.stats.mode.bossRush', {
            wave: engine.bossRushWave,
            shields: formatNumber(shields)
          })
        );
      } else if (engine.mode === GAME_MODES.CASCADE) {
        setTextIfChanged(
          this.elements.modeBanner,
          t('hud.stats.mode.cascade', {
            wave: engine.waveCount
          })
        );
      } else if (engine.mode === GAME_MODES.CLASSIC) {
        setTextIfChanged(
          this.elements.modeBanner,
          t('hud.stats.mode.classic', {
            stage: formatNumber(engine.classicStage)
          })
        );
      } else {
        setTextIfChanged(
          this.elements.modeBanner,
          t('hud.stats.mode.endless', {
            wave: engine.waveCount
          })
        );
      }
      const sag = engine.getSagState?.();
      if (sag?.active) {
        this.refreshSagMeter(engine, sag);
      } else {
        if (this.elements.shotsLabel) {
          const shotsLabelKey = engine.mode === GAME_MODES.BOSS_RUSH
            ? 'hud.stats.shots.shieldsLabel'
            : 'hud.stats.shots.waveLabel';
          setTextIfChanged(this.elements.shotsLabel, t(shotsLabelKey));
        }
        const waveCountdown =
          engine.mode === GAME_MODES.CASCADE
            ? engine.cascadeTurnsUntilDrop
            : engine.mode === GAME_MODES.BOSS_RUSH
              ? engine.getBossBall()?.armorHits || 0
              : 0;
        setTextIfChanged(this.elements.shotsValue, formatNumber(waveCountdown));
        this.elements.shotsValue.classList.toggle(
          'warning',
          waveCountdown <= warningShotsThreshold
        );
      }
      if (this.elements.starProgress) {
        this.elements.starProgress.classList.add('hidden');
      }
    }

    if (!engine.getSagState?.().active) {
      this.hideSagMeter();
    }

    if (this.elements.modeBanner) {
      setAttributeIfChanged(
        this.elements.modeBanner,
        'aria-label',
        `${this.elements.modeBanner.textContent} (${t('hud.stats.mode.switchHint')})`
      );
    }

    if (engine.combo > 1) {
      setTextIfChanged(this.elements.comboBadge, t('hud.stats.combo.label', { count: engine.combo }));
      this.elements.comboBadge.classList.remove('hidden');
    } else {
      this.elements.comboBadge.classList.add('hidden');
    }

    if (engine.freezeTurnsRemaining > 0) {
      setTextIfChanged(
        this.elements.frozenBadge,
        t('hud.stats.frozen.label', { turns: engine.freezeTurnsRemaining })
      );
      this.elements.frozenBadge.classList.remove('hidden');
    } else {
      this.elements.frozenBadge.classList.add('hidden');
    }

    // Both banners are polite live regions: rewriting identical text on every
    // engine event would make screen readers repeat them.
    if (this.elements.tutorialBanner) {
      const hintText = engine.activeDiscoveryId
        ? resolveHintText(engine.activeDiscoveryId, this.gameConfig.onboarding, this.ballsConfig, t, this.inputMode)
        : '';
      if (hintText && engine.state === GAME_STATES.PLAYING) {
        revealLiveRegion({
          region: this.elements.tutorialBanner,
          textElement: this.elements.tutorialBannerText,
          text: hintText,
          schedule: scheduleNextFrame
        });
      } else {
        this.elements.tutorialBanner.classList.add('hidden');
      }
    }

    if (this.elements.specialEquippedBanner) {
      const equippedType = engine.currentBall?.specialType;
      if (equippedType && engine.state === GAME_STATES.PLAYING) {
        const spec = this.ballsConfig.specialTypes[equippedType];
        revealLiveRegion({
          region: this.elements.specialEquippedBanner,
          textElement: this.elements.specialEquippedBanner,
          text: t('hud.launcher.specialEquipped.hint', {
            icon: spec?.icon || '',
            name: t(`hud.powerups.${equippedType}.name`),
            desc: t(`hud.powerups.${equippedType}.tooltip`),
            unequip: t(`hud.launcher.specialEquipped.unequip.${this.getHintInputMode('hud.launcher.specialEquipped.unequip')}`)
          }),
          schedule: scheduleNextFrame
        });
      } else {
        this.elements.specialEquippedBanner.classList.add('hidden');
      }
    }

    this.updateDiscoveryPulse(engine);
    this.updateHintReplayButton(engine);
    this.updateLevelIntro(engine);

    this.updateAimState(engine);

    // A level that hands out no special ball shows no empty slots to a new player.
    const offersSpecialBalls = engine.offersSpecialBalls();
    this.elements.powerupsContainer.classList.toggle('hidden', !offersSpecialBalls);
    this.elements.powerupsHeader?.classList.toggle('hidden', !offersSpecialBalls);
    // The panel keeps its place in the layout, so it says why it is empty.
    // Classic has no specials at all: no empty-panel message and no overcharge bar either.
    const isPurist = engine.mode === GAME_MODES.CLASSIC;
    this.elements.powerupsEmpty?.classList.toggle('hidden', offersSpecialBalls || isPurist);
    this.elements.overchargeFill?.closest?.('.overcharge-widget')?.classList.toggle('hidden', isPurist);
    this.elements.overchargePct?.classList.toggle('hidden', isPurist);

    this.syncShopAmmoAvailability();
    this.updateTiltButton();
    this.updatePowerupButtons(engine);

    const transitionedState = this.prevEngineState !== engine.state;
    this.prevEngineState = engine.state;

    if (extra.ghostAnnouncement) {
      this.announceGhostEvent(extra.ghostAnnouncement);
      // Announced once: a refresh re-run with lastExtra must not repeat it.
      delete this.lastExtra.ghostAnnouncement;
    }

    if (fluxStageCleared) {
      this.announce(t('hud.announcer.round.fluxStageCleared', { stage: fluxStageCleared }));
    }

    if (classicStageCleared) {
      this.announce(t('hud.announcer.round.classicStageCleared', { stage: classicStageCleared }));
    }

    if (fluxPerkChosen) {
      this.announce(
        t('hud.announcer.flux.perkChosen', { name: t(`gameplay.flux.perks.${fluxPerkChosen}.name`) })
      );
    }

    if (Array.isArray(unlockedAchievementIds) && unlockedAchievementIds.length > 0) {
      const rewardCoins = unlockedAchievementIds.reduce(
        (sum, id) => sum + (this.gameConfig.achievements?.[id]?.rewardCoins || 0),
        0
      );
      const names = unlockedAchievementIds
        .map((id) => t(`modals.shop.achievements.items.${id}.name`))
        .join(t('gameplay.feedback.achievement.listSeparator'));
      const announceKey = unlockedAchievementIds.length === 1
        ? 'hud.announcer.achievement.unlocked'
        : 'hud.announcer.achievement.unlockedMany';
      this.announce(t(announceKey, { name: names, coins: formatNumber(rewardCoins) }));
    }

    if (engine.state === GAME_STATES.PAUSED && !this.isRunHeldByUi() && !this.isAnyOverlayModalOpen()) {
      if (this.elements.pauseLevelTip) {
        if (engine.levelTutorialKey) {
          setTextIfChanged(
            this.elements.pauseLevelTip,
            t('modals.pause.levelTip', {
              tip: t(engine.levelTutorialKey)
            })
          );
          this.elements.pauseLevelTip.classList.remove('hidden');
        } else {
          this.elements.pauseLevelTip.classList.add('hidden');
        }
      }
      if (transitionedState) {
        this.saveLastFocusedElement();
      }
      this.elements.modalPause.classList.remove('hidden');
      if (transitionedState && this.elements.btnResume) {
        this.elements.btnResume.focus();
      }
    } else {
      this.elements.modalPause.classList.add('hidden');
    }

    syncFluxPerkModal.call(this, engine);

    // The modal waits for the post-victory celebration, and for any menu opened meanwhile:
    // closing that menu reveals it (see closeOverlayModal).
    const canRevealVictory =
      engine.state === GAME_STATES.VICTORY &&
      !engine.isVictoryCelebrating() &&
      !this.isAnyOverlayModalOpen();
    const isVictoryJustRevealed = canRevealVictory && !this.isVictoryModalRevealed;
    if (engine.state !== GAME_STATES.VICTORY || canRevealVictory) {
      this.isVictoryModalRevealed = canRevealVictory;
    }

    if (engine.state !== GAME_STATES.VICTORY && this.isVictoryPresented) {
      this.isVictoryPresented = false;
      this.stopScoreCountUp();
    }

    if (canRevealVictory) {
      // The run is over: the menu goes away without resuming anything.
      this.closeDrawer({ resume: false });
      const summary = engine.victorySummary || extra;
      const stars = summary.stars || engine.computeStars(engine.score);
      const maxStars = this.gameConfig.scoring.maxStars;
      const scoreText = formatNumber(engine.score);
      const isNewRecord = Boolean(summary.isNewRecord);
      // Score roll-up and star pops play once per victory, the first time the window
      // shows; later refreshes only keep the texts current (e.g. after a language switch).
      if (!this.isVictoryPresented) {
        this.isVictoryPresented = true;
        this.buildVictoryStars(stars, maxStars);
        this.startScoreCountUp(engine.score, isNewRecord);
      } else {
        this.elements.victoryScore?.classList.toggle('is-new-record', isNewRecord);
        if (this.scoreCountUpFrame === null) {
          setTextIfChanged(this.elements.victoryScore, this.formatVictoryScoreText(engine.score, isNewRecord));
        }
        setTextIfChanged(this.victoryStarsLabel, t('modals.victory.stats.stars', { stars, maxStars }));
      }
      if (this.elements.victoryNextStar && summary) {
        this.elements.victoryNextStar.classList.remove('hidden');
        if (summary.nextStarTarget !== null && summary.nextStarTarget !== undefined) {
          this.elements.victoryNextStar.textContent = t('modals.victory.nextStarHint', {
            star: summary.nextStarNumber,
            target: formatNumber(summary.nextStarTarget),
            points: formatNumber(summary.pointsToNextStar)
          });
          this.elements.victoryNextStar.classList.remove('is-all-stars');
        } else {
          this.elements.victoryNextStar.textContent = t('modals.victory.allStarsEarned');
          this.elements.victoryNextStar.classList.add('is-all-stars');
        }
      }
      setTextIfChanged(
        this.elements.victoryBonus,
        t('modals.victory.stats.shotsBonus', {
          bonus: formatNumber(summary.victoryBonus || 0),
          coins: formatNumber(summary.earnedCoins || 0)
        })
      );
      this.updateNextLevelButton(engine);
      const unlockedModes = summary.unlockedModes ?? [];
      const unlockText = formatUnlockedModesText(unlockedModes, t);
      if (this.elements.victoryUnlock) {
        setTextIfChanged(this.elements.victoryUnlock, unlockText);
        this.elements.victoryUnlock.classList.toggle('hidden', !unlockText);
      }
      if (isVictoryJustRevealed) {
        this.saveLastFocusedElement();
        const victoryResult = t('hud.announcer.round.victory', { score: scoreText, stars, maxStars });
        const unlockedNames = formatUnlockedModeNames(unlockedModes, t);
        this.announce(
          unlockedNames
            ? `${victoryResult} ${t('hud.announcer.modeUnlocked', { modes: unlockedNames })}`
            : victoryResult
        );
      }
      this.elements.modalVictory.classList.remove('hidden');
      if (isVictoryJustRevealed) {
        this.focusInTopModal(this.elements.btnNextLevel);
      }
    }

    if (engine.state !== GAME_STATES.GAME_OVER || engine.mode !== GAME_MODES.DAILY) {
      this.stopDailyCountdown();
    }

    if (engine.state === GAME_STATES.GAME_OVER) {
      this.closeDrawer({ resume: false });
      const summary = engine.gameOverSummary;
      const reasonKey = gameOverReasonKey(extra.gameOverReason || summary?.reasonKey);
      const scoreText = formatNumber(engine.score);
      setTextIfChanged(this.elements.gameOverReason, t(reasonKey));
      setTextIfChanged(this.elements.gameOverScore, t('modals.gameOver.stats.score', { score: scoreText }));
      const highScoreText = t('modals.gameOver.stats.highScore', {
        highScore: formatNumber(Math.max(bestScore, engine.score))
      });
      const isNewRecord = Boolean(summary?.isNewRecord);
      setTextIfChanged(
        this.elements.gameOverBest,
        isNewRecord ? `${highScoreText} - ${t('modals.gameOver.stats.newRecordBadge')}` : highScoreText
      );
      this.elements.gameOverBest?.classList.toggle('is-new-record', isNewRecord);
      if (this.elements.gameoverRemaining) {
        const showRemaining = engine.usesShotBudget() && summary?.remainingSpheres > 0;
        if (showRemaining) {
          setTextIfChanged(
            this.elements.gameoverRemaining,
            t('modals.gameOver.stats.remainingSpheres', { count: formatNumber(summary.remainingSpheres) })
          );
          this.elements.gameoverRemaining.classList.remove('hidden');
        } else {
          this.elements.gameoverRemaining.classList.add('hidden');
        }
      }
      if (this.elements.gameOverStage) {
        const stageSummaryText = this.formatGameOverStageSummary(engine, summary);
        if (stageSummaryText) {
          setTextIfChanged(this.elements.gameOverStage, stageSummaryText);
        }
        this.elements.gameOverStage.classList.toggle('hidden', !stageSummaryText);
      }
      let nearMissText = '';
      if (this.elements.gameOverNearMiss) {
        nearMissText = formatNearMissText(summary?.nearMiss);
        if (nearMissText) {
          setTextIfChanged(this.elements.gameOverNearMiss, nearMissText);
        }
        this.elements.gameOverNearMiss.classList.toggle('hidden', !nearMissText);
      }
      const duelText = this.refreshGameOverDuel(summary);
      if (this.elements.gameOverDailyNext) {
        const isDaily = engine.mode === GAME_MODES.DAILY;
        if (isDaily) {
          this.startDailyCountdown();
        }
        this.elements.gameOverDailyNext.classList.toggle('hidden', !isDaily);
      }
      // Every mode but the campaign has a result worth sharing.
      this.elements.btnShareGameOver?.classList.toggle('hidden', engine.mode === GAME_MODES.CAMPAIGN);
      this.elements.btnDailyHistoryGameOver?.classList.toggle('hidden', engine.mode !== GAME_MODES.DAILY);
      if (this.elements.btnContinueGameOver) {
        const canContinue = Boolean(engine.canContinueOutOfShots?.());
        if (canContinue) {
          const pack = engine.getContinuePackSpec();
          const canAfford = this.storageManager.getCoins() >= pack.costCoins;
          setTextIfChanged(
            this.elements.btnContinueGameOver,
            t('modals.gameOver.button.continueShots', {
              shots: formatNumber(pack.shots),
              cost: formatNumber(pack.costCoins)
            })
          );
          this.elements.btnContinueGameOver.disabled = !canAfford;
        }
        this.elements.btnContinueGameOver.classList.toggle('hidden', !canContinue);
      }
      if (this.elements.btnSameSeedGameOver) {
        const hasFluxSeed = engine.mode === GAME_MODES.FLUX && Boolean(engine.fluxSeed);
        if (hasFluxSeed) {
          setTextIfChanged(
            this.elements.btnSameSeedGameOver,
            t('modals.gameOver.button.sameSeed', { seed: engine.fluxSeed })
          );
        }
        this.elements.btnSameSeedGameOver.classList.toggle('hidden', !hasFluxSeed);
      }
      if (transitionedState) {
        this.shareCopied = false;
        this.refreshChallengeUrl();
        this.updateShareButtonLabel();
        this.elements.gameOverShareFallback?.classList.add('hidden');
        this.saveLastFocusedElement();
        const gameOverResult = t('hud.announcer.round.gameOver', { reason: t(reasonKey), score: scoreText });
        const roundResult = duelText ? `${gameOverResult} ${duelText}` : gameOverResult;
        this.announce(
          nearMissText
            ? t('hud.announcer.round.withNearMiss', { result: roundResult, nearMiss: nearMissText })
            : roundResult
        );
      }
      this.elements.modalGameOver.classList.remove('hidden');
      if (transitionedState) {
        this.focusInTopModal(this.elements.btnRetry);
      }
    } else {
      this.elements.modalGameOver.classList.add('hidden');
    }

    // During a duel the rival badge takes the best-run marker's place in the badge row.
    const isDuelBadgeShown = this.refreshGhostBadge(engine);
    const bestRunText = engine.state !== GAME_STATES.VICTORY && engine.state !== GAME_STATES.GAME_OVER && !isDuelBadgeShown
      ? formatBestRunMarker(engine.getRunBestMarker?.())
      : '';
    if (this.isDuelCardOpen()) {
      this.renderDuelCard();
    }
    if (this.elements.bestRunBadge) {
      setTextIfChanged(this.elements.bestRunBadge, bestRunText);
      this.elements.bestRunBadge.classList.toggle('hidden', !bestRunText);
    }
    setTextIfChanged(
      this.elements.compactInfo,
      t('hud.stats.compactLine', {
        mode: this.elements.modeBanner.textContent,
        coins: this.elements.coinsValue.textContent,
        best: this.elements.highScoreValue.textContent
      })
    );
    this.syncDrawerStats();
    this.syncModalInertState();
  },

  /** Best score of the given Weekly Flux week (this week when none is given), 0 when none yet. */
  getWeeklyFluxBestScore(weekKey) {
    const key = weekKey || getUtcIsoWeekKey(Date.now());
    return this.storageManager?.getWeeklyFluxBest?.(key)?.score || 0;
  },

  /** Weekly Flux menu label: this week's best once played, the bonus until it is claimed. */
  getWeeklyButtonLabel() {
    const weekKey = getUtcIsoWeekKey(Date.now());
    const bestScore = this.getWeeklyFluxBestScore(weekKey);
    if (bestScore > 0) {
      return t('app.nav.button.weeklyBestBadge', { score: formatNumber(bestScore) });
    }
    const bonusCoins = this.gameConfig.weeklyFlux?.firstPlayBonusCoins || 0;
    const isClaimed = this.storageManager?.hasClaimedWeeklyFluxBonus?.(weekKey) === true;
    if (bonusCoins > 0 && !isClaimed) {
      return t('app.nav.button.weeklyBonusBadge', { coins: formatNumber(bonusCoins) });
    }
    return t('app.nav.button.weekly');
  },

  /**
   * Locked, new and normal look of every gated mode control: the menu buttons and the arcade
   * cards of the level select. A locked control stays focusable (aria-disabled, not disabled).
   * @param {Object<string, {unlocked?: boolean, isNew?: boolean, requiredLevel?: number}>} access
   *   Storage getModeAccess().
   */
  refreshModeLocks(access) {
    const weeklyLabel = this.getWeeklyButtonLabel();
    for (const [mode, elementKeys] of Object.entries(MODE_LOCK_BUTTON_KEYS)) {
      for (const elementKey of elementKeys) {
        const button = this.elements[elementKey];
        if (!button) {
          continue;
        }
        const isWeekly = elementKey === 'btnWeekly';
        const nameKey = isWeekly ? 'app.nav.button.weekly' : MODE_NAME_KEYS[mode];
        const lock = describeModeLock(mode, access, t, nameKey);
        // Weekly Flux unlocks with Flux but is not a new mode: only Flux carries the badge.
        this.applyModeLockState(button, lock, isWeekly ? weeklyLabel : t(nameKey), !isWeekly);
      }
    }
    for (const [mode, spec] of Object.entries(ARCADE_CARD_SPECS)) {
      const card = this.elements[spec.card];
      if (!card) {
        continue;
      }
      const lock = describeModeLock(mode, access, t);
      setModeLabel(
        card.querySelector('.arcade-card-title'),
        lock.isLocked ? lock.label : t(spec.titleKey),
        lock.newBadge
      );
      setTextIfChanged(
        card.querySelector('.arcade-card-desc'),
        lock.isLocked ? t('modals.levelSelect.arcade.lockedDesc', { level: lock.level }) : t(spec.descKey)
      );
      this.elements[spec.best]?.classList.toggle('hidden', lock.isLocked);
      card.classList.toggle(MODE_LOCKED_CLASS, lock.isLocked);
      card.classList.toggle(MODE_NEW_CLASS, lock.isNew);
      if (lock.isLocked) {
        setAttributeIfChanged(card, 'aria-disabled', 'true');
        setAttributeIfChanged(card, 'aria-label', lock.ariaLabel);
        setAttributeIfChanged(card, 'title', lock.hint);
      } else {
        card.removeAttribute('aria-disabled');
        card.removeAttribute('aria-label');
        card.removeAttribute('title');
      }
      if (mode === GAME_MODES.PUZZLE) {
        this.elements.puzzleStagesStrip?.classList.toggle('hidden', lock.isLocked);
      }
    }
  },

  /** Applies a mode lock to one menu button: label, badge, classes and accessible name. */
  applyModeLockState(button, lock, baseLabel, showNewBadge) {
    const hasBadge = showNewBadge && lock.isNew;
    setModeLabel(button, lock.isLocked ? lock.label : baseLabel, hasBadge ? lock.newBadge : '');
    button.classList.toggle(MODE_LOCKED_CLASS, lock.isLocked);
    button.classList.toggle(MODE_NEW_CLASS, hasBadge);
    if (lock.isLocked) {
      setAttributeIfChanged(button, 'aria-disabled', 'true');
      setAttributeIfChanged(button, 'aria-label', lock.ariaLabel);
      setAttributeIfChanged(button, 'title', lock.hint);
      return;
    }
    button.removeAttribute('aria-disabled');
    button.removeAttribute('title');
    if (hasBadge) {
      setAttributeIfChanged(button, 'aria-label', lock.newAria);
    } else {
      button.removeAttribute('aria-label');
    }
  },
};
