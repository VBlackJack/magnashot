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
 * Pure rules for the progressive mode unlock. No storage access: the caller passes the
 * stored per-mode states and the highest cleared campaign level.
 */

const DEFAULT_STATE_NEW = 'new';
const DEFAULT_STATE_SEEN = 'seen';

/**
 * @param {object} cfg - The `modeUnlocks` section of configs/game.json.
 * @returns {string} Stored state of a mode that was earned and not played yet.
 */
export function getNewState(cfg) {
  return cfg?.stateNew || DEFAULT_STATE_NEW;
}

/**
 * @param {object} cfg - The `modeUnlocks` section of configs/game.json.
 * @returns {string} Stored state of a mode that was played at least once.
 */
export function getSeenState(cfg) {
  return cfg?.stateSeen || DEFAULT_STATE_SEEN;
}

function getRequiredLevel(mode, cfg) {
  const required = cfg?.campaignLevelCleared?.[mode];
  return Number.isFinite(required) && required > 0 ? required : 0;
}

function isAlwaysAvailable(mode, cfg) {
  return Array.isArray(cfg?.always) && cfg.always.includes(mode);
}

function getOrder(cfg) {
  return Array.isArray(cfg?.order) ? cfg.order : [];
}

/**
 * Resolves, for every mode of the configured order, whether it can be started.
 * A stored entry unlocks a mode for good; otherwise the campaign rule decides live.
 * @param {Object<string, string>} stored - Stored states: mode -> "new" | "seen".
 * @param {number} clearedLevel - Highest cleared campaign level (0 when none).
 * @param {object} cfg - The `modeUnlocks` section of configs/game.json.
 * @returns {Object<string, {unlocked: boolean, isNew: boolean, requiredLevel: number}>}
 */
export function resolveModeAccess(stored, clearedLevel, cfg) {
  const access = {};
  const cleared = Number.isFinite(clearedLevel) ? clearedLevel : 0;
  const states = stored && typeof stored === 'object' ? stored : {};
  for (const mode of getOrder(cfg)) {
    const requiredLevel = getRequiredLevel(mode, cfg);
    const state = Object.hasOwn(states, mode) ? states[mode] : null;
    if (isAlwaysAvailable(mode, cfg)) {
      access[mode] = { unlocked: true, isNew: false, requiredLevel: 0 };
    } else if (state === getNewState(cfg) || state === getSeenState(cfg)) {
      access[mode] = { unlocked: true, isNew: state === getNewState(cfg), requiredLevel };
    } else {
      access[mode] = { unlocked: requiredLevel > 0 && cleared >= requiredLevel, isNew: false, requiredLevel };
    }
  }
  return access;
}

/**
 * Lists the modes the campaign progress has earned and that have no stored entry yet.
 * @param {Object<string, string>} stored - Stored states: mode -> "new" | "seen".
 * @param {number} clearedLevel - Highest cleared campaign level (0 when none).
 * @param {object} cfg - The `modeUnlocks` section of configs/game.json.
 * @returns {string[]} Mode ids in configured order.
 */
export function computeNewlyEarned(stored, clearedLevel, cfg) {
  const cleared = Number.isFinite(clearedLevel) ? clearedLevel : 0;
  const states = stored && typeof stored === 'object' ? stored : {};
  return getOrder(cfg).filter((mode) => {
    const requiredLevel = getRequiredLevel(mode, cfg);
    return !isAlwaysAvailable(mode, cfg)
      && requiredLevel > 0
      && cleared >= requiredLevel
      && !Object.hasOwn(states, mode);
  });
}
