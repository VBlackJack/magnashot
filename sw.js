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

const APP_VERSION = '1.27.0';
const CACHE_NAME = `magnashot-cache-v${APP_VERSION}`;

// The service worker cannot read configs/*.json before it has a cache, so its
// tuning lives here as named constants.
const NETWORK_TIMEOUT_MS = 4000;
const NAVIGATION_FALLBACK_URL = './index.html';
// Only caches created by this app (current and legacy names) are cleaned up: the
// origin is shared with other apps whose Cache Storage must stay untouched.
const OWN_CACHE_PREFIXES = Object.freeze(['magnashot-cache-', 'flux-spheres-cache-', 'magnet-balls-cache-']);
const CACHE_MATCH_OPTIONS = Object.freeze({ ignoreSearch: true });
const HTTP_STATUS_OK = 200;
// The host lets browsers reuse files for minutes without asking (GitHub Pages sends
// max-age=600). Right after a deploy that mixes a new page with old scripts, styles and
// texts, so every network request revalidates, and the install skips the HTTP cache.
const NETWORK_FETCH_OPTIONS = Object.freeze({ cache: 'no-cache' });
const PRECACHE_FETCH_OPTIONS = Object.freeze({ cache: 'reload' });

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './styles/main.css',
  './src/main.js',
  './src/core/AudioManager.js',
  './src/core/MusicEngine.js',
  './src/core/ConfigRegistry.js',
  './src/core/GamepadInput.js',
  './src/core/StorageView.js',
  './src/core/AudioChannel.js',
  './src/core/Constants.js',
  './src/core/I18n.js',
  './src/core/installMethods.js',
  './src/core/SeededRandom.js',
  './src/core/StorageManager.js',
  './src/core/WorldGeometry.js',
  './src/entities/Ball.js',
  './src/entities/Obstacle.js',
  './src/entities/ParticleSystem.js',
  './src/game/DailyShare.js',
  './src/game/ModeUnlocks.js',
  './src/game/WeeklyFlux.js',
  './src/game/PlayerStats.js',
  './src/game/ShotTimeline.js',
  './src/game/GhostCodec.js',
  './src/game/GhostDuel.js',
  './src/game/EngineGhostDuel.js',
  './src/game/BotBrain.js',
  './src/game/EngineVersus.js',
  './src/game/VersusMatch.js',
  './src/game/VersusRules.js',
  './src/game/MagnetarRules.js',
  './src/game/EngineMagnetar.js',
  './src/game/SagMeter.js',
  './src/game/EngineProgress.js',
  './src/game/GameEngine.js',
  './src/game/EngineModes.js',
  './src/game/EngineBoard.js',
  './src/game/EngineLauncher.js',
  './src/game/EngineDiscovery.js',
  './src/game/EngineControls.js',
  './src/game/EngineTurnResolution.js',
  './src/game/EngineRoundFlow.js',
  './src/game/EnginePulse.js',
  './src/game/GameLoop.js',
  './src/game/ImpactPreview.js',
  './src/game/Renderer.js',
  './src/game/Resonance.js',
  './src/game/RunSnapshot.js',
  './src/game/Discovery.js',
  './src/game/LevelCatalog.js',
  './src/game/SpecialBallController.js',
  './src/game/layouts/FluxStageGenerator.js',
  './src/game/layouts/LayoutGenerators.js',
  './src/game/layouts/ShapeGenerator.js',
  './src/game/modes/ConvoyBehavior.js',
  './src/game/modes/HexGridBehavior.js',
  './src/game/modes/MergeBehavior.js',
  './src/game/modes/MergeEvents.js',
  './src/game/modes/MergeContracts.js',
  './src/game/modes/MergeSpecials.js',
  './src/game/modes/ModeBehavior.js',
  './src/game/modes/ModeConfig.js',
  './src/game/modes/OrbitalBehavior.js',
  './src/game/modes/PinballBehavior.js',
  './src/game/modes/index.js',
  './src/physics/PhysicsWorld.js',
  './src/physics/SpatialHashGrid.js',
  './src/ui/CanvasInput.js',
  './src/ui/CodexView.js',
  './src/ui/FluxPerkView.js',
  './src/ui/UIGamepad.js',
  './src/ui/PlayHubView.js',
  './src/ui/PulseDriver.js',
  './src/ui/UICalibration.js',
  './src/ui/RhythmCalibration.js',
  './src/ui/UIGhostDuel.js',
  './src/ui/LevelSelectView.js',
  './src/ui/UIHelpers.js',
  './src/ui/UIHudRefresh.js',
  './src/ui/UIInputBindings.js',
  './src/ui/LocalInput.js',
  './src/ui/UIManager.js',
  './src/ui/UIModals.js',
  './src/ui/UISettingsControls.js',
  './src/ui/ProgressBackupView.js',
  './src/core/ProgressBackup.js',
  './src/ui/UIStats.js',
  './src/ui/UIVersus.js',
  './src/ui/UIVersusLocal.js',
  './src/ui/VersusHud.js',
  './src/ui/WorkshopView.js',
  './configs/audio.json',
  './configs/balls.json',
  './configs/campaign.json',
  './configs/campaignTuning.json',
  './configs/flux.json',
  './configs/fluxShapeTuning.json',
  './configs/game.json',
  './configs/levels.json',
  './configs/modes.json',
  './configs/obstacles.json',
  './configs/physics.json',
  './locales/en.json',
  './locales/fr.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS.map((url) => new Request(url, PRECACHE_FETCH_OPTIONS))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && OWN_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

async function matchCached(request) {
  const cached = await caches.match(request, CACHE_MATCH_OPTIONS);
  if (cached) {
    return cached;
  }
  if (request.mode === 'navigate') {
    return caches.match(NAVIGATION_FALLBACK_URL, CACHE_MATCH_OPTIONS);
  }
  return undefined;
}

/**
 * Network first, but a slow network does not hold the page hostage: after
 * NETWORK_TIMEOUT_MS the cached copy is served if there is one.
 */
async function respondNetworkFirst(request, networkFetch) {
  let timeoutId = null;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([networkFetch, timeout]);
    if (response) {
      return response;
    }
  } catch {
    // Offline or network error: fall through to the cache.
  } finally {
    clearTimeout(timeoutId);
  }
  const cached = await matchCached(request);
  if (cached) {
    return cached;
  }
  try {
    return await networkFetch;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  const networkFetch = fetch(request, NETWORK_FETCH_OPTIONS);
  // Clone synchronously, before the page can start reading the body, and keep
  // the worker alive until the cache write has finished.
  const cacheUpdate = networkFetch
    .then((response) => {
      if (!response || response.status !== HTTP_STATUS_OK) {
        return undefined;
      }
      const copy = response.clone();
      // Reads use ignoreSearch, so store one entry per path instead of one per query string.
      const cacheKey = new URL(request.url);
      cacheKey.search = '';
      return caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey.href, copy));
    })
    .catch(() => undefined);
  event.waitUntil(cacheUpdate);
  event.respondWith(respondNetworkFirst(request, networkFetch));
});
