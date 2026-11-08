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

/*
 * The two-player lobby of Polarity Duel (src/ui/UIVersusLocal.js), over stub elements: the entry
 * of the tier picker, the quick join keys, the controllers, Change device, Leave, the handicap
 * and Start. The match itself is covered by uiVersus.test.js.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GAMEPAD_ACTIONS as A } from '../src/core/GamepadInput.js';
import { i18n } from '../src/core/I18n.js';
import { DEVICE_TYPES } from '../src/ui/LocalInput.js';
import { UIManager } from '../src/ui/UIManager.js';
import {
  areLocalSlotsReady,
  describeLocalDevice,
  localDeviceKey,
  selectableLocalDevices
} from '../src/ui/UIVersusLocal.js';

const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
const indexHtml = readFileSync('./index.html', 'utf8');
for (const locale of ['en', 'fr']) {
  i18n.dictionaries.set(locale, loadJson(`./locales/${locale}.json`));
}

const WIDE_VIEWPORT = { innerWidth: 1300, innerHeight: 850 };
const NARROW_VIEWPORT = { innerWidth: 600, innerHeight: 850 };
const SHORT_VIEWPORT = { innerWidth: 1300, innerHeight: 400 };
const PAD_A = { index: 4, id: 'pad a' };
const PAD_B = { index: 6, id: 'pad b' };

let originalDocument;
let originalWindow;
beforeEach(() => {
  originalDocument = globalThis.document;
  originalWindow = globalThis.window;
  i18n.currentLocale = 'en';
});
afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  i18n.currentLocale = 'en';
});

/** A minimal element: text, classes, attributes, children, listeners. */
function fakeNode({ hidden = false } = {}) {
  const classes = new Set(hidden ? ['hidden'] : []);
  return {
    textContent: '',
    value: '',
    dataset: {},
    attrs: {},
    children: [],
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
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    addEventListener() {},
    focus() {
      globalThis.document.activeElement = this;
    }
  };
}

function makeSlotElement(index) {
  const parts = {};
  for (const selector of [
    '.versus-local-slot-name',
    '.versus-badge',
    '.versus-local-status',
    '.versus-local-join-hint',
    '.versus-local-change',
    '.versus-local-leave',
    '.versus-local-handicap-text',
    '.versus-local-handicap'
  ]) {
    parts[selector] = fakeNode();
  }
  const element = fakeNode();
  element.dataset.slot = String(index);
  element.parts = parts;
  element.querySelector = (selector) => parts[selector] ?? null;
  return element;
}

function makeLobbyUi({ viewport = WIDE_VIEWPORT } = {}) {
  globalThis.document = { activeElement: null, createElement: () => fakeNode() };
  globalThis.window = { ...viewport, addEventListener() {} };
  const slotElements = [makeSlotElement(0), makeSlotElement(1)];
  const modal = fakeNode({ hidden: true });
  modal.querySelectorAll = () => slotElements;
  const els = {
    modalVersusLocal: modal,
    btnVersusLocal: fakeNode({ hidden: true }),
    btnVersusLocalStart: fakeNode(),
    btnVersusLocalBack: fakeNode(),
    versusLocalNeedTwo: fakeNode(),
    versusLocalLive: fakeNode()
  };
  const ui = Object.create(UIManager.prototype);
  ui.gameConfig = gameConfig;
  ui.elements = els;
  ui.versusLocal = ui.createVersusLocalState();
  const started = [];
  const menuActions = [];
  ui.enterVersus = (spec) => started.push(spec);
  ui.routeGamepadMenuActions = (actions) => menuActions.push(actions);
  ui.openOverlayModal = (target, focusTarget) => {
    target.classList.remove('hidden');
    focusTarget?.focus();
  };
  ui.closeOverlayModal = (target) => target.classList.add('hidden');
  ui.isVersusTierPickerOpen = () => true;
  return { ui, els, slotElements, started, menuActions };
}

const statusOf = (slotElements, index) => slotElements[index].parts['.versus-local-status'].textContent;
const key = (code, extra = {}) => ({ code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, ...extra });

test('devices have a name, and a slot list is ready only when both players hold a device', () => {
  assert.equal(localDeviceKey({ type: DEVICE_TYPES.KEYBOARD, side: 'left' }), 'keyboardLeft');
  assert.equal(localDeviceKey({ type: DEVICE_TYPES.KEYBOARD, side: 'right' }), 'keyboardRight');
  assert.equal(localDeviceKey({ type: DEVICE_TYPES.KEYBOARD_MOUSE, side: 'left' }), 'keyboardMouse');
  assert.equal(localDeviceKey({ type: DEVICE_TYPES.TOUCH }), 'touch');
  assert.equal(localDeviceKey({ type: DEVICE_TYPES.PAD, padIndex: 0 }), 'pad');
  assert.equal(localDeviceKey(null), null);
  assert.equal(describeLocalDevice({ type: DEVICE_TYPES.TOUCH }), 'Touch');
  assert.equal(describeLocalDevice(null), '');
  i18n.currentLocale = 'fr';
  assert.equal(describeLocalDevice({ type: DEVICE_TYPES.KEYBOARD_MOUSE, side: 'left' }), 'Touches de gauche et souris');
  assert.equal(areLocalSlotsReady([{ device: {} }, { device: null }]), false);
  assert.equal(areLocalSlotsReady([{ device: {} }, { device: {} }]), true);
});

test('player 1 chooses among the left keys, left keys with the mouse and touch; player 2 between the right keys and touch', () => {
  assert.deepEqual(selectableLocalDevices(0).map((device) => device.type), [DEVICE_TYPES.KEYBOARD, DEVICE_TYPES.KEYBOARD_MOUSE, DEVICE_TYPES.TOUCH]);
  assert.deepEqual(selectableLocalDevices(1).map((device) => device.type), [DEVICE_TYPES.KEYBOARD, DEVICE_TYPES.TOUCH]);
  assert.equal(selectableLocalDevices(0)[0].side, 'left');
  assert.equal(selectableLocalDevices(1)[0].side, 'right');
});

test('the entry of the tier picker is hidden, not disabled, when two boards do not fit, and follows the window', () => {
  const wide = makeLobbyUi();
  wide.ui.syncVersusLocalEntry();
  assert.equal(wide.els.btnVersusLocal.classList.contains('hidden'), false, 'a wide window offers the entry');
  globalThis.window.innerWidth = NARROW_VIEWPORT.innerWidth;
  wide.ui.syncVersusLocalEntry();
  assert.equal(wide.els.btnVersusLocal.classList.contains('hidden'), true, 'a narrow window hides it');
  assert.equal(wide.els.btnVersusLocal.getAttribute('aria-disabled'), null, 'it is hidden, not disabled');
  Object.assign(globalThis.window, SHORT_VIEWPORT);
  wide.ui.syncVersusLocalEntry();
  assert.equal(wide.els.btnVersusLocal.classList.contains('hidden'), true, 'a short window hides it too');
  const narrow = makeLobbyUi({ viewport: NARROW_VIEWPORT });
  narrow.ui.syncVersusLocalEntry();
  assert.equal(narrow.els.btnVersusLocal.classList.contains('hidden'), true);
});

test('a lobby left open while the window shrinks closes with its entry', () => {
  const { ui, els } = makeLobbyUi();
  ui.openVersusLocalLobby();
  assert.equal(ui.isVersusLocalLobbyOpen(), true);
  globalThis.window.innerWidth = NARROW_VIEWPORT.innerWidth;
  ui.syncVersusLocalEntry();
  assert.equal(ui.isVersusLocalLobbyOpen(), false);
  assert.equal(els.btnVersusLocal.classList.contains('hidden'), true);
});

test('the lobby opens on the first Change button with both places empty and Start out of reach', () => {
  const { ui, els, slotElements } = makeLobbyUi();
  ui.openVersusLocalLobby();
  assert.equal(ui.isVersusLocalLobbyOpen(), true);
  assert.equal(globalThis.document.activeElement, slotElements[0].parts['.versus-local-change']);
  assert.equal(statusOf(slotElements, 0), 'Press to join');
  assert.equal(statusOf(slotElements, 1), 'Press to join');
  assert.equal(slotElements[0].parts['.versus-badge'].textContent, '1');
  assert.equal(slotElements[1].parts['.versus-badge'].textContent, '2');
  assert.equal(els.btnVersusLocalStart.getAttribute('aria-disabled'), 'true');
  assert.equal(els.versusLocalNeedTwo.classList.contains('hidden'), false);
  assert.equal(slotElements[0].dataset.joined, 'false');
  assert.match(slotElements[0].parts['.versus-local-join-hint'].textContent, /Keyboard: press W to join/);
  assert.match(slotElements[1].parts['.versus-local-join-hint'].textContent, /Keyboard: press Up to join/);
  assert.equal(slotElements[0].parts['.versus-local-handicap'].children.length, gameConfig.versus.local.handicap.riseMultipliers.length);
});

test('the lobby does not open when the window cannot host two boards', () => {
  const { ui } = makeLobbyUi({ viewport: NARROW_VIEWPORT });
  ui.openVersusLocalLobby();
  assert.equal(ui.isVersusLocalLobbyOpen(), false);
});

test('W joins player 1 on the left keys and ArrowUp joins player 2 on the right keys; Start opens once both are in', () => {
  const { ui, els, slotElements } = makeLobbyUi();
  ui.openVersusLocalLobby();
  const prevented = [];
  ui.handleVersusLocalLobbyKey(key('KeyW', { preventDefault: () => prevented.push('KeyW') }));
  assert.equal(statusOf(slotElements, 0), 'Player 1: Left keys');
  assert.equal(els.btnVersusLocalStart.getAttribute('aria-disabled'), 'true', 'one player is not enough');
  ui.handleVersusLocalLobbyKey(key('ArrowUp', { preventDefault: () => prevented.push('ArrowUp') }));
  assert.equal(statusOf(slotElements, 1), 'Player 2: Right keys');
  assert.equal(els.btnVersusLocalStart.getAttribute('aria-disabled'), 'false');
  assert.equal(els.versusLocalNeedTwo.classList.contains('hidden'), true);
  assert.deepEqual(prevented, ['KeyW', 'ArrowUp']);
  assert.equal(els.versusLocalLive.textContent, 'Player 2 joined with Right keys', 'the live region says who joined');
});

test('the quick join ignores repeats, browser shortcuts, a focused list, a taken place, and a closed lobby', () => {
  const { ui, slotElements } = makeLobbyUi();
  ui.handleVersusLocalLobbyKey(key('KeyW'));
  assert.equal(ui.versusLocal.slots[0].device, null, 'closed lobby');
  ui.openVersusLocalLobby();
  ui.handleVersusLocalLobbyKey(key('KeyW', { repeat: true }));
  ui.handleVersusLocalLobbyKey(key('KeyW', { ctrlKey: true }));
  ui.handleVersusLocalLobbyKey(key('KeyA'));
  assert.equal(ui.versusLocal.slots[0].device, null);
  globalThis.document.activeElement = { tagName: 'SELECT' };
  ui.handleVersusLocalLobbyKey(key('ArrowUp'));
  assert.equal(ui.versusLocal.slots[1].device, null, 'a list keeps its arrow keys');
  globalThis.document.activeElement = null;
  ui.handleVersusLocalLobbyKey(key('KeyW'));
  ui.joinVersusLocalSlot(0, { type: DEVICE_TYPES.TOUCH });
  ui.handleVersusLocalLobbyKey(key('KeyW'));
  assert.equal(ui.versusLocal.slots[0].device.type, DEVICE_TYPES.TOUCH, 'a place that is taken keeps its device');
  assert.equal(statusOf(slotElements, 0), 'Player 1: Touch');
});

test('Change device walks the devices of the place, an empty place takes the first, and Leave frees it', () => {
  const { ui, slotElements, els } = makeLobbyUi();
  ui.openVersusLocalLobby();
  const typeOf = (index) => ui.versusLocal.slots[index].device?.type ?? null;
  ui.cycleVersusLocalDevice(0);
  assert.equal(typeOf(0), DEVICE_TYPES.KEYBOARD);
  ui.cycleVersusLocalDevice(0);
  assert.equal(typeOf(0), DEVICE_TYPES.KEYBOARD_MOUSE);
  assert.equal(statusOf(slotElements, 0), 'Player 1: Left keys and mouse');
  ui.cycleVersusLocalDevice(0);
  assert.equal(typeOf(0), DEVICE_TYPES.TOUCH);
  ui.cycleVersusLocalDevice(0);
  assert.equal(typeOf(0), DEVICE_TYPES.KEYBOARD, 'the list wraps around');
  ui.cycleVersusLocalDevice(1);
  ui.cycleVersusLocalDevice(1);
  assert.equal(typeOf(1), DEVICE_TYPES.TOUCH);
  ui.cycleVersusLocalDevice(1);
  assert.equal(ui.versusLocal.slots[1].device.side, 'right');
  ui.leaveVersusLocalSlot(1);
  assert.equal(typeOf(1), null);
  assert.equal(statusOf(slotElements, 1), 'Press to join');
  assert.equal(els.versusLocalLive.textContent, 'Player 2 left');
  assert.equal(els.btnVersusLocalStart.getAttribute('aria-disabled'), 'true');
});

test('a controller that presses its confirm button takes the first free place; the same pad twice changes nothing', () => {
  const { ui, slotElements } = makeLobbyUi();
  ui.openVersusLocalLobby();
  assert.equal(ui.joinVersusLocalPad(PAD_A.index, PAD_A.id), true);
  assert.equal(statusOf(slotElements, 0), 'Player 1: Controller');
  assert.equal(ui.joinVersusLocalPad(PAD_A.index, PAD_A.id), false);
  assert.equal(ui.joinVersusLocalPad(PAD_B.index, PAD_B.id), true);
  assert.equal(statusOf(slotElements, 1), 'Player 2: Controller');
  assert.equal(ui.joinVersusLocalPad(8, 'pad c'), false, 'no third place');
});

test('each pad acts for itself in the lobby: join with confirm, move with the stick, free the place with back', () => {
  const { ui, menuActions } = makeLobbyUi();
  ui.openVersusLocalLobby();
  const padResult = (pad, actions) => ({ pads: [{ padIndex: pad.index, id: pad.id, actions, aimDelta: 0, aimSteps: 0, active: true }], events: [] });
  ui.routeVersusLocalLobbyPads(padResult(PAD_A, [A.NAV_DOWN]));
  assert.equal(ui.versusLocal.slots[0].device, null, 'an unassigned pad only joins, it does not navigate');
  assert.deepEqual(menuActions, []);
  ui.routeVersusLocalLobbyPads(padResult(PAD_A, [A.CONFIRM]));
  assert.equal(ui.versusLocal.slots[0].device.padIndex, PAD_A.index);
  ui.routeVersusLocalLobbyPads(padResult(PAD_A, [A.NAV_DOWN, A.CONFIRM]));
  assert.deepEqual(menuActions, [[A.NAV_DOWN, A.CONFIRM]], 'an assigned pad moves around the dialog');
  ui.routeVersusLocalLobbyPads(padResult(PAD_A, [A.BACK]));
  assert.equal(ui.versusLocal.slots[0].device, null, 'its back button frees its place');
  assert.equal(ui.isVersusLocalLobbyOpen(), true, 'and does not close the lobby');
  ui.routeVersusLocalLobbyPads(padResult(PAD_B, [A.BACK]));
  assert.equal(ui.isVersusLocalLobbyOpen(), false, 'a pad with no place closes the lobby while nobody has joined');
});

test('a pad with no place cannot close the lobby once someone has joined', () => {
  const { ui } = makeLobbyUi();
  ui.openVersusLocalLobby();
  ui.joinVersusLocalSlot(0, { type: DEVICE_TYPES.TOUCH });
  ui.routeVersusLocalLobbyPads({ pads: [{ padIndex: PAD_B.index, id: PAD_B.id, actions: [A.BACK], aimDelta: 0, aimSteps: 0, active: true }], events: [] });
  assert.equal(ui.isVersusLocalLobbyOpen(), true);
});

test('a controller that goes away in the lobby frees its place', () => {
  const { ui } = makeLobbyUi();
  ui.openVersusLocalLobby();
  ui.joinVersusLocalPad(PAD_A.index, PAD_A.id);
  ui.handleLocalPadEvent({ type: 'disconnected', padIndex: PAD_A.index, id: PAD_A.id });
  assert.equal(ui.versusLocal.slots[0].device, null);
});

test('Start refuses to begin with an empty place, and begins with the devices and handicaps chosen', () => {
  const { ui, els, started } = makeLobbyUi();
  ui.openVersusLocalLobby();
  ui.startVersusLocal();
  assert.deepEqual(started, []);
  assert.equal(els.versusLocalLive.textContent, 'Both players must join');
  ui.joinVersusLocalSlot(0, { type: DEVICE_TYPES.KEYBOARD, side: 'left' });
  ui.joinVersusLocalSlot(1, { type: DEVICE_TYPES.TOUCH });
  ui.versusLocal.handicaps = [1, 2];
  ui.startVersusLocal();
  assert.equal(started.length, 1);
  assert.equal(started[0].kind, 'local');
  assert.deepEqual(started[0].slots.map((slot) => slot.device.type), [DEVICE_TYPES.KEYBOARD, DEVICE_TYPES.TOUCH]);
  assert.deepEqual(started[0].riseMultipliers, [1.25, 1.5]);
});

test('Escape closes the lobby and gives the focus back to the entry button', () => {
  const { ui, els } = makeLobbyUi();
  assert.equal(ui.handleVersusLocalLobbyBack(), false, 'nothing to close');
  ui.openVersusLocalLobby();
  assert.equal(ui.handleVersusLocalLobbyBack(), true);
  assert.equal(ui.isVersusLocalLobbyOpen(), false);
  assert.equal(ui.stackedModalOpener, els.btnVersusLocal);
});

test('the keys are named as the layout names them (AZERTY), with the QWERTY names as the fallback', () => {
  const { ui, slotElements } = makeLobbyUi();
  assert.equal(ui.describeLocalKey('KeyW'), 'W');
  assert.equal(ui.describeLocalKey('ArrowUp'), 'Up');
  ui.versusLocal.layoutMap = new Map([['KeyW', 'z']]);
  assert.equal(ui.describeLocalKey('KeyW'), 'Z');
  ui.openVersusLocalLobby();
  assert.match(slotElements[0].parts['.versus-local-join-hint'].textContent, /press Z to join/);
});

test('changing the language writes the open lobby again', () => {
  const { ui, slotElements } = makeLobbyUi();
  ui.openVersusLocalLobby();
  i18n.currentLocale = 'fr';
  ui.refreshVersusLocalLanguage();
  assert.equal(statusOf(slotElements, 0), 'Appuyez pour rejoindre');
});

test('the page carries the lobby, the entry and the second HUD controls the screen reads', () => {
  for (const id of [
    'modal-versus-local',
    'btn-versus-local',
    'btn-versus-local-start',
    'btn-versus-local-back',
    'versus-local-need-two',
    'versus-local-live',
    'btn-versus-swap-1',
    'btn-versus-polarity-1',
    'versus-specials-1',
    'versus-pause-size-hint',
    'versus-pause-pad-hint',
    'versus-result-neutralised-b',
    'versus-result-pulses-b',
    'btn-versus-change-players'
  ]) {
    assert.ok(indexHtml.includes(`id="${id}"`), `${id} is in index.html`);
  }
  assert.match(indexHtml, /id="modal-versus-local"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(indexHtml, /id="btn-versus-local"[^>]*class="[^"]*\bhidden\b/, 'the entry starts hidden');
});
