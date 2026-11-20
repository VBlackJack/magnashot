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
import { buildCustomPuzzleUrl } from '../game/PuzzleShareCodec.js';

const BUILDER_COLORS = Object.freeze(['crimson', 'cobalt', 'emerald', 'amber', 'violet', 'cyan']);
const GRID_COLS = 7;
const GRID_ROWS = 4;
const GRID_START_X = 115;
const GRID_START_Y = 120;
const GRID_STEP_X = 40;
const GRID_STEP_Y = 38;
const DEFAULT_SHOTS = 2;
const MAX_BUILDER_SHOTS = 6;

function createInitialBuilderState() {
  const cells = new Map();
  cells.set('2,0', 'crimson');
  cells.set('3,0', 'crimson');
  cells.set('4,0', 'cobalt');
  cells.set('3,1', 'cobalt');
  return {
    activeColor: 'crimson',
    shots: DEFAULT_SHOTS,
    queue: ['crimson', 'cobalt'],
    cells
  };
}

export function buildSpecFromBuilderState(state) {
  const balls = [];
  for (const [key, color] of state.cells.entries()) {
    const [col, row] = key.split(',').map(Number);
    balls.push({
      x: GRID_START_X + col * GRID_STEP_X,
      y: GRID_START_Y + row * GRID_STEP_Y,
      c: color
    });
  }
  return {
    shots: state.shots,
    queue: state.queue.slice(0, state.shots),
    balls
  };
}

function renderGridCells(gridEl, state, onChange) {
  gridEl.replaceChildren();
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const key = `${c},${r}`;
      const cellColor = state.cells.get(key) || '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'puzzle-builder-cell';
      if (cellColor) {
        btn.dataset.ballColor = cellColor;
      }
      btn.setAttribute('aria-pressed', String(Boolean(cellColor)));
      btn.textContent = cellColor ? '●' : '';
      btn.addEventListener('click', () => {
        if (state.cells.get(key) === state.activeColor) {
          state.cells.delete(key);
        } else {
          state.cells.set(key, state.activeColor);
        }
        onChange();
      });
      gridEl.appendChild(btn);
    }
  }
}

function renderQueuePills(queueEl, state, onChange) {
  queueEl.replaceChildren();
  for (let i = 0; i < state.shots; i++) {
    const color = state.queue[i] || BUILDER_COLORS[0];
    state.queue[i] = color;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'puzzle-builder-queue-pill';
    pill.dataset.ballColor = color;
    pill.textContent = `#${i + 1}`;
    pill.addEventListener('click', () => {
      const next = BUILDER_COLORS[(BUILDER_COLORS.indexOf(color) + 1) % BUILDER_COLORS.length];
      state.queue[i] = next;
      onChange();
    });
    queueEl.appendChild(pill);
  }
}

/** Wires the Custom Puzzle Builder modal events once during UI setup. */
export function bindPuzzleBuilderModal(ui) {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') {
    return;
  }
  const modal = document.getElementById('modal-puzzle-builder');
  const gridEl = document.getElementById('puzzle-builder-grid');
  const queueEl = document.getElementById('puzzle-builder-queue');
  const shotsSelect = document.getElementById('puzzle-builder-shots');
  const paletteEl = document.getElementById('puzzle-builder-palette');
  const statusEl = document.getElementById('puzzle-builder-status');
  const openBtn = document.getElementById('btn-puzzle-builder');
  const closeBtn = document.getElementById('btn-close-puzzle-builder');
  const playBtn = document.getElementById('btn-puzzle-builder-play');
  const copyBtn = document.getElementById('btn-puzzle-builder-copy');
  if (!modal || !gridEl || !queueEl || !openBtn) {
    return;
  }

  const state = createInitialBuilderState();
  const render = () => {
    renderGridCells(gridEl, state, render);
    renderQueuePills(queueEl, state, render);
    for (const swatch of paletteEl?.querySelectorAll?.('[data-builder-color]') ?? []) {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.builderColor === state.activeColor));
    }
  };

  paletteEl?.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('[data-builder-color]');
    if (btn) {
      state.activeColor = btn.dataset.builderColor;
      render();
    }
  });
  shotsSelect?.addEventListener('change', () => {
    state.shots = Math.max(1, Math.min(MAX_BUILDER_SHOTS, Number(shotsSelect.value) || DEFAULT_SHOTS));
    render();
  });
  openBtn.addEventListener('click', () => {
    render();
    if (statusEl) {
      statusEl.textContent = '';
    }
    modal.classList.remove('hidden');
  });
  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));
  playBtn?.addEventListener('click', () => {
    const spec = buildSpecFromBuilderState(state);
    if (spec.balls.length === 0) {
      if (statusEl) {
        statusEl.textContent = t('modals.puzzleBuilder.emptyError');
      }
      return;
    }
    modal.classList.add('hidden');
    ui.hideAllModals();
    ui.engine.startPuzzleMode(1, { customSpec: spec });
  });
  copyBtn?.addEventListener('click', async () => {
    const url = buildCustomPuzzleUrl(window.location?.href || '', buildSpecFromBuilderState(state));
    if (!url) {
      if (statusEl) {
        statusEl.textContent = t('modals.puzzleBuilder.emptyError');
      }
      return;
    }
    try {
      await navigator.clipboard?.writeText?.(url);
      if (statusEl) {
        statusEl.textContent = t('modals.puzzleBuilder.copied');
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = url;
      }
    }
  });
}
