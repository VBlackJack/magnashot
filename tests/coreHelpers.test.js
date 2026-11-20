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
  summarizeGrandMastery
} from '../src/ui/PlayHubView.js';
import { ARENA_THEMES, GAME_MODES } from '../src/core/Constants.js';

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
});
