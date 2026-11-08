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
import fs from 'node:fs';
import {
  createShotTimeline,
  appendTimelineSample,
  markTimelineComplete,
  normalizeShotTimeline
} from '../src/game/ShotTimeline.js';

const cfg = JSON.parse(fs.readFileSync('./configs/game.json', 'utf8')).shotTimeline;
const SCORE_PER_SHOT = 10;
const LONG_RUN_SHOTS = 300;
const EXPECTED_LONG_RUN_STEP = 4;

const build = (shots, mode = 'daily') => {
  const tl = createShotTimeline(mode, cfg);
  for (let i = 1; i <= shots; i++) {
    appendTimelineSample(tl, i * SCORE_PER_SHOT, shots - i, cfg);
  }
  return tl;
};

test('a new timeline is empty, incomplete and valid', () => {
  const tl = createShotTimeline('flux', cfg);
  assert.deepEqual(tl, { v: cfg.formatVersion, mode: 'flux', c: 0, n: 0, step: 1, s: [], b: [] });
  assert.deepEqual(normalizeShotTimeline(tl, cfg), tl);
});

test('a short run keeps one point per sample', () => {
  const tl = build(5);
  assert.deepEqual(tl.s, [10, 20, 30, 40, 50]);
  assert.deepEqual(tl.b, [4, 3, 2, 1, 0]);
  assert.equal(tl.n, 5);
  assert.equal(tl.step, 1);
});

test('a long run is folded to at most maxPoints with a doubled step', () => {
  const tl = build(LONG_RUN_SHOTS);
  assert.ok(tl.s.length <= cfg.maxPoints);
  assert.equal(tl.s.length, tl.b.length);
  assert.equal(tl.step, EXPECTED_LONG_RUN_STEP);
  assert.equal(tl.n, LONG_RUN_SHOTS);
  assert.deepEqual(normalizeShotTimeline(tl, cfg), tl);
});

test('the last point always equals the final state', () => {
  for (const shots of [1, cfg.maxPoints, cfg.maxPoints + 1, LONG_RUN_SHOTS, LONG_RUN_SHOTS + 1]) {
    const tl = build(shots);
    assert.equal(tl.s.at(-1), shots * SCORE_PER_SHOT, `score after ${shots}`);
    assert.equal(tl.b.at(-1), 0, `balls after ${shots}`);
  }
});

test('compression keeps the later point of each pair', () => {
  const tl = build(cfg.maxPoints + 1);
  assert.equal(tl.step, 2);
  assert.equal(tl.s.length, cfg.maxPoints / 2 + 1);
  assert.equal(tl.s[0], 2 * SCORE_PER_SHOT);
  assert.equal(tl.s[1], 4 * SCORE_PER_SHOT);
  assert.equal(tl.s.at(-2), cfg.maxPoints * SCORE_PER_SHOT);
  assert.equal(tl.s.at(-1), (cfg.maxPoints + 1) * SCORE_PER_SHOT);
});

test('scores never decrease even when a sample reports a lower value', () => {
  const tl = createShotTimeline('daily', cfg);
  appendTimelineSample(tl, 100, 5, cfg);
  appendTimelineSample(tl, 40, 4, cfg);
  assert.deepEqual(tl.s, [100, 100]);
});

test('invalid sample numbers are clamped to non-negative integers', () => {
  const tl = createShotTimeline('daily', cfg);
  appendTimelineSample(tl, Number.NaN, -3, cfg);
  appendTimelineSample(tl, 12.9, 2.7, cfg);
  assert.deepEqual(tl.s, [0, 12]);
  assert.deepEqual(tl.b, [0, 2]);
});

test('markTimelineComplete returns a flagged copy', () => {
  const tl = build(3);
  const done = markTimelineComplete(tl);
  assert.equal(done.c, 1);
  assert.equal(tl.c, 0);
  assert.notEqual(done.s, tl.s);
  assert.deepEqual(normalizeShotTimeline(done, cfg), done);
});

test('validation rejects malformed timelines', () => {
  const good = build(4);
  const reject = (mutate, label) => {
    const copy = structuredClone(good);
    mutate(copy);
    assert.equal(normalizeShotTimeline(copy, cfg), null, label);
  };
  assert.deepEqual(normalizeShotTimeline(good, cfg), good);
  reject((tl) => { tl.v = cfg.formatVersion + 1; }, 'unknown version');
  reject((tl) => { tl.mode = 'campaign'; }, 'unknown mode');
  reject((tl) => { tl.c = 2; }, 'bad complete flag');
  reject((tl) => { tl.b.pop(); }, 'length mismatch');
  reject((tl) => { tl.s = Array.from({ length: cfg.maxPoints + 1 }, (_, i) => i); tl.b = tl.s.slice(); }, 'too many points');
  reject((tl) => { tl.s[1] = -1; }, 'negative score');
  reject((tl) => { tl.b[1] = 1.5; }, 'non-integer balls');
  reject((tl) => { tl.s[0] = Number.MAX_SAFE_INTEGER + 2; }, 'unsafe integer');
  reject((tl) => { tl.s[2] = tl.s[1] - 1; }, 'decreasing score');
  reject((tl) => { tl.step = 3; }, 'step not a power of two');
  reject((tl) => { tl.step = 0; }, 'step zero');
  reject((tl) => { tl.n = -1; }, 'negative count');
  reject((tl) => { tl.s = 'abc'; }, 'not an array');
  for (const bad of [null, undefined, 5, 'x', [], true]) {
    assert.equal(normalizeShotTimeline(bad, cfg), null);
  }
});

test('normalization returns an independent copy', () => {
  const good = build(3);
  const copy = normalizeShotTimeline(good, cfg);
  copy.s[0] = 999;
  assert.equal(good.s[0], SCORE_PER_SHOT);
});
