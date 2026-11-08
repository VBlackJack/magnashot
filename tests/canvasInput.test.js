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

import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { bindCanvasInput } from '../src/ui/CanvasInput.js';

const gameConfig = applyWorldGeometry(JSON.parse(readFileSync('./configs/game.json', 'utf8')));
const CANVAS_CFG = gameConfig.canvas;
const BOX_SIZE = 400;
const BOUND_EVENT_COUNT = 4;

function makeCanvas() {
  const listeners = new Map();
  return {
    captured: [],
    released: [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: BOX_SIZE, height: BOX_SIZE }),
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    },
    setPointerCapture(id) {
      this.captured.push(id);
    },
    releasePointerCapture(id) {
      this.released.push(id);
    },
    fire(type, event) {
      const handler = listeners.get(type);
      if (handler) {
        handler({ isPrimary: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, ...event });
      }
    },
    listenerCount: () => listeners.size
  };
}

function makeEngine({ follow = true } = {}) {
  const calls = [];
  return {
    calls,
    isAimCancelled: true,
    followPointer: (x, y) => {
      calls.push(['follow', x, y]);
      return follow;
    },
    releaseAimLock: () => calls.push(['release']),
    updateAim: (x, y) => calls.push(['aim', x, y]),
    shoot: () => calls.push(['shoot']),
    swapLauncherBalls: () => calls.push(['swap'])
  };
}

function setup(options = {}, engineOptions = {}) {
  const canvas = makeCanvas();
  const engine = makeEngine(engineOptions);
  const aimChanged = [];
  const binding = bindCanvasInput(canvas, () => engine, gameConfig, {
    onAimChanged: (e) => aimChanged.push(e),
    ...options
  });
  return { canvas, engine, aimChanged, binding };
}

/** Client coordinates that map to the given logical point. */
const toClient = (x, y) => ({
  clientX: (x * BOX_SIZE) / CANVAS_CFG.logicalWidth,
  clientY: (y * BOX_SIZE) / CANVAS_CFG.logicalHeight
});

const AIM_POINT = { x: CANVAS_CFG.launcherX, y: CANVAS_CFG.launcherY - 300 };
const names = (engine) => engine.calls.map((c) => c[0]);

test('a mouse move aims at the pointer when the engine follows it', () => {
  const { canvas, engine, aimChanged } = setup();
  canvas.fire('pointermove', toClient(AIM_POINT.x, AIM_POINT.y));
  assert.deepEqual(names(engine), ['follow', 'aim']);
  assert.ok(Math.abs(engine.calls[1][1] - AIM_POINT.x) < 1e-6);
  assert.equal(aimChanged.length, 1);
});

test('a mouse move leaves a keyboard-adjusted aim alone when the engine does not follow', () => {
  const { canvas, engine } = setup({}, { follow: false });
  canvas.fire('pointermove', toClient(AIM_POINT.x, AIM_POINT.y));
  assert.deepEqual(names(engine), ['follow']);
});

test('a finger always aims and releases the aim lock', () => {
  const { canvas, engine } = setup({}, { follow: false });
  canvas.fire('pointermove', { pointerType: 'touch', ...toClient(AIM_POINT.x, AIM_POINT.y) });
  assert.deepEqual(names(engine), ['release', 'aim']);
});

test('a touch above the cancel line is lifted by the touch offset, capped at the anchor', () => {
  const { canvas, engine } = setup();
  canvas.fire('pointermove', { pointerType: 'touch', ...toClient(AIM_POINT.x, AIM_POINT.y) });
  const aim = engine.calls.find((c) => c[0] === 'aim');
  const expected = Math.min(
    AIM_POINT.y + CANVAS_CFG.touchAimVerticalOffset,
    CANVAS_CFG.launcherY + CANVAS_CFG.touchMinAimAnchorOffsetY
  );
  assert.ok(Math.abs(aim[2] - expected) < 1e-6);
});

test('pointer down then up away from the launcher aims and shoots, capturing the pointer', () => {
  const { canvas, engine } = setup();
  const at = toClient(AIM_POINT.x, AIM_POINT.y);
  canvas.fire('pointerdown', at);
  canvas.fire('pointerup', at);
  assert.equal(names(engine).filter((n) => n === 'shoot').length, 1);
  assert.deepEqual(canvas.captured, [1]);
  assert.deepEqual(canvas.released, [1]);
});

test('a tap on the launcher base swaps instead of shooting', () => {
  const { canvas, engine } = setup();
  const at = toClient(CANVAS_CFG.launcherX, CANVAS_CFG.launcherY);
  canvas.fire('pointerdown', at);
  canvas.fire('pointerup', at);
  assert.equal(names(engine).filter((n) => n === 'swap').length, 1);
  assert.equal(names(engine).filter((n) => n === 'shoot').length, 0);
  assert.equal(engine.isAimCancelled, false);
});

test('a pointer up without a pointer down does nothing', () => {
  const { canvas, engine } = setup();
  canvas.fire('pointerup', toClient(AIM_POINT.x, AIM_POINT.y));
  assert.deepEqual(engine.calls, []);
});

test('pointer cancel clears the cancelled aim and reports the aim state', () => {
  const { canvas, engine, aimChanged } = setup();
  canvas.fire('pointerdown', toClient(AIM_POINT.x, AIM_POINT.y));
  canvas.fire('pointercancel', {});
  assert.equal(engine.isAimCancelled, false);
  assert.equal(aimChanged.length, 2);
  assert.deepEqual(canvas.released, [1]);
});

test('secondary pointers and non-primary buttons are ignored', () => {
  const { canvas, engine } = setup();
  canvas.fire('pointermove', { isPrimary: false });
  canvas.fire('pointerdown', { isPrimary: false });
  canvas.fire('pointerdown', { button: 2 });
  assert.deepEqual(engine.calls, []);
});

test('while blocked, moves and presses are ignored', () => {
  const { canvas, engine } = setup({ isBlocked: () => true });
  canvas.fire('pointermove', toClient(AIM_POINT.x, AIM_POINT.y));
  canvas.fire('pointerdown', toClient(AIM_POINT.x, AIM_POINT.y));
  assert.deepEqual(engine.calls, []);
});

test('acceptPointer filters which pointers the canvas follows', () => {
  const { canvas, engine } = setup({ acceptPointer: (e) => e.pointerId === 7 });
  canvas.fire('pointermove', { pointerId: 3, ...toClient(AIM_POINT.x, AIM_POINT.y) });
  assert.deepEqual(engine.calls, []);
  canvas.fire('pointermove', { pointerId: 7, ...toClient(AIM_POINT.x, AIM_POINT.y) });
  assert.ok(engine.calls.length > 0);
});

test('the engine is read at each event, so a swapped engine receives the input', () => {
  const canvas = makeCanvas();
  const first = makeEngine();
  const second = makeEngine();
  let current = first;
  bindCanvasInput(canvas, () => current, gameConfig);
  canvas.fire('pointermove', toClient(AIM_POINT.x, AIM_POINT.y));
  current = second;
  canvas.fire('pointermove', toClient(AIM_POINT.x, AIM_POINT.y));
  assert.equal(first.calls.length, 2);
  assert.equal(second.calls.length, 2);
});

const AT_AIM = () => toClient(AIM_POINT.x, AIM_POINT.y);
const perCanvasSetup = (options = {}) => setup({ pointerOwnership: 'perCanvas', ...options });
const shots = (engine) => names(engine).filter((n) => n === 'shoot').length;

test('perCanvas: a non-primary touch owns the canvas and shoots on release', () => {
  const { canvas, engine } = perCanvasSetup();
  canvas.fire('pointerdown', { isPrimary: false, pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  canvas.fire('pointerup', { isPrimary: false, pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  assert.equal(shots(engine), 1);
  assert.deepEqual(canvas.captured, [5]);
});

test('perCanvas: other pointers are ignored while one is owned', () => {
  const { canvas, engine } = perCanvasSetup();
  canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  const before = engine.calls.length;
  canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 6, ...AT_AIM() });
  canvas.fire('pointermove', { pointerType: 'mouse', pointerId: 9, ...AT_AIM() });
  canvas.fire('pointerup', { pointerType: 'touch', pointerId: 6, ...AT_AIM() });
  assert.equal(engine.calls.length, before);
  assert.deepEqual(canvas.captured, [5]);
  canvas.fire('pointerup', { pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  assert.equal(shots(engine), 1);
});

test('perCanvas: with no owned pointer only mouse hover moves the aim', () => {
  const { canvas, engine } = perCanvasSetup();
  canvas.fire('pointermove', { pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  canvas.fire('pointermove', { pointerType: 'pen', pointerId: 6, ...AT_AIM() });
  assert.deepEqual(engine.calls, []);
  canvas.fire('pointermove', { pointerType: 'mouse', pointerId: 1, ...AT_AIM() });
  assert.deepEqual(names(engine), ['follow', 'aim']);
});

test('perCanvas: pointer cancel frees ownership for a new pointer', () => {
  const { canvas, engine } = perCanvasSetup();
  canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  canvas.fire('pointercancel', { pointerType: 'touch', pointerId: 6 });
  canvas.fire('pointerup', { pointerType: 'touch', pointerId: 6, ...AT_AIM() });
  assert.equal(shots(engine), 0);
  canvas.fire('pointercancel', { pointerType: 'touch', pointerId: 5 });
  canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 6, ...AT_AIM() });
  canvas.fire('pointerup', { pointerType: 'touch', pointerId: 6, ...AT_AIM() });
  assert.equal(shots(engine), 1);
});

test('perCanvas: lost pointer capture frees ownership without shooting', () => {
  const { canvas, engine, aimChanged } = perCanvasSetup();
  canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  const changed = aimChanged.length;
  canvas.fire('lostpointercapture', { pointerId: 7 });
  assert.equal(aimChanged.length, changed);
  canvas.fire('lostpointercapture', { pointerId: 5 });
  assert.equal(aimChanged.length, changed + 1);
  canvas.fire('pointerup', { pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  assert.equal(shots(engine), 0);
  canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 8, ...AT_AIM() });
  assert.deepEqual(canvas.captured, [5, 8]);
});

test('perCanvas: acceptPointer is honoured and a rejected press claims nothing', () => {
  const { canvas, engine } = perCanvasSetup({ acceptPointer: (e) => e.pointerType === 'touch' });
  canvas.fire('pointerdown', { pointerType: 'mouse', pointerId: 1, ...AT_AIM() });
  canvas.fire('pointermove', { pointerType: 'mouse', pointerId: 1, ...AT_AIM() });
  assert.deepEqual(engine.calls, []);
  canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  canvas.fire('pointerup', { pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  assert.equal(shots(engine), 1);
});

test('perCanvas: blocked and secondary-button presses claim nothing; unbind removes every listener', () => {
  let blocked = true;
  const { canvas, binding } = perCanvasSetup({ isBlocked: () => blocked });
  canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  blocked = false;
  canvas.fire('pointerdown', { pointerType: 'mouse', pointerId: 6, button: 2, ...AT_AIM() });
  canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 7, ...AT_AIM() });
  assert.deepEqual(canvas.captured, [7]);
  assert.equal(canvas.listenerCount(), BOUND_EVENT_COUNT + 1);
  binding.unbind();
  assert.equal(canvas.listenerCount(), 0);
});

test('primary ownership binds no lost-capture listener and ignores non-primary pointers', () => {
  const { canvas, engine } = setup({ pointerOwnership: 'primary' });
  assert.equal(canvas.listenerCount(), BOUND_EVENT_COUNT);
  canvas.fire('pointerdown', { isPrimary: false, pointerType: 'touch', pointerId: 5, ...AT_AIM() });
  assert.deepEqual(engine.calls, []);
});

test('unbind removes every listener', () => {
  const { canvas, engine, binding } = setup();
  assert.equal(canvas.listenerCount(), BOUND_EVENT_COUNT);
  binding.unbind();
  assert.equal(canvas.listenerCount(), 0);
  canvas.fire('pointermove', toClient(AIM_POINT.x, AIM_POINT.y));
  assert.deepEqual(engine.calls, []);
});
