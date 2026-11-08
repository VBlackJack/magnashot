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

import {
  CHARGE_OUTCOMES,
  ROUND_RESULTS,
  advanceCharge,
  applyBoardLoss,
  chargePolarityForColor,
  chargesInBlastRadius,
  computeVersusAttack,
  createCharge,
  createRoundState,
  guardStreak,
  isChargeThreatening,
  isMatchOver,
  landingBalls,
  matchWinner,
  resolveChargeHit,
  segmentCircleHitT,
  segmentHitsCircle,
  shotPolarity,
  suddenDeathDue
} from '../src/game/VersusRules.js';

// Spec values of the versus section.
const cfg = {
  attack: {
    freeDroppedSpheres: 1,
    dropWeight: 1,
    linkWeight: 2,
    specialMultiplier: 1.5,
    rawPerCharge: 2,
    maxChargesPerTurn: 6,
    boardClearCharges: 4,
    strongChargeRaw: 8
  },
  colorPolarities: { red: 1, blue: -1, green: 1 },
  fallbackPolarity: 1,
  threatRatio: 0.4,
  guardStreakSize: 3,
  roundsToWin: 2,
  framesPerSecond: 60,
  suddenDeath: { startSeconds: 180, intervalSeconds: 20 }
};

const RISE = 360;
const makeCharge = (over = {}) => createCharge({
  polarity: 1, strength: 1, x: 100, startY: 800, targetY: 200, riseFrames: RISE, id: 'c1', ...over
});

test('attack table: nothing dropped sends nothing', () => {
  assert.deepEqual(computeVersusAttack({ dropped: 0, links: 4, isSpecial: true }, cfg.attack),
    { raw: 0, sent: 0, isStrong: false });
});

test('attack table: free sphere, links, special, cap and strong flag', () => {
  assert.equal(computeVersusAttack({ dropped: 1, links: 0, isSpecial: false }, cfg.attack).sent, 0);
  assert.equal(computeVersusAttack({ dropped: 3, links: 0, isSpecial: false }, cfg.attack).sent, 1);
  assert.equal(computeVersusAttack({ dropped: 3, links: 2, isSpecial: false }, cfg.attack).sent, 3);
  assert.equal(computeVersusAttack({ dropped: 3, links: 0, isSpecial: true }, cfg.attack).raw, 3);
  assert.equal(computeVersusAttack({ dropped: 40, links: 5, isSpecial: false }, cfg.attack).sent, 6);
  assert.equal(computeVersusAttack({ dropped: 9, links: 0, isSpecial: false }, cfg.attack).isStrong, true);
  assert.equal(computeVersusAttack({ dropped: 8, links: 0, isSpecial: false }, cfg.attack).isStrong, false);
});

test('polarity of charges and shots follows the colour and the flip', () => {
  assert.equal(chargePolarityForColor('red', cfg), 1);
  assert.equal(chargePolarityForColor('blue', cfg), -1);
  assert.equal(chargePolarityForColor('unknown', cfg), cfg.fallbackPolarity);
  assert.equal(shotPolarity('red', false, cfg), 1);
  assert.equal(shotPolarity('red', true, cfg), -1);
  assert.equal(shotPolarity('blue', true, cfg), 1);
});

test('createCharge starts at its start height with its data', () => {
  const charge = makeCharge({ polarity: -1, strength: 2 });
  assert.equal(charge.y, 800);
  assert.equal(charge.polarity, -1);
  assert.equal(charge.strength, 2);
  assert.equal(charge.riseFrames, RISE);
  assert.equal(charge.id, 'c1');
});

test('advanceCharge rises linearly and lands at the rise duration', () => {
  const charge = makeCharge();
  assert.deepEqual(advanceCharge(charge, 0), { y: 800, progress: 0, landed: false });
  const half = advanceCharge(charge, RISE / 2);
  assert.equal(half.y, 500);
  assert.equal(half.progress, 0.5);
  assert.equal(half.landed, false);
  const done = advanceCharge(charge, RISE);
  assert.equal(done.y, 200);
  assert.equal(done.landed, true);
  assert.equal(advanceCharge(charge, RISE * 3).y, 200);
  assert.equal(advanceCharge(charge, -5).y, 800);
  assert.equal(advanceCharge(makeCharge({ riseFrames: 0 }), 0).landed, true);
});

test('isChargeThreatening below the threat ratio of the rise from landing', () => {
  const charge = makeCharge();
  assert.equal(isChargeThreatening({ ...charge, y: 800 }, cfg), false);
  // 50 percent travelled: 50 percent left.
  assert.equal(isChargeThreatening({ ...charge, y: 500 }, cfg), false);
  // 60 percent travelled: exactly 40 percent left is not below the ratio.
  assert.equal(isChargeThreatening({ ...charge, y: 440 }, cfg), false);
  // 61 percent travelled: 39 percent left.
  assert.equal(isChargeThreatening({ ...charge, y: 434 }, cfg), true);
  assert.equal(isChargeThreatening({ ...charge, y: 200 }, cfg), true);
  assert.equal(isChargeThreatening(makeCharge({ startY: 300, targetY: 300 }), cfg), true);
});

test('neutralisation: opposite polarity on strength 1 shatters the charge', () => {
  const result = resolveChargeHit(makeCharge({ polarity: 1 }), { polarity: -1 });
  assert.equal(result.outcome, CHARGE_OUTCOMES.NEUTRALISED);
  assert.equal(result.charge.strength, 0);
  assert.equal(result.projectileConsumed, true);
  assert.equal(result.projectileVxFlip, false);
});

test('neutralisation: opposite polarity on strength 2 only weakens it', () => {
  const original = makeCharge({ polarity: -1, strength: 2 });
  const first = resolveChargeHit(original, { polarity: 1 });
  assert.equal(first.outcome, CHARGE_OUTCOMES.WEAKENED);
  assert.equal(first.charge.strength, 1);
  assert.equal(first.projectileConsumed, true);
  assert.equal(original.strength, 2, 'input is not mutated');
  const second = resolveChargeHit(first.charge, { polarity: 1 });
  assert.equal(second.outcome, CHARGE_OUTCOMES.NEUTRALISED);
});

test('neutralisation: same polarity deflects the projectile and keeps the charge', () => {
  const charge = makeCharge({ polarity: 1, strength: 2 });
  const result = resolveChargeHit(charge, { polarity: 1 });
  assert.equal(result.outcome, CHARGE_OUTCOMES.DEFLECTED);
  assert.equal(result.charge, charge);
  assert.equal(result.projectileConsumed, false);
  assert.equal(result.projectileVxFlip, true);
});

test('blast radius (bomb or lightning) catches every charge in range, borders included', () => {
  const charges = [
    makeCharge({ id: 'a', x: 100 }),
    { ...makeCharge({ id: 'b', x: 160 }), y: 800 },
    { ...makeCharge({ id: 'c', x: 100 }), y: 900 },
    { ...makeCharge({ id: 'd', x: 400 }), y: 800 }
  ];
  const hit = chargesInBlastRadius(charges, 100, 800, 100).map((c) => c.id);
  assert.deepEqual(hit, ['a', 'b', 'c']);
  assert.deepEqual(chargesInBlastRadius(charges, 100, 800, 10).map((c) => c.id), ['a']);
  assert.deepEqual(chargesInBlastRadius([], 0, 0, 50), []);
});

test('segment against circle for the aim preview', () => {
  assert.equal(segmentHitsCircle(0, 0, 100, 0, 50, 0, 10), true);
  assert.equal(segmentHitsCircle(0, 0, 100, 0, 50, 20, 10), false);
  assert.equal(segmentHitsCircle(0, 0, 100, 0, 50, 10, 10), true, 'tangent counts');
  assert.equal(segmentHitsCircle(0, 0, 30, 0, 50, 0, 10), false, 'circle beyond the end');
  assert.equal(segmentHitsCircle(0, 0, 100, 0, -50, 0, 10), false, 'circle behind the start');
  assert.equal(segmentHitsCircle(0, 0, 0, 0, 5, 0, 10), true, 'start inside');
  assert.equal(segmentHitsCircle(0, 0, 0, 0, 50, 0, 10), false, 'degenerate segment outside');
  assert.equal(segmentCircleHitT(0, 0, 100, 0, 50, 0, 10), 0.4);
  assert.equal(segmentCircleHitT(0, 0, 100, 0, 5, 0, 10), 0);
  assert.equal(segmentCircleHitT(0, 0, 100, 0, 50, 99, 10), null);
});

test('landing count: 1 ball for strength 1, 2 balls for strength 2', () => {
  assert.equal(landingBalls(makeCharge({ strength: 1 })), 1);
  assert.equal(landingBalls(makeCharge({ strength: 2 })), 2);
});

test('guard streak grants a special every third neutralised charge', () => {
  let state = null;
  const grants = [];
  for (let i = 1; i <= 9; i += 1) {
    const step = guardStreak(state, 1, cfg);
    state = step.state;
    grants.push(step.grantSpecial);
  }
  assert.deepEqual(grants, [false, false, true, false, false, true, false, false, true]);
  assert.equal(state.streak, 0);
  const burst = guardStreak({ streak: 2 }, 5, cfg);
  assert.equal(burst.grantSpecial, true);
  assert.equal(burst.grantCount, 2);
  assert.equal(burst.state.streak, 1);
  assert.equal(guardStreak(null, 0, cfg).grantSpecial, false);
});

test('best of 3: first to two rounds wins the match', () => {
  let state = createRoundState(cfg);
  assert.equal(isMatchOver(state), false);
  assert.equal(matchWinner(state), null);
  state = applyBoardLoss(state, 1, 500);
  assert.deepEqual(state.wins, [1, 0]);
  assert.equal(state.lastResult.type, ROUND_RESULTS.WIN);
  assert.equal(state.lastResult.winner, 0);
  assert.equal(isMatchOver(state), false);
  state = applyBoardLoss(state, 0, 900);
  assert.deepEqual(state.wins, [1, 1]);
  assert.equal(isMatchOver(state), false);
  state = applyBoardLoss(state, 1, 1400);
  assert.deepEqual(state.wins, [2, 1]);
  assert.equal(isMatchOver(state), true);
  assert.equal(matchWinner(state), 0);
});

test('best of 3: two straight rounds end the match 2-0', () => {
  let state = createRoundState(cfg);
  state = applyBoardLoss(state, 0, 100);
  state = applyBoardLoss(state, 0, 200);
  assert.equal(isMatchOver(state), true);
  assert.equal(matchWinner(state), 1);
});

test('simultaneous loss on the same frame replays the round, in either order', () => {
  let state = createRoundState(cfg);
  state = applyBoardLoss(state, 0, 700);
  state = applyBoardLoss(state, 1, 700);
  assert.deepEqual(state.wins, [0, 0]);
  assert.equal(state.lastResult.type, ROUND_RESULTS.REPLAY);
  assert.equal(isMatchOver(state), false);

  let reversed = createRoundState(cfg);
  reversed = applyBoardLoss(reversed, 1, 700);
  reversed = applyBoardLoss(reversed, 0, 700);
  assert.deepEqual(reversed.wins, [0, 0]);
  assert.equal(reversed.lastResult.type, ROUND_RESULTS.REPLAY);
});

test('simultaneous loss cancels even a match-deciding round', () => {
  let state = createRoundState(cfg);
  state = applyBoardLoss(state, 1, 100);
  state = applyBoardLoss(state, 1, 300);
  assert.equal(isMatchOver(state), true);
  state = applyBoardLoss(state, 0, 300);
  assert.deepEqual(state.wins, [1, 0]);
  assert.equal(isMatchOver(state), false);
});

test('a loss on a different frame is a normal win and the state is not mutated', () => {
  const start = createRoundState(cfg);
  const afterFirst = applyBoardLoss(start, 0, 700);
  const afterSecond = applyBoardLoss(afterFirst, 1, 701);
  assert.deepEqual(start.wins, [0, 0]);
  assert.deepEqual(afterFirst.wins, [0, 1]);
  assert.deepEqual(afterSecond.wins, [1, 1]);
});

test('sudden death schedule: from 180 s, then every 20 s, at 60 fps', () => {
  const start = 180 * 60;
  const interval = 20 * 60;
  assert.equal(suddenDeathDue(0, null, cfg), false);
  assert.equal(suddenDeathDue(start - 1, null, cfg), false);
  assert.equal(suddenDeathDue(start, null, cfg), true);
  assert.equal(suddenDeathDue(start + 1, start, cfg), false);
  assert.equal(suddenDeathDue(start + interval - 1, start, cfg), false);
  assert.equal(suddenDeathDue(start + interval, start, cfg), true);

  const pulses = [];
  let last = null;
  for (let frame = 0; frame <= start + 3 * interval; frame += 1) {
    if (suddenDeathDue(frame, last, cfg)) {
      pulses.push(frame / 60);
      last = frame;
    }
  }
  assert.deepEqual(pulses, [180, 200, 220, 240]);
});
