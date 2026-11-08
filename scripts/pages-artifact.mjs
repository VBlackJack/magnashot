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
 * Assembles the GitHub Pages artifact: only the files the game serves at runtime.
 * Tests, scripts, docs, the changelog and package files stay out. .nojekyll stays in the
 * repository but is not copied, because an Actions deployment does not run Jekyll.
 *
 * Usage: node scripts/pages-artifact.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PAGES_ENTRIES = Object.freeze([
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'src',
  'configs',
  'locales',
  'styles',
  'icons'
]);

export const PAGES_OUTPUT_DIR = '_site';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Rebuilds outDir from scratch with a copy of every Pages entry found under repoRoot. */
export function buildPagesArtifact(repoRoot, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const entry of PAGES_ENTRIES) {
    fs.cpSync(path.join(repoRoot, entry), path.join(outDir, entry), { recursive: true });
  }
}

/** True when this file is the script node was started with, not a module imported by a test. */
const isEntryPoint = () => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(SCRIPT_PATH);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

if (isEntryPoint()) {
  buildPagesArtifact(REPO_ROOT, path.join(REPO_ROOT, PAGES_OUTPUT_DIR));
  console.log(`Wrote the Pages artifact to ${PAGES_OUTPUT_DIR}/`);
}
