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

export const DEFAULT_MODES_CONFIG = Object.freeze({
  hexGrid: Object.freeze({
    colsEven: 10,
    colsOdd: 9,
    topMargin: 58,
    sidePadding: 46,
    colSpacing: 42,
    rowHeight: 36,
    initialRows: 5,
    initialColorCount: 4,
    maxColorCount: 6,
    wavesPerExtraColor: 3,
    shotsPerDescentBase: 6,
    shotsPerDescentMin: 3,
    wavesPerCadenceDrop: 4,
    pulseRangeCells: 2,
    pulseBonusPoints: 35,
    waveClearBonus: 250,
    nearMissRowsFromDanger: 1,
    aimPreviewAlpha: 0.48,
    cellGuideAlpha: 0.08
  }),
  orbital: Object.freeze({
    coreX: 235,
    coreY: 360,
    launcherY: 745,
    dangerRadius: 204,
    nearMissRadius: 172,
    initialRings: 2,
    maxSpawnRings: 4,
    ringSpacing: 36,
    initialColorCount: 4,
    maxColorCount: 6,
    wavesPerExtraColor: 2,
    shotsPerRingWave: 6,
    shotsPerRingMin: 4,
    wavesPerCadenceDrop: 4,
    impactTorqueScale: 0.00055,
    maxAngularVelocity: 0.095,
    angularDamping: 0.985,
    baseMomentOfInertia: 18000,
    ballInertiaScale: 1.0,
    radialDriftSpeed: 250,
    radialDriftAccel: 340,
    collectorArcCount: 4,
    collectorArcSpanRad: 0.72,
    collectorCatchThickness: 26,
    collectorBonusPoints: 60,
    collectorOverchargeGain: 6,
    waveClearBonus: 300
  }),
  pinball: Object.freeze({
    launcherX: 235,
    launcherY: 66,
    minAimAngleRad: 0.18,
    maxAimAngleRad: 2.961592653589793,
    defaultAimAngleRad: 1.5707963267948966,
    nextOffsetX: -68,
    nextOffsetY: 6,
    cancelAboveOffset: 18,
    launchSpeed: 12.5,
    projectileGravityPerStep: 0.22,
    pegRadius: 15,
    pegRestitution: 0.84,
    pegHitCooldownSec: 0.06,
    pegHitPoints: 25,
    corePegPoints: 120,
    stageClearBonusBase: 400,
    stageClearShotBonus: 100,
    startingShots: 10,
    stageRefillShots: 5,
    maxShotsCap: 16,
    initialPegCount: 22,
    pegsPerStage: 2,
    maxPegCount: 34,
    initialCorePegs: 6,
    corePegsPerStage: 1,
    maxCorePegs: 14,
    pegFieldTopY: 164,
    pegFieldBottomY: 600,
    pegFieldMarginX: 48,
    pegMinSpacing: 48,
    bumperStartStage: 2,
    maxBumpers: 3,
    bucketY: 744,
    bucketWidth: 104,
    bucketHeight: 22,
    bucketSpeed: 155,
    bucketMarginX: 62,
    bucketCatchBonus: 150,
    floorOutY: 792,
    stallSpeedThreshold: 24,
    stallMaxSeconds: 1.1,
    maxFlightSeconds: 11
  }),
  convoy: Object.freeze({
    turretX: 235,
    turretY: 400,
    nextOffsetX: -36,
    nextOffsetY: 36,
    cancelRadius: 28,
    vortexRadius: 26,
    nearMissProgress: 0.85,
    lutSamples: 360,
    ballSpacing: 40,
    baseAdvanceSpeed: 38,
    speedPerWave: 4.5,
    maxAdvanceSpeed: 88,
    entryBoostLength: 140,
    entryBoostMultiplier: 2.6,
    recoilAcceleration: 920,
    maxRecoilSpeed: 460,
    snapbackBonusPoints: 140,
    freezeDurationSec: 5.5,
    freezeSpeedFactor: 0.12,
    initialWaveSpheres: 18,
    spheresPerWave: 4,
    maxWaveSpheres: 46,
    initialColorCount: 4,
    maxColorCount: 6,
    wavesPerExtraColor: 2,
    waveClearBonus: 350,
    tracks: Object.freeze(['spiral', 'serpent', 'figure8', 'orbitLoop'])
  }),
  merge: Object.freeze({
    shake: null,
    launcherY: 82,
    dropStepPx: 14,
    nextOffsetX: 156,
    nextOffsetY: 0,
    basinLeftX: 28,
    basinRightX: 442,
    basinFloorY: 748,
    overflowLineY: 158,
    overflowGraceSec: 1.6,
    nearMissBufferPx: 44,
    dropCooldownSec: 0.38,
    gravity: 920,
    tiltAcceleration: 260,
    wallRestitution: 0.24,
    floorRestitution: 0.18,
    ballRestitution: 0.22,
    linearDamping: 0.992,
    floorFriction: 0.92,
    solverIterations: 6,
    shockwaveRadiusFactor: 3.2,
    shockwaveImpulse: 165,
    polarityBiasRange: 150,
    polarityBiasAcceleration: 210,
    polarityWindowSec: 1.4,
    polarityPulseAcceleration: 2500,
    polarityPulseSec: 0.65,
    spawnMaxTierIndex: 4,
    supernovaBonus: 4000,
    supernovaShockwaveImpulse: 340,
    chain: Object.freeze({ shakeAdvanceAt: 3 }),
    pressure: Object.freeze({
      fromFusedTier: 6,
      pxPerTier: 15,
      topTier: 11,
      topTierStepDrops: 35,
      pxPerStep: 15,
      maxOffsetPx: 240,
      warnDrops: 3,
      holdMaxDrops: 3,
      stepGraceFactor: 2,
      entryGraceMaxSec: 2.5,
      shakeGraceSec: 2,
      settledSpeedPxPerSec: 30
    }),
    eventTextOffsetY: 56,
    events: Object.freeze({
      gapMinDrops: 9,
      gapMaxDrops: 14,
      durationDrops: 6,
      pool: Object.freeze({
        wind: Object.freeze({ acceleration: 260 }),
        lowGravity: Object.freeze({ gravityFactor: 0.45 }),
        bouncy: Object.freeze({ restitution: 0.6 }),
        bigDrops: Object.freeze({ spawnMaxTierIndex: 6 }),
        golden: Object.freeze({ pointsFactor: 1.5 })
      })
    }),
    tiers: Object.freeze([
      Object.freeze({
        id: 'merge_t0',
        tier: 0,
        radius: 14,
        fill: '#38bdf8',
        highlight: '#bae6fd',
        shadow: '#0369a1',
        glow: 'rgba(56, 189, 248, 0.55)',
        pattern: 'dots',
        symbol: '1',
        polarity: 1,
        points: 10
      }),
      Object.freeze({
        id: 'merge_t1',
        tier: 1,
        radius: 18,
        fill: '#34d399',
        highlight: '#a7f3d0',
        shadow: '#047857',
        glow: 'rgba(52, 211, 153, 0.55)',
        pattern: 'stripesH',
        symbol: '2',
        polarity: -1,
        points: 25
      }),
      Object.freeze({
        id: 'merge_t2',
        tier: 2,
        radius: 22,
        fill: '#facc15',
        highlight: '#fef08a',
        shadow: '#a16207',
        glow: 'rgba(250, 204, 21, 0.55)',
        pattern: 'rings',
        symbol: '3',
        polarity: 1,
        points: 50
      }),
      Object.freeze({
        id: 'merge_t3',
        tier: 3,
        radius: 27,
        fill: '#fb923c',
        highlight: '#fed7aa',
        shadow: '#c2410c',
        glow: 'rgba(251, 146, 60, 0.55)',
        pattern: 'grid',
        symbol: '4',
        polarity: -1,
        points: 90
      }),
      Object.freeze({
        id: 'merge_t4',
        tier: 4,
        radius: 32,
        fill: '#f87171',
        highlight: '#fecaca',
        shadow: '#b91c1c',
        glow: 'rgba(248, 113, 113, 0.55)',
        pattern: 'stripesD',
        symbol: '5',
        polarity: 1,
        points: 150
      }),
      Object.freeze({
        id: 'merge_t5',
        tier: 5,
        radius: 37,
        fill: '#e879f9',
        highlight: '#f5d0fe',
        shadow: '#a21caf',
        glow: 'rgba(232, 121, 249, 0.55)',
        pattern: 'stripesV',
        symbol: '6',
        polarity: -1,
        points: 240
      }),
      Object.freeze({
        id: 'merge_t6',
        tier: 6,
        radius: 42,
        fill: '#818cf8',
        highlight: '#c7d2fe',
        shadow: '#4338ca',
        glow: 'rgba(129, 140, 248, 0.55)',
        pattern: 'dots',
        symbol: '7',
        polarity: 1,
        points: 370
      }),
      Object.freeze({
        id: 'merge_t7',
        tier: 7,
        radius: 48,
        fill: '#2dd4bf',
        highlight: '#99f6e4',
        shadow: '#0f766e',
        glow: 'rgba(45, 212, 191, 0.55)',
        pattern: 'stripesH',
        symbol: '8',
        polarity: -1,
        points: 550
      }),
      Object.freeze({
        id: 'merge_t8',
        tier: 8,
        radius: 54,
        fill: '#fbbf24',
        highlight: '#fde68a',
        shadow: '#b45309',
        glow: 'rgba(251, 191, 36, 0.55)',
        pattern: 'rings',
        symbol: '9',
        polarity: 1,
        points: 800
      }),
      Object.freeze({
        id: 'merge_t9',
        tier: 9,
        radius: 60,
        fill: '#f43f5e',
        highlight: '#fecdd3',
        shadow: '#9f1239',
        glow: 'rgba(244, 63, 94, 0.55)',
        pattern: 'grid',
        symbol: '10',
        polarity: -1,
        points: 1200
      }),
      Object.freeze({
        id: 'merge_t10',
        tier: 10,
        radius: 66,
        fill: '#a3e635',
        highlight: '#d9f99d',
        shadow: '#4d7c0f',
        glow: 'rgba(163, 230, 53, 0.55)',
        pattern: 'stripesD',
        symbol: '11',
        polarity: 1,
        points: 1700
      }),
      Object.freeze({
        id: 'merge_t11',
        tier: 11,
        radius: 72,
        fill: '#94a3b8',
        highlight: '#cbd5e1',
        shadow: '#334155',
        glow: 'rgba(148, 163, 184, 0.55)',
        pattern: 'stripesV',
        symbol: '12',
        polarity: -1,
        points: 2400
      })
    ])
  })
});

/**
 * Merge Basin events over their defaults, entry by entry, so a partial config never leaves
 * a missing field behind: each pool entry keeps its default numbers.
 */
function resolveMergeEvents(partial) {
  const defaults = DEFAULT_MODES_CONFIG.merge.events;
  const source = partial && typeof partial === 'object' ? partial : {};
  const poolSource = source.pool && typeof source.pool === 'object' ? source.pool : defaults.pool;
  const pool = {};
  for (const [id, entry] of Object.entries(poolSource)) {
    pool[id] = { ...(defaults.pool[id] ?? {}), ...(entry && typeof entry === 'object' ? entry : {}) };
  }
  return { ...defaults, ...source, pool };
}

export function resolveModesConfig(modesConfig) {
  if (!modesConfig || typeof modesConfig !== 'object') {
    return DEFAULT_MODES_CONFIG;
  }
  return {
    hexGrid: { ...DEFAULT_MODES_CONFIG.hexGrid, ...(modesConfig.hexGrid ?? {}) },
    orbital: { ...DEFAULT_MODES_CONFIG.orbital, ...(modesConfig.orbital ?? {}) },
    pinball: { ...DEFAULT_MODES_CONFIG.pinball, ...(modesConfig.pinball ?? {}) },
    convoy: { ...DEFAULT_MODES_CONFIG.convoy, ...(modesConfig.convoy ?? {}) },
    merge: {
      ...DEFAULT_MODES_CONFIG.merge,
      ...(modesConfig.merge ?? {}),
      chain: { ...DEFAULT_MODES_CONFIG.merge.chain, ...(modesConfig.merge?.chain ?? {}) },
      pressure: { ...DEFAULT_MODES_CONFIG.merge.pressure, ...(modesConfig.merge?.pressure ?? {}) },
      events: resolveMergeEvents(modesConfig.merge?.events),
      tiers: Array.isArray(modesConfig.merge?.tiers) && modesConfig.merge.tiers.length > 0
        ? modesConfig.merge.tiers
        : DEFAULT_MODES_CONFIG.merge.tiers
    }
  };
}
