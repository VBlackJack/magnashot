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
  LAUNCHER_POSTURES,
  MATH_CONSTANTS,
  SEPARATION_FALLBACK_AXIS,
  SPECIAL_TYPES
} from '../../core/Constants.js';
import { t } from '../../core/I18n.js';
import { Ball } from '../../entities/Ball.js';
import { ModeBehavior, registerModeBehavior } from './ModeBehavior.js';
import {
  MERGE_EVENT_DIRECTIONS,
  MERGE_EVENT_IDS,
  getMergeEventTextKey
} from './MergeEvents.js';

const INITIAL_DROP_VY = 45;
const ENTRY_GRACE_SEC = 0.85;
const MERGE_POP_SCALE = 1.28;
const POP_DECAY_PER_SEC = 1.8;
const TOUCH_MERGE_TOLERANCE_PX = 1.5;
const WALL_LINE_WIDTH = 3;
const OVERFLOW_DASH = Object.freeze([8, 6]);
const DROP_GUIDE_DASH = Object.freeze([5, 6]);
const OVERFLOW_LINE_ALPHA = 0.72;
const DROP_GUIDE_ALPHA = 0.36;
const BASIN_GLOW_ALPHA = 0.14;
/** Danger line reaction of a sphere above the line while its grace pauses the overflow timer. */
const GRACED_OVERFLOW_RATIO = 0.2;
/** The step text sits this many text lines below the event text so they never overlap. */
const PRESSURE_TEXT_LINES_BELOW_EVENT = 1;
/** Danger band between the base overflow line and the lowered one. */
const PRESSURE_ZONE_ALPHA = 0.1;
/** Static telegraph of the next line position: dashed line plus tick marks on both walls. */
const TELEGRAPH_DASH = Object.freeze([3, 5]);
const TELEGRAPH_ALPHA = 0.85;
const TELEGRAPH_LINE_WIDTH = 2;
const TELEGRAPH_TICK_LENGTH = 14;
const TELEGRAPH_TICK_WIDTH = 3;
/** Static ring around a pulsing sphere: the polarity pulse cue that survives reduced motion. */
const PULSE_RING_GAP = 4;
const PULSE_RING_WIDTH = 2;
const PULSE_RING_ALPHA = 0.85;
/** Roll threshold under which a wind blows to the left. */
const WIND_LEFT_ROLL_BELOW = 0.5;
/** Launcher slots of an event recolor: the current ball, the next ball, then the queue. */
const RECOLOR_SLOT_CURRENT = 0;
const RECOLOR_SLOT_NEXT = 1;
const RECOLOR_SLOT_QUEUE_BASE = 2;
const RECOLOR_PHASE_START = 'start';
const RECOLOR_PHASE_END = 'end';
/** Fusions of one drop from which the floating text speaks of a chain. */
const CHAIN_TEXT_MIN_COMBO = 2;
/** The Shake reward text sits one text line above the fusion text so they do not overlap. */
const CHAIN_REWARD_TEXT_LINES = 2;

const MERGE_CHROME = Object.freeze({
  ambientLiquid: false,
  collectorBins: false,
  dangerZone: false,
  aimLine: false
});

/** Pause input hints that the basin words its own way. */
const MERGE_INPUT_HINT_KEYS = Object.freeze({
  'modals.pause.instructions.keyboard': 'modals.pause.instructions.mergeKeyboard'
});

export class MergeBehavior extends ModeBehavior {
  constructor() {
    super(GAME_MODES.MERGE);
  }

  getLauncherSpec(engine) {
    const cfg = engine.modesConfig.merge;
    return {
      x: engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      y: cfg.launcherY,
      posture: LAUNCHER_POSTURES.DROP_RAIL,
      minAngle: Math.PI * MATH_CONSTANTS.HALF,
      maxAngle: Math.PI * MATH_CONSTANTS.HALF,
      defaultAngle: Math.PI * MATH_CONSTANTS.HALF,
      nextOffsetX: cfg.nextOffsetX,
      nextOffsetY: cfg.nextOffsetY,
      compactQueue: true,
      cancelOffset: 0,
      cancelRadius: 0
    };
  }

  getRenderChrome() {
    return MERGE_CHROME;
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

  /** The basin has a drop rail and a Shake, and no special spheres to select. */
  getInputHintKey(key) {
    return MERGE_INPUT_HINT_KEYS[key] ?? key;
  }

  /** The generic tip speaks of anchors and rotors, which the basin does not have. */
  getPauseTipKey() {
    return 'modals.pause.instructions.mergeTip';
  }

  /** Spheres fuse by calibre and nothing hangs from anchors, so the basics hint does not apply. */
  teachesMatchBasics() {
    return false;
  }

  neutralizesWorkshopUpgrades() {
    return true;
  }

  isTiltLocked() {
    return false;
  }

  allowsEmptyBoardSnapshot() {
    return true;
  }

  getTierSpecById(engine, colorId) {
    const tiers = engine.modesConfig.merge.tiers;
    return tiers.find((item) => item.id === colorId) || tiers[0];
  }

  getTierSpecByIndex(engine, tierIndex) {
    const tiers = engine.modesConfig.merge.tiers;
    const clamped = Math.max(0, Math.min(tiers.length - 1, tierIndex));
    return tiers[clamped];
  }

  pickLauncherColor(engine, roll = engine.random()) {
    const cfg = engine.modesConfig.merge;
    const maxTierIndex = this.getActiveEventParams(engine, MERGE_EVENT_IDS.BIG_DROPS)?.spawnMaxTierIndex
      ?? cfg.spawnMaxTierIndex;
    const spawnCount = Math.min(cfg.tiers.length, maxTierIndex + 1);
    const idx = Math.min(spawnCount - 1, Math.floor(roll * spawnCount));
    return cfg.tiers[idx].id;
  }

  /** Parameters of the running event when it is `id`, else null. Never mutates the config. */
  getActiveEventParams(engine, id) {
    const event = engine.modeState?.event;
    return event?.id === id ? engine.modesConfig.merge.events?.pool?.[id] ?? null : null;
  }

  /** Read-only view of the event cycle for the HUD, or null when the config defines no events. */
  getEventView(engine) {
    const state = engine.modeState;
    if (!state || !engine.modesConfig.merge.events) {
      return null;
    }
    return {
      eventCount: state.eventCount,
      active: state.event ? { ...state.event } : null,
      upcoming: state.upcomingEvent ? { ...state.upcomingEvent } : null
    };
  }

  drawEventGap(engine, eventCount) {
    const { gapMinDrops, gapMaxDrops } = engine.modesConfig.merge.events;
    const span = gapMaxDrops - gapMinDrops + 1;
    return gapMinDrops + Math.floor(engine.drawSeededRoll('mergeEventGap', eventCount) * span);
  }

  /** Telegraphs the next event: any pool id but the previous one, one drop before it starts. */
  pickUpcomingEvent(engine) {
    const state = engine.modeState;
    const ids = Object.keys(engine.modesConfig.merge.events.pool);
    const candidates = ids.length > 1 ? ids.filter((id) => id !== state.lastEventId) : ids;
    const pick = Math.floor(engine.drawSeededRoll('mergeEvent', state.eventCount) * candidates.length);
    const id = candidates[Math.min(candidates.length - 1, pick)];
    const dirRoll = engine.drawSeededRoll('mergeEventDir', state.eventCount);
    const direction = id === MERGE_EVENT_IDS.WIND && dirRoll < WIND_LEFT_ROLL_BELOW
      ? MERGE_EVENT_DIRECTIONS.LEFT
      : MERGE_EVENT_DIRECTIONS.RIGHT;
    state.upcomingEvent = { id, direction };
  }

  startEvent(engine) {
    const cfg = engine.modesConfig.merge;
    const state = engine.modeState;
    if (!state.upcomingEvent) {
      this.pickUpcomingEvent(engine);
    }
    state.event = { ...state.upcomingEvent, dropsLeft: cfg.events.durationDrops };
    state.upcomingEvent = null;
    state.eventCount += 1;
    if (state.event.id === MERGE_EVENT_IDS.BIG_DROPS) {
      this.recolorLauncher(engine, RECOLOR_PHASE_START);
    }
    engine.particleSystem.spawnFloatingText(
      engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      cfg.overflowLineY + cfg.eventTextOffsetY,
      t('gameplay.feedback.merge.eventStart', { name: t(getMergeEventTextKey(state.event, 'name')) }),
      engine.gameConfig.theme.overchargePopupColor
    );
  }

  endEvent(engine) {
    const state = engine.modeState;
    const wasBigDrops = state.event.id === MERGE_EVENT_IDS.BIG_DROPS;
    state.lastEventId = state.event.id;
    state.event = null;
    state.dropsUntilEvent = this.drawEventGap(engine, state.eventCount);
    if (wasBigDrops) {
      this.recolorLauncher(engine, RECOLOR_PHASE_END);
    }
  }

  /**
   * Moves the event cycle on by one successful drop: counts down the running event, or the
   * gap to the next one (telegraphed one drop ahead).
   */
  advanceEventCycle(engine) {
    const state = engine.modeState;
    if (!engine.modesConfig.merge.events) {
      return;
    }
    if (state.event) {
      state.event.dropsLeft -= 1;
      if (state.event.dropsLeft <= 0) {
        this.endEvent(engine);
      }
      return;
    }
    state.dropsUntilEvent -= 1;
    if (state.dropsUntilEvent <= 0) {
      this.startEvent(engine);
    } else if (state.dropsUntilEvent === 1 && !state.upcomingEvent) {
      this.pickUpcomingEvent(engine);
    }
  }

  /**
   * Redraws the current ball, the next ball and the whole queue under the spawn pool now in
   * force, without touching launcherDrawIndex, so the preview never shows a stale calibre.
   */
  recolorLauncher(engine, phase) {
    const stream = `mergeEventRecolor:${engine.modeState.eventCount}:${phase}`;
    const draw = (slot) => this.pickLauncherColor(engine, engine.drawSeededRoll(stream, slot));
    if (engine.currentBall && !engine.currentBall.specialType) {
      engine.currentBall.colorId = draw(RECOLOR_SLOT_CURRENT);
    }
    if (engine.nextBall && !engine.nextBall.specialType) {
      engine.nextBall.colorId = draw(RECOLOR_SLOT_NEXT);
    }
    engine.upcomingColorIds = engine.upcomingColorIds.map((_, idx) => draw(RECOLOR_SLOT_QUEUE_BASE + idx));
    this.syncLauncherBallTier(engine, engine.currentBall);
    this.syncLauncherBallTier(engine, engine.nextBall);
    if (engine.currentBall) {
      engine.mergeDropX = this.clampDropX(engine, engine.mergeDropX, engine.currentBall.radius);
    }
  }

  /** Advances a charging Shake by one the first time a drop's chain reaches the configured length. */
  grantChainReward(engine, x, y) {
    const cfg = engine.modesConfig.merge;
    const state = engine.modeState;
    if (
      !cfg.chain
      || state.chainRewardGranted
      || engine.combo < cfg.chain.shakeAdvanceAt
      || !(state.shakeRemaining > 0)
    ) {
      return;
    }
    state.shakeRemaining -= 1;
    state.chainRewardGranted = true;
    engine.particleSystem.spawnFloatingText(
      x,
      y + engine.gameConfig.canvas.floatingTextOffsetY * CHAIN_REWARD_TEXT_LINES,
      t('gameplay.feedback.merge.chainShake'),
      engine.gameConfig.theme.overchargePopupColor
    );
  }

  /** Keeps a saved event only when its id is still in the pool and its numbers fit the config. */
  sanitizeSavedEvent(engine, raw, withDrops) {
    const { events } = engine.modesConfig.merge;
    if (!raw || typeof raw !== 'object' || !Object.hasOwn(events.pool, raw.id)) {
      return null;
    }
    const direction = raw.direction === MERGE_EVENT_DIRECTIONS.LEFT
      ? MERGE_EVENT_DIRECTIONS.LEFT
      : MERGE_EVENT_DIRECTIONS.RIGHT;
    if (!withDrops) {
      return { id: raw.id, direction };
    }
    if (!Number.isInteger(raw.dropsLeft)) {
      return null;
    }
    return { id: raw.id, direction, dropsLeft: Math.min(events.durationDrops, Math.max(1, raw.dropsLeft)) };
  }

  /** Fresh pressure fields of a mode state: the line at its base position, nothing pending. */
  createPressureState() {
    return {
      lineOffsetPx: 0,
      pendingOffsetPx: null,
      pendingDropsLeft: 0,
      holdDrops: 0,
      topTierDrops: null
    };
  }

  /** Current overflow line: the base line lowered by the applied pressure offset. Never mutates the config. */
  getOverflowLineY(engine) {
    return engine.modesConfig.merge.overflowLineY + (engine.modeState?.lineOffsetPx ?? 0);
  }

  /** Read-only view of the pressure for the HUD, or null when the config defines none. */
  getPressureView(engine) {
    const state = engine.modeState;
    if (!state || !engine.modesConfig.merge.pressure) {
      return null;
    }
    return {
      lineOffsetPx: state.lineOffsetPx,
      pendingOffsetPx: state.pendingOffsetPx,
      pendingDropsLeft: state.pendingDropsLeft
    };
  }

  /** Offset the line should have for a best fused calibre and a count of drops since the top calibre. */
  computeTargetOffset(pressure, bestCalibre, topTierDrops) {
    const calibrePart = Math.max(0, bestCalibre - pressure.fromFusedTier) * pressure.pxPerTier;
    const stepPart = topTierDrops === null
      ? 0
      : Math.floor(topTierDrops / pressure.topTierStepDrops) * pressure.pxPerStep;
    return Math.min(pressure.maxOffsetPx, calibrePart + stepPart);
  }

  /**
   * Raises the best calibre from a fusion. Drops never raise it. The first time the top
   * pressure calibre is fused starts the count of drops that adds steps.
   */
  recordFusedCalibre(engine, calibre) {
    engine.mergeBestTier = Math.max(engine.mergeBestTier || 1, calibre);
    const pressure = engine.modesConfig.merge.pressure;
    const state = engine.modeState;
    if (pressure && state && state.topTierDrops === null && engine.mergeBestTier >= pressure.topTier) {
      state.topTierDrops = 0;
    }
  }

  /**
   * Moves the pressure on by one successful drop: counts drops since the top calibre, starts
   * a telegraphed step when the target rose, and applies it once the telegraph has run out.
   */
  advancePressure(engine) {
    const pressure = engine.modesConfig.merge.pressure;
    const state = engine.modeState;
    if (!pressure) {
      return;
    }
    if (state.topTierDrops !== null) {
      state.topTierDrops += 1;
    }
    const target = this.computeTargetOffset(pressure, engine.mergeBestTier || 1, state.topTierDrops);
    if (state.pendingOffsetPx !== null) {
      // A higher target moves the preview but never restarts the countdown.
      state.pendingOffsetPx = Math.max(state.pendingOffsetPx, target);
      state.pendingDropsLeft = Math.max(0, state.pendingDropsLeft - 1);
      if (state.pendingDropsLeft === 0) {
        this.tryApplyPendingStep(engine);
      }
      return;
    }
    if (target > state.lineOffsetPx) {
      state.pendingOffsetPx = target;
      state.pendingDropsLeft = pressure.warnDrops;
      state.holdDrops = 0;
    }
  }

  /** True when a settled sphere has its top between the current line and the pending one. */
  isStepBlocked(engine) {
    const state = engine.modeState;
    const currentLine = this.getOverflowLineY(engine);
    const newLine = engine.modesConfig.merge.overflowLineY + state.pendingOffsetPx;
    return engine.physicsWorld.balls.some((ball) => {
      const top = ball.y - ball.radius;
      return Math.abs(ball.vy) < engine.modesConfig.merge.pressure.settledSpeedPxPerSec && top > currentLine && top < newLine;
    });
  }

  /** Applies the pending step unless a settled sphere is in its way, for at most `holdMaxDrops` drops. */
  tryApplyPendingStep(engine) {
    const pressure = engine.modesConfig.merge.pressure;
    const state = engine.modeState;
    if (this.isStepBlocked(engine)) {
      if (state.holdDrops < pressure.holdMaxDrops) {
        state.holdDrops += 1;
        return;
      }
    }
    this.applyPendingStep(engine);
  }

  /** The instant jump: lowers the line, resets every overflow timer, and gives spheres above the new line extra grace. */
  applyPendingStep(engine) {
    const cfg = engine.modesConfig.merge;
    const state = engine.modeState;
    if (state.pendingOffsetPx <= state.lineOffsetPx) {
      // A step that would not lower the line is dropped, never applied.
      state.pendingOffsetPx = null;
      state.pendingDropsLeft = 0;
      state.holdDrops = 0;
      return;
    }
    state.lineOffsetPx = state.pendingOffsetPx;
    state.pendingOffsetPx = null;
    state.pendingDropsLeft = 0;
    state.holdDrops = 0;
    const lineY = this.getOverflowLineY(engine);
    for (const ball of engine.physicsWorld.balls) {
      ball.mergeOverflowSec = 0;
      ball.mergeGraceSec = this.getStepGraceSec(engine, ball, lineY, ball.mergeGraceSec);
    }
    engine.particleSystem.spawnFloatingText(
      engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      cfg.overflowLineY + cfg.eventTextOffsetY
        - engine.gameConfig.canvas.floatingTextOffsetY * PRESSURE_TEXT_LINES_BELOW_EVENT,
      t('gameplay.feedback.merge.pressureStep'),
      engine.gameConfig.theme.dangerLineColor
    );
  }

  /** Grace of a sphere after a step or a restore: extended when its top is above the line, else unchanged. */
  getStepGraceSec(engine, ball, lineY, currentGraceSec) {
    const cfg = engine.modesConfig.merge;
    const current = currentGraceSec || 0;
    if (!cfg.pressure || ball.y - ball.radius >= lineY) {
      return current;
    }
    return Math.max(current, cfg.overflowGraceSec * cfg.pressure.stepGraceFactor);
  }

  /** Restores the pressure from a snapshot; a legacy snapshot derives the line from its best calibre. */
  restorePressure(engine, rawState) {
    const pressure = engine.modesConfig.merge.pressure;
    const state = engine.modeState;
    if (!pressure) {
      return;
    }
    const clampCount = (value, max) => Math.min(max, Math.max(0, value));
    if (Number.isFinite(rawState.lineOffsetPx)) {
      state.lineOffsetPx = clampCount(rawState.lineOffsetPx, pressure.maxOffsetPx);
      state.topTierDrops = Number.isInteger(rawState.topTierDrops) ? Math.max(0, rawState.topTierDrops) : null;
      const pending = Number.isFinite(rawState.pendingOffsetPx)
        ? clampCount(rawState.pendingOffsetPx, pressure.maxOffsetPx)
        : null;
      if (pending !== null && pending > state.lineOffsetPx) {
        state.pendingOffsetPx = pending;
        state.pendingDropsLeft = Number.isInteger(rawState.pendingDropsLeft)
          ? clampCount(rawState.pendingDropsLeft, pressure.warnDrops)
          : pressure.warnDrops;
        state.holdDrops = Number.isInteger(rawState.holdDrops)
          ? clampCount(rawState.holdDrops, pressure.holdMaxDrops)
          : 0;
      }
      return;
    }
    state.lineOffsetPx = this.computeTargetOffset(pressure, rawState.bestTier, null);
    state.topTierDrops = rawState.bestTier >= pressure.topTier ? 0 : null;
  }

  syncLauncherBallTier(engine, ball) {
    if (!ball || ball.specialType) {
      return;
    }
    const spec = this.getTierSpecById(engine, ball.colorId);
    ball.colorId = spec.id;
    ball.radius = spec.radius;
    ball.mergeTier = spec.tier;
  }

  clampDropX(engine, rawX, radius) {
    const cfg = engine.modesConfig.merge;
    return Math.max(cfg.basinLeftX + radius, Math.min(cfg.basinRightX - radius, rawX));
  }

  setupMode(engine) {
    const cfg = engine.modesConfig.merge;
    const world = engine.physicsWorld;
    world.clear();
    world.skipClusterStep = true;

    const spawnPool = cfg.tiers.slice(0, cfg.spawnMaxTierIndex + 1).map((item) => item.id);
    engine.activePalette = spawnPool;
    engine.specialInventory = Object.fromEntries(Object.values(SPECIAL_TYPES).map((type) => [type, 0]));
    engine.mergeDropX = engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF;
    engine.mergeBestTier = 1;
    engine.waveCount = 1;

    engine.modeState = {
      dropCooldownSec: 0,
      shakeRemaining: cfg.shake.rechargeDrops,
      mergesCount: 0,
      supernovas: 0,
      maxOverflowRatio: 0,
      chainRewardGranted: false,
      event: null,
      upcomingEvent: null,
      lastEventId: null,
      eventCount: 0,
      dropsUntilEvent: 0,
      ...this.createPressureState()
    };
    if (cfg.events) {
      engine.modeState.dropsUntilEvent = this.drawEventGap(engine, 0);
    }
  }

  canFire(engine) {
    return (engine.modeState?.dropCooldownSec ?? 0) <= 0;
  }

  fire(engine) {
    if (!this.canFire(engine) || !engine.currentBall) {
      return true;
    }
    const cfg = engine.modesConfig.merge;
    this.syncLauncherBallTier(engine, engine.currentBall);
    const tierSpec = this.getTierSpecById(engine, engine.currentBall.colorId);
    const dropX = this.clampDropX(engine, engine.mergeDropX, tierSpec.radius);

    engine.sampleShotTimeline();
    engine.evaluateGhostShot();
    engine.countShotForStats();

    const dropped = new Ball({
      x: dropX,
      y: cfg.launcherY,
      vx: 0,
      vy: INITIAL_DROP_VY,
      radius: tierSpec.radius,
      colorId: tierSpec.id,
      isAnchor: false
    });
    dropped.mergeTier = tierSpec.tier;
    dropped.mergeGraceSec = ENTRY_GRACE_SEC;
    dropped.mergeEntering = true;
    dropped.mergeEntrySec = 0;
    dropped.mergeOverflowSec = 0;
    dropped.mergePolaritySec = engine.isPolarityFlipped ? cfg.polarityWindowSec : 0;
    engine.physicsWorld.addBall(dropped);
    if (engine.modeState.shakeRemaining > 0) {
      engine.modeState.shakeRemaining -= 1;
    }

    engine.modeState.dropCooldownSec = cfg.dropCooldownSec;
    engine.combo = 0;
    engine.modeState.chainRewardGranted = false;

    engine.currentBall = engine.nextBall;
    const upcoming = engine.takeUpcomingBall();
    engine.nextBall = engine.createRandomLauncherBall(null, upcoming.colorId);
    this.syncLauncherBallTier(engine, engine.currentBall);
    this.syncLauncherBallTier(engine, engine.nextBall);
    engine.mergeDropX = this.clampDropX(engine, engine.mergeDropX, engine.currentBall.radius);

    this.advanceEventCycle(engine);
    this.advancePressure(engine);

    engine.hasFiredInRound = true;
    engine.audioManager.playEffect('shoot');
    engine.saveRunSnapshot();
    engine.notifyUI();
    return true;
  }

  /**
   * Throws the pile towards the emptier side with a small hop that frees it from floor
   * friction, smaller spheres moving more.
   */
  shake(engine) {
    const { balls } = engine.physicsWorld;
    if (balls.length === 0) {
      return false;
    }
    const cfg = engine.modesConfig.merge;
    const midpoint = (cfg.basinLeftX + cfg.basinRightX) * MATH_CONSTANTS.HALF;
    const averageX = balls.reduce((sum, ball) => sum + ball.x, 0) / balls.length;
    const direction = averageX > midpoint ? -1 : 1;
    const shakeGraceSec = cfg.pressure?.shakeGraceSec ?? 0;
    for (const ball of balls) {
      // A hop can lift a settled sphere over the line for a moment: it must not lose the run.
      ball.mergeGraceSec = Math.max(ball.mergeGraceSec || 0, shakeGraceSec);
      const sizeFactor = cfg.tiers[0].radius / ball.radius;
      ball.vx += direction * cfg.shake.maxImpulsePxPerSec * sizeFactor;
      ball.vy -= cfg.shake.liftImpulsePxPerSec * sizeFactor;
    }
    engine.modeState.shakeRemaining = cfg.shake.rechargeDrops;
    engine.saveRunSnapshot();
    engine.notifyUI();
    return true;
  }

  onPolarityFlipped(engine) {
    if (!engine.isRunPlaying()) {
      return;
    }
    const balls = engine.physicsWorld.balls;
    if (balls.length > 0) {
      // Every press pulses, in both directions: the pulse is the action the player sees.
      const pulseSec = engine.modesConfig.merge.polarityPulseSec;
      for (const b of balls) {
        b.mergePulseSec = pulseSec;
      }
      const latest = balls[balls.length - 1];
      engine.particleSystem.spawnShockwave(
        latest.x,
        latest.y,
        engine.gameConfig.theme.overchargePopupColor,
        latest.radius * 2.4
      );
    }
  }

  applyPolarityBiasForces(engine, balls, dtSec) {
    const cfg = engine.modesConfig.merge;
    const rangeSq = cfg.polarityBiasRange * cfg.polarityBiasRange;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        const pulsing = (a.mergePulseSec || 0) > 0 || (b.mergePulseSec || 0) > 0;
        if (!pulsing && (a.mergePolaritySec || 0) <= 0 && (b.mergePolaritySec || 0) <= 0) {
          continue;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= MATH_CONSTANTS.EPSILON || distSq >= rangeSq) {
          continue;
        }
        const dist = Math.sqrt(distSq);
        const falloff = 1 - dist / cfg.polarityBiasRange;
        // Same tier pulls together to complete merges; mismatched tiers nudge apart to clear blockers.
        const sign = a.mergeTier === b.mergeTier ? 1 : -0.55;
        const strength = pulsing ? cfg.polarityPulseAcceleration : cfg.polarityBiasAcceleration;
        const accel = strength * falloff * sign * dtSec;
        const nx = dx / dist;
        const ny = dy / dist;
        a.vx += nx * accel;
        a.vy += ny * accel;
        b.vx -= nx * accel;
        b.vy -= ny * accel;
      }
    }
  }

  emitMergeShockwave(engine, cx, cy, sourceRadius, impulse, targetTier) {
    const cfg = engine.modesConfig.merge;
    const maxDist = sourceRadius * cfg.shockwaveRadiusFactor;
    for (const other of engine.physicsWorld.balls) {
      const dx = other.x - cx;
      const dy = other.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist <= MATH_CONSTANTS.EPSILON || dist > maxDist) {
        continue;
      }
      const falloff = 1 - dist / maxDist;
      const massScale = (sourceRadius * sourceRadius) / Math.max(196, other.radius * other.radius);
      const dirSign = other.mergeTier === targetTier ? -0.45 : 1;
      const push = impulse * falloff * Math.min(1.4, massScale) * dirSign;
      other.vx += (dx / dist) * push;
      other.vy += (dy / dist) * push;
    }
  }

  onBeforePhysicsStep(engine, dtSec) {
    if (!engine.isRunPlaying() || !engine.modeState) {
      return;
    }
    this.syncLauncherBallTier(engine, engine.currentBall);
    this.syncLauncherBallTier(engine, engine.nextBall);

    const cfg = engine.modesConfig.merge;
    const state = engine.modeState;
    const world = engine.physicsWorld;
    const balls = world.balls;

    if (state.dropCooldownSec > 0) {
      state.dropCooldownSec = Math.max(0, state.dropCooldownSec - dtSec);
    }
    if (balls.length === 0) {
      state.maxOverflowRatio = 0;
      return;
    }

    const lowGravity = this.getActiveEventParams(engine, MERGE_EVENT_IDS.LOW_GRAVITY);
    const gravity = cfg.gravity * (lowGravity?.gravityFactor ?? 1);
    const wind = this.getActiveEventParams(engine, MERGE_EVENT_IDS.WIND);
    const windAcceleration = wind ? state.event.direction * wind.acceleration : 0;
    const bouncy = this.getActiveEventParams(engine, MERGE_EVENT_IDS.BOUNCY);
    const wallRestitution = bouncy?.restitution ?? cfg.wallRestitution;
    const floorRestitution = bouncy?.restitution ?? cfg.floorRestitution;
    const ballRestitution = bouncy?.restitution ?? cfg.ballRestitution;

    const lineY = this.getOverflowLineY(engine);
    for (const b of balls) {
      if (b.mergeEntering) {
        // A fresh sphere keeps its grace until it first passes below the current line, capped.
        b.mergeEntrySec = (b.mergeEntrySec || 0) + dtSec;
        if (b.y - b.radius >= lineY || b.mergeEntrySec >= (cfg.pressure?.entryGraceMaxSec ?? 0)) {
          b.mergeEntering = false;
        }
      }
      if (b.mergeGraceSec > 0) {
        b.mergeGraceSec = Math.max(b.mergeEntering ? dtSec : 0, b.mergeGraceSec - dtSec);
      }
      if (b.mergePolaritySec > 0) {
        b.mergePolaritySec = Math.max(0, b.mergePolaritySec - dtSec);
      }
      if (b.mergePulseSec > 0) {
        b.mergePulseSec = Math.max(0, b.mergePulseSec - dtSec);
      }
      if (b.impactScale > 1) {
        b.impactScale = Math.max(1, b.impactScale - POP_DECAY_PER_SEC * dtSec);
      }
      b.vy += gravity * dtSec;
      b.vx += (cfg.tiltAcceleration * world.tiltFactor + windAcceleration) * dtSec;
    }

    this.applyPolarityBiasForces(engine, balls, dtSec);

    for (const b of balls) {
      b.vx *= cfg.linearDamping;
      b.vy *= cfg.linearDamping;
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
    }

    const mergePairs = [];
    const mergedIds = new Set();

    for (let iter = 0; iter < cfg.solverIterations; iter++) {
      for (const b of balls) {
        const minX = cfg.basinLeftX + b.radius;
        const maxX = cfg.basinRightX - b.radius;
        const maxY = cfg.basinFloorY - b.radius;
        if (b.x < minX) {
          b.x = minX;
          if (b.vx < 0) {
            b.vx = -b.vx * wallRestitution;
          }
        } else if (b.x > maxX) {
          b.x = maxX;
          if (b.vx > 0) {
            b.vx = -b.vx * wallRestitution;
          }
        }
        if (b.y > maxY) {
          b.y = maxY;
          if (b.vy > 0) {
            b.vy = -b.vy * floorRestitution;
          }
          b.vx *= cfg.floorFriction;
        }
      }

      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (mergedIds.has(a.id)) {
          continue;
        }
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (mergedIds.has(b.id)) {
            continue;
          }
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minDist = a.radius + b.radius;
          const distSq = dx * dx + dy * dy;

          if (
            iter === 0
            && a.mergeTier === b.mergeTier
            && distSq <= (minDist + TOUCH_MERGE_TOLERANCE_PX) * (minDist + TOUCH_MERGE_TOLERANCE_PX)
          ) {
            mergedIds.add(a.id);
            mergedIds.add(b.id);
            mergePairs.push([a, b]);
            break;
          }

          if (distSq >= minDist * minDist) {
            continue;
          }
          let nx = SEPARATION_FALLBACK_AXIS.X;
          let ny = SEPARATION_FALLBACK_AXIS.Y;
          let dist = 0;
          if (distSq > MATH_CONSTANTS.EPSILON) {
            dist = Math.sqrt(distSq);
            nx = dx / dist;
            ny = dy / dist;
          }
          const overlap = minDist - dist;
          const massA = a.radius * a.radius;
          const massB = b.radius * b.radius;
          const invMassSum = 1 / massA + 1 / massB;
          const shareA = (1 / massA) / invMassSum;
          const shareB = (1 / massB) / invMassSum;

          a.x -= nx * overlap * shareA;
          a.y -= ny * overlap * shareA;
          b.x += nx * overlap * shareB;
          b.y += ny * overlap * shareB;

          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const relNormal = rvx * nx + rvy * ny;
          if (relNormal < 0) {
            const jImpulse = -(1 + ballRestitution) * relNormal / invMassSum;
            a.vx -= (jImpulse / massA) * nx;
            a.vy -= (jImpulse / massA) * ny;
            b.vx += (jImpulse / massB) * nx;
            b.vy += (jImpulse / massB) * ny;
          }
        }
      }
    }

    if (mergePairs.length > 0) {
      this.resolveMergePairs(engine, mergePairs);
    }

    // Check top overflow danger line with grace timer
    const overflowLineY = this.getOverflowLineY(engine);
    let worstRatio = 0;
    for (const b of world.balls) {
      if ((b.mergeGraceSec || 0) > 0) {
        // Grace only pauses the timer: the danger line still reacts to a settled sphere above it.
        if (!b.mergeEntering && b.y - b.radius < overflowLineY) {
          worstRatio = Math.max(worstRatio, GRACED_OVERFLOW_RATIO);
        }
        continue;
      }
      if (b.y - b.radius < overflowLineY) {
        b.mergeOverflowSec = (b.mergeOverflowSec || 0) + dtSec;
        worstRatio = Math.max(worstRatio, b.mergeOverflowSec / cfg.overflowGraceSec);
        if (b.mergeOverflowSec >= cfg.overflowGraceSec) {
          engine.triggerGameOver(GAME_OVER_REASONS.BASIN_OVERFLOW);
          return;
        }
      } else if (b.mergeOverflowSec > 0) {
        b.mergeOverflowSec = Math.max(0, b.mergeOverflowSec - dtSec * 2);
        worstRatio = Math.max(worstRatio, b.mergeOverflowSec / cfg.overflowGraceSec);
      }
    }
    state.maxOverflowRatio = Math.min(1, worstRatio);
  }

  resolveMergePairs(engine, mergePairs) {
    const cfg = engine.modesConfig.merge;
    const scoring = engine.gameConfig.scoring;
    const world = engine.physicsWorld;

    for (const [a, b] of mergePairs) {
      if (!world.ballMap.has(a.id) || !world.ballMap.has(b.id)) {
        continue;
      }
      const mx = (a.x + b.x) * MATH_CONSTANTS.HALF;
      const my = (a.y + b.y) * MATH_CONSTANTS.HALF;
      const avgVx = (a.vx + b.vx) * MATH_CONSTANTS.HALF * 0.5;
      const avgVy = (a.vy + b.vy) * MATH_CONSTANTS.HALF * 0.5;
      const tierIndex = a.mergeTier ?? 0;

      world.removeBall(a);
      world.removeBall(b);

      engine.combo = Math.min(engine.combo + scoring.comboIncrement, scoring.maxComboMultiplier);
      engine.maxComboInRound = Math.max(engine.maxComboInRound, engine.combo);
      engine.modeState.mergesCount = (engine.modeState.mergesCount || 0) + 1;
      this.grantChainReward(engine, mx, my);

      if (tierIndex >= cfg.tiers.length - 1) {
        // Two max-calibre spheres trigger a Supernova!
        const pts = cfg.supernovaBonus * Math.max(1, engine.combo);
        engine.addScore(pts);
        engine.modeState.supernovas = (engine.modeState.supernovas || 0) + 1;
        this.recordFusedCalibre(engine, cfg.tiers.length);
        engine.audioManager.playEffect('victory');
        engine.particleSystem.spawnShockwave(
          mx,
          my,
          engine.gameConfig.theme.victoryPopupColor,
          a.radius * cfg.shockwaveRadiusFactor
        );
        engine.particleSystem.spawnBurst(
          mx,
          my,
          engine.gameConfig.theme.victoryPopupColor,
          engine.gameConfig.juice.matchBurstCount * 2,
          engine.gameConfig.juice.matchBurstSpeed
        );
        engine.particleSystem.spawnFloatingText(
          mx,
          my + engine.gameConfig.canvas.floatingTextOffsetY,
          t('gameplay.feedback.merge.supernova', { points: pts }),
          engine.gameConfig.theme.victoryPopupColor
        );
        this.emitMergeShockwave(engine, mx, my, a.radius, cfg.supernovaShockwaveImpulse, -1);
        engine.unlockAchievementTiers('mergeTiers', cfg.tiers.length);
        continue;
      }

      const nextSpec = this.getTierSpecByIndex(engine, tierIndex + 1);
      const clampedX = Math.max(
        cfg.basinLeftX + nextSpec.radius,
        Math.min(cfg.basinRightX - nextSpec.radius, mx)
      );
      const clampedY = Math.min(cfg.basinFloorY - nextSpec.radius, my);

      const merged = new Ball({
        x: clampedX,
        y: clampedY,
        vx: avgVx,
        vy: avgVy,
        radius: nextSpec.radius,
        colorId: nextSpec.id,
        isAnchor: false
      });
      merged.mergeTier = nextSpec.tier;
      merged.mergeGraceSec = 0.25;
      merged.mergeOverflowSec = 0;
      merged.mergePolaritySec = 0.35;
      merged.impactScale = MERGE_POP_SCALE;
      world.addBall(merged);

      const golden = this.getActiveEventParams(engine, MERGE_EVENT_IDS.GOLDEN);
      const pts = Math.round(nextSpec.points * Math.max(1, engine.combo) * (golden?.pointsFactor ?? 1));
      engine.addScore(pts);
      this.recordFusedCalibre(engine, nextSpec.tier + 1);
      engine.waveCount = engine.mergeBestTier;

      engine.audioManager.playEffect('match', engine.combo);
      engine.particleSystem.spawnShockwave(
        clampedX,
        clampedY,
        nextSpec.highlight,
        nextSpec.radius * cfg.shockwaveRadiusFactor * 0.75
      );
      engine.particleSystem.spawnBurst(
        clampedX,
        clampedY,
        nextSpec.highlight,
        engine.gameConfig.juice.matchBurstCount,
        engine.gameConfig.juice.matchBurstSpeed
      );
      engine.particleSystem.spawnFloatingText(
        clampedX,
        clampedY + engine.gameConfig.canvas.floatingTextOffsetY,
        engine.combo >= CHAIN_TEXT_MIN_COMBO
          ? t('gameplay.feedback.merge.chain', { chain: engine.combo, points: pts })
          : t('gameplay.feedback.merge.fused', { tier: nextSpec.tier + 1, points: pts }),
        nextSpec.highlight
      );

      this.emitMergeShockwave(engine, clampedX, clampedY, nextSpec.radius, cfg.shockwaveImpulse, nextSpec.tier);
      engine.unlockAchievementTiers('mergeTiers', engine.mergeBestTier);
      engine.storageManager?.recordAchievementProgress?.({ maxCombo: engine.combo });
      engine.unlockAchievementTiers('comboMaster', engine.combo);
    }

    engine.persistRunHighScore();
    engine.saveRunSnapshot();
    engine.notifyUI();
  }

  evaluateBoardState() {
    return true;
  }

  serializeModeState(engine) {
    const state = engine.modeState || {};
    return {
      dropX: engine.mergeDropX ?? engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      bestTier: engine.mergeBestTier ?? 1,
      mergesCount: state.mergesCount ?? 0,
      supernovas: state.supernovas ?? 0,
      ...(Number.isInteger(state.shakeRemaining) ? { shakeRemaining: state.shakeRemaining } : {}),
      event: state.event ?? null,
      upcomingEvent: state.upcomingEvent ?? null,
      lastEventId: state.lastEventId ?? null,
      dropsUntilEvent: state.dropsUntilEvent ?? 0,
      eventCount: state.eventCount ?? 0,
      lineOffsetPx: state.lineOffsetPx ?? 0,
      pendingOffsetPx: state.pendingOffsetPx ?? null,
      pendingDropsLeft: state.pendingDropsLeft ?? 0,
      holdDrops: state.holdDrops ?? 0,
      topTierDrops: state.topTierDrops ?? null,
      ballTiers: engine.physicsWorld.balls.map((b) => (Number.isInteger(b.mergeTier) ? b.mergeTier : 0))
    };
  }

  validateModeState(rawState) {
    return Boolean(
      rawState
      && typeof rawState === 'object'
      && Number.isFinite(rawState.dropX)
      && Number.isInteger(rawState.bestTier)
      && rawState.bestTier >= 1
      && Array.isArray(rawState.ballTiers)
    );
  }

  restoreModeState(engine, rawState) {
    const cfg = engine.modesConfig.merge;
    engine.physicsWorld.skipClusterStep = true;
    engine.activePalette = cfg.tiers.slice(0, cfg.spawnMaxTierIndex + 1).map((item) => item.id);
    engine.mergeDropX = rawState.dropX;
    engine.mergeBestTier = rawState.bestTier;
    engine.waveCount = rawState.bestTier;

    engine.modeState = {
      dropCooldownSec: 0,
      shakeRemaining: Number.isInteger(rawState.shakeRemaining)
        ? Math.min(cfg.shake.rechargeDrops, Math.max(0, rawState.shakeRemaining))
        : cfg.shake.rechargeDrops,
      mergesCount: Math.max(0, rawState.mergesCount || 0),
      supernovas: Math.max(0, rawState.supernovas || 0),
      maxOverflowRatio: 0,
      chainRewardGranted: false,
      event: null,
      upcomingEvent: null,
      lastEventId: null,
      eventCount: 0,
      dropsUntilEvent: 0,
      ...this.createPressureState()
    };
    if (cfg.events) {
      this.restoreEventCycle(engine, rawState);
    }
    this.restorePressure(engine, rawState);

    const balls = engine.physicsWorld.balls;
    const restoredLineY = this.getOverflowLineY(engine);
    for (let i = 0; i < balls.length; i++) {
      const savedTier = Number.isInteger(rawState.ballTiers[i]) ? rawState.ballTiers[i] : 0;
      const spec = this.getTierSpecByIndex(engine, savedTier);
      balls[i].mergeTier = spec.tier;
      balls[i].colorId = spec.id;
      balls[i].radius = spec.radius;
      balls[i].mergeGraceSec = this.getStepGraceSec(engine, balls[i], restoredLineY, 0);
      balls[i].mergeEntering = false;
      balls[i].mergeOverflowSec = 0;
      balls[i].mergePolaritySec = 0;
      balls[i].mergePulseSec = 0;
    }
    this.syncLauncherBallTier(engine, engine.currentBall);
    this.syncLauncherBallTier(engine, engine.nextBall);
  }

  /** Restores the event cycle from a snapshot; a legacy snapshot without it gets a fresh gap. */
  restoreEventCycle(engine, rawState) {
    const { events } = engine.modesConfig.merge;
    const state = engine.modeState;
    state.eventCount = Number.isInteger(rawState.eventCount) ? Math.max(0, rawState.eventCount) : 0;
    state.lastEventId = Object.hasOwn(events.pool, rawState.lastEventId) ? rawState.lastEventId : null;
    state.event = this.sanitizeSavedEvent(engine, rawState.event, true);
    const upcoming = state.event ? null : this.sanitizeSavedEvent(engine, rawState.upcomingEvent, false);
    // A telegraphed event equal to the last one would break the no-repeat rule: drop it, the next draw redoes it.
    state.upcomingEvent = upcoming?.id === state.lastEventId ? null : upcoming;
    state.dropsUntilEvent = Number.isInteger(rawState.dropsUntilEvent)
      ? Math.min(events.gapMaxDrops, Math.max(1, rawState.dropsUntilEvent))
      : this.drawEventGap(engine, state.eventCount);
  }

  drawUnderlay(ctx, engine, renderer, theme) {
    const cfg = engine.modesConfig.merge;
    const basinW = cfg.basinRightX - cfg.basinLeftX;
    const lineY = this.getOverflowLineY(engine);
    const basinH = cfg.basinFloorY - lineY;

    ctx.save();
    // Subtle magnetic containment chamber fill
    ctx.fillStyle = theme.aimLineColor;
    ctx.globalAlpha = BASIN_GLOW_ALPHA * 0.35;
    ctx.fillRect(cfg.basinLeftX, lineY, basinW, basinH);

    // Danger band that pressure took from the basin
    if (lineY > cfg.overflowLineY) {
      ctx.fillStyle = theme.dangerLineColor;
      ctx.globalAlpha = PRESSURE_ZONE_ALPHA;
      ctx.fillRect(cfg.basinLeftX, cfg.overflowLineY, basinW, lineY - cfg.overflowLineY);
    }

    // Basin walls & floor
    ctx.strokeStyle = theme.aimLineColor;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = WALL_LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cfg.basinLeftX, cfg.overflowLineY - 24);
    ctx.lineTo(cfg.basinLeftX, cfg.basinFloorY);
    ctx.lineTo(cfg.basinRightX, cfg.basinFloorY);
    ctx.lineTo(cfg.basinRightX, cfg.overflowLineY - 24);
    ctx.stroke();

    // Top overflow danger line
    const overflowRatio = engine.modeState?.maxOverflowRatio ?? 0;
    ctx.strokeStyle = theme.dangerLineColor;
    ctx.globalAlpha = OVERFLOW_LINE_ALPHA + overflowRatio * 0.25;
    ctx.lineWidth = overflowRatio > 0 ? 2.5 : 1.5;
    ctx.setLineDash(OVERFLOW_DASH);
    ctx.beginPath();
    ctx.moveTo(cfg.basinLeftX + 4, lineY);
    ctx.lineTo(cfg.basinRightX - 4, lineY);
    ctx.stroke();
    ctx.setLineDash([]);

    this.drawPressureTelegraph(ctx, engine, theme);

    // Vertical drop guide from top rail cursor
    if (engine.isRunPlaying() && engine.currentBall && !engine.isAimCancelled) {
      const dropX = this.clampDropX(engine, engine.mergeDropX, engine.currentBall.radius);
      ctx.strokeStyle = engine.isPolarityFlipped ? theme.overchargePopupColor : theme.aimLineColor;
      ctx.globalAlpha = DROP_GUIDE_ALPHA;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(DROP_GUIDE_DASH);
      ctx.beginPath();
      ctx.moveTo(dropX, cfg.launcherY + engine.currentBall.radius);
      ctx.lineTo(dropX, cfg.basinFloorY - 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /** Static preview of the pending line: a dashed line plus tick marks on both walls, so it is not colour-only. */
  drawPressureTelegraph(ctx, engine, theme) {
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
    ctx.moveTo(cfg.basinLeftX + 4, y);
    ctx.lineTo(cfg.basinRightX - 4, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = TELEGRAPH_TICK_WIDTH;
    ctx.beginPath();
    ctx.moveTo(cfg.basinLeftX, y);
    ctx.lineTo(cfg.basinLeftX + TELEGRAPH_TICK_LENGTH, y);
    ctx.moveTo(cfg.basinRightX, y);
    ctx.lineTo(cfg.basinRightX - TELEGRAPH_TICK_LENGTH, y);
    ctx.stroke();
  }

  /** Rings every sphere still under a polarity pulse. Nothing moves, so reduced motion keeps it. */
  drawOverlay(ctx, engine, renderer, theme) {
    const pulsing = engine.physicsWorld.balls.filter((ball) => (ball.mergePulseSec || 0) > 0);
    if (pulsing.length === 0) {
      return;
    }
    ctx.save();
    ctx.strokeStyle = theme.overchargePopupColor;
    ctx.globalAlpha = PULSE_RING_ALPHA;
    ctx.lineWidth = PULSE_RING_WIDTH;
    for (const ball of pulsing) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius + PULSE_RING_GAP, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export const mergeBehavior = new MergeBehavior();
registerModeBehavior(GAME_MODES.MERGE, mergeBehavior);
