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
import { GAMEPAD_ACTIONS } from '../core/GamepadInput.js';
import { t, formatNumber } from '../core/I18n.js';
import { buildShareText } from '../game/DailyShare.js';
import { buildRunOutcomeDelta } from '../game/PlayerStats.js';
import { Renderer } from '../game/Renderer.js';
import { MATCH_EVENTS, createVersusMatch } from '../game/VersusMatch.js';
import { bindCanvasInput } from './CanvasInput.js';
import { UI_SCENES } from './UIInputBindings.js';
import { revealLiveRegion, scheduleNextFrame, setTextIfChanged } from './UIHelpers.js';
import {
  VERSUS_LAYOUTS,
  VERSUS_ORIENTATIONS,
  VersusHud,
  chooseVersusLayout,
  collectVersusHudElements,
  computeMiniSize,
  createAnnouncementQueue,
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
    els.btnVersusRematch?.addEventListener('click', () => this.restartVersus());
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
   * Opens the versus screen against a CPU tier. The current run is held paused (its snapshot is
   * stored) and comes back paused when the screen closes.
   * @param {string} tier - A tier of versus.cpu.
   */
  enterVersus(tier) {
    if (this.versus || !this.versusConfigs || !this.elements.versusScreen) {
      return;
    }
    this.hideAllModals();
    if (this.engine.state === GAME_STATES.PLAYING || this.engine.state === GAME_STATES.PAUSED) {
      this.engine.state = GAME_STATES.PAUSED;
      this.autoPausedByOverlay = true;
      this.engine.saveRunSnapshot?.();
    }
    this.storageManager.ensureModeUnlocked?.(GAME_MODES.VERSUS);

    const uiCfg = this.gameConfig.versus.ui;
    const hud = new VersusHud(collectVersusHudElements(document));
    const v = {
      tier,
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
      queue: createAnnouncementQueue({
        windowFrames: uiCfg.announceWindowFrames,
        suddenDeathSeconds: this.gameConfig.versus.suddenDeath.intervalSeconds,
        playerBoard: PLAYER_BOARD
      }),
      unbindInput: null,
      unsubscribe: null,
      onResize: null
    };
    // The screen is live before the first round starts so the announcement of round 1 is received.
    this.versus = v;
    try {
      v.controller = createVersusMatch({
        seed: this.createVersusSeed(),
        mode: 'cpu',
        playerBoard: PLAYER_BOARD,
        cpuTier: tier,
        configs: this.versusConfigs,
        storageManager: this.storageManager,
        audioManager: this.audioManager,
        autoAdvance: true,
        onBoardChange: () => {
          v.hudDirty = true;
        },
        onEvent: (event) => this.handleVersusEvent(event)
      });
    } catch (error) {
      this.versus = null;
      throw error;
    }

    this.elements.versusScreen.classList.remove(HIDDEN_CLASS);
    this.syncModalInertState();
    hud.refreshLabels();
    this.layoutVersus();
    v.unbindInput = bindCanvasInput(this.elements.versusCanvas0, () => v.controller.engines[PLAYER_BOARD], this.gameConfig, {
      isBlocked: () => this.isAnyModalOpen() || v.controller.isPaused() || v.phase !== SCREEN_PHASES.PLAYING
    }).unbind;
    v.onResize = () => this.scheduleVersusLayout();
    for (const type of ['resize', 'orientationchange']) {
      window.addEventListener(type, v.onResize);
    }
    this.setActiveScene(UI_SCENES.VERSUS, this.versusSceneController);
    this.refreshVersusHud();
    this.elements.versusCanvas0.focus();
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
    screen.dataset.layout = choice.layout;

    const isMini = choice.layout === VERSUS_LAYOUTS.MINI;
    const wraps = [els.versusCanvas0.parentElement, els.versusCanvas1.parentElement];
    if (!isMini) {
      const cpuFit = fitBoard(wraps[CPU_BOARD].clientWidth, wraps[CPU_BOARD].clientHeight, canvasCfg);
      const playerFit = fitBoard(wraps[PLAYER_BOARD].clientWidth, wraps[PLAYER_BOARD].clientHeight, canvasCfg);
      // Both boards are drawn at the size of the smaller fit, so they line up.
      const size = cpuFit.width < playerFit.width ? cpuFit : playerFit;
      this.sizeVersusCanvas(els.versusCanvas0, size);
      this.sizeVersusCanvas(els.versusCanvas1, size);
    } else {
      this.layoutVersusMini(isLandscape, style);
    }

    const previous = v.layout;
    v.layout = choice.layout;
    const needsCpuRenderer = !v.renderers[CPU_BOARD] || previous !== choice.layout;
    if (!v.renderers[PLAYER_BOARD] || needsCpuRenderer) {
      this.buildVersusRenderers(isMini);
    }
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
    const columnRoom = isLandscape ? boardsBox.clientHeight - els.versusHud1.offsetHeight - rowGap : Infinity;
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

  /** Repaints the bar and both HUDs from the match state. */
  refreshVersusHud() {
    const v = this.versus;
    if (!v) {
      return;
    }
    v.sinceRefresh = 0;
    v.hudDirty = false;
    const state = v.controller.getState();
    const cpuTierName = t(`versus.tier.${v.tier}`);
    v.hud.refresh(state, { cpuTierName });
    const changed = v.hud.refreshPlayerControls(v.controller.engines[PLAYER_BOARD], {
      types: SPECIAL_TYPES_ORDER,
      specs: this.ballsConfig.specialTypes,
      describe: (type, count) => this.getPowerupAriaLabel(type, count),
      onPick: (type) => this.versusPlayerAct((engine) => engine.equipSpecialBall(type))
    });
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
    switch (event.type) {
      case MATCH_EVENTS.ROUND_START:
        v.phase = SCREEN_PHASES.PLAYING;
        this.elements.versusRoundOverlay.classList.add(HIDDEN_CLASS);
        break;
      case MATCH_EVENTS.ROUND_WON:
      case MATCH_EVENTS.ROUND_LOST:
      case MATCH_EVENTS.ROUND_REPLAY:
        v.phase = SCREEN_PHASES.ROUND_OVER;
        this.showVersusRoundOverlay(event.type);
        break;
      case MATCH_EVENTS.MATCH_WON:
      case MATCH_EVENTS.MATCH_LOST:
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

  /** A short overlay with the result of the round, until the next round starts by itself. */
  showVersusRoundOverlay(type) {
    const keys = {
      [MATCH_EVENTS.ROUND_WON]: 'versus.announce.roundWon',
      [MATCH_EVENTS.ROUND_LOST]: 'versus.announce.roundLost',
      [MATCH_EVENTS.ROUND_REPLAY]: 'versus.announce.roundDraw'
    };
    const overlay = this.elements.versusRoundOverlay;
    overlay.textContent = t(keys[type]);
    overlay.classList.remove(HIDDEN_CLASS);
  },

  // ---------------------------------------------------------------------------------------
  // Pause, restart, quit
  // ---------------------------------------------------------------------------------------

  /** Opens a versus dialog: focus goes into it and comes back to the board when it closes. */
  showVersusModal(modal, focusTarget) {
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
    if (!v || v.phase === SCREEN_PHASES.MATCH_OVER || this.isAnyModalOpen()) {
      return;
    }
    v.controller.pause();
    v.hudDirty = true;
    this.showVersusModal(this.elements.modalDuelPause, this.elements.btnVersusResume);
  },

  resumeVersus() {
    const v = this.versus;
    if (!v) {
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
    // Restarting a match that was started and not finished abandons it, like Quit does.
    if (!v.result && v.controller.getState().frame > 0) {
      this.recordVersusOutcome(OUTCOME_QUIT);
    }
    this.hideVersusModal(this.elements.modalDuelPause);
    this.hideVersusModal(this.elements.modalDuelResult);
    this.elements.versusResultShareFallback?.classList.add(HIDDEN_CLASS);
    v.result = null;
    v.phase = SCREEN_PHASES.PLAYING;
    v.clock = 0;
    v.queue = createAnnouncementQueue({
      windowFrames: this.gameConfig.versus.ui.announceWindowFrames,
      suddenDeathSeconds: this.gameConfig.versus.suddenDeath.intervalSeconds,
      playerBoard: PLAYER_BOARD
    });
    this.elements.versusRoundOverlay.classList.add(HIDDEN_CLASS);
    v.controller.restart(this.createVersusSeed());
    v.hudDirty = true;
    this.refreshVersusHud();
    this.elements.versusCanvas0.focus();
  },

  /** Leaves a match that was not finished: it counts as a quit in the statistics. */
  quitVersus() {
    this.recordVersusOutcome(OUTCOME_QUIT);
    this.leaveVersus();
  },

  recordVersusOutcome(outcome) {
    const delta = buildRunOutcomeDelta({ mode: GAME_MODES.VERSUS, outcome });
    if (delta) {
      this.storageManager.applyPlayerStatsDelta?.(delta);
    }
  },

  /** Escape and the controller's back button, while a versus layer is up. Returns true when it handled the press. */
  handleVersusBack() {
    if (this.isVersusTierPickerOpen()) {
      this.closeVersusTierPicker();
      return true;
    }
    const v = this.versus;
    if (!v) {
      return false;
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

  fillVersusResult(result) {
    const els = this.elements;
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
    if (!result || this.isSharing) {
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
    if (!this.canControlVersusPlayer()) {
      return;
    }
    action(this.versus.controller.engines[PLAYER_BOARD]);
    this.versus.hudDirty = true;
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
  },

  /** Controller actions for the player's board; Start and Select pause both boards. */
  handleVersusGamepadActions(actions, aimDelta) {
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
