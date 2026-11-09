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
import { configRegistry } from '../core/ConfigRegistry.js';
import { t, formatNumber } from '../core/I18n.js';
import { ringVisual } from '../game/Resonance.js';
import { createCalibration } from './RhythmCalibration.js';
import { createPulseDriver } from './PulseDriver.js';
import { setTextIfChanged } from './UIHelpers.js';

const HIDDEN_CLASS = 'hidden';
const CALIBRATION_CLICK_EFFECT = 'calibrationClick';
const TAP_KEYS = Object.freeze(['Space', 'Enter', 'NumpadEnter']);
const UNLOCK_EVENTS = Object.freeze(['pointerdown', 'keydown']);
const WINDOW_ATTRIBUTE = 'data-window';
const NO_TAPS = 0;

/**
 * Pulse on the UI side: the music driver that runs in the frame hook, the unlock of the
 * audio context on the first gesture, and the rhythm calibration dialog.
 * Methods installed on UIManager.prototype by UIManager.js.
 */
export const uiCalibrationMethods = {
  // ---------------------------------------------------------------------------------------
  // Music driver and audio unlock
  // ---------------------------------------------------------------------------------------

  /**
   * Called once per frame from the loop hook: starts, stops and steers the music from the
   * run on screen. Does nothing until the audio manager has its config.
   * @param {number} now Frame time in ms.
   */
  driveMusic(now) {
    const musicConfig = this.audioManager?.config?.music;
    if (!musicConfig) {
      return;
    }
    if (!this.pulseDriver) {
      this.pulseDriver = createPulseDriver({
        audioManager: this.audioManager,
        getLead: () => this.getPulseLead(),
        driverConfig: musicConfig.driver,
        fadeSec: musicConfig.endFadeSec
      });
    }
    this.pulseDriver.update(now);
  },

  /**
   * Creates the audio context on the first gesture, so the music can start with the first
   * run without waiting for a first sound. A muted page waits for the first gesture after
   * the unmute.
   */
  bindAudioUnlock() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return;
    }
    const unlock = () => {
      if (this.audioManager.isMuted()) {
        return;
      }
      this.audioManager.ensureContext?.();
      for (const name of UNLOCK_EVENTS) {
        document.removeEventListener(name, unlock, true);
      }
    };
    for (const name of UNLOCK_EVENTS) {
      document.addEventListener(name, unlock, true);
    }
  },

  // ---------------------------------------------------------------------------------------
  // Rhythm calibration
  // ---------------------------------------------------------------------------------------

  setupCalibration() {
    const els = this.elements;
    els.btnCalibrate?.addEventListener('click', () => this.openCalibration());
    els.btnCalibrateDone?.addEventListener('click', () => this.closeCalibration());
    els.btnCalibrateReset?.addEventListener('click', () => this.resetCalibration());
    els.modalCalibrate?.addEventListener('click', (event) => {
      if (event.target === els.modalCalibrate) {
        this.closeCalibration();
      }
    });
    const tapButton = els.btnCalibrateTap;
    if (!tapButton) {
      return;
    }
    // The tap is taken on the press, not the release, so it adds no wait of its own. A click
    // that follows a press is the same tap; one without a press (assistive tech) still counts.
    tapButton.addEventListener('pointerdown', (event) => {
      this.calibrationPressHandled = true;
      this.registerCalibrationTap(event.timeStamp);
    });
    tapButton.addEventListener('click', (event) => {
      if (this.calibrationPressHandled) {
        this.calibrationPressHandled = false;
        return;
      }
      this.registerCalibrationTap(event.timeStamp);
    });
    tapButton.addEventListener('keydown', (event) => {
      if (TAP_KEYS.includes(event.code)) {
        event.preventDefault();
        if (!event.repeat) {
          this.registerCalibrationTap(event.timeStamp);
        }
      }
    });
  },

  isCalibrationOpen() {
    const modal = this.elements.modalCalibrate;
    return Boolean(modal) && !modal.classList.contains(HIDDEN_CLASS);
  },

  /** Opens the dialog and starts the pulses at once. */
  openCalibration() {
    if (!this.elements.modalCalibrate) {
      return;
    }
    this.openOverlayModal(this.elements.modalCalibrate, this.elements.btnCalibrateTap);
    this.startCalibrationRun();
  },

  closeCalibration() {
    this.stopCalibrationLoop();
    this.calibration = null;
    this.stackedModalOpener = this.elements.btnCalibrate;
    this.closeOverlayModal(this.elements.modalCalibrate);
  },

  /** Clears the stored offset and runs the pulses again. */
  resetCalibration() {
    this.storageManager.setRhythmOffsetMs(NO_TAPS);
    this.startCalibrationRun();
  },

  getCalibrationSettings() {
    const cfg = this.gameConfig.resonance;
    const audioConfig = this.audioManager?.config ?? configRegistry.get('audio');
    return {
      beats: cfg.calibrationBeats,
      leadBeats: cfg.calibrationLeadBeats,
      minTaps: cfg.calibrationMinTaps,
      bpm: cfg.calibrationBpm,
      maxOffsetMs: cfg.maxOffsetMs,
      hasClick: Boolean(audioConfig?.effects?.[CALIBRATION_CLICK_EFFECT])
    };
  },

  /** Starts a fresh train of pulses and the loop that fires them. */
  startCalibrationRun() {
    this.stopCalibrationLoop();
    const settings = this.getCalibrationSettings();
    this.calibration = createCalibration(settings);
    this.calibrationClickEnabled = settings.hasClick;
    this.calibration.start(performance.now());
    this.renderCalibration({ isRunning: true });
    if (typeof requestAnimationFrame === 'function') {
      const tick = (now) => {
        this.onCalibrationFrame(now);
        if (this.calibrationFrameId !== null) {
          this.calibrationFrameId = requestAnimationFrame(tick);
        }
      };
      this.calibrationFrameId = requestAnimationFrame(tick);
    }
  },

  stopCalibrationLoop() {
    if (this.calibrationFrameId !== null && this.calibrationFrameId !== undefined
      && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.calibrationFrameId);
    }
    this.calibrationFrameId = null;
  },

  /** Fires the pulses that are due, and saves the result once the run is over. */
  onCalibrationFrame(now) {
    const calibration = this.calibration;
    if (!calibration) {
      return;
    }
    const { fired, isDone } = calibration.update(now);
    if (fired.length > 0 && this.calibrationClickEnabled) {
      this.audioManager.playEffect?.(CALIBRATION_CLICK_EFFECT);
    }
    this.drawCalibrationRing(now);
    if (isDone) {
      this.finishCalibrationRun();
    }
  },

  finishCalibrationRun() {
    this.stopCalibrationLoop();
    const { offsetMs } = this.calibration.getResult();
    if (offsetMs !== null) {
      this.storageManager.setRhythmOffsetMs(offsetMs);
    }
    this.renderCalibration({ isRunning: false, isTooFew: offsetMs === null });
    this.elements.calibrateRing?.removeAttribute(WINDOW_ATTRIBUTE);
  },

  registerCalibrationTap(timeStamp) {
    const calibration = this.calibration;
    if (!calibration) {
      // After the run, the next press starts a new one.
      if (this.isCalibrationOpen()) {
        this.startCalibrationRun();
      }
      return;
    }
    calibration.tap(Number.isFinite(timeStamp) ? timeStamp : performance.now());
    this.renderCalibration({ isRunning: this.calibrationFrameId !== null });
  },

  /**
   * Draws the calibration ring the way the in-game one is drawn (same function, with time
   * counted in engine frames): it shrinks onto the core to land on each pulse, solid and
   * thick while the window is open, thin and dashed outside, fixed in size with only the
   * opacity moving under reduced motion.
   */
  drawCalibrationRing(now) {
    const ring = this.elements.calibrateRing;
    const calibration = this.calibration;
    if (!ring || !calibration) {
      return;
    }
    const cfg = this.gameConfig.resonance;
    const stepMs = this.engine.physicsConfig.simulation.fixedStepMs;
    const visual = ringVisual(calibration.getFrame(now, stepMs), {
      framesPerBeat: calibration.beatMs / stepMs,
      windowFrames: cfg.windowFrames,
      reducedMotion: Boolean(this.engine.isReducedMotion),
      cfg
    });
    ring.style.transform = `scale(${visual.radiusScale / cfg.ring.startScale})`;
    ring.style.opacity = String(visual.opacity);
    ring.setAttribute(WINDOW_ATTRIBUTE, String(visual.inWindow));
  },

  /** Writes the texts of the dialog: intro, progress and the offset in force. */
  renderCalibration({ isRunning = false, isTooFew = false } = {}) {
    const els = this.elements;
    const settings = this.getCalibrationSettings();
    setTextIfChanged(els.calibrateIntro, t('app.settings.calibrate.intro', { count: formatNumber(settings.beats) }));
    const taps = this.calibration ? this.calibration.getTapCount() : NO_TAPS;
    setTextIfChanged(
      els.calibrateProgress,
      isRunning
        ? t('app.settings.calibrate.progress', { done: formatNumber(taps), total: formatNumber(settings.beats) })
        : ''
    );
    const offset = this.storageManager.getRhythmOffsetMs();
    setTextIfChanged(
      els.calibrateResult,
      isTooFew
        ? t('app.settings.calibrate.tooFew', { min: formatNumber(settings.minTaps) })
        : t('app.settings.calibrate.result', { offset: formatNumber(offset) })
    );
    els.calibrateRing?.classList.toggle('is-idle', !isRunning);
  },

  /** Re-renders the dialog texts after a language change. */
  refreshCalibrationText() {
    if (this.isCalibrationOpen()) {
      this.renderCalibration({ isRunning: this.calibrationFrameId !== null });
    }
  }
};