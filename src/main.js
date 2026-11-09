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

import { configRegistry } from './core/ConfigRegistry.js';
import { i18n, t, resolveInitialLocale } from './core/I18n.js';
import { StorageManager } from './core/StorageManager.js';
import { GamepadInput } from './core/GamepadInput.js';
import { AudioManager } from './core/AudioManager.js';
import { Renderer } from './game/Renderer.js';
import { GameEngine } from './game/GameEngine.js';
import { UIManager, isSharedFluxOverSavedRun } from './ui/UIManager.js';
import { createGameLoop } from './game/GameLoop.js';
import { FLUX_SEED_QUERY_PARAM, readFluxSeedFromSearch, stripFluxSeedFromUrl } from './game/DailyShare.js';
import { DUEL_STATUS, readDuelFromSearch } from './game/GhostCodec.js';
import { GAME_MODES } from './core/Constants.js';
import { bindCanvasInput } from './ui/CanvasInput.js';

const BOOTSTRAP_ERROR_ELEMENT_ID = 'bootstrap-error';
const HIDDEN_CLASS = 'hidden';

class Application {
  async bootstrap() {
    try {
      await configRegistry.loadAll();

      const gameConfig = configRegistry.get('game');
      const physicsConfig = configRegistry.get('physics');
      const ballsConfig = configRegistry.get('balls');
      const obstaclesConfig = configRegistry.get('obstacles');
      const levelsConfig = configRegistry.get('levels');
      const campaignConfig = configRegistry.get('campaign');
      const campaignTuning = configRegistry.get('campaign_tuning');
      const fluxShapeTuning = configRegistry.get('flux_shape_tuning');
      const fluxConfig = configRegistry.get('flux');

      const storageManager = new StorageManager();
      storageManager.init();

      const initialLang = resolveInitialLocale(
        storageManager.getStoredLanguage(),
        gameConfig.defaults.supportedLanguages,
        gameConfig.defaults.language
      );
      await i18n.init(initialLang, gameConfig.defaults.language);

      const audioManager = new AudioManager();
      audioManager.init(storageManager.getMuted(), storageManager.getReducedMotion(), {
        vibrationEnabled: storageManager.getGamepadRumble()
      });

      const canvas = document.getElementById('game-canvas');
      const renderer = new Renderer(canvas, gameConfig, ballsConfig, obstaclesConfig);
      renderer.setHighContrast(storageManager.getHighContrast());
      renderer.setColorPatterns(storageManager.getColorPatterns());
      renderer.setBallStyle(storageManager.getActiveBallStyle());

      let uiManager = null;
      const engine = new GameEngine({
        gameConfig,
        physicsConfig,
        ballsConfig,
        obstaclesConfig,
        levelsConfig,
        campaignConfig,
        campaignTuning,
        fluxShapeTuning,
        fluxConfig,
        audioManager,
        storageManager,
        onStateChange: (eng, extra) => {
          const urlFluxSeed = readFluxSeedFromSearch(window.location?.search, fluxConfig.seed);
          if (urlFluxSeed && (eng.mode !== GAME_MODES.FLUX || eng.fluxSeed !== urlFluxSeed)) {
            window.history?.replaceState?.(null, '', stripFluxSeedFromUrl(window.location?.href));
          }
          if (uiManager) {
            uiManager.refresh(eng, extra);
          }
        }
      });

      uiManager = new UIManager({
        engine,
        renderer,
        storageManager,
        audioManager,
        gameConfig,
        ballsConfig,
        versusConfigs: {
          gameConfig,
          physicsConfig,
          ballsConfig,
          obstaclesConfig,
          levelsConfig,
          campaignConfig,
          campaignTuning,
          fluxShapeTuning,
          fluxConfig
        }
      });
      uiManager.init();

      const gamepadInput = new GamepadInput({
        config: gameConfig.gamepad,
        fineStepRad: gameConfig.canvas.keyboardAimFineStepRad,
        settings: {
          enabled: storageManager.getGamepadEnabled(),
          deadzone: storageManager.getGamepadDeadzone(),
          aimSpeed: storageManager.getGamepadAimSpeed(),
          invertX: storageManager.getGamepadInvertX()
        }
      });
      gamepadInput.attach(window);
      uiManager.setGamepadInput(gamepadInput);

      bindCanvasInput(canvas, () => engine, gameConfig, {
        isBlocked: () => uiManager.isAnyModalOpen(),
        onAimChanged: (activeEngine) => uiManager.updateAimState(activeEngine)
      });

      // High scores are only written at run end; also flush them when the page is left mid-run.
      // The run itself is stored too: mobile browsers discard hidden tabs without warning.
      const persistOnLeave = () => {
        engine.persistRunHighScore();
        engine.flushPlayerStats();
        engine.saveRunSnapshot();
      };
      window.addEventListener('pagehide', persistOnLeave);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          persistOnLeave();
        }
      });

      // The duel link is read before the boot: starting a run rewrites the address bar. A valid
      // duel is started from its card, so the Flux seed next to it does not drive the boot.
      const duelRead = readDuelFromSearch(window.location?.search, gameConfig.ghostDuel, {
        ...engine.buildGhostContext(),
        fluxParam: FLUX_SEED_QUERY_PARAM
      });
      const hasValidDuel = duelRead.status === DUEL_STATUS.VALID;
      const sharedFluxSeed = hasValidDuel ? null : readFluxSeedFromSearch(window.location?.search, fluxConfig.seed);
      const savedSnapshot = storageManager.loadRunSnapshot();
      let hasRestoredRun = false;
      const canRestoreSaved = !sharedFluxSeed || savedSnapshot?.engine?.fluxSeed === sharedFluxSeed;
      if (isSharedFluxOverSavedRun(sharedFluxSeed, savedSnapshot) && engine.restoreSavedRun()) {
        hasRestoredRun = true;
        // A shared link must not silently erase a saved run: the player confirms first.
        uiManager.requestDestructiveAction(
          () => {
            uiManager.hideAllModals();
            engine.startFluxRun(sharedFluxSeed, { isShared: true });
          },
          () => t('app.nav.button.flux'),
          { always: true }
        );
      } else {
        hasRestoredRun = canRestoreSaved && engine.restoreSavedRun();
        if (!hasRestoredRun) {
          if (sharedFluxSeed) {
            engine.startFluxRun(sharedFluxSeed, { isShared: true });
          } else {
            engine.startCampaignLevel(storageManager.getUnlockedLevel());
          }
        }
      }

      // The card goes on top of the normal boot: the explicit start of a duel, or why it cannot start.
      if (duelRead.status !== DUEL_STATUS.NONE) {
        uiManager.showDuelCard(duelRead, { isRunAtStake: hasRestoredRun });
      }

      const gameLoop = createGameLoop({
        // The run, or the Polarity Duel match while its screen is open.
        getScene: () => uiManager.getLoopScene(),
        fixedStepMs: physicsConfig.simulation.fixedStepMs,
        maxAccumulatedMs: physicsConfig.simulation.maxAccumulatedMs,
        idleRenderIntervalMs: gameConfig.canvas.idleRenderIntervalMs,
        scheduleFrame: (callback) => requestAnimationFrame(callback),
        beforeFrame: (now, elapsedMs) => {
          uiManager.pollGamepad(now, elapsedMs);
          uiManager.driveMusic(now);
        },
        onFatalError: (err) => {
          console.error('Game loop stopped after an unrecoverable error:', err);
          this.renderBootstrapError();
        }
      });
      gameLoop.start();
      this.registerServiceWorker(gameConfig.serviceWorker);
    } catch (err) {
      console.error('Initialization failed:', err);
      this.renderBootstrapError();
    }
  }

  renderBootstrapError() {
    if (typeof document === 'undefined') {
      return;
    }
    const banner = document.getElementById(BOOTSTRAP_ERROR_ELEMENT_ID);
    if (banner) {
      banner.classList.remove(HIDDEN_CLASS);
    }
  }

  registerServiceWorker(swConfig) {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    const isSecure = location.protocol === swConfig.secureProtocol;
    const isDevHost = swConfig.insecureDevHostnames.includes(location.hostname);
    if (isSecure || isDevHost) {
      navigator.serviceWorker.register(swConfig.scriptPath).catch(() => {
        // Ignore service worker registration errors in local dev
      });
    }
  }
}

const app = new Application();
app.bootstrap();
