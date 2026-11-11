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
  GAME_MODES,
  GAME_OVER_REASONS,
  MATH_CONSTANTS,
  SPECIAL_TYPES
} from '../../core/Constants.js';
import { t } from '../../core/I18n.js';
import { Ball } from '../../entities/Ball.js';
import { ModeBehavior, registerModeBehavior } from './ModeBehavior.js';

const HEX_SIDES = 6;
const HEX_ANGLE_STEP = MATH_CONSTANTS.TWO_PI / HEX_SIDES;
const HEX_POINTY_OFFSET = Math.PI / HEX_SIDES;
const MAX_FALLBACK_SEARCH_ROWS = 18;
const PULSE_ARROW_SCALE = 0.65;
const PREVIEW_PULSE_LINE_WIDTH = 2;
const GUIDE_HEX_RADIUS_FACTOR = 1.04;

const EVEN_ROW_DIRS = Object.freeze([
  Object.freeze({ dr: 0, dc: 1 }),
  Object.freeze({ dr: 1, dc: 0 }),
  Object.freeze({ dr: 1, dc: -1 }),
  Object.freeze({ dr: 0, dc: -1 }),
  Object.freeze({ dr: -1, dc: -1 }),
  Object.freeze({ dr: -1, dc: 0 })
]);

const ODD_ROW_DIRS = Object.freeze([
  Object.freeze({ dr: 0, dc: 1 }),
  Object.freeze({ dr: 1, dc: 1 }),
  Object.freeze({ dr: 1, dc: 0 }),
  Object.freeze({ dr: 0, dc: -1 }),
  Object.freeze({ dr: -1, dc: 0 }),
  Object.freeze({ dr: -1, dc: 1 })
]);

function getRowParity(row, rowParityOffset) {
  return ((row + rowParityOffset) % 2 + 2) % 2;
}

function getColsForRow(row, rowParityOffset, cfg) {
  return getRowParity(row, rowParityOffset) === 0 ? cfg.colsEven : cfg.colsOdd;
}

export function hexCellToWorld(row, col, rowParityOffset, cfg) {
  const parity = getRowParity(row, rowParityOffset);
  const shiftX = parity === 1 ? cfg.colSpacing * MATH_CONSTANTS.HALF : 0;
  return {
    x: cfg.sidePadding + shiftX + col * cfg.colSpacing,
    y: cfg.topMargin + row * cfg.rowHeight
  };
}

export function stepHexDirection(row, col, dirIndex, rowParityOffset, cfg) {
  const parity = getRowParity(row, rowParityOffset);
  const delta = parity === 0 ? EVEN_ROW_DIRS[dirIndex] : ODD_ROW_DIRS[dirIndex];
  const nextRow = row + delta.dr;
  const nextCol = col + delta.dc;
  if (nextRow < 0) {
    return null;
  }
  const maxCols = getColsForRow(nextRow, rowParityOffset, cfg);
  if (nextCol < 0 || nextCol >= maxCols) {
    return null;
  }
  return { row: nextRow, col: nextCol };
}

export function getHexNeighbors(row, col, rowParityOffset, cfg) {
  const neighbors = [];
  for (let d = 0; d < HEX_SIDES; d++) {
    const next = stepHexDirection(row, col, d, rowParityOffset, cfg);
    if (next) {
      neighbors.push(next);
    }
  }
  return neighbors;
}

function cellKey(row, col) {
  return `${row}:${col}`;
}

function buildOccupiedMap(balls) {
  const occupied = new Map();
  for (const ball of balls) {
    if (Number.isInteger(ball.hexRow) && Number.isInteger(ball.hexCol)) {
      occupied.set(cellKey(ball.hexRow, ball.hexCol), ball);
    }
  }
  return occupied;
}

function drawHexagonPath(ctx, cx, cy, radius) {
  ctx.beginPath();
  for (let i = 0; i < HEX_SIDES; i++) {
    const angle = HEX_POINTY_OFFSET + i * HEX_ANGLE_STEP;
    const vx = cx + Math.cos(angle) * radius;
    const vy = cy + Math.sin(angle) * radius;
    if (i === 0) {
      ctx.moveTo(vx, vy);
    } else {
      ctx.lineTo(vx, vy);
    }
  }
  ctx.closePath();
}

export class HexGridBehavior extends ModeBehavior {
  constructor() {
    super(GAME_MODES.HEX_GRID);
  }

  offersSpecialBalls() {
    return false;
  }

  isSpecialTypeAllowed() {
    return false;
  }

  hidesOvercharge() {
    return true;
  }

  neutralizesWorkshopUpgrades() {
    return true;
  }

  isTiltLocked() {
    return true;
  }

  getPaletteCountForWave(wave, cfg, totalColors) {
    const extra = Math.floor(Math.max(0, wave - 1) / Math.max(1, cfg.wavesPerExtraColor));
    return Math.min(totalColors, cfg.maxColorCount, cfg.initialColorCount + extra);
  }

  getShotsPerDescent(wave, cfg) {
    const drop = Math.floor(Math.max(0, wave - 1) / Math.max(1, cfg.wavesPerCadenceDrop));
    return Math.max(cfg.shotsPerDescentMin, cfg.shotsPerDescentBase - drop);
  }

  setupMode(engine) {
    const cfg = engine.modesConfig.hexGrid;
    const world = engine.physicsWorld;
    world.clear();
    world.disableMagneticCurve = true;
    world.skipClusterStep = true;
    world.snapCeilingY = cfg.topMargin;

    engine.waveCount = 1;
    const paletteSize = this.getPaletteCountForWave(1, cfg, engine.ballsConfig.standardColors.length);
    engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);
    engine.specialInventory = Object.fromEntries(Object.values(SPECIAL_TYPES).map((type) => [type, 0]));

    const cadence = this.getShotsPerDescent(1, cfg);
    engine.modeState = {
      rowParityOffset: 0,
      shotsUntilDescent: cadence,
      descentCadence: cadence,
      pulsesTriggered: 0
    };

    this.populateRows(engine, cfg.initialRows);
    this.syncHexBonds(engine);
  }

  populateRows(engine, rowCount) {
    const cfg = engine.modesConfig.hexGrid;
    const r = engine.physicsConfig.ball.radius;
    const parityOffset = engine.modeState.rowParityOffset;
    for (let row = 0; row < rowCount; row++) {
      const cols = getColsForRow(row, parityOffset, cfg);
      for (let col = 0; col < cols; col++) {
        const pos = hexCellToWorld(row, col, parityOffset, cfg);
        const colorId = this.pickNonMatchingGridColor(engine, row, col);
        const ball = new Ball({
          x: pos.x,
          y: pos.y,
          radius: r,
          colorId,
          isAnchor: row === 0
        });
        ball.hexRow = row;
        ball.hexCol = col;
        engine.physicsWorld.addBall(ball);
      }
    }
  }

  pickNonMatchingGridColor(engine, row, col) {
    const cfg = engine.modesConfig.hexGrid;
    const occupied = buildOccupiedMap(engine.physicsWorld.balls);
    const neighbors = getHexNeighbors(row, col, engine.modeState.rowParityOffset, cfg);
    const forbidden = new Set();
    for (const n of neighbors) {
      const nb = occupied.get(cellKey(n.row, n.col));
      if (!nb || !nb.colorId) {
        continue;
      }
      const nNeighbors = getHexNeighbors(n.row, n.col, engine.modeState.rowParityOffset, cfg);
      for (const nn of nNeighbors) {
        if (nn.row === row && nn.col === col) {
          continue;
        }
        const nnb = occupied.get(cellKey(nn.row, nn.col));
        if (nnb && nnb.colorId === nb.colorId) {
          forbidden.add(nb.colorId);
        }
      }
    }
    const allowed = engine.activePalette.filter((colorId) => !forbidden.has(colorId));
    const pool = allowed.length > 0 ? allowed : engine.activePalette;
    return pool[Math.floor(engine.random() * pool.length)];
  }

  syncHexBonds(engine) {
    const cfg = engine.modesConfig.hexGrid;
    const world = engine.physicsWorld;
    const parityOffset = engine.modeState.rowParityOffset;
    const occupied = buildOccupiedMap(world.balls);

    for (const ball of world.balls) {
      ball.bonds.clear();
      const pos = hexCellToWorld(ball.hexRow, ball.hexCol, parityOffset, cfg);
      ball.x = pos.x;
      ball.y = pos.y;
      ball.anchorX = pos.x;
      ball.anchorY = pos.y;
      ball.vx = 0;
      ball.vy = 0;
      ball.isAnchor = ball.hexRow === 0;
    }

    for (const ball of world.balls) {
      const neighbors = getHexNeighbors(ball.hexRow, ball.hexCol, parityOffset, cfg);
      for (const n of neighbors) {
        const other = occupied.get(cellKey(n.row, n.col));
        if (other && other.id > ball.id) {
          world.createBond(ball, other, false);
        }
      }
    }
    world.aimCacheValid = false;
  }

  findBestLandingCell(engine, px, py, hitTarget = null) {
    const cfg = engine.modesConfig.hexGrid;
    const parityOffset = engine.modeState.rowParityOffset;
    const occupied = buildOccupiedMap(engine.physicsWorld.balls);
    const candidates = [];

    if (hitTarget && Number.isInteger(hitTarget.hexRow) && Number.isInteger(hitTarget.hexCol)) {
      const direct = getHexNeighbors(hitTarget.hexRow, hitTarget.hexCol, parityOffset, cfg);
      for (const cell of direct) {
        if (!occupied.has(cellKey(cell.row, cell.col))) {
          candidates.push(cell);
        }
      }
    } else {
      const topCols = getColsForRow(0, parityOffset, cfg);
      for (let col = 0; col < topCols; col++) {
        if (!occupied.has(cellKey(0, col))) {
          candidates.push({ row: 0, col });
        }
      }
    }

    if (candidates.length === 0) {
      const approxRow = Math.max(0, Math.round((py - cfg.topMargin) / cfg.rowHeight));
      const minRow = Math.max(0, approxRow - 2);
      const maxRow = Math.min(MAX_FALLBACK_SEARCH_ROWS, approxRow + 3);
      for (let row = minRow; row <= maxRow; row++) {
        const cols = getColsForRow(row, parityOffset, cfg);
        for (let col = 0; col < cols; col++) {
          if (occupied.has(cellKey(row, col))) {
            continue;
          }
          if (row === 0) {
            candidates.push({ row, col });
            continue;
          }
          const neighbors = getHexNeighbors(row, col, parityOffset, cfg);
          if (neighbors.some((n) => occupied.has(cellKey(n.row, n.col)))) {
            candidates.push({ row, col });
          }
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    let best = candidates[0];
    let bestDistSq = Infinity;
    for (const cell of candidates) {
      const pos = hexCellToWorld(cell.row, cell.col, parityOffset, cfg);
      const dx = pos.x - px;
      const dy = pos.y - py;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = cell;
      }
    }
    return best;
  }

  previewPolarityPulseMoves(engine, centerRow, centerCol, colorId) {
    const cfg = engine.modesConfig.hexGrid;
    const parityOffset = engine.modeState.rowParityOffset;
    const occupied = buildOccupiedMap(engine.physicsWorld.balls);
    const reservedTargets = new Set([cellKey(centerRow, centerCol)]);
    const moves = [];

    for (let dir = 0; dir < HEX_SIDES; dir++) {
      const step1 = stepHexDirection(centerRow, centerCol, dir, parityOffset, cfg);
      if (!step1) {
        continue;
      }
      const step2 = stepHexDirection(step1.row, step1.col, dir, parityOffset, cfg);
      const key1 = cellKey(step1.row, step1.col);
      const ball1 = occupied.get(key1);

      if (!ball1 && step2 && !reservedTargets.has(key1)) {
        const key2 = cellKey(step2.row, step2.col);
        const ball2 = occupied.get(key2);
        if (ball2 && ball2.colorId === colorId && ball2.hexRow > 0) {
          reservedTargets.add(key1);
          moves.push({
            kind: 'pull',
            ball: ball2,
            fromRow: step2.row,
            fromCol: step2.col,
            toRow: step1.row,
            toCol: step1.col
          });
          continue;
        }
      }

      if (ball1 && ball1.colorId !== colorId && ball1.hexRow > 0 && step2) {
        const key2 = cellKey(step2.row, step2.col);
        if (!occupied.has(key2) && !reservedTargets.has(key2)) {
          reservedTargets.add(key2);
          moves.push({
            kind: 'push',
            ball: ball1,
            fromRow: step1.row,
            fromCol: step1.col,
            toRow: step2.row,
            toCol: step2.col
          });
        }
      }
    }
    return moves;
  }

  applyPolarityPulse(engine, snappedBall) {
    if (!snappedBall.isPolarityFlipped) {
      return 0;
    }
    const cfg = engine.modesConfig.hexGrid;
    const moves = this.previewPolarityPulseMoves(
      engine,
      snappedBall.hexRow,
      snappedBall.hexCol,
      snappedBall.colorId
    );
    if (moves.length === 0) {
      return 0;
    }

    for (const move of moves) {
      move.ball.hexRow = move.toRow;
      move.ball.hexCol = move.toCol;
    }
    engine.modeState.pulsesTriggered = (engine.modeState.pulsesTriggered || 0) + 1;
    this.syncHexBonds(engine);

    const points = moves.length * cfg.pulseBonusPoints;
    engine.addScore(points);
    engine.particleSystem.spawnShockwave(
      snappedBall.x,
      snappedBall.y,
      engine.gameConfig.theme.overchargePopupColor,
      snappedBall.radius * cfg.pulseRangeCells * 2
    );
    engine.particleSystem.spawnFloatingText(
      snappedBall.x,
      snappedBall.y + engine.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.hexGrid.pulse', { points }),
      engine.gameConfig.theme.overchargePopupColor
    );
    return moves.length;
  }

  onProjectileSettled(engine, { snappedBall, hitTarget }) {
    if (!snappedBall) {
      return false;
    }
    const world = engine.physicsWorld;
    // Release initial snap bonds so we snap cleanly onto the exact free lattice cell.
    for (const neighborId of [...snappedBall.bonds]) {
      const nb = world.ballMap.get(neighborId);
      if (nb) {
        nb.bonds.delete(snappedBall.id);
      }
    }
    snappedBall.bonds.clear();

    const cell = this.findBestLandingCell(engine, snappedBall.x, snappedBall.y, hitTarget);
    if (!cell) {
      world.removeBall(snappedBall);
      engine.combo = 0;
      this.finishHexTurn(engine, false);
      return true;
    }

    snappedBall.hexRow = cell.row;
    snappedBall.hexCol = cell.col;
    this.syncHexBonds(engine);

    engine.audioManager.playEffect('snap');
    engine.startImpactWave(snappedBall);
    engine.particleSystem.addScreenShake(engine.gameConfig.juice.snapShake, engine.gameConfig.juice.maxShakeOffset);

    const pulseMoved = this.applyPolarityPulse(engine, snappedBall);

    const minMatch = engine.gameConfig.defaults.matchMinCount;
    let totalDestroyed = 0;

    // Evaluate match on snappedBall first, then any ball displaced by the polarity pulse.
    const candidates = [snappedBall, ...world.balls.filter((b) => b.id !== snappedBall.id)];
    const checkedIds = new Set();
    for (const candidate of candidates) {
      if (checkedIds.has(candidate.id) || !world.ballMap.has(candidate.id)) {
        continue;
      }
      // Only trigger matches touching snappedBall or when a pulse shifted neighbors into a match.
      if (candidate.id !== snappedBall.id && pulseMoved === 0) {
        break;
      }
      const cluster = world.findColorCluster(candidate);
      for (const m of cluster) {
        checkedIds.add(m.id);
      }
      if (cluster.length >= minMatch) {
        totalDestroyed += engine.resolveColorMatchCluster(cluster, candidate, candidate.id !== snappedBall.id);
      }
    }

    if (totalDestroyed === 0) {
      engine.combo = 0;
    }
    this.finishHexTurn(engine, totalDestroyed > 0);
    return true;
  }

  finishHexTurn(engine, madeMatch) {
    const dropped = engine.detachAndRewardAvalanche();
    engine.settleTurnResonance(madeMatch || dropped > 0);

    if (engine.physicsWorld.balls.length === 0) {
      this.advanceClearedWave(engine);
    } else if (!madeMatch && dropped === 0) {
      engine.modeState.shotsUntilDescent = Math.max(0, engine.modeState.shotsUntilDescent - 1);
      if (engine.modeState.shotsUntilDescent <= 0) {
        this.descendCeilingRow(engine);
      }
    }

    engine.refreshStaleLauncherColors();
    engine.checkDangerLineBreach();
    if (engine.isRunPlaying()) {
      engine.updateAimFromAngle(engine.aimAngle);
      engine.saveRunSnapshot();
    }
    engine.notifyUI();
  }

  advanceClearedWave(engine) {
    const cfg = engine.modesConfig.hexGrid;
    const bonus = cfg.waveClearBonus * engine.waveCount;
    engine.addScore(bonus);
    engine.waveCount++;
    const paletteSize = this.getPaletteCountForWave(
      engine.waveCount,
      cfg,
      engine.ballsConfig.standardColors.length
    );
    engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);
    const cadence = this.getShotsPerDescent(engine.waveCount, cfg);
    engine.modeState.descentCadence = cadence;
    engine.modeState.shotsUntilDescent = cadence;
    engine.modeState.rowParityOffset = (engine.modeState.rowParityOffset + 1) % 2;

    this.populateRows(engine, cfg.initialRows);
    this.syncHexBonds(engine);

    engine.particleSystem.spawnFloatingText(
      engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      engine.gameConfig.canvas.logicalHeight * MATH_CONSTANTS.HALF,
      t('gameplay.feedback.hexGrid.waveCleared', { points: bonus }),
      engine.gameConfig.theme.victoryPopupColor
    );
    engine.unlockAchievementTiers('hexGridWaves', engine.waveCount);
    engine.persistRunHighScore();
  }

  descendCeilingRow(engine) {
    const cfg = engine.modesConfig.hexGrid;
    const r = engine.physicsConfig.ball.radius;
    engine.waveCount++;
    const paletteSize = this.getPaletteCountForWave(
      engine.waveCount,
      cfg,
      engine.ballsConfig.standardColors.length
    );
    engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);

    engine.modeState.rowParityOffset = (engine.modeState.rowParityOffset + 1) % 2;
    const cadence = this.getShotsPerDescent(engine.waveCount, cfg);
    engine.modeState.descentCadence = cadence;
    engine.modeState.shotsUntilDescent = cadence;

    for (const ball of engine.physicsWorld.balls) {
      ball.hexRow += 1;
      ball.isAnchor = false;
    }

    const topCols = getColsForRow(0, engine.modeState.rowParityOffset, cfg);
    for (let col = 0; col < topCols; col++) {
      const pos = hexCellToWorld(0, col, engine.modeState.rowParityOffset, cfg);
      const colorId = this.pickNonMatchingGridColor(engine, 0, col);
      const ball = new Ball({
        x: pos.x,
        y: pos.y,
        radius: r,
        colorId,
        isAnchor: true
      });
      ball.hexRow = 0;
      ball.hexCol = col;
      engine.physicsWorld.addBall(ball);
    }

    this.syncHexBonds(engine);
    engine.detachAndRewardAvalanche();
    engine.audioManager.playEffect?.('creak');
    engine.particleSystem.spawnFloatingText(
      engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      cfg.topMargin + engine.gameConfig.canvas.wavePopupOffsetY,
      t('gameplay.feedback.wave.incoming'),
      engine.gameConfig.theme.wavePopupColor
    );
    engine.unlockAchievementTiers('hexGridWaves', engine.waveCount);
  }

  evaluateBoardState(engine) {
    if (!engine.isRunPlaying()) {
      return true;
    }
    const dangerY = engine.gameConfig.canvas.dangerLineY;
    for (const ball of engine.physicsWorld.balls) {
      if (ball.y + ball.radius >= dangerY) {
        engine.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
        return true;
      }
    }
    return true;
  }

  serializeModeState(engine) {
    const state = engine.modeState || {};
    return {
      rowParityOffset: state.rowParityOffset ?? 0,
      shotsUntilDescent: state.shotsUntilDescent ?? 1,
      descentCadence: state.descentCadence ?? 1,
      pulsesTriggered: state.pulsesTriggered ?? 0,
      cells: engine.physicsWorld.balls.map((b) => ({
        row: Number.isInteger(b.hexRow) ? b.hexRow : 0,
        col: Number.isInteger(b.hexCol) ? b.hexCol : 0
      }))
    };
  }

  validateModeState(rawState) {
    return Boolean(
      rawState
      && typeof rawState === 'object'
      && Number.isInteger(rawState.rowParityOffset)
      && Number.isInteger(rawState.shotsUntilDescent)
      && Array.isArray(rawState.cells)
    );
  }

  restoreModeState(engine, rawState) {
    const cfg = engine.modesConfig.hexGrid;
    const paletteSize = this.getPaletteCountForWave(
      engine.waveCount,
      cfg,
      engine.ballsConfig.standardColors.length
    );
    engine.activePalette = engine.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);
    engine.modeState = {
      rowParityOffset: ((rawState.rowParityOffset % 2) + 2) % 2,
      shotsUntilDescent: Math.max(1, rawState.shotsUntilDescent),
      descentCadence: Math.max(1, rawState.descentCadence || cfg.shotsPerDescentBase),
      pulsesTriggered: Math.max(0, rawState.pulsesTriggered || 0)
    };
    const balls = engine.physicsWorld.balls;
    for (let i = 0; i < balls.length; i++) {
      const cell = rawState.cells[i];
      if (cell && Number.isInteger(cell.row) && Number.isInteger(cell.col)) {
        balls[i].hexRow = cell.row;
        balls[i].hexCol = cell.col;
      } else {
        const row = Math.max(0, Math.round((balls[i].y - cfg.topMargin) / cfg.rowHeight));
        const shiftX = getRowParity(row, engine.modeState.rowParityOffset) === 1
          ? cfg.colSpacing * MATH_CONSTANTS.HALF
          : 0;
        const col = Math.max(0, Math.round((balls[i].x - cfg.sidePadding - shiftX) / cfg.colSpacing));
        balls[i].hexRow = row;
        balls[i].hexCol = col;
      }
    }
    this.syncHexBonds(engine);
  }

  drawUnderlay(ctx, engine, renderer, theme) {
    const cfg = engine.modesConfig.hexGrid;
    const parityOffset = engine.modeState?.rowParityOffset ?? 0;
    const r = engine.physicsConfig.ball.radius * GUIDE_HEX_RADIUS_FACTOR;
    const maxGuideRows = Math.floor((engine.gameConfig.canvas.dangerLineY - cfg.topMargin) / cfg.rowHeight);

    ctx.save();
    ctx.strokeStyle = theme.aimLineColor;
    ctx.globalAlpha = cfg.cellGuideAlpha;
    ctx.lineWidth = 1;
    for (let row = 0; row < maxGuideRows; row++) {
      const cols = getColsForRow(row, parityOffset, cfg);
      for (let col = 0; col < cols; col++) {
        const pos = hexCellToWorld(row, col, parityOffset, cfg);
        drawHexagonPath(ctx, pos.x, pos.y, r);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawOverlay(ctx, engine, renderer, theme) {
    if (
      !engine.isRunPlaying()
      || engine.physicsWorld.projectile
      || engine.isAimCancelled
      || !engine.currentBall
      || !engine.aimPoints
      || engine.aimPoints.length === 0
    ) {
      return;
    }
    const cfg = engine.modesConfig.hexGrid;
    const parityOffset = engine.modeState?.rowParityOffset ?? 0;
    const cell = this.findBestLandingCell(
      engine,
      engine.aimPoints.landingX,
      engine.aimPoints.landingY,
      engine.aimPoints.snapTarget
    );
    if (!cell) {
      return;
    }
    const pos = hexCellToWorld(cell.row, cell.col, parityOffset, cfg);
    const r = engine.physicsConfig.ball.radius;

    ctx.save();
    ctx.strokeStyle = engine.isPolarityFlipped ? theme.overchargePopupColor : theme.aimLineColor;
    ctx.globalAlpha = cfg.aimPreviewAlpha;
    ctx.lineWidth = PREVIEW_PULSE_LINE_WIDTH;
    drawHexagonPath(ctx, pos.x, pos.y, r);
    ctx.stroke();

    if (engine.isPolarityFlipped && engine.currentBall.colorId) {
      const moves = this.previewPolarityPulseMoves(
        engine,
        cell.row,
        cell.col,
        engine.currentBall.colorId
      );
      for (const move of moves) {
        const fromPos = hexCellToWorld(move.fromRow, move.fromCol, parityOffset, cfg);
        const toPos = hexCellToWorld(move.toRow, move.toCol, parityOffset, cfg);
        ctx.beginPath();
        ctx.moveTo(fromPos.x, fromPos.y);
        ctx.lineTo(
          fromPos.x + (toPos.x - fromPos.x) * PULSE_ARROW_SCALE,
          fromPos.y + (toPos.y - fromPos.y) * PULSE_ARROW_SCALE
        );
        ctx.stroke();
        drawHexagonPath(ctx, toPos.x, toPos.y, r * PULSE_ARROW_SCALE);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

export const hexGridBehavior = new HexGridBehavior();
registerModeBehavior(GAME_MODES.HEX_GRID, hexGridBehavior);
