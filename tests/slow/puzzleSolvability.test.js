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
 * Puzzle solvability: every stage keeps a pinned winning window of at least one degree, the
 * two-shot stages cannot be won in one shot, the third star is reachable inside a window, and a
 * stage left idle never reaches the danger line. The runs are deterministic (seeded, Resonance
 * off), spread over worker threads.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';

import { applyWorldGeometry } from '../../src/core/WorldGeometry.js';
import { GAME_STATES } from '../../src/core/Constants.js';
import { aimRangeDegrees } from '../../scripts/bot/PuzzleProbe.js';

const loadJson = (name) => JSON.parse(fs.readFileSync(new URL(`../../configs/${name}`, import.meta.url), 'utf8'));
const WORKER_URL = new URL('./puzzleWorker.mjs', import.meta.url);
const solutions = JSON.parse(fs.readFileSync(new URL('../fixtures/puzzleSolutions.json', import.meta.url), 'utf8'));
const gameConfig = applyWorldGeometry(loadJson('game.json'));
const puzzles = gameConfig.puzzles;

/** Cores left free for the rest of the machine. */
const SPARE_CORES = 2;
const MIN_WORKERS = 1;
/** Width, in degrees, a winning window must have to be a fair target. */
const MIN_WINDOW_DEG = 1;
/** Tolerance on a window width, so a window of exactly the minimum is not lost to rounding. */
const WIDTH_EPSILON = 1e-6;
/** Decimals the aim angles are rounded to, so a grid never drifts. */
const ANGLE_DECIMALS = 3;
const ANGLE_SCALE = 10 ** ANGLE_DECIMALS;
/** Aim steps, in degrees. */
const FINE_STEP = 0.1;
const SEARCH_STEP = 0.25;
/** First aims tried around a pinned first aim: offsets from it, in degrees. */
const FIRST_AIM_OFFSETS = Object.freeze([-0.5, -0.25, 0, 0.25, 0.5]);
/** Stage 10 turns on a rotor, so a shot depends on when it is fired. */
const ROTOR_STAGE = 10;
const ROTOR_PRE_FRAMES_FROM = 0;
const ROTOR_PRE_FRAMES_TO = 780;
const ROTOR_PRE_FRAMES_STEP = 20;
/** Stage the launcher-swap attempt is swept on. */
const SWAP_SWEEP_STAGE = 4;
const IDLE_FRAMES = 3600;
const TWO_SHOT_STAGES = Object.freeze(puzzles.filter((puzzle) => puzzle.shots >= 2).map((puzzle) => puzzle.id));

const roundAngle = (angle) => Math.round(angle * ANGLE_SCALE) / ANGLE_SCALE;

/** Angles from `from` to `to` (inclusive), `step` apart. */
function grid(from, to, step) {
  const count = Math.floor((to - from) / step + WIDTH_EPSILON);
  return Array.from({ length: count + 1 }, (_, index) => roundAngle(from + index * step));
}

function shotOf(spec, angleDeg) {
  return { angleDeg, flip: spec.flip, special: spec.special };
}

/** Runs the jobs on worker threads, one interleaved share each; results come back in job order. */
async function runJobs(jobs) {
  const count = Math.max(MIN_WORKERS, Math.min(jobs.length, os.cpus().length - SPARE_CORES));
  const shares = Array.from({ length: count }, () => []);
  jobs.forEach((job, index) => shares[index % count].push(job));
  const parts = await Promise.all(shares.map((share) => new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: { jobs: share } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => code !== 0 && reject(new Error(`puzzle worker exited with code ${code}`)));
  })));
  const results = new Array(jobs.length);
  parts.forEach((part, shareIndex) => part.forEach((result, position) => {
    results[shareIndex + position * count] = result;
  }));
  return results;
}

const fireJob = (stage, shots, extra = {}) => ({ kind: 'fire', stage, shots, ...extra });

/** The longest run of consecutive wins: its first index and its length. */
function longestWinRun(wins) {
  let best = { start: 0, length: 0 };
  let run = { start: 0, length: 0 };
  wins.forEach((won, index) => {
    run = won ? { start: run.length ? run.start : index, length: run.length + 1 } : { start: index + 1, length: 0 };
    if (run.length > best.length) {
      best = run;
    }
  });
  return best;
}

/** The score a win must reach to be worth every star, when the stage grants them all at once. */
function thirdStar(stage) {
  return puzzles[stage - 1].starThresholds[2];
}

function sharesStars(stage) {
  const [, two, three] = puzzles[stage - 1].starThresholds;
  return two === three;
}

/** Asserts the wins hold a run of at least one degree; returns the results inside that run. */
function assertWindow(label, results, step) {
  const run = longestWinRun(results.map((result) => result.won));
  const width = run.length * step;
  assert.ok(width >= MIN_WINDOW_DEG - WIDTH_EPSILON, `${label}: winning window ${width} deg is under ${MIN_WINDOW_DEG}`);
  return results.slice(run.start, run.start + run.length);
}

test('The stages ship the content the solutions were measured on', () => {
  assert.equal(solutions.seed, 7);
  assert.equal(puzzles.length, 20);
  for (const stage of Object.keys(solutions.oneShot)) {
    assert.equal(puzzles[stage - 1].shots, 1, `stage ${stage} is a one-shot stage`);
  }
  for (const stage of Object.keys(solutions.twoShot)) {
    assert.equal(puzzles[stage - 1].shots, 2, `stage ${stage} is a two-shot stage`);
  }
  assert.deepEqual(TWO_SHOT_STAGES, Object.keys(solutions.twoShot).map(Number));
});

test('(a) every one-shot stage keeps a winning window of at least one degree', async () => {
  const entries = Object.entries(solutions.oneShot);
  const jobs = [];
  const owners = [];
  for (const [stage, pin] of entries) {
    for (const angle of grid(pin.from, pin.to, FINE_STEP)) {
      jobs.push(fireJob(Number(stage), [shotOf(pin, angle)]));
      owners.push(stage);
    }
  }
  const results = await runJobs(jobs);
  for (const [stage, pin] of entries) {
    const mine = results.filter((_, index) => owners[index] === stage);
    const window = assertWindow(`stage ${stage}`, mine, FINE_STEP);
    assert.ok(pin.to - pin.from + FINE_STEP >= MIN_WINDOW_DEG - WIDTH_EPSILON, `stage ${stage} pin is under one degree`);
    if (sharesStars(Number(stage))) {
      for (const result of window) {
        assert.ok(result.score >= thirdStar(Number(stage)), `stage ${stage}: a win scores ${result.score}, under the third star`);
      }
    }
  }
});

test('(a) every two-shot stage keeps a winning window of at least one degree after each first aim', async () => {
  const entries = Object.entries(solutions.twoShot);
  const jobs = [];
  const owners = [];
  for (const [stage, pin] of entries) {
    for (const offset of FIRST_AIM_OFFSETS) {
      const firstAngle = roundAngle(pin.first.mid + offset);
      for (const secondAngle of grid(pin.second.from, pin.second.to, SEARCH_STEP)) {
        jobs.push(fireJob(Number(stage), [shotOf(pin.first, firstAngle), shotOf(pin.second, secondAngle)], { preFrames: pin.preFrames }));
        owners.push({ stage, offset });
      }
    }
  }
  const results = await runJobs(jobs);
  for (const [stage] of entries) {
    for (const offset of FIRST_AIM_OFFSETS) {
      const mine = results.filter((_, index) => owners[index].stage === stage && owners[index].offset === offset);
      const label = `stage ${stage}, first aim offset ${offset}`;
      assertWindow(label, mine, SEARCH_STEP);
      if (sharesStars(Number(stage)) && !(stage in solutions.thirdStar.twoShot)) {
        // One threshold for both upper stars: a window of one degree must hold them too.
        const starred = mine.map((result) => ({ won: result.won && result.score >= thirdStar(Number(stage)) }));
        assertWindow(`${label}, third star`, starred, SEARCH_STEP);
      }
    }
  }
});

test('(b) no two-shot stage can be won in one shot', async () => {
  const { minDeg, maxDeg } = aimRangeDegrees({ game: gameConfig });
  const aims = grid(roundAngle(minDeg), roundAngle(maxDeg), FINE_STEP);
  const jobs = [];
  const labels = [];
  for (const stage of TWO_SHOT_STAGES) {
    const inventory = Object.entries(puzzles[stage - 1].specialInventory).filter(([, count]) => count > 0).map(([type]) => type);
    for (const special of [null, ...inventory]) {
      for (const flip of [false, true]) {
        for (const angle of aims) {
          jobs.push(fireJob(stage, [{ angleDeg: angle, flip, special }]));
          labels.push(`stage ${stage} ${special || 'queue'}${flip ? '+flip' : ''} ${angle}`);
        }
      }
    }
  }
  const results = await runJobs(jobs);
  const wins = labels.filter((_, index) => results[index].won);
  assert.deepEqual(wins, [], 'one-shot wins on a two-shot stage');
});

test('(b) the rotor stage cannot be won in one shot at any moment of its turn', async () => {
  const { minDeg, maxDeg } = aimRangeDegrees({ game: gameConfig });
  const aims = grid(roundAngle(minDeg), roundAngle(maxDeg), SEARCH_STEP);
  const preFrames = grid(ROTOR_PRE_FRAMES_FROM, ROTOR_PRE_FRAMES_TO, ROTOR_PRE_FRAMES_STEP);
  const jobs = [];
  const labels = [];
  for (const pre of preFrames) {
    for (const flip of [false, true]) {
      for (const angle of aims) {
        jobs.push(fireJob(ROTOR_STAGE, [{ angleDeg: angle, flip, special: null }], { preFrames: pre }));
        labels.push(`pre ${pre} ${flip ? 'flip' : 'queue'} ${angle}`);
      }
    }
  }
  const results = await runJobs(jobs);
  const wins = labels.filter((_, index) => results[index].won);
  assert.deepEqual(wins, [], 'one-shot wins on the rotor stage');
});

test('(c) the third star is held inside a window of at least one degree', async () => {
  const jobs = [];
  const tags = [];
  for (const [stage, pin] of Object.entries(solutions.thirdStar.oneShot)) {
    const step = pin.step;
    assert.ok(pin.to - pin.from + step >= MIN_WINDOW_DEG - WIDTH_EPSILON, `stage ${stage} pin is under one degree`);
    for (const angle of grid(pin.from, pin.to, step)) {
      jobs.push(fireJob(Number(stage), [shotOf(pin, angle)]));
      tags.push(`stage ${stage} aim ${angle}`);
    }
  }
  for (const [stage, pin] of Object.entries(solutions.thirdStar.twoShot)) {
    const firstAngles = pin.firstFrom === undefined
      ? FIRST_AIM_OFFSETS.map((offset) => roundAngle(solutions.twoShot[stage].first.mid + offset))
      : grid(pin.firstFrom, pin.firstTo, SEARCH_STEP);
    for (const firstAngle of firstAngles) {
      for (const secondAngle of grid(pin.second.from, pin.second.to, SEARCH_STEP)) {
        jobs.push(fireJob(Number(stage), [shotOf(pin.first, firstAngle), shotOf(pin.second, secondAngle)]));
        tags.push(`stage ${stage} aims ${firstAngle}/${secondAngle}`);
      }
    }
  }
  const results = await runJobs(jobs);
  const short = tags
    .map((tag, index) => ({ tag, result: results[index] }))
    .filter(({ tag, result }) => !(result.won && result.score >= thirdStar(Number(tag.split(' ')[1]))))
    .map(({ tag, result }) => `${tag} (${result.won ? result.score : 'lost'})`);
  assert.deepEqual(short, [], 'shots that miss the third star');
});

test('(d) a stage left idle never reaches the danger line', async () => {
  const stages = puzzles.map((puzzle) => puzzle.id);
  const measured = await runJobs(stages.map((stage) => ({ kind: 'idle', stage, frames: IDLE_FRAMES, dangerLineEnabled: false })));
  const real = await runJobs(stages.map((stage) => ({ kind: 'idle', stage, frames: IDLE_FRAMES, dangerLineEnabled: true })));
  stages.forEach((stage, index) => {
    assert.ok(measured[index].margin > 0, `stage ${stage} sags to ${measured[index].margin} px from the danger line`);
    assert.equal(real[index].state, GAME_STATES.PLAYING, `stage ${stage} is not playing after ${IDLE_FRAMES} idle frames`);
  });
});

test('(P12) a launcher swap attempt changes nothing in Puzzle', async () => {
  const pin = solutions.twoShot[SWAP_SWEEP_STAGE];
  const { minDeg, maxDeg } = aimRangeDegrees({ game: gameConfig });
  const jobs = [];
  const sweeps = [
    ...grid(roundAngle(minDeg), roundAngle(maxDeg), SEARCH_STEP).flatMap((angle) => [false, true].map((flip) => [
      { angleDeg: angle, flip, special: null }
    ])),
    ...FIRST_AIM_OFFSETS.flatMap((offset) => grid(pin.second.from, pin.second.to, SEARCH_STEP).map((secondAngle) => [
      shotOf(pin.first, roundAngle(pin.first.mid + offset)),
      shotOf(pin.second, secondAngle)
    ]))
  ];
  for (const shots of sweeps) {
    jobs.push(fireJob(SWAP_SWEEP_STAGE, shots, { attemptSwap: false }));
    jobs.push(fireJob(SWAP_SWEEP_STAGE, shots, { attemptSwap: true }));
  }
  const results = await runJobs(jobs);
  const changed = [];
  for (let index = 0; index < results.length; index += 2) {
    try {
      assert.deepEqual(results[index + 1], results[index]);
    } catch {
      changed.push(JSON.stringify(sweeps[index / 2]));
    }
  }
  assert.deepEqual(changed, [], 'shot sequences a swap attempt changed');
});
