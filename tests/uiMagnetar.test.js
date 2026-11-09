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
 * UI side of the Magnetar bosses: the telegraph chip, the Moorings slot, the announcements,
 * the Codex patterns section, the onboarding hint and the markup and style guarantees.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CLUSTER_MODIFIERS, GAME_MODES } from '../src/core/Constants.js';
import { i18n } from '../src/core/I18n.js';
import { isProjectileNearMechanic, listBoardMechanics, resolveHintText } from '../src/game/Discovery.js';
import { MAGNETAR_BEHAVIOURS, MAGNETAR_PHASES } from '../src/game/MagnetarRules.js';
import { buildCodexPane } from '../src/ui/CodexView.js';
import { UIManager } from '../src/ui/UIManager.js';
import { getFluxBannerKey } from '../src/ui/UIHudRefresh.js';

const readText = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const gameConfig = JSON.parse(readText('../configs/game.json'));
const ballsConfig = JSON.parse(readText('../configs/balls.json'));
const en = JSON.parse(readText('../locales/en.json'));
const fr = JSON.parse(readText('../locales/fr.json'));
const html = readText('../index.html');
const css = readText('../styles/main.css');

function fakeElement(initialClasses = []) {
  const classes = new Set(initialClasses);
  return {
    textContent: '',
    classList: {
      classes,
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
      add: (name) => classes.add(name),
      toggle: (name, force) => (force ? classes.add(name) : classes.delete(name))
    },
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {}
  };
}

function makeUi() {
  const ui = Object.create(UIManager.prototype);
  ui.elements = {
    shotsLabel: fakeElement(),
    shotsValue: fakeElement(),
    magnetarTelegraph: fakeElement(['hidden'])
  };
  ui.announced = [];
  ui.announce = (message) => ui.announced.push(message);
  return ui;
}

function withLocale(locale, dictionary, run) {
  const previousLocale = i18n.currentLocale;
  i18n.dictionaries.set(locale, dictionary);
  i18n.currentLocale = locale;
  try {
    run();
  } finally {
    i18n.currentLocale = previousLocale;
  }
}

const withEnglish = (run) => withLocale('en', en, run);
const calmEngine = { getSagState: () => ({ active: false }) };
const bossRushEngine = { mode: GAME_MODES.BOSS_RUSH, getSagState: () => ({ active: false }) };
const viewOf = (overrides = {}) => ({
  moorings: 4,
  phase: MAGNETAR_PHASES.REST,
  armed: null,
  ...overrides
});

test('in Boss Rush the shots slot shows the Moorings, and the last one warns', () => {
  withEnglish(() => {
    const ui = makeUi();
    ui.refreshMagnetarHud(bossRushEngine, viewOf({ moorings: 4 }));
    assert.equal(ui.elements.shotsLabel.textContent, 'Moorings');
    assert.equal(ui.elements.shotsValue.textContent, '4');
    assert.equal(ui.elements.shotsValue.classList.contains('warning'), false);
    ui.refreshMagnetarHud(bossRushEngine, viewOf({ moorings: 1 }));
    assert.equal(ui.elements.shotsValue.classList.contains('warning'), true);
  });
});

test('in Flux the shots slot is left alone and the banner names the Moorings', () => {
  withEnglish(() => {
    const ui = makeUi();
    ui.elements.shotsLabel.textContent = 'Shots';
    ui.elements.shotsValue.textContent = '12';
    ui.refreshMagnetarHud({ mode: GAME_MODES.FLUX, getSagState: () => ({ active: false }) }, viewOf({ moorings: 3 }));
    assert.equal(ui.elements.shotsLabel.textContent, 'Shots');
    assert.equal(ui.elements.shotsValue.textContent, '12');
    assert.equal(getFluxBannerKey(true, viewOf()), 'hud.stats.mode.fluxBossMagnetar');
    assert.equal(getFluxBannerKey(true, null), 'hud.stats.mode.fluxBoss');
    assert.equal(getFluxBannerKey(false, viewOf()), 'hud.stats.mode.flux');
    assert.equal(
      i18n.t('hud.stats.mode.fluxBossMagnetar', { stage: 5, shape: 'Ring', moorings: 3 }),
      'Flux Mode • Shape 5: Ring (Boss, 3 moorings)'
    );
  });
});

test('without a Magnetar the slot and the chip are left alone', () => {
  withEnglish(() => {
    const ui = makeUi();
    ui.elements.shotsLabel.textContent = 'Shots';
    ui.refreshMagnetarHud(calmEngine, null);
    assert.equal(ui.elements.shotsLabel.textContent, 'Shots');
    assert.equal(ui.elements.magnetarTelegraph.classList.contains('hidden'), true);
  });
});

test('the Sag meter keeps the slot when it is active', () => {
  withEnglish(() => {
    const ui = makeUi();
    ui.elements.shotsLabel.textContent = 'Sag';
    ui.refreshMagnetarHud({ getSagState: () => ({ active: true }) }, viewOf());
    assert.equal(ui.elements.shotsLabel.textContent, 'Sag');
  });
});

test('the telegraph chip shows a glyph and words for every armed behaviour, and hides at rest', () => {
  withEnglish(() => {
    const ui = makeUi();
    for (const id of Object.values(MAGNETAR_BEHAVIOURS)) {
      ui.refreshMagnetarHud(calmEngine, viewOf({ phase: MAGNETAR_PHASES.ARMED, armed: id }));
      const chip = ui.elements.magnetarTelegraph;
      const glyph = en.modals.shop.codex.magnetarPatterns.patterns[id].icon;
      assert.equal(chip.classList.contains('hidden'), false);
      assert.equal(chip.textContent, `${glyph} Next turn: ${en.gameplay.magnetar.behaviour[id]}`);
    }
    ui.refreshMagnetarHud(calmEngine, viewOf());
    assert.equal(ui.elements.magnetarTelegraph.classList.contains('hidden'), true);
  });
});

test('arming is announced with its counter, the last Mooring and the fall once each', () => {
  withEnglish(() => {
    const ui = makeUi();
    ui.announceMagnetarEvent({ kind: 'armed', behaviour: MAGNETAR_BEHAVIOURS.REGROW });
    ui.announceMagnetarEvent({ kind: 'lastMooring' });
    ui.announceMagnetarEvent({ kind: 'down' });
    ui.announceMagnetarEvent(undefined);
    assert.deepEqual(ui.announced, [
      'Magnetar: Regrow next turn. Fill the marked slots to block it.',
      'One mooring left.',
      'Magnetar down.'
    ]);
  });
});

test('the announcement is read from one refresh only', () => {
  const source = readText('../src/ui/UIHudRefresh.js');
  assert.match(source, /delete this\.lastExtra\.magnetarAnnouncement/);
});

test('the chip is hidden, aria-hidden and sits in the badges row, so no column is added', () => {
  const chip = html.match(/<span id="hud-magnetar-telegraph"[^>]*>/)?.[0] ?? '';
  assert.match(chip, /class="[^"]*\bhidden\b/);
  assert.match(chip, /aria-hidden="true"/);
  const row = html.match(/<div class="hud-badges-row">[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.ok(row.includes('id="hud-magnetar-telegraph"'));
});

test('the chip style does not rely on colour: dashed border, forced colours border, no animation', () => {
  const rule = css.match(/\.hud-badge\.magnetar \{[^}]*\}/)?.[0] ?? '';
  assert.match(rule, /border:\s*2px dashed/);
  assert.doesNotMatch(rule, /animation/);
  assert.match(css, /\.hud-badge\.magnetar,\s*\n\s*\.level-card\.unlocked/);
});

test('the Boss Rush banner and the shots label exist in both languages', () => {
  for (const dictionary of [en, fr]) {
    assert.match(dictionary.hud.stats.mode.bossRushMagnetar, /\{\{wave\}\}.*\{\{moorings\}\}/);
    assert.match(dictionary.hud.stats.mode.fluxBossMagnetar, /\{\{shape\}\}.*\{\{moorings\}\}/);
    assert.ok(dictionary.hud.stats.shots.mooringsLabel);
    assert.match(dictionary.hud.magnetar.next, /\{\{behaviour\}\}/);
    for (const kind of ['armed', 'lastMooring', 'down']) {
      assert.ok(dictionary.hud.announcer.magnetar[kind], kind);
    }
    for (const id of Object.values(MAGNETAR_BEHAVIOURS)) {
      assert.ok(dictionary.gameplay.magnetar.counter[id], id);
      assert.ok(dictionary.modals.shop.codex.magnetarPatterns.patterns[id].icon, id);
    }
  }
});

test('the Codex gets a Magnetar patterns section with one card per behaviour', () => {
  const created = [];
  const makeNode = (tag) => {
    const node = {
      tag,
      className: '',
      textContent: '',
      dataset: {},
      style: {},
      children: [],
      append(...nodes) {
        this.children.push(...nodes);
      },
      appendChild(node2) {
        this.children.push(node2);
        return node2;
      },
      replaceChildren() {
        this.children = [];
      }
    };
    created.push(node);
    return node;
  };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: makeNode };
  try {
    withEnglish(() => {
      const pane = makeNode('div');
      const ui = {
        elements: { codexPane: pane },
        ballsConfig,
        gameConfig,
        obstaclesConfig: { types: {} },
        engine: null
      };
      buildCodexPane.call(ui);
      const heading = pane.children.find((n) => n.textContent === 'Magnetar patterns');
      assert.ok(heading, 'section heading');
      const grid = pane.children.find((n) => n.dataset.codexSection === 'magnetarPatterns');
      assert.equal(grid.children.length, Object.values(MAGNETAR_BEHAVIOURS).length);
      const glyphs = grid.children.map((card) => card.children[0].textContent);
      assert.deepEqual(
        glyphs,
        Object.values(MAGNETAR_BEHAVIOURS).map((id) => en.modals.shop.codex.magnetarPatterns.patterns[id].icon)
      );
    });
  } finally {
    globalThis.document = previousDocument;
  }
});

test('onboarding: the Magnetar is a proximity mechanic after the Boss Core, with its hint', () => {
  const order = gameConfig.onboarding.order;
  assert.ok(order.indexOf('magnetar') === order.indexOf('bossCore') + 1);
  assert.equal(gameConfig.onboarding.mechanics.magnetar.interaction, 'proximity');
  const magnetar = { clusterModifier: CLUSTER_MODIFIERS.MAGNETAR, x: 100, y: 100, radius: 20 };
  assert.ok(listBoardMechanics([magnetar], []).has('magnetar'));
  const shot = { x: 100, y: 150, radius: 20 };
  assert.ok(isProjectileNearMechanic(['magnetar'], shot, [magnetar], [], gameConfig.onboarding.interactionMargin));
  const far = { x: 900, y: 900, radius: 20 };
  assert.ok(!isProjectileNearMechanic(['magnetar'], far, [magnetar], [], gameConfig.onboarding.interactionMargin));
  withEnglish(() => {
    const text = resolveHintText('magnetar', gameConfig.onboarding, ballsConfig, (key, params) => i18n.t(key, params));
    assert.match(text, /A Magnetar can't be broken/);
  });
});
