// Renders the simulated engine in the conditions of the reference clips (idle near 800 and 1,000 rpm,
// a light-throttle free rev near 2,400), mono WAVs at 48 kHz, for tools/pinto-profile.py to compare.
//   bun tools/pintoref.ts <outdir> [engine]
import { EngineSim } from '../src/engine/model'
import { ENGINES } from '../src/engine/presets'
import { mkdirSync, writeFileSync } from 'fs'
const out = process.argv[2] ?? 'out/pintoref'
const spec = ENGINES.find(e => e.id === (process.argv[3] ?? 'pinto'))!
mkdirSync(out, { recursive: true })
function render(name: string, rpm: number, secs: number) {
  const sim = new EngineSim(spec, 48000)
  const w = rpm * Math.PI / 30
  sim.omega = w
  const B = 128, L = new Float32Array(B), R = new Float32Array(B)
  const n = secs * 48000, pcm = new Int16Array(n)
  // hold the speed with the throttle, as a governor would, so the load is what holding it takes
  let thr = 0.02, k = 0
  for (let b = 0; b < n / B + 48000 / B; b++) {
    sim.throttle = thr
    sim.process(L, R, B, w)
    thr = Math.max(0, Math.min(1, thr + (-sim.torque().brake) * 0.00002))
    if (b >= 48000 / B) for (let i = 0; i < B && k < n; i++) pcm[k++] = Math.max(-32767, Math.min(32767, (L[i] + R[i]) * 0.5 * 32767))
  }
  const data = Buffer.from(pcm.buffer), h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(48000, 24); h.writeUInt32LE(96000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  writeFileSync(`${out}/${name}.wav`, Buffer.concat([h, data]))
  console.log(`${name}: ${rpm} rpm, throttle held at ${thr.toFixed(3)}, torque ${sim.torque().brake.toFixed(1)} Nm`)
}
render('sim-idle800', 800, 8)
render('sim-idle1000', 1000, 8)
render('sim-rev2400', 2400, 8)
