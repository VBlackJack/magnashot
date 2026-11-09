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

import { CLUSTER_MODIFIERS, GAME_MODES, GAME_STATES, SPECIAL_TYPES_ORDER, WAVE_TYPES } from '../core/Constants.js';
import { Ball } from '../entities/Ball.js';
import { normalizeShotTimeline } from './ShotTimeline.js';
import { getSagSpec } from './SagMeter.js';

/** Shape of a week key such as "2026-W45". */
const WEEK_KEY_PATTERN = /^\d{4}-W\d{2}$/;

/** Sentinel stored in place of an obstacle index when a ball has no pivot. */
const NO_PIVOT_INDEX = -1;

/** Engine scalars copied verbatim between the engine and a snapshot. */
const ENGINE_SCALAR_FIELDS = [
  'currentLevelId',
  'score',
  'combo',
  'maxComboInRound',
  'runCoinsEarned',
  'overcharge',
  'shotsRemaining',
  'waveCount',
  'endlessRowParity',
  'sagLevel',
  'railDrops',
  'classicRailDropsTotal',
  'classicStage',
  'freezeTurnsRemaining',
  'isCoreFreezeApplied',
  'chainCooldown',
  'outOfShotsGraceFrames',
  'hasFiredInRound',
  'hasUsedContinue',
  'bossesDestroyedInRun',
  'activeDiscoveryId',
  'discoveryTurnCount',
  'isPolarityFlipped',
  'stashedRegularColorId',
  'launcherDrawIndex',
  'specialGrantIndex',
  'specialAmmoBoughtInRun',
  'aimAngle',
  'fluxSeed',
  'fluxStage',
  'fluxPreviousFamily',
  'isSharedFluxRun',
  'currentObjective',
  'targetCoreCount',
  'rescuedCores',
  'currentPuzzleStage',
  'blitzFramesRemaining',
  'blitzWaveTimerFrames',
  'blitzIdleFrames',
  'bossRushWave',
  'cascadeWave',
  'cascadeTurnsUntilDrop'
];

/** Ball fields copied verbatim; identity, bonds and the pivot link are handled separately. */
const BALL_SCALAR_FIELDS = [
  'x',
  'y',
  'prevX',
  'prevY',
  'vx',
  'vy',
  'radius',
  'colorId',
  'specialType',
  'clusterModifier',
  'armorHits',
  'isAnchor',
  'anchorX',
  'anchorY',
  'isFrozen',
  'pivotRadius',
  'pivotAngle',
  'railMinX',
  'railMaxX'
];

/** Obstacle fields that change during play; the rest is rebuilt from the level definition. */
const OBSTACLE_MOTION_FIELDS = [
  'x',
  'y',
  'prevX',
  'prevY',
  'baseX',
  'baseY',
  'angle',
  'prevAngle',
  'angularVelocity',
  'motorAngularSpeed',
  'oscillatePhase',
  'disabled'
];

// Fields absent from the source are left alone, so a run saved before a field existed
// keeps the target's own value for it.
const copyFields = (target, source, fields) => {
  for (const field of fields) {
    if (source[field] !== undefined) {
      target[field] = source[field];
    }
  }
};

/** Primitive types a field may take when the live object currently holds null. */
const NULLABLE_FIELD_TYPES = new Set(['string', 'number', 'boolean']);

/**
 * True when a saved value can replace the live one: same primitive type (a finite number
 * for numbers), any primitive or null where the live field is currently empty, or null
 * over text (text fields are optional keys, such as a dismissed discovery hint).
 */
const isCompatibleValue = (current, saved) => {
  if (typeof saved === 'number' && !Number.isFinite(saved)) {
    return false;
  }
  if (current === null || current === undefined) {
    return saved === null || NULLABLE_FIELD_TYPES.has(typeof saved);
  }
  if (saved === null) {
    return typeof current === 'string';
  }
  return typeof saved === typeof current;
};

const FAIRNESS_COUNTER_FIELDS = ['launcherDrawIndex', 'specialGrantIndex', 'specialAmmoBoughtInRun'];

/**
 * Copies saved fields onto a live object and throws on a value of the wrong type, so a
 * snapshot that still parses but holds, say, a text score is discarded instead of being
 * concatenated into the run.
 */
const restoreFields = (target, source, fields) => {
  for (const field of fields) {
    if (source[field] === undefined) {
      continue;
    }
    if (!isCompatibleValue(target[field], source[field])) {
      throw new TypeError(`Saved run field ${field} has an unexpected value`);
    }
    target[field] = source[field];
  }
};

const WAVE_TYPE_VALUES = new Set(Object.values(WAVE_TYPES));

/** First wave a survival run spawns: wave 1 is the starting board, not a logged wave. */
const FIRST_SPAWNED_WAVE = 2;

/**
 * The saved wave log when it is a list of known wave kinds; otherwise (a run saved before
 * the log existed, or a damaged one) the log is rebuilt from the wave count, since a wave's
 * kind depends on its number alone.
 */
const restoreWaveLog = (engine, savedLog) => {
  if (Array.isArray(savedLog) && savedLog.every((type) => WAVE_TYPE_VALUES.has(type))) {
    return [...savedLog];
  }
  const rebuilt = [];
  for (let wave = FIRST_SPAWNED_WAVE; wave <= engine.waveCount; wave++) {
    rebuilt.push(engine.getWaveType(wave));
  }
  return rebuilt;
};

/**
 * The saved Flux perk stacks reduced to known perks with a whole stack count inside
 * [0, maxStacks]; anything else is dropped rather than rejecting the run.
 */
const restoreFluxPerks = (engine, savedPerks) => {
  const catalog = engine.fluxConfig.perks?.catalog || {};
  const restored = {};
  if (!savedPerks || typeof savedPerks !== 'object') {
    return restored;
  }
  for (const [id, stacks] of Object.entries(savedPerks)) {
    if (Object.hasOwn(catalog, id) && Number.isFinite(stacks)) {
      const clamped = Math.min(Math.max(Math.trunc(stacks), 0), catalog[id].maxStacks);
      if (clamped > 0) {
        restored[id] = clamped;
      }
    }
  }
  return restored;
};

/**
 * The saved Flux perk offer when it lists 1..offerSize distinct known perks that are not
 * at their cap; null otherwise (no offer pending, or a damaged one).
 */
const restoreFluxPerkOffer = (engine, savedOffer) => {
  const perksCfg = engine.fluxConfig.perks;
  if (!perksCfg || !Array.isArray(savedOffer)) {
    return null;
  }
  const isUsable =
    savedOffer.length >= 1 &&
    savedOffer.length <= perksCfg.offerSize &&
    new Set(savedOffer).size === savedOffer.length &&
    savedOffer.every((id) => Object.hasOwn(perksCfg.catalog, id) && engine.getFluxPerkStacks(id) < perksCfg.catalog[id].maxStacks);
  return isUsable ? [...savedOffer] : null;
};

const pickFields = (source, fields) => {
  const out = {};
  copyFields(out, source, fields);
  return out;
};

/**
 * True when the run can be captured without losing anything: a run is in progress,
 * no projectile is in flight, no Boss Rush wave is waiting for it and no Flux shape is being
 * replaced. Falling avalanche balls are not serialized and still pay score and overcharge when they reach the
 * collector bin or a singularity, so they do not block a capture: the engine stores the
 * run again once the last one is gone.
 * @param {import('./GameEngine.js').GameEngine} engine
 */
export function isRunSnapshotable(engine) {
  const isRunActive = engine.state === GAME_STATES.PLAYING || engine.state === GAME_STATES.PAUSED;
  return (
    isRunActive &&
    !engine.physicsWorld.projectile &&
    !(engine.stageTransitionFrames > 0) &&
    !engine.pendingBossRushWave &&
    Boolean(engine.currentBall) &&
    Boolean(engine.nextBall)
  );
}

/**
 * Serializes the run into a JSON-safe object, or returns null when the run is not
 * in a capturable state (see isRunSnapshotable).
 * @param {import('./GameEngine.js').GameEngine} engine
 * @param {number} version - Snapshot format version written into the result.
 * @returns {object|null}
 */
export function captureRunSnapshot(engine, version) {
  if (!isRunSnapshotable(engine)) {
    return null;
  }
  const world = engine.physicsWorld;
  const obstacleIndex = new Map(world.obstacles.map((obs, idx) => [obs, idx]));

  return {
    version,
    mode: engine.mode,
    dailySeedKey: engine.dailySeedKey,
    rngState: engine.seededRng ? engine.seededRng.state : null,
    upcomingColorIds: [...engine.upcomingColorIds],
    engine: pickFields(engine, ENGINE_SCALAR_FIELDS),
    specialInventory: { ...engine.specialInventory },
    waveLog: [...engine.waveLog],
    discoveryShownIds: [...engine.discoveryShownIds],
    fluxPerks: { ...engine.fluxPerks },
    fluxPerkOffer: engine.fluxPerkOffer ? [...engine.fluxPerkOffer] : null,
    // The record the run started against, so a reloaded run does not compare with itself.
    runBestBaseline: engine.getRunBestBaseline?.() ?? null,
    // Optional fields: runs saved before weekly Flux and shot timelines hold neither.
    isWeeklyFluxRun: Boolean(engine.isWeeklyFluxRun),
    weeklyWeekKey: engine.weeklyWeekKey ?? null,
    // Optional, Flux only: the shape generation the run was built with. A run saved before the
    // settled shapes holds none and resumes on the shapes it was saved on.
    ...(engine.mode === GAME_MODES.FLUX ? { fluxContentVersion: engine.fluxContentVersion } : {}),
    shotTimeline: engine.shotTimeline
      ? { ...engine.shotTimeline, s: [...engine.shotTimeline.s], b: [...engine.shotTimeline.b] }
      : null,
    // Optional: the Ghost Duel being raced (encoded, re-decoded on restore) and the Daily rematch flag.
    ghostDuelCode: engine.encodeGhostDuel?.() ?? null,
    isDailyRematch: Boolean(engine.isDailyRematch),
    // Optional: the Magnetar schedule (a run saved before Magnetars, or with a Boss Core, holds none).
    magnetar: engine.getMagnetarSnapshot?.() ?? null,
    currentBall: { colorId: engine.currentBall.colorId, specialType: engine.currentBall.specialType },
    nextBall: { colorId: engine.nextBall.colorId, specialType: engine.nextBall.specialType },
    allowTensionBreak: world.allowTensionBreak,
    pendingChainCandidateIds: Array.from(world.pendingChainCandidateIds),
    obstacles: world.obstacles.map((obs) => ({ type: obs.type, ...pickFields(obs, OBSTACLE_MOTION_FIELDS) })),
    balls: world.balls.map((ball) => ({
      id: ball.id,
      ...pickFields(ball, BALL_SCALAR_FIELDS),
      bonds: Array.from(ball.bonds),
      tethers: Array.from(ball.tethers),
      pivotIndex: ball.pivotRef && obstacleIndex.has(ball.pivotRef) ? obstacleIndex.get(ball.pivotRef) : NO_PIVOT_INDEX
    }))
  };
}

/**
 * Structural check run before any engine state is touched, so a corrupted or
 * outdated snapshot is rejected instead of half-applied.
 * @param {*} snapshot
 * @param {number} version - Snapshot format version this build understands.
 * @returns {boolean}
 */
export function isValidRunSnapshot(snapshot, version) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== version) {
    return false;
  }
  if (!Object.values(GAME_MODES).includes(snapshot.mode)) {
    return false;
  }
  if (snapshot.mode === GAME_MODES.DAILY && typeof snapshot.dailySeedKey !== 'string') {
    return false;
  }
  if (
    snapshot.mode === GAME_MODES.FLUX &&
    (typeof snapshot.engine?.fluxSeed !== 'string' || !Number.isInteger(snapshot.engine.fluxStage) || snapshot.engine.fluxStage < 1)
  ) {
    return false;
  }
  return (
    Array.isArray(snapshot.balls) &&
    snapshot.balls.length > 0 &&
    Array.isArray(snapshot.obstacles) &&
    Array.isArray(snapshot.pendingChainCandidateIds) &&
    Boolean(snapshot.engine && typeof snapshot.engine === 'object') &&
    Boolean(snapshot.specialInventory && typeof snapshot.specialInventory === 'object') &&
    Boolean(snapshot.currentBall && snapshot.nextBall)
  );
}

/**
 * Validates a saved special inventory: only known special types, each a non-negative
 * finite integer. Any other shape keeps the inventory the mode start produced.
 * @param {Object<string, number>} fallback - Inventory to keep when the saved one is damaged.
 * @param {*} saved - Saved inventory.
 * @returns {Object<string, number>}
 */
function restoreSpecialInventory(fallback, saved) {
  const known = new Set(SPECIAL_TYPES_ORDER);
  const entries = saved && typeof saved === 'object' && !Array.isArray(saved) ? Object.entries(saved) : null;
  const isValid =
    entries !== null &&
    entries.every(([type, count]) => known.has(type) && Number.isInteger(count) && count >= 0);
  return isValid ? { ...saved } : { ...fallback };
}

/**
 * A run saved before the Sag meter counted waves down with `shotsUntilWave`; the meter counts
 * up, so the saved countdown maps to the matching fill level.
 * @param {import('./GameEngine.js').GameEngine} engine
 * @param {object} snapshot
 */
function restoreLegacySagLevel(engine, snapshot) {
  const saved = snapshot.engine;
  if (Number.isFinite(saved.sagLevel) || !Number.isFinite(saved.shotsUntilWave)) {
    return;
  }
  const spec = getSagSpec(engine.mode, engine.gameConfig.sag, engine.gameConfig.endless);
  if (!spec) {
    return;
  }
  engine.sagLevel = Math.max(0, Math.min(spec.size - 1, spec.size - Math.floor(saved.shotsUntilWave)));
}

/**
 * Rebuilds the board of the snapshot's mode (obstacles, palette, mutators), then
 * replaces its balls and live state with the saved ones. The run resumes paused.
 * @param {import('./GameEngine.js').GameEngine} engine
 * @param {object} snapshot - A snapshot accepted by isValidRunSnapshot.
 * @returns {boolean} False when the rebuilt board does not match the snapshot; the
 *   freshly started run is then left in place.
 */
export function applyRunSnapshot(engine, snapshot) {
  if (snapshot.mode === GAME_MODES.CAMPAIGN) {
    engine.startCampaignLevel(snapshot.engine.currentLevelId);
  } else if (snapshot.mode === GAME_MODES.DAILY) {
    engine.startDailyChallenge(snapshot.dailySeedKey, true);
  } else if (snapshot.mode === GAME_MODES.FLUX) {
    // A save without a version predates the settled shapes: it resumes on the shapes it was saved on.
    const savedVersion = snapshot.fluxContentVersion;
    const currentVersion = engine.gameConfig.ghostDuel.contentVersion.flux;
    const contentVersion = Number.isInteger(savedVersion) && savedVersion >= 1 && savedVersion <= currentVersion
      ? savedVersion
      : engine.fluxConfig.shapeSettle.sinceContentVersion - 1;
    engine.restoreFluxRun(
      snapshot.engine.fluxSeed,
      snapshot.engine.fluxStage,
      snapshot.engine.fluxPreviousFamily,
      contentVersion
    );
  } else if (snapshot.mode === GAME_MODES.PUZZLE) {
    engine.startPuzzleMode(snapshot.engine.currentPuzzleStage || 1);
  } else if (snapshot.mode === GAME_MODES.BLITZ) {
    engine.startBlitzMode();
  } else if (snapshot.mode === GAME_MODES.BOSS_RUSH) {
    engine.startBossRushMode(snapshot.engine.bossRushWave || 1);
  } else if (snapshot.mode === GAME_MODES.CASCADE) {
    engine.startCascadeMode();
  } else if (snapshot.mode === GAME_MODES.CLASSIC) {
    engine.startClassicMode(snapshot.engine.classicStage || 1);
  } else {
    engine.startEndlessMode();
  }

  const world = engine.physicsWorld;
  const typesMatch = snapshot.obstacles.every((obs, idx) => world.obstacles[idx]?.type === obs.type);
  if (world.obstacles.length !== snapshot.obstacles.length || !typesMatch) {
    return false;
  }

  snapshot.obstacles.forEach((saved, idx) => {
    restoreFields(world.obstacles[idx], saved, OBSTACLE_MOTION_FIELDS);
  });

  for (const ball of [...world.balls]) {
    world.removeBall(ball);
  }
  world.spatialGrid.clear();

  const newIdBySavedId = new Map();
  const restored = snapshot.balls.map((saved) => {
    // Built from neutral values, not the saved ones, so restoreFields checks every saved
    // field (a text position included) against a value of the right type.
    const ball = new Ball({ x: 0, y: 0, radius: engine.physicsConfig.ball.radius, colorId: null });
    restoreFields(ball, saved, BALL_SCALAR_FIELDS);
    ball.pivotRef = saved.pivotIndex === NO_PIVOT_INDEX ? null : world.obstacles[saved.pivotIndex] || null;
    newIdBySavedId.set(saved.id, ball.id);
    world.addBall(ball);
    return ball;
  });

  snapshot.balls.forEach((saved, idx) => {
    for (const savedNeighborId of Array.isArray(saved.bonds) ? saved.bonds : []) {
      const neighborId = newIdBySavedId.get(savedNeighborId);
      if (neighborId !== undefined) {
        restored[idx].bonds.add(neighborId);
      }
    }
    // Runs saved before tethers existed have none to restore.
    for (const savedNeighborId of saved.tethers || []) {
      const neighborId = newIdBySavedId.get(savedNeighborId);
      if (neighborId !== undefined && restored[idx].bonds.has(neighborId)) {
        restored[idx].tethers.add(neighborId);
      }
    }
  });

  for (const savedId of snapshot.pendingChainCandidateIds) {
    const newId = newIdBySavedId.get(savedId);
    if (newId !== undefined) {
      world.pendingChainCandidateIds.add(newId);
    }
  }
  world.allowTensionBreak = Boolean(snapshot.allowTensionBreak);

  // The mode start built a fresh Magnetar; the restored board decides whether it stays. A
  // Boss Core board (a run saved before Magnetars) has none, and a missing saved schedule
  // leaves the fresh one at step 0.
  const restoredMagnetar = restored.find((ball) => ball.clusterModifier === CLUSTER_MODIFIERS.MAGNETAR);
  if (restoredMagnetar && engine.magnetar) {
    engine.restoreMagnetar(snapshot.magnetar, restoredMagnetar.id);
  } else {
    engine.clearMagnetar();
  }

  // A run saved before the fairness counters existed restores them at their reset value.
  for (const field of FAIRNESS_COUNTER_FIELDS) {
    engine[field] = 0;
  }
  restoreFields(engine, snapshot.engine, ENGINE_SCALAR_FIELDS);
  restoreLegacySagLevel(engine, snapshot);
  engine.specialInventory = restoreSpecialInventory(engine.specialInventory, snapshot.specialInventory);
  engine.waveLog = restoreWaveLog(engine, snapshot.waveLog);
  // Optional: a run saved before hints could run out holds none, and a damaged list is dropped.
  engine.discoveryShownIds = new Set(
    Array.isArray(snapshot.discoveryShownIds)
      ? snapshot.discoveryShownIds.filter((id) => typeof id === 'string')
      : []
  );
  // Set after the mode restart above, which wipes both; runs saved before perks existed hold neither.
  if (snapshot.mode === GAME_MODES.FLUX) {
    engine.fluxPerks = restoreFluxPerks(engine, snapshot.fluxPerks);
    engine.fluxPerkOffer = restoreFluxPerkOffer(engine, snapshot.fluxPerkOffer);
  }
  // Optional: the weekly flag and its week key are those captured when the run started.
  const isWeekly = snapshot.mode === GAME_MODES.FLUX
    && snapshot.isWeeklyFluxRun === true
    && typeof snapshot.weeklyWeekKey === 'string'
    && WEEK_KEY_PATTERN.test(snapshot.weeklyWeekKey);
  engine.isWeeklyFluxRun = isWeekly;
  engine.weeklyWeekKey = isWeekly ? snapshot.weeklyWeekKey : null;
  engine.runBestBaseline = null;
  // Optional: a run saved before timelines existed (or a damaged one) restarts with an empty one.
  const hasTimeline = snapshot.mode === GAME_MODES.DAILY || snapshot.mode === GAME_MODES.FLUX;
  engine.shotTimeline = hasTimeline ? normalizeShotTimeline(snapshot.shotTimeline, engine.gameConfig.shotTimeline) : null;
  // Optional: a Daily rematch stays a rematch, and the ghost saved with the run is raced again.
  engine.isDailyRematch = snapshot.mode === GAME_MODES.DAILY && snapshot.isDailyRematch === true;
  engine.ghostDuel = null;
  engine.restoreGhostDuel?.(snapshot.ghostDuelCode);
  // Optional: a run saved before the baseline existed (or a damaged one) re-reads the record.
  engine.restoreRunBestBaseline(snapshot.runBestBaseline);
  if (engine.seededRng && Number.isFinite(snapshot.rngState)) {
    engine.seededRng.state = snapshot.rngState;
  }
  engine.currentBall = engine.createRandomLauncherBall(snapshot.currentBall.specialType, snapshot.currentBall.colorId);
  engine.nextBall = engine.createRandomLauncherBall(snapshot.nextBall.specialType, snapshot.nextBall.colorId);
  // Runs saved before the queue existed, or with a damaged one, get a fresh queue.
  const savedQueue = snapshot.upcomingColorIds;
  const isValidQueue = Array.isArray(savedQueue) && savedQueue.every((color) => engine.activePalette.includes(color));
  engine.upcomingColorIds = isValidQueue ? [...savedQueue] : [];
  if (snapshot.mode === GAME_MODES.PUZZLE) {
    // The mode start rebuilt the full scripted queue: its tail matching the saved colors
    // keeps the special types; otherwise the saved colors stand alone.
    const rebuilt = engine.puzzleQueue.slice(Math.max(0, engine.puzzleQueue.length - engine.upcomingColorIds.length));
    const tailMatches =
      rebuilt.length === engine.upcomingColorIds.length &&
      rebuilt.every((spec, idx) => (spec.colorId || engine.activePalette[0]) === engine.upcomingColorIds[idx]);
    engine.puzzleQueue = tailMatches
      ? rebuilt
      : engine.upcomingColorIds.map((colorId) => ({ colorId, specialType: null }));
  } else {
    engine.fillUpcomingColors();
  }
  engine.state = GAME_STATES.PAUSED;
  world.aimCacheValid = false;
  engine.updateAimFromAngle(engine.aimAngle);
  return true;
}
