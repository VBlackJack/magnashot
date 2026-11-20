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
import { SeededRandom } from '../core/SeededRandom.js';
import { resolveDailyPuzzleStage } from './PlayHubView.js';
import { SHOP_TABS } from './WorkshopView.js';
import { fluxPerkIndexForKey } from './FluxPerkView.js';
import {
  ARCADE_CARD_SPECS,
  inputModeForPointerType,
  isPortraitAdaptiveViewport,
  shouldIgnoreRepeatedKey,
  isBrowserShortcut,
  resolveNextCampaignTarget,
  setPowerupsDrawerOpen,
  syncAdaptiveCanvasHeight,
  syncFluxSeedValidationError,
  togglePowerupsDrawer,
  WEEKLY_ACCESS_KEY
} from './UIHelpers.js';
import { CONTINUE_KINDS, PLAY_HUB_DISCLOSURES } from './PlayHubView.js';
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

const GRID_EDGE_OR_PAGE_ACTIONS = Object.freeze({
  Home: (ui) => selectEdgeLevelTile(ui, true),
  End: (ui) => selectEdgeLevelTile(ui, false),
  PageUp: (ui) => ui.stepLevelChapter(-CHAPTER_STEP, { focus: true }),
  PageDown: (ui) => ui.stepLevelChapter(CHAPTER_STEP, { focus: true })
});

function selectEdgeLevelTile(ui, isFirst) {
  const tiles = Array.from(ui.elements.levelsGrid.children).filter((child) => child.dataset?.levelId !== undefined);
  const edge = isFirst ? tiles[0] : tiles.at(-1);
  if (edge) {
    ui.selectLevelTile(Number(edge.dataset.levelId), { focus: true });
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
  const edgeOrPage = GRID_EDGE_OR_PAGE_ACTIONS[event.key];
  if (edgeOrPage) {
    event.preventDefault();
    edgeOrPage(ui);
    return;
  }
  if (event.key === 'Enter' || event.key === 'NumpadEnter') {
    // Enter plays; swallowing it keeps the button from also firing a click.
    event.preventDefault();
    const levelId = Number(tile.dataset.levelId);
    if (levelId !== ui.levelsSelectedId) {
      ui.selectLevelTile(levelId);
    }
    ui.playSelectedLevel();
  }
}

function canModeProgressBountyEvent(mode, eventKey) {
  if (eventKey === 'match_group_cleared') {
    return mode !== GAME_MODES.MERGE && mode !== GAME_MODES.PINBALL;
  }
  if (eventKey === 'avalanche_balls') {
    return mode !== GAME_MODES.MERGE && mode !== GAME_MODES.PINBALL && mode !== GAME_MODES.CONVOY;
  }
  if (eventKey === 'overcharge_full') {
    return mode !== GAME_MODES.MERGE && mode !== GAME_MODES.CLASSIC;
  }
  return true;
}

function activateBountyWithFallback(ui, fallbackAction) {
  const target = ui.getPlayHubContinueTarget();
  if (target.kind !== CONTINUE_KINDS.MAP) {
    ui.activatePlayHubContinue();
    return;
  }
  fallbackAction();
}

function triggerFreeBountyRun(ui, eventKey) {
  const isPlayableState = ui.engine.state === GAME_STATES.PLAYING || ui.engine.state === GAME_STATES.PAUSED;
  if (!ui.isVersusActive?.() && isPlayableState && canModeProgressBountyEvent(ui.engine.mode, eventKey)) {
    ui.resumePlayHubRun();
    return;
  }
  activateBountyWithFallback(ui, () => ui.elements.btnEndless?.click());
}

function handleBountyButtonClick(ui, e) {
  const btn = e.target?.closest?.('.play-bounty-btn');
  if (!btn || btn.disabled) {
    return;
  }
  const mode = btn.dataset.bountyMode || '';
  if (!mode) {
    triggerFreeBountyRun(ui, btn.dataset.bountyEvent || '');
    return;
  }
  if (mode === GAME_MODES.CAMPAIGN) {
    activateBountyWithFallback(ui, () => {
      const fallbackLevel = ui.getSuggestedLevelId();
      ui.requestDestructiveAction(() => {
        ui.hideAllModals();
        ui.engine.startCampaignLevel(fallbackLevel);
      }, () => t('modals.play.campaign.continue', { level: fallbackLevel }));
    });
    return;
  }
  const cardKey = mode === GAME_MODES.DAILY ? 'btnDaily' : ARCADE_CARD_SPECS[mode]?.card;
  if (cardKey) {
    ui.elements[cardKey]?.click();
  }
}

/** Play hub: open and close, Campaign card, disclosures, bounties and the two-player entry. */
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
  els.playBountiesList?.addEventListener('click', (e) => handleBountyButtonClick(ui, e));
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

const MODE_CARD_BINDINGS = Object.freeze([
  ['btnEndless', GAME_MODES.ENDLESS, GAME_MODES.ENDLESS, 'app.nav.button.endless', (ui) => ui.engine.startEndlessMode()],
  ['btnDaily', GAME_MODES.DAILY, null, 'app.nav.button.daily', (ui) => ui.engine.startDailyChallenge()],
  ['btnFlux', GAME_MODES.FLUX, GAME_MODES.FLUX, 'app.nav.button.flux', (ui) => ui.engine.startFluxRun()],
  ['btnWeekly', WEEKLY_ACCESS_KEY, WEEKLY_ACCESS_KEY, 'app.nav.button.weekly', (ui) => ui.startWeeklyFluxRun()],
  ['btnModePuzzle', GAME_MODES.PUZZLE, GAME_MODES.PUZZLE, 'modals.levelSelect.arcade.puzzle', (ui) => ui.engine.startPuzzleMode(ui.getSuggestedPuzzleStage())],
  ['btnModeBlitz', GAME_MODES.BLITZ, GAME_MODES.BLITZ, 'modals.levelSelect.arcade.blitz', (ui) => ui.engine.startBlitzMode()],
  ['btnModeBossRush', GAME_MODES.BOSS_RUSH, GAME_MODES.BOSS_RUSH, 'modals.levelSelect.arcade.bossRush', (ui) => ui.engine.startBossRushMode()],
  ['btnModeCascade', GAME_MODES.CASCADE, GAME_MODES.CASCADE, 'modals.levelSelect.arcade.cascade', (ui) => ui.engine.startCascadeMode()],
  ['btnModeHexGrid', GAME_MODES.HEX_GRID, GAME_MODES.HEX_GRID, 'modals.levelSelect.arcade.hexGrid', (ui) => ui.engine.startHexGridMode()],
  ['btnModePinball', GAME_MODES.PINBALL, GAME_MODES.PINBALL, 'modals.levelSelect.arcade.pinball', (ui) => ui.engine.startPinballMode()],
  ['btnModeOrbital', GAME_MODES.ORBITAL, GAME_MODES.ORBITAL, 'modals.levelSelect.arcade.orbital', (ui) => ui.engine.startOrbitalMode()],
  ['btnModeConvoy', GAME_MODES.CONVOY, GAME_MODES.CONVOY, 'modals.levelSelect.arcade.convoy', (ui) => ui.engine.startConvoyMode()],
  ['btnModeMerge', GAME_MODES.MERGE, GAME_MODES.MERGE, 'modals.levelSelect.arcade.merge', (ui) => ui.engine.startMergeMode()],
  ['btnModeSlingshot', GAME_MODES.SLINGSHOT, GAME_MODES.SLINGSHOT, 'modals.levelSelect.arcade.slingshot', (ui) => ui.engine.startSlingshotMode()]
]);

const OVERLAY_DISMISS_KEYS = ['modalPlay', 'modalLevels', 'modalShop', 'modalSettings', 'modalStats'];

/** @this {import('./UIManager.js').UIManager} */
function bindAllModeCards() {
  bindModeCard(this, this.elements.btnModeClassic, {
    modeKey: GAME_MODES.CLASSIC,
    accessKey: GAME_MODES.CLASSIC,
    labelKey: 'modals.levelSelect.arcade.classic',
    start: () => this.engine.startClassicMode()
  });
  for (const [elementKey, modeKey, accessKey, labelKey, start] of MODE_CARD_BINDINGS) {
    bindModeCard(this, this.elements[elementKey], {
      modeKey,
      accessKey,
      labelKey,
      start: () => start(this)
    });
  }
}

function openSettingsWithRefresh(ui) {
  ui.syncInstallControls();
  ui.progressBackup?.refresh();
  ui.openOverlayModal(ui.elements.modalSettings, ui.elements.btnCloseSettings);
}

function bindPreferenceToggles(ui) {
  const els = ui.elements;
  els.btnSound.addEventListener('click', () => {
    const nextMuted = !ui.audioManager.isMuted();
    ui.audioManager.setMuted(nextMuted);
    ui.storageManager.setMuted(nextMuted);
    ui.updateSoundButton();
  });
  els.btnContrast?.addEventListener('click', () => {
    const nextContrast = !ui.storageManager.getHighContrast();
    ui.storageManager.setHighContrast(nextContrast);
    ui.renderer?.setHighContrast(nextContrast);
    ui.updateContrastButton();
  });
  els.btnPatterns?.addEventListener('click', () => {
    const nextPatterns = !ui.storageManager.getColorPatterns();
    ui.storageManager.setColorPatterns(nextPatterns);
    ui.renderer?.setColorPatterns(nextPatterns);
    ui.updatePatternsButton();
  });
  els.btnMotion?.addEventListener('click', () => {
    const nextReduced = !ui.storageManager.getReducedMotion();
    ui.storageManager.setReducedMotion(nextReduced);
    if (ui.engine && typeof ui.engine.setReducedMotion === 'function') {
      ui.engine.setReducedMotion(nextReduced);
    }
    if (ui.audioManager && typeof ui.audioManager.setReducedMotion === 'function') {
      ui.audioManager.setReducedMotion(nextReduced);
    }
    ui.updateMotionButton();
  });
  els.btnAnimSpeed?.addEventListener('click', () => {
    ui.cycleAnimationSpeed();
  });
  els.btnLang.addEventListener('click', () => {
    const supported = ui.gameConfig.defaults.supportedLanguages;
    const current = i18n.getLocale();
    const nextLang = supported[(supported.indexOf(current) + 1) % supported.length];
    i18n.setLocale(nextLang);
    ui.storageManager.setLanguage(nextLang);
  });
}

function bindHeaderAndShellControls(ui) {
  const els = ui.elements;
  els.btnStats?.addEventListener('click', () => ui.openStatsModal(STATS_TABS.OVERVIEW));
  els.btnDailyHistoryGameOver?.addEventListener('click', () => ui.openStatsModal(STATS_TABS.DAILY));
  ui.bindStatsEvents();

  els.btnShop.addEventListener('click', () => ui.openShopModal());
  els.btnSettings?.addEventListener('click', () => openSettingsWithRefresh(ui));
  els.quotaBadge?.addEventListener('click', () => openSettingsWithRefresh(ui));
  els.btnCloseSettings?.addEventListener('click', () => ui.closeOverlayModal(els.modalSettings));

  els.btnRestart.addEventListener('click', () => {
    ui.requestDestructiveAction(
      () => {
        ui.hideAllModals();
        ui.engine.restartCurrent();
      },
      () => t('app.nav.button.restart')
    );
  });

  els.btnPause.addEventListener('click', () => {
    // From the menu, the run is held by the menu pause: turn it into a regular pause so the Pause dialog opens.
    if (ui.autoPausedByOverlay && ui.engine.state === GAME_STATES.PAUSED) {
      ui.autoPausedByOverlay = false;
      ui.engine.state = GAME_STATES.PLAYING;
    }
    ui.engine.togglePause();
  });

  bindPreferenceToggles(ui);
  document.addEventListener('visibilitychange', () => {
    ui.handleVisibilityChange();
    ui.syncMergeShakeGesture?.();
  });
}

function bindPlayHubToolbar(ui) {
  const filterBar = typeof document !== 'undefined' ? document.getElementById?.('play-hub-filters') : null;
  filterBar?.addEventListener('click', (e) => {
    const chip = e.target?.closest?.('[data-arcade-filter]');
    if (!chip) {
      return;
    }
    ui.playHubFilter = chip.dataset.arcadeFilter;
    ui.refreshPlayHubRecords?.();
  });
  const smartPickBtn = typeof document !== 'undefined' ? document.getElementById?.('btn-play-next-unmastered') : null;
  smartPickBtn?.addEventListener('click', () => {
    const mode = smartPickBtn.dataset.targetMode;
    const cardKey = mode ? ARCADE_CARD_SPECS[mode]?.card : null;
    if (cardKey && ui.elements?.[cardKey]) {
      ui.elements[cardKey].click();
    }
  });
  const dailyPuzzleBtn = typeof document !== 'undefined' ? document.getElementById?.('btn-daily-puzzle') : null;
  dailyPuzzleBtn?.addEventListener('click', () => {
    const stage = resolveDailyPuzzleStage(SeededRandom.getTodayDateKey(), ui.gameConfig?.puzzles?.length || 1);
    ui.requestDestructiveAction(
      () => {
        ui.hideAllModals();
        ui.engine.startPuzzleMode(stage);
      },
      () => t('modals.play.dailyPuzzle.title')
    );
  });
}

function bindLauncherAndHintControls(ui) {
  const els = ui.elements;
  els.swapBtn.addEventListener('click', () => ui.engine.swapLauncherBalls());
  els.polarityBtn?.addEventListener('click', () => ui.engine.togglePolarityFlip());
  els.mergeShakeBtn?.addEventListener('click', () => ui.tryMergeShake());
  els.btnPowerupsDrawer?.addEventListener('click', () => togglePowerupsDrawer(ui));
  els.hintReplayBtn?.addEventListener('click', () => ui.engine.replayLevelHints?.());
  els.btnDismissLevelIntro?.addEventListener('click', () => ui.engine.dismissLevelIntro?.());
  els.btnResetHints?.addEventListener('click', () => {
    ui.engine.resetDiscoveries();
    ui.hintsResetConfirmed = true;
    ui.updateResetHintsFeedback();
    ui.announce(t('hud.announcer.hints.reset'));
  });
  els.btnDismissTutorial?.addEventListener('click', () => ui.engine.dismissDiscovery());
  els.btnFluxSeedGo?.addEventListener('click', () => ui.submitFluxSeedInput());
  els.inputFluxSeed?.addEventListener('input', () => {
    syncFluxSeedValidationError(els);
  });
  els.inputFluxSeed?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      ui.submitFluxSeedInput();
    }
  });
  els.modeBanner?.addEventListener('click', () => ui.openPlayHub());
  els.modeBanner?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ui.openPlayHub();
    }
  });
  bindPlayHubToolbar(ui);
}

function bindShopTabs(ui) {
  const shopTabs = ui.getShopTabs();
  for (let i = 0; i < shopTabs.length; i++) {
    const { name, el } = shopTabs[i];
    el.addEventListener('click', () => ui.switchShopTab(name));
    el.addEventListener('keydown', (e) => {
      let nextIdx = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        nextIdx = (i + dir + shopTabs.length) % shopTabs.length;
      } else if (e.key === 'Home') {
        nextIdx = 0;
      } else if (e.key === 'End') {
        nextIdx = shopTabs.length - 1;
      }
      if (nextIdx >= 0) {
        e.preventDefault();
        ui.switchShopTab(shopTabs[nextIdx].name);
        shopTabs[nextIdx].el.focus();
      }
    });
  }
}

function bindBackdropDismiss(modalEl, onDismiss) {
  modalEl?.addEventListener('click', (e) => {
    if (e.target === modalEl) {
      onDismiss();
    }
  });
}

function bindModalAndConfirmControls(ui) {
  const els = ui.elements;
  if (els.btnConfirmYes && els.btnConfirmNo) {
    els.btnConfirmYes.addEventListener('click', () => {
      const cb = ui.pendingConfirmCallback;
      ui.pendingConfirmCallback = null;
      ui.pendingConfirmLabelResolver = null;
      ui.pendingConfirmCopy = null;
      ui.confirmPausedRun = false;
      ui.updateConfirmButtonLabel?.();
      els.modalConfirm.classList.add('hidden');
      if (cb) {
        cb();
      }
    });
    els.btnConfirmNo.addEventListener('click', () => ui.dismissConfirm());
  }

  for (const key of OVERLAY_DISMISS_KEYS) {
    bindBackdropDismiss(els[key], () => ui.closeOverlayModal(els[key]));
  }
  bindBackdropDismiss(els.modalPause, () => {
    if (ui.engine.state === GAME_STATES.PAUSED) {
      ui.engine.togglePause();
    }
  });
  bindBackdropDismiss(els.modalConfirm, () => ui.dismissConfirm());
}

function handleNextLevelClick(ui) {
  ui.hideAllModals();
  if (ui.engine.mode === GAME_MODES.PUZZLE) {
    const totalPuzzles = ui.gameConfig.puzzles?.length || 0;
    if (ui.engine.currentPuzzleStage < totalPuzzles) {
      ui.engine.startPuzzleMode(ui.engine.currentPuzzleStage + 1);
    } else {
      ui.openPlayHub({ expand: 'puzzle' });
    }
    return;
  }
  const { targetLevelId } = resolveNextCampaignTarget(
    ui.engine.currentLevelId,
    ui.engine.levelCatalog,
    ui.getVictoryTargetOptions()
  );
  if (targetLevelId !== null) {
    ui.engine.startCampaignLevel(targetLevelId);
  } else {
    // The last level is behind: the level select opens on its chapter.
    ui.openLevelsModal();
  }
}

function bindRoundFlowControls(ui) {
  const els = ui.elements;
  els.btnCloseShop.addEventListener('click', () => ui.closeOverlayModal(els.modalShop));
  els.btnPlayLevelModal.addEventListener('click', () => ui.playSelectedLevel());
  els.btnNextLevel.addEventListener('click', () => handleNextLevelClick(ui));
  els.btnReplayVictory.addEventListener('click', () => {
    ui.hideAllModals();
    ui.engine.restartCurrent();
  });
  els.btnLevelsVictory.addEventListener('click', () => {
    const mode = ui.engine.mode;
    ui.hideAllModals();
    if (mode === GAME_MODES.CAMPAIGN) {
      ui.openLevelsModal();
    } else {
      ui.openPlayHub({ expand: mode === GAME_MODES.PUZZLE ? 'puzzle' : undefined });
    }
  });
  els.btnContinueGameOver?.addEventListener('click', () => {
    if (ui.engine.continueOutOfShots()) {
      ui.hideAllModals();
      ui.refresh(ui.engine, ui.lastExtra);
    }
  });
  els.btnRetry.addEventListener('click', () => {
    ui.hideAllModals();
    ui.engine.restartCurrent();
  });
  els.btnSameSeedGameOver?.addEventListener('click', () => ui.retrySameFluxSeed());
  els.btnLevelsGameOver.addEventListener('click', () => {
    ui.hideAllModals();
    ui.openPlayHub();
  });
  els.btnShareGameOver?.addEventListener('click', () => ui.shareRunResult());
  els.btnResume.addEventListener('click', () => ui.engine.togglePause());
  els.fluxPerkCards?.addEventListener('click', (e) => {
    const card = e.target.closest?.('[data-perk-id]');
    if (card) {
      ui.engine.chooseFluxPerk(card.dataset.perkId);
    }
  });
  els.btnRestartPause.addEventListener('click', () => {
    ui.requestDestructiveAction(
      () => {
        ui.hideAllModals();
        ui.engine.restartCurrent();
      },
      () => t('app.nav.button.restart')
    );
  });
  els.btnLevelsPause?.addEventListener('click', () => {
    ui.openPlayHub();
    els.modalPause.classList.add('hidden');
    ui.syncModalInertState();
  });
  els.btnSettingsPause?.addEventListener('click', () => {
    openSettingsWithRefresh(ui);
    els.modalPause.classList.add('hidden');
    ui.syncModalInertState();
  });
}

function bindGlobalWindowListeners(ui) {
  const els = ui.elements;
  // Capture phase: the mode must switch even when a handler below stops the event.
  window.addEventListener(
    'pointerdown',
    (e) => {
      ui.setInputMode(inputModeForPointerType(e.pointerType));
      if (
        ui.isPowerupsDrawerOpen
        && !els.powerupsPanel?.contains(e.target)
        && !els.launcherControlsDock?.contains(e.target)
        && !els.btnPowerupsDrawer?.contains(e.target)
      ) {
        setPowerupsDrawerOpen(ui, false);
        e.stopPropagation();
      }
    },
    { capture: true }
  );
  // A window that shrinks or turns while the hub is open may no longer fit two boards.
  for (const type of ['resize', 'orientationchange']) {
    window.addEventListener(type, () => {
      if (ui.isPowerupsDrawerOpen && !isPortraitAdaptiveViewport(ui)) {
        setPowerupsDrawerOpen(ui, false);
      }
      syncAdaptiveCanvasHeight(ui);
      if (ui.isPlayHubOpen()) {
        ui.syncPlayHubVersusLocal();
      }
    });
  }
  if (typeof ResizeObserver === 'function' && els.stageContainer) {
    ui.stageResizeObserver = new ResizeObserver(() => syncAdaptiveCanvasHeight(ui));
    ui.stageResizeObserver.observe(els.stageContainer);
  }
  window.addEventListener('keydown', (e) => ui.handleKeyDown(e));
  window.addEventListener('keyup', (e) => ui.handleKeyUp(e));
  window.addEventListener('blur', () => ui.handleWindowBlur());
}

function isKeyboardInteractiveElementFocused() {
  const activeEl = document.activeElement;
  return Boolean(
    activeEl
    && activeEl !== document.body
    && activeEl !== document.documentElement
    && activeEl.id !== 'game-canvas'
    && typeof activeEl.matches === 'function'
    && activeEl.matches(':focus-visible')
    && typeof activeEl.closest === 'function'
    && activeEl.closest('button, a, input, select, textarea, [role="button"], [role="tab"]')
  );
}

function handleSpecialDigitShortcut(ui, e) {
  const idx = Number.parseInt(e.code.replace('Digit', ''), 10) - 1;
  if (idx < 0 || idx >= SPECIAL_TYPES_ORDER.length) {
    return;
  }
  const type = SPECIAL_TYPES_ORDER[idx];
  if (ui.engine.isSpecialTypeAllowed?.(type) === false) {
    return;
  }
  e.preventDefault();
  const count = ui.engine.specialInventory?.[type] || 0;
  const isEquipped = ui.engine.currentBall?.specialType === type;
  if (count <= 0 && !isEquipped && ui.engine.offersSpecialBalls?.() && ui.canBuySpecialAmmo()) {
    ui.openShopModal(SHOP_TABS.AMMO);
  } else {
    ui.engine.equipSpecialBall(type);
  }
}

function tryNonInteractiveActionKey(ui, e, isInteractiveFocused) {
  if (e.code === 'Space') {
    if (!isInteractiveFocused) {
      e.preventDefault();
      ui.engine.swapLauncherBalls();
    }
    return true;
  }
  const shakeCode = ui.engine.getMergeShakeRemaining?.() != null ? ui.engine.modesConfig.merge.shake.keyCode : null;
  if (shakeCode && e.code === shakeCode) {
    if (!isInteractiveFocused) {
      e.preventDefault();
      if (!e.repeat) {
        ui.tryMergeShake();
      }
    }
    return true;
  }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (!isInteractiveFocused) {
      e.preventDefault();
      ui.engine.shoot();
      ui.updateAimState(ui.engine);
    }
    return true;
  }
  return false;
}

const DESKTOP_NAV_SHORTCUTS = Object.freeze([
  { key: 'p', code: 'KeyP', run: (ui) => ui.engine.togglePause() },
  { key: 'm', code: 'KeyM', run: (ui) => ui.openPlayHub() },
  { key: 'w', code: 'KeyW', run: (ui) => ui.openShopModal() }
]);

function isDesktopShortcutMatch(e, key, code) {
  return (typeof e.key === 'string' && e.key.toLowerCase() === key) || (!e.key && e.code === code);
}

function handleDesktopNavShortcut(ui, e, isInteractiveFocused) {
  if (isInteractiveFocused || e.repeat || ui.engine.state !== GAME_STATES.PLAYING || ui.engine.isVictoryCelebrating?.()) {
    return false;
  }
  const shortcut = DESKTOP_NAV_SHORTCUTS.find(({ key, code }) => isDesktopShortcutMatch(e, key, code));
  if (!shortcut) {
    return false;
  }
  e.preventDefault();
  shortcut.run(ui);
  return true;
}

function handleLauncherGameplayKey(ui, e) {
  const isInteractiveFocused = isKeyboardInteractiveElementFocused();
  if (handleDesktopNavShortcut(ui, e, isInteractiveFocused)) {
    return;
  }
  if (tryNonInteractiveActionKey(ui, e, isInteractiveFocused)) {
    return;
  }
  if (e.code === 'KeyF') {
    e.preventDefault();
    ui.engine.togglePolarityFlip();
    return;
  }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault();
    const step = e.shiftKey
      ? ui.gameConfig.canvas.keyboardAimStepRad
      : ui.gameConfig.canvas.keyboardAimFineStepRad;
    ui.engine.adjustAimByDelta((e.code === 'ArrowLeft' ? -1 : 1) * step);
    ui.updateAimState(ui.engine);
    return;
  }
  if (e.code.startsWith('Digit')) {
    handleSpecialDigitShortcut(ui, e);
  }
}

const BACK_UNWIND_MODAL_KEYS = ['modalLevels', 'modalPlay', 'modalShop', 'modalSettings', 'modalStats'];

function dismissTopBackLayer(ui) {
  if (ui.elements.modalConfirm && !ui.elements.modalConfirm.classList.contains(HIDDEN_CLASS)) {
    ui.dismissConfirm();
    return true;
  }
  if (ui.isDuelCardOpen()) {
    ui.dismissDuelCard();
    return true;
  }
  // The Polarity Duel layers (difficulty picker, match pause and result) unwind before anything under them.
  if (ui.handleVersusBack()) {
    return true;
  }
  if (ui.progressBackup && ui.getActiveTopModal() === ui.elements.modalProgressImport) {
    ui.progressBackup.dismiss();
    return true;
  }
  if (ui.isCalibrationOpen()) {
    ui.closeCalibration();
    return true;
  }
  for (const key of BACK_UNWIND_MODAL_KEYS) {
    const modal = ui.elements[key];
    if (modal && !modal.classList.contains(HIDDEN_CLASS)) {
      ui.closeOverlayModal(modal);
      return true;
    }
  }
  return false;
}

function tryPauseResumeShortcut(ui, e) {
  if (e.repeat || isBrowserShortcut(e) || !isDesktopShortcutMatch(e, 'p', 'KeyP') || !ui.isPauseDialogTop?.()) {
    return false;
  }
  e.preventDefault();
  ui.engine.togglePause();
  return true;
}

function handleTabOrOverlayShortcut(ui, e) {
  if (e.code === 'Tab' && ui.isAnyModalOpen()) {
    ui.trapModalFocus(e);
    return true;
  }
  if (e.code === 'Tab' && ui.isDrawerOpen) {
    ui.trapFocusWithin(ui.elements.drawer, e);
    return true;
  }
  if (shouldIgnoreRepeatedKey(e.code, e.repeat)) {
    ui.swallowRepeatedLocalKey(e);
    return true;
  }
  if (e.code === 'Escape') {
    ui.handleBackAction();
    return true;
  }
  if (tryPauseResumeShortcut(ui, e)) {
    return true;
  }
  // The perk choice is the top dialog: its digits pick a card and never equip a special ball.
  if (ui.isFluxPerkModalTop()) {
    const cardIndex = fluxPerkIndexForKey(e.code, ui.engine.fluxPerkOffer?.length || 0);
    if (cardIndex >= 0 && !isBrowserShortcut(e)) {
      e.preventDefault();
      ui.engine.chooseFluxPerk(ui.engine.fluxPerkOffer[cardIndex]);
    }
    return true;
  }
  return false;
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
    this.syncMergeShakeGesture?.();
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
    bindAllModeCards.call(this);
    bindHeaderAndShellControls(this);
    bindLauncherAndHintControls(this);
    bindShopTabs(this);
    bindModalAndConfirmControls(this);
    bindRoundFlowControls(this);
    bindGlobalWindowListeners(this);
  },

  /**
   * Unwinds the topmost layer: Confirm, duel card, a dialog (campaign map, then Play hub), the menu, then the run's pause.
   * Shared by Escape and the controller's back button.
   */
  handleBackAction() {
    if (dismissTopBackLayer(this)) {
      return;
    }
    if (this.isPowerupsDrawerOpen) {
      setPowerupsDrawerOpen(this, false);
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
    if (handleTabOrOverlayShortcut(this, e) || this.isAnyModalOpen() || this.isDrawerOpen || isBrowserShortcut(e)) {
      return;
    }
    const sceneController = this.getSceneController();
    if (sceneController) {
      sceneController.handleGameplayKey(e);
      return;
    }
    handleLauncherGameplayKey(this, e);
  },
};
