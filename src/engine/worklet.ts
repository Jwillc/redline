// The engine on the audio thread. The page sends crank speed, throttle and damage; this sends back
// the cycle-mean torque and a snapshot of every pipe, cylinder and piston for drawing.
import { EngineSim, SNAP_POINTS } from './model'
import { ENGINES } from './presets'

declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
}

class EngineProcessor extends AudioWorkletProcessor {
  sim: EngineSim
  omega = 0
  blocks = 0
  constructor() {
    super()
    this.sim = new EngineSim(ENGINES[0], sampleRate)
    this.port.onmessage = (e: MessageEvent) => this.msg(e.data)
  }
  msg(d: any) {
    if (d.type === 'engine') {
      const spec = ENGINES.find(x => x.id === d.id) ?? ENGINES[0]
      const old = this.sim
      this.sim = new EngineSim(spec, sampleRate)
      this.sim.omega = old.omega
    } else if (d.type === 'ctl') {
      this.omega = d.omega
      this.sim.throttle = d.throttle
      this.sim.fuelCut = d.fuelCut
      for (let i = 0; i < this.sim.misfire.length; i++) this.sim.misfire[i] = d.misfire?.[i] ?? 0
      if (d.muffler !== this.sim.muffler) this.sim.setMuffler(d.muffler)
    }
  }
  process(_in: Float32Array[][], outputs: Float32Array[][]) {
    const o = outputs[0]
    const L = o[0], R = o[1] ?? null
    this.sim.process(L, R, L.length, this.omega)
    this.blocks++
    if (this.blocks % 3 === 0) {
      const t = this.sim.torque()
      this.port.postMessage({ type: 'torque', brake: t.brake, indicated: t.indicated, loud: this.sim.loud, plenum: this.sim.plenumPressure(), id: this.sim.spec.id })
    }
    if (this.blocks % 6 === 0) {
      const s = this.sim
      const n = s.cyl.length
      const snap = new Float32Array(n * 3 + s.pipes.length * SNAP_POINTS + 1)
      let k = 0
      for (let i = 0; i < n; i++) snap[k++] = s.pistonAt(i)
      for (let i = 0; i < n; i++) snap[k++] = s.cyl[i].p
      for (let i = 0; i < n; i++) snap[k++] = s.cyl[i].burnGlow
      for (const p of s.pipes) for (let j = 0; j < SNAP_POINTS; j++) snap[k++] = p.at((j + 0.5) / SNAP_POINTS)
      snap[k++] = s.opens.reduce((a, o) => a + Math.abs(o.hp), 0)
      this.port.postMessage({ type: 'snap', id: s.spec.id, snap }, [snap.buffer])
    }
    return true
  }
}

registerProcessor('engine', EngineProcessor)
