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

export class ParticleSystem {
  constructor(juiceConfig) {
    this.juiceConfig = juiceConfig;
    this.cfg = juiceConfig.particles;
    this.particles = [];
    this.trailParticles = [];
    this.shockwaves = [];
    this.flashes = [];
    this.explosions = [];
    this.shatteringBalls = [];
    this.floatingTexts = [];
    this.lightningBolts = [];
    this.streaks = [];
    this.screenFlash = null;
    // Surface of the liquid at the bottom of the board: one height and speed per column.
    this.liquidHeights = new Array(this.cfg.liquidColumns).fill(0);
    this.liquidVelocities = new Array(this.cfg.liquidColumns).fill(0);
    // Cracks left by shots bouncing off the side walls; they last for the whole run.
    this.wallCracks = [];
    this.particlePool = [];
    this.trailPool = [];
    this.shockwavePool = [];
    this.flashPool = [];
    this.explosionPool = [];
    this.shatterPool = [];
    this.textPool = [];
    this.shakeIntensity = 0;
    this.reducedMotion = false;
    this.animationSpeed = 1;
  }

  /**
   * @param {number} speed - Positive animation speed multiplier (e.g. 0.5, 1, 1.5, 2).
   */
  setAnimationSpeed(speed) {
    this.animationSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  }

  setReducedMotion(enabled) {
    this.reducedMotion = Boolean(enabled);
    if (this.reducedMotion) {
      this.clearDecorativeEffects();
    }
  }

  /** Drops every effect except the floating texts, which carry information. */
  clearDecorativeEffects() {
    while (this.particles.length > 0) {
      this.particlePool.push(this.particles.pop());
    }
    while (this.trailParticles.length > 0) {
      this.trailPool.push(this.trailParticles.pop());
    }
    while (this.shockwaves.length > 0) {
      this.shockwavePool.push(this.shockwaves.pop());
    }
    while (this.flashes.length > 0) {
      this.flashPool.push(this.flashes.pop());
    }
    while (this.explosions.length > 0) {
      this.explosionPool.push(this.explosions.pop());
    }
    while (this.shatteringBalls.length > 0) {
      this.shatterPool.push(this.shatteringBalls.pop());
    }
    this.screenFlash = null;
    this.lightningBolts.length = 0;
    this.streaks.length = 0;
    this.shakeIntensity = 0;
  }

  clear() {
    this.clearDecorativeEffects();
    this.wallCracks.length = 0;
    this.liquidHeights.fill(0);
    this.liquidVelocities.fill(0);
    while (this.floatingTexts.length > 0) {
      this.textPool.push(this.floatingTexts.pop());
    }
  }

  /** Springs every column back to rest and lets its ripple spread to its neighbors. */
  updateLiquid() {
    const cfg = this.cfg;
    const heights = this.liquidHeights;
    const velocities = this.liquidVelocities;
    for (let i = 0; i < heights.length; i++) {
      velocities[i] += -cfg.liquidTension * heights[i] - cfg.liquidDampening * velocities[i];
      heights[i] += velocities[i];
    }
    for (let i = 0; i < heights.length; i++) {
      if (i > 0) {
        velocities[i - 1] += cfg.liquidSpread * (heights[i] - heights[i - 1]) * MATH_CONSTANTS.HALF;
      }
      if (i < heights.length - 1) {
        velocities[i + 1] += cfg.liquidSpread * (heights[i] - heights[i + 1]) * MATH_CONSTANTS.HALF;
      }
    }
  }

  removeAt(list, index, pool = null) {
    const removed = list[index];
    const lastIndex = list.length - 1;
    if (index !== lastIndex) {
      list[index] = list[lastIndex];
    }
    list.pop();
    if (pool && removed) {
      pool.push(removed);
    }
  }

  addScreenShake(amount, maxOffset = this.juiceConfig.maxShakeOffset) {
    if (this.reducedMotion) {
      return;
    }
    this.shakeIntensity = Math.min(maxOffset, this.shakeIntensity + amount);
  }

  // Reduced motion keeps floating texts, which carry information, and drops the purely
  // decorative effects: trails, bursts, shockwaves, lightning flashes and screen shake.

  spawnTrail(x, y, radius, color) {
    if (this.reducedMotion) {
      return;
    }
    const cfg = this.cfg;
    const item = this.trailPool.pop() || {};
    item.x = x + (Math.random() - MATH_CONSTANTS.HALF) * cfg.trailSpread;
    item.y = y + (Math.random() - MATH_CONSTANTS.HALF) * cfg.trailSpread;
    item.radius = radius * cfg.trailRadiusFactor;
    item.color = color;
    item.alpha = cfg.trailInitialAlpha;
    this.trailParticles.push(item);
  }

  spawnBurst(x, y, color, count = this.cfg.burstDefaultCount, speed = this.cfg.burstDefaultSpeed) {
    if (this.reducedMotion) {
      return;
    }
    const cfg = this.cfg;
    // Trim instead of recycling a live item: swap-removal breaks age order and prev* interpolation.
    count = Math.min(count, cfg.maxParticles - this.particles.length);
    if (count <= 0) {
      return;
    }
    for (let i = 0; i < count; i++) {
      const angle = (MATH_CONSTANTS.TWO_PI * i) / count + (Math.random() - MATH_CONSTANTS.HALF) * cfg.burstAngleJitter;
      const mag = (cfg.burstSpeedMinFactor + Math.random() * cfg.burstSpeedRangeFactor) * speed;
      const item = this.particlePool.pop() || {};
      item.x = x;
      item.y = y;
      item.prevX = x;
      item.prevY = y;
      item.vx = Math.cos(angle) * mag;
      item.vy = Math.sin(angle) * mag;
      item.radius = cfg.burstMinRadius + Math.random() * cfg.burstRadiusRange;
      item.color = color;
      item.alpha = 1;
      item.decay = cfg.burstBaseDecay + Math.random() * cfg.burstDecayRange;
      this.particles.push(item);
    }
  }

  spawnShockwave(x, y, color, maxRadius = this.cfg.shockwaveDefaultMaxRadius, options = null) {
    if (this.reducedMotion) {
      return;
    }
    const cfg = this.cfg;
    const item = this.shockwavePool.pop() || {};
    item.x = x;
    item.y = y;
    item.radius = options?.initialRadius ?? cfg.shockwaveInitialRadius;
    item.prevRadius = item.radius;
    item.maxRadius = maxRadius;
    item.color = color;
    item.alpha = options?.initialAlpha ?? cfg.shockwaveInitialAlpha;
    item.prevAlpha = item.alpha;
    item.expandRate = options?.expandRate ?? cfg.shockwaveExpandRate;
    item.alphaDecay = options?.alphaDecay ?? cfg.shockwaveAlphaDecay;
    item.lineWidth = options?.lineWidth ?? cfg.shockwaveLineWidth;
    this.shockwaves.push(item);
  }

  /** Spawns a radial detonation flash / core bloom at (x, y). */
  spawnFlash(x, y, color, maxRadius = this.cfg.shockwaveDefaultMaxRadius) {
    if (this.reducedMotion) {
      return;
    }
    const cfg = this.cfg;
    const item = this.flashPool.pop() || {};
    item.x = x;
    item.y = y;
    item.radius = maxRadius * cfg.flashInitialRadiusFactor;
    item.prevRadius = item.radius;
    item.maxRadius = maxRadius;
    item.color = color;
    item.alpha = cfg.flashInitialAlpha;
    item.prevAlpha = item.alpha;
    item.alphaDecay = cfg.flashAlphaDecay;
    this.flashes.push(item);
  }

  /**
   * Spawns a multi-stage fireball explosion at (x, y): screen impact flash, central starburst
   * with radial light spikes, and a ring of billowing fireball/smoke cloud puffs.
   */
  spawnExplosion(x, y, blastRadius = this.cfg.shockwaveDefaultMaxRadius, color = this.cfg.explosionFireColor) {
    if (this.reducedMotion) {
      return;
    }
    const cfg = this.cfg;
    this.screenFlash = {
      color,
      alpha: cfg.screenFlashInitialAlpha,
      prevAlpha: cfg.screenFlashInitialAlpha,
      decay: cfg.screenFlashDecay
    };

    const core = this.explosionPool.pop() || {};
    core.kind = 'core';
    core.x = x;
    core.y = y;
    core.prevX = x;
    core.prevY = y;
    core.vx = 0;
    core.vy = 0;
    core.radius = blastRadius * cfg.explosionCoreStartFactor;
    core.prevRadius = core.radius;
    core.maxRadius = blastRadius * cfg.explosionCoreMaxFactor;
    core.color = color;
    core.age = 0;
    core.prevAge = 0;
    core.maxAge = cfg.explosionCoreFrames;
    core.alpha = 1.0;
    core.prevAlpha = 1.0;
    const rayCount = cfg.explosionRayCount;
    // The array and its ray objects stay with the pooled item so a spawn allocates nothing.
    const rays = core.raysBuffer || (core.raysBuffer = []);
    rays.length = rayCount;
    for (let r = 0; r < rayCount; r++) {
      const baseAngle = (MATH_CONSTANTS.TWO_PI * r) / rayCount;
      const jitter = (Math.random() - MATH_CONSTANTS.HALF) * (MATH_CONSTANTS.TWO_PI / (rayCount * 2));
      const lenFactor =
        cfg.explosionRayMinFactor + Math.random() * (cfg.explosionRayMaxFactor - cfg.explosionRayMinFactor);
      const ray = rays[r] || (rays[r] = {});
      ray.angle = baseAngle + jitter;
      ray.lenFactor = lenFactor;
    }
    core.rays = rays;
    this.explosions.push(core);

    const puffCount = cfg.explosionPuffCount;
    for (let i = 0; i < puffCount; i++) {
      if (this.explosions.length >= cfg.maxExplosions) {
        break;
      }
      const angle =
        (MATH_CONSTANTS.TWO_PI * i) / puffCount + (Math.random() - MATH_CONSTANTS.HALF) * cfg.burstAngleJitter;
      const speed =
        blastRadius * cfg.explosionPuffSpeedFactor * (cfg.burstSpeedMinFactor + Math.random() * cfg.burstSpeedRangeFactor);
      const puff = this.explosionPool.pop() || {};
      puff.kind = 'puff';
      puff.x = x + Math.cos(angle) * blastRadius * cfg.explosionPuffStartRadiusFactor;
      puff.y = y + Math.sin(angle) * blastRadius * cfg.explosionPuffStartRadiusFactor;
      puff.prevX = puff.x;
      puff.prevY = puff.y;
      puff.vx = Math.cos(angle) * speed;
      puff.vy = Math.sin(angle) * speed;
      puff.radius = blastRadius * cfg.explosionPuffStartRadiusFactor;
      puff.prevRadius = puff.radius;
      puff.maxRadius = blastRadius * cfg.explosionPuffMaxRadiusFactor;
      puff.color = color;
      puff.age = 0;
      puff.prevAge = 0;
      puff.maxAge = cfg.explosionPuffFrames;
      puff.alpha = 1.0;
      puff.prevAlpha = 1.0;
      puff.rays = null;
      this.explosions.push(puff);
    }
  }

  /**
   * Spawns a visual shattering sphere animation when a sphere is destroyed, so spheres
   * visibly swell, glow from within, crack open, and burst outward instead of vanishing on frame 0.
   */
  spawnShatterBall(ball, burstColor, pushVx = 0, pushVy = 0) {
    if (this.reducedMotion || !ball) {
      return;
    }
    const cfg = this.cfg;
    if (this.shatteringBalls.length >= cfg.maxShatteringBalls) {
      return;
    }
    const item = this.shatterPool.pop() || {};
    item.x = ball.x;
    item.y = ball.y;
    item.prevX = ball.x;
    item.prevY = ball.y;
    item.vx = pushVx;
    item.vy = pushVy;
    item.radius = ball.radius;
    item.colorId = ball.colorId || null;
    item.specialType = ball.specialType || null;
    item.clusterModifier = null;
    item.isAnchor = false;
    item.isFrozen = false;
    item.burstColor = burstColor || cfg.explosionFireColor;
    item.scale = 1.0;
    item.prevScale = 1.0;
    item.alpha = 1.0;
    item.prevAlpha = 1.0;
    item.age = 0;
    item.prevAge = 0;
    item.maxAge = cfg.shatterFrames;
    const crackCount = cfg.shatterCrackCount;
    const segCount = cfg.shatterCrackSegments;
    // Pooled cracks keep their arrays and point objects across spawns.
    const cracks = item.cracks || (item.cracks = []);
    cracks.length = crackCount;
    for (let c = 0; c < crackCount; c++) {
      const baseAngle =
        (MATH_CONSTANTS.TWO_PI * c) / crackCount + (Math.random() - MATH_CONSTANTS.HALF) * cfg.burstAngleJitter;
      const points = cracks[c] || (cracks[c] = []);
      points.length = segCount + 1;
      const origin = points[0] || (points[0] = {});
      origin.x = 0;
      origin.y = 0;
      for (let s = 1; s <= segCount; s++) {
        const frac = s / segCount;
        const jitterAngle =
          baseAngle + (s < segCount ? (Math.random() - MATH_CONSTANTS.HALF) * cfg.shatterCrackJitterFactor * 2 : 0);
        const point = points[s] || (points[s] = {});
        point.x = Math.cos(jitterAngle) * ball.radius * frac;
        point.y = Math.sin(jitterAngle) * ball.radius * frac;
      }
    }
    this.shatteringBalls.push(item);
  }

  /** Spawns a jagged electric arc between two arbitrary points (x1, y1) and (x2, y2). */
  spawnLightningArc(x1, y1, x2, y2, color) {
    if (this.reducedMotion) {
      return;
    }
    const cfg = this.cfg;
    const steps = cfg.lightningArcSteps;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    const nx = dist > MATH_CONSTANTS.EPSILON ? -dy / dist : 0;
    const ny = dist > MATH_CONSTANTS.EPSILON ? dx / dist : 1;
    const segments = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jitter =
        i === 0 || i === steps ? 0 : (Math.random() - MATH_CONSTANTS.HALF) * cfg.lightningArcJitter;
      segments.push({
        x: x1 + dx * t + nx * jitter,
        y: y1 + dy * t + ny * jitter
      });
    }
    this.lightningBolts.push({
      segments,
      branches: null,
      color,
      alpha: 1.0,
      prevAlpha: 1.0
    });
  }

  spawnLightning(y, leftX, rightX, color) {
    if (this.reducedMotion) {
      return;
    }
    const cfg = this.cfg;
    const segments = [];
    const branches = [];
    const steps = cfg.lightningSteps;
    const stepX = (rightX - leftX) / steps;
    for (let i = 0; i <= steps; i++) {
      segments.push({
        x: leftX + i * stepX,
        y: y + (i === 0 || i === steps ? 0 : (Math.random() - MATH_CONSTANTS.HALF) * cfg.lightningJitterY)
      });
    }
    const branchCount = cfg.lightningBranches;
    const branchLen = cfg.lightningBranchLength;
    const minPad = cfg.lightningBranchMinPad;
    const endPad = cfg.lightningBranchEndPad;
    for (let b = 0; b < branchCount; b++) {
      const idx = minPad + Math.floor(Math.random() * Math.max(1, steps - endPad));
      const root = segments[idx];
      if (root) {
        const dirY = b % 2 === 0 ? 1 : -1;
        branches.push([
          { x: root.x, y: root.y },
          {
            x: root.x + stepX * cfg.lightningBranchMidStepFactor,
            y: root.y + dirY * branchLen * cfg.lightningBranchMidLenFactor
          },
          {
            x: root.x + stepX * cfg.lightningBranchEndStepFactor,
            y: root.y + dirY * branchLen
          }
        ]);
      }
    }
    this.lightningBolts.push({
      segments,
      branches,
      color,
      alpha: 1.0,
      prevAlpha: 1.0
    });
  }

  /**
   * A sphere falling into the liquid makes a ripple where it lands.
   * @param {number} xFraction - Landing position across the board, from 0 to 1.
   * @param {number} speed - Falling speed; faster spheres splash harder.
   */
  splashLiquid(xFraction, speed) {
    if (this.reducedMotion) {
      return;
    }
    const cfg = this.cfg;
    const column = Math.min(cfg.liquidColumns - 1, Math.max(0, Math.floor(xFraction * cfg.liquidColumns)));
    this.liquidVelocities[column] += Math.min(cfg.liquidMaxSplash, Math.abs(speed) * cfg.liquidSplashScale);
  }

  /**
   * A shot bouncing off a side wall leaves a crack there, up to a fixed number per run.
   * @param {number} x - Wall x where the shot bounced.
   * @param {number} y - Height of the bounce.
   * @param {number} direction - 1 when the crack grows rightward (left wall), -1 otherwise.
   */
  addWallCrack(x, y, direction) {
    const cfg = this.cfg;
    if (this.wallCracks.length >= cfg.wallCrackMaxCount) {
      return;
    }
    const points = [{ x, y }];
    for (let i = 1; i <= cfg.wallCrackSegments; i++) {
      points.push({
        x: x + direction * (cfg.wallCrackLength * i) / cfg.wallCrackSegments,
        y: y + (Math.random() - MATH_CONSTANTS.HALF) * cfg.wallCrackJitter
      });
    }
    this.wallCracks.push(points);
  }

  /** A curved rocket or brush trail from a launch point to its target. */
  spawnStreak(x1, y1, x2, y2, color, curveSign = 1) {
    if (this.reducedMotion) {
      return;
    }
    this.streaks.push({ x1, y1, x2, y2, color, curveSign, alpha: 1.0, prevAlpha: 1.0 });
  }

  spawnFloatingText(x, y, text, color = this.cfg.floatingTextDefaultColor) {
    const item = this.textPool.pop() || {};
    item.x = x;
    item.y = y;
    item.prevY = y;
    item.text = text;
    item.color = color;
    item.vy = this.cfg.floatingTextVy;
    item.alpha = 1.0;
    item.age = 0;
    item.scale = 1.0;
    this.floatingTexts.push(item);
  }

  /** Decays screen shake during hit-stop freezes without consuming explosion or particle frames. */
  updateShakeOnly(shakeDecay = this.juiceConfig.shakeDecay) {
    const cfg = this.cfg;
    if (this.shakeIntensity > MATH_CONSTANTS.EPSILON) {
      this.shakeIntensity *= shakeDecay;
      if (this.shakeIntensity < cfg.shakeStopThreshold) {
        this.shakeIntensity = 0;
      }
    } else {
      this.shakeIntensity = 0;
    }
  }

  update(shakeDecay = this.juiceConfig.shakeDecay) {
    const cfg = this.cfg;
    this.updateShakeOnly(shakeDecay);
    const speed = this.animationSpeed || 1;
    const puffDrag = speed === 1 ? cfg.explosionPuffDrag : Math.pow(cfg.explosionPuffDrag, speed);
    const shatterDrag = speed === 1 ? cfg.shatterDrag : Math.pow(cfg.shatterDrag, speed);
    const trailRadiusDecay = speed === 1 ? cfg.trailRadiusDecay : Math.pow(cfg.trailRadiusDecay, speed);
    const burstDrag = speed === 1 ? cfg.burstDrag : Math.pow(cfg.burstDrag, speed);
    const flashExpand = Math.min(1, cfg.flashExpandRate * speed);

    if (this.screenFlash) {
      this.screenFlash.prevAlpha = this.screenFlash.alpha;
      this.screenFlash.alpha -= this.screenFlash.decay * speed;
      if (this.screenFlash.alpha <= 0) {
        this.screenFlash = null;
      }
    }

    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.prevX = ex.x;
      ex.prevY = ex.y;
      ex.prevRadius = ex.radius;
      ex.prevAlpha = ex.alpha;
      ex.prevAge = ex.age;
      ex.age += speed;
      if (ex.kind === 'puff') {
        ex.x += ex.vx * speed;
        ex.y += (ex.vy + cfg.explosionPuffRiseVy) * speed;
        ex.vx *= puffDrag;
        ex.vy *= puffDrag;
      }
      const progress = Math.min(1, ex.age / Math.max(1, ex.maxAge));
      ex.radius += (ex.maxRadius - ex.radius) * flashExpand;
      ex.alpha = Math.max(0, 1 - progress * progress);
      if (ex.age >= ex.maxAge || ex.alpha <= 0) {
        this.removeAt(this.explosions, i, this.explosionPool);
      }
    }

    for (let i = this.shatteringBalls.length - 1; i >= 0; i--) {
      const sb = this.shatteringBalls[i];
      sb.prevX = sb.x;
      sb.prevY = sb.y;
      sb.prevScale = sb.scale;
      sb.prevAlpha = sb.alpha;
      sb.prevAge = sb.age;
      sb.age += speed;
      sb.x += sb.vx * speed;
      sb.y += sb.vy * speed;
      sb.vx *= shatterDrag;
      sb.vy *= shatterDrag;
      const progress = Math.min(1, sb.age / Math.max(1, sb.maxAge));
      sb.scale = 1 + (cfg.shatterMaxScale - 1) * Math.sin(progress * Math.PI * MATH_CONSTANTS.HALF);
      sb.alpha = progress < MATH_CONSTANTS.HALF ? 1.0 : Math.max(0, 1 - (progress - MATH_CONSTANTS.HALF) * 2);
      if (sb.age >= sb.maxAge || sb.alpha <= 0) {
        const popX = sb.x;
        const popY = sb.y;
        const popRadius = sb.radius;
        const popColor = sb.burstColor;
        this.removeAt(this.shatteringBalls, i, this.shatterPool);
        // Over the cap the puff is skipped; the pop burst below still goes through its own cap.
        const puff = this.explosions.length < cfg.maxExplosions ? this.explosionPool.pop() || {} : null;
        if (puff) {
          puff.kind = 'puff';
          puff.x = popX;
          puff.y = popY;
          puff.prevX = popX;
          puff.prevY = popY;
          puff.vx = 0;
          puff.vy = cfg.explosionPuffRiseVy;
          puff.radius = popRadius * MATH_CONSTANTS.HALF;
          puff.prevRadius = puff.radius;
          puff.maxRadius = popRadius * cfg.shatterPopPuffRadiusFactor;
          puff.color = popColor;
          puff.age = 0;
          puff.prevAge = 0;
          puff.maxAge = Math.max(1, Math.round(cfg.explosionPuffFrames * MATH_CONSTANTS.HALF));
          puff.alpha = 1.0;
          puff.prevAlpha = 1.0;
          puff.rays = null;
          this.explosions.push(puff);
        }
        this.spawnBurst(popX, popY, popColor, cfg.shatterPopBurstCount, cfg.shatterPopBurstSpeed);
      }
    }

    for (let i = this.trailParticles.length - 1; i >= 0; i--) {
      const tp = this.trailParticles[i];
      tp.radius *= trailRadiusDecay;
      tp.alpha -= cfg.trailAlphaDecay * speed;
      if (tp.alpha <= 0 || tp.radius < cfg.trailMinRadius) {
        this.removeAt(this.trailParticles, i, this.trailPool);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.prevX = p.x;
      p.prevY = p.y;
      p.x += p.vx * speed;
      p.y += p.vy * speed;
      p.vy += cfg.burstGravity * speed;
      p.vx *= burstDrag;
      p.alpha -= p.decay * speed;
      if (p.alpha <= 0) {
        this.removeAt(this.particles, i, this.particlePool);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      fl.prevRadius = fl.radius;
      fl.prevAlpha = fl.alpha;
      fl.radius += (fl.maxRadius - fl.radius) * flashExpand;
      fl.alpha -= fl.alphaDecay * speed;
      if (fl.alpha <= 0) {
        this.removeAt(this.flashes, i, this.flashPool);
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.prevRadius = sw.radius;
      sw.prevAlpha = sw.alpha;
      sw.radius += (sw.maxRadius - sw.radius) * Math.min(1, (sw.expandRate ?? cfg.shockwaveExpandRate) * speed);
      sw.alpha -= (sw.alphaDecay ?? cfg.shockwaveAlphaDecay) * speed;
      if (sw.alpha <= 0) {
        this.removeAt(this.shockwaves, i, this.shockwavePool);
      }
    }

    for (let i = this.lightningBolts.length - 1; i >= 0; i--) {
      const bolt = this.lightningBolts[i];
      bolt.prevAlpha = bolt.alpha;
      bolt.alpha -= cfg.lightningAlphaDecay * speed;
      if (bolt.alpha <= 0) {
        this.removeAt(this.lightningBolts, i);
      }
    }

    this.updateLiquid();

    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const streak = this.streaks[i];
      streak.prevAlpha = streak.alpha;
      streak.alpha -= cfg.streakAlphaDecay * speed;
      if (streak.alpha <= 0) {
        this.removeAt(this.streaks, i);
      }
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.prevY = ft.y;
      ft.y += ft.vy * speed;
      ft.age = (ft.age || 0) + speed;
      if (!this.reducedMotion && cfg.floatingTextPopFrames > 0 && ft.age <= cfg.floatingTextPopFrames) {
        const progress = ft.age / cfg.floatingTextPopFrames;
        ft.scale =
          cfg.floatingTextPopStartScale
          + (1 - cfg.floatingTextPopStartScale) * progress
          + Math.sin(progress * Math.PI) * cfg.floatingTextPopOvershoot;
      } else {
        ft.scale = 1.0;
      }
      ft.alpha -= cfg.floatingTextAlphaDecay * speed;
      if (ft.alpha <= 0) {
        this.removeAt(this.floatingTexts, i, this.textPool);
      }
    }
  }
}
