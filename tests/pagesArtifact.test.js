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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES_ENTRIES, PAGES_OUTPUT_DIR, buildPagesArtifact } from '../scripts/pages-artifact.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDED_TOP_LEVEL = ['tests', 'scripts', 'node_modules'];
const INDEX_FILE = 'index.html';

function listFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`]
  );
}

function isCovered(file) {
  return PAGES_ENTRIES.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

function localReferences(html) {
  return [...html.matchAll(/(?:href|src)="\.\/([^"]*)"/g)].map((match) => match[1]);
}

test('Pages entries all exist', () => {
  for (const entry of PAGES_ENTRIES) {
    assert.ok(existsSync(join(REPO_ROOT, entry)), entry);
  }
});

test('Pages entries cover every service worker precache asset', () => {
  const source = readFileSync(join(REPO_ROOT, 'sw.js'), 'utf8');
  const precached = [...source.matchAll(/'\.\/([^']*)'/g)].map((match) => match[1]);
  assert.ok(precached.length > 0);
  const missing = precached.map((file) => file || INDEX_FILE).filter((file) => !isCovered(file));
  assert.deepEqual(missing, []);
});

test('Pages entries cover the local references of index.html and the manifest icons', () => {
  const html = readFileSync(join(REPO_ROOT, INDEX_FILE), 'utf8');
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'manifest.webmanifest'), 'utf8'));
  const references = [...localReferences(html), ...manifest.icons.map((icon) => icon.src.replace(/^\.\//, ''))];
  assert.ok(references.length > 0);
  assert.deepEqual(references.filter((file) => !isCovered(file)), []);
});

test('buildPagesArtifact copies exactly the Pages entries', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'magnashot-pages-'));
  try {
    buildPagesArtifact(REPO_ROOT, outDir);
    const expected = PAGES_ENTRIES.flatMap((entry) =>
      existsSync(join(REPO_ROOT, entry)) && readdirSyncIsDirectory(entry)
        ? listFiles(join(REPO_ROOT, entry), `${entry}/`)
        : [entry]
    ).sort();
    const actual = listFiles(outDir).sort();
    assert.deepEqual(actual, expected);
    for (const excluded of EXCLUDED_TOP_LEVEL) {
      assert.equal(actual.some((file) => file.startsWith(`${excluded}/`)), false, excluded);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

function readdirSyncIsDirectory(entry) {
  return readdirSync(REPO_ROOT, { withFileTypes: true }).some((item) => item.name === entry && item.isDirectory());
}

test('Pages output directory is ignored by git and eslint', () => {
  assert.match(readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8'), new RegExp(`^${PAGES_OUTPUT_DIR}/$`, 'm'));
  assert.match(readFileSync(join(REPO_ROOT, 'eslint.config.js'), 'utf8'), new RegExp(`'${PAGES_OUTPUT_DIR}/'`));
});
