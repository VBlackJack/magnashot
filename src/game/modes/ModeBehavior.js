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

import { LAUNCHER_POSTURES, MATH_CONSTANTS } from '../../core/Constants.js';

const DEFAULT_NEXT_OFFSET_X = 60;
const DEFAULT_NEXT_OFFSET_Y = 16;

export const DEFAULT_RENDER_CHROME = Object.freeze({
  ambientLiquid: true,
  collectorBins: true,
  dangerZone: true,
  aimLine: true
});

/**
 * Base strategy shared by standard magnetic-cluster modes.
 * Arcade behavior modes override only the hooks that diverge from the core loop.
 */
export class ModeBehavior {
  constructor(mode = 'default') {
    this.mode = mode;
  }

  getLauncherSpec(engine) {
    const canvasCfg = engine.gameConfig.canvas;
    return {
      x: canvasCfg.launcherX ?? canvasCfg.logicalWidth * MATH_CONSTANTS.HALF,
      y: canvasCfg.launcherY,
      posture: LAUNCHER_POSTURES.UPWARD,
      minAngle: -canvasCfg.maxAimAngleRad,
      maxAngle: -canvasCfg.minAimAngleRad,
      defaultAngle: -Math.PI * MATH_CONSTANTS.HALF,
      nextOffsetX: canvasCfg.nextBallOffsetX ?? DEFAULT_NEXT_OFFSET_X,
      nextOffsetY: canvasCfg.nextBallOffsetY ?? DEFAULT_NEXT_OFFSET_Y,
      compactQueue: false,
      cancelOffset: canvasCfg.cancelAimOffsetY ?? 0,
      cancelRadius: 0
    };
  }

  getRenderChrome() {
    return DEFAULT_RENDER_CHROME;
  }

  offersSpecialBalls() {
    return null;
  }

  isSpecialTypeAllowed() {
    return true;
  }

  hidesOvercharge() {
    return false;
  }

  /**
   * Locale key a Pause input hint reads in this mode.
   * @param {string} key - Generic hint key from MODAL_INPUT_HINTS.
   * @returns {string} The key to read, the generic one unless the mode words it its own way.
   */
  getInputHintKey(key) {
    return key;
  }

  /** Locale key of the tip shown at the foot of the Pause instructions. */
  getPauseTipKey() {
    return 'modals.pause.instructions.physics';
  }

  /** False for a mode without colour matches or anchors, where the basics hint would mislead. */
  teachesMatchBasics() {
    return true;
  }

  neutralizesWorkshopUpgrades() {
    return false;
  }

  isTiltLocked() {
    return false;
  }

  allowsEmptyBoardSnapshot() {
    return false;
  }

  canFire() {
    return null;
  }

  fire() {
    return false;
  }

  pickLauncherColor() {
    return null;
  }

  getNextBallRadius(engine) {
    return engine.physicsConfig.ball.radius;
  }

  setupMode() {}

  onBeforePhysicsStep() {}

  onAfterPhysicsStep() {}

  onProjectileSettled() {
    return false;
  }

  onSpecialTriggered() {}

  onPolarityFlipped() {}

  evaluateBoardState() {
    return false;
  }

  serializeModeState() {
    return null;
  }

  validateModeState(rawState) {
    return rawState === null || rawState === undefined;
  }

  restoreModeState() {}

  drawUnderlay() {}

  drawOverlay() {}

  drawLauncherOverlay() {}
}

export const DEFAULT_MODE_BEHAVIOR = Object.freeze(new ModeBehavior('default'));

const BEHAVIOR_REGISTRY = new Map();

export function registerModeBehavior(mode, behavior) {
  BEHAVIOR_REGISTRY.set(mode, behavior);
}

export function getRegisteredModeBehavior(mode) {
  return BEHAVIOR_REGISTRY.get(mode) ?? DEFAULT_MODE_BEHAVIOR;
}
