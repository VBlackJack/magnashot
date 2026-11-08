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
 * @returns {{unbind: () => void}}
 */
export function bindCanvasInput(canvas, getEngine, gameConfig, options = {}) {
  const { isBlocked = () => false, onAimChanged = () => {}, acceptPointer = () => true } = options;
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

  const getAimAdjustedCoords = (e, pos) => {
    if (e.pointerType === 'touch') {
      const canvasCfg = gameConfig.canvas;
      const cancelThresholdY = canvasCfg.launcherY + canvasCfg.cancelAimOffsetY;
      if (pos.y > cancelThresholdY) {
        return pos;
      }
      const shiftedY = pos.y + canvasCfg.touchAimVerticalOffset;
      const maxAnchorY = canvasCfg.launcherY + canvasCfg.touchMinAimAnchorOffsetY;
      return {
        x: pos.x,
        y: Math.min(shiftedY, maxAnchorY)
      };
    }
    return pos;
  };

  const isSwapClick = (x, y) => {
    const canvasCfg = gameConfig.canvas;
    const nx = canvasCfg.launcherX + canvasCfg.nextBallOffsetX;
    const ny = canvasCfg.launcherY + canvasCfg.nextBallOffsetY;
    return Math.hypot(x - nx, y - ny) <= canvasCfg.swapClickRadius;
  };

  const isLauncherBaseTap = (x, y, startPos) => {
    const canvasCfg = gameConfig.canvas;
    const distToLauncher = Math.hypot(x - canvasCfg.launcherX, y - canvasCfg.launcherY);
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

  listen('pointermove', (e) => {
    const engine = getEngine();
    if (!e.isPrimary || !acceptPointer(e)) {
      return;
    }
    if (isBlocked()) {
      return;
    }
    const rawPos = toLogicalCoords(e.clientX, e.clientY);
    const aimPos = getAimAdjustedCoords(e, rawPos);
    if (aimsAtPointer(engine, e, aimPos)) {
      engine.updateAim(aimPos.x, aimPos.y);
    }
    onAimChanged(engine);
  });

  listen('pointerdown', (e) => {
    const engine = getEngine();
    if (!e.isPrimary || !acceptPointer(e)) {
      return;
    }
    if (e.button !== undefined && e.button !== 0) {
      return;
    }
    if (isBlocked()) {
      return;
    }
    isPointerDownOnCanvas = true;
    if (typeof canvas.setPointerCapture === 'function') {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore pointer capture errors
      }
    }
    const rawPos = toLogicalCoords(e.clientX, e.clientY);
    pointerDownPos = { x: rawPos.x, y: rawPos.y };
    if (isSwapClick(rawPos.x, rawPos.y) || isLauncherBaseTap(rawPos.x, rawPos.y, null)) {
      return;
    }
    const aimPos = getAimAdjustedCoords(e, rawPos);
    if (aimsAtPointer(engine, e, aimPos)) {
      engine.updateAim(aimPos.x, aimPos.y);
    }
    onAimChanged(engine);
  });

  listen('pointerup', (e) => {
    const engine = getEngine();
    if (!e.isPrimary || !acceptPointer(e)) {
      return;
    }
    if (e.button !== undefined && e.button !== 0) {
      return;
    }
    if (!isPointerDownOnCanvas) {
      return;
    }
    isPointerDownOnCanvas = false;
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
    if (isSwapClick(rawPos.x, rawPos.y) || isLauncherBaseTap(rawPos.x, rawPos.y, startPos)) {
      engine.isAimCancelled = false;
      engine.swapLauncherBalls();
      onAimChanged(engine);
      return;
    }
    const aimPos = getAimAdjustedCoords(e, rawPos);
    // A click within the lock shoots along the keyboard-adjusted angle.
    if (aimsAtPointer(engine, e, aimPos)) {
      engine.updateAim(aimPos.x, aimPos.y);
    }
    engine.shoot();
    onAimChanged(engine);
  });

  listen('pointercancel', (e) => {
    const engine = getEngine();
    if (!e.isPrimary || !acceptPointer(e)) {
      return;
    }
    isPointerDownOnCanvas = false;
    pointerDownPos = null;
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

  return {
    unbind() {
      while (unbinders.length > 0) {
        unbinders.pop()();
      }
    }
  };
}
