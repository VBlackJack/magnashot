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
import { INPUT_MODES } from '../src/core/Constants.js';
import { GAMEPAD_ACTIONS as A } from '../src/core/GamepadInput.js';
import { i18n } from '../src/core/I18n.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { createVersusStorageView } from '../src/core/StorageView.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { MATCH_EVENTS, createVersusMatch } from '../src/game/VersusMatch.js';
import { DEVICE_TYPES } from '../src/ui/LocalInput.js';
import { UIManager } from '../src/ui/UIManager.js';
import { createVersusTutorial } from '../src/ui/VersusHud.js';
import { PAIRS, UsageError, checkThresholds, parseArgs } from '../scripts/calibrate-versus.mjs';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const campaignConfig = loadJson('./configs/campaign.json');
const campaignTuning = loadJson('./configs/campaignTuning.json');
const fluxConfig = loadJson('./configs/flux.json');
const audioConfig = loadJson('./configs/audio.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('campaign', campaignConfig);
configRegistry.configs.set('audio', audioConfig);
configRegistry.configs.set('flux', fluxConfig);

for (const locale of ['en', 'fr']) {
  i18n.dictionaries.set(locale, loadJson(`./locales/${locale}.json`));
}

const configs = {
  gameConfig,
  physicsConfig,
  ballsConfig,
  obstaclesConfig,
  levelsConfig,
  campaignConfig,
  campaignTuning,
  fluxConfig
};

const CALIBRATION = gameConfig.versus.calibration;
const TUTORIAL = gameConfig.versus.tutorial;
const PAN_PROBE_FRAMES = 3000;
const LEFT_PAN = -1;
const RIGHT_PAN = 1;
const PLAYER_BOARD = 0;
const CPU_BOARD = 1;

const memoryStorage = () => {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear()
  };
};

const withStorage = (fn) => {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  }
};

const createManager = () => {
  const manager = new StorageManager();
  manager.init();
  return manager;
};

/** Element stand-in: classes, attributes, children, listeners and focus. */
function fakeElement(tag) {
  const classes = new Set();
  const listeners = {};
  const el = {
    tag,
    id: '',
    type: '',
    textContent: '',
    children: [],
    attrs: {},
    listeners,
    focused: false,
    removed: false,
    set className(value) {
      classes.clear();
      value.split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
    },
    get className() {
      return [...classes].join(' ');
    },
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      }
    },
    setAttribute(name, value) { el.attrs[name] = String(value); },
    append(...nodes) { el.children.push(...nodes); },
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
    focus() { el.focused = true; },
    remove() { el.removed = true; },
    click() { (listeners.click || []).forEach((handler) => handler({})); }
  };
  return el;
}

const findById = (root, id) => {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
};

function makeTutorial() {
  const closed = [];
  const tutorial = createVersusTutorial({
    steps: TUTORIAL.steps,
    stepKeyPrefix: TUTORIAL.stepKeyPrefix,
    onClose: (reason) => closed.push(reason),
    createElement: fakeElement
  });
  return { tutorial, closed };
}

test('the tutorial opens on step one as a modal dialog and focuses its primary button', () => {
  i18n.currentLocale = 'en';
  const { tutorial } = makeTutorial();
  assert.equal(tutorial.element.classList.contains('hidden'), true);
  tutorial.open();
  assert.equal(tutorial.isOpen(), true);
  assert.equal(tutorial.element.classList.contains('hidden'), false);
  assert.equal(tutorial.element.attrs.role, 'dialog');
  assert.equal(tutorial.element.attrs['aria-modal'], 'true');
  assert.ok(tutorial.element.attrs['aria-labelledby']);
  assert.equal(findById(tutorial.element, 'versus-tutorial-next').focused, true);
  assert.match(findById(tutorial.element, 'versus-tutorial-progress').textContent, /1.*3/);
  assert.equal(findById(tutorial.element, 'versus-tutorial-step').textContent, 'Charges');
});

test('Next walks the three steps and the last one closes the dialog as done', () => {
  i18n.currentLocale = 'en';
  const { tutorial, closed } = makeTutorial();
  tutorial.open();
  const next = findById(tutorial.element, 'versus-tutorial-next');
  const skip = findById(tutorial.element, 'versus-tutorial-skip');
  assert.equal(skip.classList.contains('hidden'), false);
  next.click();
  assert.equal(tutorial.index, 1);
  assert.equal(findById(tutorial.element, 'versus-tutorial-step').textContent, 'Polarity guard');
  next.click();
  assert.equal(tutorial.index, 2);
  assert.equal(next.textContent, 'Got it');
  assert.equal(skip.classList.contains('hidden'), true);
  next.click();
  assert.deepEqual(closed, ['done']);
  assert.equal(tutorial.isOpen(), false);
  assert.equal(tutorial.element.classList.contains('hidden'), true);
});

test('Skip closes at once, once, and a closed tutorial ignores further input', () => {
  i18n.currentLocale = 'en';
  const { tutorial, closed } = makeTutorial();
  tutorial.open();
  findById(tutorial.element, 'versus-tutorial-skip').click();
  tutorial.close('skip');
  tutorial.next();
  assert.deepEqual(closed, ['skip']);
});

test('refresh rewrites the dialog in the current language', () => {
  i18n.currentLocale = 'en';
  const { tutorial } = makeTutorial();
  tutorial.open();
  const skip = findById(tutorial.element, 'versus-tutorial-skip');
  assert.equal(skip.textContent, 'Skip');
  i18n.currentLocale = 'fr';
  tutorial.refresh();
  assert.equal(skip.textContent, 'Passer');
  i18n.currentLocale = 'en';
});

test('every tutorial step has a title and a body in both languages', () => {
  for (const locale of ['en', 'fr']) {
    const dictionary = i18n.dictionaries.get(locale);
    for (const id of TUTORIAL.steps) {
      const step = dictionary.versus.tutorial.step[id];
      assert.ok(step?.title && step?.body, `${locale} step ${id}`);
    }
    assert.ok(dictionary.modals.settings.controller.rumble, `${locale} rumble label`);
  }
});

test('the tutorial flag is stored once, reads false by default and is not written by a versus board', () => {
  withStorage(() => {
    const manager = createManager();
    assert.equal(manager.getVersusTutorialSeen(), false);
    manager.setVersusTutorialSeen(true);
    assert.equal(manager.getVersusTutorialSeen(), true);
    assert.equal(globalThis.localStorage.getItem(`${gameConfig.storage.prefix}${gameConfig.storage.keys.versusTutorialSeen}`), 'true');

    const view = createVersusStorageView(createManager());
    assert.equal(view.getVersusTutorialSeen(), false);
    view.setVersusTutorialSeen(false);
    assert.equal(manager.getVersusTutorialSeen(), true);
  });
});

test('the Vibration setting defaults on, persists, and a versus board reads it but never writes it', () => {
  withStorage(() => {
    const manager = createManager();
    assert.equal(manager.getGamepadRumble(), true);
    manager.setGamepadRumble(false);
    assert.equal(manager.getGamepadRumble(), false);
    const view = createVersusStorageView(manager);
    assert.equal(view.getGamepadRumble(), false);
    view.setGamepadRumble(true);
    assert.equal(manager.getGamepadRumble(), false);
  });
});

test('both boards of a duel play their sounds on their own side of the stereo field', () => {
  withStorage(() => {
    const pans = new Set();
    const audio = {
      playEffect: (name, combo, options) => pans.add(options?.pan),
      stopAll() {},
      isMuted: () => false,
      setMuted() {}
    };
    const match = createVersusMatch({
      seed: 'pan-probe',
      mode: 'cpu',
      playerBoard: null,
      cpuTiers: ['hard', 'hard'],
      configs,
      storageManager: createManager(),
      audioManager: audio,
      mutedBoards: [false, false]
    });
    for (let i = 0; i < PAN_PROBE_FRAMES; i++) {
      match.step();
    }
    assert.ok(pans.has(LEFT_PAN), 'the first board sounds on the left');
    assert.ok(pans.has(RIGHT_PAN), 'the second board sounds on the right');
  });
});

test('the calibration thresholds exist in the game config and cover the spec pairs', () => {
  assert.equal(CALIBRATION.hardBeatsEasyMin, 0.8);
  assert.equal(CALIBRATION.normalBeatsEasyMin, 0.65);
  assert.deepEqual(CALIBRATION.pulsesPerRound, { min: 1.5, max: 3.5 });
  assert.deepEqual(PAIRS.map((pair) => `${pair.strong}>${pair.weak}`), ['hard>easy', 'normal>easy']);
  for (const pair of PAIRS) {
    assert.equal(typeof CALIBRATION[pair.thresholdKey], 'number');
  }
});

test('checkThresholds fails when a tier is too weak or the pulse pace leaves its band', () => {
  const summary = (hard, normal, pulses) => ({
    pairs: [
      { thresholdKey: 'hardBeatsEasyMin', share: hard },
      { thresholdKey: 'normalBeatsEasyMin', share: normal }
    ],
    pulsesPerRound: pulses
  });
  assert.equal(checkThresholds(summary(0.8, 0.65, 2), CALIBRATION).ok, true);
  assert.equal(checkThresholds(summary(0.79, 0.9, 2), CALIBRATION).ok, false);
  assert.equal(checkThresholds(summary(1, 0.64, 2), CALIBRATION).ok, false);
  assert.equal(checkThresholds(summary(1, 1, 1.49), CALIBRATION).pulses, false);
  assert.equal(checkThresholds(summary(1, 1, 3.51), CALIBRATION).pulses, false);
  assert.equal(checkThresholds(summary(1, 1, 3.5), CALIBRATION).pulses, true);
});

test('calibrate-versus parses --seeds and refuses bad options', () => {
  assert.deepEqual(parseArgs([], CALIBRATION.defaultSeeds), { seeds: CALIBRATION.defaultSeeds });
  assert.deepEqual(parseArgs(['--seeds', '4'], CALIBRATION.defaultSeeds), { seeds: 4 });
  assert.throws(() => parseArgs(['--seeds', '0'], 1), UsageError);
  assert.throws(() => parseArgs(['--seeds'], 1), UsageError);
  assert.throws(() => parseArgs(['--nope'], 1), UsageError);
});

/** A UIManager with just enough surface for the duel routing. */
function makeVersusUi({ kind = 'cpu', slots = null, inputMode = INPUT_MODES.GAMEPAD } = {}) {
  const ui = Object.create(UIManager.prototype);
  ui.gameConfig = gameConfig;
  ui.inputMode = inputMode;
  ui.gamepadInput = { activeIndex: 2, settings: {} };
  const rumbles = [];
  ui.rumbleGamepad = (type, padIndex) => rumbles.push([type, padIndex]);
  ui.versus = { kind, slots, tutorial: null };
  return { ui, rumbles };
}

test('in a duel against the CPU the active pad shakes for charges, pulses and a lost round on the player board', () => {
  const { ui, rumbles } = makeVersusUi();
  ui.rumbleForVersusEvent({ type: MATCH_EVENTS.CHARGE_LANDED, board: PLAYER_BOARD });
  ui.rumbleForVersusEvent({ type: MATCH_EVENTS.PULSE_RECEIVED, board: PLAYER_BOARD });
  ui.rumbleForVersusEvent({ type: MATCH_EVENTS.ROUND_LOST });
  assert.deepEqual(rumbles, [['charge', 2], ['pulse', 2], ['roundLost', 2]]);
});

test('nothing shakes for the CPU board, for other events, or when the player is not on a pad', () => {
  const { ui, rumbles } = makeVersusUi();
  ui.rumbleForVersusEvent({ type: MATCH_EVENTS.CHARGE_LANDED, board: CPU_BOARD });
  ui.rumbleForVersusEvent({ type: MATCH_EVENTS.CHARGE_NEUTRALISED, board: PLAYER_BOARD });
  ui.rumbleForVersusEvent({ type: MATCH_EVENTS.ROUND_WON });
  assert.deepEqual(rumbles.map(([, index]) => index), [-1]);
  const mouse = makeVersusUi({ inputMode: INPUT_MODES.POINTER });
  mouse.ui.rumbleForVersusEvent({ type: MATCH_EVENTS.PULSE_RECEIVED, board: PLAYER_BOARD });
  assert.deepEqual(mouse.rumbles, [['pulse', -1]]);
});

test('in a two-player duel each board shakes the pad of its own player', () => {
  const slots = [
    { device: { type: DEVICE_TYPES.PAD, padIndex: 0 }, padLost: false },
    { device: { type: DEVICE_TYPES.PAD, padIndex: 3 }, padLost: false }
  ];
  const { ui, rumbles } = makeVersusUi({ kind: 'local', slots });
  ui.rumbleForVersusEvent({ type: MATCH_EVENTS.CHARGE_LANDED, board: CPU_BOARD });
  ui.rumbleForVersusEvent({ type: MATCH_EVENTS.ROUND_DECIDED, loser: PLAYER_BOARD, winner: CPU_BOARD });
  slots[1].device = { type: DEVICE_TYPES.KEYBOARD, side: 'right' };
  ui.rumbleForVersusEvent({ type: MATCH_EVENTS.PULSE_RECEIVED, board: CPU_BOARD });
  assert.deepEqual(rumbles, [['charge', 3], ['roundLost', 0], ['pulse', -1]]);
});

test('the tutorial opens once per device, holds the match, and closing resumes it', () => {
  withStorage(() => {
    const previousDocument = globalThis.document;
    const body = fakeElement('body');
    globalThis.document = { body, activeElement: null, createElement: fakeElement };
    try {
      const calls = [];
      const ui = Object.create(UIManager.prototype);
      ui.gameConfig = gameConfig;
      ui.storageManager = createManager();
      ui.elements = { versusCanvas0: fakeElement('canvas') };
      ui.syncModalInertState = () => {};
      ui.versus = {
        kb: { releaseAll: () => calls.push('release') },
        controller: { pause: () => calls.push('pause'), resume: () => calls.push('resume') },
        tutorial: null,
        hudDirty: false
      };

      ui.maybeShowVersusTutorial();
      assert.equal(ui.isVersusTutorialOpen(), true);
      assert.deepEqual(calls, ['release', 'pause']);
      assert.equal(body.children.length, 1);
      assert.equal(ui.storageManager.getVersusTutorialSeen(), true);

      // Escape (the back action) skips the dialog and hands the board back.
      assert.equal(ui.handleVersusBack(), true);
      assert.equal(ui.isVersusTutorialOpen(), false);
      assert.deepEqual(calls, ['release', 'pause', 'resume']);
      assert.equal(ui.elements.versusCanvas0.focused, true);

      // A second duel on this device shows nothing.
      ui.maybeShowVersusTutorial();
      assert.equal(ui.isVersusTutorialOpen(), false);
      assert.equal(body.children.length, 1);
    } finally {
      globalThis.document = previousDocument;
    }
  });
});

test('a pad moves the tutorial on with the bottom button and skips it with back or Start', () => {
  const ui = Object.create(UIManager.prototype);
  const closed = [];
  const tutorial = createVersusTutorial({
    steps: TUTORIAL.steps,
    stepKeyPrefix: TUTORIAL.stepKeyPrefix,
    onClose: (reason) => closed.push(reason),
    createElement: fakeElement
  });
  tutorial.open();
  ui.versus = { tutorial };
  ui.routeVersusTutorialActions([A.SHOOT]);
  assert.equal(tutorial.index, 1);
  ui.routeVersusTutorialActions([A.PAUSE]);
  assert.deepEqual(closed, ['skip']);
});

test('closing the tutorial keeps a blocked local match paused behind its pause dialog', () => {
  const calls = [];
  const ui = Object.create(UIManager.prototype);
  ui.elements = { versusCanvas0: fakeElement('canvas') };
  ui.syncModalInertState = () => {};
  ui.isVersusResumeBlocked = () => true;
  ui.pauseVersus = () => calls.push('pauseDialog');
  ui.versus = {
    tutorial: { element: fakeElement('div') },
    controller: { resume: () => calls.push('resume') },
    hudDirty: false
  };
  ui.closeVersusTutorial();
  assert.deepEqual(calls, ['pauseDialog']);
  assert.equal(ui.versus.tutorial, null);
  assert.notEqual(ui.elements.versusCanvas0.focused, true);
});

test('the tutorial makes the duel screen inert while it is open and restores it on close', () => {
  const makeScreen = () => {
    const attrs = {};
    return {
      inert: false,
      attrs,
      setAttribute: (name, value) => { attrs[name] = value; },
      removeAttribute: (name) => { delete attrs[name]; }
    };
  };
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null, body: fakeElement('body'), documentElement: {} };
  try {
    const ui = Object.create(UIManager.prototype);
    const screen = makeScreen();
    ui.elements = { appShell: makeScreen(), versusScreen: screen, versusCanvas0: fakeElement('canvas') };
    ui.getModalsByPriority = () => [];
    ui.getActiveTopModal = () => null;
    ui.keepFocusInTopModal = () => {};
    ui.lastFocusedElement = null;
    ui.versus = { tutorial: null };
    ui.syncModalInertState();
    assert.equal(screen.inert, false);
    ui.versus.tutorial = { element: fakeElement('div') };
    ui.syncModalInertState();
    assert.equal(screen.inert, true);
    assert.equal(screen.attrs['aria-hidden'], 'true');
    ui.versus.tutorial = null;
    ui.syncModalInertState();
    assert.equal(screen.inert, false);
    assert.equal('aria-hidden' in screen.attrs, false);
  } finally {
    globalThis.document = previousDocument;
  }
});
