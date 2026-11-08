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
 * Pure helpers for the Weekly Flux: ISO week keys in UTC and the seed derived from a key.
 */

const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;
const ISO_THURSDAY_OFFSET = 3;
const WEEK_KEY_PAD = 2;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SEED_KEY_SEPARATOR = ':';
const DEFAULT_SEED_RADIX = 36;
const DEFAULT_SEED_LENGTH = 6;

/** Days since Monday (0 to 6) for a UTC date. */
function getMondayBasedDay(date) {
  return (date.getUTCDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
}

/**
 * ISO 8601 week key of a UTC instant, e.g. "2026-W45". Weeks start on Monday 00:00 UTC and
 * belong to the year that holds their Thursday.
 * @param {number} nowMs - Epoch milliseconds.
 * @returns {string}
 */
export function getUtcIsoWeekKey(nowMs) {
  const date = new Date(nowMs);
  const thursdayMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    - getMondayBasedDay(date) * MS_PER_DAY
    + ISO_THURSDAY_OFFSET * MS_PER_DAY;
  const thursday = new Date(thursdayMs);
  const isoYear = thursday.getUTCFullYear();
  const dayOfYear = Math.round((thursdayMs - Date.UTC(isoYear, 0, 1)) / MS_PER_DAY);
  const week = Math.floor(dayOfYear / DAYS_PER_WEEK) + 1;
  return `${isoYear}-W${String(week).padStart(WEEK_KEY_PAD, '0')}`;
}

/**
 * Deterministic Flux seed of a week: FNV-1a 32 bits of "salt:weekKey", reduced to the seed
 * space and written in the seed radix, zero padded to the seed length.
 * @param {string} weekKey - Week key from getUtcIsoWeekKey.
 * @param {{radix?: number, length?: number}} seedCfg - The `seed` section of configs/flux.json.
 * @param {string} salt - The `weeklyFlux.seedSalt` config value.
 * @returns {string} Lowercase seed accepted by parseFluxSeedInput.
 */
export function getWeeklyFluxSeed(weekKey, seedCfg, salt) {
  const radix = seedCfg?.radix > 1 ? seedCfg.radix : DEFAULT_SEED_RADIX;
  const length = seedCfg?.length > 0 ? seedCfg.length : DEFAULT_SEED_LENGTH;
  const text = `${salt}${SEED_KEY_SEPARATOR}${weekKey}`;
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
  }
  return (hash % radix ** length).toString(radix).padStart(length, '0');
}

/**
 * @param {number} nowMs - Epoch milliseconds.
 * @returns {number} Milliseconds until the next Monday 00:00 UTC.
 */
export function getMsUntilNextWeekly(nowMs) {
  const date = new Date(nowMs);
  const startOfDayMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const nextMondayMs = startOfDayMs + (DAYS_PER_WEEK - getMondayBasedDay(date)) * MS_PER_DAY;
  return nextMondayMs - nowMs;
}
