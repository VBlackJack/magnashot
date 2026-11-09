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
 * Idle settle probe for campaign levels and Flux shapes: lets a board sag with no shot fired and reports how
 * close the lowest sphere comes to the danger line. A cluster hanging from few anchors sags
 * after the first frame, so a board that looks safe on frame 0 can still be lost idle.
 */

import { StorageManager } from '../../src/core/StorageManager.js';
import { GameEngine } from '../../src/game/GameEngine.js';
import { GAME_STATES } from '../../src/core/Constants.js';
import { FLUX_FAMILIES, listValidGeneratedParams } from '../../src/game/layouts/FluxStageGenerator.js';
import { encodeGeneratedShapeId } from '../../src/game/layouts/ShapeGenerator.js';

const SILENT_AUDIO = Object.freeze({ playEffect() {}, stopAll() {}, isMuted: () => true, setMuted() {} });
/** Linear congruential generator (Numerical Recipes), so a settle can be replayed. */
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_RANGE = 4294967296;
/** Stands for "no danger line": the settle is measured, not judged, by the engine. */
const DISABLED_DANGER_LINE_Y = Number.MAX_SAFE_INTEGER;

/**
 * Settles one campaign level with no shot and measures its lowest point.
 * The engine's own danger check is switched off (on a private copy of the game config), so a
 * board that sags past the line is still measured instead of ending the run.
 * @param {object} configs - Loaded configs: game, physics, balls, obstacles, levels, campaign, flux.
 * @param {object} campaignTuning - The tuning the level is built with (`{levels: {[id]: entry}}`).
 * @param {number} levelId - Campaign level.
 * @returns {{margin: number, frames: number}} The smallest distance, in logical pixels, between
 *   the lowest sphere bottom and the real danger line over the settle (negative when it crosses).
 */
export function idleSettleMargin(configs, campaignTuning, levelId) {
  const { settleFrames, settleSeedBase } = configs.campaign.generated.calibration;
  const dangerLineY = configs.game.canvas.dangerLineY;
  const gameConfig = { ...configs.game, canvas: { ...configs.game.canvas, dangerLineY: DISABLED_DANGER_LINE_Y } };
  let seed = settleSeedBase + levelId;
  const realRandom = Math.random;
  Math.random = () => {
    seed = (Math.imul(seed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return seed / UINT32_RANGE;
  };
  try {
    const storageManager = new StorageManager();
    storageManager.init();
    // Same footing as the calibration bots: no Resonance bonus.
    storageManager.setResonanceEnabled(false);
    const engine = new GameEngine({
      gameConfig,
      physicsConfig: configs.physics,
      ballsConfig: configs.balls,
      obstaclesConfig: configs.obstacles,
      levelsConfig: configs.levels,
      campaignConfig: configs.campaign,
      campaignTuning,
      fluxConfig: configs.flux,
      audioManager: SILENT_AUDIO,
      storageManager,
      onStateChange() {}
    });
    engine.startCampaignLevel(levelId);
    let margin = Infinity;
    for (let frame = 0; frame < settleFrames; frame++) {
      engine.update();
      for (const ball of engine.physicsWorld.balls) {
        margin = Math.min(margin, dangerLineY - (ball.y + ball.radius));
      }
    }
    return { margin, frames: settleFrames };
  } finally {
    Math.random = realRandom;
  }
}

/** FNV-1a parameters of the tuning fingerprints, two 32-bit lanes for 64 bits. */
const FNV_PRIME = 0x01000193;
const FNV_OFFSETS = Object.freeze([0x811c9dc5, 0x050c5d1f]);
const HEX_RADIX = 16;
const LANE_HEX_DIGITS = 8;
/** Run seed and stage of the Flux shape settle: stage 1 has no obstacle to move the board. */
const FLUX_SETTLE_SEED = 'settle';
const FLUX_SETTLE_STAGE = 1;
/** Separator of the ids in the pool hash. */
const POOL_ID_SEPARATOR = '\n';

/** 64-bit FNV-1a of a text, as 16 hex digits. */
function fnv64Hex(text) {
  return FNV_OFFSETS.map((offset) => {
    let hash = offset;
    for (let i = 0; i < text.length; i++) {
      hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
    }
    return hash.toString(HEX_RADIX).padStart(LANE_HEX_DIGITS, '0');
  }).join('');
}

/**
 * Id under which a generated shape's settle margin is stored: the shape without neutral
 * anchors, which the settle measures.
 * @param {object} params - A parameter set of the generated shapes.
 * @returns {string} The shape id.
 */
export function fluxShapeTuningId(params) {
  return encodeGeneratedShapeId({ ...params, neutralAnchors: false });
}

/**
 * Parameter sets of every valid generated shape, in the generator's order: the pool the
 * campaign draws from, and so the set the settle table must cover.
 * @param {object} fluxConfig - configs/flux.json.
 * @returns {object[]} Parameter sets.
 */
export function listFluxShapesToSettle(fluxConfig) {
  return listValidGeneratedParams(fluxConfig.generated);
}

/**
 * Hash of a list of shape ids, in order. It identifies the pool a Flux run draws from, so the
 * Ghost Duel content version moves whenever the pool does.
 * @param {string[]} ids - Shape ids.
 * @returns {string} 16 hex digits.
 */
export function fluxPoolHash(ids) {
  return fnv64Hex(ids.join(POOL_ID_SEPARATOR));
}

/**
 * Fingerprint of everything an idle Flux settle depends on: the shapes, the physics, the
 * board geometry and the first stage's setup. The settle table is only valid for the
 * fingerprint it was measured with.
 * @param {object} configs - Loaded configs: game, physics, balls, obstacles, flux.
 * @returns {string} 16 hex digits.
 */
export function fluxShapeTuningFingerprint(configs) {
  const { canvas } = configs.game;
  const flux = configs.flux;
  return fnv64Hex(JSON.stringify({
    shapeIds: listFluxShapesToSettle(flux).map(fluxShapeTuningId),
    canvas: {
      logicalWidth: canvas.logicalWidth,
      logicalHeight: canvas.logicalHeight,
      designWidth: canvas.designWidth,
      dangerLineBottomOffset: canvas.dangerLineBottomOffset
    },
    physics: configs.physics,
    clusterModifiers: configs.balls.clusterModifiers,
    obstacles: configs.obstacles,
    layout: flux.layout,
    palette: flux.palette[0],
    modifiers: flux.modifiers[0],
    introFrames: flux.transition.introFrames,
    generated: flux.generated,
    settleFrames: flux.shapeSettle.frames
  }));
}

/**
 * Runs `work` with Math.random replaced by a replayable stream, and restores it afterwards.
 * @param {number} lcgSeed - Start of the stream.
 * @param {() => *} work - Called with the stream in place.
 */
function withReplayableRandom(lcgSeed, work) {
  let seed = lcgSeed;
  const realRandom = Math.random;
  Math.random = () => {
    seed = (Math.imul(seed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return seed / UINT32_RANGE;
  };
  try {
    return work();
  } finally {
    Math.random = realRandom;
  }
}

/**
 * Engine for a Flux settle: the danger check is off (a private copy of the game config), so a
 * board that sags past the line is measured instead of ending the run, and the Resonance bonus
 * is off as for the calibration bots.
 * @param {object} configs - Loaded configs: game, physics, balls, obstacles, levels, campaign, flux.
 * @param {object|null} fluxShapeTuning - configs/fluxShapeTuning.json, or null for the previous shapes.
 * @returns {GameEngine}
 */
function createFluxSettleEngine(configs, fluxShapeTuning) {
  const storageManager = new StorageManager();
  storageManager.init();
  storageManager.setResonanceEnabled(false);
  return new GameEngine({
    gameConfig: { ...configs.game, canvas: { ...configs.game.canvas, dangerLineY: DISABLED_DANGER_LINE_Y } },
    physicsConfig: configs.physics,
    ballsConfig: configs.balls,
    obstaclesConfig: configs.obstacles,
    levelsConfig: configs.levels,
    campaignConfig: configs.campaign,
    fluxConfig: configs.flux,
    fluxShapeTuning,
    audioManager: SILENT_AUDIO,
    storageManager,
    onStateChange() {}
  });
}

/** Lets the board of the engine sag for `frames` frames and returns its smallest margin to the line. */
function settleBoard(engine, dangerLineY, frames) {
  engine.currentBall = engine.createRandomLauncherBall();
  engine.nextBall = engine.createRandomLauncherBall();
  engine.fillUpcomingColors();
  engine.state = GAME_STATES.PLAYING;
  let margin = Infinity;
  for (let frame = 0; frame < frames; frame++) {
    engine.update();
    for (const ball of engine.physicsWorld.balls) {
      margin = Math.min(margin, dangerLineY - (ball.y + ball.radius));
    }
  }
  return margin;
}

/**
 * Settles one generated Flux shape with no shot and measures its lowest point. The shape is
 * built by the real Flux stage path (first stage, no boss, no obstacle) with the settle table
 * narrowed to that shape, so the board is the one a run would draw.
 * @param {object} configs - Loaded configs: game, physics, balls, obstacles, levels, campaign, flux.
 * @param {object} params - A parameter set from listFluxShapesToSettle.
 * @returns {{margin: number, frames: number}} The smallest distance, in logical pixels, between
 *   the lowest sphere bottom and the real danger line over the settle.
 */
export function idleSettleFluxShape(configs, params) {
  const { frames, minMarginPx, settleSeedBase } = configs.flux.shapeSettle;
  return withReplayableRandom(settleSeedBase, () => {
    const engine = createFluxSettleEngine(configs, null);
    engine.initFluxRun(FLUX_SETTLE_SEED);
    engine.fluxStage = FLUX_SETTLE_STAGE;
    engine.buildFluxStage({
      persist: false,
      stageOptions: {
        family: FLUX_FAMILIES.GENERATED,
        isBoss: false,
        shapeMargins: { [fluxShapeTuningId(params)]: minMarginPx }
      }
    });
    // The table is keyed by the shape without neutral anchors: the settle must have built that one.
    if (engine.fluxShapeIds[0] !== fluxShapeTuningId(params)) {
      throw new Error(`Flux settle built ${engine.fluxShapeIds[0]}, expected ${fluxShapeTuningId(params)}`);
    }
    return { margin: settleBoard(engine, configs.game.canvas.dangerLineY, frames), frames };
  });
}

/**
 * Settles the first stages of a Flux run, each one idle, through the full engine path (family
 * draw, obstacles, bosses, modifiers) and reports each stage's smallest margin to the line.
 * @param {object} configs - Loaded configs: game, physics, balls, obstacles, levels, campaign, flux.
 * @param {object|null} fluxShapeTuning - The settle table; null settles the previous shapes.
 * @param {{seed: string, stageCount: number, frames: number, lcgSeed: number, settleFromStage?: number}}
 *   options - The run seed, how many stages to build, frames per settled stage, the start of the
 *   replayable stream, and the first stage to settle (earlier stages are only built, to reach
 *   the stage a run would reach them from).
 * @returns {{stage: number, family: string, isBoss: boolean, shapeIds: string[], margin: number}[]}
 */
export function idleSettleFluxRun(configs, fluxShapeTuning, { seed, stageCount, frames, lcgSeed, settleFromStage = 1 }) {
  return withReplayableRandom(lcgSeed, () => {
    const engine = createFluxSettleEngine(configs, fluxShapeTuning);
    engine.initFluxRun(seed);
    const stages = [];
    for (let stage = 1; stage <= stageCount; stage++) {
      if (stage > 1) {
        engine.fluxPreviousFamily = engine.fluxFamily;
        engine.fluxStage = stage;
      }
      engine.buildFluxStage({ persist: false });
      if (stage < settleFromStage) {
        continue;
      }
      stages.push({
        stage,
        family: engine.fluxFamily,
        isBoss: engine.fluxIsBossStage,
        shapeIds: [...engine.fluxShapeIds],
        margin: settleBoard(engine, configs.game.canvas.dangerLineY, frames)
      });
    }
    return stages;
  });
}
