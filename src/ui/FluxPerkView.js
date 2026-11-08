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

import { GAME_MODES, GAME_STATES, INPUT_MODES } from '../core/Constants.js';
import { t, formatNumber } from '../core/I18n.js';

/** Prefix of the keyboard codes that pick a perk card (Digit1 picks the first card). */
export const FLUX_PERK_KEY_PREFIX = 'Digit';

/** Converts a fractional perk step (0.10) to the percentage shown to the player (10). */
const PERCENT_SCALE = 100;

/** Perk unit (configs/flux.json) whose step is a fraction of a multiplier shown as a percentage. */
const PERCENT_UNIT = 'percent';

/**
 * Index of the offered card a key code picks, or -1 when the code is not a card key.
 * @param {string} code - KeyboardEvent.code.
 * @param {number} offerSize - Number of cards currently offered.
 * @returns {number} Zero-based card index.
 */
export function fluxPerkIndexForKey(code, offerSize) {
  if (typeof code !== 'string' || !code.startsWith(FLUX_PERK_KEY_PREFIX)) {
    return -1;
  }
  const idx = Number.parseInt(code.slice(FLUX_PERK_KEY_PREFIX.length), 10) - 1;
  return Number.isInteger(idx) && idx >= 0 && idx < offerSize ? idx : -1;
}

/**
 * The number shown in a perk description: counts as they are, perks whose unit is
 * "percent" as a percentage.
 * @param {{step: number, unit?: string}} spec - Perk spec from configs/flux.json.
 * @returns {string} The localized number.
 */
export function fluxPerkDisplayValue(spec) {
  const step = Number(spec?.step) || 0;
  const value = spec?.unit === PERCENT_UNIT ? Math.round(step * PERCENT_SCALE) : step;
  return formatNumber(value);
}

/** The perk specs of the running Flux config, or an empty catalog. */
function perkCatalog(engine) {
  return engine?.fluxConfig?.perks?.catalog || {};
}

/** Perks the player holds, in the configured display order. */
export function listActiveFluxPerks(engine) {
  if (engine?.mode !== GAME_MODES.FLUX || !engine.fluxPerks) {
    return [];
  }
  const catalog = perkCatalog(engine);
  const order = engine.fluxConfig?.perks?.order || Object.keys(catalog);
  return order
    .filter((id) => catalog[id] && (engine.fluxPerks[id] || 0) > 0)
    .map((id) => ({ id, stacks: engine.fluxPerks[id], max: catalog[id].maxStacks }));
}

/** True when the perk choice must be on screen: the run is live and an offer waits. */
export function isFluxPerkChoiceVisible(engine) {
  return (
    engine?.state === GAME_STATES.PLAYING &&
    typeof engine.isAwaitingPerk === 'function' &&
    engine.isAwaitingPerk()
  );
}

/** Builds one offer card. */
function buildPerkCard(engine, perkId, position, inputMode) {
  const spec = perkCatalog(engine)[perkId] || {};
  const stacksAfterPick = Math.min(spec.maxStacks, (engine.getFluxPerkStacks?.(perkId) || 0) + 1);

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'flux-perk-card';
  card.dataset.perkId = perkId;
  if (inputMode === INPUT_MODES.POINTER) {
    card.setAttribute('aria-keyshortcuts', String(position + 1));
  }

  const icon = document.createElement('span');
  icon.className = 'flux-perk-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = spec.icon || '';

  const name = document.createElement('span');
  name.className = 'flux-perk-name';
  name.textContent = t(`gameplay.flux.perks.${perkId}.name`);

  const description = document.createElement('span');
  description.className = 'flux-perk-description';
  description.textContent = t(`gameplay.flux.perks.${perkId}.description`, {
    value: fluxPerkDisplayValue(spec)
  });

  const stack = document.createElement('span');
  stack.className = 'flux-perk-stack';
  const stackParams = { stacks: formatNumber(stacksAfterPick), max: formatNumber(spec.maxStacks) };
  stack.textContent = t('modals.fluxPerk.stack', stackParams);
  stack.setAttribute('aria-label', t('modals.fluxPerk.stackAria', stackParams));

  card.append(icon, name, description, stack);
  return card;
}

/**
 * Shows or hides the perk choice and rebuilds its cards when the offer changes.
 * @this {import('./UIManager.js').UIManager}
 * @param {object} engine - The game engine.
 */
export function syncFluxPerkModal(engine) {
  const modal = this.elements.modalFluxPerk;
  const cards = this.elements.fluxPerkCards;
  if (!modal || !cards) {
    return;
  }
  const shouldShow = isFluxPerkChoiceVisible(engine);
  const wasHidden = modal.classList.contains('hidden');
  if (!shouldShow) {
    modal.classList.add('hidden');
    return;
  }

  const offer = engine.fluxPerkOffer;
  const signature = `${offer.join(',')}|${this.inputMode}|${t('modals.fluxPerk.title')}`;
  const needsRebuild = cards.dataset.signature !== signature;
  if (needsRebuild) {
    cards.replaceChildren(...offer.map((perkId, position) => buildPerkCard(engine, perkId, position, this.inputMode)));
    cards.dataset.signature = signature;
  }
  // Only a hidden perk dialog saves focus, and never an element inside another dialog
  // (Resume sits in the pause dialog): focus must return to something visible after the pick.
  if (wasHidden && !document.activeElement?.closest?.('.modal-backdrop')) {
    this.saveLastFocusedElement();
  }
  modal.classList.remove('hidden');
  if (wasHidden || needsRebuild) {
    this.syncModalInertState();
    this.focusInTopModal(cards.firstElementChild);
  }
}

/**
 * Renders the compact perk chips (icon and stacks) into a container, hiding the
 * container's wrapper outside Flux or while no perk is held.
 * @param {HTMLElement|null} container - The chip row.
 * @param {object} engine - The game engine.
 * @param {HTMLElement|null} [wrapper] - Element to hide instead of the container itself.
 */
export function renderFluxPerkChips(container, engine, wrapper = container) {
  if (!container) {
    return;
  }
  const active = listActiveFluxPerks(engine);
  wrapper?.classList.toggle('hidden', active.length === 0);
  const signature = `${active.map((perk) => `${perk.id}:${perk.stacks}`).join(',')}|${t('hud.stats.perks.label')}`;
  if (container.dataset.signature === signature) {
    return;
  }
  container.dataset.signature = signature;
  const catalog = perkCatalog(engine);
  container.replaceChildren(
    ...active.map((perk) => {
      const chip = document.createElement('span');
      chip.className = 'perk-chip';
      chip.setAttribute('role', 'img');
      const stackParams = { stacks: formatNumber(perk.stacks), max: formatNumber(perk.max) };
      const stackText = t('modals.fluxPerk.stack', stackParams);
      chip.setAttribute(
        'aria-label',
        `${t(`gameplay.flux.perks.${perk.id}.name`)} ${t('modals.fluxPerk.stackAria', stackParams)}`
      );
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = catalog[perk.id].icon || '';
      const count = document.createElement('span');
      count.className = 'perk-chip-count';
      count.setAttribute('aria-hidden', 'true');
      count.textContent = stackText;
      chip.append(icon, count);
      return chip;
    })
  );
}
