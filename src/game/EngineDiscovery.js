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

import {
  GAME_MODES,
  GAME_STATES,
  SPECIAL_TYPES,
  BOARD_MECHANICS
} from '../core/Constants.js';
import {
  DISCOVERY_INTERACTIONS,
  POLARITY_MECHANIC_ID,
  RESONANCE_MECHANIC_ID,
  SAG_MECHANIC_ID,
  isProjectileNearMechanic,
  listBoardMechanics,
  listLevelMechanics,
  listMechanicsSharingHint,
  pickNextDiscovery,
  resolvePulseTarget,
  toSpecialMechanicId
} from './Discovery.js';

/** Version of the discovery list that predates versioning: its seeding is never redone. */
const LEGACY_DISCOVERIES_VERSION = 1;
const ARCADE_INTRO_MODES = new Set([
  GAME_MODES.HEX_GRID,
  GAME_MODES.ORBITAL,
  GAME_MODES.PINBALL,
  GAME_MODES.CONVOY,
  GAME_MODES.MERGE
]);

/** Methods of GameEngine that belong to this domain, installed on its prototype. */
export const engineDiscoveryMethods = {
  /**
   * Closes the open discovery hint and counts it as learned. The next unknown mechanic on
   * the board, if any, is shown at the end of the following turn rather than at once; a
   * hint replay moves on to its next hint at once.
   */
  dismissDiscovery() {
    if (!this.activeDiscoveryId) {
      return;
    }
    if (this.isReplayingHints) {
      this.showNextReplayedHint();
      this.notifyUI();
      return;
    }
    this.markMechanicLearned(this.activeDiscoveryId);
    this.activeDiscoveryId = null;
    this.discoveryTurnCount = 0;
    if (this.hasFiredInRound || this.storageManager.loadRunSnapshot() !== null) {
      this.saveRunSnapshot({ force: true });
    }
    this.notifyUI();
  },

  /** Forgets every discovered mechanic; the board's own hints come back right away. */
  resetDiscoveries() {
    this.storageManager.resetDiscoveries();
    this.storageManager.setDiscoveriesVersion(this.gameConfig.onboarding.discoveriesVersion);
    this.activeDiscoveryId = null;
    this.discoveryTurnCount = 0;
    this.discoveryShownIds = new Set();
    this.isActiveHintLearned = false;
    this.isHintShownThisTurn = false;
    this.hintReplayQueue = [];
    this.isReplayingHints = false;
    if (this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.PAUSED) {
      this.refreshDiscovery();
    }
    this.notifyUI();
  },

  /** A hint left open counts the turns played under it, so it can give way to the next. */
  countDiscoveryTurn() {
    if (this.activeDiscoveryId) {
      this.discoveryTurnCount++;
    }
  },

  /**
   * Records a mechanic, and every one explained by the same text, as learned.
   * @param {string} mechanicId - Mechanic the player now knows.
   */
  markMechanicLearned(mechanicId) {
    if (this.isVersusRole) {
      return;
    }
    const group = listMechanicsSharingHint(mechanicId, this.gameConfig.onboarding.mechanics);
    this.storageManager.markDiscovered(group);
    if (this.activeDiscoveryId && group.includes(this.activeDiscoveryId)) {
      this.isActiveHintLearned = true;
    }
  },

  /**
   * Counts something the player did as learning the mechanic it concerns. Pressing the
   * polarity button and firing a special ball teach their own mechanic whether or not its
   * hint was up; the other interactions count for the hint on screen when it asks for
   * exactly that, and not while hints are being replayed (a replay is a reminder, not a lesson).
   * @param {string} interaction - One of DISCOVERY_INTERACTIONS.
   * @param {?string} [specialType] - Special ball type fired, for the USE interaction.
   */
  recordDiscoveryInteraction(interaction, specialType = null) {
    if (this.isRestoringRun || this.isVersusRole) {
      return;
    }
    const mechanics = this.gameConfig.onboarding.mechanics;
    if (interaction === DISCOVERY_INTERACTIONS.TOGGLE) {
      this.markMechanicLearned(POLARITY_MECHANIC_ID);
    } else if (interaction === DISCOVERY_INTERACTIONS.USE) {
      const mechanicId = toSpecialMechanicId(specialType);
      if (mechanics[mechanicId]) {
        this.markMechanicLearned(mechanicId);
      }
    } else if (
      this.activeDiscoveryId &&
      !this.isReplayingHints &&
      !this.isActiveHintLearned &&
      mechanics[this.activeDiscoveryId]?.interaction === interaction
    ) {
      this.markMechanicLearned(this.activeDiscoveryId);
    }
  },

  /**
   * Learns an obstacle, modifier or rail from a shot that flew through or next to it. Runs
   * every step while a shot is in flight, so it only looks at the hint on screen.
   * @param {{x: number, y: number, radius: number}} projectile - Shot in flight.
   */
  trackDiscoveryProximity(projectile) {
    const hintId = this.activeDiscoveryId;
    if (!hintId || this.isActiveHintLearned || this.isReplayingHints) {
      return;
    }
    const mechanics = this.gameConfig.onboarding.mechanics;
    const interaction = mechanics[hintId]?.interaction || DISCOVERY_INTERACTIONS.PROXIMITY;
    if (interaction !== DISCOVERY_INTERACTIONS.PROXIMITY) {
      return;
    }
    if (this.proximityGroupHintId !== hintId) {
      this.proximityGroupHintId = hintId;
      this.proximityGroup = listMechanicsSharingHint(hintId, mechanics);
    }
    if (
      isProjectileNearMechanic(
        this.proximityGroup,
        projectile,
        this.physicsWorld.balls,
        this.physicsWorld.obstacles,
        this.gameConfig.onboarding.interactionMargin
      )
    ) {
      this.markMechanicLearned(hintId);
    }
  },

  /**
   * What the interface should pulse while the open hint is up: 'polarity' (the button),
   * 'special:<type>' (that special ball's slot), or null. Stops once the player did it.
   * @returns {?string} Pulse target.
   */
  getDiscoveryPulseTarget() {
    if (!this.activeDiscoveryId || this.isActiveHintLearned) {
      return null;
    }
    return resolvePulseTarget(this.activeDiscoveryId, this.gameConfig.onboarding.mechanics);
  },

  /**
   * Mechanics on the board, plus the ones the campaign level declares (the polarity flip has
   * no object on the board) and the ones the run itself switches on: Resonance when it is
   * live and Sag when the mode has the meter.
   * @returns {Set<string>} Mechanic ids.
   */
  listPresentMechanics() {
    const present = listBoardMechanics(this.physicsWorld.balls, this.physicsWorld.obstacles, this.specialInventory);
    if (!this.getModeBehavior().teachesMatchBasics()) {
      present.delete(BOARD_MECHANICS.BASICS);
    }
    if (this.mode === GAME_MODES.CAMPAIGN) {
      const levelDef = this.levelCatalog.get(this.currentLevelId);
      for (const mechanicId of levelDef?.teachesMechanics || []) {
        present.add(mechanicId);
      }
    }
    if (this.isResonanceEnabled()) {
      present.add(RESONANCE_MECHANIC_ID);
    }
    if (this.getSagState().active) {
      present.add(SAG_MECHANIC_ID);
    }
    return present;
  },

  /**
   * Shows the first unknown mechanic on the board, unless a hint is still open within its
   * turn allowance. A hint stays up until the player closes it, interacts with what it
   * explains, or lets the turn allowance run out; only the first two count the mechanic as
   * learned. A hint that ran out is not shown again in the same run. At most one hint comes
   * up per turn. Does nothing while a saved run is being rebuilt: that board is replaced
   * before the player sees it.
   */
  refreshDiscovery() {
    if (this.isRestoringRun || this.isVersusRole) {
      return;
    }
    const onboarding = this.gameConfig.onboarding;
    const isHolding =
      this.activeDiscoveryId && !this.isActiveHintLearned && this.discoveryTurnCount < onboarding.hintShotLimit;
    if (this.isReplayingHints) {
      if (!isHolding) {
        this.showNextReplayedHint();
      }
      return;
    }
    if (isHolding || this.isHintShownThisTurn) {
      return;
    }
    const next = pickNextDiscovery(
      this.listPresentMechanics(),
      this.storageManager.getDiscoveries(),
      onboarding.order,
      this.listCurrentLevelMechanics(),
      this.discoveryShownIds
    );
    this.activeDiscoveryId = next;
    this.discoveryTurnCount = 0;
    this.isActiveHintLearned = false;
    if (next) {
      this.isHintShownThisTurn = true;
      for (const id of listMechanicsSharingHint(next, onboarding.mechanics)) {
        this.discoveryShownIds.add(id);
      }
    }
  },

  /** True while a run is on and its board shows something a hint can explain again. */
  hasLevelHints() {
    return (
      this.isRunPlaying() &&
      (ARCADE_INTRO_MODES.has(this.mode)
        || this.listReplayableHints().some((mechanicId) => mechanicId !== BOARD_MECHANICS.BASICS))
    );
  },

  /**
   * Shows the hints of the mechanics on the current board again, one at a time, in
   * discovery order. Closing one, or letting it run out, brings the next. Learned state
   * is left alone.
   * @returns {boolean} True when a replay started.
   */
  replayLevelHints() {
    if (!this.isRunPlaying()) {
      return false;
    }
    if (ARCADE_INTRO_MODES.has(this.mode) && !this.levelIntro) {
      this.modeIntroReplaySeq = (this.modeIntroReplaySeq || 0) + 1;
      this.levelIntro = { arcadeMode: this.mode, replaySeq: this.modeIntroReplaySeq };
      this.notifyUI();
      return true;
    }
    const queue = this.listReplayableHints();
    if (queue.length === 0) {
      return false;
    }
    if (this.activeDiscoveryId && !this.isReplayingHints && !this.isActiveHintLearned) {
      // The interrupted hint was not learned: let it come back once the replay is over.
      this.discoveryShownIds.delete(this.activeDiscoveryId);
    }
    this.hintReplayQueue = queue;
    this.isReplayingHints = true;
    this.showNextReplayedHint();
    this.notifyUI();
    return true;
  },

  /** One mechanic id per distinct hint text among the mechanics present, in discovery order. */
  listReplayableHints() {
    const onboarding = this.gameConfig.onboarding;
    const present = this.listPresentMechanics();
    const covered = new Set();
    const queue = [];
    for (const id of onboarding.order) {
      if (present.has(id) && !covered.has(id)) {
        queue.push(id);
        for (const sharing of listMechanicsSharingHint(id, onboarding.mechanics)) {
          covered.add(sharing);
        }
      }
    }
    return queue;
  },

  /** Moves a hint replay to its next hint, or ends it when none is left. */
  showNextReplayedHint() {
    this.activeDiscoveryId = this.hintReplayQueue.shift() || null;
    this.discoveryTurnCount = 0;
    this.isActiveHintLearned = false;
    if (!this.activeDiscoveryId) {
      this.isReplayingHints = false;
    }
  },

  /**
   * Mechanics the campaign level being played always shows, explained before the rest so a
   * player who opens a level directly first learns what the level is built around.
   * @returns {Set<string>} Mechanic ids; empty outside the campaign.
   */
  listCurrentLevelMechanics() {
    if (this.mode !== GAME_MODES.CAMPAIGN) {
      return new Set();
    }
    const levelDef = this.levelCatalog.get(this.currentLevelId);
    return levelDef ? listLevelMechanics(levelDef, { guaranteedOnly: true }) : new Set();
  },

  /**
   * Mechanics a player's progress shows they already met: the basics and everything the
   * authored levels behind their unlocked level show (obstacles, modifiers, the special
   * balls those levels hand out, the polarity lesson), plus every special ball once a
   * survival mode was played, since those modes start with a stock of each.
   * @returns {Set<string>} Mechanic ids; empty for a player who has not played yet.
   */
  listMechanicsKnownFromProgress() {
    const unlockedLevel = this.storageManager.getUnlockedLevel();
    const hasPlayedSurvival =
      this.storageManager.getEndlessHighScore() > 0 || this.storageManager.getFluxHighScore() > 0;
    const hasPlayedBefore = unlockedLevel > this.gameConfig.defaults.initialUnlockedLevel || hasPlayedSurvival;
    const known = new Set();
    if (!hasPlayedBefore) {
      return known;
    }
    known.add(BOARD_MECHANICS.BASICS);
    // Authored levels only: they teach every mechanic, and building the generated levels
    // behind a far-advanced player would cost hundreds of boards for nothing new.
    for (const level of this.levelsConfig.levels.filter((lvl) => lvl.id < unlockedLevel)) {
      for (const mechanicId of listLevelMechanics(level)) {
        known.add(mechanicId);
      }
    }
    if (hasPlayedSurvival) {
      for (const specialType of Object.values(SPECIAL_TYPES)) {
        known.add(toSpecialMechanicId(specialType));
      }
    }
    return known;
  },

  /**
   * Gives a player who already played before discoveries existed credit for the mechanics
   * of the levels behind them, so they are not shown hints for what they already know.
   * Versioned: when the list of mechanics grows (onboarding.discoveriesVersion), the new
   * ones (`since` in their entry) are credited the same way, once, and nothing already
   * stored is touched. A new player gets an empty set and starts from the basics.
   */
  seedDiscoveriesFromProgress() {
    if (this.isVersusRole) {
      return;
    }
    const currentVersion = this.gameConfig.onboarding.discoveriesVersion;
    const storage = this.storageManager;
    if (!storage.hasDiscoveries()) {
      const known = this.listMechanicsKnownFromProgress();
      if (known.size > 0) {
        storage.markDiscovered([...known]);
      } else {
        storage.resetDiscoveries();
      }
      storage.setDiscoveriesVersion(currentVersion);
      return;
    }
    const storedVersion = Math.max(storage.getDiscoveriesVersion(), LEGACY_DISCOVERIES_VERSION);
    if (storedVersion >= currentVersion) {
      return;
    }
    const mechanics = this.gameConfig.onboarding.mechanics;
    const added = [...this.listMechanicsKnownFromProgress()].filter(
      (id) => (mechanics[id]?.since || 0) > storedVersion
    );
    if (added.length > 0) {
      storage.markDiscovered(added);
    }
    storage.setDiscoveriesVersion(currentVersion);
  },
};
