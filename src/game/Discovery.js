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

import { BOARD_MECHANICS, CLUSTER_MODIFIERS, OBSTACLE_TYPES } from '../core/Constants.js';

/**
 * First-encounter hints: which mechanics a board or a level shows, which one the player
 * has not met yet, and the text that explains it. Pure functions, no DOM and no storage.
 */

const MODIFIER_IDS = new Set(Object.values(CLUSTER_MODIFIERS));
const OBSTACLE_IDS = new Set(Object.values(OBSTACLE_TYPES));

/** Locale template for a mechanic explained by its Codex entry. */
const CODEX_HINT_KEY = 'gameplay.discovery.hint';

/** Mechanic id of the polarity flip, taught by the level that declares it. */
export const POLARITY_MECHANIC_ID = 'polarity';

/** Mechanic id of the beat bonus, present on a board where Resonance is live. */
export const RESONANCE_MECHANIC_ID = 'resonance';

/** Mechanic id of the Sag meter, present on a board where Sag is active. */
export const SAG_MECHANIC_ID = 'sag';

/** Prefix of the mechanic id of a special ball type: `special:<type>`. */
export const SPECIAL_MECHANIC_PREFIX = 'special:';

/**
 * What the player must do for a hint to count as learned, set per mechanic in
 * onboarding.mechanics.<id>.interaction. A mechanic without one is learned by sending a
 * shot close to it (PROXIMITY).
 */
export const DISCOVERY_INTERACTIONS = Object.freeze({
  /** Any shot is fired while the hint is shown. */
  SHOT: 'shot',
  /** A shot that cleared at least one ball. */
  MATCH: 'match',
  /** A shot flew through or next to the mechanic. */
  PROXIMITY: 'proximity',
  /** The polarity button was pressed. */
  TOGGLE: 'toggle',
  /** A special ball of the hinted type was fired. */
  USE: 'use'
});

/**
 * @param {string} specialType - Special ball type.
 * @returns {string} Mechanic id of that special ball.
 */
export function toSpecialMechanicId(specialType) {
  return `${SPECIAL_MECHANIC_PREFIX}${specialType}`;
}

/**
 * Mechanic ids of the special balls held in stock.
 * @param {Object<string, number>} [specialInventory] - Stock per special type.
 * @returns {string[]} Mechanic ids, one per type with a positive stock.
 */
export function listStockedSpecialMechanics(specialInventory = {}) {
  return Object.entries(specialInventory)
    .filter(([, count]) => count > 0)
    .map(([specialType]) => toSpecialMechanicId(specialType));
}

/**
 * Mechanics visible on a board. The basic rules are always part of it.
 * @param {Array<{clusterModifier: ?string, railMinX: ?number}>} balls - Board balls.
 * @param {Array<{type: string}>} obstacles - Board obstacles.
 * @param {Object<string, number>} [specialInventory] - Special balls in stock; each type held
 *   is a mechanic of its own.
 * @returns {Set<string>} Mechanic ids.
 */
export function listBoardMechanics(balls, obstacles, specialInventory = {}) {
  const present = new Set([BOARD_MECHANICS.BASICS, ...listStockedSpecialMechanics(specialInventory)]);
  for (const ball of balls) {
    if (ball.clusterModifier) {
      present.add(ball.clusterModifier);
    }
    if (ball.railMinX !== null && ball.railMinX !== undefined) {
      present.add(BOARD_MECHANICS.RAIL);
    }
  }
  for (const obstacle of obstacles) {
    present.add(obstacle.type);
  }
  return present;
}

/**
 * Mechanics a campaign level can show. An authored level describes its neutral anchors and
 * rails in `layout.anchors`; a generated level carries a ready layout spec instead, whose
 * balls flag them with `isNeutral` and `railHalfWidth` (see GameEngine.materializeLayout).
 * Both are read, so a generated level's neutral anchors and rails count as guaranteed and
 * order its first-encounter hints like an authored level's. The special balls a level hands
 * out and the mechanics it declares in `teachesMechanics` (the polarity flip) count too.
 * @param {Object} levelDef - Level definition from configs/levels.json, or a generated one
 *   from the LevelCatalog.
 * @param {{guaranteedOnly?: boolean}} [options] - With guaranteedOnly, leaves out the
 *   modifiers that only have a weight, since a weighted roll may never land.
 * @returns {Set<string>} Mechanic ids.
 */
export function listLevelMechanics(levelDef, { guaranteedOnly = false } = {}) {
  const present = new Set([
    BOARD_MECHANICS.BASICS,
    ...listStockedSpecialMechanics(levelDef.specialInventory),
    ...(levelDef.teachesMechanics || [])
  ]);
  for (const obstacle of levelDef.obstacles || []) {
    present.add(obstacle.type);
  }
  for (const anchor of levelDef.layout?.anchors || []) {
    if (anchor.neutral) {
      present.add(CLUSTER_MODIFIERS.NEUTRAL_ANCHOR);
    }
    if (anchor.rail > 0) {
      present.add(BOARD_MECHANICS.RAIL);
    }
  }
  for (const ballSpec of levelDef.spec?.balls || []) {
    if (ballSpec.isNeutral) {
      present.add(CLUSTER_MODIFIERS.NEUTRAL_ANCHOR);
    }
    if (ballSpec.railHalfWidth > 0) {
      present.add(BOARD_MECHANICS.RAIL);
    }
  }
  for (const [modKey, count] of Object.entries(levelDef.minModifierCounts || {})) {
    if (count > 0) {
      present.add(modKey);
    }
  }
  if (!guaranteedOnly) {
    for (const [modKey, weight] of Object.entries(levelDef.modifierWeights || {})) {
      if (weight > 0) {
        present.add(modKey);
      }
    }
  }
  return present;
}

/**
 * The first mechanic of the discovery order that is present and not met yet. Prioritized
 * mechanics, such as the ones a campaign level is built around, go before the others.
 * @param {Set<string>} present - Mechanics on the board.
 * @param {Object<string, boolean>} seen - Mechanics already discovered.
 * @param {string[]} order - Discovery priority.
 * @param {Set<string>} [prioritized] - Mechanics to explain first, still in discovery order.
 * @param {Set<string>} [shownThisRun] - Mechanics whose hint already showed in this run
 *   without being learned: they wait for the next run instead of coming back at once.
 * @returns {?string} Mechanic id, or null when everything present is known.
 */
export function pickNextDiscovery(present, seen, order, prioritized = new Set(), shownThisRun = new Set()) {
  const isNew = (id) => present.has(id) && !seen[id] && !shownThisRun.has(id);
  return order.find((id) => prioritized.has(id) && isNew(id)) || order.find(isNew) || null;
}

/**
 * The mechanic and every other one explained by the same text, so a shared tutorial
 * (the three cores) is shown once rather than three times.
 * @param {string} mechanicId - Mechanic being discovered.
 * @param {Object<string, {hintKey?: string}>} mechanics - onboarding.mechanics.
 * @returns {string[]} Mechanic ids.
 */
export function listMechanicsSharingHint(mechanicId, mechanics) {
  const hintKey = mechanics[mechanicId]?.hintKey;
  if (!hintKey) {
    return [mechanicId];
  }
  return Object.keys(mechanics).filter((id) => mechanics[id].hintKey === hintKey);
}

/**
 * What the interface should pulse while a mechanic's hint is shown.
 * @param {?string} mechanicId - Mechanic being explained.
 * @param {Object<string, {pulseTarget?: string}>} mechanics - onboarding.mechanics.
 * @returns {?string} 'polarity', 'special:<type>', or null when nothing should pulse.
 */
export function resolvePulseTarget(mechanicId, mechanics) {
  return (mechanicId && mechanics[mechanicId]?.pulseTarget) || null;
}

/**
 * True when a projectile is close enough to one of the mechanics to have met it: inside an
 * obstacle's body or field, or next to a ball carrying the modifier or the rail.
 * @param {Iterable<string>} mechanicIds - Mechanics sharing the hint being shown.
 * @param {{x: number, y: number, radius: number}} projectile - Shot in flight.
 * @param {Array<Object>} balls - Board balls.
 * @param {Array<Object>} obstacles - Board obstacles.
 * @param {number} margin - Extra distance that still counts as meeting it.
 * @returns {boolean} True when the projectile met one of them.
 */
export function isProjectileNearMechanic(mechanicIds, projectile, balls, obstacles, margin) {
  const ids = new Set(mechanicIds);
  const isNear = (x, y, reach) => Math.hypot(x - projectile.x, y - projectile.y) <= reach + projectile.radius + margin;
  for (const obstacle of obstacles) {
    if (!ids.has(obstacle.type)) {
      continue;
    }
    const reach = Math.max(
      obstacle.radius || 0,
      obstacle.fieldRadius || 0,
      obstacle.pullRadius || 0,
      (obstacle.width || 0) / 2,
      (obstacle.height || 0) / 2
    );
    if (isNear(obstacle.x, obstacle.y, reach)) {
      return true;
    }
  }
  const wantsRail = ids.has(BOARD_MECHANICS.RAIL);
  for (const ball of balls) {
    const isRail = wantsRail && ball.railMinX !== null && ball.railMinX !== undefined;
    if ((isRail || ids.has(ball.clusterModifier)) && isNear(ball.x, ball.y, ball.radius || 0)) {
      return true;
    }
  }
  return false;
}

/**
 * Text of a mechanic's hint: its tutorial when it has one, else its Codex entry.
 * @param {string} mechanicId - Mechanic to explain.
 * @param {{mechanics: Object}} onboardingConfig - onboarding section of configs/game.json.
 * @param {{clusterModifiers: Object}} ballsConfig - Balls configuration (Codex badges).
 * @param {function(string, Object=): string} translate - Translation function.
 * @param {string} [inputMode] - 'pointer' or 'touch', for hints with one wording per input mode.
 * @returns {string} Hint text, empty for an unknown mechanic.
 */
export function resolveHintText(mechanicId, onboardingConfig, ballsConfig, translate, inputMode = '') {
  const entry = onboardingConfig.mechanics[mechanicId];
  if (entry?.hintKey) {
    return translate(entry.inputAware && inputMode ? `${entry.hintKey}.${inputMode}` : entry.hintKey);
  }
  if (MODIFIER_IDS.has(mechanicId)) {
    const codexKey = `modals.shop.codex.modifiers.${mechanicId}`;
    return translate(CODEX_HINT_KEY, {
      icon: ballsConfig.clusterModifiers[mechanicId]?.badge || '',
      name: translate(`${codexKey}.name`),
      description: translate(`${codexKey}.description`)
    });
  }
  if (OBSTACLE_IDS.has(mechanicId)) {
    const codexKey = `modals.shop.codex.obstacles.${mechanicId}`;
    return translate(CODEX_HINT_KEY, {
      icon: translate(`${codexKey}.icon`),
      name: translate(`${codexKey}.name`),
      description: translate(`${codexKey}.description`)
    });
  }
  return '';
}
