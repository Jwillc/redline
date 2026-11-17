// Six engines, each described by its dimensions, cam timing, firing phases and pipe network.
// All generic types, not copies of any maker's engine. Positions are in the car's frame:
// x to the car's left, y up, z forward (the front axle is at z = 1.35).

export type V3 = [number, number, number]

export interface PipeSpec {
  len: number
  d: number
  T: number
  loss?: number
  muffler?: boolean
  kind: 'header' | 'runner' | 'pipe' | 'muffler' | 'tail'
  path: V3[]
}
export interface Net {
  pipes: PipeSpec[]
  exh: number[]
  run: number[]
  joins: [number, 0 | 1][][]
  opens: { pipe: number; pan: number }[]
  tailD: number
}
export interface CylLayout { pos: V3; axis: V3; bank: number }
/**
 * The engine's own mechanical and flow noise, beyond the gas pulses: what makes a stock iron four
 * sound like one. Each is driven by the simulation (valve events, cylinder pressure, flow, speed).
 */
export interface MechSpec {
  /** a click into the head's modes each time a valve seats, growing with engine speed */
  valve: number
  /** the cylinder pressure's rise passed through the block's modes */
  comb: number
  /** broadband rattle (bearings, belt, piston slap), growing with speed, pulsing a little with each firing */
  rattle: number
  /** turbulent hiss at the tailpipe from the exhaust flow, and through the carburettor from flow and vacuum */
  exhaustHiss: number
  intakeHiss: number
  /** the iron's ringing: [Hz, Q, gain] */
  modes: [number, number, number][]
}

export interface EngineSpec {
  id: string
  name: string
  blurb: string
  bore: number
  stroke: number
  rod: number
  cr: number
  phases: number[]
  valves: { n: number; di: number; de: number; lift: number }
  cam: { ivo: number; ivc: number; evo: number; evc: number }
  throttleD: number
  idleBypass: number
  plenum: number
  lambda: number
  eff: number
  burn: number
  gain: number
  intakeGain: number
  blockGain: number
  idle: number
  redline: number
  /** no rev limiter: past this the valves float and it misfires (rpm) */
  valveFloat?: number
  inertia: number
  layout: CylLayout[]
  plenumPos: V3
  net: Net
  mech?: MechSpec
  /** draw the engine as a particular one: 'lima' is the Ford 2.3 (cam cover, belt cover, carb and air cleaner, fan) */
  looks?: 'lima'
}

const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const ZC = 1.12

class Builder {
  net: Net = { pipes: [], exh: [], run: [], joins: [], opens: [], tailD: 0.06 }
  pipe(p: PipeSpec) { this.net.pipes.push(p); return this.net.pipes.length - 1 }
  join(...ends: [number, 0 | 1][]) { this.net.joins.push(ends) }
  /** Pipes in a row from a set of upstream ends; returns the last pipe (its end 1 left free). */
  chain(from: [number, 0 | 1][], segs: PipeSpec[]) {
    let ends = from
    let last = -1
    for (const s of segs) {
      last = this.pipe(s)
      this.join(...ends, [last, 0])
      ends = [[last, 1]]
    }
    return last
  }
}

/** Ports for drawing: exhaust on the outside of a bank, intake on the inside or top. */
function ports(c: CylLayout): { ex: V3; in: V3; out: V3 } {
  const head = add(c.pos, c.axis, 0.13)
  let out: V3
  if (Math.abs(c.axis[0]) > 0.9) out = [0, -1, 0]
  else if (Math.abs(c.axis[0]) > 0.3) out = [Math.sign(c.axis[0]) * c.axis[1], -Math.abs(c.axis[0]) * 0.3, 0]
  else out = [-1, 0, 0]
  const inn: V3 = Math.abs(c.axis[0]) > 0.9 ? [0, 1, 0] : Math.abs(c.axis[0]) > 0.3 ? [-out[0], 0.6, 0] : [1, 0, 0]
  return { ex: add(head, out, 0.09), in: add(head, inn, 0.08), out }
}

interface ExhaustPlan {
  groups: { cyls: number[]; side: number; lens: number[]; d: number }[]
  /** Each group gets its own line to its own tail (dual), or the groups merge into one (single). */
  dual: boolean
  merge?: { len: number; d: number }
  mid: { len: number; d: number }
  muffler: { len: number; d: number }
  /** a resonator chamber halfway along the mid pipe */
  resonator?: { len: number; d: number }
  /** where the tailpipe ends (car z), for a shorter car */
  tailEnd?: number
  /** a catalytic converter at the head of the line: a short wide can whose ceramic core soaks up sound */
  cat?: { len: number; d: number }
  tail: { len: number; d: number }
  runner: { len: number; d: number }
}

function build(layout: CylLayout[], plan: ExhaustPlan, plenumPos: V3) {
  const b = new Builder()
  b.net.tailD = plan.tail.d
  const n = layout.length
  b.net.exh = new Array(n)
  b.net.run = new Array(n)
  const zCol = 0.45, yUnder = 0.17
  const groupEnds: { pipe: number; side: number }[] = []
  for (const g of plan.groups) {
    const x = 0.33 * g.side
    const col: V3 = [x, yUnder + 0.03, zCol]
    const heads: [number, 0 | 1][] = []
    g.cyls.forEach((ci, k) => {
      const c = layout[ci]
      const p = ports(c)
      const a = add(p.ex, p.out, 0.12)
      const mid: V3 = [x + (p.ex[0] - x) * 0.4, 0.32, (p.ex[2] + zCol) / 2]
      const id = b.pipe({ len: g.lens[k], d: g.d, T: 950, kind: 'header', path: [p.ex, a, mid, col] })
      b.net.exh[ci] = id
      heads.push([id, 1])
      const r = b.pipe({ len: plan.runner.len, d: plan.runner.d, T: 310, loss: 0.03, kind: 'runner', path: [plenumPos, add(plenumPos, [0, 0, (p.in[2] - plenumPos[2]) * 0.6]), add(p.in, [0, 0.1, 0]), p.in] })
      b.net.run[ci] = r
    })
    const prim = b.chain(heads, [{ len: 0.25, d: g.d * 1.5, T: 880, kind: 'pipe', path: [col, [x, yUnder, zCol - 0.25]] }])
    groupEnds.push({ pipe: prim, side: g.side })
  }
  const lineFrom = (from: [number, 0 | 1][], x: number, z0: number) => {
    // (z0 moves back past the converter when there is one)
    const z3 = plan.tailEnd ?? -2.3, z1 = -1.05, z2 = Math.max(-1.6, z3 + 0.5)
    const zr = (z0 + z1) / 2
    const zc = z0 - 0.35
    const cat = plan.cat ? [
      { len: plan.cat.len, d: plan.cat.d, T: 820, loss: 0.4, kind: 'muffler' as const, path: [[x, yUnder, z0], [x, yUnder, zc]] as V3[] },
    ] : []
    if (plan.cat) z0 = zc
    const mid = plan.resonator ? [
      { len: plan.mid.len / 2, d: plan.mid.d, T: 770, kind: 'pipe' as const, path: [[x, yUnder, z0], [x, yUnder, zr + 0.2]] as V3[] },
      { len: plan.resonator.len, d: plan.resonator.d, T: 720, loss: 0.2, kind: 'muffler' as const, path: [[x, yUnder, zr + 0.2], [x, yUnder, zr - 0.2]] as V3[] },
      { len: plan.mid.len / 2, d: plan.mid.d, T: 700, kind: 'pipe' as const, path: [[x, yUnder, zr - 0.2], [x, yUnder, z1]] as V3[] },
    ] : [{ len: plan.mid.len, d: plan.mid.d, T: 760, kind: 'pipe' as const, path: [[x, yUnder, z0], [x, yUnder, z1]] as V3[] }]
    const last = b.chain(from, [
      ...cat,
      ...mid,
      { len: plan.muffler.len, d: plan.muffler.d, T: 650, loss: 0.35, muffler: true, kind: 'muffler', path: [[x, yUnder, z1], [x, yUnder, z2]] },
      { len: plan.tail.len, d: plan.tail.d, T: 600, kind: 'tail', path: [[x, yUnder, z2], [x, yUnder + 0.05, z3]] },
    ])
    b.net.opens.push({ pipe: last, pan: Math.max(-1, Math.min(1, x * 2.4)) })
  }
  if (plan.dual) {
    for (const g of groupEnds) lineFrom([[g.pipe, 1]], 0.33 * g.side, zCol - 0.25)
  } else if (groupEnds.length > 1) {
    const m = plan.merge ?? { len: 0.3, d: plan.mid.d }
    const x = -0.3
    const merged = b.chain(groupEnds.map(g => [g.pipe, 1] as [number, 0 | 1]), [{ len: m.len, d: m.d, T: 820, kind: 'pipe', path: [[0, yUnder, zCol - 0.3], [x, yUnder, zCol - 0.55]] }])
    lineFrom([[merged, 1]], x, zCol - 0.55)
  } else {
    lineFrom([[groupEnds[0].pipe, 1]], 0.33 * groupEnds[0].side, zCol - 0.25)
  }
  return b.net
}

function inline(n: number, spacing: number, tilt = 0): CylLayout[] {
  const out: CylLayout[] = []
  for (let i = 0; i < n; i++) {
    const z = ZC + (((n - 1) / 2) - i) * spacing
    out.push({ pos: [0, 0.55, z], axis: [Math.sin(tilt), Math.cos(tilt), 0], bank: 0 })
  }
  return out
}
function vee(perBank: number, spacing: number, angleDeg: number, offset: number): CylLayout[] {
  const a = angleDeg / 2 * Math.PI / 180
  const out: CylLayout[] = []
  // Cylinder numbers: bank 0 (left) first, then bank 1, front to back.
  for (let bank = 0; bank < 2; bank++) {
    const s = bank === 0 ? 1 : -1
    for (let i = 0; i < perBank; i++) {
      const z = ZC + (((perBank - 1) / 2) - i) * spacing - bank * offset
      const axis: V3 = [s * Math.sin(a), Math.cos(a), 0]
      out.push({ pos: add([0, 0.42, z], axis, 0.2), axis, bank })
    }
  }
  return out
}
function boxer(perSide: number, spacing: number): CylLayout[] {
  const out: CylLayout[] = []
  // 1 and 3 on the right, 2 and 4 on the left, staggered.
  for (let i = 0; i < perSide * 2; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const row = Math.floor(i / 2)
    const z = ZC + 0.08 - row * spacing - (side > 0 ? 0.05 : 0)
    out.push({ pos: [side * 0.24, 0.42, z], axis: [side, 0, 0], bank: side > 0 ? 0 : 1 })
  }
  return out
}

/** Firing order to phases: cylinder k (1-based in the order) fires at idx * 720 / n. */
function phasesFor(order: number[], interval?: number[]): number[] {
  const n = order.length
  const ph = new Array(n).fill(0)
  let a = 0
  order.forEach((cyl, idx) => {
    ph[cyl - 1] = a
    a += interval ? interval[idx] : 720 / n
  })
  return ph
}

function make(s: Omit<EngineSpec, 'net' | 'plenumPos'> & { plan: ExhaustPlan; plenumPos?: V3 }): EngineSpec {
  const plenumPos = s.plenumPos ?? [0, 0.98, ZC]
  const { plan, ...rest } = s
  return { ...rest, plenumPos, net: build(s.layout, plan, plenumPos) }
}

export const ENGINES: EngineSpec[] = [
  make({
    id: 'i4', name: 'Inline-4 2.0', blurb: 'Four in a row, 4-into-1 header, single exhaust. Revs out clean.',
    bore: 0.086, stroke: 0.086, rod: 0.145, cr: 10.8,
    phases: phasesFor([1, 3, 4, 2]),
    valves: { n: 2, di: 0.034, de: 0.029, lift: 0.0095 },
    cam: { ivo: 12, ivc: 52, evo: 50, evc: 12 },
    throttleD: 0.062, idleBypass: 0.0045, plenum: 0.0028, lambda: 0.92, eff: 0.92, burn: 48,
    gain: 1, intakeGain: 1, blockGain: 1,
    idle: 850, redline: 7200, inertia: 0.14,
    layout: inline(4, 0.095),
    plan: {
      groups: [{ cyls: [0, 1, 2, 3], side: -1, lens: [0.72, 0.72, 0.72, 0.72], d: 0.038 }], dual: false,
      mid: { len: 2.0, d: 0.055 }, muffler: { len: 0.45, d: 0.17 }, tail: { len: 0.7, d: 0.055 }, runner: { len: 0.32, d: 0.04 },
    },
  }),
  make({
    id: 'v8', name: 'V8 5.0 cross-plane', blurb: 'Two banks of four on a cross-plane crank. Each bank fires unevenly into its own pipe: the burble.',
    bore: 0.093, stroke: 0.092, rod: 0.155, cr: 10.5,
    // Cylinders 1-4 left bank front to back, 5-8 right bank. Order 1-5-4-8-6-3-7-2 gives each bank a 90/180/270/180 rhythm.
    phases: phasesFor([1, 5, 4, 8, 6, 3, 7, 2]),
    valves: { n: 1, di: 0.051, de: 0.04, lift: 0.0135 },
    cam: { ivo: 28, ivc: 68, evo: 72, evc: 28 },
    throttleD: 0.09, idleBypass: 0.0045, plenum: 0.0045, lambda: 0.88, eff: 0.9, burn: 55,
    gain: 1, intakeGain: 1, blockGain: 1,
    idle: 720, redline: 6600, inertia: 0.24,
    layout: vee(4, 0.11, 90, 0.025),
    plan: {
      groups: [
        { cyls: [0, 1, 2, 3], side: 1, lens: [0.8, 0.78, 0.82, 0.8], d: 0.044 },
        { cyls: [4, 5, 6, 7], side: -1, lens: [0.8, 0.82, 0.78, 0.8], d: 0.044 },
      ], dual: true,
      mid: { len: 1.5, d: 0.064 }, muffler: { len: 0.4, d: 0.16 }, tail: { len: 0.7, d: 0.064 }, runner: { len: 0.42, d: 0.046 },
    },
  }),
  make({
    id: 'v8f', name: 'V8 4.5 flat-plane', blurb: 'Flat-plane crank: each bank fires evenly, like two fours. High and raw, 9,000 rpm.',
    bore: 0.094, stroke: 0.081, rod: 0.15, cr: 12.5,
    // Order 1-5-3-7-4-8-2-6 alternates banks: bank A 1-4, bank B 5-8.
    phases: phasesFor([1, 5, 3, 7, 4, 8, 2, 6]),
    valves: { n: 2, di: 0.036, de: 0.03, lift: 0.0115 },
    cam: { ivo: 30, ivc: 62, evo: 62, evc: 30 },
    throttleD: 0.092, idleBypass: 0.0045, plenum: 0.004, lambda: 0.88, eff: 0.92, burn: 46,
    gain: 1, intakeGain: 1, blockGain: 1,
    idle: 1000, redline: 9000, inertia: 0.17,
    layout: vee(4, 0.105, 90, 0.022),
    plan: {
      groups: [
        { cyls: [0, 1, 2, 3], side: 1, lens: [0.55, 0.55, 0.55, 0.55], d: 0.042 },
        { cyls: [4, 5, 6, 7], side: -1, lens: [0.55, 0.55, 0.55, 0.55], d: 0.042 },
      ], dual: true,
      mid: { len: 1.4, d: 0.06 }, muffler: { len: 0.35, d: 0.14 }, tail: { len: 0.6, d: 0.06 }, runner: { len: 0.26, d: 0.044 },
    },
  }),
  make({
    id: 'i6', name: 'Inline-6 3.0', blurb: 'Straight six, two 3-into-1 headers merging into one pipe. Smooth and even.',
    bore: 0.084, stroke: 0.09, rod: 0.145, cr: 10.6,
    phases: phasesFor([1, 5, 3, 6, 2, 4]),
    valves: { n: 2, di: 0.033, de: 0.028, lift: 0.0098 },
    cam: { ivo: 14, ivc: 50, evo: 50, evc: 14 },
    throttleD: 0.072, idleBypass: 0.0045, plenum: 0.0038, lambda: 0.9, eff: 0.92, burn: 48,
    gain: 1, intakeGain: 1, blockGain: 1,
    idle: 760, redline: 7200, inertia: 0.19,
    layout: inline(6, 0.092, 0.3),
    plan: {
      groups: [
        { cyls: [0, 1, 2], side: -1, lens: [0.62, 0.62, 0.62], d: 0.04 },
        { cyls: [3, 4, 5], side: -1, lens: [0.62, 0.62, 0.62], d: 0.04 },
      ], dual: false, merge: { len: 0.35, d: 0.062 },
      mid: { len: 1.6, d: 0.062 }, muffler: { len: 0.42, d: 0.17 }, tail: { len: 0.7, d: 0.062 }, runner: { len: 0.36, d: 0.04 },
    },
  }),
  make({
    id: 'b4', name: 'Flat-4 2.5 unequal headers', blurb: 'Boxer with uneven header lengths, so even firings reach the collector unevenly: the rumble.',
    bore: 0.0995, stroke: 0.079, rod: 0.13, cr: 10.0,
    phases: phasesFor([1, 3, 2, 4]),
    valves: { n: 2, di: 0.036, de: 0.03, lift: 0.0098 },
    cam: { ivo: 12, ivc: 52, evo: 52, evc: 12 },
    throttleD: 0.066, idleBypass: 0.0045, plenum: 0.0032, lambda: 0.9, eff: 0.92, burn: 50,
    gain: 1, intakeGain: 1, blockGain: 1,
    idle: 800, redline: 6800, inertia: 0.15,
    layout: boxer(2, 0.12),
    plenumPos: [0, 0.78, 1.1],
    plan: {
      groups: [{ cyls: [0, 1, 2, 3], side: -1, lens: [0.45, 1.05, 0.5, 1.1], d: 0.04 }], dual: false,
      mid: { len: 1.9, d: 0.058 }, muffler: { len: 0.45, d: 0.16 }, tail: { len: 0.7, d: 0.058 }, runner: { len: 0.35, d: 0.042 },
    },
  }),
  make({
    id: 'vt', name: 'V-twin 1.8 45°', blurb: 'Two big cylinders on one crank pin, firing 315 then 405 degrees apart. A motorbike heart in a car.',
    bore: 0.1016, stroke: 0.1111, rod: 0.19, cr: 9.7,
    phases: phasesFor([1, 2], [315, 405]),
    valves: { n: 2, di: 0.041, de: 0.034, lift: 0.0125 },
    cam: { ivo: 18, ivc: 50, evo: 55, evc: 15 },
    throttleD: 0.054, idleBypass: 0.0045, plenum: 0.0024, lambda: 0.9, eff: 0.9, burn: 55,
    gain: 1, intakeGain: 1, blockGain: 1,
    idle: 900, redline: 5800, inertia: 0.26,
    layout: [
      { pos: [0, 0.6, ZC + 0.1], axis: [0, Math.cos(0.39), Math.sin(0.39)], bank: 0 },
      { pos: [0, 0.6, ZC - 0.1], axis: [0, Math.cos(0.39), -Math.sin(0.39)], bank: 1 },
    ],
    plenumPos: [0.28, 0.75, ZC],
    plan: {
      groups: [{ cyls: [0, 1], side: -1, lens: [0.75, 0.95], d: 0.045 }], dual: false,
      mid: { len: 1.8, d: 0.055 }, muffler: { len: 0.4, d: 0.15 }, tail: { len: 0.6, d: 0.055 }, runner: { len: 0.3, d: 0.045 },
    },
  }),
  make({
    id: 'drift', name: 'Drift I6 3.2 built', blurb: 'A straight six built for sliding: big cams, 11.5:1, a light flywheel, a 6-into-1 header and a straight-through can. Screams to 8,000.',
    bore: 0.087, stroke: 0.09, rod: 0.143, cr: 11.5,
    phases: phasesFor([1, 5, 3, 6, 2, 4]),
    valves: { n: 2, di: 0.036, de: 0.031, lift: 0.0125 },
    cam: { ivo: 30, ivc: 64, evo: 64, evc: 30 },
    throttleD: 0.082, idleBypass: 0.0045, plenum: 0.0048, lambda: 0.86, eff: 0.93, burn: 44,
    gain: 1, intakeGain: 1, blockGain: 1,
    idle: 950, redline: 8000, inertia: 0.11,
    layout: inline(6, 0.094, 0.3),
    plan: {
      groups: [{ cyls: [0, 1, 2, 3, 4, 5], side: -1, lens: [0.74, 0.74, 0.74, 0.74, 0.74, 0.74], d: 0.042 }], dual: false,
      mid: { len: 1.3, d: 0.072 }, muffler: { len: 0.3, d: 0.13 }, tail: { len: 0.5, d: 0.072 }, runner: { len: 0.3, d: 0.044 },
    },
  }),
  make({
    // 1975-76 Ford 2.3 L SOHC four ("Lima"), as in the Pinto: published bore, stroke, rod (5.2047 in), compression (8.4:1), valve
    // sizes and firing order; cam timing, pipe lengths and the carburettor's size are estimates,
    // tuned until it makes about its rating (82-86 hp net in these years; 89 hp and 118 lb-ft for the first units).
    id: 'pinto', name: 'Ford 2.3 SOHC (Pinto)', blurb: 'The 1975-76 Pinto\'s 2.3 litre four: iron block and head, a belt-driven single cam, 8.4:1, a two-barrel carburettor, a cast manifold, a catalytic converter and a stock muffler. About 85 hp.',
    bore: 0.09604, stroke: 0.0794, rod: 0.1322, cr: 8.4,
    phases: phasesFor([1, 3, 4, 2]),
    valves: { n: 1, di: 0.0439, de: 0.0381, lift: 0.0102 },
    cam: { ivo: 12, ivc: 44, evo: 52, evc: 10 },
    throttleD: 0.04, idleBypass: 0.014, plenum: 0.0018, lambda: 0.98, eff: 0.8, burn: 58,
    gain: 1, intakeGain: 1, blockGain: 1,
    idle: 750, redline: 5600, valveFloat: 6100, inertia: 0.17,
    layout: inline(4, 0.105),
    // the 2.3's intake manifold sits low along the side of the head, under the hood line
    plenumPos: [0.27, 0.66, 1.1],
    looks: 'lima',
    plan: {
      groups: [{ cyls: [0, 1, 2, 3], side: -1, lens: [0.36, 0.28, 0.26, 0.34], d: 0.036 }], dual: false,
      mid: { len: 1.7, d: 0.048 }, resonator: { len: 0.35, d: 0.1 }, muffler: { len: 0.55, d: 0.2 }, tail: { len: 0.6, d: 0.045 }, runner: { len: 0.47, d: 0.037 }, tailEnd: -2.13, cat: { len: 0.32, d: 0.13 },
    },
    // tuned against recordings of stock 2.3 Pintos (tools/pinto-profile.py): the clatter and hiss that make it sound like one
    mech: { valve: 12, comb: 0.00025, rattle: 0.8, exhaustHiss: 0.03, intakeHiss: 0.45, modes: [[190, 2, 6], [850, 4, 1], [1450, 6, 0.9], [2300, 8, 0.8], [3400, 10, 0.6], [4700, 12, 0.4]] },
  }),
]

/** Loudness trims, set by tests/calibrate so every engine sits near the same level at full throttle. */
export const TRIM: Record<string, { gain: number; intake: number; block: number }> = {
  i4: { gain: 0.0064, intake: 0.1, block: 8.1e-05 },
  v8: { gain: 0.0049, intake: 0.183, block: 8.7e-05 },
  v8f: { gain: 0.00304, intake: 0.359, block: 9.1e-05 },
  i6: { gain: 0.0093, intake: 0.212, block: 4.3e-05 },
  b4: { gain: 0.00365, intake: 0.159, block: 0.00015 },
  pinto: { gain: 0.0046, intake: 0.15, block: 0.000037 },
  drift: { gain: 0.00144, intake: 1.5, block: 0.0002 },
  vt: { gain: 0.0022, intake: 0.31, block: 0.00045 },
}
for (const e of ENGINES) {
  const t = TRIM[e.id]
  e.gain = t.gain
  e.intakeGain = t.intake
  e.blockGain = t.block
}
