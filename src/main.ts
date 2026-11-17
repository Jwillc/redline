import './style.css'
import { ENGINES, type EngineSpec } from './engine/presets'
import { Audio } from './engine/audio'
import { Car, SETUPS, type CarSetup, type Controls } from './sim/car'
import { World, TRACKS, type Impact } from './sim/world'
import { Damage } from './sim/damage'
import { View } from './view/scene'
import { Dummy } from './sim/dummy'
import { initChimera } from './chimera/wasm/chimera.ts'
import type { ChimeraHead } from './view/chimeraHead'
import { Director } from './film'
import { physicsFrame, type Phys } from './sim/frame'
import { EngineSim } from './engine/model'

const $ = (id: string) => document.getElementById(id)!
const canvas = $('view') as HTMLCanvasElement
const params = new URLSearchParams(location.search)

/** courses that bring their own car and engine */
const OWN: Record<string, [string, string]> = { drift: ['drift', 'drift'], hood: ['pinto', 'pinto'] }
let spec: EngineSpec = ENGINES.find(e => e.id === params.get('engine')) ?? ENGINES.find(e => e.id === (OWN[params.get('track') ?? '']?.[1] ?? 'v8'))!
let world = new World(TRACKS.find(t => t.id === params.get('track'))?.id ?? 'bumps')
const car = new Car(spec.idle)
const damage = new Damage(spec.layout.length)
const view = new View(canvas, world)
const audio = new Audio()
/** The crash dummy with the CHIMERA head. Off for now: set true to put him back in the driver's seat. */
const DUMMY_ON = false
/** ?film: the trailer plays itself (src/film.ts) */
const FILM = params.has('film')
let dummyOn = DUMMY_ON
const dummy = new Dummy()
view.dummy.group.visible = dummyOn
let director: Director | null = null
let head: ChimeraHead | null = null
let thrownFrom: [number, number] | null = null, thrown = 0
let rseed = 4242
const rand = () => (rseed = (rseed * 16807) % 2147483647) / 2147483647
view.setEngine(spec)
let best = 0, runStart = 0, finished = 0
/** drift scoring: points for angle times speed, a multiplier that grows while the slide lasts */
const drift = { combo: 0, time: 0, off: 0, total: 0, best: 0, angle: 0, flash: '' , flashT: 0 }
spawn()

// --- input ---
const keys = new Set<string>()
const ctl: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false }
let started = false
let slow = 1
const CAMS = ['chase', 'trackside', 'engine bay', 'hood', 'overhead', 'orbit']
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.repeat) return
  keys.add(e.code)
  if (!started) return
  if (e.code === 'KeyE') { car.auto = false; car.shift(car.gear + 1) }
  if (e.code === 'KeyQ') { car.auto = false; car.shift(car.gear - 1) }
  if (e.code === 'KeyT') { car.auto = !car.auto; if (car.auto && car.gear === 0) car.shift(1) }
  if (e.code === 'KeyC') { view.camMode = (view.camMode + 1) % CAMS.length; logMsg(`Camera: ${CAMS[view.camMode]}`) }
  if (e.code === 'KeyK') pickSetup(SETUPS[(SETUPS.indexOf(car.setup) + 1) % SETUPS.length])
  if (e.code === 'KeyX') { car.tc = !car.tc; logMsg(car.tc ? 'Traction control on' : 'Traction control off') }
  if (e.code === 'KeyN') pickTrack(TRACKS[(TRACKS.findIndex(t => t.id === world.track.id) + 1) % TRACKS.length].id)
  if (dummyOn && e.code === 'KeyV') { view.dummyCam = !view.dummyCam; logMsg(view.dummyCam ? 'Following the dummy' : 'Following the car') }
  if (e.code === 'KeyB') { slow = slow === 1 ? 0.25 : 1; logMsg(slow < 1 ? 'Slow motion' : 'Normal speed') }
  if (e.code === 'KeyR') repair()
  if (e.code === 'KeyM') audio.setMuted(!audio.muted)
  const d = /^Digit([1-8])$/.exec(e.code)
  if (d) pickEngine(ENGINES[+d[1] - 1])
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
})
window.addEventListener('keyup', (e: KeyboardEvent) => keys.delete(e.code))
window.addEventListener('blur', () => keys.clear())
const held = (...c: string[]) => c.some(k => keys.has(k))
let padPrev: boolean[] = []

function readControls(dt: number) {
  let thr = held('KeyW', 'ArrowUp') ? 1 : 0
  let brk = held('KeyS', 'ArrowDown') ? 1 : 0
  let st = (held('KeyA', 'ArrowLeft') ? 1 : 0) - (held('KeyD', 'ArrowRight') ? 1 : 0)
  let hb = held('Space')
  const pad = navigator.getGamepads?.().find(p => p)
  if (pad) {
    const b = (i: number) => pad.buttons[i]?.value ?? 0
    const ax = pad.axes[0] ?? 0
    if (b(7) > 0.05) thr = b(7)
    if (b(6) > 0.05) brk = b(6)
    if (Math.abs(ax) > 0.12) st = -ax
    if (b(0) > 0.5) hb = true
    const now = pad.buttons.map(x => x.pressed)
    if (now[5] && !padPrev[5]) { car.auto = false; car.shift(car.gear + 1) }
    if (now[4] && !padPrev[4]) { car.auto = false; car.shift(car.gear - 1) }
    if (now[3] && !padPrev[3]) view.camMode = (view.camMode + 1) % CAMS.length
    if (now[1] && !padPrev[1]) repair()
    padPrev = now
  }
  // keys ramp like a foot and a hand would
  const toward = (v: number, t: number, up: number, down: number) => v + Math.max(-down * dt, Math.min(up * dt, t - v))
  ctl.throttle = toward(ctl.throttle, thr, 6, 10)
  ctl.brake = toward(ctl.brake, brk, 6, 12)
  ctl.steer = toward(ctl.steer, st, st === 0 ? 5 : 2.6, 5)
  if (st !== 0 && Math.sign(st) !== Math.sign(ctl.steer)) ctl.steer = toward(ctl.steer, st, 6, 6)
  ctl.handbrake = hb
}

// --- engine choice ---
function engineButtons(host: HTMLElement) {
  host.innerHTML = ''
  ENGINES.forEach((e, i) => {
    const b = document.createElement('button')
    b.innerHTML = `<kbd>${i + 1}</kbd>${e.name}`
    b.onclick = () => pickEngine(e)
    b.dataset.id = e.id
    host.append(b)
  })
}
engineButtons($('engines'))
engineButtons($('pick'))
function markEngine() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.keys button, .pick button')) b.classList.toggle('on', b.dataset.id === spec.id)
  $('eng-name').textContent = spec.name
  $('eng-blurb').textContent = spec.blurb
}
function pickEngine(e: EngineSpec) {
  if (e === spec) return
  spec = e
  audio.setEngine(e.id)
  view.setEngine(e)
  damage.setCylinders(e.layout.length)
  damage.engine = 1
  damage.radiator = 1
  damage.muffler = 1
  damage.bad = []
  damage.updateMisfire()
  car.we = Math.max(car.we, e.idle * Math.PI / 30)
  markEngine()
  logMsg(`Swapped in: ${e.name}`)
  const u = new URL(location.href)
  u.searchParams.set('engine', e.id)
  history.replaceState(null, '', u)
}
markEngine()

function spawn() {
  const s = world.start
  car.reset(s.x, s.z, s.yaw, spec.idle, world.height(s.x, s.z))
  dummy.free = false
  thrownFrom = null
  thrown = 0
  best = 0
  drift.combo = 0; drift.time = 0
  runStart = performance.now()
  finished = 0
}

function trackButtons() {
  const host = $('tracks')
  host.innerHTML = ''
  TRACKS.forEach(t => {
    const b = document.createElement('button')
    b.textContent = t.name
    b.dataset.track = t.id
    b.onclick = () => pickTrack(t.id)
    host.append(b)
  })
}
trackButtons()
function markTrack() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tracks button')) b.classList.toggle('on', b.dataset.track === world.track.id)
  $('track-name').textContent = world.track.name
}
function pickSetup(s: CarSetup, quiet = false) {
  car.build(s)
  view.setCar(s)
  if (!quiet) logMsg(`${s.name}: ${s.blurb}`)
  $('car-name').textContent = s.name
}
pickSetup(SETUPS.find(s => s.id === OWN[world.track.id]?.[0]) ?? SETUPS[0], true)
car.reset(world.start.x, world.start.z, world.start.yaw, spec.idle, world.height(world.start.x, world.start.z))

function pickTrack(id: string) {
  const wasOwn = !!OWN[world.track.id]
  world = new World(id)
  const own = OWN[id]
  if (own) { pickSetup(SETUPS.find(s => s.id === own[0])!, true); pickEngine(ENGINES.find(e => e.id === own[1])!) }
  else if (wasOwn) pickSetup(SETUPS[0], true)
  drift.total = 0; drift.best = 0; drift.combo = 0; drift.time = 0
  view.buildWorld(world)
  repair(true)
  markTrack()
  const u = new URL(location.href)
  u.searchParams.set('track', id)
  history.replaceState(null, '', u)
  logMsg(world.track.name)
}
markTrack()

function repair(quiet = false) {
  spawn()
  damage.repair()
  damage.setCylinders(spec.layout.length)
  view.repair()
  world.resetProps()
  if (!quiet) logMsg('Back to the start, repaired')
}

function logMsg(s: string) {
  const d = document.createElement('div')
  d.textContent = s
  $('log').prepend(d)
  setTimeout(() => d.remove(), 4000)
}

// --- start (sound needs a click) ---
const go = $('go') as HTMLButtonElement
async function start() {
  if (started) return
  go.disabled = true
  go.textContent = 'STARTING…'
  try {
    await audio.start(spec.id)
  } catch (err) {
    console.error(err)
    logMsg('Sound could not start in this browser')
  }
  started = true
  $('start').classList.add('gone')
  // played live, a film can bring its music: ?music=/music/your-file.mp3 (a file in public/music/)
  const mu = params.get('music')
  if (FILM && mu && !(window as any).__step) audio.loadMusic(mu).catch(() => logMsg('No music file at ' + mu))
  // the CHIMERA engine, then the head (its module reads the engine when it loads)
  if (DUMMY_ON || FILM) initChimera().then(() => import('./view/chimeraHead')).then(m => {
    head = new m.ChimeraHead(view.dummy.holder)
    head.resize(innerWidth, innerHeight)
    view.onResize = (w, h) => head?.resize(w, h)
  }).catch(err => { console.error(err); logMsg('The CHIMERA head could not load') })
}
go.onclick = start
window.addEventListener('keydown', (e: KeyboardEvent) => { if (!started && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); start() } })
// the recorder starts the film by itself; a person's browser needs the click before it will play sound
if (params.has('autostart') || (FILM && (window as any).__step)) start()

// --- tach ---
const tach = ($('tach') as HTMLCanvasElement).getContext('2d')!
function drawTach(rpm: number, red: number, limiter: boolean) {
  const W = 220, cx = 110, cy = 112, R = 96
  tach.clearRect(0, 0, W, W)
  const max = Math.ceil((red + 500) / 1000) * 1000
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25
  const ang = (r: number) => a0 + (a1 - a0) * Math.min(1, r / max)
  tach.lineWidth = 7
  tach.strokeStyle = '#1d232a'
  tach.beginPath(); tach.arc(cx, cy, R, a0, a1); tach.stroke()
  tach.strokeStyle = '#a3291c'
  tach.beginPath(); tach.arc(cx, cy, R, ang(red), a1); tach.stroke()
  tach.strokeStyle = limiter ? '#ff5a2a' : '#e9edf2'
  tach.beginPath(); tach.arc(cx, cy, R, a0, ang(rpm)); tach.stroke()
  tach.fillStyle = '#8a94a1'
  tach.font = '600 13px ui-sans-serif, -apple-system, sans-serif'
  tach.textAlign = 'center'
  tach.textBaseline = 'middle'
  for (let r = 0; r <= max; r += 1000) {
    const a = ang(r)
    tach.fillText(String(r / 1000), cx + Math.cos(a) * (R - 20), cy + Math.sin(a) * (R - 20))
  }
  tach.fillStyle = limiter ? '#ff6a2a' : '#e9edf2'
  tach.font = '700 30px ui-sans-serif, -apple-system, sans-serif'
  tach.fillText(Math.round(rpm).toLocaleString(), cx, cy + 6)
  tach.fillStyle = '#8a94a1'
  tach.font = '600 11px ui-sans-serif, -apple-system, sans-serif'
  tach.fillText('RPM', cx, cy + 32)
}

function showNews(news: ReturnType<Damage['apply']>) {
  for (const d of news.dents) view.body.dent(d.lx, d.ly, d.lz, d.nx, d.ny, d.nz, d.depth, d.radius, Math.floor(Math.random() * 1e6) + 1)
  for (const d of news.detach) view.detachPanel([d.id], car, d.nx, d.nz, d.speed)
  for (const g of news.shatter) { view.shatter(g, car); audio.hit(9, 'glass', 0) }
  for (const i of news.wheelLost) { view.loseWheel(i, car); audio.hit(10, 'metal', i % 2 ? -0.6 : 0.6) }
  if (news.muffler) view.dropMuffler(false)
  for (const m of news.messages) logMsg(m)
}

// --- loop ---
function resize() { view.resize(innerWidth, innerHeight) }
window.addEventListener('resize', resize)
resize()

let last = performance.now()
let hudClock = 0
let filmEngine: EngineSim | null = null
const phys: Phys = {
  car, world, damage, dummy, dummyOn, spec, engine: null, live: false, propClock: 0, samples: 0, rand,
  torque: () => audio.report.id === spec.id ? audio.report.brake : 0,
  onEject: () => {
    view.shatter('windshield', car)
    audio.hit(10, 'glass', 0)
    thrownFrom = [car.x, car.z]
    logMsg('The dummy went through the windshield')
  },
}

let filmAcc = 0
function frame(now: number) {
  // the film runs exactly one frame per step, so its physics repeats to the bit. Being recorded, the
  // recorder steps the clock a frame at a time; played live, it waits for a frame's worth of real time
  // (a fast screen would otherwise run it at double speed)
  if (FILM && !(window as any).__step) {
    filmAcc = Math.min(0.1, filmAcc + (now - last) / 1000)
    last = now
    if (filmAcc < 1 / 30 - 1e-3) { requestAnimationFrame(frame); return }
    filmAcc = Math.max(0, filmAcc - 1 / 30)
  }
  const real = FILM ? 1 / 30 : Math.min(0.05, (now - last) / 1000)
  last = now
  if (FILM) {
    if (!director && started) director = new Director({
      car, get world() { return world }, view, dummy, ctl,
      pickTrack: id => { if (world.track.id !== id) pickTrack(id) },
      pickEngine: id => pickEngine(ENGINES.find(e => e.id === id)!),
      pickSetup: id => pickSetup(SETUPS.find(s => s.id === id)!, true),
      repair: () => { damage.repair(); damage.setCylinders(spec.layout.length); view.repair(); world.resetProps(); dummy.free = false; thrownFrom = null; thrown = 0 },
      setSlow: k => { slow = k },
      setDummy: on => { dummyOn = on; view.dummy.group.visible = on; if (on) { dummy.free = false; dummy.ride(car, 0.016) } },
      showDash: on => document.body.classList.toggle('film-dash', on),
      fresh: () => { filmEngine = new EngineSim(spec, 48000); filmEngine.omega = car.we; phys.samples = 0; phys.propClock = 0 },
      newTrack: id => pickTrack(id),
      hit: (strength, kind, pan) => audio.hit(strength, kind, pan ?? 0),
      showFigure: on => { view.dummy.group.visible = on },
    }, params.get('film') || 'trailer')
    director?.update(real)
    if (director) audio.setMusic(director.music)
    // the film is over: park it (a held footbrake at a standstill would select reverse)
    if (director?.done) Object.assign(ctl, { throttle: 0, brake: 0, steer: 0, handbrake: true })
  }
  const dt = real * slow
  if (!FILM) readControls(dt)
  const live = started && audio.ready
  // in the film the engine's torque comes from a copy of the model stepped with the car, so a take repeats exactly
  if (FILM && (!filmEngine || filmEngine.spec !== spec)) { const w = filmEngine?.omega ?? car.we; filmEngine = new EngineSim(spec, 48000); filmEngine.omega = w }
  phys.car = car; phys.world = world; phys.damage = damage; phys.dummy = dummy; phys.dummyOn = dummyOn; phys.spec = spec
  phys.engine = FILM ? filmEngine : null
  phys.live = live
  const out = physicsFrame(phys, dt, ctl, !!director?.puppet)
  const hits = out.hits
  let scrape = out.scrape
  for (const hit of hits) if (hit.scrape > 2.5 && Math.random() < 0.3) view.scrape(hit.wx, hit.wz, hit.scrape, car)
  // drift scoring
  {
    const ang = car.u > 2 ? Math.abs(Math.atan2(car.v, car.u)) * 180 / Math.PI : car.speed > 3 ? 180 : 0
    drift.angle += (ang - drift.angle) * Math.min(1, real * 10)
    const kmh = car.speed * 3.6
    const sliding = ang > 12 && ang < 100 && kmh > 25 && car.airborne < 0.2
    const wall = hits.some(h => h.kind === 'fixed' && h.speed > 2.5)
    const lose = (why: string) => { if (drift.combo > 50) { drift.flash = why; drift.flashT = 2.5 } drift.combo = 0; drift.time = 0; drift.off = 0 }
    if (drift.combo > 0 && wall) lose('Combo lost: hit the wall')
    else if (drift.combo > 0 && ang >= 100 && car.speed > 3) lose('Spun out')
    else if (sliding) {
      drift.time += dt
      drift.off = 0
      const mult = Math.min(5, 1 + Math.floor(drift.time / 2) * 0.5)
      drift.combo += (ang - 10) * kmh / 20 * mult * dt
    } else if (drift.combo > 0) {
      drift.off += dt
      if (drift.off > 1) {
        const pts = Math.round(drift.combo)
        drift.total += pts
        drift.best = Math.max(drift.best, pts)
        drift.flash = `+${pts.toLocaleString()}`; drift.flashT = 2
        drift.combo = 0; drift.time = 0; drift.off = 0
      }
    }
    drift.flashT -= real
  }
  // the ground's blows: bottoming out, landing on the nose or the roof, scraping
  const evs = out.events
  for (const e of evs) if (e.scrape > 4 && Math.random() < 0.5) view.scrape(e.wx, e.wz, e.scrape * 0.5, car)
  if (evs.length) {
    if (out.newsCar) showNews(out.newsCar)
    const big = evs.reduce((a, e) => Math.max(a, e.speed), 0)
    if (big > 4) audio.hit(big * 0.8, evs.some(e => e.kind === 'body') ? 'metal' : 'thud', 0)
    if (big > 7) view.shake = Math.min(0.5, view.shake + big * 0.02)
    scrape = Math.max(scrape, ...evs.map(e => e.scrape * 0.6))
  }
  // damage and its effects
  if (hits.length) {
    if (out.newsHits) showNews(out.newsHits)
    let loudest: Impact | null = null
    for (const hit of hits) if (!loudest || hit.speed * Math.min(1, hit.hard * 4) > loudest.speed * Math.min(1, loudest.hard * 4)) loudest = hit
    if (loudest) {
      const kind = loudest.kind === 'fixed' ? 'metal' : loudest.kind === 'cone' ? 'plastic' : loudest.kind === 'crate' ? 'thud' : loudest.kind === 'tyre' ? 'thud' : 'metal'
      const s = loudest.kind === 'fixed' ? loudest.speed : loudest.speed * (loudest.kind === 'barrel' ? 0.7 : 0.6)
      audio.hit(s, kind, -loudest.lx)
      if (loudest.kind === 'fixed' && loudest.speed > 3) view.crashBurst(loudest.wx, loudest.wz, loudest.speed)
    }
  }
  for (const d of dummy.hits.splice(0)) audio.hit(d.speed * (d.head ? 0.9 : 0.7), d.head ? 'plastic' : 'thud', 0)
  if (dummy.free && thrownFrom) {
    const c = dummy.centre()
    thrown = Math.max(thrown, Math.hypot(c[0] - thrownFrom[0], c[2] - thrownFrom[1]))
  }
  head?.update(view.camera, dummy.free && !dummy.settled ? 1 : dummy.free ? 0.35 : 0, real)
  audio.control({ omega: car.we, throttle: car.throttleOut, fuelCut: car.fuelCut, misfire: damage.misfire, muffler: damage.muffler })
  audio.layers(Math.max(car.slipRear, car.slipFront, car.burnout) * Math.min(1, car.speed / 3 + car.burnout), scrape, car.speed)
  view.update(dt, car, world, audio.snapId === spec.id ? audio.snap : null, audio.report.loud, car.throttleOut, {
    fuelCut: car.fuelCut, rpm: car.rpm, redline: spec.redline, engineHealth: damage.engine, radiator: damage.radiator, dead: damage.dead,
  }, dummy)
  director?.afterView()
  // HUD
  hudClock += dt
  if (hudClock > 1 / 30) {
    hudClock = 0
    drawTach(car.rpm, spec.redline, car.limiter)
    $('gear').textContent = car.gear === 0 ? 'N' : car.gear < 0 ? 'R' : String(car.gear)
    $('mode').textContent = car.auto ? 'AUTO' : 'MANUAL'
    $('speed').textContent = String(Math.round(car.speed * 3.6))
    const tq = live ? audio.report.brake : 0
    $('torque').textContent = String(Math.round(tq))
    $('power').textContent = String(Math.max(0, Math.round(tq * car.we / 745.7)))
    $('plenum').textContent = `manifold ${Math.round(audio.report.plenum / 1000)} kPa · ${car.fuelCut ? (car.limiter ? 'limiter' : damage.dead ? 'no fuel' : 'fuel cut') : 'firing'}`
    const st: string[] = []
    const pct = Math.round(damage.engine * 100)
    if (damage.dead) st.push('<div class="dead">ENGINE DEAD · press R</div>')
    else if (pct < 100) st.push(`<div class="bad">Engine ${pct}%</div>`)
    damage.bad.forEach(c => st.push(`<div class="bad">Cylinder ${c + 1} ${damage.misfire[c] >= 1 ? 'dead' : 'misfiring'}</div>`))
    if (damage.muffler < 1) st.push('<div class="bad">No muffler</div>')
    damage.lost.forEach((l, i) => { if (l) st.push(`<div class="dead">${['Front left', 'Front right', 'Rear left', 'Rear right'][i]} wheel gone</div>`) })
    damage.bend.forEach((b, i) => { if (b && !damage.lost[i]) st.push(`<div class="bad">${['Front left', 'Front right', 'Rear left', 'Rear right'][i]} wheel bent</div>`) })
    if (car.upright < 0.2) st.push('<div class="dead">ON ITS ROOF · press R</div>')
    if (dummy.free) st.push(`<div class="dead">DUMMY THROWN ${thrown.toFixed(1)} m${dummy.settled ? '' : '…'}</div>`)
    const off = [...damage.panels.entries()].filter(([, p]) => p.off).length
    if (off) st.push(`<div>${off} panel${off > 1 ? 's' : ''} gone</div>`)
    $('status').innerHTML = st.join('')
    // course: distance, what is next, and the result
    if (world.isCourse) {
      best = Math.max(best, car.z)
      const fin = world.track.marks.find(m => m.label === 'finish')?.z ?? world.track.length
      if (!finished && car.z > fin) { finished = (performance.now() - runStart) / 1000; logMsg(`Finished in ${finished.toFixed(1)} s`) }
      const next = world.track.marks.find(m => m.z > car.z + 1)
      const wrecked = damage.dead || car.upright < 0.2 || damage.lost.some(l => l)
      $('course').innerHTML = `<b>${Math.max(0, Math.round(car.z))} m</b> of ${Math.round(fin)}` +
        (finished ? ` · <span class="ok">finished ${finished.toFixed(1)} s</span>` : next ? ` · next: ${next.label} in ${Math.round(next.z - car.z)} m` : '') +
        (wrecked && !finished ? ` · <span class="bad">got to ${Math.round(best)} m</span>` : '')
    } else if (world.isDrift) {
      const mult = Math.min(5, 1 + Math.floor(drift.time / 2) * 0.5)
      const a = Math.round(Math.min(99, drift.angle))
      $('course').innerHTML = `<b>${a}°</b> drift angle` +
        (drift.combo > 0 ? ` · <span class="ok">${Math.round(drift.combo).toLocaleString()} ×${mult.toFixed(1)}</span>` : '') +
        (drift.flashT > 0 ? ` · <span class="${drift.flash.startsWith('+') ? 'ok' : 'bad'}">${drift.flash}</span>` : '') +
        `<br>score ${drift.total.toLocaleString()} · best combo ${drift.best.toLocaleString()}`
    } else $('course').textContent = ''
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// handles for checks in the browser
if (FILM) import('../tools/rollsearch').then(m => { (window as any).__runPlan = m.runPlan })
;(window as any).__film = { get director() { return director }, get ready() { return audio.ready && !!head && !!director }, get done() { return !!director?.done } }
;(window as any).__redline = { drift, pickSetup, SETUPS, dummy, get head() { return head }, car, get world() { return world }, damage, view, audio, ctl, keys, get spec() { return spec }, pickEngine, pickTrack, repair, setSlow: (k: number) => { slow = k } }
