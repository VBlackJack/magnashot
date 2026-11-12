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

/** Event ids of the Merge Basin event pool, as keyed in configs/modes.json `merge.events.pool`. */
export const MERGE_EVENT_IDS = Object.freeze({
  WIND: 'wind',
  LOW_GRAVITY: 'lowGravity',
  BOUNCY: 'bouncy',
  BIG_DROPS: 'bigDrops',
  GOLDEN: 'golden'
});

/** Direction values of a wind event; every other event stores the right-hand one. */
export const MERGE_EVENT_DIRECTIONS = Object.freeze({ LEFT: -1, RIGHT: 1 });

/** Locale segment of an event: the wind has one per direction so its name says where it blows. */
export function getMergeEventLocaleId(event) {
  if (event.id !== MERGE_EVENT_IDS.WIND) {
    return event.id;
  }
  return event.direction === MERGE_EVENT_DIRECTIONS.LEFT ? 'windLeft' : 'windRight';
}

/** Locale key of one text of an event (`name`, `description` or `icon`). */
export function getMergeEventTextKey(event, field) {
  return `gameplay.merge.events.${getMergeEventLocaleId(event)}.${field}`;
}
