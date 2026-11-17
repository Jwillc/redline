// The car: a rigid body in 3D on four sprung wheels. Each wheel follows the ground through a tyre
// envelope (so it climbs a curb instead of teleporting onto it), pushes along the contact normal,
// and grips with slip-based tyre forces. The driven rear axle, clutch, gearbox and engine management
// are as before; the engine's torque comes from the gas simulation.
// Frame: x to the car's left, y up, z forward. The body origin is the centre of mass.

export interface Controls {
  throttle: number
  brake: number
  steer: number
  handbrake: boolean
}
export interface EngineLink {
  torque: number
  inertia: number
  idle: number
  redline: number
  /** an engine with no limiter: where its valves float */
  float?: number
  dead: boolean
}
export interface Ground { height(x: number, z: number): number }
export interface CarEvent {
  kind: 'bottom' | 'body'
  wheel?: number
  /** contact in the car's frame, y measured from the ground under a resting car */
  lx: number; ly: number; lz: number
  /** inward normal in the car's frame */
  nx: number; ny: number; nz: number
  speed: number
  scrape: number
  wx: number; wy: number; wz: number
}
export interface Wheel {
  lx: number; lz: number; front: boolean
  contact: boolean
  comp: number
  len: number
  N: number
  spin: number
  bend: number
  lost: boolean
  pc: [number, number, number]
  bump: boolean
}

const G = 9.81
type V3 = [number, number, number]
function qrot(q: number[], x: number, y: number, z: number): V3 {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3]
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x)
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)]
}
function qinv(q: number[], x: number, y: number, z: number): V3 { return qrot([-q[0], -q[1], -q[2], q[3]], x, y, z) }
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// suspension, metres from the attachment down to the hub
const AY = -0.05, MAXLEN = 0.3, MINLEN = 0.06, TRAVEL = MAXLEN - MINLEN
const KB = 260000, CB = 9000
const ENVELOPE = 9
// points of the body that can touch the ground, relative to the centre of mass
/** The points of a body that can touch the ground, relative to the centre of mass. */
function hullFor(S: BodyShape, ride: number): V3[] {
  const H: V3[] = []
  const lo = S.bottom - ride + 0.02, mid = S.beltWs - ride, roof = S.roofH - ride
  for (const sx of [1, -1]) {
    for (const z of [S.front - 0.1, 0, -S.rear + 0.1]) H.push([sx * (S.hw - 0.05), lo, z])
    for (const z of [S.front, -S.rear]) H.push([sx * (S.hw - 0.15), lo + 0.44, z])
    for (const z of [S.front - 0.7, -S.rear + 0.7]) H.push([sx * S.hw, mid, z])
    for (const z of [S.roofFront, S.roofBack]) H.push([sx * S.roofHalf * 0.95, roof, z])
  }
  H.push([0, lo - 0.02, S.front / 2], [0, lo - 0.02, -S.rear / 2])
  return H
}

/** How a car is built and tuned. */
import { STREET_SHAPE, PINTO_SHAPE, type BodyShape } from './shape'

export interface CarSetup {
  id: string
  name: string
  blurb: string
  m: number
  Ib: [number, number, number]
  /** tyre grip, front and rear */
  muF: number
  muR: number
  ratios: number[]
  final: number
  /** steering lock (rad), and the speed (m/s) at which it has fallen to half */
  lock: number
  lockHalf: number
  steerRate: number
  /** spring and damper per wheel, anti-roll bars front and rear */
  ks: number
  cs: number
  arF: number
  arR: number
  tc: boolean
  /** traction control lets the driven wheels slip this much before it cuts in */
  tcSlip: number
  /** and cuts power as the car's slide passes this angle (degrees), so a slide comes back instead of spinning */
  tcAngle: number
  /** how hard the stability assist damps the car's rotation past that angle (1/s; 0 none) */
  stability: number
  /** counter-steer help: the front wheels lean toward where the car is going (0 none) */
  assist: number
  /** driven tyres share their grip along the direction they slide over the road (a spinning tyre loses its side grip) */
  slideDir?: boolean
  /** an open differential: the rear wheels turn at their own speeds and share the torque equally */
  openDiff?: boolean
  /** the body, the axles (front and rear z), half the track, the tyre's radius, brake strength (1 as the street car) */
  shape: BodyShape
  axleF: number
  axleR: number
  track: number
  Rw: number
  brakes: number
}

export const SETUPS: CarSetup[] = [
  {
    id: 'street', name: 'Street car', blurb: 'A softly sprung road car with traction control.',
    m: 1450, Ib: [2550, 2700, 620], muF: 1.08, muR: 1.08,
    ratios: [3.36, 2.18, 1.58, 1.22, 0.98, 0.8], final: 3.7,
    lock: 0.62, lockHalf: 19.5, steerRate: 9, ks: 27000, cs: 2300, arF: 17000, arR: 11000, tc: true, tcSlip: 0.17, tcAngle: 25, stability: 2, assist: 0,
    shape: STREET_SHAPE, axleF: 1.33, axleR: -1.27, track: 0.79, Rw: 0.33, brakes: 1,
  },
  {
    // Light, stiff, sticky at the front and looser at the back, with huge lock and short close gears,
    // so the rear steps out on the throttle and stays out; a locked axle drives both rear wheels alike.
    id: 'drift', name: 'Drift car', blurb: 'Stripped to 1,250 kg, stiff, about 55° of lock, grippy fronts and harder rears, short close gears, and a loose traction control that still lets it slide.',
    m: 1250, Ib: [2150, 2250, 520], muF: 1.15, muR: 0.95,
    ratios: [2.9, 2.05, 1.6, 1.3, 1.08, 0.92], final: 4.1,
    lock: 0.96, lockHalf: 45, steerRate: 13, ks: 36000, cs: 2900, arF: 24000, arR: 15000, tc: true, tcSlip: 0.55, tcAngle: 42, stability: 6, assist: 0.6,
    shape: STREET_SHAPE, axleF: 1.33, axleR: -1.27, track: 0.79, Rw: 0.33, brakes: 1.15,
  },
  {
    // A small 1970s American hatchback: about 1,100 kg, a 94 inch wheelbase, skinny 13 inch bias-ply
    // tyres, soft springs, unassisted drum-and-disc brakes, a four-speed with a 3.40 axle, no aids.
    id: 'pinto', name: 'Ford Pinto', blurb: 'A 1970s compact: 1,100 kg, a four-speed, 13 inch tyres, soft springs and modest brakes. No traction control.',
    m: 1180, Ib: [1800, 1950, 450], muF: 0.85, muR: 0.85,
    ratios: [3.65, 1.97, 1.37, 1.0], final: 3.4,
    lock: 0.6, lockHalf: 17, steerRate: 6.5, ks: 21000, cs: 1500, arF: 9000, arR: 0, tc: false, tcSlip: 0.3, tcAngle: 60, stability: 0, assist: 0, slideDir: true, openDiff: true,
    shape: PINTO_SHAPE, axleF: 1.17, axleR: -1.22, track: 0.705, Rw: 0.295, brakes: 0.7,
  },
]

export class Car {
  p: V3 = [0, 0.55, 0]
  vel: V3 = [0, 0, 0]
  q: number[] = [0, 0, 0, 1]
  w: V3 = [0, 0, 0]
  // car-frame speeds and accelerations, for the view and the HUD
  u = 0
  v = 0
  ax = 0
  ay = 0
  // drivetrain
  we = 0
  ww = 0
  spinR = 0
  spinF = 0
  gear = 1
  auto = true
  clutch = 1
  locked = false
  shiftT = 0
  shiftTo = 1
  throttleOut = 0
  fuelCut = false
  limiter = false
  idleI = 0.015
  idleRate = 0
  cranking = false
  lastRpm = 0
  reverseHold = 0
  steerAngle = 0
  sinceShift = 0
  tc = true
  /** the key: off, the engine gets no fuel or spark and the starter does not turn it */
  ignition = true
  tcSlip = 0.17
  tcAngle = 25
  stability = 0
  setup: CarSetup = SETUPS[0]
  muF = 1.08
  muR = 1.08
  lock = 0.62
  lockHalf = 19.5
  steerRate = 9
  ks = 27000
  cs = 2300
  arF = 17000
  arR = 11000
  assist = 0
  slideDir = false
  openDiff = false
  /** open diff: half the difference between the rear wheels' speeds (left = ww + wd, right = ww - wd) */
  wd = 0
  /** torque through the clutch last step (N m), for the driveshaft's twist on the axle */
  driveT = 0
  private misfireSeed = 1
  tcCut = 0
  // tyres and contacts for effects
  slipRear = 0
  slipFront = 0
  burnout = 0
  airborne = 0
  events: CarEvent[] = []
  hull: V3[] = hullFor(STREET_SHAPE, 0.55)
  hullHit = new Float32Array(this.hull.length)
  shape: BodyShape = STREET_SHAPE
  brakes = 1
  // setup
  m = 1450
  Ib: V3 = [2550, 2700, 620]
  Iz = 2700
  hw = 0.9
  hl = 2.2
  rideHeight = 0.55
  Rw = 0.33
  Iw = 1.8
  mu = 1.08
  ratios = [3.36, 2.18, 1.58, 1.22, 0.98, 0.8]
  reverse = 3.2
  final = 3.7
  eta = 0.92
  extraDrag = 0
  grip = 1
  wheels: Wheel[] = [
    { lx: 0.79, lz: 1.33, front: true }, { lx: -0.79, lz: 1.33, front: true },
    { lx: 0.79, lz: -1.27, front: false }, { lx: -0.79, lz: -1.27, front: false },
  ].map(w => ({ ...w, contact: false, comp: 0, len: MAXLEN, N: 0, spin: 0, bend: 0, lost: false, bump: false, pc: [0, 0, 0] as [number, number, number] }))

  constructor(idleRpm: number) { this.we = idleRpm * Math.PI / 30 }
  /** Build the car to a setup: mass, tyres, gears, steering, springs. */
  build(s: CarSetup) {
    this.setup = s
    this.m = s.m; this.Ib = [...s.Ib]; this.Iz = s.Ib[1]
    this.muF = s.muF; this.muR = s.muR
    this.ratios = [...s.ratios]; this.final = s.final
    this.lock = s.lock; this.lockHalf = s.lockHalf; this.steerRate = s.steerRate
    this.ks = s.ks; this.cs = s.cs; this.arF = s.arF; this.arR = s.arR
    this.shape = s.shape; this.Rw = s.Rw; this.rideHeight = s.Rw + 0.22; this.brakes = s.brakes
    this.hw = s.shape.hw; this.hl = Math.max(s.shape.front, s.shape.rear) + (s.shape.bumper ?? 0)
    this.hull = hullFor(s.shape, this.rideHeight); this.hullHit = new Float32Array(this.hull.length)
    this.wheels.forEach((w, i) => { w.lx = (i % 2 === 0 ? 1 : -1) * s.track; w.lz = i < 2 ? s.axleF : s.axleR })
    this.tc = s.tc; this.tcSlip = s.tcSlip; this.tcAngle = s.tcAngle; this.stability = s.stability; this.assist = s.assist; this.slideDir = !!s.slideDir; this.openDiff = !!s.openDiff
  }
  get rpm() { return this.we * 30 / Math.PI }
  get speed() { return Math.hypot(this.vel[0], this.vel[2]) }
  get x() { return this.p[0] } set x(v: number) { this.p[0] = v }
  get y() { return this.p[1] }
  get z() { return this.p[2] } set z(v: number) { this.p[2] = v }
  get vx() { return this.vel[0] } set vx(v: number) { this.vel[0] = v }
  get vz() { return this.vel[2] } set vz(v: number) { this.vel[2] = v }
  /** yaw rate about world up */
  get r() { return this.w[1] } set r(v: number) { this.w[1] = v }
  get yaw() { const f = qrot(this.q, 0, 0, 1); return Math.atan2(f[0], f[2]) }
  /** How upright the car is: 1 on its wheels, -1 on its roof. */
  get upright() { return qrot(this.q, 0, 1, 0)[1] }
  ratio(g = this.gear) {
    if (g === 0) return 0
    if (g < 0) return -this.reverse * this.final
    return this.ratios[g - 1] * this.final
  }
  shift(to: number) {
    to = Math.max(-1, Math.min(this.ratios.length, to))
    if (to === this.gear && this.shiftT <= 0) return
    if (this.shiftT > 0 && to === this.shiftTo) return
    this.sinceShift = 0
    this.shiftTo = to
    this.shiftT = 0.16
    this.locked = false
  }
  reset(x: number, z: number, yaw: number, idle: number, groundY = 0) {
    this.p = [x, groundY + this.rideHeight, z]
    this.q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]
    this.vel = [0, 0, 0]
    this.w = [0, 0, 0]
    this.u = this.v = 0
    this.ww = 0; this.wd = 0; this.driveT = 0; this.misfireSeed = 1
    this.we = idle * Math.PI / 30
    this.gear = 1; this.shiftT = 0; this.locked = false; this.clutch = 0; this.tcCut = 0; this.idleI = 0.015; this.idleRate = 0; this.lastRpm = idle
    this.ax = this.ay = 0; this.steerAngle = 0; this.limiter = false
    this.extraDrag = 0; this.grip = 1
    this.events = []
    this.hullHit.fill(0)
    this.airborne = 0
    this.reverseHold = 0; this.cranking = false; this.fuelCut = false; this.throttleOut = 0
    for (const w of this.wheels) { w.contact = false; w.comp = 0.13; w.len = MAXLEN - 0.13; w.N = 0; w.bend = 0; w.lost = false; w.bump = false }
  }

  step(dt: number, c: Controls, eng: EngineLink, ground: Ground) {
    const q = this.q, p = this.p, vel = this.vel, w = this.w
    const F = qrot(q, 0, 0, 1), U = qrot(q, 0, 1, 0), L = qrot(q, 1, 0, 0)
    let u = dot(vel, F)
    const rpm = this.we * 30 / Math.PI

    // --- driver: automatic reverse, auto box ---
    let thr = c.throttle, brk = c.brake
    if (this.auto) {
      if (this.gear >= 1 && c.brake > 0.1 && c.throttle < 0.05 && Math.abs(u) < 0.6) {
        this.reverseHold += dt
        if (this.reverseHold > 0.25) { this.shift(-1); this.reverseHold = 0 }
      } else if (this.gear === -1 && c.throttle > 0.1 && Math.abs(u) < 0.6) {
        this.shift(1)
      } else this.reverseHold = 0
      if (this.gear === -1) { thr = c.brake; brk = c.throttle }
      if (this.shiftT <= 0 && this.gear >= 1 && this.airborne < 0.1) {
        const roadRpm = Math.abs(u / this.Rw * this.ratio()) * 30 / Math.PI
        const up = this.gear < this.ratios.length && this.sinceShift > 0.5 && (thr > 0.3
          ? rpm > eng.redline * 0.9 && roadRpm > eng.redline * 0.8
          : roadRpm > eng.redline * 0.6)
        const lower = this.gear - 1
        const down = this.gear > 1 && this.sinceShift > 1.2 && roadRpm < Math.max(eng.idle * 1.8, eng.redline * (thr > 0.6 ? 0.42 : 0.28)) &&
          roadRpm * this.ratio(lower) / this.ratio() < eng.redline * 0.8
        if (up) this.shift(this.gear + 1)
        else if (down) this.shift(lower)
      }
    }
    this.sinceShift += dt
    if (this.shiftT > 0) {
      this.shiftT -= dt
      if (this.shiftT <= 0.08 && this.gear !== this.shiftTo) this.gear = this.shiftTo
      if (this.auto) thr = 0
    }

    // --- engine management: idle, limiter, overrun cut, traction control ---
    const idleErr = (eng.idle - rpm) / eng.idle
    const rate = (rpm - this.lastRpm) / eng.idle / Math.max(dt, 1e-4)
    this.lastRpm = rpm
    this.idleRate += (rate - this.idleRate) * Math.min(1, dt * 20)
    if (thr < 0.05) this.idleI = Math.max(0, Math.min(0.08, this.idleI + idleErr * dt * 0.05))
    const idleThr = Math.max(0, Math.min(0.12, this.idleI + 0.04 * idleErr - 0.004 * this.idleRate))
    let throttle = Math.max(thr, idleThr)
    let misfire = false
    if (eng.float) {
      // no limiter (a 1970s engine had none): past the float speed the valves stop following the cam
      // and it stumbles, misfiring more the further it is pushed
      this.limiter = false
      const over = (rpm - eng.float) / 400
      if (over > 0) {
        this.misfireSeed = (Math.imul(this.misfireSeed, 1103515245) + 12345) >>> 0
        misfire = this.misfireSeed / 4294967296 < Math.min(0.85, over)
      }
    } else if (rpm > eng.redline) this.limiter = true
    else if (rpm < eng.redline - 180) this.limiter = false
    const overrun = thr < 0.02 && rpm > eng.idle + 900
    this.fuelCut = eng.dead || this.limiter || misfire || overrun || !this.ignition
    if (eng.dead || !this.ignition) throttle = 0

    // --- wheels: suspension and contact ---
    // steering: lock shrinks with speed; counter-steer help turns the wheels toward the car's path
    const lock = this.lock / (1 + (u / this.lockHalf) ** 2)
    const slideAngle = u > 3 ? Math.atan2(dot(vel, L), u) : 0
    const steerWant = Math.max(-this.lock, Math.min(this.lock, c.steer * lock + this.assist * slideAngle))
    this.steerAngle += (steerWant - this.steerAngle) * Math.min(1, dt * this.steerRate)
    const fwd0: V3[] = [], n: V3[] = [], fw: V3[] = [], sw: V3[] = [], pc: V3[] = [], vlong: number[] = [], vlat: number[] = [], Ns: number[] = []
    const comps: number[] = []
    const upOK = U[1] > 0.25
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i]
      const delta = (wh.front ? this.steerAngle : 0) + wh.bend
      const cd = Math.cos(delta), sd = Math.sin(delta)
      fwd0[i] = [F[0] * cd + L[0] * sd, F[1] * cd + L[1] * sd, F[2] * cd + L[2] * sd]
      const a = qrot(q, wh.lx, AY, wh.lz)
      const H: V3 = [p[0] + a[0] - U[0] * MAXLEN, p[1] + a[1] - U[1] * MAXLEN, p[2] + a[2] - U[2] * MAXLEN]
      let comp = 0, best = -Infinity, bs = 0, bg = 0
      if (!wh.lost && upOK) {
        let fhx = fwd0[i][0], fhz = fwd0[i][2]
        const fl = Math.hypot(fhx, fhz) || 1
        fhx /= fl; fhz /= fl
        for (let k = 0; k < ENVELOPE; k++) {
          const s = (k / (ENVELOPE - 1) * 2 - 1) * this.Rw * 0.98
          const g = ground.height(H[0] + fhx * s, H[2] + fhz * s)
          const yc = g + Math.sqrt(this.Rw * this.Rw - s * s)
          if (yc > best) { best = yc; bs = s; bg = g }
        }
        comp = (best - H[1]) / U[1]
        // too tall to climb: that is a wall, handled by the hidden faces
        if (comp > TRAVEL + 0.35) comp = 0
        if (comp > 0) {
          pc[i] = [H[0] + fhx * bs, bg, H[2] + fhz * bs]
          const nn: V3 = [H[0] - pc[i][0], best - bg, H[2] - pc[i][2]]
          const nl = Math.hypot(...nn) || 1
          n[i] = [nn[0] / nl, nn[1] / nl, nn[2] / nl]
        }
      }
      comps[i] = comp
      wh.contact = comp > 0
    }
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i]
      const comp = comps[i]
      if (!wh.contact) { Ns[i] = 0; wh.comp = 0; wh.bump = false; wh.len = Math.min(MAXLEN, wh.len + dt * 2); wh.N = 0; continue }
      const prev = wh.comp > 0 ? wh.comp : comp
      const crate = (comp - prev) / dt
      const cs = Math.min(comp, TRAVEL)
      let N = this.ks * cs + this.cs * crate
      const over = comp - TRAVEL
      if (over <= 0) wh.bump = false
      if (over > 0) {
        N += KB * over + CB * Math.max(0, crate)
        if (!wh.bump) {
          // how hard the wheel meets the ground: its closing speed along the contact normal
          const r: V3 = [pc[i][0] - p[0], pc[i][1] - p[1], pc[i][2] - p[2]]
          const vcp = cross(w, r)
          const closing = -((vel[0] + vcp[0]) * n[i][0] + (vel[1] + vcp[1]) * n[i][1] + (vel[2] + vcp[2]) * n[i][2])
          wh.bump = true
          if (closing > 2) {
            const ev = this.local(pc[i][0], pc[i][1], pc[i][2])
            this.events.push({ kind: 'bottom', wheel: i, lx: ev[0], ly: ev[1], lz: ev[2], nx: 0, ny: 1, nz: 0, speed: closing, scrape: 0, wx: pc[i][0], wy: pc[i][1], wz: pc[i][2] })
          }
        }
      }
      Ns[i] = Math.max(0, Math.min(150000, N))
      wh.comp = comp
      wh.len = MAXLEN - cs
    }
    // anti-roll bars
    for (const [l, r, k] of [[0, 1, this.arF], [2, 3, this.arR]]) {
      if (this.wheels[l].contact && this.wheels[r].contact) {
        const d = (Math.min(comps[l], TRAVEL) - Math.min(comps[r], TRAVEL)) * k
        Ns[l] = Math.max(0, Ns[l] + d); Ns[r] = Math.max(0, Ns[r] - d)
      }
    }
    // the driveshaft twists the axle housing as it drives the pinion: weight comes off the right rear
    // and onto the left, which is why an open-diff car spins its right rear ("one-wheel peel")
    if (this.openDiff && this.gear > 0 && this.wheels[2].contact && this.wheels[3].contact) {
      const avg = (Ns[2] + Ns[3]) / 2
      const dN = Math.max(-0.6 * avg, Math.min(0.6 * avg, this.driveT * this.ratios[this.gear - 1] / (2 * Math.abs(this.wheels[2].lx))))
      Ns[3] -= dN; Ns[2] += dN
    }
    // tyre frames and slip velocities
    let contacts = 0
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i]
      wh.N = Ns[i]
      if (!wh.contact) continue
      contacts++
      const nn = n[i]
      const f0 = fwd0[i]
      const fd = dot(f0, nn)
      let f: V3 = [f0[0] - nn[0] * fd, f0[1] - nn[1] * fd, f0[2] - nn[2] * fd]
      const fl = Math.hypot(...f) || 1
      f = [f[0] / fl, f[1] / fl, f[2] / fl]
      fw[i] = f
      sw[i] = cross(nn, f)
      const r: V3 = [pc[i][0] - p[0], pc[i][1] - p[1], pc[i][2] - p[2]]
      const vc = cross(w, r)
      vc[0] += vel[0]; vc[1] += vel[1]; vc[2] += vel[2]
      vlong[i] = dot(vc, f)
      vlat[i] = dot(vc, sw[i])
      wh.pc = pc[i]
    }
    this.airborne = contacts === 0 ? this.airborne + dt : 0

    // traction control, on the driven wheels that are on the ground
    let rearSlip = 0, rn = 0
    for (const i of [2, 3]) if (this.wheels[i].contact) { rearSlip += (this.ww * this.Rw - vlong[i]) / Math.max(Math.abs(vlong[i]), 2.5); rn++ }
    rearSlip = rn ? rearSlip / rn : 0
    const slideDeg = u > 3 ? Math.abs(Math.atan2(dot(vel, L), u)) * 57.3 : 0
    const tcWant = this.tc && this.gear !== 0 && !c.handbrake && rn
      ? Math.max(Math.min(1, Math.max(0, (Math.abs(rearSlip) - this.tcSlip) * 5)), Math.min(1, Math.max(0, (slideDeg - this.tcAngle) / 10)))
      : 0
    this.tcCut += (tcWant - this.tcCut) * Math.min(1, dt * (tcWant > this.tcCut ? 40 : 6))
    throttle *= 1 - this.tcCut * 0.8
    this.throttleOut = throttle
    let Te = eng.torque > 0 ? eng.torque * (1 - this.tcCut) : eng.torque
    if (!eng.dead && this.ignition && rpm < eng.idle * 0.35 && this.clutch < 0.3) this.cranking = true
    if (rpm > eng.idle * 0.7 || eng.dead) this.cranking = false
    if (this.cranking) Te = Math.max(Te, 0) + 90
    if (!eng.dead && this.ignition && thr < 0.05 && rpm < eng.idle + 900 && !this.fuelCut) {
      Te += Math.max(-45, Math.min(30, -0.7 * (this.we - eng.idle * Math.PI / 30)))
    }

    // --- clutch engagement (automatic) ---
    let clutchTarget = 0
    if (this.gear !== 0 && this.shiftT <= 0 && !c.handbrake && !eng.dead && rpm > eng.idle * 0.85) {
      clutchTarget = Math.max(0, Math.min(1, (rpm - (eng.idle + 250)) / (600 + 1600 * thr)))
      const wheelRpm = Math.abs(this.ww * this.ratio()) * 30 / Math.PI
      if (wheelRpm > eng.idle + 250) clutchTarget = 1
      else if (thr < 0.02) clutchTarget = 0
    }
    this.clutch += (clutchTarget - this.clutch) * Math.min(1, dt * (clutchTarget > this.clutch ? 9 : 25))
    const cap = this.clutch * 900

    // --- tyre forces ---
    const mu = this.grip
    const fy: number[] = [0, 0, 0, 0], fx: number[] = [0, 0, 0, 0]
    for (let i = 0; i < 4; i++) {
      if (!this.wheels[i].contact) continue
      const D = mu * (this.wheels[i].front ? this.muF : this.muR) * Ns[i]
      const al = Math.atan(vlat[i] / Math.max(Math.abs(vlong[i]), 1.5))
      fy[i] = -D * Math.sin(1.35 * Math.atan(9 * al))
      if (this.wheels[i].front) {
        let lon = -Math.min(brk * 5500 * this.brakes, D * 0.95) * Math.tanh(vlong[i] / 0.4) - 0.012 * Ns[i] * Math.tanh(vlong[i] / 0.4)
        const use = Math.hypot(lon, fy[i]) / Math.max(D, 1)
        if (use > 1) { lon /= use; fy[i] /= use }
        fx[i] = lon
      }
    }
    // driven rear axle in finer steps (the wheel against its tyre is stiff)
    const Gr = this.ratio()
    if (this.locked && rpm < eng.idle * 0.9 && !eng.dead) { this.locked = false; this.clutch = Math.min(this.clutch, 0.5) }
    const lockedMode = Gr !== 0 && this.locked && this.clutch > 0.98
    const nSub = lockedMode && !this.openDiff ? 2 : 10
    const hs = dt / nSub
    const fxSum = [0, 0], fySum = [0, 0]
    let slipMax = 0, tcSum = 0
    for (let k = 0; k < nSub; k++) {
      let tyreT = 0, abs = false
      const tw = [0, 0]
      for (let j = 0; j < 2; j++) {
        const i = 2 + j
        if (!this.wheels[i].contact) continue
        const D = mu * this.muR * Ns[i]
        const wj = this.ww + (j === 0 ? this.wd : -this.wd)
        const slip = (wj * this.Rw - vlong[i]) / Math.max(Math.abs(vlong[i]), 2.5)
        slipMax = Math.max(slipMax, Math.abs(slip))
        if (slip < -0.12 && Math.abs(vlong[i]) > 2) abs = true
        let lon = D * Math.sin(1.4 * Math.atan(11 * slip))
        let lat = fy[i]
        if (this.slideDir) {
          // the force points against the contact patch's slide over the road: spinning at a few m/s
          // against a little sideways drift, nearly all of it pushes forward and the tail lets go
          const sx = slip, sy = vlat[i] / Math.max(Math.abs(vlong[i]), 2.5)
          const sg = Math.hypot(sx, sy)
          if (sg > 0.08) {
            const F = Math.max(Math.hypot(lon, lat), D * Math.sin(1.4 * Math.atan(11 * sg)))
            const k = Math.min(1, (sg - 0.08) / 0.12)
            lon += (F * sx / sg - lon) * k
            lat += (-F * sy / sg - lat) * k
          }
        }
        const use = Math.hypot(lon, lat) / Math.max(D, 1)
        if (use > 1) { lon /= use; lat /= use }
        if (!this.slideDir && Math.abs(lon) > 0.9 * D) lat *= 0.55
        tyreT += lon * this.Rw
        tw[j] = lon * this.Rw
        fxSum[j] += lon; fySum[j] += lat
      }
      const brakeT = brk * 1500 * this.brakes * (abs ? 0.25 : 1) + (c.handbrake ? 5000 : 0)
      if (lockedMode) {
        const J = this.Iw + eng.inertia * Gr * Gr
        let net = Te * Gr * this.eta - tyreT
        const bt = Math.min(brakeT, Math.abs(net) + Math.abs(this.ww) * J / hs)
        net -= Math.sign(this.ww || net) * bt
        const dww = net / J * hs
        const need = Te - eng.inertia * (dww * Gr) / hs
        tcSum += need
        if (Math.abs(need) > cap * 1.05) this.locked = false
        this.ww += dww
        this.we = this.ww * Gr
      } else {
        const dw = this.we - this.ww * Gr
        const kc = 0.45 * eng.inertia / hs
        const Tc = Gr === 0 ? 0 : Math.max(-cap, Math.min(cap, kc * dw))
        tcSum += Tc
        this.we += (Te - Tc) / eng.inertia * hs
        let wheelT = Tc * Gr * this.eta - tyreT - this.ww * 0.4
        const bt = Math.min(brakeT, Math.abs(wheelT) + Math.abs(this.ww) * this.Iw / hs)
        wheelT -= Math.sign(this.ww || wheelT) * bt
        this.ww += wheelT / this.Iw * hs
      }
      if (this.openDiff) {
        // the wheels against each other through the diff's gears: the one with less grip spins up
        // (brakes act on each wheel alike, so they cancel here unless the wheels turn opposite ways)
        this.wd += -(tw[0] - tw[1]) / this.Iw * hs
        if (Math.sign(this.ww + this.wd) !== Math.sign(this.ww - this.wd)) this.wd -= Math.sign(this.wd) * Math.min(Math.abs(this.wd), brakeT * hs / this.Iw)
      }
    }
    this.driveT = tcSum / nSub
    fx[2] = fxSum[0] / nSub; fx[3] = fxSum[1] / nSub
    fy[2] = fySum[0] / nSub; fy[3] = fySum[1] / nSub
    if (!lockedMode && Gr !== 0 && this.clutch > 0.98 && Math.abs(this.we - this.ww * Gr) < 3) this.locked = true
    if (this.we < 0) this.we = 0
    if (eng.dead && this.we < 15) this.we = Math.max(0, this.we - 40 * dt)

    // --- sum the forces ---
    const Fs: V3 = [0, -this.m * G, 0], T: V3 = [0, 0, 0]
    const apply = (at: V3, f: V3) => {
      Fs[0] += f[0]; Fs[1] += f[1]; Fs[2] += f[2]
      const r: V3 = [at[0] - p[0], at[1] - p[1], at[2] - p[2]]
      const t = cross(r, f)
      T[0] += t[0]; T[1] += t[1]; T[2] += t[2]
    }
    for (let i = 0; i < 4; i++) {
      if (!this.wheels[i].contact) continue
      const nn = n[i], f = fw[i], s = sw[i]
      apply(pc[i], [nn[0] * Ns[i] + f[0] * fx[i] + s[0] * fy[i], nn[1] * Ns[i] + f[1] * fx[i] + s[1] * fy[i], nn[2] * Ns[i] + f[2] * fx[i] + s[2] * fy[i]])
    }
    // the body against the ground: roof, nose, floor
    for (let k = 0; k < this.hull.length; k++) {
      const h = this.hull[k]
      const a = qrot(q, h[0], h[1], h[2])
      const P: V3 = [p[0] + a[0], p[1] + a[1], p[2] + a[2]]
      const g = ground.height(P[0], P[2])
      const pen = g - P[1]
      this.hullHit[k] = Math.max(0, this.hullHit[k] - dt)
      if (pen <= 0 || pen > 0.4) continue
      const vp = cross(w, a)
      vp[0] += vel[0]; vp[1] += vel[1]; vp[2] += vel[2]
      const Fn = 160000 * pen - 9000 * vp[1]
      if (Fn <= 0) continue
      const vt = Math.hypot(vp[0], vp[2])
      const kf = 0.5 * Fn / Math.max(vt, 0.3)
      apply(P, [-vp[0] * kf, Fn, -vp[2] * kf])
      if (this.hullHit[k] <= 0 && (-vp[1] > 2.5 || vt > 3)) {
        this.hullHit[k] = 0.15
        const ln = qinv(q, 0, 1, 0)
        this.events.push({ kind: 'body', lx: h[0], ly: h[1] + this.rideHeight, lz: h[2], nx: ln[0], ny: ln[1], nz: ln[2], speed: Math.max(0, -vp[1]), scrape: vt, wx: P[0], wy: P[1], wz: P[2] })
      }
    }
    // stability assist (part of traction control): past the slide limit, damp the rotation so the
    // car swings back instead of swapping ends; with traction control off the car is left alone
    if (this.tc && this.stability > 0 && contacts) {
      const ex = Math.min(1, Math.max(0, (slideDeg - this.tcAngle) / 25))
      T[1] -= this.Ib[1] * w[1] * this.stability * ex
    }
    // air
    const sp = Math.hypot(...vel)
    const drag = 0.45 + this.extraDrag
    Fs[0] -= drag * sp * vel[0]; Fs[1] -= drag * sp * vel[1]; Fs[2] -= drag * sp * vel[2]

    // --- integrate ---
    const ax = Fs[0] / this.m, ay = Fs[1] / this.m, az = Fs[2] / this.m
    vel[0] += ax * dt; vel[1] += ay * dt; vel[2] += az * dt
    const wb = qinv(q, w[0], w[1], w[2])
    const tb = qinv(q, T[0], T[1], T[2])
    const I = this.Ib
    const Iw: V3 = [I[0] * wb[0], I[1] * wb[1], I[2] * wb[2]]
    const gyro = cross(wb, Iw)
    wb[0] += (tb[0] - gyro[0]) / I[0] * dt
    wb[1] += (tb[1] - gyro[1]) / I[1] * dt
    wb[2] += (tb[2] - gyro[2]) / I[2] * dt
    const damp = Math.exp(-dt * 0.08)
    const nw = qrot(q, wb[0] * damp, wb[1] * damp, wb[2] * damp)
    w[0] = nw[0]; w[1] = nw[1]; w[2] = nw[2]
    p[0] += vel[0] * dt; p[1] += vel[1] * dt; p[2] += vel[2] * dt
    const [qx, qy, qz, qw] = q
    const hx = 0.5 * dt * w[0], hy = 0.5 * dt * w[1], hz = 0.5 * dt * w[2]
    q[0] += hx * qw + hy * qz - hz * qy
    q[1] += hy * qw + hz * qx - hx * qz
    q[2] += hz * qw + hx * qy - hy * qx
    q[3] += -hx * qx - hy * qy - hz * qz
    const ql = Math.hypot(q[0], q[1], q[2], q[3])
    q[0] /= ql; q[1] /= ql; q[2] /= ql; q[3] /= ql

    // --- for the view and the HUD ---
    u = dot(vel, F)
    this.u = u
    this.v = dot(vel, L)
    this.ax += (dot([ax, ay, az], F) - this.ax) * Math.min(1, dt * 12)
    this.ay += (dot([ax, ay, az], L) - this.ay) * Math.min(1, dt * 12)
    this.spinR += this.ww * dt
    const fr = this.wheels[0].contact ? vlong[0] / this.Rw : this.wheels[1].contact ? vlong[1] / this.Rw : null
    this.spinF += (fr ?? 0) * dt
    let latR = 0, latF = 0
    for (let i = 0; i < 4; i++) if (this.wheels[i].contact) {
      const al = Math.abs(Math.atan(vlat[i] / Math.max(Math.abs(vlong[i]), 1.5)))
      if (Math.abs(vlong[i]) > 3) { if (this.wheels[i].front) latF = Math.max(latF, al); else latR = Math.max(latR, al) }
    }
    this.slipRear = Math.max(slipMax > 0.15 ? Math.min(1, (slipMax - 0.15) * 2) : 0, latR > 0.12 ? Math.min(1, (latR - 0.12) * 4) : 0)
    this.slipFront = latF > 0.14 ? Math.min(1, (latF - 0.14) * 4) : 0
    const wFast = this.ww + Math.sign(this.ww || 1) * Math.abs(this.wd)
    this.burnout = slipMax > 0.3 && rn ? Math.min(1, Math.abs(wFast * this.Rw - u) / 12) : 0
  }

  /** A world point in the car's frame, y measured from the ground under a resting car. */
  local(x: number, y: number, z: number): V3 {
    const l = qinv(this.q, x - this.p[0], y - this.p[1], z - this.p[2])
    return [l[0], l[1] + this.rideHeight, l[2]]
  }
  /** Lowest and highest points of the body. */
  verticalExtent(): [number, number] {
    let lo = Infinity, hi = -Infinity
    const S = this.shape
    for (const sx of [S.hw, -S.hw]) for (const sy of [S.bottom - this.rideHeight, S.roofH - this.rideHeight]) for (const sz of [S.front, -S.rear]) {
      const y = this.p[1] + qrot(this.q, sx, sy, sz)[1]
      lo = Math.min(lo, y); hi = Math.max(hi, y)
    }
    return [lo, hi]
  }
  /** Velocity of a body point at centre height (x left, z forward), in world x/z. */
  pointVel(lx: number, lz: number): [number, number] {
    const a = qrot(this.q, lx, 0, lz)
    const v = cross(this.w, a)
    return [this.vel[0] + v[0], this.vel[2] + v[2]]
  }
  toWorld(lx: number, lz: number): [number, number] {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw)
    return [this.x + lx * c + lz * s, this.z - lx * s + lz * c]
  }
  toLocal(wx: number, wz: number): [number, number] {
    const dx = wx - this.x, dz = wz - this.z
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw)
    return [dx * c - dz * s, dx * s + dz * c]
  }
  /** Pitch and roll from a horizontal impulse applied at a height ly above the ground (car frame). */
  tip(px: number, pz: number, ix: number, iz: number, ly: number) {
    const r: V3 = [px - this.p[0], ly - this.rideHeight, pz - this.p[2]]
    const t = cross(r, [ix, 0, iz])
    const tb = qinv(this.q, t[0], 0, t[2])
    const dw = qrot(this.q, tb[0] / this.Ib[0], 0, tb[2] / this.Ib[2])
    this.w[0] += dw[0]
    this.w[2] += dw[2]
  }
}
