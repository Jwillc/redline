# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy"]
# ///
# Usage: uv run tools/pinto-profile.py [--mic] <recording.wav> [more.wav ...]
#   Compare recordings of a real engine with renders from tools/pintoref.ts (mono 16-bit WAVs).
#   --mic takes out the low rumble a phone microphone doesn't pick up. Bring your own recordings:
#   none are included in this repo.
# Steady stretches of an engine recording: where the firing frequency holds for 3 s, in an idle band
# and a revving band; their average third-octave spectrum (dB relative to the loudest band, 100 Hz
# to 8 kHz) and how strongly the 1-4 kHz band pulses at the firing rate (the "buzz").
import sys, wave, json, numpy as np
from scipy.signal import butter, sosfiltfilt
def load(p):
    w = wave.open(p); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768
    if w.getnchannels() == 2: x = x.reshape(-1, 2).mean(1)
    return x, w.getframerate()
def firing(seg, fs):
    n = len(seg); S = np.abs(np.fft.rfft(seg * np.hanning(n)))
    best, bf = 0, 0
    for f0 in np.arange(12, 95, 0.25):
        s = sum(S[max(0, int(round(k * f0 * n / fs)) - 1):int(round(k * f0 * n / fs)) + 2].max() / k ** 0.3 for k in range(1, 9) if int(round(k * f0 * n / fs)) < len(S) - 2)
        if s > best: best, bf = s, f0
    return bf
CENTRES = [100 * 2 ** (i / 3) for i in range(0, 19)]   # 100 Hz .. 6.4 kHz
def thirds(x, fs):
    n = len(x); S = np.abs(np.fft.rfft(x * np.hanning(n))) ** 2; f = np.fft.rfftfreq(n, 1 / fs)
    out = np.array([S[(f >= c / 2 ** (1 / 6)) & (f < c * 2 ** (1 / 6))].sum() + 1e-20 for c in CENTRES])
    return 10 * np.log10(out / out.max())
def buzz(x, fs, f0):
    sos = butter(4, [1000, 4000], 'bandpass', fs=fs, output='sos')
    env = np.abs(sosfiltfilt(sos, x))
    env = sosfiltfilt(butter(2, 200, 'low', fs=fs, output='sos'), env)
    n = len(env); E = np.abs(np.fft.rfft((env - env.mean()) * np.hanning(n))); f = np.fft.rfftfreq(n, 1 / fs)
    at = E[(f > f0 * 0.95) & (f < f0 * 1.05)].max()
    return at / (env.mean() * n / 4 + 1e-12)
def stretches(x, fs, lo, hi):
    fr = [firing(x[int(t * fs):int((t + 1) * fs)], fs) for t in range(int(len(x) / fs) - 1)]
    out = []
    for t in range(len(fr) - 2):
        a = fr[t:t + 3]
        if all(lo <= v <= hi for v in a) and max(a) / min(a) < 1.06: out.append((t, float(np.mean(a))))
    return out
if __name__ == '__main__':
    res = {}
    for p in [a for a in sys.argv[1:] if not a.startswith('--')]:
        x, fs = load(p)
        if '--mic' in sys.argv: x = sosfiltfilt(butter(2, 150, 'high', fs=fs, output='sos'), x)
        name = p.split('/')[-1]
        res[name] = {}
        import re
        known = re.search(r'(idle|rev)(\d+)', name) if name.startswith('sim') else None
        for label, lo, hi in [('idle', 20, 40), ('rev', 55, 95)]:
            if known:
                if known.group(1) != label: continue
                f0 = int(known.group(2)) / 30
                st = [(t, f0) for t in range(0, int(len(x) / fs) - 3, 2)]
            else:
                st = stretches(x, fs, lo, hi)
            if not st: print(f'{name} {label}: none'); continue
            specs, buzzes, f0s, lv = [], [], [], []
            for t, f0 in st:
                seg = x[int(t * fs):int((t + 3) * fs)]
                specs.append(thirds(seg, fs)); buzzes.append(buzz(seg, fs, f0)); f0s.append(f0); lv.append(20 * np.log10(np.sqrt((seg ** 2).mean())))
            sp = np.mean(specs, 0)
            res[name][label] = {'spec': sp.tolist(), 'buzz': float(np.median(buzzes)), 'rpm': float(np.median(f0s) * 30), 'n': len(st)}
            print(f'{name} {label}: {len(st)} stretches, ~{np.median(f0s)*30:.0f} rpm, buzz {np.median(buzzes):.2f}, level {np.median(lv):.1f} dB')
            print('   ' + ' '.join(f'{c/1000:.1f}k:{v:4.0f}' if c >= 1000 else f'{c:.0f}:{v:4.0f}' for c, v in zip(CENTRES, sp)))
    pass
