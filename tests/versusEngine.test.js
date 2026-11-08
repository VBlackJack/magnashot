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
import { createVersusStorageView } from '../src/core/StorageView.js';
import { createAudioChannel } from '../src/core/AudioChannel.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { GAME_STATES, SPECIAL_TYPES } from '../src/core/Constants.js';
import { GameEngine, ENGINE_ROLES } from '../src/game/GameEngine.js';
import { createVersusMatch, MATCH_EVENTS, MATCH_PHASES } from '../src/game/VersusMatch.js';
import { createCharge, chargePolarityForColor } from '../src/game/VersusRules.js';

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
configRegistry.configs.set('flux', fluxConfig);

const configs = {
  gameConfig,
  physicsConfig,
  ballsConfig,
  obstaclesConfig,
  levelsConfig,
  campaignConfig,
  campaignTuning,
  fluxConfig
};

const versusCfg = gameConfig.versus;
const SEED_KEY = 'versus:engine-test:r0';
const POSITIVE_COLOR = 'crimson';
const NEGATIVE_COLOR = 'cobalt';
const FAR_RISE_FRAMES = 1e9;
const STRAIGHT_UP = -Math.PI / 2;
const SHOT_FRAME_CAP = 600;
const LAND_FRAME_CAP = versusCfg.riseFrames + versusCfg.chargeStaggerFrames * 10 + 120;
const SPY_AUDIO = { playEffect() {}, stopAll() {}, isMuted: () => true, setMuted() {} };
const PULSE_FRAME_CAP = 3;
const BOMB_FACTOR = ballsConfig.specialTypes.bomb.blastRadiusFactor;
const LIGHTNING_FACTOR = ballsConfig.specialTypes.lightning.bandHalfHeightFactor;
const RADIUS_MARGIN = 2;
const SHORT_SUDDEN_START_SECONDS = 4;
const SUDDEN_ROUND_FRAME_FACTOR = 40;
const SHORT_SUDDEN_INTERVAL_SECONDS = 2;

const createManager = () => {
  const manager = new StorageManager();
  manager.init();
  return manager;
};

const createBoard = (boardIndex = 0, seedKey = SEED_KEY) => {
  const engine = new GameEngine({
    ...configs,
    storageManager: createVersusStorageView(createManager()),
    audioManager: createAudioChannel(SPY_AUDIO, { muted: true }),
    onStateChange: () => {},
    role: ENGINE_ROLES.VERSUS
  });
  engine.startVersusBoard({ seedKey, boardIndex });
  return engine;
};

/** A charge that stays where it is put (it rises over a practically endless time). */
const placeCharge = (engine, { polarity, strength = 1, x, y }) => {
  const charge = createCharge({
    polarity,
    strength,
    x,
    startY: y,
    targetY: y - 1,
    riseFrames: FAR_RISE_FRAMES,
    id: engine.versus.chargeSeq++
  });
  charge.age = 0;
  charge.progress = 0;
  charge.threatening = false;
  engine.versus.charges.push(charge);
  return charge;
};

/** Loads a colour ball, aims straight up and fires. */
const fireColor = (engine, colorId, { flip = false } = {}) => {
  if (engine.isPolarityFlipped !== flip) {
    engine.togglePolarityFlip();
  }
  engine.currentBall = engine.createRandomLauncherBall(null, colorId);
  engine.updateAimFromAngle(STRAIGHT_UP);
  engine.shoot();
};

/** Steps until the shot in flight is gone, or the cap. */
const settleShot = (engine) => {
  for (let i = 0; i < SHOT_FRAME_CAP && engine.physicsWorld.projectile; i++) {
    engine.update();
  }
};

/** Y between the launcher and the underside of the cluster, on the straight-up path. */
const pathCharge = (engine, spec) => {
  const y = (engine.getClusterUndersideY() + engine.gameConfig.canvas.launcherY) / 2;
  return placeCharge(engine, { ...spec, x: engine.gameConfig.canvas.launcherX, y });
};

const drainEventTypes = (engine) => engine.drainVersusOutput().events.map((event) => event.type);

test('the charge radius is a multiple of the ball radius', () => {
  const engine = createBoard();
  assert.equal(engine.getChargeRadius(), versusCfg.chargeRadius * physicsConfig.ball.radius);
});

test('a turn sends charges of the polarity of its colour, strong ones in pairs of two spheres', () => {
  const engine = createBoard();
  engine.beginVersusTurn({ colorId: NEGATIVE_COLOR });
  engine.noteVersusDrop(3, NEGATIVE_COLOR);
  assert.equal(engine.closeVersusTurn().sent, 1);
  const [weak] = engine.drainVersusOutput().outbox;
  assert.deepEqual(weak, { type: 'charges', count: 1, strength: 1, polarity: chargePolarityForColor(NEGATIVE_COLOR, versusCfg, engine.physicsWorld.polarityMap) });

  engine.beginVersusTurn({ colorId: POSITIVE_COLOR });
  engine.noteVersusDrop(8, POSITIVE_COLOR);
  engine.noteVersusLink();
  const attack = engine.closeVersusTurn();
  assert.equal(attack.isStrong, true);
  const [strong] = engine.drainVersusOutput().outbox;
  assert.equal(strong.strength, 2);
  assert.equal(strong.count, Math.floor(attack.sent / 2));
  assert.equal(strong.polarity, 1);

  engine.beginVersusTurn({ colorId: POSITIVE_COLOR });
  engine.noteVersusDrop(1, POSITIVE_COLOR);
  engine.closeVersusTurn();
  assert.deepEqual(engine.drainVersusOutput().outbox, [], 'a match that drops one sphere sends nothing');
});

test('a strong attack of an odd size sends pairs plus one single charge, total preserved', () => {
  const engine = createBoard();
  engine.beginVersusTurn({ colorId: POSITIVE_COLOR });
  engine.noteVersusDrop(11, POSITIVE_COLOR);
  const attack = engine.closeVersusTurn();
  assert.equal(attack.sent, 5);
  assert.equal(attack.isStrong, true);
  const { outbox } = engine.drainVersusOutput();
  assert.deepEqual(outbox.map((item) => [item.count, item.strength]), [[2, 2], [1, 1]]);
  assert.equal(outbox.reduce((sum, item) => sum + item.count * item.strength, 0), attack.sent);
});

test('a special ball multiplies the attack of its turn', () => {
  const engine = createBoard();
  engine.beginVersusTurn({ colorId: null, specialType: SPECIAL_TYPES.BOMB });
  engine.noteVersusDrop(5, POSITIVE_COLOR);
  const attack = engine.closeVersusTurn();
  const plain = (5 - versusCfg.attack.freeDroppedSpheres) * versusCfg.attack.dropWeight;
  assert.equal(attack.raw, plain * versusCfg.attack.specialMultiplier);
});

test('a turn is closed by the board once it has been quiet, without waiting for the next shot', () => {
  const engine = createBoard();
  engine.beginVersusTurn({ colorId: POSITIVE_COLOR });
  engine.noteVersusDrop(5, POSITIVE_COLOR);
  for (let i = 0; i < versusCfg.turnSettleFrames + 1; i++) {
    engine.update();
  }
  assert.equal(engine.versus.turn.isOpen, false);
  assert.equal(engine.versus.totals.turns, 1);
  assert.equal(engine.drainVersusOutput().outbox.length, 1);
});

test('a cleared board sends the configured charges and rebuilds from the next stage stream', () => {
  const engine = createBoard();
  engine.physicsWorld.clear();
  engine.completeClassicStage();
  const [clear] = engine.drainVersusOutput().outbox;
  assert.equal(clear.count, versusCfg.attack.boardClearCharges);
  assert.equal(engine.classicStage, 2);
  const reference = createBoard();
  reference.startVersusBoard({ seedKey: SEED_KEY, stage: 2 });
  assert.deepEqual(
    engine.physicsWorld.balls.map((b) => [b.x, b.y, b.colorId]),
    reference.physicsWorld.balls.map((b) => [b.x, b.y, b.colorId])
  );
});

test('queued charges appear at the next step at the danger line, with x from the charge stream', () => {
  const first = createBoard(1);
  const second = createBoard(1);
  for (const engine of [first, second]) {
    engine.receiveVersusAttack({ count: 3, strength: 1, polarity: 1 });
    assert.equal(engine.versus.charges.length, 0, 'nothing appears before the step boundary');
    engine.update();
  }
  assert.equal(first.versus.charges.length, 3);
  const [lead] = first.versus.charges;
  assert.ok(lead.y <= gameConfig.canvas.dangerLineY && lead.y > gameConfig.canvas.dangerLineY - 5);
  assert.deepEqual(first.versus.charges.map((c) => c.x), second.versus.charges.map((c) => c.x));
  const margin = gameConfig.canvas.wallMargin + physicsConfig.ball.radius;
  for (const charge of first.versus.charges) {
    assert.ok(charge.x >= margin && charge.x <= gameConfig.canvas.logicalWidth - margin);
  }
  const other = createBoard(0);
  other.receiveVersusAttack({ count: 3, strength: 1, polarity: 1 });
  other.update();
  assert.notDeepEqual(other.versus.charges.map((c) => c.x), first.versus.charges.map((c) => c.x), 'each board has its own charge stream');
});

test('a charge rises, then snaps in as one sphere (two when strong) of its polarity without filling the Sag meter', () => {
  for (const strength of [1, 2]) {
    const engine = createBoard();
    const before = engine.physicsWorld.balls.length;
    const knownIds = new Set(engine.physicsWorld.balls.map((ball) => ball.id));
    engine.receiveVersusAttack({ count: 1, strength, polarity: -1 });
    let landedEvent = null;
    for (let i = 0; i < LAND_FRAME_CAP && !landedEvent; i++) {
      engine.update();
      landedEvent = engine.drainVersusOutput().events.find((event) => event.type === 'chargeLanded') ?? null;
    }
    assert.ok(landedEvent, `strength ${strength} must land`);
    assert.equal(engine.versus.charges.length, 0);
    assert.equal(landedEvent.balls, strength);
    assert.equal(engine.physicsWorld.balls.length, before + strength);
    assert.equal(engine.sagLevel, 0, 'landing does not fill the Sag meter');
    const landed = engine.physicsWorld.balls.filter((ball) => !knownIds.has(ball.id));
    assert.equal(landed.length, strength);
    for (const ball of landed) {
      assert.equal(chargePolarityForColor(ball.colorId, versusCfg, engine.physicsWorld.polarityMap), -1);
      assert.ok(ball.bonds.size > 0, 'a landed sphere is bonded to the cluster');
    }
  }
});

test('an opposite shot neutralises a charge, is consumed and charges the pulse meter', () => {
  const engine = createBoard();
  pathCharge(engine, { polarity: 1 });
  fireColor(engine, NEGATIVE_COLOR);
  settleShot(engine);
  assert.equal(engine.physicsWorld.projectile, null);
  assert.equal(engine.versus.charges.length, 0);
  assert.equal(engine.versus.stats.neutralised, 1);
  assert.equal(engine.physicsWorld.balls.length, createBoard().physicsWorld.balls.length, 'the shot snapped nowhere');
  assert.equal(engine.overcharge, versusCfg.neutraliseOverchargeGain * engine.getOverchargeCap());
  assert.equal(engine.sagLevel, 0, 'a neutralising shot is not a whiff');
  assert.ok(drainEventTypes(engine).includes('chargeNeutralised'));
});

test('the second sphere of a strong charge overlaps no other sphere wherever the charge lands', () => {
  const radius = physicsConfig.ball.radius;
  const minX = gameConfig.canvas.wallMargin + radius;
  const maxX = gameConfig.canvas.logicalWidth - gameConfig.canvas.wallMargin - radius;
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const engine = createBoard();
    const knownIds = new Set(engine.physicsWorld.balls.map((ball) => ball.id));
    const y = engine.getClusterUndersideY();
    engine.landVersusCharge({ id: 900 + i, polarity: 1, strength: 2, x: minX + ((maxX - minX) * i) / steps, y });
    const balls = engine.physicsWorld.balls;
    const landed = balls.filter((ball) => !knownIds.has(ball.id));
    assert.equal(landed.length, 2);
    const second = landed[1];
    for (const other of balls) {
      if (other.id !== second.id) {
        assert.ok(Math.hypot(second.x - other.x, second.y - other.y) >= radius * 2 * 0.85, `overlap at step ${i}`);
      }
    }
  }
});

test('a flipped shot has the opposite polarity of its colour', () => {
  const engine = createBoard();
  pathCharge(engine, { polarity: 1 });
  fireColor(engine, POSITIVE_COLOR, { flip: true });
  settleShot(engine);
  assert.equal(engine.versus.stats.neutralised, 1, 'a flipped positive shot stops a positive charge');
});

test('a strength 2 charge needs two opposite shots', () => {
  const engine = createBoard();
  const charge = pathCharge(engine, { polarity: -1, strength: 2 });
  fireColor(engine, POSITIVE_COLOR);
  settleShot(engine);
  assert.equal(engine.versus.charges.length, 1);
  assert.equal(charge.strength, 1);
  assert.equal(engine.versus.stats.weakened, 1);
  // The settled turn must be over before the second shot.
  for (let i = 0; i < physicsConfig.simulation.chainCheckCooldownFrames + 1; i++) {
    engine.update();
  }
  fireColor(engine, POSITIVE_COLOR);
  settleShot(engine);
  assert.equal(engine.versus.charges.length, 0);
  assert.equal(engine.versus.stats.neutralised, 1);
});

test('a same polarity shot is pushed away and keeps flying', () => {
  const engine = createBoard();
  const charge = pathCharge(engine, { polarity: 1, strength: 2 });
  fireColor(engine, POSITIVE_COLOR);
  const projectile = engine.physicsWorld.projectile;
  let deflected = false;
  for (let i = 0; i < SHOT_FRAME_CAP && engine.physicsWorld.projectile === projectile && !deflected; i++) {
    const vxBefore = projectile.vx;
    engine.update();
    deflected = engine.versus.stats.deflected > 0;
    if (deflected) {
      assert.equal(Math.sign(projectile.vx), -Math.sign(vxBefore) || Math.sign(projectile.vx), 'vx is reversed');
    }
  }
  assert.ok(deflected);
  assert.equal(charge.strength, 2, 'the charge is untouched');
  assert.equal(engine.versus.charges.length, 1);
  assert.equal(engine.physicsWorld.projectile, projectile, 'the shot keeps flying');
  assert.equal(engine.versus.stats.neutralised, 0);
});

test('a bomb neutralises the charges inside its blast radius and only those', () => {
  const engine = createBoard();
  const radius = physicsConfig.ball.radius * BOMB_FACTOR * engine.getBlastRadiusMultiplier();
  const center = { x: gameConfig.canvas.logicalWidth / 2, y: 300 };
  const inside = placeCharge(engine, { polarity: 1, strength: 2, x: center.x + radius - RADIUS_MARGIN, y: center.y });
  const outside = placeCharge(engine, { polarity: 1, x: center.x + radius + RADIUS_MARGIN, y: center.y });
  engine.neutraliseChargesBySpecial(SPECIAL_TYPES.BOMB, center.x, center.y);
  assert.deepEqual(engine.versus.charges, [outside]);
  assert.ok(!engine.versus.charges.includes(inside));
  assert.equal(engine.versus.stats.neutralised, 1, 'a strength 2 charge still counts as one');
});

test('a lightning band neutralises the charges in its height band across the whole width', () => {
  const engine = createBoard();
  const band = physicsConfig.ball.radius * LIGHTNING_FACTOR * engine.getBlastRadiusMultiplier();
  const y = 300;
  placeCharge(engine, { polarity: 1, x: gameConfig.canvas.wallMargin + physicsConfig.ball.radius, y: y + band - RADIUS_MARGIN });
  const outside = placeCharge(engine, { polarity: -1, x: 200, y: y + band + RADIUS_MARGIN });
  engine.neutraliseChargesBySpecial(SPECIAL_TYPES.LIGHTNING, gameConfig.canvas.logicalWidth / 2, y);
  assert.deepEqual(engine.versus.charges, [outside]);
});

test('a bomb shot calls the neutralisation of the charges when it goes off', () => {
  const engine = createBoard();
  const calls = [];
  const original = engine.neutraliseChargesBySpecial.bind(engine);
  engine.neutraliseChargesBySpecial = (type, x, y) => {
    calls.push(type);
    original(type, x, y);
  };
  engine.specialInventory[SPECIAL_TYPES.BOMB] = 1;
  engine.equipSpecialBall(SPECIAL_TYPES.BOMB);
  engine.updateAimFromAngle(STRAIGHT_UP);
  engine.shoot();
  settleShot(engine);
  assert.deepEqual(calls, [SPECIAL_TYPES.BOMB]);
});

test('three neutralised charges grant a seeded special, the same on a replay', () => {
  const grant = () => {
    const engine = createBoard();
    for (let i = 0; i < versusCfg.guardStreakSize; i++) {
      placeCharge(engine, { polarity: 1, x: 100 + i, y: 300 });
    }
    engine.neutraliseChargesBySpecial(SPECIAL_TYPES.BOMB, 100, 300);
    return { inventory: { ...engine.specialInventory }, streak: engine.versus.guard.streak, granted: engine.versus.stats.specialsGranted };
  };
  const first = grant();
  assert.equal(first.granted, 1);
  assert.equal(first.streak, 0);
  assert.equal(Object.values(first.inventory).reduce((sum, n) => sum + n, 0), 1);
  assert.deepEqual(grant(), first);
});

test('a full Overcharge fires the field pulse instead of granting a special', () => {
  const engine = createBoard();
  const normalMax = gameConfig.scoring.overchargeMax;
  assert.equal(engine.getOverchargeCap(), normalMax * versusCfg.overchargeMaxMultiplier);
  engine.addOvercharge(normalMax);
  assert.deepEqual(engine.drainVersusOutput().outbox, [], 'a normal full meter is only half of a duel meter');
  engine.addOvercharge(normalMax);
  const { outbox } = engine.drainVersusOutput();
  assert.deepEqual(outbox, [{ type: 'pulse' }]);
  assert.equal(Object.values(engine.specialInventory).reduce((sum, n) => sum + n, 0), 0);
  assert.ok(engine.overcharge < PULSE_FRAME_CAP, 'the meter resets');
});

test('a field pulse lowers the anchor rail and can end the round', () => {
  const engine = createBoard();
  const lowestBefore = Math.max(...engine.physicsWorld.balls.map((b) => b.y));
  engine.receiveFieldPulse();
  assert.equal(engine.railDrops, 1);
  assert.equal(Math.max(...engine.physicsWorld.balls.map((b) => b.y)), lowestBefore + gameConfig.classic.descentStepY);
  assert.equal(engine.state, GAME_STATES.PLAYING);
  assert.ok(engine.railLowerFrames > 0, 'the rail eases down with its creak');

  const doomed = createBoard();
  const lowest = doomed.getClusterUndersideY();
  const margin = gameConfig.canvas.dangerLineY - lowest;
  const pulses = Math.ceil(margin / gameConfig.classic.descentStepY) + 1;
  for (let i = 0; i < pulses && doomed.state === GAME_STATES.PLAYING; i++) {
    doomed.receiveFieldPulse();
  }
  assert.equal(doomed.state, GAME_STATES.GAME_OVER);
  assert.ok(drainEventTypes(doomed).includes('boardLost'));
});

test('the aim preview stops at the first charge on its path and marks it', () => {
  const engine = createBoard();
  engine.updateAimFromAngle(STRAIGHT_UP);
  const fullEnd = engine.aimPoints.at(-1);
  const charge = pathCharge(engine, { polarity: -1 });
  engine.updateAimFromAngle(STRAIGHT_UP);
  assert.deepEqual(engine.aimPreview.chargeHit?.polarity, -1);
  assert.equal(engine.aimPoints.at(-1).y, fullEnd.y, 'an untruncated board keeps the full path for its bot');

  engine.setVersusAimTruncation(true);
  const end = engine.aimPoints.at(-1);
  assert.ok(end.y > charge.y - physicsConfig.ball.radius * 4 - 1 && end.y < charge.y + physicsConfig.ball.radius * 4);
  assert.ok(end.y > fullEnd.y, 'the path ends below the cluster, at the charge');
  assert.equal(engine.aimPoints.snapTarget, undefined, 'a cut path snaps nowhere');
  assert.equal(engine.aimPreview.chargeHit.x, end.x);
});

test('the aim preview predicts the outcome of the loaded shot on the first charge: shatter, weaken or bounce', () => {
  const engine = createBoard();
  const ball = engine.currentBall;
  const own = engine.getVersusShotPolarity();
  assert.ok(own === 1 || own === -1, 'a coloured sphere has a polarity');
  const outcomeFor = (polarity, strength = 1) => {
    engine.versus.charges = [];
    engine.updateAimFromAngle(STRAIGHT_UP);
    pathCharge(engine, { polarity, strength });
    engine.updateAimFromAngle(STRAIGHT_UP);
    return engine.aimPreview.chargeHit.outcome;
  };
  assert.equal(outcomeFor(-own), 'neutralised', 'opposite polarity shatters a strength 1 charge');
  assert.equal(outcomeFor(-own, 2), 'weakened', 'opposite polarity only weakens a strength 2 charge');
  assert.equal(outcomeFor(own), 'deflected', 'the same polarity bounces off');
  engine.togglePolarityFlip();
  assert.equal(engine.getVersusShotPolarity(), -own, 'the flip inverts the shot polarity');
  assert.equal(outcomeFor(own), 'neutralised', 'after the flip the prediction follows');
  assert.ok(Math.abs(engine.getVersusShotPolarity(engine.nextBall, false)) === 1, 'the next sphere has a polarity of its own');
  ball.specialType = SPECIAL_TYPES.BOMB;
  assert.equal(engine.getVersusShotPolarity(), null, 'a special sphere has no polarity');
  assert.equal(outcomeFor(own), null, 'a special shot makes no prediction');
});

test('engines of a single player run are not touched by the duel hooks', () => {
  const engine = new GameEngine({ ...configs, storageManager: createManager(), audioManager: SPY_AUDIO, onStateChange: () => {} });
  engine.startClassicMode();
  assert.equal(engine.versus, null);
  assert.equal(engine.getOverchargeCap(), gameConfig.scoring.overchargeMax);
  assert.equal(engine.getOverchargeMultiplier(), 0);
  engine.updateAimFromAngle(STRAIGHT_UP);
  assert.equal(engine.aimPreview, undefined);
});

test('sudden death lowers both rails on the clock until the round ends', () => {
  const idleTier = { thinkFrames: FAR_RISE_FRAMES, thinkJitterFrames: 0, noiseRad: 0, aimSamples: 4, policy: 'greedy' };
  // A short clock keeps the test fast; the rules read it from the config.
  const shortConfig = structuredClone(gameConfig);
  shortConfig.versus.suddenDeath = { startSeconds: SHORT_SUDDEN_START_SECONDS, intervalSeconds: SHORT_SUDDEN_INTERVAL_SECONDS };
  const match = createVersusMatch({
    seed: 'sudden-1',
    mode: 'cpu',
    playerBoard: null,
    cpuTiers: [idleTier, idleTier],
    configs: { ...configs, gameConfig: shortConfig },
    storageManager: createManager(),
    audioManager: SPY_AUDIO
  });
  const startFrames = SHORT_SUDDEN_START_SECONDS * versusCfg.framesPerSecond;
  while (match.getState().phase === MATCH_PHASES.PLAYING && match.getState().roundFrame < startFrames - 1) {
    match.step();
  }
  assert.equal(match.getEventLog().some((event) => event.type === MATCH_EVENTS.SUDDEN_DEATH), false);
  match.step();
  match.step();
  const pulses = match.getEventLog().filter((event) => event.type === MATCH_EVENTS.SUDDEN_DEATH);
  assert.equal(pulses.length, 1);
  assert.equal(match.getState().isSuddenDeath, true);
  assert.deepEqual(match.engines.map((engine) => engine.railDrops), [1, 1]);
  for (let i = 0; i < startFrames * SUDDEN_ROUND_FRAME_FACTOR && match.getState().phase === MATCH_PHASES.PLAYING; i++) {
    match.step();
  }
  assert.equal(match.getState().phase, MATCH_PHASES.ROUND_OVER);
  const received = match.getEventLog().filter((event) => event.type === MATCH_EVENTS.PULSE_RECEIVED && event.source === 'suddenDeath');
  assert.ok(received.length >= 2);
  assert.ok(match.getEventLog().some((event) => event.type === MATCH_EVENTS.ROUND_REPLAY), 'identical boards fall on the same pulse');
});
