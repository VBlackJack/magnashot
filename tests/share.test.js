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

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { GAME_MODES, WAVE_TYPES } from '../src/core/Constants.js';
import { i18n, formatNumber } from '../src/core/I18n.js';
import {
  buildDailyShareText,
  buildFluxShareUrl,
  buildShareText,
  formatDailyCountdown,
  getDailyChallengeNumber,
  getMsUntilNextDaily,
  readFluxSeedFromSearch
} from '../src/game/DailyShare.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const shareConfig = loadJson('./configs/game.json').share;
const locales = { en: loadJson('./locales/en.json'), fr: loadJson('./locales/fr.json') };
for (const [locale, dictionary] of Object.entries(locales)) {
  i18n.dictionaries.set(locale, dictionary);
}

// setLocale also translates the page, which does not exist here.
const useLocale = (locale) => {
  i18n.currentLocale = locale;
};

afterEach(() => useLocale('en'));

const DAYS_AFTER_EPOCH = 311;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const dateKeyAfterEpoch = (days) =>
  new Date(Date.parse(shareConfig.epochDateKey) + days * MS_PER_DAY).toISOString().slice(0, shareConfig.epochDateKey.length);

const RUN = Object.freeze({
  dateKey: dateKeyAfterEpoch(DAYS_AFTER_EPOCH),
  mutatorKey: 'hyperGravity',
  wave: 5,
  score: 48300,
  waveLog: [WAVE_TYPES.NORMAL, WAVE_TYPES.GOLD_RUSH, WAVE_TYPES.NORMAL, WAVE_TYPES.BOSS],
  url: shareConfig.url
});

test('The epoch day is challenge 1 and each later UTC day adds one', () => {
  assert.equal(getDailyChallengeNumber(shareConfig.epochDateKey, shareConfig.epochDateKey), 1);
  assert.equal(getDailyChallengeNumber(RUN.dateKey, shareConfig.epochDateKey), DAYS_AFTER_EPOCH + 1);
});

test('The English share text lists challenge, mutator, wave, score, one symbol per wave, then the address', () => {
  useLocale('en');
  const lines = buildDailyShareText(RUN, shareConfig).split('\n');
  const emoji = shareConfig.waveEmoji;
  assert.deepEqual(lines, [
    `MagnaShot - Daily #${DAYS_AFTER_EPOCH + 1} (${locales.en.gameplay.mutators.hyperGravity})`,
    `Wave 5 - ${formatNumber(RUN.score)} pts`,
    [emoji.normal, emoji.goldRush, emoji.normal, emoji.boss].join(''),
    shareConfig.url
  ]);
});

test('The French share text uses French words and number grouping', () => {
  useLocale('fr');
  const lines = buildDailyShareText(RUN, shareConfig).split('\n');
  assert.equal(lines[0], `MagnaShot - Défi #${DAYS_AFTER_EPOCH + 1} (${locales.fr.gameplay.mutators.hyperGravity})`);
  assert.equal(lines[1], `Vague 5 - ${new Intl.NumberFormat('fr').format(RUN.score)} pts`);
  assert.equal(lines.at(-1), shareConfig.url);
});

test('A long run shows the capped symbol row and counts the waves left out', () => {
  const extra = 7;
  const waveLog = Array.from({ length: shareConfig.maxWaveSymbols + extra }, () => WAVE_TYPES.NORMAL);
  const lines = buildDailyShareText({ ...RUN, waveLog }, shareConfig).split('\n');
  const capped = shareConfig.waveEmoji.normal.repeat(shareConfig.maxWaveSymbols);
  assert.equal(lines[2], `${capped} +${extra}`);
});

test('A run lost before any wave has no symbol row, and a run without a mutator still gets a header', () => {
  const lines = buildDailyShareText({ ...RUN, mutatorKey: null, wave: 1, waveLog: [] }, shareConfig).split('\n');
  assert.deepEqual(lines, [`MagnaShot - Daily #${DAYS_AFTER_EPOCH + 1}`, 'Wave 1 - 48,300 pts', shareConfig.url]);
});

const SURVIVAL_RUN = Object.freeze({
  mode: GAME_MODES.ENDLESS,
  wave: 12,
  score: 48300,
  waveLog: [WAVE_TYPES.NORMAL, WAVE_TYPES.BOSS, WAVE_TYPES.GOLD_RUSH],
  url: shareConfig.url
});

const FLUX_RUN = Object.freeze({
  mode: GAME_MODES.FLUX,
  stage: 7,
  score: 125400,
  url: shareConfig.url
});

const formatFrench = (value) => new Intl.NumberFormat('fr').format(value);

test('The Daily mode of buildShareText gives the Daily Challenge text', () => {
  const run = { ...RUN, mode: GAME_MODES.DAILY };
  assert.equal(buildShareText(run, shareConfig), buildDailyShareText(run, shareConfig));
});

test('The English Survival text lists header, wave and score, one symbol per wave, then the address', () => {
  useLocale('en');
  const lines = buildShareText(SURVIVAL_RUN, shareConfig).split('\n');
  const emoji = shareConfig.waveEmoji;
  assert.deepEqual(lines, [
    locales.en.share.survival.header,
    `Wave ${SURVIVAL_RUN.wave} - ${formatNumber(SURVIVAL_RUN.score)} pts`,
    [emoji[WAVE_TYPES.NORMAL], emoji[WAVE_TYPES.BOSS], emoji[WAVE_TYPES.GOLD_RUSH]].join(''),
    shareConfig.url
  ]);
});

test('The French Survival text uses French words and number grouping', () => {
  useLocale('fr');
  const lines = buildShareText(SURVIVAL_RUN, shareConfig).split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], locales.fr.share.survival.header);
  assert.equal(lines[1], `Vague ${SURVIVAL_RUN.wave} - ${formatFrench(SURVIVAL_RUN.score)} pts`);
  assert.equal(lines.at(-1), shareConfig.url);
});

test('A Survival run lost before any wave has no symbol row', () => {
  const lines = buildShareText({ ...SURVIVAL_RUN, wave: 1, waveLog: [] }, shareConfig).split('\n');
  assert.deepEqual(lines, [locales.en.share.survival.header, 'Wave 1 - 48,300 pts', shareConfig.url]);
  const withoutLog = buildShareText({ ...SURVIVAL_RUN, waveLog: undefined }, shareConfig).split('\n');
  assert.equal(withoutLog.length, 3);
});

test('The Flux text holds the shape reached and never a symbol row', () => {
  useLocale('en');
  const lines = buildShareText({ ...FLUX_RUN, waveLog: SURVIVAL_RUN.waveLog }, shareConfig).split('\n');
  assert.deepEqual(lines, [
    locales.en.share.flux.header,
    `Shape ${FLUX_RUN.stage} - ${formatNumber(FLUX_RUN.score)} pts`,
    shareConfig.url
  ]);
  useLocale('fr');
  const frenchLines = buildShareText(FLUX_RUN, shareConfig).split('\n');
  assert.deepEqual(frenchLines, [
    locales.fr.share.flux.header,
    `Forme ${FLUX_RUN.stage} - ${formatFrench(FLUX_RUN.score)} pts`,
    shareConfig.url
  ]);
});

test('A mode without a shareable result throws a RangeError naming it', () => {
  assert.throws(() => buildShareText({ ...SURVIVAL_RUN, mode: GAME_MODES.CAMPAIGN }, shareConfig), {
    name: 'RangeError',
    message: new RegExp(GAME_MODES.CAMPAIGN)
  });
  assert.throws(() => buildShareText({ ...SURVIVAL_RUN, mode: 'unknown' }, shareConfig), RangeError);
});

const MS_PER_MINUTE = 60 * 1000;

test('The next Daily starts at the next UTC midnight, a full day away on the boundary itself', () => {
  const halfHourMinutes = 30;
  assert.equal(getMsUntilNextDaily(Date.UTC(2026, 9, 28, 23, 30)), halfHourMinutes * MS_PER_MINUTE);
  assert.equal(getMsUntilNextDaily(Date.UTC(2026, 9, 29)), MS_PER_DAY);
});

test('The Daily countdown rounds up to the minute and reads zero only when no time remains', () => {
  const ninetyMinutes = 90 * MS_PER_MINUTE;
  assert.deepEqual(formatDailyCountdown(ninetyMinutes + 1), { hours: 1, minutes: 31 });
  assert.deepEqual(formatDailyCountdown(1), { hours: 0, minutes: 1 });
  assert.deepEqual(formatDailyCountdown(0), { hours: 0, minutes: 0 });
  assert.deepEqual(formatDailyCountdown(MS_PER_DAY), { hours: 24, minutes: 0 });
});

test('Flux share text includes seed header and ?flux=<seed> link when seed is provided, and readFluxSeedFromSearch validates bounds', () => {
  const fluxSeedConfig = loadJson('./configs/flux.json').seed;
  useLocale('en');
  const linesEn = buildShareText({ ...FLUX_RUN, seed: 'k9x4m2' }, shareConfig).split('\n');
  assert.deepEqual(linesEn, [
    'MagnaShot - Flux Mode (#k9x4m2)',
    `Shape ${FLUX_RUN.stage} - ${formatNumber(FLUX_RUN.score)} pts`,
    buildFluxShareUrl(shareConfig.url, 'k9x4m2')
  ]);

  useLocale('fr');
  const linesFr = buildShareText({ ...FLUX_RUN, seed: 'k9x4m2' }, shareConfig).split('\n');
  assert.deepEqual(linesFr, [
    'MagnaShot - Mode Flux (#k9x4m2)',
    `Forme ${FLUX_RUN.stage} - ${formatFrench(FLUX_RUN.score)} pts`,
    `${shareConfig.url}?flux=k9x4m2`
  ]);

  assert.equal(readFluxSeedFromSearch('?flux=K9X4M2', fluxSeedConfig), 'k9x4m2');
  assert.equal(readFluxSeedFromSearch('?flux=0', fluxSeedConfig), null);
  assert.equal(readFluxSeedFromSearch('?flux=abc-12', fluxSeedConfig), null);
  assert.equal(readFluxSeedFromSearch('?flux=1000000', fluxSeedConfig), null);
  assert.equal(readFluxSeedFromSearch('', fluxSeedConfig), null);
});

test('buildShareText formats shareable results for Puzzle, Blitz, Boss Rush, and Cascade modes in English and French', () => {
  useLocale('en');
  assert.deepEqual(
    buildShareText({ mode: GAME_MODES.PUZZLE, puzzleStage: 3, score: 4200, url: shareConfig.url }, shareConfig).split('\n'),
    [locales.en.share.puzzle.header, 'Stage 3 - 4,200 pts', shareConfig.url]
  );
  assert.deepEqual(
    buildShareText(
      { mode: GAME_MODES.BLITZ, wave: 4, score: 9800, waveLog: [WAVE_TYPES.NORMAL, WAVE_TYPES.GOLD_RUSH], url: shareConfig.url },
      shareConfig
    ).split('\n'),
    [
      locales.en.share.blitz.header,
      'Wave 4 - 9,800 pts',
      `${shareConfig.waveEmoji.normal}${shareConfig.waveEmoji.goldRush}`,
      shareConfig.url
    ]
  );
  assert.deepEqual(
    buildShareText({ mode: GAME_MODES.BOSS_RUSH, wave: 2, score: 15400, url: shareConfig.url }, shareConfig).split('\n'),
    [locales.en.share.bossRush.header, 'Wave 2 - 15,400 pts', shareConfig.url]
  );
  assert.deepEqual(
    buildShareText({ mode: GAME_MODES.CASCADE, wave: 6, score: 11250, url: shareConfig.url }, shareConfig).split('\n'),
    [locales.en.share.cascade.header, 'Wave 6 - 11,250 pts', shareConfig.url]
  );

  useLocale('fr');
  assert.deepEqual(
    buildShareText({ mode: GAME_MODES.PUZZLE, puzzleStage: 3, score: 4200, url: shareConfig.url }, shareConfig).split('\n'),
    [locales.fr.share.puzzle.header, `Niveau 3 - ${formatFrench(4200)} pts`, shareConfig.url]
  );
  assert.deepEqual(
    buildShareText({ mode: GAME_MODES.BOSS_RUSH, wave: 2, score: 15400, url: shareConfig.url }, shareConfig).split('\n'),
    [locales.fr.share.bossRush.header, `Vague 2 - ${formatFrench(15400)} pts`, shareConfig.url]
  );
  assert.deepEqual(
    buildShareText({ mode: GAME_MODES.CASCADE, wave: 6, score: 11250, url: shareConfig.url }, shareConfig).split('\n'),
    [locales.fr.share.cascade.header, `Vague 6 - ${formatFrench(11250)} pts`, shareConfig.url]
  );
});

test('the Weekly Flux text uses the weekly header with the week key and the seed', () => {
  const fluxRun = { mode: GAME_MODES.FLUX, stage: 4, score: 9100, seed: 'k9x4m2', url: shareConfig.url };
  assert.deepEqual(
    buildShareText({ ...fluxRun, isWeekly: true, weekKey: '2026-W45' }, shareConfig).split('\n'),
    [
      'MagnaShot Weekly Flux 2026-W45 #k9x4m2',
      'Shape 4 - 9,100 pts',
      buildFluxShareUrl(shareConfig.url, 'k9x4m2')
    ]
  );
  const assisted = buildShareText(
    { ...fluxRun, isWeekly: true, weekKey: '2026-W45', workshopLevels: 3, ammoBought: 1, continues: 1 },
    shareConfig
  ).split('\n');
  assert.equal(assisted.length, 4);
  assert.match(assisted[2], /Workshop \+3/);
  // Without the week key the plain seeded header is used.
  assert.equal(buildShareText({ ...fluxRun, isWeekly: true }, shareConfig).split('\n')[0], 'MagnaShot - Flux Mode (#k9x4m2)');
  useLocale('fr');
  assert.equal(
    buildShareText({ ...fluxRun, isWeekly: true, weekKey: '2026-W45' }, shareConfig).split('\n')[0],
    locales.fr.share.flux.weeklyHeader.replace('{{week}}', '2026-W45').replace('{{seed}}', 'k9x4m2')
  );
});
