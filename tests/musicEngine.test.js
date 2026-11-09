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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MusicEngine, buildPattern, degreeFrequency, euclidHit, intensityLayer } from '../src/core/MusicEngine.js';
import { GAME_MODES } from '../src/core/Constants.js';

const AUDIO = JSON.parse(readFileSync(new URL('../configs/audio.json', import.meta.url), 'utf8'));
const MUSIC = AUDIO.music;
const TICK_SEC = MUSIC.timerMs / 1000;
const MODE = GAME_MODES.CAMPAIGN;
const EPS = 1e-9;
const SEMITONES = 12;

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.ramps = [];
  }
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v, t) { this.ramps.push({ v, t }); }
  cancelScheduledValues() {}
}

class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(0);
    this.Q = new FakeParam(0);
    this.startTime = null;
    this.stopTime = null;
    this.connected = true;
  }
  connect() {}
  disconnect() { this.connected = false; }
  start(t) { this.startTime = t; this.ctx.started.push(this); }
  stop(t) { this.stopTime = Math.min(this.stopTime ?? Infinity, t); }
}

class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.sampleRate = 8000;
    this.started = [];
    this.created = 0;
    this.buffersCreated = 0;
    this.destination = {};
  }
  make(kind) { this.created += 1; return new FakeNode(this, kind); }
  createGain() { return this.make('gain'); }
  createBiquadFilter() { return this.make('filter'); }
  createOscillator() { return this.make('osc'); }
  createBufferSource() { return this.make('noise'); }
  createBuffer(channels, length) {
    this.buffersCreated += 1;
    const data = new Float32Array(length);
    return { getChannelData: () => data, length };
  }
}

class ManualTimers {
  constructor() {
    this.pending = new Map();
    this.nextId = 1;
  }
  set(fn, ms) { const id = this.nextId++; this.pending.set(id, { fn, ms }); return id; }
  clear(id) { this.pending.delete(id); }
  fire() {
    const due = [...this.pending.entries()];
    this.pending.clear();
    due.forEach(([, t]) => t.fn());
  }
  loopCount() { return [...this.pending.values()].filter((t) => t.ms === MUSIC.timerMs).length; }
}

function createHarness(configOverride = {}, enabled = true) {
  const ctx = new FakeContext();
  const timers = new ManualTimers();
  const output = ctx.createGain();
  const config = { ...MUSIC, ...configOverride };
  const engine = new MusicEngine({ ctx, output, timers, config, enabled });
  const advance = (sec) => {
    const ticks = Math.round(sec / TICK_SEC);
    for (let i = 0; i < ticks; i++) {
      ctx.currentTime += TICK_SEC;
      timers.fire();
    }
  };
  return { ctx, timers, output, engine, advance, config };
}

function voiceKey(node) {
  return `${node.kind}:${node.startTime.toFixed(6)}:${node.frequency.value}`;
}

test('start with music disabled creates no node and no timer', () => {
  const { ctx, timers, engine } = createHarness({}, false);
  const baseline = ctx.created;
  assert.equal(engine.start(MODE), false);
  assert.equal(ctx.created, baseline);
  assert.equal(ctx.buffersCreated, 0);
  assert.equal(timers.pending.size, 0);
  assert.equal(ctx.started.length, 0);
});

test('setEnabled(false) stops a running engine and blocks later starts', () => {
  const { ctx, timers, engine } = createHarness();
  assert.equal(engine.start(MODE), true);
  engine.setEnabled(false);
  assert.equal(engine.running, false);
  assert.equal(timers.loopCount(), 0);
  const created = ctx.created;
  assert.equal(engine.start(MODE), false);
  assert.equal(ctx.created, created);
});

test('start with an unknown mode does nothing', () => {
  const { ctx, engine } = createHarness();
  const created = ctx.created;
  assert.equal(engine.start('nope'), false);
  assert.equal(ctx.created, created);
});

test('scheduler never schedules beyond the look-ahead window', () => {
  const { ctx, engine, advance } = createHarness();
  engine.start(MODE);
  for (let i = 0; i < 80; i++) {
    advance(TICK_SEC);
    const horizon = ctx.currentTime + MUSIC.lookAheadSec;
    for (const node of ctx.started) {
      // Hats and arps are scheduled at their step time, a step may start just inside the window.
      assert.ok(node.startTime < horizon + engine.stepDuration, `scheduled too far ahead: ${node.startTime}`);
    }
  }
  assert.ok(ctx.started.length > 0);
});

test('first tick schedules the opening bar notes at the start lead', () => {
  const { ctx, engine } = createHarness();
  engine.start(MODE);
  const first = ctx.started.map((n) => n.startTime);
  assert.ok(first.length >= 4, 'pad chord plus bass');
  assert.ok(first.every((t) => Math.abs(t - MUSIC.startLeadSec) < EPS));
});

test('no step is scheduled twice across many ticks', () => {
  const { ctx, engine, advance } = createHarness();
  engine.start(MODE);
  engine.setIntensity(1);
  advance(20);
  const keys = ctx.started.map(voiceKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.length > 100);
});

test('step times follow the tempo grid', () => {
  const { ctx, engine, advance } = createHarness();
  engine.start(MODE);
  advance(8);
  const stepSec = 60 / MUSIC.modes[MODE].bpm / MUSIC.stepsPerBeat;
  const bass = ctx.started.filter((n) => n.kind === 'osc').map((n) => n.startTime);
  for (const t of bass) {
    const steps = (t - MUSIC.startLeadSec) / stepSec;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `off grid: ${t}`);
  }
});

test('pause clears the timer and resume does not burst missed steps', () => {
  const { ctx, timers, engine, advance } = createHarness();
  engine.start(MODE);
  engine.setIntensity(1);
  advance(12);
  engine.pause();
  assert.equal(timers.loopCount(), 0);
  const before = ctx.started.length;
  advance(0); // nothing fires while paused
  assert.equal(ctx.started.length, before);
  ctx.currentTime += 60; // a long pause
  engine.resume();
  const added = ctx.started.slice(before);
  assert.ok(added.length > 0, 'resume schedules again');
  assert.ok(added.every((n) => n.startTime >= ctx.currentTime - EPS), 'nothing in the past');
  const stepsAdded = new Set(added.map((n) => n.startTime.toFixed(6))).size;
  assert.ok(stepsAdded <= Math.ceil(MUSIC.lookAheadSec / engine.stepDuration) + 1, `burst of ${stepsAdded} steps`);
  assert.equal(timers.loopCount(), 1);
});

test('a suspended context schedules nothing and a later resume skips the gap', () => {
  const { ctx, engine, advance } = createHarness();
  engine.start(MODE);
  advance(1);
  ctx.state = 'suspended';
  const before = ctx.started.length;
  advance(1);
  assert.equal(ctx.started.length, before);
  ctx.state = 'running';
  ctx.currentTime += 30;
  engine.onContextResumed();
  advance(TICK_SEC);
  const added = ctx.started.slice(before);
  assert.ok(added.every((n) => n.startTime >= ctx.currentTime - TICK_SEC));
  assert.ok(new Set(added.map((n) => n.startTime.toFixed(6))).size <= Math.ceil(MUSIC.lookAheadSec / engine.stepDuration) + 2);
});

test('voice cap: concurrent music voices never exceed maxVoices', () => {
  const cap = 3;
  const { ctx, engine, advance } = createHarness({ maxVoices: cap });
  engine.start(MODE);
  engine.setIntensity(1);
  advance(30);
  const intervals = ctx.started.map((n) => [n.startTime, n.stopTime]);
  assert.ok(intervals.length > 50);
  for (const [start] of intervals) {
    const active = intervals.filter(([s, e]) => s <= start + EPS && e > start + EPS).length;
    assert.ok(active <= cap, `${active} voices at ${start}`);
  }
});

test('intensity layers: pad and bass only at 0, arp and hats once intensity rises', () => {
  const { ctx, engine, advance } = createHarness();
  engine.start(MODE);
  advance(12);
  assert.equal(ctx.started.filter((n) => n.kind === 'noise').length, 0);
  assert.ok(ctx.started.some((node) => node.kind === 'osc'));
  const lowEnd = ctx.started.length;
  engine.setIntensity(1);
  advance(20);
  const later = ctx.started.slice(lowEnd);
  assert.ok(later.some((n) => n.kind === 'noise'), 'hats join');
  assert.equal(engine.getState().layer, MUSIC.intensity.layerThresholds.length - 1);
});

test('the lowpass opens only at the top layer', () => {
  const { engine, advance } = createHarness();
  engine.start(MODE);
  advance(3);
  engine.setIntensity(1);
  advance(30);
  const filterNode = engine.filter;
  assert.equal(filterNode.frequency.ramps.at(-1).v, MUSIC.filter.openHz);
});

test('intensityLayer maps thresholds to layers', () => {
  const th = MUSIC.intensity.layerThresholds;
  assert.equal(intensityLayer(0, th), 0);
  assert.equal(intensityLayer(0.34, th), 0);
  assert.equal(intensityLayer(0.35, th), 1);
  assert.equal(intensityLayer(0.7, th), 2);
  assert.equal(intensityLayer(0.9, th), 3);
});

test('phase lock: a small drift is nudged by at most maxNudgeSec per bar', () => {
  const { ctx, engine, advance } = createHarness();
  const spy = [];
  const realCreate = ctx.createOscillator.bind(ctx);
  ctx.createOscillator = () => { const o = realCreate(); spy.push(o); return o; };
  engine.start(MODE);
  advance(0.5);
  const beatSec = 60 / MUSIC.modes[MODE].bpm;
  const drift = 0.05; // under the re-anchor threshold, over the nudge bound
  const heard = engine.getHeardBeat();
  const target = heard + drift / beatSec;
  engine.syncToBeat(Math.floor(target), target - Math.floor(target));
  advance(8);
  const pads = spy.filter((o) => o.stopTime - o.startTime > 1);
  const starts = [...new Set(pads.map((o) => o.startTime.toFixed(9)))].map(Number).sort((a, b) => a - b);
  assert.ok(starts.length >= 3);
  const barSec = beatSec * 4;
  const shift = starts[1] - starts[0] - barSec;
  assert.ok(shift > 0, 'music moved toward the game beat');
  assert.ok(shift <= MUSIC.phaseLock.maxNudgeSec + EPS, `nudge ${shift}`);
});

test('phase lock: a drift beyond reanchorSec re-anchors at the next bar', () => {
  const { ctx, engine, advance } = createHarness();
  const spy = [];
  const realCreate = ctx.createOscillator.bind(ctx);
  ctx.createOscillator = () => { const o = realCreate(); spy.push(o); return o; };
  engine.start(MODE);
  advance(0.5);
  const beatSec = 60 / MUSIC.modes[MODE].bpm;
  const drift = 0.3;
  assert.ok(drift > MUSIC.phaseLock.reanchorSec);
  const target = engine.getHeardBeat() + drift / beatSec;
  engine.syncToBeat(Math.floor(target), target - Math.floor(target));
  advance(8);
  const pads = spy.filter((o) => o.stopTime - o.startTime > 1);
  const starts = [...new Set(pads.map((o) => o.startTime.toFixed(9)))].map(Number).sort((a, b) => a - b);
  const shift = starts[1] - starts[0] - beatSec * 4;
  assert.ok(Math.abs(shift - drift) < 1e-6, `re-anchor shift ${shift}`);
});

test('phase lock drops a queued correction on pause and ignores sync while paused', () => {
  const { engine, advance } = createHarness();
  engine.start(MODE);
  advance(0.5);
  engine.syncToBeat(0, 0.3);
  assert.notEqual(engine.pendingCorrection, null);
  engine.pause();
  assert.equal(engine.pendingCorrection, null);
  engine.syncToBeat(5, 0.5);
  assert.equal(engine.pendingCorrection, null);
});

test('stop fades the bus, clears the timer and schedules no more notes', () => {
  const { ctx, timers, engine, advance } = createHarness();
  engine.start(MODE);
  advance(1);
  const bus = engine.bus;
  engine.stop(0.4);
  assert.equal(timers.loopCount(), 0);
  const ramp = bus.gain.ramps.at(-1);
  assert.equal(ramp.v, 0);
  assert.ok(Math.abs(ramp.t - (ctx.currentTime + 0.4)) < EPS);
  const count = ctx.started.length;
  advance(2);
  assert.equal(ctx.started.length, count);
  assert.equal(engine.running, false);
});

test('setVolume scales the bus gain by the configured music gain', () => {
  const { engine } = createHarness();
  engine.start(MODE);
  engine.setVolume(0.5);
  assert.ok(Math.abs(engine.bus.gain.value - 0.5 * MUSIC.gain) < EPS);
  engine.setVolume(5);
  assert.ok(Math.abs(engine.bus.gain.value - MUSIC.gain) < EPS);
});

test('the hat noise buffer is generated once across restarts', () => {
  const { ctx, engine } = createHarness();
  engine.start(MODE);
  engine.stop(0);
  engine.start(GAME_MODES.BLITZ);
  assert.equal(ctx.buffersCreated, 1);
});

test('buildPattern is deterministic per seed key and varies between keys', () => {
  const cfg = MUSIC.modes[MODE];
  const a = buildPattern(cfg, 'campaign', MUSIC);
  const b = buildPattern(cfg, 'campaign', MUSIC);
  const c = buildPattern(cfg, 'other-key', MUSIC);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('buildPattern has 16-step bars, a 4-bar progression and a distinct variation', () => {
  for (const mode of Object.values(GAME_MODES)) {
    const pattern = buildPattern(MUSIC.modes[mode], mode, MUSIC);
    assert.equal(pattern.base.length, MUSIC.progressionBars);
    assert.equal(pattern.variation.length, MUSIC.progressionBars);
    for (const bar of pattern.base) {
      assert.equal(bar.steps.length, MUSIC.stepsPerBar);
      assert.ok(bar.steps[0].pad && bar.steps[0].bass, 'bar opens with pad and bass');
    }
    assert.notDeepEqual(pattern.base, pattern.variation, mode);
  }
});

test('buildPattern keeps every note inside the mode scale', () => {
  for (const mode of Object.values(GAME_MODES)) {
    const cfg = MUSIC.modes[mode];
    const pitchClasses = new Set(cfg.scale);
    const inScale = (freq) => {
      const semis = Math.round(SEMITONES * Math.log2(freq / cfg.rootHz));
      return pitchClasses.has(((semis % SEMITONES) + SEMITONES) % SEMITONES);
    };
    const pattern = buildPattern(cfg, mode, MUSIC);
    for (const bar of [...pattern.base, ...pattern.variation]) {
      for (const step of bar.steps) {
        step.pad?.forEach((f) => assert.ok(inScale(f), `${mode} pad ${f}`));
        if (step.bass) assert.ok(inScale(step.bass.freq), `${mode} bass`);
        if (step.arp) assert.ok(inScale(step.arp.freq), `${mode} arp`);
      }
    }
  }
});

test('bass sits on the chord root of each bar', () => {
  const cfg = MUSIC.modes[MODE];
  const pattern = buildPattern(cfg, MODE, MUSIC);
  pattern.base.forEach((bar) => {
    const root = degreeFrequency(cfg.rootHz, cfg.scale, bar.degree);
    bar.steps.filter((s) => s.bass).forEach((s) => assert.ok(Math.abs(s.bass.freq - root) < EPS));
  });
});

test('euclidHit spreads hits evenly and honours rotation', () => {
  const hits = (k, n, r = 0) => Array.from({ length: n }, (_, i) => euclidHit(i, k, n, r)).filter(Boolean).length;
  assert.equal(hits(4, 16), 4);
  assert.equal(hits(5, 16), 5);
  assert.equal(hits(5, 16, 3), 5);
  assert.equal(hits(0, 16), 0);
  assert.equal(euclidHit(0, 4, 16), true);
  assert.equal(euclidHit(1, 4, 16), false);
});

test('music config covers every mode with distinct tempi and valid structure', () => {
  const modes = Object.values(GAME_MODES);
  const bpms = new Set();
  for (const mode of modes) {
    const cfg = MUSIC.modes[mode];
    assert.ok(cfg, `missing ${mode}`);
    assert.ok(cfg.bpm >= 84 && cfg.bpm <= 132, `${mode} bpm`);
    bpms.add(cfg.bpm);
    assert.ok(cfg.rootHz > 0 && cfg.scale.length >= 5 && cfg.progression.length === MUSIC.progressionBars);
    assert.ok(cfg.scale.every((s) => s >= 0 && s < SEMITONES));
    for (const key of ['bass', 'arp', 'hat']) {
      assert.ok(Number.isInteger(cfg.euclid[key]) && cfg.euclid[key] > 0 && cfg.euclid[key] <= MUSIC.stepsPerBar);
    }
  }
  assert.equal(bpms.size, modes.length, 'tempi are distinct');
  assert.equal(Object.keys(MUSIC.modes).length, modes.length, 'no extra modes');
  assert.deepEqual(MUSIC.volumeSteps, [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(MUSIC.maxVoices, 8);
  assert.ok(AUDIO.effects.resonance.notes.length >= 3);
});
