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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { configRegistry } from '../src/core/ConfigRegistry.js';
import { i18n, t } from '../src/core/I18n.js';
import { uiCalibrationMethods } from '../src/ui/UICalibration.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const gameConfig = readJson('../configs/game.json');
const audioConfig = readJson('../configs/audio.json');
const physicsConfig = readJson('../configs/physics.json');
const en = readJson('../locales/en.json');

function makeElement(initialClasses = []) {
  const classes = new Set(initialClasses);
  const attributes = new Map();
  const listeners = new Map();
  return {
    textContent: '',
    style: {},
    classList: {
      add: (...tokens) => tokens.forEach((token) => classes.add(token)),
      remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
      toggle: (token, force) => {
        const next = force === undefined ? !classes.has(token) : Boolean(force);
        if (next) classes.add(token);
        else classes.delete(token);
        return next;
      },
      contains: (token) => classes.has(token)
    },
    setAttribute: (k, v) => attributes.set(k, String(v)),
    getAttribute: (k) => attributes.get(k) ?? null,
    removeAttribute: (k) => attributes.delete(k),
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch: (type, event = {}) => {
      for (const fn of listeners.get(type) ?? []) {
        fn(event);
      }
    }
  };
}

function makeCalibrationUi({ muted = false, hasClick = true, initialOffsetMs = 0 } = {}) {
  let storedOffset = initialOffsetMs;
  const calls = { pulseRefreshes: 0, effects: [], opened: 0, closed: 0 };
  const elements = {
    btnCalibrate: makeElement(),
    btnCalibrateTap: makeElement(),
    btnCalibrateDone: makeElement(),
    btnCalibrateReset: makeElement(),
    modalCalibrate: makeElement(['hidden']),
    calibrateRing: makeElement(['is-idle']),
    calibrateIntro: makeElement(),
    calibrateProgress: makeElement(),
    calibrateResult: makeElement()
  };
  const ui = {
    ...uiCalibrationMethods,
    gameConfig,
    elements,
    audioManager: {
      config: hasClick ? audioConfig : { ...audioConfig, effects: {} },
      isMuted: () => muted,
      playEffect: (name) => calls.effects.push(name)
    },
    storageManager: {
      getRhythmOffsetMs: () => storedOffset,
      setRhythmOffsetMs: (ms) => {
        storedOffset = ms;
      }
    },
    engine: {
      physicsConfig,
      isReducedMotion: false,
      refreshPulseSettings: () => {
        calls.pulseRefreshes += 1;
      }
    },
    versus: null,
    openOverlayModal: (modal) => {
      calls.opened += 1;
      modal.classList.remove('hidden');
    },
    closeOverlayModal: (modal) => {
      calls.closed += 1;
      modal.classList.add('hidden');
    },
    getPulseLead: () => null
  };
  return { ui, elements, calls, getStoredOffset: () => storedOffset };
}

function withEnglish(fn) {
  const prevLocale = i18n.currentLocale;
  const prevEn = i18n.dictionaries.get('en');
  i18n.dictionaries.set('en', en);
  i18n.currentLocale = 'en';
  try {
    fn();
  } finally {
    if (prevEn === undefined) i18n.dictionaries.delete('en');
    else i18n.dictionaries.set('en', prevEn);
    i18n.currentLocale = prevLocale;
  }
}

test('getCalibrationSettings merges resonance and audio click availability cleanly', () => {
  const { ui } = makeCalibrationUi({ hasClick: true });
  const withClick = ui.getCalibrationSettings();
  assert.equal(withClick.beats, gameConfig.resonance.calibrationBeats);
  assert.equal(withClick.minTaps, gameConfig.resonance.calibrationMinTaps);
  assert.equal(withClick.hasClick, true);

  ui.audioManager = null;
  const prevAudio = configRegistry.get('audio');
  configRegistry.configs.set('audio', { effects: {} });
  try {
    assert.equal(ui.getCalibrationSettings().hasClick, false);
  } finally {
    if (prevAudio === undefined) configRegistry.configs.delete('audio');
    else configRegistry.configs.set('audio', prevAudio);
  }
});

test('finishCalibrationRun shows tooFew without saving below minTaps and saves valid offset otherwise', () => {
  withEnglish(() => {
    const { ui, elements, calls, getStoredOffset } = makeCalibrationUi({ initialOffsetMs: 42 });
    ui.openCalibration();
    assert.equal(ui.isCalibrationOpen(), true);
    assert.equal(elements.calibrateRing.classList.contains('is-idle'), false);

    // Too few taps: keeps previous stored offset (42 ms) and shows tooFew text.
    ui.finishCalibrationRun();
    assert.equal(getStoredOffset(), 42);
    assert.equal(calls.pulseRefreshes, 0);
    assert.equal(elements.calibrateResult.textContent, t('app.settings.calibrate.tooFew', {
      min: gameConfig.resonance.calibrationMinTaps
    }));
    assert.equal(elements.calibrateRing.getAttribute('data-window'), null);
    assert.equal(elements.calibrateRing.classList.contains('is-idle'), true);

    // Start a fresh run with deterministic clock, deliver minTaps counted taps +35 ms late, then finish.
    ui.startCalibrationRun();
    const t0 = 1000;
    ui.calibration.start(t0);
    const beatMs = ui.calibration.beatMs;
    const firstPulseAt = t0 + beatMs;
    const leadBeats = gameConfig.resonance.calibrationLeadBeats;
    for (let i = 0; i < gameConfig.resonance.calibrationMinTaps; i += 1) {
      ui.registerCalibrationTap(firstPulseAt + (leadBeats + i) * beatMs + 35);
    }
    ui.finishCalibrationRun();
    assert.equal(getStoredOffset(), 35);
    assert.equal(calls.pulseRefreshes, 1);
    assert.match(elements.calibrateResult.textContent, /35/);
  });
});

test('registerCalibrationTap restarts only when open and resets cleanly via resetCalibration', () => {
  withEnglish(() => {
    const { ui, elements, calls, getStoredOffset } = makeCalibrationUi({ initialOffsetMs: 50 });
    ui.calibration = null;
    // Closed modal: tap does not start calibration.
    ui.registerCalibrationTap(100);
    assert.equal(ui.calibration, null);

    // Open modal with cleared calibration: tap starts a new run.
    elements.modalCalibrate.classList.remove('hidden');
    ui.registerCalibrationTap(100);
    assert.ok(ui.calibration);

    // Language refresh updates text only when calibration modal is open.
    elements.calibrateIntro.textContent = 'stale';
    ui.refreshCalibrationText();
    assert.notEqual(elements.calibrateIntro.textContent, 'stale');

    // Reset clears offset, notifies pulse settings, and starts a new run.
    ui.resetCalibration();
    assert.equal(getStoredOffset(), 0);
    assert.equal(calls.pulseRefreshes, 1);

    ui.closeCalibration();
    assert.equal(ui.calibration, null);
    assert.equal(ui.stackedModalOpener, elements.btnCalibrate);
    assert.equal(calls.closed, 1);
  });
});

test('drawCalibrationRing updates transform, opacity, and data-window and skips when incomplete', () => {
  const { ui, elements } = makeCalibrationUi();
  ui.drawCalibrationRing(0);
  assert.equal(elements.calibrateRing.getAttribute('data-window'), null);

  ui.startCalibrationRun();
  const t0 = 1000;
  ui.calibration.start(t0);
  const firstPulseAt = t0 + ui.calibration.beatMs;
  const beatAt = firstPulseAt + gameConfig.resonance.calibrationLeadBeats * ui.calibration.beatMs;
  ui.drawCalibrationRing(beatAt);
  assert.ok(elements.calibrateRing.style.transform.startsWith('scale('));
  assert.equal(elements.calibrateRing.getAttribute('data-window'), 'true');

  // Audio click plays when frame crosses pulse timestamps.
  ui.calibrationClickEnabled = true;
  ui.onCalibrationFrame(beatAt + 1);
  assert.ok(ui.audioManager.config.effects.calibrationClick);
});

test('bindAudioUnlock attaches and detaches once the first unmuted gesture fires', () => {
  const prevDoc = globalThis.document;
  const listeners = new Map();
  let contexts = 0;
  let muted = true;
  globalThis.document = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name)
  };
  try {
    const { ui } = makeCalibrationUi();
    ui.audioManager = {
      isMuted: () => muted,
      ensureContext: () => {
        contexts += 1;
      }
    };
    ui.bindAudioUnlock();
    assert.equal(listeners.has('pointerdown'), true);
    assert.equal(listeners.has('keydown'), true);

    listeners.get('pointerdown')();
    assert.equal(contexts, 0);
    assert.equal(listeners.has('pointerdown'), true);

    muted = false;
    listeners.get('keydown')();
    assert.equal(contexts, 1);
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.document = prevDoc;
  }
});
