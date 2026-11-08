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

/**
 * Gamepad polling: standard-mapping pads only, pure and injectable.
 * Turns raw pad state into discrete actions (press edges, auto-repeat in
 * menus), a continuous aim delta and connection events. All thresholds,
 * button indexes and axes come from the `gamepad` config section.
 */

export const GAMEPAD_ACTIONS = Object.freeze({
    SHOOT: 'shoot',
    SWAP: 'swap',
    POLARITY: 'polarity',
    UNEQUIP: 'unequip',
    SPECIAL_PREV: 'specialPrev',
    SPECIAL_NEXT: 'specialNext',
    PAUSE: 'pause',
    MENU: 'menu',
    HINT: 'hint',
    RECENTER: 'recenter',
    NAV_UP: 'navUp',
    NAV_DOWN: 'navDown',
    NAV_LEFT: 'navLeft',
    NAV_RIGHT: 'navRight',
    CONFIRM: 'confirm',
    BACK: 'back',
    TAB_PREV: 'tabPrev',
    TAB_NEXT: 'tabNext'
});

export const GAMEPAD_EVENTS = Object.freeze({
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected'
});

const STANDARD_MAPPING = 'standard';
const MS_PER_SECOND = 1000;
const A = GAMEPAD_ACTIONS;

const NAV_ACTIONS = Object.freeze({
    up: A.NAV_UP,
    down: A.NAV_DOWN,
    left: A.NAV_LEFT,
    right: A.NAV_RIGHT
});

export class GamepadInput {
    /**
     * @param {object} opts
     * @param {object} opts.config gamepad config section
     * @param {object} opts.settings {enabled, deadzone, aimSpeed, invertX}; may be a live object
     * @param {Function} [opts.getGamepads] returns the pad list
     * @param {Function} [opts.now] millisecond clock
     */
    constructor({ config, settings, getGamepads, now } = {}) {
        this.config = config;
        this.settings = settings || {};
        this.getGamepads = getGamepads
            || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
        this.now = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
        this.activeIndex = -1;
        this.keyStates = new Map();
        this.pendingEvents = [];
        this._target = null;
        this._onConnected = (e) => this._queueEvent(GAMEPAD_EVENTS.CONNECTED, e);
        this._onDisconnected = (e) => this._queueEvent(GAMEPAD_EVENTS.DISCONNECTED, e);
    }

    /** Register connection listeners. Returns false when no event target exists (Node). */
    attach(target = (typeof window !== 'undefined' ? window : null)) {
        if (!target || typeof target.addEventListener !== 'function') return false;
        this.detach();
        target.addEventListener('gamepadconnected', this._onConnected);
        target.addEventListener('gamepaddisconnected', this._onDisconnected);
        this._target = target;
        return true;
    }

    detach() {
        if (!this._target) return;
        this._target.removeEventListener('gamepadconnected', this._onConnected);
        this._target.removeEventListener('gamepaddisconnected', this._onDisconnected);
        this._target = null;
    }

    _queueEvent(type, e) {
        const pad = e && e.gamepad;
        if (pad && pad.mapping !== STANDARD_MAPPING) return;
        this.pendingEvents.push(type);
        if (type === GAMEPAD_EVENTS.DISCONNECTED && pad && pad.index === this.activeIndex) {
            this.activeIndex = -1;
        }
    }

    _standardPads() {
        let list;
        try { list = this.getGamepads() || []; } catch { list = []; }
        const pads = [];
        for (const pad of Array.from(list)) {
            if (pad && pad.connected !== false && pad.mapping === STANDARD_MAPPING) pads.push(pad);
        }
        return pads;
    }

    _deadzone() {
        const dz = Number(this.settings.deadzone);
        return Number.isFinite(dz) ? dz : this.config.defaultDeadzone;
    }

    _speed() {
        const s = this.settings.aimSpeed;
        const table = this.config.aimSpeedRadPerSec;
        if (typeof s === 'number') return s;
        return table[s] ?? table.normal;
    }

    _axis(pad, index) {
        const v = pad.axes ? pad.axes[index] : 0;
        return Number.isFinite(v) ? v : 0;
    }

    _buttonValue(pad, index) {
        const btn = pad.buttons ? pad.buttons[index] : null;
        if (!btn) return 0;
        if (typeof btn.value === 'number' && btn.value > 0) return btn.value;
        return btn.pressed ? 1 : 0;
    }

    _state(key) {
        let s = this.keyStates.get(key);
        if (!s) {
            s = { down: false, nextAt: 0 };
            this.keyStates.set(key, s);
        }
        return s;
    }

    /** Down state with press/release hysteresis, using the previous state stored under `key`. */
    _isDown(pad, key, indexes) {
        const wasDown = this._state(key).down;
        const threshold = wasDown ? this.config.triggerRelease : this.config.triggerPress;
        const list = Array.isArray(indexes) ? indexes : [indexes];
        for (const i of list) {
            const btn = pad.buttons ? pad.buttons[i] : null;
            if (!btn) continue;
            const v = this._buttonValue(pad, i);
            if (btn.pressed || (wasDown ? v > threshold : v >= threshold)) return true;
        }
        return false;
    }

    /** Store the new down state; returns true on a press edge. */
    _edge(key, down) {
        const s = this._state(key);
        const edge = down && !s.down;
        s.down = down;
        return edge;
    }

    /** Update a repeating input; returns true on press and on each repeat tick. */
    _repeat(key, down, nowMs) {
        const s = this._state(key);
        const { initialDelayMs, intervalMs } = this.config.menuRepeat;
        let fire = false;
        if (down && !s.down) {
            fire = true;
            s.nextAt = nowMs + initialDelayMs;
        } else if (down && nowMs >= s.nextAt) {
            fire = true;
            s.nextAt = nowMs + intervalMs;
        }
        s.down = down;
        return fire;
    }

    _hasActivity(pad) {
        const dz = this._deadzone();
        const ax = this.config.axes;
        for (const btn of pad.buttons || []) {
            if (btn && (btn.pressed || btn.value >= this.config.triggerPress)) return true;
        }
        return Math.abs(this._axis(pad, ax.aimX)) > dz
            || Math.abs(this._axis(pad, ax.menuY)) > dz
            || Math.abs(this._axis(pad, ax.fineX)) > dz;
    }

    /** Active pad = the one with input right now, else the previous one, else the first. */
    _pickActive(pads) {
        const current = pads.find((p) => p.index === this.activeIndex);
        const busy = pads.filter((p) => this._hasActivity(p));
        if (busy.length > 0) {
            this.activeIndex = (current && busy.includes(current) ? current : busy[0]).index;
            return { pad: pads.find((p) => p.index === this.activeIndex), activity: true };
        }
        if (current) return { pad: current, activity: false };
        this.activeIndex = pads[0].index;
        return { pad: pads[0], activity: false };
    }

    /** Radial deadzone with rescale; returns the shaped {x, y} in [-1, 1]. */
    _shapeStick(x, y) {
        const dz = this._deadzone();
        const mag = Math.hypot(x, y);
        if (mag <= dz || mag === 0) return { x: 0, y: 0 };
        const scaled = Math.min(1, (mag - dz) / (1 - dz));
        return { x: (x / mag) * scaled, y: (y / mag) * scaled };
    }

    _curve(v) {
        return Math.sign(v) * Math.abs(v) ** this.config.responseExponent;
    }

    /**
     * @param {number} elapsedMs frame time
     * @param {{menuOpen?: boolean}} [ctx]
     * @returns {{actions: string[], aimDelta: number, aimSteps: number, active: boolean, padIndex: number, events: string[]}}
     */
    poll(elapsedMs, ctx = {}) {
        const events = this.pendingEvents;
        this.pendingEvents = [];
        const out = { actions: [], aimDelta: 0, aimSteps: 0, active: false, padIndex: -1, events };
        const pads = this.settings.enabled ? this._standardPads() : [];
        if (pads.length === 0) {
            this.keyStates.clear();
            if (!this.settings.enabled) this.activeIndex = -1;
            return out;
        }
        const { pad, activity } = this._pickActive(pads);
        out.active = activity;
        out.padIndex = pad.index;

        const btns = this.config.buttons;
        const ax = this.config.axes;
        const nowMs = this.now();
        const push = (action) => out.actions.push(action);

        // Edge state is updated for every input on every poll so a press never carries over a context switch.
        const edge = {};
        const defs = {
            shoot: btns.shoot,
            confirm: btns.shoot[0],
            back: btns.back,
            swap: btns.swap,
            polarity: btns.polarity,
            specialPrev: btns.specialPrev,
            specialNext: btns.specialNext,
            menu: btns.menu,
            pause: btns.pause,
            hint: btns.hint,
            recenter: btns.recenter
        };
        for (const [key, idx] of Object.entries(defs)) {
            edge[key] = this._edge(key, this._isDown(pad, key, idx));
        }
        const dpad = {};
        for (const dir of Object.keys(NAV_ACTIONS)) {
            dpad[dir] = this._isDown(pad, `dpad:${dir}`, btns[dir]);
            this._edge(`dpad:${dir}`, dpad[dir]);
        }

        if (edge.pause) push(A.PAUSE);
        if (edge.menu) push(A.MENU);

        if (ctx.menuOpen) {
            const t = this.config.stickMenuThreshold;
            const x = this._axis(pad, ax.aimX);
            const y = this._axis(pad, ax.menuY);
            const navDown = {
                up: dpad.up || y < -t,
                down: dpad.down || y > t,
                left: dpad.left || x < -t,
                right: dpad.right || x > t
            };
            for (const dir of Object.keys(NAV_ACTIONS)) {
                if (this._repeat(`nav:${dir}`, navDown[dir], nowMs)) push(NAV_ACTIONS[dir]);
            }
            this._repeat('step:left', false, nowMs);
            this._repeat('step:right', false, nowMs);
            if (edge.confirm) push(A.CONFIRM);
            if (edge.back) push(A.BACK);
            if (edge.specialPrev) push(A.TAB_PREV);
            if (edge.specialNext) push(A.TAB_NEXT);
            return out;
        }

        for (const dir of Object.keys(NAV_ACTIONS)) this._repeat(`nav:${dir}`, false, nowMs);
        if (edge.shoot) push(A.SHOOT);
        if (edge.swap) push(A.SWAP);
        if (edge.polarity) push(A.POLARITY);
        if (edge.back) push(A.UNEQUIP);
        if (edge.specialPrev) push(A.SPECIAL_PREV);
        if (edge.specialNext) push(A.SPECIAL_NEXT);
        if (edge.hint) push(A.HINT);
        if (edge.recenter) push(A.RECENTER);

        let steps = 0;
        if (this._repeat('step:left', dpad.left, nowMs)) steps -= 1;
        if (this._repeat('step:right', dpad.right, nowMs)) steps += 1;
        out.aimSteps = steps;

        const left = this._shapeStick(this._axis(pad, ax.aimX), this._axis(pad, ax.menuY));
        const fine = this._shapeStick(this._axis(pad, ax.fineX), 0);
        const precision = this._buttonValue(pad, btns.precision) > this.config.precisionTrigger
            ? this.config.precisionFactor : 1;
        const dt = Math.max(0, elapsedMs) / MS_PER_SECOND;
        const sign = this.settings.invertX ? -1 : 1;
        const analog = this._curve(left.x) + this._curve(fine.x) * this.config.fineAimFactor;
        out.aimDelta = sign * analog * this._speed() * dt * precision
            + steps * (this.config.fineStepRad || 0);
        return out;
    }
}
