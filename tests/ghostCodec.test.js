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
import { readFileSync } from 'node:fs';
import { SeededRandom } from '../src/core/SeededRandom.js';
import { FLUX_SEED_QUERY_PARAM } from '../src/game/DailyShare.js';
import {
  DUEL_STATUS,
  buildDuelUrl,
  decodeGhost,
  encodeGhost,
  fnv1a16,
  ghostFromTimeline,
  readDuelFromSearch,
  resolveReplayContentVersion,
  sanitizeAlias,
  stripDuelFromUrl
} from '../src/game/GhostCodec.js';

const gameConfig = JSON.parse(readFileSync(new URL('../configs/game.json', import.meta.url), 'utf8'));
const fluxConfig = JSON.parse(readFileSync(new URL('../configs/flux.json', import.meta.url), 'utf8'));

// Values of the `ghostDuel` section as decided in the spec.
const cfg = {
  queryParam: 'duel',
  codecVersion: 1,
  contentVersion: { daily: 1, flux: 2 },
  maxUrlLength: 1500,
  maxPayloadChars: 1200,
  maxSamples: 20000,
  maxStepLog2: 15,
  maxScore: 1000000000,
  dailyMaxAgeDays: 30,
  aliasMaxLength: 12,
  historyMaxEntries: 10,
  announceMinShots: 3
};

const TODAY = '2026-12-20';
const ctx = {
  todayKey: TODAY,
  epochDateKey: gameConfig.share.epochDateKey,
  seed: { length: fluxConfig.seed.length, radix: fluxConfig.seed.radix },
  maxPoints: gameConfig.shotTimeline.maxPoints,
  fluxParam: FLUX_SEED_QUERY_PARAM
};
const BASE_URL = 'https://example.test/magnashot/';
const FLUX_SEED = '4f2a1c';
const FUZZ_ROUNDS = 5000;
const MAX_POINTS = ctx.maxPoints;

function makeScores(count, seedText, maxStepScore = 9000) {
  const rng = new SeededRandom(seedText);
  const scores = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(rng.next() * maxStepScore);
    scores.push(total);
  }
  return scores;
}

function makeGhost(overrides = {}) {
  const step = overrides.step ?? 1;
  const n = overrides.n ?? 12;
  const s = overrides.s ?? makeScores(Math.ceil(n / step), `ghost-${step}-${n}`);
  return {
    mode: 'daily',
    key: TODAY,
    cv: 1,
    n,
    step,
    s,
    final: s[s.length - 1],
    assists: { workshop: 2, ammo: 1, continues: 0, tiltFree: false },
    alias: '',
    ...overrides
  };
}

function fluxGhost(overrides = {}) {
  return makeGhost({ mode: 'flux', key: FLUX_SEED, ...overrides });
}

function encode(ghost) {
  const payload = encodeGhost(ghost, cfg, ctx);
  assert.equal(typeof payload, 'string', 'ghost must be encodable');
  return payload;
}

function decode(payload, overrideCtx = ctx) {
  return decodeGhost(payload, cfg, overrideCtx);
}

function toBytes(payload) {
  return Uint8Array.from(Buffer.from(payload, 'base64url'));
}

function fromBytes(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

/** Rebuilds a payload from a body (without checksum) with a valid checksum appended. */
function seal(bodyBytes) {
  const checksum = fnv1a16(bodyBytes);
  return fromBytes([...bodyBytes, checksum >> 8, checksum & 0xff]);
}

function bodyOf(payload) {
  const bytes = toBytes(payload);
  return [...bytes.subarray(0, bytes.length - 2)];
}

function assertInvalid(payload, message) {
  assert.equal(decode(payload).status, DUEL_STATUS.INVALID, message);
}

test('round trip: Daily ghost keeps every field', () => {
  const ghost = makeGhost({ alias: 'Sam' });
  const result = decode(encode(ghost));
  assert.equal(result.status, DUEL_STATUS.VALID);
  assert.deepEqual(result.ghost, { ...ghost, final: ghost.s[ghost.s.length - 1] });
});

test('round trip: Flux ghost keeps seed with leading zeros', () => {
  const ghost = fluxGhost({ key: '00a1zz', assists: { workshop: 0, ammo: 0, continues: 3, tiltFree: true } });
  const result = decode(encode(ghost));
  assert.equal(result.status, DUEL_STATUS.VALID);
  assert.deepEqual(result.ghost, ghost);
});

test('round trip: every step size from 1 to 8, with exact and partial last points', () => {
  for (const step of [1, 2, 4, 8]) {
    for (const n of [1, step, step + 1, step * 7, step * 7 + step - 1]) {
      const ghost = makeGhost({ step, n });
      const result = decode(encode(ghost));
      assert.equal(result.status, DUEL_STATUS.VALID, `step ${step} n ${n}`);
      assert.deepEqual(result.ghost, ghost);
    }
  }
});

test('round trip: 1 point and the maximum point count', () => {
  const one = makeGhost({ n: 1, step: 1 });
  assert.equal(decode(encode(one)).status, DUEL_STATUS.VALID);
  const full = fluxGhost({ n: MAX_POINTS * 2, step: 2 });
  assert.equal(full.s.length, MAX_POINTS);
  assert.deepEqual(decode(encode(full)).ghost, full);
});

test('round trip: large step and zero-score points', () => {
  const ghost = makeGhost({ n: 20000, step: 2 ** 15, s: [0] });
  assert.equal(decode(encode(makeGhost({ n: 20000, step: 2 ** 14, s: [0, 5] }))).status, DUEL_STATUS.VALID);
  assert.deepEqual(decode(encode(ghost)).ghost, ghost);
});

test('round trip: Unicode alias', () => {
  for (const alias of ['Ren\u00e9e', '\u65e5\u672c\u8a9e', 'Zo\u00eb 42', 'a b', '\u{1d400}\u{1d401}']) {
    const ghost = makeGhost({ alias });
    const result = decode(encode(ghost));
    assert.equal(result.status, DUEL_STATUS.VALID, alias);
    assert.equal(result.ghost.alias, alias);
  }
});

test('payloads use only the base64url alphabet', () => {
  const payload = encode(makeGhost({ alias: 'Ren\u00e9e' }));
  assert.match(payload, /^[A-Za-z0-9_-]+$/);
});

test('worst case stays within the payload and URL budgets', () => {
  const worst = fluxGhost({
    n: cfg.maxSamples,
    step: 2 ** 8,
    s: makeScores(MAX_POINTS, 'worst', Math.floor(cfg.maxScore / MAX_POINTS)),
    alias: '\u{1d400}'.repeat(cfg.aliasMaxLength),
    cv: 2 ** 20,
    assists: { workshop: 99999, ammo: 99999, continues: 99999, tiltFree: true }
  });
  worst.n = Math.min(worst.n, MAX_POINTS * worst.step);
  worst.s = worst.s.slice(0, Math.ceil(worst.n / worst.step));
  worst.final = worst.s[worst.s.length - 1];
  const payload = encode(worst);
  assert.ok(payload.length <= cfg.maxPayloadChars, `payload ${payload.length}`);
  const url = buildDuelUrl(BASE_URL, worst, cfg, ctx);
  assert.ok(url && url.length <= cfg.maxUrlLength, `url ${url?.length}`);
  assert.equal(decode(payload).status, DUEL_STATUS.VALID);
});

test('every truncation of a valid payload is rejected', () => {
  for (const ghost of [makeGhost({ alias: 'Sam' }), fluxGhost({ n: 200, step: 2 })]) {
    const payload = encode(ghost);
    for (let length = 0; length < payload.length; length++) {
      assert.notEqual(decode(payload.slice(0, length)).status, DUEL_STATUS.VALID, `length ${length}`);
    }
  }
});

test('every single-bit flip of a valid payload is rejected', () => {
  for (const ghost of [makeGhost({ alias: 'Sam' }), fluxGhost({ n: 40, step: 1 })]) {
    const bytes = toBytes(encode(ghost));
    for (let index = 0; index < bytes.length; index++) {
      for (let bit = 0; bit < 8; bit++) {
        const flipped = Uint8Array.from(bytes);
        flipped[index] ^= 1 << bit;
        assert.notEqual(decode(fromBytes(flipped)).status, DUEL_STATUS.VALID, `byte ${index} bit ${bit}`);
      }
    }
  }
});

test('single-character substitutions in the text are rejected', () => {
  const payload = encode(makeGhost({ alias: 'Sam' }));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let index = 0; index < payload.length; index++) {
    for (const char of alphabet) {
      if (char === payload[index]) {
        continue;
      }
      const mutated = payload.slice(0, index) + char + payload.slice(index + 1);
      assert.notEqual(decode(mutated).status, DUEL_STATUS.VALID, `index ${index} char ${char}`);
    }
  }
});

test('bad charset, padding, whitespace and non-strings are rejected', () => {
  const payload = encode(makeGhost());
  for (const bad of [`${payload}=`, `${payload} `, ` ${payload}`, `${payload}+`, `${payload}/`, `${payload}\n`, '', `${payload}\u00e9`]) {
    assertInvalid(bad, JSON.stringify(bad));
  }
  for (const bad of [null, undefined, 42, {}, [], true]) {
    assert.equal(decode(bad).status, DUEL_STATUS.INVALID);
  }
});

test('oversized payloads are rejected before decoding', () => {
  assertInvalid('A'.repeat(cfg.maxPayloadChars + 1));
  assertInvalid('A'.repeat(cfg.maxPayloadChars * 50));
});

test('trailing bytes after the alias or assists are rejected', () => {
  const body = bodyOf(encode(makeGhost()));
  assertInvalid(seal([...body, 0]));
  const withAlias = bodyOf(encode(makeGhost({ alias: 'Sam' })));
  assertInvalid(seal([...withAlias, 7]));
});

test('point count must equal ceil(n / step)', () => {
  const ghost = makeGhost({ n: 12, step: 1 });
  const body = bodyOf(encode(ghost));
  // Layout: version, flags, cv(1), key(2 bytes for small day offsets), n, pointCount.
  const pointCountIndex = body.indexOf(ghost.s.length, 4);
  assert.ok(pointCountIndex > 0);
  const tampered = [...body];
  tampered[pointCountIndex] = ghost.s.length - 1;
  assertInvalid(seal(tampered));
  assert.equal(encodeGhost({ ...ghost, s: ghost.s.slice(1) }, cfg, ctx), null);
  assert.equal(encodeGhost({ ...ghost, n: 13 }, cfg, ctx), null);
});

test('caps: points, samples, step, score', () => {
  assert.equal(encodeGhost(makeGhost({ n: MAX_POINTS + 1, step: 1 }), cfg, ctx), null);
  assert.equal(encodeGhost(makeGhost({ n: cfg.maxSamples + 1, step: 2 ** 15 }), cfg, ctx), null);
  assert.equal(encodeGhost(makeGhost({ n: 4, step: 2 ** 16, s: [1] }), cfg, ctx), null);
  assert.equal(encodeGhost(makeGhost({ n: 3, step: 1, s: [1, 2, cfg.maxScore + 1] }), cfg, ctx), null);
  assert.equal(encodeGhost(makeGhost({ n: 0, step: 1, s: [] }), cfg, ctx), null);
  assert.equal(encodeGhost(makeGhost({ n: 3, step: 3, s: [1] }), cfg, ctx), null);
  assert.equal(encodeGhost(makeGhost({ n: 3, step: 1, s: [5, 4, 6] }), cfg, ctx), null);
  const atCap = makeGhost({ n: 2, step: 1, s: [1, cfg.maxScore] });
  assert.equal(decode(encode(atCap)).status, DUEL_STATUS.VALID);
  // Decoder side: a hand-built body with a score above the cap and a valid checksum.
  const body = bodyOf(encode(makeGhost({ n: 1, step: 1, s: [1] })));
  const tooHigh = [...body];
  tooHigh.splice(tooHigh.length - 4, 1, 0x80, 0xc8, 0xaf, 0xa0, 0x04);
  assertInvalid(seal(tooHigh));
});

test('decoder rejects n above the sample cap even with a valid checksum', () => {
  const body = bodyOf(encode(makeGhost({ n: 1, step: 1, s: [1] })));
  const nIndex = body.length - 5;
  const tampered = [...body.slice(0, nIndex), 0xa1, 0x9c, 0x01, ...body.slice(nIndex + 1)];
  assertInvalid(seal(tampered));
});

test('bad UTF-8 in the alias is rejected', () => {
  const body = bodyOf(encode(makeGhost({ alias: 'Sam' })));
  const aliasStart = body.length - 3;
  const broken = [...body.slice(0, aliasStart), 0xff, 0xfe, 0xfd];
  assertInvalid(seal(broken));
});

test('alias charset, length and canonical form are enforced', () => {
  for (const alias of ['a.b', 'a/b', '<b>', 'x'.repeat(cfg.aliasMaxLength + 1), ' lead', 'trail ', 'two  spaces', 'tab\there', 'emoji\u{1f600}', 'a\u200bb']) {
    assert.equal(encodeGhost(makeGhost({ alias }), cfg, ctx), null, JSON.stringify(alias));
  }
  // Decoder side: alias bytes that decode as UTF-8 but violate the charset, with a valid checksum.
  const body = bodyOf(encode(makeGhost({ alias: 'abc' })));
  const hostile = [...body.slice(0, body.length - 3), ...new TextEncoder().encode('a/b')];
  assertInvalid(seal(hostile));
  const spaced = [...body.slice(0, body.length - 3), ...new TextEncoder().encode(' ab')];
  assertInvalid(seal(spaced));
  const zeroLength = [...body.slice(0, body.length - 4), 0];
  assertInvalid(seal(zeroLength));
});

test('alias flag without an alias, and reserved flag bits, are rejected', () => {
  const body = bodyOf(encode(makeGhost()));
  const flagged = [...body];
  flagged[1] |= 1 << 2;
  assertInvalid(seal(flagged));
  const badMode = [...body];
  badMode[1] = (badMode[1] & ~0b11) | 0b10;
  assertInvalid(seal(badMode));
});

test('Flux seed length and alphabet are enforced', () => {
  for (const key of ['abc', 'abcdefg', 'ABCDEF', 'ab-def', '']) {
    assert.equal(encodeGhost(fluxGhost({ key }), cfg, ctx), null, key);
  }
  // Decoder side: a key number that needs more characters than the configured length.
  const body = bodyOf(encode(fluxGhost({ key: 'zzzzzz', n: 1, step: 1, s: [1] })));
  const tooBig = [...body];
  // Replace the 5-byte varint of 36^6 - 1 with that of 36^6 (one more character).
  const tooBigValue = 36 ** 6;
  const varint = [];
  let rest = tooBigValue;
  while (rest >= 128) {
    varint.push((rest % 128) | 128);
    rest = Math.floor(rest / 128);
  }
  varint.push(rest);
  const original = [];
  rest = 36 ** 6 - 1;
  while (rest >= 128) {
    original.push((rest % 128) | 128);
    rest = Math.floor(rest / 128);
  }
  original.push(rest);
  const keyIndex = 3;
  assert.deepEqual(tooBig.slice(keyIndex, keyIndex + original.length), original);
  tooBig.splice(keyIndex, original.length, ...varint);
  assertInvalid(seal(tooBig));
});

test('non-canonical varints are rejected', () => {
  const body = bodyOf(encode(makeGhost({ n: 1, step: 1, s: [1] })));
  // contentVersion 1 written as 0x81 0x00 (overlong).
  const overlong = [...body.slice(0, 2), 0x81, 0x00, ...body.slice(3)];
  assertInvalid(seal(overlong));
  // Eight-byte-plus varint runs.
  const endless = [...body.slice(0, 2), 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01, ...body.slice(3)];
  assertInvalid(seal(endless));
});

test('Daily date window: today, oldest day and the day before are handled', () => {
  assert.equal(decode(encode(makeGhost({ key: TODAY }))).status, DUEL_STATUS.VALID);
  assert.equal(decode(encode(makeGhost({ key: '2026-11-20' }))).status, DUEL_STATUS.VALID);
  assert.equal(decode(encode(makeGhost({ key: '2026-11-19' }))).status, DUEL_STATUS.EXPIRED);
  assert.equal(decode(encode(makeGhost({ key: '2026-12-21' }))).status, DUEL_STATUS.FUTURE);
  assert.equal(decode(encode(makeGhost({ key: '2026-11-19' }))).ghost, null);
});

test('Daily keys must be real dates on or after the epoch', () => {
  for (const key of ['2026-02-30', '2026-13-01', '2026-1-01', 'today', '2026-10-25']) {
    assert.equal(encodeGhost(makeGhost({ key }), cfg, ctx), null, key);
  }
  assert.ok(encodeGhost(makeGhost({ key: ctx.epochDateKey }), cfg, { ...ctx, todayKey: ctx.epochDateKey }));
});

test('Flux ghosts are not subject to the Daily date window', () => {
  const later = { ...ctx, todayKey: '2030-01-01' };
  assert.equal(decode(encode(fluxGhost()), later).status, DUEL_STATUS.VALID);
});

test('newer codec versions report newer, version 0 is invalid', () => {
  const body = bodyOf(encode(makeGhost()));
  assert.equal(decode(seal([cfg.codecVersion + 1, ...body.slice(1)])).status, DUEL_STATUS.NEWER);
  assert.equal(decode(fromBytes([255, 1, 2, 3, 4])).status, DUEL_STATUS.NEWER);
  assertInvalid(seal([0, ...body.slice(1)]));
});

test('incomplete or malformed ghosts are not encodable', () => {
  assert.equal(encodeGhost(null, cfg, ctx), null);
  assert.equal(encodeGhost({}, cfg, ctx), null);
  assert.equal(encodeGhost(makeGhost({ mode: 'purist' }), cfg, ctx), null);
  assert.equal(encodeGhost(makeGhost({ assists: null }), cfg, ctx), null);
  assert.equal(encodeGhost(makeGhost({ cv: -1 }), cfg, ctx), null);
  assert.equal(encodeGhost(makeGhost({ s: [1.5], n: 1, step: 1 }), cfg, ctx), null);
});

test('ghostFromTimeline builds an encodable ghost and rejects incomplete timelines', () => {
  const timeline = { v: 1, mode: 'daily', c: 1, n: 7, step: 2, s: [10, 40, 90, 100], b: [9, 8, 7, 6] };
  const run = { key: TODAY, cv: 1, alias: ' Sam  W ', assists: { workshop: 3, ammo: 2, continues: 1, tiltFree: true } };
  const ghost = ghostFromTimeline(timeline, run, cfg, ctx);
  assert.equal(ghost.final, 100);
  assert.equal(ghost.alias, 'Sam W');
  assert.deepEqual(ghost.assists, { workshop: 3, ammo: 2, continues: 1, tiltFree: true });
  assert.deepEqual(decode(encode(ghost)).ghost, ghost);
  assert.equal(ghostFromTimeline({ ...timeline, c: 0 }, run, cfg, ctx), null);
  assert.equal(ghostFromTimeline({ ...timeline, s: [], b: [] }, run, cfg, ctx), null);
  assert.equal(ghostFromTimeline(null, run, cfg, ctx), null);
  assert.equal(ghostFromTimeline(timeline, { ...run, key: 'not-a-date' }, cfg, ctx), null);
  const noAssists = ghostFromTimeline(timeline, { key: TODAY, cv: 1 }, cfg, ctx);
  assert.deepEqual(noAssists.assists, { workshop: 0, ammo: 0, continues: 0, tiltFree: false });
  assert.equal(noAssists.alias, '');
  const fluxTimeline = { ...timeline, mode: 'flux' };
  assert.equal(ghostFromTimeline(fluxTimeline, { key: FLUX_SEED, cv: 1 }, cfg, ctx).mode, 'flux');
});

test('sanitizeAlias trims, collapses, filters and truncates', () => {
  assert.equal(sanitizeAlias('  Sam   Smith ', cfg), 'Sam Smith');
  assert.equal(sanitizeAlias('a.b/c', cfg), 'abc');
  assert.equal(sanitizeAlias('<x>', cfg), 'x');
  assert.equal(sanitizeAlias('x'.repeat(40), cfg), 'x'.repeat(cfg.aliasMaxLength));
  assert.equal(sanitizeAlias('...', cfg), '');
  assert.equal(sanitizeAlias(null, cfg), '');
  assert.equal(sanitizeAlias(12, cfg), '');
  assert.equal(sanitizeAlias('Rene\u0301e', cfg), 'Ren\u00e9e');
  assert.equal(sanitizeAlias('abcdefghijk l', cfg), 'abcdefghijk');
  assert.equal(sanitizeAlias('\u{1d400}'.repeat(20), cfg), '\u{1d400}'.repeat(cfg.aliasMaxLength));
});

test('buildDuelUrl: Daily carries only the duel parameter', () => {
  const ghost = makeGhost({ alias: 'Sam' });
  const url = buildDuelUrl(BASE_URL, ghost, cfg, ctx);
  assert.equal(url, `${BASE_URL}?duel=${encode(ghost)}`);
  assert.deepEqual(readDuelFromSearch(url.slice(url.indexOf('?')), cfg, ctx).ghost, ghost);
});

test('buildDuelUrl: Flux adds the seed and replaces an existing duel or seed', () => {
  const ghost = fluxGhost();
  const url = buildDuelUrl(`${BASE_URL}?flux=${FLUX_SEED}&duel=old#top`, ghost, cfg, ctx);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('flux'), FLUX_SEED);
  assert.equal(parsed.searchParams.get('duel'), encode(ghost));
  assert.equal(parsed.searchParams.getAll('duel').length, 1);
  assert.equal(parsed.hash, '#top');
  assert.equal(readDuelFromSearch(parsed.search, cfg, ctx).status, DUEL_STATUS.VALID);
});

test('buildDuelUrl returns null for unencodable ghosts and over-long URLs', () => {
  assert.equal(buildDuelUrl(BASE_URL, makeGhost({ n: 0, s: [] }), cfg, ctx), null);
  assert.equal(buildDuelUrl(BASE_URL, makeGhost(), { ...cfg, maxUrlLength: 20 }, ctx), null);
  assert.equal(buildDuelUrl(null, makeGhost(), cfg, ctx), null);
});

test('stripDuelFromUrl removes only the duel parameter', () => {
  assert.equal(stripDuelFromUrl('/?duel=abc', cfg), '/');
  assert.equal(stripDuelFromUrl('/?flux=4f2a1c&duel=abc#x', cfg), '/?flux=4f2a1c#x');
  assert.equal(stripDuelFromUrl('/?flux=4f2a1c', cfg), '/?flux=4f2a1c');
  assert.equal(stripDuelFromUrl('/path', cfg), '/path');
  assert.equal(stripDuelFromUrl(null, cfg), null);
});

test('readDuelFromSearch statuses', () => {
  const daily = encode(makeGhost());
  assert.equal(readDuelFromSearch('', cfg, ctx).status, DUEL_STATUS.NONE);
  assert.equal(readDuelFromSearch(null, cfg, ctx).status, DUEL_STATUS.NONE);
  assert.equal(readDuelFromSearch('?other=1', cfg, ctx).status, DUEL_STATUS.NONE);
  assert.equal(readDuelFromSearch(`?duel=${daily}`, cfg, ctx).status, DUEL_STATUS.VALID);
  assert.equal(readDuelFromSearch(`?duel=${daily}#frag`, cfg, ctx).status, DUEL_STATUS.VALID);
  assert.equal(readDuelFromSearch('?duel=', cfg, ctx).status, DUEL_STATUS.INVALID);
  assert.equal(readDuelFromSearch('?duel=AAAAAAAA', cfg, ctx).status, DUEL_STATUS.INVALID);
  assert.equal(readDuelFromSearch(`?duel=${encode(makeGhost({ key: '2026-11-01' }))}`, cfg, ctx).status, DUEL_STATUS.EXPIRED);
  assert.equal(readDuelFromSearch(`?duel=${encode(makeGhost({ key: '2026-12-30' }))}`, cfg, ctx).status, DUEL_STATUS.FUTURE);
  const newer = seal([cfg.codecVersion + 1, ...bodyOf(daily).slice(1)]);
  assert.equal(readDuelFromSearch(`?duel=${newer}`, cfg, ctx).status, DUEL_STATUS.NEWER);
});

test('readDuelFromSearch drops a duel that disagrees with the flux parameter', () => {
  const flux = encode(fluxGhost());
  const daily = encode(makeGhost());
  const match = readDuelFromSearch(`?flux=${FLUX_SEED.toUpperCase()}&duel=${flux}`, cfg, ctx);
  assert.equal(match.status, DUEL_STATUS.VALID);
  const mismatch = readDuelFromSearch(`?flux=aaaaaa&duel=${flux}`, cfg, ctx);
  assert.deepEqual(mismatch, { status: DUEL_STATUS.NONE, ghost: null });
  assert.equal(readDuelFromSearch(`?flux=${FLUX_SEED}&duel=${daily}`, cfg, ctx).status, DUEL_STATUS.NONE);
  assert.equal(readDuelFromSearch(`?duel=${flux}`, cfg, ctx).status, DUEL_STATUS.VALID);
  assert.equal(readDuelFromSearch(`?flux=${FLUX_SEED}&duel=AAAAAAAA`, cfg, ctx).status, DUEL_STATUS.INVALID);
});

function randomString(rng, alphabet, maxLength) {
  const length = Math.floor(rng.next() * maxLength);
  let text = '';
  for (let i = 0; i < length; i++) {
    text += alphabet[Math.floor(rng.next() * alphabet.length)];
  }
  return text;
}

function assertSafeDecode(payload) {
  let result;
  assert.doesNotThrow(() => {
    result = decode(payload);
  }, JSON.stringify(payload));
  assert.ok(Object.values(DUEL_STATUS).includes(result.status));
  if (result.status === DUEL_STATUS.VALID) {
    assert.equal(encodeGhost(result.ghost, cfg, ctx), payload, 'accepted payload must be canonical');
    return true;
  }
  assert.equal(result.ghost, null);
  return false;
}

test('fuzz: random strings never throw and accepted payloads are canonical', () => {
  const rng = new SeededRandom('ghost-fuzz-random');
  const alphabets = [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=+/ \u00e9\u4e2d',
    'AQgw'
  ];
  for (let i = 0; i < FUZZ_ROUNDS; i++) {
    assertSafeDecode(randomString(rng, alphabets[i % alphabets.length], 300));
  }
});

test('fuzz: mutated valid payloads never throw and accepted ones are canonical', () => {
  const rng = new SeededRandom('ghost-fuzz-mutated');
  const seeds = [
    encode(makeGhost({ alias: 'Sam' })),
    encode(fluxGhost({ n: 200, step: 2 })),
    encode(makeGhost({ n: 1, step: 1, s: [0] })),
    encode(fluxGhost({ alias: 'Ren\u00e9e', n: 33, step: 4 }))
  ];
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let i = 0; i < FUZZ_ROUNDS; i++) {
    let text = seeds[i % seeds.length];
    const edits = 1 + Math.floor(rng.next() * 3);
    for (let e = 0; e < edits; e++) {
      const at = Math.floor(rng.next() * (text.length + 1));
      const kind = Math.floor(rng.next() * 4);
      const char = alphabet[Math.floor(rng.next() * alphabet.length)];
      if (kind === 0) {
        text = text.slice(0, at) + char + text.slice(at + 1);
      } else if (kind === 1) {
        text = text.slice(0, at) + text.slice(at + 1);
      } else if (kind === 2) {
        text = text.slice(0, at) + char + text.slice(at);
      } else {
        text = text.slice(0, at);
      }
    }
    assertSafeDecode(text);
  }
});

test('fuzz: body mutations with a recomputed checksum reach the semantic checks safely', () => {
  const rng = new SeededRandom('ghost-fuzz-sealed');
  const seeds = [
    encode(makeGhost({ alias: 'Sam' })),
    encode(fluxGhost({ n: 200, step: 2 })),
    encode(fluxGhost({ alias: 'Ren\u00e9e', n: 33, step: 4 }))
  ];
  let accepted = 0;
  let rejected = 0;
  const statusCounts = {};
  for (let i = 0; i < FUZZ_ROUNDS; i++) {
    const body = bodyOf(seeds[i % seeds.length]);
    const edits = 1 + Math.floor(rng.next() * 2);
    for (let e = 0; e < edits; e++) {
      const at = Math.floor(rng.next() * body.length);
      const kind = Math.floor(rng.next() * 3);
      if (kind === 0) {
        body[at] = Math.floor(rng.next() * 256);
      } else if (kind === 1) {
        body.splice(at, 1);
      } else {
        body.splice(at, 0, Math.floor(rng.next() * 256));
      }
    }
    const sealed = seal(body);
    if (body.length > 0 && assertSafeDecode(sealed)) {
      accepted += 1;
    } else {
      rejected += 1;
      const status = decode(sealed).status;
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
  }
  assert.ok(rejected > 0, 'mutated sealed payloads must hit the semantic checks');
  assert.equal(accepted + rejected, FUZZ_ROUNDS);
  assert.ok(accepted > 0, 'some mutations stay valid and must re-encode identically');
  assert.ok(Object.keys(statusCounts).length >= 2, 'rejections come from several semantic checks, not one');
  assert.ok(!(DUEL_STATUS.VALID in statusCounts), 'a rejected payload never reports a valid status');
});

test('a duel replays on its own content version, or on the one before the settled Flux shapes', () => {
  const duelCfg = gameConfig.ghostDuel;
  const settleCfg = fluxConfig.shapeSettle;
  const current = duelCfg.contentVersion.flux;
  const previous = settleCfg.sinceContentVersion - 1;
  assert.equal(resolveReplayContentVersion(duelCfg, settleCfg, 'flux', current), current);
  assert.equal(resolveReplayContentVersion(duelCfg, settleCfg, 'flux', previous), previous, 'the previous version replays exactly');
  assert.equal(resolveReplayContentVersion(duelCfg, settleCfg, 'flux', previous - 1), current, 'older versions cannot be rebuilt');
  assert.equal(resolveReplayContentVersion(duelCfg, settleCfg, 'flux', current + 1), current, 'newer versions cannot be rebuilt');
  assert.equal(resolveReplayContentVersion(duelCfg, settleCfg, 'daily', duelCfg.contentVersion.daily), duelCfg.contentVersion.daily);
  assert.equal(
    resolveReplayContentVersion(duelCfg, settleCfg, 'daily', previous),
    duelCfg.contentVersion.daily,
    'the Flux exception never applies to a Daily'
  );
});
