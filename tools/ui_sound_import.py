# 把下载的界面音效统一处理后放进 Asset/Audio/UI/：
#   去掉首尾静音 → 太长的截断并淡出 → 按 30ms 窗口最大响度对齐到同一目标（悬停音小 6dB）→ 峰值限制 -1dBFS → 转 ogg
# 用法：python3 tools/ui_sound_import.py click=a.mp3 hover=b.mp3 ...
import sys, subprocess, numpy as np
SR = 48000
TARGET = -15.0                      # dBFS
OFFSET = {'hover': -6.0}
MAXLEN = {'start': 1.6, 'confirm': 1.2, 'open': 1.0}
def load(f):
    r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', f, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).astype(float).reshape(-1, 2)
for arg in sys.argv[1:]:
    name, f = arg.split('=', 1)
    y = load(f)
    mono = np.abs(y).max(1)
    nz = np.where(mono > 0.004)[0]
    y = y[max(0, nz[0] - 24): nz[-1] + int(0.03 * SR)]
    cap = int(MAXLEN.get(name, 0.9) * SR)
    if len(y) > cap:
        y = y[:cap].copy(); fd = int(0.2 * SR); y[-fd:] *= (np.linspace(1, 0, fd) ** 2)[:, None]
    w = int(0.03 * SR); e = np.convolve((y ** 2).mean(1), np.ones(w) / w, mode='same')
    lvl = 10 * np.log10(e.max() + 1e-12)
    g = 10 ** ((TARGET + OFFSET.get(name, 0) - lvl) / 20); y = y * g
    pk = np.abs(y).max(); lim = 10 ** (-1 / 20)
    if pk > lim: y = y / pk * lim
    fd = min(len(y), int(0.006 * SR)); y[-fd:] *= np.linspace(1, 0, fd)[:, None]
    raw = '/tmp/ui_import.raw'; (np.clip(y, -1, 1) * 32767).astype('<i2').tofile(raw)
    out = f'Asset/Audio/UI/{name}.ogg'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '2', '-i', raw, '-c:a', 'libvorbis', '-q:a', '5', out], check=True)
    print(f'{name:8s} {lvl:6.1f} dB -> {20*np.log10(g):+5.1f} dB  {len(y)/SR:.2f}s  {out}')
