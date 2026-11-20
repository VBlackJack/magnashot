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

import { SeededRandom } from './SeededRandom.js';

const BOUNTY_SEED_SUFFIX = ':bounties';
const WEEKLY_MASTERY_SEED_SUFFIX = ':weeklyMastery';
const DEFAULT_WEEKLY_COUNT = 3;
const DEFAULT_WEEKLY_TARGET_MULT = 3;
const DEFAULT_WEEKLY_COIN_MULT = 2;

function normalizeCatalogEntry(entry) {
  return {
    id: String(entry.id),
    eventKey: String(entry.eventKey),
    target: Math.max(1, Math.floor(Number(entry.target) || 1)),
    coins: Math.max(0, Math.floor(Number(entry.coins) || 0)),
    mode: typeof entry.mode === 'string' && entry.mode ? entry.mode : null
  };
}

function toUnlockedModeSet(unlockedModes) {
  if (unlockedModes instanceof Set) return unlockedModes;
  if (Array.isArray(unlockedModes)) return new Set(unlockedModes);
  return null;
}

function shuffleWithSeed(list, seedString) {
  const pool = list.slice();
  const rng = new SeededRandom(SeededRandom.hashString(seedString));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function pickDistinctEvents(pool, count) {
  const picked = [];
  const seenEvents = new Set();
  for (const item of pool) {
    if (seenEvents.has(item.eventKey)) continue;
    seenEvents.add(item.eventKey);
    picked.push(item);
    if (picked.length >= count) break;
  }
  return picked;
}

function buildCatalogMap(catalog, targetMult = 1, coinMult = 1) {
  const map = new Map();
  for (const rawEntry of catalog) {
    if (rawEntry && typeof rawEntry.id === 'string' && rawEntry.id) {
      const spec = normalizeCatalogEntry(rawEntry);
      map.set(spec.id, {
        ...spec,
        target: Math.max(1, spec.target * targetMult),
        coins: Math.max(0, spec.coins * coinMult)
      });
    }
  }
  return map;
}

function hydrateSingleSavedItem(saved, catalogById, unlockedSet, seenIds, seenEvents) {
  if (!saved || typeof saved.id !== 'string') return null;
  const spec = catalogById.get(saved.id);
  if (!spec || seenIds.has(spec.id) || seenEvents.has(spec.eventKey)) return null;
  const rawProgress = Number.isFinite(Number(saved.progress)) ? Math.floor(Number(saved.progress)) : 0;
  const progress = Math.max(0, Math.min(spec.target, rawProgress));
  const completed = Boolean(saved.completed) || progress >= spec.target;
  if (spec.mode !== null && unlockedSet && !unlockedSet.has(spec.mode) && !completed && progress === 0) return null;
  return { ...spec, progress: completed ? spec.target : progress, completed };
}

function hydrateSavedItems(rawItems, catalogById, unlockedSet, count) {
  const items = [];
  const seenIds = new Set();
  const seenEvents = new Set();
  for (const saved of rawItems) {
    const hydrated = hydrateSingleSavedItem(saved, catalogById, unlockedSet, seenIds, seenEvents);
    if (!hydrated) continue;
    seenIds.add(hydrated.id);
    seenEvents.add(hydrated.eventKey);
    items.push(hydrated);
    if (items.length >= count) break;
  }
  return { items, seenIds, seenEvents };
}

function fillRemainingItems(items, seenIds, seenEvents, rolled, count) {
  for (const spec of rolled) {
    if (seenIds.has(spec.id) || seenEvents.has(spec.eventKey)) continue;
    seenIds.add(spec.id);
    seenEvents.add(spec.eventKey);
    items.push({ ...spec, progress: 0, completed: false });
    if (items.length >= count) break;
  }
}

/**
 * Picks the deterministic list of daily bounties for the given UTC date key.
 */
export function pickDailyBounties(bountiesConfig, dateKey = SeededRandom.getTodayDateKey(), options = {}) {
  const catalog = Array.isArray(bountiesConfig?.catalog) ? bountiesConfig.catalog : [];
  const count = Math.max(0, Math.min(catalog.length, Math.floor(Number(bountiesConfig?.dailyCount) || 0)));
  if (count === 0) return [];
  const normalizedCatalog = catalog.map(normalizeCatalogEntry);
  const unlockedSet = toUnlockedModeSet(options?.unlockedModes);
  const eligible = unlockedSet
    ? normalizedCatalog.filter((entry) => entry.mode === null || unlockedSet.has(entry.mode))
    : normalizedCatalog;
  const pool = shuffleWithSeed(eligible.length > 0 ? eligible : normalizedCatalog, `${dateKey}${BOUNTY_SEED_SUFFIX}`);
  return pickDistinctEvents(pool, count);
}

/**
 * Picks the deterministic Weekly Mastery Trio (3 scaled objectives across distinct modes).
 */
export function pickWeeklyMasteryTrio(bountiesConfig, weekKey, options = {}) {
  const catalog = Array.isArray(bountiesConfig?.catalog) ? bountiesConfig.catalog : [];
  const count = Math.max(0, Math.min(catalog.length, Math.floor(Number(bountiesConfig?.weeklyCount ?? DEFAULT_WEEKLY_COUNT))));
  if (count === 0 || !weekKey) return [];
  const targetMult = Math.max(1, Math.floor(Number(bountiesConfig?.weeklyTargetMultiplier ?? DEFAULT_WEEKLY_TARGET_MULT)));
  const coinMult = Math.max(1, Math.floor(Number(bountiesConfig?.weeklyCoinMultiplier ?? DEFAULT_WEEKLY_COIN_MULT)));
  const scaled = catalog.map((e) => {
    const n = normalizeCatalogEntry(e);
    return { ...n, target: n.target * targetMult, coins: n.coins * coinMult };
  });
  const unlockedSet = toUnlockedModeSet(options?.unlockedModes);
  const eligible = unlockedSet
    ? scaled.filter((entry) => entry.mode === null || unlockedSet.has(entry.mode))
    : scaled;
  const pool = shuffleWithSeed(eligible.length > 0 ? eligible : scaled, `${weekKey}${WEEKLY_MASTERY_SEED_SUFFIX}`);
  return pickDistinctEvents(pool, count);
}

/**
 * Normalizes a persisted daily bounties state object for `dateKey`, resetting on roll-over.
 */
export function normalizeBountiesState(
  rawState,
  bountiesConfig,
  dateKey = SeededRandom.getTodayDateKey(),
  options = {}
) {
  const catalog = Array.isArray(bountiesConfig?.catalog) ? bountiesConfig.catalog : [];
  const count = Math.max(0, Math.min(catalog.length, Math.floor(Number(bountiesConfig?.dailyCount) || 0)));
  if (count === 0) return { dateKey, items: [] };
  const catalogById = buildCatalogMap(catalog);
  const unlockedSet = toUnlockedModeSet(options?.unlockedModes);
  const rawItems = rawState && rawState.dateKey === dateKey && Array.isArray(rawState.items) ? rawState.items : [];
  const { items, seenIds, seenEvents } = hydrateSavedItems(rawItems, catalogById, unlockedSet, count);
  if (items.length < count) {
    fillRemainingItems(items, seenIds, seenEvents, pickDailyBounties(bountiesConfig, dateKey, options), count);
  }
  return { dateKey, items };
}

function resolveWeeklyScaling(bountiesConfig) {
  const catalog = Array.isArray(bountiesConfig?.catalog) ? bountiesConfig.catalog : [];
  const count = Math.max(0, Math.min(catalog.length, Math.floor(Number(bountiesConfig?.weeklyCount ?? DEFAULT_WEEKLY_COUNT))));
  const targetMult = Math.max(1, Math.floor(Number(bountiesConfig?.weeklyTargetMultiplier ?? DEFAULT_WEEKLY_TARGET_MULT)));
  const coinMult = Math.max(1, Math.floor(Number(bountiesConfig?.weeklyCoinMultiplier ?? DEFAULT_WEEKLY_COIN_MULT)));
  return { catalog, count, targetMult, coinMult };
}

/**
 * Normalizes a persisted Weekly Mastery Trio state object for `weekKey`, resetting on new ISO week.
 */
export function normalizeWeeklyMasteryState(rawState, bountiesConfig, weekKey, options = {}) {
  const { catalog, count, targetMult, coinMult } = resolveWeeklyScaling(bountiesConfig);
  if (count === 0 || !weekKey) return { weekKey: weekKey || '', items: [], chestClaimed: false };
  const catalogById = buildCatalogMap(catalog, targetMult, coinMult);
  const unlockedSet = toUnlockedModeSet(options?.unlockedModes);
  const isSameWeek = Boolean(rawState && rawState.weekKey === weekKey);
  const rawItems = isSameWeek && Array.isArray(rawState.items) ? rawState.items : [];
  const { items, seenIds, seenEvents } = hydrateSavedItems(rawItems, catalogById, unlockedSet, count);
  if (items.length < count) {
    fillRemainingItems(items, seenIds, seenEvents, pickWeeklyMasteryTrio(bountiesConfig, weekKey, options), count);
  }
  return { weekKey, items, chestClaimed: Boolean(isSameWeek && rawState.chestClaimed) };
}

/**
 * Pure state transition applying an incremental progress delta for `eventKey`.
 */
export function advanceBountiesState(state, eventKey, amount = 1) {
  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  if (!state || !Array.isArray(state.items) || !eventKey || delta <= 0) {
    return { nextState: state, completed: [], changed: false };
  }
  let changed = false;
  const completed = [];
  const nextItems = state.items.map((item) => {
    if (item.completed || item.eventKey !== eventKey) return item;
    changed = true;
    const nextProgress = Math.min(item.target, item.progress + delta);
    const justCompleted = nextProgress >= item.target;
    const updated = { ...item, progress: nextProgress, completed: justCompleted };
    if (justCompleted) completed.push(updated);
    return updated;
  });
  return {
    nextState: changed ? { ...state, items: nextItems } : state,
    completed,
    changed
  };
}
