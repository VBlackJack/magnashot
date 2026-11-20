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
  OBSTACLE_TYPES,
  SPECIAL_TYPES,
  CLUSTER_MODIFIERS,
  BALL_STYLES,
  LAUNCHER_POSTURES,
  MATH_CONSTANTS
} from '../core/Constants.js';
import { t } from '../core/I18n.js';
import { isChainLink, isTetherLink } from '../physics/PhysicsWorld.js';
import { Ball } from '../entities/Ball.js';
import { predictImpact } from './ImpactPreview.js';
import { SAG_STEPS } from './SagMeter.js';
import { ringVisual } from './Resonance.js';
import { resolveModesConfig } from './modes/index.js';
import { installMethods } from '../core/installMethods.js';
import { rendererMagnetarChargesMethods } from './RendererMagnetarCharges.js';
import { rendererParticlesMethods } from './RendererParticles.js';

const BOND_STYLE = Object.freeze({
  STRESSED: 0,
  SAME_COLOR: 1,
  REPEL: 2,
  LINK: 3,
  CHAIN: 4
});
const BOND_STYLE_COUNT = 5;
const SEGMENT_STRIDE = 4;
/** Shared empty dash pattern that resets a line to solid without allocating. */
const EMPTY_DASH = Object.freeze([]);
const DROP_RAIL_CARRIAGE_RADIUS_FACTOR = 0.55;

/** Color-blind patterns a standard color may declare in configs/balls.json. */
const PATTERNS = Object.freeze({
  STRIPES_H: 'stripesH',
  STRIPES_V: 'stripesV',
  STRIPES_D: 'stripesD',
  DOTS: 'dots',
  GRID: 'grid',
  RINGS: 'rings'
});
/** Cubic ease-out of the Flux shape entrance: fast at first, soft landing. */
const INTRO_EASE_POWER = 3;
/** Fixed render clock under reduced motion: pulses and field waves hold their resting frame. */
const REDUCED_MOTION_CLOCK_MS = 0;
/** Sag meter drawing: shape constants. Colors, thickness and pulse period live in `sag.render`. */
const SAG_DRAW = Object.freeze({
  PHASE_WARN: 'warn',
  PHASE_FULL: 'full',
  PHASE_CALM: 'calm',
  EASE_POWER: 3,
  EMPTY_ALPHA: 0.22,
  OUTLINE_PADDING: 3,
  OUTLINE_WIDTH: 1.5,
  WARN_DASH: Object.freeze([4, 3]),
  CHEVRON_HALF_WIDTH: 6,
  CHEVRON_HEIGHT: 5,
  CHEVRON_GAP: 5,
  CHEVRON_WIDTH: 2,
  HATCH_WIDTH: 1,
  RAIL_PULSE_DEPTH: 0.35,
  RAIL_SHADE_PER_DROP: 0.07,
  RAIL_SHADE_MAX: 0.6,
  RAIL_HATCH_STEP: 12
});

/** Media query matching exactly the given device pixel ratio. */
export function buildResolutionQuery(dpr) {
  return `(resolution: ${dpr}dppx)`;
}

function createEmptyAimPreview() {
  return {
    valid: false,
    aimAngle: 0,
    cellX: 0,
    cellY: 0,
    ballId: 0,
    specialType: null,
    colorId: null,
    snapTargetId: 0,
    blastMult: 0,
    boardCount: 0,
    boardIdSum: 0,
    boardBondTotal: 0,
    boardArmorTotal: 0,
    boardColorSum: 0,
    highlightBalls: [],
    highlightIsMatch: false,
    destroyedIds: new Set(),
    avalancheBalls: []
  };
}

function initRendererColors(renderer, ballsConfig, options) {
  renderer.colorMap = new Map();
  renderer.colorWeights = new Map();
  ballsConfig.standardColors.forEach((c, index) => {
    renderer.colorMap.set(c.id, c);
    renderer.colorWeights.set(c.id, index + 1);
  });
  const mergeTiers = resolveModesConfig(options?.modesConfig).merge.tiers;
  const baseWeight = ballsConfig.standardColors.length;
  mergeTiers.forEach((tierSpec, index) => {
    renderer.colorMap.set(tierSpec.id, tierSpec);
    renderer.colorWeights.set(tierSpec.id, baseWeight + index + 1);
  });
}

function initRendererMetricsAndCaches(renderer, gameConfig) {
  renderer.logicalWidth = gameConfig.canvas.logicalWidth;
  renderer.logicalHeight = gameConfig.canvas.logicalHeight;
  renderer.dpr = 1;
  renderer.scaleX = 1;
  renderer.scaleY = 1;
  renderer.resolutionDirty = true;
  renderer.staticLayer = null;
  renderer.staticLayerDirty = true;

  const theme = renderer.gameConfig.theme;
  renderer.floatingTextFont = `bold ${gameConfig.juice.particles.floatingTextFontSize}px ${theme.fontFamily}`;
  const collectorLabelPx = gameConfig.scoring?.collector?.labelFontSize || gameConfig.juice.particles.floatingTextFontSize;
  renderer.collectorLabelFont = `bold ${collectorLabelPx}px ${theme.fontFamily}`;
  renderer.labelFontCache = new Map();
  // CSS pixels per logical unit; ball labels are enlarged when it gets small.
  renderer.displayScale = 1;
  renderer.badgeFontCache = new Map();

  // Reused to draw the queued launcher colors with the regular ball renderer.
  renderer.upcomingPreviewBall = new Ball({ x: 0, y: 0, radius: 0, colorId: null });
  renderer.bondSegments = [];
  for (let i = 0; i < BOND_STYLE_COUNT; i++) {
    renderer.bondSegments.push([]);
  }
  renderer.portalLinks = new Map();
  renderer.portalLinkSource = [];
  renderer.aimPreview = createEmptyAimPreview();
  renderer.aimPreviewComputeCount = 0;
}

function initRendererGradientAndPairState(renderer) {
  // Per-frame inputs of drawMagneticFieldPair, kept as fields so the callback is allocated once.
  renderer.magneticPairCtx = null;
  renderer.magneticPairAlpha = 1;
  renderer.magneticPairMaxDistSq = 0;
  renderer.drawMagneticFieldPair = (a, b) => {
    if (!a.colorId || a.colorId !== b.colorId || a.bonds.has(b.id)) {
      return;
    }
    const alpha = renderer.magneticPairAlpha;
    const ax = renderer.interpolate(a.prevX, a.x, alpha);
    const ay = renderer.interpolate(a.prevY, a.y, alpha);
    const bx = renderer.interpolate(b.prevX, b.x, alpha);
    const by = renderer.interpolate(b.prevY, b.y, alpha);
    const dx = bx - ax;
    const dy = by - ay;
    if (dx * dx + dy * dy <= renderer.magneticPairMaxDistSq) {
      renderer.magneticPairCtx.moveTo(ax, ay);
      renderer.magneticPairCtx.lineTo(bx, by);
    }
  };

  // Slow-motion vignette gradient, rebuilt only when the canvas size or tint changes.
  renderer.slowMoVignetteGradient = null;
  renderer.slowMoVignetteKey = '';
  renderer.slowMoVignetteCtx = null;
  // Unit-radius shatter core gradients by burst colour; scaled to the ball radius at draw time.
  renderer.shatterCoreGradients = new Map();
  renderer.shatterCoreGradientCtx = null;
  // Unit-radius explosion gradients (puff phases, core, flash); scaled to the radius at draw time.
  renderer.unitRadialGradients = new Map();
  renderer.unitRadialGradientCtx = null;
  renderer.ballGradientCache = new Map();
  renderer.ballSpriteCache = new Map();
  renderer.highContrast = false;
  renderer.colorPatterns = false;
  renderer.isReducedMotion = false;
  renderer.magnetarView = null;
}

function prepareFrameCanvas(renderer, engineState, theme, width, height) {
  const ctx = renderer.ctx;
  ctx.setTransform(renderer.scaleX, 0, 0, renderer.scaleY, 0, 0);
  const shake = renderer.lite ? 0 : engineState.particleSystem.shakeIntensity;
  if (shake > 0) {
    // The shaken static layer no longer covers the edges: paint them first so no strip of
    // the previous frame shows through.
    ctx.fillStyle = theme.backgroundTop;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.save();
  if (shake > 0) {
    const dx = (Math.random() - MATH_CONSTANTS.HALF) * 2 * shake;
    const dy = (Math.random() - MATH_CONSTANTS.HALF) * 2 * shake;
    ctx.translate(dx, dy);
  }
  ctx.drawImage(renderer.staticLayer, 0, 0, width, height);
  if (!renderer.lite) {
    renderer.drawWallCracks(ctx, engineState.particleSystem);
  }
}

function renderBoardChrome(renderer, ctx, engineState, width, height, theme, behavior, chrome, now, alpha) {
  if (!chrome || chrome.ambientLiquid) {
    renderer.drawLiquid(ctx, engineState.particleSystem, width, height);
  }
  if (!chrome || chrome.collectorBins) {
    renderer.drawCollectorBins(ctx, width, height, theme, engineState);
  }
  if (!chrome || chrome.dangerZone) {
    renderer.drawDangerZone(ctx, width, height, theme, engineState.physicsWorld.balls, now, alpha);
  }
  behavior?.drawUnderlay?.(ctx, engineState, renderer, theme, now);
}

function renderClusterStageLayer(renderer, ctx, engineState, theme, magnetarView, now, alpha) {
  // A new Flux shape slides down into place; only the drawing moves, not the physics.
  // After a Sag step the cluster is already lower in the physics: it eases down from its
  // old place, drawing only.
  const introOffset = renderer.getStageIntroOffset(engineState);
  if (introOffset > 0) {
    ctx.save();
    ctx.translate(0, -introOffset);
  }
  renderer.drawObstacles(ctx, engineState.physicsWorld.obstacles, now, alpha);
  renderer.drawRails(ctx, engineState.physicsWorld);
  // Only the cluster and its rail ease down; fixed fixtures stay where they are.
  const lowerOffset = renderer.getRailLowerOffset(engineState);
  if (lowerOffset > 0) {
    ctx.save();
    ctx.translate(0, -lowerOffset);
  }
  renderer.drawAnchorRail(ctx, engineState, theme, now);
  renderer.drawMagneticBonds(ctx, engineState.physicsWorld, theme, now, alpha);
  renderer.drawTethers(ctx, engineState.physicsWorld, alpha);
  for (const ball of engineState.physicsWorld.balls) {
    renderer.drawBall(ctx, ball, now, alpha);
  }
  renderer.drawChainLinkOverlays(ctx, engineState.physicsWorld, alpha);
  if (magnetarView) {
    renderer.drawMagnetar(ctx, engineState, now);
  }
  if (lowerOffset > 0) {
    ctx.restore();
  }
  if (introOffset > 0) {
    ctx.restore();
  }
}

function shouldRenderAimTrajectory(renderer, chrome, engineState) {
  return (
    (!chrome || chrome.aimLine)
    && !renderer.lite
    && Boolean(engineState.aimPoints)
    && !engineState.physicsWorld.projectile
    && !engineState.isAimCancelled
  );
}

function renderForegroundAction(renderer, ctx, engineState, theme, behavior, chrome, now, alpha) {
  for (const ball of engineState.physicsWorld.droppingBalls) {
    renderer.drawBall(ctx, ball, now, alpha);
  }
  behavior?.drawOverlay?.(ctx, engineState, renderer, theme, now);
  if (!renderer.lite) {
    renderer.drawShatteringBalls(ctx, engineState.particleSystem, now, alpha);
  }
  if (shouldRenderAimTrajectory(renderer, chrome, engineState)) {
    renderer.drawAimTrajectory(
      ctx,
      engineState.aimPoints,
      engineState.currentBall,
      engineState.physicsWorld,
      theme,
      now,
      engineState.getBlastRadiusMultiplier(),
      engineState.aimAngle,
      alpha
    );
  }
  if (!renderer.lite) {
    renderer.drawTrail(ctx, engineState.particleSystem);
  }
  if (engineState.physicsWorld.projectile) {
    renderer.drawBall(ctx, engineState.physicsWorld.projectile, now, alpha);
  }
}

function renderForegroundChrome(renderer, ctx, engineState, width, height, theme, behavior, magnetarView, now, alpha) {
  renderer.drawLauncher(ctx, engineState, theme, now);
  behavior?.drawLauncherOverlay?.(ctx, engineState, renderer, theme, now);
  renderer.drawSagGauge(ctx, engineState, theme);
  if (!renderer.lite) {
    renderer.drawParticles(ctx, engineState.particleSystem, alpha);
    renderer.drawSlowMoOverlay(ctx, engineState, width, height, alpha);
  }
  if (engineState.versus) {
    renderer.drawVersusCharges(ctx, engineState);
  }
  if (magnetarView && magnetarView.charges?.length) {
    renderer.drawMagnetarCharges(ctx, engineState, magnetarView);
  }
}

function strokeMagneticFieldLines(renderer, ctx, physicsWorld, theme, pulse, fieldMaxDistSq, alpha) {
  ctx.lineWidth = theme.magneticFieldLineWidth;
  ctx.setLineDash(theme.magneticFieldDash);
  ctx.strokeStyle = `rgba(${theme.magneticSameColorBase}, ${theme.magneticFieldAlpha * pulse})`;
  ctx.beginPath();
  renderer.magneticPairCtx = ctx;
  renderer.magneticPairAlpha = alpha;
  renderer.magneticPairMaxDistSq = fieldMaxDistSq;
  physicsWorld.spatialGrid.forEachNeighborPair(physicsWorld.balls, renderer.drawMagneticFieldPair);
  renderer.magneticPairCtx = null;
  ctx.stroke();
  ctx.setLineDash(EMPTY_DASH);
}

function classifyBondStyle(a, b, dist, stressDist, polA, physicsWorld) {
  if (isChainLink(a, b)) {
    return BOND_STYLE.CHAIN;
  }
  if (!a.isAnchor && !b.isAnchor && dist > stressDist) {
    return BOND_STYLE.STRESSED;
  }
  const sameColor = a.colorId && a.colorId === b.colorId;
  if (sameColor) {
    return BOND_STYLE.SAME_COLOR;
  }
  const polB = b.colorId ? (physicsWorld.polarityMap.get(b.colorId) || 0) : 0;
  return polA * polB > 0 ? BOND_STYLE.REPEL : BOND_STYLE.LINK;
}

function collectBondSegments(renderer, physicsWorld, stressDist, alpha) {
  const segments = renderer.bondSegments;
  for (const list of segments) {
    list.length = 0;
  }
  for (const a of physicsWorld.balls) {
    const polA = a.colorId ? (physicsWorld.polarityMap.get(a.colorId) || 0) : 0;
    const ax = renderer.interpolate(a.prevX, a.x, alpha);
    const ay = renderer.interpolate(a.prevY, a.y, alpha);
    for (const neighborId of a.bonds) {
      if (neighborId <= a.id) {
        continue;
      }
      const b = physicsWorld.ballMap.get(neighborId);
      if (!b) {
        continue;
      }
      const bx = renderer.interpolate(b.prevX, b.x, alpha);
      const by = renderer.interpolate(b.prevY, b.y, alpha);
      const dist = Math.hypot(bx - ax, by - ay);
      const style = classifyBondStyle(a, b, dist, stressDist, polA, physicsWorld);
      segments[style].push(ax, ay, bx, by);
    }
  }
  return segments;
}

function strokeBondGlowAndSegments(renderer, ctx, segments, theme, pulse) {
  if (theme.magneticBondGlowWidth) {
    ctx.lineWidth = theme.magneticBondGlowWidth;
    if (segments[BOND_STYLE.STRESSED].length > 0 && theme.magneticStressGlowColor) {
      renderer.strokeSegments(ctx, segments[BOND_STYLE.STRESSED], theme.magneticStressGlowColor);
    }
    if (segments[BOND_STYLE.SAME_COLOR].length > 0 && theme.magneticBondGlowAlpha) {
      renderer.strokeSegments(
        ctx,
        segments[BOND_STYLE.SAME_COLOR],
        `rgba(${theme.magneticSameColorBase}, ${theme.magneticBondGlowAlpha * pulse})`
      );
    }
    ctx.lineWidth = theme.magneticBondLineWidth;
  }
  if (segments[BOND_STYLE.STRESSED].length > 0) {
    renderer.strokeSegments(ctx, segments[BOND_STYLE.STRESSED], theme.magneticStressColor);
  }
  if (segments[BOND_STYLE.SAME_COLOR].length > 0) {
    renderer.strokeSegments(
      ctx,
      segments[BOND_STYLE.SAME_COLOR],
      `rgba(${theme.magneticSameColorBase}, ${theme.magneticBondSameColorAlpha * pulse})`
    );
  }
  if (segments[BOND_STYLE.REPEL].length > 0) {
    renderer.strokeSegments(
      ctx,
      segments[BOND_STYLE.REPEL],
      `rgba(${theme.magneticRepelColorBase}, ${theme.magneticFieldAlpha * pulse})`
    );
  }
  if (segments[BOND_STYLE.LINK].length > 0) {
    renderer.strokeSegments(ctx, segments[BOND_STYLE.LINK], theme.magneticLinkColor);
  }
  if (segments[BOND_STYLE.CHAIN].length > 0) {
    const chainSpec = renderer.ballsConfig.clusterModifiers.chained;
    ctx.lineWidth = chainSpec.linkWidth;
    ctx.setLineDash(chainSpec.linkDash);
    renderer.strokeSegments(ctx, segments[BOND_STYLE.CHAIN], chainSpec.linkColor);
    ctx.setLineDash(EMPTY_DASH);
  }
}

function drawPortalObstacle(renderer, ctx, obs, ox, oy, oAngle, cfg, obsDefaults, _now, alpha) {
  const mate = renderer.portalLinks.get(obs);
  if (mate) {
    ctx.save();
    ctx.strokeStyle = cfg.fieldColor;
    ctx.lineWidth = obsDefaults.lineWidth;
    ctx.setLineDash(cfg.linkDash);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(renderer.interpolate(mate.prevX, mate.x, alpha), renderer.interpolate(mate.prevY, mate.y, alpha));
    ctx.stroke();
    ctx.restore();
  }
  const pulseScale = 1 + obs.hitPulse * obsDefaults.bumperPulseScale;
  ctx.translate(ox, oy);
  ctx.scale(pulseScale, pulseScale);
  ctx.fillStyle = cfg.fieldColor;
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius + cfg.fieldRadiusPadding, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
  ctx.fillStyle = cfg.outerColor;
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
  ctx.rotate(oAngle);
  ctx.strokeStyle = cfg.ringColor;
  ctx.lineWidth = obsDefaults.ringLineWidth;
  ctx.setLineDash(cfg.ringDash);
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius - cfg.ringInset, 0, MATH_CONSTANTS.TWO_PI);
  ctx.stroke();
  ctx.setLineDash(EMPTY_DASH);
  ctx.strokeStyle = cfg.coreColor;
  ctx.lineWidth = obsDefaults.lineWidth;
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius * cfg.swirlRadiusFactor, 0, Math.PI * cfg.swirlArcAngleFactor);
  ctx.stroke();
}

function drawSingularityObstacle(_renderer, ctx, obs, ox, oy, oAngle, cfg, obsDefaults, now) {
  if (obs.pullRadius > obs.captureRadius && cfg.pullFieldColor) {
    const pullWave = obs.pullRadius - ((now * obsDefaults.fieldWaveSpeed) % obs.pullRadius);
    ctx.fillStyle = cfg.pullFieldColor;
    ctx.beginPath();
    ctx.arc(ox, oy, obs.pullRadius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.strokeStyle = cfg.ringColor;
    ctx.globalAlpha = obsDefaults.pullWaveAlpha;
    ctx.lineWidth = obsDefaults.lineWidth;
    ctx.beginPath();
    ctx.arc(ox, oy, Math.max(obs.captureRadius, pullWave), 0, MATH_CONSTANTS.TWO_PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const pulseScale = 1 + obs.hitPulse * obsDefaults.bumperPulseScale;
  ctx.translate(ox, oy);
  ctx.scale(pulseScale, pulseScale);
  ctx.fillStyle = cfg.fieldColor;
  ctx.beginPath();
  ctx.arc(0, 0, obs.captureRadius, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
  ctx.fillStyle = cfg.outerColor;
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
  ctx.rotate(oAngle);
  ctx.strokeStyle = cfg.ringColor;
  ctx.lineWidth = obsDefaults.ringLineWidth;
  ctx.setLineDash(cfg.ringDash);
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius - cfg.ringInset, 0, MATH_CONSTANTS.TWO_PI);
  ctx.stroke();
  ctx.setLineDash(EMPTY_DASH);
  ctx.fillStyle = cfg.coreColor;
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius * cfg.swirlRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
}

function drawFieldObstacle(_renderer, ctx, obs, ox, oy, _oAngle, cfg, obsDefaults, now) {
  const wave = (now * obsDefaults.fieldWaveSpeed) % obs.fieldRadius;
  const radiusWave = obs.type === OBSTACLE_TYPES.ATTRACTOR ? obs.fieldRadius - wave : wave;
  ctx.fillStyle = cfg.fieldColor;
  ctx.beginPath();
  ctx.arc(ox, oy, obs.fieldRadius, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
  ctx.strokeStyle = cfg.ringColor || cfg.coreColor;
  ctx.globalAlpha = obsDefaults.fieldWaveAlpha;
  ctx.lineWidth = obsDefaults.lineWidth;
  ctx.beginPath();
  ctx.arc(ox, oy, Math.max(obsDefaults.fieldWaveMinRadius, radiusWave), 0, MATH_CONSTANTS.TWO_PI);
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (cfg.outerColor) {
    const inset = obsDefaults.ringInset;
    ctx.fillStyle = cfg.outerColor;
    ctx.beginPath();
    ctx.arc(ox, oy, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    if (cfg.ringColor) {
      ctx.strokeStyle = cfg.ringColor;
      ctx.lineWidth = obsDefaults.lineWidth;
      ctx.beginPath();
      ctx.arc(ox, oy, Math.max(obsDefaults.fieldWaveMinRadius, obs.radius - inset), 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
    }
    ctx.fillStyle = cfg.coreColor;
    ctx.beginPath();
    ctx.arc(ox, oy, Math.max(obsDefaults.fieldWaveMinRadius, obs.radius - inset * 2), 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
  } else {
    ctx.fillStyle = cfg.coreColor;
    ctx.beginPath();
    ctx.arc(ox, oy, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
  }
}

function drawPivotObstacle(_renderer, ctx, obs, ox, oy, oAngle, cfg, obsDefaults) {
  const inset = obsDefaults.ringInset;
  ctx.translate(ox, oy);
  ctx.rotate(oAngle);
  ctx.fillStyle = cfg.outerColor;
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
  ctx.strokeStyle = cfg.ringColor;
  ctx.lineWidth = obsDefaults.ringLineWidth;
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius - inset, 0, MATH_CONSTANTS.TWO_PI);
  ctx.stroke();
  ctx.strokeStyle = cfg.coreColor;
  ctx.beginPath();
  ctx.moveTo(-obs.radius + inset, 0);
  ctx.lineTo(obs.radius - inset, 0);
  ctx.moveTo(0, -obs.radius + inset);
  ctx.lineTo(0, obs.radius - inset);
  ctx.stroke();
}

function drawBumperObstacle(_renderer, ctx, obs, ox, oy, _oAngle, cfg, obsDefaults) {
  const pulseScale = 1 + obs.hitPulse * obsDefaults.bumperPulseScale;
  ctx.translate(ox, oy);
  ctx.scale(pulseScale, pulseScale);
  ctx.fillStyle = cfg.outerColor;
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
  ctx.strokeStyle = cfg.ringColor;
  ctx.lineWidth = cfg.ringLineWidth;
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius - obsDefaults.ringInset, 0, MATH_CONSTANTS.TWO_PI);
  ctx.stroke();
  ctx.fillStyle = cfg.coreColor;
  ctx.beginPath();
  ctx.arc(0, 0, obs.radius * obsDefaults.bumperCoreRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
}

function drawRectObstacle(_renderer, ctx, obs, ox, oy, _oAngle, cfg, obsDefaults) {
  const halfW = obs.width * MATH_CONSTANTS.HALF;
  const halfH = obs.height * MATH_CONSTANTS.HALF;
  ctx.fillStyle = cfg.fillColor;
  ctx.strokeStyle = cfg.borderColor;
  ctx.lineWidth = obsDefaults.lineWidth;
  ctx.beginPath();
  ctx.roundRect(ox - halfW, oy - halfH, obs.width, obs.height, obsDefaults.barrierCornerRadius);
  ctx.fill();
  ctx.stroke();
}

const OBSTACLE_DRAWERS = Object.freeze({
  [OBSTACLE_TYPES.PORTAL]: drawPortalObstacle,
  [OBSTACLE_TYPES.SINGULARITY]: drawSingularityObstacle,
  [OBSTACLE_TYPES.REPULSOR]: drawFieldObstacle,
  [OBSTACLE_TYPES.ATTRACTOR]: drawFieldObstacle,
  [OBSTACLE_TYPES.ANTIMAGNET]: drawFieldObstacle,
  [OBSTACLE_TYPES.PIVOT]: drawPivotObstacle,
  [OBSTACLE_TYPES.BUMPER]: drawBumperObstacle,
  [OBSTACLE_TYPES.BARRIER]: drawRectObstacle,
  [OBSTACLE_TYPES.PLATFORM]: drawRectObstacle
});

function drawBallPreOrbEffects(ctx, ball, palette, r, theme, renderCfg) {
  if (palette.glow && (ball.specialType || ball.clusterModifier)) {
    ctx.save();
    ctx.fillStyle = palette.glow;
    ctx.globalAlpha = renderCfg.glowAlpha;
    ctx.beginPath();
    ctx.arc(0, 0, r * renderCfg.glowRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.restore();
  }
  if (ball.isAnchor) {
    ctx.strokeStyle = theme.anchorRingColor;
    ctx.lineWidth = renderCfg.anchorRingLineWidth;
    ctx.beginPath();
    ctx.arc(0, 0, r + renderCfg.anchorRingPadding, 0, MATH_CONSTANTS.TWO_PI);
    ctx.stroke();
    ctx.fillStyle = theme.anchorCoreColor;
    ctx.beginPath();
    ctx.arc(0, -r - renderCfg.anchorRingPadding, renderCfg.anchorPinRadius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
  }
}

function drawBallModifierRing(ctx, ball, r, renderCfg, modSpec) {
  if (!modSpec) {
    return;
  }
  const isArmoredType =
    ball.clusterModifier === CLUSTER_MODIFIERS.ARMORED || ball.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE;
  const isCrackedArmor = isArmoredType && ball.armorHits === 1;
  ctx.strokeStyle = isCrackedArmor && modSpec.crackedColor ? modSpec.crackedColor : modSpec.ringColor;
  ctx.lineWidth = isArmoredType && ball.armorHits > 1
    ? renderCfg.armorIntactLineWidth
    : renderCfg.modifierRingLineWidth;
  if (isCrackedArmor) {
    ctx.setLineDash(renderCfg.crackedArmorDash);
  }
  ctx.beginPath();
  ctx.arc(0, 0, r - renderCfg.modifierRingInset, 0, MATH_CONSTANTS.TWO_PI);
  ctx.stroke();
  ctx.setLineDash(EMPTY_DASH);
}

function drawBallPrimaryLabel(renderer, ctx, palette, r, theme, renderCfg) {
  const primaryLabel = palette.icon || palette.symbol;
  if (!primaryLabel) {
    return;
  }
  const label = renderer.getLabelFont(r);
  ctx.font = label.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // An enlarged glyph covers the shine and gradient, so it gets the outline too.
  if (renderer.highContrast || label.isEnlarged) {
    ctx.strokeStyle = theme.floatingTextShadowColor;
    ctx.lineWidth = renderCfg.labelStrokeWidth;
    ctx.strokeText(primaryLabel, 0, renderCfg.labelOffsetY);
  }
  ctx.fillStyle = renderer.highContrast ? renderCfg.labelColorHighContrast : renderCfg.labelColorNormal;
  ctx.fillText(primaryLabel, 0, renderCfg.labelOffsetY);
}

function drawBallModifierBadge(renderer, ctx, r, theme, renderCfg, modSpec) {
  if (!modSpec?.badge) {
    return;
  }
  const bx = r * renderCfg.badgeOffsetFactor;
  const by = -r * renderCfg.badgeOffsetFactor;
  ctx.fillStyle = theme.floatingTextShadowColor;
  ctx.strokeStyle = modSpec.ringColor;
  ctx.lineWidth = renderCfg.badgeBorderWidth;
  ctx.beginPath();
  ctx.arc(bx, by, r * renderCfg.badgeRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = renderCfg.badgeColor;
  ctx.font = renderer.getBadgeFont(r);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(modSpec.badge, bx, by + renderCfg.badgeTextOffsetY);
}

function drawBallPostOrbEffects(renderer, ctx, ball, palette, r, now, renderCfg) {
  if (ball.specialType) {
    const glowPulse =
      renderCfg.specialGlowBaseAlpha +
      renderCfg.specialGlowPulseAmp * Math.sin(now * renderCfg.specialGlowPulseSpeed + ball.pulsePhase);
    ctx.strokeStyle = palette.highlight;
    ctx.globalAlpha = glowPulse;
    ctx.lineWidth = renderCfg.specialGlowLineWidth;
    ctx.beginPath();
    ctx.arc(0, 0, r + renderCfg.specialGlowRadiusOffset, 0, MATH_CONSTANTS.TWO_PI);
    ctx.stroke();
  }
  if (ball.clusterModifier === CLUSTER_MODIFIERS.BUBBLE) {
    renderer.drawBubbleShell(ctx, r);
  }
}

function drawCollectorSlotLabels(renderer, ctx, collectorCfg, margin, topY, slotWidth, theme, engineState) {
  const bonusPoints = engineState?.getCollectorBonusPoints?.() ?? collectorCfg.bonusPointsPerBall;
  if (!theme.collectorLabelColor || !(bonusPoints > 0)) {
    return;
  }
  const labelText = t('gameplay.feedback.collector.slotLabel', { points: bonusPoints });
  ctx.fillStyle = theme.collectorLabelColor;
  ctx.font = renderer.collectorLabelFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelY = topY + collectorCfg.zoneHeight * MATH_CONSTANTS.HALF;
  for (let i = 0; i < collectorCfg.slotCount; i++) {
    const slotCenterX = margin + (i + MATH_CONSTANTS.HALF) * slotWidth;
    ctx.fillText(labelText, slotCenterX, labelY);
  }
}

function computeBoardSignature(physicsWorld, colorWeights) {
  let boardCount = 0;
  let boardIdSum = 0;
  let boardBondTotal = 0;
  let boardArmorTotal = 0;
  let boardColorSum = 0;
  for (const b of physicsWorld.balls) {
    boardCount++;
    boardIdSum += b.id;
    boardBondTotal += b.bonds.size;
    boardArmorTotal += b.armorHits;
    if (b.colorId) {
      boardColorSum += b.id * colorWeights.get(b.colorId);
    }
  }
  return { boardCount, boardIdSum, boardBondTotal, boardArmorTotal, boardColorSum };
}

function matchesAimShotKey(cache, key) {
  return (
    cache.valid
    && cache.aimAngle === key.aimAngle
    && cache.cellX === key.cellX
    && cache.cellY === key.cellY
    && cache.ballId === key.ballId
    && cache.specialType === key.specialType
    && cache.colorId === key.colorId
    && cache.snapTargetId === key.snapTargetId
    && cache.blastMult === key.blastMult
  );
}

function matchesAimBoardKey(cache, sig) {
  return (
    cache.boardCount === sig.boardCount
    && cache.boardIdSum === sig.boardIdSum
    && cache.boardBondTotal === sig.boardBondTotal
    && cache.boardArmorTotal === sig.boardArmorTotal
    && cache.boardColorSum === sig.boardColorSum
  );
}

const SPECIAL_RADIUS_KEYS = Object.freeze({
  [SPECIAL_TYPES.BOMB]: 'blastRadiusFactor',
  [SPECIAL_TYPES.FREEZE]: 'freezeRadiusFactor',
  [SPECIAL_TYPES.BRUSH]: 'paintRadiusFactor'
});

function strokeAimTrajectoryPath(renderer, ctx, points, palette, theme, now) {
  const dashOffset = renderer.isReducedMotion || !theme.aimDashSpeed ? 0 : -(now * theme.aimDashSpeed);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    if (points[i].warpBreak) {
      ctx.moveTo(points[i].x, points[i].y);
    } else {
      ctx.lineTo(points[i].x, points[i].y);
    }
  }
  if (theme.aimGlowWidth && theme.aimGlowAlpha) {
    ctx.strokeStyle = palette.fill;
    ctx.lineWidth = theme.aimGlowWidth;
    ctx.globalAlpha = theme.aimGlowAlpha;
    ctx.setLineDash(EMPTY_DASH);
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;
  ctx.strokeStyle = palette.highlight;
  ctx.lineWidth = theme.aimLineWidth;
  ctx.setLineDash(theme.aimLineDash);
  ctx.lineDashOffset = dashOffset;
  ctx.stroke();
  ctx.setLineDash(EMPTY_DASH);
  ctx.lineDashOffset = 0;

  if (theme.aimBounceNodeRadius) {
    ctx.fillStyle = palette.highlight;
    ctx.globalAlpha = theme.aimBounceNodeAlpha;
    for (let i = 1; i < points.length - 1; i++) {
      if (points[i].isBounce) {
        ctx.beginPath();
        ctx.arc(points[i].x, points[i].y, theme.aimBounceNodeRadius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1.0;
  }
}

function drawAimSpecialAoe(renderer, ctx, currentBall, palette, theme, pulse, endX, endY, blastRadiusMultiplier) {
  if (!currentBall.specialType) {
    return;
  }
  const specType = currentBall.specialType;
  const specCfg = renderer.ballsConfig.specialTypes[specType];
  const radiusKey = SPECIAL_RADIUS_KEYS[specType];
  if (radiusKey) {
    const aoeRadius = currentBall.radius * specCfg[radiusKey] * blastRadiusMultiplier;
    ctx.save();
    ctx.fillStyle = palette.highlight;
    ctx.globalAlpha = theme.specialAoeFillAlpha;
    ctx.beginPath();
    ctx.arc(endX, endY, aoeRadius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.strokeStyle = palette.highlight;
    ctx.globalAlpha = theme.specialAoeStrokeAlpha * pulse;
    ctx.lineWidth = theme.aimGhostLineWidth;
    ctx.setLineDash(theme.specialAoeDash);
    ctx.stroke();
    ctx.restore();
  } else if (specType === SPECIAL_TYPES.LIGHTNING) {
    const bandHalf = currentBall.radius * specCfg.bandHalfHeightFactor * blastRadiusMultiplier;
    const margin = renderer.gameConfig.canvas.wallMargin;
    const bandWidth = renderer.logicalWidth - margin * 2;
    ctx.save();
    ctx.fillStyle = palette.highlight;
    ctx.globalAlpha = theme.specialAoeFillAlpha;
    ctx.fillRect(margin, endY - bandHalf, bandWidth, bandHalf * 2);
    ctx.strokeStyle = palette.highlight;
    ctx.globalAlpha = theme.specialAoeStrokeAlpha * pulse;
    ctx.lineWidth = theme.aimGhostLineWidth;
    ctx.setLineDash(theme.specialAoeDash);
    ctx.strokeRect(margin, endY - bandHalf, bandWidth, bandHalf * 2);
    ctx.restore();
  }
}

function drawAimTargetHighlights(renderer, ctx, preview, palette, theme, pulse, alpha) {
  if (preview.highlightBalls.length > 0) {
    ctx.strokeStyle = preview.highlightIsMatch ? theme.targetHighlightColor : palette.highlight;
    ctx.lineWidth = preview.highlightIsMatch ? theme.aimTargetMatchLineWidth : theme.aimTargetNormalLineWidth;
    ctx.globalAlpha = pulse;
    renderer.strokeBallRings(ctx, preview.highlightBalls, theme.aimTargetRingPadding, alpha);
  }
  if (preview.avalancheBalls.length > 0) {
    ctx.save();
    ctx.strokeStyle = theme.avalancheDropHighlightColor;
    ctx.lineWidth = theme.aimTargetNormalLineWidth;
    ctx.setLineDash(theme.specialAoeDash);
    ctx.globalAlpha = pulse;
    renderer.strokeBallRings(
      ctx,
      preview.avalancheBalls,
      theme.aimTargetRingPadding + theme.avalancheRingPaddingExtra,
      alpha
    );
    ctx.restore();
  }
}

function resolveBeatRingAnchor(engineState, canvasCfg) {
  const spec = typeof engineState.getLauncherSpec === 'function' ? engineState.getLauncherSpec() : null;
  if (!spec) {
    return { rx: canvasCfg.launcherX, ry: canvasCfg.launcherY };
  }
  const rx = spec.posture === LAUNCHER_POSTURES.DROP_RAIL ? (engineState.mergeDropX ?? spec.x) : spec.x;
  return { rx, ry: spec.y };
}

function resolveLauncherSpecLayout(engineState, canvasCfg) {
  const spec = typeof engineState.getLauncherSpec === 'function' ? engineState.getLauncherSpec() : null;
  const posture = spec ? spec.posture : LAUNCHER_POSTURES.UPWARD;
  const isDropRail = posture === LAUNCHER_POSTURES.DROP_RAIL;
  const baseX = spec ? spec.x : canvasCfg.launcherX;
  const lx = isDropRail ? (engineState.mergeDropX ?? baseX) : baseX;
  const ly = spec ? spec.y : canvasCfg.launcherY;
  return {
    spec,
    isDropRail,
    baseX,
    lx,
    ly,
    nextOffsetX: spec ? spec.nextOffsetX : canvasCfg.nextBallOffsetX,
    nextOffsetY: spec ? spec.nextOffsetY : canvasCfg.nextBallOffsetY
  };
}

function drawDropRailAndCancelChrome(ctx, engineState, theme, launcherGeom, layout) {
  if (layout.isDropRail) {
    const basin = engineState.getMergeBasinGeometry?.() ?? null;
    if (basin) {
      ctx.save();
      ctx.strokeStyle = theme.launcherAccentColor;
      ctx.lineWidth = launcherGeom.baseBorderWidth;
      ctx.beginPath();
      ctx.moveTo(basin.left, layout.ly);
      ctx.lineTo(basin.right, layout.ly);
      ctx.stroke();
      ctx.restore();
    }
  }
  if (engineState.isAimCancelled) {
    ctx.save();
    ctx.strokeStyle = theme.cancelAimColor;
    ctx.lineWidth = launcherGeom.cancelRingLineWidth;
    ctx.setLineDash(launcherGeom.cancelRingDash);
    ctx.beginPath();
    ctx.arc(layout.lx, layout.ly, launcherGeom.cancelRingRadius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.stroke();
    ctx.restore();
  }
}

function drawLauncherChassis(ctx, engineState, theme, launcherGeom, layout) {
  if (!layout.isDropRail) {
    ctx.save();
    ctx.translate(layout.lx, layout.ly);
    ctx.rotate(engineState.aimAngle + Math.PI * MATH_CONSTANTS.HALF);
    ctx.fillStyle = theme.launcherBarrelColor;
    ctx.strokeStyle = theme.launcherAccentColor;
    ctx.lineWidth = launcherGeom.barrelBorderWidth;
    ctx.beginPath();
    ctx.roundRect(
      launcherGeom.barrelX,
      launcherGeom.barrelY,
      launcherGeom.barrelWidth,
      launcherGeom.barrelHeight,
      launcherGeom.barrelCornerRadius
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.fillStyle = theme.launcherBaseColor;
  ctx.strokeStyle = theme.launcherAccentColor;
  ctx.lineWidth = launcherGeom.baseBorderWidth;
  const baseRadius = layout.isDropRail
    ? launcherGeom.baseRadius * DROP_RAIL_CARRIAGE_RADIUS_FACTOR
    : launcherGeom.baseRadius;
  ctx.beginPath();
  ctx.arc(layout.lx, layout.ly, baseRadius, 0, MATH_CONSTANTS.TWO_PI);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawBlitzAutoFireRing(renderer, ctx, engineState, theme, launcherGeom, lx, ly) {
  if (
    engineState.mode !== GAME_MODES.BLITZ
    || !(engineState.blitzIdleFrames > 0)
    || engineState.physicsWorld.projectile
  ) {
    return;
  }
  const autoFireMax = renderer.gameConfig.blitz?.autoFireFrames || 0;
  if (!(autoFireMax > 0)) {
    return;
  }
  const ratio = Math.min(1, engineState.blitzIdleFrames / autoFireMax);
  const startAngle = -Math.PI * MATH_CONSTANTS.HALF;
  const endAngle = startAngle + ratio * MATH_CONSTANTS.TWO_PI;
  ctx.save();
  ctx.strokeStyle = ratio >= launcherGeom.autoFireUrgentRatio ? theme.dangerLineColor : theme.wavePopupColor;
  ctx.lineWidth = launcherGeom.autoFireRingWidth;
  ctx.beginPath();
  ctx.arc(lx, ly, launcherGeom.baseRadius + launcherGeom.autoFireRingOffset, startAngle, endAngle);
  ctx.stroke();
  ctx.restore();
}

function drawLauncherCurrentBall(renderer, ctx, engineState, launcherGeom, layout, canShowPolarity, polaritySign, now) {
  if (!engineState.currentBall || engineState.physicsWorld.projectile) {
    return;
  }
  renderer.drawBallAt(ctx, engineState.currentBall, layout.lx, layout.ly, now);
  const rawShot = canShowPolarity ? engineState.getVersusShotPolarity() : null;
  const shotPolarity = rawShot ? rawShot * polaritySign : null;
  if (shotPolarity) {
    renderer.drawShotPolarityGlyph(
      ctx,
      layout.lx,
      layout.ly,
      engineState.currentBall.radius * renderer.gameConfig.versus.render.launcherGlyphSizeFactor,
      shotPolarity
    );
  }
  if (engineState.isPolarityFlipped) {
    const renderCfg = renderer.ballsConfig.render;
    ctx.save();
    ctx.strokeStyle = renderCfg.polarityFlipRingColor;
    ctx.lineWidth = launcherGeom.nextBallRingWidth;
    ctx.setLineDash(renderCfg.polarityFlipDash);
    ctx.beginPath();
    ctx.arc(layout.lx, layout.ly, engineState.currentBall.radius + renderCfg.polarityFlipRadiusOffset, 0, MATH_CONSTANTS.TWO_PI);
    ctx.stroke();
    ctx.restore();
  }
}

function drawLauncherNextBall(renderer, ctx, engineState, theme, launcherGeom, layout, canShowPolarity, polaritySign, now) {
  if (
    !engineState.nextBall
    || (engineState.mode === GAME_MODES.PUZZLE && engineState.shotsRemaining <= 1)
  ) {
    return;
  }
  const nx = layout.baseX + layout.nextOffsetX;
  const ny = layout.ly + layout.nextOffsetY;
  ctx.save();
  ctx.strokeStyle = theme.launcherAccentColor;
  ctx.lineWidth = launcherGeom.nextBallRingWidth;
  ctx.beginPath();
  ctx.arc(nx, ny, engineState.nextBall.radius + launcherGeom.nextBallRingPadding, 0, MATH_CONSTANTS.TWO_PI);
  ctx.stroke();
  ctx.restore();
  renderer.drawBallAt(ctx, engineState.nextBall, nx, ny, now);
  // The flip only applies to the loaded shot: the next sphere shows its own polarity.
  const rawNext = canShowPolarity ? engineState.getVersusShotPolarity(engineState.nextBall, false) : null;
  const nextPolarity = rawNext ? rawNext * polaritySign : null;
  if (nextPolarity) {
    renderer.drawShotPolarityGlyph(
      ctx,
      nx,
      ny,
      engineState.nextBall.radius * renderer.gameConfig.versus.render.nextGlyphSizeFactor,
      nextPolarity
    );
  }
  if (!layout.spec?.compactQueue) {
    renderer.drawUpcomingBalls(ctx, engineState.upcomingColorIds, nx, ny, engineState.nextBall.radius, now);
  }
}

function measureAnchorRowBounds(balls) {
  let top = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const ball of balls) {
    if (!ball.isAnchor) {
      continue;
    }
    top = Math.min(top, ball.y);
    minX = Math.min(minX, ball.x - ball.radius);
    maxX = Math.max(maxX, ball.x + ball.radius);
  }
  return { top, minX, maxX };
}

function drawAnchorRailHatching(renderer, ctx, sagCfg, sagPhase, minX, maxX, top, half) {
  if (sagPhase === SAG_DRAW.PHASE_CALM || (!renderer.colorPatterns && !renderer.highContrast)) {
    return;
  }
  // Shape cue besides the color: diagonal hatching on the rail while it is stressed.
  ctx.strokeStyle = sagCfg.render.hatchColor;
  ctx.lineWidth = SAG_DRAW.HATCH_WIDTH;
  ctx.beginPath();
  for (let x = minX; x < maxX; x += SAG_DRAW.RAIL_HATCH_STEP) {
    ctx.moveTo(x, top + half);
    ctx.lineTo(x + sagCfg.render.railThickness, top - half);
  }
  ctx.stroke();
}

function drawSagGaugeSegment(ctx, left, y, gauge, fill, hatch, isWarn, isFull, filled, sagCfg, theme) {
  if (!filled) {
    ctx.globalAlpha = SAG_DRAW.EMPTY_ALPHA;
    ctx.fillStyle = theme.launcherAccentColor;
    ctx.fillRect(left, y, gauge.width, gauge.segmentHeight);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.fillStyle = fill;
  ctx.fillRect(left, y, gauge.width, gauge.segmentHeight);
  if (hatch && (isWarn || isFull)) {
    ctx.strokeStyle = sagCfg.render.hatchColor;
    ctx.lineWidth = SAG_DRAW.HATCH_WIDTH;
    ctx.beginPath();
    ctx.moveTo(left, y + gauge.segmentHeight);
    ctx.lineTo(left + gauge.width, y);
    if (isFull) {
      ctx.moveTo(left, y);
      ctx.lineTo(left + gauge.width, y + gauge.segmentHeight);
    }
    ctx.stroke();
  }
}

function drawSagGaugeAlertChrome(ctx, left, top, totalHeight, gauge, fill, isWarn, isFull) {
  if (isWarn) {
    ctx.strokeStyle = fill;
    ctx.lineWidth = SAG_DRAW.OUTLINE_WIDTH;
    ctx.setLineDash(SAG_DRAW.WARN_DASH);
    ctx.strokeRect(
      left - SAG_DRAW.OUTLINE_PADDING,
      top - SAG_DRAW.OUTLINE_PADDING,
      gauge.width + SAG_DRAW.OUTLINE_PADDING * 2,
      totalHeight + SAG_DRAW.OUTLINE_PADDING * 2
    );
    ctx.setLineDash(EMPTY_DASH);
  } else if (isFull) {
    const cx = left + gauge.width * MATH_CONSTANTS.HALF;
    const tipY = top - SAG_DRAW.CHEVRON_GAP;
    ctx.strokeStyle = fill;
    ctx.lineWidth = SAG_DRAW.CHEVRON_WIDTH;
    ctx.beginPath();
    ctx.moveTo(cx - SAG_DRAW.CHEVRON_HALF_WIDTH, tipY - SAG_DRAW.CHEVRON_HEIGHT);
    ctx.lineTo(cx, tipY);
    ctx.lineTo(cx + SAG_DRAW.CHEVRON_HALF_WIDTH, tipY - SAG_DRAW.CHEVRON_HEIGHT);
    ctx.stroke();
  }
}

/**
 * Canvas 2D renderer supporting high-DPI scaling, state interpolation,
 * high-contrast mode, and predictive trajectory/AOE/avalanche overlays.
 */
export class Renderer {
  /**
   * @param {object} [options]
   * @param {boolean} [options.lite] Secondary-board mode: pixel ratio fixed by `renderLite`,
   *   no particles, no aim preview, no slow-motion overlay. The board stays fully readable.
   */
  constructor(canvas, gameConfig, ballsConfig, obstaclesConfig, options = {}) {
    this.canvas = canvas;
    this.lite = Boolean(options?.lite);
    this.maxDevicePixelRatioOption = Number.isFinite(options?.maxDevicePixelRatio) ? options.maxDevicePixelRatio : null;
    this.disposed = false;
    this.windowListeners = [];
    this.resizeObserver = null;
    this.resolutionQuery = null;
    this.resolutionQueryHandler = null;
    this.ctx = canvas.getContext('2d');
    this.gameConfig = gameConfig;
    this.ballsConfig = ballsConfig;
    this.obstaclesConfig = obstaclesConfig;

    initRendererColors(this, ballsConfig, options);
    initRendererMetricsAndCaches(this, gameConfig);
    initRendererGradientAndPairState(this);
    this.activeBallStyle = gameConfig.defaults?.ballStyle || BALL_STYLES.CLASSIC;
    this.ballSpriteKeySuffix = '';
    this.refreshBallSpriteKeySuffix();
    this.bindResolutionListeners();
    this.updateCanvasResolution();
  }

  bindResolutionListeners() {
    if (typeof window === 'undefined') {
      return;
    }
    const invalidate = () => {
      this.resolutionDirty = true;
    };
    for (const type of ['resize', 'orientationchange']) {
      window.addEventListener(type, invalidate);
      this.windowListeners.push({ type, handler: invalidate });
    }
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(invalidate);
      this.resizeObserver.observe(this.canvas);
    }
    this.watchDevicePixelRatio(invalidate);
  }

  /**
   * Moving the window to a screen with another pixel density, or zooming the page,
   * changes devicePixelRatio without always resizing the canvas. A resolution query
   * only matches the ratio it was built for, so each change re-arms a new one.
   */
  watchDevicePixelRatio(onChange) {
    if (this.disposed || typeof window.matchMedia !== 'function') {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const query = window.matchMedia(buildResolutionQuery(dpr));
    if (typeof query.addEventListener !== 'function') {
      return;
    }
    const handler = () => {
      this.resolutionQuery = null;
      this.resolutionQueryHandler = null;
      onChange();
      this.watchDevicePixelRatio(onChange);
    };
    this.resolutionQuery = query;
    this.resolutionQueryHandler = handler;
    query.addEventListener('change', handler, { once: true });
  }

  /**
   * Releases every listener and observer registered on construction. Idempotent.
   */
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      for (const { type, handler } of this.windowListeners) {
        window.removeEventListener(type, handler);
      }
    }
    this.windowListeners = [];
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.resolutionQuery && typeof this.resolutionQuery.removeEventListener === 'function') {
      this.resolutionQuery.removeEventListener('change', this.resolutionQueryHandler);
    }
    this.resolutionQuery = null;
    this.resolutionQueryHandler = null;
  }

  /**
   * Caps the device pixel ratio for this renderer (null removes the cap) and schedules a
   * backing store resize on the next frame.
   */
  setMaxDevicePixelRatio(cap) {
    const next = Number.isFinite(cap) ? cap : null;
    if (next === this.maxDevicePixelRatioOption) {
      return;
    }
    this.maxDevicePixelRatioOption = next;
    this.resolutionDirty = true;
  }

  /** Effective device pixel ratio ceiling: config cap, coarse pointer cap, then the renderer option. */
  getDevicePixelRatioCap() {
    const canvasCfg = this.gameConfig.canvas;
    let cap = canvasCfg.maxDevicePixelRatio;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const query = this.gameConfig.defaults?.coarsePointerMediaQuery;
      if (query && window.matchMedia(query)?.matches) {
        cap = Math.min(cap, canvasCfg.coarsePointerMaxDevicePixelRatio ?? canvasCfg.maxDevicePixelRatio);
      }
    }
    return Math.min(cap, this.maxDevicePixelRatioOption ?? Infinity);
  }

  /**
   * Sizes the backing store from the canvas display size times the capped device pixel
   * ratio. The logical coordinate system is preserved through setTransform in render().
   */
  updateCanvasResolution() {
    if (!this.resolutionDirty) {
      return;
    }
    this.resolutionDirty = false;
    const rawDpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const nextDpr = this.lite
      ? this.gameConfig.renderLite.devicePixelRatio
      : Math.max(1, Math.min(this.getDevicePixelRatioCap(), rawDpr));
    const rect = this.canvas.getBoundingClientRect();
    const displayW = rect.width > 0 ? rect.width : this.logicalWidth;
    const displayH = rect.height > 0 ? rect.height : this.logicalHeight;
    const targetW = Math.max(1, Math.round(displayW * nextDpr));
    const targetH = Math.max(1, Math.round(displayH * nextDpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH || this.dpr !== nextDpr) {
      this.dpr = nextDpr;
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.staticLayerDirty = true;
      this.ballSpriteCache?.clear();
    }
    this.scaleX = this.canvas.width / this.logicalWidth;
    this.scaleY = this.canvas.height / this.logicalHeight;
    const nextDisplayScale = displayW / this.logicalWidth;
    if (nextDisplayScale !== this.displayScale) {
      this.displayScale = nextDisplayScale;
      this.labelFontCache.clear();
    }
  }

  invalidateStaticLayer() {
    this.staticLayerDirty = true;
  }

  createLayerCanvas() {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      return document.createElement('canvas');
    }
    return null;
  }

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
    const override = this.activeArenaTheme && this.activeArenaTheme !== 'deepSpace'
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
    if (theme.horizonGlowColor && theme.transparentColor && typeof layerCtx.createRadialGradient === 'function') {
      const launcherY = this.gameConfig.canvas.launcherY ?? (height - (this.gameConfig.canvas.launcherBottomOffset || 0));
      const glowRadius = width * (theme.horizonGlowRadiusFactor);
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
    this.drawGrid(layerCtx, width, height, theme);
    if (theme.vignetteColor && theme.transparentColor && typeof layerCtx.createRadialGradient === 'function') {
      const cx = width * MATH_CONSTANTS.HALF;
      const cy = height * MATH_CONSTANTS.HALF;
      const innerR = width * (theme.vignetteInnerRadiusFactor);
      const outerR = height * (theme.vignetteOuterRadiusFactor);
      const vignetteGrad = layerCtx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
      vignetteGrad.addColorStop(0, theme.transparentColor);
      vignetteGrad.addColorStop(1, theme.vignetteColor);
      layerCtx.fillStyle = vignetteGrad;
      layerCtx.fillRect(0, 0, width, height);
    }
    this.drawWalls(layerCtx, width, height, theme);
    this.staticLayerDirty = false;
  }

  /** Rebuilds the style/pattern/contrast part of the sprite key; call whenever one of them changes. */
  refreshBallSpriteKeySuffix() {
    const styleKey = this.activeBallStyle || BALL_STYLES.CLASSIC;
    this.ballSpriteKeySuffix = `${styleKey}_${this.colorPatterns ? 1 : 0}_${this.highContrast ? 1 : 0}`;
  }

  setColorPatterns(enabled) {
    const next = Boolean(enabled);
    if (this.colorPatterns !== next) {
      this.colorPatterns = next;
      this.refreshBallSpriteKeySuffix();
      this.ballSpriteCache?.clear();
    }
  }

  setHighContrast(enabled) {
    const next = Boolean(enabled);
    if (this.highContrast !== next) {
      this.highContrast = next;
      this.refreshBallSpriteKeySuffix();
      this.ballSpriteCache?.clear();
    }
  }

  setBallStyle(styleId) {
    if (styleId && typeof styleId === 'string') {
      this.activeBallStyle = styleId;
      this.refreshBallSpriteKeySuffix();
      this.ballGradientCache.clear();
      this.ballSpriteCache?.clear();
    }
  }

  setArenaTheme(themeId) {
    if (themeId && typeof themeId === 'string' && this.activeArenaTheme !== themeId) {
      this.activeArenaTheme = themeId;
      this.staticLayerDirty = true;
    }
  }

  /**
   * Polarity glyphs are the color-independent cue for a ball, so on a small canvas
   * they grow toward the ball edge to stay at a readable on-screen size.
   * @returns {{font: string, isEnlarged: boolean}}
   */
  getLabelFont(radius) {
    let entry = this.labelFontCache.get(radius);
    if (!entry) {
      const renderCfg = this.ballsConfig.render;
      const family = this.gameConfig.theme.fontFamily;
      const minLogicalPx = renderCfg.labelMinDisplayPx / this.displayScale;
      const maxLogicalPx = radius * renderCfg.labelScaleMax;
      const build = (scale) => {
        const basePx = radius * scale;
        const px = Math.min(maxLogicalPx, Math.max(basePx, minLogicalPx));
        return { font: `bold ${Math.round(px)}px ${family}`, isEnlarged: px > basePx };
      };
      entry = {
        normal: build(renderCfg.labelScaleNormal),
        highContrast: build(renderCfg.labelScaleHighContrast)
      };
      this.labelFontCache.set(radius, entry);
    }
    return this.highContrast ? entry.highContrast : entry.normal;
  }

  getBadgeFont(radius) {
    let font = this.badgeFontCache.get(radius);
    if (!font) {
      const scale = this.ballsConfig.render.badgeFontScale;
      font = `bold ${Math.round(radius * scale)}px ${this.gameConfig.theme.fontFamily}`;
      this.badgeFontCache.set(radius, font);
    }
    return font;
  }

  getCachedBallGradient(palette, radius) {
    const key = `${palette.id}_${radius}`;
    let grad = this.ballGradientCache.get(key);
    if (!grad) {
      const renderCfg = this.ballsConfig.render;
      const offset = radius * renderCfg.gradientOffsetFactor;
      grad = this.ctx.createRadialGradient(
        offset,
        offset,
        radius * renderCfg.gradientInnerRadiusFactor,
        0,
        0,
        radius
      );
      grad.addColorStop(0, palette.highlight);
      grad.addColorStop(renderCfg.gradientMidStop, palette.fill);
      grad.addColorStop(1, palette.shadow);
      this.ballGradientCache.set(key, grad);
    }
    return grad;
  }

  interpolate(prev, curr, alpha) {
    return prev !== undefined ? prev + (curr - prev) * alpha : curr;
  }

  /**
   * Vertical distance, in logical pixels, still left for an incoming Flux shape to travel.
   * Eases out so the shape lands softly; 0 once it is in place or outside Flux.
   */
  getStageIntroOffset(engineState) {
    if (typeof engineState.getStageIntroProgress !== 'function' || !engineState.fluxConfig) {
      return 0;
    }
    const remaining = 1 - engineState.getStageIntroProgress();
    if (remaining <= 0) {
      return 0;
    }
    return engineState.fluxConfig.transition.introDropDistance * remaining ** INTRO_EASE_POWER;
  }

  render(engineState, alpha = 1.0) {
    this.updateCanvasResolution();
    if (this.staticLayerDirty) {
      this.buildStaticLayer();
    }
    const ctx = this.ctx;
    const width = this.logicalWidth;
    const height = this.logicalHeight;
    const theme = this.gameConfig.theme;
    // Every pulse, glow and field wave is a function of this clock: holding it still under
    // reduced motion freezes them all, while the physics keeps moving the board.
    this.isReducedMotion = Boolean(engineState.isReducedMotion);
    const magnetarView = this.resolveMagnetarView(engineState);
    this.magnetarView = magnetarView;
    const now = this.isReducedMotion ? REDUCED_MOTION_CLOCK_MS : performance.now();

    prepareFrameCanvas(this, engineState, theme, width, height);
    const behavior = typeof engineState.getModeBehavior === 'function' ? engineState.getModeBehavior() : null;
    const chrome = behavior ? behavior.getRenderChrome(engineState) : null;

    renderBoardChrome(this, ctx, engineState, width, height, theme, behavior, chrome, now, alpha);
    renderClusterStageLayer(this, ctx, engineState, theme, magnetarView, now, alpha);
    renderForegroundAction(this, ctx, engineState, theme, behavior, chrome, now, alpha);
    renderForegroundChrome(this, ctx, engineState, width, height, theme, behavior, magnetarView, now, alpha);
    ctx.restore();
  }

  /**
   * Renders a brief full-arena impact flash and a cinematic perimeter glow while
   * special-ball slow-motion time dilation is active.
   */
  drawSlowMoOverlay(ctx, engineState, width, height, alpha = 1.0) {
    if (this.isReducedMotion) {
      return;
    }
    const ps = engineState.particleSystem;
    if (ps?.screenFlash) {
      const sf = ps.screenFlash;
      const flashAlpha = Math.max(0, this.interpolate(sf.prevAlpha ?? sf.alpha, sf.alpha, alpha));
      if (flashAlpha > 0) {
        ctx.save();
        ctx.fillStyle = sf.color;
        ctx.globalAlpha = flashAlpha;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
    }
    if (engineState.specialSlowMoFrames > 0 && typeof engineState.getTimeScale === 'function') {
      const timeScale = engineState.getTimeScale();
      if (timeScale < 1) {
        const slowCfg = this.gameConfig.juice.slowMotion;
        const pCfg = this.gameConfig.juice.particles;
        const edgeAlpha = (1 - timeScale) * (slowCfg.vignetteMaxAlpha);
        if (edgeAlpha > 0) {
          const cx = width * MATH_CONSTANTS.HALF;
          const cy = height * MATH_CONSTANTS.HALF;
          const innerR = width * (slowCfg.vignetteInnerRadiusFactor);
          const outerR = height * (slowCfg.vignetteOuterRadiusFactor);
          const color = engineState.specialSlowMoColor || slowCfg.vignetteDefaultColor;
          const vignetteKey = `${cx}_${cy}_${innerR}_${outerR}_${color}`;
          if (this.slowMoVignetteKey !== vignetteKey || this.slowMoVignetteCtx !== ctx) {
            const built = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
            built.addColorStop(0, pCfg.flashEdgeColor);
            built.addColorStop(1, color);
            this.slowMoVignetteGradient = built;
            this.slowMoVignetteKey = vignetteKey;
            this.slowMoVignetteCtx = ctx;
          }
          const grad = this.slowMoVignetteGradient;
          ctx.save();
          ctx.fillStyle = grad;
          ctx.globalAlpha = edgeAlpha;
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
        }
      }
    }
  }

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

    if (theme.gridNodeColor && theme.gridNodeSize) {
      const nodeSize = theme.gridNodeSize;
      const halfNode = nodeSize * MATH_CONSTANTS.HALF;
      ctx.fillStyle = theme.gridNodeColor;
      for (let x = step; x < width; x += step) {
        for (let y = step; y < height; y += step) {
          ctx.fillRect(x - halfNode, y - halfNode, nodeSize, nodeSize);
        }
      }
    }
  }

  isBallInDangerWarning(ball, warningThresholdY, alpha) {
    return !ball.isDropping && this.interpolate(ball.prevY, ball.y, alpha) + ball.radius >= warningThresholdY;
  }

  drawDangerZone(ctx, width, height, theme, balls, now, alpha = 1.0) {
    const margin = this.gameConfig.canvas.wallMargin;
    const dangerY = this.gameConfig.canvas.dangerLineY;
    const warningMargin = this.gameConfig.canvas.dangerWarningMarginY;
    const warningThresholdY = dangerY - warningMargin;

    let isWarning = false;
    for (const b of balls) {
      if (this.isBallInDangerWarning(b, warningThresholdY, alpha)) {
        isWarning = true;
        break;
      }
    }

    const pulse = isWarning
      ? theme.magneticPulseBase + theme.magneticPulseAmp * Math.sin(now * theme.dangerWarningPulseSpeed)
      : 1.0;

    ctx.fillStyle = isWarning ? theme.dangerZoneWarningFill : theme.dangerZoneFill;
    ctx.fillRect(margin, dangerY, width - margin * 2, height - dangerY);

    ctx.save();
    ctx.setLineDash(theme.dangerLineDash);
    ctx.strokeStyle = theme.dangerLineColor;
    ctx.lineWidth = isWarning ? theme.dangerLineWidth + theme.dangerWarningLineWidthExtra : theme.dangerLineWidth;
    ctx.globalAlpha = isWarning ? pulse : 1.0;
    ctx.beginPath();
    ctx.moveTo(margin, dangerY);
    ctx.lineTo(width - margin, dangerY);
    ctx.stroke();

    if (isWarning) {
      ctx.setLineDash(EMPTY_DASH);
      ctx.fillStyle = theme.dangerBallRingColor;
      ctx.strokeStyle = theme.dangerBallRingColor;
      ctx.lineWidth = theme.aimTargetMatchLineWidth;
      const glowPadding = theme.dangerBallGlowPadding || theme.aimTargetRingPadding;
      const glowAlpha = (theme.dangerBallGlowAlpha || 0) * pulse;
      for (const b of balls) {
        if (!this.isBallInDangerWarning(b, warningThresholdY, alpha)) {
          continue;
        }
        const bx = this.interpolate(b.prevX, b.x, alpha);
        const by = this.interpolate(b.prevY, b.y, alpha);
        if (glowAlpha > 0) {
          ctx.globalAlpha = glowAlpha;
          ctx.beginPath();
          ctx.arc(bx, by, b.radius + glowPadding, 0, MATH_CONSTANTS.TWO_PI);
          ctx.fill();
        }
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.arc(bx, by, b.radius + theme.aimTargetRingPadding, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawWalls(ctx, width, height, theme) {
    const margin = this.gameConfig.canvas.wallMargin;
    ctx.strokeStyle = theme.wallGlowColor;
    ctx.lineWidth = theme.wallGlowLineWidth;
    ctx.strokeRect(margin * MATH_CONSTANTS.HALF, margin * MATH_CONSTANTS.HALF, width - margin, height - margin);

    ctx.strokeStyle = theme.wallColor;
    ctx.lineWidth = theme.wallLineWidth;
    ctx.strokeRect(margin * MATH_CONSTANTS.HALF, margin * MATH_CONSTANTS.HALF, width - margin, height - margin);

    if (theme.wallCornerColor && theme.wallCornerLength) {
      const inset = margin * MATH_CONSTANTS.HALF;
      const left = inset;
      const top = inset;
      const right = width - inset;
      const bottom = height - inset;
      const len = theme.wallCornerLength;
      ctx.strokeStyle = theme.wallCornerColor;
      ctx.lineWidth = theme.wallCornerLineWidth || theme.wallLineWidth;
      ctx.beginPath();
      ctx.moveTo(left, top + len);
      ctx.lineTo(left, top);
      ctx.lineTo(left + len, top);
      ctx.moveTo(right - len, top);
      ctx.lineTo(right, top);
      ctx.lineTo(right, top + len);
      ctx.moveTo(left, bottom - len);
      ctx.lineTo(left, bottom);
      ctx.lineTo(left + len, bottom);
      ctx.moveTo(right - len, bottom);
      ctx.lineTo(right, bottom);
      ctx.lineTo(right, bottom - len);
      ctx.stroke();
    }
  }

  drawMagneticBonds(ctx, physicsWorld, theme, now, alpha = 1.0) {
    const pulse = theme.magneticPulseBase + theme.magneticPulseAmp * Math.sin(now * theme.magneticFieldPulseSpeed);
    const magCfg = physicsWorld.physicsConfig.magnetism;
    const simCfg = physicsWorld.physicsConfig.simulation;
    const ballRadius = physicsWorld.physicsConfig.ball.radius;
    const fieldMaxDist = ballRadius * magCfg.fieldLineMaxDistanceFactor;
    const fieldMaxDistSq = fieldMaxDist * fieldMaxDist;
    const stressDist = ballRadius * simCfg.bondRestDistanceFactor * theme.magneticStressThresholdFactor;

    ctx.save();
    strokeMagneticFieldLines(this, ctx, physicsWorld, theme, pulse, fieldMaxDistSq, alpha);
    ctx.lineWidth = theme.magneticBondLineWidth;
    const segments = collectBondSegments(this, physicsWorld, stressDist, alpha);
    strokeBondGlowAndSegments(this, ctx, segments, theme, pulse);
    ctx.restore();
  }

  strokeSegments(ctx, coords, strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.beginPath();
    for (let i = 0; i < coords.length; i += SEGMENT_STRIDE) {
      ctx.moveTo(coords[i], coords[i + 1]);
      ctx.lineTo(coords[i + 2], coords[i + 3]);
    }
    ctx.stroke();
  }

  /**
   * Rebuilds the portal link map only when the obstacle list changes, so per-frame
   * drawing needs neither a Set nor a linear mate search.
   */
  refreshPortalLinks(obstacles) {
    const source = this.portalLinkSource;
    let changed = source.length !== obstacles.length;
    for (let i = 0; !changed && i < obstacles.length; i++) {
      changed = source[i] !== obstacles[i];
    }
    if (!changed) {
      return;
    }
    source.length = 0;
    this.portalLinks.clear();
    const firstByPair = new Map();
    for (const obs of obstacles) {
      source.push(obs);
      if (obs.type !== OBSTACLE_TYPES.PORTAL || !obs.pairId) {
        continue;
      }
      const lead = firstByPair.get(obs.pairId);
      if (lead) {
        if (!this.portalLinks.has(lead)) {
          this.portalLinks.set(lead, obs);
        }
      } else {
        firstByPair.set(obs.pairId, obs);
      }
    }
  }

  drawObstacles(ctx, obstacles, now, alpha = 1.0) {
    const typesCfg = this.obstaclesConfig.types;
    const obsDefaults = this.obstaclesConfig.defaults;
    this.refreshPortalLinks(obstacles);

    for (const obs of obstacles) {
      if (obs.disabled) {
        continue;
      }
      const drawer = OBSTACLE_DRAWERS[obs.type];
      if (!drawer) {
        continue;
      }
      const cfg = typesCfg[obs.type] || {};
      const ox = this.interpolate(obs.prevX, obs.x, alpha);
      const oy = this.interpolate(obs.prevY, obs.y, alpha);
      const oAngle = this.interpolate(obs.prevAngle, obs.angle, alpha);
      ctx.save();
      drawer(this, ctx, obs, ox, oy, oAngle, cfg, obsDefaults, now, alpha);
      ctx.restore();
    }
  }

  getBallPalette(ball) {
    if (ball.specialType) {
      return this.ballsConfig.specialTypes[ball.specialType];
    }
    if (!ball.colorId) {
      return ball.clusterModifier === CLUSTER_MODIFIERS.RUST ? this.ballsConfig.rustPalette : this.ballsConfig.neutralPalette;
    }
    return this.colorMap.get(ball.colorId) || this.ballsConfig.standardColors[0];
  }

  drawBall(ctx, ball, now, alpha = 1.0) {
    this.drawBallAt(
      ctx,
      ball,
      this.interpolate(ball.prevX, ball.x, alpha),
      this.interpolate(ball.prevY, ball.y, alpha),
      now
    );
  }

  /**
   * Renders the sphere body (radial gradient, active style overlay, colorblind pattern,
   * outline border, rim-light arc, and specular highlights) centered at (0, 0).
   */
  drawBallOrb(ctx, palette, r) {
    const renderCfg = this.ballsConfig.render;
    ctx.fillStyle = this.getCachedBallGradient(palette, r);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    if (this.activeBallStyle && this.activeBallStyle !== BALL_STYLES.CLASSIC) {
      this.drawBallStyleOverlay(ctx, palette, r);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, MATH_CONSTANTS.TWO_PI);
    }
    if (this.colorPatterns && palette.pattern) {
      this.drawColorPattern(ctx, palette.pattern, r);
      // save/restore does not keep the current path: rebuild the outline the border strokes.
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, MATH_CONSTANTS.TWO_PI);
    }

    ctx.strokeStyle = this.highContrast ? renderCfg.borderStrokeHighContrast : renderCfg.borderStrokeNormal;
    ctx.lineWidth = this.highContrast ? renderCfg.borderWidthHighContrast : renderCfg.borderWidthNormal;
    ctx.stroke();

    if (renderCfg.rimLightAlpha && !this.highContrast) {
      ctx.save();
      ctx.strokeStyle = palette.highlight;
      ctx.globalAlpha = renderCfg.rimLightAlpha;
      ctx.lineWidth = renderCfg.borderWidthNormal;
      ctx.beginPath();
      ctx.arc(
        0,
        0,
        Math.max(1, r - (renderCfg.rimLightInset)),
        renderCfg.rimLightStartAngle,
        renderCfg.rimLightEndAngle
      );
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = renderCfg.shineColor;
    ctx.beginPath();
    ctx.ellipse(
      r * renderCfg.shineOffsetFactor,
      r * renderCfg.shineOffsetFactor,
      r * renderCfg.shineRadiusXFactor,
      r * renderCfg.shineRadiusYFactor,
      -MATH_CONSTANTS.QUARTER_PI,
      0,
      MATH_CONSTANTS.TWO_PI
    );
    ctx.fill();

    if (renderCfg.secondaryShineRadiusFactor) {
      ctx.save();
      ctx.fillStyle = renderCfg.shineColor;
      ctx.globalAlpha = renderCfg.secondaryShineAlpha;
      const secOffset = r * (renderCfg.secondaryShineOffsetFactor);
      ctx.beginPath();
      ctx.arc(secOffset, secOffset, r * renderCfg.secondaryShineRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Returns a cached offscreen sprite canvas for a sphere's static orb layer, keyed by
   * palette, radius, ball style, colorblind pattern, and high-contrast state.
   */
  getCachedBallSprite(palette, radius) {
    if (!this.ballSpriteCache) {
      return null;
    }
    const key = `${palette.id}_${radius}_${this.ballSpriteKeySuffix}`;
    let entry = this.ballSpriteCache.get(key);
    if (!entry) {
      const spriteCanvas = this.createLayerCanvas();
      if (!spriteCanvas) {
        return null;
      }
      const pad = this.ballsConfig.render.spritePadding;
      const halfLogical = radius + pad;
      const logicalSize = halfLogical * 2;
      const scaleX = this.scaleX || 1;
      const scaleY = this.scaleY || 1;
      spriteCanvas.width = Math.max(1, Math.ceil(logicalSize * scaleX));
      spriteCanvas.height = Math.max(1, Math.ceil(logicalSize * scaleY));
      const spriteCtx = spriteCanvas.getContext('2d');
      spriteCtx.setTransform(scaleX, 0, 0, scaleY, halfLogical * scaleX, halfLogical * scaleY);
      this.drawBallOrb(spriteCtx, palette, radius);
      entry = { canvas: spriteCanvas, halfLogical, logicalSize };
      this.ballSpriteCache.set(key, entry);
    }
    return entry;
  }

  drawBallAt(ctx, ball, bxPos, byPos, now) {
    const palette = this.getBallPalette(ball);
    const r = ball.radius;
    const theme = this.gameConfig.theme;
    const renderCfg = this.ballsConfig.render;

    ctx.save();
    ctx.translate(bxPos, byPos);
    if (ball.impactScale !== 1) {
      ctx.scale(ball.impactScale, ball.impactScale);
    }
    drawBallPreOrbEffects(ctx, ball, palette, r, theme, renderCfg);

    const sprite = this.getCachedBallSprite(palette, r);
    if (sprite) {
      ctx.drawImage(sprite.canvas, -sprite.halfLogical, -sprite.halfLogical, sprite.logicalSize, sprite.logicalSize);
    } else {
      this.drawBallOrb(ctx, palette, r);
    }
    if (ball.isFrozen) {
      ctx.fillStyle = theme.frozenOverlayColor;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
    }

    const modSpec = ball.clusterModifier ? this.ballsConfig.clusterModifiers?.[ball.clusterModifier] : null;
    drawBallModifierRing(ctx, ball, r, renderCfg, modSpec);
    drawBallPrimaryLabel(this, ctx, palette, r, theme, renderCfg);
    drawBallModifierBadge(this, ctx, r, theme, renderCfg, modSpec);
    drawBallPostOrbEffects(this, ctx, ball, palette, r, now, renderCfg);
    ctx.restore();
  }

  drawBallStyleOverlay(ctx, palette, r) {
    const stylesCfg = this.ballsConfig.styles || {};
    const styleSpec = stylesCfg[this.activeBallStyle];
    if (!styleSpec) {
      return;
    }
    ctx.save();
    if (this.activeBallStyle === BALL_STYLES.CRYSTAL) {
      const innerR = r * styleSpec.innerRadiusFactor;
      const sides = styleSpec.facetSides;
      ctx.strokeStyle = palette.highlight;
      ctx.globalAlpha = styleSpec.facetAlpha;
      ctx.lineWidth = styleSpec.rimWidth;
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const angle = (MATH_CONSTANTS.TWO_PI * i) / sides;
        const px = Math.cos(angle) * innerR;
        const py = Math.sin(angle) * innerR;
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.stroke();
    } else if (this.activeBallStyle === BALL_STYLES.NEON) {
      ctx.fillStyle = styleSpec.coreFill;
      ctx.beginPath();
      ctx.arc(0, 0, r * styleSpec.coreRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
      ctx.strokeStyle = palette.highlight;
      ctx.lineWidth = styleSpec.ringLineWidth;
      ctx.beginPath();
      ctx.arc(0, 0, r * styleSpec.ringRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
    } else if (this.activeBallStyle === BALL_STYLES.METALLIC) {
      ctx.strokeStyle = styleSpec.rimStroke || palette.highlight;
      ctx.globalAlpha = styleSpec.bandAlpha;
      ctx.lineWidth = this.ballsConfig.render.modifierRingLineWidth;
      ctx.beginPath();
      ctx.arc(0, 0, r * styleSpec.innerRingRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draws magnetic collector slots along the bottom edge of the board where falling
   * avalanche spheres score extra collector points and overcharge.
   */
  drawCollectorBins(ctx, width, height, theme, engineState = null) {
    const collectorCfg = this.gameConfig.scoring?.collector;
    if (!collectorCfg || !collectorCfg.zoneHeight || !collectorCfg.slotCount) {
      return;
    }
    const margin = this.gameConfig.canvas.wallMargin;
    const innerWidth = width - margin * 2;
    const topY = height - collectorCfg.zoneHeight;
    const slotWidth = innerWidth / collectorCfg.slotCount;

    ctx.save();
    ctx.fillStyle = theme.collectorSlotFill || theme.dangerZoneFill;
    ctx.fillRect(margin, topY, innerWidth, collectorCfg.zoneHeight);

    ctx.strokeStyle = theme.collectorSlotStroke || theme.wallColor;
    ctx.lineWidth = collectorCfg.lineWidth;
    ctx.beginPath();
    ctx.moveTo(margin, topY);
    ctx.lineTo(width - margin, topY);
    ctx.stroke();

    ctx.strokeStyle = theme.collectorDividerColor || theme.wallColor;
    ctx.beginPath();
    for (let i = 1; i < collectorCfg.slotCount; i++) {
      const dividerX = margin + i * slotWidth;
      ctx.moveTo(dividerX, topY);
      ctx.lineTo(dividerX, height - margin * MATH_CONSTANTS.HALF);
    }
    ctx.stroke();

    drawCollectorSlotLabels(this, ctx, collectorCfg, margin, topY, slotWidth, theme, engineState);
    ctx.restore();
  }

  /**
   * A pattern unique to each color, drawn inside the sphere, so colors stay apart for
   * players who cannot tell them by hue.
   */
  drawColorPattern(ctx, pattern, r) {
    const renderCfg = this.ballsConfig.render;
    const step = r * renderCfg.patternSpacingFactor;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, MATH_CONSTANTS.TWO_PI);
    ctx.clip();
    ctx.strokeStyle = renderCfg.patternColor;
    ctx.fillStyle = renderCfg.patternColor;
    ctx.lineWidth = renderCfg.patternLineWidth;
    ctx.beginPath();
    // Parallel lines along the unit direction (dx, dy), spaced along its normal (-dy, dx).
    const lines = (dx, dy) => {
      for (let offset = -r * 2; offset <= r * 2; offset += step) {
        ctx.moveTo(-r * 2 * dx - offset * dy, -r * 2 * dy + offset * dx);
        ctx.lineTo(r * 2 * dx - offset * dy, r * 2 * dy + offset * dx);
      }
    };
    if (pattern === PATTERNS.STRIPES_H) {
      lines(1, 0);
    } else if (pattern === PATTERNS.STRIPES_V) {
      lines(0, 1);
    } else if (pattern === PATTERNS.STRIPES_D) {
      lines(Math.SQRT1_2, Math.SQRT1_2);
    } else if (pattern === PATTERNS.GRID) {
      lines(1, 0);
      lines(0, 1);
    } else if (pattern === PATTERNS.RINGS) {
      for (let radius = step; radius < r; radius += step) {
        ctx.moveTo(radius, 0);
        ctx.arc(0, 0, radius, 0, MATH_CONSTANTS.TWO_PI);
      }
    }
    ctx.stroke();
    if (pattern === PATTERNS.DOTS) {
      const dotRadius = r * renderCfg.patternDotRadiusFactor;
      for (let x = -r; x <= r; x += step) {
        for (let y = -r; y <= r; y += step) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, MATH_CONSTANTS.TWO_PI);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /** The rail each sliding anchor runs on, with a stop at both ends. */
  drawRails(ctx, physicsWorld) {
    const renderCfg = this.ballsConfig.render;
    ctx.save();
    ctx.strokeStyle = renderCfg.railColor;
    ctx.fillStyle = renderCfg.railColor;
    ctx.lineWidth = renderCfg.railLineWidth;
    for (const ball of physicsWorld.balls) {
      if (ball.railMinX === null || ball.railMaxX === null) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(ball.railMinX, ball.anchorY);
      ctx.lineTo(ball.railMaxX, ball.anchorY);
      ctx.stroke();
      for (const stopX of [ball.railMinX, ball.railMaxX]) {
        ctx.beginPath();
        ctx.arc(stopX, ball.anchorY, renderCfg.railStopRadius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Tether links, drawn as a fixed zigzag arc so they read apart from short bonds. */
  drawTethers(ctx, physicsWorld, alpha) {
    const tetherSpec = this.ballsConfig.clusterModifiers.tether;
    ctx.save();
    ctx.strokeStyle = tetherSpec.arcColor;
    ctx.lineWidth = tetherSpec.arcWidth;
    ctx.beginPath();
    for (const a of physicsWorld.balls) {
      for (const neighborId of a.tethers) {
        const b = physicsWorld.ballMap.get(neighborId);
        if (!b || neighborId < a.id || !isTetherLink(a, b)) {
          continue;
        }
        const ax = this.interpolate(a.prevX, a.x, alpha);
        const ay = this.interpolate(a.prevY, a.y, alpha);
        const bx = this.interpolate(b.prevX, b.x, alpha);
        const by = this.interpolate(b.prevY, b.y, alpha);
        const length = Math.hypot(bx - ax, by - ay) || MATH_CONSTANTS.EPSILON;
        const nx = -(by - ay) / length;
        const ny = (bx - ax) / length;
        ctx.moveTo(ax, ay);
        for (let i = 1; i < tetherSpec.arcSegments; i++) {
          const t = i / tetherSpec.arcSegments;
          const side = i % 2 === 0 ? 1 : -1;
          ctx.lineTo(ax + (bx - ax) * t + nx * side * tetherSpec.arcAmplitude, ay + (by - ay) * t + ny * side * tetherSpec.arcAmplitude);
        }
        ctx.lineTo(bx, by);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Chain links sit where touching spheres hide their bonds, so each chain link also gets a
   * small metal link drawn on top, at the contact point between the two spheres.
   */
  drawChainLinkOverlays(ctx, physicsWorld, alpha) {
    const chainSpec = this.ballsConfig.clusterModifiers.chained;
    ctx.save();
    ctx.lineCap = 'round';
    for (const a of physicsWorld.balls) {
      for (const neighborId of a.bonds) {
        const b = physicsWorld.ballMap.get(neighborId);
        if (!b || neighborId < a.id || !isChainLink(a, b)) {
          continue;
        }
        const ax = this.interpolate(a.prevX, a.x, alpha);
        const ay = this.interpolate(a.prevY, a.y, alpha);
        const bx = this.interpolate(b.prevX, b.x, alpha);
        const by = this.interpolate(b.prevY, b.y, alpha);
        const angle = Math.atan2(by - ay, bx - ax);
        const mx = (ax + bx) * MATH_CONSTANTS.HALF;
        const my = (ay + by) * MATH_CONSTANTS.HALF;
        for (const [color, width] of [[chainSpec.overlayShadowColor, chainSpec.overlayShadowWidth], [chainSpec.linkColor, chainSpec.overlayLineWidth]]) {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.ellipse(mx, my, chainSpec.overlayLinkLength * MATH_CONSTANTS.HALF, chainSpec.overlayLinkWidth * MATH_CONSTANTS.HALF, angle, 0, MATH_CONSTANTS.TWO_PI);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /** Translucent shell around a bubbled ball: its color stays visible but it cannot match yet. */
  drawBubbleShell(ctx, r) {
    const bubbleSpec = this.ballsConfig.clusterModifiers.bubble;
    const shellRadius = r * bubbleSpec.shellRadiusFactor;
    ctx.globalAlpha = 1;
    ctx.fillStyle = bubbleSpec.shellColor;
    ctx.strokeStyle = bubbleSpec.ringColor;
    ctx.lineWidth = bubbleSpec.shellLineWidth;
    ctx.beginPath();
    ctx.arc(0, 0, shellRadius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.stroke();
  }

  /**
   * Returns true when the cached aim preview was built for exactly this aim, launcher
   * ball and board signature, and refreshes the cache key otherwise.
   */
  isAimPreviewFresh(points, currentBall, physicsWorld, endX, endY, blastMult, aimAngle) {
    const cache = this.aimPreview;
    const cell = this.gameConfig.canvas.aimPreviewCacheCellPx;
    const shotKey = {
      aimAngle,
      cellX: Math.round(endX / cell),
      cellY: Math.round(endY / cell),
      ballId: currentBall.id,
      specialType: currentBall.specialType,
      colorId: currentBall.colorId,
      snapTargetId: points.snapTarget ? points.snapTarget.id : 0,
      blastMult
    };
    const boardSig = computeBoardSignature(physicsWorld, this.colorWeights);
    const fresh = matchesAimShotKey(cache, shotKey) && matchesAimBoardKey(cache, boardSig);
    if (!fresh) {
      Object.assign(cache, shotKey, boardSig, { valid: true });
    }
    return fresh;
  }

  /**
   * Computes the balls highlighted, destroyed and detached by the current aim. Runs the
   * cluster BFS and detachment search only when the aim target or the board changed.
   */
  computeAimPreview(points, currentBall, physicsWorld, endX, endY, blastMult) {
    const cache = this.aimPreview;
    const highlight = cache.highlightBalls;
    const destroyedIds = cache.destroyedIds;
    cache.avalancheBalls = [];
    this.aimPreviewComputeCount++;

    const { isMatch } = predictImpact(
      {
        points,
        currentBall,
        physicsWorld,
        endX,
        endY,
        blastMult,
        specialTypes: this.ballsConfig.specialTypes,
        matchMinCount: this.gameConfig.defaults.matchMinCount
      },
      { highlight, destroyedIds }
    );
    cache.highlightIsMatch = isMatch;

    if (destroyedIds.size > 0) {
      cache.avalancheBalls = physicsWorld.findDetachedIfRemoved(destroyedIds);
    }
  }

  strokeBallRings(ctx, balls, padding, alpha) {
    for (const b of balls) {
      ctx.beginPath();
      ctx.arc(
        this.interpolate(b.prevX, b.x, alpha),
        this.interpolate(b.prevY, b.y, alpha),
        b.radius + padding,
        0,
        MATH_CONSTANTS.TWO_PI
      );
      ctx.stroke();
    }
  }

  drawAimTrajectory(ctx, points, currentBall, physicsWorld, theme, now, blastRadiusMultiplier, aimAngle, alpha = 1.0) {
    if (!points || points.length < 2 || !currentBall) {
      return;
    }
    const palette = this.getBallPalette(currentBall);
    ctx.save();
    strokeAimTrajectoryPath(this, ctx, points, palette, theme, now);

    const endX = points.landingX !== undefined ? points.landingX : points[points.length - 1].x;
    const endY = points.landingY !== undefined ? points.landingY : points[points.length - 1].y;
    ctx.globalAlpha = theme.aimGhostFillAlpha;
    ctx.fillStyle = palette.fill;
    ctx.beginPath();
    ctx.arc(endX, endY, currentBall.radius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.globalAlpha = theme.aimGhostStrokeAlpha;
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = theme.aimGhostLineWidth;
    ctx.stroke();

    if (!physicsWorld) {
      ctx.restore();
      return;
    }
    const pulse = theme.magneticPulseBase + theme.magneticPulseAmp * Math.sin(now * theme.aimTargetPulseSpeed);
    if (!this.isAimPreviewFresh(points, currentBall, physicsWorld, endX, endY, blastRadiusMultiplier, aimAngle)) {
      this.computeAimPreview(points, currentBall, physicsWorld, endX, endY, blastRadiusMultiplier);
    }
    drawAimSpecialAoe(this, ctx, currentBall, palette, theme, pulse, endX, endY, blastRadiusMultiplier);
    drawAimTargetHighlights(this, ctx, this.aimPreview, palette, theme, pulse, alpha);
    ctx.restore();
  }

  /**
   * Beat ring of Resonance around the launcher: it shrinks onto the launcher with each beat,
   * and while the window is open it is solid and thick (outside the window it is thin and
   * dashed, so the cue never rests on colour alone). Under reduced motion the radius stays
   * fixed and only the opacity moves. Drawn only while Resonance is live on the board, so
   * the competitive modes and a CPU board show nothing. A flash marks a Resonant release.
   */
  drawBeatRing(ctx, engineState, theme) {
    const pulse = typeof engineState.getBeatState === 'function' ? engineState.getBeatState() : null;
    if (!pulse?.resonanceActive) {
      return;
    }
    const cfg = this.gameConfig.resonance;
    const ring = cfg.ring;
    const canvasCfg = this.gameConfig.canvas;
    const { rx, ry } = resolveBeatRingAnchor(engineState, canvasCfg);
    const baseRadius = canvasCfg.launcher.baseRadius * ring.radiusFactor;
    const visual = ringVisual(pulse.beatFrame, {
      framesPerBeat: pulse.framesPerBeat,
      windowFrames: pulse.windowFrames,
      reducedMotion: this.isReducedMotion,
      cfg
    });
    const widthFactor = this.highContrast ? ring.highContrastWidthFactor : 1;
    const color = this.highContrast ? ring.highContrastColor : theme.launcherAccentColor;
    const lineWidth = (visual.inWindow ? ring.windowLineWidth : ring.lineWidth) * widthFactor;
    ctx.save();
    ctx.strokeStyle = color;
    if (visual.inWindow) {
      ctx.globalAlpha = ring.bandAlpha;
      ctx.lineWidth = lineWidth * ring.bandWidthFactor;
      ctx.beginPath();
      ctx.arc(rx, ry, baseRadius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
    }
    ctx.globalAlpha = visual.opacity;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(visual.inWindow ? EMPTY_DASH : ring.dashPattern);
    ctx.beginPath();
    ctx.arc(rx, ry, baseRadius * visual.radiusScale, 0, MATH_CONSTANTS.TWO_PI);
    ctx.stroke();
    ctx.setLineDash(EMPTY_DASH);
    if (engineState.resonanceFlashFrames > 0 && !this.isReducedMotion) {
      ctx.globalAlpha = ring.flashAlpha * (engineState.resonanceFlashFrames / ring.flashFrames);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(rx, ry, baseRadius * ring.flashRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  drawLauncher(ctx, engineState, theme, now) {
    const canvasCfg = this.gameConfig.canvas;
    const launcherGeom = canvasCfg.launcher;
    const layout = resolveLauncherSpecLayout(engineState, canvasCfg);
    drawDropRailAndCancelChrome(ctx, engineState, theme, launcherGeom, layout);
    drawLauncherChassis(ctx, engineState, theme, launcherGeom, layout);
    if (!layout.isDropRail) {
      this.drawBeatRing(ctx, engineState, theme);
    }
    drawBlitzAutoFireRing(this, ctx, engineState, theme, launcherGeom, layout.lx, layout.ly);

    const canShowPolarity = !this.lite
      && (Boolean(engineState.versus) || Boolean(this.magnetarView))
      && typeof engineState.getVersusShotPolarity === 'function';
    // A Magnetar Reverse Field flips how the shot is pulled: the glyph shows the effective sign.
    const polaritySign = engineState.physicsWorld?.boardPolarityInverted ? -1 : 1;
    drawLauncherCurrentBall(this, ctx, engineState, launcherGeom, layout, canShowPolarity, polaritySign, now);
    drawLauncherNextBall(this, ctx, engineState, theme, launcherGeom, layout, canShowPolarity, polaritySign, now);
  }

  /**
   * Vertical distance the cluster is still drawn above its physical place after a Sag step.
   * Zero under reduced motion, with no step in flight, or in a mode without a Sag meter.
   */
  getRailLowerOffset(engineState) {
    const remaining = engineState.railLowerFrames;
    const sagCfg = this.gameConfig.sag;
    if (!(remaining > 0) || this.isReducedMotion || !sagCfg || !(sagCfg.lowerFrames > 0)) {
      return 0;
    }
    if (!sagCfg.modes?.[engineState.mode]) {
      return 0;
    }
    const stepY = this.gameConfig[engineState.mode]?.descentStepY ?? this.gameConfig.endless.descentStepY;
    const ratio = Math.min(1, remaining / sagCfg.lowerFrames);
    return stepY * ratio ** SAG_DRAW.EASE_POWER;
  }

  /**
   * The top rail of a rail-step mode: a bar through the anchor row that darkens with every
   * drop and turns amber then red as the Sag meter fills. Pulses in warning (held still
   * under reduced motion).
   */
  drawAnchorRail(ctx, engineState, theme, now) {
    const sagCfg = this.gameConfig.sag;
    if (!sagCfg || typeof engineState.getSagState !== 'function') {
      return;
    }
    if (sagCfg.modes?.[engineState.mode]?.step !== SAG_STEPS.RAIL) {
      return;
    }
    const { top, minX, maxX } = measureAnchorRowBounds(engineState.physicsWorld.balls);
    if (!Number.isFinite(top)) {
      return;
    }
    const sag = engineState.getSagState();
    const color = sag.phase === SAG_DRAW.PHASE_FULL
      ? sagCfg.railCritColor
      : sag.phase === SAG_DRAW.PHASE_WARN ? sagCfg.railWarnColor : sagCfg.railColor;
    const half = sagCfg.render.railThickness * MATH_CONSTANTS.HALF;
    ctx.save();
    if (sag.phase === SAG_DRAW.PHASE_WARN && !this.isReducedMotion) {
      const wave = Math.sin((now / sagCfg.render.railPulsePeriodMs) * MATH_CONSTANTS.TWO_PI);
      ctx.globalAlpha = 1 - SAG_DRAW.RAIL_PULSE_DEPTH * (MATH_CONSTANTS.HALF + MATH_CONSTANTS.HALF * wave);
    }
    ctx.fillStyle = color;
    ctx.fillRect(minX, top - half, maxX - minX, sagCfg.render.railThickness);
    const shade = Math.min(SAG_DRAW.RAIL_SHADE_MAX, sag.railDrops * SAG_DRAW.RAIL_SHADE_PER_DROP);
    if (shade > 0) {
      ctx.globalAlpha = shade;
      ctx.fillStyle = sagCfg.render.railShadeColor;
      ctx.fillRect(minX, top - half, maxX - minX, sagCfg.render.railThickness);
      ctx.globalAlpha = 1;
    }
    drawAnchorRailHatching(this, ctx, sagCfg, sag.phase, minX, maxX, top, half);
    ctx.restore();
  }

  /**
   * Segmented Sag gauge beside the launcher: neutral when calm, amber with a dashed outline
   * in warning, red with a chevron when full. Hatching backs the color when color patterns
   * or high contrast are on, so the phase never rests on hue alone.
   */
  drawSagGauge(ctx, engineState, theme) {
    const sagCfg = this.gameConfig.sag;
    if (!sagCfg || typeof engineState.getSagState !== 'function') {
      return;
    }
    const sag = engineState.getSagState();
    if (!sag.active || sag.size <= 0) {
      return;
    }
    const gauge = sagCfg.gauge;
    const canvasCfg = this.gameConfig.canvas;
    const pitch = gauge.segmentHeight + gauge.segmentGap;
    const totalHeight = sag.size * pitch - gauge.segmentGap;
    const left = canvasCfg.launcherX + gauge.offsetX;
    const bottom = canvasCfg.launcherY + gauge.offsetY;
    const top = bottom - totalHeight;
    const isWarn = sag.phase === SAG_DRAW.PHASE_WARN;
    const isFull = sag.phase === SAG_DRAW.PHASE_FULL;
    const fill = isFull ? sagCfg.railCritColor : isWarn ? sagCfg.railWarnColor : sagCfg.railColor;
    const hatch = this.colorPatterns || this.highContrast;
    ctx.save();
    for (let i = 0; i < sag.size; i++) {
      const y = bottom - (i + 1) * pitch + gauge.segmentGap;
      drawSagGaugeSegment(ctx, left, y, gauge, fill, hatch, isWarn, isFull, i < sag.level, sagCfg, theme);
    }
    drawSagGaugeAlertChrome(ctx, left, top, totalHeight, gauge, fill, isWarn, isFull);
    ctx.restore();
  }

  /** The queued colors after the next ball, smaller and in loading order, away from the launcher. */
  drawUpcomingBalls(ctx, colorIds, nextX, nextY, radius, now) {
    if (!colorIds || colorIds.length === 0) {
      return;
    }
    const canvasCfg = this.gameConfig.canvas;
    const scale = canvasCfg.upcomingBallScale;
    colorIds.forEach((colorId, index) => {
      const x = nextX + canvasCfg.upcomingBallSpacingX * (index + 1);
      this.upcomingPreviewBall.colorId = colorId;
      this.upcomingPreviewBall.specialType = null;
      this.upcomingPreviewBall.radius = radius;
      ctx.save();
      ctx.translate(x, nextY);
      ctx.scale(scale, scale);
      this.drawBallAt(ctx, this.upcomingPreviewBall, 0, 0, now);
      ctx.restore();
    });
  }

  /** Draws a detached sphere (such as Orbital radial drift) using the regular cached ball renderer. */
  drawDetachedPreviewBall(ctx, x, y, radius, colorId, specialType = null) {
    const now = this.isReducedMotion ? REDUCED_MOTION_CLOCK_MS : performance.now();
    this.upcomingPreviewBall.colorId = specialType ? null : colorId;
    this.upcomingPreviewBall.specialType = specialType || null;
    this.upcomingPreviewBall.radius = radius;
    this.drawBallAt(ctx, this.upcomingPreviewBall, x, y, now);
    this.upcomingPreviewBall.specialType = null;
  }
}

installMethods(Renderer, rendererMagnetarChargesMethods);
installMethods(Renderer, rendererParticlesMethods);
