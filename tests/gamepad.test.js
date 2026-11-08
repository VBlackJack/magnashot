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

function press(pad, i, value = 1) {
    pad.buttons[i] = { pressed: value >= 0.5, value };
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
