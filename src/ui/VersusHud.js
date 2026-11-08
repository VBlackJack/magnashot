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

/*
 * Polarity Duel HUD: the layout rules (pure), the live region announcements (pure) and the
 * DOM of the shared top bar and of the two boards (round pips, timer, incoming charges, pulse
 * meter, swap and polarity buttons, stocked specials). It owns its elements and never reads
 * the clock or the engines on its own: the screen controller passes the match state in.
 */

import { t, formatNumber } from '../core/I18n.js';
import { MATCH_EVENTS } from '../game/VersusMatch.js';
import { specialIconBackground } from './CodexView.js';
import { setAttributeIfChanged, setTextIfChanged } from './UIHelpers.js';

/** Board arrangements of the versus screen. */
export const VERSUS_LAYOUTS = Object.freeze({ SPLIT: 'split', MINI: 'mini' });

/** Screen orientations the mini-view arranges itself for. */
export const VERSUS_ORIENTATIONS = Object.freeze({ PORTRAIT: 'portrait', LANDSCAPE: 'landscape' });

const SECONDS_PER_MINUTE = 60;
const TIMER_SECONDS_DIGITS = 2;
const FULL_PERCENT = 100;
const CLASS_HAS_INCOMING = 'has-incoming';
const CLASS_HAS_THREAT = 'has-threat';
const CLASS_PIP_WON = 'is-won';
const CLASS_EQUIPPED = 'equipped';
const HIDDEN_CLASS = 'hidden';
const PLAYER_SIDE = 'player';
const CPU_SIDE = 'cpu';

/**
 * Largest board that fits a box at the logical aspect ratio of the game board.
 * @param {number} boxWidth - Available width in CSS pixels.
 * @param {number} boxHeight - Available height in CSS pixels.
 * @param {{logicalWidth: number, logicalHeight: number}} canvasCfg - The `canvas` section of the game config.
 * @returns {{width: number, height: number}} Whole pixel size, zero when the box is empty.
 */
export function fitBoard(boxWidth, boxHeight, canvasCfg) {
  const ratio = canvasCfg.logicalWidth / canvasCfg.logicalHeight;
  const width = Math.max(0, Math.min(boxWidth, boxHeight * ratio));
  return { width: Math.floor(width), height: Math.floor(width / ratio) };
}

/**
 * Picks the arrangement of the two boards by measurement: split (two full boards) when each
 * board gets at least `splitMinBoardWidthPx` at the logical aspect ratio and the viewport is at
 * least `splitMinViewportHeightPx` tall; the mini-view otherwise.
 * @param {{areaWidth: number, areaHeight: number, hudHeight: number, viewportHeight: number, gap: number}} input
 *   Measured sizes in CSS pixels: the room under the top bar, the height of one board HUD (above its
 *   canvas in the split) and the gap between the boards.
 * @param {{splitMinBoardWidthPx: number, splitMinViewportHeightPx: number}} layoutCfg - versus.layout.
 * @param {{logicalWidth: number, logicalHeight: number}} canvasCfg - The `canvas` section of the game config.
 * @returns {{layout: string, boardWidth: number}} The layout and the width one board would get in the split.
 */
export function chooseVersusLayout(input, layoutCfg, canvasCfg) {
  const perBoardWidth = (input.areaWidth - input.gap) / 2;
  const { width } = fitBoard(perBoardWidth, input.areaHeight - input.hudHeight, canvasCfg);
  const isSplit = width >= layoutCfg.splitMinBoardWidthPx && input.viewportHeight >= layoutCfg.splitMinViewportHeightPx;
  return { layout: isSplit ? VERSUS_LAYOUTS.SPLIT : VERSUS_LAYOUTS.MINI, boardWidth: width };
}

/**
 * Size of the CPU board in the mini-view: `miniScale` of the logical size, shrunk to fit a
 * maximum height when the column it sits in is short.
 * @param {{logicalWidth: number, logicalHeight: number}} canvasCfg - The `canvas` section of the game config.
 * @param {{miniScale: number}} layoutCfg - versus.layout.
 * @param {number} [maxHeight] - Tallest the board may be, in CSS pixels.
 * @returns {{width: number, height: number}}
 */
export function computeMiniSize(canvasCfg, layoutCfg, maxHeight = Infinity) {
  const nominalWidth = canvasCfg.logicalWidth * layoutCfg.miniScale;
  const nominalHeight = canvasCfg.logicalHeight * layoutCfg.miniScale;
  if (nominalHeight <= maxHeight) {
    return { width: Math.round(nominalWidth), height: Math.round(nominalHeight) };
  }
  return fitBoard(nominalWidth, Math.max(0, maxHeight), canvasCfg);
}

/**
 * @param {number} seconds - Whole seconds since the round started.
 * @returns {string} "m:ss".
 */
export function formatMatchTimer(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safe / SECONDS_PER_MINUTE);
  const rest = String(safe % SECONDS_PER_MINUTE).padStart(TIMER_SECONDS_DIGITS, '0');
  return `${minutes}:${rest}`;
}

/** Message keys (under versus.announce) of the announcements. */
export const VERSUS_ANNOUNCEMENTS = Object.freeze({
  CHARGE_INCOMING: 'chargeIncoming',
  CHARGE_NEUTRALISED: 'chargeNeutralised',
  PULSE_SENT: 'pulseSent',
  PULSE_RECEIVED: 'pulseReceived',
  ROUND_WON: 'roundWon',
  ROUND_LOST: 'roundLost',
  ROUND_DRAW: 'roundDraw',
  MATCH_WON: 'matchWon',
  MATCH_LOST: 'matchLost',
  SUDDEN_DEATH: 'suddenDeath'
});

/**
 * Turns the match announcements into live region messages without flooding it: the charges
 * that arrive within one window are counted as one message, a neutralisation is announced at most
 * once per window, everything else is announced as it happens. Only what concerns the player is kept.
 * Time is the caller's own clock (frames), so the queue is deterministic.
 * @param {{windowFrames: number, suddenDeathSeconds: number, playerBoard?: number}} options
 * @returns {{push: (event: object, clock: number) => object[], drain: (clock: number) => object[]}}
 */
export function createAnnouncementQueue({ windowFrames, suddenDeathSeconds, playerBoard = 0 }) {
  let pendingIncoming = null;
  let lastNeutralisedClock = -Infinity;
  const message = (key, params = {}) => ({ key, params });

  return {
    /**
     * @param {object} event - A match announcement.
     * @param {number} clock - Current time of the caller.
     * @returns {Array<{key: string, params: object}>} Messages to speak now.
     */
    push(event, clock) {
      switch (event.type) {
        case MATCH_EVENTS.CHARGE_INCOMING:
          if (event.isPlayer) {
            if (pendingIncoming) {
              pendingIncoming.count += event.count ?? 1;
            } else {
              pendingIncoming = { count: event.count ?? 1, dueClock: clock + windowFrames };
            }
          }
          return [];
        case MATCH_EVENTS.CHARGE_NEUTRALISED:
          if (event.isPlayer && clock - lastNeutralisedClock >= windowFrames) {
            lastNeutralisedClock = clock;
            return [message(VERSUS_ANNOUNCEMENTS.CHARGE_NEUTRALISED)];
          }
          return [];
        case MATCH_EVENTS.PULSE_SENT:
          return event.isPlayer ? [message(VERSUS_ANNOUNCEMENTS.PULSE_SENT)] : [];
        case MATCH_EVENTS.PULSE_RECEIVED:
          return event.isPlayer && event.source === 'pulse' ? [message(VERSUS_ANNOUNCEMENTS.PULSE_RECEIVED)] : [];
        case MATCH_EVENTS.SUDDEN_DEATH:
          return [message(VERSUS_ANNOUNCEMENTS.SUDDEN_DEATH, { seconds: suddenDeathSeconds })];
        case MATCH_EVENTS.ROUND_WON:
          return [message(VERSUS_ANNOUNCEMENTS.ROUND_WON)];
        case MATCH_EVENTS.ROUND_LOST:
          return [message(VERSUS_ANNOUNCEMENTS.ROUND_LOST)];
        case MATCH_EVENTS.ROUND_REPLAY:
          return [message(VERSUS_ANNOUNCEMENTS.ROUND_DRAW)];
        case MATCH_EVENTS.MATCH_WON:
        case MATCH_EVENTS.MATCH_LOST: {
          const wins = event.wins ?? [0, 0];
          const params = { player: wins[playerBoard], cpu: wins[1 - playerBoard] };
          return [message(event.type === MATCH_EVENTS.MATCH_WON ? VERSUS_ANNOUNCEMENTS.MATCH_WON : VERSUS_ANNOUNCEMENTS.MATCH_LOST, params)];
        }
        default:
          return [];
      }
    },

    /**
     * @param {number} clock - Current time of the caller.
     * @returns {Array<{key: string, params: object}>} The incoming charges counted since the window opened, once it is over.
     */
    drain(clock) {
      if (pendingIncoming && clock >= pendingIncoming.dueClock) {
        const { count } = pendingIncoming;
        pendingIncoming = null;
        return [message(VERSUS_ANNOUNCEMENTS.CHARGE_INCOMING, { count })];
      }
      return [];
    }
  };
}

/**
 * Translates an announcement descriptor.
 * @param {{key: string, params: object}} entry - From createAnnouncementQueue.
 * @param {Function} [translate] - Translation function.
 * @returns {string}
 */
export function renderAnnouncement(entry, translate = t) {
  return translate(`versus.announce.${entry.key}`, entry.params);
}

/**
 * Reads the elements of the versus screen out of a document.
 * @param {Document} doc - Document holding index.html.
 * @returns {object} The handles VersusHud takes.
 */
export function collectVersusHudElements(doc) {
  const board = (index) => {
    const root = doc.getElementById(`versus-hud-${index}`);
    return {
      root,
      label: root.querySelector('.versus-hud-label'),
      incoming: root.querySelector('.versus-incoming'),
      pulse: root.querySelector('.versus-pulse'),
      pulseFill: root.querySelector('.versus-pulse-fill'),
      polarityBtn: root.querySelector('#btn-versus-polarity'),
      swapBtn: root.querySelector('#btn-versus-swap'),
      specials: root.querySelector('#versus-specials')
    };
  };
  return {
    roundPips: doc.getElementById('versus-round-pips'),
    roundLabel: doc.getElementById('versus-round-label'),
    pipsPlayer: doc.getElementById('versus-pips-player'),
    pipsCpu: doc.getElementById('versus-pips-cpu'),
    timer: doc.getElementById('versus-timer'),
    suddenDeath: doc.getElementById('versus-sudden-death'),
    boards: [board(0), board(1)]
  };
}

/** The DOM of the shared top bar and of both board HUDs. */
export class VersusHud {
  /**
   * @param {object} elements - See collectVersusHudElements.
   * @param {object} options
   * @param {Function} [options.translate] - Translation function.
   * @param {Function} [options.format] - Number formatter.
   * @param {(tag: string) => object} [options.createElement] - Element factory.
   */
  constructor(elements, { translate = t, format = formatNumber, createElement = (tag) => document.createElement(tag) } = {}) {
    this.els = elements;
    this.translate = translate;
    this.format = format;
    this.createElement = createElement;
    this.pips = { [PLAYER_SIDE]: [], [CPU_SIDE]: [] };
    this.specialButtons = [];
    this.specialsKey = '';
    this.lastState = null;
  }

  /** Builds one pip per round a side needs to win. */
  buildPips(roundsToWin) {
    for (const [side, container] of [[PLAYER_SIDE, this.els.pipsPlayer], [CPU_SIDE, this.els.pipsCpu]]) {
      const pips = [];
      for (let i = 0; i < roundsToWin; i++) {
        const pip = this.createElement('span');
        pip.className = 'versus-pip';
        pips.push(pip);
      }
      container?.replaceChildren(...pips);
      this.pips[side] = pips;
    }
  }

  /** Texts that only change with the language. */
  refreshLabels() {
    const { translate } = this;
    for (const board of [this.els.boards[0]]) {
      const labels = [
        [board.swapBtn, 'versus.hud.swap'],
        [board.polarityBtn, 'versus.hud.polarity']
      ];
      for (const [button, key] of labels) {
        setTextIfChanged(button, translate(key));
        setAttributeIfChanged(button, 'aria-label', translate(key));
      }
      setAttributeIfChanged(board.specials, 'aria-label', translate('versus.hud.specials'));
    }
    if (this.lastState) {
      this.specialsKey = '';
      this.refresh(this.lastState);
    }
  }

  /**
   * Refreshes the bar and both boards from a controller state.
   * @param {object} state - VersusMatch getState().
   * @param {{cpuTierName?: string}} [context] - Translated name of the CPU tier.
   */
  refresh(state, context = {}) {
    this.lastState = state;
    const { translate, format } = this;
    const { round } = state;
    const playerBoard = state.playerBoard ?? 0;
    const wins = { [PLAYER_SIDE]: round.wins[playerBoard], [CPU_SIDE]: round.wins[1 - playerBoard] };
    if (this.pips[PLAYER_SIDE].length !== round.roundsToWin) {
      this.buildPips(round.roundsToWin);
    }
    for (const side of [PLAYER_SIDE, CPU_SIDE]) {
      this.pips[side].forEach((pip, index) => pip.classList.toggle(CLASS_PIP_WON, index < wins[side]));
    }
    const roundNumber = Math.min(round.number, round.roundsToWin * 2 - 1);
    setTextIfChanged(this.els.roundLabel, translate('versus.bar.roundLabel', { round: format(roundNumber) }));
    setAttributeIfChanged(
      this.els.roundPips,
      'aria-label',
      translate('versus.bar.roundPips', {
        round: format(roundNumber),
        player: format(wins[PLAYER_SIDE]),
        cpu: format(wins[CPU_SIDE])
      })
    );
    const time = formatMatchTimer(state.timerSeconds);
    setTextIfChanged(this.els.timer, time);
    setAttributeIfChanged(this.els.timer, 'aria-label', translate('versus.bar.timer', { time }));
    this.els.suddenDeath?.classList.toggle(HIDDEN_CLASS, !state.isSuddenDeath);

    for (const boardState of state.boards) {
      this.refreshBoard(boardState, context);
    }
  }

  refreshBoard(boardState, { cpuTierName = '' } = {}) {
    const board = this.els.boards[boardState.index];
    const { translate, format } = this;
    const labelKey = boardState.isPlayer ? 'versus.hud.playerBoard' : cpuTierName ? 'versus.hud.cpuBoardTier' : 'versus.hud.cpuBoard';
    const label = translate(labelKey, { tier: cpuTierName });
    setTextIfChanged(board.label, label);
    setAttributeIfChanged(board.root, 'aria-label', label);
    const canvas = board.root.closest?.('.versus-board')?.querySelector?.('canvas');
    setAttributeIfChanged(canvas, 'aria-label', label);

    const count = boardState.incoming;
    setTextIfChanged(board.incoming, translate('versus.hud.incomingShort', { count: format(count) }));
    setAttributeIfChanged(board.incoming, 'aria-label', translate('versus.hud.incoming', { count: format(count) }));
    board.incoming.classList.toggle(CLASS_HAS_INCOMING, count > 0);
    board.incoming.classList.toggle(CLASS_HAS_THREAT, boardState.charges.some((charge) => charge.threatening));

    const percent = Math.round(Math.min(1, Math.max(0, boardState.pulse.ratio)) * FULL_PERCENT);
    const pulseText = translate('versus.hud.pulse', { percent: format(percent) });
    setAttributeIfChanged(board.pulse, 'aria-valuenow', String(percent));
    setAttributeIfChanged(board.pulse, 'aria-valuetext', pulseText);
    setAttributeIfChanged(board.pulse, 'aria-label', pulseText);
    const width = `${percent}%`;
    if (board.pulseFill && board.pulseFill.style.width !== width) {
      board.pulseFill.style.width = width;
    }
  }

  /**
   * Refreshes what depends on the player's engine: the polarity button and the stocked specials.
   * @param {object} engine - The player's engine.
   * @param {object} specialsContext
   * @param {string[]} specialsContext.types - Special ball types in display order.
   * @param {object} specialsContext.specs - ballsConfig.specialTypes.
   * @param {(type: string, count: number) => string} specialsContext.describe - Accessible name of a special button.
   * @param {(type: string) => void} specialsContext.onPick - Equips a special.
   * @returns {boolean} True when the specials row appeared or disappeared (the layout may need to move).
   */
  refreshPlayerControls(engine, { types, specs, describe, onPick }) {
    const board = this.els.boards[0];
    setAttributeIfChanged(board.polarityBtn, 'aria-pressed', String(Boolean(engine.isPolarityFlipped)));
    const stocked = types.filter((type) => (engine.specialInventory?.[type] || 0) > 0 || engine.currentBall?.specialType === type);
    const key = stocked.map((type) => `${type}:${engine.specialInventory?.[type] || 0}:${engine.currentBall?.specialType === type}`).join('|');
    if (key === this.specialsKey) {
      return false;
    }
    this.specialsKey = key;
    const wasShown = !board.specials.classList.contains(HIDDEN_CLASS);
    // A rebuilt button must not take the keyboard focus with it.
    const focusedType = typeof document !== 'undefined' ? document.activeElement?.dataset?.specialType : undefined;
    const buttons = stocked.map((type) => {
      const count = engine.specialInventory?.[type] || 0;
      const button = this.createElement('button');
      button.type = 'button';
      button.className = 'versus-special-btn';
      button.dataset.specialType = type;
      const icon = this.createElement('span');
      icon.className = 'powerup-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.style.background = specialIconBackground(specs[type]);
      icon.textContent = specs[type].icon;
      const amount = this.createElement('span');
      amount.textContent = this.format(count);
      const isEquipped = engine.currentBall?.specialType === type;
      button.classList.toggle(CLASS_EQUIPPED, isEquipped);
      button.setAttribute('aria-pressed', String(isEquipped));
      button.setAttribute('aria-label', describe(type, count));
      button.append(icon, amount);
      button.addEventListener('click', () => onPick(type));
      return button;
    });
    board.specials.replaceChildren(...buttons);
    this.specialButtons = buttons;
    const isShown = buttons.length > 0;
    board.specials.classList.toggle(HIDDEN_CLASS, !isShown);
    if (focusedType) {
      buttons.find((button) => button.dataset.specialType === focusedType)?.focus?.();
    }
    return isShown !== wasShown;
  }
}
