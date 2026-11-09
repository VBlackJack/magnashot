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
import { medianOffsetMs, tapDeviationMs } from '../game/Resonance.js';

const MS_PER_MINUTE = 60000;
const HALF = 0.5;
const NO_TAPS = 0;

/**
 * State machine of the rhythm calibration: a regular train of pulses (a few lead pulses,
 * then the counted ones) and the taps of the player. Time is passed in, so nothing here
 * reads a clock and the maths is testable. The offset is the median of the signed distances
 * between each tap and its pulse, clamped to the allowed range.
 *
 * @param {object} params
 * @param {number} params.beats Counted pulses.
 * @param {number} params.leadBeats Pulses before the counted ones, to find the rhythm.
 * @param {number} params.minTaps Fewest counted taps that give a result.
 * @param {number} params.bpm Tempo of the pulses.
 * @param {number} params.maxOffsetMs Largest offset magnitude.
 */
export function createCalibration({ beats, leadBeats, minTaps, bpm, maxOffsetMs }) {
  const beatMs = MS_PER_MINUTE / bpm;
  const totalPulses = leadBeats + beats;
  let startAt = null;
  let firedCount = NO_TAPS;
  let deviations = new Map();

  const pulseTime = (index) => startAt + index * beatMs;

  return {
    beatMs,
    totalPulses,

    /** Starts the pulse train; the first pulse comes one beat after `now`. */
    start(now) {
      startAt = now + beatMs;
      firedCount = NO_TAPS;
      deviations = new Map();
    },

    isRunning() {
      return startAt !== null;
    },

    /** Time since the first pulse, in engine frames (negative before it): feeds the ring. */
    getFrame(now, stepMs) {
      return (now - startAt) / stepMs;
    },

    /**
     * Pulses that became due since the last call, and whether the run is over (half a beat
     * after the last pulse, when no tap can still belong to it).
     * @returns {{fired: number[], isDone: boolean}}
     */
    update(now) {
      const fired = [];
      while (startAt !== null && firedCount < totalPulses && now >= pulseTime(firedCount)) {
        fired.push(firedCount);
        firedCount += 1;
      }
      const isDone = startAt !== null && now >= pulseTime(totalPulses - 1) + beatMs * HALF;
      return { fired, isDone };
    },

    /**
     * Registers a tap. Only the first tap near a counted pulse counts; taps in the lead
     * pulses and taps far from any pulse are ignored.
     * @returns {{isAccepted: boolean, deviationMs: number|null}}
     */
    tap(now) {
      if (startAt === null) {
        return { isAccepted: false, deviationMs: null };
      }
      const index = Math.round((now - startAt) / beatMs);
      const deviationMs = tapDeviationMs(now, startAt, beatMs);
      const isCounted = index >= leadBeats && index < totalPulses;
      if (!isCounted || Math.abs(deviationMs) > beatMs * HALF || deviations.has(index)) {
        return { isAccepted: false, deviationMs: null };
      }
      deviations.set(index, deviationMs);
      return { isAccepted: true, deviationMs };
    },

    getTapCount() {
      return deviations.size;
    },

    /** @returns {{taps: number, offsetMs: number|null}} offsetMs is null with too few taps. */
    getResult() {
      const taps = deviations.size;
      return {
        taps,
        offsetMs: taps >= minTaps ? medianOffsetMs([...deviations.values()], maxOffsetMs) : null
      };
    }
  };
}