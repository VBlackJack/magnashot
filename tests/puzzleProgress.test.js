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
import { GameEngine } from '../src/game/GameEngine.js';
import { attemptStars, computePuzzleStars, getPuzzleNextStarHint } from '../src/game/EngineRoundFlow.js';
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

const { scoring, puzzleStars, puzzles } = gameConfig;
const COIN_PER_NEW_STAR = scoring.coinsPerVictoryStar + scoring.firstTimeStarCoinBonus;
const GATED_STAGE = 3;
const PLAIN_STAGE = 1;
const OTHER_STAGE = 2;
const ABOVE = 1;
const BELOW = -1;
const FIRST_SCORE = 300;
const REPLAY_SCORE = 900;
const LOW_BEST = 500;
const HIGH_BEST = 700;
const OTHER_SCORE = 100;
const HUGE_SCORE = 999999;

const createTestStorage = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  return storageManager;
};

const createTestEngine = (storageManager = createTestStorage()) => new GameEngine({
  gameConfig,
  physicsConfig,
  ballsConfig,
  obstaclesConfig,
  levelsConfig,
  campaignConfig,
  campaignTuning,
  fluxConfig,
  audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
  storageManager,
  onStateChange: () => {}
});

const topThreshold = (stage) => puzzles[stage - 1].starThresholds.at(-1);

const winStage = (engine, score) => {
  engine.shotsRemaining = 0;
  engine.score = score;
  engine.physicsWorld.clear();
  engine.evaluateRoundEnd();
};

const attemptsOf = (storage, stage) => storage.getPuzzleStageStats()[stage]?.attempts ?? 0;

const scoreStarsOf = (thresholds, score) => {
  let stars = scoring.minVictoryStars;
  thresholds.forEach((th, i) => {
    if (score >= th) {
      stars = i + 1;
    }
  });
  return stars;
};

test('attemptStars follows the configured attempt caps', () => {
  assert.equal(attemptStars(puzzleStars.threeStarMaxAttempts, puzzleStars, scoring), scoring.maxStars);
  assert.equal(attemptStars(puzzleStars.threeStarMaxAttempts + 1, puzzleStars, scoring), scoring.maxStars - 1);
  assert.equal(attemptStars(puzzleStars.twoStarMaxAttempts, puzzleStars, scoring), scoring.maxStars - 1);
  assert.equal(attemptStars(puzzleStars.twoStarMaxAttempts + 1, puzzleStars, scoring), scoring.minVictoryStars);
});

test('computePuzzleStars truth table: attempts 1/2/3/4 x score below/above the top threshold', () => {
  const thresholds = puzzles[GATED_STAGE - 1].starThresholds;
  const top = topThreshold(GATED_STAGE);
  const attemptCases = [
    puzzleStars.threeStarMaxAttempts,
    puzzleStars.threeStarMaxAttempts + 1,
    puzzleStars.twoStarMaxAttempts,
    puzzleStars.twoStarMaxAttempts + 1
  ];
  for (const attempts of attemptCases) {
    for (const side of [BELOW, ABOVE]) {
      const score = top + side;
      const scoreStars = scoreStarsOf(thresholds, score);
      assert.equal(
        computePuzzleStars({ attempts, scoreStars, puzzleStars, scoring }),
        Math.min(attemptStars(attempts, puzzleStars, scoring), scoreStars),
        `attempts ${attempts}, score ${score}`
      );
    }
  }
  assert.equal(computePuzzleStars({ attempts: 1, scoreStars: 2, puzzleStars, scoring }), 2, 'a low score caps a first attempt');
  assert.equal(computePuzzleStars({ attempts: 4, scoreStars: 3, puzzleStars, scoring }), scoring.minVictoryStars);
});

test('next-star hint only appears while the attempt cap is 3 stars and the score is below the top threshold', () => {
  const thresholds = puzzles[GATED_STAGE - 1].starThresholds;
  const top = thresholds.at(-1);
  const hint = getPuzzleNextStarHint({ attempts: 1, score: top - 1, thresholds, puzzleStars, scoring });
  assert.equal(hint.nextStarTarget, top);
  assert.equal(hint.nextStarNumber, scoring.maxStars, 'repeated thresholds still name the top star');
  assert.equal(getPuzzleNextStarHint({ attempts: 1, score: top, thresholds, puzzleStars, scoring }).nextStarTarget, null);
  assert.equal(
    getPuzzleNextStarHint({ attempts: 2, score: top - 1, thresholds, puzzleStars, scoring }).nextStarTarget,
    null,
    'a second attempt can no longer earn the top star'
  );
});

const fireFirstShot = (engine) => {
  engine.state = 'playing';
  engine.shoot();
};

test('attempts count on the first shot of a round, not on start, retry or restore', () => {
  const storage = createTestStorage();
  const engine = createTestEngine(storage);
  engine.startPuzzleMode(PLAIN_STAGE);
  assert.equal(attemptsOf(storage, PLAIN_STAGE), 0, 'start alone does not count');
  engine.restartCurrent();
  assert.equal(attemptsOf(storage, PLAIN_STAGE), 0, 'a retry alone does not count');

  fireFirstShot(engine);
  assert.equal(engine.hasFiredInRound, true);
  assert.equal(attemptsOf(storage, PLAIN_STAGE), 1, 'the first shot counts once');
  engine.currentBall = engine.nextBall;
  engine.physicsWorld.projectile = null;
  engine.shotsRemaining = Math.max(engine.shotsRemaining, 2);
  engine.shoot();
  assert.equal(attemptsOf(storage, PLAIN_STAGE), 1, 'a second shot of the round does not count');

  engine.restartCurrent();
  fireFirstShot(engine);
  assert.equal(attemptsOf(storage, PLAIN_STAGE), 2, 'a retry then a shot counts');

  engine.physicsWorld.projectile = null;
  engine.saveRunSnapshot({ force: true });
  const resumed = createTestEngine(storage);
  assert.equal(resumed.restoreSavedRun(), true);
  assert.equal(resumed.mode, 'puzzle');
  assert.equal(resumed.hasFiredInRound, true);
  resumed.state = 'playing';
  resumed.physicsWorld.projectile = null;
  resumed.shotsRemaining = Math.max(resumed.shotsRemaining, 2);
  resumed.shoot();
  assert.equal(attemptsOf(storage, PLAIN_STAGE), 2, 'a restored round keeps its flag: no new attempt');

  winStage(resumed, 0);
  assert.equal(resumed.state, 'victory');
  resumed.restartCurrent();
  fireFirstShot(resumed);
  resumed.restartCurrent();
  fireFirstShot(resumed);
  assert.equal(attemptsOf(storage, PLAIN_STAGE), 2, 'attempts stay frozen once cleared');
});

test('a pre-update victory with 0 stored attempts is never rated better than a first try', () => {
  const storage = createTestStorage();
  const engine = createTestEngine(storage);
  engine.startPuzzleMode(GATED_STAGE);
  assert.equal(attemptsOf(storage, GATED_STAGE), 0);
  winStage(engine, topThreshold(GATED_STAGE));
  assert.equal(engine.victorySummary.stars, scoring.maxStars, 'a first try may still earn every star');
});

test('stars come from the frozen attempts: first try 3, third try 2, later 1', () => {
  const cases = [
    [0, scoring.maxStars],
    [puzzleStars.threeStarMaxAttempts, scoring.maxStars - 1],
    [puzzleStars.twoStarMaxAttempts, scoring.minVictoryStars]
  ];
  for (const [retries, expectedStars] of cases) {
    const storage = createTestStorage();
    const engine = createTestEngine(storage);
    engine.startPuzzleMode(PLAIN_STAGE);
    for (let i = 0; i < retries; i++) {
      fireFirstShot(engine);
      engine.restartCurrent();
    }
    fireFirstShot(engine);
    winStage(engine, 0);
    assert.equal(engine.victorySummary.stars, expectedStars, `${retries} retries`);
    assert.equal(storage.getPuzzleStageStats()[PLAIN_STAGE].stars, expectedStars);
  }
});

test('a score-gated stage caps the first attempt below the top threshold and above it earns every star', () => {
  const lowEngine = createTestEngine(createTestStorage());
  lowEngine.startPuzzleMode(GATED_STAGE);
  winStage(lowEngine, 0);
  assert.equal(lowEngine.victorySummary.stars, scoring.maxStars - 1);

  const highEngine = createTestEngine(createTestStorage());
  highEngine.startPuzzleMode(GATED_STAGE);
  winStage(highEngine, topThreshold(GATED_STAGE));
  assert.equal(highEngine.victorySummary.stars, scoring.maxStars);
  assert.equal(highEngine.victorySummary.nextStarTarget, null);
});

test('isNewRecord is per stage: a record on one stage does not flag another', () => {
  const engine = createTestEngine(createTestStorage());
  engine.startPuzzleMode(PLAIN_STAGE);
  winStage(engine, LOW_BEST);
  assert.equal(engine.victorySummary.isNewRecord, false, 'first clear has no previous best');

  engine.startPuzzleMode(OTHER_STAGE);
  winStage(engine, OTHER_SCORE);
  assert.equal(engine.victorySummary.isNewRecord, false, 'stage 2 has no record of its own yet');

  engine.startPuzzleMode(PLAIN_STAGE);
  winStage(engine, HIGH_BEST);
  assert.equal(engine.victorySummary.isNewRecord, true, 'beating the stage best is a record');
});

test('first clear pays 40 per new star, a replay pays 0 for no new star, and Puzzle pays no run coins', () => {
  const storage = createTestStorage();
  const engine = createTestEngine(storage);
  engine.startPuzzleMode(PLAIN_STAGE);
  const before = storage.getCoins();
  const runCoinAwards = [];
  const realAward = engine.awardRunCoins.bind(engine);
  engine.awardRunCoins = (amount) => {
    runCoinAwards.push(amount);
    realAward(amount);
  };
  winStage(engine, FIRST_SCORE);
  const { stars } = engine.victorySummary;
  assert.equal(engine.victorySummary.earnedCoins, stars * COIN_PER_NEW_STAR);
  assert.deepEqual(runCoinAwards, [], 'no run coins are awarded on a Puzzle win');
  assert.equal(storage.getCoins(), before + stars * COIN_PER_NEW_STAR);

  engine.restartCurrent();
  const afterFirst = storage.getCoins();
  winStage(engine, REPLAY_SCORE);
  assert.equal(engine.victorySummary.earnedCoins, 0);
  assert.equal(storage.getCoins(), afterFirst);
});

test('Puzzle intro is built on start and retry, even with a discovery card, and is null on restore', () => {
  const storage = createTestStorage();
  const engine = createTestEngine(storage);
  engine.startPuzzleMode(OTHER_STAGE);
  const def = puzzles[OTHER_STAGE - 1];
  assert.deepEqual(engine.levelIntro, {
    puzzleStage: OTHER_STAGE,
    totalStages: puzzles.length,
    shots: def.shots,
    objective: def.objective,
    isFirstPuzzle: true
  });

  const withCard = createTestEngine(createTestStorage());
  const realRefresh = withCard.refreshDiscovery.bind(withCard);
  withCard.refreshDiscovery = () => {
    realRefresh();
    withCard.activeDiscoveryId = 'placeholder-card';
  };
  withCard.startPuzzleMode(PLAIN_STAGE);
  assert.equal(withCard.levelIntro?.puzzleStage, PLAIN_STAGE, 'built behind a discovery card');

  winStage(engine, 0);
  engine.restartCurrent();
  assert.equal(engine.levelIntro.isFirstPuzzle, false, 'a cleared stage ends the first-puzzle tutorial');

  engine.hasFiredInRound = true;
  engine.saveRunSnapshot({ force: true });
  const resumed = createTestEngine(storage);
  assert.equal(resumed.restoreSavedRun(), true);
  assert.equal(resumed.levelIntro, null);
});

test('a Puzzle game over never reports a new record', () => {
  const storage = createTestStorage();
  storage.setPuzzleRecord(1, PLAIN_STAGE);
  const engine = createTestEngine(storage);
  engine.startPuzzleMode(PLAIN_STAGE);
  engine.hasFiredInRound = true;
  engine.score = HUGE_SCORE;
  engine.triggerGameOver('outOfShots');
  assert.equal(engine.state, 'game_over');
  assert.equal(engine.gameOverSummary.isNewRecord, false);
});
