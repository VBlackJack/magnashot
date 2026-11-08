# MagnaShot: Magnetic Physics Edition

*Read this in [French](README.fr.md).*

[![Play Online](https://img.shields.io/badge/Play_Online-GitHub_Pages-38bdf8?style=for-the-badge&logo=github)](https://vblackjack.github.io/magnashot/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge)](http://www.apache.org/licenses/LICENSE-2.0)

**Live Game:** [https://vblackjack.github.io/magnashot/](https://vblackjack.github.io/magnashot/)

**MagnaShot** is a magnetic physics bubble shooter built with zero external runtime dependencies, featuring dynamic magnetic attraction and repulsion, inertia rotors, quantum portals, singularity vortices, and special power-up spheres.

---

## Features

- **Dynamic Magnetic Physics**: Same-color spheres attract, opposite magnetic poles (`N`/`S`, `+`/`-`, `Ω`/`Φ`) pull, and like poles curve projectile trajectories. Repulsors and attractors bend shots and also make the hanging clusters lean away from or toward them.
- **Tactical Aiming & Predictive Preview**:
  - Curved neon laser sight with animated dash flow, outer glow, and luminous ricochet nodes on wall, obstacle, and portal bounces.
  - Real-time blast/effect radius preview for all 7 Special Spheres (Bomb, Lightning, Prism, Anvil, Cryo, Rocket, Brush).
  - Live **Magnetic Avalanche** prediction highlighting unanchored spheres that will drop when upper bonds are severed.
- **9 Game Modes (Burger Menu `☰`, Interactive HUD Mode Pill `▾` & Mode Cards)**:
  - **Campaign**: 24 handcrafted levels introducing pendulums, inertia rotors, repulsors, oscillating barriers, quantum locks, linked portals, Boss Cores, neutral anchors no match can break, chained spheres, bubbles, freeze, lightning and paint cores, rail anchors, thrusters, long tethers and rust. Then 800 generated levels (25 to 824), in 20 chapters of 40: the first 12 each feature one of those mechanics, the last 8 a pair of them. More colors, spheres and modifiers, and a tighter shot margin as they go. Each block of 10 levels mixes formats: standard levels, two twists that add a mechanic from another chapter, a precision level (a small board, a tight shot count and a single bomb), an arsenal level (a big board, fewer shots and twice the special spheres) and a landmark (a drawn shape or a pair, and a Boss Core). A level's name and card badge (`Boss`, `Precision`, `Arsenal`, `Twist`) show its format. Each level is rebuilt from its number alone. The level select shows one chapter at a time, with the stars won in each, opens on the chapter being played, and offers a `< 3★` filter to show only unfinished unlocked levels (when active, the victory window's main button also jumps straight to the next `< 3★` level).
  - **Survival (Endless)**: Infinite wave defense with Gold Rush waves and Boss anomalies. A new wave comes down when the **Sag meter** fills (see below).
  - **Sag meter (Survival, Daily Challenge and Purist)**: A segmented gauge in the HUD, with a matching gauge beside the launcher, shows how close the cluster is to sinking. Every shot that removes nothing (a miss, a shot that leaves the board, a special sphere that hits nothing) fills one segment; a match leaves it as it is, and an avalanche caused by your shot that drops four or more spheres lifts it by one (three or more, up to two segments, in Purist); avalanches from chain reactions or from bonds that break while a shot is in flight do not drain it, and a shot that matches nothing but still causes an avalanche no longer counts as a miss. When it is full, the whole cluster drops one step (a new wave in Survival and the Daily Challenge, the rail in Purist) and the gauge empties. One miss before that, the gauge turns amber with a dashed outline, the HUD box pulses (still under reduced motion) and a polite announcement is made once per cycle; when it is full the outline is thick and red with a chevron, so the state never rests on colour alone. The meter has `role="meter"` with a spoken value, a creak and a shake mark the drop (no shake under reduced motion), and a Freeze turn does not fill it. Campaign, Puzzle, Blitz, Cascade, Flux and Boss Rush have no Sag meter.
  - **Purist**: Pure rules on a fixed ceiling. Stages are 10 columns wide and start with 6 rows of 4 colours, then grow by a row each stage (up to 9 rows) and a colour every 2 stages (up to 6). The whole top row is anchored. There are no special spheres, no Workshop upgrades, no tilt and no shot budget; Polarity stays. Misses fill the Sag meter, and each time it fills the **rail** (the ceiling) lowers one step and darkens, taking the cluster with it. Clearing the board scores a stage bonus and starts the next stage with an empty meter; the run ends when the cluster crosses the danger line. Purist keeps its own records (best score and best stage), its Share result carries the stage, the score and the number of rail drops (no link), and it opens at campaign level 4. Its card is the first of the arcade strip in the Level Select.
  - **Daily Challenge**: Deterministic daily seed (every player gets the same starting board, the same waves and the same launcher colour rolls that day, with the same rules for all: no Workshop upgrades and no shop ammo) with rotating physics mutators (*Hyper Gravity*, *Turbo Rotors*, *Super Magnetism*, *Volatile Cluster*, *Portal Matrix*, *Bumper Pinball*, *Cryo Surge*), a daily coin reward, and an escalating consecutive-day **Daily Streak** bonus (`+15 ⬡/day`, up to `+90 ⬡`). When the run ends, **Share** sends a spoiler-free result (challenge number, mutator, wave, score, one symbol per wave passed with gold rush and boss waves marked) through the system share sheet, or copies it to the clipboard. Survival and Flux runs share their wave or shape and score the same way; a Flux result also lists the assists used (Workshop levels, ammo bought, continue), when any. The Daily game over says when the next challenge starts, and the menu marks a challenge already played today. One missed day is forgiven, but only once every 7 days: a single break does not reset the streak, a second one within 7 days does. The game over says whether the grace day is available, says it was used only on the day it was, and otherwise says when it comes back.
  - **Flux Mode**: An endless chain of procedurally generated shapes sharing one shot reserve. Three stages in four draw a generated silhouette among more than 1,200 distinct shapes: stars, flowers, gears, polygons, crescents and hearts, solid or hollow, of several sizes and proportions, named after their shape ("7-Point Star", "Hollow 5-Petal Flower"). The others draw a parametric rotor or pendulum, a hand-drawn silhouette (heart, crown, bell, lighthouse, ship anchor...), some held by neutral anchors, or a pair of small shapes, never the same family twice in a row. A difficulty budget adds bumpers, portals, repulsors and singularities as the run goes on, every fifth stage hides a Boss Core, later stages add chains, bubbles and freeze, lightning and paint cores, and clearing a shape refills shots. Runs are seeded, so a reload resumes on the same shape, a finished run can be replayed on the same seed (`Same Seed`), every player on the same seed gets the same shapes, boards and launcher colour rolls, shared links (`?flux=<seed>`) open directly on that seed (asking first when another run is saved), and the Level Select toolbar lets players enter or paste any Flux seed code or share text directly. After every third cleared shape the run pauses on a **perk choice**: pick one of three offered perks (keys `1` to `3`, or tap a card), each stackable up to three times for the rest of the run. The six perks are **Reserve** (extra shots now), **Refill** (extra shots on every later shape clear), **Blast** (wider special sphere blasts), **Surge** (faster Overcharge), **Arsenal** (random special spheres now, among the special spheres you start with) and **Golden** (extra coins on every later shape clear). Held perks show as chips in the HUD and the menu, and restarting a run past the first shape asks for confirmation.
  - **Progressive Mode Unlocks**: A new player starts with Campaign and the Daily Challenge, which are always open. The other modes open as the campaign is cleared: Survival at level 3, Purist at level 4, Puzzle at level 5, Blitz at level 7, Flux at level 8, Cascade at level 10 and Boss Rush at level 12. A locked menu button says which level opens it, a newly unlocked mode is marked "New" until first used, and the victory screen announces it. A shared Flux link (`?flux=<seed>`) always works and unlocks Flux, and existing players keep every mode they already had.
  - **Weekly Flux**: A Flux run on a seed shared by every player for the current ISO week (Monday 00:00 UTC to the next Monday). The first start of the week's seed, whichever way it is started (the Weekly button, a shared link, the seed field or Same Seed), pays a `40 ⬡` bonus once per week; a restart or a resumed run never pays, the menu shows the weekly best once set, and the shared result opens on a Weekly Flux header with the week. A restart keeps the seed of the running week.
  - **My Stats**: The menu's **My stats** dialog shows an overview (play time, shots fired, runs, wins and records per mode, campaign progress, the levels you fail or leave most) and a **Daily history** of your last 60 Daily Challenges (date, challenge number, mutator, score, wave and streak). **Copy my stats** puts an anonymous text summary on the clipboard. Everything is stored on the device only; nothing is sent anywhere. The best Daily and Weekly Flux runs also keep a compact per-shot score timeline.
  - **Arcade Modes (via the Interactive HUD Mode Pill `▾` and Level Select Cards)**:
    - **Puzzle Mode**: 10 deterministic trick-shot stages with a fixed launcher queue (`1` or `2` shots), a direct stage selector (`P1` to `P10`) in the Levels modal (with polite unlock hints on locked stages), and **Core Rescue** (`💎`) objectives where freeing all Rescue Cores shatters the remaining cluster into an instant avalanche.
    - **Blitz 90s**: 90-second Time Attack with unlimited shots, live wave tracking in the HUD mode banner, rapid automatic wave descent, and a 3-second hesitation auto-fire timer displayed as a countdown ring around the launcher.
    - **Boss Rush**: Central rotor Titan (`👑`) surrounded by concentric rings where reaching 100% Overcharge directly cracks a Boss shield and defeating the Titan shatters the wave.
    - **Cascade Drop**: High-gravity magnetic well where spheres drop from the top onto support platforms and antimagnet cushions.
- **Learning the Game**:
  - A first-encounter hint explains each mechanic the first time it reaches the board, in every mode: the level tutorial when there is one, else its Codex entry. A hint is kept until you dismiss it or use the mechanic; one left open gives way to the next after three turns (one hint per turn), and **Settings** can show them all again. Polarity and each special sphere get their own hint, with the matching control pulsing (an outline replaces the motion when reduced motion is on). A **?** button in the HUD replays the current level's hints, and the first time you play a level (when no hint is up) a non-blocking objective banner shows its name, shots and focus. Levels 2 to 4 introduce one new special sphere each. In the campaign, what the level is built around is explained first.
  - Level 1 keeps to matching and avalanches: three colors, no special sphere, no modifier; the special sphere slots appear once there is one to use.
  - A level that teaches a modifier always shows the same number of it, set in its definition.
- **Game Feel**:
  - **Avalanche Collector Bins & Second Chance**: Falling avalanche spheres crossing the 5 bottom collector bins (labelled `+35` on the board) grant bonus points (`+35 pts`) and Overcharge (`+4%`). Running out of shots in Campaign or Flux Mode offers a once-per-round **Second Chance** (`+5 shots` for `40 ⬡`).
  - **HiDPI Offscreen Sphere Sprites & Arena Atmosphere**: Spheres are pre-rendered into offscreen sprite caches with rim-lighting and dual specular highlights, magnetic bonds pulse with a dual-layer energy halo, floating texts pop in elastically (clamped inside the arena walls), and the static arena layer combines a radial launcher glow, peripheral vignette, grid intersection nodes, and corner brackets.
  - **Spectacular Special Sphere Detonations, Shattering Spheres & Cinematic Slow-Motion**: Instead of vanishing instantly on frame 0, destroyed spheres visibly get knocked outward by the blast, swell (`1.0x` to `1.46x`), glow white-hot from within, split along radial fracture lines, and shatter into secondary fireball puffs and long-tailed sparks during the slow-motion window. Explosive and kinetic special spheres (*Bomb*, *Lightning*, *Anvil*, *Rocket*, *Prism*, plus *Dormant Barrels* and *Boss Cores*) trigger multi-stage fireball clouds, 12-ray starburst spikes, an arena impact flash, concentric shockwaves, targeted lightning arcs, and a colored perimeter slow-motion vignette (`getTimeScale`) that automatically turns off under Reduced Motion.
  - **Danger Line Proximity Glow & Enriched Run Summary**: Spheres entering the danger warning zone emit a pulsing radial warning halo (static in reduced motion), and the Game Over screen reports detailed run metrics (wave/stage reached, max combo, and coins earned) with spoiler-free **Share** support across all 7 non-campaign modes.
  - **Near-Miss Line and Best-Run Marker**: When a run in a mode with a record (Survival, Daily, Cascade, Blitz, Flux, Boss Rush) ends within half of that record, the game over says how far it fell short, as plain information next to the stats (a run far below the record says nothing). In Flux and Boss Rush, a compact "Best" marker in the HUD shows the record the run started against; score modes already show it in the HUD.
  - Every landing sends a swelling wave through the cluster, bond by bond and weaker at each step, with a light screen shake. The wave only changes how spheres are drawn; reduced motion turns both off.
  - The victory score rolls up and the earned stars pop in one after another; both respect reduced motion. The victory screen also shows how many points remain to reach the next star (or confirms 3★), and highlights new personal records across Campaign, Survival, Daily Challenge, and Flux Mode, while Campaign and Flux defeats report how many spheres were left on the board.
- **Workshop & Codex**:
  - Permanent upgrades (*Curved Laser Sight*, *Magnetic Amplifier*, *Overcharge Capacitor*, *Projectile Reserve*, *Collector Magnet*).
  - In-run Special Ammo refills (clicking or pressing `1`-`7` on an empty special sphere opens this tab), **4 Unlockable Sphere Visual Styles** (*Classic*, *Crystal*, *Neon*, *Metallic*) with live visual preview orbs, Bounties/Achievements with persistent all-time personal-best progress bars, grouped in Bronze, Silver and Gold tiers per family (new families for Flux shapes and Boss Rush waves), and an illustrated **Codex & Guide** covering cluster modifiers, magnetic obstacles, special spheres, Daily Challenge mutators, and core board & launcher mechanics (*Polarity Inversion*, *Magnetic Collector Bins*, *Overcharge Gauge*).
- **Accessibility & Comfort**:
  - Bilingual interface (**FR** / **EN**) with zero hardcoded strings; the first visit follows the browser language.
  - **High Contrast** mode with enhanced borders and polarity symbols; buttons meet WCAG AA contrast.
  - **Color Patterns** setting: each color gets its own pattern (stripes, dots, grid, rings) inside the spheres.
  - **Reduced Motion** toggle and **Animation Speed** selector (`0.5x`, `1x`, `1.5x`, `2x` for explosions, shattering spheres, shockwaves, and slow-motion detonations) in **Settings**, plus automatic pause on tab switch.
  - **Fullscreen Toggle** (`⛶`) right on the top HUD bar on portrait phones and tablets, as well as in **Settings** across all devices, hiding browser address and navigation bars (`navigationUI: 'hide'`). The toggle is hidden when the installed app already runs fullscreen.
  - **Tilt Control** on phones and tablets, on by default: tilting the device leans gravity sideways. On iPhone and iPad, the first tap on the board asks for the motion permission. It can be turned off in **Settings**.
  - Screen reader support: labelled toggles with `aria-pressed`, named power-ups and level stars, and polite announcements for achievements and round results.
  - Full mouse, touch (with vertical finger offset and pull-down shot cancellation), and keyboard controls; held action keys do not auto-repeat. The arrows fine-tune a mouse aim: after an arrow, small mouse movements leave the aim alone and a click shoots along it.
  - Zero-scroll layout on desktop, phones and landscape phones, with 44 px touch targets and a unified slide-in burger menu (`☰`) across all viewports (grouping *Game Modes* and *Current Round* actions while pausing the run). On portrait phones the board spans the full width and a compact line under the score keeps the round, coins and best score in view. The board takes the shape of the 470 x 820 world. On landscape desktops the board uses the full window height, centered between two columns of the same width: the burger menu button, interactive mode selector pill (`▾`) and round stats on the left, overcharge, special spheres, Polarity and Swap on the right.
  - The run in progress survives a reload or a discarded tab and resumes paused.
- **Installable & Offline**:
  - Installable Progressive Web App with standard and maskable icons; **Settings** offers an Install button where the browser allows it, and a hint for iPhone and iPad.
  - Network-first Service Worker that falls back to the cached copy when offline or when the network is too slow.

---

## Controls

| Action | Mouse / Touch | Keyboard |
| :--- | :--- | :--- |
| **Aim** | Move pointer / Drag finger | `Left` / `Right` for fine steps (`+ Shift` for bigger ones) |
| **Shoot** | Release pointer / finger | `Enter` |
| **Cancel Aim** | Drag below the launcher ring | - |
| **Swap Sphere** | Click secondary sphere or **Swap** button | `Space` |
| **Flip Polarity** | Click **Polarity** button | `F` |
| **Equip / Unequip Special Sphere** | Click Special Sphere slot (click again to stash) | `1` to `7` |
| **Pause / Close Modal** | Click **Pause** or modal backdrop | `Escape` |
| **Settings** | Click **⚙ Settings**, or open **Pause** | - |

---

## Architecture Overview

The codebase follows a modular, zero-dependency ES module architecture with strict data/logic separation (`configs/*.json` and `locales/*.json`):

```text
├── configs/                  # Externalized game, physics, ball, obstacle, audio, level, campaign & Flux data
├── icons/                    # PWA icons (SVG, maskable SVG, 192 px and 512 px PNG)
├── locales/                  # Bilingual translation dictionaries (fr.json, en.json)
├── scripts/
│   ├── calibrate-campaign.mjs# Offline campaign level calibration CLI
│   ├── calibrate-classic.mjs # Offline report of how hard Purist is for the greedy bot (prints, never writes)
│   ├── pages-artifact.mjs    # Builds the GitHub Pages artifact (_site/) with only the runtime files
│   ├── release.mjs           # Release preparation: bumps versions and promotes the CHANGELOG Unreleased section
│   └── bot/
│       └── CampaignBot.js    # Greedy and arsenal calibration bots
├── src/
│   ├── main.js               # Application bootstrap, pointer input guards & Service Worker registration
│   ├── core/
│   │   ├── ConfigRegistry.js # Parallel JSON configuration loader
│   │   ├── Constants.js      # Frozen enums and mathematical constants
│   │   ├── I18n.js           # Localization service and DOM attribute translator
│   │   ├── SeededRandom.js   # Deterministic PRNG (Mulberry32) for Daily Challenges and Flux runs
│   │   ├── StorageManager.js # Cached localStorage persistence with in-memory fallback, versioned save schema (ordered migrations, legacy prefix merge)
│   │   ├── installMethods.js # Installs a domain module's methods on a class prototype
│   │   ├── WorldGeometry.js  # Launcher, danger line and content offset derived from the world size
│   │   └── AudioManager.js   # Procedural Web Audio API synthesizer
│   ├── entities/
│   │   ├── Ball.js           # Magnetic sphere entity (bonds, polarity, armor, modifiers)
│   │   ├── Obstacle.js       # Rotors, bumpers, repulsors, portals, barriers & singularities
│   │   └── ParticleSystem.js # Object-pooled, capped bursts, trails, shockwaves, lightning & popups
│   ├── physics/
│   │   ├── PhysicsWorld.js   # Substepped spring-constraint solver, raycaster & BFS avalanche
│   │   └── SpatialHashGrid.js# Collision-free 2D spatial hash grid for neighbor queries
│   ├── game/
│   │   ├── GameEngine.js     # Game state machine core (constructor, state, scoring & achievements); domain methods live in the Engine*.js modules
│   │   ├── EngineBoard.js    # GameEngine module: level layouts, endless rows & cluster modifiers
│   │   ├── EngineControls.js # GameEngine module: special slots, shop ammo, launcher swap, aim, tilt & comfort settings
│   │   ├── EngineDiscovery.js# GameEngine module: first-encounter hints
│   │   ├── EngineLauncher.js # GameEngine module: launcher queue, seeded colour rolls & stale colour refresh
│   │   ├── EngineModes.js    # GameEngine module: starting every mode (Campaign, Survival, Puzzle, Blitz, Boss Rush, Cascade, Daily, Flux), Flux perks & stage transitions
│   │   ├── EngineRoundFlow.js# GameEngine module: wave types, round end checks, game over & continue pack
│   │   ├── EngineTurnResolution.js # GameEngine module: cluster resolution, chain reactions, avalanche, random special grants & Overcharge
│   │   ├── GameLoop.js       # Fixed-step loop with interpolation, idle throttling and fatal error stop
│   │   ├── ImpactPreview.js  # What a shot would destroy, shared by the aim preview and the calibration bot
│   │   ├── LevelCatalog.js   # Authored and generated campaign level builder and fingerprint
│   │   ├── Renderer.js       # HiDPI Canvas 2D renderer with alpha interpolation & AOE preview
│   │   ├── RunSnapshot.js    # In-progress run serialization and reload-resume persistence
│   │   ├── SpecialBallController.js # Bomb, Lightning, Prism, Anvil, Cryo, Rocket & Brush impact resolution
│   │   ├── Discovery.js      # First-encounter hints: mechanics on a board, next unknown one, hint text
│   │   ├── DailyShare.js     # Spoiler-free result text of every non-campaign mode for the Share button
│   │   ├── ModeUnlocks.js    # Pure rules of the progressive mode unlocks (campaign level per mode, new and seen states)
│   │   ├── SagMeter.js       # Pure rules of the Sag meter: whiff test, fill and avalanche drain, lowering and warning phase
│   │   ├── WeeklyFlux.js     # ISO week key, weekly Flux seed and countdown to the next week
│   │   ├── PlayerStats.js    # Pure local statistics: runs, shots, play time, hardest levels, anonymous stats text
│   │   ├── ShotTimeline.js   # Compact per-shot score timeline kept for the best Daily and Weekly Flux runs
│   │   ├── EngineProgress.js # GameEngine module: statistics, mode unlocks, Daily history, Weekly Flux and timeline hooks
│   │   └── layouts/
│   │       ├── LayoutGenerators.js   # Pure shape geometry: pendulum, rings, hexagon, spiral, cross, masks
│   │       ├── ShapeGenerator.js     # Generated Flux silhouettes: polar curves on the sphere grid, quality filter
│   │       └── FluxStageGenerator.js # Seeded Flux stages: shape family, difficulty budget, boss core
│   └── ui/
│       ├── CodexView.js      # Illustrated Codex & Guide tab rendering
│       ├── FluxPerkView.js   # Flux perk choice dialog and active perk chips
│       ├── LevelSelectView.js# Campaign chapters, level cards, format badges & < 3★ filter
│       ├── UIManager.js      # UI core: construction, wiring and the modules below
│       ├── UIHelpers.js      # Pure UI helpers and constants: focus-trap filtering, formatters, share and victory resolvers, shared WeakMaps
│       ├── UIHudRefresh.js   # UIManager module: HUD and menu refresh
│       ├── UIInputBindings.js# UIManager module: install, drawer and keyboard bindings
│       ├── UIModals.js       # UIManager module: dialogs, shop tabs, focus trap and inert handling
│       ├── UISettingsControls.js # UIManager module: settings controls, Share and the Daily countdown
│       ├── UIStats.js        # UIManager module: My stats dialog (overview, Daily history, copy my stats)
│       └── WorkshopView.js   # Upgrades, in-run Special Ammo refills & achievement progress bars
├── styles/main.css           # Responsive layout and design tokens
├── eslint.config.js          # ESLint 10 flat configuration
├── index.html                # Application shell and static bootstrap error banner
├── manifest.webmanifest      # PWA manifest
├── sw.js                     # Network-first Service Worker with timeout and versioned offline fallback
└── tests/                    # Automated Node.js test suites
```

---

## Local Development

Requires Node.js 22 or later (CI runs Node.js 24).

```bash
# Run local static server on port 4200
npm start

# Run the engine, UI helper and repository guard suites
npm test

# Lint the sources (first time: npm install)
npm run lint

# Run the browser smoke tests (first time: npm install, then npx playwright install chromium)
npm run test:browser
```

The suites in `tests/` cover the game engine, physics, rendering loop, UI helpers, the calibration tooling, and the repository guards:

- `typography.test.js` rejects typographic look-alikes of ASCII characters (long dashes, curly quotes, ellipsis, special spaces, ligatures) in every text file.
- `pwa.test.js` checks that every file under `src/`, `configs/`, `locales/` and `icons/` is precached by `sw.js`, that `index.html` declares a `Content-Security-Policy` without `'unsafe-inline'` styles, that the Service Worker cache version matches `package.json`, and, by running `sw.js` in a sandbox, that activation deletes only this app's own caches.
- `onboarding.test.js` checks that every mechanic has a hint in both languages, that a level whose tutorial teaches a mechanic always shows it, and that level 1 shows only the basics.
- `fluxGenerator.test.js` checks that the shape generator yields at least 1,000 distinct shapes, each fitting the board and hanging from its anchors, named in both languages.
- `campaign.test.js` checks that the 800 generated levels are playable boards rebuilt the same from their number, that difficulty climbs from chapter to chapter, that a landmark comes every 10 levels, that each level is named in both languages, and that each one is calibrated for the board it is: a change to the generator, the Flux shapes or the campaign curve fails it until the levels are measured again.
- `world.test.js` checks that every campaign level (generated ones included), Flux stage (1 to 60) and the Survival grid fit between the walls, and that a world of the design width builds every level at its authored positions.
- `bot.test.js` checks the calibration bots (what a shot is worth, when the arsenal bot plays a special, that the greedy one never does) and the command line of `scripts/calibrate-campaign.mjs`.
- `pagesArtifact.test.js` checks that the GitHub Pages artifact holds only runtime files, `engineApi.test.js` and `uiApi.test.js` snapshot the public prototype API of `GameEngine` and `UIManager` so a module split cannot lose a method, `saveSchema.test.js` checks the ordered, idempotent save migrations, `release.test.js` checks the version bump and CHANGELOG promotion of `scripts/release.mjs`, and `fairness.test.js` checks that a seed gives every player the same launcher colour rolls and that Daily applies no Workshop upgrades or shop ammo.
- `modeUnlocks.test.js`, `weeklyFlux.test.js`, `dailyHistory.test.js`, `playerStats.test.js` and `shotTimeline.test.js` check the progressive unlock thresholds, the ISO week keys and seeds (year boundaries, Monday 00:00 UTC), the 60-day Daily history, the local statistics and the compact shot timelines; `saveSchema.test.js` also covers the migrations that keep every mode for existing players.
- `sagMeter.test.js`, `classicMode.test.js` and `uiSag.test.js` check the Sag meter rules (what counts as a miss, fill, avalanche drain and its cap, reset on a drop, warning phase), Survival and Daily lowering exactly one wave per full meter, Purist stages (no specials or upgrades, rail drops that move anchors and pivots but not platforms, stage clear, line crossed), same-seed determinism, run snapshots (including the old `shotsUntilWave` field), the HUD Sag box and its announcements, and the Purist card, records and share text.

The generated levels are calibrated outside CI by two bots (`scripts/bot/CampaignBot.js`):

```bash
node scripts/calibrate-campaign.mjs
```

- the **greedy** bot aims the loaded color where most spheres of that color sit and never plays a special sphere. It plays each level 16 times (`calibration` in `configs/campaign.json`); a level it wins less than one game in eight gets extra shots, then another seed, until one passes. A player who ignores special spheres can always win.
- the **arsenal** bot reads the aim preview the player sees (what a shot destroys and drops, `src/game/ImpactPreview.js`) for the loaded color and every special sphere in stock, and plays a special when it takes off at least 6 spheres and 3 more than the best color shot, or once the shots left no longer outnumber the specials (`calibration.bot.arsenal`). It plays each candidate 16 times too, and a level it wins less than one game in two (`minArsenalWinRate`) also gets extra shots, then another seed, until a candidate passes both floors.

Star thresholds come from the median score of the bot named by `calibration.starPolicy`: three stars at the ratio the 24 authored levels show for that bot (`threeStarMedianFactors`: 1.08 for greedy, 0.79 for arsenal), two stars at 63% of three. The result, with both bots' measures, goes to `configs/campaignTuning.json`; `--from` and `--to` measure a range only, `--workers` sets the number of parallel workers (by default all cores but two), and `--dry-run` prints the measures without writing them. Only a dry run measures an authored level, as it is (`--from 24 --to 24 --dry-run`); a writing run starts on the first generated level.

Purist is measured outside CI by the same greedy bot: `node scripts/calibrate-classic.mjs [--seeds <n>]` prints the share of runs that clear stage 1 and the share that reach stage 3 or more, against the targets of the script. It never writes a config; `sag.modes.classic` and `classic` in `configs/game.json` are tuned by hand.

`tests/browser/smoke.test.js` opens the real page in headless Chromium at the four supported layouts (desktop, portrait tablet, landscape and portrait phones). It fails on any console error, sideways scrolling or clipped control label, checks the layout on level 1 (no special sphere) and level 2 (special spheres), checks that the level select opens on the chapter of the current level and switches chapters, checks that the Settings, Levels, Workshop, My stats and Pause dialogs pause and resume the run, walks through the victory, game over and reload-resume paths, checks that Campaign game over offers no Share while Daily Challenge, Survival and Flux Mode copy their result to the clipboard, checks that a fresh profile finds the gated modes locked (tapping one explains why) while an existing player keeps every mode, that a shared Flux link unlocks Flux, that the Daily history and Copy my stats work and that the Weekly Flux button starts the seed of the current week, and checks that the Sag meter shows in the HUD in Survival at every layout without changing the HUD grid and warns after scripted misses, that a fresh profile finds the Purist card locked (tapping it names level 4) while an existing player starts Purist, and checks that a mouse tremor keeps a keyboard-tuned aim. CI runs it as a separate job.

When adding a runtime file, list it in `PRECACHE_ASSETS` in `sw.js`. To release, move the notes under `## [Unreleased]` in `CHANGELOG.md` as needed, then run `npm run release -- <patch|minor|major|X.Y.Z>` (add `--dry-run` to preview): it bumps `package.json`, `package-lock.json` and `APP_VERSION` in `sw.js` and promotes the Unreleased section, but never commits, tags or pushes. Deployment to GitHub Pages happens from CI, after the test and browser jobs pass on `master`.

---

## License

Copyright 2026 Julien Bombled. Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0).
