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

import { SeededRandom } from '../core/SeededRandom.js';
import { createCharge } from './VersusRules.js';

/**
 * Pure rules of the Magnetar bosses. No DOM, no engine: every tunable is read from the `cfg`
 * argument (the `magnetar` section of the game config). Keys read here:
 *   maxTier           highest tier
 *   fluxStagesPerTier Flux stages per tier
 *   cadenceByTier     { [tier]: rest turns between two behaviours }
 *   tierUnlocks       { [tier]: behaviours added at that tier } (cumulative)
 *   regrow            { count }
 *   barrage           { countByTier, strongFromTier, strongChance, riseTurns }
 *   fall              { pointsBase, pointsPerSphere, coins, landslideMin }
 * Randomness only comes from a SeededRandom passed in, or built from `${key}:${step}`.
 */

/** Behaviour names, armed one turn ahead and acting on the next. */
export const MAGNETAR_BEHAVIOURS = Object.freeze({
  INVERT: 'invert',
  UNDERTOW: 'undertow',
  REGROW: 'regrow',
  BARRAGE: 'barrage'
});

/** Schedule phases. */
export const MAGNETAR_PHASES = Object.freeze({
  REST: 'rest',
  ARMED: 'armed'
});

/** Game modes the Magnetar appears in. */
export const MAGNETAR_MODES = Object.freeze({
  BOSS_RUSH: 'bossRush',
  FLUX: 'flux'
});

const MIN_TIER = 1;
const NO_TURNS = 0;
const NO_COUNT = 0;
const STRONG_STRENGTH = 2;
const NORMAL_STRENGTH = 1;
const POSITIVE_POLARITY = 1;
const NEGATIVE_POLARITY = -1;
const POLARITY_SPLIT = 0.5;
const SLOT_ANGLE_COUNT = 12;
/** Growth of the search radius from one shell to the next, in ball radii. */
const SLOT_SHELL_STEP_RADII = 0.5;
/** Arc between two candidates of an outer shell, in ball radii. */
const SLOT_ARC_RADII = 0.5;
const SLOT_DISTANCE_RADII = 2;
const SLOT_OVERLAP_RADII = 1.8;
/** A slot beyond the first shell must touch a sphere within this many radii. */
const SLOT_ADJACENT_RADII = 2.2;
const FIRST_SHELL = 1;
const FULL_PROGRESS = 1;
const FIRST_STEP = 0;

/**
 * Tier of a Magnetar fight.
 * @param {string} mode - MAGNETAR_MODES value.
 * @param {number} waveOrStage - Boss Rush wave or Flux stage.
 * @param {object} cfg - Magnetar config.
 * @returns {number} Tier, between 1 and cfg.maxTier.
 */
export function tierFor(mode, waveOrStage, cfg) {
  const raw = mode === MAGNETAR_MODES.FLUX ? Math.floor(waveOrStage / cfg.fluxStagesPerTier) : waveOrStage;
  return Math.min(cfg.maxTier, Math.max(MIN_TIER, raw));
}

/**
 * Behaviours a tier can arm: the union of every unlock up to that tier.
 * @returns {string[]} Behaviour names, in unlock order.
 */
export function behavioursForTier(tier, cfg) {
  const available = [];
  for (let t = MIN_TIER; t <= Math.min(tier, cfg.maxTier); t++) {
    for (const behaviour of cfg.tierUnlocks[t] ?? []) {
      if (!available.includes(behaviour)) {
        available.push(behaviour);
      }
    }
  }
  return available;
}

/**
 * Deterministic draw of the next behaviour. Never the previous one when another is available.
 * @param {string} key - Run key (e.g. `bossRush:magnetar:3`).
 * @param {number} step - Schedule step counter.
 * @param {string[]} available - Behaviours the tier allows.
 * @param {string|null} previous - Last armed behaviour.
 * @returns {string|null} The behaviour, null when none is available.
 */
export function drawBehaviour(key, step, available, previous) {
  if (available.length === 0) {
    return null;
  }
  const others = available.filter((behaviour) => behaviour !== previous);
  const pool = others.length > 0 ? others : available;
  const rng = new SeededRandom(`${key}:${step}`);
  return pool[Math.min(pool.length - 1, Math.floor(rng.next() * pool.length))];
}

/**
 * Fresh schedule: resting for the tier's cadence.
 * @returns {{tier:number, step:number, phase:string, restLeft:number, armed:(string|null), previous:(string|null)}}
 */
export function createScheduleState(tier, cfg) {
  return {
    tier,
    step: FIRST_STEP,
    phase: MAGNETAR_PHASES.REST,
    restLeft: cfg.cadenceByTier[tier],
    armed: null,
    previous: null
  };
}

/**
 * Advances the schedule by one resolved turn. Pure: the input state is not changed.
 * Rest turns count down; the turn the count reaches zero arms a behaviour (the warning, no
 * effect yet); the next turn end reports it as acted and the schedule rests again.
 * @param {object} state - From createScheduleState or a previous call.
 * @param {object} cfg - Magnetar config.
 * @param {string} key - Run key for the draw.
 * @returns {{state:object, armed:(string|null), acted:(string|null)}} `armed` is set only on the
 *   turn a warning appears, `acted` only on the turn the behaviour acts.
 */
export function advanceSchedule(state, cfg, key) {
  if (state.phase === MAGNETAR_PHASES.ARMED) {
    return {
      state: {
        ...state,
        phase: MAGNETAR_PHASES.REST,
        restLeft: cfg.cadenceByTier[state.tier],
        armed: null,
        previous: state.armed
      },
      armed: null,
      acted: state.armed
    };
  }
  const restLeft = Math.max(NO_TURNS, state.restLeft - 1);
  if (restLeft > NO_TURNS) {
    return { state: { ...state, restLeft }, armed: null, acted: null };
  }
  const behaviour = drawBehaviour(key, state.step, behavioursForTier(state.tier, cfg), state.previous);
  if (behaviour === null) {
    return { state: { ...state, restLeft }, armed: null, acted: null };
  }
  return {
    state: { ...state, step: state.step + 1, phase: MAGNETAR_PHASES.ARMED, restLeft, armed: behaviour },
    armed: behaviour,
    acted: null
  };
}

/**
 * Anchors still holding the Magnetar up: every anchor in its bond component, lowest id first.
 * @param {Array<object>} balls - Live balls.
 * @param {Map<number, object>} ballMap - Ball id -> ball.
 * @param {number} magnetarId - Id of the Magnetar ball.
 * @returns {number[]} Anchor ids (the Magnetar itself never counts).
 */
export function findMoorings(balls, ballMap, magnetarId) {
  const live = new Set(balls.map((ball) => ball.id));
  if (!live.has(magnetarId)) {
    return [];
  }
  const seen = new Set([magnetarId]);
  const queue = [magnetarId];
  const anchors = [];
  while (queue.length > 0) {
    const ball = ballMap.get(queue.shift());
    if (!ball) {
      continue;
    }
    for (const neighbourId of ball.bonds) {
      if (seen.has(neighbourId) || !live.has(neighbourId)) {
        continue;
      }
      seen.add(neighbourId);
      queue.push(neighbourId);
      if (ballMap.get(neighbourId)?.isAnchor) {
        anchors.push(neighbourId);
      }
    }
  }
  return anchors.sort((a, b) => a - b);
}

/**
 * Mooring an Overcharge strike snaps: the lowest ball id, so the choice is deterministic.
 * @param {number[]} mooringIds - From findMoorings.
 * @returns {number|null} Id, null when nothing holds the Magnetar.
 */
export function pickMooringToSnap(mooringIds) {
  return mooringIds.length === 0 ? null : Math.min(...mooringIds);
}

/**
 * Free slots touching the Magnetar where Regrow adds spheres. Never anchors.
 * @param {{x:number, y:number, id:number}} magnetar - The Magnetar ball.
 * @param {Array<object>} balls - Live balls.
 * @param {number} r - Ball radius.
 * @param {number} count - Spheres to add at most.
 * @param {{next:function():number}} rng - Seeded random source.
 * @param {{minX:number, maxX:number, minY:number, maxY:number}|null} [bounds] - Playfield limits.
 * @param {number} [maxShells] - Shells searched outward (1 = only touching the Magnetar). A slot of
 *   a further shell must touch an existing sphere, so Regrow still acts when the rings crowd the core.
 * @returns {Array<{x:number, y:number, isAnchor:boolean}>} Up to `count` non-overlapping slots.
 */
export function regrowSlots(magnetar, balls, r, count, rng, bounds = null, maxShells = FIRST_SHELL) {
  if (count <= NO_COUNT) {
    return [];
  }
  const minGap = r * SLOT_OVERLAP_RADII;
  const adjacentGap = r * SLOT_ADJACENT_RADII;
  const taken = [];
  const others = balls.filter((ball) => ball.id !== magnetar.id);
  const touching = [magnetar, ...others];
  const shells = Math.max(FIRST_SHELL, Math.floor(maxShells));
  for (let shell = FIRST_SHELL; shell <= shells && taken.length < count; shell++) {
    const shellRadius = r * (SLOT_DISTANCE_RADII + (shell - FIRST_SHELL) * SLOT_SHELL_STEP_RADII);
    const angleCount = shell === FIRST_SHELL
      ? SLOT_ANGLE_COUNT
      : Math.ceil((Math.PI * 2 * shellRadius) / (r * SLOT_ARC_RADII));
    const candidates = [];
    for (let i = 0; i < angleCount; i++) {
      const angle = (i / angleCount) * Math.PI * 2;
      candidates.push({
        x: magnetar.x + Math.cos(angle) * shellRadius,
        y: magnetar.y + Math.sin(angle) * shellRadius
      });
    }
    // Fisher-Yates on the seeded source: same key, same order.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const slot of candidates) {
      if (taken.length >= count) {
        break;
      }
      const inBounds = !bounds
        || (slot.x - r >= bounds.minX && slot.x + r <= bounds.maxX
          && slot.y - r >= bounds.minY && slot.y + r <= bounds.maxY);
      const free = inBounds
        && others.every((ball) => Math.hypot(ball.x - slot.x, ball.y - slot.y) >= minGap)
        && taken.every((t) => Math.hypot(t.x - slot.x, t.y - slot.y) >= minGap);
      const attached = shell === FIRST_SHELL
        || touching.some((ball) => Math.hypot(ball.x - slot.x, ball.y - slot.y) <= adjacentGap);
      if (free && attached) {
        taken.push({ x: slot.x, y: slot.y, isAnchor: false });
      }
    }
  }
  return taken;
}

/**
 * Charges a Barrage fires. Built with VersusRules.createCharge; they rise over riseTurns turns.
 * @param {number} tier - Magnetar tier.
 * @param {object} cfg - Magnetar config.
 * @param {{next:function():number}} rng - Seeded random source.
 * @param {{minX:number, maxX:number, startY:number, targetY:number, idStart:number}} span -
 *   Horizontal lane range, danger line height, landing height and first charge id.
 * @returns {Array<object>} Charge specs (with `turnsLeft`), empty below the first barrage tier.
 */
export function planBarrage(tier, cfg, rng, span) {
  const count = cfg.barrage.countByTier[tier] ?? NO_COUNT;
  const canBeStrong = tier >= cfg.barrage.strongFromTier;
  const charges = [];
  for (let i = 0; i < count; i++) {
    const polarity = rng.next() < POLARITY_SPLIT ? POSITIVE_POLARITY : NEGATIVE_POLARITY;
    const strong = canBeStrong && rng.next() < cfg.barrage.strongChance;
    const lane = (i + rng.next()) / count;
    const charge = createCharge({
      polarity,
      strength: strong ? STRONG_STRENGTH : NORMAL_STRENGTH,
      x: span.minX + lane * (span.maxX - span.minX),
      startY: span.startY,
      targetY: span.targetY,
      riseFrames: cfg.barrage.riseTurns,
      id: span.idStart + i
    });
    charges.push({ ...charge, turnsLeft: cfg.barrage.riseTurns });
  }
  return charges;
}

/**
 * Moves every charge one turn up. Pure: inputs are not changed.
 * @param {Array<object>} charges - From planBarrage or a previous call.
 * @returns {{charges:Array<object>, landed:Array<object>}} Still rising, and landing this turn.
 */
export function advanceTurnCharges(charges) {
  const rising = [];
  const landed = [];
  for (const charge of charges) {
    const turnsLeft = Math.max(NO_TURNS, charge.turnsLeft - 1);
    const progress = charge.riseFrames > NO_TURNS ? FULL_PROGRESS - turnsLeft / charge.riseFrames : FULL_PROGRESS;
    const moved = { ...charge, turnsLeft, y: charge.startY + (charge.targetY - charge.startY) * progress };
    (turnsLeft === NO_TURNS ? landed : rising).push(moved);
  }
  return { charges: rising, landed };
}

/**
 * Reward of a Magnetar fall.
 * @param {number} dropped - Spheres in the same avalanche.
 * @param {object} cfg - Magnetar config.
 * @returns {{points:number, coins:number, landslide:boolean}}
 */
export function fallReward(dropped, cfg) {
  return {
    points: cfg.fall.pointsBase + cfg.fall.pointsPerSphere * dropped,
    coins: cfg.fall.coins,
    landslide: dropped >= cfg.fall.landslideMin
  };
}
