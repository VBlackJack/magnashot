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

/** Particle, liquid, wall-crack and shatter rendering methods installed on Renderer.prototype. */
export const rendererParticlesMethods = {
  /** The liquid at the bottom of the board, rippling where falling spheres land. */
  drawLiquid(ctx, particleSystem, width, height) {
    const pCfg = this.gameConfig.juice.particles;
    const heights = particleSystem.liquidHeights;
    const columnWidth = width / (heights.length - 1);
    const surfaceY = height - pCfg.liquidDepth;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < heights.length; i++) {
      ctx.lineTo(i * columnWidth, surfaceY + heights[i]);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = pCfg.liquidFillColor;
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < heights.length; i++) {
      ctx.lineTo(i * columnWidth, surfaceY + heights[i]);
    }
    ctx.strokeStyle = pCfg.liquidLineColor;
    ctx.lineWidth = pCfg.liquidLineWidth;
    ctx.stroke();
    ctx.restore();
  },

  /** Cracks left on the side walls by the run's bouncing shots. */
  drawWallCracks(ctx, particleSystem) {
    if (particleSystem.wallCracks.length === 0) {
      return;
    }
    const pCfg = this.gameConfig.juice.particles;
    ctx.save();
    ctx.strokeStyle = pCfg.wallCrackColor;
    ctx.lineWidth = pCfg.wallCrackLineWidth;
    ctx.beginPath();
    for (const crack of particleSystem.wallCracks) {
      ctx.moveTo(crack[0].x, crack[0].y);
      for (let i = 1; i < crack.length; i++) {
        ctx.lineTo(crack[i].x, crack[i].y);
      }
    }
    ctx.stroke();
    ctx.restore();
  },

  drawTrail(ctx, particleSystem) {
    if (particleSystem.trailParticles.length === 0) {
      return;
    }
    ctx.save();
    for (const tp of particleSystem.trailParticles) {
      ctx.fillStyle = tp.color;
      ctx.globalAlpha = Math.max(0, tp.alpha);
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, tp.radius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  },

  /**
   * Draws spheres currently in their swell-and-shatter destruction animation: the sphere
   * visibly swells outward, glows white-hot from within, and splits along radial fracture lines.
   */
  drawShatteringBalls(ctx, particleSystem, now, alpha = 1.0) {
    if (this.isReducedMotion || !particleSystem?.shatteringBalls?.length) {
      return;
    }
    const pCfg = this.gameConfig.juice.particles;
    for (const sb of particleSystem.shatteringBalls) {
      const sbX = this.interpolate(sb.prevX ?? sb.x, sb.x, alpha);
      const sbY = this.interpolate(sb.prevY ?? sb.y, sb.y, alpha);
      const sbScale = this.interpolate(sb.prevScale ?? sb.scale, sb.scale, alpha);
      const sbAlpha = Math.max(0, this.interpolate(sb.prevAlpha ?? sb.alpha, sb.alpha, alpha));
      if (sbAlpha <= 0 || sbScale <= 0) {
        continue;
      }
      const interpAge = this.interpolate(sb.prevAge ?? sb.age, sb.age, alpha);
      const progress = Math.min(1, Math.max(0, interpAge / Math.max(1, sb.maxAge)));

      ctx.save();
      ctx.translate(sbX, sbY);
      ctx.scale(sbScale, sbScale);
      ctx.globalAlpha = sbAlpha;
      this.drawBallAt(ctx, sb, 0, 0, now);

      ctx.globalCompositeOperation = 'lighter';
      const coreAlpha = sbAlpha * progress * pCfg.shatterCoreFlashAlpha;
      if (coreAlpha > 0) {
        let grad = this.shatterCoreGradients.get(sb.burstColor);
        if (!grad || this.shatterCoreGradientCtx !== ctx) {
          if (this.shatterCoreGradientCtx !== ctx) {
            this.shatterCoreGradients.clear();
            this.shatterCoreGradientCtx = ctx;
          }
          grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          grad.addColorStop(0, pCfg.flashCoreColor);
          grad.addColorStop(pCfg.flashMidStop, sb.burstColor);
          grad.addColorStop(1, pCfg.flashEdgeColor);
          this.shatterCoreGradients.set(sb.burstColor, grad);
        }
        // The shared gradient has unit radius: scale it to the ball inside its own save/restore.
        ctx.save();
        ctx.scale(sb.radius, sb.radius);
        ctx.fillStyle = grad;
        ctx.globalAlpha = coreAlpha;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();
        ctx.restore();
      }

      if (sb.cracks) {
        ctx.strokeStyle = sb.burstColor;
        ctx.lineWidth = pCfg.shatterCrackGlowWidth;
        ctx.globalAlpha = sbAlpha;
        ctx.beginPath();
        for (const crack of sb.cracks) {
          if (crack.length < 2) {
            continue;
          }
          ctx.moveTo(crack[0].x, crack[0].y);
          for (let i = 1; i < crack.length; i++) {
            ctx.lineTo(crack[i].x, crack[i].y);
          }
        }
        ctx.stroke();

        ctx.strokeStyle = pCfg.flashCoreColor;
        ctx.lineWidth = pCfg.shatterCrackCoreWidth;
        ctx.stroke();
      }
      ctx.restore();
    }
  },

  /**
   * Returns a cached unit-radius radial gradient for an explosion layer. The colour stops are
   * baked once per kind, colour and phase; callers scale the context to the radius.
   */
  getUnitRadialGradient(ctx, kind, color, phase = 0) {
    if (this.unitRadialGradientCtx !== ctx) {
      this.unitRadialGradients.clear();
      this.unitRadialGradientCtx = ctx;
    }
    const pCfg = this.gameConfig.juice.particles;
    const key = `${kind}|${color}|${phase}`;
    let grad = this.unitRadialGradients.get(key);
    if (!grad) {
      grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      if (kind === 'puff') {
        if (phase === 0) {
          grad.addColorStop(0, pCfg.flashCoreColor);
          grad.addColorStop(pCfg.flashMidStop, pCfg.explosionHotColor);
          grad.addColorStop(1, color);
        } else if (phase === 1) {
          grad.addColorStop(0, pCfg.explosionHotColor);
          grad.addColorStop(pCfg.flashMidStop, color);
          grad.addColorStop(1, pCfg.explosionEmberColor);
        } else {
          grad.addColorStop(0, color);
          grad.addColorStop(pCfg.flashMidStop, pCfg.explosionEmberColor);
          grad.addColorStop(1, pCfg.explosionSmokeColor);
        }
      } else {
        grad.addColorStop(0, pCfg.flashCoreColor);
        grad.addColorStop(pCfg.flashMidStop, color);
        grad.addColorStop(1, pCfg.flashEdgeColor);
      }
      this.unitRadialGradients.set(key, grad);
    }
    return grad;
  },

  /** Fills a unit-radius gradient scaled to radius r and centred on (x, y). */
  fillUnitCircle(ctx, grad, x, y, r, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(r, r);
    ctx.fillStyle = grad;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.restore();
  },

  drawParticles(ctx, particleSystem, alpha = 1.0) {
    const pCfg = this.gameConfig.juice.particles;
    const theme = this.gameConfig.theme;
    ctx.save();

    if (particleSystem.explosions) {
      for (const ex of particleSystem.explosions) {
        if (ex.kind !== 'puff') {
          continue;
        }
        const exX = this.interpolate(ex.prevX ?? ex.x, ex.x, alpha);
        const exY = this.interpolate(ex.prevY ?? ex.y, ex.y, alpha);
        const exRadius = this.interpolate(ex.prevRadius ?? ex.radius, ex.radius, alpha);
        const exAlpha = Math.max(0, this.interpolate(ex.prevAlpha ?? ex.alpha, ex.alpha, alpha));
        if (exRadius <= 0 || exAlpha <= 0) {
          continue;
        }
        const interpAge = this.interpolate(ex.prevAge ?? ex.age, ex.age, alpha);
        const progress = Math.min(1, Math.max(0, interpAge / Math.max(1, ex.maxAge)));
        const phase = progress < pCfg.explosionHotPhaseEnd ? 0 : (progress < pCfg.explosionFirePhaseEnd ? 1 : 2);
        const grad = this.getUnitRadialGradient(ctx, 'puff', ex.color, phase);
        this.fillUnitCircle(ctx, grad, exX, exY, exRadius, exAlpha);
      }
    }

    ctx.globalCompositeOperation = 'lighter';

    if (particleSystem.explosions) {
      for (const ex of particleSystem.explosions) {
        if (ex.kind !== 'core') {
          continue;
        }
        const exRadius = this.interpolate(ex.prevRadius ?? ex.radius, ex.radius, alpha);
        const exAlpha = Math.max(0, this.interpolate(ex.prevAlpha ?? ex.alpha, ex.alpha, alpha));
        if (exRadius <= 0 || exAlpha <= 0) {
          continue;
        }
        this.fillUnitCircle(ctx, this.getUnitRadialGradient(ctx, 'core', ex.color), ex.x, ex.y, exRadius, exAlpha);

        if (ex.rays) {
          ctx.strokeStyle = pCfg.flashCoreColor;
          ctx.lineWidth = pCfg.explosionRayWidth;
          ctx.globalAlpha = exAlpha;
          ctx.beginPath();
          for (const ray of ex.rays) {
            const rayLen = exRadius * ray.lenFactor;
            ctx.moveTo(ex.x, ex.y);
            ctx.lineTo(ex.x + Math.cos(ray.angle) * rayLen, ex.y + Math.sin(ray.angle) * rayLen);
          }
          ctx.stroke();
        }
      }
    }

    if (particleSystem.flashes) {
      for (const fl of particleSystem.flashes) {
        const flRadius = this.interpolate(fl.prevRadius ?? fl.radius, fl.radius, alpha);
        const flAlpha = Math.max(0, this.interpolate(fl.prevAlpha ?? fl.alpha, fl.alpha, alpha));
        if (flRadius <= 0 || flAlpha <= 0) {
          continue;
        }
        this.fillUnitCircle(ctx, this.getUnitRadialGradient(ctx, 'flash', fl.color), fl.x, fl.y, flRadius, flAlpha);
      }
    }

    for (const sw of particleSystem.shockwaves) {
      const swRadius = this.interpolate(sw.prevRadius ?? sw.radius, sw.radius, alpha);
      const swAlpha = Math.max(0, this.interpolate(sw.prevAlpha ?? sw.alpha, sw.alpha, alpha));
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = swAlpha;
      ctx.lineWidth = sw.lineWidth ?? pCfg.shockwaveLineWidth;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, swRadius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
    }

    for (const streak of particleSystem.streaks) {
      // The trail bows sideways, like a rocket that turned toward its target.
      const curveSign = streak.curveSign ?? 1;
      const curveFactor = pCfg.streakCurveFactor * curveSign;
      const midX = (streak.x1 + streak.x2) * MATH_CONSTANTS.HALF - (streak.y2 - streak.y1) * curveFactor;
      const midY = (streak.y1 + streak.y2) * MATH_CONSTANTS.HALF + (streak.x2 - streak.x1) * curveFactor;
      const streakAlpha = Math.max(0, this.interpolate(streak.prevAlpha ?? streak.alpha, streak.alpha, alpha));
      ctx.strokeStyle = streak.color;
      ctx.globalAlpha = streakAlpha * pCfg.streakGlowAlphaFactor;
      ctx.lineWidth = pCfg.streakGlowLineWidth;
      ctx.beginPath();
      ctx.moveTo(streak.x1, streak.y1);
      ctx.quadraticCurveTo(midX, midY, streak.x2, streak.y2);
      ctx.stroke();

      ctx.globalAlpha = streakAlpha;
      ctx.lineWidth = pCfg.streakLineWidth;
      ctx.stroke();
    }

    for (const bolt of particleSystem.lightningBolts) {
      if (bolt.segments.length < 2) {
        continue;
      }
      const boltAlpha = Math.max(0, this.interpolate(bolt.prevAlpha ?? bolt.alpha, bolt.alpha, alpha));
      ctx.strokeStyle = bolt.color;
      ctx.globalAlpha = boltAlpha * pCfg.lightningGlowAlphaFactor;
      ctx.lineWidth = pCfg.lightningGlowLineWidth;
      ctx.beginPath();
      ctx.moveTo(bolt.segments[0].x, bolt.segments[0].y);
      for (let i = 1; i < bolt.segments.length; i++) {
        ctx.lineTo(bolt.segments[i].x, bolt.segments[i].y);
      }
      ctx.stroke();

      ctx.strokeStyle = bolt.color;
      ctx.globalAlpha = boltAlpha;
      ctx.lineWidth = pCfg.lightningLineWidth;
      ctx.stroke();

      ctx.strokeStyle = pCfg.flashCoreColor;
      ctx.lineWidth = pCfg.lightningCoreLineWidth;
      ctx.stroke();

      if (bolt.branches) {
        ctx.strokeStyle = bolt.color;
        ctx.lineWidth = pCfg.lightningBranchLineWidth;
        for (const branch of bolt.branches) {
          if (branch.length < 2) {
            continue;
          }
          ctx.beginPath();
          ctx.moveTo(branch[0].x, branch[0].y);
          for (let j = 1; j < branch.length; j++) {
            ctx.lineTo(branch[j].x, branch[j].y);
          }
          ctx.stroke();
        }
      }
    }

    for (const p of particleSystem.particles) {
      const px = this.interpolate(p.prevX, p.x, alpha);
      const py = this.interpolate(p.prevY, p.y, alpha);
      const pAlpha = Math.max(0, p.alpha);
      const speed = Math.hypot(p.vx || 0, p.vy || 0);
      if (speed >= pCfg.sparkTailMinSpeed) {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = pAlpha;
        ctx.lineWidth = p.radius * pCfg.sparkTailWidthFactor;
        ctx.beginPath();
        ctx.moveTo(px - p.vx * pCfg.sparkTailLengthFactor, py - p.vy * pCfg.sparkTailLengthFactor);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
      ctx.fillStyle = p.color;
      ctx.globalAlpha = pAlpha;
      ctx.beginPath();
      ctx.arc(px, py, p.radius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();

      ctx.fillStyle = pCfg.flashCoreColor;
      ctx.beginPath();
      ctx.arc(px, py, p.radius * pCfg.sparkCoreRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';

    const shadowColor = theme.floatingTextShadowColor;
    const shadowOffset = pCfg.floatingTextShadowOffset;
    const wallMargin = this.gameConfig.canvas.wallMargin;
    const maxTextWidth = Math.max(0, this.logicalWidth - wallMargin * 2);
    ctx.font = this.floatingTextFont;
    ctx.textAlign = 'center';
    for (const ft of particleSystem.floatingTexts) {
      const fy = this.interpolate(ft.prevY, ft.y, alpha);
      const measuredWidth = Math.min(maxTextWidth, ctx.measureText?.(ft.text)?.width || 0);
      const halfWidth = measuredWidth * MATH_CONSTANTS.HALF;
      const minX = wallMargin + halfWidth;
      const maxX = Math.max(minX, this.logicalWidth - wallMargin - halfWidth);
      const fx = Math.min(maxX, Math.max(minX, ft.x));
      ctx.globalAlpha = Math.max(0, ft.alpha);
      const scale = ft.scale && ft.scale !== 1 ? ft.scale : 1;
      if (scale !== 1) {
        ctx.save();
        ctx.translate(fx, fy);
        ctx.scale(scale, scale);
        ctx.fillStyle = shadowColor;
        ctx.fillText(ft.text, shadowOffset, shadowOffset, maxTextWidth);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, 0, 0, maxTextWidth);
        ctx.restore();
      } else {
        ctx.fillStyle = shadowColor;
        ctx.fillText(ft.text, fx + shadowOffset, fy + shadowOffset, maxTextWidth);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, fx, fy, maxTextWidth);
      }
    }

    ctx.restore();
  }
};
