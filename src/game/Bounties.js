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

import { MATH_CONSTANTS } from '../core/Constants.js';
import { formatNumber, t } from '../core/I18n.js';

export { pickDailyBounties, normalizeBountiesState, advanceBountiesState } from '../core/BountiesStore.js';

/**
 * Reports an in-game bounty event from an active engine without polluting Versus or restores.
 * @param {object} engine - GameEngine instance.
 * @param {string} eventKey - Bounty event key.
 * @param {number} [amount=1] - Progress increment.
 * @returns {Array<object>} Newly completed bounties.
 */
export function reportBountyEvent(engine, eventKey, amount = 1) {
  if (!engine || engine.isVersusRole || engine.isRestoringRun || !eventKey) {
    return [];
  }
  const completed = engine.storageManager?.recordBountyProgress?.(eventKey, amount) || [];
  if (completed.length === 0) {
    return [];
  }
  const coinsTotal = completed.reduce((sum, item) => sum + (item.coins || 0), 0);
  const labelList = completed
    .map((item) => t(`modals.play.bounties.items.${item.id}.title`, { target: formatNumber(item.target) }))
    .join(t('gameplay.feedback.achievement.listSeparator'));
  engine.audioManager?.playEffect('achievement');
  const canvasCfg = engine.gameConfig?.canvas;
  if (canvasCfg && engine.particleSystem?.spawnFloatingText) {
    engine.particleSystem.spawnFloatingText(
      canvasCfg.logicalWidth * MATH_CONSTANTS.HALF,
      canvasCfg.launcherY + canvasCfg.anvilPopupOffsetY,
      t('gameplay.feedback.bounty.completed', { name: labelList, coins: formatNumber(coinsTotal) }),
      engine.gameConfig.theme?.coinPopupColor
    );
  }
  engine.notifyUI?.({ completedBounties: completed });
  return completed;
}
