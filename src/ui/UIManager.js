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
import { i18n, t, formatNumber } from '../core/I18n.js';
import { decodeGeneratedShapeId, isGeneratedShapeId } from '../game/layouts/ShapeGenerator.js';
import { SPECIAL_ICON_HIGHLIGHT_POSITION, specialIconBackground } from './CodexView.js';
import { FULL_PERCENT, SHOP_TABS, computeAchievementProgress } from './WorkshopView.js';
import { renderFluxPerkChips } from './FluxPerkView.js';
import {
  LABELLED_LEVEL_FORMATS,
  LEVEL_FORMAT_BADGE_KEYS,
  resolveLevelFormatBadgeKey,
  formatChapterTheme,
  formatLevelName,
  formatLevelDescription,
  formatChapterName,
  uiLevelSelectMethods
} from './LevelSelectView.js';
import { ProgressBackupView } from './ProgressBackupView.js';
import { uiPlayHubMethods } from './PlayHubView.js';
import { installMethods } from '../core/installMethods.js';
import {
  STANDALONE_DISPLAY_QUERY,
  isIosBrowserTab,
  COUNT_UP_EASE_POWER,
  DRAWER_OPEN_CLASS,
  VISUALLY_HIDDEN_CLASS,
  STAR_EARNED_CLASS,
  STAR_EMPTY_CLASS,
  INPUT_MODE_DATASET_KEY,
  EMPTY_POWERUP_CLASS,
  MODAL_INPUT_HINTS,
  DISCOVERY_PULSE_CLASS,
  resolvePulseTargets,
  buildLevelIntroText,
  INPUT_ARIA_HINTS,
  computeStarProgressPct,
  SPECIAL_AMMO_BLOCK_REASON_KEYS,
  canOpenDrawer,
  revealLiveRegion,
  scheduleNextFrame,
  renderedStarGlyphs,
  setTextIfChanged,
  setAttributeIfChanged
} from './UIHelpers.js';
import { uiGamepadMethods } from './UIGamepad.js';
import { uiInputBindingMethods } from './UIInputBindings.js';
import { uiModalMethods } from './UIModals.js';
import { uiSettingsControlMethods } from './UISettingsControls.js';
import { uiHudRefreshMethods } from './UIHudRefresh.js';
import { uiStatsMethods, STATS_TABS } from './UIStats.js';
import { uiGhostDuelMethods } from './UIGhostDuel.js';
import { uiVersusMethods } from './UIVersus.js';
import { uiCalibrationMethods } from './UICalibration.js';
import { uiVersusLocalMethods } from './UIVersusLocal.js';

export {
  SPECIAL_ICON_HIGHLIGHT_POSITION,
  specialIconBackground,
  FULL_PERCENT,
  SHOP_TABS,
  computeAchievementProgress,
  LABELLED_LEVEL_FORMATS,
  LEVEL_FORMAT_BADGE_KEYS,
  resolveLevelFormatBadgeKey
};

export {
  MODAL_FOCUSABLE_SELECTOR,
  isFullscreenSupported,
  isDocumentFullscreen,
  isIosBrowserTab,
  REDUCED_MOTION_CLASS,
  HIGH_CONTRAST_CLASS,
  DISCOVERY_PULSE_CLASS,
  resolvePulseTargets,
  resolveMechanicName,
  buildLevelIntroText,
  INPUT_ARIA_HINTS,
  splitRefreshExtra,
  computeStarProgressPct,
  inputModeForPointerType,
  filterFocusTrapCandidates,
  shouldIgnoreRepeatedKey,
  isBrowserShortcut,
  canOpenDrawer,
  isSharedFluxOverSavedRun,
  VICTORY_NEXT_ACTIONS,
  VICTORY_NEXT_LABEL_KEYS,
  resolveNextCampaignTarget,
  formatNearMissText,
  formatBestRunMarker,
  formatStreakGraceText,
  gameOverReasonKey,
  resolveModalFocusTarget,
  revealLiveRegion,
  computeTiltShare
} from './UIHelpers.js';

/**
 * Manages DOM HUD updates, accessible modal dialogs, shop/codex tabs,
 * and keyboard/button event bindings.
 */
export class UIManager {
  constructor({ engine, renderer, storageManager, audioManager, gameConfig, ballsConfig, versusConfigs = null }) {
    this.engine = engine;
    this.renderer = renderer;
    this.storageManager = storageManager;
    this.audioManager = audioManager;
    this.gameConfig = gameConfig;
    this.ballsConfig = ballsConfig;
    this.versusConfigs = versusConfigs;

    this.elements = {
      appShell: document.querySelector('.app-shell'),
      canvasWrapper: document.querySelector('.canvas-wrapper'),
      gameCanvas: document.getElementById('game-canvas'),
      scoreValue: document.getElementById('hud-score-value'),
      starProgress: document.getElementById('hud-star-progress'),
      starGlyphs: document.getElementById('hud-star-glyphs'),
      starCount: document.getElementById('hud-star-count'),
      starNext: document.getElementById('hud-star-next'),
      starMeter: document.getElementById('hud-star-meter'),
      starMeterFill: document.getElementById('hud-star-meter-fill'),
      sagMeter: document.getElementById('hud-sag-meter'),
      sagMeterFill: document.getElementById('hud-sag-meter-fill'),
      highScoreValue: document.getElementById('hud-best-value'),
      coinsValue: document.getElementById('hud-coins-value'),
      overchargePct: document.getElementById('hud-overcharge-pct'),
      overchargeFill: document.getElementById('hud-overcharge-fill'),
      modeBanner: document.getElementById('hud-mode-banner'),
      compactInfo: document.getElementById('hud-compact-info'),
      shotsLabel: document.getElementById('hud-shots-label'),
      shotsValue: document.getElementById('hud-shots-value'),
      comboBadge: document.getElementById('hud-combo-badge'),
      mergeEventBadge: document.getElementById('hud-merge-event'),
      mergeContractBadge: document.getElementById('hud-merge-contract'),
      frozenBadge: document.getElementById('hud-frozen-badge'),
      magnetarTelegraph: document.getElementById('hud-magnetar-telegraph'),
      bestRunBadge: document.getElementById('hud-best-run'),
      hudGhost: document.getElementById('hud-ghost'),
      powerupsContainer: document.getElementById('powerups-bar'),
      powerupsHeader: document.getElementById('powerups-header'),
      powerupsEmpty: document.getElementById('powerups-empty'),
      btnPlay: document.getElementById('btn-play'),
      playNewBadge: document.getElementById('play-new-badge'),
      btnEndless: document.getElementById('btn-endless'),
      btnDaily: document.getElementById('btn-daily'),
      btnFlux: document.getElementById('btn-flux'),
      btnWeekly: document.getElementById('btn-weekly'),
      btnStats: document.getElementById('btn-stats'),
      btnShop: document.getElementById('btn-shop'),
      btnRestart: document.getElementById('btn-restart'),
      btnPause: document.getElementById('btn-pause'),
      btnSound: document.getElementById('btn-sound'),
      btnContrast: document.getElementById('btn-contrast'),
      btnPatterns: document.getElementById('btn-patterns'),
      btnTilt: document.getElementById('btn-tilt'),
      btnMergeShakeGesture: document.getElementById('btn-merge-shake-gesture'),
      mergeShakeGestureStatus: document.getElementById('merge-shake-gesture-status'),
      btnMotion: document.getElementById('btn-motion'),
      btnAnimSpeed: document.getElementById('btn-anim-speed'),
      btnMusic: document.getElementById('btn-music'),
      btnMusicVolume: document.getElementById('btn-music-volume'),
      btnResonance: document.getElementById('btn-resonance'),
      btnCalibrate: document.getElementById('btn-calibrate'),
      modalCalibrate: document.getElementById('modal-calibrate'),
      btnCalibrateTap: document.getElementById('btn-calibrate-tap'),
      btnCalibrateReset: document.getElementById('btn-calibrate-reset'),
      btnCalibrateDone: document.getElementById('btn-calibrate-done'),
      calibrateRing: document.getElementById('calibrate-ring'),
      calibrateIntro: document.getElementById('calibrate-intro'),
      calibrateProgress: document.getElementById('calibrate-progress'),
      calibrateResult: document.getElementById('calibrate-result'),
      btnFullscreen: document.getElementById('btn-fullscreen'),
      btnFullscreenHud: document.getElementById('btn-fullscreen-hud'),
      btnResetHints: document.getElementById('btn-reset-hints'),
      btnLang: document.getElementById('btn-lang'),
      swapBtn: document.getElementById('btn-swap-ball'),
      polarityBtn: document.getElementById('btn-polarity'),
      mergeShakeBtn: document.getElementById('btn-merge-shake'),
      hintReplayBtn: document.getElementById('btn-hint-replay'),
      levelIntroBanner: document.getElementById('level-intro-banner'),
      levelIntroText: document.getElementById('level-intro-text'),
      btnDismissLevelIntro: document.getElementById('btn-dismiss-level-intro'),
      drawer: document.getElementById('app-drawer'),
      drawerBackdrop: document.getElementById('drawer-backdrop'),
      btnMenu: document.getElementById('btn-menu'),
      btnCloseDrawer: document.getElementById('btn-close-drawer'),
      hudBar: document.querySelector('.hud-bar'),
      stageContainer: document.querySelector('.stage-container'),
      drawerMode: document.getElementById('drawer-mode'),
      drawerStarProgress: document.getElementById('drawer-star-progress'),
      drawerCoins: document.getElementById('drawer-coins'),
      drawerBest: document.getElementById('drawer-best'),
      drawerOvercharge: document.getElementById('drawer-overcharge'),
      tutorialBanner: document.getElementById('tutorial-banner'),
      tutorialBannerText: document.getElementById('tutorial-banner-text'),
      btnDismissTutorial: document.getElementById('btn-dismiss-tutorial'),
      specialEquippedBanner: document.getElementById('special-equipped-banner'),
      cancelAimBanner: document.getElementById('cancel-aim-banner'),
      modalPlay: document.getElementById('modal-play'),
      btnClosePlay: document.getElementById('btn-close-play'),
      playHubHint: document.getElementById('play-hub-hint'),
      btnCampaignContinue: document.getElementById('btn-campaign-continue'),
      btnCampaignMap: document.getElementById('btn-campaign-map'),
      playCampaignSummary: document.getElementById('play-campaign-summary'),
      playCampaignMeter: document.getElementById('play-campaign-meter'),
      playCampaignMeterFill: document.getElementById('play-campaign-meter-fill'),
      dailyReward: document.getElementById('daily-reward'),
      weeklyReward: document.getElementById('weekly-reward'),
      btnPuzzleStagesToggle: document.getElementById('btn-puzzle-stages-toggle'),
      btnFluxSeedToggle: document.getElementById('btn-flux-seed-toggle'),
      fluxSeedEntry: document.getElementById('flux-seed-entry'),
      btnVersusLocalHub: document.getElementById('btn-versus-local-hub'),
      versusLocalHubHint: document.getElementById('versus-local-hub-hint'),
      modalLevels: document.getElementById('modal-levels'),
      btnModeClassic: document.getElementById('btn-mode-classic'),
      btnModePuzzle: document.getElementById('btn-mode-puzzle'),
      btnModeBlitz: document.getElementById('btn-mode-blitz'),
      btnModeBossRush: document.getElementById('btn-mode-boss-rush'),
      btnModeCascade: document.getElementById('btn-mode-cascade'),
      btnModeHexGrid: document.getElementById('btn-mode-hex-grid'),
      btnModePinball: document.getElementById('btn-mode-pinball'),
      btnModeOrbital: document.getElementById('btn-mode-orbital'),
      btnModeConvoy: document.getElementById('btn-mode-convoy'),
      btnModeMerge: document.getElementById('btn-mode-merge'),
      btnModeVersus: document.getElementById('btn-mode-versus'),
      arcadeBestEndless: document.getElementById('arcade-best-endless'),
      arcadeBestFlux: document.getElementById('arcade-best-flux'),
      arcadeBestClassic: document.getElementById('arcade-best-classic'),
      arcadeBestPuzzle: document.getElementById('arcade-best-puzzle'),
      arcadeBestBlitz: document.getElementById('arcade-best-blitz'),
      arcadeBestBossRush: document.getElementById('arcade-best-boss-rush'),
      arcadeBestCascade: document.getElementById('arcade-best-cascade'),
      arcadeBestHexGrid: document.getElementById('arcade-best-hex-grid'),
      arcadeBestPinball: document.getElementById('arcade-best-pinball'),
      arcadeBestOrbital: document.getElementById('arcade-best-orbital'),
      arcadeBestConvoy: document.getElementById('arcade-best-convoy'),
      arcadeBestMerge: document.getElementById('arcade-best-merge'),
      arcadeBestVersus: document.getElementById('arcade-best-versus'),
      puzzleStagesStrip: document.getElementById('puzzle-stages-strip'),
      levelsStarsSummary: document.getElementById('levels-stars-summary'),
      btnLevelsFilterIncomplete: document.getElementById('btn-levels-filter-incomplete'),
      inputFluxSeed: document.getElementById('input-flux-seed'),
      btnFluxSeedGo: document.getElementById('btn-flux-seed-go'),
      btnChapterPrev: document.getElementById('btn-chapter-prev'),
      levelsChapterSelect: document.getElementById('levels-chapter-select'),
      btnChapterNext: document.getElementById('btn-chapter-next'),
      levelsChapterProgress: document.getElementById('levels-chapter-progress'),
      levelsChapterMeterFill: document.getElementById('levels-chapter-meter-fill'),
      btnLevelsJumpCurrent: document.getElementById('btn-levels-jump-current'),
      levelsChapterHint: document.getElementById('levels-chapter-hint'),
      levelsGrid: document.getElementById('levels-grid'),
      levelsDetail: document.getElementById('levels-detail'),
      levelsDetailHeader: document.getElementById('levels-detail-header'),
      levelsDetailTitle: document.getElementById('levels-detail-title'),
      levelsDetailBadge: document.getElementById('levels-detail-badge'),
      levelsDetailDesc: document.getElementById('levels-detail-desc'),
      levelsDetailStars: document.getElementById('levels-detail-stars'),
      levelsDetailBest: document.getElementById('levels-detail-best'),
      levelsDetailLock: document.getElementById('levels-detail-lock'),
      btnCloseLevels: document.getElementById('btn-close-levels'),
      btnPlayLevelModal: document.getElementById('btn-play-level-modal'),
      modalShop: document.getElementById('modal-shop'),
      shopBalance: document.getElementById('shop-balance'),
      tabShopUpgrades: document.getElementById('tab-shop-upgrades'),
      tabShopAmmo: document.getElementById('tab-shop-ammo'),
      shopAmmoPane: document.getElementById('shop-ammo-pane'),
      tabShopStyles: document.getElementById('tab-shop-styles'),
      shopStylesPane: document.getElementById('shop-styles-pane'),
      shopStylesGrid: document.getElementById('shop-styles-grid'),
      tabShopAchievements: document.getElementById('tab-shop-achievements'),
      tabShopCodex: document.getElementById('tab-shop-codex'),
      shopUpgradesPane: document.getElementById('shop-upgrades-pane'),
      shopGrid: document.getElementById('shop-grid'),
      shopAmmoGrid: document.getElementById('shop-ammo-grid'),
      achievementsGrid: document.getElementById('achievements-grid'),
      codexPane: document.getElementById('codex-pane'),
      btnCloseShop: document.getElementById('btn-close-shop'),
      modalVictory: document.getElementById('modal-victory'),
      victoryUnlock: document.getElementById('victory-unlock'),
      victoryScore: document.getElementById('victory-score'),
      victoryBonus: document.getElementById('victory-bonus'),
      victoryStars: document.getElementById('victory-stars'),
      victoryNextStar: document.getElementById('victory-next-star'),
      btnNextLevel: document.getElementById('btn-next-level'),
      btnReplayVictory: document.getElementById('btn-replay-victory'),
      btnLevelsVictory: document.getElementById('btn-levels-victory'),
      modalGameOver: document.getElementById('modal-gameover'),
      gameOverReason: document.getElementById('gameover-reason'),
      gameOverScore: document.getElementById('gameover-score'),
      gameOverBest: document.getElementById('gameover-best'),
      gameoverRemaining: document.getElementById('gameover-remaining'),
      gameOverStage: document.getElementById('gameover-stage'),
      gameOverNearMiss: document.getElementById('gameover-near-miss'),
      gameOverDuel: document.getElementById('gameover-duel'),
      gameOverDailyNext: document.getElementById('gameover-daily-next'),
      btnContinueGameOver: document.getElementById('btn-continue-gameover'),
      btnRetry: document.getElementById('btn-retry'),
      btnSameSeedGameOver: document.getElementById('btn-same-seed-gameover'),
      btnLevelsGameOver: document.getElementById('btn-levels-gameover'),
      btnShareGameOver: document.getElementById('btn-share-gameover'),
      btnDailyHistoryGameOver: document.getElementById('btn-daily-history-gameover'),
      gameOverShareFallback: document.getElementById('gameover-share-fallback'),
      gameOverShareText: document.getElementById('gameover-share-text'),
      modalPause: document.getElementById('modal-pause'),
      modalFluxPerk: document.getElementById('modal-flux-perk'),
      fluxPerkCards: document.getElementById('flux-perk-cards'),
      hudPerks: document.getElementById('hud-perks'),
      drawerPerks: document.getElementById('drawer-perks'),
      drawerPerksStat: document.getElementById('drawer-perks-stat'),
      pauseLevelTip: document.getElementById('pause-level-tip'),
      pauseInstructionTip: document.getElementById('pause-instruction-tip'),
      btnResume: document.getElementById('btn-resume'),
      btnRestartPause: document.getElementById('btn-restart-pause'),
      btnLevelsPause: document.getElementById('btn-levels-pause'),
      btnSettingsPause: document.getElementById('btn-settings-pause'),
      btnSettings: document.getElementById('btn-settings'),
      modalSettings: document.getElementById('modal-settings'),
      modalProgressImport: document.getElementById('modal-progress-import'),
      btnCloseSettings: document.getElementById('btn-close-settings'),
      btnInstall: document.getElementById('btn-install'),
      installIosHint: document.getElementById('install-ios-hint'),
      modalStats: document.getElementById('modal-stats'),
      tabStatsOverview: document.getElementById('tab-stats-overview'),
      tabStatsDaily: document.getElementById('tab-stats-daily'),
      statsOverviewPane: document.getElementById('stats-overview-pane'),
      statsDailyPane: document.getElementById('stats-daily-pane'),
      statsSince: document.getElementById('stats-since'),
      statsOverviewEmpty: document.getElementById('stats-overview-empty'),
      statsOverviewList: document.getElementById('stats-overview-list'),
      statsCampaignList: document.getElementById('stats-campaign-list'),
      statsDailySummary: document.getElementById('stats-daily-summary'),
      statsDailyEmpty: document.getElementById('stats-daily-empty'),
      statsDailyWrap: document.getElementById('stats-daily-wrap'),
      statsDailyCaption: document.getElementById('stats-daily-caption'),
      statsDailyBody: document.getElementById('stats-daily-body'),
      statsCopyFeedback: document.getElementById('stats-copy-feedback'),
      statsCopyFallback: document.getElementById('stats-copy-fallback'),
      statsCopyText: document.getElementById('stats-copy-text'),
      btnCopyStats: document.getElementById('btn-copy-stats'),
      btnCloseStats: document.getElementById('btn-close-stats'),
      modalConfirm: document.getElementById('modal-confirm'),
      btnConfirmYes: document.getElementById('btn-confirm-yes'),
      btnConfirmNo: document.getElementById('btn-confirm-no'),
      modalDuel: document.getElementById('modal-duel'),
      duelCardSummary: document.getElementById('duel-card-summary'),
      duelCardNotes: document.getElementById('duel-card-notes'),
      btnDuelAccept: document.getElementById('btn-duel-accept'),
      btnDuelDecline: document.getElementById('btn-duel-decline'),
      btnDuelOk: document.getElementById('btn-duel-ok'),
      inputDuelName: document.getElementById('input-duel-name'),
      statsDuelsRecord: document.getElementById('stats-duels-record'),
      statsDuelsEmpty: document.getElementById('stats-duels-empty'),
      statsDuelsList: document.getElementById('stats-duels-list'),
      srAnnouncer: document.getElementById('sr-announcer'),
      toast: document.getElementById('toast'),
      inputGamepadEnabled: document.getElementById('input-gamepad-enabled'),
      selectGamepadDeadzone: document.getElementById('select-gamepad-deadzone'),
      selectGamepadAimSpeed: document.getElementById('select-gamepad-aim-speed'),
      inputGamepadInvertX: document.getElementById('input-gamepad-invert-x'),
      settingsControllerFields: document.getElementById('settings-controller-fields'),
      settingsControllerNoPad: document.getElementById('settings-controller-nopad'),
      modalVersusTiers: document.getElementById('modal-versus-tiers'),
      versusTierList: document.getElementById('versus-tier-list'),
      versusTierHint: document.getElementById('versus-tier-hint'),
      versusResonanceOption: document.getElementById('input-versus-resonance'),
      btnVersusTiersBack: document.getElementById('btn-versus-tiers-back'),
      btnVersusLocal: document.getElementById('btn-versus-local'),
      versusLocalEntryHint: document.getElementById('versus-local-entry-hint'),
      modalVersusLocal: document.getElementById('modal-versus-local'),
      btnVersusLocalStart: document.getElementById('btn-versus-local-start'),
      btnVersusLocalBack: document.getElementById('btn-versus-local-back'),
      versusLocalNeedTwo: document.getElementById('versus-local-need-two'),
      versusLocalLive: document.getElementById('versus-local-live'),
      versusScreen: document.getElementById('versus-screen'),
      versusBoards: document.querySelector('#versus-screen .versus-boards'),
      versusBar: document.querySelector('#versus-screen .versus-bar'),
      versusCanvas0: document.getElementById('versus-canvas-0'),
      versusCanvas1: document.getElementById('versus-canvas-1'),
      versusHud0: document.getElementById('versus-hud-0'),
      versusHud1: document.getElementById('versus-hud-1'),
      versusRoundOverlay: document.getElementById('versus-round-overlay'),
      btnVersusPause: document.getElementById('btn-versus-pause'),
      btnVersusSwap: document.getElementById('btn-versus-swap'),
      btnVersusPolarity: document.getElementById('btn-versus-polarity'),
      btnVersusSwap1: document.getElementById('btn-versus-swap-1'),
      btnVersusPolarity1: document.getElementById('btn-versus-polarity-1'),
      versusPauseSizeHint: document.getElementById('versus-pause-size-hint'),
      versusPausePadHint: document.getElementById('versus-pause-pad-hint'),
      modalDuelPause: document.getElementById('modal-duel-pause'),
      btnVersusResume: document.getElementById('btn-versus-resume'),
      btnVersusRestart: document.getElementById('btn-versus-restart'),
      btnVersusQuit: document.getElementById('btn-versus-quit'),
      modalDuelResult: document.getElementById('modal-duel-result'),
      versusResultTitle: document.getElementById('modal-duel-result-title'),
      versusResultScore: document.getElementById('versus-result-score'),
      versusResultTier: document.getElementById('versus-result-tier'),
      versusResultNeutralised: document.getElementById('versus-result-neutralised'),
      versusResultPulses: document.getElementById('versus-result-pulses'),
      versusResultNeutralisedB: document.getElementById('versus-result-neutralised-b'),
      versusResultPulsesB: document.getElementById('versus-result-pulses-b'),
      btnVersusChangePlayers: document.getElementById('btn-versus-change-players'),
      versusResultShareFallback: document.getElementById('versus-result-share-fallback'),
      versusResultShareText: document.getElementById('versus-result-share-text'),
      btnVersusRematch: document.getElementById('btn-versus-rematch'),
      btnVersusShare: document.getElementById('btn-versus-share'),
      btnVersusBack: document.getElementById('btn-versus-back')
    };

    this.pendingAnnouncements = [];
    this.isAnnouncementScheduled = false;
    this.lastExtra = {};
    this.pendingConfirmCallback = null;
    this.pendingConfirmLabelResolver = null;
    this.confirmPausedRun = false;
    this.isSharing = false;
    this.shareCopied = false;
    this.hintsResetConfirmed = false;
    this.dailyCountdownTimer = null;
    this.activeShopTab = SHOP_TABS.UPGRADES;
    // The deferred install prompt, kept until the player asks for it from Settings.
    this.installPromptEvent = null;
    this.levelsChapterIndex = 0;
    this.levelsSelectedId = null;
    this.levelsFilterIncomplete = false;
    this.autoPausedByOverlay = false;
    this.lastFocusedElement = null;
    this.wasAnyModalOpen = false;
    this.stackedModalOpener = null;
    // The button the duel tier picker hands focus back to when the hub opened it (null: default).
    this.versusTierOpener = null;
    // Pulse: the music driver (built on the first frame) and the rhythm calibration in progress.
    this.pulseDriver = null;
    this.calibration = null;
    this.calibrationFrameId = null;
    this.calibrationPressHandled = false;
    this.calibrationClickEnabled = false;
    this.prevEngineState = null;
    this.isVictoryModalRevealed = false;
    this.isVictoryPresented = false;
    this.victoryStarsLabel = null;
    this.scoreCountUpFrame = null;
    this.inputMode = this.detectInitialInputMode();
    this.gamepadInput = null;
    this.padFocusEl = null;
    this.toastTimer = null;
    this.isDrawerOpen = false;
    this.drawerStarParts = null;
    this.activeStatsTab = STATS_TABS.OVERVIEW;
    this.statsOpener = null;
    this.statsCopied = false;
    this.duelCardRead = null;
    this.duelCardAtStake = false;
    this.ghostLastSide = null;
    this.challengeUrl = null;
    // The versus screen (null while closed), the scene the game loop drives, and what the UI
    // routes the gameplay controls to while the screen is open.
    this.versus = null;
    this.versusScene = null;
    this.versusSeedCounter = 0;
    // The two-player lobby (slots, handicaps) and its key names; created when the lobby is bound.
    this.versusLocal = null;
    this.mainScene = { boards: [{ engine, renderer }] };
    this.versusSceneController = {
      handleGameplayKey: (event) => this.handleVersusGameplayKey(event),
      handleGamepadActions: (actions, aimDelta) => this.handleVersusGamepadActions(actions, aimDelta),
      pause: () => this.pauseVersus()
    };
  }

  detectInitialInputMode() {
    const query = this.gameConfig.defaults.coarsePointerMediaQuery;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && query) {
      return window.matchMedia(query).matches ? INPUT_MODES.TOUCH : INPUT_MODES.POINTER;
    }
    return INPUT_MODES.POINTER;
  }

  /**
   * Switches every input-specific hint (keyboard shortcuts, tap or click wording)
   * when the player changes device, e.g. a touch laptop used with its keyboard.
   */
  setInputMode(mode) {
    if (mode === this.inputMode) {
      return;
    }
    this.inputMode = mode;
    this.applyInputMode();
    this.refresh(this.engine, this.lastExtra);
  }

  applyInputMode() {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.dataset[INPUT_MODE_DATASET_KEY] = this.inputMode;
    }
    if (this.inputMode !== INPUT_MODES.GAMEPAD) {
      this.clearPadFocus();
    }
    this.updateInputHints();
  }

  /** A launcher label, followed by its keyboard shortcut only when a keyboard is in use. */
  formatLauncherLabel(labelKey, shortcutKey) {
    const label = t(labelKey);
    // The keyboard shortcut is wrong for touch and for a controller (which shows its own glyph).
    if (this.inputMode !== INPUT_MODES.POINTER) {
      return label;
    }
    return t('hud.launcher.shortcutFormat', { label, key: t(shortcutKey) });
  }

  /**
   * Fills a launcher button's icon and text parts. The text stays in the
   * accessibility tree even where the compact layout only shows the icon.
   */
  setLauncherButton(button, iconKey, labelKey, shortcutKey, captionKey) {
    if (!button) {
      return;
    }
    setTextIfChanged(button.querySelector('.launcher-icon'), t(iconKey));
    setTextIfChanged(button.querySelector('.launcher-text'), this.formatLauncherLabel(labelKey, shortcutKey));
    // The short caption under the icon, shown where the compact layout hides the label.
    setTextIfChanged(button.querySelector('.launcher-caption'), t(captionKey));
  }

  updateInputHints() {
    this.setLauncherButton(
      this.elements.swapBtn,
      'hud.launcher.swap.icon',
      'hud.launcher.swap.label',
      'hud.launcher.swap.shortcut',
      'hud.launcher.swap.caption'
    );
    for (const { elementId, key } of MODAL_INPUT_HINTS) {
      const modeKey = this.engine?.getModeBehavior?.().getInputHintKey(key) ?? key;
      setTextIfChanged(document.getElementById(elementId), t(`${modeKey}.${this.getHintInputMode(key)}`));
    }
    setAttributeIfChanged(
      this.elements.modeBanner,
      'title',
      t(this.inputMode === INPUT_MODES.TOUCH ? 'hud.stats.mode.switchHintTouch' : 'hud.stats.mode.switchHint')
    );
    for (const { elementId, key } of INPUT_ARIA_HINTS) {
      const labelKey = this.inputMode === INPUT_MODES.GAMEPAD ? `${key}Pad` : `${key}.${this.inputMode}`;
      setAttributeIfChanged(document.getElementById(elementId), 'aria-label', t(labelKey));
    }
  }

  init() {
    this.applyCanvasLayoutVariables();
    this.applyInputMode();
    this.buildPowerupButtons();
    this.bindEvents();
    this.bindDuelEvents();
    this.bindVersusEvents();
    this.bindVersusLocalEvents();
    this.updateSoundButton();
    this.updateContrastButton();
    this.updatePatternsButton();
    this.setupTiltControl();
    this.setupMergeShakeGesture();
    if (this.elements.modalProgressImport) this.progressBackup = new ProgressBackupView(this);
    this.updateMotionButton();
    this.updateAnimSpeedButton();
    this.setupPulseControls();
    this.setupCalibration();
    this.bindAudioUnlock();
    this.setupGamepadControls();
    this.setupFullscreenControl();
    this.updateLanguageButton();
    this.bindInstallEvents();
    this.syncInstallControls();

    i18n.onChange(() => {
      this.updateInputHints();
      this.buildPowerupButtons();
      this.updateSoundButton();
      this.updateContrastButton();
      this.updatePatternsButton();
      this.updateTiltButton();
      this.updateMotionButton();
      this.updateAnimSpeedButton();
      this.updateMusicButton();
      this.updateMusicVolumeButton();
      this.updateResonanceButton();
      this.refreshCalibrationText();
      this.updateGamepadControls();
      this.updateFullscreenButton();
      this.updateLanguageButton();
      this.updateResetHintsFeedback();
      this.updateShareButtonLabel();
      this.updateConfirmButtonLabel();
      this.progressBackup?.refresh();
      this.refreshVersusLanguage();
      this.refreshVersusLocalLanguage();
      this.refreshStatsIfOpen();
      this.refresh(this.engine, this.lastExtra);
    });
  }

  /** Shows the stored install prompt once: the browser refuses a second prompt() call. */
  async promptInstall() {
    const promptEvent = this.installPromptEvent;
    if (!promptEvent) {
      return;
    }
    this.installPromptEvent = null;
    this.syncInstallControls();
    await promptEvent.prompt();
    try {
      await promptEvent.userChoice;
    } catch {
      // A dismissed or failed choice leaves nothing to undo: the button is already gone,
      // and the browser fires beforeinstallprompt again when it can offer the app anew.
    }
  }

  /**
   * The install button shows while the browser offers an install prompt; the manual
   * steps show in Safari on iPhone and iPad, which has no such prompt.
   */
  syncInstallControls() {
    const matchesStandalone =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(STANDALONE_DISPLAY_QUERY).matches;
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    this.elements.btnInstall?.classList.toggle('hidden', !this.installPromptEvent);
    this.elements.installIosHint?.classList.toggle('hidden', !isIosBrowserTab(nav, matchesStandalone));
  }

  /**
   * Exposes canvas geometry to CSS: the board takes the world's shape, and overlays are
   * placed relative to the danger line.
   */
  applyCanvasLayoutVariables() {
    const { logicalWidth, logicalHeight, dangerLineY } = this.gameConfig.canvas;
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.setProperty('--canvas-aspect', `${logicalWidth} / ${logicalHeight}`);
    }
    if (this.elements.canvasWrapper) {
      const belowDangerPct = ((logicalHeight - dangerLineY) / logicalHeight) * FULL_PERCENT;
      this.elements.canvasWrapper.style.setProperty('--tutorial-bottom', `${belowDangerPct}%`);
    }
  }

  /** Makes the control a hint points at pulse, and only that one. */
  updateDiscoveryPulse(engine) {
    const { polarity, specialType } = resolvePulseTargets(engine.getDiscoveryPulseTarget?.());
    this.elements.polarityBtn?.classList.toggle(DISCOVERY_PULSE_CLASS, polarity);
    for (const btn of this.elements.powerupsContainer.querySelectorAll('.powerup-btn')) {
      btn.classList.toggle(DISCOVERY_PULSE_CLASS, btn.dataset.specialType === specialType);
    }
  }

  /** Shows the "?" button only where the level has hints to replay. */
  updateHintReplayButton(engine) {
    const button = this.elements.hintReplayBtn;
    if (!button) {
      return;
    }
    button.classList.toggle('hidden', !(engine.hasLevelHints?.() && engine.state === GAME_STATES.PLAYING));
  }

  /**
   * Shows the objective banner on the first play of a level. It never pauses the run or takes
   * focus; it goes away on its close button, or when the first shot is fired.
   */
  updateLevelIntro(engine) {
    const banner = this.elements.levelIntroBanner;
    if (!banner) {
      return;
    }
    const intro = engine.levelIntro;
    if (!intro || engine.state !== GAME_STATES.PLAYING) {
      // A Puzzle intro that never got its turn behind a discovery card: the first shot came first,
      // so the goal is still announced to screen readers before the intro is forgotten.
      if (!intro && this.deferredPuzzleIntro && engine.state === GAME_STATES.PLAYING && engine.hasFiredInRound) {
        this.announce(buildLevelIntroText({ ...this.deferredPuzzleIntro, fairPlay: null }, t));
      }
      if (!intro) {
        this.deferredPuzzleIntro = null;
      }
      banner.classList.add('hidden');
      this.levelIntroShotsAtShow = null;
      return;
    }
    // A discovery card owns the slot: the Puzzle objective waits for it (deferred, never dropped).
    if (intro.puzzleStage && engine.activeDiscoveryId) {
      this.deferredPuzzleIntro = intro;
      banner.classList.add('hidden');
      return;
    }
    this.deferredPuzzleIntro = null;
    const usesShots = engine.usesShotBudget ? engine.usesShotBudget() : true;
    if (usesShots) {
      if (this.levelIntroShotsAtShow === null || this.levelIntroShotsAtShow === undefined) {
        this.levelIntroShotsAtShow = engine.shotsRemaining;
      } else if (engine.shotsRemaining < this.levelIntroShotsAtShow) {
        this.levelIntroShotsAtShow = null;
        engine.dismissLevelIntro?.();
        banner.classList.add('hidden');
        return;
      }
    }
    const fairPlay = intro.mutatorKey
      ? { upgrades: engine.areUpgradesNeutralised(), ammo: engine.isDailyAmmoLocked() }
      : null;
    const text = buildLevelIntroText({ ...intro, fairPlay }, t);
    revealLiveRegion({
      region: banner,
      textElement: this.elements.levelIntroText,
      text,
      schedule: scheduleNextFrame
    });
    const introKey =
      intro.levelId ??
      (intro.puzzleStage ? `puzzle:${intro.puzzleStage}` : `daily:${intro.dailySeed || intro.mutatorKey}`);
    if (this.announcedLevelIntroId !== introKey) {
      this.announcedLevelIntroId = introKey;
      this.announce(text);
    }
  }

  buildPowerupButtons() {
    const container = this.elements.powerupsContainer;
    container.replaceChildren();

    SPECIAL_TYPES_ORDER.forEach((type, index) => {
      const spec = this.ballsConfig.specialTypes[type];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'powerup-btn';
      btn.dataset.specialType = type;
      btn.title = t(`hud.powerups.${type}.tooltip`);

      const keyBadge = document.createElement('kbd');
      keyBadge.className = 'powerup-key';
      keyBadge.setAttribute('aria-hidden', 'true');
      keyBadge.textContent = String(index + 1);

      const iconSpan = document.createElement('span');
      iconSpan.className = 'powerup-icon';
      iconSpan.style.background = specialIconBackground(spec);
      iconSpan.textContent = spec.icon;

      iconSpan.setAttribute('aria-hidden', 'true');

      const labelSpan = document.createElement('span');
      labelSpan.className = 'powerup-name';
      labelSpan.textContent = t(`hud.powerups.${type}.name`);

      const count = this.engine.specialInventory[type] || 0;
      const countSpan = document.createElement('span');
      countSpan.className = 'powerup-count';
      countSpan.id = `powerup-count-${type}`;
      countSpan.textContent = String(count);

      // The visible name is hidden on narrow screens, so the name and stock
      // are carried by an explicit label rather than by the content.
      btn.setAttribute('aria-label', this.getPowerupAriaLabel(type, count));

      btn.append(keyBadge, iconSpan, labelSpan, countSpan);
      btn.addEventListener('click', () => {
        // A slot held by a shot or a stage change stays focusable but ignores the click.
        if (btn.getAttribute('aria-disabled') === 'true') {
          return;
        }
        // An empty stock leads to where more can be bought.
        if (btn.classList.contains(EMPTY_POWERUP_CLASS)) {
          this.openShopModal(SHOP_TABS.AMMO);
          return;
        }
        this.engine.equipSpecialBall(type);
      });

      container.appendChild(btn);
    });
  }

  /**
   * Refreshes each special-ball button: stock, the empty look, and the hold applied while a shot
   * or a stage change keeps ammo from being bought.
   * @param {import('../game/GameEngine.js').GameEngine} engine
   */
  updatePowerupButtons(engine) {
    const buttons = this.elements.powerupsContainer.querySelectorAll('.powerup-btn');
    const isOpenToAmmo = this.isRunOpenToAmmo();
    const canBuyAmmo = this.canBuySpecialAmmo();
    const ammoBlockKey = this.getSpecialAmmoBlockReasonKey();
    const holdReason = ammoBlockKey ? t(ammoBlockKey) : '';
    for (const btn of buttons) {
      const type = btn.dataset.specialType;
      const isAllowed = engine.isSpecialTypeAllowed?.(type) !== false;
      btn.classList.toggle('hidden', !isAllowed);
      if (!isAllowed) {
        continue;
      }
      const count = engine.specialInventory[type] || 0;
      const isEquipped = Boolean(engine.currentBall && engine.currentBall.specialType === type);
      const isEmpty = count <= 0 && !isEquipped;
      const countEl = document.getElementById(`powerup-count-${type}`);
      // The empty look follows the run, not the shot: it must not flicker on every shot.
      const isEmptyForSale = isEmpty && isOpenToAmmo;
      const isHeld = isEmptyForSale && !canBuyAmmo;
      setTextIfChanged(countEl, isEmptyForSale ? t('hud.powerups.button.emptyMark') : String(count));
      let label = isEmptyForSale
        ? t('hud.powerups.button.buyAria', { name: t(`hud.powerups.${type}.name`) })
        : this.getPowerupAriaLabel(type, count);
      if (isHeld && holdReason) {
        label = `${label}. ${holdReason}`;
      }
      setAttributeIfChanged(btn, 'aria-label', label);
      setAttributeIfChanged(btn, 'title', isHeld && holdReason ? holdReason : t(`hud.powerups.${type}.tooltip`));
      btn.classList.toggle('equipped', isEquipped);
      btn.classList.toggle(EMPTY_POWERUP_CLASS, isEmptyForSale);
      setAttributeIfChanged(btn, 'aria-pressed', String(isEquipped));
      // Held by a shot or a stage change: still focusable, the click is rejected instead.
      setAttributeIfChanged(btn, 'aria-disabled', String(isHeld));
      // Ammo is only sold during a round, so between rounds an empty button stays inert.
      btn.disabled = isEmpty && !isOpenToAmmo;
    }
  }

  getPowerupAriaLabel(type, count) {
    return t('hud.powerups.button.aria', {
      name: t(`hud.powerups.${type}.name`),
      count: formatNumber(count)
    });
  }

  /**
   * Queues a message for the visually hidden polite live region. Messages
   * raised in the same frame are joined so none of them is dropped.
   */
  announce(message) {
    const region = this.elements.srAnnouncer;
    if (!region || !message) {
      return;
    }
    this.pendingAnnouncements.push(message);
    if (this.isAnnouncementScheduled) {
      return;
    }
    this.isAnnouncementScheduled = true;
    // Clearing first lets an identical message be announced again.
    region.textContent = '';
    const flush = () => {
      this.isAnnouncementScheduled = false;
      region.textContent = this.pendingAnnouncements.join(' ');
      this.pendingAnnouncements = [];
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
    } else {
      flush();
    }
  }

  /** True when the layout turns the header into a slide-in menu. */
  isDrawerLayout() {
    return Boolean(this.elements?.btnMenu);
  }

  /**
   * Opens the slide-in menu. The run is paused like it is for the Shop or the
   * level select, and everything behind the menu is taken out of reach.
   */
  openDrawer() {
    const isAllowed = canOpenDrawer({
      isOpen: this.isDrawerOpen,
      isDrawerLayout: this.isDrawerLayout(),
      isModalOpen: this.isAnyModalOpen(),
      isVictoryCelebrating: this.engine.isVictoryCelebrating()
    });
    if (!isAllowed) {
      return;
    }
    this.isDrawerOpen = true;
    if (this.engine.state === GAME_STATES.PLAYING) {
      this.autoPausedByOverlay = true;
      this.engine.state = GAME_STATES.PAUSED;
    }
    // Another tab may have unlocked a mode since the last refresh.
    this.refreshModeLocks(this.getModeAccess());
    this.syncDrawerState();
    if (this.elements.btnCloseDrawer) {
      this.elements.btnCloseDrawer.focus();
    }
  }

  /**
   * Closes the slide-in menu and gives focus back to the menu button.
   * @param {{resume: boolean}} options - resume: restart a run the menu paused. A menu
   *   action that opens a dialog passes false, and that dialog resumes the run when it closes.
   */
  closeDrawer({ resume }) {
    if (!this.isDrawerOpen) {
      return;
    }
    this.isDrawerOpen = false;
    this.syncDrawerState();
    if (this.elements.btnMenu && this.isDrawerLayout()) {
      this.elements.btnMenu.focus();
    }
    if (resume && this.autoPausedByOverlay && this.engine.state === GAME_STATES.PAUSED) {
      this.autoPausedByOverlay = false;
      this.engine.state = GAME_STATES.PLAYING;
      this.refresh(this.engine, this.lastExtra);
    }
  }

  syncDrawerState() {
    const isOpen = this.isDrawerOpen;
    this.syncMergeShakeGesture?.();
    if (this.elements.appShell) {
      this.elements.appShell.classList.toggle(DRAWER_OPEN_CLASS, isOpen);
    }
    for (const behind of [this.elements.hudBar, this.elements.stageContainer]) {
      if (behind) {
        behind.inert = isOpen;
      }
    }
    if (this.elements.btnMenu) {
      this.elements.btnMenu.setAttribute('aria-expanded', String(isOpen));
    }
    const drawer = this.elements.drawer;
    if (drawer) {
      if (isOpen) {
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
      } else {
        drawer.removeAttribute('role');
        drawer.removeAttribute('aria-modal');
      }
    }
  }

  /**
   * Builds the menu's star progress once: the glyphs are hidden from screen readers, a
   * visually hidden span states the count, and the next target follows.
   */
  ensureDrawerStarParts() {
    const host = this.elements.drawerStarProgress;
    if (this.drawerStarParts?.host === host) {
      return this.drawerStarParts;
    }
    const glyphs = document.createElement('span');
    glyphs.setAttribute('aria-hidden', 'true');
    const count = document.createElement('span');
    count.className = VISUALLY_HIDDEN_CLASS;
    const next = document.createElement('span');
    host.textContent = '';
    host.append(glyphs, count, ' ', next);
    this.drawerStarParts = { host, glyphs, count, next };
    return this.drawerStarParts;
  }

  /** Copies the HUD values the compact layout hides into the menu. */
  syncDrawerStats() {
    renderFluxPerkChips(this.elements.hudPerks, this.engine);
    renderFluxPerkChips(this.elements.drawerPerks, this.engine, this.elements.drawerPerksStat);
    if (this.elements.starProgress && this.elements.drawerStarProgress) {
      const parts = this.ensureDrawerStarParts();
      const hudStars = renderedStarGlyphs.get(this.elements.starGlyphs);
      if (hudStars) {
        this.renderStarGlyphs(parts.glyphs, hudStars.stars, hudStars.maxStars);
      }
      setTextIfChanged(parts.count, this.elements.starCount?.textContent?.trim() || '');
      setTextIfChanged(parts.next, this.elements.starNext?.textContent?.trim() || '');
      this.elements.drawerStarProgress.classList.toggle(
        'hidden',
        this.elements.starProgress.classList.contains('hidden')
      );
    }
    const mirrors = [
      [this.elements.modeBanner, this.elements.drawerMode],
      [this.elements.coinsValue, this.elements.drawerCoins],
      [this.elements.highScoreValue, this.elements.drawerBest],
      [this.elements.overchargePct, this.elements.drawerOvercharge]
    ];
    for (const [source, mirror] of mirrors) {
      if (source && mirror) {
        setTextIfChanged(mirror, source.textContent);
        mirror.classList.toggle('hidden', source.classList.contains('hidden'));
      }
    }
  }

  isRunActive() {
    return this.engine.state === GAME_STATES.PLAYING || this.engine.state === GAME_STATES.PAUSED;
  }

  /**
   * Victory stars as one element per star, so CSS can pop them in one after another.
   * The glyphs are decorative; the label next to them carries the count.
   */
  buildVictoryStars(stars, maxStars) {
    const theme = this.gameConfig.theme;
    const stepMs = this.gameConfig.victory.starRevealStepMs;
    const glyphs = document.createElement('span');
    glyphs.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < maxStars; i++) {
      const star = document.createElement('span');
      const isFilled = i < stars;
      star.className = isFilled ? 'victory-star filled' : 'victory-star';
      star.textContent = isFilled ? theme.starFilledSymbol : theme.starEmptySymbol;
      star.style.animationDelay = `${i * stepMs}ms`;
      glyphs.append(star);
    }
    this.victoryStarsLabel = document.createElement('span');
    this.victoryStarsLabel.className = 'victory-stars-label';
    this.victoryStarsLabel.textContent = t('modals.victory.stats.stars', { stars, maxStars });
    this.elements.victoryStars.replaceChildren(glyphs, this.victoryStarsLabel);
  }

  formatVictoryScoreText(value, isNewRecord = false) {
    const base = t('modals.victory.stats.score', { score: formatNumber(value) });
    return isNewRecord ? `${base} - ${t('modals.victory.stats.newRecordBadge')}` : base;
  }

  /**
   * Rolls the victory score up from zero (ease-out), or writes it at once under reduced
   * motion. Every frame goes through the same i18n line as the final value.
   */
  startScoreCountUp(finalScore, isNewRecord = false) {
    this.stopScoreCountUp();
    this.elements.victoryScore?.classList.toggle('is-new-record', Boolean(isNewRecord));
    const writeScore = (value) => {
      setTextIfChanged(this.elements.victoryScore, this.formatVictoryScoreText(value, isNewRecord));
    };
    const durationMs = this.gameConfig.victory.countUpMs;
    if (this.storageManager.getReducedMotion() || durationMs <= 0 || typeof requestAnimationFrame !== 'function') {
      writeScore(finalScore);
      return;
    }
    let startTime = null;
    const step = (now) => {
      if (startTime === null) {
        startTime = now;
      }
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - (1 - progress) ** COUNT_UP_EASE_POWER;
      writeScore(Math.round(finalScore * eased));
      this.scoreCountUpFrame = progress < 1 ? requestAnimationFrame(step) : null;
    };
    writeScore(0);
    this.scoreCountUpFrame = requestAnimationFrame(step);
  }

  stopScoreCountUp() {
    if (this.scoreCountUpFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.scoreCountUpFrame);
    }
    this.scoreCountUpFrame = null;
  }

  /** Display name of a Flux shape; a two-part shape reads "left and right". */
  formatFluxShapeName(shapeIds) {
    const names = shapeIds.map((id) => {
      if (isGeneratedShapeId(id)) {
        const { type, fill, points } = decodeGeneratedShapeId(id);
        return t(`gameplay.flux.generated.${type}.${fill}`, { count: points });
      }
      return t(`gameplay.flux.shapes.${id}`);
    });
    if (names.length > 1) {
      return t('gameplay.flux.shapes.pairFormat', { left: names[0], right: names[1] });
    }
    return names[0] || '';
  }

  /** Theme of a generated chapter: its featured mechanic, or its pair of them. */
  formatChapterTheme(featuredMechanics) {
    return formatChapterTheme(featuredMechanics);
  }

  /**
   * Display name of a campaign level: its own name when authored, else its chapter theme
   * and its place in the chapter, then its format when it is not a standard level.
   * @param {object} summary - A level summary from the level catalog.
   */
  formatLevelName(summary) {
    return formatLevelName(summary);
  }

  /** Description of a campaign level, from its summary in the level catalog. */
  formatLevelDescription(summary) {
    return formatLevelDescription(summary);
  }

  /**
   * Renders the stars as one span per star so CSS can tell an earned star from an empty one.
   * The text content matches formatStars; setTextIfChanged cannot be used because it only
   * compares text, so the rendered counts are tracked here.
   */
  renderStarGlyphs(element, stars, maxStars) {
    if (!element) {
      return;
    }
    const theme = this.gameConfig.theme;
    const filled = Math.max(0, Math.min(maxStars, stars));
    const previous = renderedStarGlyphs.get(element);
    if (previous && previous.stars === filled && previous.maxStars === maxStars) {
      return;
    }
    const spans = [];
    for (let i = 0; i < maxStars; i++) {
      const star = document.createElement('span');
      const isFilled = i < filled;
      star.className = isFilled ? STAR_EARNED_CLASS : STAR_EMPTY_CLASS;
      star.textContent = isFilled ? theme.starFilledSymbol : theme.starEmptySymbol;
      spans.push(star);
    }
    element.textContent = '';
    element.append(...spans);
    renderedStarGlyphs.set(element, { stars: filled, maxStars });
  }

  formatStars(stars, maxStars) {
    const theme = this.gameConfig.theme;
    const filled = Math.max(0, Math.min(maxStars, stars));
    return theme.starFilledSymbol.repeat(filled) + theme.starEmptySymbol.repeat(maxStars - filled);
  }

  isCampaignRunActive() {
    return this.engine.mode === GAME_MODES.CAMPAIGN && this.isRunActive();
  }

  /** True when the current run accepts special-ammo refills from the Workshop. */
  canBuySpecialAmmo() {
    // The engine refuses a purchase while the run cannot be saved (shot in flight, stage change).
    return this.isRunOpenToAmmo() && this.engine.canBuySpecialAmmo?.() !== false;
  }

  /** True when the run sells special ammo at all (active, not Puzzle, and specials are offered), whatever its state right now. */
  isRunOpenToAmmo() {
    return this.isRunActive() && this.engine.mode !== GAME_MODES.PUZZLE && this.engine.offersSpecialBalls?.() !== false;
  }

  /**
   * i18n key explaining why special ammo cannot be bought right now, or null when the run is
   * simply not open to ammo (no run, Puzzle, purist) or the purchase is allowed.
   */
  getSpecialAmmoBlockReasonKey() {
    if (!this.isRunOpenToAmmo()) {
      return null;
    }
    const reason = this.engine.getSpecialAmmoBlockReason?.();
    return reason ? SPECIAL_AMMO_BLOCK_REASON_KEYS[reason] || null : null;
  }

  /** Re-renders the open Workshop when the ammo purchase state changed since the last render. */
  syncShopAmmoAvailability() {
    const signature = `${this.canBuySpecialAmmo()}:${this.getSpecialAmmoBlockReasonKey()}`;
    if (signature === this.lastAmmoAvailability) {
      return;
    }
    this.lastAmmoAvailability = signature;
    if (this.elements.modalShop && !this.elements.modalShop.classList.contains('hidden')) {
      this.renderShopContents();
    }
  }

  /**
   * Puzzle stage launched from navigation: keeps the active stage when already in
   * Puzzle mode, otherwise resumes at the highest unlocked stage.
   */
  getSuggestedPuzzleStage() {
    const totalPuzzles = Math.max(1, this.gameConfig?.puzzles?.length || 1);
    const bestStage = this.storageManager?.getPuzzleBestStage?.() || 1;
    const unlockedStage = Math.min(totalPuzzles, Math.max(1, bestStage));
    if (this.engine?.mode === GAME_MODES.PUZZLE && this.engine.currentPuzzleStage >= 1) {
      return Math.min(this.engine.currentPuzzleStage, unlockedStage);
    }
    return unlockedStage;
  }

  /** The level the campaign map and the Play hub put forward: the one being played, else the furthest unlocked. */
  getSuggestedLevelId() {
    if (this.engine.mode === GAME_MODES.CAMPAIGN && this.engine.currentLevelId) {
      return this.engine.currentLevelId;
    }
    return Math.min(this.storageManager.getUnlockedLevel(), this.engine.levelCatalog.lastId);
  }

  /** Display name of a chapter of the level select. */
  formatChapterName(chapter) {
    return formatChapterName(chapter);
  }

  /** Renders the direct stage-selection buttons (1..N) for Puzzle Mode inside the Levels modal. */
  renderPuzzleStagesStrip() {
    const strip = this.elements?.puzzleStagesStrip;
    if (!strip) {
      return;
    }
    const totalPuzzles = Math.max(1, this.gameConfig?.puzzles?.length || 1);
    const unlockedStage = Math.min(
      totalPuzzles,
      Math.max(1, this.storageManager?.getPuzzleBestStage?.() || 1)
    );
    const stageStats = this.storageManager?.getPuzzleStageStats?.() || {};
    const maxStars = this.gameConfig?.scoring?.maxStars || 0;
    strip.replaceChildren();
    for (let stageNum = 1; stageNum <= totalPuzzles; stageNum++) {
      const isUnlocked = stageNum <= unlockedStage;
      const isCurrent =
        this.engine?.mode === GAME_MODES.PUZZLE && this.engine.currentPuzzleStage === stageNum;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `puzzle-stage-btn${isCurrent ? ' active' : ''}${isUnlocked ? '' : ' locked'}`;
      btn.dataset.puzzleStage = String(stageNum);
      const label = t('modals.levelSelect.arcade.puzzleStage', { stage: formatNumber(stageNum) });
      if (isCurrent) {
        btn.setAttribute('aria-current', 'true');
      }
      if (isUnlocked) {
        const stars = stageStats[stageNum]?.stars || 0;
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        const starsEl = document.createElement('span');
        starsEl.className = 'puzzle-stage-stars';
        starsEl.setAttribute('aria-hidden', 'true');
        starsEl.textContent = this.formatStars(stars, maxStars);
        btn.append(labelEl, starsEl);
        btn.setAttribute(
          'aria-label',
          t('modals.levelSelect.arcade.puzzleStageAria', {
            stage: formatNumber(stageNum),
            stars: formatNumber(stars),
            maxStars: formatNumber(maxStars)
          })
        );
        btn.addEventListener('click', () => {
          this.requestDestructiveAction(
            () => {
              this.hideAllModals();
              this.engine.startPuzzleMode(stageNum);
            },
            () => label
          );
        });
      } else {
        btn.textContent = label;
        const requiredStage = Math.max(1, stageNum - 1);
        const lockText = t('modals.levelSelect.arcade.puzzleStageLocked', {
          previous: formatNumber(requiredStage)
        });
        btn.setAttribute('aria-disabled', 'true');
        btn.title = lockText;
        btn.setAttribute('aria-label', `${label} - ${lockText}`);
        btn.addEventListener('click', () => {
          this.showLockedLevelHint(requiredStage, 'modals.levelSelect.arcade.puzzleStageLocked');
        });
      }
      strip.appendChild(btn);
    }
  }

  /** Formats the mode-specific stage/wave/combo/coins line shown on the Game Over modal. */
  formatGameOverStageSummary(engine, summary) {
    if (engine.mode === GAME_MODES.FLUX) {
      const weeklyBestStage = engine.isWeeklyFluxRun === true
        ? this.storageManager.getWeeklyFluxBest?.(engine.weeklyWeekKey)?.stage || 0
        : 0;
      const bestStage = engine.isWeeklyFluxRun === true ? weeklyBestStage : this.storageManager.getFluxBestStage();
      return t('modals.gameOver.stats.fluxStage', {
        stage: formatNumber(engine.fluxStage),
        best: formatNumber(Math.max(engine.fluxStage, bestStage))
      });
    }
    if (engine.mode === GAME_MODES.BOSS_RUSH) {
      return t('modals.gameOver.stats.bossRushSummary', {
        wave: formatNumber(engine.bossRushWave),
        best: formatNumber(Math.max(engine.bossRushWave, this.storageManager.getBossRushBestWave?.() || 1)),
        coins: formatNumber(summary?.earnedCoins || 0)
      });
    }
    if (engine.mode === GAME_MODES.CLASSIC) {
      return t('modals.gameOver.stats.classicSummary', {
        stage: formatNumber(engine.classicStage),
        best: formatNumber(Math.max(engine.classicStage, this.storageManager.getClassicBestStage?.() || 1)),
        coins: formatNumber(summary?.earnedCoins || 0)
      });
    }
    if (engine.mode === GAME_MODES.PUZZLE) {
      return t('modals.gameOver.stats.puzzleSummary', {
        stage: formatNumber(engine.currentPuzzleStage),
        total: formatNumber(Math.max(1, this.gameConfig.puzzles?.length || 1))
      });
    }
    if (engine.mode === GAME_MODES.PINBALL) {
      return t('modals.gameOver.stats.pinballSummary', {
        stage: formatNumber(engine.pinballStage || 1),
        best: formatNumber(Math.max(engine.pinballStage || 1, this.storageManager.getPinballBestStage?.() || 1)),
        coins: formatNumber(summary?.earnedCoins || 0)
      });
    }
    if (engine.mode === GAME_MODES.MERGE) {
      return t('modals.gameOver.stats.mergeSummary', {
        tier: formatNumber(engine.mergeBestTier || 1),
        best: formatNumber(Math.max(engine.mergeBestTier || 1, this.storageManager.getMergeBestTier?.() || 1)),
        coins: formatNumber(summary?.earnedCoins || 0)
      });
    }
    if (
      engine.mode === GAME_MODES.ENDLESS ||
      engine.mode === GAME_MODES.DAILY ||
      engine.mode === GAME_MODES.BLITZ ||
      engine.mode === GAME_MODES.CASCADE ||
      engine.mode === GAME_MODES.HEX_GRID ||
      engine.mode === GAME_MODES.ORBITAL ||
      engine.mode === GAME_MODES.CONVOY
    ) {
      return t('modals.gameOver.stats.waveSummary', {
        wave: formatNumber(engine.waveCount),
        combo: formatNumber(Math.max(1, summary?.maxCombo || engine.combo || 1)),
        coins: formatNumber(summary?.earnedCoins || 0)
      });
    }
    return '';
  }

  /** Fills the gauge from the last star earned toward the next one. */
  updateStarMeter(score, thresholds, nextThreshold) {
    const meter = this.elements.starMeter;
    if (!meter) {
      return;
    }
    const pct = computeStarProgressPct(score, thresholds, nextThreshold);
    this.elements.starMeterFill.style.width = `${pct}%`;
    setAttributeIfChanged(meter, 'aria-valuenow', String(pct));
  }

}

installMethods(UIManager, uiGamepadMethods);
installMethods(UIManager, uiInputBindingMethods);
installMethods(UIManager, uiModalMethods);
installMethods(UIManager, uiSettingsControlMethods);
installMethods(UIManager, uiHudRefreshMethods);
installMethods(UIManager, uiStatsMethods);
installMethods(UIManager, uiGhostDuelMethods);
installMethods(UIManager, uiVersusMethods);
installMethods(UIManager, uiVersusLocalMethods);
installMethods(UIManager, uiCalibrationMethods);
installMethods(UIManager, uiPlayHubMethods);
installMethods(UIManager, uiLevelSelectMethods);
