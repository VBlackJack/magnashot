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

import { GAME_MODES, INPUT_MODES } from '../core/Constants.js';
import { FULL_PERCENT } from './WorkshopView.js';
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

/** Recognizes one reversal on either screen axis and rearms only after a quiet interval. */
export function createShakeDetector(config) {
  let gravity = null;
  let peak = null;
  let quietSince = null;
  let latched = false;

  return (event) => {
    const time = event.timeStamp;
    let { x, y } = event.acceleration ?? {};
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const sample = event.accelerationIncludingGravity;
      if (!Number.isFinite(sample?.x) || !Number.isFinite(sample?.y)) {
        return false;
      }
      gravity ??= { x: sample.x, y: sample.y };
      const weight = config.gravitySmoothing;
      gravity.x = weight * gravity.x + (1 - weight) * sample.x;
      gravity.y = weight * gravity.y + (1 - weight) * sample.y;
      x = sample.x - gravity.x;
      y = sample.y - gravity.y;
    }

    const magnitude = Math.max(Math.abs(x), Math.abs(y));
    if (latched) {
      quietSince = magnitude <= config.quietAcceleration ? quietSince ?? time : null;
      if (quietSince !== null && time - quietSince >= config.quietWindowMs) {
        latched = false;
      }
      return false;
    }
    if (magnitude < config.peakAcceleration) {
      return false;
    }

    const axis = Math.abs(x) >= Math.abs(y) ? 'x' : 'y';
    const sign = Math.sign(axis === 'x' ? x : y);
    if (peak && peak.axis === axis && peak.sign !== sign && time - peak.time <= config.reversalWindowMs) {
      peak = null;
      quietSince = null;
      latched = true;
      return true;
    }
    peak = { axis, sign, time };
    return false;
  };
}

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

  refreshMergeShakeControls() {
    const button = this.elements.mergeShakeBtn;
    const remaining = this.engine.getMergeShakeRemaining?.() ?? null;
    if (button) {
      button.classList.toggle('hidden', remaining === null);
      button.disabled = remaining !== 0;
      if (remaining !== null) {
        const key = 'hud.launcher.shake';
        const label = remaining === 0
          ? t(`${key}.ready`)
          : t(remaining === 1 ? `${key}.chargingOne` : `${key}.charging`, { count: formatNumber(remaining) });
        setTextIfChanged(button.querySelector('.launcher-text'),
          this.inputMode === INPUT_MODES.POINTER
            ? t('hud.launcher.shortcutFormat', { label, key: t(`${key}.shortcut`) })
            : label);
        setTextIfChanged(button.querySelector('.launcher-caption'),
          t(remaining === 0 ? `${key}.label` : `${key}.compact`, { count: formatNumber(remaining) }));
        setAttributeIfChanged(button, 'aria-label', label);
        button.title = label;
      }
    }
    this.updateMergeShakeGestureSetting();
  },

  canReceiveMergeShakeInput() {
    return this.engine.getMergeShakeRemaining?.() != null
      && this.engine.isRunPlaying()
      && !document.hidden
      && !this.isDrawerOpen
      && !this.isAnyModalOpen()
      && !this.getSceneController();
  },

  tryMergeShake() {
    return this.canReceiveMergeShakeInput() && this.engine.tryMergeShake();
  },

  setupMergeShakeGesture() {
    const button = this.elements.btnMergeShakeGesture;
    this.mergeShakeGestureSupported = Boolean(window.isSecureContext
      && typeof window.DeviceMotionEvent === 'function'
      && window.matchMedia?.(this.gameConfig.tilt.touchMediaQuery).matches);
    this.mergeShakeGestureEnabled = this.mergeShakeGestureSupported && this.storageManager.getMergeShakeGesture();
    this.handleMergeShakeMotion = (event) => {
      if (this.detectMergeShake?.(event)) {
        this.tryMergeShake();
      }
    };
    if (this.mergeShakeGestureSupported) {
      button?.addEventListener('click', () => this.toggleMergeShakeGesture());
    }
    this.updateMergeShakeGestureSetting();
  },

  async toggleMergeShakeGesture() {
    if (this.mergeShakePermissionPending) {
      return;
    }
    const enable = !this.mergeShakeGestureEnabled;
    this.mergeShakePermissionDenied = false;
    if (enable && typeof window.DeviceMotionEvent.requestPermission === 'function') {
      this.mergeShakePermissionPending = true;
      this.updateMergeShakeGestureSetting();
      try {
        this.mergeShakePermissionDenied = (await window.DeviceMotionEvent.requestPermission()) !== 'granted';
      } catch {
        this.mergeShakePermissionDenied = true;
      } finally {
        this.mergeShakePermissionPending = false;
      }
    }
    this.mergeShakeGestureEnabled = enable && !this.mergeShakePermissionDenied;
    this.storageManager.setMergeShakeGesture(this.mergeShakeGestureEnabled);
    this.updateMergeShakeGestureSetting();
    this.syncMergeShakeGesture();
  },

  updateMergeShakeGestureSetting() {
    const button = this.elements.btnMergeShakeGesture;
    if (!button) {
      return;
    }
    const visible = this.mergeShakeGestureSupported && (this.engine.mergeShakePrototype
      || this.engine.getMergeShakeRemaining?.() != null);
    button.closest('.pause-setting')?.classList.toggle('hidden', !visible);
    const key = 'modals.settings.shakeGesture';
    const enabled = Boolean(this.mergeShakeGestureEnabled);
    this.applyToggleState([button], {
      label: t(`${key}.icon`),
      ariaLabel: t(`${key}.label`),
      tooltip: t(this.mergeShakePermissionDenied ? `${key}.denied` : `${key}.${enabled ? 'on' : 'off'}`),
      pressed: enabled
    });
    button.disabled = Boolean(this.mergeShakePermissionPending);
    setTextIfChanged(this.elements.mergeShakeGestureStatus, this.mergeShakePermissionDenied ? t(`${key}.denied`) : '');
  },

  syncMergeShakeGesture() {
    const run = this.mergeShakeGestureEnabled && this.canReceiveMergeShakeInput() ? this.engine.modeState : null;
    if (run === (this.mergeShakeGestureRun ?? null)) {
      return;
    }
    if (this.mergeShakeGestureRun) {
      window.removeEventListener('devicemotion', this.handleMergeShakeMotion);
    }
    this.mergeShakeGestureRun = run;
    this.detectMergeShake = run ? createShakeDetector(this.engine.modesConfig.merge.shake.gesture) : null;
    if (run) {
      window.addEventListener('devicemotion', this.handleMergeShakeMotion);
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
   * Applies the stored music settings to the audio manager and wires the Music, Music volume
   * and Resonance buttons. Music itself starts from the run, never from here.
   */
  setupPulseControls() {
    this.audioManager.setMusicEnabled?.(this.storageManager.getMusicEnabled());
    this.audioManager.setMusicVolume?.(this.storageManager.getMusicVolume());
    this.elements.btnMusic?.addEventListener('click', () => {
      this.toggleMusic();
    });
    this.elements.btnMusicVolume?.addEventListener('click', () => {
      this.cycleMusicVolume();
    });
    this.elements.btnResonance?.addEventListener('click', () => {
      this.toggleResonance();
    });
    this.updateMusicButton();
    this.updateMusicVolumeButton();
    this.updateResonanceButton();
  },

  toggleMusic() {
    const next = !this.storageManager.getMusicEnabled();
    this.storageManager.setMusicEnabled(next);
    this.audioManager.setMusicEnabled?.(next);
    this.updateMusicButton();
  },

  updateMusicButton() {
    const isOn = this.storageManager.getMusicEnabled();
    this.applyToggleState([this.elements.btnMusic], {
      label: t(isOn ? 'app.nav.button.musicOn' : 'app.nav.button.musicOff'),
      ariaLabel: t('app.nav.button.musicAria'),
      tooltip: t(isOn ? 'app.nav.button.musicOnAria' : 'app.nav.button.musicOffAria'),
      pressed: isOn
    });
  },

  /** Moves to the next configured music volume step, wrapping after the last one. */
  cycleMusicVolume() {
    const steps = this.gameConfig.defaults.musicVolumeSteps;
    const idx = steps.indexOf(this.storageManager.getMusicVolume());
    const next = steps[(idx + 1) % steps.length];
    this.storageManager.setMusicVolume(next);
    this.audioManager.setMusicVolume?.(next);
    this.updateMusicVolumeButton();
  },

  updateMusicVolumeButton() {
    const btn = this.elements?.btnMusicVolume;
    if (!btn) {
      return;
    }
    const defaultVolume = this.gameConfig.defaults.musicVolume;
    const volume = this.storageManager?.getMusicVolume?.() ?? defaultVolume;
    const percent = formatNumber(Math.round(volume * FULL_PERCENT));
    const label = t('app.nav.button.musicVolume', { volume: percent });
    const ariaLabel = t('app.nav.button.musicVolumeAria', { volume: percent });
    const caption = t('app.nav.button.musicVolumeCaption', { volume: percent });
    setTextIfChanged(btn, label);
    setAttributeIfChanged(btn, 'aria-label', ariaLabel);
    btn.title = ariaLabel;
    btn.classList?.toggle?.('active', volume !== defaultVolume);
    setTextIfChanged(document.querySelector(`[data-caption-for="${btn.id}"]`), caption);
  },

  toggleResonance() {
    this.storageManager.setResonanceEnabled(!this.storageManager.getResonanceEnabled());
    this.refreshPulseSettings();
    this.updateResonanceButton();
  },

  updateResonanceButton() {
    const isOn = this.storageManager.getResonanceEnabled();
    this.applyToggleState([this.elements.btnResonance], {
      label: t(isOn ? 'app.nav.button.resonanceOn' : 'app.nav.button.resonanceOff'),
      ariaLabel: t('app.nav.button.resonanceAria'),
      tooltip: t(isOn ? 'app.nav.button.resonanceOnAria' : 'app.nav.button.resonanceOffAria'),
      pressed: isOn
    });
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

  /** Label key of the game over Share button: copied, challenge (a duel address exists) or plain share. */
  getShareButtonLabelKey() {
    if (this.shareCopied) {
      return 'modals.gameOver.button.shareCopied';
    }
    return this.challengeUrl ? 'modals.gameOver.button.shareChallenge' : 'modals.gameOver.button.share';
  },

  updateShareButtonLabel() {
    if (this.elements?.btnShareGameOver) {
      setTextIfChanged(
        this.elements.btnShareGameOver,
        t(this.getShareButtonLabelKey())
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
    const { duel, duelUrl } = this.getShareDuel();
    const text = buildShareText(
      {
        mode: engine.mode,
        dateKey: engine.dailySeedKey,
        mutatorKey: engine.activeMutatorKey,
        wave: engine.waveCount,
        score: engine.score,
        waveLog: engine.waveLog,
        stage:
          engine.mode === GAME_MODES.CLASSIC
            ? engine.classicStage
            : engine.mode === GAME_MODES.PINBALL
              ? engine.pinballStage
              : engine.fluxStage,
        tier: engine.mergeBestTier,
        drops: engine.classicRailDropsTotal ?? 0,
        puzzleStage: engine.currentPuzzleStage,
        seed: engine.fluxSeed,
        isWeekly: engine.isWeeklyFluxRun === true,
        weekKey: engine.weeklyWeekKey ?? null,
        workshopLevels: this.getOwnedWorkshopLevelSum(),
        ammoBought: engine.specialAmmoBoughtInRun || 0,
        continues: engine.hasUsedContinue ? 1 : 0,
        duel,
        duelUrl,
        url: shareConfig.url
      },
      shareConfig
    );
    await this.deliverShareText(text, {
      onCopied: () => {
        this.shareCopied = true;
        this.updateShareButtonLabel?.();
      },
      showFallback: (fallbackText) => this.showShareFallback(fallbackText)
    });
  },

  /**
   * Hands a share text out: the system share sheet when there is one, else the clipboard, else
   * the caller's read-only field. The outcome is announced.
   * @param {string} text - The text to share.
   * @param {{onCopied: () => void, showFallback: (text: string) => void}} handlers - What the caller shows
   *   once the text is on the clipboard, and how it offers the text for a manual copy.
   */
  async deliverShareText(text, { onCopied, showFallback }) {
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
        onCopied();
        this.announce(t('share.feedback.copied'));
        return;
      } catch {
        feedbackKey = 'share.feedback.failed';
      }
    }
    showFallback(text);
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
