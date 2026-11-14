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
import { DEFAULT_MODES_CONFIG } from './ModeConfig.js';
import { Ball } from '../../entities/Ball.js';
import { ModeBehavior, registerModeBehavior } from './ModeBehavior.js';
import { reportBountyEvent } from '../Bounties.js';
import {
  MERGE_EVENT_DIRECTIONS,
  MERGE_EVENT_IDS,
  getMergeEventTextKey
} from './MergeEvents.js';
import { MERGE_CONTRACT_OUTCOMES, MERGE_CONTRACT_TYPES } from './MergeContracts.js';
import {
  MERGE_SPECIAL_KINDS,
  getMergeCalibre,
  getMergeFusionCalibre,
  haveSameMergeCalibre,
  isMergeFrozen,
  pickMergeSpecialKind,
  sanitizeMergeSpecialKind
} from './MergeSpecials.js';

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
const OVERFLOW_WARN_RATIO = 0.45;
const GHOST_PREVIEW_LINE_WIDTH = 2;
const GHOST_MERGE_RING_OFFSET = 5;
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
/** The contract reward text sits one text line above the Shake reward text so they do not overlap. */
const CONTRACT_REWARD_TEXT_LINES = 3;

/** Basin shapes: each one is drawn at the start of a run and changes the walls or adds static pegs. */
export const MERGE_SHAPE_IDS = Object.freeze({
  CLASSIC: 'classic',
  NARROW: 'narrow',
  PEGS: 'pegs'
});
/** Static pegs are drawn with a thin outline in the wall colour. */
const PEG_OUTLINE_WIDTH = 2;
const PEG_FILL_ALPHA = 0.55;
const PEG_OUTLINE_ALPHA = 0.9;
/** The shape announcement text sits this many text lines below the event text line. */
const SHAPE_TEXT_LINES_BELOW_EVENT = 1;
/** Restitution that, in a settling pass, only removes the velocity heading into a wall, floor or peg. */
const SETTLE_RESTITUTION = -1;

const SPECIAL_ROLL_STREAM = 'mergeSpecial';
const SPECIAL_KIND_ROLL_STREAM = 'mergeSpecialKind';
const BOMB_EFFECT_COMBO = 1;
const BOMB_BURST_SCALE = 2;
const BOMB_TEXT_LINES_ABOVE = 1;
const FUSION_PAIR_FIRST_ITERATION = 0;

const MERGE_CHROME = Object.freeze({
  ambientLiquid: false,
  collectorBins: false,
  dangerZone: false,
  aimLine: false
});

/** Pause input hints that the basin words its own way. */
const MERGE_INPUT_HINT_KEYS = Object.freeze({
  'modals.pause.instructions.cancel': 'modals.pause.instructions.mergeCancel',
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
      cancelOffset: cfg.cancelAboveOffset,
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

  /** Ids of the shapes this config can draw: listed, and known to the geometry. */
  getShapeIds(engine) {
    const shapes = engine.modesConfig.merge.shapes;
    const known = Object.values(MERGE_SHAPE_IDS);
    const listed = Array.isArray(shapes?.ids) ? shapes.ids.filter((id) => known.includes(id)) : [];
    return listed.length > 0 ? listed : [MERGE_SHAPE_IDS.CLASSIC];
  }

  /** The run's shape id, falling back to the classic basin for a missing or unknown one. */
  getShapeId(engine) {
    const id = engine.modeState?.shapeId;
    return this.getShapeIds(engine).includes(id) ? id : MERGE_SHAPE_IDS.CLASSIC;
  }

  /** Draws a shape id from a unit roll, by the configured weights. */
  pickShapeId(engine, roll) {
    const ids = this.getShapeIds(engine);
    const weights = engine.modesConfig.merge.shapes?.weights ?? {};
    const weightOf = (id) => Math.max(0, Number.isFinite(weights[id]) ? weights[id] : 1);
    const total = ids.reduce((sum, id) => sum + weightOf(id), 0);
    if (!(total > 0)) {
      return ids[0];
    }
    let threshold = roll * total;
    for (const id of ids) {
      threshold -= weightOf(id);
      if (threshold < 0) {
        return id;
      }
    }
    return ids[ids.length - 1];
  }

  /**
   * Walls, floor and static pegs of the run's shape, derived from the config and the shape id.
   * Every reader of the basin geometry goes through here. Never mutates the config.
   * @returns {{left: number, right: number, floor: number, pegs: Array<{x: number, y: number, radius: number}>}}
   */
  getBasinGeometry(engine) {
    const cfg = engine.modesConfig.merge;
    const shapeId = this.getShapeId(engine);
    const shape = cfg.shapes?.[shapeId] ?? {};
    let left = cfg.basinLeftX;
    let right = cfg.basinRightX;
    const pegs = [];
    if (shapeId === MERGE_SHAPE_IDS.NARROW) {
      left += shape.insetPx;
      right -= shape.insetPx;
    } else if (shapeId === MERGE_SHAPE_IDS.PEGS) {
      const defaults = DEFAULT_MODES_CONFIG.merge.shapes.pegs;
      const radius = Number.isFinite(shape.radius) && shape.radius > 0 ? shape.radius : defaults.radius;
      const isValid = (p) => Boolean(p) && Number.isFinite(p.xFrac) && Number.isFinite(p.yFromFloorPx);
      const valid = Array.isArray(shape.positions) ? shape.positions.filter(isValid) : [];
      for (const position of valid.length > 0 ? valid : defaults.positions) {
        pegs.push({
          x: left + position.xFrac * (right - left),
          y: cfg.basinFloorY - position.yFromFloorPx,
          radius
        });
      }
    }
    return { left, right, floor: cfg.basinFloorY, pegs };
  }

  /** Pressure numbers in force: the base ones with the run's shape overrides on top. Null when the config has none. */
  getPressureConfig(engine) {
    const cfg = engine.modesConfig.merge;
    if (!cfg.pressure) {
      return cfg.pressure;
    }
    const override = cfg.shapes?.[this.getShapeId(engine)]?.pressure;
    return override && Object.keys(override).length > 0 ? { ...cfg.pressure, ...override } : cfg.pressure;
  }

  /** Read-only view of the shape for the HUD: its id and the serial of a freshly started run. */
  getShapeView(engine) {
    const state = engine.modeState;
    if (!state) {
      return null;
    }
    return { shapeId: this.getShapeId(engine), announceSerial: state.shapeAnnounceSerial ?? null };
  }

  getSpawnMaxTierIndex(engine) {
    const cfg = engine.modesConfig.merge;
    return this.getActiveEventParams(engine, MERGE_EVENT_IDS.BIG_DROPS)?.spawnMaxTierIndex
      ?? cfg.spawnMaxTierIndex;
  }

  syncActivePalette(engine) {
    const cfg = engine.modesConfig.merge;
    const spawnCount = Math.min(cfg.tiers.length, this.getSpawnMaxTierIndex(engine) + 1);
    engine.activePalette = cfg.tiers.slice(0, spawnCount).map((item) => item.id);
  }

  pickLauncherColor(engine, roll = engine.random()) {
    const cfg = engine.modesConfig.merge;
    const spawnCount = Math.min(cfg.tiers.length, this.getSpawnMaxTierIndex(engine) + 1);
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
      this.syncActivePalette(engine);
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
      this.syncActivePalette(engine);
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

  /** Contract types the config offers and this behavior knows how to judge. */
  getContractTypeIds(engine) {
    const known = Object.values(MERGE_CONTRACT_TYPES);
    return Object.keys(engine.modesConfig.merge.contracts.types).filter((id) => known.includes(id));
  }

  /** Read-only view of the contract for the HUD, or null when the config defines none. */
  getContractView(engine) {
    const state = engine.modeState;
    if (!state || !engine.modesConfig.merge.contracts) {
      return null;
    }
    return {
      contractCount: state.contractCount,
      active: state.contract ? { ...state.contract } : null,
      result: state.contractResult ? { ...state.contractResult } : null
    };
  }

  drawContractGap(engine, contractCount) {
    const { gapMinDrops, gapMaxDrops } = engine.modesConfig.merge.contracts;
    const span = gapMaxDrops - gapMinDrops + 1;
    return gapMinDrops + Math.floor(engine.drawSeededRoll('mergeContractGap', contractCount) * span);
  }

  /** Target of a new contract: a calibre a little below the best one fused, or the fusion count. */
  computeContractTarget(engine, type) {
    const params = engine.modesConfig.merge.contracts.types[type];
    if (type === MERGE_CONTRACT_TYPES.FUSE_CALIBRE) {
      const wanted = (engine.mergeBestTier || 1) - params.offsetBelowBest;
      return Math.min(params.maxCalibre, Math.max(params.minCalibre, wanted));
    }
    return params.count;
  }

  startContract(engine) {
    const state = engine.modeState;
    const ids = this.getContractTypeIds(engine);
    if (ids.length === 0) {
      state.dropsUntilContract = this.drawContractGap(engine, state.contractCount);
      return;
    }
    const candidates = ids.length > 1 ? ids.filter((id) => id !== state.lastContractType) : ids;
    const pick = Math.floor(engine.drawSeededRoll('mergeContract', state.contractCount) * candidates.length);
    const type = candidates[Math.min(candidates.length - 1, pick)];
    state.contract = {
      type,
      target: this.computeContractTarget(engine, type),
      progress: 0,
      dropsLeft: engine.modesConfig.merge.contracts.durationDrops
    };
    state.contractCount += 1;
  }

  /** Closes the running contract, remembers how it ended for the HUD and draws the next gap. */
  endContract(engine, outcome, points) {
    const state = engine.modeState;
    state.contractResult = { id: state.contractCount, type: state.contract.type, outcome, points };
    state.lastContractType = state.contract.type;
    state.contract = null;
    state.dropsUntilContract = this.drawContractGap(engine, state.contractCount);
  }

  /**
   * Moves the contract cycle on by one successful drop: counts down the running contract, or
   * the gap to the next one. A contract with no drop left stays open while the last sphere
   * settles (fusions it causes still count); it fails without penalty at the next drop, or
   * once the grace time of expireStalledContract has run out.
   */
  advanceContractCycle(engine) {
    const state = engine.modeState;
    const contracts = engine.modesConfig.merge.contracts;
    if (!contracts) {
      return;
    }
    if (state.contract?.dropsLeft <= 0) {
      this.endContract(engine, MERGE_CONTRACT_OUTCOMES.FAILURE, 0);
    }
    if (state.contract) {
      state.contract.dropsLeft -= 1;
      if (state.contract.dropsLeft <= 0) {
        state.contractGraceSec = contracts.lastDropGraceSec;
      }
      return;
    }
    state.dropsUntilContract -= 1;
    if (state.dropsUntilContract <= 0) {
      this.startContract(engine);
    }
  }

  /**
   * Fails a contract that has no drop left once its grace time has run out, so that neither
   * Polarity nor the Shake can keep it open for ever. Called every physics step.
   */
  expireStalledContract(engine, dtSec) {
    const state = engine.modeState;
    if (!state.contract || state.contract.dropsLeft > 0) {
      return;
    }
    state.contractGraceSec -= dtSec;
    if (state.contractGraceSec <= 0) {
      this.endContract(engine, MERGE_CONTRACT_OUTCOMES.FAILURE, 0);
    }
  }

  /**
   * Feeds one fusion (a Supernova is one) to the running contract: the fusion that reaches
   * the goal pays at once, in points that ignore the combo and the golden event, and
   * brings the Shake closer. This stacks with the chain reward (1): a drop that completes a
   * contract and a chain of three can advance the Shake by 3, on purpose.
   */
  recordContractFusion(engine, calibre, x, y) {
    const state = engine.modeState;
    const contract = state.contract;
    if (!contract) {
      return;
    }
    const params = engine.modesConfig.merge.contracts.types[contract.type];
    const isCalibreGoal = contract.type === MERGE_CONTRACT_TYPES.FUSE_CALIBRE;
    contract.progress = isCalibreGoal ? Math.max(contract.progress, calibre) : contract.progress + 1;
    const points = isCalibreGoal ? contract.target * params.pointsPerCalibre : params.points;
    if (contract.progress < contract.target) {
      return;
    }
    engine.addScore(points);
    if (state.shakeRemaining > 0) {
      state.shakeRemaining = Math.max(0, state.shakeRemaining - engine.modesConfig.merge.contracts.rewardShakeDrops);
    }
    this.endContract(engine, MERGE_CONTRACT_OUTCOMES.SUCCESS, points);
    engine.particleSystem.spawnFloatingText(
      x,
      y + engine.gameConfig.canvas.floatingTextOffsetY * CONTRACT_REWARD_TEXT_LINES,
      t('gameplay.feedback.merge.contractDone', { points }),
      engine.gameConfig.theme.victoryPopupColor
    );
  }

  /** Restores the contract cycle from a snapshot; a legacy snapshot starts the cycle afresh. */
  restoreContractCycle(engine, rawState) {
    const { contracts } = engine.modesConfig.merge;
    const state = engine.modeState;
    state.contractCount = Number.isInteger(rawState.contractCount) ? Math.max(0, rawState.contractCount) : 0;
    state.lastContractType = this.getContractTypeIds(engine).includes(rawState.lastContractType)
      ? rawState.lastContractType
      : null;
    state.contract = this.sanitizeSavedContract(engine, rawState.contract);
    state.contractGraceSec = contracts.lastDropGraceSec;
    state.dropsUntilContract = Number.isInteger(rawState.dropsUntilContract)
      ? Math.min(Math.max(contracts.firstAfterDrops, contracts.gapMaxDrops), Math.max(1, rawState.dropsUntilContract))
      : contracts.firstAfterDrops;
  }

  /** Keeps a saved contract only when its type is known and its numbers fit the config. */
  sanitizeSavedContract(engine, raw) {
    const { contracts } = engine.modesConfig.merge;
    if (
      !raw
      || typeof raw !== 'object'
      || !this.getContractTypeIds(engine).includes(raw.type)
      || !Number.isInteger(raw.target)
      || !Number.isInteger(raw.dropsLeft)
    ) {
      return null;
    }
    const params = contracts.types[raw.type];
    const [minTarget, maxTarget] = raw.type === MERGE_CONTRACT_TYPES.FUSE_CALIBRE
      ? [params.minCalibre, params.maxCalibre]
      : [1, params.count];
    const target = Math.min(maxTarget, Math.max(minTarget, raw.target));
    const progress = Number.isInteger(raw.progress) ? Math.min(target - 1, Math.max(0, raw.progress)) : 0;
    return { type: raw.type, target, progress, dropsLeft: Math.min(contracts.durationDrops, Math.max(0, raw.dropsLeft)) };
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

  /** Fresh contract fields of a mode state: none running, the first one due after the configured drops. */
  createContractState(engine) {
    return {
      contract: null,
      contractResult: null,
      contractGraceSec: 0,
      contractCount: 0,
      lastContractType: null,
      dropsUntilContract: engine.modesConfig.merge.contracts?.firstAfterDrops ?? 0
    };
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
    if (!state || !this.getPressureConfig(engine)) {
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
    const pressure = this.getPressureConfig(engine);
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
    const pressure = this.getPressureConfig(engine);
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
    const { settledSpeedPxPerSec } = this.getPressureConfig(engine);
    return engine.physicsWorld.balls.some((ball) => {
      const top = ball.y - ball.radius;
      return Math.abs(ball.vy) < settledSpeedPxPerSec && top > currentLine && top < newLine;
    });
  }

  /** Applies the pending step unless a settled sphere is in its way, for at most `holdMaxDrops` drops. */
  tryApplyPendingStep(engine) {
    const pressure = this.getPressureConfig(engine);
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
    const pressure = this.getPressureConfig(engine);
    if (!pressure || ball.y - ball.radius >= lineY) {
      return current;
    }
    return Math.max(current, cfg.overflowGraceSec * pressure.stepGraceFactor);
  }

  /** Restores the pressure from a snapshot; a legacy snapshot derives the line from its best calibre. */
  restorePressure(engine, rawState) {
    const pressure = this.getPressureConfig(engine);
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
    const kind = sanitizeMergeSpecialKind(ball.mergeKind, this.getSpecialsConfig(engine)?.kinds);
    ball.mergeKind = kind;
    const spec = this.resolveKindSpec(engine, kind, this.getTierSpecById(engine, ball.colorId));
    ball.colorId = spec.id;
    ball.radius = spec.radius;
    ball.mergeTier = this.hasOwnCalibre(kind) ? spec.tier : null;
  }

  /** Special spheres config of the Basin, or null when the config offers none. */
  getSpecialsConfig(engine) {
    return engine.modesConfig.merge.specials ?? null;
  }

  /** True for a sphere that matches by its calibre: every kind but the Joker and the Bomb. */
  hasOwnCalibre(kind) {
    return kind !== MERGE_SPECIAL_KINDS.JOKER && kind !== MERGE_SPECIAL_KINDS.BOMB;
  }

  /**
   * Tier spec a sphere of `kind` is built from: a Joker and a Bomb have a fixed size, an Ice
   * sphere is held to its highest calibre, a plain sphere keeps `baseSpec`.
   */
  resolveKindSpec(engine, kind, baseSpec) {
    const kindConfig = kind ? this.getSpecialsConfig(engine)?.kinds?.[kind] : null;
    if (!kindConfig) {
      return baseSpec;
    }
    if (!this.hasOwnCalibre(kind)) {
      return this.getTierSpecByIndex(engine, kindConfig.sizeTierIndex);
    }
    return baseSpec.tier > kindConfig.maxTierIndex ? this.getTierSpecByIndex(engine, kindConfig.maxTierIndex) : baseSpec;
  }

  /** Seconds a special sphere of `kind` waits once landed: the thaw delay or the fuse, else null. */
  getSpecialTimerSec(engine, kind) {
    const kindConfig = this.getSpecialsConfig(engine)?.kinds?.[kind];
    if (kind === MERGE_SPECIAL_KINDS.ICE) {
      return kindConfig?.thawTimeoutSec ?? null;
    }
    return kind === MERGE_SPECIAL_KINDS.BOMB ? kindConfig?.fuseSec ?? null : null;
  }

  /** Pads or trims the queued kinds so they line up with the queued colors. */
  alignUpcomingKinds(engine) {
    const kinds = engine.modeState.upcomingKinds;
    kinds.length = Math.min(kinds.length, engine.upcomingColorIds.length);
    while (kinds.length < engine.upcomingColorIds.length) {
      kinds.push(null);
    }
  }

  /** True when a special sphere is already loaded, next in line or queued. */
  hasSpecialInView(engine) {
    return Boolean(engine.currentBall?.mergeKind)
      || Boolean(engine.nextBall?.mergeKind)
      || engine.modeState.upcomingKinds.some(Boolean);
  }

  /**
   * After a successful drop, maybe turns the ball just queued into a special sphere. Starts
   * from the configured drop, never adds a second special to what the player can see, and
   * draws from indexed streams so a seeded run repeats.
   */
  rollSpecialSpawn(engine) {
    const specials = this.getSpecialsConfig(engine);
    const state = engine.modeState;
    this.alignUpcomingKinds(engine);
    const queueLength = engine.upcomingColorIds.length;
    if (!specials || queueLength === 0 || state.dropCount < specials.fromDrop || this.hasSpecialInView(engine)) {
      return;
    }
    if (engine.drawSeededRoll(SPECIAL_ROLL_STREAM, state.dropCount) >= specials.chance) {
      return;
    }
    const kind = pickMergeSpecialKind(specials.kinds, engine.drawSeededRoll(SPECIAL_KIND_ROLL_STREAM, state.dropCount));
    if (kind) {
      state.upcomingKinds[queueLength - 1] = kind;
    }
  }

  /** Records, and flags for a polite announcement, the first appearance of each kind in the launcher. */
  noteLauncherSpecials(engine) {
    const state = engine.modeState;
    for (const ball of [engine.currentBall, engine.nextBall]) {
      const kind = ball?.mergeKind;
      if (kind && !state.specialsSeen.includes(kind)) {
        state.specialsSeen.push(kind);
        engine.mergeSpecialSerial = (engine.mergeSpecialSerial ?? 0) + 1;
        state.specialAnnounce = { kind, serial: engine.mergeSpecialSerial };
      }
    }
  }

  /** Read-only view of the latest special announcement for the HUD. */
  getSpecialView(engine) {
    const state = engine.modeState;
    if (!state) {
      return null;
    }
    return { kind: state.specialAnnounce?.kind ?? null, announceSerial: state.specialAnnounce?.serial ?? null };
  }

  clampDropX(engine, rawX, radius) {
    const { left, right } = this.getBasinGeometry(engine);
    return Math.max(left + radius, Math.min(right - radius, rawX));
  }

  setupMode(engine) {
    const cfg = engine.modesConfig.merge;
    const world = engine.physicsWorld;
    world.clear();
    world.skipClusterStep = true;

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
      ...this.createContractState(engine),
      shapeId: this.pickShapeId(engine, engine.drawSeededRoll('mergeShape', 0)),
      shapeAnnounceSerial: engine.isRestoringRun ? null : (engine.mergeShapeSerial = (engine.mergeShapeSerial ?? 0) + 1),
      dropCount: 0,
      upcomingKinds: [],
      specialsSeen: [],
      specialAnnounce: null,
      ...this.createPressureState()
    };
    this.syncActivePalette(engine);
    if (cfg.events) {
      engine.modeState.dropsUntilEvent = this.drawEventGap(engine, 0);
    }
    if (!engine.isRestoringRun) {
      this.announceShape(engine);
    }
  }

  /** Floating text naming the run's shape, one text line below the event text position (the HUD adds the polite announcement). */
  announceShape(engine) {
    const cfg = engine.modesConfig.merge;
    const id = engine.modeState.shapeId;
    engine.particleSystem.spawnFloatingText(
      engine.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      cfg.overflowLineY + cfg.eventTextOffsetY
        - engine.gameConfig.canvas.floatingTextOffsetY * SHAPE_TEXT_LINES_BELOW_EVENT,
      t('gameplay.feedback.merge.shapeStart', { name: t(`gameplay.merge.shapes.${id}.name`) }),
      engine.gameConfig.theme.overchargePopupColor
    );
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
    const kind = engine.currentBall.mergeKind;
    const dropX = this.clampDropX(engine, engine.mergeDropX, tierSpec.radius);

    engine.sampleShotTimeline();
    engine.evaluateGhostShot();
    engine.countShotForStats();
    engine.levelIntro = null;

    const dropped = new Ball({
      x: dropX,
      y: cfg.launcherY,
      vx: 0,
      vy: INITIAL_DROP_VY,
      radius: tierSpec.radius,
      colorId: tierSpec.id,
      isAnchor: false
    });
    dropped.mergeTier = engine.currentBall.mergeTier;
    dropped.mergeKind = kind;
    dropped.mergeSpecialSec = null;
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

    engine.modeState.dropCount += 1;
    this.alignUpcomingKinds(engine);
    const carriedKind = engine.modeState.upcomingKinds.shift() ?? null;
    engine.currentBall = engine.nextBall;
    const upcoming = engine.takeUpcomingBall();
    engine.nextBall = engine.createRandomLauncherBall(null, upcoming.colorId);
    engine.nextBall.mergeKind = carriedKind;
    this.rollSpecialSpawn(engine);
    this.syncLauncherBallTier(engine, engine.currentBall);
    this.syncLauncherBallTier(engine, engine.nextBall);
    this.noteLauncherSpecials(engine);
    engine.mergeDropX = this.clampDropX(engine, engine.mergeDropX, engine.currentBall.radius);

    this.advanceEventCycle(engine);
    this.advanceContractCycle(engine);
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
    const geometry = this.getBasinGeometry(engine);
    const midpoint = (geometry.left + geometry.right) * MATH_CONSTANTS.HALF;
    const averageX = balls.reduce((sum, ball) => sum + ball.x, 0) / balls.length;
    const direction = averageX > midpoint ? -1 : 1;
    const shakeGraceSec = this.getPressureConfig(engine)?.shakeGraceSec ?? 0;
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
        // A sphere without a calibre (Joker, Bomb) never counts as the same tier as another one.
        const sign = haveSameMergeCalibre(a, b) ? 1 : -0.55;
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
      // The shockwave frees a frozen sphere when it reaches its edge, whatever its calibre.
      if (isMergeFrozen(other) && dist - other.radius <= maxDist) {
        this.thawBall(other);
      }
      if (dist <= MATH_CONSTANTS.EPSILON || dist > maxDist) {
        continue;
      }
      const falloff = 1 - dist / maxDist;
      const massScale = (sourceRadius * sourceRadius) / Math.max(196, other.radius * other.radius);
      const dirSign = getMergeCalibre(other) === targetTier ? -0.45 : 1;
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
    this.expireStalledContract(engine, dtSec);
    if (balls.length === 0) {
      const prevDanger = Boolean(state.nearDanger);
      state.maxOverflowRatio = 0;
      state.nearDanger = false;
      if (prevDanger) {
        engine.notifyUI();
      }
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
    const entryGraceMaxSec = this.getPressureConfig(engine)?.entryGraceMaxSec ?? 0;
    for (const b of balls) {
      if (b.mergeEntering) {
        // A fresh sphere keeps its grace until it first passes below the current line, capped.
        b.mergeEntrySec = (b.mergeEntrySec || 0) + dtSec;
        if (b.y - b.radius >= lineY || b.mergeEntrySec >= entryGraceMaxSec) {
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
    const topCalibre = cfg.tiers.length - 1;

    const geometry = this.getBasinGeometry(engine);
    const pegRestitution = cfg.shapes?.[MERGE_SHAPE_IDS.PEGS]?.restitution ?? 0;
    const contain = (b, settling = false) => {
      const minX = geometry.left + b.radius;
      const maxX = geometry.right - b.radius;
      const maxY = geometry.floor - b.radius;
      if (b.x < minX) {
        b.x = minX;
        if (b.vx < 0) {
          b.vx = settling ? 0 : -b.vx * wallRestitution;
        }
      } else if (b.x > maxX) {
        b.x = maxX;
        if (b.vx > 0) {
          b.vx = settling ? 0 : -b.vx * wallRestitution;
        }
      }
      if (b.y > maxY) {
        b.y = maxY;
        if (b.vy > 0) {
          b.vy = settling ? 0 : -b.vy * floorRestitution;
        }
        if (!settling) {
          b.vx *= cfg.floorFriction;
        }
      }
      for (const peg of geometry.pegs) {
        this.collideWithPeg(b, peg, settling ? SETTLE_RESTITUTION : pegRestitution);
      }
    };

    for (let iter = 0; iter < cfg.solverIterations; iter++) {
      for (const b of balls) {
        contain(b);
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
            iter === FUSION_PAIR_FIRST_ITERATION
            && distSq <= (minDist + TOUCH_MERGE_TOLERANCE_PX) * (minDist + TOUCH_MERGE_TOLERANCE_PX)
            && getMergeFusionCalibre(a, b, topCalibre) !== null
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

    // The last pair pass can leave a sphere a sliver into a wall or a peg: the step ends contained.
    for (const b of balls) {
      contain(b, true);
    }

    if (mergePairs.length > 0) {
      this.resolveMergePairs(engine, mergePairs);
    }
    this.updateSpecials(engine, dtSec);

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
    const nextDanger = state.maxOverflowRatio >= OVERFLOW_WARN_RATIO;
    if (nextDanger !== Boolean(state.nearDanger)) {
      state.nearDanger = nextDanger;
      engine.notifyUI();
    }
  }

  /** Pushes a sphere out of a static peg along the normal and bounces its normal velocity, keeping the tangent. */
  collideWithPeg(ball, peg, restitution, positionTarget = ball) {
    const dx = ball.x - peg.x;
    const dy = ball.y - peg.y;
    const minDist = ball.radius + peg.radius;
    const distSq = dx * dx + dy * dy;
    if (distSq >= minDist * minDist) {
      return;
    }
    let nx = SEPARATION_FALLBACK_AXIS.X;
    let ny = SEPARATION_FALLBACK_AXIS.Y;
    if (distSq > MATH_CONSTANTS.EPSILON) {
      const dist = Math.sqrt(distSq);
      nx = dx / dist;
      ny = dy / dist;
    }
    positionTarget.x = peg.x + nx * minDist;
    positionTarget.y = peg.y + ny * minDist;
    const normalSpeed = ball.vx * nx + ball.vy * ny;
    if (normalSpeed < 0) {
      ball.vx -= (1 + restitution) * normalSpeed * nx;
      ball.vy -= (1 + restitution) * normalSpeed * ny;
    }
  }

  /** Frees a frozen sphere: it becomes a plain sphere of its calibre. */
  thawBall(ball) {
    ball.mergeKind = null;
    ball.mergeSpecialSec = null;
  }

  /**
   * True once a sphere rests on the floor, on a peg or on a sphere below it. A wall alone is
   * not a landing, and neither is a sphere still entering the basin.
   */
  hasLanded(engine, ball, geometry) {
    if (ball.mergeEntering) {
      return false;
    }
    if (ball.y + ball.radius >= geometry.floor - TOUCH_MERGE_TOLERANCE_PX) {
      return true;
    }
    if (geometry.pegs.some((peg) => Math.hypot(peg.x - ball.x, peg.y - ball.y)
      <= peg.radius + ball.radius + TOUCH_MERGE_TOLERANCE_PX)) {
      return true;
    }
    return engine.physicsWorld.balls.some((other) => other !== ball
      && other.y > ball.y
      && Math.hypot(other.x - ball.x, other.y - ball.y) <= other.radius + ball.radius + TOUCH_MERGE_TOLERANCE_PX);
  }

  /**
   * Runs the timers of the Ice and Bomb spheres on the board: a timer starts when the sphere
   * lands, a thaw frees the Ice sphere and a burnt fuse sets the Bomb off. Ordered by id so
   * two bombs always go off in the same order.
   */
  updateSpecials(engine, dtSec) {
    if (!engine.physicsWorld.balls.some(
      (ball) => ball.mergeKind === MERGE_SPECIAL_KINDS.ICE || ball.mergeKind === MERGE_SPECIAL_KINDS.BOMB
    )) {
      return;
    }
    const timed = engine.physicsWorld.balls
      .filter((ball) => ball.mergeKind === MERGE_SPECIAL_KINDS.ICE || ball.mergeKind === MERGE_SPECIAL_KINDS.BOMB)
      .sort((a, b) => a.id - b.id);
    const geometry = this.getBasinGeometry(engine);
    for (const ball of timed) {
      if (!engine.physicsWorld.ballMap.has(ball.id)) {
        continue;
      }
      if (!Number.isFinite(ball.mergeSpecialSec)) {
        if (this.hasLanded(engine, ball, geometry)) {
          ball.mergeSpecialSec = this.getSpecialTimerSec(engine, ball.mergeKind);
        }
        continue;
      }
      ball.mergeSpecialSec -= dtSec;
      if (ball.mergeSpecialSec > 0) {
        continue;
      }
      if (ball.mergeKind === MERGE_SPECIAL_KINDS.ICE) {
        this.thawBall(ball);
      } else {
        this.explodeBomb(engine, ball);
      }
    }
  }

  /** True when a Bomb takes `ball` with it: a calibre at or below the Bomb's limit, never another Bomb. */
  isBombVictim(engine, ball) {
    const kinds = this.getSpecialsConfig(engine).kinds;
    if (ball.mergeKind === MERGE_SPECIAL_KINDS.BOMB) {
      return false;
    }
    const calibre = ball.mergeKind === MERGE_SPECIAL_KINDS.JOKER
      ? kinds[MERGE_SPECIAL_KINDS.JOKER]?.sizeTierIndex
      : getMergeCalibre(ball);
    return Number.isInteger(calibre) && calibre <= kinds[MERGE_SPECIAL_KINDS.BOMB].maxTierIndex;
  }

  /**
   * Sets a Bomb off: every small sphere within its radius goes, in id order, for a flat award
   * that skips the combo and the golden event; then the Bomb itself goes.
   */
  explodeBomb(engine, bomb) {
    const world = engine.physicsWorld;
    const config = this.getSpecialsConfig(engine).kinds[MERGE_SPECIAL_KINDS.BOMB];
    const victims = world.balls
      .filter((ball) => ball !== bomb
        && this.isBombVictim(engine, ball)
        && Math.hypot(ball.x - bomb.x, ball.y - bomb.y) <= config.radiusPx)
      .sort((a, b) => a.id - b.id);
    const points = victims.length * config.pointsPerSphere;
    const { x, y } = bomb;
    world.removeBall(bomb);
    for (const victim of victims) {
      world.removeBall(victim);
    }
    engine.addScore(points);
    const color = engine.gameConfig.theme.dangerLineColor;
    engine.audioManager.playEffect('match', BOMB_EFFECT_COMBO);
    engine.particleSystem.spawnShockwave(x, y, color, config.radiusPx);
    engine.particleSystem.spawnBurst(
      x,
      y,
      color,
      engine.gameConfig.juice.matchBurstCount * BOMB_BURST_SCALE,
      engine.gameConfig.juice.matchBurstSpeed
    );
    engine.particleSystem.spawnFloatingText(
      x,
      y - engine.gameConfig.canvas.floatingTextOffsetY * BOMB_TEXT_LINES_ABOVE,
      t('gameplay.feedback.merge.bombBoom', { points }),
      color
    );
    engine.persistRunHighScore();
    engine.saveRunSnapshot();
    engine.notifyUI();
  }

  resolveMergePairs(engine, mergePairs) {
    const cfg = engine.modesConfig.merge;
    const scoring = engine.gameConfig.scoring;
    const world = engine.physicsWorld;

    for (const [a, b] of mergePairs) {
      if (!world.ballMap.has(a.id) || !world.ballMap.has(b.id)) {
        continue;
      }
      let mx = (a.x + b.x) * MATH_CONSTANTS.HALF;
      let my = (a.y + b.y) * MATH_CONSTANTS.HALF;
      const avgVx = (a.vx + b.vx) * MATH_CONSTANTS.HALF * 0.5;
      const avgVy = (a.vy + b.vy) * MATH_CONSTANTS.HALF * 0.5;
      const tierIndex = getMergeFusionCalibre(a, b, cfg.tiers.length - 1) ?? getMergeCalibre(a) ?? 0;
      const joker = [a, b].find((ball) => ball.mergeKind === MERGE_SPECIAL_KINDS.JOKER);
      if (joker) {
        // A Joker fuses at the point where it touches the other sphere.
        const other = joker === a ? b : a;
        const gap = Math.hypot(other.x - joker.x, other.y - joker.y);
        if (gap > MATH_CONSTANTS.EPSILON) {
          mx = joker.x + ((other.x - joker.x) / gap) * joker.radius;
          my = joker.y + ((other.y - joker.y) / gap) * joker.radius;
        }
      }

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
        this.recordContractFusion(engine, cfg.tiers.length, mx, my);
        engine.waveCount = engine.mergeBestTier;
        reportBountyEvent(engine, 'merge_fusion', 1);
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
        engine.storageManager?.recordAchievementProgress?.({ maxCombo: engine.combo });
        engine.unlockAchievementTiers('comboMaster', engine.combo);
        continue;
      }

      const nextSpec = this.getTierSpecByIndex(engine, tierIndex + 1);
      const geometry = this.getBasinGeometry(engine);
      const spawn = { x: mx, y: my };
      const clampToWalls = () => {
        spawn.x = Math.max(geometry.left + nextSpec.radius, Math.min(geometry.right - nextSpec.radius, spawn.x));
        spawn.y = Math.min(geometry.floor - nextSpec.radius, spawn.y);
      };
      clampToWalls();
      for (const peg of geometry.pegs) {
        this.collideWithPeg({ ...spawn, radius: nextSpec.radius, vx: 0, vy: 0 }, peg, 0, spawn);
      }
      clampToWalls();
      const clampedX = spawn.x;
      const clampedY = spawn.y;

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
      this.recordContractFusion(engine, nextSpec.tier + 1, clampedX, clampedY);
      engine.waveCount = engine.mergeBestTier;

      engine.audioManager.playEffect('mergeFusion', nextSpec.tier);
      reportBountyEvent(engine, 'merge_fusion', 1);
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
      contract: state.contract ?? null,
      dropsUntilContract: state.dropsUntilContract ?? 0,
      contractCount: state.contractCount ?? 0,
      lastContractType: state.lastContractType ?? null,
      lineOffsetPx: state.lineOffsetPx ?? 0,
      pendingOffsetPx: state.pendingOffsetPx ?? null,
      pendingDropsLeft: state.pendingDropsLeft ?? 0,
      holdDrops: state.holdDrops ?? 0,
      topTierDrops: state.topTierDrops ?? null,
      shapeId: this.getShapeId(engine),
      dropCount: state.dropCount ?? 0,
      specialsSeen: [...(state.specialsSeen ?? [])],
      launcherKinds: {
        current: engine.currentBall?.mergeKind ?? null,
        next: engine.nextBall?.mergeKind ?? null,
        queue: [...(state.upcomingKinds ?? [])]
      },
      ballTiers: engine.physicsWorld.balls.map((b) => (Number.isInteger(b.mergeTier) ? b.mergeTier : 0)),
      ballGraceSecs: engine.physicsWorld.balls.map((b) => Math.max(0, b.mergeGraceSec || 0)),
      ballKinds: engine.physicsWorld.balls.map((b) => b.mergeKind ?? null),
      ballSpecial: engine.physicsWorld.balls.map((b) => (Number.isFinite(b.mergeSpecialSec) ? b.mergeSpecialSec : null))
    };
  }

  validateModeState(rawState) {
    if (!(
      rawState
      && typeof rawState === 'object'
      && Number.isFinite(rawState.dropX)
      && Number.isInteger(rawState.bestTier)
      && rawState.bestTier >= 1
      && Array.isArray(rawState.ballTiers)
    )) {
      return false;
    }
    if (
      rawState.ballGraceSecs !== undefined
      && (
        !Array.isArray(rawState.ballGraceSecs)
        || rawState.ballGraceSecs.length !== rawState.ballTiers.length
        || !rawState.ballGraceSecs.every((v) => Number.isFinite(v) && v >= 0)
      )
    ) {
      return false;
    }
    return true;
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
      ...this.createContractState(engine),
      shapeId: this.getShapeIds(engine).includes(rawState.shapeId) ? rawState.shapeId : MERGE_SHAPE_IDS.CLASSIC,
      shapeAnnounceSerial: null,
      dropCount: Number.isInteger(rawState.dropCount) ? Math.max(0, rawState.dropCount) : 0,
      upcomingKinds: [],
      specialsSeen: [],
      specialAnnounce: null,
      ...this.createPressureState()
    };
    this.restoreSpecialsState(engine, rawState);
    if (cfg.events) {
      this.restoreEventCycle(engine, rawState);
    }
    this.syncActivePalette(engine);
    if (cfg.contracts) {
      this.restoreContractCycle(engine, rawState);
    }
    this.restorePressure(engine, rawState);

    const balls = engine.physicsWorld.balls;
    const restoredLineY = this.getOverflowLineY(engine);
    for (let i = 0; i < balls.length; i++) {
      const savedTier = Number.isInteger(rawState.ballTiers[i]) ? rawState.ballTiers[i] : 0;
      // A legacy snapshot holds no kinds: every sphere is a plain one.
      const kind = sanitizeMergeSpecialKind(rawState.ballKinds?.[i], cfg.specials?.kinds);
      const spec = this.resolveKindSpec(engine, kind, this.getTierSpecByIndex(engine, savedTier));
      balls[i].mergeTier = this.hasOwnCalibre(kind) ? spec.tier : null;
      balls[i].mergeKind = kind;
      balls[i].mergeSpecialSec = this.sanitizeSpecialTimer(engine, kind, rawState.ballSpecial?.[i]);
      balls[i].colorId = spec.id;
      balls[i].radius = spec.radius;
      const savedGrace = Number.isFinite(rawState.ballGraceSecs?.[i]) ? Math.max(0, rawState.ballGraceSecs[i]) : 0;
      balls[i].mergeGraceSec = Math.max(this.getStepGraceSec(engine, balls[i], restoredLineY, 0), savedGrace);
      balls[i].mergeEntering = false;
      balls[i].mergeOverflowSec = 0;
      balls[i].mergePolaritySec = 0;
      balls[i].mergePulseSec = 0;
    }
    this.syncLauncherBallTier(engine, engine.currentBall);
    this.syncLauncherBallTier(engine, engine.nextBall);
  }

  /** Timer kept from a snapshot: a finite number within the kind's own delay, else null (not started). */
  sanitizeSpecialTimer(engine, kind, raw) {
    const limit = this.getSpecialTimerSec(engine, kind);
    return Number.isFinite(raw) && limit !== null ? Math.min(limit, Math.max(0, raw)) : null;
  }

  /**
   * Restores the special spheres of the launcher and the announcements already made. At most
   * one special is kept in view, the first found, whatever a damaged snapshot holds.
   */
  restoreSpecialsState(engine, rawState) {
    const kindsConfig = this.getSpecialsConfig(engine)?.kinds;
    const state = engine.modeState;
    const saved = rawState.launcherKinds && typeof rawState.launcherKinds === 'object' ? rawState.launcherKinds : {};
    state.specialsSeen = (Array.isArray(rawState.specialsSeen) ? rawState.specialsSeen : [])
      .map((kind) => sanitizeMergeSpecialKind(kind, kindsConfig))
      .filter((kind, idx, all) => kind !== null && all.indexOf(kind) === idx);
    let kept = false;
    const keepOne = (raw) => {
      const kind = kept ? null : sanitizeMergeSpecialKind(raw, kindsConfig);
      kept = kept || kind !== null;
      return kind;
    };
    if (engine.currentBall) {
      engine.currentBall.mergeKind = keepOne(saved.current);
    }
    if (engine.nextBall) {
      engine.nextBall.mergeKind = keepOne(saved.next);
    }
    state.upcomingKinds = (Array.isArray(saved.queue) ? saved.queue : []).map(keepOne);
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
    const geometry = this.getBasinGeometry(engine);
    const basinW = geometry.right - geometry.left;
    const lineY = this.getOverflowLineY(engine);
    const basinH = geometry.floor - lineY;
    const basinStrokeColor = theme.launcherAccentColor || theme.aimLineColor;

    ctx.save();
    // Subtle magnetic containment chamber fill
    ctx.fillStyle = basinStrokeColor;
    ctx.globalAlpha = BASIN_GLOW_ALPHA * 0.35;
    ctx.fillRect(geometry.left, lineY, basinW, basinH);

    // Danger band that pressure took from the basin
    if (lineY > cfg.overflowLineY) {
      ctx.fillStyle = theme.dangerLineColor;
      ctx.globalAlpha = PRESSURE_ZONE_ALPHA;
      ctx.fillRect(geometry.left, cfg.overflowLineY, basinW, lineY - cfg.overflowLineY);
    }

    // Basin walls & floor
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

    // Top overflow danger line
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

    // Vertical drop guide & resting ghost target from top rail cursor
    if (engine.isRunPlaying() && engine.currentBall && !engine.isAimCancelled) {
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

      if (typeof ctx.arc === 'function' && typeof ctx.fill === 'function') {
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
      }
    }
    ctx.restore();
  }

  /** Resolves where a dropped sphere comes to vertical rest above resting basin spheres, pegs, or the floor. */
  predictDropLandingY(engine, cfg, dropX, radius, geometry = this.getBasinGeometry(engine)) {
    const left = geometry?.left ?? cfg.basinLeftX;
    const right = geometry?.right ?? cfg.basinRightX;
    const floor = geometry?.floor ?? cfg.basinFloorY;
    let dropY = floor - radius;
    for (const ball of engine.physicsWorld.balls) {
      if (ball.y <= cfg.launcherY || ball.x < left || ball.x > right) {
        continue;
      }
      const dx = Math.abs(ball.x - dropX);
      const sumR = radius + ball.radius;
      if (dx < sumR) {
        const hitY = ball.y - Math.sqrt(sumR * sumR - dx * dx);
        if (hitY < dropY) {
          dropY = hitY;
        }
      }
    }
    for (const peg of geometry?.pegs ?? []) {
      const dx = Math.abs(peg.x - dropX);
      const sumR = radius + peg.radius;
      if (dx < sumR) {
        const hitY = peg.y - Math.sqrt(sumR * sumR - dx * dx);
        if (hitY < dropY) {
          dropY = hitY;
        }
      }
    }
    return Math.max(cfg.launcherY, dropY);
  }

  /** True when the predicted landing position contacts at least one fusion-compatible resting sphere. */
  hasEqualTierContactAt(engine, dropX, dropY, radius, tier) {
    const cfg = engine.modesConfig.merge;
    const launcherKind = sanitizeMergeSpecialKind(engine.currentBall?.mergeKind, this.getSpecialsConfig(engine)?.kinds);
    const resolvedTier = Number.isInteger(tier)
      ? tier
      : (this.getTierSpecById(engine, engine.currentBall?.colorId)?.tier ?? 0);
    const probe = {
      mergeKind: launcherKind,
      mergeTier: this.hasOwnCalibre(launcherKind) ? resolvedTier : null
    };
    const topCalibre = cfg.tiers.length - 1;
    for (const ball of engine.physicsWorld.balls) {
      if (!ball || ball.y <= cfg.launcherY) {
        continue;
      }
      if (getMergeFusionCalibre(probe, ball, topCalibre) === null) {
        continue;
      }
      const sumR = radius + ball.radius + TOUCH_MERGE_TOLERANCE_PX;
      const dx = dropX - ball.x;
      const dy = dropY - ball.y;
      if (dx * dx + dy * dy <= sumR * sumR) {
        return true;
      }
    }
    return false;
  }

  /** Continuous basin fill ratio toward active overflow line blended with active overflow grace progress. */
  getPressureState(engine) {
    const cfg = engine.modesConfig?.merge;
    const world = engine.physicsWorld;
    const state = engine.modeState;
    if (!cfg || !world || !state) {
      return null;
    }
    const geometry = this.getBasinGeometry(engine);
    const lineY = this.getOverflowLineY(engine);
    const basinSpan = Math.max(1, geometry.floor - lineY);
    let minTop = geometry.floor;
    for (const ball of world.balls) {
      if ((ball.mergeGraceSec || 0) > 0) {
        continue;
      }
      const top = ball.y - ball.radius;
      if (top < minTop) {
        minTop = top;
      }
    }
    const fillFraction = Math.max(0, Math.min(1, (geometry.floor - minTop) / basinSpan));
    const overflowRatio = Math.max(0, Math.min(1, state.maxOverflowRatio || 0));
    const fillFloorRatio = 0.85;
    const ratio = overflowRatio > 0
      ? fillFloorRatio + overflowRatio * (1 - fillFloorRatio)
      : fillFraction * fillFloorRatio;
    const danger = Boolean(state.nearDanger) || ratio >= fillFloorRatio;
    return {
      active: true,
      modeKey: 'merge',
      ratio: Math.max(0, Math.min(1, ratio)),
      danger,
      critical: overflowRatio >= OVERFLOW_WARN_RATIO
    };
  }

  /** Static preview of the pending line: a dashed line plus tick marks on both walls, so it is not colour-only. */
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
  }

  /** Static pegs: a filled disc in the wall colour with an outline, so reduced motion keeps it. */
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
  }

  /**
   * Marks a special sphere with a symbol and a ring or body that a colour-blind player can
   * tell apart: a star on a rainbow ring (Joker), a snowflake on a frosted body (Ice), a spark
   * on a dark body with a fuse ring once lit (Bomb). Nothing here moves.
   */
  drawSpecialMark(ctx, engine, theme, ball, x, y) {
    const kind = ball.mergeKind;
    const radius = ball.radius;
    const look = this.getSpecialsConfig(engine).render;
    ctx.save();
    if (kind === MERGE_SPECIAL_KINDS.BOMB) {
      ctx.globalAlpha = look.bombAlpha;
      ctx.fillStyle = look.bombColor;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 1;
      const fuseSec = this.getSpecialTimerSec(engine, kind);
      if (Number.isFinite(ball.mergeSpecialSec) && fuseSec > 0) {
        const remaining = Math.max(0, Math.min(1, ball.mergeSpecialSec / fuseSec));
        const start = -Math.PI * MATH_CONSTANTS.HALF;
        ctx.strokeStyle = theme.dangerLineColor;
        ctx.lineWidth = look.ringWidth;
        ctx.beginPath();
        ctx.arc(x, y, radius + look.ringGap, start, start + remaining * MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
      }
    } else if (kind === MERGE_SPECIAL_KINDS.ICE) {
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
    } else if (kind === MERGE_SPECIAL_KINDS.JOKER) {
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
    ctx.font = `${Math.round(radius * look.glyphSizeFactor)}px ${look.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = look.glyphStrokeWidth;
    ctx.strokeStyle = look.glyphStroke;
    ctx.fillStyle = look.glyphFill;
    const glyph = t(`gameplay.merge.specials.${kind}.icon`);
    ctx.strokeText(glyph, x, y);
    ctx.fillText(glyph, x, y);
    ctx.restore();
  }

  /** Marks the loaded and the next sphere when they are special, above the launcher drawing. */
  drawLauncherOverlay(ctx, engine, renderer, theme) {
    const spec = this.getLauncherSpec(engine);
    if (engine.currentBall?.mergeKind) {
      this.drawSpecialMark(ctx, engine, theme, engine.currentBall, engine.mergeDropX ?? spec.x, spec.y);
    }
    if (engine.nextBall?.mergeKind) {
      this.drawSpecialMark(ctx, engine, theme, engine.nextBall, spec.x + spec.nextOffsetX, spec.y + spec.nextOffsetY);
    }
  }

  /**
   * Marks the special spheres on the board, then rings every sphere still under a polarity
   * pulse. Nothing moves, so reduced motion keeps it.
   */
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
}

export const mergeBehavior = new MergeBehavior();
registerModeBehavior(GAME_MODES.MERGE, mergeBehavior);
