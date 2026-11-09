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
import { t } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { contentVersionFor, decodeGhost, encodeGhost, ghostFromTimeline, DUEL_STATUS } from './GhostCodec.js';
import {
  compareToGhost,
  createDuelAnnouncementState,
  nextDuelAnnouncement,
  settleDuel
} from './GhostDuel.js';

const GHOST_MODE_DAILY = 'daily';
const GHOST_MODE_FLUX = 'flux';
const NO_SHOTS_EVALUATED = -1;
const ORIGIN_SAMPLE_COUNT = 1;

/** Ghost Duel methods installed on GameEngine: lifecycle of the rival run shown during a run. */
export const engineGhostDuelMethods = {
  /**
   * @returns {object} The codec context built from the game configs (today, epoch, seed shape, caps).
   */
  buildGhostContext() {
    return {
      todayKey: SeededRandom.getTodayDateKey(),
      epochDateKey: this.gameConfig.share.epochDateKey,
      seed: this.fluxConfig.seed,
      maxPoints: this.gameConfig.shotTimeline.maxPoints
    };
  },

  /** @returns {string} The name shown for the rival (its alias, or the default name). */
  getGhostDisplayName() {
    return this.ghostDuel?.ghost?.alias || t('duel.defaultName');
  },

  /**
   * Starts the run a ghost was recorded on and attaches the ghost to it. A Daily of another
   * date starts as a rematch (same board, no first-play bonus, no streak, no daily record);
   * a Flux seed starts as a shared seed run (device tilt locked).
   * @param {object} ghost - A valid decoded ghost.
   * @returns {boolean} True when the duel started.
   */
  startGhostDuel(ghost) {
    if (this.isVersusRole || !ghost || (ghost.mode !== GHOST_MODE_DAILY && ghost.mode !== GHOST_MODE_FLUX)) {
      return false;
    }
    if (ghost.mode === GHOST_MODE_DAILY) {
      const isRematch = ghost.key !== SeededRandom.getTodayDateKey();
      this.startDailyChallenge(ghost.key, false, { isRematch });
    } else {
      this.startFluxRun(ghost.key, { isShared: true });
    }
    return this.attachGhost(ghost);
  },

  /**
   * Attaches a ghost to the run in progress when the run is on the ghost's board.
   * @param {object|null} ghost - Ghost to race, or null to clear the duel.
   * @returns {boolean} True when the ghost is now attached.
   */
  attachGhost(ghost) {
    this.ghostDuel = null;
    if (this.isVersusRole || !ghost) {
      return false;
    }
    const isDailyMatch = ghost.mode === GHOST_MODE_DAILY
      && this.mode === GAME_MODES.DAILY
      && this.dailySeedKey === ghost.key;
    const isFluxMatch = ghost.mode === GHOST_MODE_FLUX
      && this.mode === GAME_MODES.FLUX
      && this.fluxSeed === ghost.key;
    if (!isDailyMatch && !isFluxMatch) {
      return false;
    }
    if (isFluxMatch) {
      // Every duel on a seed shares one physics: the device tilt is locked.
      this.isSharedFluxRun = true;
    }
    const duel = {
      ghost,
      announcement: createDuelAnnouncementState(),
      lastEvaluatedShots: NO_SHOTS_EVALUATED,
      result: null,
      isRecorded: false
    };
    // A restored run may already be past the ghost: those moments were announced before.
    const cmp = compareToGhost(this.score, this.shotTimeline?.n ?? 0, ghost);
    duel.announcement.endedDone = cmp.ghostFinished;
    duel.announcement.passedDone = cmp.ghostFinished && cmp.score >= cmp.ghostFinal;
    this.ghostDuel = duel;
    return true;
  },

  /**
   * @returns {?{ghost: object, name: string, comparison: object, result: ?object}} The live
   *   duel state for the HUD (comparison is from compareToGhost), or null outside a duel.
   */
  getGhostDuelStatus() {
    const duel = this.ghostDuel;
    if (!duel) {
      return null;
    }
    return {
      ghost: duel.ghost,
      name: this.getGhostDisplayName(),
      comparison: compareToGhost(this.score, this.shotTimeline?.n ?? 0, duel.ghost),
      result: duel.result
    };
  },

  /**
   * Compares the run with the ghost once per shot (after the shot timeline was sampled) and
   * announces a lead change, the end of the ghost's run or passing its final score.
   * @returns {?string} The announcement kind sent to the UI, or null.
   */
  evaluateGhostShot() {
    const duel = this.ghostDuel;
    if (!duel || duel.result) {
      return null;
    }
    // The sample just taken is the state after the previous shot: n counts it, so the shots
    // fired so far are one fewer (the origin sample is not a shot).
    const shots = Math.max(0, (this.shotTimeline?.n ?? 0) - ORIGIN_SAMPLE_COUNT);
    if (shots === duel.lastEvaluatedShots) {
      return null;
    }
    duel.lastEvaluatedShots = shots;
    const cmp = compareToGhost(this.score, shots, duel.ghost);
    const next = nextDuelAnnouncement(duel.announcement, cmp, this.gameConfig.ghostDuel);
    duel.announcement = next.state;
    if (!next.announcement) {
      return null;
    }
    this.notifyUI({
      ghostAnnouncement: {
        kind: next.announcement,
        name: this.getGhostDisplayName(),
        gap: cmp.gap,
        score: cmp.ghostFinal
      }
    });
    return next.announcement;
  },

  /**
   * Settles the duel at game over (final scores only): fills gameOverSummary.duel and records
   * the result in the local duel history. Quitting a run never reaches this.
   * @returns {?object} The duel summary, or null outside a duel or when already settled.
   */
  settleGhostDuel() {
    const duel = this.ghostDuel;
    if (!duel || duel.result) {
      return null;
    }
    const { ghost } = duel;
    const settled = settleDuel(this.score, ghost);
    duel.result = settled;
    duel.settledDateKey = SeededRandom.getTodayDateKey();
    const summary = {
      name: this.getGhostDisplayName(),
      outcome: settled.outcome,
      gap: settled.gap,
      myScore: this.score,
      ghostScore: ghost.final,
      mode: ghost.mode,
      key: ghost.key,
      isRematch: this.isDailyRematch
    };
    if (this.gameOverSummary) {
      this.gameOverSummary.duel = summary;
    }
    const storage = this.storageManager;
    if (typeof storage.recordGhostDuel === 'function') {
      storage.recordGhostDuel({
        mode: ghost.mode,
        key: ghost.key,
        alias: ghost.alias,
        ghostScore: ghost.final,
        myScore: this.score,
        outcome: settled.outcome,
        dateKey: duel.settledDateKey
      });
      duel.isRecorded = true;
    }
    return summary;
  },

  /** Undoes the duel record written at game over when the player continues the run. */
  retractGhostDuel() {
    const duel = this.ghostDuel;
    if (!duel || !duel.result) {
      return;
    }
    if (duel.isRecorded && typeof this.storageManager.retractLastGhostDuel === 'function') {
      this.storageManager.retractLastGhostDuel({
        mode: duel.ghost.mode,
        key: duel.ghost.key,
        dateKey: duel.settledDateKey
      });
    }
    duel.isRecorded = false;
    duel.result = null;
    duel.settledDateKey = null;
    // The run is live again: evaluate the next shot afresh.
    duel.lastEvaluatedShots = NO_SHOTS_EVALUATED;
  },

  /** @returns {number} Sum of the owned Workshop levels (0 when upgrades are held neutral). */
  getRunWorkshopLevels() {
    if (this.areUpgradesNeutralised()) {
      return 0;
    }
    return Object.keys(this.gameConfig.upgrades || {}).reduce(
      (sum, upgradeKey) => sum + (this.storageManager.getUpgradeLevel(upgradeKey) || 0),
      0
    );
  },

  /**
   * Builds the ghost of the finished run, to challenge a friend back.
   * @returns {?object} The ghost, or null outside Daily and Flux or without a finished timeline.
   */
  buildChallengeGhost() {
    const isDaily = this.mode === GAME_MODES.DAILY;
    if (!isDaily && this.mode !== GAME_MODES.FLUX) {
      return null;
    }
    const cfg = this.gameConfig.ghostDuel;
    return ghostFromTimeline(
      this.shotTimeline,
      {
        key: isDaily ? this.dailySeedKey : this.fluxSeed,
        cv: contentVersionFor(cfg, isDaily ? GHOST_MODE_DAILY : GHOST_MODE_FLUX),
        alias: this.storageManager.getGhostAlias?.() || '',
        assists: {
          workshop: this.getRunWorkshopLevels(),
          ammo: this.specialAmmoBoughtInRun || 0,
          continues: this.hasUsedContinue ? 1 : 0,
          tiltFree: !this.isTiltLocked()
        }
      },
      cfg,
      this.buildGhostContext()
    );
  },

  /** @returns {?string} The attached ghost as an encoded string for run snapshots, or null. */
  encodeGhostDuel() {
    if (!this.ghostDuel) {
      return null;
    }
    return encodeGhost(this.ghostDuel.ghost, this.gameConfig.ghostDuel, this.buildGhostContext());
  },

  /**
   * Re-attaches the ghost saved with a run snapshot. A missing, damaged or expired code leaves
   * the restored run without a duel.
   * @param {unknown} code - The snapshot's ghostDuelCode.
   * @returns {boolean} True when a ghost is attached.
   */
  restoreGhostDuel(code) {
    if (typeof code !== 'string') {
      return false;
    }
    const decoded = decodeGhost(code, this.gameConfig.ghostDuel, this.buildGhostContext());
    return decoded.status === DUEL_STATUS.VALID && this.attachGhost(decoded.ghost);
  }
};
