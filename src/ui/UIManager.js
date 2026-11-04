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

import {
  GAME_MODES,
  GAME_OVER_REASONS,
  GAME_STATES,
  INPUT_MODES,
  MATH_CONSTANTS,
  OBJECTIVE_TYPES,
  SPECIAL_TYPES_ORDER
} from '../core/Constants.js';
import { i18n, t, formatNumber } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { resolveHintText } from '../game/Discovery.js';
import {
  buildShareText,
  formatDailyCountdown,
  getMsUntilNextDaily,
  parseFluxSeedInput
} from '../game/DailyShare.js';
import { decodeGeneratedShapeId, isGeneratedShapeId } from '../game/layouts/ShapeGenerator.js';
import {
  SPECIAL_ICON_HIGHLIGHT_POSITION,
  specialIconBackground,
  buildCodexPane
} from './CodexView.js';
import {
  FULL_PERCENT,
  SHOP_TABS,
  computeAchievementProgress,
  rerenderWorkshopKeepingFocus,
  renderWorkshopContents
} from './WorkshopView.js';
import {
  LEVEL_CHAPTER_TAB_ID_PREFIX,
  LABELLED_LEVEL_FORMATS,
  LEVEL_FORMAT_BADGE_KEYS,
  resolveLevelFormatBadgeKey,
  formatChapterTheme,
  formatLevelName,
  formatLevelDescription,
  formatChapterName,
  renderLevelChapters,
  renderLevelCards
} from './LevelSelectView.js';

export {
  SPECIAL_ICON_HIGHLIGHT_POSITION,
  specialIconBackground,
  FULL_PERCENT,
  SHOP_TABS,
  computeAchievementProgress,
  LEVEL_CHAPTER_TAB_ID_PREFIX,
  LABELLED_LEVEL_FORMATS,
  LEVEL_FORMAT_BADGE_KEYS,
  resolveLevelFormatBadgeKey
};

/** Elements a modal focus trap may cycle through (inactive tabs use tabindex="-1"). */
export const MODAL_FOCUSABLE_SELECTOR =
  'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([tabindex="-1"]), textarea:not([tabindex="-1"]), [href]:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

/** Ancestors that remove an element from the interactive tree. */
const NON_INTERACTIVE_ANCESTOR_SELECTOR = '.hidden, [hidden], [inert]';

/** Error name of a share sheet the player dismissed: not a failure, nothing to report. */
const SHARE_ABORT_ERROR_NAME = 'AbortError';

/**
 * Media query matched once the game runs as an installed app, so the Settings install
 * entry has nothing left to offer.
 */
const STANDALONE_DISPLAY_QUERY = '(display-mode: standalone), (display-mode: fullscreen)';

/**
 * True when the browser exposes the Fullscreen API (standard or WebKit-prefixed) and
 * allows entering fullscreen on the document root.
 * @param {object|null|undefined} doc - The document object.
 * @returns {boolean}
 */
export function isFullscreenSupported(doc) {
  if (!doc || !doc.documentElement) {
    return false;
  }
  const root = doc.documentElement;
  const canRequest =
    typeof root.requestFullscreen === 'function' || typeof root.webkitRequestFullscreen === 'function';
  const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? canRequest;
  return Boolean(canRequest && enabled);
}

/**
 * @param {object|null|undefined} doc - The document object.
 * @returns {boolean} Whether the document is currently in fullscreen mode.
 */
export function isDocumentFullscreen(doc) {
  return Boolean(doc && (doc.fullscreenElement || doc.webkitFullscreenElement));
}

/**
 * True in Safari on iPhone and iPad outside the installed app. Only that browser exposes
 * `navigator.standalone`, and it never fires `beforeinstallprompt`, so the install entry
 * there is a hint naming the manual steps instead of a button.
 * @param {object|undefined} nav - The navigator object.
 * @param {boolean} matchesStandalone - Whether the standalone display mode query matches.
 * @returns {boolean}
 */
export function isIosBrowserTab(nav, matchesStandalone) {
  return Boolean(nav) && nav.standalone === false && !matchesStandalone;
}

/** Root class mirroring the in-app reduced motion setting for CSS. */
export const REDUCED_MOTION_CLASS = 'reduced-motion';

/** Root class mirroring the in-app high contrast setting, so CSS raises the HUD and menus too. */
export const HIGH_CONTRAST_CLASS = 'high-contrast';

/** Cubic ease-out of the victory score roll-up: fast at first, settling on the total. */
const COUNT_UP_EASE_POWER = 3;

/** App shell class that slides the menu in on portrait phones. */
const DRAWER_OPEN_CLASS = 'drawer-open';
const VISUALLY_HIDDEN_CLASS = 'visually-hidden';

/** Pointer types that mean a finger-like input without a keyboard at hand. */
const TOUCH_POINTER_TYPES = new Set(['touch', 'pen']);

/** Root data attribute mirroring the current input mode for CSS. */
const INPUT_MODE_DATASET_KEY = 'input';

/** Special ball button with no stock left: a click opens the Workshop ammo tab. */
const EMPTY_POWERUP_CLASS = 'is-empty';

/** Mode buttons, keyed by the game mode each one starts. */
const MODE_BUTTON_KEYS = Object.freeze({
  [GAME_MODES.CAMPAIGN]: ['btnLevels'],
  [GAME_MODES.ENDLESS]: ['btnEndless'],
  [GAME_MODES.DAILY]: ['btnDaily'],
  [GAME_MODES.FLUX]: ['btnFlux'],
  [GAME_MODES.PUZZLE]: ['btnModePuzzle'],
  [GAME_MODES.BLITZ]: ['btnModeBlitz'],
  [GAME_MODES.BOSS_RUSH]: ['btnModeBossRush'],
  [GAME_MODES.CASCADE]: ['btnModeCascade']
});

/** Pause modal hints that have one wording per input mode. */
const PAUSE_INPUT_HINTS = Object.freeze([
  { elementId: 'pause-instruction-aim', key: 'modals.pause.instructions.aim' },
  { elementId: 'pause-instruction-swap', key: 'modals.pause.instructions.swap' },
  { elementId: 'pause-instruction-cancel', key: 'modals.pause.instructions.cancel' },
  { elementId: 'pause-instruction-keyboard', key: 'modals.pause.instructions.keyboard' }
]);

/** Accessible names that have one wording per input mode (the board's text alternative). */
export const INPUT_ARIA_HINTS = Object.freeze([{ elementId: 'game-canvas', key: 'hud.canvas.aria.label' }]);

/** Default star ceiling when no scoring config is passed to resolveNextCampaignTarget. */
const DEFAULT_MAX_STARS = 3;

/**
 * How far a score has gone from the last star threshold it passed toward the next one.
 * @param {number} score - Current score.
 * @param {number[]} thresholds - Star thresholds, ascending.
 * @param {number|undefined} nextThreshold - The first threshold above the score, if any.
 * @returns {number} A whole percentage; 100 once every star is earned.
 */
export function computeStarProgressPct(score, thresholds, nextThreshold) {
  if (nextThreshold === undefined) {
    return FULL_PERCENT;
  }
  const passed = thresholds.filter((th) => th <= score);
  const floor = passed.length > 0 ? passed[passed.length - 1] : 0;
  const span = nextThreshold - floor;
  if (span <= 0) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, (score - floor) / span)) * FULL_PERCENT);
}

/**
 * Maps a pointer event type to an input mode; mouse and unknown types keep the
 * mouse/keyboard wording.
 */
export function inputModeForPointerType(pointerType) {
  return TOUCH_POINTER_TYPES.has(pointerType) ? INPUT_MODES.TOUCH : INPUT_MODES.POINTER;
}

/** Keys whose action is a one-shot toggle or trigger; auto-repeat must not re-fire them. */
const REPEAT_SENSITIVE_KEY_CODES = new Set(['Space', 'KeyF', 'Enter', 'NumpadEnter', 'Escape']);
const SPECIAL_BALL_KEY_PATTERN = /^Digit\d$/;

/**
 * Keeps only elements a keyboard user can actually reach: not disabled,
 * not tabindex="-1", not inside a hidden or inert subtree, and rendered.
 */
export function filterFocusTrapCandidates(elements) {
  return Array.from(elements).filter((el) => {
    if (!el || el.disabled || el.hidden) {
      return false;
    }
    if (typeof el.getAttribute === 'function' && el.getAttribute('tabindex') === '-1') {
      return false;
    }
    if (typeof el.closest === 'function' && el.closest(NON_INTERACTIVE_ANCESTOR_SELECTOR)) {
      return false;
    }
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) {
      return false;
    }
    return true;
  });
}

/** True when a held-down key repeat must be ignored (aiming arrows keep repeating). */
export function shouldIgnoreRepeatedKey(code, isRepeat) {
  if (!isRepeat || typeof code !== 'string') {
    return false;
  }
  return REPEAT_SENSITIVE_KEY_CODES.has(code) || SPECIAL_BALL_KEY_PATTERN.test(code);
}

/**
 * True for Ctrl, Cmd and Alt chords, which belong to the browser (find, tab switching,
 * history). Shift is not one of them: it selects the fast aim step.
 */
export function isBrowserShortcut(event) {
  return Boolean(event.ctrlKey || event.metaKey || event.altKey);
}

/**
 * The slide-in menu opens only in the drawer layout, over nothing else: not over a
 * dialog, and not during the victory celebration, whose dialog would open behind it.
 */
export function canOpenDrawer({ isOpen, isDrawerLayout, isModalOpen, isVictoryCelebrating }) {
  return !isOpen && isDrawerLayout && !isModalOpen && !isVictoryCelebrating;
}

/**
 * True when a shared Flux link would replace a different saved run, so the player must
 * confirm first. A link to the very run that is saved resumes it instead.
 * @param {string|null|undefined} sharedSeed - The seed read from the URL, if any.
 * @param {{engine?: {fluxSeed?: string}}|null|undefined} savedSnapshot - The stored run.
 * @returns {boolean}
 */
export function isSharedFluxOverSavedRun(sharedSeed, savedSnapshot) {
  return Boolean(sharedSeed && savedSnapshot && savedSnapshot.engine?.fluxSeed !== sharedSeed);
}

/** What the victory window's main button does: play the next level, jump to the next < 3★ level, or open the level select. */
export const VICTORY_NEXT_ACTIONS = Object.freeze({
  NEXT_LEVEL: 'nextLevel',
  NEXT_INCOMPLETE: 'nextIncomplete',
  LEVEL_SELECT: 'levelSelect'
});

/** Label of the victory window's main button, per action. */
export const VICTORY_NEXT_LABEL_KEYS = Object.freeze({
  [VICTORY_NEXT_ACTIONS.NEXT_LEVEL]: 'modals.victory.button.nextLevel',
  [VICTORY_NEXT_ACTIONS.NEXT_INCOMPLETE]: 'modals.victory.button.nextIncomplete',
  [VICTORY_NEXT_ACTIONS.LEVEL_SELECT]: 'modals.victory.button.backToLevels'
});

/**
 * Resolves the next campaign destination after winning a level. When the < 3★ filter is active,
 * looks for the next unlocked level that has not yet earned 3 stars before falling back.
 * @param {number} currentLevelId - The level just won.
 * @param {{has: (levelId: number) => boolean, firstId?: number, lastId?: number}} levelCatalog - Campaign catalog.
 * @param {{filterIncomplete?: boolean, unlockedLevel?: number, levelStats?: object, maxStars?: number}} [options]
 * @returns {{action: string, targetLevelId: number|null}}
 */
export function resolveNextCampaignTarget(
  currentLevelId,
  levelCatalog,
  { filterIncomplete = false, unlockedLevel = currentLevelId, levelStats = {}, maxStars = DEFAULT_MAX_STARS } = {}
) {
  if (filterIncomplete && Number.isInteger(levelCatalog?.firstId) && Number.isInteger(levelCatalog?.lastId)) {
    const maxReachable = Math.min(unlockedLevel, levelCatalog.lastId);
    for (let id = currentLevelId + 1; id <= maxReachable; id++) {
      if (levelCatalog.has(id) && (levelStats[id]?.stars || 0) < maxStars) {
        return { action: VICTORY_NEXT_ACTIONS.NEXT_INCOMPLETE, targetLevelId: id };
      }
    }
    const wrapLimit = Math.min(maxReachable, currentLevelId - 1);
    for (let id = levelCatalog.firstId; id <= wrapLimit; id++) {
      if (levelCatalog.has(id) && (levelStats[id]?.stars || 0) < maxStars) {
        return { action: VICTORY_NEXT_ACTIONS.NEXT_INCOMPLETE, targetLevelId: id };
      }
    }
  }
  if (levelCatalog.has(currentLevelId + 1)) {
    return { action: VICTORY_NEXT_ACTIONS.NEXT_LEVEL, targetLevelId: currentLevelId + 1 };
  }
  return { action: VICTORY_NEXT_ACTIONS.LEVEL_SELECT, targetLevelId: null };
}

/** i18n key of the defeat explanation; an unknown reason reads as a crossed line. */
export function gameOverReasonKey(reason) {
  const known = Object.values(GAME_OVER_REASONS).includes(reason) ? reason : GAME_OVER_REASONS.LINE_CROSSED;
  return `modals.gameOver.reason.${known}`;
}

/**
 * Where focus goes when the dialog on top changed under it (a stacked Confirm closed
 * over Pause or Levels): nowhere when focus is already inside the top dialog, else the
 * element that opened the closed dialog when it belongs to the top one, else the top
 * dialog's first reachable element.
 */
export function resolveModalFocusTarget(topModal, activeElement, preferred, focusables) {
  if (!topModal || (activeElement && topModal.contains(activeElement))) {
    return null;
  }
  if (preferred && topModal.contains(preferred) && filterFocusTrapCandidates([preferred]).length > 0) {
    return preferred;
  }
  return filterFocusTrapCandidates(focusables)[0] || null;
}

/** Latest text waiting to be written into a live region revealed this frame. */
const pendingLiveRegionTexts = new WeakMap();

/**
 * Shows a polite live region and writes its text. A region revealed from display:none
 * is shown empty first and filled on the next frame: screen readers ignore text that
 * was already there when the region appeared.
 *
 * @param {{region: Element, textElement: Element, text: string, schedule: (cb: Function) => void}} options
 */
export function revealLiveRegion({ region, textElement, text, schedule }) {
  if (pendingLiveRegionTexts.has(textElement)) {
    region.classList.remove('hidden');
    pendingLiveRegionTexts.set(textElement, text);
    return;
  }
  if (!region.classList.contains('hidden')) {
    setTextIfChanged(textElement, text);
    return;
  }
  textElement.textContent = '';
  region.classList.remove('hidden');
  pendingLiveRegionTexts.set(textElement, text);
  schedule(() => {
    const latest = pendingLiveRegionTexts.get(textElement);
    pendingLiveRegionTexts.delete(textElement);
    if (!region.classList.contains('hidden')) {
      setTextIfChanged(textElement, latest);
    }
  });
}

/** Runs a callback on the next frame, or at once where frames are not available. */
function scheduleNextFrame(callback) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
  } else {
    callback();
  }
}

/** Screen orientation angles, in degrees, as reported by screen.orientation.angle. */
const SCREEN_ANGLES = Object.freeze({ PORTRAIT: 0, LANDSCAPE_LEFT: 90, UPSIDE_DOWN: 180, LANDSCAPE_RIGHT: 270 });
const FULL_TURN_DEGREES = 360;

/**
 * Signed share of gravity pushed sideways by the device tilt. The tilt axis follows the
 * screen orientation; tilts inside the dead zone count as level, and the share reaches
 * its maximum at fullTiltDegrees.
 * @param {{gamma: number|null, beta: number|null}} orientation - A deviceorientation event.
 * @param {number} screenAngle - screen.orientation.angle.
 * @param {{fullTiltDegrees: number, deadZoneDegrees: number, maxGravityShare: number}} tiltCfg
 */
export function computeTiltShare(orientation, screenAngle, tiltCfg) {
  const angle = ((screenAngle % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;
  const gamma = orientation.gamma || 0;
  const beta = orientation.beta || 0;
  let degrees = gamma;
  if (angle === SCREEN_ANGLES.UPSIDE_DOWN) {
    degrees = -gamma;
  } else if (angle === SCREEN_ANGLES.LANDSCAPE_LEFT) {
    degrees = beta;
  } else if (angle === SCREEN_ANGLES.LANDSCAPE_RIGHT) {
    degrees = -beta;
  }
  const magnitude = Math.abs(degrees) - tiltCfg.deadZoneDegrees;
  if (magnitude <= 0) {
    return 0;
  }
  const span = tiltCfg.fullTiltDegrees - tiltCfg.deadZoneDegrees;
  return Math.sign(degrees) * Math.min(1, magnitude / span) * tiltCfg.maxGravityShare;
}

/** Writes text only when it differs, so live regions are not re-announced needlessly. */
function setTextIfChanged(element, text) {
  if (element && element.textContent !== text) {
    element.textContent = text;
  }
}

function setAttributeIfChanged(element, name, value) {
  if (element && element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/**
 * Manages DOM HUD updates, accessible modal dialogs, shop/codex tabs,
 * and keyboard/button event bindings.
 */
export class UIManager {
  constructor({ engine, renderer, storageManager, audioManager, gameConfig, ballsConfig }) {
    this.engine = engine;
    this.renderer = renderer;
    this.storageManager = storageManager;
    this.audioManager = audioManager;
    this.gameConfig = gameConfig;
    this.ballsConfig = ballsConfig;

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
      highScoreValue: document.getElementById('hud-best-value'),
      coinsValue: document.getElementById('hud-coins-value'),
      overchargePct: document.getElementById('hud-overcharge-pct'),
      overchargeFill: document.getElementById('hud-overcharge-fill'),
      modeBanner: document.getElementById('hud-mode-banner'),
      compactInfo: document.getElementById('hud-compact-info'),
      shotsLabel: document.getElementById('hud-shots-label'),
      shotsValue: document.getElementById('hud-shots-value'),
      comboBadge: document.getElementById('hud-combo-badge'),
      frozenBadge: document.getElementById('hud-frozen-badge'),
      powerupsContainer: document.getElementById('powerups-bar'),
      powerupsHeader: document.getElementById('powerups-header'),
      powerupsEmpty: document.getElementById('powerups-empty'),
      btnLevels: document.getElementById('btn-levels'),
      btnEndless: document.getElementById('btn-endless'),
      btnDaily: document.getElementById('btn-daily'),
      btnFlux: document.getElementById('btn-flux'),
      btnShop: document.getElementById('btn-shop'),
      btnRestart: document.getElementById('btn-restart'),
      btnPause: document.getElementById('btn-pause'),
      btnSound: document.getElementById('btn-sound'),
      btnContrast: document.getElementById('btn-contrast'),
      btnPatterns: document.getElementById('btn-patterns'),
      btnTilt: document.getElementById('btn-tilt'),
      btnMotion: document.getElementById('btn-motion'),
      btnAnimSpeed: document.getElementById('btn-anim-speed'),
      btnFullscreen: document.getElementById('btn-fullscreen'),
      btnFullscreenHud: document.getElementById('btn-fullscreen-hud'),
      btnResetHints: document.getElementById('btn-reset-hints'),
      btnLang: document.getElementById('btn-lang'),
      swapBtn: document.getElementById('btn-swap-ball'),
      polarityBtn: document.getElementById('btn-polarity'),
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
      modalLevels: document.getElementById('modal-levels'),
      btnModePuzzle: document.getElementById('btn-mode-puzzle'),
      btnModeBlitz: document.getElementById('btn-mode-blitz'),
      btnModeBossRush: document.getElementById('btn-mode-boss-rush'),
      btnModeCascade: document.getElementById('btn-mode-cascade'),
      arcadeBestPuzzle: document.getElementById('arcade-best-puzzle'),
      arcadeBestBlitz: document.getElementById('arcade-best-blitz'),
      arcadeBestBossRush: document.getElementById('arcade-best-boss-rush'),
      arcadeBestCascade: document.getElementById('arcade-best-cascade'),
      puzzleStagesStrip: document.getElementById('puzzle-stages-strip'),
      levelsStarsSummary: document.getElementById('levels-stars-summary'),
      btnLevelsFilterIncomplete: document.getElementById('btn-levels-filter-incomplete'),
      inputFluxSeed: document.getElementById('input-flux-seed'),
      btnFluxSeedGo: document.getElementById('btn-flux-seed-go'),
      levelsChapters: document.getElementById('levels-chapters'),
      levelsChapterHint: document.getElementById('levels-chapter-hint'),
      levelsGrid: document.getElementById('levels-grid'),
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
      gameOverDailyNext: document.getElementById('gameover-daily-next'),
      btnContinueGameOver: document.getElementById('btn-continue-gameover'),
      btnRetry: document.getElementById('btn-retry'),
      btnSameSeedGameOver: document.getElementById('btn-same-seed-gameover'),
      btnLevelsGameOver: document.getElementById('btn-levels-gameover'),
      btnShareGameOver: document.getElementById('btn-share-gameover'),
      gameOverShareFallback: document.getElementById('gameover-share-fallback'),
      gameOverShareText: document.getElementById('gameover-share-text'),
      modalPause: document.getElementById('modal-pause'),
      pauseLevelTip: document.getElementById('pause-level-tip'),
      btnResume: document.getElementById('btn-resume'),
      btnRestartPause: document.getElementById('btn-restart-pause'),
      btnLevelsPause: document.getElementById('btn-levels-pause'),
      btnSettingsPause: document.getElementById('btn-settings-pause'),
      btnSettings: document.getElementById('btn-settings'),
      modalSettings: document.getElementById('modal-settings'),
      btnCloseSettings: document.getElementById('btn-close-settings'),
      btnInstall: document.getElementById('btn-install'),
      installIosHint: document.getElementById('install-ios-hint'),
      modalConfirm: document.getElementById('modal-confirm'),
      btnConfirmYes: document.getElementById('btn-confirm-yes'),
      btnConfirmNo: document.getElementById('btn-confirm-no'),
      srAnnouncer: document.getElementById('sr-announcer')
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
    this.levelsFilterIncomplete = false;
    this.autoPausedByOverlay = false;
    this.lastFocusedElement = null;
    this.stackedModalOpener = null;
    this.prevEngineState = null;
    this.isVictoryModalRevealed = false;
    this.isVictoryPresented = false;
    this.victoryStarsLabel = null;
    this.scoreCountUpFrame = null;
    this.inputMode = this.detectInitialInputMode();
    this.isDrawerOpen = false;
    this.drawerStarParts = null;
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
    this.updateInputHints();
  }

  /** A launcher label, followed by its keyboard shortcut only when a keyboard is in use. */
  formatLauncherLabel(labelKey, shortcutKey) {
    const label = t(labelKey);
    if (this.inputMode === INPUT_MODES.TOUCH) {
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
    for (const { elementId, key } of PAUSE_INPUT_HINTS) {
      setTextIfChanged(document.getElementById(elementId), t(`${key}.${this.inputMode}`));
    }
    for (const { elementId, key } of INPUT_ARIA_HINTS) {
      setAttributeIfChanged(document.getElementById(elementId), 'aria-label', t(`${key}.${this.inputMode}`));
    }
  }

  init() {
    this.applyCanvasLayoutVariables();
    this.applyInputMode();
    this.buildPowerupButtons();
    this.bindEvents();
    this.updateSoundButton();
    this.updateContrastButton();
    this.updatePatternsButton();
    this.setupTiltControl();
    this.updateMotionButton();
    this.updateAnimSpeedButton();
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
      this.updateFullscreenButton();
      this.updateLanguageButton();
      this.updateResetHintsFeedback();
      this.updateShareButtonLabel();
      this.updateConfirmButtonLabel();
      this.refresh(this.engine, this.lastExtra);
    });
  }

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
    if (this.elements.starProgress && this.elements.drawerStarProgress) {
      const parts = this.ensureDrawerStarParts();
      setTextIfChanged(parts.glyphs, this.elements.starGlyphs?.textContent?.trim() || '');
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
  }

  isRunActive() {
    return this.engine.state === GAME_STATES.PLAYING || this.engine.state === GAME_STATES.PAUSED;
  }

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
        this.closeOverlayModal(this.elements.modalLevels);
        if (this.engine.state === GAME_STATES.PAUSED) {
          this.engine.togglePause();
        }
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

    this.elements.btnSameSeedGameOver?.addEventListener('click', () => {
      if (this.engine.fluxSeed) {
        this.hideAllModals();
        this.engine.startFluxRun(this.engine.fluxSeed);
      }
    });

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
  }

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
    } else if (e.code === 'Enter') {
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
  }

  requestDestructiveAction(actionCallback, confirmLabelResolver = null, { always = false } = {}) {
    // `always` guards a run that holds progress before the first shot (a restored Flux run between shapes).
    const runHasBalls = this.isRunActive() && this.engine.physicsWorld.balls.length > 0;
    const isMidRound = runHasBalls && (always || this.engine.hasFiredInRound);

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
  }

  updateConfirmButtonLabel() {
    if (!this.elements?.btnConfirmYes) {
      return;
    }
    const customLabel =
      typeof this.pendingConfirmLabelResolver === 'function' ? this.pendingConfirmLabelResolver() : null;
    setTextIfChanged(this.elements.btnConfirmYes, customLabel || t('modals.confirm.button.confirm'));
  }

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
  }

  /** True when the run is paused by the menu, a menu dialog or the Confirm, not by the player. */
  isRunHeldByUi() {
    return this.autoPausedByOverlay || this.confirmPausedRun;
  }

  /**
   * Focuses a control only when its dialog is the one on top: a Confirm still open over a
   * window that just appeared keeps the focus, and the window gets it when the Confirm closes.
   */
  focusInTopModal(element) {
    const topModal = this.getActiveTopModal();
    if (element && topModal && topModal.contains(element)) {
      element.focus();
    }
  }

  getVictoryTargetOptions() {
    return {
      filterIncomplete: Boolean(this.levelsFilterIncomplete),
      unlockedLevel: this.storageManager?.getUnlockedLevel?.() || this.engine.currentLevelId,
      levelStats: this.storageManager?.getLevelStats?.() || {},
      maxStars: this.gameConfig?.scoring?.maxStars || DEFAULT_MAX_STARS
    };
  }

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
  }

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
        this.engine.startFluxRun(seed);
      },
      () => t('app.nav.button.flux')
    );
  }

  saveLastFocusedElement() {
    if (
      !this.isAnyModalOpen() &&
      document.activeElement &&
      document.activeElement !== document.body &&
      document.activeElement !== document.documentElement
    ) {
      this.lastFocusedElement = document.activeElement;
    }
  }

  /** All modals, topmost first: the first open one is the active dialog. */
  getModalsByPriority() {
    return [
      this.elements.modalConfirm,
      ...this.getOverlayModals(),
      this.elements.modalVictory,
      this.elements.modalGameOver,
      this.elements.modalPause
    ].filter(Boolean);
  }

  /** Dialogs opened from the menu over a run, which they pause until they close. */
  getOverlayModals() {
    return [this.elements.modalLevels, this.elements.modalShop, this.elements.modalSettings].filter(Boolean);
  }

  isAnyOverlayModalOpen() {
    return this.getOverlayModals().some((modal) => !modal.classList.contains('hidden'));
  }

  /**
   * Opens a menu dialog over the run, pausing it, and focuses the given control.
   * @param {HTMLElement} modal - The dialog to show.
   * @param {HTMLElement} [focusTarget] - The control that receives focus.
   */
  openOverlayModal(modal, focusTarget) {
    if (!modal) {
      return;
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
  }

  getActiveTopModal() {
    for (const m of this.getModalsByPriority()) {
      if (!m.classList.contains('hidden')) {
        return m;
      }
    }
    return null;
  }

  trapModalFocus(e) {
    this.trapFocusWithin(this.getActiveTopModal(), e);
  }

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
  }

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
    if (!anyOpen && this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      const target = this.lastFocusedElement;
      this.lastFocusedElement = null;
      target.focus();
    }
    if (anyOpen) {
      this.keepFocusInTopModal(topModal);
    } else {
      this.stackedModalOpener = null;
    }
  }

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
  }

  /** The Workshop tabs in display order, each with its tab button and panel. */
  getShopTabs() {
    return [
      { name: SHOP_TABS.UPGRADES, el: this.elements.tabShopUpgrades, pane: this.elements.shopUpgradesPane },
      { name: SHOP_TABS.AMMO, el: this.elements.tabShopAmmo, pane: this.elements.shopAmmoPane },
      { name: SHOP_TABS.STYLES, el: this.elements.tabShopStyles, pane: this.elements.shopStylesPane },
      { name: SHOP_TABS.ACHIEVEMENTS, el: this.elements.tabShopAchievements, pane: this.elements.achievementsGrid },
      { name: SHOP_TABS.CODEX, el: this.elements.tabShopCodex, pane: this.elements.codexPane }
    ].filter((tab) => tab.el && tab.pane);
  }

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
  }

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
  }

  closeOverlayModal(modalElement) {
    modalElement.classList.add('hidden');
    if (modalElement === this.elements.modalLevels) {
      this.elements.levelsChapterHint?.classList.add('hidden');
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
  }

  isAnyModalOpen() {
    return this.getModalsByPriority().some((modal) => !modal.classList.contains('hidden'));
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

  formatStars(stars, maxStars) {
    const theme = this.gameConfig.theme;
    const filled = Math.max(0, Math.min(maxStars, stars));
    return theme.starFilledSymbol.repeat(filled) + theme.starEmptySymbol.repeat(maxStars - filled);
  }

  /**
   * Toggle buttons keep a stable accessible name and expose their state
   * through aria-pressed; the tooltip still spells the current value out.
   */
  applyToggleState(buttons, { label, ariaLabel, tooltip, pressed }) {
    for (const btn of buttons) {
      if (btn) {
        setTextIfChanged(btn, label);
        setAttributeIfChanged(btn, 'aria-label', ariaLabel);
        setAttributeIfChanged(btn, 'aria-pressed', String(pressed));
        btn.title = tooltip;
        // Touch screens never show the title, so the menu and Pause copies spell the state out.
        setTextIfChanged(document.querySelector(`[data-caption-for="${btn.id}"]`), tooltip);
      }
    }
  }

  updateSoundButton() {
    const isMuted = this.audioManager.isMuted();
    this.applyToggleState([this.elements.btnSound], {
      label: t(isMuted ? 'app.nav.button.soundOff' : 'app.nav.button.soundOn'),
      ariaLabel: t('app.nav.button.soundAria'),
      tooltip: t(isMuted ? 'app.nav.button.soundOffAria' : 'app.nav.button.soundOnAria'),
      pressed: !isMuted
    });
  }

  updateContrastButton() {
    const isHigh = this.storageManager.getHighContrast();
    this.applyToggleState([this.elements.btnContrast], {
      label: t(isHigh ? 'app.nav.button.contrastOn' : 'app.nav.button.contrastOff'),
      ariaLabel: t('app.nav.button.contrastAria'),
      tooltip: t(isHigh ? 'app.nav.button.contrastOnAria' : 'app.nav.button.contrastOffAria'),
      pressed: isHigh
    });
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.toggle(HIGH_CONTRAST_CLASS, isHigh);
    }
  }

  updatePatternsButton() {
    const isOn = this.storageManager.getColorPatterns();
    this.applyToggleState([this.elements.btnPatterns], {
      label: t(isOn ? 'app.nav.button.patternsOn' : 'app.nav.button.patternsOff'),
      ariaLabel: t('app.nav.button.patternsAria'),
      tooltip: t(isOn ? 'app.nav.button.patternsOnAria' : 'app.nav.button.patternsOffAria'),
      pressed: isOn
    });
  }

  /**
   * Tilt control exists only on touch devices that report their orientation, and is on
   * unless the player turned it off (tilt.enabledByDefault). Where the browser asks
   * permission (iOS), the request must come from a tap: it is made on the first tap on the
   * board, and a refusal is stored as the player's choice.
   */
  setupTiltControl() {
    this.isTiltActive = false;
    this.handleOrientation = (event) => {
      const screenAngle = typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0;
      this.engine.setTilt(computeTiltShare(event, screenAngle, this.gameConfig.tilt));
    };
    const isSupported =
      typeof window !== 'undefined' &&
      typeof window.DeviceOrientationEvent !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(this.gameConfig.tilt.touchMediaQuery).matches;
    this.elements.btnTilt?.closest('.pause-setting')?.classList.toggle('hidden', !isSupported);
    // Named even while hidden, so no audit tool finds an unnamed button.
    this.updateTiltButton();
    if (!isSupported) {
      return;
    }
    const needsPermission = typeof window.DeviceOrientationEvent.requestPermission === 'function';
    const wantsTilt = this.storageManager.getTilt(this.gameConfig.tilt.enabledByDefault);
    if (wantsTilt && !needsPermission) {
      this.setTiltActive(true);
    } else if (wantsTilt) {
      this.requestTiltOnFirstTap();
    }
    const toggleTilt = async () => {
      const next = !this.isTiltActive;
      if (next && needsPermission) {
        const answer = await window.DeviceOrientationEvent.requestPermission().catch(() => 'denied');
        if (answer !== 'granted') {
          return;
        }
      }
      this.storageManager.setTilt(next);
      this.setTiltActive(next);
    };
    this.elements.btnTilt?.addEventListener('click', toggleTilt);
    this.updateTiltButton();
  }

  /** Asks the orientation permission on the first tap on the board (iOS needs a tap). */
  requestTiltOnFirstTap() {
    const canvas = this.elements.gameCanvas;
    if (!canvas) {
      return;
    }
    const askOnce = async () => {
      if (this.isTiltActive) {
        return;
      }
      const answer = await window.DeviceOrientationEvent.requestPermission().catch(() => 'denied');
      const isGranted = answer === 'granted';
      this.storageManager.setTilt(isGranted);
      this.setTiltActive(isGranted);
    };
    canvas.addEventListener('pointerup', askOnce, { once: true });
  }

  setTiltActive(isActive) {
    this.isTiltActive = isActive;
    if (isActive) {
      window.addEventListener('deviceorientation', this.handleOrientation);
    } else {
      window.removeEventListener('deviceorientation', this.handleOrientation);
      this.engine.setTilt(0);
    }
    this.updateTiltButton();
  }

  updateTiltButton() {
    const isOn = Boolean(this.isTiltActive);
    this.applyToggleState([this.elements.btnTilt], {
      label: t(isOn ? 'app.nav.button.tiltOn' : 'app.nav.button.tiltOff'),
      ariaLabel: t('app.nav.button.tiltAria'),
      tooltip: t(isOn ? 'app.nav.button.tiltOnAria' : 'app.nav.button.tiltOffAria'),
      pressed: isOn
    });
  }

  updateMotionButton() {
    const isReduced = this.storageManager.getReducedMotion();
    this.applyToggleState([this.elements.btnMotion], {
      label: t(isReduced ? 'app.nav.button.motionReduced' : 'app.nav.button.motionOn'),
      ariaLabel: t('app.nav.button.motionAria'),
      tooltip: t(isReduced ? 'app.nav.button.motionReducedAria' : 'app.nav.button.motionOnAria'),
      pressed: isReduced
    });
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.toggle(REDUCED_MOTION_CLASS, isReduced);
    }
  }

  /** Moves to the next configured animation speed, wrapping after the last one. */
  cycleAnimationSpeed() {
    const speeds = this.gameConfig.defaults.animationSpeeds;
    const current = this.storageManager.getAnimationSpeed();
    const idx = speeds.indexOf(current);
    const nextSpeed = speeds[(idx + 1) % speeds.length];
    this.storageManager.setAnimationSpeed(nextSpeed);
    if (this.engine && typeof this.engine.setAnimationSpeed === 'function') {
      this.engine.setAnimationSpeed(nextSpeed);
    }
    this.updateAnimSpeedButton();
  }

  updateAnimSpeedButton() {
    const btn = this.elements?.btnAnimSpeed;
    if (!btn) {
      return;
    }
    const defaultSpeed = this.gameConfig.defaults.animationSpeed;
    const speed = this.storageManager?.getAnimationSpeed?.() ?? defaultSpeed;
    const shownSpeed = formatNumber(speed);
    const label = t('app.nav.button.animSpeed', { speed: shownSpeed });
    const ariaLabel = t('app.nav.button.animSpeedAria', { speed: shownSpeed });
    const caption = t('app.nav.button.animSpeedCaption', { speed: shownSpeed });
    setTextIfChanged(btn, label);
    setAttributeIfChanged(btn, 'aria-label', ariaLabel);
    btn.title = ariaLabel;
    btn.classList?.toggle?.('active', speed !== defaultSpeed);
    setTextIfChanged(document.querySelector(`[data-caption-for="${btn.id}"]`), caption);
  }

  /**
   * Wires the HUD and Settings fullscreen buttons where the browser exposes the
   * Fullscreen API, and keeps their state in sync with Escape or OS back gestures.
   */
  setupFullscreenControl() {
    const doc = typeof document === 'undefined' ? null : document;
    // An installed app launched in fullscreen display mode is already fullscreen: nothing to toggle.
    const isSupported = isFullscreenSupported(doc) && !this.isFullscreenDisplayMode();
    this.elements.btnFullscreen?.closest?.('.pause-setting')?.classList.toggle('hidden', !isSupported);
    this.elements.btnFullscreenHud?.classList.toggle('hidden', !isSupported);
    // Named even while hidden, so no accessibility audit finds an unnamed button.
    this.updateFullscreenButton();
    if (!isSupported || !doc) {
      return;
    }
    const syncState = () => {
      this.updateFullscreenButton();
    };
    doc.addEventListener?.('fullscreenchange', syncState);
    doc.addEventListener?.('webkitfullscreenchange', syncState);
    const onToggle = () => {
      this.toggleFullscreen();
    };
    this.elements.btnFullscreen?.addEventListener('click', onToggle);
    this.elements.btnFullscreenHud?.addEventListener('click', onToggle);
  }

  /** True when the installed app runs in the fullscreen display mode (manifest or OS choice). */
  isFullscreenDisplayMode() {
    const query = this.gameConfig?.defaults?.fullscreenDisplayModeMediaQuery;
    if (!query || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return Boolean(window.matchMedia(query).matches);
  }

  async toggleFullscreen() {
    const doc = typeof document === 'undefined' ? null : document;
    if (!isFullscreenSupported(doc)) {
      return;
    }
    if (isDocumentFullscreen(doc)) {
      const exitFn = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (typeof exitFn === 'function') {
        await Promise.resolve(exitFn.call(doc)).catch(() => {});
      }
    } else {
      const root = doc.documentElement;
      if (typeof root.requestFullscreen === 'function') {
        await Promise.resolve(root.requestFullscreen({ navigationUI: 'hide' })).catch(() => {});
      } else if (typeof root.webkitRequestFullscreen === 'function') {
        await Promise.resolve(root.webkitRequestFullscreen()).catch(() => {});
      }
    }
    this.updateFullscreenButton();
  }

  updateFullscreenButton() {
    const doc = typeof document === 'undefined' ? null : document;
    const isFull = isDocumentFullscreen(doc);
    this.applyToggleState([this.elements?.btnFullscreen, this.elements?.btnFullscreenHud], {
      label: t(isFull ? 'app.nav.button.fullscreenOn' : 'app.nav.button.fullscreenOff'),
      ariaLabel: t('app.nav.button.fullscreenAria'),
      tooltip: t(isFull ? 'app.nav.button.fullscreenOnAria' : 'app.nav.button.fullscreenOffAria'),
      pressed: isFull
    });
  }

  updateAimState(engine) {
    if (this.elements.cancelAimBanner) {
      this.elements.cancelAimBanner.classList.toggle('hidden', !engine.isAimCancelled);
    }
  }

  updateLanguageButton() {
    const locale = i18n.getLocale();
    const label = t('app.nav.button.language');
    const ariaLabel = t('app.nav.button.languageAria');
    const btn = this.elements.btnLang;
    if (btn) {
      const codeSpan = document.createElement('span');
      codeSpan.lang = locale;
      codeSpan.textContent = label;
      btn.replaceChildren(codeSpan);
      btn.setAttribute('aria-label', ariaLabel);
      btn.title = ariaLabel;
    }
    if (this.elements.btnDismissTutorial) {
      const dismissLabel = t('hud.tutorial.dismiss');
      this.elements.btnDismissTutorial.setAttribute('aria-label', dismissLabel);
      this.elements.btnDismissTutorial.title = dismissLabel;
    }
  }

  updateResetHintsFeedback() {
    const iconKey = this.hintsResetConfirmed ? 'app.nav.button.resetHintsDone' : 'app.nav.button.resetHints';
    const captionKey = this.hintsResetConfirmed
      ? 'app.nav.button.resetHintsDoneCaption'
      : 'app.nav.button.resetHintsCaption';
    const btn = this.elements?.btnResetHints;
    if (btn) {
      setTextIfChanged(btn, t(iconKey));
      setTextIfChanged(document.querySelector(`[data-caption-for="${btn.id}"]`), t(captionKey));
    }
  }

  updateShareButtonLabel() {
    if (this.elements?.btnShareGameOver) {
      setTextIfChanged(
        this.elements.btnShareGameOver,
        t(this.shareCopied ? 'modals.gameOver.button.shareCopied' : 'modals.gameOver.button.share')
      );
    }
  }

  updateDailyCountdownText() {
    if (!this.elements?.gameOverDailyNext) {
      return;
    }
    // The Daily seed is the UTC date, so the next challenge starts at UTC midnight.
    const { hours, minutes } = formatDailyCountdown(getMsUntilNextDaily(Date.now()));
    const nextText = t('modals.gameOver.daily.nextIn', {
      hours: formatNumber(hours),
      minutes: formatNumber(minutes)
    });
    const streak = this.storageManager?.getDailyStreak?.() || 0;
    const text = streak > 0
      ? `${t('modals.gameOver.daily.streak', { streak: formatNumber(streak) })} - ${nextText}`
      : nextText;
    setTextIfChanged(this.elements.gameOverDailyNext, text);
  }

  stopDailyCountdown() {
    if (this.dailyCountdownTimer !== null) {
      clearInterval(this.dailyCountdownTimer);
      this.dailyCountdownTimer = null;
    }
  }

  startDailyCountdown() {
    this.updateDailyCountdownText();
    const refreshMs = this.gameConfig?.daily?.countdownRefreshMs;
    if (this.dailyCountdownTimer === null && refreshMs > 0) {
      this.dailyCountdownTimer = setInterval(() => {
        this.updateDailyCountdownText();
      }, refreshMs);
      this.dailyCountdownTimer?.unref?.();
    }
  }

  /**
   * Shares the finished run (Daily Challenge, Survival or Flux): the system share sheet when
   * there is one, else the clipboard, else a read-only field with the text selected for a
   * manual copy. The outcome is announced to screen readers. A tap while a share is under
   * way is ignored: a second share sheet request would be refused and wrongly fall back to
   * the clipboard.
   */
  async shareRunResult() {
    if (this.isSharing) {
      return;
    }
    this.isSharing = true;
    try {
      await this.shareRunResultOnce();
    } finally {
      this.isSharing = false;
    }
  }

  /** One share attempt of shareRunResult, without the in-progress guard. */
  async shareRunResultOnce() {
    const engine = this.engine;
    const shareConfig = this.gameConfig.share;
    const text = buildShareText(
      {
        mode: engine.mode,
        dateKey: engine.dailySeedKey,
        mutatorKey: engine.activeMutatorKey,
        wave: engine.waveCount,
        score: engine.score,
        waveLog: engine.waveLog,
        stage: engine.fluxStage,
        puzzleStage: engine.currentPuzzleStage,
        seed: engine.fluxSeed,
        url: shareConfig.url
      },
      shareConfig
    );
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
        this.announce(t('share.feedback.shared'));
        return;
      } catch (error) {
        if (error?.name === SHARE_ABORT_ERROR_NAME) {
          return;
        }
      }
    }
    let feedbackKey = 'share.feedback.manual';
    if (typeof navigator.clipboard?.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        this.shareCopied = true;
        this.updateShareButtonLabel?.();
        this.announce(t('share.feedback.copied'));
        return;
      } catch {
        feedbackKey = 'share.feedback.failed';
      }
    }
    this.showShareFallback(text);
    this.announce(t(feedbackKey));
  }

  /** Shows the share text in the game over window, selected and focused, ready to copy. */
  showShareFallback(text) {
    const field = this.elements.gameOverShareText;
    if (!field || !this.elements.gameOverShareFallback) {
      return;
    }
    field.value = text;
    this.elements.gameOverShareFallback.classList.remove('hidden');
    field.focus();
    field.select();
  }

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
  }

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
  }

  /**
   * Re-renders the shop after a purchase without reopening it, then puts
   * focus back on the same buy button (or the nearest usable one when that
   * button just became disabled).
   */
  rerenderShopKeepingFocus(focusSelector, fallbackSlotIndex = 0) {
    rerenderWorkshopKeepingFocus.call(this, focusSelector, fallbackSlotIndex);
  }

  renderShopContents() {
    renderWorkshopContents.call(this);
  }

  buildCodexPane() {
    buildCodexPane.call(this);
  }

  isCampaignRunActive() {
    return this.engine.mode === GAME_MODES.CAMPAIGN && this.isRunActive();
  }

  /** True when the current run accepts special-ammo refills from the Workshop. */
  canBuySpecialAmmo() {
    return this.isRunActive() && this.engine.mode !== GAME_MODES.PUZZLE;
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

  /**
   * Initial focus target in the Modes & Level Select dialog: the active Arcade control or
   * Close button during an active non-Campaign run, otherwise the Campaign play/resume CTA.
   */
  getLevelsModalInitialFocus(playButton) {
    if (!this.isRunActive?.() || this.isCampaignRunActive()) {
      return playButton;
    }
    if (this.engine?.mode === GAME_MODES.PUZZLE) {
      return (
        this.elements?.puzzleStagesStrip?.querySelector?.('.puzzle-stage-btn.active') ||
        this.elements?.btnModePuzzle ||
        this.elements?.btnCloseLevels ||
        playButton
      );
    }
    if (this.engine?.mode === GAME_MODES.BLITZ) {
      return this.elements?.btnModeBlitz || this.elements?.btnCloseLevels || playButton;
    }
    if (this.engine?.mode === GAME_MODES.BOSS_RUSH) {
      return this.elements?.btnModeBossRush || this.elements?.btnCloseLevels || playButton;
    }
    if (this.engine?.mode === GAME_MODES.CASCADE) {
      return this.elements?.btnModeCascade || this.elements?.btnCloseLevels || playButton;
    }
    return this.elements?.btnCloseLevels || playButton;
  }

  /** The level the select dialog puts forward: the one being played, else the furthest unlocked. */
  getSuggestedLevelId() {
    if (this.engine.mode === GAME_MODES.CAMPAIGN && this.engine.currentLevelId) {
      return this.engine.currentLevelId;
    }
    return Math.min(this.storageManager.getUnlockedLevel(), this.engine.levelCatalog.lastId);
  }

  syncLevelsFilterButton() {
    const btn = this.elements?.btnLevelsFilterIncomplete;
    if (!btn) {
      return;
    }
    btn.classList.toggle('active', Boolean(this.levelsFilterIncomplete));
    btn.setAttribute('aria-pressed', String(Boolean(this.levelsFilterIncomplete)));
  }

  openLevelsModal() {
    const suggestedLevelId = this.getSuggestedLevelId();
    this.syncLevelsFilterButton();

    const totalPuzzles = Math.max(1, this.gameConfig.puzzles?.length || 1);
    const bestPuzzleStage = Math.min(
      totalPuzzles,
      Math.max(1, this.storageManager.getPuzzleBestStage?.() || 1)
    );
    setTextIfChanged(
      this.elements.arcadeBestPuzzle,
      t('modals.levelSelect.arcade.puzzleRecord', {
        stage: formatNumber(bestPuzzleStage),
        total: formatNumber(totalPuzzles),
        score: formatNumber(this.storageManager.getPuzzleHighScore())
      })
    );
    setTextIfChanged(
      this.elements.arcadeBestBlitz,
      t('modals.levelSelect.card.bestScore', { score: formatNumber(this.storageManager.getBlitzHighScore()) })
    );
    setTextIfChanged(
      this.elements.arcadeBestBossRush,
      t('modals.levelSelect.arcade.bossRushRecord', {
        wave: formatNumber(Math.max(1, this.storageManager.getBossRushBestWave?.() || 1)),
        score: formatNumber(this.storageManager.getBossRushHighScore())
      })
    );
    setTextIfChanged(
      this.elements.arcadeBestCascade,
      t('modals.levelSelect.card.bestScore', { score: formatNumber(this.storageManager.getCascadeHighScore()) })
    );
    this.renderPuzzleStagesStrip();

    if (this.elements.levelsStarsSummary) {
      const totalStars = this.storageManager.getTotalStars();
      const maxCampaignStars = this.engine.levelCatalog.count * this.gameConfig.scoring.maxStars;
      this.elements.levelsStarsSummary.textContent = t('modals.levelSelect.starsTotal', {
        stars: formatNumber(totalStars),
        maxStars: formatNumber(maxCampaignStars)
      });
    }

    // The dialog opens on the chapter of the suggested level.
    this.elements.levelsChapterHint?.classList.add('hidden');
    this.levelsChapterIndex = this.engine.levelCatalog.chapterIndexOf(suggestedLevelId);
    this.renderLevelChapters();
    const suggestedCard = this.renderLevelCards(suggestedLevelId);
    const grid = this.elements.levelsGrid;

    const playButton = this.elements.btnPlayLevelModal;
    setTextIfChanged(
      playButton,
      t(this.isCampaignRunActive() ? 'modals.levelSelect.button.resume' : 'modals.levelSelect.button.play', {
        level: suggestedLevelId
      })
    );
    this.openOverlayModal(this.elements.modalLevels, this.getLevelsModalInitialFocus(playButton));
    this.centerActiveChapter();
    if (suggestedCard) {
      // Only the grid scrolls: scrollIntoView would also move the dialog inside its backdrop.
      const gridRect = grid.getBoundingClientRect();
      const cardRect = suggestedCard.getBoundingClientRect();
      grid.scrollTop += cardRect.top - gridRect.top - (gridRect.height - cardRect.height) * MATH_CONSTANTS.HALF;
    }
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
      btn.textContent = label;
      if (isCurrent) {
        btn.setAttribute('aria-current', 'true');
      }
      if (isUnlocked) {
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
      return t('modals.gameOver.stats.fluxStage', {
        stage: formatNumber(engine.fluxStage),
        best: formatNumber(Math.max(engine.fluxStage, this.storageManager.getFluxBestStage()))
      });
    }
    if (engine.mode === GAME_MODES.BOSS_RUSH) {
      return t('modals.gameOver.stats.bossRushSummary', {
        wave: formatNumber(engine.bossRushWave),
        best: formatNumber(Math.max(engine.bossRushWave, this.storageManager.getBossRushBestWave?.() || 1)),
        coins: formatNumber(summary?.earnedCoins || 0)
      });
    }
    if (engine.mode === GAME_MODES.PUZZLE) {
      return t('modals.gameOver.stats.puzzleSummary', {
        stage: formatNumber(engine.currentPuzzleStage),
        total: formatNumber(Math.max(1, this.gameConfig.puzzles?.length || 1))
      });
    }
    if (
      engine.mode === GAME_MODES.ENDLESS ||
      engine.mode === GAME_MODES.DAILY ||
      engine.mode === GAME_MODES.BLITZ ||
      engine.mode === GAME_MODES.CASCADE
    ) {
      return t('modals.gameOver.stats.waveSummary', {
        wave: formatNumber(engine.waveCount),
        combo: formatNumber(Math.max(1, summary?.maxCombo || engine.combo || 1)),
        coins: formatNumber(summary?.earnedCoins || 0)
      });
    }
    return '';
  }

  /**
   * Fills the chapter strip of the level select: one tab per chapter with the stars won in
   * it. A chapter whose first level is still locked cannot be opened.
   */
  renderLevelChapters() {
    renderLevelChapters.call(this);
  }

  /**
   * Reveals the locked chapter or level requirement in the polite live region above the grid.
   * @param {number} requiredLevel - Level number that must be cleared first.
   * @param {string} [hintKey] - Localization key for the requirement message.
   */
  showLockedLevelHint(requiredLevel, hintKey = 'modals.levelSelect.chapterLockedHint') {
    const hintEl = this.elements?.levelsChapterHint;
    if (!hintEl) {
      return;
    }
    revealLiveRegion({
      region: hintEl,
      textElement: hintEl,
      text: t(hintKey, { level: requiredLevel, previous: requiredLevel }),
      schedule: scheduleNextFrame
    });
  }

  /** Scrolls the chapter strip, and only it, so the active chapter sits in the middle. */
  centerActiveChapter() {
    const strip = this.elements.levelsChapters;
    const active = strip?.querySelector('.level-chapter.active');
    if (!active) {
      return;
    }
    const stripRect = strip.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    strip.scrollLeft += activeRect.left - stripRect.left - (stripRect.width - activeRect.width) * MATH_CONSTANTS.HALF;
  }

  /**
   * Shows the levels of another chapter. A locked chapter is left closed.
   * @param {number} index - Chapter index from the level catalog.
   * @param {{focus?: boolean}} options - focus moves the keyboard focus to the new tab.
   */
  selectLevelChapter(index, { focus = false } = {}) {
    const chapter = this.engine.levelCatalog.listChapters()[index];
    if (!chapter || chapter.firstId > this.storageManager.getUnlockedLevel()) {
      return;
    }
    this.elements.levelsChapterHint?.classList.add('hidden');
    this.levelsChapterIndex = index;
    this.renderLevelChapters();
    this.renderLevelCards(this.getSuggestedLevelId());
    this.elements.levelsGrid.scrollTop = 0;
    this.centerActiveChapter();
    if (focus) {
      this.elements.levelsChapters.querySelector('.level-chapter.active')?.focus();
    }
  }

  /**
   * Fills the level grid with the cards of the selected chapter.
   * @param {number} suggestedLevelId - Level marked as the current one.
   * @returns {HTMLElement|null} The card of the suggested level, when it is in the chapter.
   */
  renderLevelCards(suggestedLevelId) {
    return renderLevelCards.call(this, suggestedLevelId);
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

  refresh(engine, extra = {}) {
    // One-shot extras (an unlocked achievement, a cleared Flux stage) must not replay
    // when refresh is re-run with lastExtra (language change, input mode change, shop
    // purchase): they are read from this call only.
    const { unlockedAchievementId, fluxStageCleared, ...persistentExtra } = extra;
    this.lastExtra = persistentExtra;
    setTextIfChanged(this.elements.scoreValue, formatNumber(engine.score));
    setTextIfChanged(
      this.elements.coinsValue,
      t('hud.stats.coins.value', { coins: formatNumber(this.storageManager.getCoins()) })
    );

    const affordableCount = this.getAffordableUpgradeCount();
    setTextIfChanged(
      this.elements.btnShop,
      affordableCount > 0
        ? t('app.nav.button.shopBadge', { count: affordableCount })
        : t('app.nav.button.shop')
    );
    this.elements.btnShop.classList.toggle('has-affordable', affordableCount > 0);

    // Only the mode being played stands out, and says so to screen readers.
    for (const [mode, elementKeys] of Object.entries(MODE_BUTTON_KEYS)) {
      const isActive = engine.mode === mode;
      for (const elementKey of elementKeys) {
        const button = this.elements[elementKey];
        if (button) {
          button.classList.toggle('active-mode', isActive);
          if (isActive) {
            setAttributeIfChanged(button, 'aria-current', 'true');
          } else {
            button.removeAttribute('aria-current');
          }
        }
      }
    }
    if (this.elements.btnDaily) {
      const todayKey = SeededRandom.getTodayDateKey();
      const dailyBonusCoins = this.gameConfig.daily?.firstPlayBonusCoins || 0;
      const streak = this.storageManager.getDailyStreak?.(todayKey) || 0;
      let dailyLabel = t('app.nav.button.daily');
      if (this.storageManager.hasPlayedDailyToday(todayKey)) {
        // Today's challenge is done: say so rather than fall back to the plain label.
        dailyLabel = streak > 1
          ? t('app.nav.button.dailyPlayedStreakBadge', { streak: formatNumber(streak) })
          : t('app.nav.button.dailyPlayedBadge');
      } else if (dailyBonusCoins > 0) {
        dailyLabel = t('app.nav.button.dailyBonusBadge', { coins: dailyBonusCoins });
      }
      setTextIfChanged(this.elements.btnDaily, dailyLabel);
    }

    const overchargePct = Math.min(
      FULL_PERCENT,
      Math.round((engine.overcharge / this.gameConfig.scoring.overchargeMax) * FULL_PERCENT)
    );
    setTextIfChanged(this.elements.overchargePct, t('hud.stats.overcharge.pct', { pct: overchargePct }));
    this.elements.overchargeFill.style.width = `${overchargePct}%`;

    let bestScore = 0;
    if (engine.mode === GAME_MODES.CAMPAIGN) {
      bestScore = this.storageManager.getLevelStats()[engine.currentLevelId]?.bestScore || 0;
    } else if (engine.mode === GAME_MODES.DAILY) {
      bestScore = this.storageManager.getDailyHighScore(engine.dailySeedKey || SeededRandom.getTodayDateKey());
    } else if (engine.mode === GAME_MODES.FLUX) {
      bestScore = this.storageManager.getFluxHighScore();
    } else if (engine.mode === GAME_MODES.PUZZLE) {
      bestScore = this.storageManager.getPuzzleHighScore();
    } else if (engine.mode === GAME_MODES.BLITZ) {
      bestScore = this.storageManager.getBlitzHighScore();
    } else if (engine.mode === GAME_MODES.BOSS_RUSH) {
      bestScore = this.storageManager.getBossRushHighScore();
    } else if (engine.mode === GAME_MODES.CASCADE) {
      bestScore = this.storageManager.getCascadeHighScore();
    } else {
      bestScore = this.storageManager.getEndlessHighScore();
    }

    setTextIfChanged(this.elements.highScoreValue, formatNumber(Math.max(bestScore, engine.score)));

    if (this.elements.polarityBtn) {
      const polState = engine.isPolarityFlipped ? 'inverted' : 'normal';
      this.setLauncherButton(
        this.elements.polarityBtn,
        'hud.launcher.polarity.icon',
        `hud.launcher.polarity.${polState}`,
        'hud.launcher.polarity.shortcut',
        `hud.launcher.polarity.caption.${polState}`
      );
      this.elements.polarityBtn.classList.toggle('active', Boolean(engine.isPolarityFlipped));
    }

    if (this.elements.swapBtn) {
      const isSwapLocked = engine.mode === GAME_MODES.PUZZLE && engine.shotsRemaining <= 1;
      this.elements.swapBtn.disabled = isSwapLocked;
    }

    const warningShotsThreshold = this.gameConfig.canvas.survivalWaveWarningThreshold;

    const coreRescueSuffix =
      engine.currentObjective === OBJECTIVE_TYPES.CORE_RESCUE && engine.targetCoreCount > 0
        ? ` • ${t('hud.stats.mode.coreRescueProgress', {
            rescued: formatNumber(Math.min(engine.targetCoreCount, engine.rescuedCores || 0)),
            total: formatNumber(engine.targetCoreCount)
          })}`
        : '';

    if (engine.mode === GAME_MODES.CAMPAIGN) {
      const lvl = engine.levelCatalog.summarize(engine.currentLevelId);
      setTextIfChanged(
        this.elements.modeBanner,
        `${t('hud.stats.mode.campaign', {
          level: engine.currentLevelId,
          name: lvl ? this.formatLevelName(lvl) : ''
        })}${coreRescueSuffix}`
      );
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.shots.label'));
      }
      setTextIfChanged(this.elements.shotsValue, formatNumber(engine.shotsRemaining));
      this.elements.shotsValue.classList.toggle(
        'warning',
        engine.shotsRemaining <= warningShotsThreshold
      );

      if (this.elements.starProgress) {
        const thresholds = engine.getStarThresholds();
        const maxStars = this.gameConfig.scoring.maxStars;
        const currentStars = engine.computeStars(engine.score);
        const starsStr = this.formatStars(currentStars, maxStars);
        const nextThreshold = thresholds.find((th) => th > engine.score);
        this.updateStarMeter(engine.score, thresholds, nextThreshold);
        // Two unbreakable parts, so a narrow HUD wraps between them and never inside one.
        setTextIfChanged(this.elements.starGlyphs, starsStr);
        // The glyphs are hidden from screen readers; this hidden text states the count.
        setTextIfChanged(
          this.elements.starCount,
          t('hud.stats.score.starsAria', {
            stars: formatNumber(Math.max(0, Math.min(maxStars, currentStars))),
            maxStars: formatNumber(maxStars)
          })
        );
        setTextIfChanged(
          this.elements.starNext,
          nextThreshold !== undefined
            ? t('hud.stats.score.nextThreshold', { next: formatNumber(nextThreshold) })
            : t('hud.stats.score.maxReached')
        );
        this.elements.starProgress.classList.remove('hidden');
      }
    } else if (engine.mode === GAME_MODES.PUZZLE) {
      setTextIfChanged(
        this.elements.modeBanner,
        `${t('hud.stats.mode.puzzle', {
          stage: engine.currentPuzzleStage,
          total: this.gameConfig.puzzles?.length || 1
        })}${coreRescueSuffix}`
      );
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.shots.label'));
      }
      setTextIfChanged(this.elements.shotsValue, formatNumber(engine.shotsRemaining));
      this.elements.shotsValue.classList.toggle('warning', engine.shotsRemaining <= warningShotsThreshold);
      if (this.elements.starProgress) {
        const thresholds = engine.getStarThresholds();
        const maxStars = this.gameConfig.scoring.maxStars;
        const currentStars = engine.computeStars(engine.score);
        const starsStr = this.formatStars(currentStars, maxStars);
        const nextThreshold = thresholds.find((th) => th > engine.score);
        this.updateStarMeter(engine.score, thresholds, nextThreshold);
        setTextIfChanged(this.elements.starGlyphs, starsStr);
        setTextIfChanged(
          this.elements.starCount,
          t('hud.stats.score.starsAria', {
            stars: formatNumber(Math.max(0, Math.min(maxStars, currentStars))),
            maxStars: formatNumber(maxStars)
          })
        );
        setTextIfChanged(
          this.elements.starNext,
          nextThreshold !== undefined
            ? t('hud.stats.score.nextThreshold', { next: formatNumber(nextThreshold) })
            : t('hud.stats.score.maxReached')
        );
        this.elements.starProgress.classList.remove('hidden');
      }
    } else if (engine.mode === GAME_MODES.BLITZ) {
      const fps = this.gameConfig.blitz.framesPerSecond;
      const secondsLeft = Math.max(0, Math.ceil(engine.blitzFramesRemaining / fps));
      setTextIfChanged(
        this.elements.modeBanner,
        t('hud.stats.mode.blitz', { wave: formatNumber(engine.waveCount) })
      );
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.time.label'));
      }
      setTextIfChanged(this.elements.shotsValue, t('hud.stats.time.seconds', { seconds: formatNumber(secondsLeft) }));
      this.elements.shotsValue.classList.toggle(
        'warning',
        secondsLeft <= this.gameConfig.blitz.warningSeconds
      );
      if (this.elements.starProgress) {
        this.elements.starProgress.classList.add('hidden');
      }
    } else if (engine.mode === GAME_MODES.FLUX) {
      setTextIfChanged(
        this.elements.modeBanner,
        t(engine.fluxIsBossStage ? 'hud.stats.mode.fluxBoss' : 'hud.stats.mode.flux', {
          stage: engine.fluxStage,
          shape: this.formatFluxShapeName(engine.fluxShapeIds)
        })
      );
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.shots.label'));
      }
      setTextIfChanged(this.elements.shotsValue, formatNumber(engine.shotsRemaining));
      this.elements.shotsValue.classList.toggle('warning', engine.shotsRemaining <= warningShotsThreshold);
      if (this.elements.starProgress) {
        this.elements.starProgress.classList.add('hidden');
      }
    } else {
      if (engine.mode === GAME_MODES.DAILY) {
        const mutatorLabel = engine.activeMutatorKey
          ? t(`gameplay.mutators.${engine.activeMutatorKey}`)
          : '';
        setTextIfChanged(
          this.elements.modeBanner,
          t('hud.stats.mode.daily', {
            mutator: mutatorLabel,
            wave: engine.waveCount
          })
        );
      } else if (engine.mode === GAME_MODES.BOSS_RUSH) {
        const shields = engine.getBossBall()?.armorHits || 0;
        setTextIfChanged(
          this.elements.modeBanner,
          t('hud.stats.mode.bossRush', {
            wave: engine.bossRushWave,
            shields: formatNumber(shields)
          })
        );
      } else if (engine.mode === GAME_MODES.CASCADE) {
        setTextIfChanged(
          this.elements.modeBanner,
          t('hud.stats.mode.cascade', {
            wave: engine.waveCount
          })
        );
      } else {
        setTextIfChanged(
          this.elements.modeBanner,
          t('hud.stats.mode.endless', {
            wave: engine.waveCount
          })
        );
      }
      if (this.elements.shotsLabel) {
        const shotsLabelKey = engine.mode === GAME_MODES.BOSS_RUSH
          ? 'hud.stats.shots.shieldsLabel'
          : 'hud.stats.shots.waveLabel';
        setTextIfChanged(this.elements.shotsLabel, t(shotsLabelKey));
      }
      const waveCountdown =
        engine.mode === GAME_MODES.CASCADE
          ? engine.cascadeTurnsUntilDrop
          : engine.mode === GAME_MODES.BOSS_RUSH
            ? engine.getBossBall()?.armorHits || 0
            : engine.shotsUntilWave;
      setTextIfChanged(this.elements.shotsValue, formatNumber(waveCountdown));
      this.elements.shotsValue.classList.toggle(
        'warning',
        waveCountdown <= warningShotsThreshold
      );
      if (this.elements.starProgress) {
        this.elements.starProgress.classList.add('hidden');
      }
    }

    if (this.elements.modeBanner) {
      setAttributeIfChanged(
        this.elements.modeBanner,
        'aria-label',
        `${this.elements.modeBanner.textContent} (${t('hud.stats.mode.switchHint')})`
      );
    }

    if (engine.combo > 1) {
      setTextIfChanged(this.elements.comboBadge, t('hud.stats.combo.label', { count: engine.combo }));
      this.elements.comboBadge.classList.remove('hidden');
    } else {
      this.elements.comboBadge.classList.add('hidden');
    }

    if (engine.freezeTurnsRemaining > 0) {
      setTextIfChanged(
        this.elements.frozenBadge,
        t('hud.stats.frozen.label', { turns: engine.freezeTurnsRemaining })
      );
      this.elements.frozenBadge.classList.remove('hidden');
    } else {
      this.elements.frozenBadge.classList.add('hidden');
    }

    // Both banners are polite live regions: rewriting identical text on every
    // engine event would make screen readers repeat them.
    if (this.elements.tutorialBanner) {
      const hintText = engine.activeDiscoveryId
        ? resolveHintText(engine.activeDiscoveryId, this.gameConfig.onboarding, this.ballsConfig, t)
        : '';
      if (hintText && engine.state === GAME_STATES.PLAYING) {
        revealLiveRegion({
          region: this.elements.tutorialBanner,
          textElement: this.elements.tutorialBannerText,
          text: hintText,
          schedule: scheduleNextFrame
        });
      } else {
        this.elements.tutorialBanner.classList.add('hidden');
      }
    }

    if (this.elements.specialEquippedBanner) {
      const equippedType = engine.currentBall?.specialType;
      if (equippedType && engine.state === GAME_STATES.PLAYING) {
        const spec = this.ballsConfig.specialTypes[equippedType];
        revealLiveRegion({
          region: this.elements.specialEquippedBanner,
          textElement: this.elements.specialEquippedBanner,
          text: t('hud.launcher.specialEquipped.hint', {
            icon: spec?.icon || '',
            name: t(`hud.powerups.${equippedType}.name`),
            desc: t(`hud.powerups.${equippedType}.tooltip`),
            unequip: t(`hud.launcher.specialEquipped.unequip.${this.inputMode}`)
          }),
          schedule: scheduleNextFrame
        });
      } else {
        this.elements.specialEquippedBanner.classList.add('hidden');
      }
    }

    this.updateAimState(engine);

    // A level that hands out no special ball shows no empty slots to a new player.
    const offersSpecialBalls = engine.offersSpecialBalls();
    this.elements.powerupsContainer.classList.toggle('hidden', !offersSpecialBalls);
    this.elements.powerupsHeader?.classList.toggle('hidden', !offersSpecialBalls);
    // The panel keeps its place in the layout, so it says why it is empty.
    this.elements.powerupsEmpty?.classList.toggle('hidden', offersSpecialBalls);

    const buttons = this.elements.powerupsContainer.querySelectorAll('.powerup-btn');
    const canBuyAmmo = this.canBuySpecialAmmo();
    for (const btn of buttons) {
      const type = btn.dataset.specialType;
      const count = engine.specialInventory[type] || 0;
      const isEquipped = Boolean(engine.currentBall && engine.currentBall.specialType === type);
      const isEmpty = count <= 0 && !isEquipped;
      const countEl = document.getElementById(`powerup-count-${type}`);
      setTextIfChanged(countEl, isEmpty && canBuyAmmo ? t('hud.powerups.button.emptyMark') : String(count));
      const label =
        isEmpty && canBuyAmmo
          ? t('hud.powerups.button.buyAria', { name: t(`hud.powerups.${type}.name`) })
          : this.getPowerupAriaLabel(type, count);
      setAttributeIfChanged(btn, 'aria-label', label);
      btn.classList.toggle('equipped', isEquipped);
      btn.classList.toggle(EMPTY_POWERUP_CLASS, isEmpty && canBuyAmmo);
      setAttributeIfChanged(btn, 'aria-pressed', String(isEquipped));
      // Ammo is only sold during a round, so between rounds an empty button stays inert.
      btn.disabled = isEmpty && !canBuyAmmo;
    }

    const transitionedState = this.prevEngineState !== engine.state;
    this.prevEngineState = engine.state;

    if (fluxStageCleared) {
      this.announce(t('hud.announcer.round.fluxStageCleared', { stage: fluxStageCleared }));
    }

    if (unlockedAchievementId) {
      const spec = this.gameConfig.achievements?.[unlockedAchievementId];
      this.announce(
        t('hud.announcer.achievement.unlocked', {
          name: t(`modals.shop.achievements.items.${unlockedAchievementId}.name`),
          coins: formatNumber(spec?.rewardCoins || 0)
        })
      );
    }

    if (engine.state === GAME_STATES.PAUSED && !this.isRunHeldByUi() && !this.isAnyOverlayModalOpen()) {
      if (this.elements.pauseLevelTip) {
        if (engine.levelTutorialKey) {
          setTextIfChanged(
            this.elements.pauseLevelTip,
            t('modals.pause.levelTip', {
              tip: t(engine.levelTutorialKey)
            })
          );
          this.elements.pauseLevelTip.classList.remove('hidden');
        } else {
          this.elements.pauseLevelTip.classList.add('hidden');
        }
      }
      if (transitionedState) {
        this.saveLastFocusedElement();
      }
      this.elements.modalPause.classList.remove('hidden');
      if (transitionedState && this.elements.btnResume) {
        this.elements.btnResume.focus();
      }
    } else {
      this.elements.modalPause.classList.add('hidden');
    }

    // The modal waits for the post-victory celebration, and for any menu opened meanwhile:
    // closing that menu reveals it (see closeOverlayModal).
    const canRevealVictory =
      engine.state === GAME_STATES.VICTORY &&
      !engine.isVictoryCelebrating() &&
      !this.isAnyOverlayModalOpen();
    const isVictoryJustRevealed = canRevealVictory && !this.isVictoryModalRevealed;
    if (engine.state !== GAME_STATES.VICTORY || canRevealVictory) {
      this.isVictoryModalRevealed = canRevealVictory;
    }

    if (engine.state !== GAME_STATES.VICTORY && this.isVictoryPresented) {
      this.isVictoryPresented = false;
      this.stopScoreCountUp();
    }

    if (canRevealVictory) {
      // The run is over: the menu goes away without resuming anything.
      this.closeDrawer({ resume: false });
      const summary = engine.victorySummary || extra;
      const stars = summary.stars || engine.computeStars(engine.score);
      const maxStars = this.gameConfig.scoring.maxStars;
      const scoreText = formatNumber(engine.score);
      const isNewRecord = Boolean(summary.isNewRecord);
      // Score roll-up and star pops play once per victory, the first time the window
      // shows; later refreshes only keep the texts current (e.g. after a language switch).
      if (!this.isVictoryPresented) {
        this.isVictoryPresented = true;
        this.buildVictoryStars(stars, maxStars);
        this.startScoreCountUp(engine.score, isNewRecord);
      } else {
        this.elements.victoryScore?.classList.toggle('is-new-record', isNewRecord);
        if (this.scoreCountUpFrame === null) {
          setTextIfChanged(this.elements.victoryScore, this.formatVictoryScoreText(engine.score, isNewRecord));
        }
        setTextIfChanged(this.victoryStarsLabel, t('modals.victory.stats.stars', { stars, maxStars }));
      }
      if (this.elements.victoryNextStar && summary) {
        this.elements.victoryNextStar.classList.remove('hidden');
        if (summary.nextStarTarget !== null && summary.nextStarTarget !== undefined) {
          this.elements.victoryNextStar.textContent = t('modals.victory.nextStarHint', {
            star: summary.nextStarNumber,
            target: formatNumber(summary.nextStarTarget),
            points: formatNumber(summary.pointsToNextStar)
          });
          this.elements.victoryNextStar.classList.remove('is-all-stars');
        } else {
          this.elements.victoryNextStar.textContent = t('modals.victory.allStarsEarned');
          this.elements.victoryNextStar.classList.add('is-all-stars');
        }
      }
      setTextIfChanged(
        this.elements.victoryBonus,
        t('modals.victory.stats.shotsBonus', {
          bonus: formatNumber(summary.victoryBonus || 0),
          coins: formatNumber(summary.earnedCoins || 0)
        })
      );
      this.updateNextLevelButton(engine);
      if (isVictoryJustRevealed) {
        this.saveLastFocusedElement();
        this.announce(t('hud.announcer.round.victory', { score: scoreText, stars, maxStars }));
      }
      this.elements.modalVictory.classList.remove('hidden');
      if (isVictoryJustRevealed) {
        this.focusInTopModal(this.elements.btnNextLevel);
      }
    }

    if (engine.state !== GAME_STATES.GAME_OVER || engine.mode !== GAME_MODES.DAILY) {
      this.stopDailyCountdown();
    }

    if (engine.state === GAME_STATES.GAME_OVER) {
      this.closeDrawer({ resume: false });
      const summary = engine.gameOverSummary;
      const reasonKey = gameOverReasonKey(extra.gameOverReason || summary?.reasonKey);
      const scoreText = formatNumber(engine.score);
      setTextIfChanged(this.elements.gameOverReason, t(reasonKey));
      setTextIfChanged(this.elements.gameOverScore, t('modals.gameOver.stats.score', { score: scoreText }));
      const highScoreText = t('modals.gameOver.stats.highScore', {
        highScore: formatNumber(Math.max(bestScore, engine.score))
      });
      const isNewRecord = Boolean(summary?.isNewRecord);
      setTextIfChanged(
        this.elements.gameOverBest,
        isNewRecord ? `${highScoreText} - ${t('modals.gameOver.stats.newRecordBadge')}` : highScoreText
      );
      this.elements.gameOverBest?.classList.toggle('is-new-record', isNewRecord);
      if (this.elements.gameoverRemaining) {
        const showRemaining = engine.usesShotBudget() && summary?.remainingSpheres > 0;
        if (showRemaining) {
          setTextIfChanged(
            this.elements.gameoverRemaining,
            t('modals.gameOver.stats.remainingSpheres', { count: formatNumber(summary.remainingSpheres) })
          );
          this.elements.gameoverRemaining.classList.remove('hidden');
        } else {
          this.elements.gameoverRemaining.classList.add('hidden');
        }
      }
      if (this.elements.gameOverStage) {
        const stageSummaryText = this.formatGameOverStageSummary(engine, summary);
        if (stageSummaryText) {
          setTextIfChanged(this.elements.gameOverStage, stageSummaryText);
        }
        this.elements.gameOverStage.classList.toggle('hidden', !stageSummaryText);
      }
      if (this.elements.gameOverDailyNext) {
        const isDaily = engine.mode === GAME_MODES.DAILY;
        if (isDaily) {
          this.startDailyCountdown();
        }
        this.elements.gameOverDailyNext.classList.toggle('hidden', !isDaily);
      }
      // Every mode but the campaign has a result worth sharing.
      this.elements.btnShareGameOver?.classList.toggle('hidden', engine.mode === GAME_MODES.CAMPAIGN);
      if (this.elements.btnContinueGameOver) {
        const canContinue = Boolean(engine.canContinueOutOfShots?.());
        if (canContinue) {
          const pack = engine.getContinuePackSpec();
          const canAfford = this.storageManager.getCoins() >= pack.costCoins;
          setTextIfChanged(
            this.elements.btnContinueGameOver,
            t('modals.gameOver.button.continueShots', {
              shots: formatNumber(pack.shots),
              cost: formatNumber(pack.costCoins)
            })
          );
          this.elements.btnContinueGameOver.disabled = !canAfford;
        }
        this.elements.btnContinueGameOver.classList.toggle('hidden', !canContinue);
      }
      if (this.elements.btnSameSeedGameOver) {
        const hasFluxSeed = engine.mode === GAME_MODES.FLUX && Boolean(engine.fluxSeed);
        if (hasFluxSeed) {
          setTextIfChanged(
            this.elements.btnSameSeedGameOver,
            t('modals.gameOver.button.sameSeed', { seed: engine.fluxSeed })
          );
        }
        this.elements.btnSameSeedGameOver.classList.toggle('hidden', !hasFluxSeed);
      }
      if (transitionedState) {
        this.shareCopied = false;
        this.updateShareButtonLabel();
        this.elements.gameOverShareFallback?.classList.add('hidden');
        this.saveLastFocusedElement();
        this.announce(t('hud.announcer.round.gameOver', { reason: t(reasonKey), score: scoreText }));
      }
      this.elements.modalGameOver.classList.remove('hidden');
      if (transitionedState) {
        this.focusInTopModal(this.elements.btnRetry);
      }
    } else {
      this.elements.modalGameOver.classList.add('hidden');
    }

    setTextIfChanged(
      this.elements.compactInfo,
      t('hud.stats.compactLine', {
        mode: this.elements.modeBanner.textContent,
        coins: this.elements.coinsValue.textContent,
        best: this.elements.highScoreValue.textContent
      })
    );
    this.syncDrawerStats();
    this.syncModalInertState();
  }
}
