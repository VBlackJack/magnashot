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
 * UI side of the Sag meter and the Classic mode: the HUD box, its accessible value, the
 * announcements, the mode wiring (buttons, cards, names, records) and the markup.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GAME_MODES } from '../src/core/Constants.js';
import { i18n } from '../src/core/I18n.js';
import { buildShareText } from '../src/game/DailyShare.js';
import { SAG_PHASES } from '../src/game/SagMeter.js';
import { UIManager } from '../src/ui/UIManager.js';
import { ARCADE_CARD_SPECS, MODE_BUTTON_KEYS, MODE_NAME_KEYS } from '../src/ui/UIHelpers.js';
import { formatModeBest } from '../src/ui/UIStats.js';

const readText = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const gameConfig = JSON.parse(readText('../configs/game.json'));
const en = JSON.parse(readText('../locales/en.json'));
const fr = JSON.parse(readText('../locales/fr.json'));
const html = readText('../index.html');

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

function fakeElement(initialClasses = []) {
  const attributes = new Map();
  const properties = new Map();
  return {
    textContent: '',
    classList: fakeClassList(initialClasses),
    style: { setProperty: (name, value) => properties.set(name, value) },
    properties,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name)
  };
}

function makeUi() {
  const ui = Object.create(UIManager.prototype);
  ui.elements = {
    shotsLabel: fakeElement(),
    shotsValue: fakeElement(),
    sagMeter: fakeElement(['hidden'])
  };
  ui.announced = [];
  ui.announce = (message) => ui.announced.push(message);
  return ui;
}

function withEnglish(run) {
  const previousLocale = i18n.currentLocale;
  i18n.dictionaries.set('en', en);
  i18n.currentLocale = 'en';
  try {
    run();
  } finally {
    i18n.currentLocale = previousLocale;
  }
}

const sagOf = (level, phase, size = 5) => ({ active: true, level, size, phase, railDrops: 0 });
const engineOf = (mode, extra = {}) => ({ mode, waveCount: 1, classicRailDropsTotal: 0, ...extra });

test('the HUD Sag box shows the level, the meter value and an accessible value text', () => {
  withEnglish(() => {
    const ui = makeUi();
    ui.refreshSagMeter(engineOf(GAME_MODES.ENDLESS), sagOf(2, SAG_PHASES.CALM));
    const meter = ui.elements.sagMeter;
    assert.equal(ui.elements.shotsLabel.textContent, 'Sag');
    assert.equal(ui.elements.shotsValue.textContent, '2/5');
    assert.equal(meter.classList.contains('hidden'), false);
    assert.equal(meter.getAttribute('aria-valuemax'), '5');
    assert.equal(meter.getAttribute('aria-valuenow'), '2');
    assert.equal(meter.getAttribute('aria-valuetext'), 'Sag 2 of 5: 3 missed shots before the cluster drops');
    assert.equal(meter.properties.get('--sag-size'), '5');
    assert.equal(meter.properties.get('--sag-level'), '2');
    assert.equal(meter.classList.contains('warning'), false);
    assert.equal(meter.classList.contains('critical'), false);
  });
});

test('the meter takes the warning class one miss before a drop and the critical class when full', () => {
  withEnglish(() => {
    const ui = makeUi();
    const engine = engineOf(GAME_MODES.ENDLESS);
    ui.refreshSagMeter(engine, sagOf(4, SAG_PHASES.WARN));
    assert.equal(ui.elements.sagMeter.classList.contains('warning'), true);
    assert.equal(ui.elements.sagMeter.classList.contains('critical'), false);
    assert.equal(ui.elements.shotsValue.classList.contains('warning'), true);
    ui.refreshSagMeter(engine, sagOf(5, SAG_PHASES.FULL));
    assert.equal(ui.elements.sagMeter.classList.contains('warning'), false);
    assert.equal(ui.elements.sagMeter.classList.contains('critical'), true);
    ui.refreshSagMeter(engine, sagOf(0, SAG_PHASES.CALM));
    assert.equal(ui.elements.sagMeter.classList.contains('critical'), false);
    assert.equal(ui.elements.shotsValue.classList.contains('warning'), false);
  });
});

test('hideSagMeter hides the meter and forgets the announcer state', () => {
  withEnglish(() => {
    const ui = makeUi();
    ui.refreshSagMeter(engineOf(GAME_MODES.ENDLESS), sagOf(1, SAG_PHASES.CALM));
    ui.hideSagMeter();
    assert.equal(ui.elements.sagMeter.classList.contains('hidden'), true);
    assert.equal(ui.sagAnnouncerState, null);
  });
});

test('the warning is announced once per cycle and again after the cluster dropped', () => {
  withEnglish(() => {
    const ui = makeUi();
    const engine = engineOf(GAME_MODES.ENDLESS);
    ui.refreshSagMeter(engine, sagOf(0, SAG_PHASES.CALM));
    ui.refreshSagMeter(engine, sagOf(3, SAG_PHASES.CALM));
    assert.deepEqual(ui.announced, []);
    ui.refreshSagMeter(engine, sagOf(4, SAG_PHASES.WARN));
    ui.refreshSagMeter(engine, sagOf(4, SAG_PHASES.WARN));
    assert.deepEqual(ui.announced, [en.gameplay.feedback.sag.warning], 'one warning for the cycle');
    // An avalanche eases the meter back, then it climbs again: still the same cycle.
    ui.refreshSagMeter(engine, sagOf(3, SAG_PHASES.CALM));
    ui.refreshSagMeter(engine, sagOf(4, SAG_PHASES.WARN));
    assert.equal(ui.announced.length, 1);
    // The cluster drops: the wave count moves and the meter empties.
    engine.waveCount = 2;
    ui.refreshSagMeter(engine, sagOf(0, SAG_PHASES.CALM));
    assert.equal(ui.announced.at(-1), en.gameplay.feedback.sag.lowered);
    ui.refreshSagMeter(engine, sagOf(4, SAG_PHASES.WARN));
    assert.equal(ui.announced.at(-1), en.gameplay.feedback.sag.warning, 'a new cycle warns again');
    assert.equal(ui.announced.length, 3);
  });
});

test('a Classic rail drop is announced from the run total of rail drops', () => {
  withEnglish(() => {
    const ui = makeUi();
    const engine = engineOf(GAME_MODES.CLASSIC, { classicStage: 1 });
    ui.refreshSagMeter(engine, sagOf(5, SAG_PHASES.CALM, 6));
    engine.classicRailDropsTotal = 1;
    ui.refreshSagMeter(engine, sagOf(0, SAG_PHASES.CALM, 6));
    assert.deepEqual(ui.announced, [en.gameplay.feedback.sag.lowered]);
  });
});

test('a run opened already in the warning phase stays silent until the cycle changes', () => {
  withEnglish(() => {
    const ui = makeUi();
    ui.refreshSagMeter(engineOf(GAME_MODES.ENDLESS), sagOf(4, SAG_PHASES.WARN));
    assert.deepEqual(ui.announced, []);
  });
});

test('Classic is wired like the other gated modes', () => {
  assert.deepEqual(MODE_BUTTON_KEYS[GAME_MODES.CLASSIC], ['btnModeClassic']);
  assert.equal(MODE_NAME_KEYS[GAME_MODES.CLASSIC], 'modals.levelSelect.arcade.classic');
  const spec = ARCADE_CARD_SPECS[GAME_MODES.CLASSIC];
  assert.equal(spec.card, 'btnModeClassic');
  assert.equal(spec.best, 'arcadeBestClassic');
  for (const dictionary of [en, fr]) {
    assert.ok(dictionary.modals.levelSelect.arcade.classic);
    assert.ok(dictionary.modals.levelSelect.arcade.classicDesc);
    assert.ok(dictionary.modals.levelSelect.arcade.classicBest.includes('{{stage}}'));
  }
  assert.equal(gameConfig.modeUnlocks.campaignLevelCleared.classic, 4);
  const bindings = readText('../src/ui/UIInputBindings.js');
  assert.match(
    bindings,
    /bindModeCard\(this, this\.elements\.btnModeClassic, \{[\s\S]{0,120}accessKey: GAME_MODES\.CLASSIC[\s\S]{0,200}startClassicMode\(\)/
  );
});

test('the markup carries the Sag meter in the shots box and the Classic card right after Survival in the Play hub arcade', () => {
  assert.match(
    html,
    /hud-stat-shots[\s\S]*?id="hud-sag-meter"[^>]*role="meter"[^>]*aria-valuemin="0"[^>]*aria-valuenow="0"[^>]*aria-valuetext=""/
  );
  assert.match(html, /id="hud-sag-meter" class="sag-meter hidden"/);
  const arcade = html.slice(html.indexOf('play-hub-arcade'));
  assert.ok(arcade.indexOf('id="btn-endless"') > 0);
  assert.ok(arcade.indexOf('id="btn-endless"') < arcade.indexOf('id="btn-mode-classic"'));
  assert.ok(arcade.indexOf('id="btn-mode-classic"') < arcade.indexOf('id="btn-mode-puzzle"'));
  assert.match(html, /id="arcade-best-classic"/);
});

test('the HUD no longer reads the removed wave counter', () => {
  assert.doesNotMatch(readText('../src/ui/UIHudRefresh.js'), /shotsUntilWave/);
});

test('the Classic record reads as a stage in the stats and shares without a link', () => {
  const identity = (key, params) => `${key}:${JSON.stringify(params)}`;
  const format = (n) => String(n);
  assert.equal(
    formatModeBest({ score: 900, kind: 'classicStage', stage: 3 }, identity, format),
    'modals.stats.overview.bestClassicStage:{"score":"900","stage":"3"}'
  );
  assert.equal(formatModeBest({ score: 0, kind: 'classicStage', stage: 3 }, identity, format), '');
  withEnglish(() => {
    const text = buildShareText(
      { mode: GAME_MODES.CLASSIC, stage: 3, score: 1200, drops: 4, url: 'https://example.invalid/' },
      gameConfig.share
    );
    assert.deepEqual(text.split(/\r?\n/), ['MagnaShot Purist', 'Stage 3 - 1,200 pts', 'Rail drops: 4']);
  });
});
