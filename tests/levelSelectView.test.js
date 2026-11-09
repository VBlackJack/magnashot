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

import { i18n } from '../src/core/I18n.js';
import {
  isLevelIncomplete,
  shouldShowLevelDescription,
  stepGridIndex,
  summarizeChapterStars,
  uiLevelSelectMethods
} from '../src/ui/LevelSelectView.js';

const MAX_STARS = 3;
const TEST_LOCALE = 'en';

/** Stub dictionary: every text embeds its own key, so tests assert keys and never wording. */
const STUB_KEYS = [
  'modals.levelSelect.tile.withBadge',
  'modals.levelSelect.card.aria',
  'modals.levelSelect.card.ariaCurrent',
  'modals.levelSelect.card.ariaLocked',
  'modals.levelSelect.card.bestScore',
  'modals.levelSelect.card.formatBadge.landmark',
  'modals.levelSelect.card.formatBadge.precision',
  'modals.levelSelect.tile.mark.landmark',
  'modals.levelSelect.tile.mark.precision',
  'modals.levelSelect.filter.allCompletedInChapter'
];

function installStubLocale() {
  const dictionary = {};
  for (const key of STUB_KEYS) {
    let node = dictionary;
    const segments = key.split('.');
    segments.slice(0, -1).forEach((segment) => {
      node[segment] = node[segment] || {};
      node = node[segment];
    });
    node[segments.at(-1)] = `<${key}|{{name}}|{{badge}}|{{score}}>`;
  }
  i18n.dictionaries.set(TEST_LOCALE, dictionary);
  i18n.currentLocale = TEST_LOCALE;
}

function makeElement(tagName) {
  const classes = new Set();
  const attributes = new Map();
  const element = {
    tagName,
    children: [],
    dataset: {},
    style: {},
    tabIndex: -1,
    textContent: '',
    className: '',
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : force;
        if (on) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return on;
      }
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
    removeAttribute: (name) => attributes.delete(name),
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    append(...nodes) {
      nodes.forEach((node) => element.children.push(node));
    },
    replaceChildren(...nodes) {
      const flat = nodes.flatMap((node) => (node.isFragment ? node.children : [node]));
      element.children = flat;
    },
    focus() {
      element.focused = true;
    }
  };
  return element;
}

globalThis.document = {
  createElement: makeElement,
  createDocumentFragment: () => ({ ...makeElement('#fragment'), isFragment: true })
};

const CHAPTER = { index: 1, isTutorial: false, firstId: 1, lastId: 6 };

function makeSummary(id) {
  if (id === 2) {
    return { id, isGenerated: true, isLandmark: true, format: 'landmark' };
  }
  if (id === 3) {
    return { id, isGenerated: true, isLandmark: false, format: 'precision' };
  }
  return { id, isGenerated: true, isLandmark: false, format: 'standard' };
}

function makeUi({ unlocked = 5, stats = {}, columns = 3 } = {}) {
  globalThis.getComputedStyle = () => ({ gridTemplateColumns: Array(columns).fill('56px').join(' ') });
  const grid = makeElement('div');
  const ui = {
    ...uiLevelSelectMethods,
    levelsChapterIndex: 0,
    levelsFilterIncomplete: false,
    levelsSelectedId: null,
    elements: { levelsGrid: grid },
    gameConfig: { scoring: { maxStars: MAX_STARS } },
    storageManager: { getUnlockedLevel: () => unlocked, getLevelStats: () => stats },
    engine: {
      levelCatalog: {
        listChapters: () => [CHAPTER],
        summarize: makeSummary
      }
    },
    formatLevelName: (summary) => `name-${summary.id}`,
    formatLevelDescription: (summary) => `desc-${summary.id}`,
    formatChapterName: () => 'chapter',
    formatStars: (stars) => `stars-${stars}`,
    renderLevelDetail() {}
  };
  return ui;
}

function tabStops(grid) {
  return grid.children.filter((child) => child.tabIndex === 0);
}

test('stepGridIndex: horizontal moves stop at both ends of the grid', () => {
  assert.equal(stepGridIndex(0, 6, 3, -1, 0), -1);
  assert.equal(stepGridIndex(5, 6, 3, 1, 0), -1);
  assert.equal(stepGridIndex(1, 6, 3, 1, 0), 2);
  assert.equal(stepGridIndex(4, 6, 3, -1, 0), 3);
});

test('stepGridIndex: wrapRows controls whether a row edge continues on the next row', () => {
  assert.equal(stepGridIndex(2, 6, 3, 1, 0, true), 3);
  assert.equal(stepGridIndex(3, 6, 3, -1, 0, true), 2);
  assert.equal(stepGridIndex(2, 6, 3, 1, 0, false), -1);
  assert.equal(stepGridIndex(3, 6, 3, -1, 0, false), -1);
  assert.equal(stepGridIndex(1, 6, 3, 1, 0, false), 2);
});

test('stepGridIndex: vertical moves go by columns and stop at the top and bottom rows', () => {
  assert.equal(stepGridIndex(1, 6, 3, 0, 1), 4);
  assert.equal(stepGridIndex(4, 6, 3, 0, -1), 1);
  assert.equal(stepGridIndex(1, 6, 3, 0, -1), -1);
  assert.equal(stepGridIndex(4, 6, 3, 0, 1), -1);
});

test('stepGridIndex: a partial last row is reached on its last item and left upward by columns', () => {
  // 7 items on 3 columns: the last row holds only index 6.
  assert.equal(stepGridIndex(4, 7, 3, 0, 1), 6);
  assert.equal(stepGridIndex(5, 7, 3, 0, 1), 6);
  assert.equal(stepGridIndex(3, 7, 3, 0, 1), 6);
  assert.equal(stepGridIndex(6, 7, 3, 0, 1), -1);
  assert.equal(stepGridIndex(6, 7, 3, 0, -1), 3);
  assert.equal(stepGridIndex(6, 7, 3, 1, 0), -1);
  assert.equal(stepGridIndex(6, 7, 3, 1, 0, false), -1);
});

test('stepGridIndex: degenerate grids return -1 or stay safe', () => {
  assert.equal(stepGridIndex(0, 0, 3, 1, 0), -1);
  assert.equal(stepGridIndex(0, 1, 3, 1, 0), -1);
  assert.equal(stepGridIndex(0, 4, 0, 0, 1), 1);
  assert.equal(stepGridIndex(2, 4, 3, 0, 0), 2);
  assert.equal(stepGridIndex(99, 4, 3, -1, 0), 2);
});

test('summarizeChapterStars: sums stars and clamps each level to the maximum', () => {
  const stats = { 1: { stars: 3 }, 2: { stars: 9 }, 3: { stars: -2 }, 4: { stars: 1 } };
  assert.deepEqual(summarizeChapterStars({ firstId: 1, lastId: 4 }, stats, MAX_STARS), {
    stars: 3 + 3 + 0 + 1,
    maxStars: 4 * MAX_STARS,
    isCompleted: false
  });
});

test('summarizeChapterStars: missing stats count as zero and a full chapter is completed', () => {
  assert.deepEqual(summarizeChapterStars({ firstId: 5, lastId: 6 }, {}, MAX_STARS), {
    stars: 0,
    maxStars: 2 * MAX_STARS,
    isCompleted: false
  });
  const full = { 5: { stars: 3 }, 6: { stars: 3 } };
  assert.equal(summarizeChapterStars({ firstId: 5, lastId: 6 }, full, MAX_STARS).isCompleted, true);
  assert.equal(summarizeChapterStars({ firstId: 5, lastId: 6 }, undefined, MAX_STARS).stars, 0);
});

test('isLevelIncomplete: only open levels below the maximum stars qualify', () => {
  const stats = { 1: { stars: 3 }, 2: { stars: 2 }, 3: { stars: 7 } };
  assert.equal(isLevelIncomplete(1, 5, stats, MAX_STARS), false);
  assert.equal(isLevelIncomplete(2, 5, stats, MAX_STARS), true);
  assert.equal(isLevelIncomplete(3, 5, stats, MAX_STARS), false);
  assert.equal(isLevelIncomplete(4, 5, stats, MAX_STARS), true);
  assert.equal(isLevelIncomplete(6, 5, stats, MAX_STARS), false);
});

test('shouldShowLevelDescription: generic generated levels have none', () => {
  assert.equal(shouldShowLevelDescription({ isGenerated: false }), true);
  assert.equal(shouldShowLevelDescription({ isGenerated: true, isLandmark: true, format: 'landmark' }), true);
  assert.equal(shouldShowLevelDescription({ isGenerated: true, isLandmark: false, format: 'twist' }), true);
  assert.equal(shouldShowLevelDescription({ isGenerated: true, isLandmark: false, format: 'precision' }), true);
  assert.equal(shouldShowLevelDescription({ isGenerated: true, isLandmark: false, format: 'arsenal' }), true);
  assert.equal(shouldShowLevelDescription({ isGenerated: true, isLandmark: false, format: 'standard' }), false);
  assert.equal(shouldShowLevelDescription(null), false);
});

test('level tile aria: landmarks are named through tile.withBadge, others are not', () => {
  installStubLocale();
  const ui = makeUi();
  ui.renderLevelTiles(4);
  const [plain, landmark, precision] = ui.elements.levelsGrid.children;
  assert.match(landmark.getAttribute('aria-label'), /modals\.levelSelect\.card\.aria\|/);
  assert.match(landmark.getAttribute('aria-label'), /modals\.levelSelect\.tile\.withBadge\|name-2\|/);
  assert.match(landmark.getAttribute('aria-label'), /modals\.levelSelect\.card\.formatBadge\.landmark/);
  assert.doesNotMatch(plain.getAttribute('aria-label'), /tile\.withBadge/);
  assert.doesNotMatch(precision.getAttribute('aria-label'), /tile\.withBadge/);
});

test('level tile aria: current uses the ariaCurrent text without aria-current, locked uses ariaLocked', () => {
  installStubLocale();
  const ui = makeUi({ unlocked: 5 });
  ui.renderLevelTiles(4);
  const tiles = ui.elements.levelsGrid.children;
  const current = tiles[3];
  assert.match(current.getAttribute('aria-label'), /card\.ariaCurrent/);
  assert.equal(current.getAttribute('aria-current'), null);
  const locked = tiles[5];
  assert.match(locked.getAttribute('aria-label'), /card\.ariaLocked/);
  assert.equal(locked.getAttribute('aria-disabled'), 'true');
  assert.equal(tiles[0].getAttribute('role'), 'option');
});

test('level tiles: exactly one tile is in the tab order after render and after filtering', () => {
  installStubLocale();
  const ui = makeUi({ unlocked: 5, stats: { 1: { stars: 3 }, 2: { stars: 3 } } });
  ui.renderLevelTiles(4);
  assert.equal(tabStops(ui.elements.levelsGrid).length, 1);
  assert.equal(tabStops(ui.elements.levelsGrid)[0].dataset.levelId, '4');
  assert.equal(ui.levelsSelectedId, 4);

  ui.levelsFilterIncomplete = true;
  ui.renderLevelTiles(1);
  const shown = ui.elements.levelsGrid.children.map((tile) => tile.dataset.levelId);
  assert.deepEqual(shown, ['3', '4', '5']);
  assert.equal(tabStops(ui.elements.levelsGrid).length, 1);
  assert.equal(ui.levelsSelectedId, 4, 'the kept selection survives the filter');

  ui.levelsSelectedId = 1;
  ui.renderLevelTiles(1);
  assert.equal(tabStops(ui.elements.levelsGrid).length, 1);
  assert.equal(ui.levelsSelectedId, 3, 'a filtered-out selection moves to the first shown tile');
});

test('level tiles: a fully completed chapter shows the empty message and no tab stop', () => {
  installStubLocale();
  const stats = Object.fromEntries([1, 2, 3, 4, 5, 6].map((id) => [id, { stars: 3 }]));
  const ui = makeUi({ unlocked: 6, stats });
  ui.levelsFilterIncomplete = true;
  const suggested = ui.renderLevelTiles(6);
  assert.equal(suggested, null);
  assert.equal(ui.levelsSelectedId, null);
  assert.equal(ui.elements.levelsGrid.children.length, 1);
  assert.equal(ui.elements.levelsGrid.children[0].className, 'levels-empty-filter');
  assert.equal(tabStops(ui.elements.levelsGrid).length, 0);
  assert.equal(ui.moveLevelTileFocus(1, 0), null);
});

test('moveLevelTileFocus: returns the target tile, moves the selection, and does not focus', () => {
  installStubLocale();
  const ui = makeUi({ unlocked: 5, columns: 3 });
  ui.renderLevelTiles(2);
  const tiles = ui.elements.levelsGrid.children;
  const target = ui.moveLevelTileFocus(1, 0);
  assert.equal(target, tiles[2]);
  assert.equal(target.focused, undefined);
  assert.equal(ui.levelsSelectedId, 3);
  assert.equal(tabStops(ui.elements.levelsGrid).length, 1);
  assert.equal(tiles[1].getAttribute('aria-selected'), 'false');
  assert.equal(target.getAttribute('aria-selected'), 'true');
  assert.equal(ui.moveLevelTileFocus(0, 1), tiles[5]);
});

test('moveLevelTileFocus: returns null at the edges, and at a row edge when wrapRows is false', () => {
  installStubLocale();
  const ui = makeUi({ unlocked: 5, columns: 3 });
  ui.renderLevelTiles(1);
  assert.equal(ui.moveLevelTileFocus(-1, 0), null);
  assert.equal(ui.moveLevelTileFocus(0, -1), null);
  assert.equal(ui.levelsSelectedId, 1, 'a refused move leaves the selection alone');

  ui.levelsSelectedId = 3;
  ui.renderLevelTiles(3);
  assert.equal(ui.moveLevelTileFocus(1, 0, { wrapRows: false }), null);
  assert.equal(ui.levelsSelectedId, 3);
  assert.equal(ui.moveLevelTileFocus(1, 0, { wrapRows: true }).dataset.levelId, '4');

  ui.levelsSelectedId = 6;
  ui.renderLevelTiles(6);
  assert.equal(ui.moveLevelTileFocus(1, 0), null);
  assert.equal(ui.moveLevelTileFocus(0, 1), null);
});

test('uiLevelSelectMethods: excludes the formatters that stay class methods', () => {
  for (const name of [
    'formatLevelName',
    'formatChapterName',
    'formatChapterTheme',
    'formatLevelDescription',
    'getSuggestedLevelId',
    'renderPuzzleStagesStrip'
  ]) {
    assert.equal(name in uiLevelSelectMethods, false, name);
  }
  for (const name of [
    'openLevelsModal',
    'selectLevelChapter',
    'renderChapterSwitcher',
    'renderLevelTiles',
    'renderLevelDetail',
    'selectLevelTile',
    'moveLevelTileFocus',
    'stepLevelChapter',
    'jumpToCurrentLevel',
    'playSelectedLevel',
    'syncLevelsFilterButton',
    'showLockedLevelHint',
    'getStatusHintTarget'
  ]) {
    assert.equal(typeof uiLevelSelectMethods[name], 'function', name);
  }
});

test('getStatusHintTarget: map first, then the Play hub, else null', () => {
  const open = () => ({ classList: { contains: () => false } });
  const closed = () => ({ classList: { contains: () => true } });
  const mapHint = {};
  const hubHint = {};
  const resolve = (elements) => uiLevelSelectMethods.getStatusHintTarget.call({ elements });
  assert.equal(
    resolve({ modalLevels: open(), levelsChapterHint: mapHint, modalPlay: open(), playHubHint: hubHint }),
    mapHint
  );
  assert.equal(
    resolve({ modalLevels: closed(), levelsChapterHint: mapHint, modalPlay: open(), playHubHint: hubHint }),
    hubHint
  );
  assert.equal(resolve({ modalLevels: closed(), modalPlay: closed(), playHubHint: hubHint }), null);
});
