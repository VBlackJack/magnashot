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
import path from 'node:path';

const SOURCE_ROOT = './src';
const audioConfig = JSON.parse(fs.readFileSync('./configs/audio.json', 'utf8'));

// playEffect('name'), this.audioManager?.playEffect('name', ...) and the like: literal names only.
const PLAY_EFFECT_PATTERN = /playEffect(?:\?\.|\.)?\(\s*'([A-Za-z0-9_]+)'/g;

const listSourceFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(full);
    }
    return entry.name.endsWith('.js') ? [full] : [];
  });

/** Every literal effect name a source file plays, with the file it came from. */
const collectPlayedEffects = () => {
  const played = [];
  for (const file of listSourceFiles(SOURCE_ROOT)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(PLAY_EFFECT_PATTERN)) {
      played.push({ name: match[1], file });
    }
  }
  return played;
};

test('every effect the code plays by name is defined in the audio config', () => {
  const played = collectPlayedEffects();
  assert.ok(played.length > 10, 'the scan finds the effect calls');
  const missing = played.filter(({ name }) => !Object.hasOwn(audioConfig.effects, name));
  assert.deepEqual(
    missing.map(({ name, file }) => `${name} (${file})`),
    [],
    'a playEffect call without a config entry is silent'
  );
});

test('the scan reaches nested source folders and the effects added with it', () => {
  const files = listSourceFiles(SOURCE_ROOT);
  assert.ok(files.some((file) => file.split(path.sep).length > 3), 'a nested folder is scanned');
  const names = new Set(collectPlayedEffects().map(({ name }) => name));
  assert.ok(names.has('upgrade'), 'the upgrade purchase plays its effect');
  for (const name of ['upgrade', 'magnetarFall']) {
    const effect = audioConfig.effects[name];
    assert.ok(Array.isArray(effect.notes) && effect.notes.length > 0, `${name} has notes`);
    assert.ok(effect.noteDuration > 0, `${name} has a note duration`);
    assert.ok(effect.hapticMs >= 0, `${name} has a haptic duration`);
  }
});
