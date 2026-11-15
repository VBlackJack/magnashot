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

export const ALIAS_ALLOWED_PATTERN = /^[\p{L}\p{N} ]+$/u;
const ALIAS_DISALLOWED_PATTERN = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_RUN_PATTERN = /\s+/gu;
const ALIAS_SEPARATOR = ' ';
const ALIAS_NORMAL_FORM = 'NFC';

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
