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

import { GAME_STATES } from '../core/Constants.js';

/**
 * Returns true when the next engine.update() call will advance the physics simulation,
 * i.e. the game is playing, no hit-stop freeze is pending and no Flux shape is being
 * replaced (that transition only lets the old balls fall, without saving their previous
 * positions, so it cannot be interpolated).
 * @param {object} engine - Game engine exposing state, hitStopFrames and stageTransitionFrames.
 * @returns {boolean}
 */
export function willSimulationAdvance(engine) {
  return engine.state === GAME_STATES.PLAYING && engine.hitStopFrames <= 0 && !(engine.stageTransitionFrames > 0);
}

/**
 * Scene flag value that forces a time scale of 1 and ignores hit-stop on every board.
 */
export const SCENE_TIME_SCALE_FIXED = 'fixed';

/**
 * Creates a fixed-timestep game loop with render interpolation.
 *
 * The loop drives a scene made of one or more boards. All boards share one accumulator and
 * step in lockstep (board 0, then board 1, ...) at the fixed timestep, then every board is
 * rendered by its own renderer. The classic `{engine, renderer}` construction is wrapped as a
 * one-board scene, so single player behaves exactly as before: slow motion and hit-stop come
 * from that one engine. A scene that declares `versus: true` (or `timeScale: 'fixed'`) runs at
 * time scale 1 and ignores hit-stop for the interpolation of every board.
 *
 * Interpolation alpha is forced to 1 whenever the last update did not advance the
 * simulation (hit-stop, pause, menus, Flux stage transition), because previous positions are only saved by a
 * real physics step. While no board is playing or celebrating a victory, the
 * scene is static (a scene whose isAdvancing() says false counts as static too) and is redrawn at the configured
 * idle interval instead of every frame. Any exception
 * thrown by update or render stops the loop for good and is reported once.
 *
 * @param {object} options
 * @param {object} [options.engine] - Game engine for the one-board form (update(), state, hitStopFrames, and the
 *   optional getTimeScale() below 1 for slow motion and refreshAimPreview() before a render).
 * @param {object} [options.renderer] - Renderer exposing render(engine, alpha), for the one-board form.
 * @param {Function} [options.getScene] - Returns `{boards: [{engine, renderer}], versus?, timeScale?, step?, isAdvancing?}`.
 *   Takes precedence over engine and renderer and is read once per frame. When the scene provides `step`, it is
 *   called once per fixed step instead of each board's update(); `isAdvancing()` (optional) tells whether that
 *   step moves the boards, so a held scene is drawn without interpolation.
 * @param {number} options.fixedStepMs - Fixed simulation step in milliseconds.
 * @param {number} options.maxAccumulatedMs - Upper bound of elapsed time per frame.
 * @param {number} options.idleRenderIntervalMs - Redraw interval while not playing.
 * @param {Function} options.scheduleFrame - requestAnimationFrame-like scheduler.
 * @param {Function} options.onFatalError - Called once with the thrown error.
 * @param {Function} [options.beforeFrame] - Called with (now, elapsedMs) at the start of every frame, also while
 *   the game is idle or paused (input polling). Defaults to a no-op. A throw is reported and the loop goes on.
 * @param {Function} [options.onHookError] - Called with the error thrown by beforeFrame. Defaults to console.error.
 * @returns {{start: Function, frame: Function, isStopped: Function}}
 */
export function createGameLoop({
  engine,
  renderer,
  getScene,
  fixedStepMs,
  maxAccumulatedMs,
  idleRenderIntervalMs,
  scheduleFrame,
  onFatalError,
  beforeFrame = () => {},
  onHookError = (err) => console.error('Frame hook failed:', err)
}) {
  let lastTime = null;
  let accumulator = 0;
  let lastRenderTime = null;
  let stopped = false;
  // Per-board "last update advanced the simulation" flags, indexed like scene.boards.
  const lastUpdateAdvanced = [];

  const singleScene = { boards: [{ engine, renderer }] };
  const readScene = typeof getScene === 'function' ? getScene : () => singleScene;

  const frame = (now) => {
    if (stopped) {
      return;
    }
    try {
      const elapsed = lastTime === null ? 0 : Math.min(maxAccumulatedMs, Math.max(0, now - lastTime));
      lastTime = now;
      // A failing input hook must not stop the simulation or the rendering.
      try {
        beforeFrame(now, elapsed);
      } catch (hookErr) {
        onHookError(hookErr);
      }
      const scene = readScene();
      const boards = scene.boards;
      const fixedTime = scene.versus === true || scene.timeScale === SCENE_TIME_SCALE_FIXED;
      const leadEngine = boards[0].engine;
      // Slow motion: fewer fixed steps per real second; interpolation keeps it smooth.
      const timeScale = !fixedTime && typeof leadEngine.getTimeScale === 'function' ? leadEngine.getTimeScale() : 1;
      accumulator += elapsed * timeScale;

      // A scene with its own step() drives its boards itself (match controller: CPU, routing, rounds).
      const sceneStep = typeof scene.step === 'function' ? scene.step : null;
      while (accumulator >= fixedStepMs) {
        // A scene that is held (paused, between rounds) says so: its boards keep their last
        // positions, so interpolating them would swing the picture back and forth.
        const isSceneAdvancing = sceneStep === null || typeof scene.isAdvancing !== 'function' || scene.isAdvancing();
        for (let i = 0; i < boards.length; i++) {
          const boardEngine = boards[i].engine;
          lastUpdateAdvanced[i] = fixedTime
            ? isSceneAdvancing && boardEngine.state === GAME_STATES.PLAYING && !(boardEngine.stageTransitionFrames > 0)
            : willSimulationAdvance(boardEngine);
          if (sceneStep === null) {
            boardEngine.update();
          }
        }
        if (sceneStep !== null) {
          sceneStep();
        }
        accumulator -= fixedStepMs;
      }
      for (const board of boards) {
        if (typeof board.engine.refreshAimPreview === 'function') {
          board.engine.refreshAimPreview();
        }
      }

      // A scene that says it is not advancing (paused, between rounds, behind a dialog) is static: idle redraw.
      const isSceneHeld = typeof scene.isAdvancing === 'function' && !scene.isAdvancing();
      const isLive = !isSceneHeld && boards.some((board) => board.engine.state === GAME_STATES.PLAYING || board.engine.isVictoryCelebrating());
      if (isLive || lastRenderTime === null || now - lastRenderTime >= idleRenderIntervalMs) {
        for (let i = 0; i < boards.length; i++) {
          const alpha = lastUpdateAdvanced[i] && fixedStepMs > 0 ? accumulator / fixedStepMs : 1.0;
          boards[i].renderer.render(boards[i].engine, alpha);
        }
        lastRenderTime = now;
      }
      scheduleFrame(frame);
    } catch (err) {
      stopped = true;
      onFatalError(err);
    }
  };

  return {
    start() {
      scheduleFrame(frame);
    },
    frame,
    isStopped() {
      return stopped;
    }
  };
}
