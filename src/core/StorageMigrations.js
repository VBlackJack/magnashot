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

import { getNewState, getSeenState } from '../game/ModeUnlocks.js';

/**
 * Ordered save schema migrations. Contract: every step is idempotent and never deletes
 * data, so a step can be retried after a failure and a rollback to an older build keeps
 * working. A step returns false when it could not complete (it is then retried next launch).
 */
export const SAVE_MIGRATIONS = Object.freeze([
  { toVersion: 1, run: (manager) => manager.migrateLegacyKeys() },
  { toVersion: 2, run: (manager) => manager.grandfatherModeUnlocks() },
  { toVersion: 3, run: (manager) => manager.seedDailyHistory() },
  { toVersion: 4, run: (manager) => manager.announceIntroducedModes() },
  { toVersion: 5, run: (manager) => manager.announceIntroducedModes() },
  { toVersion: 6, run: (manager) => manager.migrateMusicVolumeSteps() },
  { toVersion: 7, run: (manager) => manager.seedPuzzleStageStats() },
  { toVersion: 8, run: (manager) => manager.announceIntroducedModes() }
]);
export const CURRENT_SAVE_SCHEMA_VERSION = SAVE_MIGRATIONS.at(-1).toVersion;

// Absorbs float rounding when two music volume steps are equally close to a stored value.
const VOLUME_TIE_EPSILON = 1e-9;

/**
 * Save schema migration methods installed onto `StorageManager.prototype`.
 * Static helpers are resolved via `this.constructor` to keep imports unidirectional.
 */
export const storageMigrationMethods = {
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
  },

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
          const merged = this.constructor.mergeLevelStats(
            this.constructor.parseLevelStats(current),
            this.constructor.parseLevelStats(value)
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
  },

  /**
   * Migration v2 (existing-player grandfathering). Players who have any stored progress
   * already had access to every historical mode before campaign-level gates rolled out; they
   * receive a "seen" entry for each gated mode that is not already recorded, and not flagged as
   * new (new modes added later arrive in the next version). Fresh players are untouched.
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
      const merged = this.constructor.sanitizeModeUnlocks(JSON.parse(localStorage.getItem(fullKey) || '{}'), cfg);
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
  },

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
      const merged = this.constructor.sanitizeModeUnlocks(JSON.parse(localStorage.getItem(fullKey) || '{}'), cfg);
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
  },

  /**
   * Migration v6. The music volume steps changed from [0, .25, .5, .75, 1] to [.2, .4, .6, .8, 1]
   * (a volume of 0 is now the music switch). A stored volume that is not a step snaps to the
   * nearest one (ties go up); a stored 0 turns the music off and restores the default volume.
   * Idempotent, and nothing is deleted. Unreadable values are left for the getter's fallback.
   * @returns {boolean} False when storage could not be read or written.
   */
  migrateMusicVolumeSteps() {
    const steps = this.defaultsConfig.musicVolumeSteps;
    if (!Array.isArray(steps) || steps.length === 0) {
      return true;
    }
    try {
      const volumeKey = this.buildKey(this.storageConfig.keys.musicVolume);
      const raw = localStorage.getItem(volumeKey);
      const stored = raw === null ? Number.NaN : Number.parseFloat(raw);
      if (!Number.isFinite(stored) || steps.includes(stored)) {
        return true;
      }
      let migrated;
      if (stored <= 0) {
        const enabledKey = this.buildKey(this.storageConfig.keys.musicEnabled);
        localStorage.setItem(enabledKey, 'false');
        this.memoryFallback.delete(enabledKey);
        migrated = this.defaultsConfig.musicVolume;
      } else {
        migrated = steps.reduce((best, step) => {
          const gap = Math.abs(step - stored);
          const bestGap = Math.abs(best - stored);
          const isCloser = gap < bestGap - VOLUME_TIE_EPSILON;
          const isTieUp = Math.abs(gap - bestGap) <= VOLUME_TIE_EPSILON && step > best;
          return isCloser || isTieUp ? step : best;
        }, steps[0]);
      }
      localStorage.setItem(volumeKey, String(migrated));
      this.memoryFallback.delete(volumeKey);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Migration v7. Puzzle stage records are new: every stage below the stored best stage was
   * cleared before the update, with a history nobody kept. Each such stage without an entry
   * gets one star (the minimum win), a score of 0 (unknown) and an attempt count past the
   * two-star limit so the unknown history can never read as a clean first try.
   * Idempotent, never overwrites an entry, nothing is deleted.
   * @returns {boolean} False when storage could not be read or written.
   */
  seedPuzzleStageStats() {
    const keys = this.storageConfig.keys;
    if (typeof keys.puzzleStageStats !== 'string' || typeof keys.puzzleBestStage !== 'string') {
      return true;
    }
    try {
      const rawBest = localStorage.getItem(this.buildKey(keys.puzzleBestStage));
      const bestStage = rawBest === null ? 0 : Number.parseInt(rawBest, 10);
      if (!Number.isInteger(bestStage) || bestStage < 2) {
        return true;
      }
      const statsKey = this.buildKey(keys.puzzleStageStats);
      const stats = this.constructor.parsePuzzleStageStats(localStorage.getItem(statsKey));
      const seededStars = this.scoringConfig.minVictoryStars ?? 1;
      // Fail closed: without the threshold, a seeded stage never reads as a fast clear.
      const seededAttempts = Number.isFinite(this.puzzleStarsConfig.twoStarMaxAttempts)
        ? this.puzzleStarsConfig.twoStarMaxAttempts + 1
        : Number.MAX_SAFE_INTEGER;
      let isChanged = false;
      for (let stage = 1; stage < bestStage; stage += 1) {
        if (!stats[String(stage)]) {
          stats[String(stage)] = { bestScore: 0, stars: seededStars, attempts: seededAttempts, cleared: true };
          isChanged = true;
        }
      }
      if (isChanged) {
        localStorage.setItem(statsKey, JSON.stringify(stats));
        this.memoryFallback.delete(statsKey);
      }
      return true;
    } catch {
      return false;
    }
  },

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
      if (!(score > 0) || !this.constructor.isDateKey(dateKey)) {
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
};
