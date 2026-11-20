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

import { OBSTACLE_TYPES_ORDER, SPECIAL_TYPES_ORDER } from '../core/Constants.js';
import { t } from '../core/I18n.js';
import { MAGNETAR_BEHAVIOURS } from '../game/MagnetarRules.js';

/** Where the light catches a special ball icon, as a radial-gradient position. */
export const SPECIAL_ICON_HIGHLIGHT_POSITION = '30% 30%';

/** Core board and launcher mechanics documented in the Workshop Codex. */
export const CODEX_MECHANICS_ORDER = Object.freeze(['polarity', 'collectors', 'overcharge', 'resonance', 'sag', 'rail']);

/** Merge Basin specials, events, contracts, and basin rules documented in the Workshop Codex. */
export const CODEX_MERGE_GUIDE_ORDER = Object.freeze(['joker', 'ice', 'bomb', 'events', 'contracts', 'shapes']);

const CODEX_BEHAVIORS_ORDER = Object.freeze(['hexGrid', 'pinball', 'orbital', 'convoy', 'merge', 'slingshot']);

/**
 * Background of a special ball icon: lit from the top left, like the ball on the board.
 * @param {{highlight: string, fill: string}} spec - Special ball colors from balls.json.
 * @returns {string} A CSS background value.
 */
export function specialIconBackground(spec) {
  return `radial-gradient(circle at ${SPECIAL_ICON_HIGHLIGHT_POSITION}, ${spec.highlight}, ${spec.fill})`;
}

function buildCodexCard({ icon, title, desc, borderColor = null, background = null, dataset = null }) {
  const card = document.createElement('div');
  card.className = 'codex-card';
  if (dataset) {
    for (const [k, v] of Object.entries(dataset)) {
      card.dataset[k] = v;
    }
  }
  const badge = document.createElement('div');
  badge.className = 'codex-badge';
  if (borderColor) {
    badge.style.borderColor = borderColor;
  }
  if (background) {
    badge.style.background = background;
  }
  badge.textContent = icon;

  const info = document.createElement('div');
  info.className = 'codex-info';
  const titleEl = document.createElement('div');
  titleEl.className = 'codex-title';
  titleEl.textContent = title;
  const descEl = document.createElement('div');
  descEl.className = 'codex-desc';
  descEl.textContent = desc;
  info.append(titleEl, descEl);

  card.append(badge, info);
  return card;
}

function appendCodexSection(pane, headingKey, cards, sectionName = null) {
  const heading = document.createElement('h3');
  heading.className = 'modal-subtitle';
  heading.textContent = t(headingKey);
  pane.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'codex-grid';
  if (sectionName) {
    grid.dataset.codexSection = sectionName;
  }
  for (const card of cards) {
    grid.appendChild(card);
  }
  pane.appendChild(grid);
}

function buildThemedBadge(highlight, fill) {
  return highlight ? { borderColor: highlight, background: specialIconBackground({ highlight, fill }) } : {};
}

function buildModifierCards(ui) {
  const fill = ui.ballsConfig.neutralPalette?.fill || ui.gameConfig.theme.launcherBaseColor;
  return Object.entries(ui.ballsConfig.clusterModifiers || {}).map(([key, spec]) =>
    buildCodexCard({
      icon: spec.badge || '',
      title: t(`modals.shop.codex.modifiers.${key}.name`),
      desc: t(`modals.shop.codex.modifiers.${key}.description`),
      ...buildThemedBadge(spec.ringColor, fill)
    })
  );
}

function buildObstacleCards(ui) {
  const types = ui.obstaclesConfig?.types || ui.engine?.obstaclesConfig?.types || {};
  const fallbackFill = ui.gameConfig.theme.launcherBaseColor;
  return OBSTACLE_TYPES_ORDER.map((key) => {
    const spec = types[key];
    const color = spec?.ringColor || spec?.borderColor || spec?.coreColor || spec?.beamColor;
    const fill = spec?.fillColor || spec?.outerColor || fallbackFill;
    return buildCodexCard({
      icon: t(`modals.shop.codex.obstacles.${key}.icon`),
      title: t(`modals.shop.codex.obstacles.${key}.name`),
      desc: t(`modals.shop.codex.obstacles.${key}.description`),
      ...buildThemedBadge(color, fill)
    });
  });
}

function buildSpecialCards(ui) {
  return SPECIAL_TYPES_ORDER
    .filter((type) => Boolean(ui.ballsConfig.specialTypes?.[type]))
    .map((type) => {
      const spec = ui.ballsConfig.specialTypes[type];
      return buildCodexCard({
        icon: spec.icon,
        title: t(`hud.powerups.${type}.name`),
        desc: t(`hud.powerups.${type}.tooltip`),
        background: specialIconBackground(spec)
      });
    });
}

function buildUniformCards(keys, keyPrefix, color, fill, datasetKey = null) {
  const badgeStyle = buildThemedBadge(color, fill);
  return keys.map((key) =>
    buildCodexCard({
      icon: t(`${keyPrefix}.${key}.icon`),
      title: t(`${keyPrefix}.${key}.name`),
      desc: t(`${keyPrefix}.${key}.description`),
      ...badgeStyle,
      dataset: datasetKey ? { [datasetKey]: key } : null
    })
  );
}

/**
 * Populates the Workshop Codex & Guide tab with cluster modifiers, magnetic obstacles,
 * special balls, and Daily Challenge mutators.
 * @this {import('./UIManager.js').UIManager}
 */
export function buildCodexPane() {
  const pane = this.elements.codexPane;
  if (!pane) {
    return;
  }
  pane.replaceChildren();
  const theme = this.gameConfig.theme;
  const fill = theme.launcherBaseColor;
  const accent = theme.collectorLabelColor || theme.wavePopupColor;

  appendCodexSection(pane, 'modals.shop.codex.modifiersTitle', buildModifierCards(this));
  appendCodexSection(pane, 'modals.shop.codex.obstaclesTitle', buildObstacleCards(this));
  appendCodexSection(pane, 'modals.shop.codex.specialsTitle', buildSpecialCards(this));

  const mutatorKeys = Object.keys(this.gameConfig.daily?.mutators || {});
  if (mutatorKeys.length > 0) {
    const mutStyle = buildThemedBadge(theme.wavePopupColor, fill);
    const mutCards = mutatorKeys.map((key) =>
      buildCodexCard({
        icon: t(`modals.shop.codex.mutators.${key}.icon`),
        title: t(`gameplay.mutators.${key}`),
        desc: t(`modals.shop.codex.mutators.${key}.description`),
        ...mutStyle
      })
    );
    appendCodexSection(pane, 'modals.shop.codex.mutatorsTitle', mutCards);
  }

  appendCodexSection(pane, 'modals.shop.codex.mechanicsTitle', buildUniformCards(CODEX_MECHANICS_ORDER, 'modals.shop.codex.mechanics', accent, fill));
  appendCodexSection(
    pane,
    'modals.shop.codex.magnetarPatterns.title',
    buildUniformCards(Object.values(MAGNETAR_BEHAVIOURS), 'modals.shop.codex.magnetarPatterns.patterns', accent, fill, 'magnetarPattern'),
    'magnetarPatterns'
  );
  appendCodexSection(
    pane,
    'modals.shop.codex.behaviors.title',
    buildUniformCards(CODEX_BEHAVIORS_ORDER, 'modals.shop.codex.behaviors.items', accent, fill, 'codexBehavior'),
    'behaviors'
  );
  appendCodexSection(
    pane,
    'modals.shop.codex.mergeGuide.title',
    buildUniformCards(CODEX_MERGE_GUIDE_ORDER, 'modals.shop.codex.mergeGuide.items', theme.wavePopupColor || theme.collectorLabelColor, fill, 'codexMergeItem'),
    'mergeGuide'
  );
}
