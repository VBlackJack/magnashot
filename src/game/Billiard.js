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

const CUE_ID = 'cue';
const TAU = 2 * Math.PI;
/** Tolerance for floating-point comparisons in world coordinates and seconds. */
const EPSILON = 1e-9;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * Ray vs. circle intersection using a unit direction and the moving center.
 * A touching ball that is moving away cannot produce another contact.
 */
function circleEntry(x, y, ux, uy, cx, cy, radius, captureInside = false) {
  const dx = cx - x;
  const dy = cy - y;
  const offset = dx * dx + dy * dy - radius * radius;
  if (captureInside && offset <= EPSILON) return 0;
  const forward = dx * ux + dy * uy;
  if (forward <= EPSILON) return Infinity;
  const discriminant = forward * forward - offset;
  if (discriminant < 0) return Infinity;
  return Math.max(0, forward - Math.sqrt(discriminant));
}

function railDistance(ball, axis, direction, min, max) {
  if (Math.abs(direction) <= EPSILON) return Infinity;
  const boundary = direction > 0 ? max - ball.radius : min + ball.radius;
  return Math.max(0, (boundary - ball[axis]) / direction);
}

/** Distance from the center to its next pocket or cushion, common to play and preview. */
function findTableContact(ball, ux, uy, config) {
  const { bounds, pockets, pocketRadius } = config;
  const horizontal = railDistance(ball, 'x', ux, bounds.left, bounds.right);
  const vertical = railDistance(ball, 'y', uy, bounds.top, bounds.bottom);
  const rail = Math.min(horizontal, vertical);
  let pocketDistance = Infinity;
  for (const pocket of pockets) {
    pocketDistance = Math.min(pocketDistance,
      circleEntry(ball.x, ball.y, ux, uy, pocket.x, pocket.y, pocketRadius, true));
  }
  if (pocketDistance <= rail + EPSILON) return { kind: 'pocket', distance: pocketDistance };
  return {
    kind: 'rail',
    distance: rail,
    reflectX: horizontal <= rail + EPSILON,
    reflectY: vertical <= rail + EPSILON
  };
}

function reflect(contact, vx, vy, restitution) {
  return {
    vx: contact.reflectX ? -vx * restitution : vx,
    vy: contact.reflectY ? -vy * restitution : vy
  };
}

function precedes(time, contact) {
  return time < contact.time || (time === contact.time && !contact.kind);
}

function transferMomentum(a, b, restitution) {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = (b.x - a.x) / distance;
  const ny = (b.y - a.y) / distance;
  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  const impulse = closing * (1 + restitution) / 2;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;
}

function cueContact(cue, ux, uy, balls, config) {
  let closest = findTableContact(cue, ux, uy, config);
  for (const ball of balls) {
    if (ball.id === CUE_ID) continue;
    const distance = circleEntry(cue.x, cue.y, ux, uy, ball.x, ball.y, cue.radius + ball.radius);
    if (distance < closest.distance) closest = { kind: 'ball', distance };
  }
  return closest;
}

export class BilliardGame {
  constructor(config, tableIndex = 0) {
    this.config = config;
    if (!this.reset(tableIndex)) this.reset(0);
  }

  get cue() {
    return this.balls.find((ball) => ball.id === CUE_ID) ?? null;
  }

  get nextTarget() {
    return this.table.targets[this.targetsPotted] ?? null;
  }

  reset(tableIndex = this.tableIndex) {
    if (!Number.isInteger(tableIndex) || !this.config.tables[tableIndex]) return false;
    this.tableIndex = tableIndex;
    this.table = this.config.tables[tableIndex];
    this.balls = this.table.balls.map((ball) => ({
      ...ball,
      radius: this.config.ballRadius,
      vx: 0,
      vy: 0
    }));
    this.angle = this.table.defaultAngle;
    this.power = this.table.defaultPower;
    this.shotsUsed = 0;
    this.targetsPotted = 0;
    this.elapsedSec = 0;
    this.state = 'aiming';
    this.reason = null;
    return true;
  }

  setAngle(radians) {
    if (this.state === 'aiming' && Number.isFinite(radians)) {
      this.angle = Math.atan2(Math.sin(radians % TAU), Math.cos(radians % TAU));
    }
  }

  setPower(power) {
    if (this.state === 'aiming' && Number.isFinite(power)) this.power = clamp(power, 0, 1);
  }

  shotSpeed() {
    const { minShotSpeed, maxShotSpeed } = this.config;
    return minShotSpeed + (maxShotSpeed - minShotSpeed) * this.power;
  }

  shoot() {
    if (this.state !== 'aiming') return false;
    const cue = this.cue;
    const speed = this.shotSpeed();
    cue.vx = Math.cos(this.angle) * speed;
    cue.vy = Math.sin(this.angle) * speed;
    this.shotsUsed += 1;
    this.elapsedSec = 0;
    this.state = 'moving';
    return true;
  }

  update(dtSeconds) {
    if (this.state !== 'moving' || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    const { maxFrameSec, stepSec } = this.config;
    this.elapsedSec += Math.min(dtSeconds, maxFrameSec);
    while (this.elapsedSec + EPSILON >= stepSec && this.state === 'moving') {
      this.elapsedSec -= stepSec;
      this.step(stepSec);
    }
  }

  advance(dt) {
    for (const ball of this.balls) {
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
    }
  }

  findNextContact(timeLimit) {
    let earliest = { time: timeLimit };
    for (const [index, ball] of this.balls.entries()) {
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > EPSILON) {
        const contact = findTableContact(ball, ball.vx / speed, ball.vy / speed, this.config);
        const time = contact.distance / speed;
        if (precedes(time, earliest)) earliest = { ...contact, time, ball };
      }
      for (let j = index + 1; j < this.balls.length; j += 1) {
        const other = this.balls[j];
        const vx = ball.vx - other.vx;
        const vy = ball.vy - other.vy;
        const relativeSpeed = Math.hypot(vx, vy);
        if (relativeSpeed <= EPSILON) continue;
        const time = circleEntry(
          ball.x, ball.y, vx / relativeSpeed, vy / relativeSpeed,
          other.x, other.y, ball.radius + other.radius
        ) / relativeSpeed;
        if (precedes(time, earliest)) earliest = { kind: 'ball', time, ball, other };
      }
    }
    return earliest;
  }

  step(dt) {
    const { maxEventsPerStep, rollingDeceleration, stopSpeed, railRestitution, ballRestitution } = this.config;
    let remaining = dt;
    for (let events = 0; events < maxEventsPerStep && remaining > EPSILON; events += 1) {
      const contact = this.findNextContact(remaining);
      this.advance(contact.time);
      remaining -= contact.time;
      if (contact.kind === 'pocket') {
        this.pot(contact.ball);
      } else if (contact.kind === 'rail') {
        Object.assign(contact.ball, reflect(contact, contact.ball.vx, contact.ball.vy, railRestitution));
      } else if (contact.kind === 'ball') {
        transferMomentum(contact.ball, contact.other, ballRestitution);
      }
    }

    let stillMoving = false;
    for (const ball of this.balls) {
      const speed = Math.hypot(ball.vx, ball.vy);
      const reduced = speed - rollingDeceleration * dt;
      if (reduced <= stopSpeed) {
        ball.vx = 0;
        ball.vy = 0;
      } else {
        ball.vx *= reduced / speed;
        ball.vy *= reduced / speed;
        stillMoving = true;
      }
    }
    if (!stillMoving) this.finishShot();
  }

  pot(ball) {
    this.balls = this.balls.filter((item) => item !== ball);
    if (ball.id === CUE_ID) {
      this.reason = 'scratch';
    } else if (ball.id === this.nextTarget) {
      this.targetsPotted += 1;
    } else if (this.table.targets.includes(ball.id)) {
      this.reason ??= 'wrongTarget';
    }
  }

  finishShot() {
    if (!this.reason && this.nextTarget === null) {
      this.state = 'won';
    } else if (this.reason || this.shotsUsed >= this.table.shotLimit) {
      this.reason ??= 'shotsExhausted';
      this.state = 'lost';
    } else {
      this.state = 'aiming';
    }
  }

  preview() {
    if (this.state !== 'aiming') return [];
    const cue = this.cue;
    const { rollingDeceleration, railRestitution, previewAfterRail } = this.config;
    const ux = Math.cos(this.angle);
    const uy = Math.sin(this.angle);
    const speed = this.shotSpeed();
    const first = cueContact(cue, ux, uy, this.balls, this.config);
    const range = speed * speed / (2 * rollingDeceleration);
    const firstDistance = Math.min(first.distance, range);
    const end = { x: cue.x + ux * firstDistance, y: cue.y + uy * firstDistance };
    const points = [{ x: cue.x, y: cue.y }, end];
    if (first.kind === 'rail' && first.distance < range) {
      const impactSpeed = Math.sqrt(speed * speed - 2 * rollingDeceleration * first.distance);
      const rebound = reflect(first, ux * impactSpeed, uy * impactSpeed, railRestitution);
      const reboundSpeed = Math.hypot(rebound.vx, rebound.vy);
      const dx = rebound.vx / reboundSpeed;
      const dy = rebound.vy / reboundSpeed;
      const second = cueContact({ ...end, radius: cue.radius }, dx, dy, this.balls, this.config);
      const span = Math.min(second.distance, reboundSpeed * reboundSpeed / (2 * rollingDeceleration), previewAfterRail);
      points.push({ x: end.x + dx * span, y: end.y + dy * span });
    }
    return points;
  }
}
