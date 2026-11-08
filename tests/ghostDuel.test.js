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
  ghostScoreAfterShots,
  compareToGhost,
  nextDuelAnnouncement,
  createDuelAnnouncementState,
  settleDuel
} from '../src/game/GhostDuel.js';

const cfg = { announceMinShots: 3 };
const SCORE_PER_SHOT = 10;
const RUN_SAMPLES = 17;
const LONG_RUN_SAMPLES = 1000;

// Ghost whose score at sample m is SCORE_PER_SHOT * (m - 1), sampled with `step`.
function buildGhost(n, step) {
  const points = Math.ceil(n / step);
  const s = [];
  for (let j = 0; j < points; j++) {
    s.push((Math.min((j + 1) * step, n) - 1) * SCORE_PER_SHOT);
  }
  return { mode: 'daily', key: 1, cv: 1, n, step, s, final: s[s.length - 1], assists: {}, alias: '' };
}

test('step 1 is exact at every shot and starts at the origin', () => {
  const ghost = buildGhost(RUN_SAMPLES, 1);
  for (let k = 0; k < RUN_SAMPLES - 1; k++) {
    assert.equal(ghostScoreAfterShots(ghost, k), k * SCORE_PER_SHOT);
  }
  assert.equal(ghostScoreAfterShots(ghost, 0), 0);
});

for (const step of [2, 4, 8]) {
  test(`step ${step} is exact at known points and interpolates between them`, () => {
    const ghost = buildGhost(RUN_SAMPLES, step);
    for (let j = 0; j < ghost.s.length; j++) {
      const sample = Math.min((j + 1) * step, RUN_SAMPLES);
      assert.equal(ghostScoreAfterShots(ghost, sample - 1), ghost.s[j]);
    }
    // A linear ground truth means interpolation reproduces the exact per-shot score.
    for (let k = 0; k < RUN_SAMPLES; k++) {
      assert.equal(ghostScoreAfterShots(ghost, k), Math.min(k, RUN_SAMPLES - 1) * SCORE_PER_SHOT);
    }
    let last = 0;
    for (let k = 0; k < RUN_SAMPLES + 3; k++) {
      const value = ghostScoreAfterShots(ghost, k);
      assert.ok(value >= last);
      last = value;
    }
  });
}

test('interpolation floors to integers between uneven points', () => {
  // Known points: origin (sample 1, 0), (sample 4, 100), (sample 5, 130).
  const ghost = { n: 5, step: 4, s: [100, 130], final: 130 };
  assert.equal(ghostScoreAfterShots(ghost, 1), 33);
  assert.equal(ghostScoreAfterShots(ghost, 2), 66);
  assert.equal(ghostScoreAfterShots(ghost, 3), 100);
  assert.equal(ghostScoreAfterShots(ghost, 4), 130);
});

test('score is frozen at the final after the ghost last sample', () => {
  const ghost = buildGhost(6, 2);
  assert.equal(ghostScoreAfterShots(ghost, 5), ghost.final);
  assert.equal(ghostScoreAfterShots(ghost, 500), ghost.final);
  assert.equal(compareToGhost(0, 5, ghost).ghostFinished, true);
  assert.equal(compareToGhost(0, 4, ghost).ghostFinished, false);
});

test('compareToGhost reports absolute gap and side', () => {
  const ghost = buildGhost(10, 1);
  const ahead = compareToGhost(50, 3, ghost);
  assert.equal(ahead.gap, 20);
  assert.equal(ahead.side, 'ahead');
  assert.equal(ahead.ghostScore, 30);
  assert.equal(ahead.ghostFinished, false);
  const behind = compareToGhost(10, 3, ghost);
  assert.equal(behind.side, 'behind');
  assert.equal(behind.gap, 20);
  const tied = compareToGhost(30, 3, ghost);
  assert.equal(tied.side, 'tied');
  assert.equal(tied.gap, 0);
});

const longGhost = () => buildGhost(LONG_RUN_SAMPLES, 1);

test('first sign is a silent baseline, then a flip after the cooldown announces', () => {
  const ghost = longGhost();
  let r = nextDuelAnnouncement(createDuelAnnouncementState(), compareToGhost(50, 1, ghost), cfg);
  assert.equal(r.announcement, null);
  r = nextDuelAnnouncement(r.state, compareToGhost(0, 4, ghost), cfg);
  assert.equal(r.announcement, 'behind');
});

test('cooldown suppresses an early flip and it fires once the cooldown elapses', () => {
  const ghost = longGhost();
  let r = nextDuelAnnouncement(createDuelAnnouncementState(), compareToGhost(50, 1, ghost), cfg);
  r = nextDuelAnnouncement(r.state, compareToGhost(0, 3, ghost), cfg);
  assert.equal(r.announcement, null);
  r = nextDuelAnnouncement(r.state, compareToGhost(0, 4, ghost), cfg);
  assert.equal(r.announcement, 'behind');
  r = nextDuelAnnouncement(r.state, compareToGhost(900, 5, ghost), cfg);
  assert.equal(r.announcement, null);
  r = nextDuelAnnouncement(r.state, compareToGhost(900, 7, ghost), cfg);
  assert.equal(r.announcement, 'ahead');
});

test('a flip that reverts inside the cooldown is never announced', () => {
  const ghost = longGhost();
  let r = nextDuelAnnouncement(createDuelAnnouncementState(), compareToGhost(50, 1, ghost), cfg);
  r = nextDuelAnnouncement(r.state, compareToGhost(0, 2, ghost), cfg);
  assert.equal(r.announcement, null);
  r = nextDuelAnnouncement(r.state, compareToGhost(900, 5, ghost), cfg);
  assert.equal(r.announcement, null);
});

test('ties do not reset the last sign', () => {
  const ghost = longGhost();
  let r = nextDuelAnnouncement(createDuelAnnouncementState(), compareToGhost(100, 1, ghost), cfg);
  assert.equal(r.state.lastSign, 1);
  // Shot 5: ghost has 50, so score 50 is a tie.
  r = nextDuelAnnouncement(r.state, compareToGhost(50, 5, ghost), cfg);
  assert.equal(r.announcement, null);
  assert.equal(r.state.lastSign, 1);
  // Ahead again after the tie: same sign as before, no announcement.
  r = nextDuelAnnouncement(r.state, compareToGhost(900, 9, ghost), cfg);
  assert.equal(r.announcement, null);
  // Behind after the tie: a real flip.
  r = nextDuelAnnouncement(r.state, compareToGhost(0, 13, ghost), cfg);
  assert.equal(r.announcement, 'behind');
});

test('ended fires once when the ghost run ends', () => {
  const ghost = buildGhost(5, 1);
  let r = nextDuelAnnouncement(createDuelAnnouncementState(), compareToGhost(0, 3, ghost), cfg);
  assert.equal(r.announcement, null);
  r = nextDuelAnnouncement(r.state, compareToGhost(0, 4, ghost), cfg);
  assert.equal(r.announcement, 'ended');
  r = nextDuelAnnouncement(r.state, compareToGhost(0, 5, ghost), cfg);
  assert.equal(r.announcement, null);
});

test('passed fires once when the player exceeds the ghost final, not on equality', () => {
  const ghost = buildGhost(5, 1);
  const state = { ...createDuelAnnouncementState(), endedDone: true };
  let r = nextDuelAnnouncement(state, compareToGhost(ghost.final, 6, ghost), cfg);
  assert.equal(r.announcement, null);
  r = nextDuelAnnouncement(r.state, compareToGhost(ghost.final + 1, 7, ghost), cfg);
  assert.equal(r.announcement, 'passed');
  r = nextDuelAnnouncement(r.state, compareToGhost(ghost.final + 50, 8, ghost), cfg);
  assert.equal(r.announcement, null);
});

test('passed can fire before the ghost run ends', () => {
  const ghost = { n: 100, step: 1, s: [0, 10, 20], final: 20 };
  const r = nextDuelAnnouncement(createDuelAnnouncementState(), compareToGhost(21, 1, ghost), cfg);
  assert.equal(r.announcement, 'passed');
});

test('at most one announcement per call: pending ones fire on later calls', () => {
  const ghost = buildGhost(4, 1);
  let r = nextDuelAnnouncement(createDuelAnnouncementState(), compareToGhost(ghost.final + 5, 3, ghost), cfg);
  assert.equal(r.announcement, 'ended');
  r = nextDuelAnnouncement(r.state, compareToGhost(ghost.final + 5, 4, ghost), cfg);
  assert.equal(r.announcement, 'passed');
  r = nextDuelAnnouncement(r.state, compareToGhost(ghost.final + 5, 5, ghost), cfg);
  assert.equal(r.announcement, null);
});

test('nextDuelAnnouncement does not mutate its input state', () => {
  const ghost = longGhost();
  const state = createDuelAnnouncementState();
  const snapshot = JSON.stringify(state);
  nextDuelAnnouncement(state, compareToGhost(50, 1, ghost), cfg);
  assert.equal(JSON.stringify(state), snapshot);
});

test('settleDuel covers won, lost and tie', () => {
  const ghost = { final: 500 };
  assert.deepEqual(settleDuel(700, ghost), { outcome: 'won', gap: 200 });
  assert.deepEqual(settleDuel(300, ghost), { outcome: 'lost', gap: 200 });
  assert.deepEqual(settleDuel(500, ghost), { outcome: 'tie', gap: 0 });
});
