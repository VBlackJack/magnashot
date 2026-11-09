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
 * Shot probe for Puzzle stages: fires a scripted sequence of shots on the real engine and
 * reports whether the stage was won and with which score, and lets a stage sit idle to measure
 * how far its board sags. The run is deterministic: a seeded generator replaces Math.random,
 * Resonance is off and the storage is fresh, so a window found once can be pinned in a test.
 */

import { StorageManager } from '../../src/core/StorageManager.js';
import { GameEngine } from '../../src/game/GameEngine.js';
import { GAME_STATES } from '../../src/core/Constants.js';

const SILENT_AUDIO = Object.freeze({ playEffect() {}, stopAll() {}, isMuted: () => true, setMuted() {} });
/** Linear congruential generator (Numerical Recipes), so a run can be replayed. */
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_RANGE = 4294967296;
/** Seed every probe run is replayed with. */
export const PUZZLE_PROBE_SEED = 7;
/** Longest a single shot is followed before the probe gives up on it. */
export const MAX_SHOT_FRAMES = 1500;
/** Frames the board runs after a shot that left shots in hand, before the next one is fired. */
export const SETTLE_FRAMES_BETWEEN_SHOTS = 150;
/** A shot is only judged settled once its projectile has had this many frames to fly. */
const MIN_FLIGHT_FRAMES = 30;
const DEGREES_TO_RADIANS = Math.PI / 180;
/** Stands for "no danger line": the engine's own check is switched off to measure the sag. */
const DISABLED_DANGER_LINE_Y = Number.MAX_SAFE_INTEGER;

/**
 * Runs a function with Math.random replaced by a seeded generator, and puts the original back.
 * @param {number} seed - Generator seed.
 * @param {Function} fn - Function to run.
 * @returns {*} What the function returns.
 */
export function withSeededRandom(seed, fn) {
  let state = seed >>> 0;
  const realRandom = Math.random;
  Math.random = () => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state / UINT32_RANGE;
  };
  try {
    return fn();
  } finally {
    Math.random = realRandom;
  }
}

/**
 * The aim range of the launcher, in degrees from the +x axis.
 * @param {object} configs - Loaded configs.
 * @returns {{minDeg: number, maxDeg: number}} Lowest and highest aim.
 */
export function aimRangeDegrees(configs) {
  return {
    minDeg: configs.game.canvas.minAimAngleRad / DEGREES_TO_RADIANS,
    maxDeg: configs.game.canvas.maxAimAngleRad / DEGREES_TO_RADIANS
  };
}

function createEngine(configs, gameConfig) {
  const storageManager = new StorageManager();
  storageManager.init();
  // Same footing as the calibration bots: no Resonance bonus.
  storageManager.setResonanceEnabled(false);
  return new GameEngine({
    gameConfig,
    physicsConfig: configs.physics,
    ballsConfig: configs.balls,
    obstaclesConfig: configs.obstacles,
    levelsConfig: configs.levels,
    campaignConfig: configs.campaign,
    campaignTuning: configs.campaignTuning,
    fluxConfig: configs.flux,
    audioManager: SILENT_AUDIO,
    storageManager,
    onStateChange() {}
  });
}

const isWon = (engine) => engine.state === GAME_STATES.VICTORY || engine.isVictoryCelebrating();
const isLost = (engine) => engine.state === GAME_STATES.GAME_OVER;
const isOver = (engine) => isWon(engine) || isLost(engine);

function runFrames(engine, frames) {
  for (let frame = 0; frame < frames && !isOver(engine); frame++) {
    engine.update();
  }
}

/** Fires one shot and runs until the turn settles, the stage is won or lost, or the cap is hit. */
function fireShot(engine, shot, attemptSwap) {
  if (attemptSwap) {
    engine.swapLauncherBalls();
  }
  if (Boolean(shot.flip) !== engine.isPolarityFlipped) {
    engine.togglePolarityFlip();
  }
  if (shot.special) {
    engine.equipSpecialBall(shot.special);
  }
  engine.updateAimFromAngle(-shot.angleDeg * DEGREES_TO_RADIANS);
  const shotsBefore = engine.shotsRemaining;
  engine.shoot();
  for (let frame = 0; frame < MAX_SHOT_FRAMES; frame++) {
    engine.update();
    if (isOver(engine)) {
      return;
    }
    const hasLanded = !engine.physicsWorld.projectile && frame > MIN_FLIGHT_FRAMES
      && engine.shotsRemaining < shotsBefore && engine.shotsRemaining > 0;
    if (hasLanded) {
      runFrames(engine, SETTLE_FRAMES_BETWEEN_SHOTS);
      return;
    }
  }
}

/**
 * Fires a scripted sequence of shots on a Puzzle stage.
 * @param {object} configs - Loaded configs: game, physics, balls, obstacles, levels, campaign,
 *   campaignTuning, flux.
 * @param {number} stage - Puzzle stage, from 1.
 * @param {Array<{angleDeg: number, flip?: boolean, special?: string|null}>} shots - The shots, in
 *   order; angleDeg is measured from the +x axis, upward positive.
 * @param {object} [options] - Options.
 * @param {number} [options.preFrames] - Frames the stage runs before the first shot (it matters
 *   for a moving obstacle).
 * @param {boolean} [options.attemptSwap] - Calls the engine's launcher swap before each shot.
 *   The Puzzle queue is fixed, so this must change nothing.
 * @returns {{won: boolean, lost: boolean, score: number, shotsRemaining: number}} The outcome.
 */
export function fire(configs, stage, shots, { preFrames = 0, attemptSwap = false } = {}) {
  return withSeededRandom(PUZZLE_PROBE_SEED, () => {
    const engine = createEngine(configs, configs.game);
    engine.startPuzzleMode(stage);
    runFrames(engine, preFrames);
    for (const shot of shots) {
      if (isOver(engine)) {
        break;
      }
      fireShot(engine, shot, attemptSwap);
    }
    return {
      won: isWon(engine),
      lost: isLost(engine),
      score: engine.score,
      shotsRemaining: engine.shotsRemaining
    };
  });
}

/**
 * Lets a Puzzle stage sit idle, with no shot, and measures how close its lowest sphere comes to
 * the danger line. The engine's own danger check is switched off (on a private copy of the game
 * config) so a board that sags past the line is measured instead of ending the run.
 * @param {object} configs - Loaded configs, as for fire.
 * @param {number} stage - Puzzle stage, from 1.
 * @param {number} frames - Frames to run.
 * @param {object} [options] - Options.
 * @param {boolean} [options.dangerLineEnabled] - Keeps the real danger line, so the result
 *   reports whether the run is still "playing" instead of a margin.
 * @returns {{margin: number, state: string}} The smallest distance, in logical pixels, between
 *   the lowest sphere bottom and the real danger line (negative when it crosses), and the
 *   engine state at the end.
 */
export function idlePuzzle(configs, stage, frames, { dangerLineEnabled = false } = {}) {
  const dangerLineY = configs.game.canvas.dangerLineY;
  const gameConfig = dangerLineEnabled
    ? configs.game
    : { ...configs.game, canvas: { ...configs.game.canvas, dangerLineY: DISABLED_DANGER_LINE_Y } };
  return withSeededRandom(PUZZLE_PROBE_SEED, () => {
    const engine = createEngine(configs, gameConfig);
    engine.startPuzzleMode(stage);
    let margin = Infinity;
    for (let frame = 0; frame < frames; frame++) {
      engine.update();
      for (const ball of engine.physicsWorld.balls) {
        margin = Math.min(margin, dangerLineY - (ball.y + ball.radius));
      }
    }
    return { margin, state: engine.state };
  });
}
