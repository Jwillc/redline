# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""Lays a music track you supply under a filmed take, following the film's cues: how loud it is,
how muffled (heard through a door), and where in the song it is, frame by frame.

    uv run tools/mixmusic.py <outdir> <your-music-file> [--out name.mp4]

<outdir> is where tools/trailer.ts wrote picture.mp4, sound.wav and music-cues.json. The music file
can be any format ffmpeg reads. Nothing is fetched: the song is yours to provide.
"""
import json, subprocess, sys, wave
from pathlib import Path
import numpy as np

out = Path(sys.argv[1]); song = sys.argv[2]
name = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else 'with-music.mp4'
SR = 48000
cues = json.loads((out / 'music-cues.json').read_text())
fps, cues = cues['fps'], cues['cues']
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', song, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
music = np.frombuffer(raw, np.float32).reshape(-1, 2)
w = wave.open(str(out / 'sound.wav')); game = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, 2).astype(np.float32) / 32768
n = len(game)
mix = np.zeros_like(game)
spf = SR / fps
state = np.zeros(2)
prev_g = 0.0
for f, c in enumerate(cues):
    a, b = int(f * spf), min(n, int((f + 1) * spf))
    if a >= n: break
    g0, g1 = prev_g, c['gain']; prev_g = g1
    if g0 == 0 and g1 == 0: continue
    start = int(c['pos'] * SR)
    seg = music[start:start + (b - a)]
    if len(seg) < b - a: seg = np.vstack([seg, np.zeros((b - a - len(seg), 2), np.float32)])
    k = 1 - np.exp(-2 * np.pi * min(c['lp'], SR * 0.45) / SR)
    y = np.empty_like(seg)
    for i in range(len(seg)):  # one-pole low-pass, the muffling of walls and a door
        state += k * (seg[i] - state); y[i] = state
    ramp = np.linspace(g0, g1, b - a, endpoint=False)[:, None]
    mix[a:b] = y * ramp
total = game + mix
peak = np.abs(total).max()
if peak > 0.98: total *= 0.98 / peak
pcm = (np.clip(total, -1, 1) * 32767).astype(np.int16)
with wave.open(str(out / 'with-music.wav'), 'wb') as o:
    o.setnchannels(2); o.setsampwidth(2); o.setframerate(SR); o.writeframes(pcm.tobytes())
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(out / 'picture.mp4'), '-i', str(out / 'with-music.wav'), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', str(out / name)], check=True)
print('wrote', out / name)
