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

/**
 * Pure codec for Ghost Duel links. A ghost is the outcome-only score timeline of a finished
 * Daily or Flux run, carried in a URL payload. The payload is unsigned and hostile input:
 * decoding is strict and canonical (decode then re-encode must reproduce the input exactly),
 * every size is capped before any allocation, and a 16-bit checksum catches damaged links.
 *
 * Ghost shape: { mode: 'daily'|'flux', key, cv, n, step, s: [cumulative scores], final,
 *   assists: { workshop, ammo, continues, tiltFree }, alias }.
 * `key` is the Daily date key ("YYYY-MM-DD") or the Flux seed.
 *
 * Wire layout (bytes): version, flags, varint contentVersion, varint key, varint n,
 * varint pointCount, pointCount varint score deltas, varint workshop, varint ammo,
 * varint continues, [varint aliasByteLength, alias UTF-8], 2-byte checksum.
 */

export const DUEL_STATUS = Object.freeze({
  NONE: 'none',
  VALID: 'valid',
  INVALID: 'invalid',
  NEWER: 'newer',
  EXPIRED: 'expired',
  FUTURE: 'future'
});

const MODE_DAILY = 'daily';
const MODE_FLUX = 'flux';
const MODE_CODE_DAILY = 0;
const MODE_CODE_FLUX = 1;

// Flags byte layout.
const FLAG_MODE_MASK = 0b11;
const FLAG_HAS_ALIAS = 1 << 2;
const FLAG_TILT_FREE = 1 << 3;
const FLAG_STEP_SHIFT = 4;
const FLAG_STEP_MASK = 0b1111;
const FLAG_USED_MASK = FLAG_MODE_MASK | FLAG_HAS_ALIAS | FLAG_TILT_FREE | (FLAG_STEP_MASK << FLAG_STEP_SHIFT);

// Varint (LEB128) layout.
const VARINT_PAYLOAD_BITS = 7;
const VARINT_PAYLOAD_RADIX = 2 ** VARINT_PAYLOAD_BITS;
const VARINT_CONTINUE_FLAG = VARINT_PAYLOAD_RADIX;
const VARINT_MAX_BYTES = 8;

// Checksum: low 16 bits of FNV-1a 32, stored big-endian.
const CHECKSUM_BYTES = 2;
const BYTE_RADIX = 256;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const CHECKSUM_MASK = 0xffff;

// Calendar arithmetic.
const MS_PER_DAY = 86400000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_KEY_PAD = 2;
const DATE_KEY_YEAR_DIGITS = 4;
const MONTH_OFFSET = 1;

const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/;
const FLUX_SEED_PATTERN = /^[0-9a-z]+$/;
const BASE64_BLOCK = 4;
const BASE64_ORPHAN_REMAINDER = 1;
const BASE64_PAD_CHAR = '=';
const BYTES_PER_UTF8_CODE_POINT = 4;
const FIRST_STEP_LOG2 = 0;
const HASH_PREFIX = '#';
const QUERY_PREFIX = '?';

const ALIAS_ALLOWED_PATTERN = /^[\p{L}\p{N} ]+$/u;
const ALIAS_DISALLOWED_PATTERN = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_RUN_PATTERN = /\s+/gu;
const ALIAS_SEPARATOR = ' ';
const ALIAS_NORMAL_FORM = 'NFC';

class DuelDecodeError extends Error {}

function fail(message) {
  throw new DuelDecodeError(message);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Content version of a mode's generated boards: it moves only when that mode's generation
 * changes, so a link of an unchanged mode stays free of the "another version" notice.
 * @param {{contentVersion: Object<string, number>}} cfg - The `ghostDuel` config section.
 * @param {string} mode - 'daily' or 'flux'.
 * @returns {number} The current content version of the mode.
 */
export function contentVersionFor(cfg, mode) {
  return cfg.contentVersion[mode];
}

/**
 * Content version a duel is replayed on. A link recorded on the current version replays on it.
 * A Flux link recorded on the version just before the settled shapes replays on those exact
 * shapes, so it still meets the board it was recorded on; any other version cannot be rebuilt
 * and replays on the current one (the card then warns that the board may differ).
 * @param {{contentVersion: Object<string, number>}} cfg - The `ghostDuel` config section.
 * @param {{sinceContentVersion: number}} settleCfg - The `flux.shapeSettle` config section.
 * @param {string} mode - 'daily' or 'flux'.
 * @param {number} cv - Content version carried by the link.
 * @returns {number} The version to start the run with.
 */
export function resolveReplayContentVersion(cfg, settleCfg, mode, cv) {
  const current = contentVersionFor(cfg, mode);
  if (cv === current) {
    return current;
  }
  return mode === MODE_FLUX && cv === settleCfg.sinceContentVersion - 1 ? cv : current;
}

/**
 * Cleans an alias: Unicode letters, digits and single spaces only, trimmed and cut to the
 * configured length (in code points). Never throws.
 * @param {unknown} raw - Candidate alias.
 * @param {{aliasMaxLength: number}} cfg - The `ghostDuel` config section.
 * @returns {string} The clean alias, or an empty string when nothing usable remains.
 */
export function sanitizeAlias(raw, cfg) {
  if (typeof raw !== 'string') {
    return '';
  }
  const cleaned = raw
    .normalize(ALIAS_NORMAL_FORM)
    .replace(ALIAS_DISALLOWED_PATTERN, '')
    .replace(WHITESPACE_RUN_PATTERN, ALIAS_SEPARATOR)
    .trim();
  return Array.from(cleaned).slice(0, cfg.aliasMaxLength).join('').trim();
}

function isCleanAlias(alias, cfg) {
  return typeof alias === 'string'
    && alias.length > 0
    && ALIAS_ALLOWED_PATTERN.test(alias)
    && sanitizeAlias(alias, cfg) === alias;
}

/**
 * Low 16 bits of FNV-1a 32 over the bytes.
 * @param {Uint8Array|number[]} bytes - Bytes to hash.
 * @returns {number} Unsigned 16-bit checksum.
 */
export function fnv1a16(bytes) {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
  }
  return hash & CHECKSUM_MASK;
}

function pushVarint(out, value) {
  let rest = value;
  while (rest >= VARINT_PAYLOAD_RADIX) {
    out.push((rest % VARINT_PAYLOAD_RADIX) | VARINT_CONTINUE_FLAG);
    rest = Math.floor(rest / VARINT_PAYLOAD_RADIX);
  }
  out.push(rest);
}

class ByteReader {
  constructor(bytes, end) {
    this.bytes = bytes;
    this.end = end;
    this.pos = 0;
  }

  byte() {
    if (this.pos >= this.end) {
      fail('truncated');
    }
    return this.bytes[this.pos++];
  }

  varint() {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < VARINT_MAX_BYTES; i++) {
      const byte = this.byte();
      value += (byte % VARINT_CONTINUE_FLAG) * scale;
      if (!Number.isSafeInteger(value)) {
        fail('varint overflow');
      }
      if (byte < VARINT_CONTINUE_FLAG) {
        return value;
      }
      scale *= VARINT_PAYLOAD_RADIX;
    }
    return fail('varint too long');
  }

  take(count) {
    if (count > this.end - this.pos) {
      fail('truncated');
    }
    const slice = this.bytes.subarray(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }

  atEnd() {
    return this.pos === this.end;
  }
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  if (text.length % BASE64_BLOCK === BASE64_ORPHAN_REMAINDER) {
    fail('bad length');
  }
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / BASE64_BLOCK) * BASE64_BLOCK, BASE64_PAD_CHAR);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function dateKeyToDays(dateKey) {
  if (typeof dateKey !== 'string' || !DATE_KEY_PATTERN.test(dateKey)) {
    return null;
  }
  const ms = Date.parse(dateKey);
  if (!Number.isFinite(ms)) {
    return null;
  }
  const days = Math.round(ms / MS_PER_DAY);
  return daysToDateKey(days) === dateKey ? days : null;
}

function daysToDateKey(days) {
  const date = new Date(days * MS_PER_DAY);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = String(date.getUTCFullYear()).padStart(DATE_KEY_YEAR_DIGITS, '0');
  const month = String(date.getUTCMonth() + MONTH_OFFSET).padStart(DATE_KEY_PAD, '0');
  const day = String(date.getUTCDate()).padStart(DATE_KEY_PAD, '0');
  return `${year}-${month}-${day}`;
}

function stepLog2(step) {
  if (!Number.isSafeInteger(step) || step < 1 || (step & (step - 1)) !== 0) {
    return -1;
  }
  return Math.log2(step);
}

function modeCode(mode) {
  if (mode === MODE_DAILY) {
    return MODE_CODE_DAILY;
  }
  return mode === MODE_FLUX ? MODE_CODE_FLUX : -1;
}

/** Encodes the key of a ghost as a non-negative integer, or null when it is not encodable. */
function keyToNumber(ghost, ctx) {
  if (ghost.mode === MODE_DAILY) {
    const days = dateKeyToDays(ghost.key);
    const epochDays = dateKeyToDays(ctx.epochDateKey);
    if (days === null || epochDays === null || days < epochDays) {
      return null;
    }
    return days - epochDays;
  }
  const { length, radix } = ctx.seed;
  if (typeof ghost.key !== 'string' || ghost.key.length !== length || !FLUX_SEED_PATTERN.test(ghost.key)) {
    return null;
  }
  const value = Number.parseInt(ghost.key, radix);
  if (!Number.isSafeInteger(value) || value.toString(radix).padStart(length, '0') !== ghost.key) {
    return null;
  }
  return value;
}

function numberToKey(mode, value, ctx) {
  if (mode === MODE_DAILY) {
    const epochDays = dateKeyToDays(ctx.epochDateKey);
    const key = epochDays === null ? null : daysToDateKey(epochDays + value);
    return key ?? fail('bad date');
  }
  const { length, radix } = ctx.seed;
  const seed = value.toString(radix);
  if (seed.length > length) {
    fail('seed too long');
  }
  return seed.padStart(length, '0');
}

/** Structural validation shared by the encoder and the decoder. Returns an error text or null. */
function validateGhostShape(ghost, cfg, ctx) {
  if (!ghost || typeof ghost !== 'object') {
    return 'not an object';
  }
  if (modeCode(ghost.mode) < 0) {
    return 'bad mode';
  }
  const log2 = stepLog2(ghost.step);
  if (log2 < FIRST_STEP_LOG2 || log2 > cfg.maxStepLog2) {
    return 'bad step';
  }
  if (!isCount(ghost.n) || ghost.n < 1 || ghost.n > cfg.maxSamples) {
    return 'bad n';
  }
  if (!Array.isArray(ghost.s) || ghost.s.length < 1 || ghost.s.length > ctx.maxPoints) {
    return 'bad points';
  }
  if (ghost.s.length !== Math.ceil(ghost.n / ghost.step)) {
    return 'point count mismatch';
  }
  let previous = 0;
  for (const score of ghost.s) {
    if (!isCount(score) || score < previous) {
      return 'bad score';
    }
    previous = score;
  }
  if (previous > cfg.maxScore) {
    return 'score too high';
  }
  if (!isCount(ghost.cv)) {
    return 'bad content version';
  }
  const assists = ghost.assists;
  if (!assists || typeof assists !== 'object') {
    return 'bad assists';
  }
  for (const value of [assists.workshop, assists.ammo, assists.continues]) {
    if (!isCount(value) || value > cfg.maxScore) {
      return 'bad assist';
    }
  }
  if (ghost.alias !== undefined && ghost.alias !== '' && !isCleanAlias(ghost.alias, cfg)) {
    return 'bad alias';
  }
  return null;
}

/**
 * Encodes a ghost into a base64url payload (no padding).
 * @param {object} ghost - Ghost (see module header).
 * @param {object} cfg - The `ghostDuel` config section.
 * @param {{epochDateKey: string, seed: {length: number, radix: number}, maxPoints: number}} ctx - Context.
 * @returns {string|null} The payload, or null when the ghost cannot be encoded.
 */
export function encodeGhost(ghost, cfg, ctx) {
  if (validateGhostShape(ghost, cfg, ctx) !== null) {
    return null;
  }
  const key = keyToNumber(ghost, ctx);
  if (key === null) {
    return null;
  }
  const hasAlias = typeof ghost.alias === 'string' && ghost.alias.length > 0;
  const tiltFree = ghost.assists.tiltFree === true;
  const flags = modeCode(ghost.mode)
    | (hasAlias ? FLAG_HAS_ALIAS : 0)
    | (tiltFree ? FLAG_TILT_FREE : 0)
    | (stepLog2(ghost.step) << FLAG_STEP_SHIFT);
  const out = [cfg.codecVersion, flags];
  pushVarint(out, ghost.cv);
  pushVarint(out, key);
  pushVarint(out, ghost.n);
  pushVarint(out, ghost.s.length);
  let previous = 0;
  for (const score of ghost.s) {
    pushVarint(out, score - previous);
    previous = score;
  }
  pushVarint(out, ghost.assists.workshop);
  pushVarint(out, ghost.assists.ammo);
  pushVarint(out, ghost.assists.continues);
  if (hasAlias) {
    const aliasBytes = new TextEncoder().encode(ghost.alias);
    pushVarint(out, aliasBytes.length);
    out.push(...aliasBytes);
  }
  const checksum = fnv1a16(out);
  out.push(Math.floor(checksum / BYTE_RADIX), checksum % BYTE_RADIX);
  return bytesToBase64Url(Uint8Array.from(out));
}

function readAlias(reader, cfg) {
  const byteLength = reader.varint();
  if (byteLength < 1 || byteLength > cfg.aliasMaxLength * BYTES_PER_UTF8_CODE_POINT) {
    fail('bad alias length');
  }
  const alias = new TextDecoder('utf-8', { fatal: true }).decode(reader.take(byteLength));
  if (!isCleanAlias(alias, cfg)) {
    fail('bad alias');
  }
  return alias;
}

function decodeBody(bytes, cfg, ctx) {
  const reader = new ByteReader(bytes, bytes.length - CHECKSUM_BYTES);
  reader.byte();
  const flags = reader.byte();
  if ((flags & ~FLAG_USED_MASK) !== 0) {
    fail('reserved flag bits');
  }
  const modeBits = flags & FLAG_MODE_MASK;
  const mode = modeBits === MODE_CODE_DAILY ? MODE_DAILY : modeBits === MODE_CODE_FLUX ? MODE_FLUX : fail('bad mode');
  const step = 2 ** ((flags >> FLAG_STEP_SHIFT) & FLAG_STEP_MASK);
  const cv = reader.varint();
  const keyNumber = reader.varint();
  const n = reader.varint();
  const pointCount = reader.varint();
  if (n < 1 || n > cfg.maxSamples || ((flags >> FLAG_STEP_SHIFT) & FLAG_STEP_MASK) > cfg.maxStepLog2) {
    fail('bad n or step');
  }
  if (pointCount < 1 || pointCount > ctx.maxPoints || pointCount !== Math.ceil(n / step)) {
    fail('bad point count');
  }
  const s = [];
  let total = 0;
  for (let i = 0; i < pointCount; i++) {
    total += reader.varint();
    if (total > cfg.maxScore) {
      fail('score too high');
    }
    s.push(total);
  }
  const assists = {
    workshop: reader.varint(),
    ammo: reader.varint(),
    continues: reader.varint(),
    tiltFree: (flags & FLAG_TILT_FREE) !== 0
  };
  for (const value of [assists.workshop, assists.ammo, assists.continues]) {
    if (value > cfg.maxScore) {
      fail('bad assist');
    }
  }
  const alias = (flags & FLAG_HAS_ALIAS) !== 0 ? readAlias(reader, cfg) : '';
  if (!reader.atEnd()) {
    fail('trailing bytes');
  }
  return { mode, key: numberToKey(mode, keyNumber, ctx), cv, n, step, s, final: total, assists, alias };
}

function dailyWindowStatus(ghost, cfg, ctx) {
  if (ghost.mode !== MODE_DAILY) {
    return DUEL_STATUS.VALID;
  }
  const keyDays = dateKeyToDays(ghost.key);
  const todayDays = dateKeyToDays(ctx.todayKey);
  if (keyDays === null || todayDays === null) {
    return DUEL_STATUS.INVALID;
  }
  if (keyDays > todayDays) {
    return DUEL_STATUS.FUTURE;
  }
  return todayDays - keyDays > cfg.dailyMaxAgeDays ? DUEL_STATUS.EXPIRED : DUEL_STATUS.VALID;
}

/**
 * Strictly decodes an untrusted payload. Never throws.
 * @param {unknown} payload - Payload string from the URL.
 * @param {object} cfg - The `ghostDuel` config section.
 * @param {{todayKey: string, epochDateKey: string, seed: {length: number, radix: number}, maxPoints: number}} ctx - Context.
 * @returns {{status: string, ghost: object|null}} status is one of DUEL_STATUS; ghost only when valid.
 */
export function decodeGhost(payload, cfg, ctx) {
  const result = (status, ghost = null) => ({ status, ghost });
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > cfg.maxPayloadChars || !PAYLOAD_PATTERN.test(payload)) {
    return result(DUEL_STATUS.INVALID);
  }
  try {
    const bytes = base64UrlToBytes(payload);
    if (bytes.length < CHECKSUM_BYTES + 1) {
      return result(DUEL_STATUS.INVALID);
    }
    if (bytes[0] > cfg.codecVersion) {
      return result(DUEL_STATUS.NEWER);
    }
    if (bytes[0] !== cfg.codecVersion) {
      return result(DUEL_STATUS.INVALID);
    }
    const body = bytes.subarray(0, bytes.length - CHECKSUM_BYTES);
    const stored = bytes[bytes.length - CHECKSUM_BYTES] * BYTE_RADIX + bytes[bytes.length - 1];
    if (stored !== fnv1a16(body)) {
      return result(DUEL_STATUS.INVALID);
    }
    const ghost = decodeBody(bytes, cfg, ctx);
    if (validateGhostShape(ghost, cfg, ctx) !== null || encodeGhost(ghost, cfg, ctx) !== payload) {
      return result(DUEL_STATUS.INVALID);
    }
    const window = dailyWindowStatus(ghost, cfg, ctx);
    return window === DUEL_STATUS.VALID ? result(DUEL_STATUS.VALID, ghost) : result(window);
  } catch {
    return result(DUEL_STATUS.INVALID);
  }
}

function splitSearch(search) {
  const text = typeof search === 'string' ? search : '';
  const hashIndex = text.indexOf(HASH_PREFIX);
  return hashIndex >= 0 ? text.slice(0, hashIndex) : text;
}

/**
 * Reads the duel payload from a location.search string and decodes it.
 * A Flux duel whose seed differs from an explicit `flux` parameter is dropped (status none,
 * so the Flux run starts as a plain shared seed); so is a Daily duel next to a `flux` parameter.
 * @param {string|null|undefined} search - Raw URL query string.
 * @param {object} cfg - The `ghostDuel` config section (queryParam, caps).
 * @param {object} ctx - Decode context; optional `fluxParam` is the name of the Flux seed parameter.
 * @returns {{status: string, ghost: object|null}}
 */
export function readDuelFromSearch(search, cfg, ctx) {
  const params = new URLSearchParams(splitSearch(search));
  const payload = params.get(cfg.queryParam);
  if (payload === null) {
    return { status: DUEL_STATUS.NONE, ghost: null };
  }
  const decoded = decodeGhost(payload, cfg, ctx);
  const fluxRaw = ctx.fluxParam ? params.get(ctx.fluxParam) : null;
  if (decoded.status === DUEL_STATUS.VALID && fluxRaw !== null) {
    const matches = decoded.ghost.mode === MODE_FLUX && fluxRaw.trim().toLowerCase() === decoded.ghost.key;
    if (!matches) {
      return { status: DUEL_STATUS.NONE, ghost: null };
    }
  }
  return decoded;
}

/**
 * Builds a challenge URL carrying the ghost. A Flux ghost also gets its `flux` seed parameter.
 * @param {string} baseUrl - Game URL, with or without a query string.
 * @param {object} ghost - Ghost to carry.
 * @param {object} cfg - The `ghostDuel` config section.
 * @param {object} ctx - Context; `fluxParam` names the Flux seed parameter.
 * @returns {string|null} The URL, or null when the ghost is not encodable or the URL is too long.
 */
export function buildDuelUrl(baseUrl, ghost, cfg, ctx) {
  const payload = encodeGhost(ghost, cfg, ctx);
  if (payload === null || typeof baseUrl !== 'string') {
    return null;
  }
  const hashIndex = baseUrl.indexOf(HASH_PREFIX);
  const hash = hashIndex >= 0 ? baseUrl.slice(hashIndex) : '';
  const beforeHash = hashIndex >= 0 ? baseUrl.slice(0, hashIndex) : baseUrl;
  const queryIndex = beforeHash.indexOf(QUERY_PREFIX);
  const basePath = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const params = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '');
  params.delete(cfg.queryParam);
  if (ghost.mode === MODE_FLUX && ctx.fluxParam) {
    params.set(ctx.fluxParam, ghost.key);
  }
  params.set(cfg.queryParam, payload);
  const url = `${basePath}${QUERY_PREFIX}${params.toString()}${hash}`;
  return url.length > cfg.maxUrlLength ? null : url;
}

/**
 * Removes the duel parameter from a URL or a path+search+hash string.
 * @param {string} urlString - Full URL or relative path with query string.
 * @param {{queryParam: string}} cfg - The `ghostDuel` config section.
 * @returns {string}
 */
export function stripDuelFromUrl(urlString, cfg) {
  if (typeof urlString !== 'string' || !urlString.includes(cfg.queryParam)) {
    return urlString;
  }
  const hashIndex = urlString.indexOf(HASH_PREFIX);
  const hash = hashIndex >= 0 ? urlString.slice(hashIndex) : '';
  const beforeHash = hashIndex >= 0 ? urlString.slice(0, hashIndex) : urlString;
  const queryIndex = beforeHash.indexOf(QUERY_PREFIX);
  if (queryIndex < 0) {
    return urlString;
  }
  const basePath = beforeHash.slice(0, queryIndex);
  const params = new URLSearchParams(beforeHash.slice(queryIndex + 1));
  if (!params.has(cfg.queryParam)) {
    return urlString;
  }
  params.delete(cfg.queryParam);
  const remaining = params.toString();
  return `${basePath}${remaining ? `${QUERY_PREFIX}${remaining}` : ''}${hash}`;
}

/**
 * Builds a ghost from a finished run timeline.
 * @param {object} tl - Shot timeline (see ShotTimeline.js); must be complete.
 * @param {{key: string, cv: number, alias?: string, assists?: object}} run - Run identity:
 *   `key` is the Daily date key or Flux seed, `cv` the content version.
 * @param {object} cfg - The `ghostDuel` config section.
 * @param {object} ctx - Context (maxPoints, epochDateKey, seed).
 * @returns {object|null} The ghost, or null when the timeline is incomplete or not encodable.
 */
export function ghostFromTimeline(tl, run, cfg, ctx) {
  if (!tl || typeof tl !== 'object' || tl.c !== 1 || !Array.isArray(tl.s) || tl.s.length === 0 || !run) {
    return null;
  }
  const assists = run.assists || {};
  const ghost = {
    mode: tl.mode,
    key: run.key,
    cv: run.cv,
    n: tl.n,
    step: tl.step,
    s: [...tl.s],
    final: tl.s[tl.s.length - 1],
    assists: {
      workshop: assists.workshop ?? 0,
      ammo: assists.ammo ?? 0,
      continues: assists.continues ?? 0,
      tiltFree: assists.tiltFree === true
    },
    alias: sanitizeAlias(run.alias, cfg)
  };
  if (validateGhostShape(ghost, cfg, ctx) !== null || keyToNumber(ghost, ctx) === null) {
    return null;
  }
  return ghost;
}
