// What a hit does: dents and loose panels for the picture, and wounds to the engine, the exhaust and
// the steering that change how the car drives and how the engine sounds.
import type { Impact } from './world'
import type { CarEvent } from './car'

export type PanelId = 'bumperF' | 'bumperR' | 'hood' | 'fenderL' | 'fenderR' | 'doorL' | 'doorR' | 'quarterL' | 'quarterR' | 'trunk' | 'roof'
export type GlassId = 'windshield' | 'rear' | 'sideL' | 'sideR'

const PANEL_HP: Record<PanelId, number> = {
  bumperF: 16, bumperR: 14, hood: 30, fenderL: 34, fenderR: 34, doorL: 30, doorR: 30, quarterL: Infinity, quarterR: Infinity, trunk: 26, roof: Infinity,
}

export interface DamageNews {
  dents: { lx: number; ly: number; lz: number; nx: number; ny: number; nz: number; depth: number; radius: number }[]
  wheelBent: number[]
  wheelLost: number[]
  detach: { id: PanelId; lx: number; lz: number; nx: number; nz: number; speed: number }[]
  shatter: GlassId[]
  muffler: boolean
  messages: string[]
  severe: number
}

export class Damage {
  cylinders: number
  engine = 1
  radiator = 1
  muffler = 1
  /** per wheel: front left, front right, rear left, rear right */
  wheelHealth = [1, 1, 1, 1]
  bend = [0, 0, 0, 0]
  lost = [false, false, false, false]
  misfire: number[]
  panels = new Map<PanelId, { hp: number; off: boolean }>()
  glass = new Map<GlassId, boolean>()
  bad: number[] = []
  seed = 99
  constructor(cylinders: number) {
    this.cylinders = cylinders
    this.misfire = new Array(cylinders).fill(0)
    this.repair()
  }
  rand() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647 }
  repair() {
    this.seed = 99
    this.engine = 1; this.radiator = 1; this.muffler = 1
    this.wheelHealth = [1, 1, 1, 1]; this.bend = [0, 0, 0, 0]; this.lost = [false, false, false, false]
    this.misfire = new Array(this.cylinders).fill(0)
    this.bad = []
    for (const k of Object.keys(PANEL_HP) as PanelId[]) this.panels.set(k, { hp: PANEL_HP[k], off: false })
    for (const g of ['windshield', 'rear', 'sideL', 'sideR'] as GlassId[]) this.glass.set(g, false)
  }
  setCylinders(n: number) {
    this.cylinders = n
    this.misfire = new Array(n).fill(0)
    this.bad = this.bad.filter(i => i < n)
    this.updateMisfire()
  }
  get dead() { return this.engine <= 0 }

  apply(hits: Impact[]): DamageNews {
    const news = this.news()
    for (const h of hits) {
      const weight = h.hard >= 1 ? 1 : Math.min(1, Math.sqrt(h.hard) * 2.2)
      const se = h.speed * weight
      if (se < 2.5) continue
      news.severe = Math.max(news.severe, se)
      const depth = Math.min(0.32, (se - 2.5) * 0.02)
      const radius = 0.4 + Math.min(0.7, se * 0.025)
      news.dents.push({ lx: h.lx, ly: h.ly, lz: h.lz, nx: h.nx, ny: h.ny, nz: h.nz, depth, radius })
      const front = h.lz > 1.7, rear = h.lz < -1.7
      const left = h.lx > 0
      const hurt = (id: PanelId, k: number) => {
        const p = this.panels.get(id)!
        if (p.off) return
        p.hp -= (se - 2.5) * k
        if (p.hp <= 0) {
          p.off = true
          news.detach.push({ id, lx: h.lx, lz: h.lz, nx: h.nx, nz: h.nz, speed: se })
          news.messages.push(`${NAMES[id]} torn off`)
        }
      }
      const crack = (g: GlassId, need: number) => {
        if (this.glass.get(g) || se < need) return
        this.glass.set(g, true)
        news.shatter.push(g)
      }
      if (front) {
        hurt('bumperF', 1)
        if (se > 7) hurt('hood', 0.8)
        if (Math.abs(h.lx) > 0.45) hurt(left ? 'fenderL' : 'fenderR', 0.7)
        crack('windshield', this.panels.get('hood')!.off ? 9 : 13)
        if (se > 5.5) {
          const before = this.engine
          this.engine = Math.max(0, this.engine - (se - 5.5) * 0.022)
          this.radiator = Math.max(0, this.radiator - (se - 4) * 0.05)
          if (before > 0 && this.engine <= 0) news.messages.push('Engine destroyed')
          this.updateMisfire(news)
        }
      } else if (rear) {
        hurt('bumperR', 1)
        if (se > 6) hurt('trunk', 0.8)
        crack('rear', 10)
        if (se > 6.5 && this.muffler > 0) {
          this.muffler = 0
          news.muffler = true
          news.messages.push('Muffler knocked off')
        }
      } else {
        if (h.lz > 0.85) hurt(left ? 'fenderL' : 'fenderR', 0.8)
        else if (h.lz > -0.95) hurt(left ? 'doorL' : 'doorR', 0.9)
        crack(left ? 'sideL' : 'sideR', 7)
        if (h.lz > 0.4 && se > 9) {
          this.engine = Math.max(0, this.engine - (se - 9) * 0.01)
          this.updateMisfire(news)
        }
      }
      // a blow beside a wheel bends it
      for (let i = 0; i < 4; i++) {
        const wz = i < 2 ? 1.33 : -1.27, wl = i % 2 === 0
        if (Math.abs(h.lz - wz) < 0.6 && Math.abs(h.lx) > 0.5 && left === wl && se > 6) this.hurtWheel(i, (se - 6) * 0.05, news)
      }
    }
    return news
  }

  news(): DamageNews {
    return { dents: [], wheelBent: [], wheelLost: [], detach: [], shatter: [], muffler: false, messages: [], severe: 0 }
  }

  hurtWheel(i: number, amount: number, news: DamageNews) {
    if (this.lost[i] || amount <= 0) return
    const before = this.wheelHealth[i]
    this.wheelHealth[i] -= amount
    const name = ['Front left', 'Front right', 'Rear left', 'Rear right'][i]
    if (this.wheelHealth[i] <= 0) {
      this.lost[i] = true
      this.bend[i] = 0
      news.wheelLost.push(i)
      news.messages.push(`${name} wheel broke off`)
    } else if (this.wheelHealth[i] < 0.65) {
      // a bent wheel toes in or out and pulls the car
      const sign = this.rand() < 0.5 ? -1 : 1
      this.bend[i] = Math.max(-0.14, Math.min(0.14, this.bend[i] + sign * (0.65 - this.wheelHealth[i]) * 0.12))
      news.wheelBent.push(i)
      if (before >= 0.65) news.messages.push(`${name} wheel bent`)
    }
  }

  /** What the ground did to the car: bottomed-out suspension and the body hitting the ground. */
  applyCar(events: CarEvent[]): DamageNews {
    const news = this.news()
    for (const e of events) {
      if (e.kind === 'bottom' && e.wheel !== undefined) {
        news.severe = Math.max(news.severe, e.speed * 0.5)
        if (e.speed > 8) this.hurtWheel(e.wheel, (e.speed - 8) * 0.07, news)
        if (e.wheel < 2 && e.speed > 10 && this.engine > 0) {
          this.engine = Math.max(0, this.engine - (e.speed - 10) * 0.012)
          this.radiator = Math.max(0, this.radiator - (e.speed - 10) * 0.02)
          if (this.engine <= 0) news.messages.push('Engine destroyed')
          this.updateMisfire(news)
        }
        continue
      }
      if (e.speed < 3.5) continue
      news.severe = Math.max(news.severe, e.speed)
      news.dents.push({ lx: e.lx, ly: e.ly, lz: e.lz, nx: e.nx, ny: e.ny, nz: e.nz, depth: Math.min(0.35, (e.speed - 3) * 0.03), radius: 0.5 + Math.min(0.6, e.speed * 0.04) })
      if (e.ly > 1.0) {
        // landed on the roof
        if (e.speed > 4 && !news.messages.includes('Roof crushed')) news.messages.push('Roof crushed')
        for (const g of ['windshield', 'sideL', 'sideR', 'rear'] as GlassId[]) if (!this.glass.get(g) && e.speed > 5 + this.rand() * 3) { this.glass.set(g, true); news.shatter.push(g) }
      } else if (e.lz > 1.7) {
        const p = this.panels.get('bumperF')!
        if (!p.off) { p.hp -= (e.speed - 3) * 1.2; if (p.hp <= 0) { p.off = true; news.detach.push({ id: 'bumperF', lx: e.lx, lz: e.lz, nx: 0, nz: -1, speed: e.speed }); news.messages.push('Front bumper torn off') } }
        if (e.speed > 6) { this.engine = Math.max(0, this.engine - (e.speed - 6) * 0.02); this.radiator = Math.max(0, this.radiator - (e.speed - 6) * 0.04); this.updateMisfire(news) }
      } else if (e.lz < -1.7) {
        const p = this.panels.get('bumperR')!
        if (!p.off) { p.hp -= (e.speed - 3) * 1.2; if (p.hp <= 0) { p.off = true; news.detach.push({ id: 'bumperR', lx: e.lx, lz: e.lz, nx: 0, nz: 1, speed: e.speed }); news.messages.push('Rear bumper torn off') } }
        if (e.speed > 5 && this.muffler > 0) { this.muffler = 0; news.muffler = true; news.messages.push('Muffler knocked off') }
      } else if (e.ly < 0.4 && e.speed > 6 && this.muffler > 0 && this.rand() < 0.5) {
        this.muffler = 0; news.muffler = true; news.messages.push('Exhaust ripped off underneath')
      }
    }
    return news
  }

  updateMisfire(news?: DamageNews) {
    const wantBad = this.engine > 0.75 ? 0 : this.engine > 0.55 ? 1 : this.engine > 0.3 ? 2 : 3
    while (this.bad.length < Math.min(wantBad, this.cylinders)) {
      const free = [...Array(this.cylinders).keys()].filter(i => !this.bad.includes(i))
      const pick = free[Math.floor(this.rand() * free.length)]
      this.bad.push(pick)
      news?.messages.push(`Cylinder ${pick + 1} misfiring`)
    }
    this.misfire = new Array(this.cylinders).fill(0)
    this.bad.forEach((c, i) => {
      // the first wounded cylinder gets worse as the engine does
      const sev = i === 0 ? (this.engine > 0.55 ? 0.4 : 1) : i === 1 ? (this.engine > 0.3 ? 0.45 : 1) : 0.6
      this.misfire[c] = sev
    })
    if (this.engine <= 0) this.misfire.fill(1)
  }
}

export const NAMES: Record<PanelId, string> = {
  bumperF: 'Front bumper', bumperR: 'Rear bumper', hood: 'Hood', fenderL: 'Left fender', fenderR: 'Right fender',
  doorL: 'Left door', doorR: 'Right door', quarterL: 'Left quarter', quarterR: 'Right quarter', trunk: 'Trunk lid', roof: 'Roof',
}
