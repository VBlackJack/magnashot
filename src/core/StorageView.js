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

/**
 * Storage seen by a versus board. Both boards of a duel must start equal and must never touch
 * the player's profile, so this view forwards the settings the engine reads (comfort and
 * display options) and answers everything else with the neutral value of a brand-new profile:
 * no upgrades, no coins, no records, no run snapshot. Every write is a no-op.
 *
 * Every public StorageManager method is listed in VERSUS_STORAGE_POLICY. A test fails when a
 * method is added to StorageManager without being classified here.
 */

/** How the view answers one StorageManager method. */
export const STORAGE_POLICIES = Object.freeze({
  /** Calls the real manager (settings and pure helpers only). */
  FORWARD: 'forward',
  /** Write: does nothing and returns undefined. */
  NOOP: 'noop',
  /** Returns false (nothing owned, nothing claimed, nothing purchased). */
  FALSE: 'false',
  /** Returns true. */
  TRUE: 'true',
  /** Returns 0 (coins, upgrade levels, records, streaks). */
  ZERO: 'zero',
  /** Returns 1 (the first campaign level). */
  ONE: 'one',
  /** Returns Infinity (nothing can be bought). */
  INFINITY: 'infinity',
  /** Returns null (no snapshot, no best run). */
  NULL: 'null',
  /** Returns an empty string. */
  EMPTY_STRING: 'emptyString',
  /** Returns a fresh empty object. */
  EMPTY_OBJECT: 'emptyObject',
  /** Returns a fresh empty array. */
  EMPTY_ARRAY: 'emptyArray',
  /** Returns the shape saveLevelResult reports, with no star earned. */
  LEVEL_RESULT: 'levelResult',
  /** Returns the streak grace shape with no grace available. */
  STREAK_GRACE: 'streakGrace',
  /** Returns the streak continuity shape with a dead streak. */
  STREAK_CONTINUITY: 'streakContinuity',
  /** Returns a ghost duel record with no duel. */
  DUEL_RECORD: 'duelRecord',
  /** Plumbing of the real manager: not exposed by the view. */
  INTERNAL: 'internal'
});

const P = STORAGE_POLICIES;

/** Policy of every public StorageManager method (instance side). */
export const VERSUS_STORAGE_POLICY = Object.freeze({
  // Lifecycle and private plumbing of the real manager.
  constructor: P.INTERNAL,
  init: P.INTERNAL,
  runSaveMigrations: P.INTERNAL,
  migrateLegacyKeys: P.INTERNAL,
  migrateMusicVolumeSteps: P.INTERNAL,
  bindCrossTabSync: P.INTERNAL,
  handleExternalStorageChange: P.INTERNAL,
  buildKey: P.INTERNAL,
  safeGetItem: P.INTERNAL,
  readJsonObject: P.INTERNAL,
  safeSetItem: P.INTERNAL,
  parseUnlockedLevel: P.INTERNAL,
  readNonNegativeInt: P.INTERNAL,

  // Settings and display options: forwarded, so both boards honour reduced motion and the like.
  getStoredLanguage: P.FORWARD,
  getLanguage: P.FORWARD,
  getMuted: P.FORWARD,
  getHighContrast: P.FORWARD,
  getTilt: P.FORWARD,
  getColorPatterns: P.FORWARD,
  getReducedMotion: P.FORWARD,
  getGamepadEnabled: P.FORWARD,
  getGamepadDeadzone: P.FORWARD,
  getGamepadAimSpeed: P.FORWARD,
  getGamepadInvertX: P.FORWARD,
  getGamepadRumble: P.FORWARD,
  getAnimationSpeed: P.FORWARD,
  getMusicEnabled: P.FORWARD,
  getMusicVolume: P.FORWARD,
  getResonanceEnabled: P.FORWARD,
  getRhythmOffsetMs: P.FORWARD,
  getUnlockedBallStyles: P.FORWARD,
  isBallStyleUnlocked: P.FORWARD,
  getActiveBallStyle: P.FORWARD,
  getRunSnapshotVersion: P.FORWARD,
  computeDailyStreakBonus: P.FORWARD,

  // Setting writes.
  setLanguage: P.NOOP,
  setMuted: P.NOOP,
  setHighContrast: P.NOOP,
  setTilt: P.NOOP,
  setColorPatterns: P.NOOP,
  setReducedMotion: P.NOOP,
  setGamepadEnabled: P.NOOP,
  setGamepadDeadzone: P.NOOP,
  setGamepadAimSpeed: P.NOOP,
  setGamepadInvertX: P.NOOP,
  setGamepadRumble: P.NOOP,
  setAnimationSpeed: P.NOOP,
  setMusicEnabled: P.NOOP,
  setMusicVolume: P.NOOP,
  setResonanceEnabled: P.NOOP,
  setRhythmOffsetMs: P.NOOP,
  setActiveBallStyle: P.NOOP,
  purchaseBallStyle: P.FALSE,

  // Daily.
  hasPlayedDailyToday: P.FALSE,
  getDailyStreak: P.ZERO,
  getDailyStreakGrace: P.STREAK_GRACE,
  resolveDailyStreakContinuity: P.STREAK_CONTINUITY,
  claimDailyPlayBonus: P.FALSE,
  getDailyHighScore: P.ZERO,
  setDailyHighScore: P.NOOP,
  getDailyHistory: P.EMPTY_ARRAY,
  seedDailyHistory: P.NOOP,
  recordDailyResult: P.NOOP,

  // Campaign and achievements.
  getUnlockedLevel: P.ONE,
  unlockLevel: P.NOOP,
  getLevelStats: P.EMPTY_OBJECT,
  saveLevelResult: P.LEVEL_RESULT,
  getTotalStars: P.ZERO,
  getUnlockedAchievements: P.EMPTY_ARRAY,
  unlockAchievement: P.FALSE,
  getAchievementRecords: P.EMPTY_OBJECT,
  recordAchievementProgress: P.NOOP,

  // Discoveries (hints).
  hasDiscoveries: P.FALSE,
  getDiscoveries: P.EMPTY_OBJECT,
  markDiscovered: P.NOOP,
  resetDiscoveries: P.NOOP,
  getDiscoveriesVersion: P.ZERO,
  setDiscoveriesVersion: P.NOOP,

  // Records.
  getEndlessHighScore: P.ZERO,
  setEndlessHighScore: P.NOOP,
  getFluxHighScore: P.ZERO,
  getFluxBestStage: P.ZERO,
  setFluxRecord: P.NOOP,
  getBlitzHighScore: P.ZERO,
  setBlitzHighScore: P.NOOP,
  getBossRushHighScore: P.ZERO,
  getBossRushBestWave: P.ZERO,
  setBossRushRecord: P.NOOP,
  getCascadeHighScore: P.ZERO,
  setCascadeHighScore: P.NOOP,
  getPuzzleHighScore: P.ZERO,
  getPuzzleBestStage: P.ZERO,
  setPuzzleRecord: P.NOOP,
  getClassicHighScore: P.ZERO,
  getClassicBestStage: P.ZERO,
  setClassicRecord: P.NOOP,
  getVersusTiers: P.EMPTY_ARRAY,
  getVersusRecords: P.EMPTY_OBJECT,
  recordVersusResult: P.NOOP,
  getVersusLocalMatches: P.ZERO,
  recordVersusLocalMatch: P.NOOP,
  getVersusTutorialSeen: P.FALSE,
  setVersusTutorialSeen: P.NOOP,
  isVersusTierUnlocked: P.FALSE,

  // Economy.
  getCoins: P.ZERO,
  setCoins: P.NOOP,
  addCoins: P.ZERO,
  getUpgrades: P.EMPTY_OBJECT,
  getUpgradeLevel: P.ZERO,
  getUpgradeCost: P.INFINITY,
  purchaseUpgrade: P.FALSE,

  // Mode unlocks.
  hasExistingProgress: P.FALSE,
  grandfatherModeUnlocks: P.NOOP,
  announceIntroducedModes: P.NOOP,
  getModeUnlocks: P.EMPTY_OBJECT,
  getClearedCampaignLevel: P.ZERO,
  getModeAccess: P.EMPTY_OBJECT,
  hasModeRecord: P.FALSE,
  syncEarnedModeUnlocks: P.EMPTY_ARRAY,
  ensureModeUnlocked: P.NOOP,

  // Ghost duels and Weekly Flux.
  getGhostDuels: P.EMPTY_ARRAY,
  recordGhostDuel: P.NOOP,
  retractLastGhostDuel: P.FALSE,
  getGhostDuelRecord: P.DUEL_RECORD,
  getGhostAlias: P.EMPTY_STRING,
  setGhostAlias: P.NOOP,
  getWeeklyFluxBest: P.NULL,
  setWeeklyFluxBest: P.NULL,
  claimWeeklyFluxBonus: P.FALSE,
  hasClaimedWeeklyFluxBonus: P.TRUE,

  // Statistics and the run snapshot.
  getPlayerStats: P.EMPTY_OBJECT,
  applyPlayerStatsDelta: P.EMPTY_OBJECT,
  loadRunSnapshot: P.NULL,
  saveRunSnapshot: P.NOOP,
  clearRunSnapshot: P.NOOP
});

const FIRST_LEVEL = 1;

/** Answer of every non-forwarded, non-internal policy (a fresh value on each call). */
const POLICY_ANSWERS = Object.freeze({
  [P.NOOP]: () => undefined,
  [P.FALSE]: () => false,
  [P.TRUE]: () => true,
  [P.ZERO]: () => 0,
  [P.ONE]: () => FIRST_LEVEL,
  [P.INFINITY]: () => Infinity,
  [P.NULL]: () => null,
  [P.EMPTY_STRING]: () => '',
  [P.EMPTY_OBJECT]: () => ({}),
  [P.EMPTY_ARRAY]: () => [],
  [P.LEVEL_RESULT]: () => ({ newlyEarnedStars: 0 }),
  [P.STREAK_GRACE]: () => ({ available: false, usedOn: null, daysUntilAvailable: 0 }),
  [P.STREAK_CONTINUITY]: () => ({ alive: false, usesGrace: false }),
  [P.DUEL_RECORD]: () => ({ won: 0, lost: 0, tie: 0 })
});

/**
 * Builds the storage a versus engine receives.
 * @param {object} storageManager - The real StorageManager (read for settings only).
 * @returns {object} An object exposing every non-internal StorageManager method.
 */
export function createVersusStorageView(storageManager) {
  const view = {};
  for (const [name, policy] of Object.entries(VERSUS_STORAGE_POLICY)) {
    if (policy === P.INTERNAL) {
      continue;
    }
    if (policy === P.FORWARD) {
      if (typeof storageManager?.[name] === 'function') {
        view[name] = (...args) => storageManager[name](...args);
      }
      continue;
    }
    const answer = POLICY_ANSWERS[policy];
    view[name] = () => answer();
  }
  return view;
}
