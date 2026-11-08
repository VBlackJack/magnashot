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

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GAME_MODES, GAME_STATES, INPUT_MODES } from '../src/core/Constants.js';
import { GAMEPAD_ACTIONS as A, GAMEPAD_EVENTS } from '../src/core/GamepadInput.js';
import { i18n } from '../src/core/I18n.js';
import { buildShareText } from '../src/game/DailyShare.js';
import { createGameLoop } from '../src/game/GameLoop.js';
import { MATCH_EVENTS } from '../src/game/VersusMatch.js';
import {
  DEVICE_TYPES,
  assignPad,
  createSlots,
  createSplitKeyboard,
  joinSlot,
  markPadLost
} from '../src/ui/LocalInput.js';
import { UIManager } from '../src/ui/UIManager.js';
import { MODE_NAME_KEYS, ARCADE_CARD_SPECS } from '../src/ui/UIHelpers.js';
import { buildStatsOverview, formatVersusLocalLines, formatVersusTierLines } from '../src/ui/UIStats.js';

const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
const indexHtml = readFileSync('./index.html', 'utf8');
for (const locale of ['en', 'fr']) {
  i18n.dictionaries.set(locale, loadJson(`./locales/${locale}.json`));
}

let originalDocument;
beforeEach(() => {
  originalDocument = globalThis.document;
  i18n.currentLocale = 'en';
});
afterEach(() => {
  globalThis.document = originalDocument;
  i18n.currentLocale = 'en';
});

const FIXED_STEP_MS = 10;
const FRAME_DELTA_MS = 10;
const FRAMES = 5;

/** A minimal element: text, classes, attributes, children and listeners. */
function fakeElement({ hidden = true } = {}) {
  const classes = new Set(hidden ? ['hidden'] : []);
  const listeners = {};
  return {
    textContent: '',
    value: '',
    dataset: {},
    style: {},
    children: [],
    attrs: {},
    listeners,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return on;
      }
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    addEventListener(name, handler) {
      listeners[name] = handler;
    },
    focus() {
      globalThis.document.activeElement = this;
    }
  };
}

// ---------------------------------------------------------------------------------------------
// The game loop drives a scene that brings its own step
// ---------------------------------------------------------------------------------------------

function makeSteppedScene({ isAdvancing } = {}) {
  const log = [];
  const makeBoard = (name) => ({
    engine: {
      state: GAME_STATES.PLAYING,
      hitStopFrames: 0,
      stageTransitionFrames: 0,
      update: () => log.push(`${name}:update`),
      refreshAimPreview: () => {},
      isVictoryCelebrating: () => false
    },
    renderer: { render: (engine, alpha) => log.push(`${name}:render:${alpha}`) }
  });
  const scene = {
    boards: [makeBoard('a'), makeBoard('b')],
    versus: true,
    step: () => log.push('step')
  };
  if (isAdvancing) {
    scene.isAdvancing = isAdvancing;
  }
  return { scene, log };
}

function runLoop(scene, idleRenderIntervalMs = FIXED_STEP_MS) {
  const frames = [];
  const loop = createGameLoop({
    getScene: () => scene,
    fixedStepMs: FIXED_STEP_MS,
    maxAccumulatedMs: FIXED_STEP_MS * FRAMES,
    idleRenderIntervalMs,
    scheduleFrame: (callback) => frames.push(callback),
    onFatalError: (error) => {
      throw error;
    }
  });
  loop.start();
  for (let i = 0; i < FRAMES; i++) {
    frames.shift()(i * FRAME_DELTA_MS);
  }
}

test('a scene with its own step is stepped once per fixed step and its boards are not updated one by one', () => {
  const { scene, log } = makeSteppedScene();
  runLoop(scene);
  assert.equal(log.filter((entry) => entry === 'step').length, FRAMES - 1, 'one step per elapsed fixed step');
  assert.equal(log.filter((entry) => entry.endsWith(':update')).length, 0);
  assert.ok(log.some((entry) => entry.startsWith('a:render')) && log.some((entry) => entry.startsWith('b:render')), 'both boards are drawn');
});

test('a scene that is held is drawn without interpolation', () => {
  const { scene, log } = makeSteppedScene({ isAdvancing: () => false });
  runLoop(scene);
  const alphas = log.filter((entry) => entry.includes(':render:')).map((entry) => entry.split(':')[2]);
  assert.ok(alphas.length > 0);
  assert.ok(alphas.every((alpha) => alpha === '1'), `alphas ${alphas}`);
});

test('a scene that is held is redrawn at the idle interval, not on every frame', () => {
  const idleInterval = FIXED_STEP_MS * FRAMES * 10;
  const live = makeSteppedScene({ isAdvancing: () => true });
  runLoop(live.scene, idleInterval);
  const held = makeSteppedScene({ isAdvancing: () => false });
  runLoop(held.scene, idleInterval);
  const renders = (log) => log.filter((entry) => entry.startsWith('a:render')).length;
  assert.equal(renders(live.log), FRAMES, 'a running scene is drawn every frame');
  assert.equal(renders(held.log), 1, 'a held scene is drawn once, then at the idle interval');
});

// ---------------------------------------------------------------------------------------------
// The screen controller, over stub elements and a stub match
// ---------------------------------------------------------------------------------------------

function makeEngine() {
  const calls = [];
  return {
    calls,
    state: GAME_STATES.PLAYING,
    aimAngle: -1,
    isPolarityFlipped: false,
    currentBall: { specialType: null },
    specialInventory: {},
    swapLauncherBalls: () => calls.push('swap'),
    togglePolarityFlip: () => calls.push('flip'),
    shoot: () => calls.push('shoot'),
    adjustAimByDelta: (delta) => calls.push(['aim', delta]),
    equipSpecialBall: (type) => calls.push(['equip', type])
  };
}

function makeController() {
  const engines = [makeEngine(), makeEngine()];
  const log = [];
  let paused = false;
  return {
    engines,
    log,
    pause: () => {
      paused = true;
      log.push('pause');
    },
    resume: () => {
      paused = false;
      log.push('resume');
    },
    isPaused: () => paused,
    restart: (seed) => log.push(['restart', seed]),
    getState: () => ({
      frame: 120,
      boards: [
        { index: 0, stats: { neutralised: 2, pulsesSent: 0 }, matchStats: { neutralised: 14, pulsesSent: 3 } },
        { index: 1, stats: { neutralised: 1, pulsesSent: 0 }, matchStats: { neutralised: 5, pulsesSent: 1 } }
      ]
    })
  };
}

function makeUi({ phase = 'playing', storage = {} } = {}) {
  globalThis.document = {
    activeElement: null,
    body: {},
    createElement: () => fakeElement({ hidden: false })
  };
  const els = {};
  for (const key of [
    'modalConfirm', 'modalLevels', 'modalShop', 'modalSettings', 'modalStats', 'modalVersusTiers', 'modalDuelPause',
    'modalDuelResult', 'versusRoundOverlay', 'versusResultShareFallback', 'versusScreen', 'versusTierHint', 'btnVersusShare',
    'btnVersusResume', 'btnVersusRematch', 'versusCanvas0', 'versusResultTitle', 'versusResultScore', 'versusResultTier',
    'versusResultNeutralised', 'versusResultPulses', 'modalPause', 'btnResume'
  ]) {
    els[key] = fakeElement();
  }
  els.versusTierList = fakeElement({ hidden: false });
  els.btnModeVersus = fakeElement({ hidden: false });
  const ui = Object.create(UIManager.prototype);
  ui.gameConfig = gameConfig;
  ui.ballsConfig = { specialTypes: {} };
  ui.elements = els;
  ui.engine = { state: GAME_STATES.PLAYING, togglePause: () => ui.pauseCalls.push('main') };
  ui.pauseCalls = [];
  ui.isDrawerOpen = false;
  ui.inputMode = INPUT_MODES.GAMEPAD;
  ui.announcements = [];
  ui.announce = (message) => ui.announcements.push(message);
  ui.syncModalInertState = () => {};
  ui.saveLastFocusedElement = () => {};
  ui.isDuelCardOpen = () => false;
  ui.dismissDuelCard = () => {};
  ui.dismissConfirm = () => {};
  ui.closeOverlayModal = (modal) => modal.classList.add('hidden');
  ui.getActiveTopModal = () => Object.values(els).find((el) => el.classList?.contains && !el.classList.contains('hidden') && el.isModal) ?? null;
  ui.isAnyModalOpen = () => [els.modalDuelPause, els.modalDuelResult].some((modal) => !modal.classList.contains('hidden'));
  const recorded = { results: [], stats: [] };
  ui.storageManager = {
    recordVersusResult: (tier, won) => recorded.results.push([tier, won]),
    applyPlayerStatsDelta: (delta) => recorded.stats.push(delta),
    isVersusTierUnlocked: () => true,
    getVersusTiers: () => ['easy', 'normal', 'hard'],
    getVersusRecords: () => ({}),
    ...storage
  };
  const controller = makeController();
  ui.versus = {
    tier: 'hard',
    controller,
    phase,
    hudDirty: false,
    result: null,
    clock: 0,
    renderers: [{ dispose() {} }, { dispose() {} }],
    queue: { push: () => [], drain: () => [] },
    hud: { refreshLabels() {}, refresh() {}, refreshPlayerControls: () => false }
  };
  ui.setActiveScene('versus', ui.versusSceneController = {
    handleGameplayKey: (event) => ui.handleVersusGameplayKey(event),
    handleGamepadActions: (actions, delta) => ui.handleVersusGamepadActions(actions, delta),
    pause: () => ui.pauseVersus()
  });
  return { ui, els, controller, recorded, player: controller.engines[0], cpu: controller.engines[1] };
}

const key = (code, extra = {}) => ({ code, shiftKey: false, preventDefault() {}, ...extra });

test('the gameplay keys steer the player engine and never the CPU engine', () => {
  const { ui, player, cpu } = makeUi();
  ui.handleVersusGameplayKey(key('Space'));
  ui.handleVersusGameplayKey(key('KeyF'));
  ui.handleVersusGameplayKey(key('Enter'));
  ui.handleVersusGameplayKey(key('ArrowLeft'));
  ui.handleVersusGameplayKey(key('ArrowRight', { shiftKey: true }));
  assert.deepEqual(player.calls, [
    'swap',
    'flip',
    'shoot',
    ['aim', -gameConfig.canvas.keyboardAimFineStepRad],
    ['aim', gameConfig.canvas.keyboardAimStepRad]
  ]);
  assert.deepEqual(cpu.calls, []);
});

test('a special is equipped by its digit only when it is in stock or loaded', () => {
  const { ui, player } = makeUi();
  ui.handleVersusGameplayKey(key('Digit1'));
  assert.deepEqual(player.calls, [], 'no stock, no equip');
  const [firstType] = Object.keys(loadJson('./configs/balls.json').specialTypes);
  player.specialInventory[firstType] = 1;
  ui.handleVersusGameplayKey(key('Digit1'));
  assert.deepEqual(player.calls, [['equip', firstType]]);
});

test('the controls do nothing while the match is paused, between rounds or over', () => {
  const held = makeUi();
  held.controller.pause();
  held.ui.handleVersusGameplayKey(key('Enter'));
  held.ui.handleVersusGamepadActions([A.SHOOT], 0);
  assert.deepEqual(held.player.calls, []);
  for (const phase of ['roundOver', 'matchOver']) {
    const other = makeUi({ phase });
    other.ui.handleVersusGameplayKey(key('Enter'));
    assert.deepEqual(other.player.calls, [], phase);
  }
});

test('controller actions reach the player engine; Start and Select pause both boards', () => {
  const { ui, player, controller, els } = makeUi();
  ui.handleVersusGamepadActions([A.SHOOT, A.SWAP, A.POLARITY], 0.2);
  assert.deepEqual(player.calls, [['aim', 0.2], 'shoot', 'swap', 'flip']);
  ui.handleVersusGamepadActions([A.PAUSE], 0);
  assert.deepEqual(controller.log, ['pause']);
  assert.equal(els.modalDuelPause.classList.contains('hidden'), false, 'the pause dialog opens');
});

test('a resting stick does not steer the aim while the mouse or touch is in use', () => {
  const { ui, player } = makeUi();
  ui.inputMode = INPUT_MODES.POINTER;
  ui.handleVersusGamepadActions([], 0.2);
  assert.deepEqual(player.calls, []);
});

test('Escape unwinds the layers in order: result card, pause dialog, then it pauses the match', () => {
  const { ui, els, controller } = makeUi();
  assert.equal(ui.handleVersusBack(), true);
  assert.equal(els.modalDuelPause.classList.contains('hidden'), false, 'the first press pauses');
  assert.deepEqual(controller.log, ['pause']);
  assert.equal(ui.handleVersusBack(), true);
  assert.equal(els.modalDuelPause.classList.contains('hidden'), true, 'the second press resumes');
  assert.deepEqual(controller.log, ['pause', 'resume']);
});

test('Escape on the result card goes back, as the Back button does', () => {
  const { ui, els } = makeUi({ phase: 'matchOver' });
  let left = 0;
  ui.leaveVersus = () => {
    left += 1;
  };
  els.modalDuelResult.classList.remove('hidden');
  assert.equal(ui.handleVersusBack(), true);
  assert.equal(left, 1);
});

test('Escape closes the difficulty picker before anything under it', () => {
  const { ui, els } = makeUi();
  ui.versus = null;
  els.modalVersusTiers.classList.remove('hidden');
  assert.equal(ui.handleVersusBack(), true);
  assert.equal(els.modalVersusTiers.classList.contains('hidden'), true);
  assert.equal(ui.handleVersusBack(), false, 'with nothing of the duel open the press belongs to the rest of the UI');
});

test('the shared back action pauses a versus match instead of the held run', () => {
  const { ui, controller } = makeUi();
  ui.handleBackAction();
  assert.deepEqual(controller.log, ['pause']);
  assert.deepEqual(ui.pauseCalls, [], 'the run under the screen is left alone');
});

test('pausing is refused when the match is over or a dialog is already open', () => {
  const over = makeUi({ phase: 'matchOver' });
  over.ui.pauseVersus();
  assert.deepEqual(over.controller.log, []);
  const open = makeUi();
  open.els.modalDuelPause.classList.remove('hidden');
  open.ui.pauseVersus();
  assert.deepEqual(open.controller.log, []);
});

test('a round result shows its overlay until the next round starts', () => {
  const { ui, els } = makeUi();
  ui.handleVersusEvent({ type: MATCH_EVENTS.ROUND_WON });
  assert.equal(els.versusRoundOverlay.classList.contains('hidden'), false);
  assert.equal(els.versusRoundOverlay.textContent, 'Round won.');
  assert.equal(ui.versus.phase, 'roundOver');
  ui.handleVersusEvent({ type: MATCH_EVENTS.ROUND_REPLAY });
  assert.equal(els.versusRoundOverlay.textContent, 'Both boards fell. The round is replayed.');
  ui.handleVersusEvent({ type: MATCH_EVENTS.ROUND_START });
  assert.equal(els.versusRoundOverlay.classList.contains('hidden'), true);
  assert.equal(ui.versus.phase, 'playing');
});

test('a won match is recorded for its tier, counted in the statistics, and shown on the result card', () => {
  const { ui, els, recorded } = makeUi();
  ui.handleVersusEvent({ type: MATCH_EVENTS.MATCH_WON, wins: [2, 1] });
  assert.deepEqual(recorded.results, [['hard', true]]);
  assert.equal(recorded.stats.length, 1);
  assert.deepEqual(recorded.stats[0].modes[GAME_MODES.VERSUS], { runs: 1, wins: 1 });
  assert.equal(ui.versus.phase, 'matchOver');
  assert.equal(els.modalDuelResult.classList.contains('hidden'), false);
  assert.equal(els.versusResultTitle.textContent, 'Match won');
  assert.equal(els.versusResultScore.textContent, '2 - 1');
  assert.equal(els.versusResultNeutralised.textContent, 'Charges neutralised: 14');
  assert.equal(els.versusResultPulses.textContent, 'Pulses sent: 3');
  assert.equal(globalThis.document.activeElement, els.btnVersusRematch, 'focus lands on the main action');
});

test('a lost match is recorded as a loss', () => {
  const { ui, els, recorded } = makeUi();
  ui.handleVersusEvent({ type: MATCH_EVENTS.MATCH_LOST, wins: [0, 2] });
  assert.deepEqual(recorded.results, [['hard', false]]);
  assert.deepEqual(recorded.stats[0].modes[GAME_MODES.VERSUS], { runs: 1, losses: 1 });
  assert.equal(els.versusResultTitle.textContent, 'Match lost');
});

test('quitting counts as a quit and leaves the screen without recording a result', () => {
  const { ui, recorded } = makeUi();
  let left = 0;
  ui.leaveVersus = () => {
    left += 1;
  };
  ui.quitVersus();
  assert.deepEqual(recorded.results, []);
  assert.deepEqual(recorded.stats[0].modes[GAME_MODES.VERSUS], { runs: 1, quits: 1 });
  assert.equal(left, 1);
});

test('restarting from the pause dialog of a started match counts as a quit; a rematch after the result does not', () => {
  const started = makeUi();
  started.ui.restartVersus();
  assert.equal(started.recorded.stats.length, 1);
  assert.deepEqual(started.recorded.stats[0].modes[GAME_MODES.VERSUS], { runs: 1, quits: 1 });
  assert.deepEqual(started.controller.log.at(-1)[0], 'restart');

  const rematch = makeUi();
  rematch.ui.handleVersusEvent({ type: MATCH_EVENTS.MATCH_WON, wins: [2, 0] });
  const before = rematch.recorded.stats.length;
  rematch.ui.restartVersus();
  assert.equal(rematch.recorded.stats.length, before, 'the finished match was already counted');

  const fresh = makeUi();
  fresh.controller.getState = () => ({ frame: 0, boards: [{ stats: {} }, { stats: {} }] });
  fresh.ui.restartVersus();
  assert.equal(fresh.recorded.stats.length, 0, 'a match that never ran is not a quit');
});

test('the result card and the share text count the whole match, not the last round', () => {
  const { ui, els } = makeUi();
  ui.handleVersusEvent({ type: MATCH_EVENTS.MATCH_WON, wins: [2, 1] });
  assert.equal(ui.versus.result.neutralised, 14);
  assert.equal(ui.versus.result.pulses, 3);
  assert.equal(els.versusResultNeutralised.textContent, 'Charges neutralised: 14');
});

test('leaving the screen brings back the Victory or Game Over dialog of the held run', (t) => {
  const originalWindow = globalThis.window;
  globalThis.window = { removeEventListener() {} };
  t.after(() => {
    globalThis.window = originalWindow;
  });
  for (const [state, dialog] of [[GAME_STATES.VICTORY, 'modalVictory'], [GAME_STATES.GAME_OVER, 'modalGameOver']]) {
    const { ui, els } = makeUi();
    els.modalVictory = fakeElement();
    els.modalGameOver = fakeElement();
    els.btnVersusRematch = fakeElement();
    ui.engine.state = state;
    ui.engine.isVictoryCelebrating = () => false;
    ui.updateNextLevelButton = () => {};
    ui.focusInTopModal = () => {};
    ui.refresh = () => {};
    ui.lastExtra = {};
    ui.leaveVersus();
    assert.equal(els[dialog].classList.contains('hidden'), false, `${dialog} is shown again`);
    assert.equal(ui.versus, null);
  }
  const { ui, els } = makeUi();
  els.modalVictory = fakeElement();
  els.modalGameOver = fakeElement();
  ui.engine.state = GAME_STATES.PAUSED;
  ui.refresh = () => {};
  ui.leaveVersus();
  assert.equal(els.modalVictory.classList.contains('hidden') && els.modalGameOver.classList.contains('hidden'), true);
});

test('the duel screen is inert and hidden from assistive technology while its pause or result dialog is open', () => {
  globalThis.document = { activeElement: null, body: {} };
  const screen = Object.assign(fakeElement({ hidden: false }), { inert: false });
  const shell = Object.assign(fakeElement({ hidden: false }), { inert: false });
  let open = true;
  const fake = {
    elements: { versusScreen: screen, appShell: shell, versusCanvas0: fakeElement({ hidden: false }) },
    versus: {},
    isAnyModalOpen: () => open,
    getActiveTopModal: () => null,
    getModalsByPriority: () => [],
    keepFocusInTopModal() {},
    wasAnyModalOpen: true
  };
  UIManager.prototype.syncModalInertState.call(fake);
  assert.equal(screen.inert, true);
  assert.equal(screen.getAttribute('aria-hidden'), 'true');
  open = false;
  UIManager.prototype.syncModalInertState.call(fake);
  assert.equal(screen.inert, false);
  assert.equal(screen.getAttribute('aria-hidden'), null);
  assert.equal(shell.inert, true, 'the shell stays held while the duel screen is up');
});

test('the top bar moves into the boards grid for the landscape mini-view and back, keeping its focus', () => {
  const { ui } = makeUi();
  const makeNode = () => {
    const node = fakeElement({ hidden: false });
    node.parentElement = null;
    return node;
  };
  const screen = makeNode();
  const boards = makeNode();
  const bar = makeNode();
  bar.parentElement = screen;
  bar.contains = (node) => node === bar || node === pause;
  const pause = makeNode();
  boards.append = (node) => {
    node.parentElement = boards;
  };
  screen.insertBefore = (node) => {
    node.parentElement = screen;
  };
  Object.assign(ui.elements, { versusScreen: screen, versusBoards: boards, versusBar: bar });
  let refocused = 0;
  pause.focus = () => {
    refocused += 1;
  };
  globalThis.document.activeElement = pause;
  ui.placeVersusBar(true);
  assert.equal(bar.parentElement, boards);
  assert.equal(refocused, 1, 'the control that had focus gets it back');
  ui.placeVersusBar(true);
  assert.equal(refocused, 1, 'nothing moves when the bar is already there');
  ui.placeVersusBar(false);
  assert.equal(bar.parentElement, screen);
  assert.equal(refocused, 2);
  const css = readFileSync('./styles/main.css', 'utf8');
  assert.match(css, /\.versus-boards > \.versus-bar \{\s*grid-area: bar;/, 'the stylesheet lays the bar out in the side column');
});

test('a locked tier explains itself and starts nothing, an open one starts the match', () => {
  const started = [];
  const locked = makeUi({ storage: { isVersusTierUnlocked: (tier) => tier !== 'hard' } });
  locked.ui.enterVersus = (tier) => started.push(tier);
  locked.ui.pickVersusTier('hard');
  assert.deepEqual(started, []);
  assert.equal(locked.els.versusTierHint.classList.contains('hidden'), false);
  locked.ui.pickVersusTier('easy');
  assert.deepEqual(started, ['easy']);
});

test('the difficulty picker lists the configured tiers with their records, and says why a tier is locked', () => {
  const { ui, els } = makeUi({
    storage: {
      isVersusTierUnlocked: (tier) => tier !== 'hard',
      getVersusRecords: () => ({ easy: { w: 3, l: 1 }, normal: { w: 0, l: 0 }, hard: { w: 0, l: 0 } })
    }
  });
  ui.renderVersusTierPicker();
  const buttons = els.versusTierList.children;
  assert.deepEqual(buttons.map((button) => button.dataset.tier), ['easy', 'normal', 'hard']);
  assert.equal(buttons[0].children[1].textContent, '3 won, 1 lost');
  assert.equal(buttons[2].attrs['aria-disabled'], 'true');
  assert.equal(buttons[2].children[1].textContent, 'Beat Normal once to unlock Hard.');
  assert.equal(buttons[1].attrs['aria-disabled'], undefined);
});

// ---------------------------------------------------------------------------------------------
// Names, share text, statistics, page
// ---------------------------------------------------------------------------------------------

test('Polarity Duel has a mode name and an arcade card', () => {
  assert.equal(MODE_NAME_KEYS[GAME_MODES.VERSUS], 'versus.mode.name');
  assert.equal(ARCADE_CARD_SPECS[GAME_MODES.VERSUS].card, 'btnModeVersus');
  assert.match(indexHtml, /id="btn-mode-versus"/);
  assert.match(indexHtml, /id="arcade-best-versus"/);
});

test('every element the screen reads exists in the page', () => {
  const source = readFileSync('./src/ui/UIManager.js', 'utf8');
  const ids = [...source.matchAll(/getElementById\('((?:[\w]+-)*(?:versus|duel)[\w-]*)'\)/g)].map((match) => match[1]);
  assert.ok(ids.length > 20, 'the scan finds the versus elements');
  for (const id of ids) {
    assert.ok(indexHtml.includes(`id="${id}"`), `${id} is in index.html`);
  }
});

test('the share text of a match names the outcome, tier, score, charges and pulses, then the address', () => {
  const run = { mode: GAME_MODES.VERSUS, won: true, tier: 'Hard', score: '2 - 1', neutralised: 14, pulses: 3, url: 'https://example.test/' };
  const lines = buildShareText(run, gameConfig.share).split(/\r?\n/);
  assert.equal(lines[0], 'MagnaShot Polarity Duel: beat CPU Hard 2 - 1, 14 charges neutralized, 3 pulses');
  assert.equal(lines.at(-1), 'https://example.test/');
  const lost = buildShareText({ ...run, won: false }, gameConfig.share);
  assert.match(lost, /lost to CPU Hard/);
  i18n.currentLocale = 'fr';
  assert.match(buildShareText(run, gameConfig.share), /victoire contre l'ordinateur Hard/);
});

test('My stats lists a line per CPU tier that was played', () => {
  const translate = (key, params) => i18n.t(key, params);
  assert.deepEqual(formatVersusTierLines({ easy: { w: 2, l: 1 }, normal: { w: 0, l: 0 }, hard: { w: 0, l: 3 } }, translate, String), [
    'Easy: 2 won, 1 lost',
    'Hard: 0 won, 3 lost'
  ]);
  assert.deepEqual(formatVersusTierLines(undefined, translate, String), []);
  const overview = buildStatsOverview(
    { modes: { versus: { runs: 4, wins: 2, losses: 1, quits: 1 } } },
    { campaign: { level: 0, stars: 0 }, modes: {}, versus: { easy: { w: 2, l: 1 }, normal: { w: 0, l: 0 }, hard: { w: 0, l: 0 } } },
    { translate, format: String, modeOrder: ['versus'], locale: 'en' }
  );
  assert.equal(overview.modes.length, 1);
  assert.equal(overview.modes[0].name, 'Polarity Duel');
  assert.deepEqual(overview.modes[0].details, ['Easy: 2 won, 1 lost']);
});

test('the versus dialogs and screen carry their accessibility roles', () => {
  for (const id of ['modal-versus-tiers', 'modal-duel-pause', 'modal-duel-result']) {
    assert.match(indexHtml, new RegExp(`id="${id}"[^>]*role="dialog"[^>]*aria-modal="true"`), id);
  }
  assert.match(indexHtml, /id="versus-round-pips"[^>]*role="img"/);
  assert.match(indexHtml, /class="versus-pulse" role="meter"/);
});

// ---------------------------------------------------------------------------------------------
// Two players on one device
// ---------------------------------------------------------------------------------------------

const LOCAL_PAD_FIRST = { index: 3, id: 'pad first' };
const LOCAL_PAD_SECOND = { index: 5, id: 'pad second' };
const LOCAL_PAD_OUTSIDER = { index: 9, id: 'pad outsider' };
const LOCAL_AIM_STEP_MS = 100;
const LOCAL_FRAME_MS = 16;

/** The stub screen of makeUi turned into a local match: two keyboard halves unless slots are given. */
function makeLocalUi({ phase = 'playing', slots = null, storage = {} } = {}) {
  const made = makeUi({ phase, storage });
  const { ui, els, controller } = made;
  controller.advance = () => controller.log.push('advance');
  let list = createSlots();
  list = joinSlot(list, 0, { type: DEVICE_TYPES.KEYBOARD, side: 'left' });
  list = joinSlot(list, 1, { type: DEVICE_TYPES.KEYBOARD, side: 'right' });
  Object.assign(ui.versus, {
    kind: 'local',
    tier: null,
    slots: slots ?? list,
    riseMultipliers: [1, 1],
    kb: createSplitKeyboard(gameConfig.versus.local.keyboard),
    tooSmall: false,
    isTooSmallAnnounced: false,
    breakFrames: 0,
    resultGuardTimer: null
  });
  for (const name of ['versusPauseSizeHint', 'versusPausePadHint', 'versusResultNeutralisedB', 'versusResultPulsesB', 'btnVersusChangePlayers']) {
    els[name] = fakeElement();
  }
  els.btnVersusShare.classList.remove('hidden');
  els.btnVersusRematch.classList.remove('hidden');
  els.versusResultTier.classList.remove('hidden');
  ui.versus.sceneController = ui.createLocalSceneController();
  ui.setActiveScene('versus', ui.versus.sceneController);
  return made;
}

const press = (code, extra = {}) => ({ code, repeat: false, preventDefault() {}, ...extra });
const padPad = (pad, actions, aimDelta = 0) => ({ padIndex: pad.index, id: pad.id, actions, aimDelta, aimSteps: 0, active: true });

test('each half of the keyboard acts on its own board, and only the keys of the layout are kept from the page', () => {
  const { ui, controller } = makeLocalUi();
  const [first, second] = controller.engines;
  const prevented = [];
  const send = (code, extra = {}) => ui.handleLocalGameplayKey(press(code, { preventDefault: () => prevented.push(code), ...extra }));
  for (const code of ['KeyW', 'KeyS', 'KeyQ', 'Enter', 'ArrowDown', 'Slash']) {
    send(code);
  }
  assert.deepEqual(first.calls, ['shoot', 'swap', 'flip']);
  assert.deepEqual(second.calls, ['shoot', 'swap', 'flip']);
  assert.deepEqual(prevented, ['KeyW', 'KeyS', 'KeyQ', 'Enter', 'ArrowDown', 'Slash']);
  // Space, F and the digits do nothing in a two-player match, and the page keeps them.
  prevented.length = 0;
  for (const code of ['Space', 'KeyF', 'Digit1', 'Tab']) {
    send(code);
  }
  assert.deepEqual(prevented, []);
  assert.equal(first.calls.length, 3);
  assert.equal(second.calls.length, 3);
});

test('a held key shoots once per press, the number pad twins work, and a special is cycled with the special key', () => {
  const { ui, controller } = makeLocalUi();
  const [first, second] = controller.engines;
  ui.handleLocalGameplayKey(press('KeyW'));
  ui.handleLocalGameplayKey(press('KeyW', { repeat: true }));
  ui.handleLocalGameplayKey(press('KeyW'));
  assert.equal(first.calls.length, 1, 'a key already down is not a new press');
  ui.versus.kb.keyUp('KeyW');
  ui.handleLocalGameplayKey(press('KeyW'));
  assert.equal(first.calls.length, 2);
  ui.handleLocalGameplayKey(press('NumpadEnter'));
  assert.deepEqual(second.calls, ['shoot']);
  const [firstType] = Object.keys(loadJson('./configs/balls.json').specialTypes);
  second.specialInventory[firstType] = 2;
  ui.handleLocalGameplayKey(press('Period'));
  assert.deepEqual(second.calls.at(-1), ['equip', firstType]);
  assert.deepEqual(first.calls.filter((call) => Array.isArray(call)), [], 'the other player is left alone');
});

test('the keys do nothing while the match is paused, between rounds, over, or a dialog is open', () => {
  const held = makeLocalUi();
  held.controller.pause();
  held.ui.handleLocalGameplayKey(press('KeyW'));
  assert.deepEqual(held.player.calls, []);
  for (const phase of ['roundOver', 'matchOver']) {
    const other = makeLocalUi({ phase });
    other.ui.handleLocalGameplayKey(press('KeyW'));
    assert.deepEqual(other.player.calls, [], phase);
  }
  const dialog = makeLocalUi();
  dialog.els.modalDuelPause.classList.remove('hidden');
  dialog.ui.handleLocalGameplayKey(press('KeyW'));
  assert.deepEqual(dialog.player.calls, []);
});

test('the aim follows the keys held down, each side on its own board, with the fine key slowing it', () => {
  const { ui, controller } = makeLocalUi();
  const [first, second] = controller.engines;
  const { aimRadPerSec, fineFactor } = gameConfig.versus.local.keyboard;
  ui.handleLocalGameplayKey(press('KeyD'));
  ui.handleLocalGameplayKey(press('ArrowLeft'));
  ui.applyLocalHeldAim(LOCAL_AIM_STEP_MS);
  assert.deepEqual(first.calls, [['aim', aimRadPerSec * 0.1]]);
  assert.deepEqual(second.calls, [['aim', -aimRadPerSec * 0.1]]);
  ui.handleLocalGameplayKey(press('ShiftLeft'));
  ui.applyLocalHeldAim(LOCAL_AIM_STEP_MS);
  assert.deepEqual(first.calls.at(-1), ['aim', aimRadPerSec * fineFactor * 0.1]);
  assert.deepEqual(second.calls.at(-1), ['aim', -aimRadPerSec * 0.1], 'the fine key of the left half does not slow the right half');
  // A key released stops the aim; a window blur releases every key.
  ui.versus.sceneController.handleGameplayKeyUp({ code: 'KeyD' });
  ui.versus.sceneController.handleGameplayKeyUp({ code: 'ShiftLeft' });
  ui.applyLocalHeldAim(LOCAL_AIM_STEP_MS);
  const firstCalls = first.calls.length;
  const secondCalls = second.calls.length;
  assert.equal(firstCalls, 2, 'the released side no longer aims');
  assert.equal(secondCalls, 3, 'the side still held keeps aiming');
  ui.versus.sceneController.releaseAllKeys();
  ui.applyLocalHeldAim(LOCAL_AIM_STEP_MS);
  assert.equal(first.calls.length, firstCalls);
  assert.equal(second.calls.length, secondCalls, 'nothing is held after the release');
});

test('the held aim does not move a board that is paused or between rounds', () => {
  const held = makeLocalUi();
  held.ui.handleLocalGameplayKey(press('KeyD'));
  held.controller.pause();
  held.ui.applyLocalHeldAim(LOCAL_AIM_STEP_MS);
  assert.deepEqual(held.player.calls, []);
  const between = makeLocalUi({ phase: 'roundOver' });
  between.ui.handleLocalGameplayKey(press('KeyD'));
  between.ui.applyLocalHeldAim(LOCAL_AIM_STEP_MS);
  assert.deepEqual(between.player.calls, []);
});

test('the scene controller of a local match reads every pad on its own and exposes the hooks the page calls', () => {
  const { ui } = makeLocalUi();
  const scene = ui.versus.sceneController;
  assert.equal(scene.multiPad, true);
  for (const hook of ['handleGameplayKey', 'handleGameplayKeyUp', 'releaseAllKeys', 'handlePadResults', 'beforeFrame', 'pause']) {
    assert.equal(typeof scene[hook], 'function', hook);
  }
  assert.equal(ui.getSceneController(), scene);
  scene.beforeFrame(0, LOCAL_FRAME_MS);
});

test('each controller steers the board of its own place; a controller with no place does nothing', () => {
  let slots = createSlots();
  slots = assignPad(slots, LOCAL_PAD_FIRST.index, LOCAL_PAD_FIRST.id);
  slots = assignPad(slots, LOCAL_PAD_SECOND.index, LOCAL_PAD_SECOND.id);
  const { ui, controller } = makeLocalUi({ slots });
  const [first, second] = controller.engines;
  ui.handleLocalPadResults({
    pads: [
      padPad(LOCAL_PAD_SECOND, [A.SHOOT, A.POLARITY], 0.25),
      padPad(LOCAL_PAD_FIRST, [A.SWAP]),
      padPad(LOCAL_PAD_OUTSIDER, [A.SHOOT, A.SWAP], 0.5)
    ],
    events: []
  });
  assert.deepEqual(second.calls, [['aim', 0.25], 'shoot', 'flip']);
  assert.deepEqual(first.calls, ['swap']);
});

test('the aim of a pad needs no pointer mode: the stick steers its board even after the mouse was used', () => {
  let slots = createSlots();
  slots = assignPad(slots, LOCAL_PAD_FIRST.index, LOCAL_PAD_FIRST.id);
  slots = assignPad(slots, LOCAL_PAD_SECOND.index, LOCAL_PAD_SECOND.id);
  const { ui, controller } = makeLocalUi({ slots });
  ui.inputMode = INPUT_MODES.POINTER;
  ui.handleLocalPadResults({ pads: [padPad(LOCAL_PAD_FIRST, [], 0.1)], events: [] });
  assert.deepEqual(controller.engines[0].calls, [['aim', 0.1]]);
});

test('Start or Select on a controller of the match pauses both boards', () => {
  let slots = createSlots();
  slots = assignPad(slots, LOCAL_PAD_FIRST.index, LOCAL_PAD_FIRST.id);
  slots = assignPad(slots, LOCAL_PAD_SECOND.index, LOCAL_PAD_SECOND.id);
  const { ui, controller, els } = makeLocalUi({ slots });
  ui.handleLocalPadResults({ pads: [padPad(LOCAL_PAD_SECOND, [A.PAUSE])], events: [] });
  assert.deepEqual(controller.log, ['pause']);
  assert.equal(els.modalDuelPause.classList.contains('hidden'), false);
  const outsider = makeLocalUi({ slots });
  outsider.ui.handleLocalPadResults({ pads: [padPad(LOCAL_PAD_OUTSIDER, [A.PAUSE, A.MENU])], events: [] });
  assert.deepEqual(outsider.controller.log, [], 'a controller with no place cannot pause');
});

test('a controller that is lost pauses the match, keeps Resume out of reach, and says whose it was', () => {
  let slots = createSlots();
  slots = assignPad(slots, LOCAL_PAD_FIRST.index, LOCAL_PAD_FIRST.id);
  slots = assignPad(slots, LOCAL_PAD_SECOND.index, LOCAL_PAD_SECOND.id);
  const { ui, controller, els } = makeLocalUi({ slots });
  ui.handleLocalPadEvent({ type: GAMEPAD_EVENTS.DISCONNECTED, padIndex: LOCAL_PAD_SECOND.index, id: LOCAL_PAD_SECOND.id });
  assert.deepEqual(controller.log, ['pause']);
  assert.equal(ui.versus.slots[1].padLost, true);
  assert.equal(els.modalDuelPause.classList.contains('hidden'), false);
  assert.equal(els.btnVersusResume.getAttribute('aria-disabled'), 'true');
  assert.equal(els.versusPausePadHint.classList.contains('hidden'), false);
  assert.match(els.versusPausePadHint.textContent, /Player 2 controller disconnected/);
  assert.ok(ui.announcements.some((message) => /Player 2 controller disconnected/.test(message)));
  ui.resumeVersus();
  assert.deepEqual(controller.log, ['pause'], 'Resume does nothing while a controller is missing');
  // A controller that was never in the match going away changes nothing.
  ui.handleLocalPadEvent({ type: GAMEPAD_EVENTS.DISCONNECTED, padIndex: LOCAL_PAD_OUTSIDER.index, id: LOCAL_PAD_OUTSIDER.id });
  assert.equal(ui.versus.slots[0].padLost, false);
});

test('a controller that was not in the match takes over the lost place with its bottom button, then Resume opens', () => {
  let slots = createSlots();
  slots = assignPad(slots, LOCAL_PAD_FIRST.index, LOCAL_PAD_FIRST.id);
  slots = assignPad(slots, LOCAL_PAD_SECOND.index, LOCAL_PAD_SECOND.id);
  const { ui, controller, els } = makeLocalUi({ slots });
  assert.equal(ui.takeOverLostPad(LOCAL_PAD_OUTSIDER.index, LOCAL_PAD_OUTSIDER.id), false, 'nothing is lost yet');
  ui.handleLocalPadEvent({ type: GAMEPAD_EVENTS.DISCONNECTED, padIndex: LOCAL_PAD_FIRST.index, id: LOCAL_PAD_FIRST.id });
  assert.equal(ui.takeOverLostPad(LOCAL_PAD_OUTSIDER.index, LOCAL_PAD_OUTSIDER.id), true);
  assert.equal(ui.versus.slots[0].device.padIndex, LOCAL_PAD_OUTSIDER.index);
  assert.equal(ui.versus.slots[0].padLost, false);
  assert.equal(ui.versus.slots[1].device.padIndex, LOCAL_PAD_SECOND.index, 'the other player is untouched');
  assert.equal(els.btnVersusResume.getAttribute('aria-disabled'), 'false');
  assert.equal(els.versusPausePadHint.classList.contains('hidden'), true);
  ui.resumeVersus();
  assert.deepEqual(controller.log, ['pause', 'resume']);
});

test('with a dialog open, only the controllers of the match move around it; an outsider can take over a lost place', () => {
  let slots = createSlots();
  slots = assignPad(slots, LOCAL_PAD_FIRST.index, LOCAL_PAD_FIRST.id);
  slots = assignPad(slots, LOCAL_PAD_SECOND.index, LOCAL_PAD_SECOND.id);
  const { ui } = makeLocalUi({ slots });
  const routed = [];
  ui.routeGamepadMenuActions = (actions) => routed.push(actions);
  ui.handleLocalPadEvent({ type: GAMEPAD_EVENTS.DISCONNECTED, padIndex: LOCAL_PAD_SECOND.index, id: LOCAL_PAD_SECOND.id });
  ui.routeLocalMenuPads({
    pads: [padPad(LOCAL_PAD_FIRST, [A.NAV_DOWN]), padPad(LOCAL_PAD_OUTSIDER, [A.NAV_UP]), padPad(LOCAL_PAD_FIRST, [])],
    events: []
  });
  assert.deepEqual(routed, [[A.NAV_DOWN]]);
  assert.equal(ui.versus.slots[1].padLost, true, 'a stick does not take a place over');
  ui.routeLocalMenuPads({ pads: [padPad(LOCAL_PAD_OUTSIDER, [A.CONFIRM])], events: [] });
  assert.equal(ui.versus.slots[1].device.padIndex, LOCAL_PAD_OUTSIDER.index);
  assert.equal(ui.versus.slots[1].padLost, false);
});

test('a pad that comes back at the same place after a loss is trusted again', () => {
  let slots = createSlots();
  slots = assignPad(slots, LOCAL_PAD_FIRST.index, LOCAL_PAD_FIRST.id);
  slots = assignPad(slots, LOCAL_PAD_SECOND.index, LOCAL_PAD_SECOND.id);
  const { ui, els } = makeLocalUi({ slots });
  ui.handleLocalPadEvent({ type: GAMEPAD_EVENTS.DISCONNECTED, padIndex: LOCAL_PAD_FIRST.index, id: LOCAL_PAD_FIRST.id });
  ui.handleLocalPadEvent({ type: GAMEPAD_EVENTS.CONNECTED, padIndex: LOCAL_PAD_FIRST.index, id: LOCAL_PAD_FIRST.id });
  assert.equal(ui.versus.slots[0].padLost, false);
  assert.equal(els.btnVersusResume.getAttribute('aria-disabled'), 'false');
});

test('a window too small for two boards holds the match, says why, and lets Resume go once it fits again', () => {
  const { ui, controller, els } = makeLocalUi();
  ui.versus.tooSmall = true;
  ui.applyLocalSizeState(false);
  assert.equal(els.versusScreen.dataset.tooSmall, 'true');
  assert.deepEqual(controller.log, ['pause']);
  assert.equal(els.modalDuelPause.classList.contains('hidden'), false);
  assert.equal(els.versusPauseSizeHint.classList.contains('hidden'), false);
  assert.equal(els.versusPauseSizeHint.textContent, 'The window is too small for two boards. Make it larger to continue.');
  assert.equal(els.btnVersusResume.getAttribute('aria-disabled'), 'true');
  assert.equal(ui.announcements.filter((message) => /too small/.test(message)).length, 1);
  ui.applyLocalSizeState(true);
  assert.equal(ui.announcements.filter((message) => /too small/.test(message)).length, 1, 'it is said once');
  ui.resumeVersus();
  assert.deepEqual(controller.log, ['pause'], 'Resume does nothing while the boards do not fit');
  ui.versus.tooSmall = false;
  ui.applyLocalSizeState(true);
  assert.equal(els.versusScreen.dataset.tooSmall, 'false');
  assert.equal(els.versusPauseSizeHint.classList.contains('hidden'), true);
  assert.equal(els.btnVersusResume.getAttribute('aria-disabled'), 'false');
  assert.deepEqual(controller.log, ['pause'], 'the match stays paused until the player resumes');
  ui.resumeVersus();
  assert.deepEqual(controller.log, ['pause', 'resume']);
});

test('the match does not open a second pause dialog when it shrinks while already paused', () => {
  const { ui, controller, els } = makeLocalUi();
  ui.pauseVersus();
  ui.versus.tooSmall = true;
  ui.applyLocalSizeState(false);
  assert.deepEqual(controller.log, ['pause']);
  assert.equal(els.versusPauseSizeHint.classList.contains('hidden'), false);
  assert.equal(els.btnVersusResume.getAttribute('aria-disabled'), 'true');
});

test('a round won names the winner, and the next round starts by itself after the round break', () => {
  const { ui, els, controller } = makeLocalUi();
  ui.handleVersusEvent({ type: MATCH_EVENTS.ROUND_DECIDED, winner: 1, loser: 0, wins: [0, 1] });
  assert.equal(ui.versus.phase, 'roundOver');
  assert.equal(els.versusRoundOverlay.classList.contains('hidden'), false);
  assert.equal(els.versusRoundOverlay.textContent, 'Player 2 wins the round');
  const breakFrames = gameConfig.versus.roundBreakFrames;
  for (let frame = 1; frame < breakFrames; frame++) {
    ui.advanceLocalRound(ui.versus);
  }
  assert.deepEqual(controller.log, [], 'the break is not over yet');
  ui.advanceLocalRound(ui.versus);
  assert.deepEqual(controller.log, ['advance']);
  ui.handleVersusEvent({ type: MATCH_EVENTS.ROUND_START });
  assert.equal(ui.versus.phase, 'playing');
  assert.equal(ui.versus.breakFrames, 0);
  ui.advanceLocalRound(ui.versus);
  assert.deepEqual(controller.log, ['advance'], 'nothing advances while a round is being played');
  ui.handleVersusEvent({ type: MATCH_EVENTS.ROUND_REPLAY });
  assert.equal(els.versusRoundOverlay.textContent, 'Both boards fell. The round is replayed.');
});

test('a match without CPU never takes the round break of a match against the CPU into the controller', () => {
  const cpu = makeUi();
  cpu.controller.advance = () => cpu.controller.log.push('advance');
  cpu.ui.handleVersusEvent({ type: MATCH_EVENTS.ROUND_WON });
  for (let frame = 0; frame < gameConfig.versus.roundBreakFrames + 1; frame++) {
    cpu.ui.advanceLocalRound(cpu.ui.versus);
  }
  assert.deepEqual(cpu.controller.log, [], 'the CPU match advances inside the controller itself');
});

test('a finished match is counted once, names the winner, shows both players, and records nothing else', () => {
  let counted = 0;
  const { ui, els, recorded } = makeLocalUi({ storage: { recordVersusLocalMatch: () => (counted += 1) } });
  ui.handleVersusEvent({ type: MATCH_EVENTS.MATCH_DECIDED, winner: 0, wins: [2, 1] });
  assert.equal(ui.versus.phase, 'matchOver');
  assert.equal(counted, 1);
  assert.deepEqual(recorded.results, [], 'no record against a CPU tier');
  assert.deepEqual(recorded.stats, [], 'no personal statistics');
  assert.equal(els.modalDuelResult.classList.contains('hidden'), false);
  assert.equal(els.versusResultTitle.textContent, 'Player 1 wins');
  assert.equal(els.versusResultScore.textContent, 'Player 1 2 - 1 Player 2');
  assert.equal(els.versusResultNeutralised.textContent, 'Player 1: 14 charges neutralized');
  assert.equal(els.versusResultNeutralisedB.textContent, 'Player 2: 5 charges neutralized');
  assert.equal(els.versusResultPulses.textContent, 'Player 1: 3 pulses');
  assert.equal(els.versusResultPulsesB.textContent, 'Player 2: 1 pulses');
  assert.equal(els.versusResultTier.classList.contains('hidden'), true, 'no CPU tier line');
  assert.equal(els.btnVersusShare.classList.contains('hidden'), true, 'no Share button');
  assert.equal(els.btnVersusChangePlayers.classList.contains('hidden'), false);
  assert.equal(globalThis.document.activeElement, els.btnVersusRematch);
  clearTimeout(ui.versus.resultGuardTimer);
});

test('the main button of the result card ignores presses until the guard time is over', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ui, els } = makeLocalUi();
  ui.handleVersusEvent({ type: MATCH_EVENTS.MATCH_DECIDED, winner: 1, wins: [0, 2] });
  assert.equal(els.btnVersusRematch.getAttribute('aria-disabled'), 'true');
  t.mock.timers.tick(gameConfig.versus.local.resultInputGuardMs - 1);
  assert.equal(els.btnVersusRematch.getAttribute('aria-disabled'), 'true');
  t.mock.timers.tick(1);
  assert.equal(els.btnVersusRematch.getAttribute('aria-disabled'), null);
});

test('the result card of a CPU match is unchanged after a local one (tier line and Share come back)', () => {
  const { ui, els } = makeLocalUi();
  ui.fillVersusResult({ kind: 'local', winner: 1, wins: [0, 2], players: [{ neutralised: 0, pulses: 0 }, { neutralised: 1, pulses: 1 }] });
  assert.equal(els.versusResultTitle.textContent, 'Player 2 wins');
  ui.fillVersusResult({ won: true, tier: 'hard', wins: [2, 0], neutralised: 3, pulses: 1 });
  assert.equal(els.versusResultTitle.textContent, 'Match won');
  assert.equal(els.versusResultTier.classList.contains('hidden'), false);
  assert.equal(els.btnVersusShare.classList.contains('hidden'), false);
  assert.equal(els.btnVersusChangePlayers.classList.contains('hidden'), true);
  assert.equal(els.versusResultNeutralisedB.classList.contains('hidden'), true);
});

test('a match on one device cannot be shared', async () => {
  const { ui } = makeLocalUi();
  ui.versus.result = { kind: 'local', winner: 0, wins: [2, 0], players: [] };
  let delivered = 0;
  ui.deliverShareText = () => {
    delivered += 1;
  };
  await ui.shareVersusResult();
  assert.equal(delivered, 0);
});

test('restarting or quitting a match on one device records nothing and counts no quit', () => {
  const { ui, recorded, controller } = makeLocalUi();
  let left = 0;
  ui.leaveVersus = () => {
    left += 1;
  };
  ui.restartVersus();
  assert.deepEqual(recorded.stats, [], 'a restart is not a quit here');
  assert.deepEqual(controller.log.at(-1)[0], 'restart');
  assert.deepEqual(ui.versus.slots.map((slot) => slot.device.type), [DEVICE_TYPES.KEYBOARD, DEVICE_TYPES.KEYBOARD], 'a rematch keeps the devices');
  ui.quitVersus();
  assert.deepEqual(recorded.stats, []);
  assert.equal(left, 1);
});

test('a rematch while a controller is still missing waits in the pause dialog', () => {
  let slots = createSlots();
  slots = assignPad(slots, LOCAL_PAD_FIRST.index, LOCAL_PAD_FIRST.id);
  slots = assignPad(slots, LOCAL_PAD_SECOND.index, LOCAL_PAD_SECOND.id);
  const { ui, controller, els } = makeLocalUi({ slots });
  ui.versus.slots = markPadLost(ui.versus.slots, LOCAL_PAD_FIRST.index);
  ui.restartVersus();
  assert.deepEqual(controller.log.map((entry) => (Array.isArray(entry) ? entry[0] : entry)), ['restart', 'pause']);
  assert.equal(els.modalDuelPause.classList.contains('hidden'), false);
});

test('Change players leaves the screen and opens the lobby again with the same devices', () => {
  const { ui } = makeLocalUi();
  const steps = [];
  ui.leaveVersus = () => steps.push('leave');
  ui.openVersusTierPicker = () => steps.push('tiers');
  ui.openVersusLocalLobby = (options) => steps.push(['lobby', options]);
  ui.changeVersusPlayers();
  assert.deepEqual(steps, ['leave', 'tiers', ['lobby', { keep: true }]]);
  const cpu = makeUi();
  cpu.ui.leaveVersus = () => steps.push('cpu leave');
  cpu.ui.changeVersusPlayers();
  assert.equal(steps.includes('cpu leave'), false, 'a CPU match has no players to change');
});

test('opening a dialog or pausing lets go of every held key', () => {
  const { ui, controller } = makeLocalUi();
  ui.handleLocalGameplayKey(press('KeyD'));
  ui.pauseVersus();
  ui.hideVersusModal(ui.elements.modalDuelPause);
  controller.resume();
  ui.applyLocalHeldAim(LOCAL_AIM_STEP_MS);
  assert.deepEqual(controller.engines[0].calls, [], 'no key stayed held under the dialog');
});

test('the match announces round and match results with names, and nothing else', () => {
  const { ui } = makeLocalUi();
  ui.versus.queue = ui.createVersusQueue(ui.versus);
  ui.handleVersusEvent({ type: MATCH_EVENTS.CHARGE_INCOMING, count: 3, board: 0 });
  ui.handleVersusEvent({ type: MATCH_EVENTS.ROUND_DECIDED, winner: 0, loser: 1, wins: [1, 0] });
  ui.handleVersusEvent({ type: MATCH_EVENTS.PULSE_SENT, board: 1, target: 0 });
  ui.handleVersusEvent({ type: MATCH_EVENTS.MATCH_DECIDED, winner: 0, wins: [2, 1] });
  assert.deepEqual(ui.announcements, [
    'Player 1 wins the round',
    'Player 2 sent a field pulse',
    'Player 1 wins the match 2 to 1'
  ]);
  clearTimeout(ui.versus.resultGuardTimer);
});

test('the My stats overview lists the matches played between two players', () => {
  const translate = (keyName, params) => i18n.t(keyName, params);
  assert.deepEqual(formatVersusLocalLines(3, translate, String), ['2P matches: 3']);
  assert.deepEqual(formatVersusLocalLines(0, translate, String), []);
  assert.deepEqual(formatVersusLocalLines(undefined, translate, String), []);
  i18n.currentLocale = 'fr';
  assert.deepEqual(formatVersusLocalLines(2, translate, String), ['Matchs à 2 joueurs : 2']);
  i18n.currentLocale = 'en';
  const overview = buildStatsOverview(
    { modes: {} },
    { campaign: { level: 0, stars: 0 }, modes: {}, versus: {}, versusLocalMatches: 4 },
    { translate, format: String, modeOrder: ['versus'], locale: 'en' }
  );
  assert.deepEqual(overview.modes[0].details, ['2P matches: 4'], 'a player who only played locally still sees the line');
  const none = buildStatsOverview(
    { modes: {} },
    { campaign: { level: 0, stars: 0 }, modes: {}, versus: {}, versusLocalMatches: 0 },
    { translate, format: String, modeOrder: ['versus'], locale: 'en' }
  );
  assert.equal(none.modes.length, 0);
});
