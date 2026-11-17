// A robot driver down a course: holds the centre line at a set throttle and reports what happens.
//   bun tools/course.ts <track> [engine] [throttle] [speed cap km/h]
import { EngineSim } from '../src/engine/model'
import { ENGINES } from '../src/engine/presets'
import { Car } from '../src/sim/car'
import { World } from '../src/sim/world'
import { Damage } from '../src/sim/damage'

const track = process.argv[2] ?? 'jumps'
const spec = ENGINES.find(e => e.id === (process.argv[3] ?? 'v8'))!
const thrSet = +(process.argv[4] ?? 1)
const cap = +(process.argv[5] ?? 999) / 3.6
const world = new World(track)
const fs = 48000, B = 128
const sim = new EngineSim(spec, fs)
const car = new Car(spec.idle)
car.reset(world.start.x, world.start.z, world.start.yaw, spec.idle)
sim.omega = car.we
const damage = new Damage(spec.layout.length)
const quiet = process.argv.includes('quiet')
const L = new Float32Array(B), R = new Float32Array(B)
let ac = 0, t = 0, maxY = 0, air = 0, flights = 0, lastMark = -1
const h = 1 / 500
const marks = [...world.track.marks]
while (t < 60 && car.z < world.track.length + 10) {
  const link = { torque: sim.torque().brake, inertia: spec.inertia, idle: spec.idle, redline: spec.redline, dead: damage.dead }
  for (let i = 0; i < 4; i++) { car.wheels[i].bend = damage.bend[i]; car.wheels[i].lost = damage.lost[i] }
  const steer = Math.max(-1, Math.min(1, -car.x * 0.25 - car.yaw * 2.2))
  const thr = car.speed > cap ? 0 : thrSet
  car.step(h, { throttle: thr, brake: 0, steer, handbrake: false }, link, world)
  const hits = world.collideCar(car)
  for (const m of damage.apply(hits).messages) console.log(`  t=${t.toFixed(2)} z=${car.z.toFixed(0)} DAMAGE ${m}`)
  for (const m of damage.applyCar(car.events).messages) console.log(`  t=${t.toFixed(2)} z=${car.z.toFixed(0)} DAMAGE ${m}`)
  for (const hit of hits) if (!quiet && hit.speed > 3) console.log(`  t=${t.toFixed(2)} z=${car.z.toFixed(0)} HIT ${hit.kind} ${hit.speed.toFixed(1)} m/s at (${hit.lx.toFixed(1)}, ${hit.ly.toFixed(1)}, ${hit.lz.toFixed(1)})`)
  world.stepProps(h)
  if (!isFinite(car.y) || !isFinite(car.we)) { console.log('NON-FINITE at', t); break }
  ac += h
  while (ac >= B / fs) { ac -= B / fs; sim.throttle = car.throttleOut; sim.fuelCut = car.fuelCut; sim.misfire = damage.misfire; sim.process(L, R, B, car.we) }
  const ground = world.height(car.x, car.z)
  const above = car.y - car.rideHeight - ground
  maxY = Math.max(maxY, above)
  if (car.airborne > 0.15 && air === 0) { air = t; flights++ }
  if (car.airborne === 0 && air) { console.log(`  t=${t.toFixed(2)} z=${car.z.toFixed(0)} landed after ${(t - air).toFixed(2)} s in the air, peak ${maxY.toFixed(2)} m above ground, ${Math.round(car.speed * 3.6)} km/h, upright ${car.upright.toFixed(2)}`); air = 0; maxY = 0 }
  if (!air) maxY = 0
  for (const e of car.events.splice(0)) if (!quiet && e.speed > 3 || e.scrape > 6) console.log(`  t=${t.toFixed(2)} z=${car.z.toFixed(0)} ${e.kind}${e.wheel !== undefined ? ' wheel ' + e.wheel : ''} ${e.speed.toFixed(1)} m/s scrape ${e.scrape.toFixed(1)} at (${e.lx.toFixed(1)}, ${e.ly.toFixed(1)}, ${e.lz.toFixed(1)})`)
  while (marks.length && car.z > marks[0].z - 2) { const m = marks.shift()!; console.log(`t=${t.toFixed(1)} -> ${m.label} at ${Math.round(car.speed * 3.6)} km/h, gear ${car.gear}`) }
  if (car.upright < 0.3 && lastMark !== 1) { console.log(`  t=${t.toFixed(2)} z=${car.z.toFixed(0)} ROLLED, upright ${car.upright.toFixed(2)} pitch-ish ${(car as any).q ? 'q=' + car.q.map(v => v.toFixed(2)).join(',') : ''}`); lastMark = 1 }
  if (car.upright > 0.8) lastMark = -1
  t += h
}
sim.misfire = damage.misfire
console.log(`end t=${t.toFixed(1)} z=${car.z.toFixed(0)} x=${car.x.toFixed(1)} ${Math.round(car.speed * 3.6)} km/h upright ${car.upright.toFixed(2)} flights ${flights} engine ${Math.round(damage.engine*100)}% wheels ${damage.wheelHealth.map(w => w.toFixed(2)).join('/')} lost ${damage.lost.map(Number).join('')}`)
