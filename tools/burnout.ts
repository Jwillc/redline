// A brake-stand burnout, headless on flat ground: footbrake and full throttle (the fronts hold, the rear
// spins), then off the brake to peel away. Prints each rear wheel's speed, revs and how far it has gone.
//   bun tools/burnout.ts [engineId] [setupId] [brake] [holdSecs]
import { EngineSim } from '../src/engine/model'
import { ENGINES } from '../src/engine/presets'
import { Car, SETUPS, type Controls } from '../src/sim/car'

const spec = ENGINES.find(e => e.id === (process.argv[2] ?? 'pinto'))!
const car = new Car(spec.idle)
car.build(SETUPS.find(s => s.id === (process.argv[3] ?? 'pinto'))!)
car.reset(0, 0, 0, spec.idle)
const brake = +(process.argv[4] ?? 1), hold = +(process.argv[5] ?? 3)
if (process.env.LOCKED) { car.openDiff = false; car.wd = 0 }
const sim = new EngineSim(spec, 48000)
sim.omega = car.we
const B = 128, L = new Float32Array(B), R = new Float32Array(B), h = 1 / 500, flat = { height: () => 0 }
let t = 0, clock = 0
const none: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false }
function run(secs: number, c: Controls, label: string) {
  const end = t + secs
  let next = t
  while (t < end) {
    car.step(h, c, { torque: sim.torque().brake, inertia: spec.inertia, idle: spec.idle, redline: spec.redline, float: spec.valveFloat, dead: false }, flat)
    clock += h
    while (clock >= B / 48000) { clock -= B / 48000; sim.throttle = car.throttleOut; sim.fuelCut = car.fuelCut; sim.process(L, R, B, car.we) }
    t += h
    if (t >= next) {
      next += 0.5
      const yaw = car.yaw * 57.3
      console.log(`${label.padEnd(8)} t=${t.toFixed(1)}  ${String(Math.round(car.speed * 3.6)).padStart(3)} km/h  ${Math.round(car.rpm)} rpm  rear L/R ${Math.round((car.ww + car.wd) * 9.55)}/${Math.round((car.ww - car.wd) * 9.55)} rpm  burnout ${car.burnout.toFixed(2)}  at (${car.x.toFixed(1)}, ${car.z.toFixed(1)})  yaw ${yaw.toFixed(0)}°`)
    }
  }
}
run(1, { ...none, handbrake: true }, 'parked')
run(1, { ...none, handbrake: true, throttle: 1 }, 'rev')
run(hold, { ...none, brake, throttle: 1 }, 'stand')
run(4, { ...none, throttle: 1 }, 'peel')
run(2, { ...none, brake: 0.6 }, 'stop')
