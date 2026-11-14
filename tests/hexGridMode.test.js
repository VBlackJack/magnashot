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
import fs from 'node:fs';

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { i18n } from '../src/core/I18n.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { GAME_MODES, GAME_OVER_REASONS, GAME_STATES, SPECIAL_TYPES } from '../src/core/Constants.js';
import { Ball } from '../src/entities/Ball.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { DEFAULT_MODES_CONFIG } from '../src/game/modes/ModeConfig.js';
import { hexCellToWorld, hexGridBehavior } from '../src/game/modes/HexGridBehavior.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const campaignConfig = loadJson('./configs/campaign.json');
const campaignTuning = loadJson('./configs/campaignTuning.json');
const fluxConfig = loadJson('./configs/flux.json');
const audioConfig = loadJson('./configs/audio.json');
const modesConfig = loadJson('./configs/modes.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('campaign', campaignConfig);
configRegistry.configs.set('audio', audioConfig);
configRegistry.configs.set('flux', fluxConfig);
configRegistry.configs.set('modes', modesConfig);

i18n.dictionaries.set('en', loadJson('./locales/en.json'));
i18n.dictionaries.set('fr', loadJson('./locales/fr.json'));
i18n.currentLocale = 'en';

const createEngine = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  return new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    campaignConfig,
    campaignTuning,
    fluxConfig,
    modesConfig,
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager,
    onStateChange: () => {}
  });
};

test('configs/modes.json covers every section and key of DEFAULT_MODES_CONFIG', () => {
  assert.deepEqual(Object.keys(modesConfig).sort(), Object.keys(DEFAULT_MODES_CONFIG).sort());
  for (const [section, defaults] of Object.entries(DEFAULT_MODES_CONFIG)) {
    assert.deepEqual(Object.keys(modesConfig[section]).sort(), Object.keys(defaults).sort(), `${section} keys`);
  }
});

test('Hex Grid starts with straight-line physics, rigid lattice cells, and purist fair-play rules', () => {
  const engine = createEngine();
  engine.storageManager.setCoins(1000);
  engine.startHexGridMode();

  assert.equal(engine.mode, GAME_MODES.HEX_GRID);
  assert.equal(engine.state, GAME_STATES.PLAYING);
  assert.equal(engine.physicsWorld.disableMagneticCurve, true);
  assert.equal(engine.physicsWorld.skipClusterStep, true);
  assert.equal(engine.physicsWorld.snapCeilingY, modesConfig.hexGrid.topMargin);

  assert.equal(engine.offersSpecialBalls(), false);
  assert.equal(engine.isSpecialTypeAllowed(SPECIAL_TYPES.BOMB), false);
  assert.equal(engine.canBuySpecialAmmo(), false);
  assert.equal(engine.buySpecialAmmo(SPECIAL_TYPES.BOMB), false);
  assert.equal(engine.areUpgradesNeutralised(), true);
  assert.equal(engine.getOverchargeMultiplier(), 0);
  assert.equal(engine.getResonanceBlockReason(), 'ruleset');
  assert.equal(engine.isTiltLocked(), true);

  for (const ball of engine.physicsWorld.balls) {
    assert.equal(Number.isInteger(ball.hexRow), true);
    assert.equal(Number.isInteger(ball.hexCol), true);
    const expected = hexCellToWorld(ball.hexRow, ball.hexCol, engine.modeState.rowParityOffset, modesConfig.hexGrid);
    assert.equal(ball.x, expected.x);
    assert.equal(ball.y, expected.y);
  }
});

test('Hex Grid snaps shots onto the lattice, clears 3+ matches, and drops unanchored spheres', () => {
  const engine = createEngine();
  engine.startHexGridMode();
  const cfg = modesConfig.hexGrid;
  const r = physicsConfig.ball.radius;
  const world = engine.physicsWorld;
  world.balls.length = 0;
  world.ballMap.clear();

  const addCell = (row, col, colorId) => {
    const pos = hexCellToWorld(row, col, 0, cfg);
    const b = new Ball({ x: pos.x, y: pos.y, radius: r, colorId, isAnchor: row === 0 });
    b.hexRow = row;
    b.hexCol = col;
    world.addBall(b);
    return b;
  };

  const bystander = addCell(0, 1, 'cobalt');
  addCell(0, 4, 'crimson');
  const target = addCell(0, 5, 'crimson');
  const hanging = addCell(1, 4, 'emerald');
  hexGridBehavior.syncHexBonds(engine);

  const shotPos = hexCellToWorld(1, 5, 0, cfg);
  const shot = new Ball({ x: shotPos.x, y: shotPos.y, radius: r, colorId: 'crimson' });
  world.addBall(shot);

  hexGridBehavior.onProjectileSettled(engine, { snappedBall: shot, hitTarget: target });

  assert.equal(world.balls.some((b) => b.colorId === 'crimson'), false, 'the 3 crimson spheres matched');
  assert.equal(hanging.isDropping, true, 'the hanging emerald detached into an avalanche');
  assert.equal(world.balls.includes(bystander), true, 'anchored bystander remains on wave 1');

  // Clear the remaining bystander cluster -> advances to wave 2 and repopulates
  addCell(0, 2, 'cobalt');
  const finalPos = hexCellToWorld(1, 1, 0, cfg);
  const finalShot = new Ball({ x: finalPos.x, y: finalPos.y, radius: r, colorId: 'cobalt' });
  world.addBall(finalShot);
  hexGridBehavior.onProjectileSettled(engine, { snappedBall: finalShot, hitTarget: bystander });

  assert.equal(engine.waveCount, 2, 'clearing the lattice advances to wave 2 and repopulates');
  assert.ok(world.balls.filter((b) => !b.isDropping).length > 0, 'wave 2 repopulated the ceiling');
  assert.ok(engine.score >= cfg.waveClearBonus);
});

test('Hex Grid Polarity Pulse pulls a matching sphere 1 cell inward to complete a match', () => {
  const engine = createEngine();
  engine.startHexGridMode();
  const cfg = modesConfig.hexGrid;
  const r = physicsConfig.ball.radius;
  const world = engine.physicsWorld;
  world.balls.length = 0;
  world.ballMap.clear();

  const addCell = (row, col, colorId) => {
    const pos = hexCellToWorld(row, col, 0, cfg);
    const b = new Ball({ x: pos.x, y: pos.y, radius: r, colorId, isAnchor: row === 0 });
    b.hexRow = row;
    b.hexCol = col;
    world.addBall(b);
    return b;
  };

  // Anchor line so row 1 spheres remain ceiling-connected before the pulse
  addCell(0, 2, 'cobalt');
  addCell(0, 3, 'amber');
  addCell(0, 4, 'cobalt');
  addCell(0, 5, 'amber');
  const anchorHit = addCell(1, 2, 'crimson');
  // Leave (1, 3) for the landing shot, (1, 4) empty, and place a matching crimson at (1, 5) (2 steps right!)
  const distantCrimson = addCell(1, 5, 'crimson');
  hexGridBehavior.syncHexBonds(engine);

  const previewMoves = hexGridBehavior.previewPolarityPulseMoves(engine, 1, 3, 'crimson');
  assert.equal(previewMoves.some((m) => m.kind === 'pull' && m.ball === distantCrimson && m.toCol === 4), true);

  const landingPos = hexCellToWorld(1, 3, 0, cfg);
  const shot = new Ball({ x: landingPos.x, y: landingPos.y, radius: r, colorId: 'crimson' });
  shot.isPolarityFlipped = true;
  world.addBall(shot);

  hexGridBehavior.onProjectileSettled(engine, { snappedBall: shot, hitTarget: anchorHit });

  assert.equal(engine.modeState.pulsesTriggered, 1);
  assert.equal(world.balls.some((b) => b.colorId === 'crimson'), false, 'pulled sphere joined the 3-match');
});

test('Hex Grid ceiling descent advances the wave and triggers LINE_CROSSED at the danger line', () => {
  const engine = createEngine();
  engine.startHexGridMode();
  engine.modeState.shotsUntilDescent = 1;

  // Non-matching turn triggers ceiling descent
  hexGridBehavior.finishHexTurn(engine, false);
  assert.equal(engine.waveCount, 2);
  assert.equal(engine.modeState.rowParityOffset, 1);

  // Descend until the lowest row breaches dangerLineY
  for (let i = 0; i < 20 && engine.state === GAME_STATES.PLAYING; i++) {
    hexGridBehavior.descendCeilingRow(engine);
    engine.checkDangerLineBreach();
  }
  assert.equal(engine.state, GAME_STATES.GAME_OVER);
  assert.equal(engine.gameOverSummary?.reasonKey, GAME_OVER_REASONS.LINE_CROSSED);
});

test('Hex Grid snapshot preserves lattice coordinates and descent counter across restore', () => {
  const engine = createEngine();
  engine.startHexGridMode();
  engine.hasFiredInRound = true;
  engine.modeState.shotsUntilDescent = 2;
  engine.modeState.pulsesTriggered = 3;
  engine.saveRunSnapshot({ force: true });

  const expectedCells = engine.physicsWorld.balls.map((b) => `${b.hexRow}:${b.hexCol}:${b.colorId}`);

  const restored = createEngine();
  restored.storageManager = engine.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.mode, GAME_MODES.HEX_GRID);
  assert.equal(restored.modeState.shotsUntilDescent, 2);
  assert.equal(restored.modeState.pulsesTriggered, 3);
  assert.deepEqual(
    restored.physicsWorld.balls.map((b) => `${b.hexRow}:${b.hexCol}:${b.colorId}`),
    expectedCells
  );
});

test('Hex Grid spawns Resonance Prism cells from wave 2+, delays descent on shatter, and preserves hexPrism in RunSnapshot', () => {
  const engine = createEngine();
  engine.startHexGridMode();
  const cfg = modesConfig.hexGrid;

  // First ceiling descent advances wave 1 -> wave 2 and marks exactly 1 top cell with hexPrism.
  hexGridBehavior.descendCeilingRow(engine);
  assert.equal(engine.waveCount, 2);
  const prisms = engine.physicsWorld.balls.filter((b) => b.hexPrism);
  assert.equal(prisms.length, 1);

  // Snapshot preserves hexPrism flag on the exact cell.
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot({ force: true });
  const restored = createEngine();
  restored.storageManager = engine.storageManager;
  assert.equal(restored.restoreSavedRun(), true);
  assert.equal(restored.physicsWorld.balls.filter((b) => b.hexPrism).length, 1);

  // Shattering the prism grants +prismBonusPoints and +prismDescentDelay turns capped at descentCadence + prismMaxBuffer.
  restored.state = GAME_STATES.PLAYING;
  const prismBall = restored.physicsWorld.balls.find((b) => b.hexPrism);
  restored.modeState.shotsUntilDescent = 2;
  const scoreBefore = restored.score;
  restored.physicsWorld.removeBall(prismBall);
  hexGridBehavior.finishHexTurn(restored, true, [prismBall]);

  assert.equal(restored.score, scoreBefore + cfg.prismBonusPoints);
  assert.equal(restored.modeState.shotsUntilDescent, 2 + cfg.prismDescentDelay);
});
