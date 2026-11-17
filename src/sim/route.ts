// A driver that follows a route through the streets: corners rounded into curves, steering by pure
// pursuit (aim at a point a little way ahead), speed set by easing off and braking ahead of each
// corner so it arrives at the corner speed. Plain inputs through the controls, nothing pushed.
import type { Car, Controls } from './car'

interface Pt { x: number; z: number; corner: boolean; slow: number }

export class RouteDriver {
  pts: Pt[] = []
  i = 0
  /** cruising speed and the speed through corners, km/h; places where it slows right down (speed bumps) */
  cruise = 55
  corner = 22
  slowZones: { x: number; z: number; r: number; kmh: number }[] = []
  /** spin the wheels a little coming out of a corner (a quicker driver) */
  boot = 0

  /** waypoints at the corners of the route (closed if loop); corners rounded with a curve `round` metres each side */
  constructor(way: [number, number][], loop: boolean, round = 7) {
    const n = way.length
    const seg = (a: [number, number], b: [number, number], from: number, to: number) => {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1])
      for (let s = from; s < d - to; s += 1) this.pts.push({ x: a[0] + (b[0] - a[0]) * s / d, z: a[1] + (b[1] - a[1]) * s / d, corner: false, slow: 0 })
    }
    for (let k = 0; k < (loop ? n : n - 1); k++) {
      const a = way[k], b = way[(k + 1) % n]
      const hasPrev = loop || k > 0, hasNext = loop || k < n - 2
      seg(a, b, hasPrev ? round : 0, hasNext ? round : 0)
      if (hasNext) {
        // a quadratic curve through the corner at b
        const c = way[(k + 2) % n]
        const d1 = Math.hypot(b[0] - a[0], b[1] - a[1]), d2 = Math.hypot(c[0] - b[0], c[1] - b[1])
        const p0 = [b[0] - (b[0] - a[0]) / d1 * round, b[1] - (b[1] - a[1]) / d1 * round]
        const p2 = [b[0] + (c[0] - b[0]) / d2 * round, b[1] + (c[1] - b[1]) / d2 * round]
        for (let t = 0; t < 1; t += 1 / 12) {
          const u = 1 - t
          this.pts.push({ x: u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], z: u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1], corner: true, slow: 0 })
        }
      }
    }
  }

  private target(k: number) {
    const p = this.pts[k % this.pts.length]
    let v = p.corner ? this.corner : this.cruise
    for (const s of this.slowZones) if (Math.hypot(p.x - s.x, p.z - s.z) < s.r) v = Math.min(v, s.kmh)
    return v / 3.6
  }

  controls(car: Car): Controls {
    const N = this.pts.length
    // nearest point, searching forward from the last
    let best = Infinity, bi = this.i
    for (let k = this.i; k < this.i + 40; k++) {
      const p = this.pts[k % N]
      const d = (p.x - car.x) ** 2 + (p.z - car.z) ** 2
      if (d < best) { best = d; bi = k }
    }
    this.i = bi
    const v = Math.max(0, car.u)
    // steer: aim at a point ahead, the distance growing with speed
    const ld = Math.min(20, Math.max(6, 4 + v * 0.75))
    let ti = bi
    while (ti < bi + N && Math.hypot(this.pts[ti % N].x - car.x, this.pts[ti % N].z - car.z) < ld) ti++
    const tp = this.pts[ti % N]
    const [lx, lz] = car.toLocal(tp.x, tp.z)
    const L = car.wheels[0].lz - car.wheels[2].lz
    const delta = Math.atan2(2 * L * lx, lx * lx + lz * lz)
    const lock = car.lock / (1 + (car.u / car.lockHalf) ** 2)
    // damp the car's own rotation so a soft car on skinny tyres does not weave
    const steer = Math.max(-1, Math.min(1, (delta - 0.12 * car.r) / lock))
    // speed: the lowest speed asked for anywhere it could still brake to, a little ahead
    let want = Infinity
    for (let k = 0; k < 60; k++) {
      const vk = this.target(bi + k)
      want = Math.min(want, Math.sqrt(vk * vk + 2 * 3.2 * k))
    }
    const err = want - v
    const c: Controls = { throttle: 0, brake: 0, steer, handbrake: false }
    if (err > 0) c.throttle = Math.min(1, 0.12 + err * 0.22)
    else if (err < -0.8) c.brake = Math.min(1, -err * 0.18)
    // coming out of a corner, a quicker driver stamps on it
    if (this.boot > 0 && this.pts[bi % N].corner && err > 0) c.throttle = Math.min(1, c.throttle + this.boot)
    return c
  }
}
