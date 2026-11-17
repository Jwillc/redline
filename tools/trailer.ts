/**
 * Films the trailer (src/film.ts, the game with ?film) frame by frame, 1920x1080 at 30 fps.
 *
 * Not a screen recording: the page runs on a clock this script owns (`performance.now` and the
 * animation frames are replaced before it loads), so each step is exactly one frame however long
 * it takes to draw, and none is dropped. The game's sound runs on the same clock: its AudioContext
 * is an offline one rendered a frame at a time, so the engine worklet, the crashes and the
 * compressor are the game's own mix, in step with the picture to the sample.
 *
 * Usage: bun tools/trailer.ts [outdir] [--url http://127.0.0.1:5347/?film] [--seconds N]
 * Needs the dev server (redline-dev) and ffmpeg. Writes <outdir>/picture.mp4, sound.wav and
 * redline-trailer.mp4.
 */
import { chromium } from 'playwright-core'
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (name: string, d: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : d }
const url = opt('--url', 'http://127.0.0.1:5347/?film')
const limit = +opt('--seconds', '0')
const out = args[0] ?? 'out/trailer'
mkdirSync(out, { recursive: true })
const W = 1920, H = 1080, FPS = 30, RATE = 48000, SOUND = 100

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage()
page.on('pageerror', e => console.log('page error:', e.message))
page.on('console', m => m.type() === 'error' && console.log('page error:', m.text()))
const wav = `${out}/sound.wav`
writeFileSync(wav, '')
await page.exposeFunction('__chunk', (b64: string) => appendFileSync(wav, Buffer.from(b64, 'base64')))
await page.addInitScript(({ RATE, SOUND }) => {
  const Wn = window as any
  let now = 0, next = 0
  const waiting = new Map<number, FrameRequestCallback>()
  performance.now = () => now
  window.requestAnimationFrame = f => (waiting.set(++next, f), next)
  window.cancelAnimationFrame = i => void waiting.delete(i)
  Wn.__step = (ms: number) => { now += ms; const run = [...waiting.values()]; waiting.clear(); for (const f of run) f(now) }
  Wn.AudioContext = function () {
    const c: any = new OfflineAudioContext(2, RATE * SOUND, RATE)
    const A = (Wn.__audio = { c, suspend: c.suspend.bind(c), resume: c.resume.bind(c), t: 0, rendering: null as Promise<AudioBuffer> | null, t0: 0 })
    c.suspend = () => Promise.resolve()
    c.resume = () => Promise.resolve()
    c.close = () => Promise.resolve()
    Wn.__audioStart = async () => { A.t = 128 / RATE; const there = A.suspend(A.t); A.rendering = c.startRendering(); await there }
    Wn.__audioStep = async (s: number) => { A.t += s; const there = A.suspend(A.t); A.resume(); await there }
    return c
  }
  Wn.__finish = async (from: number) => {
    const A = Wn.__audio, end = A.c.currentTime, rate = A.c.sampleRate
    A.resume()
    const buf: AudioBuffer = await A.rendering
    const i0 = Math.round(from * rate), n = Math.round(end * rate) - i0, L = buf.getChannelData(0), R = buf.getChannelData(1)
    const bytes = new Uint8Array(44 + n * 4), v = new DataView(bytes.buffer)
    const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)))
    text(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); text(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true)
    v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, n * 4, true)
    let peak = 0
    for (let i = 0; i < n; i++) {
      const l = L[i0 + i], r = R[i0 + i]
      peak = Math.max(peak, Math.abs(l), Math.abs(r))
      v.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, l)) * 32767), true)
      v.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, r)) * 32767), true)
    }
    for (let i = 0; i < bytes.length; i += 300000) {
      let s = ''
      const part = bytes.subarray(i, i + 300000)
      for (let k = 0; k < part.length; k += 0x8000) s += String.fromCharCode(...part.subarray(k, k + 0x8000))
      await Wn.__chunk(btoa(s))
    }
    return { seconds: n / rate, peak }
  }
}, { RATE, SOUND })

await page.goto(url, { waitUntil: 'networkidle' })
const step = (ms: number) => page.evaluate(async ms => { const Wn = window as any; Wn.__step(ms); if (Wn.__audio?.rendering) await Wn.__audioStep(ms / 1000) }, ms)
// let the game start its sound, load the engine and the head, and make its director
for (let k = 0; k < 400; k++) {
  await step(1000 / FPS)
  if (await page.evaluate(() => (window as any).__film?.ready)) break
  await page.waitForTimeout(30)
}
if (!(await page.evaluate(() => (window as any).__film?.ready))) throw new Error('the film never got ready')
await page.evaluate(() => (window as any).__audioStart())
// the director has started counting while things loaded: start it again from nothing
await page.evaluate(() => { const D = (window as any).__film.director; D.t = 0; D.i = -1 })
const from = await page.evaluate(() => (window as any).__audio.c.currentTime)
const total = await page.evaluate(() => (window as any).__film.director.length) as number
const frames = Math.round((limit || total) * FPS)
console.log(`filming ${frames} frames (${(frames / FPS).toFixed(1)} s)`)
const ffmpeg = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', `${out}/picture.mp4`], { stdin: 'pipe' })
const t0 = Date.now()
const cues: { gain: number; lp: number; pos: number }[] = []
for (let k = 0; k < frames; k++) {
  await step(1000 / FPS)
  cues.push(await page.evaluate(() => ({ ...(window as any).__film.director.music })))
  ffmpeg.stdin.write(await page.screenshot({ type: 'jpeg', quality: 92 }))
  if (k % 150 === 0) {
    const s = await page.evaluate(() => { const D = (window as any).__film.director; return `${D.t.toFixed(1)} s shot ${D.i}` })
    console.log(`  frame ${k}/${frames}  ${s}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  }
}
writeFileSync(`${out}/music-cues.json`, JSON.stringify({ fps: FPS, cues }))
ffmpeg.stdin.end()
await ffmpeg.exited
console.log('rollover turns:', await page.evaluate(() => (window as any).__film.director.rolls?.toFixed(2)))
const done = await page.evaluate(f => (window as any).__finish(f), from) as { seconds: number; peak: number }
console.log(`sound: ${done.seconds.toFixed(1)} s, peak ${done.peak.toFixed(2)}`)
await browser.close()
const mux = Bun.spawnSync(['ffmpeg', '-y', '-loglevel', 'error', '-i', `${out}/picture.mp4`, '-i', wav, '-c:v', 'copy', '-af', 'alimiter=limit=0.93:attack=2:release=60,afade=t=in:d=0.3,afade=t=out:st=' + Math.max(0, frames / FPS - 1.2).toFixed(2) + ':d=1.2', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', `${out}/redline-trailer.mp4`])
if (mux.exitCode) console.log(mux.stderr.toString())
console.log(`wrote ${out}/redline-trailer.mp4`)
