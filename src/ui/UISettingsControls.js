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

import { GAME_MODES } from '../core/Constants.js';
import { i18n, t, formatNumber } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { buildShareText, formatDailyCountdown, getMsUntilNextDaily } from '../game/DailyShare.js';
import {
  SHARE_ABORT_ERROR_NAME,
  isFullscreenSupported,
  isDocumentFullscreen,
  REDUCED_MOTION_CLASS,
  HIGH_CONTRAST_CLASS,
  formatStreakGraceText,
  computeTiltShare,
  setTextIfChanged,
  setAttributeIfChanged
} from './UIHelpers.js';

/** Methods installed on UIManager.prototype by UIManager.js. */
export const uiSettingsControlMethods = {
  /**
   * Toggle buttons keep a stable accessible name and expose their state
   * through aria-pressed; the tooltip still spells the current value out.
   */
  applyToggleState(buttons, { label, ariaLabel, tooltip, pressed }) {
    for (const btn of buttons) {
      if (btn) {
        setTextIfChanged(btn, label);
        setAttributeIfChanged(btn, 'aria-label', ariaLabel);
        setAttributeIfChanged(btn, 'aria-pressed', String(pressed));
        btn.title = tooltip;
        // Touch screens never show the title, so the menu and Pause copies spell the state out.
        setTextIfChanged(document.querySelector(`[data-caption-for="${btn.id}"]`), tooltip);
      }
    }
  },

  updateSoundButton() {
    const isMuted = this.audioManager.isMuted();
    this.applyToggleState([this.elements.btnSound], {
      label: t(isMuted ? 'app.nav.button.soundOff' : 'app.nav.button.soundOn'),
      ariaLabel: t('app.nav.button.soundAria'),
      tooltip: t(isMuted ? 'app.nav.button.soundOffAria' : 'app.nav.button.soundOnAria'),
      pressed: !isMuted
    });
  },

  updateContrastButton() {
    const isHigh = this.storageManager.getHighContrast();
    this.applyToggleState([this.elements.btnContrast], {
      label: t(isHigh ? 'app.nav.button.contrastOn' : 'app.nav.button.contrastOff'),
      ariaLabel: t('app.nav.button.contrastAria'),
      tooltip: t(isHigh ? 'app.nav.button.contrastOnAria' : 'app.nav.button.contrastOffAria'),
      pressed: isHigh
    });
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.toggle(HIGH_CONTRAST_CLASS, isHigh);
    }
  },

  updatePatternsButton() {
    const isOn = this.storageManager.getColorPatterns();
    this.applyToggleState([this.elements.btnPatterns], {
      label: t(isOn ? 'app.nav.button.patternsOn' : 'app.nav.button.patternsOff'),
      ariaLabel: t('app.nav.button.patternsAria'),
      tooltip: t(isOn ? 'app.nav.button.patternsOnAria' : 'app.nav.button.patternsOffAria'),
      pressed: isOn
    });
  },

  /**
   * Tilt control exists only on touch devices that report their orientation, and is on
   * unless the player turned it off (tilt.enabledByDefault). Where the browser asks
   * permission (iOS), the request must come from a tap: it is made on the first tap on the
   * board, and a refusal is stored as the player's choice.
   */
  setupTiltControl() {
    this.isTiltActive = false;
    this.handleOrientation = (event) => {
      const screenAngle = typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0;
      this.engine.setTilt(computeTiltShare(event, screenAngle, this.gameConfig.tilt));
    };
    const isSupported =
      typeof window !== 'undefined' &&
      typeof window.DeviceOrientationEvent !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(this.gameConfig.tilt.touchMediaQuery).matches;
    this.elements.btnTilt?.closest('.pause-setting')?.classList.toggle('hidden', !isSupported);
    // Named even while hidden, so no audit tool finds an unnamed button.
    this.updateTiltButton();
    if (!isSupported) {
      return;
    }
    const needsPermission = typeof window.DeviceOrientationEvent.requestPermission === 'function';
    const wantsTilt = this.storageManager.getTilt(this.gameConfig.tilt.enabledByDefault);
    if (wantsTilt && !needsPermission) {
      this.setTiltActive(true);
    } else if (wantsTilt) {
      this.requestTiltOnFirstTap();
    }
    const toggleTilt = async () => {
      if (this.engine.isTiltLocked?.()) {
        return;
      }
      const next = !this.isTiltActive;
      if (next && needsPermission) {
        const answer = await window.DeviceOrientationEvent.requestPermission().catch(() => 'denied');
        if (answer !== 'granted') {
          return;
        }
      }
      this.storageManager.setTilt(next);
      this.setTiltActive(next);
    };
    this.elements.btnTilt?.addEventListener('click', toggleTilt);
    this.updateTiltButton();
  },

  /** Asks the orientation permission on the first tap on the board (iOS needs a tap). */
  requestTiltOnFirstTap() {
    const canvas = this.elements.gameCanvas;
    if (!canvas) {
      return;
    }
    const askOnce = async () => {
      if (this.isTiltActive) {
        return;
      }
      const answer = await window.DeviceOrientationEvent.requestPermission().catch(() => 'denied');
      const isGranted = answer === 'granted';
      this.storageManager.setTilt(isGranted);
      this.setTiltActive(isGranted);
    };
    canvas.addEventListener('pointerup', askOnce, { once: true });
  },

  setTiltActive(isActive) {
    this.isTiltActive = isActive;
    if (isActive) {
      window.addEventListener('deviceorientation', this.handleOrientation);
    } else {
      window.removeEventListener('deviceorientation', this.handleOrientation);
      this.engine.setTilt(0);
    }
    this.updateTiltButton();
  },

  updateTiltButton() {
    const isOn = Boolean(this.isTiltActive);
    const isLocked = Boolean(this.engine?.isTiltLocked?.());
    this.applyToggleState([this.elements.btnTilt], {
      label: t(isOn && !isLocked ? 'app.nav.button.tiltOn' : 'app.nav.button.tiltOff'),
      ariaLabel: t('app.nav.button.tiltAria'),
      tooltip: t(isLocked ? 'app.nav.button.tiltLockedAria' : isOn ? 'app.nav.button.tiltOnAria' : 'app.nav.button.tiltOffAria'),
      pressed: isOn && !isLocked
    });
    // Locked runs ignore the tilt; the stored preference stays untouched for other runs.
    const btn = this.elements.btnTilt;
    if (btn) {
      btn.disabled = isLocked;
      setAttributeIfChanged(btn, 'aria-disabled', String(isLocked));
    }
  },

  updateMotionButton() {
    const isReduced = this.storageManager.getReducedMotion();
    this.applyToggleState([this.elements.btnMotion], {
      label: t(isReduced ? 'app.nav.button.motionReduced' : 'app.nav.button.motionOn'),
      ariaLabel: t('app.nav.button.motionAria'),
      tooltip: t(isReduced ? 'app.nav.button.motionReducedAria' : 'app.nav.button.motionOnAria'),
      pressed: isReduced
    });
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.toggle(REDUCED_MOTION_CLASS, isReduced);
    }
  },

  /** Moves to the next configured animation speed, wrapping after the last one. */
  cycleAnimationSpeed() {
    const speeds = this.gameConfig.defaults.animationSpeeds;
    const current = this.storageManager.getAnimationSpeed();
    const idx = speeds.indexOf(current);
    const nextSpeed = speeds[(idx + 1) % speeds.length];
    this.storageManager.setAnimationSpeed(nextSpeed);
    if (this.engine && typeof this.engine.setAnimationSpeed === 'function') {
      this.engine.setAnimationSpeed(nextSpeed);
    }
    this.updateAnimSpeedButton();
  },

  updateAnimSpeedButton() {
    const btn = this.elements?.btnAnimSpeed;
    if (!btn) {
      return;
    }
    const defaultSpeed = this.gameConfig.defaults.animationSpeed;
    const speed = this.storageManager?.getAnimationSpeed?.() ?? defaultSpeed;
    const shownSpeed = formatNumber(speed);
    const label = t('app.nav.button.animSpeed', { speed: shownSpeed });
    const ariaLabel = t('app.nav.button.animSpeedAria', { speed: shownSpeed });
    const caption = t('app.nav.button.animSpeedCaption', { speed: shownSpeed });
    setTextIfChanged(btn, label);
    setAttributeIfChanged(btn, 'aria-label', ariaLabel);
    btn.title = ariaLabel;
    btn.classList?.toggle?.('active', speed !== defaultSpeed);
    setTextIfChanged(document.querySelector(`[data-caption-for="${btn.id}"]`), caption);
  },

  /**
   * Wires the HUD and Settings fullscreen buttons where the browser exposes the
   * Fullscreen API, and keeps their state in sync with Escape or OS back gestures.
   */
  setupFullscreenControl() {
    const doc = typeof document === 'undefined' ? null : document;
    // An installed app launched in fullscreen display mode is already fullscreen: nothing to toggle.
    const isSupported = isFullscreenSupported(doc) && !this.isFullscreenDisplayMode();
    this.elements.btnFullscreen?.closest?.('.pause-setting')?.classList.toggle('hidden', !isSupported);
    this.elements.btnFullscreenHud?.classList.toggle('hidden', !isSupported);
    // Named even while hidden, so no accessibility audit finds an unnamed button.
    this.updateFullscreenButton();
    if (!isSupported || !doc) {
      return;
    }
    const syncState = () => {
      this.updateFullscreenButton();
    };
    doc.addEventListener?.('fullscreenchange', syncState);
    doc.addEventListener?.('webkitfullscreenchange', syncState);
    const onToggle = () => {
      this.toggleFullscreen();
    };
    this.elements.btnFullscreen?.addEventListener('click', onToggle);
    this.elements.btnFullscreenHud?.addEventListener('click', onToggle);
  },

  /** True when the installed app runs in the fullscreen display mode (manifest or OS choice). */
  isFullscreenDisplayMode() {
    const query = this.gameConfig?.defaults?.fullscreenDisplayModeMediaQuery;
    if (!query || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return Boolean(window.matchMedia(query).matches);
  },

  async toggleFullscreen() {
    const doc = typeof document === 'undefined' ? null : document;
    if (!isFullscreenSupported(doc)) {
      return;
    }
    if (isDocumentFullscreen(doc)) {
      const exitFn = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (typeof exitFn === 'function') {
        await Promise.resolve(exitFn.call(doc)).catch(() => {});
      }
    } else {
      const root = doc.documentElement;
      if (typeof root.requestFullscreen === 'function') {
        await Promise.resolve(root.requestFullscreen({ navigationUI: 'hide' })).catch(() => {});
      } else if (typeof root.webkitRequestFullscreen === 'function') {
        await Promise.resolve(root.webkitRequestFullscreen()).catch(() => {});
      }
    }
    this.updateFullscreenButton();
  },

  updateFullscreenButton() {
    const doc = typeof document === 'undefined' ? null : document;
    const isFull = isDocumentFullscreen(doc);
    this.applyToggleState([this.elements?.btnFullscreen, this.elements?.btnFullscreenHud], {
      label: t(isFull ? 'app.nav.button.fullscreenOn' : 'app.nav.button.fullscreenOff'),
      ariaLabel: t('app.nav.button.fullscreenAria'),
      tooltip: t(isFull ? 'app.nav.button.fullscreenOnAria' : 'app.nav.button.fullscreenOffAria'),
      pressed: isFull
    });
  },

  updateAimState(engine) {
    if (this.elements.cancelAimBanner) {
      this.elements.cancelAimBanner.classList.toggle('hidden', !engine.isAimCancelled);
    }
  },

  updateLanguageButton() {
    const locale = i18n.getLocale();
    const label = t('app.nav.button.language');
    const ariaLabel = t('app.nav.button.languageAria');
    const btn = this.elements.btnLang;
    if (btn) {
      const codeSpan = document.createElement('span');
      codeSpan.lang = locale;
      codeSpan.textContent = label;
      btn.replaceChildren(codeSpan);
      btn.setAttribute('aria-label', ariaLabel);
      btn.title = ariaLabel;
    }
    if (this.elements.btnDismissTutorial) {
      const dismissLabel = t('hud.tutorial.dismiss');
      this.elements.btnDismissTutorial.setAttribute('aria-label', dismissLabel);
      this.elements.btnDismissTutorial.title = dismissLabel;
    }
  },

  updateResetHintsFeedback() {
    const iconKey = this.hintsResetConfirmed ? 'app.nav.button.resetHintsDone' : 'app.nav.button.resetHints';
    const captionKey = this.hintsResetConfirmed
      ? 'app.nav.button.resetHintsDoneCaption'
      : 'app.nav.button.resetHintsCaption';
    const btn = this.elements?.btnResetHints;
    if (btn) {
      setTextIfChanged(btn, t(iconKey));
      setTextIfChanged(document.querySelector(`[data-caption-for="${btn.id}"]`), t(captionKey));
    }
  },

  updateShareButtonLabel() {
    if (this.elements?.btnShareGameOver) {
      setTextIfChanged(
        this.elements.btnShareGameOver,
        t(this.shareCopied ? 'modals.gameOver.button.shareCopied' : 'modals.gameOver.button.share')
      );
    }
  },

  updateDailyCountdownText() {
    if (!this.elements?.gameOverDailyNext) {
      return;
    }
    // The Daily seed is the UTC date, so the next challenge starts at UTC midnight.
    const { hours, minutes } = formatDailyCountdown(getMsUntilNextDaily(Date.now()));
    const nextText = t('modals.gameOver.daily.nextIn', {
      hours: formatNumber(hours),
      minutes: formatNumber(minutes)
    });
    const streak = this.storageManager?.getDailyStreak?.() || 0;
    const todayKey = SeededRandom.getTodayDateKey();
    const graceText = formatStreakGraceText(streak, this.storageManager?.getDailyStreakGrace?.(todayKey), todayKey);
    const streakParts = [t('modals.gameOver.daily.streak', { streak: formatNumber(streak) }), graceText, nextText];
    const text = streak > 0 ? streakParts.filter(Boolean).join(' - ') : nextText;
    setTextIfChanged(this.elements.gameOverDailyNext, text);
  },

  stopDailyCountdown() {
    if (this.dailyCountdownTimer !== null) {
      clearInterval(this.dailyCountdownTimer);
      this.dailyCountdownTimer = null;
    }
  },

  startDailyCountdown() {
    this.updateDailyCountdownText();
    const refreshMs = this.gameConfig?.daily?.countdownRefreshMs;
    if (this.dailyCountdownTimer === null && refreshMs > 0) {
      this.dailyCountdownTimer = setInterval(() => {
        this.updateDailyCountdownText();
      }, refreshMs);
      this.dailyCountdownTimer?.unref?.();
    }
  },

  /**
   * Shares the finished run (Daily Challenge, Survival or Flux): the system share sheet when
   * there is one, else the clipboard, else a read-only field with the text selected for a
   * manual copy. The outcome is announced to screen readers. A tap while a share is under
   * way is ignored: a second share sheet request would be refused and wrongly fall back to
   * the clipboard.
   */
  async shareRunResult() {
    if (this.isSharing) {
      return;
    }
    this.isSharing = true;
    try {
      await this.shareRunResultOnce();
    } finally {
      this.isSharing = false;
    }
  },

  /** Sum of the owned Workshop levels, disclosed in a Flux share as assists. */
  getOwnedWorkshopLevelSum() {
    return Object.keys(this.gameConfig.upgrades || {}).reduce(
      (sum, upgradeKey) => sum + (this.storageManager.getUpgradeLevel(upgradeKey) || 0),
      0
    );
  },

  /** One share attempt of shareRunResult, without the in-progress guard. */
  async shareRunResultOnce() {
    const engine = this.engine;
    const shareConfig = this.gameConfig.share;
    const text = buildShareText(
      {
        mode: engine.mode,
        dateKey: engine.dailySeedKey,
        mutatorKey: engine.activeMutatorKey,
        wave: engine.waveCount,
        score: engine.score,
        waveLog: engine.waveLog,
        stage: engine.mode === GAME_MODES.CLASSIC ? engine.classicStage : engine.fluxStage,
        drops: engine.classicRailDropsTotal ?? 0,
        puzzleStage: engine.currentPuzzleStage,
        seed: engine.fluxSeed,
        isWeekly: engine.isWeeklyFluxRun === true,
        weekKey: engine.weeklyWeekKey ?? null,
        workshopLevels: this.getOwnedWorkshopLevelSum(),
        ammoBought: engine.specialAmmoBoughtInRun || 0,
        continues: engine.hasUsedContinue ? 1 : 0,
        url: shareConfig.url
      },
      shareConfig
    );
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
        this.announce(t('share.feedback.shared'));
        return;
      } catch (error) {
        if (error?.name === SHARE_ABORT_ERROR_NAME) {
          return;
        }
      }
    }
    let feedbackKey = 'share.feedback.manual';
    if (typeof navigator.clipboard?.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        this.shareCopied = true;
        this.updateShareButtonLabel?.();
        this.announce(t('share.feedback.copied'));
        return;
      } catch {
        feedbackKey = 'share.feedback.failed';
      }
    }
    this.showShareFallback(text);
    this.announce(t(feedbackKey));
  },

  /** Shows the share text in the game over window, selected and focused, ready to copy. */
  showShareFallback(text) {
    const field = this.elements.gameOverShareText;
    if (!field || !this.elements.gameOverShareFallback) {
      return;
    }
    field.value = text;
    this.elements.gameOverShareFallback.classList.remove('hidden');
    field.focus();
    field.select();
  },
};
