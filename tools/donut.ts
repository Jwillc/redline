// Can the car hold a donut on its own torque? Headless, flat ground: roll off, full lock, a handbrake
// flick to break the rear loose, then full throttle held. Prints rotation, speed, wheelspin, revs.
//   bun tools/donut.ts [engineId] [setupId] [kickKmh] [throttle]
import { EngineSim } from '../src/engine/model'
import { ENGINES } from '../src/engine/presets'
import { Car, SETUPS, type Controls } from '../src/sim/car'

const spec = ENGINES.find(e => e.id === (process.argv[2] ?? 'pinto'))!
const setup = SETUPS.find(s => s.id === (process.argv[3] ?? 'pinto'))!
const kick = +(process.argv[4] ?? 18), thrHold = +(process.argv[5] ?? 1), hb = +(process.argv[6] ?? 0.35)
const sim = new EngineSim(spec, 48000)
const car = new Car(spec.idle)
car.build(setup)
car.reset(0, 0, 0, spec.idle)
sim.omega = car.we
const B = 128, L = new Float32Array(B), R = new Float32Array(B)
const h = 1 / 500, flat = { height: () => 0 }
let t = 0, clock = 0, yawPrev = 0, turns = 0
function step(c: Controls) {
  car.step(h, c, { torque: sim.torque().brake, inertia: spec.inertia, idle: spec.idle, redline: spec.redline, float: spec.valveFloat, dead: false }, flat)
  clock += h
  while (clock >= B / 48000) { clock -= B / 48000; sim.throttle = car.throttleOut; sim.fuelCut = car.fuelCut; sim.process(L, R, B, car.we) }
  let d = car.yaw - yawPrev; d = Math.atan2(Math.sin(d), Math.cos(d)); turns += d / (2 * Math.PI); yawPrev = car.yaw
  t += h
}
const none: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false }
while (t < 1.5) step(none)
// roll off toward the kick speed, turning in
while (car.speed * 3.6 < kick && t < 8) step({ ...none, throttle: 0.7, steer: 1 })
console.log(`kick at t=${t.toFixed(2)} ${Math.round(car.speed * 3.6)} km/h`)
const t0 = t
while (t < t0 + hb) step({ ...none, throttle: 1, steer: 1, handbrake: true })
let last = t, pull = 0
const flick = process.argv[7] !== 'noflick'
while (t < t0 + 12) {
  // a driver in a weak car keeps it round with handbrake flicks: when the tail starts to come back
  // into line, a quarter-second pull (the clutch drops out, the revs flare), then it bites again
  const slideNow = Math.atan2(car.v, Math.max(0.1, Math.abs(car.u))) * 57.3
  if (flick && pull <= 0 && Math.abs(slideNow) < 35 && car.speed > 3) pull = 0.25
  pull -= h
  step({ ...none, throttle: thrHold, steer: 1, brake: +(process.env.DRAG ?? 0), handbrake: pull > 0 })
  if (t - last >= 1) {
    last = t
    const slide = Math.atan2(car.v, Math.max(0.1, Math.abs(car.u))) * 57.3
    console.log(`t=${(t - t0).toFixed(0).padStart(2)}  ${String(Math.round(car.speed * 3.6)).padStart(3)} km/h  gear ${car.gear}  ${Math.round(car.rpm)} rpm  yawrate ${(car.r * 57.3).toFixed(0)}°/s  slide ${slide.toFixed(0)}°  burnout ${car.burnout.toFixed(2)}  L/R ${Math.round((car.ww + car.wd) * 9.55)}/${Math.round((car.ww - car.wd) * 9.55)} rpm  turns ${turns.toFixed(2)}  pos (${car.x.toFixed(1)}, ${car.z.toFixed(1)})`)
  }
}
