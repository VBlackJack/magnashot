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

import { GAME_MODES, GAME_OVER_REASONS, GAME_STATES, INPUT_MODES, SPECIAL_TYPES_ORDER } from '../src/core/Constants.js';
import { I18nService, i18n, resolveInitialLocale } from '../src/core/I18n.js';
import {
  DISCOVERY_PULSE_CLASS,
  HIGH_CONTRAST_CLASS,
  INPUT_ARIA_HINTS,
  MODAL_FOCUSABLE_SELECTOR,
  canOpenDrawer,
  computeAchievementProgress,
  computeStarProgressPct,
  filterFocusTrapCandidates,
  buildLevelIntroText,
  formatBestRunMarker,
  formatNearMissText,
  formatStreakGraceText,
  gameOverReasonKey,
  isBrowserShortcut,
  isDocumentFullscreen,
  isFullscreenSupported,
  isIosBrowserTab,
  isSharedFluxOverSavedRun,
  UIManager,
  VICTORY_NEXT_ACTIONS,
  VICTORY_NEXT_LABEL_KEYS,
  resolveModalFocusTarget,
  resolveNextCampaignTarget,
  resolveLevelFormatBadgeKey,
  resolveMechanicName,
  resolvePulseTargets,
  revealLiveRegion,
  shouldIgnoreRepeatedKey,
  splitRefreshExtra
} from '../src/ui/UIManager.js';
import { ARCADE_CARD_SPECS } from '../src/ui/UIHelpers.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { LevelCatalog, LEVEL_FORMATS } from '../src/game/LevelCatalog.js';
import { t } from '../src/core/I18n.js';
import { formatAchievementDescription, groupAchievementTiers } from '../src/ui/WorkshopView.js';
import { syncFluxPerkModal } from '../src/ui/FluxPerkView.js';
import { parseFluxSeedInput, stripFluxSeedFromUrl } from '../src/game/DailyShare.js';

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

const SETTING_TOGGLE_IDS = [
  'btn-sound',
  'btn-contrast',
  'btn-patterns',
  'btn-tilt',
  'btn-motion',
  'btn-anim-speed',
  'btn-fullscreen',
  'btn-lang'
];

test('the header holds Play, stats, Settings and the round actions; the setting toggles live in the Settings dialog', () => {
  const header = elementMarkup(indexHtml, 'app-drawer');
  const settings = elementMarkup(indexHtml, 'modal-settings');
  for (const id of SETTING_TOGGLE_IDS) {
    assert.ok(!header.includes(`id="${id}"`), `#${id} must leave the header`);
    assert.ok(settings.includes(`id="${id}"`), `#${id} must be in the Settings dialog`);
  }
  // The modes left the drawer for the Play hub: the drawer launches the hub and nothing else.
  for (const id of ['btn-levels', 'btn-endless', 'btn-daily', 'btn-flux', 'btn-weekly', 'nav-mode-lock-hint']) {
    assert.ok(!header.includes(`id="${id}"`), `#${id} is not in the drawer`);
  }
  assert.match(elementMarkup(header, 'btn-play'), /class="nav-btn primary play-btn"[^>]*aria-haspopup="dialog"/, 'Play is the one highlighted action');
  assert.match(elementMarkup(header, 'btn-play'), /id="play-new-badge"/);
  assert.match(header, /id="btn-stats"/);
  assert.match(header, /id="btn-settings"/);
  assert.match(header, /aria-labelledby="nav-group-round-title"/);
  for (const id of ['btn-pause', 'btn-restart', 'btn-shop']) {
    assert.match(header, new RegExp(`id="${id}"`));
  }
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
  assert.equal(resolveNextCampaignTarget(middleId, catalog).action, VICTORY_NEXT_ACTIONS.NEXT_LEVEL);
  assert.equal(resolveNextCampaignTarget(catalog.lastId, catalog).action, VICTORY_NEXT_ACTIONS.LEVEL_SELECT);

  const en = flattenStrings(loadJson('./locales/en.json'));
  const fr = flattenStrings(loadJson('./locales/fr.json'));
  for (const action of Object.values(VICTORY_NEXT_ACTIONS)) {
    const key = VICTORY_NEXT_LABEL_KEYS[action];
    assert.ok(en.has(key) && fr.has(key), `${action}: label ${key} in both locales`);
  }
  assert.ok(
    !Object.values(VICTORY_NEXT_ACTIONS).some((action) => /endless|survival/i.test(action)),
    'a campaign victory never offers Survival'
  );

  const { ui, el, calls } = bindEventsHarness({
    engine: { mode: 'campaign', state: 'victory', currentLevelId: middleId, levelCatalog: catalog }
  });
  ui.getVictoryTargetOptions = () => ({});
  ui.hideAllModals = () => {};
  el('btnNextLevel').click();
  assert.deepEqual(calls.startCampaignLevel, [middleId + 1], 'Next Level starts the next campaign level');
  assert.equal(calls.startEndlessMode.length, 0, 'Next Level never starts Survival');
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

const UI_MODULE_FILES = ['UIManager.js', 'UIHelpers.js', 'UIInputBindings.js', 'UIModals.js', 'UISettingsControls.js', 'UIHudRefresh.js', 'CodexView.js', 'WorkshopView.js', 'LevelSelectView.js', 'PlayHubView.js', 'UIStats.js'];
const uiManagerSource = UI_MODULE_FILES.map((file) => readFileSync(`./src/ui/${file}`, 'utf8')).join('\n');
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

test('the menu star progress is built once: hidden glyphs, a spoken count, then the next target', () => {
  const makeNode = () => ({
    ownText: '',
    attributes: {},
    children: [],
    className: '',
    get textContent() {
      return this.ownText + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
    },
    set textContent(value) {
      this.ownText = value;
      this.children = [];
    },
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    append(...nodes) {
      this.children.push(...nodes);
    }
  });
  const prevDoc = globalThis.document;
  globalThis.document = { createElement: makeNode };
  try {
    const classList = { contains: () => false, toggle: () => {} };
    const host = makeNode();
    host.classList = classList;
    const ui = Object.create(UIManager.prototype);
    ui.elements = {
      starProgress: { classList },
      starGlyphs: makeNode(),
      starCount: { textContent: 'Étoiles : 1 sur 3' },
      starNext: { textContent: '• Prochain : 6 900' },
      drawerStarProgress: host
    };
    ui.gameConfig = { theme: { starFilledSymbol: '★', starEmptySymbol: '☆' } };
    ui.renderStarGlyphs(ui.elements.starGlyphs, 1, 3);
    ui.syncDrawerStats();
    const [glyphs, count, , next] = host.children;
    assert.equal(glyphs.textContent, '★☆☆');
    assert.equal(glyphs.attributes['aria-hidden'], 'true', 'glyphs are hidden from screen readers');
    assert.equal(count.className, 'visually-hidden');
    assert.equal(count.textContent, 'Étoiles : 1 sur 3');
    assert.equal(next.textContent, '• Prochain : 6 900');

    ui.renderStarGlyphs(ui.elements.starGlyphs, 2, 3);
    ui.syncDrawerStats();
    assert.equal(host.children.length, 4, 'the spans are created once');
    assert.equal(host.children[0], glyphs);
    assert.equal(glyphs.textContent, '★★☆', 'later syncs only update the text');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('the level tile list is a listbox named after the open chapter', () => {
  assert.match(elementMarkup(indexHtml, 'modal-levels'), /id="levels-grid"[^>]*class="levels-grid level-tiles"[^>]*role="listbox"/);
  assert.match(
    uiManagerCode,
    /this\.elements\.levelsGrid,\s*'aria-label',\s*t\('modals\.levelSelect\.grid\.aria', \{ chapter: this\.formatChapterName\(chapter\) \}\)/
  );
  assert.doesNotMatch(uiManagerCode, /levels-chapter-tab-/);
  assert.match(uiManagerCode, /option\.disabled = isLocked/, 'a locked chapter is a disabled option of the chapter select');
});

test('a cleared Flux stage is announced once, not again on a refresh with the last extras', () => {
  assert.match(uiManagerCode, /const \{[^}]*\bunlockedAchievementIds\b[^}]*\bfluxStageCleared\b[^}]*\.\.\.persistentExtra \} = extra;/);
  assert.doesNotMatch(uiManagerCode, /extra\.fluxStageCleared/);
});

test('UIManager keeps its numbers and icon gradient in named constants', () => {
  const bareHundreds = uiManagerCode.split('\n').filter((line) => /\b100\b/.test(line));
  assert.deepEqual(bareHundreds.map((line) => line.trim()), ['const FULL_PERCENT = 100;']);
  assert.equal(uiManagerCode.split('radial-gradient(').length - 1, 1, 'one icon gradient builder');
  assert.match(uiManagerCode, /radial-gradient\(circle at \$\{SPECIAL_ICON_HIGHLIGHT_POSITION\}/);
  assert.match(
    uiManagerCode,
    /t\('modals\.levelSelect\.starsTotal', \{\s*stars: formatNumber\(this\.storageManager\.getTotalStars\(\)\),\s*maxStars: formatNumber\(maxCampaignStars\)/
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
  for (const selector of ['.level-tiles {', '.levels-switcher {']) {
    const sides = cssBlock(mainCss, selector).match(/padding:\s*([^;]+);/)[1].split(/\s+/).map(pxValue);
    assert.ok(sides.every((side) => side >= ring), `${selector} padding ${sides} under ${ring}px`);
  }
});

test('every custom property defined in main.css is used somewhere, and every referenced one is defined', () => {
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
  const referencedInCss = new Set([...mainCss.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]));
  const undefinedInCss = [...referencedInCss].filter((name) => !defined.has(name));
  assert.deepEqual(undefinedInCss, [], 'every var(--*) in styles/main.css must be defined in styles/main.css');
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

/** A UI stand-in for playSelectedLevel: the selected level, the run, and what the dialog did. */
function playSelectedLevelHarness({ engine = {}, selectedId = 3, unlocked = 10 } = {}) {
  const calls = { destructive: [], closed: [], hints: [], started: [] };
  const ui = Object.create(UIManager.prototype);
  ui.levelsSelectedId = selectedId;
  ui.autoPausedByOverlay = false;
  ui.elements = { modalLevels: { id: 'modal-levels' } };
  ui.storageManager = { getUnlockedLevel: () => unlocked };
  ui.engine = {
    mode: 'campaign',
    state: 'playing',
    currentLevelId: 3,
    startCampaignLevel: (id) => calls.started.push(id),
    ...engine
  };
  ui.requestDestructiveAction = (action) => calls.destructive.push(action);
  ui.closeOverlayModal = () => calls.closed.push(ui.engine.state);
  ui.showLockedLevelHint = (...args) => calls.hints.push(args);
  return { ui, calls };
}

test('playSelectedLevel closes the campaign map over the running level and asks to confirm otherwise', () => {
  const { ui, calls } = playSelectedLevelHarness();
  ui.playSelectedLevel();
  assert.deepEqual(calls.closed, ['playing'], 'the selected level of an active campaign run just resumes');
  assert.equal(calls.destructive.length, 0);

  ui.engine.mode = 'endless';
  ui.playSelectedLevel();
  assert.equal(calls.destructive.length, 1, 'switching from another run asks to confirm');

  ui.engine.mode = 'campaign';
  ui.levelsSelectedId = 4;
  ui.playSelectedLevel();
  assert.equal(calls.destructive.length, 2, 'another level than the running one asks to confirm');
  assert.equal(calls.closed.length, 1);
});

/** Stacks the campaign map over the Play hub on a real closeOverlayModal, to check where the run ends up. */
function stackedMapOverHubHarness({ autoPaused, state = 'paused' }) {
  const makeModal = (hidden) => {
    const classes = new Set(hidden ? ['hidden'] : []);
    return {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name)
      }
    };
  };
  const { ui } = playSelectedLevelHarness({
    engine: {
      state,
      togglePause() {
        this.state = this.state === 'paused' ? 'playing' : 'paused';
      }
    }
  });
  const modals = {
    modalLevels: makeModal(false),
    modalPlay: makeModal(false),
    modalPause: makeModal(true),
    modalConfirm: makeModal(true)
  };
  ui.elements = modals;
  ui.autoPausedByOverlay = autoPaused;
  ui.isDrawerOpen = false;
  ui.isRunHeldByUi = () => false;
  ui.isAnyOverlayModalOpen = () => ['modalLevels', 'modalPlay'].some((key) => !modals[key].classList.contains('hidden'));
  ui.syncModalInertState = () => {};
  ui.closeOverlayModal = UIManager.prototype.closeOverlayModal;
  return { ui, modals };
}

test('playSelectedLevel resumes the run and leaves no dialog open when the map is stacked over the hub', () => {
  const cases = [
    { name: 'hub opened during play', autoPaused: true },
    { name: 'hub opened from Pause', autoPaused: false }
  ];
  for (const { name, autoPaused } of cases) {
    const { ui, modals } = stackedMapOverHubHarness({ autoPaused });
    ui.playSelectedLevel();
    assert.equal(ui.engine.state, 'playing', `${name}: the run resumes`);
    for (const [key, modal] of Object.entries(modals)) {
      assert.equal(modal.classList.contains('hidden'), true, `${name}: ${key} is closed`);
    }
    assert.equal(ui.autoPausedByOverlay, false, `${name}: the overlay hold is released`);
  }
});

test('playSelectedLevel opened from Pause unpauses before closing the campaign map so Pause stays hidden and focus returns to the board', () => {
  const { ui, calls } = playSelectedLevelHarness({
    engine: {
      state: 'paused',
      togglePause() {
        this.state = 'playing';
      }
    }
  });
  ui.playSelectedLevel();
  assert.deepEqual(calls.closed, ['playing'], 'the run is already playing when closeOverlayModal runs');

  const locked = playSelectedLevelHarness({ selectedId: 12, unlocked: 10 });
  locked.ui.playSelectedLevel();
  assert.equal(locked.calls.hints.length, 1, 'a locked level shows its requirement and starts nothing');
  assert.equal(locked.calls.destructive.length, 0);
  assert.match(
    uiManagerCode,
    /t\('modals\.shop\.achievements\.reward',\s*\{\s*coins:\s*formatNumber\(shown\.spec\.rewardCoins\)\s*\}\)/
  );
});

test('Pause modal delegates settings to the Settings dialog and restores focus on close', () => {
  const pauseModal = elementMarkup(indexHtml, 'modal-pause');
  const settingsModal = elementMarkup(indexHtml, 'modal-settings');
  assert.match(pauseModal, /id="btn-settings-pause"[^>]*aria-haspopup="dialog"/);
  assert.ok(!pauseModal.includes('pause-settings-row'), 'Pause modal no longer duplicates setting toggles');
  assert.match(settingsModal, /id="btn-reset-hints"/);
  assert.match(settingsModal, /data-caption-for="btn-reset-hints"/);
  assert.match(uiManagerCode, /this\.stackedModalOpener = this\.elements\.btnSettingsPause/);
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

test('Digit1-Digit6 shortcut opens Workshop Ammo tab when pressing an empty special slot during a run (except Puzzle)', () => {
  const ui = Object.create(UIManager.prototype);
  ui.isRunActive = () => true;
  ui.engine = { mode: 'campaign' };
  assert.equal(ui.canBuySpecialAmmo(), true);
  ui.engine = { mode: 'puzzle' };
  assert.equal(ui.canBuySpecialAmmo(), false, 'Puzzle mode locks special ammo refills');

  // An empty slot opens the Workshop ammo tab; a stocked one equips the ball.
  const keyUi = Object.create(UIManager.prototype);
  const opened = [];
  const equipped = [];
  keyUi.setInputMode = () => {};
  keyUi.isAnyModalOpen = () => false;
  keyUi.canBuySpecialAmmo = () => true;
  keyUi.openShopModal = (tab) => opened.push(tab);
  keyUi.elements = {};
  keyUi.engine = {
    state: 'playing',
    specialInventory: {},
    offersSpecialBalls: () => true,
    equipSpecialBall: (type) => equipped.push(type)
  };
  const press = (code) => keyUi.handleKeyDown({ code, repeat: false, preventDefault() {} });
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null, body: {}, documentElement: {} };
  try {
    press('Digit1');
    assert.equal(opened.length, 1, 'an empty special slot opens the Workshop');
    assert.equal(equipped.length, 0);

    keyUi.engine.specialInventory = { [SPECIAL_TYPES_ORDER[0]]: 1 };
    press('Digit1');
    assert.equal(opened.length, 1, 'a stocked slot does not open the Workshop again');
    assert.deepEqual(equipped, [SPECIAL_TYPES_ORDER[0]], 'a stocked slot equips the ball');
  } finally {
    globalThis.document = prevDoc;
  }
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

test('unlocked level tiles expose a concise aria-label, selection state and a roving tab stop', () => {
  assert.match(uiManagerCode, /modals\.levelSelect\.card\.ariaCurrent/);
  assert.match(uiManagerCode, /modals\.levelSelect\.card\.aria'/);
  assert.match(uiManagerCode, /tile\.setAttribute\('role', 'option'\)/);
  assert.match(uiManagerCode, /tile\.setAttribute\('aria-selected'/);
  assert.match(uiManagerCode, /tile\.tabIndex = isSelected \? 0 : -1/);
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

test('Pause modal exposes the Change mode button, Pause nav button exposes Esc tooltip, and locked cards expose ariaLocked and cardLockedHint', () => {
  const pauseModal = elementMarkup(indexHtml, 'modal-pause');
  assert.match(pauseModal, /id="btn-levels-pause"[^>]*aria-haspopup="dialog"[^>]*data-i18n="modals\.play\.changeMode"/);
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
    assert.ok(locale.modals.play.changeMode);
    assert.deepEqual(placeholdersOf(locale.modals.levelSelect.card.ariaLocked), ['id', 'name', 'previous']);
    assert.deepEqual(placeholdersOf(locale.modals.levelSelect.cardLockedHint), ['level']);
    assert.deepEqual(placeholdersOf(locale.modals.shop.upgrades.startingShots.description), ['shots']);
    assert.deepEqual(placeholdersOf(locale.modals.shop.feedback.upgradePurchased), ['level', 'maxLevel', 'name']);
    assert.deepEqual(placeholdersOf(locale.modals.shop.feedback.ammoPurchased), ['count', 'name']);
  }
});

test('computeAchievementProgress computes bounded current, target, and percentage values for all achievement types', () => {
  for (const [achKey, achSpec] of Object.entries(gameConfig.achievements)) {
    const unlockedProgress = computeAchievementProgress(achKey, achSpec, true, {});
    assert.deepEqual(
      unlockedProgress,
      { current: achSpec.threshold, target: achSpec.threshold, pct: 100 },
      `unlocked achievement ${achKey} reaches its configured threshold`
    );
  }
  assert.deepEqual(
    computeAchievementProgress('comboMaster', gameConfig.achievements.comboMaster, false, { maxCombo: 3 }),
    { current: 3, target: 4, pct: 75 }
  );
  assert.deepEqual(
    computeAchievementProgress('starCollector', gameConfig.achievements.starCollector, false, { totalStars: 20 }),
    { current: 18, target: 18, pct: 100 }
  );
  assert.deepEqual(
    computeAchievementProgress('survivorWave10', gameConfig.achievements.survivorWave10, false, { endlessWave: 4 }),
    { current: 4, target: 10, pct: 40 }
  );
  assert.deepEqual(
    computeAchievementProgress('bossSlayer', gameConfig.achievements.bossSlayer, false, { bossesDestroyed: 0 }),
    { current: 0, target: gameConfig.achievements.bossSlayer.threshold, pct: 0 }
  );
  assert.deepEqual(
    computeAchievementProgress('firstAvalanche', gameConfig.achievements.firstAvalanche, false, {}),
    { current: 0, target: gameConfig.achievements.firstAvalanche.threshold, pct: 0 }
  );
  assert.deepEqual(
    computeAchievementProgress('sharpshooter', gameConfig.achievements.sharpshooter, false, {}),
    { current: 0, target: gameConfig.achievements.sharpshooter.threshold, pct: 0 }
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

test('stripFluxSeedFromUrl removes only the flux query parameter while preserving path, other query params, and hash', () => {
  assert.equal(stripFluxSeedFromUrl('https://example.com/play?flux=4F2A1C'), 'https://example.com/play');
  assert.equal(
    stripFluxSeedFromUrl('https://example.com/play?lang=fr&flux=4F2A1C#board'),
    'https://example.com/play?lang=fr#board'
  );
  assert.equal(stripFluxSeedFromUrl('/?flux=ABCDEF'), '/');
  assert.equal(stripFluxSeedFromUrl(''), '');
});

test('Level select incomplete filter, Flux same-seed button, achievement progress, and contextual confirm label are wired', () => {
  const levelsModal = elementMarkup(indexHtml, 'modal-levels');
  assert.match(
    levelsModal,
    /id="btn-levels-filter-incomplete"[^>]*aria-pressed="false"[^>]*data-i18n="modals\.levelSelect\.filter\.incomplete"/
  );
  const gameOverModal = elementMarkup(indexHtml, 'modal-gameover');
  assert.match(gameOverModal, /id="btn-same-seed-gameover"[^>]*class="modal-btn hidden"/);
  assert.match(uiManagerCode, /achievement-progress-track/);
  assert.match(uiManagerCode, /achievement-progress-fill/);
  assert.match(uiManagerCode, /levels-empty-filter/);
  assert.match(uiManagerCode, /requestDestructiveAction\(actionCallback, confirmLabelResolver = null, \{ always = false \} = \{\}\)/);

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
    assert.ok(locale.modals.victory.button.nextIncomplete);
    assert.ok(locale.modals.levelSelect.fluxSeed.placeholder);
    assert.ok(locale.modals.levelSelect.fluxSeed.ariaLabel);
    assert.ok(locale.modals.levelSelect.fluxSeed.launch);
    assert.deepEqual(placeholdersOf(locale.modals.levelSelect.fluxSeed.invalidHint), ['length']);
    for (const badgeKey of ['landmark', 'precision', 'arsenal', 'twist']) {
      assert.ok(locale.modals.levelSelect.card.formatBadge[badgeKey]);
    }
  }
});

test('requestDestructiveAction with always confirms a restored run that has not fired yet', () => {
  const makeUi = () => {
    const ui = Object.create(UIManager.prototype);
    ui.engine = { state: 'playing', hasFiredInRound: false, physicsWorld: { balls: [{}] } };
    const modalConfirm = { classList: { hidden: true, remove() { this.hidden = false; } } };
    ui.elements = { modalConfirm, btnConfirmYes: { textContent: '' }, btnConfirmNo: { focus() {} } };
    ui.isAnyModalOpen = () => false;
    ui.saveLastFocusedElement = () => {};
    ui.syncModalInertState = () => {};
    return { ui, modalConfirm };
  };

  const plain = makeUi();
  let plainRuns = 0;
  plain.ui.requestDestructiveAction(() => {
    plainRuns++;
  });
  assert.equal(plainRuns, 1, 'without always, an unfired run still proceeds silently');
  assert.equal(plain.modalConfirm.classList.hidden, true);

  const guarded = makeUi();
  let guardedRuns = 0;
  guarded.ui.requestDestructiveAction(
    () => {
      guardedRuns++;
    },
    null,
    { always: true }
  );
  assert.equal(guardedRuns, 0, 'the action waits for the player');
  assert.equal(guarded.modalConfirm.classList.hidden, false, 'the Confirm modal opens');
  guarded.ui.pendingConfirmCallback();
  assert.equal(guardedRuns, 1, 'the action runs once confirmed');
});

test('StorageManager persists all-time best achievement progress records', () => {
  const storage = new StorageManager();
  storage.storageConfig = loadJson('./configs/game.json').storage;
  assert.deepEqual(storage.getAchievementRecords(), {
    maxCombo: 0,
    endlessWave: 0,
    maxAvalanche: 0,
    bossesDestroyed: 0,
    shotsRemainingOnClear: 0,
    magnetarsGrounded: 0,
    magnetarLandslide: 0
  });
  storage.recordAchievementProgress({ maxCombo: 3, endlessWave: 6, maxAvalanche: 9 });
  storage.recordAchievementProgress({ maxCombo: 2, endlessWave: 8, bossesDestroyed: 1, shotsRemainingOnClear: 5 });
  assert.deepEqual(storage.getAchievementRecords(), {
    maxCombo: 3,
    endlessWave: 8,
    maxAvalanche: 9,
    bossesDestroyed: 1,
    shotsRemainingOnClear: 5,
    magnetarsGrounded: 0,
    magnetarLandslide: 0
  });
});

test('resolveNextCampaignTarget finds the next unlocked < 3★ level when filterIncomplete is active', () => {
  const catalog = new LevelCatalog({
    levelsConfig: loadJson('./configs/levels.json'),
    campaignConfig: loadJson('./configs/campaign.json'),
    fluxConfig: loadJson('./configs/flux.json'),
    obstaclesConfig: loadJson('./configs/obstacles.json'),
    ballRadius: loadJson('./configs/physics.json').ball.radius
  });
  const stats = {
    1: { stars: 3 },
    2: { stars: 2 },
    3: { stars: 3 },
    4: { stars: 1 }
  };
  assert.deepEqual(
    resolveNextCampaignTarget(1, catalog, { filterIncomplete: true, unlockedLevel: 5, levelStats: stats, maxStars: 3 }),
    { action: VICTORY_NEXT_ACTIONS.NEXT_INCOMPLETE, targetLevelId: 2 }
  );
  assert.deepEqual(
    resolveNextCampaignTarget(4, catalog, { filterIncomplete: true, unlockedLevel: 4, levelStats: stats, maxStars: 3 }),
    { action: VICTORY_NEXT_ACTIONS.NEXT_INCOMPLETE, targetLevelId: 2 },
    'wraps around to earlier unlocked < 3★ level'
  );
  assert.deepEqual(
    resolveNextCampaignTarget(catalog.lastId, catalog, { filterIncomplete: false }),
    { action: VICTORY_NEXT_ACTIONS.LEVEL_SELECT, targetLevelId: null },
    'without filterIncomplete on lastId, opens level select'
  );
});

test('parseFluxSeedInput extracts valid 6-char hex seeds from codes, #codes, URLs, and share text', () => {
  const seedConfig = loadJson('./configs/flux.json').seed;
  assert.equal(parseFluxSeedInput('4F2A1C', seedConfig), '4f2a1c');
  assert.equal(parseFluxSeedInput('  #AB12CD ', seedConfig), 'ab12cd');
  assert.equal(
    parseFluxSeedInput('https://vblackjack.github.io/magnashot/?flux=9E8D7C', seedConfig),
    '9e8d7c'
  );
  assert.equal(
    parseFluxSeedInput('MagnaShot - Flux Mode (#1A2B3C)\nShape 4 - 12,450 pts', seedConfig),
    '1a2b3c'
  );
  assert.equal(parseFluxSeedInput('not-a-seed', seedConfig), null);
  assert.equal(parseFluxSeedInput('', seedConfig), null);
});

test('resolveLevelFormatBadgeKey and LevelCatalog.summarize expose landmark and format badges', () => {
  const catalog = new LevelCatalog({
    levelsConfig: loadJson('./configs/levels.json'),
    campaignConfig: loadJson('./configs/campaign.json'),
    fluxConfig: loadJson('./configs/flux.json'),
    obstaclesConfig: loadJson('./configs/obstacles.json'),
    ballRadius: loadJson('./configs/physics.json').ball.radius
  });
  const level1 = catalog.summarize(1);
  const level12 = catalog.summarize(12);
  assert.equal(level1.isLandmark, false);
  assert.equal(resolveLevelFormatBadgeKey(level1), null);
  assert.equal(level12.isLandmark, true, 'authored Boss level is marked as a landmark');
  assert.equal(resolveLevelFormatBadgeKey(level12), 'modals.levelSelect.card.formatBadge.landmark');
  assert.equal(
    resolveLevelFormatBadgeKey({ format: LEVEL_FORMATS.PRECISION, isLandmark: false }),
    'modals.levelSelect.card.formatBadge.precision'
  );
  assert.equal(
    resolveLevelFormatBadgeKey({ format: LEVEL_FORMATS.ARSENAL, isLandmark: false }),
    'modals.levelSelect.card.formatBadge.arsenal'
  );
  assert.equal(
    resolveLevelFormatBadgeKey({ format: LEVEL_FORMATS.TWIST, isLandmark: false }),
    'modals.levelSelect.card.formatBadge.twist'
  );
});

test('Arcade modes live in the rich cards of the Play hub while the burger drawer keeps Play and round actions', () => {
  const header = elementMarkup(indexHtml, 'app-drawer');
  for (const id of ['btn-puzzle', 'btn-blitz', 'btn-boss-rush', 'btn-cascade', 'btn-mode-puzzle', 'btn-mode-blitz']) {
    assert.ok(!header.includes(`id="${id}"`), `#${id} is not duplicated in the burger drawer`);
  }
  assert.match(header, /aria-labelledby="nav-group-round-title"/);
  assert.doesNotMatch(header, /nav-group-modes-title/);
  const hub = elementMarkup(indexHtml, 'modal-play');
  const levelsModal = elementMarkup(indexHtml, 'modal-levels');
  for (const id of ['btn-mode-puzzle', 'btn-mode-blitz', 'btn-mode-boss-rush', 'btn-mode-cascade']) {
    assert.match(hub, new RegExp(`id="${id}"[^>]*class="arcade-mode-card"`));
    assert.ok(!levelsModal.includes(`id="${id}"`), `#${id} left the campaign map`);
  }
  assert.match(
    indexHtml,
    /id="hud-mode-banner"[^>]*role="button"[^>]*tabindex="0"[^>]*aria-haspopup="dialog"/
  );

  const ui = Object.create(UIManager.prototype);
  ui.gameConfig = gameConfig;
  ui.storageManager = {
    getPuzzleBestStage: () => 3,
    getFluxBestStage: () => 5,
    getBossRushBestWave: () => 4
  };
  ui.engine = { mode: 'campaign', currentPuzzleStage: 1 };
  assert.equal(ui.getSuggestedPuzzleStage(), 3, 'Switching into Puzzle mode resumes at the best unlocked stage');
  ui.engine = { mode: 'puzzle', currentPuzzleStage: 2 };
  assert.equal(ui.getSuggestedPuzzleStage(), 2, 'Clicking Puzzle while already in Puzzle mode keeps the active stage');
  ui.engine = { mode: 'puzzle', currentPuzzleStage: 3 };
  assert.equal(ui.getSuggestedPuzzleStage(), 3, 'Clicking Puzzle on the highest unlocked stage stays on stage 3');

  assert.match(hub, /id="puzzle-stages-strip"[^>]*class="puzzle-stages-strip play-disclosure hidden"/);
  assert.match(hub, /id="btn-puzzle-stages-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="puzzle-stages-strip"/);
  assert.match(uiManagerCode, /style-preview-orb style-preview-\$\{styleId\}/);
  i18n.dictionaries.set('fr', JSON.parse(readFileSync('./locales/fr.json', 'utf8')));
  assert.ok(
    ui.formatGameOverStageSummary(
      { mode: 'endless', waveCount: 7, combo: 2 },
      { maxCombo: 4, earnedCoins: 18 }
    ).includes('7'),
    'formatGameOverStageSummary formats Survival wave, max combo, and coins earned'
  );
  assert.ok(
    ui.formatGameOverStageSummary(
      { mode: 'boss_rush', bossRushWave: 3 },
      { earnedCoins: 24 }
    ).includes('3'),
    'formatGameOverStageSummary formats Boss Rush wave and coins earned'
  );
});

test('Graphical audit guards: collector labels, floating-text clamping, Antimagnet ring, Puzzle swap lock, Codex obstacle colors, and forced-colors tracks', () => {
  const rendererCode = [
    readFileSync('./src/game/Renderer.js', 'utf8'),
    readFileSync('./src/game/RendererParticles.js', 'utf8')
  ]
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.match(rendererCode, /theme\.collectorLabelColor/, 'drawCollectorBins uses theme.collectorLabelColor');
  assert.match(rendererCode, /gameplay\.feedback\.collector\.slotLabel/, 'drawCollectorBins renders localized slot bonus');
  assert.match(rendererCode, /ctx\.measureText\?\.\(ft\.text\)\?\.width/, 'drawParticles measures floating text width to prevent horizontal clipping');
  assert.match(rendererCode, /if \(cfg\.outerColor\)/, 'drawObstacles renders outerColor and ringColor on Antimagnet');
  assert.match(
    uiManagerCode,
    /const isSwapLocked = engine\.mode === GAME_MODES\.PUZZLE;\s*this\.elements\.swapBtn\.disabled = isSwapLocked;/,
    'UIManager disables #btn-swap-ball for the whole Puzzle run'
  );
  assert.match(
    uiManagerCode,
    /const badgeColor = obsSpec\?\.ringColor \|\| obsSpec\?\.borderColor \|\| obsSpec\?\.coreColor \|\| obsSpec\?\.beamColor;/,
    'CodexView colors obstacle badges from obstacles.json'
  );
  const forcedBlock = cssBlock(mainCss, '@media (forced-colors: active)');
  for (const selector of ['.overcharge-track', '.star-meter', '.achievement-progress-track', '.codex-card', '.ammo-card']) {
    assert.ok(forcedBlock.includes(selector), `${selector} has an explicit border in forced-colors mode`);
  }
  assert.match(mainCss, /\.swap-floating-btn:disabled,\s*\.polarity-floating-btn:disabled\s*\{/);
  assert.match(
    cssBlock(mainCss, '.codex-badge'),
    /box-shadow:\s*inset 0 2px 4px var\(--highlight-alpha-40\),\s*0 2px 6px var\(--shadow-alpha-45\);/,
    '.codex-badge has 3D orb inner highlight and drop shadow'
  );
});

test('UX audit guards: Blitz HUD wave banner, locked Puzzle aria-disabled hint, touch Pause polarity/arsenal instruction, Codex mechanics, and Level Select initial focus', () => {
  assert.match(
    uiManagerCode,
    /t\('hud\.stats\.mode\.blitz',\s*\{\s*wave:\s*formatNumber\(engine\.waveCount\)\s*\}\)/,
    'Blitz HUD mode banner shows the current wave while the shots box shows the countdown timer'
  );
  assert.match(
    uiManagerCode,
    /btn\.setAttribute\('aria-disabled',\s*'true'\)/,
    'Locked Puzzle stage buttons use aria-disabled="true" so keyboard and touch users receive a hint'
  );
  assert.match(
    uiManagerCode,
    /this\.showLockedLevelHint\(requiredStage,\s*'modals\.levelSelect\.arcade\.puzzleStageLocked'\)/,
    'Clicking a locked Puzzle stage reveals the polite hint banner'
  );
  assert.match(
    uiManagerCode,
    /setAttributeIfChanged\(\s*this\.elements\.modeBanner,\s*'aria-label'/,
    '#hud-mode-banner updates its aria-label with the switchHint action'
  );
  assert.match(
    uiManagerCode,
    /modals\.shop\.codex\.mechanicsTitle/,
    'Codex renders the Board & Launcher Mechanics section'
  );

  for (const lang of SUPPORTED) {
    const locale = loadJson(`./locales/${lang}.json`);
    assert.deepEqual(placeholdersOf(locale.hud.stats.mode.blitz), ['wave']);
    assert.ok(locale.modals.pause.instructions.keyboard.pointer);
    assert.ok(locale.modals.pause.instructions.keyboard.touch);
    assert.notEqual(
      locale.modals.pause.instructions.keyboard.pointer,
      locale.modals.pause.instructions.keyboard.touch
    );
    for (const mechKey of ['polarity', 'collectors', 'overcharge']) {
      assert.ok(locale.modals.shop.codex.mechanics[mechKey]?.icon);
      assert.ok(locale.modals.shop.codex.mechanics[mechKey]?.name);
      assert.ok(locale.modals.shop.codex.mechanics[mechKey]?.description);
    }
  }

  const ui = Object.create(UIManager.prototype);
  const continueBtn = { id: 'btn-campaign-continue' };
  const closeBtn = { id: 'btn-close-play' };
  const blitzBtn = { id: 'btn-mode-blitz' };
  const endlessBtn = { id: 'btn-endless' };
  ui.elements = {
    btnCampaignContinue: continueBtn,
    btnClosePlay: closeBtn,
    btnModeBlitz: blitzBtn,
    btnEndless: endlessBtn
  };
  ui.storageManager = { getModeAccess: () => ({}) };
  ui.engine = { mode: 'campaign', state: 'playing' };
  assert.equal(ui.getPlayHubInitialFocus(), continueBtn, 'Campaign run focuses the Campaign continue button');
  ui.engine = { mode: 'blitz', state: 'playing' };
  assert.equal(ui.getPlayHubInitialFocus(), blitzBtn, 'Blitz run focuses the Blitz card instead of Campaign continue');
  ui.engine = { mode: 'endless', state: 'playing' };
  assert.equal(ui.getPlayHubInitialFocus(), endlessBtn, 'Survival run focuses the Survival card');
  ui.engine = { mode: 'blitz', state: 'game_over' };
  assert.equal(ui.getPlayHubInitialFocus(), continueBtn, 'without a run the hub starts on Continue');
  ui.storageManager = { getModeAccess: () => ({ endless: { unlocked: false } }) };
  ui.engine = { mode: 'endless', state: 'playing' };
  assert.equal(ui.getPlayHubInitialFocus(), continueBtn, 'a locked running mode falls back to Continue');
});

test('Settings modal exposes #btn-anim-speed cycling through configured animation speeds (0.5x, 1x, 1.5x, 2x)', async () => {
  await i18n.init('fr', ['fr', 'en']);
  const gameConfig = loadJson('./configs/game.json');
  assert.deepEqual(gameConfig.defaults.animationSpeeds, [0.5, 1, 1.5, 2]);
  assert.equal(gameConfig.defaults.animationSpeed, 1);

  const settingsMarkup = elementMarkup(indexHtml, 'modal-settings');
  assert.match(settingsMarkup, /id="btn-anim-speed"/);
  assert.match(settingsMarkup, /data-caption-for="btn-anim-speed"/);

  for (const lang of SUPPORTED) {
    const locale = loadJson(`./locales/${lang}.json`);
    assert.deepEqual(placeholdersOf(locale.app.nav.button.animSpeed), ['speed']);
    assert.deepEqual(placeholdersOf(locale.app.nav.button.animSpeedAria), ['speed']);
    assert.deepEqual(placeholdersOf(locale.app.nav.button.animSpeedCaption), ['speed']);
  }

  let currentSpeed = 1;
  const captionEl = { textContent: '' };
  const prevDoc = globalThis.document;
  globalThis.document = {
    querySelector: (sel) => (sel === '[data-caption-for="btn-anim-speed"]' ? captionEl : null)
  };
  try {
    const ui = Object.create(UIManager.prototype);
    let isActive = false;
    const btnAnimSpeed = {
      id: 'btn-anim-speed',
      textContent: '',
      title: '',
      attributes: {},
      setAttribute(k, v) {
        this.attributes[k] = v;
      },
      getAttribute(k) {
        return this.attributes[k];
      },
      classList: {
        toggle(cls, force) {
          if (cls === 'active') {
            isActive = Boolean(force);
          }
        }
      }
    };
    ui.gameConfig = gameConfig;
    ui.storageManager = {
      getAnimationSpeed: () => currentSpeed
    };
    ui.elements = { btnAnimSpeed };

    ui.updateAnimSpeedButton();
    assert.equal(btnAnimSpeed.textContent, '1x');
    assert.equal(captionEl.textContent, 'Vitesse : 1x');
    assert.equal(isActive, false, 'default 1x speed is not marked active');

    currentSpeed = 2;
    ui.updateAnimSpeedButton();
    assert.equal(btnAnimSpeed.textContent, '2x');
    assert.equal(captionEl.textContent, 'Vitesse : 2x');
    assert.equal(isActive, true, 'non-default 2x speed is highlighted as active');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('Fullscreen toggle is exposed in portrait HUD (#btn-fullscreen-hud) and Settings (#btn-fullscreen) with Fullscreen API support', async () => {
  await i18n.init('fr', ['fr', 'en']);
  assert.match(indexHtml, /id="btn-fullscreen-hud"[^>]*class="hud-menu-btn hud-fullscreen-btn"/);
  assert.match(elementMarkup(indexHtml, 'modal-settings'), /id="btn-fullscreen"/);

  assert.equal(isFullscreenSupported(null), false);
  assert.equal(isFullscreenSupported({ documentElement: {} }), false);
  assert.equal(
    isFullscreenSupported({
      fullscreenEnabled: true,
      documentElement: { requestFullscreen: () => Promise.resolve() }
    }),
    true
  );
  assert.equal(
    isFullscreenSupported({
      fullscreenEnabled: false,
      documentElement: { requestFullscreen: () => Promise.resolve() }
    }),
    false
  );
  assert.equal(isDocumentFullscreen({ fullscreenElement: null }), false);
  assert.equal(isDocumentFullscreen({ fullscreenElement: {} }), true);
  assert.equal(isDocumentFullscreen({ webkitFullscreenElement: {} }), true);

  let fullscreenEl = null;
  let requestedOptions = null;
  const captionEl = { textContent: '' };
  const prevDoc = globalThis.document;
  globalThis.document = {
    fullscreenEnabled: true,
    get fullscreenElement() {
      return fullscreenEl;
    },
    documentElement: {
      requestFullscreen(opts) {
        requestedOptions = opts;
        fullscreenEl = this;
        return Promise.resolve();
      }
    },
    exitFullscreen() {
      fullscreenEl = null;
      return Promise.resolve();
    },
    querySelector: (sel) => (sel === '[data-caption-for="btn-fullscreen"]' ? captionEl : null)
  };
  try {
    const makeBtn = (id) => ({
      id,
      textContent: '',
      title: '',
      attributes: {},
      setAttribute(k, v) {
        this.attributes[k] = v;
      },
      getAttribute(k) {
        return this.attributes[k];
      }
    });
    const ui = Object.create(UIManager.prototype);
    ui.elements = {
      btnFullscreen: makeBtn('btn-fullscreen'),
      btnFullscreenHud: makeBtn('btn-fullscreen-hud')
    };

    ui.updateFullscreenButton();
    assert.equal(ui.elements.btnFullscreen.getAttribute('aria-pressed'), 'false');
    assert.equal(ui.elements.btnFullscreenHud.getAttribute('aria-pressed'), 'false');
    assert.equal(captionEl.textContent, 'Plein écran : Désactivé');

    await ui.toggleFullscreen();
    assert.deepEqual(requestedOptions, { navigationUI: 'hide' });
    assert.equal(ui.elements.btnFullscreen.getAttribute('aria-pressed'), 'true');
    assert.equal(ui.elements.btnFullscreenHud.getAttribute('aria-pressed'), 'true');
    assert.equal(captionEl.textContent, 'Plein écran : Activé');

    await ui.toggleFullscreen();
    assert.equal(ui.elements.btnFullscreen.getAttribute('aria-pressed'), 'false');
    assert.equal(ui.elements.btnFullscreenHud.getAttribute('aria-pressed'), 'false');
  } finally {
    globalThis.document = prevDoc;
  }
});

/**
 * Runs UIManager.bindEvents against stub elements and returns the manager, an element
 * lookup whose stubs expose click(), and the engine calls recorded so far.
 */
function bindEventsHarness({ engine = {}, storage = {} } = {}) {
  const cache = new Map();
  const makeEl = (name) => {
    const handlers = {};
    return {
      id: name,
      textContent: '',
      attributes: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      style: {},
      addEventListener(type, fn) {
        (handlers[type] ||= []).push(fn);
      },
      click() {
        for (const fn of handlers.click || []) {
          fn({ preventDefault() {}, stopPropagation() {}, target: this, currentTarget: this });
        }
      },
      querySelectorAll: () => [],
      querySelector: () => null,
      setAttribute(k, v) {
        this.attributes[k] = v;
      },
      getAttribute(k) {
        return this.attributes[k] ?? null;
      },
      removeAttribute() {},
      focus() {},
      closest: () => null
    };
  };
  const el = (name) => {
    if (!cache.has(name)) {
      cache.set(name, makeEl(name));
    }
    return cache.get(name);
  };
  const calls = { startCampaignLevel: [], startEndlessMode: [], destructive: [] };
  const ui = Object.create(UIManager.prototype);
  ui.elements = new Proxy({}, { get: (_, name) => (typeof name === 'string' ? el(name) : undefined) });
  ui.gameConfig = gameConfig;
  ui.storageManager = storage;
  ui.engine = {
    state: 'playing',
    startCampaignLevel: (id) => calls.startCampaignLevel.push(id),
    startEndlessMode: () => calls.startEndlessMode.push(true),
    isVictoryCelebrating: () => false,
    ...engine
  };
  const prevWindow = globalThis.window;
  const prevDoc = globalThis.document;
  const noopTarget = { addEventListener() {}, removeEventListener() {}, hidden: false, matchMedia: () => ({ matches: false }) };
  globalThis.window = noopTarget;
  globalThis.document = { ...noopTarget, querySelector: () => null, querySelectorAll: () => [] };
  try {
    ui.bindEvents();
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDoc;
  }
  return { ui, el, calls };
}

const makeClassList = (...initial) => {
  const names = new Set(initial);
  return {
    add: (name) => names.add(name),
    remove: (name) => names.delete(name),
    contains: (name) => names.has(name),
    toggle(name, force) {
      const on = force ?? !names.has(name);
      if (on) {
        names.add(name);
      } else {
        names.delete(name);
      }
      return on;
    }
  };
};

/** A manager wired with just enough stub elements to exercise the slide-in menu. */
function makeDrawerUi({ state = 'playing' } = {}) {
  const focusLog = [];
  const makeFocusable = (id) => ({
    id,
    attributes: {},
    classList: makeClassList(),
    inert: false,
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    removeAttribute(k) {
      delete this.attributes[k];
    },
    focus() {
      focusLog.push(id);
    }
  });
  const ui = Object.create(UIManager.prototype);
  ui.isDrawerOpen = false;
  ui.autoPausedByOverlay = false;
  ui.lastExtra = {};
  ui.engine = { state, isVictoryCelebrating: () => false };
  ui.refresh = () => {};
  ui.syncModalInertState = () => {};
  ui.elements = {
    appShell: makeFocusable('app-shell'),
    hudBar: makeFocusable('hud-bar'),
    stageContainer: makeFocusable('stage'),
    btnMenu: makeFocusable('btn-menu'),
    btnCloseDrawer: makeFocusable('btn-close-drawer'),
    drawer: makeFocusable('app-drawer'),
    modalConfirm: makeFocusable('modal-confirm'),
    modalLevels: makeFocusable('modal-levels'),
    modalShop: makeFocusable('modal-shop'),
    modalSettings: makeFocusable('modal-settings'),
    modalPause: makeFocusable('modal-pause')
  };
  for (const name of ['modalConfirm', 'modalLevels', 'modalShop', 'modalSettings', 'modalPause']) {
    ui.elements[name].classList.add('hidden');
  }
  ui.getModalsByPriority = () => [
    ui.elements.modalConfirm,
    ui.elements.modalLevels,
    ui.elements.modalShop,
    ui.elements.modalSettings
  ];
  ui.getOverlayModals = () => [ui.elements.modalLevels, ui.elements.modalShop, ui.elements.modalSettings];
  // Opening the menu re-reads the mode locks; this harness has no gated buttons.
  ui.refreshModeLocks = () => {};
  return { ui, focusLog };
}

test('opening the menu pauses the run, takes the page behind it out of reach and flags the button', () => {
  const { ui, focusLog } = makeDrawerUi();
  ui.openDrawer();
  assert.equal(ui.isDrawerOpen, true);
  assert.equal(ui.engine.state, 'paused');
  assert.equal(ui.autoPausedByOverlay, true);
  assert.equal(ui.elements.hudBar.inert, true);
  assert.equal(ui.elements.stageContainer.inert, true);
  assert.equal(ui.elements.btnMenu.attributes['aria-expanded'], 'true');
  assert.equal(ui.elements.drawer.attributes['aria-modal'], 'true');
  assert.deepEqual(focusLog, ['btn-close-drawer']);
});

test('closing the menu resumes the run it paused, and hands focus back to the menu button', () => {
  const { ui, focusLog } = makeDrawerUi();
  ui.openDrawer();
  ui.closeDrawer({ resume: true });
  assert.equal(ui.engine.state, 'playing');
  assert.equal(ui.elements.hudBar.inert, false);
  assert.equal(ui.elements.stageContainer.inert, false);
  assert.equal(ui.elements.btnMenu.attributes['aria-expanded'], 'false');
  assert.equal(ui.elements.drawer.attributes['aria-modal'], undefined);
  assert.equal(focusLog.at(-1), 'btn-menu');
});

test('closing the menu for a menu action leaves the run paused', () => {
  const { ui, focusLog } = makeDrawerUi();
  ui.openDrawer();
  ui.closeDrawer({ resume: false });
  assert.equal(ui.engine.state, 'paused');
  assert.equal(ui.isDrawerOpen, false);
  assert.equal(focusLog.at(-1), 'btn-menu');
});

test('gameplay shortcuts do nothing while the menu is open', () => {
  const { ui } = makeDrawerUi();
  const calls = [];
  ui.setInputMode = () => {};
  ui.canBuySpecialAmmo = () => true;
  ui.openShopModal = (tab) => calls.push(`shop:${tab}`);
  ui.engine.specialInventory = {};
  ui.engine.offersSpecialBalls = () => true;
  ui.engine.swapLauncherBalls = () => calls.push('swap');
  ui.engine.equipSpecialBall = () => calls.push('equip');
  ui.openDrawer();
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null, body: {}, documentElement: {} };
  try {
    for (const code of ['Digit1', 'Digit3', 'Space']) {
      ui.handleKeyDown({ code, repeat: false, preventDefault() {} });
    }
  } finally {
    globalThis.document = prevDoc;
  }
  assert.deepEqual(calls, [], 'no Shop, no special ball, no swap');
});

test('Escape closes a dialog over the menu first, and the run stays paused', () => {
  const { ui } = makeDrawerUi();
  ui.setInputMode = () => {};
  ui.openDrawer();
  ui.elements.modalShop.classList.remove('hidden');
  ui.handleKeyDown({ code: 'Escape', repeat: false });
  assert.equal(ui.elements.modalShop.classList.contains('hidden'), true, 'the dialog closes first');
  assert.equal(ui.isDrawerOpen, true, 'the menu is still open');
  assert.equal(ui.engine.state, 'paused', 'closing the dialog does not resume the run');
  ui.handleKeyDown({ code: 'Escape', repeat: false });
  assert.equal(ui.isDrawerOpen, false, 'the next Escape closes the menu');
  assert.equal(ui.engine.state, 'playing');
});

test('dismissing a Confirm over the menu does not resume the run', () => {
  const { ui } = makeDrawerUi();
  ui.openDrawer();
  ui.elements.modalConfirm.classList.remove('hidden');
  ui.confirmPausedRun = true;
  ui.updateConfirmButtonLabel = () => {};
  ui.dismissConfirm();
  assert.equal(ui.engine.state, 'paused');
  assert.equal(ui.isDrawerOpen, true);
});

test('Escape unwinds Confirm, then Levels, Shop and Settings, then the menu', () => {
  const { ui } = makeDrawerUi();
  ui.setInputMode = () => {};
  ui.openDrawer();
  const layers = ['modalConfirm', 'modalLevels', 'modalShop', 'modalSettings'];
  for (const name of layers) {
    ui.elements[name].classList.remove('hidden');
  }
  ui.dismissConfirm = () => ui.elements.modalConfirm.classList.add('hidden');
  const closedOrder = [];
  for (let i = 0; i < layers.length; i++) {
    ui.handleKeyDown({ code: 'Escape', repeat: false });
    closedOrder.push(layers.find((name) => ui.elements[name].classList.contains('hidden') && !closedOrder.includes(name)));
  }
  assert.deepEqual(closedOrder, layers);
  assert.equal(ui.isDrawerOpen, true, 'the menu closes last');
});

test('a shared Flux link needs a confirmation only over a different saved run', () => {
  const seed = 'a1b2c3';
  assert.equal(isSharedFluxOverSavedRun(seed, { engine: { fluxSeed: 'ffffff' } }), true);
  assert.equal(isSharedFluxOverSavedRun(seed, { engine: { mode: 'campaign' } }), true, 'a campaign run is saved');
  assert.equal(isSharedFluxOverSavedRun(seed, { engine: { fluxSeed: seed } }), false, 'same run: resumed');
  assert.equal(isSharedFluxOverSavedRun(seed, null), false, 'nothing to erase');
  assert.equal(isSharedFluxOverSavedRun(null, { engine: {} }), false, 'no shared link');
});

test('the animation speed cycles through the configured values and wraps to the first', () => {
  const speeds = gameConfig.defaults.animationSpeeds;
  let stored = speeds.at(-1);
  const sentToEngine = [];
  const ui = Object.create(UIManager.prototype);
  ui.gameConfig = gameConfig;
  ui.storageManager = {
    getAnimationSpeed: () => stored,
    setAnimationSpeed: (value) => {
      stored = value;
    }
  };
  ui.engine = { setAnimationSpeed: (value) => sentToEngine.push(value) };
  let refreshed = 0;
  ui.updateAnimSpeedButton = () => {
    refreshed++;
  };
  ui.cycleAnimationSpeed();
  assert.equal(stored, speeds[0], 'the last speed wraps to the first');
  assert.deepEqual(sentToEngine, [speeds[0]]);
  ui.cycleAnimationSpeed();
  assert.equal(stored, speeds[1]);
  assert.deepEqual(sentToEngine, [speeds[0], speeds[1]]);
  assert.equal(refreshed, 2);
});

test('fullscreen controls: hidden when unsupported or already fullscreen, synced on change, WebKit paths', async () => {
  await i18n.init('fr', ['fr', 'en']);
  const makeBtn = (id) => ({
    id,
    textContent: '',
    title: '',
    attributes: {},
    listeners: {},
    classList: makeClassList(),
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    getAttribute(k) {
      return this.attributes[k];
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    closest: () => null
  });
  const makeUi = () => {
    const ui = Object.create(UIManager.prototype);
    ui.gameConfig = gameConfig;
    ui.elements = { btnFullscreen: makeBtn('btn-fullscreen'), btnFullscreenHud: makeBtn('btn-fullscreen-hud') };
    return ui;
  };
  const fullApi = () => ({
    fullscreenEnabled: true,
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    documentElement: { requestFullscreen: () => Promise.resolve() },
    querySelector: () => null
  });
  const prevDoc = globalThis.document;
  const prevWindow = globalThis.window;
  try {
    // No Fullscreen API: the control is hidden and nothing is wired.
    globalThis.document = { documentElement: {}, querySelector: () => null };
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    let ui = makeUi();
    ui.setupFullscreenControl();
    assert.equal(ui.elements.btnFullscreenHud.classList.contains('hidden'), true);
    assert.deepEqual(ui.elements.btnFullscreenHud.listeners, {});

    // Installed in fullscreen display mode: the API exists, the controls stay hidden.
    const asked = [];
    globalThis.document = fullApi();
    globalThis.window = {
      matchMedia: (query) => {
        asked.push(query);
        return { matches: true };
      }
    };
    ui = makeUi();
    ui.setupFullscreenControl();
    assert.deepEqual(asked, [gameConfig.defaults.fullscreenDisplayModeMediaQuery]);
    assert.equal(ui.elements.btnFullscreenHud.classList.contains('hidden'), true, 'already fullscreen: hidden');

    // Without matchMedia the controls are shown, and the state follows fullscreenchange.
    globalThis.window = {};
    globalThis.document = fullApi();
    ui = makeUi();
    ui.setupFullscreenControl();
    assert.equal(ui.elements.btnFullscreenHud.classList.contains('hidden'), false, 'no matchMedia: shown');
    globalThis.document.webkitFullscreenElement = {};
    globalThis.document.listeners.webkitfullscreenchange();
    assert.equal(ui.elements.btnFullscreenHud.getAttribute('aria-pressed'), 'true');
    globalThis.document.webkitFullscreenElement = null;
    globalThis.document.listeners.fullscreenchange();
    assert.equal(ui.elements.btnFullscreenHud.getAttribute('aria-pressed'), 'false');

    // WebKit-prefixed enter and exit.
    let entered = 0;
    let exited = 0;
    let current = null;
    globalThis.document = {
      webkitFullscreenEnabled: true,
      get webkitFullscreenElement() {
        return current;
      },
      documentElement: {
        webkitRequestFullscreen() {
          entered++;
          current = {};
        }
      },
      webkitExitFullscreen() {
        exited++;
        current = null;
      },
      querySelector: () => null
    };
    ui = makeUi();
    await ui.toggleFullscreen();
    assert.equal(entered, 1, 'webkitRequestFullscreen enters');
    assert.equal(ui.elements.btnFullscreen.getAttribute('aria-pressed'), 'true');
    await ui.toggleFullscreen();
    assert.equal(exited, 1, 'webkitExitFullscreen leaves');
    assert.equal(ui.elements.btnFullscreen.getAttribute('aria-pressed'), 'false');
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWindow;
  }
});

test('sticky fullscreen: touch devices re-enter on the next tap after the browser drops fullscreen', async () => {
  await i18n.init('fr', ['fr', 'en']);
  const makeBtn = (id) => ({
    id,
    attributes: {},
    classList: makeClassList(),
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    getAttribute(k) {
      return this.attributes[k];
    },
    addEventListener() {},
    closest: () => null
  });
  const makeEnv = ({ coarse = true, displayMode = false, rejectRequests = false } = {}) => {
    const env = { current: null, requests: 0, listeners: {}, fire: null };
    env.doc = {
      fullscreenEnabled: true,
      get fullscreenElement() {
        return env.current;
      },
      listeners: env.listeners,
      addEventListener(type, fn) {
        (env.listeners[type] ||= []).push(fn);
      },
      removeEventListener(type, fn) {
        env.listeners[type] = (env.listeners[type] || []).filter((f) => f !== fn);
      },
      documentElement: {
        requestFullscreen() {
          env.requests++;
          if (rejectRequests) {
            return Promise.reject(new Error('denied'));
          }
          env.current = {};
          return Promise.resolve();
        }
      },
      exitFullscreen() {
        env.current = null;
        env.fire('fullscreenchange');
        return Promise.resolve();
      },
      querySelector: () => null
    };
    env.fire = (type, event = {}) => [...(env.listeners[type] || [])].forEach((fn) => fn(event));
    env.window = {
      matchMedia: (query) => ({
        matches:
          query === gameConfig.defaults.coarsePointerMediaQuery
            ? coarse
            : query === gameConfig.defaults.fullscreenDisplayModeMediaQuery && displayMode
      })
    };
    return env;
  };
  const makeUi = () => {
    const ui = Object.create(UIManager.prototype);
    ui.gameConfig = gameConfig;
    ui.elements = { btnFullscreen: makeBtn('btn-fullscreen'), btnFullscreenHud: makeBtn('btn-fullscreen-hud') };
    return ui;
  };
  const browserDrops = (env) => {
    env.current = null;
    env.fire('fullscreenchange');
  };
  const tap = async (env, type = 'pointerup', event = {}) => {
    env.fire(type, event);
    await new Promise((resolve) => setImmediate(resolve));
  };
  const prevDoc = globalThis.document;
  const prevWindow = globalThis.window;
  try {
    const setup = async (options) => {
      const env = makeEnv(options);
      globalThis.document = env.doc;
      globalThis.window = env.window;
      const ui = makeUi();
      ui.setupFullscreenControl();
      return { env, ui };
    };

    // Button on, browser drop, next pointerup re-requests; listeners are removed once granted.
    let { env, ui } = await setup();
    await ui.toggleFullscreen();
    assert.equal(env.requests, 1);
    browserDrops(env);
    assert.equal(env.listeners.pointerup.length, 1, 'armed after the drop');
    assert.equal(env.listeners.keydown.length, 1);
    await tap(env);
    assert.equal(env.requests, 2, 'pointerup re-requests fullscreen');
    assert.equal(env.listeners.pointerup.length, 0, 'disarmed after success');
    assert.equal(ui.elements.btnFullscreen.getAttribute('aria-pressed'), 'true');

    // keydown also re-enters.
    ({ env, ui } = await setup());
    await ui.toggleFullscreen();
    browserDrops(env);
    await tap(env, 'keydown');
    assert.equal(env.requests, 2, 'keydown re-requests fullscreen');

    // Button off: its own exit and a later browser exit never arm anything.
    ({ env, ui } = await setup());
    await ui.toggleFullscreen();
    await ui.toggleFullscreen();
    assert.equal(env.current, null);
    assert.equal((env.listeners.pointerup || []).length, 0, 'the button exit does not arm');
    env.fire('fullscreenchange');
    assert.equal((env.listeners.pointerup || []).length, 0);
    await tap(env);
    assert.equal(env.requests, 1, 'no re-entry after the player turned it off');

    // Desktop (fine pointer): Escape stays final.
    ({ env, ui } = await setup({ coarse: false }));
    await ui.toggleFullscreen();
    browserDrops(env);
    assert.equal((env.listeners.pointerup || []).length, 0);
    await tap(env);
    assert.equal(env.requests, 1);

    // Fullscreen display mode: nothing is wired or armed.
    ({ env, ui } = await setup({ displayMode: true }));
    await ui.toggleFullscreen();
    browserDrops(env);
    assert.equal((env.listeners.pointerup || []).length, 0);
    assert.equal(env.requests, 1);

    // A rejected request keeps the listener so the next tap retries.
    ({ env, ui } = await setup({ rejectRequests: true }));
    await ui.toggleFullscreen();
    browserDrops(env);
    await tap(env);
    assert.equal(env.requests, 2);
    assert.equal(env.listeners.pointerup.length, 1, 'still armed after a rejection');
    await tap(env);
    assert.equal(env.requests, 3, 'second tap retries');

    // Taps on a fullscreen button, Escape and auto-repeat never request, and stay armed.
    ({ env, ui } = await setup());
    await ui.toggleFullscreen();
    browserDrops(env);
    const hudTarget = {};
    ui.elements.btnFullscreenHud.contains = (node) => node === hudTarget;
    await tap(env, 'pointerup', { target: hudTarget });
    await tap(env, 'keydown', { key: 'Escape' });
    await tap(env, 'keydown', { key: 'a', repeat: true });
    assert.equal(env.requests, 1, 'ignored gestures do not request');
    assert.equal(env.listeners.pointerup.length, 1, 'still armed');
    assert.equal(env.listeners.keydown.length, 1);

    // fullscreenchange firing twice never registers duplicate listeners.
    ({ env, ui } = await setup());
    await ui.toggleFullscreen();
    browserDrops(env);
    env.fire('fullscreenchange');
    assert.equal(env.listeners.pointerup.length, 1);
    assert.equal(env.listeners.keydown.length, 1);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWindow;
  }
});

test('Flux perk digits pick the matching card and never equip a special ball', () => {
  const ui = Object.create(UIManager.prototype);
  const chosen = [];
  const equipped = [];
  const classes = new Set();
  const perkModal = {
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name)
    }
  };
  ui.setInputMode = () => {};
  ui.isDrawerOpen = false;
  ui.elements = { modalFluxPerk: perkModal };
  ui.getActiveTopModal = () => perkModal;
  ui.isAnyModalOpen = () => true;
  ui.engine = {
    state: 'playing',
    fluxPerkOffer: ['reserve', 'blast', 'golden'],
    chooseFluxPerk: (id) => chosen.push(id),
    equipSpecialBall: (type) => equipped.push(type)
  };
  const press = (code, extra = {}) => ui.handleKeyDown({ code, repeat: false, preventDefault() {}, ...extra });
  press('Digit2');
  press('Digit3');
  press('Digit4');
  press('Digit1', { ctrlKey: true });
  assert.deepEqual(chosen, ['blast', 'golden'], 'digits pick cards; a digit past the offer and Ctrl+digit do nothing');
  assert.deepEqual(equipped, [], 'no special ball is equipped under the perk choice');

  classes.add('hidden');
  ui.isAnyModalOpen = () => false;
  assert.equal(ui.isFluxPerkModalTop(), false, 'a hidden perk dialog does not capture the digits');
});

test('refresh keeps the one-shot extras out of lastExtra', () => {
  const { oneShot, persistentExtra } = splitRefreshExtra({
    fluxPerkChosen: 'blast',
    fluxStageCleared: 3,
    unlockedAchievementIds: ['a1', 'a2'],
    gameOverReason: 'x'
  });
  assert.deepEqual(persistentExtra, { gameOverReason: 'x' });
  assert.deepEqual(oneShot, {
    unlockedAchievementIds: ['a1', 'a2'],
    fluxStageCleared: 3,
    classicStageCleared: undefined,
    fluxPerkChosen: 'blast'
  });
  assert.equal(splitRefreshExtra({ classicStageCleared: 2 }).oneShot.classicStageCleared, 2);
});

test('Flux perk helpers map keys, values and held perks', async () => {
  const { fluxPerkIndexForKey, fluxPerkDisplayValue, listActiveFluxPerks, isFluxPerkChoiceVisible } = await import(
    '../src/ui/FluxPerkView.js'
  );
  assert.equal(fluxPerkIndexForKey('Digit1', 3), 0);
  assert.equal(fluxPerkIndexForKey('Digit3', 3), 2);
  assert.equal(fluxPerkIndexForKey('Digit3', 2), -1);
  assert.equal(fluxPerkIndexForKey('KeyF', 3), -1);
  assert.equal(fluxPerkIndexForKey('Digit0', 3), -1);
  assert.equal(fluxPerkDisplayValue({ step: 6 }), '6');
  assert.equal(fluxPerkDisplayValue({ step: 0.15, unit: 'percent' }), '15');
  assert.equal(fluxPerkDisplayValue({ step: 6 }), '6', 'counts are shown as they are');

  const catalog = { reserve: { step: 6, maxStacks: 3, icon: 'R' }, blast: { step: 0.1, maxStacks: 3, icon: 'B' } };
  const engine = {
    mode: 'flux',
    state: 'playing',
    fluxConfig: { perks: { order: ['reserve', 'blast'], catalog } },
    fluxPerks: { blast: 2 },
    isAwaitingPerk: () => true
  };
  assert.deepEqual(listActiveFluxPerks(engine), [{ id: 'blast', stacks: 2, max: 3 }]);
  assert.deepEqual(listActiveFluxPerks({ ...engine, mode: 'campaign' }), [], 'no chips outside Flux');
  assert.equal(isFluxPerkChoiceVisible(engine), true);
  assert.equal(isFluxPerkChoiceVisible({ ...engine, state: 'paused' }), false, 'Escape pause hides the choice');
});

test('a Flux run past the first shape always asks before it is abandoned', () => {
  const ui = Object.create(UIManager.prototype);
  const classes = new Set(['hidden']);
  let ran = false;
  ui.isRunActive = () => true;
  ui.isAnyModalOpen = () => false;
  ui.saveLastFocusedElement = () => {};
  ui.updateConfirmButtonLabel = () => {};
  ui.syncModalInertState = () => {};
  ui.elements = {
    modalConfirm: {
      classList: { add: (n) => classes.add(n), remove: (n) => classes.delete(n), contains: (n) => classes.has(n) }
    }
  };
  ui.engine = { mode: 'flux', fluxStage: 4, hasFiredInRound: false, state: 'paused', physicsWorld: { balls: [{}] } };
  ui.requestDestructiveAction(() => {
    ran = true;
  });
  assert.equal(ran, false, 'the action waits for the Confirm');
  assert.equal(classes.has('hidden'), false, 'the Confirm is open');

  classes.add('hidden');
  ui.engine.fluxStage = 1;
  ui.requestDestructiveAction(() => {
    ran = true;
  });
  assert.equal(ran, true, 'the first shape with no shot fired restarts without asking');
});

test('the Flux perk subtitle has one wording per input mode and the touch one names no key', () => {
  const subtitleTag = indexHtml.match(/<p id="modal-flux-perk-subtitle"[^>]*>/)[0];
  assert.doesNotMatch(subtitleTag, /data-i18n/, 'the subtitle is written by updateInputHints');
  for (const lang of SUPPORTED) {
    const { subtitle } = loadJson(`./locales/${lang}.json`).modals.fluxPerk;
    assert.ok(subtitle.pointer && subtitle.touch);
    assert.notEqual(subtitle.pointer, subtitle.touch);
    assert.doesNotMatch(subtitle.touch, /\d/, `${lang}: touch text names no number key`);
  }
});

test('the Flux perk dialog is shown, hidden by the pause and restored with focus', async () => {
  await i18n.init('en', ['en']);
  const makeNode = () => ({
    dataset: {},
    attributes: {},
    children: [],
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    focus() {
      globalThis.globalThis.document.activeElement = this;
    }
  });
  const makeClassList = (initial) => {
    const set = new Set(initial);
    return { contains: (n) => set.has(n), add: (n) => set.add(n), remove: (n) => set.delete(n) };
  };
  const cards = {
    ...makeNode(),
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    get firstElementChild() {
      return this.children[0];
    }
  };
  const modal = {
    classList: makeClassList(['hidden']),
    inert: false,
    contains: (el) => cards.children.includes(el),
    querySelectorAll: () => [],
    setAttribute() {},
    removeAttribute() {}
  };
  const pauseModal = {
    classList: makeClassList(['hidden']),
    inert: false,
    contains: () => false,
    querySelectorAll: () => [],
    setAttribute() {},
    removeAttribute() {}
  };
  const appShell = { inert: false, setAttribute() {}, removeAttribute() {} };
  const boardElement = { ...makeNode(), closest: () => null };
  const resumeButton = { ...makeNode(), closest: () => ({}) };
  const prevDoc = globalThis.document;
  globalThis.document = {
    activeElement: boardElement,
    body: {},
    documentElement: {},
    createElement: makeNode
  };
  try {
    const ui = Object.create(UIManager.prototype);
    ui.inputMode = INPUT_MODES.TOUCH;
    ui.elements = { modalFluxPerk: modal, fluxPerkCards: cards, appShell };
    ui.getModalsByPriority = () => [pauseModal, modal];
    const engine = {
      mode: 'flux',
      state: 'playing',
      fluxPerkOffer: ['reserve', 'blast'],
      fluxConfig: {
        perks: {
          catalog: {
            reserve: { step: 6, maxStacks: 3, icon: 'R' },
            blast: { step: 0.1, unit: 'percent', maxStacks: 3, icon: 'B' }
          }
        }
      },
      isAwaitingPerk() {
        return Array.isArray(this.fluxPerkOffer);
      },
      getFluxPerkStacks: () => 0
    };
    const sync = () => {
      syncFluxPerkModal.call(ui, engine);
      ui.syncModalInertState();
    };

    sync();
    assert.equal(modal.classList.contains('hidden'), false, 'shown while playing with an offer');
    assert.equal(globalThis.document.activeElement, cards.firstElementChild, 'focus lands on the first card');
    assert.equal(appShell.inert, true, 'the board is inert behind the choice');
    assert.equal(cards.children[0].attributes['aria-keyshortcuts'], undefined, 'touch cards name no key');
    assert.equal(cards.children[0].children[3].attributes['aria-label'], t('modals.fluxPerk.stackAria', { stacks: '1', max: '3' }));

    engine.state = 'paused';
    pauseModal.classList.remove('hidden');
    sync();
    assert.equal(modal.classList.contains('hidden'), true, 'hidden under the pause');

    engine.state = 'playing';
    globalThis.document.activeElement = resumeButton;
    pauseModal.classList.add('hidden');
    sync();
    assert.equal(modal.classList.contains('hidden'), false, 'shown again after Resume');
    assert.equal(ui.lastFocusedElement, boardElement, 'the dialog behind Resume is not saved as the focus target');

    engine.fluxPerkOffer = null;
    sync();
    assert.equal(modal.classList.contains('hidden'), true, 'hidden after the pick');
    assert.equal(modal.inert, false);
    assert.equal(appShell.inert, false, 'the board is reachable again');
    assert.equal(globalThis.document.activeElement, boardElement, 'focus returns to a visible element');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('special ammo is held with a reason while the engine refuses a purchase', () => {
  const ui = Object.create(UIManager.prototype);
  ui.isRunActive = () => true;
  ui.engine = { mode: 'campaign', canBuySpecialAmmo: () => false, getSpecialAmmoBlockReason: () => 'shotInFlight' };
  assert.equal(ui.canBuySpecialAmmo(), false);
  assert.equal(ui.getSpecialAmmoBlockReasonKey(), 'modals.shop.specialAmmo.blocked.shotInFlight');
  ui.engine.getSpecialAmmoBlockReason = () => 'stageChanging';
  assert.equal(ui.getSpecialAmmoBlockReasonKey(), 'modals.shop.specialAmmo.blocked.stageChanging');
  ui.engine = { mode: 'campaign', canBuySpecialAmmo: () => true, getSpecialAmmoBlockReason: () => null };
  assert.equal(ui.canBuySpecialAmmo(), true, 'buy buttons re-enable as soon as the state allows');
  assert.equal(ui.getSpecialAmmoBlockReasonKey(), null);
  for (const lang of ['en', 'fr']) {
    const specialAmmo = loadJson(`./locales/${lang}.json`).modals.shop.specialAmmo;
    assert.ok(specialAmmo.blockedLabel && specialAmmo.blocked.shotInFlight && specialAmmo.blocked.stageChanging, lang);
  }
});

test('NumpadEnter shoots like Enter and keeps the repeat guard', () => {
  assert.equal(shouldIgnoreRepeatedKey('NumpadEnter', true), true);
  const ui = Object.create(UIManager.prototype);
  let shots = 0;
  ui.setInputMode = () => {};
  ui.isAnyModalOpen = () => false;
  ui.elements = {};
  ui.updateAimState = () => {};
  ui.engine = { state: 'playing', shoot: () => { shots += 1; } };
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null, body: {}, documentElement: {} };
  try {
    ui.handleKeyDown({ code: 'NumpadEnter', repeat: false, preventDefault() {} });
    ui.handleKeyDown({ code: 'NumpadEnter', repeat: true, preventDefault() {} });
    assert.equal(shots, 1, 'a held NumpadEnter fires once');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('tilt toggle is disabled with a reason while the engine locks tilt', () => {
  const makeBtn = () => ({
    id: 'btn-tilt',
    attrs: {},
    disabled: false,
    textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; }
  });
  const ui = Object.create(UIManager.prototype);
  const btn = makeBtn();
  ui.elements = { btnTilt: btn };
  ui.isTiltActive = true;
  ui.engine = { isTiltLocked: () => true };
  const prevDoc = globalThis.document;
  globalThis.document = { querySelector: () => null };
  try {
    ui.updateTiltButton();
    assert.equal(btn.disabled, true);
    assert.equal(btn.attrs['aria-disabled'], 'true');
    assert.equal(btn.title, t('app.nav.button.tiltLockedAria'));
    assert.equal(ui.isTiltActive, true, 'the preference is untouched');
    ui.engine.isTiltLocked = () => false;
    ui.updateTiltButton();
    assert.equal(btn.disabled, false);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('the same-seed retry button restarts the run with its shared status', () => {
  const calls = [];
  const ui = Object.create(UIManager.prototype);
  ui.hideAllModals = () => calls.push('hide');
  ui.engine = { fluxSeed: 'ab12cd', isSharedFluxRun: true, startFluxRun: (...args) => calls.push(args) };
  ui.retrySameFluxSeed();
  assert.deepEqual(calls, ['hide', ['ab12cd', { isShared: true }]]);

  calls.length = 0;
  ui.engine.isSharedFluxRun = false;
  ui.retrySameFluxSeed();
  assert.deepEqual(calls[1], ['ab12cd', { isShared: false }]);

  calls.length = 0;
  ui.engine.fluxSeed = null;
  ui.retrySameFluxSeed();
  assert.deepEqual(calls, [], 'no seed, no restart');
});

test('a typed Flux seed starts a shared run', () => {
  const started = [];
  const ui = Object.create(UIManager.prototype);
  ui.elements = { inputFluxSeed: { value: '#AB12CD' } };
  ui.engine = {
    fluxConfig: loadJson('./configs/flux.json'),
    startFluxRun: (...args) => started.push(args)
  };
  ui.hideAllModals = () => {};
  ui.requestDestructiveAction = (action) => action();
  ui.submitFluxSeedInput();
  assert.deepEqual(started, [['ab12cd', { isShared: true }]]);
  assert.equal(ui.elements.inputFluxSeed.value, '');
});

const makeFakePowerupButton = (type) => {
  const attrs = {};
  const classes = new Set();
  return {
    dataset: { specialType: type },
    disabled: false,
    attrs,
    classList: {
      toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name)
    },
    setAttribute: (k, v) => {
      attrs[k] = String(v);
    },
    getAttribute: (k) => attrs[k] ?? null,
    removeAttribute: (k) => {
      delete attrs[k];
    }
  };
};

const refreshPowerupsWith = ({ engineState, isRunActive = true }) => {
  const type = SPECIAL_TYPES_ORDER[0];
  const btn = makeFakePowerupButton(type);
  const ui = Object.create(UIManager.prototype);
  ui.isRunActive = () => isRunActive;
  ui.elements = { powerupsContainer: { querySelectorAll: () => [btn] } };
  ui.engine = {
    mode: 'campaign',
    specialInventory: { [type]: 0 },
    currentBall: null,
    canBuySpecialAmmo: () => engineState.canBuy,
    getSpecialAmmoBlockReason: () => engineState.reason
  };
  const prevDoc = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    ui.updatePowerupButtons(ui.engine);
  } finally {
    globalThis.document = prevDoc;
  }
  return { btn, type };
};

test('power-up tooltips survive a refresh, and a held slot keeps the empty look without flicker', () => {
  const free = refreshPowerupsWith({ engineState: { canBuy: true, reason: null } });
  assert.equal(free.btn.attrs.title, t(`hud.powerups.${free.type}.tooltip`), 'the tooltip is restored');
  assert.equal(free.btn.attrs['aria-disabled'], 'false');
  assert.equal(free.btn.classList.contains('is-empty'), true);

  const held = refreshPowerupsWith({ engineState: { canBuy: false, reason: 'shotInFlight' } });
  assert.equal(held.btn.classList.contains('is-empty'), true, 'the empty look does not flicker with the shot');
  assert.equal(held.btn.disabled, false, 'the button stays focusable');
  assert.equal(held.btn.attrs['aria-disabled'], 'true');
  assert.equal(held.btn.attrs.title, t('modals.shop.specialAmmo.blocked.shotInFlight'));
  assert.ok(held.btn.attrs['aria-label'].endsWith(t('modals.shop.specialAmmo.blocked.shotInFlight')));

  const idle = refreshPowerupsWith({ engineState: { canBuy: false, reason: null }, isRunActive: false });
  assert.equal(idle.btn.disabled, true, 'between runs an empty button stays inert');
  assert.equal(idle.btn.attrs.title, t(`hud.powerups.${idle.type}.tooltip`));
});

function fakeClassList(initial = []) {
  const classes = new Set(initial);
  return {
    classes,
    contains: (name) => classes.has(name),
    remove: (name) => classes.delete(name),
    add: (name) => classes.add(name),
    toggle: (name, force) => (force ? classes.add(name) : classes.delete(name))
  };
}

test('the discovery pulse target maps to the polarity button or one special slot', () => {
  assert.deepEqual(resolvePulseTargets('polarity'), { polarity: true, specialType: null });
  assert.deepEqual(resolvePulseTargets('special:bomb'), { polarity: false, specialType: 'bomb' });
  assert.deepEqual(resolvePulseTargets(null), { polarity: false, specialType: null });
  assert.deepEqual(resolvePulseTargets('special:'), { polarity: false, specialType: null });

  const ui = Object.create(UIManager.prototype);
  const polarityBtn = { classList: fakeClassList() };
  const slots = ['bomb', 'lightning'].map((type) => ({ dataset: { specialType: type }, classList: fakeClassList() }));
  ui.elements = { polarityBtn, powerupsContainer: { querySelectorAll: () => slots } };
  ui.updateDiscoveryPulse({ getDiscoveryPulseTarget: () => 'special:lightning' });
  assert.equal(polarityBtn.classList.contains(DISCOVERY_PULSE_CLASS), false);
  assert.equal(slots[0].classList.contains(DISCOVERY_PULSE_CLASS), false);
  assert.equal(slots[1].classList.contains(DISCOVERY_PULSE_CLASS), true);
  ui.updateDiscoveryPulse({ getDiscoveryPulseTarget: () => 'polarity' });
  assert.equal(polarityBtn.classList.contains(DISCOVERY_PULSE_CLASS), true);
  assert.equal(slots[1].classList.contains(DISCOVERY_PULSE_CLASS), false);
  ui.updateDiscoveryPulse({});
  assert.equal(polarityBtn.classList.contains(DISCOVERY_PULSE_CLASS), false, 'an engine without a target pulses nothing');
});

test('the pulse keeps an outline so it still reads without motion', () => {
  const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
  const rule = css.match(/\.discovery-pulse\s*\{[^}]*\}/);
  assert.ok(rule, 'a .discovery-pulse rule exists');
  assert.match(rule[0], /outline:/);
  assert.match(rule[0], /animation:/);
});

test('the "?" button shows only when the level has hints and calls the replay', () => {
  const ui = Object.create(UIManager.prototype);
  const button = { classList: fakeClassList(['hidden']) };
  ui.elements = { hintReplayBtn: button };
  ui.updateHintReplayButton({ hasLevelHints: () => true, state: GAME_STATES.PLAYING });
  assert.equal(button.classList.contains('hidden'), false);
  ui.updateHintReplayButton({ hasLevelHints: () => false, state: GAME_STATES.PLAYING });
  assert.equal(button.classList.contains('hidden'), true);
  ui.updateHintReplayButton({});
  assert.equal(button.classList.contains('hidden'), true, 'an engine without hints hides it');

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-hint-replay"[^>]*data-i18n-aria-label="hud\.hints\.replayAria"/);
  const source = readFileSync(new URL('../src/ui/UIInputBindings.js', import.meta.url), 'utf8');
  assert.match(source, /hintReplayBtn\?\.addEventListener\('click'[\s\S]{0,80}replayLevelHints/);
});

test('the objective banner shows the level, shots and mechanic, announces once and dismisses on the first shot', async () => {
  const previousLocale = i18n.currentLocale;
  i18n.dictionaries.set('en', JSON.parse(readFileSync('./locales/en.json', 'utf8')));
  i18n.currentLocale = 'en';
  const intro = {
    levelId: 2,
    summary: { id: 2, isGenerated: false, nameKey: 'levels.items.lvl2.name' },
    maxShots: 12,
    featuredMechanicId: 'bumper'
  };
  const levelName = t('levels.items.lvl2.name');
  const bumperName = resolveMechanicName('bumper', t);
  const plain = (name) => t('hud.levelIntro.summaryPlain', { id: 2, name, shots: 12 });
  assert.ok(bumperName);
  assert.equal(
    buildLevelIntroText(intro, t),
    t('hud.levelIntro.summary', { id: 2, name: levelName, shots: 12, mechanic: bumperName })
  );
  assert.ok(resolveMechanicName('basics', t), 'the basics have a name too');
  assert.equal(buildLevelIntroText({ ...intro, featuredMechanicId: null }, t), plain(levelName));
  assert.equal(
    buildLevelIntroText({ ...intro, featuredMechanicId: 'basics' }, t),
    plain(levelName),
    'the basics are never the focus'
  );
  assert.equal(
    buildLevelIntroText({ ...intro, featuredMechanicId: 'pivot' }, t),
    plain(levelName),
    'a mechanic the level name already says is not repeated'
  );

  const ui = Object.create(UIManager.prototype);
  const announced = [];
  ui.announce = (message) => announced.push(message);
  const banner = { classList: fakeClassList(['hidden']) };
  ui.elements = { levelIntroBanner: banner, levelIntroText: { textContent: '' } };
  const dismissed = [];
  const engine = {
    state: GAME_STATES.PLAYING,
    levelIntro: intro,
    shotsRemaining: 12,
    dismissLevelIntro: () => dismissed.push(true)
  };
  ui.updateLevelIntro(engine);
  ui.updateLevelIntro(engine);
  assert.equal(banner.classList.contains('hidden'), false);
  assert.equal(announced.length, 1, 'announced once');
  assert.equal(ui.elements.levelIntroText.textContent, announced[0]);
  assert.equal(announced.length, 1, 'announced once');
  engine.shotsRemaining = 11;
  ui.updateLevelIntro(engine);
  assert.equal(dismissed.length, 1, 'the first shot dismisses it');
  assert.equal(banner.classList.contains('hidden'), true);
  engine.levelIntro = null;
  ui.updateLevelIntro(engine);
  assert.equal(banner.classList.contains('hidden'), true);
  i18n.currentLocale = previousLocale;
});

test('hint copy names the 🧲 button, covers every special and tells the truth about polarity', () => {
  const balls = JSON.parse(readFileSync(new URL('../configs/balls.json', import.meta.url), 'utf8'));
  for (const locale of ['en', 'fr']) {
    const data = JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'));
    const tutorial = data.gameplay.tutorial;
    for (const inputMode of Object.values(INPUT_MODES)) {
      assert.ok(tutorial.polarity[inputMode].includes('🧲'), `${locale} ${inputMode} polarity hint`);
    }
    assert.match(tutorial.polarity[INPUT_MODES.POINTER], /[ (]F[) ]/, `${locale} pointer hint names the key`);
    assert.doesNotMatch(tutorial.polarity[INPUT_MODES.TOUCH], /[ (]F[) ]/, `${locale} touch hint names no key`);
    assert.ok(tutorial.bankShot);
    for (const type of Object.keys(balls.specialTypes)) {
      assert.ok(tutorial.specials[type], `${locale} hint for special ${type}`);
    }
    const codex = data.modals.shop.codex.mechanics.polarity.description;
    assert.doesNotMatch(codex, /attractors repel|attracteurs repoussent/i);
  }
});

test('near-miss, best-run marker and streak grace texts are informational and localized', () => {
  const TODAY_KEY = '2026-11-05';
  const previous = i18n.currentLocale;
  try {
    for (const locale of ['en', 'fr']) {
      i18n.dictionaries.set(locale, loadJson(`./locales/${locale}.json`));
      i18n.currentLocale = locale;
      assert.equal(formatNearMissText(null), '');
      assert.equal(formatNearMissText({ metric: 'stage', current: 5, best: 5, gap: 0 }), '');
      assert.equal(formatNearMissText({ metric: 'unknown', gap: 3 }), '');
      assert.ok(formatNearMissText({ metric: 'stage', gap: 2 }).includes('2'));
      assert.ok(formatNearMissText({ metric: 'wave', gap: 1 }).includes('1'));
      assert.ok(formatNearMissText({ metric: 'score', gap: 1200 }).includes(i18n.formatNumber(1200)));
      assert.notEqual(
        formatNearMissText({ metric: 'wave', gap: 1 }),
        formatNearMissText({ metric: 'wave', gap: 2 }).replace('2', '1'),
        'singular and plural forms differ'
      );
      assert.equal(formatBestRunMarker(null), '');
      assert.equal(formatBestRunMarker({ metric: 'wave', best: 0 }), '');
      assert.ok(formatBestRunMarker({ metric: 'stage', best: 12 }).includes('12'));
      assert.equal(formatBestRunMarker({ metric: 'score', best: 5000 }), '', 'score modes already show it');
      assert.equal(formatStreakGraceText(0, { available: true }, TODAY_KEY), '');
      assert.equal(formatStreakGraceText(3, undefined, TODAY_KEY), '');
      const available = formatStreakGraceText(3, { available: true, usedOn: null }, TODAY_KEY);
      const usedToday = formatStreakGraceText(3, { available: false, usedOn: TODAY_KEY }, TODAY_KEY);
      const returning = formatStreakGraceText(
        3,
        { available: false, usedOn: '2026-11-01', daysUntilAvailable: 3 },
        TODAY_KEY
      );
      assert.notEqual(available, '');
      assert.notEqual(usedToday, '');
      assert.notEqual(usedToday, available);
      assert.ok(returning.includes('3'), 'says when the grace comes back');
      assert.notEqual(returning, usedToday, 'a grace used on an earlier day is not "used" news today');
      assert.equal(formatStreakGraceText(3, { available: false, usedOn: null, daysUntilAvailable: 0 }, TODAY_KEY), '');
    }
    i18n.currentLocale = 'en';
    assert.equal(formatNearMissText({ metric: 'stage', gap: 2 }), '2 shapes short of your best');
    assert.equal(formatNearMissText({ metric: 'score', gap: 1200 }), '1,200 points short of your best');
  } finally {
    i18n.currentLocale = previous;
  }
});

test('the near-miss line sits with the stats, away from the continue and coin buttons', () => {
  const modal = elementMarkup(indexHtml, 'modal-gameover');
  const nearMissAt = modal.indexOf('id="gameover-near-miss"');
  const stageAt = modal.indexOf('id="gameover-stage"');
  const actionsStart = modal.indexOf('id="btn-continue-gameover"');
  assert.ok(nearMissAt > stageAt, 'follows the stage summary');
  assert.ok(nearMissAt < actionsStart, 'comes before every action button');
  const continueButton = elementMarkup(modal, 'btn-continue-gameover');
  assert.doesNotMatch(continueButton, /near-miss/);
  assert.match(uiManagerCode, /formatNearMissText\(summary\?\.nearMiss\)/);
  assert.doesNotMatch(uiManagerCode, /continueShots[^;]*nearMiss/);
  assert.match(
    uiManagerCode,
    /t\('hud\.announcer\.round\.withNearMiss', \{ result: roundResult, nearMiss: nearMissText \}\)/,
    'the near miss is announced with the round result'
  );
});

test('the HUD best-run marker is wired once, in the badges row, without overflowing', () => {
  assert.match(indexHtml, /id="hud-best-run" class="hud-badge best-run hidden"/);
  assert.match(uiManagerCode, /formatBestRunMarker\(engine\.getRunBestMarker\?\.\(\)\)/);
  assert.doesNotMatch(uiManagerCode, /\$\{bestRunText\}/, 'the phone compact line does not repeat it');
  const css = readFileSync('./styles/main.css', 'utf8');
  assert.match(css, /\.hud-badge\.best-run \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
  assert.doesNotMatch(css, /\.hud-badge\.best-run,/, 'the badge stays visible in the phone HUD');
});

test('achievements group into tier families and tiers read the family record', () => {
  const groups = groupAchievementTiers(Object.entries(gameConfig.achievements));
  const avalanche = groups.find((group) => group.familyId === 'firstAvalanche');
  assert.deepEqual(avalanche.tiers.map((tier) => tier.tier), ['bronze', 'silver', 'gold']);
  assert.equal(avalanche.tiers[0].id, 'firstAvalanche', 'the original id is the bronze tier');
  const total = groups.reduce((sum, group) => sum + group.tiers.length, 0);
  assert.equal(total, Object.keys(gameConfig.achievements).length, 'every achievement is in one family');
  const shuffled = groupAchievementTiers([
    ['xGold', { tierOf: 'x', tier: 'gold' }],
    ['solo', {}],
    ['x', { tierOf: 'x', tier: 'bronze' }]
  ]);
  assert.deepEqual(shuffled.map((group) => group.familyId), ['x', 'solo']);
  assert.deepEqual(shuffled[0].tiers.map((tier) => tier.id), ['x', 'xGold']);
  assert.deepEqual(
    computeAchievementProgress('comboMasterSilver', gameConfig.achievements.comboMasterSilver, false, { maxCombo: 5 }),
    { current: 5, target: gameConfig.achievements.comboMasterSilver.threshold, pct: 71 }
  );
  assert.equal(
    computeAchievementProgress('fluxShapesSilver', gameConfig.achievements.fluxShapesSilver, false, { fluxStage: 7 }).current,
    7
  );
  assert.equal(
    computeAchievementProgress('bossRushWaves', gameConfig.achievements.bossRushWaves, false, { bossRushWave: 2 }).current,
    2
  );
});

test('every achievement id has an English and French name and description, and tier labels exist', () => {
  for (const locale of ['en', 'fr']) {
    const data = loadJson(`./locales/${locale}.json`);
    const { items, tier } = data.modals.shop.achievements;
    for (const id of Object.keys(gameConfig.achievements)) {
      assert.ok(items[id]?.name && items[id]?.description, `${locale}: ${id} has a name and description`);
    }
    assert.deepEqual(Object.keys(tier), ['bronze', 'silver', 'gold']);
  }
});

const workshopViewCode = readFileSync('./src/ui/WorkshopView.js', 'utf8');

test('every achievement description takes its goal from {{target}} and holds no other number', () => {
  for (const locale of ['en', 'fr']) {
    const { items } = loadJson(`./locales/${locale}.json`).modals.shop.achievements;
    for (const id of Object.keys(gameConfig.achievements)) {
      const { description } = items[id];
      assert.ok(description.includes('{{target}}'), `${locale}: ${id} uses {{target}}`);
      assert.doesNotMatch(description.replace('{{target}}', ''), /\d/, `${locale}: ${id} has no literal number`);
    }
  }
});

test('achievement descriptions render the configured threshold', () => {
  const previous = i18n.currentLocale;
  try {
    i18n.dictionaries.set('en', loadJson('./locales/en.json'));
    i18n.currentLocale = 'en';
    const spec = gameConfig.achievements.comboMasterSilver;
    assert.equal(
      formatAchievementDescription('comboMasterSilver', spec),
      `Reach a x${spec.threshold} or higher Combo multiplier.`
    );
    assert.match(
      formatAchievementDescription('bossSlayerSilver', gameConfig.achievements.bossSlayerSilver),
      /in a single run/
    );
  } finally {
    i18n.currentLocale = previous;
  }
  assert.match(workshopViewCode, /formatAchievementDescription\(shown\.id, shown\.spec\)/);
});

test('a locked tier whose record is already past it asks for a new run, and the tier list needs 2+ tiers', () => {
  assert.match(workshopViewCode, /const isRecordPastTarget = !isComplete && !shown\.spec\.cumulative && current >= target;/);
  assert.match(workshopViewCode, /t\('modals\.shop\.achievements\.reachAgain'\)/);
  assert.match(workshopViewCode, /if \(tiers\.length > 1\) \{\s*tierRow = document\.createElement\('div'\);/);
  for (const locale of ['en', 'fr']) {
    assert.ok(loadJson(`./locales/${locale}.json`).modals.shop.achievements.reachAgain);
  }
  assert.equal(loadJson('./locales/fr.json').modals.shop.achievements.reachAgain, 'À refaire en une partie');
});

test('tier colors are defined in every contrast theme', () => {
  const css = readFileSync('./styles/main.css', 'utf8');
  const highContrast = css.slice(css.indexOf(':root.high-contrast {'));
  const moreContrast = css.slice(css.indexOf('@media (prefers-contrast: more)'));
  for (const token of ['--tier-bronze', '--tier-silver']) {
    assert.match(highContrast.slice(0, highContrast.indexOf('}')), new RegExp(token));
    assert.match(moreContrast.slice(0, moreContrast.indexOf('\n  }')), new RegExp(token));
  }
});

const DAILY_INTRO_TEST_SEED = '2026-11-08';

test('Daily mutator intro banner, completed chapter summary, and collectorMagnet upgrade are localized and wired', () => {
  const previous = i18n.currentLocale;
  try {
    for (const lang of SUPPORTED) {
      const locale = loadJson(`./locales/${lang}.json`);
      i18n.dictionaries.set(lang, locale);
      i18n.currentLocale = lang;

      assert.deepEqual(
        placeholdersOf(locale.modals.shop.upgrades.collectorMagnet.description),
        ['overcharge', 'points']
      );
      assert.deepEqual(
        placeholdersOf(locale.modals.levelSelect.chapters.starsCompleted),
        ['maxStars', 'stars']
      );

      for (const mutKey of Object.keys(gameConfig.daily.mutators)) {
        const text = buildLevelIntroText({ dailySeed: DAILY_INTRO_TEST_SEED, mutatorKey: mutKey }, t);
        assert.ok(text.includes(locale.gameplay.mutators[mutKey]), `${lang}: intro names ${mutKey}`);
        assert.ok(
          text.includes(locale.modals.shop.codex.mutators[mutKey].description),
          `${lang}: intro describes ${mutKey}`
        );
      }
    }

    assert.match(uiManagerCode, /modals\.levelSelect\.chapters\.optionLocked/);
    assert.match(uiManagerCode, /modals\.levelSelect\.chapters\.starsCompleted/);
    assert.match(workshopViewCode, /points:\s*formatNumber\(spec\.pointsBonusPerLevel \|\| 0\)/);
    assert.match(workshopViewCode, /overcharge:\s*formatNumber\(spec\.overchargeBonusPerLevel \|\| 0\)/);
  } finally {
    i18n.currentLocale = previous;
  }
});

test('closing the last dialog falls back to the game canvas when no opener can take focus', () => {
  const prevDoc = globalThis.document;
  const noop = () => {};
  const state = { hidden: true };
  const modal = {
    classList: { contains: (name) => name === 'hidden' && state.hidden },
    inert: false,
    setAttribute: noop,
    removeAttribute: noop
  };
  const canvas = { focusCalls: 0, focus() { this.focusCalls += 1; } };
  const hiddenOpener = { focusCalls: 0, focus() { this.focusCalls += 1; }, hidden: true };
  globalThis.document = { activeElement: null, body: {}, documentElement: {} };
  try {
    const ui = Object.create(UIManager.prototype);
    ui.elements = { gameCanvas: canvas, appShell: { inert: false, setAttribute: noop, removeAttribute: noop } };
    ui.getModalsByPriority = () => [modal];
    ui.getActiveTopModal = () => (state.hidden ? null : modal);
    ui.keepFocusInTopModal = noop;
    ui.lastFocusedElement = null;

    ui.syncModalInertState();
    assert.equal(canvas.focusCalls, 0, 'no focus change while no dialog was ever open');

    state.hidden = false;
    ui.syncModalInertState();
    assert.equal(canvas.focusCalls, 0, 'still open: nothing restored');

    state.hidden = true;
    ui.syncModalInertState();
    assert.equal(canvas.focusCalls, 1, 'nothing saved: the canvas takes focus');

    state.hidden = false;
    ui.syncModalInertState();
    ui.lastFocusedElement = hiddenOpener;
    state.hidden = true;
    ui.syncModalInertState();
    assert.equal(hiddenOpener.focusCalls, 0, 'a hidden opener is not focused');
    assert.equal(canvas.focusCalls, 2, 'a hidden opener falls back to the canvas');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('the Play hub lists the Arcade cards in campaign unlock order, then the Duel card', () => {
  const hub = elementMarkup(indexHtml, 'modal-play');
  const arcade = hub.slice(hub.indexOf('play-hub-arcade'), hub.indexOf('play-hub-duel'));
  const duel = hub.slice(hub.indexOf('play-hub-duel'));
  const toId = (key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const cardIds = (markup) =>
    [...markup.matchAll(/<button id="([\w-]+)" type="button" class="arcade-mode-card"/g)].map((match) => match[1]);

  const unlockModes = Object.entries(gameConfig.modeUnlocks.campaignLevelCleared)
    .filter(([mode]) => mode !== 'versus')
    .sort((a, b) => a[1] - b[1])
    .map(([mode]) => mode);
  assert.deepEqual(
    cardIds(arcade),
    unlockModes.map((mode) => toId(ARCADE_CARD_SPECS[mode].card)),
    'Arcade cards follow modeUnlocks.campaignLevelCleared'
  );
  assert.deepEqual(Object.keys(ARCADE_CARD_SPECS).slice(0, unlockModes.length), unlockModes, 'ARCADE_CARD_SPECS keeps the same order');
  assert.deepEqual(cardIds(duel), ['btn-mode-versus']);
  const challenges = hub.slice(hub.indexOf('play-hub-challenges'), hub.indexOf('play-hub-arcade'));
  assert.deepEqual(cardIds(challenges), ['btn-daily', 'btn-weekly']);
});

test('every data-i18n key of the Play hub and the campaign map exists in both locales', () => {
  const lookup = (dictionary, key) => key.split('.').reduce((node, part) => node?.[part], dictionary);
  const dictionaries = SUPPORTED.map((lang) => [lang, loadJson(`./locales/${lang}.json`)]);
  let checked = 0;
  for (const id of ['modal-play', 'modal-levels']) {
    const markup = elementMarkup(indexHtml, id);
    for (const match of markup.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
      checked++;
      for (const [lang, dictionary] of dictionaries) {
        assert.equal(typeof lookup(dictionary, match[1]), 'string', `${lang}: ${match[1]} (in #${id})`);
      }
    }
  }
  assert.ok(checked > 40, 'the scan must find the keys of both windows');
});

test('the Play hub keeps its moved ids, the new ids exist once, and the removed ids are gone', () => {
  const ids = [...indexHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const hub = elementMarkup(indexHtml, 'modal-play');
  for (const id of [
    'btn-endless', 'btn-daily', 'btn-flux', 'btn-weekly', 'btn-mode-classic', 'btn-mode-puzzle', 'btn-mode-blitz',
    'btn-mode-boss-rush', 'btn-mode-cascade', 'btn-mode-versus', 'puzzle-stages-strip', 'input-flux-seed', 'btn-flux-seed-go',
    'btn-close-play', 'play-hub-hint', 'btn-campaign-continue', 'btn-campaign-map', 'play-campaign-summary', 'play-campaign-meter',
    'daily-reward', 'weekly-reward', 'btn-puzzle-stages-toggle', 'btn-flux-seed-toggle', 'flux-seed-entry', 'btn-versus-local-hub',
    'versus-local-hub-hint', 'arcade-best-endless', 'arcade-best-flux'
  ]) {
    assert.ok(hub.includes(`id="${id}"`), `#${id} is in the Play hub`);
  }
  for (const id of [
    'btn-play', 'modal-play', 'btn-chapter-prev', 'levels-chapter-select', 'btn-chapter-next', 'btn-levels-jump-current',
    'levels-detail', 'levels-detail-title', 'btn-play-level-modal'
  ]) {
    assert.equal(ids.filter((entry) => entry === id).length, 1, `#${id} exists once`);
  }
  for (const id of ['btn-levels', 'nav-mode-lock-hint', 'nav-group-modes-title', 'levels-chapters']) {
    assert.ok(!ids.includes(id), `#${id} is removed`);
  }
  assert.ok(indexHtml.indexOf('id="modal-play"') < indexHtml.indexOf('id="modal-levels"'), '#modal-play comes before #modal-levels');
});

test('arcade mode intro banners localize cleanly and dismiss after first shotless launch', () => {
  const previousLocale = i18n.currentLocale;
  try {
    for (const locale of ['en', 'fr']) {
      i18n.dictionaries.set(locale, loadJson(`./locales/${locale}.json`));
      i18n.currentLocale = locale;
      for (const mode of [GAME_MODES.HEX_GRID, GAME_MODES.ORBITAL, GAME_MODES.PINBALL, GAME_MODES.CONVOY, GAME_MODES.MERGE]) {
        const text = buildLevelIntroText({ arcadeMode: mode }, t);
        assert.ok(typeof text === 'string' && text.length > 10, `${locale}: ${mode} intro text`);
      }
    }
    i18n.currentLocale = 'en';
    const ui = Object.create(UIManager.prototype);
    const announced = [];
    ui.announce = (message) => announced.push(message);
    const banner = { classList: fakeClassList(['hidden']) };
    ui.elements = { levelIntroBanner: banner, levelIntroText: { textContent: '' } };
    const dismissed = [];
    const engine = {
      state: GAME_STATES.PLAYING,
      mode: GAME_MODES.CONVOY,
      levelIntro: { arcadeMode: GAME_MODES.CONVOY },
      usesShotBudget: () => false,
      runShotsFired: 0,
      dismissLevelIntro: () => {
        dismissed.push(true);
        engine.levelIntro = null;
      }
    };
    ui.updateLevelIntro(engine);
    assert.equal(banner.classList.contains('hidden'), false);
    assert.equal(announced.length, 1);
    engine.runShotsFired = 1;
    ui.updateLevelIntro(engine);
    assert.equal(dismissed.length, 1, 'shotless arcade intro dismisses on first launch');
    assert.equal(banner.classList.contains('hidden'), true);

    engine.levelIntro = { arcadeMode: GAME_MODES.CONVOY, replaySeq: 1 };
    ui.updateLevelIntro(engine);
    assert.equal(banner.classList.contains('hidden'), false, 'replaySeq opens intro again');
    assert.equal(announced.length, 2, 'replay announces refreshed arcade intro');
  } finally {
    i18n.currentLocale = previousLocale;
  }
});

test('HUD surfaces Merge Shake ready copy, Magnetar rest countdown, and one-shot nearDanger announcements', () => {
  const previousLocale = i18n.currentLocale;
  try {
    i18n.dictionaries.set('en', loadJson('./locales/en.json'));
    i18n.dictionaries.set('fr', loadJson('./locales/fr.json'));
    i18n.currentLocale = 'en';
    assert.equal(t('hud.stats.shots.shakeReady'), 'Ready');
    assert.ok(t('hud.stats.mode.bossRushMagnetarRest', { wave: 2, rest: 3, moorings: 4 }).includes('3'));
    for (const mode of [GAME_MODES.CONVOY, GAME_MODES.ORBITAL, GAME_MODES.MERGE]) {
      assert.ok(t(`hud.announcer.nearDanger.${mode}`).length > 5, `nearDanger announcement for ${mode}`);
      assert.ok(loadJson('./locales/fr.json').hud.announcer.nearDanger[mode].length > 5, `fr nearDanger for ${mode}`);
    }
    assert.ok(loadJson('./locales/en.json').modals.shop.upgrades.arcadeShotlessNote.length > 10);
    assert.ok(loadJson('./locales/fr.json').modals.shop.upgrades.arcadeShotlessNote.length > 10);
  } finally {
    i18n.currentLocale = previousLocale;
  }
});

test('Phase 1 audit guards: Magnetar cumulative achievements, Purist & empty-board confirm guard, dailyBest fold, accessible mastery badge, and zero UIHelpers import cycles', () => {
  for (const id of ['magnetarsGrounded', 'magnetarsGroundedSilver', 'magnetarsGroundedGold', 'magnetarLandslide', 'magnetarLandslideSilver', 'magnetarLandslideGold']) {
    assert.equal(gameConfig.achievements[id]?.cumulative, true, `${id} marked cumulative`);
  }
  const grounded = computeAchievementProgress(
    'magnetarsGroundedGold',
    gameConfig.achievements.magnetarsGroundedGold,
    false,
    { magnetarsGrounded: 14 }
  );
  assert.deepEqual(grounded, {
    current: 14,
    target: gameConfig.achievements.magnetarsGroundedGold.threshold,
    pct: Math.round((14 / gameConfig.achievements.magnetarsGroundedGold.threshold) * 100)
  });
  const landslide = computeAchievementProgress(
    'magnetarLandslideSilver',
    gameConfig.achievements.magnetarLandslideSilver,
    false,
    { magnetarLandslide: 2 }
  );
  assert.deepEqual(landslide, {
    current: 2,
    target: gameConfig.achievements.magnetarLandslideSilver.threshold,
    pct: Math.round((2 / gameConfig.achievements.magnetarLandslideSilver.threshold) * 100)
  });

  const uiHelpersCode = readFileSync('./src/ui/UIHelpers.js', 'utf8');
  assert.doesNotMatch(uiHelpersCode, /from '\.\/WorkshopView\.js'/, 'UIHelpers does not cycle back to WorkshopView');
  assert.doesNotMatch(uiHelpersCode, /from '\.\/LevelSelectView\.js'/, 'UIHelpers does not cycle back to LevelSelectView');

  const statsUi = Object.create(UIManager.prototype);
  statsUi.gameConfig = gameConfig;
  statsUi.storageManager = {
    getDailyHistory: () => [{ d: '2026-11-12', s: 1400 }],
    getDailyHighScore: () => 2950
  };
  assert.equal(statsUi.buildStatsRecords().modes[GAME_MODES.DAILY].score, 2950, 'dailyBest folds live getDailyHighScore');

  const makeModalUi = (engineOverrides) => {
    const ui = Object.create(UIManager.prototype);
    const modalConfirm = { classList: fakeClassList(['hidden']) };
    ui.elements = { modalConfirm, btnConfirmYes: { textContent: '', setAttribute() {} }, btnConfirmNo: { focus() {} } };
    ui.isAnyModalOpen = () => false;
    ui.saveLastFocusedElement = () => {};
    ui.syncModalInertState = () => {};
    ui.updateConfirmButtonLabel = () => {};
    ui.engine = {
      state: GAME_STATES.PLAYING,
      mode: GAME_MODES.CLASSIC,
      classicStage: 2,
      hasFiredInRound: false,
      physicsWorld: { balls: [{}] },
      ...engineOverrides
    };
    return { ui, modalConfirm };
  };

  let ranPurist = false;
  const puristCase = makeModalUi({});
  puristCase.ui.requestDestructiveAction(() => { ranPurist = true; });
  assert.equal(ranPurist, false, 'Purist Stage 2+ asks confirmation even before first shot of stage');
  assert.equal(puristCase.modalConfirm.classList.contains('hidden'), false);

  let ranEmptyMerge = false;
  const emptyMergeCase = makeModalUi({
    mode: GAME_MODES.MERGE,
    classicStage: 1,
    hasFiredInRound: true,
    physicsWorld: { balls: [] },
    getModeBehavior: () => ({ allowsEmptyBoardSnapshot: () => true })
  });
  emptyMergeCase.ui.requestDestructiveAction(() => { ranEmptyMerge = true; });
  assert.equal(ranEmptyMerge, false, 'Active Merge run with empty board asks confirmation');

  let ranFreshMerge = false;
  const freshMergeCase = makeModalUi({
    mode: GAME_MODES.MERGE,
    classicStage: 1,
    waveCount: 1,
    mergeBestTier: 1,
    hasFiredInRound: false,
    physicsWorld: { balls: [] },
    getModeBehavior: () => ({ allowsEmptyBoardSnapshot: () => true })
  });
  freshMergeCase.ui.requestDestructiveAction(() => { ranFreshMerge = true; });
  assert.equal(ranFreshMerge, true, 'Fresh Merge run with zero drops executes immediately without prompt');
  assert.equal(freshMergeCase.modalConfirm.classList.contains('hidden'), true);
});

test('PlayHubView syncMasteredBadge and CodexView rail + mergeGuide render accessible localized DOM without raw keys', async () => {
  const { CODEX_MERGE_GUIDE_ORDER, buildCodexPane } = await import('../src/ui/CodexView.js');
  const ballsConfig = loadJson('./configs/balls.json');
  const obstaclesConfig = loadJson('./configs/obstacles.json');

  const makeDomNode = (tag) => {
    const attrs = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      style: {},
      dataset: {},
      children: [],
      classList: fakeClassList(),
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'class') node.className = String(v);
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      removeAttribute(k) {
        attrs.delete(k);
      },
      append(...items) {
        for (const item of items) {
          if (item && typeof item === 'object') node.children.push(item);
        }
      },
      appendChild(item) {
        node.children.push(item);
        return item;
      },
      replaceChildren(...items) {
        node.children = [];
        node.append(...items);
      },
      querySelector(selector) {
        if (!selector.startsWith('.')) return null;
        const targetCls = selector.slice(1);
        const search = (cur) => {
          for (const child of cur.children) {
            const tokens = new Set([...String(child.className || '').split(/\s+/).filter(Boolean)]);
            if (tokens.has(targetCls) || child.classList?.contains?.(targetCls)) return child;
            const nested = search(child);
            if (nested) return nested;
          }
          return null;
        };
        return search(node);
      }
    };
    return node;
  };

  const previousDocument = globalThis.document;
  const previousLocale = i18n.currentLocale;
  globalThis.document = { createElement: makeDomNode };
  try {
    i18n.dictionaries.set('en', loadJson('./locales/en.json'));
    i18n.dictionaries.set('fr', loadJson('./locales/fr.json'));
    i18n.currentLocale = 'en';

    const endlessCard = makeDomNode('button');
    let endlessScore = 6500;
    const hubUi = Object.assign(Object.create(UIManager.prototype), {
      gameConfig,
      engine: { state: GAME_STATES.IDLE, levelCatalog: { count: 20 } },
      elements: { btnEndless: endlessCard },
      storageManager: {
        getEndlessHighScore: () => endlessScore,
        isDailyCompleted: () => false,
        getDailyStreakState: () => ({ streak: 0 }),
        hasClaimedWeeklyFluxBonus: () => false,
        getDailyBounties: () => ({ items: [] })
      }
    });
    hubUi.refreshPlayHubRecords();
    assert.equal(endlessCard.classList.contains('is-mastered'), true);
    const badge = endlessCard.querySelector('.mode-mastered-badge');
    assert.ok(badge, 'mounts .mode-mastered-badge on mastered card');
    assert.equal(badge.classList.contains('hidden'), false);
    const starSpan = badge.querySelector('.mode-mastered-star');
    assert.equal(starSpan?.getAttribute('aria-hidden'), 'true');
    assert.equal(starSpan?.textContent, gameConfig.theme.starFilledSymbol);
    const srSpan = badge.querySelector('.visually-hidden');
    assert.equal(srSpan?.textContent, ', Mastered');

    endlessScore = 200;
    hubUi.refreshPlayHubRecords();
    assert.equal(endlessCard.classList.contains('is-mastered'), false);
    assert.equal(badge.classList.contains('hidden'), true, 'hides badge when unmastered');

    const codexPane = makeDomNode('div');
    buildCodexPane.call({
      elements: { codexPane },
      ballsConfig,
      gameConfig,
      obstaclesConfig,
      engine: { storageManager: { getDiscoveries: () => ({ specials: {}, mechanics: { rail: true } }) } }
    });
    const mechHeadingIndex = codexPane.children.findIndex(
      (n) => n.textContent === t('modals.shop.codex.mechanicsTitle')
    );
    const mechanicsGrid = mechHeadingIndex >= 0 ? codexPane.children[mechHeadingIndex + 1] : null;
    assert.ok(mechanicsGrid, 'renders mechanics codex section');
    const railCard = mechanicsGrid.children.find((card) =>
      card.querySelector('.codex-title')?.textContent === t('modals.shop.codex.mechanics.rail.name')
    );
    assert.ok(railCard, 'renders Sliding Rail mechanic card');
    const mergeGrid = codexPane.children.find((n) => n.dataset.codexSection === 'mergeGuide');
    assert.ok(mergeGrid, 'renders mergeGuide codex section');
    assert.equal(mergeGrid.children.length, CODEX_MERGE_GUIDE_ORDER.length, 'renders every mergeGuide card');
    for (const card of mergeGrid.children) {
      assert.doesNotMatch(
        String(card.querySelector('.codex-title')?.textContent || ''),
        /^modals\.shop\.codex\./,
        'no raw i18n key in mergeGuide title'
      );
      assert.doesNotMatch(
        String(card.querySelector('.codex-desc')?.textContent || ''),
        /^modals\.shop\.codex\./,
        'no raw i18n key in mergeGuide description'
      );
    }
  } finally {
    globalThis.document = previousDocument;
    i18n.currentLocale = previousLocale;
  }
});

test('reportBountyEvent interpolates {{target}} in floating popup and notifies UI without raw placeholders', async () => {
  const { reportBountyEvent } = await import('../src/game/Bounties.js');
  const previousLocale = i18n.currentLocale;
  try {
    i18n.dictionaries.set('en', loadJson('./locales/en.json'));
    i18n.currentLocale = 'en';
    const popups = [];
    const notifications = [];
    const fakeEngine = {
      gameConfig,
      storageManager: {
        recordBountyProgress: () => [{ id: 'merge_fusions', target: 12, coins: 40, completed: true }]
      },
      audioManager: { playEffect() {} },
      particleSystem: {
        spawnFloatingText: (_x, _y, text) => popups.push(text)
      },
      notifyUI: (extra) => notifications.push(extra)
    };
    const completed = reportBountyEvent(fakeEngine, 'merge_fusion', 1);
    assert.equal(completed.length, 1);
    assert.equal(popups.length, 1);
    assert.doesNotMatch(popups[0], /\{\{/, 'floating popup has no raw {{target}} placeholder');
    assert.match(popups[0], /12/, 'floating popup renders target count');
    assert.equal(notifications[0]?.completedBounties?.length, 1);
  } finally {
    i18n.currentLocale = previousLocale;
  }
});
