// Headless drift: a run-up, a flick into a slide, then throttle held while the robot steers
// against the slide. Prints the slide angle, speed and yaw rate; says if it spins.
//   bun tools/driftcheck.ts [setup] [engine] [throttle in the slide]
import { EngineSim } from '../src/engine/model'
import { ENGINES } from '../src/engine/presets'
import { Car, SETUPS } from '../src/sim/car'

const setup = SETUPS.find(s => s.id === (process.argv[2] ?? 'drift'))!
const spec = ENGINES.find(e => e.id === (process.argv[3] ?? 'drift'))!
const slideThr = +(process.argv[4] ?? 0.8)
const sim = new EngineSim(spec, 48000), car = new Car(spec.idle)
car.build(setup)
car.reset(0, 0, 0, spec.idle)
sim.omega = car.we
const flat = { height: () => 0 }
const L = new Float32Array(128), R = new Float32Array(128)
let ac = 0, t = 0
const h = 0.002
const angle = () => car.u > 1 ? Math.atan2(car.v, car.u) * 57.3 : 0
let spun = false, inSlide = 0, sumAng = 0, n = 0
function step(c: { throttle: number; brake: number; steer: number; handbrake: boolean }) {
  car.step(h, c, { torque: sim.torque().brake, inertia: spec.inertia, idle: spec.idle, redline: spec.redline, dead: false }, flat)
  ac += h
  while (ac >= 128 / 48000) { ac -= 128 / 48000; sim.throttle = car.throttleOut; sim.fuelCut = car.fuelCut; sim.process(L, R, 128, car.we) }
  t += h
}
while (car.speed < 60 / 3.6 && t < 10) step({ throttle: 1, brake: 0, steer: 0, handbrake: false })
console.log(`run-up: ${Math.round(car.speed * 3.6)} km/h at t=${t.toFixed(1)} gear ${car.gear}`)
const t0 = t
while (t - t0 < 0.35) step({ throttle: 0.6, brake: 0, steer: 1, handbrake: t - t0 < 0.25 })
const t1 = t
let lastPrint = 0
while (t - t1 < 6) {
  // a player holding a drift: steer into the turn, ease off toward the slide's direction
  const a = angle()
  const steer = Math.max(-1, Math.min(1, 0.5 + a / 35))
  step({ throttle: slideThr, brake: 0, steer, handbrake: false })
  const aa = Math.abs(angle())
  if (aa > 100) spun = true
  if (aa > 15 && car.speed > 5) { inSlide += h; sumAng += aa; n++ }
  if (t - lastPrint > 0.5) { lastPrint = t; console.log(`  t=${(t - t1).toFixed(1)} angle ${angle().toFixed(0)}°  ${Math.round(car.speed * 3.6)} km/h  yaw rate ${(car.r * 57.3).toFixed(0)}°/s  ${Math.round(car.rpm)} rpm gear ${car.gear}  steer ${(car.steerAngle * 57.3).toFixed(0)}°`) }
}
console.log(`${setup.id}/${spec.id}: sliding ${inSlide.toFixed(1)} of 6 s, mean angle ${(n ? sumAng / n : 0).toFixed(0)}°, ${spun ? 'SPUN' : 'no spin'}`)
