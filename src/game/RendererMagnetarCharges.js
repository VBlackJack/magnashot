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
import { CHARGE_OUTCOMES } from './VersusRules.js';

const EMPTY_DASH = Object.freeze([]);
/** Shape ratios of the aim preview outcome marks (fractions of the mark size). */
const OUTCOME_ARROW_DEPTH = 0.4;
const OUTCOME_ARROW_HEAD = 0.9;
const OUTCOME_CRACK_INNER = 0.3;

// Badge glyph shapes per Magnetar behaviour, as polylines in a [-1, 1] box (stroked, never text).
// `circle` is the radius of an open arc (0 for none). Shapes differ in structure, not colour.
const MAGNETAR_GLYPHS = Object.freeze({
  invert: Object.freeze({
    lines: Object.freeze([
      Object.freeze([[-1, -0.45], [1, -0.45]]),
      Object.freeze([[0.45, -0.95], [1, -0.45], [0.45, 0.05]]),
      Object.freeze([[1, 0.45], [-1, 0.45]]),
      Object.freeze([[-0.45, -0.05], [-1, 0.45], [-0.45, 0.95]])
    ]),
    circle: 0
  }),
  undertow: Object.freeze({
    lines: Object.freeze([Object.freeze([[0.1, 0.95], [-0.45, 0.6], [0.1, 0.25]])]),
    circle: 0.75
  }),
  regrow: Object.freeze({
    lines: Object.freeze([
      Object.freeze([[-0.8, -0.1], [0.8, -0.1], [0.8, 0.9], [-0.8, 0.9], [-0.8, -0.1]]),
      Object.freeze([[0, 0.5], [0, -0.9]]),
      Object.freeze([[-0.45, -0.45], [0, -0.9], [0.45, -0.45]])
    ]),
    circle: 0
  }),
  barrage: Object.freeze({
    lines: Object.freeze([
      Object.freeze([[-0.8, -0.9], [0, -0.4], [0.8, -0.9]]),
      Object.freeze([[-0.8, -0.2], [0, 0.3], [0.8, -0.2]]),
      Object.freeze([[-0.8, 0.5], [0, 1], [0.8, 0.5]])
    ]),
    circle: 0
  })
});
const MAGNETAR_ARC_SWEEP = 0.75;
const BRACKET_REACH_FACTOR = 1.25;
const BRACKET_SERIF_FACTOR = 0.5;
const BADGE_GLYPH_FACTOR = 0.55;
const FIELD_RING_PULSE_DEPTH = 0.2;
const FIELD_RING_BASE_ALPHA = 0.6;
const HALF = 0.5;

/**
 * Magnetar overlay and Polarity Duel / Barrage charge rendering methods installed onto
 * `Renderer.prototype` by `Renderer.js`.
 */
export const rendererMagnetarChargesMethods = {
  /** Reads the Magnetar state from a full engine or an immutable view. @private */
  resolveMagnetarView(engineState) {
    const view = typeof engineState.getMagnetarView === 'function'
      ? engineState.getMagnetarView()
      : engineState.magnetarView;
    return view && typeof view === 'object' ? view : null;
  },

  /**
   * Draws the Polarity Duel charged spheres and the aim-preview charge ring.
   * Accessibility: the body is neutral, polarity is carried by a large +/- glyph and by the
   * outline style (solid for +, dashed for -), never by colour alone; strength 2 adds a second
   * ring and a threatening charge gets a thicker outline plus an outer halo.
   * Lite boards draw charges too (gameplay-critical) but without the rise trail.
   * The charge radius is `versus.chargeRadius` times the physics ball radius.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} engineState Engine carrying `versus.charges` (and optionally
   *   `versus.threatIds`) and `aimPreview.chargeHit` ({x, y, polarity}).
   */
  drawVersusCharges(ctx, engineState) {
    const versus = engineState.versus;
    const cfg = this.gameConfig.versus;
    const renderCfg = cfg?.render;
    if (!versus || !renderCfg) {
      return;
    }
    const baseRadius = engineState.physicsWorld?.physicsConfig?.ball?.radius;
    if (!(baseRadius > 0)) {
      return;
    }
    const radius = baseRadius * cfg.chargeRadius;
    const charges = Array.isArray(versus.charges) ? versus.charges : [];
    const threatIds = versus.threatIds ? new Set(versus.threatIds) : null;
    this.drawChargeList(ctx, charges, threatIds, radius);
    const hit = !this.lite ? engineState.aimPreview?.chargeHit : null;
    if (hit) {
      this.drawChargePreviewRing(ctx, hit, radius, renderCfg);
    }
  },

  /**
   * Draws a list of charged spheres with the shared charge style (Polarity Duel and Magnetar
   * Barrage). The rise trail is skipped on lite boards and under reduced motion.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<Object>} charges Charges with `polarity`, `strength`, `x`, `y`.
   * @param {Set<number>|null} threatIds Ids of charges about to land.
   * @param {number} radius Drawn charge radius.
   */
  drawChargeList(ctx, charges, threatIds, radius) {
    const renderCfg = this.gameConfig.versus?.render;
    if (!renderCfg) {
      return;
    }
    const showTrail = !this.lite && !this.isReducedMotion;
    for (const charge of charges) {
      const threatening = Boolean(charge.threatening) || Boolean(threatIds?.has(charge.id));
      this.drawOneCharge(ctx, charge, radius, renderCfg, threatening, showTrail);
    }
  },

  /** Draws the live Barrage charges of a Magnetar board. @private */
  drawMagnetarCharges(ctx, engineState, view) {
    const baseRadius = engineState.physicsWorld?.physicsConfig?.ball?.radius;
    const chargeRadius = this.gameConfig.versus?.chargeRadius;
    if (!(baseRadius > 0) || !(chargeRadius > 0)) {
      return;
    }
    const radius = baseRadius * chargeRadius;
    this.drawChargeList(ctx, view.charges, null, radius);
    const renderCfg = this.gameConfig.versus?.render;
    const hit = !this.lite ? engineState.aimPreview?.chargeHit : null;
    if (hit && renderCfg) {
      this.drawChargePreviewRing(ctx, hit, radius, renderCfg);
    }
  },

  /**
   * Draws the Magnetar overlay: dark core with field rings, heavy dashed Mooring lines with a
   * bracket on each anchor, the warning badge (one stroked glyph shape per behaviour), Regrow
   * slot outlines, the Undertow radius and the Barrage markers on the danger line.
   * Every cue is a shape or a dash pattern, never colour alone. Lite boards skip the field halo.
   * Draws nothing without a Magnetar view.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} engineState
   * @param {number} now Animation clock in ms (already frozen under reduced motion).
   */
  drawMagnetar(ctx, engineState, now) {
    const view = this.magnetarView ?? this.resolveMagnetarView(engineState);
    const cfg = this.gameConfig.magnetar?.render;
    const r = engineState.physicsWorld?.physicsConfig?.ball?.radius;
    if (!view || !cfg || !(r > 0)) {
      return;
    }
    this.drawMagnetarField(ctx, view, cfg, r, now);
    this.drawMagnetarMoorings(ctx, engineState, view, cfg, r);
    this.drawMagnetarTelegraphs(ctx, view, cfg, r);
    if (view.armed) {
      this.drawMagnetarBadge(ctx, view, cfg, r);
    }
  },

  /** @private */
  drawMagnetarField(ctx, view, cfg, r, now) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(view.x, view.y, r, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fillStyle = cfg.coreColor;
    ctx.fill();
    if (!this.lite) {
      // Static rings under reduced motion; otherwise they breathe on a fixed period.
      const wave = this.isReducedMotion
        ? 0
        : Math.sin((now / cfg.ringPulsePeriodMs) * MATH_CONSTANTS.TWO_PI);
      ctx.strokeStyle = cfg.fieldColor;
      ctx.lineWidth = cfg.ringLineWidth;
      ctx.globalAlpha = FIELD_RING_BASE_ALPHA + FIELD_RING_PULSE_DEPTH * wave;
      for (let i = 1; i <= cfg.ringCount; i++) {
        ctx.beginPath();
        ctx.arc(view.x, view.y, r * (1 + i * cfg.ringSpacingFactor), 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  /** @private */
  drawMagnetarMoorings(ctx, engineState, view, cfg, r) {
    const ids = Array.isArray(view.mooringIds) ? view.mooringIds : (Array.isArray(view.moorings) ? view.moorings : []);
    const ballMap = engineState.physicsWorld?.ballMap;
    if (!ids.length || !ballMap) {
      return;
    }
    const reach = r * BRACKET_REACH_FACTOR;
    const half = r * cfg.bracketSizeFactor;
    const serif = half * BRACKET_SERIF_FACTOR;
    ctx.save();
    ctx.strokeStyle = cfg.mooringColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = cfg.mooringLineWidth;
    for (const id of ids) {
      const anchor = ballMap.get(id);
      if (!anchor) {
        continue;
      }
      ctx.setLineDash([r * cfg.mooringDashFactor, r * cfg.mooringDashFactor]);
      ctx.beginPath();
      ctx.moveTo(view.x, view.y);
      ctx.lineTo(anchor.x, anchor.y);
      ctx.stroke();
      ctx.setLineDash(EMPTY_DASH);
      ctx.beginPath();
      ctx.moveTo(anchor.x - reach + serif, anchor.y - half);
      ctx.lineTo(anchor.x - reach, anchor.y - half);
      ctx.lineTo(anchor.x - reach, anchor.y + half);
      ctx.lineTo(anchor.x - reach + serif, anchor.y + half);
      ctx.moveTo(anchor.x + reach - serif, anchor.y - half);
      ctx.lineTo(anchor.x + reach, anchor.y - half);
      ctx.lineTo(anchor.x + reach, anchor.y + half);
      ctx.lineTo(anchor.x + reach - serif, anchor.y + half);
      ctx.stroke();
    }
    ctx.restore();
  },

  /** @private */
  drawMagnetarTelegraphs(ctx, view, cfg, r) {
    const slots = Array.isArray(view.regrowSlots) ? view.regrowSlots : [];
    const markers = Array.isArray(view.barrageMarkers) ? view.barrageMarkers : [];
    if (!slots.length && !view.undertow && !markers.length) {
      return;
    }
    ctx.save();
    ctx.lineCap = 'round';
    if (slots.length) {
      ctx.strokeStyle = cfg.fieldColor;
      ctx.lineWidth = cfg.slotLineWidth;
      ctx.setLineDash([r * cfg.slotDashFactor, r * cfg.slotDashFactor]);
      for (const slot of slots) {
        ctx.beginPath();
        ctx.arc(slot.x, slot.y, r, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
      }
      ctx.setLineDash(EMPTY_DASH);
    }
    if (view.undertow) {
      ctx.strokeStyle = cfg.fieldColor;
      ctx.lineWidth = cfg.fieldLineWidth;
      // Dots: a zero-length dash with round caps.
      ctx.setLineDash([0, r * cfg.fieldDotFactor * 2]);
      ctx.beginPath();
      ctx.arc(view.undertow.x, view.undertow.y, view.undertow.radius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
      ctx.setLineDash(EMPTY_DASH);
    }
    const versusCfg = this.gameConfig.versus?.render;
    if (markers.length && versusCfg) {
      const y = this.gameConfig.canvas.dangerLineY;
      const markerHalf = r * cfg.markerSizeFactor;
      ctx.lineWidth = versusCfg.glyphLineWidth;
      for (const marker of markers) {
        ctx.strokeStyle = marker.polarity > 0 ? versusCfg.plusColor : versusCfg.minusColor;
        this.drawPolarityGlyph(ctx, marker.x, y, markerHalf, marker.polarity);
      }
    }
    ctx.restore();
  },

  /** @private */
  drawMagnetarBadge(ctx, view, cfg, r) {
    const glyph = MAGNETAR_GLYPHS[view.armed];
    if (!glyph) {
      return;
    }
    const bx = view.x;
    const by = view.y - r * cfg.badgeOffsetFactor;
    const radius = r * cfg.badgeRadiusFactor;
    const s = radius * BADGE_GLYPH_FACTOR * 2 * HALF;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(bx, by, radius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fillStyle = cfg.badgeBackground;
    ctx.fill();
    ctx.strokeStyle = cfg.badgeColor;
    ctx.lineWidth = cfg.fieldLineWidth;
    ctx.stroke();
    ctx.beginPath();
    for (const line of glyph.lines) {
      ctx.moveTo(bx + line[0][0] * s, by + line[0][1] * s);
      for (let i = 1; i < line.length; i++) {
        ctx.lineTo(bx + line[i][0] * s, by + line[i][1] * s);
      }
    }
    ctx.stroke();
    if (glyph.circle > 0) {
      ctx.beginPath();
      ctx.arc(bx, by, glyph.circle * s, 0, MATH_CONSTANTS.TWO_PI * MAGNETAR_ARC_SWEEP);
      ctx.stroke();
    }
    ctx.restore();
  },

  /**
   * Strokes a large plus (both bars) or minus (horizontal bar only) glyph.
   * @private
   */
  drawPolarityGlyph(ctx, x, y, half, polarity) {
    ctx.beginPath();
    ctx.moveTo(x - half, y);
    ctx.lineTo(x + half, y);
    if (polarity > 0) {
      ctx.moveTo(x, y - half);
      ctx.lineTo(x, y + half);
    }
    ctx.stroke();
  },

  /** @private */
  drawOneCharge(ctx, charge, radius, renderCfg, threatening, showTrail) {
    const plus = charge.polarity > 0;
    const color = plus ? renderCfg.plusColor : renderCfg.minusColor;
    const dash = plus ? EMPTY_DASH : renderCfg.outlineDash;
    ctx.save();
    ctx.lineCap = 'round';
    if (showTrail) {
      ctx.fillStyle = color;
      const segments = renderCfg.trailSegments;
      for (let i = 1; i <= segments; i++) {
        const fade = 1 - i / (segments + 1);
        ctx.globalAlpha = renderCfg.trailAlpha * fade;
        ctx.beginPath();
        ctx.arc(charge.x, charge.y + i * radius * renderCfg.trailSpacingFactor, radius * fade, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(charge.x, charge.y, radius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fillStyle = renderCfg.bodyFill;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = threatening ? renderCfg.threatOutlineWidth : renderCfg.outlineWidth;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash(EMPTY_DASH);
    if (charge.strength >= 2) {
      ctx.beginPath();
      ctx.arc(charge.x, charge.y, radius + renderCfg.strengthRingGap, 0, MATH_CONSTANTS.TWO_PI);
      ctx.lineWidth = renderCfg.strengthRingWidth;
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash(EMPTY_DASH);
    }
    if (threatening) {
      ctx.globalAlpha = renderCfg.threatHaloAlpha;
      ctx.beginPath();
      ctx.arc(charge.x, charge.y, radius + renderCfg.threatHaloGap, 0, MATH_CONSTANTS.TWO_PI);
      ctx.lineWidth = renderCfg.threatHaloWidth;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = renderCfg.glyphLineWidth;
    this.drawPolarityGlyph(ctx, charge.x, charge.y, radius * renderCfg.glyphSizeFactor, charge.polarity);
    ctx.restore();
  },

  /** @private */
  drawChargePreviewRing(ctx, hit, radius, renderCfg) {
    const color = hit.polarity > 0 ? renderCfg.plusColor : renderCfg.minusColor;
    ctx.save();
    ctx.globalAlpha = renderCfg.previewAlpha;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = renderCfg.previewRingWidth;
    ctx.setLineDash(hit.polarity > 0 ? EMPTY_DASH : renderCfg.previewRingDash);
    ctx.beginPath();
    ctx.arc(hit.x, hit.y, radius * renderCfg.previewRingRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
    ctx.stroke();
    ctx.setLineDash(EMPTY_DASH);
    ctx.lineWidth = renderCfg.previewGlyphLineWidth;
    this.drawPolarityGlyph(ctx, hit.x, hit.y, radius * renderCfg.previewGlyphSizeFactor, hit.polarity);
    if (hit.outcome) {
      this.drawPreviewOutcomeMark(ctx, hit, radius, renderCfg);
    }
    ctx.restore();
  },

  /**
   * Marks what the loaded shot would do to the charge it meets, by shape and not by colour: a
   * jagged crack when the charge is shattered (or weakened), a bent rebound arrow when the shot
   * bounces off. Drawn beside the preview ring.
   * @private
   */
  drawPreviewOutcomeMark(ctx, hit, radius, renderCfg) {
    const cx = hit.x;
    const cy = hit.y - radius * renderCfg.previewOutcomeGapFactor;
    const half = radius * renderCfg.previewOutcomeSizeFactor;
    ctx.strokeStyle = renderCfg.previewOutcomeColor;
    ctx.lineWidth = renderCfg.previewOutcomeLineWidth;
    ctx.lineJoin = 'round';
    ctx.setLineDash(EMPTY_DASH);
    ctx.beginPath();
    if (hit.outcome === CHARGE_OUTCOMES.DEFLECTED) {
      ctx.moveTo(cx - half, cy - half);
      ctx.lineTo(cx, cy + half * OUTCOME_ARROW_DEPTH);
      ctx.lineTo(cx + half, cy - half);
      ctx.moveTo(cx + half - half * OUTCOME_ARROW_HEAD, cy - half);
      ctx.lineTo(cx + half, cy - half);
      ctx.lineTo(cx + half, cy - half + half * OUTCOME_ARROW_HEAD);
    } else {
      ctx.moveTo(cx - half, cy - half);
      ctx.lineTo(cx - half * OUTCOME_CRACK_INNER, cy);
      ctx.lineTo(cx + half * OUTCOME_CRACK_INNER, cy - half * OUTCOME_CRACK_INNER);
      ctx.lineTo(cx + half, cy + half);
    }
    ctx.stroke();
  },

  /**
   * Draws the +/- of a shot on a launcher ball (a backdrop stroke first, so the sign reads on
   * any ball colour), with the glyph style of the charges.
   * @private
   */
  drawShotPolarityGlyph(ctx, x, y, half, polarity) {
    const renderCfg = this.gameConfig.versus.render;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash(EMPTY_DASH);
    ctx.strokeStyle = renderCfg.launcherGlyphBackdrop;
    ctx.lineWidth = renderCfg.launcherGlyphLineWidth + renderCfg.launcherGlyphBackdropExtraWidth;
    this.drawPolarityGlyph(ctx, x, y, half, polarity);
    ctx.strokeStyle = polarity > 0 ? renderCfg.plusColor : renderCfg.minusColor;
    ctx.lineWidth = renderCfg.launcherGlyphLineWidth;
    this.drawPolarityGlyph(ctx, x, y, half, polarity);
    ctx.restore();
  }
};
