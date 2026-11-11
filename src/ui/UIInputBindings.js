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

import { GAME_MODES, GAME_STATES, INPUT_MODES, SPECIAL_TYPES_ORDER } from '../core/Constants.js';
import { i18n, t } from '../core/I18n.js';
import { SHOP_TABS } from './WorkshopView.js';
import { fluxPerkIndexForKey } from './FluxPerkView.js';
import {
  inputModeForPointerType,
  shouldIgnoreRepeatedKey,
  isBrowserShortcut,
  resolveNextCampaignTarget,
  WEEKLY_ACCESS_KEY
} from './UIHelpers.js';
import { PLAY_HUB_DISCLOSURES } from './PlayHubView.js';
import { STATS_TABS } from './UIStats.js';

const HIDDEN_CLASS = 'hidden';
const LEVEL_TILE_SELECTOR = '[data-level-id]';
/** Chapter step of the PageUp and PageDown keys and of the previous and next buttons. */
const CHAPTER_STEP = 1;
const GRID_ARROW_STEPS = Object.freeze({
  ArrowLeft: Object.freeze({ dx: -1, dy: 0 }),
  ArrowRight: Object.freeze({ dx: 1, dy: 0 }),
  ArrowUp: Object.freeze({ dx: 0, dy: -1 }),
  ArrowDown: Object.freeze({ dx: 0, dy: 1 })
});

/**
 * Binds a Play hub card: activating the card of the running mode resumes it (A18), otherwise the
 * mode starts through its unlock gate and the destructive-action check.
 * @param {object} ui - UIManager.
 * @param {HTMLElement|null|undefined} element - Card button.
 * @param {object} spec
 * @param {string} spec.modeKey - Game mode id, or WEEKLY_ACCESS_KEY, matched against the running mode.
 * @param {string|null} spec.accessKey - Key judged by runIfModeUnlocked; null for an always open mode.
 * @param {string} spec.labelKey - Localization key of the mode name shown in the replace confirmation.
 * @param {() => void} spec.start - Starts the mode (called after the hub is gone).
 */
export function bindModeCard(ui, element, { modeKey, accessKey, labelKey, start }) {
  element?.addEventListener('click', () => {
    if (ui.resumePlayHubModeIfRunning(modeKey)) {
      return;
    }
    const launch = () => {
      ui.requestDestructiveAction(() => {
        ui.hideAllModals();
        start();
      }, () => t(labelKey));
    };
    if (accessKey) {
      ui.runIfModeUnlocked(accessKey, launch);
    } else {
      launch();
    }
  });
}

/** Click on the campaign map grid: a tile selects, the selected tile plays (one tap on the current level). */
export function handleLevelGridClick(ui, event) {
  const tile = event.target?.closest?.(LEVEL_TILE_SELECTOR);
  if (!tile) {
    return;
  }
  const levelId = Number(tile.dataset.levelId);
  if (levelId === ui.levelsSelectedId) {
    ui.playSelectedLevel();
  } else {
    ui.selectLevelTile(levelId, { focus: true });
  }
}

/**
 * Keys on the campaign map grid (A22): arrows move the selection and the focus with it, Home and
 * End jump to the ends, PageUp and PageDown change chapter (focus lands on the new selected tile,
 * A12), Enter plays the selected tile.
 */
export function handleLevelGridKeydown(ui, event) {
  const tile = event.target?.closest?.(LEVEL_TILE_SELECTOR);
  if (!tile) {
    return;
  }
  const arrow = GRID_ARROW_STEPS[event.key];
  if (arrow) {
    event.preventDefault();
    ui.moveLevelTileFocus(arrow.dx, arrow.dy, { wrapRows: true })?.focus();
    return;
  }
  switch (event.key) {
    case 'Home':
    case 'End': {
      event.preventDefault();
      const tiles = Array.from(ui.elements.levelsGrid.children).filter((child) => child.dataset?.levelId !== undefined);
      const edge = event.key === 'Home' ? tiles[0] : tiles.at(-1);
      if (edge) {
        ui.selectLevelTile(Number(edge.dataset.levelId), { focus: true });
      }
      break;
    }
    case 'PageUp':
    case 'PageDown':
      event.preventDefault();
      ui.stepLevelChapter(event.key === 'PageUp' ? -CHAPTER_STEP : CHAPTER_STEP, { focus: true });
      break;
    case 'Enter':
    case 'NumpadEnter':
      // Enter plays; swallowing it keeps the button from also firing a click.
      event.preventDefault();
      if (Number(tile.dataset.levelId) !== ui.levelsSelectedId) {
        ui.selectLevelTile(Number(tile.dataset.levelId));
      }
      ui.playSelectedLevel();
      break;
    default:
      break;
  }
}

/** Play hub: open and close, Campaign card, disclosures and the two-player entry. */
function bindPlayHubEvents(ui) {
  const els = ui.elements;
  els.btnPlay?.addEventListener('click', () => {
    ui.openPlayHub();
  });
  els.btnClosePlay?.addEventListener('click', () => {
    ui.closeOverlayModal(els.modalPlay);
  });
  els.btnCampaignContinue?.addEventListener('click', () => {
    ui.activatePlayHubContinue();
  });
  els.btnCampaignMap?.addEventListener('click', () => {
    ui.openLevelsModal();
  });
  for (const [name, { toggle }] of Object.entries(PLAY_HUB_DISCLOSURES)) {
    els[toggle]?.addEventListener('click', () => {
      ui.togglePlayHubDisclosure(name);
    });
  }
  els.btnVersusLocalHub?.addEventListener('click', () => {
    ui.openPlayHubVersusLocal();
  });
}

/** Campaign map: chapter switcher, jump, filter, the tile grid (one delegated listener) and the detail Play. */
function bindCampaignMapEvents(ui) {
  const els = ui.elements;
  els.btnChapterPrev?.addEventListener('click', () => {
    ui.stepLevelChapter(-CHAPTER_STEP);
  });
  els.btnChapterNext?.addEventListener('click', () => {
    ui.stepLevelChapter(CHAPTER_STEP);
  });
  // A locked chapter is refused by selectLevelChapter, which restores the select and says why (A11).
  els.levelsChapterSelect?.addEventListener('change', () => {
    ui.selectLevelChapter(Number(els.levelsChapterSelect.value));
  });
  els.btnLevelsJumpCurrent?.addEventListener('click', () => {
    ui.jumpToCurrentLevel();
  });
  els.btnLevelsFilterIncomplete?.addEventListener('click', () => {
    ui.levelsFilterIncomplete = !ui.levelsFilterIncomplete;
    els.levelsChapterHint?.classList.add(HIDDEN_CLASS);
    ui.syncLevelsFilterButton();
    ui.renderLevelTiles(ui.getSuggestedLevelId());
    ui.renderLevelDetail(ui.levelsSelectedId);
    ui.announce(
      t(
        ui.levelsFilterIncomplete
          ? 'modals.levelSelect.filter.announcedIncomplete'
          : 'modals.levelSelect.filter.announcedAll'
      )
    );
  });
  els.levelsGrid?.addEventListener('click', (event) => handleLevelGridClick(ui, event));
  els.levelsGrid?.addEventListener('keydown', (event) => handleLevelGridKeydown(ui, event));
  els.btnCloseLevels.addEventListener('click', () => {
    ui.closeOverlayModal(els.modalLevels);
  });
}

/** Scenes that can own the gameplay controls. */
export const UI_SCENES = Object.freeze({ MAIN: 'main', VERSUS: 'versus' });

/** Methods installed on UIManager.prototype by UIManager.js. */
export const uiInputBindingMethods = {
  /**
   * Chooses who handles the gameplay controls. In the 'versus' scene the gameplay keys, the
   * controller actions and the auto-pause on a hidden page go to `controller`
   * ({handleGameplayKey(event), handleGamepadActions(actions, aimDelta), pause()}); the
   * 'main' scene (default) keeps the single-player behaviour. A controller of the two-player
   * match adds multiPad: true (every pad is read on its own and reaches handlePadResults(results)),
   * handleGameplayKeyUp(event), releaseAllKeys() and beforeFrame(now, elapsedMs).
   */
  setActiveScene(scene, controller = null) {
    const isVersus = scene === UI_SCENES.VERSUS && Boolean(controller);
    this.activeScene = isVersus ? UI_SCENES.VERSUS : UI_SCENES.MAIN;
    this.sceneController = isVersus ? controller : null;
  },

  /** Pauses the run (or the versus match) when the page is hidden. */
  handleVisibilityChange() {
    if (!document.hidden) {
      return;
    }
    const sceneController = this.getSceneController();
    if (sceneController) {
      sceneController.pause();
    } else if (this.engine.state === GAME_STATES.PLAYING) {
      this.engine.togglePause();
    }
  },

  /** The controller of the active non-main scene, or null in the main scene. */
  getSceneController() {
    return this.activeScene === UI_SCENES.VERSUS ? this.sceneController || null : null;
  },

  /** A key was released: the scene that tracks held keys (two-player aim) learns of it, whatever dialog is open. */
  handleKeyUp(e) {
    this.getSceneController()?.handleGameplayKeyUp?.(e);
  },

  /** The window lost focus: the keyup of every held key may never arrive, so none stays held. */
  handleWindowBlur() {
    this.getSceneController()?.releaseAllKeys?.();
  },

  /**
   * An auto-repeated key is not a new press, but in a two-player match the keys of the layout are
   * still kept from the page (Enter, the slash quick find, the arrows scroll).
   */
  swallowRepeatedLocalKey(e) {
    const sceneController = this.getSceneController();
    if (sceneController?.multiPad === true && !this.isAnyModalOpen() && !this.isDrawerOpen && !isBrowserShortcut(e)) {
      sceneController.handleGameplayKey(e);
    }
  },

  /**
   * Keeps the browser's install prompt for the Settings button instead of letting the
   * browser show it at a moment the player did not choose.
   */
  bindInstallEvents() {
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPromptEvent = e;
      this.syncInstallControls();
    });
    window.addEventListener('appinstalled', () => {
      this.installPromptEvent = null;
      this.syncInstallControls();
      this.announce(t('modals.settings.install.installedAnnounce'));
    });
    this.elements.btnInstall?.addEventListener('click', () => {
      this.promptInstall();
    });
  },

  bindDrawerEvents() {
    if (this.elements.btnMenu) {
      this.elements.btnMenu.addEventListener('click', () => {
        this.openDrawer();
      });
    }
    if (this.elements.btnCloseDrawer) {
      this.elements.btnCloseDrawer.addEventListener('click', () => {
        this.closeDrawer({ resume: true });
      });
    }
    if (this.elements.drawerBackdrop) {
      this.elements.drawerBackdrop.addEventListener('click', () => {
        this.closeDrawer({ resume: true });
      });
    }
    // Bound before the buttons' own handlers so the menu is gone, and focus is back
    // on the menu button, before they open a dialog or change the run.
    if (this.elements.drawer) {
      for (const button of this.elements.drawer.querySelectorAll('[data-closes-drawer]')) {
        button.addEventListener('click', () => {
          this.closeDrawer({ resume: false });
        });
      }
    }
  },

  bindEvents() {
    this.bindDrawerEvents();

    bindPlayHubEvents(this);
    bindCampaignMapEvents(this);

    bindModeCard(this, this.elements.btnEndless, {
      modeKey: GAME_MODES.ENDLESS,
      accessKey: GAME_MODES.ENDLESS,
      labelKey: 'app.nav.button.endless',
      start: () => this.engine.startEndlessMode()
    });
    bindModeCard(this, this.elements.btnDaily, {
      modeKey: GAME_MODES.DAILY,
      accessKey: null,
      labelKey: 'app.nav.button.daily',
      start: () => this.engine.startDailyChallenge()
    });
    bindModeCard(this, this.elements.btnFlux, {
      modeKey: GAME_MODES.FLUX,
      accessKey: GAME_MODES.FLUX,
      labelKey: 'app.nav.button.flux',
      start: () => this.engine.startFluxRun()
    });
    bindModeCard(this, this.elements.btnWeekly, {
      modeKey: WEEKLY_ACCESS_KEY,
      accessKey: WEEKLY_ACCESS_KEY,
      labelKey: 'app.nav.button.weekly',
      start: () => this.startWeeklyFluxRun()
    });

    this.elements.btnStats?.addEventListener('click', () => {
      this.openStatsModal(STATS_TABS.OVERVIEW);
    });
    this.elements.btnDailyHistoryGameOver?.addEventListener('click', () => {
      this.openStatsModal(STATS_TABS.DAILY);
    });
    this.bindStatsEvents();

    this.elements.btnShop.addEventListener('click', () => {
      this.openShopModal();
    });

    if (this.elements.btnSettings) {
      this.elements.btnSettings.addEventListener('click', () => {
        this.syncInstallControls();
        this.openOverlayModal(this.elements.modalSettings, this.elements.btnCloseSettings);
      });
    }
    if (this.elements.btnCloseSettings) {
      this.elements.btnCloseSettings.addEventListener('click', () => {
        this.closeOverlayModal(this.elements.modalSettings);
      });
    }

    this.elements.btnRestart.addEventListener('click', () => {
      this.requestDestructiveAction(
        () => {
          this.hideAllModals();
          this.engine.restartCurrent();
        },
        () => t('app.nav.button.restart')
      );
    });

    this.elements.btnPause.addEventListener('click', () => {
      // From the menu, the run is held by the menu pause: turn it into a regular
      // pause so the Pause dialog opens.
      if (this.autoPausedByOverlay && this.engine.state === GAME_STATES.PAUSED) {
        this.autoPausedByOverlay = false;
        this.engine.state = GAME_STATES.PLAYING;
      }
      this.engine.togglePause();
    });

    const toggleSound = () => {
      const nextMuted = !this.audioManager.isMuted();
      this.audioManager.setMuted(nextMuted);
      this.storageManager.setMuted(nextMuted);
      this.updateSoundButton();
    };
    this.elements.btnSound.addEventListener('click', toggleSound);

    const toggleContrast = () => {
      const nextContrast = !this.storageManager.getHighContrast();
      this.storageManager.setHighContrast(nextContrast);
      if (this.renderer) {
        this.renderer.setHighContrast(nextContrast);
      }
      this.updateContrastButton();
    };
    if (this.elements.btnContrast) {
      this.elements.btnContrast.addEventListener('click', toggleContrast);
    }

    const togglePatterns = () => {
      const nextPatterns = !this.storageManager.getColorPatterns();
      this.storageManager.setColorPatterns(nextPatterns);
      if (this.renderer) {
        this.renderer.setColorPatterns(nextPatterns);
      }
      this.updatePatternsButton();
    };
    if (this.elements.btnPatterns) {
      this.elements.btnPatterns.addEventListener('click', togglePatterns);
    }

    const toggleMotion = () => {
      const nextReduced = !this.storageManager.getReducedMotion();
      this.storageManager.setReducedMotion(nextReduced);
      if (this.engine && typeof this.engine.setReducedMotion === 'function') {
        this.engine.setReducedMotion(nextReduced);
      }
      if (this.audioManager && typeof this.audioManager.setReducedMotion === 'function') {
        this.audioManager.setReducedMotion(nextReduced);
      }
      this.updateMotionButton();
    };
    if (this.elements.btnMotion) {
      this.elements.btnMotion.addEventListener('click', toggleMotion);
    }

    if (this.elements.btnAnimSpeed) {
      this.elements.btnAnimSpeed.addEventListener('click', () => {
        this.cycleAnimationSpeed();
      });
    }

    document.addEventListener('visibilitychange', () => {
      this.handleVisibilityChange();
    });

    const toggleLang = () => {
      const supported = this.gameConfig.defaults.supportedLanguages;
      const current = i18n.getLocale();
      const nextIdx = (supported.indexOf(current) + 1) % supported.length;
      const nextLang = supported[nextIdx];
      i18n.setLocale(nextLang);
      this.storageManager.setLanguage(nextLang);
    };
    this.elements.btnLang.addEventListener('click', toggleLang);

    this.elements.swapBtn.addEventListener('click', () => {
      this.engine.swapLauncherBalls();
    });

    if (this.elements.polarityBtn) {
      this.elements.polarityBtn.addEventListener('click', () => {
        this.engine.togglePolarityFlip();
      });
    }

    this.elements.hintReplayBtn?.addEventListener('click', () => {
      this.engine.replayLevelHints?.();
    });

    this.elements.btnDismissLevelIntro?.addEventListener('click', () => {
      this.engine.dismissLevelIntro?.();
    });

    if (this.elements.btnResetHints) {
      this.elements.btnResetHints.addEventListener('click', () => {
        this.engine.resetDiscoveries();
        this.hintsResetConfirmed = true;
        this.updateResetHintsFeedback();
        this.announce(t('hud.announcer.hints.reset'));
      });
    }

    if (this.elements.btnDismissTutorial) {
      this.elements.btnDismissTutorial.addEventListener('click', () => {
        this.engine.dismissDiscovery();
      });
    }

    const shopTabs = this.getShopTabs();
    if (shopTabs.length > 0) {
      for (let i = 0; i < shopTabs.length; i++) {
        const { name, el } = shopTabs[i];
        el.addEventListener('click', () => {
          this.switchShopTab(name);
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const dir = e.key === 'ArrowRight' ? 1 : -1;
            const nextIdx = (i + dir + shopTabs.length) % shopTabs.length;
            this.switchShopTab(shopTabs[nextIdx].name);
            shopTabs[nextIdx].el.focus();
          }
        });
      }
    }

    if (this.elements.btnConfirmYes && this.elements.btnConfirmNo) {
      this.elements.btnConfirmYes.addEventListener('click', () => {
        const cb = this.pendingConfirmCallback;
        this.pendingConfirmCallback = null;
        this.pendingConfirmLabelResolver = null;
        this.confirmPausedRun = false;
        this.elements.modalConfirm.classList.add('hidden');
        if (cb) {
          cb();
        }
      });
      this.elements.btnConfirmNo.addEventListener('click', () => {
        this.dismissConfirm();
      });
    }

    const bindBackdropDismiss = (modalEl, onDismiss) => {
      if (!modalEl) {
        return;
      }
      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) {
          onDismiss();
        }
      });
    };

    bindBackdropDismiss(this.elements.modalPlay, () => {
      this.closeOverlayModal(this.elements.modalPlay);
    });
    bindBackdropDismiss(this.elements.modalLevels, () => {
      this.closeOverlayModal(this.elements.modalLevels);
    });
    bindBackdropDismiss(this.elements.modalShop, () => {
      this.closeOverlayModal(this.elements.modalShop);
    });
    bindBackdropDismiss(this.elements.modalSettings, () => {
      this.closeOverlayModal(this.elements.modalSettings);
    });
    bindBackdropDismiss(this.elements.modalStats, () => {
      this.closeOverlayModal(this.elements.modalStats);
    });
    bindBackdropDismiss(this.elements.modalPause, () => {
      if (this.engine.state === GAME_STATES.PAUSED) {
        this.engine.togglePause();
      }
    });
    bindBackdropDismiss(this.elements.modalConfirm, () => {
      this.dismissConfirm();
    });

    this.elements.btnFluxSeedGo?.addEventListener('click', () => {
      this.submitFluxSeedInput();
    });

    this.elements.modeBanner?.addEventListener('click', () => {
      this.openPlayHub();
    });

    this.elements.modeBanner?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openPlayHub();
      }
    });

    bindModeCard(this, this.elements.btnModePuzzle, {
      modeKey: GAME_MODES.PUZZLE,
      accessKey: GAME_MODES.PUZZLE,
      labelKey: 'modals.levelSelect.arcade.puzzle',
      start: () => this.engine.startPuzzleMode(this.getSuggestedPuzzleStage())
    });
    bindModeCard(this, this.elements.btnModeClassic, {
      modeKey: GAME_MODES.CLASSIC,
      accessKey: GAME_MODES.CLASSIC,
      labelKey: 'modals.levelSelect.arcade.classic',
      start: () => this.engine.startClassicMode()
    });
    bindModeCard(this, this.elements.btnModeBlitz, {
      modeKey: GAME_MODES.BLITZ,
      accessKey: GAME_MODES.BLITZ,
      labelKey: 'modals.levelSelect.arcade.blitz',
      start: () => this.engine.startBlitzMode()
    });
    bindModeCard(this, this.elements.btnModeBossRush, {
      modeKey: GAME_MODES.BOSS_RUSH,
      accessKey: GAME_MODES.BOSS_RUSH,
      labelKey: 'modals.levelSelect.arcade.bossRush',
      start: () => this.engine.startBossRushMode()
    });
    bindModeCard(this, this.elements.btnModeCascade, {
      modeKey: GAME_MODES.CASCADE,
      accessKey: GAME_MODES.CASCADE,
      labelKey: 'modals.levelSelect.arcade.cascade',
      start: () => this.engine.startCascadeMode()
    });
    bindModeCard(this, this.elements.btnModeHexGrid, {
      modeKey: GAME_MODES.HEX_GRID,
      accessKey: GAME_MODES.HEX_GRID,
      labelKey: 'modals.levelSelect.arcade.hexGrid',
      start: () => this.engine.startHexGridMode()
    });
    bindModeCard(this, this.elements.btnModePinball, {
      modeKey: GAME_MODES.PINBALL,
      accessKey: GAME_MODES.PINBALL,
      labelKey: 'modals.levelSelect.arcade.pinball',
      start: () => this.engine.startPinballMode()
    });
    bindModeCard(this, this.elements.btnModeOrbital, {
      modeKey: GAME_MODES.ORBITAL,
      accessKey: GAME_MODES.ORBITAL,
      labelKey: 'modals.levelSelect.arcade.orbital',
      start: () => this.engine.startOrbitalMode()
    });
    bindModeCard(this, this.elements.btnModeConvoy, {
      modeKey: GAME_MODES.CONVOY,
      accessKey: GAME_MODES.CONVOY,
      labelKey: 'modals.levelSelect.arcade.convoy',
      start: () => this.engine.startConvoyMode()
    });
    bindModeCard(this, this.elements.btnModeMerge, {
      modeKey: GAME_MODES.MERGE,
      accessKey: GAME_MODES.MERGE,
      labelKey: 'modals.levelSelect.arcade.merge',
      start: () => this.engine.startMergeMode()
    });

    this.elements.inputFluxSeed?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.submitFluxSeedInput();
      }
    });

    this.elements.btnCloseShop.addEventListener('click', () => {
      this.closeOverlayModal(this.elements.modalShop);
    });

    this.elements.btnPlayLevelModal.addEventListener('click', () => {
      this.playSelectedLevel();
    });

    this.elements.btnNextLevel.addEventListener('click', () => {
      this.hideAllModals();
      if (this.engine.mode === GAME_MODES.PUZZLE) {
        const totalPuzzles = this.gameConfig.puzzles?.length || 0;
        if (this.engine.currentPuzzleStage < totalPuzzles) {
          this.engine.startPuzzleMode(this.engine.currentPuzzleStage + 1);
        } else {
          this.openPlayHub({ expand: 'puzzle' });
        }
        return;
      }
      const { targetLevelId } = resolveNextCampaignTarget(
        this.engine.currentLevelId,
        this.engine.levelCatalog,
        this.getVictoryTargetOptions()
      );
      if (targetLevelId !== null) {
        this.engine.startCampaignLevel(targetLevelId);
      } else {
        // The last level is behind: the level select opens on its chapter.
        this.openLevelsModal();
      }
    });

    this.elements.btnReplayVictory.addEventListener('click', () => {
      this.hideAllModals();
      this.engine.restartCurrent();
    });

    this.elements.btnLevelsVictory.addEventListener('click', () => {
      const mode = this.engine.mode;
      this.hideAllModals();
      if (mode === GAME_MODES.CAMPAIGN) {
        this.openLevelsModal();
      } else {
        this.openPlayHub({ expand: mode === GAME_MODES.PUZZLE ? 'puzzle' : undefined });
      }
    });

    this.elements.btnContinueGameOver?.addEventListener('click', () => {
      if (this.engine.continueOutOfShots()) {
        this.hideAllModals();
        this.refresh(this.engine, this.lastExtra);
      }
    });

    this.elements.btnRetry.addEventListener('click', () => {
      this.hideAllModals();
      this.engine.restartCurrent();
    });

    this.elements.btnSameSeedGameOver?.addEventListener('click', () => this.retrySameFluxSeed());

    this.elements.btnLevelsGameOver.addEventListener('click', () => {
      this.hideAllModals();
      this.openPlayHub();
    });

    this.elements.btnShareGameOver?.addEventListener('click', () => {
      this.shareRunResult();
    });

    this.elements.btnResume.addEventListener('click', () => {
      this.engine.togglePause();
    });

    this.elements.fluxPerkCards?.addEventListener('click', (e) => {
      const card = e.target.closest?.('[data-perk-id]');
      if (card) {
        this.engine.chooseFluxPerk(card.dataset.perkId);
      }
    });

    this.elements.btnRestartPause.addEventListener('click', () => {
      this.requestDestructiveAction(
        () => {
          this.hideAllModals();
          this.engine.restartCurrent();
        },
        () => t('app.nav.button.restart')
      );
    });

    this.elements.btnLevelsPause?.addEventListener('click', () => {
      this.openPlayHub();
      this.elements.modalPause.classList.add('hidden');
      this.syncModalInertState();
    });

    this.elements.btnSettingsPause?.addEventListener('click', () => {
      this.syncInstallControls();
      this.openOverlayModal(this.elements.modalSettings, this.elements.btnCloseSettings);
      this.elements.modalPause.classList.add('hidden');
      this.syncModalInertState();
    });

    // Capture phase: the mode must switch even when a handler below stops the event.
    window.addEventListener(
      'pointerdown',
      (e) => {
        this.setInputMode(inputModeForPointerType(e.pointerType));
      },
      { capture: true }
    );

    // A window that shrinks or turns while the hub is open may no longer fit two boards.
    for (const type of ['resize', 'orientationchange']) {
      window.addEventListener(type, () => {
        if (this.isPlayHubOpen()) {
          this.syncPlayHubVersusLocal();
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      this.handleKeyDown(e);
    });
    window.addEventListener('keyup', (e) => {
      this.handleKeyUp(e);
    });
    window.addEventListener('blur', () => {
      this.handleWindowBlur();
    });
  },

  /**
   * Unwinds the topmost layer: Confirm, duel card, a dialog (campaign map, then Play hub), the menu, then the run's pause.
   * Shared by Escape and the controller's back button.
   */
  handleBackAction() {
    if (this.elements.modalConfirm && !this.elements.modalConfirm.classList.contains('hidden')) {
      this.dismissConfirm();
      return;
    }
    if (this.isDuelCardOpen()) {
      this.dismissDuelCard();
      return;
    }
    // The Polarity Duel layers (difficulty picker, match pause and result) unwind before anything under them.
    if (this.handleVersusBack()) {
      return;
    }
    if (this.isCalibrationOpen()) {
      this.closeCalibration();
      return;
    }
    if (!this.elements.modalLevels.classList.contains(HIDDEN_CLASS)) {
      this.closeOverlayModal(this.elements.modalLevels);
      return;
    }
    if (this.elements.modalPlay && !this.elements.modalPlay.classList.contains(HIDDEN_CLASS)) {
      this.closeOverlayModal(this.elements.modalPlay);
      return;
    }
    if (!this.elements.modalShop.classList.contains('hidden')) {
      this.closeOverlayModal(this.elements.modalShop);
      return;
    }
    if (this.elements.modalSettings && !this.elements.modalSettings.classList.contains('hidden')) {
      this.closeOverlayModal(this.elements.modalSettings);
      return;
    }
    if (this.elements.modalStats && !this.elements.modalStats.classList.contains('hidden')) {
      this.closeOverlayModal(this.elements.modalStats);
      return;
    }
    if (this.isDrawerOpen) {
      this.closeDrawer({ resume: true });
      return;
    }
    if (this.engine.state === GAME_STATES.PLAYING || this.engine.state === GAME_STATES.PAUSED) {
      this.engine.togglePause();
    }
  },

  /** Global keyboard shortcuts: Escape unwinds the topmost layer, the rest steer the run. */
  handleKeyDown(e) {
    this.setInputMode(INPUT_MODES.POINTER);
    if (e.code === 'Tab' && this.isAnyModalOpen()) {
      this.trapModalFocus(e);
      return;
    }
    if (e.code === 'Tab' && this.isDrawerOpen) {
      this.trapFocusWithin(this.elements.drawer, e);
      return;
    }

    if (shouldIgnoreRepeatedKey(e.code, e.repeat)) {
      this.swallowRepeatedLocalKey(e);
      return;
    }

    if (e.code === 'Escape') {
      this.handleBackAction();
      return;
    }

    // The perk choice is the top dialog: its digits pick a card and never equip a special ball.
    if (this.isFluxPerkModalTop()) {
      const cardIndex = fluxPerkIndexForKey(e.code, this.engine.fluxPerkOffer?.length || 0);
      if (cardIndex >= 0 && !isBrowserShortcut(e)) {
        e.preventDefault();
        this.engine.chooseFluxPerk(this.engine.fluxPerkOffer[cardIndex]);
      }
      return;
    }

    if (this.isAnyModalOpen()) {
      return;
    }
    if (this.isDrawerOpen) {
      return;
    }

    if (isBrowserShortcut(e)) {
      return;
    }

    const sceneController = this.getSceneController();
    if (sceneController) {
      sceneController.handleGameplayKey(e);
      return;
    }

    const activeEl = document.activeElement;
    const isKeyboardInteractiveFocused = Boolean(
      activeEl &&
        activeEl !== document.body &&
        activeEl !== document.documentElement &&
        activeEl.id !== 'game-canvas' &&
        typeof activeEl.matches === 'function' &&
        activeEl.matches(':focus-visible') &&
        typeof activeEl.closest === 'function' &&
        activeEl.closest('button, a, input, select, textarea, [role="button"], [role="tab"]')
    );

    if (e.code === 'Space') {
      if (isKeyboardInteractiveFocused) {
        return;
      }
      e.preventDefault();
      this.engine.swapLauncherBalls();
    } else if (e.code === 'KeyF') {
      e.preventDefault();
      this.engine.togglePolarityFlip();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const step = e.shiftKey
        ? this.gameConfig.canvas.keyboardAimStepRad
        : this.gameConfig.canvas.keyboardAimFineStepRad;
      const dir = e.code === 'ArrowLeft' ? -1 : 1;
      this.engine.adjustAimByDelta(dir * step);
      this.updateAimState(this.engine);
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (isKeyboardInteractiveFocused) {
        return;
      }
      e.preventDefault();
      this.engine.shoot();
      this.updateAimState(this.engine);
    } else if (e.code.startsWith('Digit')) {
      const idx = Number.parseInt(e.code.replace('Digit', ''), 10) - 1;
      if (idx >= 0 && idx < SPECIAL_TYPES_ORDER.length) {
        const type = SPECIAL_TYPES_ORDER[idx];
        if (this.engine.isSpecialTypeAllowed?.(type) === false) {
          return;
        }
        e.preventDefault();
        const count = this.engine.specialInventory?.[type] || 0;
        const isEquipped = this.engine.currentBall?.specialType === type;
        if (count <= 0 && !isEquipped && this.engine.offersSpecialBalls?.() && this.canBuySpecialAmmo()) {
          this.openShopModal(SHOP_TABS.AMMO);
        } else {
          this.engine.equipSpecialBall(type);
        }
      }
    }
  },
};
