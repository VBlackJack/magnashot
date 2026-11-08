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
import { AudioManager } from '../src/core/AudioManager.js';
import { GameEngine, ENGINE_ROLES } from '../src/game/GameEngine.js';
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
configRegistry.configs.set('flux', fluxConfig);

const SEED_KEY = 'versus:fixes:r0';
const HIT_STOP_TEST_FRAMES = 3;
const PAN_RIGHT = 0.75;
const PAN_OUT_OF_RANGE = 4;
const EFFECT_NAME = 'match';

const createEngine = (options = {}) => {
  const storageManager = new StorageManager();
  storageManager.init();
  return new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    campaignConfig,
    campaignTuning,
    fluxConfig,
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager: options.versusView ? createVersusStorageView(storageManager) : storageManager,
    onStateChange: () => {},
    ...options.engine
  });
};

test('Starting a Campaign or Flux run after a versus board clears the versus state and its hooks', () => {
  for (const start of [(e) => e.startCampaignLevel(1), (e) => e.startFluxRun('versus-reset-seed')]) {
    const engine = createEngine();
    engine.startVersusBoard({ seedKey: SEED_KEY });
    assert.ok(engine.versus, 'the versus board carries its state');
    start(engine);
    assert.equal(engine.versus, null);
    const projectile = { specialType: null };
    engine.beginVersusTurn(projectile);
    engine.closeVersusTurn();
    assert.equal(engine.versus, null, 'the versus hooks do nothing on a plain run');
    assert.equal(engine.getVersusTotals?.() ?? null, null);
  }
});

test('A versus-role engine never freezes on hit-stop; a main engine still does', () => {
  const run = (versusRole) => {
    const engine = createEngine(versusRole ? { versusView: true, engine: { role: ENGINE_ROLES.VERSUS } } : {});
    engine.startClassicMode(1);
    engine.hitStopFrames = HIT_STOP_TEST_FRAMES;
    engine.update();
    return engine.hitStopFrames;
  };
  assert.equal(run(false), HIT_STOP_TEST_FRAMES - 1, 'a main engine spends one hit-stop frame');
  assert.equal(run(true), 0, 'a versus engine drops the hit-stop and steps the simulation');
});

class PanContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = { id: 'destination' };
    this.panners = [];
    this.gainTargets = [];
  }

  createParam() {
    return { value: 1, setValueAtTime() {}, cancelScheduledValues() {}, exponentialRampToValueAtTime() {} };
  }

  createOscillator() {
    return { frequency: this.createParam(), connect() {}, disconnect() {}, start() {}, stop() {} };
  }

  createGain() {
    const node = { gain: this.createParam(), disconnect() {} };
    node.connect = (target) => {
      node.connectedTo = target;
      this.gainTargets.push(target);
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
      connect() {}
    };
    return node;
  }

  suspend() {}
  resume() {}
}

class PanContextWithPanner extends PanContext {
  createStereoPanner() {
    const panner = { pan: { value: 0 }, connect() {}, disconnect() {} };
    this.panners.push(panner);
    return panner;
  }
}

const withAudio = (ContextClass, fn) => {
  globalThis.window = { AudioContext: ContextClass };
  try {
    const audio = new AudioManager();
    audio.init(false, false);
    audio.clock = () => 0;
    return fn(audio);
  } finally {
    delete globalThis.window;
  }
};

test('playEffect pans the voices of an effect when a pan is given and a panner exists', () => {
  withAudio(PanContextWithPanner, (audio) => {
    audio.playEffect(EFFECT_NAME, 0, { pan: PAN_RIGHT });
    const ctx = audio.ctx;
    assert.ok(ctx.panners.length > 0);
    assert.ok(ctx.panners.every((panner) => panner.pan.value === PAN_RIGHT));
    assert.equal(audio.activePan, undefined, 'the pan does not leak into the next effect');
    ctx.panners.length = 0;
    audio.lastEffectTimes.clear();
    audio.playEffect(EFFECT_NAME, 0, { pan: PAN_OUT_OF_RANGE });
    assert.ok(ctx.panners.every((panner) => panner.pan.value === 1), 'the pan is clamped to the stereo range');
  });
});

test('playEffect is unchanged without a pan, with a centred pan, or without StereoPannerNode', () => {
  withAudio(PanContextWithPanner, (audio) => {
    audio.playEffect(EFFECT_NAME, 0);
    audio.lastEffectTimes.clear();
    audio.playEffect(EFFECT_NAME, 0, { pan: 0 });
    audio.lastEffectTimes.clear();
    audio.playEffect(EFFECT_NAME, 0, {});
    assert.equal(audio.ctx.panners.length, 0, 'no panner node is created');
  });
  withAudio(PanContext, (audio) => {
    audio.playEffect(EFFECT_NAME, 0, { pan: PAN_RIGHT });
    assert.ok(audio.getActiveVoiceCount() > 0, 'the effect still plays without a panner');
  });
});
