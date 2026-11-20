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

import { t } from '../core/I18n.js';
import {
  MAX_PUZZLE_BALLS,
  PUZZLE_OBSTACLE_KINDS,
  buildCustomPuzzleUrl,
  decodeCustomPuzzle,
  extractPuzzlePayload
} from '../game/PuzzleShareCodec.js';

const DEFAULT_CFG = Object.freeze({
  gridCols: 7,
  gridRows: 4,
  gridStartX: 115,
  gridStartY: 120,
  gridStepX: 40,
  gridStepY: 38,
  defaultShots: 2,
  maxShots: 6,
  maxBalls: MAX_PUZZLE_BALLS
});
const DEFAULT_COLORS = Object.freeze(['crimson', 'cobalt', 'emerald', 'amber', 'violet', 'cyan']);
const COLOR_SYMBOLS = Object.freeze({
  crimson: 'N',
  cobalt: 'S',
  emerald: '\u039e',
  amber: '\u03a0',
  violet: '\u03a9',
  cyan: '\u03a6'
});
const BUILDER_TOOLS = Object.freeze({ SPHERE: 'sphere', ANCHOR: 'anchor', CORE: 'core' });
const GRID_ARROW_DELTAS = Object.freeze({
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
});

function resolveBuilderConfig(ui) {
  const cfg = { ...DEFAULT_CFG, ...(ui?.gameConfig?.puzzleBuilder || {}) };
  const fromBalls = ui?.engine?.ballsConfig?.standardColors?.map((c) => c.id).filter(Boolean);
  const colors = fromBalls?.length > 0 ? fromBalls : DEFAULT_COLORS;
  return { ...cfg, colors };
}

function createInitialBuilderState(cfg) {
  const cells = new Map();
  cells.set('2,0', { c: cfg.colors[0], a: true, k: false });
  cells.set('3,0', { c: cfg.colors[0], a: true, k: false });
  cells.set('4,0', { c: cfg.colors[1] || cfg.colors[0], a: true, k: false });
  cells.set('3,1', { c: cfg.colors[1] || cfg.colors[0], a: false, k: false });
  return {
    activeColor: cfg.colors[0],
    activeTool: BUILDER_TOOLS.SPHERE,
    shots: cfg.defaultShots,
    obstaclePreset: 'none',
    queue: [cfg.colors[0], cfg.colors[1] || cfg.colors[0]],
    cells
  };
}

/** Converts builder state into a PuzzleShareCodec spec. */
export function buildSpecFromBuilderState(state, cfg = DEFAULT_CFG) {
  const balls = [];
  for (const [key, entry] of state.cells.entries()) {
    const [col, row] = key.split(',').map(Number);
    const normalized = typeof entry === 'string' ? { c: entry, a: false, k: false } : entry;
    const ball = {
      x: cfg.gridStartX + col * cfg.gridStepX,
      y: cfg.gridStartY + row * cfg.gridStepY,
      c: normalized.c
    };
    if (normalized.a) ball.a = true;
    if (normalized.k) ball.k = true;
    balls.push(ball);
  }
  const spec = { shots: state.shots, queue: state.queue.slice(0, state.shots), balls };
  if (state.obstaclePreset && state.obstaclePreset !== 'none') {
    spec.obstaclePreset = state.obstaclePreset;
  }
  return spec;
}

/** Hydrates builder state from a decoded custom puzzle spec. */
export function applySpecToBuilderState(state, spec, cfg = DEFAULT_CFG) {
  state.cells.clear();
  for (const ball of spec.balls || []) {
    const col = Math.max(0, Math.min(cfg.gridCols - 1, Math.round((ball.x - cfg.gridStartX) / cfg.gridStepX)));
    const row = Math.max(0, Math.min(cfg.gridRows - 1, Math.round((ball.y - cfg.gridStartY) / cfg.gridStepY)));
    state.cells.set(`${col},${row}`, { c: ball.c, a: Boolean(ball.a), k: Boolean(ball.k) });
  }
  state.shots = Math.max(1, Math.min(cfg.maxShots, Number(spec.shots) || cfg.defaultShots));
  state.queue = Array.isArray(spec.queue) && spec.queue.length > 0 ? [...spec.queue] : [cfg.colors?.[0] || DEFAULT_COLORS[0]];
  state.obstaclePreset = PUZZLE_OBSTACLE_KINDS.includes(spec.obstaclePreset) ? spec.obstaclePreset : 'none';
}

function toggleGridCell(state, key) {
  const existing = state.cells.get(key);
  if (state.activeTool === BUILDER_TOOLS.SPHERE) {
    if (existing && existing.c === state.activeColor && !existing.a && !existing.k) {
      state.cells.delete(key);
    } else {
      state.cells.set(key, { c: state.activeColor, a: false, k: false });
    }
    return;
  }
  const flag = state.activeTool === BUILDER_TOOLS.ANCHOR ? 'a' : 'k';
  if (existing) {
    existing[flag] = !existing[flag];
  } else {
    state.cells.set(key, { c: state.activeColor, a: flag === 'a', k: flag === 'k' });
  }
}

function formatCellVisual(entry) {
  if (!entry) return '';
  const sym = COLOR_SYMBOLS[entry.c] || '\u25cf';
  const badge = `${entry.a ? '\u2693' : ''}${entry.k ? '\ud83d\udc8e' : ''}`;
  return `${sym}${badge}`;
}

function buildCellAriaLabel(col, row, entry) {
  const pos = { col: col + 1, row: row + 1 };
  if (!entry) {
    return t('modals.puzzleBuilder.cellEmptyAria', pos);
  }
  const colorName = t(`modals.puzzleBuilder.colors.${entry.c}`);
  const roleKey = entry.k ? 'modals.puzzleBuilder.tools.core' : entry.a ? 'modals.puzzleBuilder.tools.anchor' : 'modals.puzzleBuilder.tools.sphere';
  return t('modals.puzzleBuilder.cellFilledAria', { ...pos, color: colorName, kind: t(roleKey) });
}

function handleGridKeydown(e, col, row, cfg, gridEl, state, onChange) {
  const delta = GRID_ARROW_DELTAS[e.key];
  if (delta) {
    e.preventDefault();
    const nextCol = (col + delta[0] + cfg.gridCols) % cfg.gridCols;
    const nextRow = (row + delta[1] + cfg.gridRows) % cfg.gridRows;
    gridEl.querySelector?.(`[data-cell="${nextCol},${nextRow}"]`)?.focus();
    return;
  }
  if (/^[1-6]$/.test(e.key)) {
    const idx = Number(e.key) - 1;
    if (cfg.colors[idx]) {
      e.preventDefault();
      state.activeColor = cfg.colors[idx];
      onChange();
    }
  }
}

function renderGridCells(gridEl, state, cfg, onChange) {
  const activeCellKey = document.activeElement?.dataset?.cell || null;
  gridEl.replaceChildren();
  for (let r = 0; r < cfg.gridRows; r++) {
    for (let c = 0; c < cfg.gridCols; c++) {
      const key = `${c},${r}`;
      const entry = state.cells.get(key) || null;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'puzzle-builder-cell';
      btn.dataset.cell = key;
      if (entry) btn.dataset.ballColor = entry.c;
      btn.setAttribute('aria-pressed', String(Boolean(entry)));
      btn.setAttribute('aria-label', buildCellAriaLabel(c, r, entry));
      btn.textContent = formatCellVisual(entry);
      btn.addEventListener('click', () => {
        toggleGridCell(state, key);
        onChange();
      });
      btn.addEventListener('keydown', (e) => handleGridKeydown(e, c, r, cfg, gridEl, state, onChange));
      gridEl.appendChild(btn);
    }
  }
  if (activeCellKey) {
    gridEl.querySelector?.(`[data-cell="${activeCellKey}"]`)?.focus();
  }
}

function renderQueuePills(queueEl, state, cfg, onChange) {
  queueEl.replaceChildren();
  for (let i = 0; i < state.shots; i++) {
    const color = state.queue[i] || cfg.colors[0];
    state.queue[i] = color;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'puzzle-builder-queue-pill';
    pill.dataset.ballColor = color;
    const colorName = t(`modals.puzzleBuilder.colors.${color}`);
    pill.textContent = `#${i + 1} ${COLOR_SYMBOLS[color] || ''}`.trim();
    pill.setAttribute('aria-label', t('modals.puzzleBuilder.queuePillAria', { index: i + 1, color: colorName }));
    pill.addEventListener('click', () => {
      state.queue[i] = cfg.colors[(cfg.colors.indexOf(color) + 1) % cfg.colors.length];
      onChange();
    });
    queueEl.appendChild(pill);
  }
}

function collectBuilderElements() {
  const byId = (id) => document.getElementById(id);
  return {
    modal: byId('modal-puzzle-builder'),
    gridEl: byId('puzzle-builder-grid'),
    queueEl: byId('puzzle-builder-queue'),
    shotsSelect: byId('puzzle-builder-shots'),
    obstacleSelect: byId('puzzle-builder-obstacle'),
    paletteEl: byId('puzzle-builder-palette'),
    toolsEl: byId('puzzle-builder-tools'),
    countEl: byId('puzzle-builder-count'),
    importInput: byId('puzzle-builder-import-input'),
    importBtn: byId('btn-puzzle-builder-import'),
    clearBtn: byId('btn-puzzle-builder-clear'),
    statusEl: byId('puzzle-builder-status'),
    openBtn: byId('btn-puzzle-builder'),
    closeBtn: byId('btn-close-puzzle-builder'),
    playBtn: byId('btn-puzzle-builder-play'),
    copyBtn: byId('btn-puzzle-builder-copy')
  };
}

function syncBuilderControls(els, state, cfg, render) {
  renderGridCells(els.gridEl, state, cfg, render);
  renderQueuePills(els.queueEl, state, cfg, render);
  if (els.shotsSelect) els.shotsSelect.value = String(state.shots);
  if (els.obstacleSelect) els.obstacleSelect.value = state.obstaclePreset;
  if (els.countEl) els.countEl.textContent = t('modals.puzzleBuilder.count', { count: state.cells.size, max: cfg.maxBalls });
  for (const swatch of els.paletteEl?.querySelectorAll?.('[data-builder-color]') ?? []) {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.builderColor === state.activeColor));
  }
  for (const tool of els.toolsEl?.querySelectorAll?.('[data-builder-tool]') ?? []) {
    tool.setAttribute('aria-pressed', String(tool.dataset.builderTool === state.activeTool));
  }
}

async function handleCopyShareLink(els, state, cfg) {
  const spec = buildSpecFromBuilderState(state, cfg);
  if (spec.balls.length === 0) {
    if (els.statusEl) els.statusEl.textContent = t('modals.puzzleBuilder.emptyError');
    return;
  }
  const url = buildCustomPuzzleUrl(window.location?.href || '', spec);
  if (!url) {
    if (els.statusEl) els.statusEl.textContent = t('modals.puzzleBuilder.tooLargeError');
    return;
  }
  try {
    await navigator.clipboard?.writeText?.(url);
    if (els.statusEl) els.statusEl.textContent = t('modals.puzzleBuilder.copied');
  } catch {
    if (els.statusEl) els.statusEl.textContent = url;
  }
}

function bindBuilderActionListeners(ui, els, state, cfg, render) {
  els.clearBtn?.addEventListener('click', () => {
    state.cells.clear();
    if (els.statusEl) els.statusEl.textContent = '';
    render();
  });
  els.importBtn?.addEventListener('click', () => {
    const payload = extractPuzzlePayload(els.importInput?.value || '');
    const decoded = payload ? decodeCustomPuzzle(payload) : null;
    if (!decoded) {
      if (els.statusEl) els.statusEl.textContent = t('modals.puzzleBuilder.invalidImportError');
      return;
    }
    applySpecToBuilderState(state, decoded, cfg);
    if (els.importInput) els.importInput.value = '';
    if (els.statusEl) els.statusEl.textContent = t('modals.puzzleBuilder.imported');
    render();
  });
  els.playBtn?.addEventListener('click', () => {
    const spec = buildSpecFromBuilderState(state, cfg);
    if (spec.balls.length === 0) {
      if (els.statusEl) els.statusEl.textContent = t('modals.puzzleBuilder.emptyError');
      return;
    }
    ui.hideAllModals();
    ui.engine.startPuzzleMode(1, { customSpec: spec });
  });
  els.copyBtn?.addEventListener('click', () => handleCopyShareLink(els, state, cfg));
}

/** Wires the Custom Puzzle Builder modal events once during UI setup. */
export function bindPuzzleBuilderModal(ui) {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') {
    return;
  }
  const els = collectBuilderElements();
  if (!els.modal || !els.gridEl || !els.queueEl || !els.openBtn) {
    return;
  }
  const cfg = resolveBuilderConfig(ui);
  const state = createInitialBuilderState(cfg);
  const render = () => syncBuilderControls(els, state, cfg, render);
  const openBuilder = (spec = null) => {
    if (spec) applySpecToBuilderState(state, spec, cfg);
    render();
    if (els.statusEl) els.statusEl.textContent = '';
    ui.openOverlayModal(els.modal, els.closeBtn);
  };
  ui.openPuzzleBuilder = openBuilder;

  els.paletteEl?.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('[data-builder-color]');
    if (btn) { state.activeColor = btn.dataset.builderColor; render(); }
  });
  els.toolsEl?.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('[data-builder-tool]');
    if (btn) { state.activeTool = btn.dataset.builderTool; render(); }
  });
  els.shotsSelect?.addEventListener('change', () => {
    state.shots = Math.max(1, Math.min(cfg.maxShots, Number(els.shotsSelect.value) || cfg.defaultShots));
    render();
  });
  els.obstacleSelect?.addEventListener('change', () => {
    state.obstaclePreset = els.obstacleSelect.value || 'none';
    render();
  });
  els.openBtn.addEventListener('click', () => openBuilder());
  els.closeBtn?.addEventListener('click', () => ui.closeOverlayModal(els.modal));
  bindBuilderActionListeners(ui, els, state, cfg, render);
}
