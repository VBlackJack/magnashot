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

import { ARENA_THEMES, MATH_CONSTANTS } from '../core/Constants.js';

const SOLAR_EMBER_COUNT = 10;
const CRYO_CRYSTAL_COUNT = 8;
const SYNTHWAVE_BAND_COUNT = 5;
const COMBO_TIER_LOW = 5;
const COMBO_TIER_HIGH = 10;
const COMBO_AURA_LOW_COLOR = '#38bdf8';
const COMBO_AURA_HIGH_COLOR = '#facc15';
const SOLAR_EMBER_COLOR = '#fb923c';
const CRYO_CRYSTAL_COLOR = '#bae6fd';
const SYNTHWAVE_SCAN_COLOR = '#e879f9';

function drawSolarForgeAmbient(ctx, width, height, now) {
  ctx.fillStyle = SOLAR_EMBER_COLOR;
  for (let i = 0; i < SOLAR_EMBER_COUNT; i++) {
    const phase = ((now * 0.00018 + i * 0.137) % 1);
    const x = ((i * 97 + 41) % Math.max(1, Math.floor(width - 40))) + 20 + Math.sin(now * 0.0014 + i) * 10;
    const y = height - phase * (height * 0.55);
    const radius = 1.6 + (i % 3) * 0.7;
    ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.28;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
  }
}

function drawCryoLabAmbient(ctx, width, height, now) {
  ctx.strokeStyle = CRYO_CRYSTAL_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i < CRYO_CRYSTAL_COUNT; i++) {
    const phase = ((now * 0.00011 + i * 0.173) % 1);
    const x = ((i * 113 + 35) % Math.max(1, Math.floor(width - 40))) + 20 + Math.cos(now * 0.001 + i) * 8;
    const y = phase * height * 0.85;
    const r = 3 + (i % 2) * 1.5;
    ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.22;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.stroke();
  }
}

function drawSynthwaveAmbient(ctx, width, height, now) {
  const horizonTop = height * 0.58;
  const span = height - horizonTop;
  ctx.strokeStyle = SYNTHWAVE_SCAN_COLOR;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < SYNTHWAVE_BAND_COUNT; i++) {
    const phase = ((now * 0.00022 + i / SYNTHWAVE_BAND_COUNT) % 1);
    const y = horizonTop + phase * phase * span;
    ctx.globalAlpha = (1 - phase) * 0.16;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawHorizonGlow(layerCtx, theme, width, height, canvasCfg) {
  if (!theme.horizonGlowColor || !theme.transparentColor || typeof layerCtx.createRadialGradient !== 'function') {
    return;
  }
  const launcherY = canvasCfg.launcherY ?? (height - (canvasCfg.launcherBottomOffset || 0));
  const glowRadius = width * theme.horizonGlowRadiusFactor;
  const horizonGrad = layerCtx.createRadialGradient(
    width * MATH_CONSTANTS.HALF,
    launcherY,
    0,
    width * MATH_CONSTANTS.HALF,
    launcherY,
    glowRadius
  );
  horizonGrad.addColorStop(0, theme.horizonGlowColor);
  horizonGrad.addColorStop(1, theme.transparentColor);
  layerCtx.fillStyle = horizonGrad;
  layerCtx.fillRect(0, 0, width, height);
}

function drawVignette(layerCtx, theme, width, height) {
  if (!theme.vignetteColor || !theme.transparentColor || typeof layerCtx.createRadialGradient !== 'function') {
    return;
  }
  const cx = width * MATH_CONSTANTS.HALF;
  const cy = height * MATH_CONSTANTS.HALF;
  const vignetteGrad = layerCtx.createRadialGradient(
    cx,
    cy,
    width * theme.vignetteInnerRadiusFactor,
    cx,
    cy,
    height * theme.vignetteOuterRadiusFactor
  );
  vignetteGrad.addColorStop(0, theme.transparentColor);
  vignetteGrad.addColorStop(1, theme.vignetteColor);
  layerCtx.fillStyle = vignetteGrad;
  layerCtx.fillRect(0, 0, width, height);
}

/** Arena static-layer, animated theme ambient, and combo-tier aura methods installed on Renderer.prototype. */
export const rendererArenaMethods = {
  /**
   * Pre-renders the static background gradient, grid and walls at backing-store
   * resolution so each frame blits one image instead of redrawing them.
   */
  buildStaticLayer() {
    if (!this.staticLayer) {
      this.staticLayer = this.createLayerCanvas();
    }
    this.staticLayer.width = this.canvas.width;
    this.staticLayer.height = this.canvas.height;
    const layerCtx = this.staticLayer.getContext('2d');
    const override = this.activeArenaTheme && this.activeArenaTheme !== ARENA_THEMES.DEEP_SPACE
      ? this.gameConfig.arenaThemes?.[this.activeArenaTheme]
      : null;
    const theme = override ? { ...this.gameConfig.theme, ...override } : this.gameConfig.theme;
    const width = this.logicalWidth;
    const height = this.logicalHeight;

    layerCtx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
    const bgGradient = layerCtx.createLinearGradient(0, 0, 0, height);
    bgGradient.addColorStop(0, theme.backgroundTop);
    bgGradient.addColorStop(1, theme.backgroundBottom);
    layerCtx.fillStyle = bgGradient;
    layerCtx.fillRect(0, 0, width, height);
    drawHorizonGlow(layerCtx, theme, width, height, this.gameConfig.canvas);
    this.drawGrid(layerCtx, width, height, theme);
    drawVignette(layerCtx, theme, width, height);
    this.drawWalls(layerCtx, width, height, theme);
    this.staticLayerDirty = false;
  },

  drawGrid(ctx, width, height, theme) {
    ctx.strokeStyle = theme.gridLineColor;
    ctx.lineWidth = theme.gridLineWidth;
    const step = theme.gridSize;
    ctx.beginPath();
    for (let x = step; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = step; y < height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    if (!theme.gridNodeColor || !theme.gridNodeSize) {
      return;
    }
    const nodeSize = theme.gridNodeSize;
    const halfNode = nodeSize * MATH_CONSTANTS.HALF;
    ctx.fillStyle = theme.gridNodeColor;
    for (let x = step; x < width; x += step) {
      for (let y = step; y < height; y += step) {
        ctx.fillRect(x - halfNode, y - halfNode, nodeSize, nodeSize);
      }
    }
  },

  drawWalls(ctx, width, height, theme) {
    const margin = this.gameConfig.canvas.wallMargin;
    const inset = margin * MATH_CONSTANTS.HALF;
    ctx.strokeStyle = theme.wallGlowColor;
    ctx.lineWidth = theme.wallGlowLineWidth;
    ctx.strokeRect(inset, inset, width - margin, height - margin);
    ctx.strokeStyle = theme.wallColor;
    ctx.lineWidth = theme.wallLineWidth;
    ctx.strokeRect(inset, inset, width - margin, height - margin);
    if (!theme.wallCornerColor || !theme.wallCornerLength) {
      return;
    }
    const right = width - inset;
    const bottom = height - inset;
    const len = theme.wallCornerLength;
    ctx.strokeStyle = theme.wallCornerColor;
    ctx.lineWidth = theme.wallCornerLineWidth || theme.wallLineWidth;
    ctx.beginPath();
    ctx.moveTo(inset, inset + len);
    ctx.lineTo(inset, inset);
    ctx.lineTo(inset + len, inset);
    ctx.moveTo(right - len, inset);
    ctx.lineTo(right, inset);
    ctx.lineTo(right, inset + len);
    ctx.moveTo(inset, bottom - len);
    ctx.lineTo(inset, bottom);
    ctx.lineTo(inset + len, bottom);
    ctx.moveTo(right - len, bottom);
    ctx.lineTo(right, bottom);
    ctx.lineTo(right, bottom - len);
    ctx.stroke();
  },

  /** Draws subtle animated ambient details for unlockable Arena Themes (skipped under Reduced Motion). */
  drawAnimatedArenaAmbient(ctx, width, height, now) {
    if (this.isReducedMotion || this.lite || now <= 0) {
      return;
    }
    const id = this.activeArenaTheme;
    if (!id || id === ARENA_THEMES.DEEP_SPACE) {
      return;
    }
    ctx.save();
    if (id === ARENA_THEMES.SOLAR_FORGE) {
      drawSolarForgeAmbient(ctx, width, height, now);
    } else if (id === ARENA_THEMES.CRYO_LAB) {
      drawCryoLabAmbient(ctx, width, height, now);
    } else if (id === ARENA_THEMES.SYNTHWAVE) {
      drawSynthwaveAmbient(ctx, width, height, now);
    }
    ctx.restore();
  },

  /** Escalates the arena perimeter glow at 5x and 10x combo streaks (static under Reduced Motion). */
  drawComboTierAura(ctx, engineState, width, height, now) {
    const combo = engineState?.combo || 0;
    if (combo < COMBO_TIER_LOW) {
      return;
    }
    const isHighTier = combo >= COMBO_TIER_HIGH;
    const pulse = this.isReducedMotion ? 1 : 0.72 + 0.28 * Math.sin(now * 0.008);
    const margin = this.gameConfig.canvas.wallMargin * MATH_CONSTANTS.HALF;
    ctx.save();
    ctx.strokeStyle = isHighTier ? COMBO_AURA_HIGH_COLOR : COMBO_AURA_LOW_COLOR;
    ctx.lineWidth = isHighTier ? 4 : 2.5;
    ctx.globalAlpha = (isHighTier ? 0.42 : 0.25) * pulse;
    ctx.strokeRect(margin, margin, width - margin * 2, height - margin * 2);
    ctx.restore();
  }
};
