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

import {
  ARENA_THEMES,
  ARENA_THEMES_ORDER,
  BALL_STYLES,
  BALL_STYLES_ORDER,
  GAME_MODES,
  LASER_TRAILS,
  LASER_TRAILS_ORDER,
  SPECIAL_TYPES_ORDER
} from '../core/Constants.js';
import { t, formatNumber } from '../core/I18n.js';
import { specialIconBackground } from './CodexView.js';
import { FULL_PERCENT, filterFocusTrapCandidates } from './UIHelpers.js';

/** Workshop note shown while a mode neutralises upgrades; Daily is the fallback. */
const BASELINE_NOTE_KEYS = Object.freeze({
  [GAME_MODES.CLASSIC]: 'modals.shop.upgrades.classicBaselineNote',
  [GAME_MODES.PUZZLE]: 'modals.shop.upgrades.puzzleBaselineNote',
  [GAME_MODES.HEX_GRID]: 'modals.shop.upgrades.puristBaselineNote',
  [GAME_MODES.MERGE]: 'modals.shop.upgrades.puristBaselineNote'
});
/** Workshop note shown in shotless modes where specific upgrades behave differently. */
const SHOTLESS_NOTE_KEYS = Object.freeze({
  [GAME_MODES.CONVOY]: 'modals.shop.upgrades.convoyNote',
  [GAME_MODES.ORBITAL]: 'modals.shop.upgrades.orbitalNote'
});
/** Workshop note shown in shot-budget modes that repurpose a specific upgrade. */
const MODE_UPGRADE_NOTE_KEYS = Object.freeze({
  [GAME_MODES.PINBALL]: 'modals.shop.upgrades.pinballNote',
  [GAME_MODES.SLINGSHOT]: 'modals.shop.upgrades.slingshotNote'
});
export { FULL_PERCENT };

/** Achievement tiers, lowest first. */
export const ACHIEVEMENT_TIERS = Object.freeze(['bronze', 'silver', 'gold']);

/**
 * Groups achievement entries by family (`tierOf`, or the id itself when untiered) and
 * orders each family by tier. Families keep the order of their first appearance.
 * @param {Array<[string, object]>} entries - Achievement config entries.
 * @returns {Array<{ familyId: string, tiers: Array<{ id: string, spec: object, tier: string }> }>}
 */
export function groupAchievementTiers(entries) {
  const families = new Map();
  for (const [id, spec] of entries) {
    const familyId = typeof spec?.tierOf === 'string' && spec.tierOf ? spec.tierOf : id;
    const tier = ACHIEVEMENT_TIERS.includes(spec?.tier) ? spec.tier : ACHIEVEMENT_TIERS[0];
    if (!families.has(familyId)) {
      families.set(familyId, { familyId, tiers: [] });
    }
    families.get(familyId).tiers.push({ id, spec, tier });
  }
  for (const family of families.values()) {
    family.tiers.sort((a, b) => ACHIEVEMENT_TIERS.indexOf(a.tier) - ACHIEVEMENT_TIERS.indexOf(b.tier));
  }
  return [...families.values()];
}

/**
 * Description of an achievement with its goal filled in from the config, so the number
 * the player reads is always the one the engine unlocks on.
 * @param {string} achId - Achievement id.
 * @param {{ threshold?: number }} achSpec - Achievement config entry.
 * @returns {string}
 */
export function formatAchievementDescription(achId, achSpec) {
  return t(`modals.shop.achievements.items.${achId}.description`, {
    target: formatNumber(achSpec?.threshold || 1)
  });
}

/** Workshop tab names. */
export const SHOP_TABS = Object.freeze({
  UPGRADES: 'upgrades',
  AMMO: 'ammo',
  STYLES: 'styles',
  ACHIEVEMENTS: 'achievements',
  CODEX: 'codex'
});

const ACHIEVEMENT_FAMILY_SPECS = Object.freeze({
  comboMaster: Object.freeze({ contextKey: 'maxCombo', specTargetField: 'minChain' }),
  starCollector: Object.freeze({ contextKey: 'totalStars', specTargetField: 'targetStars' }),
  survivorWave10: Object.freeze({ contextKey: 'endlessWave', specTargetField: 'targetWave' }),
  endlessSurvivor: Object.freeze({ contextKey: 'endlessWave', specTargetField: 'targetWave' }),
  bossSlayer: Object.freeze({ contextKey: 'bossesDestroyed' }),
  firstAvalanche: Object.freeze({ contextKey: 'maxAvalanche' }),
  sharpshooter: Object.freeze({ contextKey: 'shotsRemainingOnClear' }),
  fluxShapes: Object.freeze({ contextKey: 'fluxStage' }),
  bossRushWaves: Object.freeze({ contextKey: 'bossRushWave' }),
  hexGridWaves: Object.freeze({ contextKey: 'hexGridWave' }),
  orbitalWaves: Object.freeze({ contextKey: 'orbitalWave' }),
  pinballStages: Object.freeze({ contextKey: 'pinballStage' }),
  convoyWaves: Object.freeze({ contextKey: 'convoyWave' }),
  mergeTiers: Object.freeze({ contextKey: 'mergeTier' }),
  slingshotStages: Object.freeze({ contextKey: 'slingshotStage' }),
  magnetarsGrounded: Object.freeze({ contextKey: 'magnetarsGrounded' }),
  magnetarLandslide: Object.freeze({ contextKey: 'magnetarLandslide' })
});

const ACHIEVEMENT_FIELD_FALLBACKS = Object.freeze([
  ['minChain', 'maxCombo'],
  ['targetStars', 'totalStars'],
  ['targetWave', 'endlessWave']
]);

function resolveAchievementMetricAndTarget(familyId, achSpec, threshold, progressContext) {
  if (familyId === 'campaignComplete') {
    const levelCount = progressContext.campaignLevelCount || 1;
    const unlockedLevel = progressContext.unlockedLevel || 1;
    return { target: Math.max(1, levelCount), rawCurrent: Math.max(0, unlockedLevel - 1) };
  }
  const entry = ACHIEVEMENT_FAMILY_SPECS[familyId];
  if (entry) {
    const fieldTarget = entry.specTargetField && achSpec ? achSpec[entry.specTargetField] : null;
    const current = progressContext[entry.contextKey] || 0;
    return { target: fieldTarget ?? threshold ?? 1, rawCurrent: current };
  }
  for (const [specField, contextKey] of ACHIEVEMENT_FIELD_FALLBACKS) {
    if (achSpec?.[specField]) {
      return { target: achSpec[specField], rawCurrent: progressContext[contextKey] || 0 };
    }
  }
  return { target: threshold ?? 1, rawCurrent: 0 };
}

/**
 * Computes the player's current and target progress for an achievement card.
 * @param {string} achId - Achievement key from config.
 * @param {object} achSpec - Achievement specification from config.
 * @param {boolean} isUnlocked - Whether the achievement is already unlocked.
 * @param {object} [progressContext] - Current progress values.
 * @returns {{ current: number, target: number, pct: number }}
 */
export function computeAchievementProgress(achId, achSpec, isUnlocked, progressContext = {}) {
  // A higher tier reads the same record as its family's base achievement.
  const familyId = typeof achSpec?.tierOf === 'string' && achSpec.tierOf ? achSpec.tierOf : achId;
  const threshold = Number.isFinite(achSpec?.threshold) && achSpec.threshold > 0 ? achSpec.threshold : null;
  const { target, rawCurrent } = resolveAchievementMetricAndTarget(familyId, achSpec, threshold, progressContext);
  const current = isUnlocked ? target : Math.max(0, Math.min(target, rawCurrent));
  const pct = target > 0 ? Math.round((current / target) * FULL_PERCENT) : 0;
  return { current, target, pct };
}

/**
 * Re-renders the shop after a purchase without reopening it, then puts
 * focus back on the same buy button (or the nearest usable one when that
 * button just became disabled).
 * @this {import('./UIManager.js').UIManager}
 */
export function rerenderWorkshopKeepingFocus(focusSelector, fallbackSlotIndex = 0) {
  this.renderShopContents();
  const modal = this.elements.modalShop;
  const target = modal.querySelector(focusSelector);
  if (target && !target.disabled) {
    target.focus();
    return;
  }
  const candidates = filterFocusTrapCandidates(modal.querySelectorAll('.shop-pane button'));
  const nextAtOrAfter = candidates.find(
    (btn) => Number.parseInt(btn.dataset?.slotIndex ?? '0', 10) >= fallbackSlotIndex
  );
  const fallback =
    nextAtOrAfter ||
    candidates[candidates.length - 1] ||
    this.elements.btnCloseShop;
  if (fallback) {
    fallback.focus();
  }
}

function appendUpgradeBaselineNote(ui, grid) {
  const isNeutralised = ui.engine.areUpgradesNeutralised();
  const isShotlessActive = !isNeutralised && ui.engine.usesShotBudget?.() === false;
  const modeSpecificNoteKey = !isNeutralised && !isShotlessActive
    ? MODE_UPGRADE_NOTE_KEYS[ui.engine.mode] || null
    : null;
  if (!ui.isRunActive() || (!isNeutralised && !isShotlessActive && !modeSpecificNoteKey)) {
    return;
  }
  const baselineNote = document.createElement('p');
  baselineNote.className = 'levels-empty-filter';
  baselineNote.setAttribute('role', 'note');
  let noteKey = modeSpecificNoteKey;
  if (isNeutralised) {
    noteKey = BASELINE_NOTE_KEYS[ui.engine.mode] || 'modals.shop.upgrades.dailyBaselineNote';
  } else if (isShotlessActive) {
    noteKey = SHOTLESS_NOTE_KEYS[ui.engine.mode] || 'modals.shop.upgrades.arcadeShotlessNote';
  }
  baselineNote.textContent = t(noteKey);
  grid.appendChild(baselineNote);
}

function buildMaxedBadge() {
  const maxedBadge = document.createElement('span');
  maxedBadge.className = 'upgrade-maxed-badge';
  const maxedGlyph = document.createElement('span');
  maxedGlyph.setAttribute('aria-hidden', 'true');
  maxedGlyph.textContent = t('modals.shop.card.maxed');
  const maxedText = document.createElement('span');
  maxedText.className = 'visually-hidden';
  maxedText.textContent = t('modals.shop.card.maxedAria');
  maxedBadge.append(maxedGlyph, maxedText);
  return maxedBadge;
}

/** @this {import('./UIManager.js').UIManager} */
function buildUpgradeCard(upgradeKey, spec, coins, slotIndex) {
  const ui = this;
  const currentLevel = ui.storageManager.getUpgradeLevel(upgradeKey);
  const isMaxed = currentLevel >= spec.maxLevel;
  const cost = ui.storageManager.getUpgradeCost(upgradeKey);

  const card = document.createElement('div');
  card.className = 'level-card';

  const header = document.createElement('div');
  header.className = 'level-card-header';
  header.textContent = t('modals.shop.card.level', {
    level: currentLevel,
    maxLevel: spec.maxLevel
  });

  const title = document.createElement('div');
  title.className = 'level-card-title';
  title.textContent = t(`modals.shop.upgrades.${upgradeKey}.name`);

  const desc = document.createElement('div');
  desc.className = 'level-card-desc';
  desc.textContent = t(`modals.shop.upgrades.${upgradeKey}.description`, {
    shots: formatNumber(spec.shotsPerLevel || 0),
    points: formatNumber(spec.pointsBonusPerLevel || 0),
    overcharge: formatNumber(spec.overchargeBonusPerLevel || 0)
  });

  if (isMaxed) {
    // A finished upgrade shows a status, not a button that only looks pressable.
    card.append(header, title, desc, buildMaxedBadge());
    return card;
  }

  const buyBtn = document.createElement('button');
  buyBtn.type = 'button';
  buyBtn.className = 'modal-btn primary';
  buyBtn.dataset.upgradeKey = upgradeKey;
  buyBtn.dataset.slotIndex = String(slotIndex);
  // A bonus that changes the run waits until the run can be stored with its debit.
  const upgradeBlocked = ui.engine.canBuyUpgrade?.(upgradeKey) === false;
  const upgradeBlockKey = upgradeBlocked ? ui.getSpecialAmmoBlockReasonKey?.() : null;
  buyBtn.disabled = coins < cost || upgradeBlocked;
  if (upgradeBlocked) {
    buyBtn.textContent = t('modals.shop.specialAmmo.blockedLabel');
    if (upgradeBlockKey) {
      buyBtn.title = t(upgradeBlockKey);
      buyBtn.setAttribute('aria-label', `${t('modals.shop.specialAmmo.blockedLabel')}. ${t(upgradeBlockKey)}`);
    }
  } else {
    buyBtn.textContent = t('modals.shop.card.buy', { cost: formatNumber(cost) });
  }

  buyBtn.addEventListener('click', () => {
    if (this.engine.canBuyUpgrade?.(upgradeKey) === false) {
      return;
    }
    if (this.storageManager.purchaseUpgrade(upgradeKey)) {
      const newLevel = currentLevel + 1;
      this.audioManager.playEffect('match', newLevel);
      this.engine.applyUpgradePurchase(upgradeKey);
      this.refresh(this.engine, this.lastExtra);
      this.announce(
        t('modals.shop.feedback.upgradePurchased', {
          name: title.textContent,
          level: formatNumber(newLevel),
          maxLevel: formatNumber(spec.maxLevel)
        })
      );
      this.rerenderShopKeepingFocus(`[data-upgrade-key="${upgradeKey}"]`, slotIndex);
    }
  });

  card.append(header, title, desc, buyBtn);
  return card;
}

function renderWorkshopUpgradesPane(ui, coins) {
  const grid = ui.elements.shopGrid;
  grid.replaceChildren();
  // Upgrades are bought as usual but count for nothing in neutralised runs, or partially in shotless modes:
  // say so, as text, only while such a run is active.
  appendUpgradeBaselineNote(ui, grid);

  const upgradeEntries = Object.entries(ui.gameConfig.upgrades);
  for (let slotIndex = 0; slotIndex < upgradeEntries.length; slotIndex++) {
    const [upgradeKey, spec] = upgradeEntries[slotIndex];
    grid.appendChild(buildUpgradeCard.call(ui, upgradeKey, spec, coins, slotIndex));
  }
}

function applyAmmoButtonLabel(btn, { canBuyThisType, isRunActive, isTypeAllowed, isPuzzleRun, isPuristRun, blockKey, cost }) {
  if (canBuyThisType) {
    btn.textContent = t('modals.shop.specialAmmo.buy', { cost: formatNumber(cost) });
    return;
  }
  if (isRunActive && !isTypeAllowed && !isPuzzleRun && !isPuristRun) {
    btn.textContent = t('modals.shop.specialAmmo.modeDisabled');
    btn.title = t('modals.shop.specialAmmo.modeDisabledHint');
    return;
  }
  if (blockKey) {
    btn.textContent = t('modals.shop.specialAmmo.blockedLabel');
    btn.title = t(blockKey);
    btn.setAttribute('aria-label', `${t('modals.shop.specialAmmo.blockedLabel')}. ${t(blockKey)}`);
    return;
  }
  if (isPuzzleRun) {
    btn.textContent = t('modals.shop.specialAmmo.puzzleLocked');
    btn.title = t('modals.shop.specialAmmo.puzzleLockedHint');
    return;
  }
  if (isPuristRun) {
    btn.textContent = t('modals.shop.specialAmmo.puristLocked');
    btn.title = t('modals.shop.specialAmmo.puristLockedHint');
    return;
  }
  btn.textContent = t('modals.shop.specialAmmo.unavailable');
  btn.title = t('modals.shop.specialAmmo.unavailableHint');
}

function buildAmmoCard(ui, { type, spec, cost, count, coins, slotIndex, canBuyAmmo, isPuzzleRun, isPuristRun, blockKey }) {
  const isRunActive = ui.isRunActive();
  const isTypeAllowed = ui.engine.isSpecialTypeAllowed?.(type) !== false;
  const canBuyThisType = canBuyAmmo && isTypeAllowed;

  const card = document.createElement('div');
  card.className = 'ammo-card';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'powerup-icon';
  iconSpan.style.background = specialIconBackground(spec);
  iconSpan.textContent = spec.icon;
  iconSpan.setAttribute('aria-hidden', 'true');

  const titleEl = document.createElement('div');
  titleEl.className = 'ammo-card-title';
  titleEl.textContent = t(`hud.powerups.${type}.name`);

  // What the ball does, so a purchase is not a guess on the name alone.
  const descEl = document.createElement('div');
  descEl.className = 'ammo-card-desc';
  descEl.textContent = t(`hud.powerups.${type}.tooltip`);

  const stockEl = document.createElement('div');
  stockEl.className = 'ammo-card-stock';
  stockEl.textContent = t('modals.shop.specialAmmo.stock', { count: formatNumber(count) });

  const buyAmmoBtn = document.createElement('button');
  buyAmmoBtn.type = 'button';
  buyAmmoBtn.className = 'modal-btn primary ammo-buy-btn';
  buyAmmoBtn.dataset.specialType = type;
  buyAmmoBtn.dataset.slotIndex = String(slotIndex);
  buyAmmoBtn.disabled = !canBuyThisType || coins < cost;
  buyAmmoBtn.classList.toggle('unavailable', !canBuyThisType);
  applyAmmoButtonLabel(buyAmmoBtn, {
    canBuyThisType,
    isRunActive,
    isTypeAllowed,
    isPuzzleRun,
    isPuristRun,
    blockKey,
    cost
  });

  buyAmmoBtn.addEventListener('click', () => {
    if (ui.engine.buySpecialAmmo(type)) {
      const newCount = ui.engine.specialInventory[type] || 0;
      ui.announce(
        t('modals.shop.feedback.ammoPurchased', {
          name: titleEl.textContent,
          count: formatNumber(newCount)
        })
      );
      ui.rerenderShopKeepingFocus(`.ammo-buy-btn[data-special-type="${type}"]`, slotIndex);
    }
  });

  card.append(iconSpan, titleEl, descEl, stockEl, buyAmmoBtn);
  return card;
}

function renderWorkshopAmmoPane(ui, coins) {
  if (!ui.elements.shopAmmoGrid || !ui.gameConfig.specialShopCosts) {
    return;
  }
  const ammoGrid = ui.elements.shopAmmoGrid;
  ammoGrid.replaceChildren();
  // Ammo is stocked into the current run, so it cannot be bought between runs or in Puzzle mode.
  const isPuzzleRun = ui.engine.mode === GAME_MODES.PUZZLE && ui.isRunActive();
  const isPuristRun = ui.isRunActive() && !isPuzzleRun && ui.engine.offersSpecialBalls?.() === false;
  const canBuyAmmo = typeof ui.canBuySpecialAmmo === 'function'
    ? ui.canBuySpecialAmmo()
    : ui.isRunActive() && !isPuzzleRun && !isPuristRun;
  const blockKey = typeof ui.getSpecialAmmoBlockReasonKey === 'function' ? ui.getSpecialAmmoBlockReasonKey() : null;

  for (let slotIndex = 0; slotIndex < SPECIAL_TYPES_ORDER.length; slotIndex++) {
    const type = SPECIAL_TYPES_ORDER[slotIndex];
    ammoGrid.appendChild(
      buildAmmoCard(ui, {
        type,
        spec: ui.ballsConfig.specialTypes[type],
        cost: ui.gameConfig.specialShopCosts[type],
        count: ui.engine.specialInventory[type] || 0,
        coins,
        slotIndex,
        canBuyAmmo,
        isPuzzleRun,
        isPuristRun,
        blockKey
      })
    );
  }
}

function buildBallStyleCard(ui, styleId, spec, activeStyle, coins, slotIndex) {
  const isUnlocked = Boolean(ui.storageManager.isBallStyleUnlocked?.(styleId));
  const isActive = activeStyle === styleId;
  const cost = spec.cost || 0;

  const card = document.createElement('div');
  card.className = `level-card ${isUnlocked ? 'unlocked' : ''}`.trim();

  const header = document.createElement('div');
  header.className = 'level-card-header';
  if (isActive) {
    header.textContent = t('modals.shop.styles.equipped');
  } else if (isUnlocked || cost <= 0) {
    header.textContent = t('modals.shop.styles.unlocked');
  } else {
    header.textContent = t('modals.shop.styles.cost', { cost: formatNumber(cost) });
  }

  const styleName = t(`modals.shop.styles.items.${styleId}.name`);
  const previewOrb = document.createElement('span');
  previewOrb.className = `style-preview-orb style-preview-${styleId}`;
  previewOrb.setAttribute('aria-hidden', 'true');
  const title = document.createElement('div');
  title.className = 'level-card-title style-card-title';
  const titleText = document.createElement('span');
  titleText.textContent = `${spec.icon || ''} ${styleName}`.trim();
  title.append(previewOrb, titleText);

  const desc = document.createElement('div');
  desc.className = 'level-card-desc';
  desc.textContent = t(`modals.shop.styles.items.${styleId}.description`);

  if (isActive) {
    const equippedBadge = document.createElement('span');
    equippedBadge.className = 'upgrade-maxed-badge';
    equippedBadge.textContent = t('modals.shop.styles.equipped');
    card.append(header, title, desc, equippedBadge);
    return card;
  }

  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = 'modal-btn primary style-action-btn';
  actionBtn.dataset.styleId = styleId;
  actionBtn.dataset.slotIndex = String(slotIndex);

  if (isUnlocked) {
    actionBtn.textContent = t('modals.shop.styles.equip');
    actionBtn.addEventListener('click', () => {
      if (ui.storageManager.setActiveBallStyle(styleId)) {
        ui.renderer?.setBallStyle?.(styleId);
        ui.audioManager.playEffect('snap');
        ui.announce(t('modals.shop.feedback.styleEquipped', { name: styleName }));
        ui.rerenderShopKeepingFocus(`.style-action-btn[data-style-id="${styleId}"]`, slotIndex);
      }
    });
  } else {
    actionBtn.disabled = coins < cost;
    actionBtn.textContent = t('modals.shop.card.buy', { cost: formatNumber(cost) });
    actionBtn.addEventListener('click', () => {
      if (ui.storageManager.purchaseBallStyle(styleId, cost)) {
        ui.renderer?.setBallStyle?.(styleId);
        ui.engine?.unlockAchievementTiers?.('cosmeticCollector', ui.storageManager.getUnlockedCosmeticCount?.() || 0);
        ui.audioManager.playEffect('match', 2);
        ui.refresh(ui.engine, ui.lastExtra);
        ui.announce(t('modals.shop.feedback.stylePurchased', { name: styleName }));
        ui.rerenderShopKeepingFocus(`.style-action-btn[data-style-id="${styleId}"]`, slotIndex);
      }
    });
  }

  card.append(header, title, desc, actionBtn);
  return card;
}

function buildArenaThemeCard(ui, themeId, spec, activeTheme, coins, slotIndex) {
  const isUnlocked = ui.storageManager.isArenaThemeUnlocked?.(themeId) ?? (themeId === ARENA_THEMES.DEEP_SPACE);
  const isActive = activeTheme === themeId;
  const cost = spec.cost || 0;
  const themeName = t(`modals.shop.arenaThemes.items.${themeId}.name`);

  const card = document.createElement('div');
  card.className = `upgrade-card style-card${isActive ? ' active-style' : ''}`;

  const header = document.createElement('div');
  header.className = 'upgrade-header';
  const swatch = document.createElement('span');
  swatch.className = 'arena-theme-swatch';
  swatch.dataset.arenaTheme = themeId;
  swatch.setAttribute('aria-hidden', 'true');
  const status = document.createElement('span');
  status.className = `upgrade-level${isActive ? ' style-status-active' : ''}`;
  status.textContent = isActive
    ? t('modals.shop.styles.equipped')
    : isUnlocked
      ? t('modals.shop.styles.unlocked')
      : t('modals.shop.styles.cost', { cost: formatNumber(cost) });
  header.append(swatch, status);

  const title = document.createElement('div');
  title.className = 'upgrade-title';
  title.textContent = themeName;

  const desc = document.createElement('div');
  desc.className = 'upgrade-desc';
  desc.textContent = t(`modals.shop.arenaThemes.items.${themeId}.description`);

  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = `modal-btn style-action-btn${isActive ? '' : ' primary'}`;
  actionBtn.dataset.arenaThemeId = themeId;
  if (isActive) {
    actionBtn.textContent = t('modals.shop.styles.equipped');
    actionBtn.disabled = true;
  } else if (isUnlocked) {
    actionBtn.textContent = t('modals.shop.styles.equip');
    actionBtn.addEventListener('click', () => {
      if (ui.storageManager.setActiveArenaTheme?.(themeId)) {
        ui.renderer?.setArenaTheme?.(themeId);
        ui.audioManager.playEffect('snap');
        ui.announce(t('modals.shop.feedback.arenaThemeEquipped', { name: themeName }));
        ui.rerenderShopKeepingFocus(`.style-action-btn[data-arena-theme-id="${themeId}"]`, slotIndex);
      }
    });
  } else {
    actionBtn.textContent = t('modals.shop.styles.cost', { cost: formatNumber(cost) });
    actionBtn.disabled = coins < cost;
    actionBtn.addEventListener('click', () => {
      if (ui.storageManager.purchaseArenaTheme?.(themeId, cost)) {
        ui.renderer?.setArenaTheme?.(themeId);
        ui.engine?.unlockAchievementTiers?.('cosmeticCollector', ui.storageManager.getUnlockedCosmeticCount?.() || 0);
        ui.audioManager.playEffect('match', 2);
        ui.refresh(ui.engine, ui.lastExtra);
        ui.announce(t('modals.shop.feedback.arenaThemePurchased', { name: themeName }));
        ui.rerenderShopKeepingFocus(`.style-action-btn[data-arena-theme-id="${themeId}"]`, slotIndex);
      }
    });
  }
  card.append(header, title, desc, actionBtn);
  return card;
}

function buildLaserTrailCard(ui, trailId, spec, activeTrail, coins, slotIndex) {
  const isUnlocked = ui.storageManager.isLaserTrailUnlocked?.(trailId) ?? (trailId === LASER_TRAILS.CLASSIC);
  const isActive = activeTrail === trailId;
  const cost = spec.cost || 0;
  const trailName = t(`modals.shop.laserTrails.items.${trailId}.name`);

  const card = document.createElement('div');
  card.className = `upgrade-card style-card${isActive ? ' active-style' : ''}`;

  const header = document.createElement('div');
  header.className = 'upgrade-header';
  const swatch = document.createElement('span');
  swatch.className = 'laser-trail-swatch';
  swatch.dataset.laserTrail = trailId;
  swatch.setAttribute('aria-hidden', 'true');
  const status = document.createElement('span');
  status.className = `upgrade-level${isActive ? ' style-status-active' : ''}`;
  status.textContent = isActive
    ? t('modals.shop.styles.equipped')
    : isUnlocked
      ? t('modals.shop.styles.unlocked')
      : t('modals.shop.styles.cost', { cost: formatNumber(cost) });
  header.append(swatch, status);

  const title = document.createElement('div');
  title.className = 'upgrade-title';
  title.textContent = trailName;
  const desc = document.createElement('div');
  desc.className = 'upgrade-desc';
  desc.textContent = t(`modals.shop.laserTrails.items.${trailId}.description`);

  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = `modal-btn style-action-btn${isActive ? '' : ' primary'}`;
  actionBtn.dataset.laserTrailId = trailId;
  if (isActive) {
    actionBtn.textContent = t('modals.shop.styles.equipped');
    actionBtn.disabled = true;
  } else if (isUnlocked) {
    actionBtn.textContent = t('modals.shop.styles.equip');
    actionBtn.addEventListener('click', () => {
      if (ui.storageManager.setActiveLaserTrail?.(trailId)) {
        ui.renderer?.setLaserTrail?.(trailId);
        ui.audioManager.playEffect('snap');
        ui.announce(t('modals.shop.feedback.laserTrailEquipped', { name: trailName }));
        ui.rerenderShopKeepingFocus(`.style-action-btn[data-laser-trail-id="${trailId}"]`, slotIndex);
      }
    });
  } else {
    actionBtn.textContent = t('modals.shop.styles.cost', { cost: formatNumber(cost) });
    actionBtn.disabled = coins < cost;
    actionBtn.addEventListener('click', () => {
      if (ui.storageManager.purchaseLaserTrail?.(trailId, cost)) {
        ui.renderer?.setLaserTrail?.(trailId);
        ui.engine?.unlockAchievementTiers?.('cosmeticCollector', ui.storageManager.getUnlockedCosmeticCount?.() || 0);
        ui.audioManager.playEffect('match', 2);
        ui.refresh(ui.engine, ui.lastExtra);
        ui.announce(t('modals.shop.feedback.laserTrailPurchased', { name: trailName }));
        ui.rerenderShopKeepingFocus(`.style-action-btn[data-laser-trail-id="${trailId}"]`, slotIndex);
      }
    });
  }
  card.append(header, title, desc, actionBtn);
  return card;
}

function appendStyleGroup(grid, order, catalog, buildCard, slotIndex) {
  let nextSlot = slotIndex;
  if (!catalog) {
    return nextSlot;
  }
  for (const id of order) {
    if (catalog[id]) {
      grid.appendChild(buildCard(id, catalog[id], nextSlot++));
    }
  }
  return nextSlot;
}

function renderWorkshopStylesPane(ui, coins) {
  if (!ui.elements.shopStylesGrid || !ui.ballsConfig?.styles) {
    return;
  }
  const stylesGrid = ui.elements.shopStylesGrid;
  stylesGrid.replaceChildren();
  const activeStyle = ui.storageManager.getActiveBallStyle?.() || BALL_STYLES.CLASSIC;
  const activeTheme = ui.storageManager.getActiveArenaTheme?.() || ARENA_THEMES.DEEP_SPACE;
  const activeTrail = ui.storageManager.getActiveLaserTrail?.() || LASER_TRAILS.CLASSIC;
  let slot = 0;
  slot = appendStyleGroup(stylesGrid, BALL_STYLES_ORDER, ui.ballsConfig.styles, (id, spec, idx) => buildBallStyleCard(ui, id, spec, activeStyle, coins, idx), slot);
  slot = appendStyleGroup(stylesGrid, ARENA_THEMES_ORDER, ui.gameConfig?.arenaThemes, (id, spec, idx) => buildArenaThemeCard(ui, id, spec, activeTheme, coins, idx), slot);
  appendStyleGroup(stylesGrid, LASER_TRAILS_ORDER, ui.gameConfig?.laserTrails, (id, spec, idx) => buildLaserTrailCard(ui, id, spec, activeTrail, coins, idx), slot);
}

const ACHIEVEMENT_LIVE_MODE_RECORDS = Object.freeze([
  ['hexGridWave', 'getHexGridBestWave', GAME_MODES.HEX_GRID, 'waveCount'],
  ['orbitalWave', 'getOrbitalBestWave', GAME_MODES.ORBITAL, 'waveCount'],
  ['pinballStage', 'getPinballBestStage', GAME_MODES.PINBALL, 'pinballStage'],
  ['convoyWave', 'getConvoyBestWave', GAME_MODES.CONVOY, 'waveCount'],
  ['mergeTier', 'getMergeBestTier', GAME_MODES.MERGE, 'mergeBestTier'],
  ['slingshotStage', 'getSlingshotBestStage', GAME_MODES.SLINGSHOT, 'slingshotStage']
]);

const ACHIEVEMENT_RECORD_COPIES = Object.freeze([
  ['endlessWave', null],
  ['maxAvalanche', null],
  ['bossesDestroyed', 'bossesDestroyedInRun'],
  ['shotsRemainingOnClear', null],
  ['magnetarsGrounded', null],
  ['magnetarLandslide', null]
]);

function readNonNegative(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function buildAchievementProgressContext(ui) {
  const { storageManager, engine } = ui;
  const persistedRecords = storageManager.getAchievementRecords?.() ?? {};
  const liveEndlessWave = engine.mode === GAME_MODES.ENDLESS ? readNonNegative(engine.waveCount) : 0;
  const context = {
    maxCombo: Math.max(
      readNonNegative(persistedRecords.maxCombo),
      readNonNegative(engine.combo),
      readNonNegative(engine.maxComboInRound),
      readNonNegative(engine.currentComboChain)
    ),
    totalStars: storageManager.getTotalStars(),
    fluxStage: readNonNegative(storageManager.getFluxBestStage?.()),
    bossRushWave: readNonNegative(storageManager.getBossRushBestWave?.()),
    unlockedLevel: storageManager.getUnlockedLevel(),
    campaignLevelCount: engine.levelCatalog.count
  };
  for (const [key, engineField] of ACHIEVEMENT_RECORD_COPIES) {
    const persisted = readNonNegative(persistedRecords[key]);
    const live = engineField ? readNonNegative(engine[engineField]) : 0;
    context[key] = Math.max(persisted, live);
  }
  context.endlessWave = Math.max(context.endlessWave, liveEndlessWave);
  for (const [contextKey, storageMethod, modeKey, liveField] of ACHIEVEMENT_LIVE_MODE_RECORDS) {
    const stored = readNonNegative(storageManager[storageMethod]?.());
    const live = engine.mode === modeKey ? readNonNegative(engine[liveField]) : 0;
    context[contextKey] = Math.max(stored, live);
  }
  return context;
}

function fillAchievementTierRow(tierRow, tiers, unlockedMap) {
  tierRow.className = 'achievement-tiers';
  tierRow.setAttribute('role', 'list');
  for (const { id, spec, tier } of tiers) {
    const isTierUnlocked = Boolean(unlockedMap[id]);
    const badge = document.createElement('span');
    badge.className = `achievement-tier-badge tier-${tier} ${isTierUnlocked ? 'is-unlocked' : 'is-locked'}`;
    badge.setAttribute('role', 'listitem');
    badge.textContent = t(`modals.shop.achievements.tier.${tier}`);
    badge.title = t(
      isTierUnlocked ? 'modals.shop.achievements.tierUnlockedAria' : 'modals.shop.achievements.tierLockedAria',
      { tier: t(`modals.shop.achievements.tier.${tier}`), target: formatNumber(spec.threshold || 1) }
    );
    badge.setAttribute('aria-label', badge.title);
    tierRow.appendChild(badge);
  }
}

function buildAchievementFamilyCard(family, unlockedMap, progressContext) {
  const { tiers } = family;
  const unlockedTierCount = tiers.filter(({ id }) => Boolean(unlockedMap[id])).length;
  const nextTier = tiers.find(({ id }) => !unlockedMap[id]) || null;
  const shown = nextTier || tiers[tiers.length - 1];
  const isComplete = nextTier === null;
  const baseTier = tiers[0];
  const progress = computeAchievementProgress(shown.id, shown.spec, isComplete, progressContext);
  const { current, target } = progress;
  // A per-run record already past a locked tier was set before the tier existed (or
  // before it was reachable): it does not count, so say so instead of showing a full bar.
  // Cumulative families (stars) keep their bar: the next victory pays them.
  const isRecordPastTarget = !isComplete && !shown.spec.cumulative && current >= target;
  const pct = isRecordPastTarget ? 0 : progress.pct;

  const card = document.createElement('div');
  card.className = `level-card achievement-family ${isComplete ? 'unlocked' : 'locked'}`;
  card.dataset.family = family.familyId;

  const header = document.createElement('div');
  header.className = 'level-card-header';
  header.textContent = t('modals.shop.achievements.reward', { coins: formatNumber(shown.spec.rewardCoins) });

  const title = document.createElement('div');
  title.className = 'level-card-title';
  title.textContent = t(`modals.shop.achievements.items.${baseTier.id}.name`);

  let tierRow = null;
  if (tiers.length > 1) {
    tierRow = document.createElement('div');
    fillAchievementTierRow(tierRow, tiers, unlockedMap);
  }

  const desc = document.createElement('div');
  desc.className = 'level-card-desc';
  desc.textContent = formatAchievementDescription(shown.id, shown.spec);

  const progressTrack = document.createElement('div');
  progressTrack.className = 'achievement-progress-track';
  progressTrack.setAttribute('aria-hidden', 'true');
  const progressFill = document.createElement('div');
  progressFill.className = 'achievement-progress-fill';
  progressFill.style.width = `${pct}%`;
  progressTrack.appendChild(progressFill);

  const footer = document.createElement('div');
  footer.className = 'level-card-footer';
  const statusEl = document.createElement('span');
  statusEl.className = isComplete ? 'achievement-unlocked-badge' : 'level-locked-badge';
  statusEl.textContent = isComplete
    ? t('modals.shop.achievements.unlockedBadge')
    : t('modals.shop.achievements.lockedBadge');
  footer.appendChild(statusEl);
  if (!isComplete) {
    const progressText = document.createElement('span');
    progressText.className = 'achievement-progress-text';
    progressText.textContent = isRecordPastTarget
      ? t('modals.shop.achievements.reachAgain')
      : t('modals.shop.achievements.progress', {
        current: formatNumber(current),
        target: formatNumber(target)
      });
    footer.appendChild(progressText);
  }

  card.append(header, title);
  if (tierRow) {
    card.appendChild(tierRow);
  }
  card.append(desc, progressTrack, footer);
  return { card, unlockedTierCount };
}

function renderWorkshopAchievementsPane(ui) {
  if (!ui.elements.achievementsGrid || !ui.gameConfig.achievements) {
    return;
  }
  const achGrid = ui.elements.achievementsGrid;
  achGrid.replaceChildren();
  const unlockedMap = ui.storageManager.getUnlockedAchievements();
  const achEntries = Object.entries(ui.gameConfig.achievements);
  const progressContext = buildAchievementProgressContext(ui);
  let unlockedCount = 0;

  for (const family of groupAchievementTiers(achEntries)) {
    const { card, unlockedTierCount } = buildAchievementFamilyCard(family, unlockedMap, progressContext);
    unlockedCount += unlockedTierCount;
    achGrid.appendChild(card);
  }

  if (ui.elements.tabShopAchievements) {
    ui.elements.tabShopAchievements.textContent = t('modals.shop.tabs.achievements', {
      unlocked: unlockedCount,
      total: achEntries.length
    });
  }
}

/**
 * Renders the Workshop upgrades, in-run special ammo refills, and achievements panes.
 * @this {import('./UIManager.js').UIManager}
 */
export function renderWorkshopContents() {
  const coins = this.storageManager.getCoins();
  this.elements.shopBalance.textContent = t('modals.shop.balance.label', { coins: formatNumber(coins) });

  renderWorkshopUpgradesPane(this, coins);
  renderWorkshopAmmoPane(this, coins);
  renderWorkshopStylesPane(this, coins);
  renderWorkshopAchievementsPane(this);
}