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

import { MATH_CONSTANTS } from '../core/Constants.js';
import { formatNumber, t } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';

const BOUNTY_SEED_SUFFIX = ':bounties';

/**
 * Picks the deterministic list of daily bounties for the given UTC date key.
 * @param {object} bountiesConfig - Bounties configuration from game.json.
 * @param {string} [dateKey] - UTC date key (`YYYY-MM-DD`).
 * @returns {Array<{id: string, eventKey: string, target: number, coins: number, mode: string|null}>}
 */
export function pickDailyBounties(bountiesConfig, dateKey = SeededRandom.getTodayDateKey()) {
  const catalog = Array.isArray(bountiesConfig?.catalog) ? bountiesConfig.catalog : [];
  const count = Math.max(0, Math.min(catalog.length, Math.floor(Number(bountiesConfig?.dailyCount) || 0)));
  if (count === 0) {
    return [];
  }
  const pool = catalog.map((entry) => ({
    id: String(entry.id),
    eventKey: String(entry.eventKey),
    target: Math.max(1, Math.floor(Number(entry.target) || 1)),
    coins: Math.max(0, Math.floor(Number(entry.coins) || 0)),
    mode: typeof entry.mode === 'string' && entry.mode ? entry.mode : null
  }));
  const rng = new SeededRandom(SeededRandom.hashString(`${dateKey}${BOUNTY_SEED_SUFFIX}`));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = [];
  const seenEvents = new Set();
  for (const item of pool) {
    if (seenEvents.has(item.eventKey)) {
      continue;
    }
    seenEvents.add(item.eventKey);
    picked.push(item);
    if (picked.length >= count) {
      break;
    }
  }
  return picked;
}

/**
 * Normalizes a persisted daily bounties state object for `dateKey`, resetting on roll-over.
 * @param {object|null} rawState - Parsed JSON object from storage.
 * @param {object} bountiesConfig - Bounties configuration from game.json.
 * @param {string} [dateKey] - UTC date key (`YYYY-MM-DD`).
 * @returns {{dateKey: string, items: Array<{id: string, eventKey: string, target: number, coins: number, mode: string|null, progress: number, completed: boolean}>}}
 */
export function normalizeBountiesState(rawState, bountiesConfig, dateKey = SeededRandom.getTodayDateKey()) {
  const picked = pickDailyBounties(bountiesConfig, dateKey);
  const storedById = new Map();
  if (rawState && rawState.dateKey === dateKey && Array.isArray(rawState.items)) {
    for (const entry of rawState.items) {
      if (entry && typeof entry.id === 'string') {
        storedById.set(entry.id, entry);
      }
    }
  }
  const items = picked.map((spec) => {
    const saved = storedById.get(spec.id);
    const rawProgress = Number.isFinite(Number(saved?.progress)) ? Math.floor(Number(saved.progress)) : 0;
    const progress = Math.max(0, Math.min(spec.target, rawProgress));
    const completed = Boolean(saved?.completed) || progress >= spec.target;
    return {
      ...spec,
      progress: completed ? spec.target : progress,
      completed
    };
  });
  return { dateKey, items };
}

/**
 * Pure state transition applying an incremental progress delta for `eventKey`.
 * @param {{dateKey: string, items: Array<object>}} state - Normalized bounties state.
 * @param {string} eventKey - Telemetry event identifier.
 * @param {number} [amount=1] - Positive delta to apply.
 * @returns {{nextState: {dateKey: string, items: Array<object>}, completed: Array<object>, changed: boolean}}
 */
export function advanceBountiesState(state, eventKey, amount = 1) {
  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  if (!state || !Array.isArray(state.items) || !eventKey || delta <= 0) {
    return { nextState: state, completed: [], changed: false };
  }
  let changed = false;
  const completed = [];
  const nextItems = state.items.map((item) => {
    if (item.completed || item.eventKey !== eventKey) {
      return item;
    }
    changed = true;
    const nextProgress = Math.min(item.target, item.progress + delta);
    const justCompleted = nextProgress >= item.target;
    const updated = {
      ...item,
      progress: nextProgress,
      completed: justCompleted
    };
    if (justCompleted) {
      completed.push(updated);
    }
    return updated;
  });
  return {
    nextState: changed ? { dateKey: state.dateKey, items: nextItems } : state,
    completed,
    changed
  };
}

/**
 * Reports an in-game bounty event from an active engine without polluting Versus or restores.
 * @param {object} engine - GameEngine instance.
 * @param {string} eventKey - Bounty event key.
 * @param {number} [amount=1] - Progress increment.
 * @returns {Array<object>} Newly completed bounties.
 */
export function reportBountyEvent(engine, eventKey, amount = 1) {
  if (!engine || engine.isVersusRole || engine.isRestoringRun || !eventKey) {
    return [];
  }
  const completed = engine.storageManager?.recordBountyProgress?.(eventKey, amount) || [];
  if (completed.length === 0) {
    return [];
  }
  const coinsTotal = completed.reduce((sum, item) => sum + (item.coins || 0), 0);
  const labelList = completed
    .map((item) => t(`modals.play.bounties.items.${item.id}.title`, { target: formatNumber(item.target) }))
    .join(t('gameplay.feedback.achievement.listSeparator'));
  engine.audioManager?.playEffect('achievement');
  const canvasCfg = engine.gameConfig?.canvas;
  if (canvasCfg && engine.particleSystem?.spawnFloatingText) {
    engine.particleSystem.spawnFloatingText(
      canvasCfg.logicalWidth * MATH_CONSTANTS.HALF,
      canvasCfg.launcherY + canvasCfg.anvilPopupOffsetY,
      t('gameplay.feedback.bounty.completed', { name: labelList, coins: formatNumber(coinsTotal) }),
      engine.gameConfig.theme?.coinPopupColor
    );
  }
  engine.notifyUI?.({ completedBounties: completed });
  return completed;
}
