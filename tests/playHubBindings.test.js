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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GAME_MODES, GAME_STATES } from '../src/core/Constants.js';
import { UIManager } from '../src/ui/UIManager.js';
import { WEEKLY_ACCESS_KEY } from '../src/ui/UIHelpers.js';
import { handleLevelGridClick, handleLevelGridKeydown } from '../src/ui/UIInputBindings.js';

function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c, force) => (force === undefined ? !set.delete(c) && set.add(c) : force ? set.add(c) : set.delete(c))
  };
}

/** An element that records its listeners and can fire them. */
function makeElement(name) {
  const listeners = new Map();
  return {
    name,
    classList: makeClassList(),
    dataset: {},
    children: [],
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    querySelectorAll: () => [],
    fire(type, event = {}) {
      for (const handler of listeners.get(type) ?? []) {
        handler({ target: this, preventDefault() {}, ...event });
      }
    },
    click() {
      this.fire('click');
    },
    listenerCount: (type) => (listeners.get(type) ?? []).length
  };
}

/**
 * A UIManager whose element map hands out recording elements on demand, with every method that
 * the handlers call replaced by a logger. bindEvents() then wires the real bindings to it.
 */
function makeBoundUi({ access = {}, engineState = {} } = {}) {
  const calls = [];
  const windowListeners = new Map();
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = {
    addEventListener(type, handler) {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), handler]);
    }
  };
  globalThis.document = { addEventListener() {}, activeElement: null, hidden: false };

  const cache = new Map();
  const elements = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== 'string') {
          return undefined;
        }
        if (!cache.has(key)) {
          cache.set(key, makeElement(key));
        }
        return cache.get(key);
      }
    }
  );
  const ui = Object.create(UIManager.prototype);
  ui.elements = elements;
  ui.gameConfig = { puzzles: [{}, {}, {}], canvas: {} };
  ui.engine = {
    state: GAME_STATES.PLAYING,
    mode: GAME_MODES.CAMPAIGN,
    currentPuzzleStage: 1,
    ...engineState
  };
  for (const name of [
    'startEndlessMode',
    'startDailyChallenge',
    'startFluxRun',
    'startClassicMode',
    'startBlitzMode',
    'startBossRushMode',
    'startCascadeMode',
    'startPuzzleMode',
    'startHexGridMode',
    'startPinballMode',
    'startOrbitalMode',
    'startConvoyMode',
    'startMergeMode'
  ]) {
    ui.engine[name] = (...args) => calls.push([`engine.${name}`, ...args]);
  }
  ui.running = null;
  ui.getModeAccess = () => access;
  ui.getShopTabs = () => [];
  ui.bindStatsEvents = () => {};
  ui.getSuggestedPuzzleStage = () => 2;
  ui.getSuggestedLevelId = () => 12;
  ui.getVictoryTargetOptions = () => ({});
  ui.syncModalInertState = () => calls.push(['syncModalInertState']);
  ui.announce = (text) => calls.push(['announce', text]);
  ui.requestDestructiveAction = (run) => {
    calls.push(['confirmGate']);
    run();
  };
  ui.hideAllModals = () => calls.push(['hideAllModals']);
  ui.startWeeklyFluxRun = () => calls.push(['startWeeklyFluxRun']);
  ui.runIfModeUnlocked = (mode, start) => {
    calls.push(['gate', mode]);
    if (access[mode]?.unlocked === false) {
      return false;
    }
    start();
    return true;
  };
  ui.resumePlayHubModeIfRunning = (mode) => {
    calls.push(['resumeIfRunning', mode]);
    return ui.running === mode;
  };
  for (const name of [
    'openPlayHub',
    'openLevelsModal',
    'activatePlayHubContinue',
    'togglePlayHubDisclosure',
    'openPlayHubVersusLocal',
    'closeOverlayModal',
    'stepLevelChapter',
    'selectLevelChapter',
    'jumpToCurrentLevel',
    'syncLevelsFilterButton',
    'renderLevelTiles',
    'renderLevelDetail',
    'playSelectedLevel',
    'selectLevelTile',
    'syncPlayHubVersusLocal'
  ]) {
    ui[name] = (...args) => calls.push([name, ...args.map((arg) => (arg && arg.name ? arg.name : arg))]);
  }
  ui.isPlayHubOpen = () => ui.hubOpen === true;
  ui.bindEvents();
  const restore = () => {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
  };
  return { ui, calls, elements, windowListeners, restore };
}

function names(calls, name) {
  return calls.filter((call) => call[0] === name);
}

test('btnPlay opens the hub; Close and the backdrop close it, a click inside the card does not', () => {
  const { calls, elements, restore } = makeBoundUi();
  try {
    elements.btnPlay.fire('click');
    assert.deepEqual(names(calls, 'openPlayHub'), [['openPlayHub']]);
    elements.btnClosePlay.fire('click');
    elements.modalPlay.fire('click', { target: elements.modalPlay });
    elements.modalPlay.fire('click', { target: elements.btnPlay });
    assert.deepEqual(
      names(calls, 'closeOverlayModal').map((call) => call[1]),
      ['modalPlay', 'modalPlay'],
      'Close and the backdrop each close the hub once; the click inside does nothing'
    );
  } finally {
    restore();
  }
});

test('Campaign card, disclosure toggles and the two-player button reach the hub methods', () => {
  const { calls, elements, restore } = makeBoundUi();
  try {
    elements.btnCampaignContinue.fire('click');
    elements.btnCampaignMap.fire('click');
    elements.btnPuzzleStagesToggle.fire('click');
    elements.btnFluxSeedToggle.fire('click');
    elements.btnVersusLocalHub.fire('click');
    assert.deepEqual(calls.map((call) => call.join(':')), [
      'activatePlayHubContinue',
      'openLevelsModal',
      'togglePlayHubDisclosure:puzzle',
      'togglePlayHubDisclosure:seed',
      'openPlayHubVersusLocal'
    ]);
  } finally {
    restore();
  }
});

test('every mode card tries to resume its running mode first, then starts through its unlock gate', () => {
  const specs = [
    ['btnEndless', GAME_MODES.ENDLESS, GAME_MODES.ENDLESS, 'engine.startEndlessMode'],
    ['btnFlux', GAME_MODES.FLUX, GAME_MODES.FLUX, 'engine.startFluxRun'],
    ['btnWeekly', WEEKLY_ACCESS_KEY, WEEKLY_ACCESS_KEY, 'startWeeklyFluxRun'],
    ['btnModeClassic', GAME_MODES.CLASSIC, GAME_MODES.CLASSIC, 'engine.startClassicMode'],
    ['btnModePuzzle', GAME_MODES.PUZZLE, GAME_MODES.PUZZLE, 'engine.startPuzzleMode'],
    ['btnModeBlitz', GAME_MODES.BLITZ, GAME_MODES.BLITZ, 'engine.startBlitzMode'],
    ['btnModeBossRush', GAME_MODES.BOSS_RUSH, GAME_MODES.BOSS_RUSH, 'engine.startBossRushMode'],
    ['btnModeCascade', GAME_MODES.CASCADE, GAME_MODES.CASCADE, 'engine.startCascadeMode'],
    ['btnModeHexGrid', GAME_MODES.HEX_GRID, GAME_MODES.HEX_GRID, 'engine.startHexGridMode'],
    ['btnModePinball', GAME_MODES.PINBALL, GAME_MODES.PINBALL, 'engine.startPinballMode'],
    ['btnModeOrbital', GAME_MODES.ORBITAL, GAME_MODES.ORBITAL, 'engine.startOrbitalMode'],
    ['btnModeConvoy', GAME_MODES.CONVOY, GAME_MODES.CONVOY, 'engine.startConvoyMode'],
    ['btnModeMerge', GAME_MODES.MERGE, GAME_MODES.MERGE, 'engine.startMergeMode']
  ];
  for (const [key, runKey, gateKey, startCall] of specs) {
    const { ui, calls, elements, restore } = makeBoundUi();
    try {
      elements[key].fire('click');
      assert.deepEqual(calls.slice(0, 2), [['resumeIfRunning', runKey], ['gate', gateKey]], `${key}: resume, then gate`);
      assert.ok(names(calls, startCall).length === 1, `${key}: starts once through ${startCall}`);
      assert.ok(names(calls, 'hideAllModals').length === 1, `${key}: the hub is hidden before the start`);

      calls.length = 0;
      ui.running = runKey;
      elements[key].fire('click');
      assert.deepEqual(calls, [['resumeIfRunning', runKey]], `${key}: the running mode resumes and starts nothing`);
    } finally {
      restore();
    }
  }
});

test('the Puzzle card starts at the suggested stage', () => {
  const { calls, elements, restore } = makeBoundUi();
  try {
    elements.btnModePuzzle.fire('click');
    assert.deepEqual(names(calls, 'engine.startPuzzleMode'), [['engine.startPuzzleMode', 2]]);
  } finally {
    restore();
  }
});

test('a locked mode starts nothing: the gate judges the live access and refuses', () => {
  const { calls, elements, restore } = makeBoundUi({
    access: {
      [GAME_MODES.CLASSIC]: { unlocked: false },
      [WEEKLY_ACCESS_KEY]: { unlocked: false },
      [GAME_MODES.ENDLESS]: { unlocked: false }
    }
  });
  try {
    elements.btnModeClassic.fire('click');
    elements.btnWeekly.fire('click');
    elements.btnEndless.fire('click');
    assert.deepEqual(names(calls, 'gate').map((call) => call[1]), [GAME_MODES.CLASSIC, WEEKLY_ACCESS_KEY, GAME_MODES.ENDLESS]);
    assert.equal(names(calls, 'confirmGate').length, 0);
    assert.equal(names(calls, 'hideAllModals').length, 0);
    assert.equal(calls.filter((call) => call[0].startsWith('engine.')).length, 0);
  } finally {
    restore();
  }
});

test('Daily is always open: no unlock gate, still resumes its own running mode', () => {
  const { ui, calls, elements, restore } = makeBoundUi();
  try {
    elements.btnDaily.fire('click');
    assert.equal(names(calls, 'gate').length, 0);
    assert.equal(names(calls, 'engine.startDailyChallenge').length, 1);
    calls.length = 0;
    ui.running = GAME_MODES.DAILY;
    elements.btnDaily.fire('click');
    assert.deepEqual(calls, [['resumeIfRunning', GAME_MODES.DAILY]]);
  } finally {
    restore();
  }
});

test('the campaign map switcher, jump and filter reach the level select methods', () => {
  const { ui, calls, elements, restore } = makeBoundUi();
  try {
    elements.btnChapterPrev.fire('click');
    elements.btnChapterNext.fire('click');
    elements.levelsChapterSelect.value = '3';
    elements.levelsChapterSelect.fire('change');
    elements.btnLevelsJumpCurrent.fire('click');
    elements.btnPlayLevelModal.fire('click');
    assert.deepEqual(calls.map((call) => call.join(':')), [
      'stepLevelChapter:-1',
      'stepLevelChapter:1',
      'selectLevelChapter:3',
      'jumpToCurrentLevel',
      'playSelectedLevel'
    ]);

    calls.length = 0;
    ui.levelsSelectedId = 14;
    elements.btnLevelsFilterIncomplete.fire('click');
    assert.equal(ui.levelsFilterIncomplete, true);
    assert.deepEqual(calls.slice(0, 3).map((call) => call.join(':')), [
      'syncLevelsFilterButton',
      'renderLevelTiles:12',
      'renderLevelDetail:14'
    ]);
    assert.equal(names(calls, 'announce').length, 1);
  } finally {
    restore();
  }
});

test('the grid has one delegated click listener and one keydown listener', () => {
  const { elements, restore } = makeBoundUi();
  try {
    assert.equal(elements.levelsGrid.listenerCount('click'), 1);
    assert.equal(elements.levelsGrid.listenerCount('keydown'), 1);
    assert.equal(elements.btnLevels.listenerCount('click'), 0, 'the removed Levels button has no binding');
  } finally {
    restore();
  }
});

function makeTileEvent(levelId, key = null) {
  const tile = { dataset: { levelId: String(levelId) } };
  const event = {
    key,
    target: { closest: (selector) => (selector === '[data-level-id]' ? tile : null) },
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  return { tile, event };
}

test('a click selects a tile, and a click on the selected tile plays it', () => {
  const calls = [];
  const ui = {
    levelsSelectedId: 12,
    selectLevelTile: (...args) => calls.push(['select', ...args]),
    playSelectedLevel: () => calls.push(['play'])
  };
  handleLevelGridClick(ui, makeTileEvent(14).event);
  handleLevelGridClick(ui, makeTileEvent(12).event);
  handleLevelGridClick(ui, { target: { closest: () => null } });
  assert.deepEqual(calls, [['select', 14, { focus: true }], ['play']]);
});

test('grid keys: arrows move and focus, Home and End jump, Page keys change chapter, Enter plays', () => {
  const calls = [];
  const focused = [];
  const children = [10, 11, 12].map((id) => ({ dataset: { levelId: String(id) } }));
  const ui = {
    levelsSelectedId: 11,
    elements: { levelsGrid: { children } },
    moveLevelTileFocus: (dx, dy, options) => {
      calls.push(['move', dx, dy, options]);
      return dx === 1 ? { focus: () => focused.push('tile') } : null;
    },
    selectLevelTile: (...args) => calls.push(['select', ...args]),
    stepLevelChapter: (...args) => calls.push(['chapter', ...args]),
    playSelectedLevel: () => calls.push(['play'])
  };
  const press = (key, levelId = 11) => {
    const { event } = makeTileEvent(levelId, key);
    handleLevelGridKeydown(ui, event);
    return event;
  };

  assert.equal(press('ArrowRight').prevented, true);
  press('ArrowUp');
  assert.deepEqual(calls.splice(0), [['move', 1, 0, { wrapRows: true }], ['move', 0, -1, { wrapRows: true }]]);
  assert.deepEqual(focused, ['tile'], 'the focus follows the tile that was returned, and an edge focuses nothing');

  press('Home');
  press('End');
  assert.deepEqual(calls.splice(0), [['select', 10, { focus: true }], ['select', 12, { focus: true }]]);

  press('PageUp');
  press('PageDown');
  assert.deepEqual(calls.splice(0), [['chapter', -1, { focus: true }], ['chapter', 1, { focus: true }]]);

  assert.equal(press('Enter').prevented, true, 'Enter is swallowed so the button never also clicks');
  assert.deepEqual(calls.splice(0), [['play']]);

  press('Enter', 10);
  assert.deepEqual(calls.splice(0), [['select', 10], ['play']], 'Enter on a tile that is not the selected one selects it first');

  const other = makeTileEvent(11, 'a');
  handleLevelGridKeydown(ui, other.event);
  assert.equal(other.event.prevented, false);
  handleLevelGridKeydown(ui, { key: 'Enter', target: { closest: () => null }, preventDefault() {} });
  assert.deepEqual(calls, []);
});

test('the mode banner, Pause and Game over open the Play hub', () => {
  const { calls, elements, restore } = makeBoundUi();
  try {
    elements.modeBanner.fire('click');
    elements.modeBanner.fire('keydown', { key: 'Enter' });
    elements.modeBanner.fire('keydown', { key: ' ' });
    elements.modeBanner.fire('keydown', { key: 'a' });
    assert.equal(names(calls, 'openPlayHub').length, 3);

    calls.length = 0;
    elements.btnLevelsPause.fire('click');
    assert.deepEqual(calls.map((call) => call[0]), ['openPlayHub', 'syncModalInertState']);
    assert.equal(elements.modalPause.classList.contains('hidden'), true, 'Pause hides behind the hub');

    calls.length = 0;
    elements.btnLevelsGameOver.fire('click');
    assert.deepEqual(calls.map((call) => call[0]), ['hideAllModals', 'openPlayHub']);
  } finally {
    restore();
  }
});

test('the Victory third button opens the map in the campaign and the hub (puzzles open) in Puzzle', () => {
  const campaign = makeBoundUi();
  try {
    campaign.elements.btnLevelsVictory.fire('click');
    assert.deepEqual(campaign.calls.map((call) => call[0]), ['hideAllModals', 'openLevelsModal']);
  } finally {
    campaign.restore();
  }
  const puzzle = makeBoundUi({ engineState: { mode: GAME_MODES.PUZZLE } });
  try {
    puzzle.elements.btnLevelsVictory.fire('click');
    assert.deepEqual(puzzle.calls, [['hideAllModals'], ['openPlayHub', { expand: 'puzzle' }]]);
  } finally {
    puzzle.restore();
  }
});

test('finishing the last puzzle opens the hub on the puzzle list; an earlier puzzle starts the next one', () => {
  const last = makeBoundUi({ engineState: { mode: GAME_MODES.PUZZLE, currentPuzzleStage: 3 } });
  try {
    last.elements.btnNextLevel.fire('click');
    assert.deepEqual(last.calls, [['hideAllModals'], ['openPlayHub', { expand: 'puzzle' }]]);
  } finally {
    last.restore();
  }
  const middle = makeBoundUi({ engineState: { mode: GAME_MODES.PUZZLE, currentPuzzleStage: 1 } });
  try {
    middle.elements.btnNextLevel.fire('click');
    assert.deepEqual(middle.calls, [['hideAllModals'], ['engine.startPuzzleMode', 2]]);
  } finally {
    middle.restore();
  }
});

test('a resize or a turn re-checks the two-player entry only while the hub is open', () => {
  const { ui, calls, windowListeners, restore } = makeBoundUi();
  try {
    for (const type of ['resize', 'orientationchange']) {
      assert.equal(windowListeners.get(type)?.length, 1, `${type} is listened to`);
    }
    windowListeners.get('resize')[0]();
    assert.equal(names(calls, 'syncPlayHubVersusLocal').length, 0);
    ui.hubOpen = true;
    windowListeners.get('resize')[0]();
    windowListeners.get('orientationchange')[0]();
    assert.equal(names(calls, 'syncPlayHubVersusLocal').length, 2);
  } finally {
    restore();
  }
});

test('Back unwinds the campaign map, then the Play hub, then the Workshop', () => {
  const { ui, calls, elements, restore } = makeBoundUi();
  try {
    ui.isDuelCardOpen = () => false;
    ui.handleVersusBack = () => false;
    ui.isCalibrationOpen = () => false;
    for (const key of ['modalConfirm', 'modalLevels', 'modalPlay', 'modalShop', 'modalSettings', 'modalStats']) {
      elements[key].classList.add('hidden');
    }
    elements.modalLevels.classList.remove('hidden');
    elements.modalPlay.classList.remove('hidden');
    elements.modalShop.classList.remove('hidden');

    ui.handleBackAction();
    elements.modalLevels.classList.add('hidden');
    ui.handleBackAction();
    elements.modalPlay.classList.add('hidden');
    ui.handleBackAction();
    assert.deepEqual(
      names(calls, 'closeOverlayModal').map((call) => call[1]),
      ['modalLevels', 'modalPlay', 'modalShop']
    );
  } finally {
    restore();
  }
});

test('the duel picker returns focus to the hub two-player button when the hub opened it, else to the Duel card', () => {
  const ui = Object.create(UIManager.prototype);
  const hubButton = { name: 'hub', isConnected: true };
  const card = { name: 'card' };
  const closed = [];
  ui.elements = {
    btnModeVersus: card,
    modalVersusTiers: { name: 'picker' },
    versusTierHint: { classList: makeClassList() }
  };
  ui.closeOverlayModal = (modal) => closed.push([modal.name, ui.stackedModalOpener?.name]);

  ui.versusTierOpener = hubButton;
  ui.closeVersusTierPicker();
  assert.deepEqual(closed.pop(), ['picker', 'hub']);
  assert.equal(ui.versusTierOpener, null, 'the opener is spent once the picker closed');

  ui.closeVersusTierPicker();
  assert.deepEqual(closed.pop(), ['picker', 'card']);

  ui.versusTierOpener = { name: 'gone', isConnected: false };
  ui.closeVersusTierPicker();
  assert.deepEqual(closed.pop(), ['picker', 'card'], 'a detached opener falls back to the Duel card');
});

test('the Duel card clears a stale hub opener before opening the picker', () => {
  const { ui, elements, restore } = makeBoundUi();
  try {
    ui.openVersusTierPicker = () => {
      assert.equal(ui.versusTierOpener, null);
    };
    ui.versusTierOpener = { name: 'stale', isConnected: true };
    ui.bindVersusEvents();
    elements.btnModeVersus.fire('click');
  } finally {
    restore();
  }
});

test('the input bindings no longer know the Levels drawer button or the drawer lock table', () => {
  const source = readFileSync('./src/ui/UIInputBindings.js', 'utf8');
  assert.doesNotMatch(source, /elements\.btnLevels\b/);
  assert.doesNotMatch(source, /isDrawerButtonLocked|MODE_LOCK_BUTTON_KEYS/);
});

test('hideAllModals spends a stale hub two-player opener', () => {
  const ui = Object.create(UIManager.prototype);
  ui.elements = {};
  ui.getModalsByPriority = () => [];
  ui.stopDailyCountdown = () => {};
  ui.syncModalInertState = () => {};
  ui.versusTierOpener = { name: 'hub', isConnected: true };
  ui.hideAllModals();
  assert.equal(ui.versusTierOpener, null);
});

test('playBountiesList delegates contract clicks across universal, campaign, daily, arcade, incompatible-mode, and disabled states', () => {
  const { ui, calls, elements, restore } = makeBoundUi({
    access: {
      [GAME_MODES.ENDLESS]: { unlocked: true },
      [GAME_MODES.PINBALL]: { unlocked: true }
    }
  });
  try {
    ui.isVersusActive = () => false;
    ui.resumePlayHubRun = () => calls.push(['resumePlayHubRun']);
    ui.getPlayHubContinueTarget = () => ({ kind: 'play', levelId: 4 });
    ui.engine.startCampaignLevel = (id) => calls.push(['engine.startCampaignLevel', id]);

    const fireBountyClick = (dataset, disabled = false) => {
      const btn = {
        disabled,
        dataset,
        closest: (sel) => (sel === '.play-bounty-btn' ? btn : null)
      };
      elements.playBountiesList.fire('click', { target: btn });
    };

    // Disabled (completed) bounty does nothing.
    fireBountyClick({ bountyMode: 'pinball', bountyEvent: 'pinball_core_lit' }, true);
    assert.deepEqual(calls, []);

    // Universal avalanche contract while in Survival (compatible) resumes the active run.
    ui.engine.mode = GAME_MODES.ENDLESS;
    ui.engine.state = GAME_STATES.PAUSED;
    fireBountyClick({ bountyMode: '', bountyEvent: 'avalanche_balls' });
    assert.deepEqual(calls, [['resumePlayHubRun']]);

    // Universal avalanche contract while in Merge Basin (incompatible) falls through to Campaign Continue instead of resuming Merge.
    calls.length = 0;
    ui.engine.mode = GAME_MODES.MERGE;
    fireBountyClick({ bountyMode: '', bountyEvent: 'avalanche_balls' });
    assert.deepEqual(calls, [['activatePlayHubContinue']]);

    // Campaign contract when all levels 3-starred (kind === 'map') launches getSuggestedLevelId() via confirm gate.
    calls.length = 0;
    ui.getPlayHubContinueTarget = () => ({ kind: 'map', levelId: null });
    fireBountyClick({ bountyMode: GAME_MODES.CAMPAIGN, bountyEvent: 'campaign_level_cleared' });
    assert.deepEqual(calls, [['confirmGate'], ['hideAllModals'], ['engine.startCampaignLevel', 12]]);

    // Arcade mode contract delegates to its bound Play Hub mode card.
    calls.length = 0;
    fireBountyClick({ bountyMode: GAME_MODES.PINBALL, bountyEvent: 'pinball_core_lit' });
    assert.deepEqual(calls.slice(0, 2), [['resumeIfRunning', GAME_MODES.PINBALL], ['gate', GAME_MODES.PINBALL]]);
    assert.ok(calls.some((c) => c[0] === 'engine.startPinballMode'));
  } finally {
    restore();
  }
});
