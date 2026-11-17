// The trailer, as a director inside the game: one continuous take on the game's own clock, with
// shots that pick the course, engine, car and camera, drive the car with scripted inputs (or, for
// the drift, pose it along the loop), set slow motion, and put the words on screen.
// Open with ?film. tools/trailer.ts films it frame by frame with the game's own sound.
import type { Car, Controls } from './sim/car'
import type { World } from './sim/world'
import type { View } from './view/scene'
import { Dummy } from './sim/dummy'
import { Walker } from './sim/walker'
import { RouteDriver } from './sim/route'
import * as THREE from 'three'
import { RollDriver, ROLL } from './rollover'
import { ENGINES } from './engine/presets'

export interface Stage {
  car: Car
  get world(): World
  view: View
  dummy: Dummy
  ctl: Controls
  pickTrack(id: string): void
  pickEngine(id: string): void
  pickSetup(id: string): void
  repair(): void
  setSlow(k: number): void
  setDummy(on: boolean): void
  showDash(on: boolean): void
  /** start the physics afresh: a new engine model, no leftover time (for a take that must repeat) */
  fresh(): void
  /** a new course even if it is the same one */
  newTrack(id: string): void
  /** a sound: an impact of some kind and strength, panned */
  hit(strength: number, kind: 'metal' | 'glass' | 'thud' | 'plastic', pan?: number): void
  /** draw the figure (with the head) even when it is not riding in the car */
  showFigure(on: boolean): void
}

interface Shot {
  len: number
  /** where it starts */
  setup(S: Stage): void
  /** each frame: the controls, slow motion, camera tweaks; t is seconds into the shot (film time) */
  run?(S: Stage, t: number, filmDt: number): void
  /** pose the car by hand instead of driving it */
  puppet?(S: Stage, t: number): void
  label?: string
}
interface Words { t0: number; t1: number; text: string; kind: 'big' | 'mid' | 'label' | 'card'; accent?: string }

const KMH = 1 / 3.6
const none = (S: Stage) => { S.ctl.throttle = 0; S.ctl.brake = 0; S.ctl.steer = 0; S.ctl.handbrake = false }

/** start rolling at a speed in a gear, already hooked up */
function roll(S: Stage, x: number, z: number, yaw: number, kmh: number, gear: number) {
  const c = S.car
  c.reset(x, z, yaw, 900, S.world.height(x, z))
  const v = kmh * KMH
  c.vel[0] = Math.sin(yaw) * v
  c.vel[2] = Math.cos(yaw) * v
  c.ww = v / c.Rw
  c.gear = gear
  c.auto = true
  c.we = c.ww * c.ratio()
  c.clutch = 1
  c.locked = true
  c.sinceShift = 0
}
/** parked in neutral, for revving */
function park(S: Stage, x: number, z: number, yaw: number) {
  const c = S.car
  c.reset(x, z, yaw, 900, S.world.height(x, z))
  c.auto = false
  c.gear = 0
}
/** a blip pattern for free revving: full on, off, on */
const revs = (t: number, on: [number, number][]) => on.some(([a, b]) => t >= a && t < b) ? 1 : 0

export class Director {
  shots: Shot[] = []
  words: Words[] = []
  t = 0
  i = -1
  shotT = 0
  done = false
  puppet = false
  el: HTMLElement
  /** photos flashed full screen under the words: when, and which file (in public/film/) */
  pics: { t0: number; t1: number; src: string }[] = []
  pic: HTMLElement
  flash: HTMLElement
  /** the exhaust traced in light, with its parts named: how far drawn (0-1), or null when not shown */
  trace: number | null = null
  traceMeshes: { head: THREE.Mesh[]; main: THREE.Mesh[] } | null = null
  tagsEl: HTMLElement
  tags: { p: THREE.Vector3; at: number; el: HTMLElement; below: boolean }[] = []
  /** the music's level and how muffled it is (low-pass, Hz), each frame, for the mix */
  music = { gain: 0, lp: 20000, pos: 0 }
  constructor(private S: Stage, kind = 'trailer') {
    this.el = document.createElement('div')
    this.el.id = 'film-words'
    document.body.append(this.el)
    this.pic = document.createElement('div')
    this.pic.id = 'film-pic'
    this.flash = document.createElement('div')
    this.flash.id = 'film-flash'
    document.body.insertBefore(this.pic, this.el)
    document.body.insertBefore(this.flash, this.el)
    this.tagsEl = document.createElement('div')
    this.tagsEl.id = 'film-tags'
    document.body.insertBefore(this.tagsEl, this.el)
    document.body.classList.add('film')
    if (kind === 'pinto') this.buildPinto()
    else this.build()
    // load the photos now so they are there the frame they are needed
    for (const p of this.pics) new Image().src = p.src
  }

  /** The Pinto's exhaust as a line of light, drawn front to back: the four header pipes into one, then
   *  the single pipe through the converter, resonator and muffler to the tail. Parts are named as the
   *  line reaches them. */
  setTrace(k: number | null) {
    this.trace = k
    const S = this.S
    if (k !== null && !this.traceMeshes) {
      const net = ENGINES.find(e => e.id === 'pinto')!.net
      const mk = (pts: number[][], segs: number, r: number, color: number, opacity: number) => {
        const path = new THREE.CurvePath<THREE.Vector3>()
        for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(new THREE.Vector3(...pts[i - 1] as [number, number, number]), new THREE.Vector3(...pts[i] as [number, number, number])))
        const geo = new THREE.TubeGeometry(path, segs, r, 8, false)
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, blending: THREE.AdditiveBlending }))
        m.renderOrder = 20
        m.userData.segs = segs
        S.view.engine.add(m)
        return m
      }
      const heads = net.pipes.filter(p => p.kind === 'header')
      const mainPts: number[][] = []
      net.pipes.forEach((p, i) => { if (i >= 8) for (const v of p.path) { const l = mainPts[mainPts.length - 1]; if (!l || Math.hypot(l[0] - v[0], l[1] - v[1], l[2] - v[2]) > 1e-4) mainPts.push(v) } })
      this.traceMeshes = {
        head: heads.flatMap(h => [mk(h.path, 24, 0.012, 0xffb050, 1), mk(h.path, 24, 0.035, 0xff6a2a, 0.3)]),
        main: [mk(mainPts, 160, 0.014, 0xffb050, 1), mk(mainPts, 160, 0.04, 0xff6a2a, 0.3)],
      }
      // where each part sits along the single pipe (as a share of its length), and its name
      const z0 = mainPts[0][2], z1 = mainPts[mainPts.length - 1][2]
      const at = (z: number) => (z0 - z) / (z0 - z1)
      const tag = (text: string, x: number, y: number, z: number, a: number, below: boolean) => {
        const el = document.createElement('div')
        el.className = 'tag' + (below ? ' below' : '')
        el.textContent = text
        this.tagsEl.append(el)
        this.tags.push({ p: new THREE.Vector3(x, y, z), at: a, el, below })
      }
      tag('4 pipes into 1', -0.33, 0.2, 0.45, 0, false)
      tag('catalytic converter', -0.33, 0.17, 0.02, at(0.02), true)
      tag('resonator', -0.33, 0.17, -0.43, at(-0.43), false)
      tag('muffler', -0.33, 0.17, -1.33, at(-1.33), true)
      tag('tailpipe', -0.33, 0.22, -2.05, at(-2.05), false)
    }
    if (!this.traceMeshes) return
    const kh = k === null ? 0 : Math.min(1, k / 0.2), km = k === null ? 0 : Math.max(0, (k - 0.2) / 0.8)
    const draw = (m: THREE.Mesh, u: number) => {
      m.visible = u > 0
      m.geometry.setDrawRange(0, Math.floor(u * m.userData.segs) * 8 * 6)
    }
    this.traceMeshes.head.forEach(m => draw(m, kh))
    this.traceMeshes.main.forEach(m => draw(m, km))
    this.tagsEl.style.opacity = k === null ? '0' : '1'
  }

  /** after the frame is drawn: pin the part names to where the pipe is on screen */
  afterView() {
    if (this.trace === null || !this.tags.length) return
    const km = Math.max(0, (this.trace - 0.2) / 0.8)
    const cam = this.S.view.camera, M = this.S.view.engine.matrixWorld
    for (const t of this.tags) {
      const v = t.p.clone().applyMatrix4(M).project(cam)
      t.el.style.left = `${(v.x + 1) / 2 * innerWidth}px`
      t.el.style.top = `${(1 - v.y) / 2 * innerHeight}px`
      const show = this.trace >= 0.2 && km >= t.at - 1e-6
      t.el.style.opacity = show ? '1' : '0'
    }
  }

  /** a photo cut in with a camera flash, pushing in slowly, cut straight out */
  drawPics() {
    const now = this.t
    const p = this.pics.find(p => now >= p.t0 && now < p.t1)
    if (p) {
      const u = (now - p.t0) / (p.t1 - p.t0)
      this.pic.style.backgroundImage = `url("${p.src}")`
      this.pic.style.opacity = '1'
      this.pic.style.transform = `scale(${1.02 + 0.05 * u})`
    } else this.pic.style.opacity = '0'
    const since = p ? now - p.t0 : Infinity
    this.flash.style.opacity = since < 0.25 ? String(0.9 * (1 - since / 0.25)) : '0'
  }
  get length() { return this.shots.reduce((a, s) => a + s.len, 0) }

  build() {
    const shots = this.shots, W = this.words
    let at = 0
    const shot = (s: Shot) => { shots.push(s); const t0 = at; at += s.len; return t0 }
    const say = (t0: number, t1: number, text: string, kind: Words['kind'] = 'big', accent?: string) => W.push({ t0, t1, text, kind, accent })
    const keep = (S: Stage) => Math.max(-1, Math.min(1, -S.car.x * 0.25 - S.car.yaw * 2.2))

    // ---- the lot, briefly: two engines
    let t = shot({ len: 3.4, setup: S => { S.pickTrack('lot'); S.pickSetup('street'); S.pickEngine('v8'); park(S, 0, 0, 0); S.view.camMode = 2 }, run: (S, t) => { none(S); S.ctl.throttle = revs(t, [[0.7, 1.3], [1.8, 2.6]]) } })
    say(t + 0.2, t + 3.3, 'Every sound is computed from a *simulated engine*.')
    say(t + 0.2, t + 3.3, 'V8 5.0 cross-plane', 'label')
    t = shot({ len: 3.2, setup: S => { S.pickEngine('v8f'); roll(S, -40, -150, 0.3, 38, 2); S.view.camMode = 3 }, run: S => { none(S); S.ctl.throttle = 1 } })
    say(t + 0.1, t + 3.1, '*Gas burning* in the cylinders. *Valves* opening.')
    say(t + 0.1, t + 3.1, 'V8 4.5 flat-plane', 'label')

    // ---- the drift (posed by hand)
    t = shot({ len: 4.4, setup: S => { S.pickTrack('drift'); S.pickSetup('drift'); S.pickEngine('drift'); S.view.camMode = 1 }, puppet: (S, t) => this.drift(S, t) })
    say(t + 0.1, t + 4.3, '*Pressure waves* running up and down the intake and exhaust.')
    say(t + 0.1, t + 4.3, 'Drift I6 3.2 built', 'label')
    t = shot({ len: 2.4, setup: S => { S.view.camMode = 0 }, puppet: (S, t) => this.drift(S, t + 1.2) })
    say(t + 0.15, t + 2.3, 'No recordings.', 'big', '#ff6a2a')

    // ---- bumps
    t = shot({ len: 3.4, setup: S => { S.pickTrack('bumps'); S.pickSetup('street'); S.pickEngine('i6'); park(S, 0, 22, 0); S.car.auto = true; S.car.gear = 1; S.view.camMode = 0; S.showDash(true) }, run: (S, t) => { none(S); S.ctl.throttle = t > 0.2 ? 1 : 0; S.ctl.steer = keep(S); if (t > 3.3) S.showDash(false) } })
    say(t + 0.2, t + 3.3, 'The car\'s *torque* comes from the same simulation.', 'mid')
    say(t + 0.2, t + 3.3, 'Inline-6 3.0', 'label')
    t = shot({ len: 4, setup: S => { S.showDash(false); S.pickEngine('v8'); roll(S, 0, 76, 0, 105, 3); S.view.camMode = 1 }, run: S => { none(S); S.ctl.throttle = 1; S.ctl.steer = keep(S); S.setSlow(S.car.airborne > 0.05 ? 0.35 : 1) } })
    t = shot({ len: 3.4, setup: S => { S.setSlow(1); roll(S, 0, 128, 0, 92, 3); S.view.camMode = 2 }, run: S => { none(S); S.ctl.throttle = 1; S.ctl.steer = keep(S) } })

    // ---- jumps
    t = shot({ len: 2.8, setup: S => { S.pickTrack('jumps'); S.pickEngine('b4'); roll(S, 0, 26, 0, 88, 3); S.view.camMode = 3 }, run: S => { none(S); S.ctl.throttle = 1; S.ctl.steer = keep(S) } })
    say(t + 0.1, t + 2.7, 'Flat-4 2.5, unequal headers', 'label')
    t = shot({ len: 4.4, setup: S => { S.pickEngine('v8f'); roll(S, 0, 92, 0, 108, 3); S.view.camMode = 1 }, run: S => { none(S); S.ctl.throttle = 1; S.ctl.steer = keep(S); S.setSlow(S.car.airborne > 0.05 ? 0.35 : 1) } })
    say(t + 0.1, t + 4.3, 'V8 4.5 flat-plane', 'label')
    t = shot({ len: 4.6, setup: S => { S.setSlow(1); S.pickEngine('v8'); roll(S, 0, 300, 0, 140, 4); S.view.camMode = 0 }, run: S => { none(S); S.ctl.throttle = 1; S.ctl.steer = keep(S); S.setSlow(S.car.airborne > 0.1 ? 0.5 : 1) } })

    // ---- crash lane
    t = shot({ len: 3.4, setup: S => { S.setSlow(1); S.pickTrack('crash'); S.pickEngine('vt'); roll(S, 0.3, 66, 0, 95, 3); S.view.camMode = 0 }, run: S => { none(S); S.ctl.throttle = 1; S.setSlow(S.car.z > 82 && S.car.z < 92 ? 0.3 : 1) } })
    say(t + 0.1, t + 3.3, 'V-twin 1.8', 'label')
    t = shot({ len: 3.6, setup: S => { S.setSlow(1); S.pickEngine('v8'); roll(S, 0.4, 104, 0, 100, 3); S.view.camMode = 1 }, run: S => { none(S); S.ctl.throttle = 1; S.setSlow(S.car.z > 126 && S.car.z < 134 ? 0.3 : 1) } })

    // ---- a rollover nobody pushed: a yank of the wheel at speed, found by tools/rollsearch.ts
    t = shot({
      len: 9.5,
      setup: S => {
        this.rolls = 0
        S.setSlow(1); S.setDummy(false); S.newTrack(ROLL.track); S.pickSetup('street'); S.pickEngine(ROLL.engine); S.repair()
        roll(S, ROLL.x, ROLL.z, ROLL.yaw, ROLL.kmh, ROLL.gear)
        S.fresh()
        this.roller = new RollDriver(ROLL)
        S.view.camMode = 0
      },
      run: (S, _t, filmDt) => {
        const D = this.roller!
        const slow = D.slow(S.car, filmDt)
        S.setSlow(slow)
        Object.assign(S.ctl, D.controls(S.car, filmDt * slow))
        // from the side once it goes over, to see it roll
        if (D.slowSeen) S.view.camMode = 1
        const c = S.car, q = c.q
        const fx = 2 * (q[0] * q[2] + q[3] * q[1]), fy = 2 * (q[1] * q[2] - q[3] * q[0]), fz = 1 - 2 * (q[0] * q[0] + q[1] * q[1])
        this.rolls += Math.abs((c.w[0] * fx + c.w[1] * fy + c.w[2] * fz) * filmDt * slow) / (2 * Math.PI)
      },
    })

    // ---- the dummy, over the low wall
    t = shot({
      len: 11.5,
      setup: S => { S.setSlow(1); S.newTrack('crash'); S.pickEngine('v8f'); S.repair(); S.setDummy(true); roll(S, 0, 410, 0, 140, 4); S.view.camMode = 0; S.view.dummyCam = true },
      run: S => {
        none(S)
        S.ctl.throttle = S.dummy.free ? 0 : 1
        S.ctl.steer = S.dummy.free ? 0 : keep(S)
        if (S.dummy.free) S.setSlow(S.dummy.flying < 1.0 ? 0.3 : S.dummy.flying < 2.6 ? 0.55 : 1)
      },
    })
    say(t + 7.0, t + 11.5, '', 'card')
  }
  roller: RollDriver | null = null
  /** turns about its length during the rollover shot (for the recorder's log) */
  rolls = 0

  /**
   * "So you bought a Ford Pinto in the 1970s": out of the house to the car at the kerb (music fading
   * behind him), in, the key, the 2.3 catching, then round the neighbourhood: easy laps, a quicker one
   * with a little squeal, and the music back up at the end. The music itself is the user's to add.
   */
  buildPinto() {
    const W = this.words
    let at = 0
    const shot = (s: Shot) => { this.shots.push(s); const t0 = at; at += s.len; return t0 }
    const say = (t0: number, t1: number, text: string, kind: Words['kind'] = 'big') => W.push({ t0, t1, text, kind })
    const walker = new Walker()
    const st = { seg: 0, path: [] as [number, number][], speed: 1.35, hx: 0, hz: 0, fx: 0, carX: -3.55, carZ: 0, door: null as THREE.Object3D | null, driver: null as RouteDriver | null, lastStep: 0, seat: null as [number, number, number][] | null, slam: false, key: false, click: false }
    const ease = (u: number) => { const c = Math.max(0, Math.min(1, u)); return c * c * (3 - 2 * c) }
    const lerpV = (a: number[], b: number[], k: number) => new THREE.Vector3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k)
    const chase = (S: Stage) => { S.view.directed = null; S.view.camMode = 0 }

    // ---- 1. out of the house
    let t = shot({
      len: 11,
      setup: S => {
        S.pickTrack('hood')
        S.setDummy(false); S.showFigure(true); S.view.dummy.look = 'person'
        const H = S.world.hood!
        const parkedNear = (z: number) => S.world.blocks.some(b => b.kind === 'parked' && Math.abs(b.x + 3.65) < 1.5 && Math.abs(b.z - z) < 9)
        const h = H.houses.filter(h => h.side === -1 && h.x < 0 && h.x > -30 && h.z > -90 && h.z < -15 && !parkedNear(h.z)).sort((a, b) => b.z - a.z)[0] ?? H.houses[0]
        st.hx = h.x; st.hz = h.z; st.fx = h.x + h.w / 2
        st.carZ = h.z + 2.2
        // no tree in his way, or between the camera and the door
        const inWay = (x: number, z: number) => x > st.fx - 1 && x < 8 && Math.abs(z - h.z) < 9
        H.trees = H.trees.filter(([x, z]) => !inWay(x, z))
        S.world.blocks = S.world.blocks.filter(b => !(b.kind === 'tree' && inWay(b.x, b.z)))
        S.view.buildWorld(S.world)
        S.car.reset(st.carX, st.carZ, 0, 750, 0)
        S.car.we = 0; S.car.ignition = false
        Object.assign(S.ctl, { throttle: 0, brake: 1, steer: 0, handbrake: true })
        // the front door, hinged at one side, and a warm porch light
        const K = H.kerb
        const door = new THREE.Group()
        const slab = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.05, 0.95).translate(0, 1.025, 0.475), new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.8 }))
        door.add(slab, new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: 0xc8a882 })))
        door.position.set(st.fx + 0.03, K, h.z - 0.475)
        S.view.scene.add(door)
        st.door = door
        const lamp = new THREE.PointLight(0xffc27a, 6, 10, 1.6)
        lamp.position.set(st.fx + 0.9, K + 2.5, h.z + 0.9)
        S.view.scene.add(lamp)
        walker.x = st.fx - 0.5; walker.z = h.z; walker.y = K; walker.yaw = Math.PI / 2; walker.stride = 0; st.lastStep = 0; st.seg = 0
        // out of the door, down the path to the kerb, round the nose of the car to the driver's door
        const dz = st.carX + 0.875 + 0.4
        st.path = [[st.fx - 0.5, h.z], [st.fx + 1.2, h.z], [-6.3, h.z], [-5.6, st.carZ + 2.9], [-3.0, st.carZ + 3.0], [dz, st.carZ + 1.4], [dz, st.carZ - 0.35]]
        let len = 0
        for (let k = 1; k < st.path.length; k++) len += Math.hypot(st.path[k][0] - st.path[k - 1][0], st.path[k][1] - st.path[k - 1][1])
        // he reaches the door just before the cut
        st.speed = Math.max(1.2, Math.min(1.8, len / (10.6 - 1.3 - 0.3)))
        S.view.directed = { pos: new THREE.Vector3(7, 1.6, h.z + 5), look: new THREE.Vector3(st.fx + 1, 1.3, h.z), fov: 44 }
      },
      run: (S, t, dt) => {
        const open = ease((t - 0.6) / 0.7)
        if (st.door) st.door.rotation.y = -open * 1.45
        // walk: out of the door, down the front path, along to the kerb by the car
        const path = st.path
        if (t > 1.3) {
          walker.stride = Math.min(1, walker.stride + dt * 2.5)
          let left = st.speed * dt * walker.stride
          while (st.seg < path.length - 1 && left > 0) {
            const [ax, az] = path[st.seg], [bx, bz] = path[st.seg + 1]
            const want = Math.atan2(bx - ax, bz - az)
            let dy = want - walker.yaw
            dy = Math.atan2(Math.sin(dy), Math.cos(dy))
            walker.yaw += dy * Math.min(1, dt * 6)
            const rem = Math.hypot(bx - walker.x, bz - walker.z)
            const step = Math.min(left, rem)
            walker.x += (bx - walker.x) / (rem || 1) * step; walker.z += (bz - walker.z) / (rem || 1) * step
            walker.phase += step / 1.45 * Math.PI * 2
            left -= step
            if (rem - step < 1e-4) st.seg++
          }
          // there: feet together
          if (left > 0) walker.stride = Math.max(0, walker.stride - dt * 4)
          walker.y = S.world.height(walker.x, walker.z)
          const n = Math.floor(walker.phase / Math.PI)
          if (n !== st.lastStep) { st.lastStep = n; S.hit(1.0 + Math.random() * 0.3, 'thud', 0) }
        }
        walker.apply(S.dummy)
        // the camera eases in a little, keeping him in frame
        const k = ease(t / 11)
        S.view.directed = { pos: lerpV([7, 1.6, st.hz + 5], [2.2, 1.45, st.carZ + 7.5], k), look: new THREE.Vector3(walker.x + 1.2 * (1 - k), 1.2, walker.z), fov: 44, ease: 3 }
        // music: muffled indoors, louder through the open door, fading with his distance from it
        const d = Math.hypot(walker.x - st.fx, walker.z - st.hz)
        const near = Math.max(0, Math.min(1, 1 - (d - 1.2) / 9))
        this.music = { gain: (0.28 + 0.27 * open) * (t < 1.3 ? 1 : near), lp: 700 + 1900 * open, pos: t }
      },
    })
    say(t + 2.3, t + 5.6, 'So you bought a *Ford Pinto* in the 1970s.')
    // a real one: a 1971 Pinto Runabout at the 2024 Woodward Dream Cruise (CC0, Wikimedia Commons)
    this.pics.push({ t0: t + 3.0, t1: t + 4.3, src: '/film/pinto-1971.jpg' })
    say(t + 6.0, t + 10.6, 'What does it sound like driving through the neighborhood?')

    // ---- 2. into the car
    t = shot({
      len: 5,
      setup: S => {
        this.music = { gain: 0, lp: 20000, pos: 0 }
        walker.x = st.carX + 0.875 + 0.4; walker.z = st.carZ - 0.35; walker.yaw = -Math.PI / 2; walker.stride = 0; walker.y = 0
        st.seat = null; st.slam = false; st.click = false
        S.view.directed = { pos: new THREE.Vector3(st.carX + 3.4, 1.35, st.carZ + 3.0), look: new THREE.Vector3(st.carX + 0.4, 0.85, st.carZ - 0.4), fov: 46 }
      },
      run: (S, t) => {
        const open = ease((t - 0.3) / 0.6) * (1 - ease((t - 2.8) / 0.4))
        S.view.body.setDoor(open * 1.05)
        if (t > 0.3 && !st.click) { st.click = true; S.hit(2, 'plastic', 0.3) }
        if (!st.seat) { const d = new Dummy(); d.ride(S.car, 0.001); st.seat = Array.from({ length: 16 }, (_, i) => d.get(i)) }
        walker.apply(S.dummy, st.seat, (t - 1.0) / 1.6)
        if (t > 3.2 && !st.slam) { st.slam = true; S.hit(7, 'thud', 0.3); S.hit(2.5, 'metal', 0.3); S.setDummy(true) }
      },
    })

    // ---- 3. the key
    t = shot({
      len: 4.8,
      setup: S => { S.view.directed = null; S.view.camMode = 2; st.key = false },
      run: (S, t) => {
        Object.assign(S.ctl, { throttle: 0, brake: 1, steer: 0, handbrake: true })
        if (t > 0.7 && !st.key) { st.key = true; S.hit(1.5, 'plastic', 0); S.car.ignition = true }
      },
    })

    // ---- 4-6. round the neighbourhood: easy laps, then a quicker one with a little squeal
    const lap: [number, number][] = [[-1.6, 98.4], [-58.4, 98.4], [-58.4, 1.6], [-1.6, 1.6]]
    const corners: [number, number][] = lap
    const nearCorner = (S: Stage) => corners.find(([x, z]) => Math.hypot(S.car.x - x, S.car.z - z) < 24)
    t = shot({
      len: 9,
      setup: S => {
        const d = new RouteDriver([[st.carX + 0.1, st.carZ], [-1.6, st.carZ + 14], ...lap, ...lap, ...lap], false)
        d.cruise = 50; d.corner = 22
        st.driver = d
        chase(S)
      },
      run: (S, t) => {
        Object.assign(S.ctl, st.driver!.controls(S.car))
        if (t < 5.8) {
          // alongside and low on the street side, riding with the car: the whole exhaust traced in light,
          // front to back (it runs down the right side; the trace shows through the see-through body)
          const at = (lx: number, lz: number, y: number) => { const [x, z] = S.car.toWorld(lx, lz); return new THREE.Vector3(x, y, z) }
          S.view.directed = { pos: at(3.6, -0.35, 0.6), look: at(-0.33, -0.35, 0.3), fov: 50 }
          this.setTrace(ease((t - 0.6) / 3.0))
        } else {
          if (this.trace !== null) this.setTrace(null)
          S.view.directed = null; S.view.camMode = 1
        }
      },
    })
    say(t + 3.9, t + 5.7, "That's the whole exhaust.", 'mid')
    t = shot({
      len: 10,
      setup: S => chase(S),
      run: S => {
        Object.assign(S.ctl, st.driver!.controls(S.car))
        // a high camera on the corner that turns to follow him through it, otherwise from behind
        const c = nearCorner(S)
        if (c) S.view.directed = { pos: new THREE.Vector3(c[0] + 9, 7, c[1] - 9), look: new THREE.Vector3(S.car.x, 0.6, S.car.z), fov: 50, ease: 8 }
        else chase(S)
      },
    })
    t = shot({
      len: 11,
      setup: S => { const d = st.driver!; d.corner = 28; d.boot = 0.25; d.cruise = 55; chase(S) },
      run: S => {
        Object.assign(S.ctl, st.driver!.controls(S.car))
        // low on the corner's outside, where the squeal is
        const c = nearCorner(S)
        if (c) {
          // down the side street the route does not use, on the outside of the turn, clear of lamps and signs
          const ox = Math.sign(c[0] + 30), oz = Math.sign(c[1] - 50)
          const ix = Math.round(c[0] / 60) * 60, iz = Math.round(c[1] / 100) * 100
          S.view.directed = { pos: new THREE.Vector3(ix + ox * 15, 1.1, iz + oz * 2), look: new THREE.Vector3(S.car.x, 0.6, S.car.z), fov: 46, ease: 10 }
        } else { S.view.directed = null; S.view.camMode = 1 }
      },
    })

    // ---- 7. the music comes back; a two-tyre burnout. His Pinto has a locked rear end (a stock one, with
    // its open diff, would only spin the right rear). Plain inputs: rev it with the clutch in (the
    // handbrake holds it), drop the clutch standing on the footbrake, then off the brake to peel away
    const C = { x: -1.6, z: -9 }
    t = shot({
      len: 10,
      setup: S => {
        S.car.reset(C.x, C.z, 0, 750)
        S.car.openDiff = false; S.car.wd = 0
        S.car.ignition = true
        Object.assign(S.ctl, { throttle: 0, brake: 0, steer: 0, handbrake: true })
        S.view.directed = { pos: new THREE.Vector3(C.x - 4.2, 0.75, C.z - 4.5), look: new THREE.Vector3(C.x - 0.6, 0.45, C.z - 0.6), fov: 46 }
      },
      run: (S, t) => {
        const rev = t > 0.6 && t < 1.3, stand = t >= 1.3 && t < 4.8, peel = t >= 4.8 && t < 7.6
        const stopped = t >= 7.6 && S.car.speed < 0.6
        Object.assign(S.ctl, {
          throttle: rev || stand || peel ? 1 : 0,
          brake: stand ? 0.5 : t >= 7.6 && !stopped ? 0.6 : 0,
          steer: -0.1 * S.car.r, handbrake: t < 1.3 || stopped,
        })
        // low behind the right rear for the smoke, then turning to watch him go
        const k = ease((t - 4.8) / 3)
        S.view.directed = { pos: lerpV([C.x - 4.2, 0.75, C.z - 4.5], [C.x - 4.6, 1.3, C.z - 3.5], k), look: new THREE.Vector3(S.car.x - 0.6 * (1 - k), 0.45 + 0.2 * k, S.car.z - 0.6 * (1 - k)), fov: 46, ease: 6 }
        this.music = { gain: 0.85 * ease(t / 1.6) * (1 - ease((t - 8.2) / 1.8)), lp: 20000, pos: t }
      },
    })
    say(t + 1.4, t + 8.4, 'The sound of a *Ford Pinto*, brand new in the 1970s.')
  }

  /** The drift, posed by hand along the loop's first sweeper: the rear out, wheels spinning, smoke. */
  drift(S: Stage, t: number) {
    const path = S.world.track.path!
    const c = S.car
    const v = 17
    const s0 = 70
    const s = s0 + v * t
    const at = (d: number) => {
      const f = d / 2, i = Math.floor(f), u = f - i
      const a = path[i % path.length], b = path[(i + 1) % path.length]
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
    }
    const p = at(s), q = at(s + 2), r = at(s - 2)
    const tx = q[0] - r[0], tz = q[1] - r[1]
    const heading = Math.atan2(tx, tz)
    const ahead = at(s + 8)
    const turn = Math.atan2(ahead[0] - q[0], ahead[1] - q[1]) - heading
    const side = Math.sign(Math.atan2(Math.sin(turn), Math.cos(turn))) || 1
    const beta = 38 * Math.PI / 180 * Math.min(1, t / 0.8) * Math.min(1, (4.6 - t) / 0.6 + 0.4)
    const yaw = heading + side * beta
    // a little to the outside of the line
    const nx = tz / Math.hypot(tx, tz), nz = -tx / Math.hypot(tx, tz)
    c.p[0] = p[0] - nx * side * 1.5
    c.p[2] = p[1] - nz * side * 1.5
    c.p[1] = c.rideHeight
    c.q[0] = 0; c.q[1] = Math.sin(yaw / 2); c.q[2] = 0; c.q[3] = Math.cos(yaw / 2)
    c.vel[0] = tx / Math.hypot(tx, tz) * v; c.vel[1] = 0; c.vel[2] = tz / Math.hypot(tx, tz) * v
    c.w[0] = 0; c.w[2] = 0; c.w[1] = side * v / 22
    c.u = Math.cos(beta) * v
    c.v = -side * Math.sin(beta) * v
    c.gear = 2
    c.we = (6400 + 500 * Math.sin(t * 7)) * Math.PI / 30
    c.ww = c.we / c.ratio()
    c.throttleOut = 0.92
    c.fuelCut = false
    c.spinR += c.ww / 30
    c.spinF += v / c.Rw / 30
    c.steerAngle = -side * beta * 0.9
    c.burnout = 0.9
    c.slipRear = 1
    for (let i = 0; i < 4; i++) {
      const w = c.wheels[i]
      const lx = w.lx, lz = w.lz
      const sy = Math.sin(yaw), cy = Math.cos(yaw)
      w.pc = [c.p[0] + lx * cy + lz * sy, 0, c.p[2] - lx * sy + lz * cy]
      w.contact = true
      w.len = 0.17
    }
  }

  /** Run the film by one frame of film time. Returns false when it is over. */
  update(dt: number): boolean {
    if (this.done) return false
    this.t += dt
    let acc = 0, k = 0
    for (; k < this.shots.length; k++) { if (this.t < acc + this.shots[k].len) break; acc += this.shots[k].len }
    if (k >= this.shots.length) { this.done = true; return false }
    const shot = this.shots[k]
    if (k !== this.i) {
      this.i = k
      this.S.setSlow(1)
      shot.setup(this.S)
      this.S.view.camPos.copy(this.S.view.camera.position)
      this.S.view.snapCamera = true
    }
    this.shotT = this.t - acc
    this.puppet = !!shot.puppet
    shot.run?.(this.S, this.shotT, dt)
    shot.puppet?.(this.S, this.shotT)
    this.drawWords()
    this.drawPics()
    return true
  }

  /** words on screen: each word rises in, one after another; *starred* words in orange */
  drawWords() {
    const now = this.t
    const live = this.words.filter(w => now >= w.t0 && now < w.t1)
    const html = live.map(w => {
      const parts = w.text.split(/(\*[^*]+\*)/).filter(Boolean)
      let n = 0
      const words: string[] = []
      for (const part of parts) {
        const hot = part.startsWith('*')
        const raw = part.replace(/\*/g, '')
        for (const [wi, word] of raw.split(' ').entries()) {
          if (!word) continue
          // punctuation right after a highlighted word belongs to it, with no space between
          const glue = wi === 0 && !raw.startsWith(' ') && words.length > 0 && /^[.,!?:;]/.test(word)
          const a = Math.min(1, Math.max(0, (now - w.t0 - n * 0.07) / 0.22))
          const out = Math.min(1, Math.max(0, (w.t1 - now) / 0.25))
          const e = 1 - Math.pow(1 - a, 3)
          const style = `opacity:${(e * out).toFixed(3)};transform:translateY(${((1 - e) * 26).toFixed(1)}px) scale(${(0.94 + 0.06 * e).toFixed(3)})${hot || w.accent ? `;color:${w.accent ?? '#ff6a2a'}` : ''}`
          if (glue) { words[words.length - 1] = words[words.length - 1].replace(/<\/span>$/, '') + `<span style="${style}">${word}</span></span>`; n++; continue }
          words.push(`<span style="${style}">${word}</span>`)
          n++
        }
      }
      if (w.kind === 'card') {
        const line = (txt: string, d: number, cls: string) => `<div class="${cls}" style="opacity:${Math.min(1, Math.max(0, (now - w.t0 - d) / 0.5)).toFixed(3)}">${txt}</div>`
        return `<div class="endcard" style="opacity:${Math.min(1, (now - w.t0) / 0.6).toFixed(3)}">` +
          line('Every sound simulated from engine physics.', 0.2, 'sub') +
          line('No recordings.', 0.7, 'sub hot') +
          line('Inspired by Joel Johnson\'s Engine Synthesizer', 1.3, 'credit') +
          line('Crash dummy head: CHIMERA by Jameson Hodge', 1.6, 'credit') + '</div>'
      }
      return `<div class="${w.kind}">${words.join(' ')}</div>`
    }).join('')
    if (this.el.innerHTML !== html) this.el.innerHTML = html
  }
}
