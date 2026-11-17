// Main-thread side of the sound: the engine worklet, plus crashes, glass, tyres, scraping and wind,
// all made here from noise and decaying resonances. No recordings.
import workletUrl from './worklet.ts?worker&url'

export interface EngineReport { brake: number; indicated: number; loud: number; plenum: number; id: string }

export class Audio {
  ctx!: AudioContext
  node!: AudioWorkletNode
  master!: GainNode
  sfx!: GainNode
  report: EngineReport = { brake: 0, indicated: 0, loud: 0, plenum: 101325, id: '' }
  snap: Float32Array | null = null
  snapId = ''
  ready = false
  muted = false
  noise!: AudioBuffer
  squeal!: { g: GainNode; f: BiquadFilterNode; f2: BiquadFilterNode }
  scrape!: { g: GainNode; f: BiquadFilterNode }
  wind!: { g: GainNode; f: BiquadFilterNode }
  lastCrash = 0

  private musicBuf: AudioBuffer | null = null
  private musicSrc: AudioBufferSourceNode | null = null
  private musicGain: GainNode | null = null
  private musicLp: BiquadFilterNode | null = null
  /** the context time at which the music's position 0 would have played */
  private musicAt = 0

  /** Load a music file to play under a film (straight to the speakers, not through the engine's compressor). */
  async loadMusic(url: string) {
    const r = await fetch(url)
    // the dev server answers a missing file with the page itself
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) throw new Error('no music at ' + url)
    this.musicBuf = await this.ctx.decodeAudioData(await r.arrayBuffer())
    this.musicLp = this.ctx.createBiquadFilter()
    this.musicLp.type = 'lowpass'
    this.musicGain = this.ctx.createGain()
    this.musicGain.gain.value = 0
    this.musicLp.connect(this.musicGain).connect(this.ctx.destination)
  }

  /** Follow a film's music cue: level, how muffled (low-pass Hz), and where in the song (seconds). */
  setMusic(m: { gain: number; lp: number; pos: number }) {
    if (!this.musicBuf || !this.musicGain || !this.musicLp) return
    const now = this.ctx.currentTime
    if (m.gain > 0.001) {
      // start it, or jump it when the film's position and the song's have come apart
      if (!this.musicSrc || Math.abs(now - this.musicAt - m.pos) > 0.3) {
        this.musicSrc?.stop()
        const src = this.ctx.createBufferSource()
        src.buffer = this.musicBuf
        src.connect(this.musicLp)
        src.start(now, Math.max(0, m.pos))
        this.musicSrc = src
        this.musicAt = now - m.pos
      }
    } else if (this.musicSrc) {
      this.musicSrc.stop(now + 0.1)
      this.musicSrc = null
    }
    this.musicGain.gain.setTargetAtTime(this.muted ? 0 : m.gain, now, 0.04)
    this.musicLp.frequency.setTargetAtTime(Math.min(20000, m.lp), now, 0.04)
  }

  async start(engineId: string) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    await this.ctx.audioWorklet.addModule(workletUrl)
    this.node = new AudioWorkletNode(this.ctx, 'engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
    this.node.port.onmessage = e => {
      const d = e.data
      if (d.type === 'torque') this.report = d
      else if (d.type === 'snap') { this.snap = d.snap; this.snapId = d.id }
    }
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -10
    comp.knee.value = 8
    comp.ratio.value = 4
    comp.attack.value = 0.003
    comp.release.value = 0.15
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(comp).connect(this.ctx.destination)
    const eg = this.ctx.createGain()
    eg.gain.value = 1
    this.node.connect(eg).connect(this.master)
    this.sfx = this.ctx.createGain()
    this.sfx.gain.value = 0.8
    this.sfx.connect(this.master)
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate)
    const nd = this.noise.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
    this.squeal = this.loopBand(1150, 9, 1700)
    this.scrape = this.loopBand(420, 0.9)
    this.wind = this.loopBand(380, 0.5)
    this.setEngine(engineId)
    if (this.ctx.state !== 'running') await this.ctx.resume()
    this.ready = true
  }
  loopBand(freq: number, q: number, second?: number) {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const f = this.ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = freq
    f.Q.value = q
    const f2 = this.ctx.createBiquadFilter()
    f2.type = second ? 'bandpass' : 'allpass'
    f2.frequency.value = second ?? freq
    f2.Q.value = second ? q : 0.7
    const g = this.ctx.createGain()
    g.gain.value = 0
    src.connect(f).connect(f2).connect(g).connect(this.sfx)
    src.start()
    return { g, f, f2 }
  }
  setEngine(id: string) {
    this.node?.port.postMessage({ type: 'engine', id })
  }
  control(c: { omega: number; throttle: number; fuelCut: boolean; misfire: number[]; muffler: number }) {
    if (!this.ready) return
    this.node.port.postMessage({ type: 'ctl', ...c })
  }
  setMuted(m: boolean) {
    this.muted = m
    if (this.ready) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05)
  }
  /** Continuous layers: tyre squeal 0..1, scraping speed m/s, road speed m/s. */
  layers(squeal: number, scrape: number, speed: number) {
    if (!this.ready) return
    const t = this.ctx.currentTime
    this.squeal.g.gain.setTargetAtTime(Math.min(0.5, squeal * 0.45), t, 0.04)
    this.squeal.f.frequency.setTargetAtTime(900 + 500 * Math.min(1, squeal), t, 0.05)
    this.scrape.g.gain.setTargetAtTime(Math.min(0.6, scrape * 0.06), t, 0.03)
    this.wind.g.gain.setTargetAtTime(Math.min(0.25, speed * speed * 0.00012), t, 0.2)
    this.wind.f.frequency.setTargetAtTime(250 + speed * 8, t, 0.2)
  }
  /** One impact. strength in m/s of closing speed; kind picks the material; pan -1..1. */
  hit(strength: number, kind: 'metal' | 'glass' | 'thud' | 'plastic', pan = 0) {
    if (!this.ready || strength < 0.6) return
    const ctx = this.ctx
    const now = ctx.currentTime
    if (kind === 'metal' && now - this.lastCrash < 0.05) return
    if (kind === 'metal') this.lastCrash = now
    const sr = ctx.sampleRate
    const len = Math.floor(sr * (kind === 'glass' ? 1.1 : kind === 'metal' ? 1.4 : 0.5))
    const buf = ctx.createBuffer(1, len, sr)
    const d = buf.getChannelData(0)
    const amp = Math.min(1, strength / 14)
    const modes: [number, number, number][] = []
    if (kind === 'metal') {
      for (let i = 0; i < 14; i++) modes.push([140 * Math.pow(22, Math.random()), 0.08 + Math.random() * 0.6 * (0.4 + amp), (0.3 + Math.random()) / 14])
    } else if (kind === 'glass') {
      for (let i = 0; i < 10; i++) modes.push([2400 + Math.random() * 6000, 0.03 + Math.random() * 0.15, 0.6 / 10])
    } else if (kind === 'thud') {
      for (let i = 0; i < 4; i++) modes.push([70 + Math.random() * 180, 0.05 + Math.random() * 0.08, 0.25])
    } else {
      for (let i = 0; i < 6; i++) modes.push([300 + Math.random() * 1400, 0.02 + Math.random() * 0.05, 0.15])
    }
    // Noise burst: a low-passed crunch whose length grows with the hit.
    const crunch = kind === 'metal' ? 0.05 + amp * 0.25 : kind === 'glass' ? 0.08 : 0.03
    let lp = 0
    const lpk = kind === 'glass' ? 0.6 : 0.25
    for (let i = 0; i < len; i++) {
      const t = i / sr
      let v = 0
      for (const [f, dec, a] of modes) v += a * Math.sin(2 * Math.PI * f * t + f) * Math.exp(-t / dec)
      const n = Math.random() * 2 - 1
      lp += lpk * (n - lp)
      v += lp * Math.exp(-t / crunch) * (kind === 'metal' ? 1.4 : 1)
      if (kind === 'glass' && Math.random() < 0.004 * Math.exp(-t / 0.4)) v += (Math.random() - 0.5) * 1.5
      d[i] = v
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = 0.9 + Math.random() * 0.2
    const g = ctx.createGain()
    g.gain.value = amp * (kind === 'metal' ? 0.9 : kind === 'glass' ? 0.6 : 0.5)
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan))
    src.connect(g).connect(p).connect(this.sfx)
    src.start()
  }
}
