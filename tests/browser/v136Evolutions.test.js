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

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStaticServer } from './staticServer.js';

const ROOT_DIR = fileURLToPath(new URL('../..', import.meta.url));

describe('v1.36 / v1.37 browser E2E flows', () => {
  let server;
  let browser;

  before(async () => {
    server = await startStaticServer(ROOT_DIR);
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    await server?.close();
  });

  test('Play Hub Spotlight, Weekly Mastery Trio, Mutator Lab launch, and Puzzle Builder v3 library work end-to-end', async () => {
    const context = await browser.newContext({ viewport: { width: 1300, height: 850 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.waitForSelector('#hud-mode-banner');

    // Open Play Hub
    await page.click('#hud-mode-banner');
    await page.waitForSelector('#modal-play:not(.hidden)');

    // 1. Spotlight banner and Weekly Mastery Trio are visible
    const spotlightVisible = await page.isVisible('#play-hub-spotlight');
    assert.equal(spotlightVisible, true, 'Play Hub Spotlight banner should be visible');
    const weeklyItems = await page.locator('#play-weekly-mastery-list li').count();
    assert.equal(weeklyItems, 3, 'Weekly Mastery Trio should display 3 objectives');

    // 2. Mutator Lab: toggle, pick 2 mutators -> x1.5 -> launch Survival -> Lab x1.5 in HUD
    await page.click('#btn-mutator-lab-toggle');
    await page.waitForSelector('#mutator-lab-panel:not(.hidden)');
    await page.click('[data-lab-mutator="hyperGravity"]');
    await page.click('[data-lab-mutator="bumperPinball"]');
    const multText = await page.textContent('#mutator-lab-mult');
    assert.match(multText || '', /1\.5/, '2 selected mutators should show 1.5x multiplier');

    await page.click('#btn-lab-endless');
    const confirmVisible = await page.isVisible('#modal-confirm:not(.hidden)');
    if (confirmVisible) {
      await page.click('#btn-confirm-yes');
    }
    await page.waitForSelector('#modal-play', { state: 'hidden' });
    const hudBanner = await page.textContent('#hud-mode-banner');
    assert.match(hudBanner || '', /1\.5/, 'HUD mode banner should display Lab x1.5 suffix');

    // 3. Puzzle Builder v3: place sphere + free bumper -> Save to My Puzzles -> Clear -> Reload -> Play
    await page.click('#hud-mode-banner');
    await page.waitForSelector('#modal-play:not(.hidden)');
    await page.click('#btn-puzzle-builder');
    await page.waitForSelector('#modal-puzzle-builder:not(.hidden)');

    await page.click('[data-cell="1,1"]');
    await page.click('[data-builder-tool="bumper"]');
    await page.click('[data-cell="2,2"]');
    await page.click('#btn-puzzle-builder-save');

    const librarySlots = await page.locator('#puzzle-builder-library .puzzle-builder-slot').count();
    assert.equal(librarySlots, 1, 'Saving a puzzle should add 1 slot to My Puzzles library');

    await page.click('#btn-puzzle-builder-clear');
    await page.click('#puzzle-builder-library .puzzle-builder-slot-load');
    await page.click('#btn-puzzle-builder-play');
    await page.waitForSelector('#modal-puzzle-builder', { state: 'hidden' });

    const puzzleBanner = await page.textContent('#hud-mode-banner');
    assert.ok((puzzleBanner || '').length > 0, 'Custom puzzle should start cleanly from saved library slot');
    assert.deepEqual(errors, [], 'Zero uncaught page errors expected during E2E flow');

    await context.close();
  });
});
