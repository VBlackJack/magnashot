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

import { i18n } from '../../core/I18n.js';

/** Contract types of the Merge Basin, as keyed in configs/modes.json `merge.contracts.types`. */
export const MERGE_CONTRACT_TYPES = Object.freeze({
  FUSE_CALIBRE: 'fuseCalibre',
  FUSION_COUNT: 'fusionCount'
});

/** How a contract ended; a success pays, a failure costs nothing. */
export const MERGE_CONTRACT_OUTCOMES = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure'
});

/** Locale suffix of a text said when no drop is left but the last one is still settling. */
export const MERGE_CONTRACT_LAST_DROP_KEY = 'last';

/**
 * Locale suffix of a count-dependent text. It follows the plural rules of the current locale
 * (French reads zero as singular), and a count of zero means the last drop is still in play.
 */
export function getMergeContractPluralKey(count) {
  if (count <= 0) {
    return MERGE_CONTRACT_LAST_DROP_KEY;
  }
  return new Intl.PluralRules(i18n.getLocale()).select(count) === 'one' ? 'one' : 'other';
}
