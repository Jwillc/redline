// The car's skin, drawn as see-through panels with their grid lines so the engine shows inside.
// Every panel is cut from one surface S(z, s, side): z along the car, s round the section from the
// belly (0) up the side to the middle of the top (6). Dents move vertices; loose panels fly off.
import * as THREE from 'three'
import type { GlassId, PanelId } from '../sim/damage'

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

import { STREET_SHAPE, type BodyShape } from '../sim/shape'

/** a measured outline at z (points from nose to tail), straight between points */
function along(pts: [number, number][], z: number) {
  if (z >= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    const [z1, y1] = pts[i], [z0, y0] = pts[i - 1]
    if (z >= z1) return y1 + (y0 - y1) * (z - z1) / (z0 - z1)
  }
  return pts[pts.length - 1][1]
}

function halfWidth(S: BodyShape, z: number) {
  if (S.profile) return along(S.profile.width, z)
  const end = z >= 0 ? S.front : S.rear
  return S.hw - 0.11 * smooth(end - 0.65, end, Math.abs(z))
}
function bottom(S: BodyShape, z: number) {
  if (S.profile) return along(S.profile.bottom, z)
  const end = z >= 0 ? S.front : S.rear
  return S.bottom + 0.1 * smooth(end - 0.5, end, Math.abs(z))
}
function belt(S: BodyShape, z: number) {
  if (S.profile) return along(S.profile.belt, z)
  if (z > S.ws) return lerp(S.beltWs, S.noseH, smooth(S.ws, S.front, z))
  if (z < S.glassEnd) return lerp(S.deckH, S.tailH, smooth(-S.glassEnd, S.rear, -z))
  return lerp(S.beltWs + 0.02, S.deckH, smooth(S.roofFront - 0.4, S.glassEnd, z))
}
function top(S: BodyShape, z: number) {
  if (S.profile) return along(S.profile.top, z)
  const b = belt(S, z)
  if (z <= S.ws && z >= S.roofFront) return lerp(b + 0.02, S.roofH, smooth(S.ws, S.roofFront, z))
  if (z < S.roofFront && z > S.roofBack) return S.roofH + 0.02 * Math.cos((z - (S.roofFront + S.roofBack) / 2) * 2.5)
  if (z <= S.roofBack && z >= S.glassEnd) return lerp(S.roofH, b + 0.03, smooth(S.roofBack, S.glassEnd, z))
  return b + 0.04
}
function glassHalf(S: BodyShape, z: number) {
  const w = halfWidth(S, z)
  const cabin = smooth(S.ws + 0.1, S.roofFront + 0.1, z) * smooth(S.glassEnd - 0.1, S.roofBack - 0.1, z)
  return lerp(w - 0.28, S.roofHalf, cabin)
}
/** Point on the skin, in the car's frame (x left). side 1 = left, -1 = right. */
export function skin(S: BodyShape, z: number, s: number, side: number): [number, number, number] {
  const w = halfWidth(S, z), y0 = bottom(S, z), hb = belt(S, z), ht = top(S, z), gw = glassHalf(S, z)
  const pts: [number, number][] = [[0, y0], [w - 0.1, y0], [w, y0 + 0.16], [w, hb - 0.08], [w - 0.04, hb], [gw, ht - 0.03], [0, ht]]
  const i = Math.min(5, Math.max(0, Math.floor(s)))
  const t = s - i
  const a = pts[i], b = pts[i + 1]
  return [side * lerp(a[0], b[0], t), lerp(a[1], b[1], t), z]
}

interface PanelDef { id: PanelId | GlassId; glass?: boolean; z: [number, number]; s: [number, number]; sides: number[]; cap?: 1 | -1 }
function defsFor(S: BodyShape): PanelDef[] {
  const nose = S.front - 0.28, tail = -S.rear + 0.28, door = S.roofBack - 0.05
  return [
    { id: 'bumperF', z: [nose, S.front], s: [0, 6], sides: [1, -1], cap: 1 },
    { id: 'bumperR', z: [-S.rear, tail], s: [0, 6], sides: [1, -1], cap: -1 },
    { id: 'hood', z: [S.ws + 0.01, nose], s: [4, 6], sides: [1, -1] },
    { id: 'fenderL', z: [S.ws + 0.01, nose], s: [0, 4], sides: [1] },
    { id: 'fenderR', z: [S.ws + 0.01, nose], s: [0, 4], sides: [-1] },
    { id: 'doorL', z: [door, S.ws + 0.01], s: [0, 4], sides: [1] },
    { id: 'doorR', z: [door, S.ws + 0.01], s: [0, 4], sides: [-1] },
    { id: 'quarterL', z: [tail, door], s: [0, 4], sides: [1] },
    { id: 'quarterR', z: [tail, door], s: [0, 4], sides: [-1] },
    { id: 'roof', z: [S.roofBack, S.roofFront], s: [5, 6], sides: [1, -1] },
    { id: 'trunk', z: [tail, S.glassEnd], s: [4, 6], sides: [1, -1] },
    { id: 'windshield', glass: true, z: [S.roofFront, S.ws + 0.01], s: [4.6, 6], sides: [1, -1] },
    { id: 'rear', glass: true, z: [S.glassEnd, S.roofBack], s: [4.6, 6], sides: [1, -1] },
    { id: 'sideL', glass: true, z: [S.roofBack, S.roofFront], s: [4, 5], sides: [1] },
    { id: 'sideR', glass: true, z: [S.roofBack, S.roofFront], s: [4, 5], sides: [-1] },
    // fill pieces that never come off: the pillars beside the windscreen and rear glass
    { id: 'roof', z: [S.roofFront, S.ws + 0.01], s: [4, 4.6], sides: [1, -1] },
    { id: 'roof', z: [S.glassEnd, S.roofBack], s: [4, 4.6], sides: [1, -1] },
  ]
}

export interface Panel {
  id: PanelId | GlassId
  glass: boolean
  group: THREE.Group
  geo: THREE.BufferGeometry
  rest: Float32Array
  off: boolean
}

export class Body {
  group = new THREE.Group()
  panels: Panel[] = []
  mat: THREE.MeshStandardMaterial
  glassMat: THREE.MeshStandardMaterial
  lineMat: THREE.LineBasicMaterial
  glassLine: THREE.LineBasicMaterial
  constructor(readonly shape: BodyShape = STREET_SHAPE) {
    this.mat = new THREE.MeshStandardMaterial({ color: 0x20252c, metalness: 0.7, roughness: 0.35, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide })
    this.glassMat = new THREE.MeshStandardMaterial({ color: 0x8fb4d8, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })
    this.lineMat = new THREE.LineBasicMaterial({ color: 0x9aa6b4, transparent: true, opacity: 0.32, depthWrite: false })
    this.glassLine = new THREE.LineBasicMaterial({ color: 0x9fc6ee, transparent: true, opacity: 0.16, depthWrite: false })
    for (const d of defsFor(shape)) this.panels.push(this.make(d))
    this.decorate()
  }
  make(d: PanelDef): Panel {
    const pos: number[] = []
    const tri: number[] = []
    const lines: number[] = []
    const nz = Math.max(2, Math.ceil((d.z[1] - d.z[0]) / 0.11))
    const ns = Math.max(2, Math.ceil((d.s[1] - d.s[0]) * 2.5))
    for (const side of d.sides) {
      const base = pos.length / 3
      for (let i = 0; i <= nz; i++) for (let j = 0; j <= ns; j++) {
        const z = lerp(d.z[0], d.z[1], i / nz), s = lerp(d.s[0], d.s[1], j / ns)
        pos.push(...this.arch(skin(this.shape, z, s, side), s))
      }
      const at = (i: number, j: number) => base + i * (ns + 1) + j
      for (let i = 0; i < nz; i++) for (let j = 0; j < ns; j++) {
        tri.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1))
      }
      for (let i = 0; i <= nz; i++) for (let j = 0; j < ns; j++) if (i % 2 === 0 || i === nz) lines.push(at(i, j), at(i, j + 1))
      for (let j = 0; j <= ns; j++) for (let i = 0; i < nz; i++) if (j % 2 === 0 || j === ns) lines.push(at(i, j), at(i + 1, j))
    }
    if (d.cap) {
      // close the nose or the tail with a fan across its section
      const z = d.cap > 0 ? d.z[1] : d.z[0]
      const ring: number[] = []
      for (const side of [1, -1]) for (let k = 0; k <= 12; k++) {
        const s = side > 0 ? k / 2 : 6 - k / 2
        pos.push(...skin(this.shape, z, s, side))
        ring.push(pos.length / 3 - 1)
      }
      pos.push(0, (bottom(this.shape, z) + top(this.shape, z)) / 2, z + d.cap * 0.02)
      const c = pos.length / 3 - 1
      for (let k = 0; k < ring.length; k++) {
        tri.push(c, ring[k], ring[(k + 1) % ring.length])
        if (k % 2 === 0) lines.push(ring[k], ring[(k + 1) % ring.length])
      }
    }
    const geo = new THREE.BufferGeometry()
    const arr = new Float32Array(pos)
    const attr = new THREE.BufferAttribute(arr, 3)
    geo.setAttribute('position', attr)
    geo.setIndex(tri)
    geo.computeVertexNormals()
    const lgeo = new THREE.BufferGeometry()
    lgeo.setAttribute('position', attr)
    lgeo.setIndex(lines)
    const group = new THREE.Group()
    const mesh = new THREE.Mesh(geo, d.glass ? this.glassMat : this.mat)
    mesh.renderOrder = 2
    const ls = new THREE.LineSegments(lgeo, d.glass ? this.glassLine : this.lineMat)
    ls.renderOrder = 3
    group.add(mesh, ls)
    this.group.add(group)
    return { id: d.id, glass: !!d.glass, group, geo, rest: arr.slice(), off: false }
  }
  /** Swing the driver's (left) door open on its front hinge: 0 shut, about 1.1 wide open. */
  setDoor(open: number) {
    const S = this.shape, a = -open
    const px = S.hw, pz = S.ws + 0.01
    for (const p of this.panels) {
      if (p.off || (p.id !== 'doorL' && p.id !== 'sideL')) continue
      const c = Math.cos(a), sn = Math.sin(a)
      p.group.rotation.y = a
      p.group.position.set(px - (px * c + pz * sn), 0, pz - (-px * sn + pz * c))
    }
  }

  /** Open the wheel arches: a point of the side within an arch's circle moves out to its edge. */
  arch(p: [number, number, number], s: number): [number, number, number] {
    if (!this.shape.arches || s > 3.6) return p
    for (const a of this.shape.arches) {
      const dz = p[2] - a.z, dy = p[1] - a.y, d = Math.hypot(dz, dy)
      if (d >= a.r) continue
      if (dy >= 0) { const k = a.r / Math.max(d, 1e-6); return [p[0], a.y + dy * k, a.z + dz * k] }
      // below the arch's centre: straight out sideways to the edge, keeping the height
      return [p[0], p[1], a.z + Math.sign(dz || 1) * Math.sqrt(a.r * a.r - dy * dy)]
    }
    return p
  }

  /** A Pinto's details, each on the panel it belongs to (so they fly off with it). */
  decorate() {
    const S = this.shape
    if (S.style !== 'pinto') return
    const panel = (id: string) => this.panels.find(p => p.id === id)
    const lineMat = new THREE.LineBasicMaterial({ color: 0xd2d8e0, transparent: true, opacity: 0.75, depthWrite: false })
    const lampMat = new THREE.LineBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.9, depthWrite: false })
    const tailMat = new THREE.LineBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.9, depthWrite: false })
    const chrome = new THREE.MeshStandardMaterial({ color: 0xaab3bd, metalness: 0.9, roughness: 0.25, transparent: true, opacity: 0.55, depthWrite: false })
    const lines = (id: string, pts: number[], mat = lineMat) => {
      const p = panel(id)
      if (!p || !pts.length) return
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      const l = new THREE.LineSegments(g, mat)
      l.renderOrder = 4
      p.group.add(l)
    }
    const ring = (out: number[], cx: number, cy: number, cz: number, r: number, axis: 'z' | 'x', n = 20, a0 = 0, a1 = Math.PI * 2) => {
      for (let k = 0; k < n; k++) {
        const t0 = a0 + (a1 - a0) * k / n, t1 = a0 + (a1 - a0) * (k + 1) / n
        if (axis === 'z') out.push(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r, cz, cx + Math.cos(t1) * r, cy + Math.sin(t1) * r, cz)
        else out.push(cx, cy + Math.sin(t0) * r, cz + Math.cos(t0) * r, cx, cy + Math.sin(t1) * r, cz + Math.cos(t1) * r)
      }
    }
    const rect = (out: number[], x0: number, x1: number, y0: number, y1: number, z: number) => out.push(x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z)
    // bumper bars, nose and tail
    const B = S.bumper ?? 0.1
    for (const [id, z] of [['bumperF', S.front + B / 2], ['bumperR', -S.rear - B / 2]] as [string, number][]) {
      const geo = new THREE.BoxGeometry(1.66, 0.14, B)
      const m = new THREE.Mesh(geo, chrome)
      m.position.set(0, 0.45, z)
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat)
      e.position.copy(m.position)
      panel(id)?.group.add(m, e)
    }
    // the face: round headlights at the ends of a wide egg-crate grille
    const zf = S.front + 0.006
    const face: number[] = [], lamps: number[] = []
    for (const sx of [1, -1]) {
      ring(lamps, sx * 0.6, 0.6, zf, 0.085, 'z')
      ring(lamps, sx * 0.6, 0.6, zf, 0.055, 'z')
      rect(face, sx * 0.47, sx * 0.73, 0.5, 0.7, zf)
    }
    rect(face, -0.47, 0.47, 0.52, 0.68, zf)
    for (let x = -0.4; x <= 0.401; x += 0.08) face.push(x, 0.52, zf, x, 0.68, zf)
    face.push(-0.47, 0.6, zf, 0.47, 0.6, zf)
    lines('bumperF', face); lines('bumperF', lamps, lampMat)
    // the tail: horizontal lamps, a plate between them
    const zr = -S.rear - 0.006
    const tail: number[] = [], plate: number[] = []
    for (const sx of [1, -1]) { rect(tail, sx * 0.4, sx * 0.76, 0.6, 0.74, zr); tail.push(sx * 0.58, 0.6, zr, sx * 0.58, 0.74, zr) }
    rect(plate, -0.18, 0.18, 0.52, 0.66, zr)
    lines('bumperR', tail, tailMat); lines('bumperR', plate)
    // the trunk lid's cut and the hood's
    const deck: number[] = []
    const dz0 = S.glassEnd - 0.04, dz1 = -S.rear + 0.06
    const dy = (z: number) => top(S, z) + 0.005
    deck.push(0.66, dy(dz0), dz0, -0.66, dy(dz0), dz0, 0.66, dy(dz1), dz1, -0.66, dy(dz1), dz1, 0.66, dy(dz0), dz0, 0.66, dy(dz1), dz1, -0.66, dy(dz0), dz0, -0.66, dy(dz1), dz1)
    lines('trunk', deck)
    const hood: number[] = []
    const hz0 = S.ws + 0.06, hz1 = S.front - 0.06
    for (let z = hz0; z < hz1 - 0.01; z += 0.1) for (const sx of [1, -1]) { const w = halfWidth(S, z) - 0.08, w2 = halfWidth(S, z + 0.1) - 0.08; hood.push(sx * w, top(S, z) + 0.005, z, sx * w2, top(S, z + 0.1) + 0.005, z + 0.1) }
    hood.push(-0.7, top(S, hz0) + 0.005, hz0, 0.7, top(S, hz0) + 0.005, hz0)
    lines('hood', hood)
    // each side: the door's outline and handle, a crease along the body, lips round the arches
    for (const sx of [1, -1]) {
      const side = sx > 0 ? 'L' : 'R'
      const x = (z: number) => sx * (halfWidth(S, z) + 0.004)
      const door: number[] = []
      const d0 = S.ws + 0.02, d1 = S.roofBack - 0.04
      for (const z of [d0, d1]) door.push(x(z), bottom(S, z) + 0.05, z, x(z), belt(S, z), z)
      door.push(x(d0), bottom(S, d0) + 0.05, d0, x(d1), bottom(S, d1) + 0.05, d1)
      door.push(x(-0.62), belt(S, -0.62) - 0.07, -0.62, x(-0.74), belt(S, -0.74) - 0.07, -0.74)
      lines('door' + side, door)
      const crease = (id: string, z0: number, z1: number) => {
        const out: number[] = []
        for (let z = z0; z > z1 + 0.001; z -= 0.08) {
          const za = z, zb = Math.max(z1, z - 0.08)
          const inArch = (zz: number) => (S.arches ?? []).some(a => Math.abs(zz - a.z) < a.r + 0.03)
          if (inArch(za) || inArch(zb)) continue
          out.push(x(za), belt(S, za) - 0.13, za, x(zb), belt(S, zb) - 0.13, zb)
        }
        lines(id, out)
      }
      crease('fender' + side, S.front - 0.3, S.ws + 0.01)
      crease('door' + side, S.ws + 0.01, S.roofBack - 0.05)
      crease('quarter' + side, S.roofBack - 0.05, -S.rear + 0.3)
      for (const a of S.arches ?? []) {
        const lip: number[] = []
        for (let k = 0; k < 16; k++) {
          const t0 = Math.PI * k / 16, t1 = Math.PI * (k + 1) / 16
          const z0 = a.z + Math.cos(t0) * (a.r + 0.025), z1 = a.z + Math.cos(t1) * (a.r + 0.025)
          lip.push(x(z0), a.y + Math.sin(t0) * (a.r + 0.025), z0, x(z1), a.y + Math.sin(t1) * (a.r + 0.025), z1)
        }
        lines((a.z > 0 ? 'fender' : 'quarter') + side, lip)
      }
    }
  }

  /** Push the skin in around a contact: point and inward normal in the car's frame. */
  dent(lx: number, ly: number, lz: number, nx: number, ny: number, nz: number, depth: number, radius: number, seed: number) {
    let r = seed
    const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647 - 0.5 }
    for (const p of this.panels) {
      if (p.off) continue
      const a = p.geo.getAttribute('position') as THREE.BufferAttribute
      const v = a.array as Float32Array
      let moved = false
      for (let i = 0; i < v.length; i += 3) {
        const dx = v[i] - lx, dz = v[i + 2] - lz, dy = (v[i + 1] - ly) * 0.7
        const d2 = (dx * dx + dy * dy + dz * dz) / (radius * radius)
        if (d2 > 4) continue
        const f = Math.exp(-d2 * 1.6) * depth
        const cr = 1 + rnd() * 0.5
        v[i] += nx * f * cr
        v[i + 2] += nz * f * cr
        v[i + 1] += ny * f * cr + (rnd() * 0.25 - 0.08) * f
        // never past the far side of the car
        const ox = v[i] - p.rest[i], oy = v[i + 1] - p.rest[i + 1], oz = v[i + 2] - p.rest[i + 2]
        const lim = 0.6, ol = Math.hypot(ox, oy, oz)
        if (ol > lim) { const s = lim / ol; v[i] = p.rest[i] + ox * s; v[i + 1] = p.rest[i + 1] + oy * s; v[i + 2] = p.rest[i + 2] + oz * s }
        moved = true
      }
      if (moved) { a.needsUpdate = true; p.geo.computeVertexNormals() }
    }
  }
  find(id: PanelId | GlassId) { return this.panels.filter(p => p.id === id && !p.off) }
  repair() {
    for (const p of this.panels) {
      const a = p.geo.getAttribute('position') as THREE.BufferAttribute
      ;(a.array as Float32Array).set(p.rest)
      a.needsUpdate = true
      p.geo.computeVertexNormals()
      p.off = false
      if (p.group.parent !== this.group) { p.group.removeFromParent(); this.group.add(p.group) }
      p.group.position.set(0, 0, 0)
      p.group.quaternion.identity()
      p.group.visible = true
    }
  }
}
