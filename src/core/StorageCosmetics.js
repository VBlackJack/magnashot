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

import { ARENA_THEMES, BALL_STYLES, LASER_TRAILS } from './Constants.js';
import { configRegistry } from './ConfigRegistry.js';
import { normalizeShotTimeline } from './ShotTimeline.js';
import { advanceBountiesState, normalizeWeeklyMasteryState } from './BountiesStore.js';

function getCurrentUtcWeekKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getUnlockedCosmeticMap(storage, defaultId, unlockedKey) {
  const key = storage.storageConfig?.keys?.[unlockedKey];
  const parsed = key ? storage.readJsonObject(key) : {};
  const unlocked = { [defaultId]: true };
  for (const [id, value] of Object.entries(parsed)) {
    if (value === true) {
      unlocked[id] = true;
    }
  }
  return unlocked;
}

function isCosmeticUnlocked(storage, id, defaultId, unlockedKey) {
  return typeof id === 'string' && id.length > 0 && getUnlockedCosmeticMap(storage, defaultId, unlockedKey)[id] === true;
}

function getActiveCosmetic(storage, defaultId, activeKey, unlockedKey) {
  const key = storage.storageConfig?.keys?.[activeKey];
  const stored = key ? storage.safeGetItem(key) : null;
  return stored && isCosmeticUnlocked(storage, stored, defaultId, unlockedKey) ? stored : defaultId;
}

function setActiveCosmetic(storage, id, defaultId, activeKey, unlockedKey) {
  if (!isCosmeticUnlocked(storage, id, defaultId, unlockedKey)) {
    return false;
  }
  const key = storage.storageConfig?.keys?.[activeKey];
  if (key) {
    storage.safeSetItem(key, id);
  }
  return true;
}

function purchaseCosmetic(storage, id, cost, { catalog, defaultId, activeKey, unlockedKey }) {
  const spec = catalog?.[id];
  if (!spec) {
    return false;
  }
  if (isCosmeticUnlocked(storage, id, defaultId, unlockedKey)) {
    setActiveCosmetic(storage, id, defaultId, activeKey, unlockedKey);
    return false;
  }
  const cleanCost = Math.max(0, Math.floor(Number(cost ?? spec.cost) || 0));
  const coins = storage.getCoins();
  if (coins < cleanCost) {
    return false;
  }
  storage.setCoins(coins - cleanCost);
  const unlocked = getUnlockedCosmeticMap(storage, defaultId, unlockedKey);
  unlocked[id] = true;
  const key = storage.storageConfig?.keys?.[unlockedKey];
  if (key) {
    storage.safeSetItem(key, JSON.stringify(unlocked));
  }
  setActiveCosmetic(storage, id, defaultId, activeKey, unlockedKey);
  return true;
}

/** Cosmetic and daily-puzzle storage methods installed on StorageManager.prototype. */
export const storageCosmeticsMethods = {
  getUnlockedBallStyles() {
    return getUnlockedCosmeticMap(this, this.defaultsConfig?.ballStyle || BALL_STYLES.CLASSIC, 'unlockedBallStyles');
  },
  isBallStyleUnlocked(styleId) {
    return isCosmeticUnlocked(this, styleId, this.defaultsConfig?.ballStyle || BALL_STYLES.CLASSIC, 'unlockedBallStyles');
  },
  getActiveBallStyle() {
    return getActiveCosmetic(this, this.defaultsConfig?.ballStyle || BALL_STYLES.CLASSIC, 'activeBallStyle', 'unlockedBallStyles');
  },
  setActiveBallStyle(styleId) {
    return setActiveCosmetic(this, styleId, this.defaultsConfig?.ballStyle || BALL_STYLES.CLASSIC, 'activeBallStyle', 'unlockedBallStyles');
  },
  purchaseBallStyle(styleId, cost) {
    return purchaseCosmetic(this, styleId, cost, {
      catalog: configRegistry.get('balls')?.styles,
      defaultId: this.defaultsConfig?.ballStyle || BALL_STYLES.CLASSIC,
      activeKey: 'activeBallStyle',
      unlockedKey: 'unlockedBallStyles'
    });
  },

  getUnlockedArenaThemes() {
    return getUnlockedCosmeticMap(this, this.defaultsConfig?.arenaTheme || ARENA_THEMES.DEEP_SPACE, 'unlockedArenaThemes');
  },
  isArenaThemeUnlocked(themeId) {
    return isCosmeticUnlocked(this, themeId, this.defaultsConfig?.arenaTheme || ARENA_THEMES.DEEP_SPACE, 'unlockedArenaThemes');
  },
  getActiveArenaTheme() {
    return getActiveCosmetic(this, this.defaultsConfig?.arenaTheme || ARENA_THEMES.DEEP_SPACE, 'activeArenaTheme', 'unlockedArenaThemes');
  },
  setActiveArenaTheme(themeId) {
    return setActiveCosmetic(this, themeId, this.defaultsConfig?.arenaTheme || ARENA_THEMES.DEEP_SPACE, 'activeArenaTheme', 'unlockedArenaThemes');
  },
  purchaseArenaTheme(themeId, cost) {
    return purchaseCosmetic(this, themeId, cost, {
      catalog: configRegistry.get('game')?.arenaThemes,
      defaultId: this.defaultsConfig?.arenaTheme || ARENA_THEMES.DEEP_SPACE,
      activeKey: 'activeArenaTheme',
      unlockedKey: 'unlockedArenaThemes'
    });
  },

  getUnlockedLaserTrails() {
    return getUnlockedCosmeticMap(this, this.defaultsConfig?.laserTrail || LASER_TRAILS.CLASSIC, 'unlockedLaserTrails');
  },
  isLaserTrailUnlocked(trailId) {
    return isCosmeticUnlocked(this, trailId, this.defaultsConfig?.laserTrail || LASER_TRAILS.CLASSIC, 'unlockedLaserTrails');
  },
  getActiveLaserTrail() {
    return getActiveCosmetic(this, this.defaultsConfig?.laserTrail || LASER_TRAILS.CLASSIC, 'activeLaserTrail', 'unlockedLaserTrails');
  },
  setActiveLaserTrail(trailId) {
    return setActiveCosmetic(this, trailId, this.defaultsConfig?.laserTrail || LASER_TRAILS.CLASSIC, 'activeLaserTrail', 'unlockedLaserTrails');
  },
  purchaseLaserTrail(trailId, cost) {
    return purchaseCosmetic(this, trailId, cost, {
      catalog: configRegistry.get('game')?.laserTrails,
      defaultId: this.defaultsConfig?.laserTrail || LASER_TRAILS.CLASSIC,
      activeKey: 'activeLaserTrail',
      unlockedKey: 'unlockedLaserTrails'
    });
  },

  hasClaimedDailyPuzzle(dateKey) {
    const key = this.storageConfig?.keys?.dailyPuzzleClaimedDate;
    return Boolean(key && typeof dateKey === 'string' && this.safeGetItem(key) === dateKey);
  },
  claimDailyPuzzleBonus(dateKey, bonusCoins) {
    const key = this.storageConfig?.keys?.dailyPuzzleClaimedDate;
    if (!key || typeof dateKey !== 'string' || this.hasClaimedDailyPuzzle(dateKey)) {
      return false;
    }
    this.safeSetItem(key, dateKey);
    const amount = Math.max(0, Math.floor(Number(bonusCoins) || 0));
    if (amount > 0) {
      this.addCoins(amount);
    }
    return true;
  },

  getPbTimeline(mode) {
    const key = this.storageConfig?.keys?.pbTimelines;
    const all = key ? this.readJsonObject(key) : {};
    const entry = typeof mode === 'string' ? all[mode] : null;
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const tl = normalizeShotTimeline(entry.tl, this.shotTimelineConfig);
    return tl ? { score: Math.max(0, Math.floor(Number(entry.score) || 0)), tl } : null;
  },

  setPbTimeline(mode, score, timeline) {
    const key = this.storageConfig?.keys?.pbTimelines;
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));
    const normalized = normalizeShotTimeline(timeline, this.shotTimelineConfig);
    if (!key || typeof mode !== 'string' || !normalized || cleanScore <= 0) {
      return false;
    }
    const current = this.getPbTimeline(mode);
    if (current && cleanScore < current.score) {
      return false;
    }
    const all = this.readJsonObject(key);
    all[mode] = { score: cleanScore, tl: normalized };
    this.safeSetItem(key, JSON.stringify(all));
    return true;
  },

  getUnlockedCosmeticCount() {
    const styles = Object.keys(this.getUnlockedBallStyles()).length;
    const themes = Object.keys(this.getUnlockedArenaThemes()).length;
    const trails = Object.keys(this.getUnlockedLaserTrails()).length;
    return styles + themes + trails;
  },

  getDailyPuzzlesCleared() {
    const key = this.storageConfig?.keys?.dailyPuzzlesCleared;
    if (!key) return 0;
    const parsed = Number(this.safeGetItem(key));
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  },

  incrementDailyPuzzlesCleared() {
    const key = this.storageConfig?.keys?.dailyPuzzlesCleared;
    if (!key) return 0;
    const next = this.getDailyPuzzlesCleared() + 1;
    this.safeSetItem(key, String(next));
    return next;
  },

  getWeeklyMasteryState(weekKey = getCurrentUtcWeekKey()) {
    const bountiesCfg = configRegistry.get('game')?.bounties;
    const key = this.storageConfig?.keys?.weeklyMastery;
    const raw = key ? this.readJsonObject(key) : null;
    const unlockedModes = this.getUnlockedModes?.() ?? null;
    return normalizeWeeklyMasteryState(raw, bountiesCfg, weekKey, { unlockedModes });
  },

  recordWeeklyMasteryProgress(eventKey, amount = 1, weekKey = getCurrentUtcWeekKey()) {
    const key = this.storageConfig?.keys?.weeklyMastery;
    const bountiesCfg = configRegistry.get('game')?.bounties;
    if (!key || !bountiesCfg) return { completed: [], chestAwarded: 0 };
    const state = this.getWeeklyMasteryState(weekKey);
    const { nextState, completed, changed } = advanceBountiesState(state, eventKey, amount);
    if (!changed) return { completed: [], chestAwarded: 0 };
    let chestAwarded = 0;
    const allDone = nextState.items.length > 0 && nextState.items.every((item) => item.completed);
    const finalState = { ...nextState };
    if (allDone && !finalState.chestClaimed) {
      finalState.chestClaimed = true;
      chestAwarded = Math.max(0, Math.floor(Number(bountiesCfg.weeklyChestBonusCoins) || 0));
    }
    this.safeSetItem(key, JSON.stringify(finalState));
    const coinsTotal = completed.reduce((sum, item) => sum + (item.coins || 0), 0) + chestAwarded;
    if (coinsTotal > 0) this.addCoins(coinsTotal);
    return { completed, chestAwarded };
  },

  getSavedPuzzles() {
    const key = this.storageConfig?.keys?.savedPuzzles;
    if (!key) return [];
    const raw = this.safeGetItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.code === 'string' && e.code.length > 0) : [];
    } catch {
      return [];
    }
  },

  saveCustomPuzzle(entry) {
    const key = this.storageConfig?.keys?.savedPuzzles;
    if (!key || !entry || typeof entry.code !== 'string' || entry.code.length === 0) {
      return false;
    }
    const maxSaved = configRegistry.get('game')?.puzzleBuilder?.maxSavedPuzzles || 10;
    const list = this.getSavedPuzzles().filter((item) => item.code !== entry.code);
    list.unshift({
      code: entry.code,
      balls: Math.max(1, Math.floor(Number(entry.balls) || 1)),
      shots: Math.max(1, Math.floor(Number(entry.shots) || 1)),
      verified: Boolean(entry.verified)
    });
    this.safeSetItem(key, JSON.stringify(list.slice(0, maxSaved)));
    return true;
  },

  deleteSavedPuzzle(code) {
    const key = this.storageConfig?.keys?.savedPuzzles;
    if (!key || typeof code !== 'string') return false;
    const current = this.getSavedPuzzles();
    const next = current.filter((item) => item.code !== code);
    if (next.length === current.length) return false;
    this.safeSetItem(key, JSON.stringify(next));
    return true;
  },

  getRecentModes() {
    const key = this.storageConfig?.keys?.recentModes;
    if (!key) return [];
    const raw = this.safeGetItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((m) => typeof m === 'string' && m.length > 0).slice(0, 3) : [];
    } catch {
      return [];
    }
  },

  recordRecentMode(modeKey) {
    const key = this.storageConfig?.keys?.recentModes;
    if (!key || typeof modeKey !== 'string' || modeKey.length === 0) return;
    const list = this.getRecentModes().filter((m) => m !== modeKey);
    list.unshift(modeKey);
    this.safeSetItem(key, JSON.stringify(list.slice(0, 3)));
  }
};
