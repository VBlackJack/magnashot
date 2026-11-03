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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GAME_OVER_REASONS, INPUT_MODES } from '../src/core/Constants.js';
import { I18nService, i18n, resolveInitialLocale } from '../src/core/I18n.js';
import {
  HIGH_CONTRAST_CLASS,
  INPUT_ARIA_HINTS,
  MODAL_FOCUSABLE_SELECTOR,
  canOpenDrawer,
  computeAchievementProgress,
  computeStarProgressPct,
  filterFocusTrapCandidates,
  gameOverReasonKey,
  isBrowserShortcut,
  isIosBrowserTab,
  UIManager,
  VICTORY_NEXT_ACTIONS,
  VICTORY_NEXT_LABEL_KEYS,
  resolveModalFocusTarget,
  resolveVictoryNextAction,
  revealLiveRegion,
  shouldIgnoreRepeatedKey
} from '../src/ui/UIManager.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { LevelCatalog } from '../src/game/LevelCatalog.js';

const loadJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const SUPPORTED = gameConfig.defaults.supportedLanguages;
const FALLBACK = gameConfig.defaults.language;

test('resolveInitialLocale keeps a supported stored choice over browser preferences', () => {
  assert.equal(resolveInitialLocale('en', SUPPORTED, FALLBACK, ['fr-FR']), 'en');
  assert.equal(resolveInitialLocale('fr', SUPPORTED, FALLBACK, ['en-US']), 'fr');
});

test('resolveInitialLocale uses the first supported browser language on first visit', () => {
  assert.equal(resolveInitialLocale(null, SUPPORTED, FALLBACK, ['en-GB', 'fr']), 'en');
  assert.equal(resolveInitialLocale(null, SUPPORTED, FALLBACK, ['de-DE', 'fr-CA', 'en']), 'fr');
  assert.equal(resolveInitialLocale(undefined, SUPPORTED, FALLBACK, ['EN_us']), 'en');
});

test('resolveInitialLocale falls back to the configured default', () => {
  assert.equal(resolveInitialLocale(null, SUPPORTED, FALLBACK, ['de-DE', 'ja']), FALLBACK);
  assert.equal(resolveInitialLocale(null, SUPPORTED, FALLBACK, []), FALLBACK);
  assert.equal(resolveInitialLocale('xx', SUPPORTED, FALLBACK, ['', null]), FALLBACK);
});

function fakeElement({ tabindex = null, disabled = false, hidden = false, insideHidden = false, rendered = true } = {}) {
  return {
    disabled,
    hidden,
    getAttribute: (name) => (name === 'tabindex' ? tabindex : null),
    closest: () => (insideHidden ? {} : null),
    getClientRects: () => (rendered ? [{}] : [])
  };
}

test('focus-trap selector excludes tabindex="-1" in every branch', () => {
  for (const branch of MODAL_FOCUSABLE_SELECTOR.split(',')) {
    assert.match(branch, /:not\(\[tabindex="-1"\]\)/, `branch "${branch.trim()}" must exclude tabindex=-1`);
  }
});

test('focus-trap filter keeps only reachable elements', () => {
  const reachable = fakeElement({ tabindex: '0' });
  const plainButton = fakeElement();
  const candidates = [
    reachable,
    plainButton,
    fakeElement({ tabindex: '-1' }),
    fakeElement({ disabled: true }),
    fakeElement({ hidden: true }),
    fakeElement({ insideHidden: true }),
    fakeElement({ rendered: false })
  ];
  assert.deepEqual(filterFocusTrapCandidates(candidates), [reachable, plainButton]);
});

test('held-down toggle keys are ignored but aiming arrows keep repeating', () => {
  for (const code of ['Space', 'KeyF', 'Enter', 'Escape', 'Digit1', 'Digit5']) {
    assert.equal(shouldIgnoreRepeatedKey(code, true), true, `${code} repeat must be ignored`);
    assert.equal(shouldIgnoreRepeatedKey(code, false), false, `${code} first press must pass`);
  }
  for (const code of ['ArrowLeft', 'ArrowRight']) {
    assert.equal(shouldIgnoreRepeatedKey(code, true), false, `${code} must keep repeating`);
  }
});

test('browser chords are left to the browser, Shift still aims faster', () => {
  assert.equal(isBrowserShortcut({ ctrlKey: true }), true, 'Ctrl+F opens the find bar');
  assert.equal(isBrowserShortcut({ metaKey: true }), true, 'Cmd+1 switches tabs');
  assert.equal(isBrowserShortcut({ altKey: true }), true, 'Alt+Left goes back');
  assert.equal(isBrowserShortcut({ shiftKey: true }), false);
  assert.equal(isBrowserShortcut({}), false);
});

test('formatNumber groups digits per locale and caches one formatter per locale', () => {
  const previous = i18n.currentLocale;
  try {
    i18n.currentLocale = 'en';
    assert.equal(i18n.formatNumber(1234567), new Intl.NumberFormat('en').format(1234567));
    const enFormatter = i18n.numberFormatters.get('en');
    i18n.formatNumber(42);
    assert.equal(i18n.numberFormatters.get('en'), enFormatter);
    i18n.currentLocale = 'fr';
    assert.equal(i18n.formatNumber(1234567), new Intl.NumberFormat('fr').format(1234567));
  } finally {
    i18n.currentLocale = previous;
  }
});

function flattenStrings(node, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      flattenStrings(value, path, out);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

const placeholdersOf = (text) => [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

test('en and fr locales have identical keys and identical placeholders', () => {
  const en = flattenStrings(loadJson('./locales/en.json'));
  const fr = flattenStrings(loadJson('./locales/fr.json'));
  assert.deepEqual([...en.keys()].sort(), [...fr.keys()].sort());
  for (const [key, enText] of en) {
    assert.deepEqual(placeholdersOf(fr.get(key)), placeholdersOf(enText), `placeholders differ for ${key}`);
  }
});

test('every t() key literal used by the UI exists in both locales', () => {
  const en = flattenStrings(loadJson('./locales/en.json'));
  const fr = flattenStrings(loadJson('./locales/fr.json'));
  const collectJsFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? collectJsFiles(join(dir, entry.name)) : entry.name.endsWith('.js') ? [join(dir, entry.name)] : []
    );
  const sources = [...collectJsFiles('./src').map((file) => readFileSync(file, 'utf8')), readFileSync('./index.html', 'utf8')];
  const keys = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/(?:\bt\(|data-i18n(?:-[a-z-]+)?=)\s*['"]([a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)+)['"]/g)) {
      keys.add(match[1]);
    }
  }
  assert.ok(keys.size > 0, 'the key scan must find keys');
  const missing = [...keys].filter((key) => !en.has(key) || !fr.has(key));
  assert.deepEqual(missing, []);
});

const mainCss = readFileSync('./styles/main.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Text of the first block opened by `header`, nested blocks included. */
function cssBlock(css, header) {
  const start = css.indexOf(header);
  assert.notEqual(start, -1, `missing CSS block ${header}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') {
      depth++;
    } else if (css[i] === '}' && --depth === 0) {
      return css.slice(start, i + 1);
    }
  }
  return css.slice(start);
}

test('high contrast is a root theme: in-app class, system preference and forced colors', () => {
  const classBlock = cssBlock(mainCss, `:root.${HIGH_CONTRAST_CLASS} {`);
  const preferenceBlock = cssBlock(mainCss, '@media (prefers-contrast: more)');
  for (const token of ['--text-muted', '--bg-panel-alpha-85', '--bg-dark-alpha-78', '--text-gold']) {
    assert.match(classBlock, new RegExp(`${token}:`), `the class theme must raise ${token}`);
    assert.match(preferenceBlock, new RegExp(`${token}:`), `the system theme must raise ${token}`);
  }
  const forcedBlock = cssBlock(mainCss, '@media (forced-colors: active)');
  assert.match(forcedBlock, /\.nav-btn[\s\S]*ButtonText/);
  assert.match(forcedBlock, /:focus-visible\s*\{[^}]*Highlight/);
});

test('colors outside the :root token blocks only reference tokens', () => {
  const withoutTokenBlocks = mainCss.replace(/:root[^{]*\{[^{}]*\}/g, '');
  const literals = withoutTokenBlocks.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g) || [];
  assert.deepEqual(literals, []);
  assert.match(mainCss, /\.gold-text\s*\{\s*color:\s*var\(--text-gold\)/);
});

test('coarse pointers get 44px controls whatever the viewport size', () => {
  const coarse = cssBlock(mainCss, '@media (pointer: coarse)');
  for (const selector of ['.nav-btn', '.nav-btn.icon-btn', '.modal-tab', '.hud-menu-btn', '.powerup-btn']) {
    assert.ok(coarse.includes(selector), `${selector} must be enlarged on touch screens`);
  }
  assert.match(coarse, /min-height:\s*var\(--touch-target\)/);
});

test('landscape phones move the board overlays to the left column and pack the nav', () => {
  const phone = cssBlock(mainCss, '@media (orientation: landscape) and (max-height: 500px) {');
  assert.match(phone, /\.tutorial-banner[^{]*\{[^}]*position:\s*fixed/, 'the hint leaves the board');
  assert.match(phone, /\.special-equipped-banner[^{]*\{[^}]*position:\s*fixed/, 'the equipped banner leaves the board');
  assert.match(phone, /\.special-equipped-banner\s*\{[^}]*white-space:\s*normal/, 'the equipped banner wraps');
  assert.match(phone, /\.nav-modes\s*\{[^}]*repeat\(4/, 'the four modes share one row');
  // A size container would become the containing block of the fixed overlays.
  const landscape = cssBlock(mainCss, '@media (orientation: landscape) and (max-height: 500px),');
  assert.match(landscape, /\.stage-container\s*\{[^}]*container-type:\s*normal/);
  assert.match(landscape, /\.stage-column\s*\{[^}]*container-type:\s*normal/);
  assert.doesNotMatch(phone, /container-type:\s*(?:size|inline-size)/);
});

test('portrait phones hide the hint while the finger is on the board, without motion when reduced', () => {
  const portrait = cssBlock(mainCss, '@media (max-width: 680px) {');
  assert.match(portrait, /#game-canvas:active\)\s*\.tutorial-banner\s*\{[^}]*opacity:\s*0/);
  assert.match(mainCss, /\.tutorial-banner\s*\{[^}]*transition:\s*opacity var\(--tutorial-fade\)/);
  const reduced = cssBlock(mainCss, '@media (prefers-reduced-motion: reduce)');
  assert.match(reduced, /\.tutorial-banner\s*\{[^}]*transition:\s*none/);
});

test('the menu cannot open during the victory celebration or over a dialog', () => {
  const base = { isOpen: false, isDrawerLayout: true, isModalOpen: false, isVictoryCelebrating: false };
  assert.equal(canOpenDrawer(base), true);
  assert.equal(canOpenDrawer({ ...base, isVictoryCelebrating: true }), false);
  assert.equal(canOpenDrawer({ ...base, isModalOpen: true }), false);
  assert.equal(canOpenDrawer({ ...base, isDrawerLayout: false }), false);
  assert.equal(canOpenDrawer({ ...base, isOpen: true }), false);
});

test('closing a stacked Confirm sends focus back into the dialog underneath', () => {
  const opener = fakeElement();
  const first = fakeElement();
  const outside = fakeElement();
  const members = new Set([opener, first]);
  const pause = { contains: (el) => members.has(el) };
  assert.equal(resolveModalFocusTarget(pause, outside, opener, [first, opener]), opener);
  assert.equal(resolveModalFocusTarget(pause, outside, null, [first, opener]), first);
  assert.equal(resolveModalFocusTarget(pause, outside, outside, [first]), first, 'an opener outside is ignored');
  assert.equal(resolveModalFocusTarget(pause, first, opener, [first]), null, 'focus already inside stays');
  assert.equal(resolveModalFocusTarget(null, outside, opener, []), null);
});

function fakeRegion(hidden) {
  const classes = new Set(hidden ? ['hidden'] : []);
  return {
    classList: {
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
      add: (name) => classes.add(name)
    }
  };
}

test('a revealed live region is shown empty and filled on the next frame', () => {
  const region = fakeRegion(true);
  const textElement = { textContent: 'stale tip' };
  const queued = [];
  revealLiveRegion({ region, textElement, text: 'first tip', schedule: (cb) => queued.push(cb) });
  assert.equal(region.classList.contains('hidden'), false);
  assert.equal(textElement.textContent, '', 'the text must not be present when the region appears');
  revealLiveRegion({ region, textElement, text: 'newer tip', schedule: (cb) => queued.push(cb) });
  assert.equal(queued.length, 1);
  queued[0]();
  assert.equal(textElement.textContent, 'newer tip');
  revealLiveRegion({ region, textElement, text: 'next tip', schedule: () => assert.fail('no deferral when visible') });
  assert.equal(textElement.textContent, 'next tip');
});

test('the board text alternative has a touch and a pointer wording in both locales', () => {
  for (const path of ['./locales/en.json', './locales/fr.json']) {
    const strings = flattenStrings(loadJson(path));
    for (const { key } of INPUT_ARIA_HINTS) {
      const pointer = strings.get(`${key}.${INPUT_MODES.POINTER}`);
      const touch = strings.get(`${key}.${INPUT_MODES.TOUCH}`);
      assert.ok(pointer && touch, `${path} must define both wordings of ${key}`);
      assert.notEqual(pointer, touch);
    }
  }
});

test('game-over reasons map to existing texts, unknown reasons to the crossed line', () => {
  const en = flattenStrings(loadJson('./locales/en.json'));
  for (const reason of Object.values(GAME_OVER_REASONS)) {
    assert.ok(en.has(gameOverReasonKey(reason)), `missing text for ${reason}`);
  }
  assert.equal(gameOverReasonKey(undefined), gameOverReasonKey(GAME_OVER_REASONS.LINE_CROSSED));
});

test('t() falls back to another loaded locale before returning the raw key', () => {
  const service = new I18nService();
  service.dictionaries.set('en', { menu: { play: 'Play' } });
  service.dictionaries.set('fr', { menu: { quit: 'Quitter' } });
  service.fallbackLocale = 'en';
  service.currentLocale = 'fr';
  assert.equal(service.t('menu.quit'), 'Quitter');
  assert.equal(service.t('menu.play'), 'Play', 'a key missing in fr comes from en');
  service.dictionaries.delete('fr');
  assert.equal(service.t('menu.play'), 'Play', 'a locale that failed to load uses the fallback');
  assert.equal(service.t('menu.missing'), 'menu.missing');
});

test('a locale that fails to load is replaced by one that loaded', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (path) => {
    if (path.includes('fr')) {
      throw new Error('offline');
    }
    return { ok: true, json: async () => ({ menu: { play: 'Play' } }) };
  };
  try {
    const service = new I18nService();
    await service.init('fr', 'fr');
    assert.equal(service.getLocale(), 'en');
    assert.equal(service.t('menu.play'), 'Play');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

const indexHtml = readFileSync('./index.html', 'utf8');

/** Markup of the element with the given id, up to its matching closing tag. */
function elementMarkup(html, id) {
  const start = html.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `missing element #${id}`);
  const open = html.lastIndexOf('<', start);
  const tag = html.slice(open + 1).match(/^\w+/)[0];
  let depth = 0;
  const pattern = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  pattern.lastIndex = open;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) {
      return html.slice(open, match.index + match[0].length);
    }
  }
  return html.slice(open);
}

const SETTING_TOGGLE_IDS = ['btn-sound', 'btn-contrast', 'btn-patterns', 'btn-tilt', 'btn-motion', 'btn-lang'];

test('the header holds game modes and round actions; the setting toggles live in the Settings dialog', () => {
  const header = elementMarkup(indexHtml, 'app-drawer');
  const settings = elementMarkup(indexHtml, 'modal-settings');
  for (const id of SETTING_TOGGLE_IDS) {
    assert.ok(!header.includes(`id="${id}"`), `#${id} must leave the header`);
    assert.ok(settings.includes(`id="${id}"`), `#${id} must be in the Settings dialog`);
  }
  // Mode buttons share one neutral style; only the mode being played is lit, at run time.
  for (const id of ['btn-levels', 'btn-endless', 'btn-daily', 'btn-flux']) {
    assert.match(header, new RegExp(`id="${id}"[^>]*class="nav-btn mode-btn"`));
  }
  assert.match(elementMarkup(header, 'btn-pause'), /class="nav-btn primary"/, 'Pause is the one highlighted action');
  assert.match(header, /id="btn-settings"/);
});

test('the Workshop has one name, in the menu and on its dialog', () => {
  for (const lang of SUPPORTED) {
    const locale = loadJson(`./locales/${lang}.json`);
    assert.equal(locale.app.nav.button.shop, locale.modals.shop.title.main, `${lang}: one name for the Workshop`);
    assert.ok(locale.app.nav.button.shopBadge.startsWith(locale.app.nav.button.shop));
  }
  assert.match(elementMarkup(indexHtml, 'modal-shop'), /id="shop-ammo-pane"[^>]*role="tabpanel"/, 'ammo has its own tab');
});

test('the level select puts a level forward instead of starting Survival', () => {
  const dialog = elementMarkup(indexHtml, 'modal-levels');
  assert.ok(!dialog.includes('playEndless'));
  assert.match(dialog, /id="btn-play-level-modal"/);
  for (const lang of SUPPORTED) {
    const button = loadJson(`./locales/${lang}.json`).modals.levelSelect.button;
    assert.deepEqual(placeholdersOf(button.resume), ['level']);
    assert.deepEqual(placeholdersOf(button.play), ['level']);
  }
});

test('the board takes keyboard focus and shows it', () => {
  assert.match(indexHtml, /<canvas id="game-canvas"[^>]*tabindex="0"/);
  assert.match(mainCss, /#game-canvas:focus-visible\s*\{[^}]*outline:/);
});

test('a campaign victory leads to the next level, and to the level select after the last one', () => {
  const catalog = new LevelCatalog({
    levelsConfig: loadJson('./configs/levels.json'),
    campaignConfig: loadJson('./configs/campaign.json'),
    fluxConfig: loadJson('./configs/flux.json'),
    obstaclesConfig: loadJson('./configs/obstacles.json'),
    ballRadius: loadJson('./configs/physics.json').ball.radius
  });
  const middleId = Math.floor((catalog.firstId + catalog.lastId) / 2);
  assert.equal(resolveVictoryNextAction(middleId, catalog), VICTORY_NEXT_ACTIONS.NEXT_LEVEL);
  assert.equal(resolveVictoryNextAction(catalog.lastId, catalog), VICTORY_NEXT_ACTIONS.LEVEL_SELECT);

  const en = flattenStrings(loadJson('./locales/en.json'));
  const fr = flattenStrings(loadJson('./locales/fr.json'));
  for (const action of Object.values(VICTORY_NEXT_ACTIONS)) {
    const key = VICTORY_NEXT_LABEL_KEYS[action];
    assert.ok(en.has(key) && fr.has(key), `${action}: label ${key} in both locales`);
  }
  const uiSource = readFileSync('./src/ui/UIManager.js', 'utf8');
  const handler = uiSource.slice(
    uiSource.indexOf('btnNextLevel.addEventListener'),
    uiSource.indexOf('btnReplayVictory.addEventListener')
  );
  assert.ok(handler.length > 0 && !handler.includes('startEndlessMode'), 'Next Level never starts Survival');
});

test('a share tap while a share is under way is ignored, and the next one goes through', async () => {
  let release;
  let attempts = 0;
  const ui = {
    isSharing: false,
    shareRunResultOnce: () => {
      attempts++;
      return new Promise((resolve, reject) => {
        release = { resolve, reject };
      });
    }
  };
  const first = UIManager.prototype.shareRunResult.call(ui);
  await UIManager.prototype.shareRunResult.call(ui);
  assert.equal(attempts, 1, 'the second tap does not share again');
  release.reject(new Error('share sheet failed'));
  await assert.rejects(first);
  assert.equal(ui.isSharing, false, 'a failed share releases the guard');
  const next = UIManager.prototype.shareRunResult.call(ui);
  release.resolve();
  await next;
  assert.equal(attempts, 2);
});

/** The breakpoint opens the drawer layout in styles/main.css and switches its styles. */
const MIN_DRAWER_QUERY_USES = 2;

test('the drawer breakpoint of configs/game.json is the one styles/main.css uses', () => {
  const query = gameConfig.defaults.drawerMediaQuery;
  const uses = mainCss.split(query).length - 1;
  assert.ok(uses >= MIN_DRAWER_QUERY_USES, `${query} appears ${uses} times in styles/main.css`);
});

test('the install hint is for iOS browser tabs only, not for the installed app', () => {
  assert.equal(isIosBrowserTab({ standalone: false }, false), true, 'iOS Safari tab');
  assert.equal(isIosBrowserTab({}, false), false, 'no navigator.standalone: not iOS');
  assert.equal(isIosBrowserTab({ standalone: true }, false), false, 'launched from the home screen');
  assert.equal(isIosBrowserTab({ standalone: false }, true), false, 'display-mode standalone');
});

test('the star gauge runs from the last star earned to the next one', () => {
  const thresholds = [1000, 2000, 4000];
  assert.equal(computeStarProgressPct(0, thresholds, 1000), 0);
  assert.equal(computeStarProgressPct(500, thresholds, 1000), 50);
  assert.equal(computeStarProgressPct(1000, thresholds, 2000), 0, 'a fresh star empties the gauge');
  assert.equal(computeStarProgressPct(3000, thresholds, 4000), 50);
  assert.equal(computeStarProgressPct(5000, thresholds, undefined), 100, 'all stars: full gauge');
});

const uiManagerSource = readFileSync('./src/ui/UIManager.js', 'utf8');
const uiManagerCode = uiManagerSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Custom property declarations of a CSS block, as a name -> value map. */
function cssDeclarations(block) {
  const declarations = new Map();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

/** Numeric value of a CSS length written in px, e.g. "5px" -> 5. */
const pxValue = (text) => Number.parseFloat(String(text).trim().replace(/px$/, ''));

test('the HUD stars are read as a count, not as glyphs', () => {
  const progress = elementMarkup(indexHtml, 'hud-star-progress');
  assert.match(progress, /<span id="hud-star-glyphs"[^>]*aria-hidden="true"/);
  assert.match(progress, /<span id="hud-star-count" class="visually-hidden"><\/span>/);
  assert.match(uiManagerCode, /starCount:\s*document\.getElementById\('hud-star-count'\)/);
  assert.match(uiManagerCode, /this\.elements\.starCount,\s*t\('hud\.stats\.score\.starsAria'/);
  for (const lang of SUPPORTED) {
    const score = loadJson(`./locales/${lang}.json`).hud.stats.score;
    assert.deepEqual(placeholdersOf(score.starsAria), ['maxStars', 'stars']);
  }
});

test('the level grid is labelled by the active chapter tab', () => {
  assert.match(uiManagerCode, /tab\.id = `\$\{LEVEL_CHAPTER_TAB_ID_PREFIX\}\$\{chapter\.index\}`/);
  assert.match(
    uiManagerCode,
    /this\.elements\.levelsGrid,\s*'aria-labelledby',\s*`\$\{LEVEL_CHAPTER_TAB_ID_PREFIX\}\$\{this\.levelsChapterIndex\}`/
  );
  assert.match(uiManagerCode, /const LEVEL_CHAPTER_TAB_ID_PREFIX = 'levels-chapter-tab-';/);
});

test('a cleared Flux stage is announced once, not again on a refresh with the last extras', () => {
  assert.match(uiManagerCode, /const \{[^}]*\bunlockedAchievementId\b[^}]*\bfluxStageCleared\b[^}]*\.\.\.persistentExtra \} = extra;/);
  assert.doesNotMatch(uiManagerCode, /extra\.fluxStageCleared/);
});

test('UIManager keeps its numbers and icon gradient in named constants', () => {
  const bareHundreds = uiManagerCode.split('\n').filter((line) => /\b100\b/.test(line));
  assert.deepEqual(bareHundreds.map((line) => line.trim()), ['const FULL_PERCENT = 100;']);
  assert.equal(uiManagerCode.split('radial-gradient(').length - 1, 1, 'one icon gradient builder');
  assert.match(uiManagerCode, /radial-gradient\(circle at \$\{SPECIAL_ICON_HIGHLIGHT_POSITION\}/);
  assert.match(
    uiManagerCode,
    /t\('modals\.levelSelect\.starsTotal', \{\s*stars: formatNumber\(totalStars\),\s*maxStars: formatNumber\(maxCampaignStars\)/
  );
});

test('forced colors keep the star gauge visible', () => {
  const forcedBlock = cssBlock(mainCss, '@media (forced-colors: active)');
  assert.match(forcedBlock, /\.star-meter-fill\s*[,{][^}]*background:\s*Highlight/);
  assert.match(forcedBlock, /\.overcharge-fill\s*[,{][^}]*background:\s*Highlight/);
});

/** Opacity under which the empty special ball name drops below the targeted contrast. */
const MIN_EMPTY_POWERUP_NAME_OPACITY = 0.55;

test('an empty special ball keeps a readable name', () => {
  const nameRule = cssBlock(mainCss, '.powerup-btn.is-empty .powerup-name {');
  const opacity = Number.parseFloat(nameRule.match(/opacity:\s*([\d.]+)/)[1]);
  assert.ok(opacity >= MIN_EMPTY_POWERUP_NAME_OPACITY, `name opacity ${opacity}`);
  assert.match(cssBlock(mainCss, '.powerup-btn.is-empty .powerup-icon {'), /opacity:\s*0\.45/);
});

test('the scroll containers of the level select leave room for the whole focus ring', () => {
  const focusRule = mainCss.match(/(?:^|\n):focus-visible\s*\{([^}]*)\}/)[1];
  const outlineWidth = pxValue(focusRule.match(/outline:\s*([\d.]+px)/)[1]);
  const outlineOffset = pxValue(focusRule.match(/outline-offset:\s*([\d.]+px)/)[1]);
  const ring = outlineWidth + outlineOffset;
  const grid = cssBlock(mainCss, '.levels-grid {').match(/padding:\s*([^;]+);/)[1].split(/\s+/).map(pxValue);
  assert.ok(grid.every((side) => side >= ring), `.levels-grid padding ${grid} under ${ring}px`);
  const chapters = cssBlock(mainCss, '.level-chapters {').match(/padding:\s*([^;]+);/)[1].split(/\s+/).map(pxValue);
  assert.ok(chapters.every((side) => side >= ring), `.level-chapters padding ${chapters} under ${ring}px`);
});

test('every custom property defined in main.css is used somewhere', () => {
  const rawCss = readFileSync('./styles/main.css', 'utf8');
  const consumers = [
    rawCss,
    uiManagerSource,
    readFileSync('./src/game/Renderer.js', 'utf8'),
    indexHtml
  ].join('\n');
  const defined = new Set([...mainCss.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  assert.ok(defined.size > 0, 'the scan must find definitions');
  // Names hold only word characters and hyphens, so they need no escaping in a pattern.
  const unused = [...defined].filter((name) => !new RegExp(`var\\(${name}\\s*[,)]`).test(consumers));
  assert.deepEqual(unused, []);
});

test('the in-app and the system high contrast themes declare the same tokens', () => {
  const classTokens = cssDeclarations(cssBlock(mainCss, `:root.${HIGH_CONTRAST_CLASS} {`));
  const preferenceTokens = cssDeclarations(cssBlock(mainCss, '@media (prefers-contrast: more)'));
  assert.ok(classTokens.size > 0, 'the scan must find declarations');
  assert.deepEqual([...preferenceTokens].sort(), [...classTokens].sort());
});

test('the drawer duration is written once', () => {
  assert.match(mainCss, /--drawer-duration:\s*0\.22s;/);
  assert.equal(mainCss.split('0.22s').length - 1, 1, 'only the --drawer-duration definition holds 0.22s');
  assert.match(mainCss, /visibility 0s linear var\(--drawer-duration\)/);
});

test('btnPlayLevelModal asks for destructive confirmation when switching from an active non-campaign run', () => {
  assert.match(
    uiManagerCode,
    /this\.elements\.btnPlayLevelModal\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*if \(this\.isCampaignRunActive\(\)\) \{\s*this\.closeOverlayModal\(this\.elements\.modalLevels\);\s*return;\s*\}\s*this\.requestDestructiveAction\(/
  );
});

test('Pause and Settings modals both expose the reset-hints button and visible confirmation state', () => {
  const pauseModal = elementMarkup(indexHtml, 'modal-pause');
  const settingsModal = elementMarkup(indexHtml, 'modal-settings');
  assert.match(pauseModal, /id="btn-reset-hints-pause"/);
  assert.match(pauseModal, /data-caption-for="btn-reset-hints-pause"/);
  assert.match(settingsModal, /id="btn-reset-hints"/);
  assert.match(settingsModal, /data-caption-for="btn-reset-hints"/);
  assert.match(uiManagerCode, /updateResetHintsFeedback\(\)/);
  assert.match(uiManagerCode, /updateShareButtonLabel\(\)/);
});

test('Codex documents cluster modifiers, obstacles, special balls, and daily mutators', () => {
  assert.match(uiManagerCode, /modals\.shop\.codex\.specialsTitle/);
  assert.match(uiManagerCode, /modals\.shop\.codex\.mutatorsTitle/);
  const frCodex = loadJson('./locales/fr.json').modals.shop.codex;
  assert.equal(frCodex.modifiersTitle, "Modificateurs de l'Amas");
  for (const lang of SUPPORTED) {
    const codex = loadJson(`./locales/${lang}.json`).modals.shop.codex;
    for (const mutKey of Object.keys(gameConfig.daily.mutators)) {
      assert.ok(codex.mutators[mutKey]?.icon, `${lang} codex mutator icon for ${mutKey}`);
      assert.ok(codex.mutators[mutKey]?.description, `${lang} codex mutator description for ${mutKey}`);
    }
  }
});

test('Digit1-Digit6 shortcut opens Workshop Ammo tab when pressing an empty special slot during a run', () => {
  assert.match(
    uiManagerCode,
    /if \(count <= 0 && !isEquipped && this\.engine\.offersSpecialBalls\?\.\(\) && this\.isRunActive\(\)\) \{\s*this\.openShopModal\(SHOP_TABS\.AMMO\);/
  );
});

test('rerenderShopKeepingFocus keeps focus at or after the upgraded slot index when an upgrade reaches MAX', () => {
  let focusedId = null;
  const makeBtn = (id, slotIndex) => ({
    id,
    disabled: false,
    dataset: { slotIndex: String(slotIndex) },
    closest: () => null,
    focus() {
      focusedId = id;
    }
  });
  const btn0 = makeBtn('upgrade-0', 0);
  const btn2 = makeBtn('upgrade-2', 2);
  const closeBtn = makeBtn('close-shop', -1);
  const fakeUi = {
    renderShopContents() {},
    elements: {
      btnCloseShop: closeBtn,
      modalShop: {
        querySelector: () => null,
        querySelectorAll: () => [btn0, btn2]
      }
    }
  };
  UIManager.prototype.rerenderShopKeepingFocus.call(fakeUi, '[data-upgrade-key="blastRadius"]', 1);
  assert.equal(focusedId, 'upgrade-2', 'focus moves to the next upgrade button after slot 1 reaches MAX');
});

test('unlocked level cards expose a concise aria-label and aria-describedby', () => {
  assert.match(uiManagerCode, /modals\.levelSelect\.card\.ariaCurrent/);
  assert.match(uiManagerCode, /modals\.levelSelect\.card\.aria/);
  assert.match(uiManagerCode, /card\.setAttribute\('aria-describedby',\s*descId\)/);
  for (const lang of SUPPORTED) {
    const cardLocale = loadJson(`./locales/${lang}.json`).modals.levelSelect.card;
    assert.deepEqual(placeholdersOf(cardLocale.aria), ['best', 'id', 'maxStars', 'name', 'stars']);
    assert.deepEqual(placeholdersOf(cardLocale.ariaCurrent), ['best', 'id', 'maxStars', 'name', 'stars']);
  }
});

test('Daily Game Over countdown refreshes on a config-driven interval with unref', () => {
  assert.ok(gameConfig.daily.countdownRefreshMs > 0);
  assert.match(uiManagerCode, /this\.gameConfig\?\.daily\?\.countdownRefreshMs/);
  assert.match(uiManagerCode, /this\.dailyCountdownTimer\?\.unref\?\.\(\)/);
});

test('source files never use raw HTML sinks (.innerHTML, .outerHTML, .insertAdjacentHTML)', () => {
  const collectJsFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? collectJsFiles(join(dir, entry.name)) : entry.name.endsWith('.js') ? [join(dir, entry.name)] : []
    );
  const files = collectJsFiles('./src');
  const normalized = files.map((file) => file.replace(/\\/g, '/'));
  assert.ok(normalized.includes('src/ui/UIManager.js'), 'must reach src/ui/UIManager.js');
  assert.ok(
    normalized.includes('src/game/layouts/FluxStageGenerator.js'),
    'must reach nested subdirectory src/game/layouts/FluxStageGenerator.js'
  );
  for (const file of files) {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(
      code,
      /\.(?:innerHTML|outerHTML|insertAdjacentHTML)\b/,
      `${file} must not use raw HTML sinks`
    );
  }
});

test('powerup buttons include keyboard badge 1-6 and locked chapters expose chapterLockedHint', () => {
  assert.match(uiManagerCode, /document\.createElement\('kbd'\)/);
  assert.match(uiManagerCode, /keyBadge\.className = 'powerup-key'/);
  assert.match(uiManagerCode, /modals\.levelSelect\.chapterLockedHint/);
  assert.match(indexHtml, /id="levels-chapter-hint"/);
  assert.match(indexHtml, /id="victory-next-star"/);
  assert.match(indexHtml, /id="gameover-remaining"/);
  for (const lang of SUPPORTED) {
    const locale = loadJson(`./locales/${lang}.json`);
    assert.deepEqual(placeholdersOf(locale.modals.victory.nextStarHint), ['points', 'star', 'target']);
    assert.ok(locale.modals.victory.allStarsEarned);
    assert.ok(locale.modals.victory.stats.newRecordBadge);
    assert.ok(locale.modals.gameOver.stats.newRecordBadge);
    assert.deepEqual(placeholdersOf(locale.modals.gameOver.stats.remainingSpheres), ['count']);
    assert.deepEqual(placeholdersOf(locale.modals.levelSelect.chapterLockedHint), ['level']);
  }
});

test('Pause modal exposes Level Select button, Pause nav button exposes Esc tooltip, and locked cards expose ariaLocked and cardLockedHint', () => {
  const pauseModal = elementMarkup(indexHtml, 'modal-pause');
  assert.match(pauseModal, /id="btn-levels-pause"[^>]*data-i18n="modals\.pause\.button\.levels"/);
  const pauseNav = elementMarkup(indexHtml, 'btn-pause');
  assert.match(pauseNav, /data-i18n-title="app\.nav\.button\.pauseTooltip"/);
  assert.match(uiManagerCode, /this\.engine\.applyUpgradePurchase\(upgradeKey\)/);
  assert.match(uiManagerCode, /modals\.shop\.feedback\.upgradePurchased/);
  assert.match(uiManagerCode, /modals\.shop\.feedback\.ammoPurchased/);
  assert.match(uiManagerCode, /modals\.levelSelect\.card\.ariaLocked/);
  assert.match(uiManagerCode, /modals\.levelSelect\.cardLockedHint/);
  for (const lang of SUPPORTED) {
    const locale = loadJson(`./locales/${lang}.json`);
    assert.ok(locale.app.nav.button.pauseTooltip);
    assert.ok(locale.modals.pause.button.levels);
    assert.deepEqual(placeholdersOf(locale.modals.levelSelect.card.ariaLocked), ['id', 'name', 'previous']);
    assert.deepEqual(placeholdersOf(locale.modals.levelSelect.cardLockedHint), ['level']);
    assert.deepEqual(placeholdersOf(locale.modals.shop.upgrades.startingShots.description), ['shots']);
    assert.deepEqual(placeholdersOf(locale.modals.shop.feedback.upgradePurchased), ['level', 'maxLevel', 'name']);
    assert.deepEqual(placeholdersOf(locale.modals.shop.feedback.ammoPurchased), ['count', 'name']);
  }
});

test('computeAchievementProgress computes bounded current, target, and percentage values for all achievement types', () => {
  assert.deepEqual(
    computeAchievementProgress('comboMaster', { minChain: 5 }, false, { maxCombo: 3 }),
    { current: 3, target: 5, pct: 60 }
  );
  assert.deepEqual(
    computeAchievementProgress('starCollector', { targetStars: 15 }, false, { totalStars: 20 }),
    { current: 15, target: 15, pct: 100 }
  );
  assert.deepEqual(
    computeAchievementProgress('endlessSurvivor', { targetWave: 10 }, false, { endlessWave: 4 }),
    { current: 4, target: 10, pct: 40 }
  );
  assert.deepEqual(
    computeAchievementProgress('campaignComplete', {}, false, { unlockedLevel: 11, campaignLevelCount: 50 }),
    { current: 10, target: 50, pct: 20 }
  );
  assert.deepEqual(
    computeAchievementProgress('firstWin', {}, true, {}),
    { current: 1, target: 1, pct: 100 }
  );
});

test('Level select incomplete filter, Flux same-seed button, achievement progress, and contextual confirm label are wired', () => {
  const levelsModal = elementMarkup(indexHtml, 'modal-levels');
  assert.match(
    levelsModal,
    /id="btn-levels-filter-incomplete"[^>]*aria-pressed="false"[^>]*data-i18n="modals\.levelSelect\.filter\.incomplete"/
  );
  const gameOverModal = elementMarkup(indexHtml, 'modal-gameover');
  assert.match(gameOverModal, /id="btn-same-seed-gameover"[^>]*class="modal-btn hidden"/);
  assert.match(uiManagerCode, /this\.engine\.startFluxRun\(this\.engine\.fluxSeed\)/);
  assert.match(uiManagerCode, /achievement-progress-track/);
  assert.match(uiManagerCode, /achievement-progress-fill/);
  assert.match(uiManagerCode, /levels-empty-filter/);
  assert.match(uiManagerCode, /requestDestructiveAction\(actionCallback, confirmLabelResolver = null\)/);

  const ui = Object.create(UIManager.prototype);
  ui.engine = {
    state: 'playing',
    hasFiredInRound: true,
    physicsWorld: { balls: [{}] }
  };
  const btnConfirmYes = { textContent: 'Confirmer' };
  const modalConfirm = {
    classList: {
      hidden: true,
      remove() {
        this.hidden = false;
      },
      add() {
        this.hidden = true;
      },
      contains() {
        return this.hidden;
      }
    }
  };
  ui.elements = { modalConfirm, btnConfirmYes, btnConfirmNo: { focus() {} } };
  ui.isAnyModalOpen = () => false;
  ui.saveLastFocusedElement = () => {};
  ui.syncModalInertState = () => {};
  ui.closeOverlayModal = () => {};

  ui.requestDestructiveAction(() => {}, () => 'Survie');
  assert.equal(btnConfirmYes.textContent, 'Survie');
  ui.dismissConfirm();
  assert.notEqual(btnConfirmYes.textContent, 'Survie');

  for (const lang of SUPPORTED) {
    const locale = loadJson(`./locales/${lang}.json`);
    assert.ok(locale.modals.levelSelect.filter.incomplete);
    assert.ok(locale.modals.levelSelect.filter.allCompletedInChapter);
    assert.ok(locale.modals.levelSelect.filter.announcedIncomplete);
    assert.ok(locale.modals.levelSelect.filter.announcedAll);
    assert.deepEqual(placeholdersOf(locale.modals.shop.achievements.progress), ['current', 'target']);
    assert.deepEqual(placeholdersOf(locale.modals.gameOver.button.sameSeed), ['seed']);
    assert.deepEqual(placeholdersOf(locale.share.flux.headerWithSeed), ['seed']);
  }
});
