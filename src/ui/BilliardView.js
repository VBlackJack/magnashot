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

import { GAMEPAD_ACTIONS as A } from '../core/GamepadInput.js';
import { t, formatNumber } from '../core/I18n.js';
import { BilliardGame } from '../game/Billiard.js';
import { isBrowserShortcut, setTextIfChanged } from './UIHelpers.js';

const TURN = Math.PI * 2;
const MS_PER_SECOND = 1000;
const FULL_PERCENT = 100;
const PRIMARY_BUTTON = 0;
const GUIDE_DASH = Object.freeze([6, 5]);
const KEY = 'modals.billiard';

function circle(context, { x, y }, radius, color) {
  context.beginPath();
  context.arc(x, y, radius, 0, TURN);
  context.fillStyle = color;
  context.fill();
}

export class BilliardView {
  constructor(ui, config) {
    this.ui = ui;
    this.config = config;
    this.controls = ui.gameConfig.billiardControls;
    this.modal = ui.elements.modalBilliard;
    this.canvas = document.getElementById('billiard-canvas');
    this.context = this.canvas.getContext('2d');
    this.canvas.width = config.width;
    this.canvas.height = config.height;
    this.status = document.getElementById('billiard-status');
    this.objective = document.getElementById('billiard-objective');
    this.shots = document.getElementById('billiard-shots');
    this.power = document.getElementById('billiard-power');
    this.powerValue = document.getElementById('billiard-power-value');
    this.shootButton = document.getElementById('btn-billiard-shoot');
    this.replay = document.getElementById('btn-billiard-replay');
    this.closeButton = document.getElementById('btn-billiard-close');
    this.tableButtons = [...document.querySelectorAll('#billiard-tables button')];
    this.power.step = String(this.controls.powerStep);
    this.pointerId = null;

    ui.elements.btnModeBilliard.addEventListener('click', () => this.open());
    this.closeButton.addEventListener('click', () => this.close());
    this.replay.addEventListener('click', () => this.selectTable(this.game.tableIndex));
    this.shootButton.addEventListener('click', () => this.shoot());
    this.power.addEventListener('input', () => this.setPower(this.power.valueAsNumber));
    this.tableButtons.forEach((button, index) => button.addEventListener('click', () => this.selectTable(index)));
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== PRIMARY_BUTTON || this.pointerId !== null || !this.isActive()) {
        return;
      }
      this.pointerId = event.pointerId;
      this.canvas.focus({ preventScroll: true });
      this.canvas.setPointerCapture(event.pointerId);
      this.aimPointer(event);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (this.pointerId === event.pointerId) {
        this.aimPointer(event);
      }
    });
    this.canvas.addEventListener('lostpointercapture', () => { this.pointerId = null; });
  }

  isActive() {
    return this.ui.getActiveTopModal() === this.modal;
  }

  hasAimFocus() {
    return this.isActive() && document.activeElement === this.canvas;
  }

  open() {
    this.game ??= new BilliardGame(this.config);
    this.ui.openOverlayModal(this.modal, this.canvas);
    this.refresh();
  }

  close() {
    this.pointerId = null;
    this.ui.stackedModalOpener = this.ui.elements.btnModeBilliard;
    this.ui.closeOverlayModal(this.modal);
  }

  selectTable(index) {
    this.game.reset(index);
    this.canvas.focus({ preventScroll: true });
    this.refresh();
  }

  aimPointer(event) {
    const game = this.game;
    if (!this.isActive() || game.state !== 'aiming' || !game.cue) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * this.config.width / rect.width;
    const y = (event.clientY - rect.top) * this.config.height / rect.height;
    if (x !== game.cue.x || y !== game.cue.y) {
      game.setAngle(Math.atan2(y - game.cue.y, x - game.cue.x));
      this.render();
    }
  }

  setPower(power) {
    this.game.setPower(power);
    this.refresh();
  }

  shoot() {
    if (this.game.shoot()) {
      this.ui.audioManager.playEffect('shoot');
      this.canvas.focus({ preventScroll: true });
      this.refresh();
    }
  }

  handleKey(event) {
    if (!this.hasAimFocus() || isBrowserShortcut(event)) {
      return;
    }
    const delta = (event.shiftKey ? this.controls.aimFineDegrees : this.controls.aimDegrees) * TURN / this.controls.degreesPerTurn;
    switch (event.code) {
      case 'ArrowLeft':
      case 'ArrowRight':
        this.game.setAngle(this.game.angle + (event.code === 'ArrowLeft' ? -delta : delta));
        this.render();
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        this.setPower(this.game.power + (event.code === 'ArrowDown' ? -1 : 1) * this.controls.powerStep);
        break;
      case 'Space':
      case 'Enter':
      case 'NumpadEnter':
        if (!event.repeat) this.shoot();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  handlePad({ actions, aimDelta, aimSteps = 0 }) {
    if (aimDelta || aimSteps) {
      this.game.setAngle(this.game.angle + aimDelta + aimSteps * this.controls.aimFineDegrees * TURN / this.controls.degreesPerTurn);
      this.render();
    }
    for (const action of actions) {
      if (!this.hasAimFocus()) break;
      switch (action) {
        case A.SHOOT:
          this.shoot();
          break;
        case A.SPECIAL_PREV:
        case A.SPECIAL_NEXT:
          this.setPower(this.game.power + (action === A.SPECIAL_PREV ? -1 : 1) * this.controls.powerStep);
          break;
        case A.SWAP:
          this.selectTable(this.game.tableIndex);
          break;
        case A.PAUSE:
        case A.MENU:
          this.tableButtons[this.game.tableIndex].focus({ preventScroll: true });
          break;
        case A.UNEQUIP:
          this.close();
          break;
        default:
          break;
      }
    }
  }

  frame(elapsedMs) {
    if (!this.isActive() || document.hidden || this.game.state !== 'moving') {
      return;
    }
    this.game.update(Math.min(elapsedMs, this.controls.maxFrameMs) / MS_PER_SECOND);
    if (this.game.state === 'moving') {
      this.render();
    } else {
      this.refresh();
    }
  }

  refresh() {
    const game = this.game;
    if (!game) return;
    const isAiming = game.state === 'aiming';
    this.power.disabled = !isAiming;
    this.shootButton.disabled = !isAiming;
    this.power.value = String(game.power);
    const powerText = t(`${KEY}.percent`, { value: formatNumber(Math.round(game.power * FULL_PERCENT)) });
    setTextIfChanged(this.powerValue, powerText);
    this.power.setAttribute('aria-valuetext', powerText);
    this.tableButtons.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(index === game.tableIndex));
    });
    setTextIfChanged(this.objective, t(`${KEY}.table.${game.table.id}.objective`));
    setTextIfChanged(this.shots, t(`${KEY}.shots`, {
      used: formatNumber(game.shotsUsed), limit: formatNumber(game.table.shotLimit)
    }));
    setTextIfChanged(this.status, t(`${KEY}.status.${game.reason || game.state}`));
    this.render();
  }

  render() {
    const ctx = this.context;
    const game = this.game;
    if (!ctx || !game) return;
    const { width, height, bounds, pockets, pocketRadius } = this.config;
    const theme = this.ui.gameConfig.billiardControls.colors;
    ctx.fillStyle = theme.rail;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = theme.cloth;
    ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    for (const pocket of pockets) {
      circle(ctx, pocket, pocketRadius, theme.pocket);
    }

    const guide = game.preview();
    if (guide.length > 1) {
      ctx.save();
      ctx.setLineDash(GUIDE_DASH);
      ctx.strokeStyle = theme.guide;
      ctx.lineWidth = this.controls.guideWidth;
      ctx.beginPath();
      ctx.moveTo(guide[0].x, guide[0].y);
      for (const point of guide.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.restore();
    }
    for (const ball of game.balls) {
      circle(ctx, ball, ball.radius, theme.balls[ball.id] ?? theme.balls.screen);
      if (game.nextTarget === ball.id) {
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius + this.controls.targetRingGap, 0, TURN);
        ctx.lineWidth = this.controls.guideWidth;
        ctx.strokeStyle = theme.guide;
        ctx.stroke();
      }
      if (ball.id !== 'cue' && ball.id !== 'screen') {
        ctx.fillStyle = theme.number;
        ctx.font = this.controls.numberFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t(`${KEY}.ball.${ball.id}`), ball.x, ball.y);
      }
    }
  }
}
