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
 * Prepares a release: bumps the version in package.json, package-lock.json and sw.js and
 * promotes the CHANGELOG.md "Unreleased" section to a dated version section.
 *
 * Usage: npm run release -- <patch|minor|major|X.Y.Z> [--dry-run]
 * Never commits, tags or pushes: it prints the next commands for the maintainer. It refuses
 * before writing anything when the target is not greater than the current version, when the
 * four version sources disagree, or when a file has an unexpected format. All outputs are
 * computed in memory and written only when every one of them succeeded.
 * Exit codes: 0 on success, 1 on a refusal, 2 on bad options.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const FILES = Object.freeze({
  pkg: `${REPO_ROOT}package.json`,
  lock: `${REPO_ROOT}package-lock.json`,
  sw: `${REPO_ROOT}sw.js`,
  changelog: `${REPO_ROOT}CHANGELOG.md`,
});
const DRY_RUN_FLAG = '--dry-run';
const BUMP_KINDS = Object.freeze(['patch', 'minor', 'major']);
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const APP_VERSION_PATTERN = /const APP_VERSION = '([^']*)';/g;
const UNRELEASED_HEADING = '## [Unreleased]';
const SECTION_PREFIX = '## [';
const JSON_INDENT = 2;
const EXIT_REFUSED = 1;
const EXIT_BAD_OPTIONS = 2;
const USAGE = 'Usage: npm run release -- <patch|minor|major|X.Y.Z> [--dry-run]';

const MSG = Object.freeze({
  badVersion: (value) => `Invalid version "${value}": expected strict X.Y.Z`,
  unexpectedFormatting: (name) => `Unexpected formatting in ${name}`,
  noVersionField: (name) => `No version field found in ${name}`,
  swMatchCount: (count) => `Expected exactly one APP_VERSION declaration in sw.js, found ${count}`,
  noUnreleased: 'CHANGELOG.md has no "## [Unreleased]" section',
  emptyUnreleased: 'The Unreleased section of CHANGELOG.md is empty',
  versionExists: (version) => `CHANGELOG.md already has a section for ${version}`,
  notGreater: (target, current) => `Target ${target} is not greater than current ${current}`,
  mismatch: (found) => `Version sources disagree: ${found}`,
  dryRun: 'Dry run: nothing written.',
  summary: (current, target, date) => `Release ${current} -> ${target} (${date})`,
  wrote: (name) => `Updated ${name}`,
  next: 'Next commands (run them yourself):',
});

/** Parses a strict X.Y.Z version into numeric parts. */
export function parseVersion(str) {
  const match = typeof str === 'string' ? VERSION_PATTERN.exec(str) : null;
  if (!match) {
    throw new Error(MSG.badVersion(str));
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Returns -1, 0 or 1 as a is lower than, equal to or higher than b. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return left[i] < right[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Resolves a bump keyword or an explicit version to the target version. */
export function resolveTargetVersion(current, arg) {
  const [major, minor, patch] = parseVersion(current);
  if (arg === 'patch') {
    return `${major}.${minor}.${patch + 1}`;
  }
  if (arg === 'minor') {
    return `${major}.${minor + 1}.0`;
  }
  if (arg === 'major') {
    return `${major + 1}.0.0`;
  }
  parseVersion(arg);
  return arg;
}

/** Local calendar date as YYYY-MM-DD (never toISOString, which is UTC). */
export function formatLocalDateKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const detectEol = (raw) => (raw.includes('\r\n') ? '\r\n' : '\n');
const toLf = (raw) => raw.replace(/\r\n/g, '\n');

/** Re-serialises a JSON document after `mutate`, refusing files that do not round-trip. */
function rewriteJson(raw, name, mutate) {
  const eol = detectEol(raw);
  const original = toLf(raw);
  const data = JSON.parse(original);
  const serialize = (value) => `${JSON.stringify(value, null, JSON_INDENT)}\n`;
  if (serialize(data) !== original) {
    throw new Error(MSG.unexpectedFormatting(name));
  }
  mutate(data);
  return serialize(data).replace(/\n/g, eol);
}

/** Returns package.json content with its version set to v. */
export function bumpPackageJson(raw, v) {
  parseVersion(v);
  return rewriteJson(raw, 'package.json', (data) => {
    if (typeof data.version !== 'string') {
      throw new Error(MSG.noVersionField('package.json'));
    }
    data.version = v;
  });
}

/** Returns package-lock.json content with the root and packages[""] versions set to v. */
export function bumpPackageLock(raw, v) {
  parseVersion(v);
  return rewriteJson(raw, 'package-lock.json', (data) => {
    if (typeof data.version !== 'string' || typeof data.packages?.['']?.version !== 'string') {
      throw new Error(MSG.noVersionField('package-lock.json'));
    }
    data.version = v;
    data.packages[''].version = v;
  });
}

/** Returns sw.js content with its APP_VERSION constant set to v. */
export function bumpServiceWorker(raw, v) {
  parseVersion(v);
  const count = [...raw.matchAll(APP_VERSION_PATTERN)].length;
  if (count !== 1) {
    throw new Error(MSG.swMatchCount(count));
  }
  return raw.replace(APP_VERSION_PATTERN, () => `const APP_VERSION = '${v}';`);
}

/** Moves the Unreleased content of the changelog under a new dated version heading. */
export function promoteUnreleased(raw, v, dateKey) {
  parseVersion(v);
  const eol = detectEol(raw);
  const lines = toLf(raw).split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === UNRELEASED_HEADING);
  if (start === -1) {
    throw new Error(MSG.noUnreleased);
  }
  if (lines.some((line) => line.startsWith(`${SECTION_PREFIX}${v}]`))) {
    throw new Error(MSG.versionExists(v));
  }
  let end = lines.findIndex((line, i) => i > start && line.startsWith(SECTION_PREFIX));
  if (end === -1) {
    end = lines.length;
  }
  const content = lines.slice(start + 1, end).join('\n').trim();
  if (content === '') {
    throw new Error(MSG.emptyUnreleased);
  }
  const head = lines.slice(0, start).join('\n');
  const tail = lines.slice(end).join('\n');
  const promoted = `${UNRELEASED_HEADING}\n\n${SECTION_PREFIX}${v}] - ${dateKey}\n\n${content}\n`;
  const out = `${head}${head === '' ? '' : '\n'}${promoted}${tail === '' ? '' : `\n${tail}`}`;
  return out.replace(/\n/g, eol);
}

/** Reads the version from each source and returns them keyed by source name. */
export function readVersions({ pkg, lock, sw }) {
  const pkgData = JSON.parse(pkg);
  const lockData = JSON.parse(lock);
  const swMatches = [...sw.matchAll(APP_VERSION_PATTERN)];
  return {
    'package.json': pkgData.version,
    'package-lock.json version': lockData.version,
    'package-lock.json packages[""]': lockData.packages?.['']?.version,
    'sw.js': swMatches.length === 1 ? swMatches[0][1] : undefined,
  };
}

/** Computes every output in memory. Throws on any refusal; writes nothing. */
export function planRelease(inputs, arg, date = new Date()) {
  const versions = readVersions(inputs);
  const current = versions['package.json'];
  if (Object.values(versions).some((value) => value !== current)) {
    const found = Object.entries(versions).map(([name, value]) => `${name}=${value}`).join(', ');
    throw new Error(MSG.mismatch(found));
  }
  const target = resolveTargetVersion(current, arg);
  if (compareVersions(target, current) <= 0) {
    throw new Error(MSG.notGreater(target, current));
  }
  const dateKey = formatLocalDateKey(date);
  return {
    current,
    target,
    dateKey,
    outputs: {
      pkg: bumpPackageJson(inputs.pkg, target),
      lock: bumpPackageLock(inputs.lock, target),
      sw: bumpServiceWorker(inputs.sw, target),
      changelog: promoteUnreleased(inputs.changelog, target, dateKey),
    },
  };
}

/** Parses CLI arguments into { arg, dryRun }; throws on bad options. */
export function parseArgs(argv) {
  const dryRun = argv.includes(DRY_RUN_FLAG);
  const positional = argv.filter((a) => a !== DRY_RUN_FLAG);
  if (positional.length !== 1 || positional[0].startsWith('--')) {
    throw new Error(USAGE);
  }
  const [arg] = positional;
  if (!BUMP_KINDS.includes(arg)) {
    parseVersion(arg);
  }
  return { arg, dryRun };
}

function run(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return EXIT_BAD_OPTIONS;
  }
  try {
    const inputs = {};
    for (const [key, path] of Object.entries(FILES)) {
      inputs[key] = fs.readFileSync(path, 'utf8');
    }
    const plan = planRelease(inputs, options.arg);
    console.log(MSG.summary(plan.current, plan.target, plan.dateKey));
    if (options.dryRun) {
      console.log(MSG.dryRun);
      return 0;
    }
    for (const [key, path] of Object.entries(FILES)) {
      fs.writeFileSync(path, plan.outputs[key]);
      console.log(MSG.wrote(path.slice(REPO_ROOT.length)));
    }
    console.log(MSG.next);
    console.log('  git add package.json package-lock.json sw.js CHANGELOG.md');
    console.log(`  git commit -m "chore(release): ${plan.target}"`);
    console.log(`  git tag v${plan.target}`);
    console.log('  git push origin HEAD --tags');
    return 0;
  } catch (error) {
    console.error(error.message);
    return EXIT_REFUSED;
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
  process.exitCode = run(process.argv.slice(2));
}
