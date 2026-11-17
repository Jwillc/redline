// Runs every engine at fixed speeds and throttles; prints torque, power and loudness.
//   bun tools/calibrate.ts            table
//   bun tools/calibrate.ts wav        also writes out/<id>-sweep.wav (idle, a rev to redline, lift off)
import { EngineSim } from '../src/engine/model'
import { ENGINES } from '../src/engine/presets'
import { mkdirSync, writeFileSync } from 'fs'

const fs = 48000
const B = 128
const only = process.argv.find(a => a.startsWith('only='))?.slice(5)

function hold(sim: EngineSim, rpm: number, thr: number, secs: number) {
  const w = rpm * 2 * Math.PI / 60
  sim.throttle = thr
  const L = new Float32Array(B), R = new Float32Array(B)
  let acc = 0, n = 0, peak = 0
  const blocks = Math.round(secs * fs / B)
  for (let b = 0; b < blocks; b++) {
    sim.process(L, R, B, w)
    if (b > blocks / 2) for (let i = 0; i < B; i++) { acc += L[i] * L[i]; n++; peak = Math.max(peak, Math.abs(L[i])) }
  }
  return { ...sim.torque(), rms: Math.sqrt(acc / n), peak, plen: sim.plenumPressure() / 1000 }
}

for (const e of ENGINES) {
  if (only && e.id !== only) continue
  const sim = new EngineSim(e, fs)
  sim.omega = e.idle * 2 * Math.PI / 60
  const t0 = performance.now()
  const rows: string[] = []
  let best = { tq: 0, at: 0 }, bestP = { p: 0, at: 0 }
  for (const rpm of [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000].filter(r => r <= e.redline)) {
    const r = hold(sim, rpm, 1, 0.5)
    const kw = r.brake * rpm * 2 * Math.PI / 60 / 1000
    if (r.brake > best.tq) best = { tq: r.brake, at: rpm }
    if (kw > bestP.p) bestP = { p: kw, at: rpm }
    rows.push(`${rpm}: ${r.brake.toFixed(0)}Nm ${kw.toFixed(0)}kW rms=${r.rms.toFixed(3)} pk=${r.peak.toFixed(2)} plen=${r.plen.toFixed(0)}`)
  }
  const idle = hold(sim, e.idle, 0.0, 0.6)
  const over = hold(sim, 4000, 0, 0.5)
  const ms = performance.now() - t0
  const simSecs = 0.5 * rows.length + 1.1
  console.log(`\n${e.name}: peak ${best.tq.toFixed(0)} Nm @${best.at}, ${bestP.p.toFixed(0)} kW (${(bestP.p * 1.341).toFixed(0)} hp) @${bestP.at}; cpu ${(ms / simSecs / 10).toFixed(1)}% of realtime`)
  console.log('  ' + rows.join('\n  '))
  console.log(`  idle closed ${e.idle}: ${idle.brake.toFixed(0)}Nm rms=${idle.rms.toFixed(3)} plen=${idle.plen.toFixed(0)}kPa;  4000 closed: ${over.brake.toFixed(0)}Nm rms=${over.rms.toFixed(3)} plen=${over.plen.toFixed(0)}`)
}

if (process.argv.includes('wav')) {
  mkdirSync('out', { recursive: true })
  for (const e of ENGINES) {
    if (only && e.id !== only) continue
    const sim = new EngineSim(e, fs)
    const secs = 9
    const L = new Float32Array(B), R = new Float32Array(B)
    const out = new Int16Array(secs * fs * 2)
    let rpm = e.idle
    let idx = 0
    for (let b = 0; b < secs * fs / B; b++) {
      const t = b * B / fs
      let thr = 0
      if (t > 1.5 && t < 4.5) thr = 1
      else if (t > 6 && t < 6.6) thr = 0.6
      const target = thr > 0 ? e.redline * (t < 4.5 ? 1 : 0.6) : e.idle
      rpm += (target - rpm) * (thr > 0 ? 0.004 : 0.006)
      sim.throttle = thr + (rpm < e.idle + 50 ? 0.03 : 0)
      sim.fuelCut = thr === 0 && rpm > e.idle + 600
      sim.process(L, R, B, rpm * 2 * Math.PI / 60)
      for (let i = 0; i < B; i++) {
        out[idx++] = Math.max(-32767, Math.min(32767, L[i] * 32767))
        out[idx++] = Math.max(-32767, Math.min(32767, R[i] * 32767))
      }
    }
    const data = Buffer.from(out.buffer)
    const h = Buffer.alloc(44)
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(fs, 24)
    h.writeUInt32LE(fs * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
    writeFileSync(`out/${e.id}-sweep.wav`, Buffer.concat([h, data]))
    console.log('wrote', `out/${e.id}-sweep.wav`)
  }
}
