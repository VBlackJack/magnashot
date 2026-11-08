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
 * Pure rules of the Sag meter: missed shots fill it, avalanches drain it, a full meter
 * lowers the cluster one step. No randomness and no engine access, so a run stays a pure
 * function of its turn outcomes.
 */

import { GAME_MODES } from '../core/Constants.js';

export const SAG_STEPS = Object.freeze({
  WAVE: 'wave',
  RAIL: 'rail'
});

export const SAG_PHASES = Object.freeze({
  CALM: 'calm',
  WARN: 'warn',
  FULL: 'full'
});

/** Fallbacks used when the `sag` config section is absent: no drain, one-segment warning. */
const NO_DRAIN_DROPS = Number.POSITIVE_INFINITY;
const FALLBACK_MAX_DRAIN = 0;
const FALLBACK_WARN_AT = 1;
const MIN_SIZE = 1;
const LEGACY_METER_MODES = Object.freeze([GAME_MODES.ENDLESS, GAME_MODES.DAILY]);

/**
 * Resolves the meter parameters of a mode.
 * @param {string} mode - A GAME_MODES value.
 * @param {object|undefined} sagCfg - The `sag` config section, possibly absent.
 * @param {object} endlessCfg - The `endless` config section (fallback size source).
 * @returns {{size:number, dropsPerDrain:number, maxDrainPerTurn:number, step:string, warnAt:number}|null}
 *   Null when the mode has no meter.
 */
export function getSagSpec(mode, sagCfg, endlessCfg) {
  const modeCfg = sagCfg?.modes?.[mode];
  if (sagCfg?.modes) {
    if (!modeCfg) {
      return null;
    }
  } else if (!LEGACY_METER_MODES.includes(mode)) {
    return null;
  }
  const size = Math.max(MIN_SIZE, Math.floor(modeCfg?.size ?? endlessCfg?.shotsBeforeWave ?? MIN_SIZE));
  return {
    size,
    dropsPerDrain: modeCfg?.dropsPerDrain ?? NO_DRAIN_DROPS,
    maxDrainPerTurn: modeCfg?.maxDrainPerTurn ?? FALLBACK_MAX_DRAIN,
    step: modeCfg?.step ?? SAG_STEPS.WAVE,
    warnAt: sagCfg?.warnAt ?? FALLBACK_WARN_AT
  };
}

/**
 * A turn is a whiff when nothing was removed, no avalanche dropped, and it was not frozen.
 * @param {{removed:boolean, dropped:number, frozen:boolean}} outcome
 * @returns {boolean}
 */
export function isWhiff({ removed, dropped, frozen }) {
  return !removed && !(dropped > 0) && !frozen;
}

/**
 * Phase of the meter for display and warnings.
 * @param {number} level - Current fill.
 * @param {{size:number}} spec - Meter parameters.
 * @param {number} warnAt - Segments before full at which the warning starts.
 * @returns {'calm'|'warn'|'full'}
 */
export function getSagPhase(level, spec, warnAt) {
  if (level >= spec.size) {
    return SAG_PHASES.FULL;
  }
  if (warnAt > 0 && level >= spec.size - warnAt) {
    return SAG_PHASES.WARN;
  }
  return SAG_PHASES.CALM;
}

/**
 * Applies one turn to the meter.
 * @param {{level:number}} state - Meter state before the turn.
 * @param {{removed:boolean, dropped:number, frozen:boolean}} outcome - What the turn did.
 * @param {object} spec - Result of getSagSpec.
 * @returns {{level:number, lowered:boolean, warned:boolean, drained:number}}
 */
export function applyTurn(state, outcome, spec) {
  const before = Math.max(0, Math.floor(state?.level ?? 0));
  let level = before;
  let drained = 0;
  if (outcome.dropped > 0 && Number.isFinite(spec.dropsPerDrain) && spec.dropsPerDrain > 0) {
    const wanted = Math.floor(outcome.dropped / spec.dropsPerDrain);
    drained = Math.min(wanted, spec.maxDrainPerTurn, level);
    level -= drained;
  }
  if (isWhiff(outcome)) {
    level += 1;
  }
  if (level >= spec.size) {
    return { level: 0, lowered: true, warned: false, drained };
  }
  const wasWarn = getSagPhase(before, spec, spec.warnAt) === SAG_PHASES.WARN;
  const warned = !wasWarn && getSagPhase(level, spec, spec.warnAt) === SAG_PHASES.WARN;
  return { level, lowered: false, warned, drained };
}
