// A person on foot, posed procedurally: walking along a path (legs swinging with a bit of knee,
// arms swinging the other way, a small bob), standing, and folding into the driver's seat. It writes
// the sixteen joints the crash dummy uses, so the same figure and head draw it.
import { J } from './dummy'
import type { Dummy } from './dummy'

type V3 = [number, number, number]
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]

export class Walker {
  x = 0
  z = 0
  y = 0
  /** heading: forward is (sin, cos) on the ground */
  yaw = 0
  phase = 0
  /** 0 standing still, 1 full stride */
  stride = 0
  pose: V3[] = Array.from({ length: 16 }, () => [0, 0, 0] as V3)

  /** Advance along a heading by a distance (metres), the legs keeping step. */
  walk(dist: number) {
    this.x += Math.sin(this.yaw) * dist
    this.z += Math.cos(this.yaw) * dist
    this.phase += dist / 1.45 * Math.PI * 2
  }

  /** The joints for the current place, heading, step and stride. */
  compute(): V3[] {
    const f: V3 = [Math.sin(this.yaw), 0, Math.cos(this.yaw)]
    const r: V3 = [-Math.cos(this.yaw), 0, Math.sin(this.yaw)]
    const up: V3 = [0, 1, 0]
    const s = this.stride, ph = this.phase
    const ground: V3 = [this.x, this.y, this.z]
    const pelvis = add(ground, up, 0.95 + 0.025 * s * Math.cos(2 * ph))
    const P = this.pose
    P[J.pelvis] = pelvis
    const chest = add(add(pelvis, up, 0.42), f, 0.03 * s)
    P[J.chest] = chest
    P[J.neck] = add(chest, up, 0.19)
    P[J.head] = add(add(P[J.neck], up, 0.12), f, 0.02)
    for (const side of [1, -1]) {
      const leg = side > 0 ? 0 : Math.PI
      const psi = ph + leg
      const hip = add(pelvis, r, 0.1 * side)
      const fwd = 0.3 * s * Math.sin(psi)
      const lift = 0.11 * s * Math.max(0, Math.cos(psi))
      const foot = add(add(add([hip[0], this.y, hip[2]], f, fwd), up, 0.07 + lift), r, 0.02 * side)
      // the knee: the leg is 0.9 m long, it bends forward when the foot is closer
      const d = Math.hypot(foot[0] - hip[0], foot[1] - hip[1], foot[2] - hip[2])
      const bend = Math.sqrt(Math.max(0, 0.45 * 0.45 - (d / 2) ** 2))
      const knee = add([(hip[0] + foot[0]) / 2, (hip[1] + foot[1]) / 2, (hip[2] + foot[2]) / 2], f, bend)
      const sh = add(add(chest, r, 0.19 * side), up, 0.12)
      const swing = -0.22 * s * Math.sin(psi)
      const hand = add(add(add(sh, up, -0.55), f, swing + 0.04), r, 0.04 * side)
      const elbow = add(add(add(sh, up, -0.29), f, swing * 0.4 - 0.03), r, 0.03 * side)
      if (side > 0) { P[J.lHip] = hip; P[J.lKnee] = knee; P[J.lFoot] = foot; P[J.lSho] = sh; P[J.lElb] = elbow; P[J.lHand] = hand }
      else { P[J.rHip] = hip; P[J.rKnee] = knee; P[J.rFoot] = foot; P[J.rSho] = sh; P[J.rElb] = elbow; P[J.rHand] = hand }
    }
    return P
  }

  /** Write a pose into the figure's joints; `seat` (seated joints, from the car) blended in by k. */
  apply(d: Dummy, seat: V3[] | null = null, k = 0) {
    const P = this.compute()
    const e = k * k * (3 - 2 * k)
    for (let i = 0; i < 16; i++) {
      let p = P[i]
      if (seat) {
        // into the car: across and down, the head ducking under the roof on the way
        const dip = Math.sin(Math.PI * e) * (i === J.head || i === J.neck || i === J.chest ? 0.22 : 0.08)
        p = [p[0] + (seat[i][0] - p[0]) * e, p[1] + (seat[i][1] - p[1]) * e - dip, p[2] + (seat[i][2] - p[2]) * e]
      }
      d.p.set(p, i * 3)
      d.o.set(p, i * 3)
    }
  }
}
