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

import { GAME_STATES, INPUT_MODES, SPECIAL_TYPES_ORDER } from '../src/core/Constants.js';
import { GAMEPAD_ACTIONS as A, GAMEPAD_EVENTS } from '../src/core/GamepadInput.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { createGameLoop } from '../src/game/GameLoop.js';
import { UIManager } from '../src/ui/UIManager.js';
import { PAD_FOCUS_CLASS, pickSpatialTarget } from '../src/ui/UIGamepad.js';
import { GAMEPAD_HINT_KEYS } from '../src/ui/UIHelpers.js';

const gameConfig = applyWorldGeometry(JSON.parse(readFileSync('./configs/game.json', 'utf8')));

function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c)
  };
}

/** A focusable with a layout box at (x, y), recording clicks and focus. */
function makeItem(id, x, y, { log, tabs = null } = {}) {
  return {
    id,
    disabled: false,
    hidden: false,
    classList: makeClassList(),
    attrs: {},
    getAttribute(name) {
      return name === 'tabindex' ? null : (this.attrs[name] ?? null);
    },
    closest: (selector) => (tabs && selector === '[role="tablist"]' ? tabs : null),
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ left: x, top: y, width: 40, height: 20 }),
    click() {
      log.push(`click:${id}`);
    },
    focus() {
      globalThis.document.activeElement = this;
      log.push(`focus:${id}`);
    },
    scrollIntoView() {}
  };
}

function makeRoot(items, extra = {}) {
  return {
    classList: makeClassList(),
    contains: (el) => items.includes(el),
    querySelectorAll: (selector) => (selector === '[role="tablist"]' ? (extra.tabLists ?? []) : items)
  };
}

function makeEngine(overrides = {}) {
  const calls = [];
  return {
    state: GAME_STATES.PLAYING,
    aimAngle: -1,
    currentBall: { specialType: null },
    specialInventory: {},
    calls,
    adjustAimByDelta: (d) => calls.push(['aim', d]),
    shoot: () => calls.push(['shoot']),
    swapLauncherBalls: () => calls.push(['swap']),
    togglePolarityFlip: () => calls.push(['polarity']),
    equipSpecialBall: (type) => calls.push(['equip', type]),
    togglePause: () => calls.push(['pause']),
    replayLevelHints: () => calls.push(['hint']),
    isVictoryCelebrating: () => false,
    ...overrides
  };
}

/** A UIManager with just enough surface for the controller routing. */
function makeUi({ engine = makeEngine(), poll = () => ({ actions: [], aimDelta: 0, active: false, events: [] }) } = {}) {
  const log = [];
  const ui = Object.create(UIManager.prototype);
  ui.engine = engine;
  ui.gameConfig = gameConfig;
  ui.inputMode = INPUT_MODES.POINTER;
  ui.isDrawerOpen = false;
  ui.autoPausedByOverlay = false;
  ui.padFocusEl = null;
  ui.elements = {
    modalConfirm: null,
    modalPause: { classList: makeClassList(['hidden']) },
    modalShop: { classList: makeClassList(['hidden']) },
    modalLevels: { classList: makeClassList(['hidden']) },
    modalSettings: { classList: makeClassList(['hidden']) },
    modalStats: { classList: makeClassList(['hidden']) },
    drawer: null,
    toast: { textContent: '', classList: makeClassList(['hidden']) }
  };
  ui.gamepadInput = { poll: (elapsed, ctx) => poll(elapsed, ctx), settings: {} };
  ui.updateAimState = () => {};
  ui.announce = (message) => log.push(`announce:${message}`);
  ui.isDuelCardOpen = () => false;
  ui.setInputMode = (mode) => {
    ui.inputMode = mode;
    log.push(`mode:${mode}`);
  };
  ui.getActiveTopModal = () => ui.topModal || null;
  ui.isAnyModalOpen = () => Boolean(ui.topModal);
  ui.closeOverlayModal = (modal) => {
    modal.classList.add('hidden');
    ui.topModal = null;
    log.push('closeOverlay');
  };
  ui.closeDrawer = (opts) => log.push(`closeDrawer:${opts.resume}`);
  ui.openDrawer = () => log.push('openDrawer');
  return { ui, log, engine };
}

function withDocument(fn) {
  const previous = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    return fn(globalThis.document);
  } finally {
    globalThis.document = previous;
  }
}

test('gameplay actions go to the same engine entry points as the keyboard', () => {
  const { ui, engine } = makeUi({
    poll: () => ({
      actions: [A.SHOOT, A.SWAP, A.POLARITY, A.HINT, A.RECENTER],
      aimDelta: 0.05,
      active: true,
      events: []
    })
  });
  ui.pollGamepad(0, 16);
  assert.deepEqual(engine.calls, [
    ['aim', 0.05],
    ['shoot'],
    ['swap'],
    ['polarity'],
    ['hint'],
    ['aim', -Math.PI / 2 - engine.aimAngle]
  ]);
});

test('an idle frame with no aim change sends nothing to the engine', () => {
  const { ui, engine } = makeUi();
  ui.pollGamepad(0, 16);
  assert.deepEqual(engine.calls, []);
});

test('the unequip button puts a loaded special back; with nothing loaded it does nothing', () => {
  const { ui, engine } = makeUi({
    poll: () => ({ actions: [A.UNEQUIP], aimDelta: 0, active: true, events: [] })
  });
  ui.pollGamepad(0, 16);
  assert.deepEqual(engine.calls, []);
  engine.currentBall = { specialType: 'bomb' };
  ui.pollGamepad(0, 16);
  assert.deepEqual(engine.calls, [['equip', 'bomb']]);
});

test('bumpers cycle the stocked specials in catalog order, with "none" as a stop', () => {
  const [first, , third] = SPECIAL_TYPES_ORDER;
  const { ui, engine } = makeUi();
  engine.specialInventory = { [first]: 1, [third]: 2 };
  ui.cycleSpecialBall(1);
  assert.deepEqual(engine.calls.pop(), ['equip', first], 'none -> first stocked');
  engine.currentBall = { specialType: first };
  ui.cycleSpecialBall(1);
  assert.deepEqual(engine.calls.pop(), ['equip', third], 'skips unstocked specials');
  engine.currentBall = { specialType: third };
  ui.cycleSpecialBall(1);
  assert.deepEqual(engine.calls.pop(), ['equip', third], 'wrapping to none unequips the loaded special');
  ui.cycleSpecialBall(-1);
  assert.deepEqual(engine.calls.pop(), ['equip', first], 'previous goes back one stop');
});

test('cycling with no special in stock does nothing', () => {
  const { ui, engine } = makeUi();
  ui.cycleSpecialBall(1);
  ui.cycleSpecialBall(-1);
  assert.deepEqual(engine.calls, []);
});

test('pad activity switches to the gamepad input mode; a quiet frame does not', () => {
  let active = false;
  const { ui, log } = makeUi({ poll: () => ({ actions: [], aimDelta: 0, active, events: [] }) });
  ui.pollGamepad(0, 16);
  assert.deepEqual(log, []);
  active = true;
  ui.pollGamepad(0, 16);
  assert.deepEqual(log, [`mode:${INPUT_MODES.GAMEPAD}`]);
});

test('key hints read as the pointer wording while the controller is active', () => {
  const { ui } = makeUi();
  ui.inputMode = INPUT_MODES.GAMEPAD;
  assert.equal(ui.getHintInputMode(), INPUT_MODES.POINTER);
  ui.inputMode = INPUT_MODES.TOUCH;
  assert.equal(ui.getHintInputMode(), INPUT_MODES.TOUCH);
});

test('the run pauses when the pad disconnects mid-run, with a toast and a live region message', () => {
  const { ui, engine, log } = makeUi({
    poll: () => ({ actions: [], aimDelta: 0, active: false, events: [GAMEPAD_EVENTS.DISCONNECTED] })
  });
  ui.pollGamepad(0, 16);
  assert.deepEqual(engine.calls, [['pause']]);
  assert.equal(ui.elements.toast.classList.contains('hidden'), false);
  assert.ok(ui.elements.toast.textContent.length > 0);
  assert.ok(log.some((entry) => entry.startsWith('announce:')));
  clearTimeout(ui.toastTimer);
});

test('a connection is announced but never pauses the run, and a disconnect while paused does not resume it', () => {
  const connected = makeUi({
    poll: () => ({ actions: [], aimDelta: 0, active: false, events: [GAMEPAD_EVENTS.CONNECTED] })
  });
  connected.ui.pollGamepad(0, 16);
  assert.deepEqual(connected.engine.calls, []);
  assert.ok(connected.log.some((entry) => entry.startsWith('announce:')));
  clearTimeout(connected.ui.toastTimer);

  const paused = makeUi({
    engine: makeEngine({ state: GAME_STATES.PAUSED }),
    poll: () => ({ actions: [], aimDelta: 0, active: false, events: [GAMEPAD_EVENTS.DISCONNECTED] })
  });
  paused.ui.pollGamepad(0, 16);
  assert.deepEqual(paused.engine.calls, []);
  clearTimeout(paused.ui.toastTimer);
});

test('the reader is told when a menu is open, and menu actions never reach the engine aim or shot', () => {
  withDocument((doc) => {
    const contexts = [];
    const { ui, engine, log } = makeUi({
      poll: (elapsed, ctx) => {
        contexts.push(ctx.menuOpen);
        return { actions: [A.CONFIRM], aimDelta: 0.3, active: true, events: [] };
      }
    });
    const item = makeItem('ok', 10, 10, { log });
    ui.topModal = makeRoot([item]);
    doc.activeElement = item;
    ui.pollGamepad(0, 16);
    assert.deepEqual(contexts, [true]);
    assert.deepEqual(engine.calls, [], 'no aim, no shot while a dialog is open');
    assert.deepEqual(log.filter((e) => e.startsWith('click')), ['click:ok'], 'confirm clicks the focused control');
  });
});

test('spatial navigation picks the nearest control in the pressed direction', () => {
  const log = [];
  const items = [
    makeItem('a', 0, 0, { log }),
    makeItem('b', 200, 0, { log }),
    makeItem('c', 0, 100, { log }),
    makeItem('d', 0, 300, { log })
  ];
  assert.equal(pickSpatialTarget(items, 0, { x: 1, y: 0 }), 1);
  assert.equal(pickSpatialTarget(items, 0, { x: 0, y: 1 }), 2);
  assert.equal(pickSpatialTarget(items, 2, { x: 0, y: 1 }), 3);
  assert.equal(pickSpatialTarget(items, 0, { x: -1, y: 0 }), -1, 'nothing to the left');
  assert.equal(pickSpatialTarget(items, 0, { x: 0, y: -1 }), -1, 'nothing above');
});

test('menu navigation moves real focus, marks it with the pad ring and clears the old mark', () => {
  withDocument((doc) => {
    const { ui, log } = makeUi();
    const a = makeItem('a', 0, 0, { log });
    const b = makeItem('b', 0, 100, { log });
    ui.topModal = makeRoot([a, b]);
    doc.activeElement = a;
    ui.routeGamepadMenuActions([A.NAV_DOWN]);
    assert.equal(doc.activeElement, b);
    assert.equal(b.classList.contains(PAD_FOCUS_CLASS), true);
    ui.routeGamepadMenuActions([A.NAV_UP]);
    assert.equal(doc.activeElement, a);
    assert.equal(a.classList.contains(PAD_FOCUS_CLASS), true);
    assert.equal(b.classList.contains(PAD_FOCUS_CLASS), false);
    ui.clearPadFocus();
    assert.equal(a.classList.contains(PAD_FOCUS_CLASS), false);
  });
});

test('with nothing focused inside the dialog, the first direction press focuses its first control', () => {
  withDocument((doc) => {
    const { ui, log } = makeUi();
    const a = makeItem('a', 0, 0, { log });
    const b = makeItem('b', 0, 100, { log });
    ui.topModal = makeRoot([a, b]);
    doc.activeElement = { id: 'outside' };
    ui.routeGamepadMenuActions([A.NAV_DOWN]);
    assert.equal(doc.activeElement, a);
  });
});

test('without any layout box, navigation falls back to document order', () => {
  withDocument((doc) => {
    const { ui, log } = makeUi();
    const make = (id) => {
      const item = makeItem(id, 0, 0, { log });
      item.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
      return item;
    };
    const [a, b, c] = [make('a'), make('b'), make('c')];
    ui.topModal = makeRoot([a, b, c]);
    doc.activeElement = a;
    ui.routeGamepadMenuActions([A.NAV_DOWN]);
    assert.equal(doc.activeElement, b);
    ui.routeGamepadMenuActions([A.NAV_RIGHT, A.NAV_RIGHT]);
    assert.equal(doc.activeElement, c, 'the end of the list is a stop');
    ui.routeGamepadMenuActions([A.NAV_UP]);
    assert.equal(doc.activeElement, b);
  });
});

test('left and right step a focused select instead of moving focus', () => {
  withDocument((doc) => {
    const { ui, log } = makeUi();
    const events = [];
    const select = makeItem('sel', 0, 0, { log });
    select.tagName = 'SELECT';
    select.options = [{}, {}, {}];
    select.selectedIndex = 0;
    select.dispatchEvent = (e) => events.push(e.type);
    const other = makeItem('other', 100, 0, { log });
    ui.topModal = makeRoot([select, other]);
    doc.activeElement = select;
    ui.routeGamepadMenuActions([A.NAV_RIGHT]);
    assert.equal(select.selectedIndex, 1);
    assert.deepEqual(events, ['change']);
    assert.equal(doc.activeElement, select);
    ui.routeGamepadMenuActions([A.NAV_LEFT, A.NAV_LEFT]);
    assert.equal(select.selectedIndex, 0, 'clamped at the first option');
  });
});

test('the back button runs the same unwinding as Escape', () => {
  const { ui, log } = makeUi();
  ui.elements.modalShop.classList.remove('hidden');
  ui.topModal = ui.elements.modalShop;
  ui.getModalsByPriority = () => [ui.elements.modalShop];
  ui.routeGamepadMenuActions([A.BACK]);
  assert.deepEqual(log, ['closeOverlay']);
  assert.equal(ui.elements.modalShop.classList.contains('hidden'), true);
});

test('the back button closes the menu drawer when nothing is stacked above it', () => {
  const { ui, log } = makeUi();
  ui.isDrawerOpen = true;
  ui.routeGamepadMenuActions([A.BACK]);
  assert.deepEqual(log, ['closeDrawer:true']);
});

test('bumpers switch to the previous or next tab of the nearest tab list and wrap around', () => {
  withDocument((doc) => {
    const { ui, log } = makeUi();
    const tabs = ['t0', 't1', 't2'].map((id, i) => {
      const tab = makeItem(id, i * 50, 0, { log });
      tab.attrs['aria-selected'] = i === 0 ? 'true' : 'false';
      return tab;
    });
    const list = {
      getClientRects: () => [{}],
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 150, height: 20 }),
      querySelectorAll: () => tabs
    };
    tabs.forEach((tab) => {
      tab.closest = () => list;
    });
    ui.topModal = makeRoot(tabs, { tabLists: [list] });
    doc.activeElement = tabs[0];
    ui.routeGamepadMenuActions([A.TAB_NEXT]);
    assert.deepEqual(log.filter((e) => e.startsWith('click')), ['click:t1']);
    tabs[0].attrs['aria-selected'] = 'false';
    tabs[1].attrs['aria-selected'] = 'true';
    log.length = 0;
    ui.routeGamepadMenuActions([A.TAB_PREV]);
    assert.deepEqual(log.filter((e) => e.startsWith('click')), ['click:t0']);
    tabs[1].attrs['aria-selected'] = 'false';
    tabs[0].attrs['aria-selected'] = 'true';
    log.length = 0;
    ui.routeGamepadMenuActions([A.TAB_PREV]);
    assert.deepEqual(log.filter((e) => e.startsWith('click')), ['click:t2'], 'wraps to the last tab');
  });
});

test('a dialog without tabs ignores the bumpers', () => {
  withDocument((doc) => {
    const { ui, log } = makeUi();
    const a = makeItem('a', 0, 0, { log });
    ui.topModal = makeRoot([a]);
    doc.activeElement = a;
    ui.routeGamepadMenuActions([A.TAB_NEXT, A.TAB_PREV]);
    assert.deepEqual(log, []);
  });
});

test('Start resumes from the Pause dialog, is ignored over other dialogs, and Select closes the menu', () => {
  const pauseUi = makeUi({ engine: makeEngine({ state: GAME_STATES.PAUSED }) });
  pauseUi.ui.topModal = pauseUi.ui.elements.modalPause;
  pauseUi.ui.routeGamepadMenuActions([A.PAUSE]);
  assert.deepEqual(pauseUi.engine.calls, [['pause']]);

  const shopUi = makeUi({ engine: makeEngine({ state: GAME_STATES.PAUSED }) });
  shopUi.ui.topModal = shopUi.ui.elements.modalShop;
  shopUi.ui.routeGamepadMenuActions([A.PAUSE]);
  assert.deepEqual(shopUi.engine.calls, [], 'a Shop or Settings dialog is closed with the back button');

  const drawerUi = makeUi();
  drawerUi.ui.isDrawerOpen = true;
  drawerUi.ui.routeGamepadMenuActions([A.MENU]);
  assert.deepEqual(drawerUi.log, ['closeDrawer:true']);
});

test('Start pauses a running game and Select opens the menu', () => {
  const { ui, engine, log } = makeUi({
    poll: () => ({ actions: [A.PAUSE, A.MENU], aimDelta: 0, active: true, events: [] })
  });
  ui.pollGamepad(0, 16);
  assert.deepEqual(engine.calls, [['pause']]);
  assert.ok(log.includes('openDrawer'));
});

test('updateGamepadSettings changes the live reader settings in place', () => {
  const { ui } = makeUi();
  ui.updateGamepadSettings({ deadzone: 0.25, invertX: true });
  assert.equal(ui.gamepadInput.settings.deadzone, 0.25);
  assert.equal(ui.gamepadInput.settings.invertX, true);
  const bare = Object.create(UIManager.prototype);
  bare.gamepadInput = null;
  assert.doesNotThrow(() => bare.updateGamepadSettings({ enabled: false }));
  assert.doesNotThrow(() => bare.pollGamepad(0, 16));
});

test('leaving the gamepad mode drops the pad focus ring', () => {
  const { ui, log } = makeUi();
  const item = makeItem('a', 0, 0, { log });
  withDocument(() => {
    ui.focusFromPad(item);
  });
  assert.equal(item.classList.contains(PAD_FOCUS_CLASS), true);
  ui.inputMode = INPUT_MODES.POINTER;
  ui.updateInputHints = () => {};
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { dataset: {} } };
  try {
    ui.applyInputMode();
  } finally {
    globalThis.document = previousDocument;
  }
  assert.equal(item.classList.contains(PAD_FOCUS_CLASS), false);
});

test('the game loop calls beforeFrame on every frame, also when the game is idle', () => {
  const seen = [];
  const engine = {
    state: GAME_STATES.PAUSED,
    hitStopFrames: 0,
    update() {},
    isVictoryCelebrating: () => false
  };
  const loop = createGameLoop({
    engine,
    renderer: { render() {} },
    fixedStepMs: 16,
    maxAccumulatedMs: 100,
    idleRenderIntervalMs: 1000,
    scheduleFrame() {},
    onFatalError(err) {
      throw err;
    },
    beforeFrame: (now, elapsed) => seen.push([now, elapsed])
  });
  loop.frame(100);
  loop.frame(130);
  loop.frame(1000);
  assert.deepEqual(seen, [[100, 0], [130, 30], [1000, 100]], 'elapsed is clamped like the simulation step');
});

test('the game loop works without a beforeFrame hook', () => {
  const engine = { state: GAME_STATES.PAUSED, hitStopFrames: 0, update() {}, isVictoryCelebrating: () => false };
  const loop = createGameLoop({
    engine,
    renderer: { render() {} },
    fixedStepMs: 16,
    maxAccumulatedMs: 100,
    idleRenderIntervalMs: 1000,
    scheduleFrame() {},
    onFatalError(err) {
      throw err;
    }
  });
  assert.doesNotThrow(() => loop.frame(10));
});

test('a stick drifting under the activity threshold does not aim while the pointer is in use', () => {
  const { ui, engine } = makeUi({ poll: () => ({ actions: [], aimDelta: 0.02, active: false, events: [] }) });
  ui.pollGamepad(0, 16);
  assert.deepEqual(engine.calls, []);
  ui.inputMode = INPUT_MODES.TOUCH;
  ui.pollGamepad(0, 16);
  assert.deepEqual(engine.calls, []);
  ui.inputMode = INPUT_MODES.GAMEPAD;
  ui.pollGamepad(0, 16);
  assert.deepEqual(engine.calls, [['aim', 0.02]], 'after a real activation the stick aims');
});

test('a disconnect of a pad that is not in use is announced without pausing the run', () => {
  const { ui, engine, log } = makeUi({
    poll: () => ({ actions: [], aimDelta: 0, active: false, events: [GAMEPAD_EVENTS.DISCONNECTED_OTHER] })
  });
  ui.pollGamepad(0, 16);
  assert.deepEqual(engine.calls, []);
  assert.ok(log.some((entry) => entry.startsWith('announce:')));
  clearTimeout(ui.toastTimer);
});

test('a quiet frame returns before any routing', () => {
  const { ui, engine } = makeUi({ poll: () => ({ actions: [], aimDelta: 0, aimSteps: 0, active: false, events: [] }) });
  let routed = 0;
  ui.routeGamepadGameplay = () => { routed += 1; };
  ui.routeGamepadMenuActions = () => { routed += 1; };
  ui.handleGamepadEvent = () => { routed += 1; };
  ui.pollGamepad(0, 16);
  assert.equal(routed, 0);
  assert.deepEqual(engine.calls, []);
});

test('the controller wording is used for the hints that have one, the pointer wording for the rest', () => {
  const { ui } = makeUi();
  ui.inputMode = INPUT_MODES.GAMEPAD;
  for (const key of GAMEPAD_HINT_KEYS) {
    assert.equal(ui.getHintInputMode(key), INPUT_MODES.GAMEPAD, key);
  }
  assert.equal(ui.getHintInputMode('modals.pause.instructions.aim'), INPUT_MODES.POINTER);
  ui.inputMode = INPUT_MODES.POINTER;
  assert.equal(ui.getHintInputMode(GAMEPAD_HINT_KEYS[0]), INPUT_MODES.POINTER);
});

/** Walks a locale tree and returns [path, text] for every string leaf. */
function localeLeaves(node, path = []) {
  if (typeof node === 'string') {
    return [[path.join('.'), node]];
  }
  return Object.entries(node).flatMap(([key, child]) => localeLeaves(child, [...path, key]));
}

for (const lang of ['en', 'fr']) {
  const locale = JSON.parse(readFileSync(`./locales/${lang}.json`, 'utf8'));
  const leaves = new Map(localeLeaves(locale));

  test(`${lang}: every hint with a controller wording has it`, () => {
    for (const key of GAMEPAD_HINT_KEYS) {
      assert.ok(leaves.get(`${key}.gamepad`), `${key}.gamepad`);
      assert.ok(leaves.get(`${key}.pointer`), `${key}.pointer`);
    }
  });

  test(`${lang}: controller strings name buttons by position, never by a console brand letter`, () => {
    const padLeaves = [...leaves].filter(([path]) => /pad|controller/i.test(path));
    assert.ok(padLeaves.length > 10, 'the controller strings were found');
    const brandToken = /(?<![\p{L}\p{N}])(A|B|X|Y|LB|RB|LT|RT)(?![\p{L}\p{N}])/u;
    for (const [path, text] of padLeaves) {
      assert.doesNotMatch(text, brandToken, path);
    }
  });
}

test('the pad ring leaves with the focus: focusout and a closed dialog both clear it', () => {
  const { ui, log } = makeUi();
  const item = makeItem('a', 0, 0, { log });
  const other = makeItem('b', 100, 0, { log });
  withDocument((doc) => {
    ui.focusFromPad(item);
    ui.handlePadFocusOut({ target: other });
    assert.equal(item.classList.contains(PAD_FOCUS_CLASS), true, 'another element losing focus changes nothing');
    ui.handlePadFocusOut({ target: item });
    assert.equal(item.classList.contains(PAD_FOCUS_CLASS), false);
    assert.equal(ui.padFocusEl, null);

    ui.focusFromPad(item);
    ui.pollGamepad(0, 16);
    assert.equal(item.classList.contains(PAD_FOCUS_CLASS), true, 'still focused: kept');
    doc.activeElement = null; // the dialog closed and the focus went away
    ui.pollGamepad(0, 16);
    assert.equal(item.classList.contains(PAD_FOCUS_CLASS), false);
  });
});

test('a failing frame hook is reported and the loop keeps running', () => {
  const errors = [];
  let rendered = 0;
  let scheduled = 0;
  const engine = { state: GAME_STATES.PAUSED, hitStopFrames: 0, update() {}, isVictoryCelebrating: () => false };
  const loop = createGameLoop({
    engine,
    renderer: { render() { rendered += 1; } },
    fixedStepMs: 16,
    maxAccumulatedMs: 100,
    idleRenderIntervalMs: 1000,
    scheduleFrame() { scheduled += 1; },
    onFatalError(err) {
      throw err;
    },
    beforeFrame() {
      throw new Error('pad routing failed');
    },
    onHookError: (err) => errors.push(err.message)
  });
  loop.frame(10);
  loop.frame(40);
  assert.deepEqual(errors, ['pad routing failed', 'pad routing failed']);
  assert.equal(loop.isStopped(), false);
  assert.equal(scheduled, 2);
  assert.ok(rendered >= 1);
});

/** A 2-column grid where nearest-up from the wide bottom control is the right-hand cell. */
function makeGridItems(log) {
  return [
    makeItem('top-left', 0, 0, { log }),
    makeItem('top-right', 100, 0, { log }),
    makeItem('bottom', 60, 100, { log })
  ];
}

test('moving the opposite way returns to the control the last move came from', () => {
  withDocument((doc) => {
    const { ui, log } = makeUi();
    const items = makeGridItems(log);
    const [topLeft, , bottom] = items;
    ui.topModal = makeRoot(items);
    doc.activeElement = topLeft;
    assert.equal(pickSpatialTarget(items, 2, { x: 0, y: -1 }), 1, 'scoring alone picks the right cell');
    ui.routeGamepadMenuActions([A.NAV_DOWN]);
    assert.equal(doc.activeElement, bottom);
    ui.routeGamepadMenuActions([A.NAV_UP]);
    assert.equal(doc.activeElement, topLeft, 'the origin wins over the nearest-up cell');
  });
});

test('a move that is not the exact opposite keeps the nearest-in-direction scoring', () => {
  withDocument((doc) => {
    const { ui, log } = makeUi();
    const [topLeft, topRight, bottom] = makeGridItems(log);
    const bottomRight = makeItem('bottom-right', 200, 100, { log });
    ui.topModal = makeRoot([topLeft, topRight, bottom, bottomRight]);
    doc.activeElement = topLeft;
    ui.routeGamepadMenuActions([A.NAV_DOWN]);
    ui.routeGamepadMenuActions([A.NAV_RIGHT]);
    assert.equal(doc.activeElement, bottomRight);
    ui.routeGamepadMenuActions([A.NAV_UP]);
    assert.equal(doc.activeElement, topRight, 'up after a sideways move uses the scoring');
  });
});

test('the opposite move falls back to scoring when the origin is no longer focusable', () => {
  withDocument((doc) => {
    const { ui, log } = makeUi();
    const [topLeft, topRight, bottom] = makeGridItems(log);
    const root = makeRoot([topLeft, topRight, bottom]);
    ui.topModal = root;
    doc.activeElement = topLeft;
    ui.routeGamepadMenuActions([A.NAV_DOWN]);
    assert.equal(doc.activeElement, bottom);
    topLeft.hidden = true;
    root.querySelectorAll = () => [topRight, bottom];
    ui.routeGamepadMenuActions([A.NAV_UP]);
    assert.equal(doc.activeElement, topRight);
  });
});

test('equal scores resolve by distance along the direction, then sideways offset, then document order', () => {
  const log = [];
  const from = makeItem('from', 100, 100, { log });
  const left = makeItem('left', 60, 0, { log });
  const right = makeItem('right', 140, 0, { log });
  const same = makeItem('same', 100, 0, { log });
  assert.equal(pickSpatialTarget([from, left, right], 0, { x: 0, y: -1 }), 1, 'a full tie keeps document order');
  assert.equal(pickSpatialTarget([from, right, left], 0, { x: 0, y: -1 }), 1);
  assert.equal(pickSpatialTarget([from, left, same, right], 0, { x: 0, y: -1 }), 2, 'the aligned control wins');
});
