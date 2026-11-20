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

import { MATH_CONSTANTS } from '../../core/Constants.js';
import { t } from '../../core/I18n.js';
import { MERGE_SPECIAL_KINDS } from './MergeSpecials.js';

const WALL_LINE_WIDTH = 3;
const OVERFLOW_DASH = Object.freeze([8, 6]);
const DROP_GUIDE_DASH = Object.freeze([5, 6]);
const OVERFLOW_LINE_ALPHA = 0.72;
const DROP_GUIDE_ALPHA = 0.36;
const BASIN_GLOW_ALPHA = 0.14;
const GHOST_PREVIEW_LINE_WIDTH = 2;
const GHOST_MERGE_RING_OFFSET = 5;
const PRESSURE_ZONE_ALPHA = 0.1;
const TELEGRAPH_DASH = Object.freeze([3, 5]);
const TELEGRAPH_ALPHA = 0.85;
const TELEGRAPH_LINE_WIDTH = 2;
const TELEGRAPH_TICK_LENGTH = 14;
const TELEGRAPH_TICK_WIDTH = 3;
const PULSE_RING_GAP = 4;
const PULSE_RING_WIDTH = 2;
const PULSE_RING_ALPHA = 0.85;
const PEG_OUTLINE_WIDTH = 2;
const PEG_FILL_ALPHA = 0.55;
const PEG_OUTLINE_ALPHA = 0.9;

function drawBombMark(behavior, ctx, engine, theme, ball, x, y, look) {
  const radius = ball.radius;
  ctx.globalAlpha = look.bombAlpha;
  ctx.fillStyle = look.bombColor;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;
  const fuseSec = behavior.getSpecialTimerSec(engine, ball.mergeKind);
  if (Number.isFinite(ball.mergeSpecialSec) && fuseSec > 0) {
    const remaining = Math.max(0, Math.min(1, ball.mergeSpecialSec / fuseSec));
    const start = -Math.PI * MATH_CONSTANTS.HALF;
    ctx.strokeStyle = theme.dangerLineColor;
    ctx.lineWidth = look.ringWidth;
    ctx.beginPath();
    ctx.arc(x, y, radius + look.ringGap, start, start + remaining * MATH_CONSTANTS.TWO_PI);
    ctx.stroke();
  }
}

function drawIceMark(ctx, radius, x, y, look) {
  ctx.globalAlpha = look.iceAlpha;
  ctx.fillStyle = look.iceColor;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = look.iceOutlineColor;
  ctx.lineWidth = look.ringWidth;
  ctx.setLineDash(look.iceOutlineDash);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, MATH_CONSTANTS.TWO_PI);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawJokerMark(ctx, radius, x, y, look) {
  const ringColors = look.jokerRingColors;
  const arc = MATH_CONSTANTS.TWO_PI / ringColors.length;
  ctx.lineWidth = look.ringWidth;
  ringColors.forEach((color, idx) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius + look.ringGap, idx * arc, (idx + 1) * arc);
    ctx.stroke();
  });
}

/** Merge Basin canvas rendering methods installed on MergeBehavior.prototype. */
export const mergeRendererMethods = {
  drawDropGuide(ctx, engine, cfg, geometry, theme, basinStrokeColor) {
    if (!engine.isRunPlaying() || !engine.currentBall || engine.isAimCancelled) {
      return;
    }
    const r = engine.currentBall.radius;
    const dropX = this.clampDropX(engine, engine.mergeDropX, r);
    const currentTier = this.getTierSpecById(engine, engine.currentBall.colorId)?.tier ?? 0;
    const restingY = this.predictDropLandingY(engine, cfg, dropX, r, geometry);
    const touchesSameTier = this.hasEqualTierContactAt(engine, dropX, restingY, r, currentTier);
    const guideColor = engine.isPolarityFlipped ? theme.overchargePopupColor : basinStrokeColor;
    const ghostColor = touchesSameTier ? (theme.targetHighlightColor || theme.overchargePopupColor) : guideColor;
    const guideBottomY = Math.max(cfg.launcherY + r, restingY - r);

    ctx.strokeStyle = guideColor;
    ctx.globalAlpha = DROP_GUIDE_ALPHA;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(DROP_GUIDE_DASH);
    ctx.beginPath();
    ctx.moveTo(dropX, cfg.launcherY + r);
    ctx.lineTo(dropX, guideBottomY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (typeof ctx.arc !== 'function' || typeof ctx.fill !== 'function') {
      return;
    }
    ctx.fillStyle = ghostColor;
    ctx.globalAlpha = theme.aimGhostFillAlpha ?? 0.28;
    ctx.beginPath();
    ctx.arc(dropX, restingY, r, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.strokeStyle = ghostColor;
    ctx.globalAlpha = theme.aimGhostStrokeAlpha ?? 0.85;
    ctx.lineWidth = theme.aimGhostLineWidth ?? GHOST_PREVIEW_LINE_WIDTH;
    ctx.stroke();
    if (touchesSameTier) {
      ctx.beginPath();
      ctx.arc(dropX, restingY, r + GHOST_MERGE_RING_OFFSET, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
    }
  },

  drawUnderlay(ctx, engine, renderer, theme) {
    const cfg = engine.modesConfig.merge;
    const geometry = this.getBasinGeometry(engine);
    const basinW = geometry.right - geometry.left;
    const lineY = this.getOverflowLineY(engine);
    const basinH = geometry.floor - lineY;
    const basinStrokeColor = theme.launcherAccentColor || theme.aimLineColor;

    ctx.save();
    ctx.fillStyle = basinStrokeColor;
    ctx.globalAlpha = BASIN_GLOW_ALPHA * 0.35;
    ctx.fillRect(geometry.left, lineY, basinW, basinH);

    if (lineY > cfg.overflowLineY) {
      ctx.fillStyle = theme.dangerLineColor;
      ctx.globalAlpha = PRESSURE_ZONE_ALPHA;
      ctx.fillRect(geometry.left, cfg.overflowLineY, basinW, lineY - cfg.overflowLineY);
    }

    ctx.strokeStyle = basinStrokeColor;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = WALL_LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(geometry.left, cfg.overflowLineY - 24);
    ctx.lineTo(geometry.left, geometry.floor);
    ctx.lineTo(geometry.right, geometry.floor);
    ctx.lineTo(geometry.right, cfg.overflowLineY - 24);
    ctx.stroke();
    this.drawPegs(ctx, geometry, theme);

    const overflowRatio = engine.modeState?.maxOverflowRatio ?? 0;
    ctx.strokeStyle = theme.dangerLineColor;
    ctx.globalAlpha = OVERFLOW_LINE_ALPHA + overflowRatio * 0.25;
    ctx.lineWidth = overflowRatio > 0 ? 2.5 : 1.5;
    ctx.setLineDash(OVERFLOW_DASH);
    ctx.beginPath();
    ctx.moveTo(geometry.left + 4, lineY);
    ctx.lineTo(geometry.right - 4, lineY);
    ctx.stroke();
    ctx.setLineDash([]);

    this.drawPressureTelegraph(ctx, engine, theme, geometry);
    this.drawDropGuide(ctx, engine, cfg, geometry, theme, basinStrokeColor);
    ctx.restore();
  },

  drawPressureTelegraph(ctx, engine, theme, geometry) {
    const cfg = engine.modesConfig.merge;
    const pending = engine.modeState?.pendingOffsetPx ?? null;
    if (pending === null) {
      return;
    }
    const y = cfg.overflowLineY + pending;
    ctx.strokeStyle = theme.dangerLineColor;
    ctx.globalAlpha = TELEGRAPH_ALPHA;
    ctx.lineWidth = TELEGRAPH_LINE_WIDTH;
    ctx.setLineDash(TELEGRAPH_DASH);
    ctx.beginPath();
    ctx.moveTo(geometry.left + 4, y);
    ctx.lineTo(geometry.right - 4, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = TELEGRAPH_TICK_WIDTH;
    ctx.beginPath();
    ctx.moveTo(geometry.left, y);
    ctx.lineTo(geometry.left + TELEGRAPH_TICK_LENGTH, y);
    ctx.moveTo(geometry.right, y);
    ctx.lineTo(geometry.right - TELEGRAPH_TICK_LENGTH, y);
    ctx.stroke();
  },

  drawPegs(ctx, geometry, theme) {
    ctx.fillStyle = theme.aimLineColor;
    ctx.strokeStyle = theme.aimLineColor;
    ctx.lineWidth = PEG_OUTLINE_WIDTH;
    for (const peg of geometry.pegs) {
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.radius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.globalAlpha = PEG_FILL_ALPHA;
      ctx.fill();
      ctx.globalAlpha = PEG_OUTLINE_ALPHA;
      ctx.stroke();
    }
  },

  drawSpecialMark(ctx, engine, theme, ball, x, y) {
    const kind = ball.mergeKind;
    const look = this.getSpecialsConfig(engine).render;
    ctx.save();
    if (kind === MERGE_SPECIAL_KINDS.BOMB) {
      drawBombMark(this, ctx, engine, theme, ball, x, y, look);
    } else if (kind === MERGE_SPECIAL_KINDS.ICE) {
      drawIceMark(ctx, ball.radius, x, y, look);
    } else if (kind === MERGE_SPECIAL_KINDS.JOKER) {
      drawJokerMark(ctx, ball.radius, x, y, look);
    }
    ctx.font = `${Math.round(ball.radius * look.glyphSizeFactor)}px ${look.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = look.glyphStrokeWidth;
    ctx.strokeStyle = look.glyphStroke;
    ctx.fillStyle = look.glyphFill;
    const glyph = t(`gameplay.merge.specials.${kind}.icon`);
    ctx.strokeText(glyph, x, y);
    ctx.fillText(glyph, x, y);
    ctx.restore();
  },

  drawLauncherOverlay(ctx, engine, renderer, theme) {
    const spec = this.getLauncherSpec(engine);
    if (engine.currentBall?.mergeKind) {
      this.drawSpecialMark(ctx, engine, theme, engine.currentBall, engine.mergeDropX ?? spec.x, spec.y);
    }
    if (engine.nextBall?.mergeKind) {
      this.drawSpecialMark(ctx, engine, theme, engine.nextBall, spec.x + spec.nextOffsetX, spec.y + spec.nextOffsetY);
    }
  },

  drawOverlay(ctx, engine, renderer, theme) {
    let hasPulsing = false;
    for (const ball of engine.physicsWorld.balls) {
      if (ball.mergeKind) {
        this.drawSpecialMark(ctx, engine, theme, ball, ball.x, ball.y);
      }
      if ((ball.mergePulseSec || 0) > 0) {
        hasPulsing = true;
      }
    }
    if (!hasPulsing) {
      return;
    }
    ctx.save();
    ctx.strokeStyle = theme.overchargePopupColor;
    ctx.globalAlpha = PULSE_RING_ALPHA;
    ctx.lineWidth = PULSE_RING_WIDTH;
    for (const ball of engine.physicsWorld.balls) {
      if ((ball.mergePulseSec || 0) <= 0) {
        continue;
      }
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius + PULSE_RING_GAP, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
    }
    ctx.restore();
  }
};
