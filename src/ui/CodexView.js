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
export const CODEX_MECHANICS_ORDER = Object.freeze(['polarity', 'collectors', 'overcharge', 'resonance', 'sag']);

/**
 * Background of a special ball icon: lit from the top left, like the ball on the board.
 * @param {{highlight: string, fill: string}} spec - Special ball colors from balls.json.
 * @returns {string} A CSS background value.
 */
export function specialIconBackground(spec) {
  return `radial-gradient(circle at ${SPECIAL_ICON_HIGHLIGHT_POSITION}, ${spec.highlight}, ${spec.fill})`;
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

  const modHeading = document.createElement('h3');
  modHeading.className = 'modal-subtitle';
  modHeading.textContent = t('modals.shop.codex.modifiersTitle');
  pane.appendChild(modHeading);

  const modGrid = document.createElement('div');
  modGrid.className = 'codex-grid';
  for (const [modKey, modSpec] of Object.entries(this.ballsConfig.clusterModifiers || {})) {
    const card = document.createElement('div');
    card.className = 'codex-card';

    const badge = document.createElement('div');
    badge.className = 'codex-badge';
    badge.style.borderColor = modSpec.ringColor;
    badge.style.background = specialIconBackground({
      highlight: modSpec.ringColor,
      fill: this.ballsConfig.neutralPalette?.fill || this.gameConfig.theme.launcherBaseColor
    });
    badge.textContent = modSpec.badge || '';

    const info = document.createElement('div');
    info.className = 'codex-info';
    const title = document.createElement('div');
    title.className = 'codex-title';
    title.textContent = t(`modals.shop.codex.modifiers.${modKey}.name`);
    const desc = document.createElement('div');
    desc.className = 'codex-desc';
    desc.textContent = t(`modals.shop.codex.modifiers.${modKey}.description`);
    info.append(title, desc);

    card.append(badge, info);
    modGrid.appendChild(card);
  }
  pane.appendChild(modGrid);

  const obsHeading = document.createElement('h3');
  obsHeading.className = 'modal-subtitle';
  obsHeading.textContent = t('modals.shop.codex.obstaclesTitle');
  pane.appendChild(obsHeading);

  const obsGrid = document.createElement('div');
  obsGrid.className = 'codex-grid';
  const obstacleTypes = this.obstaclesConfig?.types || this.engine?.obstaclesConfig?.types || {};
  for (const obsKey of OBSTACLE_TYPES_ORDER) {
    const card = document.createElement('div');
    card.className = 'codex-card';

    const obsSpec = obstacleTypes[obsKey];
    const badge = document.createElement('div');
    badge.className = 'codex-badge';
    const badgeColor = obsSpec?.ringColor || obsSpec?.borderColor || obsSpec?.coreColor || obsSpec?.beamColor;
    if (badgeColor) {
      badge.style.borderColor = badgeColor;
      badge.style.background = specialIconBackground({
        highlight: badgeColor,
        fill: obsSpec?.fillColor || obsSpec?.outerColor || this.gameConfig.theme.launcherBaseColor
      });
    }
    badge.textContent = t(`modals.shop.codex.obstacles.${obsKey}.icon`);

    const info = document.createElement('div');
    info.className = 'codex-info';
    const title = document.createElement('div');
    title.className = 'codex-title';
    title.textContent = t(`modals.shop.codex.obstacles.${obsKey}.name`);
    const desc = document.createElement('div');
    desc.className = 'codex-desc';
    desc.textContent = t(`modals.shop.codex.obstacles.${obsKey}.description`);
    info.append(title, desc);

    card.append(badge, info);
    obsGrid.appendChild(card);
  }
  pane.appendChild(obsGrid);

  const specialsHeading = document.createElement('h3');
  specialsHeading.className = 'modal-subtitle';
  specialsHeading.textContent = t('modals.shop.codex.specialsTitle');
  pane.appendChild(specialsHeading);

  const specialsGrid = document.createElement('div');
  specialsGrid.className = 'codex-grid';
  for (const type of SPECIAL_TYPES_ORDER) {
    const spec = this.ballsConfig.specialTypes?.[type];
    if (!spec) {
      continue;
    }
    const card = document.createElement('div');
    card.className = 'codex-card';

    const badge = document.createElement('div');
    badge.className = 'codex-badge';
    badge.style.background = specialIconBackground(spec);
    badge.textContent = spec.icon;

    const info = document.createElement('div');
    info.className = 'codex-info';
    const title = document.createElement('div');
    title.className = 'codex-title';
    title.textContent = t(`hud.powerups.${type}.name`);
    const desc = document.createElement('div');
    desc.className = 'codex-desc';
    desc.textContent = t(`hud.powerups.${type}.tooltip`);
    info.append(title, desc);

    card.append(badge, info);
    specialsGrid.appendChild(card);
  }
  pane.appendChild(specialsGrid);

  const mutatorKeys = Object.keys(this.gameConfig.daily?.mutators || {});
  if (mutatorKeys.length > 0) {
    const mutHeading = document.createElement('h3');
    mutHeading.className = 'modal-subtitle';
    mutHeading.textContent = t('modals.shop.codex.mutatorsTitle');
    pane.appendChild(mutHeading);

    const mutGrid = document.createElement('div');
    mutGrid.className = 'codex-grid';
    for (const mutKey of mutatorKeys) {
      const card = document.createElement('div');
      card.className = 'codex-card';

      const badge = document.createElement('div');
      badge.className = 'codex-badge';
      const mutColor = this.gameConfig.theme.wavePopupColor;
      badge.style.borderColor = mutColor;
      badge.style.background = specialIconBackground({
        highlight: mutColor,
        fill: this.gameConfig.theme.launcherBaseColor
      });
      badge.textContent = t(`modals.shop.codex.mutators.${mutKey}.icon`);

      const info = document.createElement('div');
      info.className = 'codex-info';
      const title = document.createElement('div');
      title.className = 'codex-title';
      title.textContent = t(`gameplay.mutators.${mutKey}`);
      const desc = document.createElement('div');
      desc.className = 'codex-desc';
      desc.textContent = t(`modals.shop.codex.mutators.${mutKey}.description`);
      info.append(title, desc);

      card.append(badge, info);
      mutGrid.appendChild(card);
    }
    pane.appendChild(mutGrid);
  }

  const mechHeading = document.createElement('h3');
  mechHeading.className = 'modal-subtitle';
  mechHeading.textContent = t('modals.shop.codex.mechanicsTitle');
  pane.appendChild(mechHeading);

  const mechGrid = document.createElement('div');
  mechGrid.className = 'codex-grid';
  for (const mechKey of CODEX_MECHANICS_ORDER) {
    const card = document.createElement('div');
    card.className = 'codex-card';

    const badge = document.createElement('div');
    badge.className = 'codex-badge';
    const mechColor = this.gameConfig.theme.collectorLabelColor || this.gameConfig.theme.wavePopupColor;
    badge.style.borderColor = mechColor;
    badge.style.background = specialIconBackground({
      highlight: mechColor,
      fill: this.gameConfig.theme.launcherBaseColor
    });
    badge.textContent = t(`modals.shop.codex.mechanics.${mechKey}.icon`);

    const info = document.createElement('div');
    info.className = 'codex-info';
    const title = document.createElement('div');
    title.className = 'codex-title';
    title.textContent = t(`modals.shop.codex.mechanics.${mechKey}.name`);
    const desc = document.createElement('div');
    desc.className = 'codex-desc';
    desc.textContent = t(`modals.shop.codex.mechanics.${mechKey}.description`);
    info.append(title, desc);

    card.append(badge, info);
    mechGrid.appendChild(card);
  }
  pane.appendChild(mechGrid);
  const patternsHeading = document.createElement('h3');
  patternsHeading.className = 'modal-subtitle';
  patternsHeading.textContent = t('modals.shop.codex.magnetarPatterns.title');
  pane.appendChild(patternsHeading);

  const patternsGrid = document.createElement('div');
  patternsGrid.className = 'codex-grid';
  patternsGrid.dataset.codexSection = 'magnetarPatterns';
  for (const patternId of Object.values(MAGNETAR_BEHAVIOURS)) {
    const card = document.createElement('div');
    card.className = 'codex-card';
    card.dataset.magnetarPattern = patternId;

    const badge = document.createElement('div');
    badge.className = 'codex-badge';
    const patternColor = this.gameConfig.theme.collectorLabelColor || this.gameConfig.theme.wavePopupColor;
    badge.style.borderColor = patternColor;
    badge.style.background = specialIconBackground({
      highlight: patternColor,
      fill: this.gameConfig.theme.launcherBaseColor
    });
    badge.textContent = t(`modals.shop.codex.magnetarPatterns.patterns.${patternId}.icon`);

    const info = document.createElement('div');
    info.className = 'codex-info';
    const title = document.createElement('div');
    title.className = 'codex-title';
    title.textContent = t(`modals.shop.codex.magnetarPatterns.patterns.${patternId}.name`);
    const desc = document.createElement('div');
    desc.className = 'codex-desc';
    desc.textContent = t(`modals.shop.codex.magnetarPatterns.patterns.${patternId}.description`);
    info.append(title, desc);

    card.append(badge, info);
    patternsGrid.appendChild(card);
  }
  pane.appendChild(patternsGrid);
}
