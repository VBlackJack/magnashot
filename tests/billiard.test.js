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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BilliardGame } from '../src/game/Billiard.js';

const CONFIG = JSON.parse(readFileSync(new URL('../configs/billiard.json', import.meta.url), 'utf8'));
const DIRECT_TABLE = 0;
const BANK_TABLE = 1;
const POSITION_TABLE = 2;
const BANK_ANGLE = -2.7;
const BANK_POWER = 0.55;
const POSITION_ANGLE = Math.atan2(-140, 100);
const CONTROLLED_POWER = 0.45;
const HARD_POWER = 0.65;
const SIMULATION_TIMEOUT_SEC = 10;
const GEOMETRY_TOLERANCE = 1e-6;

function settle(game, frame = CONFIG.stepSec) {
  const frameLimit = Math.ceil(SIMULATION_TIMEOUT_SEC / frame);
  for (let i = 0; i < frameLimit && game.state === 'moving'; i += 1) game.update(frame);
  assert.notEqual(game.state, 'moving', 'the shot must finish within the simulation timeout');
}

function play(game, angle, power, frame) {
  game.setAngle(angle);
  game.setPower(power);
  assert.equal(game.shoot(), true);
  settle(game, frame);
}

function angleToGhostBall(cue, ball, pocket) {
  const dx = pocket.x - ball.x;
  const dy = pocket.y - ball.y;
  const length = Math.hypot(dx, dy);
  const contactGap = cue.radius + ball.radius;
  return Math.atan2(
    ball.y - contactGap * dy / length - cue.y,
    ball.x - contactGap * dx / length - cue.x
  );
}

test('the direct table can be cleared in one stroke and replay restores its opening', () => {
  const game = new BilliardGame(CONFIG, DIRECT_TABLE);
  const initial = structuredClone(game.balls);
  play(game, -Math.PI / 2, 0.5);
  assert.equal(game.state, 'won');
  assert.equal(game.shotsUsed, 1);
  assert.deepEqual(game.balls.map((ball) => ball.id), ['cue']);
  assert.equal(game.reset(), true);
  assert.equal(game.state, 'aiming');
  assert.equal(game.shotsUsed, 0);
  assert.equal(game.nextTarget, 'one');
  assert.deepEqual(game.balls, initial);
});

test('the screen ball intercepts the direct line and several nearby bank shots still win', () => {
  const game = new BilliardGame(CONFIG, BANK_TABLE);
  const screen = game.balls.find((ball) => ball.id === 'screen');
  const target = game.balls.find((ball) => ball.id === 'one');
  const directAngle = Math.atan2(target.y - game.cue.y, target.x - game.cue.x);
  game.setAngle(directAngle);
  const guide = game.preview();
  assert.equal(guide.length, 2);
  assert.ok(Math.abs(Math.hypot(guide[1].x - screen.x, guide[1].y - screen.y)
    - (screen.radius + game.cue.radius)) < GEOMETRY_TOLERANCE);

  play(game, directAngle, 1);
  assert.notEqual(game.state, 'won');
  for (const angle of [BANK_ANGLE - 0.01, BANK_ANGLE, BANK_ANGLE + 0.01]) {
    for (const power of [BANK_POWER - 0.1, BANK_POWER, BANK_POWER + 0.1]) {
      game.reset();
      game.setAngle(angle);
      game.setPower(power);
      assert.equal(game.preview().length, 3, 'the path starts with a cushion');
      play(game, angle, power);
      assert.equal(game.state, 'won', `angle ${angle}, power ${power}`);
      assert.equal(game.shotsUsed, 1);
    }
  }
});

test('the first cushion and outgoing direction agree with the live bounce', () => {
  const game = new BilliardGame(CONFIG, BANK_TABLE);
  game.setAngle(BANK_ANGLE);
  game.setPower(BANK_POWER);
  const [start, cushion, exit] = game.preview();
  assert.equal(cushion.x, CONFIG.bounds.left + CONFIG.ballRadius);
  assert.equal(game.shoot(), true);
  const maxFrames = Math.ceil(SIMULATION_TIMEOUT_SEC / CONFIG.stepSec);
  for (let i = 0; i < maxFrames && game.cue.vx < 0; i += 1) game.update(CONFIG.stepSec);
  assert.ok(game.cue.vx > 0, 'the white ball bounced off the left cushion');

  const dx = exit.x - cushion.x;
  const dy = exit.y - cushion.y;
  const outgoingSlope = game.cue.vy / game.cue.vx;
  assert.ok(Math.abs(outgoingSlope - dy / dx) < GEOMETRY_TOLERANCE);
  const liveYAtCushion = game.cue.y - outgoingSlope * (game.cue.x - cushion.x);
  assert.ok(Math.abs(liveYAtCushion - cushion.y) < GEOMETRY_TOLERANCE);
  assert.ok(start.x > cushion.x);
  settle(game);
  assert.equal(game.state, 'won');
});

test('same opening aim with less power leaves a broader direct finish on the placement table', () => {
  const light = new BilliardGame(CONFIG, POSITION_TABLE);
  const hard = new BilliardGame(CONFIG, POSITION_TABLE);
  play(light, POSITION_ANGLE, CONTROLLED_POWER);
  play(hard, POSITION_ANGLE, HARD_POWER);
  assert.equal(light.nextTarget, 'two');
  assert.equal(hard.nextTarget, 'two');
  assert.equal(light.state, 'aiming');
  assert.equal(hard.state, 'aiming');
  assert.ok(hard.cue.x - light.cue.x > CONFIG.ballRadius * 8);
  assert.equal(light.cue.vx, 0);
  assert.equal(hard.cue.vx, 0);

  const corner = CONFIG.pockets.find(({ x, y }) => x === CONFIG.bounds.right && y === CONFIG.bounds.bottom);
  const countFinishes = (openingPower) => {
    let successes = 0;
    for (const offset of [0, 0.02]) {
      for (const power of [0.4, 0.5, 0.6]) {
        const game = new BilliardGame(CONFIG, POSITION_TABLE);
        play(game, POSITION_ANGLE, openingPower);
        const target = game.balls.find((ball) => ball.id === 'two');
        const angle = angleToGhostBall(game.cue, target, corner) + offset;
        game.setAngle(angle);
        game.setPower(power);
        const guide = game.preview();
        const contact = guide.length === 2 && Math.abs(
          Math.hypot(guide[1].x - target.x, guide[1].y - target.y) - (game.cue.radius + target.radius)
        ) < GEOMETRY_TOLERANCE;
        play(game, angle, power);
        if (contact && game.state === 'won') successes += 1;
      }
    }
    return successes;
  };

  assert.equal(countFinishes(CONTROLLED_POWER), 6);
  assert.equal(countFinishes(HARD_POWER), 0);
});

test('frame grouping preserves the final position and commands are ignored while balls roll', () => {
  const fine = new BilliardGame(CONFIG, POSITION_TABLE);
  const coarse = new BilliardGame(CONFIG, POSITION_TABLE);
  play(fine, POSITION_ANGLE, CONTROLLED_POWER);
  coarse.setAngle(POSITION_ANGLE + 4 * Math.PI);
  coarse.setPower(CONTROLLED_POWER);
  assert.equal(coarse.shoot(), true);
  assert.equal(coarse.shoot(), false);
  coarse.setAngle(Math.PI);
  coarse.setPower(1);
  assert.deepEqual(coarse.preview(), []);
  settle(coarse, CONFIG.stepSec * 8);
  assert.equal(coarse.nextTarget, fine.nextTarget);
  assert.equal(coarse.shotsUsed, fine.shotsUsed);
  for (const ball of coarse.balls) {
    const expected = fine.balls.find(({ id }) => id === ball.id);
    assert.ok(Math.hypot(ball.x - expected.x, ball.y - expected.y) < GEOMETRY_TOLERANCE);
    assert.equal(ball.vx, expected.vx);
    assert.equal(ball.vy, expected.vy);
  }
});

test('the nearest pocket ends the guide and scratching loses the table', () => {
  const game = new BilliardGame(CONFIG, DIRECT_TABLE);
  game.cue.x = CONFIG.bounds.right - CONFIG.ballRadius;
  game.cue.y = CONFIG.bounds.top + CONFIG.ballRadius;
  game.cue.x -= CONFIG.pocketRadius;
  game.setAngle(Math.PI);
  game.setPower(1);
  const [start, capture] = game.preview();
  const pocket = CONFIG.pockets.find(({ x, y }) => x === CONFIG.width / 2 && y === CONFIG.bounds.top);
  assert.ok(capture.x < start.x && capture.x > pocket.x);
  assert.ok(Math.abs(Math.hypot(capture.x - pocket.x, capture.y - pocket.y) - CONFIG.pocketRadius)
    < GEOMETRY_TOLERANCE);
  play(game, Math.PI, 1);
  assert.equal(game.state, 'lost');
  assert.equal(game.reason, 'scratch');
  assert.equal(game.cue, null);
});

test('ordered targets and the shot budget terminate a missed table', () => {
  const game = new BilliardGame(CONFIG, POSITION_TABLE);
  const first = game.balls.find((ball) => ball.id === 'one');
  const second = game.balls.find((ball) => ball.id === 'two');
  const oldId = first.id;
  first.id = second.id;
  second.id = oldId;
  play(game, POSITION_ANGLE, CONTROLLED_POWER);
  assert.equal(game.state, 'lost');
  assert.equal(game.reason, 'wrongTarget');
  assert.equal(game.nextTarget, 'one');

  game.reset(DIRECT_TABLE);
  for (let shot = 0; shot < game.table.shotLimit; shot += 1) play(game, 0, 0);
  assert.equal(game.state, 'lost');
  assert.equal(game.reason, 'shotsExhausted');
  assert.equal(game.shoot(), false);
});
