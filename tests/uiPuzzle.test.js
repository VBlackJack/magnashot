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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { GAME_STATES } from '../src/core/Constants.js';
import { i18n, t } from '../src/core/I18n.js';
import { UIManager } from '../src/ui/UIManager.js';
import { buildLevelIntroText } from '../src/ui/UIHelpers.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
const LOCALES = ['en', 'fr'];
const STAGE_COUNT = gameConfig.puzzles.length;
const MAX_STARS = gameConfig.scoring.maxStars;
const FIXTURE_STARS = 2;
const FIXTURE_UNLOCKED_STAGE = 3;
const FIXTURE_SHOTS = 2;
const FORBIDDEN_CODE_POINTS = [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0xa0, 0x202f, 0x2026];
const FORBIDDEN_TYPOGRAPHY = new RegExp(`[${FORBIDDEN_CODE_POINTS.map((cp) => String.fromCodePoint(cp)).join('')}]`);

for (const lang of LOCALES) {
  i18n.dictionaries.set(lang, loadJson(`./locales/${lang}.json`));
}

/** Minimal DOM element: enough for the strip and the intro banner. */
function fakeElement() {
  const classes = new Set();
  const el = {
    children: [],
    attributes: {},
    dataset: {},
    listeners: {},
    textContent: '',
    className: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
    },
    setAttribute(name, value) {
      el.attributes[name] = String(value);
    },
    getAttribute: (name) => el.attributes[name],
    addEventListener(name, fn) {
      el.listeners[name] = fn;
    },
    replaceChildren() {
      el.children = [];
    },
    append(...nodes) {
      el.children.push(...nodes);
    },
    appendChild(node) {
      el.children.push(node);
    }
  };
  return el;
}

function withLocale(lang, fn) {
  i18n.currentLocale = lang;
  try {
    fn();
  } finally {
    i18n.currentLocale = 'en';
  }
}

function makeIntro(overrides = {}) {
  return { puzzleStage: 4, totalStages: STAGE_COUNT, shots: FIXTURE_SHOTS, objective: 'coreRescue', isFirstPuzzle: false, ...overrides };
}

test('Puzzle intro text names the stage, the objective, the shots and the stage hint', () => {
  withLocale('en', () => {
    const text = buildLevelIntroText(makeIntro(), t);
    assert.ok(text.startsWith(`Puzzle 4/${STAGE_COUNT}: free every core`), text);
    assert.match(text, /in 2 shots\./);
    assert.ok(text.endsWith(t('hud.levelIntro.puzzleHints.stage4')));
    assert.doesNotMatch(text, /undefined|hud\.levelIntro/);
  });
  withLocale('fr', () => {
    const text = buildLevelIntroText(makeIntro({ shots: 1, objective: 'clearAll', puzzleStage: 3 }), t);
    assert.ok(text.startsWith(`Puzzle 3/${STAGE_COUNT} : videz le plateau en 1 tir.`), text);
  });
});

test('Puzzle intro text carries the rules sentence only on the first Puzzle', () => {
  withLocale('en', () => {
    const rules = t('gameplay.tutorial.puzzle');
    const first = buildLevelIntroText(makeIntro({ isFirstPuzzle: true }), t);
    const later = buildLevelIntroText(makeIntro({ isFirstPuzzle: false }), t);
    assert.ok(first.startsWith(rules));
    assert.ok(first.endsWith(later));
    assert.ok(!later.includes(rules));
  });
});

test('Puzzle texts exist in English and French for every stage, with no forbidden typography', () => {
  const english = loadJson('./locales/en.json');
  const french = loadJson('./locales/fr.json');
  for (let stage = 1; stage <= STAGE_COUNT; stage++) {
    const key = `stage${stage}`;
    const en = english.hud.levelIntro.puzzleHints[key];
    const fr = french.hud.levelIntro.puzzleHints[key];
    assert.ok(en && fr, `hint for stage ${stage}`);
    assert.notEqual(en, fr, `stage ${stage} hint is translated`);
  }
  for (const lang of LOCALES) {
    const dict = loadJson(`./locales/${lang}.json`);
    const texts = [
      ...Object.values(dict.hud.levelIntro.puzzleHints),
      ...Object.values(dict.hud.levelIntro.puzzleObjective),
      ...Object.values(dict.hud.levelIntro.puzzleShots),
      dict.hud.levelIntro.puzzle,
      dict.gameplay.tutorial.puzzle,
      dict.modals.levelSelect.arcade.puzzleDesc,
      dict.modals.levelSelect.arcade.puzzleRecord,
      dict.modals.levelSelect.arcade.puzzleStageAria,
      dict.modals.shop.upgrades.puzzleBaselineNote
    ];
    for (const text of texts) {
      assert.ok(text, `${lang} puzzle text present`);
      assert.doesNotMatch(text, FORBIDDEN_TYPOGRAPHY, `${lang}: ${text}`);
    }
  }
});

function renderStrip({ stats, bestStage, current = null }) {
  const strip = fakeElement();
  const ui = Object.create(UIManager.prototype);
  ui.elements = { puzzleStagesStrip: strip };
  ui.gameConfig = gameConfig;
  ui.storageManager = { getPuzzleBestStage: () => bestStage, getPuzzleStageStats: () => stats };
  ui.engine = current ? { mode: 'puzzle', currentPuzzleStage: current } : { mode: 'endless' };
  const previous = globalThis.document;
  globalThis.document = { createElement: () => fakeElement() };
  try {
    ui.renderPuzzleStagesStrip();
  } finally {
    globalThis.document = previous;
  }
  return strip.children;
}

test('Puzzle stage strip shows stored stars on unlocked stages and keeps locked ones starless', () => {
  withLocale('en', () => {
    const buttons = renderStrip({
      stats: { 1: { bestScore: 900, stars: MAX_STARS }, 2: { bestScore: 400, stars: FIXTURE_STARS } },
      bestStage: FIXTURE_UNLOCKED_STAGE
    });
    assert.equal(buttons.length, STAGE_COUNT);
    const [first, second, third, fourth] = buttons;
    const starsOf = (btn) => btn.children.find((c) => c.className === 'puzzle-stage-stars');

    assert.equal(starsOf(first).textContent, gameConfig.theme.starFilledSymbol.repeat(MAX_STARS));
    assert.equal(starsOf(first).attributes['aria-hidden'], 'true');
    assert.equal(first.attributes['aria-label'], `Puzzle 1, ${MAX_STARS} of ${MAX_STARS} stars`);
    assert.equal(second.attributes['aria-label'], `Puzzle 2, ${FIXTURE_STARS} of ${MAX_STARS} stars`);
    assert.equal(
      starsOf(second).textContent,
      gameConfig.theme.starFilledSymbol.repeat(FIXTURE_STARS) +
        gameConfig.theme.starEmptySymbol.repeat(MAX_STARS - FIXTURE_STARS)
    );
    assert.equal(starsOf(third).textContent, gameConfig.theme.starEmptySymbol.repeat(MAX_STARS), 'unlocked, no stats yet');
    assert.ok(!third.className.includes('locked'));

    assert.ok(fourth.className.includes('locked'), 'a stage past the unlock is locked');
    assert.equal(starsOf(fourth), undefined, 'a locked stage shows no stars');
    assert.equal(fourth.attributes['aria-disabled'], 'true');
  });
});

test('Puzzle stage strip marks the current stage', () => {
  const buttons = renderStrip({ stats: {}, bestStage: FIXTURE_UNLOCKED_STAGE, current: 2 });
  assert.ok(buttons[1].className.includes('active'));
  assert.equal(buttons[1].attributes['aria-current'], 'true');
});

function makeIntroUi({ activeDiscoveryId = null, intro = makeIntro() } = {}) {
  const banner = fakeElement();
  banner.classList.add('hidden');
  const ui = Object.create(UIManager.prototype);
  ui.elements = { levelIntroBanner: banner, levelIntroText: fakeElement() };
  const announced = [];
  ui.announce = (text) => announced.push(text);
  const engine = {
    levelIntro: intro,
    state: GAME_STATES.PLAYING,
    activeDiscoveryId,
    shotsRemaining: FIXTURE_SHOTS,
    usesShotBudget: () => true,
    dismissLevelIntro: () => {}
  };
  return { ui, engine, banner, announced };
}

test('Puzzle intro waits behind a discovery card, then shows and is announced once per stage', () => {
  const { ui, engine, banner, announced } = makeIntroUi({ activeDiscoveryId: 'portal' });
  ui.updateLevelIntro(engine);
  assert.ok(banner.classList.contains('hidden'), 'deferred while the card is open');
  assert.equal(announced.length, 0);
  assert.ok(engine.levelIntro, 'the intro is kept, not dropped');

  engine.activeDiscoveryId = null;
  ui.updateLevelIntro(engine);
  assert.ok(!banner.classList.contains('hidden'), 'shown once the card is closed');
  assert.equal(announced.length, 1);
  assert.equal(ui.announcedLevelIntroId, 'puzzle:4');

  ui.updateLevelIntro(engine);
  assert.equal(announced.length, 1, 'same stage is announced once (a retry is not re-announced)');

  engine.levelIntro = makeIntro({ puzzleStage: 5 });
  ui.updateLevelIntro(engine);
  assert.equal(announced.length, 2, 'a new stage is announced');
});

test('a non-Puzzle intro is never deferred behind a discovery card', () => {
  const dailyIntro = { mutatorKey: 'anyMutator', dailySeed: 'seed' };
  const { ui, engine, banner } = makeIntroUi({ activeDiscoveryId: 'portal', intro: dailyIntro });
  engine.areUpgradesNeutralised = () => false;
  engine.isDailyAmmoLocked = () => false;
  ui.updateLevelIntro(engine);
  assert.ok(!banner.classList.contains('hidden'), 'Campaign and Daily keep showing the banner');
  assert.equal(ui.deferredPuzzleIntro ?? null, null);
});

test('a Puzzle intro still deferred at the first shot is announced once, then forgotten', () => {
  const { ui, engine, banner, announced } = makeIntroUi({ activeDiscoveryId: 'portal' });
  ui.updateLevelIntro(engine);
  assert.equal(announced.length, 0);

  engine.levelIntro = null;
  engine.hasFiredInRound = true;
  ui.updateLevelIntro(engine);
  assert.equal(announced.length, 1, 'the goal reaches screen readers');
  assert.ok(announced[0].includes(`${STAGE_COUNT}`), 'the announcement is the intro text');
  assert.ok(banner.classList.contains('hidden'));
  ui.updateLevelIntro(engine);
  assert.equal(announced.length, 1, 'announced only once');
});

test('a Puzzle intro dropped without a shot (quit or restart) is not announced', () => {
  const { ui, engine, announced } = makeIntroUi({ activeDiscoveryId: 'portal' });
  ui.updateLevelIntro(engine);
  engine.levelIntro = null;
  engine.hasFiredInRound = false;
  ui.updateLevelIntro(engine);
  assert.equal(announced.length, 0);
});
