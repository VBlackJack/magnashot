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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { Ball } from '../src/entities/Ball.js';
import { CLUSTER_MODIFIERS, GAME_MODES, SPECIAL_TYPES } from '../src/core/Constants.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { MAGNETAR_BEHAVIOURS, MAGNETAR_PHASES } from '../src/game/MagnetarRules.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const campaignConfig = loadJson('./configs/campaign.json');
const campaignTuning = loadJson('./configs/campaignTuning.json');
const fluxConfig = loadJson('./configs/flux.json');
const audioConfig = loadJson('./configs/audio.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('campaign', campaignConfig);
configRegistry.configs.set('audio', audioConfig);

const cfg = gameConfig.magnetar;
const RADIUS = physicsConfig.ball.radius;
const FLUX_SEEDS = ['tilt01', 'mag001', 'mag002', 'mag003', 'mag004', 'mag005', 'mag006'];
const FIRST_BOSS_STAGE = fluxConfig.bossStageInterval;
const NATURAL_TURNS = 40;
const AIM_RUN_STEPS = 600;
const INNER_RING = gameConfig.bossRush.innerRingCount;
const PROBE_ANGLE = -1.45;
const NEAR_ZERO = 1e-6;

const createTestEngine = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  const dummyAudio = { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} };
  const announcements = [];
  const engine = new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    campaignConfig,
    campaignTuning,
    fluxConfig,
    audioManager: dummyAudio,
    storageManager,
    onStateChange: (_engine, extra) => {
      if (extra?.magnetarAnnouncement) {
        announcements.push(extra.magnetarAnnouncement);
      }
    }
  });
  engine.announcements = announcements;
  return engine;
};

const bossRushEngine = (wave = 1) => {
  const engine = createTestEngine();
  engine.startBossRushMode(wave);
  return engine;
};

/** Puts the Magnetar straight into the armed phase of a behaviour, like a warning would. */
const arm = (engine, behaviour) => {
  const magnetar = engine.magnetar;
  magnetar.phase = MAGNETAR_PHASES.ARMED;
  magnetar.armed = behaviour;
  magnetar.step += 1;
  magnetar.plan = engine.planMagnetarBehaviour(engine.getMagnetarBall());
  engine.applyMagnetarArmedEffects();
};

/** Makes the next resolved turn the one where the armed behaviour acts. */
const endTurn = (engine) => engine.advanceMagnetarTurn();

const restTurns = (engine) => {
  engine.magnetar.phase = MAGNETAR_PHASES.REST;
  engine.magnetar.armed = null;
  engine.magnetar.restLeft = 99;
};

const lastPoint = (engine) => engine.aimPoints[engine.aimPoints.length - 1];

const setShotColor = (engine, polarity) => {
  const color = ballsConfig.standardColors.find((c) => Math.sign(c.polarity || 0) === polarity);
  engine.currentBall.colorId = color.id;
  return color.id;
};

/** Clears the outer ring next to the core, so Regrow has room to plan slots. */
const clearOuterRing = (engine) => {
  const world = engine.physicsWorld;
  const keep = new Set([engine.magnetar.ballId, ...engine.refreshMoorings(false)]);
  for (const ball of [...world.balls]) {
    if (!keep.has(ball.id)) {
      world.removeBall(ball);
    }
  }
};

const removeMoorings = (engine, keep = 0) => {
  const world = engine.physicsWorld;
  for (const id of engine.refreshMoorings(false).slice(keep)) {
    world.removeBall(world.ballMap.get(id));
  }
  engine.refreshMoorings(false);
};

test('a Boss Rush wave starts with a colourless Magnetar held up by the inner ring', () => {
  const engine = bossRushEngine(3);
  const ball = engine.getMagnetarBall();
  assert.equal(ball.clusterModifier, CLUSTER_MODIFIERS.MAGNETAR);
  assert.equal(ball.colorId, null);
  assert.equal(ball.isAnchor, false);
  const view = engine.getMagnetarView();
  assert.equal(view.ballId, ball.id);
  assert.equal(view.tier, 3);
  assert.equal(view.moorings, INNER_RING);
  assert.equal(view.phase, MAGNETAR_PHASES.REST);
  assert.equal(view.armed, null);
  assert.deepEqual(view.regrowSlots, []);
  assert.equal(view.undertow, null);
  assert.deepEqual(view.barrageMarkers, []);
  assert.deepEqual(view.charges, []);
  for (const id of view.mooringIds) {
    assert.equal(engine.physicsWorld.ballMap.get(id).isAnchor, true);
  }
  assert.equal(engine.getBossBall(), ball);
  assert.equal(engine.magnetar.key, 'bossRush:magnetar:3');
});

test('the tier follows the wave and caps at the highest tier', () => {
  assert.equal(bossRushEngine(1).getMagnetarView().tier, 1);
  assert.equal(bossRushEngine(cfg.maxTier + 3).getMagnetarView().tier, cfg.maxTier);
});

test('the launcher polarity reads in Boss Rush and stays empty in a mode without Magnetar or duel', () => {
  const engine = bossRushEngine(1);
  assert.ok([1, -1].includes(engine.getVersusShotPolarity()));
  const endless = createTestEngine();
  endless.startEndlessMode();
  assert.equal(endless.getVersusShotPolarity(), null);
});

test('a warning appears at the end of turn k and works on turn k+1', () => {
  const engine = bossRushEngine(1);
  const cadence = cfg.cadenceByTier[1];
  for (let turn = 1; turn < cadence; turn++) {
    endTurn(engine);
    assert.equal(engine.magnetar.phase, MAGNETAR_PHASES.REST, `rest turn ${turn}`);
  }
  endTurn(engine);
  const view = engine.getMagnetarView();
  assert.equal(view.phase, MAGNETAR_PHASES.ARMED, 'the warning shows at the end of the cadence turn');
  assert.ok(view.armed);
  assert.deepEqual(engine.announcements.at(-1), { kind: 'armed', behaviour: view.armed });
  const hasEffect = engine.physicsWorld.boardPolarityInverted || engine.physicsWorld.projectileFields.length > 0;
  assert.equal(hasEffect, true, 'a tier 1 behaviour already works for the next shot');

  endTurn(engine);
  assert.equal(engine.getMagnetarView().phase, MAGNETAR_PHASES.REST, 'it acted once and rests again');
  assert.equal(engine.physicsWorld.boardPolarityInverted, false);
  assert.equal(engine.physicsWorld.projectileFields.length, 0);
});

test('the same wave key gives the same behaviour schedule, and no behaviour twice in a row', () => {
  const run = () => {
    const engine = bossRushEngine(4);
    const armed = [];
    for (let turn = 0; turn < NATURAL_TURNS; turn++) {
      engine.advanceMagnetarTurn();
      if (engine.announcements.length > armed.length) {
        armed.push(engine.announcements.at(-1).behaviour);
      }
    }
    return armed;
  };
  const first = run();
  assert.ok(first.length > 3);
  assert.deepEqual(run(), first);
  first.forEach((behaviour, index) => {
    if (index > 0) {
      assert.notEqual(behaviour, first[index - 1]);
    }
  });
});

test('Reverse Field mirrors the preview and a polarity flip cancels it', () => {
  const engine = bossRushEngine(1);
  setShotColor(engine, 1);
  engine.updateAimFromAngle(PROBE_ANGLE);
  const plain = { ...lastPoint(engine) };

  arm(engine, MAGNETAR_BEHAVIOURS.INVERT);
  engine.updateAimFromAngle(PROBE_ANGLE);
  const inverted = { ...lastPoint(engine) };
  assert.ok(Math.hypot(inverted.x - plain.x, inverted.y - plain.y) > NEAR_ZERO, 'the preview shows the reversed path');

  engine.isPolarityFlipped = true;
  engine.updateAimFromAngle(PROBE_ANGLE);
  const cancelled = lastPoint(engine);
  assert.ok(
    Math.hypot(cancelled.x - plain.x, cancelled.y - plain.y) <= NEAR_ZERO,
    'flipping the polarity cancels the reversed field'
  );
});

test('Undertow bends the preview and the real shot the same way', () => {
  const engine = bossRushEngine(1);
  setShotColor(engine, 1);
  engine.updateAimFromAngle(PROBE_ANGLE);
  const plainEnd = { ...lastPoint(engine) };

  arm(engine, MAGNETAR_BEHAVIOURS.UNDERTOW);
  const view = engine.getMagnetarView();
  assert.equal(view.undertow.radius, cfg.undertow.radiusFactor * RADIUS);
  assert.equal(view.undertow.x, engine.getMagnetarBall().x);
  engine.updateAimFromAngle(PROBE_ANGLE);
  const bentEnd = { ...lastPoint(engine) };
  assert.ok(Math.hypot(bentEnd.x - plainEnd.x, bentEnd.y - plainEnd.y) > NEAR_ZERO, 'the preview bends');

  // The real shot flies through the same motion code: it lands where the preview ends.
  const world = engine.physicsWorld;
  const before = new Set(world.balls.map((b) => b.id));
  engine.aimAngle = PROBE_ANGLE;
  engine.shoot();
  for (let i = 0; i < AIM_RUN_STEPS && world.projectile; i++) {
    engine.update();
  }
  assert.equal(world.projectile, null);
  const landed = world.balls.concat(world.droppingBalls).filter((b) => !before.has(b.id));
  assert.ok(landed.length > 0 || world.balls.length < before.size, 'the shot resolved on the board');
  if (landed.length > 0) {
    const snapped = landed[0];
    assert.ok(Math.hypot(snapped.x - bentEnd.x, snapped.y - bentEnd.y) < RADIUS * 4, 'real shot lands at the previewed end');
  }
});

test('Regrow plans free slots at the warning and grows only non-anchors in the slots left free', () => {
  const engine = bossRushEngine(2);
  const world = engine.physicsWorld;
  // The rings leave no room next to the core: clearing them opens the slots.
  removeMoorings(engine, INNER_RING - 3);
  clearOuterRing(engine);
  arm(engine, MAGNETAR_BEHAVIOURS.REGROW);
  const slots = engine.getMagnetarView().regrowSlots;
  assert.ok(slots.length > 0 && slots.length <= cfg.regrow.count);
  for (const slot of slots) {
    assert.ok(world.balls.every((b) => Math.hypot(b.x - slot.x, b.y - slot.y) >= RADIUS * 1.8), 'slots are free');
  }
  // The player fills the first slot before the behaviour acts.
  const filler = new Ball({ x: slots[0].x, y: slots[0].y, radius: RADIUS, colorId: ballsConfig.standardColors[0].id });
  world.addBall(filler);
  const before = world.balls.length;
  endTurn(engine);
  const grown = world.balls.length - before;
  assert.equal(grown, slots.length - 1, 'a filled slot blocks its growth');
  const newcomers = world.balls.slice(before);
  assert.ok(newcomers.every((b) => !b.isAnchor && b.colorId));
  assert.equal(engine.getMagnetarView().armed, null);
  assert.equal(engine.getMagnetarView().phase, MAGNETAR_PHASES.REST);
});

test('Regrow is repeatable: the same key and step give the same slots and colours', () => {
  const grow = () => {
    const engine = bossRushEngine(2);
    removeMoorings(engine, INNER_RING - 3);
    clearOuterRing(engine);
    arm(engine, MAGNETAR_BEHAVIOURS.REGROW);
    const slots = engine.getMagnetarView().regrowSlots;
    const before = engine.physicsWorld.balls.length;
    endTurn(engine);
    return { slots, colours: engine.physicsWorld.balls.slice(before).map((b) => b.colorId) };
  };
  const a = grow();
  assert.deepEqual(grow(), a);
});

test('Barrage shows its markers, fires charges, lands them after the rise turns and is wiped by opposite shots', () => {
  const engine = bossRushEngine(3);
  const world = engine.physicsWorld;
  arm(engine, MAGNETAR_BEHAVIOURS.BARRAGE);
  const view = engine.getMagnetarView();
  assert.equal(view.barrageMarkers.length, cfg.barrage.countByTier[3]);
  assert.ok(view.barrageMarkers.every((m) => [1, -1].includes(m.polarity) && Number.isFinite(m.x)));

  endTurn(engine);
  const fired = engine.getMagnetarView().charges;
  assert.equal(fired.length, view.barrageMarkers.length);
  assert.deepEqual(fired.map((c) => c.polarity), view.barrageMarkers.map((m) => m.polarity));
  assert.ok(fired.every((c) => c.progress === 0));

  restTurns(engine);
  const spheres = world.balls.length;
  endTurn(engine);
  assert.equal(engine.getMagnetarView().charges.length, fired.length, 'still rising after one turn');
  assert.equal(world.balls.length, spheres);
  endTurn(engine);
  assert.equal(engine.getMagnetarView().charges.length, 0, 'landed after the rise turns');
  assert.ok(world.balls.length > spheres, 'the charges snapped into the cluster');
});

test('an opposite polarity shot shatters a charge and fills Overcharge, the same polarity bounces off', () => {
  const engine = bossRushEngine(3);
  const world = engine.physicsWorld;
  arm(engine, MAGNETAR_BEHAVIOURS.BARRAGE);
  endTurn(engine);
  restTurns(engine);
  const charge = engine.magnetar.charges[0];
  charge.strength = 1;
  const chargeX = charge.x;
  const chargeY = charge.y;

  const shoot = (polarity) => {
    const colorId = setShotColor(engine, polarity);
    const projectile = new Ball({ x: chargeX, y: chargeY + RADIUS * 2, radius: RADIUS, colorId, isProjectile: true });
    projectile.vx = 0;
    projectile.vy = -physicsConfig.ball.projectileSpeed;
    projectile.savePreviousPosition();
    projectile.y = chargeY - RADIUS;
    projectile.isPolarityFlipped = false;
    world.projectile = projectile;
    return projectile;
  };

  const same = shoot(charge.polarity);
  engine.stepMagnetarAfter(same);
  assert.equal(engine.magnetar.charges.length > 0, true, 'the charge survives a same polarity shot');
  assert.equal(world.projectile, same, 'the shot keeps flying');
  assert.ok(same.magnetarHitIds.has(charge.id), 'the charge it bounced off is not hit twice');

  world.projectile = null;
  const overchargeBefore = engine.overcharge;
  const opposite = shoot(-charge.polarity);
  const count = engine.magnetar.charges.length;
  engine.stepMagnetarAfter(opposite);
  assert.equal(engine.magnetar.charges.length, count - 1, 'the charge is neutralised');
  assert.equal(world.projectile, null, 'the shot is consumed');
  assert.notEqual(engine.overcharge, overchargeBefore, 'neutralising pays Overcharge');
});

test('the Magnetar is immune to a bomb, a forced strike and a match around it', () => {
  const engine = bossRushEngine(1);
  const world = engine.physicsWorld;
  const magnetar = engine.getMagnetarBall();
  assert.equal(engine.destroyClusterBall(magnetar, '#ffffff', true), false);
  assert.ok(world.ballMap.has(magnetar.id));

  const bomb = new Ball({
    x: magnetar.x,
    y: magnetar.y + RADIUS * 2.5,
    radius: RADIUS,
    colorId: null,
    specialType: SPECIAL_TYPES.BOMB,
    isProjectile: true
  });
  world.addBall(bomb);
  engine.handleProjectileSnapped(bomb);
  assert.ok(world.ballMap.has(magnetar.id), 'a bomb next to it does not remove it');

  assert.equal(world.findColorCluster(magnetar).length <= 1, true, 'it never joins a colour cluster');
});

test('the preview never lists the Magnetar among the spheres a shot destroys', async () => {
  const { predictImpact } = await import('../src/game/ImpactPreview.js');
  const engine = bossRushEngine(1);
  const magnetar = engine.getMagnetarBall();
  const world = engine.physicsWorld;
  for (const specialType of [SPECIAL_TYPES.BOMB, SPECIAL_TYPES.LIGHTNING, SPECIAL_TYPES.ROCKET]) {
    const out = predictImpact({
      points: [{ x: magnetar.x, y: magnetar.y }],
      currentBall: { specialType, radius: RADIUS, colorId: null },
      physicsWorld: world,
      endX: magnetar.x,
      endY: magnetar.y,
      blastMult: 1,
      specialTypes: ballsConfig.specialTypes,
      matchMinCount: gameConfig.defaults.matchMinCount
    });
    assert.equal(out.destroyedIds.has(magnetar.id), false, specialType);
  }
});

test('a Magnetar left with no Mooring falls, pays once and advances the wave', () => {
  const engine = bossRushEngine(1);
  const worldBefore = engine.physicsWorld;
  const scoreBefore = engine.score;
  const coinsBefore = engine.runCoinsEarned;
  const sphereCount = worldBefore.balls.length;
  removeMoorings(engine, 0);
  engine.handlePostTurnCleanup(true);

  assert.equal(engine.bossRushWave, 2, 'the wave advances');
  const expectedPoints = cfg.fall.pointsBase + cfg.fall.pointsPerSphere * (sphereCount - INNER_RING - 1);
  assert.ok(engine.score - scoreBefore >= expectedPoints, 'the fall pays its points');
  assert.ok(engine.runCoinsEarned - coinsBefore >= cfg.fall.coins);
  assert.equal(engine.bossesDestroyedInRun, 1);
  assert.equal(engine.storageManager.getAchievementRecords().magnetarsGrounded, 1);
  assert.ok(engine.storageManager.getUnlockedAchievements().magnetarsGrounded);
  assert.equal(engine.storageManager.getUnlockedAchievements().magnetarLandslide, undefined);
  assert.ok(engine.announcements.some((a) => a.kind === 'down'));
  assert.equal(engine.getMagnetarView().tier, 2, 'the next wave brings a stronger Magnetar');
});

test('an avalanche of at least landslideMin spheres counts as a landslide', () => {
  const engine = bossRushEngine(1);
  const world = engine.physicsWorld;
  const magnetar = engine.getMagnetarBall();
  const extra = cfg.fall.landslideMin;
  for (let i = 0; i < extra; i++) {
    const ball = new Ball({
      x: magnetar.x + (i % 5) * RADIUS * 2,
      y: magnetar.y + RADIUS * 4 + Math.floor(i / 5) * RADIUS * 2,
      radius: RADIUS,
      colorId: ballsConfig.standardColors[0].id
    });
    world.addBall(ball);
    world.createBond(ball, magnetar, false);
  }
  removeMoorings(engine, 0);
  engine.handlePostTurnCleanup(true);
  assert.ok(engine.storageManager.getAchievementRecords().magnetarLandslide >= 1);
  assert.ok(engine.storageManager.getUnlockedAchievements().magnetarLandslide);
});

test('an Overcharge strike snaps the lowest-id Mooring, and Moorings never come back', () => {
  const engine = bossRushEngine(1);
  const world = engine.physicsWorld;
  const first = engine.refreshMoorings(false);
  const lowest = Math.min(...first);
  const counts = [first.length];
  engine.addOvercharge(gameConfig.scoring.overchargeMax);
  assert.equal(world.ballMap.has(lowest), false, 'the lowest id was snapped');
  counts.push(engine.getMagnetarView().moorings);
  assert.equal(counts[1], counts[0] - 1);

  // New spheres, Regrow and a Barrage never add a Mooring.
  arm(engine, MAGNETAR_BEHAVIOURS.REGROW);
  endTurn(engine);
  restTurns(engine);
  counts.push(engine.getMagnetarView().moorings);
  engine.refreshMoorings(false);
  counts.push(engine.getMagnetarView().moorings);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] <= counts[i - 1], `Moorings only go down: ${counts.join(',')}`);
  }
});

test('the last Mooring left is announced', () => {
  const engine = bossRushEngine(1);
  removeMoorings(engine, 2);
  engine.announcements.length = 0;
  engine.addOvercharge(gameConfig.scoring.overchargeMax);
  assert.equal(engine.getMagnetarView().moorings, 1);
  assert.ok(engine.announcements.some((a) => a.kind === 'lastMooring'));
});

test('an armed Magnetar survives a save and reload with the same schedule and effects', () => {
  const engine = bossRushEngine(2);
  arm(engine, MAGNETAR_BEHAVIOURS.UNDERTOW);
  engine.saveRunSnapshot({ force: true });
  const saved = engine.storageManager.loadRunSnapshot();
  assert.ok(saved.magnetar);
  assert.equal('mooringIds' in saved.magnetar, false);

  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  assert.equal(resumed.restoreSavedRun(), true);
  const view = resumed.getMagnetarView();
  assert.equal(view.armed, MAGNETAR_BEHAVIOURS.UNDERTOW);
  assert.equal(view.moorings, engine.getMagnetarView().moorings);
  assert.equal(resumed.physicsWorld.projectileFields.length, 1);
  assert.equal(resumed.getMagnetarBall().clusterModifier, CLUSTER_MODIFIERS.MAGNETAR);
  assert.equal(resumed.magnetar.step, engine.magnetar.step);
  assert.equal(resumed.magnetar.previous, engine.magnetar.previous);

  resumed.state = 'playing';
  resumed.advanceMagnetarTurn();
  assert.equal(resumed.getMagnetarView().phase, MAGNETAR_PHASES.REST, 'the restored warning acts next turn');
});

test('a Barrage in flight is saved with its charges', () => {
  const engine = bossRushEngine(3);
  arm(engine, MAGNETAR_BEHAVIOURS.BARRAGE);
  endTurn(engine);
  engine.saveRunSnapshot({ force: true });
  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  assert.equal(resumed.restoreSavedRun(), true);
  assert.deepEqual(
    resumed.getMagnetarView().charges.map((c) => [c.id, c.polarity, c.strength]),
    engine.getMagnetarView().charges.map((c) => [c.id, c.polarity, c.strength])
  );
});

test('a run saved without a Magnetar schedule resumes it at step 0, and a Titan board resumes as a Titan', () => {
  const engine = bossRushEngine(2);
  engine.saveRunSnapshot({ force: true });
  const snapshot = engine.storageManager.loadRunSnapshot();
  delete snapshot.magnetar;
  engine.storageManager.saveRunSnapshot(snapshot);
  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  assert.equal(resumed.restoreSavedRun(), true);
  assert.equal(resumed.magnetar.step, 0);
  assert.equal(resumed.magnetar.phase, MAGNETAR_PHASES.REST);

  // A v1.20 run: the boss is a Boss Core and the snapshot has no Magnetar.
  const legacy = engine.storageManager.loadRunSnapshot();
  const boss = legacy.balls.find((b) => b.clusterModifier === CLUSTER_MODIFIERS.MAGNETAR);
  boss.clusterModifier = CLUSTER_MODIFIERS.BOSS_CORE;
  boss.isAnchor = true;
  boss.colorId = ballsConfig.standardColors[0].id;
  boss.armorHits = ballsConfig.clusterModifiers.bossCore.initialArmor;
  engine.storageManager.saveRunSnapshot(legacy);
  const titan = createTestEngine();
  titan.storageManager = engine.storageManager;
  assert.equal(titan.restoreSavedRun(), true);
  assert.equal(titan.magnetar, null);
  assert.equal(titan.getMagnetarView(), null);
  assert.equal(titan.getBossBall().clusterModifier, CLUSTER_MODIFIERS.BOSS_CORE);
});

const findFluxBossEngine = () => {
  for (const seed of FLUX_SEEDS) {
    const engine = createTestEngine();
    engine.restoreFluxRun(seed, FIRST_BOSS_STAGE, null);
    if (engine.magnetar) {
      return engine;
    }
  }
  return null;
};

test('a Flux boss stage holds a Magnetar and is won when it falls', () => {
  const engine = findFluxBossEngine();
  assert.ok(engine, 'some seed gives a Magnetar on its first boss stage');
  assert.equal(engine.fluxIsBossStage, true);
  assert.equal(engine.magnetar.key, `${engine.fluxSeed}:magnetar:${FIRST_BOSS_STAGE}`);
  assert.equal(engine.getMagnetarView().tier, 1);

  const scoreBefore = engine.score;
  removeMoorings(engine, 0);
  engine.handlePostTurnCleanup(true);
  assert.ok(engine.stageTransitionFrames > 0 || engine.fluxStage > FIRST_BOSS_STAGE, 'the stage is cleared');
  assert.ok(engine.score - scoreBefore >= cfg.fall.pointsBase);
});

test('a normal Flux stage has no Magnetar', () => {
  const engine = createTestEngine();
  engine.restoreFluxRun('tilt01', 2, null);
  assert.equal(engine.magnetar, null);
  assert.equal(engine.getMagnetarView(), null);
});

test('the campaign, Daily, Classic and duels never get a Magnetar', () => {
  assert.equal(campaignConfig.generated.magnetar.enabled, false);
  const modes = [
    (e) => e.startEndlessMode(),
    (e) => e.startClassicMode(1),
    (e) => e.startDailyChallenge('2026-11-09'),
    (e) => e.startCascadeMode(),
    (e) => e.startBlitzMode()
  ];
  for (const start of modes) {
    const engine = createTestEngine();
    start(engine);
    assert.equal(engine.shouldUseMagnetar(), false, engine.mode);
    assert.equal(engine.magnetar, null, engine.mode);
  }
  const duel = createTestEngine();
  duel.startVersusBoard({ seedKey: 'duel' });
  assert.equal(duel.shouldUseMagnetar(), false);
});

test('calibration guard: no campaign landmark holds a Magnetar and campaign levels never set one', () => {
  const engine = createTestEngine();
  const catalog = engine.levelCatalog;
  const weights = JSON.stringify(gameConfig);
  assert.equal(JSON.stringify(gameConfig.endless.modifierWeights).includes('magnetar'), false);
  assert.ok(weights.includes('magnetar'));
  for (let id = catalog.firstId; id <= catalog.lastId; id++) {
    const definition = catalog.get(id);
    assert.equal(JSON.stringify(definition).toLowerCase().includes('magnetar'), false, `level ${id} definition`);
    engine.startCampaignLevel(id);
    assert.equal(engine.mode, GAME_MODES.CAMPAIGN);
    assert.equal(engine.magnetar, null, `level ${id}`);
    assert.equal(
      engine.physicsWorld.balls.some((b) => b.clusterModifier === CLUSTER_MODIFIERS.MAGNETAR),
      false,
      `level ${id} board`
    );
  }
});
