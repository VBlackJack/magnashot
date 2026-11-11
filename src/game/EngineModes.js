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
  OBJECTIVE_TYPES,
  GAME_STATES,
  OBSTACLE_TYPES,
  SPECIAL_TYPES,
  CLUSTER_MODIFIERS,
  MATH_CONSTANTS
} from '../core/Constants.js';
import { t } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { Ball } from '../entities/Ball.js';
import { Obstacle } from '../entities/Obstacle.js';
import { generateFluxStage } from './layouts/FluxStageGenerator.js';
import {
  shiftObstacleDefsX,
  shiftSpecX
} from '../core/WorldGeometry.js';
import {
  listLevelMechanics,
  pickNextDiscovery
} from './Discovery.js';

/** Flux perk ids; the specs (step, maxStacks, icon) live in configs/flux.json. */
export const FLUX_PERK_IDS = Object.freeze({
  RESERVE: 'reserve',
  REFILL: 'refill',
  BLAST: 'blast',
  OVERCHARGE: 'overcharge',
  ARSENAL: 'arsenal',
  GOLDEN: 'golden'
});

/** Methods of GameEngine that belong to this domain, installed on its prototype. */
export const engineModeMethods = {
  startCampaignLevel(levelId) {
    const catalog = this.levelCatalog;
    const levelDef = catalog.get(levelId) || catalog.get(catalog.firstId);

    this.resetRunState(GAME_MODES.CAMPAIGN);
    this.currentLevelId = levelDef.id;
    this.shotsRemaining = levelDef.maxShots + this.getStartingShotsBonus();
    this.levelTutorialKey = levelDef.tutorialKey || null;
    this.specialInventory = { ...levelDef.specialInventory };

    this.activePalette = this.ballsConfig.standardColors
      .slice(0, levelDef.paletteCount)
      .map((c) => c.id);

    this.audioManager.stopAll();
    this.physicsWorld.clear();
    this.particleSystem.clear();

    for (const obsDef of shiftObstacleDefsX(levelDef.obstacles, this.gameConfig.canvas.contentOffsetX)) {
      const obs = new Obstacle(obsDef, this.obstaclesConfig);
      this.physicsWorld.obstacles.push(obs);
    }

    if (levelDef.spec) {
      const spec = shiftSpecX(levelDef.spec, this.gameConfig.canvas.contentOffsetX);
      const balls = this.materializeLayout(spec, levelDef.modifierWeights, levelDef.minModifierCounts);
      this.makeBossCore(balls, levelDef.bossBallIndex);
    } else {
      this.buildLevelLayout(levelDef.layout, levelDef.modifierWeights || {}, levelDef.minModifierCounts || {});
    }
    this.physicsWorld.rebuildInitialBonds();
    this.levelStartBallCount = this.physicsWorld.balls.length;
    this.targetCoreCount = this.physicsWorld.balls.filter(
      (b) => b.clusterModifier === CLUSTER_MODIFIERS.RESCUE_CORE
    ).length;
    if (levelDef.objective === OBJECTIVE_TYPES.CORE_RESCUE || this.targetCoreCount > 0) {
      this.currentObjective = OBJECTIVE_TYPES.CORE_RESCUE;
    }

    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.refreshDiscovery();
    // One banner at a time: a hint already up at the start of the level takes the place.
    this.levelIntro = this.isRestoringRun || this.activeDiscoveryId ? null : this.buildLevelIntro(levelDef);
    this.notifyUI();
  },

  /**
   * The first-play banner of a campaign level: null when the level was played before
   * (a stored result, or an earlier attempt in this session).
   * @param {Object} levelDef - Level being started.
   * @returns {?{levelId: number, summary: Object, maxShots: number, featuredMechanicId: ?string}} The
   *   summary is the level catalog's, which the interface turns into the display name (generated
   *   levels have no name key of their own).
   */
  buildLevelIntro(levelDef) {
    if (this.storageManager.getLevelStats()[levelDef.id] || this.introducedLevelIds.has(levelDef.id)) {
      return null;
    }
    this.introducedLevelIds.add(levelDef.id);
    const onboarding = this.gameConfig.onboarding;
    const featured =
      pickNextDiscovery(
        listLevelMechanics(levelDef, { guaranteedOnly: true }),
        this.storageManager.getDiscoveries(),
        onboarding.order
      ) ||
      onboarding.order.find((id) => levelDef.tutorialKey && onboarding.mechanics[id]?.hintKey === levelDef.tutorialKey) ||
      null;
    return {
      levelId: levelDef.id,
      summary: this.levelCatalog.summarize(levelDef.id),
      maxShots: this.shotsRemaining,
      featuredMechanicId: featured
    };
  },

  /** Closes the first-play banner; the first shot closes it too. */
  dismissLevelIntro() {
    if (this.levelIntro) {
      this.levelIntro = null;
      this.notifyUI();
    }
  },

  startEndlessMode() {
    this.initSurvivalRun(GAME_MODES.ENDLESS, null);
    this.storageManager?.recordAchievementProgress?.({ endlessWave: this.waveCount });
    this.notifyUI();
  },

  /**
   * Starts Classic: the pure ruleset (no specials, no Workshop, no shot budget) on seeded
   * stage boards. Misses fill the Sag meter and each full meter lowers the anchor rail.
   * @param {number} [stage=1] - 1-based stage to start on.
   */
  startClassicMode(stage = 1) {
    const drawRunSeed = this.seedSource || Math.random;
    // A run stream of its own (launcher draws) so the stage boards can be scoped: a stage
    // board never depends on the shots played before it.
    this.launchClassicBoard(stage, new SeededRandom(`${this.gameConfig.classic.seedPrefix}:run:${drawRunSeed()}`));
  },

  /**
   * Shared start of a Classic-style board: Classic itself and a board of a versus duel.
   * @param {number} stage - 1-based stage to start on.
   * @param {SeededRandom} runRng - Run stream feeding the launcher and physics draws.
   * @param {object|null} [versusState] - Versus state of the board (null for plain Classic).
   */
  launchClassicBoard(stage, runRng, versusState = null) {
    const cleanStage = Math.max(1, Math.floor(Number(stage) || 1));
    this.resetRunState(GAME_MODES.CLASSIC);
    this.versus = versusState;
    this.classicStage = cleanStage;
    this.seededRng = runRng;
    this.waveCount = 1;
    this.endlessRowParity = 0;
    this.sagLevel = 0;
    this.railDrops = 0;
    this.classicRailDropsTotal = 0;
    this.specialInventory = Object.fromEntries(Object.values(SPECIAL_TYPES).map((type) => [type, 0]));

    this.audioManager.stopAll();
    this.particleSystem.clear();
    this.buildClassicStage(cleanStage);
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.notifyUI();
  },

  /**
   * Stream key of the seeded board of a Classic stage. A versus board draws from the key of
   * its duel, so both boards of a round get the same stage.
   * @param {number} stage - 1-based stage number.
   * @returns {string}
   */
  getClassicStageStreamKey(stage) {
    return this.versus
      ? `${this.versus.seedKey}:board:${stage}`
      : `${this.gameConfig.classic.seedPrefix}:${stage}`;
  },

  /**
   * Replaces the board with the seeded board of a Classic stage: a fully anchored top row,
   * no modifiers and no obstacles. The same stage always gives the same board.
   * @param {number} stage - 1-based stage number.
   */
  buildClassicStage(stage) {
    const classicCfg = this.gameConfig.classic;
    const rows = Math.min(classicCfg.maxRows, classicCfg.baseRows + (stage - 1) * classicCfg.rowsPerStage);
    const paletteSize = Math.min(
      classicCfg.maxPalette,
      classicCfg.basePalette + Math.floor((stage - 1) / classicCfg.paletteStepStages)
    );
    this.physicsWorld.clear();
    this.activePalette = this.ballsConfig.standardColors.slice(0, paletteSize).map((c) => c.id);

    const r = this.physicsConfig.ball.radius;
    const cols = classicCfg.columns;
    const spacingX = r * this.physicsConfig.simulation.bondRestDistanceFactor;
    const startX = (this.gameConfig.canvas.logicalWidth - (cols - 1) * spacingX) * MATH_CONSTANTS.HALF;
    this.withScopedRandom(this.getClassicStageStreamKey(stage), () => {
      for (let row = 0; row < rows; row++) {
        const y = classicCfg.startY + row * classicCfg.rowSpacingY;
        const rowOffset = (row % 2) * r * MATH_CONSTANTS.HALF;
        for (let col = 0; col < cols; col++) {
          this.physicsWorld.addBall(
            this.createClusterBall({
              x: startX + col * spacingX + rowOffset,
              y,
              radius: r,
              colorId: this.pickPaletteColor(),
              clusterModifier: null,
              isAnchor: row === 0
            })
          );
        }
      }
    });
    this.physicsWorld.rebuildInitialBonds();
    this.hasFiredInRound = false;
    this.combo = 0;
    this.freezeTurnsRemaining = 0;
  },

  /**
   * Pays a cleared Classic board, resets the Sag meter and the rail, and builds the next
   * stage. The score bonus scales with the stage that was cleared.
   */
  completeClassicStage() {
    const classicCfg = this.gameConfig.classic;
    const clearedStage = this.classicStage;
    const points = classicCfg.stageClearBonusBase * clearedStage;
    this.addScore(points);
    this.audioManager.playEffect('victory');
    this.particleSystem.spawnFloatingText(
      this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      this.gameConfig.canvas.logicalHeight * MATH_CONSTANTS.HALF,
      t('gameplay.feedback.classic.stageCleared', { points }),
      this.gameConfig.theme.victoryPopupColor
    );
    this.noteVersusBoardClear();
    this.classicStage = clearedStage + 1;
    this.sagLevel = 0;
    this.railDrops = 0;
    this.railLowerFrames = 0;
    this.buildClassicStage(this.classicStage);
    this.refreshStaleLauncherColors();
    if (this.currentBall) {
      this.updateAimFromAngle(this.aimAngle);
    }
    this.persistRunHighScore();
    this.saveRunSnapshot({ force: true });
    this.notifyUI({ classicStageCleared: clearedStage });
  },

  /**
   * Starts a deterministic One-Shot / Puzzle challenge stage from configs/game.json.
   * @param {number} [stageIndex=1] - 1-based puzzle stage index.
   */
  startPuzzleMode(stageIndex = 1) {
    const puzzles = this.gameConfig.puzzles || [];
    if (puzzles.length === 0) {
      this.startCampaignLevel(1);
      return;
    }
    const cleanStage = Math.max(1, Math.floor(Number(stageIndex) || 1));
    const boundedStage = ((cleanStage - 1) % puzzles.length) + 1;
    const puzzleDef = puzzles[boundedStage - 1];

    this.resetRunState(GAME_MODES.PUZZLE);
    this.currentPuzzleStage = boundedStage;
    this.currentObjective = puzzleDef.objective || OBJECTIVE_TYPES.CLEAR_ALL;
    this.shotsRemaining = puzzleDef.shots;
    this.specialInventory = { ...puzzleDef.specialInventory };

    const centerX = this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF;
    const r = this.physicsConfig.ball.radius;
    this.audioManager.stopAll();
    this.physicsWorld.clear();
    this.particleSystem.clear();

    for (const obsDef of puzzleDef.obstacles || []) {
      const obs = new Obstacle(
        {
          ...obsDef,
          x: obsDef.x !== undefined ? obsDef.x : centerX + (obsDef.dx || 0)
        },
        this.obstaclesConfig
      );
      this.physicsWorld.obstacles.push(obs);
    }

    const paletteIds = new Set();
    for (const bSpec of puzzleDef.balls || []) {
      if (bSpec.colorId) {
        paletteIds.add(bSpec.colorId);
      }
    }
    for (const qItem of puzzleDef.queue || []) {
      if (qItem.colorId) {
        paletteIds.add(qItem.colorId);
      }
    }
    this.activePalette = paletteIds.size > 0
      ? [...paletteIds]
      : this.ballsConfig.standardColors.slice(0, this.gameConfig.defaults.matchMinCount).map((c) => c.id);

    const pivots = this.physicsWorld.obstacles.filter((o) => o.type === OBSTACLE_TYPES.PIVOT);
    for (const bSpec of puzzleDef.balls || []) {
      const mod = bSpec.clusterModifier || null;
      const x = bSpec.x !== undefined ? bSpec.x : centerX + (bSpec.dx || 0);
      const y = bSpec.y;
      const pivotRef = bSpec.pivotIndex !== undefined ? pivots[bSpec.pivotIndex] || null : null;
      const ball = new Ball({
        x,
        y,
        radius: r,
        colorId: this.isColorlessModifier(mod) ? null : bSpec.colorId,
        clusterModifier: mod,
        armorHits: bSpec.armorHits !== undefined ? bSpec.armorHits : this.getInitialArmor(mod),
        isAnchor: Boolean(bSpec.isAnchor),
        pivotRef,
        pivotRadius: pivotRef ? Math.hypot(x - pivotRef.x, y - pivotRef.y) : 0,
        pivotAngle: pivotRef ? Math.atan2(y - pivotRef.y, x - pivotRef.x) - pivotRef.angle : 0
      });
      this.physicsWorld.addBall(ball);
    }

    this.physicsWorld.rebuildInitialBonds();
    this.levelStartBallCount = this.physicsWorld.balls.length;
    this.targetCoreCount = this.physicsWorld.balls.filter(
      (b) => b.clusterModifier === CLUSTER_MODIFIERS.RESCUE_CORE
    ).length;

    const queueSpecs = puzzleDef.queue?.length > 0
      ? puzzleDef.queue.map((item) => ({ ...item }))
      : [{ colorId: this.activePalette[0], specialType: null }];
    const firstSpec = queueSpecs.shift();
    const secondSpec = queueSpecs.shift() || { ...firstSpec };
    this.puzzleQueue = queueSpecs;
    this.currentBall = this.createRandomLauncherBall(firstSpec.specialType || null, firstSpec.colorId);
    this.nextBall = this.createRandomLauncherBall(secondSpec.specialType || null, secondSpec.colorId);
    this.upcomingColorIds = this.puzzleQueue.map((item) => item.colorId || this.activePalette[0]);

    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.refreshDiscovery();
    // The attempt is counted on the first shot (see fire), not here; the intro stays built behind
    // a discovery card (the UI defers it).
    this.levelIntro = this.isRestoringRun ? null : this.buildPuzzleIntro(boundedStage, puzzleDef);
    this.notifyUI();
  },

  /**
   * Builds the per-stage Puzzle banner data, shown on every start and retry.
   * @param {number} stage - 1-based stage index.
   * @param {Object} puzzleDef - Stage definition from game.json.
   * @returns {{puzzleStage: number, totalStages: number, shots: number, objective: string, isFirstPuzzle: boolean}}
   */
  buildPuzzleIntro(stage, puzzleDef) {
    const stats = this.storageManager.getPuzzleStageStats?.() || {};
    const isFirstPuzzle = !Object.values(stats).some((entry) => entry.cleared);
    return {
      puzzleStage: stage,
      totalStages: (this.gameConfig.puzzles || []).length,
      shots: puzzleDef.shots,
      objective: puzzleDef.objective || OBJECTIVE_TYPES.CLEAR_ALL,
      isFirstPuzzle
    };
  },

  /**
   * Starts Blitz 90s (Time Attack) mode: unlimited shots, 90-second timer, rapid wave
   * descent, and automatic cannon firing if the player hesitates.
   */
  startBlitzMode() {
    const blitzCfg = this.gameConfig.blitz;
    this.resetRunState(GAME_MODES.BLITZ);
    this.waveCount = 1;
    this.endlessRowParity = 0;
    this.blitzFramesRemaining = blitzCfg.durationFrames;
    this.blitzWaveTimerFrames = blitzCfg.waveIntervalFrames;
    this.blitzIdleFrames = 0;
    this.specialInventory = { ...blitzCfg.initialSpecialCounts };
    this.activePalette = this.ballsConfig.standardColors
      .slice(0, this.gameConfig.endless.paletteCount)
      .map((c) => c.id);

    this.audioManager.stopAll();
    this.physicsWorld.clear();
    this.particleSystem.clear();

    for (let row = 0; row < blitzCfg.initialRows; row++) {
      const y = blitzCfg.startY + row * blitzCfg.rowSpacingY;
      this.spawnEndlessRow(y, row % 2, row === 0, () => this.rollEndlessModifier());
    }
    this.physicsWorld.rebuildInitialBonds();
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.refreshDiscovery();
    this.notifyUI();
  },

  /**
   * Starts Boss Rush (Titan Core) mode: a central rotor boss surrounded by protective rings
   * where overcharge bursts crack boss shields and defeating the Titan advances to the next wave.
   * @param {number} [wave=1] - Starting boss wave.
   */
  startBossRushMode(wave = 1) {
    const bossRushCfg = this.gameConfig.bossRush;
    this.resetRunState(GAME_MODES.BOSS_RUSH);
    this.bossRushWave = Math.max(1, Math.floor(Number(wave) || 1));
    this.waveCount = this.bossRushWave;
    this.specialInventory = { ...bossRushCfg.initialSpecialCounts };
    this.activePalette = this.ballsConfig.standardColors
      .slice(0, this.gameConfig.endless.paletteCount)
      .map((c) => c.id);

    this.audioManager.stopAll();
    this.physicsWorld.clear();
    this.particleSystem.clear();

    this.spawnBossRushWave();
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.refreshDiscovery();
    this.notifyUI();
  },

  spawnBossRushWave() {
    const bossRushCfg = this.gameConfig.bossRush;
    const centerX = this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF;
    const pivotY = bossRushCfg.pivotY;
    const r = this.physicsConfig.ball.radius;

    // Falling balls still pay score and overcharge when they land: the new wave keeps them.
    this.physicsWorld.clear({ keepDroppingBalls: true });
    const centralPivot = new Obstacle(
      {
        type: OBSTACLE_TYPES.PIVOT,
        x: centerX,
        y: pivotY,
        radius: bossRushCfg.pivotRadius,
        angularSpeed: bossRushCfg.pivotBaseAngularSpeed
      },
      this.obstaclesConfig
    );
    this.physicsWorld.obstacles.push(centralPivot);

    this.clearMagnetar();
    const isMagnetarWave = this.shouldUseMagnetar();
    let bossBall;
    if (isMagnetarWave) {
      // The Magnetar floats on the pivot axis (it is not an anchor): the inner ring holds it up.
      bossBall = new Ball({
        x: centerX,
        y: pivotY,
        radius: r,
        colorId: null,
        clusterModifier: CLUSTER_MODIFIERS.MAGNETAR,
        armorHits: 0,
        isAnchor: false
      });
      this.physicsWorld.addBall(bossBall);
      this.initMagnetar(bossBall, { key: this.getMagnetarKey(), tier: this.getMagnetarTier() });
    } else {
      const armor = Math.min(
        bossRushCfg.maxBossArmor,
        bossRushCfg.baseBossArmor + (this.bossRushWave - 1) * bossRushCfg.armorStepPerWave
      );
      bossBall = new Ball({
        x: centerX,
        y: pivotY,
        radius: r,
        colorId: this.pickPaletteColor(),
        clusterModifier: CLUSTER_MODIFIERS.BOSS_CORE,
        armorHits: armor,
        isAnchor: true
      });
      this.physicsWorld.addBall(bossBall);
    }

    const rings = [
      { radius: r * bossRushCfg.innerRingRadiusFactor, count: bossRushCfg.innerRingCount },
      { radius: r * bossRushCfg.outerRingRadiusFactor, count: bossRushCfg.outerRingCount }
    ];
    this.spawnConcentricRings(centerX, pivotY, rings, centralPivot, this.gameConfig.endless.modifierWeights);
    for (const ball of this.physicsWorld.balls) {
      if (ball.id !== bossBall.id && Math.hypot(ball.x - bossBall.x, ball.y - bossBall.y) <= r * bossRushCfg.innerRingRadiusFactor + r) {
        this.physicsWorld.createBond(bossBall, ball, false);
      }
    }
    this.physicsWorld.rebuildInitialBonds();
    this.refreshMoorings(false);
  },

  /** The boss ball of the board: a Magnetar or a Boss Core. */
  getBossBall() {
    return (
      this.physicsWorld.balls.find(
        (b) => b.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE || b.clusterModifier === CLUSTER_MODIFIERS.MAGNETAR
      ) || null
    );
  },

  /**
   * Starts Cascade Drop mode: downward cluster gravity into a magnetic well with Platform
   * shelves and Antimagnet cushions.
   */
  startCascadeMode() {
    const cascadeCfg = this.gameConfig.cascade;
    const centerX = this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF;
    this.resetRunState(GAME_MODES.CASCADE);
    this.cascadeWave = 1;
    this.waveCount = 1;
    this.cascadeTurnsUntilDrop = cascadeCfg.shotsBeforeDrop;
    this.specialInventory = { ...cascadeCfg.initialSpecialCounts };
    this.activePalette = this.ballsConfig.standardColors
      .slice(0, this.gameConfig.endless.paletteCount)
      .map((c) => c.id);

    this.audioManager.stopAll();
    this.physicsWorld.clear();
    this.particleSystem.clear();
    this.physicsWorld.gravityMultiplier = cascadeCfg.gravityMultiplier;

    for (const platDef of cascadeCfg.platforms || []) {
      this.physicsWorld.obstacles.push(
        new Obstacle(
          {
            type: OBSTACLE_TYPES.PLATFORM,
            x: centerX + (platDef.dx || 0),
            y: platDef.y,
            width: platDef.width,
            height: platDef.height
          },
          this.obstaclesConfig
        )
      );
    }
    for (const antiDef of cascadeCfg.antimagnets || []) {
      this.physicsWorld.obstacles.push(
        new Obstacle(
          {
            type: OBSTACLE_TYPES.ANTIMAGNET,
            x: centerX + (antiDef.dx || 0),
            y: antiDef.y,
            radius: antiDef.radius,
            fieldRadius: antiDef.fieldRadius,
            clusterRepelForce: antiDef.clusterRepelForce
          },
          this.obstaclesConfig
        )
      );
    }

    for (let row = 0; row < cascadeCfg.initialDropRows; row++) {
      this.spawnCascadeDropWave(0);
    }
    this.physicsWorld.rebuildInitialBonds();
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.refreshDiscovery();
    this.notifyUI();
  },

  spawnCascadeDropWave(rowIndex = 0) {
    const cascadeCfg = this.gameConfig.cascade;
    const centerX = this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF;
    const r = this.physicsConfig.ball.radius;
    const minWallY = this.gameConfig.canvas.wallMargin + r;
    const restDist = r * this.physicsConfig.simulation.bondRestDistanceFactor;
    const maxBondDist = r * this.physicsConfig.simulation.bondCreationDistanceFactor;
    const minClearance = r * cascadeCfg.overlapRadiusFactor;
    const colCount = Math.max(1, cascadeCfg.dropCountPerWave || 1);
    const halfCols = (colCount - 1) * MATH_CONSTANTS.HALF;
    const minRow = Math.max(0, Math.floor(Number(rowIndex) || 0));
    const newBalls = [];
    for (const platSpec of cascadeCfg.platforms || []) {
      const platX = centerX + (platSpec.dx || 0);
      const baseTopY = platSpec.y - platSpec.height * MATH_CONSTANTS.HALF - r;
      for (let colIdx = 0; colIdx < colCount; colIdx++) {
        const offsetIndex = colIdx - halfCols;
        const spawnX = platX + offsetIndex * restDist;
        for (let rIdx = minRow; ; rIdx++) {
          const spawnY = baseTopY - rIdx * restDist;
          if (spawnY < minWallY) {
            break;
          }
          if (rIdx > 0) {
            const hasSupport = this.physicsWorld.balls.some(
              (b) => b.y > spawnY && Math.hypot(b.x - spawnX, b.y - spawnY) <= maxBondDist
            );
            if (!hasSupport) {
              break;
            }
          }
          const alreadyOccupied = this.physicsWorld.balls.some(
            (b) => Math.hypot(b.x - spawnX, b.y - spawnY) < minClearance
          );
          if (alreadyOccupied) {
            continue;
          }
          const ball = this.createClusterBall({
            x: spawnX,
            y: spawnY,
            radius: r,
            colorId: this.pickPaletteColor(),
            clusterModifier: this.rollEndlessModifier(),
            isAnchor: false
          });
          this.physicsWorld.addBall(ball);
          newBalls.push(ball);
          break;
        }
      }
    }
    this.physicsWorld.rebuildInitialBonds();
    return newBalls;
  },

  /**
   * Starts the Daily Challenge for a seed (today's UTC date key by default).
   * @param {string|null} customSeed - Seed key; restarts pass the running seed so the board stays identical.
   * @param {boolean} isRestart - True when replaying the same seed; the first-play bonus is never re-granted.
   * @param {{isRematch?: boolean}} [options] - isRematch marks the replay of a past Daily board
   *   (Ghost Duel): no first-play bonus, and no streak, history or daily high score is written.
   */
  startDailyChallenge(customSeed = null, isRestart = false, { isRematch = false } = {}) {
    const seed = customSeed || SeededRandom.getTodayDateKey();
    this.initSurvivalRun(GAME_MODES.DAILY, seed);
    this.isDailyRematch = Boolean(isRematch);
    const dailyCfg = this.gameConfig.daily;
    const bonusCoins = dailyCfg.firstPlayBonusCoins;
    if (!isRestart && !isRematch && bonusCoins > 0 && this.storageManager.claimDailyPlayBonus(seed, bonusCoins, dailyCfg)) {
      const streak = this.storageManager.getDailyStreak?.(seed) || 1;
      const streakBonus = this.storageManager.computeDailyStreakBonus?.(streak, dailyCfg) || 0;
      const totalCoins = bonusCoins + streakBonus;
      const popupText = streak > 1
        ? t('gameplay.feedback.dailyBonus.streakClaimed', { coins: totalCoins, streak })
        : t('gameplay.feedback.dailyBonus.claimed', { coins: totalCoins });
      this.audioManager.playEffect('achievement');
      this.particleSystem.spawnFloatingText(
        this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
        this.gameConfig.canvas.launcherY + this.gameConfig.canvas.launcherPopupOffsetY,
        popupText,
        this.gameConfig.theme.coinPopupColor
      );
    }
    this.levelIntro =
      isRestart || this.isRestoringRun || this.activeDiscoveryId ? null : this.buildDailyIntro(seed);
    this.notifyUI();
  },

  /**
   * The first-play mutator banner of a Daily Challenge seed in the current session.
   * @param {string} seed - Daily seed key.
   * @returns {?{dailySeed: string, mutatorKey: string}}
   */
  buildDailyIntro(seed) {
    if (!seed || !this.activeMutatorKey || this.introducedDailySeeds.has(seed)) {
      return null;
    }
    this.introducedDailySeeds.add(seed);
    return {
      dailySeed: seed,
      mutatorKey: this.activeMutatorKey
    };
  },

  /**
   * Starts a Flux run: an endless chain of generated shapes sharing one shot reserve.
   * @param {string|null} seed - Run seed; a fresh random seed when omitted.
   * @param {{isShared?: boolean, weekKey?: string, isRestart?: boolean}} [options] - isShared
   *   marks a run started from a shared seed link, which locks the device tilt so every player
   *   gets the same physics; weekKey is the week a weekly restart belongs to (this week by
   *   default); isRestart marks a restart, which never pays the weekly bonus; contentVersion is
   *   the generation the shapes come from (the current one by default): a duel replays an older
   *   one so a link recorded before a generation change meets the shapes it was recorded on.
   */
  startFluxRun(seed = null, { isShared = false, weekKey = undefined, isRestart = false, contentVersion = undefined } = {}) {
    const currentVersion = this.gameConfig.ghostDuel.contentVersion.flux;
    const version = contentVersion ?? currentVersion;
    const runSeed = seed || this.createFluxSeed();
    this.initFluxRun(runSeed, version);
    this.isSharedFluxRun = Boolean(isShared);
    // A run on this week's seed is the weekly run, however it was started, unless it replays
    // older shapes: the weekly board is the current one, so those runs never reach its records.
    const isWeekly = version === currentVersion && this.detectWeeklyFlux(runSeed, weekKey);
    this.buildFluxStage({ persist: false });
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    if (isWeekly && !isRestart && !this.isRestoringRun) {
      this.payWeeklyFluxBonus(this.weeklyWeekKey);
    }
    this.notifyUI();
  },

  /**
   * Rebuilds a saved Flux run at its stage: same seed, same shape, same obstacles. The
   * caller (applyRunSnapshot) then puts the saved balls and counters back.
   * @param {number} [contentVersion] - Generation the run was saved with (the current one by default).
   */
  restoreFluxRun(seed, stage, previousFamily, contentVersion = undefined) {
    this.initFluxRun(seed, contentVersion);
    this.fluxStage = stage;
    this.fluxPreviousFamily = previousFamily;
    this.buildFluxStage({ persist: false });
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
  },

  createFluxSeed() {
    const { radix, length } = this.fluxConfig.seed;
    return Math.floor(Math.random() * radix ** length)
      .toString(radix)
      .padStart(length, '0');
  },

  /**
   * Resets the engine for a Flux run. The run keeps the generation it starts with, so its shapes,
   * its save and its ghost always agree; a generation that needs the settle table falls back to
   * the one before it when the table is not loaded.
   * @param {string} seed - Run seed.
   * @param {number} [contentVersion] - Generation of the shapes (the current one by default).
   */
  initFluxRun(seed, contentVersion = undefined) {
    this.resetRunState(GAME_MODES.FLUX);
    const requested = contentVersion ?? this.gameConfig.ghostDuel.contentVersion.flux;
    const sinceVersion = this.fluxConfig.shapeSettle.sinceContentVersion;
    this.fluxContentVersion = requested >= sinceVersion && !this.fluxShapeTuning?.margins
      ? sinceVersion - 1
      : requested;
    this.fluxSeed = seed;
    this.seededRng = new SeededRandom(seed);
    this.fluxStage = 1;
    this.fluxPreviousFamily = null;
    this.shotsRemaining = this.fluxConfig.shots.starting + this.getStartingShotsBonus();
    this.specialInventory = { ...this.fluxConfig.initialSpecialCounts };
    // The previous run's launcher balls would be recolored by the first stage build and
    // draw from the new seed: a seed must give the same run whatever was played before.
    this.currentBall = null;
    this.nextBall = null;
    this.upcomingColorIds = [];
    this.stashedRegularColorId = null;
    this.audioManager.stopAll();
    this.particleSystem.clear();
  },

  /**
   * Replaces the board with the generated shape of the current Flux stage.
   * @param {{persist: boolean, stageOptions?: object|null}} options - persist stores the run right
   *   away, so a reload resumes on the new shape; restoring a saved run passes false to keep that
   *   save. stageOptions are extra generateFluxStage options (the settle calibration forces a family).
   */
  buildFluxStage({ persist, stageOptions = null }) {
    // Runs of the generation that settles its shapes draw only shapes that hang clear of the line.
    const isSettled = this.fluxContentVersion >= this.fluxConfig.shapeSettle.sinceContentVersion;
    const stageDef = generateFluxStage({
      shapeMargins: isSettled ? this.fluxShapeTuning?.margins ?? null : null,
      seed: this.fluxSeed,
      stage: this.fluxStage,
      previousFamily: this.fluxPreviousFamily,
      fluxConfig: this.fluxConfig,
      obstaclesConfig: this.obstaclesConfig,
      ballRadius: this.physicsConfig.ball.radius,
      ...stageOptions
    });

    this.physicsWorld.clear();
    this.clearMagnetar();
    this.fluxIsBossStage = stageDef.isBoss;
    this.activePalette = this.ballsConfig.standardColors
      .slice(0, stageDef.paletteCount)
      .map((c) => c.id);
    const contentOffsetX = this.gameConfig.canvas.contentOffsetX;
    for (const obsDef of shiftObstacleDefsX(stageDef.obstacles, contentOffsetX)) {
      this.physicsWorld.obstacles.push(new Obstacle(obsDef, this.obstaclesConfig));
    }
    const balls = this.withScopedRandom(`${this.fluxSeed}:board:${this.fluxStage}`, () =>
      this.materializeLayout(shiftSpecX(stageDef.spec, contentOffsetX), stageDef.modifierWeights)
    );
    if (this.shouldUseMagnetar()) {
      this.makeMagnetar(balls, stageDef.bossBallIndex, { key: this.getMagnetarKey(), tier: this.getMagnetarTier() });
    } else {
      this.makeBossCore(balls, stageDef.bossBallIndex);
    }
    this.physicsWorld.rebuildInitialBonds();
    this.refreshMoorings(false);

    this.fluxFamily = stageDef.family;
    this.fluxShapeIds = stageDef.shapeIds;
    this.fluxIsBossStage = stageDef.isBoss;
    this.hasFiredInRound = false;
    this.combo = 0;
    this.freezeTurnsRemaining = 0;
    this.stageIntroFrames = this.isReducedMotion ? 0 : this.fluxConfig.transition.introFrames;

    this.refreshStaleLauncherColors();
    if (this.currentBall) {
      this.updateAimFromAngle(this.aimAngle);
    }
    this.refreshDiscovery();
    if (persist) {
      this.saveRunSnapshot({ force: true });
    }
  },

  /** Shots given back when a Flux shape is cleared; the refill shrinks as stages go by. */
  getFluxShotRefill(stage) {
    const shots = this.fluxConfig.shots;
    return Math.max(shots.refillMin, Math.round(shots.refillBase - shots.refillDecayPerStage * (stage - 1)));
  },

  /**
   * Pays a cleared Flux shape (points, coins, refilled shots, specials after a boss) and
   * starts the transition to the next stage.
   */
  completeFluxStage() {
    const rewards = this.fluxConfig.rewards;
    const clearedStage = this.fluxStage;
    const points = rewards.stageClearPointsBase + rewards.stageClearPointsPerStage * clearedStage;
    const refill = this.getFluxShotRefill(clearedStage) + this.getFluxPerkBonus(FLUX_PERK_IDS.REFILL);
    // The transition starts first so the run is not capturable while it is paid: the coins
    // are held until the next shape is stored, instead of being paid on top of a stored
    // run that still shows this shape uncleared.
    this.stageTransitionFrames = this.fluxConfig.transition.clearFrames;
    this.addScore(points);
    this.awardRunCoins(rewards.stageClearCoins + this.getFluxPerkBonus(FLUX_PERK_IDS.GOLDEN));
    this.shotsRemaining += refill;
    if (this.fluxIsBossStage) {
      for (let i = 0; i < rewards.bossClearSpecials; i++) {
        this.grantRandomSpecialBall();
      }
    }
    this.audioManager.playEffect('victory');
    this.particleSystem.spawnFloatingText(
      this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      this.gameConfig.canvas.logicalHeight * MATH_CONSTANTS.HALF,
      t('gameplay.feedback.flux.stageCleared', { stage: clearedStage, points, shots: refill }),
      this.gameConfig.theme.victoryPopupColor
    );
    this.fluxPreviousFamily = this.fluxFamily;
    this.fluxStage = clearedStage + 1;
    this.unlockAchievementTiers('fluxShapes', this.fluxStage);
    this.notifyUI({ fluxStageCleared: clearedStage });
  },

  /** Stacks held of a Flux perk; 0 outside Flux or when never picked. */
  getFluxPerkStacks(perkId) {
    return this.mode === GAME_MODES.FLUX ? this.fluxPerks[perkId] || 0 : 0;
  },

  /** Total effect of a Flux perk: its step times the stacks held. */
  getFluxPerkBonus(perkId) {
    const spec = this.fluxConfig?.perks?.catalog?.[perkId];
    return spec ? spec.step * this.getFluxPerkStacks(perkId) : 0;
  },

  /** True while a Flux perk choice is pending: the board is frozen until one is picked. */
  isAwaitingPerk() {
    return this.mode === GAME_MODES.FLUX && Array.isArray(this.fluxPerkOffer) && this.fluxPerkOffer.length > 0;
  },

  /**
   * Draws the perks offered after a cleared Flux shape. The draw depends only on the run
   * seed and the cleared stage, and skips perks already at their stack cap.
   * @param {number} clearedStage - Stage of the shape that was just cleared.
   * @returns {string[]|null} Distinct perk ids, or null when no offer is due or none is left.
   */
  drawFluxPerkOffer(clearedStage) {
    const perksCfg = this.fluxConfig.perks;
    if (this.mode !== GAME_MODES.FLUX || clearedStage < 1 || clearedStage % perksCfg.interval !== 0) {
      return null;
    }
    const pool = perksCfg.order.filter((id) => this.getFluxPerkStacks(id) < perksCfg.catalog[id].maxStacks);
    if (pool.length === 0) {
      return null;
    }
    const rng = new SeededRandom(`${this.fluxSeed}:perks:${clearedStage}`);
    const offer = [];
    while (offer.length < perksCfg.offerSize && pool.length > 0) {
      offer.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
    }
    return offer;
  },

  /**
   * Takes one of the offered Flux perks: instant effects apply now, the others are read
   * from the stack count when they trigger.
   * @param {string} perkId - Perk picked from the pending offer.
   * @returns {boolean} False when no offer is pending or the perk is not in it.
   */
  chooseFluxPerk(perkId) {
    if (!this.isAwaitingPerk() || !this.fluxPerkOffer.includes(perkId)) {
      return false;
    }
    const spec = this.fluxConfig.perks.catalog[perkId];
    this.fluxPerks[perkId] = this.getFluxPerkStacks(perkId) + 1;
    this.fluxPerkOffer = null;
    if (perkId === FLUX_PERK_IDS.RESERVE) {
      this.shotsRemaining += spec.step;
    } else if (perkId === FLUX_PERK_IDS.ARSENAL) {
      this.grantStartingSpecialBalls(spec.step);
    }
    if (this.currentBall) {
      this.updateAimFromAngle(this.aimAngle);
    }
    this.saveRunSnapshot({ force: true });
    this.notifyUI({ fluxPerkChosen: perkId });
    return true;
  },

  /**
   * Adds random special balls among the types the run starts with (a starting count above
   * zero), with the same sound and popup as any other special ball grant, once per call.
   * @param {number} count - Number of balls to add.
   */
  grantStartingSpecialBalls(count) {
    const startingTypes = Object.entries(this.fluxConfig.initialSpecialCounts)
      .filter(([type, initial]) => initial > 0 && Object.values(SPECIAL_TYPES).includes(type))
      .map(([type]) => type);
    if (startingTypes.length === 0 || count <= 0) {
      return;
    }
    for (let i = 0; i < count; i++) {
      const granted = startingTypes[Math.floor(this.random() * startingTypes.length)];
      this.specialInventory[granted] = (this.specialInventory[granted] || 0) + 1;
    }
    const canvasCfg = this.gameConfig.canvas;
    this.audioManager.playEffect('overcharge');
    this.particleSystem.spawnFloatingText(
      canvasCfg.launcherX,
      canvasCfg.launcherY + canvasCfg.launcherPopupOffsetY,
      t('gameplay.feedback.arsenal.ready', { count }),
      this.gameConfig.theme.overchargePopupColor
    );
  },

  /** Lets the cleared shape's last balls fall, then brings in the next shape. */
  updateStageTransition() {
    this.physicsWorld.stepDroppingBalls(this.getStepCallbacks());
    this.particleSystem.update(this.gameConfig.juice.shakeDecay);
    this.stageTransitionFrames--;
    if (this.stageTransitionFrames === 0) {
      // fluxStage already points at the next shape: the cleared one is the stage before it.
      this.fluxPerkOffer = this.drawFluxPerkOffer(this.fluxStage - 1);
      this.buildFluxStage({ persist: true });
      this.notifyUI();
    }
  },

  startHexGridMode() {
    this.resetRunState(GAME_MODES.HEX_GRID);
    this.audioManager.stopAll();
    this.particleSystem.clear();
    const behavior = this.getModeBehavior();
    behavior.setupMode(this);
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const spec = this.getLauncherSpec();
    this.updateAimFromAngle(spec.defaultAngle);
    this.refreshDiscovery();
    this.notifyUI();
  },

  startOrbitalMode() {
    this.resetRunState(GAME_MODES.ORBITAL);
    this.specialInventory = Object.fromEntries(Object.values(SPECIAL_TYPES).map((type) => [type, 0]));
    this.audioManager.stopAll();
    this.particleSystem.clear();
    const behavior = this.getModeBehavior();
    behavior.setupMode(this);
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const spec = this.getLauncherSpec();
    this.updateAimFromAngle(spec.defaultAngle);
    this.refreshDiscovery();
    this.notifyUI();
  },

  startPinballMode(stage = 1) {
    this.resetRunState(GAME_MODES.PINBALL);
    this.specialInventory = Object.fromEntries(Object.values(SPECIAL_TYPES).map((type) => [type, 0]));
    this.audioManager.stopAll();
    this.particleSystem.clear();
    const behavior = this.getModeBehavior();
    behavior.setupMode(this, { stage });
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const spec = this.getLauncherSpec();
    this.updateAimFromAngle(spec.defaultAngle);
    this.refreshDiscovery();
    this.notifyUI();
  },

  startConvoyMode() {
    this.resetRunState(GAME_MODES.CONVOY);
    this.specialInventory = Object.fromEntries(Object.values(SPECIAL_TYPES).map((type) => [type, 0]));
    this.audioManager.stopAll();
    this.particleSystem.clear();
    const behavior = this.getModeBehavior();
    behavior.setupMode(this);
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const spec = this.getLauncherSpec();
    this.updateAimFromAngle(spec.defaultAngle);
    this.refreshDiscovery();
    this.notifyUI();
  },

  startMergeMode() {
    this.resetRunState(GAME_MODES.MERGE);
    this.audioManager.stopAll();
    this.particleSystem.clear();
    const behavior = this.getModeBehavior();
    behavior.setupMode(this);
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    behavior.syncLauncherBallTier?.(this, this.currentBall);
    behavior.syncLauncherBallTier?.(this, this.nextBall);
    this.state = GAME_STATES.PLAYING;
    const spec = this.getLauncherSpec();
    this.updateAimFromAngle(spec.defaultAngle);
    this.refreshDiscovery();
    this.notifyUI();
  },
};
