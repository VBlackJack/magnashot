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

import { CLUSTER_MODIFIERS } from '../src/core/Constants.js';

const read = (path) => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const game = read('configs/game.json');
const balls = read('configs/balls.json');
const campaign = read('configs/campaign.json');
const locales = { en: read('locales/en.json'), fr: read('locales/fr.json') };
const lookup = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);

const BEHAVIOURS = ['invert', 'undertow', 'regrow', 'barrage'];

test('The Magnetar config unlocks behaviours by tier and keeps the campaign untouched', () => {
  const cfg = game.magnetar;
  assert.equal(CLUSTER_MODIFIERS.MAGNETAR, 'magnetar');
  assert.equal(balls.clusterModifiers.magnetar.id, 'magnetar');
  assert.equal(campaign.generated.magnetar.enabled, false);
  for (let tier = 1; tier <= cfg.maxTier; tier++) {
    assert.ok(cfg.cadenceByTier[tier] > 0, `tier ${tier} has a cadence`);
    assert.ok(cfg.tierUnlocks[tier].every((id) => BEHAVIOURS.includes(id)), `tier ${tier} behaviours`);
  }
  // Tier sets are cumulative: every behaviour is unlocked exactly once, tier 1 holds at least two.
  const unlockedAll = Object.values(cfg.tierUnlocks).flat();
  assert.deepEqual([...unlockedAll].sort(), [...BEHAVIOURS].sort());
  assert.ok(cfg.tierUnlocks[1].length >= 2);
  assert.equal(cfg.barrage.countByTier[1], 0);
  assert.ok(cfg.barrage.strongChance > 0 && cfg.barrage.strongChance < 1);
  assert.ok(game.onboarding.order.indexOf('magnetar') === game.onboarding.order.indexOf('bossCore') + 1);
  assert.equal(game.onboarding.mechanics.magnetar.interaction, 'proximity');
});

test('Every Magnetar string exists in both locales with the same placeholders', () => {
  const keys = [
    'gameplay.feedback.magnetar.immune',
    'gameplay.feedback.magnetar.moorings',
    'gameplay.feedback.magnetar.down',
    'gameplay.tutorial.magnetar',
    'hud.magnetar.next',
    'hud.stats.mode.bossRushMagnetar',
    'hud.stats.shots.mooringsLabel',
    'hud.announcer.magnetar.armed',
    'hud.announcer.magnetar.lastMooring',
    'hud.announcer.magnetar.down',
    'modals.shop.codex.modifiers.magnetar.name',
    'modals.shop.codex.modifiers.magnetar.description',
    'modals.shop.codex.magnetarPatterns.title',
    ...BEHAVIOURS.flatMap((id) => [
      `gameplay.magnetar.behaviour.${id}`,
      `gameplay.magnetar.counter.${id}`,
      `modals.shop.codex.magnetarPatterns.patterns.${id}.icon`,
      `modals.shop.codex.magnetarPatterns.patterns.${id}.name`,
      `modals.shop.codex.magnetarPatterns.patterns.${id}.description`
    ])
  ];
  const placeholders = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  for (const key of keys) {
    const en = lookup(locales.en, key);
    const fr = lookup(locales.fr, key);
    assert.equal(typeof en, 'string', `en ${key}`);
    assert.equal(typeof fr, 'string', `fr ${key}`);
    assert.deepEqual(placeholders(fr), placeholders(en), `${key} placeholders`);
  }
});

test('Magnetar achievements are complete three-tier families with strings', () => {
  for (const family of ['magnetarsGrounded', 'magnetarLandslide']) {
    const tiers = Object.values(game.achievements).filter((spec) => spec.tierOf === family);
    assert.deepEqual(tiers.map((spec) => spec.tier), ['bronze', 'silver', 'gold'], family);
    for (const spec of tiers) {
      for (const lang of ['en', 'fr']) {
        const entry = lookup(locales[lang], `modals.shop.achievements.items.${spec.id}`);
        assert.ok(entry?.name && entry?.description, `${lang} ${spec.id}`);
      }
    }
  }
  assert.deepEqual(
    Object.values(game.achievements).filter((s) => s.tierOf === 'magnetarsGrounded').map((s) => s.threshold),
    [1, 5, 15]
  );
});
