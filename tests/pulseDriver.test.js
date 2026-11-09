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
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createPulseDriver } from '../src/ui/PulseDriver.js';
import { createCalibration } from '../src/ui/RhythmCalibration.js';
import { UIManager } from '../src/ui/UIManager.js';
import { medianOffsetMs, tapDeviationMs, combineIntensity } from '../src/game/Resonance.js';
import { GAME_STATES } from '../src/core/Constants.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
const audioConfig = loadJson('./configs/audio.json');
const RES = gameConfig.resonance;
const DRIVER = audioConfig.music.driver;
const FADE = audioConfig.music.endFadeSec;
const FRAME_MS = 16;
const MODE = 'campaign';
const HALF = 0.5;

/** An audio manager double with a music engine double, recording what the driver asks. */
const createAudioDouble = ({ active = true, hasMusic = true } = {}) => {
  const calls = [];
  const state = { running: false, modeKey: null };
  const music = {
    getState: () => ({ ...state }),
    stop: (fade) => { calls.push(['stop', fade]); state.running = false; state.modeKey = null; },
    setIntensity: (value) => calls.push(['intensity', value]),
    syncToBeat: (index, phase) => calls.push(['sync', index, phase])
  };
  const audio = {
    calls,
    state,
    music: hasMusic ? music : null,
    isMusicActive: () => audio.active,
    active,
    startMusic: (key) => {
      calls.push(['start', key]);
      if (!audio.active) {
        return false;
      }
      state.running = true;
      state.modeKey = key;
      return true;
    }
  };
  return audio;
};

const createEngineDouble = (overrides = {}) => ({
  getResonanceMode: () => MODE,
  getPulseState: () => ({ intensity: HALF, framesPerBeat: 37.5, beatIndex: 3, beatPhase: 0.25 }),
  ...overrides
});

const setup = (audioOptions, lead) => {
  const audio = createAudioDouble(audioOptions);
  const holder = { lead };
  const driver = createPulseDriver({
    audioManager: audio,
    getLead: () => holder.lead,
    driverConfig: DRIVER,
    fadeSec: FADE
  });
  return { audio, holder, driver };
};

const names = (audio) => audio.calls.map((call) => call[0]);
const countOf = (audio, name) => audio.calls.filter((call) => call[0] === name).length;

test('the music starts with a run being played, and stops with a fade when it is not', () => {
  const engine = createEngineDouble();
  const { audio, holder, driver } = setup({}, { engine, isPlaying: true });
  assert.equal(driver.update(0), true);
  assert.deepEqual(audio.calls[0], ['start', MODE]);
  holder.lead = { engine, isPlaying: false };
  assert.equal(driver.update(FRAME_MS), false);
  assert.deepEqual(audio.calls.at(-1), ['stop', FADE], 'paused or in a menu: it fades out');
  const before = audio.calls.length;
  driver.update(FRAME_MS * 2);
  assert.equal(audio.calls.length, before, 'a stopped music is not stopped again');
  holder.lead = { engine, isPlaying: true };
  driver.update(FRAME_MS * 3);
  assert.equal(countOf(audio, 'start'), 2, 'and it comes back with the run');
});

test('no music when muted or switched off, and none before the audio context exists', () => {
  const engine = createEngineDouble();
  const muted = setup({}, { engine, isPlaying: true });
  muted.audio.active = false;
  assert.equal(muted.driver.update(0), false);
  assert.ok(!names(muted.audio).includes('start'), 'a muted page never asks for the music');
  const noContext = setup({ hasMusic: false }, { engine, isPlaying: true });
  assert.equal(noContext.driver.update(0), false);
  assert.deepEqual(noContext.audio.calls, []);
  const noRun = setup({}, { engine: null, isPlaying: false });
  assert.equal(noRun.driver.update(0), false);
});

test('a mode change restarts the music for the new mode', () => {
  const holder = { mode: MODE };
  const engine = createEngineDouble({ getResonanceMode: () => holder.mode });
  const { audio, driver } = setup({}, { engine, isPlaying: true });
  driver.update(0);
  holder.mode = 'versus';
  driver.update(FRAME_MS);
  assert.deepEqual(audio.calls.filter((call) => call[0] === 'start'), [['start', MODE], ['start', 'versus']]);
});

test('the intensity and the beat are sent at their own intervals', () => {
  const engine = createEngineDouble();
  const { audio, driver } = setup({}, { engine, isPlaying: true });
  driver.update(0);
  assert.deepEqual(audio.calls.filter((call) => call[0] === 'intensity'), [['intensity', HALF]]);
  assert.deepEqual(audio.calls.filter((call) => call[0] === 'sync'), [['sync', 3, 0.25]]);
  driver.update(DRIVER.intensityIntervalMs - 1);
  assert.equal(countOf(audio, 'intensity'), 1, 'not again before the interval');
  driver.update(DRIVER.intensityIntervalMs);
  assert.equal(countOf(audio, 'intensity'), 2);
  assert.equal(countOf(audio, 'sync'), 1, 'the beat has a longer interval');
  driver.update(DRIVER.syncIntervalMs);
  assert.equal(countOf(audio, 'sync'), 2);
});

test('a board without a tempo is not synced', () => {
  const engine = createEngineDouble({
    getPulseState: () => ({ intensity: 0, framesPerBeat: 0, beatIndex: 0, beatPhase: 0 })
  });
  const { audio, driver } = setup({}, { engine, isPlaying: true });
  driver.update(0);
  assert.ok(!names(audio).includes('sync'));
});

test('the UI picks the lead board: the run, or the human board of a duel', () => {
  const ui = Object.create(UIManager.prototype);
  ui.engine = { state: GAME_STATES.PLAYING };
  ui.versus = null;
  assert.deepEqual(ui.getPulseLead(), { engine: ui.engine, isPlaying: true });
  ui.engine.state = GAME_STATES.PAUSED;
  assert.equal(ui.getPulseLead().isPlaying, false);
  const board = { state: GAME_STATES.PLAYING };
  let paused = false;
  ui.versus = { phase: 'playing', controller: { engines: [board, {}], isPaused: () => paused } };
  assert.deepEqual(ui.getPulseLead(), { engine: board, isPlaying: true });
  paused = true;
  assert.equal(ui.getPulseLead().isPlaying, false, 'a paused match');
  paused = false;
  ui.versus.phase = 'roundOver';
  assert.equal(ui.getPulseLead().isPlaying, false, 'between rounds');
});

test('driveMusic builds the driver once and waits for the audio config', () => {
  const ui = Object.create(UIManager.prototype);
  ui.pulseDriver = null;
  ui.audioManager = { config: null };
  ui.driveMusic(0);
  assert.equal(ui.pulseDriver, null, 'no config, no driver');
  const audio = createAudioDouble();
  audio.config = audioConfig;
  ui.audioManager = audio;
  ui.engine = { state: GAME_STATES.PLAYING, ...createEngineDouble() };
  ui.versus = null;
  ui.driveMusic(0);
  assert.ok(ui.pulseDriver);
  assert.deepEqual(audio.calls[0], ['start', MODE]);
});

// Calibration math.

const calibrationFor = (overrides = {}) => createCalibration({
  beats: RES.calibrationBeats,
  leadBeats: RES.calibrationLeadBeats,
  minTaps: RES.calibrationMinTaps,
  bpm: RES.calibrationBpm,
  maxOffsetMs: RES.maxOffsetMs,
  ...overrides
});

/** Plays a whole run, tapping every counted pulse `lateMs` after it. */
const playRun = (calibration, lateMs, { skip = [] } = {}) => {
  calibration.start(0);
  const first = calibration.beatMs;
  for (let i = 0; i < calibration.totalPulses; i++) {
    calibration.update(first + i * calibration.beatMs);
    if (i >= RES.calibrationLeadBeats && !skip.includes(i)) {
      calibration.tap(first + i * calibration.beatMs + lateMs);
    }
  }
  return calibration.update(first + calibration.totalPulses * calibration.beatMs);
};

test('the signed distance from a tap to the nearest pulse', () => {
  assert.equal(tapDeviationMs(1030, 1000, 600), 30);
  assert.equal(tapDeviationMs(1570, 1000, 600), -30, 'early for the next pulse');
  assert.equal(tapDeviationMs(1000, 1000, 600), 0);
  assert.equal(tapDeviationMs(400, 1000, 600), 0, 'before the first pulse, on the grid');
});

test('the offset is the median, rounded, and clamped to the allowed range', () => {
  assert.equal(medianOffsetMs([10, 20, 30], RES.maxOffsetMs), 20);
  assert.equal(medianOffsetMs([10, 20, 31, 41], RES.maxOffsetMs), 26, 'two middle values average, then round');
  assert.equal(medianOffsetMs([5, 5, 5, 5, 400], RES.maxOffsetMs), 5, 'a stray tap does not move it');
  assert.equal(medianOffsetMs([400, 410, 420], RES.maxOffsetMs), RES.maxOffsetMs);
  assert.equal(medianOffsetMs([-400, -410, -420], RES.maxOffsetMs), -RES.maxOffsetMs);
  assert.equal(medianOffsetMs([], RES.maxOffsetMs), null);
  assert.equal(medianOffsetMs([Number.NaN, 12], RES.maxOffsetMs), 12);
});

test('the intensity is the highest of its sources, kept in range', () => {
  assert.equal(combineIntensity([0.2, 0.7, 0.4]), 0.7);
  assert.equal(combineIntensity([-1, 3]), 1);
  assert.equal(combineIntensity([]), 0);
});

test('a run of steady late taps gives that lateness as the offset', () => {
  const calibration = calibrationFor();
  const outcome = playRun(calibration, 45);
  assert.equal(outcome.isDone, true);
  assert.deepEqual(calibration.getResult(), { taps: RES.calibrationBeats, offsetMs: 45 });
});

test('early taps give a negative offset', () => {
  const calibration = calibrationFor();
  playRun(calibration, -30);
  assert.equal(calibration.getResult().offsetMs, -30);
});

test('taps during the lead pulses and repeated taps on one pulse are not counted', () => {
  const calibration = calibrationFor();
  calibration.start(0);
  const first = calibration.beatMs;
  assert.equal(calibration.tap(first).isAccepted, false, 'a lead pulse');
  const counted = first + RES.calibrationLeadBeats * calibration.beatMs;
  assert.equal(calibration.tap(counted + 10).isAccepted, true);
  assert.equal(calibration.tap(counted + 20).isAccepted, false, 'a second tap on the same pulse');
  assert.equal(calibration.getTapCount(), 1);
});

test('too few taps give no offset, so the stored value is left alone', () => {
  const calibration = calibrationFor();
  const counted = [];
  for (let i = RES.calibrationLeadBeats; i < RES.calibrationLeadBeats + RES.calibrationBeats; i++) {
    counted.push(i);
  }
  playRun(calibration, 20, { skip: counted.slice(RES.calibrationMinTaps - 1) });
  const result = calibration.getResult();
  assert.ok(result.taps < RES.calibrationMinTaps);
  assert.equal(result.offsetMs, null);
});

test('the pulses fire once each, in order, and the run ends half a beat after the last', () => {
  const calibration = calibrationFor();
  calibration.start(0);
  const beat = calibration.beatMs;
  assert.deepEqual(calibration.update(beat - 1).fired, []);
  assert.deepEqual(calibration.update(beat).fired, [0]);
  assert.deepEqual(calibration.update(beat).fired, []);
  assert.deepEqual(calibration.update(beat * 3).fired, [1, 2]);
  const lastPulse = beat * calibration.totalPulses;
  assert.equal(calibration.update(lastPulse).isDone, false);
  assert.equal(calibration.update(lastPulse + beat * HALF + 1).isDone, true);
});

test('the ring clock counts engine frames from the first pulse', () => {
  const calibration = calibrationFor();
  calibration.start(1000);
  const stepMs = 16;
  assert.equal(calibration.getFrame(1000 + calibration.beatMs, stepMs), 0, 'zero on the first pulse');
  assert.equal(calibration.getFrame(1000 + calibration.beatMs + stepMs * 3, stepMs), 3);
});
test('in a local duel the music follows the board that is still playing', () => {
  const ui = Object.create(UIManager.prototype);
  ui.engine = { state: GAME_STATES.PLAYING };
  const first = { state: GAME_STATES.PLAYING };
  const second = { state: GAME_STATES.PLAYING };
  ui.versus = { phase: 'playing', controller: { engines: [first, second], isPaused: () => false } };
  assert.deepEqual(ui.getPulseLead(), { engine: first, isPlaying: true }, 'board 0 leads while it plays');
  first.state = GAME_STATES.GAME_OVER;
  assert.deepEqual(ui.getPulseLead(), { engine: second, isPlaying: true }, 'board 1 leads once board 0 stops');
  second.state = GAME_STATES.GAME_OVER;
  assert.equal(ui.getPulseLead().isPlaying, false, 'nobody plays');
  assert.equal(ui.getPulseLead().engine, first);
});
