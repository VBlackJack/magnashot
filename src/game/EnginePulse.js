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

import { configRegistry } from '../core/ConfigRegistry.js';
import { GAME_MODES } from '../core/Constants.js';
import { t } from '../core/I18n.js';
import {
  beatPhase,
  combineIntensity,
  framesPerBeat,
  isInBeatWindow,
  isResonanceAllowed,
  offsetMsToFrames
} from './Resonance.js';

/*
 * Pulse and Resonance on the engine side. The beat clock is the frame counter beatFrame
 * (one tick per update() while PLAYING), so every judgement is a function of frames: it
 * replays the same way and never reads the wall clock or the seeded random streams.
 */

const NO_TIME = 0;
const FULL_SHARE = 1;
const NO_FRAMES = 0;

export const enginePulseMethods = {
  /** Mode key used for the tempo and the rules: a duel board plays as Versus. */
  getResonanceMode() {
    return this.versus ? GAME_MODES.VERSUS : this.mode;
  },

  /**
   * Whether Resonance applies to this board now: the setting (or the versus match option),
   * and never in the competitive runs.
   */
  isResonanceEnabled() {
    const option = this.versus ? this.versusResonanceOption : undefined;
    const storedSetting = Boolean(this.storageManager?.getResonanceEnabled?.());
    return isResonanceAllowed({
      mode: this.getResonanceMode(),
      isDailyRematch: this.isDailyRematch,
      isWeeklyFluxRun: this.isWeeklyFluxRun,
      isSharedFluxRun: this.isSharedFluxRun,
      ghostDuel: Boolean(this.ghostDuel),
      versusOption: option,
      setting: option === true ? true : storedSetting
    });
  },

  /**
   * Beat timing of the mode in frames, null when the tempo or the section is unknown (then
   * nothing is Resonant). The offset is the stored calibration, in whole frames.
   */
  getPulseTiming() {
    const cfg = this.gameConfig.resonance;
    const bpm = configRegistry.get('audio')?.music?.modes?.[this.getResonanceMode()]?.bpm;
    const stepMs = this.physicsConfig?.simulation?.fixedStepMs;
    if (!cfg || !(bpm > 0) || !(stepMs > 0)) {
      return null;
    }
    const offsetMs = this.storageManager?.getRhythmOffsetMs?.() ?? NO_TIME;
    return {
      framesPerBeat: framesPerBeat(bpm, stepMs),
      offsetFrames: offsetMsToFrames(offsetMs, stepMs, cfg.maxOffsetMs),
      windowFrames: cfg.windowFrames
    };
  },

  /** Marks the board as played by a CPU: its shots are Resonant by a roll, not by timing. */
  setBotResonanceDriven(isDriven) {
    this.isBotResonanceBoard = Boolean(isDriven);
    this.botResonanceRoll = null;
  },

  /** Result of the CPU's seeded roll for the shot it is about to take. */
  queueBotResonanceRoll(isResonant) {
    this.botResonanceRoll = Boolean(isResonant);
  },

  /** Versus match option: true or false forces it, undefined follows the setting. */
  setVersusResonanceOption(option) {
    this.versusResonanceOption = option === undefined ? undefined : Boolean(option);
  },

  /** True when the shot leaving now is Resonant. Consumes a queued CPU roll. */
  judgeResonantShot() {
    const roll = this.botResonanceRoll;
    this.botResonanceRoll = null;
    if (!this.isResonanceEnabled()) {
      return false;
    }
    if (this.isBotResonanceBoard) {
      return roll === true;
    }
    const timing = this.getPulseTiming();
    return Boolean(timing)
      && isInBeatWindow(this.beatFrame, timing.offsetFrames, timing.framesPerBeat, timing.windowFrames);
  },

  /** Flags the projectile and the turn as Resonant, with the flash, the text and the sound. */
  markResonantShot(projectile) {
    const isResonant = this.judgeResonantShot();
    projectile.isResonant = isResonant;
    this.turnResonant = isResonant;
    this.turnOverchargeEarned = NO_FRAMES;
    if (!isResonant) {
      return;
    }
    const canvasCfg = this.gameConfig.canvas;
    this.resonanceFlashFrames = this.isReducedMotion ? NO_FRAMES : this.gameConfig.resonance.ring.flashFrames;
    this.particleSystem.spawnFloatingText(
      canvasCfg.launcherX,
      canvasCfg.launcherY + canvasCfg.launcherPopupOffsetY,
      t('gameplay.feedback.resonance'),
      this.gameConfig.theme.overchargePopupColor
    );
    this.audioManager.playEffect('resonance');
  },

  /** Ends the Resonance of the turn, once its shot has been paid out. */
  clearTurnResonance() {
    this.turnResonant = false;
    this.turnOverchargeEarned = NO_FRAMES;
  },

  /**
   * Pays the Resonance bonus of a finished turn: the Overcharge it earned is topped up by
   * the configured factor, but only when the turn made a match or a drop (a whiff earns
   * nothing). Duel boards do not take it: there the bonus is on the charge hit instead.
   * @param {boolean} madeProgress True when the turn matched or dropped something.
   */
  settleTurnResonance(madeProgress) {
    const earned = this.turnOverchargeEarned;
    const wasResonant = this.turnResonant;
    this.clearTurnResonance();
    if (!wasResonant || !madeProgress || this.versus || earned <= NO_FRAMES || !this.isRunPlaying()) {
      return;
    }
    this.settleOvercharge(earned * (this.gameConfig.resonance.overchargeMultiplier - FULL_SHARE));
  },

  /** Share of the pressure on the board in [0, 1], what the music follows. */
  getMusicIntensity() {
    const cfg = this.gameConfig.resonance.intensity;
    const sag = this.getSagState();
    const sagShare = sag.active && sag.size > 0 ? sag.level / sag.size : NO_FRAMES;
    const dangerY = this.gameConfig.canvas.dangerLineY;
    let lowest = -Infinity;
    for (const ball of this.physicsWorld.balls) {
      if (!ball.isDropping) {
        lowest = Math.max(lowest, ball.y + ball.radius);
      }
    }
    const dangerShare = lowest === -Infinity ? NO_FRAMES : FULL_SHARE - (dangerY - lowest) / cfg.dangerSpan;
    const threats = this.versus ? (this.versus.threatIds?.length ?? NO_FRAMES) / cfg.versusThreatFull : NO_FRAMES;
    return combineIntensity([sagShare, dangerShare, threats]);
  },

  /**
   * The beat clock and whether Resonance is live on this board: what the beat ring needs.
   * The phase fields use the calibrated clock, the same one the judgement and the ring use.
   */
  getBeatState() {
    const timing = this.getPulseTiming();
    const isActive = Boolean(timing) && !this.isBotResonanceBoard && this.isResonanceEnabled();
    const shifted = this.beatFrame - (timing?.offsetFrames ?? NO_FRAMES);
    return {
      beatFrame: this.beatFrame,
      framesPerBeat: timing?.framesPerBeat ?? NO_FRAMES,
      offsetFrames: timing?.offsetFrames ?? NO_FRAMES,
      windowFrames: timing?.windowFrames ?? NO_FRAMES,
      beatIndex: timing ? Math.floor(shifted / timing.framesPerBeat) : NO_FRAMES,
      beatPhase: timing ? beatPhase(shifted, timing.framesPerBeat) : NO_FRAMES,
      resonanceActive: isActive
    };
  },

  /** The beat state plus the pressure on the board, what the UI needs to drive the music. */
  getPulseState() {
    return { ...this.getBeatState(), intensity: this.getMusicIntensity() };
  }
};
