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

import { CONFIG_PATHS, DATA_FETCH_OPTIONS } from './Constants.js';
import { applyWorldGeometry } from './WorldGeometry.js';

/**
 * Settings that must be strictly positive numbers: zero or a negative value would loop
 * forever (overcharge payout, fixed-step accumulator) or freeze the simulation.
 */
const POSITIVE_SETTINGS = Object.freeze([
  ['game', 'scoring.overchargeMax'],
  ['game', 'juice.slowMotion.timeScale'],
  ['game', 'juice.particles.maxParticles'],
  ['game', 'juice.particles.adaptiveBudget.highFrameMs'],
  ['game', 'juice.particles.adaptiveBudget.recoverFrameMs'],
  ['game', 'juice.particles.adaptiveBudget.minScale'],
  ['game', 'juice.particles.adaptiveBudget.stepDown'],
  ['game', 'juice.particles.adaptiveBudget.stepUp'],
  ['game', 'juice.particles.maxShatteringBalls'],
  ['game', 'juice.particles.maxExplosions'],
  ['physics', 'simulation.fixedStepMs'],
  ['physics', 'simulation.maxAccumulatedMs']
]);

/**
 * Settings that may be zero but must be numbers: a missing one turns every velocity it
 * scales into NaN and silently breaks the simulation.
 */
const NON_NEGATIVE_SETTINGS = Object.freeze([['physics', 'simulation.clusterFieldFactor']]);

/**
 * Throws when a setting listed in POSITIVE_SETTINGS is missing or not a positive number,
 * or one listed in NON_NEGATIVE_SETTINGS is missing or negative,
 * so a broken config stops at startup with the loading error instead of hanging the game.
 * @param {Map<string, object>} configs - Loaded configs by namespace.
 */
export function validateConfigs(configs) {
  const read = (namespace, path) => path.split('.').reduce((node, key) => node?.[key], configs.get(namespace));
  for (const [namespace, path] of POSITIVE_SETTINGS) {
    const value = read(namespace, path);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid config ${namespace}.${path}: expected a positive number, got ${value}`);
    }
  }
  for (const [namespace, path] of NON_NEGATIVE_SETTINGS) {
    const value = read(namespace, path);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid config ${namespace}.${path}: expected a number of zero or more, got ${value}`);
    }
  }
  const adaptive = read('game', 'juice.particles.adaptiveBudget');
  if (adaptive.recoverFrameMs >= adaptive.highFrameMs) {
    throw new Error(
      `Invalid config game.juice.particles.adaptiveBudget: recoverFrameMs (${adaptive.recoverFrameMs}) must be below highFrameMs (${adaptive.highFrameMs})`
    );
  }
  if (adaptive.minScale > 1) {
    throw new Error(`Invalid config game.juice.particles.adaptiveBudget.minScale: expected <= 1, got ${adaptive.minScale}`);
  }
}

const DEFERRED_CONFIG_KEYS = new Set(['CAMPAIGN_TUNING', 'FLUX_SHAPE_TUNING']);

class ConfigRegistry {
  constructor() {
    this.configs = new Map();
    this.loaded = false;
  }

  async loadEntries(entries) {
    const results = await Promise.all(
      entries.map(async ([key, path]) => {
        const ns = key.toLowerCase();
        if (this.configs.has(ns)) {
          return [ns, this.configs.get(ns)];
        }
        const response = await fetch(path, DATA_FETCH_OPTIONS);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${path}`);
        }
        const data = await response.json();
        return [ns, data];
      })
    );
    for (const [ns, data] of results) {
      this.configs.set(ns, data);
    }
  }

  async loadCore() {
    const coreEntries = Object.entries(CONFIG_PATHS).filter(([key]) => !DEFERRED_CONFIG_KEYS.has(key));
    await this.loadEntries(coreEntries);
    validateConfigs(this.configs);
    applyWorldGeometry(this.configs.get('game'));
    this.loaded = true;
  }

  async loadDeferred() {
    const deferredEntries = Object.entries(CONFIG_PATHS).filter(([key]) => DEFERRED_CONFIG_KEYS.has(key));
    await this.loadEntries(deferredEntries);
  }

  async loadAll() {
    await this.loadEntries(Object.entries(CONFIG_PATHS));
    validateConfigs(this.configs);
    applyWorldGeometry(this.configs.get('game'));
    this.loaded = true;
  }

  get(namespace) {
    return this.configs.get(namespace.toLowerCase());
  }
}

export const configRegistry = new ConfigRegistry();

/**
 * Number of campaign levels: the authored ones, then the generated ones.
 * @param {object} levelsConfig - configs/levels.json.
 * @param {object} campaignConfig - configs/campaign.json.
 * @returns {number}
 */
export function countCampaignLevels(levelsConfig, campaignConfig) {
  return levelsConfig.levels.length + campaignConfig.generated.count;
}
