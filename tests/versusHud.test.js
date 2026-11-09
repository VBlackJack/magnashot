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

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { i18n } from '../src/core/I18n.js';
import { MATCH_EVENTS } from '../src/game/VersusMatch.js';
import {
  VERSUS_LAYOUTS,
  VersusHud,
  chooseVersusLayout,
  collectVersusHudElements,
  computeMiniSize,
  createAnnouncementQueue,
  fitBoard,
  formatMatchTimer,
  getVersusDevicePixelRatioCap,
  renderAnnouncement
} from '../src/ui/VersusHud.js';

const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const indexHtml = readFileSync('./index.html', 'utf8');
const gameConfig = loadJson('./configs/game.json');
const ballsConfig = loadJson('./configs/balls.json');
const canvasCfg = gameConfig.canvas;
const layoutCfg = gameConfig.versus.layout;
for (const locale of ['en', 'fr']) {
  i18n.dictionaries.set(locale, loadJson(`./locales/${locale}.json`));
}
beforeEach(() => {
  i18n.currentLocale = 'en';
});
afterEach(() => {
  i18n.currentLocale = 'en';
});

const WINDOW_FRAMES = gameConfig.versus.ui.announceWindowFrames;
const SUDDEN_DEATH_SECONDS = gameConfig.versus.suddenDeath.intervalSeconds;
const BAR_HEIGHT = 60;
const SHELL_PAD = 16;
const HUD_HEIGHT = 54;
const GAP = 12;

/** The measured inputs of a viewport: the room under the top bar. */
const measure = (width, height) => ({
  areaWidth: width - SHELL_PAD,
  areaHeight: height - SHELL_PAD - BAR_HEIGHT,
  hudHeight: HUD_HEIGHT,
  viewportHeight: height,
  gap: GAP
});

test('fitBoard keeps the aspect ratio of the board inside any box', () => {
  const ratio = canvasCfg.logicalWidth / canvasCfg.logicalHeight;
  for (const [width, height] of [[400, 400], [400, 1000], [100, 900], [0, 500]]) {
    const fit = fitBoard(width, height, canvasCfg);
    assert.ok(fit.width <= width && fit.height <= height + 1, `${width}x${height} holds ${fit.width}x${fit.height}`);
    assert.ok(Math.abs(fit.width / Math.max(1, fit.height) - ratio) < 0.02 || fit.width === 0);
  }
  assert.deepEqual(fitBoard(-5, 100, canvasCfg), { width: 0, height: 0 });
});

test('the layout is split where each board gets the configured width and the viewport is tall enough', () => {
  const desktop = chooseVersusLayout(measure(1300, 850), layoutCfg, canvasCfg);
  assert.equal(desktop.layout, VERSUS_LAYOUTS.SPLIT);
  assert.ok(desktop.boardWidth >= layoutCfg.splitMinBoardWidthPx);
  assert.equal(chooseVersusLayout(measure(768, 1024), layoutCfg, canvasCfg).layout, VERSUS_LAYOUTS.SPLIT);
  assert.equal(chooseVersusLayout(measure(1024, 768), layoutCfg, canvasCfg).layout, VERSUS_LAYOUTS.SPLIT);
});

test('phones take the mini-view, in both orientations', () => {
  for (const [width, height] of [[844, 390], [390, 844], [360, 800]]) {
    assert.equal(chooseVersusLayout(measure(width, height), layoutCfg, canvasCfg).layout, VERSUS_LAYOUTS.MINI, `${width}x${height}`);
  }
});

test('a wide window that is too short takes the mini-view even when the width would do', () => {
  const short = chooseVersusLayout(measure(1400, layoutCfg.splitMinViewportHeightPx - 1), layoutCfg, canvasCfg);
  assert.equal(short.layout, VERSUS_LAYOUTS.MINI);
  const tall = chooseVersusLayout(measure(1400, layoutCfg.splitMinViewportHeightPx + 300), layoutCfg, canvasCfg);
  assert.equal(tall.layout, VERSUS_LAYOUTS.SPLIT);
});

test('the layout switches exactly at the configured board width', () => {
  const areaHeight = 2000;
  const edgeWidth = layoutCfg.splitMinBoardWidthPx * 2 + GAP;
  const base = { areaHeight, hudHeight: 0, viewportHeight: 900, gap: GAP };
  assert.equal(chooseVersusLayout({ ...base, areaWidth: edgeWidth }, layoutCfg, canvasCfg).layout, VERSUS_LAYOUTS.SPLIT);
  assert.equal(chooseVersusLayout({ ...base, areaWidth: edgeWidth - 4 }, layoutCfg, canvasCfg).layout, VERSUS_LAYOUTS.MINI);
});

test('the CPU board of the mini-view is miniScale of the logical size and shrinks into a short column', () => {
  const nominal = computeMiniSize(canvasCfg, layoutCfg);
  assert.equal(nominal.width, Math.round(canvasCfg.logicalWidth * layoutCfg.miniScale));
  assert.equal(nominal.height, Math.round(canvasCfg.logicalHeight * layoutCfg.miniScale));
  const short = computeMiniSize(canvasCfg, layoutCfg, 100);
  assert.ok(short.height <= 100 && short.width < nominal.width);
  assert.deepEqual(computeMiniSize(canvasCfg, layoutCfg, 0), { width: 0, height: 0 });
});

test('the portrait strip keeps the CPU board under the configured height', () => {
  const strip = computeMiniSize(canvasCfg, layoutCfg, layoutCfg.portraitMiniMaxHeightPx);
  assert.ok(strip.height <= layoutCfg.portraitMiniMaxHeightPx);
  assert.ok(strip.width > 0);
});

test('only the split layout caps the device pixel ratio of the renderers', () => {
  assert.equal(getVersusDevicePixelRatioCap(layoutCfg, VERSUS_LAYOUTS.SPLIT), layoutCfg.splitMaxDevicePixelRatio);
  assert.equal(getVersusDevicePixelRatioCap(layoutCfg, VERSUS_LAYOUTS.MINI), null);
});

test('the timer is written as minutes and two-digit seconds', () => {
  assert.equal(formatMatchTimer(0), '0:00');
  assert.equal(formatMatchTimer(9), '0:09');
  assert.equal(formatMatchTimer(61), '1:01');
  assert.equal(formatMatchTimer(185), '3:05');
  assert.equal(formatMatchTimer(-4), '0:00');
  assert.equal(formatMatchTimer(Number.NaN), '0:00');
});

test('charges that arrive within one window are announced once, with their total', () => {
  const queue = createAnnouncementQueue({ windowFrames: WINDOW_FRAMES, suddenDeathSeconds: SUDDEN_DEATH_SECONDS });
  const incoming = (count, isPlayer = true) => ({ type: MATCH_EVENTS.CHARGE_INCOMING, isPlayer, count });
  assert.deepEqual(queue.push(incoming(2), 0), []);
  assert.deepEqual(queue.push(incoming(1), 10), []);
  assert.deepEqual(queue.push(incoming(3, false), 11), [], 'the CPU board is not announced');
  assert.deepEqual(queue.drain(WINDOW_FRAMES - 1), [], 'the window is still open');
  assert.deepEqual(queue.drain(WINDOW_FRAMES), [{ key: 'chargeIncoming', params: { count: 3 } }]);
  assert.deepEqual(queue.drain(WINDOW_FRAMES * 2), [], 'nothing is left to say');
  assert.deepEqual(queue.push(incoming(1), WINDOW_FRAMES + 5), []);
  assert.deepEqual(queue.drain(WINDOW_FRAMES * 2 + 5), [{ key: 'chargeIncoming', params: { count: 1 } }], 'the next window opens on its own');
});

test('a neutralisation is announced at most once per window, for the player board only', () => {
  const queue = createAnnouncementQueue({ windowFrames: WINDOW_FRAMES, suddenDeathSeconds: SUDDEN_DEATH_SECONDS });
  const neutralised = (isPlayer = true) => ({ type: MATCH_EVENTS.CHARGE_NEUTRALISED, isPlayer });
  assert.equal(queue.push(neutralised(), 100).length, 1);
  assert.equal(queue.push(neutralised(), 100 + WINDOW_FRAMES - 1).length, 0);
  assert.equal(queue.push(neutralised(false), 100 + WINDOW_FRAMES).length, 0);
  assert.equal(queue.push(neutralised(), 100 + WINDOW_FRAMES).length, 1);
});

test('rounds, pulses, sudden death and the match are announced as they happen', () => {
  const queue = createAnnouncementQueue({ windowFrames: WINDOW_FRAMES, suddenDeathSeconds: SUDDEN_DEATH_SECONDS });
  const keys = (event) => queue.push(event, 0).map((entry) => entry.key);
  assert.deepEqual(keys({ type: MATCH_EVENTS.ROUND_WON }), ['roundWon']);
  assert.deepEqual(keys({ type: MATCH_EVENTS.ROUND_LOST }), ['roundLost']);
  assert.deepEqual(keys({ type: MATCH_EVENTS.ROUND_REPLAY }), ['roundDraw']);
  assert.deepEqual(keys({ type: MATCH_EVENTS.PULSE_SENT, isPlayer: true }), ['pulseSent']);
  assert.deepEqual(keys({ type: MATCH_EVENTS.PULSE_SENT, isPlayer: false }), []);
  assert.deepEqual(keys({ type: MATCH_EVENTS.PULSE_RECEIVED, isPlayer: true, source: 'pulse' }), ['pulseReceived']);
  assert.deepEqual(keys({ type: MATCH_EVENTS.PULSE_RECEIVED, isPlayer: true, source: 'suddenDeath' }), [], 'sudden death speaks for itself');
  assert.deepEqual(queue.push({ type: MATCH_EVENTS.SUDDEN_DEATH }, 0), [{ key: 'suddenDeath', params: { seconds: SUDDEN_DEATH_SECONDS } }]);
  assert.deepEqual(queue.push({ type: MATCH_EVENTS.MATCH_WON, wins: [2, 1] }, 0), [{ key: 'matchWon', params: { player: 2, cpu: 1 } }]);
  assert.deepEqual(queue.push({ type: MATCH_EVENTS.MATCH_LOST, wins: [0, 2] }, 0), [{ key: 'matchLost', params: { player: 0, cpu: 2 } }]);
  assert.deepEqual(keys({ type: MATCH_EVENTS.ATTACK_SENT }), [], 'unrelated reports stay silent');
});

test('announcements read in both languages with the numbers filled in', () => {
  const entry = { key: 'matchWon', params: { player: 2, cpu: 1 } };
  assert.equal(renderAnnouncement(entry), 'Match won, 2 to 1.');
  i18n.currentLocale = 'fr';
  assert.equal(renderAnnouncement(entry), 'Match gagné, 2 à 1.');
  assert.equal(renderAnnouncement({ key: 'chargeIncoming', params: { count: 3 } }), '3 sphères chargées arrivent.');
});

/** A minimal element: text, classes, attributes, children, style and listeners. */
function fakeElement(tag = 'div') {
  const classes = new Set();
  const attrs = {};
  const listeners = {};
  return {
    tag,
    textContent: '',
    className: '',
    dataset: {},
    style: {},
    children: [],
    attrs,
    listeners,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return on;
      }
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return attrs[name] ?? null;
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    addEventListener(name, handler) {
      listeners[name] = handler;
    },
    focus() {}
  };
}

function makeHudElements() {
  const board = () => ({
    root: fakeElement(),
    label: fakeElement(),
    incoming: fakeElement(),
    pulse: fakeElement(),
    pulseFill: fakeElement(),
    polarityBtn: fakeElement('button'),
    swapBtn: fakeElement('button'),
    specials: fakeElement()
  });
  const els = {
    roundPips: fakeElement(),
    roundLabel: fakeElement(),
    pipsPlayer: fakeElement(),
    pipsCpu: fakeElement(),
    timer: fakeElement(),
    suddenDeath: fakeElement(),
    boards: [board(), board()]
  };
  els.suddenDeath.classList.add('hidden');
  els.boards[0].specials.classList.add('hidden');
  return els;
}

const boardState = (index, overrides = {}) => ({
  index,
  isPlayer: index === 0,
  isCpu: index === 1,
  tier: index === 1 ? 'hard' : null,
  incoming: 0,
  charges: [],
  pulse: { value: 0, max: 2, ratio: 0 },
  ...overrides
});

const matchState = (overrides = {}) => ({
  playerBoard: 0,
  timerSeconds: 0,
  isSuddenDeath: false,
  round: { number: 1, wins: [0, 0], roundsToWin: 2 },
  boards: [boardState(0), boardState(1)],
  ...overrides
});

const makeHud = (elements = makeHudElements()) => ({
  elements,
  hud: new VersusHud(elements, { createElement: (tag) => fakeElement(tag) })
});

test('the bar shows one pip per round to win, filled for the rounds won, with a spoken summary', () => {
  const { elements, hud } = makeHud();
  hud.refresh(matchState({ round: { number: 2, wins: [1, 0], roundsToWin: 2 }, timerSeconds: 75 }));
  assert.equal(elements.pipsPlayer.children.length, 2);
  assert.equal(elements.pipsCpu.children.length, 2);
  assert.deepEqual(elements.pipsPlayer.children.map((pip) => pip.classList.contains('is-won')), [true, false]);
  assert.deepEqual(elements.pipsCpu.children.map((pip) => pip.classList.contains('is-won')), [false, false]);
  assert.equal(elements.roundLabel.textContent, 'Round 2');
  assert.equal(elements.roundPips.getAttribute('aria-label'), 'Round 2. You: 1 won. CPU: 0 won.');
  assert.equal(elements.timer.textContent, '1:15');
  assert.equal(elements.timer.getAttribute('aria-label'), 'Time 1:15');
});

test('the sudden death badge shows only while it applies', () => {
  const { elements, hud } = makeHud();
  hud.refresh(matchState());
  assert.equal(elements.suddenDeath.classList.contains('hidden'), true);
  hud.refresh(matchState({ isSuddenDeath: true }));
  assert.equal(elements.suddenDeath.classList.contains('hidden'), false);
});

test('each board shows its incoming charges as text, with the danger as a second, non-colour cue', () => {
  const { elements, hud } = makeHud();
  hud.refresh(matchState({ boards: [boardState(0, { incoming: 3, charges: [{ threatening: false }, { threatening: true }] }), boardState(1)] }), { cpuTierName: 'Hard' });
  const [player, cpu] = elements.boards;
  assert.equal(player.incoming.textContent, 'In: 3');
  assert.equal(player.incoming.getAttribute('aria-label'), 'Incoming charges: 3');
  assert.equal(player.incoming.classList.contains('has-incoming'), true);
  assert.equal(player.incoming.classList.contains('has-threat'), true);
  assert.equal(cpu.incoming.textContent, 'In: 0');
  assert.equal(cpu.incoming.classList.contains('has-incoming'), false);
  assert.equal(player.label.textContent, 'Your board');
  assert.equal(cpu.label.textContent, 'CPU board (Hard)');
});

test('the pulse meter reports its value to assistive technology and fills in proportion', () => {
  const { elements, hud } = makeHud();
  hud.refresh(matchState({ boards: [boardState(0, { pulse: { value: 1, max: 2, ratio: 0.5 } }), boardState(1, { pulse: { value: 3, max: 2, ratio: 1.5 } })] }));
  const [player, cpu] = elements.boards;
  assert.equal(player.pulse.getAttribute('aria-valuenow'), '50');
  assert.equal(player.pulse.getAttribute('aria-valuetext'), 'Pulse meter: 50%');
  assert.equal(player.pulse.getAttribute('aria-label'), 'Pulse meter: 50%');
  assert.equal(player.pulseFill.style.width, '50%');
  assert.equal(cpu.pulse.getAttribute('aria-valuenow'), '100', 'a ratio above one is clamped');
});

test('the labels of the player controls follow the language', () => {
  const { elements, hud } = makeHud();
  hud.refreshLabels();
  assert.equal(elements.boards[0].swapBtn.textContent, 'Swap spheres');
  assert.equal(elements.boards[0].polarityBtn.getAttribute('aria-label'), 'Flip polarity');
  i18n.currentLocale = 'fr';
  hud.refreshLabels();
  assert.equal(elements.boards[0].swapBtn.textContent, 'Échanger les sphères');
});

const SPECIAL_TYPES = Object.keys(ballsConfig.specialTypes);
const specialsContext = (picked = []) => ({
  types: SPECIAL_TYPES,
  specs: ballsConfig.specialTypes,
  describe: (type, count) => `${type} x${count}`,
  onPick: (type) => picked.push(type)
});

test('the polarity button mirrors the flip, and stocked specials appear as buttons that equip them', () => {
  const { elements, hud } = makeHud();
  const picked = [];
  const engine = { isPolarityFlipped: true, specialInventory: { [SPECIAL_TYPES[0]]: 2 }, currentBall: { specialType: null } };
  const changed = hud.refreshPlayerControls(engine, specialsContext(picked));
  assert.equal(changed, true, 'the row appeared, the layout may need to move');
  assert.equal(elements.boards[0].polarityBtn.getAttribute('aria-pressed'), 'true');
  const row = elements.boards[0].specials;
  assert.equal(row.classList.contains('hidden'), false);
  assert.equal(row.children.length, 1);
  assert.equal(row.children[0].getAttribute('aria-label'), `${SPECIAL_TYPES[0]} x2`);
  row.children[0].listeners.click();
  assert.deepEqual(picked, [SPECIAL_TYPES[0]]);
  assert.equal(hud.refreshPlayerControls(engine, specialsContext()), false, 'nothing changed, nothing is rebuilt');
  engine.specialInventory[SPECIAL_TYPES[0]] = 0;
  assert.equal(hud.refreshPlayerControls(engine, specialsContext()), true);
  assert.equal(row.classList.contains('hidden'), true, 'an empty stock hides the row again');
});

test('the polarity button says the polarity of the loaded shot in text and in its accessible name', () => {
  const { elements, hud } = makeHud();
  const button = elements.boards[0].polarityBtn;
  const engine = (polarity, flipped = false) => ({
    isPolarityFlipped: flipped,
    specialInventory: {},
    currentBall: { specialType: null },
    getVersusShotPolarity: () => polarity
  });
  hud.refreshPlayerControls(engine(1), specialsContext());
  assert.equal(button.textContent, 'Polarity +');
  assert.equal(button.getAttribute('aria-label'), 'Flip polarity. Your shot is positive.');
  hud.refreshPlayerControls(engine(-1, true), specialsContext());
  assert.equal(button.textContent, 'Polarity -');
  assert.equal(button.getAttribute('aria-label'), 'Flip polarity. Your shot is negative.');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  hud.refreshPlayerControls(engine(null), specialsContext());
  assert.equal(button.textContent, 'Flip polarity', 'a special sphere has no polarity to show');
  hud.refreshPlayerControls(engine(-1), specialsContext());
  i18n.currentLocale = 'fr';
  hud.refreshLabels();
  assert.equal(button.textContent, 'Polarité -');
  assert.equal(button.getAttribute('aria-label'), 'Inverser la polarité. Votre tir est négatif.');
});

test('the difficulty picker carries one line of rules in both languages', () => {
  assert.match(indexHtml, /id="versus-tiers-rules"[^>]*data-i18n="versus\.lobby\.rules"/);
  for (const locale of ['en', 'fr']) {
    const rules = loadJson(`./locales/${locale}.json`).versus.lobby.rules;
    assert.ok(typeof rules === 'string' && rules.length > 0, locale);
  }
  assert.equal(i18n.t('versus.lobby.rules'), 'Opposite polarity shatters a charge; the same polarity bounces off.');
});

test('a special that is loaded stays listed and marked as equipped', () => {
  const { elements, hud } = makeHud();
  const engine = { isPolarityFlipped: false, specialInventory: {}, currentBall: { specialType: SPECIAL_TYPES[1] } };
  hud.refreshPlayerControls(engine, specialsContext());
  const [button] = elements.boards[0].specials.children;
  assert.equal(button.classList.contains('equipped'), true);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
});

// ---------------------------------------------------------------------------------------------
// Two players on one device
// ---------------------------------------------------------------------------------------------

const localBoardState = (index, overrides = {}) => ({
  index,
  isPlayer: false,
  isCpu: false,
  isHuman: true,
  tier: null,
  incoming: 0,
  charges: [],
  pulse: { value: 0, max: 2, ratio: 0 },
  ...overrides
});

const localMatchState = (overrides = {}) => ({
  playerBoard: null,
  mode: 'local',
  timerSeconds: 0,
  isSuddenDeath: false,
  round: { number: 2, wins: [1, 0], roundsToWin: 2 },
  boards: [localBoardState(0), localBoardState(1)],
  ...overrides
});

const LOCAL_WINDOW_FRAMES = 30;
const LOCAL_SUDDEN_DEATH_SECONDS = 15;
const localQueue = () => createAnnouncementQueue({ windowFrames: LOCAL_WINDOW_FRAMES, suddenDeathSeconds: LOCAL_SUDDEN_DEATH_SECONDS, mode: 'local' });
const render = (entries) => entries.map((entry) => renderAnnouncement(entry));

test('the local announcements name the winner of a round and of the match, and nothing is "you"', () => {
  const queue = localQueue();
  assert.deepEqual(render(queue.push({ type: MATCH_EVENTS.ROUND_DECIDED, winner: 1, loser: 0, wins: [0, 1] }, 0)), ['Player 2 wins the round']);
  assert.deepEqual(render(queue.push({ type: MATCH_EVENTS.MATCH_DECIDED, winner: 0, wins: [2, 1] }, 0)), ['Player 1 wins the match 2 to 1']);
  assert.deepEqual(render(queue.push({ type: MATCH_EVENTS.ROUND_REPLAY }, 0)), ['Both boards fell. The round is replayed.']);
  assert.deepEqual(
    render(queue.push({ type: MATCH_EVENTS.SUDDEN_DEATH }, 0)),
    [`Sudden death: both rails now drop every ${LOCAL_SUDDEN_DEATH_SECONDS} seconds.`]
  );
  i18n.currentLocale = 'fr';
  assert.deepEqual(render(queue.push({ type: MATCH_EVENTS.ROUND_DECIDED, winner: 0, loser: 1, wins: [1, 0] }, 0)), ['Le joueur 1 remporte la manche']);
});

test('local pulses of one player are coalesced inside the announce window, each player apart', () => {
  const queue = localQueue();
  const pulse = (board, clock) => render(queue.push({ type: MATCH_EVENTS.PULSE_SENT, board, target: 1 - board }, clock));
  assert.deepEqual(pulse(0, 0), ['Player 1 sent a field pulse']);
  assert.deepEqual(pulse(0, LOCAL_WINDOW_FRAMES - 1), [], 'a second pulse in the window is not said again');
  assert.deepEqual(pulse(1, 1), ['Player 2 sent a field pulse'], 'the other player is counted apart');
  assert.deepEqual(pulse(0, LOCAL_WINDOW_FRAMES), ['Player 1 sent a field pulse'], 'it is said again after the window');
});

test('the local announcements keep pulses sent by a named player and drop the charge traffic and the CPU wording', () => {
  const queue = localQueue();
  assert.deepEqual(render(queue.push({ type: MATCH_EVENTS.PULSE_SENT, board: 1, target: 0 }, 0)), ['Player 2 sent a field pulse']);
  assert.deepEqual(render(queue.push({ type: MATCH_EVENTS.PULSE_SENT, board: 0, target: 1 }, 0)), ['Player 1 sent a field pulse']);
  for (const type of [
    MATCH_EVENTS.CHARGE_INCOMING,
    MATCH_EVENTS.CHARGE_NEUTRALISED,
    MATCH_EVENTS.PULSE_RECEIVED,
    MATCH_EVENTS.ROUND_WON,
    MATCH_EVENTS.ROUND_LOST,
    MATCH_EVENTS.MATCH_WON,
    MATCH_EVENTS.MATCH_LOST
  ]) {
    assert.deepEqual(queue.push({ type, isPlayer: true, count: 2, source: 'pulse', wins: [2, 0] }, 0), [], type);
  }
  assert.deepEqual(queue.drain(LOCAL_WINDOW_FRAMES * 10), [], 'no incoming charges are ever counted');
});

test('the bar and the boards read "Player N" with the device and a badge that is not only a colour', () => {
  const { elements, hud } = makeHud();
  for (const board of elements.boards) {
    board.badge = fakeElement();
    board.badge.classList.add('hidden');
  }
  hud.refresh(localMatchState(), { deviceNames: ['Left keys', 'Controller'] });
  assert.equal(elements.roundPips.getAttribute('aria-label'), 'Round 2. Player 1: 1 won. Player 2: 0 won.');
  assert.equal(elements.pipsPlayer.children.filter((pip) => pip.classList.contains('is-won')).length, 1);
  assert.equal(elements.boards[0].label.textContent, 'Player 1 (Left keys)');
  assert.equal(elements.boards[1].label.textContent, 'Player 2 (Controller)');
  assert.equal(elements.boards[0].root.getAttribute('aria-label'), 'Player 1 board');
  assert.equal(elements.boards[1].root.getAttribute('aria-label'), 'Player 2 board');
  assert.equal(elements.boards[0].badge.textContent, '1');
  assert.equal(elements.boards[1].badge.textContent, '2');
  assert.equal(elements.boards[0].badge.classList.contains('hidden'), false);
  hud.refresh(localMatchState());
  assert.equal(elements.boards[0].label.textContent, 'Player 1', 'a board with no device named shows only the player');
  // Back to a match against the CPU: the badges leave and the usual labels return.
  hud.refresh(matchState(), { cpuTierName: 'Hard' });
  assert.equal(elements.boards[0].badge.classList.contains('hidden'), true);
  assert.equal(elements.boards[0].label.textContent, 'Your board');
  assert.equal(elements.boards[1].label.textContent, 'CPU board (Hard)');
});

test('the second board has its own polarity button and specials row, refreshed apart from the first', () => {
  const { elements, hud } = makeHud();
  elements.boards[1].specials.classList.add('hidden');
  const engineOf = (polarity, isFlipped, inventory = {}) => ({
    isPolarityFlipped: isFlipped,
    getVersusShotPolarity: () => polarity,
    specialInventory: inventory,
    currentBall: { specialType: null }
  });
  const [firstType] = SPECIAL_TYPES;
  const picked = [];
  hud.refreshPlayerControls(engineOf(1, false), specialsContext(picked), 0);
  const changed = hud.refreshPlayerControls(engineOf(-1, true, { [firstType]: 2 }), specialsContext(picked), 1);
  assert.equal(changed, true, 'the second row appeared');
  assert.equal(elements.boards[0].polarityBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(elements.boards[1].polarityBtn.getAttribute('aria-pressed'), 'true');
  assert.match(elements.boards[0].polarityBtn.getAttribute('aria-label'), /positive/);
  assert.match(elements.boards[1].polarityBtn.getAttribute('aria-label'), /negative/);
  assert.equal(elements.boards[0].specials.children.length, 0, 'the first row is untouched');
  assert.equal(elements.boards[1].specials.children.length, 1);
  assert.equal(hud.refreshPlayerControls(engineOf(-1, true, { [firstType]: 2 }), specialsContext(picked), 1), false, 'nothing changed, nothing is rebuilt');
  elements.boards[1].specials.children[0].listeners.click();
  assert.deepEqual(picked, [firstType]);
});

test('the labels of both boards controls follow the language', () => {
  const { elements, hud } = makeHud();
  i18n.currentLocale = 'fr';
  hud.refreshLabels();
  assert.equal(elements.boards[1].swapBtn.textContent, 'Échanger les sphères');
  assert.equal(elements.boards[0].swapBtn.textContent, 'Échanger les sphères');
});

test('the HUD reads the controls of the second board under their own ids', () => {
  const found = new Map();
  const stub = (id) => {
    const node = { id, querySelector: (selector) => ({ selector }) };
    found.set(id, node);
    return node;
  };
  const doc = {
    getElementById: (id) => stub(id)
  };
  const els = collectVersusHudElements(doc);
  assert.equal(els.boards[0].polarityBtn.selector, '#btn-versus-polarity');
  assert.equal(els.boards[1].polarityBtn.selector, '#btn-versus-polarity-1');
  assert.equal(els.boards[1].swapBtn.selector, '#btn-versus-swap-1');
  assert.equal(els.boards[1].specials.selector, '#versus-specials-1');
  assert.equal(els.boards[1].badge.selector, '.versus-badge');
});
