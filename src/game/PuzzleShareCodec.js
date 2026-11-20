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
 * Supports v1 (legacy full color names) and v2 (1-char color codes, optional anchors,
 * Rescue Cores, objectives, and up to 2 obstacles). Every input is treated as untrusted:
 * bounded byte length, integer grid validation, and a 16-bit FNV-1a checksum reject
 * corrupted or oversized links before allocation.
 */

const CODEC_V1 = 1;
const CODEC_V2 = 2;
export const MAX_PAYLOAD_CHARS = 640;
export const MAX_PUZZLE_BALLS = 28;
export const MAX_PUZZLE_OBSTACLES = 3;
const MAX_SHOTS = 12;
const MIN_SHOTS = 1;
const MIN_COORD = 0;
const MAX_COORD = 1000;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const CHECKSUM_MASK = 0xffff;
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/;
const FLAG_ANCHOR = 1;
const FLAG_CORE = 2;
const MAX_FLAGS = FLAG_ANCHOR | FLAG_CORE;

export const PUZZLE_QUERY_PARAM = 'puzzle';
export const PUZZLE_OBSTACLE_KINDS = Object.freeze(['none', 'bumper', 'repulsor', 'portal']);
const FREE_OBSTACLE_TO_CODE = Object.freeze({ bumper: 'b', repulsor: 'r', attractor: 'a' });
const CODE_TO_FREE_OBSTACLE = Object.freeze({ b: 'bumper', r: 'repulsor', a: 'attractor' });
const ALLOWED_FREE_OBSTACLES = new Set(Object.keys(FREE_OBSTACLE_TO_CODE));

const COLOR_TO_CODE = Object.freeze({
  crimson: 'r',
  cobalt: 'b',
  emerald: 'g',
  amber: 'y',
  violet: 'v',
  cyan: 'c'
});
const CODE_TO_COLOR = Object.freeze({
  r: 'crimson',
  b: 'cobalt',
  g: 'emerald',
  y: 'amber',
  v: 'violet',
  c: 'cyan'
});
const ALLOWED_COLORS = new Set(Object.keys(COLOR_TO_CODE));
const ALLOWED_OBSTACLE_PRESETS = new Set(['bumper', 'repulsor', 'portal']);

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

function isValidCoord(value) {
  return Number.isInteger(value) && value >= MIN_COORD && value <= MAX_COORD;
}

function isValidBallEntry(ball) {
  return Boolean(
    ball &&
    typeof ball === 'object' &&
    isValidCoord(ball.x) &&
    isValidCoord(ball.y) &&
    ALLOWED_COLORS.has(ball.c) &&
    (ball.a === undefined || typeof ball.a === 'boolean') &&
    (ball.k === undefined || typeof ball.k === 'boolean')
  );
}

function isValidObstaclePreset(preset) {
  return preset === undefined || preset === null || preset === 'none' || ALLOWED_OBSTACLE_PRESETS.has(preset);
}

function isValidFreeObstacle(obs) {
  return Boolean(
    obs &&
    typeof obs === 'object' &&
    ALLOWED_FREE_OBSTACLES.has(obs.t) &&
    isValidCoord(obs.x) &&
    isValidCoord(obs.y)
  );
}

function hasValidFreeObstacles(obstacles) {
  if (obstacles === undefined) {
    return true;
  }
  return Array.isArray(obstacles) && obstacles.length <= MAX_PUZZLE_OBSTACLES && obstacles.every(isValidFreeObstacle);
}

function hasValidQueueAndBalls(spec) {
  const validQueue = Array.isArray(spec.queue) && spec.queue.length >= MIN_SHOTS && spec.queue.length <= MAX_SHOTS
    && spec.queue.every((color) => ALLOWED_COLORS.has(color));
  const validBalls = Array.isArray(spec.balls) && spec.balls.length >= 1 && spec.balls.length <= MAX_PUZZLE_BALLS
    && spec.balls.every(isValidBallEntry);
  return validQueue && validBalls;
}

function isValidPuzzleSpec(spec) {
  if (!spec || typeof spec !== 'object') {
    return false;
  }
  const validShots = Number.isInteger(spec.shots) && spec.shots >= MIN_SHOTS && spec.shots <= MAX_SHOTS;
  const validVerified = spec.verified === undefined || typeof spec.verified === 'boolean';
  return validShots && hasValidQueueAndBalls(spec) && isValidObstaclePreset(spec.obstaclePreset)
    && hasValidFreeObstacles(spec.obstacles) && validVerified;
}

function encodeBallV2(ball) {
  const code = COLOR_TO_CODE[ball.c];
  const flags = (ball.a ? FLAG_ANCHOR : 0) | (ball.k ? FLAG_CORE : 0);
  return flags > 0 ? [ball.x, ball.y, code, flags] : [ball.x, ball.y, code];
}

function decodeBallEntry(entry, isV2) {
  if (!Array.isArray(entry) || (entry.length !== 3 && (!isV2 || entry.length !== 4))) {
    return null;
  }
  const color = isV2 ? CODE_TO_COLOR[entry[2]] : entry[2];
  if (!color) {
    return null;
  }
  const ball = { x: entry[0], y: entry[1], c: color };
  if (isV2 && entry.length === 4) {
    const flags = entry[3];
    if (!Number.isInteger(flags) || flags < 0 || flags > MAX_FLAGS) {
      return null;
    }
    if (flags & FLAG_ANCHOR) {
      ball.a = true;
    }
    if (flags & FLAG_CORE) {
      ball.k = true;
    }
  }
  return ball;
}

/**
 * Encodes a validated custom puzzle into a checksummed base64url string, or null if invalid/oversized.
 * @param {{shots: number, queue: string[], balls: Array<{x: number, y: number, c: string, a?: boolean, k?: boolean}>, obstaclePreset?: string}} spec
 * @returns {string|null}
 */
export function encodeCustomPuzzle(spec) {
  if (!isValidPuzzleSpec(spec)) {
    return null;
  }
  const canonical = {
    v: CODEC_V2,
    s: spec.shots,
    q: spec.queue.map((c) => COLOR_TO_CODE[c]).join(''),
    b: spec.balls.map(encodeBallV2)
  };
  if (spec.obstaclePreset && ALLOWED_OBSTACLE_PRESETS.has(spec.obstaclePreset)) {
    canonical.o = spec.obstaclePreset;
  }
  if (Array.isArray(spec.obstacles) && spec.obstacles.length > 0) {
    canonical.obs = spec.obstacles.map(({ t, x, y }) => [FREE_OBSTACLE_TO_CODE[t], x, y]);
  }
  if (spec.verified === true) {
    canonical.vok = 1;
  }
  const body = JSON.stringify(canonical);
  const checksum = fnv1a16(body).toString(16).padStart(4, '0');
  const encoded = toBase64Url(`${checksum}.${body}`);
  return encoded.length <= MAX_PAYLOAD_CHARS ? encoded : null;
}

function decodeFreeObstacleEntry(entry) {
  if (!Array.isArray(entry) || entry.length !== 3 || !CODE_TO_FREE_OBSTACLE[entry[0]]) {
    return null;
  }
  return { t: CODE_TO_FREE_OBSTACLE[entry[0]], x: entry[1], y: entry[2] };
}

function attachV2Metadata(spec, parsed) {
  if (parsed.o !== undefined) {
    spec.obstaclePreset = parsed.o;
  }
  if (Array.isArray(parsed.obs) && parsed.obs.length > 0) {
    spec.obstacles = parsed.obs.map(decodeFreeObstacleEntry);
  }
  if (parsed.vok === 1) {
    spec.verified = true;
  }
}

function decodeParsedBody(parsed) {
  if (!parsed || (parsed.v !== CODEC_V1 && parsed.v !== CODEC_V2) || !Array.isArray(parsed.b)) {
    return null;
  }
  const isV2 = parsed.v === CODEC_V2;
  const queue = isV2
    ? (typeof parsed.q === 'string' ? [...parsed.q].map((ch) => CODE_TO_COLOR[ch]) : null)
    : parsed.q;
  if (!Array.isArray(queue) || queue.some((c) => !c)) {
    return null;
  }
  const balls = parsed.b.map((entry) => decodeBallEntry(entry, isV2));
  const spec = { shots: parsed.s, queue, balls };
  if (isV2) {
    attachV2Metadata(spec, parsed);
  }
  return isValidPuzzleSpec(spec) ? spec : null;
}

/**
 * Decodes and validates a custom puzzle payload (v1 or v2). Returns null on any corruption or violation.
 * @param {unknown} payload
 * @returns {{shots: number, queue: string[], balls: Array<{x: number, y: number, c: string, a?: boolean, k?: boolean}>, obstaclePreset?: string}|null}
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
    return decodeParsedBody(JSON.parse(body));
  } catch {
    return null;
  }
}

/** Extracts a bare payload from either a full `?puzzle=...` URL, query string, or raw token. */
export function extractPuzzlePayload(input) {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes('?')) {
    try {
      const idx = trimmed.indexOf('?');
      return new URLSearchParams(trimmed.slice(idx)).get(PUZZLE_QUERY_PARAM);
    } catch {
      return null;
    }
  }
  return trimmed;
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

/** True when the URL search string carries a non-empty `?puzzle=` parameter (valid or malformed). */
export function hasCustomPuzzleParam(search) {
  if (typeof search !== 'string' || search.length === 0) {
    return false;
  }
  const raw = new URLSearchParams(search).get(PUZZLE_QUERY_PARAM);
  return typeof raw === 'string' && raw.length > 0;
}

/** Builds a shareable URL carrying `?puzzle=<payload>`, or null if spec is invalid/oversized. */
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
