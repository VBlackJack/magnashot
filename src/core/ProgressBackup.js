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

const encoder = new TextEncoder();
const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_KEY = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;
const NON_NEGATIVE_INTEGER = /^(?:0|[1-9]\d*)$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateSize(text, maxBytes) {
  if (typeof text !== 'string' || text.length > maxBytes || encoder.encode(text).byteLength > maxBytes) {
    throw new RangeError('Progress data exceeds the configured UTF-8 byte limit');
  }
}

function parseJson(text) {
  return JSON.parse(text, (key, value) => {
    if (UNSAFE_PROPERTY_NAMES.has(key) || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new TypeError('Progress data contains an unsupported JSON property or value');
    }
    return value;
  });
}

function isDateKey(raw) {
  if (!DATE_KEY.test(raw)) {
    return false;
  }
  const date = new Date(raw);
  return Number.isFinite(date.valueOf()) && date.toISOString().startsWith(raw);
}

/** Stored progression keeps its original string encoding across devices and origins. */
const VALUE_VALIDATORS = Object.freeze({
  integer: (raw) => NON_NEGATIVE_INTEGER.test(raw) && Number.isSafeInteger(Number(raw)),
  object: (raw) => isRecord(parseJson(raw)),
  array: (raw) => Array.isArray(parseJson(raw)),
  date: isDateKey,
  week: (raw) => WEEK_KEY.test(raw),
  string: (raw) => raw.length > 0,
  optionalString: (raw) => typeof raw === 'string',
  boolean: (raw) => raw === 'true' || raw === 'false'
});

function progressKey(config, field) {
  if (!Object.hasOwn(config.progressBackup.fields, field) || !Object.hasOwn(config.keys, field)) {
    throw new TypeError('Progress data contains an unrecognized field');
  }
  return config.prefix + config.keys[field];
}

function validateFields(fields, config) {
  if (!isRecord(fields)) {
    throw new TypeError('Progress fields must be a JSON object');
  }
  for (const [field, raw] of Object.entries(fields)) {
    progressKey(config, field);
    const type = config.progressBackup.fields[field];
    if (typeof raw !== 'string' || !Object.hasOwn(VALUE_VALIDATORS, type) || !VALUE_VALIDATORS[type](raw)) {
      throw new TypeError('Progress field has an invalid value');
    }
  }
}

function serializePayload(payload, backup) {
  const { format, version, maxBytes } = backup;
  const text = JSON.stringify({ format, version, ...payload });
  validateSize(text, maxBytes);
  return text;
}

function readPayload(text, backup, payloadKey) {
  validateSize(text, backup.maxBytes);
  const parsed = parseJson(text);
  if (!isRecord(parsed) || parsed.format !== backup.format || parsed.version !== backup.version
    || !Object.hasOwn(parsed, payloadKey) || Object.keys(parsed).length !== 3) {
    throw new TypeError('Unsupported progress backup format or version');
  }
  return parsed[payloadKey];
}

/** Exports only progression fields, independent of the current origin or storage prefix. */
export function exportProgress(storage, config) {
  const fields = {};
  for (const field of Object.keys(config.progressBackup.fields)) {
    const value = storage.getItem(progressKey(config, field));
    if (value !== null) {
      fields[field] = value;
    }
  }
  const text = serializePayload({ fields }, config.progressBackup);
  validateFields(fields, config);
  return text;
}

/** Validates the whole file before the confirmation UI or any storage writes. */
export function parseProgress(text, config) {
  const fields = readPayload(text, config.progressBackup, 'fields');
  validateFields(fields, config);
  return Object.freeze({ fields: Object.freeze(fields), count: Object.keys(fields).length });
}

function importJournalKey(config) {
  return config.prefix + config.progressBackup.journalKey;
}

function restoreBeforeImage(storage, config, before) {
  // Reverse write order to unwind the same storage sizes that fit during import.
  for (const [field, value] of Object.entries(before).reverse()) {
    const key = progressKey(config, field);
    if (storage.getItem(key) === value) {
      continue;
    }
    if (value === null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, value);
    }
  }
}

/** Restores the original progression after interruption, before game state is loaded. */
export function recoverProgressImport(storage, config) {
  const journalKey = importJournalKey(config);
  const text = storage.getItem(journalKey);
  if (text === null) {
    return false;
  }
  const before = readPayload(text, config.progressBackup, 'before');
  if (!isRecord(before)) {
    throw new TypeError('Progress recovery data must be a JSON object');
  }
  for (const [field, value] of Object.entries(before)) {
    progressKey(config, field);
    if (value !== null && typeof value !== 'string') {
      throw new TypeError('Invalid value in progress recovery data');
    }
  }
  restoreBeforeImage(storage, config, before);
  storage.removeItem(journalKey);
  return true;
}

/**
 * Replaces supplied fields only. An import is committed when the journal is removed.
 * If restoration fails, the journal remains available for recovery on the next boot.
 */
export function importProgress(storage, config, validated) {
  const fields = validated?.fields;
  validateFields(fields, config);
  serializePayload({ fields }, config.progressBackup);
  const journalKey = importJournalKey(config);
  if (storage.getItem(journalKey) !== null) {
    throw new Error('A previous progress import needs recovery');
  }

  const changes = Object.entries(fields).map(([field, value]) => {
    const key = progressKey(config, field);
    return { field, key, value, previous: storage.getItem(key) };
  }).filter(({ value, previous }) => value !== previous);
  if (changes.length === 0) {
    return 0;
  }
  const before = Object.fromEntries(changes.map(({ field, previous }) => [field, previous]));
  storage.setItem(journalKey, serializePayload({ before }, config.progressBackup));

  try {
    for (const { key, value } of changes) {
      storage.setItem(key, value);
    }
    storage.removeItem(journalKey);
  } catch (importError) {
    try {
      recoverProgressImport(storage, config);
    } catch (recoveryError) {
      throw new AggregateError([importError, recoveryError], 'Progress import and immediate recovery both failed', {
        cause: recoveryError
      });
    }
    throw importError;
  }
  return changes.length;
}
