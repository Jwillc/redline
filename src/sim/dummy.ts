// The crash dummy: sixteen joints held together by bones, braces and limits (position-based verlet).
// It rides in the driver's seat until a crash is hard enough, then leaves through the glass with
// the speed the car had, and tumbles over the ground and against the concrete until it lies still.
import type { Car } from './car'
import type { World } from './world'

export const J = {
  head: 0, neck: 1, chest: 2, pelvis: 3, lSho: 4, rSho: 5, lElb: 6, rElb: 7, lHand: 8, rHand: 9,
  lHip: 10, rHip: 11, lKnee: 12, rKnee: 13, lFoot: 14, rFoot: 15,
} as const
type V3 = [number, number, number]

/** Seated in the driver's seat (left side), car frame: x left, y from the ground under a resting car, z forward. */
const SEAT: V3[] = [
  [0.36, 1.17, -0.47], [0.36, 1.05, -0.52], [0.36, 0.86, -0.5], [0.36, 0.44, -0.4],
  [0.55, 0.98, -0.52], [0.17, 0.98, -0.52], [0.56, 0.76, -0.27], [0.16, 0.76, -0.27],
  [0.5, 0.9, 0.02], [0.22, 0.9, 0.02],
  [0.46, 0.44, -0.36], [0.26, 0.44, -0.36], [0.46, 0.58, 0.08], [0.26, 0.58, 0.08], [0.46, 0.22, 0.48], [0.26, 0.22, 0.48],
]
const MASS = [4.5, 1.2, 20, 14, 3, 3, 2, 2, 0.8, 0.8, 6, 6, 4, 4, 1.5, 1.5]
const RADIUS = [0.12, 0.06, 0.15, 0.13, 0.07, 0.07, 0.05, 0.05, 0.05, 0.05, 0.08, 0.08, 0.06, 0.06, 0.06, 0.06]
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [1, 4], [1, 5], [4, 5], [4, 2], [5, 2], [4, 6], [6, 8], [5, 7], [7, 9],
  [3, 10], [3, 11], [10, 11], [10, 12], [12, 14], [11, 13], [13, 15],
]
/** braces that keep the trunk a trunk */
const BRACES: [number, number][] = [[2, 10], [2, 11], [4, 3], [5, 3], [4, 11], [5, 10], [4, 10], [5, 11]]
/** joint limits as distance ranges, fractions of the seated distance [min, max] */
const LIMITS: [number, number, number, number][] = [
  [0, 2, 0.8, 1.05], // the head cannot fold onto the chest
  [4, 8, 0.4, 1.6], [5, 9, 0.4, 1.6], // elbows
  [10, 14, 0.5, 1.6], [11, 15, 0.5, 1.6], // knees
  [12, 2, 0.6, 1.5], [13, 2, 0.6, 1.5], // hips cannot fold flat through the trunk
]

export interface DummyHit { x: number; y: number; z: number; speed: number; head: boolean }

export class Dummy {
  n = SEAT.length
  p = new Float64Array(this.n * 3)
  o = new Float64Array(this.n * 3)
  inv = MASS.map(m => 1 / m)
  rest: { a: number; b: number; len: number; min: number; max: number }[] = []
  free = false
  /** seconds since it left the car */
  flying = 0
  /** seconds it has lain still */
  still = 0
  settled = false
  hits: DummyHit[] = []
  nod: V3 = [0, 0, 0]
  nodV: V3 = [0, 0, 0]
  lastHit = new Float64Array(this.n)
  constructor() {
    const d = (a: number, b: number) => Math.hypot(SEAT[a][0] - SEAT[b][0], SEAT[a][1] - SEAT[b][1], SEAT[a][2] - SEAT[b][2])
    for (const [a, b] of BONES) this.rest.push({ a, b, len: d(a, b), min: 1, max: 1 })
    for (const [a, b] of BRACES) this.rest.push({ a, b, len: d(a, b), min: 0.9, max: 1.08 })
    for (const [a, b, lo, hi] of LIMITS) this.rest.push({ a, b, len: d(a, b), min: lo, max: hi })
  }
  get(i: number): V3 { return [this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]] }

  /** Strapped in (well, sitting): follow the car, the head nodding with its accelerations. */
  ride(car: Car, dt: number) {
    this.free = false
    this.settled = false
    this.flying = 0
    // the head swings against the car's acceleration and springs back
    const k = 90, c = 9
    const want: V3 = [-car.ay * 0.004, 0, -car.ax * 0.006]
    for (let a = 0; a < 3; a++) {
      this.nodV[a] += (k * (want[a] - this.nod[a]) - c * this.nodV[a]) * dt
      this.nod[a] += this.nodV[a] * dt
      this.nod[a] = Math.max(-0.09, Math.min(0.09, this.nod[a]))
    }
    for (let i = 0; i < this.n; i++) {
      const s = SEAT[i]
      const sway = i === J.head ? 1 : i === J.neck ? 0.4 : 0
      const w = this.carPoint(car, s[0] + this.nod[0] * sway, s[1], s[2] + this.nod[2] * sway)
      this.p.set(w, i * 3)
      this.o.set(w, i * 3)
    }
  }
  carPoint(car: Car, x: number, y: number, z: number): V3 {
    const q = car.q
    const ly = y - car.rideHeight
    const qx = q[0], qy = q[1], qz = q[2], qw = q[3]
    const tx = 2 * (qy * z - qz * ly), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * ly - qy * x)
    return [car.p[0] + x + qw * tx + (qy * tz - qz * ty), car.p[1] + ly + qw * ty + (qz * tx - qx * tz), car.p[2] + z + qw * tz + (qx * ty - qy * tx)]
  }

  /** Out it goes, with the velocity the car had before the blow, plus a little lift and a forward tumble. */
  eject(car: Car, vel: V3, dt: number, rand: () => number) {
    this.free = true
    this.dt = dt
    this.flying = 0
    this.still = 0
    this.settled = false
    const up = Math.min(4, 1.2 + Math.hypot(vel[0], vel[2]) * 0.12)
    const fwd: V3 = [Math.sin(car.yaw), 0, Math.cos(car.yaw)]
    for (let i = 0; i < this.n; i++) {
      // the upper body is thrown harder than the legs, which catch on the dash: it pitches forward
      const top = this.p[i * 3 + 1] - (car.p[1] - car.rideHeight) > 0.7 ? 1 : 0
      const v: V3 = [vel[0] + fwd[0] * top * 1.5 + (rand() - 0.5) * 0.6, vel[1] + up + top * 0.8, vel[2] + fwd[2] * top * 1.5 + (rand() - 0.5) * 0.6]
      this.o[i * 3] = this.p[i * 3] - v[0] * dt
      this.o[i * 3 + 1] = this.p[i * 3 + 1] - v[1] * dt
      this.o[i * 3 + 2] = this.p[i * 3 + 2] - v[2] * dt
    }
  }

  /** the step last used, so velocities read in m/s */
  dt = 1 / 1000
  step(dt: number, world: World) {
    if (!this.free) return
    this.dt = dt
    this.flying += dt
    const p = this.p, o = this.o
    let fastest = 0
    for (let i = 0; i < this.n; i++) {
      const k = i * 3
      const vx = p[k] - o[k], vy = p[k + 1] - o[k + 1], vz = p[k + 2] - o[k + 2]
      o[k] = p[k]; o[k + 1] = p[k + 1]; o[k + 2] = p[k + 2]
      const air = 0.9995
      p[k] += vx * air
      p[k + 1] += vy * air - 9.81 * dt * dt
      p[k + 2] += vz * air
      fastest = Math.max(fastest, Math.hypot(vx, vy, vz) / dt)
      this.lastHit[i] = Math.max(0, this.lastHit[i] - dt)
    }
    for (let it = 0; it < 10; it++) {
      for (const c of this.rest) {
        const a = c.a * 3, b = c.b * 3
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2]
        const d = Math.hypot(dx, dy, dz) || 1e-6
        const lo = c.len * c.min, hi = c.len * c.max
        if (d >= lo && d <= hi) continue
        const target = d < lo ? lo : hi
        const wa = this.inv[c.a], wb = this.inv[c.b]
        const s = (d - target) / d / (wa + wb)
        p[a] += dx * s * wa; p[a + 1] += dy * s * wa; p[a + 2] += dz * s * wa
        p[b] -= dx * s * wb; p[b + 1] -= dy * s * wb; p[b + 2] -= dz * s * wb
      }
      if (it % 3 === 2 || it === 9) this.collide(dt, world, it === 2)
    }
    if (fastest < 0.35) this.still += dt
    else this.still = 0
    if (this.still > 1.2) this.settled = true
  }

  private collide(dt: number, world: World, report: boolean) {
    const p = this.p, o = this.o
    for (let i = 0; i < this.n; i++) {
      const k = i * 3, r = RADIUS[i]
      // ground
      const g = world.height(p[k], p[k + 2])
      if (p[k + 1] < g + r) {
        const vy = (p[k + 1] - o[k + 1]) / dt
        p[k + 1] = g + r
        // bounce a little, and slide with friction
        o[k + 1] = p[k + 1] + Math.max(0, -vy) * 0.25 * dt
        const f = Math.exp(-dt * 7)
        o[k] = p[k] - (p[k] - o[k]) * f
        o[k + 2] = p[k + 2] - (p[k + 2] - o[k + 2]) * f
        if (report && -vy > 3.5 && this.lastHit[i] <= 0) { this.hits.push({ x: p[k], y: p[k + 1], z: p[k + 2], speed: -vy, head: i === J.head }); this.lastHit[i] = 0.2 }
      }
      // concrete
      for (const b of world.blocks) {
        const dx = p[k] - b.x, dz = p[k + 2] - b.z
        const reach = b.hx + b.hz + r + 0.5
        if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue
        if (p[k + 1] > b.y0 + b.h + r || p[k + 1] < b.y0 - r) continue
        const bs = Math.sin(b.yaw), bc = Math.cos(b.yaw)
        const u = dx * bc - dz * bs, w = dx * bs + dz * bc
        const eu = b.hx + r - Math.abs(u), ew = b.hz + r - Math.abs(w), et = b.y0 + b.h + r - p[k + 1]
        if (eu <= 0 || ew <= 0) continue
        let nx = 0, ny = 0, nz = 0, depth = 0
        if (et < eu && et < ew) { ny = 1; depth = et }
        else if (eu < ew) { const s = Math.sign(u) || 1; nx = s * bc; nz = -s * bs; depth = eu }
        else { const s = Math.sign(w) || 1; nx = s * bs; nz = s * bc; depth = ew }
        const vx = (p[k] - o[k]) / dt, vy = (p[k + 1] - o[k + 1]) / dt, vz = (p[k + 2] - o[k + 2]) / dt
        const vn = vx * nx + vy * ny + vz * nz
        p[k] += nx * depth; p[k + 1] += ny * depth; p[k + 2] += nz * depth
        if (vn < 0) {
          // stop the motion into the wall, keep some of the rest
          const tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz
          const nvx = tx * 0.7 - vn * nx * 0.2, nvy = ty * 0.7 - vn * ny * 0.2, nvz = tz * 0.7 - vn * nz * 0.2
          o[k] = p[k] - nvx * dt; o[k + 1] = p[k + 1] - nvy * dt; o[k + 2] = p[k + 2] - nvz * dt
          if (report && -vn > 3.5 && this.lastHit[i] <= 0) { this.hits.push({ x: p[k], y: p[k + 1], z: p[k + 2], speed: -vn, head: i === J.head }); this.lastHit[i] = 0.2 }
        }
      }
    }
  }

  /** where the middle of the body is, for the camera */
  centre(): V3 {
    const c = this.get(J.chest), q = this.get(J.pelvis)
    return [(c[0] + q[0]) / 2, (c[1] + q[1]) / 2, (c[2] + q[2]) / 2]
  }
  /** the chest's velocity, m/s */
  velocity(): V3 {
    const k = J.chest * 3
    return [(this.p[k] - this.o[k]) / this.dt, (this.p[k + 1] - this.o[k + 1]) / this.dt, (this.p[k + 2] - this.o[k + 2]) / this.dt]
  }
}

export const DUMMY_BONES = BONES
