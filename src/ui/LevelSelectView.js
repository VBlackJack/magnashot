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

import { GAME_STATES, MATH_CONSTANTS } from '../core/Constants.js';
import { t, formatNumber } from '../core/I18n.js';
import { LEVEL_FORMATS } from '../game/LevelCatalog.js';
import {
  FULL_PERCENT,
  LABELLED_LEVEL_FORMATS,
  formatChapterTheme,
  formatLevelName,
  revealLiveRegion,
  scheduleNextFrame,
  setTextIfChanged
} from './UIHelpers.js';

export { LABELLED_LEVEL_FORMATS, formatChapterTheme, formatLevelName };

/** Localization keys for the level card format badges. */
export const LEVEL_FORMAT_BADGE_KEYS = Object.freeze({
  [LEVEL_FORMATS.LANDMARK]: 'modals.levelSelect.card.formatBadge.landmark',
  [LEVEL_FORMATS.PRECISION]: 'modals.levelSelect.card.formatBadge.precision',
  [LEVEL_FORMATS.ARSENAL]: 'modals.levelSelect.card.formatBadge.arsenal',
  [LEVEL_FORMATS.TWIST]: 'modals.levelSelect.card.formatBadge.twist'
});

/**
 * Resolves the format badge key for a level summary, or null for standard non-landmark levels.
 * @param {object|null|undefined} summary - Level summary from LevelCatalog.
 * @returns {string|null}
 */
export function resolveLevelFormatBadgeKey(summary) {
  if (!summary) {
    return null;
  }
  if (summary.isLandmark) {
    return LEVEL_FORMAT_BADGE_KEYS[LEVEL_FORMATS.LANDMARK];
  }
  if (LABELLED_LEVEL_FORMATS.has(summary.format)) {
    return LEVEL_FORMAT_BADGE_KEYS[summary.format];
  }
  return null;
}

/** Description of a campaign level, from its summary in the level catalog. */
export function formatLevelDescription(summary) {
  if (!summary.isGenerated) {
    return t(summary.descriptionKey);
  }
  const params = { chapter: summary.chapter, index: summary.chapterLevel, size: summary.chapterSize };
  if (summary.isLandmark) {
    return t('levels.generated.landmarkDescription', params);
  }
  if (LABELLED_LEVEL_FORMATS.has(summary.format)) {
    return t(`levels.generated.formats.${summary.format}.description`, {
      ...params,
      mechanic: summary.twistMechanic ? t(`levels.generated.themes.${summary.twistMechanic}`) : ''
    });
  }
  return t('levels.generated.description', params);
}

/** Display name of a chapter of the level select. */
export function formatChapterName(chapter) {
  if (chapter.isTutorial) {
    return t('modals.levelSelect.chapters.tutorial');
  }
  return t('modals.levelSelect.chapters.numbered', {
    chapter: formatNumber(chapter.index),
    theme: formatChapterTheme(chapter.featuredMechanics)
  });
}

function setAttributeIfChanged(element, name, value) {
  if (element && element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/** Fewest columns a tile grid can show; also the fallback when the layout cannot be read. */
const MIN_GRID_COLUMNS = 1;

/** Localization key prefix of the corner mark glyph of a level tile. */
const LEVEL_TILE_MARK_KEY_PREFIX = 'modals.levelSelect.tile.mark.';

/** Mark kind of the landmark tile; other kinds reuse the level format name. */
const LEVEL_TILE_MARK_LANDMARK = 'landmark';

const HIDDEN_CLASS = 'hidden';

function clampStars(value, maxStars) {
  return Math.max(0, Math.min(maxStars, Number(value) || 0));
}

/**
 * Next index of a roving grid after one arrow press, or -1 when the move leaves the grid.
 * Horizontal moves are linear (a row end continues on the next row) when wrapRows is true,
 * and stop at the row edges when it is false so a caller can hand over to spatial navigation.
 * A vertical move into a shorter last row lands on its last item; from the last row it stops.
 * @param {number} index - Current index.
 * @param {number} count - Number of items.
 * @param {number} columns - Items per row.
 * @param {number} dx - Horizontal step, -1, 0 or 1.
 * @param {number} dy - Vertical step, -1, 0 or 1.
 * @param {boolean} [wrapRows=true] - Whether left and right cross row boundaries.
 * @returns {number} The target index, or -1 at an edge.
 */
export function stepGridIndex(index, count, columns, dx, dy, wrapRows = true) {
  if (!(count > 0)) {
    return -1;
  }
  const width = Math.max(MIN_GRID_COLUMNS, Math.floor(columns) || MIN_GRID_COLUMNS);
  const from = Math.max(0, Math.min(count - 1, index));
  if (dx !== 0) {
    const target = from + Math.sign(dx);
    if (target < 0 || target >= count) {
      return -1;
    }
    if (!wrapRows && Math.floor(target / width) !== Math.floor(from / width)) {
      return -1;
    }
    return target;
  }
  if (dy !== 0) {
    const target = from + Math.sign(dy) * width;
    if (target < 0) {
      return -1;
    }
    if (target >= count) {
      const isLastRow = Math.floor(from / width) === Math.floor((count - 1) / width);
      return isLastRow ? -1 : count - 1;
    }
    return target;
  }
  return from;
}

/**
 * Stars won in a chapter against the stars it offers.
 * @param {{firstId: number, lastId: number}} chapter
 * @param {Object<number, {stars?: number}>} stats - Level stats by level id.
 * @param {number} maxStars - Stars per level.
 * @returns {{stars: number, maxStars: number, isCompleted: boolean}}
 */
export function summarizeChapterStars(chapter, stats, maxStars) {
  let stars = 0;
  for (let id = chapter.firstId; id <= chapter.lastId; id++) {
    stars += clampStars(stats?.[id]?.stars, maxStars);
  }
  const total = (chapter.lastId - chapter.firstId + 1) * maxStars;
  return { stars, maxStars: total, isCompleted: total > 0 && stars >= total };
}

/**
 * True when a level is open and still has stars to win (what the incomplete filter keeps).
 * @param {number} id - Level id.
 * @param {number} unlocked - Furthest unlocked level.
 * @param {Object<number, {stars?: number}>} stats - Level stats by level id.
 * @param {number} maxStars - Stars per level.
 */
export function isLevelIncomplete(id, unlocked, stats, maxStars) {
  return id <= unlocked && clampStars(stats?.[id]?.stars, maxStars) < maxStars;
}

/**
 * Whether the detail panel shows a description: authored levels, landmarks and labelled
 * formats say something specific; the generic "level N of M" line of a plain generated
 * level does not.
 * @param {object|null|undefined} summary - Level summary from LevelCatalog.
 */
export function shouldShowLevelDescription(summary) {
  if (!summary) {
    return false;
  }
  if (!summary.isGenerated || summary.isLandmark) {
    return true;
  }
  return LABELLED_LEVEL_FORMATS.has(summary.format);
}

/** Corner mark kind of a level tile, or null for a plain level. */
function resolveLevelTileMarkKind(summary) {
  if (summary.isLandmark) {
    return LEVEL_TILE_MARK_LANDMARK;
  }
  return LABELLED_LEVEL_FORMATS.has(summary.format) ? summary.format : null;
}

/** Tile elements of the level grid, in display order. */
function listLevelTiles(grid) {
  return Array.from(grid?.children || []).filter((child) => child.dataset?.levelId !== undefined);
}

/** Columns the tile grid currently lays out, read once per call. */
function readGridColumns(grid) {
  const template = globalThis.getComputedStyle?.(grid)?.gridTemplateColumns;
  const count = typeof template === 'string' ? template.split(/\s+/).filter(Boolean).length : 0;
  return Math.max(MIN_GRID_COLUMNS, count);
}

/** Scrolls the grid, and only it, so the tile is fully visible (or centered). */
function scrollTileIntoGrid(grid, tile, center) {
  if (typeof grid?.getBoundingClientRect !== 'function' || typeof tile?.getBoundingClientRect !== 'function') {
    return;
  }
  const gridRect = grid.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  if (center) {
    grid.scrollTop += tileRect.top - gridRect.top - (gridRect.height - tileRect.height) * MATH_CONSTANTS.HALF;
  } else if (tileRect.top < gridRect.top) {
    grid.scrollTop -= gridRect.top - tileRect.top;
  } else if (tileRect.bottom > gridRect.bottom) {
    grid.scrollTop += tileRect.bottom - gridRect.bottom;
  }
}

function setSelectedTile(tile, isSelected) {
  tile.classList.toggle('selected', isSelected);
  tile.setAttribute('aria-selected', String(isSelected));
  tile.tabIndex = isSelected ? 0 : -1;
}

/**
 * Campaign map methods, mixed into UIManager: chapter switcher, compact level tiles and
 * the detail panel of the selected level.
 */
export const uiLevelSelectMethods = {
  /**
   * The live region that shows a status hint for the window on top: the map's, the Play
   * hub's, or null when the message should be announced instead.
   * @returns {HTMLElement|null}
   */
  getStatusHintTarget() {
    const isOpen = (modal) => Boolean(modal) && !modal.classList.contains(HIDDEN_CLASS);
    if (isOpen(this.elements.modalLevels)) {
      return this.elements.levelsChapterHint || null;
    }
    if (isOpen(this.elements.modalPlay)) {
      return this.elements.playHubHint || null;
    }
    return null;
  },

  /**
   * Reveals a locked chapter or level requirement in the status line of the window on top.
   * @param {number} requiredLevel - Level number that must be cleared first.
   * @param {string} [hintKey] - Localization key for the requirement message.
   */
  showLockedLevelHint(requiredLevel, hintKey = 'modals.levelSelect.chapterLockedHint') {
    const text = t(hintKey, { level: requiredLevel, previous: requiredLevel });
    const hintEl = this.getStatusHintTarget();
    if (!hintEl) {
      this.announce?.(text);
      return;
    }
    revealLiveRegion({ region: hintEl, textElement: hintEl, text, schedule: scheduleNextFrame });
  },

  syncLevelsFilterButton() {
    const btn = this.elements?.btnLevelsFilterIncomplete;
    if (!btn) {
      return;
    }
    btn.classList.toggle('active', Boolean(this.levelsFilterIncomplete));
    btn.setAttribute('aria-pressed', String(Boolean(this.levelsFilterIncomplete)));
  },

  /** Opens the campaign map on the chapter of the level being played (or the furthest open one). */
  openLevelsModal() {
    const suggestedLevelId = this.getSuggestedLevelId();
    this.syncLevelsFilterButton();

    if (this.elements.levelsStarsSummary) {
      const maxCampaignStars = this.engine.levelCatalog.count * this.gameConfig.scoring.maxStars;
      setTextIfChanged(
        this.elements.levelsStarsSummary,
        t('modals.levelSelect.starsTotal', {
          stars: formatNumber(this.storageManager.getTotalStars()),
          maxStars: formatNumber(maxCampaignStars)
        })
      );
    }

    this.elements.levelsChapterHint?.classList.add(HIDDEN_CLASS);
    this.levelsChapterIndex = this.engine.levelCatalog.chapterIndexOf(suggestedLevelId);
    this.levelsSelectedId = suggestedLevelId;
    this.renderChapterSwitcher();
    const suggestedTile = this.renderLevelTiles(suggestedLevelId);
    this.renderLevelDetail(this.levelsSelectedId);

    const selectedTile = listLevelTiles(this.elements.levelsGrid).find((tile) => tile.tabIndex === 0);
    this.openOverlayModal(
      this.elements.modalLevels,
      selectedTile || this.elements.btnPlayLevelModal || this.elements.btnCloseLevels
    );
    if (suggestedTile) {
      scrollTileIntoGrid(this.elements.levelsGrid, suggestedTile, true);
    }
  },

  /**
   * Shows the tiles of another chapter. A locked chapter stays closed and says why.
   * @param {number} index - Chapter index from the level catalog.
   * @param {{focus?: boolean}} options - focus moves the keyboard focus to the selected tile.
   * @returns {boolean} True when the chapter changed.
   */
  selectLevelChapter(index, { focus = false } = {}) {
    const chapter = this.engine.levelCatalog.listChapters()[index];
    if (!chapter) {
      return false;
    }
    if (chapter.firstId > this.storageManager.getUnlockedLevel()) {
      this.showLockedLevelHint(Math.max(1, chapter.firstId - 1), 'modals.levelSelect.chapterLockedHint');
      // Puts a select that already moved back on the open chapter.
      this.renderChapterSwitcher();
      return false;
    }
    this.elements.levelsChapterHint?.classList.add(HIDDEN_CLASS);
    this.levelsChapterIndex = index;
    this.levelsSelectedId = null;
    this.renderChapterSwitcher();
    this.renderLevelTiles(this.getSuggestedLevelId());
    this.renderLevelDetail(this.levelsSelectedId);
    if (this.elements.levelsGrid) {
      this.elements.levelsGrid.scrollTop = 0;
    }
    if (focus) {
      listLevelTiles(this.elements.levelsGrid).find((tile) => tile.tabIndex === 0)?.focus();
    }
    return true;
  },

  /**
   * Moves to the previous or next chapter. Open chapters form a prefix of the list, so the
   * neighbour is either open or locked; a locked one is refused with its unlock hint.
   * @param {number} step - Negative for the previous chapter, positive for the next one.
   * @param {{focus?: boolean}} options - focus follows the trigger (see selectLevelChapter).
   * @returns {boolean} True when the chapter changed.
   */
  stepLevelChapter(step, { focus = false } = {}) {
    const target = this.engine.levelCatalog.listChapters()[this.levelsChapterIndex + Math.sign(step)];
    if (!target) {
      return false;
    }
    return this.selectLevelChapter(target.index, { focus });
  },

  /**
   * Fills the chapter switcher: the chapter select, the previous and next buttons, and the
   * stars line and meter of the open chapter.
   */
  renderChapterSwitcher() {
    const chapters = this.engine.levelCatalog.listChapters();
    const unlocked = this.storageManager.getUnlockedLevel();
    const select = this.elements.levelsChapterSelect;

    if (select) {
      const options = chapters.map((chapter) => {
        const isLocked = chapter.firstId > unlocked;
        const name = this.formatChapterName(chapter);
        const option = document.createElement('option');
        option.value = String(chapter.index);
        option.textContent = isLocked ? t('modals.levelSelect.chapters.optionLocked', { name }) : name;
        option.disabled = isLocked;
        return option;
      });
      select.replaceChildren(...options);
      select.value = String(this.levelsChapterIndex);
    }

    const next = chapters[this.levelsChapterIndex + 1];
    const setDisabled = (button, isDisabled) => {
      if (!button) {
        return;
      }
      if (isDisabled) {
        button.setAttribute('aria-disabled', 'true');
      } else {
        button.removeAttribute('aria-disabled');
      }
    };
    setDisabled(this.elements.btnChapterPrev, this.levelsChapterIndex <= 0);
    setDisabled(this.elements.btnChapterNext, !next || next.firstId > unlocked);

    const chapter = chapters[this.levelsChapterIndex];
    if (!chapter) {
      return;
    }
    // The tile list is named after the chapter it shows.
    setAttributeIfChanged(
      this.elements.levelsGrid,
      'aria-label',
      t('modals.levelSelect.grid.aria', { chapter: this.formatChapterName(chapter) })
    );
    const summary = summarizeChapterStars(
      chapter,
      this.storageManager.getLevelStats(),
      this.gameConfig.scoring.maxStars
    );
    setTextIfChanged(
      this.elements.levelsChapterProgress,
      t(summary.isCompleted ? 'modals.levelSelect.chapters.starsCompleted' : 'modals.levelSelect.chapters.stars', {
        stars: formatNumber(summary.stars),
        maxStars: formatNumber(summary.maxStars)
      })
    );
    const fill = this.elements.levelsChapterMeterFill;
    if (fill?.style) {
      const pct = summary.maxStars > 0 ? Math.round((summary.stars / summary.maxStars) * FULL_PERCENT) : 0;
      fill.style.width = `${pct}%`;
    }
  },

  /**
   * Fills the grid with the tiles of the open chapter and settles the selection: the kept
   * one when it is still shown, else the suggested level, else the first tile. Exactly one
   * tile is in the tab order afterwards.
   * @param {number} suggestedLevelId - Level marked as the current one.
   * @returns {HTMLElement|null} The tile of the suggested level, when it is shown.
   */
  renderLevelTiles(suggestedLevelId) {
    const catalog = this.engine.levelCatalog;
    const chapter = catalog.listChapters()[this.levelsChapterIndex];
    const unlocked = this.storageManager.getUnlockedLevel();
    const stats = this.storageManager.getLevelStats();
    const maxStars = this.gameConfig.scoring.maxStars;
    const fragment = document.createDocumentFragment();
    const tiles = new Map();

    for (let levelId = chapter.firstId; levelId <= chapter.lastId; levelId++) {
      if (this.levelsFilterIncomplete && !isLevelIncomplete(levelId, unlocked, stats, maxStars)) {
        continue;
      }
      const tile = this.createLevelTile(catalog.summarize(levelId), {
        isUnlocked: levelId <= unlocked,
        isCurrent: levelId === suggestedLevelId,
        stat: stats[levelId] || { bestScore: 0, stars: 0 },
        maxStars
      });
      tiles.set(levelId, tile);
      fragment.appendChild(tile);
    }

    if (tiles.size === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.className = 'levels-empty-filter';
      emptyMsg.textContent = t('modals.levelSelect.filter.allCompletedInChapter');
      fragment.appendChild(emptyMsg);
      this.levelsSelectedId = null;
    } else {
      let selectedId = this.levelsSelectedId;
      if (!tiles.has(selectedId)) {
        selectedId = tiles.has(suggestedLevelId) ? suggestedLevelId : tiles.keys().next().value;
      }
      this.levelsSelectedId = selectedId;
      for (const [levelId, tile] of tiles) {
        setSelectedTile(tile, levelId === selectedId);
      }
    }
    this.elements.levelsGrid.replaceChildren(fragment);
    return tiles.get(suggestedLevelId) || null;
  },

  /**
   * Builds one tile: number, stars, corner mark, and the accessible name of the level.
   * @param {object} lvl - Level summary.
   * @param {{isUnlocked: boolean, isCurrent: boolean, stat: object, maxStars: number}} state
   */
  createLevelTile(lvl, { isUnlocked, isCurrent, stat, maxStars }) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `level-tile ${isUnlocked ? 'unlocked' : 'locked'}${isCurrent ? ' current' : ''}`;
    tile.setAttribute('role', 'option');
    tile.dataset.levelId = String(lvl.id);
    tile.tabIndex = -1;
    tile.setAttribute('aria-selected', 'false');

    const formatBadgeKey = resolveLevelFormatBadgeKey(lvl);
    const levelName = this.formatLevelName(lvl);
    const accessibleName =
      lvl.isLandmark && formatBadgeKey
        ? t('modals.levelSelect.tile.withBadge', { name: levelName, badge: t(formatBadgeKey) })
        : levelName;

    const number = document.createElement('span');
    number.className = 'level-tile-number';
    number.textContent = formatNumber(lvl.id);
    tile.appendChild(number);

    const markKind = resolveLevelTileMarkKind(lvl);
    if (markKind) {
      const mark = document.createElement('span');
      mark.className = `level-tile-mark ${markKind}`;
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = t(`${LEVEL_TILE_MARK_KEY_PREFIX}${markKind}`);
      if (formatBadgeKey) {
        mark.title = t(formatBadgeKey);
      }
      tile.appendChild(mark);
    }

    if (isUnlocked) {
      const clampedStars = clampStars(stat.stars, maxStars);
      const starsEl = document.createElement('span');
      starsEl.className = 'level-tile-stars';
      starsEl.setAttribute('aria-hidden', 'true');
      starsEl.textContent = this.formatStars(clampedStars, maxStars);
      tile.appendChild(starsEl);
      // The current tile is named by its label text, not by aria-current as well.
      tile.setAttribute(
        'aria-label',
        t(isCurrent ? 'modals.levelSelect.card.ariaCurrent' : 'modals.levelSelect.card.aria', {
          id: lvl.id,
          name: accessibleName,
          stars: clampedStars,
          maxStars,
          best: t('modals.levelSelect.card.bestScore', { score: formatNumber(stat.bestScore || 0) })
        })
      );
    } else {
      tile.setAttribute('aria-disabled', 'true');
      tile.setAttribute(
        'aria-label',
        t('modals.levelSelect.card.ariaLocked', {
          id: lvl.id,
          name: accessibleName,
          previous: Math.max(1, lvl.id - 1)
        })
      );
    }
    return tile;
  },

  /**
   * Fills the detail panel with one level; no level shows the empty prompt.
   * @param {number|null} levelId
   */
  renderLevelDetail(levelId) {
    const els = this.elements;
    const catalog = this.engine.levelCatalog;
    const lvl = levelId == null ? null : catalog.summarize(levelId);
    const setHidden = (el, isHidden) => el?.classList.toggle(HIDDEN_CLASS, isHidden);

    if (!lvl) {
      setTextIfChanged(els.levelsDetailHeader, '');
      setTextIfChanged(els.levelsDetailTitle, '');
      setHidden(els.levelsDetailBadge, true);
      setTextIfChanged(els.levelsDetailDesc, t('modals.levelSelect.detail.empty'));
      setHidden(els.levelsDetailDesc, false);
      els.levelsDetailStars?.replaceChildren();
      setTextIfChanged(els.levelsDetailBest, '');
      setHidden(els.levelsDetailLock, true);
      els.btnPlayLevelModal?.setAttribute('aria-disabled', 'true');
      return;
    }

    const isUnlocked = lvl.id <= this.storageManager.getUnlockedLevel();
    const stat = this.storageManager.getLevelStats()[lvl.id] || { bestScore: 0, stars: 0 };
    const maxStars = this.gameConfig.scoring.maxStars;
    const chapter = catalog.listChapters()[catalog.chapterIndexOf(lvl.id)];

    setTextIfChanged(
      els.levelsDetailHeader,
      t('modals.levelSelect.detail.header', { id: lvl.id, chapter: this.formatChapterName(chapter) })
    );
    setTextIfChanged(els.levelsDetailTitle, this.formatLevelName(lvl));

    const badgeKey = resolveLevelFormatBadgeKey(lvl);
    if (badgeKey) {
      setTextIfChanged(els.levelsDetailBadge, t(badgeKey));
    }
    setHidden(els.levelsDetailBadge, !badgeKey);

    const showDescription = shouldShowLevelDescription(lvl);
    setTextIfChanged(els.levelsDetailDesc, showDescription ? this.formatLevelDescription(lvl) : '');
    setHidden(els.levelsDetailDesc, !showDescription);

    if (els.levelsDetailStars) {
      if (isUnlocked) {
        const clamped = clampStars(stat.stars, maxStars);
        const glyphs = document.createElement('span');
        glyphs.setAttribute('aria-hidden', 'true');
        glyphs.textContent = this.formatStars(clamped, maxStars);
        const text = document.createElement('span');
        text.className = 'visually-hidden';
        text.textContent = t('modals.levelSelect.card.starsAria', {
          stars: formatNumber(clamped),
          maxStars: formatNumber(maxStars)
        });
        els.levelsDetailStars.replaceChildren(glyphs, text);
      } else {
        els.levelsDetailStars.replaceChildren();
      }
    }
    setTextIfChanged(
      els.levelsDetailBest,
      isUnlocked ? t('modals.levelSelect.card.bestScore', { score: formatNumber(stat.bestScore || 0) }) : ''
    );
    setTextIfChanged(
      els.levelsDetailLock,
      isUnlocked ? '' : t('modals.levelSelect.card.locked', { previous: Math.max(1, lvl.id - 1) })
    );
    setHidden(els.levelsDetailLock, isUnlocked);

    const button = els.btnPlayLevelModal;
    if (button) {
      const isResume = isUnlocked && this.isCampaignRunActive() && lvl.id === this.engine.currentLevelId;
      setTextIfChanged(
        button,
        t(isResume ? 'modals.levelSelect.button.resume' : 'modals.levelSelect.button.play', { level: lvl.id })
      );
      if (isUnlocked) {
        button.removeAttribute('aria-disabled');
      } else {
        button.setAttribute('aria-disabled', 'true');
      }
    }
  },

  /**
   * Selects a tile and updates the detail panel. Only the two tiles whose state changes are
   * touched.
   * @param {number} levelId
   * @param {{focus?: boolean, center?: boolean}} options
   * @returns {HTMLElement|null} The selected tile, or null when it is not shown.
   */
  selectLevelTile(levelId, { focus = false, center = false } = {}) {
    const grid = this.elements.levelsGrid;
    const tiles = listLevelTiles(grid);
    const tile = tiles.find((entry) => entry.dataset.levelId === String(levelId));
    if (!tile) {
      return null;
    }
    const previous = tiles.find((entry) => entry.dataset.levelId === String(this.levelsSelectedId));
    if (previous && previous !== tile) {
      setSelectedTile(previous, false);
    }
    setSelectedTile(tile, true);
    this.levelsSelectedId = Number(levelId);
    this.renderLevelDetail(this.levelsSelectedId);
    scrollTileIntoGrid(grid, tile, center);
    if (focus) {
      tile.focus();
    }
    return tile;
  },

  /**
   * Moves the selection one tile in a direction (selection follows focus) and scrolls it
   * into view. Focusing is left to the caller.
   * @param {number} dx - Horizontal step.
   * @param {number} dy - Vertical step.
   * @param {{wrapRows?: boolean}} options - wrapRows false stops at row edges.
   * @returns {HTMLElement|null} The newly selected tile, or null at an edge.
   */
  moveLevelTileFocus(dx, dy, { wrapRows = true } = {}) {
    const tiles = listLevelTiles(this.elements.levelsGrid);
    if (tiles.length === 0) {
      return null;
    }
    const from = Math.max(
      0,
      tiles.findIndex((tile) => tile.dataset.levelId === String(this.levelsSelectedId))
    );
    const to = stepGridIndex(from, tiles.length, readGridColumns(this.elements.levelsGrid), dx, dy, wrapRows);
    if (to < 0 || to === from) {
      return null;
    }
    return this.selectLevelTile(Number(tiles[to].dataset.levelId));
  },

  /** Selects the level the player is on (or the furthest open one) and brings it into view. */
  jumpToCurrentLevel() {
    const suggestedId = this.getSuggestedLevelId();
    const chapterIndex = this.engine.levelCatalog.chapterIndexOf(suggestedId);
    let isRerenderNeeded = chapterIndex !== this.levelsChapterIndex;
    const isShown = isLevelIncomplete(
      suggestedId,
      this.storageManager.getUnlockedLevel(),
      this.storageManager.getLevelStats(),
      this.gameConfig.scoring.maxStars
    );
    if (this.levelsFilterIncomplete && !isShown) {
      // A filtered-out level cannot be shown, so the filter gives way.
      this.levelsFilterIncomplete = false;
      this.syncLevelsFilterButton();
      isRerenderNeeded = true;
    }
    if (isRerenderNeeded) {
      this.selectLevelChapter(chapterIndex);
    }
    this.selectLevelTile(suggestedId, { focus: true, center: true });
  },

  /** Plays the selected level, resuming it when it is the running campaign level. */
  playSelectedLevel() {
    const levelId = this.levelsSelectedId;
    if (levelId == null) {
      return;
    }
    if (levelId > this.storageManager.getUnlockedLevel()) {
      this.showLockedLevelHint(Math.max(1, levelId - 1), 'modals.levelSelect.cardLockedHint');
      return;
    }
    if (this.isCampaignRunActive() && levelId === this.engine.currentLevelId) {
      if (this.isPlayHubOpen()) {
        // The map is stacked over the Play hub: close it without touching the pause state, then let
        // the hub resume path unpause (or release the overlay hold) and close the hub itself.
        this.closeOverlayModal(this.elements.modalLevels);
        this.resumePlayHubRun();
        return;
      }
      if (!this.autoPausedByOverlay && this.engine.state === GAME_STATES.PAUSED) {
        this.engine.togglePause();
      }
      this.closeOverlayModal(this.elements.modalLevels);
      return;
    }
    this.requestDestructiveAction(
      () => {
        this.hideAllModals();
        this.engine.startCampaignLevel(levelId);
      },
      () => t('modals.levelSelect.button.play', { level: levelId })
    );
  }
};
