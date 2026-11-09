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
import { getUtcIsoWeekKey } from '../game/WeeklyFlux.js';
import {
  MODE_BUTTON_KEYS,
  WEEKLY_ACCESS_KEY,
  isCurrentWeeklyRun,
  isModeUnlocked,
  setAttributeIfChanged,
  setTextIfChanged
} from './UIHelpers.js';
import { FULL_PERCENT } from './WorkshopView.js';

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
  return MODE_BUTTON_KEYS[modeKey]?.[0] ?? null;
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
    const totalPuzzles = Math.max(1, this.gameConfig?.puzzles?.length || 1);
    const bestPuzzleStage = Math.min(totalPuzzles, Math.max(DEFAULT_STAGE, storage.getPuzzleBestStage?.() || 1));
    const maxPuzzleStars = this.gameConfig?.scoring?.maxStars || 0;
    setTextIfChanged(
      els.arcadeBestEndless,
      t('modals.levelSelect.card.bestScore', { score: formatNumber(storage.getEndlessHighScore?.() || 0) })
    );
    setTextIfChanged(
      els.arcadeBestClassic,
      t('modals.levelSelect.arcade.classicBest', {
        stage: formatNumber(Math.max(DEFAULT_STAGE, storage.getClassicBestStage?.() || 1))
      })
    );
    setTextIfChanged(
      els.arcadeBestPuzzle,
      t('modals.levelSelect.arcade.puzzleRecord', {
        stage: formatNumber(bestPuzzleStage),
        total: formatNumber(totalPuzzles),
        stars: formatNumber(storage.getPuzzleTotalStars?.() || 0),
        maxStars: formatNumber(totalPuzzles * maxPuzzleStars)
      })
    );
    setTextIfChanged(
      els.arcadeBestBlitz,
      t('modals.levelSelect.card.bestScore', { score: formatNumber(storage.getBlitzHighScore?.() || 0) })
    );
    setTextIfChanged(
      els.arcadeBestFlux,
      t('modals.play.arcade.fluxRecord', {
        stage: formatNumber(Math.max(DEFAULT_STAGE, storage.getFluxBestStage?.() || 1)),
        score: formatNumber(storage.getFluxHighScore?.() || 0)
      })
    );
    setTextIfChanged(
      els.arcadeBestCascade,
      t('modals.levelSelect.card.bestScore', { score: formatNumber(storage.getCascadeHighScore?.() || 0) })
    );
    setTextIfChanged(
      els.arcadeBestBossRush,
      t('modals.levelSelect.arcade.bossRushRecord', {
        wave: formatNumber(Math.max(DEFAULT_STAGE, storage.getBossRushBestWave?.() || 1)),
        score: formatNumber(storage.getBossRushHighScore?.() || 0)
      })
    );
    writeRewardChip(els.dailyReward, this.describeDailyRewardChip());
    writeRewardChip(els.weeklyReward, this.describeWeeklyRewardChip());
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
    return open;
  },

  /** Closes both disclosures. */
  collapsePlayHubDisclosures() {
    for (const name of Object.keys(PLAY_HUB_DISCLOSURES)) {
      this.togglePlayHubDisclosure(name, false);
    }
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

  /**
   * Opens the Play hub over the run.
   * @param {{expand?: 'puzzle'|'seed'}} [options] - A disclosure to open at once.
   */
  openPlayHub({ expand } = {}) {
    const els = this.elements;
    els.playHubHint?.classList.add(HIDDEN_CLASS);
    this.refreshPlayHubRecords();
    this.refreshVersusCard();
    this.renderPuzzleStagesStrip();
    this.refreshModeLocks(this.getModeAccess());
    this.refreshPlayHubCampaign();
    this.collapsePlayHubDisclosures();
    const expanded = expand ? this.togglePlayHubDisclosure(expand, true) : false;
    this.syncPlayHubVersusLocal();
    let focusTarget = this.getPlayHubInitialFocus();
    if (expanded) {
      const target = PLAY_HUB_DISCLOSURES[expand];
      const panel = els[target.panel];
      focusTarget =
        panel?.querySelector?.('.puzzle-stage-btn.active, input') || els[target.toggle] || focusTarget;
    }
    this.openOverlayModal(els.modalPlay, focusTarget);
  }
};
