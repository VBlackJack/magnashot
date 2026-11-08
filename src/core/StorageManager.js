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

import { configRegistry } from './ConfigRegistry.js';
import { BALL_STYLES } from './Constants.js';
import { SeededRandom } from './SeededRandom.js';
import { countCampaignLevels } from '../game/LevelCatalog.js';
import { resolveModeAccess, computeNewlyEarned, getNewState, getSeenState } from '../game/ModeUnlocks.js';
import { normalizeShotTimeline } from '../game/ShotTimeline.js';
import { normalizePlayerStats, applyPlayerStatsDelta } from '../game/PlayerStats.js';

const MS_PER_UTC_DAY = 86_400_000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Value of a shot timeline's `c` field once its run is over. */
const COMPLETE_TIMELINE_FLAG = 1;

/**
 * Ordered save schema migrations. Contract: every step is idempotent and never deletes
 * data, so a step can be retried after a failure and a rollback to an older build keeps
 * working. A step returns false when it could not complete (it is then retried next launch).
 */
export const SAVE_MIGRATIONS = Object.freeze([
  { toVersion: 1, run: (manager) => manager.migrateLegacyKeys() },
  { toVersion: 2, run: (manager) => manager.grandfatherModeUnlocks() },
  { toVersion: 3, run: (manager) => manager.seedDailyHistory() },
  { toVersion: 4, run: (manager) => manager.announceIntroducedModes() }
]);
export const CURRENT_SAVE_SCHEMA_VERSION = SAVE_MIGRATIONS.at(-1).toVersion;

/**
 * Manages persistent player progress, settings, currency, and upgrades
 * with an automatic in-memory fallback when localStorage is unavailable.
 */
export class StorageManager {
  constructor() {
    this.storageConfig = null;
    this.defaultsConfig = null;
    this.upgradesConfig = null;
    this.achievementsConfig = null;
    this.dailyConfig = null;
    this.modeUnlocksConfig = null;
    this.dailyHistoryConfig = null;
    this.weeklyFluxConfig = null;
    this.playerStatsConfig = null;
    this.shotTimelineConfig = null;
    this.maxCampaignLevel = null;
    this.memoryFallback = new Map();
    this.upgradesCache = null;
    this.isCrossTabSyncBound = false;
  }

  init() {
    const gameConfig = configRegistry.get('game');
    const levelsConfig = configRegistry.get('levels');
    const campaignConfig = configRegistry.get('campaign');
    this.storageConfig = gameConfig.storage;
    this.defaultsConfig = gameConfig.defaults;
    this.upgradesConfig = gameConfig.upgrades;
    this.achievementsConfig = gameConfig.achievements || {};
    this.dailyConfig = gameConfig.daily || {};
    this.modeUnlocksConfig = gameConfig.modeUnlocks || {};
    this.dailyHistoryConfig = gameConfig.dailyHistory || {};
    this.weeklyFluxConfig = gameConfig.weeklyFlux || {};
    this.playerStatsConfig = gameConfig.playerStats || {};
    this.shotTimelineConfig = gameConfig.shotTimeline || {};
    this.maxCampaignLevel = countCampaignLevels(levelsConfig, campaignConfig);
    this.upgradesCache = null;
    this.runSaveMigrations();
    this.bindCrossTabSync();
  }

  /**
   * Applies the pending save schema steps in order. The stored version is read straight from
   * localStorage (never the in-memory fallback) and written only after a step succeeded.
   * A version newer than this build knows (downgrade) is left untouched.
   */
  runSaveMigrations() {
    const versionSuffix = this.storageConfig.keys.schemaVersion;
    if (typeof versionSuffix !== 'string') {
      this.migrateLegacyKeys();
      return;
    }
    const versionKey = this.buildKey(versionSuffix);
    let stored;
    try {
      const parsed = Number.parseInt(localStorage.getItem(versionKey), 10);
      stored = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return;
    }
    if (stored > CURRENT_SAVE_SCHEMA_VERSION) {
      return;
    }
    for (const step of SAVE_MIGRATIONS) {
      if (step.toVersion <= stored) {
        continue;
      }
      if (step.run(this) === false) {
        return;
      }
      try {
        localStorage.setItem(versionKey, String(step.toVersion));
      } catch {
        return;
      }
    }
  }

  /**
   * One-time recovery of progress saved under a pre-rename key prefix. Each legacy key is
   * copied to the same suffix under the current prefix only when that target is absent,
   * except: the configured excluded keys (the stale run snapshot) are never copied, the
   * unlocked level keeps the higher of both sides, and level stats merge the best value of
   * each field per level. Legacy keys are never deleted, so rolling back keeps working.
   * Only keys with the configured legacy prefixes are touched (the origin is shared with
   * other projects). A marker key prevents reruns; every storage access is guarded.
   */
  migrateLegacyKeys() {
    const migration = this.storageConfig.legacyMigration;
    const legacyPrefixes = migration && Array.isArray(migration.prefixes) ? migration.prefixes : [];
    if (legacyPrefixes.length === 0) {
      return true;
    }
    const markerKey = this.buildKey(migration.markerKey);
    try {
      if (localStorage.getItem(markerKey) !== null) {
        return true;
      }
      const legacyKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (typeof key === 'string' && legacyPrefixes.some((prefix) => key.startsWith(prefix))) {
          legacyKeys.push(key);
        }
      }
      const resolveSuffixes = (names) => (Array.isArray(names) ? names : [])
        .map((name) => this.storageConfig.keys[name])
        .filter((suffix) => typeof suffix === 'string');
      const excluded = new Set(resolveSuffixes(migration.excludedKeys));
      const maxMerged = new Set(resolveSuffixes(migration.maxMergedKeys));
      const statsMerged = new Set(resolveSuffixes(migration.levelStatsMergedKeys));
      for (const legacyKey of legacyKeys) {
        const prefix = legacyPrefixes.find((candidate) => legacyKey.startsWith(candidate));
        const suffix = legacyKey.slice(prefix.length);
        const targetKey = `${this.storageConfig.prefix}${suffix}`;
        if (targetKey === legacyKey || excluded.has(suffix)) {
          continue;
        }
        const value = localStorage.getItem(legacyKey);
        if (value === null) {
          continue;
        }
        const current = localStorage.getItem(targetKey);
        if (current === null) {
          localStorage.setItem(targetKey, value);
        } else if (maxMerged.has(suffix)) {
          const merged = Math.max(this.parseUnlockedLevel(current), this.parseUnlockedLevel(value));
          localStorage.setItem(targetKey, String(merged));
        } else if (statsMerged.has(suffix)) {
          const merged = StorageManager.mergeLevelStats(
            StorageManager.parseLevelStats(current),
            StorageManager.parseLevelStats(value)
          );
          localStorage.setItem(targetKey, JSON.stringify(merged));
        }
      }
      localStorage.setItem(markerKey, String(true));
      return true;
    } catch {
      // localStorage is restricted or full; migration is retried on the next launch
      return false;
    }
  }

  /**
   * Keeps the in-memory copy in step with other tabs of the game. The browser fires a
   * `storage` event in every other tab on each write; without it each tab kept the values
   * it first read and wrote them back over progress made elsewhere (coins, upgrades...).
   */
  bindCrossTabSync() {
    if (this.isCrossTabSyncBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }
    window.addEventListener('storage', (event) => this.handleExternalStorageChange(event));
    this.isCrossTabSyncBound = true;
  }

  /**
   * Applies a write made by another tab. A cleared storage (key null) drops every cached value.
   * @param {{key: string|null, newValue: string|null}} event - The `storage` event.
   */
  handleExternalStorageChange(event) {
    if (event.key === null) {
      this.memoryFallback.clear();
      this.upgradesCache = null;
      return;
    }
    if (!event.key.startsWith(this.storageConfig.prefix)) {
      return;
    }
    if (event.newValue === null) {
      this.memoryFallback.delete(event.key);
    } else {
      this.memoryFallback.set(event.key, event.newValue);
    }
    if (event.key === this.buildKey(this.storageConfig.keys.upgrades)) {
      this.upgradesCache = null;
    }
  }

  buildKey(shortKey) {
    return `${this.storageConfig.prefix}${shortKey}`;
  }

  /**
   * Reads a value with the in-memory copy as the source of truth, so a write that
   * localStorage rejected (quota, security) is never shadowed by an older persisted value.
   * The memory copy is seeded from localStorage on the first read of each key.
   */
  safeGetItem(shortKey) {
    const fullKey = this.buildKey(shortKey);
    if (this.memoryFallback.has(fullKey)) {
      return this.memoryFallback.get(fullKey);
    }
    let val = null;
    try {
      val = localStorage.getItem(fullKey);
    } catch {
      // localStorage is restricted; only the in-memory copy is available
    }
    if (val !== null) {
      this.memoryFallback.set(fullKey, val);
    }
    return val;
  }

  /**
   * Parses a stored JSON value and only accepts a plain object; any other shape
   * (null, array, number, string, corrupted text) yields an empty object.
   */
  readJsonObject(shortKey) {
    const raw = this.safeGetItem(shortKey);
    if (!raw) {
      return {};
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    return StorageManager.isPlainObject(parsed) ? parsed : {};
  }

  static isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  static toNonNegativeNumber(value) {
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  safeSetItem(shortKey, value) {
    const fullKey = this.buildKey(shortKey);
    const strValue = String(value);
    this.memoryFallback.set(fullKey, strValue);
    try {
      localStorage.setItem(fullKey, strValue);
    } catch {
      // Ignore storage quota or security restrictions; kept in memoryFallback
    }
  }

  getStoredLanguage() {
    return this.safeGetItem(this.storageConfig.keys.language);
  }

  getLanguage() {
    const raw = this.safeGetItem(this.storageConfig.keys.language);
    return raw || this.defaultsConfig.language;
  }

  setLanguage(lang) {
    this.safeSetItem(this.storageConfig.keys.language, lang);
  }

  getMuted() {
    const raw = this.safeGetItem(this.storageConfig.keys.muted);
    return raw === 'true';
  }

  setMuted(muted) {
    this.safeSetItem(this.storageConfig.keys.muted, Boolean(muted));
  }

  getHighContrast() {
    const raw = this.safeGetItem(this.storageConfig.keys.highContrast);
    return raw === 'true';
  }

  setHighContrast(enabled) {
    this.safeSetItem(this.storageConfig.keys.highContrast, Boolean(enabled));
  }

  /**
   * @param {boolean} [defaultEnabled] - Answer for a player who never chose.
   * @returns {boolean} Whether tilt control is on.
   */
  getTilt(defaultEnabled = false) {
    const stored = this.safeGetItem(this.storageConfig.keys.tilt);
    return stored === null ? defaultEnabled : stored === 'true';
  }

  setTilt(enabled) {
    this.safeSetItem(this.storageConfig.keys.tilt, Boolean(enabled));
  }

  getColorPatterns() {
    return this.safeGetItem(this.storageConfig.keys.colorPatterns) === 'true';
  }

  setColorPatterns(enabled) {
    this.safeSetItem(this.storageConfig.keys.colorPatterns, Boolean(enabled));
  }

  getReducedMotion() {
    const raw = this.safeGetItem(this.storageConfig.keys.reducedMotion);
    return raw === 'true';
  }

  setReducedMotion(enabled) {
    this.safeSetItem(this.storageConfig.keys.reducedMotion, Boolean(enabled));
  }

  /**
   * @returns {number} Stored animation speed multiplier, or the configured default (1x).
   */
  getAnimationSpeed() {
    const fallback = this.defaultsConfig.animationSpeed ?? 1;
    const key = this.storageConfig.keys.animationSpeed;
    if (!key) {
      return fallback;
    }
    const raw = this.safeGetItem(key);
    if (raw === null) {
      return fallback;
    }
    const num = Number.parseFloat(raw);
    const allowed = this.defaultsConfig.animationSpeeds;
    if (Array.isArray(allowed) && allowed.includes(num)) {
      return num;
    }
    return fallback;
  }

  setAnimationSpeed(speed) {
    const allowed = this.defaultsConfig.animationSpeeds;
    const num = Number(speed);
    if (Array.isArray(allowed) && allowed.includes(num) && this.storageConfig.keys.animationSpeed) {
      this.safeSetItem(this.storageConfig.keys.animationSpeed, num);
    }
  }

  hasPlayedDailyToday(dateKey) {
    const lastDate = this.safeGetItem(this.storageConfig.keys.dailyLastPlayedDate);
    return lastDate === dateKey;
  }

  static parseUtcDateKeyMs(dateKey) {
    if (typeof dateKey !== 'string') {
      return Number.NaN;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) {
      return Number.NaN;
    }
    return Date.UTC(
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10) - 1,
      Number.parseInt(match[3], 10)
    );
  }

  getDailyStreak(referenceDateKey = SeededRandom.getTodayDateKey()) {
    const streakKey = this.storageConfig?.keys?.dailyStreak;
    const dateKeyProp = this.storageConfig?.keys?.dailyStreakDate;
    if (!streakKey) {
      return 0;
    }
    const storedStreak = this.readNonNegativeInt(streakKey);
    const storedDate = (dateKeyProp && this.safeGetItem(dateKeyProp))
      || this.safeGetItem(this.storageConfig.keys.dailyLastPlayedDate);
    if (storedStreak <= 0 || !storedDate) {
      return 0;
    }
    return this.resolveDailyStreakContinuity(storedDate, referenceDateKey).alive ? storedStreak : 0;
  }

  /** Whole UTC days from one date key to another, or NaN when either key is invalid. */
  static utcDaysBetween(fromDateKey, toDateKey) {
    const fromMs = StorageManager.parseUtcDateKeyMs(fromDateKey);
    const toMs = StorageManager.parseUtcDateKeyMs(toDateKey);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      return Number.NaN;
    }
    return Math.round((toMs - fromMs) / MS_PER_UTC_DAY);
  }

  /**
   * Whether a missed day can be forgiven on referenceDateKey: grace is configured and
   * has not been used within the configured window.
   * @returns {{available: boolean, usedOn: string|null, daysUntilAvailable: number}}
   *   daysUntilAvailable is 0 when the grace is available or switched off.
   */
  getDailyStreakGrace(referenceDateKey = SeededRandom.getTodayDateKey()) {
    const graceKey = this.storageConfig?.keys?.dailyStreakGraceDate;
    const stored = graceKey ? this.safeGetItem(graceKey) : null;
    const usedOn = Number.isFinite(StorageManager.parseUtcDateKeyMs(stored)) ? stored : null;
    const graceDays = Math.floor(StorageManager.toNonNegativeNumber(this.dailyConfig?.streakGraceDays));
    const windowDays = Math.floor(StorageManager.toNonNegativeNumber(this.dailyConfig?.streakGraceWindowDays));
    if (graceDays <= 0) {
      return { available: false, usedOn, daysUntilAvailable: 0 };
    }
    if (!usedOn) {
      return { available: true, usedOn: null, daysUntilAvailable: 0 };
    }
    const sinceUse = StorageManager.utcDaysBetween(usedOn, referenceDateKey);
    const isAvailable = !(sinceUse < windowDays);
    return { available: isAvailable, usedOn, daysUntilAvailable: isAvailable ? 0 : windowDays - sinceUse };
  }

  /**
   * How the streak stands from lastDateKey to referenceDateKey.
   * @returns {{alive: boolean, usesGrace: boolean}} usesGrace is true when only the
   *   forgiveness of missed days keeps it alive.
   */
  resolveDailyStreakContinuity(lastDateKey, referenceDateKey) {
    const gap = StorageManager.utcDaysBetween(lastDateKey, referenceDateKey);
    if (!Number.isFinite(gap) || gap < 0) {
      return { alive: false, usesGrace: false };
    }
    if (gap <= 1) {
      return { alive: true, usesGrace: false };
    }
    const graceDays = Math.floor(StorageManager.toNonNegativeNumber(this.dailyConfig?.streakGraceDays));
    const missedDays = gap - 1;
    if (missedDays <= graceDays && this.getDailyStreakGrace(referenceDateKey).available) {
      return { alive: true, usesGrace: true };
    }
    return { alive: false, usesGrace: false };
  }

  computeDailyStreakBonus(streak, streakOptions = null) {
    if (!streakOptions || streak <= 1) {
      return 0;
    }
    const step = StorageManager.toNonNegativeNumber(streakOptions.streakStepCoins);
    const cap = StorageManager.toNonNegativeNumber(streakOptions.maxStreakBonusCoins);
    if (step <= 0 || cap <= 0) {
      return 0;
    }
    return Math.min(cap, (streak - 1) * step);
  }

  claimDailyPlayBonus(dateKey, bonusCoins, streakOptions = null) {
    if (this.hasPlayedDailyToday(dateKey)) {
      return false;
    }
    const streakKey = this.storageConfig?.keys?.dailyStreak;
    const streakDateKey = this.storageConfig?.keys?.dailyStreakDate;
    const prevDate = (streakDateKey && this.safeGetItem(streakDateKey))
      || this.safeGetItem(this.storageConfig.keys.dailyLastPlayedDate);
    const prevStreak = streakKey ? this.readNonNegativeInt(streakKey) : 0;
    const continuity = prevDate
      ? this.resolveDailyStreakContinuity(prevDate, dateKey)
      : { alive: false, usesGrace: false };
    const nextStreak = continuity.alive ? Math.max(1, prevStreak) + 1 : 1;
    const graceKey = this.storageConfig?.keys?.dailyStreakGraceDate;
    if (continuity.usesGrace && graceKey) {
      this.safeSetItem(graceKey, dateKey);
    }

    this.safeSetItem(this.storageConfig.keys.dailyLastPlayedDate, dateKey);
    if (streakDateKey) {
      this.safeSetItem(streakDateKey, dateKey);
    }
    if (streakKey) {
      this.safeSetItem(streakKey, nextStreak);
    }

    const baseCoins = Math.max(0, Math.floor(Number(bonusCoins) || 0));
    const streakBonus = this.computeDailyStreakBonus(nextStreak, streakOptions);
    const totalBonus = baseCoins + streakBonus;
    if (totalBonus > 0) {
      this.addCoins(totalBonus);
    }
    return true;
  }

  getUnlockedLevel() {
    return this.parseUnlockedLevel(this.safeGetItem(this.storageConfig.keys.unlockedLevel));
  }

  /** Validates a stored unlocked-level value: default when invalid, clamped to the campaign size. */
  parseUnlockedLevel(raw) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return this.defaultsConfig.initialUnlockedLevel;
    }
    return Math.min(parsed, this.maxCampaignLevel);
  }

  /** Parses a raw level-stats string into sanitized per-level entries (empty when invalid). */
  static parseLevelStats(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    const stats = {};
    if (!StorageManager.isPlainObject(parsed)) {
      return stats;
    }
    for (const [levelId, entry] of Object.entries(parsed)) {
      if (StorageManager.isPlainObject(entry)) {
        stats[levelId] = {
          bestScore: StorageManager.toNonNegativeNumber(entry.bestScore),
          stars: StorageManager.toNonNegativeNumber(entry.stars)
        };
      }
    }
    return stats;
  }

  /** Merges two sanitized level-stats maps keeping the best value of each field per level. */
  static mergeLevelStats(first, second) {
    const merged = { ...first };
    for (const [levelId, entry] of Object.entries(second)) {
      const existing = merged[levelId];
      merged[levelId] = existing
        ? { bestScore: Math.max(existing.bestScore, entry.bestScore), stars: Math.max(existing.stars, entry.stars) }
        : entry;
    }
    return merged;
  }

  unlockLevel(levelId) {
    const clamped = Math.min(levelId, this.maxCampaignLevel);
    const current = this.getUnlockedLevel();
    if (clamped > current) {
      this.safeSetItem(this.storageConfig.keys.unlockedLevel, clamped);
    }
  }

  getLevelStats() {
    return StorageManager.parseLevelStats(this.safeGetItem(this.storageConfig.keys.levelStats));
  }

  saveLevelResult(levelId, score, stars) {
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    const cleanStars = Math.max(0, Math.floor(Number(stars) || 0));
    const stats = this.getLevelStats();
    const existing = stats[levelId] || { bestScore: 0, stars: 0 };
    const newlyEarnedStars = Math.max(0, cleanStars - existing.stars);
    stats[levelId] = {
      bestScore: Math.max(existing.bestScore, cleanScore),
      stars: Math.max(existing.stars, cleanStars)
    };
    this.safeSetItem(this.storageConfig.keys.levelStats, JSON.stringify(stats));
    return { newlyEarnedStars };
  }

  getTotalStars() {
    const stats = this.getLevelStats();
    let total = 0;
    for (const entry of Object.values(stats)) {
      total += entry.stars;
    }
    return total;
  }

  getUnlockedAchievements() {
    const parsed = this.readJsonObject(this.storageConfig.keys.achievements);
    const unlocked = {};
    for (const [achievementId, value] of Object.entries(parsed)) {
      if (value === true) {
        unlocked[achievementId] = true;
      }
    }
    return unlocked;
  }

  unlockAchievement(achievementId) {
    const spec = this.achievementsConfig[achievementId];
    if (!spec) {
      return false;
    }
    const unlocked = this.getUnlockedAchievements();
    if (unlocked[achievementId]) {
      return false;
    }
    unlocked[achievementId] = true;
    this.safeSetItem(this.storageConfig.keys.achievements, JSON.stringify(unlocked));
    if (spec.rewardCoins > 0) {
      this.addCoins(spec.rewardCoins);
    }
    return true;
  }

  /**
   * Persistent personal-best counters backing the Workshop achievement progress bars.
   * @returns {{maxCombo: number, endlessWave: number, maxAvalanche: number, bossesDestroyed: number, shotsRemainingOnClear: number}}
   */
  getAchievementRecords() {
    const key = this.storageConfig?.keys?.achievementRecords;
    const parsed = key ? this.readJsonObject(key) : {};
    return {
      maxCombo: StorageManager.toNonNegativeNumber(parsed.maxCombo),
      endlessWave: StorageManager.toNonNegativeNumber(parsed.endlessWave),
      maxAvalanche: StorageManager.toNonNegativeNumber(parsed.maxAvalanche),
      bossesDestroyed: StorageManager.toNonNegativeNumber(parsed.bossesDestroyed),
      shotsRemainingOnClear: StorageManager.toNonNegativeNumber(parsed.shotsRemainingOnClear)
    };
  }

  /**
   * Updates any achievement progress counter whose new value exceeds the stored best.
   * @param {Partial<ReturnType<StorageManager['getAchievementRecords']>>} partialRecords
   */
  recordAchievementProgress(partialRecords) {
    const key = this.storageConfig?.keys?.achievementRecords;
    if (!key || !partialRecords || typeof partialRecords !== 'object') {
      return;
    }
    const current = this.getAchievementRecords();
    let changed = false;
    for (const field of Object.keys(current)) {
      if (Object.prototype.hasOwnProperty.call(partialRecords, field)) {
        const candidate = StorageManager.toNonNegativeNumber(partialRecords[field]);
        if (candidate > current[field]) {
          current[field] = candidate;
          changed = true;
        }
      }
    }
    if (changed) {
      this.safeSetItem(key, JSON.stringify(current));
    }
  }

  /** True once discoveries have been written, even as an empty set. */
  hasDiscoveries() {
    return this.safeGetItem(this.storageConfig.keys.discoveries) !== null;
  }

  /** Mechanics whose first-encounter hint the player has already been shown. */
  getDiscoveries() {
    const parsed = this.readJsonObject(this.storageConfig.keys.discoveries);
    const seen = {};
    for (const [mechanicId, value] of Object.entries(parsed)) {
      if (value === true) {
        seen[mechanicId] = true;
      }
    }
    return seen;
  }

  /** @param {string[]} mechanicIds - Mechanics to record as discovered. */
  markDiscovered(mechanicIds) {
    const seen = this.getDiscoveries();
    for (const mechanicId of mechanicIds) {
      seen[mechanicId] = true;
    }
    this.safeSetItem(this.storageConfig.keys.discoveries, JSON.stringify(seen));
  }

  resetDiscoveries() {
    this.safeSetItem(this.storageConfig.keys.discoveries, JSON.stringify({}));
  }

  /**
   * Version of the mechanic list the stored discoveries were seeded against; 0 when none
   * was recorded (discoveries written before versioning count as the first list).
   */
  getDiscoveriesVersion() {
    return this.readNonNegativeInt(this.storageConfig.keys.discoveriesVersion);
  }

  /** @param {number} version - Version of the mechanic list the discoveries now cover. */
  setDiscoveriesVersion(version) {
    this.safeSetItem(this.storageConfig.keys.discoveriesVersion, Math.max(0, Math.floor(Number(version) || 0)));
  }

  getEndlessHighScore() {
    return this.readNonNegativeInt(this.storageConfig.keys.endlessHighScore);
  }

  setEndlessHighScore(score) {
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    const current = this.getEndlessHighScore();
    if (cleanScore > current) {
      this.safeSetItem(this.storageConfig.keys.endlessHighScore, cleanScore);
    }
  }

  readNonNegativeInt(shortKey) {
    const parsed = Number.parseInt(this.safeGetItem(shortKey), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  getFluxHighScore() {
    return this.readNonNegativeInt(this.storageConfig.keys.fluxHighScore);
  }

  getFluxBestStage() {
    return this.readNonNegativeInt(this.storageConfig.keys.fluxBestStage);
  }

  /**
   * Keeps the best Flux score and the furthest Flux stage, each on its own: the deepest
   * run is not always the highest-scoring one.
   */
  setFluxRecord(score, stage) {
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    const cleanStage = Math.max(0, Math.floor(Number(stage) || 0));
    if (cleanScore > this.getFluxHighScore()) {
      this.safeSetItem(this.storageConfig.keys.fluxHighScore, cleanScore);
    }
    if (cleanStage > this.getFluxBestStage()) {
      this.safeSetItem(this.storageConfig.keys.fluxBestStage, cleanStage);
    }
  }

  getBlitzHighScore() {
    const key = this.storageConfig?.keys?.blitzHighScore;
    return key ? this.readNonNegativeInt(key) : 0;
  }

  setBlitzHighScore(score) {
    const key = this.storageConfig?.keys?.blitzHighScore;
    if (!key) {
      return;
    }
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    if (cleanScore > this.getBlitzHighScore()) {
      this.safeSetItem(key, cleanScore);
    }
  }

  getBossRushHighScore() {
    const key = this.storageConfig?.keys?.bossRushHighScore;
    return key ? this.readNonNegativeInt(key) : 0;
  }

  getBossRushBestWave() {
    const key = this.storageConfig?.keys?.bossRushBestWave;
    return key ? this.readNonNegativeInt(key) : 0;
  }

  setBossRushRecord(score, wave) {
    const scoreKey = this.storageConfig?.keys?.bossRushHighScore;
    const waveKey = this.storageConfig?.keys?.bossRushBestWave;
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    const cleanWave = Math.max(0, Math.floor(Number(wave) || 0));
    if (scoreKey && cleanScore > this.getBossRushHighScore()) {
      this.safeSetItem(scoreKey, cleanScore);
    }
    if (waveKey && cleanWave > this.getBossRushBestWave()) {
      this.safeSetItem(waveKey, cleanWave);
    }
  }

  getCascadeHighScore() {
    const key = this.storageConfig?.keys?.cascadeHighScore;
    return key ? this.readNonNegativeInt(key) : 0;
  }

  setCascadeHighScore(score) {
    const key = this.storageConfig?.keys?.cascadeHighScore;
    if (!key) {
      return;
    }
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    if (cleanScore > this.getCascadeHighScore()) {
      this.safeSetItem(key, cleanScore);
    }
  }

  getPuzzleHighScore() {
    const key = this.storageConfig?.keys?.puzzleHighScore;
    return key ? this.readNonNegativeInt(key) : 0;
  }

  getPuzzleBestStage() {
    const key = this.storageConfig?.keys?.puzzleBestStage;
    return key ? this.readNonNegativeInt(key) : 0;
  }

  setPuzzleRecord(score, stage) {
    const scoreKey = this.storageConfig?.keys?.puzzleHighScore;
    const stageKey = this.storageConfig?.keys?.puzzleBestStage;
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    const cleanStage = Math.max(0, Math.floor(Number(stage) || 0));
    if (scoreKey && cleanScore > this.getPuzzleHighScore()) {
      this.safeSetItem(scoreKey, cleanScore);
    }
    if (stageKey && cleanStage > this.getPuzzleBestStage()) {
      this.safeSetItem(stageKey, cleanStage);
    }
  }

  getClassicHighScore() {
    const key = this.storageConfig?.keys?.classicHighScore;
    return key ? this.readNonNegativeInt(key) : 0;
  }

  getClassicBestStage() {
    const key = this.storageConfig?.keys?.classicBestStage;
    return key ? this.readNonNegativeInt(key) : 0;
  }

  setClassicRecord(score, stage) {
    const scoreKey = this.storageConfig?.keys?.classicHighScore;
    const stageKey = this.storageConfig?.keys?.classicBestStage;
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    const cleanStage = Math.max(0, Math.floor(Number(stage) || 0));
    if (scoreKey && cleanScore > this.getClassicHighScore()) {
      this.safeSetItem(scoreKey, cleanScore);
    }
    if (stageKey && cleanStage > this.getClassicBestStage()) {
      this.safeSetItem(stageKey, cleanStage);
    }
  }

  getDailyHighScore(dateKey = SeededRandom.getTodayDateKey()) {
    const savedDate = this.safeGetItem(this.storageConfig.keys.dailyBestDate);
    if (savedDate !== dateKey) {
      return 0;
    }
    const raw = this.safeGetItem(this.storageConfig.keys.dailyBest);
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  setDailyHighScore(score, dateKey = SeededRandom.getTodayDateKey()) {
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    const current = this.getDailyHighScore(dateKey);
    const savedDate = this.safeGetItem(this.storageConfig.keys.dailyBestDate);
    if (savedDate !== dateKey || cleanScore > current) {
      this.safeSetItem(this.storageConfig.keys.dailyBestDate, dateKey);
      this.safeSetItem(this.storageConfig.keys.dailyBest, cleanScore);
    }
  }

  getCoins() {
    const raw = this.safeGetItem(this.storageConfig.keys.coins);
    if (raw === null) {
      return this.defaultsConfig.initialCoins;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : this.defaultsConfig.initialCoins;
  }

  setCoins(amount) {
    if (!Number.isFinite(amount)) {
      return;
    }
    this.safeSetItem(this.storageConfig.keys.coins, Math.max(0, Math.floor(amount)));
  }

  addCoins(delta) {
    if (!Number.isFinite(delta)) {
      return this.getCoins();
    }
    const updated = this.getCoins() + delta;
    this.setCoins(updated);
    return updated;
  }

  getUpgrades() {
    if (this.upgradesCache) {
      return { ...this.upgradesCache };
    }
    const parsed = this.readJsonObject(this.storageConfig.keys.upgrades);
    const result = {};
    for (const key of Object.keys(this.upgradesConfig)) {
      result[key] = StorageManager.toNonNegativeNumber(parsed[key]);
    }
    this.upgradesCache = result;
    return { ...this.upgradesCache };
  }

  getUpgradeLevel(upgradeKey) {
    if (!this.upgradesCache) {
      this.getUpgrades();
    }
    return this.upgradesCache[upgradeKey] || 0;
  }

  getUpgradeCost(upgradeKey) {
    const spec = this.upgradesConfig[upgradeKey];
    if (!spec) {
      return Infinity;
    }
    const lvl = this.getUpgradeLevel(upgradeKey);
    return spec.baseCost + lvl * spec.costStep;
  }

  purchaseUpgrade(upgradeKey) {
    const spec = this.upgradesConfig[upgradeKey];
    if (!spec) {
      return false;
    }
    const currentLevel = this.getUpgradeLevel(upgradeKey);
    if (currentLevel >= spec.maxLevel) {
      return false;
    }
    const cost = this.getUpgradeCost(upgradeKey);
    const coins = this.getCoins();
    if (coins < cost) {
      return false;
    }
    this.setCoins(coins - cost);
    const upgrades = this.getUpgrades();
    upgrades[upgradeKey] = currentLevel + 1;
    this.upgradesCache = upgrades;
    this.safeSetItem(this.storageConfig.keys.upgrades, JSON.stringify(upgrades));
    return true;
  }

  getUnlockedBallStyles() {
    const defaultStyle = this.defaultsConfig?.ballStyle || BALL_STYLES.CLASSIC;
    const key = this.storageConfig?.keys?.unlockedBallStyles;
    const parsed = key ? this.readJsonObject(key) : {};
    const unlocked = { [defaultStyle]: true };
    for (const [styleId, value] of Object.entries(parsed)) {
      if (value === true) {
        unlocked[styleId] = true;
      }
    }
    return unlocked;
  }

  isBallStyleUnlocked(styleId) {
    if (!styleId || typeof styleId !== 'string') {
      return false;
    }
    const unlocked = this.getUnlockedBallStyles();
    return unlocked[styleId] === true;
  }

  getActiveBallStyle() {
    const defaultStyle = this.defaultsConfig?.ballStyle || BALL_STYLES.CLASSIC;
    const key = this.storageConfig?.keys?.activeBallStyle;
    const stored = key ? this.safeGetItem(key) : null;
    if (stored && this.isBallStyleUnlocked(stored)) {
      return stored;
    }
    return defaultStyle;
  }

  setActiveBallStyle(styleId) {
    if (!this.isBallStyleUnlocked(styleId)) {
      return false;
    }
    const key = this.storageConfig?.keys?.activeBallStyle;
    if (key) {
      this.safeSetItem(key, styleId);
    }
    return true;
  }

  purchaseBallStyle(styleId, cost) {
    const stylesCatalog = configRegistry.get('balls')?.styles || {};
    const spec = stylesCatalog[styleId];
    if (!spec) {
      return false;
    }
    if (this.isBallStyleUnlocked(styleId)) {
      this.setActiveBallStyle(styleId);
      return false;
    }
    const cleanCost = Math.max(0, Math.floor(Number(cost ?? spec.cost) || 0));
    const coins = this.getCoins();
    if (coins < cleanCost) {
      return false;
    }
    this.setCoins(coins - cleanCost);
    const unlocked = this.getUnlockedBallStyles();
    unlocked[styleId] = true;
    const key = this.storageConfig?.keys?.unlockedBallStyles;
    if (key) {
      this.safeSetItem(key, JSON.stringify(unlocked));
    }
    this.setActiveBallStyle(styleId);
    return true;
  }

  /**
   * Whether the stored profile holds any progress, read straight from localStorage so a
   * restricted storage throws to the caller. Uses the configured grandfather progress keys.
   * @returns {boolean}
   */
  hasExistingProgress() {
    const cfg = this.modeUnlocksConfig || {};
    const grandfather = cfg.grandfather || {};
    const emptyValues = new Set(Array.isArray(grandfather.emptyValues) ? grandfather.emptyValues : []);
    const keys = this.storageConfig.keys;
    const unlockedLevel = Number.parseInt(localStorage.getItem(this.buildKey(keys.unlockedLevel)), 10);
    if (Number.isFinite(unlockedLevel) && unlockedLevel > (grandfather.unlockedLevelAbove ?? 1)) {
      return true;
    }
    for (const name of Array.isArray(grandfather.progressKeys) ? grandfather.progressKeys : []) {
      const suffix = keys[name];
      const raw = typeof suffix === 'string' ? localStorage.getItem(this.buildKey(suffix)) : null;
      if (raw !== null && !emptyValues.has(String(raw).trim())) {
        return true;
      }
    }
    return false;
  }

  /**
   * Migration v2. A player with existing progress keeps every mode: all gated modes are
   * merged into the stored unlocks as "seen" (no badge). Existing entries are never removed
   * or downgraded, so reruns change nothing. Reads and writes localStorage directly so a
   * restricted storage returns false and the step is retried on the next launch.
   * @returns {boolean} False when storage could not be read or written.
   */
  grandfatherModeUnlocks() {
    const cfg = this.modeUnlocksConfig || {};
    const keys = this.storageConfig.keys;
    try {
      const hasProgress = this.hasExistingProgress();
      if (!hasProgress) {
        return true;
      }
      const fullKey = this.buildKey(keys.modeUnlocks);
      const merged = StorageManager.sanitizeModeUnlocks(JSON.parse(localStorage.getItem(fullKey) || '{}'), cfg);
      for (const mode of Object.keys(cfg.campaignLevelCleared || {})) {
        if (!Object.hasOwn(merged, mode) && !Object.hasOwn(cfg.introduced || {}, mode)) {
          merged[mode] = getSeenState(cfg);
        }
      }
      localStorage.setItem(fullKey, JSON.stringify(merged));
      this.memoryFallback.delete(fullKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Migration v4. A player with existing progress gets every mode introduced after the
   * grandfathering (config `modeUnlocks.introduced`) announced as "new", unless an entry
   * is already stored. Existing entries are never changed or downgraded, so reruns change
   * nothing. A fresh profile is left untouched: it unlocks the mode through the campaign.
   * @returns {boolean} False when storage could not be read or written.
   */
  announceIntroducedModes() {
    const cfg = this.modeUnlocksConfig || {};
    const introduced = Object.keys(cfg.introduced || {});
    if (introduced.length === 0) {
      return true;
    }
    try {
      if (!this.hasExistingProgress()) {
        return true;
      }
      const fullKey = this.buildKey(this.storageConfig.keys.modeUnlocks);
      const merged = StorageManager.sanitizeModeUnlocks(JSON.parse(localStorage.getItem(fullKey) || '{}'), cfg);
      let changed = false;
      for (const mode of introduced) {
        if (!Object.hasOwn(merged, mode)) {
          merged[mode] = getNewState(cfg);
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(fullKey, JSON.stringify(merged));
        this.memoryFallback.delete(fullKey);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Migration v3. Seeds the Daily history with the stored daily best (wave and mutator
   * unknown), only when no history exists yet.
   * @returns {boolean} False when storage could not be read or written.
   */
  seedDailyHistory() {
    const keys = this.storageConfig.keys;
    try {
      const historyKey = this.buildKey(keys.dailyHistory);
      if (localStorage.getItem(historyKey) !== null) {
        return true;
      }
      const score = Number.parseInt(localStorage.getItem(this.buildKey(keys.dailyBest)), 10);
      const dateKey = localStorage.getItem(this.buildKey(keys.dailyBestDate));
      if (!(score > 0) || !StorageManager.isDateKey(dateKey)) {
        return true;
      }
      const streak = Number.parseInt(localStorage.getItem(this.buildKey(keys.dailyStreak)), 10);
      const streakDate = localStorage.getItem(this.buildKey(keys.dailyStreakDate));
      const entry = {
        d: dateKey,
        s: score,
        w: null,
        m: null,
        k: streakDate === dateKey && streak > 0 ? streak : null,
        g: false
      };
      localStorage.setItem(historyKey, JSON.stringify([entry]));
      this.memoryFallback.delete(historyKey);
      return true;
    } catch {
      return false;
    }
  }

  static isDateKey(value) {
    return typeof value === 'string' && DATE_KEY_PATTERN.test(value) && Number.isFinite(StorageManager.parseUtcDateKeyMs(value));
  }

  /** Keeps only the known "new" / "seen" states of a parsed mode_unlocks value. */
  static sanitizeModeUnlocks(parsed, cfg) {
    const clean = {};
    if (!StorageManager.isPlainObject(parsed)) {
      return clean;
    }
    for (const [mode, state] of Object.entries(parsed)) {
      if (mode !== '__proto__' && (state === getNewState(cfg) || state === getSeenState(cfg))) {
        clean[mode] = state;
      }
    }
    return clean;
  }

  /** @returns {Object<string, string>} Stored mode -> "new" | "seen" states. */
  getModeUnlocks() {
    const key = this.storageConfig.keys.modeUnlocks;
    return key ? StorageManager.sanitizeModeUnlocks(this.readJsonObject(key), this.modeUnlocksConfig) : {};
  }

  /** @returns {number} Highest cleared campaign level, from the unlocked level and the level stats. */
  getClearedCampaignLevel() {
    let cleared = this.getUnlockedLevel() - 1;
    for (const [levelId, entry] of Object.entries(this.getLevelStats())) {
      const level = Number.parseInt(levelId, 10);
      if (entry.stars > 0 && Number.isFinite(level)) {
        cleared = Math.max(cleared, level);
      }
    }
    return Math.max(0, cleared);
  }

  /**
   * @returns {Object<string, {unlocked: boolean, isNew: boolean, requiredLevel: number}>}
   *   Access of every mode: stored entries plus the live campaign rule.
   */
  getModeAccess() {
    const access = resolveModeAccess(this.getModeUnlocks(), this.getClearedCampaignLevel(), this.modeUnlocksConfig);
    // A mode with a record of its own was played, so it is open (a profile rolled back to an
    // older version and updated again has records but no stored unlock).
    for (const [mode, keyNames] of Object.entries(this.modeUnlocksConfig?.recordKeys || {})) {
      if (access[mode] && !access[mode].unlocked && this.hasModeRecord(keyNames)) {
        access[mode] = { ...access[mode], unlocked: true };
      }
    }
    return access;
  }

  /** @returns {boolean} True when one of the stored record keys holds a positive number. */
  hasModeRecord(keyNames) {
    const keys = this.storageConfig.keys;
    return (Array.isArray(keyNames) ? keyNames : []).some((name) => {
      const suffix = keys[name];
      return typeof suffix === 'string' && Number.parseInt(this.safeGetItem(suffix), 10) > 0;
    });
  }

  /**
   * Stores "new" for the modes the campaign progress just earned.
   * @returns {string[]} Newly earned mode ids in configured order (each is returned once).
   */
  syncEarnedModeUnlocks() {
    const stored = this.getModeUnlocks();
    const earned = computeNewlyEarned(stored, this.getClearedCampaignLevel(), this.modeUnlocksConfig);
    if (earned.length > 0) {
      const next = { ...stored };
      for (const mode of earned) {
        next[mode] = getNewState(this.modeUnlocksConfig);
      }
      this.safeSetItem(this.storageConfig.keys.modeUnlocks, JSON.stringify(next));
    }
    return earned;
  }

  /**
   * Marks a gated mode as unlocked for good and played ("seen"). Writes only on a change.
   * @param {string} mode - Mode id.
   */
  ensureModeUnlocked(mode) {
    const cfg = this.modeUnlocksConfig || {};
    if (!Object.hasOwn(cfg.campaignLevelCleared || {}, mode)) {
      return;
    }
    const stored = this.getModeUnlocks();
    if (stored[mode] === getSeenState(cfg)) {
      return;
    }
    this.safeSetItem(this.storageConfig.keys.modeUnlocks, JSON.stringify({ ...stored, [mode]: getSeenState(cfg) }));
  }

  static sanitizeDailyHistoryEntry(raw, timelineConfig) {
    if (!StorageManager.isPlainObject(raw) || !StorageManager.isDateKey(raw.d)) {
      return null;
    }
    const toCount = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
    const entry = {
      d: raw.d,
      s: toCount(raw.s) ?? 0,
      w: toCount(raw.w),
      m: typeof raw.m === 'string' && raw.m.length > 0 ? raw.m : null,
      k: toCount(raw.k),
      g: raw.g === true
    };
    const timeline = normalizeShotTimeline(raw.tl, timelineConfig);
    if (timeline) {
      entry.tl = timeline;
    }
    return entry;
  }

  /** @returns {Array<{d: string, s: number, w: number|null, m: string|null, k: number|null, g: boolean, tl?: object}>} Newest first. */
  getDailyHistory() {
    const key = this.storageConfig.keys.dailyHistory;
    const raw = key ? this.safeGetItem(key) : null;
    if (!raw) {
      return [];
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => StorageManager.sanitizeDailyHistoryEntry(entry, this.shotTimelineConfig))
      .filter(Boolean)
      .sort(StorageManager.compareNewestFirst);
  }

  static compareNewestFirst(first, second) {
    return second.d.localeCompare(first.d);
  }

  /**
   * Records a Daily result for a date. A date keeps its best score (with the wave, mutator and
   * timeline of that run); the streak and grace fields are refreshed from the streak state.
   * @param {{dateKey: string, score: number, wave?: number|null, mutatorKey?: string|null, tl?: object|null}} result
   */
  recordDailyResult({ dateKey, score, wave = null, mutatorKey = null, tl = null }) {
    const key = this.storageConfig.keys.dailyHistory;
    if (!key || !StorageManager.isDateKey(dateKey)) {
      return;
    }
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    const history = this.getDailyHistory();
    const index = history.findIndex((entry) => entry.d === dateKey);
    const streak = this.getDailyStreak(dateKey);
    const isGrace = this.getDailyStreakGrace(dateKey).usedOn === dateKey;
    const refreshed = { k: streak > 0 ? streak : null, g: isGrace };
    const entry = StorageManager.sanitizeDailyHistoryEntry({
      d: dateKey,
      s: cleanScore,
      w: Number.isFinite(wave) ? Math.floor(wave) : null,
      m: mutatorKey,
      ...refreshed,
      tl
    }, this.shotTimelineConfig);
    if (index >= 0 && cleanScore <= history[index].s) {
      history[index] = { ...history[index], ...refreshed };
      // At an equal score, a complete timeline replaces a partial one.
      if (cleanScore === history[index].s && entry.tl?.c === COMPLETE_TIMELINE_FLAG && history[index].tl?.c !== COMPLETE_TIMELINE_FLAG) {
        history[index].tl = entry.tl;
      }
    } else {
      if (index >= 0) {
        history[index] = entry;
      } else {
        history.push(entry);
      }
    }
    history.sort(StorageManager.compareNewestFirst);
    const maxEntries = this.dailyHistoryConfig?.maxEntries > 0 ? this.dailyHistoryConfig.maxEntries : history.length;
    const timelineEntries = this.dailyHistoryConfig?.timelineEntries ?? history.length;
    const trimmed = history.slice(0, maxEntries).map((entry, position) => {
      if (position < timelineEntries || !entry.tl) {
        return entry;
      }
      const withoutTimeline = { ...entry };
      delete withoutTimeline.tl;
      return withoutTimeline;
    });
    this.safeSetItem(key, JSON.stringify(trimmed));
  }

  /**
   * @param {string} weekKey - Week key such as "2026-W45".
   * @returns {{week: string, seed: string, score: number, stage: number, tl?: object}|null}
   *   The best Weekly Flux run of that week, or null.
   */
  getWeeklyFluxBest(weekKey) {
    const key = this.storageConfig.keys.weeklyFluxBest;
    const raw = key ? this.readJsonObject(key) : {};
    if (typeof weekKey !== 'string' || raw.week !== weekKey) {
      return null;
    }
    const best = {
      week: raw.week,
      seed: typeof raw.seed === 'string' ? raw.seed : '',
      score: Number.isSafeInteger(raw.score) && raw.score >= 0 ? raw.score : 0,
      stage: Number.isSafeInteger(raw.stage) && raw.stage >= 0 ? raw.stage : 0
    };
    const timeline = normalizeShotTimeline(raw.tl, this.shotTimelineConfig);
    if (timeline) {
      best.tl = timeline;
    }
    return best;
  }

  /**
   * Keeps the best Weekly Flux score and stage of the week (single slot, replaced when the week
   * changes). The timeline follows the score. A write for a week older than the stored one
   * (a stale tab, a restored run of last week) is ignored: week keys are zero padded, so they
   * compare correctly as strings.
   * @returns {{week: string, seed: string, score: number, stage: number, tl?: object}} The stored best.
   */
  setWeeklyFluxBest(weekKey, seed, score, stage, tl = null) {
    const key = this.storageConfig.keys.weeklyFluxBest;
    const storedWeek = key ? this.readJsonObject(key).week : null;
    if (typeof storedWeek === 'string' && typeof weekKey === 'string' && weekKey < storedWeek) {
      return this.getWeeklyFluxBest(storedWeek);
    }
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    const cleanStage = Math.max(0, Math.floor(Number(stage) || 0));
    const timeline = normalizeShotTimeline(tl, this.shotTimelineConfig);
    const current = this.getWeeklyFluxBest(weekKey);
    const next = { week: weekKey, seed, score: cleanScore, stage: cleanStage };
    if (timeline) {
      next.tl = timeline;
    }
    if (current) {
      next.stage = Math.max(current.stage, cleanStage);
      if (cleanScore <= current.score) {
        next.score = current.score;
        delete next.tl;
        if (current.tl) {
          next.tl = current.tl;
        }
        // At an equal score, a complete timeline replaces a partial one.
        const incoming = normalizeShotTimeline(timeline, this.shotTimelineConfig);
        if (cleanScore === current.score && incoming?.c === COMPLETE_TIMELINE_FLAG && current.tl?.c !== COMPLETE_TIMELINE_FLAG) {
          next.tl = incoming;
        }
      }
    }
    if (key) {
      this.safeSetItem(key, JSON.stringify(next));
    }
    return next;
  }

  /**
   * Pays the once-per-week Weekly Flux bonus.
   * @returns {boolean} True when the bonus was paid now; false when already claimed this week.
   */
  claimWeeklyFluxBonus(weekKey, coins) {
    const key = this.storageConfig.keys.weeklyFluxClaimedWeek;
    if (!key || typeof weekKey !== 'string' || weekKey.length === 0 || this.safeGetItem(key) === weekKey) {
      return false;
    }
    this.safeSetItem(key, weekKey);
    const bonus = Math.max(0, Math.floor(Number(coins) || 0));
    if (bonus > 0) {
      this.addCoins(bonus);
    }
    return true;
  }

  /**
   * @param {string} weekKey - Week key such as "2026-W45".
   * @returns {boolean} True when the Weekly Flux bonus of that week was already paid.
   */
  hasClaimedWeeklyFluxBonus(weekKey) {
    const key = this.storageConfig.keys.weeklyFluxClaimedWeek;
    return Boolean(key) && typeof weekKey === 'string' && weekKey.length > 0 && this.safeGetItem(key) === weekKey;
  }

  /** @returns {object} The local statistics (a clean empty object when none are stored). */
  getPlayerStats() {
    const key = this.storageConfig.keys.playerStats;
    return normalizePlayerStats(key ? this.readJsonObject(key) : {}, 0);
  }

  /**
   * Adds an additive delta to the stored statistics (see src/game/PlayerStats.js).
   * @param {object} delta - Additive delta.
   * @param {number} [nowMs] - Time used as `since` the first time stats are written.
   * @returns {object} The stored statistics.
   */
  applyPlayerStatsDelta(delta, nowMs = Date.now()) {
    const key = this.storageConfig.keys.playerStats;
    const current = this.getPlayerStats();
    if (current.since === 0) {
      current.since = Math.max(0, Math.floor(nowMs));
    }
    const next = applyPlayerStatsDelta(current, delta, this.playerStatsConfig);
    if (key) {
      this.safeSetItem(key, JSON.stringify(next));
    }
    return next;
  }

  getRunSnapshotVersion() {
    return this.storageConfig.runSnapshotVersion;
  }

  /** Returns the saved run as a plain object, or null when none is stored or it is unreadable. */
  loadRunSnapshot() {
    const parsed = this.readJsonObject(this.storageConfig.keys.runSnapshot);
    return Object.keys(parsed).length > 0 ? parsed : null;
  }

  saveRunSnapshot(snapshot) {
    this.safeSetItem(this.storageConfig.keys.runSnapshot, JSON.stringify(snapshot));
  }

  clearRunSnapshot() {
    const fullKey = this.buildKey(this.storageConfig.keys.runSnapshot);
    this.memoryFallback.delete(fullKey);
    try {
      localStorage.removeItem(fullKey);
    } catch {
      // localStorage is restricted; the in-memory copy is already gone
    }
  }
}
