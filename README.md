# REDLINE

A car you drive whose engine sound is **simulated, not sampled**. Every rumble, pop and rattle comes
from a running model of the engine: cylinders filling and firing, valves opening, pressure waves
travelling down the exhaust pipes and out of the tailpipe. Put that engine in a car with real-ish
physics, drive it around, and listen.

Inspired by **Joel Johnson's Engine Synthesizer** (joeljohnson.com/enginesynth). This is not his code:
the engine model here was written from scratch for REDLINE.

## What's in it

- **Engine model** (`src/engine/model.ts`): zero-dimensional cylinders (filling, Wiebe combustion,
  heat loss, friction), compressible flow through the valves, a throttle and plenum, burned gas carried
  back into the cylinder, and 1D waveguide pipes for the intake and exhaust. Sound is the flow out of
  the pipe ends. A mechanical layer adds valve clatter and rattle. It runs in an AudioWorklet.
- **Engines** (`src/engine/presets.ts`): an inline-4, a cross-plane V8, a flat-plane V8, an inline-6,
  a flat-4, a V-twin, a built drift six, and a **1975-76 Ford Pinto 2.3** (8.4:1, cast manifold,
  catalytic converter, stock muffler, about 85 hp, no rev limiter).
- **Car** (`src/sim/car.ts`): a 3D rigid body on four sprung wheels, slip-based tyres, a clutch and
  gearbox, anti-roll bars, traction control. The Pinto has an open rear diff with driveshaft torque
  reaction (it spins its right rear: one-wheel peel).
- **Worlds** (`src/sim/world.ts`): a lot, three straight courses (bumps, jumps, crash lane), a drift
  loop and a 1970s neighbourhood.
- **Films** (`src/film.ts`): the trailer and the Pinto film are scripted shots inside the game,
  recorded frame by frame with the game's own sound (`tools/trailer.ts`).
- **CHIMERA** (`crates/`, `src/chimera/`): Jameson Hodge's vocal synth, used for the Chimera head on
  the driver.

## Run it

Needs [Bun](https://bun.sh). The CHIMERA WebAssembly is checked in, so Rust is only needed to rebuild it.

```bash
bun install
bun run dev
```

Open `http://127.0.0.1:5347/` and click START ENGINE. Pick a world with `?track=` (`lot`, `bumps`,
`jumps`, `crash`, `drift`, `hood`).

| Keys | |
|---|---|
| W / S or arrows | throttle / brake (hold brake when stopped to reverse) |
| A / D | steer |
| Space | handbrake |
| Q / E, T | shift down / up, toggle automatic |
| 1-8 | engine |
| K | car setup (street, drift, Pinto) |
| X | traction control |
| N | next world |
| C | camera |
| B | slow motion |
| R | repair |
| M | mute |

## The films

- `?film` plays the trailer; `?film=pinto&track=hood` plays the Pinto film. Click START ENGINE.
- Render an MP4 (dev server running, ffmpeg installed):

  ```bash
  bun tools/trailer.ts out/pinto-film --url "http://127.0.0.1:5347/?film=pinto&track=hood"
  ```

- The film writes per-frame music cues (level, muffling, position). Add a music file you have the
  rights to with `uv run tools/mixmusic.py out/pinto-film <file>`, or play it live with
  `&music=/music/<file>` after putting it in `public/music/` (ignored by git).

## Tools

Headless checks in `tools/`: `drive.ts` (0-60, shifts), `donut.ts`, `burnout.ts`, `driftcheck.ts`,
`course.ts`, `rollsearch.ts` (finds a natural rollover), `calibrate.ts` (levels per engine),
`pintoref.ts` and `pinto-profile.py` (compare the Pinto's spectrum against recordings).

## How accurate is the Pinto?

Measured from published specs: bore, stroke, rod length, compression, firing order, gearing, weight,
wheelbase and track. Estimated (no published figures found): valve sizes, cam timing and the exact
exhaust pipe lengths. The sound was tuned against recordings of stock Pintos by comparing spectra.
Improvements welcome, especially real cam and valve data.

## Credits

- Engine-synth idea: Joel Johnson's Engine Synthesizer.
- CHIMERA vocal synth: Jameson Hodge, github.com/jamesondh/chimera-vocal-synth (MIT).
- 1971 Ford Pinto photo in the Pinto film: "1971 Ford Pinto Runabout" by Mustang Joe, Wikimedia
  Commons, CC0.

MIT licensed; see `LICENSE`.
