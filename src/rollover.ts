// The trailer's rollover driver: plain inputs, nothing pushed on the car. Drive straight at a
// speed, then at a set point yank the wheel (with a stab of handbrake) and keep the foot down,
// so the car goes sideways into whatever is there and trips. tools/rollsearch.ts tries many of
// these and keeps one that rolls over and over; the film plays the same plan with the same physics.
import type { Car, Controls } from './sim/car'

export interface RollPlan {
  track: string
  engine: string
  x: number
  z: number
  yaw: number
  kmh: number
  gear: number
  /** where the wheel is yanked */
  zTurn: number
  /** which way: 1 left, -1 right */
  dir: number
  /** handbrake for this long after the yank (s) */
  hb: number
  /** wheel held over for this long (s), then let go */
  steerT: number
  thr: number
}

export class RollDriver {
  /** seconds since the yank (film time, which is game time divided by the slow-motion factor) */
  since = -1
  slowFor = 0
  slowSeen = false
  constructor(readonly plan: RollPlan) {}
  /** controls for this frame; dt is the frame's game time */
  controls(car: Car, dt: number): Controls {
    const P = this.plan
    const c: Controls = { throttle: P.thr, brake: 0, steer: 0, handbrake: false }
    if (this.since < 0) {
      // straight down the middle until the yank
      c.steer = Math.max(-1, Math.min(1, -car.x * 0.25 - car.yaw * 2.2))
      if (car.z >= P.zTurn) this.since = 0
      return c
    }
    this.since += dt
    if (this.since < P.steerT) c.steer = P.dir
    if (this.since < P.hb) c.handbrake = true
    if (car.upright < 0.6) c.throttle = 0
    return c
  }
  /** slow motion from the moment the car first goes well over, for a while */
  slow(car: Car, filmDt: number): number {
    if (!this.slowSeen && car.upright < 0.75) { this.slowSeen = true; this.slowFor = 2.6 }
    if (this.slowFor > 0) { this.slowFor -= filmDt; return 0.4 }
    return 1
  }
}

/** The plan rollsearch found (see tools/rollsearch.ts). */
// 6.1 barrel rolls in Chromium (6.2 in Bun): the wheel yanked right at the lip of the Jumps course's small ramp
export const ROLL: RollPlan = { track: 'jumps', engine: 'v8', x: 0, z: 20, yaw: 0, kmh: 128, gear: 3, zTurn: 43, dir: -1, hb: 0, steerT: 0.3, thr: 1 }
