# MagnaShot: Magnetic Physics Edition

*Read this in [French](README.fr.md).*

[![Play Online](https://img.shields.io/badge/Play_Online-GitHub_Pages-38bdf8?style=for-the-badge&logo=github)](https://vblackjack.github.io/magnashot/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge)](http://www.apache.org/licenses/LICENSE-2.0)

**Live Game:** [https://vblackjack.github.io/magnashot/](https://vblackjack.github.io/magnashot/)

**MagnaShot** is a magnetic physics bubble shooter built with zero external runtime dependencies, featuring dynamic magnetic attraction and repulsion, inertia rotors, quantum portals, singularity vortices, and special power-up spheres.

---

## Features

- **Dynamic Magnetic Physics**: Same-color spheres attract, opposite magnetic poles (the colour pairs `N`/`S`, `Ξ`/`Π`, `Ω`/`Φ`) pull, and like poles curve projectile trajectories. Repulsors and attractors bend shots and also make the hanging clusters lean away from or toward them.
- **Tactical Aiming & Predictive Preview**:
  - Curved neon laser sight with animated dash flow, outer glow, and luminous ricochet nodes on wall, obstacle, and portal bounces.
  - Real-time blast/effect radius preview for all 7 Special Spheres (Bomb, Lightning, Prism, Anvil, Cryo, Rocket, Brush).
  - Live **Magnetic Avalanche** prediction highlighting unanchored spheres that will drop when upper bonds are severed.
- **15 Game Modes (Burger Menu `☰`, Interactive HUD Mode Pill `▾` & Mode Cards)**:
  - **Campaign**: 24 handcrafted levels introducing pendulums, inertia rotors, repulsors, oscillating barriers, quantum locks, linked portals, Boss Cores, neutral anchors no match can break, chained spheres, bubbles, freeze, lightning and paint cores, rail anchors, thrusters, long tethers and rust. Then 800 generated levels (25 to 824), in 20 chapters of 40: the first 12 each feature one of those mechanics, the last 8 a pair of them. More colors, spheres and modifiers, and a tighter shot margin as they go. Each block of 10 levels mixes formats: standard levels, two twists that add a mechanic from another chapter, a precision level (a small board, a tight shot count and a single bomb), an arsenal level (a big board, fewer shots and twice the special spheres) and a landmark (a drawn shape or a pair, and a Boss Core). A level's name and card badge (`Boss`, `Precision`, `Arsenal`, `Twist`) show its format. Each level is rebuilt from its number alone. The level select shows one chapter at a time, with the stars won in each, opens on the chapter being played, and offers a `< 3★` filter to show only unfinished unlocked levels (when active, the victory window's main button also jumps straight to the next `< 3★` level).
  - **Survival (Endless)**: Infinite wave defense with Gold Rush waves and Boss anomalies. A new wave comes down when the **Sag meter** fills (see below).
  - **Sag meter (Survival, Daily Challenge and Purist)**: A segmented gauge in the HUD, with a matching gauge beside the launcher, shows how close the cluster is to sinking. Every shot that removes nothing (a miss, a shot that leaves the board, a special sphere that hits nothing) fills one segment; a match leaves it as it is, and an avalanche caused by your shot that drops four or more spheres lifts it by one (three or more, up to two segments, in Purist); avalanches from chain reactions or from bonds that break while a shot is in flight do not drain it, and a shot that matches nothing but still causes an avalanche no longer counts as a miss. When it is full, the whole cluster drops one step (a new wave in Survival and the Daily Challenge, the rail in Purist) and the gauge empties. One miss before that, the gauge turns amber with a dashed outline, the HUD box pulses (still under reduced motion) and a polite announcement is made once per cycle; when it is full the outline is thick and red with a chevron, so the state never rests on colour alone. The meter has `role="meter"` with a spoken value, a creak and a shake mark the drop (no shake under reduced motion), and a Freeze turn does not fill it. Campaign, Puzzle, Blitz, Cascade, Flux, Boss Rush, Hex Grid, Magnetic Pinball, Orbital Spin, Magnetic Convoy and Merge Basin have no Sag meter (Hex Grid uses its own shot-driven ceiling descent).
  - **Purist**: Pure rules on a fixed ceiling. Stages are 10 columns wide and start with 6 rows of 4 colours, then grow by a row each stage (up to 9 rows) and a colour every 2 stages (up to 6). The whole top row is anchored. There are no special spheres, no Workshop upgrades, no tilt and no shot budget; Polarity stays. Misses fill the Sag meter, and each time it fills the **rail** (the ceiling) lowers one step and darkens, taking the cluster with it. Clearing the board scores a stage bonus and starts the next stage with an empty meter; the run ends when the cluster crosses the danger line. Purist keeps its own records (best score and best stage), its Share result carries the stage, the score and the number of rail drops (no link), and it opens at campaign level 4. Its card is the first of the arcade strip in the Level Select.
  - **Daily Challenge**: Deterministic daily seed (every player gets the same starting board, the same waves and the same launcher colour rolls that day, with the same rules for all: no Workshop upgrades and no shop ammo) with rotating physics mutators (*Hyper Gravity*, *Turbo Rotors*, *Super Magnetism*, *Volatile Cluster*, *Portal Matrix*, *Bumper Pinball*, *Cryo Surge*), a daily coin reward, and an escalating consecutive-day **Daily Streak** bonus (`+15 ⬡/day`, up to `+150 ⬡` on day 11). When the run ends, **Share** sends a spoiler-free result (challenge number, mutator, wave, score, one symbol per wave passed with gold rush and boss waves marked) through the system share sheet, or copies it to the clipboard. Survival and Flux runs share their wave or shape and score the same way; a Flux result also lists the assists used (Workshop levels, ammo bought, continue), when any. The Daily game over says when the next challenge starts, and the menu marks a challenge already played today. One missed day is forgiven, but only once every 7 days: a single break does not reset the streak, a second one within 7 days does. The game over says whether the grace day is available, says it was used only on the day it was, and otherwise says when it comes back.
  - **Flux Mode**: An endless chain of procedurally generated shapes sharing one shot reserve. Three stages in four draw a generated silhouette among more than 850 distinct shapes, each checked to hang clear of the danger line when left alone: stars, flowers, gears, polygons, crescents and hearts, solid or hollow, of several sizes and proportions, named after their shape ("7-Point Star", "Hollow 5-Petal Flower"). The others draw a parametric rotor or pendulum, a hand-drawn silhouette (heart, crown, bell, lighthouse, ship anchor...), some held by neutral anchors, or a pair of small shapes, never the same family twice in a row. A difficulty budget adds bumpers, portals, repulsors and singularities as the run goes on, every fifth stage is a Magnetar boss, later stages add chains, bubbles and freeze, lightning and paint cores, and clearing a shape refills shots. Runs are seeded, so a reload resumes on the same shape, a finished run can be replayed on the same seed (`Same Seed`), every player on the same seed gets the same shapes, boards and launcher colour rolls, shared links (`?flux=<seed>`) open directly on that seed (asking first when another run is saved), and the Level Select toolbar lets players enter or paste any Flux seed code or share text directly. After every third cleared shape the run pauses on a **perk choice**: pick one of three offered perks (keys `1` to `3`, or tap a card), each stackable up to three times for the rest of the run. The six perks are **Reserve** (extra shots now), **Refill** (extra shots on every later shape clear), **Blast** (wider special sphere blasts), **Surge** (faster Overcharge), **Arsenal** (random special spheres now, among the special spheres you start with) and **Golden** (extra coins on every later shape clear). Held perks show as chips in the HUD and the menu, and restarting a run past the first shape asks for confirmation.
  - **Progressive Mode Unlocks**: A new player starts with Campaign and the Daily Challenge, which are always open. The other modes open as the campaign is cleared: Survival at level 3, Purist at level 4, Puzzle at level 5, Polarity Duel at level 6, Blitz at level 7, Flux at level 8, Cascade at level 10, Boss Rush at level 12, Hex Grid at level 13, Magnetic Pinball at level 14, Orbital Spin at level 15, Magnetic Convoy at level 16 and Merge Basin at level 17. A locked card in the Play hub says which level opens it, a newly unlocked mode is marked "New" (on its card and on the menu's Play button) until first used, and the victory screen announces it. The Weekly Flux opens after campaign level 5, and playing it opens Flux. A shared Flux link (`?flux=<seed>`) always works and unlocks Flux, and existing players keep every mode they already had.
  - **Weekly Flux**: A Flux run on a seed shared by every player for the current ISO week (Monday 00:00 UTC to the next Monday). The first start of the week's seed, whichever way it is started (the Weekly button, a shared link, the seed field or Same Seed), pays a `40 ⬡` bonus once per week; a restart or a resumed run never pays, the menu shows the weekly best once set, and the shared result opens on a Weekly Flux header with the week. A restart keeps the seed of the running week.
  - **My Stats**: The menu's **My stats** dialog shows an overview (play time, shots fired, runs, wins and records per mode, campaign progress, the levels you fail or leave most) and a **Daily history** of your last 60 Daily Challenges (date, challenge number, mutator, score, wave and streak). **Copy my stats** puts an anonymous text summary on the clipboard. Everything is stored on the device only; nothing is sent anywhere. The best Daily and Weekly Flux runs also keep a compact per-shot score timeline.
  - **Ghost Duels**: Race a friend's run on the same board. Share a Daily or Flux result and its last line is a challenge link that carries your score after each shot (never your inputs, a short link of about 600 characters). Opening a link shows a Duel card, and nothing starts until you accept (a saved run asks for confirmation first). A duel works on today's Daily, on any Daily of the last 30 days (a **rematch**: same board, but no first-play bonus, no streak and no Daily record) and on any Flux seed, Weekly Flux included. A rival badge in the HUD shows your live gap (`+1,240 vs Sam`, `-320 vs Sam`, `= Sam`, with the sign always written, and `(final)` once their run has ended) in place of the best-run marker, with polite announcements when the lead changes, when their run ends and when you pass their final score. The game over states the result (`You beat Sam by 120`, `Sam wins by 40`, `Dead heat with Sam`) and Share then becomes **Share challenge**, so the duel can be passed back. An optional **Duel name** in Settings (12 letters or digits) is shown to the friends you challenge. It is a friendly rivalry only: no leaderboard, no coins or achievements for beating a ghost, links are unsigned and validated strictly (size, checksum and canonical form), and a damaged or too old link shows an explanation instead of starting. **My stats** keeps your last 10 duels and your record.
  - **Polarity Duel**: A head-to-head match against the CPU, two Classic-style boards side by side, best of three rounds. It opens at campaign level 6. See [Polarity Duel](#polarity-duel) below.
  - **Progress transfer**: Open Settings and choose **Export progress** to download a MagnaShot JSON file. On another device or browser, open Settings, choose **Import progress**, select the file and confirm. The imported entries replace their counterparts. Device settings and the current saved run stay on the destination.
  - **Billiards prototype**: Open **Play > Arcade > Billiards (prototype)** on any profile. Try the direct shot, the one-cushion shot and position play. Aim from the cue ball in any direction and choose the power before shooting. The cue ball stays where it stops. Each table can be replayed immediately.
  - **Merge Basin shake prototype**: Add `?mergeShake=1` to the game URL and start a new Basin run after unlocking the mode. Four drops charge a small lateral impulse. Use the Shake button, G or the right bumper. The optional phone gesture is in Settings and starts off. The variant has separate records.
  - **Play Hub and Campaign Map**: The menu holds three entries (**Play**, **My stats**, **Settings**) and the current-round actions. **Play** opens a hub with every mode in four sections: Campaign (Continue the current level, or open the map), Challenges (Daily Challenge and Weekly Flux with their coin bonus), Arcade (Survival, Purist, Puzzle, Blitz 90s, Flux, Cascade, Boss Rush, Hex Grid, Magnetic Pinball, Orbital Spin, Magnetic Convoy, Merge Basin, in unlock order) and Duel (Polarity Duel, plus the two-player entry where it fits). The Pause and Game over dialogs and the HUD mode pill offer **Change mode** to return to it. The **Campaign map** is campaign only: a chapter switcher, compact level tiles (arrow keys, Home, End, PageUp and PageDown) and a detail panel. A tap selects a level and a tap on the selected level plays it, so the current level still takes one tap.
  - **Arcade Modes (via the Interactive HUD Mode Pill `▾` and the Play hub cards)**:
    - **Puzzle Mode**: 10 deterministic trick-shot stages with a fixed launcher queue (`1` or `2` shots, no swap), Workshop upgrades, tilt and Overcharge off, a goal banner per stage, and a direct stage selector (`P1` to `P10`) under the Puzzle card of the Play hub (with polite unlock hints on locked stages) that shows each stage's best score and stars (3 on the first attempt, 2 within 3 attempts, 1 otherwise, an attempt being counted on the first shot; stages 3, 7 and 9 also need a score for the third star; save schema 7 keeps stages below the saved best stage at 1 star and deletes nothing). Objectives are **Core Rescue** (`💎`), where freeing all Rescue Cores shatters the remaining cluster into an instant avalanche, or clear the board.
    - **Blitz 90s**: 90-second Time Attack with unlimited shots, live wave tracking in the HUD mode banner, rapid automatic wave descent, and a 3-second hesitation auto-fire timer displayed as a countdown ring around the launcher.
    - **Boss Rush**: Central rotor Titan (`👑`) surrounded by concentric rings where reaching 100% Overcharge directly cracks a Boss shield and defeating the Titan shatters the wave.
    - **Magnetar bosses (Boss Rush and Flux boss stages)**: The boss of every Boss Rush wave and of every fifth Flux stage is a **Magnetar**, a colourless field core that no match, bomb, lightning, rocket or anvil can break. Its health is its **Moorings**: the anchor spheres still holding it up through bonds (dashed lines with a bracket mark; shown in the HUD in place of the shots count in Boss Rush, and in the Flux banner on boss stages, where the shots count stays). Snap them by matching them or cutting the bonds that lead to them; in Boss Rush a full Overcharge snaps one Mooring. Regrow never adds anchors (a sphere bridging an anchor back can still reconnect one, and the count always matches what really holds the Magnetar); once nothing holds the Magnetar it falls in an avalanche, the only way to beat it (900 points, 40 per sphere in the same avalanche, 40 coins). Every few turns it **arms** one of four patterns, shown a turn ahead by a badge over the core and a HUD chip ("Next turn: ...") with a glyph and words, never colour alone, and announced politely once: **Reverse field** (your shot curves the other way; flip polarity to cancel it), **Undertow** (a dotted field pulls your shot toward the core; bank through it into a Mooring), **Regrow** (up to 3 spheres appear in the dashed slots around the cluster, never anchors; fill a slot or snap a Mooring first) and **Barrage** (charged spheres rise from the danger line over 2 turns; shoot the opposite polarity to neutralise them). Later waves and stages arm more patterns, more often. The Codex lists the four patterns, and the campaign's landmark Boss Cores are unchanged. When a Magnetar falls, it plays its own sound and shakes the screen (no shake with reduced motion).
    - **Cascade Drop**: High-gravity magnetic well where spheres drop from the top onto support platforms and antimagnet cushions.
    - **Hex Grid**: Rigid hexagonal lattice with straight-line shots (`disableMagneticCurve`), ceiling snap, 6-neighbor matches, ceiling-connected avalanches and periodic ceiling descent. Purist fair-play rules (no special spheres or Workshop upgrades); flipping Polarity (`F`) arms a deterministic 1-cell magnetic pulse on landing, previewed in the aim sight, that pulls matching spheres inward or pushes non-matching neighbors outward.
    - **Magnetic Pinball**: Top-mounted downward cannon shooting under projectile gravity across anchored peg stages with uncapped elastic bounces and kinetic special spheres (*Bomb*, *Lightning*, *Anvil*, *Rocket*). Lighting every **Core Peg** clears the stage and refills shots; flipping Polarity (`F`) mid-flight bends the live ball trajectory between bounces, and an oscillating bottom **Magnetic Collector Bucket** refunds `+1` shot on catch.
    - **Orbital Spin**: Zero-gravity arena around a free-spinning hexagonal central core driven by off-center shot angular momentum (`r x J / I`), bounded by a circular containment ring (`RING_BREACHED` defeat) and escalating asteroid ring waves. Detached spheres drift radially outward in 360 degrees into 4 peripheral **Magnetic Collector Arcs** for bonus score and Overcharge.
    - **Magnetic Convoy**: Central 360-degree rotating turret surrounded by continuous sphere trains advancing along 4 parametric tracks (*Spiral*, *Serpent*, *Figure-8*, *Orbit Loop*) toward a Singularity drain (`VORTEX_REACHED` defeat). Shots insert into the train, Freeze slows rail advance, and when a match opens a gap whose exposed ends share a color or opposite magnetic polarity (`N`/`S`), the front segment snaps backward into the rear segment for cascading chain combos.
    - **Merge Basin**: Top horizontal Drop Rail (`Left`/`Right` or pointer X) over a rigid-body basin with 10 discrete integer-radius sphere calibres (`1` to `10`). Touching identical calibres fuse into `calibre + 1` with a radial magnetic shockwave that unsticks surrounding piles (`10 + 10` triggers a Supernova clear), Polarity (`F`) biases same-calibre attraction in the basin, device tilt is supported, and sustained overflow above the top line ends the run.
- **Learning the Game**:
  - A first-encounter hint explains each mechanic the first time it reaches the board, in every mode: the level tutorial when there is one, else its Codex entry. A hint is kept until you dismiss it or use the mechanic; one left open gives way to the next after three turns (one hint per turn), and **Settings** can show them all again. Polarity, Resonance, Sag and each special sphere get their own hint, with the matching control pulsing (an outline replaces the motion when reduced motion is on). A **?** button in the HUD replays the current level's hints, and the first time you play a level (when no hint is up) a non-blocking objective banner shows its name, shots and focus. Levels 2 to 4 introduce one new special sphere each. In the campaign, what the level is built around is explained first.
  - Level 1 keeps to matching and avalanches: three colors, no special sphere, no modifier; the special sphere slots appear once there is one to use.
  - A level that teaches a modifier always shows the same number of it, set in its definition.
- **Game Feel**:
  - **Avalanche Collector Bins & Second Chance**: Falling avalanche spheres crossing the 5 bottom collector bins (labelled `+35` on the board) grant bonus points (`+35 pts`) and Overcharge (`+4%`). Running out of shots in Campaign or Flux Mode offers a once-per-round **Second Chance** (`+5 shots` for `40 ⬡`).
  - **HiDPI Offscreen Sphere Sprites & Arena Atmosphere**: Spheres are pre-rendered into offscreen sprite caches with rim-lighting and dual specular highlights, magnetic bonds pulse with a dual-layer energy halo, floating texts pop in elastically (clamped inside the arena walls), and the static arena layer combines a radial launcher glow, peripheral vignette, grid intersection nodes, and corner brackets.
  - **Spectacular Special Sphere Detonations, Shattering Spheres & Cinematic Slow-Motion**: Instead of vanishing instantly on frame 0, destroyed spheres visibly get knocked outward by the blast, swell (`1.0x` to `1.46x`), glow white-hot from within, split along radial fracture lines, and shatter into secondary fireball puffs and long-tailed sparks during the slow-motion window. Explosive and kinetic special spheres (*Bomb*, *Lightning*, *Anvil*, *Rocket*, *Prism*, plus *Dormant Barrels* and *Boss Cores*) trigger multi-stage fireball clouds, 12-ray starburst spikes, an arena impact flash, concentric shockwaves, targeted lightning arcs, and a colored perimeter slow-motion vignette (`getTimeScale`) that automatically turns off under Reduced Motion.
  - **Danger Line Proximity Glow & Enriched Run Summary**: Spheres entering the danger warning zone emit a pulsing radial warning halo (static in reduced motion), and the Game Over screen reports detailed run metrics (wave/stage reached, max combo, and coins earned) with spoiler-free **Share** support across all 14 non-campaign modes.
  - **Near-Miss Line and Best-Run Marker**: When a run in a mode with a record (Survival, Daily, Cascade, Blitz, Flux, Boss Rush) ends within half of that record, the game over says how far it fell short, as plain information next to the stats (a run far below the record says nothing). In Flux and Boss Rush, a compact "Best" marker in the HUD shows the record the run started against; score modes already show it in the HUD.
  - Every landing sends a swelling wave through the cluster, bond by bond and weaker at each step, with a light screen shake. The wave only changes how spheres are drawn; reduced motion turns both off.
  - The victory score rolls up and the earned stars pop in one after another; both respect reduced motion. The victory screen also shows how many points remain to reach the next star (or confirms 3★), and highlights new personal records across Campaign, Survival, Daily Challenge, and Flux Mode, while Campaign and Flux defeats report how many spheres were left on the board.
- **Workshop & Codex**:
  - Permanent upgrades (*Curved Laser Sight*, *Magnetic Amplifier*, *Overcharge Capacitor*, *Projectile Reserve*, *Collector Magnet*).
  - In-run Special Ammo refills (clicking or pressing `1`-`7` on an empty special sphere opens this tab), **4 Unlockable Sphere Visual Styles** (*Classic*, *Crystal*, *Neon*, *Metallic*) with live visual preview orbs, Bounties/Achievements with persistent all-time personal-best progress bars, grouped in Bronze, Silver and Gold tiers per family (new families for Flux shapes and Boss Rush waves), and an illustrated **Codex & Guide** covering cluster modifiers, magnetic obstacles, special spheres, Daily Challenge mutators, and core board & launcher mechanics (*Polarity Inversion*, *Magnetic Collector Bins*, *Overcharge Gauge*).
- **Accessibility & Comfort**:
  - Bilingual interface (**FR** / **EN**) with zero hardcoded strings; the first visit follows the browser language.
  - **High Contrast** mode with enhanced borders and colour symbols (`N`, `S`, `Ξ`, `Π`, `Ω`, `Φ`), distinct from the polarity `+`/`-` sign; buttons meet WCAG AA contrast.
  - **Color Patterns** setting: each color gets its own pattern (stripes, dots, grid, rings) inside the spheres.
  - **Reduced Motion** toggle and **Animation Speed** selector (`0.5x`, `1x`, `1.5x`, `2x` for explosions, shattering spheres, shockwaves, and slow-motion detonations) in **Settings**, plus automatic pause on tab switch.
  - **Fullscreen Toggle** (`⛶`) right on the top HUD bar on portrait phones and tablets, as well as in **Settings** across all devices, hiding browser address and navigation bars (`navigationUI: 'hide'`). The toggle is hidden when the installed app already runs fullscreen.
  - **Tilt Control** on phones and tablets, on by default: tilting the device leans gravity sideways. On iPhone and iPad, the first tap on the board asks for the motion permission. It can be turned off in **Settings**.
  - Screen reader support: labelled toggles with `aria-pressed`, named power-ups and level stars, and polite announcements for achievements and round results.
  - Full mouse, touch (with vertical finger offset and pull-down shot cancellation), and keyboard controls; held action keys do not auto-repeat. The arrows fine-tune a mouse aim: after an arrow, small mouse movements leave the aim alone and a click shoots along it.
  - Zero-scroll layout on desktop, phones and landscape phones, with 44 px touch targets and a unified slide-in burger menu (`☰`) across all viewports (grouping *Play*, *My stats*, *Settings* and *Current Round* actions while pausing the run). On portrait phones the board spans the full width and a compact line under the score keeps the round, coins and best score in view. The board takes the shape of the 470 x 820 world. On landscape desktops the board uses the full window height, centered between two columns of the same width: the burger menu button, interactive mode selector pill (`▾`) and round stats on the left, overcharge, special spheres, Polarity and Swap on the right.
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

### Controller support

Plug in or pair a gamepad with the standard layout and press any button: the game switches to controller hints and the menus become navigable with the d-pad. Pads with a non-standard layout are ignored. Keyboard, mouse and touch keep working at all times.

| Action | Controller |
| :--- | :--- |
| **Aim** | Left stick (right stick for fine aim, left trigger held for precision, d-pad left / right for tiny steps) |
| **Shoot** | Bottom face button or right trigger |
| **Swap Sphere** | Left face button |
| **Flip Polarity** | Top face button |
| **Unequip Special Sphere** | Right face button |
| **Previous / next Special Sphere** | Left / right bumper |
| **Pause / Resume** | Start |
| **Menu** | Select |
| **Replay the level hint** | Left stick click |
| **Center aim** | Right stick click (straight up, straight down in Pinball, or center of the Merge drop rail) |
| **Menus: move / confirm / back** | D-pad or left stick / bottom face button / right face button |
| **Menus: previous / next tab** | Left / right bumper |

If the pad disconnects during a run, the game pauses. In **Settings**, the **Controller** group (shown only while a pad is connected) turns controller input on or off and sets the stick deadzone (small, medium, large), the aim speed (slow, normal, fast) and the horizontal aim inversion; the choices are stored locally. A **Vibration** option (in the Accessibility group, on by default) lets a pad that supports it shake when a charge lands on your board, when a field pulse hits you and when you lose a round; it stays silent with reduced motion. The same option also switches the haptics of a phone on or off.

---

## Polarity Duel

A head-to-head mode against the CPU, opened at campaign level 6 from its card in the Play hub. Pick a difficulty (**Easy**, **Normal**, **Hard**); Hard opens once you have beaten Normal. Each side plays its own Classic-style board (a full anchored top row, no obstacles, no upgrades, no coins).

- **Attacks**: a shot that makes spheres fall sends **charged spheres** to the other board. They rise from the defender's danger line toward the cluster and snap into it if nothing stops them. A bigger avalanche, a chain reaction or a special sphere sends more.
- **Polarity**: every charge has a sign (`+` or `-`). A shot of the **opposite** polarity shatters a charge (a strong one needs two hits), a shot of the **same** polarity bounces off it. The sign of your shot is drawn on the launcher spheres and on the Polarity button, the aim preview shows what the shot would do to the first charge it crosses (a crack to shatter, a rebound arrow to bounce), and the Polarity key or button flips the sign. Bombs and lightning clear every charge they reach.
- **Guard streak**: every 3 charges neutralised grants a special sphere.
- **Field pulse**: neutralising charges fills the Overcharge meter; a full meter fires a field pulse that lowers the opponent's anchor rail one step.
- **Match**: best of 3 rounds; a round is lost when a board crosses its danger line. If both fall together the round is replayed. After 3 minutes **sudden death** lowers both rails every 20 seconds.
- **Screens**: on wide screens (tablets, desktop) the two boards sit side by side; on phones the CPU board becomes a mini-view next to or above yours. The same controls as a single player run work, and a controller is supported.
- **First duel tutorial**: the first time you start a duel on a device, a short dialog explains charges, the polarity guard and the field pulse in three steps while the match waits. Skip it at any step (Escape, the Skip button or the controller's back button); it is not shown again.
- **Sound**: each board plays on its own side of the stereo field (the first board on the left, the second on the right).
- **Records**: your wins and losses per difficulty are kept locally and shown in **My stats**; the result card has a Share button.

### Two players on one device

Under the difficulty picker, **2 players (same device)** opens a lobby for a match between two people on the same screen: no CPU, the same rules, best of 3 rounds. The entry is only shown on wide screens (at least 680 px wide and 520 px tall); on a phone it is not offered, and a match that is shrunk below two boards pauses and waits for a larger window (the Pause dialog says so and Resume stays out of reach until the boards fit).

Each player picks a device in the lobby, and pressing a join key or a controller button takes a free place:

| Device | Player | How to join | Controls |
| :--- | :--- | :--- | :--- |
| **Left half of the keyboard** | 1 | `W` | `A` / `D` aim (hold `Left Shift` for fine aim), `W` shoot, `S` swap, `Q` flip polarity, `E` next special sphere |
| **Right half of the keyboard** | 2 | `Up` | `Left` / `Right` aim (hold `Right Shift` for fine aim), `Enter` shoot, `Down` swap, `/` flip polarity, `.` next special sphere |
| **Left keys and mouse** | 1 | Change device | The left keys above, and the mouse aims and shoots on the first board |
| **Touch** | 1 or 2 | Change device | Drag on your own board; each board follows its own finger, so both players can touch at once |
| **Controller** | 1 or 2 | Press the bottom face button | The controls of the single player run; Start or Select pauses, the back button frees the place in the lobby |

- The aim follows the keys while they are held, so both players can aim at the same time. The key names follow your keyboard layout (an AZERTY keyboard shows `Z` where this table says `W`); the number pad twins of Enter, `/` and `.` work as well. Space, `F` and the digits do nothing in a two-player match, and Escape pauses.
- **Handicap**: each player can slow down the rise of the charges that arrive on their own board (normal, x1.25 or x1.5), for a mixed-skill match.
- A controller that is unplugged during the match pauses it; press the bottom face button on any other controller to take its place, or quit.
- The result card names the winner and shows the score, the charges neutralised and the pulses of each player, with **Play again** (same devices and handicaps), **Change players** and **Back**. A finished match only adds to a "2P matches" count in **My stats**: no personal statistics or CPU records change, and there is no Share button.
- Two things depend on your hardware. Many keyboards cannot report every key combination at once (ghosting), so if a key stops responding while both players hold several keys, use a controller or touch for one player. On Windows, pressing Shift five times opens Sticky Keys, which can interrupt the fine aim keys: turn the shortcut off in the system settings if that happens.

---

## Pulse: music and Resonance

- **Music**: an original procedural score synthesised in the browser, with its own tempo, key and chord progression for each of the fifteen modes (Merge Basin 88 BPM up to Blitz 132). It plays only while a run is being played: opening a menu, pausing, losing or winning fades it out, and nothing plays on the menus. It builds with the pressure on the board: a pad and a bass at rest, then an arpeggio, busier hats and a filter that opens as the Sag meter fills, the cluster nears the danger line or charges close in on your board. It never uses the random streams of a run. The music starts after your first tap or key press (browsers refuse sound before that).
- **Settings**: the **Sound** button still mutes everything. **Music** switches the score on or off (effects keep playing) and **Music volume** cycles 20, 40, 60, 80 and 100 percent (the Music button alone turns the score off). All are stored locally. Settings are grouped in four sections: **Audio**, **Gameplay**, **Accessibility** and **Controller**.
- **Resonance**: a shot released within 5 frames of the beat (about a twelfth of a second, never more than 12 percent of the beat) is **Resonant**. A beat ring around the launcher shrinks onto it every beat; while the window is open the ring turns solid and thick, outside it is thin and dashed, so the cue never depends on colour alone. A Resonant release flashes the launcher, shows "Resonance!" and plays a short arpeggio.
  - **Unlock**: Resonance unlocks after campaign level 5, in every solo mode where Overcharge applies. A hint explains it the first time it applies, and the Codex gets a **Resonance** entry. Polarity Duel boards always have it. **Purist**, **Puzzle**, **Hex Grid** and **Merge Basin** have none. The music plays from the start either way.
  - **Solo modes**: if a Resonant shot's turn makes at least one match or drops at least one sphere, all the Overcharge earned that turn is multiplied by 1.5. A whiff earns nothing extra.
  - **Polarity Duel**: a Resonant shot that hits a charge of the opposite polarity removes 2 strength instead of 1 (what you send is unchanged). The CPU gets Resonant shots by a dice roll per difficulty (Easy never, Normal 35 percent, Hard 65 percent) drawn from its own seeded stream, so it never changes the rest of the match. The difficulty picker has a **Resonance** option, set from your global setting each time it opens.
  - **Where it is off, and why**: the **Daily Challenge** (rematches included), the **Weekly Flux**, Flux runs from a **shared seed link** and **Ghost Duels** never use Resonance, whatever the setting, so that their scores stay comparable. The music still plays there; only the ring is hidden.
  - **Settings**: the **Resonance** button turns the bonus and the ring off for everything else. Resonance is judged on game frames, never on the clock, so a run replays the same way; there is no beat vibration.
- **Calibrate rhythm** (Settings): tap along with eight ring pulses (with clicks, or silently when muted). The median distance between your taps and the pulses, at most 200 ms either way, becomes an offset that only shifts how your timing is judged; **Reset** clears it.

---
## Architecture Overview

The codebase follows a modular, zero-dependency ES module architecture with strict data/logic separation (`configs/*.json` and `locales/*.json`):

```text
├── configs/                  # Externalized game, physics, ball, obstacle, audio, mode, level, campaign & Flux data
├── icons/                    # PWA icons (SVG, maskable SVG, 192 px and 512 px PNG)
├── locales/                  # Bilingual translation dictionaries (fr.json, en.json)
├── scripts/
│   ├── calibrate-campaign.mjs# Offline campaign level calibration CLI
│   ├── calibrate-flux-shapes.mjs # Settles every generated Flux shape idle and writes configs/fluxShapeTuning.json (`npm run calibrate:flux`, offline)
│   ├── calibrate-classic.mjs # Offline report of how hard Purist is for the greedy bot (prints, never writes)
│   ├── calibrate-versus.mjs  # CPU tier gate: Hard and Normal must beat Easy, pulses per round stay in range (`npm run calibrate:versus`, run by CI)
│   ├── pages-artifact.mjs    # Builds the GitHub Pages artifact (_site/) with only the runtime files
│   ├── release.mjs           # Release preparation: bumps versions and promotes the CHANGELOG Unreleased section
│   └── bot/
│       └── CampaignBot.js    # Greedy and arsenal calibration bots
├── src/
│   ├── main.js               # Application bootstrap, pointer input guards & Service Worker registration
│   ├── core/
│   │   ├── ConfigRegistry.js # Parallel JSON configuration loader
│   │   ├── GamepadInput.js   # Pure gamepad reader: deadzone, response curve, press edges, menu auto-repeat, active pad choice
│   │   ├── StorageView.js    # Read-only storage view for a duel board: settings forwarded, every write a no-op
│   │   ├── AudioChannel.js   # Per-board audio wrapper: own mute and pan, scoped stopAll
│   │   ├── Constants.js      # Frozen enums and mathematical constants
│   │   ├── I18n.js           # Localization service and DOM attribute translator
│   │   ├── SeededRandom.js   # Deterministic PRNG (Mulberry32) for Daily Challenges and Flux runs
│   │   ├── StorageManager.js # Cached localStorage persistence with in-memory fallback, versioned save schema (ordered migrations, legacy prefix merge)
│   │   ├── installMethods.js # Installs a domain module's methods on a class prototype
│   │   ├── WorldGeometry.js  # Launcher, danger line and content offset derived from the world size
│   │   ├── AudioManager.js   # Procedural Web Audio API synthesizer (effects, music bus, mute and visibility handling)
│   │   └── MusicEngine.js    # Procedural music: look-ahead scheduler, per-mode patterns, intensity layers, phase lock to the beat
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
│   │   ├── EngineModes.js    # GameEngine module: starting every solo and Arcade mode, Flux perks & stage transitions
│   │   ├── EngineRoundFlow.js# GameEngine module: wave types, round end checks, game over & continue pack
│   │   ├── EnginePulse.js    # GameEngine module: beat clock, Resonance judgement, Overcharge bonus, music pressure and beat state
│   │   ├── Resonance.js      # Pure Resonance rules: beat window, offset, where it applies, ring shape, calibration median
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
│   │   ├── MagnetarRules.js  # Pure rules of the Magnetar bosses: tiers, pattern schedule, Moorings, Regrow slots, Barrage plan, fall reward
│   │   ├── EngineMagnetar.js # GameEngine module: Magnetar state, warnings and effects, Mooring snaps, Barrage charges, fall and view for the HUD
│   │   ├── SagMeter.js       # Pure rules of the Sag meter: whiff test, fill and avalanche drain, lowering and warning phase
│   │   ├── WeeklyFlux.js     # ISO week key, weekly Flux seed and countdown to the next week
│   │   ├── PlayerStats.js    # Pure local statistics: runs, shots, play time, hardest levels, anonymous stats text
│   │   ├── ShotTimeline.js   # Compact per-shot score timeline kept for the best Daily and Weekly Flux runs
│   │   ├── GhostCodec.js     # Pure encoder and strict decoder of duel links (versioned, checksummed, canonical)
│   │   ├── GhostDuel.js      # Pure duel rules: ghost score by shot, live gap, announcements, outcome
│   │   ├── EngineGhostDuel.js# GameEngine module: duel start and rematch, ghost comparison per shot, result and challenge link
│   │   ├── EngineProgress.js # GameEngine module: statistics, mode unlocks, Daily history, Weekly Flux and timeline hooks
│   │   ├── VersusRules.js    # Pure Polarity Duel rules: attack table, polarity, charge rise and hits, guard streak, rounds, sudden death
│   │   ├── EngineVersus.js   # GameEngine module: seeded duel board, charges (rise, hits, landing), field pulse and aim preview prediction
│   │   ├── VersusMatch.js    # Match controller of two boards: CPU tiers, attack routing, rounds, sudden death and announcements (also headless)
│   │   ├── BotBrain.js       # Pure bot decisions (greedy aim, shot value, arsenal plan) with an injected random stream
│   │   ├── modes/            # Pluggable Arcade sphere-physics mode behaviors (Hex Grid, Orbital, Pinball, Convoy, Merge)
│   │   └── layouts/
│   │       ├── LayoutGenerators.js   # Pure shape geometry: pendulum, rings, hexagon, spiral, cross, masks
│   │       ├── ShapeGenerator.js     # Generated Flux silhouettes: polar curves on the sphere grid, quality filter
│   │       └── FluxStageGenerator.js # Seeded Flux stages: shape family, difficulty budget, boss core
│   └── ui/
│       ├── CodexView.js      # Illustrated Codex & Guide tab rendering
│       ├── CanvasInput.js    # Canvas pointer and touch aiming, bound to any board's engine
│       ├── LocalInput.js     # Pure two-player helpers: split keyboard mapping, device slots, pointer rules, wide-screen check
│       ├── FluxPerkView.js   # Flux perk choice dialog and active perk chips
│       ├── LevelSelectView.js# Campaign map: chapter switcher, level tiles, detail panel, format badges & < 3★ filter
│       ├── PlayHubView.js    # Play hub: campaign, challenges, arcade and duel cards, disclosures
│       ├── UIManager.js      # UI core: construction, wiring and the modules below
│       ├── UIHelpers.js      # Pure UI helpers and constants: focus-trap filtering, formatters, share and victory resolvers, shared WeakMaps
│       ├── UIHudRefresh.js   # UIManager module: HUD and menu refresh
│       ├── UIGamepad.js      # UIManager module: controller routing, menu focus navigation, Settings controller row
│       ├── UIVersus.js       # UIManager module: Polarity Duel difficulty picker, screen, layouts, pause, result and records
│       ├── UIVersusLocal.js  # UIManager module: two players on one device, entry, lobby, devices and handicap
│       ├── UICalibration.js  # UIManager module: music driver in the frame hook, audio unlock and the rhythm calibration dialog
│       ├── PulseDriver.js    # Starts, stops and steers the music from the run on screen
│       ├── RhythmCalibration.js # Pure state machine of the calibration: pulses, taps, median offset
│       ├── VersusHud.js      # Polarity Duel HUD: layout choice, announcements, top bar, incoming charges, pulse meter and controls
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

# Run the slow strength test (Hard must beat Easy in at least 80% of 50 seeded Polarity Duel matches)
npm run test:slow
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
- `ghostCodec.test.js`, `ghostDuel.test.js`, `ghostStorage.test.js`, `ghostEngine.test.js` and `uiGhostDuel.test.js` check the duel link (round trips, rejection of every truncation and bit flip, strict caps, fuzzing that never throws and always re-encodes identically), the ghost interpolation, announcement hysteresis and outcomes, the bounded duel history and alias, the duel lifecycle (rematch without bonus or streak, tilt lock, restart, reload and Continue), and the duel card, rival badge, game over line and challenge share.
- `versusRules.test.js`, `versusEngine.test.js`, `versusMatch.test.js`, `versusHud.test.js`, `uiVersus.test.js` and `versusRecords.test.js` check the Polarity Duel (with `localInput.test.js` and `uiVersusLocal.test.js` for the two-player mode): the attack table, polarity and charge rules, charge rise, hits, landing and field pulses, seeded identical CPU matches, rounds and sudden death, the storage view that writes nothing, the HUD and layout choice, the announcements, the dialogs and the records. `tests/slow/versusStrength.test.js` (run by `npm run test:slow`) plays 50 seeded Hard against Easy matches.
- `hexGridMode.test.js`, `orbitalMode.test.js`, `pinballMode.test.js`, `convoyMode.test.js` and `mergeMode.test.js` check the five specialized sphere-physics Arcade modes: hex lattice snapping and 1-cell Polarity Pulse, zero-G angular momentum transfer and 360-degree Collector Arcs, downward Pinball gravity with live mid-flight polarity and bucket refunds, parametric Convoy arc-length LUTs with Magnetic Gap Snapback, and 10-calibre Merge Basin rigid-body fusion, Supernova clear, overflow defeat and run snapshots.

The generated levels are calibrated outside CI by two bots (`scripts/bot/CampaignBot.js`):

```bash
node scripts/calibrate-campaign.mjs
```

- the **greedy** bot aims the loaded color where most spheres of that color sit and never plays a special sphere. It plays each level 16 times (`calibration` in `configs/campaign.json`); a level it wins less than one game in eight gets extra shots, then another seed, until one passes. A player who ignores special spheres can always win.
- the **arsenal** bot reads the aim preview the player sees (what a shot destroys and drops, `src/game/ImpactPreview.js`) for the loaded color and every special sphere in stock, and plays a special when it takes off at least 6 spheres and 3 more than the best color shot, or once the shots left no longer outnumber the specials (`calibration.bot.arsenal`). It plays each candidate 16 times too, and a level it wins less than one game in two (`minArsenalWinRate`) also gets extra shots, then another seed, until a candidate passes both floors.

Star thresholds come from the median score of the bot named by `calibration.starPolicy`: three stars at the ratio the 24 authored levels show for that bot (`threeStarMedianFactors`: 1.08 for greedy, 0.79 for arsenal), two stars at 63% of three. The result, with both bots' measures, goes to `configs/campaignTuning.json`; `--from` and `--to` measure a range only, `--workers` sets the number of parallel workers (by default all cores but two), and `--dry-run` prints the measures without writing them. Only a dry run measures an authored level, as it is (`--from 24 --to 24 --dry-run`); a writing run starts on the first generated level.

Purist is measured outside CI by the same greedy bot: `node scripts/calibrate-classic.mjs [--seeds <n>]` prints the share of runs that clear stage 1 and the share that reach stage 3 or more, against the targets of the script. It never writes a config; `sag.modes.classic` and `classic` in `configs/game.json` are tuned by hand.

Flux draws its generated shapes only from those that hang clear of the danger line when left alone. `npm run calibrate:flux` (`scripts/calibrate-flux-shapes.mjs`) settles every valid generated shape idle on worker threads and writes the integer margins to `configs/fluxShapeTuning.json`, with the fingerprint of everything the settle depends on; `flux.shapeSettle.minMarginPx` is the threshold. `tests/fluxGenerator.test.js` fails when the file no longer matches the configs, and changing the pool or the threshold requires a `ghostDuel.contentVersion.flux` bump. The campaign does not use the table.

`tests/browser/smoke.test.js` opens the real page in headless Chromium at the five supported layouts (desktop, portrait tablet, landscape phone, portrait phone and narrow portrait phone). It fails on any console error, sideways scrolling or clipped control label, checks the layout on level 1 (no special sphere) and level 2 (special spheres), checks that the level select opens on the chapter of the current level and switches chapters, checks that the Settings, Levels, Workshop, My stats and Pause dialogs pause and resume the run, walks through the victory, game over and reload-resume paths, checks that Campaign game over offers no Share while Daily Challenge, Survival and Flux Mode copy their result to the clipboard, checks that a fresh profile finds the gated modes locked (tapping one explains why) while an existing player keeps every mode, that a shared Flux link unlocks Flux, that the Daily history and Copy my stats work and that the Weekly Flux button starts the seed of the current week, and checks that the Sag meter shows in the HUD in Survival at every layout without changing the HUD grid and warns after scripted misses, that a fresh profile finds the Purist card locked (tapping it names level 4) while an existing player starts Purist, checks that a duel link opens its card on a fresh profile and Accept starts the Flux duel with the rival badge, that a saved run asks for confirmation first, that a damaged link shows an error card and leaves the normal boot, that a past Daily duel is a rematch that pays no first-play bonus, that a duel game over states the result and Share challenge carries the player's own score, and that a duel leaves the HUD columns unchanged at every layout, and checks that a mouse tremor keeps a keyboard-tuned aim. CI runs it as a separate job.

When adding a runtime file, list it in `PRECACHE_ASSETS` in `sw.js`. To release, move the notes under `## [Unreleased]` in `CHANGELOG.md` as needed, then run `npm run release -- <patch|minor|major|X.Y.Z>` (add `--dry-run` to preview): it bumps `package.json`, `package-lock.json` and `APP_VERSION` in `sw.js` and promotes the Unreleased section, but never commits, tags or pushes. Deployment to GitHub Pages happens from CI, after the test and browser jobs pass on `master`.

---

## License

Copyright 2026 Julien Bombled. Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0).
