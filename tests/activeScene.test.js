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

import { GAME_STATES, INPUT_MODES } from '../src/core/Constants.js';
import { GAMEPAD_ACTIONS as A, GAMEPAD_EVENTS } from '../src/core/GamepadInput.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { UIManager } from '../src/ui/UIManager.js';
import { UI_SCENES } from '../src/ui/UIInputBindings.js';

const gameConfig = applyWorldGeometry(JSON.parse(readFileSync('./configs/game.json', 'utf8')));
const AIM_DELTA = 0.2;

function makeController() {
  const calls = [];
  return {
    calls,
    handleGameplayKey: (event) => calls.push(['key', event.code]),
    handleGamepadActions: (actions, aimDelta) => calls.push(['pad', actions, aimDelta]),
    pause: () => calls.push(['pause'])
  };
}

function makeUi() {
  const engineCalls = [];
  const engine = {
    state: GAME_STATES.PLAYING,
    aimAngle: -1,
    currentBall: { specialType: null },
    specialInventory: {},
    swapLauncherBalls: () => engineCalls.push('swap'),
    shoot: () => engineCalls.push('shoot'),
    adjustAimByDelta: () => engineCalls.push('aim'),
    togglePause: () => engineCalls.push('pause')
  };
  const ui = Object.create(UIManager.prototype);
  ui.engine = engine;
  ui.gameConfig = gameConfig;
  ui.inputMode = INPUT_MODES.POINTER;
  ui.isDrawerOpen = false;
  ui.elements = { toast: { textContent: '', classList: { add() {}, remove() {} } } };
  ui.updateAimState = () => {};
  ui.announce = () => {};
  ui.showToast = () => {};
  ui.isAnyModalOpen = () => false;
  ui.isFluxPerkModalTop = () => false;
  ui.setInputMode = (mode) => {
    ui.inputMode = mode;
  };
  return { ui, engineCalls };
}

function withDocument(fn, hidden = false) {
  const previous = globalThis.document;
  globalThis.document = { activeElement: null, hidden };
  try {
    return fn();
  } finally {
    globalThis.document = previous;
  }
}

const key = (code) => ({ code, repeat: false, preventDefault() {} });

test('the main scene is the default and keeps the single-player keys', () => {
  withDocument(() => {
    const { ui, engineCalls } = makeUi();
    assert.equal(ui.getSceneController(), null);
    ui.handleKeyDown(key('Space'));
    ui.handleKeyDown(key('Enter'));
    assert.deepEqual(engineCalls, ['swap', 'shoot']);
  });
});

test('the versus scene sends the gameplay keys to the controller, not the engine', () => {
  withDocument(() => {
    const { ui, engineCalls } = makeUi();
    const controller = makeController();
    ui.setActiveScene(UI_SCENES.VERSUS, controller);
    ui.handleKeyDown(key('Space'));
    ui.handleKeyDown(key('ArrowLeft'));
    assert.deepEqual(controller.calls, [
      ['key', 'Space'],
      ['key', 'ArrowLeft']
    ]);
    assert.deepEqual(engineCalls, []);
  });
});

test('switching back to main restores the engine routing', () => {
  withDocument(() => {
    const { ui, engineCalls } = makeUi();
    const controller = makeController();
    ui.setActiveScene(UI_SCENES.VERSUS, controller);
    ui.setActiveScene(UI_SCENES.MAIN);
    ui.handleKeyDown(key('Space'));
    assert.deepEqual(engineCalls, ['swap']);
    assert.deepEqual(controller.calls, []);
  });
});

test('versus without a controller falls back to the main scene', () => {
  const { ui } = makeUi();
  ui.setActiveScene(UI_SCENES.VERSUS, null);
  assert.equal(ui.getSceneController(), null);
});

test('the versus scene receives the controller actions and the aim delta', () => {
  const { ui, engineCalls } = makeUi();
  const controller = makeController();
  ui.setActiveScene(UI_SCENES.VERSUS, controller);
  ui.routeGamepadGameplay({ actions: [A.SHOOT, A.SWAP], aimDelta: AIM_DELTA });
  assert.deepEqual(controller.calls, [['pad', [A.SHOOT, A.SWAP], AIM_DELTA]]);
  assert.deepEqual(engineCalls, []);
});

test('the main scene still routes the controller actions to the engine', () => {
  const { ui, engineCalls } = makeUi();
  ui.routeGamepadGameplay({ actions: [A.SHOOT, A.SWAP], aimDelta: 0 });
  assert.deepEqual(engineCalls, ['shoot', 'swap']);
});

test('a pad that disconnects pauses through the controller in the versus scene', () => {
  const { ui, engineCalls } = makeUi();
  const controller = makeController();
  ui.setActiveScene(UI_SCENES.VERSUS, controller);
  ui.handleGamepadEvent(GAMEPAD_EVENTS.DISCONNECTED);
  assert.deepEqual(controller.calls, [['pause']]);
  assert.deepEqual(engineCalls, []);
});

test('a hidden page pauses the engine in main and the controller in versus', () => {
  withDocument(() => {
    const { ui, engineCalls } = makeUi();
    const controller = makeController();
    ui.handleVisibilityChange();
    assert.deepEqual(engineCalls, ['pause']);
    ui.setActiveScene(UI_SCENES.VERSUS, controller);
    ui.handleVisibilityChange();
    assert.deepEqual(controller.calls, [['pause']]);
    assert.deepEqual(engineCalls, ['pause']);
  }, true);
});

test('a visible page pauses nothing', () => {
  withDocument(() => {
    const { ui, engineCalls } = makeUi();
    const controller = makeController();
    ui.handleVisibilityChange();
    ui.setActiveScene(UI_SCENES.VERSUS, controller);
    ui.handleVisibilityChange();
    assert.deepEqual(engineCalls, []);
    assert.deepEqual(controller.calls, []);
  }, false);
});

// ---------------------------------------------------------------------------------------------
// Two players on one device: key releases, window blur, repeated keys
// ---------------------------------------------------------------------------------------------

function makeLocalController() {
  const calls = [];
  return {
    calls,
    multiPad: true,
    handleGameplayKey: (event) => calls.push(['key', event.code, event.repeat]),
    handleGameplayKeyUp: (event) => calls.push(['keyup', event.code]),
    releaseAllKeys: () => calls.push(['release']),
    handlePadResults: (results) => calls.push(['pads', results.pads.length]),
    beforeFrame: (now, elapsedMs) => calls.push(['frame', now, elapsedMs]),
    handleGamepadActions: () => calls.push(['single']),
    pause: () => calls.push(['pause'])
  };
}

test('a key release is handed to the scene that tracks held keys, and ignored by one that does not', () => {
  const { ui, engineCalls } = makeUi();
  ui.handleKeyUp({ code: 'KeyD' });
  const controller = makeLocalController();
  ui.setActiveScene(UI_SCENES.VERSUS, controller);
  ui.handleKeyUp({ code: 'KeyD' });
  assert.deepEqual(controller.calls, [['keyup', 'KeyD']]);
  const plain = makeController();
  ui.setActiveScene(UI_SCENES.VERSUS, plain);
  ui.handleKeyUp({ code: 'KeyD' });
  assert.deepEqual(plain.calls, []);
  assert.deepEqual(engineCalls, []);
});

test('the key release reaches the scene even while a dialog is open, so no key stays held', () => {
  const { ui } = makeUi();
  ui.isAnyModalOpen = () => true;
  const controller = makeLocalController();
  ui.setActiveScene(UI_SCENES.VERSUS, controller);
  ui.handleKeyUp({ code: 'KeyD' });
  assert.deepEqual(controller.calls, [['keyup', 'KeyD']]);
});

test('the window losing focus lets go of every held key', () => {
  const { ui } = makeUi();
  ui.handleWindowBlur();
  const controller = makeLocalController();
  ui.setActiveScene(UI_SCENES.VERSUS, controller);
  ui.handleWindowBlur();
  assert.deepEqual(controller.calls, [['release']]);
});

test('Escape still pauses in a two-player match, and the keys of the layout reach the scene', () => {
  withDocument(() => {
    const { ui } = makeUi();
    const controller = makeLocalController();
    ui.setActiveScene(UI_SCENES.VERSUS, controller);
    const backs = [];
    ui.handleBackAction = () => backs.push('back');
    ui.handleKeyDown(key('KeyW'));
    ui.handleKeyDown(key('Escape'));
    assert.deepEqual(backs, ['back']);
    assert.deepEqual(controller.calls, [['key', 'KeyW', false]]);
  });
});

test('an auto-repeated key of the layout is still kept from the page, and a repeated Escape never pauses twice', () => {
  withDocument(() => {
    const { ui } = makeUi();
    const controller = makeLocalController();
    ui.setActiveScene(UI_SCENES.VERSUS, controller);
    const backs = [];
    ui.handleBackAction = () => backs.push('back');
    ui.handleKeyDown({ code: 'Enter', repeat: true, preventDefault() {} });
    ui.handleKeyDown({ code: 'Escape', repeat: true, preventDefault() {} });
    ui.handleKeyDown({ code: 'Enter', repeat: true, ctrlKey: true, preventDefault() {} });
    assert.deepEqual(backs, []);
    assert.deepEqual(controller.calls, [['key', 'Enter', true], ['key', 'Escape', true]]);
  });
});

test('a repeated key reaches only a scene that wants every pad apart, and never while a dialog is open', () => {
  withDocument(() => {
    const { ui } = makeUi();
    const plain = makeController();
    ui.setActiveScene(UI_SCENES.VERSUS, plain);
    ui.handleKeyDown({ code: 'Enter', repeat: true, preventDefault() {} });
    assert.deepEqual(plain.calls, []);
    const controller = makeLocalController();
    ui.setActiveScene(UI_SCENES.VERSUS, controller);
    ui.isAnyModalOpen = () => true;
    ui.handleKeyDown({ code: 'Enter', repeat: true, preventDefault() {} });
    assert.deepEqual(controller.calls, []);
  });
});

test('a pad lost in a two-player scene is the scene business: the single pad path does not pause for it', () => {
  const { ui, engineCalls } = makeUi();
  const controller = makeLocalController();
  ui.setActiveScene(UI_SCENES.VERSUS, controller);
  ui.handleGamepadEvent(GAMEPAD_EVENTS.DISCONNECTED);
  assert.deepEqual(controller.calls, []);
  assert.deepEqual(engineCalls, []);
});

test('a hidden page still pauses a two-player scene through its controller', () => {
  withDocument(() => {
    const { ui } = makeUi();
    const controller = makeLocalController();
    ui.setActiveScene(UI_SCENES.VERSUS, controller);
    ui.handleVisibilityChange();
    assert.deepEqual(controller.calls, [['pause']]);
  }, true);
});
