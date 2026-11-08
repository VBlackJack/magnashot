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

import test from 'node:test';
import assert from 'node:assert/strict';
import { UIManager } from '../src/ui/UIManager.js';

/** The public surface of UIManager.prototype, captured before the UI manager was split into modules. */
const EXPECTED_PROTOTYPE_NAMES = [
  'announce',
  'announceSagChanges',
  'hideSagMeter',
  'refreshSagMeter',
  'bindStatsEvents',
  'buildStatsRecords',
  'buildStatsText',
  'copyPlayerStats',
  'createStatsDetail',
  'createStatsTerm',
  'getModeAccess',
  'getStatsModeOrder',
  'getStatsTabs',
  'getWeeklyButtonLabel',
  'getWeeklyFluxBestScore',
  'openStatsModal',
  'refreshModeLocks',
  'refreshStatsIfOpen',
  'renderDailyHistory',
  'renderStatsOverview',
  'runIfModeUnlocked',
  'showModeLockHint',
  'startWeeklyFluxRun',
  'switchStatsTab',
  'updateCopyStatsButtonLabel',
  'applyCanvasLayoutVariables',
  'applyInputMode',
  'applyModeLockState',
  'applyToggleState',
  'bindDrawerEvents',
  'bindEvents',
  'bindInstallEvents',
  'buildCodexPane',
  'buildPowerupButtons',
  'buildVictoryStars',
  'canBuySpecialAmmo',
  'centerActiveChapter',
  'closeDrawer',
  'closeOverlayModal',
  'constructor',
  'cycleAnimationSpeed',
  'detectInitialInputMode',
  'dismissConfirm',
  'ensureDrawerStarParts',
  'focusInTopModal',
  'formatChapterName',
  'formatChapterTheme',
  'formatFluxShapeName',
  'formatGameOverStageSummary',
  'formatLauncherLabel',
  'formatLevelDescription',
  'formatLevelName',
  'formatStars',
  'formatVictoryScoreText',
  'getActiveTopModal',
  'getAffordableUpgradeCount',
  'getLevelsModalInitialFocus',
  'getModalsByPriority',
  'getOwnedWorkshopLevelSum',
  'getOverlayModals',
  'getPowerupAriaLabel',
  'getShopTabs',
  'getSpecialAmmoBlockReasonKey',
  'getSuggestedLevelId',
  'getSuggestedPuzzleStage',
  'getVictoryTargetOptions',
  'handleKeyDown',
  'hideAllModals',
  'init',
  'isAnyModalOpen',
  'isAnyOverlayModalOpen',
  'isCampaignRunActive',
  'isDrawerLayout',
  'isFluxPerkModalTop',
  'isFullscreenDisplayMode',
  'isRunActive',
  'isRunHeldByUi',
  'isRunOpenToAmmo',
  'keepFocusInTopModal',
  'openDrawer',
  'openLevelsModal',
  'openOverlayModal',
  'openShopModal',
  'promptInstall',
  'refresh',
  'renderLevelCards',
  'renderLevelChapters',
  'renderPuzzleStagesStrip',
  'renderShopContents',
  'renderStarGlyphs',
  'requestDestructiveAction',
  'requestTiltOnFirstTap',
  'rerenderShopKeepingFocus',
  'retrySameFluxSeed',
  'saveLastFocusedElement',
  'selectLevelChapter',
  'setInputMode',
  'setLauncherButton',
  'setTiltActive',
  'setupFullscreenControl',
  'setupTiltControl',
  'shareRunResult',
  'shareRunResultOnce',
  'showLockedLevelHint',
  'showShareFallback',
  'startDailyCountdown',
  'startScoreCountUp',
  'stopDailyCountdown',
  'stopScoreCountUp',
  'submitFluxSeedInput',
  'switchShopTab',
  'syncDrawerState',
  'syncDrawerStats',
  'syncInstallControls',
  'syncLevelsFilterButton',
  'syncModalInertState',
  'syncShopAmmoAvailability',
  'toggleFullscreen',
  'trapFocusWithin',
  'trapModalFocus',
  'updateAimState',
  'updateAnimSpeedButton',
  'updateConfirmButtonLabel',
  'updateContrastButton',
  'updateDailyCountdownText',
  'updateDiscoveryPulse',
  'updateFullscreenButton',
  'updateHintReplayButton',
  'updateInputHints',
  'updateLanguageButton',
  'updateLevelIntro',
  'updateMotionButton',
  'updateNextLevelButton',
  'updatePatternsButton',
  'updatePowerupButtons',
  'updateResetHintsFeedback',
  'updateShareButtonLabel',
  'updateSoundButton',
  'updateStarMeter',
  'updateTiltButton'
];

test('UIManager.prototype exposes exactly the same members after the module split', () => {
  const actual = Object.getOwnPropertyNames(UIManager.prototype).sort();
  assert.deepEqual(actual, [...EXPECTED_PROTOTYPE_NAMES].sort());
});

test('every UIManager method keeps its original descriptor shape', () => {
  for (const name of EXPECTED_PROTOTYPE_NAMES) {
    if (name === 'constructor') {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(UIManager.prototype, name);
    assert.equal(typeof descriptor.value, 'function', name + ' is a function');
    assert.equal(descriptor.enumerable, false, name + ' is not enumerable');
    assert.equal(descriptor.writable, true, name + ' is writable');
    assert.equal(descriptor.configurable, true, name + ' is configurable');
  }
});
