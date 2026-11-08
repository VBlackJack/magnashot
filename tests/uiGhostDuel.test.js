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

import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { GAME_MODES, GAME_STATES } from '../src/core/Constants.js';
import { i18n } from '../src/core/I18n.js';
import { SeededRandom } from '../src/core/SeededRandom.js';
import { UIManager } from '../src/ui/UIManager.js';
import { formatDuelResultText, formatGhostBadge } from '../src/ui/UIGhostDuel.js';
import { buildShareText } from '../src/game/DailyShare.js';
import { DUEL_STATUS } from '../src/game/GhostCodec.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
const indexHtml = fs.readFileSync('./index.html', 'utf8');
const swSource = fs.readFileSync('./sw.js', 'utf8');
const locales = { en: loadJson('./locales/en.json'), fr: loadJson('./locales/fr.json') };
for (const [locale, dictionary] of Object.entries(locales)) {
  i18n.dictionaries.set(locale, dictionary);
}

const useLocale = (locale) => {
  i18n.currentLocale = locale;
};

/** A minimal element: text, classes, children, attributes and listeners. */
function fakeElement() {
  const classes = new Set(['hidden']);
  const listeners = {};
  return {
    textContent: '',
    value: '',
    children: [],
    attrs: {},
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (n) => classes.has(n),
      toggle(n, force) {
        const on = force === undefined ? !classes.has(n) : Boolean(force);
        if (on) {
          classes.add(n);
        } else {
          classes.delete(n);
        }
        return on;
      }
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    addEventListener(name, handler) {
      listeners[name] = handler;
    },
    emit(name) {
      listeners[name]?.();
    },
    offsetWidth: 0
  };
}

let originalDocument;
beforeEach(() => {
  originalDocument = globalThis.document;
  globalThis.document = { createElement: () => fakeElement(), documentElement: fakeElement() };
  useLocale('en');
});
afterEach(() => {
  globalThis.document = originalDocument;
  useLocale('en');
});

const todayKey = () => SeededRandom.getTodayDateKey();

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const yesterdayKey = () =>
  new Date(Date.parse(todayKey()) - MS_PER_DAY).toISOString().slice(0, todayKey().length);

const makeGhost = (overrides = {}) => ({
  mode: 'flux',
  key: 'abc123',
  cv: gameConfig.ghostDuel.contentVersion,
  n: 4,
  step: 1,
  s: [100, 200, 300, 400],
  final: 1240,
  assists: { workshop: 0, ammo: 0, continues: 0, tiltFree: false },
  alias: 'Sam',
  ...overrides
});

/** A UIManager-shaped object: the real prototype methods over stub elements. */
function makeUi() {
  const keys = [
    'modalDuel', 'duelCardSummary', 'duelCardNotes', 'btnDuelAccept', 'btnDuelDecline', 'btnDuelOk',
    'hudGhost', 'gameOverDuel', 'statsDuelsRecord', 'statsDuelsEmpty', 'statsDuelsList', 'inputDuelName'
  ];
  const elements = Object.fromEntries(keys.map((key) => [key, fakeElement()]));
  const calls = { started: [], opened: [], announced: [], confirm: [], refreshed: 0 };
  const ui = Object.create(UIManager.prototype);
  Object.assign(ui, {
    elements,
    gameConfig,
    duelCardRead: null,
    duelCardAtStake: false,
    ghostLastSide: null,
    challengeUrl: null,
    storageManager: {
      getGhostDuels: () => [],
      getGhostDuelRecord: () => ({ won: 0, lost: 0, tie: 0 }),
      getGhostAlias: () => ''
    },
    engine: { startGhostDuel: (g) => calls.started.push(g), state: GAME_STATES.PLAYING, mode: GAME_MODES.CAMPAIGN },
    openOverlayModal(modal, focus) {
      modal.classList.remove('hidden');
      calls.opened.push({ modal, focus });
    },
    closeOverlayModal(modal) {
      modal.classList.add('hidden');
    },
    hideAllModals() {},
    lastExtra: {},
    refresh() {
      calls.refreshed += 1;
    },
    requestDestructiveAction(action, label, options) {
      calls.confirm.push({ action, label: label(), options });
    },
    announce: (message) => calls.announced.push(message)
  });
  return { ui, elements, calls };
}

test('the badge text always shows the sign, the name and the final marker', () => {
  const base = { name: 'Sam', comparison: { gap: 1240, side: 'ahead', shots: 5, ghostFinished: false } };
  assert.equal(formatGhostBadge(base).text, '+1,240 vs Sam');
  assert.equal(
    formatGhostBadge({ ...base, comparison: { ...base.comparison, side: 'behind', gap: 320 } }).text,
    '-320 vs Sam'
  );
  assert.equal(formatGhostBadge({ ...base, comparison: { ...base.comparison, side: 'tied', gap: 0 } }).text, '= Sam');
  assert.equal(
    formatGhostBadge({ ...base, comparison: { ...base.comparison, ghostFinished: true } }).text,
    '+1,240 vs Sam (final)'
  );
});

test('the badge label is a full sentence, with a tied variant', () => {
  const comparison = { gap: 320, side: 'behind', shots: 7, ghostFinished: false };
  assert.equal(formatGhostBadge({ name: 'Sam', comparison }).label, 'You are 320 points behind Sam at shot 7');
  assert.equal(
    formatGhostBadge({ name: 'Sam', comparison: { ...comparison, side: 'tied', gap: 0 } }).label,
    'You are tied with Sam at shot 7'
  );
});

test('the duel result line follows the outcome and ignores anything else', () => {
  assert.equal(formatDuelResultText({ name: 'Sam', outcome: 'won', gap: 1500 }), 'You beat Sam by 1,500');
  assert.equal(formatDuelResultText({ name: 'Sam', outcome: 'lost', gap: 20 }), 'Sam wins by 20');
  assert.equal(formatDuelResultText({ name: 'Sam', outcome: 'tie', gap: 0 }), 'Dead heat with Sam');
  assert.equal(formatDuelResultText({ name: 'Sam', outcome: 'other', gap: 0 }), '');
  assert.equal(formatDuelResultText(null), '');
});

test('the ready card names the rival, shows the notes and offers Accept and Not now', () => {
  const { ui, elements, calls } = makeUi();
  const ghost = makeGhost({
    mode: 'daily',
    key: yesterdayKey(),
    cv: gameConfig.ghostDuel.contentVersion + 1,
    assists: { workshop: 3, ammo: 1, continues: 1, tiltFree: true }
  });
  assert.equal(ui.showDuelCard({ status: DUEL_STATUS.VALID, ghost }), true);
  assert.match(elements.duelCardSummary.textContent, /^Sam scored 1,240 on Daily #\d+/);
  assert.deepEqual(
    elements.duelCardNotes.children.map((item) => item.textContent),
    [
      'Past Daily: no bonus or streak',
      'Rival assists: Workshop +3 - Ammo 1 - Continue 1',
      'Rival played with tilt on',
      'Made with another version: the board may differ'
    ]
  );
  assert.equal(elements.btnDuelAccept.classList.contains('hidden'), false);
  assert.equal(elements.btnDuelDecline.classList.contains('hidden'), false);
  assert.equal(elements.btnDuelOk.classList.contains('hidden'), true);
  assert.equal(calls.opened[0].focus, elements.btnDuelAccept);
});

test('a Flux card uses the default name without an alias and has no extra notes', () => {
  const { ui, elements } = makeUi();
  ui.showDuelCard({ status: DUEL_STATUS.VALID, ghost: makeGhost({ alias: '' }) });
  assert.equal(elements.duelCardSummary.textContent, 'Ghost scored 1,240 on Flux #abc123');
  assert.equal(elements.duelCardNotes.children.length, 0);
  assert.equal(elements.duelCardNotes.classList.contains('hidden'), true);
});

test('every error status shows its own text and only the OK button', () => {
  for (const status of ['invalid', 'expired', 'future', 'newer']) {
    const { ui, elements, calls } = makeUi();
    assert.equal(ui.showDuelCard({ status, ghost: null }), true);
    assert.equal(elements.duelCardSummary.textContent, locales.en.duel.error[status]);
    assert.equal(elements.btnDuelAccept.classList.contains('hidden'), true);
    assert.equal(elements.btnDuelDecline.classList.contains('hidden'), true);
    assert.equal(elements.btnDuelOk.classList.contains('hidden'), false);
    assert.equal(calls.opened[0].focus, elements.btnDuelOk);
  }
});

test('no card opens without a duel link', () => {
  const { ui, calls } = makeUi();
  assert.equal(ui.showDuelCard({ status: DUEL_STATUS.NONE, ghost: null }), false);
  assert.equal(calls.opened.length, 0);
});

test('the card texts are French in French', () => {
  useLocale('fr');
  const { ui, elements } = makeUi();
  ui.showDuelCard({ status: DUEL_STATUS.INVALID, ghost: null });
  assert.equal(elements.duelCardSummary.textContent, locales.fr.duel.error.invalid);
});

test('Accept starts the duel at once when no restored run is at stake', () => {
  const { ui, calls } = makeUi();
  const ghost = makeGhost();
  ui.showDuelCard({ status: DUEL_STATUS.VALID, ghost }, { isRunAtStake: false });
  ui.acceptDuel();
  assert.deepEqual(calls.started, [ghost]);
  assert.equal(calls.refreshed, 1, 'the badge shows at once');
  assert.equal(calls.confirm.length, 0);
  assert.equal(ui.isDuelCardOpen(), false);
});

test('Accept goes through the destructive-action guard, always, over a restored run', () => {
  const { ui, calls } = makeUi();
  const ghost = makeGhost();
  ui.showDuelCard({ status: DUEL_STATUS.VALID, ghost }, { isRunAtStake: true });
  ui.acceptDuel();
  assert.equal(calls.started.length, 0, 'nothing starts before the player confirms');
  assert.equal(calls.confirm.length, 1);
  assert.deepEqual(calls.confirm[0].options, { always: true });
  assert.equal(calls.confirm[0].label, locales.en.duel.card.accept);
  calls.confirm[0].action();
  assert.deepEqual(calls.started, [ghost]);
});

test('Not now closes the card and starts nothing', () => {
  const { ui, calls } = makeUi();
  ui.showDuelCard({ status: DUEL_STATUS.VALID, ghost: makeGhost() });
  ui.dismissDuelCard();
  assert.equal(ui.isDuelCardOpen(), false);
  assert.equal(calls.started.length, 0);
  assert.equal(ui.duelCardRead, null);
});

function makeStatus(side, gap, extra = {}) {
  return {
    name: 'Sam',
    comparison: { gap, side, shots: 3, ghostFinished: false, ...extra }
  };
}

test('the rival badge replaces the best-run marker during a duel and hides outside one', () => {
  const { ui, elements } = makeUi();
  const engine = { state: GAME_STATES.PLAYING, getGhostDuelStatus: () => makeStatus('ahead', 1240) };
  assert.equal(ui.refreshGhostBadge(engine), true);
  assert.equal(elements.hudGhost.textContent, '+1,240 vs Sam');
  assert.equal(elements.hudGhost.classList.contains('hidden'), false);
  assert.equal(elements.hudGhost.getAttribute('aria-label'), 'You are 1,240 points ahead of Sam at shot 3');
  assert.equal(elements.hudGhost.classList.contains('is-ahead'), true);

  assert.equal(ui.refreshGhostBadge({ state: GAME_STATES.PLAYING, getGhostDuelStatus: () => null }), false);
  assert.equal(elements.hudGhost.classList.contains('hidden'), true);
});

test('the badge is hidden at game over while the duel stays on', () => {
  const { ui, elements } = makeUi();
  const engine = { state: GAME_STATES.GAME_OVER, getGhostDuelStatus: () => makeStatus('behind', 5) };
  assert.equal(ui.refreshGhostBadge(engine), true);
  assert.equal(elements.hudGhost.classList.contains('hidden'), true);
});

test('a lead change pulses the badge, unless motion is reduced', () => {
  const { ui, elements } = makeUi();
  const state = { side: 'ahead' };
  const engine = { state: GAME_STATES.PLAYING, getGhostDuelStatus: () => makeStatus(state.side, 10) };
  ui.isReducedMotionActive = () => false;
  ui.refreshGhostBadge(engine);
  state.side = 'behind';
  ui.refreshGhostBadge(engine);
  assert.equal(elements.hudGhost.classList.contains('is-lead-change'), true);
  elements.hudGhost.emit('animationend');
  assert.equal(elements.hudGhost.classList.contains('is-lead-change'), false);

  ui.isReducedMotionActive = () => true;
  state.side = 'ahead';
  ui.refreshGhostBadge(engine);
  assert.equal(elements.hudGhost.classList.contains('is-lead-change'), false);
});

test('a tie does not reset the last lead, so no pulse for ahead, tie, ahead', () => {
  const { ui, elements } = makeUi();
  ui.isReducedMotionActive = () => false;
  const state = { side: 'ahead' };
  const engine = { state: GAME_STATES.PLAYING, getGhostDuelStatus: () => makeStatus(state.side, 0) };
  ui.refreshGhostBadge(engine);
  state.side = 'tied';
  ui.refreshGhostBadge(engine);
  state.side = 'ahead';
  ui.refreshGhostBadge(engine);
  assert.equal(elements.hudGhost.classList.contains('is-lead-change'), false);
});

test('announcements use the hud.announcer.ghost keys', () => {
  const { ui, calls } = makeUi();
  ui.announceGhostEvent({ kind: 'ahead', name: 'Sam', gap: 10, score: 500 });
  ui.announceGhostEvent({ kind: 'behind', name: 'Sam', gap: 10, score: 500 });
  ui.announceGhostEvent({ kind: 'ended', name: 'Sam', gap: 10, score: 1500 });
  ui.announceGhostEvent({ kind: 'passed', name: 'Sam', gap: 10, score: 1500 });
  ui.announceGhostEvent(null);
  assert.deepEqual(calls.announced, [
    'You took the lead over Sam',
    'Sam took the lead',
    "Sam's run ended at 1,500",
    "You passed Sam's final score"
  ]);
});

test('the game over line shows the settled duel and hides without one', () => {
  const { ui, elements } = makeUi();
  assert.equal(ui.refreshGameOverDuel({ duel: { name: 'Sam', outcome: 'won', gap: 90 } }), 'You beat Sam by 90');
  assert.equal(elements.gameOverDuel.textContent, 'You beat Sam by 90');
  assert.equal(elements.gameOverDuel.classList.contains('hidden'), false);
  assert.equal(ui.refreshGameOverDuel({}), '');
  assert.equal(elements.gameOverDuel.classList.contains('hidden'), true);
});

test('the Share button becomes Share challenge only with a duel address', () => {
  const { ui } = makeUi();
  assert.equal(ui.getShareButtonLabelKey(), 'modals.gameOver.button.share');
  ui.challengeUrl = 'https://example.test/?duel=x';
  assert.equal(ui.getShareButtonLabelKey(), 'modals.gameOver.button.shareChallenge');
  ui.shareCopied = true;
  assert.equal(ui.getShareButtonLabelKey(), 'modals.gameOver.button.shareCopied');
});

test('a Flux share carries the duel header and ends on the duel address', () => {
  const url = 'https://example.test/?flux=abc123&duel=PAYLOAD';
  const text = buildShareText(
    {
      mode: GAME_MODES.FLUX,
      stage: 3,
      score: 4200,
      seed: 'abc123',
      url: gameConfig.share.url,
      duel: { name: 'Sam', outcome: 'won', gap: 120 },
      duelUrl: url
    },
    gameConfig.share
  );
  const lines = text.split('\n');
  assert.equal(lines[1], 'vs Sam: won by 120');
  assert.equal(lines.at(-1), url);
});

test('a Daily share has the duel line, and loses it without a duel', () => {
  const run = {
    mode: GAME_MODES.DAILY,
    dateKey: todayKey(),
    mutatorKey: null,
    wave: 2,
    score: 900,
    waveLog: [],
    url: gameConfig.share.url
  };
  const withDuel = buildShareText(
    { ...run, duel: { name: 'Sam', outcome: 'lost', gap: 30 }, duelUrl: 'https://example.test/?duel=Z' },
    gameConfig.share
  ).split('\n');
  assert.equal(withDuel[1], 'vs Sam: lost by 30');
  assert.equal(withDuel.at(-1), 'https://example.test/?duel=Z');
  const without = buildShareText(run, gameConfig.share).split('\n');
  assert.equal(without.at(-1), gameConfig.share.url);
  assert.ok(!without.some((line) => line.startsWith('vs ')));
  const tie = buildShareText({ ...run, duel: { name: 'Sam', outcome: 'tie', gap: 0 } }, gameConfig.share).split('\n');
  assert.equal(tie[1], 'vs Sam: dead heat');
});

test('the stats list shows the record, the latest duels and an empty state', () => {
  const { ui, elements } = makeUi();
  ui.renderStatsDuels();
  assert.equal(elements.statsDuelsEmpty.classList.contains('hidden'), false);
  assert.equal(elements.statsDuelsList.classList.contains('hidden'), true);

  ui.storageManager.getGhostDuels = () => [
    { mode: 'daily', key: '2026-01-01', alias: 'Sam', ghostScore: 1000, myScore: 1240, outcome: 'won', dateKey: '2026-01-02' },
    { mode: 'flux', key: 'abc123', alias: '', ghostScore: 900, myScore: 800, outcome: 'lost', dateKey: '2026-01-02' }
  ];
  ui.storageManager.getGhostDuelRecord = () => ({ won: 1, lost: 1, tie: 0 });
  ui.renderStatsDuels();
  assert.equal(elements.statsDuelsRecord.textContent, '1 won - 1 lost');
  assert.equal(elements.statsDuelsEmpty.classList.contains('hidden'), true);
  assert.equal(elements.statsDuelsList.children.length, 2);
  assert.match(elements.statsDuelsList.children[0].textContent, /You beat Sam by 240/);
  assert.match(elements.statsDuelsList.children[1].textContent, /Ghost wins by 100/);
});

test('the alias field shows the stored alias as a value, never as markup', () => {
  const { ui, elements } = makeUi();
  ui.storageManager.getGhostAlias = () => 'Sam';
  ui.syncDuelNameField();
  assert.equal(elements.inputDuelName.value, 'Sam');
  assert.equal(elements.inputDuelName.innerHTML, undefined);
});

test('the page has every duel element and the duel card is a labelled modal dialog', () => {
  for (const id of [
    'hud-ghost', 'gameover-duel', 'modal-duel', 'duel-card-summary', 'duel-card-notes', 'btn-duel-accept',
    'btn-duel-decline', 'btn-duel-ok', 'input-duel-name', 'duel-name-hint', 'stats-duels', 'stats-duels-list'
  ]) {
    assert.ok(indexHtml.includes(`id="${id}"`), `${id} exists`);
  }
  assert.match(
    indexHtml,
    /id="modal-duel"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="modal-duel-title"/
  );
  const row = indexHtml.slice(indexHtml.indexOf('class="hud-badges-row"'), indexHtml.indexOf('hud-stat-shots'));
  assert.ok(row.includes('id="hud-ghost"') && row.includes('id="hud-best-run"'), 'both badges share one row');
});

test('the duel card is an overlay dialog, so it holds the run and traps focus like the others', () => {
  const { ui } = makeUi();
  ui.elements = { modalLevels: 'a', modalShop: 'b', modalSettings: 'c', modalStats: 'd', modalDuel: 'e' };
  assert.deepEqual(ui.getOverlayModals(), ['a', 'b', 'c', 'd', 'e']);
});

test('the new runtime files are precached', () => {
  assert.ok(swSource.includes("'./src/game/EngineGhostDuel.js'"));
  assert.ok(swSource.includes("'./src/ui/UIGhostDuel.js'"));
});
