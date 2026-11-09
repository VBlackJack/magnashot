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

import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { Renderer } from '../src/game/Renderer.js';

const gameConfig = applyWorldGeometry(JSON.parse(fs.readFileSync('./configs/game.json', 'utf8')));
const RING = gameConfig.resonance.ring;
const WINDOW = gameConfig.resonance.windowFrames;
const FRAMES_PER_BEAT = 37.5;
const THEME = { launcherAccentColor: '#38bdf8' };

/** A drawing context that records the arcs, dashes, widths and alphas it is given. */
const createRecorder = () => {
  const log = { arcs: [], dashes: [], widths: [], alphas: [], strokes: 0, fills: 0, saves: 0, restores: 0, strokeStyles: [] };
  let alpha = 1;
  let dash = [];
  let width = 1;
  let style = null;
  const ctx = {
    save: () => { log.saves++; },
    restore: () => { log.restores++; },
    beginPath: () => {},
    arc: (x, y, r) => log.arcs.push({ x, y, r, alpha, dash, width }),
    stroke: () => { log.strokes++; log.strokeStyles.push(style); },
    fill: () => { log.fills++; },
    setLineDash: (value) => { dash = value; log.dashes.push(value); },
    set globalAlpha(value) { alpha = value; log.alphas.push(value); },
    set lineWidth(value) { width = value; log.widths.push(value); },
    set strokeStyle(value) { style = value; },
    set fillStyle(value) {}
  };
  return { ctx, log };
};

const createRenderer = ({ reducedMotion = false, highContrast = false } = {}) => {
  const renderer = Object.create(Renderer.prototype);
  renderer.gameConfig = gameConfig;
  renderer.isReducedMotion = reducedMotion;
  renderer.highContrast = highContrast;
  return renderer;
};

const beatState = (frame, resonanceActive = true) => ({
  beatFrame: frame,
  offsetFrames: 0,
  framesPerBeat: FRAMES_PER_BEAT,
  windowFrames: WINDOW,
  resonanceActive
});

const draw = (renderer, state, extra = {}) => {
  const { ctx, log } = createRecorder();
  renderer.drawBeatRing(ctx, { getBeatState: () => state, ...extra }, THEME);
  return log;
};

test('the ring is drawn only while Resonance is active on the board', () => {
  const renderer = createRenderer();
  assert.equal(draw(renderer, beatState(10, false)).arcs.length, 0, 'inactive board');
  assert.ok(draw(renderer, beatState(10)).arcs.length > 0, 'active board');
  const { ctx, log } = createRecorder();
  renderer.drawBeatRing(ctx, {}, THEME);
  assert.equal(log.arcs.length, 0, 'an engine state without a beat clock draws nothing');
});

test('outside the window the ring is thin and dashed; inside it is solid and thick', () => {
  const renderer = createRenderer();
  const outside = draw(renderer, beatState(Math.round(FRAMES_PER_BEAT / 2)));
  const inside = draw(renderer, beatState(0));
  const outsideMain = outside.arcs.at(-1);
  const insideMain = inside.arcs.at(-1);
  assert.deepEqual(outsideMain.dash, RING.dashPattern, 'dashed outside');
  assert.deepEqual(insideMain.dash, [], 'solid inside');
  assert.equal(outsideMain.width, RING.lineWidth);
  assert.equal(insideMain.width, RING.windowLineWidth);
  assert.ok(insideMain.width > outsideMain.width);
  assert.equal(inside.arcs.length, 2, 'the open window adds a brighter band');
  assert.equal(outside.arcs.length, 1);
});

test('the ring shrinks onto the launcher over each beat', () => {
  const renderer = createRenderer();
  const early = draw(renderer, beatState(WINDOW + 1)).arcs.at(-1).r;
  const late = draw(renderer, beatState(Math.floor(FRAMES_PER_BEAT) - WINDOW - 1)).arcs.at(-1).r;
  assert.ok(early > late, 'it is wide just after a beat and narrow just before the next');
  const onBeat = draw(renderer, beatState(0)).arcs.at(-1).r;
  assert.ok(onBeat < late);
});

test('reduced motion keeps the radius fixed and moves only the opacity', () => {
  const renderer = createRenderer({ reducedMotion: true });
  const first = draw(renderer, beatState(WINDOW + 1));
  const later = draw(renderer, beatState(Math.floor(FRAMES_PER_BEAT) - WINDOW - 1));
  assert.equal(first.arcs.at(-1).r, later.arcs.at(-1).r, 'the radius does not shrink');
  assert.ok(later.arcs.at(-1).alpha > first.arcs.at(-1).alpha, 'the opacity rises toward the beat');
  const flashing = draw(renderer, beatState(0), { resonanceFlashFrames: RING.flashFrames });
  assert.equal(flashing.fills, 0, 'no flash under reduced motion');
});

test('high contrast switches to a white ring with heavier lines', () => {
  const normal = draw(createRenderer(), beatState(0));
  const contrast = draw(createRenderer({ highContrast: true }), beatState(0));
  assert.equal(contrast.strokeStyles.at(-1), RING.highContrastColor);
  assert.notEqual(normal.strokeStyles.at(-1), RING.highContrastColor);
  assert.ok(contrast.arcs.at(-1).width > normal.arcs.at(-1).width);
});

test('a Resonant release flashes the launcher and the drawing stays balanced', () => {
  const renderer = createRenderer();
  const flashing = draw(renderer, beatState(0), { resonanceFlashFrames: RING.flashFrames });
  assert.equal(flashing.fills, 1);
  assert.equal(flashing.saves, flashing.restores);
  assert.equal(draw(renderer, beatState(0)).fills, 0, 'no flash without a release');
});
