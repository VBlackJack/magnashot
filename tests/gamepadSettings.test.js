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
import { INPUT_MODES } from '../src/core/Constants.js';

const gameConfig = JSON.parse(fs.readFileSync('./configs/game.json', 'utf8'));
configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('campaign', JSON.parse(fs.readFileSync('./configs/campaign.json', 'utf8')));
configRegistry.configs.set('levels',JSON.parse(fs.readFileSync('./configs/levels.json', 'utf8')));

const gamepadCfg = gameConfig.gamepad;
const keys = gameConfig.storage.keys;

const createStorage = () => {
  const storage = new StorageManager();
  storage.init();
  return storage;
};

test('Gamepad input mode exists', () => {
  assert.equal(INPUT_MODES.GAMEPAD, 'gamepad');
});

test('Gamepad config exposes the documented defaults and storage keys', () => {
  assert.deepEqual(gamepadCfg.deadzoneOptions, [0.1, 0.18, 0.25]);
  assert.ok(gamepadCfg.deadzoneOptions.includes(gamepadCfg.defaultDeadzone));
  assert.ok(Object.hasOwn(gamepadCfg.aimSpeedRadPerSec, gamepadCfg.defaultAimSpeed));
  assert.equal(keys.gamepadEnabled, 'gamepad_enabled');
  assert.equal(keys.gamepadDeadzone, 'gamepad_deadzone');
  assert.equal(keys.gamepadAimSpeed, 'gamepad_aim_speed');
  assert.equal(keys.gamepadInvertX, 'gamepad_invert_x');
});

test('Gamepad settings default to on, default deadzone, normal speed, not inverted', () => {
  const storage = createStorage();
  assert.equal(storage.getGamepadEnabled(), true);
  assert.equal(storage.getGamepadDeadzone(), gamepadCfg.defaultDeadzone);
  assert.equal(storage.getGamepadAimSpeed(), 'normal');
  assert.equal(storage.getGamepadInvertX(), false);
});

test('Gamepad settings round-trip', () => {
  const storage = createStorage();
  storage.setGamepadEnabled(false);
  assert.equal(storage.getGamepadEnabled(), false);
  storage.setGamepadEnabled(true);
  assert.equal(storage.getGamepadEnabled(), true);
  for (const value of gamepadCfg.deadzoneOptions) {
    storage.setGamepadDeadzone(value);
    assert.equal(storage.getGamepadDeadzone(), value);
  }
  for (const speed of Object.keys(gamepadCfg.aimSpeedRadPerSec)) {
    storage.setGamepadAimSpeed(speed);
    assert.equal(storage.getGamepadAimSpeed(), speed);
  }
  storage.setGamepadInvertX(true);
  assert.equal(storage.getGamepadInvertX(), true);
  storage.setGamepadInvertX(false);
  assert.equal(storage.getGamepadInvertX(), false);
});

test('Invalid gamepad values are rejected on write and on read', () => {
  const storage = createStorage();
  storage.setGamepadDeadzone(0.25);
  storage.setGamepadDeadzone(0.33);
  storage.setGamepadDeadzone('abc');
  assert.equal(storage.getGamepadDeadzone(), 0.25, 'a rejected write keeps the previous value');
  storage.setGamepadAimSpeed('fast');
  storage.setGamepadAimSpeed('turbo');
  storage.setGamepadAimSpeed(undefined);
  assert.equal(storage.getGamepadAimSpeed(), 'fast', 'a rejected write keeps the previous value');

  storage.safeSetItem(keys.gamepadDeadzone, '0.9');
  assert.equal(storage.getGamepadDeadzone(), gamepadCfg.defaultDeadzone, 'tampered deadzone falls back');
  storage.safeSetItem(keys.gamepadAimSpeed, 'toString');
  assert.equal(storage.getGamepadAimSpeed(), 'normal', 'inherited property names are not speeds');
  storage.safeSetItem(keys.gamepadEnabled, 'garbage');
  assert.equal(storage.getGamepadEnabled(), false, 'only the stored string "true" enables');
});
