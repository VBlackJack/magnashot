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
  PLAY_HUB_FILTERS,
  PLAY_HUB_TABS,
  describeDailyReward,
  describeWeeklyReward,
  isModeRunning,
  resolveContinueTarget,
  resolveInitialFocusKey,
  resolveModeMastery,
  resolveModeMasteryProgress,
  resolvePlayHubTabForFocusKey,
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

test('resolveModeMastery marks only modes that meet configured mastery milestones', () => {
  const cfg = {
    puzzles: new Array(20).fill({}),
    scoring: { maxStars: 3 },
    playHub: { mastery: { endlessScore: 5000, pinballStage: 3, mergeTier: 7 } }
  };
  const storage = {
    getEndlessHighScore: () => 5200,
    getPuzzleTotalStars: () => 60,
    getPinballBestStage: () => 2,
    getMergeBestTier: () => 7
  };
  const mastery = resolveModeMastery(storage, cfg);
  assert.equal(mastery[GAME_MODES.ENDLESS], true);
  assert.equal(mastery[GAME_MODES.PUZZLE], true);
  assert.equal(mastery[GAME_MODES.PINBALL], false);
  assert.equal(mastery[GAME_MODES.MERGE], true);
});

test('resolveModeMastery reads StorageManager.getVersusRecords().hard.w for Polarity Duel mastery', () => {
  const cfg = { playHub: { mastery: { versusHardWins: 1 } } };
  const unmastered = resolveModeMastery({ getVersusRecords: () => ({ easy: { w: 3, l: 0 }, normal: { w: 2, l: 0 }, hard: { w: 0, l: 1 } }) }, cfg);
  assert.equal(unmastered[GAME_MODES.VERSUS], false);
  const mastered = resolveModeMastery({ getVersusRecords: () => ({ easy: { w: 0, l: 0 }, normal: { w: 0, l: 0 }, hard: { w: 1, l: 0 } }) }, cfg);
  assert.equal(mastered[GAME_MODES.VERSUS], true);
});

test('resolveModeMastery tracks campaign stars and daily streak thresholds', () => {
  const cfg = { playHub: { mastery: { campaignStars: 30, dailyStreak: 3 } } };
  const partial = resolveModeMastery(
    { getTotalStars: () => 29, getDailyStreak: () => 2 },
    cfg
  );
  assert.equal(partial[GAME_MODES.CAMPAIGN], false);
  assert.equal(partial[GAME_MODES.DAILY], false);

  const complete = resolveModeMastery(
    { getTotalStars: () => 30, getDailyStreak: () => 3 },
    cfg
  );
  assert.equal(complete[GAME_MODES.CAMPAIGN], true);
  assert.equal(complete[GAME_MODES.DAILY], true);
});

test('resolveModeMasteryProgress computes clamped ratios and refreshPlayHubRecords renders progress meters', () => {
  const cfg = {
    puzzles: new Array(10).fill({}),
    scoring: { maxStars: 3 },
    playHub: { mastery: { campaignStars: 30, dailyStreak: 3, endlessScore: 5000, pinballStage: 4 } }
  };
  const progress = resolveModeMasteryProgress(
    {
      getTotalStars: () => 15,
      getDailyStreak: () => 6,
      getEndlessHighScore: () => 2500,
      getPinballBestStage: () => 0,
      getPuzzleTotalStars: () => 18
    },
    cfg
  );
  assert.deepEqual(progress[GAME_MODES.CAMPAIGN], { current: 15, target: 30, ratio: 0.5, mastered: false });
  assert.deepEqual(progress[GAME_MODES.DAILY], { current: 6, target: 3, ratio: 1, mastered: true });
  assert.deepEqual(progress[GAME_MODES.ENDLESS], { current: 2500, target: 5000, ratio: 0.5, mastered: false });
  assert.deepEqual(progress[GAME_MODES.PINBALL], { current: 0, target: 4, ratio: 0, mastered: false });
  assert.deepEqual(progress[GAME_MODES.PUZZLE], { current: 18, target: 30, ratio: 0.6, mastered: false });

  // DOM meter renders on partial progress and hides once mastered.
  const createNode = () => {
    const classes = new Set();
    const children = [];
    const attrs = new Map();
    const node = {
      className: '',
      textContent: '',
      style: {},
      classList: {
        contains: (c) => classes.has(c) || node.className.split(/\s+/).includes(c),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle: (c, force) => {
          const on = force === undefined ? !classes.has(c) : Boolean(force);
          if (on) { classes.add(c); } else { classes.delete(c); }
          return on;
        }
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      append: (...items) => children.push(...items),
      querySelector: (sel) => {
        const cls = sel.replace(/^\./, '');
        for (const ch of children) {
          if (ch.className.split(/\s+/).includes(cls)) {
            return ch;
          }
          const nested = ch.querySelector?.(sel);
          if (nested) {
            return nested;
          }
        }
        return null;
      }
    };
    return node;
  };

  const prevDoc = globalThis.document;
  globalThis.document = { createElement: () => createNode() };
  try {
    const endlessCard = createNode();
    const ctx = {
      gameConfig: cfg,
      storageManager: {
        getEndlessHighScore: () => 2500,
        getTotalStars: () => 15,
        getDailyStreak: () => 1
      },
      elements: { btnEndless: endlessCard },
      describeDailyRewardChip: () => ({ text: '', ariaLabel: '' }),
      describeWeeklyRewardChip: () => ({ text: '', ariaLabel: '' })
    };
    uiPlayHubMethods.refreshPlayHubRecords.call(ctx);
    const meter = endlessCard.querySelector('.mode-mastery-meter');
    assert.ok(meter && !meter.classList.contains('hidden'), 'partial progress shows mastery meter');
    assert.equal(meter.querySelector('.mode-mastery-fill')?.style.width, '50%');

    ctx.storageManager.getEndlessHighScore = () => 6000;
    uiPlayHubMethods.refreshPlayHubRecords.call(ctx);
    assert.equal(endlessCard.classList.contains('is-mastered'), true);
    assert.equal(meter.classList.contains('hidden'), true, 'meter hides once mastered');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('resolvePlayHubTabForFocusKey maps featured, arcade, and duel cards to their tabs', () => {
  assert.equal(resolvePlayHubTabForFocusKey('btnCampaignContinue'), PLAY_HUB_TABS.FEATURED);
  assert.equal(resolvePlayHubTabForFocusKey('btnDaily'), PLAY_HUB_TABS.FEATURED);
  assert.equal(resolvePlayHubTabForFocusKey('btnWeekly'), PLAY_HUB_TABS.FEATURED);
  assert.equal(resolvePlayHubTabForFocusKey('btnEndless'), PLAY_HUB_TABS.ARCADE);
  assert.equal(resolvePlayHubTabForFocusKey('btnModeBlitz'), PLAY_HUB_TABS.ARCADE);
  assert.equal(resolvePlayHubTabForFocusKey('btnModeSlingshot'), PLAY_HUB_TABS.ARCADE);
  assert.equal(resolvePlayHubTabForFocusKey('btnModeVersus'), PLAY_HUB_TABS.DUEL);
  assert.equal(resolvePlayHubTabForFocusKey(null), PLAY_HUB_TABS.FEATURED);
});

test('switchPlayHubTab syncs active class, aria-selected, tabIndex, pane visibility, and scrollTop', () => {
  const modalCard = { scrollTop: 240 };
  const elements = {
    modalPlay: { querySelector: () => modalCard },
    tabPlayFeatured: fakeElement(),
    tabPlayArcade: fakeElement(),
    tabPlayDuel: fakeElement(),
    playPaneFeatured: fakeElement(),
    playPaneArcade: fakeElement({ hidden: true }),
    playPaneDuel: fakeElement({ hidden: true })
  };
  const ctx = {
    elements,
    getPlayHubTabs: uiPlayHubMethods.getPlayHubTabs
  };

  uiPlayHubMethods.switchPlayHubTab.call(ctx, PLAY_HUB_TABS.ARCADE);
  assert.equal(ctx.activePlayHubTab, PLAY_HUB_TABS.ARCADE);
  assert.equal(elements.tabPlayArcade.classList.contains('active'), true);
  assert.equal(elements.tabPlayArcade.getAttribute('aria-selected'), 'true');
  assert.equal(elements.tabPlayArcade.tabIndex, 0);
  assert.equal(elements.playPaneArcade.classList.contains('hidden'), false);
  assert.equal(elements.playPaneFeatured.classList.contains('hidden'), true);
  assert.equal(elements.tabPlayFeatured.tabIndex, -1);
  assert.equal(modalCard.scrollTop, 0);

  uiPlayHubMethods.switchPlayHubTab.call(ctx, 'unknown-tab');
  assert.equal(ctx.activePlayHubTab, PLAY_HUB_TABS.FEATURED);
  assert.equal(elements.playPaneFeatured.classList.contains('hidden'), false);
});

test('openPlayHub selects the tab of the running mode or expanded disclosure and resets stale Arcade filters', () => {
  const switched = [];
  const focused = [];
  const makeHubCtx = ({ mode, unlocked = true, filter = PLAY_HUB_FILTERS.ALL, puzzleToggleHidden = false }) => {
    const elements = {
      modalPlay: {},
      playHubHint: fakeElement(),
      btnCampaignContinue: fakeElement(),
      btnEndless: fakeElement(),
      btnModeVersus: fakeElement(),
      btnClosePlay: fakeElement(),
      btnPuzzleStagesToggle: fakeElement({ hidden: puzzleToggleHidden }),
      puzzleStagesStrip: fakeElement({ hidden: true }),
      btnFluxSeedToggle: fakeElement(),
      fluxSeedEntry: fakeElement({ hidden: true })
    };
    return {
      elements,
      engine: engineOf(mode, GAME_STATES.PAUSED),
      playHubFilter: filter,
      getModeAccess: () => ({ [mode]: { unlocked } }),
      refreshPlayHubRecords: () => {},
      refreshVersusCard: () => {},
      renderPuzzleStagesStrip: () => {},
      refreshModeLocks: () => {},
      refreshPlayHubCampaign: () => {},
      collapsePlayHubDisclosures: uiPlayHubMethods.collapsePlayHubDisclosures,
      togglePlayHubDisclosure: uiPlayHubMethods.togglePlayHubDisclosure,
      syncPlayHubVersusLocal: () => {},
      switchPlayHubTab: (tab) => switched.push(tab),
      openOverlayModal: (_modal, target) => focused.push(target)
    };
  };

  const arcadeCtx = makeHubCtx({ mode: GAME_MODES.ENDLESS, filter: PLAY_HUB_FILTERS.QUICK });
  uiPlayHubMethods.openPlayHub.call(arcadeCtx);
  assert.equal(arcadeCtx.playHubFilter, PLAY_HUB_FILTERS.ALL, 'stale filter resets before focusing running Arcade card');
  assert.equal(switched.at(-1), PLAY_HUB_TABS.ARCADE);
  assert.equal(focused.at(-1), arcadeCtx.elements.btnEndless);

  const lockedCtx = makeHubCtx({ mode: GAME_MODES.ENDLESS, unlocked: false });
  uiPlayHubMethods.openPlayHub.call(lockedCtx);
  assert.equal(switched.at(-1), PLAY_HUB_TABS.FEATURED, 'locked running mode falls back to Featured tab');
  assert.equal(focused.at(-1), lockedCtx.elements.btnCampaignContinue);

  const duelCtx = makeHubCtx({ mode: GAME_MODES.VERSUS });
  uiPlayHubMethods.openPlayHub.call(duelCtx);
  assert.equal(switched.at(-1), PLAY_HUB_TABS.DUEL);
  assert.equal(focused.at(-1), duelCtx.elements.btnModeVersus);

  const expandCtx = makeHubCtx({ mode: GAME_MODES.CAMPAIGN, filter: PLAY_HUB_FILTERS.ENDLESS });
  uiPlayHubMethods.openPlayHub.call(expandCtx, { expand: 'puzzle' });
  assert.equal(expandCtx.playHubFilter, PLAY_HUB_FILTERS.ALL);
  assert.equal(switched.at(-1), PLAY_HUB_TABS.ARCADE);
});

test('Arcade filter does not hide Weekly or Versus cards in other tabs', () => {
  const elements = {
    btnEndless: fakeElement(),
    btnModeBlitz: fakeElement(),
    btnWeekly: fakeElement(),
    btnModeVersus: fakeElement()
  };
  const ctx = {
    gameConfig: { puzzles: [{}], scoring: { maxStars: 3 }, theme: { starFilledSymbol: '*' } },
    storageManager: {},
    elements,
    playHubFilter: PLAY_HUB_FILTERS.QUICK,
    describeDailyRewardChip: () => ({ text: '', ariaLabel: '' }),
    describeWeeklyRewardChip: () => ({ text: '', ariaLabel: '' })
  };
  uiPlayHubMethods.refreshPlayHubRecords.call(ctx);
  assert.equal(elements.btnEndless.classList.contains('hidden'), true, 'non-quick Arcade mode is hidden');
  assert.equal(elements.btnModeBlitz.classList.contains('hidden'), false, 'quick Arcade mode stays visible');
  assert.equal(elements.btnWeekly.classList.contains('hidden'), false, 'Weekly card in Featured tab is untouched');
  assert.equal(elements.btnModeVersus.classList.contains('hidden'), false, 'Versus card in Duel tab is untouched');
});
