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
  DISCONNECTED: 'disconnected',
  /** A pad other than the one in use went away: worth a message, not a pause. */
  DISCONNECTED_OTHER: 'disconnectedOther'
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

/** Shared result of a poll that has nothing to report; never mutated by callers. */
const NO_EVENTS = Object.freeze([]);
const IDLE_RESULT = Object.freeze({
  actions: NO_EVENTS,
  aimDelta: 0,
  aimSteps: 0,
  active: false,
  padIndex: -1,
  events: NO_EVENTS
});

export class GamepadInput {
  /**
   * @param {object} opts
   * @param {object} opts.config gamepad config section
   * @param {object} opts.settings {enabled, deadzone, aimSpeed, invertX}; may be a live object
   * @param {Function} [opts.getGamepads] returns the pad list
   * @param {Function} [opts.now] millisecond clock
   * @param {number} [opts.fineStepRad] D-pad fine aim step, used when the config has none
   */
  constructor({ config, settings, getGamepads, now, fineStepRad } = {}) {
    this.config = config;
    this.fineStepRad = config.fineStepRad ?? fineStepRad ?? 0;
    this.analogButtons = new Set(config.analogButtons || []);
    this.connectedIndexes = new Set();
    this.hasScanned = false;
    this.lastScanAt = 0;
    this.settings = settings || {};
    this.getGamepads = getGamepads
      || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
    this.now = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.activeIndex = -1;
    this.keyStates = new Map();
    this.padStates = new Map();
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

  /**
   * Queue a connection event. Each entry keeps the single-pad classification in `legacyType`
   * (what poll() reports) and the raw `type` with the pad identity (what pollAll() reports).
   */
  _queueEvent(type, e) {
    if (!this.settings.enabled) return;
    const pad = e && e.gamepad;
    if (pad && pad.mapping !== STANDARD_MAPPING) return;
    const padIndex = pad ? pad.index : -1;
    const id = pad && typeof pad.id === 'string' ? pad.id : '';
    if (type === GAMEPAD_EVENTS.CONNECTED) {
      if (pad) this.connectedIndexes.add(pad.index);
      this.pendingEvents.push({ type, legacyType: type, padIndex, id });
      return;
    }
    if (pad) this.connectedIndexes.delete(pad.index);
    // Only the pad in use going away matters to the run; an unknown active pad counts as in use.
    const isActive = !pad || this.activeIndex < 0 || pad.index === this.activeIndex;
    this.pendingEvents.push({
      type,
      legacyType: isActive ? GAMEPAD_EVENTS.DISCONNECTED : GAMEPAD_EVENTS.DISCONNECTED_OTHER,
      padIndex,
      id
    });
    if (pad && pad.index === this.activeIndex) {
      this.activeIndex = -1;
    }
  }

  /**
   * True when a standard pad may be present. Known from connection events and one initial scan;
   * with none known, the pad list is only re-read at the idle scan interval, so a quiet frame
   * allocates nothing.
   */
  _mayHavePads(nowMs) {
    if (this.connectedIndexes.size > 0) return true;
    if (this.hasScanned && nowMs - this.lastScanAt < this.config.idleScanIntervalMs) return false;
    this.hasScanned = true;
    this.lastScanAt = nowMs;
    for (const pad of this._standardPads()) this.connectedIndexes.add(pad.index);
    return this.connectedIndexes.size > 0;
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

  _state(states, key) {
    let s = states.get(key);
    if (!s) {
      s = { down: false, nextAt: 0 };
      states.set(key, s);
    }
    return s;
  }

  _isAnalog(index, btn) {
    return this.analogButtons.has(index) && typeof btn.value === 'number';
  }

  /** Down state with press/release hysteresis, using the previous state stored under `key`. */
  _isDown(pad, states, key, indexes) {
    const wasDown = this._state(states, key).down;
    const threshold = wasDown ? this.config.triggerRelease : this.config.triggerPress;
    const list = Array.isArray(indexes) ? indexes : [indexes];
    for (const i of list) {
      const btn = pad.buttons ? pad.buttons[i] : null;
      if (!btn) continue;
      const v = this._buttonValue(pad, i);
      const above = wasDown ? v > threshold : v >= threshold;
      // Analog triggers report `pressed` from a very low value in some browsers: only the value decides.
      if (this._isAnalog(i, btn) ? above : (btn.pressed || above)) return true;
    }
    return false;
  }

  /** Store the new down state; returns true on a press edge. */
  _edge(states, key, down) {
    const s = this._state(states, key);
    const edge = down && !s.down;
    s.down = down;
    return edge;
  }

  /** Update a repeating input; returns true on press and on each repeat tick. */
  _repeat(states, key, down, nowMs) {
    const s = this._state(states, key);
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

  /** A press, or a stick pushed past the activity threshold (a drifting stick is not input). */
  _hasActivity(pad) {
    const threshold = Math.max(this._deadzone(), this.config.activityThreshold);
    const ax = this.config.axes;
    const buttons = pad.buttons || [];
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      if (!btn) continue;
      const isPressed = this._isAnalog(i, btn) ? false : btn.pressed;
      if (isPressed || btn.value >= this.config.triggerPress) return true;
    }
    return Math.hypot(this._axis(pad, ax.aimX), this._axis(pad, ax.menuY)) > threshold
      || Math.abs(this._axis(pad, ax.fineX)) > threshold;
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
   * Single-pad poll: the active pad drives everything, edge state lives in `this.keyStates`.
   * @param {number} elapsedMs frame time
   * @param {{menuOpen?: boolean}} [ctx]
   * @returns {{actions: string[], aimDelta: number, aimSteps: number, active: boolean, padIndex: number, events: string[]}}
   */
  poll(elapsedMs, ctx = {}) {
    const nowMs = this.now();
    const enabled = Boolean(this.settings.enabled);
    const hasEvents = enabled && this.pendingEvents.length > 0;
    const events = hasEvents ? this.pendingEvents.map((ev) => ev.legacyType) : NO_EVENTS;
    this.pendingEvents = [];
    if (!enabled) {
      this.keyStates.clear();
      this.activeIndex = -1;
      this.connectedIndexes.clear();
      this.hasScanned = false;
      return IDLE_RESULT;
    }
    const pads = this._mayHavePads(nowMs) ? this._standardPads() : [];
    if (pads.length === 0) {
      this.keyStates.clear();
      this.connectedIndexes.clear();
      if (!hasEvents) return IDLE_RESULT;
      return { ...IDLE_RESULT, actions: [], events };
    }
    const out = { actions: [], aimDelta: 0, aimSteps: 0, active: false, padIndex: -1, events };
    const { pad, activity } = this._pickActive(pads);
    out.active = activity;
    out.padIndex = pad.index;
    this._readPad(pad, this.keyStates, elapsedMs, ctx, nowMs, out);
    return out;
  }

  /**
   * Per-pad poll for local multiplayer: every standard pad is read with its own edge state.
   * A pad seen for the first time is primed: its first read only records held buttons, so no
   * action comes out of it.
   * @param {number} elapsedMs frame time
   * @param {{menuOpen?: boolean}} [ctx]
   * @returns {{pads: Array<{padIndex: number, id: string, actions: string[], aimDelta: number,
   *   aimSteps: number, active: boolean}>, events: Array<{type: string, padIndex: number, id: string}>}}
   */
  pollAll(elapsedMs, ctx = {}) {
    const nowMs = this.now();
    const enabled = Boolean(this.settings.enabled);
    const hasEvents = enabled && this.pendingEvents.length > 0;
    const events = hasEvents
      ? this.pendingEvents.map(({ type, padIndex, id }) => ({ type, padIndex, id }))
      : NO_EVENTS;
    for (const ev of events) {
      if (ev.type === GAMEPAD_EVENTS.DISCONNECTED) this.padStates.delete(ev.padIndex);
    }
    this.pendingEvents = [];
    if (!enabled) {
      this.padStates.clear();
      this.connectedIndexes.clear();
      this.hasScanned = false;
      return { pads: NO_EVENTS, events };
    }
    const pads = this._mayHavePads(nowMs) ? this._standardPads() : [];
    if (pads.length === 0) {
      this.padStates.clear();
      this.connectedIndexes.clear();
      return { pads: NO_EVENTS, events };
    }
    const present = new Set(pads.map((p) => p.index));
    for (const index of Array.from(this.padStates.keys())) {
      if (!present.has(index)) this.padStates.delete(index);
    }
    const results = [];
    for (const pad of pads) {
      let states = this.padStates.get(pad.index);
      const primed = !states;
      if (primed) {
        states = new Map();
        this.padStates.set(pad.index, states);
      }
      const out = {
        padIndex: pad.index,
        id: typeof pad.id === 'string' ? pad.id : '',
        actions: [],
        aimDelta: 0,
        aimSteps: 0,
        active: this._hasActivity(pad)
      };
      this._readPad(pad, states, elapsedMs, ctx, nowMs, out);
      if (primed) out.actions = [];
      results.push(out);
    }
    return { pads: results, events };
  }

  /**
   * Read one pad against the given edge states and fill `out` (actions, aimDelta, aimSteps).
   * @param {object} pad
   * @param {Map<string, {down: boolean, nextAt: number}>} states
   * @param {number} elapsedMs
   * @param {{menuOpen?: boolean}} ctx
   * @param {number} nowMs
   * @param {{actions: string[], aimDelta: number, aimSteps: number}} out
   */
  _readPad(pad, states, elapsedMs, ctx, nowMs, out) {
    const btns = this.config.buttons;
    const ax = this.config.axes;
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
      edge[key] = this._edge(states, key, this._isDown(pad, states, key, idx));
    }
    const dpad = {};
    for (const dir of Object.keys(NAV_ACTIONS)) {
      dpad[dir] = this._isDown(pad, states, `dpad:${dir}`, btns[dir]);
      this._edge(states, `dpad:${dir}`, dpad[dir]);
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
        if (this._repeat(states, `nav:${dir}`, navDown[dir], nowMs)) push(NAV_ACTIONS[dir]);
      }
      this._repeat(states, 'step:left', false, nowMs);
      this._repeat(states, 'step:right', false, nowMs);
      if (edge.confirm) push(A.CONFIRM);
      if (edge.back) push(A.BACK);
      if (edge.specialPrev) push(A.TAB_PREV);
      if (edge.specialNext) push(A.TAB_NEXT);
      return;
    }

    for (const dir of Object.keys(NAV_ACTIONS)) this._repeat(states, `nav:${dir}`, false, nowMs);
    if (edge.shoot) push(A.SHOOT);
    if (edge.swap) push(A.SWAP);
    if (edge.polarity) push(A.POLARITY);
    if (edge.back) push(A.UNEQUIP);
    if (edge.specialPrev) push(A.SPECIAL_PREV);
    if (edge.specialNext) push(A.SPECIAL_NEXT);
    if (edge.hint) push(A.HINT);
    if (edge.recenter) push(A.RECENTER);

    let steps = 0;
    if (this._repeat(states, 'step:left', dpad.left, nowMs)) steps -= 1;
    if (this._repeat(states, 'step:right', dpad.right, nowMs)) steps += 1;
    out.aimSteps = steps;

    const left = this._shapeStick(this._axis(pad, ax.aimX), this._axis(pad, ax.menuY));
    const fine = this._shapeStick(this._axis(pad, ax.fineX), 0);
    const precision = this._buttonValue(pad, btns.precision) > this.config.precisionTrigger
      ? this.config.precisionFactor : 1;
    const dt = Math.max(0, elapsedMs) / MS_PER_SECOND;
    const sign = this.settings.invertX ? -1 : 1;
    const analog = this._curve(left.x) + this._curve(fine.x) * this.config.fineAimFactor;
    out.aimDelta = sign * analog * this._speed() * dt * precision
      + sign * steps * this.fineStepRad;
  }
}
