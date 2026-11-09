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
 * Idle settle probe for campaign levels: lets a board sag with no shot fired and reports how
 * close the lowest sphere comes to the danger line. A cluster hanging from few anchors sags
 * after the first frame, so a board that looks safe on frame 0 can still be lost idle.
 */

import { StorageManager } from '../../src/core/StorageManager.js';
import { GameEngine } from '../../src/game/GameEngine.js';

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
