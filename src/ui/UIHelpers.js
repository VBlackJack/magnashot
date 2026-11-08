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

import { BOARD_MECHANICS, GAME_MODES, GAME_OVER_REASONS, INPUT_MODES } from '../core/Constants.js';
import { t, formatNumber } from '../core/I18n.js';
import { FULL_PERCENT } from './WorkshopView.js';
import { formatLevelName } from './LevelSelectView.js';

/** Elements a modal focus trap may cycle through (inactive tabs use tabindex="-1"). */
export const MODAL_FOCUSABLE_SELECTOR =
  'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([tabindex="-1"]), textarea:not([tabindex="-1"]), [href]:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

/** Ancestors that remove an element from the interactive tree. */
export const NON_INTERACTIVE_ANCESTOR_SELECTOR = '.hidden, [hidden], [inert]';

/** Error name of a share sheet the player dismissed: not a failure, nothing to report. */
export const SHARE_ABORT_ERROR_NAME = 'AbortError';

/**
 * Media query matched once the game runs as an installed app, so the Settings install
 * entry has nothing left to offer.
 */
export const STANDALONE_DISPLAY_QUERY = '(display-mode: standalone), (display-mode: fullscreen)';

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
export const COUNT_UP_EASE_POWER = 3;

/** App shell class that slides the menu in on portrait phones. */
export const DRAWER_OPEN_CLASS = 'drawer-open';
export const VISUALLY_HIDDEN_CLASS = 'visually-hidden';
export const STAR_EARNED_CLASS = 'star-earned';
export const STAR_EMPTY_CLASS = 'star-empty';

/** Pointer types that mean a finger-like input without a keyboard at hand. */
export const TOUCH_POINTER_TYPES = new Set(['touch', 'pen']);

/** Root data attribute mirroring the current input mode for CSS. */
export const INPUT_MODE_DATASET_KEY = 'input';

/** Special ball button with no stock left: a click opens the Workshop ammo tab. */
export const EMPTY_POWERUP_CLASS = 'is-empty';

/** Mode buttons, keyed by the game mode each one starts. */
export const MODE_BUTTON_KEYS = Object.freeze({
  [GAME_MODES.CAMPAIGN]: ['btnLevels'],
  [GAME_MODES.ENDLESS]: ['btnEndless'],
  [GAME_MODES.DAILY]: ['btnDaily'],
  [GAME_MODES.FLUX]: ['btnFlux'],
  [GAME_MODES.PUZZLE]: ['btnModePuzzle'],
  [GAME_MODES.BLITZ]: ['btnModeBlitz'],
  [GAME_MODES.BOSS_RUSH]: ['btnModeBossRush'],
  [GAME_MODES.CASCADE]: ['btnModeCascade']
});

/** Modal texts (pause instructions, perk choice subtitle) that have one wording per input mode. */
export const MODAL_INPUT_HINTS = Object.freeze([
  { elementId: 'pause-instruction-aim', key: 'modals.pause.instructions.aim' },
  { elementId: 'pause-instruction-swap', key: 'modals.pause.instructions.swap' },
  { elementId: 'pause-instruction-cancel', key: 'modals.pause.instructions.cancel' },
  { elementId: 'pause-instruction-keyboard', key: 'modals.pause.instructions.keyboard' },
  { elementId: 'modal-flux-perk-subtitle', key: 'modals.fluxPerk.subtitle' }
]);

/** Class that makes a control pulse (and outline, for reduced motion) while a hint points at it. */
export const DISCOVERY_PULSE_CLASS = 'discovery-pulse';

/** Prefix of a discovery pulse target that names a special-ball slot, e.g. 'special:bomb'. */
export const PULSE_SPECIAL_PREFIX = 'special:';

/** Pulse target naming the polarity button. */
export const PULSE_POLARITY_TARGET = 'polarity';

/**
 * Maps the engine's discovery pulse target to the controls that must pulse.
 * @param {string|null|undefined} target - 'polarity', 'special:<type>' or nothing.
 * @returns {{polarity: boolean, specialType: string|null}} What pulses.
 */
export function resolvePulseTargets(target) {
  if (target === PULSE_POLARITY_TARGET) {
    return { polarity: true, specialType: null };
  }
  if (typeof target === 'string' && target.startsWith(PULSE_SPECIAL_PREFIX) && target.length > PULSE_SPECIAL_PREFIX.length) {
    return { polarity: false, specialType: target.slice(PULSE_SPECIAL_PREFIX.length) };
  }
  return { polarity: false, specialType: null };
}

/** Codex sections whose entries carry a player-facing mechanic name, searched in order. */
export const MECHANIC_NAME_KEY_PREFIXES = Object.freeze([
  'modals.shop.codex.obstacles',
  'modals.shop.codex.modifiers',
  'modals.shop.codex.mechanics',
  'hud.levelIntro.mechanicNames'
]);

/**
 * Finds the player-facing name of the mechanic a level is built around.
 * @param {string|null|undefined} mechanicId - Discovery id of the featured mechanic.
 * @param {(key: string) => string} translate - The translation function.
 * @returns {string} The name, or an empty string when none is known.
 */
export function resolveMechanicName(mechanicId, translate) {
  if (!mechanicId) {
    return '';
  }
  for (const prefix of MECHANIC_NAME_KEY_PREFIXES) {
    const key = prefix === 'hud.levelIntro.mechanicNames' ? `${prefix}.${mechanicId}` : `${prefix}.${mechanicId}.name`;
    const name = translate(key);
    if (name && name !== key) {
      return name;
    }
  }
  return '';
}

/**
 * True when a mechanic name adds nothing to the level name next to it (the level is named
 * after the mechanic), so the banner leaves it out.
 * @param {string} mechanic - Player-facing mechanic name.
 * @param {string} levelName - Display name of the level.
 * @returns {boolean}
 */
export function repeatsLevelName(mechanic, levelName) {
  return levelName.toLocaleLowerCase().includes(mechanic.toLocaleLowerCase());
}

/**
 * Picks the fair-play sentence that matches the Daily rules actually in force, so the intro
 * never claims a rule the configuration leaves off.
 * @param {?{upgrades: boolean, ammo: boolean}} fairPlay - Active Daily fairness rules.
 * @returns {?string} A locale key, or null when no rule is active.
 */
export function resolveDailyFairPlayKey(fairPlay) {
  if (fairPlay?.upgrades && fairPlay?.ammo) {
    return 'hud.levelIntro.dailyFairPlay';
  }
  if (fairPlay?.upgrades) {
    return 'hud.levelIntro.dailyFairPlayUpgrades';
  }
  if (fairPlay?.ammo) {
    return 'hud.levelIntro.dailyFairPlayAmmo';
  }
  return null;
}

/**
 * Builds the objective banner text of a level played for the first time. The basics are never
 * named as the focus (every level has them), nor is a mechanic the level name already says.
 * @param {{levelId: number, summary: Object, maxShots: number, featuredMechanicId: string|null}} intro
 * @param {(key: string, params?: object) => string} translate - The translation function.
 * @returns {string} The one-line summary.
 */
export function buildLevelIntroText(intro, translate) {
  if (intro.mutatorKey) {
    const params = {
      mutator: translate(`gameplay.mutators.${intro.mutatorKey}`),
      effect: translate(`modals.shop.codex.mutators.${intro.mutatorKey}.description`)
    };
    const fairPlayKey = resolveDailyFairPlayKey(intro.fairPlay);
    if (!fairPlayKey) {
      return translate('hud.levelIntro.dailyMutator', params);
    }
    return translate('hud.levelIntro.dailyMutatorFair', { ...params, fairPlay: translate(fairPlayKey) });
  }
  const levelName = formatLevelName(intro.summary);
  const featuredName =
    intro.featuredMechanicId === BOARD_MECHANICS.BASICS
      ? ''
      : resolveMechanicName(intro.featuredMechanicId, translate);
  const mechanic = featuredName && !repeatsLevelName(featuredName, levelName) ? featuredName : '';
  const params = {
    id: intro.levelId,
    name: levelName,
    shots: intro.maxShots,
    mechanic
  };
  return translate(mechanic ? 'hud.levelIntro.summary' : 'hud.levelIntro.summaryPlain', params);
}

/** Accessible names that have one wording per input mode (the board's text alternative). */
export const INPUT_ARIA_HINTS = Object.freeze([{ elementId: 'game-canvas', key: 'hud.canvas.aria.label' }]);

/**
 * Splits the extras of a refresh into the one-shot ones, read from that call only, and the
 * persistent ones kept in lastExtra for the re-runs (language change, shop purchase...).
 * @param {object} extra - Extras passed to refresh.
 * @returns {{oneShot: object, persistentExtra: object}} The two halves.
 */
export function splitRefreshExtra(extra) {
  const { unlockedAchievementIds, fluxStageCleared, fluxPerkChosen, ...persistentExtra } = extra;
  return { oneShot: { unlockedAchievementIds, fluxStageCleared, fluxPerkChosen }, persistentExtra };
}

/** Default star ceiling when no scoring config is passed to resolveNextCampaignTarget. */
export const DEFAULT_MAX_STARS = 3;

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

/** Engine special-ammo block reasons mapped to their explanation. */
export const SPECIAL_AMMO_BLOCK_REASON_KEYS = Object.freeze({
  shotInFlight: 'modals.shop.specialAmmo.blocked.shotInFlight',
  stageChanging: 'modals.shop.specialAmmo.blocked.stageChanging',
  perkChoice: 'modals.shop.specialAmmo.blocked.perkChoice',
  fairPlay: 'modals.shop.specialAmmo.blocked.fairPlay'
});

/** Keys whose action is a one-shot toggle or trigger; auto-repeat must not re-fire them. */
export const REPEAT_SENSITIVE_KEY_CODES = new Set(['Space', 'KeyF', 'Enter', 'NumpadEnter', 'Escape']);
export const SPECIAL_BALL_KEY_PATTERN = /^Digit\d$/;

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

/** Run metrics a near-miss line can be expressed in. */
export const RUN_METRICS = Object.freeze(['stage', 'wave', 'score']);

/**
 * Run metrics the HUD marker is shown for. Score modes already show their record in the
 * HUD, so a marker there would only repeat it.
 */
export const BEST_MARKER_METRICS = Object.freeze(['stage', 'wave']);

/**
 * Builds the informational near-miss line of the Game Over modal. Returns an empty string
 * when the engine reports no near miss. The line is never tied to a purchase.
 * @param {{ metric: string, gap: number }|null|undefined} nearMiss - Engine near-miss summary.
 * @returns {string}
 */
export function formatNearMissText(nearMiss) {
  const gap = Math.floor(Number(nearMiss?.gap));
  if (!nearMiss || !RUN_METRICS.includes(nearMiss.metric) || !Number.isFinite(gap) || gap <= 0) {
    return '';
  }
  const form = gap === 1 ? 'one' : 'other';
  return t(`modals.gameOver.nearMiss.${nearMiss.metric}.${form}`, { count: formatNumber(gap) });
}

/**
 * Builds the compact "Best: shape 12" run marker shown in the HUD during a stage or wave
 * run that has a record to beat. Empty for score modes.
 * @param {{ metric: string, best: number }|null|undefined} marker - Engine best-run marker.
 * @returns {string}
 */
export function formatBestRunMarker(marker) {
  const best = Number(marker?.best);
  if (!marker || !BEST_MARKER_METRICS.includes(marker.metric) || !Number.isFinite(best) || best <= 0) {
    return '';
  }
  return t(`hud.stats.bestRun.${marker.metric}`, { best: formatNumber(best) });
}

/**
 * Builds the calm streak-grace note. It says the grace was used only on the day it was
 * used, so it never reads as a lasting warning; otherwise it says whether a missed day is
 * still forgiven or when that comes back.
 * @param {number} streak - Current daily streak.
 * @param {{ available?: boolean, usedOn?: string|null, daysUntilAvailable?: number }|null|undefined} grace
 *   Storage grace state.
 * @param {string} todayKey - UTC date key of today.
 * @returns {string}
 */
export function formatStreakGraceText(streak, grace, todayKey) {
  if (!(streak > 0) || !grace) {
    return '';
  }
  if (grace.usedOn && grace.usedOn === todayKey) {
    return t('modals.gameOver.daily.graceUsed');
  }
  if (grace.available) {
    return t('modals.gameOver.daily.graceAvailable');
  }
  const days = Math.floor(Number(grace.daysUntilAvailable));
  return days > 0 ? t('modals.gameOver.daily.graceReturns', { days: formatNumber(days) }) : '';
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
export const pendingLiveRegionTexts = new WeakMap();

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
export function scheduleNextFrame(callback) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
  } else {
    callback();
  }
}

/** Screen orientation angles, in degrees, as reported by screen.orientation.angle. */
export const SCREEN_ANGLES = Object.freeze({ PORTRAIT: 0, LANDSCAPE_LEFT: 90, UPSIDE_DOWN: 180, LANDSCAPE_RIGHT: 270 });
export const FULL_TURN_DEGREES = 360;

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

/** Star counts last rendered into each glyph element, so an unchanged value skips the rebuild. */
export const renderedStarGlyphs = new WeakMap();

/** Writes text only when it differs, so live regions are not re-announced needlessly. */
export function setTextIfChanged(element, text) {
  if (element && element.textContent !== text) {
    element.textContent = text;
  }
}

export function setAttributeIfChanged(element, name, value) {
  if (element && element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/** Class of a mode button or card that the campaign has not unlocked yet. */
export const MODE_LOCKED_CLASS = 'is-locked';
/** Class of a mode button or card unlocked and not played yet. */
export const MODE_NEW_CLASS = 'is-new';
/** Class of the "New" badge shown beside a newly unlocked mode. */
export const MODE_NEW_BADGE_CLASS = 'mode-new-badge';

/** i18n key of each gated mode's name; the lock texts, hints and announcements reuse them. */
export const MODE_NAME_KEYS = Object.freeze({
  [GAME_MODES.ENDLESS]: 'app.nav.button.endless',
  [GAME_MODES.PUZZLE]: 'modals.levelSelect.arcade.puzzle',
  [GAME_MODES.BLITZ]: 'modals.levelSelect.arcade.blitz',
  [GAME_MODES.FLUX]: 'app.nav.button.flux',
  [GAME_MODES.CASCADE]: 'modals.levelSelect.arcade.cascade',
  [GAME_MODES.BOSS_RUSH]: 'modals.levelSelect.arcade.bossRush'
});

/** Menu buttons (UIManager.elements keys) of each gated mode. Weekly Flux follows Flux. */
export const MODE_LOCK_BUTTON_KEYS = Object.freeze({
  [GAME_MODES.ENDLESS]: Object.freeze(['btnEndless']),
  [GAME_MODES.FLUX]: Object.freeze(['btnFlux', 'btnWeekly'])
});

/** Arcade cards of the level select: element keys and the texts a card shows while unlocked. */
export const ARCADE_CARD_SPECS = Object.freeze({
  [GAME_MODES.PUZZLE]: Object.freeze({
    card: 'btnModePuzzle',
    best: 'arcadeBestPuzzle',
    titleKey: 'modals.levelSelect.arcade.puzzle',
    descKey: 'modals.levelSelect.arcade.puzzleDesc'
  }),
  [GAME_MODES.BLITZ]: Object.freeze({
    card: 'btnModeBlitz',
    best: 'arcadeBestBlitz',
    titleKey: 'modals.levelSelect.arcade.blitz',
    descKey: 'modals.levelSelect.arcade.blitzDesc'
  }),
  [GAME_MODES.BOSS_RUSH]: Object.freeze({
    card: 'btnModeBossRush',
    best: 'arcadeBestBossRush',
    titleKey: 'modals.levelSelect.arcade.bossRush',
    descKey: 'modals.levelSelect.arcade.bossRushDesc'
  }),
  [GAME_MODES.CASCADE]: Object.freeze({
    card: 'btnModeCascade',
    best: 'arcadeBestCascade',
    titleKey: 'modals.levelSelect.arcade.cascade',
    descKey: 'modals.levelSelect.arcade.cascadeDesc'
  })
});

/** Matches the leading symbols and spaces of a label such as an emoji-prefixed mode name. */
const LEADING_SYMBOLS_PATTERN = /^[^\p{L}\p{N}]+/u;

/**
 * A mode name without its leading emoji, for sentences ("Clear level 5 to unlock Puzzle").
 * @param {string} label - Translated mode name.
 * @returns {string}
 */
export function plainModeName(label) {
  const text = String(label ?? '');
  const plain = text.replace(LEADING_SYMBOLS_PATTERN, '').trim();
  return plain || text;
}

/**
 * True when the engine runs the weekly Flux of the given (current) week. A run of an older
 * week, still open after Monday 00:00 UTC, is not highlighted as the Weekly button.
 * @param {{mode?: string, isWeeklyFluxRun?: boolean, weeklyWeekKey?: string|null}} engine - Game engine.
 * @param {string} currentWeekKey - Week key of now.
 * @returns {boolean}
 */
export function isCurrentWeeklyRun(engine, currentWeekKey) {
  return engine?.mode === GAME_MODES.FLUX
    && engine.isWeeklyFluxRun === true
    && engine.weeklyWeekKey === currentWeekKey;
}

/**
 * True unless the access table says the mode is locked. A missing entry (always-open modes,
 * or storage that cannot say) never blocks a start.
 * @param {Object<string, {unlocked?: boolean}>|null|undefined} access - Storage getModeAccess().
 * @param {string} mode - Mode id.
 * @returns {boolean} False only when the access table says the mode is locked.
 */
export function isModeUnlocked(access, mode) {
  return access?.[mode]?.unlocked !== false;
}

/**
 * The texts and flags a gated mode control shows for its current access.
 * @param {string} mode - Mode id.
 * @param {Object<string, {unlocked?: boolean, isNew?: boolean, requiredLevel?: number}>|null|undefined} access
 *   Storage getModeAccess().
 * @param {(key: string, params?: object) => string} translate - Translation function.
 * @param {string} [nameKey] - Name key override (Weekly Flux shares the Flux access).
 * @returns {{isLocked: boolean, isNew: boolean, name: string, level: number, label: string,
 *   ariaLabel: string, hint: string, newBadge: string, newAria: string}}
 */
export function describeModeLock(mode, access, translate, nameKey = MODE_NAME_KEYS[mode]) {
  const entry = access?.[mode];
  const name = nameKey ? plainModeName(translate(nameKey)) : '';
  const level = Number(entry?.requiredLevel) || 0;
  const isLocked = Boolean(entry) && entry.unlocked === false;
  const isNew = Boolean(entry) && !isLocked && entry.isNew === true;
  return {
    isLocked,
    isNew,
    name,
    level,
    label: isLocked ? translate('app.nav.locked.label', { mode: name }) : '',
    ariaLabel: isLocked ? translate('app.nav.locked.aria', { mode: name, level }) : '',
    hint: isLocked ? translate('app.nav.locked.hint', { mode: name, level }) : '',
    newBadge: isNew ? translate('app.nav.locked.newBadge') : '',
    newAria: isNew ? translate('app.nav.locked.newAria', { mode: name }) : ''
  };
}

/**
 * Sets a control's label and an optional "New" badge, rebuilding only when something differs
 * (a translation pass rewrites the text of a data-i18n control, which this notices).
 * @param {HTMLElement|null} element - Button or card title.
 * @param {string} label - Label text.
 * @param {string} [badgeText] - Badge text, or empty for none.
 */
export function setModeLabel(element, label, badgeText = '') {
  if (!element) {
    return;
  }
  const expected = badgeText ? `${label} ${badgeText}` : label;
  const hasBadge = Boolean(element.querySelector?.(`.${MODE_NEW_BADGE_CLASS}`));
  if (element.textContent === expected && hasBadge === Boolean(badgeText)) {
    return;
  }
  element.textContent = label;
  if (badgeText) {
    const badge = document.createElement('span');
    badge.className = MODE_NEW_BADGE_CLASS;
    badge.textContent = badgeText;
    element.append(' ', badge);
  }
}

/** Plain names of the gated modes in a list, joined with the localized list separator. */
export function formatUnlockedModeNames(modes, translate) {
  return (Array.isArray(modes) ? modes : [])
    .filter((mode) => Object.hasOwn(MODE_NAME_KEYS, mode))
    .map((mode) => plainModeName(translate(MODE_NAME_KEYS[mode])))
    .join(translate('gameplay.feedback.achievement.listSeparator'));
}

/**
 * The victory window line for modes a campaign victory just unlocked.
 * @param {string[]} modes - Unlocked mode ids.
 * @param {(key: string, params?: object) => string} translate - Translation function.
 * @returns {string} Empty when no known gated mode is in the list.
 */
export function formatUnlockedModesText(modes, translate) {
  const known = (Array.isArray(modes) ? modes : []).filter((mode) => Object.hasOwn(MODE_NAME_KEYS, mode));
  if (known.length === 0) {
    return '';
  }
  if (known.length === 1) {
    return translate('modals.victory.unlock.single', {
      mode: plainModeName(translate(MODE_NAME_KEYS[known[0]]))
    });
  }
  return translate('modals.victory.unlock.multiple', { modes: formatUnlockedModeNames(known, translate) });
}

/** True when a control carries aria-disabled="true" (a locked mode: focusable, but inert). */
export function isAriaDisabled(element) {
  return element?.getAttribute?.('aria-disabled') === 'true';
}
