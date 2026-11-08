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

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GAME_MODES } from '../src/core/Constants.js';
import { i18n, t, formatNumber } from '../src/core/I18n.js';
import { getUtcIsoWeekKey } from '../src/game/WeeklyFlux.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { UIManager } from '../src/ui/UIManager.js';
import {
  ARCADE_CARD_SPECS,
  MODE_NAME_KEYS,
  describeModeLock,
  formatUnlockedModesText,
  isAriaDisabled,
  isCurrentWeeklyRun,
  isModeUnlocked,
  plainModeName,
  setModeLabel
} from '../src/ui/UIHelpers.js';
import {
  STATS_TABS,
  buildDailyHistoryRows,
  buildDailyHistorySummary,
  buildStatsOverview,
  formatModeBest,
  formatStatsDate
} from '../src/ui/UIStats.js';

const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const locales = { en: loadJson('./locales/en.json'), fr: loadJson('./locales/fr.json') };
for (const [locale, dictionary] of Object.entries(locales)) {
  i18n.dictionaries.set(locale, dictionary);
}
// setLocale also translates the page, which does not exist here.
const useLocale = (locale) => {
  i18n.currentLocale = locale;
};
afterEach(() => useLocale('en'));
useLocale('en');

/** Typographic characters the repository refuses, by code point (never as literals). */
const REFUSED_CODE_POINTS = [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x00ab, 0x00bb];
const assertPlainTypography = (text, label) => {
  for (const codePoint of REFUSED_CODE_POINTS) {
    assert.ok(!text.includes(String.fromCodePoint(codePoint)), `${label}: no U+${codePoint.toString(16)}`);
  }
};

/** A DOM element reduced to what the mode-lock code touches. */
function fakeElement(className = '') {
  const classes = new Set(className.split(' ').filter(Boolean));
  const attributes = new Map();
  let ownText = '';
  let children = [];
  const element = {
    isConnected: true,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const on = force ?? !classes.has(name);
        if (on) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return on;
      }
    },
    set className(value) {
      classes.clear();
      value.split(' ').filter(Boolean).forEach((name) => classes.add(name));
    },
    get textContent() {
      return ownText + children.map((child) => (typeof child === 'string' ? child : child.textContent)).join('');
    },
    set textContent(value) {
      ownText = String(value);
      children = [];
    },
    append(...nodes) {
      children.push(...nodes);
    },
    querySelector(selector) {
      const wanted = selector.replace(/^\./, '');
      return children.find((child) => typeof child !== 'string' && child.classList.contains(wanted)) ?? null;
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null,
    removeAttribute: (name) => attributes.delete(name),
    hasAttribute: (name) => attributes.has(name),
    addEventListener() {},
    focus() {}
  };
  return element;
}

/** An arcade card with its title, description and best-score children. */
function fakeCard() {
  const card = fakeElement('arcade-mode-card');
  const title = fakeElement('arcade-card-title');
  const desc = fakeElement('arcade-card-desc');
  card.querySelector = (selector) => (selector === '.arcade-card-title' ? title : selector === '.arcade-card-desc' ? desc : null);
  return { card, title, desc };
}

const LOCKED_ACCESS = Object.freeze({
  endless: { unlocked: false, isNew: false, requiredLevel: 3 },
  puzzle: { unlocked: false, isNew: false, requiredLevel: 5 },
  blitz: { unlocked: false, isNew: false, requiredLevel: 7 },
  flux: { unlocked: false, isNew: false, requiredLevel: 8 },
  cascade: { unlocked: false, isNew: false, requiredLevel: 10 },
  boss_rush: { unlocked: false, isNew: false, requiredLevel: 12 }
});

/** Runs a body with a minimal global document that can create elements. */
function withDocument(body) {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => fakeElement() };
  try {
    return body();
  } finally {
    globalThis.document = previous;
  }
}

function makeUi({ access = {}, engine = {}, storage = {}, elements = {} } = {}) {
  const ui = Object.create(UIManager.prototype);
  ui.gameConfig = gameConfig;
  ui.storageManager = { getModeAccess: () => access, ...storage };
  ui.engine = { fluxConfig: { seed: { length: 6, alphabet: 'abcdefghijklmnopqrstuvwxyz0123456789' } }, ...engine };
  ui.elements = elements;
  return ui;
}

test('plainModeName drops the leading emoji and keeps the words', () => {
  assert.equal(plainModeName('🎯 Puzzle'), 'Puzzle');
  assert.equal(plainModeName('⏱ Blitz 90s'), 'Blitz 90s');
  assert.equal(plainModeName('Survival'), 'Survival');
  assert.equal(plainModeName(''), '');
});

test('every gated mode has a name key present in both locales', () => {
  for (const mode of Object.keys(gameConfig.modeUnlocks.campaignLevelCleared)) {
    const key = MODE_NAME_KEYS[mode];
    assert.ok(key, `${mode} has a name key`);
    for (const dictionary of Object.values(locales)) {
      const value = key.split('.').reduce((node, part) => node?.[part], dictionary);
      assert.equal(typeof value, 'string', `${mode}: ${key}`);
    }
  }
});

test('describeModeLock states what a locked, a new and an open mode show', () => {
  const locked = describeModeLock(GAME_MODES.ENDLESS, LOCKED_ACCESS, t);
  assert.equal(locked.isLocked, true);
  assert.equal(locked.label, '🔒 Survival');
  assert.equal(locked.ariaLabel, 'Survival, locked. Clear campaign level 3 to unlock it.');
  assert.equal(locked.hint, 'Clear campaign level 3 to unlock Survival.');

  const fresh = describeModeLock(GAME_MODES.PUZZLE, { puzzle: { unlocked: true, isNew: true, requiredLevel: 5 } }, t);
  assert.equal(fresh.isLocked, false);
  assert.equal(fresh.isNew, true);
  assert.equal(fresh.newBadge, 'New');
  assert.equal(fresh.newAria, 'Puzzle, newly unlocked');

  const open = describeModeLock(GAME_MODES.BLITZ, { blitz: { unlocked: true, isNew: false, requiredLevel: 7 } }, t);
  assert.deepEqual([open.isLocked, open.isNew, open.label, open.ariaLabel, open.newBadge], [false, false, '', '', '']);

  const unknown = describeModeLock(GAME_MODES.CAMPAIGN, {}, t);
  assert.equal(unknown.isLocked, false);
  useLocale('fr');
  assert.match(describeModeLock(GAME_MODES.FLUX, LOCKED_ACCESS, t).ariaLabel, /8/);
});

test('a missing access entry never blocks a start', () => {
  assert.equal(isModeUnlocked({}, GAME_MODES.ENDLESS), true);
  assert.equal(isModeUnlocked(undefined, GAME_MODES.ENDLESS), true);
  assert.equal(isModeUnlocked(LOCKED_ACCESS, GAME_MODES.ENDLESS), false);
  assert.equal(isModeUnlocked({ endless: { unlocked: true } }, GAME_MODES.ENDLESS), true);
});

test('the victory unlock line names one mode or lists several', () => {
  assert.equal(formatUnlockedModesText(['endless'], t), 'New mode unlocked: Survival. Find it in the menu.');
  assert.match(formatUnlockedModesText(['puzzle', 'blitz'], t), /^New modes unlocked: Puzzle.+Blitz 90s\. Find them in the menu\.$/);
  assert.equal(formatUnlockedModesText([], t), '');
  assert.equal(formatUnlockedModesText(undefined, t), '');
  assert.equal(formatUnlockedModesText(['campaign'], t), '');
});

test('setModeLabel adds the New badge once and removes it again', () => {
  withDocument(() => {
    const button = fakeElement();
    setModeLabel(button, 'Survival', 'New');
    assert.equal(button.textContent, 'Survival New');
    assert.ok(button.querySelector('.mode-new-badge'));
    const badge = button.querySelector('.mode-new-badge');
    setModeLabel(button, 'Survival', 'New');
    assert.equal(button.querySelector('.mode-new-badge'), badge, 'unchanged content is not rebuilt');
    setModeLabel(button, 'Survival', '');
    assert.equal(button.textContent, 'Survival');
    assert.equal(button.querySelector('.mode-new-badge'), null);
  });
});

test('refreshModeLocks locks the menu buttons and the arcade cards with aria-disabled, never disabled', () => {
  withDocument(() => {
    const cards = Object.fromEntries(Object.keys(ARCADE_CARD_SPECS).map((mode) => [mode, fakeCard()]));
    const elements = {
      btnEndless: fakeElement(),
      btnFlux: fakeElement(),
      btnWeekly: fakeElement(),
      puzzleStagesStrip: fakeElement()
    };
    for (const [mode, spec] of Object.entries(ARCADE_CARD_SPECS)) {
      elements[spec.card] = cards[mode].card;
      elements[spec.best] = fakeElement();
    }
    const ui = makeUi({ elements });
    ui.getWeeklyButtonLabel = () => 'Weekly Flux';
    ui.refreshModeLocks(LOCKED_ACCESS);

    assert.equal(elements.btnEndless.textContent, '🔒 Survival');
    assert.equal(elements.btnWeekly.textContent, '🔒 Weekly Flux', 'Weekly Flux locks together with Flux');
    assert.equal(elements.btnFlux.textContent, '🔒 Flux Mode');
    for (const key of ['btnEndless', 'btnFlux', 'btnWeekly']) {
      assert.ok(isAriaDisabled(elements[key]), `${key} is aria-disabled`);
      assert.ok(elements[key].classList.contains('is-locked'));
      assert.equal(elements[key].hasAttribute('disabled'), false, `${key} stays focusable`);
      assert.ok(elements[key].getAttribute('aria-label').includes('locked'));
    }
    assert.equal(elements.btnWeekly.getAttribute('aria-label'), 'Weekly Flux, locked. Clear campaign level 8 to unlock it.');
    assert.equal(cards.puzzle.title.textContent, '🔒 Puzzle');
    assert.equal(cards.puzzle.desc.textContent, 'Clear level 5 to unlock');
    assert.ok(elements.arcadeBestPuzzle.classList.contains('hidden'), 'the best line is hidden while locked');
    assert.ok(elements.puzzleStagesStrip.classList.contains('hidden'), 'the stage strip is hidden while Puzzle is locked');
    assert.equal(cards.boss_rush.card.getAttribute('aria-label'), 'Boss Rush, locked. Clear campaign level 12 to unlock it.');

    // Everything earned: labels return, the badge shows only on the newly unlocked mode.
    const open = Object.fromEntries(
      Object.entries(LOCKED_ACCESS).map(([mode, entry]) => [mode, { ...entry, unlocked: true, isNew: mode === 'flux' }])
    );
    ui.refreshModeLocks(open);
    assert.equal(elements.btnEndless.textContent, 'Survival');
    assert.equal(isAriaDisabled(elements.btnEndless), false);
    assert.equal(elements.btnFlux.textContent, 'Flux Mode New');
    assert.equal(elements.btnFlux.getAttribute('aria-label'), 'Flux Mode, newly unlocked');
    assert.equal(elements.btnWeekly.textContent, 'Weekly Flux', 'Weekly Flux never carries the New badge');
    assert.equal(elements.btnWeekly.getAttribute('aria-label'), null);
    assert.equal(cards.puzzle.title.textContent, '🎯 Puzzle');
    assert.equal(cards.puzzle.desc.textContent, gameConfigDescription('puzzleDesc'));
    assert.equal(elements.arcadeBestPuzzle.classList.contains('hidden'), false);
    assert.equal(elements.puzzleStagesStrip.classList.contains('hidden'), false);
  });
});

function gameConfigDescription(key) {
  return locales.en.modals.levelSelect.arcade[key];
}

test('a locked mode starts nothing and says what to do; an open one starts', () => {
  const hint = fakeElement('hidden');
  const started = [];
  const ui = makeUi({
    access: LOCKED_ACCESS,
    elements: { navModeLockHint: hint, modalLevels: fakeElement('hidden'), levelsChapterHint: fakeElement('hidden') }
  });
  assert.equal(ui.runIfModeUnlocked(GAME_MODES.ENDLESS, () => started.push('endless')), false);
  assert.deepEqual(started, []);
  assert.equal(hint.classList.contains('hidden'), false, 'the status line is revealed');
  assert.equal(hint.textContent, 'Clear campaign level 3 to unlock Survival.');

  ui.storageManager.getModeAccess = () => ({ endless: { unlocked: true, isNew: false, requiredLevel: 3 } });
  assert.equal(ui.runIfModeUnlocked(GAME_MODES.ENDLESS, () => started.push('endless')), true);
  assert.deepEqual(started, ['endless']);
});

test('inside the level select the lock hint uses the dialog status line', () => {
  const levelsHint = fakeElement('hidden');
  const navHint = fakeElement('hidden');
  const ui = makeUi({
    access: LOCKED_ACCESS,
    elements: { navModeLockHint: navHint, modalLevels: fakeElement(), levelsChapterHint: levelsHint }
  });
  ui.runIfModeUnlocked(GAME_MODES.BOSS_RUSH, () => assert.fail('boss rush is locked'));
  assert.equal(levelsHint.textContent, 'Clear campaign level 12 to unlock Boss Rush.');
  assert.equal(navHint.classList.contains('hidden'), true);
});

test('the drawer stays open when a locked mode is activated', () => {
  const lockedButton = fakeElement();
  lockedButton.setAttribute('aria-disabled', 'true');
  const openButton = fakeElement();
  const handlers = new Map();
  for (const button of [lockedButton, openButton]) {
    button.addEventListener = (type, fn) => handlers.set(button, fn);
  }
  const closes = [];
  const ui = makeUi({
    elements: { drawer: { querySelectorAll: () => [lockedButton, openButton] }, btnMenu: null, drawerBackdrop: null, btnCloseDrawer: null }
  });
  ui.closeDrawer = (options) => closes.push(options);
  ui.bindDrawerEvents();
  handlers.get(lockedButton)();
  assert.deepEqual(closes, [], 'a locked button leaves the drawer open');
  handlers.get(openButton)();
  assert.deepEqual(closes, [{ resume: false }]);
});

test('the Weekly Flux button starts this week through the engine, or the shared seed path without it', () => {
  const calls = [];
  const ui = makeUi({ engine: { startWeeklyFlux: (options) => calls.push(['weekly', options]) } });
  ui.startWeeklyFluxRun();
  assert.deepEqual(calls, [['weekly', { isRestart: false }]]);

  const fallbackCalls = [];
  const bare = makeUi({ engine: { startFluxRun: (seed, options) => fallbackCalls.push([seed, options]) } });
  bare.startWeeklyFluxRun();
  assert.equal(fallbackCalls.length, 1);
  assert.match(fallbackCalls[0][0], /^[0-9a-z]{6}$/);
  assert.deepEqual(fallbackCalls[0][1], { isShared: true });
});

test('the Weekly Flux label shows the best, then the unclaimed bonus, then the plain name', () => {
  const best = makeUi({ storage: { getWeeklyFluxBest: () => ({ score: 4200 }) } });
  assert.equal(best.getWeeklyButtonLabel(), `Weekly Flux ✓ ${formatNumber(4200)}`);

  const unclaimed = makeUi({
    storage: { getWeeklyFluxBest: () => null, hasClaimedWeeklyFluxBonus: () => false }
  });
  assert.equal(unclaimed.getWeeklyButtonLabel(), `Weekly Flux +${gameConfig.weeklyFlux.firstPlayBonusCoins} ⬡`);

  const claimed = makeUi({
    storage: {
      getWeeklyFluxBest: () => null,
      hasClaimedWeeklyFluxBonus: (weekKey) => weekKey === getUtcIsoWeekKey(Date.now())
    }
  });
  assert.equal(claimed.getWeeklyButtonLabel(), 'Weekly Flux');
});

test('the stats overview lists play time, shots, modes with their best and the campaign notes', () => {
  const stats = {
    since: Date.UTC(2026, 10, 2),
    shots: 1234,
    playMs: (2 * 60 + 5) * 60_000,
    modes: {
      campaign: { runs: 10, wins: 6, losses: 3, quits: 1 },
      flux: { runs: 4, wins: 0, losses: 4, quits: 0 }
    },
    levels: { 7: { a: 5, f: 4, q: 1, t: 3 }, 9: { a: 3, f: 0, q: 2, t: 4 } }
  };
  const records = {
    campaign: { level: 12, stars: 20 },
    modes: { flux: { score: 9000, kind: 'stage', stage: 5 }, endless: { score: 0 } }
  };
  const overview = buildStatsOverview(stats, records, {
    translate: t,
    format: formatNumber,
    modeOrder: gameConfig.modeUnlocks.order,
    locale: 'en'
  });
  assert.equal(overview.isEmpty, false);
  assert.match(overview.since, /^Recorded since .*2026/);
  assert.deepEqual(overview.general[0], { label: 'Play time', value: '2 h 5 min' });
  assert.deepEqual(overview.modes.map((mode) => mode.mode), ['campaign', 'flux']);
  assert.equal(overview.modes[0].name, 'Levels');
  assert.equal(overview.modes[0].runs, '10 runs, 6 wins, 1 left');
  assert.equal(overview.modes[0].best, '', 'no best line without a score');
  assert.equal(overview.modes[1].best, `Best ${formatNumber(9000)}, shape 5`);
  assert.deepEqual(overview.notes, [
    'Level 12 reached, 20 ★',
    'Hardest level for you: 7 (4 failed attempts)',
    'Most often left: level 9 (2 times)'
  ]);
  for (const text of [overview.since, ...overview.notes, ...overview.modes.map((mode) => mode.runs)]) {
    assertPlainTypography(text, text);
  }
});

test('a player without stats sees the empty message, and a wave record names the wave', () => {
  const empty = buildStatsOverview({}, { campaign: { level: 0, stars: 0 }, modes: {} }, {
    translate: t,
    format: formatNumber,
    modeOrder: gameConfig.modeUnlocks.order,
    locale: 'en'
  });
  assert.equal(empty.isEmpty, true);
  assert.equal(empty.since, '');
  assert.equal(formatModeBest({ score: 700, kind: 'wave', wave: 4 }, t, formatNumber), 'Best 700, wave 4');
  assert.equal(formatModeBest({ score: 0 }, t, formatNumber), '');
});

test('a grandfathered player with records but no run counters still sees the bests', () => {
  const overview = buildStatsOverview({}, { campaign: { level: 5, stars: 9 }, modes: { blitz: { score: 300 } } }, {
    translate: t,
    format: formatNumber,
    modeOrder: gameConfig.modeUnlocks.order,
    locale: 'en'
  });
  assert.equal(overview.isEmpty, false);
  assert.deepEqual(overview.modes.map((mode) => [mode.mode, mode.runs, mode.best]), [['blitz', '', 'Best 300']]);
});

test('Daily history rows give date, number, mutator, score, wave and streak with dashes for unknowns', () => {
  const epochDateKey = gameConfig.share.epochDateKey;
  const rows = buildDailyHistoryRows(
    [
      { d: '2026-11-07', s: 5200, w: 6, m: 'hyperGravity', k: 4, g: false },
      { d: '2026-11-06', s: 3100, w: 3, m: null, k: 3, g: true },
      { d: '2026-11-01', s: 900, w: null, m: null, k: null, g: false }
    ],
    { translate: t, format: formatNumber, locale: 'en', epochDateKey }
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].challenge, formatNumber(13));
  assert.equal(rows[0].streak, '4 days');
  assert.equal(rows[0].wave, '6');
  assert.equal(rows[1].streak, '3 days, grace day used');
  assert.equal(rows[1].mutator, '-');
  assert.equal(rows[2].wave, '-');
  assert.equal(rows[2].streak, '-');
  assert.equal(formatStatsDate('2026-11-07', 'en'), 'Nov 7, 2026');
});

test('the Daily history summary counts the days played inside the window and names the best day', () => {
  const history = [
    { d: '2026-11-07', s: 1000 },
    { d: '2026-11-05', s: 4000 },
    { d: '2026-08-01', s: 9000 }
  ];
  assert.deepEqual(buildDailyHistorySummary(history, '2026-11-07', 60), {
    played: 2,
    days: 60,
    bestScore: 9000,
    bestDate: '2026-08-01'
  });
  assert.equal(buildDailyHistorySummary([], '2026-11-07', 60), null);
});

test('the stats text is anonymous, in the player language and ends with the save schema version', () => {
  const ui = makeUi({
    storage: {
      getPlayerStats: () => ({
        since: Date.UTC(2026, 10, 2),
        shots: 40,
        playMs: 3_600_000,
        modes: { endless: { runs: 2, wins: 0, losses: 2, quits: 0 } },
        levels: {}
      }),
      getUnlockedLevel: () => 4,
      getTotalStars: () => 7,
      getEndlessHighScore: () => 1500,
      getDailyHistory: () => []
    }
  });
  const text = ui.buildStatsText();
  const lines = text.split('\n');
  assert.equal(lines[0], 'MagnaShot stats (anonymous, no personal data)');
  assert.ok(lines.some((line) => line.startsWith('Survival: 2 runs')));
  assert.match(lines.at(-1), /^Save schema \d+$/);
  assertPlainTypography(text, 'stats text');
  assert.ok(!/userAgent|Mozilla/i.test(text));
  useLocale('fr');
  assert.match(ui.buildStatsText().split('\n').at(-1), /\d+$/);
});

test('copying the stats writes the text to the clipboard and confirms; a refusal shows the manual field', async () => {
  const written = [];
  const previousNavigator = globalThis.navigator;
  const makeStatsUi = () => {
    const field = Object.assign(fakeElement(), { value: '', select() {} });
    const elements = {
      statsCopyFeedback: fakeElement('hidden'),
      statsCopyFallback: fakeElement('hidden'),
      statsCopyText: field,
      btnCopyStats: fakeElement()
    };
    const ui = makeUi({ elements });
    ui.buildStatsText = () => 'stats body';
    return { ui, elements, field };
  };
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText: async (text) => written.push(text) } }
    });
    const ok = makeStatsUi();
    await ok.ui.copyPlayerStats();
    assert.deepEqual(written, ['stats body']);
    assert.equal(ok.ui.statsCopied, true);
    assert.equal(ok.elements.btnCopyStats.textContent, 'Copied');
    assert.equal(ok.elements.statsCopyFeedback.textContent, 'Stats copied.');
    assert.equal(ok.elements.statsCopyFallback.classList.contains('hidden'), true);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: async () => {
            throw new Error('denied');
          }
        }
      }
    });
    const refused = makeStatsUi();
    await refused.ui.copyPlayerStats();
    assert.equal(refused.field.value, 'stats body');
    assert.equal(refused.elements.statsCopyFallback.classList.contains('hidden'), false);
    assert.equal(refused.elements.statsCopyFeedback.textContent, 'Select the text below to copy it.');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });
  }
});

test('stats tabs switch with aria-selected and a roving tabindex', () => {
  const overviewTab = fakeElement('modal-tab active');
  const dailyTab = fakeElement('modal-tab');
  const overviewPane = fakeElement();
  const dailyPane = fakeElement('hidden');
  const ui = makeUi({
    elements: {
      tabStatsOverview: overviewTab,
      tabStatsDaily: dailyTab,
      statsOverviewPane: overviewPane,
      statsDailyPane: dailyPane
    }
  });
  ui.switchStatsTab(STATS_TABS.DAILY);
  assert.equal(dailyTab.getAttribute('aria-selected'), 'true');
  assert.equal(overviewTab.getAttribute('aria-selected'), 'false');
  assert.equal(dailyTab.tabIndex, 0);
  assert.equal(overviewTab.tabIndex, -1);
  assert.equal(overviewPane.classList.contains('hidden'), true);
  assert.equal(dailyPane.classList.contains('hidden'), false);
  ui.switchStatsTab('unknown');
  assert.equal(ui.activeStatsTab, STATS_TABS.OVERVIEW, 'an unknown tab falls back to Overview');
});

const html = readFileSync('./index.html', 'utf8');
const css = readFileSync('./styles/main.css', 'utf8');

test('the page carries the mode lock hint, the weekly button, the stats window and the History button', () => {
  assert.match(html, /<button id="btn-flux"[^>]*>[\s\S]{0,40}<\/button>\s*<button id="btn-weekly"[^>]*data-closes-drawer/);
  assert.match(html, /<p id="nav-mode-lock-hint" class="nav-lock-hint hidden" role="status" aria-live="polite"><\/p>\s*<\/div>/);
  assert.match(html, /<\/dl>\s*<button id="btn-stats"[^>]*data-closes-drawer/);
  assert.match(html, /<p id="victory-unlock" class="modal-subtext hidden">/);
  assert.match(html, /<button id="btn-daily-history-gameover"[^>]*class="modal-btn hidden"/);
  assert.match(html, /<div id="modal-stats"[^>]*role="dialog" aria-modal="true" aria-labelledby="modal-stats-title"/);
  assert.match(html, /<div class="modal-tabs" role="tablist">\s*<button id="tab-stats-overview"[^>]*role="tab"[^>]*aria-controls="stats-overview-pane"/);
  assert.match(html, /<caption id="stats-daily-caption">/);
  assert.match(html, /<textarea id="stats-copy-text"[^>]*readonly>/);
  assert.match(html, /<button id="btn-copy-stats"/);
  assert.match(html, /<button id="btn-close-stats"/);
});

test('every data-i18n key the new markup uses exists in both locales', () => {
  const block = html.slice(html.indexOf('<!-- Stats Modal -->'), html.indexOf('<!-- Confirm Action Modal -->'));
  const keys = [...block.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]);
  keys.push('app.nav.button.weekly', 'app.drawer.button.stats', 'modals.gameOver.button.dailyHistory');
  assert.ok(keys.length > 10);
  for (const key of keys) {
    for (const [locale, dictionary] of Object.entries(locales)) {
      const value = key.split('.').reduce((node, part) => node?.[part], dictionary);
      assert.equal(typeof value, 'string', `${locale}: ${key}`);
    }
  }
});

test('locked controls use a dashed border and a real text color, never opacity', () => {
  const rule = css.match(/\.nav-btn\.is-locked,\s*\.arcade-mode-card\.is-locked \{[^}]*\}/);
  assert.ok(rule, 'a shared locked rule exists');
  assert.match(rule[0], /border: 1px dashed/);
  assert.match(rule[0], /color: var\(--text-secondary\)/);
  assert.doesNotMatch(rule[0], /opacity/);
  const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
  assert.match(forced, /\.nav-btn\.is-locked,[\s\S]*?color: GrayText;/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.mode-new-badge \{\s*animation: none;/);
  assert.match(css, /@media \(max-width: 480px\) \{\s*\.stats-list/);
  assert.match(css, /\.stats-table td::before \{\s*content: attr\(data-label\)/);
});

test('the share call passes the weekly flag and week to the share builder', () => {
  const source = readFileSync('./src/ui/UISettingsControls.js', 'utf8');
  assert.match(source, /isWeekly: engine\.isWeeklyFluxRun === true/);
  assert.match(source, /weekKey: engine\.weeklyWeekKey \?\? null/);
});

test('the overlay list holds the stats window and Escape closes it', () => {
  const bindings = readFileSync('./src/ui/UIInputBindings.js', 'utf8');
  assert.match(bindings, /modalStats\.classList\.contains\('hidden'\)\) \{\s*this\.closeOverlayModal\(this\.elements\.modalStats\)/);
  const ui = makeUi({
    elements: {
      modalLevels: fakeElement('hidden'),
      modalShop: fakeElement('hidden'),
      modalSettings: fakeElement('hidden'),
      modalStats: fakeElement()
    }
  });
  assert.ok(ui.getOverlayModals().includes(ui.elements.modalStats));
  assert.equal(ui.isAnyOverlayModalOpen(), true);
});

test('the drawer decides on the live mode access, not on a stale aria-disabled', () => {
  const makeCase = (liveUnlocked, staleDisabled) => {
    const button = fakeElement();
    button.setAttribute('aria-disabled', String(staleDisabled));
    let handler = null;
    button.addEventListener = (type, fn) => { handler = fn; };
    const closes = [];
    const ui = makeUi({
      access: { [GAME_MODES.ENDLESS]: { unlocked: liveUnlocked } },
      elements: { drawer: { querySelectorAll: () => [button] }, btnEndless: button, btnMenu: null, drawerBackdrop: null, btnCloseDrawer: null }
    });
    ui.closeDrawer = (options) => closes.push(options);
    ui.bindDrawerEvents();
    handler();
    return closes;
  };
  assert.deepEqual(makeCase(true, true), [{ resume: false }], 'another tab unlocked it: the menu closes');
  assert.deepEqual(makeCase(false, false), [], 'still locked live: the menu stays open');
});

test('only the weekly run of the current week lights the Weekly button', () => {
  const week = getUtcIsoWeekKey(Date.now());
  const run = { mode: GAME_MODES.FLUX, isWeeklyFluxRun: true, weeklyWeekKey: week };
  assert.equal(isCurrentWeeklyRun(run, week), true);
  assert.equal(isCurrentWeeklyRun({ ...run, weeklyWeekKey: '2020-W01' }, week), false);
  assert.equal(isCurrentWeeklyRun({ ...run, isWeeklyFluxRun: false }, week), false);
  assert.equal(isCurrentWeeklyRun({ ...run, mode: GAME_MODES.ENDLESS }, week), false);
});

test('Daily history rows carry explicit table roles that survive the narrow layout', () => {
  const html = readFileSync('./index.html', 'utf8');
  assert.match(html, /<table class="stats-table" role="table">/);
  assert.equal((html.match(/role="columnheader"/g) || []).length, 6);
  const makeNode = (tag) => {
    const node = {
      tag, attrs: {}, dataset: {}, children: [],
      setAttribute(k, v) { node.attrs[k] = v; },
      appendChild(c) { node.children.push(c); }
    };
    return node;
  };
  const body = { replaceChildren: (...rows) => { body.rows = rows; } };
  const previous = globalThis.document;
  globalThis.document = { createElement: makeNode };
  try {
    const ui = makeUi({
      storage: { getDailyHistory: () => [{ d: '2026-11-07', s: 5200, w: 6, m: null, k: 4, g: false }] },
      elements: { statsDailyBody: body }
    });
    ui.renderDailyHistory();
  } finally {
    globalThis.document = previous;
  }
  const [row] = body.rows;
  assert.equal(row.attrs.role, 'row');
  assert.deepEqual(row.children.map((cell) => cell.attrs.role), ['rowheader', 'cell', 'cell', 'cell', 'cell', 'cell']);
});
