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
 * The bots that play campaign levels for the calibration. The decision logic lives in
 * src/game/BotBrain.js and is re-exported here; this file keeps the run loops.
 */

import { GAME_STATES } from '../../src/core/Constants.js';
import { BOT_POLICIES, pickGreedyAngle, planArsenalShot } from '../../src/game/BotBrain.js';

export { BOT_POLICIES, pickGreedyAngle, shotValue, planArsenalShot } from '../../src/game/BotBrain.js';

/**
 * Plays one campaign game with a policy.
 * @param {object} engine - A fresh GameEngine.
 * @param {number} levelId - Campaign level.
 * @param {object} bot - campaignConfig.generated.calibration.bot.
 * @param {string} policy - One of BOT_POLICIES.
 * @returns {{score: number, won: boolean, specialsUsed: number}}
 */
export function playGame(engine, levelId, bot, policy) {
  const reach = engine.physicsConfig.ball.radius * bot.neighborhoodRadii;
  engine.startCampaignLevel(levelId);
  let specialsUsed = 0;
  for (let frame = 0; engine.state === GAME_STATES.PLAYING && frame < bot.maxFrames; frame++) {
    if (!engine.physicsWorld.projectile && engine.shotsRemaining > 0) {
      const shot = policy === BOT_POLICIES.ARSENAL
        ? planArsenalShot(engine, bot, reach)
        : { angle: pickGreedyAngle(engine, bot, reach), specialType: null };
      if (shot.angle !== null) {
        if (shot.specialType) {
          engine.equipSpecialBall(shot.specialType);
          specialsUsed++;
        }
        engine.updateAimFromAngle(shot.angle);
        engine.shoot();
      }
    }
    engine.update();
  }
  let celebrated = false;
  for (let frame = 0; engine.isVictoryCelebrating() && frame < bot.maxCelebrationFrames; frame++) {
    celebrated = true;
    engine.update();
  }
  return { score: engine.score, won: celebrated || engine.state === GAME_STATES.VICTORY, specialsUsed };
}

/** Stage the Classic calibration stops at by default: reaching it already counts as "3+". */
const DEFAULT_CLASSIC_STOP_STAGE = 3;

/**
 * Plays a Classic run with the greedy bot, from `stage`, until the run ends, the bot has
 * cleared its way to `stopStage`, or `bot.maxFrames` frames have passed. Classic has no
 * shot budget, so the only ways out are the line crossing and the stage ceiling.
 * @param {object} engine - A fresh GameEngine (needs startClassicMode).
 * @param {number} stage - First stage to play.
 * @param {object} bot - campaignConfig.generated.calibration.bot.
 * @param {{stopStage?: number}} [options] - Stage at which to stop (default 3).
 * @returns {{score: number, stageReached: number, clearedFirst: boolean, railDrops: number, ended: boolean}}
 */
export function playClassic(engine, stage, bot, { stopStage = DEFAULT_CLASSIC_STOP_STAGE } = {}) {
  const reach = engine.physicsConfig.ball.radius * bot.neighborhoodRadii;
  engine.startClassicMode(stage);
  for (
    let frame = 0;
    engine.state === GAME_STATES.PLAYING && engine.classicStage < stopStage && frame < bot.maxFrames;
    frame++
  ) {
    if (!engine.physicsWorld.projectile) {
      const angle = pickGreedyAngle(engine, bot, reach);
      if (angle !== null) {
        engine.updateAimFromAngle(angle);
        engine.shoot();
      }
    }
    engine.update();
  }
  return {
    score: engine.score,
    stageReached: engine.classicStage,
    clearedFirst: engine.classicStage > stage,
    railDrops: engine.railDrops ?? 0,
    ended: engine.state !== GAME_STATES.PLAYING
  };
}
