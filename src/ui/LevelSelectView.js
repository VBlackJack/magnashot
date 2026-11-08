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

import { t, formatNumber } from '../core/I18n.js';
import { LEVEL_FORMATS } from '../game/LevelCatalog.js';

/** Id prefix of the level-select chapter tabs; the chapter index completes it. */
const LEVEL_CHAPTER_TAB_ID_PREFIX = 'levels-chapter-tab-';
export { LEVEL_CHAPTER_TAB_ID_PREFIX };

/** Generated level formats whose name and description say what sets them apart. */
export const LABELLED_LEVEL_FORMATS = new Set([
  LEVEL_FORMATS.TWIST,
  LEVEL_FORMATS.PRECISION,
  LEVEL_FORMATS.ARSENAL
]);

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

/** Theme of a generated chapter: its featured mechanic, or its pair of them. */
export function formatChapterTheme(featuredMechanics) {
  const [first, second] = featuredMechanics.map((mechanic) => t(`levels.generated.themes.${mechanic}`));
  return second ? t('levels.generated.themePair', { first, second }) : first;
}

/**
 * Display name of a campaign level: its own name when authored, else its chapter theme
 * and its place in the chapter, then its format when it is not a standard level.
 * @param {object} summary - A level summary from the level catalog.
 */
export function formatLevelName(summary) {
  if (!summary.isGenerated) {
    return t(summary.nameKey);
  }
  const name = t('levels.generated.name', {
    theme: formatChapterTheme(summary.featuredMechanics),
    index: summary.chapterLevel
  });
  if (!LABELLED_LEVEL_FORMATS.has(summary.format)) {
    return name;
  }
  const format = t(`levels.generated.formats.${summary.format}.label`, {
    mechanic: summary.twistMechanic ? t(`levels.generated.themes.${summary.twistMechanic}`) : ''
  });
  return t('levels.generated.formatName', { name, format });
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
    chapter: chapter.index,
    theme: formatChapterTheme(chapter.featuredMechanics)
  });
}

function setAttributeIfChanged(element, name, value) {
  if (element && element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/**
 * Fills the chapter strip of the level select: one tab per chapter with the stars won in
 * it. A chapter whose first level is still locked cannot be opened.
 * @this {import('./UIManager.js').UIManager}
 */
export function renderLevelChapters() {
  const strip = this.elements.levelsChapters;
  if (!strip) {
    return;
  }
  const unlocked = this.storageManager.getUnlockedLevel();
  const stats = this.storageManager.getLevelStats();
  const maxStarsPerLevel = this.gameConfig.scoring.maxStars;
  const chapters = this.engine.levelCatalog.listChapters();
  const openable = chapters.filter((chapter) => chapter.firstId <= unlocked);
  strip.replaceChildren();

  for (const chapter of chapters) {
    const isLocked = chapter.firstId > unlocked;
    const isActive = chapter.index === this.levelsChapterIndex;
    let stars = 0;
    for (let id = chapter.firstId; id <= chapter.lastId; id++) {
      stars += Math.max(0, Math.min(maxStarsPerLevel, stats[id]?.stars || 0));
    }
    const maxStars = (chapter.lastId - chapter.firstId + 1) * maxStarsPerLevel;
    const isCompleted = !isLocked && maxStars > 0 && stars >= maxStars;
    const name = this.formatChapterName(chapter);

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = `${LEVEL_CHAPTER_TAB_ID_PREFIX}${chapter.index}`;
    tab.className = `level-chapter${isActive ? ' active' : ''}${isLocked ? ' locked' : ''}${isCompleted ? ' completed' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(isActive));
    tab.setAttribute('aria-controls', 'levels-grid');
    tab.tabIndex = isActive ? 0 : -1;
    if (isLocked) {
      const requiredLevel = Math.max(1, chapter.firstId - 1);
      tab.setAttribute('aria-disabled', 'true');
      tab.title = t('modals.levelSelect.chapterLockedHint', { level: requiredLevel });
    }
    const ariaKey = isLocked
      ? 'modals.levelSelect.chapters.ariaLocked'
      : isCompleted
        ? 'modals.levelSelect.chapters.ariaCompleted'
        : 'modals.levelSelect.chapters.aria';
    tab.setAttribute(
      'aria-label',
      t(ariaKey, {
        name,
        first: chapter.firstId,
        last: chapter.lastId,
        stars,
        maxStars
      })
    );

    const titleEl = document.createElement('span');
    titleEl.className = 'level-chapter-title';
    titleEl.textContent = name;
    const starsEl = document.createElement('span');
    starsEl.className = 'level-chapter-stars';
    starsEl.textContent = isLocked
      ? t('modals.levelSelect.chapters.locked')
      : t(
          isCompleted ? 'modals.levelSelect.chapters.starsCompleted' : 'modals.levelSelect.chapters.stars',
          { stars, maxStars }
        );
    tab.append(titleEl, starsEl);

    tab.addEventListener('click', () => {
      if (chapter.firstId > this.storageManager.getUnlockedLevel()) {
        this.showLockedLevelHint(Math.max(1, chapter.firstId - 1), 'modals.levelSelect.chapterLockedHint');
        return;
      }
      this.selectLevelChapter(chapter.index);
    });
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') {
        return;
      }
      e.preventDefault();
      const position = openable.findIndex((entry) => entry.index === this.levelsChapterIndex);
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const next = openable[(position + step + openable.length) % openable.length];
      this.selectLevelChapter(next.index, { focus: true });
    });
    strip.appendChild(tab);
  }
  // The grid is the panel of the active tab, and is named by it.
  setAttributeIfChanged(
    this.elements.levelsGrid,
    'aria-labelledby',
    `${LEVEL_CHAPTER_TAB_ID_PREFIX}${this.levelsChapterIndex}`
  );
}

/**
 * Fills the level grid with the cards of the selected chapter.
 * @this {import('./UIManager.js').UIManager}
 * @param {number} suggestedLevelId - Level marked as the current one.
 * @returns {HTMLElement|null} The card of the suggested level, when it is in the chapter.
 */
export function renderLevelCards(suggestedLevelId) {
  const catalog = this.engine.levelCatalog;
  const chapter = catalog.listChapters()[this.levelsChapterIndex];
  const unlocked = this.storageManager.getUnlockedLevel();
  const stats = this.storageManager.getLevelStats();
  const grid = this.elements.levelsGrid;
  let suggestedCard = null;
  grid.replaceChildren();

  for (let levelId = chapter.firstId; levelId <= chapter.lastId; levelId++) {
    const lvl = catalog.summarize(levelId);
    const isUnlocked = lvl.id <= unlocked;
    const lvlStat = stats[lvl.id] || { bestScore: 0, stars: 0 };
    if (this.levelsFilterIncomplete && (!isUnlocked || (lvlStat.stars || 0) >= this.gameConfig.scoring.maxStars)) {
      continue;
    }

    const card = document.createElement('div');
    card.className = `level-card ${isUnlocked ? 'unlocked' : 'locked'}`;

    const header = document.createElement('div');
    header.className = 'level-card-header';
    header.textContent = t('modals.levelSelect.card.levelNumber', { id: lvl.id });
    const formatBadgeKey = resolveLevelFormatBadgeKey(lvl);
    if (formatBadgeKey) {
      const formatClass = lvl.isLandmark ? LEVEL_FORMATS.LANDMARK : lvl.format;
      const formatBadge = document.createElement('span');
      formatBadge.className = `level-format-badge ${formatClass}`;
      formatBadge.textContent = t(formatBadgeKey);
      header.append(' ', formatBadge);
    }
    if (lvl.id === suggestedLevelId) {
      suggestedCard = card;
      card.classList.add('current');
      card.setAttribute('aria-current', 'true');
      const currentBadge = document.createElement('span');
      currentBadge.className = 'level-current-badge';
      currentBadge.textContent = t('modals.levelSelect.card.current');
      header.append(' ', currentBadge);
    }

    const title = document.createElement('div');
    title.className = 'level-card-title';
    title.textContent = this.formatLevelName(lvl);

    const desc = document.createElement('div');
    desc.className = 'level-card-desc';
    const descId = `level-card-desc-${lvl.id}`;
    desc.id = descId;
    desc.textContent = this.formatLevelDescription(lvl);

    const footer = document.createElement('div');
    footer.className = 'level-card-footer';

    if (isUnlocked) {
      const maxStars = this.gameConfig.scoring.maxStars;
      const clampedStars = Math.max(0, Math.min(maxStars, lvlStat.stars));
      const starsEl = document.createElement('span');
      starsEl.className = 'level-stars';
      // Star glyphs are decorative; the hidden text states the count.
      const starsGlyphs = document.createElement('span');
      starsGlyphs.setAttribute('aria-hidden', 'true');
      starsGlyphs.textContent = this.formatStars(lvlStat.stars, maxStars);
      const starsText = document.createElement('span');
      starsText.className = 'visually-hidden';
      starsText.textContent = t('modals.levelSelect.card.starsAria', {
        stars: clampedStars,
        maxStars
      });
      starsEl.append(starsGlyphs, starsText);

      const bestText = t('modals.levelSelect.card.bestScore', { score: formatNumber(lvlStat.bestScore) });
      const scoreEl = document.createElement('span');
      scoreEl.className = 'level-best';
      scoreEl.textContent = bestText;

      footer.append(starsEl, scoreEl);
      card.setAttribute('role', 'button');
      card.setAttribute(
        'aria-label',
        t(lvl.id === suggestedLevelId ? 'modals.levelSelect.card.ariaCurrent' : 'modals.levelSelect.card.aria', {
          id: lvl.id,
          name: title.textContent,
          stars: clampedStars,
          maxStars,
          best: bestText
        })
      );
      card.setAttribute('aria-describedby', descId);
      card.tabIndex = 0;
      const selectLevel = () => {
        const isOtherLevelOrMidRound =
          lvl.id !== this.engine.currentLevelId ||
          (this.engine.hasFiredInRound && this.engine.physicsWorld.balls.length > 0);
        if (isOtherLevelOrMidRound) {
          this.requestDestructiveAction(
            () => {
              this.hideAllModals();
              this.engine.startCampaignLevel(lvl.id);
            },
            () => t('modals.levelSelect.button.play', { level: lvl.id })
          );
        } else {
          this.hideAllModals();
          this.engine.startCampaignLevel(lvl.id);
        }
      };
      card.addEventListener('click', selectLevel);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectLevel();
        }
      });
    } else {
      const requiredLevel = Math.max(1, lvl.id - 1);
      const lockText = t('modals.levelSelect.card.locked', { previous: requiredLevel });
      const lockEl = document.createElement('span');
      lockEl.className = 'level-locked-badge';
      lockEl.textContent = lockText;
      footer.appendChild(lockEl);
      card.setAttribute('role', 'button');
      card.setAttribute('aria-disabled', 'true');
      card.setAttribute(
        'aria-label',
        t('modals.levelSelect.card.ariaLocked', {
          id: lvl.id,
          name: title.textContent,
          previous: requiredLevel
        })
      );
      card.setAttribute('aria-describedby', descId);
      card.tabIndex = 0;
      card.title = lockText;
      const showCardLockedHint = () => {
        this.showLockedLevelHint(requiredLevel, 'modals.levelSelect.cardLockedHint');
      };
      card.addEventListener('click', showCardLockedHint);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showCardLockedHint();
        }
      });
    }

    card.append(header, title, desc, footer);
    grid.appendChild(card);
  }
  if (grid.children.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'levels-empty-filter';
    emptyMsg.textContent = t('modals.levelSelect.filter.allCompletedInChapter');
    grid.appendChild(emptyMsg);
  }
  return suggestedCard;
}
