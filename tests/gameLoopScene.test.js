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

import { createGameLoop, SCENE_TIME_SCALE_FIXED } from '../src/game/GameLoop.js';
import { createGameLoop as createFrozenGameLoop } from './fixtures/GameLoop.v1.19.0.js';
import { GAME_STATES } from '../src/core/Constants.js';

const FIXED_STEP_MS = 10;
const MAX_ACCUMULATED_MS = 100;
const IDLE_INTERVAL_MS = 50;
const FRAME_DELTA_MS = 7;
const FRAME_COUNT = 120;
const SLOW_MOTION_FROM_FRAME = 30;
const SLOW_MOTION_SCALE = 0.4;
const HIT_STOP_FROM_FRAME = 60;
const HIT_STOP_UNTIL_FRAME = 80;
const HIT_STOP_FRAMES = 3;
const PAUSE_FROM_FRAME = 90;
const PAUSE_UNTIL_FRAME = 105;
const MIXED_SCALE_FRAMES = 40;
const LOCKSTEP_FRAMES = 12;

/** Builds a fake engine/renderer pair that logs every call into the shared log. */
function makeBoard(log, name, overrides = {}) {
  const engine = {
    state: GAME_STATES.PLAYING,
    hitStopFrames: 0,
    stageTransitionFrames: 0,
    update: () => log.push(`${name}:update`),
    refreshAimPreview: () => log.push(`${name}:aim`),
    isVictoryCelebrating: () => false,
    ...overrides
  };
  const renderer = {
    render: (e, alpha) => log.push(`${name}:render:${e === engine}:${alpha}`)
  };
  return { engine, renderer };
}

/** Creates a loop on a fake clock; frame i is delivered at i * FRAME_DELTA_MS. */
function makeLoop(loopOptions) {
  const errors = [];
  const loop = createGameLoop({
    fixedStepMs: FIXED_STEP_MS,
    maxAccumulatedMs: MAX_ACCUMULATED_MS,
    idleRenderIntervalMs: IDLE_INTERVAL_MS,
    scheduleFrame: () => {},
    onFatalError: (err) => errors.push(err),
    ...loopOptions
  });
  return { loop, errors };
}

function runFrames(loop, frames, beforeEachFrame) {
  for (let i = 0; i < frames; i++) {
    beforeEachFrame?.(i);
    loop.frame(i * FRAME_DELTA_MS);
  }
}

function scriptFor(engine) {
  return (i) => {
    engine.getTimeScale = () => (i >= SLOW_MOTION_FROM_FRAME ? SLOW_MOTION_SCALE : 1);
    engine.hitStopFrames = i >= HIT_STOP_FROM_FRAME && i < HIT_STOP_UNTIL_FRAME ? HIT_STOP_FRAMES : 0;
    engine.state = i >= PAUSE_FROM_FRAME && i < PAUSE_UNTIL_FRAME ? GAME_STATES.PAUSED : GAME_STATES.PLAYING;
  };
}

test('A one-board scene behaves exactly like the engine and renderer form', () => {
  const legacyLog = [];
  const legacy = makeBoard(legacyLog, 'b');
  runFrames(makeLoop({ engine: legacy.engine, renderer: legacy.renderer }).loop, FRAME_COUNT, scriptFor(legacy.engine));

  const sceneLog = [];
  const scened = makeBoard(sceneLog, 'b');
  runFrames(makeLoop({ getScene: () => ({ boards: [scened] }) }).loop, FRAME_COUNT, scriptFor(scened.engine));

  assert.ok(legacyLog.includes('b:update'));
  assert.ok(legacyLog.some((entry) => entry.startsWith('b:render:true:1')), 'frozen frames render with alpha 1');
  assert.deepEqual(sceneLog, legacyLog);
});

test('The one-board loop matches the frozen v1.19.0 loop call for call', () => {
  const frameDeltas = [FRAME_DELTA_MS, 3, 16];
  for (const delta of frameDeltas) {
    const frames = Math.ceil((FRAME_COUNT * FRAME_DELTA_MS) / delta);
    const run = (factory, wrap) => {
      const log = [];
      const board = makeBoard(log, 'b');
      const script = scriptFor(board.engine);
      const loop = factory({
        ...wrap(board),
        fixedStepMs: FIXED_STEP_MS,
        maxAccumulatedMs: MAX_ACCUMULATED_MS,
        idleRenderIntervalMs: IDLE_INTERVAL_MS,
        scheduleFrame: () => {},
        onFatalError: (err) => log.push(`fatal:${err.message}`),
        beforeFrame: (now, elapsed) => log.push(`before:${now}:${elapsed}`)
      });
      for (let i = 0; i < frames; i++) {
        // The scripted phases are defined on the 7 ms frame index, whatever the real delta is.
        script(Math.floor((i * delta) / FRAME_DELTA_MS));
        loop.frame(i * delta);
      }
      return log;
    };
    const frozenLog = run(createFrozenGameLoop, (board) => ({ engine: board.engine, renderer: board.renderer }));
    const currentLog = run(createGameLoop, (board) => ({ engine: board.engine, renderer: board.renderer }));
    const sceneLog = run(createGameLoop, (board) => ({ getScene: () => ({ boards: [board] }) }));
    assert.ok(frozenLog.some((entry) => entry === 'b:update'), 'the reference run steps the engine');
    assert.ok(frozenLog.some((entry) => entry.startsWith('b:render')), 'the reference run renders');
    assert.deepEqual(currentLog, frozenLog, `engine/renderer form, ${delta} ms frames`);
    assert.deepEqual(sceneLog, frozenLog, `one-board scene form, ${delta} ms frames`);
  }
});

test('Two boards step in lockstep, board 0 then board 1, and render after stepping', () => {
  const log = [];
  const a = makeBoard(log, 'a');
  const b = makeBoard(log, 'b');
  const { loop } = makeLoop({ getScene: () => ({ versus: true, boards: [a, b] }) });
  loop.frame(0);
  log.length = 0;
  loop.frame(FIXED_STEP_MS * 2);
  assert.deepEqual(log.slice(0, 6), ['a:update', 'b:update', 'a:update', 'b:update', 'a:aim', 'b:aim']);
  assert.ok(log[6].startsWith('a:render:true:'));
  assert.ok(log[7].startsWith('b:render:true:'));
  assert.equal(log.length, 8);
});

test('Boards share a single accumulator and the same step count', () => {
  const log = [];
  const a = makeBoard(log, 'a');
  const b = makeBoard(log, 'b');
  const { loop } = makeLoop({ getScene: () => ({ versus: true, boards: [a, b] }) });
  runFrames(loop, LOCKSTEP_FRAMES + 1);
  const countA = log.filter((entry) => entry === 'a:update').length;
  const countB = log.filter((entry) => entry === 'b:update').length;
  assert.equal(countA, countB);
  assert.equal(countA, Math.floor((LOCKSTEP_FRAMES * FRAME_DELTA_MS) / FIXED_STEP_MS));
});

test('A fixed-time scene ignores slow motion and hit-stop; a plain scene honours slow motion', () => {
  const countUpdates = (scene) => {
    const log = [];
    const board = makeBoard(log, 'a', { getTimeScale: () => SLOW_MOTION_SCALE, hitStopFrames: HIT_STOP_FRAMES });
    runFrames(makeLoop({ getScene: () => ({ ...scene, boards: [board] }) }).loop, MIXED_SCALE_FRAMES);
    return log.filter((entry) => entry === 'a:update').length;
  };
  const expectedFull = Math.floor(((MIXED_SCALE_FRAMES - 1) * FRAME_DELTA_MS) / FIXED_STEP_MS);
  assert.equal(countUpdates({ versus: true }), expectedFull);
  assert.equal(countUpdates({ timeScale: SCENE_TIME_SCALE_FIXED }), expectedFull);
  assert.ok(countUpdates({}) < expectedFull);

  // Hit-stop does not force alpha to 1 in a fixed-time scene.
  const log = [];
  const board = makeBoard(log, 'a', { hitStopFrames: HIT_STOP_FRAMES });
  runFrames(makeLoop({ getScene: () => ({ versus: true, boards: [board] }) }).loop, MIXED_SCALE_FRAMES);
  const alphas = log.filter((entry) => entry.startsWith('a:render')).map((entry) => Number(entry.split(':')[3]));
  assert.ok(alphas.some((alpha) => alpha < 1));
});

test('An exception in one board stops the loop and is reported once', () => {
  const log = [];
  const a = makeBoard(log, 'a');
  const b = makeBoard(log, 'b', {
    update: () => {
      throw new Error('boom');
    }
  });
  const { loop, errors } = makeLoop({ getScene: () => ({ versus: true, boards: [a, b] }) });
  loop.frame(0);
  loop.frame(FIXED_STEP_MS);
  loop.frame(FIXED_STEP_MS * 2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'boom');
  assert.equal(loop.isStopped(), true);
});
