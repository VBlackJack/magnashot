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

import { GamepadInput, GAMEPAD_ACTIONS as A } from '../src/core/GamepadInput.js';

const CONFIG = {
    deadzoneOptions: [0.10, 0.18, 0.25],
    defaultDeadzone: 0.18,
    triggerPress: 0.5,
    triggerRelease: 0.4,
    precisionTrigger: 0.3,
    activityThreshold: 0.35,
    idleScanIntervalMs: 1000,
    analogButtons: [6, 7],
    aimSpeedRadPerSec: { slow: 1.4, normal: 2.2, fast: 3.2 },
    fineAimFactor: 0.15,
    precisionFactor: 0.25,
    responseExponent: 2,
    fineStepRad: 0.01,
    menuRepeat: { initialDelayMs: 350, intervalMs: 120 },
    stickMenuThreshold: 0.6,
    buttons: {
        shoot: [0, 7], back: [1], swap: [2], polarity: [3], specialPrev: [4], specialNext: [5],
        precision: [6], menu: [8], pause: [9], hint: [10], recenter: [11],
        up: 12, down: 13, left: 14, right: 15
    },
    axes: { aimX: 0, menuY: 1, fineX: 2 }
};

const BUTTON_COUNT = 17;

function makePad(index = 0, extra = {}) {
    return {
        index,
        mapping: 'standard',
        connected: true,
        buttons: Array.from({ length: BUTTON_COUNT }, () => ({ pressed: false, value: 0 })),
        axes: [0, 0, 0, 0],
        ...extra
    };
}

const ANALOG_BUTTONS = [6, 7];
// Browsers report an analog trigger as pressed from a very low value (about 0.12 in Chromium and Firefox).
const ANALOG_PRESSED_FROM = 0.12;
const DIGITAL_PRESSED_FROM = 0.5;

function press(pad, i, value = 1) {
    const pressedFrom = ANALOG_BUTTONS.includes(i) ? ANALOG_PRESSED_FROM : DIGITAL_PRESSED_FROM;
    pad.buttons[i] = { pressed: value >= pressedFrom, value };
}

function release(pad, i) {
    pad.buttons[i] = { pressed: false, value: 0 };
}

function setup({ pads, settings = {}, clock } = {}) {
    const list = pads || [makePad()];
    const time = clock || { t: 0 };
    const input = new GamepadInput({
        config: CONFIG,
        settings: { enabled: true, deadzone: 0.18, aimSpeed: 'normal', invertX: false, ...settings },
        getGamepads: () => list,
        now: () => time.t
    });
    return { input, pads: list, time };
}

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('left stick inside the deadzone yields no aim', () => {
    const { input, pads } = setup();
    pads[0].axes[0] = 0.15;
    assert.equal(input.poll(16).aimDelta, 0);
});

test('left stick rescales past the deadzone and applies the response curve', () => {
    const { input, pads } = setup();
    pads[0].axes[0] = 1;
    const out = input.poll(1000);
    close(out.aimDelta, CONFIG.aimSpeedRadPerSec.normal);
    pads[0].axes[0] = 0.59; // (0.59 - 0.18) / 0.82 = 0.5 -> 0.25 after the curve
    close(input.poll(1000).aimDelta, 0.25 * CONFIG.aimSpeedRadPerSec.normal);
});

test('deadzone setting changes the rescale', () => {
    const { input, pads } = setup({ settings: { deadzone: 0.25 } });
    pads[0].axes[0] = 0.25;
    assert.equal(input.poll(1000).aimDelta, 0);
    pads[0].axes[0] = 0.625; // (0.625 - 0.25) / 0.75 = 0.5
    close(input.poll(1000).aimDelta, 0.25 * CONFIG.aimSpeedRadPerSec.normal);
});

test('aim speed setting and elapsed time scale the delta', () => {
    const { input, pads } = setup({ settings: { aimSpeed: 'fast' } });
    pads[0].axes[0] = 1;
    close(input.poll(500).aimDelta, CONFIG.aimSpeedRadPerSec.fast * 0.5);
});

test('negative stick gives negative delta and invert X flips the sign', () => {
    const { input, pads } = setup();
    pads[0].axes[0] = -1;
    assert.ok(input.poll(100).aimDelta < 0);
    const inv = setup({ settings: { invertX: true } });
    inv.pads[0].axes[0] = -1;
    assert.ok(inv.input.poll(100).aimDelta > 0);
});

test('right stick adds fine aim scaled by the fine factor', () => {
    const { input, pads } = setup();
    pads[0].axes[2] = 1;
    close(input.poll(1000).aimDelta, CONFIG.fineAimFactor * CONFIG.aimSpeedRadPerSec.normal);
});

test('left trigger held slows aim by the precision factor', () => {
    const { input, pads } = setup();
    pads[0].axes[0] = 1;
    press(pads[0], 6, 0.8);
    close(input.poll(1000).aimDelta, CONFIG.precisionFactor * CONFIG.aimSpeedRadPerSec.normal);
    press(pads[0], 6, 0.2);
    close(input.poll(1000).aimDelta, CONFIG.aimSpeedRadPerSec.normal);
});

test('press edges fire once per press', () => {
    const { input, pads } = setup();
    assert.deepEqual(input.poll(16).actions, []);
    press(pads[0], 0);
    assert.deepEqual(input.poll(16).actions, [A.SHOOT]);
    assert.deepEqual(input.poll(16).actions, []);
    release(pads[0], 0);
    input.poll(16);
    press(pads[0], 0);
    assert.deepEqual(input.poll(16).actions, [A.SHOOT]);
});

test('gameplay buttons map to their actions', () => {
    const cases = [[2, A.SWAP], [3, A.POLARITY], [1, A.UNEQUIP], [4, A.SPECIAL_PREV], [5, A.SPECIAL_NEXT],
        [9, A.PAUSE], [8, A.MENU], [10, A.HINT], [11, A.RECENTER]];
    for (const [idx, action] of cases) {
        const { input, pads } = setup();
        press(pads[0], idx);
        assert.deepEqual(input.poll(16).actions, [action], `button ${idx}`);
    }
});

test('right trigger shoots with press and release hysteresis', () => {
    const { input, pads } = setup();
    press(pads[0], 7, 0.45);
    assert.deepEqual(input.poll(16).actions, [], 'below the press threshold');
    press(pads[0], 7, 0.55);
    assert.deepEqual(input.poll(16).actions, [A.SHOOT]);
    press(pads[0], 7, 0.45); // between release and press: still held
    assert.deepEqual(input.poll(16).actions, []);
    press(pads[0], 7, 0.55);
    assert.deepEqual(input.poll(16).actions, [], 'no second edge while held');
    press(pads[0], 7, 0.35); // below release
    input.poll(16);
    press(pads[0], 7, 0.55);
    assert.deepEqual(input.poll(16).actions, [A.SHOOT]);
});

test('menu mode emits menu actions and not gameplay ones', () => {
    const { input, pads } = setup();
    press(pads[0], 0);
    assert.deepEqual(input.poll(16, { menuOpen: true }).actions, [A.CONFIRM]);
    release(pads[0], 0);
    input.poll(16, { menuOpen: true });
    press(pads[0], 1);
    assert.deepEqual(input.poll(16, { menuOpen: true }).actions, [A.BACK]);
    release(pads[0], 1);
    input.poll(16, { menuOpen: true });
    press(pads[0], 4);
    assert.deepEqual(input.poll(16, { menuOpen: true }).actions, [A.TAB_PREV]);
    release(pads[0], 4);
    press(pads[0], 5);
    assert.deepEqual(input.poll(16, { menuOpen: true }).actions, [A.TAB_NEXT]);
    const out = input.poll(16, { menuOpen: true });
    assert.equal(out.aimDelta, 0);
});

test('a trigger press does not confirm in a menu', () => {
    const { input, pads } = setup();
    press(pads[0], 7);
    assert.deepEqual(input.poll(16, { menuOpen: true }).actions, []);
});

test('a press held while a menu opens does not fire a gameplay edge afterwards', () => {
    const { input, pads } = setup();
    press(pads[0], 0);
    input.poll(16, { menuOpen: true });
    assert.deepEqual(input.poll(16).actions, []);
});

test('d-pad navigation repeats with the configured delay and interval', () => {
    const { input, pads, time } = setup();
    const ctx = { menuOpen: true };
    press(pads[0], 13);
    assert.deepEqual(input.poll(16, ctx).actions, [A.NAV_DOWN]);
    time.t = 349;
    assert.deepEqual(input.poll(16, ctx).actions, []);
    time.t = 350;
    assert.deepEqual(input.poll(16, ctx).actions, [A.NAV_DOWN]);
    time.t = 469;
    assert.deepEqual(input.poll(16, ctx).actions, []);
    time.t = 470;
    assert.deepEqual(input.poll(16, ctx).actions, [A.NAV_DOWN]);
    release(pads[0], 13);
    time.t = 600;
    assert.deepEqual(input.poll(16, ctx).actions, []);
    press(pads[0], 13);
    assert.deepEqual(input.poll(16, ctx).actions, [A.NAV_DOWN], 'a new press fires immediately');
});

test('left stick navigates menus past the menu threshold, one per direction', () => {
    const cases = [[1, 0.7, A.NAV_DOWN], [1, -0.7, A.NAV_UP], [0, 0.7, A.NAV_RIGHT], [0, -0.7, A.NAV_LEFT]];
    for (const [axis, v, action] of cases) {
        const { input, pads } = setup();
        pads[0].axes[axis] = v;
        assert.deepEqual(input.poll(16, { menuOpen: true }).actions, [action]);
    }
    const { input, pads } = setup();
    pads[0].axes[1] = 0.5;
    assert.deepEqual(input.poll(16, { menuOpen: true }).actions, []);
});

test('d-pad left and right emit fine aim steps with repeat in gameplay', () => {
    const { input, pads, time } = setup();
    press(pads[0], 15);
    let out = input.poll(16);
    assert.equal(out.aimSteps, 1);
    close(out.aimDelta, CONFIG.fineStepRad);
    time.t = 100;
    assert.equal(input.poll(16).aimSteps, 0);
    time.t = 350;
    assert.equal(input.poll(16).aimSteps, 1);
    release(pads[0], 15);
    press(pads[0], 14);
    out = input.poll(16);
    assert.equal(out.aimSteps, -1);
    close(out.aimDelta, -CONFIG.fineStepRad);
    assert.ok(!out.actions.includes(A.NAV_LEFT));
});

test('non-standard pads are ignored', () => {
    const pad = makePad(0, { mapping: '' });
    const { input } = setup({ pads: [pad] });
    press(pad, 0);
    pad.axes[0] = 1;
    const out = input.poll(16);
    assert.deepEqual(out.actions, []);
    assert.equal(out.aimDelta, 0);
    assert.equal(out.active, false);
});

test('disabled setting emits nothing', () => {
    const { input, pads } = setup({ settings: { enabled: false } });
    press(pads[0], 0);
    pads[0].axes[0] = 1;
    const out = input.poll(16);
    assert.deepEqual(out.actions, []);
    assert.equal(out.aimDelta, 0);
    assert.equal(out.active, false);
});

test('settings are read live', () => {
    const settings = { enabled: true, deadzone: 0.18, aimSpeed: 'normal', invertX: false };
    const pad = makePad();
    const input = new GamepadInput({ config: CONFIG, settings, getGamepads: () => [pad], now: () => 0 });
    pad.axes[0] = 1;
    assert.ok(input.poll(100).aimDelta > 0);
    settings.enabled = false;
    assert.equal(input.poll(100).aimDelta, 0);
});

test('active pad follows the most recent input', () => {
    const a = makePad(0);
    const b = makePad(1);
    const { input } = setup({ pads: [a, b] });
    assert.equal(input.poll(16).padIndex, 0, 'defaults to the first pad');
    press(b, 2);
    let out = input.poll(16);
    assert.equal(out.padIndex, 1);
    assert.equal(out.active, true);
    assert.deepEqual(out.actions, [A.SWAP]);
    release(b, 2);
    out = input.poll(16);
    assert.equal(out.padIndex, 1, 'stays on the last active pad when idle');
    assert.equal(out.active, false);
    press(a, 3);
    out = input.poll(16);
    assert.equal(out.padIndex, 0);
    assert.deepEqual(out.actions, [A.POLARITY]);
});

test('no connected pad yields an inactive empty result', () => {
    const { input } = setup({ pads: [] });
    const out = input.poll(16);
    assert.deepEqual(out.actions, []);
    assert.equal(out.active, false);
    assert.equal(out.padIndex, -1);
});

test('connection events are reported once by poll, standard pads only', () => {
    const { input } = setup();
    const target = new EventTarget();
    assert.equal(input.attach(target), true);
    const evt = (type, gamepad) => Object.assign(new Event(type), { gamepad });
    target.dispatchEvent(evt('gamepadconnected', makePad(0)));
    target.dispatchEvent(evt('gamepadconnected', makePad(1, { mapping: '' })));
    target.dispatchEvent(evt('gamepaddisconnected', makePad(0)));
    assert.deepEqual(input.poll(16).events, ['connected', 'disconnected']);
    assert.deepEqual(input.poll(16).events, []);
    input.detach();
    target.dispatchEvent(evt('gamepadconnected', makePad(0)));
    assert.deepEqual(input.poll(16).events, []);
});

test('attach without a window or target is a safe no-op', () => {
    const { input } = setup();
    assert.equal(input.attach(null), false);
    input.detach();
});

test('a throwing getGamepads is treated as no pads', () => {
    const input = new GamepadInput({
        config: CONFIG,
        settings: { enabled: true },
        getGamepads: () => { throw new Error('blocked'); },
        now: () => 0
    });
    assert.deepEqual(input.poll(16).actions, []);
});

test('an analog trigger reported as pressed at a low value does not shoot', () => {
    const { input, pads } = setup();
    pads[0].buttons[7] = { pressed: true, value: 0.2 };
    const out = input.poll(16);
    assert.deepEqual(out.actions, []);
    assert.equal(out.active, false, 'a light trigger touch is not activity either');
    pads[0].buttons[7] = { pressed: true, value: 0.55 };
    assert.deepEqual(input.poll(16).actions, [A.SHOOT]);
});

test('a digital button still fires from pressed alone', () => {
    const { input, pads } = setup();
    pads[0].buttons[0] = { pressed: true, value: 0 };
    assert.deepEqual(input.poll(16).actions, [A.SHOOT]);
});

test('connection events are dropped while the controller setting is off', () => {
    const { input } = setup({ settings: { enabled: false } });
    const target = new EventTarget();
    input.attach(target);
    const evt = (type, gamepad) => Object.assign(new Event(type), { gamepad });
    target.dispatchEvent(evt('gamepadconnected', makePad(0)));
    target.dispatchEvent(evt('gamepaddisconnected', makePad(0)));
    input.settings.enabled = true;
    assert.deepEqual(input.poll(16).events, []);
});

test('events queued before the setting is turned off are not reported', () => {
    const { input } = setup();
    const target = new EventTarget();
    input.attach(target);
    target.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: makePad(0) }));
    input.settings.enabled = false;
    assert.deepEqual(input.poll(16).events, []);
});

test('only the pad in use going away is a pause-worthy disconnect', () => {
    const a = makePad(0);
    const b = makePad(1);
    const { input } = setup({ pads: [a, b] });
    const target = new EventTarget();
    input.attach(target);
    const evt = (type, gamepad) => Object.assign(new Event(type), { gamepad });
    press(b, 2);
    input.poll(16); // b is the active pad
    release(b, 2);
    target.dispatchEvent(evt('gamepaddisconnected', a));
    assert.deepEqual(input.poll(16).events, ['disconnectedOther']);
    target.dispatchEvent(evt('gamepaddisconnected', b));
    assert.deepEqual(input.poll(16).events, ['disconnected']);
});

test('a stick resting between the deadzone and the activity threshold is not activity', () => {
    const { input, pads } = setup();
    pads[0].axes[0] = 0.3;
    let out = input.poll(16);
    assert.equal(out.active, false);
    assert.ok(out.aimDelta > 0, 'the aim is still computed; the UI decides whether to apply it');
    pads[0].axes[0] = 0.5;
    out = input.poll(16);
    assert.equal(out.active, true);
});

test('the activity threshold never drops below the chosen deadzone', () => {
    const { input, pads } = setup({ settings: { deadzone: 0.5 } });
    pads[0].axes[0] = 0.45;
    assert.equal(input.poll(16).active, false);
    pads[0].axes[0] = 0.6;
    assert.equal(input.poll(16).active, true);
});

test('a drifting second pad does not take over the active pad', () => {
    const a = makePad(0);
    const b = makePad(1);
    const { input } = setup({ pads: [a, b] });
    press(a, 2);
    input.poll(16);
    release(a, 2);
    b.axes[0] = 0.3;
    assert.equal(input.poll(16).padIndex, 0);
});

test('D-pad fine steps respect invert X', () => {
    const { input, pads } = setup({ settings: { invertX: true } });
    press(pads[0], 15);
    const out = input.poll(16);
    assert.equal(out.aimSteps, 1);
    close(out.aimDelta, -CONFIG.fineStepRad);
});

test('the fine step falls back to the value given by the caller when the config has none', () => {
    const { fineStepRad, ...config } = CONFIG;
    const pad = makePad();
    const input = new GamepadInput({
        config, fineStepRad: 0.006, settings: { enabled: true }, getGamepads: () => [pad], now: () => 0
    });
    press(pad, 15);
    close(input.poll(16).aimDelta, 0.006);
    assert.equal(fineStepRad, 0.01);
});

test('with no pad connected a poll returns the shared idle result and only rescans at the idle interval', () => {
    let reads = 0;
    const time = { t: 0 };
    const input = new GamepadInput({
        config: CONFIG, settings: { enabled: true }, getGamepads: () => { reads += 1; return []; }, now: () => time.t
    });
    const first = input.poll(16);
    assert.equal(reads, 1, 'one initial scan');
    for (time.t = 16; time.t < 900; time.t += 16) {
        assert.equal(input.poll(16), first, 'same frozen object, nothing allocated');
    }
    assert.equal(reads, 1);
    time.t = 1000;
    input.poll(16);
    assert.equal(reads, 2, 'rescans once the interval has passed');
});

test('a connection event wakes the reader without waiting for the idle scan', () => {
    const list = [];
    const time = { t: 0 };
    const input = new GamepadInput({
        config: CONFIG, settings: { enabled: true }, getGamepads: () => list, now: () => time.t
    });
    const target = new EventTarget();
    input.attach(target);
    input.poll(16);
    const pad = makePad(0);
    list.push(pad);
    target.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
    press(pad, 2);
    time.t = 16;
    const out = input.poll(16);
    assert.deepEqual(out.events, ['connected']);
    assert.deepEqual(out.actions, [A.SWAP]);
});

test('the last pad going away is reported and then the reader goes idle', () => {
    const list = [makePad(0)];
    const input = new GamepadInput({
        config: CONFIG, settings: { enabled: true }, getGamepads: () => list, now: () => 0
    });
    const target = new EventTarget();
    input.attach(target);
    input.poll(16);
    const gone = list.pop();
    target.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: gone }));
    assert.deepEqual(input.poll(16).events, ['disconnected']);
    assert.deepEqual(input.poll(16).events, []);
});

// ---- poll() equivalence and pollAll() ----

// [time, frame ms, menuOpen, [[kind, pad, index, value]], pad removed]; kind b = button, a = axis.
const SCRIPT = [
    [0, 16, false, [], null],
    [16, 16, false, [['b', 0, 0, 1]], null],
    [32, 16, false, [['b', 0, 0, 0], ['a', 0, 0, 1]], null],
    [48, 16, false, [['a', 0, 0, -0.6], ['b', 0, 2, 1]], null],
    [64, 16, false, [['b', 0, 3, 1], ['b', 0, 6, 0.6], ['a', 0, 0, 0.9]], null],
    [80, 16, false, [['b', 0, 3, 0], ['b', 0, 6, 0], ['b', 0, 14, 1]], null],
    [96, 16, false, [['b', 0, 14, 1]], null],
    [500, 16, false, [['b', 0, 14, 0], ['b', 0, 9, 1], ['b', 0, 4, 1], ['a', 0, 2, 0.7]], null],
    [516, 16, true, [['b', 0, 9, 0], ['b', 0, 4, 0], ['a', 0, 2, 0], ['b', 1, 0, 0]], null],
    [532, 16, true, [['b', 0, 13, 1], ['b', 0, 0, 1]], null],
    [900, 16, true, [['b', 0, 13, 1]], null],
    [1020, 16, true, [['b', 0, 13, 1], ['b', 0, 1, 1], ['b', 0, 5, 1]], null],
    [1100, 16, true, [['b', 0, 13, 0], ['b', 0, 1, 0], ['b', 0, 5, 0], ['a', 0, 0, 0.9]], null],
    [1116, 16, false, [['a', 0, 0, 0], ['b', 1, 2, 1], ['b', 1, 10, 1], ['b', 1, 11, 1]], null],
    [1132, 16, false, [['b', 1, 2, 0], ['b', 1, 10, 0], ['b', 1, 11, 0], ['b', 1, 8, 1]], null],
    [1148, 16, false, [['b', 1, 8, 0]], 0],
    [1164, 16, false, [['b', 1, 0, 1]], null],
    [1180, 16, false, [['b', 1, 0, 0]], 1],
    [1196, 16, false, [], null],
    [3000, 16, false, [], null]
];

// Captured from poll() before pollAll() and _readPad() were extracted.
const POLL_BASELINE = JSON.parse('[{"actions":[],"aimDelta":0,"aimSteps":0,"active":false,"padIndex":0,"events":[]},{"actions":["shoot"],"aimDelta":0,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":[],"aimDelta":0.0352,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":["swap"],"aimDelta":-0.009234503271861984,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":["polarity"],"aimDelta":0.006784533016061867,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":[],"aimDelta":0.01713813206424747,"aimSteps":-1,"active":true,"padIndex":0,"events":[]},{"actions":[],"aimDelta":0.027138132064247467,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":["pause","specialPrev"],"aimDelta":0.02926143961927424,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":["navRight"],"aimDelta":0,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":["navDown","confirm"],"aimDelta":0,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":["navDown","navRight"],"aimDelta":0,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":["navDown","navRight","back","tabNext"],"aimDelta":0,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":[],"aimDelta":0,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":[],"aimDelta":0,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":[],"aimDelta":0,"aimSteps":0,"active":true,"padIndex":0,"events":[]},{"actions":[],"aimDelta":0,"aimSteps":0,"active":false,"padIndex":1,"events":["disconnected"]},{"actions":["shoot"],"aimDelta":0,"aimSteps":0,"active":true,"padIndex":1,"events":[]},{"actions":[],"aimDelta":0,"aimSteps":0,"active":false,"padIndex":-1,"events":["disconnected"]},{"actions":[],"aimDelta":0,"aimSteps":0,"active":false,"padIndex":-1,"events":[]},{"actions":[],"aimDelta":0,"aimSteps":0,"active":false,"padIndex":-1,"events":[]}]');

test('poll() output over a scripted two-pad sequence matches the pre-extraction implementation', () => {
    const time = { t: 0 };
    const list = [makePad(0), makePad(1)];
    const input = new GamepadInput({
        config: CONFIG,
        settings: { enabled: true, deadzone: 0.18, aimSpeed: 'normal', invertX: false },
        getGamepads: () => list,
        now: () => time.t
    });
    const target = new EventTarget();
    input.attach(target);
    const outs = [];
    for (const [t, dt, menuOpen, muts, gone] of SCRIPT) {
        time.t = t;
        for (const [kind, p, i, v] of muts) {
            const pad = list.find((x) => x.index === p);
            if (!pad) continue;
            if (kind === 'b') {
                const from = ANALOG_BUTTONS.includes(i) ? ANALOG_PRESSED_FROM : DIGITAL_PRESSED_FROM;
                pad.buttons[i] = { pressed: v >= from, value: v };
            } else {
                pad.axes[i] = v;
            }
        }
        if (gone !== null) {
            const at = list.findIndex((x) => x.index === gone);
            if (at >= 0) {
                const g = list.splice(at, 1)[0];
                target.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: g }));
            }
        }
        outs.push(input.poll(dt, { menuOpen }));
    }
    assert.deepEqual(JSON.parse(JSON.stringify(outs)), POLL_BASELINE);
});

const byIndex = (res, index) => res.pads.find((p) => p.padIndex === index);

test('pollAll primes a new pad: a button held on the first read produces no edge', () => {
    const { input, pads } = setup({ pads: [makePad(0)] });
    press(pads[0], 0);
    const first = input.pollAll(16);
    assert.deepEqual(byIndex(first, 0).actions, []);
    assert.deepEqual(input.pollAll(16).pads[0].actions, []);
    release(pads[0], 0);
    input.pollAll(16);
    press(pads[0], 0);
    assert.deepEqual(input.pollAll(16).pads[0].actions, [A.SHOOT]);
});

test('pollAll keeps independent edges per pad', () => {
    const { input, pads } = setup({ pads: [makePad(0), makePad(1)] });
    input.pollAll(16);
    press(pads[0], 0);
    let res = input.pollAll(16);
    assert.deepEqual(byIndex(res, 0).actions, [A.SHOOT]);
    assert.deepEqual(byIndex(res, 1).actions, []);
    press(pads[1], 2);
    res = input.pollAll(16);
    assert.deepEqual(byIndex(res, 0).actions, []);
    assert.deepEqual(byIndex(res, 1).actions, [A.SWAP]);
});

test('pollAll reports a per-pad aim delta, activity and id', () => {
    const { input, pads } = setup({ pads: [makePad(0, { id: 'Pad A' }), makePad(1, { id: 'Pad B' })] });
    input.pollAll(16);
    pads[1].axes[0] = 1;
    const res = input.pollAll(1000);
    assert.equal(byIndex(res, 0).aimDelta, 0);
    assert.equal(byIndex(res, 0).active, false);
    close(byIndex(res, 1).aimDelta, CONFIG.aimSpeedRadPerSec.normal);
    assert.equal(byIndex(res, 1).active, true);
    assert.equal(byIndex(res, 0).id, 'Pad A');
    assert.equal(byIndex(res, 1).id, 'Pad B');
});

test('pollAll menu navigation and confirm are tracked per pad', () => {
    const { input, pads, time } = setup({ pads: [makePad(0), makePad(1)] });
    input.pollAll(16, { menuOpen: true });
    press(pads[0], 13);
    time.t = 100;
    let res = input.pollAll(16, { menuOpen: true });
    assert.deepEqual(byIndex(res, 0).actions, [A.NAV_DOWN]);
    assert.deepEqual(byIndex(res, 1).actions, []);
    press(pads[1], 0);
    time.t = 116;
    res = input.pollAll(16, { menuOpen: true });
    assert.deepEqual(byIndex(res, 0).actions, []);
    assert.deepEqual(byIndex(res, 1).actions, [A.CONFIRM]);
});

test('pollAll events carry the pad index and id, and a returning pad is primed again', () => {
    const list = [makePad(0, { id: 'Pad A' }), makePad(1, { id: 'Pad B' })];
    const input = new GamepadInput({
        config: CONFIG, settings: { enabled: true }, getGamepads: () => list, now: () => 0
    });
    const target = new EventTarget();
    input.attach(target);
    input.pollAll(16);
    const gone = list.splice(1, 1)[0];
    target.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: gone }));
    let res = input.pollAll(16);
    assert.deepEqual(res.events, [{ type: 'disconnected', padIndex: 1, id: 'Pad B' }]);
    assert.equal(res.pads.length, 1);
    press(gone, 0);
    list.push(gone);
    target.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: gone }));
    res = input.pollAll(16);
    assert.deepEqual(res.events, [{ type: 'connected', padIndex: 1, id: 'Pad B' }]);
    assert.deepEqual(byIndex(res, 1).actions, []);
    assert.deepEqual(input.pollAll(16).events, []);
});

test('pollAll is idle when disabled or with no pad', () => {
    const off = setup({ settings: { enabled: false } });
    assert.deepEqual(off.input.pollAll(16), { pads: [], events: [] });
    const empty = setup({ pads: [] });
    assert.deepEqual(empty.input.pollAll(16), { pads: [], events: [] });
});

test('pollAll ignores non-standard pads', () => {
    const { input } = setup({ pads: [makePad(0, { mapping: '' })] });
    assert.deepEqual(input.pollAll(16).pads, []);
});

test('a button held across a poll to pollAll switch emits no edge', () => {
    const { input, pads } = setup({ pads: [makePad(0)] });
    input.poll(16);
    press(pads[0], 0);
    assert.deepEqual(input.poll(16).actions, [A.SHOOT]);
    assert.deepEqual(input.pollAll(16).pads[0].actions, []);
    assert.deepEqual(input.pollAll(16).pads[0].actions, []);
    release(pads[0], 0);
    input.pollAll(16);
    press(pads[0], 0);
    assert.deepEqual(input.pollAll(16).pads[0].actions, [A.SHOOT]);
});

test('a button held across a pollAll to poll switch emits no edge', () => {
    const { input, pads } = setup({ pads: [makePad(0)] });
    input.pollAll(16);
    press(pads[0], 0);
    assert.deepEqual(input.pollAll(16).pads[0].actions, [A.SHOOT]);
    assert.deepEqual(input.poll(16).actions, []);
    assert.deepEqual(input.poll(16).actions, []);
    release(pads[0], 0);
    input.poll(16);
    press(pads[0], 0);
    assert.deepEqual(input.poll(16).actions, [A.SHOOT]);
});

test('reopening the per-pad mode re-primes the pads', () => {
    const { input, pads } = setup({ pads: [makePad(0)] });
    input.poll(16);
    press(pads[0], 0);
    input.poll(16);
    input.pollAll(16);
    input.poll(16);
    assert.deepEqual(input.pollAll(16).pads[0].actions, []);
});

const RUMBLE_CONFIG = { ...CONFIG, rumble: { effectType: 'dual-rumble' } };
const RUMBLE_EFFECT = { durationMs: 100, startDelay: 0, weakMagnitude: 0.3, strongMagnitude: 0.5 };

function setupRumble({ settings = {}, actuator } = {}) {
  const calls = [];
  const pad = makePad(0, {
    vibrationActuator: actuator === undefined
      ? { playEffect: (type, effect) => { calls.push([type, effect]); return Promise.resolve('complete'); } }
      : actuator
  });
  const input = new GamepadInput({
    config: RUMBLE_CONFIG,
    settings: { enabled: true, deadzone: 0.18, aimSpeed: 'normal', invertX: false, ...settings },
    getGamepads: () => [pad]
  });
  return { input, calls };
}

test('rumble plays the configured effect type on the pad actuator', () => {
  const { input, calls } = setupRumble();
  assert.equal(input.rumble(0, RUMBLE_EFFECT), true);
  assert.deepEqual(calls, [['dual-rumble', RUMBLE_EFFECT]]);
});

test('rumble does nothing when the setting is off, the reader is disabled or the pad is unknown', () => {
  const off = setupRumble({ settings: { rumble: false } });
  assert.equal(off.input.rumble(0, RUMBLE_EFFECT), false);
  const disabled = setupRumble({ settings: { enabled: false } });
  assert.equal(disabled.input.rumble(0, RUMBLE_EFFECT), false);
  const other = setupRumble();
  assert.equal(other.input.rumble(3, RUMBLE_EFFECT), false);
  assert.equal(other.input.rumble(0, null), false);
  assert.equal(off.calls.length + disabled.calls.length + other.calls.length, 0);
});

test('rumble tolerates a pad without an actuator and an actuator that throws or rejects', () => {
  assert.equal(setupRumble({ actuator: null }).input.rumble(0, RUMBLE_EFFECT), false);
  assert.equal(setupRumble({ actuator: {} }).input.rumble(0, RUMBLE_EFFECT), false);
  const throwing = setupRumble({ actuator: { playEffect() { throw new Error('refused'); } } });
  assert.equal(throwing.input.rumble(0, RUMBLE_EFFECT), false);
  const rejecting = setupRumble({ actuator: { playEffect: () => Promise.reject(new Error('refused')) } });
  assert.equal(rejecting.input.rumble(0, RUMBLE_EFFECT), true);
});
