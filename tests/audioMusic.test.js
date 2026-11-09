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

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { AudioManager } from '../src/core/AudioManager.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { createVersusStorageView } from '../src/core/StorageView.js';
import { GAME_MODES } from '../src/core/Constants.js';
import { UIManager } from '../src/ui/UIManager.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const audioConfig = loadJson('./configs/audio.json');
const gameConfig = loadJson('./configs/game.json');
configRegistry.configs.set('audio', audioConfig);
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

const MUSIC = audioConfig.music;
const TICK_SEC = MUSIC.timerMs / 1000;
const MODE = GAME_MODES.CAMPAIGN;
const FRESH_VOLUME = 0.2;
const EXPECTED_VOLUME_STEPS = [0.2, 0.4, 0.6, 0.8, 1];

class FakeParam {
  constructor(value = 0) {
    this.value = value;
  }
  setValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
  cancelScheduledValues() {}
}

class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(0);
    this.threshold = new FakeParam();
    this.knee = new FakeParam();
    this.ratio = new FakeParam();
    this.attack = new FakeParam();
    this.release = new FakeParam();
    this.Q = new FakeParam();
  }
  connect() {}
  disconnect() {}
  start() { this.ctx.started.push(this); }
  stop() {}
}

class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.sampleRate = 8000;
    this.destination = {};
    this.started = [];
    this.created = [];
  }
  make(kind) {
    const node = new FakeNode(this, kind);
    this.created.push(kind);
    return node;
  }
  createGain() { return this.make('gain'); }
  createBiquadFilter() { return this.make('filter'); }
  createOscillator() { return this.make('osc'); }
  createBufferSource() { return this.make('noise'); }
  createDynamicsCompressor() { return this.make('compressor'); }
  createBuffer(channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data, length };
  }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  resume() { this.state = 'running'; return Promise.resolve(); }
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

/** Runs fn with a fake AudioContext as window.AudioContext and a manual timer pair. */
function withAudio(fn, { muted = false, musicEnabled = true } = {}) {
  const previousWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeContext };
  try {
    const audio = new AudioManager();
    audio.init(muted, false, { musicEnabled, musicVolume: MUSIC.defaultVolume });
    const timers = new ManualTimers();
    audio.timers = timers;
    fn(audio, timers);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
}

const withHidden = (hidden, fn) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    value: { hidden, addEventListener() {} },
    configurable: true,
    writable: true
  });
  try {
    fn();
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, 'document', previous);
    } else {
      delete globalThis.document;
    }
  }
};

const runTicks = (audio, timers, count) => {
  for (let i = 0; i < count; i++) {
    audio.ctx.currentTime += TICK_SEC;
    timers.fire();
  }
};

test('the music engine exists only once a context does, and a shot-like call creates it', () => {
  withAudio((audio) => {
    assert.equal(audio.music, null);
    assert.equal(audio.startMusic(MODE), false, 'no context yet, nothing starts');
    audio.ensureContext();
    assert.ok(audio.music);
    assert.ok(audio.musicBus);
    assert.equal(audio.startMusic(MODE), true);
    const state = audio.getMusicState();
    assert.equal(state.running, true);
    assert.equal(state.modeKey, MODE);
  });
});

test('muted: no music node is created and nothing plays', () => {
  withAudio((audio) => {
    audio.ensureContext();
    const before = audio.ctx.created.length;
    assert.equal(audio.startMusic(MODE), false);
    assert.equal(audio.music.start(MODE), false, 'the engine itself refuses too');
    assert.equal(audio.ctx.created.length, before, 'no node created while muted');
    assert.equal(audio.getMusicState().running, false);
  }, { muted: true });
});

test('muting stops the playing music; it can start again once unmuted', () => {
  withAudio((audio, timers) => {
    audio.ensureContext();
    audio.startMusic(MODE);
    assert.equal(audio.getMusicState().running, true);
    audio.setMuted(true);
    assert.equal(audio.getMusicState().running, false);
    assert.equal(audio.startMusic(MODE), false);
    audio.setMuted(false);
    assert.equal(audio.startMusic(MODE), true);
    assert.equal(timers.loopCount(), 1);
  });
});

test('hidden: the music timer is paused and the context suspended; visible again resumes both', () => {
  withAudio((audio, timers) => {
    audio.ensureContext();
    audio.startMusic(MODE);
    assert.equal(timers.loopCount(), 1);
    withHidden(true, () => audio.syncContextState());
    assert.equal(timers.loopCount(), 0, 'timer cleared while hidden');
    assert.equal(audio.getMusicState().paused, true);
    assert.equal(audio.ctx.state, 'suspended');
    withHidden(false, () => audio.syncContextState());
    assert.equal(audio.ctx.state, 'running');
    assert.equal(audio.getMusicState().paused, false);
    assert.equal(timers.loopCount(), 1, 'timer armed again after resume');
  });
});

test('stopAll fades effect voices but never cuts the music voices', () => {
  withAudio((audio, timers) => {
    audio.ensureContext();
    audio.startMusic(MODE);
    runTicks(audio, timers, 4);
    const startedBefore = audio.ctx.started.length;
    audio.playTone('sine', 440, 220, 0.1);
    assert.equal(audio.getActiveVoiceCount(), 1);
    assert.equal(audio.stopAll(), true);
    assert.equal(audio.getActiveVoiceCount(), 0);
    assert.equal(audio.getMusicState().running, true, 'music keeps running');
    runTicks(audio, timers, 20);
    assert.ok(audio.ctx.started.length > startedBefore, 'music keeps scheduling notes');
  });
});

test('music off: effects still play and no music node exists', () => {
  withAudio((audio) => {
    audio.ensureContext();
    assert.equal(audio.startMusic(MODE), false);
    audio.playEffect('snap');
    assert.ok(audio.getActiveVoiceCount() > 0, 'the effect voice plays');
    assert.equal(audio.getMusicState().running, false);
  }, { musicEnabled: false });
});

test('victory and game over fade the music out; other effects leave it', () => {
  withAudio((audio) => {
    audio.ensureContext();
    audio.startMusic(MODE);
    audio.clock = () => 0;
    audio.playEffect('match');
    assert.equal(audio.getMusicState().running, true);
    const stops = [];
    audio.music.stop = (fade) => stops.push(fade);
    audio.clock = () => 1e6;
    audio.playEffect('victory');
    audio.clock = () => 2e6;
    audio.playEffect('gameOver');
    assert.deepEqual(stops, [MUSIC.endFadeSec, MUSIC.endFadeSec]);
  });
});

test('setMusicEnabled and setMusicVolume reach the engine and the state', () => {
  withAudio((audio) => {
    audio.ensureContext();
    audio.startMusic(MODE);
    audio.setMusicVolume(FRESH_VOLUME);
    assert.equal(audio.music.volume, FRESH_VOLUME);
    assert.equal(audio.getMusicState().volume, FRESH_VOLUME);
    audio.setMusicEnabled(false);
    assert.equal(audio.getMusicState().running, false);
    assert.equal(audio.getMusicState().enabled, false);
    audio.setMusicEnabled(true);
    assert.equal(audio.startMusic(MODE), true);
  });
});

test('storage: music and Resonance settings default, round trip, clamp and reject', () => {
  const storage = new StorageManager();
  storage.init();
  const keys = gameConfig.storage.keys;
  assert.equal(keys.musicEnabled, 'music_enabled');
  assert.equal(keys.musicVolume, 'music_volume');
  assert.equal(keys.resonanceEnabled, 'resonance_enabled');
  assert.equal(keys.rhythmOffsetMs, 'rhythm_offset_ms');
  assert.equal(gameConfig.defaults.musicVolume, MUSIC.defaultVolume, 'storage default matches the audio config');
  assert.deepEqual(gameConfig.defaults.musicVolumeSteps, EXPECTED_VOLUME_STEPS);
  assert.ok(EXPECTED_VOLUME_STEPS.includes(MUSIC.defaultVolume), 'the default volume is one of the steps');
  assert.equal(MUSIC.volumeSteps, undefined, 'the steps live in game.json defaults only');

  assert.equal(storage.getMusicEnabled(), true);
  assert.equal(storage.getMusicVolume(), MUSIC.defaultVolume);
  assert.equal(storage.getResonanceEnabled(), gameConfig.resonance.enabledByDefault);
  assert.equal(storage.getRhythmOffsetMs(), 0);

  storage.setMusicEnabled(false);
  assert.equal(storage.getMusicEnabled(), false);
  storage.setMusicVolume(FRESH_VOLUME);
  assert.equal(storage.getMusicVolume(), FRESH_VOLUME);
  storage.setMusicVolume(0.33);
  assert.equal(storage.getMusicVolume(), FRESH_VOLUME, 'a value outside the steps is ignored');
  storage.setResonanceEnabled(false);
  assert.equal(storage.getResonanceEnabled(), false);

  const max = gameConfig.resonance.maxOffsetMs;
  storage.setRhythmOffsetMs(max + 500);
  assert.equal(storage.getRhythmOffsetMs(), max);
  storage.setRhythmOffsetMs(-max - 500);
  assert.equal(storage.getRhythmOffsetMs(), -max);
  storage.setRhythmOffsetMs(12.6);
  assert.equal(storage.getRhythmOffsetMs(), 13);
  storage.setRhythmOffsetMs('abc');
  assert.equal(storage.getRhythmOffsetMs(), 0, 'garbage becomes zero');
});

test('storage view forwards the Pulse getters and ignores the setters', () => {
  const manager = new StorageManager();
  manager.init();
  manager.setMusicVolume(FRESH_VOLUME);
  manager.setRhythmOffsetMs(40);
  const view = createVersusStorageView(manager);
  assert.equal(view.getMusicEnabled(), manager.getMusicEnabled());
  assert.equal(view.getMusicVolume(), FRESH_VOLUME);
  assert.equal(view.getResonanceEnabled(), manager.getResonanceEnabled());
  assert.equal(view.getRhythmOffsetMs(), 40);
  view.setMusicVolume(1);
  view.setMusicEnabled(false);
  view.setResonanceEnabled(false);
  view.setRhythmOffsetMs(-40);
  assert.equal(manager.getMusicVolume(), FRESH_VOLUME);
  assert.equal(manager.getMusicEnabled(), true);
  assert.equal(manager.getResonanceEnabled(), true);
  assert.equal(manager.getRhythmOffsetMs(), 40);
});

/** UIManager with just enough surface for the Pulse settings controls. */
function createPulseUi({ musicEnabled = true, volume = MUSIC.defaultVolume, resonance = true } = {}) {
  const state = { musicEnabled, volume, resonance };
  const ui = Object.create(UIManager.prototype);
  ui.gameConfig = gameConfig;
  ui.storageManager = {
    getMusicEnabled: () => state.musicEnabled,
    setMusicEnabled: (v) => { state.musicEnabled = v; },
    getMusicVolume: () => state.volume,
    setMusicVolume: (v) => { state.volume = v; },
    getResonanceEnabled: () => state.resonance,
    setResonanceEnabled: (v) => { state.resonance = v; }
  };
  const audioCalls = [];
  ui.audioManager = {
    setMusicEnabled: (v) => audioCalls.push(['enabled', v]),
    setMusicVolume: (v) => audioCalls.push(['volume', v])
  };
  ui.elements = {};
  return { ui, state, audioCalls };
}

test('the Music toggle flips the stored setting and tells the audio manager', () => {
  const { ui, state, audioCalls } = createPulseUi();
  let refreshed = 0;
  ui.updateMusicButton = () => { refreshed += 1; };
  ui.toggleMusic();
  assert.equal(state.musicEnabled, false);
  ui.toggleMusic();
  assert.equal(state.musicEnabled, true);
  assert.deepEqual(audioCalls, [['enabled', false], ['enabled', true]]);
  assert.equal(refreshed, 2);
});

test('the Music volume button cycles the configured steps and wraps', () => {
  const steps = gameConfig.defaults.musicVolumeSteps;
  const { ui, state, audioCalls } = createPulseUi({ volume: steps.at(-1) });
  ui.updateMusicVolumeButton = () => {};
  ui.cycleMusicVolume();
  assert.equal(state.volume, steps[0], 'the last step wraps to the first');
  ui.cycleMusicVolume();
  assert.equal(state.volume, steps[1]);
  assert.deepEqual(audioCalls, [['volume', steps[0]], ['volume', steps[1]]]);
});

test('the Music volume button steps 0.6 to 0.8 and wraps from 1 to 0.2', () => {
  const { ui, state } = createPulseUi({ volume: 0.6 });
  ui.updateMusicVolumeButton = () => {};
  ui.cycleMusicVolume();
  assert.equal(state.volume, 0.8);
  ui.cycleMusicVolume();
  assert.equal(state.volume, 1);
  ui.cycleMusicVolume();
  assert.equal(state.volume, 0.2, 'the top step wraps to the lowest, never to a silent volume');
});

test('the Resonance toggle flips the stored setting', () => {
  const { ui, state } = createPulseUi();
  ui.updateResonanceButton = () => {};
  ui.toggleResonance();
  assert.equal(state.resonance, false);
  ui.toggleResonance();
  assert.equal(state.resonance, true);
});

test('setupPulseControls applies the stored music settings to the audio manager', () => {
  const { ui, audioCalls } = createPulseUi({ musicEnabled: false, volume: FRESH_VOLUME });
  ui.updateMusicButton = () => {};
  ui.updateMusicVolumeButton = () => {};
  ui.updateResonanceButton = () => {};
  ui.setupPulseControls();
  assert.deepEqual(audioCalls, [['enabled', false], ['volume', FRESH_VOLUME]]);
});

test('settings rows, locale keys and the precache list carry the Pulse controls', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  for (const id of ['btn-music', 'btn-music-volume', 'btn-resonance']) {
    assert.ok(html.includes(`id="${id}"`), `${id} row present`);
    assert.ok(html.includes(`data-caption-for="${id}"`), `${id} caption present`);
  }
  const sw = fs.readFileSync('./sw.js', 'utf8');
  assert.ok(sw.includes("'./src/core/MusicEngine.js'"));
  assert.ok(sw.includes("'./src/game/Resonance.js'"));
  const resolve = (obj, path) => path.split('.').reduce((node, key) => node?.[key], obj);
  const keys = [
    'app.nav.button.musicOn', 'app.nav.button.musicOff', 'app.nav.button.musicAria',
    'app.nav.button.musicOnAria', 'app.nav.button.musicOffAria', 'app.nav.button.musicVolume',
    'app.nav.button.musicVolumeAria', 'app.nav.button.musicVolumeCaption',
    'app.nav.button.resonanceOn', 'app.nav.button.resonanceOff', 'app.nav.button.resonanceAria',
    'app.nav.button.resonanceOnAria', 'app.nav.button.resonanceOffAria',
    'app.settings.calibrate.title', 'app.settings.calibrate.intro', 'app.settings.calibrate.tap',
    'app.settings.calibrate.result', 'app.settings.calibrate.reset', 'app.settings.calibrate.done',
    'gameplay.feedback.resonance', 'gameplay.resonance.disabledCompetitive', 'versus.setup.resonance'
  ];
  for (const lang of ['en', 'fr']) {
    const locale = loadJson(`./locales/${lang}.json`);
    for (const key of keys) {
      assert.equal(typeof resolve(locale, key), 'string', `${lang}: ${key}`);
    }
  }
});

test('an interrupted context counts as paused: the music timer stops and resumes with the state change', () => {
  withAudio((audio, timers) => {
    audio.ensureContext();
    audio.startMusic(MODE);
    assert.equal(timers.loopCount(), 1);
    assert.equal(typeof audio.ctx.onstatechange, 'function', 'the manager listens to the context');
    audio.ctx.state = 'interrupted';
    audio.ctx.onstatechange();
    assert.equal(audio.getMusicState().paused, true);
    assert.equal(timers.loopCount(), 0, 'no timer while interrupted');
    timers.fire();
    assert.equal(timers.loopCount(), 0, 'a stale timer never re-arms itself');
    audio.ctx.state = 'running';
    audio.ctx.onstatechange();
    assert.equal(audio.getMusicState().paused, false);
    assert.equal(timers.loopCount(), 1, 'the timer returns once the context runs');
  });
});

test('syncContextState treats a non-running visible context as paused and resumes it', async () => {
  await withAudioAsync(async (audio, timers) => {
    audio.ensureContext();
    audio.startMusic(MODE);
    audio.ctx.state = 'interrupted';
    let resumeCalls = 0;
    const resume = audio.ctx.resume.bind(audio.ctx);
    audio.ctx.resume = () => {
      resumeCalls += 1;
      return new Promise((resolve) => {
        audio.pendingResolve = () => {
          resume();
          resolve();
        };
      });
    };
    audio.syncContextState();
    assert.equal(resumeCalls, 1);
    assert.equal(audio.getMusicState().paused, true, 'paused until the context really runs');
    assert.equal(timers.loopCount(), 0);
    audio.pendingResolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(audio.getMusicState().paused, false);
    assert.equal(timers.loopCount(), 1);
  });
});

test('the music engine does not arm its timer while the context is not running', () => {
  withAudio((audio, timers) => {
    audio.ensureContext();
    audio.ctx.state = 'suspended';
    audio.startMusic(MODE);
    assert.equal(timers.loopCount(), 0, 'started on a suspended context: no timer yet');
    audio.music.resume();
    audio.music.onContextResumed();
    assert.equal(timers.loopCount(), 0);
    audio.ctx.state = 'running';
    audio.music.onContextResumed();
    assert.equal(timers.loopCount(), 1);
  });
});

async function withAudioAsync(fn) {
  const previousWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeContext };
  try {
    const audio = new AudioManager();
    audio.init(false, false, { musicEnabled: true, musicVolume: MUSIC.defaultVolume });
    const timers = new ManualTimers();
    audio.timers = timers;
    await fn(audio, timers);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
}
