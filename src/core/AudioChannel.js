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

/** Methods the channel answers itself; everything else goes to the shared manager. */
const CHANNEL_OWN_METHODS = Object.freeze(['playEffect', 'stopAll', 'setMuted', 'isMuted', 'triggerHaptic']);

/** Pan of a centred channel. */
const CENTRE_PAN = 0;

/**
 * One engine's view of the shared audio manager. A versus match runs two engines on one
 * manager: a channel lets one board be muted (the CPU board) and carry a stereo position,
 * and its stopAll never silences the other board's voices.
 *
 * playEffect forwards the effect name, the combo index and the channel pan to the manager.
 * stopAll is scoped: it does not call the shared manager's stopAll (which stops every
 * voice, including the other channel's); the voices of an effect fade out by themselves.
 * Any other method the engine uses (isMuted aside) is forwarded to the manager.
 *
 * @param {object} audioManager - The shared AudioManager.
 * @param {{muted?: boolean, pan?: number}} [options] - Initial channel state.
 * @returns {object} The channel, usable wherever an audio manager is expected.
 */
export function createAudioChannel(audioManager, { muted = false, pan = CENTRE_PAN } = {}) {
  let isChannelMuted = Boolean(muted);
  let channelPan = Number.isFinite(pan) ? pan : CENTRE_PAN;

  const channel = {
    playEffect(effectName, ...args) {
      if (isChannelMuted || typeof audioManager?.playEffect !== 'function') {
        return undefined;
      }
      const [comboIndex = 0] = args;
      return audioManager.playEffect(effectName, comboIndex, { pan: channelPan });
    },
    stopAll() {
      return false;
    },
    setMuted(value) {
      isChannelMuted = Boolean(value);
    },
    isMuted() {
      return isChannelMuted;
    },
    triggerHaptic(...args) {
      if (isChannelMuted || typeof audioManager?.triggerHaptic !== 'function') {
        return undefined;
      }
      return audioManager.triggerHaptic(...args);
    },
    getPan() {
      return channelPan;
    },
    setPan(value) {
      channelPan = Number.isFinite(value) ? value : CENTRE_PAN;
    }
  };

  return new Proxy(channel, {
    get(target, property, receiver) {
      if (Reflect.has(target, property) || CHANNEL_OWN_METHODS.includes(property)) {
        return Reflect.get(target, property, receiver);
      }
      const forwarded = audioManager?.[property];
      return typeof forwarded === 'function' ? forwarded.bind(audioManager) : forwarded;
    }
  });
}
