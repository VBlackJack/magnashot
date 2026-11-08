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
 * Pure helpers for the local two-player duel: split keyboard mapping and player slot
 * assignment. No DOM access; every function works on plain data.
 */

export const SIDES = Object.freeze(['left', 'right']);
export const EDGE_ACTIONS = Object.freeze(['shoot', 'swap', 'polarity', 'special']);
export const HELD_ROLES = Object.freeze(['aimLeft', 'aimRight', 'fine']);
export const DEVICE_TYPES = Object.freeze({
  PAD: 'pad',
  KEYBOARD: 'keyboard',
  KEYBOARD_MOUSE: 'keyboardMouse',
  TOUCH: 'touch',
});
export const POINTER_TYPES = Object.freeze({ MOUSE: 'mouse', TOUCH: 'touch', PEN: 'pen' });
export const SLOT_COUNT = 2;
const MS_PER_SECOND = 1000;

/**
 * Creates a split keyboard tracker.
 * @param {object} cfg `versus.local.keyboard` section.
 */
export function createSplitKeyboard(cfg) {
  const edgeMap = new Map();
  const heldMap = new Map();
  for (const side of SIDES) {
    const layout = cfg[side] ?? {};
    for (const action of EDGE_ACTIONS) {
      for (const code of layout[action] ?? []) edgeMap.set(code, { side, action });
    }
    for (const role of HELD_ROLES) {
      for (const code of layout[role] ?? []) heldMap.set(code, { side, role });
    }
  }
  const held = new Set();

  const isHeld = (side, role) => {
    for (const code of held) {
      const entry = heldMap.get(code);
      if (entry && entry.side === side && entry.role === role) return true;
    }
    return false;
  };

  return {
    /** Edge-triggered: returns {side, action} once per physical press, null otherwise. */
    keyDown(code, repeat = false) {
      if (heldMap.has(code)) {
        held.add(code);
        return null;
      }
      if (repeat || held.has(code)) return null;
      const edge = edgeMap.get(code);
      if (!edge) return null;
      held.add(code);
      return { side: edge.side, action: edge.action };
    },
    keyUp(code) {
      held.delete(code);
    },
    releaseAll() {
      held.clear();
    },
    /** Aim change in radians for the elapsed time, from the keys held for that side. */
    aimDelta(side, elapsedMs) {
      const dir = (isHeld(side, 'aimRight') ? 1 : 0) - (isHeld(side, 'aimLeft') ? 1 : 0);
      if (dir === 0) return 0;
      const factor = isHeld(side, 'fine') ? cfg.fineFactor : 1;
      return dir * cfg.aimRadPerSec * factor * (elapsedMs / MS_PER_SECOND);
    },
    /** True when the code belongs to the split layout (callers preventDefault on it). */
    isMapped(code) {
      return edgeMap.has(code) || heldMap.has(code);
    },
  };
}

/** Side whose join key matches the code, or null. */
export function joinSideForCode(cfg, code) {
  for (const side of SIDES) {
    if ((cfg[side]?.join ?? []).includes(code)) return side;
  }
  return null;
}

/** Fresh slot list: both slots empty. */
export function createSlots() {
  return Array.from({ length: SLOT_COUNT }, () => ({ device: null, padLost: false }));
}

const usesKeyboardSide = (device) =>
  device.type === DEVICE_TYPES.KEYBOARD || device.type === DEVICE_TYPES.KEYBOARD_MOUSE;

/** True when another slot already owns an exclusive device (pad index or keyboard half). */
function conflicts(slots, slotIndex, device) {
  return slots.some((slot, i) => {
    if (i === slotIndex || !slot.device) return false;
    if (device.type === DEVICE_TYPES.PAD) {
      return slot.device.type === DEVICE_TYPES.PAD && slot.device.padIndex === device.padIndex;
    }
    if (usesKeyboardSide(device) && usesKeyboardSide(slot.device)) {
      return slot.device.side === device.side;
    }
    return false;
  });
}

/** Assigns a device to a slot (replaces its device). Returns the same list when refused. */
export function joinSlot(slots, slotIndex, device) {
  if (!slots[slotIndex] || !device || conflicts(slots, slotIndex, device)) return slots;
  return slots.map((slot, i) => (i === slotIndex ? { device: { ...device }, padLost: false } : slot));
}

export function leaveSlot(slots, slotIndex) {
  if (!slots[slotIndex]) return slots;
  return slots.map((slot, i) => (i === slotIndex ? { device: null, padLost: false } : slot));
}

/** Index of the slot owning this pad, or -1. */
export function slotForPad(slots, padIndex) {
  return slots.findIndex(
    (slot) => slot.device?.type === DEVICE_TYPES.PAD && slot.device.padIndex === padIndex,
  );
}

/**
 * Gives an unassigned pad a slot: the first free slot, else the first slot whose pad was lost.
 * Returns the same list when the pad is already assigned or nothing is available.
 */
export function assignPad(slots, padIndex, id) {
  if (slotForPad(slots, padIndex) !== -1) return slots;
  let target = slots.findIndex((slot) => !slot.device);
  if (target === -1) target = slots.findIndex((slot) => slot.padLost);
  if (target === -1) return slots;
  return joinSlot(leaveSlot(slots, target), target, { type: DEVICE_TYPES.PAD, padIndex, id });
}

/** Flags the slot owning this pad as lost; the device record stays for display. */
export function markPadLost(slots, padIndex) {
  const index = slotForPad(slots, padIndex);
  if (index === -1) return slots;
  return slots.map((slot, i) => (i === index ? { ...slot, padLost: true } : slot));
}

/** Whether a canvas bound to this slot follows pointers of this type. */
export function acceptPointerForSlot(slot, slotIndex, pointerType) {
  const type = slot?.device?.type;
  if (pointerType === POINTER_TYPES.TOUCH || pointerType === POINTER_TYPES.PEN) {
    return type === DEVICE_TYPES.TOUCH;
  }
  if (pointerType === POINTER_TYPES.MOUSE) {
    return slotIndex === 0 && type === DEVICE_TYPES.KEYBOARD_MOUSE;
  }
  return false;
}

/**
 * Whether the viewport can show two boards side by side: wide enough, tall enough for the split
 * layout, and (when the canvas section is given) tall enough for a board of the minimum split
 * width once the bar, the board HUD and the padding (entry.reservedHeightPx) are taken off.
 * @param {number} vw - Viewport width.
 * @param {number} vh - Viewport height.
 * @param {{splitMinViewportHeightPx: number, splitMinBoardWidthPx?: number}} layoutCfg - versus.layout.
 * @param {{entry: {minViewportWidthPx: number, reservedHeightPx?: number}}} localCfg - versus.local.
 * @param {{logicalWidth: number, logicalHeight: number}} [canvasCfg] - The `canvas` section of the game config.
 */
export function canHostLocalDuel(vw, vh, layoutCfg, localCfg, canvasCfg) {
  if (vw < localCfg.entry.minViewportWidthPx || vh < layoutCfg.splitMinViewportHeightPx) {
    return false;
  }
  if (!canvasCfg || !layoutCfg.splitMinBoardWidthPx) {
    return true;
  }
  const boardWidth = ((vh - (localCfg.entry.reservedHeightPx ?? 0)) * canvasCfg.logicalWidth) / canvasCfg.logicalHeight;
  return boardWidth >= layoutCfg.splitMinBoardWidthPx;
}
