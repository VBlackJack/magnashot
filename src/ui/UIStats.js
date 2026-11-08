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

import { GAME_MODES } from '../core/Constants.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { CURRENT_SAVE_SCHEMA_VERSION } from '../core/StorageManager.js';
import { i18n, t, formatNumber } from '../core/I18n.js';
import { getDailyChallengeNumber } from '../game/DailyShare.js';
import {
  buildPlayerStatsText,
  pickHardestLevels,
  pickMostLeftLevels,
  splitPlayTime
} from '../game/PlayerStats.js';
import { MODE_NAME_KEYS, plainModeName, revealLiveRegion, scheduleNextFrame, setTextIfChanged } from './UIHelpers.js';

/** The two tabs of the stats window. */
export const STATS_TABS = Object.freeze({ OVERVIEW: 'overview', DAILY: 'daily' });

/** Mode names the stats list shows for the modes the Workshop-style name table leaves out. */
const STATS_EXTRA_MODE_NAME_KEYS = Object.freeze({
  [GAME_MODES.CAMPAIGN]: 'app.nav.button.levels',
  [GAME_MODES.DAILY]: 'app.nav.button.daily'
});

/** Record kinds of PlayerStats.buildPlayerStatsText: a best shown with its shape number or its wave. */
const RECORD_KIND_STAGE = 'stage';
const RECORD_KIND_WAVE = 'wave';
const RECORD_KIND_CLASSIC_STAGE = 'classicStage';

const MS_PER_DAY = 86_400_000;
const UTC_TIME_ZONE = 'UTC';
const DATE_STYLE = 'medium';

/**
 * Formats a UTC date key ("YYYY-MM-DD") or an epoch time in the player's language, in UTC.
 * @param {string|number} value - Date key or epoch milliseconds.
 * @param {string} locale - BCP 47 language tag.
 * @returns {string}
 */
export function formatStatsDate(value, locale) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) {
    return '';
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: DATE_STYLE, timeZone: UTC_TIME_ZONE }).format(new Date(ms));
}

/**
 * The "Best ..." wording of one mode record, empty when nothing was scored yet.
 * @param {{score?: number, kind?: string, stage?: number, wave?: number}|undefined} record - Best result.
 * @param {(key: string, params?: object) => string} translate - Translation function.
 * @param {(n: number) => string} format - Number formatter.
 * @returns {string}
 */
export function formatModeBest(record, translate, format) {
  const score = Number(record?.score) || 0;
  if (score <= 0) {
    return '';
  }
  if (record.kind === RECORD_KIND_STAGE && record.stage > 0) {
    return translate('modals.stats.overview.bestStage', { score: format(score), stage: format(record.stage) });
  }
  if (record.kind === RECORD_KIND_CLASSIC_STAGE && record.stage > 0) {
    return translate('modals.stats.overview.bestClassicStage', { score: format(score), stage: format(record.stage) });
  }
  if (record.kind === RECORD_KIND_WAVE && record.wave > 0) {
    return translate('modals.stats.overview.bestWave', { score: format(score), wave: format(record.wave) });
  }
  return translate('modals.stats.overview.bestScore', { score: format(score) });
}

/**
 * Display model of the Overview tab.
 * @param {object} stats - Local statistics (storage getPlayerStats()).
 * @param {object} records - Bests from storage: {campaign: {level, stars}, modes: {[mode]: record}}.
 * @param {{translate: Function, format: Function, modeOrder: string[], locale: string}} context - Display context.
 * @returns {{isEmpty: boolean, since: string, general: Array<{label: string, value: string}>,
 *   modes: Array<{mode: string, name: string, runs: string, best: string}>, notes: string[]}}
 */
export function buildStatsOverview(stats, records, context) {
  const { translate, format, modeOrder, locale } = context;
  const modeStats = stats?.modes ?? {};
  const modes = [];
  for (const mode of modeOrder) {
    const entry = modeStats[mode];
    const runs = Number(entry?.runs) || 0;
    const best = formatModeBest(records?.modes?.[mode], translate, format);
    if (runs <= 0 && !best) {
      continue;
    }
    const nameKey = STATS_EXTRA_MODE_NAME_KEYS[mode] ?? MODE_NAME_KEYS[mode];
    modes.push({
      mode,
      name: nameKey ? plainModeName(translate(nameKey)) : mode,
      runs:
        runs > 0
          ? translate('modals.stats.overview.modeRuns', {
              runs: format(runs),
              wins: format(entry.wins),
              quits: format(entry.quits)
            })
          : '',
      best
    });
  }
  const { hours, minutes } = splitPlayTime(stats?.playMs);
  const shots = Number(stats?.shots) || 0;
  const general = [];
  if (shots > 0 || (Number(stats?.playMs) || 0) > 0) {
    general.push({
      label: translate('modals.stats.overview.playTime'),
      value: translate('modals.stats.overview.playTimeValue', { hours: format(hours), minutes: format(minutes) })
    });
    general.push({ label: translate('modals.stats.overview.shots'), value: format(shots) });
  }
  const notes = [];
  const campaign = records?.campaign;
  if (campaign?.level > 0) {
    notes.push(
      translate('modals.stats.overview.campaignReach', { level: format(campaign.level), stars: format(campaign.stars) })
    );
  }
  const [hardest] = pickHardestLevels(stats, 1);
  if (hardest && hardest.fails > 0) {
    notes.push(
      translate('modals.stats.overview.hardestLevel', { level: hardest.levelId, fails: format(hardest.fails) })
    );
  }
  const [mostLeft] = pickMostLeftLevels(stats, 1);
  if (mostLeft && mostLeft.quits > 0) {
    notes.push(
      translate('modals.stats.overview.mostLeftLevel', { level: mostLeft.levelId, quits: format(mostLeft.quits) })
    );
  }
  const since = Number(stats?.since) > 0
    ? translate('modals.stats.overview.since', { date: formatStatsDate(stats.since, locale) })
    : '';
  return { isEmpty: general.length === 0 && modes.length === 0 && notes.length === 0, since, general, modes, notes };
}

/**
 * One text row per Daily history entry, newest first.
 * @param {Array<{d: string, s: number, w: number|null, m: string|null, k: number|null, g: boolean}>} history - Entries.
 * @param {{translate: Function, format: Function, locale: string, epochDateKey: string}} context - Display context.
 * @returns {Array<{date: string, challenge: string, mutator: string, score: string, wave: string, streak: string}>}
 */
export function buildDailyHistoryRows(history, context) {
  const { translate, format, locale, epochDateKey } = context;
  const unknown = translate('modals.stats.daily.unknown');
  return (Array.isArray(history) ? history : []).map((entry) => {
    let streak = unknown;
    if (entry.k !== null && entry.k !== undefined) {
      streak = translate(entry.g ? 'modals.stats.daily.graceUsed' : 'modals.stats.daily.streakValue', {
        streak: format(entry.k)
      });
    }
    return {
      date: formatStatsDate(entry.d, locale),
      challenge: format(getDailyChallengeNumber(entry.d, epochDateKey)),
      mutator: entry.m ? translate(`gameplay.mutators.${entry.m}`) : unknown,
      score: format(entry.s),
      wave: entry.w === null || entry.w === undefined ? unknown : format(entry.w),
      streak
    };
  });
}

/**
 * Days played and best day inside the window of the last `days` days.
 * @param {Array<{d: string, s: number}>} history - Entries.
 * @param {string} todayKey - UTC date key of today.
 * @param {number} days - Window length in days.
 * @returns {{played: number, days: number, bestScore: number, bestDate: string}|null} Null when empty.
 */
export function buildDailyHistorySummary(history, todayKey, days) {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }
  const todayMs = Date.parse(todayKey);
  const inWindow = history.filter((entry) => {
    const age = Math.round((todayMs - Date.parse(entry.d)) / MS_PER_DAY);
    return age >= 0 && age < days;
  });
  const best = history.reduce((top, entry) => (entry.s > top.s ? entry : top), history[0]);
  return { played: inWindow.length, days, bestScore: best.s, bestDate: best.d };
}

/** Methods installed on UIManager.prototype by UIManager.js. */
export const uiStatsMethods = {
  /** The stats tabs in display order, each with its tab button and panel. */
  getStatsTabs() {
    return [
      { name: STATS_TABS.OVERVIEW, el: this.elements.tabStatsOverview, pane: this.elements.statsOverviewPane },
      { name: STATS_TABS.DAILY, el: this.elements.tabStatsDaily, pane: this.elements.statsDailyPane }
    ].filter((tab) => tab.el && tab.pane);
  },

  bindStatsEvents() {
    const tabs = this.getStatsTabs();
    tabs.forEach(({ name, el }, index) => {
      el.addEventListener('click', () => {
        this.switchStatsTab(name);
      });
      el.addEventListener('keydown', (e) => {
        let nextIndex = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          nextIndex = (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        } else if (e.key === 'Home') {
          nextIndex = 0;
        } else if (e.key === 'End') {
          nextIndex = tabs.length - 1;
        }
        if (nextIndex !== null) {
          e.preventDefault();
          this.switchStatsTab(tabs[nextIndex].name);
          tabs[nextIndex].el.focus();
        }
      });
    });
    this.elements.btnCopyStats?.addEventListener('click', () => {
      this.copyPlayerStats();
    });
    this.elements.btnCloseStats?.addEventListener('click', () => {
      this.closeOverlayModal(this.elements.modalStats);
    });
  },

  /**
   * Opens the stats window over the run, which it pauses like the other menu windows.
   * @param {string} [tabName] - Tab to show.
   */
  openStatsModal(tabName = STATS_TABS.OVERVIEW) {
    if (!this.elements.modalStats) {
      return;
    }
    // Over the Daily game over, focus returns to the History button when the window closes.
    this.statsOpener = this.isAnyModalOpen() ? document.activeElement : null;
    this.statsCopied = false;
    this.elements.statsCopyFeedback?.classList.add('hidden');
    this.elements.statsCopyFallback?.classList.add('hidden');
    this.renderStatsOverview();
    this.renderDailyHistory();
    this.updateCopyStatsButtonLabel();
    this.switchStatsTab(tabName);
    const activeTab = this.getStatsTabs().find((tab) => tab.name === this.activeStatsTab);
    this.openOverlayModal(this.elements.modalStats, activeTab?.el ?? this.elements.btnCloseStats);
  },

  switchStatsTab(tabName) {
    const tabs = this.getStatsTabs();
    this.activeStatsTab = tabs.some((tab) => tab.name === tabName) ? tabName : STATS_TABS.OVERVIEW;
    for (const { name, el, pane } of tabs) {
      const isActive = name === this.activeStatsTab;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', String(isActive));
      el.tabIndex = isActive ? 0 : -1;
      pane.classList.toggle('hidden', !isActive);
    }
  },

  /** Re-renders the open stats window (a language switch rewrites every text in it). */
  refreshStatsIfOpen() {
    const modal = this.elements.modalStats;
    if (!modal || modal.classList.contains('hidden')) {
      return;
    }
    this.renderStatsOverview();
    this.renderDailyHistory();
    this.updateCopyStatsButtonLabel();
  },

  updateCopyStatsButtonLabel() {
    setTextIfChanged(
      this.elements.btnCopyStats,
      t(this.statsCopied ? 'modals.stats.button.copied' : 'modals.stats.button.copy')
    );
  },

  /** Best results of every mode, read through the storage manager. */
  buildStatsRecords() {
    const storage = this.storageManager;
    const unlockedLevel = storage.getUnlockedLevel?.() ?? 0;
    const totalStars = storage.getTotalStars?.() ?? 0;
    const hasCampaignProgress = unlockedLevel > 1 || totalStars > 0;
    const dailyBest = (storage.getDailyHistory?.() ?? []).reduce((top, entry) => Math.max(top, entry.s), 0);
    return {
      campaign: { level: hasCampaignProgress ? unlockedLevel : 0, stars: totalStars },
      modes: {
        [GAME_MODES.ENDLESS]: { score: storage.getEndlessHighScore?.() ?? 0 },
        [GAME_MODES.DAILY]: { score: dailyBest },
        [GAME_MODES.CLASSIC]: {
          score: storage.getClassicHighScore?.() ?? 0,
          kind: RECORD_KIND_CLASSIC_STAGE,
          stage: storage.getClassicBestStage?.() ?? 0
        },
        [GAME_MODES.PUZZLE]: {
          score: storage.getPuzzleHighScore?.() ?? 0,
          kind: RECORD_KIND_STAGE,
          stage: storage.getPuzzleBestStage?.() ?? 0
        },
        [GAME_MODES.BLITZ]: { score: storage.getBlitzHighScore?.() ?? 0 },
        [GAME_MODES.FLUX]: {
          score: storage.getFluxHighScore?.() ?? 0,
          kind: RECORD_KIND_STAGE,
          stage: storage.getFluxBestStage?.() ?? 0
        },
        [GAME_MODES.CASCADE]: { score: storage.getCascadeHighScore?.() ?? 0 },
        [GAME_MODES.BOSS_RUSH]: {
          score: storage.getBossRushHighScore?.() ?? 0,
          kind: RECORD_KIND_WAVE,
          wave: storage.getBossRushBestWave?.() ?? 0
        }
      }
    };
  },

  /** Order in which the modes are listed: the configured unlock order. */
  getStatsModeOrder() {
    return this.gameConfig.modeUnlocks?.order ?? [];
  },

  renderStatsOverview() {
    const els = this.elements;
    const overview = buildStatsOverview(this.storageManager.getPlayerStats?.() ?? {}, this.buildStatsRecords(), {
      translate: t,
      format: formatNumber,
      modeOrder: this.getStatsModeOrder(),
      locale: i18n.getLocale()
    });
    if (els.statsSince) {
      setTextIfChanged(els.statsSince, overview.since);
      els.statsSince.classList.toggle('hidden', !overview.since);
    }
    els.statsOverviewEmpty?.classList.toggle('hidden', !overview.isEmpty);
    if (els.statsOverviewList) {
      const rows = [];
      for (const { label, value } of overview.general) {
        rows.push(this.createStatsTerm(label), this.createStatsDetail(value));
      }
      for (const { name, runs, best } of overview.modes) {
        rows.push(this.createStatsTerm(name));
        for (const text of [runs, best]) {
          if (text) {
            rows.push(this.createStatsDetail(text));
          }
        }
      }
      els.statsOverviewList.replaceChildren(...rows);
      els.statsOverviewList.classList.toggle('hidden', rows.length === 0);
    }
    if (els.statsCampaignList) {
      els.statsCampaignList.replaceChildren(
        ...overview.notes.map((text) => {
          const item = document.createElement('li');
          item.textContent = text;
          return item;
        })
      );
      els.statsCampaignList.classList.toggle('hidden', overview.notes.length === 0);
    }
  },

  createStatsTerm(text) {
    const term = document.createElement('dt');
    term.textContent = text;
    return term;
  },

  createStatsDetail(text) {
    const detail = document.createElement('dd');
    detail.textContent = text;
    return detail;
  },

  renderDailyHistory() {
    const els = this.elements;
    const history = this.storageManager.getDailyHistory?.() ?? [];
    const windowDays = this.gameConfig.dailyHistory?.maxEntries ?? history.length;
    const locale = i18n.getLocale();
    setTextIfChanged(els.statsDailyCaption, t('modals.stats.daily.caption', { count: formatNumber(windowDays) }));
    const rows = buildDailyHistoryRows(history, {
      translate: t,
      format: formatNumber,
      locale,
      epochDateKey: this.gameConfig.share?.epochDateKey
    });
    els.statsDailyEmpty?.classList.toggle('hidden', rows.length > 0);
    els.statsDailyWrap?.classList.toggle('hidden', rows.length === 0);
    const summary = buildDailyHistorySummary(history, SeededRandom.getTodayDateKey(), windowDays);
    if (els.statsDailySummary) {
      setTextIfChanged(
        els.statsDailySummary,
        summary
          ? t('modals.stats.daily.summary', {
              played: formatNumber(summary.played),
              days: formatNumber(summary.days),
              score: formatNumber(summary.bestScore),
              date: formatStatsDate(summary.bestDate, locale)
            })
          : ''
      );
      els.statsDailySummary.classList.toggle('hidden', !summary);
    }
    if (els.statsDailyBody) {
      els.statsDailyBody.replaceChildren(
        ...rows.map((row) => {
          const tr = document.createElement('tr');
          // Narrow screens turn the table into blocks (see styles/main.css), which drops the
          // native table semantics: explicit roles keep them.
          tr.setAttribute('role', 'row');
          const cells = [row.date, row.challenge, row.mutator, row.score, row.wave, row.streak];
          const columnKeys = ['date', 'challenge', 'mutator', 'score', 'wave', 'streak'];
          cells.forEach((text, index) => {
            const cell = document.createElement(index === 0 ? 'th' : 'td');
            if (index === 0) {
              cell.scope = 'row';
            }
            cell.setAttribute('role', index === 0 ? 'rowheader' : 'cell');
            cell.textContent = text;
            // Below the narrow breakpoint each cell prints its column name (see styles/main.css).
            cell.dataset.label = t(`modals.stats.daily.col.${columnKeys[index]}`);
            tr.appendChild(cell);
          });
          return tr;
        })
      );
    }
  },

  /** The anonymous plain-text export of the stats, in the player's language. */
  buildStatsText() {
    const modeOrder = this.getStatsModeOrder();
    const modeLabels = {};
    for (const mode of modeOrder) {
      const nameKey = STATS_EXTRA_MODE_NAME_KEYS[mode] ?? MODE_NAME_KEYS[mode];
      modeLabels[mode] = nameKey ? plainModeName(t(nameKey)) : mode;
    }
    const stats = this.storageManager.getPlayerStats?.() ?? {};
    return buildPlayerStatsText(stats, this.buildStatsRecords(), {
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      sinceLabel: Number(stats.since) > 0 ? formatStatsDate(stats.since, i18n.getLocale()) : null,
      modeOrder,
      modeLabels
    }, t);
  },

  /** Copies the stats text; when the clipboard refuses, shows it selected for a manual copy. */
  async copyPlayerStats() {
    const text = this.buildStatsText();
    let feedbackKey = 'modals.stats.feedback.manual';
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        this.statsCopied = true;
        this.updateCopyStatsButtonLabel();
        this.elements.statsCopyFallback?.classList.add('hidden');
        feedbackKey = 'modals.stats.feedback.copied';
      } catch {
        // The clipboard refused (permission, insecure context): the manual fallback below applies.
      }
    }
    const feedback = this.elements.statsCopyFeedback;
    if (feedback) {
      revealLiveRegion({ region: feedback, textElement: feedback, text: t(feedbackKey), schedule: scheduleNextFrame });
    }
    if (feedbackKey === 'modals.stats.feedback.manual') {
      const field = this.elements.statsCopyText;
      if (field && this.elements.statsCopyFallback) {
        field.value = text;
        this.elements.statsCopyFallback.classList.remove('hidden');
        field.focus();
        field.select();
      }
    }
  },
};
