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

const MS_PER_UTC_DAY = 86_400_000;

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
    this.maxCampaignLevel = countCampaignLevels(levelsConfig, campaignConfig);
    this.upgradesCache = null;
    this.bindCrossTabSync();
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
    let parsed = null;
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

  static isPreviousUtcDay(previousDateKey, currentDateKey) {
    const prevMs = StorageManager.parseUtcDateKeyMs(previousDateKey);
    const currMs = StorageManager.parseUtcDateKeyMs(currentDateKey);
    if (!Number.isFinite(prevMs) || !Number.isFinite(currMs)) {
      return false;
    }
    return currMs - prevMs === MS_PER_UTC_DAY;
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
    if (
      storedDate === referenceDateKey
      || StorageManager.isPreviousUtcDay(storedDate, referenceDateKey)
    ) {
      return storedStreak;
    }
    return 0;
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
    const nextStreak = prevDate && StorageManager.isPreviousUtcDay(prevDate, dateKey)
      ? Math.max(1, prevStreak) + 1
      : 1;

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
    const raw = this.safeGetItem(this.storageConfig.keys.unlockedLevel);
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return this.defaultsConfig.initialUnlockedLevel;
    }
    return Math.min(parsed, this.maxCampaignLevel);
  }

  unlockLevel(levelId) {
    const clamped = Math.min(levelId, this.maxCampaignLevel);
    const current = this.getUnlockedLevel();
    if (clamped > current) {
      this.safeSetItem(this.storageConfig.keys.unlockedLevel, clamped);
    }
  }

  getLevelStats() {
    const parsed = this.readJsonObject(this.storageConfig.keys.levelStats);
    const stats = {};
    for (const [levelId, entry] of Object.entries(parsed)) {
      if (!StorageManager.isPlainObject(entry)) {
        continue;
      }
      stats[levelId] = {
        bestScore: StorageManager.toNonNegativeNumber(entry.bestScore),
        stars: StorageManager.toNonNegativeNumber(entry.stars)
      };
    }
    return stats;
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

  getEndlessHighScore() {
    const raw = this.safeGetItem(this.storageConfig.keys.endlessHighScore);
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
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
    this.safeSetItem(this.storageConfig.keys.coins, Math.max(0, Math.floor(amount)));
  }

  addCoins(delta) {
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
