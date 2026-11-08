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
import { GAMEPAD_ACTIONS as A } from '../src/core/GamepadInput.js';
import { i18n } from '../src/core/I18n.js';
import { buildShareText } from '../src/game/DailyShare.js';
import { createGameLoop } from '../src/game/GameLoop.js';
import { MATCH_EVENTS } from '../src/game/VersusMatch.js';
import { UIManager } from '../src/ui/UIManager.js';
import { MODE_NAME_KEYS, ARCADE_CARD_SPECS } from '../src/ui/UIHelpers.js';
import { buildStatsOverview, formatVersusTierLines } from '../src/ui/UIStats.js';

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

function runLoop(scene) {
  const frames = [];
  const loop = createGameLoop({
    getScene: () => scene,
    fixedStepMs: FIXED_STEP_MS,
    maxAccumulatedMs: FIXED_STEP_MS * FRAMES,
    idleRenderIntervalMs: FIXED_STEP_MS,
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
      boards: [
        { index: 0, stats: { neutralised: 14, pulsesSent: 3 } },
        { index: 1, stats: { neutralised: 5, pulsesSent: 1 } }
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
