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
import { t, formatNumber } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { resolveDailyPuzzleStage } from '../game/DailyShare.js';
import { getUtcIsoWeekKey } from '../game/WeeklyFlux.js';
import {
  ARCADE_CARD_SPECS,
  FULL_PERCENT,
  MODE_BUTTON_KEYS,
  VISUALLY_HIDDEN_CLASS,
  WEEKLY_ACCESS_KEY,
  isCurrentWeeklyRun,
  isModeUnlocked,
  setAttributeIfChanged,
  setTextIfChanged,
  syncFluxSeedValidationError
} from './UIHelpers.js';

/*
 * The Play hub: the one dialog that lists every mode. This module holds its behaviour
 * (records, campaign card, disclosures, focus, 2P entry); bindings and markup live elsewhere.
 * Nothing here reads a UIHelpers binding at module evaluation (ESM cycle with LevelSelectView).
 */

const HIDDEN_CLASS = 'hidden';
const ACTIVE_MODE_CLASS = 'active-mode';
const DEFAULT_MAX_STARS = 3;
const DEFAULT_STAGE = 1;

/** Kinds of the primary Campaign button. */
export const CONTINUE_KINDS = Object.freeze({
  RESUME: 'resume',
  PLAY: 'play',
  MAP: 'map'
});

/** Tabs of the Play hub dialog. */
export const PLAY_HUB_TABS = Object.freeze({
  FEATURED: 'featured',
  ARCADE: 'arcade',
  DUEL: 'duel'
});

/** Arcade modes grouped by subhead (excludes Versus and Weekly which live in other tabs). */
const ARCADE_GROUPS = Object.freeze({
  core: Object.freeze([
    GAME_MODES.ENDLESS,
    GAME_MODES.CLASSIC,
    GAME_MODES.PUZZLE,
    GAME_MODES.BLITZ,
    GAME_MODES.FLUX,
    GAME_MODES.CASCADE,
    GAME_MODES.BOSS_RUSH
  ]),
  labs: Object.freeze([
    GAME_MODES.HEX_GRID,
    GAME_MODES.PINBALL,
    GAME_MODES.ORBITAL,
    GAME_MODES.CONVOY,
    GAME_MODES.MERGE,
    GAME_MODES.SLINGSHOT
  ])
});

const ARCADE_TAB_MODES = Object.freeze([
  ...ARCADE_GROUPS.core,
  ...ARCADE_GROUPS.labs
]);

/** Disclosure names, each with the toggle button and the panel it shows (UIManager.elements keys). */
export const PLAY_HUB_DISCLOSURES = Object.freeze({
  puzzle: Object.freeze({ toggle: 'btnPuzzleStagesToggle', panel: 'puzzleStagesStrip' }),
  seed: Object.freeze({ toggle: 'btnFluxSeedToggle', panel: 'fluxSeedEntry' })
});

/** Element key of the Weekly card; Weekly is not a game mode, so MODE_BUTTON_KEYS has no entry. */
const WEEKLY_CARD_KEY = 'btnWeekly';
/** Element key of the primary Campaign button, the default focus of the hub. */
const CONTINUE_KEY = 'btnCampaignContinue';

/**
 * True while the engine holds a run (playing or paused).
 * @param {{state?: string}|null|undefined} engine - Game engine.
 * @returns {boolean}
 */
function isEngineRunActive(engine) {
  return engine?.state === GAME_STATES.PLAYING || engine?.state === GAME_STATES.PAUSED;
}

/**
 * The hub mode key of the running mode: a game mode id, or the Weekly pseudo key for the
 * Weekly Flux run of the current week. Null without a run, or for a Flux run no card stands for
 * (shared seed, past Weekly, ghost duel).
 * @param {object|null|undefined} engine - Game engine.
 * @param {string} weekKey - ISO week key of now.
 * @returns {string|null}
 */
export function resolveRunningModeKey(engine, weekKey) {
  if (!isEngineRunActive(engine) || !engine.mode) {
    return null;
  }
  if (isCurrentWeeklyRun(engine, weekKey)) {
    return WEEKLY_ACCESS_KEY;
  }
  // A shared seed (a past Weekly is one too) or a ghost duel is a Flux run that no hub card resumes.
  if (engine.mode === GAME_MODES.FLUX && (engine.isSharedFluxRun || engine.ghostDuel)) {
    return null;
  }
  return engine.mode;
}

/**
 * True when the card of a mode is the mode currently running (A18). Weekly follows the
 * current-week run only; plain Flux is a Flux run that is not the current Weekly.
 * @param {object|null|undefined} engine - Game engine.
 * @param {string} modeKey - Game mode id or WEEKLY_ACCESS_KEY.
 * @param {string} weekKey - ISO week key of now.
 * @returns {boolean}
 */
export function isModeRunning(engine, modeKey, weekKey) {
  return resolveRunningModeKey(engine, weekKey) === modeKey;
}

/**
 * Element key of the hub card for a running mode key, or null when the mode has no card.
 * @param {string|null} modeKey - Game mode id or WEEKLY_ACCESS_KEY.
 * @returns {string|null}
 */
export function cardElementKeyForMode(modeKey) {
  if (!modeKey) {
    return null;
  }
  if (modeKey === WEEKLY_ACCESS_KEY) {
    return WEEKLY_CARD_KEY;
  }
  return MODE_BUTTON_KEYS[modeKey]?.[0] ?? ARCADE_CARD_SPECS[modeKey]?.card ?? null;
}

/**
 * The element key the hub focuses first: the primary Campaign button without a run or in a
 * campaign run, otherwise the card of the running mode when it is unlocked.
 * @param {{engine: object, access: object, weekKey: string}} input - Engine, getModeAccess() and week key.
 * @returns {string} UIManager.elements key.
 */
export function resolveInitialFocusKey({ engine, access, weekKey }) {
  const modeKey = resolveRunningModeKey(engine, weekKey);
  if (!modeKey || modeKey === GAME_MODES.CAMPAIGN) {
    return CONTINUE_KEY;
  }
  const cardKey = cardElementKeyForMode(modeKey);
  if (!cardKey || !isModeUnlocked(access, modeKey)) {
    return CONTINUE_KEY;
  }
  return cardKey;
}

/**
 * Maps a resolved initial focus element key to the Play hub tab that contains it.
 * @param {string|null|undefined} focusKey - UIManager.elements key.
 * @returns {string} One of PLAY_HUB_TABS.
 */
export function resolvePlayHubTabForFocusKey(focusKey) {
  if (!focusKey) {
    return PLAY_HUB_TABS.FEATURED;
  }
  if (focusKey === ARCADE_CARD_SPECS[GAME_MODES.VERSUS]?.card) {
    return PLAY_HUB_TABS.DUEL;
  }
  for (const mode of ARCADE_TAB_MODES) {
    if (ARCADE_CARD_SPECS[mode]?.card === focusKey) {
      return PLAY_HUB_TABS.ARCADE;
    }
  }
  return PLAY_HUB_TABS.FEATURED;
}

/**
 * What the primary Campaign button does (A19): resume the running campaign level, play the
 * suggested level, or (everything cleared with every star) open the map.
 * @param {object} input - Campaign state.
 * @param {number} input.suggestedLevelId - Level the hub puts forward.
 * @param {number} input.firstLevelId - First level id of the catalog.
 * @param {number} input.lastLevelId - Last level id of the catalog.
 * @param {number} input.clearedLevel - Highest cleared campaign level.
 * @param {Object<number, {stars?: number}>} input.levelStats - Stats by level id.
 * @param {number} input.maxStars - Stars of a perfect level.
 * @param {boolean} input.campaignRunActive - A campaign run is playing or paused.
 * @returns {{kind: string, levelId: number|null}}
 */
export function resolveContinueTarget({
  suggestedLevelId,
  firstLevelId,
  lastLevelId,
  clearedLevel,
  levelStats,
  maxStars,
  campaignRunActive
}) {
  if (campaignRunActive) {
    return { kind: CONTINUE_KINDS.RESUME, levelId: suggestedLevelId };
  }
  if (clearedLevel < lastLevelId) {
    return { kind: CONTINUE_KINDS.PLAY, levelId: suggestedLevelId };
  }
  for (let levelId = firstLevelId; levelId <= lastLevelId; levelId++) {
    if ((levelStats?.[levelId]?.stars || 0) < maxStars) {
      return { kind: CONTINUE_KINDS.PLAY, levelId };
    }
  }
  return { kind: CONTINUE_KINDS.MAP, levelId: null };
}

/**
 * Stars earned and available in a chapter.
 * @param {{firstId: number, lastId: number}} chapter - Catalog chapter.
 * @param {Object<number, {stars?: number}>} levelStats - Stats by level id.
 * @param {number} maxStars - Stars of a perfect level.
 * @returns {{stars: number, maxStars: number}}
 */
export function sumChapterStars(chapter, levelStats, maxStars) {
  let stars = 0;
  for (let levelId = chapter.firstId; levelId <= chapter.lastId; levelId++) {
    stars += Math.max(0, Math.min(maxStars, levelStats?.[levelId]?.stars || 0));
  }
  return { stars, maxStars: (chapter.lastId - chapter.firstId + 1) * maxStars };
}

/**
 * Visibility of the two-player entry and of its explanation (A: shown only when two boards fit
 * and the duel is unlocked; the hint stands in only when the duel is open but the window is small).
 * @param {{fits: boolean, unlocked: boolean}} input
 * @returns {{showButton: boolean, showHint: boolean}}
 */
export function resolveVersusLocalEntry({ fits, unlocked }) {
  return { showButton: fits && unlocked, showHint: !fits && unlocked };
}

/**
 * The Daily reward chip: done today (with the streak when above one day), else the first-play bonus.
 * @param {{played: boolean, streak: number, bonusCoins: number}} state - Daily state.
 * @param {(key: string, params?: object) => string} translate - Translation function.
 * @returns {{text: string, ariaLabel: string}} Empty text when nothing is worth showing.
 */
export function describeDailyReward({ played, streak, bonusCoins }, translate) {
  if (played) {
    return {
      text: streak > 1
        ? translate('modals.play.daily.doneStreak', { streak: formatNumber(streak) })
        : translate('modals.play.daily.done'),
      ariaLabel: ''
    };
  }
  return describeCoinBonus(bonusCoins, translate);
}

/**
 * The Weekly reward chip: this week's best once played, else the unclaimed first-play bonus.
 * @param {{bestScore: number, bonusCoins: number, claimed: boolean}} state - Weekly state.
 * @param {(key: string, params?: object) => string} translate - Translation function.
 * @returns {{text: string, ariaLabel: string}} Empty text when nothing is worth showing.
 */
export function describeWeeklyReward({ bestScore, bonusCoins, claimed }, translate) {
  if (bestScore > 0) {
    return {
      text: translate('modals.levelSelect.card.bestScore', { score: formatNumber(bestScore) }),
      ariaLabel: ''
    };
  }
  return claimed ? { text: '', ariaLabel: '' } : describeCoinBonus(bonusCoins, translate);
}

function describeCoinBonus(bonusCoins, translate) {
  if (!(bonusCoins > 0)) {
    return { text: '', ariaLabel: '' };
  }
  const coins = formatNumber(bonusCoins);
  return {
    text: translate('modals.play.reward', { coins }),
    ariaLabel: translate('modals.play.rewardAria', { coins })
  };
}

/** Writes a reward chip: text, accessible name and visibility. */
export function writeRewardChip(chip, reward) {
  if (!chip) {
    return;
  }
  setTextIfChanged(chip, reward.text);
  chip.classList.toggle(HIDDEN_CLASS, !reward.text);
  if (reward.ariaLabel) {
    setAttributeIfChanged(chip, 'aria-label', reward.ariaLabel);
  } else {
    chip.removeAttribute?.('aria-label');
  }
}

/**
 * Renders the 3 daily session bounties inside #play-bounties-list without innerHTML.
 * Each unfinished contract renders as an interactive button that launches or resumes its mode.
 * @param {HTMLElement|null|undefined} listEl - Container <ul> element.
 * @param {{items?: Array<object>}|null|undefined} state - Storage bounties state.
 */
function renderDailyBounties(listEl, state) {
  if (!listEl || typeof document === 'undefined') {
    return;
  }
  const items = Array.isArray(state?.items) ? state.items : [];
  listEl.replaceChildren();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const completed = Boolean(item.completed);
    const target = Math.max(1, Number(item.target) || 1);
    const progress = completed ? target : Math.max(0, Math.min(target, Number(item.progress) || 0));
    const pct = Math.round((progress / target) * FULL_PERCENT);

    const li = document.createElement('li');
    li.className = completed ? 'play-bounty-row is-done' : 'play-bounty-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `play-bounty-${index}`;
    btn.className = 'play-bounty-btn';
    btn.dataset.bountyId = String(item.id || '');
    btn.dataset.bountyEvent = String(item.eventKey || '');
    btn.dataset.bountyMode = typeof item.mode === 'string' && item.mode ? item.mode : '';
    btn.disabled = completed;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'play-bounty-title';
    titleSpan.textContent = t(`modals.play.bounties.items.${item.id}.title`, {
      target: formatNumber(target)
    });
    const progSpan = document.createElement('span');
    progSpan.className = 'play-bounty-progress';
    progSpan.textContent = completed
      ? t('modals.play.bounties.done')
      : t('modals.play.bounties.progress', {
          progress: formatNumber(progress),
          target: formatNumber(target)
        });
    const rewardSpan = document.createElement('span');
    rewardSpan.className = 'play-bounty-reward';
    rewardSpan.textContent = t('modals.play.bounties.reward', { coins: formatNumber(item.coins) });

    const meterSpan = document.createElement('span');
    meterSpan.className = 'play-bounty-meter';
    meterSpan.setAttribute('aria-hidden', 'true');
    const meterFill = document.createElement('span');
    meterFill.className = 'play-bounty-meter-fill';
    meterFill.style.width = `${pct}%`;
    meterSpan.append(meterFill);

    btn.append(titleSpan, progSpan, rewardSpan, meterSpan);
    li.append(btn);
    listEl.append(li);
  }
}

const DEFAULT_MASTERY = Object.freeze({
  campaignStars: 30,
  dailyStreak: 3,
  endlessScore: 5000,
  classicStage: 5,
  blitzScore: 4000,
  fluxStage: 5,
  cascadeScore: 5000,
  bossRushWave: 5,
  hexGridWave: 5,
  pinballStage: 3,
  orbitalWave: 5,
  convoyWave: 5,
  mergeTier: 7,
  slingshotStage: 4,
  versusHardWins: 1
});
const MASTERED_CLASS = 'is-mastered';
const MASTERED_BADGE_CLASS = 'mode-mastered-badge';
const MASTERED_STAR_CLASS = 'mode-mastered-star';
const MASTERY_METER_CLASS = 'mode-mastery-meter';
const MASTERY_FILL_CLASS = 'mode-mastery-fill';

const MODE_MASTERY_SPECS = Object.freeze([
  [GAME_MODES.CAMPAIGN, (s) => s.getTotalStars?.() || 0, 'campaignStars'],
  [GAME_MODES.DAILY, (s) => s.getDailyStreak?.() || 0, 'dailyStreak'],
  [GAME_MODES.ENDLESS, (s) => s.getEndlessHighScore?.() || 0, 'endlessScore'],
  [GAME_MODES.CLASSIC, (s) => s.getClassicBestStage?.() || 0, 'classicStage'],
  [GAME_MODES.BLITZ, (s) => s.getBlitzHighScore?.() || 0, 'blitzScore'],
  [GAME_MODES.FLUX, (s) => s.getFluxBestStage?.() || 0, 'fluxStage'],
  [GAME_MODES.CASCADE, (s) => s.getCascadeHighScore?.() || 0, 'cascadeScore'],
  [GAME_MODES.BOSS_RUSH, (s) => s.getBossRushBestWave?.() || 0, 'bossRushWave'],
  [GAME_MODES.HEX_GRID, (s) => s.getHexGridBestWave?.() || 0, 'hexGridWave'],
  [GAME_MODES.PINBALL, (s) => s.getPinballBestStage?.() || 0, 'pinballStage'],
  [GAME_MODES.ORBITAL, (s) => s.getOrbitalBestWave?.() || 0, 'orbitalWave'],
  [GAME_MODES.CONVOY, (s) => s.getConvoyBestWave?.() || 0, 'convoyWave'],
  [GAME_MODES.MERGE, (s) => s.getMergeBestTier?.() || 0, 'mergeTier'],
  [GAME_MODES.SLINGSHOT, (s) => s.getSlingshotBestStage?.() || 0, 'slingshotStage']
]);

function buildMasteryEntry(current, target) {
  const safeTarget = Math.max(0, Number(target) || 0);
  const safeCurrent = Math.max(0, Number(current) || 0);
  if (safeTarget <= 0) {
    return { current: safeCurrent, target: 0, ratio: 0, mastered: false };
  }
  return {
    current: safeCurrent,
    target: safeTarget,
    ratio: Math.min(1, safeCurrent / safeTarget),
    mastered: safeCurrent >= safeTarget
  };
}

function syncMasteryMeter(card, showMeter, ratio) {
  let meter = card.querySelector(`.${MASTERY_METER_CLASS}`);
  if (!showMeter) {
    meter?.classList?.add(HIDDEN_CLASS);
    return;
  }
  if (!meter) {
    meter = document.createElement('span');
    meter.className = MASTERY_METER_CLASS;
    meter.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    fill.className = MASTERY_FILL_CLASS;
    meter.append(fill);
    card.append(meter);
  }
  meter.classList.remove(HIDDEN_CLASS);
  const fill = meter.querySelector(`.${MASTERY_FILL_CLASS}`);
  if (fill) {
    fill.style.width = `${Math.round(ratio * FULL_PERCENT)}%`;
  }
}

/**
 * Attaches or updates an accessible Mastery badge and optional progress meter inside a Play Hub card.
 * @param {HTMLElement|object|null|undefined} card - Mode button or section element.
 * @param {boolean} mastered - Whether the mode has reached mastery.
 * @param {string} starSymbol - Star symbol from `gameConfig.theme.starFilledSymbol`.
 * @param {string} srLabel - Localized screen-reader label for mastery.
 * @param {{current: number, target: number, ratio: number, showMeter?: boolean}|null} [progress] - Progress details.
 */
function shouldShowMasteryBar(mastered, progress) {
  if (mastered || progress?.showMeter === false) {
    return false;
  }
  return Boolean(progress && progress.current > 0 && progress.ratio > 0 && progress.ratio < 1);
}

function ensureMasteredBadge(card) {
  let badge = card.querySelector(`.${MASTERED_BADGE_CLASS}`);
  if (badge) {
    return badge;
  }
  badge = document.createElement('span');
  badge.className = MASTERED_BADGE_CLASS;
  const starSpan = document.createElement('span');
  starSpan.className = MASTERED_STAR_CLASS;
  starSpan.setAttribute('aria-hidden', 'true');
  const srSpan = document.createElement('span');
  srSpan.className = VISUALLY_HIDDEN_CLASS;
  badge.append(starSpan, srSpan);
  card.append(badge);
  return badge;
}

function syncMasteredBadge(card, mastered, starSymbol, srLabel, progress = null) {
  if (!card) {
    return;
  }
  card.classList?.toggle(MASTERED_CLASS, Boolean(mastered));
  if (typeof document === 'undefined' || typeof card.querySelector !== 'function' || typeof card.append !== 'function') {
    return;
  }
  syncMasteryMeter(card, shouldShowMasteryBar(mastered, progress), progress?.ratio || 0);
  if (!mastered) {
    card.querySelector(`.${MASTERED_BADGE_CLASS}`)?.classList?.add(HIDDEN_CLASS);
    return;
  }
  const badge = ensureMasteredBadge(card);
  badge.classList.remove(HIDDEN_CLASS);
  setTextIfChanged(badge.querySelector(`.${MASTERED_STAR_CLASS}`), starSymbol);
  setTextIfChanged(badge.querySelector(`.${VISUALLY_HIDDEN_CLASS}`), srLabel);
}

function readVersusHardWins(storage) {
  const records = storage.getVersusRecords?.() || storage.getVersusStats?.() || {};
  return records.hard?.w ?? records.hard?.won ?? 0;
}

/**
 * Computes progress toward each Play Hub mode's mastery milestone.
 * @param {object} storage - StorageManager or compatible mock.
 * @param {object} [gameConfig] - Game config carrying `playHub.mastery`, `puzzles`, `scoring`.
 * @returns {Record<string, {current: number, target: number, ratio: number, mastered: boolean}>}
 */
export function resolveModeMasteryProgress(storage, gameConfig) {
  if (!storage) {
    return {};
  }
  const m = { ...DEFAULT_MASTERY, ...(gameConfig?.playHub?.mastery || {}) };
  const totalPuzzles = Math.max(1, gameConfig?.puzzles?.length || 1);
  const maxPuzzleStars = gameConfig?.scoring?.maxStars || 0;
  const result = {};
  for (const [mode, readValue, targetKey] of MODE_MASTERY_SPECS) {
    result[mode] = buildMasteryEntry(readValue(storage), m[targetKey]);
  }
  const puzzleCurrent = maxPuzzleStars > 0 ? (storage.getPuzzleTotalStars?.() || 0) : 0;
  result[GAME_MODES.PUZZLE] = buildMasteryEntry(puzzleCurrent, totalPuzzles * maxPuzzleStars);
  result[GAME_MODES.VERSUS] = buildMasteryEntry(readVersusHardWins(storage), m.versusHardWins);
  return result;
}

/**
 * Computes which Play Hub mode cards have reached their configured mastery milestone.
 * Pure helper; missing storage getters evaluate to false.
 * @param {object} storage - StorageManager or compatible mock.
 * @param {object} [gameConfig] - Game config carrying `playHub.mastery`, `puzzles`, `scoring`.
 * @returns {Record<string, boolean>} Map of mode key to mastered flag.
 */
export function resolveModeMastery(storage, gameConfig) {
  const progress = resolveModeMasteryProgress(storage, gameConfig);
  const mastered = {};
  for (const [mode, entry] of Object.entries(progress)) {
    mastered[mode] = entry.mastered;
  }
  return mastered;
}

function readStorageNumber(storage, getter, fallback = 0) {
  const fn = storage?.[getter];
  return typeof fn === 'function' ? (fn.call(storage) || fallback) : fallback;
}

const SCORE_RECORD_CARDS = Object.freeze([
  ['arcadeBestEndless', 'getEndlessHighScore'],
  ['arcadeBestBlitz', 'getBlitzHighScore'],
  ['arcadeBestCascade', 'getCascadeHighScore']
]);

const WAVE_RECORD_CARDS = Object.freeze([
  ['arcadeBestBossRush', 'getBossRushBestWave', 'getBossRushHighScore'],
  ['arcadeBestHexGrid', 'getHexGridBestWave', 'getHexGridHighScore'],
  ['arcadeBestOrbital', 'getOrbitalBestWave', 'getOrbitalHighScore'],
  ['arcadeBestConvoy', 'getConvoyBestWave', 'getConvoyHighScore']
]);

const STAGE_RECORD_CARDS = Object.freeze([
  ['arcadeBestFlux', 'modals.play.arcade.fluxRecord', 'getFluxBestStage', 'getFluxHighScore'],
  ['arcadeBestPinball', 'modals.levelSelect.arcade.pinballRecord', 'getPinballBestStage', 'getPinballHighScore'],
  ['arcadeBestSlingshot', 'modals.levelSelect.arcade.pinballRecord', 'getSlingshotBestStage', 'getSlingshotHighScore']
]);

function refreshArcadeRecordLines(els, storage, gameConfig) {
  const totalPuzzles = Math.max(1, gameConfig?.puzzles?.length || 1);
  const bestPuzzleStage = Math.min(totalPuzzles, Math.max(DEFAULT_STAGE, readStorageNumber(storage, 'getPuzzleBestStage', 1)));
  const maxPuzzleStars = gameConfig?.scoring?.maxStars || 0;
  for (const [elKey, scoreGetter] of SCORE_RECORD_CARDS) {
    setTextIfChanged(els[elKey], t('modals.levelSelect.card.bestScore', { score: formatNumber(readStorageNumber(storage, scoreGetter)) }));
  }
  setTextIfChanged(
    els.arcadeBestClassic,
    t('modals.levelSelect.arcade.classicBest', { stage: formatNumber(Math.max(DEFAULT_STAGE, readStorageNumber(storage, 'getClassicBestStage', 1))) })
  );
  setTextIfChanged(
    els.arcadeBestPuzzle,
    t('modals.levelSelect.arcade.puzzleRecord', {
      stage: formatNumber(bestPuzzleStage),
      total: formatNumber(totalPuzzles),
      stars: formatNumber(readStorageNumber(storage, 'getPuzzleTotalStars')),
      maxStars: formatNumber(totalPuzzles * maxPuzzleStars)
    })
  );
  for (const [elKey, key, stageGetter, scoreGetter] of STAGE_RECORD_CARDS) {
    setTextIfChanged(els[elKey], t(key, {
      stage: formatNumber(Math.max(DEFAULT_STAGE, readStorageNumber(storage, stageGetter, 1))),
      score: formatNumber(readStorageNumber(storage, scoreGetter))
    }));
  }
  for (const [elKey, waveGetter, scoreGetter] of WAVE_RECORD_CARDS) {
    setTextIfChanged(els[elKey], t('modals.levelSelect.arcade.bossRushRecord', {
      wave: formatNumber(Math.max(DEFAULT_STAGE, readStorageNumber(storage, waveGetter, 1))),
      score: formatNumber(readStorageNumber(storage, scoreGetter))
    }));
  }
  setTextIfChanged(
    els.arcadeBestMerge,
    t('modals.levelSelect.arcade.mergeRecord', {
      tier: formatNumber(Math.max(DEFAULT_STAGE, readStorageNumber(storage, 'getMergeBestTier', 1))),
      score: formatNumber(readStorageNumber(storage, 'getMergeHighScore'))
    })
  );
}

export const PLAY_HUB_FILTERS = Object.freeze({
  ALL: 'all',
  UNLOCKED: 'unlocked',
  QUICK: 'quick',
  ENDLESS: 'endless',
  UNMASTERED: 'unmastered'
});

const QUICK_ARCADE_MODES = new Set([
  GAME_MODES.PUZZLE,
  GAME_MODES.BLITZ,
  GAME_MODES.PINBALL,
  GAME_MODES.SLINGSHOT
]);

export function matchesArcadeFilter(mode, filter, masteryEntry, unlocked = true) {
  if (filter === PLAY_HUB_FILTERS.UNLOCKED) {
    return Boolean(unlocked);
  }
  if (filter === PLAY_HUB_FILTERS.QUICK) {
    return QUICK_ARCADE_MODES.has(mode);
  }
  if (filter === PLAY_HUB_FILTERS.ENDLESS) {
    return !QUICK_ARCADE_MODES.has(mode);
  }
  if (filter === PLAY_HUB_FILTERS.UNMASTERED) {
    return !masteryEntry?.mastered;
  }
  return true;
}

export function resolveNextUnmasteredArcadeMode(storage, gameConfig) {
  if (!storage) {
    return null;
  }
  const mastery = resolveModeMasteryProgress(storage, gameConfig);
  for (const mode of Object.keys(ARCADE_CARD_SPECS)) {
    if (isModeUnlocked(mode, storage, gameConfig) && !mastery[mode]?.mastered) {
      return mode;
    }
  }
  return null;
}

function getArcadeCardWrapper(card) {
  return card?.closest?.('.play-hub-cell') || card;
}

function syncPlayHubFilterEmptyState(visibleCount, activeFilter) {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') {
    return;
  }
  const emptyBox = document.getElementById('play-hub-filter-empty');
  if (!emptyBox) {
    return;
  }
  const isEmpty = visibleCount === 0;
  emptyBox.classList.toggle(HIDDEN_CLASS, !isEmpty);
  if (!isEmpty) {
    return;
  }
  const emptyText = document.getElementById('play-hub-filter-empty-text');
  if (emptyText) {
    const key = activeFilter === PLAY_HUB_FILTERS.UNLOCKED
      ? 'modals.play.filters.emptyUnlocked'
      : 'modals.play.filters.emptyGeneric';
    setTextIfChanged(emptyText, t(key));
  }
}

function syncArcadeSubheadsVisibility(groupVisibleCounts) {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
    return;
  }
  for (const subhead of document.querySelectorAll('[data-arcade-group]')) {
    const group = subhead.dataset?.arcadeGroup;
    if (group && Object.hasOwn(groupVisibleCounts, group)) {
      subhead.classList.toggle(HIDDEN_CLASS, groupVisibleCounts[group] === 0);
    }
  }
}

function applyArcadeGroupFilter(els, modes, activeFilter, mastery, access) {
  let groupVisible = 0;
  for (const mode of modes) {
    const spec = ARCADE_CARD_SPECS[mode];
    if (!spec) {
      continue;
    }
    const wrapper = getArcadeCardWrapper(els?.[spec.card]);
    const unlocked = access ? isModeUnlocked(access, mode) : true;
    const isMatch = matchesArcadeFilter(mode, activeFilter, mastery[mode], unlocked);
    wrapper?.classList?.toggle(HIDDEN_CLASS, !isMatch);
    if (isMatch) {
      groupVisible += 1;
    }
  }
  return groupVisible;
}

function applyPlayHubArcadeFilter(els, filter, mastery, access) {
  const activeFilter = Object.values(PLAY_HUB_FILTERS).includes(filter) ? filter : PLAY_HUB_FILTERS.ALL;
  const groupVisibleCounts = {
    core: applyArcadeGroupFilter(els, ARCADE_GROUPS.core, activeFilter, mastery, access),
    labs: applyArcadeGroupFilter(els, ARCADE_GROUPS.labs, activeFilter, mastery, access)
  };
  const visibleCount = groupVisibleCounts.core + groupVisibleCounts.labs;
  syncArcadeSubheadsVisibility(groupVisibleCounts);
  const filterBar = typeof document !== 'undefined' ? document.getElementById?.('play-hub-filters') : null;
  for (const chip of filterBar?.querySelectorAll?.('[data-arcade-filter]') ?? []) {
    setAttributeIfChanged(chip, 'aria-pressed', String(chip.dataset.arcadeFilter === activeFilter));
  }
  syncPlayHubFilterEmptyState(visibleCount, activeFilter);
}

function refreshSmartPickButton(storage, gameConfig) {
  const btn = typeof document !== 'undefined' ? document.getElementById?.('btn-play-next-unmastered') : null;
  if (!btn) {
    return;
  }
  const nextMode = resolveNextUnmasteredArcadeMode(storage, gameConfig);
  if (!nextMode || !ARCADE_CARD_SPECS[nextMode]) {
    btn.classList.add(HIDDEN_CLASS);
    delete btn.dataset.targetMode;
    return;
  }
  btn.dataset.targetMode = nextMode;
  setTextIfChanged(btn, t('modals.play.smartPick.nextUnmastered', { mode: t(ARCADE_CARD_SPECS[nextMode].titleKey) }));
  btn.classList.remove(HIDDEN_CLASS);
}

export { resolveDailyPuzzleStage };

export function summarizeGrandMastery(mastery) {
  const entries = Object.values(mastery || {});
  const total = entries.length;
  const mastered = entries.filter((entry) => entry?.mastered).length;
  return { mastered, total, isGrandMaster: total > 0 && mastered === total };
}

function refreshGrandMasteryBadge(mastery, starSymbol) {
  const badge = typeof document !== 'undefined' ? document.getElementById?.('play-hub-mastery-summary') : null;
  if (!badge) {
    return;
  }
  const { mastered, total, isGrandMaster } = summarizeGrandMastery(mastery);
  badge.classList.toggle('is-grand-master', isGrandMaster);
  const key = isGrandMaster ? 'modals.play.mastery.grandMaster' : 'modals.play.mastery.summary';
  setTextIfChanged(badge, t(key, { mastered: formatNumber(mastered), total: formatNumber(total), star: starSymbol }));
}

function refreshDailyPuzzleChip(storage, gameConfig) {
  const dailyPuzzleEl = typeof document !== 'undefined' ? document.getElementById?.('daily-puzzle-stage-label') : null;
  if (!dailyPuzzleEl) {
    return;
  }
  const todayKey = SeededRandom.getTodayDateKey();
  const stage = resolveDailyPuzzleStage(todayKey, gameConfig?.puzzles?.length || 1);
  const claimed = storage?.hasClaimedDailyPuzzle?.(todayKey) === true;
  const bonus = gameConfig?.dailyPuzzle?.firstClearBonusCoins || 0;
  const key = claimed ? 'modals.play.dailyPuzzle.stageDone' : 'modals.play.dailyPuzzle.stageBonus';
  setTextIfChanged(dailyPuzzleEl, t(key, { stage: formatNumber(stage), coins: formatNumber(bonus) }));
}

function findNextLockedModeHint(storage, gameConfig) {
  const unlocks = gameConfig?.modeUnlocks?.campaignLevelCleared;
  if (!unlocks || !storage) {
    return null;
  }
  const cleared = Math.max(0, (storage.getUnlockedLevel?.() || 1) - 1);
  let closest = null;
  for (const [mode, reqLevel] of Object.entries(unlocks)) {
    if (Number.isFinite(reqLevel) && cleared < reqLevel && (!closest || reqLevel < closest.reqLevel)) {
      closest = { mode, reqLevel, remaining: reqLevel - cleared };
    }
  }
  return closest;
}

function resolveWeeklySpotlight(storage) {
  const pending = storage.getWeeklyMasteryState?.()?.bounties?.find?.((b) => !b.completed);
  if (!pending) {
    return null;
  }
  return {
    kind: 'weeklyMastery',
    key: 'modals.play.spotlight.weeklyMastery',
    params: {
      name: t(`bounties.items.${pending.id}`, { target: formatNumber(pending.target) }),
      progress: formatNumber(pending.progress || 0),
      target: formatNumber(pending.target)
    }
  };
}

function resolveCampaignOrModeSpotlight(storage, gameConfig) {
  const nextLock = findNextLockedModeHint(storage, gameConfig);
  if (nextLock && nextLock.remaining <= 2) {
    return {
      kind: 'campaign',
      key: 'modals.play.spotlight.campaignUnlock',
      params: { level: formatNumber(nextLock.reqLevel) }
    };
  }
  const nextMode = resolveNextUnmasteredArcadeMode(storage, gameConfig);
  if (nextMode && ARCADE_CARD_SPECS[nextMode]) {
    return {
      kind: 'mode',
      targetMode: nextMode,
      key: 'modals.play.spotlight.nextMastery',
      params: { mode: t(ARCADE_CARD_SPECS[nextMode].titleKey) }
    };
  }
  return null;
}

/**
 * Picks the single highest-value next objective to highlight at the top of the Play Hub:
 * 1. Unclaimed Daily Puzzle
 * 2. First unfinished Weekly Mastery Trio objective
 * 3. Campaign unlock proximity (<= 2 levels away)
 * 4. Next unmastered arcade mode
 * @param {object} storage - StorageManager.
 * @param {object} gameConfig - Game config.
 * @returns {{kind: string, key: string, params: object, targetMode?: string}|null}
 */
export function resolvePlayHubSpotlight(storage, gameConfig) {
  if (!storage || !gameConfig) {
    return null;
  }
  const todayKey = SeededRandom.getTodayDateKey();
  if (storage.hasClaimedDailyPuzzle?.(todayKey) !== true) {
    const stage = resolveDailyPuzzleStage(todayKey, gameConfig.puzzles?.length || 1);
    return {
      kind: 'dailyPuzzle',
      key: 'modals.play.spotlight.dailyPuzzle',
      params: { stage: formatNumber(stage), coins: formatNumber(gameConfig.dailyPuzzle?.firstClearBonusCoins || 0) }
    };
  }
  return resolveWeeklySpotlight(storage) || resolveCampaignOrModeSpotlight(storage, gameConfig);
}

const SPOTLIGHT_ARROW_SUFFIX = ' ->';

function refreshPlayHubSpotlight(els, storage, gameConfig) {
  const banner = els?.playHubSpotlight
    || (typeof document !== 'undefined' ? document.getElementById?.('play-hub-spotlight') : null);
  if (!banner) {
    return;
  }
  const spotlight = resolvePlayHubSpotlight(storage, gameConfig);
  if (!spotlight) {
    banner.classList.add(HIDDEN_CLASS);
    delete banner.dataset.spotlightKind;
    delete banner.dataset.spotlightMode;
    return;
  }
  banner.dataset.spotlightKind = spotlight.kind;
  if (spotlight.targetMode) {
    banner.dataset.spotlightMode = spotlight.targetMode;
  } else {
    delete banner.dataset.spotlightMode;
  }
  const rawText = t(spotlight.key, spotlight.params);
  if (rawText.endsWith(SPOTLIGHT_ARROW_SUFFIX) && typeof document !== 'undefined' && typeof banner.replaceChildren === 'function') {
    const labelText = rawText.slice(0, -SPOTLIGHT_ARROW_SUFFIX.length);
    const prevLabel = banner.dataset.spotlightLabel || '';
    if (prevLabel !== labelText) {
      banner.dataset.spotlightLabel = labelText;
      const labelEl = document.createElement('span');
      labelEl.className = 'play-hub-spotlight-label';
      labelEl.textContent = labelText;
      const arrowEl = document.createElement('span');
      arrowEl.className = 'play-hub-spotlight-arrow';
      arrowEl.textContent = SPOTLIGHT_ARROW_SUFFIX;
      banner.replaceChildren(labelEl, arrowEl);
    }
  } else {
    delete banner.dataset.spotlightLabel;
    setTextIfChanged(banner, rawText);
  }
  banner.classList.remove(HIDDEN_CLASS);
}

function refreshContractsToggleSummary(dailyState, weeklyState) {
  const btn = typeof document !== 'undefined' ? document.getElementById?.('btn-contracts-toggle') : null;
  if (!btn) return;
  const dailyItems = dailyState?.items || [];
  const weeklyItems = weeklyState?.items || [];
  const dailyDone = dailyItems.filter((item) => item?.completed).length;
  const weeklyDone = weeklyItems.filter((item) => item?.completed).length;
  setTextIfChanged(btn, t('modals.play.contractsToggle', {
    dailyDone: formatNumber(dailyDone),
    dailyTotal: formatNumber(dailyItems.length),
    weeklyDone: formatNumber(weeklyDone),
    weeklyTotal: formatNumber(weeklyItems.length)
  }));
}

function refreshRecentModesBar(els, storage, gameConfig) {
  const bar = typeof document !== 'undefined' ? document.getElementById?.('play-hub-recent') : null;
  if (!bar) return;
  const recent = (storage?.getRecentModes?.() || [])
    .filter((mode) => ARCADE_CARD_SPECS[mode] && isModeUnlocked(mode, storage, gameConfig));
  bar.replaceChildren();
  bar.classList.toggle(HIDDEN_CLASS, recent.length === 0);
  if (recent.length === 0) return;
  const label = document.createElement('span');
  label.className = 'play-hub-recent-label';
  label.textContent = t('modals.play.recent.label');
  bar.appendChild(label);
  for (const mode of recent) {
    const spec = ARCADE_CARD_SPECS[mode];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'play-hub-recent-chip';
    chip.dataset.recentMode = mode;
    chip.textContent = t(spec.titleKey);
    chip.addEventListener('click', () => els?.[spec.card]?.click());
    bar.appendChild(chip);
  }
}

function refreshPlayHubMastery(els, storage, gameConfig, filter = PLAY_HUB_FILTERS.ALL, access = null) {
  const mastery = resolveModeMasteryProgress(storage, gameConfig);
  const starSymbol = gameConfig?.theme?.starFilledSymbol || '';
  const masteredLabel = t('modals.levelSelect.arcade.masteredBadge');
  for (const [mode, spec] of Object.entries(ARCADE_CARD_SPECS)) {
    if (Object.hasOwn(mastery, mode)) {
      syncMasteredBadge(els[spec.card], mastery[mode].mastered, starSymbol, masteredLabel, mastery[mode]);
    }
  }
  syncMasteredBadge(els.btnDaily, Boolean(mastery[GAME_MODES.DAILY]?.mastered), starSymbol, masteredLabel, mastery[GAME_MODES.DAILY]);
  const campaignMastery = mastery[GAME_MODES.CAMPAIGN];
  syncMasteredBadge(
    els.playCampaignSection,
    Boolean(campaignMastery?.mastered),
    starSymbol,
    masteredLabel,
    campaignMastery ? { ...campaignMastery, showMeter: false } : null
  );
  applyPlayHubArcadeFilter(els, filter, mastery, access);
  refreshSmartPickButton(storage, gameConfig);
  refreshGrandMasteryBadge(mastery, starSymbol);
  refreshDailyPuzzleChip(storage, gameConfig);
  refreshPlayHubSpotlight(els, storage, gameConfig);
  refreshRecentModesBar(els, storage, gameConfig);
}

function resolvePlayHubOpenFocus(els, focusKey, expand, expanded) {
  const fallback = els[focusKey] || els[CONTINUE_KEY] || els.btnClosePlay;
  if (!expanded) {
    return fallback;
  }
  const target = PLAY_HUB_DISCLOSURES[expand];
  const panel = els[target.panel];
  return panel?.querySelector?.('.puzzle-stage-btn.active, input') || els[target.toggle] || fallback;
}

/** Methods installed on UIManager (see installMethods). `this` is the UIManager. */
export const uiPlayHubMethods = {
  /** True while the Play hub dialog is shown. */
  isPlayHubOpen() {
    const modal = this.elements?.modalPlay;
    return Boolean(modal) && !modal.classList.contains(HIDDEN_CLASS);
  },

  /** Daily reward chip text for today: done (with streak) or the first-play bonus. */
  getDailyRewardText() {
    return this.describeDailyRewardChip().text;
  },

  /** Weekly reward chip text for this week: the week's best or the first-play bonus. */
  getWeeklyRewardText() {
    return this.describeWeeklyRewardChip().text;
  },

  describeDailyRewardChip() {
    const todayKey = SeededRandom.getTodayDateKey();
    const storage = this.storageManager;
    return describeDailyReward(
      {
        played: storage?.hasPlayedDailyToday?.(todayKey) === true,
        streak: storage?.getDailyStreak?.(todayKey) || 0,
        bonusCoins: this.gameConfig?.daily?.firstPlayBonusCoins || 0
      },
      t
    );
  },

  describeWeeklyRewardChip() {
    const weekKey = getUtcIsoWeekKey(Date.now());
    const storage = this.storageManager;
    return describeWeeklyReward(
      {
        bestScore: storage?.getWeeklyFluxBest?.(weekKey)?.score || 0,
        bonusCoins: this.gameConfig?.weeklyFlux?.firstPlayBonusCoins || 0,
        claimed: storage?.hasClaimedWeeklyFluxBonus?.(weekKey) === true
      },
      t
    );
  },

  /** Fills the record line of every card and the Daily and Weekly reward chips. */
  refreshPlayHubRecords() {
    const els = this.elements;
    const storage = this.storageManager;
    refreshArcadeRecordLines(els, storage, this.gameConfig);
    writeRewardChip(els.dailyReward, this.describeDailyRewardChip());
    writeRewardChip(els.weeklyReward, this.describeWeeklyRewardChip());
    const dailyBounties = storage.getDailyBountiesState?.();
    renderDailyBounties(els.playBountiesList, dailyBounties);
    const weeklyMastery = storage.getWeeklyMasteryState?.();
    renderDailyBounties(els.playWeeklyMasteryList, weeklyMastery);
    refreshContractsToggleSummary(dailyBounties, weeklyMastery);
    if (els.playWeeklyMasteryTitle) {
      const bonus = this.gameConfig?.bounties?.weeklyChestBonusCoins || 60;
      const titleKey = weeklyMastery?.chestClaimed
        ? 'modals.play.weeklyMastery.titleClaimed'
        : 'modals.play.weeklyMastery.titleBonus';
      setTextIfChanged(els.playWeeklyMasteryTitle, t(titleKey, { coins: formatNumber(bonus) }));
    }
    refreshPlayHubMastery(els, storage, this.gameConfig, this.playHubFilter, this.getModeAccess?.() || null);
  },

  /** What the primary Campaign button does right now (see resolveContinueTarget). */
  getPlayHubContinueTarget() {
    const catalog = this.engine.levelCatalog;
    return resolveContinueTarget({
      suggestedLevelId: this.getSuggestedLevelId(),
      firstLevelId: catalog.firstId,
      lastLevelId: catalog.lastId,
      clearedLevel: this.storageManager.getClearedCampaignLevel?.() ?? 0,
      levelStats: this.storageManager.getLevelStats(),
      maxStars: this.gameConfig.scoring.maxStars || DEFAULT_MAX_STARS,
      campaignRunActive: this.isCampaignRunActive()
    });
  },

  /**
   * Refreshes the Campaign card: chapter line, star meter, active state and the label of the
   * primary button. Returns the target so the click handler and the label never disagree.
   * @returns {{kind: string, levelId: number|null}}
   */
  refreshPlayHubCampaign() {
    const els = this.elements;
    const catalog = this.engine.levelCatalog;
    const maxStars = this.gameConfig.scoring.maxStars || DEFAULT_MAX_STARS;
    const target = this.getPlayHubContinueTarget();
    const suggestedLevelId = this.getSuggestedLevelId();
    const chapter = catalog.listChapters()[catalog.chapterIndexOf(suggestedLevelId)];
    const { stars, maxStars: chapterMax } = sumChapterStars(chapter, this.storageManager.getLevelStats(), maxStars);
    const starParams = { stars: formatNumber(stars), maxStars: formatNumber(chapterMax) };

    setTextIfChanged(
      els.playCampaignSummary,
      t('modals.play.campaign.summary', { chapter: this.formatChapterName(chapter), ...starParams })
    );
    const pct = chapterMax > 0 ? Math.round((stars / chapterMax) * FULL_PERCENT) : 0;
    if (els.playCampaignMeterFill) {
      els.playCampaignMeterFill.style.width = `${pct}%`;
    }
    if (els.playCampaignMeter) {
      setAttributeIfChanged(els.playCampaignMeter, 'aria-valuenow', String(pct));
      setAttributeIfChanged(els.playCampaignMeter, 'aria-valuetext', t('modals.play.campaign.progressAria', starParams));
    }

    let label;
    if (target.kind === CONTINUE_KINDS.MAP) {
      label = t('modals.play.campaign.map');
    } else {
      label = t(
        target.kind === CONTINUE_KINDS.RESUME ? 'modals.levelSelect.button.resume' : 'modals.play.campaign.continue',
        { level: target.levelId }
      );
    }
    setTextIfChanged(els.btnCampaignContinue, label);
    els.btnCampaignContinue?.closest?.('section')?.classList.toggle(ACTIVE_MODE_CLASS, this.isCampaignRunActive());
    return target;
  },

  /**
   * Activates the primary Campaign button: resume the running level, start the target level
   * (after the destructive-action check), or open the campaign map.
   */
  activatePlayHubContinue() {
    const target = this.getPlayHubContinueTarget();
    if (target.kind === CONTINUE_KINDS.MAP) {
      this.openLevelsModal();
      return;
    }
    if (target.kind === CONTINUE_KINDS.RESUME) {
      this.resumePlayHubRun();
      return;
    }
    this.requestDestructiveAction(
      () => {
        this.hideAllModals();
        this.engine.startCampaignLevel(target.levelId);
      },
      () => t('modals.play.campaign.continue', { level: target.levelId })
    );
  },

  /** Closes the hub and lets the held run go on (mirror of the campaign map resume branch). */
  resumePlayHubRun() {
    if (!this.autoPausedByOverlay && this.engine.state === GAME_STATES.PAUSED) {
      this.engine.togglePause();
    }
    this.closeOverlayModal(this.elements.modalPlay);
  },

  /**
   * A18: activating the card of the mode that is running resumes it instead of restarting it.
   * @param {string} modeKey - Game mode id, or WEEKLY_ACCESS_KEY for the Weekly card.
   * @returns {boolean} True when the run was resumed (the caller starts nothing).
   */
  resumePlayHubModeIfRunning(modeKey) {
    if (!isModeRunning(this.engine, modeKey, getUtcIsoWeekKey(Date.now()))) {
      return false;
    }
    this.resumePlayHubRun();
    return true;
  },

  /** The control the hub focuses on opening (see resolveInitialFocusKey). */
  getPlayHubInitialFocus() {
    const els = this.elements;
    const key = resolveInitialFocusKey({
      engine: this.engine,
      access: this.getModeAccess(),
      weekKey: getUtcIsoWeekKey(Date.now())
    });
    return els[key] || els[CONTINUE_KEY] || els.btnClosePlay;
  },

  /**
   * Opens or closes one disclosure; at most one is open at a time. A panel whose toggle is
   * hidden (a locked mode) never opens.
   * @param {'puzzle'|'seed'} name - Disclosure name.
   * @param {boolean} [force] - True opens, false closes, nothing toggles.
   * @returns {boolean} Whether the disclosure is open afterwards.
   */
  togglePlayHubDisclosure(name, force) {
    const target = PLAY_HUB_DISCLOSURES[name];
    if (!target) {
      return false;
    }
    const targetToggle = this.elements[target.toggle];
    const targetPanel = this.elements[target.panel];
    const wasOpen = Boolean(targetPanel) && !targetPanel.classList.contains(HIDDEN_CLASS);
    let open = force === undefined ? !wasOpen : Boolean(force);
    if (open && targetToggle?.classList.contains(HIDDEN_CLASS)) {
      open = false;
    }
    for (const [otherName, other] of Object.entries(PLAY_HUB_DISCLOSURES)) {
      const isTarget = otherName === name;
      const panel = this.elements[other.panel];
      const toggle = this.elements[other.toggle];
      const isOpen = isTarget && open;
      panel?.classList.toggle(HIDDEN_CLASS, !isOpen);
      toggle?.setAttribute('aria-expanded', String(isOpen));
    }
    if (name !== 'seed' || !open) {
      syncFluxSeedValidationError(this.elements);
    }
    return open;
  },

  /** Closes both disclosures. */
  collapsePlayHubDisclosures() {
    for (const name of Object.keys(PLAY_HUB_DISCLOSURES)) {
      this.togglePlayHubDisclosure(name, false);
    }
    syncFluxSeedValidationError(this.elements);
  },

  /**
   * Shows the two-player entry only when two boards fit and the duel is unlocked; otherwise
   * the hint says why. A lobby left open while the window shrinks closes with its entry.
   */
  syncPlayHubVersusLocal() {
    const fits = this.canHostVersusLocal();
    const unlocked = isModeUnlocked(this.getModeAccess(), GAME_MODES.VERSUS);
    const { showButton, showHint } = resolveVersusLocalEntry({ fits, unlocked });
    this.elements.btnVersusLocalHub?.classList.toggle(HIDDEN_CLASS, !showButton);
    this.elements.versusLocalHubHint?.classList.toggle(HIDDEN_CLASS, !showHint);
    if (!fits && this.isVersusLocalLobbyOpen?.()) {
      this.closeVersusLocalLobby();
    }
  },

  /**
   * Opens the duel tier picker under the two-player lobby, as the hub's 2P button does. The
   * picker returns focus to the hub button (A20); Back unwinds lobby, picker, hub.
   */
  openPlayHubVersusLocal() {
    this.runIfModeUnlocked(GAME_MODES.VERSUS, () => {
      this.versusTierOpener = this.elements.btnVersusLocalHub;
      this.openVersusTierPicker();
      this.openVersusLocalLobby();
    });
  },

  /** The Play hub tabs in display order, each with its tab button and panel. */
  getPlayHubTabs() {
    const els = this.elements || {};
    return [
      { name: PLAY_HUB_TABS.FEATURED, el: els.tabPlayFeatured, pane: els.playPaneFeatured },
      { name: PLAY_HUB_TABS.ARCADE, el: els.tabPlayArcade, pane: els.playPaneArcade },
      { name: PLAY_HUB_TABS.DUEL, el: els.tabPlayDuel, pane: els.playPaneDuel }
    ].filter((tab) => tab.el && tab.pane);
  },

  /** Switches the active Play hub tab and resets scroll to the top of the card. */
  switchPlayHubTab(tabName) {
    const tabs = this.getPlayHubTabs();
    const resolved = tabs.some((tab) => tab.name === tabName) ? tabName : PLAY_HUB_TABS.FEATURED;
    this.activePlayHubTab = resolved;
    for (const { name, el, pane } of tabs) {
      const isActive = name === resolved;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', String(isActive));
      el.tabIndex = isActive ? 0 : -1;
      pane.classList.toggle(HIDDEN_CLASS, !isActive);
    }
    const card = this.elements?.modalPlay?.querySelector?.('.modal-card');
    if (card && typeof card.scrollTop === 'number') {
      card.scrollTop = 0;
    }
  },

  /**
   * Opens the Play hub over the run.
   * @param {{expand?: 'puzzle'|'seed'}} [options] - A disclosure to open at once.
   */
  openPlayHub({ expand } = {}) {
    const els = this.elements;
    els.playHubHint?.classList.add(HIDDEN_CLASS);
    const access = this.getModeAccess();
    const focusKey = resolveInitialFocusKey({
      engine: this.engine,
      access,
      weekKey: getUtcIsoWeekKey(Date.now())
    });
    const initialTabFromFocus = resolvePlayHubTabForFocusKey(focusKey);
    const expectsArcade = Boolean(expand && PLAY_HUB_DISCLOSURES[expand]) || initialTabFromFocus === PLAY_HUB_TABS.ARCADE;
    if (expectsArcade && this.playHubFilter && this.playHubFilter !== PLAY_HUB_FILTERS.ALL) {
      this.playHubFilter = PLAY_HUB_FILTERS.ALL;
    }
    this.refreshPlayHubRecords();
    this.refreshVersusCard();
    this.renderPuzzleStagesStrip();
    this.refreshModeLocks(access);
    this.refreshPlayHubCampaign();
    this.collapsePlayHubDisclosures();
    const expanded = expand ? this.togglePlayHubDisclosure(expand, true) : false;
    this.syncPlayHubVersusLocal();
    this.switchPlayHubTab?.(expanded ? PLAY_HUB_TABS.ARCADE : initialTabFromFocus);
    const focusTarget = resolvePlayHubOpenFocus(els, focusKey, expand, expanded);
    this.openOverlayModal(els.modalPlay, focusTarget);
  }
};
