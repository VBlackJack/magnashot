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
  }
};
