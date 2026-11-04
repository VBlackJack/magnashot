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
  - Real-time blast/effect radius preview for all 7 Special Balls (Bomb, Lightning, Prism, Anvil, Cryo, Rocket, Brush).
  - Live **Magnetic Avalanche** prediction highlighting unanchored spheres that will drop when upper bonds are severed.
- **8 Game Modes (Burger Menu `☰`, Interactive HUD Mode Pill `▾` & Mode Cards)**:
  - **Campaign**: 24 handcrafted levels introducing pendulums, inertia rotors, repulsors, oscillating barriers, quantum locks, linked portals, Boss Cores, neutral anchors no match can break, chained spheres, bubbles, freeze, lightning and paint cores, rail anchors, thrusters, long tethers and rust. Then 800 generated levels (25 to 824), in 20 chapters of 40: the first 12 each feature one of those mechanics, the last 8 a pair of them. More colors, spheres and modifiers, and a tighter shot margin as they go. Each block of 10 levels mixes formats: standard levels, two twists that add a mechanic from another chapter, a precision level (a small board, a tight shot count and a single bomb), an arsenal level (a big board, fewer shots and twice the special balls) and a landmark (a drawn shape or a pair, and a Boss Core). A level's name and card badge (`Boss`, `Precision`, `Arsenal`, `Twist`) show its format. Each level is rebuilt from its number alone. The level select shows one chapter at a time, with the stars won in each, opens on the chapter being played, and offers a `< 3★` filter to show only unfinished unlocked levels (when active, the victory window's main button also jumps straight to the next `< 3★` level).
  - **Survival (Endless)**: Infinite wave defense with Gold Rush waves and Boss anomalies.
  - **Daily Challenge**: Deterministic daily seed with rotating physics mutators (*Hyper Gravity*, *Turbo Rotors*, *Super Magnetism*, *Volatile Cluster*), a daily coin reward, and an escalating consecutive-day **Daily Streak** bonus (`+15 ⬡/day`, up to `+90 ⬡`). When the run ends, **Share** sends a spoiler-free result (challenge number, mutator, wave, score, one symbol per wave passed with gold rush and boss waves marked) through the system share sheet, or copies it to the clipboard. Survival and Flux runs share their wave or shape and score the same way. The Daily game over says when the next challenge starts, and the menu marks a challenge already played today.
  - **Flux Mode**: An endless chain of procedurally generated shapes sharing one shot reserve. Three stages in four draw a generated silhouette among more than 1,200 distinct shapes: stars, flowers, gears, polygons, crescents and hearts, solid or hollow, of several sizes and proportions, named after their shape ("7-Point Star", "Hollow 5-Petal Flower"). The others draw a parametric rotor or pendulum, a hand-drawn silhouette (heart, crown, bell, lighthouse, ship anchor...), some held by neutral anchors, or a pair of small shapes, never the same family twice in a row. A difficulty budget adds bumpers, portals, repulsors and singularities as the run goes on, every fifth stage hides a Boss Core, later stages add chains, bubbles and freeze, lightning and paint cores, and clearing a shape refills shots. Runs are seeded, so a reload resumes on the same shape, a finished run can be replayed on the same seed (`Same Seed`), shared links (`?flux=<seed>`) open directly on that seed, and the Level Select toolbar lets players enter or paste any Flux seed code or share text directly.
  - **Arcade Modes (via the Interactive HUD Mode Pill `▾` and Level Select Cards)**:
    - **Puzzle Mode**: 5 deterministic trick-shot stages with a fixed launcher queue (`1` or `2` shots), a direct stage selector (`P1` to `P5`) in the Levels modal (with polite unlock hints on locked stages), and **Core Rescue** (`💎`) objectives where freeing all Rescue Cores shatters the remaining cluster into an instant avalanche.
    - **Blitz 90s**: 90-second Time Attack with unlimited shots, live wave tracking in the HUD mode banner, rapid automatic wave descent, and a 3-second hesitation auto-fire timer displayed as a countdown ring around the launcher.
    - **Boss Rush**: Central rotor Titan (`👑`) surrounded by concentric rings where reaching 100% Overcharge directly cracks a Boss shield and defeating the Titan shatters the wave.
    - **Cascade Drop**: High-gravity magnetic well where spheres drop from the top onto support platforms and antimagnet cushions.
- **Learning the Game**:
  - A first-encounter hint explains each mechanic the first time it reaches the board, in every mode: the level tutorial when there is one, else its Codex entry. Each hint shows once; one left open gives way to the next after three turns, and **Settings** can show them all again. In the campaign, what the level is built around is explained first.
  - Level 1 keeps to matching and avalanches: three colors, no special ball, no modifier; the special ball slots appear once there is one to use.
  - A level that teaches a modifier always shows the same number of it, set in its definition.
- **Game Feel**:
  - **Avalanche Collector Bins & Second Chance**: Falling avalanche spheres crossing the 5 bottom collector bins (labelled `+35` on the board) grant bonus points (`+35 pts`) and Overcharge (`+4%`). Running out of shots in Campaign or Flux Mode offers a once-per-round **Second Chance** (`+5 shots` for `40 ⬡`).
  - **HiDPI Offscreen Sphere Sprites & Arena Atmosphere**: Spheres are pre-rendered into offscreen sprite caches with rim-lighting and dual specular highlights, magnetic bonds pulse with a dual-layer energy halo, floating texts pop in elastically (clamped inside the arena walls), and the static arena layer combines a radial launcher glow, peripheral vignette, grid intersection nodes, and corner brackets.
  - **Spectacular Special Ball Detonations, Shattering Spheres & Cinematic Slow-Motion**: Instead of vanishing instantly on frame 0, destroyed spheres visibly get knocked outward by the blast, swell (`1.0x` to `1.46x`), glow white-hot from within, split along radial fracture lines, and shatter into secondary fireball puffs and long-tailed sparks during the slow-motion window. Explosive and kinetic special balls (*Bomb*, *Lightning*, *Anvil*, *Rocket*, *Prism*, plus *Dormant Barrels* and *Boss Cores*) trigger multi-stage fireball clouds, 12-ray starburst spikes, an arena impact flash, concentric shockwaves, targeted lightning arcs, and a colored perimeter slow-motion vignette (`getTimeScale`) that automatically turns off under Reduced Motion.
  - **Danger Line Proximity Glow & Enriched Run Summary**: Spheres entering the danger warning zone emit a pulsing radial warning halo (static in reduced motion), and the Game Over screen reports detailed run metrics (wave/stage reached, max combo, and coins earned) with spoiler-free **Share** support across all 7 non-campaign modes.
  - Every landing sends a swelling wave through the cluster, bond by bond and weaker at each step, with a light screen shake. The wave only changes how spheres are drawn; reduced motion turns both off.
  - The victory score rolls up and the earned stars pop in one after another; both respect reduced motion. The victory screen also shows how many points remain to reach the next star (or confirms 3★), and highlights new personal records across Campaign, Survival, Daily Challenge, and Flux Mode, while Campaign and Flux defeats report how many spheres were left on the board.
- **Workshop & Codex**:
  - Permanent upgrades (*Curved Laser Sight*, *Magnetic Amplifier*, *Overcharge Capacitor*, *Projectile Reserve*).
  - In-run Special Ammo refills (clicking or pressing `1`-`7` on an empty special ball opens this tab), **4 Unlockable Sphere Visual Styles** (*Classic*, *Crystal*, *Neon*, *Metallic*) with live visual preview orbs, Bounties/Achievements with persistent all-time personal-best progress bars, and an illustrated **Codex & Guide** covering cluster modifiers, magnetic obstacles, special balls, Daily Challenge mutators, and core board & launcher mechanics (*Polarity Inversion*, *Magnetic Collector Bins*, *Overcharge Gauge*).
- **Accessibility & Comfort**:
  - Bilingual interface (**FR** / **EN**) with zero hardcoded strings; the first visit follows the browser language.
  - **High Contrast** mode with enhanced borders and polarity symbols; buttons meet WCAG AA contrast.
  - **Color Patterns** setting: each color gets its own pattern (stripes, dots, grid, rings) inside the spheres.
  - **Reduced Motion** toggle and **Animation Speed** selector (`0.5x`, `1x`, `1.5x`, `2x` for explosions, shattering spheres, shockwaves, and slow-motion detonations) in **Settings**, plus automatic pause on tab switch.
  - **Tilt Control** on phones and tablets, on by default: tilting the device leans gravity sideways. On iPhone and iPad, the first tap on the board asks for the motion permission. It can be turned off in **Settings**.
  - Screen reader support: labelled toggles with `aria-pressed`, named power-ups and level stars, and polite announcements for achievements and round results.
  - Full mouse, touch (with vertical finger offset and pull-down shot cancellation), and keyboard controls; held action keys do not auto-repeat. The arrows fine-tune a mouse aim: after an arrow, small mouse movements leave the aim alone and a click shoots along it.
  - Zero-scroll layout on desktop, phones and landscape phones, with 44 px touch targets and a unified slide-in burger menu (`☰`) across all viewports (grouping *Game Modes* and *Current Round* actions while pausing the run). On portrait phones the board spans the full width and a compact line under the score keeps the round, coins and best score in view. The board takes the shape of the 470 x 820 world. On landscape desktops the board uses the full window height, centered between two columns of the same width: the burger menu button, interactive mode selector pill (`▾`) and round stats on the left, overcharge, special balls, Polarity and Swap on the right.
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
| **Swap Ball** | Click secondary ball or **Swap** button | `Space` |
| **Flip Polarity** | Click **Polarity** button | `F` |
| **Equip / Unequip Special Ball** | Click Special Ball slot (click again to stash) | `1` to `7` |
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
│   └── bot/
│       └── CampaignBot.js    # Greedy and arsenal calibration bots
├── src/
│   ├── main.js               # Application bootstrap, pointer input guards & Service Worker registration
│   ├── core/
│   │   ├── ConfigRegistry.js # Parallel JSON configuration loader
│   │   ├── Constants.js      # Frozen enums and mathematical constants
│   │   ├── I18n.js           # Localization service and DOM attribute translator
│   │   ├── SeededRandom.js   # Deterministic PRNG (Mulberry32) for Daily Challenges and Flux runs
│   │   ├── StorageManager.js # Cached localStorage persistence with in-memory fallback
│   │   ├── WorldGeometry.js  # Launcher, danger line and content offset derived from the world size
│   │   └── AudioManager.js   # Procedural Web Audio API synthesizer
│   ├── entities/
│   │   ├── Ball.js           # Magnetic sphere entity (bonds, polarity, armor, modifiers)
│   │   ├── Obstacle.js       # Rotors, bumpers, repulsors, portals, barriers & singularities
│   │   └── ParticleSystem.js # Object-pooled bursts, trails, shockwaves, lightning & popups
│   ├── physics/
│   │   ├── PhysicsWorld.js   # Substepped spring-constraint solver, raycaster & BFS avalanche
│   │   └── SpatialHashGrid.js# Collision-free 2D spatial hash grid for neighbor queries
│   ├── game/
│   │   ├── GameEngine.js     # Game state machine, wave spawner, scoring & achievements
│   │   ├── GameLoop.js       # Fixed-step loop with interpolation, idle throttling and fatal error stop
│   │   ├── ImpactPreview.js  # What a shot would destroy, shared by the aim preview and the calibration bot
│   │   ├── LevelCatalog.js   # Authored and generated campaign level builder and fingerprint
│   │   ├── Renderer.js       # HiDPI Canvas 2D renderer with alpha interpolation & AOE preview
│   │   ├── RunSnapshot.js    # In-progress run serialization and reload-resume persistence
│   │   ├── SpecialBallController.js # Bomb, Lightning, Prism, Anvil, Cryo, Rocket & Brush impact resolution
│   │   ├── Discovery.js      # First-encounter hints: mechanics on a board, next unknown one, hint text
│   │   ├── DailyShare.js     # Spoiler-free Daily Challenge result text for the Share button
│   │   └── layouts/
│   │       ├── LayoutGenerators.js   # Pure shape geometry: pendulum, rings, hexagon, spiral, cross, masks
│   │       ├── ShapeGenerator.js     # Generated Flux silhouettes: polar curves on the sphere grid, quality filter
│   │       └── FluxStageGenerator.js # Seeded Flux stages: shape family, difficulty budget, boss core
│   └── ui/
│       ├── CodexView.js      # Illustrated Codex & Guide tab rendering
│       ├── LevelSelectView.js# Campaign chapters, level cards, format badges & < 3★ filter
│       ├── UIManager.js      # HUD updates, accessible modals (focus trap + inert) & input modes
│       └── WorkshopView.js   # Upgrades, in-run Special Ammo refills & achievement progress bars
├── styles/main.css           # Responsive layout and design tokens
├── eslint.config.js          # ESLint 9 flat configuration
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

The suites in `tests/` cover the game engine, physics, rendering loop, UI helpers, the calibration tooling, and seven repository guards:

- `typography.test.js` rejects typographic look-alikes of ASCII characters (long dashes, curly quotes, ellipsis, special spaces, ligatures) in every text file.
- `pwa.test.js` checks that every file under `src/`, `configs/`, `locales/` and `icons/` is precached by `sw.js`, that `index.html` declares a `Content-Security-Policy`, and that the Service Worker cache version matches `package.json`.
- `onboarding.test.js` checks that every mechanic has a hint in both languages, that a level whose tutorial teaches a mechanic always shows it, and that level 1 shows only the basics.
- `fluxGenerator.test.js` checks that the shape generator yields at least 1,000 distinct shapes, each fitting the board and hanging from its anchors, named in both languages.
- `campaign.test.js` checks that the 800 generated levels are playable boards rebuilt the same from their number, that difficulty climbs from chapter to chapter, that a landmark comes every 10 levels, that each level is named in both languages, and that each one is calibrated for the board it is: a change to the generator, the Flux shapes or the campaign curve fails it until the levels are measured again.
- `world.test.js` checks that every campaign level (generated ones included), Flux stage (1 to 60) and the Survival grid fit between the walls, and that a world of the design width builds every level at its authored positions.
- `bot.test.js` checks the calibration bots (what a shot is worth, when the arsenal bot plays a special, that the greedy one never does) and the command line of `scripts/calibrate-campaign.mjs`.

The generated levels are calibrated outside CI by two bots (`scripts/bot/CampaignBot.js`):

```bash
node scripts/calibrate-campaign.mjs
```

- the **greedy** bot aims the loaded color where most spheres of that color sit and never plays a special ball. It plays each level 16 times (`calibration` in `configs/campaign.json`); a level it wins less than one game in eight gets extra shots, then another seed, until one passes. A player who ignores special balls can always win.
- the **arsenal** bot reads the aim preview the player sees (what a shot destroys and drops, `src/game/ImpactPreview.js`) for the loaded color and every special ball in stock, and plays a special when it takes off at least 6 spheres and 3 more than the best color shot, or once the shots left no longer outnumber the specials (`calibration.bot.arsenal`). It plays each candidate 16 times too, and a level it wins less than one game in two (`minArsenalWinRate`) also gets extra shots, then another seed, until a candidate passes both floors.

Star thresholds come from the median score of the bot named by `calibration.starPolicy`: three stars at the ratio the 24 authored levels show for that bot (`threeStarMedianFactors`: 1.08 for greedy, 0.79 for arsenal), two stars at 63% of three. The result, with both bots' measures, goes to `configs/campaignTuning.json`; `--from` and `--to` measure a range only, `--workers` sets the number of parallel workers (by default all cores but two), and `--dry-run` prints the measures without writing them. Only a dry run measures an authored level, as it is (`--from 24 --to 24 --dry-run`); a writing run starts on the first generated level.

`tests/browser/smoke.test.js` opens the real page in headless Chromium at the four supported layouts (desktop, portrait tablet, landscape and portrait phones). It fails on any console error, sideways scrolling or clipped control label, checks the layout on level 1 (no special ball) and level 2 (special balls), checks that the level select opens on the chapter of the current level and switches chapters, checks that the Settings, Levels, Workshop and Pause dialogs pause and resume the run, walks through the victory, game over and reload-resume paths, checks that Campaign game over offers no Share while Daily Challenge, Survival and Flux Mode copy their result to the clipboard, and checks that a mouse tremor keeps a keyboard-tuned aim. CI runs it as a separate job.

When adding a runtime file, list it in `PRECACHE_ASSETS` in `sw.js`. When releasing, bump `APP_VERSION` in `sw.js` together with `package.json`.

---

## License

Copyright 2026 Julien Bombled. Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0).
