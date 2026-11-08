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
