// Searches for a natural rollover: many driving plans (speed, where and which way the wheel is
// yanked, handbrake, how long), each run through the very physics the film uses (physicsFrame with
// the engine in lockstep, 30 frames a second, the same slow motion), scored by how many times the
// car rolls over about its length. Prints the best plans as ROLL lines for src/rollover.ts.
//   bun tools/rollsearch.ts [family] [n]
import { EngineSim } from '../src/engine/model'
import { ENGINES } from '../src/engine/presets'
import { Car, SETUPS } from '../src/sim/car'
import { World } from '../src/sim/world'
import { Damage } from '../src/sim/damage'
import { Dummy } from '../src/sim/dummy'
import { physicsFrame, type Phys } from '../src/sim/frame'
import { RollDriver, type RollPlan } from '../src/rollover'

export function runPlan(plan: RollPlan, seconds = 9, log = false) {
  const spec = ENGINES.find(e => e.id === plan.engine)!
  const world = new World(plan.track)
  const car = new Car(spec.idle)
  car.build(SETUPS[0])
  // the film's roll(): rolling at a speed in a gear, hooked up
  car.reset(plan.x, plan.z, plan.yaw, 900, world.height(plan.x, plan.z))
  const v = plan.kmh / 3.6
  car.vel[0] = Math.sin(plan.yaw) * v; car.vel[2] = Math.cos(plan.yaw) * v
  car.ww = v / car.Rw; car.gear = plan.gear; car.auto = true; car.we = car.ww * car.ratio(); car.clutch = 1; car.locked = true; car.sinceShift = 0
  const engine = new EngineSim(spec, 48000)
  engine.omega = car.we
  let seed = 4242
  const P: Phys = { car, world, damage: new Damage(spec.layout.length), dummy: new Dummy(), dummyOn: false, spec, engine, torque: () => 0, live: true, propClock: 0, samples: 0, rand: () => (seed = (seed * 16807) % 2147483647) / 2147483647 }
  const D = new RollDriver(plan)
  let rollAngle = 0, pitchAngle = 0, film = 0, minUp = 1, maxAir = 0, msgs: string[] = []
  const F = 1 / 30
  while (film < seconds) {
    const slow = D.slow(car, F)
    const dt = F * slow
    const ctl = D.controls(car, dt)
    const out = physicsFrame(P, dt, ctl)
    for (const n of [out.newsCar, out.newsHits]) if (n) msgs.push(...n.messages)
    // rotation about the car's own length and its width this frame
    const q = car.q
    const f = rot(q, [0, 0, 1]), l = rot(q, [1, 0, 0])
    rollAngle += (car.w[0] * f[0] + car.w[1] * f[1] + car.w[2] * f[2]) * dt
    pitchAngle += (car.w[0] * l[0] + car.w[1] * l[1] + car.w[2] * l[2]) * dt
    minUp = Math.min(minUp, car.upright)
    maxAir = Math.max(maxAir, car.y - car.rideHeight - world.height(car.x, car.z))
    film += F
    if (log && Math.round(film * 30) % 15 === 0) console.log(`  ${film.toFixed(1)}s z=${car.z.toFixed(0)} x=${car.x.toFixed(1)} ${Math.round(car.speed * 3.6)}km/h up=${car.upright.toFixed(2)} rolls=${(rollAngle / (2 * Math.PI)).toFixed(2)} slow=${slow}`)
  }
  return { rolls: Math.abs(rollAngle) / (2 * Math.PI), flips: Math.abs(pitchAngle) / (2 * Math.PI), minUp, maxAir, endUp: car.upright, end: [car.x, car.z], msgs: [...new Set(msgs)] }
}
function rot(q: number[], v: number[]) {
  const [qx, qy, qz, qw] = q, [x, y, z] = v
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x)
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)]
}

if (import.meta.main) {
  const family = process.argv[2] ?? 'curb'
  const n = +(process.argv[3] ?? 120)
  let s = 7
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const results: { plan: RollPlan; res: ReturnType<typeof runPlan> }[] = []
  for (let i = 0; i < n; i++) {
    let plan: RollPlan
    if (family === 'curb') plan = { track: 'bumps', engine: 'v8', x: 0, z: 364, yaw: 0, kmh: 90 + Math.round(r() * 50), gear: 3, zTurn: 376 + Math.round(r() * 20), dir: pick([1, -1]), hb: pick([0, 0.2, 0.35, 0.5]), steerT: 0.3 + Math.round(r() * 10) / 10, thr: pick([1, 0.6]) }
    else if (family === 'steps') plan = { track: 'jumps', engine: 'v8', x: 0, z: 172, yaw: 0, kmh: 90 + Math.round(r() * 50), gear: 3, zTurn: 182 + Math.round(r() * 14), dir: pick([1, -1]), hb: pick([0, 0.2, 0.35, 0.5]), steerT: 0.3 + Math.round(r() * 10) / 10, thr: pick([1, 0.6]) }
    else if (family === 'rollers') plan = { track: 'bumps', engine: 'v8', x: 0, z: 112, yaw: 0, kmh: 90 + Math.round(r() * 50), gear: 3, zTurn: 128 + Math.round(r() * 20), dir: pick([1, -1]), hb: pick([0, 0.2, 0.35]), steerT: 0.3 + Math.round(r() * 10) / 10, thr: pick([1, 0.6]) }
    else plan = { track: 'jumps', engine: 'v8', x: 0, z: 20, yaw: 0, kmh: 90 + Math.round(r() * 40), gear: 3, zTurn: 36 + Math.round(r() * 12), dir: pick([1, -1]), hb: pick([0, 0.2, 0.35]), steerT: 0.2 + Math.round(r() * 6) / 10, thr: 1 }
    const res = runPlan(plan)
    results.push({ plan, res })
  }
  results.sort((a, b) => (b.res.rolls - b.res.flips * 0.7) - (a.res.rolls - a.res.flips * 0.7))
  for (const { plan, res } of results.slice(0, 6)) console.log(`rolls ${res.rolls.toFixed(2)} flips ${res.flips.toFixed(2)} air ${res.maxAir.toFixed(1)} end up ${res.endUp.toFixed(2)} at (${res.end.map(v => v.toFixed(0)).join(', ')})  ${JSON.stringify(plan)}\n    ${res.msgs.slice(0, 6).join(' / ')}`)
  const rolled = results.filter(x => x.res.rolls >= 1.5).length
  console.log(`${family}: ${rolled}/${n} plans rolled 1.5 times or more`)
}
