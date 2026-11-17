// The engine: gas in each cylinder, valves, a throttle and plenum, and pipes that carry pressure
// waves both ways (digital waveguides). What leaves the tailpipes and the intake is the sound.
// Plain TypeScript with no DOM, so the same code runs in the AudioWorklet and in the tests.

import type { EngineSpec } from './presets'

/** Pressure samples per pipe in each drawing snapshot. */
export const SNAP_POINTS = 10

export const R = 287
export const GAMMA = 1.35
export const CV = R / (GAMMA - 1)
export const CP = GAMMA * CV
export const P0 = 101325
export const T0 = 300
const LHV = 44e6
const AFR = 14.7

// Flow through an orifice: mdot = A * p_up / sqrt(R T_up) * psi(p_down / p_up), tabulated.
const PSI_N = 4096
const PSI = new Float64Array(PSI_N + 2)
{
  const prc = Math.pow(2 / (GAMMA + 1), GAMMA / (GAMMA - 1))
  const psiC = Math.sqrt(GAMMA) * Math.pow(2 / (GAMMA + 1), (GAMMA + 1) / (2 * (GAMMA - 1)))
  for (let i = 0; i <= PSI_N + 1; i++) {
    const pr = Math.min(1, i / PSI_N)
    PSI[i] = pr <= prc ? psiC : Math.sqrt(Math.max(0, (2 * GAMMA / (GAMMA - 1)) * (Math.pow(pr, 2 / GAMMA) - Math.pow(pr, (GAMMA + 1) / GAMMA))))
  }
}
function psi(pr: number) {
  if (!(pr > 0)) return PSI[0]
  const x = pr * PSI_N
  const i = x | 0
  if (i >= PSI_N) return 0
  return PSI[i] + (PSI[i + 1] - PSI[i]) * (x - i)
}
/** Signed mass flow from side 1 to side 2. inv = 1 / sqrt(R T) of each side. */
function flow(p1: number, inv1: number, p2: number, inv2: number, A: number) {
  if (p1 < 1000) p1 = 1000
  if (p2 < 1000) p2 = 1000
  if (p1 >= p2) return p1 > 0 ? A * p1 * inv1 * psi(p2 / p1) : 0
  return p2 > 0 ? -A * p2 * inv2 * psi(p1 / p2) : 0
}
/** Flow m from a volume (pc) into a pipe end whose pressure is pS + k*m. Illinois regula falsi. */
function valveFlow(pc: number, invc: number, pS: number, k: number, invp: number, A: number) {
  if (A <= 0) return 0
  const F0 = flow(pc, invc, pS, invp, A)
  if (F0 === 0) return 0
  let a = 0, ga = -F0, b = F0
  let gb = b - flow(pc, invc, pS + k * b, invp, A)
  if (gb === 0) return b
  let side = 0
  for (let it = 0; it < 10; it++) {
    const m = (a * gb - b * ga) / (gb - ga)
    const gm = m - flow(pc, invc, pS + k * m, invp, A)
    if (Math.abs(gm) < 1e-9) return m
    if (gm * gb > 0) { b = m; gb = gm; if (side === -1) ga *= 0.5; side = -1 }
    else { a = m; ga = gm; if (side === 1) gb *= 0.5; side = 1 }
  }
  return (a * gb - b * ga) / (gb - ga)
}

/** A pipe of fixed gas temperature: a right-going and a left-going delay line. End 0 is upstream. */
export class Pipe {
  n: number
  r: Float64Array
  l: Float64Array
  i = 0
  area: number
  baseArea: number
  c: number
  rhoC: number
  rho: number
  inv: number
  T: number
  g: number
  alpha: number
  s0 = 0
  s1 = 0
  d0 = 0
  d1 = 0
  arr0 = 0
  arr1 = 0
  out0 = 0
  out1 = 0
  length: number
  constructor(len: number, d: number, T: number, fs: number, loss: number) {
    this.T = T
    this.c = Math.sqrt(GAMMA * R * T)
    this.rho = P0 / (R * T)
    this.rhoC = this.rho * this.c
    this.inv = 1 / Math.sqrt(R * T)
    this.area = this.baseArea = Math.PI * d * d / 4
    this.length = len
    this.n = Math.max(2, Math.round(len / this.c * fs))
    this.r = new Float64Array(this.n)
    this.l = new Float64Array(this.n)
    // Loss per pass grows with length and thinner pipes; the low-pass stands in for wall friction.
    this.g = Math.exp(-loss * len / Math.sqrt(d / 0.05))
    const fc = Math.min(fs * 0.45, 9000 * Math.sqrt(d / 0.05) / Math.max(0.3, len))
    this.alpha = 1 - Math.exp(-2 * Math.PI * Math.max(fc, 2500) / fs)
  }
  read() {
    // Low-pass and damping act on the swing of each wave only; its mean, which carries the steady
    // flow, passes untouched, or the pipe would make or lose gas.
    this.s1 += this.alpha * (this.r[this.i] - this.s1)
    this.s0 += this.alpha * (this.l[this.i] - this.s0)
    this.d1 += 0.0004 * (this.s1 - this.d1)
    this.d0 += 0.0004 * (this.s0 - this.d0)
    this.arr1 = this.d1 + this.g * (this.s1 - this.d1)
    this.arr0 = this.d0 + this.g * (this.s0 - this.d0)
    this.out0 = this.arr0
    this.out1 = this.arr1
  }
  write() {
    this.r[this.i] = this.out0
    this.l[this.i] = this.out1
    this.i = this.i + 1 === this.n ? 0 : this.i + 1
  }
  /** Pressure above ambient at a fraction f of the way from end 0 to end 1. */
  at(f: number) {
    const n = this.n
    const x = Math.min(n - 1, Math.max(1, Math.round(f * n)))
    return this.r[(this.i - x + n) % n] + this.l[(this.i - (n - x) + n) % n]
  }
}

class Cylinder {
  phase: number
  m = 0
  mf = 0
  E = 0
  p = P0
  T = T0
  V = 0
  q = 0
  burn = -1
  burnDur = 50
  dead = false
  flicker = 0
  lastLocal = 0
  burnGlow = 0
  constructor(phase: number) { this.phase = phase }
}

export interface Telemetry {
  torque: number
  indicated: number
  rpm: number
  loud: number
  plenum: number
}

export class EngineSim {
  spec: EngineSpec
  fs: number
  dt: number
  pipes: Pipe[] = []
  cyl: Cylinder[] = []
  exh: Pipe[] = []
  run: Pipe[] = []
  joins: { p: Pipe; e: 0 | 1 }[][] = []
  opens: { p: Pipe; pan: number; s: number; u: number; hp: number; hpx: number }[] = []
  mufflers: Pipe[] = []
  r: number
  rod: number
  Ap: number
  Vd: number
  Vc: number
  theta = 0
  omega = 0
  throttle = 0
  fuelCut = false
  muffler = 1
  /** 0..1 per cylinder: chance a firing is lost (damage). */
  misfire: number[] = []
  plenumM = 0
  /** Burned gas held in the plenum and runners, and the runners' gas mass at ambient pressure. */
  poolB = 0
  runnerM = 0
  plenumV: number
  thA: number
  idleA: number
  inv0 = 1 / Math.sqrt(R * T0)
  bins = new Float64Array(72)
  bin = 0
  intakeU = 0
  intakeHp = 0
  intakeX = 0
  blockHp = 0
  blockX = 0
  loud = 0
  rng = 12345
  // mechanical and flow noise (spec.mech)
  modes: { b0: number; b2: number; a1: number; a2: number; g: number; x1: number; x2: number; y1: number; y2: number }[] = []
  shape = [this.biquad('hp', 650, 0.7), this.biquad('lp', 4200, 0.7), this.biquad('lp', 5500, 0.7)]
  prevLift: Float64Array = new Float64Array(0)
  noiseState = 0x9e3779b9
  ivA: number
  evA: number
  constructor(spec: EngineSpec, fs: number) {
    this.spec = spec
    this.fs = fs
    this.dt = 1 / fs
    this.r = spec.stroke / 2
    this.rod = spec.rod
    this.Ap = Math.PI * spec.bore * spec.bore / 4
    this.Vd = this.Ap * spec.stroke
    this.Vc = this.Vd / (spec.cr - 1)
    this.plenumV = spec.plenum
    this.thA = Math.PI * spec.throttleD * spec.throttleD / 4
    this.idleA = this.thA * spec.idleBypass
    this.ivA = spec.valves.n * Math.PI * spec.valves.di * spec.valves.di / 4
    this.evA = spec.valves.n * Math.PI * spec.valves.de * spec.valves.de / 4
    const net = spec.net
    for (const ps of net.pipes) {
      const p = new Pipe(ps.len, ps.d, ps.T, fs, ps.loss ?? 0.05)
      this.pipes.push(p)
      if (ps.muffler) this.mufflers.push(p)
    }
    this.exh = net.exh.map(i => this.pipes[i])
    this.run = net.run.map(i => this.pipes[i])
    this.runnerM = this.run.reduce((a, p) => a + p.rho * p.area * p.length, 0)
    this.joins = net.joins.map(j => j.map(([i, e]) => ({ p: this.pipes[i], e })))
    this.opens = net.opens.map(o => ({ p: this.pipes[o.pipe], pan: o.pan, s: 0, u: 0, hp: 0, hpx: 0 }))
    for (const ph of spec.phases) {
      const c = new Cylinder(ph)
      c.V = this.volume(this.local(ph, 0))
      c.m = P0 * c.V / (R * T0)
      c.mf = c.m
      c.T = T0
      c.E = c.m * CV * T0
      c.p = P0
      this.cyl.push(c)
      this.misfire.push(0)
    }
    // start at idle vacuum, as a warm engine would be
    this.plenumM = 0.4 * P0 * this.plenumV / (R * T0)
    if (spec.mech) {
      this.modes = spec.mech.modes.map(([f, q, g]) => {
        const w0 = 2 * Math.PI * f / fs, al = Math.sin(w0) / (2 * q), a0 = 1 + al
        return { b0: al / a0, b2: -al / a0, a1: -2 * Math.cos(w0) / a0, a2: (1 - al) / a0, g, x1: 0, x2: 0, y1: 0, y2: 0 }
      })
      this.prevLift = new Float64Array(this.cyl.length * 2)
    }
  }
  biquad(kind: 'hp' | 'lp', f: number, q: number) {
    const w0 = 2 * Math.PI * f / 48000, al = Math.sin(w0) / (2 * q), c = Math.cos(w0), a0 = 1 + al
    const b = kind === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: -2 * c / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 }
  }
  noise() {
    let x = this.noiseState
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    this.noiseState = x >>> 0
    return this.noiseState / 2147483648 - 1
  }
  rand() {
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0
    return this.rng / 4294967296
  }
  /** Degrees after this cylinder's firing TDC, 0..720. */
  local(phase: number, theta: number) {
    let d = (theta * 180 / Math.PI - phase) % 720
    if (d < 0) d += 720
    return d
  }
  volume(localDeg: number) {
    const a = localDeg * Math.PI / 180
    const s = Math.sin(a), c = Math.cos(a)
    const x = this.r * (1 - c) + this.rod - Math.sqrt(this.rod * this.rod - this.r * this.r * s * s)
    return this.Vc + this.Ap * x
  }
  /** Piston travel from TDC as a fraction of the stroke, for drawing. */
  pistonAt(i: number) {
    return (this.volume(this.local(this.cyl[i].phase, this.theta)) - this.Vc) / this.Vd
  }
  lift(localDeg: number, open: number, close: number) {
    let d = localDeg - open
    if (d < 0) d += 720
    const span = close - open
    if (d >= span) return 0
    const s = Math.sin(Math.PI * d / span)
    return s * s
  }
  setMuffler(f: number) {
    this.muffler = f
    for (const p of this.mufflers) {
      const tail = this.spec.net.tailD
      const a = Math.PI * tail * tail / 4
      p.area = a + (p.baseArea - a) * f
    }
  }
  /** Run n samples into out (interleaved L/R if stereo). omega slews from the current value. */
  process(outL: Float32Array, outR: Float32Array | null, n: number, omegaTarget: number) {
    const spec = this.spec
    const dt = this.dt
    const w0 = this.omega
    const pipes = this.pipes
    const cam = spec.cam
    const evo = 180 - cam.evo, evc = 360 + cam.evc, ivo = 360 - cam.ivo, ivc = 540 + cam.ivc
    const liftE = Math.min(1, spec.valves.lift * 4 / spec.valves.de)
    const liftI = Math.min(1, spec.valves.lift * 4 / spec.valves.di)
    const cd = 0.62
    const thArea = this.idleA + this.thA * (1 - Math.cos(Math.min(1, Math.max(0, this.throttle)) * Math.PI / 2))
    const binW = 4 * Math.PI / 72
    const mech = spec.mech
    let loudAcc = 0
    for (let k = 0; k < n; k++) {
      const w = w0 + (omegaTarget - w0) * (k + 1) / n
      this.omega = w
      const dth = w * dt
      this.theta += dth
      if (this.theta >= 4 * Math.PI) this.theta -= 4 * Math.PI
      const b = Math.min(71, (this.theta / binW) | 0)
      if (b !== this.bin) { this.bin = b; this.bins[b] = 0 }
      for (let j = 0; j < pipes.length; j++) pipes[j].read()

      const pp = this.plenumM * R * T0 / this.plenumV
      let clicks = 0
      const poolM = this.plenumM + this.runnerM * pp / P0
      const rpm = w * 60 / (2 * Math.PI)
      const adv = 8 + 22 * Math.min(1, rpm / 5500)
      let work = 0
      let block = 0
      for (let ci = 0; ci < this.cyl.length; ci++) {
        const c = this.cyl[ci]
        const loc = this.local(c.phase, this.theta)
        const Vn = this.volume(loc)
        const dV = Vn - c.V
        // valves
        const le = this.lift(loc, evo, evc) * liftE
        const li = this.lift(loc, ivo, ivc) * liftI
        if (mech) {
          // a valve seating: a click, harder the faster the engine turns
          const pe = this.prevLift[ci * 2], pi = this.prevLift[ci * 2 + 1]
          if (pe > 0 && le === 0) clicks += mech.valve * (0.6 + 0.8 * this.rand()) * Math.min(3, Math.abs(w) / 100)
          if (pi > 0 && li === 0) clicks += mech.valve * (0.6 + 0.8 * this.rand()) * Math.min(3, Math.abs(w) / 100)
          this.prevLift[ci * 2] = le; this.prevLift[ci * 2 + 1] = li
        }
        const AE = Math.min(le, 1) * this.evA * cd
        const AI = Math.min(li, 1) * this.ivA * cd
        const invc = 1 / Math.sqrt(R * c.T)
        const ep = this.exh[ci], rp = this.run[ci]
        const mE = AE > 0 ? valveFlow(c.p, invc, P0 + 2 * ep.arr0, ep.c / ep.area, ep.inv, AE) : 0
        const mI = AI > 0 ? valveFlow(c.p, invc, P0 + 2 * rp.arr1, rp.c / rp.area, rp.inv, AI) : 0
        ep.out0 = ep.arr0 + ep.c * mE / ep.area
        rp.out1 = rp.arr1 + rp.c * mI / rp.area
        // mass and energy
        let dm = 0, dE = 0, dmf = 0
        const frac = c.m > 0 ? c.mf / c.m : 0
        if (mE >= 0) { dm -= mE * dt; dE -= mE * dt * CP * c.T; dmf -= mE * dt * frac }
        else { dm -= mE * dt; dE -= mE * dt * CP * ep.T }
        // Gas pushed back into the intake carries its burned share; what comes in again is only as fresh as the intake is.
        if (mI >= 0) { dm -= mI * dt; dE -= mI * dt * CP * c.T; dmf -= mI * dt * frac; this.poolB = Math.min(poolM, this.poolB + mI * dt * (1 - frac)) }
        else { dm -= mI * dt; dE -= mI * dt * CP * rp.T; const share = this.poolB / poolM; dmf -= mI * dt * (1 - share); this.poolB = Math.max(0, this.poolB + mI * dt * share) }
        // spark
        const spark = 720 - adv
        let crossed = false
        if (dth > 0) {
          const prev = c.lastLocal
          crossed = prev < spark ? loc >= spark || loc < prev : false
        }
        c.lastLocal = loc
        if (crossed && c.burn < 0) {
          const lost = this.misfire[ci] > 0 && this.rand() < this.misfire[ci]
          if (!this.fuelCut && !lost && c.mf > 0) {
            const air = Math.min(c.mf, c.m)
            c.q = air / (AFR * spec.lambda) * LHV * spec.eff * (1 + 0.06 * (this.rand() - 0.5))
            c.burn = 0
            c.burnDur = spec.burn * (1 + 0.1 * (this.rand() - 0.5))
          }
        }
        if (c.burn >= 0) {
          const d0 = c.burn / c.burnDur
          c.burn += dth * 180 / Math.PI
          const d1 = Math.min(1, c.burn / c.burnDur)
          const x0 = 1 - Math.exp(-5 * d0 * d0 * d0), x1 = 1 - Math.exp(-5 * d1 * d1 * d1)
          dE += c.q * (x1 - x0)
          c.burnGlow = 1
          if (d1 >= 1) { c.burn = -1; dmf -= Math.min(c.mf, c.q / (LHV * spec.eff) * AFR * spec.lambda) }
        }
        c.burnGlow *= 0.9995
        // wall heat
        const area = 2 * this.Ap + Math.PI * spec.bore * (Vn / this.Ap)
        const h = 250 + 0.6 * Math.abs(w) * spec.stroke / Math.PI * 200
        dE -= h * area * (c.T - 450) * dt
        // piston work
        dE -= c.p * dV
        work += (c.p - P0) * dV
        c.m = Math.max(1e-7, c.m + dm)
        c.mf = Math.min(c.m, Math.max(0, c.mf + dmf))
        c.E = Math.max(c.m * CV * 250, c.E + dE)
        c.V = Vn
        c.T = c.E / (c.m * CV)
        const pn = c.m * R * c.T / Vn
        block += pn - c.p
        c.p = pn
      }
      this.bins[b] += work

      // plenum and throttle
      let mPl = 0
      for (let j = 0; j < this.run.length; j++) {
        const rp = this.run[j]
        rp.out0 = (pp - P0) - rp.arr0
        mPl += rp.area / rp.c * (rp.out0 - rp.arr0)
      }
      const mTh = flow(P0, this.inv0, pp, this.inv0, thArea * 0.8)
      this.plenumM = Math.max(1e-6, this.plenumM + (mTh - mPl) * dt)

      // junctions
      for (let j = 0; j < this.joins.length; j++) {
        const ends = this.joins[j]
        let sy = 0, sa = 0
        for (let e = 0; e < ends.length; e++) {
          const { p, e: side } = ends[e]
          const y = p.area / p.rhoC
          sy += y
          sa += y * (side === 0 ? p.arr0 : p.arr1)
        }
        const pj = 2 * sa / sy
        for (let e = 0; e < ends.length; e++) {
          const { p, e: side } = ends[e]
          if (side === 0) p.out0 = pj - p.arr0
          else p.out1 = pj - p.arr1
        }
      }
      // open ends radiate
      let L = 0, Rr = 0
      for (let j = 0; j < this.opens.length; j++) {
        const o = this.opens[j]
        const p = o.p
        o.s += 0.18 * (p.arr1 - o.s)
        p.out1 = -o.s * 0.97
        const u = (p.arr1 - p.out1) * p.area / p.rhoC
        const du = (u - o.u) * this.fs
        o.u = u
        o.hp = 0.995 * (o.hp + du - o.hpx)
        o.hpx = du
        L += o.hp * (1 - o.pan) * 0.5 + o.hp * 0.25
        Rr += o.hp * (1 + o.pan) * 0.5 + o.hp * 0.25
      }
      for (let j = 0; j < pipes.length; j++) pipes[j].write()

      // intake mouth and block
      const du = (mTh - this.intakeU) * this.fs
      this.intakeU = mTh
      this.intakeHp = 0.995 * (this.intakeHp + du - this.intakeX)
      this.intakeX = du
      this.blockHp = 0.97 * (this.blockHp + block - this.blockX)
      this.blockX = block
      const s = spec.gain
      const iv = this.intakeHp * spec.intakeGain
      const bl = this.blockHp * spec.blockGain
      let mechOut = 0
      if (mech) {
        // the iron rings: valve clicks and the combustion's pressure rise, through the head and block's modes
        const drive = clicks + mech.comb * this.blockHp
        for (const m of this.modes) {
          const y = m.b0 * drive + m.b2 * m.x2 - m.a1 * m.y1 - m.a2 * m.y2
          m.x2 = m.x1; m.x1 = drive; m.y2 = m.y1; m.y1 = y
          mechOut += y * m.g
        }
        // broadband: rattle with speed (pulsing a little with each firing), hiss with the flow
        const krpm = Math.abs(w) * 60 / (2 * Math.PI) / 1000
        const pulse = 1 + 0.15 * Math.cos(this.theta * this.cyl.length / 2)
        let tail = 0
        for (const o of this.opens) tail += o.u * o.u
        const vac = Math.max(0, 1 - pp / P0)
        const amp = mech.rattle * Math.pow(krpm, 1.4) * pulse + mech.exhaustHiss * tail * 1e4 + mech.intakeHiss * Math.abs(mTh) * 100 * Math.sqrt(vac + 0.05)
        let v = this.noise() * amp
        for (const f of this.shape) {
          const y = f.b0 * v + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2
          f.x2 = f.x1; f.x1 = v; f.y2 = f.y1; f.y1 = y
          v = y
        }
        mechOut += v
      }
      let l = (L + iv + bl + mechOut) * s
      let r = (Rr + iv + bl + mechOut) * s
      loudAcc += l * l + r * r
      l = Math.tanh(l)
      r = Math.tanh(r)
      if (outR) { outL[k] = l; outR[k] = r } else outL[k] = (l + r) * 0.5
    }
    this.loud += 0.2 * (Math.sqrt(loudAcc / (2 * n)) - this.loud)
  }
  /** Mean torque over the last cycle, indicated and after friction. */
  torque() {
    let w = 0
    for (let i = 0; i < 72; i++) w += this.bins[i]
    const ind = w / (4 * Math.PI)
    const krpm = Math.abs(this.omega) * 60 / (2 * Math.PI) / 1000
    const fmep = (0.97 + 0.15 * krpm + 0.05 * krpm * krpm) * 1e5
    const fr = fmep * this.Vd * this.cyl.length / (4 * Math.PI) * Math.sign(this.omega || 1)
    return { indicated: ind, brake: ind - fr }
  }
  plenumPressure() { return this.plenumM * R * T0 / this.plenumV }
}
