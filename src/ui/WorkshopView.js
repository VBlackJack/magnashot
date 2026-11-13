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

import { BALL_STYLES, BALL_STYLES_ORDER, GAME_MODES, SPECIAL_TYPES_ORDER } from '../core/Constants.js';
import { t, formatNumber } from '../core/I18n.js';
import { specialIconBackground } from './CodexView.js';
import { filterFocusTrapCandidates } from './UIHelpers.js';

/** Percent scale of the HUD gauges (star progress, overcharge, tutorial offset, achievements). */
const FULL_PERCENT = 100;

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
  let target = threshold ?? 1;
  let rawCurrent = 0;
  if (familyId === 'comboMaster' || achSpec?.minChain) {
    target = achSpec?.minChain ?? threshold ?? 1;
    rawCurrent = progressContext.maxCombo || 0;
  } else if (familyId === 'starCollector' || achSpec?.targetStars) {
    target = achSpec?.targetStars ?? threshold ?? 1;
    rawCurrent = progressContext.totalStars || 0;
  } else if (familyId === 'survivorWave10' || familyId === 'endlessSurvivor' || achSpec?.targetWave) {
    target = achSpec?.targetWave ?? threshold ?? 1;
    rawCurrent = progressContext.endlessWave || 0;
  } else if (familyId === 'bossSlayer') {
    rawCurrent = progressContext.bossesDestroyed || 0;
  } else if (familyId === 'firstAvalanche') {
    rawCurrent = progressContext.maxAvalanche || 0;
  } else if (familyId === 'sharpshooter') {
    rawCurrent = progressContext.shotsRemainingOnClear || 0;
  } else if (familyId === 'fluxShapes') {
    rawCurrent = progressContext.fluxStage || 0;
  } else if (familyId === 'bossRushWaves') {
    rawCurrent = progressContext.bossRushWave || 0;
  } else if (familyId === 'hexGridWaves') {
    rawCurrent = progressContext.hexGridWave || 0;
  } else if (familyId === 'orbitalWaves') {
    rawCurrent = progressContext.orbitalWave || 0;
  } else if (familyId === 'pinballStages') {
    rawCurrent = progressContext.pinballStage || 0;
  } else if (familyId === 'convoyWaves') {
    rawCurrent = progressContext.convoyWave || 0;
  } else if (familyId === 'mergeTiers') {
    rawCurrent = progressContext.mergeTier || 0;
  } else if (familyId === 'campaignComplete') {
    target = Math.max(1, progressContext.campaignLevelCount || 1);
    rawCurrent = Math.max(0, (progressContext.unlockedLevel || 1) - 1);
  }
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

/**
 * Renders the Workshop upgrades, in-run special ammo refills, and achievements panes.
 * @this {import('./UIManager.js').UIManager}
 */
export function renderWorkshopContents() {
  const coins = this.storageManager.getCoins();
  this.elements.shopBalance.textContent = t('modals.shop.balance.label', { coins: formatNumber(coins) });
  const grid = this.elements.shopGrid;
  grid.replaceChildren();

  // Upgrades are bought as usual but count for nothing in neutralised runs, or partially in shotless modes:
  // say so, as text, only while such a run is active.
  const isNeutralised = this.engine.areUpgradesNeutralised();
  const isShotlessActive = !isNeutralised && this.engine.usesShotBudget?.() === false;
  if (this.isRunActive() && (isNeutralised || isShotlessActive)) {
    const baselineNote = document.createElement('p');
    baselineNote.className = 'levels-empty-filter';
    baselineNote.setAttribute('role', 'note');
    baselineNote.textContent = t(
      isNeutralised
        ? (BASELINE_NOTE_KEYS[this.engine.mode] || 'modals.shop.upgrades.dailyBaselineNote')
        : (SHOTLESS_NOTE_KEYS[this.engine.mode] || 'modals.shop.upgrades.arcadeShotlessNote')
    );
    grid.appendChild(baselineNote);
  }

  const upgradeEntries = Object.entries(this.gameConfig.upgrades);
  for (let slotIndex = 0; slotIndex < upgradeEntries.length; slotIndex++) {
    const [upgradeKey, spec] = upgradeEntries[slotIndex];
    const currentLevel = this.storageManager.getUpgradeLevel(upgradeKey);
    const isMaxed = currentLevel >= spec.maxLevel;
    const cost = this.storageManager.getUpgradeCost(upgradeKey);

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
      const maxedBadge = document.createElement('span');
      maxedBadge.className = 'upgrade-maxed-badge';
      const maxedGlyph = document.createElement('span');
      maxedGlyph.setAttribute('aria-hidden', 'true');
      maxedGlyph.textContent = t('modals.shop.card.maxed');
      const maxedText = document.createElement('span');
      maxedText.className = 'visually-hidden';
      maxedText.textContent = t('modals.shop.card.maxedAria');
      maxedBadge.append(maxedGlyph, maxedText);
      card.append(header, title, desc, maxedBadge);
      grid.appendChild(card);
      continue;
    }

    const buyBtn = document.createElement('button');
    buyBtn.type = 'button';
    buyBtn.className = 'modal-btn primary';
    buyBtn.dataset.upgradeKey = upgradeKey;
    buyBtn.dataset.slotIndex = String(slotIndex);
    // A bonus that changes the run waits until the run can be stored with its debit.
    const upgradeBlocked = this.engine.canBuyUpgrade?.(upgradeKey) === false;
    const upgradeBlockKey = upgradeBlocked ? this.getSpecialAmmoBlockReasonKey?.() : null;
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
    grid.appendChild(card);
  }

  if (this.elements.shopAmmoGrid && this.gameConfig.specialShopCosts) {
    const ammoGrid = this.elements.shopAmmoGrid;
    ammoGrid.replaceChildren();
    // Ammo is stocked into the current run, so it cannot be bought between runs or in Puzzle mode.
    const isPuzzleRun = this.engine.mode === GAME_MODES.PUZZLE && this.isRunActive();
    const isPuristRun =
      this.isRunActive() && !isPuzzleRun && this.engine.offersSpecialBalls?.() === false;
    const canBuyAmmo =
      typeof this.canBuySpecialAmmo === 'function'
        ? this.canBuySpecialAmmo()
        : this.isRunActive() && !isPuzzleRun && !isPuristRun;
    const blockKey = typeof this.getSpecialAmmoBlockReasonKey === 'function' ? this.getSpecialAmmoBlockReasonKey() : null;
    for (let slotIndex = 0; slotIndex < SPECIAL_TYPES_ORDER.length; slotIndex++) {
      const type = SPECIAL_TYPES_ORDER[slotIndex];
      const spec = this.ballsConfig.specialTypes[type];
      const cost = this.gameConfig.specialShopCosts[type];
      const count = this.engine.specialInventory[type] || 0;
      const isTypeAllowed = this.engine.isSpecialTypeAllowed?.(type) !== false;
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
      if (canBuyThisType) {
        buyAmmoBtn.textContent = t('modals.shop.specialAmmo.buy', { cost: formatNumber(cost) });
      } else if (this.isRunActive() && !isTypeAllowed && !isPuzzleRun && !isPuristRun) {
        buyAmmoBtn.textContent = t('modals.shop.specialAmmo.modeDisabled');
        buyAmmoBtn.title = t('modals.shop.specialAmmo.modeDisabledHint');
      } else if (blockKey) {
        buyAmmoBtn.textContent = t('modals.shop.specialAmmo.blockedLabel');
        buyAmmoBtn.title = t(blockKey);
        buyAmmoBtn.setAttribute('aria-label', `${t('modals.shop.specialAmmo.blockedLabel')}. ${t(blockKey)}`);
      } else if (isPuzzleRun) {
        buyAmmoBtn.textContent = t('modals.shop.specialAmmo.puzzleLocked');
        buyAmmoBtn.title = t('modals.shop.specialAmmo.puzzleLockedHint');
      } else if (isPuristRun) {
        buyAmmoBtn.textContent = t('modals.shop.specialAmmo.puristLocked');
        buyAmmoBtn.title = t('modals.shop.specialAmmo.puristLockedHint');
      } else {
        buyAmmoBtn.textContent = t('modals.shop.specialAmmo.unavailable');
        buyAmmoBtn.title = t('modals.shop.specialAmmo.unavailableHint');
      }

      buyAmmoBtn.addEventListener('click', () => {
        if (this.engine.buySpecialAmmo(type)) {
          const newCount = this.engine.specialInventory[type] || 0;
          this.announce(
            t('modals.shop.feedback.ammoPurchased', {
              name: titleEl.textContent,
              count: formatNumber(newCount)
            })
          );
          this.rerenderShopKeepingFocus(`.ammo-buy-btn[data-special-type="${type}"]`, slotIndex);
        }
      });

      card.append(iconSpan, titleEl, descEl, stockEl, buyAmmoBtn);
      ammoGrid.appendChild(card);
    }
  }

  if (this.elements.shopStylesGrid && this.ballsConfig?.styles) {
    const stylesGrid = this.elements.shopStylesGrid;
    stylesGrid.replaceChildren();
    const activeStyle = this.storageManager.getActiveBallStyle?.() || BALL_STYLES.CLASSIC;
    for (let slotIndex = 0; slotIndex < BALL_STYLES_ORDER.length; slotIndex++) {
      const styleId = BALL_STYLES_ORDER[slotIndex];
      const spec = this.ballsConfig.styles[styleId];
      if (!spec) {
        continue;
      }
      const isUnlocked = Boolean(this.storageManager.isBallStyleUnlocked?.(styleId));
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
        stylesGrid.appendChild(card);
        continue;
      }

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'modal-btn primary style-action-btn';
      actionBtn.dataset.styleId = styleId;
      actionBtn.dataset.slotIndex = String(slotIndex);

      if (isUnlocked) {
        actionBtn.textContent = t('modals.shop.styles.equip');
        actionBtn.addEventListener('click', () => {
          if (this.storageManager.setActiveBallStyle(styleId)) {
            this.renderer?.setBallStyle?.(styleId);
            this.audioManager.playEffect('snap');
            this.announce(t('modals.shop.feedback.styleEquipped', { name: styleName }));
            this.rerenderShopKeepingFocus(`.style-action-btn[data-style-id="${styleId}"]`, slotIndex);
          }
        });
      } else {
        actionBtn.disabled = coins < cost;
        actionBtn.textContent = t('modals.shop.card.buy', { cost: formatNumber(cost) });
        actionBtn.addEventListener('click', () => {
          if (this.storageManager.purchaseBallStyle(styleId, cost)) {
            this.renderer?.setBallStyle?.(styleId);
            this.audioManager.playEffect('match', 2);
            this.refresh(this.engine, this.lastExtra);
            this.announce(t('modals.shop.feedback.stylePurchased', { name: styleName }));
            this.rerenderShopKeepingFocus(`.style-action-btn[data-style-id="${styleId}"]`, slotIndex);
          }
        });
      }

      card.append(header, title, desc, actionBtn);
      stylesGrid.appendChild(card);
    }
  }

  if (this.elements.achievementsGrid && this.gameConfig.achievements) {
    const achGrid = this.elements.achievementsGrid;
    achGrid.replaceChildren();
    const unlockedMap = this.storageManager.getUnlockedAchievements();
    const persistedRecords = this.storageManager.getAchievementRecords?.() || {};
    const achEntries = Object.entries(this.gameConfig.achievements);
    const liveEndlessWave = this.engine.mode === GAME_MODES.ENDLESS ? this.engine.waveCount || 0 : 0;
    const progressContext = {
      maxCombo: Math.max(
        persistedRecords.maxCombo || 0,
        this.engine.combo || 0,
        this.engine.maxComboInRound || 0,
        this.engine.currentComboChain || 0
      ),
      totalStars: this.storageManager.getTotalStars(),
      endlessWave: Math.max(persistedRecords.endlessWave || 0, liveEndlessWave),
      maxAvalanche: persistedRecords.maxAvalanche || 0,
      bossesDestroyed: Math.max(
        persistedRecords.bossesDestroyed || 0,
        this.engine.bossesDestroyedInRun || 0
      ),
      shotsRemainingOnClear: persistedRecords.shotsRemainingOnClear || 0,
      fluxStage: this.storageManager.getFluxBestStage?.() || 0,
      bossRushWave: this.storageManager.getBossRushBestWave?.() || 0,
      hexGridWave: Math.max(
        this.storageManager.getHexGridBestWave?.() || 0,
        this.engine.mode === GAME_MODES.HEX_GRID ? this.engine.waveCount || 0 : 0
      ),
      orbitalWave: Math.max(
        this.storageManager.getOrbitalBestWave?.() || 0,
        this.engine.mode === GAME_MODES.ORBITAL ? this.engine.waveCount || 0 : 0
      ),
      pinballStage: Math.max(
        this.storageManager.getPinballBestStage?.() || 0,
        this.engine.mode === GAME_MODES.PINBALL ? this.engine.pinballStage || 0 : 0
      ),
      convoyWave: Math.max(
        this.storageManager.getConvoyBestWave?.() || 0,
        this.engine.mode === GAME_MODES.CONVOY ? this.engine.waveCount || 0 : 0
      ),
      mergeTier: Math.max(
        this.storageManager.getMergeBestTier?.(false) || 0,
        this.storageManager.getMergeBestTier?.(true) || 0,
        this.engine.mode === GAME_MODES.MERGE ? this.engine.mergeBestTier || 0 : 0
      ),
      unlockedLevel: this.storageManager.getUnlockedLevel(),
      campaignLevelCount: this.engine.levelCatalog.count
    };
    let unlockedCount = 0;

    for (const family of groupAchievementTiers(achEntries)) {
      const { tiers } = family;
      const unlockedTiers = tiers.filter(({ id }) => Boolean(unlockedMap[id]));
      unlockedCount += unlockedTiers.length;
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
      achGrid.appendChild(card);
    }

    if (this.elements.tabShopAchievements) {
      this.elements.tabShopAchievements.textContent = t('modals.shop.tabs.achievements', {
        unlocked: unlockedCount,
        total: achEntries.length
      });
    }
  }
}
