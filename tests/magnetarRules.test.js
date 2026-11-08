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

import { SeededRandom } from '../src/core/SeededRandom.js';
import {
  MAGNETAR_BEHAVIOURS,
  MAGNETAR_MODES,
  MAGNETAR_PHASES,
  advanceSchedule,
  advanceTurnCharges,
  behavioursForTier,
  createScheduleState,
  drawBehaviour,
  fallReward,
  findMoorings,
  pickMooringToSnap,
  planBarrage,
  regrowSlots,
  tierFor
} from '../src/game/MagnetarRules.js';

// Spec values of the magnetar section.
const cfg = {
  maxTier: 4,
  fluxStagesPerTier: 5,
  cadenceByTier: { 1: 3, 2: 3, 3: 2, 4: 2 },
  tierUnlocks: { 1: ['invert', 'undertow'], 2: ['regrow'], 3: ['barrage'], 4: [] },
  regrow: { count: 3, maxShells: 8 },
  barrage: { countByTier: { 3: 2, 4: 3 }, strongFromTier: 4, strongChance: 0.5, riseTurns: 2 },
  fall: { pointsBase: 900, pointsPerSphere: 40, coins: 40, landslideMin: 20 }
};

const STEPS = 200;
const RADIUS = 20;
const RING_SLOTS = 12;

function ball(id, x, y, isAnchor = false) {
  return { id, x, y, isAnchor, bonds: new Set() };
}

function bond(a, b) {
  a.bonds.add(b.id);
  b.bonds.add(a.id);
}

function world(list) {
  return { balls: list, ballMap: new Map(list.map((b) => [b.id, b])) };
}

function runSchedule(tier, key) {
  let state = createScheduleState(tier, cfg);
  const log = [];
  for (let i = 0; i < STEPS; i++) {
    const result = advanceSchedule(state, cfg, key);
    state = result.state;
    log.push([result.armed, result.acted]);
  }
  return log;
}

test('tierFor maps Boss Rush waves and Flux stages, clamped', () => {
  assert.equal(tierFor(MAGNETAR_MODES.BOSS_RUSH, 1, cfg), 1);
  assert.equal(tierFor(MAGNETAR_MODES.BOSS_RUSH, 3, cfg), 3);
  assert.equal(tierFor(MAGNETAR_MODES.BOSS_RUSH, 9, cfg), 4);
  assert.equal(tierFor(MAGNETAR_MODES.FLUX, 5, cfg), 1);
  assert.equal(tierFor(MAGNETAR_MODES.FLUX, 10, cfg), 2);
  assert.equal(tierFor(MAGNETAR_MODES.FLUX, 100, cfg), 4);
  assert.equal(tierFor(MAGNETAR_MODES.FLUX, 2, cfg), 1);
});

test('tier sets are cumulative', () => {
  assert.deepEqual(behavioursForTier(1, cfg), ['invert', 'undertow']);
  assert.deepEqual(behavioursForTier(2, cfg), ['invert', 'undertow', 'regrow']);
  assert.deepEqual(behavioursForTier(3, cfg), ['invert', 'undertow', 'regrow', 'barrage']);
  assert.deepEqual(behavioursForTier(4, cfg), behavioursForTier(3, cfg));
  assert.deepEqual(Object.values(MAGNETAR_BEHAVIOURS).sort(), behavioursForTier(4, cfg).sort());
});

test('same key gives the same schedule over 200 steps, another key differs', () => {
  const a = runSchedule(3, 'bossRush:magnetar:3');
  const b = runSchedule(3, 'bossRush:magnetar:3');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, runSchedule(3, 'bossRush:magnetar:4'));
});

test('a behaviour never repeats twice in a row and stays inside the tier set', () => {
  for (const tier of [1, 2, 3, 4]) {
    const allowed = behavioursForTier(tier, cfg);
    const acted = runSchedule(tier, `k:${tier}`).map(([, a]) => a).filter(Boolean);
    assert.ok(acted.length > 10);
    for (let i = 0; i < acted.length; i++) {
      assert.ok(allowed.includes(acted[i]));
      if (i > 0) {
        assert.notEqual(acted[i], acted[i - 1]);
      }
    }
  }
});

test('warning comes one turn before the action, after the cadence rest', () => {
  for (const tier of [1, 3]) {
    let state = createScheduleState(tier, cfg);
    const cadence = cfg.cadenceByTier[tier];
    for (let turn = 1; turn < cadence; turn++) {
      const r = advanceSchedule(state, cfg, 'w');
      assert.equal(r.armed, null);
      assert.equal(r.acted, null);
      state = r.state;
    }
    const warn = advanceSchedule(state, cfg, 'w');
    assert.ok(warn.armed);
    assert.equal(warn.acted, null);
    assert.equal(warn.state.phase, MAGNETAR_PHASES.ARMED);
    const act = advanceSchedule(warn.state, cfg, 'w');
    assert.equal(act.acted, warn.armed);
    assert.equal(act.armed, null);
    assert.equal(act.state.phase, MAGNETAR_PHASES.REST);
    assert.equal(act.state.restLeft, cadence);
  }
});

test('advanceSchedule does not mutate its input', () => {
  const state = createScheduleState(2, cfg);
  const frozen = JSON.stringify(state);
  advanceSchedule(state, cfg, 'x');
  assert.equal(JSON.stringify(state), frozen);
});

test('drawBehaviour avoids the previous one and handles empty sets', () => {
  assert.equal(drawBehaviour('k', 0, [], null), null);
  assert.equal(drawBehaviour('k', 0, ['invert'], 'invert'), 'invert');
  for (let step = 0; step < 50; step++) {
    assert.notEqual(drawBehaviour('k', step, ['invert', 'undertow'], 'invert'), 'invert');
  }
});

test('findMoorings walks bonds to anchors, ignores the rest, lowest id first', () => {
  const m = ball(10, 0, 0);
  const a2 = ball(7, 1, 0, true);
  const mid = ball(11, 2, 0);
  const a1 = ball(3, 3, 0, true);
  const stray = ball(4, 9, 9, true);
  const plain = ball(5, 5, 5);
  bond(m, a2);
  bond(m, mid);
  bond(mid, a1);
  bond(plain, stray);
  const { balls, ballMap } = world([m, a2, mid, a1, stray, plain]);
  assert.deepEqual(findMoorings(balls, ballMap, 10), [3, 7]);
  assert.deepEqual(findMoorings(balls, ballMap, 999), []);
});

test('Moorings never increase when bonds are removed', () => {
  const m = ball(1, 0, 0);
  const anchors = [2, 3, 4, 5].map((id) => ball(id, id, 0, true));
  anchors.forEach((a) => bond(m, a));
  const all = [m, ...anchors];
  const { ballMap } = world(all);
  let previous = findMoorings(all, ballMap, 1).length;
  assert.equal(previous, 4);
  for (const a of anchors) {
    a.bonds.delete(1);
    m.bonds.delete(a.id);
    const now = findMoorings(all, ballMap, 1).length;
    assert.ok(now <= previous);
    previous = now;
  }
  assert.equal(previous, 0);
});

test('a ball removed from the live list no longer counts as a Mooring', () => {
  const m = ball(1, 0, 0);
  const a = ball(2, 1, 0, true);
  bond(m, a);
  const { ballMap } = world([m, a]);
  assert.deepEqual(findMoorings([m], ballMap, 1), []);
});

test('pickMooringToSnap takes the lowest id', () => {
  assert.equal(pickMooringToSnap([9, 4, 6]), 4);
  assert.equal(pickMooringToSnap([]), null);
});

test('regrowSlots returns free, non-overlapping, non-anchor slots next to the Magnetar', () => {
  const m = ball(1, 200, 200);
  const blocker = ball(2, 200 + RADIUS * 2, 200);
  const { balls } = world([m, blocker]);
  const slots = regrowSlots(m, balls, RADIUS, cfg.regrow.count, new SeededRandom('regrow'));
  assert.equal(slots.length, cfg.regrow.count);
  for (const slot of slots) {
    assert.equal(slot.isAnchor, false);
    assert.ok(Math.hypot(slot.x - m.x, slot.y - m.y) <= RADIUS * 2.01);
    assert.ok(Math.hypot(slot.x - blocker.x, slot.y - blocker.y) >= RADIUS * 1.8);
  }
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      assert.ok(Math.hypot(slots[i].x - slots[j].x, slots[i].y - slots[j].y) >= RADIUS * 1.8);
    }
  }
});

test('regrowSlots is deterministic, respects bounds and a full ring gives nothing', () => {
  const m = ball(1, 200, 200);
  const a = regrowSlots(m, [m], RADIUS, 3, new SeededRandom('s'));
  const b = regrowSlots(m, [m], RADIUS, 3, new SeededRandom('s'));
  assert.deepEqual(a, b);
  const bounded = regrowSlots(m, [m], RADIUS, RING_SLOTS, new SeededRandom('s'), {
    minX: 200 - RADIUS, maxX: 400, minY: 0, maxY: 400
  });
  assert.ok(bounded.length > 0);
  assert.ok(bounded.every((s) => s.x - RADIUS >= 200 - RADIUS));
  const ring = [m];
  for (let i = 0; i < RING_SLOTS; i++) {
    const angle = (i / RING_SLOTS) * Math.PI * 2;
    ring.push(ball(100 + i, 200 + Math.cos(angle) * RADIUS * 2, 200 + Math.sin(angle) * RADIUS * 2));
  }
  assert.deepEqual(regrowSlots(m, ring, RADIUS, 3, new SeededRandom('s')), []);
  assert.deepEqual(regrowSlots(m, [m], RADIUS, 0, new SeededRandom('s')), []);
});

test('regrowSlots searches outer shells for free slots touching existing spheres', () => {
  const m = ball(1, 200, 200);
  const ring = [m];
  for (let i = 0; i < RING_SLOTS; i++) {
    const angle = (i / RING_SLOTS) * Math.PI * 2;
    ring.push(ball(100 + i, 200 + Math.cos(angle) * RADIUS * 2, 200 + Math.sin(angle) * RADIUS * 2));
  }
  const rng = () => new SeededRandom('shells');
  assert.deepEqual(regrowSlots(m, ring, RADIUS, 3, rng()), [], 'one shell stays blocked');
  const slots = regrowSlots(m, ring, RADIUS, 3, rng(), null, cfg.regrow.maxShells);
  assert.ok(slots.length > 0 && slots.length <= 3);
  for (const slot of slots) {
    assert.equal(slot.isAnchor, false);
    assert.ok(ring.every((b) => Math.hypot(b.x - slot.x, b.y - slot.y) >= RADIUS * 1.8), 'free');
    assert.ok(ring.some((b) => Math.hypot(b.x - slot.x, b.y - slot.y) <= RADIUS * 2.2), 'touches the cluster');
  }
  assert.deepEqual(regrowSlots(m, ring, RADIUS, 3, rng(), null, cfg.regrow.maxShells), slots, 'deterministic');
  assert.deepEqual(regrowSlots(m, ring, RADIUS, 2, rng(), null, cfg.regrow.maxShells), slots.slice(0, 2), 'count caps');
  const lonely = [m];
  const far = regrowSlots(m, lonely, RADIUS, 3, rng(), null, cfg.regrow.maxShells);
  assert.ok(far.every((s) => Math.hypot(s.x - m.x, s.y - m.y) <= RADIUS * 2.01), 'inner shell fills first');
});

test('planBarrage: counts by tier, strong only from the strong tier, lanes in range', () => {
  const span = { minX: 0, maxX: 600, startY: 900, targetY: 300, idStart: 40 };
  assert.deepEqual(planBarrage(2, cfg, new SeededRandom('b'), span), []);
  const three = planBarrage(3, cfg, new SeededRandom('b'), span);
  assert.equal(three.length, 2);
  assert.ok(three.every((c) => c.strength === 1));
  let sawStrong = false;
  for (let seed = 0; seed < 40; seed++) {
    const four = planBarrage(4, cfg, new SeededRandom(`b${seed}`), span);
    assert.equal(four.length, 3);
    sawStrong ||= four.some((c) => c.strength === 2);
    four.forEach((c, i) => {
      assert.equal(c.id, 40 + i);
      assert.ok(c.polarity === 1 || c.polarity === -1);
      assert.ok(c.x >= 0 && c.x <= 600);
      assert.equal(c.startY, 900);
      assert.equal(c.y, 900);
      assert.equal(c.turnsLeft, cfg.barrage.riseTurns);
    });
  }
  assert.ok(sawStrong);
  assert.deepEqual(
    planBarrage(4, cfg, new SeededRandom('same'), span),
    planBarrage(4, cfg, new SeededRandom('same'), span)
  );
});

test('advanceTurnCharges lands charges after riseTurns turns without mutating', () => {
  const span = { minX: 0, maxX: 600, startY: 900, targetY: 300, idStart: 0 };
  const start = planBarrage(3, cfg, new SeededRandom('b'), span);
  const frozen = JSON.stringify(start);
  const first = advanceTurnCharges(start);
  assert.equal(JSON.stringify(start), frozen);
  assert.equal(first.landed.length, 0);
  assert.equal(first.charges.length, start.length);
  assert.ok(first.charges.every((c) => c.y === 600));
  const second = advanceTurnCharges(first.charges);
  assert.equal(second.charges.length, 0);
  assert.equal(second.landed.length, start.length);
  assert.ok(second.landed.every((c) => c.y === 300));
});

test('fallReward pays base plus per sphere, coins, and flags a landslide', () => {
  assert.deepEqual(fallReward(0, cfg), { points: 900, coins: 40, landslide: false });
  assert.deepEqual(fallReward(10, cfg), { points: 1300, coins: 40, landslide: false });
  assert.equal(fallReward(19, cfg).landslide, false);
  assert.equal(fallReward(20, cfg).landslide, true);
  assert.equal(fallReward(20, cfg).points, 1700);
});
