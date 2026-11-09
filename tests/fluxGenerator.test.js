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

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { LAYOUT_TYPES } from '../src/core/Constants.js';
import { generateLayout, MASK_CELLS } from '../src/game/layouts/LayoutGenerators.js';
import { FLUX_FAMILIES, generateFluxStage, listValidGeneratedParams } from '../src/game/layouts/FluxStageGenerator.js';
import {
  GENERATED_FILLS,
  GENERATED_SHAPE_TYPES,
  buildGeneratedRows,
  decodeGeneratedShapeId,
  encodeGeneratedShapeId,
  maskFingerprint
} from '../src/game/layouts/ShapeGenerator.js';
import {
  fluxPoolHash,
  fluxShapeTuningFingerprint,
  fluxShapeTuningId,
  idleSettleFluxRun
} from '../scripts/bot/SettleProbe.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const physicsConfig = loadJson('./configs/physics.json');
const fluxConfig = loadJson('./configs/flux.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const locales = { fr: loadJson('./locales/fr.json'), en: loadJson('./locales/en.json') };

/** The variety the generator promises. */
const MIN_DISTINCT_SHAPES = 1000;
/** How far the sampled share of generated shapes may stray from the configured weight. */
const SHARE_TOLERANCE = 0.05;
const SAMPLE_SEEDS = 60;
const SAMPLE_STAGES = 30;
/** Parameter sets checked for a lossless id round trip. */
const ROUND_TRIP_SAMPLE = 50;

const generated = fluxConfig.generated;
const valid = listValidGeneratedParams(generated);
const buildRows = (params) => buildGeneratedRows(params, generated.limits);

test('The generator yields at least 1000 distinct playable shapes, from every shape type', () => {
  const fingerprints = new Set(valid.map((params) => maskFingerprint(buildRows(params))));
  assert.ok(
    fingerprints.size >= MIN_DISTINCT_SHAPES,
    `${fingerprints.size} distinct shapes, at least ${MIN_DISTINCT_SHAPES} expected`
  );
  const types = new Set(valid.map((params) => params.type));
  assert.deepEqual([...types].sort(), Object.values(GENERATED_SHAPE_TYPES).sort());
});

test('Every generated shape fits the board and hangs from its anchors', () => {
  const canvas = gameConfig.canvas;
  const radius = physicsConfig.ball.radius;
  const lowestAllowedY = canvas.dangerLineY - canvas.dangerWarningMarginY;
  const bondReach = radius * physicsConfig.simulation.bondCreationDistanceFactor;
  const { centerX, spacing, maskTopY } = fluxConfig.layout;
  for (const params of valid) {
    const label = encodeGeneratedShapeId(params);
    const rows = buildRows(params);
    const balls = generateLayout({ type: LAYOUT_TYPES.MASK, rows, centerX, topY: maskTopY, spacing }).balls.map((b) => ({
      ...b,
      x: b.x + canvas.contentOffsetX
    }));
    for (const ball of balls) {
      assert.ok(ball.x - radius >= canvas.wallMargin, `${label} clears the left wall`);
      assert.ok(ball.x + radius <= canvas.logicalWidth - canvas.wallMargin, `${label} clears the right wall`);
      assert.ok(ball.y + radius <= lowestAllowedY, `${label} stays above the warning line`);
    }
    // Every sphere reaches an anchor through spheres close enough to bond.
    const reached = new Set();
    balls.forEach((b, i) => b.isAnchor && reached.add(i));
    assert.ok(reached.size > 0, `${label} has an anchor`);
    const queue = [...reached];
    for (let head = 0; head < queue.length; head++) {
      const a = balls[queue[head]];
      balls.forEach((b, i) => {
        if (!reached.has(i) && Math.hypot(a.x - b.x, a.y - b.y) <= bondReach) {
          reached.add(i);
          queue.push(i);
        }
      });
    }
    assert.equal(reached.size, balls.length, `${label} hangs together`);
  }
});

test('A generated shape id rebuilds the same shape, neutral anchors included', () => {
  for (const params of valid.slice(0, ROUND_TRIP_SAMPLE)) {
    const withNeutral = { ...params, neutralAnchors: true };
    const decoded = decodeGeneratedShapeId(encodeGeneratedShapeId(withNeutral));
    assert.deepEqual(buildRows({ ...decoded, rotation: params.rotation }), buildRows(withNeutral));
  }
  const rows = buildRows({ ...valid[0], neutralAnchors: true }).join('');
  const anchorCount = [...rows].filter((c) => c === MASK_CELLS.ANCHOR || c === MASK_CELLS.NEUTRAL_ANCHOR).length;
  if (anchorCount > 1) {
    assert.ok(!rows.includes(MASK_CELLS.ANCHOR), 'with several anchors, all of them turn neutral');
  }
});

test('Generated shapes take about their configured share of the Flux draw', () => {
  let generatedCount = 0;
  let total = 0;
  for (let seed = 0; seed < SAMPLE_SEEDS; seed++) {
    let previousFamily = null;
    for (let stage = 1; stage <= SAMPLE_STAGES; stage++) {
      const stageDef = generateFluxStage({
        seed: `share-${seed}`,
        stage,
        previousFamily,
        fluxConfig,
        obstaclesConfig,
        ballRadius: physicsConfig.ball.radius
      });
      previousFamily = stageDef.family;
      generatedCount += stageDef.family === FLUX_FAMILIES.GENERATED ? 1 : 0;
      total++;
    }
  }
  const weights = fluxConfig.familyWeights;
  const expected = weights.generated / Object.values(weights).reduce((sum, w) => sum + w, 0);
  const share = generatedCount / total;
  assert.ok(Math.abs(share - expected) <= SHARE_TOLERANCE, `generated share ${share.toFixed(2)}, about ${expected} expected`);
});

test('Every generated shape type and fill has a name in both languages', () => {
  for (const [lang, dict] of Object.entries(locales)) {
    for (const type of Object.values(GENERATED_SHAPE_TYPES)) {
      for (const fill of Object.values(GENERATED_FILLS)) {
        const text = dict.gameplay.flux.generated?.[type]?.[fill];
        assert.equal(typeof text, 'string', `${lang}: gameplay.flux.generated.${type}.${fill}`);
      }
    }
  }
});

// --- Settled shape pool (configs/fluxShapeTuning.json) ---

const fluxShapeTuning = loadJson('./configs/fluxShapeTuning.json');
const ballsConfig = loadJson('./configs/balls.json');
const levelsConfig = loadJson('./configs/levels.json');
const campaignConfig = loadJson('./configs/campaign.json');
const audioConfig = loadJson('./configs/audio.json');
const shapeSettle = fluxConfig.shapeSettle;
const probeConfigs = {
  game: gameConfig,
  physics: physicsConfig,
  balls: ballsConfig,
  obstacles: obstaclesConfig,
  levels: levelsConfig,
  campaign: campaignConfig,
  audio: audioConfig,
  flux: fluxConfig
};
// StorageManager reads the shared registry, as the app does.
for (const [key, value] of Object.entries(probeConfigs)) {
  configRegistry.configs.set(key, value);
}

/**
 * Pool hash of the settled shapes, by Ghost Duel content version of Flux. Changing the pool
 * or the threshold changes the shapes a seed draws, so it changes this hash and must come with
 * a content version bump (and a new entry here).
 */
const POOL_HASH_BY_CONTENT_VERSION = Object.freeze({ 3: 'b03d380bbdafc3bd' });
/** Generation-only sweep of the settled pool. */
const SETTLED_MIN_DISTINCT_SHAPES = 850;
/** Smallest margin a regression stage may settle to, in pixels. */
const REGRESSION_MIN_MARGIN_PX = 72;
/** Frames of the regression settles: long enough for the slow sag, short enough for the fast suite. */
const REGRESSION_SETTLE_FRAMES = 900;
/**
 * Run stages that sagged past the danger line before the settled pool: [seed, stage, offset of
 * the replayable stream from settleSeedBase]. All but the last come from the slow suite's runs.
 */
const REGRESSION_STAGES = Object.freeze([
  ['slow-settle-0', 11, 0],
  ['slow-settle-0', 13, 0],
  ['slow-settle-42', 15, 42],
  ['slow-settle-56', 19, 56],
  ['sweep-101', 14, 0]
]);

const tuningIdOf = (id) => fluxShapeTuningId(decodeGeneratedShapeId(id));
const stageOptions = { fluxConfig, obstaclesConfig, ballRadius: physicsConfig.ball.radius };
const settledPool = listValidGeneratedParams(generated, fluxShapeTuning.margins, shapeSettle.minMarginPx);

test('The settle table matches the configs it was measured with and covers every shape', () => {
  assert.equal(
    fluxShapeTuning.fingerprint,
    fluxShapeTuningFingerprint(probeConfigs),
    'the shapes, physics or board changed since the table was measured: run npm run calibrate:flux'
  );
  assert.equal(fluxShapeTuning.frames, shapeSettle.frames, 'run npm run calibrate:flux');
  const missing = valid.map(fluxShapeTuningId).filter((id) => !Number.isInteger(fluxShapeTuning.margins[id]));
  assert.deepEqual(missing, [], 'shapes without a settle margin: run npm run calibrate:flux');
  assert.equal(Object.keys(fluxShapeTuning.margins).length, valid.length, 'no stale entry: run npm run calibrate:flux');
});

test('The settled pool is pinned to the Ghost Duel content version of Flux', () => {
  const accepted = valid.map(fluxShapeTuningId).filter((id) => fluxShapeTuning.margins[id] >= shapeSettle.minMarginPx);
  assert.equal(fluxPoolHash(accepted), fluxShapeTuning.poolHash, 'the table was written for another threshold: run npm run calibrate:flux');
  assert.equal(
    POOL_HASH_BY_CONTENT_VERSION[gameConfig.ghostDuel.contentVersion.flux],
    fluxShapeTuning.poolHash,
    'changing the pool or threshold requires a ghostDuel.contentVersion.flux bump'
  );
  assert.equal(
    shapeSettle.sinceContentVersion,
    gameConfig.ghostDuel.contentVersion.flux,
    'the settled pool starts at the current content version'
  );
});

test('The settled pool keeps the variety, every shape type and every size', () => {
  const fingerprints = new Set(settledPool.map((params) => maskFingerprint(buildRows(params))));
  assert.ok(
    fingerprints.size >= SETTLED_MIN_DISTINCT_SHAPES,
    `${fingerprints.size} distinct settled shapes, at least ${SETTLED_MIN_DISTINCT_SHAPES} expected`
  );
  assert.deepEqual(
    [...new Set(settledPool.map((params) => params.type))].sort(),
    Object.values(GENERATED_SHAPE_TYPES).sort(),
    'every shape type survives the settle'
  );
  for (const radiusCells of generated.radiusCells) {
    assert.ok(settledPool.some((params) => params.radiusCells === radiusCells), `a settled shape of radius ${radiusCells}`);
  }
  // The generator falls back to the whole pool only when no shape fits the stage's largest
  // radius; the smallest radius is always allowed, so a settled pool holding it never falls back.
  assert.ok(settledPool.some((params) => params.radiusCells === generated.radiusCells[0]), 'no draw falls back');
});

test('Flux draws only settled shapes, and nothing else about a stage changes', () => {
  let generatedStages = 0;
  for (let seed = 0; seed < SAMPLE_SEEDS; seed++) {
    let previousFamily = null;
    for (let stage = 1; stage <= SAMPLE_STAGES; stage++) {
      const options = { ...stageOptions, seed: `sweep-${seed}`, stage, previousFamily };
      const settled = generateFluxStage({ ...options, shapeMargins: fluxShapeTuning.margins });
      const plain = generateFluxStage(options);
      previousFamily = settled.family;
      assert.equal(settled.family, plain.family, 'the family draw is the same');
      if (settled.family === FLUX_FAMILIES.GENERATED) {
        generatedStages++;
        for (const id of settled.shapeIds) {
          assert.ok(
            fluxShapeTuning.margins[tuningIdOf(id)] >= shapeSettle.minMarginPx,
            `seed ${seed} stage ${stage}: ${id} must hang clear of the danger line`
          );
        }
        assert.equal(settled.isBoss, plain.isBoss);
        assert.equal(settled.paletteCount, plain.paletteCount);
      } else {
        assert.deepEqual(settled, plain, `seed ${seed} stage ${stage}: other families are untouched`);
      }
    }
  }
  assert.ok(generatedStages > 0, 'the sweep reaches generated shapes');
});

test('The campaign and the unfiltered call keep drawing from every valid shape', () => {
  assert.equal(listValidGeneratedParams(generated).length, valid.length);
  assert.deepEqual(listValidGeneratedParams(generated, null), valid);
  assert.ok(settledPool.length < valid.length, 'the settled pool is a subset');
  assert.equal(listValidGeneratedParams(generated, fluxShapeTuning.margins, shapeSettle.minMarginPx), settledPool, 'cached per table');
  assert.deepEqual(listValidGeneratedParams(generated, {}, shapeSettle.minMarginPx), [], 'a shape missing from the table is rejected');
});

test('Flux is wired to the settle table: path, precache and engine', () => {
  const constantsSource = fs.readFileSync('./src/core/Constants.js', 'utf8');
  assert.match(constantsSource, /FLUX_SHAPE_TUNING: '\.\/configs\/fluxShapeTuning\.json'/);
  assert.match(fs.readFileSync('./sw.js', 'utf8'), /'\.\/configs\/fluxShapeTuning\.json'/);
  const mainSource = fs.readFileSync('./src/main.js', 'utf8');
  assert.match(mainSource, /configRegistry\.get\('flux_shape_tuning'\)/);
  assert.equal((mainSource.match(/^\s+fluxShapeTuning,$/gm) ?? []).length, 2, 'the engine and the versus boards get the table');
});

test('Stages that sagged past the danger line before the settled pool now settle clear of it', () => {
  for (const [seed, stage, streamOffset] of REGRESSION_STAGES) {
    const settleStage = (tuning) => idleSettleFluxRun(probeConfigs, tuning, {
      seed,
      stageCount: stage,
      frames: REGRESSION_SETTLE_FRAMES,
      lcgSeed: shapeSettle.settleSeedBase + streamOffset,
      settleFromStage: stage
    })[0];
    const [before, result] = [settleStage(null), settleStage(fluxShapeTuning)];
    assert.ok(
      before.margin < REGRESSION_MIN_MARGIN_PX,
      `control: ${seed} stage ${stage} sags without the settled pool (${before.margin.toFixed(1)} px)`
    );
    assert.equal(result.stage, stage);
    assert.ok(
      result.margin >= REGRESSION_MIN_MARGIN_PX,
      `${seed} stage ${stage} (${result.shapeIds.join(', ')}) settles ${result.margin.toFixed(1)} px above the line, ${REGRESSION_MIN_MARGIN_PX} expected`
    );
  }
});
