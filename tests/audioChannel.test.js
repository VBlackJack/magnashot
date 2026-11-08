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

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioChannel } from '../src/core/AudioChannel.js';

const COMBO = 3;
const PAN_LEFT = -0.6;
const PAN_RIGHT = 0.6;
const VOICE_COUNT = 7;
const HAPTIC_MS = 5;

/** AudioManager stand-in recording its calls. */
const createSpyManager = () => {
  const calls = { playEffect: [], stopAll: 0, setReducedMotion: [], triggerHaptic: [] };
  return {
    calls,
    playEffect: (...args) => calls.playEffect.push(args),
    stopAll: () => { calls.stopAll += 1; return true; },
    setReducedMotion: (value) => calls.setReducedMotion.push(value),
    triggerHaptic: (ms) => calls.triggerHaptic.push(ms),
    getActiveVoiceCount: () => VOICE_COUNT,
    isMuted: () => false
  };
};

test('playEffect forwards the effect, the combo index and the channel pan', () => {
  const manager = createSpyManager();
  const channel = createAudioChannel(manager, { pan: PAN_LEFT });
  channel.playEffect('match', COMBO);
  assert.deepEqual(manager.calls.playEffect, [['match', COMBO, { pan: PAN_LEFT }]]);
  channel.setPan(PAN_RIGHT);
  channel.playEffect('shoot');
  assert.deepEqual(manager.calls.playEffect[1], ['shoot', 0, { pan: PAN_RIGHT }]);
  assert.equal(channel.getPan(), PAN_RIGHT);
});

test('a muted channel plays nothing and does not mute the shared manager', () => {
  const manager = createSpyManager();
  const channel = createAudioChannel(manager, { muted: true });
  channel.playEffect('match', COMBO);
  channel.triggerHaptic(HAPTIC_MS);
  assert.equal(manager.calls.playEffect.length, 0);
  assert.equal(manager.calls.triggerHaptic.length, 0);
  assert.equal(channel.isMuted(), true);
  assert.equal(manager.isMuted(), false);
  channel.setMuted(false);
  channel.playEffect('match', COMBO);
  assert.equal(manager.calls.playEffect.length, 1);
});

test('stopAll is scoped: it never stops the shared manager, so another channel keeps its voices', () => {
  const manager = createSpyManager();
  const first = createAudioChannel(manager);
  const second = createAudioChannel(manager);
  first.stopAll();
  second.stopAll();
  assert.equal(manager.calls.stopAll, 0);
});

test('every other method is forwarded to the shared manager', () => {
  const manager = createSpyManager();
  const channel = createAudioChannel(manager);
  assert.equal(channel.getActiveVoiceCount(), VOICE_COUNT);
  channel.setReducedMotion(true);
  assert.deepEqual(manager.calls.setReducedMotion, [true]);
  channel.triggerHaptic(HAPTIC_MS);
  assert.deepEqual(manager.calls.triggerHaptic, [HAPTIC_MS]);
});

test('a channel tolerates a manager without playEffect', () => {
  const channel = createAudioChannel({});
  assert.doesNotThrow(() => channel.playEffect('match'));
  assert.doesNotThrow(() => channel.stopAll());
});
