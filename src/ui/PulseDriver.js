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
 * Keeps the music in step with the run on screen. Called once per frame from the UI frame
 * hook (not from the engines: a duel runs two of them). The music plays only while a run
 * is being played: it fades out as soon as the run is paused, a menu or a dialog is open, or
 * the run ends, and starts again when the run does. Nothing starts before the audio
 * context exists, and that only comes from a user gesture.
 *
 * @param {object} params
 * @param {object} params.audioManager The shared audio manager.
 * @param {() => ({engine: object|null, isPlaying: boolean})} params.getLead The board the
 *   player is on and whether its run is being played right now.
 * @param {{intensityIntervalMs: number, syncIntervalMs: number}} params.driverConfig
 * @param {number} params.fadeSec Fade of a stop.
 */
export function createPulseDriver({ audioManager, getLead, driverConfig, fadeSec }) {
  let lastIntensityAt = -Infinity;
  let lastSyncAt = -Infinity;

  return {
    /**
     * @param {number} now Frame time in ms.
     * @returns {boolean} True when the music is playing for this frame.
     */
    update(now) {
      const music = audioManager.music;
      if (!music) {
        return false;
      }
      const lead = getLead();
      const wantsMusic = Boolean(lead.engine) && lead.isPlaying && audioManager.isMusicActive();
      const state = music.getState();
      if (!wantsMusic) {
        if (state.running) {
          music.stop(fadeSec);
        }
        return false;
      }
      const modeKey = lead.engine.getResonanceMode();
      if ((!state.running || state.modeKey !== modeKey) && !audioManager.startMusic(modeKey)) {
        return false;
      }
      const isIntensityDue = now - lastIntensityAt >= driverConfig.intensityIntervalMs;
      const isSyncDue = now - lastSyncAt >= driverConfig.syncIntervalMs;
      if (isIntensityDue || isSyncDue) {
        const pulse = lead.engine.getPulseState();
        if (isIntensityDue) {
          lastIntensityAt = now;
          music.setIntensity(pulse.intensity);
        }
        if (isSyncDue && pulse.framesPerBeat > 0) {
          lastSyncAt = now;
          music.syncToBeat(pulse.beatIndex, pulse.beatPhase);
        }
      }
      return true;
    }
  };
}