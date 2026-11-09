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

import { GAME_STATES, INPUT_MODES, MATH_CONSTANTS, SPECIAL_TYPES_ORDER } from '../core/Constants.js';
import { GAMEPAD_ACTIONS, GAMEPAD_EVENTS } from '../core/GamepadInput.js';
import { t } from '../core/I18n.js';
import { slotForPad } from './LocalInput.js';
import { filterFocusTrapCandidates, GAMEPAD_HINT_KEYS, MODAL_FOCUSABLE_SELECTOR } from './UIHelpers.js';

const A = GAMEPAD_ACTIONS;

/** Class that keeps a visible focus ring on an element focused by the controller. */
export const PAD_FOCUS_CLASS = 'pad-focus';

/** Settings checkbox of the Vibration option (looked up here so the shared element map stays untouched). */
const GAMEPAD_RUMBLE_INPUT_ID = 'input-gamepad-rumble';

/** System-level request for less motion, honoured by vibration as well as the in-app setting. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Role of the container that holds the tabs of a dialog (Workshop, chapters, stats). */
const TABLIST_SELECTOR = '[role="tablist"]';
const TAB_SELECTOR = '[role="tab"]';

/** Navigation directions as unit steps on the screen axes (y grows downward). */
const NAV_VECTORS = Object.freeze({
  [A.NAV_UP]: { x: 0, y: -1 },
  [A.NAV_DOWN]: { x: 0, y: 1 },
  [A.NAV_LEFT]: { x: -1, y: 0 },
  [A.NAV_RIGHT]: { x: 1, y: 0 }
});

/** The direction that undoes each direction. */
const NAV_OPPOSITE = Object.freeze({
  [A.NAV_UP]: A.NAV_DOWN,
  [A.NAV_DOWN]: A.NAV_UP,
  [A.NAV_LEFT]: A.NAV_RIGHT,
  [A.NAV_RIGHT]: A.NAV_LEFT
});

/** Weight of the sideways offset against the distance along the pressed direction. */
const CROSS_AXIS_WEIGHT = 2;

/**
 * Centre of an element in viewport pixels, or null when the element has no layout box
 * (then navigation falls back to document order).
 */
function centerOf(el) {
  const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
  if (!rect || (!rect.width && !rect.height)) {
    return null;
  }
  return { x: rect.left + rect.width * MATH_CONSTANTS.HALF, y: rect.top + rect.height * MATH_CONSTANTS.HALF };
}

/**
 * Picks the focusable closest to `from` in the pressed direction. Returns the index in
 * `items`, or -1 when nothing lies that way.
 */
export function pickSpatialTarget(items, fromIndex, vector) {
  const origin = centerOf(items[fromIndex]);
  if (!origin) {
    return -1;
  }
  let best = -1;
  let bestScore = Infinity;
  let bestAlong = Infinity;
  let bestAcross = Infinity;
  for (let i = 0; i < items.length; i++) {
    if (i === fromIndex) {
      continue;
    }
    const c = centerOf(items[i]);
    if (!c) {
      continue;
    }
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const along = dx * vector.x + dy * vector.y;
    const across = Math.abs(dx * vector.y - dy * vector.x);
    if (along <= 0) {
      continue;
    }
    const score = along + across * CROSS_AXIS_WEIGHT;
    // Ties go to the shorter run along the pressed direction, then the smaller sideways offset;
    // a full tie keeps the earlier element in document order (strict comparisons).
    const isTieWin = score === bestScore && (along < bestAlong || (along === bestAlong && across < bestAcross));
    if (score < bestScore || isTieWin) {
      bestScore = score;
      bestAlong = along;
      bestAcross = across;
      best = i;
    }
  }
  return best;
}

/** Methods installed on UIManager.prototype by UIManager.js. */
export const uiGamepadMethods = {
  /** Gives the UI the controller reader created at boot. */
  setGamepadInput(gamepadInput) {
    this.gamepadInput = gamepadInput || null;
  },

  /**
   * Applies controller settings to the live reader; the stored values are written by the
   * Settings row before this is called.
   * @param {{enabled?: boolean, deadzone?: number, aimSpeed?: string, invertX?: boolean}} patch
   */
  updateGamepadSettings(patch) {
    if (this.gamepadInput) {
      Object.assign(this.gamepadInput.settings, patch);
    }
  },

  /**
   * Text variant used for hints written per input mode. The controller has its own wording for
   * the hint keys that list a gamepad variant; every other hint reads the pointer wording.
   */
  getHintInputMode(key) {
    if (this.inputMode !== INPUT_MODES.GAMEPAD) {
      return this.inputMode;
    }
    return GAMEPAD_HINT_KEYS.includes(key) ? INPUT_MODES.GAMEPAD : INPUT_MODES.POINTER;
  },

  /**
   * Short vibration on a pad for a match moment (configured under gamepad.rumble.effects).
   * Silent when the Vibration setting is off, reduced motion is on, or the pad cannot vibrate.
   * @param {string} kind - Key of gamepad.rumble.effects: charge, pulse or roundLost.
   * @param {number} padIndex - Pad to vibrate; a negative index means no pad.
   * @returns {boolean} True when an effect was sent.
   */
  rumbleGamepad(kind, padIndex) {
    const reader = this.gamepadInput;
    const effect = this.gameConfig.gamepad.rumble?.effects?.[kind];
    if (!reader || !effect || !(padIndex >= 0)) {
      return false;
    }
    const isSystemReduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(REDUCED_MOTION_QUERY).matches === true;
    if (!this.storageManager.getGamepadRumble?.() || this.storageManager.getReducedMotion?.() || isSystemReduced) {
      return false;
    }
    return reader.rumble(padIndex, effect);
  },

  /** Frame hook (GameLoop beforeFrame): reads the pad and routes what it produced. */
  pollGamepad(now, elapsedMs) {
    this.dropStalePadFocus();
    // The scene's own per-frame upkeep (held keys of the two-player match) needs no controller.
    const sceneController = this.getSceneController();
    sceneController?.beforeFrame?.(now, elapsedMs);
    const reader = this.gamepadInput;
    if (!reader) {
      return;
    }
    const isLobby = this.isVersusLocalLobbyOpen?.() === true;
    if (isLobby || sceneController?.multiPad === true) {
      this.pollGamepadPerPad(reader, elapsedMs, sceneController, isLobby);
      return;
    }
    const isMenuOpen = this.isAnyModalOpen() || this.isDrawerOpen;
    const result = reader.poll(elapsedMs, { menuOpen: isMenuOpen });
    if (result.events.length === 0 && result.actions.length === 0 && !result.active && result.aimDelta === 0) {
      return;
    }
    for (const event of result.events) {
      this.handleGamepadEvent(event);
    }
    if (result.active) {
      this.setInputMode(INPUT_MODES.GAMEPAD);
    }
    if (isMenuOpen) {
      this.routeGamepadMenuActions(result.actions);
    } else {
      this.routeGamepadGameplay(result);
    }
  },

  /**
   * Frame routing while the two-player lobby is open or a two-player match runs: every pad is read
   * on its own, so two pads never overwrite each other. In the lobby an unassigned pad joins; in
   * play each assigned pad steers its own board; with a dialog open each assigned pad moves around it
   * and an unassigned pad can take over the place of a controller that was lost.
   */
  pollGamepadPerPad(reader, elapsedMs, sceneController, isLobby) {
    const isMenuOpen = this.isAnyModalOpen() || this.isDrawerOpen;
    const results = reader.pollAll(elapsedMs, { menuOpen: isMenuOpen });
    const hasInput = results.pads.some((pad) => pad.active || pad.actions.length > 0 || pad.aimDelta !== 0);
    if (results.events.length === 0 && !hasInput) {
      return;
    }
    for (const event of results.events) {
      this.handleGamepadEvent(event.type);
      this.handleLocalPadEvent?.(event);
    }
    if (results.pads.some((pad) => pad.active)) {
      this.setInputMode(INPUT_MODES.GAMEPAD);
    }
    if (isLobby) {
      this.routeVersusLocalLobbyPads(results);
    } else if (isMenuOpen) {
      this.routeLocalMenuPads(results);
    } else {
      sceneController.handlePadResults(results);
    }
  },

  /** Dialog open during a two-player match: only the pads that hold a slot move around it. */
  routeLocalMenuPads(results) {
    const slots = this.getVersusLocalSlots?.() ?? [];
    for (const pad of results.pads) {
      if (pad.actions.length === 0) {
        continue;
      }
      if (slotForPad(slots, pad.padIndex) === -1) {
        if (pad.actions.includes(A.CONFIRM) || pad.actions.includes(A.SHOOT)) {
          this.takeOverLostPad?.(pad.padIndex, pad.id);
        }
        continue;
      }
      this.routeGamepadMenuActions(pad.actions);
    }
  },

  /** Toast and live region message for a pad that appeared or went away; a lost pad pauses the run. */
  handleGamepadEvent(event) {
    const isConnected = event === GAMEPAD_EVENTS.CONNECTED;
    const message = t(isConnected ? 'toast.gamepad.connected' : 'toast.gamepad.disconnected');
    this.showToast(message);
    this.announce(message);
    this.refreshControllerFields();
    if (event !== GAMEPAD_EVENTS.DISCONNECTED) {
      return;
    }
    const sceneController = this.getSceneController();
    if (sceneController?.multiPad === true) {
      // A two-player match knows which pad went away: handleLocalPadEvent pauses for an assigned one only.
      return;
    }
    if (sceneController) {
      sceneController.pause();
    } else if (this.engine.state === GAME_STATES.PLAYING) {
      this.engine.togglePause();
    }
  },

  /** Short visual message; the same text goes to the live region separately. */
  showToast(message) {
    const el = this.elements.toast;
    if (!el) {
      return;
    }
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      el.classList.add('hidden');
    }, this.gameConfig.gamepad.toastDurationMs);
  },

  /** Run controls: the same engine entry points the keyboard uses. */
  routeGamepadGameplay(result) {
    const sceneController = this.getSceneController();
    if (sceneController) {
      sceneController.handleGamepadActions(result.actions, result.aimDelta);
      return;
    }
    const engine = this.engine;
    // A stick resting slightly off centre must not steer the aim while the mouse or touch is in use.
    if (result.aimDelta !== 0 && this.inputMode === INPUT_MODES.GAMEPAD) {
      engine.adjustAimByDelta(result.aimDelta);
      this.updateAimState(engine);
    }
    for (const action of result.actions) {
      switch (action) {
        case A.SHOOT:
          engine.shoot();
          this.updateAimState(engine);
          break;
        case A.SWAP:
          engine.swapLauncherBalls();
          break;
        case A.POLARITY:
          engine.togglePolarityFlip();
          break;
        case A.UNEQUIP:
          if (engine.currentBall?.specialType) {
            engine.equipSpecialBall(engine.currentBall.specialType);
          }
          break;
        case A.SPECIAL_PREV:
          this.cycleSpecialBall(-1);
          break;
        case A.SPECIAL_NEXT:
          this.cycleSpecialBall(1);
          break;
        case A.PAUSE:
          engine.togglePause();
          break;
        case A.MENU:
          this.openDrawer();
          break;
        case A.HINT:
          engine.replayLevelHints?.();
          break;
        case A.RECENTER:
          engine.adjustAimByDelta(-Math.PI * MATH_CONSTANTS.HALF - engine.aimAngle);
          this.updateAimState(engine);
          break;
        default:
          break;
      }
    }
  },

  /**
   * Steps through the specials the player can equip right now (stocked or already loaded),
   * with "no special" as one more stop. The Shop is never opened from the pad.
   */
  cycleSpecialBall(step, engine = this.engine) {
    const equipped = engine.currentBall?.specialType ?? null;
    const stops = [null, ...SPECIAL_TYPES_ORDER].filter(
      (type) => type === null || type === equipped || (engine.specialInventory?.[type] || 0) > 0
    );
    const index = Math.max(0, stops.indexOf(equipped));
    const next = stops[(index + step + stops.length) % stops.length];
    if (next === equipped) {
      return;
    }
    engine.equipSpecialBall(next === null ? equipped : next);
  },

  /** True when the Pause dialog is the top layer, i.e. Start should resume rather than be ignored. */
  isPauseDialogTop() {
    return Boolean(this.elements.modalPause) && this.getActiveTopModal() === this.elements.modalPause;
  },

  /** Menu controls: focus moves among the top layer, confirm clicks, back unwinds. */
  routeGamepadMenuActions(actions) {
    for (const action of actions) {
      if (NAV_VECTORS[action]) {
        this.moveMenuFocus(action);
      } else if (action === A.CONFIRM) {
        this.confirmMenuFocus();
      } else if (action === A.BACK) {
        this.handleBackAction();
      } else if (action === A.TAB_PREV) {
        this.cycleMenuTab(-1);
      } else if (action === A.TAB_NEXT) {
        this.cycleMenuTab(1);
      } else if (action === A.PAUSE && this.isVersusPauseTop()) {
        this.resumeVersus();
      } else if (action === A.PAUSE && this.isPauseDialogTop()) {
        this.engine.togglePause();
      } else if (action === A.MENU && this.isDrawerOpen && !this.isAnyModalOpen()) {
        this.closeDrawer({ resume: true });
      }
    }
  },

  /** The layer the pad moves in: the top dialog, else the open menu. */
  getMenuRoot() {
    return this.getActiveTopModal() || (this.isDrawerOpen ? this.elements.drawer : null);
  },

  getMenuFocusables(root) {
    return filterFocusTrapCandidates(root.querySelectorAll(MODAL_FOCUSABLE_SELECTOR));
  },

  /** Real DOM focus plus a ring that survives browsers that hide :focus-visible after a pad press. */
  focusFromPad(el) {
    if (this.padFocusEl && this.padFocusEl !== el) {
      this.padFocusEl.classList?.remove(PAD_FOCUS_CLASS);
    }
    this.padFocusEl = el;
    el.classList?.add(PAD_FOCUS_CLASS);
    el.focus();
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  },

  /** Focus left the ringed element (another control, a closed dialog): the ring goes with it. */
  handlePadFocusOut(event) {
    if (this.padFocusEl && event?.target === this.padFocusEl) {
      this.clearPadFocus();
    }
  },

  /** Safety net for a dialog that closes without a focusout: the ring never outlives the focus. */
  dropStalePadFocus() {
    if (this.padFocusEl && typeof document !== 'undefined' && document.activeElement !== this.padFocusEl) {
      this.clearPadFocus();
    }
  },

  /** Drops the pad ring once the player goes back to the keyboard or a pointer. */
  clearPadFocus() {
    if (this.padFocusEl) {
      this.padFocusEl.classList?.remove(PAD_FOCUS_CLASS);
      this.padFocusEl = null;
    }
  },

  moveMenuFocus(action) {
    const root = this.getMenuRoot();
    if (!root) {
      return;
    }
    const items = this.getMenuFocusables(root);
    if (items.length === 0) {
      return;
    }
    const current = items.indexOf(document.activeElement);
    if (current < 0) {
      this.focusFromPad(items[0]);
      return;
    }
    const focused = items[current];
    const vector = NAV_VECTORS[action];
    if (focused.tagName === 'SELECT' && vector.x !== 0) {
      this.stepSelect(focused, vector.x);
      return;
    }
    const last = this.padLastMove;
    if (last && last.to === focused && NAV_OPPOSITE[action] === last.action && items.includes(last.from)) {
      // The opposite press undoes the previous move, so down then up always comes back.
      this.padLastMove = { from: focused, to: last.from, action };
      this.focusFromPad(last.from);
      return;
    }
    let target = pickSpatialTarget(items, current, vector);
    if (target < 0) {
      const forward = vector.x + vector.y > 0;
      target = Math.min(items.length - 1, Math.max(0, current + (forward ? 1 : -1)));
    }
    if (target !== current) {
      this.padLastMove = { from: focused, to: items[target], action };
      this.focusFromPad(items[target]);
    }
  },

  /** A select changes value with left and right, like a stepper. */
  stepSelect(select, direction) {
    const next = Math.min(select.options.length - 1, Math.max(0, select.selectedIndex + direction));
    if (next === select.selectedIndex) {
      return;
    }
    select.selectedIndex = next;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  },

  confirmMenuFocus() {
    const root = this.getMenuRoot();
    if (!root) {
      return;
    }
    const active = document.activeElement;
    if (active && root.contains(active) && active !== root) {
      active.click();
      return;
    }
    const items = this.getMenuFocusables(root);
    if (items.length > 0) {
      this.focusFromPad(items[0]);
    }
  },

  /** Bumpers switch the tab of the nearest tab list (Workshop, chapters, stats). */
  cycleMenuTab(step) {
    const root = this.getMenuRoot();
    if (!root) {
      return;
    }
    const active = document.activeElement;
    const lists = Array.from(root.querySelectorAll(TABLIST_SELECTOR)).filter(
      (list) => filterFocusTrapCandidates([list]).length > 0 || list.getClientRects?.().length > 0
    );
    if (lists.length === 0) {
      return;
    }
    const list = (active && active.closest?.(TABLIST_SELECTOR)) || this.nearestTabList(lists, active);
    const tabs = Array.from(list.querySelectorAll(TAB_SELECTOR)).filter((tab) => !tab.disabled);
    if (tabs.length === 0) {
      return;
    }
    const selected = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const next = tabs[(Math.max(0, selected) + step + tabs.length) % tabs.length];
    next.click();
    this.focusFromPad(next);
  },

  /** The tab list closest to the focused element, or the first one when nothing is focused. */
  nearestTabList(lists, focused) {
    const from = focused ? centerOf(focused) : null;
    if (!from) {
      return lists[0];
    }
    let best = lists[0];
    let bestDistance = Infinity;
    for (const list of lists) {
      const c = centerOf(list);
      const distance = c ? Math.hypot(c.x - from.x, c.y - from.y) : Infinity;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = list;
      }
    }
    return best;
  },

  /** Fills the Settings controller row from storage and wires it to storage and the live reader. */
  setupGamepadControls() {
    document.addEventListener('focusout', (event) => this.handlePadFocusOut(event));
    const el = this.elements;
    if (!el.inputGamepadEnabled) {
      return;
    }
    el.inputGamepadEnabled.addEventListener('change', () => {
      this.storageManager.setGamepadEnabled(el.inputGamepadEnabled.checked);
      this.updateGamepadSettings({ enabled: el.inputGamepadEnabled.checked });
    });
    el.selectGamepadDeadzone?.addEventListener('change', () => {
      const value = Number.parseFloat(el.selectGamepadDeadzone.value);
      this.storageManager.setGamepadDeadzone(value);
      this.updateGamepadSettings({ deadzone: this.storageManager.getGamepadDeadzone() });
    });
    el.selectGamepadAimSpeed?.addEventListener('change', () => {
      this.storageManager.setGamepadAimSpeed(el.selectGamepadAimSpeed.value);
      this.updateGamepadSettings({ aimSpeed: this.storageManager.getGamepadAimSpeed() });
    });
    el.inputGamepadInvertX?.addEventListener('change', () => {
      this.storageManager.setGamepadInvertX(el.inputGamepadInvertX.checked);
      this.updateGamepadSettings({ invertX: el.inputGamepadInvertX.checked });
    });
    el.inputGamepadRumble = document.getElementById?.(GAMEPAD_RUMBLE_INPUT_ID) ?? null;
    el.inputGamepadRumble?.addEventListener('change', () => {
      this.storageManager.setGamepadRumble(el.inputGamepadRumble.checked);
      this.updateGamepadSettings({ rumble: el.inputGamepadRumble.checked });
      this.audioManager?.setVibrationEnabled?.(el.inputGamepadRumble.checked);
    });
    this.audioManager?.setVibrationEnabled?.(this.storageManager.getGamepadRumble());
    this.updateGamepadControls();
    this.refreshControllerFields();
  },

  /** @returns {boolean} Whether the browser reports at least one connected controller. */
  hasConnectedGamepad() {
    try {
      const pads = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : null;
      return Array.from(pads ?? []).some((pad) => pad && pad.connected !== false);
    } catch {
      return false;
    }
  },

  /** Shows the controller fields only while a pad is connected, else the no-controller message. */
  refreshControllerFields() {
    const connected = this.hasConnectedGamepad();
    this.elements.settingsControllerFields?.classList.toggle('hidden', !connected);
    this.elements.settingsControllerNoPad?.classList.toggle('hidden', connected);
  },

  /** Rebuilds the option labels (language change) and shows the stored values. */
  updateGamepadControls() {
    const el = this.elements;
    const cfg = this.gameConfig.gamepad;
    if (!el.inputGamepadEnabled) {
      return;
    }
    el.inputGamepadEnabled.checked = this.storageManager.getGamepadEnabled();
    if (el.inputGamepadInvertX) {
      el.inputGamepadInvertX.checked = this.storageManager.getGamepadInvertX();
    }
    if (el.inputGamepadRumble) {
      el.inputGamepadRumble.checked = this.storageManager.getGamepadRumble();
    }
    const fill = (select, entries, selectedValue) => {
      if (!select) {
        return;
      }
      select.replaceChildren(
        ...entries.map(({ value, label }) => {
          const option = document.createElement('option');
          option.value = String(value);
          option.textContent = label;
          return option;
        })
      );
      select.value = String(selectedValue);
    };
    fill(
      el.selectGamepadDeadzone,
      cfg.deadzoneOptions.map((value, i) => ({
        value,
        label: t(`modals.settings.controller.deadzoneOptions.${cfg.deadzoneLabelKeys[i]}`)
      })),
      this.storageManager.getGamepadDeadzone()
    );
    fill(
      el.selectGamepadAimSpeed,
      Object.keys(cfg.aimSpeedRadPerSec).map((value) => ({
        value,
        label: t(`modals.settings.controller.aimSpeedOptions.${value}`)
      })),
      this.storageManager.getGamepadAimSpeed()
    );
  }
};
