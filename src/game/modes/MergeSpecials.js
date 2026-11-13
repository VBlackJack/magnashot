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

/** Special spheres of the Merge Basin, as keyed in configs/modes.json `merge.specials.kinds`. */
export const MERGE_SPECIAL_KINDS = Object.freeze({
  JOKER: 'joker',
  ICE: 'ice',
  BOMB: 'bomb'
});

/** Every special kind, in the order weights are summed so a draw stays deterministic. */
export const MERGE_SPECIAL_KIND_IDS = Object.freeze(Object.values(MERGE_SPECIAL_KINDS));

/** True when `kind` names a special sphere. */
export function isMergeSpecialKind(kind) {
  return MERGE_SPECIAL_KIND_IDS.includes(kind);
}

/**
 * Kind kept from a saved or foreign value: a known kind that the config still offers,
 * else null (a plain sphere).
 */
export function sanitizeMergeSpecialKind(raw, kindsConfig) {
  return isMergeSpecialKind(raw) && kindsConfig?.[raw] ? raw : null;
}

/**
 * Kind drawn by weight from a unit roll. Kinds without a positive weight are never drawn.
 * @param {object} kindsConfig - `merge.specials.kinds`.
 * @param {number} roll - Unit roll in [0, 1).
 * @returns {string|null} The kind, or null when nothing is drawable.
 */
export function pickMergeSpecialKind(kindsConfig, roll) {
  const weighted = MERGE_SPECIAL_KIND_IDS
    .map((id) => ({ id, weight: Number(kindsConfig?.[id]?.weight) }))
    .filter((entry) => entry.weight > 0);
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) {
    return null;
  }
  let threshold = roll * total;
  for (const entry of weighted) {
    if (threshold < entry.weight) {
      return entry.id;
    }
    threshold -= entry.weight;
  }
  return weighted[weighted.length - 1].id;
}

/** Calibre index of a sphere for fusion: a whole mergeTier, else null (Joker and Bomb carry none). */
export function getMergeCalibre(ball) {
  return Number.isInteger(ball.mergeTier) ? ball.mergeTier : null;
}

/** True when `ball` is an Ice sphere that no shockwave has reached yet. */
export function isMergeFrozen(ball) {
  return ball.mergeKind === MERGE_SPECIAL_KINDS.ICE;
}

/** True when two spheres carry the same whole calibre. A missing calibre never matches another one. */
export function haveSameMergeCalibre(a, b) {
  const calibre = getMergeCalibre(a);
  return calibre !== null && calibre === getMergeCalibre(b);
}

/**
 * Calibre two touching spheres fuse at, or null when they do not fuse. A frozen sphere never
 * fuses; a Joker fuses once with a plain sphere below the top calibre, as if two spheres of
 * that calibre touched; a Bomb and a missing calibre never fuse.
 * @param {object} a - First sphere.
 * @param {object} b - Second sphere.
 * @param {number} topCalibre - Index of the highest calibre.
 * @returns {number|null}
 */
export function getMergeFusionCalibre(a, b, topCalibre) {
  if (isMergeFrozen(a) || isMergeFrozen(b)) {
    return null;
  }
  const jokerA = a.mergeKind === MERGE_SPECIAL_KINDS.JOKER;
  const jokerB = b.mergeKind === MERGE_SPECIAL_KINDS.JOKER;
  if (jokerA || jokerB) {
    if (jokerA && jokerB) {
      return null;
    }
    const partner = jokerA ? b : a;
    const calibre = partner.mergeKind ? null : getMergeCalibre(partner);
    return calibre !== null && calibre < topCalibre ? calibre : null;
  }
  if (a.mergeKind === MERGE_SPECIAL_KINDS.BOMB || b.mergeKind === MERGE_SPECIAL_KINDS.BOMB) {
    return null;
  }
  return haveSameMergeCalibre(a, b) ? getMergeCalibre(a) : null;
}
