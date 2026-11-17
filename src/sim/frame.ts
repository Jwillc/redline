// One frame of the physics: the car in fine steps, collisions, the dummy, loose things, and the
// damage that follows. Shared by the game and the tools, so a tool can find something (a rollover)
// and the film can play the very same thing. With `engine` given, the engine model is stepped in
// lockstep with the car and its torque used, which makes a run repeatable to the bit; without it,
// the torque comes from `torque()` (the audio thread's engine, in the game).
import type { Car, Controls } from './car'
import type { World, Impact } from './world'
import type { Damage, DamageNews } from './damage'
import type { Dummy } from './dummy'
import type { EngineSim } from '../engine/model'
import type { EngineSpec } from '../engine/presets'

export const STEP = 1 / 500

export interface Phys {
  car: Car
  world: World
  damage: Damage
  dummy: Dummy
  dummyOn: boolean
  spec: EngineSpec
  engine: EngineSim | null
  torque: () => number
  live: boolean
  propClock: number
  samples: number
  rand: () => number
  /** the dummy left the car this step */
  onEject?: (vBefore: [number, number, number], h: number) => void
}

export interface FrameOut {
  hits: Impact[]
  scrape: number
  events: ReturnType<Car['events']['splice']>
  newsCar: DamageNews | null
  newsHits: DamageNews | null
}

/** Is this blow hard enough to throw the dummy out? A head-on hit into a wall or block at 80 km/h or more. */
export function ejectFor(hits: Impact[]): boolean {
  for (const h of hits) {
    if (h.kind !== 'fixed' || (h.block !== 'wall' && h.block !== 'block')) continue
    if (h.lz > 1.0 && h.nz < -0.7 && h.speed >= 22) return true
  }
  return false
}

export function physicsFrame(P: Phys, dt: number, ctl: Controls, posed = false): FrameOut {
  const { car, world, damage, dummy, spec } = P
  const steps = Math.max(1, Math.ceil(dt / STEP - 1e-9))
  const h = dt / steps
  for (let i = 0; i < 4; i++) { car.wheels[i].bend = damage.bend[i]; car.wheels[i].lost = damage.lost[i] }
  const hits: Impact[] = []
  let scrape = 0
  const buf = P.engine ? new Float32Array(256) : null
  for (let i = 0; i < steps; i++) {
    // the engine first, to where the car is now
    if (P.engine && buf) {
      const e = P.engine
      e.throttle = car.throttleOut
      e.fuelCut = car.fuelCut
      for (let c = 0; c < e.misfire.length; c++) e.misfire[c] = damage.misfire[c] ?? 0
      if (e.muffler !== damage.muffler) e.setMuffler(damage.muffler)
      P.samples += h * e.fs
      const n = Math.floor(P.samples)
      P.samples -= n
      for (let k = 0; k < n; k += 256) e.process(buf, null, Math.min(256, n - k), car.we)
    }
    const torque = P.engine ? P.engine.torque().brake : P.torque()
    const link = { torque, inertia: spec.inertia, idle: spec.idle, redline: spec.redline, float: spec.valveFloat, dead: damage.dead }
    const vBefore: [number, number, number] = [car.vel[0], car.vel[1], car.vel[2]]
    if (P.live && !posed) car.step(h, ctl, link, world)
    else if (!P.live) car.we = spec.idle * Math.PI / 30
    const stepHits = posed ? [] : world.collideCar(car)
    if (P.dummyOn && !dummy.free && ejectFor(stepHits)) {
      damage.glass.set('windshield', true)
      dummy.eject(car, vBefore, h / 2, P.rand)
      P.onEject?.(vBefore, h)
    }
    if (P.dummyOn) {
      if (dummy.free) for (let k = 0; k < 2; k++) dummy.step(h / 2, world)
      else dummy.ride(car, h)
    }
    for (const hit of stepHits) {
      scrape = Math.max(scrape, hit.scrape)
      if (hit.speed > 0.8) hits.push(hit)
    }
    P.propClock += h
    if (P.propClock >= 1 / 120) { world.stepProps(P.propClock); P.propClock = 0 }
  }
  const events = car.events.splice(0)
  const newsCar = events.length ? damage.applyCar(events) : null
  const newsHits = hits.length ? damage.apply(hits) : null
  return { hits, scrape, events, newsCar, newsHits }
}
