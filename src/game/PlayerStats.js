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
 * Pure local statistics. Shape:
 * { v, since (epoch ms, 0 when unknown), shots, playMs, seq,
 *   modes: { [mode]: { runs, wins, losses, quits } },
 *   levels: { [id]: { a: attempts, f: fails, q: quits, t: last-touched seq } } }.
 * A delta has the same shape with additive (possibly negative) counters; a level entry
 * with `touch: true` bumps seq and stamps the entry.
 */

const STATS_FORMAT_VERSION = 1;
const OUTCOME_WIN = 'win';
const OUTCOME_LOSS = 'loss';
const OUTCOME_QUIT = 'quit';
const FORBIDDEN_KEY = '__proto__';
const MODE_FIELDS = Object.freeze(['runs', 'wins', 'losses', 'quits']);
const LEVEL_FIELDS = Object.freeze(['a', 'f', 'q']);
const OUTCOME_MODE_FIELD = Object.freeze({
  [OUTCOME_WIN]: 'wins',
  [OUTCOME_LOSS]: 'losses',
  [OUTCOME_QUIT]: 'quits'
});
const RECORD_KIND_STAGE = 'stage';
const RECORD_KIND_CLASSIC_STAGE = 'classicStage';
const RECORD_KIND_WAVE = 'wave';
// Code points of typographic look-alikes of ASCII, mapped to their plain replacement.
const ASCII_REPLACEMENTS = new Map([
  [[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212], '-'],
  [[0x201C, 0x201D, 0x201E, 0x00AB, 0x00BB], '"'],
  [[0x2018, 0x2019, 0x201A], "'"],
  [[0x2026], '...']
]);
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const DEFAULT_TOP_LEVELS = 3;

function clampCount(value) {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), Number.MAX_SAFE_INTEGER) : 0;
}

function toInt(value) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeEntries(value) {
  return isRecord(value) ? Object.entries(value).filter(([key]) => key !== FORBIDDEN_KEY) : [];
}

/**
 * @param {number} [nowMs] - Creation time stored as `since`.
 * @returns {object} An empty stats object.
 */
export function createPlayerStats(nowMs = 0) {
  return { v: STATS_FORMAT_VERSION, since: clampCount(nowMs), shots: 0, playMs: 0, seq: 0, modes: {}, levels: {} };
}

/**
 * Validates untrusted stats (storage). Invalid fields fall back to zero; unknown fields are dropped.
 * @param {unknown} raw - Candidate value.
 * @param {number} [nowMs] - `since` used when the candidate has none.
 * @returns {object} A clean copy.
 */
export function normalizePlayerStats(raw, nowMs = 0) {
  const stats = createPlayerStats(nowMs);
  if (!isRecord(raw)) {
    return stats;
  }
  if (Number.isFinite(raw.since) && raw.since > 0) {
    stats.since = clampCount(raw.since);
  }
  stats.shots = clampCount(raw.shots);
  stats.playMs = clampCount(raw.playMs);
  stats.seq = clampCount(raw.seq);
  for (const [mode, entry] of safeEntries(raw.modes)) {
    if (isRecord(entry)) {
      stats.modes[mode] = Object.fromEntries(MODE_FIELDS.map((field) => [field, clampCount(entry[field])]));
    }
  }
  for (const [levelId, entry] of safeEntries(raw.levels)) {
    if (isRecord(entry)) {
      stats.levels[levelId] = {
        ...Object.fromEntries(LEVEL_FIELDS.map((field) => [field, clampCount(entry[field])])),
        t: clampCount(entry.t)
      };
    }
  }
  return stats;
}

/**
 * Applies an additive delta and returns new stats (the input is not mutated). Counters are
 * clamped to non-negative safe integers, empty level entries are dropped, and when the level
 * map exceeds the cap the entries with the smallest `t` are evicted.
 * @param {object} stats - Current stats.
 * @param {object} delta - Additive delta.
 * @param {{maxLevelEntries?: number}} [cfg] - The `playerStats` config section.
 * @returns {object}
 */
export function applyPlayerStatsDelta(stats, delta, cfg = {}) {
  const next = normalizePlayerStats(stats, stats?.since);
  if (!isRecord(delta)) {
    return next;
  }
  next.shots = clampCount(next.shots + toInt(delta.shots));
  next.playMs = clampCount(next.playMs + toInt(delta.playMs));
  for (const [mode, change] of safeEntries(delta.modes)) {
    const current = next.modes[mode] ?? Object.fromEntries(MODE_FIELDS.map((field) => [field, 0]));
    const updated = Object.fromEntries(MODE_FIELDS.map((field) => [field, clampCount(current[field] + toInt(change?.[field]))]));
    if (next.modes[mode] || MODE_FIELDS.some((field) => updated[field] > 0)) {
      next.modes[mode] = updated;
    }
  }
  const levelChanges = safeEntries(delta.levels);
  if (levelChanges.some(([, change]) => change?.touch === true)) {
    next.seq += 1;
  }
  for (const [levelId, change] of levelChanges) {
    const current = next.levels[levelId] ?? { a: 0, f: 0, q: 0, t: 0 };
    const updated = {
      ...Object.fromEntries(LEVEL_FIELDS.map((field) => [field, clampCount(current[field] + toInt(change?.[field]))])),
      t: change?.touch === true ? next.seq : current.t
    };
    if (LEVEL_FIELDS.every((field) => updated[field] === 0)) {
      delete next.levels[levelId];
    } else {
      next.levels[levelId] = updated;
    }
  }
  const cap = cfg?.maxLevelEntries;
  if (Number.isFinite(cap) && cap >= 0) {
    const ids = Object.keys(next.levels);
    if (ids.length > cap) {
      ids.sort((first, second) => next.levels[first].t - next.levels[second].t);
      for (const id of ids.slice(0, ids.length - cap)) {
        delete next.levels[id];
      }
    }
  }
  return next;
}

/**
 * Builds the delta of one finished run.
 * @param {{mode: string, levelId?: string|number|null, outcome: string}} run - Run result.
 * @param {number} [sign] - 1 to apply, -1 to retract.
 * @returns {object|null} Delta, or null for an unknown outcome or mode.
 */
export function buildRunOutcomeDelta(run, sign = 1) {
  const field = OUTCOME_MODE_FIELD[run?.outcome];
  if (!field || typeof run.mode !== 'string' || run.mode.length === 0) {
    return null;
  }
  const delta = { modes: { [run.mode]: { runs: sign, [field]: sign } } };
  if (run.levelId !== null && run.levelId !== undefined) {
    const level = { a: sign, f: 0, q: 0, touch: sign > 0 };
    if (run.outcome === OUTCOME_LOSS) {
      level.f = sign;
    } else if (run.outcome === OUTCOME_QUIT) {
      level.q = sign;
    }
    delta.levels = { [String(run.levelId)]: level };
  }
  return delta;
}

/**
 * Counts a finished run (win, loss or quit) and returns new stats.
 * @param {object} stats - Current stats.
 * @param {{mode: string, levelId?: string|number|null, outcome: string}} run - Run result.
 * @param {{maxLevelEntries?: number}} [cfg] - The `playerStats` config section.
 * @returns {object}
 */
export function applyRunOutcome(stats, run, cfg = {}) {
  const delta = buildRunOutcomeDelta(run, 1);
  return delta ? applyPlayerStatsDelta(stats, delta, cfg) : normalizePlayerStats(stats, stats?.since);
}

/**
 * Exact inverse of applyRunOutcome for every counter (used when a lost run is continued).
 * The last-touched stamp and seq are left as they are.
 * @param {object} stats - Current stats.
 * @param {{mode: string, levelId?: string|number|null, outcome: string}} run - Run result to undo.
 * @param {{maxLevelEntries?: number}} [cfg] - The `playerStats` config section.
 * @returns {object}
 */
export function retractRunOutcome(stats, run, cfg = {}) {
  const delta = buildRunOutcomeDelta(run, -1);
  return delta ? applyPlayerStatsDelta(stats, delta, cfg) : normalizePlayerStats(stats, stats?.since);
}

function pickLevels(stats, field, n) {
  const limit = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : DEFAULT_TOP_LEVELS;
  return safeEntries(stats?.levels)
    .filter(([, entry]) => entry[field] > 0)
    .map(([levelId, entry]) => ({ levelId, fails: entry.f, attempts: entry.a, quits: entry.q }))
    .sort((first, second) => {
      const fieldKey = field === 'f' ? 'fails' : 'quits';
      return second[fieldKey] - first[fieldKey]
        || second.attempts - first.attempts
        || first.levelId.localeCompare(second.levelId, undefined, { numeric: true });
    })
    .slice(0, limit);
}

/**
 * @param {object} stats - Stats object.
 * @param {number} n - How many levels to return.
 * @returns {Array<{levelId: string, fails: number, attempts: number, quits: number}>} Most failed levels first.
 */
export function pickHardestLevels(stats, n) {
  return pickLevels(stats, 'f', n);
}

/**
 * @param {object} stats - Stats object.
 * @param {number} n - How many levels to return.
 * @returns {Array<{levelId: string, fails: number, attempts: number, quits: number}>} Most abandoned levels first.
 */
export function pickMostLeftLevels(stats, n) {
  return pickLevels(stats, 'q', n);
}

/** Replaces typographic dashes, curly quotes and the ellipsis character by plain ASCII. */
export function sanitizeStatsText(text) {
  let clean = String(text);
  for (const [codePoints, replacement] of ASCII_REPLACEMENTS) {
    for (const codePoint of codePoints) {
      clean = clean.replaceAll(String.fromCodePoint(codePoint), replacement);
    }
  }
  return clean;
}

/**
 * Splits a play time into whole hours and remaining minutes.
 * @param {number} playMs - Play time in milliseconds.
 * @returns {{hours: number, minutes: number}}
 */
export function splitPlayTime(playMs) {
  const totalMinutes = Math.floor(clampCount(playMs) / MS_PER_MINUTE);
  return { hours: Math.floor(totalMinutes / MINUTES_PER_HOUR), minutes: totalMinutes % MINUTES_PER_HOUR };
}

/** The best result of a mode as text, or an empty string when the mode has no record yet. */
function buildBestText(record, translate) {
  const score = clampCount(record?.score);
  if (record?.kind === RECORD_KIND_STAGE && record.stage > 0) {
    return translate('modals.stats.overview.bestStage', { score, stage: record.stage });
  }
  if (record?.kind === RECORD_KIND_CLASSIC_STAGE && record.stage > 0) {
    return translate('modals.stats.overview.bestClassicStage', { score, stage: record.stage });
  }
  if (record?.kind === RECORD_KIND_WAVE && record.wave > 0) {
    return translate('modals.stats.overview.bestWave', { score, wave: record.wave });
  }
  return score > 0 ? translate('modals.stats.overview.bestScore', { score }) : '';
}

/**
 * Builds the anonymous plain-text export of the stats, in the player's language.
 * @param {object} stats - Stats object.
 * @param {{campaign?: {level: number, stars: number}, modes?: Object<string, {score: number, kind?: string, stage?: number, wave?: number}>}} records - Best results read from storage.
 * @param {{schemaVersion: number, sinceLabel?: string|null, modeOrder?: string[], modeLabels?: Object<string, string>}} meta - Display data.
 * @param {(key: string, params?: object) => string} translate - Translation function.
 * @returns {string} Text without personal data and without typographic dashes or curly quotes.
 */
export function buildPlayerStatsText(stats, records, meta, translate) {
  const lines = [translate('stats.copy.header')];
  if (meta?.sinceLabel) {
    lines.push(translate('stats.copy.since', { date: meta.sinceLabel }));
  }
  lines.push(translate('stats.copy.playTime', splitPlayTime(stats?.playMs)));
  lines.push(translate('stats.copy.shots', { shots: clampCount(stats?.shots) }));
  const order = Array.isArray(meta?.modeOrder) ? meta.modeOrder : Object.keys(stats?.modes ?? {});
  for (const mode of order) {
    const entry = stats?.modes?.[mode];
    if (!entry || entry.runs <= 0) {
      continue;
    }
    const best = buildBestText(records?.modes?.[mode], translate);
    lines.push(translate(best ? 'stats.copy.modeLine' : 'stats.copy.modeLineNoBest', {
      mode: meta?.modeLabels?.[mode] ?? mode,
      runs: entry.runs,
      wins: entry.wins,
      quits: entry.quits,
      best
    }));
  }
  if (records?.campaign?.level > 0) {
    lines.push(translate('stats.copy.campaignLine', { level: records.campaign.level, stars: clampCount(records.campaign.stars) }));
  }
  const [hardest] = pickHardestLevels(stats, 1);
  if (hardest) {
    lines.push(translate('stats.copy.hardestLine', { level: hardest.levelId, fails: hardest.fails }));
  }
  lines.push(translate('stats.copy.schemaLine', { version: meta?.schemaVersion }));
  return sanitizeStatsText(lines.join('\n'));
}
