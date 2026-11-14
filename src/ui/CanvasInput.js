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

import { LAUNCHER_POSTURES } from '../core/Constants.js';

const POINTER_OWNERSHIP_PRIMARY = 'primary';
const POINTER_OWNERSHIP_PER_CANVAS = 'perCanvas';
const MOUSE_POINTER_TYPE = 'mouse';

/**
 * Binds the pointer controls of a game canvas (aim, tap-to-swap, release-to-shoot) to the
 * engine returned by `getEngine` at the time of each event.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {() => object} getEngine Current engine of this canvas.
 * @param {object} gameConfig Game configuration (canvas geometry).
 * @param {object} [options]
 * @param {() => boolean} [options.isBlocked] True while a dialog owns the pointer.
 * @param {(engine: object) => void} [options.onAimChanged] Called after the aim state changed.
 * @param {(event: PointerEvent) => boolean} [options.acceptPointer] Filters the pointers this canvas follows.
 * @param {'primary'|'perCanvas'} [options.pointerOwnership] 'primary' follows the primary pointer only
 *   (default). 'perCanvas' lets this canvas own one pointerId from pointerdown until up, cancel or
 *   lost capture, ignoring every other pointer; with no owned pointer only mouse hover moves the aim.
 * @returns {{unbind: () => void}}
 */
export function bindCanvasInput(canvas, getEngine, gameConfig, options = {}) {
  const {
    isBlocked = () => false,
    onAimChanged = () => {},
    acceptPointer = () => true,
    pointerOwnership = POINTER_OWNERSHIP_PRIMARY
  } = options;
  const perCanvas = pointerOwnership === POINTER_OWNERSHIP_PER_CANVAS;
  const unbinders = [];
  const listen = (type, handler) => {
    canvas.addEventListener(type, handler);
    unbinders.push(() => canvas.removeEventListener(type, handler));
  };

  const toLogicalCoords = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = gameConfig.canvas.logicalWidth / rect.width;
    const scaleY = gameConfig.canvas.logicalHeight / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const getLauncherSpec = (engine) => {
    if (engine && typeof engine.getLauncherSpec === 'function') {
      return engine.getLauncherSpec();
    }
    const canvasCfg = gameConfig.canvas;
    return {
      x: canvasCfg.launcherX,
      y: canvasCfg.launcherY,
      posture: LAUNCHER_POSTURES.UPWARD,
      nextOffsetX: canvasCfg.nextBallOffsetX,
      nextOffsetY: canvasCfg.nextBallOffsetY,
      cancelOffset: canvasCfg.cancelAimOffsetY,
      cancelRadius: 0
    };
  };

  const getAimAdjustedCoords = (engine, e, pos) => {
    if (e.pointerType === 'touch') {
      const spec = getLauncherSpec(engine);
      if (spec.posture !== LAUNCHER_POSTURES.UPWARD) {
        return pos;
      }
      const canvasCfg = gameConfig.canvas;
      const cancelThresholdY = spec.y + canvasCfg.cancelAimOffsetY;
      if (pos.y > cancelThresholdY) {
        return pos;
      }
      const shiftedY = pos.y + canvasCfg.touchAimVerticalOffset;
      const maxAnchorY = spec.y + canvasCfg.touchMinAimAnchorOffsetY;
      return {
        x: pos.x,
        y: Math.min(shiftedY, maxAnchorY)
      };
    }
    return pos;
  };

  const isSwapClick = (engine, x, y) => {
    const canvasCfg = gameConfig.canvas;
    const spec = getLauncherSpec(engine);
    const nx = spec.x + spec.nextOffsetX;
    const ny = spec.y + spec.nextOffsetY;
    return Math.hypot(x - nx, y - ny) <= canvasCfg.swapClickRadius;
  };

  const isLauncherBaseTap = (engine, x, y, startPos) => {
    const spec = getLauncherSpec(engine);
    if (spec.posture === LAUNCHER_POSTURES.DROP_RAIL) {
      return false;
    }
    const canvasCfg = gameConfig.canvas;
    const distToLauncher = Math.hypot(x - spec.x, y - spec.y);
    if (distToLauncher > canvasCfg.launcherTapSwapRadius) {
      return false;
    }
    if (!startPos) {
      return true;
    }
    return Math.hypot(x - startPos.x, y - startPos.y) <= canvasCfg.tapMaxMoveDistance;
  };

  // A finger always aims; a mouse leaves a keyboard-adjusted aim alone until it moves
  // far enough (GameEngine.followPointer).
  const aimsAtPointer = (engine, e, pos) => {
    if (e.pointerType === 'touch') {
      engine.releaseAimLock();
      return true;
    }
    return engine.followPointer(pos.x, pos.y);
  };

  let isPointerDownOnCanvas = false;
  let pointerDownPos = null;
  let ownedPointerId = null;

  // 'primary': only the primary pointer counts. 'perCanvas': only the owned pointer counts.
  const followsPointer = (e) => {
    if (!acceptPointer(e)) {
      return false;
    }
    if (!perCanvas) {
      return Boolean(e.isPrimary);
    }
    return ownedPointerId === null ? true : e.pointerId === ownedPointerId;
  };

  const clearOwnership = () => {
    isPointerDownOnCanvas = false;
    pointerDownPos = null;
    ownedPointerId = null;
  };

  listen('pointermove', (e) => {
    const engine = getEngine();
    if (!followsPointer(e)) {
      return;
    }
    if (perCanvas && ownedPointerId === null && e.pointerType !== MOUSE_POINTER_TYPE) {
      return;
    }
    if (isBlocked()) {
      return;
    }
    const rawPos = toLogicalCoords(e.clientX, e.clientY);
    const aimPos = getAimAdjustedCoords(engine, e, rawPos);
    if (aimsAtPointer(engine, e, aimPos)) {
      engine.updateAim(aimPos.x, aimPos.y);
      if (!isPointerDownOnCanvas) {
        engine.isAimCancelled = false;
      }
    }
    onAimChanged(engine);
  });

  listen('pointerdown', (e) => {
    const engine = getEngine();
    if (!followsPointer(e) || (perCanvas && ownedPointerId !== null)) {
      return;
    }
    if (e.button !== undefined && e.button !== 0) {
      return;
    }
    if (isBlocked()) {
      return;
    }
    isPointerDownOnCanvas = true;
    if (perCanvas) {
      ownedPointerId = e.pointerId;
    }
    if (typeof canvas.setPointerCapture === 'function') {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore pointer capture errors
      }
    }
    const rawPos = toLogicalCoords(e.clientX, e.clientY);
    pointerDownPos = { x: rawPos.x, y: rawPos.y };
    if (isSwapClick(engine, rawPos.x, rawPos.y) || isLauncherBaseTap(engine, rawPos.x, rawPos.y, null)) {
      return;
    }
    const aimPos = getAimAdjustedCoords(engine, e, rawPos);
    if (aimsAtPointer(engine, e, aimPos)) {
      engine.updateAim(aimPos.x, aimPos.y);
    }
    onAimChanged(engine);
  });

  listen('pointerup', (e) => {
    const engine = getEngine();
    if (!followsPointer(e)) {
      return;
    }
    if (e.button !== undefined && e.button !== 0) {
      return;
    }
    if (!isPointerDownOnCanvas) {
      return;
    }
    isPointerDownOnCanvas = false;
    ownedPointerId = null;
    if (typeof canvas.releasePointerCapture === 'function') {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore pointer capture errors
      }
    }
    const startPos = pointerDownPos;
    pointerDownPos = null;
    if (isBlocked()) {
      return;
    }
    const rawPos = toLogicalCoords(e.clientX, e.clientY);
    const startedOnSwap = startPos !== null && isSwapClick(engine, startPos.x, startPos.y);
    if ((startedOnSwap && isSwapClick(engine, rawPos.x, rawPos.y)) || isLauncherBaseTap(engine, rawPos.x, rawPos.y, startPos)) {
      engine.isAimCancelled = false;
      engine.swapLauncherBalls();
      onAimChanged(engine);
      return;
    }
    const aimPos = getAimAdjustedCoords(engine, e, rawPos);
    // A click within the lock shoots along the keyboard-adjusted angle.
    if (aimsAtPointer(engine, e, aimPos)) {
      engine.updateAim(aimPos.x, aimPos.y);
    }
    engine.shoot();
    onAimChanged(engine);
  });

  listen('pointercancel', (e) => {
    const engine = getEngine();
    if (!followsPointer(e)) {
      return;
    }
    clearOwnership();
    if (typeof canvas.releasePointerCapture === 'function' && e?.pointerId !== undefined) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore pointer capture errors
      }
    }
    engine.isAimCancelled = false;
    onAimChanged(engine);
  });

  // Capture lost without an up or cancel (element removed, capture stolen): free the pointer.
  if (perCanvas) {
    listen('lostpointercapture', (e) => {
      if (ownedPointerId === null || e.pointerId !== ownedPointerId) {
        return;
      }
      clearOwnership();
      const engine = getEngine();
      engine.isAimCancelled = false;
      onAimChanged(engine);
    });
  }

  return {
    unbind() {
      while (unbinders.length > 0) {
        unbinders.pop()();
      }
    }
  };
}
