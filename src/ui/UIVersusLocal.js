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
 * Polarity Duel, two players on one device: the entry in the tier picker, the lobby where each
 * player picks a device (keyboard half, keyboard and mouse, touch, or a controller that joins by
 * pressing a button) and the handicap, and the device wording shared with the match screen. The
 * match itself runs in UIVersus.js; the pure slot rules live in LocalInput.js.
 */

import { GAMEPAD_ACTIONS } from '../core/GamepadInput.js';
import { t } from '../core/I18n.js';
import {
  DEVICE_TYPES,
  SIDES,
  SLOT_COUNT,
  assignPad,
  canHostLocalDuel,
  createSlots,
  joinSideForCode,
  joinSlot,
  leaveSlot,
  slotForPad
} from './LocalInput.js';
import { isAriaDisabled, isBrowserShortcut, scheduleNextFrame } from './UIHelpers.js';

const A = GAMEPAD_ACTIONS;
const HIDDEN_CLASS = 'hidden';
const FIRST_PLAYER_NUMBER = 1;
const JUST_JOINED_CLASS = 'just-joined';
/** Duration of the join pulse; the stylesheet's own animation is shorter and removed by reduced motion. */
const JOIN_PULSE_MS = 600;
const SLOT_SELECTOR = '.versus-local-slot';
const BADGE_SELECTOR = '.versus-badge';
const NEED_TWO_ID = 'versus-local-need-two';

/** Message key suffix (under versus.local.device) that names a device. */
export function localDeviceKey(device) {
  switch (device?.type) {
    case DEVICE_TYPES.PAD:
      return 'pad';
    case DEVICE_TYPES.KEYBOARD_MOUSE:
      return 'keyboardMouse';
    case DEVICE_TYPES.TOUCH:
      return 'touch';
    case DEVICE_TYPES.KEYBOARD:
      return device.side === SIDES[1] ? 'keyboardRight' : 'keyboardLeft';
    default:
      return null;
  }
}

/** Translated name of a device, or an empty string for a free slot. */
export function describeLocalDevice(device, translate = t) {
  const key = localDeviceKey(device);
  return key ? translate(`versus.local.device.${key}`) : '';
}

/**
 * The devices a slot can be switched to by the Change device button, in cycling order. Controllers
 * are not listed: they join by pressing a button. Player 1 owns the left half of the keyboard (and
 * the mouse), player 2 the right half.
 * @param {number} slotIndex - 0 or 1.
 * @returns {Array<object>} Device records.
 */
export function selectableLocalDevices(slotIndex) {
  const side = SIDES[slotIndex];
  if (slotIndex === 0) {
    return [
      { type: DEVICE_TYPES.KEYBOARD, side },
      { type: DEVICE_TYPES.KEYBOARD_MOUSE, side },
      { type: DEVICE_TYPES.TOUCH }
    ];
  }
  return [{ type: DEVICE_TYPES.KEYBOARD, side }, { type: DEVICE_TYPES.TOUCH }];
}

/** Whether the slot list lets the match start: both players hold a device. */
export function areLocalSlotsReady(slots) {
  return slots.length === SLOT_COUNT && slots.every((slot) => Boolean(slot.device));
}

/** Methods installed on UIManager.prototype by UIManager.js. */
export const uiVersusLocalMethods = {
  /** Fresh lobby state: nobody joined, no handicap. */
  createVersusLocalState() {
    return { slots: createSlots(), handicaps: Array.from({ length: SLOT_COUNT }, () => 0), layoutMap: null };
  },

  /** True while the two-player lobby is the dialog on top of the duel pickers. */
  isVersusLocalLobbyOpen() {
    const modal = this.elements.modalVersusLocal;
    return Boolean(modal) && !modal.classList.contains(HIDDEN_CLASS);
  },

  /** True when the viewport can show two boards side by side. */
  canHostVersusLocal() {
    if (typeof window === 'undefined') {
      return false;
    }
    const versusCfg = this.gameConfig.versus;
    return canHostLocalDuel(window.innerWidth, window.innerHeight, versusCfg.layout, versusCfg.local);
  },

  /** Shows the two-player entry of the tier picker only when two boards fit (hidden, not disabled). */
  syncVersusLocalEntry() {
    const button = this.elements.btnVersusLocal;
    if (!button) {
      return;
    }
    const fits = this.canHostVersusLocal();
    button.classList.toggle(HIDDEN_CLASS, !fits);
    // A lobby left open while the window shrinks closes with its entry.
    if (!fits && this.isVersusLocalLobbyOpen()) {
      this.closeVersusLocalLobby();
    }
  },

  bindVersusLocalEvents() {
    const els = this.elements;
    this.versusLocal = this.versusLocal ?? this.createVersusLocalState();
    els.btnVersusLocal?.addEventListener('click', () => this.openVersusLocalLobby());
    els.btnVersusLocalBack?.addEventListener('click', () => this.closeVersusLocalLobby());
    els.btnVersusLocalStart?.addEventListener('click', () => this.startVersusLocal());
    els.btnVersusChangePlayers?.addEventListener('click', () => this.changeVersusPlayers());
    for (const slotEl of this.getVersusLocalSlotElements()) {
      const index = Number.parseInt(slotEl.dataset.slot, 10);
      slotEl.querySelector('.versus-local-change')?.addEventListener('click', () => this.cycleVersusLocalDevice(index));
      slotEl.querySelector('.versus-local-leave')?.addEventListener('click', () => this.leaveVersusLocalSlot(index));
      slotEl.querySelector('.versus-local-handicap')?.addEventListener('change', (event) => {
        this.versusLocal.handicaps[index] = Number.parseInt(event.target.value, 10) || 0;
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (event) => this.handleVersusLocalLobbyKey(event));
      for (const type of ['resize', 'orientationchange']) {
        window.addEventListener(type, () => {
          if (this.isVersusTierPickerOpen()) {
            this.syncVersusLocalEntry();
          }
        });
      }
    }
    // Key names follow the layout in use (AZERTY shows Z where QWERTY shows W); QWERTY names are the fallback.
    const keyboard = typeof navigator !== 'undefined' ? navigator.keyboard : null;
    keyboard?.getLayoutMap?.().then(
      (map) => {
        this.versusLocal.layoutMap = map;
        if (this.isVersusLocalLobbyOpen()) {
          this.renderVersusLocalLobby();
        }
      },
      () => {}
    );
  },

  getVersusLocalSlotElements() {
    const modal = this.elements.modalVersusLocal;
    return modal ? Array.from(modal.querySelectorAll(SLOT_SELECTOR)) : [];
  },

  /** Name of a key as the player reads it: the layout's own letter, else the configured name. */
  describeLocalKey(code) {
    const mapped = this.versusLocal?.layoutMap?.get?.(code);
    if (mapped) {
      return mapped.length === 1 ? mapped.toUpperCase() : mapped;
    }
    return this.gameConfig.versus.local.keyboard.labels?.[code] ?? code;
  },

  /**
   * Opens the lobby over the tier picker.
   * @param {{keep?: boolean}} [options] - keep: reopen with the same devices (Change players).
   */
  openVersusLocalLobby({ keep = false } = {}) {
    const modal = this.elements.modalVersusLocal;
    if (!modal || !this.canHostVersusLocal()) {
      return;
    }
    if (!keep || !this.versusLocal) {
      this.versusLocal = { ...this.createVersusLocalState(), layoutMap: this.versusLocal?.layoutMap ?? null };
    } else {
      // A controller that went away since the last match cannot be kept.
      this.versusLocal.slots = this.versusLocal.slots.map((slot) => (slot.padLost ? { device: null, padLost: false } : slot));
    }
    this.renderVersusLocalLobby();
    const first = this.getVersusLocalSlotElements()[0]?.querySelector('.versus-local-change');
    this.openOverlayModal(modal, first || this.elements.btnVersusLocalBack);
  },

  /** Closes the lobby; focus goes back to the entry button of the picker. */
  closeVersusLocalLobby() {
    this.stackedModalOpener = this.elements.btnVersusLocal;
    this.closeOverlayModal(this.elements.modalVersusLocal);
  },

  /** Escape and the controller's back button while the lobby is up. Returns true when handled. */
  handleVersusLocalLobbyBack() {
    if (!this.isVersusLocalLobbyOpen()) {
      return false;
    }
    this.closeVersusLocalLobby();
    return true;
  },

  /** Writes the lobby from its state: statuses, hints, buttons, handicap lists. */
  renderVersusLocalLobby() {
    const state = this.versusLocal;
    const cfg = this.gameConfig.versus.local;
    const els = this.elements;
    this.getVersusLocalSlotElements().forEach((slotEl, index) => {
      const slot = state.slots[index];
      const n = index + FIRST_PLAYER_NUMBER;
      const isJoined = Boolean(slot.device);
      slotEl.dataset.joined = String(isJoined);
      const name = slotEl.querySelector('.versus-local-slot-name');
      if (name) {
        name.textContent = t('versus.local.lobby.player', { n });
      }
      const badge = slotEl.querySelector(BADGE_SELECTOR);
      if (badge) {
        badge.textContent = String(n);
      }
      const status = slotEl.querySelector('.versus-local-status');
      if (status) {
        status.dataset.state = isJoined ? 'joined' : 'empty';
        status.textContent = isJoined
          ? t('versus.local.lobby.joined', { n, device: describeLocalDevice(slot.device) })
          : t('versus.local.lobby.slotPress');
      }
      const hint = slotEl.querySelector('.versus-local-join-hint');
      if (hint) {
        const joinCode = cfg.keyboard[SIDES[index]].join[0];
        hint.textContent = isJoined
          ? ''
          : `${t('versus.local.lobby.joinKeys', { key: this.describeLocalKey(joinCode) })} ${t('versus.local.lobby.joinPad')}`;
        hint.classList.toggle(HIDDEN_CLASS, isJoined);
      }
      const change = slotEl.querySelector('.versus-local-change');
      if (change) {
        change.textContent = t('versus.local.lobby.change');
      }
      const leave = slotEl.querySelector('.versus-local-leave');
      if (leave) {
        leave.textContent = t('versus.local.lobby.leave');
      }
      const label = slotEl.querySelector('.versus-local-handicap-text');
      if (label) {
        label.textContent = t('versus.local.lobby.handicap');
      }
      const select = slotEl.querySelector('.versus-local-handicap');
      if (select) {
        select.replaceChildren(
          ...cfg.handicap.labelKeys.map((labelKey, optionIndex) => {
            const option = document.createElement('option');
            option.value = String(optionIndex);
            option.textContent = t(`versus.local.handicap.${labelKey}`);
            return option;
          })
        );
        select.value = String(state.handicaps[index] ?? 0);
      }
    });
    const ready = areLocalSlotsReady(state.slots);
    els.btnVersusLocalStart?.setAttribute('aria-disabled', String(!ready));
    els.versusLocalNeedTwo?.classList.toggle(HIDDEN_CLASS, ready);
    if (ready) {
      els.btnVersusLocalStart?.removeAttribute('aria-describedby');
    } else {
      els.btnVersusLocalStart?.setAttribute('aria-describedby', NEED_TWO_ID);
    }
  },

  /** Says something in the lobby's own polite live region (the page behind the dialog is inert). */
  announceVersusLocal(message) {
    const region = this.elements.versusLocalLive;
    if (!region || !message) {
      return;
    }
    region.textContent = '';
    scheduleNextFrame(() => {
      region.textContent = message;
    });
  },

  /** Gives a slot a device (quick join, Change device, controller press) and tells everyone. */
  joinVersusLocalSlot(slotIndex, device) {
    const state = this.versusLocal;
    const next = joinSlot(state.slots, slotIndex, device);
    if (next === state.slots) {
      return false;
    }
    state.slots = next;
    this.renderVersusLocalLobby();
    this.pulseVersusLocalSlot(slotIndex);
    this.announceVersusLocal(
      t('versus.local.announce.joined', { n: slotIndex + FIRST_PLAYER_NUMBER, device: describeLocalDevice(device) })
    );
    return true;
  },

  /** A short ring on the slot that just joined; reduced motion removes the animation itself. */
  pulseVersusLocalSlot(slotIndex) {
    const slotEl = this.getVersusLocalSlotElements()[slotIndex];
    if (!slotEl) {
      return;
    }
    slotEl.classList.add(JUST_JOINED_CLASS);
    setTimeout(() => slotEl.classList.remove(JUST_JOINED_CLASS), JOIN_PULSE_MS);
  },

  leaveVersusLocalSlot(slotIndex) {
    const state = this.versusLocal;
    if (!state.slots[slotIndex]?.device) {
      return;
    }
    state.slots = leaveSlot(state.slots, slotIndex);
    this.renderVersusLocalLobby();
    this.announceVersusLocal(t('versus.local.announce.left', { n: slotIndex + FIRST_PLAYER_NUMBER }));
  },

  /** Change device: the next device the slot can use; an empty slot takes the first one. */
  cycleVersusLocalDevice(slotIndex) {
    const options = selectableLocalDevices(slotIndex);
    const current = this.versusLocal.slots[slotIndex].device;
    const at = options.findIndex(
      (device) => device.type === current?.type && (device.side === undefined || device.side === current?.side)
    );
    this.joinVersusLocalSlot(slotIndex, options[(at + 1) % options.length]);
  },

  /** Quick join by key: W takes the left half of the keyboard for player 1, Up the right half for player 2. */
  handleVersusLocalLobbyKey(event) {
    if (!this.isVersusLocalLobbyOpen() || event.repeat || isBrowserShortcut(event)) {
      return;
    }
    const side = joinSideForCode(this.gameConfig.versus.local.keyboard, event.code);
    if (!side) {
      return;
    }
    // A list or a text field keeps its own arrow keys.
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active?.tagName === 'SELECT' || active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') {
      return;
    }
    const slotIndex = SIDES.indexOf(side);
    if (this.versusLocal.slots[slotIndex].device) {
      return;
    }
    event.preventDefault();
    this.joinVersusLocalSlot(slotIndex, selectableLocalDevices(slotIndex)[0]);
  },

  /** A controller button joined the lobby: the first free slot takes that pad. */
  joinVersusLocalPad(padIndex, id) {
    const state = this.versusLocal;
    if (slotForPad(state.slots, padIndex) !== -1) {
      return false;
    }
    const next = assignPad(state.slots, padIndex, id);
    if (next === state.slots) {
      return false;
    }
    const slotIndex = slotForPad(next, padIndex);
    state.slots = next;
    this.renderVersusLocalLobby();
    this.pulseVersusLocalSlot(slotIndex);
    this.announceVersusLocal(
      t('versus.local.announce.joined', { n: slotIndex + FIRST_PLAYER_NUMBER, device: describeLocalDevice(next[slotIndex].device) })
    );
    return true;
  },

  /**
   * What each pad does while the lobby is open: an unassigned pad joins with the confirm button
   * (or closes the lobby with back while nobody has joined), an assigned pad moves around the
   * dialog, and its back button frees its slot.
   * @param {{pads: Array<{padIndex: number, id: string, actions: string[]}>}} results - GamepadInput.pollAll.
   */
  routeVersusLocalLobbyPads(results) {
    const state = this.versusLocal;
    for (const pad of results.pads) {
      if (pad.actions.length === 0) {
        continue;
      }
      const slotIndex = slotForPad(state.slots, pad.padIndex);
      if (slotIndex === -1) {
        if (pad.actions.includes(A.CONFIRM)) {
          this.joinVersusLocalPad(pad.padIndex, pad.id);
        } else if (pad.actions.includes(A.BACK) && state.slots.every((slot) => !slot.device)) {
          this.closeVersusLocalLobby();
        }
        continue;
      }
      const menuActions = [];
      for (const action of pad.actions) {
        if (action === A.BACK) {
          this.leaveVersusLocalSlot(slotIndex);
        } else {
          menuActions.push(action);
        }
      }
      this.routeGamepadMenuActions(menuActions);
    }
  },

  /** A controller went away in the lobby: its slot is freed. */
  handleVersusLocalLobbyPadLost(padIndex) {
    const slotIndex = slotForPad(this.versusLocal.slots, padIndex);
    if (slotIndex !== -1) {
      this.leaveVersusLocalSlot(slotIndex);
    }
  },

  /** Start match: both players must hold a device. */
  startVersusLocal() {
    const button = this.elements.btnVersusLocalStart;
    if (isAriaDisabled(button)) {
      this.announceVersusLocal(t('versus.local.lobby.needTwo'));
      return;
    }
    const state = this.versusLocal;
    const multipliers = this.gameConfig.versus.local.handicap.riseMultipliers;
    this.enterVersus({
      kind: 'local',
      slots: state.slots.map((slot) => ({ ...slot, device: { ...slot.device } })),
      riseMultipliers: state.handicaps.map((index) => multipliers[index] ?? multipliers[0])
    });
  },

  /** Language switch: the lobby and the entry are written again. */
  refreshVersusLocalLanguage() {
    if (this.isVersusLocalLobbyOpen()) {
      this.renderVersusLocalLobby();
    }
  }
};
