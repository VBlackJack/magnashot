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
import { configRegistry } from '../src/core/ConfigRegistry.js';
import { StorageManager } from '../src/core/StorageManager.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('levels', loadJson('./configs/levels.json'));
configRegistry.configs.set('campaign', loadJson('./configs/campaign.json'));

const { prefix, keys } = gameConfig.storage;
const DUELS_KEY = `${prefix}${keys.ghostDuels}`;
const ALIAS_KEY = `${prefix}${keys.ghostAlias}`;
const { historyMaxEntries, aliasMaxLength } = gameConfig.ghostDuel;
const EXTRA_ENTRIES = 5;
const DATE_KEY = '2026-11-08';

const createFakeStorage = () => {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); },
    clear() { data.clear(); }
  };
};

const withManager = (seed, fn) => {
  const storage = createFakeStorage();
  seed?.(storage);
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    const manager = new StorageManager();
    manager.init();
    return fn(manager, storage);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  }
};

const duel = (overrides = {}) => ({
  mode: 'flux',
  key: 'abc123',
  alias: 'Sam',
  ghostScore: 1000,
  myScore: 1200,
  outcome: 'won',
  dateKey: DATE_KEY,
  ...overrides
});

test('empty storage yields an empty history, a zero record and no alias', () => {
  withManager(null, (m) => {
    assert.deepEqual(m.getGhostDuels(), []);
    assert.deepEqual(m.getGhostDuelRecord(), { won: 0, lost: 0, tie: 0 });
    assert.equal(m.getGhostAlias(), '');
  });
});

test('recordGhostDuel stores newest first and bounds the history', () => {
  withManager(null, (m) => {
    for (let i = 0; i < historyMaxEntries + EXTRA_ENTRIES; i += 1) {
      assert.equal(m.recordGhostDuel(duel({ myScore: i })), true);
    }
    const history = m.getGhostDuels();
    assert.equal(history.length, historyMaxEntries);
    assert.equal(history[0].myScore, historyMaxEntries + EXTRA_ENTRIES - 1);
    assert.equal(history.at(-1).myScore, EXTRA_ENTRIES);
  });
});

test('recordGhostDuel rejects invalid results without writing', () => {
  withManager(null, (m, storage) => {
    const bad = [
      duel({ mode: 'purist' }), duel({ outcome: 'draw' }), duel({ key: 'a/b' }), duel({ key: '' }),
      duel({ dateKey: '2026/11/08' }), duel({ ghostScore: -1 }), duel({ myScore: 1.5 }),
      duel({ myScore: gameConfig.ghostDuel.maxScore + 1 }), null, 'x'
    ];
    for (const entry of bad) {
      assert.equal(m.recordGhostDuel(entry), false);
    }
    assert.equal(storage.getItem(DUELS_KEY), null);
  });
});

test('stored aliases are sanitized and a missing alias stays valid', () => {
  withManager(null, (m) => {
    m.recordGhostDuel(duel({ alias: '  Sam   <b>Jo</b>  ' }));
    m.recordGhostDuel(duel({ alias: undefined, myScore: 2 }));
    const [second, first] = m.getGhostDuels();
    assert.match(first.alias, /^[\p{L}\p{N} ]+$/u);
    assert.ok(!first.alias.includes('<'));
    assert.equal(second.alias, '');
  });
});

test('corrupt or foreign data reads as empty and bad entries are dropped', () => {
  for (const raw of ['{not json', '{"a":1}', 'null', '42']) {
    withManager((s) => s.setItem(DUELS_KEY, raw), (m) => {
      assert.deepEqual(m.getGhostDuels(), []);
      assert.deepEqual(m.getGhostDuelRecord(), { won: 0, lost: 0, tie: 0 });
    });
  }
  const mixed = [duel(), { mode: 'daily' }, null, 7, duel({ outcome: 'lost', myScore: 5 })];
  withManager((s) => s.setItem(DUELS_KEY, JSON.stringify(mixed)), (m) => {
    assert.equal(m.getGhostDuels().length, 2);
    assert.deepEqual(m.getGhostDuelRecord(), { won: 1, lost: 1, tie: 0 });
  });
});

test('an oversized stored history is cut to the configured bound on read', () => {
  const many = Array.from({ length: historyMaxEntries * 3 }, (_, i) => duel({ myScore: i }));
  withManager((s) => s.setItem(DUELS_KEY, JSON.stringify(many)), (m) => {
    assert.equal(m.getGhostDuels().length, historyMaxEntries);
  });
});

test('getGhostDuelRecord counts each outcome', () => {
  withManager(null, (m) => {
    m.recordGhostDuel(duel({ outcome: 'won' }));
    m.recordGhostDuel(duel({ outcome: 'won', myScore: 3 }));
    m.recordGhostDuel(duel({ outcome: 'lost', myScore: 4 }));
    m.recordGhostDuel(duel({ outcome: 'tie', myScore: 1000 }));
    assert.deepEqual(m.getGhostDuelRecord(), { won: 2, lost: 1, tie: 1 });
  });
});

test('retractLastGhostDuel only removes a matching newest entry', () => {
  withManager(null, (m) => {
    m.recordGhostDuel(duel({ key: 'older', myScore: 10 }));
    m.recordGhostDuel(duel({ key: 'newer', myScore: 20 }));
    assert.equal(m.retractLastGhostDuel({ mode: 'flux', key: 'older', dateKey: DATE_KEY }), false);
    assert.equal(m.retractLastGhostDuel({ mode: 'daily', key: 'newer', dateKey: DATE_KEY }), false);
    assert.equal(m.retractLastGhostDuel({ mode: 'flux', key: 'newer', dateKey: '2026-11-07' }), false);
    assert.equal(m.retractLastGhostDuel({ mode: 'flux', key: 'newer', dateKey: DATE_KEY, myScore: 99 }), false);
    assert.equal(m.getGhostDuels().length, 2);
    assert.equal(m.retractLastGhostDuel({ mode: 'flux', key: 'newer', dateKey: DATE_KEY, myScore: 20 }), true);
    assert.deepEqual(m.getGhostDuels().map((e) => e.key), ['older']);
    assert.equal(m.retractLastGhostDuel(null), false);
    assert.equal(m.retractLastGhostDuel({ mode: 'flux', key: 'older', dateKey: DATE_KEY }), true);
    assert.equal(m.retractLastGhostDuel({ mode: 'flux', key: 'older', dateKey: DATE_KEY }), false);
    assert.deepEqual(m.getGhostDuels(), []);
  });
});

test('alias round trip is sanitized and clears on empty input', () => {
  withManager(null, (m, storage) => {
    assert.equal(m.setGhostAlias('  Ana   Lou  '), 'Ana Lou');
    assert.equal(m.getGhostAlias(), 'Ana Lou');
    assert.ok(!/[./\\]/.test(m.setGhostAlias('a.b/c\\d')));
    assert.equal(m.setGhostAlias('x'.repeat(aliasMaxLength * 2)).length, aliasMaxLength);
    assert.equal(m.setGhostAlias(42), '');
    assert.equal(m.getGhostAlias(), '');
    assert.equal(storage.getItem(ALIAS_KEY), '');
  });
});

test('a tampered stored alias is sanitized on read', () => {
  withManager((s) => s.setItem(ALIAS_KEY, '<script>x</script> y'), (m) => {
    assert.match(m.getGhostAlias(), /^[\p{L}\p{N} ]{1,12}$/u);
    assert.ok(!m.getGhostAlias().includes('<'));
  });
});
