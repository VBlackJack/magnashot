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
import { AudioManager } from '../src/core/AudioManager.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { Renderer, buildResolutionQuery } from '../src/game/Renderer.js';
import { Renderer as FrozenRenderer } from './fixtures/Renderer.v1.19.0.js';
import { ParticleSystem } from '../src/entities/ParticleSystem.js';
import { createGameLoop } from '../src/game/GameLoop.js';
import { GAME_STATES } from '../src/core/Constants.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';

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

const FIXED_STEP_MS = 10;
const MAX_ACCUMULATED_MS = 100;

/**
 * Canvas 2D context stub: drawing methods are no-ops, gradients accept color stops. It
 * tracks the save/restore stack (restoring globalAlpha and globalCompositeOperation like a
 * real context) and records the calls the tests assert on, so a state leak is detectable.
 */
const createStubContext = () => {
  const state = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    saveDepth: 0,
    restoreUnderflows: 0,
    calls: []
  };
  const stack = [];
  const track = (name) => (...args) => {
    state.calls.push({ name, args, saveDepth: state.saveDepth });
  };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      if (prop === 'save') {
        return () => {
          stack.push({ globalAlpha: target.globalAlpha, globalCompositeOperation: target.globalCompositeOperation });
          target.saveDepth++;
        };
      }
      if (prop === 'restore') {
        return () => {
          const saved = stack.pop();
          if (!saved) {
            target.restoreUnderflows++;
            return;
          }
          target.saveDepth--;
          target.globalAlpha = saved.globalAlpha;
          target.globalCompositeOperation = saved.globalCompositeOperation;
        };
      }
      if (prop === 'fillRect' || prop === 'clearRect' || prop === 'translate' || prop === 'strokeRect' || prop === 'setLineDash') {
        return track(prop);
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return (...args) => {
          for (const arg of args) {
            assert.ok(Number.isFinite(arg), `${prop} received non-finite coordinate: ${arg}`);
          }
          return { addColorStop() {} };
        };
      }
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
};

const createStubCanvas = () => {
  const ctx = createStubContext();
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 })
  };
};

const createRenderer = () => {
  const renderer = new Renderer(createStubCanvas(), gameConfig, ballsConfig, obstaclesConfig);
  renderer.createLayerCanvas = () => createStubCanvas();
  return renderer;
};

const createTestEngine = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  const dummyAudio = {
    playEffect: () => {},
    stopAll: () => {},
    isMuted: () => true,
    setMuted: () => {}
  };
  return new GameEngine({
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
    onStateChange: () => {}
  });
};

const createLoopHarness = (engine, renderer) => {
  const scheduled = [];
  const errors = [];
  const loop = createGameLoop({
    engine,
    renderer,
    fixedStepMs: FIXED_STEP_MS,
    maxAccumulatedMs: MAX_ACCUMULATED_MS,
    idleRenderIntervalMs: 0,
    scheduleFrame: (cb) => scheduled.push(cb),
    onFatalError: (err) => errors.push(err)
  });
  return { loop, scheduled, errors };
};

test('Game loop stops after an update throws and never calls update again', () => {
  let updates = 0;
  const engine = {
    state: GAME_STATES.PLAYING,
    hitStopFrames: 0,
    update() {
      updates++;
      if (updates === 2) {
        throw new Error('simulated failure');
      }
    }
  };
  const renderer = { render: () => {} };
  const { loop, scheduled, errors } = createLoopHarness(engine, renderer);

  loop.frame(0);
  loop.frame(FIXED_STEP_MS);
  loop.frame(FIXED_STEP_MS * 2);
  assert.equal(updates, 2);
  assert.equal(errors.length, 1);
  assert.ok(loop.isStopped());

  const scheduledBefore = scheduled.length;
  loop.frame(FIXED_STEP_MS * 3);
  loop.frame(FIXED_STEP_MS * 4);
  assert.equal(updates, 2, 'update must not run after a fatal error');
  assert.equal(scheduled.length, scheduledBefore, 'no frame may be scheduled after a fatal error');
  assert.equal(errors.length, 1, 'the error is reported once');
});

test('Game loop stops after a render throws', () => {
  let updates = 0;
  const engine = { state: GAME_STATES.PLAYING, hitStopFrames: 0, update: () => updates++ };
  const renderer = {
    render() {
      throw new Error('render failure');
    }
  };
  const { loop, errors } = createLoopHarness(engine, renderer);
  loop.frame(0);
  loop.frame(FIXED_STEP_MS * 3);
  assert.equal(errors.length, 1);
  assert.equal(updates, 0);
});

test('Render alpha is 1 when no simulation step advanced, interpolated otherwise', () => {
  const alphas = [];
  const engine = {
    state: GAME_STATES.PLAYING,
    hitStopFrames: 0,
    update: () => {},
    isVictoryCelebrating: () => false
  };
  const renderer = { render: (_eng, alpha) => alphas.push(alpha) };
  const { loop } = createLoopHarness(engine, renderer);

  loop.frame(0);
  loop.frame(FIXED_STEP_MS * 1.5);
  assert.equal(alphas.at(-1), 0.5, 'a real step interpolates with the remainder');

  engine.state = GAME_STATES.PAUSED;
  loop.frame(FIXED_STEP_MS * 3.2);
  assert.equal(alphas.at(-1), 1.0, 'paused: alpha must be 1');
  loop.frame(FIXED_STEP_MS * 3.7);
  assert.equal(alphas.at(-1), 1.0, 'still paused without new steps: alpha must stay 1');

  engine.state = GAME_STATES.PLAYING;
  engine.hitStopFrames = 5;
  engine.update = () => {
    engine.hitStopFrames--;
  };
  loop.frame(FIXED_STEP_MS * 5.4);
  assert.equal(alphas.at(-1), 1.0, 'hit-stop: alpha must be 1');

  engine.hitStopFrames = 0;
  engine.stageTransitionFrames = 10;
  engine.update = () => {
    engine.stageTransitionFrames--;
  };
  loop.frame(FIXED_STEP_MS * 6.9);
  assert.equal(alphas.at(-1), 1.0, 'Flux stage transition: alpha must be 1');
});

test('Game loop throttles rendering while the engine is not playing', () => {
  let renders = 0;
  const engine = {
    state: GAME_STATES.PAUSED,
    hitStopFrames: 0,
    update: () => {},
    isVictoryCelebrating: () => false
  };
  const loop = createGameLoop({
    engine,
    renderer: { render: () => renders++ },
    fixedStepMs: FIXED_STEP_MS,
    maxAccumulatedMs: MAX_ACCUMULATED_MS,
    idleRenderIntervalMs: gameConfig.canvas.idleRenderIntervalMs,
    scheduleFrame: () => {},
    onFatalError: () => {}
  });
  loop.frame(0);
  loop.frame(1);
  loop.frame(2);
  assert.equal(renders, 1);
  loop.frame(gameConfig.canvas.idleRenderIntervalMs);
  assert.equal(renders, 2);
  engine.state = GAME_STATES.PLAYING;
  loop.frame(gameConfig.canvas.idleRenderIntervalMs + 1);
  assert.equal(renders, 3);
});

test('Game loop renders every frame while a victory is being celebrated', () => {
  let renders = 0;
  let celebrating = true;
  const engine = {
    state: GAME_STATES.VICTORY,
    hitStopFrames: 0,
    update: () => {},
    isVictoryCelebrating: () => celebrating
  };
  const loop = createGameLoop({
    engine,
    renderer: { render: () => renders++ },
    fixedStepMs: FIXED_STEP_MS,
    maxAccumulatedMs: MAX_ACCUMULATED_MS,
    idleRenderIntervalMs: gameConfig.canvas.idleRenderIntervalMs,
    scheduleFrame: () => {},
    onFatalError: () => {}
  });
  loop.frame(0);
  loop.frame(1);
  loop.frame(2);
  assert.equal(renders, 3);
  celebrating = false;
  loop.frame(3);
  assert.equal(renders, 3, 'once the celebration ends the static scene is throttled again');
});

/**
 * Minimal Web Audio stub counting oscillators, recording the output chain and logging the
 * gain ramps and stops it is asked to schedule, in call order.
 */
class StubAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = { id: 'destination' };
    this.oscillatorsCreated = 0;
    this.scheduled = [];
    StubAudioContext.last = this;
  }

  createParam() {
    const scheduled = this.scheduled;
    return {
      value: 1,
      setValueAtTime() {},
      cancelScheduledValues() {},
      exponentialRampToValueAtTime(value, time) {
        scheduled.push({ kind: 'ramp', value, time });
      }
    };
  }

  createOscillator() {
    this.oscillatorsCreated++;
    const scheduled = this.scheduled;
    return {
      frequency: this.createParam(),
      connect() {},
      disconnect() {},
      start() {},
      stop(time) {
        scheduled.push({ kind: 'stop', time });
      }
    };
  }

  createGain() {
    const node = { gain: this.createParam(), connectedTo: null, disconnect() {} };
    node.connect = (target) => {
      node.connectedTo = target;
    };
    return node;
  }

  createDynamicsCompressor() {
    const node = {
      threshold: this.createParam(),
      knee: this.createParam(),
      ratio: this.createParam(),
      attack: this.createParam(),
      release: this.createParam(),
      connectedTo: null
    };
    node.connect = (target) => {
      node.connectedTo = target;
    };
    this.compressor = node;
    return node;
  }

  suspend() {
    this.state = 'suspended';
  }

  resume() {
    this.state = 'running';
  }
}

test('AudioManager caps simultaneous voices and routes them through a limiter', () => {
  globalThis.window = { AudioContext: StubAudioContext };
  try {
    const audio = new AudioManager();
    audio.init(false, false);
    const attempts = audioConfig.maxVoices * 3;
    for (let i = 0; i < attempts; i++) {
      audio.playTone('sine', 440, 220, 0.1);
    }
    const ctx = StubAudioContext.last;
    assert.equal(audio.getActiveVoiceCount(), audioConfig.maxVoices);
    assert.equal(ctx.oscillatorsCreated, audioConfig.maxVoices);
    assert.equal(ctx.compressor.connectedTo, ctx.destination, 'limiter must feed the destination');

    const timers = stubAudioTimers(audio);
    audio.setMuted(true);
    assert.equal(ctx.state, 'running', 'the context keeps running while the mute fade plays');
    assert.equal(timers.pending.size, 1, 'muting with voices schedules one deferred suspend');
    const [scheduled] = timers.pending.values();
    const msPerSecond = 1000;
    assert.equal(scheduled.ms, audioConfig.stopRampSec * msPerSecond, 'the suspend waits for the whole fade');
    timers.runAll();
    assert.equal(ctx.state, 'suspended', 'muting suspends the context once the fade has ended');
    audio.setMuted(false);
    assert.equal(ctx.state, 'running', 'unmuting resumes the context');
  } finally {
    delete globalThis.window;
  }
});

/**
 * Replaces the audio timer pair with a synchronous queue, so a test decides when the
 * deferred mute suspend runs instead of waiting on a real timeout.
 */
function stubAudioTimers(audio) {
  const pending = new Map();
  let nextId = 1;
  audio.timers = {
    set(fn, ms) {
      const id = nextId++;
      pending.set(id, { fn, ms });
      return id;
    },
    clear(id) {
      pending.delete(id);
    }
  };
  return {
    pending,
    runAll() {
      for (const [id, entry] of [...pending]) {
        pending.delete(id);
        entry.fn();
      }
    }
  };
}

test('AudioManager suspends at once with no voice playing, and unmuting cancels a pending suspend', () => {
  globalThis.window = { AudioContext: StubAudioContext };
  try {
    const audio = new AudioManager();
    audio.init(false, false);
    const timers = stubAudioTimers(audio);
    audio.ensureContext();
    const ctx = StubAudioContext.last;
    assert.equal(audio.getActiveVoiceCount(), 0);
    audio.setMuted(true);
    assert.equal(ctx.state, 'suspended', 'with nothing to fade, muting suspends immediately');
    assert.equal(timers.pending.size, 0, 'no deferred suspend is scheduled without a voice');

    audio.setMuted(false);
    audio.playTone('sine', 440, 220, 1);
    audio.setMuted(true);
    assert.equal(timers.pending.size, 1, 'muting a playing voice defers the suspend');
    audio.setMuted(false);
    assert.equal(timers.pending.size, 0, 'unmuting during the fade clears the pending suspend');
    assert.equal(audio.pendingSuspend, null);
    assert.equal(ctx.state, 'running', 'the context stays running after unmuting mid-fade');
  } finally {
    delete globalThis.window;
  }
});

test('AudioManager fades every voice out before stopping it, so silencing does not click', () => {
  globalThis.window = { AudioContext: StubAudioContext };
  try {
    const audio = new AudioManager();
    audio.init(false, false);
    audio.playTone('sine', 440, 220, 1);
    const ctx = StubAudioContext.last;
    ctx.currentTime = 0.5;
    ctx.scheduled.length = 0;

    audio.stopAll();
    const stopTime = ctx.currentTime + audioConfig.stopRampSec;
    const ramp = ctx.scheduled.findIndex((e) => e.kind === 'ramp' && e.value === audioConfig.minGain && e.time === stopTime);
    const stop = ctx.scheduled.findIndex((e) => e.kind === 'stop' && e.time === stopTime);
    assert.ok(ramp >= 0, 'the gain ramps down to the minimum gain');
    assert.ok(stop > ramp, 'the oscillator stops once the ramp has ended');
    assert.equal(audio.getActiveVoiceCount(), 0);
  } finally {
    delete globalThis.window;
  }
});

test('AudioManager throttles repeated effects within the minimum interval', () => {
  globalThis.window = { AudioContext: StubAudioContext };
  try {
    const audio = new AudioManager();
    audio.init(false, false);
    let nowMs = 0;
    audio.clock = () => nowMs;
    audio.playEffect('bounce');
    audio.playEffect('bounce');
    audio.playEffect('bounce');
    const ctx = StubAudioContext.last;
    assert.equal(ctx.oscillatorsCreated, 1, 'a burst of the same effect plays once');
    nowMs += audioConfig.effectMinIntervalMs;
    audio.playEffect('bounce');
    assert.equal(ctx.oscillatorsCreated, 2, 'the effect plays again after the interval');
  } finally {
    delete globalThis.window;
  }
});

test('Aim preview cache is not recomputed while aim and board are unchanged', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.updateAim(gameConfig.canvas.launcherX, gameConfig.canvas.launcherY + gameConfig.canvas.initialAimOffsetY);
  assert.ok(engine.aimPoints.snapTarget, 'the default aim must hit a ball in level 1');

  const renderer = createRenderer();
  const world = engine.physicsWorld;
  let clusterCalls = 0;
  const originalFind = world.findColorCluster.bind(world);
  world.findColorCluster = (ball) => {
    clusterCalls++;
    return originalFind(ball);
  };
  engine.currentBall.colorId = engine.aimPoints.snapTarget.colorId;

  const draw = () =>
    renderer.drawAimTrajectory(
      renderer.ctx,
      engine.aimPoints,
      engine.currentBall,
      world,
      gameConfig.theme,
      0,
      engine.getBlastRadiusMultiplier(),
      engine.aimAngle,
      1.0
    );

  draw();
  draw();
  draw();
  assert.equal(renderer.aimPreviewComputeCount, 1);
  assert.equal(clusterCalls, 1);

  const removable = world.balls.find((b) => b !== engine.aimPoints.snapTarget);
  world.removeBall(removable);
  draw();
  assert.equal(renderer.aimPreviewComputeCount, 2, 'a board change must invalidate the preview');
});

test('Full render pass runs against a stub context without mutating launcher balls', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const renderer = createRenderer();
  const current = engine.currentBall;
  const before = { x: current.x, y: current.y, prevX: current.prevX, prevY: current.prevY };
  renderer.render(engine, 0.5);
  renderer.render(engine, 1.0);
  assert.deepEqual(
    { x: current.x, y: current.y, prevX: current.prevX, prevY: current.prevY },
    before,
    'rendering must not write positions into engine state'
  );
  assert.equal(renderer.canvas.width, Math.round(gameConfig.canvas.logicalWidth * renderer.dpr));
});

test('Reduced motion drops decorative particles but keeps the informative floating texts', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const particles = engine.particleSystem;
  const spot = gameConfig.canvas.launcherX;
  particles.spawnBurst(spot, spot, '#ffffff');
  particles.spawnFloatingText(spot, spot, 'kept', '#ffffff');

  engine.setReducedMotion(true);
  assert.equal(particles.particles.length, 0, 'switching on clears the running effects');
  assert.equal(particles.floatingTexts.length, 1);

  particles.spawnBurst(spot, spot, '#ffffff');
  particles.spawnTrail(spot, spot, physicsConfig.ball.radius, '#ffffff');
  particles.spawnShockwave(spot, spot, '#ffffff');
  particles.spawnLightning(spot, 0, gameConfig.canvas.logicalWidth, '#ffffff');
  particles.addScreenShake(gameConfig.juice.matchShake);
  particles.spawnFloatingText(spot, spot, 'still shown', '#ffffff');

  assert.equal(particles.particles.length, 0);
  assert.equal(particles.trailParticles.length, 0);
  assert.equal(particles.shockwaves.length, 0);
  assert.equal(particles.lightningBolts.length, 0);
  assert.equal(particles.shakeIntensity, 0);
  assert.equal(particles.floatingTexts.length, 2);
  assert.doesNotThrow(() => createRenderer().render(engine, 1.0));
});

test('A rotor board traces the aim preview once per rendered frame, not once per step', () => {
  const engine = createTestEngine();
  engine.startDailyChallenge('2025-01-01');
  const world = engine.physicsWorld;
  assert.ok(world.obstacles.some((obs) => obs.angularVelocity !== undefined), 'the Daily board has a rotor');
  const renderer = { render: () => {} };
  const { loop } = createLoopHarness(engine, renderer);
  const stepsPerFrame = 4;

  loop.frame(0);
  const before = world.aimTrajectoryComputeCount;
  loop.frame(FIXED_STEP_MS * stepsPerFrame);
  assert.equal(world.aimTrajectoryComputeCount - before, 1);
});

test('A device pixel ratio change invalidates the backing store and re-arms the watch', () => {
  const queries = [];
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener() {},
    matchMedia(query) {
      const entry = { query, listeners: [] };
      queries.push(entry);
      return {
        addEventListener: (type, listener, options) => {
          assert.equal(type, 'change');
          assert.equal(options?.once, true, 'each query fires once, then a new one is armed');
          entry.listeners.push(listener);
        }
      };
    }
  };
  try {
    const renderer = createRenderer();
    assert.deepEqual(queries.map((q) => q.query), [buildResolutionQuery(1)]);
    renderer.updateCanvasResolution();
    assert.equal(renderer.resolutionDirty, false);

    globalThis.window.devicePixelRatio = 2;
    queries[0].listeners[0]();
    assert.equal(renderer.resolutionDirty, true, 'the next frame resizes the backing store');
    assert.deepEqual(queries.map((q) => q.query), [buildResolutionQuery(1), buildResolutionQuery(2)]);
  } finally {
    delete globalThis.window;
  }
});

test('The Boss Core crack shockwave and the singularity pull wave read their own tuning keys', () => {
  // Both keys replaced a base value halved in code; they must keep exactly that value.
  const halfFactor = 0.5;
  const bossSpec = ballsConfig.clusterModifiers.bossCore;
  const obsDefaults = obstaclesConfig.defaults;
  for (const value of [bossSpec.crackShockwaveRadius, obsDefaults.pullWaveAlpha]) {
    assert.ok(Number.isFinite(value) && value > 0, `${value} must be a finite positive number`);
  }
  assert.equal(bossSpec.crackShockwaveRadius, bossSpec.shockwaveRadius * halfFactor);
  assert.equal(obsDefaults.pullWaveAlpha, obsDefaults.fieldWaveAlpha * halfFactor);

  const engineSource = fs.readdirSync('./src/game')
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(`./src/game/${file}`, 'utf8'))
    .join('\n');
  const rendererSource = fs.readFileSync('./src/game/Renderer.js', 'utf8');
  assert.ok(!engineSource.includes('shockwaveRadius * MATH_CONSTANTS.HALF'), 'the crack radius is no longer halved in code');
  assert.ok(!rendererSource.includes('fieldWaveAlpha * MATH_CONSTANTS.HALF'), 'the pull wave alpha is no longer halved in code');
});

test('Blitz auto-fire countdown ring and danger zone proximity glow render without throwing', () => {
  const engine = createTestEngine();
  engine.startBlitzMode();
  engine.blitzIdleFrames = Math.floor(gameConfig.blitz.autoFireFrames * 0.75);
  const dangerBall = engine.physicsWorld.balls[0];
  dangerBall.y = gameConfig.canvas.dangerLineY - gameConfig.canvas.dangerWarningMarginY * 0.5;
  dangerBall.prevY = dangerBall.y;

  const renderer = createRenderer();
  assert.doesNotThrow(() => renderer.render(engine, 1.0));
  engine.setReducedMotion(true);
  assert.doesNotThrow(() => renderer.render(engine, 1.0));
});

test('drawParticles clamps floating texts horizontally within wall margins and drawObstacles renders Antimagnet rings', () => {
  const engine = createTestEngine();
  engine.startCascadeMode();
  const renderer = createRenderer();
  const fillTextCalls = [];
  renderer.ctx.measureText = () => ({ width: 160 });
  renderer.ctx.fillText = (text, x, y, maxWidth) => {
    fillTextCalls.push({ text, x, y, maxWidth });
  };

  engine.particleSystem.spawnFloatingText(10, 200, 'LEFT EDGE CLIP TEST', '#ffffff');
  engine.particleSystem.spawnFloatingText(460, 200, 'RIGHT EDGE CLIP TEST', '#ffffff');
  renderer.drawParticles(renderer.ctx, engine.particleSystem, 1.0);

  const wallMargin = gameConfig.canvas.wallMargin;
  const expectedMinX = wallMargin + 80;
  const expectedMaxX = gameConfig.canvas.logicalWidth - wallMargin - 80;
  const leftMainCall = fillTextCalls.find((c) => c.text === 'LEFT EDGE CLIP TEST' && c.x === expectedMinX);
  const rightMainCall = fillTextCalls.find((c) => c.text === 'RIGHT EDGE CLIP TEST' && c.x === expectedMaxX);
  assert.ok(leftMainCall, 'floating text near left wall is clamped to wallMargin + halfWidth');
  assert.ok(rightMainCall, 'floating text near right wall is clamped to logicalWidth - wallMargin - halfWidth');
  assert.equal(leftMainCall.maxWidth, gameConfig.canvas.logicalWidth - wallMargin * 2);

  assert.doesNotThrow(() => renderer.render(engine, 1.0));
});

test('Ball sprite cache reuses offscreen sprites per palette and invalidates on style, pattern, or contrast changes', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const renderer = createRenderer();
  let createdCanvases = 0;
  renderer.createLayerCanvas = () => {
    createdCanvases++;
    return createStubCanvas();
  };

  renderer.render(engine, 1.0);
  const afterFirstFrame = createdCanvases;
  const cachedCount = renderer.ballSpriteCache.size;
  assert.ok(cachedCount > 0, 'sphere sprites are cached on the first render pass');

  renderer.render(engine, 1.0);
  assert.equal(createdCanvases, afterFirstFrame, 'subsequent frame reuses cached sphere sprites without allocating new canvases');

  renderer.setBallStyle('plasma');
  assert.equal(renderer.ballSpriteCache.size, 0, 'changing ball style clears the sprite cache');
  renderer.render(engine, 1.0);
  assert.ok(renderer.ballSpriteCache.size > 0);

  renderer.setColorPatterns(true);
  assert.equal(renderer.ballSpriteCache.size, 0, 'toggling color patterns clears the sprite cache');
  renderer.render(engine, 1.0);
  assert.ok(renderer.ballSpriteCache.size > 0);

  renderer.setHighContrast(true);
  assert.equal(renderer.ballSpriteCache.size, 0, 'toggling high contrast clears the sprite cache');
});

test('Floating texts play an elastic pop-in scale animation unless reduced motion is active', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const ps = engine.particleSystem;
  ps.spawnFloatingText(235, 300, '+500', '#38bdf8');
  const ft = ps.floatingTexts[0];
  assert.equal(ft.scale, 1.0);

  ps.update();
  assert.ok(ft.scale !== 1.0, 'pop-in animation adjusts scale during initial frames');

  let maxScale = ft.scale;
  for (let i = 0; i < gameConfig.juice.particles.floatingTextPopFrames + 2; i++) {
    ps.update();
    if (ft.scale > maxScale) {
      maxScale = ft.scale;
    }
  }
  assert.ok(maxScale > 1.0, 'elastic pop-in overshoots above 1.0');
  assert.equal(ft.scale, 1.0, 'scale settles back to 1.0 once pop-in completes');

  engine.setReducedMotion(true);
  ps.spawnFloatingText(235, 300, '+250', '#38bdf8');
  const reducedFt = ps.floatingTexts.at(-1);
  ps.update();
  assert.equal(reducedFt.scale, 1.0, 'reduced motion keeps floating text scale at 1.0');
});

test('Aim trajectory marks wall bounce vertices with isBounce and renders glow, animated dash, and bounce nodes', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  // Aim sharply toward the left wall so the trajectory bounces off the wall.
  engine.updateAim(gameConfig.canvas.wallMargin + 5, gameConfig.canvas.launcherY - 120);
  assert.ok(
    engine.aimPoints.some((pt) => pt.isBounce),
    'wall bounce vertex along the aim trajectory is tagged with isBounce = true'
  );

  const renderer = createRenderer();
  const dashOffsets = [];
  let arcCount = 0;
  renderer.ctx = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'arc') {
          return () => {
            arcCount++;
          };
        }
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => ({ addColorStop() {} });
        }
        return target[prop] || (() => {});
      },
      set(target, prop, value) {
        if (prop === 'lineDashOffset') {
          dashOffsets.push(value);
        }
        target[prop] = value;
        return true;
      }
    }
  );

  renderer.drawAimTrajectory(
    renderer.ctx,
    engine.aimPoints,
    engine.currentBall,
    engine.physicsWorld,
    gameConfig.theme,
    200,
    engine.getBlastRadiusMultiplier(),
    engine.aimAngle,
    1.0
  );
  assert.ok(dashOffsets.some((offset) => offset < 0), 'aim laser animates lineDashOffset when reducedMotion is false');
  assert.ok(arcCount >= 2, 'aim laser draws both the landing ghost circle and bounce node circles');

  dashOffsets.length = 0;
  renderer.isReducedMotion = true;
  renderer.drawAimTrajectory(
    renderer.ctx,
    engine.aimPoints,
    engine.currentBall,
    engine.physicsWorld,
    gameConfig.theme,
    200,
    engine.getBlastRadiusMultiplier(),
    engine.aimAngle,
    1.0
  );
  assert.ok(dashOffsets.every((offset) => offset === 0), 'aim laser freezes lineDashOffset at 0 when isReducedMotion is true');
});

test('Explosive special balls trigger cinematic slow-motion after hit-stop and spawn multi-layer flashes, shockwaves, and arcs', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const renderer = createRenderer();
  const target = engine.physicsWorld.balls.find((b) => !b.isAnchor) || engine.physicsWorld.balls[0];

  const bombBall = engine.createRandomLauncherBall('bomb');
  bombBall.x = target.x;
  bombBall.y = target.y + physicsConfig.ball.radius;
  engine.physicsWorld.addBall(bombBall);
  engine.handleProjectileSnapped(bombBall, target);

  assert.equal(engine.specialSlowMoFrames, ballsConfig.specialTypes.bomb.slowMoFrames);
  assert.ok(engine.particleSystem.flashes.length >= 1, 'bomb detonation spawns a radial core flash');
  assert.ok(engine.particleSystem.explosions.length >= 2, 'bomb detonation spawns a starburst core and fireball cloud puffs');
  assert.ok(engine.particleSystem.screenFlash, 'bomb detonation triggers an arena impact flash');
  assert.ok(
    engine.particleSystem.shatteringBalls.length >= 1,
    'destroyed spheres spawn swelling/cracking shattering animations instead of vanishing instantly'
  );
  assert.ok(engine.particleSystem.shockwaves.length >= 2, 'bomb detonation spawns concentric multi-ring shockwaves');
  assert.equal(engine.getTimeScale(), 1, 'getTimeScale stays 1 during hit-stop frames so hit-stop finishes briskly');

  while (engine.hitStopFrames > 0) {
    engine.update();
  }
  assert.equal(
    engine.particleSystem.shatteringBalls[0].age,
    0,
    'shattering spheres and explosions do not advance during hit-stop so 100% of the blast plays in slow-motion'
  );
  const activeScale = engine.getTimeScale();
  assert.equal(activeScale, ballsConfig.specialTypes.bomb.slowMoTimeScale, 'slow-motion timeScale activates immediately after hit-stop');
  engine.update();
  assert.equal(engine.particleSystem.shatteringBalls[0].age, 1, 'shattering spheres advance during slow-motion');
  assert.ok(engine.particleSystem.shatteringBalls[0].scale > 1.0, 'shattering spheres swell above 1.0x before bursting');
  assert.doesNotThrow(() => renderer.render(engine, 0.5));

  while (engine.specialSlowMoFrames > 0) {
    engine.update();
  }
  assert.equal(engine.getTimeScale(), 1, 'getTimeScale returns to 1 once slow-motion frames complete');
  assert.equal(engine.particleSystem.shatteringBalls.length, 0, 'shattering spheres finish and pop into secondary puffs');

  engine.triggerSpecialSlowMo(20, 0.25, '#fb923c');
  assert.ok(engine.getTimeScale() < 1);
  assert.equal(engine.specialSlowMoColor, '#fb923c');
  engine.setReducedMotion(true);
  assert.equal(engine.getTimeScale(), 1, 'enabling reduced motion immediately cancels slow-motion');
  assert.equal(engine.particleSystem.flashes.length, 0, 'enabling reduced motion clears radial flashes');
  assert.equal(engine.particleSystem.explosions.length, 0, 'enabling reduced motion clears fireball explosions');
  assert.equal(engine.particleSystem.shatteringBalls.length, 0, 'enabling reduced motion clears shattering spheres');
});

test('StorageManager.getReducedMotion defaults to false even when OS prefers-reduced-motion is active, and honors explicit toggle', () => {
  globalThis.window = {
    addEventListener() {},
    matchMedia() {
      return { matches: true };
    }
  };
  try {
    const engine = createTestEngine();
    assert.equal(
      engine.storageManager.getReducedMotion(),
      false,
      'OS prefers-reduced-motion does not silently disable game effects unless toggled in Settings'
    );
    assert.equal(engine.isReducedMotion, false);
    engine.storageManager.setReducedMotion(true);
    assert.equal(engine.storageManager.getReducedMotion(), true);
  } finally {
    delete globalThis.window;
  }
});

test('Animation speed setting scales explosion, shattering sphere, shockwave, and slow-motion progression', () => {
  const engine = createTestEngine();
  assert.equal(engine.storageManager.getAnimationSpeed(), 1);
  assert.equal(engine.animationSpeed, 1);
  assert.equal(engine.particleSystem.animationSpeed, 1);

  engine.storageManager.setAnimationSpeed(2);
  assert.equal(engine.storageManager.getAnimationSpeed(), 2);
  engine.storageManager.setAnimationSpeed(999);
  assert.equal(engine.storageManager.getAnimationSpeed(), 2, 'rejects speed outside configured animationSpeeds');

  engine.setAnimationSpeed(2);
  assert.equal(engine.animationSpeed, 2);
  assert.equal(engine.particleSystem.animationSpeed, 2);

  engine.particleSystem.spawnExplosion(120, 140, 60, '#fb923c');
  engine.particleSystem.spawnShatterBall({ x: 120, y: 140, radius: 18 }, '#fb923c', 1, 1);
  engine.particleSystem.update();
  assert.equal(engine.particleSystem.explosions[0].age, 2, 'explosion age advances by 2 per step at 2x speed');
  assert.equal(engine.particleSystem.shatteringBalls[0].age, 2, 'shattering sphere age advances by 2 per step at 2x speed');

  engine.setAnimationSpeed(0.5);
  engine.particleSystem.update();
  assert.equal(engine.particleSystem.explosions[0].age, 2.5, 'explosion age advances by 0.5 per step at 0.5x speed');
  assert.equal(engine.particleSystem.shatteringBalls[0].age, 2.5, 'shattering sphere age advances by 0.5 per step at 0.5x speed');

  engine.startCampaignLevel(1);
  engine.setAnimationSpeed(2);
  engine.triggerSpecialSlowMo(10, 0.25, '#fb923c');
  assert.equal(engine.specialSlowMoFrames, 10);
  engine.update();
  assert.equal(engine.specialSlowMoFrames, 8, 'specialSlowMoFrames decrements by animationSpeed (2) per step');
});

test('particle spawns never exceed the configured caps and the core explosion is kept', () => {
  const caps = gameConfig.juice.particles;
  const system = new ParticleSystem(gameConfig.juice);
  const overshoot = 5;
  for (let i = 0; i < caps.maxParticles * overshoot; i++) {
    system.spawnBurst(10, 10, '#ffffff', 40, 3);
  }
  assert.equal(system.particles.length, caps.maxParticles);

  for (let i = 0; i < caps.maxShatteringBalls * overshoot; i++) {
    system.spawnShatterBall({ x: 5, y: 5, radius: 12, colorId: 'red' }, '#ff0000');
  }
  assert.equal(system.shatteringBalls.length, caps.maxShatteringBalls);

  for (let i = 0; i < caps.maxExplosions * overshoot; i++) {
    system.spawnExplosion(20, 20, 50);
  }
  assert.ok(system.explosions.some((ex) => ex.kind === 'core'), 'the core explosion is kept at the cap');
  assert.ok(system.explosions.filter((ex) => ex.kind === 'puff').length <= caps.maxExplosions);
  assert.ok(system.explosions.length <= caps.maxExplosions + caps.maxExplosions * overshoot, 'cores are not capped');

  const capped = new ParticleSystem(gameConfig.juice);
  for (let i = 0; i < caps.maxExplosions; i++) {
    capped.spawnExplosion(0, 0, 50);
  }
  const before = capped.explosions.filter((ex) => ex.kind === 'puff').length;
  capped.spawnExplosion(0, 0, 50);
  assert.equal(capped.explosions.filter((ex) => ex.kind === 'puff').length, before, 'no puff beyond the cap');
  assert.equal(capped.explosions.filter((ex) => ex.kind === 'core').length, caps.maxExplosions + 1);
});

test('pooled shatter balls and explosions reuse their cracks and rays arrays', () => {
  const system = new ParticleSystem(gameConfig.juice);
  system.spawnShatterBall({ x: 1, y: 1, radius: 10, colorId: 'red' }, '#ff0000');
  const first = system.shatteringBalls[0];
  const cracks = first.cracks;
  const firstPoint = cracks[0][1];
  system.removeAt(system.shatteringBalls, 0, system.shatterPool);
  system.spawnShatterBall({ x: 2, y: 2, radius: 10, colorId: 'red' }, '#ff0000');
  assert.equal(system.shatteringBalls[0].cracks, cracks);
  assert.equal(system.shatteringBalls[0].cracks[0][1], firstPoint);
  assert.equal(cracks.length, gameConfig.juice.particles.shatterCrackCount);
  assert.equal(cracks[0].length, gameConfig.juice.particles.shatterCrackSegments + 1);
});

test('renderer config values that replaced literal fallbacks are finite numbers', () => {
  const theme = gameConfig.theme;
  const slow = gameConfig.juice.slowMotion;
  const render = ballsConfig.render;
  const values = {
    'theme.horizonGlowRadiusFactor': theme.horizonGlowRadiusFactor,
    'theme.vignetteInnerRadiusFactor': theme.vignetteInnerRadiusFactor,
    'theme.vignetteOuterRadiusFactor': theme.vignetteOuterRadiusFactor,
    'theme.aimBounceNodeAlpha': theme.aimBounceNodeAlpha,
    'slowMotion.vignetteMaxAlpha': slow.vignetteMaxAlpha,
    'slowMotion.vignetteInnerRadiusFactor': slow.vignetteInnerRadiusFactor,
    'slowMotion.vignetteOuterRadiusFactor': slow.vignetteOuterRadiusFactor,
    'render.rimLightInset': render.rimLightInset,
    'render.rimLightStartAngle': render.rimLightStartAngle,
    'render.rimLightEndAngle': render.rimLightEndAngle,
    'render.secondaryShineAlpha': render.secondaryShineAlpha,
    'render.secondaryShineOffsetFactor': render.secondaryShineOffsetFactor,
    'render.spritePadding': render.spritePadding
  };
  for (const [name, value] of Object.entries(values)) {
    assert.ok(Number.isFinite(value), `${name} must be a finite number, got ${value}`);
  }
});

const renderAndCheckBalance = (engine, label) => {
  const renderer = createRenderer();
  const ctx = renderer.ctx;
  for (const alpha of [0.5, 1.0]) {
    renderer.render(engine, alpha);
    assert.equal(ctx.saveDepth, 0, `${label}: save/restore depth must return to 0`);
    assert.equal(ctx.restoreUnderflows, 0, `${label}: restore must never run without a save`);
    assert.equal(ctx.globalAlpha, 1, `${label}: globalAlpha must be back to 1`);
    assert.equal(ctx.globalCompositeOperation, 'source-over', `${label}: composite operation must be back to source-over`);
  }
};

test('Rendering leaves the canvas state balanced across representative frames', () => {
  for (const reducedMotion of [false, true]) {
    const engine = createTestEngine();
    engine.startCampaignLevel(1);
    engine.setReducedMotion(reducedMotion);
    const particles = engine.particleSystem;
    const spot = gameConfig.canvas.launcherX;
    particles.spawnBurst(spot, spot, '#ffffff');
    particles.spawnShockwave(spot, spot, '#ffffff');
    particles.spawnFloatingText(spot, spot, 'text', '#ffffff');
    particles.addScreenShake(gameConfig.juice.matchShake);
    renderAndCheckBalance(engine, `reducedMotion=${reducedMotion} with effects`);

    const bomb = engine.createRandomLauncherBall('bomb');
    const target = engine.physicsWorld.balls.find((b) => !b.isAnchor) || engine.physicsWorld.balls[0];
    bomb.x = target.x;
    bomb.y = target.y + physicsConfig.ball.radius;
    engine.physicsWorld.addBall(bomb);
    engine.handleProjectileSnapped(bomb, target);
    renderAndCheckBalance(engine, `reducedMotion=${reducedMotion} after an explosion`);
  }
});

test('A shaking frame fills the whole canvas before the shake translate', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.setReducedMotion(false);
  engine.particleSystem.addScreenShake(gameConfig.juice.matchShake);
  assert.ok(engine.particleSystem.shakeIntensity > 0);
  const renderer = createRenderer();
  renderer.render(engine, 1.0);
  const calls = renderer.ctx.calls;
  const translateIndex = calls.findIndex((c) => c.name === 'translate');
  assert.ok(translateIndex > 0, 'the shake translate is applied');
  const fillIndex = calls.findIndex(
    (c) => c.name === 'fillRect' && c.args[0] === 0 && c.args[1] === 0
      && c.args[2] === renderer.logicalWidth && c.args[3] === renderer.logicalHeight
  );
  assert.ok(fillIndex >= 0 && fillIndex < translateIndex, 'a full-canvas fill precedes the translate');
  assert.equal(calls[fillIndex].saveDepth, 0, 'the fill happens outside the shaken save scope');
});

const renderSagFrame = (engine, { patterns, reducedMotion }) => {
  const renderer = createRenderer();
  renderer.setColorPatterns(patterns);
  engine.setReducedMotion(reducedMotion);
  const ctx = renderer.ctx;
  for (const alpha of [0.5, 1.0]) {
    renderer.render(engine, alpha);
    assert.equal(ctx.saveDepth, 0, 'save/restore depth must return to 0');
    assert.equal(ctx.restoreUnderflows, 0, 'restore must never run without a save');
    assert.equal(ctx.globalAlpha, 1, 'globalAlpha must be back to 1');
  }
  return { renderer, ctx };
};

test('The Sag gauge and the lowering offset leave the canvas state balanced in every phase', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  const size = engine.getSagState().size;
  assert.ok(size > 0, 'Survival has a Sag meter');
  const levels = { calm: 1, warn: size - 1, full: size };
  for (const [phase, level] of Object.entries(levels)) {
    engine.sagLevel = level;
    engine.railLowerFrames = 0;
    assert.equal(engine.getSagState().phase, phase);
    for (const patterns of [false, true]) {
      for (const reducedMotion of [false, true]) {
        engine.railLowerFrames = gameConfig.sag.lowerFrames;
        renderSagFrame(engine, { patterns, reducedMotion });
      }
    }
  }
});

test('The Sag gauge draws one segment per slot and a dashed outline only in warning', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  const size = engine.getSagState().size;
  engine.railLowerFrames = 0;
  engine.sagLevel = 1;
  const gauge = gameConfig.sag.gauge;
  const segments = (calls) => calls.filter(
    (c) => c.name === 'fillRect' && c.args[2] === gauge.width && c.args[3] === gauge.segmentHeight
  );
  const calm = renderSagFrame(engine, { patterns: false, reducedMotion: false }).ctx.calls;
  assert.equal(segments(calm).length, size * 2, 'one filled rectangle per segment, over two frames');
  assert.equal(calm.filter((c) => c.name === 'strokeRect').length, 0, 'no outline when calm');
  engine.sagLevel = size - 1;
  const warn = renderSagFrame(engine, { patterns: false, reducedMotion: false }).ctx.calls;
  assert.ok(warn.some((c) => c.name === 'strokeRect'), 'an outline in warning');
  assert.ok(warn.some((c) => c.name === 'setLineDash' && c.args[0].length > 0), 'the outline is dashed');
});

test('A Sag step eases the cluster down, and not at all under reduced motion', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  const renderer = createRenderer();
  renderer.isReducedMotion = false;
  const frames = gameConfig.sag.lowerFrames;
  engine.railLowerFrames = frames;
  assert.equal(renderer.getRailLowerOffset(engine), gameConfig.endless.descentStepY, 'a fresh step starts a full step above');
  engine.railLowerFrames = Math.floor(frames / 2);
  const mid = renderer.getRailLowerOffset(engine);
  assert.ok(mid > 0 && mid < gameConfig.endless.descentStepY, 'it eases toward the physical place');
  engine.railLowerFrames = 0;
  assert.equal(renderer.getRailLowerOffset(engine), 0);
  engine.railLowerFrames = frames;
  renderer.isReducedMotion = true;
  assert.equal(renderer.getRailLowerOffset(engine), 0, 'no ease under reduced motion');
});

test('A mode without a Sag meter draws no gauge and no offset', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.railLowerFrames = gameConfig.sag.lowerFrames;
  const { renderer, ctx } = renderSagFrame(engine, { patterns: false, reducedMotion: false });
  assert.equal(renderer.getRailLowerOffset(engine), 0);
  const gauge = gameConfig.sag.gauge;
  assert.equal(
    ctx.calls.filter((c) => c.name === 'fillRect' && c.args[2] === gauge.width && c.args[3] === gauge.segmentHeight).length,
    0
  );
});

test('The Classic anchor rail is drawn and the frame stays balanced while it lowers', { skip: typeof GameEngine.prototype.startClassicMode !== 'function' && 'startClassicMode is not merged yet' }, () => {
  const engine = createTestEngine();
  engine.startClassicMode(1);
  const size = engine.getSagState().size;
  for (const level of [0, size - 1, size]) {
    engine.sagLevel = level;
    engine.railDrops = 2;
    engine.railLowerFrames = gameConfig.sag.lowerFrames;
    const { renderer, ctx } = renderSagFrame(engine, { patterns: true, reducedMotion: false });
    assert.ok(renderer.getRailLowerOffset(engine) > 0);
    const rails = ctx.calls.filter((c) => c.name === 'fillRect' && c.args[3] === 6);
    assert.ok(rails.length > 0, 'the rail bar is drawn');
  }
});

test('The lowering offset moves the cluster and the anchor rail, never the fixed obstacles', () => {
  const engine = createTestEngine();
  engine.startClassicMode(1);
  engine.railLowerFrames = gameConfig.sag.lowerFrames;
  const renderer = createRenderer();
  renderer.setColorPatterns(false);
  engine.setReducedMotion(false);
  const ctx = renderer.ctx;
  const upwardTranslates = () => ctx.calls.filter((c) => c.name === 'translate' && c.args[1] < 0).length;
  const seen = {};
  for (const name of ['drawObstacles', 'drawRails', 'drawAnchorRail', 'drawMagneticBonds']) {
    const original = renderer[name].bind(renderer);
    renderer[name] = (...args) => {
      seen[name] = upwardTranslates();
      return original(...args);
    };
  }
  renderer.render(engine, 1.0);
  assert.equal(seen.drawObstacles, 0, 'obstacles are drawn without the lowering offset');
  assert.equal(seen.drawRails, 0, 'rails are drawn without the lowering offset');
  assert.equal(seen.drawAnchorRail, 1, 'the anchor rail eases down with the cluster');
  assert.equal(seen.drawMagneticBonds, 1, 'the bonds ease down with the cluster');
  assert.equal(ctx.saveDepth, 0);
});

const createListenerWindow = () => {
  const log = { added: [], removed: [], observers: [], queries: [] };
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener: (type, handler) => log.added.push({ type, handler }),
    removeEventListener: (type, handler) => log.removed.push({ type, handler }),
    matchMedia(query) {
      const entry = { query, added: [], removed: [] };
      log.queries.push(entry);
      return {
        addEventListener: (type, handler) => entry.added.push({ type, handler }),
        removeEventListener: (type, handler) => entry.removed.push({ type, handler })
      };
    }
  };
  globalThis.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb;
      this.disconnected = 0;
      log.observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected++;
    }
  };
  return log;
};

const restoreListenerWindow = () => {
  delete globalThis.window;
  delete globalThis.ResizeObserver;
};

test('Renderer.dispose removes every window, observer and media query listener, and is idempotent', () => {
  const log = createListenerWindow();
  try {
    const renderer = createRenderer();
    assert.equal(log.added.length, 2);
    assert.equal(log.observers.length, 1);
    assert.equal(log.queries[0].added.length, 1);
    renderer.dispose();
    assert.deepEqual(log.removed, log.added, 'each added window listener is removed with the same handler');
    assert.equal(log.observers[0].disconnected, 1);
    assert.equal(log.queries[0].removed.length, 1);
    assert.equal(log.queries[0].removed[0].handler, log.queries[0].added[0].handler);
    renderer.dispose();
    assert.equal(log.removed.length, log.added.length, 'a second dispose removes nothing more');
    assert.equal(log.observers[0].disconnected, 1);
    assert.equal(log.queries[0].removed.length, 1);
  } finally {
    restoreListenerWindow();
  }
});

test('Renderer.dispose removes the re-armed media query listener and stops re-arming', () => {
  const log = createListenerWindow();
  try {
    const renderer = createRenderer();
    log.queries[0].added[0].handler();
    assert.equal(log.queries.length, 2, 'a change re-arms a new query');
    renderer.dispose();
    assert.equal(log.queries[1].removed.length, 1);
    assert.equal(log.queries[0].removed.length, 0, 'the fired once-listener is not removed again');
    renderer.watchDevicePixelRatio(() => {});
    assert.equal(log.queries.length, 2, 'a disposed renderer never arms a new query');
  } finally {
    restoreListenerWindow();
  }
});

test('Renderer.dispose is safe without a window', () => {
  const renderer = createRenderer();
  renderer.dispose();
  renderer.dispose();
  assert.equal(renderer.disposed, true);
});

const LITE_SKIPPED_DRAWS = ['drawParticles', 'drawTrail', 'drawShatteringBalls', 'drawWallCracks', 'drawSlowMoOverlay', 'drawAimTrajectory'];

const renderFrameWithCalls = (renderer, engine, names) => {
  const called = [];
  for (const name of names) {
    const original = renderer[name].bind(renderer);
    renderer[name] = (...args) => {
      called.push(name);
      return original(...args);
    };
  }
  renderer.render(engine, 1.0);
  return called;
};

const createLiteRenderer = () => {
  const renderer = new Renderer(createStubCanvas(), gameConfig, ballsConfig, obstaclesConfig, { lite: true });
  renderer.createLayerCanvas = () => createStubCanvas();
  return renderer;
};

test('Lite renderer fixes the pixel ratio and skips particles, aim preview and slow-motion overlay', () => {
  createListenerWindow();
  try {
    const engine = createTestEngine();
    engine.startClassicMode(1);
    engine.setReducedMotion(false);
    engine.aimPoints = [{ x: 100, y: 100 }, { x: 120, y: 80 }];
    const lite = createLiteRenderer();
    const full = createRenderer();
    assert.equal(lite.dpr, 1, 'window dpr is 2 but the lite renderer stays at 1');
    assert.equal(full.dpr, 2);
    const liteCalls = renderFrameWithCalls(lite, engine, LITE_SKIPPED_DRAWS);
    const fullCalls = renderFrameWithCalls(full, engine, LITE_SKIPPED_DRAWS);
    for (const name of LITE_SKIPPED_DRAWS) {
      assert.ok(!liteCalls.includes(name), `lite skips ${name}`);
    }
    for (const name of ['drawParticles', 'drawTrail', 'drawShatteringBalls', 'drawWallCracks', 'drawSlowMoOverlay']) {
      assert.ok(fullCalls.includes(name), `full draws ${name}`);
    }
    assert.equal(lite.ctx.saveDepth, 0, 'save/restore stays balanced in lite mode');
    assert.equal(lite.ctx.restoreUnderflows, 0);
  } finally {
    restoreListenerWindow();
  }
});

test('Lite renderer still draws the board: balls, rail, danger line and sag gauge', () => {
  const engine = createTestEngine();
  engine.startClassicMode(1);
  const names = ['drawBall', 'drawAnchorRail', 'drawDangerZone', 'drawSagGauge', 'drawMagneticBonds', 'drawLauncher'];
  const seen = renderFrameWithCalls(createLiteRenderer(), engine, names);
  for (const name of names) {
    assert.ok(seen.includes(name), `${name} still runs in lite mode`);
  }
});

test('drawVersusCharges runs only when the engine has a versus state', () => {
  const engine = createTestEngine();
  engine.startClassicMode(1);
  assert.ok(!renderFrameWithCalls(createRenderer(), engine, ['drawVersusCharges']).includes('drawVersusCharges'));
  engine.versus = { charges: [] };
  const renderer = createRenderer();
  assert.ok(renderFrameWithCalls(renderer, engine, ['drawVersusCharges']).includes('drawVersusCharges'));
  assert.equal(renderer.ctx.saveDepth, 0);
});

test('Single-player render call log is unchanged (golden)', () => {
  const engine = createTestEngine();
  engine.startClassicMode(1);
  engine.setReducedMotion(false);
  const names = [
    'drawWallCracks', 'drawLiquid', 'drawCollectorBins', 'drawDangerZone', 'drawObstacles', 'drawRails',
    'drawAnchorRail', 'drawMagneticBonds', 'drawTethers', 'drawChainLinkOverlays', 'drawShatteringBalls',
    'drawTrail', 'drawLauncher', 'drawSagGauge', 'drawParticles', 'drawSlowMoOverlay'
  ];
  assert.deepEqual(renderFrameWithCalls(createRenderer(), engine, names), names);
});

/**
 * Canvas context that records every method call (with its arguments) and every property
 * write, so two renderers can be compared draw call for draw call.
 */
const createRecordingCanvas = (log) => {
  const describe = (value) => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : String(value);
    }
    if (value && typeof value === 'object') {
      if (typeof value.getContext === 'function' || value.isRecordingTarget) {
        return '[canvas]';
      }
      if (value.isGradient) {
        return `[gradient:${value.id}]`;
      }
      return JSON.parse(JSON.stringify(value, (key, inner) => (typeof inner === 'function' ? '[fn]' : inner)));
    }
    return typeof value === 'function' ? '[fn]' : value;
  };
  let gradients = 0;
  const props = {};
  const ctx = new Proxy(props, {
    get(target, prop) {
      if (typeof prop === 'symbol') {
        return undefined;
      }
      if (prop in target) {
        return target[prop];
      }
      return (...args) => {
        log.push([prop, ...args.map(describe)]);
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          const gradient = { isGradient: true, id: gradients++, addColorStop: (...stop) => log.push(['addColorStop', gradient.id, ...stop]) };
          return gradient;
        }
        if (prop === 'measureText') {
          return { width: 10 };
        }
        return undefined;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      log.push(['set', prop, describe(value)]);
      return true;
    }
  });
  return {
    width: 0,
    height: 0,
    isRecordingTarget: true,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 })
  };
};

const FROZEN_CLOCK_MS = 1000;
const RANDOM_SEED_MULTIPLIER = 16807;
const RANDOM_SEED_MODULUS = 2147483647;
const RANDOM_SEED_START = 12345;

/** Runs fn with Math.random and performance.now replaced by deterministic sources. */
const withDeterministicSources = (fn) => {
  const realRandom = Math.random;
  const realNow = performance.now;
  let seed = RANDOM_SEED_START;
  Math.random = () => {
    seed = (seed * RANDOM_SEED_MULTIPLIER) % RANDOM_SEED_MODULUS;
    return seed / RANDOM_SEED_MODULUS;
  };
  performance.now = () => FROZEN_CLOCK_MS;
  try {
    return fn();
  } finally {
    Math.random = realRandom;
    performance.now = realNow;
  }
};

const recordFrame = (RendererClass, prepare) => withDeterministicSources(() => {
  const log = [];
  const canvas = createRecordingCanvas(log);
  const renderer = new RendererClass(canvas, gameConfig, ballsConfig, obstaclesConfig);
  renderer.createLayerCanvas = () => createRecordingCanvas(log);
  const engine = createTestEngine();
  engine.startClassicMode(1);
  engine.setReducedMotion(true);
  prepare?.(engine);
  log.length = 0;
  renderer.render(engine, 1.0);
  renderer.render(engine, 0.5);
  return log;
});

test('Single-player render output equals the frozen v1.19.0 renderer draw call for draw call', () => {
  const scenarios = [
    undefined,
    (engine) => {
      engine.aimPoints = [{ x: 100, y: 100 }, { x: 120, y: 80 }];
    }
  ];
  for (const prepare of scenarios) {
    const frozen = recordFrame(FrozenRenderer, prepare);
    const current = recordFrame(Renderer, prepare);
    assert.ok(frozen.length > 100, 'the reference frame records many draw calls');
    assert.deepEqual(current, frozen);
  }
});
