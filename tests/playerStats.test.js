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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { configRegistry } from '../src/core/ConfigRegistry.js';
import { StorageManager, CURRENT_SAVE_SCHEMA_VERSION } from '../src/core/StorageManager.js';
import { i18n } from '../src/core/I18n.js';
import {
  createPlayerStats,
  normalizePlayerStats,
  applyPlayerStatsDelta,
  applyRunOutcome,
  retractRunOutcome,
  pickHardestLevels,
  pickMostLeftLevels,
  buildPlayerStatsText,
  splitPlayTime
} from '../src/game/PlayerStats.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

const cfg = gameConfig.playerStats;
const { prefix, keys } = gameConfig.storage;
const STATS_KEY = `${prefix}${keys.playerStats}`;
const NOW_MS = Date.UTC(2026, 10, 8);
const MS_PER_MINUTE = 60_000;
const CAMPAIGN = 'campaign';
const FLUX = 'flux';

const createFakeStorage = () => {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); },
    clear() { data.clear(); }
  };
};

const withManager = (seed, fn) => {
  const storage = createFakeStorage();
  seed?.(storage);
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    const manager = new StorageManager();
    manager.init();
    return fn(manager, storage);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  }
};

test('an outcome is counted per mode and per level', () => {
  let stats = createPlayerStats(NOW_MS);
  stats = applyRunOutcome(stats, { mode: CAMPAIGN, levelId: 4, outcome: 'win' });
  stats = applyRunOutcome(stats, { mode: CAMPAIGN, levelId: 4, outcome: 'loss' });
  stats = applyRunOutcome(stats, { mode: CAMPAIGN, levelId: 4, outcome: 'quit' });
  stats = applyRunOutcome(stats, { mode: FLUX, outcome: 'loss' });
  assert.deepEqual(stats.modes[CAMPAIGN], { runs: 3, wins: 1, losses: 1, quits: 1 });
  assert.deepEqual(stats.modes[FLUX], { runs: 1, wins: 0, losses: 1, quits: 0 });
  assert.deepEqual([stats.levels['4'].a, stats.levels['4'].f, stats.levels['4'].q], [3, 1, 1]);
  assert.equal(Object.keys(stats.levels).length, 1);
});

test('the input stats are never mutated', () => {
  const stats = createPlayerStats(NOW_MS);
  const frozen = JSON.stringify(stats);
  applyRunOutcome(stats, { mode: CAMPAIGN, levelId: 1, outcome: 'win' });
  assert.equal(JSON.stringify(stats), frozen);
});

test('retracting a loss restores every counter exactly', () => {
  let stats = createPlayerStats(NOW_MS);
  stats = applyRunOutcome(stats, { mode: CAMPAIGN, levelId: 2, outcome: 'win' });
  const before = structuredClone(stats);
  const run = { mode: CAMPAIGN, levelId: 2, outcome: 'loss' };
  const after = retractRunOutcome(applyRunOutcome(stats, run), run);
  assert.deepEqual(after.modes, before.modes);
  assert.deepEqual(
    Object.fromEntries(Object.entries(after.levels).map(([id, e]) => [id, [e.a, e.f, e.q]])),
    Object.fromEntries(Object.entries(before.levels).map(([id, e]) => [id, [e.a, e.f, e.q]]))
  );
});

test('retracting the only outcome of a level removes its entry', () => {
  const run = { mode: CAMPAIGN, levelId: 9, outcome: 'loss' };
  const after = retractRunOutcome(applyRunOutcome(createPlayerStats(NOW_MS), run), run);
  assert.deepEqual(after.levels, {});
  assert.deepEqual(after.modes[CAMPAIGN], { runs: 0, wins: 0, losses: 0, quits: 0 });
});

test('retracting never drives a counter below zero', () => {
  const after = retractRunOutcome(createPlayerStats(NOW_MS), { mode: CAMPAIGN, levelId: 1, outcome: 'loss' });
  assert.deepEqual(after.modes, {});
  assert.deepEqual(after.levels, {});
});

test('unknown outcomes are ignored', () => {
  const stats = createPlayerStats(NOW_MS);
  assert.deepEqual(applyRunOutcome(stats, { mode: CAMPAIGN, outcome: 'draw' }), stats);
  assert.deepEqual(applyRunOutcome(stats, { outcome: 'win' }), stats);
});

test('shots and play time are additive and clamped', () => {
  let stats = applyPlayerStatsDelta(createPlayerStats(NOW_MS), { shots: 25, playMs: 61_000 }, cfg);
  stats = applyPlayerStatsDelta(stats, { shots: 5, playMs: Number.NaN }, cfg);
  assert.deepEqual([stats.shots, stats.playMs], [30, 61_000]);
  stats = applyPlayerStatsDelta(stats, { shots: -1000 }, cfg);
  assert.equal(stats.shots, 0);
  stats = applyPlayerStatsDelta(stats, { shots: Number.MAX_VALUE }, cfg);
  assert.equal(Number.isSafeInteger(stats.shots), true);
});

test('the level map is capped and evicts the least recently touched', () => {
  let stats = createPlayerStats(NOW_MS);
  const total = cfg.maxLevelEntries + 3;
  for (let level = 1; level <= total; level++) {
    stats = applyRunOutcome(stats, { mode: CAMPAIGN, levelId: level, outcome: 'loss' }, cfg);
  }
  assert.equal(Object.keys(stats.levels).length, cfg.maxLevelEntries);
  assert.equal('1' in stats.levels, false);
  assert.equal('3' in stats.levels, false);
  assert.equal('4' in stats.levels, true);
  assert.equal(String(total) in stats.levels, true);
  stats = applyRunOutcome(stats, { mode: CAMPAIGN, levelId: 4, outcome: 'loss' }, cfg);
  stats = applyRunOutcome(stats, { mode: CAMPAIGN, levelId: total + 1, outcome: 'loss' }, cfg);
  assert.equal('4' in stats.levels, true);
  assert.equal('5' in stats.levels, false);
});

test('corrupt stats normalize to a clean object and unsafe keys are dropped', () => {
  assert.deepEqual(normalizePlayerStats('junk', NOW_MS), createPlayerStats(NOW_MS));
  const dirty = JSON.parse('{"shots":-5,"playMs":"x","modes":{"__proto__":{"runs":9},"flux":{"runs":2.9,"wins":-1}},"levels":{"1":{"a":2,"f":9,"q":"z","t":4},"2":5}}');
  const clean = normalizePlayerStats(dirty, NOW_MS);
  assert.equal(clean.shots, 0);
  assert.equal(clean.playMs, 0);
  assert.deepEqual(clean.modes.flux, { runs: 2, wins: 0, losses: 0, quits: 0 });
  assert.equal(Object.keys(clean.modes).length, 1);
  assert.deepEqual(clean.levels, { 1: { a: 2, f: 9, q: 0, t: 4 } });
});

test('hardest and most-left levels are ranked and limited', () => {
  let stats = createPlayerStats(NOW_MS);
  const record = (levelId, outcome, times) => {
    for (let i = 0; i < times; i++) {
      stats = applyRunOutcome(stats, { mode: CAMPAIGN, levelId, outcome });
    }
  };
  record(3, 'loss', 4);
  record(7, 'loss', 6);
  record(5, 'loss', 4);
  record(5, 'win', 2);
  record(9, 'quit', 3);
  record(2, 'quit', 1);
  assert.deepEqual(pickHardestLevels(stats, cfg.topLevelsInSummary).map((e) => e.levelId), ['7', '5', '3']);
  assert.deepEqual(pickHardestLevels(stats, 1), [{ levelId: '7', fails: 6, attempts: 6, quits: 0 }]);
  assert.deepEqual(pickMostLeftLevels(stats, 5).map((e) => e.levelId), ['9', '2']);
  assert.deepEqual(pickHardestLevels(createPlayerStats(NOW_MS), 3), []);
});

test('play time splits into hours and minutes', () => {
  assert.deepEqual(splitPlayTime(0), { hours: 0, minutes: 0 });
  assert.deepEqual(splitPlayTime(61 * MS_PER_MINUTE + 59_000), { hours: 1, minutes: 1 });
  assert.deepEqual(splitPlayTime(-5), { hours: 0, minutes: 0 });
});

test('storage: first write stamps since, deltas accumulate and survive a reload', () => {
  withManager(null, (manager, storage) => {
    assert.deepEqual(manager.getPlayerStats(), createPlayerStats(0));
    manager.applyPlayerStatsDelta({ shots: 25, playMs: MS_PER_MINUTE }, NOW_MS);
    manager.applyPlayerStatsDelta({ shots: 5 }, NOW_MS + 1);
    const stats = manager.getPlayerStats();
    assert.deepEqual([stats.since, stats.shots, stats.playMs], [NOW_MS, 30, MS_PER_MINUTE]);
    assert.deepEqual(JSON.parse(storage.getItem(STATS_KEY)).shots, 30);
  });
});

test('storage: corrupt stored stats read as empty and are overwritten by the next delta', () => {
  withManager((storage) => storage.setItem(STATS_KEY, '{broken'), (manager) => {
    assert.deepEqual(manager.getPlayerStats(), createPlayerStats(0));
    manager.applyPlayerStatsDelta({ shots: 2 }, NOW_MS);
    assert.equal(manager.getPlayerStats().shots, 2);
  });
});

test('storage: the level cap is enforced through the stored delta', () => {
  withManager(null, (manager) => {
    const total = cfg.maxLevelEntries + 2;
    for (let level = 1; level <= total; level++) {
      manager.applyPlayerStatsDelta({ levels: { [level]: { a: 1, f: 1, touch: true } } }, NOW_MS);
    }
    const levels = Object.keys(manager.getPlayerStats().levels);
    assert.equal(levels.length, cfg.maxLevelEntries);
    assert.equal(levels.includes('1'), false);
  });
});

test('summary text is anonymous and free of typographic dashes and curly quotes', () => {
  const dictionaries = { en: loadJson('./locales/en.json'), fr: loadJson('./locales/fr.json') };
  let stats = createPlayerStats(NOW_MS);
  stats = applyRunOutcome(stats, { mode: CAMPAIGN, levelId: 6, outcome: 'loss' });
  stats = applyRunOutcome(stats, { mode: FLUX, outcome: 'win' });
  stats = applyPlayerStatsDelta(stats, { shots: 120, playMs: 90 * MS_PER_MINUTE });
  const records = {
    campaign: { level: 6, stars: 14 },
    modes: { [CAMPAIGN]: { score: 1200 }, [FLUX]: { score: 3400, kind: 'stage', stage: 5 } }
  };
  const forbiddenCodePoints = [
    ...Array.from({ length: 6 }, (_, i) => 0x2010 + i),
    0x2212,
    ...Array.from({ length: 8 }, (_, i) => 0x2018 + i),
    0x00AB,
    0x00BB,
    0x2026,
    0x00A0
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const hasForbidden = (text) => forbiddenCodePoints.some((char) => text.includes(char));
  for (const lang of ['en', 'fr']) {
    i18n.dictionaries.set(lang, dictionaries[lang]);
    i18n.currentLocale = lang;
    const translate = (key, params) => i18n.t(key, params);
    const text = buildPlayerStatsText(stats, records, {
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      sinceLabel: '2026-11-08',
      modeOrder: [CAMPAIGN, FLUX],
      modeLabels: { [CAMPAIGN]: 'Campaign', [FLUX]: 'Flux' }
    }, translate);
    const lines = text.split('\n');
    assert.equal(lines[0], dictionaries[lang].stats.copy.header);
    assert.equal(hasForbidden(text), false, lang);
    assert.equal(/\{\{/.test(text), false, `${lang} placeholders`);
    assert.equal(/undefined/.test(text), false, `${lang} undefined`);
    assert.ok(lines.at(-1).endsWith(String(CURRENT_SAVE_SCHEMA_VERSION)), lang);
    assert.ok(text.includes('1 h 30'), lang);
    assert.ok(text.includes('3400'), lang);
  }
});

test('typographic characters inside translated labels are replaced by ASCII', () => {
  const dash = String.fromCodePoint(0x2014);
  const quote = String.fromCodePoint(0x201C);
  const text = buildPlayerStatsText(createPlayerStats(NOW_MS), {}, { schemaVersion: 1 }, (key) => `${key}${dash}${quote}`);
  assert.equal(text.includes(dash), false);
  assert.equal(text.includes(quote), false);
});

test('summary text leaves out the best of a mode that has no record', () => {
  const dictionaries = { en: loadJson('./locales/en.json'), fr: loadJson('./locales/fr.json') };
  let stats = createPlayerStats(NOW_MS);
  stats = applyRunOutcome(stats, { mode: FLUX, outcome: 'loss' });
  stats = applyRunOutcome(stats, { mode: CAMPAIGN, levelId: 2, outcome: 'win' });
  const records = { campaign: { level: 2, stars: 3 }, modes: { [FLUX]: { score: 0, kind: 'stage', stage: 0 } } };
  for (const lang of ['en', 'fr']) {
    i18n.dictionaries.set(lang, dictionaries[lang]);
    i18n.currentLocale = lang;
    const text = buildPlayerStatsText(stats, records, {
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      modeOrder: [CAMPAIGN, FLUX],
      modeLabels: { [CAMPAIGN]: 'Campaign', [FLUX]: 'Flux' }
    }, (key, params) => i18n.t(key, params));
    const fluxLine = text.split('\n').find((line) => line.startsWith('Flux'));
    const bestWord = i18n.t('modals.stats.overview.bestScore', { score: 0 });
    assert.ok(fluxLine, lang);
    assert.equal(fluxLine.includes(bestWord), false, `${lang}: ${fluxLine}`);
    assert.equal(/,\s*$/.test(fluxLine), false, `${lang}: no dangling separator`);
    assert.equal(/\{\{/.test(text), false, lang);
  }
});
