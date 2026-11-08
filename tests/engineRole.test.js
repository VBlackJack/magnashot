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
import { GameEngine, ENGINE_ROLES } from '../src/game/GameEngine.js';
import { GAME_MODES, GAME_STATES } from '../src/core/Constants.js';
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

const MAX_SHOT_FRAMES = 2000;
const SCRIPTED_ANGLES = [-1.9, -1.3, -1.57, -1.2, -1.8, -1.45, -1.7, -1.35, -1.6, -1.25];
const SEED_VALUE = 0.4242;

/** localStorage stand-in that counts every write and removal. */
const createSpyStorage = () => {
  const data = new Map();
  const spy = { writes: 0, removals: 0 };
  return {
    data,
    spy,
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { spy.writes += 1; data.set(k, String(v)); },
    removeItem(k) { spy.removals += 1; data.delete(k); },
    clear() { data.clear(); }
  };
};

const withStorage = (storage, fn) => {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  }
};

const createSpyAudio = () => {
  const calls = { playEffect: 0, stopAll: 0 };
  return {
    calls,
    playEffect: () => { calls.playEffect += 1; },
    stopAll: () => { calls.stopAll += 1; },
    isMuted: () => true,
    setMuted: () => {}
  };
};

const createEngine = ({ storageManager, audioManager, ...options }) =>
  new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    campaignConfig,
    campaignTuning,
    fluxConfig,
    audioManager,
    storageManager,
    onStateChange: () => {},
    ...options
  });

const playScriptedShots = (engine) => {
  for (const angle of SCRIPTED_ANGLES) {
    if (engine.state !== GAME_STATES.PLAYING) {
      break;
    }
    engine.updateAimFromAngle(angle);
    engine.shoot();
    for (let frame = 0; frame < MAX_SHOT_FRAMES && engine.state === GAME_STATES.PLAYING; frame++) {
      engine.update();
      if (!engine.physicsWorld.projectile) {
        break;
      }
    }
  }
};

test('the role defaults to main and any unknown role falls back to main', () => {
  withStorage(createSpyStorage(), () => {
    const manager = new StorageManager();
    manager.init();
    const main = createEngine({ storageManager: manager, audioManager: createSpyAudio() });
    const odd = createEngine({ storageManager: manager, audioManager: createSpyAudio(), role: 'nonsense' });
    const versus = createEngine({
      storageManager: createVersusStorageView(manager),
      audioManager: createSpyAudio(),
      role: ENGINE_ROLES.VERSUS
    });
    assert.equal(main.role, ENGINE_ROLES.MAIN);
    assert.equal(odd.role, ENGINE_ROLES.MAIN);
    assert.equal(versus.role, ENGINE_ROLES.VERSUS);
    assert.equal(versus.isVersusRole, true);
    assert.equal(main.isVersusRole, false);
  });
});

test('a versus engine plays a scripted Classic game and writes nothing to localStorage', () => {
  const storage = createSpyStorage();
  withStorage(storage, () => {
    const manager = new StorageManager();
    manager.init();
    const before = { writes: storage.spy.writes, removals: storage.spy.removals, keys: storage.data.size };
    const audio = createSpyAudio();
    const engine = createEngine({
      storageManager: createVersusStorageView(manager),
      audioManager: createAudioChannel(audio),
      role: ENGINE_ROLES.VERSUS
    });
    engine.startClassicMode();
    assert.equal(engine.mode, GAME_MODES.CLASSIC);
    const shoot = engine.shoot.bind(engine);
    let shotsFired = 0;
    engine.shoot = () => { shotsFired += 1; shoot(); };
    playScriptedShots(engine);
    engine.pauseGame?.();
    engine.recordAbandonedRun();
    engine.flushPlayerStats();
    assert.ok(shotsFired > 0, 'the scripted game must fire shots');
    assert.equal(storage.spy.writes, before.writes, 'a versus engine must not write');
    assert.equal(storage.spy.removals, before.removals, 'a versus engine must not remove');
    assert.equal(storage.data.size, before.keys);
  });
});

test('a versus engine keeps no hint, shot timeline, ghost or statistics', () => {
  withStorage(createSpyStorage(), () => {
    const manager = new StorageManager();
    manager.init();
    const engine = createEngine({
      storageManager: createVersusStorageView(manager),
      audioManager: createSpyAudio(),
      role: ENGINE_ROLES.VERSUS
    });
    engine.startClassicMode();
    playScriptedShots(engine);
    assert.equal(engine.activeDiscoveryId, null);
    assert.equal(engine.discoveryShownIds.size, 0);
    assert.equal(engine.shotTimeline, null);
    assert.equal(engine.pendingShots, 0);
    assert.equal(engine.pendingPlayMs, 0);
    engine.sampleShotTimeline();
    assert.equal(engine.shotTimeline, null);
    engine.recordRunOutcome('loss');
    assert.equal(engine.runOutcomeRecorded, false);
    assert.equal(engine.startGhostDuel({ mode: 'daily', key: '2026-01-01' }), false);
    assert.equal(engine.ghostDuel, null);
  });
});

test('a versus engine uses only the injected audio', () => {
  withStorage(createSpyStorage(), () => {
    const manager = new StorageManager();
    manager.init();
    const audio = createSpyAudio();
    const engine = createEngine({
      storageManager: createVersusStorageView(manager),
      audioManager: createAudioChannel(audio, { muted: true }),
      role: ENGINE_ROLES.VERSUS
    });
    engine.startClassicMode();
    playScriptedShots(engine);
    assert.equal(audio.calls.playEffect, 0, 'a muted channel keeps the shared manager silent');
    assert.equal(audio.calls.stopAll, 0, 'a channel never stops the shared manager');
  });
});

test('the main role is unchanged: it still counts shots and plays through the injected storage', () => {
  const storage = createSpyStorage();
  withStorage(storage, () => {
    const manager = new StorageManager();
    manager.init();
    const engine = createEngine({ storageManager: manager, audioManager: createSpyAudio() });
    engine.startClassicMode();
    playScriptedShots(engine);
    assert.ok(engine.runShotsFired > 0);
    assert.ok(engine.pendingShots > 0 || manager.getPlayerStats().shots > 0, 'shots are counted for stats');
    assert.equal(engine.isVersusRole, false);
  });
});

test('Classic seeds its run stream from an injected source, Math.random by default', () => {
  withStorage(createSpyStorage(), () => {
    const manager = new StorageManager();
    manager.init();
    let draws = 0;
    const seedSource = () => { draws += 1; return SEED_VALUE; };
    const first = createEngine({ storageManager: manager, audioManager: createSpyAudio(), seedSource });
    first.startClassicMode();
    const second = createEngine({ storageManager: manager, audioManager: createSpyAudio(), seedSource });
    second.startClassicMode();
    assert.equal(draws, 2, 'the injected source feeds each Classic start once');
    const signature = (engine) => engine.physicsWorld.balls.map((b) => [b.x, b.y, b.colorId]);
    assert.deepEqual(signature(first), signature(second));
    assert.equal(first.currentBall.colorId, second.currentBall.colorId);
    assert.deepEqual(first.upcomingColorIds, second.upcomingColorIds);

    const originalRandom = Math.random;
    let ambientDraws = 0;
    Math.random = () => { ambientDraws += 1; return SEED_VALUE; };
    try {
      const plain = createEngine({ storageManager: manager, audioManager: createSpyAudio() });
      plain.startClassicMode();
    } finally {
      Math.random = originalRandom;
    }
    assert.ok(ambientDraws > 0, 'without a source the ambient Math.random is still used');
  });
});
