// The real CHIMERA head (Jameson Hodge's Anatomy3D) on the dummy's neck. This module touches the
// voice engine when it loads, so it is imported only after the engine's wasm is ready.
import * as THREE from 'three'
import { Anatomy3D } from '../chimera/ui/render/anatomy3d.ts'
import { VoiceModel } from '../chimera/ui/analysis.ts'
import { PRESETS } from '../chimera/ui/body.ts'
import { NEUTRAL, type HumanArtic } from '../chimera/wasm/engine.ts'
import type { ViewFlags } from '../chimera/ui/render/anatomy.ts'

const VIEW: ViewFlags = { pressure: true, particles: true, grid: false, calipers: false }
/** mouth wide open, as when flying through a windscreen */
const SCREAM: HumanArtic = { ...NEUTRAL, jaw: 1.7, lipAp: 1.5 }

export class ChimeraHead {
  readonly r = new Anatomy3D()
  readonly model = new VoiceModel(PRESETS.male, 48000)
  private open = 0
  constructor(holder: THREE.Group) {
    this.r.centred = true
    holder.add(this.r.root)
  }
  resize(w: number, h: number) { this.r.resize(w, h) }
  /** scream: 0 closed, 1 wide open */
  update(camera: THREE.Camera, scream: number, dt: number) {
    this.open += (scream - this.open) * Math.min(1, dt * 8)
    const a: HumanArtic = { ...NEUTRAL }
    for (const k of Object.keys(SCREAM) as (keyof HumanArtic)[]) {
      const n = NEUTRAL[k] as number, s = SCREAM[k] as number
      ;(a as unknown as Record<string, number>)[k] = n + (s - n) * this.open
    }
    this.r.camera.position.copy(camera.position)
    this.r.update(this.model, this.model.frame(a), a, null, VIEW, dt)
  }
}
