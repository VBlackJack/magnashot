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

const FIRST_STAGE = 1;
const FIRST_BOARD = 0;

/** Fresh attack counters of one board. */
function createAttackTotals() {
  return { turns: 0, dropped: 0, links: 0, raw: 0, sent: 0, clears: 0 };
}

/** Fresh counters of the turn in progress. */
function createOpenTurn() {
  return { isOpen: false, dropped: 0, links: 0, isSpecial: false };
}

/**
 * Pure attack of one resolved turn.
 * @param {{dropped:number, links:number, isSpecial:boolean}} turn - What the turn did.
 * @param {object} attackConfig - gameConfig.versus.attack.
 * @returns {{raw:number, sent:number, isStrong:boolean}} Raw attack, charges sent, strong flag.
 */
export function computeVersusAttack(turn, attackConfig) {
  if (turn.dropped <= 0) {
    // A match that drops nothing sends nothing, whatever the chain did.
    return { raw: 0, sent: 0, isStrong: false };
  }
  const base =
    Math.max(0, turn.dropped - attackConfig.freeDroppedSpheres) * attackConfig.dropWeight
    + turn.links * attackConfig.linkWeight;
  const raw = turn.isSpecial ? base * attackConfig.specialMultiplier : base;
  const sent = Math.min(attackConfig.maxChargesPerTurn, Math.floor(raw / attackConfig.rawPerCharge));
  return { raw, sent, isStrong: raw >= attackConfig.strongChargeRaw };
}

/** Methods of GameEngine that belong to a board of a Polarity Duel, installed on its prototype. */
export const engineVersusMethods = {
  /**
   * Starts a Classic-style board of a duel from explicit seeded streams: the stage board
   * from `${seedKey}:board:${stage}`, the launcher and physics draws from
   * `${seedKey}:launcher`. No ambient random source is read by the gameplay of the board.
   * @param {{seedKey: string, stage?: number, boardIndex?: number}} options
   */
  startVersusBoard({ seedKey, stage = FIRST_STAGE, boardIndex = FIRST_BOARD }) {
    const versusState = {
      seedKey: String(seedKey),
      boardIndex,
      // Charged spheres on their way to this board (physics land in a later step).
      charges: [],
      chargeRng: new SeededRandom(`${seedKey}:charge:${boardIndex}`),
      turn: createOpenTurn(),
      totals: createAttackTotals(),
      lastAttack: null
    };
    this.launchClassicBoard(stage, new SeededRandom(`${seedKey}:launcher`), versusState);
  },

  /** Opens the attack of a shot: a special ball multiplies what its avalanche sends. */
  beginVersusTurn(projectile) {
    if (!this.versus) {
      return;
    }
    this.closeVersusTurn();
    this.versus.turn = { ...createOpenTurn(), isOpen: true, isSpecial: Boolean(projectile?.specialType) };
  },

  /** Counts spheres dropped by an avalanche of the open turn. */
  noteVersusDrop(count) {
    if (this.versus?.turn.isOpen) {
      this.versus.turn.dropped += count;
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
  },

  /**
   * Resolves the open turn into an attack and adds it to the totals. Called when the next
   * shot starts (its chain reactions are done by then) and at the end of the round.
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
  }
};
