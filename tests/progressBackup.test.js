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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { exportProgress, importProgress, parseProgress, recoverProgressImport } from '../src/core/ProgressBackup.js';

const storageConfig = {
  prefix: 'game_',
  keys: {
    unlockedLevel: 'unlocked',
    levelStats: 'level_stats',
    dailyHistory: 'daily_history',
    dailyBestDate: 'daily_best_date',
    weeklyFluxClaimedWeek: 'weekly_claimed',
    activeBallStyle: 'style',
    versusTutorialSeen: 'versus_tutorial_seen',
    coins: 'coins',
    muted: 'muted',
    runSnapshot: 'run_snapshot'
  },
  progressBackup: {
    format: 'magnashot-progress',
    version: 1,
    maxBytes: 4096,
    journalKey: 'progress_import_journal',
    fields: {
      unlockedLevel: 'integer',
      levelStats: 'object',
      dailyHistory: 'array',
      dailyBestDate: 'date',
      weeklyFluxClaimedWeek: 'week',
      activeBallStyle: 'string',
      versusTutorialSeen: 'boolean',
      coins: 'integer'
    }
  }
};

const key = (field) => storageConfig.prefix + storageConfig.keys[field];
const journalKey = storageConfig.prefix + storageConfig.progressBackup.journalKey;
const payload = (fields) => JSON.stringify({
  format: storageConfig.progressBackup.format,
  version: storageConfig.progressBackup.version,
  fields
});

class MemoryStorage {
  constructor(initial = [], beforeWrite = () => {}) {
    this.entries = new Map(initial);
    this.beforeWrite = beforeWrite;
  }

  getItem(name) {
    return this.entries.get(name) ?? null;
  }

  setItem(name, value) {
    this.beforeWrite(name, value);
    this.entries.set(name, value);
  }

  removeItem(name) {
    this.beforeWrite(name, null);
    this.entries.delete(name);
  }
}

test('Every shipped portable field maps to a real storage key and survives export', () => {
  const { storage: config } = JSON.parse(readFileSync(new URL('../configs/game.json', import.meta.url), 'utf8'));
  const samples = {
    integer: '18',
    object: '{}',
    array: '[]',
    date: '2026-11-11',
    week: '2026-W46',
    string: 'classic',
    optionalString: '',
    boolean: 'true'
  };
  const fields = Object.entries(config.progressBackup.fields);
  assert.ok(fields.every(([field, type]) => Object.hasOwn(config.keys, field) && Object.hasOwn(samples, type)));
  const storage = new MemoryStorage(fields.map(([field, type]) => [config.prefix + config.keys[field], samples[type]]));
  const roundTrip = parseProgress(exportProgress(storage, config), config);
  assert.deepEqual(roundTrip.fields, Object.fromEntries(fields.map(([field, type]) => [field, samples[type]])));
});

test('Progress backup round-trips allowlisted storage values without overwriting absent fields or device state', () => {
  const portable = {
    unlockedLevel: '18',
    levelStats: '{"1":{"stars":3,"bestScore":500}}',
    dailyHistory: '[{"d":"2026-11-11","s":150}]',
    dailyBestDate: '2026-11-11',
    weeklyFluxClaimedWeek: '2026-W46',
    activeBallStyle: 'crystal',
    versusTutorialSeen: 'true'
  };
  const origin = new MemoryStorage([
    ...Object.entries(portable).map(([field, value]) => [key(field), value]),
    [key('muted'), 'false'],
    [key('runSnapshot'), '{"mode":"merge"}'],
    ['another_app', 'private data']
  ]);
  const unrelated = [
    [key('muted'), 'true'],
    [key('coins'), '10'],
    [key('runSnapshot'), '{"mode":"campaign"}'],
    ['another_app', 'original']
  ];
  const destination = new MemoryStorage([[key('unlockedLevel'), '4'], ...unrelated]);
  const exported = exportProgress(origin, storageConfig);
  assert.deepEqual(JSON.parse(exported), JSON.parse(payload(portable)));
  const parsed = parseProgress(exported, storageConfig);
  assert.equal(parsed.count, Object.keys(portable).length);
  assert.equal(importProgress(destination, storageConfig, parsed), parsed.count);
  assert.deepEqual(destination.entries, new Map([
    ...Object.entries(portable).map(([field, value]) => [key(field), value]),
    ...unrelated
  ]));
  assert.equal(importProgress(destination, storageConfig, parsed), 0);
  assert.equal(recoverProgressImport(destination, storageConfig), false);
});

test('Progress backup rejects unsafe fields, bad stored shapes and unsupported envelopes', () => {
  const invalidFields = [
    { muted: 'false' },
    { runSnapshot: '{}' },
    { unlockedLevel: 18 },
    { unlockedLevel: '-1' },
    { unlockedLevel: '1e8' },
    { unlockedLevel: String(Number.MAX_SAFE_INTEGER + 1) },
    { levelStats: '[]' },
    { dailyHistory: '{}' },
    { dailyBestDate: '2026-02-31' },
    { weeklyFluxClaimedWeek: '2026-W00' },
    { versusTutorialSeen: 'yes' },
    { levelStats: '{"a":{"__proto__":{"polluted":true}}}' },
    { levelStats: '{"a":{"constructor":{"prototype":{}}}}' },
    { levelStats: '{"a":1e500}' }
  ];
  for (const fields of invalidFields) {
    assert.throws(() => parseProgress(payload(fields), storageConfig), { name: 'TypeError' });
  }
  const backup = JSON.parse(payload({ unlockedLevel: '18' }));
  assert.throws(() => parseProgress(JSON.stringify({ ...backup, version: backup.version + 1 }), storageConfig));
  assert.throws(() => parseProgress(JSON.stringify({ ...backup, extra: true }), storageConfig));
  assert.throws(() => parseProgress('{"format":', storageConfig), { name: 'SyntaxError' });
  assert.equal(parseProgress(exportProgress(new MemoryStorage(), storageConfig), storageConfig).count, 0);
});

test('Progress backup applies its limit to UTF-8 bytes and revalidates fields at the write boundary', () => {
  const encoded = payload({ activeBallStyle: String.fromCodePoint(0x1f680) });
  const tightConfig = {
    ...storageConfig,
    progressBackup: { ...storageConfig.progressBackup, maxBytes: encoded.length }
  };
  assert.throws(() => parseProgress(encoded, tightConfig), { name: 'RangeError' });
  const untouched = new MemoryStorage([[key('unlockedLevel'), '18']]);
  assert.throws(() => importProgress(untouched, storageConfig, {
    fields: { unlockedLevel: '2', muted: 'false' }
  }), { name: 'TypeError' });
  assert.deepEqual(untouched.entries, new Map([[key('unlockedLevel'), '18']]));
});

test('Progress import restores changed and newly created keys when a storage write fails', () => {
  const initial = [[key('unlockedLevel'), '4'], [key('muted'), 'true']];
  const destination = new MemoryStorage(initial, (name) => {
    if (name === key('coins')) {
      throw new Error('Injected quota failure');
    }
  });
  const parsed = parseProgress(payload({ unlockedLevel: '18', levelStats: '{}', coins: '500' }), storageConfig);
  assert.throws(() => importProgress(destination, storageConfig, parsed), /Injected quota failure/);
  assert.deepEqual(destination.entries, new Map(initial));
});

test('A journal write failure leaves the destination byte-for-byte intact', () => {
  const initial = [[key('unlockedLevel'), '4'], [key('muted'), 'true']];
  const destination = new MemoryStorage(initial, (name) => {
    assert.equal(name, journalKey, 'No progression writes can happen before the journal is stored');
    throw new Error('Injected quota failure');
  });
  const parsed = parseProgress(payload({ unlockedLevel: '18' }), storageConfig);
  assert.throws(() => importProgress(destination, storageConfig, parsed), /Injected quota failure/);
  assert.deepEqual(destination.entries, new Map(initial));
});

test('A failed immediate rollback keeps the before-image for recovery after reload', () => {
  const initial = [[key('unlockedLevel'), '4'], [key('muted'), 'true']];
  let failed = false;
  const destination = new MemoryStorage(initial, (name) => {
    if (name === key('coins') || failed) {
      failed = true;
      throw new Error('Injected storage outage');
    }
  });
  const parsed = parseProgress(payload({ unlockedLevel: '18', coins: '500' }), storageConfig);
  assert.throws(() => importProgress(destination, storageConfig, parsed), { name: 'AggregateError' });
  assert.equal(destination.getItem(key('unlockedLevel')), '18');
  assert.ok(destination.getItem(journalKey));
  assert.throws(() => importProgress(destination, storageConfig, parsed), /previous progress import needs recovery/);

  const reopened = new MemoryStorage(destination.entries);
  assert.equal(recoverProgressImport(reopened, storageConfig), true);
  assert.deepEqual(reopened.entries, new Map(initial));
  assert.equal(recoverProgressImport(reopened, storageConfig), false);
});

test('Shipped backup config round-trips bounties, ghostDuels, and both empty and non-empty ghostAlias', () => {
  const { storage: shipped } = JSON.parse(readFileSync(new URL('../configs/game.json', import.meta.url), 'utf8'));
  const origin = new MemoryStorage([
    [shipped.prefix + shipped.keys.bounties, '{"dateKey":"2026-11-13","items":[{"id":"merge_fusions","completed":true}]}'],
    [shipped.prefix + shipped.keys.ghostDuels, '[{"outcome":"win","gap":120}]'],
    [shipped.prefix + shipped.keys.ghostAlias, '']
  ]);
  const exported = exportProgress(origin, shipped);
  const parsed = parseProgress(exported, shipped);
  assert.equal(parsed.fields.ghostAlias, '');
  assert.match(parsed.fields.bounties, /merge_fusions/);
  assert.match(parsed.fields.ghostDuels, /win/);

  const dest = new MemoryStorage([[shipped.prefix + shipped.keys.ghostAlias, 'OldAlias']]);
  assert.equal(importProgress(dest, shipped, parsed), 3);
  assert.equal(dest.getItem(shipped.prefix + shipped.keys.ghostAlias), '');
  assert.equal(dest.getItem(shipped.prefix + shipped.keys.bounties), origin.getItem(shipped.prefix + shipped.keys.bounties));
  assert.equal(dest.getItem(shipped.prefix + shipped.keys.ghostDuels), origin.getItem(shipped.prefix + shipped.keys.ghostDuels));
});
