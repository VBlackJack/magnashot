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
import { t, formatNumber, i18n } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { DUEL_STATUS, buildDuelUrl, resolveReplayContentVersion, stripDuelFromUrl } from '../game/GhostCodec.js';
import { FLUX_SEED_QUERY_PARAM, getDailyChallengeNumber, stripFluxSeedFromUrl } from '../game/DailyShare.js';
import {
  REDUCED_MOTION_CLASS,
  plainModeName,
  MODE_NAME_KEYS,
  setAttributeIfChanged,
  setTextIfChanged
} from './UIHelpers.js';

const GHOST_MODE_DAILY = 'daily';
const HIDDEN_CLASS = 'hidden';
const SIDE_AHEAD = 'ahead';
const SIDE_BEHIND = 'behind';
const SIDE_TIED = 'tied';
const BADGE_SIDE_CLASSES = Object.freeze({
  [SIDE_AHEAD]: 'is-ahead',
  [SIDE_BEHIND]: 'is-behind',
  [SIDE_TIED]: ''
});
const LEAD_CHANGE_CLASS = 'is-lead-change';
const LEAD_CHANGE_EVENT = 'animationend';
const STATS_SEPARATOR = ' - ';

/** Error statuses of the duel card: each has a `duel.error.<status>` text. */
const ERROR_STATUSES = Object.freeze([
  DUEL_STATUS.INVALID,
  DUEL_STATUS.EXPIRED,
  DUEL_STATUS.FUTURE,
  DUEL_STATUS.NEWER
]);

/**
 * The line shown for a finished duel (game over window, stats list, announcements).
 * @param {{name: string, outcome: string, gap: number}} duel - Duel summary.
 * @returns {string}
 */
export function formatDuelResultText(duel) {
  const outcome = duel?.outcome;
  if (outcome !== 'won' && outcome !== 'lost' && outcome !== 'tie') {
    return '';
  }
  return t(`modals.gameOver.duel.${outcome}`, { name: duel.name, gap: formatNumber(duel.gap) });
}

/**
 * The rival badge text and its full-sentence label for the HUD.
 * @param {{name: string, comparison: object}} status - Engine getGhostDuelStatus().
 * @returns {{text: string, label: string, side: string}}
 */
export function formatGhostBadge(status) {
  const { name, comparison } = status;
  const gap = formatNumber(comparison.gap);
  let text;
  let label;
  const shot = formatNumber(comparison.shots);
  if (comparison.side === SIDE_AHEAD) {
    text = t('hud.ghost.ahead', { gap, name });
  } else if (comparison.side === SIDE_BEHIND) {
    text = t('hud.ghost.behind', { gap, name });
  } else {
    text = t('hud.ghost.tied', { name });
  }
  if (comparison.side === SIDE_TIED) {
    label = t('hud.ghost.ariaTied', { name, shot });
  } else {
    label = t('hud.ghost.aria', { gap, side: t(`hud.ghost.side.${comparison.side}`), name, shot });
  }
  if (comparison.ghostFinished) {
    text = t('hud.ghost.final', { text });
  }
  return { text, label, side: comparison.side };
}

const DUEL_FILTER_ALL = 'all';

/**
 * Filters recorded Ghost Duels by mode (`'all'`, `'daily'`, or `'flux'`).
 * @param {Array<object>} duels - Stored duel records.
 * @param {string} [filter] - Selected filter key.
 * @returns {Array<object>}
 */
export function filterGhostDuels(duels, filter = DUEL_FILTER_ALL) {
  if (!Array.isArray(duels)) {
    return [];
  }
  if (filter !== GHOST_MODE_DAILY && filter !== GAME_MODES.FLUX) {
    return duels;
  }
  return duels.filter((entry) => entry?.mode === filter);
}

/** Ghost Duel methods installed on UIManager.prototype by UIManager.js. */
export const uiGhostDuelMethods = {
  /** Wires the duel card buttons and the alias field. */
  bindDuelEvents() {
    const els = this.elements;
    els.btnDuelAccept?.addEventListener('click', () => this.acceptDuel());
    els.btnDuelDecline?.addEventListener('click', () => this.dismissDuelCard());
    els.btnDuelOk?.addEventListener('click', () => this.dismissDuelCard());
    // Stored as typed (sanitized); the field shows the stored form once the edit is done.
    els.inputDuelName?.addEventListener('input', () => {
      this.storageManager.setGhostAlias?.(els.inputDuelName.value);
    });
    els.inputDuelName?.addEventListener('change', () => this.syncDuelNameField());
    els.inputDuelName?.addEventListener('blur', () => this.syncDuelNameField());
    const maxLength = this.gameConfig.ghostDuel?.aliasMaxLength;
    if (els.inputDuelName && maxLength > 0) {
      els.inputDuelName.maxLength = maxLength;
    }
  },

  /** Puts the stored alias in the Settings field (never as markup). */
  syncDuelNameField() {
    const field = this.elements.inputDuelName;
    if (field) {
      field.value = this.storageManager.getGhostAlias?.() || '';
    }
  },

  /** @returns {boolean} True while the duel card is open. */
  isDuelCardOpen() {
    const modal = this.elements.modalDuel;
    return Boolean(modal) && !modal.classList.contains(HIDDEN_CLASS);
  },

  /**
   * Opens the duel card for what the page address carried: a playable duel, or the reason it
   * cannot be played. The run underneath is held, like under the menu dialogs.
   * @param {{status: string, ghost: ?object}} read - Result of GhostCodec.readDuelFromSearch.
   * @param {{isRunAtStake?: boolean}} [options] - isRunAtStake: a restored run would be replaced.
   * @returns {boolean} True when the card opened.
   */
  showDuelCard(read, { isRunAtStake = false } = {}) {
    if (!this.elements.modalDuel || !read) {
      return false;
    }
    const isReady = read.status === DUEL_STATUS.VALID && Boolean(read.ghost);
    if (!isReady && !ERROR_STATUSES.includes(read.status)) {
      return false;
    }
    this.duelCardRead = { status: read.status, ghost: isReady ? read.ghost : null };
    this.duelCardAtStake = Boolean(isRunAtStake);
    this.duelCardSignature = null;
    this.renderDuelCard();
    const focusTarget = isReady ? this.elements.btnDuelAccept : this.elements.btnDuelOk;
    this.openOverlayModal(this.elements.modalDuel, focusTarget);
    return true;
  },

  /** Fills the duel card from the stored read; safe to re-run (language change). */
  renderDuelCard() {
    const els = this.elements;
    const read = this.duelCardRead;
    if (!read || !els.modalDuel) {
      return;
    }
    // Everything the card shows depends on these: skip the work while none of them changed.
    const signature = `${i18n.getLocale()}|${SeededRandom.getTodayDateKey()}|${read.status}|${read.ghost ? read.ghost.key : ''}|${read.ghost ? read.ghost.final : ''}|${read.ghost ? read.ghost.alias : ''}`;
    if (signature === this.duelCardSignature) {
      return;
    }
    this.duelCardSignature = signature;
    const ghost = read.ghost;
    const isReady = Boolean(ghost);
    const notes = [];
    if (isReady) {
      const name = ghost.alias || t('duel.defaultName');
      const score = formatNumber(ghost.final);
      if (ghost.mode === GHOST_MODE_DAILY) {
        setTextIfChanged(
          els.duelCardSummary,
          t('duel.card.daily', {
            name,
            score,
            number: formatNumber(getDailyChallengeNumber(ghost.key, this.gameConfig.share.epochDateKey))
          })
        );
        if (ghost.key !== SeededRandom.getTodayDateKey()) {
          notes.push(t('duel.card.rematch'));
        }
      } else {
        setTextIfChanged(els.duelCardSummary, t('duel.card.flux', { name, score, seed: ghost.key }));
      }
      const assists = ghost.assists || {};
      if ((assists.workshop || 0) + (assists.ammo || 0) + (assists.continues || 0) > 0) {
        notes.push(
          t('duel.card.assists', {
            levels: formatNumber(assists.workshop || 0),
            ammo: formatNumber(assists.ammo || 0),
            continues: formatNumber(assists.continues || 0)
          })
        );
      }
      if (assists.tiltFree) {
        notes.push(t('duel.card.tiltFree'));
      }
      // The notice shows when the duel will not replay on the version the link was recorded on.
      const replayVersion = resolveReplayContentVersion(
        this.gameConfig.ghostDuel,
        this.engine.fluxConfig.shapeSettle,
        ghost.mode,
        ghost.cv
      );
      if (ghost.cv !== replayVersion) {
        notes.push(t('duel.card.version'));
      }
    } else {
      setTextIfChanged(els.duelCardSummary, t(`duel.error.${read.status}`));
    }
    if (els.duelCardNotes) {
      els.duelCardNotes.replaceChildren(
        ...notes.map((text) => {
          const item = document.createElement('li');
          item.textContent = text;
          return item;
        })
      );
      els.duelCardNotes.classList.toggle(HIDDEN_CLASS, notes.length === 0);
    }
    els.btnDuelAccept?.classList.toggle(HIDDEN_CLASS, !isReady);
    els.btnDuelDecline?.classList.toggle(HIDDEN_CLASS, !isReady);
    els.btnDuelOk?.classList.toggle(HIDDEN_CLASS, isReady);
  },

  /** Closes the card and drops what it held. */
  closeDuelCard() {
    this.duelCardRead = null;
    this.duelCardSignature = null;
    this.duelCardAtStake = false;
    if (this.elements.modalDuel) {
      this.closeOverlayModal(this.elements.modalDuel);
    }
  },

  /**
   * Removes the duel parameter (and, when asked, the Flux seed) from the address bar.
   * @param {{withFlux?: boolean}} [options]
   */
  stripDuelFromLocation({ withFlux = false } = {}) {
    if (typeof window === 'undefined' || !window.history?.replaceState || !window.location) {
      return;
    }
    let href = stripDuelFromUrl(window.location.href, this.gameConfig.ghostDuel);
    if (withFlux) {
      href = stripFluxSeedFromUrl(href);
    }
    if (href !== window.location.href) {
      window.history.replaceState(null, '', href);
    }
  },

  /** Not now, OK (error variant) and Escape: the normal boot stays, the address is cleaned. */
  dismissDuelCard() {
    const wasReady = Boolean(this.duelCardRead?.ghost);
    this.closeDuelCard();
    this.stripDuelFromLocation({ withFlux: wasReady });
  },

  /** Accept: starts the duel, after the saved-run guard when a restored run would be replaced. */
  acceptDuel() {
    const ghost = this.duelCardRead?.ghost;
    if (!ghost) {
      return;
    }
    const isRunAtStake = this.duelCardAtStake;
    this.closeDuelCard();
    this.stripDuelFromLocation();
    const start = () => {
      this.hideAllModals();
      this.engine.startGhostDuel(ghost);
      // The rival is attached after the run started: show its badge now, not at the first shot.
      this.refresh(this.engine, this.lastExtra);
    };
    if (isRunAtStake) {
      this.requestDestructiveAction(start, () => t('duel.card.accept'), { always: true });
    } else {
      start();
    }
  },

  /**
   * Shows the rival badge during a duel (replacing the best-run marker) and keeps its text
   * and sentence label current.
   * @param {object} engine - The game engine.
   * @returns {boolean} True when the badge is shown, so the caller hides the best-run badge.
   */
  refreshGhostBadge(engine) {
    const badge = this.elements.hudGhost;
    const status = engine.getGhostDuelStatus?.() ?? null;
    const isRunning = engine.state !== GAME_STATES.VICTORY && engine.state !== GAME_STATES.GAME_OVER;
    if (!badge || !status || !isRunning) {
      badge?.classList.add(HIDDEN_CLASS);
      this.ghostLastSide = null;
      return Boolean(status);
    }
    const { text, label, side } = formatGhostBadge(status);
    setTextIfChanged(badge, text);
    setAttributeIfChanged(badge, 'aria-label', label);
    for (const [badgeSide, className] of Object.entries(BADGE_SIDE_CLASSES)) {
      if (className) {
        badge.classList.toggle(className, badgeSide === side);
      }
    }
    const previous = this.ghostLastSide;
    const hasFlipped = (previous === SIDE_AHEAD || previous === SIDE_BEHIND) && side !== previous && side !== SIDE_TIED;
    this.ghostLastSide = side === SIDE_TIED ? previous : side;
    if (hasFlipped && !this.isReducedMotionActive()) {
      badge.classList.remove(LEAD_CHANGE_CLASS);
      // Restart the pulse when two flips follow each other.
      void badge.offsetWidth;
      badge.classList.add(LEAD_CHANGE_CLASS);
      badge.addEventListener(LEAD_CHANGE_EVENT, () => badge.classList.remove(LEAD_CHANGE_CLASS), { once: true });
    }
    badge.classList.remove(HIDDEN_CLASS);
    return true;
  },

  /** @returns {boolean} True when the player or the system asked for less motion. */
  isReducedMotionActive() {
    if (typeof document !== 'undefined' && document.documentElement?.classList?.contains(REDUCED_MOTION_CLASS)) {
      return true;
    }
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  },

  /**
   * Announces a lead change, the end of the rival's run or passing its final score, once.
   * @param {?{kind: string, name: string, gap: number, score: number}} announcement
   */
  announceGhostEvent(announcement) {
    if (!announcement?.kind) {
      return;
    }
    this.announce(
      t(`hud.announcer.ghost.${announcement.kind}`, {
        name: announcement.name,
        gap: formatNumber(announcement.gap),
        score: formatNumber(announcement.score)
      })
    );
  },

  /**
   * The duel line of the game over window, from the engine's settled duel.
   * @param {?object} summary - engine.gameOverSummary.
   * @returns {string} The line shown (empty when there is no duel).
   */
  refreshGameOverDuel(summary) {
    const line = this.elements.gameOverDuel;
    const text = formatDuelResultText(summary?.duel);
    if (line) {
      if (text) {
        setTextIfChanged(line, text);
      }
      line.classList.toggle(HIDDEN_CLASS, !text);
    }
    return text;
  },

  /**
   * Builds the challenge address of the finished run: the game address with the run's own
   * timeline as the duel parameter.
   * @returns {?string} The address, or null when the run cannot be challenged.
   */
  buildChallengeUrl() {
    const engine = this.engine;
    if (engine.mode !== GAME_MODES.DAILY && engine.mode !== GAME_MODES.FLUX) {
      return null;
    }
    const ghost = engine.buildChallengeGhost?.();
    if (!ghost) {
      return null;
    }
    const ctx = { ...engine.buildGhostContext(), fluxParam: FLUX_SEED_QUERY_PARAM };
    return buildDuelUrl(this.gameConfig.share.url, ghost, this.gameConfig.ghostDuel, ctx);
  },

  /** Remembers whether the finished run has a challenge address, which renames the Share button. */
  refreshChallengeUrl() {
    this.challengeUrl = this.buildChallengeUrl();
  },

  /**
   * The duel part of a share: the result header and the challenge address.
   * @returns {{duel: ?{name: string, outcome: string, gap: number}, duelUrl: ?string}}
   */
  getShareDuel() {
    const summary = this.engine.gameOverSummary?.duel;
    return {
      duel: summary ? { name: summary.name, outcome: summary.outcome, gap: summary.gap } : null,
      duelUrl: this.buildChallengeUrl()
    };
  },

  /** Lists the stored duels in the stats window: the record, filter bar, then the latest duels. */
  renderStatsDuels() {
    const els = this.elements;
    const storage = this.storageManager;
    const duels = storage.getGhostDuels?.() ?? [];
    const record = storage.getGhostDuelRecord?.() ?? { won: 0, lost: 0 };
    const hasDuels = duels.length > 0;
    const activeFilter = this.statsDuelsFilter === GHOST_MODE_DAILY || this.statsDuelsFilter === GAME_MODES.FLUX
      ? this.statsDuelsFilter
      : DUEL_FILTER_ALL;
    const filtered = filterGhostDuels(duels, activeFilter);
    if (els.statsDuelsRecord) {
      setTextIfChanged(
        els.statsDuelsRecord,
        hasDuels
          ? t('modals.stats.duels.record', { won: formatNumber(record.won), lost: formatNumber(record.lost) })
          : ''
      );
      els.statsDuelsRecord.classList.toggle(HIDDEN_CLASS, !hasDuels);
    }
    els.statsDuelsFilters?.classList.toggle(HIDDEN_CLASS, !hasDuels);
    const filterButtons = [
      [DUEL_FILTER_ALL, els.btnDuelsFilterAll],
      [GHOST_MODE_DAILY, els.btnDuelsFilterDaily],
      [GAME_MODES.FLUX, els.btnDuelsFilterFlux]
    ];
    for (const [key, button] of filterButtons) {
      if (!button) {
        continue;
      }
      const isSelected = activeFilter === key;
      button.classList.toggle('active', isSelected);
      setAttributeIfChanged(button, 'aria-pressed', isSelected ? 'true' : 'false');
    }
    if (els.statsDuelsEmpty) {
      setTextIfChanged(els.statsDuelsEmpty, t(hasDuels ? 'modals.stats.duels.filteredEmpty' : 'modals.stats.duels.empty'));
      els.statsDuelsEmpty.classList.toggle(HIDDEN_CLASS, filtered.length > 0);
    }
    if (els.statsDuelsList) {
      els.statsDuelsList.replaceChildren(
        ...filtered.map((entry) => {
          const item = document.createElement('li');
          const name = entry.alias || t('duel.defaultName');
          const modeKey = entry.mode === GHOST_MODE_DAILY ? 'app.nav.button.daily' : MODE_NAME_KEYS[GAME_MODES.FLUX];
          const result = formatDuelResultText({
            name,
            outcome: entry.outcome,
            gap: Math.abs(entry.myScore - entry.ghostScore)
          });
          const scores = `${formatNumber(entry.myScore)}${STATS_SEPARATOR}${formatNumber(entry.ghostScore)}`;
          item.textContent = `${plainModeName(t(modeKey))}${STATS_SEPARATOR}${result} (${scores})`;
          return item;
        })
      );
      els.statsDuelsList.classList.toggle(HIDDEN_CLASS, filtered.length === 0);
    }
  }
};
