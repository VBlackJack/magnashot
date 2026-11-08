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
 * Headless Polarity Duel match: two versus-role boards stepped in lockstep at the fixed
 * timestep, each driven by a BotBrain CPU with its own seeded stream. Pure and
 * deterministic: nothing here reads the clock, the DOM or an ambient random source, and
 * nothing is written to the player's profile. Used by tests; the UI does not wire it yet.
 */

import { GAME_STATES } from '../core/Constants.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { createVersusStorageView } from '../core/StorageView.js';
import { createAudioChannel } from '../core/AudioChannel.js';
import { GameEngine, ENGINE_ROLES } from './GameEngine.js';
import { BOT_POLICIES, pickGreedyAngle, planArsenalShot } from './BotBrain.js';

const BOARD_COUNT = 2;
const FIRST_ROUND = 0;
const OUTCOMES = Object.freeze({ DRAW: 'draw', CAPPED: 'capped' });
/** Aim angles are logged as integers at this precision (radians x this). */
const LOG_ANGLE_PRECISION = 1e6;
/** Stereo pan of each board: the first board on the left, the second on the right. */
const BOARD_PANS = Object.freeze([-1, 1]);

/** Frames the CPU waits before it aims: the tier's think time plus or minus its jitter. */
function rollThinkFrames(tier, rng) {
  const jitter = (rng() * 2 - 1) * (tier.thinkJitterFrames ?? 0);
  return Math.max(0, Math.round(tier.thinkFrames + jitter));
}

/** One CPU: thinks, then aims with the tier's noise and shoots. Returns the shot or null. */
function createCpu({ tier, bot, rng, reach }) {
  const tierBot = { ...bot, aimSamples: tier.aimSamples ?? bot.aimSamples };
  let thinkLeft = rollThinkFrames(tier, rng);
  return {
    step(engine) {
      if (engine.state !== GAME_STATES.PLAYING || engine.physicsWorld.projectile) {
        return null;
      }
      if (thinkLeft > 0) {
        thinkLeft -= 1;
        return null;
      }
      thinkLeft = rollThinkFrames(tier, rng);
      const plan = tier.policy === BOT_POLICIES.ARSENAL
        ? planArsenalShot(engine, tierBot, reach, rng)
        : { angle: pickGreedyAngle(engine, tierBot, reach, rng), specialType: null };
      if (plan.angle === null) {
        return null;
      }
      if (plan.specialType) {
        engine.equipSpecialBall(plan.specialType);
      }
      const angle = plan.angle + (rng() * 2 - 1) * (tier.noiseRad ?? 0);
      engine.updateAimFromAngle(angle);
      engine.shoot();
      return angle;
    }
  };
}

/**
 * Builds a headless duel between two CPUs.
 * @param {object} options
 * @param {string|number} options.seed - Match seed.
 * @param {number} [options.round=0] - Round number, part of the stream keys.
 * @param {Array<object>} options.tiers - Two CPU tiers {thinkFrames, thinkJitterFrames, noiseRad, aimSamples, policy}.
 * @param {object} options.bot - Bot tuning (campaignConfig.generated.calibration.bot).
 * @param {object} options.configs - {gameConfig, physicsConfig, ballsConfig, obstaclesConfig, levelsConfig, campaignConfig, campaignTuning, fluxConfig}.
 * @param {object} options.storageManager - Real storage manager, seen only through the versus view.
 * @param {object} options.audioManager - Shared audio manager, seen only through muted channels.
 * @param {number} options.frameCap - Fixed steps after which the match stops undecided.
 * @returns {{engines: GameEngine[], seedKey: string, run: () => object}}
 */
export function createVersusMatch({ seed, round = FIRST_ROUND, tiers, bot, configs, storageManager, audioManager, frameCap }) {
  if (!Array.isArray(tiers) || tiers.length !== BOARD_COUNT) {
    throw new Error('A versus match needs exactly two CPU tiers');
  }
  const seedKey = `versus:${seed}:r${round}`;
  const reach = configs.physicsConfig.ball.radius * bot.neighborhoodRadii;
  const engines = [];
  const cpus = [];
  for (let b = 0; b < BOARD_COUNT; b++) {
    const engine = new GameEngine({
      ...configs,
      storageManager: createVersusStorageView(storageManager),
      audioManager: createAudioChannel(audioManager, { muted: true, pan: BOARD_PANS[b] }),
      onStateChange: () => {},
      role: ENGINE_ROLES.VERSUS
    });
    engine.startVersusBoard({ seedKey, boardIndex: b });
    engines.push(engine);
    cpus.push(createCpu({ tier: tiers[b], bot, rng: createRng(`${seedKey}:cpu:${b}`), reach }));
  }

  /** Steps both boards until one loses or the cap is reached. */
  function run() {
    const log = [];
    let frame = 0;
    for (; frame < frameCap; frame++) {
      for (let b = 0; b < BOARD_COUNT; b++) {
        const angle = cpus[b].step(engines[b]);
        if (angle !== null) {
          log.push([frame, b, Math.round(angle * LOG_ANGLE_PRECISION)]);
        }
        engines[b].update();
      }
      if (engines.some((engine) => engine.state !== GAME_STATES.PLAYING)) {
        break;
      }
    }
    const lost = engines.map((engine) => engine.state !== GAME_STATES.PLAYING);
    let outcome = OUTCOMES.CAPPED;
    if (lost[0] && lost[1]) {
      outcome = OUTCOMES.DRAW;
    } else if (lost[0] || lost[1]) {
      outcome = lost[0] ? 1 : 0;
    }
    return {
      seedKey,
      frames: frame,
      outcome,
      log,
      scores: engines.map((engine) => engine.score),
      stages: engines.map((engine) => engine.classicStage),
      attacks: engines.map((engine) => engine.getVersusAttack())
    };
  }

  return { engines, seedKey, run };
}

/** Seeded stream of a CPU as a () => number in [0, 1). */
function createRng(key) {
  const stream = new SeededRandom(key);
  return () => stream.next();
}
