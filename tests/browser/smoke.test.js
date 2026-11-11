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

/*
 * Browser smoke tests: the real page in headless Chromium, at the layouts the game
 * supports. They catch what the engine tests cannot see: console errors, layout overflow,
 * dialogs that do not open, pause or close, and end-of-round screens.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { GAME_MODES, GAME_OVER_REASONS, GAME_STATES, SPECIAL_TYPES_ORDER } from '../../src/core/Constants.js';
import { SeededRandom } from '../../src/core/SeededRandom.js';
import { decodeGhost, encodeGhost } from '../../src/game/GhostCodec.js';
import { startStaticServer } from './staticServer.js';

/**
 * The layouts of styles/main.css: wide desktop, portrait tablet, landscape and portrait
 * phones, and a narrow portrait phone where the eight-button control row is the tightest.
 * hasDrawer / hasRestartButton: all viewports expose the slide-in burger menu and Restart.
 * Both flags stay explicit per viewport in the test matrix.
 */
const VIEWPORTS = Object.freeze([
  { name: 'desktop', width: 1300, height: 850, isTouch: false, hasDrawer: true, hasRestartButton: true },
  { name: 'tablet', width: 768, height: 1024, isTouch: true, hasDrawer: true, hasRestartButton: true },
  { name: 'phone landscape', width: 844, height: 390, isTouch: true, hasDrawer: true, hasRestartButton: true },
  { name: 'phone portrait', width: 390, height: 844, isTouch: true, hasDrawer: true, hasRestartButton: true },
  { name: 'narrow phone portrait', width: 360, height: 800, isTouch: true, hasDrawer: true, hasRestartButton: true }
]);

/** Controls whose text must fit: a clipped label is a layout regression. */
const FITTED_TEXT_SELECTOR =
  '.nav-btn, .modal-btn, .modal-tab, .powerup-btn, .powerup-name, .launcher-caption, .hud-label, .hud-value';

/** Sub-pixel rounding tolerance when comparing scroll and client sizes. */
const OVERFLOW_TOLERANCE_PX = 1;
/** A generated level in a later chapter, for the campaign map tests. */
const UNLOCKED_GENERATED_LEVEL = 130;

/** Track count of the HUD grid in the wide desktop layout and in the compact phone landscape layout. */
const DESKTOP_HUD_TRACKS = 3;
const PHONE_LANDSCAPE_HUD_TRACKS = 4;
/** The panel's border and rounding, which scrollHeight leaves out. */
const PANEL_BORDER_ALLOWANCE_PX = 4;
/** Free space the hugging panel must leave above the dock at the desktop size. */
const PANEL_HUG_MIN_SLACK_PX = 20;
/** A short, wide window: the side panel must stay above the Polarity/Swap dock. */
const SHORT_WIDE_VIEWPORT = Object.freeze({ width: 1000, height: 520, isTouch: false });

/** Upper bound for any wait on the page, so a broken page fails instead of hanging. */
const WAIT_TIMEOUT_MS = 20000;

/** Layouts with the side panel, where a level without special balls says so in the panel. */
const EMPTY_SPECIALS_NOTE_VIEWPORTS = new Set(['desktop', 'tablet']);
/** Layouts where the Settings install entry is exercised: in the header and in the slide-in menu. */
const INSTALL_ENTRY_VIEWPORTS = new Set(['desktop', 'phone portrait']);
/** Layout whose board overlays move off the board, into the column beside it. */
const OFF_BOARD_BANNERS_VIEWPORT = 'phone landscape';
/** Layout that fades the hint out while the finger is on the board. */
const HINT_FADE_VIEWPORT = 'phone portrait';
/** Special ball equipped to raise its banner. */
const BANNER_SPECIAL_TYPE = 'bomb';
/** Horizontal place of a release in the cancel zone, as a fraction of the board width: clear of the launcher and of the next ball. */
const CANCEL_RELEASE_X_FRACTION = 0.85;
/** Text of the Daily countdown on the game over screen, in both locales. */
const DAILY_COUNTDOWN_PATTERN = /\d+ h \d+ min/;
/** Mark of a pending bonus on the Daily nav button. */
const DAILY_BONUS_MARK = '+';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const GAME_CONFIG = JSON.parse(readFileSync(new URL('../../configs/game.json', import.meta.url), 'utf8'));
const STORAGE_PREFIX = GAME_CONFIG.storage.prefix;
const STORAGE_KEYS = GAME_CONFIG.storage.keys;

/** An existing player's save from before the schema was versioned: levels cleared, schema 1. */
const EXISTING_PLAYER_UNLOCKED_LEVEL = 5;
const EXISTING_PLAYER_STORAGE = Object.freeze({
  [`${STORAGE_PREFIX}${STORAGE_KEYS.unlockedLevel}`]: String(EXISTING_PLAYER_UNLOCKED_LEVEL),
  [`${STORAGE_PREFIX}${STORAGE_KEYS.schemaVersion}`]: '1'
});
/** A valid shared Flux seed (length and radix from configs/flux.json). */
const SHARED_FLUX_SEED = 'abc234';
/** The gated mode a fresh profile tries first, and the campaign level that opens it. */
const LOCKED_MODE_BUTTON = '#btn-endless';
const LOCKED_MODE_REQUIRED_LEVEL = GAME_CONFIG.modeUnlocks.campaignLevelCleared.endless;
const LOCKED_MODE_BUTTONS = Object.freeze(['#btn-endless', '#btn-flux', '#btn-weekly']);
/** Campaign level that opens the Weekly Flux card (it opens with Flux or with this level, whichever comes first). */
const WEEKLY_REQUIRED_LEVEL = GAME_CONFIG.weeklyFlux.unlockAfterCampaignLevel;
/** The HUD Sag meter, and the Classic card of the Play hub with the level that opens it. */
const SAG_METER_SELECTOR = '#hud-sag-meter';
const CLASSIC_CARD_SELECTOR = '#btn-mode-classic';
const CLASSIC_REQUIRED_LEVEL = GAME_CONFIG.modeUnlocks.campaignLevelCleared.classic;
const FLUX_CONFIG = JSON.parse(readFileSync(new URL('../../configs/flux.json', import.meta.url), 'utf8'));
const DUEL_CONFIG = GAME_CONFIG.ghostDuel;
/** Rival run of the duel links: six shots, cumulative score per shot. */
const RIVAL_SHOT_SCORES = Object.freeze([200, 500, 800, 1100, 1300, 1500]);
const RIVAL_NAME = 'Sam';
/** A past Daily inside the replay window, in days before today. */
const REMATCH_AGE_DAYS = 3;
const MS_PER_DAY = 86400000;
/** Score set on the player's run before it ends, to find it again in the challenge link. */
const PLAYER_FINAL_SCORE = 777;
/** A Daily record to beat, so a normal Daily shows its best-run marker in the badge row. */
const DAILY_RECORD_TO_BEAT = 5000;
const UNLOCKED_MODE_BUTTONS = Object.freeze(['#btn-daily', ...LOCKED_MODE_BUTTONS]);

/** Both locale files, read from disk so no assertion hardcodes a UI string. */
const LOCALES = Object.freeze({
  en: JSON.parse(readFileSync(new URL('../../locales/en.json', import.meta.url), 'utf8')),
  fr: JSON.parse(readFileSync(new URL('../../locales/fr.json', import.meta.url), 'utf8'))
});

/** A text of a locale file by dotted key, with its {{token}} placeholders filled from params. */
function localeText(language, key, params = {}) {
  const raw = key.split('.').reduce((node, part) => (node === undefined || node === null ? undefined : node[part]), LOCALES[language]);
  assert.equal(typeof raw, 'string', `${language} locale has the key ${key}`);
  return raw.replace(/\{\{(\w+)\}\}/g, (token, name) => (Object.hasOwn(params, name) ? String(params[name]) : token));
}

/** A profile pinned to a language, whatever the browser language. */
const languageStorage = (language) => ({ [`${STORAGE_PREFIX}${STORAGE_KEYS.language}`]: language });

/** A player past the level that opens Polarity Duel (a save of schema 1 moves to the current one on load). */
const VERSUS_PLAYER_STORAGE = Object.freeze({
  [`${STORAGE_PREFIX}${STORAGE_KEYS.unlockedLevel}`]: String(GAME_CONFIG.modeUnlocks.campaignLevelCleared.versus + 2),
  [`${STORAGE_PREFIX}${STORAGE_KEYS.schemaVersion}`]: '1',
  // The first-duel tutorial holds the match; the tests that are not about it start with it already seen.
  [`${STORAGE_PREFIX}${STORAGE_KEYS.versusTutorialSeen}`]: 'true'
});
/** The arrangement of the two boards that the room of each layout allows (versus.layout). */
const VERSUS_LAYOUT_BY_VIEWPORT = Object.freeze({
  desktop: 'split',
  tablet: 'split',
  'phone landscape': 'mini',
  'phone portrait': 'mini',
  'narrow phone portrait': 'mini'
});
/** Frames of the pause between two rounds, plus a margin, as milliseconds at 60 frames per second. */
const VERSUS_ROUND_BREAK_WAIT_MS =
  Math.ceil((GAME_CONFIG.versus.roundBreakFrames / GAME_CONFIG.versus.framesPerSecond) * 1000) + 3000;
/** Wins the player needs in a match. */
const VERSUS_ROUNDS_TO_WIN = GAME_CONFIG.versus.roundsToWin;
/** How long the boards are watched to see that they stand still. */
const VERSUS_HELD_CHECK_MS = 300;
const VERSUS_PLAYER_BOARD = 0;
const VERSUS_CPU_BOARD = 1;

let server;
let browser;

before(async () => {
  server = await startStaticServer(APP_ROOT);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Opens the game in a fresh profile and records every console error and uncaught exception.
 * The engine is reached through a prototype hook installed after load, so the game code
 * carries no test-only entry point.
 * initStorage: localStorage entries seeded before the game starts (a fresh profile when null).
 * path: page address relative to the server, for shared links.
 * initScript: function run in the page before the game's own scripts (e.g. a stubbed controller).
 */
async function openGame(viewport, { initStorage = null, path = '/', initScript = null } = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.isTouch,
    isMobile: viewport.isTouch,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(WAIT_TIMEOUT_MS);
  if (initStorage) {
    // Runs before the game's own scripts on every load of this page, like a save left by an earlier visit.
    await page.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) {
        window.localStorage.setItem(key, value);
      }
    }, initStorage);
  }
  if (initScript) {
    await page.addInitScript(initScript);
  }
  await page.goto(`${server.origin}${path}`);
  await captureEngine(page);
  return { context, page, errors };
}

async function captureEngine(page) {
  await page.evaluate(async () => {
    const { GameEngine } = await import('/src/game/GameEngine.js');
    const original = GameEngine.prototype.getTimeScale;
    // The game loop asks for the time scale on every frame, paused or not.
    GameEngine.prototype.getTimeScale = function captureAndScale(...args) {
      window.__fluxEngine = this;
      return original.apply(this, args);
    };
  });
  try {
    await page.waitForFunction(() => Boolean(window.__fluxEngine));
  } catch (err) {
    const state = await page.evaluate(async () => {
      const frames = await new Promise((resolve) => {
        let count = 0;
        const tick = () => { count += 1; if (count < 3) { requestAnimationFrame(tick); } };
        requestAnimationFrame(tick);
        setTimeout(() => resolve(count), 1000);
      });
      const banner = document.getElementById('bootstrap-error');
      return {
        visibility: document.visibilityState,
        readyState: document.readyState,
        bootstrapError: Boolean(banner) && !banner.classList.contains('hidden'),
        framesInOneSecond: frames
      };
    });
    err.message += ' | engine hook diagnostics: ' + JSON.stringify(state);
    throw err;
  }
}

const engineState = (page) => page.evaluate(() => window.__fluxEngine.state);

/**
 * Records the engines of a Polarity Duel match by board, through a prototype hook like captureEngine
 * (the versus scene never asks for the time scale, so the main engine hook does not see them).
 */
async function captureVersusEngines(page) {
  await page.evaluate(async () => {
    const { GameEngine } = await import('/src/game/GameEngine.js');
    const original = GameEngine.prototype.update;
    window.__versusBoards = [];
    window.__versusUpdates = 0;
    GameEngine.prototype.update = function captureVersusBoard(...args) {
      if (this.versus) {
        window.__versusBoards[this.versus.boardIndex] = this;
        window.__versusUpdates += 1;
      }
      return original.apply(this, args);
    };
  });
}

/** Opens the Play hub from the slide-in menu, the one dialog that lists every mode. */
async function openPlayHub(page, viewport) {
  await clickMenuButton(page, viewport, '#btn-play');
  await waitShown(page, '#modal-play');
}

/** Opens the Play hub, then the campaign map from its Campaign card. */
async function openCampaignMap(page, viewport) {
  await openPlayHub(page, viewport);
  await page.click('#btn-campaign-map');
  await waitShown(page, '#modal-levels');
}

/** Opens the Play hub, then the difficulty picker of Polarity Duel from its Duel card. */
async function openVersusTierPicker(page, viewport) {
  await openPlayHub(page, viewport);
  await page.click('#btn-mode-versus');
  await waitShown(page, '#modal-versus-tiers');
}

/**
 * Unlocks campaign levels on a fresh profile through the storage layer and reloads, so the game
 * boots on the furthest unlocked level (the save is then already at the current schema, so no
 * existing-player migration opens modes by itself).
 */
async function reloadWithUnlockedLevel(page, levelId) {
  await page.evaluate((id) => window.__fluxEngine.storageManager.unlockLevel(id), levelId);
  await page.reload();
  await captureEngine(page);
}

/** The text of an element, trimmed (the empty string for a missing element). */
const textOf = (page, selector) =>
  page.evaluate((sel) => document.querySelector(sel)?.textContent.trim() ?? '', selector);

/** True when a mode card carries the "New" badge. */
const hasNewBadge = (page, selector) =>
  page.evaluate((sel) => Boolean(document.querySelector(sel)?.querySelector('.mode-new-badge:not(.hidden)')), selector);

/** Starts a match against a tier and waits for the board of the player to be in play. */
async function startVersusMatch(page, viewport, tier) {
  await openVersusTierPicker(page, viewport);
  await page.click(`.versus-tier-btn[data-tier="${tier}"]`);
  await waitShown(page, '#versus-screen');
  await page.waitForFunction(() => Boolean(window.__versusBoards?.[0] && window.__versusBoards?.[1]));
}

/** Ends the round as if the CPU board crossed its danger line (the player wins the round). */
function winVersusRound(page) {
  return page.evaluate((reason) => window.__versusBoards[1].triggerGameOver(reason), GAME_OVER_REASONS.LINE_CROSSED);
}

/** Wins every round of the match; the next round starts by itself after the break. */
async function winVersusMatch(page) {
  for (let round = 1; round <= VERSUS_ROUNDS_TO_WIN; round++) {
    await page.waitForFunction(() => window.__versusBoards[1].state === 'playing');
    await winVersusRound(page);
    if (round < VERSUS_ROUNDS_TO_WIN) {
      await waitShown(page, '#versus-round-overlay');
      await page.waitForFunction(
        () => document.querySelector('#versus-round-overlay').classList.contains('hidden'),
        null,
        { timeout: VERSUS_ROUND_BREAK_WAIT_MS }
      );
    }
  }
  await waitShown(page, '#modal-duel-result');
}

/** Share of the viewport width (less the screen padding) the player board keeps in the portrait mini-view. */
const VERSUS_PLAYER_MIN_WIDTH_SHARE = 0.8;
/** Screen padding on each side, in pixels, that the player board width is measured against (--versus-pad twice). */
const VERSUS_SCREEN_PADDING_TOTAL_PX = 16;
/** Sub-pixel tolerance for the board intersection checks. */
const VERSUS_RECT_TOLERANCE_PX = 0.5;

/** Measures the player canvas and the rectangles of the CPU board parts that must stay clear of it. */
async function measureVersusMini(page) {
  return page.evaluate(() => {
    const rectOf = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width };
    };
    return {
      viewportWidth: window.innerWidth,
      player: rectOf('#versus-canvas-0'),
      cpu: ['#versus-canvas-1', '#versus-hud-1'].map((selector) => ({ selector, rect: rectOf(selector) }))
    };
  });
}

/** Fails when a CPU board part overlaps the player canvas, or (portrait) the player canvas is too narrow. */
async function assertVersusMiniClear(page, label, { isPortrait }) {
  const measured = await measureVersusMini(page);
  for (const { selector, rect } of measured.cpu) {
    const overlaps =
      rect.left < measured.player.right - VERSUS_RECT_TOLERANCE_PX &&
      rect.right > measured.player.left + VERSUS_RECT_TOLERANCE_PX &&
      rect.top < measured.player.bottom - VERSUS_RECT_TOLERANCE_PX &&
      rect.bottom > measured.player.top + VERSUS_RECT_TOLERANCE_PX;
    assert.equal(overlaps, false, `${label}: ${selector} overlaps the player canvas`);
  }
  if (isPortrait) {
    const minWidth = VERSUS_PLAYER_MIN_WIDTH_SHARE * (measured.viewportWidth - VERSUS_SCREEN_PADDING_TOTAL_PX);
    assert.ok(measured.player.width >= minWidth, `${label}: the player canvas is ${measured.player.width}px wide, under ${minWidth}px`);
  }
  return measured;
}

/** Fails when the versus screen scrolls or a board or control leaves the viewport. */
async function assertVersusFits(page, label) {
  const fit = await page.evaluate(() => {
    const screen = document.querySelector('#versus-screen');
    const inside = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
    };
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      screenScrollX: screen.scrollWidth - screen.clientWidth,
      screenScrollY: screen.scrollHeight - screen.clientHeight,
      outside: ['#versus-canvas-0', '#versus-canvas-1', '#versus-hud-0', '#versus-hud-1', '.versus-bar', '#btn-versus-pause']
        .filter((selector) => !inside(selector))
    };
  });
  assert.ok(fit.pageOverflow <= OVERFLOW_TOLERANCE_PX, `${label}: the page scrolls sideways`);
  assert.ok(fit.screenScrollX <= OVERFLOW_TOLERANCE_PX, `${label}: the versus screen scrolls sideways`);
  assert.ok(fit.screenScrollY <= OVERFLOW_TOLERANCE_PX, `${label}: the versus screen scrolls down`);
  assert.deepEqual(fit.outside, [], `${label}: parts of the screen are off the viewport`);
}

const isShown = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return Boolean(el) && !el.classList.contains('hidden') && el.checkVisibility();
  }, selector);

async function waitShown(page, selector) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el) && !el.classList.contains('hidden') && el.checkVisibility();
    },
    selector
  );
}

/** Starts a campaign level from a known state: playing, nothing open. */
async function startLevel(page, levelId) {
  await page.evaluate((id) => {
    const engine = window.__fluxEngine;
    engine.startCampaignLevel(id);
    engine.notifyUI();
  }, levelId);
  await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
}

const startLevelOne = (page) => startLevel(page, 1);

/**
 * Starts level 1 with its discovery hint on screen. The game boots into level 1, so its hint
 * already counts as seen; resetting the discoveries brings it back at once.
 */
async function startLevelOneWithHint(page) {
  await startLevelOne(page);
  await page.evaluate(() => window.__fluxEngine.resetDiscoveries());
  await waitShown(page, '#tutorial-banner');
}

/** Level 1 hands out no special ball; level 2 is the first that shows their slots. */
const LEVELS_WITHOUT_AND_WITH_SPECIALS = [
  { levelId: 1, showsSpecials: false },
  { levelId: 2, showsSpecials: true }
];

/** Fails when the page scrolls sideways or a visible control label is clipped. */
async function assertLayoutFits(page, levelId) {
  const layout = await page.evaluate(
    ({ selector, tolerance }) => {
      const clipped = [...document.querySelectorAll(selector)]
        .filter((el) => el.checkVisibility() && el.offsetWidth > tolerance)
        .filter((el) => el.scrollWidth > el.clientWidth + tolerance)
        .map((el) => `${el.id || el.className}: "${el.textContent.trim()}"`);
      return {
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        clipped
      };
    },
    { selector: FITTED_TEXT_SELECTOR, tolerance: OVERFLOW_TOLERANCE_PX }
  );
  assert.ok(
    layout.pageOverflow <= OVERFLOW_TOLERANCE_PX,
    `level ${levelId}: the page scrolls sideways by ${layout.pageOverflow}px`
  );
  assert.deepEqual(layout.clipped, [], `level ${levelId}: clipped labels`);
}

/** Clicks a header control; on portrait phones it sits in the slide-in menu. */
async function clickMenuButton(page, viewport, selector) {
  if (viewport.hasDrawer) {
    await page.click('#btn-menu');
  }
  await page.click(selector);
}

/**
 * Fails when a shown banner overlaps the board or the HUD bar by more than the rounding
 * tolerance on both axes.
 */
async function assertBannersOffBoard(page, label) {
  const overlaps = await page.evaluate((tolerance) => {
    const isVisible = (el) => Boolean(el) && !el.classList.contains('hidden') && el.checkVisibility();
    const intersects = (a, b) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
    const areas = ['#game-canvas', '.hud-bar']
      .map((selector) => ({ selector, el: document.querySelector(selector) }))
      .filter(({ el }) => isVisible(el));
    const found = [];
    for (const bannerSelector of ['#tutorial-banner', '#special-equipped-banner']) {
      const banner = document.querySelector(bannerSelector);
      if (!isVisible(banner)) {
        continue;
      }
      const bannerRect = banner.getBoundingClientRect();
      for (const { selector, el } of areas) {
        if (intersects(bannerRect, el.getBoundingClientRect())) {
          found.push(`${bannerSelector} over ${selector}`);
        }
      }
    }
    return found;
  }, OVERFLOW_TOLERANCE_PX);
  assert.deepEqual(overlaps, [], `${label}: banners overlap the board or the HUD`);
}

/** Clears the clipboard, taps Share, and returns the lines of the copied result. */
async function shareAndReadLines(page, url) {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await waitShown(page, '#btn-share-gameover');
  await page.click('#btn-share-gameover');
  await page.waitForFunction((address) => navigator.clipboard.readText().then((text) => text.endsWith(address)), url);
  return (await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/);
}

/** Ends the run as if the board crossed the danger line, and waits for the game over screen. */
async function loseRun(page) {
  await page.evaluate((reason) => window.__fluxEngine.triggerGameOver(reason), GAME_OVER_REASONS.LINE_CROSSED);
  await waitShown(page, '#modal-gameover');
}

const isMenuItemLocked = (page, selector) =>
  page.evaluate((sel) => document.querySelector(sel).getAttribute('aria-disabled') === 'true', selector);

/** Starts the Daily Challenge from a known state and waits for the run. */
async function startDailyRun(page) {
  await page.evaluate(() => {
    const engine = window.__fluxEngine;
    engine.startDailyChallenge();
    engine.spawnEndlessWave();
    engine.notifyUI();
  });
  await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
}

for (const viewport of VIEWPORTS) {
  describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test('boots without console errors, scrolls nowhere and clips no control label', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        for (const { levelId, showsSpecials } of LEVELS_WITHOUT_AND_WITH_SPECIALS) {
          await startLevel(page, levelId);
          // The star glyphs are hidden from screen readers; the hidden count speaks for them.
          const starCount = await page.evaluate(() => document.querySelector('#hud-star-count').textContent.trim());
          assert.match(starCount, /\d/, `level ${levelId} states its star count`);
          // The bar itself is display: contents on portrait phones, so check one of its buttons.
          assert.equal(await isShown(page, '#powerups-bar .powerup-btn'), showsSpecials, `level ${levelId} special ball slots`);
          if (showsSpecials || EMPTY_SPECIALS_NOTE_VIEWPORTS.has(viewport.name)) {
            assert.equal(await isShown(page, '#powerups-empty'), !showsSpecials, `level ${levelId} empty special balls note`);
          }
          await assertLayoutFits(page, levelId);
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('Settings, Play, Workshop and My stats pause the run and Escape closes them', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await startLevelOne(page);
        for (const { button, dialog } of [
          { button: '#btn-settings', dialog: '#modal-settings' },
          { button: '#btn-play', dialog: '#modal-play' },
          { button: '#btn-shop', dialog: '#modal-shop' },
          { button: '#btn-stats', dialog: '#modal-stats' }
        ]) {
          await clickMenuButton(page, viewport, button);
          await waitShown(page, dialog);
          assert.equal(await engineState(page), GAME_STATES.PAUSED, `${dialog} pauses the run`);
          assert.ok(
            await page.evaluate((sel) => document.querySelector(sel).contains(document.activeElement), dialog),
            `${dialog} takes focus`
          );
          await page.keyboard.press('Escape');
          await page.waitForFunction((sel) => document.querySelector(sel).classList.contains('hidden'), dialog);
          assert.equal(await engineState(page), GAME_STATES.PLAYING, `closing ${dialog} resumes the run`);
          assert.equal(await isShown(page, '#modal-pause'), false, `closing ${dialog} leaves no Pause dialog`);
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    for (const fromPause of [false, true]) {
      test(`Enter on the running level of the campaign map resumes the run and leaves no dialog open (${fromPause ? 'hub opened from Pause' : 'hub opened during play'})`, async () => {
        const { context, page, errors } = await openGame(viewport);
        try {
          await startLevelOne(page);
          if (fromPause) {
            await clickMenuButton(page, viewport, '#btn-pause');
            await waitShown(page, '#modal-pause');
            await page.click('#btn-levels-pause');
            await waitShown(page, '#modal-play');
          } else {
            await openPlayHub(page, viewport);
          }
          await page.click('#btn-campaign-map');
          await waitShown(page, '#modal-levels');
          await page.focus('#levels-grid .level-tile.current');
          await page.keyboard.press('Enter');
          await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
          for (const dialog of ['#modal-levels', '#modal-play', '#modal-pause']) {
            assert.equal(await isShown(page, dialog), false, `${dialog} is closed`);
          }
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }

    test('a fresh profile finds the gated modes locked in the Play hub; tapping one explains why and changes nothing', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await openPlayHub(page, viewport);
        for (const selector of LOCKED_MODE_BUTTONS) {
          assert.equal(await isMenuItemLocked(page, selector), true, `${selector} is locked`);
        }
        assert.equal(await isMenuItemLocked(page, '#btn-daily'), false, 'the Daily is always open');
        assert.equal(await isMenuItemLocked(page, '#btn-campaign-continue'), false, 'the Campaign is always open');
        await assertLayoutFits(page, 'locked Play hub');
        const modeBefore = await page.evaluate(() => window.__fluxEngine.mode);
        assert.equal(modeBefore, GAME_MODES.CAMPAIGN);
        // Playwright refuses to click an aria-disabled button: dispatch the click the player's tap would produce.
        await page.dispatchEvent(LOCKED_MODE_BUTTON, 'click');
        await page.waitForFunction(() => {
          const hint = document.querySelector('#play-hub-hint');
          return !hint.classList.contains('hidden') && hint.textContent.trim().length > 0;
        });
        assert.match(await page.textContent('#play-hub-hint'), new RegExp(`\\b${LOCKED_MODE_REQUIRED_LEVEL}\\b`));
        assert.equal(await page.evaluate(() => window.__fluxEngine.mode), modeBefore, 'the mode did not change');
        // Weekly Flux opens with the campaign (or with Flux): its hint names its own level.
        await page.dispatchEvent('#btn-weekly', 'click');
        await page.waitForFunction(
          (level) => new RegExp(`\\b${level}\\b`).test(document.querySelector('#play-hub-hint').textContent),
          WEEKLY_REQUIRED_LEVEL
        );
        assert.equal(await page.evaluate(() => window.__fluxEngine.mode), modeBefore, 'the mode did not change');
        assert.equal(await isShown(page, '#modal-play'), true, 'the hub stays open');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('Survival shows the Sag meter in the HUD without changing its grid, and a run of misses sets its warning', async () => {
      const { context, page, errors } = await openGame(viewport, { initStorage: EXISTING_PLAYER_STORAGE });
      try {
        await startLevelOne(page);
        assert.equal(await isShown(page, SAG_METER_SELECTOR), false, 'the campaign has no Sag meter');
        const campaignTracks = (await hudTrackCount(page)).tracks;
        await page.evaluate(() => {
          const engine = window.__fluxEngine;
          engine.startEndlessMode();
          engine.notifyUI();
        });
        await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
        await waitShown(page, SAG_METER_SELECTOR);
        const meter = await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          const rect = el.getBoundingClientRect();
          return {
            role: el.getAttribute('role'),
            valueText: el.getAttribute('aria-valuetext') || '',
            max: el.getAttribute('aria-valuemax'),
            left: rect.left,
            right: rect.right,
            width: window.innerWidth
          };
        }, SAG_METER_SELECTOR);
        assert.equal(meter.role, 'meter');
        assert.ok(meter.valueText.trim().length > 0, 'the meter states its value in words');
        assert.ok(Number(meter.max) > 0, 'the meter has a range');
        assert.ok(meter.left >= 0 && meter.right <= meter.width, 'the meter stays inside the window');
        await assertLayoutFits(page, 'survival');
        assert.equal((await hudTrackCount(page)).tracks, campaignTracks, 'the HUD grid keeps its columns');

        // One miss short of a drop: the meter warns. Driven through the engine, like the turn resolution does.
        await page.evaluate(() => {
          const engine = window.__fluxEngine;
          const { size } = engine.getSagState();
          for (let i = 0; i < size - 1; i++) {
            engine.resolveSagTurn({ removed: false, dropped: 0, frozen: false });
          }
          engine.notifyUI();
        });
        await page.waitForFunction(
          (selector) => document.querySelector(selector).classList.contains('warning'),
          SAG_METER_SELECTOR
        );
        await assertLayoutFits(page, 'survival warning');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a fresh profile finds the Classic card of the Play hub locked; tapping it names the level that opens it', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await openPlayHub(page, viewport);
        assert.equal(await isMenuItemLocked(page, CLASSIC_CARD_SELECTOR), true, 'the Classic card is locked');
        const modeBefore = await page.evaluate(() => window.__fluxEngine.mode);
        // Playwright refuses to click an aria-disabled button: dispatch the click the player's tap would produce.
        await page.dispatchEvent(CLASSIC_CARD_SELECTOR, 'click');
        await page.waitForFunction(() => {
          const hint = document.querySelector('#play-hub-hint');
          return !hint.classList.contains('hidden') && hint.textContent.trim().length > 0;
        });
        assert.match(await page.textContent('#play-hub-hint'), new RegExp(`\\b${CLASSIC_REQUIRED_LEVEL}\\b`));
        assert.equal(await page.evaluate(() => window.__fluxEngine.mode), modeBefore, 'the mode did not change');
        await assertLayoutFits(page, 'Play hub with the Classic card');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    // Only where Restart sits in the header: elsewhere it is in the Pause dialog, reached from a pause.
    if (viewport.hasRestartButton) {
      test('the Confirm of a mid-round Restart holds the run until it is dismissed', async () => {
        const { context, page, errors } = await openGame(viewport);
        try {
          await startLevelOne(page);
          await page.evaluate(() => {
            const engine = window.__fluxEngine;
            engine.dismissDiscovery();
            engine.shoot();
          });
          assert.ok(await page.evaluate(() => window.__fluxEngine.hasFiredInRound), 'one shot is fired');
          for (const dismiss of [() => page.click('#btn-confirm-no'), () => page.keyboard.press('Escape')]) {
            await clickMenuButton(page, viewport, '#btn-restart');
            await waitShown(page, '#modal-confirm');
            assert.equal(await engineState(page), GAME_STATES.PAUSED, 'the Confirm pauses the run');
            assert.equal(await isShown(page, '#modal-pause'), false, 'the Confirm opens no Pause dialog');
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-confirm-no');
            await dismiss();
            await page.waitForFunction(() => document.querySelector('#modal-confirm').classList.contains('hidden'));
            assert.equal(await engineState(page), GAME_STATES.PLAYING, 'dismissing the Confirm resumes the run');
            assert.equal(await isShown(page, '#modal-pause'), false, 'dismissing the Confirm leaves no Pause dialog');
          }
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }

    test('The campaign map opens on the chapter of the current level and switches chapters', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await page.waitForFunction(() => Boolean(window.__fluxEngine));
        // The game opens on the furthest unlocked level, which the map then suggests.
        await reloadWithUnlockedLevel(page, UNLOCKED_GENERATED_LEVEL);
        await openCampaignMap(page, viewport);
        /** The chapter select, the label of the grid, and the chapter name shown in the select. */
        const chapterState = () =>
          page.evaluate(() => {
            const select = document.querySelector('#levels-chapter-select');
            return {
              value: select.value,
              name: select.selectedOptions[0]?.textContent.trim() ?? '',
              gridLabel: document.querySelector('#levels-grid').getAttribute('aria-label') || '',
              options: select.options.length,
              lockedOptions: [...select.options].filter((option) => option.disabled).length
            };
          });
        const opened = await chapterState();
        assert.ok(opened.name.length > 0, 'the select names the active chapter');
        assert.ok(opened.gridLabel.includes(opened.name), 'the grid is labelled by the active chapter');
        assert.ok(opened.lockedOptions >= 1, 'chapters that are not open yet are disabled options');
        assert.ok(opened.lockedOptions < opened.options, 'at least one chapter is open');
        const tiles = await page.evaluate(() => ({
          selected: document.querySelectorAll('#levels-grid [role="option"][aria-selected="true"]').length,
          currentTile: document.querySelector('#levels-grid .level-tile.current .level-tile-number')?.textContent || '',
          tileCount: document.querySelectorAll('#levels-grid .level-tile').length,
          rovingStops: document.querySelectorAll('#levels-grid .level-tile[tabindex="0"]').length,
          detailHeader: document.querySelector('#levels-detail-header').textContent,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth
        }));
        assert.equal(tiles.selected, 1, 'one level is selected');
        assert.equal(tiles.rovingStops, 1, 'one tile is the keyboard stop');
        assert.ok(tiles.currentTile.includes(String(UNLOCKED_GENERATED_LEVEL)), `the map shows level ${UNLOCKED_GENERATED_LEVEL}`);
        assert.ok(tiles.detailHeader.includes(String(UNLOCKED_GENERATED_LEVEL)), 'the detail panel opens on the current level');
        assert.ok(tiles.tileCount < UNLOCKED_GENERATED_LEVEL, 'only the chapter is listed');
        assert.ok(tiles.pageOverflow <= OVERFLOW_TOLERANCE_PX, 'the chapter switcher does not widen the page');

        await page.selectOption('#levels-chapter-select', { index: 0 });
        await page.waitForFunction(
          () => document.querySelector('#levels-grid .level-tile')?.dataset.levelId === '1'
        );
        const switched = await chapterState();
        assert.notEqual(switched.value, opened.value, 'another chapter is active');
        assert.ok(switched.gridLabel.includes(switched.name), 'the grid follows the active chapter');
        assert.notEqual(switched.gridLabel, opened.gridLabel, 'the grid label changed with the chapter');
        assert.ok((await textOf(page, '#levels-chapter-progress')).length > 0, 'the chapter states its stars');

        // Next walks to the last open chapter, where it is disabled; a tap there explains the next unlock.
        for (let step = 0; step < opened.options; step++) {
          if ((await page.getAttribute('#btn-chapter-next', 'aria-disabled')) === 'true') {
            break;
          }
          await page.click('#btn-chapter-next');
        }
        assert.equal(await page.getAttribute('#btn-chapter-next', 'aria-disabled'), 'true', 'Next stops at the last open chapter');
        const lastOpen = await chapterState();
        await page.dispatchEvent('#btn-chapter-next', 'click');
        await page.waitForFunction(() => {
          const el = document.querySelector('#levels-chapter-hint');
          return Boolean(el) && !el.classList.contains('hidden') && (el.textContent || '').trim().length > 0;
        });
        await waitShown(page, '#levels-chapter-hint');
        assert.match(await page.textContent('#levels-chapter-hint'), /\d+/, 'the locked chapter hint names the required level');
        assert.equal((await chapterState()).value, lastOpen.value, 'the active chapter stays unchanged');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    if (INSTALL_ENTRY_VIEWPORTS.has(viewport.name)) {
      test('Settings offers the install prompt the browser deferred, once, and announces the installed app', async () => {
        const { context, page, errors } = await openGame(viewport);
        try {
          assert.equal(await isShown(page, '#btn-install'), false, 'no install button before the browser offers one');
          await page.evaluate(() => {
            window.__installPromptCalls = 0;
            const promptEvent = new Event('beforeinstallprompt', { cancelable: true });
            promptEvent.prompt = () => {
              window.__installPromptCalls += 1;
              return Promise.resolve();
            };
            promptEvent.userChoice = Promise.resolve({ outcome: 'accepted' });
            window.dispatchEvent(promptEvent);
          });
          await clickMenuButton(page, viewport, '#btn-settings');
          await waitShown(page, '#modal-settings');
          assert.equal(await isShown(page, '#btn-install'), true, 'the install button shows once a prompt is deferred');
          assert.equal(await isShown(page, '#install-ios-hint'), false, 'the iOS steps are for Safari only');
          await page.click('#btn-install');
          await page.waitForFunction(() => window.__installPromptCalls === 1);
          assert.equal(await isShown(page, '#btn-install'), false, 'a used prompt leaves no button behind');
          await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
          await page.waitForFunction(async () => {
            const { t } = await import('/src/core/I18n.js');
            return document.querySelector('#sr-announcer').textContent.includes(t('modals.settings.install.installedAnnounce'));
          });
          assert.equal(await page.evaluate(() => window.__installPromptCalls), 1, 'the prompt is shown once');
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }

    if (viewport.name === OFF_BOARD_BANNERS_VIEWPORT) {
      test('the hint and the equipped special banner stay off the board and off the HUD', async () => {
        const { context, page, errors } = await openGame(viewport);
        try {
          await startLevelOneWithHint(page);
          await assertBannersOffBoard(page, 'level 1');
          await assertLayoutFits(page, 1);

          await page.evaluate((type) => {
            const engine = window.__fluxEngine;
            engine.startEndlessMode();
            engine.specialInventory[type] = Math.max(1, engine.specialInventory[type] || 0);
            engine.equipSpecialBall(type);
            engine.notifyUI();
          }, BANNER_SPECIAL_TYPE);
          await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
          await waitShown(page, '#special-equipped-banner');
          await assertBannersOffBoard(page, 'Survival with a special ball equipped');
          await assertLayoutFits(page, GAME_MODES.ENDLESS);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }

    if (viewport.name === HINT_FADE_VIEWPORT) {
      test('the hint fades out while the finger is on the board and comes back on release', async () => {
        const { context, page, errors } = await openGame(viewport);
        try {
          await startLevelOneWithHint(page);
          const box = await page.locator('#game-canvas').boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForFunction(() => getComputedStyle(document.querySelector('#tutorial-banner')).opacity === '0');
          // Released in the cancel zone below the launcher, so no shot changes the hint.
          const canvasCfg = await page.evaluate(() => window.__fluxEngine.gameConfig.canvas);
          const cancelY = (canvasCfg.launcherY + canvasCfg.cancelAimOffsetY + canvasCfg.logicalHeight) / 2;
          await page.mouse.move(
            box.x + box.width * CANCEL_RELEASE_X_FRACTION,
            box.y + (box.height * cancelY) / canvasCfg.logicalHeight
          );
          await page.mouse.up();
          await page.waitForFunction(() => getComputedStyle(document.querySelector('#tutorial-banner')).opacity === '1');
          assert.equal(await page.evaluate(() => window.__fluxEngine.physicsWorld.projectile), null, 'the cancelled aim fired nothing');
          assert.equal(await isShown(page, '#tutorial-banner'), true, 'the hint is still there');
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }

    test('Polarity Duel takes the layout its room allows, fits, pauses, and ends on a result card', async () => {
      const { context, page, errors } = await openGame(viewport, { initStorage: VERSUS_PLAYER_STORAGE });
      try {
        await captureVersusEngines(page);
        await openVersusTierPicker(page, viewport);
        assert.equal(await isMenuItemLocked(page, '.versus-tier-btn[data-tier="hard"]'), true, 'Hard waits for a win on Normal');
        // A locked tier stays focusable but is not enabled for the pointer: activate it as a keyboard user would.
        await page.focus('.versus-tier-btn[data-tier="hard"]');
        await page.keyboard.press('Enter');
        assert.equal(await isShown(page, '#versus-tier-hint'), true, 'a locked tier says how to unlock it');
        assert.equal(await isShown(page, '#versus-screen'), false);
        await page.click('.versus-tier-btn[data-tier="easy"]');
        await waitShown(page, '#versus-screen');
        await page.waitForFunction(() => Boolean(window.__versusBoards?.[0] && window.__versusBoards?.[1]));

        const expectedLayout = VERSUS_LAYOUT_BY_VIEWPORT[viewport.name];
        assert.equal(await page.evaluate(() => document.querySelector('#versus-screen').dataset.layout), expectedLayout);
        await assertVersusFits(page, `${viewport.name} ${expectedLayout}`);
        if (expectedLayout === 'mini') {
          await assertVersusMiniClear(page, `${viewport.name} mini`, { isPortrait: viewport.height > viewport.width });
        }
        assert.equal(await page.evaluate(() => document.querySelector('.app-shell').inert), true, 'the shell is out of reach');
        for (const selector of ['#versus-canvas-0', '#versus-canvas-1', '#versus-hud-0 .versus-incoming', '#versus-hud-1 .versus-incoming', '#versus-hud-1 .versus-pulse']) {
          assert.equal(await isShown(page, selector), true, `${selector} is shown in the ${expectedLayout} layout`);
        }

        // Escape holds both boards, Escape again lets them go.
        const updatesOf = () => page.evaluate(() => window.__versusUpdates);
        await page.keyboard.press('Escape');
        await waitShown(page, '#modal-duel-pause');
        const heldAt = await updatesOf();
        await page.waitForTimeout(VERSUS_HELD_CHECK_MS);
        assert.equal(await updatesOf(), heldAt, 'both boards stand still under the pause dialog');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('#modal-duel-pause').classList.contains('hidden'));
        await page.waitForFunction((count) => window.__versusUpdates > count, heldAt);
        await page.click('#btn-versus-pause');
        await waitShown(page, '#modal-duel-pause');
        await page.click('#btn-versus-resume');
        await page.waitForFunction(() => document.querySelector('#modal-duel-pause').classList.contains('hidden'));

        await winVersusMatch(page);
        assert.equal(await isShown(page, '#btn-versus-share'), true);
        await assertVersusFits(page, `${viewport.name} result`);
        await page.click('#btn-versus-back');
        await page.waitForFunction(() => document.querySelector('#versus-screen').classList.contains('hidden'));
        assert.equal(await page.evaluate(() => document.querySelector('.app-shell').inert), true, 'the held run shows its Pause dialog');
        await waitShown(page, '#modal-pause');
        assert.equal(await engineState(page), GAME_STATES.PAUSED, 'the run that was held comes back paused');
        await assertLayoutFits(page, 'after Polarity Duel');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('Pause opens its dialog and Resume closes it', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await startLevelOne(page);
        await clickMenuButton(page, viewport, '#btn-pause');
        await waitShown(page, '#modal-pause');
        assert.equal(await engineState(page), GAME_STATES.PAUSED);
        await page.click('#btn-resume');
        await page.waitForFunction(() => document.querySelector('#modal-pause').classList.contains('hidden'));
        assert.equal(await engineState(page), GAME_STATES.PLAYING);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}

describe('Polarity Duel (desktop)', () => {
  const desktop = VIEWPORTS[0];
  const records = (tiers) => ({ [`${STORAGE_PREFIX}${STORAGE_KEYS.versusRecords}`]: JSON.stringify(tiers) });

  test('a fresh profile finds the mode locked, and a player past level 6 does not', async () => {
    const fresh = await openGame(desktop);
    try {
      await openPlayHub(fresh.page, desktop);
      assert.equal(await isMenuItemLocked(fresh.page, '#btn-mode-versus'), true);
      assert.deepEqual(fresh.errors, []);
    } finally {
      await fresh.context.close();
    }
    const player = await openGame(desktop, { initStorage: VERSUS_PLAYER_STORAGE });
    try {
      await openPlayHub(player.page, desktop);
      assert.equal(await isMenuItemLocked(player.page, '#btn-mode-versus'), false);
      assert.deepEqual(player.errors, []);
    } finally {
      await player.context.close();
    }
  });

  test('Hard opens once Normal was won', async () => {
    const { context, page, errors } = await openGame(desktop, {
      initStorage: { ...VERSUS_PLAYER_STORAGE, ...records({ normal: { w: 1, l: 0 } }) }
    });
    try {
      await openVersusTierPicker(page, desktop);
      assert.equal(await isMenuItemLocked(page, '.versus-tier-btn[data-tier="hard"]'), false);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#modal-versus-tiers').classList.contains('hidden'));
      assert.equal(await isShown(page, '#modal-play'), true, 'Escape closes the picker first, the hub stays');
      assert.equal(await isShown(page, '#modal-levels'), false, 'the campaign map was never opened');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-mode-versus', 'focus returns to the Duel card');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('quitting a match counts as a quit and brings the paused run back', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: VERSUS_PLAYER_STORAGE });
    try {
      await captureVersusEngines(page);
      await startVersusMatch(page, desktop, 'easy');
      await page.click('#btn-versus-pause');
      await waitShown(page, '#modal-duel-pause');
      await page.click('#btn-versus-quit');
      await page.waitForFunction(() => document.querySelector('#versus-screen').classList.contains('hidden'));
      await waitShown(page, '#modal-pause');
      const stats = await page.evaluate(
        ({ key }) => JSON.parse(localStorage.getItem(key)),
        { key: `${STORAGE_PREFIX}${STORAGE_KEYS.playerStats}` }
      );
      assert.equal(stats.modes.versus.quits, 1);
      assert.equal(stats.modes.versus.wins ?? 0, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a won match is recorded, listed in My stats, and shared as text', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: VERSUS_PLAYER_STORAGE });
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
      await captureVersusEngines(page);
      await startVersusMatch(page, desktop, 'normal');
      await winVersusMatch(page);
      assert.equal(await page.evaluate(() => document.querySelector('#modal-duel-result-title').textContent.length > 0), true);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-versus-rematch', 'focus lands on the main action');
      const stored = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        `${STORAGE_PREFIX}${STORAGE_KEYS.versusRecords}`
      );
      assert.equal(stored.normal.w, 1);

      await page.evaluate(() => {
        delete Navigator.prototype.share;
        return navigator.clipboard.writeText('');
      });
      await page.click('#btn-versus-share');
      await page.waitForFunction(() => navigator.clipboard.readText().then((text) => text.includes('http')));
      const shared = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(shared, new RegExp(`${VERSUS_ROUNDS_TO_WIN} - 0`));

      await page.click('#btn-versus-rematch');
      await page.waitForFunction(() => document.querySelector('#modal-duel-result').classList.contains('hidden'));
      assert.equal(await isShown(page, '#versus-screen'), true, 'a rematch stays on the screen');
      await page.click('#btn-versus-pause');
      await page.click('#btn-versus-quit');
      await page.waitForFunction(() => document.querySelector('#versus-screen').classList.contains('hidden'));
      await page.click('#btn-resume');
      await clickMenuButton(page, desktop, '#btn-stats');
      await waitShown(page, '#modal-stats');
      const statsText = await page.evaluate(() => document.querySelector('#stats-overview-list').textContent);
      assert.match(statsText, /1/);
      assert.equal(await page.evaluate(() => document.querySelector('#stats-overview-list').textContent.includes('Duel')), true);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('resizing the window moves the match between the layouts without losing it', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: VERSUS_PLAYER_STORAGE });
    try {
      await captureVersusEngines(page);
      await startVersusMatch(page, desktop, 'easy');
      const layoutOf = () => page.evaluate(() => document.querySelector('#versus-screen').dataset.layout);
      assert.equal(await layoutOf(), 'split');
      const phone = VIEWPORTS.find((v) => v.name === 'phone portrait');
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await page.waitForFunction(() => document.querySelector('#versus-screen').dataset.layout === 'mini');
      await assertVersusFits(page, 'after resizing to a phone');
      await page.setViewportSize({ width: desktop.width, height: desktop.height });
      await page.waitForFunction(() => document.querySelector('#versus-screen').dataset.layout === 'split');
      await assertVersusFits(page, 'after resizing back');
      assert.equal(await page.evaluate(() => window.__versusBoards[0].state), GAME_STATES.PLAYING, 'the match went on');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('keyboard and pointer steer the player board only', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: VERSUS_PLAYER_STORAGE });
    try {
      await captureVersusEngines(page);
      await startVersusMatch(page, desktop, 'easy');
      const aims = () => page.evaluate(() => window.__versusBoards.map((engine) => engine.aimAngle));
      const before = await aims();
      const box = await page.locator('#versus-canvas-0').boundingBox();
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
      const afterMouse = await aims();
      assert.notEqual(afterMouse[VERSUS_PLAYER_BOARD], before[VERSUS_PLAYER_BOARD], 'the pointer aims the player board');
      assert.equal(afterMouse[VERSUS_CPU_BOARD], before[VERSUS_CPU_BOARD], 'the CPU board is not steered by the pointer');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      const afterKeys = await aims();
      assert.notEqual(afterKeys[VERSUS_PLAYER_BOARD], afterMouse[VERSUS_PLAYER_BOARD], 'the arrow keys aim the player');
      const flipped = () => page.evaluate(() => window.__versusBoards[0].isPolarityFlipped);
      await page.keyboard.press('KeyF');
      assert.equal(await flipped(), true);
      await page.waitForFunction(
        () => document.querySelector('#btn-versus-polarity').getAttribute('aria-pressed') === 'true',
        undefined,
        { timeout: WAIT_TIMEOUT_MS }
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe('precise aim (desktop)', () => {
  const desktop = VIEWPORTS[0];
  /** Small mouse movement that must not undo a keyboard adjustment, in CSS pixels. */
  const MOUSE_TREMOR_PX = 4;
  /** Mouse movement that must hand the aim back to the pointer, in CSS pixels. */
  const MOUSE_SWEEP_PX = 120;
  const ANGLE_TOLERANCE_RAD = 1e-6;

  test('arrows fine-tune the aim, a mouse tremor keeps it, and a click shoots along it', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      await page.evaluate(() => window.__fluxEngine.dismissDiscovery());
      const box = await page.locator('#game-canvas').boundingBox();
      const aimX = box.x + box.width / 2;
      const aimY = box.y + box.height * 0.4;
      await page.mouse.move(aimX, aimY);
      const before = await page.evaluate(() => window.__fluxEngine.aimAngle);

      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      const tuned = await page.evaluate(() => window.__fluxEngine.aimAngle);
      const fineStep = await page.evaluate(() => window.__fluxEngine.gameConfig.canvas.keyboardAimFineStepRad);
      assert.ok(Math.abs(tuned - before - 2 * fineStep) < ANGLE_TOLERANCE_RAD, 'two fine steps');

      await page.mouse.move(aimX + MOUSE_TREMOR_PX, aimY);
      assert.equal(await page.evaluate(() => window.__fluxEngine.aimAngle), tuned, 'a tremor keeps the tuned aim');

      await page.mouse.down();
      await page.mouse.up();
      const shot = await page.evaluate(() => {
        const projectile = window.__fluxEngine.physicsWorld.projectile;
        return projectile ? Math.atan2(projectile.vy, projectile.vx) : null;
      });
      assert.ok(shot !== null && Math.abs(shot - tuned) < ANGLE_TOLERANCE_RAD, 'the click shoots along the tuned aim');

      await page.keyboard.press('ArrowLeft');
      const relocked = await page.evaluate(() => window.__fluxEngine.aimAngle);
      await page.mouse.move(aimX + MOUSE_TREMOR_PX + MOUSE_SWEEP_PX, aimY, { steps: 4 });
      assert.notEqual(await page.evaluate(() => window.__fluxEngine.aimAngle), relocked, 'a long sweep takes the aim back');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe('end of round (desktop)', () => {
  const desktop = VIEWPORTS[0];

  test('clearing the board shows the victory screen, and Next Level starts level 2', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.physicsWorld.balls.length = 0;
        engine.physicsWorld.ballMap.clear();
        engine.evaluateRoundEnd();
      });
      await waitShown(page, '#modal-victory');
      const victory = await page.evaluate(() => ({
        focused: document.activeElement?.id,
        stars: document.querySelector('#victory-stars').textContent.trim(),
        nextStar: document.querySelector('#victory-next-star').textContent.trim(),
        score: document.querySelector('#victory-score').textContent.trim()
      }));
      assert.equal(victory.focused, 'btn-next-level');
      assert.ok(victory.stars.length > 0 && victory.score.length > 0, 'the victory screen states stars and score');
      assert.ok(victory.nextStar.length > 0, 'the victory screen states the next star goal or 3-star completion');
      await page.click('#btn-next-level');
      await page.waitForFunction(() => window.__fluxEngine.currentLevelId === 2);
      assert.equal(await isShown(page, '#modal-victory'), false);
      assert.equal(await engineState(page), GAME_STATES.PLAYING);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('winning the last level offers the campaign map, never Survival', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      const lastId = await page.evaluate(() => window.__fluxEngine.levelCatalog.lastId);
      await startLevel(page, lastId);
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.physicsWorld.balls.length = 0;
        engine.physicsWorld.ballMap.clear();
        engine.evaluateRoundEnd();
      });
      await waitShown(page, '#modal-victory');
      const label = await page.evaluate(async () => {
        const { t } = await import('/src/core/I18n.js');
        return {
          shown: document.querySelector('#btn-next-level').textContent,
          expected: t('modals.victory.button.backToLevels')
        };
      });
      assert.equal(label.shown, label.expected, 'the button names the campaign map');
      await page.click('#btn-next-level');
      await waitShown(page, '#modal-levels');
      const after = await page.evaluate(() => ({
        mode: window.__fluxEngine.mode,
        levelId: window.__fluxEngine.currentLevelId
      }));
      assert.deepEqual(after, { mode: GAME_MODES.CAMPAIGN, levelId: lastId }, 'no Survival run started');
      assert.equal(await isShown(page, '#modal-victory'), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a lost run shows the game over screen with its reason, and Retry restarts', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      await page.evaluate((reason) => window.__fluxEngine.triggerGameOver(reason), GAME_OVER_REASONS.OUT_OF_SHOTS);
      await waitShown(page, '#modal-gameover');
      const reason = await page.evaluate(() => document.querySelector('#gameover-reason').textContent.trim());
      assert.ok(reason.length > 0, 'the game over screen states why');
      assert.equal(await isShown(page, '#gameover-remaining'), true, 'campaign defeat shows remaining spheres');
      await page.click('#btn-retry');
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
      assert.equal(await isShown(page, '#modal-gameover'), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a campaign game over offers no Share; Daily, Survival and Flux copy their result when no share sheet exists', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
      await startLevelOne(page);
      await page.evaluate((reason) => window.__fluxEngine.triggerGameOver(reason), GAME_OVER_REASONS.OUT_OF_SHOTS);
      await waitShown(page, '#modal-gameover');
      assert.equal(await isShown(page, '#btn-share-gameover'), false, 'a campaign run has nothing to share');
      assert.equal(await isShown(page, '#gameover-daily-next'), false, 'the Daily countdown is for the Daily only');
      await page.click('#btn-retry');
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);

      // Desktop browsers may offer a share sheet; removing it exercises the clipboard path.
      await page.evaluate(() => {
        delete Navigator.prototype.share;
        const engine = window.__fluxEngine;
        engine.startDailyChallenge();
        engine.spawnEndlessWave();
        engine.spawnEndlessWave();
        engine.notifyUI();
      });
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
      await loseRun(page);
      const config = await page.evaluate(() => window.__fluxEngine.gameConfig.share);
      const lines = await shareAndReadLines(page, config.url);
      assert.equal(lines.length, 4, 'header, stats, wave row and address');
      assert.equal(lines[2], config.waveEmoji.normal + config.waveEmoji.goldRush);
      await page.waitForFunction(async () => {
        const { t } = await import('/src/core/I18n.js');
        return document.querySelector('#sr-announcer').textContent.includes(t('share.feedback.copied'));
      });
      assert.equal(await isShown(page, '#gameover-share-fallback'), false);

      await page.click('#btn-retry');
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.startEndlessMode();
        engine.spawnEndlessWave();
        engine.notifyUI();
      });
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
      await loseRun(page);
      const survivalLines = await shareAndReadLines(page, config.url);
      const survivalHeader = await page.evaluate(async () => (await import('/src/core/I18n.js')).t('share.survival.header'));
      assert.equal(survivalLines[0], survivalHeader, 'a Survival result opens on its mode');

      await page.click('#btn-retry');
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.startFluxRun();
        engine.notifyUI();
      });
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
      const { stage, seed } = await page.evaluate(() => ({ stage: window.__fluxEngine.fluxStage, seed: window.__fluxEngine.fluxSeed }));
      await loseRun(page);
      const fluxShareUrl = `${config.url}?flux=${seed}`;
      const fluxLines = await shareAndReadLines(page, fluxShareUrl);
      const fluxHeader = await page.evaluate(async (fluxSeed) => (await import('/src/core/I18n.js')).t('share.flux.headerWithSeed', { seed: fluxSeed }), seed);
      assert.equal(fluxLines[0], fluxHeader, 'a Flux result opens on its mode');
      assert.ok(
        fluxLines.some((line) => new RegExp(`\\b${stage}\\b`).test(line) && line !== fluxShareUrl),
        `a Flux result states shape ${stage}`
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a Daily game over counts down to the next challenge, and the Play hub marks the Daily as done', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await openPlayHub(page, desktop);
      const before = await textOf(page, '#daily-reward');
      assert.ok(before.includes(DAILY_BONUS_MARK), `the unplayed Daily announces its bonus: "${before}"`);
      await page.click('#btn-close-play');
      await page.waitForFunction(() => document.querySelector('#modal-play').classList.contains('hidden'));
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.startDailyChallenge();
        engine.spawnEndlessWave();
        engine.notifyUI();
      });
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
      await loseRun(page);
      await waitShown(page, '#gameover-daily-next');
      assert.match(await page.textContent('#gameover-daily-next'), DAILY_COUNTDOWN_PATTERN);
      // The game over screen opens the hub with its "Change mode" button; the hub refreshes the Daily chip on open.
      await page.click('#btn-levels-gameover');
      await waitShown(page, '#modal-play');
      const label = await page.evaluate(async () => ({
        shown: document.querySelector('#daily-reward').textContent.trim(),
        expected: (await import('/src/core/I18n.js')).t('modals.play.daily.done')
      }));
      assert.ok(!label.shown.includes(DAILY_BONUS_MARK), `the played Daily has no bonus left: "${label.shown}"`);
      assert.equal(label.shown, label.expected, 'the played Daily says so');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('an existing player keeps every mode, and the save moves to the current schema', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: EXISTING_PLAYER_STORAGE });
    try {
      await openPlayHub(page, desktop);
      for (const selector of UNLOCKED_MODE_BUTTONS) {
        assert.equal(await isMenuItemLocked(page, selector), false, `${selector} stays open`);
      }
      const saved = await page.evaluate(async (key) => ({
        version: window.localStorage.getItem(key),
        current: (await import('/src/core/StorageManager.js')).CURRENT_SAVE_SCHEMA_VERSION
      }), `${STORAGE_PREFIX}${STORAGE_KEYS.schemaVersion}`);
      assert.equal(saved.version, String(saved.current));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('an existing player starts Classic from the Play hub', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: EXISTING_PLAYER_STORAGE });
    try {
      await openPlayHub(page, desktop);
      assert.equal(await isMenuItemLocked(page, CLASSIC_CARD_SELECTOR), false, 'the Classic card is open');
      await page.click(CLASSIC_CARD_SELECTOR);
      await page.waitForFunction(
        ([mode, playing]) => window.__fluxEngine.mode === mode && window.__fluxEngine.state === playing,
        [GAME_MODES.CLASSIC, GAME_STATES.PLAYING]
      );
      await waitShown(page, SAG_METER_SELECTOR);
      assert.equal(await page.evaluate(() => window.__fluxEngine.classicStage), 1);
      assert.equal(await isShown(page, '#modal-play'), false, 'starting a mode closes the hub');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a shared Flux link starts Flux on a fresh profile and unlocks the mode', async () => {
    const { context, page, errors } = await openGame(desktop, { path: `/?flux=${SHARED_FLUX_SEED}` });
    try {
      await page.waitForFunction(
        ([flux, seed]) => window.__fluxEngine.mode === flux && window.__fluxEngine.fluxSeed === seed,
        [GAME_MODES.FLUX, SHARED_FLUX_SEED]
      );
      await page.waitForFunction(() => document.querySelector('#btn-flux').getAttribute('aria-disabled') !== 'true');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('the Weekly Flux button starts the Flux of the current ISO week', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: EXISTING_PLAYER_STORAGE });
    try {
      await page.click('#btn-menu');
      await page.click('#btn-play');
      await waitShown(page, '#modal-play');
      await page.click('#btn-weekly');
      await page.waitForFunction(
        ([flux, playing]) => window.__fluxEngine.mode === flux && window.__fluxEngine.state === playing,
        [GAME_MODES.FLUX, GAME_STATES.PLAYING]
      );
      assert.equal(await isShown(page, '#modal-play'), false, 'starting the Weekly closes the hub');
      const run = await page.evaluate(async () => {
        const { getUtcIsoWeekKey, getWeeklyFluxSeed } = await import('/src/game/WeeklyFlux.js');
        const engine = window.__fluxEngine;
        const weekKey = getUtcIsoWeekKey(Date.now());
        return {
          isWeekly: engine.isWeeklyFluxRun,
          weekKey: engine.weeklyWeekKey,
          expectedWeekKey: weekKey,
          seed: engine.fluxSeed,
          expectedSeed: getWeeklyFluxSeed(weekKey, engine.fluxConfig.seed, engine.gameConfig.weeklyFlux.seedSalt)
        };
      });
      assert.equal(run.isWeekly, true);
      assert.equal(run.weekKey, run.expectedWeekKey);
      assert.equal(run.seed, run.expectedSeed);
      // Only the Weekly card is the running mode: the plain Flux card is not.
      await openPlayHub(page, desktop);
      const active = await page.evaluate(() => ({
        weekly: document.querySelector('#btn-weekly').classList.contains('active-mode'),
        flux: document.querySelector('#btn-flux').classList.contains('active-mode')
      }));
      assert.deepEqual(active, { weekly: true, flux: false }, 'the hub marks the Weekly run, not plain Flux');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a Daily game over opens My stats on the Daily history with today\'s row, and the stats can be copied', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
      await startDailyRun(page);
      // Only a run with a shot fired is recorded in the history.
      await page.evaluate(() => {
        window.__fluxEngine.dismissDiscovery();
        window.__fluxEngine.shoot();
      });
      assert.ok(await page.evaluate(() => window.__fluxEngine.hasFiredInRound), 'one shot is fired');
      await loseRun(page);
      await waitShown(page, '#btn-daily-history-gameover');
      await page.click('#btn-daily-history-gameover');
      await waitShown(page, '#modal-stats');
      assert.equal(await page.getAttribute('#tab-stats-daily', 'aria-selected'), 'true');
      await waitShown(page, '#stats-daily-wrap');
      assert.equal(await page.locator('#stats-daily-body tr').count(), 1, 'today is the only row');
      const todayKey = await page.evaluate(() => new Date().toISOString().slice(0, 10));
      const stored = await page.evaluate(
        (key) => JSON.parse(window.localStorage.getItem(key)).map((entry) => entry.d),
        `${STORAGE_PREFIX}${STORAGE_KEYS.dailyHistory}`
      );
      assert.deepEqual(stored, [todayKey]);

      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.click('#btn-copy-stats');
      await page.waitForFunction(() => navigator.clipboard.readText().then((text) => text.length > 0));
      const header = await page.evaluate(async () => (await import('/src/core/I18n.js')).t('stats.copy.header'));
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/)[0], header);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('every special ball card of the Workshop says what the ball does', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      await clickMenuButton(page, desktop, '#btn-shop');
      await waitShown(page, '#modal-shop');
      await page.click('#tab-shop-ammo');
      await waitShown(page, '#shop-ammo-pane');
      const descriptions = await page.evaluate(() =>
        [...document.querySelectorAll('#shop-ammo-grid .ammo-card-desc')].map((el) => el.textContent.trim())
      );
      assert.equal(descriptions.length, SPECIAL_TYPES_ORDER.length, 'one description per special ball');
      assert.ok(descriptions.every((text) => text.length > 0), 'no description is empty');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a run saved after its discovery hint was dismissed resumes, paused, after a reload', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.dismissDiscovery();
        engine.hasFiredInRound = true;
        engine.score = 1234;
        engine.saveRunSnapshot();
      });
      await page.reload();
      await captureEngine(page);
      await waitShown(page, '#modal-pause');
      assert.equal(await page.evaluate(() => window.__fluxEngine.score), 1234, 'the saved score is back');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

/** Number of tracks in the computed grid-template-columns of the HUD bar, after checking the fullscreen button is shown. */
async function hudTrackCount(page) {
  return page.evaluate(() => {
    const button = document.querySelector('#btn-fullscreen-hud');
    const bar = document.querySelector('.hud-bar');
    return {
      buttonHidden: button.classList.contains('hidden'),
      tracks: getComputedStyle(bar).gridTemplateColumns.split(' ').filter(Boolean).length
    };
  });
}

describe('HUD layout and stars', () => {
  const desktop = VIEWPORTS.find((v) => v.name === 'desktop');
  const phoneLandscape = VIEWPORTS.find((v) => v.name === 'phone landscape');

  test('the desktop HUD keeps its three columns even with the fullscreen button shown', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      const { buttonHidden, tracks } = await hudTrackCount(page);
      assert.equal(buttonHidden, false, 'the fullscreen button is shown, so the :has rule applies');
      assert.equal(tracks, DESKTOP_HUD_TRACKS);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('the phone landscape HUD keeps its four columns even with the fullscreen button shown', async () => {
    const { context, page, errors } = await openGame(phoneLandscape);
    try {
      await startLevelOne(page);
      const { buttonHidden, tracks } = await hudTrackCount(page);
      assert.equal(buttonHidden, false, 'the fullscreen button is shown, so the :has rule applies');
      assert.equal(tracks, PHONE_LANDSCAPE_HUD_TRACKS);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('an empty HUD star has a different color from an earned one, in the HUD and in the menu', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.score = 0;
        engine.notifyUI();
      });
      await page.click('#btn-menu');
      const starColors = (selector) =>
        page.evaluate((glyphSelector) => {
          const colorOf = (el) => (el ? getComputedStyle(el).color : null);
          const root = document.querySelector(glyphSelector);
          return {
            earned: colorOf(root.querySelector('.star-earned')),
            empty: colorOf(root.querySelector('.star-empty'))
          };
        }, selector);
      for (const selector of ['#hud-star-glyphs', '#drawer-star-progress > span[aria-hidden="true"]']) {
        const { earned, empty } = await starColors(selector);
        assert.ok(earned, `${selector}: at least one earned star`);
        assert.ok(empty, `${selector}: at least one empty star`);
        assert.notEqual(empty, earned, `${selector}: an empty star has its own colour`);
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('on a desktop window the power-ups panel hugs its content instead of stretching', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      const { height, scrollHeight, gapToDock } = await page.evaluate(() => {
        const panel = document.querySelector('.powerups-panel');
        const rect = panel.getBoundingClientRect();
        return {
          height: rect.height,
          scrollHeight: panel.scrollHeight,
          gapToDock: document.querySelector('.launcher-controls-dock').getBoundingClientRect().top - rect.top
        };
      });
      assert.ok(height <= scrollHeight + PANEL_BORDER_ALLOWANCE_PX, `panel ${height}px is taller than its content ${scrollHeight}px`);
      assert.ok(height < gapToDock - PANEL_HUG_MIN_SLACK_PX, `panel ${height}px fills the ${gapToDock}px above the dock`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('on a short wide window the power-ups panel stays above the Polarity/Swap dock', async () => {
    const { context, page, errors } = await openGame(SHORT_WIDE_VIEWPORT);
    try {
      await startLevelOne(page);
      const { panelBottom, dockTop } = await page.evaluate(() => ({
        panelBottom: document.querySelector('.powerups-panel').getBoundingClientRect().bottom,
        dockTop: document.querySelector('.launcher-controls-dock').getBoundingClientRect().top
      }));
      assert.ok(panelBottom <= dockTop + OVERFLOW_TOLERANCE_PX, `panel bottom ${panelBottom} is below dock top ${dockTop}`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

/** Decode context of a duel link, built from the real configs (what the game builds at boot). */
const duelContext = () => ({
  todayKey: SeededRandom.getTodayDateKey(),
  epochDateKey: GAME_CONFIG.share.epochDateKey,
  seed: FLUX_CONFIG.seed,
  maxPoints: GAME_CONFIG.shotTimeline.maxPoints
});

/** A rival run on a board: a Daily of a date key or a Flux seed. */
function rivalGhost(mode, key) {
  return {
    mode,
    key,
    cv: DUEL_CONFIG.contentVersion[mode],
    n: RIVAL_SHOT_SCORES.length,
    step: 1,
    s: [...RIVAL_SHOT_SCORES],
    final: RIVAL_SHOT_SCORES[RIVAL_SHOT_SCORES.length - 1],
    assists: { workshop: 0, ammo: 0, continues: 0, tiltFree: false },
    alias: RIVAL_NAME
  };
}

/** The page address of a duel link for a ghost. */
function duelPath(ghost) {
  const payload = encodeGhost(ghost, DUEL_CONFIG, duelContext());
  assert.ok(payload, 'the test ghost is encodable');
  const flux = ghost.mode === 'flux' ? `flux=${ghost.key}&` : '';
  return `/?${flux}${DUEL_CONFIG.queryParam}=${payload}`;
}

const dateKeyDaysAgo = (days) => new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);

const waitDuelRunning = (page, mode) =>
  page.waitForFunction(
    ([expectedMode, playing]) => {
      const engine = window.__fluxEngine;
      return engine.mode === expectedMode && engine.state === playing && Boolean(engine.ghostDuel);
    },
    [mode, GAME_STATES.PLAYING]
  );

describe('Ghost Duels (desktop)', () => {
  const desktop = VIEWPORTS.find((v) => v.name === 'desktop');

  test('a duel link on a fresh profile opens the card; Accept starts the Flux duel, unlocks Flux and shows the rival badge', async () => {
    const { context, page, errors } = await openGame(desktop, { path: duelPath(rivalGhost('flux', SHARED_FLUX_SEED)) });
    try {
      await waitShown(page, '#modal-duel');
      assert.match(await page.textContent('#duel-card-summary'), new RegExp(RIVAL_NAME));
      assert.equal(await isShown(page, '#btn-duel-accept'), true);
      assert.equal(await isShown(page, '#btn-duel-ok'), false);
      await page.click('#btn-duel-accept');
      await waitDuelRunning(page, GAME_MODES.FLUX);
      assert.equal(await page.evaluate(() => window.__fluxEngine.fluxSeed), SHARED_FLUX_SEED);
      assert.equal(await isShown(page, '#modal-duel'), false);
      await page.waitForFunction(() => document.querySelector('#btn-flux').getAttribute('aria-disabled') !== 'true');
      await waitShown(page, '#hud-ghost');
      assert.match(await page.textContent('#hud-ghost'), new RegExp(RIVAL_NAME));
      assert.equal(await isShown(page, '#hud-best-run'), false, 'the rival badge replaces the best-run marker');
      assert.equal(new URL(page.url()).searchParams.has(DUEL_CONFIG.queryParam), false, 'the address is cleaned');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('over a saved run, Accept asks for confirmation before the duel starts', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.dismissDiscovery();
        engine.hasFiredInRound = true;
        engine.score = 1234;
        engine.saveRunSnapshot();
      });
      await page.goto(`${server.origin}${duelPath(rivalGhost('flux', SHARED_FLUX_SEED))}`);
      await captureEngine(page);
      await waitShown(page, '#modal-duel');
      await page.click('#btn-duel-accept');
      await waitShown(page, '#modal-confirm');
      assert.equal(await page.evaluate(() => Boolean(window.__fluxEngine.ghostDuel)), false, 'nothing started before the confirmation');
      await page.click('#btn-confirm-yes');
      await waitDuelRunning(page, GAME_MODES.FLUX);
      await waitShown(page, '#hud-ghost');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a damaged duel link shows the error card; OK closes it and the normal boot stays', async () => {
    const { context, page, errors } = await openGame(desktop, { path: `/?${DUEL_CONFIG.queryParam}=garbage` });
    try {
      await waitShown(page, '#modal-duel');
      assert.equal(await isShown(page, '#btn-duel-ok'), true);
      assert.equal(await isShown(page, '#btn-duel-accept'), false);
      assert.ok((await page.textContent('#duel-card-summary')).trim().length > 0, 'the card says what is wrong');
      await page.click('#btn-duel-ok');
      await page.waitForFunction(() => document.querySelector('#modal-duel').classList.contains('hidden'));
      assert.equal(await page.evaluate(() => Boolean(window.__fluxEngine.ghostDuel)), false);
      assert.equal(await page.evaluate(() => window.__fluxEngine.mode), GAME_MODES.CAMPAIGN, 'the campaign boot is untouched');
      assert.equal(new URL(page.url()).searchParams.has(DUEL_CONFIG.queryParam), false, 'the address is cleaned');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a past Daily duel is a rematch: noted on the card, and Accept pays no first-play bonus', async () => {
    const pastKey = dateKeyDaysAgo(REMATCH_AGE_DAYS);
    const { context, page, errors } = await openGame(desktop, { path: duelPath(rivalGhost('daily', pastKey)) });
    try {
      await waitShown(page, '#modal-duel');
      await waitShown(page, '#duel-card-notes');
      const note = await page.evaluate(async () => (await import('/src/core/I18n.js')).t('duel.card.rematch'));
      assert.ok((await page.textContent('#duel-card-notes')).includes(note), 'the card notes the rematch');
      const coinsBefore = await page.evaluate(() => window.__fluxEngine.storageManager.getCoins());
      await page.click('#btn-duel-accept');
      await waitDuelRunning(page, GAME_MODES.DAILY);
      assert.equal(await page.evaluate(() => window.__fluxEngine.dailySeedKey), pastKey);
      assert.equal(await page.evaluate(() => window.__fluxEngine.isDailyRematch), true);
      assert.equal(
        await page.evaluate(() => window.__fluxEngine.storageManager.getCoins()),
        coinsBefore,
        'no first-play bonus for a past Daily'
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a duel game over states the result, and Share challenge carries the player\'s own score as a duel link', async () => {
    const todayKey = SeededRandom.getTodayDateKey();
    const { context, page, errors } = await openGame(desktop, { path: duelPath(rivalGhost('daily', todayKey)) });
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
      await waitShown(page, '#modal-duel');
      await page.click('#btn-duel-accept');
      await waitDuelRunning(page, GAME_MODES.DAILY);
      await page.evaluate((score) => {
        const engine = window.__fluxEngine;
        // Desktop browsers may offer a share sheet; removing it exercises the clipboard path.
        delete Navigator.prototype.share;
        engine.dismissDiscovery();
        engine.shoot();
        engine.score = score;
      }, PLAYER_FINAL_SCORE);
      await loseRun(page);
      await waitShown(page, '#gameover-duel');
      assert.match(await page.textContent('#gameover-duel'), new RegExp(RIVAL_NAME));
      const summary = await page.evaluate(() => window.__fluxEngine.gameOverSummary.duel);
      assert.equal(summary.outcome, 'lost');
      assert.equal(summary.myScore, PLAYER_FINAL_SCORE);

      await page.evaluate(() => navigator.clipboard.writeText(''));
      await waitShown(page, '#btn-share-gameover');
      await page.click('#btn-share-gameover');
      const queryParam = DUEL_CONFIG.queryParam;
      await page.waitForFunction((param) => navigator.clipboard.readText().then((text) => text.includes(`?${param}=`)), queryParam);
      const lines = (await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/).filter(Boolean);
      const url = new URL(lines[lines.length - 1]);
      const payload = url.searchParams.get(queryParam);
      assert.ok(payload, 'the last line is a duel link');
      const decoded = decodeGhost(payload, DUEL_CONFIG, duelContext());
      assert.equal(decoded.status, 'valid');
      assert.equal(decoded.ghost.mode, 'daily');
      assert.equal(decoded.ghost.key, todayKey);
      assert.equal(decoded.ghost.final, PLAYER_FINAL_SCORE, 'the link carries the player\'s own final score');
      assert.ok(url.href.length <= DUEL_CONFIG.maxUrlLength, 'the link fits the length budget');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

/** The board of a Daily duel may lose its badge row, but never more than a tenth of its height. */
const MIN_DUEL_BOARD_HEIGHT_RATIO = 0.9;

describe('Ghost Duel HUD layout', () => {
  /** Geometry of the HUD that a rival badge must not change, and where the badge sits. */
  const measureHud = (page) =>
    page.evaluate(() => {
      const bar = document.querySelector('.hud-bar').getBoundingClientRect();
      const row = document.querySelector('.hud-badges-row').getBoundingClientRect();
      const badge = document.querySelector('#hud-ghost');
      const badgeRect = badge.checkVisibility() ? badge.getBoundingClientRect() : null;
      return {
        tracks: getComputedStyle(document.querySelector('.hud-bar')).gridTemplateColumns.split(' ').filter(Boolean).length,
        barWidth: Math.round(bar.width),
        barHeight: Math.round(bar.height),
        rowHeight: Math.round(row.height),
        canvasHeight: document.querySelector('#game-canvas').getBoundingClientRect().height,
        badgeInsideBar: badgeRect === null || (badgeRect.left >= bar.left - 1 && badgeRect.right <= bar.right + 1),
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth
      };
    });

  /**
   * Runs a normal run with its record marker, then the same board as a duel, and returns the
   * HUD geometry of both. The duel starts from its card, after the saved-run guard if it asks.
   */
  async function measureNormalThenDuel(page, startNormal, ghost) {
    await page.evaluate(startNormal, DAILY_RECORD_TO_BEAT);
    await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
    const normal = await measureHud(page);
    await page.goto(`${server.origin}${duelPath(ghost)}`);
    await captureEngine(page);
    await waitShown(page, '#modal-duel');
    await page.click('#btn-duel-accept');
    const needsConfirm = await page.evaluate(() => !document.querySelector('#modal-confirm').classList.contains('hidden'));
    if (needsConfirm) {
      await page.click('#btn-confirm-yes');
    }
    await waitDuelRunning(page, ghost.mode === 'daily' ? GAME_MODES.DAILY : GAME_MODES.FLUX);
    await waitShown(page, '#hud-ghost');
    assert.equal(await isShown(page, '#hud-best-run'), false, 'the rival badge takes the place of the best-run marker');
    return { normal, duel: await measureHud(page) };
  }

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: a Daily duel for today keeps the HUD columns and width, and fits in the badge row`, async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        const { normal, duel } = await measureNormalThenDuel(
          page,
          () => {
            window.__fluxEngine.startDailyChallenge();
            window.__fluxEngine.notifyUI();
          },
          rivalGhost('daily', SeededRandom.getTodayDateKey())
        );
        assert.equal(duel.tracks, normal.tracks, 'the HUD grid keeps its columns');
        assert.equal(duel.barWidth, normal.barWidth, 'the HUD keeps its width');
        // A normal Daily has no badge to show, so its badge row is collapsed and the rival fills it.
        assert.equal(normal.rowHeight, 0, 'the normal Daily has no badge row');
        assert.ok(duel.rowHeight > 0, 'the rival badge fills the badge row');
        assert.ok(
          duel.canvasHeight >= normal.canvasHeight * MIN_DUEL_BOARD_HEIGHT_RATIO,
          `the board keeps at least ${MIN_DUEL_BOARD_HEIGHT_RATIO * 100}% of its height (${duel.canvasHeight} vs ${normal.canvasHeight})`
        );
        assert.equal(duel.badgeInsideBar, true, 'the rival badge stays inside the HUD');
        assert.ok(duel.pageOverflow <= OVERFLOW_TOLERANCE_PX, 'the page does not scroll sideways');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test(`${viewport.name}: a Flux duel replaces the best-run marker without changing the HUD or its badge row`, async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        const { normal, duel } = await measureNormalThenDuel(
          page,
          (best) => {
            const engine = window.__fluxEngine;
            engine.startFluxRun();
            engine.runBestBaseline = { metric: 'stage', best };
            engine.notifyUI();
          },
          rivalGhost('flux', SHARED_FLUX_SEED)
        );
        assert.ok(normal.rowHeight > 0, 'the best-run marker fills the badge row');
        assert.equal(duel.tracks, normal.tracks, 'the HUD grid keeps its columns');
        assert.equal(duel.barWidth, normal.barWidth, 'the HUD keeps its width');
        assert.ok(duel.barHeight <= normal.barHeight, 'the HUD does not grow');
        assert.equal(duel.rowHeight, normal.rowHeight, 'the badge row keeps its height');
        assert.equal(duel.badgeInsideBar, true, 'the rival badge stays inside the HUD');
        assert.ok(duel.pageOverflow <= OVERFLOW_TOLERANCE_PX, 'the page does not scroll sideways');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

/*
 * Controller support. A standard-layout pad is stubbed before the game loads
 * (navigator.getGamepads reads window.__pads) and announced with a gamepadconnected event.
 */
const PAD_BUTTONS = Object.freeze({ bottom: 0, select: 8, start: 9, dpadUp: 12, dpadDown: 13 });
/** Animation frames to wait so the game loop sees a press, then its release. */
const PAD_FRAMES_PER_STEP = 3;

function installPadStub() {
  window.__pads = [];
  // Frame counter bumped before the game's own frame callback (registered first, so it runs first).
  window.__frame = 0;
  const countFrame = () => {
    window.__frame += 1;
    requestAnimationFrame(countFrame);
  };
  requestAnimationFrame(countFrame);
  let tapFrame = -1;
  navigator.getGamepads = () => {
    // A tap is visible to exactly one game frame: menu auto-repeat is wall-clock based, so a
    // press held for a fixed number of frames would repeat on a slow machine.
    if (tapFrame >= 0 && window.__frame > tapFrame + 1) {
      window.__setPad([]);
      tapFrame = -1;
    }
    return window.__pads;
  };
  window.__setPad = (pressed = [], { tap = false } = {}) => {
    tapFrame = tap ? window.__frame : -1;
    window.__pads = [
      {
        index: 0,
        id: 'stub standard pad',
        mapping: 'standard',
        connected: true,
        timestamp: performance.now(),
        buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
        axes: [0, 0, 0, 0]
      }
    ];
  };
  window.__connectPad = () => {
    window.__setPad([]);
    const event = new Event('gamepadconnected');
    event.gamepad = window.__pads[0];
    window.dispatchEvent(event);
  };
}

const waitFrames = (page, count) =>
  page.evaluate(
    (frames) =>
      new Promise((resolve) => {
        let left = frames;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count
  );

async function connectPad(page) {
  await page.evaluate(() => window.__connectPad());
  await waitFrames(page, PAD_FRAMES_PER_STEP);
}

/** Presses a button for exactly one game frame, then releases it. */
async function tapPad(page, button) {
  await page.evaluate((index) => window.__setPad([index], { tap: true }), button);
  await waitFrames(page, PAD_FRAMES_PER_STEP);
  await page.evaluate(() => window.__setPad([]));
  await waitFrames(page, PAD_FRAMES_PER_STEP);
}

/** Ids and boxes of the Pause dialog buttons plus the focus sequence, for assertion messages. */
const describePauseFocus = (page, sequence) =>
  page.evaluate(
    (seq) =>
      JSON.stringify({
        sequence: seq,
        buttons: Array.from(document.querySelectorAll('#modal-pause button')).map((button) => {
          const { left, top, width, height } = button.getBoundingClientRect();
          return { id: button.id, left, top, width, height };
        })
      }),
    sequence
  );

const focusedId = (page) => page.evaluate(() => document.activeElement?.id ?? '');

describe('browser smoke: controller', () => {
  for (const viewport of VIEWPORTS.filter((v) => v.name === 'desktop' || v.name === 'phone portrait')) {
    test(`${viewport.name}: the bottom button shoots, Start opens Pause, and the d-pad with the bottom button drives the dialog`, async () => {
      const { context, page, errors } = await openGame(viewport, { initScript: installPadStub });
      try {
        await startLevelOne(page);
        await page.evaluate(() => {
          const engine = window.__fluxEngine;
          const original = engine.shoot;
          window.__shotCalls = 0;
          engine.shoot = function countShots(...args) {
            window.__shotCalls += 1;
            return original.apply(this, args);
          };
        });
        await connectPad(page);
        await tapPad(page, PAD_BUTTONS.bottom);
        assert.equal(await page.evaluate(() => window.__shotCalls), 1, 'the bottom button fires one shot');
        assert.equal(
          await page.evaluate(() => document.documentElement.dataset.input),
          'gamepad',
          'pad activity switches the input mode'
        );

        await startLevelOne(page);
        await tapPad(page, PAD_BUTTONS.start);
        await waitShown(page, '#modal-pause');
        assert.equal(await engineState(page), GAME_STATES.PAUSED);
        assert.equal(await focusedId(page), 'btn-resume', 'Pause opens on Resume');

        const sequence = [await focusedId(page)];
        await tapPad(page, PAD_BUTTONS.dpadDown);
        sequence.push(await focusedId(page));
        assert.notEqual(await focusedId(page), 'btn-resume', 'the d-pad moves focus off Resume');
        assert.equal(
          await page.evaluate(() => document.activeElement.classList.contains('pad-focus')),
          true,
          'the pad focus ring is on the focused control'
        );
        await tapPad(page, PAD_BUTTONS.dpadUp);
        sequence.push(await focusedId(page));
        assert.equal(
          await focusedId(page),
          'btn-resume',
          `down then up returns to Resume: ${await describePauseFocus(page, sequence)}`
        );
        await tapPad(page, PAD_BUTTONS.bottom);
        await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
        assert.equal(await isShown(page, '#modal-pause'), false, 'Resume closes the dialog');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: controller hints replace the key hints without overflowing the layout`, async () => {
      const { context, page, errors } = await openGame(viewport, { initScript: installPadStub });
      try {
        await startLevel(page, 2);
        await connectPad(page);
        // Any pad activity switches the input mode; a pressed face button on the board would
        // shoot, so a held trigger-free button that does nothing in play is used instead.
        await page.evaluate(() => window.__setPad([11]));
        await waitFrames(page, PAD_FRAMES_PER_STEP);
        await page.evaluate(() => window.__setPad([]));
        await page.waitForFunction(() => document.documentElement.dataset.input === 'gamepad');

        const hints = await page.evaluate(() => {
          const buttons = ['#btn-swap-ball', '#btn-polarity'].map((selector) => {
            const button = document.querySelector(selector);
            const glyph = button.querySelector('.pad-glyph');
            const box = button.getBoundingClientRect();
            const glyphBox = glyph.getBoundingClientRect();
            return {
              selector,
              glyphShown: glyph.checkVisibility(),
              inside:
                glyphBox.left >= box.left - 1 &&
                glyphBox.right <= box.right + 1 &&
                glyphBox.top >= box.top - 1 &&
                glyphBox.bottom <= box.bottom + 1
            };
          });
          const keyHintsShown = [...document.querySelectorAll('.powerup-key')].some((el) => el.checkVisibility());
          return { buttons, keyHintsShown };
        });
        for (const button of hints.buttons) {
          assert.equal(button.glyphShown, true, `${button.selector} shows its controller glyph`);
          assert.equal(button.inside, true, `${button.selector} keeps its glyph inside the button`);
        }
        assert.equal(hints.keyHintsShown, false, 'the key hints are hidden');
        await assertLayoutFits(page, 2);
        const hudOverflow = await page.evaluate(() => {
          const bar = document.querySelector('.hud-bar');
          return bar.scrollWidth - bar.clientWidth;
        });
        assert.ok(hudOverflow <= OVERFLOW_TOLERANCE_PX, 'the HUD does not overflow');

        await page.evaluate(() => window.__fluxEngine.togglePause());
        await waitShown(page, '#modal-pause');
        const pauseHints = await page.evaluate(() => {
          const card = document.querySelector('#modal-pause .modal-card');
          return {
            pad: document.getElementById('pause-instruction-pad').checkVisibility(),
            keys: document.getElementById('pause-instruction-keyboard').checkVisibility(),
            overflow: card.scrollWidth - card.clientWidth
          };
        });
        assert.equal(pauseHints.pad, true, 'Pause lists the controller');
        assert.equal(pauseHints.keys, false, 'Pause hides the keyboard line');
        assert.ok(pauseHints.overflow <= OVERFLOW_TOLERANCE_PX, 'the Pause card does not overflow');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

/*
 * Polarity Duel, two players on one device. The lobby is opened from the Play hub (2 players button),
 * players join with W and ArrowUp (keyboard halves) or a button of a controller, and both boards
 * are human. A round is ended by dropping a board through its engine, as the CPU duel does.
 */
const LOCAL_CFG = GAME_CONFIG.versus.local;
const LOCAL_WIDE_VIEWPORT = Object.freeze({ width: 1300, height: 850, isTouch: false, hasDrawer: true });
const LOCAL_RESULT_GUARD_WAIT_MS = LOCAL_CFG.resultInputGuardMs + 400;
/** Time a movement key is held to see the aim change. */
const LOCAL_AIM_HOLD_MS = 300;
/** A window too narrow for two boards. */
const LOCAL_TOO_SMALL_VIEWPORT = Object.freeze({ width: 600, height: 850 });
/** Layouts that cannot host two boards side by side (the entry stays hidden there). */
const LOCAL_ENTRY_HIDDEN_VIEWPORTS = Object.freeze(['phone landscape', 'phone portrait', 'narrow phone portrait']);
/** Short desktop windows around the height where two boards stop fitting. */
const LOCAL_SHORT_DESKTOP_WIDTH = 1366;
const LOCAL_SHORT_DESKTOP_HEIGHTS = Object.freeze([600, 650]);
const LOCAL_SHORT_DESKTOP_FITS_FROM = 650;
const LOCAL_PAD_BOTTOM_BUTTON = 0;
const LOCAL_PAD_START_BUTTON = 9;
/** The assertions below read English texts: the profile is pinned to English whatever the browser language. */
const LOCAL_PLAYER_STORAGE = Object.freeze({
  ...VERSUS_PLAYER_STORAGE,
  [`${STORAGE_PREFIX}${STORAGE_KEYS.language}`]: 'en'
});

/** Two stubbed standard pads: window.__setPads(list of pressed button lists, null for a pad that is gone). */
function installTwoPadStub() {
  window.__pads = [];
  window.__frame = 0;
  const countFrame = () => {
    window.__frame += 1;
    requestAnimationFrame(countFrame);
  };
  requestAnimationFrame(countFrame);
  navigator.getGamepads = () => window.__pads;
  const makePad = (index, pressed) => ({
    index,
    id: `stub standard pad ${index}`,
    mapping: 'standard',
    connected: true,
    timestamp: performance.now(),
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
    axes: [0, 0, 0, 0]
  });
  window.__setPads = (lists) => {
    window.__pads = lists.map((pressed, index) => (pressed === null ? null : makePad(index, pressed)));
  };
  window.__connectPads = () => {
    for (const pad of window.__pads) {
      if (pad) {
        const event = new Event('gamepadconnected');
        event.gamepad = pad;
        window.dispatchEvent(event);
      }
    }
  };
}

/** Opens the Play hub and the two-player lobby from its Duel card (the picker opens under the lobby). */
async function openVersusLocalLobby(page, viewport) {
  await openPlayHub(page, viewport);
  await waitShown(page, '#btn-versus-local-hub');
  await page.click('#btn-versus-local-hub');
  await waitShown(page, '#modal-versus-local');
}

const localStatusOf = (page, slot) =>
  page.evaluate((index) => document.querySelector(`#versus-local-slot-${index} .versus-local-status`).textContent, slot);

const localStartState = (page) => page.evaluate(() => document.querySelector('#btn-versus-local-start').getAttribute('aria-disabled'));

/** Joins both players with the quick keys and starts the match. */
async function startLocalMatchWithKeys(page, viewport) {
  await openVersusLocalLobby(page, viewport);
  await page.keyboard.press('KeyW');
  await page.keyboard.press('ArrowUp');
  await page.click('#btn-versus-local-start');
  await waitShown(page, '#versus-screen');
  await page.waitForFunction(() => Boolean(window.__versusBoards?.[0] && window.__versusBoards?.[1]));
}

/** Ends the round as if the given board crossed its danger line. */
function dropVersusBoard(page, board) {
  return page.evaluate(
    ({ index, reason }) => window.__versusBoards[index].triggerGameOver(reason),
    { index: board, reason: GAME_OVER_REASONS.LINE_CROSSED }
  );
}

describe('Polarity Duel, two players (desktop)', () => {
  const desktop = LOCAL_WIDE_VIEWPORT;

  test('both players join with their quick keys, start, steer their own board, and reach the result card', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: LOCAL_PLAYER_STORAGE });
    try {
      await captureVersusEngines(page);
      await openVersusLocalLobby(page, desktop);
      assert.equal(await page.evaluate(() => document.activeElement.className.includes('versus-local-change')), true, 'focus starts on the first Change');
      assert.equal(await localStartState(page), 'true');
      assert.match(await localStatusOf(page, 0), /Press to join/);
      await page.keyboard.press('KeyW');
      assert.match(await localStatusOf(page, 0), /Player 1: Left keys/);
      assert.equal(await localStartState(page), 'true', 'one player is not enough');
      await page.keyboard.press('ArrowUp');
      assert.match(await localStatusOf(page, 1), /Player 2: Right keys/);
      assert.equal(await localStartState(page), 'false');
      await page.click('#btn-versus-local-start');
      await waitShown(page, '#versus-screen');
      await page.waitForFunction(() => Boolean(window.__versusBoards?.[0] && window.__versusBoards?.[1]));

      assert.equal(await page.evaluate(() => document.querySelector('#versus-screen').dataset.mode), 'local');
      assert.equal(await page.evaluate(() => document.querySelector('#versus-screen').dataset.layout), 'split');
      await assertVersusFits(page, 'two players');
      for (const selector of ['#versus-canvas-0', '#versus-canvas-1', '#btn-versus-polarity', '#btn-versus-polarity-1', '#btn-versus-swap-1']) {
        assert.equal(await isShown(page, selector), true, `${selector} is shown`);
      }
      const labels = await page.evaluate(() => ({
        first: document.querySelector('#versus-canvas-0').getAttribute('aria-label'),
        second: document.querySelector('#versus-canvas-1').getAttribute('aria-label'),
        badges: Array.from(document.querySelectorAll('#versus-screen .versus-badge')).map((badge) => badge.textContent)
      }));
      assert.equal(labels.first, 'Player 1 board');
      assert.equal(labels.second, 'Player 2 board');
      assert.deepEqual(labels.badges, ['1', '2']);

      // Held keys steer one board each.
      const aims = () => page.evaluate(() => window.__versusBoards.map((board) => board.aimAngle));
      const before = await aims();
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(LOCAL_AIM_HOLD_MS);
      await page.keyboard.up('KeyD');
      const afterFirst = await aims();
      assert.ok(afterFirst[0] > before[0], 'D turns the first board to the right');
      assert.equal(afterFirst[1], before[1], 'the second board did not move');
      await page.keyboard.down('ArrowLeft');
      await page.waitForTimeout(LOCAL_AIM_HOLD_MS);
      await page.keyboard.up('ArrowLeft');
      const afterSecond = await aims();
      assert.ok(afterSecond[1] < afterFirst[1], 'the left arrow turns the second board to the left');
      assert.equal(afterSecond[0], afterFirst[0], 'the first board did not move');
      // Keys outside the two layouts do nothing here.
      await page.keyboard.press('Space');
      await page.keyboard.press('Digit1');
      assert.deepEqual(await aims(), afterSecond);

      // The first player wins two rounds.
      for (let round = 1; round <= VERSUS_ROUNDS_TO_WIN; round++) {
        await page.waitForFunction(() => window.__versusBoards[1].state === 'playing');
        await dropVersusBoard(page, 1);
        if (round < VERSUS_ROUNDS_TO_WIN) {
          await waitShown(page, '#versus-round-overlay');
          assert.match(await page.evaluate(() => document.querySelector('#versus-round-overlay').textContent), /Player 1 wins the round/);
          await page.waitForFunction(() => document.querySelector('#versus-round-overlay').classList.contains('hidden'), null, {
            timeout: VERSUS_ROUND_BREAK_WAIT_MS
          });
        }
      }
      await waitShown(page, '#modal-duel-result');
      assert.equal(await page.evaluate(() => document.querySelector('#modal-duel-result-title').textContent), 'Player 1 wins');
      assert.equal(
        await page.evaluate(() => document.querySelector('#versus-result-score').textContent),
        `Player 1 ${VERSUS_ROUNDS_TO_WIN} - 0 Player 2`
      );
      assert.equal(await isShown(page, '#btn-versus-share'), false, 'no Share for a match on one device');
      assert.equal(await isShown(page, '#versus-result-tier'), false, 'no CPU tier line');
      assert.equal(await isShown(page, '#btn-versus-change-players'), true);
      assert.equal(
        await page.evaluate(() => document.querySelector('#btn-versus-rematch').getAttribute('aria-disabled')),
        'true',
        'the main button waits out its guard time'
      );
      await page.waitForFunction(() => document.querySelector('#btn-versus-rematch').getAttribute('aria-disabled') === null, null, {
        timeout: LOCAL_RESULT_GUARD_WAIT_MS
      });
      const stored = await page.evaluate(
        ({ matches, stats }) => ({ matches: localStorage.getItem(matches), stats: localStorage.getItem(stats) }),
        { matches: `${STORAGE_PREFIX}${STORAGE_KEYS.versusLocalMatches}`, stats: `${STORAGE_PREFIX}${STORAGE_KEYS.playerStats}` }
      );
      assert.equal(stored.matches, '1', 'the finished match is counted');
      assert.equal(stored.stats, null, 'the personal statistics are untouched');
      await assertVersusFits(page, 'two players result');

      // Change players returns to the lobby with the same devices.
      await page.click('#btn-versus-change-players');
      await waitShown(page, '#modal-versus-local');
      assert.match(await localStatusOf(page, 0), /Player 1: Left keys/);
      assert.match(await localStatusOf(page, 1), /Player 2: Right keys/);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('two controllers join the lobby with their bottom button, and a lost one holds the match', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: LOCAL_PLAYER_STORAGE, initScript: installTwoPadStub });
    try {
      await captureVersusEngines(page);
      await page.evaluate(() => {
        window.__setPads([[], []]);
        window.__connectPads();
      });
      await waitFrames(page, PAD_FRAMES_PER_STEP);
      await openVersusLocalLobby(page, desktop);
      await waitFrames(page, PAD_FRAMES_PER_STEP);
      const tap = async (padIndex, button) => {
        await page.evaluate(
          ({ index, pressed }) => window.__setPads([0, 1].map((i) => (i === index ? [pressed] : []))),
          { index: padIndex, pressed: button }
        );
        await waitFrames(page, PAD_FRAMES_PER_STEP);
        await page.evaluate(() => window.__setPads([[], []]));
        await waitFrames(page, PAD_FRAMES_PER_STEP);
      };
      await tap(1, LOCAL_PAD_BOTTOM_BUTTON);
      assert.match(await localStatusOf(page, 0), /Player 1: Controller/, 'the first press takes the first free place');
      await tap(0, LOCAL_PAD_BOTTOM_BUTTON);
      assert.match(await localStatusOf(page, 1), /Player 2: Controller/);
      assert.equal(await localStartState(page), 'false');
      await page.click('#btn-versus-local-start');
      await waitShown(page, '#versus-screen');
      await page.waitForFunction(() => Boolean(window.__versusBoards?.[0] && window.__versusBoards?.[1]));
      await waitFrames(page, PAD_FRAMES_PER_STEP);
      // Pad 1 holds the first place: its Start button pauses the match.
      await tap(1, LOCAL_PAD_START_BUTTON);
      await waitShown(page, '#modal-duel-pause');
      // The pad of the first place goes away: the match stays paused and Resume is out of reach.
      await page.evaluate(() => {
        const lost = window.__pads[1];
        window.__setPads([[], null]);
        const event = new Event('gamepaddisconnected');
        event.gamepad = lost;
        window.dispatchEvent(event);
      });
      await page.waitForFunction(() => !document.querySelector('#versus-pause-pad-hint').classList.contains('hidden'));
      assert.equal(await page.evaluate(() => document.querySelector('#btn-versus-resume').getAttribute('aria-disabled')), 'true');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a window that shrinks below two boards pauses the match, says why, and keeps Resume out of reach', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: LOCAL_PLAYER_STORAGE });
    try {
      await captureVersusEngines(page);
      await startLocalMatchWithKeys(page, desktop);
      await page.setViewportSize(LOCAL_TOO_SMALL_VIEWPORT);
      await page.waitForFunction(() => document.querySelector('#versus-screen').dataset.tooSmall === 'true');
      await waitShown(page, '#modal-duel-pause');
      assert.equal(await isShown(page, '#versus-pause-size-hint'), true);
      assert.equal(await page.evaluate(() => document.querySelector('#versus-screen').dataset.layout), 'split', 'two boards never fall back to the mini-view');
      assert.equal(await page.evaluate(() => document.querySelector('#btn-versus-resume').getAttribute('aria-disabled')), 'true');
      await page.click('#btn-versus-resume', { force: true });
      assert.equal(await isShown(page, '#modal-duel-pause'), true, 'a press on the disabled Resume does nothing');
      await page.setViewportSize({ width: desktop.width, height: desktop.height });
      await page.waitForFunction(() => document.querySelector('#versus-screen').dataset.tooSmall === 'false');
      assert.equal(await isShown(page, '#versus-pause-size-hint'), false, 'the hint clears once the boards fit');
      assert.equal(await page.evaluate(() => document.querySelector('#btn-versus-resume').getAttribute('aria-disabled')), 'false');
      assert.equal(await isShown(page, '#modal-duel-pause'), true, 'the match stays paused');
      await page.click('#btn-versus-resume');
      await page.waitForFunction(() => document.querySelector('#modal-duel-pause').classList.contains('hidden'));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe('Polarity Duel, two players entry by layout', () => {
  for (const viewport of VIEWPORTS) {
    const isHidden = LOCAL_ENTRY_HIDDEN_VIEWPORTS.includes(viewport.name);
    test(`the two-player entry is ${isHidden ? 'hidden' : 'offered'} on ${viewport.name}`, async () => {
      const { context, page, errors } = await openGame(viewport, { initStorage: LOCAL_PLAYER_STORAGE });
      try {
        await openPlayHub(page, viewport);
        assert.equal(await isShown(page, '#btn-versus-local-hub'), !isHidden, 'the Play hub offers the entry only where two boards fit');
        assert.equal(await isShown(page, '#versus-local-hub-hint'), isHidden, 'the hint stands in where the entry is hidden');
        // The difficulty picker keeps the same entry rule.
        await page.click('#btn-mode-versus');
        await waitShown(page, '#modal-versus-tiers');
        assert.equal(await isShown(page, '#btn-versus-local'), !isHidden);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  // A short desktop window: the entry is offered exactly when the split layout fits.
  for (const height of LOCAL_SHORT_DESKTOP_HEIGHTS) {
    test(`on a ${LOCAL_SHORT_DESKTOP_WIDTH}x${height} window the entry matches what the match can show`, async () => {
      const viewport = { ...LOCAL_WIDE_VIEWPORT, width: LOCAL_SHORT_DESKTOP_WIDTH, height };
      const { context, page, errors } = await openGame(viewport, { initStorage: LOCAL_PLAYER_STORAGE });
      try {
        await captureVersusEngines(page);
        await openPlayHub(page, viewport);
        const isOffered = await isShown(page, '#btn-versus-local-hub');
        assert.equal(isOffered, height >= LOCAL_SHORT_DESKTOP_FITS_FROM, 'the entry follows the split layout requirement');
        assert.equal(await isShown(page, '#versus-local-hub-hint'), !isOffered, 'the hint stands in where the entry is hidden');
        if (isOffered) {
          await page.click('#btn-versus-local-hub');
          await waitShown(page, '#modal-versus-local');
          await page.keyboard.press('KeyW');
          await page.keyboard.press('ArrowUp');
          await page.click('#btn-versus-local-start');
          await waitShown(page, '#versus-screen');
          await page.waitForFunction(() => Boolean(window.__versusBoards?.[0] && window.__versusBoards?.[1]));
          assert.equal(await page.evaluate(() => document.querySelector('#versus-screen').dataset.tooSmall), 'false');
          assert.equal(await isShown(page, '#modal-duel-pause'), false, 'the match opens running, not held');
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

describe('Magnetar boss', () => {
  const MAGNETAR_WAVE = 3;

  /** Starts Boss Rush on the wave and puts the Magnetar in the armed phase, like a warning would. */
  const armMagnetar = (page) =>
    page.evaluate(async (wave) => {
      const { MAGNETAR_BEHAVIOURS, MAGNETAR_PHASES } = await import('/src/game/MagnetarRules.js');
      const engine = window.__fluxEngine;
      engine.startBossRushMode(wave);
      const magnetar = engine.magnetar;
      magnetar.phase = MAGNETAR_PHASES.ARMED;
      magnetar.armed = MAGNETAR_BEHAVIOURS.INVERT;
      magnetar.plan = engine.planMagnetarBehaviour(engine.getMagnetarBall());
      engine.applyMagnetarArmedEffects();
      engine.notifyUI();
    }, MAGNETAR_WAVE);

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: wave ${MAGNETAR_WAVE} shows the telegraph chip without overlap or HUD change`, async () => {
      const { context, page, errors } = await openGame(viewport, { initStorage: EXISTING_PLAYER_STORAGE });
      try {
        await startLevelOne(page);
        await page.evaluate(async (wave) => {
          window.__fluxEngine.startBossRushMode(wave);
          window.__fluxEngine.notifyUI();
        }, MAGNETAR_WAVE);
        const before = await hudTrackCount(page);
        assert.equal(await isShown(page, '#hud-magnetar-telegraph'), false, 'no warning while the Magnetar rests');
        await armMagnetar(page);
        await waitShown(page, '#hud-magnetar-telegraph');
        const after = await hudTrackCount(page);
        assert.equal(after.tracks, before.tracks, 'the chip adds no HUD column');
        const layout = await page.evaluate(() => {
          const chip = document.querySelector('#hud-magnetar-telegraph');
          const rect = chip.getBoundingClientRect();
          const bar = document.querySelector('.hud-bar').getBoundingClientRect();
          const overlaps = [...document.querySelectorAll('.hud-bar > *, .hud-bar .hud-center-info > * > *')]
            .filter((el) => el !== chip && !el.contains(chip) && !chip.contains(el) && el.offsetParent !== null)
            .filter((el) => {
              const other = el.getBoundingClientRect();
              return (
                rect.left < other.right && other.left < rect.right && rect.top < other.bottom && other.top < rect.bottom
              );
            })
            .map((el) => el.id || el.className);
          return {
            text: chip.textContent.trim(),
            ariaHidden: chip.getAttribute('aria-hidden'),
            insideBar: rect.left >= bar.left - 1 && rect.right <= bar.right + 1,
            overlaps,
            slot: document.querySelector('#hud-shots-label').textContent.trim()
          };
        });
        assert.match(layout.text, /^\S+ \S.*\S$/u, 'a glyph, then words');
        assert.equal(layout.ariaHidden, 'true');
        assert.equal(layout.insideBar, true, 'the chip stays inside the HUD bar');
        assert.deepEqual(layout.overlaps, [], 'the chip overlaps no other HUD element');
        assert.match(layout.slot, /^(Moorings|Amarres)$/);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  test('the Codex lists the four Magnetar patterns', async () => {
    const desktop = VIEWPORTS[0];
    const { context, page, errors } = await openGame(desktop, { initStorage: EXISTING_PLAYER_STORAGE });
    try {
      await startLevelOne(page);
      await clickMenuButton(page, desktop, '#btn-shop');
      await waitShown(page, '#modal-shop');
      await page.click('#tab-shop-codex');
      await waitShown(page, '#codex-pane');
      const cards = await page.evaluate(() =>
        [...document.querySelectorAll('[data-codex-section="magnetarPatterns"] .codex-card')].map((el) =>
          el.querySelector('.codex-title').textContent.trim()
        )
      );
      assert.equal(cards.length, 4, 'one card per behaviour');
      assert.equal(new Set(cards).size, 4, 'each card has its own name');
      assert.ok(cards.every((name) => name.length > 0));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

/** Opens the versus screen without waiting for the boards to run (a held match never updates them). */
async function openVersusMatchScreen(page, viewport, tier) {
  await openVersusTierPicker(page, viewport);
  await page.click(`.versus-tier-btn[data-tier="${tier}"]`);
  await waitShown(page, '#versus-screen');
}

/** The first-duel tutorial: a profile that never saw it. */
const TUTORIAL_UNSEEN_STORAGE = Object.freeze({
  ...VERSUS_PLAYER_STORAGE,
  [`${STORAGE_PREFIX}${STORAGE_KEYS.versusTutorialSeen}`]: 'false'
});
const TUTORIAL_HOLD_WAIT_MS = 400;
const TUTORIAL_STEP_COUNT = GAME_CONFIG.versus.tutorial.steps.length;

describe('Polarity Duel first-duel tutorial', () => {
  test('the tutorial opens on the first duel, holds the match, walks its steps and is never shown again', async () => {
    const viewport = VIEWPORTS[0];
    const { context, page, errors } = await openGame(viewport, { initStorage: TUTORIAL_UNSEEN_STORAGE });
    try {
      await captureVersusEngines(page);
      await openVersusMatchScreen(page, viewport, 'easy');
      await waitShown(page, '#versus-tutorial');
      const dialog = await page.evaluate(() => {
        const el = document.querySelector('#versus-tutorial');
        return {
          role: el.getAttribute('role'),
          modal: el.getAttribute('aria-modal'),
          focusInside: el.contains(document.activeElement)
        };
      });
      assert.deepEqual(dialog, { role: 'dialog', modal: 'true', focusInside: true });
      const held = await page.evaluate(() => window.__versusUpdates);
      await page.waitForTimeout(TUTORIAL_HOLD_WAIT_MS);
      assert.equal(await page.evaluate(() => window.__versusUpdates), held, 'the match is held while the tutorial is open');
      for (let step = 1; step < TUTORIAL_STEP_COUNT; step++) {
        await page.click('#versus-tutorial-next');
      }
      await page.click('#versus-tutorial-next');
      await page.waitForFunction(() => !document.querySelector('#versus-tutorial'));
      await page.waitForFunction((before) => window.__versusUpdates > before, held);
      const stored = await page.evaluate(
        (key) => localStorage.getItem(key),
        `${STORAGE_PREFIX}${STORAGE_KEYS.versusTutorialSeen}`
      );
      assert.equal(stored, 'true');

      // A second duel in the same session does not bring it back.
      await page.click('#btn-versus-pause');
      await waitShown(page, '#modal-duel-pause');
      await page.click('#btn-versus-quit');
      await page.waitForFunction(() => document.querySelector('#versus-screen').classList.contains('hidden'));
      await page.evaluate(() => {
        window.__versusUpdates = 0;
      });
      await waitShown(page, '#modal-pause');
      await page.click('#btn-resume');
      await openVersusMatchScreen(page, viewport, 'easy');
      await page.waitForFunction(() => window.__versusUpdates > 0);
      assert.equal(await page.evaluate(() => Boolean(document.querySelector('#versus-tutorial'))), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('Escape skips the tutorial at once and the match runs', async () => {
    const viewport = VIEWPORTS[0];
    const { context, page, errors } = await openGame(viewport, { initStorage: TUTORIAL_UNSEEN_STORAGE });
    try {
      await captureVersusEngines(page);
      await openVersusMatchScreen(page, viewport, 'easy');
      await waitShown(page, '#versus-tutorial');
      const held = await page.evaluate(() => window.__versusUpdates);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#versus-tutorial'));
      await page.waitForFunction((before) => window.__versusUpdates > before, held);
      assert.equal(await isShown(page, '#modal-duel-pause'), false, 'skipping resumes, it does not open the pause dialog');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

// Pulse: the music and Resonance settings, the calibration dialog and the beat ring.

const PULSE_SETTING_BUTTONS = Object.freeze(['#btn-music', '#btn-music-volume', '#btn-resonance', '#btn-calibrate']);
/** Viewports where a whole calibration run (about ten beats) is played; the others check the dialog only. */
const CALIBRATION_RUN_VIEWPORTS = new Set(['desktop', 'phone portrait']);
const RESONANCE_CONFIG = GAME_CONFIG.resonance;
const CALIBRATION_BEAT_MS = 60000 / RESONANCE_CONFIG.calibrationBpm;
const CALIBRATION_RUN_MS = (RESONANCE_CONFIG.calibrationLeadBeats + RESONANCE_CONFIG.calibrationBeats + 3) * CALIBRATION_BEAT_MS;
/** How early the scripted calibration taps land, ahead of each pulse. */
const CALIBRATION_EARLY_MS = 40;
/** Rounding slack between the scripted early amount and the saved offset. */
const CALIBRATION_OFFSET_TOLERANCE_MS = 1;
const RING_WAIT_MS = 500;
const SETTINGS_GROUPS = Object.freeze([
  { titleId: 'settings-group-audio-title', contains: ['#btn-sound', '#btn-music', '#btn-music-volume'] },
  { titleId: 'settings-group-gameplay-title', contains: ['#btn-resonance', '#btn-calibrate', '#btn-tilt', '#btn-lang', '#input-duel-name'] },
  { titleId: 'settings-group-accessibility-title', contains: ['#btn-contrast', '#btn-patterns', '#btn-motion', '#input-gamepad-rumble'] },
  { titleId: 'settings-controller-title', contains: ['#settings-controller-nopad', '#settings-controller-fields'] }
]);
/** Sub-pixel slack when comparing boxes. */
const SETTINGS_BOX_TOLERANCE_PX = 0.5;
/** A profile that cleared the campaign up to the Resonance unlock (resonance.unlockAfterCampaignLevel). */
const RESONANCE_UNLOCKED_STORAGE = Object.freeze({
  [`${STORAGE_PREFIX}${STORAGE_KEYS.unlockedLevel}`]: String(RESONANCE_CONFIG.unlockAfterCampaignLevel + 1)
});

/** Fails when a dialog is wider than the window or its card scrolls sideways. */
async function assertDialogFits(page, selector, label) {
  const fit = await page.evaluate(
    ({ sel, tolerance }) => {
      const modal = document.querySelector(sel);
      const card = modal.querySelector('.modal-card');
      return {
        page: document.documentElement.scrollWidth - window.innerWidth,
        card: card.scrollWidth - card.clientWidth,
        right: card.getBoundingClientRect().right - window.innerWidth + tolerance
      };
    },
    { sel: selector, tolerance: OVERFLOW_TOLERANCE_PX }
  );
  assert.ok(fit.page <= OVERFLOW_TOLERANCE_PX, `${label}: the page scrolls sideways by ${fit.page}px`);
  assert.ok(fit.card <= OVERFLOW_TOLERANCE_PX, `${label}: the card scrolls sideways by ${fit.card}px`);
  assert.ok(fit.right <= OVERFLOW_TOLERANCE_PX * 2, `${label}: the card leaves the window`);
}

/** Counts the frames in which the beat ring was drawn, through a hook on the renderer. */
async function hookBeatRing(page) {
  await page.evaluate(async () => {
    const { Renderer } = await import('/src/game/Renderer.js');
    const original = Renderer.prototype.drawBeatRing;
    window.__ringFrames = 0;
    Renderer.prototype.drawBeatRing = function countRing(ctx, ...args) {
      let arcs = 0;
      const arc = ctx.arc;
      ctx.arc = function countArc(...arcArgs) {
        arcs += 1;
        return arc.apply(this, arcArgs);
      };
      try {
        return original.call(this, ctx, ...args);
      } finally {
        delete ctx.arc;
        if (arcs > 0) {
          window.__ringFrames += 1;
        }
      }
    };
  });
}

for (const viewport of VIEWPORTS) {
  describe(`pulse: ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test('Settings lists Music, Music volume, Resonance and Calibrate rhythm, named and inside the window', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await startLevelOne(page);
        await clickMenuButton(page, viewport, '#btn-settings');
        await waitShown(page, '#modal-settings');
        for (const selector of PULSE_SETTING_BUTTONS) {
          await page.locator(selector).scrollIntoViewIfNeeded();
          assert.equal(await isShown(page, selector), true, `${selector} is shown`);
          const name = await page.evaluate(
            (sel) => document.querySelector(sel).getAttribute('aria-label') || document.querySelector(sel).textContent.trim(),
            selector
          );
          assert.ok(name.length > 0, `${selector} has an accessible name`);
        }
        await assertDialogFits(page, '#modal-settings', 'Settings');
        await assertLayoutFits(page, 'settings with the pulse rows');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the Music button and the volume button change and keep their settings', async () => {
      const { context, page, errors } = await openGame(viewport, { initStorage: RESONANCE_UNLOCKED_STORAGE });
      try {
        await startLevelOne(page);
        await clickMenuButton(page, viewport, '#btn-settings');
        await waitShown(page, '#modal-settings');
        const musicKey = `${STORAGE_PREFIX}${STORAGE_KEYS.musicEnabled}`;
        const volumeKey = `${STORAGE_PREFIX}${STORAGE_KEYS.musicVolume}`;
        const resonanceKey = `${STORAGE_PREFIX}${STORAGE_KEYS.resonanceEnabled}`;
        await page.locator('#btn-music').scrollIntoViewIfNeeded();
        await page.click('#btn-music');
        assert.equal(await page.evaluate((key) => window.localStorage.getItem(key), musicKey), 'false');
        assert.equal(await page.getAttribute('#btn-music', 'aria-pressed'), 'false');
        await page.click('#btn-music-volume');
        assert.notEqual(await page.evaluate((key) => window.localStorage.getItem(key), volumeKey), null);
        await page.locator('#btn-resonance').scrollIntoViewIfNeeded();
        await page.click('#btn-resonance');
        assert.equal(await page.evaluate((key) => window.localStorage.getItem(key), resonanceKey), 'false');
        assert.equal(
          await page.evaluate(() => window.__fluxEngine.getBeatState().resonanceActive),
          false,
          'the setting off hides the ring in the Campaign'
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the calibration dialog opens over Settings, fits the window and Escape closes only it', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await startLevelOne(page);
        await clickMenuButton(page, viewport, '#btn-settings');
        await waitShown(page, '#modal-settings');
        await page.locator('#btn-calibrate').scrollIntoViewIfNeeded();
        await page.click('#btn-calibrate');
        await waitShown(page, '#modal-calibrate');
        assert.ok(
          await page.evaluate(() => document.querySelector('#modal-calibrate').contains(document.activeElement)),
          'the dialog takes focus'
        );
        assert.equal(await page.getAttribute('#modal-calibrate', 'aria-modal'), 'true');
        await assertDialogFits(page, '#modal-calibrate', 'Calibration');
        const intro = await page.textContent('#calibrate-intro');
        assert.ok(intro.includes(String(RESONANCE_CONFIG.calibrationBeats)), 'the intro states the number of taps');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('#modal-calibrate').classList.contains('hidden'));
        assert.equal(await isShown(page, '#modal-settings'), true, 'Settings stays open under it');
        assert.equal(await engineState(page), GAME_STATES.PAUSED, 'the run stays paused');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    if (CALIBRATION_RUN_VIEWPORTS.has(viewport.name)) {
      test('a calibration run saves the offset of the taps, and Reset clears it', async () => {
        const { context, page, errors } = await openGame(viewport);
        try {
          await startLevelOne(page);
          await page.evaluate(async () => {
            const { UIManager } = await import('/src/ui/UIManager.js');
            const original = UIManager.prototype.startCalibrationRun;
            UIManager.prototype.startCalibrationRun = function captureUi(...args) {
              window.__calibrationUi = this;
              return original.apply(this, args);
            };
          });
          await clickMenuButton(page, viewport, '#btn-settings');
          await waitShown(page, '#modal-settings');
          await page.locator('#btn-calibrate').scrollIntoViewIfNeeded();
          await page.click('#btn-calibrate');
          await waitShown(page, '#modal-calibrate');
          // Tap every counted pulse a fixed amount early. The tap carries its own timestamp (the
          // pulse time minus the early amount, from the calibration's own clock), so the result does
          // not depend on how late a frame callback runs. The ring window is only observed.
          await page.evaluate(({ earlyMs, leadBeats, totalBeats }) => {
            const ui = window.__calibrationUi;
            const ring = document.querySelector('#calibrate-ring');
            const stepMs = ui.engine.physicsConfig.simulation.fixedStepMs;
            const sent = new Set();
            window.__ringWindowSeen = false;
            const watch = () => {
              if (ring.getAttribute('data-window') === 'true') {
                window.__ringWindowSeen = true;
              }
              const calibration = ui.calibration;
              if (calibration) {
                const now = performance.now();
                const startAt = now - calibration.getFrame(now, stepMs) * stepMs;
                for (let index = leadBeats; index < totalBeats; index += 1) {
                  const tapAt = startAt + index * calibration.beatMs - earlyMs;
                  if (!sent.has(index) && now >= tapAt) {
                    sent.add(index);
                    ui.registerCalibrationTap(tapAt);
                  }
                }
              }
              requestAnimationFrame(watch);
            };
            requestAnimationFrame(watch);
          }, {
            earlyMs: CALIBRATION_EARLY_MS,
            leadBeats: RESONANCE_CONFIG.calibrationLeadBeats,
            totalBeats: RESONANCE_CONFIG.calibrationLeadBeats + RESONANCE_CONFIG.calibrationBeats
          });
          const offsetKey = `${STORAGE_PREFIX}${STORAGE_KEYS.rhythmOffsetMs}`;
          await page.waitForFunction(
            (key) => window.localStorage.getItem(key) !== null,
            offsetKey,
            { timeout: CALIBRATION_RUN_MS + WAIT_TIMEOUT_MS }
          );
          const saved = Number(await page.evaluate((key) => window.localStorage.getItem(key), offsetKey));
          assert.ok(saved < 0 && saved >= -RESONANCE_CONFIG.maxOffsetMs, `early taps save a negative offset (${saved})`);
          assert.ok(
            Math.abs(saved + CALIBRATION_EARLY_MS) <= CALIBRATION_OFFSET_TOLERANCE_MS,
            `the offset is the scripted early amount (${saved})`
          );
          assert.equal(await page.evaluate(() => window.__ringWindowSeen), true, 'the ring opened its window during the run');
          assert.match(await page.textContent('#calibrate-result'), new RegExp(String(Math.abs(saved))));
          await page.click('#btn-calibrate-reset');
          await page.waitForFunction(
            (key) => window.localStorage.getItem(key) === '0',
            offsetKey
          );
          await page.click('#btn-calibrate-done');
          await page.waitForFunction(() => document.querySelector('#modal-calibrate').classList.contains('hidden'));
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }

    test('Settings has its four groups, each with a visible heading, inside the window', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await startLevelOne(page);
        await clickMenuButton(page, viewport, '#btn-settings');
        await waitShown(page, '#modal-settings');
        const groups = await page.evaluate((specs) => {
          const cardRect = document.querySelector('#modal-settings .modal-card').getBoundingClientRect();
          return specs.map(({ titleId, contains }) => {
            const title = document.getElementById(titleId);
            const group = title?.closest('section.settings-group');
            const rect = group?.getBoundingClientRect();
            const titleRect = title?.getBoundingClientRect();
            return {
              titleId,
              hasGroup: Boolean(group),
              labelledBy: group?.getAttribute('aria-labelledby') ?? null,
              titleText: title?.textContent.trim() ?? '',
              titleTag: title?.tagName ?? '',
              contained: contains.map((selector) => Boolean(group?.querySelector(selector))),
              fitsWidth: Boolean(rect)
                && rect.left >= cardRect.left - 1 && rect.right <= cardRect.right + 1
                && rect.right <= window.innerWidth + 1 && rect.left >= -1,
              titleInside: Boolean(titleRect) && Boolean(rect)
                && titleRect.left >= rect.left - 1 && titleRect.right <= rect.right + 1
                && titleRect.height > 0,
              top: rect?.top ?? 0
            };
          });
        }, SETTINGS_GROUPS);
        for (const group of groups) {
          assert.equal(group.hasGroup, true, `${group.titleId} sits in a settings group`);
          assert.equal(group.titleTag, 'H3', `${group.titleId} is a level 3 heading`);
          assert.equal(group.labelledBy, group.titleId, `${group.titleId} labels its group`);
          assert.ok(group.titleText.length > 0, `${group.titleId} has text`);
          assert.ok(group.contained.every(Boolean), `${group.titleId} holds its controls (${group.contained})`);
          assert.equal(group.fitsWidth, true, `${group.titleId} group fits the dialog`);
          assert.equal(group.titleInside, true, `${group.titleId} heading fits its group`);
        }
        const tops = groups.map((group) => group.top);
        assert.deepEqual([...tops].sort((a, b) => a - b), tops, 'the groups keep their order from top to bottom');
        await assertDialogFits(page, '#modal-settings', 'Settings groups');
        await assertLayoutFits(page, 'settings groups');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the Vibration checkbox is in the Accessibility group', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await startLevelOne(page);
        await clickMenuButton(page, viewport, '#btn-settings');
        await waitShown(page, '#modal-settings');
        const groupTitleId = await page.evaluate(
          () => document.querySelector('#input-gamepad-rumble')?.closest('section.settings-group')?.getAttribute('aria-labelledby') ?? null
        );
        assert.equal(groupTitleId, 'settings-group-accessibility-title');
        await page.locator('#input-gamepad-rumble').scrollIntoViewIfNeeded();
        assert.equal(await isShown(page, '#input-gamepad-rumble'), true, 'the checkbox is shown without a pad');
        const label = await page.evaluate(() => document.querySelector('#input-gamepad-rumble').closest('label').textContent.trim());
        assert.ok(label.length > 0, 'the checkbox has a label');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the controller fields are hidden without a pad and shown once one is connected', async () => {
      const { context, page, errors } = await openGame(viewport, { initScript: installPadStub });
      try {
        await startLevelOne(page);
        await clickMenuButton(page, viewport, '#btn-settings');
        await waitShown(page, '#modal-settings');
        await page.locator('#settings-controller-nopad').scrollIntoViewIfNeeded();
        assert.equal(await isShown(page, '#settings-controller-fields'), false, 'no pad: the fields are hidden');
        assert.equal(await isShown(page, '#settings-controller-nopad'), true, 'no pad: the hint is shown');
        const hiddenHeight = await page.evaluate(() => document.querySelector('#settings-controller-fields').getBoundingClientRect().height);
        assert.ok(hiddenHeight <= SETTINGS_BOX_TOLERANCE_PX, 'the hidden fields take no room');
        await connectPad(page);
        await page.locator('#settings-controller-fields').scrollIntoViewIfNeeded();
        assert.equal(await isShown(page, '#settings-controller-fields'), true, 'a connected pad shows the fields');
        assert.equal(await isShown(page, '#settings-controller-nopad'), false, 'a connected pad hides the hint');
        for (const selector of ['#input-gamepad-enabled', '#select-gamepad-deadzone', '#select-gamepad-aim-speed', '#input-gamepad-invert-x']) {
          assert.equal(await isShown(page, selector), true, `${selector} is shown with a pad`);
        }
        await assertDialogFits(page, '#modal-settings', 'Settings with a pad');
        await assertLayoutFits(page, 'settings with a pad');
        // The state of the pad survives reopening the dialog; a pad that is gone hides the fields again.
        await page.click('#btn-close-settings');
        await clickMenuButton(page, viewport, '#btn-settings');
        await waitShown(page, '#modal-settings');
        assert.equal(await isShown(page, '#settings-controller-fields'), true, 'the fields stay on reopening');
        await page.evaluate(() => {
          const pad = window.__pads[0];
          window.__pads = [];
          const event = new Event('gamepaddisconnected');
          event.gamepad = pad;
          window.dispatchEvent(event);
        });
        await page.waitForFunction(() => document.querySelector('#settings-controller-fields').classList.contains('hidden'));
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a fresh profile has no beat ring on level 1', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await hookBeatRing(page);
        await startLevelOne(page);
        assert.equal(await page.evaluate(() => window.__fluxEngine.getBeatState().resonanceActive), false);
        assert.equal(await page.evaluate(() => window.__fluxEngine.getResonanceBlockReason()), 'locked');
        await page.waitForTimeout(RING_WAIT_MS);
        assert.equal(await page.evaluate(() => window.__ringFrames), 0, 'no ring frame is drawn before the unlock');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the beat ring is drawn in the Campaign and hidden in the Daily', async () => {
      const { context, page, errors } = await openGame(viewport, { initStorage: RESONANCE_UNLOCKED_STORAGE });
      try {
        await hookBeatRing(page);
        await startLevelOne(page);
        assert.equal(await page.evaluate(() => window.__fluxEngine.getBeatState().resonanceActive), true);
        await page.waitForFunction(() => window.__ringFrames > 0);
        await page.evaluate(() => {
          const engine = window.__fluxEngine;
          engine.startDailyChallenge();
          engine.notifyUI();
        });
        await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
        assert.equal(await page.evaluate(() => window.__fluxEngine.getBeatState().resonanceActive), false);
        const before = await page.evaluate(() => window.__ringFrames);
        await page.waitForTimeout(RING_WAIT_MS);
        assert.equal(await page.evaluate(() => window.__ringFrames), before, 'no ring frame is drawn in the Daily');
        await assertLayoutFits(page, 'daily with the ring hook');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}


/*
 * Play hub and campaign map. The hub (#modal-play) lists every mode; the map (#modal-levels)
 * is the campaign only: chapter switcher, level tiles and a detail panel. Texts are read from
 * the locale files, never typed here.
 */

/** Hub cards by gated mode id, each with the card button of the Play hub. */
const HUB_CARD_BY_MODE = Object.freeze({
  endless: '#btn-endless',
  classic: '#btn-mode-classic',
  puzzle: '#btn-mode-puzzle',
  blitz: '#btn-mode-blitz',
  flux: '#btn-flux',
  cascade: '#btn-mode-cascade',
  boss_rush: '#btn-mode-boss-rush',
  versus: '#btn-mode-versus'
});
/** Arcade modes of the hub (the Duel has its own section). */
const HUB_ARCADE_MODES = Object.freeze(['endless', 'classic', 'puzzle', 'blitz', 'flux', 'cascade', 'boss_rush']);
/** Sections of the hub, in order, with the locale key of their heading. */
const HUB_SECTION_KEYS = Object.freeze([
  'modals.play.section.campaign',
  'modals.play.section.challenges',
  'modals.play.section.arcade',
  'modals.play.section.duel'
]);
/** Buttons the slide-in menu keeps now that the modes live in the hub. */
const DRAWER_BUTTON_IDS = Object.freeze(['btn-play', 'btn-stats', 'btn-settings', 'btn-pause', 'btn-restart', 'btn-shop']);
/** Smallest tile of the campaign map, in CSS pixels (the touch target size), and the columns the narrowest phone must keep. */
const MAP_MIN_TILE_PX = 44;
const MAP_NARROW_MIN_COLUMNS = 4;
const NARROW_PHONE = 'narrow phone portrait';
/** An existing player far into the campaign, with Classic, Puzzle and Flux open. */
const MAP_PLAYER_STORAGE = Object.freeze({
  [`${STORAGE_PREFIX}${STORAGE_KEYS.unlockedLevel}`]: String(UNLOCKED_GENERATED_LEVEL),
  [`${STORAGE_PREFIX}${STORAGE_KEYS.schemaVersion}`]: '1'
});
/** Standard-mapping buttons the hub and the map answer to, from the gamepad config. */
const HUB_PAD_BUTTONS = Object.freeze({
  back: GAME_CONFIG.gamepad.buttons.back[0],
  chapterPrev: GAME_CONFIG.gamepad.buttons.specialPrev[0],
  chapterNext: GAME_CONFIG.gamepad.buttons.specialNext[0],
  dpadRight: GAME_CONFIG.gamepad.buttons.right,
  dpadLeft: GAME_CONFIG.gamepad.buttons.left
});

/** Fails when a hub card or its text runs past its box, or the dialog scrolls sideways. */
async function assertHubFits(page, label) {
  const found = await page.evaluate((tolerance) => {
    const card = document.querySelector('#modal-play .modal-card');
    const cardRect = card.getBoundingClientRect();
    const clipped = [...document.querySelectorAll('#modal-play .arcade-mode-card, #modal-play .arcade-mode-card > *, #modal-play [class*="arcade-card-"]')]
      .filter((el) => el.checkVisibility() && el.clientWidth > 0)
      .filter((el) => el.scrollWidth > el.clientWidth + tolerance)
      .map((el) => el.id || el.className);
    const outside = [...document.querySelectorAll('#modal-play .arcade-mode-card, #modal-play button')]
      .filter((el) => el.checkVisibility())
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.left < cardRect.left - tolerance || rect.right > cardRect.right + tolerance;
      })
      .map((el) => el.id || el.className);
    return { clipped, outside, dialogScroll: card.scrollWidth - card.clientWidth };
  }, OVERFLOW_TOLERANCE_PX);
  assert.deepEqual(found.clipped, [], `${label}: text runs past its card`);
  assert.deepEqual(found.outside, [], `${label}: controls leave the dialog sideways`);
  assert.ok(found.dialogScroll <= OVERFLOW_TOLERANCE_PX, `${label}: the dialog scrolls sideways`);
  await assertLayoutFits(page, label);
}

/** The state of the campaign map: tiles in order, the selected and focused level, the roving stop and the chapter. */
const readMapState = (page) =>
  page.evaluate(() => {
    const tiles = [...document.querySelectorAll('#levels-grid .level-tile')];
    const selected = tiles.find((tile) => tile.getAttribute('aria-selected') === 'true');
    return {
      ids: tiles.map((tile) => tile.dataset.levelId),
      lockedIds: tiles.filter((tile) => tile.getAttribute('aria-disabled') === 'true').map((tile) => tile.dataset.levelId),
      selectedId: selected?.dataset.levelId ?? null,
      selectedCount: tiles.filter((tile) => tile.getAttribute('aria-selected') === 'true').length,
      focusedId: document.activeElement?.dataset?.levelId ?? null,
      stops: tiles.filter((tile) => tile.tabIndex === 0).length,
      header: document.querySelector('#levels-detail-header').textContent,
      chapter: document.querySelector('#levels-chapter-select').value,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });

for (const viewport of VIEWPORTS) {
  describe(`play hub: ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    for (const language of Object.keys(LOCALES)) {
      test(`the Play hub opens over the run, pauses it, lists its four sections and fits the window (${language})`, async () => {
        const { context, page, errors } = await openGame(viewport, { initStorage: languageStorage(language) });
        try {
          await startLevelOne(page);
          await clickMenuButton(page, viewport, '#btn-play');
          await waitShown(page, '#modal-play');
          assert.equal(await engineState(page), GAME_STATES.PAUSED, 'the hub pauses the run');
          assert.ok(await page.evaluate(() => document.querySelector('#modal-play').contains(document.activeElement)), 'the hub takes focus');
          assert.equal(await focusedId(page), 'btn-campaign-continue', 'a campaign run opens the hub on its Continue button');
          assert.equal(await page.evaluate(() => document.querySelector('.app-shell').inert), true, 'the shell is out of reach');
          assert.equal(await textOf(page, '#modal-play-title'), localeText(language, 'modals.play.title'));
          assert.equal(
            await textOf(page, '#btn-campaign-continue'),
            localeText(language, 'modals.levelSelect.button.resume', { level: 1 }),
            'the running level is offered for resuming'
          );
          const headings = await page.evaluate(() =>
            [...document.querySelectorAll('#modal-play section[aria-labelledby]')].map((section) => {
              // The accessible name leaves out decorative (aria-hidden) icons.
              const heading = document.getElementById(section.getAttribute('aria-labelledby'))?.cloneNode(true);
              heading?.querySelectorAll('[aria-hidden="true"]').forEach((icon) => icon.remove());
              return heading?.textContent.trim() ?? '';
            })
          );
          assert.deepEqual(headings, HUB_SECTION_KEYS.map((key) => localeText(language, key)), 'four sections, in order');
          await assertHubFits(page, `Play hub (${language})`);

          await page.keyboard.press('Escape');
          await page.waitForFunction(() => document.querySelector('#modal-play').classList.contains('hidden'));
          assert.equal(await engineState(page), GAME_STATES.PLAYING, 'closing the hub resumes the run');
          assert.equal(await isShown(page, '#modal-pause'), false, 'closing the hub leaves no Pause dialog');
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }

    test('a fresh profile finds every gated card locked in the hub; a tap names the level that opens it', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await openPlayHub(page, viewport);
        const required = GAME_CONFIG.modeUnlocks.campaignLevelCleared;
        const gated = [
          ...Object.entries(HUB_CARD_BY_MODE).map(([mode, selector]) => ({ selector, level: required[mode] })),
          { selector: '#btn-weekly', level: WEEKLY_REQUIRED_LEVEL }
        ];
        const modeBefore = await page.evaluate(() => window.__fluxEngine.mode);
        for (const { selector, level } of gated) {
          assert.equal(await isMenuItemLocked(page, selector), true, `${selector} is locked`);
          assert.equal(
            await page.evaluate((sel) => document.querySelector(sel).classList.contains('is-locked'), selector),
            true,
            `${selector} looks locked`
          );
          assert.ok(
            await page.evaluate((sel) => (document.querySelector(sel).getAttribute('title') || '').trim().length > 0, selector),
            `${selector} states why in its tooltip`
          );
          // Playwright refuses to click an aria-disabled button: dispatch the click the player's tap would produce.
          await page.dispatchEvent(selector, 'click');
          await page.waitForFunction(
            (needed) => {
              const hint = document.querySelector('#play-hub-hint');
              return !hint.classList.contains('hidden') && new RegExp(`\\b${needed}\\b`).test(hint.textContent);
            },
            level
          );
          assert.equal(await page.evaluate(() => window.__fluxEngine.mode), modeBefore, `${selector} changed nothing`);
        }
        for (const selector of ['#btn-daily', '#btn-campaign-continue', '#btn-campaign-map']) {
          assert.equal(await isMenuItemLocked(page, selector), false, `${selector} is always open`);
        }
        await assertHubFits(page, 'locked Play hub');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('Weekly Flux opens at the campaign level of its own, with Flux still locked, and never carries a New badge', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        // One level short: the unlocked level is one past the cleared one.
        await reloadWithUnlockedLevel(page, WEEKLY_REQUIRED_LEVEL);
        await openPlayHub(page, viewport);
        assert.equal(await isMenuItemLocked(page, '#btn-weekly'), true, 'the Weekly waits for the campaign');
        await page.dispatchEvent('#btn-weekly', 'click');
        await page.waitForFunction(
          (needed) => new RegExp(`\\b${needed}\\b`).test(document.querySelector('#play-hub-hint').textContent),
          WEEKLY_REQUIRED_LEVEL
        );
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('#modal-play').classList.contains('hidden'));

        await reloadWithUnlockedLevel(page, WEEKLY_REQUIRED_LEVEL + 1);
        await openPlayHub(page, viewport);
        assert.equal(await isMenuItemLocked(page, '#btn-weekly'), false, 'the Weekly is open');
        assert.equal(await isMenuItemLocked(page, '#btn-flux'), true, 'Flux itself is still locked');
        assert.equal(await hasNewBadge(page, '#btn-weekly'), false, 'the Weekly never wears a New badge');
        await page.click('#btn-weekly');
        await page.waitForFunction(
          ([flux, playing]) =>
            window.__fluxEngine.mode === flux && window.__fluxEngine.state === playing && window.__fluxEngine.isWeeklyFluxRun,
          [GAME_MODES.FLUX, GAME_STATES.PLAYING]
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the arcade cards follow the unlock order, and the Duel card opens its picker without the campaign map', async () => {
      const { context, page, errors } = await openGame(viewport, { initStorage: LOCAL_PLAYER_STORAGE });
      try {
        await openPlayHub(page, viewport);
        const cardIdOf = (mode) => HUB_CARD_BY_MODE[mode].slice(1);
        const required = GAME_CONFIG.modeUnlocks.campaignLevelCleared;
        const expectedOrder = [...HUB_ARCADE_MODES].sort((a, b) => required[a] - required[b]).map(cardIdOf);
        const arcadeIds = new Set(HUB_ARCADE_MODES.map(cardIdOf));
        const domOrder = await page.evaluate(
          (ids) => [...document.querySelectorAll('#modal-play .arcade-mode-card')].map((card) => card.id).filter((id) => ids.includes(id)),
          [...arcadeIds]
        );
        assert.deepEqual(domOrder, expectedOrder, 'the arcade cards are listed in the order the campaign opens them');

        const isHidden = LOCAL_ENTRY_HIDDEN_VIEWPORTS.includes(viewport.name);
        assert.equal(await isShown(page, '#btn-versus-local-hub'), !isHidden, 'the 2 players entry follows the room for two boards');
        assert.equal(await isShown(page, '#versus-local-hub-hint'), isHidden, 'the hint explains where the entry is hidden');

        await page.click('#btn-mode-versus');
        await waitShown(page, '#modal-versus-tiers');
        assert.equal(await isShown(page, '#modal-levels'), false, 'the picker opens without the campaign map');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('#modal-versus-tiers').classList.contains('hidden'));
        assert.equal(await isShown(page, '#modal-play'), true, 'Escape leaves the hub open');
        assert.equal(await focusedId(page), 'btn-mode-versus', 'focus returns to the Duel card');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the slide-in menu keeps Play, My stats, Settings and the round actions, and Play wears the New badge', async () => {
      const newMode = GAME_CONFIG.modeUnlocks.stateNew;
      const { context, page, errors } = await openGame(viewport, {
        initStorage: {
          ...languageStorage('en'),
          [`${STORAGE_PREFIX}${STORAGE_KEYS.unlockedLevel}`]: String(LOCKED_MODE_REQUIRED_LEVEL + 1),
          [`${STORAGE_PREFIX}${STORAGE_KEYS.schemaVersion}`]: '1',
          [`${STORAGE_PREFIX}${STORAGE_KEYS.modeUnlocks}`]: JSON.stringify({ endless: newMode })
        }
      });
      try {
        await page.click('#btn-menu');
        await page.waitForFunction(() => document.querySelector('.app-shell').classList.contains('drawer-open'));
        const drawer = await page.evaluate(() => ({
          buttons: [...document.querySelectorAll('#app-drawer button.nav-btn')].map((button) => button.id).sort(),
          mode: [...document.querySelectorAll('#app-drawer .mode-btn')].map((button) => button.id),
          removed: ['#btn-levels', '#nav-mode-lock-hint', '#levels-chapters'].filter((selector) => document.querySelector(selector))
        }));
        assert.deepEqual(drawer.buttons, [...DRAWER_BUTTON_IDS].sort(), 'the menu lists no mode button');
        assert.deepEqual(drawer.removed, [], 'the old level select entry points are gone');
        assert.equal(await hasNewBadge(page, '#btn-play'), true, 'Play announces the newly unlocked mode');
        assert.equal(
          await page.getAttribute('#btn-play', 'aria-label'),
          localeText('en', 'app.drawer.button.playNewAria'),
          'Play says so to screen readers'
        );
        await assertLayoutFits(page, 'slide-in menu with the New badge');
        await page.click('#btn-play');
        await waitShown(page, '#modal-play');
        assert.equal(await hasNewBadge(page, '#btn-endless'), true, 'the Survival card carries the badge');
        assert.equal(await hasNewBadge(page, '#btn-weekly'), false, 'the Weekly never does');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a fresh profile shows no New badge on Play', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await page.click('#btn-menu');
        await page.waitForFunction(() => document.querySelector('.app-shell').classList.contains('drawer-open'));
        assert.equal(await hasNewBadge(page, '#btn-play'), false);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the campaign map is driven from the keyboard: arrows select and follow focus, Enter plays, filter and jump keep the page narrow', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await reloadWithUnlockedLevel(page, UNLOCKED_GENERATED_LEVEL);
        await openCampaignMap(page, viewport);
        const opened = await readMapState(page);
        const currentId = String(UNLOCKED_GENERATED_LEVEL);
        assert.equal(opened.selectedId, currentId, 'the current level is pre-selected');
        assert.equal(opened.selectedCount, 1, 'one tile is selected');
        assert.equal(opened.stops, 1, 'one tile is the keyboard stop');
        assert.equal(opened.focusedId, currentId, 'the map opens on the selected tile');
        assert.ok(opened.header.includes(currentId), 'the detail panel describes the selected level');
        assert.ok(opened.pageOverflow <= OVERFLOW_TOLERANCE_PX, 'the map does not widen the page');

        const grid = await page.evaluate(() => {
          const gridEl = document.querySelector('#levels-grid');
          const tile = gridEl.querySelector('.level-tile');
          return {
            columns: getComputedStyle(gridEl).gridTemplateColumns.split(' ').filter(Boolean).length,
            tileWidth: tile.getBoundingClientRect().width,
            tileHeight: tile.getBoundingClientRect().height
          };
        });
        assert.ok(grid.tileWidth >= MAP_MIN_TILE_PX && grid.tileHeight >= MAP_MIN_TILE_PX, `tiles are ${grid.tileWidth}x${grid.tileHeight}px, under ${MAP_MIN_TILE_PX}px`);
        if (viewport.name === NARROW_PHONE) {
          assert.ok(grid.columns >= MAP_NARROW_MIN_COLUMNS, `${grid.columns} columns, under ${MAP_NARROW_MIN_COLUMNS}`);
        }
        await assertLayoutFits(page, 'campaign map');

        // Selection follows focus: the arrow moves both, and the detail panel follows.
        const index = opened.ids.indexOf(currentId);
        assert.ok(index > 0 && index < opened.ids.length - 1, 'the test level has neighbours in its chapter');
        await page.keyboard.press('ArrowRight');
        const next = await readMapState(page);
        assert.equal(next.selectedId, opened.ids[index + 1], 'ArrowRight selects the next level');
        assert.equal(next.focusedId, next.selectedId, 'focus follows the selection');
        assert.ok(next.header.includes(next.selectedId), 'the detail panel follows the selection');
        assert.equal(next.stops, 1, 'still one keyboard stop');
        await page.keyboard.press('ArrowLeft');
        assert.equal((await readMapState(page)).selectedId, currentId, 'ArrowLeft goes back');
        await page.keyboard.press('End');
        const last = await readMapState(page);
        assert.equal(last.selectedId, opened.ids[opened.ids.length - 1], 'End selects the last level of the chapter');
        await page.keyboard.press('Home');
        assert.equal((await readMapState(page)).selectedId, opened.ids[0], 'Home selects the first level of the chapter');
        // A locked level can be selected and read, but not played.
        const lockedLevel = last.lockedIds[0];
        if (lockedLevel !== undefined) {
          await page.keyboard.press('End');
          await page.keyboard.press('Enter');
          assert.equal(await isShown(page, '#modal-levels'), true, 'Enter on a locked level plays nothing');
          assert.equal(await page.evaluate(() => window.__fluxEngine.currentLevelId), UNLOCKED_GENERATED_LEVEL, 'the run did not change');
          assert.equal(await isMenuItemLocked(page, '#btn-play-level-modal'), true, 'the detail panel disables Play for a locked level');
          assert.equal(await isShown(page, '#levels-detail-lock'), true, 'the detail panel says why');
        }

        // A chapter key changes chapter and keeps focus on a tile; Current level brings the player back.
        await page.keyboard.press('PageUp');
        const previousChapter = await readMapState(page);
        assert.notEqual(previousChapter.chapter, opened.chapter, 'PageUp opens the previous chapter');
        assert.ok(previousChapter.focusedId !== null, 'focus stays on a tile');
        await page.click('#btn-levels-jump-current');
        const jumped = await readMapState(page);
        assert.equal(jumped.chapter, opened.chapter, 'Current level returns to the chapter of the run');
        assert.equal(jumped.selectedId, currentId, 'Current level selects the level of the run');
        assert.equal(jumped.focusedId, currentId, 'Current level focuses it');

        // The filter keeps open, unfinished levels, and its toggle restores the chapter.
        await page.click('#btn-levels-filter-incomplete');
        assert.equal(await page.getAttribute('#btn-levels-filter-incomplete', 'aria-pressed'), 'true');
        const filtered = await readMapState(page);
        assert.ok(filtered.ids.length > 0 && filtered.ids.length <= opened.ids.length, 'the filter lists a part of the chapter');
        assert.deepEqual(filtered.lockedIds, [], 'the filter lists no locked level');
        assert.equal(filtered.stops, 1, 'one keyboard stop after filtering');
        assert.equal(filtered.selectedCount, 1, 'one selection after filtering');
        await page.click('#btn-levels-filter-incomplete');
        assert.equal(await page.getAttribute('#btn-levels-filter-incomplete', 'aria-pressed'), 'false');
        assert.deepEqual((await readMapState(page)).ids, opened.ids, 'unfiltering restores the chapter');
        await assertLayoutFits(page, 'campaign map after navigation');

        // A click on another level selects it; Enter on the selected level plays it.
        const target = opened.ids[index - 1];
        await page.click(`#levels-grid .level-tile[data-level-id="${target}"]`);
        assert.equal((await readMapState(page)).selectedId, target, 'a tap selects the level');
        assert.equal(await isShown(page, '#modal-levels'), true, 'a tap on another level does not start it');
        assert.equal(await page.evaluate(() => window.__fluxEngine.currentLevelId), UNLOCKED_GENERATED_LEVEL);
        await page.focus(`#levels-grid .level-tile[data-level-id="${target}"]`);
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          ([id, playing]) => window.__fluxEngine.currentLevelId === id && window.__fluxEngine.state === playing,
          [Number(target), GAME_STATES.PLAYING]
        );
        assert.equal(await isShown(page, '#modal-levels'), false, 'playing a level closes the map');
        assert.equal(await isShown(page, '#modal-play'), false, 'and the hub under it');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}

describe('play hub (desktop)', () => {
  const desktop = VIEWPORTS[0];

  test('the d-pad moves through the hub and the map tiles, the bumpers change chapter, and Back unwinds the map then the hub', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: MAP_PLAYER_STORAGE, initScript: installPadStub });
    try {
      await connectPad(page);
      await openPlayHub(page, desktop);
      const hubStart = await focusedId(page);
      assert.equal(hubStart, 'btn-campaign-continue');
      await tapPad(page, PAD_BUTTONS.dpadDown);
      assert.notEqual(await focusedId(page), hubStart, 'the d-pad moves focus off Continue');
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('pad-focus')), true, 'the pad focus ring follows');

      await page.click('#btn-campaign-map');
      await waitShown(page, '#modal-levels');
      const opened = await readMapState(page);
      const index = opened.ids.indexOf(opened.selectedId);
      // The pad stops at a row edge (spatial navigation takes over there), so pick the side that stays in the row.
      const columns = await page.evaluate(
        () => getComputedStyle(document.querySelector('#levels-grid')).gridTemplateColumns.split(' ').filter(Boolean).length
      );
      const button = index < opened.ids.length - 1 && (index + 1) % columns !== 0 ? HUB_PAD_BUTTONS.dpadRight : HUB_PAD_BUTTONS.dpadLeft;
      await tapPad(page, button);
      const moved = await readMapState(page);
      assert.equal(moved.selectedId, opened.ids[index + (button === HUB_PAD_BUTTONS.dpadRight ? 1 : -1)], 'the d-pad selects the neighbour tile');
      assert.equal(moved.focusedId, moved.selectedId, 'focus follows the selection');

      await tapPad(page, HUB_PAD_BUTTONS.chapterPrev);
      const previous = await readMapState(page);
      assert.notEqual(previous.chapter, opened.chapter, 'the left bumper opens the previous chapter');
      await tapPad(page, HUB_PAD_BUTTONS.chapterNext);
      assert.equal((await readMapState(page)).chapter, opened.chapter, 'the right bumper comes back');

      await tapPad(page, HUB_PAD_BUTTONS.back);
      await page.waitForFunction(() => document.querySelector('#modal-levels').classList.contains('hidden'));
      assert.equal(await isShown(page, '#modal-play'), true, 'Back closes the map and leaves the hub');
      await tapPad(page, HUB_PAD_BUTTONS.back);
      await page.waitForFunction(() => document.querySelector('#modal-play').classList.contains('hidden'));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('the Puzzle and seed disclosures open one at a time, a puzzle stage starts at once, and a seed is checked', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: EXISTING_PLAYER_STORAGE });
    try {
      await openPlayHub(page, desktop);
      assert.equal(await isShown(page, '#puzzle-stages-strip'), false, 'the stages start folded');
      assert.equal(await page.getAttribute('#btn-puzzle-stages-toggle', 'aria-expanded'), 'false');
      await page.click('#btn-puzzle-stages-toggle');
      await waitShown(page, '#puzzle-stages-strip');
      assert.equal(await page.getAttribute('#btn-puzzle-stages-toggle', 'aria-expanded'), 'true');
      await page.click('#btn-flux-seed-toggle');
      await waitShown(page, '#flux-seed-entry');
      assert.equal(await isShown(page, '#puzzle-stages-strip'), false, 'opening the seed entry folds the stages');
      assert.equal(await page.getAttribute('#btn-puzzle-stages-toggle', 'aria-expanded'), 'false');
      assert.equal(await page.getAttribute('#btn-flux-seed-toggle', 'aria-expanded'), 'true');

      // An invalid seed is explained and starts nothing; a valid one starts the shared Flux.
      const modeBefore = await page.evaluate(() => window.__fluxEngine.mode);
      await page.fill('#input-flux-seed', SHARED_FLUX_SEED.slice(0, 1));
      await page.click('#btn-flux-seed-go');
      await page.waitForFunction(() => {
        const hint = document.querySelector('#play-hub-hint');
        return !hint.classList.contains('hidden') && hint.textContent.trim().length > 0;
      });
      assert.equal(await page.evaluate(() => window.__fluxEngine.mode), modeBefore, 'an invalid seed starts nothing');
      assert.equal(await isShown(page, '#modal-play'), true, 'the hub stays open');

      await page.click('#btn-puzzle-stages-toggle');
      await waitShown(page, '#puzzle-stages-strip');
      await page.click('#puzzle-stages-strip .puzzle-stage-btn[data-puzzle-stage="1"]');
      await page.waitForFunction(
        ([mode, playing]) =>
          window.__fluxEngine.mode === mode && window.__fluxEngine.state === playing && window.__fluxEngine.currentPuzzleStage === 1,
        [GAME_MODES.PUZZLE, GAME_STATES.PLAYING]
      );
      assert.equal(await isShown(page, '#modal-play'), false, 'a stage closes the hub');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('the seed entry works on a fresh profile while Flux is locked, and starts the shared seed', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await openPlayHub(page, desktop);
      assert.equal(await isMenuItemLocked(page, '#btn-flux'), true, 'Flux is locked');
      await page.click('#btn-flux-seed-toggle');
      await waitShown(page, '#flux-seed-entry');
      await page.fill('#input-flux-seed', SHARED_FLUX_SEED);
      await page.click('#btn-flux-seed-go');
      await page.waitForFunction(
        ([flux, seed]) => window.__fluxEngine.mode === flux && window.__fluxEngine.fluxSeed === seed,
        [GAME_MODES.FLUX, SHARED_FLUX_SEED]
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('while Survival runs the hub opens on its card, marks it, and Continue returns to the suggested campaign level', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: { ...EXISTING_PLAYER_STORAGE, ...languageStorage('en') } });
    try {
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.startEndlessMode();
        engine.notifyUI();
      });
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
      await openPlayHub(page, desktop);
      assert.equal(await focusedId(page), 'btn-endless', 'the hub opens on the running mode');
      const marks = await page.evaluate(() => ({
        survival: document.querySelector('#btn-endless').classList.contains('active-mode'),
        survivalCurrent: document.querySelector('#btn-endless').hasAttribute('aria-current'),
        daily: document.querySelector('#btn-daily').classList.contains('active-mode'),
        campaign: document.querySelector('#btn-campaign-continue').closest('section').classList.contains('active-mode')
      }));
      assert.deepEqual(marks, { survival: true, survivalCurrent: true, daily: false, campaign: false });
      const suggested = EXISTING_PLAYER_UNLOCKED_LEVEL;
      assert.equal(
        await textOf(page, '#btn-campaign-continue'),
        localeText('en', 'modals.play.campaign.continue', { level: suggested }),
        'no campaign run: Continue offers the furthest level'
      );
      await page.click('#btn-campaign-continue');
      await page.waitForFunction(
        ([mode, level, playing]) =>
          window.__fluxEngine.mode === mode && window.__fluxEngine.currentLevelId === level && window.__fluxEngine.state === playing,
        [GAME_MODES.CAMPAIGN, suggested, GAME_STATES.PLAYING]
      );
      assert.equal(await isShown(page, '#modal-play'), false, 'Continue closes the hub');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('in forced colors the selected level of the map is told apart from the others', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await reloadWithUnlockedLevel(page, UNLOCKED_GENERATED_LEVEL);
      await page.emulateMedia({ forcedColors: 'active' });
      await openCampaignMap(page, desktop);
      const looks = await page.evaluate(() => {
        const signatureOf = (tile) => {
          const style = getComputedStyle(tile);
          return [style.backgroundColor, style.color, style.outlineStyle, style.outlineWidth, style.outlineColor, style.borderTopColor, style.borderTopWidth].join('|');
        };
        const tiles = [...document.querySelectorAll('#levels-grid .level-tile')];
        const selected = tiles.find((tile) => tile.getAttribute('aria-selected') === 'true');
        const other = tiles.find((tile) => tile !== selected && !tile.classList.contains('current') && tile.getAttribute('aria-disabled') !== 'true');
        return { selected: signatureOf(selected), other: signatureOf(other) };
      });
      assert.notEqual(looks.selected, looks.other, 'the selected tile does not rely on a colour forced colors would drop');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

/** Puzzle stage selector: seeded records, touch-target size, stars and the locked look, on every layout. */
const PUZZLE_TOUCH_TARGET_PX = 44;
const PUZZLE_SEED_BEST_STAGE = 3;
const PUZZLE_SEEDED_STARS = 2;
const PUZZLE_SEEDED_ATTEMPTS = 2;
const PUZZLE_SEEDED_SCORE = 900;
const PUZZLE_CLEARED_STAGE = 1;
const PUZZLE_LOCKED_STAGE = PUZZLE_SEED_BEST_STAGE + 1;
const PUZZLE_SEEDED_STORAGE = Object.freeze({
  ...EXISTING_PLAYER_STORAGE,
  ...languageStorage('en'),
  [`${STORAGE_PREFIX}${STORAGE_KEYS.puzzleBestStage}`]: String(PUZZLE_SEED_BEST_STAGE),
  [`${STORAGE_PREFIX}${STORAGE_KEYS.puzzleStageStats}`]: JSON.stringify({
    [PUZZLE_CLEARED_STAGE]: {
      bestScore: PUZZLE_SEEDED_SCORE,
      stars: PUZZLE_SEEDED_STARS,
      attempts: PUZZLE_SEEDED_ATTEMPTS,
      cleared: true
    }
  })
});

for (const viewport of VIEWPORTS) {
  describe(`puzzle stage selector: ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test('every stage button is a full touch target, a cleared stage shows its stars and a locked one is dashed at full opacity', async () => {
      const { context, page, errors } = await openGame(viewport, { initStorage: PUZZLE_SEEDED_STORAGE });
      try {
        await openPlayHub(page, viewport);
        await page.click('#btn-puzzle-stages-toggle');
        await waitShown(page, '#puzzle-stages-strip');
        const looks = await page.evaluate(
          ([clearedStage, lockedStage]) => {
            const buttons = [...document.querySelectorAll('#puzzle-stages-strip .puzzle-stage-btn')];
            const sizes = buttons.map((btn) => {
              const box = btn.getBoundingClientRect();
              return { width: box.width, height: box.height };
            });
            const byStage = (stage) => document.querySelector(`.puzzle-stage-btn[data-puzzle-stage="${stage}"]`);
            const cleared = byStage(clearedStage);
            const locked = byStage(lockedStage);
            const lockedStyle = getComputedStyle(locked);
            return {
              count: buttons.length,
              sizes,
              clearedStars: cleared.querySelector('.puzzle-stage-stars')?.textContent ?? null,
              clearedAria: cleared.getAttribute('aria-label'),
              hasLockedStars: locked.querySelector('.puzzle-stage-stars') !== null,
              lockedBorderStyle: lockedStyle.borderTopStyle,
              lockedOpacity: lockedStyle.opacity
            };
          },
          [PUZZLE_CLEARED_STAGE, PUZZLE_LOCKED_STAGE]
        );
        assert.equal(looks.count, GAME_CONFIG.puzzles.length);
        for (const size of looks.sizes) {
          assert.ok(
            size.width >= PUZZLE_TOUCH_TARGET_PX && size.height >= PUZZLE_TOUCH_TARGET_PX,
            `stage button ${size.width}x${size.height}`
          );
        }
        const { starFilledSymbol, starEmptySymbol } = GAME_CONFIG.theme;
        assert.equal(
          looks.clearedStars,
          starFilledSymbol.repeat(PUZZLE_SEEDED_STARS) +
            starEmptySymbol.repeat(GAME_CONFIG.scoring.maxStars - PUZZLE_SEEDED_STARS)
        );
        assert.equal(
          looks.clearedAria,
          localeText('en', 'modals.levelSelect.arcade.puzzleStageAria', {
            stage: PUZZLE_CLEARED_STAGE,
            stars: PUZZLE_SEEDED_STARS,
            maxStars: GAME_CONFIG.scoring.maxStars
          })
        );
        assert.equal(looks.hasLockedStars, false, 'a locked stage shows no stars');
        assert.equal(looks.lockedBorderStyle, 'dashed');
        assert.equal(looks.lockedOpacity, '1');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}

describe('puzzle stage intro (desktop)', () => {
  test('starting a stage from the selector shows the goal banner with its text', async () => {
    const desktop = VIEWPORTS[0];
    const { context, page, errors } = await openGame(desktop, { initStorage: PUZZLE_SEEDED_STORAGE });
    try {
      await openPlayHub(page, desktop);
      await page.click('#btn-puzzle-stages-toggle');
      await waitShown(page, '#puzzle-stages-strip');
      await page.click('#puzzle-stages-strip .puzzle-stage-btn[data-puzzle-stage="1"]');
      await page.waitForFunction(
        ([mode, playing]) => window.__fluxEngine.mode === mode && window.__fluxEngine.state === playing,
        [GAME_MODES.PUZZLE, GAME_STATES.PLAYING]
      );
      // The goal banner waits behind a discovery card: close it only if one is showing.
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        if (engine.activeDiscoveryId) {
          engine.dismissDiscovery();
        }
      });
      await waitShown(page, '#level-intro-banner');
      // A revealed live region is filled on the next frame.
      await page.waitForFunction(() => document.querySelector('#level-intro-text').textContent.trim().length > 0);
      const text = await textOf(page, '#level-intro-text');
      assert.ok(text.includes(`Puzzle 1/${GAME_CONFIG.puzzles.length}`), text);
      assert.ok(text.includes(localeText('en', 'hud.levelIntro.puzzleHints.stage1')), 'the stage hint is shown');
      await page.evaluate(() => window.__fluxEngine.shoot());
      await page.waitForFunction(() => document.querySelector('#level-intro-banner').classList.contains('hidden'));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe('Merge shake', () => {
  const modes = JSON.parse(readFileSync(new URL('../../configs/modes.json', import.meta.url), 'utf8'));
  const { shake } = modes.merge;
  const path = `/?${shake.queryParam}=${shake.queryValue}`;
  const selector = '#btn-merge-shake';
  const initStorage = {
    ...languageStorage('en'),
    [`${STORAGE_PREFIX}${STORAGE_KEYS.unlockedLevel}`]: String(GAME_CONFIG.modeUnlocks.campaignLevelCleared.merge + 2)
  };

  async function startBasin(page, viewport) {
    await openPlayHub(page, viewport);
    await page.locator('#btn-mode-merge').click();
    await page.waitForFunction(() => window.__fluxEngine.mode === 'merge' && window.__fluxEngine.isRunPlaying());
  }

  async function charge(page) {
    await page.evaluate((drops) => {
      const engine = window.__fluxEngine;
      for (let i = 0; i < drops; i += 1) {
        engine.modeState.dropCooldownSec = 0;
        engine.shoot();
      }
    }, shake.rechargeDrops);
    assert.equal(await page.locator(selector).isEnabled(), true);
  }

  test('the desktop HUD, keyboard and right bumper each use one charge', async () => {
    const viewport = VIEWPORTS[0];
    const { context, page, errors } = await openGame(viewport, { initStorage, path, initScript: installPadStub });
    try {
      await startBasin(page, viewport);
      await waitShown(page, selector);
      assert.equal(await page.locator(selector).isDisabled(), true);
      await charge(page);
      await page.locator(selector).click();
      assert.equal(await page.locator(selector).isDisabled(), true);

      await charge(page);
      await page.locator('#game-canvas').focus();
      await page.keyboard.down(shake.keyCode);
      assert.equal(await page.locator(selector).isDisabled(), true);
      await charge(page);
      await page.keyboard.down(shake.keyCode);
      assert.equal(await page.locator(selector).isEnabled(), true, 'repeat cannot spend the recharged impulse');
      await page.keyboard.up(shake.keyCode);

      await connectPad(page);
      await tapPad(page, GAME_CONFIG.gamepad.buttons.specialNext[0]);
      assert.equal(await page.locator(selector).isDisabled(), true);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  for (const viewport of VIEWPORTS.filter(({ isTouch }) => isTouch)) {
    test(`the French control fits on ${viewport.name}`, async () => {
      const { context, page } = await openGame(viewport, {
        initStorage: { ...initStorage, ...languageStorage('fr') },
        path
      });
      try {
        await startBasin(page, viewport);
        await waitShown(page, selector);
        await assertLayoutFits(page, 'Merge shake');
        const button = await page.locator(selector).boundingBox();
        assert.ok(button.width >= 44 && button.height >= 44, 'the shake has a full touch target');
      } finally {
        await context.close();
      }
    });
  }

  test('the touch button works before permission and a motion gesture is active only in play', async () => {
    const viewport = VIEWPORTS.find(({ name }) => name === 'phone portrait');
    const { context, page, errors } = await openGame(viewport, {
      initStorage,
      path,
      initScript: () => {
        window.__motionPermissionRequests = 0;
        window.DeviceMotionEvent.requestPermission = async () => {
          window.__motionPermissionRequests += 1;
          return window.__motionPermissionRequests === 1 ? 'denied' : 'granted';
        };
        window.__sendMotion = (x) => {
          window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x, y: 0, z: 0 } }));
        };
      }
    });
    const sendShake = () => page.evaluate((peak) => {
      window.__sendMotion(peak);
      window.__sendMotion(-peak);
    }, shake.gesture.peakAcceleration * 2);

    try {
      await startBasin(page, viewport);
      await charge(page);
      await sendShake();
      assert.equal(await page.locator(selector).isEnabled(), true);
      await page.locator(selector).tap();
      assert.equal(await page.locator(selector).isDisabled(), true);
      await charge(page);

      await clickMenuButton(page, viewport, '#btn-settings');
      const setting = page.locator('#btn-merge-shake-gesture');
      await setting.tap();
      await page.waitForFunction(() => document.getElementById('merge-shake-gesture-status').textContent.length > 0);
      assert.equal(await setting.getAttribute('aria-pressed'), 'false');
      await setting.tap();
      await page.waitForFunction(() => document.getElementById('btn-merge-shake-gesture').ariaPressed === 'true');

      // A peak seen in Settings must not combine with a peak after resuming.
      await page.evaluate((peak) => window.__sendMotion(peak), shake.gesture.peakAcceleration * 2);
      await page.locator('#btn-close-settings').tap();
      await page.waitForFunction(() => window.__fluxEngine.isRunPlaying());
      await page.evaluate((peak) => window.__sendMotion(-peak), shake.gesture.peakAcceleration * 2);
      assert.equal(await page.locator(selector).isEnabled(), true);
      await sendShake();
      assert.equal(await page.locator(selector).isDisabled(), true);
      assert.equal(await page.evaluate(() => window.__motionPermissionRequests), 2);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe('Billiards prototype', () => {
  const billiardConfig = JSON.parse(readFileSync(new URL('../../configs/billiard.json', import.meta.url), 'utf8'));
  const desktop = VIEWPORTS[0];
  const phone = VIEWPORTS.find(({ name }) => name === 'narrow phone portrait');
  const table = '#billiard-canvas';
  const shoot = '#btn-billiard-shoot';

  async function openBilliards(page, viewport) {
    await openPlayHub(page, viewport);
    await page.locator('#btn-mode-billiard').click();
    await waitShown(page, '#modal-billiard');
  }

  async function aimAt(page, point, touch) {
    const box = await page.locator(table).boundingBox();
    const position = {
      x: point.x * box.width / billiardConfig.width,
      y: point.y * box.height / billiardConfig.height
    };
    if (touch) {
      await page.locator(table).tap({ position });
    } else {
      await page.locator(table).click({ position });
    }
  }

  test('opens all tables, accepts angle and power, and returns to the paused game', async () => {
    const { context, page, errors } = await openGame(desktop, { initStorage: languageStorage('en'), initScript: installPadStub });
    try {
      const mainBefore = await page.evaluate(() => ({
        score: window.__fluxEngine.score,
        shots: window.__fluxEngine.runShotsFired
      }));
      await openBilliards(page, desktop);
      assert.equal(await engineState(page), 'paused');
      assert.equal(await page.locator('#billiard-tables button').count(), 3);
      const [target] = billiardConfig.tables[0].balls.filter(({ id }) => id === 'one');
      await aimAt(page, target, false);
      await page.keyboard.press('ArrowUp');
      assert.equal(await textOf(page, '#billiard-power-value'), '50%');
      await page.keyboard.press('Enter');
      await page.waitForFunction((won) => document.getElementById('billiard-status').textContent === won,
        localeText('en', 'modals.billiard.status.won'));
      await connectPad(page);
      await tapPad(page, GAME_CONFIG.gamepad.buttons.swap[0]);
      assert.equal(await textOf(page, '#billiard-shots'), localeText('en', 'modals.billiard.shots', { used: 0, limit: 2 }));

      await page.locator('#billiard-tables button').nth(1).click();
      assert.equal(await textOf(page, '#billiard-objective'), localeText('en', 'modals.billiard.table.bank.objective'));
      await page.locator('#billiard-tables button').nth(2).click();
      assert.equal(await textOf(page, '#billiard-objective'), localeText('en', 'modals.billiard.table.position.objective'));
      await page.keyboard.press('Escape');
      assert.equal(await focusedId(page), 'btn-mode-billiard');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__fluxEngine.isRunPlaying());
      assert.deepEqual(await page.evaluate(() => ({
        score: window.__fluxEngine.score,
        shots: window.__fluxEngine.runShotsFired
      })), mainBefore);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('touch aims without shooting, and the table fits a narrow phone', async () => {
    const { context, page, errors } = await openGame(phone, { initStorage: languageStorage('fr') });
    try {
      await openBilliards(page, phone);
      await assertLayoutFits(page, 'Billard');
      const [target] = billiardConfig.tables[0].balls.filter(({ id }) => id === 'one');
      await aimAt(page, target, true);
      assert.equal(await textOf(page, '#billiard-shots'), localeText('fr', 'modals.billiard.shots', { used: 0, limit: 2 }));
      await page.locator('#billiard-power').fill('0.5');
      await page.locator(shoot).tap();
      await page.waitForFunction((won) => document.getElementById('billiard-status').textContent === won,
        localeText('fr', 'modals.billiard.status.won'));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe('Progress transfer', () => {
  const viewport = VIEWPORTS[0];
  const unlockedKey = `${STORAGE_PREFIX}${STORAGE_KEYS.unlockedLevel}`;
  const coinsKey = `${STORAGE_PREFIX}${STORAGE_KEYS.coins}`;
  const contrastKey = `${STORAGE_PREFIX}${STORAGE_KEYS.highContrast}`;
  const foreignKey = 'unrelated-app-key';
  const newLevel = String(GAME_CONFIG.modeUnlocks.campaignLevelCleared.merge + 1);

  async function openSettings(page) {
    await clickMenuButton(page, viewport, '#btn-settings');
    await waitShown(page, '#modal-settings');
  }

  test('downloads and imports a real file into a fresh profile and unlocks Merge Basin', async () => {
    const source = await openGame(viewport, { initStorage: {
      [unlockedKey]: newLevel, [coinsKey]: '30', [contrastKey]: 'true', [foreignKey]: 'source'
    } });
    const target = await openGame(viewport, { path: '/?mergeShake=1' });
    try {
      await openSettings(source.page);
      const [download] = await Promise.all([
        source.page.waitForEvent('download'),
        source.page.locator('#btn-export-progress').click()
      ]);
      assert.equal(download.suggestedFilename(), GAME_CONFIG.storage.progressBackup.filename);
      const file = await download.path();
      const backup = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(backup.fields.unlockedLevel, newLevel);
      assert.equal(backup.fields.highContrast, undefined);
      assert.equal(backup.fields.runSnapshot, undefined);

      await target.page.evaluate((key) => localStorage.setItem(key, 'target'), foreignKey);
      await openSettings(target.page);
      const picker = target.page.locator('#input-import-progress');
      await picker.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
      await target.page.waitForFunction(() => document.getElementById('progress-backup-status').textContent !== '');
      assert.equal(await isShown(target.page, '#modal-progress-import'), false);

      await picker.setInputFiles(file);
      await waitShown(target.page, '#modal-progress-import');
      await target.page.locator('#btn-cancel-progress-import').click();
      assert.notEqual(await target.page.evaluate((key) => localStorage.getItem(key), unlockedKey), newLevel);
      await picker.setInputFiles(file);
      await waitShown(target.page, '#modal-progress-import');
      await Promise.all([
        target.page.waitForEvent('load'),
        target.page.locator('#btn-apply-progress-import').click()
      ]);
      await captureEngine(target.page);
      assert.deepEqual(await target.page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)),
        [unlockedKey, coinsKey, contrastKey, foreignKey]), [newLevel, '30', null, 'target']);
      await openPlayHub(target.page, viewport);
      await target.page.locator('#btn-mode-merge').click();
      await waitShown(target.page, '#btn-merge-shake');
      assert.deepEqual([...source.errors, ...target.errors], []);
    } finally {
      await source.context.close();
      await target.context.close();
    }
  });
});
