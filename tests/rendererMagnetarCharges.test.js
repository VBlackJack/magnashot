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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rendererMagnetarChargesMethods } from '../src/game/RendererMagnetarCharges.js';
import { CHARGE_OUTCOMES } from '../src/game/VersusRules.js';

const gameConfig = JSON.parse(readFileSync(new URL('../configs/game.json', import.meta.url), 'utf8'));
const ballsConfig = JSON.parse(readFileSync(new URL('../configs/balls.json', import.meta.url), 'utf8'));

function makeSpyCtx() {
  const ops = [];
  const state = {
    fillStyle: null,
    strokeStyle: null,
    lineWidth: null,
    lineCap: null,
    lineJoin: null,
    globalAlpha: 1
  };
  return {
    ops,
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v) { state.fillStyle = v; ops.push(['fillStyle', v]); },
    get strokeStyle() { return state.strokeStyle; },
    set strokeStyle(v) { state.strokeStyle = v; ops.push(['strokeStyle', v]); },
    get lineWidth() { return state.lineWidth; },
    set lineWidth(v) { state.lineWidth = v; ops.push(['lineWidth', v]); },
    get lineCap() { return state.lineCap; },
    set lineCap(v) { state.lineCap = v; },
    get lineJoin() { return state.lineJoin; },
    set lineJoin(v) { state.lineJoin = v; },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(v) { state.globalAlpha = v; ops.push(['globalAlpha', v]); },
    save: () => ops.push(['save']),
    restore: () => ops.push(['restore']),
    beginPath: () => ops.push(['beginPath']),
    arc: (...args) => ops.push(['arc', ...args]),
    moveTo: (...args) => ops.push(['moveTo', ...args]),
    lineTo: (...args) => ops.push(['lineTo', ...args]),
    fill: () => ops.push(['fill']),
    stroke: () => ops.push(['stroke']),
    setLineDash: (pattern) => ops.push(['setLineDash', [...pattern]])
  };
}

function makeRenderer({ lite = false, isReducedMotion = false } = {}) {
  return {
    ...rendererMagnetarChargesMethods,
    gameConfig,
    ballsConfig,
    lite,
    isReducedMotion,
    magnetarView: null
  };
}

test('resolveMagnetarView reads either getMagnetarView() or plain magnetarView', () => {
  const renderer = makeRenderer();
  assert.equal(renderer.resolveMagnetarView({}), null);
  assert.equal(renderer.resolveMagnetarView({ magnetarView: 'invalid' }), null);

  const fromGetter = { armed: 'invert', x: 10, y: 20 };
  assert.equal(renderer.resolveMagnetarView({ getMagnetarView: () => fromGetter }), fromGetter);

  const fromProp = { armed: 'barrage', x: 30, y: 40 };
  assert.equal(renderer.resolveMagnetarView({ magnetarView: fromProp }), fromProp);
});

test('drawVersusCharges handles empty guards, draws +, -, strength 2, threat halo, and aim preview', () => {
  const renderer = makeRenderer();
  const emptyCtx = makeSpyCtx();
  renderer.drawVersusCharges(emptyCtx, { physicsWorld: { physicsConfig: { ball: { radius: 20 } } } });
  renderer.drawVersusCharges(emptyCtx, { versus: { charges: [] }, physicsWorld: { physicsConfig: { ball: { radius: 0 } } } });
  assert.equal(emptyCtx.ops.length, 0);

  const ctx = makeSpyCtx();
  const renderCfg = gameConfig.versus.render;
  const ballRadius = 20;
  const expectedRadius = ballRadius * gameConfig.versus.chargeRadius;
  renderer.drawVersusCharges(ctx, {
    versus: {
      threatIds: [2],
      charges: [
        { id: 1, polarity: 1, strength: 1, x: 100, y: 200 },
        { id: 2, polarity: -1, strength: 2, x: 180, y: 220 }
      ]
    },
    aimPreview: {
      chargeHit: { x: 180, y: 220, polarity: 1, outcome: CHARGE_OUTCOMES.DEFLECTED }
    },
    physicsWorld: { physicsConfig: { ball: { radius: ballRadius } } }
  });

  const arcs = ctx.ops.filter(([op]) => op === 'arc');
  // Each charge with trail draws trailSegments arcs + body arc; id 2 also draws strength ring + threat halo; plus preview ring.
  assert.ok(arcs.some(([, x, y, r]) => x === 100 && y === 200 && r === expectedRadius));
  assert.ok(arcs.some(([, x, y, r]) => x === 180 && y === 220 && r === expectedRadius + renderCfg.strengthRingGap));
  assert.ok(arcs.some(([, x, y, r]) => x === 180 && y === 220 && r === expectedRadius + renderCfg.threatHaloGap));
  assert.ok(arcs.some(([, x, y, r]) => x === 180 && y === 220 && r === expectedRadius * renderCfg.previewRingRadiusFactor));

  const strokes = ctx.ops.filter(([op]) => op === 'strokeStyle').map(([, c]) => c);
  assert.ok(strokes.includes(renderCfg.plusColor));
  assert.ok(strokes.includes(renderCfg.minusColor));
  assert.ok(strokes.includes(renderCfg.previewOutcomeColor));

  const dashes = ctx.ops.filter(([op]) => op === 'setLineDash').map(([, d]) => d);
  assert.ok(dashes.some((d) => d.length > 0));
});

test('drawVersusCharges skips rise trail and aim preview when lite is enabled', () => {
  const renderer = makeRenderer({ lite: true });
  const ctx = makeSpyCtx();
  renderer.drawVersusCharges(ctx, {
    versus: { charges: [{ id: 1, polarity: 1, strength: 1, x: 50, y: 60 }] },
    aimPreview: { chargeHit: { x: 50, y: 60, polarity: -1, outcome: CHARGE_OUTCOMES.SHATTERED } },
    physicsWorld: { physicsConfig: { ball: { radius: 20 } } }
  });

  const arcs = ctx.ops.filter(([op]) => op === 'arc');
  assert.equal(arcs.length, 1);
  assert.equal(ctx.ops.filter(([op]) => op === 'moveTo').length, 2, 'only + glyph bars, no preview outcome');
});

test('drawMagnetar draws core, field rings, moorings, telegraphs, and armed glyph', () => {
  const renderer = makeRenderer({ lite: false, isReducedMotion: true });
  const ctx = makeSpyCtx();
  const anchor = { id: 9, x: 240, y: 120 };
  const engineState = {
    physicsWorld: {
      physicsConfig: { ball: { radius: 20 } },
      ballMap: new Map([[9, anchor]])
    },
    magnetarView: {
      x: 160,
      y: 80,
      armed: 'undertow',
      mooringIds: [9],
      regrowSlots: [{ x: 280, y: 140 }],
      undertow: { x: 160, y: 80, radius: 95 },
      barrageMarkers: [{ x: 190, polarity: -1 }]
    }
  };

  renderer.drawMagnetar(ctx, engineState, 0);
  const strokes = ctx.ops.filter(([op]) => op === 'stroke').length;
  assert.ok(strokes >= 8);
  const arcs = ctx.ops.filter(([op]) => op === 'arc');
  assert.ok(arcs.some(([, x, y, r]) => x === 160 && y === 80 && r === 95), 'undertow ring rendered');
  assert.ok(arcs.some(([, x, y, r]) => x === 280 && y === 140 && r === 20), 'regrow slot rendered');
});

test('drawShotPolarityGlyph strokes neutral backdrop before polarity sign', () => {
  const renderer = makeRenderer();
  const ctx = makeSpyCtx();
  const renderCfg = gameConfig.versus.render;
  renderer.drawShotPolarityGlyph(ctx, 120, 400, 8, -1);

  const strokeColors = ctx.ops.filter(([op]) => op === 'strokeStyle').map(([, c]) => c);
  assert.deepEqual(strokeColors, [renderCfg.launcherGlyphBackdrop, renderCfg.minusColor]);
});
