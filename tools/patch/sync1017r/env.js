import * as THREE from 'three';
import { setCharLight } from './charlight.js';
import { Wetness } from './wet.js';

// 环境：昼夜循环 + 动态天气（晴 / 樱吹雪 / 多云 / 小雨 / 雷雨）
// 一个完整的昼夜默认 12 分钟；天气每 1.5–3 分钟可能变一次，变化时 15 秒左右渐变过去。
// 负责：太阳 / 月亮方向和颜色、半球光、天空球颜色、雾、云的颜色、发光条夜里更亮、雨和樱花粒子、雨声和雷声。

const DAY_SECONDS = 720;             // 现实多少秒 = 游戏里一整天
const START_WEIGHTS = { clear: 0.3, sakura: 0.2, cloudy: 0.2, rain: 0.17, storm: 0.13 };
const pick = (w) => { let r = Math.random(); for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; } return 'clear'; };
const WEATHER = {
  clear:  { name: '晴',   overcast: 0,    rain: 0,   petals: 0.25, storm: 0 },
  sakura: { name: '樱吹雪', overcast: 0,  rain: 0,   petals: 1,    storm: 0 },
  cloudy: { name: '多云', overcast: 0.55, rain: 0,   petals: 0,    storm: 0 },
  rain:   { name: '小雨', overcast: 0.8,  rain: 0.6, petals: 0,    storm: 0 },
  storm:  { name: '雷雨', overcast: 1,    rain: 1,   petals: 0,    storm: 1 },
};
// 天气转移表：下一种天气的权重
const NEXT = {
  clear: { clear: 2, sakura: 2, cloudy: 3 },
  sakura: { clear: 3, sakura: 1, cloudy: 1 },
  cloudy: { clear: 2, rain: 3, sakura: 1 },
  rain: { cloudy: 2, storm: 2, rain: 1 },
  storm: { rain: 3, cloudy: 1 },
};

// 不同太阳高度下的配色（日漫风：白天通透的蓝，黄昏粉橙，夜里深蓝紫但不全黑）
const C = (h) => new THREE.Color(h);
const PALETTE = [
  // 太阳高度 → 天顶 / 中间 / 地平线 / 主光颜色 / 主光强度 / 半球天空色 / 半球地面色 / 半球强度 / 太阳光晕色
  { h: -0.35, top: C('#0a1230'), mid: C('#1b2a5c'), bot: C('#33407a'), key: C('#9db4ff'), keyI: 0.75, sky: C('#7d93d8'), gnd: C('#2a2f55'), hemiI: 1.05, glow: C('#6f86d6') },
  { h: -0.06, top: C('#1d2c66'), mid: C('#6a5aa0'), bot: C('#e7889a'), key: C('#c9b4ff'), keyI: 0.3, sky: C('#a497d8'), gnd: C('#3c3f6e'), hemiI: 1.1, glow: C('#ff8a7a') },
  { h: 0.06, top: C('#3a6bc0'), mid: C('#f3a9b5'), bot: C('#ffd2a1'), key: C('#ffb98c'), keyI: 1.5, sky: C('#ffd8c8'), gnd: C('#7b80b8'), hemiI: 1.3, glow: C('#ffb27a') },
  { h: 0.25, top: C('#4a8fe0'), mid: C('#b9dcff'), bot: C('#f2e6dc'), key: C('#ffe6c8'), keyI: 2.1, sky: C('#f4f6ff'), gnd: C('#93a8d0'), hemiI: 1.55, glow: C('#ffe0b0') },
  { h: 0.6, top: C('#3f8be6'), mid: C('#a6d4ff'), bot: C('#eaf6ff'), key: C('#fff2dd'), keyI: 2.4, sky: C('#ffffff'), gnd: C('#9fb4d6'), hemiI: 1.7, glow: C('#ffe8c0') },
];
const GREY = { top: C('#6f7d8e'), mid: C('#a3adb9'), bot: C('#c4cbd3'), sky: C('#d6dbe2'), gnd: C('#8d97a6') };

function lerpPalette(h) {
  let i = 0;
  while (i < PALETTE.length - 2 && h > PALETTE[i + 1].h) i++;
  const a = PALETTE[i], b = PALETTE[i + 1];
  const k = THREE.MathUtils.smoothstep(h, a.h, b.h);
  const o = {};
  for (const key of Object.keys(a)) {
    if (key === 'h') continue;
    o[key] = typeof a[key] === 'number' ? a[key] + (b[key] - a[key]) * k : a[key].clone().lerp(b[key], k);
  }
  return o;
}

export class Environment {
  constructor({ scene, camera, sun, hemi, built, sfx, viewmodel, hud, game }) {
    this.scene = scene; this.camera = camera; this.sun = sun; this.hemi = hemi; this.built = built;
    this.sfx = sfx; this.viewmodel = viewmodel; this.hud = hud;
    // 开局随机：时间 0～24 点任意，天气按权重随机
    // 地图可以指定开局时间和天气倾向（built.env：hour 开局几点、hourJitter 随机浮动、weather 开局天气权重、next 天气转移表、daySeconds 一天多长）
    const E = built.env || {};
    this.hour = E.hour != null ? (E.hour + (Math.random() - 0.5) * (E.hourJitter || 0) + 24) % 24 : Math.random() * 24;
    this.weather = pick(E.weather || START_WEIGHTS);
    this.next = E.next || NEXT;
    this.daySeconds = E.daySeconds || DAY_SECONDS;
    this.lamps = built.lamps || [];   // 夜里亮、白天几乎不亮的点光源 [{ light, base }]
    this.lampMats = built.lampMats || []; // 跟着路灯一起亮的半透明材质（光锥）[{ mat, base }]
    this.w = { ...WEATHER[this.weather] };      // 当前（渐变中的）天气参数
    this.weatherT = 90 + Math.random() * 90;
    this.cycle = true;
    this.dynamic = true;
    this.flash = 0; this.thunderT = 8;
    this.sunDir = new THREE.Vector3();
    this.keyDir = new THREE.Vector3();
    this.baseFog = built.fog ? [built.fog[1], built.fog[2]] : [60, 260];
    this.glowMats = [built.M?.mint, built.M?.coral, ...(built.glowMats || [])].filter(Boolean);
    this.glowBase = this.glowMats.map((m) => m.emissiveIntensity);
    this.time = 0;
    this._makeRain();
    this._makePetals();
    // 积水和踩水花（需要地图碰撞来找平地）
    if (game) {
      try { this.wetness = new Wetness({ scene, camera, game, built, sfx, rain: this.w.rain }); } catch (e) { console.warn('积水初始化失败', e); }
    }
    this.update(0);
  }

  // 联机：房主同步过来的时间和天气
  applyNet({ h, w }) {
    this.netControlled = true;
    if (w && WEATHER[w] && w !== this.weather) { this.weather = w; if (this.hud && w !== 'clear') this.hud.feed(`天气变化：${WEATHER[w].name}`); }
    if (h != null) {
      let d = h - this.hour; if (d > 12) d -= 24; if (d < -12) d += 24;
      if (Math.abs(d) > 0.08) this.hour = (h + 24) % 24; // 差太多才对齐，平时各自走
    }
  }
  setOptions({ cycle, dynamic }) {
    if (cycle !== undefined) this.cycle = cycle;   // 关闭昼夜循环：时间停在开局随机到的时刻
    if (dynamic !== undefined) {
      this.dynamic = dynamic;
      // 关闭动态天气：保留开局随机到的天气，只是不再变化
    }
  }

  get label() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${WEATHER[this.weather].name}`;
  }

  // —— 雨：相机周围一圈下落的细线，按风斜着走 ——
  _makeRain() {
    const N = 1600;
    const pos = new Float32Array(N * 6);
    this.rainSeed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.rainSeed[i * 3] = (Math.random() - 0.5) * 50;
      this.rainSeed[i * 3 + 1] = Math.random() * 26;
      this.rainSeed[i * 3 + 2] = (Math.random() - 0.5) * 50;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xc8dcf5, transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.userData.noMinimap = true;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  // —— 樱花瓣：粉色小点，左右飘着落 ——
  _makePetals() {
    const N = 420;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d');
    x.translate(16, 16); x.rotate(0.6);
    x.fillStyle = '#ffd3e2';
    x.beginPath(); x.ellipse(0, 0, 13, 7, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ff9fbf'; x.beginPath(); x.ellipse(-3, 0, 6, 3, 0, 0, Math.PI * 2); x.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const pos = new Float32Array(N * 3);
    this.petalSeed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      this.petalSeed[i * 4] = (Math.random() - 0.5) * 60;
      this.petalSeed[i * 4 + 1] = Math.random() * 18;
      this.petalSeed[i * 4 + 2] = (Math.random() - 0.5) * 60;
      this.petalSeed[i * 4 + 3] = Math.random() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.petalMat = new THREE.PointsMaterial({ map: tex, size: 0.34, transparent: true, depthWrite: false, opacity: 0, alphaTest: 0.05 });
    this.petals = new THREE.Points(g, this.petalMat);
    this.petals.frustumCulled = false;
    this.petals.userData.noMinimap = true;
    this.scene.add(this.petals);
  }

  // —— 雨声：用白噪声 + 滤波现场合成，雨越大越响 ——
  _rainSound(level) {
    const ctx = this.sfx?.ctx;
    if (!ctx || !this.sfx.master) return;
    if (!this._rainNode && level > 0.01) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * 0.6 + w * 0.4; d[i] = last; }
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.6;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(bp).connect(lp).connect(g).connect(this.sfx.master);
      src.start();
      this._rainNode = { src, g };
    }
    if (this._rainNode) this._rainNode.g.gain.setTargetAtTime(level * 0.22, ctx.currentTime, 0.5);
  }
  _thunder() {
    const ctx = this.sfx?.ctx;
    this.flash = 1;
    if (!ctx || !this.sfx.master) return;
    // 雷声：延迟一点的低频噪声隆隆声
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.985 + (Math.random() * 2 - 1) * 0.06; d[i] = last * Math.pow(1 - i / len, 1.6) * (1 + 0.6 * Math.sin(i / ctx.sampleRate * 9)); }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280;
    const g = ctx.createGain(); g.gain.value = 2.4;
    src.connect(lp).connect(g).connect(this.sfx.master);
    src.start(ctx.currentTime + 0.4 + Math.random() * 1.2);
  }

  update(dt) {
    this.time += dt;
    if (this.cycle) this.hour = (this.hour + dt * 24 / this.daySeconds) % 24;

    // —— 天气切换 ——
    if (this.dynamic && !this.netControlled) { // 联机：天气由房主决定（netControlled 时只听房主的）
      this.weatherT -= dt;
      if (this.weatherT <= 0) {
        const opts = this.next[this.weather] || NEXT[this.weather];
        let r = Math.random() * Object.values(opts).reduce((a, b) => a + b, 0);
        for (const [k, v] of Object.entries(opts)) { r -= v; if (r <= 0) { this.weather = k; break; } }
        this.weatherT = 90 + Math.random() * 90;
        if (this.hud && this.weather !== 'clear') this.hud.feed(`天气变化：${WEATHER[this.weather].name}`);
      }
    }
    const T = WEATHER[this.weather];
    const k = 1 - Math.exp(-dt / 5); // 约 15 秒渐变到位
    for (const key of ['overcast', 'rain', 'petals', 'storm']) this.w[key] += (T[key] - this.w[key]) * k;
    const W = this.w;

    // —— 太阳 / 月亮位置：6 点日出、18 点日落，轨道稍微斜一点 ——
    const a = (this.hour - 6) / 12 * Math.PI;      // 0 = 日出，π = 日落
    this.sunDir.set(Math.cos(a) * 0.85, Math.sin(a), 0.42).normalize();
    const elev = this.sunDir.y;
    const moonDir = this.sunDir.clone().negate();
    moonDir.y = Math.abs(moonDir.y) * 0.9 + 0.1; moonDir.normalize();
    const night = THREE.MathUtils.clamp(-elev * 4, 0, 1);

    const P = lerpPalette(elev);
    // 阴天：天空往灰色靠，主光变弱
    const oc = W.overcast;
    const grey = (c, g) => c.lerp(g.clone().multiplyScalar(THREE.MathUtils.lerp(1, 0.35, night)), oc * 0.85);
    grey(P.top, GREY.top); grey(P.mid, GREY.mid); grey(P.bot, GREY.bot); grey(P.sky, GREY.sky); grey(P.gnd, GREY.gnd);

    // 闪电
    if (W.storm > 0.6) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) { this._thunder(); this.thunderT = 6 + Math.random() * 14; }
    }
    this.flash = Math.max(0, this.flash - dt * 3.5);
    const fl = this.flash > 0 ? (Math.random() < 0.7 ? this.flash : 0) : 0;

    // —— 天空球 ——
    const sky = this.built.sky;
    if (sky) {
      const u = sky.material.uniforms;
      u.top.value.copy(P.top); u.mid.value.copy(P.mid); u.bottom.value.copy(P.bot);
      u.sunColor.value.copy(P.glow);
      u.sunDir.value.copy(this.sunDir); u.moonDir.value.copy(moonDir);
      u.night.value = night; u.overcast.value = oc; u.time.value = this.time; u.flash.value = fl * 0.6;
    }
    if (this.built.cloudMat) {
      this.built.cloudMat.color.copy(P.mid).lerp(new THREE.Color(1, 1, 1), 0.55 * (1 - night)).multiplyScalar(1 - oc * 0.25);
      this.built.cloudMat.opacity = 0.95;
    }

    // —— 灯光：白天跟着太阳，夜里换成月光；地平线附近两者都很弱，顺便切换方向 ——
    const useMoon = elev < -0.02;
    this.keyDir.copy(useMoon ? moonDir : this.sunDir);
    if (this.keyDir.y < 0.25) { this.keyDir.y = 0.25; this.keyDir.normalize(); } // 太低的角度阴影会拉得太长
    const horizonFade = THREE.MathUtils.smoothstep(Math.abs(elev), 0.0, 0.08);
    this.sun.color.copy(P.key);
    this.sun.intensity = P.keyI * (useMoon ? 1 : horizonFade * 0.7 + 0.3) * (1 - oc * 0.65) + fl * 2.5;
    this.hemi.color.copy(P.sky); this.hemi.groundColor.copy(P.gnd);
    this.hemi.intensity = P.hemiI * (1 - oc * 0.15) + fl * 1.5;
    if (this.viewmodel?.hemi) {
      this.viewmodel.hemi.color.copy(P.sky); this.viewmodel.hemi.groundColor.copy(P.gnd); this.viewmodel.hemi.intensity = this.hemi.intensity;
      this.viewmodel.sun.color.copy(P.key); this.viewmodel.sun.intensity = this.sun.intensity * 0.92;
    }

    // —— 雾：颜色跟地平线一致，下雨时拉近 ——
    if (this.scene.fog) {
      this.scene.fog.color.copy(P.bot).lerp(P.mid, 0.4);
      this.scene.fog.near = this.baseFog[0] * (1 - W.rain * 0.7);
      this.scene.fog.far = this.baseFog[1] * (1 - W.rain * 0.55);
    }
    this.scene.background?.copy?.(P.mid);

    // —— 角色材质：matcap 假反光和头发自发光跟着天色变暗，避免夜里一圈亮边 ——
    const dim = (1 - night * 0.85) * (1 - oc * 0.45);
    setCharLight(dim * 0.2, 0.35 + 0.65 * dim);   // matcap 白天也只留两成，当作很淡的高光

    // —— 发光条：夜里更亮 ——
    this.glowMats.forEach((m, i) => { m.emissiveIntensity = this.glowBase[i] * (1 + night * 1.6 + oc * 0.4); });
    // 路灯、招牌的点光源：天黑或阴雨时亮起来
    if (this.lamps.length || this.lampMats.length) {
      const k = THREE.MathUtils.clamp(night + oc * 0.35, 0.08, 1);
      for (const l of this.lamps) l.light.intensity = l.base * k;
      for (const m of this.lampMats) m.mat.opacity = m.base * k;
    }

    // —— 粒子 ——
    const cam = this.camera.position;
    const rainOn = W.rain > 0.02;
    this.rain.visible = rainOn;
    if (rainOn) {
      const arr = this.rain.geometry.attributes.position.array, S = this.rainSeed, n = S.length / 3;
      const fall = (this.time * 22) % 26, wind = 0.35;
      const shown = Math.floor(n * Math.min(1, W.rain));
      for (let i = 0; i < n; i++) {
        const o = i * 6;
        if (i >= shown) { arr[o] = arr[o + 3] = 1e5; continue; }
        let y = S[i * 3 + 1] - fall; y = ((y % 26) + 26) % 26;
        const x = cam.x + ((S[i * 3] - cam.x) % 50 + 75) % 50 - 25, z = cam.z + ((S[i * 3 + 2] - cam.z) % 50 + 75) % 50 - 25;
        const yy = cam.y - 8 + y;
        arr[o] = x; arr[o + 1] = yy; arr[o + 2] = z;
        arr[o + 3] = x + wind * 0.5; arr[o + 4] = yy + 0.9; arr[o + 5] = z + wind * 0.2;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rainMat.opacity = 0.25 + 0.25 * W.rain;
      this.rainMat.color.copy(P.sky).lerp(new THREE.Color(0.8, 0.86, 0.95), 0.5);
    }
    this._rainSound(W.rain);
    this.wetness?.update(dt, W.rain, P, night);

    const petalOn = W.petals > 0.02 && night < 0.9;
    this.petals.visible = petalOn;
    if (petalOn) {
      const arr = this.petals.geometry.attributes.position.array, S = this.petalSeed, n = S.length / 4;
      const t = this.time;
      for (let i = 0; i < n; i++) {
        const ph = S[i * 4 + 3];
        let y = S[i * 4 + 1] - t * (0.7 + (ph % 1) * 0.5); y = ((y % 18) + 18) % 18;
        const sx = Math.sin(t * 0.8 + ph) * 1.2 + t * 1.1, sz = Math.cos(t * 0.6 + ph * 1.3) * 1.0 + t * 0.4;
        arr[i * 3] = cam.x + (((S[i * 4] + sx - cam.x) % 60) + 90) % 60 - 30;
        arr[i * 3 + 1] = cam.y - 4 + y;
        arr[i * 3 + 2] = cam.z + (((S[i * 4 + 2] + sz - cam.z) % 60) + 90) % 60 - 30;
      }
      this.petals.geometry.attributes.position.needsUpdate = true;
      this.petalMat.opacity = Math.min(1, W.petals) * (1 - night);
    }
  }

  // 画风后期用：夜晚程度、雨量、黄昏暖色
  styleParams() {
    const night = THREE.MathUtils.clamp(-this.sunDir.y * 4, 0, 1);
    const warm = THREE.MathUtils.clamp(1 - Math.abs(this.sunDir.y - 0.05) * 6, 0, 1);
    return { night, rain: this.w.rain, warm };
  }

  // 辉光只给比“被照亮的白墙”还亮的东西（发光条、棱镜、枪口火光）：阈值跟着当前光照强度走；夜里强一点
  bloomParams() {
    const night = THREE.MathUtils.clamp(-this.sunDir.y * 4, 0, 1);
    const lit = this.sun.intensity + this.hemi.intensity;
    return { strength: 0.2 + night * 0.55, threshold: Math.max(0.5, lit * (1.02 - night * 0.45)), radius: 0.5 };
  }
}
