// Engine and car together, headless: a full-throttle run, a lift, braking, a turn and a reverse.
//   bun tools/drive.ts [engineId]
import { EngineSim } from '../src/engine/model'
import { ENGINES } from '../src/engine/presets'
import { Car, SETUPS, type Controls } from '../src/sim/car'

const id = process.argv[2] ?? 'v8'
const spec = ENGINES.find(e => e.id === id)!
const fs = 48000, B = 128
const sim = new EngineSim(spec, fs)
const car = new Car(spec.idle)
car.build(SETUPS.find(s => s.id === (process.argv[3] ?? 'street')) ?? SETUPS[0])
car.reset(0, 0, 0, spec.idle)
sim.omega = car.we
const L = new Float32Array(B), R = new Float32Array(B)
let audioClock = 0
let t = 0
const h = 1 / 500
let hit100 = 0, hit97 = 0
const log: string[] = []
let lastGear = car.gear
const flat = { height: () => 0 }
function run(secs: number, c: Controls, label: string) {
  const end = t + secs
  while (t < end) {
    const link = { torque: sim.torque().brake, inertia: spec.inertia, idle: spec.idle, redline: spec.redline, dead: false }
    car.step(h, c, link, flat)
    if (!isFinite(car.x) || !isFinite(car.we)) throw new Error('non-finite at ' + t)
    audioClock += h
    while (audioClock >= B / fs) {
      audioClock -= B / fs
      sim.throttle = car.throttleOut
      sim.fuelCut = car.fuelCut
      sim.process(L, R, B, car.we)
    }
    t += h
    if (!hit100 && car.speed * 3.6 >= 100) hit100 = t
    if (!hit97 && car.speed * 3.6 >= 96.6) hit97 = t
    if (car.gear !== lastGear) { log.push(`  t=${t.toFixed(2)} gear ${lastGear}→${car.gear} at ${Math.round(car.rpm)} rpm, ${Math.round(car.speed * 3.6)} km/h`); lastGear = car.gear }
  }
  console.log(`${label.padEnd(18)} t=${t.toFixed(1)}s  ${Math.round(car.speed * 3.6)} km/h  gear ${car.gear}  ${Math.round(car.rpm)} rpm  torque ${Math.round(sim.torque().brake)}  yaw ${(car.yaw * 57.3).toFixed(0)}°  pos (${car.x.toFixed(0)}, ${car.z.toFixed(0)})  burnout ${car.burnout.toFixed(2)}  y ${car.y.toFixed(3)} up ${car.upright.toFixed(3)} wheelsN ${car.wheels.map(w => Math.round(w.N)).join('/')}`)
}
const flatG = 0
const none: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false }
run(1.5, none, 'idle')
const idleRpm = car.rpm
run(14, { ...none, throttle: 1 }, 'full throttle')
console.log(log.join('\n'))
console.log(`  0-100 km/h (0-62 mph): ${hit100 ? hit100 - 1.5 : 'not reached'}s`)
console.log(`  0-60 mph: ${hit97 ? (hit97 - 1.5).toFixed(1) : 'not reached'} s`)
run(3, none, 'lift off')
run(3, { ...none, brake: 1 }, 'brake')
run(3, { ...none, brake: 1 }, 'brake more')
run(2, { ...none, throttle: 0.5 }, 'pull away')
run(4, { ...none, throttle: 0.6, steer: 1 }, 'turn left')
run(2, { ...none, throttle: 1, steer: 1, handbrake: true }, 'handbrake turn')
run(3, { ...none, brake: 1 }, 'stop')
run(3, { ...none, brake: 1 }, 'reverse')
console.log(`idle held at ${Math.round(idleRpm)} rpm (target ${spec.idle})`)
