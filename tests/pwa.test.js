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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Directories whose every file must be available offline
const OFFLINE_DIRECTORIES = ['src', 'configs', 'locales', 'icons', 'styles'];

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(directory, entry.name)) : [join(directory, entry.name)]
  );
}

function readPrecacheList() {
  const source = readFileSync(join(REPO_ROOT, 'sw.js'), 'utf8');
  return [...source.matchAll(/'\.\/([^']*)'/g)].map((match) => match[1]).filter(Boolean);
}

test('Service worker precaches every runtime asset and nothing missing', () => {
  const precached = readPrecacheList();
  const runtimeFiles = OFFLINE_DIRECTORIES.flatMap((dir) => listFiles(join(REPO_ROOT, dir))).map((file) =>
    relative(REPO_ROOT, file).split('\\').join('/')
  );
  assert.deepEqual(runtimeFiles.filter((file) => !precached.includes(file)), []);
  assert.deepEqual(precached.filter((file) => !existsSync(join(REPO_ROOT, file))), []);
});

test('Service worker and data loaders revalidate instead of trusting the HTTP cache', () => {
  const sw = readFileSync(join(REPO_ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /NETWORK_FETCH_OPTIONS = Object\.freeze\(\{ cache: 'no-cache' \}\)/);
  assert.match(sw, /fetch\(request, NETWORK_FETCH_OPTIONS\)/);
  assert.match(sw, /new Request\(url, PRECACHE_FETCH_OPTIONS\)/);
  for (const file of ['src/core/ConfigRegistry.js', 'src/core/I18n.js']) {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8');
    assert.match(source, /fetch\(path, DATA_FETCH_OPTIONS\)/, file);
  }
});

test('Service worker cache version matches package.json version', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  const source = readFileSync(join(REPO_ROOT, 'sw.js'), 'utf8');
  assert.ok(source.includes(`APP_VERSION = '${pkg.version}'`));
});

test('index.html declares a Content-Security-Policy meta tag', () => {
  const html = readFileSync(join(REPO_ROOT, 'index.html'), 'utf8');
  assert.match(html, /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*default-src 'self'[^"]*"/);
});

/** Version of the newest released section of CHANGELOG.md, skipping [Unreleased]. */
function readLatestReleasedVersion() {
  const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
  const match = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  return match ? match[1] : null;
}

test('package.json version is the newest released CHANGELOG section', () => {
  // A release bumps package.json, sw.js and the CHANGELOG together; this catches a release
  // that ships changed assets under the previous version number and cache name.
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(readLatestReleasedVersion(), pkg.version);
});

/** Runs sw.js in a vm with fake worker globals and returns its listeners and fakes. */
function loadServiceWorker({ cacheKeys = [], fetchImpl } = {}) {
  const listeners = {};
  const deleted = [];
  const puts = [];
  const cache = {
    addAll: async () => undefined,
    put: async (key, response) => {
      puts.push({ key, response });
    },
    match: async () => undefined,
  };
  const fakeSelf = {
    location: { origin: 'https://example.test' },
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
    skipWaiting: () => undefined,
    clients: { claim: () => undefined },
  };
  const context = vm.createContext({
    self: fakeSelf,
    caches: {
      keys: async () => [...cacheKeys],
      delete: async (key) => {
        deleted.push(key);
        return true;
      },
      open: async () => cache,
      match: async () => undefined,
    },
    fetch: fetchImpl ?? (async () => ({ status: 200, clone: () => ({ cloned: true }) })),
    Request: class {
      constructor(url) {
        this.url = url;
      }
    },
    URL,
    Promise,
    Object,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(readFileSync(join(REPO_ROOT, 'sw.js'), 'utf8'), context);
  return { listeners, deleted, puts };
}

test('Service worker activation deletes only the stale caches of this app', async () => {
  const version = readFileSync(join(REPO_ROOT, 'sw.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
  const sw = loadServiceWorker({
    cacheKeys: ['other-app-v1', 'flux-spheres-cache-v3', `magnashot-cache-v${version}`],
  });
  let pending;
  sw.listeners.activate({ waitUntil: (promise) => (pending = promise) });
  await pending;
  assert.deepEqual(sw.deleted, ['flux-spheres-cache-v3']);
});

test('Service worker activation keeps the current cache and foreign caches', async () => {
  const version = readFileSync(join(REPO_ROOT, 'sw.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
  const sw = loadServiceWorker({ cacheKeys: [`magnashot-cache-v${version}`, 'other-app-v1'] });
  let pending;
  sw.listeners.activate({ waitUntil: (promise) => (pending = promise) });
  await pending;
  assert.deepEqual(sw.deleted, []);
});

test('Service worker runtime cache stores one entry per path, without the query string', async () => {
  const sw = loadServiceWorker();
  let pending;
  const request = { method: 'GET', url: 'https://example.test/src/main.js?v=123' };
  sw.listeners.fetch({
    request,
    waitUntil: (promise) => (pending = promise),
    respondWith: () => undefined,
  });
  await pending;
  assert.equal(sw.puts.length, 1);
  assert.equal(sw.puts[0].key, 'https://example.test/src/main.js');
});

test('Content-Security-Policy does not allow inline styles', () => {
  const html = readFileSync(join(REPO_ROOT, 'index.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)[1];
  const styleSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('style-src'));
  assert.ok(styleSrc, 'style-src directive is present');
  assert.ok(!styleSrc.includes('unsafe-inline'));
});
