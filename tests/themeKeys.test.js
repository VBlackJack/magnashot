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
const THEME_KEY_PATTERN = /\btheme\.([A-Za-z]\w*)/g;

const listSourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    return listSourceFiles(full);
  }
  return entry.name.endsWith('.js') ? [full] : [];
});

test('Every theme key read by the source exists in configs/game.json', () => {
  const theme = JSON.parse(fs.readFileSync('./configs/game.json', 'utf8')).theme;
  const files = listSourceFiles(SOURCE_ROOT);
  assert.ok(files.some((file) => file.includes(path.join('game', 'modes'))), 'the scan reaches a subdirectory');
  const missing = [];
  for (const file of files) {
    for (const [, key] of fs.readFileSync(file, 'utf8').matchAll(THEME_KEY_PATTERN)) {
      if (!Object.hasOwn(theme, key)) {
        missing.push(`${file}: theme.${key}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
