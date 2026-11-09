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

import { SeededRandom } from './SeededRandom.js';

const CONTEXT_RUNNING = 'running';
const SEMITONES_PER_OCTAVE = 12;
const CHORD_THIRD_OFFSET = 2;
const CHORD_FIFTH_OFFSET = 4;
const CHORD_TONE_COUNT = 3;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const FIRST_STEP = 0;
const HALF_BEAT = 0.5;
const NO_DELAY = 0;
const MAX_INTENSITY = 1;
const MIN_INTENSITY = 0;
const FILTER_TYPE = 'lowpass';
const NOISE_CHANNELS = 1;
const FIRST_LAYER_WITH_ARP = 1;
const FIRST_LAYER_WITH_DOUBLE_HATS = 2;
const FIRST_LAYER_WITH_OPEN_FILTER = 3;
const FADE_CLEANUP_MARGIN_SEC = 0.05;
const VARIATION_ROTATION_OFFSET = 1;
const DEFAULT_STEPS_PER_BAR = 16;
const DEFAULT_STEPS_PER_BEAT = 4;
const DEFAULT_PROGRESSION_BARS = 4;

/** Frequency of a scale degree above rootHz; degrees past the scale length wrap up an octave. */
export function degreeFrequency(rootHz, scale, degree) {
  const length = scale.length;
  const octave = Math.floor(degree / length);
  const index = ((degree % length) + length) % length;
  return rootHz * Math.pow(2, (scale[index] + SEMITONES_PER_OCTAVE * octave) / SEMITONES_PER_OCTAVE);
}

/** Euclidean rhythm hit test: k hits spread over n steps, rotated by `rotation`. */
export function euclidHit(step, hits, steps, rotation = 0) {
  if (hits <= 0) {
    return false;
  }
  const shifted = (((step + rotation) % steps) + steps) % steps;
  return (shifted * hits) % steps < hits;
}

/** Number of intensity layers open at an intensity (0 is the pad and bass only). */
export function intensityLayer(intensity, thresholds) {
  let layer = 0;
  thresholds.forEach((threshold, index) => {
    if (intensity >= threshold) {
      layer = index;
    }
  });
  return layer;
}

/**
 * Builds the note events of one mode, deterministically from its config and a seed key.
 * Never touches the gameplay random stream: the variation comes from its own SeededRandom.
 *
 * @param {object} modeCfg Mode entry of the music config (bpm, rootHz, scale, progression, euclid).
 * @param {string} seedKey Key of the variation stream, normally the mode name.
 * @param {object} [structure] Structure constants (stepsPerBar, progressionBars).
 * @returns {{bpm: number, stepsPerBar: number, base: object[], variation: object[]}} Each bar is
 *   {degree, steps} and each step {pad, bass, arp, hat}, any of which may be null.
 */
export function buildPattern(modeCfg, seedKey, structure = {}) {
  const stepsPerBar = structure.stepsPerBar ?? DEFAULT_STEPS_PER_BAR;
  const stepsPerBeat = structure.stepsPerBeat ?? DEFAULT_STEPS_PER_BEAT;
  const progressionBars = structure.progressionBars ?? DEFAULT_PROGRESSION_BARS;
  const rng = new SeededRandom(`music:${seedKey}`);
  const { rootHz, scale, progression, euclid } = modeCfg;
  const rotations = {
    bass: Math.floor(rng.next() * stepsPerBar),
    arp: Math.floor(rng.next() * stepsPerBar),
    hat: Math.floor(rng.next() * stepsPerBar)
  };
  const arpStart = Math.floor(rng.next() * CHORD_TONE_COUNT);
  const arpDirection = rng.next() < HALF_BEAT ? 1 : -1;

  const buildBar = (barIndex, isVariation) => {
    const degree = progression[barIndex % progression.length];
    const chord = [degree, degree + CHORD_THIRD_OFFSET, degree + CHORD_FIFTH_OFFSET];
    const shift = isVariation ? VARIATION_ROTATION_OFFSET : 0;
    const direction = isVariation ? -arpDirection : arpDirection;
    let arpCounter = arpStart + barIndex;
    const steps = [];
    for (let step = FIRST_STEP; step < stepsPerBar; step++) {
      const entry = { pad: null, bass: null, arp: null, hat: null };
      if (step === FIRST_STEP) {
        entry.pad = chord.map((d) => degreeFrequency(rootHz, scale, d));
      }
      if (step === FIRST_STEP || euclidHit(step, euclid.bass, stepsPerBar, rotations.bass + shift)) {
        entry.bass = { freq: degreeFrequency(rootHz, scale, degree) };
      }
      if (euclidHit(step, euclid.arp, stepsPerBar, rotations.arp + shift)) {
        const tone = ((arpCounter % CHORD_TONE_COUNT) + CHORD_TONE_COUNT) % CHORD_TONE_COUNT;
        entry.arp = { freq: degreeFrequency(rootHz, scale, chord[tone]) };
        arpCounter += direction;
      }
      const baseHat = euclidHit(step, euclid.hat, stepsPerBar, rotations.hat + shift);
      const extraHat = !baseHat && euclidHit(step, euclid.hat * 2, stepsPerBar, rotations.hat + shift);
      if (baseHat || extraHat) {
        entry.hat = { accent: baseHat && step % stepsPerBeat === 0, extra: extraHat };
      }
      steps.push(entry);
    }
    return { degree, steps };
  };

  const base = [];
  const variation = [];
  for (let bar = 0; bar < progressionBars; bar++) {
    base.push(buildBar(bar, false));
    variation.push(buildBar(bar, true));
  }
  return { bpm: modeCfg.bpm, stepsPerBar, base, variation };
}

/**
 * Look-ahead music scheduler. Everything it touches is injected (context, output node,
 * timers, config) so tests drive it with a fake context and manual clock.
 */
export class MusicEngine {
  constructor({ ctx, output, timers, config, enabled = true }) {
    this.ctx = ctx;
    this.output = output;
    this.timers = timers;
    this.config = config;
    this.enabled = enabled;
    this.volume = config.defaultVolume;
    this.resetPlayback();
    this.bus = null;
    this.filter = null;
    this.noiseBuffer = null;
    this.timerId = null;
    this.patterns = new Map();
  }

  resetPlayback() {
    this.modeKey = null;
    this.pattern = null;
    this.running = false;
    this.paused = false;
    this.stepIndex = FIRST_STEP;
    this.nextStepTime = 0;
    this.targetIntensity = MIN_INTENSITY;
    this.intensity = MIN_INTENSITY;
    this.layer = 0;
    this.voices = [];
    this.nodes = new Set();
    this.pendingCorrection = null;
  }

  get stepDuration() {
    return SECONDS_PER_MINUTE / this.pattern.bpm / this.config.stepsPerBeat;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.stop(NO_DELAY);
    }
  }

  isContextRunning() {
    const state = this.ctx.state;
    return !state || state === CONTEXT_RUNNING;
  }

  /** Output plus base latency the listener hears on top of the scheduled time. */
  getLatencySec() {
    return (Number(this.ctx.outputLatency) || 0) + (Number(this.ctx.baseLatency) || 0);
  }

  /** Starts a mode. Returns false (and creates no node) when music is off or the mode unknown. */
  start(modeKey) {
    if (!this.enabled) {
      return false;
    }
    const modeCfg = this.config.modes[modeKey];
    if (!modeCfg) {
      return false;
    }
    if (this.running && this.modeKey === modeKey) {
      return true;
    }
    this.stop(NO_DELAY);
    if (!this.patterns.has(modeKey)) {
      this.patterns.set(modeKey, buildPattern(modeCfg, modeKey, this.config));
    }
    this.pattern = this.patterns.get(modeKey);
    this.modeKey = modeKey;
    this.createGraph();
    this.running = true;
    this.paused = false;
    this.stepIndex = FIRST_STEP;
    this.nextStepTime = this.ctx.currentTime + this.config.startLeadSec;
    this.tick();
    this.armTimer();
    return true;
  }

  createGraph() {
    const ctx = this.ctx;
    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(this.volume * this.config.gain, ctx.currentTime);
    this.bus.connect(this.output);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = FILTER_TYPE;
    this.filter.Q.setValueAtTime(this.config.filter.q, ctx.currentTime);
    this.filter.frequency.setValueAtTime(this.config.filter.closedHz, ctx.currentTime);
    this.filter.connect(this.bus);
    if (!this.noiseBuffer) {
      this.noiseBuffer = this.createNoiseBuffer();
    }
  }

  /** One short white-noise buffer, generated once and shared by every hat. */
  createNoiseBuffer() {
    const length = Math.max(1, Math.round(this.ctx.sampleRate * this.config.hatBufferSec));
    const buffer = this.ctx.createBuffer(NOISE_CHANNELS, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rng = new SeededRandom('music:noise');
    for (let i = 0; i < length; i++) {
      data[i] = rng.next() * 2 - 1;
    }
    return buffer;
  }

  /** Arms the scheduler timer; never while the context is not running (suspended, interrupted). */
  armTimer() {
    this.clearTimer();
    if (!this.isContextRunning()) {
      return;
    }
    this.timerId = this.timers.set(() => {
      this.timerId = null;
      this.tick();
      if (this.running && !this.paused && this.isContextRunning()) {
        this.armTimer();
      }
    }, this.config.timerMs);
  }

  clearTimer() {
    if (this.timerId !== null) {
      this.timers.clear(this.timerId);
      this.timerId = null;
    }
  }

  /** Fades the music out and releases its nodes. fadeSec 0 cuts at once. */
  stop(fadeSec = 0) {
    this.clearTimer();
    const bus = this.bus;
    const nodes = this.nodes;
    const filter = this.filter;
    if (bus) {
      const now = this.ctx.currentTime;
      const end = now + Math.max(fadeSec, NO_DELAY);
      if (fadeSec > NO_DELAY) {
        bus.gain.cancelScheduledValues(now);
        bus.gain.setValueAtTime(bus.gain.value, now);
        bus.gain.linearRampToValueAtTime(0, end);
      } else {
        bus.gain.setValueAtTime(0, now);
      }
      for (const node of nodes) {
        try {
          node.stop(end);
        } catch {
          // Already stopped.
        }
      }
      const release = () => {
        try {
          bus.disconnect();
          filter?.disconnect();
        } catch {
          // Already disconnected.
        }
      };
      this.timers.set(release, fadeSec * MS_PER_SECOND + FADE_CLEANUP_MARGIN_SEC * MS_PER_SECOND);
    }
    this.bus = null;
    this.filter = null;
    this.resetPlayback();
  }

  pause() {
    if (!this.running) {
      return;
    }
    this.paused = true;
    this.pendingCorrection = null;
    this.clearTimer();
  }

  resume() {
    if (!this.running || !this.paused) {
      return;
    }
    this.paused = false;
    this.skipMissedSteps();
    this.tick();
    this.armTimer();
  }

  /** Re-anchors after the audio context was suspended or interrupted, never bursting. */
  onContextResumed() {
    if (!this.running) {
      return;
    }
    if (!this.isContextRunning()) {
      return;
    }
    this.skipMissedSteps();
    if (!this.paused && this.timerId === null) {
      this.armTimer();
    }
  }

  setIntensity(value) {
    this.targetIntensity = Math.max(MIN_INTENSITY, Math.min(MAX_INTENSITY, Number(value) || MIN_INTENSITY));
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, Number(value) || 0));
    if (this.bus) {
      const now = this.ctx.currentTime;
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setValueAtTime(this.volume * this.config.gain, now);
    }
  }

  /** Position of the heard music in beats, from the scheduler's own clock. */
  getHeardBeat() {
    const aheadSec = this.nextStepTime + this.getLatencySec() - this.ctx.currentTime;
    const steps = this.stepIndex - aheadSec / this.stepDuration;
    return steps / this.config.stepsPerBeat;
  }

  /**
   * Compares the game beat clock with the heard music and queues a correction for the next
   * bar: bounded to phaseLock.maxNudgeSec when close, a full re-anchor when beyond
   * phaseLock.reanchorSec. Only the position inside the beat matters, not which beat.
   */
  syncToBeat(beatIndex, beatPhaseValue) {
    if (!this.running || this.paused || !this.isContextRunning()) {
      return;
    }
    const beatSec = SECONDS_PER_MINUTE / this.pattern.bpm;
    let errorBeats = (beatIndex + beatPhaseValue - this.getHeardBeat()) % 1;
    if (errorBeats > HALF_BEAT) {
      errorBeats -= 1;
    } else if (errorBeats < -HALF_BEAT) {
      errorBeats += 1;
    }
    const errorSec = errorBeats * beatSec;
    const { maxNudgeSec, reanchorSec } = this.config.phaseLock;
    if (Math.abs(errorSec) > reanchorSec) {
      this.pendingCorrection = { reanchor: true, sec: errorSec };
    } else {
      this.pendingCorrection = {
        reanchor: false,
        sec: Math.max(-maxNudgeSec, Math.min(maxNudgeSec, errorSec))
      };
    }
  }

  /** Drops steps whose time already passed so a stall or resume never plays a burst. */
  skipMissedSteps() {
    const now = this.ctx.currentTime;
    const late = now - this.nextStepTime;
    if (late > this.config.maxLateSteps * this.stepDuration) {
      const skipped = Math.ceil(late / this.stepDuration);
      this.stepIndex += skipped;
      this.nextStepTime += skipped * this.stepDuration;
      this.pendingCorrection = null;
    }
  }

  /** Schedules every step that falls inside the look-ahead window. Driven by the timer. */
  tick() {
    if (!this.running || this.paused || !this.isContextRunning()) {
      return;
    }
    this.skipMissedSteps();
    const horizon = this.ctx.currentTime + this.config.lookAheadSec;
    while (this.nextStepTime < horizon) {
      this.scheduleStep(this.stepIndex, this.nextStepTime);
      this.stepIndex += 1;
      this.nextStepTime += this.stepDuration;
    }
  }

  /** Applies the smoothed intensity, filter and phase correction at a bar boundary. */
  startBar() {
    const { smoothing, layerThresholds } = this.config.intensity;
    this.intensity += (this.targetIntensity - this.intensity) * smoothing;
    this.layer = intensityLayer(this.intensity, layerThresholds);
    const filterCfg = this.config.filter;
    const open = this.layer >= FIRST_LAYER_WITH_OPEN_FILTER;
    const target = open ? filterCfg.openHz : filterCfg.closedHz;
    const now = this.ctx.currentTime;
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, now);
    this.filter.frequency.linearRampToValueAtTime(target, now + filterCfg.rampSec);
    if (this.pendingCorrection) {
      this.nextStepTime += this.pendingCorrection.sec;
      this.pendingCorrection = null;
    }
  }

  barFor(stepIndex) {
    const { stepsPerBar } = this.pattern;
    const barIndex = Math.floor(stepIndex / stepsPerBar);
    const slot = barIndex % this.pattern.base.length;
    const useVariation = barIndex % this.config.variationEveryBars === this.config.variationEveryBars - 1;
    return (useVariation ? this.pattern.variation : this.pattern.base)[slot];
  }

  scheduleStep(stepIndex, time) {
    const { stepsPerBar } = this.pattern;
    const stepInBar = stepIndex % stepsPerBar;
    if (stepInBar === FIRST_STEP) {
      this.startBar();
      time = this.nextStepTime;
    }
    const entry = this.barFor(stepIndex).steps[stepInBar];
    const stepSec = this.stepDuration;
    const voices = this.config.voices;
    if (entry.pad) {
      entry.pad.forEach((freq) =>
        this.playVoice(voices.pad, freq * voices.pad.octave, time, stepSec * stepsPerBar)
      );
    }
    if (entry.bass) {
      this.playVoice(voices.bass, entry.bass.freq * voices.bass.octave, time, stepSec * voices.bass.durationSteps);
    }
    if (entry.arp && this.layer >= FIRST_LAYER_WITH_ARP) {
      this.playVoice(voices.arp, entry.arp.freq * voices.arp.octave, time, stepSec * voices.arp.durationSteps);
    }
    if (entry.hat && this.layer >= FIRST_LAYER_WITH_ARP) {
      const doubled = this.layer >= FIRST_LAYER_WITH_DOUBLE_HATS;
      if (!entry.hat.extra || doubled) {
        this.playHat(time, doubled && entry.hat.accent);
      }
    }
  }

  /** Voices still sounding at `now`; also prunes the ended ones. */
  countActiveVoices(now) {
    this.voices = this.voices.filter((end) => end > now);
    return this.voices.length;
  }

  hasVoiceBudget(time) {
    return this.countActiveVoices(time) < this.config.maxVoices;
  }

  trackNode(node, gain, endTime) {
    this.voices.push(endTime);
    this.nodes.add(node);
    node.onended = () => {
      this.nodes.delete(node);
      try {
        node.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected.
      }
    };
  }

  playVoice(voiceCfg, freq, time, durationSec) {
    if (!this.hasVoiceBudget(time)) {
      return;
    }
    const ctx = this.ctx;
    const endTime = time + durationSec + voiceCfg.releaseSec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = voiceCfg.type;
    osc.frequency.setValueAtTime(freq, time);
    const attack = Math.min(voiceCfg.attackSec ?? 0, durationSec);
    gain.gain.setValueAtTime(this.config.minGain, time);
    gain.gain.linearRampToValueAtTime(voiceCfg.gain, time + attack);
    gain.gain.setValueAtTime(voiceCfg.gain, time + durationSec);
    gain.gain.linearRampToValueAtTime(this.config.minGain, endTime);
    osc.connect(gain);
    gain.connect(this.filter);
    this.trackNode(osc, gain, endTime);
    osc.start(time);
    osc.stop(endTime);
  }

  playHat(time, accent) {
    if (!this.hasVoiceBudget(time)) {
      return;
    }
    const hat = this.config.voices.hat;
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = this.noiseBuffer;
    const peak = accent ? hat.accentGain : hat.gain;
    gain.gain.setValueAtTime(peak, time);
    gain.gain.linearRampToValueAtTime(this.config.minGain, time + hat.durationSec);
    source.connect(gain);
    gain.connect(this.bus);
    this.trackNode(source, gain, time + hat.durationSec);
    source.start(time);
    source.stop(time + hat.durationSec);
  }

  getState() {
    return {
      running: this.running,
      paused: this.paused,
      modeKey: this.modeKey,
      stepIndex: this.stepIndex,
      nextStepTime: this.nextStepTime,
      layer: this.layer,
      intensity: this.intensity
    };
  }
}
