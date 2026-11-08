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

/*
 * Polarity Duel on screen: the tier picker, the versus screen with its layout chosen by
 * measurement, the scene controller that routes keyboard, pointer and controller to the
 * player's board, the pause and result dialogs, the records and the share text. The match
 * itself lives in game/VersusMatch.js; the HUD DOM in VersusHud.js.
 */

import { GAME_MODES, GAME_STATES, INPUT_MODES, MATH_CONSTANTS, SPECIAL_TYPES_ORDER } from '../core/Constants.js';
import { GAMEPAD_ACTIONS, GAMEPAD_EVENTS } from '../core/GamepadInput.js';
import { t, formatNumber } from '../core/I18n.js';
import { buildShareText } from '../game/DailyShare.js';
import { buildRunOutcomeDelta } from '../game/PlayerStats.js';
import { Renderer } from '../game/Renderer.js';
import { MATCH_EVENTS, createVersusMatch } from '../game/VersusMatch.js';
import { bindCanvasInput } from './CanvasInput.js';
import {
  DEVICE_TYPES,
  SIDES,
  acceptPointerForSlot,
  assignPad,
  createSplitKeyboard,
  markPadLost,
  slotForPad
} from './LocalInput.js';
import { UI_SCENES } from './UIInputBindings.js';
import { isAriaDisabled, revealLiveRegion, scheduleNextFrame, setTextIfChanged } from './UIHelpers.js';
import { describeLocalDevice } from './UIVersusLocal.js';
import {
  VERSUS_LAYOUTS,
  VERSUS_ORIENTATIONS,
  VersusHud,
  chooseVersusLayout,
  collectVersusHudElements,
  computeMiniSize,
  createAnnouncementQueue,
  createVersusTutorial,
  fitBoard,
  renderAnnouncement
} from './VersusHud.js';

const A = GAMEPAD_ACTIONS;

const HIDDEN_CLASS = 'hidden';
const OUTCOME_WIN = 'win';
const OUTCOME_LOSS = 'loss';
const OUTCOME_QUIT = 'quit';
const PLAYER_BOARD = 0;
const CPU_BOARD = 1;
/** The announcement clock counts the fixed steps the match actually ran. */
const CLOCK_TICK = 1;
const TIER_BUTTON_CLASS = 'versus-tier-btn';
const TIER_NAME_CLASS = 'versus-tier-name';
const TIER_RECORD_CLASS = 'versus-tier-record';
/** Kinds of match the screen can run. */
const VERSUS_KINDS = Object.freeze({ CPU: 'cpu', LOCAL: 'local' });
const FIRST_PLAYER_NUMBER = 1;

/** Phases of the screen, as the match announcements report them. */
const SCREEN_PHASES = Object.freeze({
  PLAYING: 'playing',
  ROUND_OVER: 'roundOver',
  MATCH_OVER: 'matchOver'
});

/** Methods installed on UIManager.prototype by UIManager.js. */
export const uiVersusMethods = {
  /** True while the versus screen is open. */
  isVersusActive() {
    return Boolean(this.versus);
  },

  /** True when the match pause dialog is the top layer. */
  isVersusPauseTop() {
    return Boolean(this.versus) && this.getActiveTopModal() === this.elements.modalDuelPause;
  },

  /** The scene the game loop steps and draws: the versus match while it is open, else the run. */
  getLoopScene() {
    return this.versusScene ?? this.mainScene;
  },

  /** Gives the UI what it needs to build a match (the config sections the engines take). */
  setVersusConfigs(configs) {
    this.versusConfigs = configs || null;
  },

  bindVersusEvents() {
    const els = this.elements;
    els.btnModeVersus?.addEventListener('click', () => {
      this.openVersusTierPicker();
    });
    els.btnVersusTiersBack?.addEventListener('click', () => {
      this.closeVersusTierPicker();
    });
    els.versusTierList?.addEventListener('click', (event) => {
      const button = event.target.closest?.(`.${TIER_BUTTON_CLASS}`);
      if (button) {
        this.pickVersusTier(button.dataset.tier);
      }
    });
    els.btnVersusPause?.addEventListener('click', () => this.pauseVersus());
    els.btnVersusResume?.addEventListener('click', () => this.resumeVersus());
    els.btnVersusRestart?.addEventListener('click', () => this.restartVersus());
    els.btnVersusQuit?.addEventListener('click', () => this.quitVersus());
    els.btnVersusRematch?.addEventListener('click', () => {
      // The primary button of the local result card ignores presses until the guard time is over.
      if (!isAriaDisabled(els.btnVersusRematch)) {
        this.restartVersus();
      }
    });
    els.btnVersusBack?.addEventListener('click', () => this.leaveVersus());
    els.btnVersusShare?.addEventListener('click', () => {
      this.shareVersusResult();
    });
    els.btnVersusSwap?.addEventListener('click', () => {
      this.versusPlayerAct((engine) => engine.swapLauncherBalls());
    });
    els.btnVersusPolarity?.addEventListener('click', () => {
      this.versusPlayerAct((engine) => engine.togglePolarityFlip());
    });
    // The second HUD only has controls in the local two-player match.
    els.btnVersusSwap1?.addEventListener('click', () => {
      this.versusBoardAct(1, (engine) => engine.swapLauncherBalls());
    });
    els.btnVersusPolarity1?.addEventListener('click', () => {
      this.versusBoardAct(1, (engine) => engine.togglePolarityFlip());
    });
  },

  // ---------------------------------------------------------------------------------------
  // Tier picker
  // ---------------------------------------------------------------------------------------

  /** Opens the difficulty picker over the level select (the card is gated by the mode unlock). */
  openVersusTierPicker() {
    if (!this.elements.modalVersusTiers) {
      return;
    }
    this.runIfModeUnlocked(GAME_MODES.VERSUS, () => {
      this.renderVersusTierPicker();
      const firstOpen = this.elements.versusTierList?.querySelector(`.${TIER_BUTTON_CLASS}:not([aria-disabled="true"])`);
      this.openOverlayModal(this.elements.modalVersusTiers, firstOpen || this.elements.btnVersusTiersBack);
    });
  },

  /** Closes the picker; focus goes back to the card that opened it. */
  closeVersusTierPicker() {
    this.elements.versusTierHint?.classList.add(HIDDEN_CLASS);
    this.stackedModalOpener = this.elements.btnModeVersus;
    this.closeOverlayModal(this.elements.modalVersusTiers);
  },

  isVersusTierPickerOpen() {
    const modal = this.elements.modalVersusTiers;
    return Boolean(modal) && !modal.classList.contains(HIDDEN_CLASS);
  },

  /** One button per configured tier with its record; a tier that is not unlocked says how to unlock it. */
  renderVersusTierPicker() {
    const list = this.elements.versusTierList;
    if (!list) {
      return;
    }
    const storage = this.storageManager;
    const records = storage.getVersusRecords?.() ?? {};
    const buttons = (storage.getVersusTiers?.() ?? []).map((tier) => {
      const isLocked = storage.isVersusTierUnlocked?.(tier) === false;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = TIER_BUTTON_CLASS;
      button.dataset.tier = tier;
      const name = document.createElement('span');
      name.className = TIER_NAME_CLASS;
      name.textContent = t(`versus.tier.${tier}`);
      const record = document.createElement('span');
      record.className = TIER_RECORD_CLASS;
      const entry = records[tier] ?? { w: 0, l: 0 };
      record.textContent = isLocked
        ? t('versus.tier.hardLocked')
        : t('versus.tier.record', { wins: formatNumber(entry.w), losses: formatNumber(entry.l) });
      button.append(name, record);
      if (isLocked) {
        button.setAttribute('aria-disabled', 'true');
      }
      return button;
    });
    list.replaceChildren(...buttons);
    this.syncVersusLocalEntry?.();
  },

  /** A tier button was activated: a locked one explains itself, an open one starts the match. */
  pickVersusTier(tier) {
    const storage = this.storageManager;
    if (storage.isVersusTierUnlocked?.(tier) === false) {
      const hint = this.elements.versusTierHint;
      if (hint) {
        revealLiveRegion({ region: hint, textElement: hint, text: t('versus.tier.hardLocked'), schedule: scheduleNextFrame });
      }
      return;
    }
    this.enterVersus(tier);
  },

  // ---------------------------------------------------------------------------------------
  // Entering and leaving
  // ---------------------------------------------------------------------------------------

  createVersusSeed() {
    const radix = this.gameConfig.versus.ui.seedRadix;
    this.versusSeedCounter = (this.versusSeedCounter || 0) + 1;
    return `${Date.now().toString(radix)}${this.versusSeedCounter.toString(radix)}`;
  },

  /**
   * Opens the versus screen. The current run is held paused (its snapshot is stored) and comes
   * back paused when the screen closes.
   * @param {string|{kind?: string, tier?: string, slots?: object[], riseMultipliers?: number[]}} options -
   *   A tier of versus.cpu (a match against the CPU), or {kind: 'cpu', tier}, or {kind: 'local', slots,
   *   riseMultipliers} for two players on this device (slots from LocalInput.js, one device each).
   */
  enterVersus(options) {
    if (this.versus || !this.versusConfigs || !this.elements.versusScreen) {
      return;
    }
    const spec = typeof options === 'string' ? { kind: VERSUS_KINDS.CPU, tier: options } : options;
    const isLocal = spec.kind === VERSUS_KINDS.LOCAL;
    const tier = isLocal ? null : spec.tier;
    this.hideAllModals();
    if (this.engine.state === GAME_STATES.PLAYING || this.engine.state === GAME_STATES.PAUSED) {
      this.engine.state = GAME_STATES.PAUSED;
      this.autoPausedByOverlay = true;
      this.engine.saveRunSnapshot?.();
    }
    this.storageManager.ensureModeUnlocked?.(GAME_MODES.VERSUS);

    const hud = new VersusHud(collectVersusHudElements(document));
    const v = {
      kind: isLocal ? VERSUS_KINDS.LOCAL : VERSUS_KINDS.CPU,
      tier,
      slots: isLocal ? spec.slots.map((slot) => ({ ...slot })) : null,
      riseMultipliers: isLocal ? [...spec.riseMultipliers] : null,
      kb: isLocal ? createSplitKeyboard(this.gameConfig.versus.local.keyboard) : null,
      sceneController: null,
      tooSmall: false,
      isTooSmallAnnounced: false,
      breakFrames: 0,
      resultGuardTimer: null,
      hud,
      controller: null,
      renderers: [null, null],
      scene: null,
      layout: null,
      phase: SCREEN_PHASES.PLAYING,
      clock: 0,
      sinceRefresh: 0,
      hudDirty: true,
      isLayoutQueued: false,
      result: null,
      queue: null,
      unbindInput: null,
      unsubscribe: null,
      onResize: null
    };
    v.queue = this.createVersusQueue(v);
    // The screen is live before the first round starts so the announcement of round 1 is received.
    this.versus = v;
    try {
      v.controller = createVersusMatch({
        seed: this.createVersusSeed(),
        ...(isLocal
          ? { mode: 'local', riseMultipliers: v.riseMultipliers, autoAdvance: false }
          : { mode: 'cpu', playerBoard: PLAYER_BOARD, cpuTier: tier, autoAdvance: true }),
        configs: this.versusConfigs,
        storageManager: this.storageManager,
        audioManager: this.audioManager,
        onBoardChange: () => {
          v.hudDirty = true;
        },
        onEvent: (event) => this.handleVersusEvent(event)
      });
    } catch (error) {
      this.versus = null;
      throw error;
    }

    this.elements.versusScreen.dataset.mode = v.kind;
    if (isLocal) {
      this.elements.versusScreen.dataset.p1Mouse = String(v.slots[0]?.device?.type === DEVICE_TYPES.KEYBOARD_MOUSE);
    }
    this.elements.versusScreen.classList.remove(HIDDEN_CLASS);
    this.syncModalInertState();
    hud.refreshLabels();
    this.layoutVersus();
    v.unbindInput = isLocal ? this.bindLocalCanvases(v) : this.bindCpuCanvas(v);
    v.onResize = () => this.scheduleVersusLayout();
    for (const type of ['resize', 'orientationchange']) {
      window.addEventListener(type, v.onResize);
    }
    if (isLocal) {
      v.sceneController = this.createLocalSceneController();
      this.setActiveScene(UI_SCENES.VERSUS, v.sceneController);
    } else {
      this.setActiveScene(UI_SCENES.VERSUS, this.versusSceneController);
    }
    this.refreshVersusHud();
    // A window too small for two boards opened the pause dialog already: it keeps the focus.
    if (!this.isAnyModalOpen()) {
      this.elements.versusCanvas0.focus();
      this.maybeShowVersusTutorial();
    }
  },

  // ---------------------------------------------------------------------------------------
  // First-duel tutorial
  // ---------------------------------------------------------------------------------------

  /** True while the first-duel tutorial is on screen (the match is held). */
  isVersusTutorialOpen() {
    return Boolean(this.versus?.tutorial?.isOpen());
  },

  /** Opens the tutorial on the first duel of this device; it is never shown again afterwards. */
  maybeShowVersusTutorial() {
    const v = this.versus;
    const cfg = this.gameConfig.versus.tutorial;
    if (!v || !cfg || this.storageManager.getVersusTutorialSeen?.() !== false) {
      return;
    }
    // Stored first: a page left in the middle of the tutorial does not bring it back.
    this.storageManager.setVersusTutorialSeen?.(true);
    v.kb?.releaseAll();
    v.controller.pause();
    v.tutorial = createVersusTutorial({
      steps: cfg.steps,
      stepKeyPrefix: cfg.stepKeyPrefix,
      onClose: () => this.closeVersusTutorial()
    });
    document.body.append(v.tutorial.element);
    v.tutorial.open();
  },

  /** Takes the tutorial off the page and hands the board back: the match resumes. */
  closeVersusTutorial() {
    const v = this.versus;
    if (!v?.tutorial) {
      return;
    }
    v.tutorial.element.remove?.();
    v.tutorial = null;
    v.controller.resume();
    v.hudDirty = true;
    this.elements.versusCanvas0.focus();
  },

  /** Pad actions while the tutorial is open: confirm moves on, back or Start skips. */
  routeVersusTutorialActions(actions) {
    const tutorial = this.versus?.tutorial;
    if (!tutorial) {
      return;
    }
    if (actions.includes(A.BACK) || actions.includes(A.PAUSE) || actions.includes(A.MENU)) {
      tutorial.close('skip');
    } else if (actions.includes(A.SHOOT) || actions.includes(A.CONFIRM)) {
      tutorial.next();
    }
  },

  /** Announcement queue of the match kind. */
  createVersusQueue(v) {
    return createAnnouncementQueue({
      windowFrames: this.gameConfig.versus.ui.announceWindowFrames,
      suddenDeathSeconds: this.gameConfig.versus.suddenDeath.intervalSeconds,
      playerBoard: PLAYER_BOARD,
      mode: v.kind === VERSUS_KINDS.LOCAL ? VERSUS_KINDS.LOCAL : VERSUS_KINDS.CPU
    });
  },

  /** True for the match of two players on this device. */
  isLocalVersus() {
    return this.versus?.kind === VERSUS_KINDS.LOCAL;
  },

  /** The one pointer-controlled board of a match against the CPU. */
  bindCpuCanvas(v) {
    return bindCanvasInput(this.elements.versusCanvas0, () => v.controller.engines[PLAYER_BOARD], this.gameConfig, {
      isBlocked: () => this.isAnyModalOpen() || v.controller.isPaused() || v.phase !== SCREEN_PHASES.PLAYING
    }).unbind;
  },

  /**
   * Both boards of a local match follow pointers, each its own: a canvas owns one pointer from
   * press to release, and takes only the pointer types its player's device uses.
   */
  bindLocalCanvases(v) {
    const canvases = [this.elements.versusCanvas0, this.elements.versusCanvas1];
    const unbinders = canvases.map(
      (canvas, board) =>
        bindCanvasInput(canvas, () => v.controller.engines[board], this.gameConfig, {
          isBlocked: () => this.isAnyModalOpen() || v.controller.isPaused() || v.phase !== SCREEN_PHASES.PLAYING,
          pointerOwnership: 'perCanvas',
          acceptPointer: (event) => acceptPointerForSlot(v.slots[board], board, event.pointerType)
        }).unbind
    );
    return () => unbinders.forEach((unbind) => unbind());
  },

  /**
   * Closes the versus screen and brings the held run back, paused. Nothing is recorded here.
   */
  leaveVersus() {
    const v = this.versus;
    if (!v) {
      return;
    }
    v.unsubscribe?.();
    v.unbindInput?.();
    v.tutorial?.element.remove?.();
    v.tutorial = null;
    v.kb?.releaseAll();
    clearTimeout(v.resultGuardTimer);
    for (const type of ['resize', 'orientationchange']) {
      window.removeEventListener(type, v.onResize);
    }
    for (const renderer of v.renderers) {
      renderer?.dispose();
    }
    for (const engine of v.controller.engines) {
      engine.audioManager?.stopAll?.();
    }
    this.versus = null;
    this.versusScene = null;
    this.setActiveScene(UI_SCENES.MAIN);
    this.elements.versusRoundOverlay?.classList.add(HIDDEN_CLASS);
    this.elements.versusScreen.classList.add(HIDDEN_CLASS);
    for (const modal of [this.elements.modalDuelPause, this.elements.modalDuelResult]) {
      modal?.classList.add(HIDDEN_CLASS);
    }
    this.elements.versusResultShareFallback?.classList.add(HIDDEN_CLASS);
    delete this.elements.versusScreen.dataset.mode;
    delete this.elements.versusScreen.dataset.p1Mouse;
    delete this.elements.versusScreen.dataset.tooSmall;
    this.elements.btnVersusRematch?.removeAttribute('aria-disabled');
    // The run held when the screen opened is shown again; its Pause dialog is what the player sees.
    this.autoPausedByOverlay = false;
    this.syncModalInertState();
    this.refresh(this.engine, this.lastExtra);
    this.restoreHeldRunDialog();
    if (this.engine.state === GAME_STATES.PAUSED && !this.elements.modalPause.classList.contains(HIDDEN_CLASS)) {
      this.elements.btnResume?.focus();
    }
  },

  /**
   * Entering the duel hides every dialog; a held run that had already ended gets its Victory or
   * Game Over dialog back when the screen closes.
   */
  restoreHeldRunDialog() {
    const engine = this.engine;
    if (engine.state === GAME_STATES.VICTORY && !engine.isVictoryCelebrating?.()) {
      this.isVictoryModalRevealed = true;
      this.updateNextLevelButton?.(engine);
      this.elements.modalVictory?.classList.remove(HIDDEN_CLASS);
      this.syncModalInertState();
      this.focusInTopModal?.(this.elements.btnNextLevel);
    } else if (engine.state === GAME_STATES.GAME_OVER) {
      this.elements.modalGameOver?.classList.remove(HIDDEN_CLASS);
      this.syncModalInertState();
      this.focusInTopModal?.(this.elements.btnRetry);
    }
  },

  // ---------------------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------------------

  /** Recomputes the layout on the next frame, once, however many resizes arrive. */
  scheduleVersusLayout() {
    const v = this.versus;
    if (!v || v.isLayoutQueued) {
      return;
    }
    v.isLayoutQueued = true;
    scheduleNextFrame(() => {
      v.isLayoutQueued = false;
      if (this.versus === v) {
        this.layoutVersus();
      }
    });
  },

  /**
   * Chooses split or mini-view by measuring the room (versus.layout), arranges the screen, sizes
   * the two canvases and renews a renderer whose mode changed (the CPU board is lite in the mini-view).
   */
  layoutVersus() {
    const v = this.versus;
    const els = this.elements;
    const screen = els.versusScreen;
    const layoutCfg = this.gameConfig.versus.layout;
    const canvasCfg = this.gameConfig.canvas;
    const isLandscape = window.innerWidth > window.innerHeight;
    screen.dataset.orient = isLandscape ? VERSUS_ORIENTATIONS.LANDSCAPE : VERSUS_ORIENTATIONS.PORTRAIT;
    // Measured in the split arrangement: the room under the bar does not depend on the layout.
    screen.dataset.layout = VERSUS_LAYOUTS.SPLIT;
    this.placeVersusBar(false);
    const boardsBox = els.versusBoards;
    const style = window.getComputedStyle(boardsBox);
    const choice = chooseVersusLayout(
      {
        areaWidth: boardsBox.clientWidth,
        areaHeight: boardsBox.clientHeight,
        hudHeight: els.versusHud0.offsetHeight,
        viewportHeight: window.innerHeight,
        gap: Number.parseFloat(style.columnGap) || 0
      },
      layoutCfg,
      canvasCfg
    );
    // Two human boards never shrink to the mini-view: the match is held until the window is large enough.
    const isLocal = v.kind === VERSUS_KINDS.LOCAL;
    const layout = isLocal ? VERSUS_LAYOUTS.SPLIT : choice.layout;
    const wasTooSmall = v.tooSmall;
    v.tooSmall = isLocal && choice.layout === VERSUS_LAYOUTS.MINI;
    screen.dataset.layout = layout;

    const isMini = layout === VERSUS_LAYOUTS.MINI;
    const wraps = [els.versusCanvas0.parentElement, els.versusCanvas1.parentElement];
    if (!isMini) {
      const cpuFit = fitBoard(wraps[CPU_BOARD].clientWidth, wraps[CPU_BOARD].clientHeight, canvasCfg);
      const playerFit = fitBoard(wraps[PLAYER_BOARD].clientWidth, wraps[PLAYER_BOARD].clientHeight, canvasCfg);
      // Both boards are drawn at the size of the smaller fit, so they line up.
      const size = cpuFit.width < playerFit.width ? cpuFit : playerFit;
      // A board squeezed to nothing keeps its last size (the boards are hidden then).
      if (size.width > 0 && size.height > 0) {
        this.sizeVersusCanvas(els.versusCanvas0, size);
        this.sizeVersusCanvas(els.versusCanvas1, size);
      }
    } else {
      // On a wide, short screen the top bar moves into the side column: the player board gets its height.
      this.placeVersusBar(isLandscape);
      this.layoutVersusMini(isLandscape, style);
    }

    const previous = v.layout;
    v.layout = layout;
    const needsCpuRenderer = !v.renderers[CPU_BOARD] || previous !== layout;
    if (!v.renderers[PLAYER_BOARD] || needsCpuRenderer) {
      this.buildVersusRenderers(isMini);
    }
    if (isLocal) {
      this.applyLocalSizeState(wasTooSmall);
    }
  },

  /**
   * A local match that does not fit is held: the boards are hidden, the pause dialog says why
   * and Resume stays out of reach until the window is large enough again (the match then stays paused).
   */
  applyLocalSizeState(wasTooSmall) {
    const v = this.versus;
    this.elements.versusScreen.dataset.tooSmall = String(v.tooSmall);
    if (v.tooSmall && !wasTooSmall) {
      v.isTooSmallAnnounced = false;
    }
    if (v.tooSmall) {
      this.pauseVersus();
      if (!v.isTooSmallAnnounced) {
        v.isTooSmallAnnounced = true;
        this.announce(t('versus.local.pause.tooSmall'));
      }
    }
    this.syncLocalPauseGuards();
  },

  /** True when the match cannot be resumed: the window is too small, or a player's controller is gone. */
  isVersusResumeBlocked() {
    const v = this.versus;
    return Boolean(v) && v.kind === VERSUS_KINDS.LOCAL && (v.tooSmall || v.slots.some((slot) => slot.padLost));
  },

  /** Writes the reasons the pause dialog gives (size, lost controller) and the state of Resume. */
  syncLocalPauseGuards() {
    const v = this.versus;
    const els = this.elements;
    if (!v || v.kind !== VERSUS_KINDS.LOCAL) {
      return;
    }
    els.versusPauseSizeHint?.classList.toggle(HIDDEN_CLASS, !v.tooSmall);
    if (v.tooSmall) {
      setTextIfChanged(els.versusPauseSizeHint, t('versus.local.pause.tooSmall'));
    }
    const lostIndex = v.slots.findIndex((slot) => slot.padLost);
    els.versusPausePadHint?.classList.toggle(HIDDEN_CLASS, lostIndex === -1);
    if (lostIndex !== -1) {
      setTextIfChanged(els.versusPausePadHint, t('versus.local.announce.padLost', { n: lostIndex + FIRST_PLAYER_NUMBER }));
    }
    els.btnVersusResume?.setAttribute('aria-disabled', String(this.isVersusResumeBlocked()));
  },

  /**
   * Puts the top bar above the boards (the default) or inside the boards grid, where the
   * landscape mini-view lays it out in the side column. Keyboard focus stays on the same control.
   * @param {boolean} insideBoards - True to move the bar into the boards grid.
   */
  placeVersusBar(insideBoards) {
    const { versusBar: bar, versusBoards: boards, versusScreen: screen } = this.elements;
    if (!bar || !boards || (bar.parentElement === boards) === insideBoards) {
      return;
    }
    const focused = bar.contains(document.activeElement) ? document.activeElement : null;
    if (insideBoards) {
      boards.append(bar);
    } else {
      screen.insertBefore(bar, boards);
    }
    focused?.focus();
  },

  /**
   * Sizes the boards of the mini-view. The CPU board is miniScale of the logical size, shrunk when its
   * column is short; on a wide screen the player board gets the width left between the two side columns.
   */
  layoutVersusMini(isLandscape, boardsStyle) {
    const els = this.elements;
    const screen = els.versusScreen;
    const layoutCfg = this.gameConfig.versus.layout;
    const canvasCfg = this.gameConfig.canvas;
    const nominal = computeMiniSize(canvasCfg, layoutCfg);
    screen.style.setProperty('--versus-mini-width', `${nominal.width}px`);
    screen.style.setProperty('--versus-mini-height', `${nominal.height}px`);
    const boardsBox = els.versusBoards;
    const rowGap = Number.parseFloat(boardsStyle.rowGap) || 0;
    const columnGap = Number.parseFloat(boardsStyle.columnGap) || 0;
    // The HUD heights are read once the arrangement is in place: they differ from the split.
    const columnRoom = isLandscape
      ? boardsBox.clientHeight - els.versusHud1.offsetHeight - (els.versusBar?.offsetHeight ?? 0) - 2 * rowGap
      : Infinity;
    const mini = computeMiniSize(canvasCfg, layoutCfg, columnRoom);
    screen.style.setProperty('--versus-mini-width', `${mini.width}px`);
    screen.style.setProperty('--versus-mini-height', `${mini.height}px`);
    this.sizeVersusCanvas(els.versusCanvas1, mini);
    if (isLandscape) {
      const sideRoom = boardsBox.clientWidth - 2 * (mini.width + columnGap);
      const player = fitBoard(sideRoom, boardsBox.clientHeight, canvasCfg);
      screen.style.setProperty('--versus-player-width', `${player.width}px`);
      this.sizeVersusCanvas(els.versusCanvas0, player);
    } else {
      const wrap = els.versusCanvas0.parentElement;
      this.sizeVersusCanvas(els.versusCanvas0, fitBoard(wrap.clientWidth, wrap.clientHeight, canvasCfg));
    }
  },

  sizeVersusCanvas(canvas, { width, height }) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  },

  /** Creates the renderers the layout needs (disposing the ones it replaces) and the scene that draws them. */
  buildVersusRenderers(isCpuLite) {
    const v = this.versus;
    const { gameConfig, ballsConfig, versusConfigs } = this;
    const make = (canvas, lite) => {
      const renderer = new Renderer(canvas, gameConfig, ballsConfig, versusConfigs.obstaclesConfig, { lite });
      renderer.setHighContrast(this.storageManager.getHighContrast());
      renderer.setColorPatterns(this.storageManager.getColorPatterns());
      renderer.setBallStyle(this.storageManager.getActiveBallStyle());
      return renderer;
    };
    if (!v.renderers[PLAYER_BOARD]) {
      v.renderers[PLAYER_BOARD] = make(this.elements.versusCanvas0, false);
    }
    v.renderers[CPU_BOARD]?.dispose();
    v.renderers[CPU_BOARD] = make(this.elements.versusCanvas1, isCpuLite);
    const liteInterval = gameConfig.versus.layout.liteFrameInterval;
    let liteFrame = 0;
    const cpuRenderer = v.renderers[CPU_BOARD];
    // The small board is redrawn every few frames: it is read at a glance, and two sims run on phones.
    const cpuDrawer = isCpuLite
      ? {
          render: (engine, alpha) => {
            liteFrame += 1;
            if (liteFrame % liteInterval === 0) {
              cpuRenderer.render(engine, alpha);
            }
          }
        }
      : cpuRenderer;
    const base = v.controller.getScene([v.renderers[PLAYER_BOARD], cpuDrawer]);
    v.scene = {
      ...base,
      step: () => this.stepVersus(),
      isAdvancing: () => v.phase === SCREEN_PHASES.PLAYING && !v.controller.isPaused()
    };
    this.versusScene = v.scene;
  },

  // ---------------------------------------------------------------------------------------
  // Stepping, HUD and announcements
  // ---------------------------------------------------------------------------------------

  /** One fixed step of the match (called by the game loop), followed by the screen's own upkeep. */
  stepVersus() {
    const v = this.versus;
    if (!v) {
      return;
    }
    const events = v.controller.step();
    if (!v.controller.isPaused()) {
      v.clock += CLOCK_TICK;
      this.advanceLocalRound(v);
    }
    // The announcements of the step already reached handleVersusEvent through the controller's listener.
    for (const entry of v.queue.drain(v.clock)) {
      this.announce(renderAnnouncement(entry));
    }
    v.sinceRefresh += 1;
    if (v.hudDirty || events.length > 0 || v.sinceRefresh >= this.gameConfig.versus.ui.hudRefreshFrames) {
      this.refreshVersusHud();
    }
  },

  /** The two-player match does not start the next round by itself: it does once the round break is over. */
  advanceLocalRound(v) {
    if (v.kind !== VERSUS_KINDS.LOCAL || v.phase !== SCREEN_PHASES.ROUND_OVER) {
      return;
    }
    v.breakFrames += 1;
    if (v.breakFrames >= this.gameConfig.versus.roundBreakFrames) {
      v.breakFrames = 0;
      v.controller.advance();
    }
  },

  /** Repaints the bar and both HUDs from the match state. */
  refreshVersusHud() {
    const v = this.versus;
    if (!v) {
      return;
    }
    v.sinceRefresh = 0;
    v.hudDirty = false;
    const state = v.controller.getState();
    if (v.kind === VERSUS_KINDS.LOCAL) {
      v.hud.refresh(state, { deviceNames: v.slots.map((slot) => describeLocalDevice(slot.device)) });
    } else {
      v.hud.refresh(state, { cpuTierName: t(`versus.tier.${v.tier}`) });
    }
    this.refreshVersusPlayerControls();
  },

  /**
   * Repaints what depends on the player's engine (polarity button, stocked specials) at once, so
   * assistive technology hears an input's effect without waiting for the periodic HUD refresh.
   */
  refreshVersusPlayerControls() {
    const v = this.versus;
    if (!v) {
      return;
    }
    const boards = v.kind === VERSUS_KINDS.LOCAL ? [0, 1] : [PLAYER_BOARD];
    let changed = false;
    for (const board of boards) {
      const didChange = v.hud.refreshPlayerControls(
        v.controller.engines[board],
        {
          types: SPECIAL_TYPES_ORDER,
          specs: this.ballsConfig.specialTypes,
          describe: (type, count) => this.getPowerupAriaLabel(type, count),
          onPick: (type) => this.versusBoardAct(board, (engine) => engine.equipSpecialBall(type))
        },
        board
      );
      changed = changed || didChange;
    }
    if (changed) {
      this.scheduleVersusLayout();
    }
  },

  /** Language switch: every dynamic text of the screen is written again. */
  refreshVersusLanguage() {
    if (this.isVersusTierPickerOpen()) {
      this.renderVersusTierPicker();
    }
    const v = this.versus;
    if (!v) {
      return;
    }
    v.hud.refreshLabels();
    v.tutorial?.refresh();
    this.refreshVersusHud();
    if (v.result && !this.elements.modalDuelResult.classList.contains(HIDDEN_CLASS)) {
      this.fillVersusResult(v.result);
    }
  },

  /** Reacts to one announcement of the match: round overlay, result card, records, live region. */
  handleVersusEvent(event) {
    const v = this.versus;
    if (!v) {
      return;
    }
    v.hudDirty = true;
    this.rumbleForVersusEvent(event);
    switch (event.type) {
      case MATCH_EVENTS.ROUND_START:
        v.phase = SCREEN_PHASES.PLAYING;
        v.breakFrames = 0;
        this.elements.versusRoundOverlay.classList.add(HIDDEN_CLASS);
        break;
      case MATCH_EVENTS.ROUND_WON:
      case MATCH_EVENTS.ROUND_LOST:
      case MATCH_EVENTS.ROUND_REPLAY:
      case MATCH_EVENTS.ROUND_DECIDED:
        v.phase = SCREEN_PHASES.ROUND_OVER;
        v.breakFrames = 0;
        this.showVersusRoundOverlay(event.type, event);
        break;
      case MATCH_EVENTS.MATCH_WON:
      case MATCH_EVENTS.MATCH_LOST:
      case MATCH_EVENTS.MATCH_DECIDED:
        v.phase = SCREEN_PHASES.MATCH_OVER;
        this.finishVersusMatch(event);
        break;
      default:
        break;
    }
    for (const entry of v.queue.push(event, v.clock)) {
      this.announce(renderAnnouncement(entry));
    }
  },

  /** Controller of a board: the pad of its slot (two players), or the active pad on the player's board. */
  getVersusPadIndex(board) {
    const v = this.versus;
    if (!v) {
      return -1;
    }
    if (v.kind === VERSUS_KINDS.LOCAL) {
      const device = v.slots[board]?.device;
      return device?.type === DEVICE_TYPES.PAD && !v.slots[board].padLost ? device.padIndex : -1;
    }
    return board === PLAYER_BOARD && this.inputMode === INPUT_MODES.GAMEPAD ? (this.gamepadInput?.activeIndex ?? -1) : -1;
  },

  /** Vibrates the pad of the board a charge landed on, a pulse hit, or a round was lost on. */
  rumbleForVersusEvent(event) {
    let kind;
    let board = event.board;
    switch (event.type) {
      case MATCH_EVENTS.CHARGE_LANDED:
        kind = 'charge';
        break;
      case MATCH_EVENTS.PULSE_RECEIVED:
        kind = 'pulse';
        break;
      case MATCH_EVENTS.ROUND_LOST:
        kind = 'roundLost';
        board = PLAYER_BOARD;
        break;
      case MATCH_EVENTS.ROUND_DECIDED:
        kind = 'roundLost';
        board = event.loser;
        break;
      default:
        return;
    }
    if (Number.isInteger(board)) {
      this.rumbleGamepad?.(kind, this.getVersusPadIndex(board));
    }
  },

  /** A short overlay with the result of the round, until the next round starts by itself. */
  showVersusRoundOverlay(type, event = {}) {
    const keys = {
      [MATCH_EVENTS.ROUND_WON]: 'versus.announce.roundWon',
      [MATCH_EVENTS.ROUND_LOST]: 'versus.announce.roundLost',
      [MATCH_EVENTS.ROUND_REPLAY]: 'versus.announce.roundDraw',
      [MATCH_EVENTS.ROUND_DECIDED]: 'versus.local.announce.roundWon'
    };
    const overlay = this.elements.versusRoundOverlay;
    overlay.textContent = t(keys[type], { n: (event.winner ?? 0) + FIRST_PLAYER_NUMBER });
    overlay.classList.remove(HIDDEN_CLASS);
  },

  // ---------------------------------------------------------------------------------------
  // Pause, restart, quit
  // ---------------------------------------------------------------------------------------

  /** Opens a versus dialog: focus goes into it and comes back to the board when it closes. */
  showVersusModal(modal, focusTarget) {
    // A key held when a dialog opens would stay held: its release goes to the dialog.
    this.versus?.kb?.releaseAll();
    this.saveLastFocusedElement();
    modal.classList.remove(HIDDEN_CLASS);
    this.syncModalInertState();
    focusTarget?.focus();
  },

  hideVersusModal(modal) {
    modal.classList.add(HIDDEN_CLASS);
    this.syncModalInertState();
  },

  /** Holds both boards and opens the pause dialog. */
  pauseVersus() {
    const v = this.versus;
    if (!v || v.phase === SCREEN_PHASES.MATCH_OVER || v.tutorial || this.isAnyModalOpen()) {
      return;
    }
    v.controller.pause();
    v.hudDirty = true;
    this.syncLocalPauseGuards();
    this.showVersusModal(this.elements.modalDuelPause, this.elements.btnVersusResume);
  },

  resumeVersus() {
    const v = this.versus;
    if (!v || this.isVersusResumeBlocked()) {
      return;
    }
    this.hideVersusModal(this.elements.modalDuelPause);
    v.controller.resume();
    this.elements.versusCanvas0.focus();
  },

  /** Starts the same kind of match again on a new seed (pause dialog and result card). */
  restartVersus() {
    const v = this.versus;
    if (!v) {
      return;
    }
    // Restarting a match that was started and not finished abandons it, like Quit does (nothing is
    // recorded for two players on one device: no statistics, no record).
    if (v.kind !== VERSUS_KINDS.LOCAL && !v.result && v.controller.getState().frame > 0) {
      this.recordVersusOutcome(OUTCOME_QUIT);
    }
    this.hideVersusModal(this.elements.modalDuelPause);
    this.hideVersusModal(this.elements.modalDuelResult);
    this.elements.versusResultShareFallback?.classList.add(HIDDEN_CLASS);
    clearTimeout(v.resultGuardTimer);
    this.elements.btnVersusRematch?.removeAttribute('aria-disabled');
    v.result = null;
    v.phase = SCREEN_PHASES.PLAYING;
    v.clock = 0;
    v.breakFrames = 0;
    v.kb?.releaseAll();
    v.queue = this.createVersusQueue(v);
    this.elements.versusRoundOverlay.classList.add(HIDDEN_CLASS);
    v.controller.restart(this.createVersusSeed());
    v.hudDirty = true;
    this.refreshVersusHud();
    if (this.isVersusResumeBlocked()) {
      // A controller is still missing: the new match waits for its replacement.
      this.pauseVersus();
    } else {
      this.elements.versusCanvas0.focus();
    }
  },

  /** Leaves a match that was not finished: it counts as a quit in the statistics (not for two players). */
  quitVersus() {
    if (this.versus?.kind !== VERSUS_KINDS.LOCAL) {
      this.recordVersusOutcome(OUTCOME_QUIT);
    }
    this.leaveVersus();
  },

  /** Result card of a local match: back to the lobby, with the same devices, to change who plays. */
  changeVersusPlayers() {
    if (!this.isLocalVersus()) {
      return;
    }
    // The lobby starts from the devices as the match left them (takeovers and lost controllers included).
    const liveSlots = this.versus.slots.map((slot) => ({ ...slot, device: slot.device ? { ...slot.device } : null }));
    this.leaveVersus();
    if (this.versusLocal) {
      this.versusLocal.slots = liveSlots;
    }
    this.openVersusTierPicker();
    this.openVersusLocalLobby({ keep: true });
  },

  recordVersusOutcome(outcome) {
    const delta = buildRunOutcomeDelta({ mode: GAME_MODES.VERSUS, outcome });
    if (delta) {
      this.storageManager.applyPlayerStatsDelta?.(delta);
    }
  },

  /** Escape and the controller's back button, while a versus layer is up. Returns true when it handled the press. */
  handleVersusBack() {
    if (this.handleVersusLocalLobbyBack?.()) {
      return true;
    }
    if (this.isVersusTierPickerOpen()) {
      this.closeVersusTierPicker();
      return true;
    }
    const v = this.versus;
    if (!v) {
      return false;
    }
    if (v.tutorial) {
      v.tutorial.close('skip');
      return true;
    }
    if (!this.elements.modalDuelResult.classList.contains(HIDDEN_CLASS)) {
      this.leaveVersus();
    } else if (!this.elements.modalDuelPause.classList.contains(HIDDEN_CLASS)) {
      this.resumeVersus();
    } else {
      this.pauseVersus();
    }
    return true;
  },

  // ---------------------------------------------------------------------------------------
  // End of the match
  // ---------------------------------------------------------------------------------------

  /** Stores the result (records and statistics) and shows the result card. */
  finishVersusMatch(event) {
    const v = this.versus;
    if (v.kind === VERSUS_KINDS.LOCAL) {
      this.finishLocalMatch(event);
      return;
    }
    const won = event.type === MATCH_EVENTS.MATCH_WON;
    this.storageManager.recordVersusResult?.(v.tier, won);
    this.recordVersusOutcome(won ? OUTCOME_WIN : OUTCOME_LOSS);
    const state = v.controller.getState();
    const playerStats = state.boards[PLAYER_BOARD].matchStats;
    v.result = {
      won,
      tier: v.tier,
      wins: [event.wins[PLAYER_BOARD], event.wins[CPU_BOARD]],
      neutralised: playerStats.neutralised,
      pulses: playerStats.pulsesSent
    };
    this.fillVersusResult(v.result);
    this.elements.versusResultShareFallback?.classList.add(HIDDEN_CLASS);
    setTextIfChanged(this.elements.btnVersusShare, t('modals.gameOver.button.share'));
    this.showVersusModal(this.elements.modalDuelResult, this.elements.btnVersusRematch);
  },

  /**
   * End of a match between two players: it is counted once (no winner stored, no statistics, no
   * quit) and the result card names the winner. The primary button ignores presses for a moment.
   */
  finishLocalMatch(event) {
    const v = this.versus;
    this.storageManager.recordVersusLocalMatch?.();
    const state = v.controller.getState();
    v.result = {
      kind: VERSUS_KINDS.LOCAL,
      winner: event.winner,
      wins: [...event.wins],
      players: state.boards.map((board) => ({
        neutralised: board.matchStats.neutralised,
        pulses: board.matchStats.pulsesSent
      }))
    };
    this.fillVersusResult(v.result);
    this.elements.versusResultShareFallback?.classList.add(HIDDEN_CLASS);
    this.showVersusModal(this.elements.modalDuelResult, this.elements.btnVersusRematch);
    this.armResultGuard(v);
  },

  /** The main button of the card stays inert for resultInputGuardMs, so a press meant for the match does not restart it. */
  armResultGuard(v) {
    const button = this.elements.btnVersusRematch;
    button?.setAttribute('aria-disabled', 'true');
    clearTimeout(v.resultGuardTimer);
    v.resultGuardTimer = setTimeout(() => {
      button?.removeAttribute('aria-disabled');
    }, this.gameConfig.versus.local.resultInputGuardMs);
    v.resultGuardTimer?.unref?.();
  },

  fillVersusResult(result) {
    const els = this.elements;
    const isLocal = result.kind === VERSUS_KINDS.LOCAL;
    els.versusResultTier?.classList.toggle(HIDDEN_CLASS, isLocal);
    els.versusResultNeutralisedB?.classList.toggle(HIDDEN_CLASS, !isLocal);
    els.versusResultPulsesB?.classList.toggle(HIDDEN_CLASS, !isLocal);
    els.btnVersusShare?.classList.toggle(HIDDEN_CLASS, isLocal);
    els.btnVersusChangePlayers?.classList.toggle(HIDDEN_CLASS, !isLocal);
    if (isLocal) {
      const [first, second] = result.players;
      setTextIfChanged(els.versusResultTitle, t('versus.local.result.title', { n: result.winner + FIRST_PLAYER_NUMBER }));
      setTextIfChanged(
        els.versusResultScore,
        t('versus.local.result.score', { a: formatNumber(result.wins[0]), b: formatNumber(result.wins[1]) })
      );
      setTextIfChanged(
        els.versusResultNeutralised,
        t('versus.local.result.neutralised', { n: 1, count: formatNumber(first.neutralised) })
      );
      setTextIfChanged(
        els.versusResultNeutralisedB,
        t('versus.local.result.neutralised', { n: 2, count: formatNumber(second.neutralised) })
      );
      setTextIfChanged(els.versusResultPulses, t('versus.local.result.pulses', { n: 1, count: formatNumber(first.pulses) }));
      setTextIfChanged(els.versusResultPulsesB, t('versus.local.result.pulses', { n: 2, count: formatNumber(second.pulses) }));
      return;
    }
    setTextIfChanged(els.versusResultTitle, t(result.won ? 'versus.result.wonTitle' : 'versus.result.lostTitle'));
    setTextIfChanged(
      els.versusResultScore,
      t('versus.result.score', { player: formatNumber(result.wins[0]), cpu: formatNumber(result.wins[1]) })
    );
    setTextIfChanged(els.versusResultTier, t('versus.result.tier', { tier: t(`versus.tier.${result.tier}`) }));
    setTextIfChanged(els.versusResultNeutralised, t('versus.result.neutralised', { count: formatNumber(result.neutralised) }));
    setTextIfChanged(els.versusResultPulses, t('versus.result.pulses', { count: formatNumber(result.pulses) }));
  },

  /** Share text of the finished match: the system sheet, the clipboard, or a field to copy from. */
  async shareVersusResult() {
    const result = this.versus?.result;
    if (!result || result.kind === VERSUS_KINDS.LOCAL || this.isSharing) {
      return;
    }
    this.isSharing = true;
    try {
      const shareConfig = this.gameConfig.share;
      const text = buildShareText(
        {
          mode: GAME_MODES.VERSUS,
          won: result.won,
          tier: t(`versus.tier.${result.tier}`),
          score: t('versus.result.score', { player: formatNumber(result.wins[0]), cpu: formatNumber(result.wins[1]) }),
          neutralised: result.neutralised,
          pulses: result.pulses,
          url: shareConfig.url
        },
        shareConfig
      );
      await this.deliverShareText(text, {
        onCopied: () => setTextIfChanged(this.elements.btnVersusShare, t('modals.gameOver.button.shareCopied')),
        showFallback: (fallbackText) => {
          const field = this.elements.versusResultShareText;
          this.elements.versusResultShareFallback?.classList.remove(HIDDEN_CLASS);
          if (field) {
            field.value = fallbackText;
            field.focus();
            field.select();
          }
        }
      });
    } finally {
      this.isSharing = false;
    }
  },

  // ---------------------------------------------------------------------------------------
  // Input: the scene controller the UI routes keyboard, pad and visibility changes to
  // ---------------------------------------------------------------------------------------

  /** True when the player's board takes controls now. */
  canControlVersusPlayer() {
    const v = this.versus;
    return Boolean(v) && v.phase === SCREEN_PHASES.PLAYING && !v.controller.isPaused() && !this.isAnyModalOpen();
  },

  /** Runs an action on the player's engine when the board takes controls, then repaints the controls. */
  versusPlayerAct(action) {
    this.versusBoardAct(PLAYER_BOARD, action);
  },

  /** Runs an action on one board's engine when the board takes controls, then repaints the controls. */
  versusBoardAct(board, action) {
    if (!this.canControlVersusPlayer()) {
      return;
    }
    action(this.versus.controller.engines[board]);
    this.versus.hudDirty = true;
    this.refreshVersusPlayerControls();
  },

  /** The same keys as a single player run, sent to the player's board. */
  handleVersusGameplayKey(e) {
    if (!this.canControlVersusPlayer()) {
      return;
    }
    const engine = this.versus.controller.engines[PLAYER_BOARD];
    const activeEl = document.activeElement;
    const isButtonFocused = Boolean(
      activeEl &&
        activeEl !== document.body &&
        typeof activeEl.matches === 'function' &&
        activeEl.matches(':focus-visible') &&
        typeof activeEl.closest === 'function' &&
        activeEl.closest('button, a, input, select, textarea, [role="button"], [role="tab"]')
    );
    const canvasCfg = this.gameConfig.canvas;
    if (e.code === 'Space') {
      if (!isButtonFocused) {
        e.preventDefault();
        engine.swapLauncherBalls();
      }
    } else if (e.code === 'KeyF') {
      e.preventDefault();
      engine.togglePolarityFlip();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const step = e.shiftKey ? canvasCfg.keyboardAimStepRad : canvasCfg.keyboardAimFineStepRad;
      engine.adjustAimByDelta((e.code === 'ArrowLeft' ? -1 : 1) * step);
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (!isButtonFocused) {
        e.preventDefault();
        engine.shoot();
      }
    } else if (e.code.startsWith('Digit')) {
      const index = Number.parseInt(e.code.replace('Digit', ''), 10) - 1;
      const type = SPECIAL_TYPES_ORDER[index];
      const isStocked = (engine.specialInventory?.[type] || 0) > 0 || engine.currentBall?.specialType === type;
      if (type && isStocked) {
        e.preventDefault();
        engine.equipSpecialBall(type);
      }
    }
    this.versus.hudDirty = true;
    this.refreshVersusPlayerControls();
  },

  /** Controller actions for the player's board; Start and Select pause both boards. */
  handleVersusGamepadActions(actions, aimDelta) {
    if (this.isVersusTutorialOpen()) {
      this.routeVersusTutorialActions(actions);
      return;
    }
    if (!this.canControlVersusPlayer()) {
      return;
    }
    const engine = this.versus.controller.engines[PLAYER_BOARD];
    // A stick resting slightly off centre must not steer the aim while the mouse or touch is in use.
    if (aimDelta !== 0 && this.inputMode === INPUT_MODES.GAMEPAD) {
      engine.adjustAimByDelta(aimDelta);
    }
    for (const action of actions) {
      switch (action) {
        case A.SHOOT:
          engine.shoot();
          break;
        case A.SWAP:
          engine.swapLauncherBalls();
          break;
        case A.POLARITY:
          engine.togglePolarityFlip();
          break;
        case A.UNEQUIP:
          if (engine.currentBall?.specialType) {
            engine.equipSpecialBall(engine.currentBall.specialType);
          }
          break;
        case A.SPECIAL_PREV:
          this.cycleSpecialBall(-1, engine);
          break;
        case A.SPECIAL_NEXT:
          this.cycleSpecialBall(1, engine);
          break;
        case A.PAUSE:
        case A.MENU:
          this.pauseVersus();
          return;
        case A.RECENTER:
          engine.adjustAimByDelta(-Math.PI * MATH_CONSTANTS.HALF - engine.aimAngle);
          break;
        default:
          break;
      }
    }
    this.versus.hudDirty = true;
    if (actions.length > 0) {
      this.refreshVersusPlayerControls();
    }
  },

  // ---------------------------------------------------------------------------------------
  // Two players on one device: keyboard halves, controllers, held aim
  // ---------------------------------------------------------------------------------------

  /**
   * What the UI routes input to during a local match. `multiPad` makes the controller reader
   * report every pad on its own (pollAll) instead of merging them.
   */
  createLocalSceneController() {
    const v = this.versus;
    return {
      multiPad: true,
      handleGameplayKey: (event) => this.handleLocalGameplayKey(event),
      handleGameplayKeyUp: (event) => v.kb.keyUp(event.code),
      releaseAllKeys: () => v.kb.releaseAll(),
      handlePadResults: (results) => this.handleLocalPadResults(results),
      beforeFrame: (now, elapsedMs) => this.applyLocalHeldAim(elapsedMs),
      handleGamepadActions: () => {},
      pause: () => this.pauseVersus()
    };
  },

  /** Board whose player uses this half of the keyboard, or -1. */
  localBoardForKeyboardSide(side) {
    return this.versus.slots.findIndex(
      (slot) =>
        (slot.device?.type === DEVICE_TYPES.KEYBOARD || slot.device?.type === DEVICE_TYPES.KEYBOARD_MOUSE) &&
        slot.device.side === side
    );
  },

  /**
   * One key of the split keyboard. Every key of the layout is kept from the page (Enter, the slash
   * quick find, the arrows scroll); any other key does nothing in a two-player match.
   */
  handleLocalGameplayKey(e) {
    const v = this.versus;
    if (!v || v.kind !== VERSUS_KINDS.LOCAL || !v.kb.isMapped(e.code)) {
      return;
    }
    e.preventDefault();
    const hit = v.kb.keyDown(e.code, e.repeat);
    if (!hit || !this.canControlVersusPlayer()) {
      return;
    }
    const board = this.localBoardForKeyboardSide(hit.side);
    if (board < 0) {
      return;
    }
    const engine = v.controller.engines[board];
    switch (hit.action) {
      case 'shoot':
        engine.shoot();
        break;
      case 'swap':
        engine.swapLauncherBalls();
        break;
      case 'polarity':
        engine.togglePolarityFlip();
        break;
      case 'special':
        this.cycleSpecialBall(1, engine);
        break;
      default:
        break;
    }
    v.hudDirty = true;
    this.refreshVersusPlayerControls();
  },

  /** Aim from the keys held down, read every frame (the OS repeats only the last key pressed). */
  applyLocalHeldAim(elapsedMs) {
    const v = this.versus;
    if (!v || v.kind !== VERSUS_KINDS.LOCAL || !this.canControlVersusPlayer()) {
      return;
    }
    for (const side of SIDES) {
      const delta = v.kb.aimDelta(side, elapsedMs);
      const board = delta === 0 ? -1 : this.localBoardForKeyboardSide(side);
      if (board >= 0) {
        v.controller.engines[board].adjustAimByDelta(delta);
      }
    }
  },

  /** Actions of every controller during play: each steers only the board of its own slot. */
  handleLocalPadResults(results) {
    const v = this.versus;
    if (!v || v.kind !== VERSUS_KINDS.LOCAL) {
      return;
    }
    for (const pad of results.pads) {
      const board = slotForPad(v.slots, pad.padIndex);
      if (board < 0) {
        continue;
      }
      if (this.isVersusTutorialOpen()) {
        this.routeVersusTutorialActions(pad.actions);
        continue;
      }
      if (pad.actions.includes(A.PAUSE) || pad.actions.includes(A.MENU)) {
        this.pauseVersus();
        return;
      }
      if (!this.canControlVersusPlayer()) {
        continue;
      }
      const engine = v.controller.engines[board];
      if (pad.aimDelta !== 0) {
        engine.adjustAimByDelta(pad.aimDelta);
      }
      for (const action of pad.actions) {
        switch (action) {
          case A.SHOOT:
            engine.shoot();
            break;
          case A.SWAP:
            engine.swapLauncherBalls();
            break;
          case A.POLARITY:
            engine.togglePolarityFlip();
            break;
          case A.UNEQUIP:
            if (engine.currentBall?.specialType) {
              engine.equipSpecialBall(engine.currentBall.specialType);
            }
            break;
          case A.SPECIAL_PREV:
            this.cycleSpecialBall(-1, engine);
            break;
          case A.SPECIAL_NEXT:
            this.cycleSpecialBall(1, engine);
            break;
          case A.RECENTER:
            engine.adjustAimByDelta(-Math.PI * MATH_CONSTANTS.HALF - engine.aimAngle);
            break;
          default:
            break;
        }
      }
      v.hudDirty = true;
    }
    this.refreshVersusPlayerControls();
  },

  /** Slots of the two-player lobby or match, whichever is up, or null. */
  getVersusLocalSlots() {
    if (this.isLocalVersus()) {
      return this.versus.slots;
    }
    return this.isVersusLocalLobbyOpen?.() ? this.versusLocal.slots : null;
  },

  /**
   * A controller appeared or went away. In the lobby a lost pad frees its slot. In a match a lost
   * pad pauses it (Resume stays out of reach); a pad that comes back at the same index is trusted again.
   * @param {{type: string, padIndex: number, id: string}} event - From GamepadInput.pollAll.
   */
  handleLocalPadEvent(event) {
    if (this.isVersusLocalLobbyOpen?.() && event.type === GAMEPAD_EVENTS.DISCONNECTED) {
      this.handleVersusLocalLobbyPadLost(event.padIndex);
      return;
    }
    const v = this.versus;
    if (!v || v.kind !== VERSUS_KINDS.LOCAL) {
      return;
    }
    const slotIndex = slotForPad(v.slots, event.padIndex);
    if (slotIndex < 0) {
      return;
    }
    if (event.type === GAMEPAD_EVENTS.DISCONNECTED) {
      v.slots = markPadLost(v.slots, event.padIndex);
      this.announce(t('versus.local.announce.padLost', { n: slotIndex + FIRST_PLAYER_NUMBER }));
      this.pauseVersus();
    } else if (event.type === GAMEPAD_EVENTS.CONNECTED && v.slots[slotIndex].padLost) {
      v.slots = v.slots.map((slot, i) => (i === slotIndex ? { ...slot, padLost: false } : slot));
    }
    this.syncLocalPauseGuards();
  },

  /** An unassigned controller pressed its bottom button while a player's controller is missing: it takes over. */
  takeOverLostPad(padIndex, id) {
    const v = this.versus;
    if (!v || v.kind !== VERSUS_KINDS.LOCAL || !v.slots.some((slot) => slot.padLost)) {
      return false;
    }
    const next = assignPad(v.slots, padIndex, id);
    if (next === v.slots) {
      return false;
    }
    v.slots = next;
    const slotIndex = slotForPad(next, padIndex);
    this.announce(
      t('versus.local.announce.joined', { n: slotIndex + FIRST_PLAYER_NUMBER, device: describeLocalDevice(next[slotIndex].device) })
    );
    this.syncLocalPauseGuards();
    return true;
  },

  /** Text of the arcade card of the level select: the player's overall record against the CPU. */
  refreshVersusCard() {
    const records = this.storageManager.getVersusRecords?.() ?? {};
    const totals = Object.values(records).reduce(
      (sum, entry) => ({ wins: sum.wins + entry.w, losses: sum.losses + entry.l }),
      { wins: 0, losses: 0 }
    );
    setTextIfChanged(
      this.elements.arcadeBestVersus,
      t('versus.card.best', { wins: formatNumber(totals.wins), losses: formatNumber(totals.losses) })
    );
  }
};
