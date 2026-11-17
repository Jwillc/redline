// The crash dummy's body: yellow wire bones, a ribcage and a pelvis, the black-and-yellow target
// marks crash dummies wear, and a holder on the neck for the real CHIMERA head.
import * as THREE from 'three'
import { Dummy, J, DUMMY_BONES } from '../sim/dummy'

type V3 = [number, number, number]
const YELLOW = new THREE.Color(0xf2c230), DARK = new THREE.Color(0x2a2a2a), JOINT = new THREE.Color(0xd8dde4)
// a 1970s fellow: a rust-orange shirt, brown slacks, dark shoes
const SHIRT = new THREE.Color(0xd2763a), SHIRT2 = new THREE.Color(0x9a4f22), PANTS = new THREE.Color(0x6e5236), SHOE = new THREE.Color(0x2b2420), SKIN = new THREE.Color(0xd9a07a)
const MAX = 900

export class DummyView {
  group = new THREE.Group()
  /** the head's holder: frame x forward, y up, z out of the right side; origin at the glottis */
  holder = new THREE.Group()
  private pos = new Float32Array(MAX * 6)
  private col = new Float32Array(MAX * 6)
  private geo = new THREE.BufferGeometry()
  private n = 0
  /** metres per body cm of the head */
  headScale = 0.0125
  /** a crash dummy, or a person in clothes */
  look: 'dummy' | 'person' = 'dummy'
  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    const lines = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }))
    lines.frustumCulled = false
    lines.renderOrder = 4
    this.group.add(lines, this.holder)
  }
  private seg(a: V3, b: V3, c: THREE.Color) {
    if (this.n >= MAX) return
    const k = this.n * 6
    this.pos.set([a[0], a[1], a[2], b[0], b[1], b[2]], k)
    this.col.set([c.r, c.g, c.b, c.r, c.g, c.b], k)
    this.n++
  }
  private ring(c: V3, u: V3, v: V3, r: number, color: THREE.Color, n = 14, rv = r) {
    let prev: V3 | null = null
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI * 2
      const p: V3 = [c[0] + u[0] * Math.cos(a) * r + v[0] * Math.sin(a) * rv, c[1] + u[1] * Math.cos(a) * r + v[1] * Math.sin(a) * rv, c[2] + u[2] * Math.cos(a) * r + v[2] * Math.sin(a) * rv]
      if (prev) this.seg(prev, p, color)
      prev = p
    }
  }
  /** a crash dummy's target: a ring cut in four, alternate quarters dark */
  private target(c: V3, u: V3, v: V3, r: number) {
    for (let q = 0; q < 4; q++) {
      const col = q % 2 ? DARK : YELLOW
      let prev: V3 | null = null
      for (let i = 0; i <= 4; i++) {
        const a = (q + i / 4) * Math.PI / 2
        const p: V3 = [c[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r, c[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r, c[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r]
        if (prev) this.seg(prev, p, col)
        this.seg(c, p, col)
        prev = p
      }
    }
  }

  update(d: Dummy) {
    this.n = 0
    const P = (i: number) => d.get(i)
    const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
    const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
    const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const mid = (a: V3, b: V3, t = 0.5): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
    // the trunk's frame
    const up = unit(sub(P(J.neck), P(J.pelvis)))
    let right = unit(sub(P(J.rSho), P(J.lSho)))
    const fwd = unit(cross(up, right))
    right = unit(cross(fwd, up))
    // bones: each limb as two bowed lines
    const person = this.look === 'person'
    const legs = new Set<number>([J.lHip, J.rHip, J.lKnee, J.rKnee, J.lFoot, J.rFoot])
    for (const [a, b] of DUMMY_BONES) {
      if (a === J.head || b === J.head) continue
      const A = P(a), B = P(b)
      const col = !person ? YELLOW : (legs.has(a) && legs.has(b)) || a === J.pelvis ? PANTS : SHIRT
      const side = unit(cross(sub(B, A), fwd))
      const m = mid(A, B, 0.4)
      const w = a === J.chest || b === J.chest || a === J.pelvis ? 0.025 : 0.035
      for (const s of [1, -1]) {
        const M: V3 = [m[0] + side[0] * w * s, m[1] + side[1] * w * s, m[2] + side[2] * w * s]
        this.seg(A, M, col); this.seg(M, B, col)
      }
    }
    // ribcage: rings around the spine between pelvis and neck
    const pel = P(J.pelvis), neck = P(J.neck), chest = P(J.chest)
    for (let k = 0; k < 5; k++) {
      const t = 0.42 + k * 0.12
      const c = mid(pel, neck, t)
      this.ring(c, right, fwd, 0.17 - Math.abs(k - 2) * 0.012, person ? (k % 2 ? SHIRT2 : SHIRT) : k % 2 ? DARK : YELLOW, 14, 0.11)
    }
    this.ring(pel, right, fwd, 0.17, person ? PANTS : YELLOW, 14, 0.1)
    this.ring(mid(pel, chest, 0.2), right, fwd, 0.15, person ? PANTS : DARK, 12, 0.09)
    // targets on the sides of the hips and the chest (a dummy's), or a collar (a person's)
    if (person) {
      const nk = P(J.neck)
      this.ring([nk[0] - up[0] * 0.03, nk[1] - up[1] * 0.03, nk[2] - up[2] * 0.03], right, fwd, 0.09, SHIRT2, 10, 0.07)
    } else for (const [j, s] of [[J.lHip, -1], [J.rHip, 1]] as [number, number][]) {
      const c = P(j)
      this.target([c[0] + right[0] * s * 0.06, c[1] + right[1] * s * 0.06, c[2] + right[2] * s * 0.06], fwd, up, 0.07)
    }
    const cc = mid(pel, neck, 0.66)
    if (!person) this.target([cc[0] + fwd[0] * 0.12, cc[1] + fwd[1] * 0.12, cc[2] + fwd[2] * 0.12], right, up, 0.06)
    // joints
    for (const j of [J.lElb, J.rElb, J.lKnee, J.rKnee, J.lSho, J.rSho]) {
      const c = P(j)
      this.ring(c, right, up, 0.035, person ? (j === J.lKnee || j === J.rKnee ? PANTS : SHIRT2) : JOINT, 8)
    }
    // hands and feet
    for (const [j, e] of [[J.lHand, J.lElb], [J.rHand, J.rElb], [J.lFoot, J.lKnee], [J.rFoot, J.rKnee]] as [number, number][]) {
      const c = P(j), dir = unit(sub(c, P(e)))
      const tip: V3 = [c[0] + dir[0] * 0.09, c[1] + dir[1] * 0.09, c[2] + dir[2] * 0.09]
      const ext = !person ? YELLOW : j >= J.lFoot ? SHOE : SKIN
      this.seg(c, tip, ext)
      this.ring(c, right, j >= J.lFoot ? fwd : dir, 0.04, ext, 8)
    }
    // the head sits on the neck, its own up along neck → head
    const head = P(J.head)
    const hu = unit(sub(head, neck))
    let hr = unit(sub(right, [hu[0] * (right[0] * hu[0] + right[1] * hu[1] + right[2] * hu[2]), hu[1] * (right[0] * hu[0] + right[1] * hu[1] + right[2] * hu[2]), hu[2] * (right[0] * hu[0] + right[1] * hu[1] + right[2] * hu[2])]))
    const hf = unit(cross(hu, hr))
    hr = unit(cross(hf, hu))
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...hf), new THREE.Vector3(...hu), new THREE.Vector3(...hr))
    this.holder.quaternion.setFromRotationMatrix(m)
    // the glottis sits a little below the head's centre: put it just above the neck joint
    this.holder.position.set(neck[0] - hu[0] * 0.01 - hf[0] * 0.005, neck[1] - hu[1] * 0.01 - hf[1] * 0.005, neck[2] - hu[2] * 0.01 - hf[2] * 0.005)
    this.holder.scale.setScalar(this.headScale)
    this.geo.setDrawRange(0, this.n * 2)
    ;(this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
  }
}
