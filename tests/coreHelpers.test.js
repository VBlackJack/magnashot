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
import { ALIAS_ALLOWED_PATTERN, sanitizeAlias } from '../src/core/AliasSanitizer.js';
import {
  MERGE_SPECIAL_KINDS,
  isMergeSpecialKind,
  sanitizeMergeSpecialKind,
  pickMergeSpecialKind,
  getMergeCalibre,
  isMergeFrozen,
  haveSameMergeCalibre,
  getMergeFusionCalibre
} from '../src/game/modes/MergeSpecials.js';
import {
  PLAY_HUB_FILTERS,
  matchesArcadeFilter,
  resolveNextUnmasteredArcadeMode,
  summarizeGrandMastery,
  resolveDailyPuzzleStage
} from '../src/ui/PlayHubView.js';
import { ARENA_THEMES, GAME_MODES, LASER_TRAILS } from '../src/core/Constants.js';
import { buildPersonalBestGhost } from '../src/game/EngineGhostDuel.js';
import {
  encodeCustomPuzzle,
  decodeCustomPuzzle,
  readCustomPuzzleFromSearch,
  buildCustomPuzzleUrl
} from '../src/game/PuzzleShareCodec.js';

test('sanitizeAlias strips punctuation, collapses whitespace, normalizes Unicode, and caps length', () => {
  const cfg = { aliasMaxLength: 12 };
  assert.equal(sanitizeAlias(null, cfg), '');
  assert.equal(sanitizeAlias(123, cfg), '');
  assert.equal(sanitizeAlias('  Sam!!   42  ', cfg), 'Sam 42');
  assert.equal(sanitizeAlias('e\u0301clair_test_long', cfg), '\u00e9clairtestlo');
  assert.match(sanitizeAlias('Nova 9', cfg), ALIAS_ALLOWED_PATTERN);
});

test('MergeSpecials validates kinds, weighted draws, and fusion calibre rules', () => {
  const kindsCfg = {
    joker: { weight: 2 },
    ice: { weight: 3 },
    bomb: { weight: 0 }
  };
  assert.equal(isMergeSpecialKind(MERGE_SPECIAL_KINDS.JOKER), true);
  assert.equal(isMergeSpecialKind('unknown'), false);
  assert.equal(sanitizeMergeSpecialKind('ice', kindsCfg), 'ice');
  assert.equal(sanitizeMergeSpecialKind('unknown', kindsCfg), null);
  assert.equal(sanitizeMergeSpecialKind('joker', {}), null);

  assert.equal(pickMergeSpecialKind(kindsCfg, 0.0), 'joker');
  assert.equal(pickMergeSpecialKind(kindsCfg, 0.5), 'ice');
  assert.equal(pickMergeSpecialKind({ joker: { weight: 0 } }, 0.2), null);

  const plain2 = { mergeTier: 2, mergeKind: null };
  const plain2b = { mergeTier: 2, mergeKind: null };
  const topPlain = { mergeTier: 11, mergeKind: null };
  const joker = { mergeTier: null, mergeKind: MERGE_SPECIAL_KINDS.JOKER };
  const ice = { mergeTier: 2, mergeKind: MERGE_SPECIAL_KINDS.ICE };
  const bomb = { mergeTier: null, mergeKind: MERGE_SPECIAL_KINDS.BOMB };

  assert.equal(getMergeCalibre(plain2), 2);
  assert.equal(getMergeCalibre(joker), null);
  assert.equal(isMergeFrozen(ice), true);
  assert.equal(haveSameMergeCalibre(plain2, plain2b), true);
  assert.equal(haveSameMergeCalibre(joker, bomb), false);

  assert.equal(getMergeFusionCalibre(plain2, plain2b, 11), 2);
  assert.equal(getMergeFusionCalibre(joker, plain2, 11), 2);
  assert.equal(getMergeFusionCalibre(joker, topPlain, 11), null);
  assert.equal(getMergeFusionCalibre(joker, joker, 11), null);
  assert.equal(getMergeFusionCalibre(ice, plain2, 11), null);
  assert.equal(getMergeFusionCalibre(bomb, plain2, 11), null);
});

test('Play Hub arcade filters and next-unmastered smart picker classify modes accurately', () => {
  assert.equal(matchesArcadeFilter(GAME_MODES.PUZZLE, PLAY_HUB_FILTERS.QUICK, { mastered: false }), true);
  assert.equal(matchesArcadeFilter(GAME_MODES.ENDLESS, PLAY_HUB_FILTERS.QUICK, { mastered: false }), false);
  assert.equal(matchesArcadeFilter(GAME_MODES.ENDLESS, PLAY_HUB_FILTERS.ENDLESS, { mastered: false }), true);
  assert.equal(matchesArcadeFilter(GAME_MODES.ENDLESS, PLAY_HUB_FILTERS.UNMASTERED, { mastered: true }), false);
  assert.equal(matchesArcadeFilter(GAME_MODES.ENDLESS, PLAY_HUB_FILTERS.UNMASTERED, { mastered: false }), true);

  const mockConfig = {
    modeUnlocks: { unlockLevels: { endless: 3, classic: 4 } },
    playHub: { mastery: { endlessScore: 5000, classicStage: 5 } }
  };
  const mockStorage = {
    getUnlockedLevel: () => 5,
    getEndlessHighScore: () => 6000,
    getClassicBestStage: () => 2,
    getUnlockedModes: () => ['endless', 'classic']
  };
  assert.equal(resolveNextUnmasteredArcadeMode(mockStorage, mockConfig), GAME_MODES.CLASSIC);

  assert.deepEqual(
    summarizeGrandMastery({ a: { mastered: true }, b: { mastered: false } }),
    { mastered: 1, total: 2, isGrandMaster: false }
  );
  assert.deepEqual(
    summarizeGrandMastery({ a: { mastered: true }, b: { mastered: true } }),
    { mastered: 2, total: 2, isGrandMaster: true }
  );
  assert.equal(ARENA_THEMES.DEEP_SPACE, 'deepSpace');

  const ghostCfg = { ghostDuel: { contentVersion: { daily: 1, flux: 2 } } };
  const timeline = { n: 5, step: 1, s: [100, 250, 400, 600, 800], f: true };
  const dailyStorage = { getDailyHistory: () => [{ d: '2026-11-20', s: 800, tl: timeline }] };
  const dailyPb = buildPersonalBestGhost(dailyStorage, 'daily', '2026-11-20', ghostCfg, 'PB');
  assert.equal(dailyPb?.isPersonalBest, true);
  assert.equal(dailyPb?.alias, 'PB');
  assert.equal(dailyPb?.final, 800);

  const weeklyStorage = { getWeeklyFluxBest: () => ({ week: '2026-W47', seed: 'abc123', score: 800, tl: timeline }) };
  const weeklyPb = buildPersonalBestGhost(weeklyStorage, 'flux', 'abc123', ghostCfg, 'PB', '2026-W47');
  assert.equal(weeklyPb?.isPersonalBest, true);
  assert.equal(weeklyPb?.key, 'abc123');

  const stageA = resolveDailyPuzzleStage('2026-11-20', 20);
  const stageB = resolveDailyPuzzleStage('2026-11-20', 20);
  assert.equal(stageA, stageB);
  assert.ok(stageA >= 1 && stageA <= 20);
  assert.equal(LASER_TRAILS.CLASSIC, 'classic');
});

test('PuzzleShareCodec round-trips valid puzzles and rejects corrupted or out-of-range payloads', () => {
  const sample = {
    shots: 3,
    queue: ['red', 'blue', 'green'],
    balls: [
      { x: 200, y: 120, c: 'red' },
      { x: 240, y: 120, c: 'red' }
    ]
  };
  const encoded = encodeCustomPuzzle(sample);
  assert.ok(encoded && encoded.length > 0);
  assert.deepEqual(decodeCustomPuzzle(encoded), sample);

  // Tampering with checksum/body fails decoding
  const tampered = (encoded[0] === 'A' ? 'B' : 'A') + encoded.slice(1);
  assert.equal(decodeCustomPuzzle(tampered), null);
  assert.equal(decodeCustomPuzzle(''), null);
  assert.equal(encodeCustomPuzzle({ shots: 0, queue: ['red'], balls: [{ x: 10, y: 10, c: 'red' }] }), null);
  assert.equal(encodeCustomPuzzle({ shots: 1, queue: ['invalid'], balls: [{ x: 10, y: 10, c: 'red' }] }), null);

  const shareUrl = buildCustomPuzzleUrl('https://vblackjack.github.io/magnashot/', sample);
  assert.ok(shareUrl && shareUrl.includes('?puzzle='));
  const parsedFromUrl = readCustomPuzzleFromSearch(new URL(shareUrl).search);
  assert.deepEqual(parsedFromUrl, sample);
});
