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

import { GAME_MODES } from '../core/Constants.js';
import { Ball } from '../entities/Ball.js';
import { SeededRandom } from '../core/SeededRandom.js';

/** Recolor slots: 0 current ball, 1 next ball, then the stash, then the queue. */
const STASH_RECOLOR_SLOT = 2;
const QUEUE_RECOLOR_SLOT_BASE = 3;

/** Methods of GameEngine that belong to this domain, installed on its prototype. */
export const engineLauncherMethods = {
  pickPaletteColor() {
    return this.activePalette[Math.floor(this.random() * this.activePalette.length)];
  },

  /**
   * Picks a launcher color among the colors still on the board. The pool follows the palette
   * order, never the board order, so a given roll names the same color whatever was played.
   * @param {number} [roll] - Unit roll in [0, 1); defaults to a draw from the run stream.
   * @returns {string} A color id.
   */
  pickLauncherColor(roll = this.random()) {
    const existingColors = new Set();
    for (const b of this.physicsWorld.balls) {
      if (b.colorId) {
        existingColors.add(b.colorId);
      }
    }
    const ordered = this.activePalette.filter((colorId) => existingColors.has(colorId));
    const pool = ordered.length > 0 ? ordered : this.activePalette;
    return pool[Math.floor(roll * pool.length)];
  },

  /** Seed key shared by every player of the run: the Flux seed, the Daily date, or null. */
  getRunSeedKey() {
    if (this.mode === GAME_MODES.FLUX) {
      return this.fluxSeed;
    }
    if (this.mode === GAME_MODES.DAILY) {
      return this.dailySeedKey;
    }
    return null;
  },

  /**
   * Roll of a named stream, keyed by its index so it depends on neither the shots played
   * nor any saved generator state. Unseeded runs draw from the ambient source.
   * @param {string} stream - Stream name.
   * @param {number|string} index - Position of the draw in the stream.
   * @returns {number} A unit roll in [0, 1).
   */
  drawSeededRoll(stream, index) {
    const key = this.getRunSeedKey();
    if (!key) {
      return this.random();
    }
    return new SeededRandom(`${key}:${stream}:${index}`).next();
  },

  /** Next color of the launcher queue: one indexed draw, the same for every player of a seed. */
  drawLauncherColor() {
    return this.pickLauncherColor(this.drawSeededRoll('launcher', this.launcherDrawIndex++));
  },

  /**
   * Builds a launcher ball; a regular ball keeps `colorId` when given, otherwise picks a board color.
   * @param {string|null} specialType - Special ball type, or null for a regular colored ball.
   * @param {string|null} colorId - Color to restore on a regular ball.
   */
  createRandomLauncherBall(specialType = null, colorId = null) {
    return new Ball({
      x: this.gameConfig.canvas.launcherX,
      y: this.gameConfig.canvas.launcherY,
      radius: this.physicsConfig.ball.radius,
      colorId: specialType ? null : colorId || this.drawLauncherColor(),
      specialType,
      isProjectile: false
    });
  },

  /**
   * Fills the queue of upcoming launcher colors up to its configured length. Called when
   * a run starts, never while drawing, so seeded runs draw the same colors every time.
   */
  fillUpcomingColors() {
    if (this.mode === GAME_MODES.PUZZLE) {
      return;
    }
    const length = this.gameConfig.canvas.launcherPreviewCount;
    this.upcomingColorIds.length = Math.min(this.upcomingColorIds.length, length);
    while (this.upcomingColorIds.length < length) {
      this.upcomingColorIds.push(this.drawLauncherColor());
    }
  },

  /** Color of the next ball to load from the queue; the queue is topped up behind it. */
  takeUpcomingColor() {
    return this.takeUpcomingBall().colorId;
  },

  /**
   * Next ball to load from the queue: its color and, for a scripted puzzle queue, its
   * special type. The queue is topped up behind it outside Puzzle mode.
   * @returns {{colorId: string, specialType: string|null}}
   */
  takeUpcomingBall() {
    if (this.mode === GAME_MODES.PUZZLE) {
      const nextSpec = this.puzzleQueue.shift();
      const nextColor = this.upcomingColorIds.shift();
      return {
        colorId: nextSpec?.colorId || nextColor || this.activePalette[0],
        specialType: nextSpec?.specialType || null
      };
    }
    const color = this.upcomingColorIds.shift() || this.drawLauncherColor();
    this.fillUpcomingColors();
    return { colorId: color, specialType: null };
  },

  /**
   * Recolors every regular launcher color that no longer exists on the board: the
   * current ball, the next ball, the queued colors and the color stashed behind an
   * equipped special, so neither a swap nor un-equipping a special can bring back a
   * cleared color.
   */
  refreshStaleLauncherColors() {
    if (this.mode === GAME_MODES.PUZZLE) {
      return;
    }
    const boardColors = new Set(this.physicsWorld.balls.map((b) => b.colorId).filter(Boolean));
    const activeColors = boardColors.size > 0 ? boardColors : new Set(this.activePalette);
    if (activeColors.size === 0) {
      return;
    }
    // Recolors never advance the queue counter: they are keyed by it and by their slot.
    const recolorStream = `recolor:${this.launcherDrawIndex}`;
    const recolor = (slot) => this.pickLauncherColor(this.drawSeededRoll(recolorStream, slot));
    [this.currentBall, this.nextBall].forEach((launcherBall, slot) => {
      if (launcherBall && !launcherBall.specialType && !activeColors.has(launcherBall.colorId)) {
        launcherBall.colorId = recolor(slot);
      }
    });
    if (this.stashedRegularColorId && !activeColors.has(this.stashedRegularColorId)) {
      this.stashedRegularColorId = recolor(STASH_RECOLOR_SLOT);
    }
    this.upcomingColorIds = this.upcomingColorIds.map((color, idx) =>
      activeColors.has(color) ? color : recolor(QUEUE_RECOLOR_SLOT_BASE + idx)
    );
  },
};
