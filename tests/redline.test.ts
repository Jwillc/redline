// Checks that the engine and car still behave after a change: every engine idles steadily and makes
// finite sound, the Pinto accelerates like an 85 hp car, and its open diff spins one rear tyre (a
// locked rear spins both). Headless, flat ground, the same stepping as tools/drive.ts.
//   bun test
import { expect, test } from 'bun:test'
import { EngineSim } from '../src/engine/model'
import { ENGINES } from '../src/engine/presets'
import { Car, SETUPS, type Controls } from '../src/sim/car'

const FS = 48000, B = 128, H = 1 / 500
const flat = { height: () => 0 }
const none: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false }

function rig(engineId: string, setupId: string) {
  const spec = ENGINES.find(e => e.id === engineId)!
  const car = new Car(spec.idle)
  car.build(SETUPS.find(s => s.id === setupId)!)
  car.reset(0, 0, 0, spec.idle)
  const sim = new EngineSim(spec, FS)
  sim.omega = car.we
  const L = new Float32Array(B), R = new Float32Array(B)
  let clock = 0, t = 0, peak = 0, finite = true
  const run = (secs: number, c: Controls, each?: () => void) => {
    const end = t + secs
    while (t < end) {
      car.step(H, c, { torque: sim.torque().brake, inertia: spec.inertia, idle: spec.idle, redline: spec.redline, float: spec.valveFloat, dead: false }, flat)
      clock += H
      while (clock >= B / FS) {
        clock -= B / FS
        sim.throttle = car.throttleOut; sim.fuelCut = car.fuelCut
        sim.process(L, R, B, car.we)
        for (let i = 0; i < B; i++) { if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) finite = false; peak = Math.max(peak, Math.abs(L[i])) }
      }
      t += H
      each?.()
    }
  }
  return { spec, car, run, get t() { return t }, get peak() { return peak }, get finite() { return finite } }
}

test.each(ENGINES.map(e => e.id))('%s idles steadily and makes sound', id => {
  const r = rig(id, 'street')
  r.run(2, none)
  expect(r.finite).toBe(true)
  expect(r.peak).toBeGreaterThan(1e-5)
  expect(Math.abs(r.car.rpm - r.spec.idle)).toBeLessThan(r.spec.idle * 0.35)
}, 30000)

test('the Pinto does 0-100 km/h like an 85 hp car (9-16 s)', () => {
  const r = rig('pinto', 'pinto')
  r.run(1, none)
  const t0 = r.t
  let at = 0
  r.run(20, { ...none, throttle: 1 }, () => { if (!at && r.car.speed * 3.6 >= 100) at = r.t - t0 })
  expect(at).toBeGreaterThan(9)
  expect(at).toBeLessThan(16)
}, 60000)

/** Rev against the handbrake, drop the clutch standing on the footbrake: each rear wheel's speed (rpm). */
function brakeStand(locked: boolean, brake: number) {
  const r = rig('pinto', 'pinto')
  if (locked) { r.car.openDiff = false; r.car.wd = 0 }
  r.run(1, { ...none, handbrake: true })
  r.run(0.75, { ...none, handbrake: true, throttle: 1 })
  r.run(2, { ...none, brake, throttle: 1 })
  const c = r.car
  return [Math.abs(c.ww + c.wd) * 30 / Math.PI, Math.abs(c.ww - c.wd) * 30 / Math.PI]
}

test('a stock Pinto (open diff) spins one rear tyre, the right', () => {
  const [left, right] = brakeStand(false, 0.7)
  expect(right).toBeGreaterThan(300)
  expect(right).toBeGreaterThan(left * 4)
}, 60000)

test('with a locked rear both tyres spin together', () => {
  const [left, right] = brakeStand(true, 0.5)
  expect(left).toBeGreaterThan(200)
  expect(Math.abs(left - right)).toBeLessThan(1)
}, 60000)
