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

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GAME_MODES, GAME_STATES } from '../src/core/Constants.js';
import { WEEKLY_ACCESS_KEY } from '../src/ui/UIHelpers.js';
import {
  CONTINUE_KINDS,
  describeDailyReward,
  describeWeeklyReward,
  isModeRunning,
  resolveContinueTarget,
  resolveInitialFocusKey,
  resolveVersusLocalEntry,
  sumChapterStars,
  uiPlayHubMethods
} from '../src/ui/PlayHubView.js';

const WEEK = '2026-W45';
const OLD_WEEK = '2026-W44';

/** Stub translation: the key, then its params, so a test asserts which key was asked for. */
const stubT = (key, params) => (params ? `${key}|${JSON.stringify(params)}` : key);

/** Minimal element: class list, attributes and a focus flag. */
function fakeElement({ hidden = false } = {}) {
  const classes = new Set(hidden ? ['hidden'] : []);
  const attrs = new Map();
  return {
    textContent: '',
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return on;
      }
    },
    setAttribute: (name, value) => attrs.set(name, String(value)),
    getAttribute: (name) => attrs.get(name) ?? null,
    removeAttribute: (name) => attrs.delete(name)
  };
}

function engineOf(mode, state = GAME_STATES.PLAYING, extra = {}) {
  return { mode, state, ...extra };
}

test('initial focus: no run or a campaign run lands on Continue', () => {
  const access = {};
  assert.equal(resolveInitialFocusKey({ engine: engineOf(GAME_MODES.ENDLESS, GAME_STATES.READY), access, weekKey: WEEK }), 'btnCampaignContinue');
  assert.equal(resolveInitialFocusKey({ engine: engineOf(GAME_MODES.CAMPAIGN), access, weekKey: WEEK }), 'btnCampaignContinue');
  assert.equal(resolveInitialFocusKey({ engine: engineOf(GAME_MODES.CAMPAIGN, GAME_STATES.PAUSED), access, weekKey: WEEK }), 'btnCampaignContinue');
});

test('initial focus: a running mode focuses its own card', () => {
  const expected = {
    [GAME_MODES.ENDLESS]: 'btnEndless',
    [GAME_MODES.DAILY]: 'btnDaily',
    [GAME_MODES.CLASSIC]: 'btnModeClassic',
    [GAME_MODES.FLUX]: 'btnFlux',
    [GAME_MODES.PUZZLE]: 'btnModePuzzle',
    [GAME_MODES.BLITZ]: 'btnModeBlitz',
    [GAME_MODES.BOSS_RUSH]: 'btnModeBossRush',
    [GAME_MODES.CASCADE]: 'btnModeCascade',
    [GAME_MODES.HEX_GRID]: 'btnModeHexGrid',
    [GAME_MODES.PINBALL]: 'btnModePinball',
    [GAME_MODES.ORBITAL]: 'btnModeOrbital',
    [GAME_MODES.CONVOY]: 'btnModeConvoy',
    [GAME_MODES.MERGE]: 'btnModeMerge'
  };
  for (const [mode, key] of Object.entries(expected)) {
    assert.equal(
      resolveInitialFocusKey({ engine: engineOf(mode, GAME_STATES.PAUSED), access: {}, weekKey: WEEK }),
      key,
      mode
    );
  }
});

test('initial focus: a weekly run of this week focuses Weekly, an older week plain Flux', () => {
  const current = engineOf(GAME_MODES.FLUX, GAME_STATES.PLAYING, { isWeeklyFluxRun: true, weeklyWeekKey: WEEK });
  const stale = engineOf(GAME_MODES.FLUX, GAME_STATES.PLAYING, { isWeeklyFluxRun: true, weeklyWeekKey: OLD_WEEK });
  assert.equal(resolveInitialFocusKey({ engine: current, access: {}, weekKey: WEEK }), 'btnWeekly');
  assert.equal(resolveInitialFocusKey({ engine: stale, access: {}, weekKey: WEEK }), 'btnFlux');
});

test('initial focus: a locked active mode falls back to Continue', () => {
  const access = { [GAME_MODES.PUZZLE]: { unlocked: false }, [WEEKLY_ACCESS_KEY]: { unlocked: false } };
  assert.equal(
    resolveInitialFocusKey({ engine: engineOf(GAME_MODES.PUZZLE), access, weekKey: WEEK }),
    'btnCampaignContinue'
  );
  const weekly = engineOf(GAME_MODES.FLUX, GAME_STATES.PLAYING, { isWeeklyFluxRun: true, weeklyWeekKey: WEEK });
  assert.equal(resolveInitialFocusKey({ engine: weekly, access, weekKey: WEEK }), 'btnCampaignContinue');
});

/** Context with the two disclosures wired on fake elements. */
function disclosureContext({ puzzleToggleHidden = false } = {}) {
  const elements = {
    btnPuzzleStagesToggle: fakeElement({ hidden: puzzleToggleHidden }),
    puzzleStagesStrip: fakeElement({ hidden: true }),
    btnFluxSeedToggle: fakeElement(),
    fluxSeedEntry: fakeElement({ hidden: true })
  };
  elements.btnPuzzleStagesToggle.setAttribute('aria-expanded', 'false');
  elements.btnFluxSeedToggle.setAttribute('aria-expanded', 'false');
  return { elements };
}

const toggle = (ctx, name, force) => uiPlayHubMethods.togglePlayHubDisclosure.call(ctx, name, force);
const isOpen = (ctx, panelKey) => !ctx.elements[panelKey].classList.contains('hidden');

test('disclosures are exclusive and aria-expanded follows the panel', () => {
  const ctx = disclosureContext();
  assert.equal(toggle(ctx, 'puzzle'), true);
  assert.equal(isOpen(ctx, 'puzzleStagesStrip'), true);
  assert.equal(ctx.elements.btnPuzzleStagesToggle.getAttribute('aria-expanded'), 'true');

  assert.equal(toggle(ctx, 'seed'), true);
  assert.equal(isOpen(ctx, 'puzzleStagesStrip'), false);
  assert.equal(isOpen(ctx, 'fluxSeedEntry'), true);
  assert.equal(ctx.elements.btnPuzzleStagesToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(ctx.elements.btnFluxSeedToggle.getAttribute('aria-expanded'), 'true');

  assert.equal(toggle(ctx, 'seed'), false);
  assert.equal(isOpen(ctx, 'fluxSeedEntry'), false);
  assert.equal(ctx.elements.btnFluxSeedToggle.getAttribute('aria-expanded'), 'false');
});

test('disclosure force flag opens or closes without toggling, unknown names do nothing', () => {
  const ctx = disclosureContext();
  assert.equal(toggle(ctx, 'puzzle', true), true);
  assert.equal(toggle(ctx, 'puzzle', true), true);
  assert.equal(isOpen(ctx, 'puzzleStagesStrip'), true);
  assert.equal(toggle(ctx, 'puzzle', false), false);
  assert.equal(isOpen(ctx, 'puzzleStagesStrip'), false);
  assert.equal(toggle(ctx, 'nope', true), false);
});

test('a disclosure whose toggle is hidden (locked mode) never opens', () => {
  const ctx = disclosureContext({ puzzleToggleHidden: true });
  assert.equal(toggle(ctx, 'puzzle', true), false);
  assert.equal(isOpen(ctx, 'puzzleStagesStrip'), false);
  assert.equal(ctx.elements.btnPuzzleStagesToggle.getAttribute('aria-expanded'), 'false');
});

test('the seed disclosure opens while Flux is locked (it has its own toggle)', () => {
  const ctx = disclosureContext();
  assert.equal(toggle(ctx, 'seed', true), true);
  assert.equal(isOpen(ctx, 'fluxSeedEntry'), true);
});

test('collapsePlayHubDisclosures closes everything', () => {
  const ctx = disclosureContext();
  toggle(ctx, 'seed', true);
  uiPlayHubMethods.collapsePlayHubDisclosures.call({ ...ctx, togglePlayHubDisclosure: uiPlayHubMethods.togglePlayHubDisclosure });
  assert.equal(isOpen(ctx, 'fluxSeedEntry'), false);
  assert.equal(isOpen(ctx, 'puzzleStagesStrip'), false);
});

test('the 2P entry shows only when two boards fit and the duel is unlocked', () => {
  assert.deepEqual(resolveVersusLocalEntry({ fits: true, unlocked: true }), { showButton: true, showHint: false });
  assert.deepEqual(resolveVersusLocalEntry({ fits: false, unlocked: true }), { showButton: false, showHint: true });
  assert.deepEqual(resolveVersusLocalEntry({ fits: true, unlocked: false }), { showButton: false, showHint: false });
  assert.deepEqual(resolveVersusLocalEntry({ fits: false, unlocked: false }), { showButton: false, showHint: false });
});

function versusContext({ fits, unlocked, lobbyOpen = false }) {
  const closed = [];
  return {
    closed,
    elements: { btnVersusLocalHub: fakeElement(), versusLocalHubHint: fakeElement({ hidden: true }) },
    canHostVersusLocal: () => fits,
    getModeAccess: () => ({ [GAME_MODES.VERSUS]: { unlocked } }),
    isVersusLocalLobbyOpen: () => lobbyOpen,
    closeVersusLocalLobby: () => closed.push(true)
  };
}

test('syncPlayHubVersusLocal toggles the 2P button and its hint on the DOM', () => {
  const sync = (ctx) => uiPlayHubMethods.syncPlayHubVersusLocal.call(ctx);
  const hidden = (ctx, key) => ctx.elements[key].classList.contains('hidden');

  const fits = versusContext({ fits: true, unlocked: true });
  sync(fits);
  assert.equal(hidden(fits, 'btnVersusLocalHub'), false);
  assert.equal(hidden(fits, 'versusLocalHubHint'), true);

  const small = versusContext({ fits: false, unlocked: true });
  sync(small);
  assert.equal(hidden(small, 'btnVersusLocalHub'), true);
  assert.equal(hidden(small, 'versusLocalHubHint'), false);

  const locked = versusContext({ fits: true, unlocked: false });
  sync(locked);
  assert.equal(hidden(locked, 'btnVersusLocalHub'), true);
  assert.equal(hidden(locked, 'versusLocalHubHint'), true);

  const shrunk = versusContext({ fits: false, unlocked: true, lobbyOpen: true });
  sync(shrunk);
  assert.equal(shrunk.closed.length, 1);
});

test('A18: only the running mode counts as running, Weekly follows the current week', () => {
  const endless = engineOf(GAME_MODES.ENDLESS, GAME_STATES.PAUSED);
  assert.equal(isModeRunning(endless, GAME_MODES.ENDLESS, WEEK), true);
  assert.equal(isModeRunning(endless, GAME_MODES.FLUX, WEEK), false);
  assert.equal(isModeRunning(engineOf(GAME_MODES.ENDLESS, GAME_STATES.GAME_OVER), GAME_MODES.ENDLESS, WEEK), false);
  assert.equal(isModeRunning(engineOf(GAME_MODES.ENDLESS, GAME_STATES.READY), GAME_MODES.ENDLESS, WEEK), false);

  const weekly = engineOf(GAME_MODES.FLUX, GAME_STATES.PLAYING, { isWeeklyFluxRun: true, weeklyWeekKey: WEEK });
  assert.equal(isModeRunning(weekly, WEEKLY_ACCESS_KEY, WEEK), true);
  assert.equal(isModeRunning(weekly, GAME_MODES.FLUX, WEEK), false);
  const stale = engineOf(GAME_MODES.FLUX, GAME_STATES.PLAYING, { isWeeklyFluxRun: true, weeklyWeekKey: OLD_WEEK });
  assert.equal(isModeRunning(stale, WEEKLY_ACCESS_KEY, WEEK), false);
  assert.equal(isModeRunning(stale, GAME_MODES.FLUX, WEEK), true);
});

test('A18: activating the running mode card resumes it and closes the hub', () => {
  const calls = [];
  const ctx = {
    elements: { modalPlay: {} },
    autoPausedByOverlay: false,
    engine: { mode: GAME_MODES.BLITZ, state: GAME_STATES.PAUSED, togglePause: () => calls.push('togglePause') },
    closeOverlayModal: (modal) => calls.push(modal),
    resumePlayHubRun: uiPlayHubMethods.resumePlayHubRun
  };
  const resumed = uiPlayHubMethods.resumePlayHubModeIfRunning.call(ctx, GAME_MODES.BLITZ);
  assert.equal(resumed, true);
  assert.deepEqual(calls, ['togglePause', ctx.elements.modalPlay]);

  const other = uiPlayHubMethods.resumePlayHubModeIfRunning.call(ctx, GAME_MODES.CASCADE);
  assert.equal(other, false);
  assert.equal(calls.length, 2);
});

test('A18: a run held by an overlay is released by the close, not by a manual unpause', () => {
  const calls = [];
  const ctx = {
    elements: { modalPlay: {} },
    autoPausedByOverlay: true,
    engine: { mode: GAME_MODES.PUZZLE, state: GAME_STATES.PAUSED, togglePause: () => calls.push('togglePause') },
    closeOverlayModal: () => calls.push('close'),
    resumePlayHubRun: uiPlayHubMethods.resumePlayHubRun
  };
  assert.equal(uiPlayHubMethods.resumePlayHubModeIfRunning.call(ctx, GAME_MODES.PUZZLE), true);
  assert.deepEqual(calls, ['close']);
});

const CATALOG = { firstLevelId: 1, lastLevelId: 4, maxStars: 3 };

test('A19 continue target: fresh profile', () => {
  const base = { ...CATALOG, suggestedLevelId: 1, clearedLevel: 0, levelStats: {} };
  assert.deepEqual(resolveContinueTarget({ ...base, campaignRunActive: false }), { kind: CONTINUE_KINDS.PLAY, levelId: 1 });
  assert.deepEqual(resolveContinueTarget({ ...base, campaignRunActive: true }), { kind: CONTINUE_KINDS.RESUME, levelId: 1 });
});

test('A19 continue target: mid campaign', () => {
  const base = { ...CATALOG, suggestedLevelId: 3, clearedLevel: 2, levelStats: { 1: { stars: 3 }, 2: { stars: 1 } } };
  assert.deepEqual(resolveContinueTarget({ ...base, campaignRunActive: false }), { kind: CONTINUE_KINDS.PLAY, levelId: 3 });
  assert.deepEqual(resolveContinueTarget({ ...base, campaignRunActive: true }), { kind: CONTINUE_KINDS.RESUME, levelId: 3 });
});

test('A19 continue target: all cleared with incomplete stars goes to the first incomplete level', () => {
  const levelStats = { 1: { stars: 3 }, 2: { stars: 2 }, 3: { stars: 3 }, 4: { stars: 1 } };
  const target = resolveContinueTarget({
    ...CATALOG,
    suggestedLevelId: 4,
    clearedLevel: 4,
    levelStats,
    campaignRunActive: false
  });
  assert.deepEqual(target, { kind: CONTINUE_KINDS.PLAY, levelId: 2 });
});

test('A19 continue target: all perfect turns the button into the campaign map', () => {
  const levelStats = { 1: { stars: 3 }, 2: { stars: 3 }, 3: { stars: 3 }, 4: { stars: 3 } };
  const target = resolveContinueTarget({
    ...CATALOG,
    suggestedLevelId: 4,
    clearedLevel: 4,
    levelStats,
    campaignRunActive: false
  });
  assert.deepEqual(target, { kind: CONTINUE_KINDS.MAP, levelId: null });
});

test('chapter stars are summed and clamped to the perfect score', () => {
  const chapter = { firstId: 2, lastId: 4 };
  assert.deepEqual(sumChapterStars(chapter, { 1: { stars: 3 }, 2: { stars: 2 }, 3: { stars: 9 } }, 3), {
    stars: 5,
    maxStars: 9
  });
  assert.deepEqual(sumChapterStars(chapter, {}, 3), { stars: 0, maxStars: 9 });
});

test('reward chips: done today, streak, first-play bonus and nothing', () => {
  assert.deepEqual(describeDailyReward({ played: true, streak: 1, bonusCoins: 30 }, stubT), {
    text: 'modals.play.daily.done',
    ariaLabel: ''
  });
  assert.match(describeDailyReward({ played: true, streak: 4, bonusCoins: 30 }, stubT).text, /^modals\.play\.daily\.doneStreak\|/);
  const bonus = describeDailyReward({ played: false, streak: 0, bonusCoins: 30 }, stubT);
  assert.match(bonus.text, /^modals\.play\.reward\|/);
  assert.match(bonus.ariaLabel, /^modals\.play\.rewardAria\|/);
  assert.equal(describeDailyReward({ played: false, streak: 0, bonusCoins: 0 }, stubT).text, '');

  assert.match(describeWeeklyReward({ bestScore: 500, bonusCoins: 40, claimed: true }, stubT).text, /^modals\.levelSelect\.card\.bestScore\|/);
  assert.match(describeWeeklyReward({ bestScore: 0, bonusCoins: 40, claimed: false }, stubT).text, /^modals\.play\.reward\|/);
  assert.equal(describeWeeklyReward({ bestScore: 0, bonusCoins: 40, claimed: true }, stubT).text, '');
});

test('WEEKLY_ACCESS_KEY is the pseudo access key of Weekly Flux', () => {
  assert.equal(WEEKLY_ACCESS_KEY, 'weekly');
});

test('openPlayHubVersusLocal sets the picker opener, then opens picker and lobby when unlocked', () => {
  const calls = [];
  const hubButton = {};
  const ctx = {
    elements: { btnVersusLocalHub: hubButton },
    runIfModeUnlocked: (mode, start) => {
      calls.push(mode);
      start();
    },
    openVersusTierPicker: () => calls.push('picker'),
    openVersusLocalLobby: () => calls.push('lobby')
  };
  uiPlayHubMethods.openPlayHubVersusLocal.call(ctx);
  assert.deepEqual(calls, [GAME_MODES.VERSUS, 'picker', 'lobby']);
  assert.equal(ctx.versusTierOpener, hubButton);
});

test('isPlayHubOpen reads the dialog visibility', () => {
  const modal = fakeElement({ hidden: true });
  const ctx = { elements: { modalPlay: modal } };
  assert.equal(uiPlayHubMethods.isPlayHubOpen.call(ctx), false);
  modal.classList.remove('hidden');
  assert.equal(uiPlayHubMethods.isPlayHubOpen.call(ctx), true);
  assert.equal(uiPlayHubMethods.isPlayHubOpen.call({ elements: {} }), false);
});

test('P3-4: only a plain Flux run makes the Flux card the running one', () => {
  const plain = engineOf(GAME_MODES.FLUX, GAME_STATES.PLAYING);
  assert.equal(isModeRunning(plain, GAME_MODES.FLUX, WEEK), true);
  const variants = {
    shared: { isSharedFluxRun: true },
    pastWeekly: { isWeeklyFluxRun: true, isSharedFluxRun: true, weeklyWeekKey: OLD_WEEK },
    ghostDuel: { ghostDuel: { ghost: {} } }
  };
  for (const [name, extra] of Object.entries(variants)) {
    const engine = engineOf(GAME_MODES.FLUX, GAME_STATES.PAUSED, extra);
    assert.equal(isModeRunning(engine, GAME_MODES.FLUX, WEEK), false, `${name}: no Flux card is running`);
    assert.equal(isModeRunning(engine, WEEKLY_ACCESS_KEY, WEEK), false, `${name}: Weekly is not running either`);
  }
});
