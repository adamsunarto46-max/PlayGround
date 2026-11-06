# PlayGround

## SINGLE CYLINDER — Dyno Lab

A complete, playable 2D dyno-cell game built around a physically simulated 449 cc
four-stroke single-cylinder engine. There is no scripted torque curve: torque,
power, knock, heat and damage all come from the slider-crank / single-zone
combustion model in `src/engine.js`.

Clear six test-cell records, earn career cash, and spend it on permanent parts.
The campaign saves automatically in `localStorage`.

### Play

Open `index.html` through any static web server, or run the project's normal
preview:

```bash
./start.sh
```

Then open the printed local URL.

### Controls

| Input | Action |
| --- | --- |
| `SPACE` (hold) | Starter / re-crank a stall |
| `W` / `S` | Throttle up / down (or drag the THROTTLE slider) |
| `A` / `D` | Ignition advance (or drag the IGNITION slider) |
| `Q` / `E` | Dyno load (or drag the DYNO LOAD slider) |
| `M` | Mute / unmute |
| `Esc` | Open the garage (pauses a running test) |

Touch controls use the same starter button and sliders.

### The campaign

1. **First Breath** — catch the cold start and hold a stable idle.
2. **Load Bank** — pull against the dyno brake in the midrange.
3. **Torque Plateau** — find the engine's torque peak.
4. **Timing Trap** — make top-end power without detonation.
5. **Heat Soak** — bring the coolant to temperature under load.
6. **Redline Shift** — hold the red zone without hurting the engine.

Hold every condition on the stage card at once to fill the progress bar. Gold,
silver and bronze medals pay different amounts; health and elapsed time decide
the medal. The garage sells four permanent upgrades: port and polish, alloy
radiator, race ECU and forged internals.

### Files

- `index.html` / `styles.css` — shell, HUD, overlays and responsive layout.
- `src/main.js` — campaign flow, stage conditions, HUD, tach and input.
- `src/engine.js` — single-cylinder physics and upgrade modifiers.
- `src/render/scene.js` — animated canvas cutaway, particles and labels.
- `src/audio.js` — procedural WebAudio engine note, induction and exhaust.
- `screenshots/` — captures used for visual verification.

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Created using [OMGithub.com](https://go.ondev.store/).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://go.ondev.store/adamsunarto46-max/PlayGround)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/adamsunarto46-max/PlayGround)

- 🎮 [Open the project](https://go.ondev.store/adamsunarto46-max/PlayGround).
- ✨ [Remix this project](https://go.ondev.store/adamsunarto46-max/PlayGround?remix=1).
- 💻 [Explore the source](https://github.com/adamsunarto46-max/PlayGround).
- 🛠️ [Check build runs](https://github.com/adamsunarto46-max/PlayGround/actions).
- 🐛 [Report an issue](https://github.com/adamsunarto46-max/PlayGround/issues).
- 👤 [Explore the creator's projects](https://go.ondev.store/adamsunarto46-max).
- 🌍 [Create with OMGithub](https://go.ondev.store/).
<!-- omgithub:readme:end -->
