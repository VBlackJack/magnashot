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

import { configRegistry } from './ConfigRegistry.js';
import { MusicEngine } from './MusicEngine.js';

const CONTEXT_STATES = Object.freeze({
  RUNNING: 'running',
  SUSPENDED: 'suspended'
});

const MS_PER_SECOND = 1000;

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.output = null;
    this.muted = false;
    this.reducedMotion = false;
    this.config = null;
    // Each playing oscillator mapped to the gain node it plays through, so stopAll can
    // fade the voice out instead of cutting it mid-wave.
    this.activeOscillators = new Map();
    this.lastEffectTimes = new Map();
    this.lastHapticTime = -Infinity;
    // Stereo pan of the effect being played (-1 left, 1 right); undefined means centred.
    this.activePan = undefined;
    this.visibilityBound = false;
    this.clock = () => performance.now();
    // Timer pair behind the deferred mute suspend, injectable so tests can run the
    // scheduled callback synchronously instead of waiting on a real timeout.
    this.timers = {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (id) => clearTimeout(id)
    };
    // Timer id of a suspend waiting for the mute fade to end, or null when none is pending.
    this.pendingSuspend = null;
    // Music settings and the lazily created engine; the bus sits between the engine and
    // the limiter so music has its own voice budget and level, separate from the effects.
    this.musicEnabled = true;
    this.musicVolume = 0;
    this.musicBus = null;
    this.music = null;
  }

  init(initialMuted = false, initialReducedMotion = false, { musicEnabled = true, musicVolume } = {}) {
    this.config = configRegistry.get('audio');
    this.muted = initialMuted;
    this.reducedMotion = Boolean(initialReducedMotion);
    this.musicEnabled = Boolean(musicEnabled);
    this.musicVolume = Number.isFinite(musicVolume) ? musicVolume : this.config.music.defaultVolume;
    this.bindVisibility();
  }

  bindVisibility() {
    if (this.visibilityBound || typeof document === 'undefined') {
      return;
    }
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => this.syncContextState());
  }

  isDocumentHidden() {
    return typeof document !== 'undefined' && document.hidden === true;
  }

  /**
   * Suspends the audio context while muted or hidden and resumes it otherwise. A context
   * only exists once a sound was requested from a user gesture, so nothing starts here.
   * A refused suspend or resume (a closed context, a browser blocking playback) leaves the
   * context as it was; the next visibility or mute change tries again.
   */
  syncContextState() {
    if (!this.ctx) {
      return;
    }
    if (this.muted || this.isDocumentHidden()) {
      this.music?.pause();
      if (this.ctx.state === CONTEXT_STATES.RUNNING) {
        Promise.resolve(this.ctx.suspend()).catch(() => {});
      }
    } else if (this.ctx.state === CONTEXT_STATES.SUSPENDED) {
      this.music?.resume();
      Promise.resolve(this.ctx.resume())
        .then(() => this.music?.onContextResumed())
        .catch(() => {});
    } else {
      this.music?.resume();
    }
  }

  /** True when music may sound: switched on in settings and not muted. */
  isMusicActive() {
    return this.musicEnabled && !this.muted;
  }

  /** Builds the music bus and engine once the context exists. */
  createMusic() {
    if (this.music || !this.ctx || !this.config?.music) {
      return;
    }
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.setValueAtTime(1, this.ctx.currentTime);
    this.musicBus.connect(this.output);
    this.music = new MusicEngine({
      ctx: this.ctx,
      output: this.musicBus,
      timers: { set: (fn, ms) => this.timers.set(fn, ms), clear: (id) => this.timers.clear(id) },
      config: this.config.music,
      enabled: this.isMusicActive()
    });
    this.music.setVolume(this.musicVolume);
  }

  /**
   * Starts the music for a mode. Creates nothing when muted or switched off, and needs a
   * context that a user gesture already created (ensureContext from a shot or tap).
   *
   * @returns {boolean} True when the music is playing that mode.
   */
  startMusic(modeKey) {
    if (!this.isMusicActive() || !this.music) {
      return false;
    }
    return this.music.start(modeKey);
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = Boolean(enabled);
    this.music?.setEnabled(this.isMusicActive());
  }

  setMusicVolume(volume) {
    const value = Number(volume);
    if (!Number.isFinite(value)) {
      return;
    }
    this.musicVolume = Math.max(0, Math.min(1, value));
    this.music?.setVolume(this.musicVolume);
  }

  getMusicState() {
    const engineState = this.music ? this.music.getState() : null;
    return {
      enabled: this.musicEnabled,
      active: this.isMusicActive(),
      volume: this.musicVolume,
      running: Boolean(engineState?.running),
      paused: Boolean(engineState?.paused),
      modeKey: engineState?.modeKey ?? null
    };
  }

  setReducedMotion(reduced) {
    this.reducedMotion = Boolean(reduced);
  }

  triggerHaptic(durationMs) {
    if (this.muted || this.reducedMotion || !durationMs) {
      return;
    }
    const nowMs = this.clock();
    if (nowMs - this.lastHapticTime < this.config.hapticMinIntervalMs) {
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      this.lastHapticTime = nowMs;
      try {
        navigator.vibrate(durationMs);
      } catch {
        // Ignore haptic errors on unsupported browsers
      }
    }
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.output = this.createLimiter(this.ctx);
      }
    }
    this.createMusic();
    this.syncContextState();
  }

  /**
   * Builds the master limiter every voice goes through, so stacked voices compress
   * instead of clipping at the destination.
   */
  createLimiter(ctx) {
    const lim = this.config.limiter;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(lim.thresholdDb, ctx.currentTime);
    compressor.knee.setValueAtTime(lim.kneeDb, ctx.currentTime);
    compressor.ratio.setValueAtTime(lim.ratio, ctx.currentTime);
    compressor.attack.setValueAtTime(lim.attackSec, ctx.currentTime);
    compressor.release.setValueAtTime(lim.releaseSec, ctx.currentTime);
    compressor.connect(ctx.destination);
    return compressor;
  }

  /**
   * Silences every playing voice. Each one fades to the minimum gain over stopRampSec before
   * it stops: cutting a wave mid-cycle clicks. The voice disconnects itself once it ends
   * (see playTone), so the fade is heard in full.
   *
   * @returns {boolean} True when at least one voice was scheduled to fade, so a caller that
   *   suspends the context afterwards knows it must wait for the ramp to end first.
   */
  stopAll() {
    const fading = Boolean(this.ctx) && this.activeOscillators.size > 0;
    if (fading) {
      const now = this.ctx.currentTime;
      const stopTime = now + this.config.stopRampSec;
      const minGain = this.config.minGain;
      for (const [osc, gain] of this.activeOscillators) {
        try {
          const param = gain.gain;
          const currentGain = Math.max(param.value, minGain);
          param.cancelScheduledValues(now);
          param.setValueAtTime(currentGain, now);
          param.exponentialRampToValueAtTime(minGain, stopTime);
          osc.stop(stopTime);
        } catch {
          // Ignore already-stopped oscillators
        }
      }
    }
    this.activeOscillators.clear();
    return fading;
  }

  /**
   * Drops a suspend still waiting for the mute fade, so a later mute change decides the
   * context state on its own.
   */
  cancelPendingSuspend() {
    if (this.pendingSuspend !== null) {
      this.timers.clear(this.pendingSuspend);
      this.pendingSuspend = null;
    }
  }

  /**
   * Mutes or unmutes every sound. Muting fades the playing voices out, then suspends the
   * context only once the stopRampSec fade has ended: a suspended context freezes its
   * ramps, so suspending at once would cut the fade and leave its frozen tail to blip on
   * unmute. With no voice playing there is nothing to wait for and the suspend is
   * immediate. Unmuting during the fade cancels the pending suspend and resumes at once.
   */
  setMuted(muted) {
    this.muted = Boolean(muted);
    this.music?.setEnabled(this.isMusicActive());
    this.cancelPendingSuspend();
    if (this.muted && this.stopAll()) {
      this.pendingSuspend = this.timers.set(() => {
        this.pendingSuspend = null;
        this.syncContextState();
      }, this.config.stopRampSec * MS_PER_SECOND);
      return;
    }
    this.syncContextState();
  }

  isMuted() {
    return this.muted;
  }

  getActiveVoiceCount() {
    return this.activeOscillators.size;
  }

  /**
   * Returns a stereo panner for the effect being played, or null when no pan applies
   * (centred, unset, or no StereoPannerNode in this browser).
   */
  createPanner() {
    const pan = this.activePan;
    if (!Number.isFinite(pan) || pan === 0 || typeof this.ctx.createStereoPanner !== 'function') {
      return null;
    }
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    return panner;
  }

  playTone(type, startFreq, endFreq, duration, startOffset = 0, gainScale = 1.0) {
    if (this.muted || !this.config) {
      return;
    }
    this.ensureContext();
    if (!this.ctx || this.activeOscillators.size >= this.config.maxVoices) {
      return;
    }

    const startTime = this.ctx.currentTime + startOffset;
    const stopTime = startTime + duration;
    const minFreq = this.config.minFrequency;
    const minGain = this.config.minGain;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(startFreq, minFreq), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, minFreq), stopTime);

    gain.gain.setValueAtTime(this.config.masterGain * gainScale, startTime);
    gain.gain.exponentialRampToValueAtTime(minGain, stopTime);

    osc.connect(gain);
    const panner = this.createPanner();
    if (panner) {
      gain.connect(panner);
      panner.connect(this.output);
    } else {
      gain.connect(this.output);
    }

    this.activeOscillators.set(osc, gain);
    osc.onended = () => {
      this.activeOscillators.delete(osc);
      gain.disconnect();
      panner?.disconnect();
    };

    osc.start(startTime);
    osc.stop(stopTime);
  }

  /**
   * Returns false when the same effect already played within the configured minimum
   * interval, so a burst of identical events (an anvil crushing a row) plays once.
   */
  acceptEffect(effectName) {
    const nowMs = this.clock();
    const last = this.lastEffectTimes.get(effectName);
    if (last !== undefined && nowMs - last < this.config.effectMinIntervalMs) {
      return false;
    }
    this.lastEffectTimes.set(effectName, nowMs);
    return true;
  }

  playEffect(effectName, comboIndex = 0, { pan } = {}) {
    this.activePan = pan;
    try {
      this.playEffectVoices(effectName, comboIndex);
    } finally {
      this.activePan = undefined;
    }
  }

  playEffectVoices(effectName, comboIndex) {
    if (this.muted || !this.config) {
      return;
    }
    const fx = this.config.effects[effectName];
    if (!fx || !this.acceptEffect(effectName)) {
      return;
    }
    this.triggerHaptic(fx.hapticMs);

    if (effectName === 'match') {
      const freq = fx.baseFreq + comboIndex * fx.pitchStep;
      const endFreq = freq * fx.endFreqMultiplier;
      this.playTone(fx.type, freq, endFreq, fx.duration);
      if (fx.harmonic) {
        this.playTone(
          this.config.arpeggioWaveType,
          freq * this.config.harmonicRatio,
          endFreq * this.config.harmonicRatio,
          fx.duration,
          0,
          this.config.harmonicGainRatio
        );
      }
      return;
    }

    if (Array.isArray(fx.notes)) {
      if (effectName === 'victory' || effectName === 'gameOver') {
        this.stopAll();
        this.music?.stop(this.config.music.endFadeSec);
      }
      const waveType = this.config.arpeggioWaveType;
      const stepRatio = this.config.arpeggioStepRatio;
      fx.notes.forEach((note, index) => {
        const offset = index * fx.noteDuration * stepRatio;
        this.playTone(waveType, note, note, fx.noteDuration, offset);
      });
      return;
    }

    this.playTone(fx.type, fx.startFreq, fx.endFreq, fx.duration);
    if (fx.harmonic) {
      this.playTone(
        this.config.arpeggioWaveType,
        fx.startFreq * this.config.harmonicRatio,
        fx.endFreq * this.config.harmonicRatio,
        fx.duration,
        0,
        this.config.harmonicGainRatio
      );
    }
  }
}
