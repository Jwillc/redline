// The places to drive: the open lot and three straight courses. Each has fixed concrete (walls,
// blocks, pillars, and hidden faces under tall drops), loose things (cones, barrels, crates, tyres)
// and a ground made of shapes (bumps, rollers, ramps, steps, potholes, pits) that the wheels follow.
import type { Car } from './car'

export interface Block { x: number; z: number; hx: number; hz: number; yaw: number; h: number; y0: number; kind: 'wall' | 'block' | 'pillar' | 'face' | 'kerb' | 'house' | 'tree' | 'parked' | 'fence' | 'post' }
export type PropKind = 'cone' | 'barrel' | 'crate' | 'tyre' | 'mailbox' | 'bin'
export interface Prop {
  kind: PropKind
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  r: number; h: number; m: number
  q: [number, number, number, number]
  wx: number; wy: number; wz: number
  home: [number, number, number]
  rest: boolean
}
export interface Impact {
  /** contact in the car's frame (x left, y up from the ground under a resting car, z forward) */
  lx: number; ly: number; lz: number
  /** inward normal in the car's frame */
  nx: number; ny: number; nz: number
  speed: number
  /** 1 for fixed concrete and ground; the other thing's share of the mass otherwise */
  hard: number
  wx: number; wz: number
  kind: 'fixed' | 'ground' | 'wheel' | PropKind
  scrape: number
  wheel?: number
  /** what was hit, for fixed concrete */
  block?: Block['kind']
}

/** Ground shapes. All run across the lane (x from -half to +half) unless they have their own x. */
export type Feature =
  | { k: 'bump'; z: number; len: number; h: number }
  | { k: 'rollers'; z: number; n: number; wl: number; h: number }
  | { k: 'ramp'; z: number; up: number; h: number; top: number; down: number; kick?: number }
  | { k: 'plateau'; z0: number; z1: number; h: number }
  | { k: 'hole'; x: number; z: number; r: number; d: number }
  | { k: 'pit'; z0: number; z1: number; d: number }
  | { k: 'stairs'; z: number; n: number; rise: number; run: number }

export interface Hood {
  kerb: number
  roads: [number, number, number, number][]
  drives: { x0: number; x1: number; z0: number; z1: number; axis: 'x' | 'z'; edge: number }[]
  bumps: { x0: number; x1: number; z: number; len: number; h: number }[]
  houses: { x: number; z: number; w: number; d: number; side: number; color: string; garage: number }[]
  trees: [number, number, number, number][]
  parked: { x: number; z: number; yaw: number; color: string }[]
  lamps: [number, number][]
  signs: [number, number][]
  xs: number[]
  zs: number[]
  bounds: [number, number, number, number]
  roadHalf: number
}

export interface Track {
  id: string
  name: string
  blurb: string
  length: number
  half: number
  features: Feature[]
  marks: { z: number; label: string }[]
  /** a drift loop's centreline, every 2 m, closed */
  path?: [number, number][]
}

export const TRACKS: { id: string; name: string; blurb: string }[] = [
  { id: 'lot', name: 'The Lot', blurb: 'Open concrete: pillars, cones, barrels, crates and blocks.' },
  { id: 'bumps', name: 'Bumps', blurb: 'Speed bumps, rollers, potholes, a kicker, a tabletop and a curb.' },
  { id: 'jumps', name: 'Jumps', blurb: 'A gap jump, steps, a pit, a ski jump and a flight of stairs.' },
  { id: 'crash', name: 'Crash Lane', blurb: 'Walls of cones, barrels, crates and tyres, bollards, and a ramp into concrete.' },
  { id: 'hood', name: 'Neighborhood', blurb: 'A 1970s suburb in a Ford Pinto: kerbs, driveways, mailboxes, trash cans and parked cars.' },
  { id: 'drift', name: 'Drift', blurb: 'A walled loop for sliding: a fast sweeper, a chicane, a hairpin and a long bowl. Angle times speed scores.' },
]

const smooth = (t: number) => t * t * (3 - 2 * t)

export class World {
  track: Track
  blocks: Block[] = []
  props: Prop[] = []
  size = 170
  seed = 7
  /** Sorted by start; [z0, z1, feature] */
  spans: [number, number, Feature][] = []
  start: { x: number; z: number; yaw: number } = { x: 0, z: 0, yaw: 0 }
  constructor(id = 'lot') {
    this.track = { id, name: '', blurb: '', length: 0, half: 7, features: [], marks: [] }
    const t = TRACKS.find(t => t.id === id) ?? TRACKS[0]
    this.track.name = t.name
    this.track.blurb = t.blurb
    if (id === 'lot') this.buildLot()
    else if (id === 'drift') this.buildDrift()
    else if (id === 'hood') this.buildHood()
    else this.buildCourse(id)
    this.spans = this.track.features.map(f => [...this.extent(f), f] as [number, number, Feature]).sort((a, b) => a[0] - b[0])
  }
  get isCourse() { return this.track.id !== 'lot' && this.track.id !== 'drift' && this.track.id !== 'hood' }
  get isDrift() { return this.track.id === 'drift' }
  get isHood() { return this.track.id === 'hood' }
  rand() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647 }

  extent(f: Feature): [number, number] {
    switch (f.k) {
      case 'bump': return [f.z - f.len / 2, f.z + f.len / 2]
      case 'rollers': return [f.z, f.z + f.n * f.wl]
      case 'ramp': return [f.z, f.z + f.up + f.top + f.down]
      case 'plateau': return [f.z0, f.z1]
      case 'hole': return [f.z - f.r, f.z + f.r]
      case 'pit': return [f.z0, f.z1]
      case 'stairs': return [f.z, f.z + f.n * f.run]
    }
  }

  /** Ground height at a point. */
  height(x: number, z: number): number {
    if (this.hood) return this.hoodHeight(x, z)
    if (!this.spans.length) return 0
    let h = 0
    const half = this.track.half
    for (const [z0, z1, f] of this.spans) {
      if (z0 > z + 0.001) break
      if (z > z1 + 0.001) continue
      if (f.k === 'hole') {
        const d = Math.hypot(x - f.x, z - f.z)
        if (d < f.r) h -= f.d * Math.min(1, (f.r - d) / 0.12)
        continue
      }
      if (Math.abs(x) > half + 0.5) continue
      switch (f.k) {
        case 'bump': {
          const t = (z - f.z) / f.len * 2
          if (Math.abs(t) < 1) h += f.h * 0.5 * (1 + Math.cos(Math.PI * t))
          break
        }
        case 'rollers': {
          const t = (z - f.z) / f.wl
          if (t >= 0 && t <= f.n) h += f.h * 0.5 * (1 - Math.cos(2 * Math.PI * t))
          break
        }
        case 'ramp': {
          const d = z - f.z
          if (d < 0) break
          if (d <= f.up) {
            const t = d / f.up
            // a kick curves the end of the ramp upward
            const k = f.kick ?? 0
            h += f.h * (t * (1 - k) + k * t * t)
          } else if (d <= f.up + f.top) h += f.h
          else if (f.down > 0 && d <= f.up + f.top + f.down) h += f.h * (1 - smooth((d - f.up - f.top) / f.down))
          break
        }
        case 'plateau':
          if (z >= f.z0 && z <= f.z1) h += f.h
          break
        case 'pit':
          if (z >= f.z0 && z <= f.z1) h -= f.d
          break
        case 'stairs': {
          const i = Math.floor((z - f.z) / f.run)
          if (i >= 0 && i < f.n) h += f.rise * (f.n - i)
          break
        }
      }
    }
    return h
  }

  // ------------------------------------------------------------------ the lot
  buildLot() {
    const S = this.size
    this.start = { x: 0, z: 0, yaw: 0 }
    const B = (x: number, z: number, hx: number, hz: number, h: number, kind: Block['kind'] = 'block', yaw = 0) => this.blocks.push({ x, z, hx, hz, yaw, h, y0: 0, kind })
    B(0, S, S + 1, 1, 1.4, 'wall'); B(0, -S, S + 1, 1, 1.4, 'wall'); B(S, 0, 1, S + 1, 1.4, 'wall'); B(-S, 0, 1, S + 1, 1.4, 'wall')
    for (let x = 40; x <= 112; x += 12) for (let z = -48; z <= 48; z += 12) B(x, z, 0.45, 0.45, 3.2, 'pillar')
    for (let x = -100; x <= 100; x += 7) if (Math.abs(x) > 12 && (x + 100) % 35 !== 0) B(x, -55, 3, 0.35, 0.9, 'wall')
    B(-30, -90, 4, 1.5, 2, 'block'); B(0, -100, 2.5, 2.5, 2.4, 'block'); B(30, -90, 4, 1.5, 2, 'block', 0.6)
    for (let i = 0; i < 6; i++) B(-70 + (i % 2 ? 6 : -6), 40 + i * 16, 5, 0.6, 1.0, 'wall')
    B(0, 150, 30, 1, 1.6, 'wall')
    B(-110, -20, 18, 0.5, 1.2, 'wall', 0.4); B(-110, 30, 18, 0.5, 1.2, 'wall', -0.4)
    const P = this.prop.bind(this)
    for (let i = 0; i < 12; i++) P('cone', (i % 2 ? 1 : -1) * 1.5, 30 + i * 9)
    for (let i = 0; i < 8; i++) { P('cone', -8, 60 + i * 3); P('cone', 8, 60 + i * 3) }
    for (let row = 0; row < 3; row++) for (let i = 0; i < 10; i++) P('barrel', -40 - row * 0.65, -10 + i * 0.64 + (row % 2) * 0.32)
    this.pyramid(-20, 20, 4); this.pyramid(20, 20, 4); this.pyramid(0, -30, 4)
    for (let s = 0; s < 4; s++) for (let k = 0; k < 4; k++) P('tyre', -60 + s * 1.5 - 2, 130 + (s % 2), k * 0.25)
    for (let i = 0; i < 26; i++) P('cone', 46 + this.rand() * 60, -40 + this.rand() * 80)
    for (let i = 0; i < 6; i++) P('barrel', -8 + i * 0.7, -94)
  }

  // ------------------------------------------------------------------ the drift loop
  buildDrift() {
    const P: [number, number][] = [[0, -40], [0, 60], [-15, 105], [-60, 128], [-110, 115], [-132, 75], [-112, 40], [-78, 33], [-62, 5], [-82, -28], [-128, -32], [-155, -68], [-135, -108], [-82, -118], [-35, -98]]
    const n = P.length
    const cr = (a: number[], b: number[], c: number[], d: number[], t: number) => [0, 1].map(i => 0.5 * (2 * b[i] + (-a[i] + c[i]) * t + (2 * a[i] - 5 * b[i] + 4 * c[i] - d[i]) * t * t + (-a[i] + 3 * b[i] - 3 * c[i] + d[i]) * t * t * t))
    const fine: [number, number][] = []
    for (let i = 0; i < n; i++) for (let k = 0; k < 80; k++) {
      const q = cr(P[(i - 1 + n) % n], P[i], P[(i + 1) % n], P[(i + 2) % n], k / 80)
      fine.push([q[0], q[1]])
    }
    // resample every 2 m
    const path: [number, number][] = [fine[0]]
    let acc = 0
    for (let i = 1; i <= fine.length; i++) {
      const a = fine[i - 1], b = fine[i % fine.length]
      acc += Math.hypot(b[0] - a[0], b[1] - a[1])
      if (acc >= 2) { path.push(b); acc = 0 }
    }
    const T = this.track
    T.path = path
    T.half = 8
    T.length = path.length * 2
    const tangent = (i: number): [number, number] => {
      const a = path[(i - 1 + path.length) % path.length], b = path[(i + 1) % path.length]
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
    }
    // low red-and-white barriers along both edges, a block every 2 m
    for (let i = 0; i < path.length; i++) {
      const [tx, tz] = tangent(i)
      const nx = tz, nz = -tx
      for (const side of [1, -1]) {
        const off = (T.half + 0.45) * side
        this.blocks.push({ x: path[i][0] + nx * off, z: path[i][1] + nz * off, hx: 0.35, hz: 1.15, yaw: Math.atan2(tx, tz), h: 0.7, y0: 0, kind: 'kerb' })
      }
    }
    // a wall round everything, in case something gets out
    const xs = path.map(p => p[0]), zs = path.map(p => p[1])
    const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + 30, z0 = Math.min(...zs) - 30, z1 = Math.max(...zs) + 30
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
    for (const [x, z, hx, hz] of [[cx, z0, (x1 - x0) / 2, 1], [cx, z1, (x1 - x0) / 2, 1], [x0, cz, 1, (z1 - z0) / 2], [x1, cz, 1, (z1 - z0) / 2]]) this.blocks.push({ x, z, hx, hz, yaw: 0, h: 1.4, y0: 0, kind: 'wall' })
    // a few cones at the apexes to aim at
    for (const i of [Math.round(path.length * 0.17), Math.round(path.length * 0.47), Math.round(path.length * 0.7)]) {
      const [tx, tz] = tangent(i)
      for (const side of [1, -1]) this.prop('cone', path[i][0] + tz * side * (T.half - 1.2), path[i][1] - tx * side * (T.half - 1.2))
    }
    const [sx, sz] = tangent(0)
    this.start = { x: path[0][0], z: path[0][1], yaw: Math.atan2(sx, sz) }
  }

  // ------------------------------------------------------------------ the neighbourhood
  hood: Hood | null = null

  /** Lawns and sidewalks sit a kerb above the street; driveways ramp up through a kerb cut. */
  hoodHeight(x: number, z: number): number {
    const H = this.hood!
    const K = H.kerb
    let h = K
    for (const r of H.roads) {
      const d = Math.min(x - r[0], r[1] - x, z - r[2], r[3] - z)
      if (d <= -0.06) continue
      h = Math.min(h, d >= 0.06 ? 0 : K * (0.06 - d) / 0.12)
      if (h === 0) break
    }
    if (h > 0) for (const d of H.drives) {
      if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue
      const from = d.axis === 'x' ? Math.abs(x - d.edge) : Math.abs(z - d.edge)
      h = Math.min(h, K * Math.min(1, from / 1.2))
    }
    if (h === 0) for (const b of H.bumps) {
      if (x < b.x0 || x > b.x1) continue
      const t = (z - b.z) / b.len * 2
      if (Math.abs(t) < 1) h += b.h * 0.5 * (1 + Math.cos(Math.PI * t))
    }
    return h
  }

  buildHood() {
    const K = 0.15, RW = 4.6
    const xs = [-60, 0, 80], zs = [-100, 0, 100]
    const X0 = -100, X1 = 120, Z0 = -140, Z1 = 140
    const H: Hood = { kerb: K, roads: [], drives: [], bumps: [], houses: [], trees: [], parked: [], lamps: [], signs: [], xs, zs, bounds: [X0, X1, Z0, Z1], roadHalf: RW }
    this.hood = H
    this.track.half = 999
    for (const x of xs) H.roads.push([x - RW, x + RW, Z0, Z1])
    for (const z of zs) H.roads.push([X0, X1, z - RW, z + RW])
    // no speed bumps: a 1970s street didn't have them
    const block = (b: Partial<Block> & { x: number; z: number; hx: number; hz: number; h: number; kind: Block['kind'] }) => this.blocks.push({ yaw: 0, y0: K, ...b })
    const colors = ['#8a6d3b', '#6b7a3a', '#9a5b34', '#a89a6a', '#5f6e64', '#8c7b5a', '#7a4e3a', '#b0a27a']
    // houses along both sides of the north-south streets, facing them
    for (const sx of xs) for (const side of [-1, 1]) {
      let z = Z0 + 14
      while (z < Z1 - 14) {
        if (zs.some(zz => Math.abs(z - zz) < RW + 14)) { z += 6; continue }
        const lot = 22 + Math.floor(this.rand() * 4)
        const front = sx + side * (RW + 9)
        const depth = 9, width = 11 + this.rand() * 2
        const hx = front + side * depth / 2
        if (Math.abs(hx) > 0 && hx > X0 + 6 && hx < X1 - 6 && (xs.every(o => o === sx || Math.abs(hx - o) > RW + 14))) {
          const garageSide = this.rand() < 0.5 ? -1 : 1
          const color = colors[Math.floor(this.rand() * colors.length)]
          H.houses.push({ x: hx, z: z + lot / 2, w: depth, d: width, side, color, garage: garageSide })
          block({ x: hx, z: z + lot / 2, hx: depth / 2, hz: width / 2, h: 2.8, kind: 'house' })
          // attached garage and its driveway out to the street
          const gz = z + lot / 2 + garageSide * (width / 2 + 3.2)
          block({ x: front + side * 3.5, z: gz, hx: 3.5, hz: 3, h: 2.6, kind: 'house' })
          const roadEdge = sx + side * RW
          H.drives.push({ x0: Math.min(roadEdge, front) - 0.01, x1: Math.max(roadEdge, front) + 0.01, z0: gz - 2.2, z1: gz + 2.2, axis: 'x', edge: roadEdge })
          // a mailbox at the kerb, a trash can by the drive, a tree on the lawn
          this.prop('mailbox', roadEdge + side * 0.6, gz - garageSide * 3.2, K)
          if (this.rand() < 0.7) this.prop('bin', roadEdge + side * 0.8, gz + garageSide * 3.0, K)
          const tx = roadEdge + side * (3.5 + this.rand() * 3), tz = z + lot / 2 - garageSide * (2 + this.rand() * 4)
          H.trees.push([tx, tz, 2.2 + this.rand() * 1.5, 5 + this.rand() * 3])
          block({ x: tx, z: tz, hx: 0.22, hz: 0.22, h: 5, kind: 'tree' })
          // a car in some drives, some at the kerb
          if (this.rand() < 0.35) { const px = (roadEdge + front) / 2; H.parked.push({ x: px, z: gz, yaw: Math.PI / 2, color: colors[Math.floor(this.rand() * colors.length)] }); block({ x: px, z: gz, hx: 2.1, hz: 0.85, h: 1.35, y0: K, kind: 'parked' }) }
          else if (this.rand() < 0.3 && zs.every(c => Math.abs(gz + garageSide * 9 - c) > RW + 12)) { const px = sx + side * (RW - 0.95); const pz = gz + garageSide * 9; H.parked.push({ x: px, z: pz, yaw: 0, color: colors[Math.floor(this.rand() * colors.length)] }); block({ x: px, z: pz, hx: 0.85, hz: 2.1, h: 1.35, y0: 0, kind: 'parked' }) }
          // the back fence
          const back = front + side * (depth + 12)
          if (xs.every(o => Math.abs(back - o) > RW + 2) && back > X0 + 2 && back < X1 - 2) block({ x: back, z: z + lot / 2, hx: 0.06, hz: lot / 2 - 0.5, h: 1.2, kind: 'fence' })
        }
        z += lot
      }
    }
    // streetlights and stop signs at the corners
    for (const x of xs) for (const z of zs) for (const [dx, dz] of [[1, 1], [-1, -1]]) {
      const lx = x + dx * (RW + 1), lz = z + dz * (RW + 1)
      H.lamps.push([lx, lz]); block({ x: lx, z: lz, hx: 0.1, hz: 0.1, h: 6, kind: 'post' })
      const sx2 = x - dx * (RW + 0.8), sz2 = z + dz * (RW + 1.5)
      H.signs.push([sx2, sz2]); block({ x: sx2, z: sz2, hx: 0.05, hz: 0.05, h: 2.2, kind: 'post' })
    }
    // a hedge round the edge of it all
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2
    for (const [x, z, hx, hz] of [[cx, Z0 - 1, (X1 - X0) / 2 + 1, 1], [cx, Z1 + 1, (X1 - X0) / 2 + 1, 1], [X0 - 1, cz, 1, (Z1 - Z0) / 2 + 1], [X1 + 1, cz, 1, (Z1 - Z0) / 2 + 1]]) this.blocks.push({ x, z, hx, hz, yaw: 0, h: 1.8, y0: 0, kind: 'wall' })
    this.start = { x: -1.5, z: -125, yaw: 0 }
  }

  prop(kind: PropKind, x: number, z: number, y = 0) {
    const spec = { cone: [0.18, 0.7, 4], barrel: [0.3, 0.9, 60], crate: [0.45, 0.9, 35], tyre: [0.33, 0.25, 9], mailbox: [0.16, 1.15, 9], bin: [0.3, 1.0, 14] }[kind]
    const h = spec[1]
    this.props.push({ kind, x, y: y + h / 2, z, vx: 0, vy: 0, vz: 0, r: spec[0], h, m: spec[2], q: [0, 0, 0, 1], wx: 0, wy: 0, wz: 0, home: [x, y + h / 2, z], rest: true })
  }
  pyramid(cx: number, cz: number, base: number, y0 = 0) {
    for (let lvl = 0; lvl < base - 1; lvl++) for (let i = 0; i < base - lvl; i++) this.prop('crate', cx + (i - (base - 1 - lvl) / 2) * 0.92, cz, y0 + lvl * 0.9)
  }

  // ------------------------------------------------------------------ the courses
  buildCourse(id: string) {
    const T = this.track
    const F = (f: Feature) => T.features.push(f)
    const mark = (z: number, label: string) => T.marks.push({ z, label })
    const half = T.half
    /** A hidden wall under a tall face, so a car that comes up short hits it instead of popping on top. */
    const face = (z: number, top: number, bottom = 0, facing = 1) => {
      this.blocks.push({ x: 0, z: z - facing * 0.35, hx: half, hz: 0.35, yaw: 0, h: top - bottom - 0.12, y0: bottom, kind: 'face' })
    }
    this.start = { x: 0, z: 0, yaw: 0 }
    if (id === 'bumps') {
      T.length = 560
      mark(40, 'speed bumps'); [40, 47, 54].forEach(z => F({ k: 'bump', z, len: 0.5, h: 0.1 }))
      mark(90, 'humps'); F({ k: 'bump', z: 90, len: 1.4, h: 0.26 }); F({ k: 'bump', z: 100, len: 1.4, h: 0.26 })
      mark(140, 'rollers'); F({ k: 'rollers', z: 140, n: 8, wl: 5, h: 0.32 })
      mark(205, 'potholes')
      for (let i = 0; i < 14; i++) F({ k: 'hole', x: -5.5 + this.rand() * 11, z: 205 + i * 3.4 + this.rand() * 2, r: 0.45 + this.rand() * 0.6, d: 0.12 + this.rand() * 0.2 })
      mark(275, 'kicker'); F({ k: 'ramp', z: 275, up: 3.5, h: 0.65, top: 0, down: 0 })
      mark(330, 'tabletop'); F({ k: 'ramp', z: 330, up: 9, h: 1.3, top: 12, down: 9 })
      mark(400, 'curb'); F({ k: 'plateau', z0: 400, z1: 430, h: 0.16 })
      mark(470, 'launcher'); F({ k: 'bump', z: 470, len: 2.2, h: 0.55 })
      mark(520, 'finish')
      for (let i = 0; i < 9; i++) this.prop('tyre', -6 + i * 1.5, 540, 0)
      for (let i = 0; i < 9; i++) this.prop('tyre', -6 + i * 1.5, 540, 0.25)
    } else if (id === 'jumps') {
      T.length = 560
      mark(45, 'small ramp'); F({ k: 'ramp', z: 45, up: 6, h: 0.8, top: 0, down: 0 })
      // gap: launch ramp, 14 m of nothing, a landing ramp whose near face is a wall
      mark(110, 'gap jump')
      F({ k: 'ramp', z: 110, up: 11, h: 1.7, top: 0, down: 0 })
      F({ k: 'ramp', z: 135, up: 0.01, h: 1.3, top: 0, down: 15 })
      face(135, 1.3)
      mark(195, 'steps'); F({ k: 'plateau', z0: 195, z1: 245, h: 0.1 }); F({ k: 'plateau', z0: 203, z1: 245, h: 0.1 }); F({ k: 'plateau', z0: 211, z1: 245, h: 0.12 })
      mark(245, 'drop')
      mark(275, 'pit'); F({ k: 'ramp', z: 268, up: 5, h: 0.5, top: 0, down: 0 }); F({ k: 'pit', z0: 273, z1: 282, d: 2 })
      face(282, 0, -2)
      mark(330, 'ski jump'); F({ k: 'ramp', z: 330, up: 22, h: 3.2, top: 0, down: 0, kick: 0.6 })
      mark(420, 'stairs'); F({ k: 'plateau', z0: 405, z1: 432, h: 1.5 }); F({ k: 'ramp', z: 390, up: 15, h: 1.5, top: 0, down: 0 })
      F({ k: 'stairs', z: 432, n: 6, rise: 0.25, run: 1.3 })
      mark(520, 'finish')
    } else {
      T.length = 520
      mark(40, 'cone wall'); for (let r = 0; r < 2; r++) for (let i = 0; i < 26; i++) this.prop('cone', -6.5 + i * 0.52, 40 + r * 0.6)
      mark(85, 'barrel wall'); for (let r = 0; r < 2; r++) for (let i = 0; i < 22; i++) this.prop('barrel', -6.6 + i * 0.63 + r * 0.3, 85 + r * 0.6)
      mark(130, 'crate wall'); for (let lvl = 0; lvl < 3; lvl++) for (let i = 0; i < 15; i++) this.prop('crate', -6.45 + i * 0.92, 130, lvl * 0.9)
      mark(175, 'tyre wall'); for (let lvl = 0; lvl < 5; lvl++) for (let i = 0; i < 20; i++) this.prop('tyre', -6.4 + i * 0.68 + (lvl % 2) * 0.3, 175, lvl * 0.25)
      mark(225, 'bollards'); for (let i = 0; i < 7; i++) this.blocks.push({ x: -6 + i * 2, z: 225, hx: 0.2, hz: 0.2, yaw: 0, h: 1.0, y0: 0, kind: 'pillar' })
      mark(280, 'ramp into crates'); F({ k: 'ramp', z: 272, up: 7, h: 0.9, top: 0, down: 0 }); this.pyramid(-2, 292, 5); this.pyramid(2.8, 292, 5)
      mark(340, 'blocks'); F({ k: 'bump', z: 335, len: 1.2, h: 0.25 })
      ;[[-4, 350], [3, 362], [-1, 376], [5, 388]].forEach(([x, z]) => this.blocks.push({ x, z, hx: 1.6, hz: 0.8, yaw: 0, h: 1.2, y0: 0, kind: 'block' }))
      mark(400, 'ramp'); F({ k: 'ramp', z: 400, up: 8, h: 0.9, top: 0, down: 0 })
      // the last wall is low, bumper height: the car stops at it and whatever is loose goes on over
      this.blocks.push({ x: 0, z: 470, hx: half + 0.5, hz: 1, yaw: 0, h: 0.8, y0: 0, kind: 'wall' })
      mark(470, 'wall')
    }
    // the lane: side barriers, a wall behind the start and at the far end
    const L = T.length
    const B = (x: number, z: number, hx: number, hz: number, h: number, y0 = 0) => this.blocks.push({ x, z, hx, hz, yaw: 0, h, y0, kind: 'wall' })
    B(half + 0.6, L / 2 - 10, 0.4, L / 2 + 40, 3.5, -2.5); B(-half - 0.6, L / 2 - 10, 0.4, L / 2 + 40, 3.5, -2.5)
    B(0, -30, half + 1, 0.5, 1.2); B(0, L + 30, half + 1, 0.5, 1.6)
    // tall unseen walls, so a car flying high or crossing a raised section cannot leave the lane
    for (const sx of [1, -1]) this.blocks.push({ x: sx * (half + 1.3), z: L / 2 - 10, hx: 0.3, hz: L / 2 + 40, yaw: 0, h: 14, y0: -3, kind: 'face' })
    this.size = Math.max(L + 40, 200)
  }

  resetProps() {
    for (const p of this.props) {
      ;[p.x, p.y, p.z] = p.home
      p.vx = p.vy = p.vz = p.wx = p.wy = p.wz = 0
      p.q = [0, 0, 0, 1]
      p.rest = true
    }
  }

  /** Car against concrete and loose things; returns the impacts of this step. */
  collideCar(car: Car): Impact[] {
    const out: Impact[] = []
    const [bot, top] = car.verticalExtent()
    const HW = car.hw, HL = car.hl
    const cs = Math.sin(car.yaw), cc = Math.cos(car.yaw)
    const corners: [number, number][] = [[HW, HL], [-HW, HL], [-HW, -HL], [HW, -HL]].map(([lx, lz]) => [car.x + lx * cc + lz * cs, car.z - lx * cs + lz * cc])
    for (const b of this.blocks) {
      if (bot > b.y0 + b.h || top < b.y0) continue
      const dx = b.x - car.x, dz = b.z - car.z
      const reach = Math.hypot(b.hx, b.hz) + 2.6
      if (dx * dx + dz * dz > reach * reach) continue
      const hit = this.boxBox(car, corners, b)
      if (hit) {
        const n0 = out.length
        this.resolveFixed(car, hit.px, hit.pz, hit.nx, hit.nz, hit.depth, Math.max(bot, b.y0), Math.min(top, b.y0 + b.h), out)
        for (let k = n0; k < out.length; k++) out[k].block = b.kind
      }
    }
    for (const p of this.props) {
      if (p.y - p.h / 2 > top || p.y + p.h / 2 < bot) continue
      const [lx, lz] = car.toLocal(p.x, p.z)
      if (Math.abs(lx) > HW + p.r + 0.1 || Math.abs(lz) > HL + p.r + 0.1) continue
      const qx = Math.max(-HW, Math.min(HW, lx)), qz = Math.max(-HL, Math.min(HL, lz))
      let nx = lx - qx, nz = lz - qz
      const dist = Math.hypot(nx, nz)
      let depth: number
      if (dist < 1e-6) {
        const ex = HW - Math.abs(lx), ez = HL - Math.abs(lz)
        if (ex < ez) { nx = Math.sign(lx) || 1; nz = 0; depth = ex + p.r } else { nx = 0; nz = Math.sign(lz) || 1; depth = ez + p.r }
      } else {
        if (dist >= p.r) continue
        nx /= dist; nz /= dist
        depth = p.r - dist
      }
      const wnx = nx * cc + nz * cs, wnz = -nx * cs + nz * cc
      const [cpx, cpz] = car.toWorld(qx, qz)
      const [cvx, cvz] = car.pointVel(qx, qz)
      const rvx = p.vx - cvx, rvz = p.vz - cvz
      const vn = rvx * wnx + rvz * wnz
      const tot = car.m + p.m
      p.x += wnx * depth * car.m / tot; p.z += wnz * depth * car.m / tot
      car.x -= wnx * depth * p.m / tot; car.z -= wnz * depth * p.m / tot
      if (vn >= 0) continue
      const rx = cpx - car.x, rz = cpz - car.z
      const rn = rx * wnz - rz * wnx
      const j = -(1 + 0.35) * vn / (1 / p.m + 1 / car.m + rn * rn / car.Iz)
      p.vx += j * wnx / p.m; p.vz += j * wnz / p.m
      car.vx -= j * wnx / car.m; car.vz -= j * wnz / car.m
      car.r += j * (rx * wnz - rz * wnx) / car.Iz
      const sp = -vn
      p.vy += Math.min(9, sp * (p.kind === 'cone' ? 0.45 : p.kind === 'tyre' ? 0.35 : 0.22) + (this.rand() - 0.3) * 1.2)
      p.wx += (this.rand() - 0.5) * sp * 1.5; p.wz += (this.rand() - 0.5) * sp * 1.5; p.wy += (this.rand() - 0.5) * sp
      p.rest = false
      const ly = Math.max(0.3, Math.min(1.1, p.y - (car.y - car.rideHeight)))
      out.push({ lx: qx, ly, lz: qz, nx: -nx, ny: 0, nz: -nz, speed: sp, hard: p.m / tot, wx: cpx, wz: cpz, kind: p.kind, scrape: 0 })
    }
    return out
  }

  private boxBox(car: Car, corners: [number, number][], b: Block) {
    const bs = Math.sin(b.yaw), bc = Math.cos(b.yaw)
    const toB = (x: number, z: number) => { const dx = x - b.x, dz = z - b.z; return [dx * bc - dz * bs, dx * bs + dz * bc] }
    const bCorners: [number, number][] = [[b.hx, b.hz], [-b.hx, b.hz], [-b.hx, -b.hz], [b.hx, -b.hz]].map(([u, w]) => [b.x + u * bc + w * bs, b.z - u * bs + w * bc])
    const axes: [number, number][] = [[Math.cos(car.yaw), -Math.sin(car.yaw)], [Math.sin(car.yaw), Math.cos(car.yaw)], [bc, -bs], [bs, bc]]
    let best = Infinity, bnx = 0, bnz = 0
    for (const [ax, az] of axes) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
      for (const [x, z] of corners) { const d = x * ax + z * az; a0 = Math.min(a0, d); a1 = Math.max(a1, d) }
      for (const [x, z] of bCorners) { const d = x * ax + z * az; b0 = Math.min(b0, d); b1 = Math.max(b1, d) }
      const o = Math.min(a1, b1) - Math.max(a0, b0)
      if (o <= 0) return null
      if (o < best) {
        best = o
        const cd = (car.x - b.x) * ax + (car.z - b.z) * az
        bnx = cd >= 0 ? ax : -ax; bnz = cd >= 0 ? az : -az
      }
    }
    let px = 0, pz = 0, n = 0
    for (const [x, z] of corners) { const [u, w] = toB(x, z); if (Math.abs(u) <= b.hx + 0.02 && Math.abs(w) <= b.hz + 0.02) { px += x; pz += z; n++ } }
    if (!n) {
      for (const [x, z] of bCorners) { const [lx, lz] = car.toLocal(x, z); if (Math.abs(lx) <= car.hw + 0.02 && Math.abs(lz) <= car.hl + 0.02) { px += x; pz += z; n++ } }
    }
    if (!n) { px = (car.x + b.x) / 2; pz = (car.z + b.z) / 2; n = 1 }
    return { px: px / n, pz: pz / n, nx: bnx, nz: bnz, depth: best }
  }

  private resolveFixed(car: Car, px: number, pz: number, nx: number, nz: number, depth: number, y0: number, y1: number, out: Impact[]) {
    car.x += nx * depth
    car.z += nz * depth
    const [lx, lz] = car.toLocal(px, pz)
    const [vx, vz] = car.pointVel(lx, lz)
    const vn = vx * nx + vz * nz
    const rx = px - car.x, rz = pz - car.z
    const lnx = nx * Math.cos(car.yaw) - nz * Math.sin(car.yaw)
    const lnz = nx * Math.sin(car.yaw) + nz * Math.cos(car.yaw)
    const tx = -nz, tz = nx
    const vt = vx * tx + vz * tz
    const ly = Math.max(0.25, Math.min(1.2, (y0 + y1) / 2 - (car.y - car.rideHeight)))
    if (vn < 0) {
      const rn = rx * nz - rz * nx
      const e = 0.18
      const j = -(1 + e) * vn / (1 / car.m + rn * rn / car.Iz)
      const rt = rx * tz - rz * tx
      let jt = -vt / (1 / car.m + rt * rt / car.Iz)
      const cap = 0.45 * j
      jt = Math.max(-cap, Math.min(cap, jt))
      const ix = j * nx + jt * tx, iz = j * nz + jt * tz
      car.vx += ix / car.m; car.vz += iz / car.m
      car.r += (rz * ix - rx * iz) / car.Iz
      // a blow below the centre of mass tips the car over it
      car.tip(px, pz, ix, iz, ly)
      out.push({ lx, ly, lz, nx: lnx, ny: 0, nz: lnz, speed: -vn, hard: 1, wx: px, wz: pz, kind: 'fixed', scrape: Math.abs(vt) })
    } else if (Math.abs(vt) > 1) {
      out.push({ lx, ly, lz, nx: lnx, ny: 0, nz: lnz, speed: 0, hard: 1, wx: px, wz: pz, kind: 'fixed', scrape: Math.abs(vt) })
    }
  }

  /** Loose things: fall, bounce, slide, tumble, push each other and stop at walls. */
  stepProps(dt: number) {
    for (const p of this.props) {
      if (p.rest) continue
      p.vy -= 9.81 * dt
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
      const half = p.h / 2
      const g = this.height(p.x, p.z)
      // land on top of other loose things too
      let floor = g
      if (p.vy <= 0) for (const q of this.props) {
        if (q === p) continue
        const qt = q.y + q.h / 2
        if (qt <= floor || qt > p.y - half + 0.15 || Math.hypot(q.x - p.x, q.z - p.z) > (p.r + q.r) * 0.75) continue
        floor = qt
      }
      if (p.y < floor + half) {
        p.y = floor + half
        if (p.vy < -1) p.vy = -p.vy * 0.28; else p.vy = 0
        const f = Math.exp(-dt * (p.kind === 'barrel' || p.kind === 'tyre' ? 1.6 : 3.5))
        p.vx *= f; p.vz *= f
        p.wx *= f; p.wz *= f; p.wy *= f
      } else {
        const f = Math.exp(-dt * 0.1)
        p.vx *= f; p.vz *= f
      }
      const w = Math.hypot(p.wx, p.wy, p.wz)
      if (w > 1e-4) {
        const a = w * dt / 2, s = Math.sin(a) / w
        const [x1, y1, z1, w1] = [p.wx * s, p.wy * s, p.wz * s, Math.cos(a)], [x2, y2, z2, w2] = p.q
        p.q = [w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2]
        const l = Math.hypot(...p.q); p.q = p.q.map(c => c / l) as typeof p.q
      }
      for (const b of this.blocks) {
        if (p.y - half > b.y0 + b.h || p.y + half < b.y0) continue
        const bs = Math.sin(b.yaw), bc = Math.cos(b.yaw)
        const dx = p.x - b.x, dz = p.z - b.z
        const u = dx * bc - dz * bs, wv = dx * bs + dz * bc
        const cu = Math.max(-b.hx, Math.min(b.hx, u)), cw = Math.max(-b.hz, Math.min(b.hz, wv))
        let nu = u - cu, nw = wv - cw
        const d = Math.hypot(nu, nw)
        if (d >= p.r || d < 1e-6) continue
        nu /= d; nw /= d
        const nx = nu * bc + nw * bs, nz = -nu * bs + nw * bc
        p.x += nx * (p.r - d); p.z += nz * (p.r - d)
        const vn = p.vx * nx + p.vz * nz
        if (vn < 0) { p.vx -= 1.3 * vn * nx; p.vz -= 1.3 * vn * nz }
      }
      const sp2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz
      if (p.y <= floor + half + 0.001 && sp2 < 0.02 && Math.hypot(p.wx, p.wy, p.wz) < 0.3) {
        p.vx = p.vy = p.vz = 0; p.wx = p.wy = p.wz = 0
        p.rest = true
      }
    }
    const ps = this.props
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]
        if (a.rest && b.rest) continue
        const dx = b.x - a.x, dz = b.z - a.z
        const rr = a.r + b.r
        if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue
        if (Math.abs(a.y - b.y) > (a.h + b.h) / 2 - 0.05) continue
        const d = Math.hypot(dx, dz)
        if (d >= rr || d < 1e-6) continue
        const nx = dx / d, nz = dz / d
        const pen = rr - d, tot = a.m + b.m
        a.x -= nx * pen * b.m / tot; a.z -= nz * pen * b.m / tot
        b.x += nx * pen * a.m / tot; b.z += nz * pen * a.m / tot
        const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz
        if (vn < 0) {
          const jj = -1.3 * vn / (1 / a.m + 1 / b.m)
          a.vx -= jj * nx / a.m; a.vz -= jj * nz / a.m
          b.vx += jj * nx / b.m; b.vz += jj * nz / b.m
          a.rest = b.rest = false
        }
      }
    }
    for (const p of ps) {
      if (!p.rest) continue
      const g = this.height(p.x, p.z)
      if (p.y - p.h / 2 < g + 0.05) continue
      let held = false
      for (const q of ps) {
        if (q === p) continue
        if (Math.abs(q.y + q.h / 2 - (p.y - p.h / 2)) < 0.08 && Math.hypot(q.x - p.x, q.z - p.z) < p.r + q.r * 0.9) { held = true; break }
      }
      if (!held) p.rest = false
    }
  }
}
