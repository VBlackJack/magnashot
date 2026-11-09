# Changelog

All notable changes to **MagnaShot** are documented in this file.

## [Unreleased]

## [1.21.0] - 2026-11-09

### Added
- **Pulse: Music and Resonance (`MusicEngine`, `Resonance`, `EnginePulse`, `AudioManager`, `PulseDriver`, `UICalibration`, `RhythmCalibration`, `EngineTurnResolution`, `EngineVersus`, `VersusRules`, `VersusMatch`, `Renderer`, `UIVersus`, `StorageManager`, `StorageView`)**: An original procedural score for the ten modes (own tempo, key and progression each, a variation every eight bars, layers that follow the pressure on the board: Sag level, danger distance, threatening charges). It plays only during a run and fades out on pause, menus, game over and victory; new **Music** and **Music volume** buttons sit next to the Sound button, which still mutes everything. **Resonance**: a shot released within 7 frames of the beat is Resonant, shown by a beat ring around the launcher (solid and thick in the window, thin and dashed outside, fixed in size with only the opacity moving under reduced motion). A Resonant turn that matches or drops multiplies the Overcharge it earned by 1.5; in a Polarity Duel a Resonant shot removes 2 strength from an opposite charge, and the CPU rolls Resonance per tier (Easy 0, Normal 0.35, Hard 0.65) on its own seeded `resonance-bot` stream. The difficulty picker gains a **Resonance** option. Daily (rematches included), Weekly Flux, shared Flux links and Ghost Duels never use Resonance whatever the setting, and the seeded draw counts of every run are unchanged. The beat is the engine frame counter, so a run replays the same way. **Calibrate rhythm** in Settings measures the median distance of eight taps to the pulses (at most 200 ms) and stores an offset that only shifts the judgement. New settings: Music, Music volume, Resonance, rhythm offset.
- **Pulse Tests**: Beat clock, window and offset, Overcharge bonus and whiff, setting off equal to an off-beat shot, competitive modes and draw counts, versus strength loss, CPU roll isolation, beat ring (active only, dashed or solid, reduced motion, high contrast, flash), music driver (start, stop with fade, mute, mode change, intervals), lead board choice and the calibration maths.
- **Browser Smoke Tests (Pulse)**: At the five layouts, the Music, Music volume, Resonance and Calibrate rhythm settings are present and fit, the calibration dialog opens over Settings and Escape closes only it, a calibration run saves the offset of the taps and Reset clears it, and the beat ring is drawn in the Campaign and hidden in the Daily.
- **Polarity Duel Polish (`UIVersus`, `VersusHud`, `UIGamepad`, `GamepadInput`, `StorageManager`, `StorageView`)**: The first duel on a device opens a three-step tutorial (charges, polarity guard, field pulse) that holds the match; it is a dialog you can skip with the button, Escape or the controller's back button, and it is stored as seen so it never returns. A controller shakes when a charge lands on your board, when a field pulse hits you and when you lose a round, through a new **Vibration** option in the Controller row of Settings (on by default, silent with reduced motion or on a pad without an actuator). Each board already plays on its own side of the stereo field; a test now covers it.
- **Duel Calibration Gate (`scripts/calibrate-versus.mjs`, `npm run calibrate:versus`)**: Plays the CPU tiers against each other over seeded matches and exits with an error when Hard beats Easy in fewer than 80% of the games, Normal beats Easy in fewer than 65%, or the average number of field pulses per round leaves 1.5 to 3.5 (thresholds in `versus.calibration`). CI runs it, with the slow strength test, in a separate job.
- **Polarity Duel, Two Players on One Device (`LocalInput`, `UIVersusLocal`, `UIVersus`, `VersusHud`, `UIGamepad`, `UIInputBindings`, `UIStats`, `VersusMatch`, `GamepadInput`, `CanvasInput`, `StorageManager`)**: A "2 players (same device)" entry under the difficulty picker, shown on wide screens only, opens a lobby where each player picks a device: the left half of the keyboard (`A` `D` aim, `W` shoot, `S` swap, `Q` polarity, `E` special) with an optional mouse, the right half (arrows, `Enter`, `Down`, `/`, `.`), touch (each board follows its own finger), or a controller that joins with its bottom face button. `W` and `ArrowUp` are quick join keys; key names follow the keyboard layout. Each player has a handicap that slows the charges rising on their board. The match is the same best of 3, with both boards human: the aim follows the keys held down, Start or Select pauses, a controller that is lost pauses the match until another one takes its place, and a window too small for two boards pauses it with an explanation. HUDs, canvases and announcements say "Player 1" and "Player 2" with a round and a square badge, and the result card names the winner, with Play again, Change players and Back to menu (no Share, no CPU tier; the main button ignores presses for a short guard time). A finished match only counts in a new "2P matches" line of My stats.
- **Per-Pad Controller Reading (`GamepadInput`, `UIGamepad`)**: The reader can follow several pads at once, each with its own edges, instead of merging them; the single pad path is unchanged.
- **Per-Canvas Pointer Ownership (`CanvasInput`)**: A canvas can own one pointer from press to release and ignore the others, so two fingers on two boards both work.
- **Magnetar Bosses (`MagnetarRules`, `EngineMagnetar`, `PhysicsWorld`, `EngineVersus`, `Renderer`, `UIHudRefresh`, `CodexView`)**: The boss of every Boss Rush wave and of every fifth Flux stage becomes a Magnetar, a colourless field core that matches, bombs, lightning, rockets and anvils cannot break. Its health is its Moorings, the anchor spheres still holding it up through bonds; breaking them (or a full Overcharge in Boss Rush, which snaps one) makes it fall in an avalanche, the only kill. It arms one of four patterns a turn ahead (Reverse field, Undertow, Regrow, Barrage), with more patterns and a shorter rest at higher tiers; each is shown by a badge on the board, a HUD chip with a glyph and words, and a polite announcement. In Boss Rush the HUD shows Moorings in the shots slot; on Flux boss stages the shots count stays and the banner names the Moorings. The Mooring count follows the anchors that really hold the Magnetar (reached through bonds without passing another anchor); Regrow never adds anchors. The Codex gains a Magnetar patterns section, a proximity hint teaches it, and two achievement families (Magnetars Grounded, Magnetar Landslide) track falls. Regrow searches outer shells of slots so it still acts on a crowded Boss Rush board. Campaign landmark Boss Cores are unchanged.
- **Browser Smoke Tests (Magnetar)**: At the five layouts, a Boss Rush wave 3 Magnetar warning shows its HUD chip without overlap and without adding a HUD column, and the Codex lists the four patterns.
- **Browser Smoke Tests**: The lobby with the quick join keys, two stubbed controllers joining and a lost one holding the match, a scripted two-player round to the result card, a window that shrinks below two boards, and the entry hidden at the phone layouts.

### Changed
- **Ghost Duel Content Version Per Mode (`GhostCodec`, `EngineGhostDuel`, `UIGhostDuel`, `ghostDuel.contentVersion`)**: The content version is now a per-mode map (`daily`: 1, `flux`: 2), so only Flux links made before the Magnetar bosses show the "another version" notice; Daily content did not change and its old links stay quiet. Old links still decode.

## [1.20.0] - 2026-11-08

### Added
- **Polarity Duel (`VersusRules`, `EngineVersus`, `VersusMatch`, `VersusHud`, `UIVersus`, `Renderer`, `StorageManager`)**: A head-to-head mode against the CPU on two Classic-style boards, best of three rounds, opened at campaign level 6 from its card in the Level Select. Three difficulties (Easy, Normal, Hard; Hard opens after a win against Normal) with their own records, shown in My stats. A shot that makes spheres fall sends charged spheres to the other board; they rise from the defender's danger line and snap into the cluster unless neutralised. A shot of the opposite polarity shatters a charge (a strong one takes two hits), the same polarity bounces off, bombs and lightning clear every charge they reach, and every 3 charges neutralised grants a special sphere. Neutralising fills the Overcharge meter, and a full meter fires a field pulse that lowers the opponent's anchor rail. A round is lost when a board crosses its danger line (a double loss replays it) and sudden death lowers both rails every 20 seconds after 3 minutes. The shot polarity is drawn on the launcher spheres and the Polarity button, and the aim preview marks what the shot would do to the first charge it crosses (a crack to shatter, a rebound arrow to bounce). Two boards side by side on wide screens, a mini-view of the CPU board on phones; keyboard, pointer, touch and controller all work. The result card and the share text count the whole match.
- **Strength Test (`npm run test:slow`)**: Plays 50 seeded Hard against Easy matches and requires at least 80% wins for Hard.
- **Browser Smoke Tests**: The duel at the five layouts (split or mini-view, no overflow), pause, quit, and the round result.

### Changed
- **Multi-Board Foundation (`GameLoop`, `GameEngine`, `Renderer`, `UIManager`, `StorageView`, `AudioChannel`, `CanvasInput`, `BotBrain`, `EngineVersus`, `VersusMatch`)**: Internal groundwork for a future two-board mode, with no gameplay change. The game loop can step several boards in lockstep, an engine can run in a read-only "versus" role with its own storage view and audio channel, the canvas input and the bot decisions move out of `main.js` and the bot script into shared modules, the renderer gains a lightweight mode and a dispose step, and a hidden seeded board plus a headless CPU-versus-CPU match back new determinism, storage and performance tests. Nothing is reachable from the interface yet.

## [1.19.0] - 2026-11-08

### Added
- **Controller Support (`GamepadInput`, `UIGamepad`, `GameLoop`, `UIInputBindings`, `StorageManager`)**: Play with any gamepad that uses the standard layout. The left stick aims (right stick for fine aim, left trigger for precision, d-pad for tiny steps), the bottom face button or right trigger shoots, the left and top face buttons swap and flip polarity, the right face button unequips a Special Sphere, the bumpers cycle the stocked ones, Start pauses and Select opens the menu. In dialogs and the menu the d-pad or left stick moves focus between controls, the bottom face button activates, the right face button goes back and the bumpers switch tabs. The game loop gains a `beforeFrame` hook for polling and the Escape chain is extracted into `handleBackAction`, shared with the pad. Pad activity switches the hints to generic controller glyphs (no brand artwork) and hides the key hints; a connection toast, a live region message and a pause on disconnect are included. A Controller row in Settings sets the enabled state, the stick deadzone, the aim speed and the horizontal inversion. Keyboard, mouse and touch are unchanged.
- **Browser Smoke Tests**: A stubbed pad shoots, opens Pause and drives its dialog on desktop and portrait phone, and the controller hints fit all five layouts without overflow.

## [1.18.0] - 2026-11-08

### Added
- **Ghost Duels (`GhostCodec`, `GhostDuel`, `EngineGhostDuel`, `UIGhostDuel`, `StorageManager`)**: Race a friend's run on the same board. The Share result of a Daily or Flux run now ends with a challenge link (`?duel=<code>`, next to `?flux=<seed>` for Flux) that carries your score after each shot and never your inputs, in about 600 characters. Opening a link shows a Duel card and nothing starts until the player accepts (a saved run asks for confirmation first, a fresh profile unlocks Flux as a shared seed link does). Works on today's Daily, on any Daily of the last 30 days as a rematch (same board, no first-play bonus, no streak, no Daily record) and on any Flux seed, Weekly Flux included. Links are unsigned and treated as hostile input: strict canonical decoding, size and charset checks before decoding, a checksum, caps, and an explanatory card for a damaged, too old, not yet released or newer-version link.
- **Rival Badge and Result**: A live badge in the HUD (`+1,240 vs Sam`, `-320 vs Sam`, `= Sam`, with `(final)` after their last shot) takes the place of the best-run marker, with a sentence label, a forced-colors border and no pulse under reduced motion. Lead changes, the end of the rival's run and passing their final score are announced once per shot at most, with hysteresis. The game over states the result and Share becomes "Share challenge".
- **Duel Name and History**: An optional duel name in Settings (1 to 12 letters, digits and spaces, stored locally) and a Duels section in My stats with the last 10 duels and the won and lost record. Friendly rivalry only: no leaderboard, no coins or achievements.
- **Browser Smoke Tests**: Duel link on a fresh profile and over a saved run, a damaged link, a past Daily rematch without bonus, the game over result and the challenge link, and the unchanged HUD columns at all five layouts.

## [1.17.0] - 2026-11-08

### Added
- **Sag Meter (`SagMeter`, `EngineTurnResolution`, `EngineRoundFlow`, `Renderer`, `UIHudRefresh`)**: Survival, the Daily Challenge and Purist show how close the cluster is to sinking. Every shot that removes nothing fills one segment, a match leaves the meter as it is, and an avalanche caused by your shot that drops four or more spheres lifts it by one (three or more, up to two, in Purist); chain-reaction and in-flight bond-break avalanches do not drain, and a no-match shot that still causes an avalanche no longer counts as a miss. A full meter drops the cluster one step and empties. The HUD box (the former "Next Wave" box, same grid) carries a segmented `role="meter"` with a spoken value, a gauge is drawn beside the launcher, the warning (amber, dashed outline) comes one miss before the drop and is announced once per cycle, and the drop has a creak, a shake (none under reduced motion), a floating text and haptics. Forced colors and reduced motion are handled.
- **Purist Mode (`EngineModes`, `StorageManager`, `DailyShare`, `UIManager`)**: Pure rules on a fixed ceiling: stages from a seeded stream, 6 rows of 4 colors growing to 9 rows and 6 colors, a fully anchored top row, no special spheres, no Workshop upgrades, no tilt and no shot budget. Misses lower the rail one step; clearing the board pays a stage bonus and starts the next stage. It opens at campaign level 4 (a save from before the update shows it as "New"), keeps its own records (best score and best stage), and its Share result lists the stage, the score and the rail drops. Its card is the first of the arcade strip in the Level Select.
- **Purist Calibration (`scripts/calibrate-classic.mjs`, `scripts/bot/CampaignBot.js`)**: An offline report of how often the greedy bot clears stage 1 and reaches stage 3 or more.
- **Save Schema 4 (`StorageManager`)**: Migration 4 marks a mode introduced by an update as "New" for players with progress, once and without downgrading anything.

### Changed
- **One Clock for Waves (`EngineBoard`, `EngineTurnResolution`, `RunSnapshot`)**: The hidden `shotsUntilWave` counter of Survival and the Daily Challenge is replaced by the Sag meter (size 5, same rules for frozen turns and matches). The easing is new: an avalanche caused by your shot that drops four or more spheres drains one segment (avalanches from chain reactions or from bonds that break mid-flight do not), and a shot that matches nothing but still causes an avalanche no longer counts as a miss. Runs saved by an earlier version restore their position (`sagLevel` is derived from `shotsUntilWave`).
- **Daily Across the Update**: A Daily Challenge played across this update can differ from one played on the previous version, because avalanches now drain the meter. Seeds, boards and launcher colors are unchanged, and two runs on the same version stay identical.
- **Cluster Step (`EngineRoundFlow`)**: The shift of the cluster by one row is shared by the wave spawn and the Purist rail drop, with no change to wave positions.
- **Docs**: README and README.fr describe the Sag meter, Purist and the new files and tests.

## [1.16.0] - 2026-11-08

### Added
- **Progressive Mode Unlocks (`ModeUnlocks`, `StorageManager`, `UIHudRefresh`)**: New players start with Campaign and the Daily Challenge and unlock the other modes by clearing campaign levels: Survival at 3, Puzzle at 5, Blitz at 7, Flux at 8, Cascade at 10 and Boss Rush at 12. Locked menu buttons stay focusable, say which level opens them, and a newly unlocked mode is marked "New" and announced on the victory screen. Shared Flux links always work and unlock Flux.
- **Weekly Flux (`WeeklyFlux`, `EngineProgress`)**: A Flux run on one seed per ISO week for every player, a one-time `40 ⬡` bonus per week paid on the first start of the week's seed by any path (never on restart or resume), a weekly best shown in the menu, and a Weekly Flux header in the shared result.
- **My Stats Dialog (`UIStats`, `PlayerStats`)**: An overview of play time, shots, runs and records per mode, a Daily history of the last 60 days, and a Copy my stats button that builds an anonymous text. Statistics are stored on the device only.
- **Per-Shot Score Timelines (`ShotTimeline`)**: The best Daily and Weekly Flux runs keep a compact score timeline, one point per shot.
- **Browser Smoke Coverage**: `tests/browser/smoke.test.js` seeds the profile storage and checks locked modes at every layout, existing-player migration, shared Flux links, the Daily history, Copy my stats and the Weekly Flux seed.

### Changed
- **Save Schema 3 (`StorageManager`)**: Migration 2 grandfathers existing players so they keep every mode, and migration 3 seeds the Daily history from the stored Daily best. Rolling back to an older build keeps the save working.
- **Complete Timelines Win Ties (`StorageManager`)**: At an equal score, a complete shot timeline replaces a partial one in the Daily history and the weekly best.
- **Review Fixes (`PlayerStats`, `StorageManager`, `UIInputBindings`, `UIStats`)**: Copy my stats omits the best of a mode with no record; an older week never overwrites a newer weekly best and only the current week lights the Weekly button; the menu judges locked modes on live storage and refreshes locks when it opens; the Daily history table keeps explicit table roles on narrow screens; a mode with a record of its own stays unlocked after a rollback and update.
- **Docs**: README and README.fr describe the unlocks, Weekly Flux, My stats and the new files.

## [1.15.0] - 2026-11-08

### Added
- **CI-Gated GitHub Pages Deploy (`.github/workflows/ci.yml`, `scripts/pages-artifact.mjs`)**: A `deploy` job publishes the game to GitHub Pages only after the test and browser jobs pass on `master` (or on a manual run). It uploads a `_site/` artifact holding the runtime files and nothing else.
- **Release Script (`scripts/release.mjs`)**: `npm run release -- <patch|minor|major|X.Y.Z> [--dry-run]` bumps `package.json`, `package-lock.json` and `APP_VERSION` in `sw.js`, and promotes the CHANGELOG Unreleased section. It never commits, tags or pushes.
- **Versioned Save Schema (`StorageManager`)**: Saves carry a `schema_version` key and are upgraded by ordered, idempotent migrations; version 1 is the former merge of pre-rename saves. Existing progress is kept.
- **Assists in Shared Flux Results (`DailyShare`)**: A shared Flux result lists the assists behind the run (Workshop levels, ammo bought, continue) when there were any.

### Changed
- **Daily Challenge Is the Same Game for Everyone (`GameEngine`)**: The Daily Challenge no longer applies Workshop upgrades and no longer allows buying special ammo in the shop, so every player faces the same rules; the intro line and the Workshop note say so.
- **Same Launcher Colours on a Seed (`EngineLauncher`)**: The launcher colour queue and random special sphere grants of Daily and Flux runs now come from the seed, so the launcher colour rolls are the same for every player on a seed. The pick follows the colours left on the board, so two players who cleared different colours can still see different launcher colours.
- **Engine and Interface Split Into Domain Modules (`GameEngine`, `UIManager`, `src/core/installMethods.js`)**: The two large classes now install their methods from `src/game/Engine*.js` and `src/ui/UI*.js` modules. Behaviour is unchanged; `tests/engineApi.test.js` and `tests/uiApi.test.js` guard the prototype API.
- **Docs**: README and README.fr describe the deploy pipeline, the release script, the save schema, the fairness rules and the new file layout.

## [1.14.1] - 2026-11-08

### Fixed
- **Progress Saved Before v1.9.1 Recovered (`StorageManager.migrateLegacyKeys`, `configs/game.json`)**: The v1.9.1 rebrand renamed the `localStorage` prefix from `flux_spheres_v1_` to `magnashot_v1_` without carrying saves over, so earlier players started from level 1. On first launch, the legacy save is now merged into the current one: the unlocked level keeps the higher of the two, level stats keep the best score and stars per level, and every other key is copied only when no newer value exists. A stale run in progress is not carried over, legacy keys are left in place, and a marker key keeps the merge to a single pass.
- **Shared Flux Seeds and Daily Waves Are the Same for Everyone (`GameEngine.withScopedRandom`)**: Board colours and modifiers of each Flux stage now come from a stream derived from the seed and the stage number, and each Daily Challenge wave from the seed and the wave number. Previously they shared the run stream with shots and falling spheres, so two players on the same `?flux=` link or the same Daily saw different boards from stage or wave 2 onward. Boards built from existing seeds differ from those of earlier versions; saved runs still restore.
- **Victory With a Shot Still in Flight (`GameEngine`)**: When a bond break emptied the board while a shot was in the air, Campaign, Puzzle and Flux declared the round over with the shot frozen mid-flight. The round now ends once the shot has resolved.
- **Freeze Core Duration (`GameEngine`, `RunSnapshot`)**: A Freeze Core set off by a chain reaction between turns froze the board one turn longer than one destroyed during a shot. Both now last `freezeTurns`, and the state is kept in the run snapshot.
- **Brush Scoring (`SpecialBallController.triggerBrush`)**: The Brush no longer pays points and Overcharge for spheres that already had the target colour, matching the Paint Core.
- **Aim Preview on Shielded Boss Cores (`ImpactPreview`)**: Bomb, Lightning and Anvil previews no longer show a Boss Core with shields left as destroyed; it only loses one shield.
- **Screen Shake Ghosting (`Renderer.render`)**: The frame is now cleared before the shake offset is applied, so no strip of the previous frame shows at the board edges.
- **Focus After Closing the Last Dialog (`UIManager.syncModalInertState`)**: When no element was focused before a dialog opened (for example Pause by Escape, then Levels, then Resume), focus now returns to the game canvas instead of dropping to the page.
- **Puzzle Queue Special Spheres (`GameEngine.takeUpcomingBall`)**: Queue entries beyond the second keep their special type.
- **Run Snapshot Validation (`RunSnapshot`)**: The special inventory and bonds of a saved run are type-checked on restore.

### Changed
- **Number Formatting (`UIManager`, `LevelSelectView`)**: Badge counts and chapter numbers go through the locale number formatter.
- **Platform Support Tolerance (`configs/physics.json`)**: Moved from code to `simulation.platformSupportTolerancePx`.
- **Docs**: README states ESLint 10 and that share text covers every non-campaign mode; `package-lock.json` root version aligned to 1.14.0.

## [1.14.0] - 2026-11-08

### Added
- **Daily Challenge Mutators (`Constants`, `GameEngine`, `configs/game.json`, `locales`)**: Added three new rotating Daily Challenge mutators: *Portal Matrix* (`portalMatrix`, linked Quantum Portals warping shots past the central rotor, `+25%` score), *Bumper Pinball* (`bumperPinball`, twin Energy Bumpers flanking the rotor for bank shots, `+20%` score), and *Cryo Surge* (`cryoSurge`, extra Freeze and Lightning Cores in the cluster, `+25%` score), all documented in the Codex (#53).
- **Daily Challenge Mutator Intro Banner (`GameEngine.buildDailyIntro`, `UIManager.buildLevelIntroText`, `UIManager.updateLevelIntro`)**: The first play of a Daily Challenge seed in a session now shows a non-blocking banner naming the active mutator and its Codex rule, announced once to screen readers and dismissed on the first shot or via its close button (#53).
- **Puzzle Mode Stages 6 to 10 (`configs/game.json`, `GameEngine.startPuzzleMode`)**: Expanded Puzzle Mode from 5 to 10 deterministic trick-shot stages (`P1` to `P10`) covering Quantum Portals, Quantum Locks + Laser Barriers, Paint Core + Rust, Dormant Barrel chains, and Inertia Rotor + Chained + Rocket, with rotor anchor attachment (`pivotIndex`) (#53).
- **Collector Magnet Workshop Upgrade (`configs/game.json`, `GameEngine`, `Renderer.drawCollectorBins`, `WorkshopView`)**: Added a fifth permanent Workshop upgrade, *Collector Magnet* (`collectorMagnet`), adding `+15` bonus points and `+1%` Overcharge per rank to the five bottom avalanche collector bins and updating the live `+XX` slot labels on the board (#53).
- **Completed Chapter Badge in Level Select (`LevelSelectView.renderLevelChapters`, `styles/main.css`, `locales`)**: Chapters where every star has been earned now display a gold completion badge and border (`.level-chapter.completed`) with a dedicated accessible label (#53).

### Fixed
- **Resume Current Level From Pause -> Level Select (`UIManager.js`)**: Clicking the primary Resume button in Level Select when opened from the Pause modal now unpauses the engine before closing the overlay so the Pause modal does not reappear and keyboard focus returns to the canvas (#48).
- **Paint Core Blast Radius Upgrade Scaling (`GameEngine.destroyClusterBall`, `locales`)**: Destroying a cluster Paint Core now passes `getBlastRadiusMultiplier()` to `triggerPaint`, matching Freeze Core, Dormant Bomb, and the Brush special sphere (#48).
- **Puzzle Stage Frame-0 Anchor Connectivity (`configs/game.json`)**: Tightened horizontal spacing on Puzzle Stage 1 so all six spheres form initial magnetic bonds within the bond creation distance at frame 0 (#53).

## [1.13.0] - 2026-11-05

### Added
- **Flux Perks (`FluxPerkView`, `UIManager`, `configs/flux.json`)**: After every third cleared Flux shape the run pauses on a choice of three perks among six: Reserve, Refill, Blast, Surge, Arsenal and Golden, each stackable up to three times. Pick a card by tap, click, Enter or the `1` to `3` keys. Escape still pauses and Resume shows the choice again. Held perks appear as chips in the HUD and the slide-in menu, the pick is announced to screen readers, and restarting or switching mode past the first shape always asks for confirmation.
- **First-Session Onboarding (`UIManager`, `GameEngine`, `Discovery`, `configs`)**: Polarity and each special sphere now get their own hint, naming the control (the 🧲 button or the special slot), which pulses while the hint is up (an outline replaces the animation under reduced motion). Hints are kept until dismissed or until the mechanic is used, with at most one per turn. A **?** button in the HUD replays the current level's hints. The first play of a level shows a non-blocking objective banner (name, shots, featured mechanic) that closes on its button or on the first shot and is announced once. Levels 2 to 4 introduce one new special sphere each, and level 3 adds a bank-shot hint. The objective banner only shows when no hint is up, and the **?** button only when the board has a hint beyond the basics.
- **Near-Miss and Best-Run Marker (`UIManager`, `GameEngine`, `RunSnapshot`, `index.html`, `locales`)**: The Game Over modal says how far the run fell short of the mode's best ("2 shapes short of your best", waves, or points) and announces it with the round result. It only appears when the gap is at most `scoring.nearMissMaxGapRatio` (0.5) of the best, and sits with the stats, never next to the continue button. In Flux and Boss Rush, a compact "Best" marker in the HUD badges row shows the record the run started against (score modes already show theirs). That baseline is saved in the run snapshot, so a reloaded run does not compare against itself.
- **Forgiving Daily Streak (`StorageManager`, `UIManager`, `configs/game.json`, `locales`)**: One missed day no longer resets the daily streak, provided the grace day was not used in the previous 7 days (`daily.streakGraceDays` = 1, `daily.streakGraceWindowDays` = 7). Missing two days in a row, or missing a day again within 7 days of using the grace, resets the streak to 1 as before. The Daily game over line and the Daily button tooltip say, calmly, whether the grace day is available, that it was used (only on the day it was), or when it comes back.
- **Tiered Achievements (`WorkshopView`, `styles/main.css`, `locales`)**: Achievements are grouped by family with Bronze, Silver and Gold badges and a progress bar toward the next tier. Existing achievements are the Bronze tiers and two new families cover Flux shapes and Boss Rush waves. Tiers of per-run record families (combo, avalanche, Boss Cores in a single run, shots left, survival waves, Flux shapes, Boss Rush waves) count from now on, so a record set before the update pays nothing and its card says to reach it again in a run. The star tiers are cumulative: a player whose total already passes Silver or Gold gets them on their next victory. Tiers unlocked together show one popup and one announcement, and descriptions take their goal from the config.

### Changed
- **Early Levels Retuned (`configs/levels.json`)**: Levels 2 to 4 retuned: fewer specials, level 2 has 48 shots, star thresholds recalibrated. A level 2 to 4 run saved before the update resumes on its old board.
- **Polarity and Sphere Wording (`locales`)**: The polarity Codex entry and hints now say what the flip does (spheres pull your shot the other way; attractors and repulsors are unchanged). Player-facing text says "sphere" ("sphère") instead of "ball" ("bille"), and the mode selector tooltip says "Tap" on touch.

### Fixed
- **Special Ammo During a Shot or Transition (`GameEngine`, `UIManager`, `WorkshopView`)**: Buying special ammo while a shot was in flight or the Flux stage was changing could lose the purchase on reload. The buy buttons now say why they wait (the reason is shown in the button label and tooltip) until the run can be saved, and the `startingShots` upgrade is refused the same way while the run cannot be saved; when allowed, its bonus applies at once and the run is stored.
- **Boss Rush Wave Change (`GameEngine`, `PhysicsWorld`)**: Clearing a wave no longer wipes the falling spheres, and the next wave waits until no projectile is in flight.
- **Overcharge Loop (`GameEngine.addOvercharge`)**: An overcharge loop that outlives its wave no longer strikes the next boss; it still grants its special balls.
- **Tilt in Daily and Shared Flux Runs (`GameEngine`, `UIManager`)**: Tilt is forced off in Daily runs and shared-seed Flux runs so every player gets the same board, and the tilt toggle shows as disabled with a reason without changing the saved preference.
- **Numpad Enter (`UIManager.handleKeyDown`)**: Numpad Enter now shoots exactly like Enter, with the same held-key guard.
- **Desktop and Landscape Phone HUD Grid (`styles/main.css`)**: The seven-column grid used when the HUD fullscreen button is present also overrode the wide-desktop (three columns) and landscape phone (four columns) layouts, where that button is not shown. On desktop the round stats were squeezed to the left, "Shots left" wrapped onto two lines and its value sat lower than the score. The rule now has the lowest specificity, so each layout keeps its own grid.
- **Earned and Empty Stars (`UIManager.renderStarGlyphs`)**: In the HUD and the slide-in menu, empty stars are now drawn dimmed, one span per star, so one earned star no longer reads as three at HUD size.
- **Desktop Special Balls Panel**: The panel hugs its content instead of stretching into a tall empty box above Polarity and Swap, and scrolls if it would reach them.

## [1.12.1] - 2026-11-04

### Fixed
- **Boss Rush Freeze on Overcharge Strike (`GameEngine.addOvercharge`, `PhysicsWorld.stepDroppingBalls`)**: An Overcharge strike that destroyed the Titan from inside a physics step (falling balls reaching the collector bin or a singularity, or an anvil crush) respawned the wave while the dropping-ball loop was still running, which threw and stopped the game loop. The wave change is now deferred until the step ends, `PhysicsWorld` stops iterating once the world is cleared, and the new wave refreshes its discovery hints.
- **Shared Flux Links Keep Saved Runs (`main.js`, `UIManager.requestDestructiveAction`)**: Opening a `?flux=` link while another run was saved erased that run without asking. The saved run is now restored and a confirmation is required before the shared seed replaces it.
- **Menu and Dialogs (`UIManager.handleKeyDown`, `closeOverlayModal`, `dismissConfirm`)**: Gameplay shortcuts are ignored while the menu is open, Escape closes a dialog before the menu behind it, and closing a dialog over the menu no longer resumes the run.
- **Service Worker Cache Cleanup (`sw.js`)**: Activation now deletes only this game's own caches instead of every cache on the shared origin, and runtime entries are stored without their query string.
- **Fullscreen in the Installed App (`UIManager.setupFullscreenControl`)**: The fullscreen controls are hidden when the app already runs in `display-mode: fullscreen`.
- **Animation Speed (`GameEngine`, `UIManager.updateAnimSpeedButton`)**: Slower animation speeds no longer lengthen special-ball slow motion, so Blitz timing is the same at every speed, and the speed label follows the locale number format (`1,5x` in French).
- **Run Snapshot After Falling Balls (`GameEngine.update`)**: The run is saved again once the last falling ball is gone, so collector and singularity rewards survive a reload.
- **Storage Guards (`StorageManager`)**: Non-finite coin amounts are ignored instead of resetting the balance, and the Endless high score can no longer read back negative.
- **Menu Star Progress for Screen Readers (`UIManager.syncDrawerStats`)**: The star glyphs are hidden from assistive technology and the star count is announced instead.

### Changed
- **Effect Caps (`ParticleSystem`, `configs/game.json`)**: Particles, shattering spheres and explosion puffs are capped (`juice.particles.maxParticles`, `maxShatteringBalls`, `maxExplosions`) to keep large avalanches smooth on mobile, and pooled effects reuse their crack and ray arrays.
- **Renderer (`Renderer.js`)**: Cached the slow-motion vignette and shatter core gradients, removed per-frame allocations, and dropped literal fallbacks that disagreed with the configuration.
- **Security and CI (`index.html`, `.github/workflows/ci.yml`, `.github/dependabot.yml`)**: Removed `'unsafe-inline'` from the style CSP, pinned GitHub Actions to commit SHAs with Dependabot updates, and added an `npm audit` step.

### Removed
- Unused configuration keys (`bossRush.overchargeShieldDamage`, `defaults.reducedMotionMediaQuery`, `defaults.drawerMediaQuery`), the dead drawer breakpoint branch, the `resolveVictoryNextAction` wrapper, `MATH_CONSTANTS.DEG_TO_RAD` and the unused `.pointer-only` selector.

## [1.12.0] - 2026-11-04

### Added
- **Portrait Mobile HUD & Settings Fullscreen Toggle (`#btn-fullscreen-hud`, `#btn-fullscreen`, `UIManager.setupFullscreenControl`, `manifest.webmanifest`)**: Added a 1-tap Fullscreen button (`⛶`, `44x44 px`) directly on the top HUD bar in portrait mobile and tablet layouts (`#btn-fullscreen-hud`), paired with a synchronized Fullscreen toggle (`#btn-fullscreen`) in `#modal-settings` across all viewports. Uses the Fullscreen API (`requestFullscreen({ navigationUI: 'hide' })` with WebKit fallback and `fullscreenchange` synchronization) and adds `"display_override": ["fullscreen", "standalone"]` to the PWA manifest.

## [1.11.0] - 2026-11-04

### Added
- **Animation & Explosion Speed Setting (`#btn-anim-speed`, `ParticleSystem.setAnimationSpeed`, `GameEngine.setAnimationSpeed`, `StorageManager.getAnimationSpeed`)**: Added a persistent Animation Speed control in `#modal-settings` cycling through `0.5x`, `1x`, `1.5x`, and `2x` (`magnashot_v1_anim_speed`). Scales the playback speed of fireball explosions, shattering spheres, concentric shockwaves, radial flashes, lightning arcs, particle bursts, floating texts, cluster impact waves, and special-ball slow-motion windows (`specialSlowMoFrames`) with exponential drag scaling (`Math.pow(drag, speed)`) while keeping projectile and cluster physics untouched.

## [1.10.1] - 2026-11-04

### Fixed
- **Drawer Star Progress Text (`UIManager.syncDrawerStats`)**: Built `#drawer-star-progress` from `#hud-star-glyphs` and `#hud-star-next` instead of `#hud-star-progress.textContent` so the `.visually-hidden` `#hud-star-count` screen-reader string is never concatenated onto the visible star glyphs (`★☆☆ • Next: 6,900`).
- **Desktop HUD Column Layout & Drawer Stats Scoping (`styles/main.css`)**: Placed `#btn-menu` (`☰`) and `#hud-mode-banner` side by side on the top row of the desktop HUD card while keeping equal `50%` columns for the 4 stat boxes and `align-self: start` on `.hud-bar`, scoped `.drawer-stats` to portrait phones (`max-width: 680px`) where the compact HUD hides those stats, hid `.hud-badges-row` when empty, and balanced mode button wrapping (`text-wrap: balance`, `--drawer-width: min(340px, 86vw)`).

## [1.10.0] - 2026-11-04

### Changed
- **Unified Slide-In Burger Menu Across All Viewports (`#app-drawer`, `#btn-menu`, `UIManager.isDrawerLayout`, `styles/main.css`)**: Replaced the 12-button persistent top bar on desktop, tablet, and landscape phone with the slide-in lateral burger drawer (`☰` `#btn-menu`) across all screen sizes, keeping the main game screen focused on the HUD, arena board, and aiming controls while organizing the drawer into two labelled sections (*Game Modes* and *Current Round*) with live summary stats.
- **Deduplicated Arcade Mode Navigation (`index.html`, `UIManager.js`)**: Removed the 4 duplicate Arcade buttons (*Puzzle*, *Blitz 90s*, *Boss Rush*, *Cascade*) from the main navigation drawer so the drawer holds the 4 primary entries (*Levels*, *Survival*, *Daily Challenge*, *Flux Mode*) while the 4 Arcade modes live as rich cards with descriptions, personal records, and the `P1`-`P5` stage selector inside `#modal-levels`.
- **Streamlined Pause Modal (`#modal-pause`, `#btn-settings-pause`, `UIManager.closeOverlayModal`)**: Removed the 7 duplicated setting toggle buttons from `#modal-pause` and replaced them with a single **⚙ Settings** button (`#btn-settings-pause`) that opens `#modal-settings` and restores focus to `#btn-settings-pause` in `#modal-pause` when closed.
- **Interactive HUD Mode Selector Pill (`.hud-mode-banner`)**: Styled `#hud-mode-banner` as an interactive pill button with a raised surface, subtle border, hover elevation, and a `▾` chevron indicator so players immediately see it opens the Modes & Level Select dialog (`#modal-levels`).

## [1.9.9] - 2026-11-04

### Fixed
- **Windows Desktop Animation Setting vs. Game VFX (`StorageManager.getReducedMotion`)**: Stopped auto-enabling `reducedMotion = true` from `window.matchMedia('(prefers-reduced-motion: reduce)')` when the player has never toggled Reduced Motion in the in-game Settings. On Windows 10/11, disabling OS desktop window animations (`SPI_GETCLIENTAREAANIMATION = False` / `MinAnimate = 0`) causes browsers to report `prefers-reduced-motion: reduce`, which previously silenced every particle, shockwave, lightning bolt, fireball explosion, shattering sphere, and slow-motion effect by default.

## [1.9.8] - 2026-11-04

### Added
- **Shattering & Swell-Pop Sphere Destruction (`ParticleSystem.spawnShatterBall`, `Renderer.drawShatteringBalls`, `GameEngine.destroyClusterBall`)**: Destroyed spheres no longer vanish invisibly on frame 0; while physics removal stays immediate and deterministic, each destroyed sphere spawns an object-pooled shattering animation that gets knocked radially outward from the blast origin, swells to `1.46x` scale, glows white-hot from within, fractures along jagged radial crack lines, and bursts into a secondary fireball puff and spark shower during the slow-motion window.
- **Multi-Stage Fireball Explosions, Starburst Rays & Slow-Motion Vignette (`ParticleSystem.spawnExplosion`, `Renderer.drawParticles`, `Renderer.drawSlowMoOverlay`)**:
  - Added multi-phase fireball cloud puffs transitioning from white-hot and yellow (`#fef08a`) to fiery orange (`#f97316`), crimson (`#dc2626`), and rising dark smoke, paired with a 12-ray additive starburst core and a brief full-arena impact flash (`screenFlash`).
  - Added a colored perimeter slow-motion vignette (`drawSlowMoOverlay`, `specialSlowMoColor`) while `specialSlowMoFrames > 0`, and velocity-stretched glowing shrapnel tails with white-hot inner cores on fast burst particles.

### Fixed
- **Hit-Stop vs. Slow-Motion Particle Ordering (`ParticleSystem.updateShakeOnly`, `GameEngine.update`)**: Decayed only screen shake during `hitStopFrames > 0` instead of advancing particle, explosion, and shattering-sphere ages at `1.0x` speed during the hit-stop freeze, ensuring 100% of the detonation and sphere-shattering animation plays out during the `0.18x - 0.24x` slow-motion window.

## [1.9.7] - 2026-11-04

### Added
- **Cinematic Slow-Motion Detonations (`GameEngine.triggerSpecialSlowMo`, `getTimeScale`)**: Added config-driven post-hit-stop time dilation (`slowMoFrames`, `slowMoTimeScale`, `detonationHoldRatio`) for explosive and kinetic special impacts (*Bomb*, *Lightning*, *Anvil*, *Rocket*, *Prism*, *Dormant Barrel*, *Lightning Core*, and *Boss Core* destruction), smoothly easing time back to `1.0x` while bypassed when `reducedMotion` is enabled.
- **Multi-Layer Special Ball Detonation Effects (`SpecialBallController.js`, `ParticleSystem.js`, `Renderer.js`)**:
  - Added object-pooled radial detonation flashes (`spawnFlash`) with white-hot core gradients and sub-frame `alpha` interpolation (`prevRadius`, `prevAlpha`).
  - Upgraded `spawnShockwave` with per-ring `lineWidth`, `expandRate`, `alphaDecay`, and sub-frame `alpha` interpolation for concentric multi-ring blast waves (*Bomb* outer blast ring + inner fireball ring, *Prism* 4-ring chromatic cascade, *Cryo* dual frost rings, *Brush* dual chromatic rings).
  - Added point-to-point jagged electric arcs (`spawnLightningArc`) and triple-pass high-voltage lightning rendering (outer glow, main bolt, white-hot inner core) for *Lightning* and *Prism* cluster discharges.
  - Added dual-pass glowing plasma streaks with counter-curved salvos and per-target blast rings for *Rocket*, paint-stroke streaks for *Brush*, and per-sphere kinetic shockwaves along the *Anvil* crush trajectory.

## [1.9.6] - 2026-11-04

### Added
- **Board & Launcher Mechanics in Workshop Codex (`CodexView.js`, `CODEX_MECHANICS_ORDER`)**: Added a dedicated *Board & Launcher Mechanics* section to the Workshop Codex documenting *Polarity Inversion* (`🧲` / `F`), *Magnetic Collector Bins* (`+35 pts` and Overcharge), and the *Overcharge Gauge*.
- **Touch-Aware Polarity & Arsenal Pause Instructions (`PAUSE_INPUT_HINTS`)**: Adapted `#pause-instruction-keyboard` in `#modal-pause` for both pointer/keyboard and touch modalities so touch players see how to invert magnetic polarity (`🧲`) and equip Overcharge special balls.

### Fixed
- **Puzzle Stage Selection & Locked Stage Feedback (`getSuggestedPuzzleStage`, `renderPuzzleStagesStrip`)**: Kept the active unlocked stage when clicking the Puzzle mode button during a Puzzle run instead of cycling or wrapping back to Stage 1, and replaced `disabled = true` on locked Puzzle stage chips with `aria-disabled="true"` and polite `#levels-chapter-hint` feedback (`showLockedLevelHint`) for touch and keyboard users.
- **Blitz 90s HUD Wave Banner (`UIManager.refresh`)**: Displayed the current Blitz wave (`Blitz 90s • Wave {{wave}}`) in `#hud-mode-banner` while keeping the 90-second countdown timer in `#hud-shots-value`, eliminating the duplicate countdown display.
- **HUD Mode Banner Dialog Accessibility & Level Select Initial Focus (`index.html`, `UIManager.js`)**: Added `aria-haspopup="dialog"` and a dynamic `aria-label` (combining the current mode/level and `hud.stats.mode.switchHint`) to `#hud-mode-banner`, and routed initial focus in `#modal-levels` (`getLevelsModalInitialFocus`) to the active Arcade card or `#btn-close-levels` when opened during a non-Campaign run.
- **Aim Trajectory Reduced-Motion Flag (`Renderer.js`)**: Synchronized `this.isReducedMotion` on `Renderer` during `render()` and referenced `this.isReducedMotion` in `drawAimTrajectory()`.

## [1.9.5] - 2026-11-03

### Added
- **Offscreen Sphere Sprite Cache & 3D Lighting (`ballSpriteCache`, `drawBallOrb`)**: Pre-rendered static sphere layers (radial gradient, active visual style overlay, colorblind pattern, outline border, bottom-right rim-light arc, and dual specular highlights) into offscreen sprite canvases cached by `(color, radius, style, pattern, highContrast)`, with automatic invalidation on style, pattern, contrast, or DPR changes.
- **Animated Neon Aim Laser & Bounce Nodes (`drawAimTrajectory`, `traceAimTrajectory`)**: Tagged wall, obstacle, and portal ricochet vertices along the aim trajectory with `isBounce = true` and rendered a dual-pass neon aim laser (outer colored glow + animated marching dashes respecting `reducedMotion`) with luminous circular nodes at every bounce point.
- **Enriched Static Arena Background (`buildStaticLayer`, `drawGrid`, `drawWalls`)**: Added a radial launcher horizon glow, peripheral radial vignette, subtle grid intersection nodes, and glowing wall corner brackets to the pre-rendered static background layer at zero per-frame rendering cost.
- **Magnetic Bond Energy Halo (`drawMagneticBonds`)**: Added an outer energy glow pass behind stressed and same-color magnetic bonds before stroking their bright inner cores.
- **Elastic Floating Text Pop-In (`ParticleSystem.update`, `drawParticles`)**: Added an elastic scale curve (`floatingTextPopFrames`, `floatingTextPopStartScale`, `floatingTextPopOvershoot`) when floating combat texts spawn, bypassed when `reducedMotion` is enabled.
- **3D Orbs Across All Codex Badges (`CodexView.js`, `.codex-badge`)**: Applied 3D radial gradients (`specialIconBackground`) and inner-highlight / drop-shadow styling across cluster modifier, magnetic obstacle, special ball, and Daily Challenge mutator badges in the Workshop Codex.

### Fixed
- **Horizontal Clamping of Canvas Floating Texts (`drawParticles`)**: Measured rendered text width and clamped floating text `x` coordinates within `[wallMargin + width / 2, logicalWidth - wallMargin - width / 2]` with `maxWidth` enforcement so edge spawns never clip against the canvas walls.
- **Collector Bin Bonus Labels (`drawCollectorBins`)**: Rendered localized `+35` bonus labels (`gameplay.feedback.collector.slotLabel`) inside the 5 bottom avalanche collector bins using `theme.collectorLabelColor`.
- **Antimagnet Obstacle Rim & Outer Field (`drawObstacles`)**: Rendered `cfg.outerColor` and dashed `cfg.ringColor` from `configs/obstacles.json` on `OBSTACLE_TYPES.ANTIMAGNET` so cushions remain clearly visible between wave pulses.
- **Puzzle Mode Swap Button State (`UIManager.refresh`)**: Disabled `#btn-swap-ball` whenever `shotsRemaining <= 1` in Puzzle mode to match the hidden secondary ball preview and styled `:disabled` dock buttons.
- **Forced-Colors Progress & Meter Tracks (`styles/main.css`)**: Added explicit `1px solid ButtonText` borders to `.overcharge-track`, `.star-meter`, `.achievement-progress-track`, `.codex-card`, and `.ammo-card` under `@media (forced-colors: active)`.

## [1.9.4] - 2026-11-03

### Fixed
- **Cascade Drop Wave Stacking & Board Refill (`spawnCascadeDropWave`)**: Derived column positions from `cascadeCfg.dropCountPerWave`, searched upward from the lowest supported free row (`rIdx >= 0`) per platform column with ceiling and bond-support bounds so periodic waves never spawn unanchored midair spheres, added the `gameplay.feedback.wave.incoming` floating text popup, and refilled `initialDropRows` rows with a reset `cascadeTurnsUntilDrop` counter on board clear.
- **Puzzle Mode Stage 4 Shelf Alignment, Locked Stage Cycling & Snapshot Queue Sync**: Lowered Stage 4 spheres in `configs/game.json` from `y: 192` to `y: 212` so all 3 spheres rest on the center shelf at frame 0 (`getAnchoredBallIds().size === 3`), clamped `UIManager.getSuggestedPuzzleStage()` to `unlockedStage` so cycling in Puzzle mode never enters locked stages, and synchronized `engine.puzzleQueue` with `engine.upcomingColorIds` in `applyRunSnapshot()`.
- **Blitz 90s Wave Geometry, Snapshot Persistence & Survival Achievement Gate**: Updated `spawnEndlessRow()` and `spawnEndlessWave()` to read `columns`, `anchorColumns`, `startY`, and `descentStepY` (`34`) from `gameConfig.blitz` when in Blitz mode, persisted a run snapshot on periodic Blitz wave spawns, and gated the `survivorWave10` achievement unlock on `isSurvivalMode()`.
- **Boss Rush Inner Guard Ring Respawn**: Respawned and bonded the inner rotor guard ring in `evaluateRoundEnd()` whenever the Boss Core is the only remaining sphere on the board (`balls.length === 1`) with shields remaining.
- **Core Rescue HUD Progress Counter (`hud.stats.mode.coreRescueProgress`)**: Appended the localized Rescue Core progress suffix (`💎 {{rescued}}/{{total}}`) to `#hud-mode-banner` in `UIManager.refresh()` for Campaign and Puzzle stages using the `coreRescue` objective.

## [1.9.3] - 2026-11-03

### Fixed
- **Workshop Ball Style Preview Orbs (`.style-preview-*`)**: Replaced the undefined `--bg-darker` CSS custom property with `--bg-dark` on the `Classic`, `Neon`, and `Metallic` style preview orbs, declared a default `--tutorial-bottom` in `:root`, and extended the repository CSS variable guard in `tests/ui.test.js` to assert that every referenced `var(--*)` token is declared in `styles/main.css`.
- **Puzzle Mode Special Ammo & HUD Shortcuts (`canBuySpecialAmmo`)**: Excluded `GAME_MODES.PUZZLE` from HUD special-ammo purchase affordances and `Digit1`-`Digit7` shortcut handlers so empty slots remain disabled with accurate screen-reader labels instead of opening the locked Ammo tab.
- **Puzzle Mode Fixed-Shot Budget Enforcement**: Excluded `GAME_MODES.PUZZLE` from mid-run `startingShots` Workshop upgrades (`applyUpgradePurchase`) and Game Over Second Chance offers (`canContinueOutOfShots`), clamped `currentPuzzleStage` in `startPuzzleMode`, synchronized `upcomingColorIds` in `takeUpcomingColor`, and hid the launcher `nextBall` preview and swap control on 1-shot Puzzle stages.
- **Arcade Mode Feedback Popups & Boss Rush Persistence**: Wired the `gameplay.feedback.blitz.autoFire`, `gameplay.feedback.bossRush.overchargeStrike`, and `gameplay.feedback.bossRush.waveCleared` floating text popups in `GameEngine.js`, forced a `saveRunSnapshot({ force: true })` and `notifyUI()` on Boss Rush wave clear, and updated the `bossSlayer` achievement description in both locales to include `Boss Rush`.

## [1.9.2] - 2026-11-03

### Added
- **Direct Puzzle Stage Selector & Rich Arcade Records (`#puzzle-stages-strip`)**: Added a row of stage chips (`P1`..`P5`) inside the Levels & Modes modal so players can launch any unlocked Puzzle stage in a single click, and enriched the Puzzle and Boss Rush cards to display both the highest stage/wave reached and the personal best score.
- **Blitz 90s Auto-Fire Countdown Ring**: Added a radial progress arc around the launcher base in Blitz mode showing the remaining time before the 3-second hesitation auto-fire triggers, shifting to the urgent warning color past 70% elapsed time.
- **Danger Line Proximity Radial Glow**: Spheres inside the danger warning zone now render a pulsing radial warning halo behind their ring outline (static when `reduced-motion` is active).
- **Workshop Ball Style Preview Orbs (`.style-preview-orb`)**: Added a live CSS preview orb on each Ball Style card in the Workshop (`Classic`, `Crystal`, `Neon`, `Metallic`).
- **Enriched Game Over Run Summary (`#gameover-stage`)**: Tracked `maxComboInRound` and `runCoinsEarned` in `GameEngine` and `RunSnapshot`, displaying wave/stage reached, max combo, and coins earned on the Game Over modal across Survival, Daily, Flux, Blitz, Boss Rush, Cascade, and Puzzle modes.
- **Arcade Mode Result Sharing**: Extended `DailyShare.buildShareText` and `RunSnapshot.snapshotFromEngine` to support spoiler-free result sharing for `puzzle`, `blitz`, `boss_rush`, and `cascade`.

### Fixed
- **Rescue Core Floating Text Interpolation**: Passed `{ points: rescueSpec.pointsPerCore, coins: rescueSpec.coinsReward }` to `gameplay.feedback.rescueCore.freed` so freeing a Rescue Core displays its point value instead of `+undefined`.
- **Puzzle Mode Progression & Workshop Ammo State**: Resuming Puzzle mode from navigation now selects the highest unlocked stage (`getSuggestedPuzzleStage`), hides the misleading `3★ target reached!` line on 1★/2★ Puzzle victories, and disables Special Ammo purchases during Puzzle runs with an explicit hint (`puzzleDisabledHint`).
- **Boss Rush HUD & Workshop Accessibility**: Displayed `Shields` / `Boucliers` on the Boss Rush HUD counter (`hud.stats.shots.shieldsLabel`), announced Ball Style purchases and selections to screen readers, removed the nested scrollbar on `#shop-styles-grid`, added `@media (forced-colors: active)` rules for `.arcade-mode-card` and `.puzzle-stage-btn`, and wrapped `.modal-tabs` cleanly on narrow mobile viewports.

## [1.9.1] - 2026-11-03

### Changed
- **MagnaShot Rebrand**: Renamed the game, PWA manifest (`MagnaShot - Magnetic Physics Edition`), package (`magnashot`), Service Worker cache (`magnashot-cache-v*`), `localStorage` prefix (`magnashot_v1_`), share headers (`MagnaShot - ...`), and GitHub repository (`https://github.com/VBlackJack/magnashot`) / GitHub Pages URL (`https://vblackjack.github.io/magnashot/`).
- **Mode Selection UX Overhaul**: Added all 8 game modes directly to the main navigation bar (`.nav-modes`), made the HUD `#hud-mode-banner` a clickable mode-switcher button, and upgraded the Arcade toolbar in `#modal-levels` into rich `.arcade-mode-card` cards with active highlights (`is-active` / `aria-pressed`) and descriptions.

## [1.9.0] - 2026-11-03

### Added
- **Core Rescue Objective (`CLUSTER_MODIFIERS.RESCUE_CORE`, `OBJECTIVE_TYPES.CORE_RESCUE`)**: Added captive Rescue Core spheres (`💎`) that award `+450 pts` and `+8 ⬡` when matched or dropped in an avalanche. In Core Rescue stages, freeing all Rescue Cores on the board immediately shatters the remaining cluster into a celebratory avalanche (`releaseRemainingBoardAsAvalanche`) and triggers Victory.
- **One-Shot / Puzzle Mode (`GAME_MODES.PUZZLE`, `#btn-mode-puzzle`)**: Added 5 deterministic trick-shot puzzle stages in `configs/game.json` (`puzzles`) with fixed shot counts (`1` or `2`), pre-scripted launcher queues (`puzzleQueue`), and locked special ammo inventory.
- **Blitz 90s / Time Attack (`GAME_MODES.BLITZ`, `#btn-mode-blitz`)**: Added a 90-second speed-run mode with unlimited shots, rapid automatic wave descent (`waveIntervalFrames: 360`), a 3-second (`autoFireFrames: 180`) hesitation auto-fire cannon, and a `timeUp` Game Over reason.
- **Boss Rush / Titan Core (`GAME_MODES.BOSS_RUSH`, `#btn-mode-boss-rush`)**: Added an endless Boss Rush mode featuring a central rotor carrying a multi-shield Titan (`BOSS_CORE`) surrounded by concentric rings. Reaching 100% Overcharge (accelerated by Collector Bins) strikes the Titan for `-1` shield in addition to granting a special ball, and destroying the Titan shatters the wave into an avalanche and advances to `bossRushWave + 1`.
- **Cascade Drop (`GAME_MODES.CASCADE`, `#btn-mode-cascade`)**: Added a high-gravity magnetic well mode (`gravityMultiplier: 1.65`) where spheres cascade from the top onto `PLATFORM` shelves and `ANTIMAGNET` cushions every 2 turns.

## [1.8.0] - 2026-11-03

### Added
- **Daily Streak & Escalating Coin Bonus**: Added consecutive UTC day streak tracking (`dailyStreak`, `dailyStreakDate` in `StorageManager`), awarding `+15 ⬡` extra per consecutive day (capped at `+90 ⬡`) on top of the daily first-play bonus and displaying the active streak in the HUD banner, Daily button badge, and Game Over summary.
- **Second Chance on Out-of-Shots**: In shot-budgeted modes (Campaign and Flux Mode), running out of shots while spheres remain on the board offers a one-time-per-round `#btn-continue-gameover` action (`+5 shots (40 ⬡)`) to resume the round, persisted in `RunSnapshot`.
- **Avalanche Collector Bins**: Falling avalanche spheres (`droppingBalls`) crossing the magnetic collector slots at the bottom of the board award collector bonus points (`+35 pts`) and overcharge (`+4%`), with 5 collector slots rendered along the bottom of the canvas in `Renderer.js`.
- **Unlockable Sphere Visual Styles**: Added a `Styles` tab (`#tab-shop-styles`) in the Workshop with 4 sphere styles (`classic`, `crystal`, `neon`, `metallic`) defined in `configs/balls.json`, persisted in `StorageManager` (`unlockedBallStyles`, `activeBallStyle`), and rendered via `Renderer.drawBallStyleOverlay`.
- **7th Equipable Special Ball - Brush (`SPECIAL_TYPES.BRUSH`)**: Added the Brush special ball (shortcut `7` / `Digit7`) that repaints spheres within `paintRadiusFactor: 3.2` and scrubs `RUST` spheres into a unified color without breaking bonds, complete with `ImpactPreview` and `Renderer` AOE circle preview and a 9-column mobile portrait dock layout.
- **Platform & Antimagnet Obstacles (`OBSTACLE_TYPES.PLATFORM`, `OBSTACLE_TYPES.ANTIMAGNET`)**: Added support platforms (`resolvePlatformSupports`, `isSupportedByPlatform`) that physically hold non-anchor cluster spheres from below while letting upward projectiles pass through, and Antimagnet fields (`applyClusterFields`) that repel nearby hanging cluster spheres without deflecting fired projectiles, integrated into Flux Mode (`platformPair`, `antimagnetField`), Codex, and onboarding hints.

## [1.7.7] - 2026-11-03

### Added
- **Persistent Achievement Progress Records**: Added `achievementRecords` to `StorageManager` (`getAchievementRecords`, `recordAchievementProgress`) and wired `GameEngine` to persist all-time personal bests (`maxCombo`, `endlessWave`, `maxAvalanche`, `bossesDestroyed`, `shotsRemainingOnClear`) so Workshop achievement progress bars retain progress across sessions and mode switches.
- **Smart `< 3★` Victory Next Button**: When the `< 3★` filter is active in Level Select, the Campaign Victory modal's primary button (`#btn-next-level`) automatically targets and labels the next unlocked `< 3★` level (`resolveNextCampaignTarget` / `VICTORY_NEXT_ACTIONS.NEXT_INCOMPLETE`, wrapping around if needed).
- **Direct Flux Seed Input**: Added a Flux seed input (`#input-flux-seed`) and launch button (`#btn-flux-seed-go`) in the Level Select toolbar (`parseFluxSeedInput` in `src/game/DailyShare.js`) accepting a 6-character code, `#code`, a `?flux=<seed>` URL, or full share text, alongside `[data-i18n-placeholder]` translation support in `I18n.translateDOM()`.
- **Level Select Format Badges**: Level cards in `#levels-grid` now display distinct format badges (`.level-format-badge` for `Boss`, `Precision` / `Précision`, `Arsenal`, and `Twist` / `Variante`), including authored Boss levels marked via `isLandmark` in `LevelCatalog.summarize`.

### Changed
- **Modular UI Views**: Extracted `src/ui/CodexView.js`, `src/ui/WorkshopView.js`, and `src/ui/LevelSelectView.js` from `src/ui/UIManager.js` and registered the new modules in `sw.js` `PRECACHE_ASSETS`.

## [1.7.6] - 2026-11-03

### Fixed
- **Workshop Achievement Progress Thresholds**: `computeAchievementProgress` and `renderShopContents` now read `achSpec.threshold` across all 6 configured achievements (`firstAvalanche`, `comboMaster`, `bossSlayer`, `sharpshooter`, `survivorWave10`, `starCollector`) and pass live `maxCombo` and `bossesDestroyed` counters from `GameEngine`.
- **Shared Flux Seed URL Cleanup**: Switching away from a shared `?flux=<seed>` run (or starting a new seed) now removes the `flux` query parameter via `window.history.replaceState` (`stripFluxSeedFromUrl` in `src/game/DailyShare.js`) so subsequent page reloads resume the active run instead of forcing the old shared seed.
- **Level Select Accessibility & Forced-Colors Polish**: Unified locked chapter and locked card hints on `revealLiveRegion` (`showLockedLevelHint`) to prevent duplicate screen-reader announcements, added keyboard focus and `Enter`/`Space` activation to locked level cards, styled `.level-card.locked` with `GrayText` under `@media (forced-colors: active)`, cleared stale `#levels-chapter-hint` banners when toggling the `< 3★` filter or closing the modal, and merged the duplicate `click` listeners on `#btn-play-level-modal`.

## [1.7.5] - 2026-11-03

### Added
- **Shareable & Replayable Flux Seeds**: Sharing a Flux Mode result now includes the 6-character seed in the header (`#seed`) and appends `?flux=<seed>` to the share URL (`buildFluxShareUrl`). Opening `?flux=<seed>` starts a Flux run on that exact seed (`readFluxSeedFromSearch`), and the Flux Game Over modal adds a `Same Seed (#...)` button (`#btn-same-seed-gameover`) to replay the exact same run sequence.
- **Level Select `< 3★` Filter**: Added a `< 3★` filter toggle button (`#btn-levels-filter-incomplete`, `aria-pressed`) in the Level Select modal toolbar to display only unlocked levels with fewer than 3 stars in the active chapter, with a clear empty-state message (`.levels-empty-filter`) when the chapter is already fully completed at `3★`.
- **Visual Achievement Progress**: Achievement cards in the Workshop (`#achievements-grid`) now display a visual progress bar (`.achievement-progress-track` / `.achievement-progress-fill`) and a `{{current}} / {{target}}` progress counter (`computeAchievementProgress`) for locked achievements across combos, campaign stars, Survival waves, and campaign completion.
- **Contextual Destructive Confirmation**: The confirmation button (`#btn-confirm-yes`) in `#modal-confirm` now dynamically names the target action (*Restart*, *Survival*, *Daily*, *Flux Mode*, *Play level X*) via `requestDestructiveAction(actionCallback, confirmLabelResolver)` and updates automatically on language switch.
- **Level Select from Pause Modal**: Added a `Levels` button (`#btn-levels-pause`) to the Pause modal actions, returning to the Pause modal if Level Select is dismissed without starting a new run.
- **Locked Level Card Accessibility & Feedback**: Locked level cards in `#levels-grid` now expose `role="button"`, `aria-disabled="true"`, `aria-label`, `aria-describedby`, and `title`, and clicking a locked card reveals and announces the required level in `#levels-chapter-hint`.

### Fixed
- **Immediate Projectile Reserve Application & Shop Announcements**: Purchasing *Projectile Reserve* (`startingShots`) during an active Campaign or Flux run now immediately credits the extra shots (`+2`) to `shotsRemaining` via `GameEngine.applyUpgradePurchase`, interpolates `{{shots}}` from `configs/game.json`, clarifies upgrade descriptions for Flux Mode and special cores, and announces Workshop upgrade and ammo purchases to screen readers.
- **Pause Button Keyboard Shortcut Tooltip**: Added `data-i18n-title="app.nav.button.pauseTooltip"` (`Pause (Esc)` / `Pause (Échap)`) to `#btn-pause` in both the top navigation bar and the slide-in drawer.

## [1.7.4] - 2026-11-02

### Added
- **Rocket Aim & Avalanche Preview**: Aiming with a Rocket (`SPECIAL_TYPES.ROCKET`) now highlights the priority targets selected by `pickRocketTargets` and previews the resulting Magnetic Avalanche drops (`predictImpact` in `src/game/ImpactPreview.js`), while accounting for Boss Core multi-shield durability (`armorHits > 1`).
- **Next Star Goal & New Record on Victory**: The Campaign Victory modal (`#modal-victory`) now displays the score needed for the next star (`#victory-next-star`, e.g., `Next star (3★): 10,400 pts (1,200 pts away)`) or `3★ target reached!`, and celebrates a new personal best when beating a previously recorded level score (`New record!` / `Nouveau record !`).
- **Game Over New Record & Remaining Spheres**: The Game Over modal (`#modal-gameover`) now detects and highlights a new personal record in Survival, Daily Challenge, and Flux Mode before persisting the score, and displays the number of spheres left on the board (`#gameover-remaining`) when losing a shot-budgeted Campaign or Flux run.
- **Desktop Special Ball Key Badges (`1`-`6`)**: Added `<kbd class="powerup-key">` shortcut badges (`1` to `6`) on Special Ball buttons for desktop pointer users, automatically hidden on touch devices and compact phone viewports.
- **Locked Chapter Hint**: Clicking or hovering a locked chapter tab in the Level Select modal (`#modal-levels`) now explains which level must be completed to unlock that chapter (`#levels-chapter-hint` live region and tab tooltip).

## [1.7.3] - 2026-11-02

### Added
- **Expanded Codex & Guide**: `buildCodexPane()` now documents the player's 6 Special Balls (*Bomb*, *Lightning*, *Prism*, *Anvil*, *Cryo*, *Rocket*) and the 4 Daily Challenge mutators (*Hyper Gravity*, *Turbo Rotors*, *Super Magnetism*, *Volatile Cluster*), and the French heading for cluster modifiers is clarified as *"Modificateurs de l'Amas"*.
- **Visible Feedback on Share & Hint Reset**: Copying a run result to the clipboard updates the Share button to `Copied ✓` (`Copié ✓`), and resetting discovery hints in Settings or Pause updates the button and caption to `✓` / `Reset ✓` (`Réinitialisés ✓`).
- **Pause Dialog Parity**: Added the discovery hints reset button (`#btn-reset-hints-pause`) to the Pause modal alongside the other six settings controls.

### Fixed
- **Level Select Confirmation Guard**: Clicking the primary `Play level X` button (`#btn-play-level-modal`) in the Level Select modal during an active Survival, Daily Challenge, or Flux run now asks for confirmation before abandoning the run, matching level card clicks.
- **Keyboard Special Ball Parity**: Pressing `1` to `6` (`Digit1`-`Digit6`) on an empty Special Ball slot during an active run now opens the Workshop on the Ammo tab, matching mouse and touch interactions.
- **Workshop Upgrade Focus Retention**: Reaching the `MAX` rank on an upgrade in the Workshop now moves keyboard focus to the next available upgrade button at or after that slot instead of jumping back to the first card.
- **Unlocked Level Card Accessibility**: Unlocked level cards in `#levels-grid` now expose a concise `aria-label` (level number, name, stars earned, best score) and reference their description via `aria-describedby`.
- **Live Daily Challenge Countdown**: The `Next challenge in X h Y min` countdown in the Daily Challenge Game Over modal now refreshes periodically (`daily.countdownRefreshMs`) while the modal remains open.

## [1.7.2] - 2026-11-02

### Security
- **Content Security Policy**: `index.html` now declares a `Content-Security-Policy` meta tag restricting scripts, connections, media and base URIs to `'self'`, disallowing `<object>` and form actions, and verified by `tests/pwa.test.js`.
- **Dependencies**: Pinned transitive `minimatch` to `^11.0.1` via `overrides` in `package.json` to resolve five moderate ReDoS advisories (`GHSA-g3hv-75wg-m249`).
- **CI Permissions**: Added explicit `permissions: contents: read` and job `timeout-minutes` limits to `.github/workflows/ci.yml`.

### Fixed
- **Local Lint with Nested Worktrees**: `eslint.config.js`, `tests/typography.test.js` and `.gitignore` now ignore local tool directories so `npm run lint` no longer lints nested worktrees without browser globals.

### Changed
- **Repository Guards and Config Uniformity**: Expanded the `t()` literal key test in `tests/ui.test.js` to scan every `.js` file under `src/` alongside `index.html`, added `"rocket": 0` to `specialInventory` on authored levels 1 to 20 in `configs/levels.json` to match levels 21 to 24, and updated `README.md` and `README.fr.md`.

## [1.7.1] - 2026-10-29

### Fixed
- **Muting Without a Click**: Muting suspended the audio context at once, which froze the fade-out added in 1.7.0, so the cut voices were never faded and their tail could sound on unmute. The context now suspends once the `stopRampSec` fade has played; unmuting during the fade cancels the suspend.
- **Survival Launcher After a Cleared Board**: After a shot that cleared the board, the launcher could keep a color the new wave did not bring for one turn. The launcher colors are checked again once the wave has spawned.
- **Hints on Generated Levels**: The neutral anchors and rails of generated levels were not counted among the mechanics a level always shows, so their first-encounter hint could come after a less central one.
- **Level 24 Stars**: The rust tutorial kept star thresholds measured while its rust spheres still matched by color. They now follow the arsenal bot's median like every generated level: 9600 and 15300 instead of 14200 and 22500.
- **Flux Announcement**: The "shape cleared" announcement could be read again when the language or the input mode changed during the stage transition.
- **Screen Readers**: The score stars of the HUD are read as a count ("Stars: 2 of 3") instead of glyph names, and the level grid is labelled by its active chapter tab.
- **Contrast and Focus**: The name of an empty special ball meets 4.5:1 contrast, the star gauge stays visible under Windows contrast themes, and the keyboard focus ring is no longer clipped in the level select.

### Changed
- **Settings Out of the Code**: The Boss Core shield crack radius (`crackShockwaveRadius`) and the singularity pull wave opacity (`pullWaveAlpha`) moved to the config with the same values; numbers shown in the level select are grouped per locale.
- **Style Sheet**: Unused rules and color tokens are removed, the drawer duration is one token, and tests now require the in-app and system high-contrast themes to declare the same values and every color token to be used.
- **Calibration Guard**: `tests/campaign.test.js` fails when `configs/campaign.json` changes the calibration runs or win-rate floors without a new measure.
- **Browser Test Diagnostics**: When the smoke suite times out waiting for the game loop, it reports the page visibility, the boot state and the frame rate.
## [1.7.0] - 2026-10-29

### Added
- **Share for Survival and Flux**: The game over window of a Survival or Flux run has the Share button the Daily Challenge had: a Survival result gives the wave, the score and one symbol per wave passed, a Flux result the shape reached and the score, then the game address; the system share sheet, the clipboard or a read-only field, as before (`buildShareText` in `src/game/DailyShare.js`, texts under `share.survival` and `share.flux`).
- **Install Button**: When the browser offers to install the game (Android, Chrome on desktop), **Settings** shows an Install button that opens the browser's own prompt; on iPhone and iPad a line explains the Share, then Add to Home Screen path. The installed app is announced to screen readers.
- **Daily State**: The Daily game over window counts down to the next challenge (UTC midnight), and once today's challenge has been played the menu button shows a check mark instead of the bonus badge.
- **Landscape Phones**: In landscape the first-encounter hint and the equipped special ball banner leave the board and stack in the left column, with their full text; the menu takes two rows instead of four.
- **Hint Out of the Way**: On portrait phones the hint fades out while the finger is on the board and comes back on release, so the trajectory near the launcher stays visible (no change with reduced motion).
- **What a Special Ball Does**: Each card of the Workshop ammo tab describes its ball, so a touch player can read the effect before buying or equipping it.
- **Empty Special Balls Panel**: On desktop and tablet, a level without special balls says so instead of leaving the panel empty.- **Lint**: `npm run lint` runs ESLint with its recommended rules (`eslint.config.js`, browser globals for `src/` and `sw.js`, Node globals for `tests/` and `scripts/`), and CI installs the dependencies and lints before the test suite.
- **Calibration Options**: `scripts/calibrate-campaign.mjs` checks `--from`, `--to` and `--workers` (whole numbers, a range inside the campaign that runs forward, at least one worker) and stops with the usage line and exit code 2 otherwise. `--dry-run` can measure an authored level as it is (`--from 24 --to 24 --dry-run`); a writing run still starts on the first generated level. A candidate that builds the same board as one already tried for the level is skipped and counted in `measured.skipped`.

### Changed
- **Recalibrated Campaign**: All 800 generated levels were measured again after the rust, rotor, aim preview and twist fixes (16 games per bot and level). 28 levels get extra shots and 29 another seed; against 1.6.0, 35 levels changed their shot count, 10 their seed and 207 their star thresholds. None is left below the greedy bot's floor of one win in eight. Greedy bot win rate goes from 0.85 in chapter 1 to 0.60 in chapter 20; the arsenal bot wins every game on 779 of 800 levels, with 21 levels below 0.99 and, before the arsenal floor below, a low of 0.3125 on level 165. Three-star thresholds sit at 0.79 times the arsenal bot's median score, as on the authored levels. Level 24, the rust tutorial, keeps its thresholds: with rust truly colorless the greedy bot no longer wins it without special balls, while the arsenal bot wins every game.
- **Arsenal Floor**: The calibration now holds the arsenal bot, which stands for a player who uses special balls, to a floor too: a candidate passes only when the greedy bot wins at least `calibration.minWinRate` of its games (one in eight) and the arsenal bot at least `calibration.minArsenalWinRate` (one in two, `configs/campaign.json`); otherwise it gets extra shots, then another seed, as for the greedy floor. Both bots now play every candidate, and when none passes the one that fails the fewer floors is kept, then the one the greedy bot wins most. The progress line names the floor a level missed, and `configs/campaignTuning.json` records both floors. Level 165 was the only level below the new floor (arsenal 0.3125, greedy 0.125, seed 0 with 12 extra shots, 35 shots); it moves to seed variant 2 with no extra shots (34 shots): arsenal 0.875, greedy 0.375, star thresholds 5700 and 9000 instead of 3900 and 6200. On seed 0 the arsenal bot wins 0.375 at best, with 18 extra shots; seed variant 1 builds the same board as variant 0 and was skipped. The lowest arsenal win rate in the campaign is now 0.75, on level 145.
- **Seeded Runs**: The fixes below change how a seeded Daily Challenge or Flux run plays out, so their scores and results are not comparable with those of 1.6.0.

### Fixed
- **Forced Rust Spheres**: A rust sphere added to reach a level's minimum count kept a hidden color and could join a color group (level 24, chapter 4, chapter 15 and every "+ Rust" twist).
- **Next Level After the Last Level**: Next Level on the last campaign level started Survival; it now returns to the level select.
- **Rotor Lag**: The physics step stopped moving the cluster for the rest of the frame once the shot landed, so spheres on a rotor lagged their pivot by up to two thirds of a step per shot.
- **Aim Preview Under Rotors**: The aim preview now moves the spheres hanging under a rotor the way the shot will.
- **Coins Banked Too Early**: Coins paid by a chain reaction, an avalanche or a Flux stage clear were banked before the run was stored, so a discarded tab could pay them twice; a Flux run restored at a stage start lost its saved copy, and a special ball bought before the first shot was not saved.
- **Twist Variety**: Twist levels in chapters 13 to 20 repeated the same two mechanics. The twist mechanic now follows the twist's rank among the twist slots of `formats.pattern`, so every chapter shows eight different ones.
- **Level 203**: The level announced a twist its board could not carry (a ring of anchors with no sphere free for a modifier). The twist format now draws up to four boards and keeps the first with room for one sphere of each mechanic it announces (`formats.twist.boardPick` in `configs/campaign.json`); level 203 is the only board that changes.
- **Confirm Dialog**: The Confirm dialog now pauses the run, and keeps keyboard focus when a round ends under it.
- **Equipped Special Ball**: The equipped special ball is announced to screen readers.
- **Share Twice**: A second tap on Share while the share sheet was open copied the text instead.
- **Narrow Phones**: On 360 px wide phones the control row overflowed.
- **Calibration Failures**: The calibration script ignored a crashed worker and wrote an incomplete file with exit code 0. A worker that crashes now hands its level back to the queue, up to `calibration.maxLevelAttempts` tries; when a level stays unmeasured, `configs/campaignTuning.json` is left untouched and the script exits with code 1.
- **Silencing Click**: Stopping the sounds (victory, game over, mute) cut each voice mid-wave; every voice now fades out over `stopRampSec` (`configs/audio.json`) before it stops.
- **Saved Run Check**: A saved sphere whose position or radius is not a number is now rejected with the run instead of being restored broken.
- **1.6.0 Release Notes**: Calibration figures, arsenal bot floor and world size corrected in place.

## [1.6.0] - 2026-10-28

### Added
- **800 Generated Campaign Levels**: After the 24 authored levels, the campaign goes on with levels 25 to 824, each rebuilt from its number alone (`src/game/LevelCatalog.js`, tuning in `configs/campaign.json`). They come in 20 chapters of 40; each chapter features one mechanic the authored levels teach, shown a set number of times. Difficulty climbs over the run and within each chapter, and each chapter opens a little easier than the previous one ended: colors go from 4 to 6, boards grow, modifiers and obstacles come more often and the shot margin tightens. Every 10th level is a landmark: a drawn silhouette or a pair, a Boss Core and a few more shots and special balls. Star thresholds first came from a formula, since replaced by the calibration below. Shapes, obstacles and rotors come from the Flux generator, which can now be asked for a given family and boss stage. `tests/campaign.test.js` checks every generated level.
- **Calibrated Generated Levels**: `node scripts/calibrate-campaign.mjs` plays every generated level 16 times with a greedy aiming bot that does not use special balls, on parallel workers, and writes `configs/campaignTuning.json`. A level the bot wins less than one game in eight gets 6, 12 or 18 more shots, then another seed, until one passes. Star thresholds replace the formula: three stars at a share of a bot's median score, two stars at 63% of three. Every level stores the fingerprint of the board it was measured on; `tests/campaign.test.js` fails, listing the levels, when a board changes without a new measure. The figures of this first run were superseded by the Recalibrated Campaign entry below.
- **Level Formats**: Each block of 10 generated levels mixes formats (`formats` in `configs/campaign.json`): standard levels; two twists, where a mechanic from another chapter joins the chapter's own; a precision level, the smallest of five candidate boards with a tight shot count and a single bomb; an arsenal level, the biggest of five, with fewer shots and twice the special balls; and the landmark. A level's name and description show its format ("Chains 3 (+ Thrust)", "Chains 1 (Precision)", level 560 "Bubbles + Thrust 16").
- **Recalibrated Campaign**: All 800 generated levels were measured again with both bots for the new boards. 25 got extra shots and 31 another seed, and none is left below the greedy bot's floor. Stars now follow the arsenal bot, so three-star thresholds are 22 to 29% lower than before, in line with the authored levels. Greedy bot win rate goes from 0.84 in chapter 1 to 0.66 in chapter 20. The arsenal bot wins every game on 778 of 800 levels and 0.99 of them on average in chapter 20; 22 levels sit below 0.99, the lowest at 0.5625 (9 games of 16) on level 165, then 0.75 on level 785.
- **Paired Chapters**: Chapters 13 to 20 no longer repeat chapters 1 to 8: each features a hand-picked pair of mechanics (`pairedChapters`), with 60% of a single mechanic's count for each.
- **Arsenal Calibration Bot**: `scripts/calibrate-campaign.mjs` now runs two bots (`scripts/bot/CampaignBot.js`). The greedy bot, unchanged and still blind to special balls, sets the shots a level needs. The arsenal bot reads the same aim preview as the player, now shared in `src/game/ImpactPreview.js`, for the loaded color and every special ball in stock, and plays a special when it clearly beats the best color shot (`calibration.bot.arsenal` in `configs/campaign.json`). `calibration.starPolicy` names the bot whose median sets the star thresholds, each with the three-star ratio the authored levels show for it (`threeStarMedianFactors`: 1.08 greedy, 0.79 arsenal). `--dry-run` prints both bots' measures without writing them. The arsenal bot now sets the stars, as a star is only won on a victory: measured on chapters 1 and 20, it wins 1.00 and 0.99 of its games against 0.82 and 0.57 for the greedy one. Against it, generated three-star thresholds sit at 1.01 to 1.11 times its median where the authored levels sit at 0.79, so the next full calibration lowers them by about 22 to 29%.
- **Level Select by Chapter**: The level select shows one chapter at a time instead of all 824 cards: a strip of chapter tabs (Basics for levels 1 to 24, then each chapter of 40 with its featured mechanic) shows the stars won in each, and the dialog opens on the chapter of the suggested level. A chapter whose first level is locked stays closed; the arrow keys move between open chapters.
- **Generated Flux Shapes**: Three Flux stages in four now draw a generated silhouette: a polar curve (star, flower, gear, polygon, crescent or heart; solid or hollow; several sizes and proportions) filled on the sphere grid, anchored on top, and kept only if it passes a quality filter (fits the board, hangs together, enough spheres, its points and notches visible on the grid). More than 1,200 distinct shapes pass, against 31 before. Each is named after its shape in both languages, and the stage seed still rebuilds the same one. Generated shapes may follow each other; the other families still never repeat. Tuning lives in `generated` in `configs/flux.json`.
- **First-Encounter Hints**: Each mechanic is explained the first time it reaches the board, in every mode (Campaign, Survival, Daily Challenge, Flux): the level tutorial when one exists, else the mechanic's Codex entry. A hint shows once, and the mechanics sharing its text (the three cores) count as discovered with it; a hint left open gives way to the next one after three turns (`onboarding` in `configs/game.json`). Players who already played start with the mechanics of the levels they have passed marked as known.
- **Show Hints Again**: A Settings button forgets every discovered mechanic.
- **Onboarding Guard**: `tests/onboarding.test.js` fails when a mechanic has no hint text, when a level tutorial teaches a mechanic its level may not show or rolls extra copies of it, or when level 1 shows more than the basics.
- **Impact Wave**: A landing sphere sends a swelling wave through its cluster, one bond at a time and weaker at each hop, plus a light screen shake (`juice.impactWave` and `juice.snapShake` in `configs/game.json`). Before, a hit that destroyed nothing moved the nearest sphere by 8 px at most. The wave only scales how spheres are drawn, so positions, aim and scores are unchanged; reduced motion turns it off.
- **Precise Keyboard Aim**: The arrow keys turn the aim by a fine step (`canvas.keyboardAimFineStepRad`, about 4 px at the top of the board), and Shift + arrows by the former step. After an arrow, the mouse takes the aim back only once it moves farther than `canvas.pointerAimUnlockDistance`, and a click within that distance shoots along the adjusted angle. Touch aiming is unchanged.
- **Share the Daily Challenge**: The Daily Challenge game over window has a Share button (Daily only). It builds a spoiler-free text: challenge number (days since `share.epochDateKey`, which is challenge 1), mutator, wave reached and score, then one symbol per wave passed, gold rush and boss waves in their own color, capped at `share.maxWaveSymbols` with a count of the rest, then the game address (`share.url`). The text goes to the system share sheet when there is one, else to the clipboard, else into a read-only field with the text selected; the outcome is announced to screen readers. The engine now logs the kind of each wave (`waveLog`), kept in the saved run so a resumed Daily run shares its whole log; a run saved before the log existed rebuilds it from the wave count.
- **Browser Smoke Tests**: `npm run test:browser` opens the game in headless Chromium at the four supported layouts and fails on console errors, sideways scrolling, clipped control labels, dialogs that do not pause or close, and broken victory, game over or reload-resume paths. CI runs it as a separate job.

### Changed
- **Bigger Spheres on Phones**: The world is 470 units wide instead of 540. In portrait the board fills the phone's width, so spheres are 15% bigger there (28.9 to 33.2 px on a 390-wide phone); on desktop and in landscape they keep their size and the board is narrower. The board's shape now comes from the world size instead of a fixed CSS ratio. Level 5's barrier and Flux twin shapes moved inward to clear the walls, and 13 levels have new star thresholds from simulated play. Closer walls made five levels harder, so they get more shots to keep their win rate in simulated play: level 1 (+8), 4 (+12), 14 (+8), 20 (+4) and 21 (+4).
- **Fields Move Clusters**: Repulsors and attractors used to act on shots only. They now push hanging spheres away or pull them in too, with the same falloff scaled by `simulation.clusterFieldFactor` (0.08): clusters lean by up to a third to a half of a sphere radius, and no bond breaks. In simulated play on the 470-wide world, the four field levels (4, 6, 8, 14) moved by 9% or less, so their star thresholds stay.
- **World Geometry**: The launcher and the danger line are derived from the bottom of the world, and level and Flux coordinates are authored for `canvas.designWidth` and centered in the actual world (`src/core/WorldGeometry.js`). The shipped world is 470 x 820, so content authored at the 540 `designWidth` is centered by a 35-unit shift; `tests/world.test.js` checks it, and that every level, Flux stage and the Survival grid fit between the walls.
- **Tilt Control On by Default**: On phones and tablets that report their orientation, tilt control is on unless the player turned it off (`tilt.enabledByDefault`). Where the browser asks permission (iOS), the first tap on the board asks it, and a refusal is kept as the player's choice.
- **Level 1**: Three colors, no special ball and no modifier, so the first level teaches matching and avalanches alone. Its star thresholds move to 6400 and 10400, keeping their ratio to the median winning score of simulated play (30 games, median 17130 before, 26070 after).
- **Level Tutorials**: A tutorial no longer comes back each time a level is restarted; the Pause and Game Over tips still show it.
- **Teaching Levels**: The eight levels whose tutorial teaches a modifier show an exact number of it instead of a minimum topped up at random (level 13 went from 2 to 20 locks, now 3). Star thresholds of levels 13, 22 and 24 follow the median score of simulated play: 6400/10200, 12900/20400 and 14200/22500.
- **Discovery Order**: In the campaign, the mechanics the level always shows are explained before the others, so level 3 opens on its bumpers.
- **Fast Keyboard Aim**: The 0.09 rad step (`keyboardAimFastStepRad`) is gone; Shift + arrows now use the former regular step.

### Fixed
- **Tethers and Rotors**: A tether could tie a rotor to the shape next to it, or two rotors together, locking them or swinging the neighbor around the pivot. A tether now only links spheres carried by the same rotor, or by none.
- **Levels 12 and 13**: The Boss Core tutorial level now always has a Boss Core, and the Quantum Lock level at least two locks; before, about one Level 12 board in twenty had no boss to destroy.
- **Empty Special Ball Slots**: Level 1 no longer shows six empty special ball slots; they appear once the run has a special ball.

## [1.5.0] - 2026-10-27

### Changed
- **Navigation**: The menu now holds two groups: the game modes, then the round actions (a highlighted Pause, Restart, Workshop and Settings). The six setting toggles moved into a Settings dialog, and only the mode being played is highlighted (`aria-current`).
- **Level Select**: The grid uses the dialog's full height, the level being played (or the furthest unlocked) is highlighted and scrolled into view, and the main button resumes or plays that level instead of starting Survival.
- **Workshop**: One name for the menu button and its dialog. Special ammo has its own tab, and finished upgrades show a MAX status instead of a disabled button.
- **Board Readability**: Polarity letters are quieter and modifier badges larger.
- **Phones**: A line under the score shows the round, coins and best score; each launcher control and special ball is named under its icon, Polarity shows its current state, and the overcharge gauge is labelled.
- **Score Goal**: A gauge under the score fills toward the next star.
- **Empty Special Balls**: During a round, an empty special ball shows a "+" and opens the Workshop ammo tab.

### Fixed
- **Saved Run Restore**: A run saved after its level tutorial was dismissed was discarded on reload instead of resumed.
- **Keyboard Focus**: The board takes keyboard focus and shows it, so the arrow keys it announces have a visible target.

## [1.4.0] - 2026-10-27

### Added
- **Launcher Preview**: The two colors after the next ball are shown beside the launcher, smaller and in loading order (`canvas.launcherPreviewCount`). The queue is drawn when a run starts, so Daily Challenge players get the same one, and saved runs keep it.
- **Color Patterns**: A new setting draws a pattern unique to each color inside the spheres (stripes, dots, grid, rings), for players who cannot tell the colors apart.
- **Tilt Control**: On phones and tablets, an optional setting tilts gravity with the device, up to 40% of it sideways (`tilt` in `configs/game.json`). It is hidden where the device does not report its orientation, and asks permission where the browser requires it.
- **Liquid Surface**: Spheres falling off the board ripple a liquid surface at the bottom; reduced motion keeps it still.
- **Cracked Walls**: Shots bouncing off the side walls crack them, up to twelve cracks per run.
- **Automatic Star Thresholds**: A level without star thresholds gets them from its starting sphere count (`scoring.autoStarPointsPerBall`); tuned levels keep theirs.
- **Rail Anchors**: An anchor can slide along a horizontal rail; the pull of the spheres it holds drags it, so clearing one side of a cluster lets the other side swing it over.
- **Thrusters**: A thruster sphere pushes upward against gravity and lifts what it is bonded to.
- **Tethers**: A tether sphere binds to spheres farther away with long links that hold weight, never snap and never carry a color group.
- **Rust**: A colorless, inert sphere that blocks every group. Explosions, rockets, the anvil and avalanches remove it, and a Paint Core turns it back into a colored sphere.
- **Rocket Shot**: A sixth special ball (key 6, 40 coins in the shop) fires three homing rockets at the hardest targets: spheres with a modifier first, then anchors. Rockets hit like a blast, so a Boss Core only loses a shield.
- **Levels 21 to 24**: One level per new mechanic, with tutorials and simulated-play star thresholds; Flux Mode rolls thrusters, tethers and rust from stage 14, and Survival waves roll them at low weights.
- **New Modifiers in Survival and Daily Challenge**: Waves now roll chained spheres, bubbles and freeze, lightning and paint cores (`endless.modifierWeights` in `configs/game.json`).
- **Visible Chains**: Each chain link is drawn as a small metal link over the touching spheres, so chains show even when nothing is stretched.
- **Nine New Flux Shapes**: Pine, mushroom, bell, cat, fish, key, umbrella, lighthouse and ship anchor silhouettes; six of them hang partly from neutral anchors.
- **New Modifiers in Flux Mode**: From stage 8, Flux shapes roll chained spheres and bubbles; from stage 11, freeze, lightning and paint cores too (`modifiers` in `configs/flux.json`).
- **Neutral Anchors**: Gray anchors that no match can break. Bombs, lightning and the anvil remove them, and they crumble on their own once no sphere hangs from them.
- **Chained Spheres**: Their links never snap when stretched by a rotor. An explosion breaks the chains of the spheres that survive it.
- **Bubbles**: A sphere in a bubble cannot join a group until the bubble pops, when a shot lands on it or a group next to it is destroyed.
- **Freeze, Lightning and Paint Cores**: Like the Dormant Barrel, these cores go off when destroyed: the Freeze Core freezes its surroundings for a few turns, the Lightning Core strikes its row, and the Paint Core repaints its neighbors in its color, setting up new groups.
- **Levels 17 to 20**: One level per new mechanic, each with its tutorial; star thresholds were calibrated by simulated play against the existing levels.

## [1.3.0] - 2026-10-27

### Added
- **Flux Mode**: A new endless mode that chains procedurally generated shapes under one shot reserve. Each stage picks a parametric shape (pendulum, ring, hexagon, spiral, cross, twin rings), a hanging silhouette from a character mask (heart, diamond, crown, arrow, donut, invader, hourglass) or a pair of small shapes, never repeating the previous family. A per-stage budget buys bumpers, portals, repulsors, attractors and singularities that fit around the shape; palette size and cluster modifiers follow stage tables; every fifth stage has a Boss Core. Clearing a shape pays points and coins and refills shots, and the next shape slides in. Runs are seeded and resume on the same shape after a reload; the best score and the furthest stage are kept separately. Tuning lives in `configs/flux.json`.
- **Layout Registry**: Campaign layouts are now pure geometry generators in `src/game/layouts/LayoutGenerators.js`, shared by the campaign and Flux Mode; all 16 levels produce the same positions, anchors and bonds as before.
- **Slow Motion**: Time slows down while a shot flies close to one of the last three spheres of a level or Flux shape (`juice.slowMotion` in `configs/game.json`); reduced motion keeps normal speed.
- **Victory Reveal**: The victory score rolls up from zero and the earned stars pop in one after another (`victory.countUpMs` and `victory.starRevealStepMs`); reduced motion shows the final values at once.
- **Full-Width Board on Phones**: In portrait, the board spans the screen width under a one-line HUD (menu, score, shots), with a single control row for Swap, Polarity and the five special balls. Navigation, settings, coins, record and overcharge move to a slide-in menu that pauses the run while open. On a 412 px wide phone the board grows from about 300 to 412 px wide.
- **Run Resume**: The run in progress is saved after every shot and when the page is hidden, and resumes paused after a reload or a discarded tab; finishing or starting a run clears it.
- **Input-Aware Hints**: Keyboard shortcuts are shown only to mouse and keyboard players; touch players get tap and drag wording, including how to cancel a shot.

### Fixed
- **High Contrast Everywhere**: The High Contrast setting, and the system's increased contrast preference, now raise the HUD, menus and dialogs too, not only the board; forced colors mode gets visible borders and focus rings.
- **Menu and Victory**: The slide-in menu can no longer be open when the Victory or Game Over window appears.
- **Focus After a Confirmation**: Closing a confirmation opened from Pause or Levels puts the keyboard focus back in that window.
- **Tutorial Announcements**: Screen readers now announce the level tutorial when it appears.
- **Tablet Touch Targets**: Buttons are at least 44 px on touch screens of every size, tablets included.
- **Sharp Board on a New Screen**: Moving the window to a screen with another pixel density redraws the board sharp.
- **Missing Language File**: If one language file fails to load, texts fall back to the other language instead of showing raw keys.
- **Board Description**: The board's description for screen readers matches the input in use (touch, or mouse and keyboard).
- **Boss Cores in Avalanches**: A Boss Core that falls in an avalanche pays its coins and points and counts toward the Boss Slayer achievement, like a destroyed one.
- **Flux Seeds**: A Flux seed gives the same run whatever mode was played just before.
- **Saved Runs**: A saved run holding a value of the wrong type is discarded instead of corrupting the score.
- **Broken Settings**: A zero or missing timing or overcharge setting now shows the loading error instead of freezing the game.
- **Energy Barrier**: The barrier now turns off when the last Lock Core falls in an avalanche, not only when it is destroyed; before, it could stay up for the rest of the level and leave the spheres behind it out of reach.
- **Coins Paid Twice**: Reloading the page while a shot was in flight replayed the shot and paid its coins again. Coins earned during a shot or a Flux shape change are now written once the run is saved.
- **Two Tabs**: With the game open in two tabs, one tab no longer writes stale coins, upgrades or achievements over the progress made in the other.
- **Cleared Colors**: Swapping or putting a special ball back can no longer bring back a color that left the board.
- **Missed Anvil**: An anvil that crushes nothing is a miss: it breaks the combo and counts toward the next Endless or Daily wave.
- **Browser Shortcuts**: Ctrl, Cmd and Alt shortcuts are left to the browser; Ctrl+F no longer flips polarity and Ctrl+1 to 5 no longer equip a special ball.
- **Reduced Motion on the Board**: Field waves, glows and pulses hold still, and trails, bursts, shockwaves and lightning flashes are not drawn. Floating score texts stay.
- **Flux Transition Flicker**: Spheres falling between two Flux shapes no longer flicker.
- **Rotor Boards**: The aim preview is traced once per frame instead of up to six times.
- **License Text**: Restored the NOTICE wording in the Apache license.
- **Mixed Versions After a Deploy**: For up to ten minutes after an update, the page could run with the previous version's texts, styles and scripts (raw keys such as `app.nav.button.flux` on buttons, old layout). The Service Worker and the config and text loaders now revalidate every file with the server instead of trusting the browser cache.
- **Anvil Crash**: An anvil that crushed a dormant bomb (or any sphere whose destruction removes others) stopped the game with a loading error; it now keeps crushing the spheres that are still there.
- **Round End Idempotence**: A victory can no longer be paid twice in one frame, a lost level can no longer turn into a victory, and the score is frozen once a run ends.
- **Storage Resilience**: A failed `localStorage` write no longer resurrects the previous coin balance, and stored values of the wrong shape no longer crash the game.
- **Economy Guards**: Special Ammo can only be bought during an active run; special shots and all-armored matches that destroy nothing no longer count as matches.
- **Daily Challenge Determinism**: Avalanche drift uses the daily seed, and restarting a Daily Challenge keeps its seed without paying the first-play bonus again.
- **Projectile Physics**: Projectile speed is capped, fast shots no longer pass through barriers, portal loops terminate, and snapping picks the nearest sphere.
- **Rotor Torque**: Rotors are only turned by spheres actually bonded to them.
- **Game Loop**: A runtime error now stops the loop cleanly and shows the error banner instead of freezing silently; spheres no longer jitter during hit-stop or pause.
- **Layout**: Zero-scroll layout on desktop, phones and landscape phones; modals fit the viewport and keep their Close button reachable.
- **Accessibility**: Stable labels with `aria-pressed` on toggles, accessible names for power-ups and level stars, focus trap fixes, polite announcements for achievements and round results, reduced-motion support in CSS, 44 px touch targets and WCAG AA button contrast.
- **Keyboard**: Holding Space, F, Enter or a digit key no longer repeats the action.
- **Mobile Gestures**: Pull-to-refresh, scroll chaining, double-tap zoom and the tap highlight are disabled outside the board.
- **Tutorial Banner**: Sits above the danger line and lets aiming through, instead of covering the cluster on small screens.
- **Small Screens**: Polarity glyphs grow to stay readable on small boards, HUD labels are larger, the star progress line wraps cleanly, launcher buttons no longer clip their label, and Pause settings show a caption.
- **Locked Levels**: The level select says which level unlocks a locked one.
- **Offline Mode**: Service Worker cache writes complete reliably, navigations fall back to the cached page, and slow networks fall back to the cache after a timeout.

### Changed
- **Desktop Layout**: On landscape desktops the board is centered between two full-height columns of the same width. The left one holds navigation and the round stats, with larger score and shot counts; the right one holds the overcharge gauge and special balls, with Polarity and Swap at the bottom, level with the launcher. Phones are unchanged.
- **Victory Celebration**: Clearing a level no longer cuts straight to the victory window. The last falling spheres and particles keep animating for two seconds under a "Board cleared!" popup, then the window opens; the delay is `victory.celebrationFrames` in `configs/game.json`.
- **Readable Pacing**: Automatic chain reactions now go off one cluster at a time, 0.6 s apart, instead of all in the same frame. Avalanches fall about twice as slowly, special balls hold their impact for a quarter of a second, and running out of shots leaves 1.5 s for the board to settle before the defeat. All delays live in `configs/physics.json` (`chainCheckCooldownFrames`, `dropGravity`, `dropMinVerticalSpeed`, `outOfShotsGraceFrames`) and `configs/game.json` (`juice.hitStopFramesCombo`, `juice.hitStopFramesSpecial`).
- **First Visit Language**: The interface language follows the browser language until the player picks one.
- **Installable PWA**: New sphere icon with 192 px, 512 px and maskable variants.
- **Desktop Layout**: Landscape desktops and tablets put the header and HUD in a side column so the board uses the full window height (about 60 % larger on a 1366x768 laptop).
- **Design Tokens**: Neutral surface, border and text colors are CSS tokens.
- **Performance**: Aim preview, avalanche prediction and cluster searches are cached; the spatial grid is rebuilt once per substep; the static background is pre-rendered; the canvas backing store follows its displayed size.
- **Audio**: Simultaneous voices are capped, effects are throttled behind a limiter, and the audio context is suspended while hidden or muted.
- **High Scores**: Written when a run ends or the page is left instead of on every scoring event.
- **Engine**: Physics callbacks and scratch arrays are no longer allocated on every simulation step, and the seeded random generator keeps a bounded 32-bit state with the same sequence.
- **Release Checks**: The typography guard also reads LICENSE and dotfiles and catches double-encoded text and more look-alike characters; CI checks that a release tag matches the package version and that the version has a CHANGELOG section.
- **Tooling**: CI runs on Node.js 24 with every test suite, plus guards for typography and offline asset coverage; French README added.

## [1.2.5] - 2026-10-26

### Fixed
- **Rotor Layout Stability**: Spiral and Cross rotor levels no longer collapse on their own before the first shot.
- **Tension Breaks**: Clusters detached by an over-stretched bond now fall as a scored Magnetic Avalanche.

## [1.2.4] - 2026-10-26

### Added
- **Mobile Zero-Scroll Layout**: `100dvh` layout for phones, thumb aiming capture, haptic feedback, and ceiling bounce for projectiles.

## [1.2.3] - 2026-10-26

### Changed
- **Obstacle Deflection**: Stronger repulsor and attractor deflection, and a curved projectile path around singularities.

## [1.2.2] - 2026-10-26

### Changed
- **Renderer Configuration**: Removed the remaining literal fallbacks in the renderer and tuned the Daily Challenge rotor clearance.

## [1.2.1] - 2026-10-26

### Fixed
- **Daily Rotor Placement**: The Daily Challenge rotor now sits below the initial rows; refined `:focus-visible` handling and removed configuration fallbacks.

## [1.2.0] - 2026-10-26

### Added
- **Daily Challenge Rotor & Turbo Rotors Mutator**: Added a central inertia rotor with anchored ring spheres to Daily Challenge runs and wired `rotorSpeedMultiplier` into pivot motor speed and torque physics.
- **HiDPI / Retina Canvas Rendering**: Automatic `devicePixelRatio` scaling (up to 3x) for crisp rendering on mobile and high-density screens.
- **Modal Accessibility & Focus Management**: Full focus trapping (`Tab` / `Shift+Tab`), background `.app-shell` `inert` state when modals are open, automatic pause when opening Shop or Level Select overlays, and focus restoration on close.
- **Tactical Aiming & Predictive Previews**: Real-time area-of-effect (AOE) preview for Special Balls, live Magnetic Avalanche drop prediction (`findDetachedIfRemoved`), and pulsing proximity warnings near the critical danger line.
- **Magnetic Workshop Extensions**: Special Ammo in-run refill cards and an illustrated **Codex & Guide** tab with keyboard arrow navigation (`role="tab"` / `role="tabpanel"`).
- **CI Workflow & Project Documentation**: Added GitHub Actions automated test workflow (`.github/workflows/ci.yml`), `LICENSE` (Apache 2.0), `CHANGELOG.md`, and architecture overview in `README.md`.

### Changed
- **Service Worker Caching Strategy**: Switched `sw.js` to a network-first strategy with versioned offline cache fallback (`magnashot-cache-v1.2.0`) to prevent stale or mismatched ES module loads after deployments.
- **Collision-Free Spatial Hash Grid**: Replaced XOR prime hashing in `SpatialHashGrid` with an injective 2D integer pairing function so negative and positive cell coordinates never collide.
- **In-Memory Upgrade Level Cache**: Cached parsed upgrade levels in `StorageManager` to eliminate `localStorage` + `JSON.parse` calls inside the 60 Hz physics and render loops.
- **Date-Scoped Daily High Score**: Scoped `daily_best` to the active daily seed date key so each Daily Challenge tracks its own daily record.

### Fixed
- **Keyboard Navigation on HUD Buttons**: Ignored global `Enter` / `Space` shot and swap shortcuts when an interactive button or tab holds focus.
- **Campaign Completion Level Cap**: Capped `unlockLevel` at the final campaign level (`16`) so reloading after completing the campaign starts on Level 16 instead of falling back to Level 1.
- **Pointer Input Guards**: Restricted canvas firing to primary mouse/touch button (`e.button === 0`) after a valid `pointerdown` originating on the canvas.
- **Resilient Bootstrap Error Banner**: Added a bilingual DOM fallback alert if configuration files fail to load before `i18n` initialization.

## [1.0.0] - 2026-10-26

### Added
- Initial release of **MagnaShot: Magnetic Physics Edition** with 16 Campaign levels, Survival mode, Daily Challenge, 5 Special Balls, 6 Cluster Modifiers, 7 Obstacle types, Web Audio synth effects, and FR/EN localization.
