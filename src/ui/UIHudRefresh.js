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

import { GAME_MODES, GAME_STATES, INPUT_MODES, LAUNCHER_POSTURES, OBJECTIVE_TYPES } from '../core/Constants.js';
import { t, formatNumber } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { resolveHintText } from '../game/Discovery.js';
import { MAGNETAR_PHASES } from '../game/MagnetarRules.js';
import { getMergeEventTextKey } from '../game/modes/MergeEvents.js';
import { MERGE_CONTRACT_OUTCOMES, getMergeContractPluralKey } from '../game/modes/MergeContracts.js';
import { SAG_PHASES } from '../game/SagMeter.js';
import { getUtcIsoWeekKey } from '../game/WeeklyFlux.js';
import { FULL_PERCENT } from './WorkshopView.js';
import { syncFluxPerkModal } from './FluxPerkView.js';
import { writeRewardChip } from './PlayHubView.js';
import {
  MODE_BUTTON_KEYS,
  isCurrentWeeklyRun,
  ARCADE_CARD_SPECS,
  MODE_LOCKED_CLASS,
  MODE_NEW_CLASS,
  describeModeLock,
  setPowerupsDrawerOpen,
  syncAdaptiveCanvasHeight,
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

const PRESSURE_ARIA_KEYS = Object.freeze({
  convoy: 'hud.stats.pressure.convoyAria',
  orbital: 'hud.stats.pressure.orbitalAria',
  merge: 'hud.stats.pressure.mergeAria'
});

/** Updates the continuous spatial-pressure meter for Convoy, Orbital, and Merge modes. */
export function updatePressureMeter(ui, engine, sagActive) {
  const meter = ui.elements.pressureMeter;
  if (!meter) {
    return;
  }
  const pressure = !sagActive ? engine.getModeBehavior?.()?.getPressureState?.(engine) : null;
  if (!pressure?.active) {
    meter.classList.add('hidden');
    return;
  }
  const pct = Math.round(Math.max(0, Math.min(1, pressure.ratio || 0)) * FULL_PERCENT);
  const ariaKey = PRESSURE_ARIA_KEYS[pressure.modeKey] || PRESSURE_ARIA_KEYS.convoy;
  setAttributeIfChanged(meter, 'aria-valuenow', String(pct));
  setAttributeIfChanged(meter, 'aria-valuetext', t(ariaKey, { pct: formatNumber(pct) }));
  meter.style.setProperty('--pressure-pct', String(pct));
  meter.classList.toggle('warning', Boolean(pressure.danger) && !pressure.critical);
  meter.classList.toggle('critical', Boolean(pressure.critical));
  meter.classList.remove('hidden');
}

/** Shows the storage quota badge when localStorage overflows and announces it once per session. */
export function updateQuotaWarning(ui, engine, transitionedRoundEnd) {
  const exceeded = Boolean(ui.storageManager?.hasQuotaExceeded?.());
  const badge = ui.elements.quotaBadge;
  if (badge) {
    if (exceeded) {
      setTextIfChanged(badge, t('hud.stats.quotaWarning.badge'));
      setAttributeIfChanged(badge, 'aria-label', t('hud.stats.quotaWarning.aria'));
      setAttributeIfChanged(badge, 'title', t('hud.stats.quotaWarning.aria'));
    }
    badge.classList.toggle('hidden', !exceeded);
  }
  if (exceeded && !ui.hasAnnouncedQuotaExceeded && !transitionedRoundEnd && engine.state === GAME_STATES.PLAYING) {
    ui.hasAnnouncedQuotaExceeded = true;
    ui.announce(t('hud.announcer.storageQuotaExceeded'));
  }
}

/** Methods installed on UIManager.prototype by UIManager.js. */
/**
 * Locale key of the Flux banner: a Magnetar boss stage also names its Moorings.
 * @param {boolean} isBossStage - Whether the stage is a boss stage.
 * @param {object|null} magnetarView - engine.getMagnetarView().
 * @returns {string} Locale key.
 */
export function getFluxBannerKey(isBossStage, magnetarView) {
  if (!isBossStage) {
    return 'hud.stats.mode.flux';
  }
  return magnetarView ? 'hud.stats.mode.fluxBossMagnetar' : 'hud.stats.mode.fluxBoss';
}

const MODAL_VISIBILITY_KEYS = ['modalPause', 'modalFluxPerk', 'modalVictory', 'modalGameOver', 'appDrawer'];

const BEST_SCORE_GETTERS = Object.freeze({
  [GAME_MODES.CAMPAIGN]: (storage, engine) => storage.getLevelStats()[engine.currentLevelId]?.bestScore || 0,
  [GAME_MODES.DAILY]: (storage, engine) => storage.getDailyHighScore(engine.dailySeedKey || SeededRandom.getTodayDateKey()),
  [GAME_MODES.FLUX]: (storage, engine, ui) => (
    engine.isWeeklyFluxRun === true
      ? ui.getWeeklyFluxBestScore(engine.weeklyWeekKey)
      : storage.getFluxHighScore()
  ),
  [GAME_MODES.PUZZLE]: (storage, engine) => (
    engine.isCustomPuzzle ? 0 : (storage.getPuzzleStageStats?.()?.[engine.currentPuzzleStage]?.bestScore || 0)
  ),
  [GAME_MODES.BLITZ]: (storage) => storage.getBlitzHighScore(),
  [GAME_MODES.BOSS_RUSH]: (storage) => storage.getBossRushHighScore(),
  [GAME_MODES.CASCADE]: (storage) => storage.getCascadeHighScore(),
  [GAME_MODES.CLASSIC]: (storage) => storage.getClassicHighScore(),
  [GAME_MODES.HEX_GRID]: (storage) => storage.getHexGridHighScore?.() || 0,
  [GAME_MODES.ORBITAL]: (storage) => storage.getOrbitalHighScore?.() || 0,
  [GAME_MODES.PINBALL]: (storage) => storage.getPinballHighScore?.() || 0,
  [GAME_MODES.CONVOY]: (storage) => storage.getConvoyHighScore?.() || 0,
  [GAME_MODES.MERGE]: (storage) => storage.getMergeHighScore?.() || 0,
  [GAME_MODES.SLINGSHOT]: (storage) => storage.getSlingshotHighScore?.() || 0
});

const WAVE_BANNER_SPECS = Object.freeze({
  [GAME_MODES.DAILY]: (engine) => ({
    key: 'hud.stats.mode.daily',
    params: {
      mutator: engine.activeMutatorKey ? t(`gameplay.mutators.${engine.activeMutatorKey}`) : '',
      wave: engine.waveCount
    }
  }),
  [GAME_MODES.CASCADE]: (engine) => ({
    key: 'hud.stats.mode.cascade',
    params: { wave: engine.waveCount }
  }),
  [GAME_MODES.CLASSIC]: (engine) => ({
    key: 'hud.stats.mode.classic',
    params: { stage: formatNumber(engine.classicStage) }
  }),
  [GAME_MODES.HEX_GRID]: (engine) => ({
    key: 'hud.stats.mode.hexGrid',
    params: { wave: formatNumber(engine.waveCount) }
  }),
  [GAME_MODES.ORBITAL]: (engine) => ({
    key: 'hud.stats.mode.orbital',
    params: { wave: formatNumber(engine.waveCount) }
  }),
  [GAME_MODES.CONVOY]: (engine) => ({
    key: 'hud.stats.mode.convoy',
    params: { wave: formatNumber(engine.waveCount) }
  }),
  [GAME_MODES.MERGE]: (engine) => ({
    key: 'hud.stats.mode.merge',
    params: {
      tier: formatNumber(engine.mergeBestTier || 1),
      merges: formatNumber(engine.modeState?.mergesCount || 0)
    }
  })
});

function resolveModeBestScore(ui, engine) {
  const getter = BEST_SCORE_GETTERS[engine.mode];
  return getter ? getter(ui.storageManager, engine, ui) : ui.storageManager.getEndlessHighScore();
}

function getRoundModalVisibilityMask(ui) {
  let mask = 0;
  for (let i = 0; i < MODAL_VISIBILITY_KEYS.length; i += 1) {
    const el = ui.elements[MODAL_VISIBILITY_KEYS[i]];
    if (el && !el.classList.contains('hidden')) {
      mask |= 1 << i;
    }
  }
  return mask;
}

function refreshHeaderMetrics(ui, engine) {
  setTextIfChanged(ui.elements.scoreValue, formatNumber(engine.score));
  setTextIfChanged(
    ui.elements.coinsValue,
    t('hud.stats.coins.value', { coins: formatNumber(ui.storageManager.getCoins()) })
  );

  const affordableCount = ui.getAffordableUpgradeCount();
  setTextIfChanged(
    ui.elements.btnShop,
    affordableCount > 0
      ? t('app.nav.button.shopBadge', { count: formatNumber(affordableCount) })
      : t('app.nav.button.shop')
  );
  ui.elements.btnShop.classList.toggle('has-affordable', affordableCount > 0);
}

function setModeButtonActiveState(button, isActive) {
  if (!button) {
    return;
  }
  button.classList.toggle('active-mode', isActive);
  if (isActive) {
    setAttributeIfChanged(button, 'aria-current', 'true');
  } else {
    button.removeAttribute('aria-current');
  }
}

function refreshModeSelectionHighlights(ui, engine) {
  // Only the mode being played stands out, and says so to screen readers.
  for (const [mode, elementKeys] of Object.entries(MODE_BUTTON_KEYS)) {
    const isActive = engine.mode === mode;
    for (const elementKey of elementKeys) {
      const button = ui.elements[elementKey];
      if (!button) {
        continue;
      }
      if (mode === GAME_MODES.CAMPAIGN) {
        // The Campaign card is a section with two buttons: the section stands out, no button is "current".
        (button.closest?.('section') ?? button).classList.toggle('active-mode', isActive);
        continue;
      }
      setModeButtonActiveState(button, isActive);
    }
  }
  // Only the run of the current week lights the Weekly button: a run of last week, still
  // open after Monday 00:00 UTC, is plain Flux for the menu.
  const isCurrentWeekRun = isCurrentWeeklyRun(engine, getUtcIsoWeekKey(Date.now()));
  setModeButtonActiveState(ui.elements.btnFlux, engine.mode === GAME_MODES.FLUX && !isCurrentWeekRun);
  setModeButtonActiveState(ui.elements.btnWeekly, isCurrentWeekRun);

  ui.refreshModeLocks(ui.getModeAccess());
  if (ui.elements.btnDaily) {
    // The Daily card shows its state in the reward chip; the card keeps its title and text.
    writeRewardChip(ui.elements.dailyReward, ui.describeDailyRewardChip());
    const todayKey = SeededRandom.getTodayDateKey();
    const streak = ui.storageManager.getDailyStreak?.(todayKey) || 0;
    const graceHint = formatStreakGraceText(streak, ui.storageManager.getDailyStreakGrace?.(todayKey), todayKey);
    if (graceHint) {
      setAttributeIfChanged(ui.elements.btnDaily, 'title', graceHint);
    } else {
      ui.elements.btnDaily.removeAttribute?.('title');
    }
  }
}

function refreshOverchargeAndBestScore(ui, engine) {
  const overchargePct = Math.min(
    FULL_PERCENT,
    Math.round((engine.overcharge / ui.gameConfig.scoring.overchargeMax) * FULL_PERCENT)
  );
  setTextIfChanged(ui.elements.overchargePct, t('hud.stats.overcharge.pct', { pct: overchargePct }));
  ui.elements.overchargeFill.style.width = `${overchargePct}%`;

  const bestScore = resolveModeBestScore(ui, engine);
  setTextIfChanged(ui.elements.highScoreValue, formatNumber(Math.max(bestScore, engine.score)));
  return bestScore;
}

/** @this {import('./UIManager.js').UIManager} */
function refreshLauncherControls(engine) {
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
    const isSwapLocked = engine.mode === GAME_MODES.PUZZLE;
    this.elements.swapBtn.disabled = isSwapLocked;
    if (isSwapLocked) {
      setAttributeIfChanged(this.elements.swapBtn, 'title', t('hud.launcher.swap.lockedPuzzle'));
    } else {
      this.elements.swapBtn.removeAttribute?.('title');
    }
  }
}

/**
 * @this {import('./UIManager.js').UIManager}
 * @param {object} engine
 */
function refreshStarProgress(engine) {
  if (!this.elements.starProgress) {
    return;
  }
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

function hideStarProgress(ui) {
  ui.elements.starProgress?.classList.add('hidden');
}

function refreshStandardShotCounter(ui, engine, warningShotsThreshold) {
  if (ui.elements.shotsLabel) {
    setTextIfChanged(ui.elements.shotsLabel, t('hud.stats.shots.label'));
  }
  setTextIfChanged(ui.elements.shotsValue, formatNumber(engine.shotsRemaining));
  ui.elements.shotsValue.classList.toggle('warning', engine.shotsRemaining <= warningShotsThreshold);
}

function formatCoreRescueSuffix(engine) {
  if (engine.currentObjective !== OBJECTIVE_TYPES.CORE_RESCUE || engine.targetCoreCount <= 0) {
    return '';
  }
  return ` • ${t('hud.stats.mode.coreRescueProgress', {
    rescued: formatNumber(Math.min(engine.targetCoreCount, engine.rescuedCores || 0)),
    total: formatNumber(engine.targetCoreCount)
  })}`;
}

function formatLabMutatorSuffix(ui, engine) {
  const count = engine.activeLabMutators?.length || 0;
  if (count <= 0) {
    return '';
  }
  const perMutator = ui.gameConfig?.mutatorLab?.scoreMultiplierPerMutator ?? 0.25;
  const mult = (1 + count * perMutator).toFixed(2).replace(/\.00$/, '').replace(/0$/, '');
  return ` • ${t('hud.stats.mode.labSuffix', { mult })}`;
}

const STAGE_MODE_BANNER_BUILDERS = Object.freeze({
  [GAME_MODES.CAMPAIGN]: (ui, engine) => {
    const lvl = engine.levelCatalog.summarize(engine.currentLevelId);
    return `${t('hud.stats.mode.campaign', {
      level: engine.currentLevelId,
      name: lvl ? ui.formatLevelName(lvl) : ''
    })}${formatCoreRescueSuffix(engine)}`;
  },
  [GAME_MODES.PUZZLE]: (ui, engine) => `${engine.isCustomPuzzle
    ? t(engine.customPuzzleSpec?.verified ? 'hud.stats.mode.customPuzzleVerified' : 'hud.stats.mode.customPuzzle')
    : t('hud.stats.mode.puzzle', {
        stage: engine.currentPuzzleStage,
        total: ui.gameConfig.puzzles?.length || 1
      })}${formatCoreRescueSuffix(engine)}`,
  [GAME_MODES.BLITZ]: (_ui, engine) => t('hud.stats.mode.blitz', { wave: formatNumber(engine.waveCount) }),
  [GAME_MODES.FLUX]: (ui, engine, magnetarView) => t(getFluxBannerKey(engine.fluxIsBossStage, magnetarView), {
    stage: engine.fluxStage,
    shape: ui.formatFluxShapeName(engine.fluxShapeIds),
    moorings: magnetarView ? formatNumber(magnetarView.moorings) : ''
  }),
  [GAME_MODES.PINBALL]: (_ui, engine) => t('hud.stats.mode.pinball', {
    stage: formatNumber(engine.pinballStage || 1),
    cores: formatNumber(engine.modeState?.corePegsRemaining ?? 0)
  }),
  [GAME_MODES.SLINGSHOT]: (_ui, engine) => {
    const balls = engine.physicsWorld?.balls;
    const remainingCores = Array.isArray(balls) ? balls.reduce((sum, b) => sum + (b.slingshotCore ? 1 : 0), 0) : 0;
    return t('hud.stats.mode.slingshot', {
      stage: formatNumber(engine.slingshotStage || 1),
      cores: formatNumber(remainingCores)
    });
  }
});

function refreshBlitzTimeCounter(ui, engine) {
  const fps = ui.gameConfig.blitz.framesPerSecond;
  const secondsLeft = Math.max(0, Math.ceil(engine.blitzFramesRemaining / fps));
  if (ui.elements.shotsLabel) {
    setTextIfChanged(ui.elements.shotsLabel, t('hud.stats.time.label'));
  }
  setTextIfChanged(ui.elements.shotsValue, t('hud.stats.time.seconds', { seconds: formatNumber(secondsLeft) }));
  ui.elements.shotsValue.classList.toggle('warning', secondsLeft <= ui.gameConfig.blitz.warningSeconds);
}

function refreshStageModeHud(ui, engine, magnetarView, warningShotsThreshold) {
  const buildBanner = STAGE_MODE_BANNER_BUILDERS[engine.mode];
  if (!buildBanner) {
    return false;
  }
  setTextIfChanged(ui.elements.modeBanner, `${buildBanner(ui, engine, magnetarView)}${formatLabMutatorSuffix(ui, engine)}`);
  if (engine.mode === GAME_MODES.BLITZ) {
    refreshBlitzTimeCounter(ui, engine);
  } else {
    refreshStandardShotCounter(ui, engine, warningShotsThreshold);
  }
  if ((engine.mode === GAME_MODES.CAMPAIGN || engine.mode === GAME_MODES.PUZZLE) && !engine.isCustomPuzzle) {
    refreshStarProgress.call(ui, engine);
  } else {
    hideStarProgress(ui);
  }
  return true;
}

function formatBossRushBanner(engine, magnetarView) {
  if (magnetarView) {
    const isResting = magnetarView.phase === 'rest' && Number.isFinite(magnetarView.restLeft);
    return t(isResting ? 'hud.stats.mode.bossRushMagnetarRest' : 'hud.stats.mode.bossRushMagnetar', {
      wave: engine.bossRushWave,
      moorings: formatNumber(magnetarView.moorings),
      ...(isResting ? { rest: formatNumber(magnetarView.restLeft) } : {})
    });
  }
  const shields = engine.getBossBall()?.armorHits || 0;
  return t('hud.stats.mode.bossRush', {
    wave: engine.bossRushWave,
    shields: formatNumber(shields)
  });
}

function refreshWaveModeBanner(ui, engine, magnetarView) {
  const labSuffix = formatLabMutatorSuffix(ui, engine);
  if (engine.mode === GAME_MODES.BOSS_RUSH) {
    setTextIfChanged(ui.elements.modeBanner, `${formatBossRushBanner(engine, magnetarView)}${labSuffix}`);
    return;
  }
  const specBuilder = WAVE_BANNER_SPECS[engine.mode];
  if (specBuilder) {
    const { key, params } = specBuilder(engine);
    setTextIfChanged(ui.elements.modeBanner, `${t(key, params)}${labSuffix}`);
    return;
  }
  setTextIfChanged(ui.elements.modeBanner, `${t('hud.stats.mode.endless', { wave: engine.waveCount })}${labSuffix}`);
}

function resolveWaveShotsLabelKey(mode, shakeLeft) {
  if (mode === GAME_MODES.BOSS_RUSH) {
    return 'hud.stats.shots.shieldsLabel';
  }
  if (mode === GAME_MODES.CONVOY) {
    return 'hud.stats.shots.convoyLabel';
  }
  if (mode === GAME_MODES.MERGE) {
    return shakeLeft !== null && shakeLeft !== undefined
      ? 'hud.stats.shots.shakeLabel'
      : 'hud.stats.shots.mergesLabel';
  }
  return 'hud.stats.shots.waveLabel';
}

const WAVE_COUNTDOWN_RESOLVERS = Object.freeze({
  [GAME_MODES.CASCADE]: (engine, _shakeLeft, warn) => ({
    waveCountdown: engine.cascadeTurnsUntilDrop,
    isShotsWarning: engine.cascadeTurnsUntilDrop <= warn
  }),
  [GAME_MODES.BOSS_RUSH]: (engine, _shakeLeft, warn) => {
    const waveCountdown = engine.getBossBall()?.armorHits || 0;
    return { waveCountdown, isShotsWarning: waveCountdown <= warn };
  },
  [GAME_MODES.HEX_GRID]: (engine, _shakeLeft, warn) => {
    const waveCountdown = engine.modeState?.shotsUntilDescent ?? 0;
    return { waveCountdown, isShotsWarning: waveCountdown <= warn };
  },
  [GAME_MODES.ORBITAL]: (engine, _shakeLeft, warn) => {
    const waveCountdown = engine.modeState?.turnsUntilWave ?? 0;
    return { waveCountdown, isShotsWarning: waveCountdown <= warn || Boolean(engine.modeState?.nearDanger) };
  },
  [GAME_MODES.CONVOY]: (engine) => ({
    waveCountdown: engine.physicsWorld.balls.length + (engine.modeState?.spawnRemaining ?? 0),
    isShotsWarning: Boolean(engine.modeState?.nearDanger)
  }),
  [GAME_MODES.MERGE]: (engine, shakeLeft) => ({
    waveValueText: shakeLeft !== null && shakeLeft !== undefined
      ? (shakeLeft === 0 ? t('hud.stats.shots.shakeReady') : formatNumber(shakeLeft))
      : null,
    waveCountdown: engine.modeState?.mergesCount ?? 0,
    isShotsWarning: Boolean(engine.modeState?.nearDanger)
  })
});

function resolveWaveCountdownState(engine, shakeLeft, warningShotsThreshold) {
  const resolver = WAVE_COUNTDOWN_RESOLVERS[engine.mode];
  if (!resolver) {
    return { waveValueText: formatNumber(0), isShotsWarning: 0 <= warningShotsThreshold };
  }
  const { waveCountdown = 0, waveValueText = null, isShotsWarning } = resolver(engine, shakeLeft, warningShotsThreshold);
  return { waveValueText: waveValueText ?? formatNumber(waveCountdown), isShotsWarning };
}

function refreshWaveModeHud(ui, engine, magnetarView, warningShotsThreshold) {
  refreshWaveModeBanner(ui, engine, magnetarView);
  const sag = engine.getSagState?.();
  if (sag?.active) {
    ui.refreshSagMeter(engine, sag);
  } else {
    const shakeLeft = engine.mode === GAME_MODES.MERGE ? engine.getMergeShakeRemaining?.() : null;
    if (ui.elements.shotsLabel) {
      setTextIfChanged(ui.elements.shotsLabel, t(resolveWaveShotsLabelKey(engine.mode, shakeLeft)));
    }
    const { waveValueText, isShotsWarning } = resolveWaveCountdownState(engine, shakeLeft, warningShotsThreshold);
    setTextIfChanged(ui.elements.shotsValue, waveValueText);
    ui.elements.shotsValue.classList.toggle('warning', isShotsWarning);
  }
  hideStarProgress(ui);
}

function updateNearDangerAnnouncement(ui, engine) {
  const tracksDanger = engine.state === GAME_STATES.PLAYING
    && (engine.mode === GAME_MODES.CONVOY || engine.mode === GAME_MODES.ORBITAL || engine.mode === GAME_MODES.MERGE);
  if (!tracksDanger) {
    ui.nearDangerAnnouncedMode = null;
    ui.nearDangerWasActive = false;
    return;
  }
  const nextNearDanger = Boolean(engine.modeState?.nearDanger);
  if (ui.nearDangerAnnouncedMode !== engine.mode) {
    ui.nearDangerAnnouncedMode = engine.mode;
    ui.nearDangerWasActive = nextNearDanger;
  } else if (nextNearDanger && !ui.nearDangerWasActive) {
    ui.nearDangerWasActive = true;
    ui.announce(t(`hud.announcer.nearDanger.${engine.mode}`));
  } else if (!nextNearDanger) {
    ui.nearDangerWasActive = false;
  }
}

/** @this {import('./UIManager.js').UIManager} */
function refreshModeHudSection(engine, magnetarView) {
  const warningShotsThreshold = this.gameConfig.canvas.survivalWaveWarningThreshold;
  if (!refreshStageModeHud(this, engine, magnetarView, warningShotsThreshold)) {
    refreshWaveModeHud(this, engine, magnetarView, warningShotsThreshold);
  }
  const sagActive = Boolean(engine.getSagState?.().active);
  if (!sagActive) {
    this.hideSagMeter();
  }
  updatePressureMeter(this, engine, sagActive);
  this.refreshMagnetarHud(engine, magnetarView);
  updateNearDangerAnnouncement(this, engine);

  if (this.elements.modeBanner) {
    setAttributeIfChanged(
      this.elements.modeBanner,
      'aria-label',
      `${this.elements.modeBanner.textContent} (${t('hud.stats.mode.switchHint')})`
    );
  }
}

function refreshTutorialAndSpecialBanners(ui, engine) {
  // Both banners are polite live regions: rewriting identical text on every
  // engine event would make screen readers repeat them.
  if (ui.elements.tutorialBanner) {
    const hintText = engine.activeDiscoveryId
      ? resolveHintText(engine.activeDiscoveryId, ui.gameConfig.onboarding, ui.ballsConfig, t, ui.inputMode)
      : '';
    if (hintText && engine.state === GAME_STATES.PLAYING) {
      revealLiveRegion({
        region: ui.elements.tutorialBanner,
        textElement: ui.elements.tutorialBannerText,
        text: hintText,
        schedule: scheduleNextFrame
      });
    } else {
      ui.elements.tutorialBanner.classList.add('hidden');
    }
  }

  const equippedBanner = ui.elements.specialEquippedBanner;
  if (!equippedBanner) {
    return;
  }
  const equippedType = engine.currentBall?.specialType;
  if (equippedType && engine.state === GAME_STATES.PLAYING) {
    const spec = ui.ballsConfig.specialTypes[equippedType];
    revealLiveRegion({
      region: equippedBanner,
      textElement: equippedBanner,
      text: t('hud.launcher.specialEquipped.hint', {
        icon: spec?.icon || '',
        name: t(`hud.powerups.${equippedType}.name`),
        desc: t(`hud.powerups.${equippedType}.tooltip`),
        unequip: t(`hud.launcher.specialEquipped.unequip.${ui.getHintInputMode('hud.launcher.specialEquipped.unequip')}`)
      }),
      schedule: scheduleNextFrame
    });
  } else {
    equippedBanner.classList.add('hidden');
  }
}

function syncLauncherPostureAndDrawer(ui, engine, offersSpecialBalls, hidesOvercharge) {
  const posture = engine.getLauncherSpec?.()?.posture || LAUNCHER_POSTURES.UPWARD;
  const isBottomDock = ui.inputMode === INPUT_MODES.GAMEPAD || posture === LAUNCHER_POSTURES.DROP_RAIL;
  const hasSideDrawerContent = !isBottomDock || offersSpecialBalls || !hidesOvercharge;
  ui.elements.btnPowerupsDrawer?.classList.toggle('hidden', !hasSideDrawerContent);
  if (!hasSideDrawerContent || engine.state !== GAME_STATES.PLAYING) {
    setPowerupsDrawerOpen(ui, false);
  }
  const dataset = ui.elements.stageContainer?.dataset;
  if (dataset) {
    dataset.launcherPosture = posture;
  }
  if (ui.lastAdaptivePosture !== posture || ui.lastAdaptiveInputMode !== ui.inputMode) {
    ui.lastAdaptivePosture = posture;
    ui.lastAdaptiveInputMode = ui.inputMode;
    syncAdaptiveCanvasHeight(ui);
  }
}

function refreshSpecialPanelsVisibility(ui, engine) {
  // A level that hands out no special ball shows no empty slots to a new player.
  const offersSpecialBalls = engine.offersSpecialBalls();
  ui.elements.powerupsContainer.classList.toggle('hidden', !offersSpecialBalls);
  ui.elements.powerupsHeader?.classList.toggle('hidden', !offersSpecialBalls);
  // Purist modes (Classic, Hex Grid, Merge) have no specials at all: no empty-panel message and no overcharge bar.
  const hidesByBehavior = Boolean(engine.getModeBehavior?.()?.hidesOvercharge?.(engine));
  const isPurist = engine.mode === GAME_MODES.CLASSIC || hidesByBehavior;
  ui.elements.powerupsEmpty?.classList.toggle('hidden', offersSpecialBalls || isPurist);
  // Puzzle runs carry no Overcharge either: the bar would never move.
  const hidesOvercharge = isPurist || engine.mode === GAME_MODES.PUZZLE;
  ui.elements.overchargeFill?.closest?.('.overcharge-widget')?.classList.toggle('hidden', hidesOvercharge);
  ui.elements.overchargePct?.classList.toggle('hidden', hidesOvercharge);
  syncLauncherPostureAndDrawer(ui, engine, offersSpecialBalls, hidesOvercharge);
}

function refreshLiveStatusBadgesAndBanners(ui, engine) {
  if (engine.combo > 1) {
    setTextIfChanged(ui.elements.comboBadge, t('hud.stats.combo.label', { count: engine.combo }));
    ui.elements.comboBadge.classList.remove('hidden');
  } else {
    ui.elements.comboBadge.classList.add('hidden');
  }

  ui.refreshMergeEventBadge(engine);
  ui.refreshMergeContractBadge(engine);
  ui.announceMergePressureChanges(engine.getMergePressureState?.() ?? null);

  const convoyFrozenSec = engine.mode === GAME_MODES.CONVOY
    ? Math.ceil(engine.modeState?.freezeTimerSec || 0)
    : 0;
  const freezeDisplayCount = engine.freezeTurnsRemaining > 0 ? engine.freezeTurnsRemaining : convoyFrozenSec;
  if (freezeDisplayCount > 0) {
    setTextIfChanged(ui.elements.frozenBadge, t('hud.stats.frozen.label', { turns: freezeDisplayCount }));
    ui.elements.frozenBadge.classList.remove('hidden');
  } else {
    ui.elements.frozenBadge.classList.add('hidden');
  }

  refreshTutorialAndSpecialBanners(ui, engine);
  ui.updateDiscoveryPulse(engine);
  ui.updateHintReplayButton(engine);
  ui.updateLevelIntro(engine);
  ui.updateAimState(engine);
  refreshSpecialPanelsVisibility(ui, engine);

  ui.syncShopAmmoAvailability();
  ui.updateTiltButton();
  ui.refreshMergeShakeControls?.();
  ui.updatePowerupButtons(engine);
}

/** @this {import('./UIManager.js').UIManager} */
function announceRefreshEvents(extra, oneShot) {
  const { unlockedAchievementIds, fluxStageCleared, classicStageCleared, slingshotStageCleared, fluxPerkChosen } = oneShot;

  if (extra.magnetarAnnouncement) {
    this.announceMagnetarEvent(extra.magnetarAnnouncement);
    // Announced once: a refresh re-run with lastExtra must not repeat it.
    delete this.lastExtra.magnetarAnnouncement;
  }

  if (extra.ghostAnnouncement) {
    this.announceGhostEvent(extra.ghostAnnouncement);
    delete this.lastExtra.ghostAnnouncement;
  }

  if (fluxStageCleared) {
    this.announce(t('hud.announcer.round.fluxStageCleared', { stage: fluxStageCleared }));
  }
  if (classicStageCleared) {
    this.announce(t('hud.announcer.round.classicStageCleared', { stage: classicStageCleared }));
  }
  if (slingshotStageCleared) {
    this.announce(t('hud.announcer.round.slingshotStageCleared', { stage: slingshotStageCleared }));
  }
  if (fluxPerkChosen) {
    this.announce(t('hud.announcer.flux.perkChosen', { name: t(`gameplay.flux.perks.${fluxPerkChosen}.name`) }));
  }

  if (Array.isArray(extra.completedBounties) && extra.completedBounties.length > 0) {
    const coinsTotal = extra.completedBounties.reduce((sum, item) => sum + (item.coins || 0), 0);
    const labelList = extra.completedBounties
      .map((item) => t(`modals.play.bounties.items.${item.id}.title`, { target: formatNumber(item.target) }))
      .join(t('gameplay.feedback.achievement.listSeparator'));
    this.announce(t('gameplay.feedback.bounty.completed', { name: labelList, coins: formatNumber(coinsTotal) }));
    delete this.lastExtra.completedBounties;
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
}

function syncNextContractCta(ui, buttonEl, engine) {
  if (!buttonEl) {
    return;
  }
  const items = ui.storageManager?.getDailyBountiesState?.()?.items;
  const next = !engine.isCustomPuzzle && Array.isArray(items)
    ? items.find((item) => !item.completed)
    : null;
  if (!next) {
    buttonEl.classList.add('hidden');
    return;
  }
  const title = t(`modals.play.bounties.items.${next.id}.title`, { target: formatNumber(next.target) });
  buttonEl.dataset.bountyMode = next.mode || '';
  buttonEl.dataset.bountyEvent = next.event || '';
  setTextIfChanged(buttonEl, t('modals.play.bounties.nextCta', { title }));
  buttonEl.classList.remove('hidden');
}

function syncPauseModal(ui, engine, transitionedState) {
  if (engine.state !== GAME_STATES.PAUSED || ui.isRunHeldByUi() || ui.isAnyOverlayModalOpen()) {
    ui.elements.modalPause.classList.add('hidden');
    return;
  }
  ui.elements.btnEditPuzzlePause?.classList.toggle('hidden', !engine.isCustomPuzzle);
  setTextIfChanged(ui.elements.pauseInstructionTip, t(engine.getModeBehavior().getPauseTipKey()));
  ui.updateInputHints();
  if (ui.elements.pauseLevelTip) {
    if (engine.levelTutorialKey) {
      setTextIfChanged(ui.elements.pauseLevelTip, t('modals.pause.levelTip', { tip: t(engine.levelTutorialKey) }));
      ui.elements.pauseLevelTip.classList.remove('hidden');
    } else {
      ui.elements.pauseLevelTip.classList.add('hidden');
    }
  }
  if (transitionedState) {
    ui.saveLastFocusedElement();
  }
  ui.elements.modalPause.classList.remove('hidden');
  if (transitionedState && ui.elements.btnResume) {
    ui.elements.btnResume.focus();
  }
}

function syncVictoryPresentation(ui, engine, stars, maxStars, isNewRecord) {
  if (!ui.isVictoryPresented) {
    ui.isVictoryPresented = true;
    ui.buildVictoryStars(stars, maxStars);
    ui.startScoreCountUp(engine.score, isNewRecord);
    return;
  }
  ui.elements.victoryScore?.classList.toggle('is-new-record', isNewRecord);
  if (ui.scoreCountUpFrame === null) {
    setTextIfChanged(ui.elements.victoryScore, ui.formatVictoryScoreText(engine.score, isNewRecord));
  }
  setTextIfChanged(ui.victoryStarsLabel, t('modals.victory.stats.stars', { stars, maxStars }));
}

function syncVictoryNextStarHint(ui, summary) {
  const hintEl = ui.elements.victoryNextStar;
  if (!hintEl || !summary) {
    return;
  }
  hintEl.classList.remove('hidden');
  if (summary.nextStarTarget !== null && summary.nextStarTarget !== undefined) {
    hintEl.textContent = t('modals.victory.nextStarHint', {
      star: summary.nextStarNumber,
      target: formatNumber(summary.nextStarTarget),
      points: formatNumber(summary.pointsToNextStar)
    });
    hintEl.classList.remove('is-all-stars');
    return;
  }
  hintEl.textContent = t('modals.victory.allStarsEarned');
  hintEl.classList.add('is-all-stars');
}

function revealVictoryContent(ui, engine, summary, isVictoryJustRevealed) {
  // The run is over: the menu goes away without resuming anything.
  ui.closeDrawer({ resume: false });
  const stars = summary.stars || engine.computeStars(engine.score);
  const maxStars = ui.gameConfig.scoring.maxStars;
  syncVictoryPresentation(ui, engine, stars, maxStars, Boolean(summary.isNewRecord));
  syncVictoryNextStarHint(ui, summary);
  setTextIfChanged(
    ui.elements.victoryBonus,
    t('modals.victory.stats.shotsBonus', {
      bonus: formatNumber(summary.victoryBonus || 0),
      coins: formatNumber(summary.earnedCoins || 0)
    })
  );
  ui.updateNextLevelButton(engine);
  const unlockedModes = summary.unlockedModes ?? [];
  const unlockText = formatUnlockedModesText(unlockedModes, t);
  if (ui.elements.victoryUnlock) {
    setTextIfChanged(ui.elements.victoryUnlock, unlockText);
    ui.elements.victoryUnlock.classList.toggle('hidden', !unlockText);
  }
  if (isVictoryJustRevealed) {
    ui.saveLastFocusedElement();
    const victoryResult = t('hud.announcer.round.victory', { score: formatNumber(engine.score), stars, maxStars });
    const unlockedNames = formatUnlockedModeNames(unlockedModes, t);
    ui.announce(unlockedNames ? `${victoryResult} ${t('hud.announcer.modeUnlocked', { modes: unlockedNames })}` : victoryResult);
  }
  ui.elements.modalVictory.classList.remove('hidden');
  if (isVictoryJustRevealed) {
    if (engine.isCustomPuzzle && engine.customPuzzleSpec) {
      ui.markCustomPuzzleVerified?.(engine.customPuzzleSpec);
    }
    ui.elements.btnEditPuzzleVictory?.classList.toggle('hidden', !engine.isCustomPuzzle);
    syncNextContractCta(ui, ui.elements.btnNextContractVictory, engine);
    const nextButton = ui.elements.btnNextLevel;
    // Hidden after the last Puzzle stage: the other-modes button takes the focus.
    ui.focusInTopModal(nextButton?.classList.contains('hidden') ? ui.elements.btnLevelsVictory : nextButton);
  }
}

function syncVictoryModal(ui, engine, extra) {
  // The modal waits for the post-victory celebration, and for any menu opened meanwhile:
  // closing that menu reveals it (see closeOverlayModal).
  const canRevealVictory =
    engine.state === GAME_STATES.VICTORY
    && !engine.isVictoryCelebrating()
    && !ui.isAnyOverlayModalOpen();
  const isVictoryJustRevealed = canRevealVictory && !ui.isVictoryModalRevealed;
  if (engine.state !== GAME_STATES.VICTORY || canRevealVictory) {
    ui.isVictoryModalRevealed = canRevealVictory;
  }
  if (engine.state !== GAME_STATES.VICTORY && ui.isVictoryPresented) {
    ui.isVictoryPresented = false;
    ui.stopScoreCountUp();
  }
  if (canRevealVictory) {
    revealVictoryContent(ui, engine, engine.victorySummary || extra, isVictoryJustRevealed);
  }
}

function syncGameOverActionButtons(ui, engine) {
  if (ui.elements.gameOverDailyNext) {
    const isDaily = engine.mode === GAME_MODES.DAILY;
    if (isDaily) {
      ui.startDailyCountdown();
    }
    ui.elements.gameOverDailyNext.classList.toggle('hidden', !isDaily);
  }
  // Every mode but the campaign has a result worth sharing.
  ui.elements.btnShareGameOver?.classList.toggle('hidden', engine.mode === GAME_MODES.CAMPAIGN);
  ui.elements.btnDailyHistoryGameOver?.classList.toggle('hidden', engine.mode !== GAME_MODES.DAILY);
  if (ui.elements.btnContinueGameOver) {
    const canContinue = Boolean(engine.canContinueOutOfShots?.());
    if (canContinue) {
      const pack = engine.getContinuePackSpec();
      setTextIfChanged(
        ui.elements.btnContinueGameOver,
        t('modals.gameOver.button.continueShots', { shots: formatNumber(pack.shots), cost: formatNumber(pack.costCoins) })
      );
      ui.elements.btnContinueGameOver.disabled = ui.storageManager.getCoins() < pack.costCoins;
    }
    ui.elements.btnContinueGameOver.classList.toggle('hidden', !canContinue);
  }
  if (ui.elements.btnSameSeedGameOver) {
    const hasFluxSeed = engine.mode === GAME_MODES.FLUX && Boolean(engine.fluxSeed);
    if (hasFluxSeed) {
      setTextIfChanged(ui.elements.btnSameSeedGameOver, t('modals.gameOver.button.sameSeed', { seed: engine.fluxSeed }));
    }
    ui.elements.btnSameSeedGameOver.classList.toggle('hidden', !hasFluxSeed);
  }
  ui.elements.btnEditPuzzleGameOver?.classList.toggle('hidden', !engine.isCustomPuzzle);
  syncNextContractCta(ui, ui.elements.btnNextContractGameOver, engine);
}

function syncGameOverStatsSummary(ui, engine, extra, bestScore) {
  const summary = engine.gameOverSummary;
  const reasonKey = gameOverReasonKey(extra.gameOverReason || summary?.reasonKey);
  const scoreText = formatNumber(engine.score);
  setTextIfChanged(ui.elements.gameOverReason, t(reasonKey));
  setTextIfChanged(ui.elements.gameOverScore, t('modals.gameOver.stats.score', { score: scoreText }));
  const highScoreText = t('modals.gameOver.stats.highScore', {
    highScore: formatNumber(Math.max(bestScore, engine.score))
  });
  const isNewRecord = Boolean(summary?.isNewRecord);
  setTextIfChanged(
    ui.elements.gameOverBest,
    isNewRecord ? `${highScoreText} - ${t('modals.gameOver.stats.newRecordBadge')}` : highScoreText
  );
  ui.elements.gameOverBest?.classList.toggle('is-new-record', isNewRecord);
  if (ui.elements.gameoverRemaining) {
    const showRemaining = engine.usesShotBudget() && summary?.remainingSpheres > 0;
    if (showRemaining) {
      setTextIfChanged(
        ui.elements.gameoverRemaining,
        t('modals.gameOver.stats.remainingSpheres', { count: formatNumber(summary.remainingSpheres) })
      );
    }
    ui.elements.gameoverRemaining.classList.toggle('hidden', !showRemaining);
  }
  if (ui.elements.gameOverStage) {
    const stageSummaryText = ui.formatGameOverStageSummary(engine, summary);
    if (stageSummaryText) {
      setTextIfChanged(ui.elements.gameOverStage, stageSummaryText);
    }
    ui.elements.gameOverStage.classList.toggle('hidden', !stageSummaryText);
  }
  let nearMissText = '';
  if (ui.elements.gameOverNearMiss) {
    nearMissText = formatNearMissText(summary?.nearMiss);
    if (nearMissText) {
      setTextIfChanged(ui.elements.gameOverNearMiss, nearMissText);
    }
    ui.elements.gameOverNearMiss.classList.toggle('hidden', !nearMissText);
  }
  const duelText = ui.refreshGameOverDuel(summary);
  return { reasonKey, scoreText, nearMissText, duelText };
}

function syncGameOverModal(ui, engine, extra, bestScore, transitionedState) {
  if (engine.state !== GAME_STATES.GAME_OVER || engine.mode !== GAME_MODES.DAILY) {
    ui.stopDailyCountdown();
  }
  if (engine.state !== GAME_STATES.GAME_OVER) {
    ui.elements.modalGameOver.classList.add('hidden');
    return;
  }

  ui.closeDrawer({ resume: false });
  const { reasonKey, scoreText, nearMissText, duelText } = syncGameOverStatsSummary(ui, engine, extra, bestScore);
  syncGameOverActionButtons(ui, engine);
  if (transitionedState) {
    ui.shareCopied = false;
    ui.refreshChallengeUrl();
    ui.updateShareButtonLabel();
    ui.elements.gameOverShareFallback?.classList.add('hidden');
    ui.saveLastFocusedElement();
    const gameOverResult = t('hud.announcer.round.gameOver', { reason: t(reasonKey), score: scoreText });
    const roundResult = duelText ? `${gameOverResult} ${duelText}` : gameOverResult;
    ui.announce(
      nearMissText
        ? t('hud.announcer.round.withNearMiss', { result: roundResult, nearMiss: nearMissText })
        : roundResult
    );
  }
  ui.elements.modalGameOver.classList.remove('hidden');
  if (transitionedState) {
    ui.focusInTopModal(ui.elements.btnRetry);
  }
}

function syncRoundStateModals(ui, engine, extra, bestScore, transitionedState) {
  syncPauseModal(ui, engine, transitionedState);
  syncFluxPerkModal.call(ui, engine);
  syncVictoryModal(ui, engine, extra);
  syncGameOverModal(ui, engine, extra, bestScore, transitionedState);
}

function refreshFooterAndDrawerSync(ui, engine, transitionedState) {
  // During a duel the rival badge takes the best-run marker's place in the badge row.
  const isDuelBadgeShown = ui.refreshGhostBadge(engine);
  const bestRunText = engine.state !== GAME_STATES.VICTORY && engine.state !== GAME_STATES.GAME_OVER && !isDuelBadgeShown
    ? formatBestRunMarker(engine.getRunBestMarker?.())
    : '';
  if (ui.isDuelCardOpen()) {
    ui.renderDuelCard();
  }
  if (ui.elements.bestRunBadge) {
    setTextIfChanged(ui.elements.bestRunBadge, bestRunText);
    ui.elements.bestRunBadge.classList.toggle('hidden', !bestRunText);
  }
  setTextIfChanged(
    ui.elements.compactInfo,
    t('hud.stats.compactLine', {
      mode: ui.elements.modeBanner.textContent,
      coins: ui.elements.coinsValue.textContent,
      best: ui.elements.highScoreValue.textContent
    })
  );
  const transitionedRoundEnd = transitionedState
    && (engine.state === GAME_STATES.VICTORY || engine.state === GAME_STATES.GAME_OVER);
  updateQuotaWarning(ui, engine, transitionedRoundEnd);
  ui.syncDrawerStats();
}

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

  /**
   * Merge Basin event badge: the running event with the drops it has left, else the one
   * telegraphed for the next drop. Hidden outside the Basin.
   * @param {object} engine - Game engine.
   */
  refreshMergeEventBadge(engine) {
    const badge = this.elements.mergeEventBadge;
    const view = engine.getMergeEventState?.() ?? null;
    this.announceMergeShape(engine.getMergeShapeState?.() ?? null);
    this.announceMergeSpecial(engine.getMergeSpecialState?.() ?? null);
    if (!badge) {
      return;
    }
    this.announceMergeEventChanges(view);
    const shown = view?.active ?? view?.upcoming ?? null;
    if (!shown) {
      badge.classList.add('hidden');
      return;
    }
    const icon = t(getMergeEventTextKey(shown, 'icon'));
    const name = t(getMergeEventTextKey(shown, 'name'));
    if (view.active) {
      const count = view.active.dropsLeft;
      const label = t(`hud.stats.mergeEvent.aria.${count === 1 ? 'one' : 'other'}`, { name, count });
      setTextIfChanged(badge, t('hud.stats.mergeEvent.active', { icon, count }));
      setAttributeIfChanged(badge, 'aria-label', label);
      setAttributeIfChanged(badge, 'title', label);
    } else {
      const label = t('hud.stats.mergeEvent.upcomingAria', { name });
      setTextIfChanged(badge, t('hud.stats.mergeEvent.upcoming', { icon, next: t('hud.stats.mergeEvent.next') }));
      setAttributeIfChanged(badge, 'aria-label', label);
      setAttributeIfChanged(badge, 'title', label);
    }
    badge.classList.remove('hidden');
  },

  /**
   * Merge Basin contract chip: the goal with its progress and the drops left. Hidden outside
   * the Basin and between contracts.
   * @param {object} engine - Game engine.
   */
  refreshMergeContractBadge(engine) {
    const badge = this.elements.mergeContractBadge;
    const view = engine.getMergeContractState?.() ?? null;
    this.announceMergeContractChanges(view);
    if (!badge) {
      return;
    }
    const contract = view?.active ?? null;
    if (!contract) {
      badge.classList.add('hidden');
      return;
    }
    const params = {
      target: contract.target,
      progress: contract.progress,
      count: contract.dropsLeft
    };
    const label = t(`hud.stats.mergeContract.aria.${contract.type}.${getMergeContractPluralKey(contract.dropsLeft)}`, params);
    setTextIfChanged(badge, t(`hud.stats.mergeContract.${contract.type}`, params));
    setAttributeIfChanged(badge, 'aria-label', label);
    setAttributeIfChanged(badge, 'title', label);
    badge.classList.remove('hidden');
  },

  /**
   * Polite announcements for the Basin contracts: once when one starts and once when it ends
   * (success or failure, never both), never per drop. The first refresh of a run only records.
   * @param {{contractCount: number, active: object|null, result: object|null}|null} view - Contract view.
   */
  announceMergeContractChanges(view) {
    if (!view) {
      this.mergeContractAnnouncerState = null;
      return;
    }
    // A lower contract count means a new run took over: record its state, announce nothing.
    const previous = this.mergeContractAnnouncerState;
    const seen = previous && view.contractCount >= previous.contractCount ? previous : null;
    this.mergeContractAnnouncerState = {
      contractCount: view.contractCount,
      resultId: view.result?.id ?? null
    };
    if (!seen) {
      return;
    }
    if (view.result && view.result.id !== seen.resultId) {
      const key = view.result.outcome === MERGE_CONTRACT_OUTCOMES.SUCCESS
        ? 'gameplay.feedback.merge.contractSuccess'
        : 'gameplay.feedback.merge.contractFailure';
      this.announce(t(key, { points: view.result.points }));
    } else if (view.active && view.contractCount > seen.contractCount) {
      const { type, target, dropsLeft } = view.active;
      this.announce(t(
        `gameplay.feedback.merge.contractStart.${type}.${getMergeContractPluralKey(dropsLeft)}`,
        { target, count: dropsLeft }
      ));
    }
  },

  /**
   * Polite announcement of the Basin shape, once per fresh run (a restored run has no serial).
   * @param {{shapeId: string, announceSerial: number|null}|null} view - Shape view.
   */
  announceMergeShape(view) {
    if (!view) {
      this.mergeShapeAnnouncedSerial = null;
      return;
    }
    if (view.announceSerial === null || view.announceSerial === this.mergeShapeAnnouncedSerial) {
      return;
    }
    this.mergeShapeAnnouncedSerial = view.announceSerial;
    this.announce(t('gameplay.feedback.merge.shapeAnnounce', {
      name: t(`gameplay.merge.shapes.${view.shapeId}.name`),
      description: t(`gameplay.merge.shapes.${view.shapeId}.description`)
    }));
  },

  /**
   * Polite announcement of a special sphere, once per kind and run (the engine only raises a
   * new serial the first time a kind reaches the launcher).
   * @param {{kind: string|null, announceSerial: number|null}|null} view - Special view.
   */
  announceMergeSpecial(view) {
    if (!view) {
      this.mergeSpecialAnnouncedSerial = null;
      return;
    }
    if (view.announceSerial === null || view.announceSerial === this.mergeSpecialAnnouncedSerial) {
      return;
    }
    this.mergeSpecialAnnouncedSerial = view.announceSerial;
    this.announce(t('gameplay.feedback.merge.specialAnnounce', {
      name: t(`gameplay.merge.specials.${view.kind}.name`),
      description: t(`gameplay.merge.specials.${view.kind}.description`)
    }));
  },

  /**
   * Polite announcements for the Basin event cycle: once when an event is telegraphed, once
   * when it starts and once when it ends, never per drop. The first refresh only records.
   */
  announceMergeEventChanges(view) {
    if (!view) {
      this.mergeEventAnnouncerState = null;
      return;
    }
    const keyOf = (event) => (event ? `${event.id}:${event.direction}` : null);
    // A lower event count means a new run took over: record its state, announce nothing.
    const previous = this.mergeEventAnnouncerState;
    const seen = previous && view.eventCount >= previous.eventCount ? previous : null;
    this.mergeEventAnnouncerState = {
      eventCount: view.eventCount,
      activeKey: keyOf(view.active),
      upcomingKey: keyOf(view.upcoming),
      active: view.active
    };
    if (!seen) {
      return;
    }
    const current = this.mergeEventAnnouncerState;
    if (current.activeKey && current.activeKey !== seen.activeKey) {
      this.announce(t('gameplay.feedback.merge.eventStartAnnounce', {
        name: t(getMergeEventTextKey(view.active, 'name')),
        description: t(getMergeEventTextKey(view.active, 'description'))
      }));
    } else if (!current.activeKey && seen.activeKey) {
      this.announce(t('gameplay.feedback.merge.eventEnd', {
        name: t(getMergeEventTextKey(seen.active, 'name'))
      }));
    } else if (current.upcomingKey && current.upcomingKey !== seen.upcomingKey) {
      this.announce(t('gameplay.feedback.merge.eventUpcoming', {
        name: t(getMergeEventTextKey(view.upcoming, 'name'))
      }));
    }
  },

  /**
   * Polite announcements for the Basin overflow line: once when a step is telegraphed and
   * once when the line comes down, never per drop. The first refresh of a run only records.
   * @param {{lineOffsetPx: number, pendingOffsetPx: number|null, pendingDropsLeft: number}|null} view - Pressure view.
   */
  announceMergePressureChanges(view) {
    if (!view) {
      this.mergePressureAnnouncerState = null;
      return;
    }
    // A lower offset means a new run took over: record its state, announce nothing.
    const previous = this.mergePressureAnnouncerState;
    const seen = previous && view.lineOffsetPx >= previous.lineOffsetPx ? previous : null;
    this.mergePressureAnnouncerState = {
      lineOffsetPx: view.lineOffsetPx,
      pending: view.pendingOffsetPx !== null
    };
    if (!seen) {
      return;
    }
    if (view.lineOffsetPx > seen.lineOffsetPx) {
      this.announce(t('gameplay.feedback.merge.pressureStepAnnounce'));
    } else if (view.pendingOffsetPx !== null && !seen.pending) {
      const count = view.pendingDropsLeft;
      this.announce(t(`gameplay.feedback.merge.pressureWarning.${count === 1 ? 'one' : 'other'}`, { count }));
    }
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

  /**
   * Magnetar bosses: in Boss Rush the Moorings take the shots slot (Flux keeps its shots and
   * shows the Moorings in the banner), and the telegraph chip names the next behaviour with a glyph and words (never colour alone). The chip is aria-hidden: the
   * announcements are the one live channel.
   * @param {object} engine - Game engine.
   * @param {object|null} view - engine.getMagnetarView().
   */
  refreshMagnetarHud(engine, view) {
    const chip = this.elements.magnetarTelegraph;
    if (view && engine.mode === GAME_MODES.BOSS_RUSH && !engine.getSagState?.().active) {
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.shots.mooringsLabel'));
      }
      setTextIfChanged(this.elements.shotsValue, formatNumber(view.moorings));
      this.elements.shotsValue.classList.toggle('warning', view.moorings <= 1);
    }
    if (!chip) {
      return;
    }
    const armed = view && view.phase === MAGNETAR_PHASES.ARMED ? view.armed : null;
    if (!armed) {
      chip.classList.add('hidden');
      return;
    }
    const glyph = t(`modals.shop.codex.magnetarPatterns.patterns.${armed}.icon`);
    const behaviour = t(`gameplay.magnetar.behaviour.${armed}`);
    setTextIfChanged(chip, `${glyph} ${t('hud.magnetar.next', { behaviour })}`);
    chip.classList.remove('hidden');
  },

  /** Polite announcement of a Magnetar event: arming (with its counter), last Mooring, fall. */
  announceMagnetarEvent(announcement) {
    if (!announcement?.kind) {
      return;
    }
    if (announcement.kind === 'armed') {
      const id = announcement.behaviour;
      this.announce(
        t('hud.announcer.magnetar.armed', {
          behaviour: t(`gameplay.magnetar.behaviour.${id}`),
          counter: t(`gameplay.magnetar.counter.${id}`)
        })
      );
      return;
    }
    this.announce(t(`hud.announcer.magnetar.${announcement.kind}`));
  },

  refresh(engine, extra = {}) {
    // One-shot extras (an unlocked achievement, a cleared Flux stage) must not replay
    // when refresh is re-run with lastExtra (language change, input mode change, shop
    // purchase): they are read from this call only.
    const { oneShot, persistentExtra } = splitRefreshExtra(extra);
    this.lastExtra = persistentExtra;
    const magnetarView = engine.getMagnetarView?.() ?? null;

    refreshHeaderMetrics(this, engine);
    refreshModeSelectionHighlights(this, engine);
    const bestScore = refreshOverchargeAndBestScore(this, engine);
    refreshLauncherControls.call(this, engine);
    refreshModeHudSection.call(this, engine, magnetarView);
    refreshLiveStatusBadgesAndBanners(this, engine);

    const transitionedState = this.prevEngineState !== engine.state;
    this.prevEngineState = engine.state;

    announceRefreshEvents.call(this, extra, oneShot);
    const modalMaskBefore = getRoundModalVisibilityMask(this);
    syncRoundStateModals(this, engine, extra, bestScore, transitionedState);
    const modalMaskAfter = getRoundModalVisibilityMask(this);
    refreshFooterAndDrawerSync(this, engine, transitionedState);
    if (this.lastRoundModalMask === undefined || modalMaskAfter !== modalMaskBefore || modalMaskAfter !== this.lastRoundModalMask) {
      this.lastRoundModalMask = modalMaskAfter;
      this.syncModalInertState();
    }
  },

  /** Best score of the given Weekly Flux week (this week when none is given), 0 when none yet. */
  getWeeklyFluxBestScore(weekKey) {
    const key = weekKey || getUtcIsoWeekKey(Date.now());
    return this.storageManager?.getWeeklyFluxBest?.(key)?.score || 0;
  },

  /**
   * Locked, new and normal look of every gated mode card of the Play hub, and the New badge of
   * the drawer's Play button. A locked card stays focusable (aria-disabled, not disabled).
   * Daily is never gated, so the Daily card is not touched here.
   * @param {Object<string, {unlocked?: boolean, isNew?: boolean, requiredLevel?: number}>} access
   *   Storage getModeAccess().
   */
  refreshModeLocks(access) {
    let isAnyModeNew = false;
    for (const [mode, spec] of Object.entries(ARCADE_CARD_SPECS)) {
      const card = this.elements[spec.card];
      if (!card) {
        continue;
      }
      const lock = describeModeLock(mode, access, t);
      // Weekly Flux opens with Flux or at its own level, but it is not a new mode.
      const isNew = lock.isNew && spec.showNew !== false;
      isAnyModeNew = isAnyModeNew || isNew;
      setModeLabel(
        card.querySelector('.arcade-card-title'),
        lock.isLocked ? lock.label : t(spec.titleKey),
        isNew ? lock.newBadge : ''
      );
      setTextIfChanged(
        card.querySelector('.arcade-card-desc'),
        lock.isLocked ? t('modals.levelSelect.arcade.lockedDesc', { level: lock.level }) : t(spec.descKey)
      );
      this.refreshModeCardRecord(spec, lock.isLocked);
      card.classList.toggle(MODE_LOCKED_CLASS, lock.isLocked);
      card.classList.toggle(MODE_NEW_CLASS, isNew);
      if (lock.isLocked) {
        setAttributeIfChanged(card, 'aria-disabled', 'true');
        setAttributeIfChanged(card, 'aria-label', lock.ariaLabel);
        setAttributeIfChanged(card, 'title', lock.hint);
      } else {
        card.removeAttribute('aria-disabled');
        card.removeAttribute('aria-label');
        card.removeAttribute('title');
      }
      // Only the toggle follows the lock; the hub alone opens and closes the strip.
      if (mode === GAME_MODES.PUZZLE) {
        this.elements.btnPuzzleStagesToggle?.classList.toggle('hidden', lock.isLocked);
      }
    }
    this.refreshPlayNewBadge(isAnyModeNew);
  },

  /**
   * Shows or hides the record line (or reward chip) of a hub card: hidden while the card is
   * locked; a chip also stays hidden when it has nothing to say.
   * @param {{best: string, isChip?: boolean}} spec - Entry of ARCADE_CARD_SPECS.
   * @param {boolean} isLocked - Whether the card is locked.
   */
  refreshModeCardRecord(spec, isLocked) {
    const record = this.elements[spec.best];
    if (!record) {
      return;
    }
    if (spec.isChip) {
      writeRewardChip(record, isLocked ? { text: '', ariaLabel: '' } : this.describeWeeklyRewardChip());
      return;
    }
    record.classList.toggle('hidden', isLocked);
  },

  /** The drawer's Play button says, to sight and to screen readers, that a mode just opened. */
  refreshPlayNewBadge(isAnyModeNew) {
    const button = this.elements.btnPlay;
    this.elements.playNewBadge?.classList.toggle('hidden', !isAnyModeNew);
    if (!button) {
      return;
    }
    button.classList.toggle(MODE_NEW_CLASS, isAnyModeNew);
    if (isAnyModeNew) {
      setAttributeIfChanged(button, 'aria-label', t('app.drawer.button.playNewAria'));
    } else {
      button.removeAttribute('aria-label');
    }
  },
};
