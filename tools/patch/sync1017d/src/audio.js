// 简单的 WebAudio 音效池：同一音效可以叠加播放
// step.ogg 是一串 12 下脚步声，这里记下每一下的起点（秒）
const SEGMENTS = { step: [0, 0.378, 0.749, 1.191, 1.625, 2.016, 2.424, 2.838, 3.221, 3.628, 4.0, 4.443] };
export class Sfx {
  constructor(map) {
    this.map = map;
    this.buffers = {};
    this.ctx = null;
    this.master = null;
  }

  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    await Promise.all(Object.entries(this.map).map(async ([k, url]) => {
      try {
        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        this.buffers[k] = await this.ctx.decodeAudioData(arr);
      } catch (e) {
        console.warn('音效加载失败', k, e);
      }
    }));
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  play(name, volume = 1, rate = 1) {
    const buf = this.buffers[name];
    if (!this.ctx || !buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    // 一个文件里录了好几下的（脚步声）：每次随机放其中一下
    const seg = SEGMENTS[name];
    if (seg) {
      let i = Math.floor(Math.random() * seg.length);
      if (i === this._lastSeg?.[name]) i = (i + 1) % seg.length;
      (this._lastSeg ||= {})[name] = i;
      src.start(0, seg[i], 0.24);
    } else src.start();
  }

  // 消音枪声：同一份枪声，低通滤掉爆鸣的高频、截短尾音（没有回响），
  // 再叠一层很短的高频气流声（“噗嗤”）
  playSuppressed(name, volume = 1, rate = 1) {
    const buf = this.buffers[name];
    if (!this.ctx || !buf) return;
    const t = this.ctx.currentTime;
    const body = this.ctx.createBufferSource();
    body.buffer = buf; body.playbackRate.value = rate;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = 0.8;
    const lp2 = this.ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 2400; lp2.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.setValueAtTime(volume, t + 0.05);
    g.gain.exponentialRampToValueAtTime(volume * 0.12, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    body.connect(lp).connect(lp2).connect(g).connect(this.master);
    body.start(t); body.stop(t + 0.45);
    // 气流声
    const air = this.ctx.createBufferSource();
    air.buffer = buf; air.playbackRate.value = rate * 1.15;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
    const ga = this.ctx.createGain();
    ga.gain.setValueAtTime(volume * 0.35, t);
    ga.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    air.connect(hp).connect(ga).connect(this.master);
    air.start(t); air.stop(t + 0.08);
  }
}
