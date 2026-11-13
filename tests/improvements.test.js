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

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GAME_MODES, GAME_STATES } from '../src/core/Constants.js';
import { validateConfigs } from '../src/core/ConfigRegistry.js';
import { i18n } from '../src/core/I18n.js';
import { ParticleSystem } from '../src/entities/ParticleSystem.js';
import { createGameLoop } from '../src/game/GameLoop.js';
import { Renderer } from '../src/game/Renderer.js';
import { getRegisteredModeBehavior } from '../src/game/modes/index.js';
import { updatePressureMeter, updateQuotaWarning } from '../src/ui/UIHudRefresh.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const readText = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const gameConfig = readJson('../configs/game.json');
const physicsConfig = readJson('../configs/physics.json');
const modesConfig = readJson('../configs/modes.json');
const en = readJson('../locales/en.json');
const fr = readJson('../locales/fr.json');
const html = readText('../index.html');
const css = readText('../styles/main.css');
const swSource = readText('../sw.js');

function fakeClassList(initial = []) {
  const classes = new Set(initial);
  return {
    contains: (name) => classes.has(name),
    remove: (name) => classes.delete(name),
    add: (name) => classes.add(name),
    toggle: (name, force) => (force ? classes.add(name) : classes.delete(name))
  };
}

function fakeElement(initialClasses = []) {
  const attrs = new Map();
  const props = new Map();
  return {
    textContent: '',
    classList: fakeClassList(initialClasses),
    style: { setProperty: (name, value) => props.set(name, value) },
    props,
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, value)
  };
}

function withLocale(locale, dictionary, fn) {
  const previous = i18n.currentLocale;
  i18n.dictionaries.set(locale, dictionary);
  i18n.currentLocale = locale;
  try {
    fn();
  } finally {
    i18n.currentLocale = previous;
  }
}

describe('Workshop mode-specific notes', () => {
  test('WorkshopView and both locales define dedicated notes for Convoy and Orbital', () => {
    const workshopSrc = readText('../src/ui/WorkshopView.js');
    assert.match(workshopSrc, /SHOTLESS_NOTE_KEYS/);
    assert.match(workshopSrc, /\[GAME_MODES\.CONVOY\]: 'modals\.shop\.upgrades\.convoyNote'/);
    assert.match(workshopSrc, /\[GAME_MODES\.ORBITAL\]: 'modals\.shop\.upgrades\.orbitalNote'/);
    for (const dict of [en, fr]) {
      assert.ok(dict.modals.shop.upgrades.convoyNote.length > 20);
      assert.ok(dict.modals.shop.upgrades.orbitalNote.length > 20);
    }
  });
});

describe('Proactive storage quota warning', () => {
  test('index.html, CSS, SW precache, and locales wire the quota badge cleanly', () => {
    const badgesRow = html.match(/<div class="hud-badges-row">[\s\S]*?<\/div>/)?.[0] ?? '';
    assert.match(badgesRow, /id="hud-quota-badge"[^>]*class="hud-badge quota-warning hidden"/);
    assert.doesNotMatch(badgesRow, /<\/div>[\s\S]*<\/div>/);
    assert.match(css, /\.hud-badge\.quota-warning \{/);
    for (const dict of [en, fr]) {
      assert.ok(dict.hud.stats.quotaWarning.badge.length > 3);
      assert.ok(dict.hud.stats.quotaWarning.aria.length > 10);
      assert.ok(dict.hud.announcer.storageQuotaExceeded.length > 10);
    }
  });

  test('updateQuotaWarning shows badge, announces once per session, and skips round-end collisions', () => {
    withLocale('en', en, () => {
      const announcements = [];
      const ui = {
        elements: { quotaBadge: fakeElement(['hidden']) },
        storageManager: { hasQuotaExceeded: () => true },
        hasAnnouncedQuotaExceeded: false,
        announce: (msg) => announcements.push(msg)
      };

      // During a round-end transition, the badge reveals silently so Victory/Game Over stays audible
      updateQuotaWarning(ui, { state: GAME_STATES.GAME_OVER }, true);
      assert.equal(ui.elements.quotaBadge.classList.contains('hidden'), false);
      assert.equal(announcements.length, 0);
      assert.equal(ui.hasAnnouncedQuotaExceeded, false);

      // Next active playing refresh speaks once
      updateQuotaWarning(ui, { state: GAME_STATES.PLAYING }, false);
      assert.equal(announcements.length, 1);
      assert.equal(announcements[0], en.hud.announcer.storageQuotaExceeded);
      assert.equal(ui.hasAnnouncedQuotaExceeded, true);

      updateQuotaWarning(ui, { state: GAME_STATES.PLAYING }, false);
      assert.equal(announcements.length, 1);
    });
  });
});

describe('Continuous spatial pressure meter', () => {
  test('Convoy, Orbital, and Merge behaviors compute bounded spatial pressure states', () => {
    const convoy = getRegisteredModeBehavior(GAME_MODES.CONVOY);
    const convoyState = convoy.getPressureState({
      modesConfig,
      physicsWorld: { balls: [{ convoyS: 900 }] },
      modeState: { trackId: modesConfig.convoy.tracks[0], nearDanger: true }
    });
    assert.equal(convoyState.active, true);
    assert.equal(convoyState.modeKey, 'convoy');
    assert.ok(convoyState.ratio > 0 && convoyState.ratio <= 1);

    const orbital = getRegisteredModeBehavior(GAME_MODES.ORBITAL);
    const cfgO = modesConfig.orbital;
    const orbitalState = orbital.getPressureState({
      modesConfig,
      physicsWorld: {
        balls: [
          { id: 1, x: cfgO.coreX + 120, y: cfgO.coreY, radius: 18 },
          { id: 2, x: cfgO.coreX + 500, y: cfgO.coreY, radius: 18 }
        ],
        getAnchoredBallIds: () => new Set([1])
      },
      modeState: { nearDanger: false }
    });
    assert.equal(orbitalState.active, true);
    assert.equal(orbitalState.modeKey, 'orbital');
    assert.ok(Math.abs(orbitalState.ratio - (138 / cfgO.dangerRadius)) < 1e-6);

    const merge = getRegisteredModeBehavior(GAME_MODES.MERGE);
    const cfgM = modesConfig.merge;
    const mergeState = merge.getPressureState({
      modesConfig,
      physicsWorld: {
        balls: [
          // Newly dropped sphere above overflow line still inside entry grace must not peg meter
          { y: cfgM.launcherY, radius: 16, mergeGraceSec: 0.5 },
          { y: cfgM.basinFloorY - 120, radius: 20, mergeGraceSec: 0 }
        ]
      },
      modeState: { maxOverflowRatio: 0, nearDanger: false }
    });
    assert.equal(mergeState.active, true);
    assert.equal(mergeState.modeKey, 'merge');
    assert.ok(mergeState.ratio > 0 && mergeState.ratio < 0.85);
  });

  test('updatePressureMeter updates ARIA attributes and hides outside pressure modes or under Sag', () => {
    withLocale('en', en, () => {
      const meter = fakeElement(['hidden']);
      const ui = { elements: { pressureMeter: meter } };
      const engine = {
        getModeBehavior: () => ({
          getPressureState: () => ({ active: true, modeKey: 'convoy', ratio: 0.88, danger: true, critical: false })
        })
      };

      updatePressureMeter(ui, engine, false);
      assert.equal(meter.classList.contains('hidden'), false);
      assert.equal(meter.getAttribute('aria-valuenow'), '88');
      assert.equal(meter.getAttribute('aria-valuetext'), 'Convoy progress toward vortex: 88%');
      assert.equal(meter.classList.contains('warning'), true);
      assert.equal(meter.props.get('--pressure-pct'), '88');

      updatePressureMeter(ui, engine, true);
      assert.equal(meter.classList.contains('hidden'), true);
    });
  });
});

describe('Adaptive particle budget and RendererParticles extraction', () => {
  test('validateConfigs accepts configured adaptiveBudget and rejects invalid cross-fields', () => {
    const badGame = structuredClone(gameConfig);
    badGame.juice.particles.adaptiveBudget.recoverFrameMs = badGame.juice.particles.adaptiveBudget.highFrameMs;
    const map = new Map([['game', badGame], ['physics', physicsConfig]]);
    assert.throws(() => validateConfigs(map), /recoverFrameMs/);
  });

  test('ParticleSystem scales down under slow frames, clamps spawns, and recovers smoothly', () => {
    const ps = new ParticleSystem(gameConfig.juice);
    assert.equal(ps.getEffectiveMaxParticles(), gameConfig.juice.particles.maxParticles);

    for (let i = 0; i < 10; i++) {
      ps.adaptBudget(35);
    }
    const reducedCap = ps.getEffectiveMaxParticles();
    assert.ok(reducedCap < gameConfig.juice.particles.maxParticles);
    assert.equal(
      ps.budgetScale,
      gameConfig.juice.particles.adaptiveBudget.minScale
    );

    ps.spawnBurst(100, 100, '#38bdf8', gameConfig.juice.particles.maxParticles * 2, 3);
    assert.equal(ps.particles.length, reducedCap);

    for (let i = 0; i < 30; i++) {
      ps.adaptBudget(12);
    }
    assert.equal(ps.budgetScale, 1);
  });

  test('GameLoop feeds clamped rawFrameMs (not pre-clamped elapsed) to adaptBudget', () => {
    let observed = null;
    const loop = createGameLoop({
      engine: {
        state: GAME_STATES.PLAYING,
        hitStopFrames: 0,
        stageTransitionFrames: 0,
        update() {},
        particleSystem: { adaptBudget: (ms) => { observed = ms; } }
      },
      renderer: { render() {} },
      fixedStepMs: 16,
      maxAccumulatedMs: 100,
      idleRenderIntervalMs: 250,
      scheduleFrame: () => {},
      onFatalError: (e) => { throw e; }
    });
    loop.frame(100);
    loop.frame(250);
    assert.equal(observed, 100);
  });

  test('Renderer preserves particle methods via RendererParticles.js and precaches it in sw.js', () => {
    for (const method of ['drawLiquid', 'drawWallCracks', 'drawTrail', 'drawShatteringBalls', 'drawParticles']) {
      assert.equal(typeof Renderer.prototype[method], 'function');
    }
    assert.ok(swSource.includes("'./src/game/RendererParticles.js'"));
  });
});
