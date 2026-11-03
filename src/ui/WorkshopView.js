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

import { GAME_MODES, SPECIAL_TYPES_ORDER } from '../core/Constants.js';
import { t, formatNumber } from '../core/I18n.js';
import { specialIconBackground } from './CodexView.js';
import { filterFocusTrapCandidates } from './UIManager.js';

/** Percent scale of the HUD gauges (star progress, overcharge, tutorial offset, achievements). */
const FULL_PERCENT = 100;
export { FULL_PERCENT };

/** Workshop tab names. */
export const SHOP_TABS = Object.freeze({
  UPGRADES: 'upgrades',
  AMMO: 'ammo',
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
  const threshold = Number.isFinite(achSpec?.threshold) && achSpec.threshold > 0 ? achSpec.threshold : null;
  let target = threshold ?? 1;
  let rawCurrent = 0;
  if (achId === 'comboMaster' || achSpec?.minChain) {
    target = achSpec?.minChain ?? threshold ?? 1;
    rawCurrent = progressContext.maxCombo || 0;
  } else if (achId === 'starCollector' || achSpec?.targetStars) {
    target = achSpec?.targetStars ?? threshold ?? 1;
    rawCurrent = progressContext.totalStars || 0;
  } else if (achId === 'survivorWave10' || achId === 'endlessSurvivor' || achSpec?.targetWave) {
    target = achSpec?.targetWave ?? threshold ?? 1;
    rawCurrent = progressContext.endlessWave || 0;
  } else if (achId === 'bossSlayer') {
    rawCurrent = progressContext.bossesDestroyed || 0;
  } else if (achId === 'firstAvalanche') {
    rawCurrent = progressContext.maxAvalanche || 0;
  } else if (achId === 'sharpshooter') {
    rawCurrent = progressContext.shotsRemainingOnClear || 0;
  } else if (achId === 'campaignComplete') {
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
      shots: formatNumber(spec.shotsPerLevel || 0)
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
    buyBtn.disabled = coins < cost;
    buyBtn.textContent = t('modals.shop.card.buy', { cost: formatNumber(cost) });

    buyBtn.addEventListener('click', () => {
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
    // Ammo is stocked into the current run, so it cannot be bought between runs.
    const canBuyAmmo = this.isRunActive();
    for (let slotIndex = 0; slotIndex < SPECIAL_TYPES_ORDER.length; slotIndex++) {
      const type = SPECIAL_TYPES_ORDER[slotIndex];
      const spec = this.ballsConfig.specialTypes[type];
      const cost = this.gameConfig.specialShopCosts[type];
      const count = this.engine.specialInventory[type] || 0;

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
      buyAmmoBtn.disabled = !canBuyAmmo || coins < cost;
      buyAmmoBtn.classList.toggle('unavailable', !canBuyAmmo);
      if (canBuyAmmo) {
        buyAmmoBtn.textContent = t('modals.shop.specialAmmo.buy', { cost: formatNumber(cost) });
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
      unlockedLevel: this.storageManager.getUnlockedLevel(),
      campaignLevelCount: this.engine.levelCatalog.count
    };
    let unlockedCount = 0;

    for (const [achId, achSpec] of achEntries) {
      const isUnlocked = Boolean(unlockedMap[achId]);
      if (isUnlocked) {
        unlockedCount++;
      }
      const { current, target, pct } = computeAchievementProgress(achId, achSpec, isUnlocked, progressContext);
      const card = document.createElement('div');
      card.className = `level-card ${isUnlocked ? 'unlocked' : 'locked'}`;

      const header = document.createElement('div');
      header.className = 'level-card-header';
      header.textContent = t('modals.shop.achievements.reward', { coins: achSpec.rewardCoins });

      const title = document.createElement('div');
      title.className = 'level-card-title';
      title.textContent = t(`modals.shop.achievements.items.${achId}.name`);

      const desc = document.createElement('div');
      desc.className = 'level-card-desc';
      desc.textContent = t(`modals.shop.achievements.items.${achId}.description`);

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
      statusEl.className = isUnlocked ? 'achievement-unlocked-badge' : 'level-locked-badge';
      statusEl.textContent = isUnlocked
        ? t('modals.shop.achievements.unlockedBadge')
        : t('modals.shop.achievements.lockedBadge');
      footer.appendChild(statusEl);
      if (!isUnlocked) {
        const progressText = document.createElement('span');
        progressText.className = 'achievement-progress-text';
        progressText.textContent = t('modals.shop.achievements.progress', {
          current: formatNumber(current),
          target: formatNumber(target)
        });
        footer.appendChild(progressText);
      }

      card.append(header, title, desc, progressTrack, footer);
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
