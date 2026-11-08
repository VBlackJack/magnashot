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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseVersion,
  compareVersions,
  resolveTargetVersion,
  formatLocalDateKey,
  bumpPackageJson,
  bumpPackageLock,
  bumpServiceWorker,
  promoteUnreleased,
  planRelease,
  parseArgs,
} from '../scripts/release.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const readRepo = (name) => readFileSync(join(REPO_ROOT, name), 'utf8');
const toCrlf = (text) => text.replace(/\r?\n/g, '\r\n');
const toLf = (text) => text.replace(/\r\n/g, '\n');
const TEST_VERSION = '9.8.7';
const TEST_DATE = '2030-01-02';

const CHANGELOG_LF = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Fixed',
  '- A fix.',
  '',
  '## [1.0.0] - 2026-01-01',
  '',
  '### Added',
  '- First.',
  '',
].join('\n');

test('parseVersion accepts strict X.Y.Z and rejects everything else', () => {
  assert.deepEqual(parseVersion('1.14.1'), [1, 14, 1]);
  for (const bad of ['1.2', '1.2.3.4', 'v1.2.3', '01.2.3', '1.2.x', '', '1.2.3-beta', undefined, 12]) {
    assert.throws(() => parseVersion(bad), /Invalid version/);
  }
});

test('compareVersions orders numerically, not lexically', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.9.9', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.2.4', '1.2.3'), 1);
});

test('resolveTargetVersion handles patch, minor, major and explicit versions', () => {
  assert.equal(resolveTargetVersion('1.14.1', 'patch'), '1.14.2');
  assert.equal(resolveTargetVersion('1.14.1', 'minor'), '1.15.0');
  assert.equal(resolveTargetVersion('1.14.1', 'major'), '2.0.0');
  assert.equal(resolveTargetVersion('1.14.1', '3.0.1'), '3.0.1');
  assert.throws(() => resolveTargetVersion('1.14.1', 'huge'), /Invalid version/);
  assert.throws(() => resolveTargetVersion('bad', 'patch'), /Invalid version/);
});

test('formatLocalDateKey uses local calendar fields', () => {
  assert.equal(formatLocalDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(formatLocalDateKey(new Date(2026, 10, 8, 0, 1)), '2026-11-08');
});

test('bumpPackageJson changes only the version and keeps line endings', () => {
  const lf = '{\n  "name": "x",\n  "version": "1.0.0",\n  "scripts": {\n    "a": "b"\n  }\n}\n';
  assert.equal(bumpPackageJson(lf, '1.0.1'), lf.replace('1.0.0', '1.0.1'));
  const crlf = toCrlf(lf);
  assert.equal(bumpPackageJson(crlf, '1.0.1'), crlf.replace('1.0.0', '1.0.1'));
});

test('bumpPackageJson refuses unexpected formatting and a missing version', () => {
  assert.throws(() => bumpPackageJson('{"version":"1.0.0"}\n', '1.0.1'), /unexpected formatting/i);
  assert.throws(() => bumpPackageJson('{\n  "version": "1.0.0"\n}', '1.0.1'), /unexpected formatting/i);
  assert.throws(() => bumpPackageJson('{\n    "version": "1.0.0"\n}\n', '1.0.1'), /unexpected formatting/i);
  assert.throws(() => bumpPackageJson('{\n  "name": "x"\n}\n', '1.0.1'), /No version field/);
  assert.throws(() => bumpPackageJson('{\n  "version": "1.0.0"\n}\n', 'nope'), /Invalid version/);
});

test('bumpPackageLock changes both version fields only', () => {
  const lf = '{\n  "name": "x",\n  "version": "1.0.0",\n  "packages": {\n    "": {\n      "name": "x",\n      "version": "1.0.0"\n    },\n    "node_modules/y": {\n      "version": "1.0.0"\n    }\n  }\n}\n';
  const out = bumpPackageLock(lf, '1.0.1');
  const data = JSON.parse(out);
  assert.equal(data.version, '1.0.1');
  assert.equal(data.packages[''].version, '1.0.1');
  assert.equal(data.packages['node_modules/y'].version, '1.0.0');
  assert.equal(bumpPackageLock(toCrlf(lf), '1.0.1'), toCrlf(out));
});

test('bumpPackageLock refuses unexpected formatting and missing fields', () => {
  assert.throws(() => bumpPackageLock('{"version":"1.0.0"}\n', '1.0.1'), /unexpected formatting/i);
  assert.throws(() => bumpPackageLock('{\n  "version": "1.0.0"\n}\n', '1.0.1'), /No version field/);
  assert.throws(() => bumpPackageLock('{\n  "packages": {\n    "": {\n      "version": "1.0.0"\n    }\n  }\n}\n', '1.0.1'), /No version field/);
});

test('bumpServiceWorker replaces exactly one APP_VERSION declaration', () => {
  const lf = "const APP_VERSION = '1.0.0';\nconst CACHE = `c-v${APP_VERSION}`;\n";
  assert.equal(bumpServiceWorker(lf, '1.0.1'), lf.replace('1.0.0', '1.0.1'));
  const crlf = toCrlf(lf);
  assert.equal(bumpServiceWorker(crlf, '1.0.1'), crlf.replace('1.0.0', '1.0.1'));
  assert.throws(() => bumpServiceWorker('const X = 1;\n', '1.0.1'), /found 0/);
  assert.throws(() => bumpServiceWorker(`${lf}${lf}`, '1.0.1'), /found 2/);
});

test('promoteUnreleased moves the content under a dated section (LF)', () => {
  const out = promoteUnreleased(CHANGELOG_LF, '1.1.0', TEST_DATE);
  assert.equal(
    out,
    [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      `## [1.1.0] - ${TEST_DATE}`,
      '',
      '### Fixed',
      '- A fix.',
      '',
      '## [1.0.0] - 2026-01-01',
      '',
      '### Added',
      '- First.',
      '',
    ].join('\n'),
  );
});

test('promoteUnreleased preserves CRLF line endings', () => {
  const out = promoteUnreleased(toCrlf(CHANGELOG_LF), '1.1.0', TEST_DATE);
  assert.equal(out, toCrlf(promoteUnreleased(CHANGELOG_LF, '1.1.0', TEST_DATE)));
  assert.ok(!/(?<!\r)\n/.test(out));
});

test('promoteUnreleased works when Unreleased is the last section', () => {
  const out = promoteUnreleased('# Changelog\n\n## [Unreleased]\n\n- Item.\n', '1.1.0', TEST_DATE);
  assert.equal(out, `# Changelog\n\n## [Unreleased]\n\n## [1.1.0] - ${TEST_DATE}\n\n- Item.\n`);
});

test('promoteUnreleased refuses an empty section, a duplicate version and a missing heading', () => {
  const empty = '# Changelog\n\n## [Unreleased]\n\n   \n\n## [1.0.0] - 2026-01-01\n\n- x\n';
  assert.throws(() => promoteUnreleased(empty, '1.1.0', TEST_DATE), /empty/);
  assert.throws(() => promoteUnreleased(CHANGELOG_LF, '1.0.0', TEST_DATE), /already has a section/);
  assert.throws(() => promoteUnreleased('# Changelog\n', '1.1.0', TEST_DATE), /no "## \[Unreleased\]"/);
});

test('parseArgs accepts a bump or version with an optional dry-run flag', () => {
  assert.deepEqual(parseArgs(['patch']), { arg: 'patch', dryRun: false });
  assert.deepEqual(parseArgs(['--dry-run', '2.0.0']), { arg: '2.0.0', dryRun: true });
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(['patch', 'minor']), /Usage/);
  assert.throws(() => parseArgs(['--wat']), /Usage/);
  assert.throws(() => parseArgs(['1.2']), /Invalid version/);
});

/** The real repo files, with content injected into the empty Unreleased section. */
function readRealInputs() {
  const changelog = readRepo('CHANGELOG.md').replace(/^## \[Unreleased\]\r?\n/m, (m) => `${m}${m.endsWith('\r\n') ? '\r\n' : '\n'}### Fixed${m.endsWith('\r\n') ? '\r\n' : '\n'}- Test entry.${m.endsWith('\r\n') ? '\r\n' : '\n'}`);
  return {
    pkg: readRepo('package.json'),
    lock: readRepo('package-lock.json'),
    sw: readRepo('sw.js'),
    changelog,
  };
}

/** Lines of a text, split on either line ending. */
const linesOf = (text) => toLf(text).split('\n');

test('real repo files bump to a test version changing only version fields', () => {
  const inputs = readRealInputs();
  const plan = planRelease(inputs, TEST_VERSION, new Date(2030, 0, 2));
  const current = JSON.parse(inputs.pkg).version;
  assert.equal(plan.target, TEST_VERSION);
  assert.equal(plan.dateKey, TEST_DATE);

  assert.equal(toLf(plan.outputs.pkg), toLf(inputs.pkg).replace(`"version": "${current}"`, `"version": "${TEST_VERSION}"`));
  assert.equal(plan.outputs.pkg.includes('\r\n'), inputs.pkg.includes('\r\n'));

  const oldLock = JSON.parse(inputs.lock);
  const newLock = JSON.parse(plan.outputs.lock);
  assert.equal(newLock.version, TEST_VERSION);
  assert.equal(newLock.packages[''].version, TEST_VERSION);
  oldLock.version = TEST_VERSION;
  oldLock.packages[''].version = TEST_VERSION;
  assert.deepEqual(newLock, oldLock);
  assert.equal(plan.outputs.lock.includes('\r\n'), inputs.lock.includes('\r\n'));

  assert.equal(plan.outputs.sw, inputs.sw.replace(`APP_VERSION = '${current}'`, `APP_VERSION = '${TEST_VERSION}'`));

  const oldLines = linesOf(inputs.changelog);
  const newLines = linesOf(plan.outputs.changelog);
  const unreleased = oldLines.indexOf('## [Unreleased]');
  assert.deepEqual(newLines.slice(0, unreleased + 1), oldLines.slice(0, unreleased + 1));
  assert.equal(newLines[unreleased + 1], '');
  assert.equal(newLines[unreleased + 2], `## [${TEST_VERSION}] - ${TEST_DATE}`);
  assert.equal(newLines[unreleased + 3], '');
  assert.deepEqual(newLines.slice(unreleased + 4, unreleased + 6), ['### Fixed', '- Test entry.']);
  const previous = oldLines.findIndex((line) => line.startsWith(`## [${current}]`));
  assert.deepEqual(newLines.slice(newLines.length - (oldLines.length - previous)), oldLines.slice(previous));
  assert.equal(plan.outputs.changelog.includes('\r\n'), inputs.changelog.includes('\r\n'));
});

test('promoted real CHANGELOG satisfies the newest-released-section check of pwa.test.js', () => {
  const plan = planRelease(readRealInputs(), TEST_VERSION, new Date(2030, 0, 2));
  // Same pattern as readLatestReleasedVersion in tests/pwa.test.js.
  const match = plan.outputs.changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  assert.ok(match);
  assert.equal(match[1], TEST_VERSION);
  assert.equal(JSON.parse(plan.outputs.pkg).version, match[1]);
  assert.ok(plan.outputs.sw.includes(`APP_VERSION = '${match[1]}'`));
});

test('planRelease refuses a target that is not greater than the current version', () => {
  const inputs = readRealInputs();
  const current = JSON.parse(inputs.pkg).version;
  assert.throws(() => planRelease(inputs, current), /not greater/);
  assert.throws(() => planRelease(inputs, '0.0.1'), /not greater/);
});

test('planRelease refuses when version sources disagree', () => {
  const inputs = readRealInputs();
  const current = JSON.parse(inputs.pkg).version;
  const drifted = { ...inputs, sw: inputs.sw.replace(`'${current}'`, "'0.0.1'") };
  assert.throws(() => planRelease(drifted, 'patch'), /disagree/);
  const lock = JSON.parse(inputs.lock);
  lock.packages[''].version = '0.0.1';
  const driftedLock = { ...inputs, lock: `${JSON.stringify(lock, null, 2)}\n` };
  assert.throws(() => planRelease(driftedLock, 'patch'), /disagree/);
});

test('planRelease writes nothing when one output fails (empty Unreleased)', () => {
  const inputs = { ...readRealInputs(), changelog: '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n' };
  assert.throws(() => planRelease(inputs, 'patch'), /empty/);
});
