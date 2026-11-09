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

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { AudioManager } from '../src/core/AudioManager.js';
import { GAMEPAD_EVENTS } from '../src/core/GamepadInput.js';
import { UIManager } from '../src/ui/UIManager.js';

const loadJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
configRegistry.configs.set('audio', loadJson('./configs/audio.json'));
const html = readFileSync('./index.html', 'utf8');
const en = loadJson('./locales/en.json');

const HAPTIC_MS = 20;
const SETTINGS_START = html.indexOf('id="modal-settings"');
const SETTINGS_END = html.indexOf('id="btn-close-settings"');
const settingsHtml = html.slice(SETTINGS_START, SETTINGS_END);

const makeClassList = (initial = []) => {
  const set = new Set(initial);
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c, force) => (force ? set.add(c) : set.delete(c))
  };
};

const withNavigator = (value, fn) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  try {
    fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'navigator', descriptor);
    } else {
      delete globalThis.navigator;
    }
  }
};

test('triggerHaptic vibrates by default and stays silent once Vibration is off', () => {
  const calls = [];
  withNavigator({ vibrate: (ms) => calls.push(ms) }, () => {
    const audio = new AudioManager();
    audio.init(false, false);
    audio.clock = () => 0;
    audio.triggerHaptic(HAPTIC_MS);
    assert.deepEqual(calls, [HAPTIC_MS]);
    audio.setVibrationEnabled(false);
    audio.clock = () => Number.MAX_SAFE_INTEGER;
    audio.triggerHaptic(HAPTIC_MS);
    assert.deepEqual(calls, [HAPTIC_MS], 'no vibration while the setting is off');
    audio.setVibrationEnabled(true);
    audio.triggerHaptic(HAPTIC_MS);
    assert.equal(calls.length, 2);
  });
});

test('init honours the vibrationEnabled option', () => {
  const calls = [];
  withNavigator({ vibrate: (ms) => calls.push(ms) }, () => {
    const audio = new AudioManager();
    audio.init(false, false, { vibrationEnabled: false });
    audio.triggerHaptic(HAPTIC_MS);
    assert.equal(calls.length, 0);
  });
});

test('the settings modal holds four labelled groups with the Vibration checkbox under Accessibility', () => {
  const groups = [...settingsHtml.matchAll(/<section class="settings-controller settings-group" aria-labelledby="([^"]+)">([\s\S]*?)<\/section>/g)];
  assert.equal(groups.length, 4);
  for (const [, labelId, body] of groups) {
    assert.match(body, new RegExp(`<h3 id="${labelId}" class="stats-section-title" data-i18n="modals\\.settings\\.(groups|controller)\\.[a-z]+"></h3>`));
  }
  const [audio, gameplay, accessibility, controller] = groups.map((g) => g[2]);
  for (const id of ['btn-sound', 'btn-music', 'btn-music-volume']) {
    assert.ok(audio.includes(`id="${id}"`), id);
  }
  for (const id of ['btn-resonance', 'btn-calibrate', 'btn-tilt', 'btn-reset-hints', 'btn-fullscreen', 'btn-lang', 'input-duel-name']) {
    assert.ok(gameplay.includes(`id="${id}"`), id);
  }
  for (const id of ['btn-contrast', 'btn-patterns', 'btn-motion', 'btn-anim-speed', 'input-gamepad-rumble']) {
    assert.ok(accessibility.includes(`id="${id}"`), id);
  }
  assert.ok(accessibility.includes('data-i18n="modals.settings.vibration"'));
  assert.ok(controller.includes('id="settings-controller-nopad"'));
  assert.match(controller, /<div id="settings-controller-fields" class="hidden">/);
  assert.ok(!controller.includes('input-gamepad-rumble'));
  for (const id of ['input-gamepad-enabled', 'select-gamepad-deadzone', 'select-gamepad-aim-speed', 'input-gamepad-invert-x']) {
    assert.ok(controller.includes(`id="${id}"`), id);
  }
  assert.ok(en.modals.settings.groups.audio && en.modals.settings.controller.noPad && en.modals.settings.vibration);
});

const makeControllerUi = () => {
  const ui = Object.create(UIManager.prototype);
  ui.elements = {
    settingsControllerFields: { classList: makeClassList(['hidden']) },
    settingsControllerNoPad: { classList: makeClassList() }
  };
  ui.showToast = () => {};
  ui.announce = () => {};
  ui.getSceneController = () => null;
  ui.engine = { state: 'MENU' };
  return ui;
};

test('controller fields are hidden without a pad and shown with one, refreshed on connect and disconnect', () => {
  const pads = [null, null];
  const ui = makeControllerUi();
  withNavigator({ getGamepads: () => pads }, () => {
    ui.refreshControllerFields();
    assert.equal(ui.elements.settingsControllerFields.classList.contains('hidden'), true);
    assert.equal(ui.elements.settingsControllerNoPad.classList.contains('hidden'), false);

    pads[0] = { index: 0, connected: true };
    ui.handleGamepadEvent(GAMEPAD_EVENTS.CONNECTED);
    assert.equal(ui.elements.settingsControllerFields.classList.contains('hidden'), false);
    assert.equal(ui.elements.settingsControllerNoPad.classList.contains('hidden'), true);

    pads[0] = null;
    ui.handleGamepadEvent(GAMEPAD_EVENTS.DISCONNECTED);
    assert.equal(ui.elements.settingsControllerFields.classList.contains('hidden'), true);
    assert.equal(ui.elements.settingsControllerNoPad.classList.contains('hidden'), false);
  });
});

test('hasConnectedGamepad ignores flagged-off pads and survives a missing or failing API', () => {
  const ui = makeControllerUi();
  withNavigator({ getGamepads: () => [{ index: 0, connected: false }] }, () => {
    assert.equal(ui.hasConnectedGamepad(), false);
  });
  withNavigator({}, () => {
    assert.equal(ui.hasConnectedGamepad(), false);
  });
  withNavigator({ getGamepads: () => { throw new Error('blocked'); } }, () => {
    assert.equal(ui.hasConnectedGamepad(), false);
  });
});
