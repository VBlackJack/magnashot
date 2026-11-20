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
 * Pure, strict base64url codec for compact shareable custom puzzles (`?puzzle=<payload>`).
 * Every input is treated as untrusted: bounded byte length, integer grid validation, and a
 * 16-bit FNV-1a checksum reject corrupted or oversized links before allocation.
 */

const CODEC_VERSION = 1;
const MAX_PAYLOAD_CHARS = 512;
const MAX_BALLS = 24;
const MAX_SHOTS = 12;
const MIN_SHOTS = 1;
const MIN_COORD = 0;
const MAX_COORD = 1000;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const CHECKSUM_MASK = 0xffff;
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/;
const ALLOWED_COLORS = new Set(['red', 'blue', 'green', 'yellow', 'purple', 'cyan']);

function fnv1a16(text) {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash & CHECKSUM_MASK;
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(payload) {
  const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function isValidBallEntry(ball) {
  return Boolean(
    ball &&
    typeof ball === 'object' &&
    Number.isInteger(ball.x) && ball.x >= MIN_COORD && ball.x <= MAX_COORD &&
    Number.isInteger(ball.y) && ball.y >= MIN_COORD && ball.y <= MAX_COORD &&
    ALLOWED_COLORS.has(ball.c)
  );
}

function isValidPuzzleSpec(spec) {
  if (!spec || typeof spec !== 'object') {
    return false;
  }
  if (!Number.isInteger(spec.shots) || spec.shots < MIN_SHOTS || spec.shots > MAX_SHOTS) {
    return false;
  }
  if (!Array.isArray(spec.queue) || spec.queue.length < MIN_SHOTS || spec.queue.length > MAX_SHOTS) {
    return false;
  }
  if (!spec.queue.every((color) => ALLOWED_COLORS.has(color))) {
    return false;
  }
  if (!Array.isArray(spec.balls) || spec.balls.length < 1 || spec.balls.length > MAX_BALLS) {
    return false;
  }
  return spec.balls.every(isValidBallEntry);
}

/**
 * Encodes a validated custom puzzle into a checksummed base64url string, or null if invalid.
 * @param {{shots: number, queue: string[], balls: Array<{x: number, y: number, c: string}>}} spec
 * @returns {string|null}
 */
export function encodeCustomPuzzle(spec) {
  if (!isValidPuzzleSpec(spec)) {
    return null;
  }
  const canonical = {
    v: CODEC_VERSION,
    s: spec.shots,
    q: [...spec.queue],
    b: spec.balls.map(({ x, y, c }) => [x, y, c])
  };
  const body = JSON.stringify(canonical);
  const checksum = fnv1a16(body).toString(16).padStart(4, '0');
  const encoded = toBase64Url(`${checksum}.${body}`);
  return encoded.length <= MAX_PAYLOAD_CHARS ? encoded : null;
}

export const PUZZLE_QUERY_PARAM = 'puzzle';

/**
 * Decodes and validates a custom puzzle payload. Returns null on any corruption or violation.
 * @param {unknown} payload
 * @returns {{shots: number, queue: string[], balls: Array<{x: number, y: number, c: string}>}|null}
 */
export function decodeCustomPuzzle(payload) {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > MAX_PAYLOAD_CHARS || !PAYLOAD_PATTERN.test(payload)) {
    return null;
  }
  try {
    const raw = fromBase64Url(payload);
    const dot = raw.indexOf('.');
    if (dot !== 4) {
      return null;
    }
    const givenSum = raw.slice(0, 4);
    const body = raw.slice(5);
    if (fnv1a16(body).toString(16).padStart(4, '0') !== givenSum) {
      return null;
    }
    const parsed = JSON.parse(body);
    if (!parsed || parsed.v !== CODEC_VERSION || !Array.isArray(parsed.b)) {
      return null;
    }
    const spec = {
      shots: parsed.s,
      queue: parsed.q,
      balls: parsed.b.map((entry) => (Array.isArray(entry) && entry.length === 3 ? { x: entry[0], y: entry[1], c: entry[2] } : null))
    };
    return isValidPuzzleSpec(spec) ? spec : null;
  } catch {
    return null;
  }
}

/** Reads and decodes `?puzzle=<payload>` from a URL search string, or null. */
export function readCustomPuzzleFromSearch(search) {
  if (typeof search !== 'string' || search.length === 0) {
    return null;
  }
  const params = new URLSearchParams(search);
  const raw = params.get(PUZZLE_QUERY_PARAM);
  return raw ? decodeCustomPuzzle(raw) : null;
}

/** Builds a shareable URL carrying `?puzzle=<payload>`, or null if spec is invalid. */
export function buildCustomPuzzleUrl(baseHref, spec) {
  const encoded = encodeCustomPuzzle(spec);
  if (!encoded || typeof baseHref !== 'string') {
    return null;
  }
  try {
    const url = new URL(baseHref);
    url.search = '';
    url.hash = '';
    url.searchParams.set(PUZZLE_QUERY_PARAM, encoded);
    return url.toString();
  } catch {
    return null;
  }
}
