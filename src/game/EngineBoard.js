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
  GAME_STATES,
  OBSTACLE_TYPES,
  CLUSTER_MODIFIERS,
  DAILY_MUTATORS,
  MATH_CONSTANTS
} from '../core/Constants.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { Obstacle } from '../entities/Obstacle.js';
import {
  generateLayout,
  NO_PIVOT_SLOT
} from './layouts/LayoutGenerators.js';
import { shiftSpecX } from '../core/WorldGeometry.js';

/** Methods of GameEngine that belong to this domain, installed on its prototype. */
export const engineBoardMethods = {
  initSurvivalRun(mode, seed = null) {
    const endlessCfg = this.gameConfig.endless;
    const dailyCfg = this.gameConfig.daily;
    this.resetRunState(mode);
    this.dailySeedKey = mode === GAME_MODES.DAILY ? seed : null;
    this.seededRng = seed ? new SeededRandom(seed) : null;
    this.waveCount = 1;
    this.endlessRowParity = 0;
    this.shotsUntilWave = endlessCfg.shotsBeforeWave;
    this.specialInventory = { ...endlessCfg.initialSpecialCounts };

    this.activePalette = this.ballsConfig.standardColors
      .slice(0, endlessCfg.paletteCount)
      .map((c) => c.id);

    this.audioManager.stopAll();
    this.physicsWorld.clear();
    this.particleSystem.clear();

    let rotorMult = 1.0;
    if (mode === GAME_MODES.DAILY && dailyCfg.mutators) {
      const mutatorKeys = Object.keys(dailyCfg.mutators);
      if (mutatorKeys.length > 0) {
        this.activeMutatorKey = mutatorKeys[Math.floor(this.random() * mutatorKeys.length)];
        const mutSpec = dailyCfg.mutators[this.activeMutatorKey];
        if (mutSpec.clusterGravityMultiplier) {
          this.physicsWorld.gravityMultiplier = mutSpec.clusterGravityMultiplier;
        }
        if (mutSpec.magnetismMultiplier) {
          this.physicsWorld.magnetismMultiplier = mutSpec.magnetismMultiplier;
        }
        if (mutSpec.rotorSpeedMultiplier) {
          rotorMult = mutSpec.rotorSpeedMultiplier;
          this.physicsWorld.rotorSpeedMultiplier = rotorMult;
        }
      }
    }

    const r = this.physicsConfig.ball.radius;
    const initialBoardStream = mode === GAME_MODES.DAILY ? `${seed}:wave:${this.waveCount}` : null;
    this.withScopedRandom(initialBoardStream, () => {
      for (let row = 0; row < endlessCfg.initialRows; row++) {
        const y = endlessCfg.startY + row * endlessCfg.rowSpacingY;
        this.spawnEndlessRow(y, row % 2, row === 0, () => this.rollEndlessModifier());
      }
    });

    if (mode === GAME_MODES.DAILY) {
      const singMargin = r * dailyCfg.singularityMarginRadiusFactor;
      const singOffsetY = r * dailyCfg.singularityOffsetAboveDangerFactor;
      const leftSingularity = new Obstacle(
        { type: OBSTACLE_TYPES.SINGULARITY, x: singMargin, y: this.gameConfig.canvas.dangerLineY - singOffsetY },
        this.obstaclesConfig
      );
      const rightSingularity = new Obstacle(
        {
          type: OBSTACLE_TYPES.SINGULARITY,
          x: this.gameConfig.canvas.logicalWidth - singMargin,
          y: this.gameConfig.canvas.dangerLineY - singOffsetY
        },
        this.obstaclesConfig
      );
      const lastRowY = endlessCfg.startY + (endlessCfg.initialRows - 1) * endlessCfg.rowSpacingY;
      const pivotX = this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF;
      const pivotY = lastRowY + dailyCfg.pivotClearanceY;
      const basePivotSpeed = dailyCfg.pivotBaseAngularSpeed * rotorMult;
      const centralPivot = new Obstacle(
        {
          type: OBSTACLE_TYPES.PIVOT,
          x: pivotX,
          y: pivotY,
          angularSpeed: basePivotSpeed
        },
        this.obstaclesConfig
      );
      this.physicsWorld.obstacles.push(leftSingularity, rightSingularity, centralPivot);

      const mutSpec = dailyCfg.mutators?.[this.activeMutatorKey];
      if (mutSpec?.portalPair) {
        this.physicsWorld.obstacles.push(
          new Obstacle(
            {
              type: OBSTACLE_TYPES.PORTAL,
              x: pivotX - dailyCfg.portalOffsetX,
              y: pivotY + dailyCfg.portalEntryOffsetY,
              pairId: dailyCfg.portalPairId
            },
            this.obstaclesConfig
          ),
          new Obstacle(
            {
              type: OBSTACLE_TYPES.PORTAL,
              x: pivotX + dailyCfg.portalOffsetX,
              y: dailyCfg.portalExitY,
              pairId: dailyCfg.portalPairId
            },
            this.obstaclesConfig
          )
        );
      }
      if (mutSpec?.bumperPair) {
        this.physicsWorld.obstacles.push(
          new Obstacle(
            {
              type: OBSTACLE_TYPES.BUMPER,
              x: pivotX - dailyCfg.bumperOffsetX,
              y: pivotY + dailyCfg.bumperOffsetY
            },
            this.obstaclesConfig
          ),
          new Obstacle(
            {
              type: OBSTACLE_TYPES.BUMPER,
              x: pivotX + dailyCfg.bumperOffsetX,
              y: pivotY + dailyCfg.bumperOffsetY
            },
            this.obstaclesConfig
          )
        );
      }

      const ringCount = dailyCfg.pivotRingCount;
      const ringRadius = r * dailyCfg.pivotRingRadiusFactor;
      this.spawnConcentricRings(pivotX, pivotY, [{ radius: ringRadius, count: ringCount }], centralPivot, {});
    }

    this.physicsWorld.rebuildInitialBonds();
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.refreshDiscovery();
  },

  /**
   * Adds one staggered row of endless-grid balls, shared by the initial grid and incoming waves.
   * @param {number} y - Row center height.
   * @param {number} parity - Row stagger parity (0 or 1) selecting the half-radius offset.
   * @param {boolean} withAnchors - Whether the configured anchor columns become anchors.
   * @param {(col: number) => string|null} pickModifier - Modifier picker for non-anchor columns.
   * @returns {Array<import('../entities/Ball.js').Ball>} The balls created for the row.
   */
  spawnEndlessRow(y, parity, withAnchors, pickModifier) {
    const waveCfg = this.mode === GAME_MODES.BLITZ ? this.gameConfig.blitz : this.gameConfig.endless;
    const r = this.physicsConfig.ball.radius;
    const cols = waveCfg.columns;
    const spacingX = r * this.physicsConfig.simulation.bondRestDistanceFactor;
    const totalW = (cols - 1) * spacingX;
    const startX = (this.gameConfig.canvas.logicalWidth - totalW) * MATH_CONSTANTS.HALF;
    const rowOffset = parity * r * MATH_CONSTANTS.HALF;
    const rowBalls = [];
    for (let col = 0; col < cols; col++) {
      const isAnchor = withAnchors && waveCfg.anchorColumns.includes(col);
      const ball = this.createClusterBall({
        x: startX + col * spacingX + rowOffset,
        y,
        radius: r,
        colorId: this.pickPaletteColor(),
        clusterModifier: isAnchor ? null : pickModifier(col),
        isAnchor
      });
      this.physicsWorld.addBall(ball);
      rowBalls.push(ball);
    }
    return rowBalls;
  },

  rollModifier(weights) {
    const rand = this.random();
    let cumulative = 0;
    for (const [modKey, weight] of Object.entries(weights)) {
      cumulative += weight;
      if (rand < cumulative) {
        return modKey;
      }
    }
    return null;
  },

  rollEndlessModifier() {
    if (this.activeMutatorKey === DAILY_MUTATORS.VOLATILE_CLUSTER) {
      const extra = this.gameConfig.daily.mutators.volatileCluster.extraBombWeight;
      if (this.random() < extra) {
        return CLUSTER_MODIFIERS.DORMANT_BOMB;
      }
    } else if (this.activeMutatorKey === DAILY_MUTATORS.CRYO_SURGE) {
      const extra = this.gameConfig.daily.mutators.cryoSurge.extraCoreWeight;
      if (this.random() < extra) {
        return this.random() < MATH_CONSTANTS.HALF
          ? CLUSTER_MODIFIERS.FREEZE_CORE
          : CLUSTER_MODIFIERS.LIGHTNING_CORE;
      }
    }
    return this.rollModifier(this.gameConfig.endless.modifierWeights);
  },

  buildLevelLayout(layout, modifierWeights = {}, minModifierCounts = {}) {
    const spec = shiftSpecX(generateLayout(layout), this.gameConfig.canvas.contentOffsetX);
    this.materializeLayout(spec, modifierWeights, minModifierCounts);
  },

  /**
   * Creates the balls and structural bonds of a layout spec (see LayoutGenerators.js).
   * Pivot slots resolve against the board's pivot obstacles in obstacle order; a slot
   * without a pivot leaves the anchor fixed in place.
   * @param {{balls: object[], bonds: number[][]}} spec - Layout spec, in creation order.
   * @param {Object<string, number>} modifierWeights - Cluster modifier roll weights.
   * @param {Object<string, number>} minModifierCounts - Modifiers the board must show at least
   *   this many times; a level that introduces a mechanic cannot roll none of it.
   * @returns {Array<import('../entities/Ball.js').Ball>} The created balls, in spec order.
   */
  materializeLayout(spec, modifierWeights = {}, minModifierCounts = {}) {
    const r = this.physicsConfig.ball.radius;
    const pivots = this.physicsWorld.obstacles.filter((o) => o.type === OBSTACLE_TYPES.PIVOT);
    const created = spec.balls.map((ballSpec) => {
      const ball = this.createClusterBall({
        x: ballSpec.x,
        y: ballSpec.y,
        radius: r,
        colorId: this.pickPaletteColor(),
        clusterModifier: this.pickSpecModifier(ballSpec, modifierWeights),
        isAnchor: ballSpec.isAnchor,
        pivotRef: ballSpec.pivotSlot === NO_PIVOT_SLOT ? null : pivots[ballSpec.pivotSlot] || null,
        pivotRadius: ballSpec.pivotRadius,
        pivotAngle: ballSpec.pivotAngle,
        railMinX: ballSpec.railHalfWidth > 0 ? ballSpec.x - ballSpec.railHalfWidth : null,
        railMaxX: ballSpec.railHalfWidth > 0 ? ballSpec.x + ballSpec.railHalfWidth : null
      });
      this.physicsWorld.addBall(ball);
      return ball;
    });
    for (const [a, b] of spec.bonds) {
      this.physicsWorld.createBond(created[a], created[b], false);
    }
    this.ensureMinimumModifiers(
      created.filter((ball, index) => spec.balls[index].allowModifier),
      minModifierCounts
    );
    return created;
  },

  /**
   * Turns one ball of a freshly built board into the boss core.
   * @param {Array<import('../entities/Ball.js').Ball>} balls - The board's balls, in spec order.
   * @param {number|null} bossBallIndex - Index of the boss ball; null leaves the board as it is.
   */
  makeBossCore(balls, bossBallIndex) {
    if (bossBallIndex === null || bossBallIndex === undefined) {
      return;
    }
    const bossBall = balls[bossBallIndex];
    bossBall.clusterModifier = CLUSTER_MODIFIERS.BOSS_CORE;
    bossBall.armorHits = this.ballsConfig.clusterModifiers.bossCore.initialArmor;
  },

  /** Modifier of a layout ball: neutral anchors are fixed, other free balls roll one. */
  pickSpecModifier(ballSpec, modifierWeights) {
    if (ballSpec.isNeutral) {
      return CLUSTER_MODIFIERS.NEUTRAL_ANCHOR;
    }
    return ballSpec.allowModifier ? this.rollModifier(modifierWeights) : null;
  },

  /**
   * Tops up each modifier to its minimum count by giving it to plain balls picked at
   * random among those allowed to carry one.
   * @param {Array<import('../entities/Ball.js').Ball>} candidates - Balls allowed a modifier.
   * @param {Object<string, number>} minCounts - Minimum count per modifier id.
   */
  ensureMinimumModifiers(candidates, minCounts) {
    for (const [modKey, minCount] of Object.entries(minCounts)) {
      let missing = minCount - candidates.filter((ball) => ball.clusterModifier === modKey).length;
      while (missing > 0) {
        const plain = candidates.filter((ball) => !ball.clusterModifier);
        if (plain.length === 0) {
          return;
        }
        const ball = plain[Math.floor(this.random() * plain.length)];
        ball.clusterModifier = modKey;
        ball.armorHits = this.getInitialArmor(modKey);
        if (this.isColorlessModifier(modKey)) {
          ball.colorId = null;
        }
        missing--;
      }
    }
  },

  spawnConcentricRings(centerX, centerY, rings, pivotObstacle, modifierWeights = {}) {
    const r = this.physicsConfig.ball.radius;
    rings.forEach((ringDef, ringIndex) => {
      for (let i = 0; i < ringDef.count; i++) {
        const angle = (MATH_CONSTANTS.TWO_PI * i) / ringDef.count;
        const x = centerX + Math.cos(angle) * ringDef.radius;
        const y = centerY + Math.sin(angle) * ringDef.radius;
        const isInnerRing = ringIndex === 0;
        const ball = this.createClusterBall({
          x,
          y,
          radius: r,
          colorId: this.pickPaletteColor(),
          clusterModifier: isInnerRing ? null : this.rollModifier(modifierWeights),
          isAnchor: isInnerRing,
          pivotRef: isInnerRing ? pivotObstacle : null,
          pivotRadius: isInnerRing ? ringDef.radius : 0,
          pivotAngle: angle
        });
        this.physicsWorld.addBall(ball);
      }
    });
  },
};
