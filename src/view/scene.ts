// The picture: a black lot of dots that swell with the exhaust's pulses, the car as a see-through
// shell with its engine inside, pipes coloured by the simulated pressure in them, loose things,
// sparks, smoke, flames, skid marks and the panels that come off.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Body } from './body'
import { DummyView } from './dummy'
import type { Dummy } from '../sim/dummy'
import type { EngineSpec, V3 } from '../engine/presets'
import { SNAP_POINTS } from '../engine/model'
import type { Car, CarSetup } from '../sim/car'
import type { World, Prop } from '../sim/world'
import type { GlassId, PanelId } from '../sim/damage'

export function pressureColor(dp: number, out: THREE.Color) {
  const t = Math.max(-1, Math.min(1.6, dp / 35000))
  if (t < 0) return out.setRGB(0.05 + 0.1 * -t, 0.07 + 0.35 * -t, 0.09 + 0.9 * -t)
  if (t < 0.7) { const k = t / 0.7; return out.setRGB(0.07 + 0.93 * k, 0.07 + 0.38 * k, 0.08 + 0.04 * k) }
  const k = Math.min(1, (t - 0.7) / 0.9)
  return out.setRGB(1, 0.45 + 0.55 * k, 0.12 + 0.88 * k)
}

class Particles {
  points: THREE.Points
  n: number
  pos: Float32Array; col: Float32Array; size: Float32Array; alpha: Float32Array
  vel: Float32Array; life: Float32Array; age: Float32Array; a0: Float32Array; grow: Float32Array; grav: Float32Array; drag: Float32Array
  next = 0
  constructor(n: number, additive: boolean) {
    this.n = n
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n)
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.age = new Float32Array(n).fill(1e9); this.a0 = new Float32Array(n)
    this.grow = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1))
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1))
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC, a); }`,
    })
    this.points = new THREE.Points(g, m)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, size: number, life: number, alpha = 1, o: { grow?: number; grav?: number; drag?: number } = {}) {
    const i = this.next
    this.next = (this.next + 1) % this.n
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3); this.col.set([c.r, c.g, c.b], i * 3)
    this.size[i] = size; this.life[i] = life; this.age[i] = 0; this.a0[i] = alpha
    this.grow[i] = o.grow ?? 0; this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 0
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] > this.life[i]) { this.alpha[i] = 0; continue }
      this.age[i] += dt
      const k = i * 3
      const dr = Math.exp(-this.drag[i] * dt)
      this.vel[k] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt; this.vel[k + 2] *= dr
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt
      if (this.pos[k + 1] < 0.02) { this.pos[k + 1] = 0.02; this.vel[k + 1] *= -0.3; this.vel[k] *= 0.6; this.vel[k + 2] *= 0.6 }
      this.size[i] += this.grow[i] * dt
      const t = this.age[i] / this.life[i]
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, this.age[i] * 30)
    }
    const g = this.points.geometry
    for (const n of ['position', 'color', 'size', 'alpha']) (g.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true
  }
}

interface PipeView { geo: THREE.BufferGeometry; colors: Float32Array; rings: number; radial: number; index: number }
interface CylView { glow: THREE.Mesh; piston: THREE.Mesh; pos: THREE.Vector3; axis: THREE.Vector3; stroke: number }

const RINGS = 24
const HOLES = 24

export class View {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 600)
  car = new THREE.Group()
  chassis = new THREE.Group()
  body = new Body()
  dummy = new DummyView()
  /** follow the dummy once it is out of the car */
  dummyCam = true
  dummyOrbit = 0
  dummyDir = new THREE.Vector3(0, 0, 1)
  engine = new THREE.Group()
  wheels: THREE.Group[] = []
  pipes: PipeView[] = []
  cyls: CylView[] = []
  tails: THREE.Vector3[] = []
  glowLight = new THREE.PointLight(0xff7a30, 0, 4, 1.6)
  dots: THREE.Points
  ringData = new Float32Array(RINGS * 4)
  holeData = new Float32Array(HOLES * 4)
  worldGroup = new THREE.Group()
  wheelHome: THREE.Vector3[] = []
  ringNext = 0
  ringClock = 0
  time = 0
  propMeshes = new Map<Prop, THREE.Object3D>()
  sparks = new Particles(1500, true)
  smoke = new Particles(1400, false)
  debris: { obj: THREE.Object3D; v: THREE.Vector3; w: THREE.Vector3 }[] = []
  skid: THREE.InstancedMesh
  skidNext = 0
  lastWheel: (THREE.Vector3 | null)[] = [null, null]
  camMode = 0
  camPos = new THREE.Vector3(0, 4, -9)
  camLook = new THREE.Vector3()
  camYaw = 0
  camGround = 0
  orbit = 0
  orbitHold = false
  /** a camera placed by hand (the film's), overriding the modes: where it is, what it looks at, its lens */
  directed: { pos: THREE.Vector3; look: THREE.Vector3; fov: number; ease?: number } | null = null
  orbitDist = 6.5
  /** jump the camera to its place this frame (a cut) */
  snapCamera = false
  shake = 0
  tmpC = new THREE.Color()
  tmpV = new THREE.Vector3()
  spec: EngineSpec | null = null
  onResize: ((w: number, h: number) => void) | null = null

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    this.renderer.setClearColor(0x040506)
    this.scene.fog = new THREE.Fog(0x040506, 40, 190)
    this.scene.add(new THREE.HemisphereLight(0x9aa8bb, 0x050506, 0.9))
    const key = new THREE.DirectionalLight(0xdfe6ef, 1.6)
    key.position.set(30, 60, 20)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x6f86a6, 0.8)
    rim.position.set(-40, 20, -50)
    this.scene.add(rim)
    // ground: a dark plane under the dots
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ color: 0x060708 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.01
    this.scene.add(ground)
    this.dots = this.makeDots()
    this.scene.add(this.dots)
    this.buildWorld(world)
    this.car.add(this.chassis)
    this.chassis.add(this.body.group, this.engine, this.glowLight)
    this.glowLight.position.set(0, 0.8, 1.1)
    this.buildWheels()
    this.scene.add(this.car, this.sparks.points, this.smoke.points, this.dummy.group)
    const sk = new THREE.PlaneGeometry(0.2, 1)
    sk.rotateX(-Math.PI / 2)
    this.skid = new THREE.InstancedMesh(sk, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }), 2400)
    this.skid.count = 0
    this.skid.renderOrder = 1
    this.scene.add(this.skid)
  }

  makeDots() {
    const N = 170, sp = 1.25
    const pos = new Float32Array(N * N * 3)
    let k = 0
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { pos[k++] = (i - N / 2) * sp; pos[k++] = 0.01; pos[k++] = (j - N / 2) * sp }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uCenter: { value: new THREE.Vector2() }, uRings: { value: this.ringData }, uTime: { value: 0 }, uHalf: { value: N * sp / 2 }, uHoles: { value: this.holeData } },
      vertexShader: `uniform vec2 uCenter; uniform float uRings[${RINGS * 4}]; uniform float uTime; uniform float uHalf; uniform float uHoles[${HOLES * 4}]; varying float vH; varying float vF;
        void main(){
          vec3 p = position; p.x += uCenter.x; p.z += uCenter.y;
          float h = 0.0;
          for (int i = 0; i < ${RINGS}; i++) {
            float age = uTime - uRings[i*4+2];
            if (age < 0.0 || age > 3.0) continue;
            float d = distance(p.xz, vec2(uRings[i*4], uRings[i*4+1]));
            float x = (d - age * 6.5) / 0.9;
            h += uRings[i*4+3] * exp(-x*x) * exp(-age * 1.1) / (1.0 + d * 0.08);
          }
          vH = h;
          vF = 1.0 - smoothstep(uHalf * 0.6, uHalf, max(abs(position.x), abs(position.z)));
          for (int i = 0; i < ${HOLES}; i++) {
            if (p.x > uHoles[i*4] && p.x < uHoles[i*4+2] && p.z > uHoles[i*4+1] && p.z < uHoles[i*4+3]) vF = 0.0;
          }
          p.y += h * 0.22;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp((2.2 + h * 3.0) * 70.0 / max(1.0, -mv.z), 1.0, 7.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vH; varying float vF;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          float b = 0.3 + min(1.0, vH) * 0.85;
          vec3 c = mix(vec3(0.55, 0.6, 0.68), vec3(1.0, 0.62, 0.3), min(1.0, vH * 0.9));
          gl_FragColor = vec4(c * b, vF * (0.7 + 0.3 * min(1.0, vH))); }`,
    })
    const p = new THREE.Points(g, m)
    p.frustumCulled = false
    return p
  }

  buildWorld(world: World) {
    this.scene.remove(this.worldGroup)
    this.worldGroup.traverse(o => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose() })
    this.worldGroup = new THREE.Group()
    this.scene.add(this.worldGroup)
    this.propMeshes.clear()
    const conc = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.9, metalness: 0.05 })
    const edge = new THREE.LineBasicMaterial({ color: 0x5c6875, transparent: true, opacity: 0.55 })
    const kerbs = world.blocks.filter(b => b.kind === 'kerb')
    if (kerbs.length) {
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const mats = [new THREE.MeshStandardMaterial({ color: 0x9a2018, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0xb9bdc3, roughness: 0.7 })]
      const sets = [kerbs.filter((_, i) => Math.floor(i / 2) % 2 === 0), kerbs.filter((_, i) => Math.floor(i / 2) % 2 === 1)]
      sets.forEach((set, k) => {
        const im = new THREE.InstancedMesh(geo, mats[k], set.length)
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0)
        set.forEach((b, i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(b.x, b.y0 + b.h / 2, b.z), q.setFromAxisAngle(up, b.yaw), new THREE.Vector3(b.hx * 2, b.h, b.hz * 2))))
        this.worldGroup.add(im)
      })
    }
    if (world.track.path) {
      // edge lines and a dashed centre line painted on the ground
      const path = world.track.path, half = world.track.half
      const edge: number[] = [], dash: number[] = []
      for (let i = 0; i < path.length; i++) {
        const a = path[i], b = path[(i + 1) % path.length], c = path[(i + 2) % path.length]
        const t0 = [b[0] - a[0], b[1] - a[1]], t1 = [c[0] - b[0], c[1] - b[1]]
        const l0 = Math.hypot(t0[0], t0[1]) || 1, l1 = Math.hypot(t1[0], t1[1]) || 1
        const n0 = [t0[1] / l0, -t0[0] / l0], n1 = [t1[1] / l1, -t1[0] / l1]
        for (const s of [half - 0.3, -(half - 0.3)]) edge.push(a[0] + n0[0] * s, 0.02, a[1] + n0[1] * s, b[0] + n1[0] * s, 0.02, b[1] + n1[1] * s)
        if (i % 3 === 0) dash.push(a[0], 0.02, a[1], b[0], 0.02, b[1])
      }
      const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3))
      const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dash, 3))
      this.worldGroup.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xd8dde4, transparent: true, opacity: 0.55 })))
      this.worldGroup.add(new THREE.LineSegments(dg, new THREE.LineBasicMaterial({ color: 0xe8c25a, transparent: true, opacity: 0.5 })))
      const sl = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 0.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8e4dc, transparent: true, opacity: 0.8 }))
      sl.position.set(world.start.x, 0.02, world.start.z)
      sl.rotation.y = world.start.yaw
      this.worldGroup.add(sl)
    }
    if (world.hood) this.buildHood(world)
    for (const b of world.blocks) {
      if (b.kind === 'face' || b.kind === 'kerb' || b.kind === 'house' || b.kind === 'tree' || b.kind === 'parked' || b.kind === 'fence' || b.kind === 'post') continue
      const g = new THREE.BoxGeometry(b.hx * 2, b.h, b.hz * 2)
      const m = new THREE.Mesh(g, conc)
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(g), edge)
      const grp = new THREE.Group()
      grp.add(m, l)
      grp.position.set(b.x, b.y0 + b.h / 2, b.z)
      grp.rotation.y = b.yaw
      this.worldGroup.add(grp)
    }
    this.holeData.fill(0)
    if (world.isCourse) this.buildCourse(world)
    const mk = (geo: THREE.BufferGeometry, color: number, line: number, op = 0.85) => {
      const grp = new THREE.Group()
      grp.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, transparent: op < 1, opacity: op })))
      grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: line, transparent: true, opacity: 0.7 })))
      return grp
    }
    const geos = {
      cone: new THREE.ConeGeometry(0.17, 0.7, 12),
      barrel: new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14, 3),
      crate: new THREE.BoxGeometry(0.9, 0.9, 0.9),
      tyre: new THREE.TorusGeometry(0.25, 0.085, 8, 18).rotateX(Math.PI / 2),
      mailbox: mergeGeometries([new THREE.BoxGeometry(0.08, 0.95, 0.08).translate(0, -0.1, 0), new THREE.BoxGeometry(0.26, 0.24, 0.48).translate(0, 0.45, 0)]),
      bin: new THREE.CylinderGeometry(0.27, 0.24, 1.0, 14, 2),
    }
    for (const p of world.props) {
      const o = p.kind === 'cone' ? mk(geos.cone, 0xb4501c, 0xffa064) : p.kind === 'barrel' ? mk(geos.barrel, 0x4a1818, 0xb85a4a) : p.kind === 'crate' ? mk(geos.crate, 0x3c3122, 0x9a8462)
        : p.kind === 'mailbox' ? mk(geos.mailbox, 0x3a3f46, 0xb9c0c8) : p.kind === 'bin' ? mk(geos.bin, 0x2c3a30, 0x7d9a84) : mk(geos.tyre, 0x101113, 0x5a5f66)
      this.worldGroup.add(o)
      this.propMeshes.set(p, o)
    }
  }

  /** A 1970s suburb: asphalt and painted lines, kerbed lawns and sidewalks, driveways, ranch houses with
   *  gabled roofs and garages, trees, parked cars, fences, streetlights and stop signs. Static parts are merged. */
  buildHood(world: World) {
    const H = world.hood!, K = H.kerb, RW = H.roadHalf
    const [X0, X1, Z0, Z1] = H.bounds
    const add = (o: THREE.Object3D) => { this.worldGroup.add(o); return o }
    const flat = (x0: number, x1: number, z0: number, z1: number, y: number) => new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2)
    // asphalt
    add(new THREE.Mesh(mergeGeometries(H.roads.map(r => flat(r[0], r[1], r[2], r[3], 0.004))), new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.95 })))
    // the raised ground between the streets: one slab per block, lawn on top, a concrete sidewalk ring round it
    const cuts = (list: number[], lo: number, hi: number) => { const out: [number, number][] = []; let a = lo; for (const c of list) { out.push([a, c - RW]); a = c + RW } out.push([a, hi]); return out }
    const lawns: THREE.BufferGeometry[] = [], walks: THREE.BufferGeometry[] = [], kerbs: THREE.BufferGeometry[] = []
    for (const [x0, x1] of cuts(H.xs, X0, X1)) for (const [z0, z1] of cuts(H.zs, Z0, Z1)) {
      if (x1 - x0 < 1 || z1 - z0 < 1) continue
      kerbs.push(new THREE.BoxGeometry(x1 - x0, K, z1 - z0).translate((x0 + x1) / 2, K / 2, (z0 + z1) / 2))
      const W = 1.8
      lawns.push(flat(x0 + W, x1 - W, z0 + W, z1 - W, K + 0.003))
      walks.push(flat(x0, x1, z0, z0 + W, K + 0.004), flat(x0, x1, z1 - W, z1, K + 0.004), flat(x0, x0 + W, z0 + W, z1 - W, K + 0.004), flat(x1 - W, x1, z0 + W, z1 - W, K + 0.004))
    }
    add(new THREE.Mesh(mergeGeometries(kerbs), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.9 })))
    add(new THREE.Mesh(mergeGeometries(lawns), new THREE.MeshStandardMaterial({ color: 0x1d2a1c, roughness: 1 })))
    add(new THREE.Mesh(mergeGeometries(walks), new THREE.MeshStandardMaterial({ color: 0x4a4c50, roughness: 0.95 })))
    add(new THREE.Mesh(mergeGeometries(H.drives.map(d => flat(d.x0, d.x1, d.z0, d.z1, K + 0.006))), new THREE.MeshStandardMaterial({ color: 0x3e4044, roughness: 0.95 })))
    // painted lines: a dashed yellow middle, stop bars before each crossing
    const paint: number[] = []
    for (const x of H.xs) for (let z = Z0; z < Z1; z += 6) if (!H.zs.some(c => Math.abs(z + 1.5 - c) < RW + 1)) paint.push(x, 0.01, z, x, 0.01, z + 3)
    for (const z of H.zs) for (let x = X0; x < X1; x += 6) if (!H.xs.some(c => Math.abs(x + 1.5 - c) < RW + 1)) paint.push(x, 0.01, z, x + 3, 0.01, z)
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(paint, 3))
    add(new THREE.LineSegments(pg, new THREE.LineBasicMaterial({ color: 0xd9b23a, transparent: true, opacity: 0.8 })))
    // speed bumps, painted
    for (const b of H.bumps) add(new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, b.h, b.len * 0.6).translate((b.x0 + b.x1) / 2, b.h / 2, b.z), new THREE.MeshStandardMaterial({ color: 0x8a7a2a, roughness: 0.8 })))
    // houses: walls coloured per house, a gabled roof, the outline, windows, a door, the garage door
    const walls: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [], lines: number[] = []
    const seg = (a: number[], b: number[]) => lines.push(a[0], a[1], a[2], b[0], b[1], b[2])
    const colorBox = (g: THREE.BufferGeometry, hex: string) => {
      const c = new THREE.Color(hex), n = g.getAttribute('position').count, arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3)
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      return g
    }
    const gable = (cx: number, cz: number, wx: number, wz: number, y0: number, rise: number, alongZ: boolean) => {
      // a ridge running along z (or x), eaves out 0.4 m
      const ex = wx / 2 + 0.4, ez = wz / 2 + 0.4
      const v = alongZ
        ? [[-ex, 0, -ez], [ex, 0, -ez], [0, rise, -ez], [-ex, 0, ez], [ex, 0, ez], [0, rise, ez]]
        : [[-ex, 0, -ez], [-ex, 0, ez], [-ex, rise, 0], [ex, 0, -ez], [ex, 0, ez], [ex, rise, 0]]
      const idx = alongZ ? [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4] : [0, 1, 2, 3, 5, 4, 0, 2, 5, 0, 5, 3, 1, 4, 5, 1, 5, 2]
      const pos: number[] = []
      for (const i of idx) pos.push(cx + v[i][0], y0 + v[i][1], cz + v[i][2])
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals()
      const r = v.map(p => [cx + p[0], y0 + p[1], cz + p[2]])
      if (alongZ) { seg(r[2], r[5]); seg(r[0], r[2]); seg(r[2], r[1]); seg(r[3], r[5]); seg(r[5], r[4]); seg(r[0], r[3]); seg(r[1], r[4]) }
      else { seg(r[2], r[5]); seg(r[0], r[2]); seg(r[2], r[1]); seg(r[3], r[5]); seg(r[5], r[4]); seg(r[0], r[3]); seg(r[1], r[4]) }
      return g
    }
    const boxLines = (cx: number, cz: number, hx: number, hz: number, y0: number, h: number) => {
      const c = [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]]
      for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; seg([a[0], y0, a[1]], [b[0], y0, b[1]]); seg([a[0], y0 + h, a[1]], [b[0], y0 + h, b[1]]); seg([a[0], y0, a[1]], [a[0], y0 + h, a[1]]) }
    }
    for (const h of H.houses) {
      const hx = h.w / 2, hz = h.d / 2, fx = h.x - h.side * hx
      walls.push(colorBox(new THREE.BoxGeometry(h.w, 2.8, h.d).translate(h.x, K + 1.4, h.z), h.color))
      roofs.push(gable(h.x, h.z, h.w, h.d, K + 2.8, 1.5, true))
      boxLines(h.x, h.z, hx, hz, K, 2.8)
      // garage: same colour, its own lower roof, a big door facing the street
      const gx = fx + h.side * 3.5, gz = h.z + h.garage * (hz + 3.2)
      walls.push(colorBox(new THREE.BoxGeometry(7, 2.6, 6).translate(gx, K + 1.3, gz), h.color))
      roofs.push(gable(gx, gz, 7, 6, K + 2.6, 1.1, false))
      boxLines(gx, gz, 3.5, 3, K, 2.6)
      const gdx = gx - h.side * 3.5 - h.side * 0.02
      for (let k = 0; k <= 4; k++) seg([gdx, K + 0.05 + k * 0.5, gz - 2.3], [gdx, K + 0.05 + k * 0.5, gz + 2.3])
      seg([gdx, K, gz - 2.3], [gdx, K + 2.05, gz - 2.3]); seg([gdx, K, gz + 2.3], [gdx, K + 2.05, gz + 2.3])
      // the front: a door and two windows
      const wx = fx - h.side * 0.02
      const rect = (z0: number, z1: number, y0: number, y1: number) => { seg([wx, y0, z0], [wx, y0, z1]); seg([wx, y1, z0], [wx, y1, z1]); seg([wx, y0, z0], [wx, y1, z0]); seg([wx, y0, z1], [wx, y1, z1]) }
      rect(h.z - 0.5, h.z + 0.5, K, K + 2.05)
      rect(h.z - hz + 1, h.z - hz + 3, K + 1.0, K + 2.1)
      rect(h.z + hz - 3, h.z + hz - 1, K + 1.0, K + 2.1)
    }
    const wallMesh = new THREE.Mesh(mergeGeometries(walls), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }))
    add(wallMesh)
    add(new THREE.Mesh(mergeGeometries(roofs), new THREE.MeshStandardMaterial({ color: 0x2b2522, roughness: 0.9, side: THREE.DoubleSide })))
    // parked cars: a body and a cabin
    const cars: THREE.BufferGeometry[] = []
    for (const c of H.parked) {
      const y0 = world.height(c.x, c.z)
      const g = mergeGeometries([new THREE.BoxGeometry(1.75, 0.7, 4.3).translate(0, 0.55, 0), new THREE.BoxGeometry(1.5, 0.5, 2.1).translate(0, 1.15, -0.2)])
      g.rotateY(c.yaw).translate(c.x, y0, c.z)
      cars.push(colorBox(g, c.color))
      const r = (lx: number, lz: number, y: number) => { const s2 = Math.sin(c.yaw), c2 = Math.cos(c.yaw); return [c.x + lx * c2 + lz * s2, y0 + y, c.z - lx * s2 + lz * c2] }
      for (const [a, b] of [[[0.88, 2.15], [-0.88, 2.15]], [[-0.88, 2.15], [-0.88, -2.15]], [[-0.88, -2.15], [0.88, -2.15]], [[0.88, -2.15], [0.88, 2.15]]]) { seg(r(a[0], a[1], 0.9), r(b[0], b[1], 0.9)); seg(r(a[0], a[1], 0.2), r(b[0], b[1], 0.2)) }
      for (const [a, b] of [[[0.75, 0.85], [-0.75, 0.85]], [[-0.75, 0.85], [-0.75, -1.25]], [[-0.75, -1.25], [0.75, -1.25]], [[0.75, -1.25], [0.75, 0.85]]]) seg(r(a[0], a[1], 1.4), r(b[0], b[1], 1.4))
    }
    if (cars.length) add(new THREE.Mesh(mergeGeometries(cars), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.5 })))
    // fences
    for (const b of world.blocks) if (b.kind === 'fence') { boxLines(b.x, b.z, b.hx, b.hz, b.y0, b.h); for (let z = b.z - b.hz; z <= b.z + b.hz; z += 2) seg([b.x, b.y0, z], [b.x, b.y0 + b.h, z]) }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
    add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xb8bfc8, transparent: true, opacity: 0.45 })))
    // trees: a trunk and a low-poly crown, instanced
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 1, 7), new THREE.MeshStandardMaterial({ color: 0x3a2c22 }), H.trees.length)
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x24402a, roughness: 1, flatShading: true }), H.trees.length)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion()
    H.trees.forEach(([x, z, r, h], i) => {
      trunk.setMatrixAt(i, m.compose(new THREE.Vector3(x, K + h * 0.3, z), q, new THREE.Vector3(1, h * 0.6, 1)))
      crown.setMatrixAt(i, m.compose(new THREE.Vector3(x, K + h * 0.6 + r * 0.5, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i), new THREE.Vector3(r, r * 0.85, r)))
      q.identity()
    })
    add(trunk); add(crown)
    // streetlights (a pole and a warm lamp) and stop signs
    for (const [x, z] of H.lamps) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 6, 6).translate(x, K + 3, z), new THREE.MeshStandardMaterial({ color: 0x55595e })))
      add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8).translate(x, K + 6, z), new THREE.MeshBasicMaterial({ color: 0xffc56a })))
    }
    for (const [x, z] of H.signs) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 5).translate(x, K + 1.1, z), new THREE.MeshStandardMaterial({ color: 0x8c9096 })))
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.03, 8).rotateX(Math.PI / 2).translate(x, K + 2.25, z), new THREE.MeshBasicMaterial({ color: 0xa8261c })))
    }
    // a warmer, dimmer night light for the streets
    const warm = new THREE.HemisphereLight(0xffd9a8, 0x101010, 0.35)
    add(warm)
  }

  /** The shaped ground of a course as lit slabs with a 1 m grid, plus start and finish lines. */
  buildCourse(world: World) {
    const half = world.track.half
    const slab = new THREE.MeshStandardMaterial({ color: 0x171b21, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide, flatShading: true })
    const grid = new THREE.LineBasicMaterial({ color: 0x6b7887, transparent: true, opacity: 0.45 })
    // merge overlapping feature spans into stretches of ground to draw
    const spans = world.spans.map(([a, b]) => [a - 1.2, b + 1.2]).sort((a, b) => a[0] - b[0])
    const runs: number[][] = []
    for (const sp of spans) { const last = runs[runs.length - 1]; if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]); else runs.push([...sp]) }
    let hole = 0
    for (const [z0, z1] of runs) {
      const dz = 0.12, dx = 0.35
      const nz = Math.ceil((z1 - z0) / dz), nx = Math.ceil(half * 2 / dx)
      const pos: number[] = []
      for (let i = 0; i <= nz; i++) for (let j = 0; j <= nx; j++) {
        const x = -half + j * (half * 2 / nx), z = z0 + i * (z1 - z0) / nz
        pos.push(x, world.height(x, z) + 0.005, z)
      }
      const idx: number[] = [], lines: number[] = []
      const at = (i: number, j: number) => i * (nx + 1) + j
      for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1))
      const zEvery = Math.round(1 / dz), xEvery = Math.round(1 / dx)
      for (let i = 0; i <= nz; i++) for (let j = 0; j < nx; j++) if (i % zEvery === 0 || i === nz) lines.push(at(i, j), at(i, j + 1))
      for (let j = 0; j <= nx; j++) for (let i = 0; i < nz; i++) if (j % xEvery === 0 || j === nx) lines.push(at(i, j), at(i + 1, j))
      const g = new THREE.BufferGeometry()
      const attr = new THREE.Float32BufferAttribute(pos, 3)
      g.setAttribute('position', attr)
      g.setIndex(idx)
      g.computeVertexNormals()
      const lg = new THREE.BufferGeometry()
      lg.setAttribute('position', attr)
      lg.setIndex(lines)
      this.worldGroup.add(new THREE.Mesh(g, slab), new THREE.LineSegments(lg, grid))
      // the dots should not float over places where the ground falls away
      let low = false
      for (let i = 0; i <= nz && !low; i++) for (let j = 0; j <= nx; j++) if (pos[at(i, j) * 3 + 1] < -0.02) { low = true; break }
      if (low && hole < HOLES) { this.holeData.set([-half - 0.2, z0, half + 0.2, z1], hole * 4); hole++ }
    }
    const line = (z: number, color: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 0.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }))
      m.position.set(0, world.height(0, z) + 0.02, z)
      this.worldGroup.add(m)
    }
    line(world.start.z + 3, 0xe8e4dc)
    const fin = world.track.marks.find(m => m.label === 'finish')
    if (fin) for (let k = 0; k < 2; k++) line(fin.z + k * 0.8, k ? 0x111111 : 0xe8e4dc)
    // a tick on the barrier every 25 m, and a brighter one every 100
    const tick = new THREE.LineBasicMaterial({ color: 0xa8b4c2, transparent: true, opacity: 0.6 })
    const tp: number[] = []
    for (let z = 0; z <= world.track.length; z += 25) {
      const t = z % 100 === 0 ? 1.4 : 1.1
      for (const sx of [1, -1]) tp.push(sx * (half + 0.2), 0, z, sx * (half + 0.2), t, z)
    }
    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3))
    this.worldGroup.add(new THREE.LineSegments(tg, tick))
  }

  /** Build the car to a setup: its body and its wheels. */
  setCar(s: CarSetup) {
    this.body.group.removeFromParent()
    this.body = new Body(s.shape)
    this.chassis.add(this.body.group)
    for (const w of this.wheels) w.removeFromParent()
    this.debris = this.debris.filter(d => !this.wheels.includes(d.obj as THREE.Group))
    this.wheels = []
    this.wheelHome = []
    this.buildWheels(s.Rw, s.track, s.axleF, s.axleR, s.id === 'pinto' ? 0.18 : 0.24)
  }

  buildWheels(R = 0.33, track = 0.79, zf = 1.33, zr = -1.27, width = 0.24) {
    const tyre = new THREE.CylinderGeometry(R, R, width, 20, 1, true).rotateZ(Math.PI / 2)
    const mat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
    const line = new THREE.LineBasicMaterial({ color: 0xa8b2be, transparent: true, opacity: 0.6 })
    for (const [x, z] of [[track, zf], [-track, zf], [track, zr], [-track, zr]]) {
      const steer = new THREE.Group()
      steer.position.set(x, -0.22, z)
      this.wheelHome.push(steer.position.clone())
      const spin = new THREE.Group()
      spin.add(new THREE.Mesh(tyre, mat))
      const pts: number[] = []
      for (let k = 0; k < 20; k++) {
        const a = k / 20 * Math.PI * 2, b = (k + 1) / 20 * Math.PI * 2
        for (const s of [-width / 2, width / 2]) pts.push(s, Math.cos(a) * R, Math.sin(a) * R, s, Math.cos(b) * R, Math.sin(b) * R)
        pts.push(x > 0 ? width * 0.45 : -width * 0.45, Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, x > 0 ? width * 0.45 : -width * 0.45, Math.cos(b) * R * 0.6, Math.sin(b) * R * 0.6)
      }
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; const sx = x > 0 ? width * 0.45 : -width * 0.45; pts.push(sx, 0, 0, sx, Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6) }
      const lg = new THREE.BufferGeometry()
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      spin.add(new THREE.LineSegments(lg, line))
      steer.add(spin)
      this.car.add(steer)
      this.wheels.push(steer)
    }
  }

  setEngine(spec: EngineSpec) {
    this.spec = spec
    for (const c of [...this.engine.children]) { this.engine.remove(c); c.traverse(o => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose() }) }
    this.pipes = []
    this.cyls = []
    const metal = new THREE.MeshStandardMaterial({ color: 0x5c636c, metalness: 0.85, roughness: 0.35, transparent: true, opacity: 0.55 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.8, roughness: 0.5, transparent: true, opacity: 0.5 })
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x8a96a4, transparent: true, opacity: 0.4 })
    const bore = spec.bore
    const strokeV = spec.stroke * 0.9
    // crankcase under the cylinders
    const xs = spec.layout.map(c => c.pos[0]), zs = spec.layout.map(c => c.pos[2]), ys = spec.layout.map(c => c.pos[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
    const len = Math.max(...zs) - Math.min(...zs) + bore * 1.6
    const wid = Math.max(0.28, Math.max(...xs) - Math.min(...xs) + 0.12)
    const caseGeo = new THREE.BoxGeometry(wid * 0.8, 0.22, len)
    const crank = new THREE.Mesh(caseGeo, dark)
    crank.position.set(cx, Math.min(...ys) - 0.13, cz)
    this.engine.add(crank, new THREE.LineSegments(new THREE.EdgesGeometry(caseGeo), edgeMat).translateX(cx).translateY(Math.min(...ys) - 0.13).translateZ(cz))
    for (const c of spec.layout) {
      const axis = new THREE.Vector3(...c.axis).normalize()
      const pos = new THREE.Vector3(...c.pos)
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)
      const barrelGeo = new THREE.CylinderGeometry(bore * 0.62, bore * 0.62, strokeV + 0.08, 14, 1, true)
      const barrel = new THREE.Mesh(barrelGeo, metal)
      barrel.position.copy(pos).addScaledVector(axis, 0.02)
      barrel.quaternion.copy(q)
      const bl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(bore * 0.62, bore * 0.62, strokeV + 0.08, 10, 1)), edgeMat)
      bl.position.copy(barrel.position); bl.quaternion.copy(q)
      const headGeo = new THREE.BoxGeometry(bore * 1.3, 0.06, bore * 1.2)
      const head = new THREE.Mesh(headGeo, dark)
      head.position.copy(pos).addScaledVector(axis, strokeV / 2 + 0.09)
      head.quaternion.copy(q)
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(bore * 0.5, bore * 0.5, 0.02, 14), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }))
      glow.quaternion.copy(q)
      const piston = new THREE.Mesh(new THREE.CylinderGeometry(bore * 0.5, bore * 0.5, 0.045, 14), new THREE.MeshStandardMaterial({ color: 0xb8c0ca, metalness: 0.9, roughness: 0.25 }))
      piston.quaternion.copy(q)
      this.engine.add(barrel, bl, head, glow, piston)
      this.cyls.push({ glow, piston, pos, axis, stroke: strokeV })
    }
    this.fan = null
    if (spec.looks === 'lima') this.limaParts(spec, len, cz, dark, edgeMat)
    // plenum
    const pl = new THREE.BoxGeometry(0.22, 0.12, Math.max(0.3, len * 0.8))
    const plm = new THREE.Mesh(pl, spec.looks === 'lima' ? this.fordBlue() : dark)
    plm.position.set(...spec.plenumPos)
    this.engine.add(plm, new THREE.LineSegments(new THREE.EdgesGeometry(pl), edgeMat).translateX(spec.plenumPos[0]).translateY(spec.plenumPos[1]).translateZ(spec.plenumPos[2]))
    // pipes
    spec.net.pipes.forEach((p, index) => {
      const pts = p.path.map(v => new THREE.Vector3(...v))
      const curve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal') : new THREE.LineCurve3(pts[0], pts[1])
      const rings = p.kind === 'header' || p.kind === 'runner' ? 20 : 14
      const radial = 8
      const r = p.kind === 'muffler' ? p.d * 0.5 : Math.max(0.017, p.d * 0.5)
      const geo = new THREE.TubeGeometry(curve, rings, r, radial, false)
      const colors = new Float32Array(geo.getAttribute('position').count * 3)
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }))
      this.engine.add(mesh)
      this.pipes.push({ geo, colors, rings, radial, index })
    })
    this.tails = spec.net.opens.map(o => { const path = spec.net.pipes[o.pipe].path; return new THREE.Vector3(...path[path.length - 1]) })
  }

  fan: THREE.Group | null = null
  fordBlue() { return new THREE.MeshStandardMaterial({ color: 0x2f4f8f, metalness: 0.5, roughness: 0.5, transparent: true, opacity: 0.6 }) }

  /** The Ford 2.3's visible parts: blue iron, a long cam cover, the timing-belt cover at the front, the
   *  two-barrel carburettor under a round pancake air cleaner, a radiator and a belt-driven fan. */
  limaParts(spec: EngineSpec, len: number, cz: number, dark: THREE.Material, edgeMat: THREE.LineBasicMaterial) {
    const blue = this.fordBlue()
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z)
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat); e.position.copy(m.position)
      this.engine.add(m, e)
      return m
    }
    const headTop = Math.max(...spec.layout.map(c => c.pos[1])) + spec.stroke * 0.45 + 0.12
    // the cam cover along the head, and the block below it in Ford blue
    add(new THREE.BoxGeometry(0.2, 0.08, len * 0.95), blue, 0, headTop + 0.04, cz)
    add(new THREE.BoxGeometry(0.3, 0.3, len), blue, 0, 0.38, cz)
    // timing-belt cover on the front face
    const front = cz + len / 2 + 0.03
    add(new THREE.BoxGeometry(0.22, 0.36, 0.05), dark, 0, 0.56, front)
    // carburettor on the intake manifold, the round air cleaner on top
    const [px, py, pz] = spec.plenumPos
    add(new THREE.BoxGeometry(0.12, 0.08, 0.12), dark, px - 0.06, py + 0.1, pz)
    add(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 24), blue, px - 0.08, py + 0.175, pz)
    // radiator across the nose, and the fan in front of the engine (turned by the belt with the crank)
    add(new THREE.BoxGeometry(0.62, 0.42, 0.05), dark, 0, 0.55, front + 0.42)
    const fan = new THREE.Group()
    fan.position.set(0, 0.5, front + 0.2)
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.6, roughness: 0.5, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    for (let k = 0; k < 4; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.01), bladeMat)
      blade.position.set(Math.sin(k * Math.PI / 2) * 0.1, Math.cos(k * Math.PI / 2) * 0.1, 0)
      blade.rotation.z = -k * Math.PI / 2
      blade.rotation.y = 0.35
      fan.add(blade)
    }
    fan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12).rotateX(Math.PI / 2), dark))
    this.engine.add(fan)
    this.fan = fan
  }

  /** Mark a muffler as torn away: hide its tube. */
  dropMuffler(on: boolean) {
    if (!this.spec) return
    this.pipes.forEach(p => {
      const kind = this.spec!.net.pipes[p.index].kind
      if (kind === 'muffler' || kind === 'tail') {
        const mesh = this.engine.children.find(c => (c as THREE.Mesh).geometry === p.geo)
        if (mesh) mesh.visible = on
      }
    })
  }

  addRing(x: number, z: number, amp: number) {
    const i = this.ringNext
    this.ringNext = (this.ringNext + 1) % RINGS
    this.ringData.set([x, z, this.time, amp], i * 4)
  }

  detachPanel(ids: (PanelId | GlassId)[], car: Car, nx: number, nz: number, speed: number) {
    for (const id of ids) for (const p of this.body.find(id)) {
      p.off = true
      const obj = p.group
      obj.updateWorldMatrix(true, false)
      const m = obj.matrixWorld.clone()
      obj.removeFromParent()
      this.scene.add(obj)
      m.decompose(obj.position, obj.quaternion, obj.scale)
      const [vx, vz] = car.pointVel(0, 0)
      const out = new THREE.Vector3(-nx, 0, -nz).applyAxisAngle(new THREE.Vector3(0, 1, 0), car.yaw)
      const v = new THREE.Vector3(vx, 0, vz).multiplyScalar(0.55).addScaledVector(out, speed * 0.25).add(new THREE.Vector3(0, 2 + speed * 0.18, 0))
      const w = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4 + speed * 0.4)
      this.debris.push({ obj, v, w })
      if (this.debris.length > 40) { const d = this.debris.shift()!; d.obj.removeFromParent() }
    }
  }

  shatter(id: GlassId, car: Car) {
    for (const p of this.body.find(id)) {
      p.off = true
      p.group.visible = false
      const a = p.geo.getAttribute('position') as THREE.BufferAttribute
      const v = new THREE.Vector3()
      const [cvx, cvz] = car.pointVel(0, 0)
      for (let i = 0; i < a.count; i += 2) {
        v.fromBufferAttribute(a, i)
        p.group.localToWorld(v)
        this.car.updateWorldMatrix(true, true)
        const w = v.clone()
        this.smoke.emit(w, new THREE.Vector3(cvx * 0.7 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, cvz * 0.7 + (Math.random() - 0.5) * 3), this.tmpC.setRGB(0.75, 0.88, 1), 0.07, 1.6 + Math.random(), 0.9, { grav: 9, drag: 0.6 })
      }
    }
  }

  /** A wheel breaks away and rolls off. */
  loseWheel(i: number, car: Car) {
    const w = this.wheels[i]
    if (w.parent !== this.car) return
    w.updateWorldMatrix(true, true)
    const m = w.matrixWorld.clone()
    w.removeFromParent()
    this.scene.add(w)
    m.decompose(w.position, w.quaternion, w.scale)
    const side = new THREE.Vector3(i % 2 === 0 ? 1 : -1, 0, 0).applyQuaternion(this.car.quaternion)
    const v = new THREE.Vector3(car.vel[0], car.vel[1] + 2, car.vel[2]).addScaledVector(side, 3)
    const spinAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.car.quaternion)
    this.debris.push({ obj: w, v, w: spinAxis.multiplyScalar(car.speed / car.Rw * 0.6).add(new THREE.Vector3(0, (Math.random() - 0.5) * 4, 0)) })
  }

  repair() {
    this.wheels.forEach((w, i) => {
      this.debris = this.debris.filter(d => d.obj !== w)
      if (w.parent !== this.car) { w.removeFromParent(); this.car.add(w) }
      w.position.copy(this.wheelHome[i]); w.quaternion.identity(); w.scale.set(1, 1, 1)
    })
    this.body.repair()
    for (const d of this.debris) d.obj.removeFromParent()
    this.debris = []
    this.dropMuffler(true)
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    ;(this.sparks.points.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.9
    ;(this.smoke.points.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.9
    this.onResize?.(w, h)
  }

  update(dt: number, car: Car, world: World, snap: Float32Array | null, loud: number, throttle: number, extra: { fuelCut: boolean; rpm: number; redline: number; engineHealth: number; radiator: number; dead: boolean }, dummy: Dummy) {
    this.dummy.update(dummy)
    this.time += dt
    const spec = this.spec!
    // car pose with a little body motion from the accelerations
    this.car.position.set(car.x, car.y, car.z)
    this.car.quaternion.set(car.q[0], car.q[1], car.q[2], car.q[3])
    this.chassis.position.y = -car.rideHeight + Math.sin(this.time * (8 + extra.rpm / 400)) * 0.0015 * (extra.rpm / 1000)
    this.wheels.forEach((w, i) => {
      const wh = car.wheels[i]
      if (wh.lost) return
      w.position.set(wh.lx, -0.05 - wh.len, wh.lz)
      w.rotation.y = (i < 2 ? car.steerAngle : 0) + wh.bend
      w.rotation.z = wh.bend * 1.6 * (i % 2 === 0 ? 1 : -1)
      ;(w.children[0] as THREE.Group).rotation.x = i < 2 ? car.spinF : car.spinR
    })
    // engine from the snapshot
    const n = spec.layout.length
    if (snap && snap.length >= n * 3 + spec.net.pipes.length * SNAP_POINTS) {
      for (let i = 0; i < n; i++) {
        const c = this.cyls[i]
        const piston = snap[i], p = snap[n + i], burn = snap[2 * n + i]
        c.piston.position.copy(c.pos).addScaledVector(c.axis, c.stroke / 2 - piston * c.stroke + 0.02)
        const glowMat = c.glow.material as THREE.MeshBasicMaterial
        const heat = Math.min(1, Math.max(0, (p - 101325) / 4.5e6))
        glowMat.color.setRGB(Math.min(1, heat * 1.5 + burn * 0.4), heat * 0.6 + burn * 0.15, heat * 0.15)
        c.glow.position.copy(c.pos).addScaledVector(c.axis, c.stroke / 2 - piston * c.stroke * 0.5 + 0.04)
        c.glow.scale.set(1, 1 + piston * 20, 1)
      }
      const base = n * 3
      for (const pv of this.pipes) {
        const off = base + pv.index * SNAP_POINTS
        const ringVerts = pv.radial + 1
        for (let r = 0; r <= pv.rings; r++) {
          const f = r / pv.rings * (SNAP_POINTS - 1)
          const i0 = Math.floor(f), i1 = Math.min(SNAP_POINTS - 1, i0 + 1)
          const dp = snap[off + i0] + (snap[off + i1] - snap[off + i0]) * (f - i0)
          pressureColor(dp, this.tmpC)
          for (let k = 0; k < ringVerts; k++) {
            const vi = (r * ringVerts + k) * 3
            pv.colors[vi] = this.tmpC.r; pv.colors[vi + 1] = this.tmpC.g; pv.colors[vi + 2] = this.tmpC.b
          }
        }
        ;(pv.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
      }
    }
    if (this.fan) this.fan.rotation.z += extra.rpm / 60 * 2 * Math.PI * dt * 0.97
    this.glowLight.intensity = (0.6 + throttle * 3.5) * Math.min(1, loud * 4) * (extra.dead ? 0 : 1)

    // sound on the floor: rings from each tailpipe, at a rate that rises with engine speed
    this.car.updateWorldMatrix(true, true)
    this.ringClock += dt * (0.9 + extra.rpm / 2600)
    if (this.ringClock > 1 && loud > 0.005) {
      this.ringClock = 0
      for (const t of this.tails) {
        const w = this.tmpV.copy(t).applyMatrix4(this.chassis.matrixWorld)
        this.addRing(w.x, w.z, Math.min(2.5, loud * 9 + throttle * 0.5) / Math.sqrt(this.tails.length))
      }
    }
    const u = (this.dots.material as THREE.ShaderMaterial).uniforms
    u.uTime.value = this.time
    u.uCenter.value.set(Math.round(car.x / 1.25) * 1.25, Math.round(car.z / 1.25) * 1.25)

    // exhaust: puffs, and flames when fuel was cut at speed
    for (const t of this.tails) {
      const w = t.clone().applyMatrix4(this.chassis.matrixWorld)
      const back = new THREE.Vector3(0, 0.05, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), car.yaw)
      const [cvx, cvz] = car.pointVel(0, -2.2)
      if (Math.random() < 0.15 + loud * 2) {
        const v = back.clone().multiplyScalar(1 + loud * 20).add(new THREE.Vector3(cvx * 0.8, 0.3, cvz * 0.8))
        this.smoke.emit(w, v, this.tmpC.setRGB(0.42, 0.44, 0.48), 0.12, 0.9, 0.12 + loud * 0.6, { grow: 0.6, drag: 1.5, grav: -0.4 })
      }
      if (extra.fuelCut && !extra.dead && extra.rpm > 3000 && Math.random() < (extra.rpm > extra.redline - 100 ? 0.5 : 0.07)) {
        for (let k = 0; k < 6; k++) {
          const v = back.clone().multiplyScalar(4 + Math.random() * 5).add(new THREE.Vector3(cvx + (Math.random() - 0.5), Math.random() * 0.6, cvz + (Math.random() - 0.5)))
          this.sparks.emit(w, v, this.tmpC.setRGB(1, 0.42 + Math.random() * 0.3, 0.12), 0.16 + Math.random() * 0.12, 0.08 + Math.random() * 0.08, 1, { drag: 4 })
        }
      }
    }
    // tyre smoke and skid marks from the rear wheels
    for (let i = 0; i < 2; i++) {
      const wh = car.wheels[2 + i]
      const wl = new THREE.Vector3(wh.pc[0], wh.pc[1] + 0.015, wh.pc[2])
      // with an open diff each wheel smokes for its own spin (one-wheel peel), or when the car slides sideways
      const wj = car.ww + (i === 0 ? car.wd : -car.wd)
      const amount = car.openDiff
        ? Math.max(Math.abs(wj * car.Rw - car.u) > 2 ? Math.min(1, Math.abs(wj * car.Rw - car.u) / 12) : 0, Math.min(1, Math.max(0, (Math.abs(car.v) - 1.5) / 4)) * 0.8)
        : Math.max(car.burnout, car.slipRear * 0.8)
      if (amount > 0.25 && wh.contact) {
        if (Math.random() < amount * 0.9) this.smoke.emit(wl.clone().setY(0.25), new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5), this.tmpC.setRGB(0.78, 0.8, 0.84), 0.45, 2.2, 0.16 * amount, { grow: 1.6, drag: 1.2, grav: -0.25 })
        const last = this.lastWheel[i]
        if (last && last.distanceTo(wl) > 0.15) {
          const mid = last.clone().add(wl).multiplyScalar(0.5)
          const m = new THREE.Matrix4().lookAt(last, wl, new THREE.Vector3(0, 1, 0))
          const q = new THREE.Quaternion().setFromRotationMatrix(m)
          m.compose(mid, q, new THREE.Vector3(1, 1, last.distanceTo(wl)))
          this.skid.setMatrixAt(this.skidNext, m)
          this.skidNext = (this.skidNext + 1) % 2400
          this.skid.count = Math.max(this.skid.count, this.skidNext)
          this.skid.instanceMatrix.needsUpdate = true
          this.lastWheel[i] = wl
        } else if (!last) this.lastWheel[i] = wl
      } else this.lastWheel[i] = null
    }
    // a wounded engine smokes; a dead one smokes black
    if (extra.radiator < 0.7 || extra.engineHealth < 0.6) {
      const hood = new THREE.Vector3(0, 0.95, 1.4).applyMatrix4(this.chassis.matrixWorld)
      const rate = (1 - Math.min(extra.radiator, extra.engineHealth + 0.2)) * 0.35
      if (Math.random() < rate) {
        const dark = extra.engineHealth < 0.3
        this.smoke.emit(hood, new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6), dark ? this.tmpC.setRGB(0.12, 0.12, 0.13) : this.tmpC.setRGB(0.85, 0.87, 0.9), 0.3, 1.8, dark ? 0.35 : 0.12, { grow: 0.9, drag: 0.8, grav: -0.3 })
      }
    }

    // loose things
    for (const [p, o] of this.propMeshes) {
      o.position.set(p.x, p.y, p.z)
      o.quaternion.set(p.q[0], p.q[1], p.q[2], p.q[3])
    }
    // debris
    for (const d of this.debris) {
      d.v.y -= 9.81 * dt
      d.obj.position.addScaledVector(d.v, dt)
      const gy = world.height(d.obj.position.x, d.obj.position.z) + 0.05
      if (d.obj.position.y < gy) {
        d.obj.position.y = gy
        if (d.v.y < -1) d.v.y *= -0.25; else d.v.y = 0
        d.v.x *= Math.exp(-dt * 3); d.v.z *= Math.exp(-dt * 3); d.w.multiplyScalar(Math.exp(-dt * 4))
      }
      const wl = d.w.length()
      if (wl > 1e-3) d.obj.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(d.w.clone().divideScalar(wl), wl * dt))
    }
    this.sparks.update(dt)
    this.smoke.update(dt)

    // camera
    const speed = car.speed
    const moveYaw = speed > 2 && car.u < -1 ? car.yaw + Math.PI : car.yaw
    let dy = moveYaw - this.camYaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    this.camYaw += dy * Math.min(1, dt * 3.2)
    const fwd = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw))
    const carPos = new THREE.Vector3(car.x, car.y - car.rideHeight, car.z)
    this.camGround += (world.height(car.x, car.z) - this.camGround) * Math.min(1, dt * 2)
    const groundPos = new THREE.Vector3(car.x, this.camGround, car.z)
    const local = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(this.chassis.matrixWorld)
    let want: THREE.Vector3, look: THREE.Vector3, fov = 58, snapCam = false
    if (this.camMode === 0) {
      const back = 6.6 + speed * 0.04
      want = carPos.clone().addScaledVector(fwd, -back).add(new THREE.Vector3(0, 2.3 + speed * 0.012, 0))
      want.y = Math.max(want.y, world.height(want.x, want.z) + 1.2)
      look = carPos.clone().addScaledVector(fwd, 2.5).add(new THREE.Vector3(0, 0.8, 0))
      fov = 58 + Math.min(14, speed * 0.25)
    } else if (this.camMode === 1) {
      // trackside: a tripod beside the course that pans and tracks along with the car
      if (world.isCourse) want = new THREE.Vector3(world.track.half + 3.5, this.camGround + 1.9, car.z - 2.5)
      else want = carPos.clone().add(new THREE.Vector3(Math.cos(this.camYaw + 0.6), 0, -Math.sin(this.camYaw + 0.6)).multiplyScalar(6.5)).add(new THREE.Vector3(0, 2.8, 0))
      look = carPos.clone().add(new THREE.Vector3(0, 0.9, 0))
      fov = 46
    } else if (this.camMode === 2) {
      // beside the front wheel, looking across the engine bay
      want = local(2.6, 1.5, 2.4)
      look = local(0, 0.55, 0.6)
      fov = 50
    } else if (this.camMode === 3) {
      want = local(0, 1.5, 0.45)
      look = local(0, 0.85, 10)
      fov = 70
      snapCam = true
    } else if (this.camMode === 5) {
      // round the car, for looking at it
      if (!this.orbitHold) this.orbit += dt * 0.3
      const a = car.yaw + this.orbit
      want = carPos.clone().add(new THREE.Vector3(Math.sin(a) * this.orbitDist, 1.25, Math.cos(a) * this.orbitDist))
      look = carPos.clone().add(new THREE.Vector3(0, 0.62, 0))
      fov = 40
    } else {
      want = groundPos.clone().add(new THREE.Vector3(0, 30, 0)).addScaledVector(fwd, -8)
      look = groundPos.clone().addScaledVector(fwd, 3)
      fov = 50
    }
    if (dummy.free && this.dummyCam) {
      // the dummy cam: behind and beside the way it is going, closing in as it slows, circling once it lies still
      const c = dummy.centre()
      const target = new THREE.Vector3(c[0], c[1], c[2])
      const v = dummy.velocity()
      const hv = new THREE.Vector3(v[0], 0, v[2])
      if (hv.lengthSq() > 0.01 && !dummy.settled) this.dummyDir.lerp(hv.normalize(), Math.min(1, dt * 2)).normalize()
      const sp = Math.hypot(v[0], v[1], v[2])
      if (dummy.settled) this.dummyOrbit += dt * 0.25
      const back = this.dummyDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.9 + this.dummyOrbit)
      const dist = (dummy.settled ? 2.4 : 2.8) + Math.min(2.5, sp * 0.1)
      want = target.clone().addScaledVector(back, -dist).add(new THREE.Vector3(0, (dummy.settled ? 1.1 : 1.2) + Math.min(1.5, sp * 0.05), 0))
      want.y = Math.max(want.y, world.height(want.x, want.z) + 0.6)
      look = target
      fov = 52
      snapCam = false
    }
    if (this.directed) {
      want = this.directed.pos.clone(); look = this.directed.look.clone(); fov = this.directed.fov
      snapCam = this.directed.ease === undefined
    }
    if (this.snapCamera) { snapCam = true; this.snapCamera = false; this.camYaw = moveYaw }
    const k = snapCam ? 1 : Math.min(1, dt * (this.directed?.ease ?? (this.camMode === 2 ? 12 : 6)))
    this.camPos.lerp(want, k)
    this.camLook.lerp(look, snapCam ? 1 : Math.min(1, dt * 10))
    this.shake *= Math.exp(-dt * 7)
    this.camera.position.copy(this.camPos).add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake))
    this.camera.lookAt(this.camLook)
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3); this.camera.updateProjectionMatrix() }
    this.renderer.render(this.scene, this.camera)
  }

  /** Sparks where metal meets concrete. */
  scrape(wx: number, wz: number, speed: number, car: Car) {
    const [vx, vz] = car.pointVel(0, 0)
    const n = Math.min(10, Math.floor(speed * 0.6))
    for (let i = 0; i < n; i++) {
      this.sparks.emit(new THREE.Vector3(wx, 0.3 + Math.random() * 0.4, wz), new THREE.Vector3(vx * 0.6 + (Math.random() - 0.5) * 5, 1 + Math.random() * 3, vz * 0.6 + (Math.random() - 0.5) * 5), this.tmpC.setRGB(1, 0.65 + Math.random() * 0.3, 0.3), 0.05 + Math.random() * 0.05, 0.25 + Math.random() * 0.35, 1, { grav: 9, drag: 1 })
    }
  }
  crashBurst(wx: number, wz: number, speed: number) {
    for (let i = 0; i < Math.min(30, speed * 2); i++) {
      this.sparks.emit(new THREE.Vector3(wx, 0.5 + Math.random() * 0.4, wz), new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.6, (Math.random() - 0.5) * speed), this.tmpC.setRGB(1, 0.7, 0.4), 0.06, 0.3 + Math.random() * 0.4, 1, { grav: 9, drag: 1.5 })
    }
    for (let i = 0; i < Math.min(8, speed * 0.4); i++) {
      this.smoke.emit(new THREE.Vector3(wx, 0.4, wz), new THREE.Vector3((Math.random() - 0.5) * 2, 0.5 + Math.random(), (Math.random() - 0.5) * 2), this.tmpC.setRGB(0.5, 0.5, 0.52), 0.5, 1.8, 0.25, { grow: 1.5, drag: 1.5 })
    }
    this.shake = Math.min(0.5, this.shake + speed * 0.02)
  }
}

export type { V3 }
