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

import {
  createSplitKeyboard,
  joinSideForCode,
  createSlots,
  joinSlot,
  leaveSlot,
  assignPad,
  markPadLost,
  slotForPad,
  acceptPointerForSlot,
  canHostLocalDuel,
} from '../src/ui/LocalInput.js';

const KB = {
  left: {
    aimLeft: ['KeyA'], aimRight: ['KeyD'], fine: ['ShiftLeft'], shoot: ['KeyW'],
    swap: ['KeyS'], polarity: ['KeyQ'], special: ['KeyE'], join: ['KeyW'],
  },
  right: {
    aimLeft: ['ArrowLeft'], aimRight: ['ArrowRight'], fine: ['ShiftRight'],
    shoot: ['Enter', 'NumpadEnter'], swap: ['ArrowDown'], polarity: ['Slash', 'NumpadDivide'],
    special: ['Period', 'NumpadDecimal'], join: ['ArrowUp'],
  },
  aimRadPerSec: 1.8,
  fineFactor: 0.2,
};
const LOCAL = { entry: { minViewportWidthPx: 680 } };
const LAYOUT = { splitMinViewportHeightPx: 480 };
const ELAPSED_MS = 500;
const MS_PER_SECOND = 1000;
const EPSILON = 1e-9;
const RATE = KB.aimRadPerSec * (ELAPSED_MS / MS_PER_SECOND);

test('codes map to side and action, including numpad aliases', () => {
  const kb = createSplitKeyboard(KB);
  assert.deepEqual(kb.keyDown('KeyW'), { side: 'left', action: 'shoot' });
  assert.deepEqual(kb.keyDown('KeyS'), { side: 'left', action: 'swap' });
  assert.deepEqual(kb.keyDown('KeyQ'), { side: 'left', action: 'polarity' });
  assert.deepEqual(kb.keyDown('KeyE'), { side: 'left', action: 'special' });
  assert.deepEqual(kb.keyDown('Enter'), { side: 'right', action: 'shoot' });
  assert.deepEqual(kb.keyDown('NumpadEnter'), { side: 'right', action: 'shoot' });
  assert.deepEqual(kb.keyDown('NumpadDivide'), { side: 'right', action: 'polarity' });
  assert.deepEqual(kb.keyDown('NumpadDecimal'), { side: 'right', action: 'special' });
  assert.equal(kb.keyDown('Space'), null);
  assert.equal(kb.keyDown('KeyA'), null, 'held keys produce no edge');
});

test('repeats are ignored and a held key fires one edge', () => {
  const kb = createSplitKeyboard(KB);
  assert.deepEqual(kb.keyDown('KeyW', false), { side: 'left', action: 'shoot' });
  assert.equal(kb.keyDown('KeyW', true), null);
  assert.equal(kb.keyDown('KeyW', false), null);
  kb.keyUp('KeyW');
  assert.deepEqual(kb.keyDown('KeyW', false), { side: 'left', action: 'shoot' });
});

test('both sides aim at once from held keys', () => {
  const kb = createSplitKeyboard(KB);
  kb.keyDown('KeyD');
  kb.keyDown('ArrowLeft');
  assert.ok(Math.abs(kb.aimDelta('left', ELAPSED_MS) - RATE) < EPSILON);
  assert.ok(Math.abs(kb.aimDelta('right', ELAPSED_MS) + RATE) < EPSILON);
});

test('opposite keys cancel and idle aim is zero', () => {
  const kb = createSplitKeyboard(KB);
  assert.equal(kb.aimDelta('left', ELAPSED_MS), 0);
  kb.keyDown('KeyA');
  kb.keyDown('KeyD');
  assert.equal(kb.aimDelta('left', ELAPSED_MS), 0);
});

test('fine key scales aim by the fine factor, per code side', () => {
  const kb = createSplitKeyboard(KB);
  kb.keyDown('KeyD');
  kb.keyDown('ShiftRight');
  assert.ok(Math.abs(kb.aimDelta('left', ELAPSED_MS) - RATE) < EPSILON, 'right shift does not affect left');
  kb.keyDown('ShiftLeft');
  assert.ok(Math.abs(kb.aimDelta('left', ELAPSED_MS) - RATE * KB.fineFactor) < EPSILON);
});

test('keyUp stops aim and releaseAll clears everything', () => {
  const kb = createSplitKeyboard(KB);
  kb.keyDown('KeyD');
  kb.keyUp('KeyD');
  assert.equal(kb.aimDelta('left', ELAPSED_MS), 0);
  kb.keyDown('KeyD');
  kb.keyDown('ArrowRight');
  kb.keyDown('KeyW');
  kb.releaseAll();
  assert.equal(kb.aimDelta('left', ELAPSED_MS), 0);
  assert.equal(kb.aimDelta('right', ELAPSED_MS), 0);
  assert.deepEqual(kb.keyDown('KeyW'), { side: 'left', action: 'shoot' }, 'edge fires again after release');
});

test('join keys resolve to a side', () => {
  assert.equal(joinSideForCode(KB, 'KeyW'), 'left');
  assert.equal(joinSideForCode(KB, 'ArrowUp'), 'right');
  assert.equal(joinSideForCode(KB, 'KeyZ'), null);
});

test('slots: join, leave and exclusive devices', () => {
  let slots = createSlots();
  assert.equal(slots.length, 2);
  slots = joinSlot(slots, 0, { type: 'keyboard', side: 'left' });
  assert.equal(slots[0].device.side, 'left');
  assert.equal(joinSlot(slots, 1, { type: 'keyboardMouse', side: 'left' }), slots, 'left keys already taken');
  slots = joinSlot(slots, 1, { type: 'keyboard', side: 'right' });
  assert.equal(slots[1].device.side, 'right');
  slots = leaveSlot(slots, 0);
  assert.equal(slots[0].device, null);
  slots = joinSlot(slots, 0, { type: 'touch' });
  slots = joinSlot(slots, 1, { type: 'touch' });
  assert.equal(slots[1].device.type, 'touch', 'touch is not exclusive');
});

test('assignPad joins the first free slot and ignores known pads', () => {
  let slots = assignPad(createSlots(), 3, 'pad-x');
  assert.equal(slotForPad(slots, 3), 0);
  assert.equal(assignPad(slots, 3, 'pad-x'), slots);
  slots = joinSlot(slots, 1, { type: 'keyboard', side: 'right' });
  assert.equal(assignPad(slots, 4, 'pad-y'), slots, 'no free or lost slot');
  const withKeys = joinSlot(createSlots(), 0, { type: 'keyboard', side: 'left' });
  assert.equal(slotForPad(assignPad(withKeys, 2, 'pad-z'), 2), 1);
});

test('lost pad slot is taken over by the next pad', () => {
  let slots = assignPad(assignPad(createSlots(), 0, 'pad-a'), 1, 'pad-b');
  slots = markPadLost(slots, 1);
  assert.equal(slots[1].padLost, true);
  assert.equal(slots[1].device.padIndex, 1, 'device kept for display');
  assert.equal(slots[0].padLost, false);
  slots = assignPad(slots, 5, 'pad-new');
  assert.equal(slotForPad(slots, 5), 1);
  assert.equal(slots[1].padLost, false);
  assert.equal(slotForPad(slots, 1), -1);
  assert.equal(markPadLost(slots, 9), slots, 'unknown pad is a no-op');
});

test('pointer filter: touch and pen need a touch slot, mouse only P1 keyboardMouse', () => {
  const touch = { device: { type: 'touch' } };
  const km = { device: { type: 'keyboardMouse', side: 'left' } };
  const kb = { device: { type: 'keyboard', side: 'right' } };
  assert.equal(acceptPointerForSlot(touch, 1, 'touch'), true);
  assert.equal(acceptPointerForSlot(touch, 0, 'pen'), true);
  assert.equal(acceptPointerForSlot(touch, 0, 'mouse'), false);
  assert.equal(acceptPointerForSlot(km, 0, 'mouse'), true);
  assert.equal(acceptPointerForSlot(km, 1, 'mouse'), false);
  assert.equal(acceptPointerForSlot(km, 0, 'touch'), false);
  assert.equal(acceptPointerForSlot(kb, 1, 'mouse'), false);
  assert.equal(acceptPointerForSlot({ device: null }, 0, 'mouse'), false);
});

test('canHostLocalDuel checks width and height thresholds', () => {
  assert.equal(canHostLocalDuel(680, 480, LAYOUT, LOCAL), true);
  assert.equal(canHostLocalDuel(679, 800, LAYOUT, LOCAL), false);
  assert.equal(canHostLocalDuel(1200, 479, LAYOUT, LOCAL), false);
});
