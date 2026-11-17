# REDLINE

A car you drive whose engine sound is **simulated, not sampled**. Every rumble, pop and rattle comes
from a running model of the engine: cylinders filling and firing, valves opening, pressure waves
travelling down the exhaust pipes and out of the tailpipe. Put that engine in a car with real-ish
physics, drive it around, and listen.

https://github.com/user-attachments/assets/03091d47-f613-4ad5-9e66-45c389e89e54

The trailer: 64 s, sound on. Every engine note in it is simulated. ([Download it](media/redline-trailer.mp4).)

## Credit where it's due

REDLINE adds on to other people's work. It isn't a remix of it, and it isn't trying to take credit for
it. If you came here for those projects, go to the originals:

- **The engine synth idea: Joel Johnson's Engine Synthesizer**, https://joeljohnson.com/enginesynth.
  Hearing a simulated engine instead of recordings is his idea, and REDLINE exists because of it. His
  code isn't public and none of it is in this repo; REDLINE's engine model is its own version, written
  from scratch. Not affiliated with or endorsed by him.
- **The Chimera voice and head: Jameson Hodge's CHIMERA**, https://github.com/jamesondh/chimera-vocal-synth.
  The code in `crates/` and `src/chimera/` is his, copied from his repo under its MIT license (an
  earlier snapshot; his repo has moved on since, so get the current version there). Not affiliated with
  or endorsed by him.

**How this came about.** I saw Joel Johnson's Engine Synthesizer posted on X and wanted to put an engine
like that in a car you can drive and crash. I thought it was a GitHub repo I could build on; it turned
out to be a web demo with no public code. So the engine model here was written separately, inspired by
what his demo does, and Jameson Hodge's CHIMERA (which is open source) was brought in for the Chimera
driver. This is a non-commercial hobby project.

**If you'd like this taken down**, Joel, Jameson, or anyone whose work is involved: open an issue on this
repo and I'll take it down or change it, no questions asked.

What REDLINE adds around them: the cars and their bodies, the car physics (tyres, suspension, clutch,
gearbox, diffs, crashes and rollovers), the worlds and levels, the engines' specs (including a stock
1970s Ford Pinto), and the scripted films with their recorder.

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

## What you need

| For | Install |
|---|---|
| Playing it, the tools, the tests | [Bun](https://bun.sh) 1.4 or later |
| Rendering the films to MP4 | [ffmpeg](https://ffmpeg.org), and the Chromium the recorder drives: `bunx playwright install chromium` |
| The Python tools (music mix, spectrum compare) | [uv](https://docs.astral.sh/uv/) (it fetches numpy and scipy itself) |
| Rebuilding the CHIMERA WebAssembly (optional; the built `chimera.wasm` is checked in) | Rust with `rustup target add wasm32-unknown-unknown` |

## Run it

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

## Check a change

```bash
bun run typecheck
bun run test       # every engine idles and makes sound; the Pinto's 0-100, one-wheel peel, locked-rear burnout
bun run build      # rebuilds the WebAssembly (needs Rust), typechecks, bundles to dist/
```

## Tools

Headless checks in `tools/`: `drive.ts` (0-60, shifts), `donut.ts`, `burnout.ts`, `driftcheck.ts`,
`course.ts`, `rollsearch.ts` (finds a natural rollover), `calibrate.ts` (levels per engine),
`pintoref.ts` renders the Pinto in the conditions of reference recordings and `pinto-profile.py` compares
the two spectra (`bun tools/pintoref.ts out/pintoref`, then `uv run tools/pinto-profile.py --mic <your
recordings> out/pintoref/*.wav`). The recordings the Pinto was tuned against aren't included (they're
other people's videos); bring your own of a stock Pinto idling and revving.

## How accurate is the Pinto?

Measured from published specs: bore, stroke, rod length, compression, firing order, gearing, weight,
wheelbase and track. Estimated (no published figures found): valve sizes, cam timing and the exact
exhaust pipe lengths. The sound was tuned against recordings of stock Pintos by comparing spectra.
Improvements welcome, especially real cam and valve data.

## Credits

- Engine-synth idea: Joel Johnson's Engine Synthesizer, https://joeljohnson.com/enginesynth.
- CHIMERA vocal synth: Jameson Hodge, https://github.com/jamesondh/chimera-vocal-synth (MIT).
- 1971 Ford Pinto photo in the Pinto film: "1971 Ford Pinto Runabout" by Mustang Joe, Wikimedia
  Commons, CC0.

MIT licensed; see `LICENSE`.
