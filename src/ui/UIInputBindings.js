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
  resolveNextCampaignTarget
} from './UIHelpers.js';

/** Methods installed on UIManager.prototype by UIManager.js. */
export const uiInputBindingMethods = {
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

    this.elements.btnLevels.addEventListener('click', () => {
      this.openLevelsModal();
    });

    this.elements.btnEndless.addEventListener('click', () => {
      this.requestDestructiveAction(() => {
        this.hideAllModals();
        this.engine.startEndlessMode();
      }, () => t('app.nav.button.endless'));
    });

    if (this.elements.btnDaily) {
      this.elements.btnDaily.addEventListener('click', () => {
        this.requestDestructiveAction(() => {
          this.hideAllModals();
          this.engine.startDailyChallenge();
        }, () => t('app.nav.button.daily'));
      });
    }

    if (this.elements.btnFlux) {
      this.elements.btnFlux.addEventListener('click', () => {
        this.requestDestructiveAction(() => {
          this.hideAllModals();
          this.engine.startFluxRun();
        }, () => t('app.nav.button.flux'));
      });
    }

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
      if (document.hidden && this.engine.state === GAME_STATES.PLAYING) {
        this.engine.togglePause();
      }
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

    bindBackdropDismiss(this.elements.modalLevels, () => {
      this.closeOverlayModal(this.elements.modalLevels);
    });
    bindBackdropDismiss(this.elements.modalShop, () => {
      this.closeOverlayModal(this.elements.modalShop);
    });
    bindBackdropDismiss(this.elements.modalSettings, () => {
      this.closeOverlayModal(this.elements.modalSettings);
    });
    bindBackdropDismiss(this.elements.modalPause, () => {
      if (this.engine.state === GAME_STATES.PAUSED) {
        this.engine.togglePause();
      }
    });
    bindBackdropDismiss(this.elements.modalConfirm, () => {
      this.dismissConfirm();
    });

    this.elements.btnCloseLevels.addEventListener('click', () => {
      this.closeOverlayModal(this.elements.modalLevels);
    });

    this.elements.btnLevelsFilterIncomplete?.addEventListener('click', () => {
      this.levelsFilterIncomplete = !this.levelsFilterIncomplete;
      this.elements.levelsChapterHint?.classList.add('hidden');
      this.syncLevelsFilterButton();
      this.renderLevelCards(this.getSuggestedLevelId());
      this.announce(
        t(
          this.levelsFilterIncomplete
            ? 'modals.levelSelect.filter.announcedIncomplete'
            : 'modals.levelSelect.filter.announcedAll'
        )
      );
    });

    this.elements.btnFluxSeedGo?.addEventListener('click', () => {
      this.submitFluxSeedInput();
    });

    this.elements.modeBanner?.addEventListener('click', () => {
      this.openLevelsModal();
    });

    this.elements.modeBanner?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openLevelsModal();
      }
    });

    this.elements.btnModePuzzle?.addEventListener('click', () => {
      this.requestDestructiveAction(() => {
        this.hideAllModals();
        this.engine.startPuzzleMode(this.getSuggestedPuzzleStage());
      }, () => t('modals.levelSelect.arcade.puzzle'));
    });

    this.elements.btnModeBlitz?.addEventListener('click', () => {
      this.requestDestructiveAction(() => {
        this.hideAllModals();
        this.engine.startBlitzMode();
      }, () => t('modals.levelSelect.arcade.blitz'));
    });

    this.elements.btnModeBossRush?.addEventListener('click', () => {
      this.requestDestructiveAction(() => {
        this.hideAllModals();
        this.engine.startBossRushMode();
      }, () => t('modals.levelSelect.arcade.bossRush'));
    });

    this.elements.btnModeCascade?.addEventListener('click', () => {
      this.requestDestructiveAction(() => {
        this.hideAllModals();
        this.engine.startCascadeMode();
      }, () => t('modals.levelSelect.arcade.cascade'));
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
      if (this.isCampaignRunActive()) {
        if (!this.autoPausedByOverlay && this.engine.state === GAME_STATES.PAUSED) {
          this.engine.togglePause();
        }
        this.closeOverlayModal(this.elements.modalLevels);
        return;
      }
      this.requestDestructiveAction(
        () => {
          this.hideAllModals();
          this.engine.startCampaignLevel(this.getSuggestedLevelId());
        },
        () => t('modals.levelSelect.button.play', { level: this.getSuggestedLevelId() })
      );
    });

    this.elements.btnNextLevel.addEventListener('click', () => {
      this.hideAllModals();
      if (this.engine.mode === GAME_MODES.PUZZLE) {
        const totalPuzzles = this.gameConfig.puzzles?.length || 0;
        if (this.engine.currentPuzzleStage < totalPuzzles) {
          this.engine.startPuzzleMode(this.engine.currentPuzzleStage + 1);
        } else {
          this.openLevelsModal();
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
      this.hideAllModals();
      this.openLevelsModal();
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
      this.openLevelsModal();
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
      this.openLevelsModal();
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

    window.addEventListener('keydown', (e) => {
      this.handleKeyDown(e);
    });
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
      return;
    }

    if (e.code === 'Escape') {
      if (this.elements.modalConfirm && !this.elements.modalConfirm.classList.contains('hidden')) {
        this.dismissConfirm();
        return;
      }
      if (!this.elements.modalLevels.classList.contains('hidden')) {
        this.closeOverlayModal(this.elements.modalLevels);
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
      if (this.isDrawerOpen) {
        this.closeDrawer({ resume: true });
        return;
      }
      if (this.engine.state === GAME_STATES.PLAYING || this.engine.state === GAME_STATES.PAUSED) {
        this.engine.togglePause();
      }
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
        e.preventDefault();
        const type = SPECIAL_TYPES_ORDER[idx];
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
