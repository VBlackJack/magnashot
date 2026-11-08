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


import { SeededRandom } from '../core/SeededRandom.js';
import { GAME_STATES, SPECIAL_TYPES } from '../core/Constants.js';
import {
  CHARGE_OUTCOMES,
  advanceCharge,
  chargePolarityForColor,
  chargesInBlastRadius,
  computeVersusAttack,
  createCharge,
  guardStreak,
  isChargeThreatening,
  landingBalls,
  resolveChargeHit,
  segmentCircleHitT,
  shotPolarity
} from './VersusRules.js';
import { truncateAimAtCharges } from './ImpactPreview.js';
import { Ball } from '../entities/Ball.js';

// Kept exported here so existing callers of the foundation keep working.
export { computeVersusAttack };

const FIRST_STAGE = 1;
const FIRST_BOARD = 0;
const NO_PROGRESS = 0;
/** Charge rise time factor of a board without a handicap. */
const DEFAULT_RISE_MULTIPLIER = 1;
const FULL_PROGRESS = 1;
const STRONG_STRENGTH = 2;
const NORMAL_STRENGTH = 1;
const STRAIGHT_UP_VY = -1;
/** Two spheres closer than this share of their diameter overlap. */
const OVERLAP_TOLERANCE = 0.9;
/** Vertical offsets tried for the second sphere of a strong charge, in rest distances. */
const SECOND_SPHERE_Y_OFFSETS = Object.freeze([0, 0.5, -0.5]);

/** Event names an engine reports to its match controller. */
export const VERSUS_ENGINE_EVENTS = Object.freeze({
  CHARGE_INCOMING: 'chargeIncoming',
  CHARGE_NEUTRALISED: 'chargeNeutralised',
  CHARGE_WEAKENED: 'chargeWeakened',
  CHARGE_DEFLECTED: 'chargeDeflected',
  CHARGE_LANDED: 'chargeLanded',
  ATTACK_SENT: 'attackSent',
  GUARD_SPECIAL: 'guardSpecial',
  PULSE_SENT: 'pulseSent',
  PULSE_RECEIVED: 'pulseReceived',
  BOARD_LOST: 'boardLost'
});

/** Fresh attack counters of one board. */
function createAttackTotals() {
  return { turns: 0, dropped: 0, links: 0, raw: 0, sent: 0, clears: 0 };
}

/** Fresh counters of the turn in progress. */
function createOpenTurn() {
  return { isOpen: false, dropped: 0, links: 0, isSpecial: false, colorId: null };
}

/** Fresh counters of what a board did and suffered. */
function createStats() {
  return { neutralised: 0, weakened: 0, deflected: 0, landed: 0, pulsesSent: 0, pulsesReceived: 0, specialsGranted: 0 };
}

/** Methods of GameEngine that belong to a board of a Polarity Duel, installed on its prototype. */
export const engineVersusMethods = {
  /**
   * Starts a Classic-style board of a duel from explicit seeded streams: the stage board
   * from `${seedKey}:board:${stage}`, the launcher and physics draws from
   * `${seedKey}:launcher`, the charge positions and colours from `${seedKey}:charge:${b}`.
   * No ambient random source is read by the gameplay of the board.
   * @param {{seedKey: string, stage?: number, boardIndex?: number}} options
   */
  startVersusBoard({ seedKey, stage = FIRST_STAGE, boardIndex = FIRST_BOARD }) {
    const versusState = {
      seedKey: String(seedKey),
      boardIndex,
      // Charged spheres rising toward this board: {id, polarity, strength, x, y, progress, threatening}.
      charges: [],
      // Ids of the charges close to landing (the renderer reads them).
      threatIds: [],
      // Attacks received and waiting for the next step boundary.
      incoming: [],
      // What this board sends to the other one ({type:'charges'|'pulse'}), drained by the controller.
      outbox: [],
      // Reports for the controller, drained by it.
      events: [],
      chargeRng: new SeededRandom(`${seedKey}:charge:${boardIndex}`),
      chargeSeq: 0,
      guard: null,
      stats: createStats(),
      turn: createOpenTurn(),
      turnIdleFrames: 0,
      lastMatchColorId: null,
      totals: createAttackTotals(),
      lastAttack: null,
      // The aim preview of this board stops at the first charge crossed (set for a human board).
      isAimTruncated: false
    };
    this.aimPreview = { chargeHit: null };
    // A board rebuilt for a new round starts from nothing left over from the previous one.
    this.upcomingColorIds = [];
    this.railLowerFrames = 0;
    this.launchClassicBoard(stage, new SeededRandom(`${seedKey}:launcher`), versusState);
  },

  /**
   * Scales the rise time of the charges that arrive on this board (a handicap: above 1 the
   * charges take longer to land). Survives the rounds; a value that is not a positive finite
   * number restores the default.
   * @param {number} multiplier - Factor applied to gameConfig.versus.riseFrames.
   */
  setVersusRiseMultiplier(multiplier) {
    const isValid = Number.isFinite(multiplier) && multiplier > 0;
    this.versusRiseMultiplier = isValid ? multiplier : DEFAULT_RISE_MULTIPLIER;
  },

  /** Makes the aim preview of this board stop at the first charge it crosses. */
  setVersusAimTruncation(isTruncated) {
    if (this.versus) {
      this.versus.isAimTruncated = Boolean(isTruncated);
      this.updateAimFromAngle(this.aimAngle);
    }
  },

  /** Opens the attack of a shot: a special ball multiplies what its avalanche sends. */
  beginVersusTurn(projectile) {
    if (!this.versus) {
      return;
    }
    this.closeVersusTurn();
    this.versus.turnIdleFrames = 0;
    this.versus.turn = {
      ...createOpenTurn(),
      isOpen: true,
      isSpecial: Boolean(projectile?.specialType),
      colorId: projectile?.colorId ?? null
    };
  },

  /** Counts spheres dropped by an avalanche of the open turn. */
  noteVersusDrop(count, colorId = null) {
    const turn = this.versus?.turn;
    if (turn?.isOpen) {
      turn.dropped += count;
      if (turn.colorId === null && colorId !== null) {
        turn.colorId = colorId;
      }
    }
  },

  /** Counts one automatic chain reaction of the open turn. */
  noteVersusLink() {
    if (this.versus?.turn.isOpen) {
      this.versus.turn.links += 1;
    }
  },

  /** A cleared board sends a fixed number of charges. */
  noteVersusBoardClear() {
    if (!this.versus) {
      return;
    }
    const sent = this.gameConfig.versus.attack.boardClearCharges;
    this.versus.totals.clears += 1;
    this.versus.totals.sent += sent;
    this.versus.lastAttack = { raw: 0, sent, isStrong: false, isBoardClear: true };
    this.queueVersusAttack(sent, false, this.versus.turn.colorId ?? this.versus.lastMatchColorId);
  },

  /**
   * Resolves the open turn into an attack and adds it to the totals. Called when the board
   * has settled after a shot (see settleVersusTurn), when the next shot starts and at the
   * end of the round.
   * @returns {{raw:number, sent:number, isStrong:boolean}|null} The attack, null without an open turn.
   */
  closeVersusTurn() {
    const versus = this.versus;
    if (!versus?.turn.isOpen) {
      return null;
    }
    const attack = computeVersusAttack(versus.turn, this.gameConfig.versus.attack);
    versus.totals.turns += 1;
    versus.totals.dropped += versus.turn.dropped;
    versus.totals.links += versus.turn.links;
    versus.totals.raw += attack.raw;
    versus.totals.sent += attack.sent;
    versus.lastAttack = attack;
    if (versus.turn.colorId !== null) {
      versus.lastMatchColorId = versus.turn.colorId;
    }
    if (attack.sent > 0) {
      this.queueVersusAttack(attack.sent, attack.isStrong, versus.turn.colorId);
    }
    versus.turn = createOpenTurn();
    return attack;
  },

  /**
   * Attack totals of this board, settling the turn in progress first.
   * @returns {{turns:number, dropped:number, links:number, raw:number, sent:number, clears:number}|null}
   */
  getVersusAttack() {
    if (!this.versus) {
      return null;
    }
    this.closeVersusTurn();
    return { ...this.versus.totals };
  },

  /**
   * Puts an attack in the outbox. A strong attack sends floor(sent / 2) charges of strength 2
   * (two hits to neutralise, two spheres when it lands) plus sent % 2 charge of strength 1,
   * so the spheres that land add up to exactly the charges the attack table promises.
   */
  queueVersusAttack(sent, isStrong, colorId) {
    const polarity = chargePolarityForColor(colorId, this.gameConfig.versus, this.physicsWorld.polarityMap);
    const groups = isStrong
      ? [
        { count: Math.floor(sent / STRONG_STRENGTH), strength: STRONG_STRENGTH },
        { count: sent % STRONG_STRENGTH, strength: NORMAL_STRENGTH }
      ]
      : [{ count: sent, strength: NORMAL_STRENGTH }];
    for (const group of groups) {
      if (group.count > 0) {
        this.versus.outbox.push({ type: 'charges', count: group.count, strength: group.strength, polarity });
        this.pushVersusEvent(VERSUS_ENGINE_EVENTS.ATTACK_SENT, { count: group.count, strength: group.strength, polarity });
      }
    }
  },

  /** Records a report for the match controller. */
  pushVersusEvent(type, data = {}) {
    this.versus.events.push({ type, board: this.versus.boardIndex, ...data });
  },

  /** Hands the outbox and the reports to the controller and empties them. */
  drainVersusOutput() {
    const versus = this.versus;
    const output = { outbox: versus.outbox, events: versus.events };
    versus.outbox = [];
    versus.events = [];
    return output;
  },

  /**
   * Receives an attack of the other board: it is delivered at the next step boundary.
   * @param {{count:number, strength:number, polarity:number}} attack
   */
  receiveVersusAttack(attack) {
    if (this.versus && this.state === GAME_STATES.PLAYING) {
      this.versus.incoming.push({ count: attack.count, strength: attack.strength, polarity: attack.polarity });
    }
  },

  /** Overcharge needed for a full meter: doubled in a duel, where a full meter fires the pulse. */
  getOverchargeCap() {
    const max = this.gameConfig.scoring.overchargeMax;
    return this.versus ? max * this.gameConfig.versus.overchargeMaxMultiplier : max;
  },

  /** A full meter fires the field pulse at the other board. */
  fireVersusPulse() {
    this.versus.outbox.push({ type: 'pulse' });
    this.versus.stats.pulsesSent += 1;
    this.pushVersusEvent(VERSUS_ENGINE_EVENTS.PULSE_SENT, {});
  },

  /**
   * The field pulse of the other board (or sudden death) lowers this board's anchor rail,
   * with the creak and the ease of a Sag step. It can push the board past its danger line.
   * @param {string} [source='pulse'] - 'pulse' or 'suddenDeath'.
   */
  receiveFieldPulse(source = 'pulse') {
    if (!this.versus || this.state !== GAME_STATES.PLAYING) {
      return;
    }
    this.versus.stats.pulsesReceived += 1;
    this.lowerAnchorRail();
    this.pushVersusEvent(VERSUS_ENGINE_EVENTS.PULSE_RECEIVED, { source });
    if (!this.isRunPlaying()) {
      this.railLowerFrames = 0;
      return;
    }
    this.railLowerFrames = this.gameConfig.sag?.lowerFrames ?? 0;
    this.audioManager.playEffect?.('creak');
    const shake = this.gameConfig.sag?.lowerShake;
    if (shake) {
      this.particleSystem.addScreenShake(shake, this.gameConfig.juice.maxShakeOffset);
    }
    this.notifyUI();
  },

  /** Reports the loss of this board; the controller reads it after the step. */
  noteVersusBoardLost(reasonKey) {
    if (this.versus) {
      this.pushVersusEvent(VERSUS_ENGINE_EVENTS.BOARD_LOST, { reasonKey });
    }
  },

  /** Lowest edge of the cluster: where the charges land. */
  getClusterUndersideY() {
    let lowest = this.gameConfig.classic.startY;
    for (const ball of this.physicsWorld.balls) {
      if (!ball.isDropping) {
        lowest = Math.max(lowest, ball.y + ball.radius);
      }
    }
    return lowest;
  },

  /** Radius of a charge in logical pixels (the config gives a multiple of the ball radius). */
  getChargeRadius() {
    return this.gameConfig.versus.chargeRadius * this.physicsConfig.ball.radius;
  },

  /** Turns the queued attacks into rising charges at the defender's danger line. */
  deliverVersusCharges() {
    const versus = this.versus;
    if (versus.incoming.length === 0) {
      return;
    }
    const cfg = this.gameConfig.versus;
    const canvasCfg = this.gameConfig.canvas;
    const margin = canvasCfg.wallMargin + this.physicsConfig.ball.radius;
    const spanX = canvasCfg.logicalWidth - 2 * margin;
    const startY = canvasCfg.dangerLineY;
    const targetY = this.getClusterUndersideY();
    const batch = versus.incoming;
    versus.incoming = [];
    for (const attack of batch) {
      for (let i = 0; i < attack.count; i++) {
        const charge = createCharge({
          polarity: attack.polarity,
          strength: attack.strength,
          x: margin + versus.chargeRng.next() * spanX,
          startY,
          targetY,
          riseFrames: Math.round(cfg.riseFrames * (this.versusRiseMultiplier ?? DEFAULT_RISE_MULTIPLIER)),
          id: versus.chargeSeq++
        });
        // Charges of one attack leave the line one after the other.
        charge.age = -i * cfg.chargeStaggerFrames;
        charge.progress = NO_PROGRESS;
        charge.threatening = false;
        versus.charges.push(charge);
      }
      this.pushVersusEvent(VERSUS_ENGINE_EVENTS.CHARGE_INCOMING, {
        count: attack.count,
        strength: attack.strength,
        polarity: attack.polarity
      });
    }
    this.syncVersusChargeView();
  },

  /** Moves every charge up one frame and lands the ones that reached the cluster. */
  advanceVersusCharges() {
    const versus = this.versus;
    if (versus.charges.length === 0) {
      return;
    }
    const targetY = this.getClusterUndersideY();
    const landed = [];
    for (const charge of versus.charges) {
      charge.age = (charge.age ?? 0) + 1;
      charge.targetY = targetY;
      const advance = advanceCharge(charge, Math.max(0, charge.age));
      // A charge never sinks back when the cluster moves down under it.
      charge.y = Math.min(charge.y, advance.y);
      if (advance.landed || charge.y <= targetY) {
        landed.push(charge);
      }
    }
    if (landed.length > 0) {
      versus.charges = versus.charges.filter((charge) => !landed.includes(charge));
      for (const charge of landed) {
        this.landVersusCharge(charge);
      }
    }
    this.syncVersusChargeView();
  },

  /** Refreshes the fields the renderer reads: progress and threatening charges. */
  syncVersusChargeView() {
    const versus = this.versus;
    const cfg = this.gameConfig.versus;
    versus.threatIds = [];
    for (const charge of versus.charges) {
      const span = charge.startY - charge.targetY;
      charge.progress = span > 0
        ? Math.min(FULL_PROGRESS, Math.max(NO_PROGRESS, (charge.startY - charge.y) / span))
        : FULL_PROGRESS;
      charge.threatening = isChargeThreatening(charge, cfg);
      if (charge.threatening) {
        versus.threatIds.push(charge.id);
      }
    }
  },

  /** Colour a landing charge takes: a palette colour of its polarity, not its neighbour's. */
  pickChargeColor(polarity, avoidColorId) {
    const cfg = this.gameConfig.versus;
    const palette = this.activePalette;
    const ofPolarity = palette.filter((id) => chargePolarityForColor(id, cfg, this.physicsWorld.polarityMap) === polarity);
    const pool = [ofPolarity.filter((id) => id !== avoidColorId), ofPolarity, palette].find((list) => list.length > 0);
    return pool[Math.floor(this.versus.chargeRng.next() * pool.length)];
  },

  /** A charge reaches the cluster: it snaps in as one sphere, or two for a strong one. No Sag. */
  landVersusCharge(charge) {
    this.versus.stats.landed += 1;
    const placed = this.snapChargeIntoCluster(charge);
    this.pushVersusEvent(VERSUS_ENGINE_EVENTS.CHARGE_LANDED, { id: charge.id, polarity: charge.polarity, balls: placed.length });
  },

  /**
   * Snaps a charge into the nearest settled sphere of the cluster, as one sphere or two for a
   * strong charge. Shared by every mode that lands charges; it records no mode statistics.
   * @param {object} charge - The landing charge ({x, y, polarity, strong}).
   * @returns {Array<Ball>} The spheres it added, empty when the cluster has no settled sphere.
   */
  snapChargeIntoCluster(charge) {
    const world = this.physicsWorld;
    const sim = this.physicsConfig.simulation;
    const radius = this.physicsConfig.ball.radius;
    const restDist = radius * sim.bondRestDistanceFactor;
    const bondRange = radius * sim.bondCreationDistanceFactor;
    const canvasCfg = this.gameConfig.canvas;
    let target = null;
    let bestSq = Infinity;
    for (const ball of world.balls) {
      const distSq = (ball.x - charge.x) ** 2 + (ball.y - charge.y) ** 2;
      if (!ball.isDropping && distSq < bestSq) {
        bestSq = distSq;
        target = ball;
      }
    }
    const placed = [];
    if (!target) {
      return placed;
    }
    const spot = world.computeSnapPosition(charge.x, charge.y, 0, STRAIGHT_UP_VY, target.x, target.y, restDist);
    const minX = canvasCfg.wallMargin + radius;
    const maxX = canvasCfg.logicalWidth - canvasCfg.wallMargin - radius;
    const count = landingBalls(charge);
    for (let i = 0; i < count; i++) {
      const at = i === 0
        ? { x: Math.min(maxX, Math.max(minX, spot.x)), y: spot.y }
        : this.findFreeSecondSpot(placed[0], restDist, minX, maxX);
      // Built directly: the colour of a charge is its polarity, not the match-avoiding pick of a spawn.
      const ball = new Ball({
        x: at.x,
        y: at.y,
        radius,
        colorId: this.pickChargeColor(charge.polarity, target.colorId),
        clusterModifier: null,
        isAnchor: false,
        armorHits: this.getInitialArmor(null)
      });
      world.addBall(ball);
      for (const other of world.balls) {
        if (other.id !== ball.id && Math.hypot(other.x - ball.x, other.y - ball.y) <= bondRange) {
          world.createBond(ball, other, false);
        }
      }
      placed.push(ball);
    }
    this.audioManager.playEffect('snap');
    return placed;
  },

  /**
   * Position for the second sphere of a strong charge: beside the first one, on the side with
   * room, at a few small vertical offsets, where it overlaps no cluster sphere. Falls back to
   * stacking it below the first one.
   * @param {object} first - The sphere already placed.
   * @param {number} restDist - Distance between two bonded spheres at rest.
   * @param {number} minX - Left limit of a sphere centre.
   * @param {number} maxX - Right limit of a sphere centre.
   * @returns {{x:number, y:number}} The centre to use.
   */
  findFreeSecondSpot(first, restDist, minX, maxX) {
    const minDist = first.radius * 2 * OVERLAP_TOLERANCE;
    const isFree = (x, y) => this.physicsWorld.balls.every(
      (ball) => ball.isDropping || Math.hypot(ball.x - x, ball.y - y) >= minDist
    );
    const preferred = first.x + restDist > maxX ? -1 : 1;
    for (const dy of SECOND_SPHERE_Y_OFFSETS) {
      for (const side of [preferred, -preferred]) {
        const x = first.x + side * restDist;
        const y = first.y + dy * restDist;
        if (x >= minX && x <= maxX && isFree(x, y)) {
          return { x, y };
        }
      }
    }
    return { x: first.x, y: first.y + restDist };
  },

  /**
   * Checks the flying shot against the charges after a physics step: the segment it
   * travelled is tested against each charge circle and the first one it crosses wins.
   * @param {object|null} projectile - The shot that was in flight before the step.
   */
  collideProjectileWithCharges(projectile) {
    const versus = this.versus;
    if (!projectile || this.physicsWorld.projectile !== projectile || projectile.specialType || versus.charges.length === 0) {
      return;
    }
    const hitRadius = this.getChargeRadius() + projectile.radius;
    if (!projectile.versusHitIds) {
      projectile.versusHitIds = new Set();
    }
    const hitIds = projectile.versusHitIds;
    let best = null;
    for (const charge of versus.charges) {
      if (hitIds.has(charge.id)) {
        continue;
      }
      const t = segmentCircleHitT(projectile.prevX, projectile.prevY, projectile.x, projectile.y, charge.x, charge.y, hitRadius);
      if (t !== null && (best === null || t < best.t)) {
        best = { t, charge };
      }
    }
    if (!best) {
      return;
    }
    const cfg = this.gameConfig.versus;
    const result = resolveChargeHit(best.charge, { polarity: shotPolarity(projectile.colorId, projectile.isPolarityFlipped, cfg, this.physicsWorld.polarityMap) });
    hitIds.add(best.charge.id);
    const info = { id: best.charge.id, polarity: best.charge.polarity, x: best.charge.x, y: best.charge.y };
    if (result.outcome === CHARGE_OUTCOMES.DEFLECTED) {
      projectile.x = projectile.prevX + (projectile.x - projectile.prevX) * best.t;
      projectile.y = projectile.prevY + (projectile.y - projectile.prevY) * best.t;
      projectile.vx = -projectile.vx;
      versus.stats.deflected += 1;
      this.audioManager.playEffect('bounce');
      this.pushVersusEvent(VERSUS_ENGINE_EVENTS.CHARGE_DEFLECTED, info);
      return;
    }
    if (result.outcome === CHARGE_OUTCOMES.NEUTRALISED) {
      versus.charges.splice(versus.charges.indexOf(best.charge), 1);
      this.registerNeutralised(info);
    } else {
      best.charge.strength = result.charge.strength;
      versus.stats.weakened += 1;
      this.pushVersusEvent(VERSUS_ENGINE_EVENTS.CHARGE_WEAKENED, { ...info, strength: result.charge.strength });
    }
    this.audioManager.playEffect('match');
    if (result.projectileConsumed) {
      this.physicsWorld.projectile = null;
      projectile.isProjectile = false;
      // A shot that took a charge down is not a whiff: it does not fill the Sag meter.
      this.handlePostTurnCleanup(true);
    }
    this.syncVersusChargeView();
  },

  /** Counts a shattered charge: Overcharge gain, guard streak and its seeded special. */
  registerNeutralised(info) {
    const versus = this.versus;
    const cfg = this.gameConfig.versus;
    versus.stats.neutralised += 1;
    this.particleSystem.spawnBurst(
      info.x,
      info.y,
      this.gameConfig.theme.defaultTrailColor,
      this.gameConfig.juice.matchBurstCount,
      this.gameConfig.juice.matchBurstSpeed
    );
    this.pushVersusEvent(VERSUS_ENGINE_EVENTS.CHARGE_NEUTRALISED, info);
    const streak = guardStreak(versus.guard, 1, cfg);
    versus.guard = streak.state;
    for (let i = 0; i < streak.grantCount; i++) {
      this.grantRandomSpecialBall();
      versus.stats.specialsGranted += 1;
      this.pushVersusEvent(VERSUS_ENGINE_EVENTS.GUARD_SPECIAL, {});
    }
    this.addOvercharge(cfg.neutraliseOverchargeGain * this.getOverchargeCap());
  },

  /**
   * A bomb blast or a lightning band neutralises every charge it reaches, whatever its
   * strength. The bomb uses its blast circle, the lightning its horizontal band.
   * @param {string} specialType - The special ball that went off.
   * @param {number} x - Where it went off.
   * @param {number} y - Where it went off.
   */
  neutraliseChargesBySpecial(specialType, x, y) {
    const versus = this.versus;
    if (!versus || versus.charges.length === 0) {
      return;
    }
    const specs = this.ballsConfig.specialTypes[specialType];
    const radius = this.physicsConfig.ball.radius;
    let hit = [];
    if (specialType === SPECIAL_TYPES.BOMB) {
      hit = chargesInBlastRadius(versus.charges, x, y, radius * specs.blastRadiusFactor * this.getBlastRadiusMultiplier());
    } else if (specialType === SPECIAL_TYPES.LIGHTNING) {
      const bandHalf = radius * specs.bandHalfHeightFactor * this.getBlastRadiusMultiplier();
      hit = versus.charges.filter((charge) => Math.abs(charge.y - y) <= bandHalf);
    }
    if (hit.length === 0) {
      return;
    }
    versus.charges = versus.charges.filter((charge) => !hit.includes(charge));
    for (const charge of hit) {
      this.registerNeutralised({ id: charge.id, polarity: charge.polarity, x: charge.x, y: charge.y });
    }
    this.syncVersusChargeView();
  },

  /** Closes the open turn once the board has been quiet long enough for its chain reactions to end. */
  settleVersusTurn() {
    const versus = this.versus;
    if (!versus.turn.isOpen) {
      return;
    }
    const world = this.physicsWorld;
    const isQuiet = !world.projectile && world.droppingBalls.length === 0 && world.pendingChainCandidateIds.size === 0;
    versus.turnIdleFrames = isQuiet ? versus.turnIdleFrames + 1 : 0;
    if (versus.turnIdleFrames >= this.gameConfig.versus.turnSettleFrames) {
      this.closeVersusTurn();
    }
  },

  /** Versus work before the physics step: deliver the queued charges and move them. */
  stepVersusBefore() {
    this.deliverVersusCharges();
    this.advanceVersusCharges();
  },

  /** Versus work after the physics step. */
  stepVersusAfter(projectile) {
    this.collideProjectileWithCharges(projectile);
    this.settleVersusTurn();
  },

  /**
   * Polarity (+1 or -1) a ball would have as a shot: its colour polarity, inverted by the flip.
   * @param {object|null} [ball] - Ball to read, default the loaded one.
   * @param {boolean} [flipped] - Whether the flip is armed, default the engine's flip.
   * @returns {number|null} The polarity; null for a special ball (it is not polarised) or no ball.
   */
  getVersusShotPolarity(ball = this.currentBall, flipped = this.isPolarityFlipped) {
    if (!this.versus || !ball || ball.specialType) {
      return null;
    }
    return shotPolarity(ball.colorId, flipped, this.gameConfig.versus, this.physicsWorld.polarityMap);
  },

  /** Recomputes the aim preview marker and, for a human board, cuts the aim path at the first charge. */
  applyVersusAimPreview() {
    const versus = this.versus;
    const hitRadius = this.getChargeRadius() + this.physicsConfig.ball.radius;
    const cut = truncateAimAtCharges(this.aimPoints, versus.charges, hitRadius);
    const shot = cut.hit ? this.getVersusShotPolarity() : null;
    this.aimPreview = {
      chargeHit: cut.hit
        ? {
            x: cut.hit.x,
            y: cut.hit.y,
            polarity: cut.hit.charge.polarity,
            // What the loaded shot would do to this charge: shatter it, weaken it or bounce off.
            outcome: shot === null ? null : resolveChargeHit(cut.hit.charge, { polarity: shot }).outcome
          }
        : null
    };
    if (versus.isAimTruncated && cut.hit) {
      this.aimPoints = cut.points;
    }
  }
};
