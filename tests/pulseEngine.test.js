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
import { GAME_STATES } from '../src/core/Constants.js';
import { Ball } from '../src/entities/Ball.js';
import { GameEngine, ENGINE_ROLES } from '../src/game/GameEngine.js';
import { createVersusMatch, resolveCpuTier } from '../src/game/VersusMatch.js';
import { createCharge } from '../src/game/VersusRules.js';

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

const RES = gameConfig.resonance;
const STEP_MS = physicsConfig.simulation.fixedStepMs;
const STRAIGHT_UP = -Math.PI / 2;
const SHOT_FRAME_CAP = 600;
const PLAIN_SEED = 'pulse-test';
const DAILY_SEED = '2025-01-02';
const FLUX_SEED = 'pulse1';
const MATCH_FRAME_CAP = 1500;
const OVERCHARGE_PROBE = 4;
const LCG_MULTIPLIER = 16807;
const LCG_MODULUS = 2147483647;
const LCG_START = 4242;
const CALIBRATED_OFFSET_MS = 100;
const HALF = 0.5;

const createAudioSpy = () => {
  const effects = [];
  return {
    effects,
    playEffect: (name) => effects.push(name),
    stopAll: () => {},
    isMuted: () => false,
    setMuted: () => {}
  };
};

const createManager = ({ resonance = true, offsetMs = 0 } = {}) => {
  const manager = new StorageManager();
  manager.init();
  manager.setResonanceEnabled(resonance);
  manager.setRhythmOffsetMs(offsetMs);
  return manager;
};

const createEngine = (options = {}) => {
  const audio = createAudioSpy();
  const engine = new GameEngine({
    ...configs,
    audioManager: audio,
    storageManager: createManager(options),
    onStateChange: () => {}
  });
  engine.audioSpy = audio;
  return engine;
};

const createBoard = (resonanceOption) => {
  const engine = new GameEngine({
    ...configs,
    storageManager: createVersusStorageView(createManager()),
    audioManager: createAudioChannel(createAudioSpy(), { muted: true }),
    onStateChange: () => {},
    role: ENGINE_ROLES.VERSUS
  });
  engine.setVersusResonanceOption(resonanceOption);
  engine.startVersusBoard({ seedKey: 'versus:pulse:r0', boardIndex: 0 });
  return engine;
};

/** Runs fn with Math.random replaced by a fixed sequence, so unseeded modes replay. */
const withFixedRandom = (fn) => {
  const real = Math.random;
  let seed = LCG_START;
  Math.random = () => {
    seed = (seed * LCG_MULTIPLIER) % LCG_MODULUS;
    return seed / LCG_MODULUS;
  };
  try {
    return fn();
  } finally {
    Math.random = real;
  }
};

const settleShot = (engine) => {
  for (let i = 0; i < SHOT_FRAME_CAP && engine.physicsWorld.projectile; i++) {
    engine.update();
  }
};

const shootUp = (engine) => {
  engine.updateAimFromAngle(STRAIGHT_UP);
  engine.shoot();
};

/** Counts the draws of the seeded stream of a run. */
const countSeededDraws = (engine) => {
  const counter = { draws: 0 };
  const stream = engine.seededRng;
  const next = stream.next.bind(stream);
  stream.next = () => {
    counter.draws += 1;
    return next();
  };
  return counter;
};

const beatLength = (mode) => 60000 / audioConfig.music.modes[mode].bpm / STEP_MS;
const offBeatFrame = (mode) => Math.round(beatLength(mode) * HALF);

test('beatFrame advances once per update, only while PLAYING', () => {
  const engine = createEngine();
  assert.equal(engine.beatFrame, 0);
  engine.update();
  assert.equal(engine.beatFrame, 0, 'a board that is not running has no beat');
  engine.startCampaignLevel(1);
  for (let i = 0; i < 5; i++) {
    engine.update();
  }
  assert.equal(engine.beatFrame, 5);
  engine.state = GAME_STATES.PAUSED;
  engine.update();
  assert.equal(engine.beatFrame, 5, 'a paused board keeps its beat');
  engine.state = GAME_STATES.PLAYING;
  engine.startCampaignLevel(1);
  assert.equal(engine.beatFrame, 0, 'a new run restarts the clock');
});

test('a shot inside the window is Resonant, one outside is not, and the offset shifts the window', () => {
  withFixedRandom(() => {
    const inside = createEngine();
    inside.startCampaignLevel(1);
    inside.beatFrame = RES.windowFrames;
    shootUp(inside);
    assert.equal(inside.physicsWorld.projectile.isResonant, true);
    assert.equal(inside.turnResonant, true);
    assert.ok(inside.audioSpy.effects.includes('resonance'), 'the resonance effect plays');
    assert.ok(inside.resonanceFlashFrames > 0, 'the launcher flashes');

    const outside = createEngine();
    outside.startCampaignLevel(1);
    outside.beatFrame = RES.windowFrames + 1;
    shootUp(outside);
    assert.equal(outside.physicsWorld.projectile.isResonant, false);
    assert.equal(outside.turnResonant, false);
    assert.ok(!outside.audioSpy.effects.includes('resonance'));

    const offsetFrames = Math.round(CALIBRATED_OFFSET_MS / STEP_MS);
    const beatAfterOffset = Math.round(beatLength('campaign')) + offsetFrames;
    const shifted = createEngine({ offsetMs: CALIBRATED_OFFSET_MS });
    shifted.startCampaignLevel(1);
    shifted.beatFrame = beatAfterOffset;
    shootUp(shifted);
    assert.equal(shifted.turnResonant, true, 'the window follows the calibrated offset');
    const unshifted = createEngine();
    unshifted.startCampaignLevel(1);
    unshifted.beatFrame = beatAfterOffset + RES.windowFrames;
    shootUp(unshifted);
    assert.equal(unshifted.turnResonant, false, 'without the offset the same frame is outside');
  });
});

test('a Resonant turn that matched multiplies the Overcharge it earned; a whiff gets nothing', () => {
  withFixedRandom(() => {
    const probe = (resonant, madeMatch) => {
      const engine = createEngine();
      engine.startCampaignLevel(1);
      engine.overcharge = 0;
      engine.turnResonant = resonant;
      engine.addOvercharge(OVERCHARGE_PROBE);
      const gained = engine.overcharge;
      engine.handlePostTurnCleanup(madeMatch);
      return { gained, total: engine.overcharge, engine };
    };
    const plain = probe(false, true);
    const bonus = probe(true, true);
    assert.equal(plain.total, plain.gained, 'a normal turn keeps what it earned');
    assert.ok(Math.abs(bonus.total - plain.total * RES.overchargeMultiplier) < 1e-9, 'a Resonant match earns the multiplier');
    const whiff = probe(true, false);
    assert.equal(whiff.total, whiff.gained, 'a Resonant whiff gets nothing extra');
    assert.equal(bonus.engine.turnResonant, false, 'the turn flag is cleared');
    assert.equal(bonus.engine.turnOverchargeEarned, 0);
  });
});

test('a Resonant turn that dropped spheres is topped up as well', () => {
  withFixedRandom(() => {
    const engine = createEngine();
    engine.startCampaignLevel(1);
    engine.overcharge = 0;
    engine.turnResonant = true;
    const loose = new Ball({ x: 60, y: 520, radius: physicsConfig.ball.radius, colorId: ballsConfig.standardColors[0].id });
    engine.physicsWorld.addBall(loose);
    engine.handlePostTurnCleanup(false);
    const dropped = gameConfig.scoring.overchargePerDroppedBall * engine.getOverchargeMultiplier();
    assert.ok(Math.abs(engine.overcharge - dropped * RES.overchargeMultiplier) < 1e-9);
  });
});

test('with the setting off a shot on the beat plays exactly like one off the beat', () => {
  const play = (resonanceSetting, frame) => withFixedRandom(() => {
    const engine = createEngine({ resonance: resonanceSetting });
    engine.startCampaignLevel(1);
    engine.beatFrame = frame;
    shootUp(engine);
    const wasResonant = engine.turnResonant;
    settleShot(engine);
    return {
      wasResonant,
      score: engine.score,
      overcharge: engine.overcharge,
      balls: engine.physicsWorld.balls.length
    };
  });
  const onBeatSettingOff = play(false, 0);
  const offBeatSettingOn = play(true, offBeatFrame('campaign'));
  assert.equal(onBeatSettingOff.wasResonant, false);
  assert.equal(offBeatSettingOn.wasResonant, false);
  assert.deepEqual(onBeatSettingOff, offBeatSettingOn);
});

test('competitive runs never apply Resonance and the seeded draw count is unchanged', () => {
  const runDaily = (frame, setting) => {
    const engine = createEngine({ resonance: setting });
    engine.startDailyChallenge(DAILY_SEED);
    const draws = countSeededDraws(engine);
    engine.beatFrame = frame;
    shootUp(engine);
    settleShot(engine);
    return { engine, draws: draws.draws, score: engine.score };
  };
  const onBeat = runDaily(0, true);
  const offBeat = runDaily(offBeatFrame('daily'), true);
  const settingOff = runDaily(0, false);
  assert.equal(onBeat.engine.turnResonant, false);
  assert.equal(onBeat.engine.getBeatState().resonanceActive, false, 'the ring is hidden in Daily');
  assert.equal(onBeat.draws, offBeat.draws);
  assert.equal(onBeat.draws, settingOff.draws);
  assert.equal(onBeat.score, offBeat.score);

  const rematch = createEngine();
  rematch.startDailyChallenge(DAILY_SEED, false, { isRematch: true });
  assert.equal(rematch.isResonanceEnabled(), false, 'a Daily rematch');

  const shared = createEngine();
  shared.startFluxRun(FLUX_SEED, { isShared: true });
  assert.equal(shared.isResonanceEnabled(), false, 'a shared Flux link');

  const weekly = createEngine();
  withFixedRandom(() => weekly.startFluxRun());
  assert.equal(weekly.isResonanceEnabled(), true, 'an unseeded Flux run');
  weekly.isWeeklyFluxRun = true;
  assert.equal(weekly.isResonanceEnabled(), false, 'the Weekly Flux');

  const ghost = createEngine();
  ghost.startCampaignLevel(1);
  ghost.ghostDuel = { ghost: {} };
  assert.equal(ghost.isResonanceEnabled(), false, 'a Ghost Duel');
});

test('the solo modes use Resonance when the setting is on', () => {
  withFixedRandom(() => {
    const starters = [
      (engine) => engine.startCampaignLevel(1),
      (engine) => engine.startEndlessMode(),
      (engine) => engine.startClassicMode(1),
      (engine) => engine.startBlitzMode(),
      (engine) => engine.startCascadeMode()
    ];
    for (const start of starters) {
      const engine = createEngine();
      start(engine);
      assert.equal(engine.getBeatState().resonanceActive, true, engine.mode);
      engine.storageManager.setResonanceEnabled(false);
      assert.equal(engine.getBeatState().resonanceActive, false, `${engine.mode} with the setting off`);
    }
  });
});

test('getPulseState reports the clock, the beat length, whether Resonance is live and the pressure', () => {
  withFixedRandom(() => {
    const engine = createEngine();
    engine.startCampaignLevel(1);
    engine.update();
    const state = engine.getPulseState();
    assert.equal(state.beatFrame, 1);
    assert.ok(Math.abs(state.framesPerBeat - beatLength('campaign')) < 1e-9);
    assert.equal(state.resonanceActive, true);
    assert.ok(state.intensity >= 0 && state.intensity <= 1);
  });
});

test('the pressure follows the Sag meter, the danger distance and the threatening charges', () => {
  withFixedRandom(() => {
    const classic = createEngine();
    classic.startClassicMode(1);
    classic.physicsWorld.balls.length = 0;
    classic.sagLevel = 0;
    assert.equal(classic.getMusicIntensity(), 0);
    const sag = classic.getSagState();
    classic.sagLevel = Math.floor(sag.size * HALF);
    assert.ok(Math.abs(classic.getMusicIntensity() - classic.sagLevel / sag.size) < 1e-9);
    classic.sagLevel = 0;
    const dangerY = gameConfig.canvas.dangerLineY;
    classic.physicsWorld.balls.push(new Ball({
      x: 100,
      y: dangerY - physicsConfig.ball.radius - RES.intensity.dangerSpan * HALF,
      radius: physicsConfig.ball.radius,
      colorId: ballsConfig.standardColors[0].id
    }));
    assert.ok(Math.abs(classic.getMusicIntensity() - HALF) < 1e-9, 'half the span left to the line');
  });
  const board = createBoard(false);
  board.physicsWorld.balls.length = 0;
  board.versus.threatIds = [1];
  assert.ok(Math.abs(board.getMusicIntensity() - 1 / RES.intensity.versusThreatFull) < 1e-9);
  board.versus.threatIds = [1, 2, 3];
  assert.equal(board.getMusicIntensity(), 1);
});
// Versus.

const placeCharge = (engine, { polarity, strength }) => {
  const y = (engine.getClusterUndersideY() + gameConfig.canvas.launcherY) / 2;
  const charge = createCharge({
    polarity,
    strength,
    x: gameConfig.canvas.launcherX,
    startY: y,
    targetY: y - 1,
    riseFrames: 1e9,
    id: engine.versus.chargeSeq++
  });
  charge.age = 0;
  charge.progress = 0;
  charge.threatening = false;
  engine.versus.charges.push(charge);
  return charge;
};

const shootPositive = (engine, frame) => {
  engine.beatFrame = frame;
  engine.currentBall = engine.createRandomLauncherBall(null, 'crimson');
  shootUp(engine);
  settleShot(engine);
};

test('a Resonant shot removes two strength from an opposite charge, a normal one removes one', () => {
  const resonant = createBoard(true);
  const heavy = placeCharge(resonant, { polarity: -1, strength: 3 });
  shootPositive(resonant, 0);
  assert.equal(heavy.strength, 3 - RES.versusStrengthLoss);

  const normal = createBoard(true);
  const other = placeCharge(normal, { polarity: -1, strength: 3 });
  shootPositive(normal, offBeatFrame('versus'));
  assert.equal(other.strength, 2, 'off the beat the default loss of one stays');

  const optionOff = createBoard(false);
  const third = placeCharge(optionOff, { polarity: -1, strength: 3 });
  shootPositive(optionOff, 0);
  assert.equal(third.strength, 2, 'the match option off keeps the default loss');
});

test('a CPU board is Resonant by its queued roll alone, never by the beat', () => {
  const board = createBoard(true);
  board.setBotResonanceDriven(true);
  board.queueBotResonanceRoll(false);
  board.beatFrame = 0;
  board.currentBall = board.createRandomLauncherBall(null, 'crimson');
  shootUp(board);
  assert.equal(board.turnResonant, false, 'a failed roll on the beat');
  const rolled = createBoard(true);
  rolled.setBotResonanceDriven(true);
  rolled.queueBotResonanceRoll(true);
  rolled.beatFrame = offBeatFrame('versus');
  rolled.currentBall = rolled.createRandomLauncherBall(null, 'crimson');
  shootUp(rolled);
  assert.equal(rolled.turnResonant, true, 'a won roll off the beat');
  assert.equal(rolled.getBeatState().resonanceActive, false, 'a CPU board shows no ring');
});

const createCpuMatch = (options = {}) => createVersusMatch({
  mode: 'cpu',
  seed: PLAIN_SEED,
  configs,
  storageManager: createManager(),
  audioManager: createAudioSpy(),
  cpuTier: 'normal',
  ...options
});

test('the CPU Resonance roll leaves the decisions and the seeded draws of the match alone', () => {
  const asLog = (match) => JSON.parse(JSON.stringify(match.getEventLog()));
  const normal = resolveCpuTier(gameConfig, 'normal');
  const baseline = createCpuMatch({ resonance: false });
  baseline.run(MATCH_FRAME_CAP);
  const rolledLow = createCpuMatch({ resonance: false, cpuTier: { ...normal, resonanceChance: 0 } });
  const rolledHigh = createCpuMatch({ resonance: false, cpuTier: { ...normal, resonanceChance: 1 } });
  rolledLow.run(MATCH_FRAME_CAP);
  rolledHigh.run(MATCH_FRAME_CAP);
  assert.deepEqual(asLog(rolledLow), asLog(rolledHigh), 'the chance of a roll cannot move any other stream');
  assert.deepEqual(asLog(rolledLow), asLog(baseline), 'and the match is the one the tier alone plays');
  const again = createCpuMatch({ resonance: false });
  again.run(MATCH_FRAME_CAP);
  assert.deepEqual(asLog(again), asLog(baseline), 'a match replays from its seed');
});

test('the CPU tier carries the configured Resonance chance by rank', () => {
  Object.keys(gameConfig.versus.cpu).forEach((name, index) => {
    assert.equal(resolveCpuTier(gameConfig, name).resonanceChance, RES.botChance[index], name);
  });
  assert.equal(resolveCpuTier(gameConfig, 'easy').resonanceChance, 0);
});

test('the versus match option forces Resonance on or off for both boards', () => {
  const forcedOn = createCpuMatch({ resonance: true, storageManager: createManager({ resonance: false }) });
  assert.equal(forcedOn.engines[0].isResonanceEnabled(), true);
  const forcedOff = createCpuMatch({ resonance: false });
  assert.equal(forcedOff.engines[0].isResonanceEnabled(), false);
  const followsSetting = createCpuMatch({ storageManager: createManager({ resonance: false }) });
  assert.equal(followsSetting.engines[0].isResonanceEnabled(), false);
  const followsOn = createCpuMatch();
  assert.equal(followsOn.engines[0].isResonanceEnabled(), true);
});

test('config schema: the Resonance and intensity sections hold the values the engine reads', () => {
  assert.ok(RES.windowFrames > 0 && RES.overchargeMultiplier > 1 && RES.versusStrengthLoss > 1);
  assert.equal(RES.botChance.length, Object.keys(gameConfig.versus.cpu).length);
  assert.ok(RES.botChance.every((chance) => chance >= 0 && chance <= 1));
  assert.ok(RES.intensity.dangerSpan > 0 && RES.intensity.versusThreatFull > 0);
  assert.ok(RES.ring.radiusFactor > 0 && RES.ring.flashFrames > 0);
  assert.ok(RES.calibrationBeats >= RES.calibrationMinTaps);
  assert.ok(audioConfig.effects.calibrationClick.duration > 0);
});
