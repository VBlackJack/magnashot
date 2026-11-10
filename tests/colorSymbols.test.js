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

const loadJson = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const balls = loadJson('../configs/balls.json');
/** Glyphs that read as a polarity sign. */
const SIGN_LOOKALIKES = ['+', '-', '\u2212', '\u00b1', '\u2213'];
const LOCALES = ['en', 'fr'];

/** Collects every string stored under `key` anywhere in a config subtree. */
function collectStrings(node, key, found = []) {
  if (node && typeof node === 'object') {
    for (const [name, value] of Object.entries(node)) {
      if (name === key && typeof value === 'string') {
        found.push(value);
      } else {
        collectStrings(value, key, found);
      }
    }
  }
  return found;
}

const symbols = balls.standardColors.map((color) => color.symbol);

test('Every colour symbol is a non-empty string', () => {
  for (const color of balls.standardColors) {
    assert.equal(typeof color.symbol, 'string', color.id);
    assert.ok(color.symbol.length > 0, color.id);
  }
});

test('No colour symbol reads as a polarity sign', () => {
  const banned = new Set(SIGN_LOOKALIKES);
  for (const locale of LOCALES) {
    const hud = loadJson(`../locales/${locale}.json`).versus.hud;
    banned.add(hud.signPlus);
    banned.add(hud.signMinus);
  }
  for (const color of balls.standardColors) {
    assert.ok(!banned.has(color.symbol), `${color.id} uses sign glyph ${color.symbol}`);
  }
});

test('Colour symbols are unique', () => {
  assert.equal(new Set(symbols).size, symbols.length);
});

test('No colour symbol collides with a special icon or a cluster badge', () => {
  const taken = new Set([
    ...collectStrings(balls.specialTypes, 'icon'),
    ...collectStrings(balls.clusterModifiers, 'badge')
  ]);
  assert.ok(taken.size > 0, 'icons and badges were found');
  for (const color of balls.standardColors) {
    assert.ok(!taken.has(color.symbol), `${color.id} shares glyph ${color.symbol}`);
  }
});
