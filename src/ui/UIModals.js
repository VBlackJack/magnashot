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

import { GAME_MODES, GAME_STATES } from '../core/Constants.js';
import { t } from '../core/I18n.js';
import { parseFluxSeedInput } from '../game/DailyShare.js';
import { getUtcIsoWeekKey, getWeeklyFluxSeed } from '../game/WeeklyFlux.js';
import { buildCodexPane } from './CodexView.js';
import { SHOP_TABS, rerenderWorkshopKeepingFocus, renderWorkshopContents } from './WorkshopView.js';
import {
  MODAL_FOCUSABLE_SELECTOR,
  DEFAULT_MAX_STARS,
  filterFocusTrapCandidates,
  VICTORY_NEXT_ACTIONS,
  VICTORY_NEXT_LABEL_KEYS,
  resolveNextCampaignTarget,
  resolveModalFocusTarget,
  revealLiveRegion,
  scheduleNextFrame,
  setTextIfChanged,
  setAttributeIfChanged,
  isModeUnlocked,
  describeModeLock
} from './UIHelpers.js';

/** Methods installed on UIManager.prototype by UIManager.js. */
export const uiModalMethods = {
  /** True when the Flux perk choice is open and is the dialog on top. */
  isFluxPerkModalTop() {
    const modal = this.elements.modalFluxPerk;
    return Boolean(modal) && !modal.classList.contains('hidden') && this.getActiveTopModal() === modal;
  },

  requestDestructiveAction(actionCallback, confirmLabelResolver = null, { always = false } = {}) {
    // `always` guards a run that holds progress before the first shot (a restored Flux run between shapes).
    // Past the first Flux shape the run holds cleared shapes and perks, whether or not a shot was fired.
    const holdsFluxProgress = this.engine.mode === GAME_MODES.FLUX && this.engine.fluxStage > 1;
    const runHasBalls = this.isRunActive() && this.engine.physicsWorld.balls.length > 0;
    const isMidRound = runHasBalls && (always || holdsFluxProgress || this.engine.hasFiredInRound);

    if (!isMidRound || !this.elements.modalConfirm) {
      actionCallback();
      return;
    }

    this.pendingConfirmCallback = actionCallback;
    this.pendingConfirmLabelResolver = confirmLabelResolver;
    this.updateConfirmButtonLabel();
    // Over another dialog, its opener is where focus returns when the Confirm closes.
    this.stackedModalOpener = this.isAnyModalOpen() ? document.activeElement : null;
    this.saveLastFocusedElement();
    // The run holds still while the player decides, as under the menu dialogs.
    if (this.engine.state === GAME_STATES.PLAYING) {
      this.confirmPausedRun = true;
      this.engine.state = GAME_STATES.PAUSED;
    }
    this.elements.modalConfirm.classList.remove('hidden');
    this.syncModalInertState();
    if (this.elements.btnConfirmNo) {
      this.elements.btnConfirmNo.focus();
    }
  },

  updateConfirmButtonLabel() {
    if (!this.elements?.btnConfirmYes) {
      return;
    }
    const customLabel =
      typeof this.pendingConfirmLabelResolver === 'function' ? this.pendingConfirmLabelResolver() : null;
    setTextIfChanged(this.elements.btnConfirmYes, customLabel || t('modals.confirm.button.confirm'));
  },

  /**
   * Closes the Confirm without its action (No, backdrop or Escape) and resumes the run it
   * paused. Yes does not come here: its action starts another run.
   */
  dismissConfirm() {
    this.pendingConfirmCallback = null;
    this.pendingConfirmLabelResolver = null;
    this.updateConfirmButtonLabel();
    if (this.confirmPausedRun) {
      this.confirmPausedRun = false;
      if (this.engine.state === GAME_STATES.PAUSED && !this.isDrawerOpen) {
        this.engine.state = GAME_STATES.PLAYING;
      }
    }
    this.closeOverlayModal(this.elements.modalConfirm);
  },

  /** True when the run is paused by the menu, a menu dialog or the Confirm, not by the player. */
  isRunHeldByUi() {
    return this.autoPausedByOverlay || this.confirmPausedRun;
  },

  /**
   * Focuses a control only when its dialog is the one on top: a Confirm still open over a
   * window that just appeared keeps the focus, and the window gets it when the Confirm closes.
   */
  focusInTopModal(element) {
    const topModal = this.getActiveTopModal();
    if (element && topModal && topModal.contains(element)) {
      element.focus();
    }
  },

  getVictoryTargetOptions() {
    return {
      filterIncomplete: Boolean(this.levelsFilterIncomplete),
      unlockedLevel: this.storageManager?.getUnlockedLevel?.() || this.engine.currentLevelId,
      levelStats: this.storageManager?.getLevelStats?.() || {},
      maxStars: this.gameConfig?.scoring?.maxStars || DEFAULT_MAX_STARS
    };
  },

  /** The victory window's main button names what it does: the next level, the next < 3★ level, or the level select. */
  updateNextLevelButton(engine) {
    const button = this.elements.btnNextLevel;
    if (!button) {
      return;
    }
    if (engine.mode === GAME_MODES.PUZZLE) {
      const totalPuzzles = this.gameConfig.puzzles?.length || 0;
      const action = engine.currentPuzzleStage < totalPuzzles
        ? VICTORY_NEXT_ACTIONS.NEXT_LEVEL
        : VICTORY_NEXT_ACTIONS.LEVEL_SELECT;
      const labelKey = VICTORY_NEXT_LABEL_KEYS[action];
      setAttributeIfChanged(button, 'data-i18n', labelKey);
      setTextIfChanged(button, t(labelKey));
      return;
    }
    const { action } = resolveNextCampaignTarget(
      engine.currentLevelId,
      engine.levelCatalog,
      this.getVictoryTargetOptions()
    );
    const labelKey = VICTORY_NEXT_LABEL_KEYS[action];
    // data-i18n follows, so a language switch keeps the right wording.
    setAttributeIfChanged(button, 'data-i18n', labelKey);
    setTextIfChanged(button, t(labelKey));
  },

  /** Access of every mode (unlocked, new, required level); empty when storage cannot say. */
  getModeAccess() {
    return this.storageManager?.getModeAccess?.() ?? {};
  },

  /**
   * Runs a mode start only when the campaign unlocked that mode. A locked mode starts nothing
   * and says what to do in a polite status line.
   * @param {string} mode - Mode id.
   * @param {() => void} start - Starts the mode.
   * @returns {boolean} True when the start ran.
   */
  runIfModeUnlocked(mode, start) {
    const access = this.getModeAccess();
    if (isModeUnlocked(access, mode)) {
      start();
      return true;
    }
    this.showModeLockHint(mode, access);
    return false;
  },

  /** Tells the player which campaign level unlocks a locked mode (in the open window's status line). */
  showModeLockHint(mode, access = this.getModeAccess()) {
    const lock = describeModeLock(mode, access, t);
    const isLevelsOpen = Boolean(this.elements.modalLevels) && !this.elements.modalLevels.classList.contains('hidden');
    const hintEl = isLevelsOpen ? this.elements.levelsChapterHint : this.elements.navModeLockHint;
    if (!hintEl || !lock.hint) {
      return;
    }
    revealLiveRegion({ region: hintEl, textElement: hintEl, text: lock.hint, schedule: scheduleNextFrame });
  },

  /**
   * Starts this week's Flux run. The engine pays the one-time bonus; an engine without the
   * dedicated entry point gets the same seed through the shared-run path.
   */
  startWeeklyFluxRun() {
    if (typeof this.engine.startWeeklyFlux === 'function') {
      this.engine.startWeeklyFlux({ isRestart: false });
      return;
    }
    const weekKey = getUtcIsoWeekKey(Date.now());
    const seed = getWeeklyFluxSeed(weekKey, this.engine.fluxConfig?.seed, this.gameConfig.weeklyFlux?.seedSalt);
    this.engine.startFluxRun(seed, { isShared: true });
  },

  /** Restarts the Flux run that just ended on its own seed, keeping its shared (tilt-locked) status. */
  retrySameFluxSeed() {
    if (this.engine.fluxSeed) {
      // The restart clears the duel with the run state: read the rival first, attach it again after.
      const ghost = this.engine.ghostDuel?.ghost ?? null;
      this.hideAllModals();
      this.engine.startFluxRun(this.engine.fluxSeed, { isShared: this.engine.isSharedFluxRun });
      if (ghost && this.engine.attachGhost(ghost)) {
        this.refresh(this.engine, this.lastExtra);
      }
    }
  },

  /**
   * Parses the Flux seed field in the Level Select toolbar and launches the seeded Flux run,
   * or reveals an invalid-seed message in the polite hint banner.
   */
  submitFluxSeedInput() {
    const input = this.elements?.inputFluxSeed;
    if (!input) {
      return;
    }
    const seedConfig = this.engine.fluxConfig?.seed;
    const seed = parseFluxSeedInput(input.value, seedConfig);
    if (!seed) {
      const hintEl = this.elements?.levelsChapterHint;
      if (hintEl) {
        revealLiveRegion({
          region: hintEl,
          textElement: hintEl,
          text: t('modals.levelSelect.fluxSeed.invalidHint', { length: seedConfig?.length }),
          schedule: scheduleNextFrame
        });
      }
      return;
    }
    this.elements.levelsChapterHint?.classList.add('hidden');
    this.requestDestructiveAction(
      () => {
        input.value = '';
        this.hideAllModals();
        this.engine.startFluxRun(seed, { isShared: true });
      },
      () => t('app.nav.button.flux')
    );
  },

  saveLastFocusedElement() {
    if (
      !this.isAnyModalOpen() &&
      document.activeElement &&
      document.activeElement !== document.body &&
      document.activeElement !== document.documentElement
    ) {
      this.lastFocusedElement = document.activeElement;
    }
  },

  /** All modals, topmost first: the first open one is the active dialog. */
  getModalsByPriority() {
    return [
      this.elements.modalConfirm,
      ...this.getOverlayModals(),
      this.elements.modalVictory,
      this.elements.modalGameOver,
      this.elements.modalPause,
      this.elements.modalFluxPerk
    ].filter(Boolean);
  },

  /** Dialogs opened from the menu over a run, which they pause until they close. */
  getOverlayModals() {
    return [
      this.elements.modalLevels,
      this.elements.modalShop,
      this.elements.modalSettings,
      this.elements.modalStats,
      this.elements.modalDuel
    ].filter(Boolean);
  },

  isAnyOverlayModalOpen() {
    return this.getOverlayModals().some((modal) => !modal.classList.contains('hidden'));
  },

  /**
   * Opens a menu dialog over the run, pausing it, and focuses the given control.
   * @param {HTMLElement} modal - The dialog to show.
   * @param {HTMLElement} [focusTarget] - The control that receives focus.
   */
  openOverlayModal(modal, focusTarget) {
    if (!modal) {
      return;
    }
    if (modal === this.elements.modalSettings) {
      this.syncDuelNameField();
    }
    if (modal === this.elements.modalSettings && this.hintsResetConfirmed) {
      this.hintsResetConfirmed = false;
      this.updateResetHintsFeedback();
    }
    this.saveLastFocusedElement();
    if (this.engine.state === GAME_STATES.PLAYING) {
      this.autoPausedByOverlay = true;
      this.engine.state = GAME_STATES.PAUSED;
    }
    modal.classList.remove('hidden');
    this.syncModalInertState();
    if (focusTarget) {
      focusTarget.focus();
    }
  },

  getActiveTopModal() {
    for (const m of this.getModalsByPriority()) {
      if (!m.classList.contains('hidden')) {
        return m;
      }
    }
    return null;
  },

  trapModalFocus(e) {
    this.trapFocusWithin(this.getActiveTopModal(), e);
  },

  /** Keeps Tab and Shift+Tab cycling inside a container (a modal or the open menu). */
  trapFocusWithin(activeModal, e) {
    if (!activeModal) {
      return;
    }
    const focusables = filterFocusTrapCandidates(activeModal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!activeModal.contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  },

  syncModalInertState() {
    const anyOpen = this.isAnyModalOpen();
    if (this.elements.appShell) {
      this.elements.appShell.inert = anyOpen;
      if (anyOpen) {
        this.elements.appShell.setAttribute('aria-hidden', 'true');
      } else {
        this.elements.appShell.removeAttribute('aria-hidden');
      }
    }
    // A modal stacked on another (Confirm over Pause or Levels) leaves the
    // one underneath visible but unreachable.
    const topModal = this.getActiveTopModal();
    for (const modal of this.getModalsByPriority()) {
      const isCovered = Boolean(topModal) && modal !== topModal && !modal.classList.contains('hidden');
      modal.inert = isCovered;
      if (isCovered) {
        modal.setAttribute('aria-hidden', 'true');
      } else {
        modal.removeAttribute('aria-hidden');
      }
    }
    const wasAnyOpen = this.wasAnyModalOpen === true;
    this.wasAnyModalOpen = anyOpen;
    if (!anyOpen) {
      const saved = this.lastFocusedElement;
      this.lastFocusedElement = null;
      const isSavedReachable =
        Boolean(saved) &&
        typeof saved.focus === 'function' &&
        saved.isConnected !== false &&
        filterFocusTrapCandidates([saved]).length > 0;
      if (isSavedReachable) {
        saved.focus();
      } else if (wasAnyOpen) {
        // Nothing usable to return to (focus was on the page body, or the opener is now hidden):
        // the game canvas keeps keyboard focus inside the app instead of dropping to body.
        const canvas = this.elements.gameCanvas;
        if (canvas && typeof canvas.focus === 'function') {
          canvas.focus();
        }
      }
    }
    if (anyOpen) {
      this.keepFocusInTopModal(topModal);
    } else {
      this.stackedModalOpener = null;
    }
  },

  /** Brings focus back into the top dialog when the one that held it just closed. */
  keepFocusInTopModal(topModal) {
    if (topModal === this.elements.modalConfirm) {
      return;
    }
    const target = resolveModalFocusTarget(
      topModal,
      document.activeElement,
      this.stackedModalOpener,
      topModal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR)
    );
    this.stackedModalOpener = null;
    if (target) {
      target.focus();
    }
  },

  /** The Workshop tabs in display order, each with its tab button and panel. */
  getShopTabs() {
    return [
      { name: SHOP_TABS.UPGRADES, el: this.elements.tabShopUpgrades, pane: this.elements.shopUpgradesPane },
      { name: SHOP_TABS.AMMO, el: this.elements.tabShopAmmo, pane: this.elements.shopAmmoPane },
      { name: SHOP_TABS.STYLES, el: this.elements.tabShopStyles, pane: this.elements.shopStylesPane },
      { name: SHOP_TABS.ACHIEVEMENTS, el: this.elements.tabShopAchievements, pane: this.elements.achievementsGrid },
      { name: SHOP_TABS.CODEX, el: this.elements.tabShopCodex, pane: this.elements.codexPane }
    ].filter((tab) => tab.el && tab.pane);
  },

  switchShopTab(tabName) {
    const tabs = this.getShopTabs();
    this.activeShopTab = tabs.some((tab) => tab.name === tabName) ? tabName : SHOP_TABS.UPGRADES;
    for (const { name, el, pane } of tabs) {
      const isActive = name === this.activeShopTab;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', String(isActive));
      el.tabIndex = isActive ? 0 : -1;
      pane.classList.toggle('hidden', !isActive);
    }
  },

  getAffordableUpgradeCount() {
    const coins = this.storageManager.getCoins();
    let count = 0;
    for (const [upgradeKey, spec] of Object.entries(this.gameConfig.upgrades)) {
      const currentLevel = this.storageManager.getUpgradeLevel(upgradeKey);
      if (currentLevel < spec.maxLevel && coins >= this.storageManager.getUpgradeCost(upgradeKey)) {
        count++;
      }
    }
    return count;
  },

  closeOverlayModal(modalElement) {
    modalElement.classList.add('hidden');
    if (modalElement === this.elements.modalLevels) {
      this.elements.levelsChapterHint?.classList.add('hidden');
    }
    if (modalElement === this.elements.modalStats) {
      // Opened over the Daily game over: focus returns to its History button.
      if (this.statsOpener?.isConnected) {
        this.stackedModalOpener = this.statsOpener;
      }
      this.statsOpener = null;
    }
    const otherOverlayStillOpen =
      this.isAnyOverlayModalOpen() ||
      Boolean(this.elements.modalConfirm && !this.elements.modalConfirm.classList.contains('hidden'));

    if (!otherOverlayStillOpen && !this.isDrawerOpen) {
      if (this.autoPausedByOverlay && this.engine.state === GAME_STATES.PAUSED) {
        this.autoPausedByOverlay = false;
        this.engine.state = GAME_STATES.PLAYING;
        this.elements.modalPause.classList.add('hidden');
      } else if (this.engine.state === GAME_STATES.VICTORY && !this.engine.isVictoryCelebrating()) {
        this.isVictoryModalRevealed = true;
        this.updateNextLevelButton(this.engine);
        this.elements.modalVictory.classList.remove('hidden');
      } else if (this.engine.state === GAME_STATES.GAME_OVER) {
        this.elements.modalGameOver.classList.remove('hidden');
      } else if (this.engine.state === GAME_STATES.PAUSED && !this.isRunHeldByUi()) {
        if (modalElement === this.elements.modalLevels) {
          this.stackedModalOpener = this.elements.btnLevelsPause;
        } else if (modalElement === this.elements.modalSettings) {
          this.stackedModalOpener = this.elements.btnSettingsPause;
        }
        this.elements.modalPause.classList.remove('hidden');
      }
    }
    this.syncModalInertState();
  },

  isAnyModalOpen() {
    return this.getModalsByPriority().some((modal) => !modal.classList.contains('hidden'));
  },

  hideAllModals() {
    this.autoPausedByOverlay = false;
    this.confirmPausedRun = false;
    this.pendingConfirmCallback = null;
    this.pendingConfirmLabelResolver = null;
    this.stopDailyCountdown();
    this.elements.levelsChapterHint?.classList.add('hidden');
    for (const modal of this.getModalsByPriority()) {
      modal.classList.add('hidden');
    }
    this.syncModalInertState();
  },

  /**
   * @param {string} [tabName] - Tab to show; the last one used when omitted.
   */
  openShopModal(tabName = this.activeShopTab) {
    this.renderShopContents();
    if (this.elements.codexPane) {
      this.buildCodexPane();
    }
    this.switchShopTab(tabName);
    this.openOverlayModal(this.elements.modalShop, this.elements.btnCloseShop);
  },

  /**
   * Re-renders the shop after a purchase without reopening it, then puts
   * focus back on the same buy button (or the nearest usable one when that
   * button just became disabled).
   */
  rerenderShopKeepingFocus(focusSelector, fallbackSlotIndex = 0) {
    rerenderWorkshopKeepingFocus.call(this, focusSelector, fallbackSlotIndex);
  },

  renderShopContents() {
    renderWorkshopContents.call(this);
  },

  buildCodexPane() {
    buildCodexPane.call(this);
  },
};
