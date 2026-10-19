import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

// 雨天地面：积水 + 角色踩水溅起水花
//  · 地面湿度 wet：下雨时慢慢变湿（约 20 秒），雨停后慢慢变干（约 1 分钟）
//  · 积水：开局在露天的平地上随机撒一批水洼（一个合并网格、一次绘制），越湿水洼越大越明显，
//    画法是日系动画里常见的：映着天空颜色、带一圈亮边、雨点打出一圈圈涟漪
//  · 湿地面：地砖颜色压暗一点、偏冷
//  · 水花：角色在水洼里走 / 跑每一步溅起水珠和一圈波纹，跳下来落地溅得更大，附近还有踩水声

const PUDDLE_VERT = /* glsl */`
attribute float aSeed;
uniform mat4 textureMatrix;
varying vec2 vUv;
varying vec3 vW;
varying float vSeed;
varying vec4 vUvR;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vSeed = aSeed;
  vUvR = textureMatrix * vec4(position, 1.0);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

// 水洼：主地面那一层用实时镜面倒影（Reflector 渲染的倒影图），其他高度的水洼只映天空颜色。
// 为了“融进地面”而不是像贴纸：
//  · 菲涅尔：俯视时水几乎透明，只看到被水浸暗的地面；越斜着看倒影越强
//  · 轮廓用世界坐标噪声生成，边缘是一圈渐变的湿痕，没有硬边和白线
//  · 涟漪只扭曲倒影 + 很淡的高光，不画成一圈圈的线
const PUDDLE_FRAG = /* glsl */`
uniform float uTime, uWet, uRain, uHasRefl;
uniform vec3 uSky, uSkyTop, uHi;
uniform sampler2D tDiffuse;
varying vec2 vUv;
varying vec3 vW;
varying float vSeed;
varying vec4 vUvR;
#include <fog_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { return vn(p) * 0.55 + vn(p * 2.1 + 3.7) * 0.3 + vn(p * 4.3 + 7.1) * 0.15; }
void main() {
  float r = length(vUv);
  // 轮廓：中间深、往外被噪声啃出不规则的边；地面越干，水退得越小
  float shape = (1.0 - r) + (fbm(vW.xz * 0.9 + vSeed * 13.0) - 0.5) * 0.5;
  float bound = 1.0 - smoothstep(0.82, 0.98, r);          // 不超出四边形，避免被切成直边
  float lvl = mix(0.55, 0.12, uWet);
  float water = smoothstep(lvl, lvl + 0.08, shape) * bound; // 有积水的部分
  float damp = smoothstep(lvl - 0.22, lvl, shape) * bound;  // 外面一圈湿痕
  if (damp < 0.01) discard;

  // 雨点涟漪：只用来扭曲倒影和加一点点高光
  vec2 push = vec2(0.0);
  float glint = 0.0;
  for (int k = 0; k < 2; k++) {
    vec2 g = vW.xz * 2.2 + float(k) * vec2(0.37, 0.71);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float ph = h21(id + float(k) * 7.3);
    vec2 off = vec2(h21(id + 1.7), h21(id + 3.1)) - 0.5;
    float t = fract(uTime * (0.9 + 0.5 * ph) + ph);
    vec2 dv = f - off * 0.4;
    float d = length(dv);
    float on = step(h21(id + 9.2 + floor(uTime * (0.9 + 0.5 * ph) + ph)), uRain);
    float ring = on * (1.0 - t) * (1.0 - smoothstep(0.0, 0.05, abs(d - t * 0.38)));
    push += ring * dv / max(d, 1e-3);
    glint += ring;
  }

  // 菲涅尔：视线越贴着水面越像镜子
  vec3 V = normalize(cameraPosition - vW);
  float F = mix(0.3, 1.0, pow(1.0 - abs(V.y), 2.5));

  // 倒影（没有实时倒影时用天空颜色）
  vec3 refl = mix(uSky, uSkyTop, 0.35 + 0.3 * vn(vW.xz * 0.2));
  if (uHasRefl > 0.5) {
    vec2 wob = vec2(vn(vW.xz * 3.0 + uTime * 0.6) - 0.5, vn(vW.zx * 3.0 - uTime * 0.5) - 0.5) * 0.006 + push * 0.01;
    vec4 ru = vUvR; ru.xy += wob * ru.w;
    refl = texture2DProj(tDiffuse, ru).rgb * 0.88;
  }
  refl += uHi * glint * 0.12;

  // 合成：水面 = 地面被浸暗（透过去） + 倒影（按菲涅尔）；湿痕只把地面压暗一点
  float darkWater = 0.4, darkDamp = 0.18;
  float reflA = F * water;
  float dark = mix(darkDamp * damp, darkWater, water) * (1.0 - reflA);
  float a = reflA + dark;
  vec3 col = refl * reflA / max(a, 1e-3);
  a *= smoothstep(0.05, 0.3, uWet);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const DROP_VERT = /* glsl */`
attribute float aLife;
varying float vLife;
uniform float uSize, uScale;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * (0.45 + 0.55 * aLife) * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
  if (aLife <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const DROP_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vLife;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (d > 0.5) discard;
  float a = (1.0 - smoothstep(0.25, 0.5, d)) * min(1.0, vLife * 2.5);
  gl_FragColor = vec4(uColor + 0.25 * (1.0 - smoothstep(0.0, 0.3, length(p + vec2(0.12, -0.12)))), a * 0.9);
  #include <colorspace_fragment>
}`;

const MAX_DROPS = 500;
const MAX_RINGS = 24;

export class Wetness {
  static reflect = true; // 设置里的「积水倒影」
  constructor({ scene, camera, game, built, sfx, rain }) {
    this.scene = scene; this.camera = camera; this.game = game; this.sfx = sfx;
    this.wet = targetWet(rain);
    this.rain = rain;
    this.time = 0;
    this.hi = new THREE.Color(1, 1, 1);
    // 湿地面：只改地面类材质的颜色
    this.groundMats = (built.wetMats || ['floor', 'stone', 'inlay', 'gray'].map((k) => built.M?.[k])).filter(Boolean);
    this.groundBase = this.groundMats.map((m) => m.color.clone());
    const t0 = performance.now();
    this._makePuddles();
    this.buildMs = performance.now() - t0;
    this._makeDrops();
    this._makeRings();
    this._applyGround();
  }

  // —— 开局撒水洼：随机找露天、够平、够大的地面 ——
  _makePuddles() {
    const g = this.game, box = g.worldBox;
    this.puddles = [];
    if (!box || box.isEmpty()) return;
    const W = box.max.x - box.min.x, D = box.max.z - box.min.z;
    const want = THREE.MathUtils.clamp(Math.round(W * D / 70), 16, 60);
    const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0), o = new THREE.Vector3();
    const top = box.max.y + 2;
    for (let tries = 0; tries < want * 14 && this.puddles.length < want; tries++) {
      const x = box.min.x + 1.5 + Math.random() * (W - 3), z = box.min.z + 1.5 + Math.random() * (D - 3);
      const hit = g.raycastWorld(o.set(x, top, z), down);
      if (!hit || hit.normal.y < 0.985) continue;
      const y = hit.position.y;
      const r = 0.7 + Math.random() * 1.5;
      const ax = 0.75 + Math.random() * 0.5, az = 1.6 - ax;   // 椭圆一点
      const rot = Math.random() * Math.PI;
      if (this.puddles.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 1.15)) continue;
      // 头顶要露天（屋檐、树下不积水）
      if (g.raycastWorld(o.set(x, y + 0.05, z), up)) continue;
      // 周围一圈都要是同一高度的平地（不跨台阶、不悬空在边上）
      let flat = true;
      for (let i = 0; i < 6 && flat; i++) {
        const a = i / 6 * Math.PI * 2;
        const lx = Math.cos(a) * r * ax, lz = Math.sin(a) * r * az;
        const px = x + lx * Math.cos(rot) - lz * Math.sin(rot), pz = z + lx * Math.sin(rot) + lz * Math.cos(rot);
        const h = g.raycastWorld(o.set(px, y + 0.6, pz), down, 1.2);
        if (!h || Math.abs(h.position.y - y) > 0.02 || h.normal.y < 0.985) flat = false;
      }
      if (!flat) continue;
      this.puddles.push({ x, y, z, r, ax, az, rot, cos: Math.cos(rot), sin: Math.sin(rot), seed: Math.random() });
    }
    if (!this.puddles.length) return;
    // 按高度分组：数量最多的那一层（一般是主地面）做实时倒影，其他层只映天空
    const groups = new Map();
    for (const p of this.puddles) {
      const k = Math.round(p.y * 20);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
    const main = sorted[0], rest = sorted.slice(1).flat();
    this.puddleMats = [];
    this.puddleMeshes = [];
    const uniforms = () => THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uWet: { value: 0 }, uRain: { value: 0 }, uHasRefl: { value: 0 },
      uSky: { value: new THREE.Color() }, uSkyTop: { value: new THREE.Color() }, uHi: { value: new THREE.Color() },
      tDiffuse: { value: null }, color: { value: new THREE.Color() }, textureMatrix: { value: new THREE.Matrix4() },
    }]);
    const setup = (mesh) => {
      const m = mesh.material;
      Object.assign(m, { side: THREE.DoubleSide, transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      m.needsUpdate = true;
      mesh.renderOrder = 1;
      mesh.userData.noMinimap = true;
      mesh.userData.noInk = true;
      this.puddleMats.push(m);
      this.puddleMeshes.push(mesh);
      this.scene.add(mesh);
    };
    // 主层：Reflector 网格在自己的 XY 平面里，转平放到地面高度（局部 (x, -z) = 世界 (x, z)）
    const y0 = main[0].y;
    const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.38;
    const refl = new Reflector(puddleGeometry(main, true), {
      shader: { name: 'Puddle', uniforms: uniforms(), vertexShader: PUDDLE_VERT, fragmentShader: PUDDLE_FRAG },
      textureWidth: Math.round(innerWidth * scale), textureHeight: Math.round(innerHeight * scale), clipBias: 0.003, multisample: 0,
    });
    refl.rotation.x = -Math.PI / 2;
    refl.position.y = y0 + 0.012;
    refl.material.uniforms.uHasRefl.value = 1;
    // 倒影要额外把场景画一遍：关掉倒影、地面不湿、或者这一帧没看到水洼时都不画
    const draw = refl.onBeforeRender;
    // 倒影只画近处（远处在水洼里本来就看不清）：临时把镜头远平面拉近，远处物体直接被视锥剔掉
    refl.onBeforeRender = (renderer, scene, camera, ...rest) => {
      if (!(Wetness.reflect && this.wet > 0.05)) return;
      const far = camera.far, cut = Math.min(far, 70);
      if (cut < far) { camera.far = cut; camera.updateProjectionMatrix(); }
      draw.call(refl, renderer, scene, camera, ...rest);
      if (cut < far) { camera.far = far; camera.updateProjectionMatrix(); }
    };
    this.reflector = refl;
    setup(refl);
    if (rest.length) {
      const mesh = new THREE.Mesh(puddleGeometry(rest, false), new THREE.ShaderMaterial({ uniforms: uniforms(), vertexShader: PUDDLE_VERT, fragmentShader: PUDDLE_FRAG }));
      setup(mesh);
    }
  }

  // —— 水珠：一个点精灵池 ——
  _makeDrops() {
    this.dPos = new Float32Array(MAX_DROPS * 3);
    this.dVel = new Float32Array(MAX_DROPS * 3);
    this.dLife = new Float32Array(MAX_DROPS);      // 剩余寿命比例 0–1（给着色器）
    this.dT = new Float32Array(MAX_DROPS * 3);     // 已过时间 / 总寿命 / 落地高度
    this.dNext = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dPos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.dLife, 1));
    this.dropMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.85, 0.93, 1) }, uSize: { value: 0.06 }, uScale: { value: 600 } },
      vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, transparent: true, depthWrite: false,
    });
    this.drops = new THREE.Points(geo, this.dropMat);
    this.drops.frustumCulled = false;
    this.drops.userData.noMinimap = true;
    this.scene.add(this.drops);
  }

  // —— 波纹圈：一小池扁平圆环 ——
  _makeRings() {
    const geo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      m.visible = false;
      m.renderOrder = 2;
      m.userData.noMinimap = true;
      this.scene.add(m);
      this.rings.push({ m, t: 0, life: 1, size: 1 });
    }
    this.ringNext = 0;
  }

  _applyGround() {
    // 越湿越暗、越偏冷（像刚下过雨的石板）
    const k = this.wet;
    this.groundMats.forEach((m, i) => {
      m.color.copy(this.groundBase[i]).multiply(_tint.setRGB(1 - 0.34 * k, 1 - 0.3 * k, 1 - 0.2 * k));
    });
  }

  // 脚下这个点在不在水洼里（水洼随湿度缩放）
  puddleAt(p) {
    if (this.wet < 0.2) return null;
    const s = THREE.MathUtils.lerp(0.3, 1, this.wet) * 0.8;
    for (const q of this.puddles) {
      if (Math.abs(p.y - q.y) > 0.3) continue;
      const dx = p.x - q.x, dz = p.z - q.z;
      const lx = (dx * q.cos + dz * q.sin) / (q.r * q.ax), lz = (-dx * q.sin + dz * q.cos) / (q.r * q.az);
      if (lx * lx + lz * lz < s * s) return q;
    }
    return null;
  }

  // 溅水：pos 落点，vel 角色速度，power 1 = 走一步，2.2 = 跳下来落地
  splash(pos, vel, power = 1) {
    const camD = pos.distanceTo(this.camera.position);
    if (camD > 45) return;
    const n = Math.round(10 * power + 4);
    for (let i = 0; i < n; i++) {
      const j = this.dNext; this.dNext = (this.dNext + 1) % MAX_DROPS;
      const a = Math.random() * Math.PI * 2, out = (0.6 + Math.random() * 1.3) * (0.7 + power * 0.35);
      this.dPos[j * 3] = pos.x + Math.cos(a) * 0.12; this.dPos[j * 3 + 1] = pos.y + 0.04; this.dPos[j * 3 + 2] = pos.z + Math.sin(a) * 0.12;
      this.dVel[j * 3] = Math.cos(a) * out + vel.x * 0.25;
      this.dVel[j * 3 + 1] = (1.6 + Math.random() * 1.8) * (0.75 + power * 0.3);
      this.dVel[j * 3 + 2] = Math.sin(a) * out + vel.z * 0.25;
      this.dT[j * 3] = 0; this.dT[j * 3 + 1] = 0.35 + Math.random() * 0.3; this.dT[j * 3 + 2] = pos.y;
      this.dLife[j] = 1;
    }
    for (let i = 0; i < (power > 1.5 ? 2 : 1); i++) {
      const R = this.rings[this.ringNext]; this.ringNext = (this.ringNext + 1) % MAX_RINGS;
      R.m.position.set(pos.x, pos.y + 0.02, pos.z);
      R.t = -i * 0.12; R.life = 0.55 + power * 0.15; R.size = (0.3 + power * 0.22) * (1 + i * 0.5);
      R.m.visible = true;
    }
    if (camD < 18) this._splashSound(Math.min(1, power * 0.55) * (1 - camD / 18));
  }

  _splashSound(v) {
    const ctx = this.sfx?.ctx;
    if (!ctx || !this.sfx.master || v < 0.03) return;
    if (!this._splashBuf) {
      const len = Math.floor(ctx.sampleRate * 0.22);
      const b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // 白噪声 + 几个短促的“咕嘟”泡泡声，衰减很快
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, 3) * 0.8 + Math.sin(i / ctx.sampleRate * 2 * Math.PI * (900 - 600 * t)) * Math.exp(-t * 14) * 0.5);
      }
      this._splashBuf = b;
    }
    const src = ctx.createBufferSource(); src.buffer = this._splashBuf;
    src.playbackRate.value = 0.85 + Math.random() * 0.35;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 900; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = v * 0.5;
    src.connect(bp).connect(g).connect(this.sfx.master);
    src.start();
  }

  // 每帧：湿度、水洼颜色、角色踩水、粒子
  update(dt, rain, P, night) {
    this.time += dt;
    this.rain = rain;
    const target = targetWet(rain);
    this.wet += (target - this.wet) * Math.min(1, dt / (target > this.wet ? 18 : 60));
    this._applyGround();

    if (this.puddleMats?.length) {
      this.hi.copy(P.sky).lerp(_white, 0.5).multiplyScalar(THREE.MathUtils.lerp(0.9, 0.55, night));
      for (const m of this.puddleMats) {
        const u = m.uniforms;
        u.uTime.value = this.time; u.uWet.value = this.wet; u.uRain.value = Math.min(1, rain * 1.1);
        u.uSky.value.copy(P.mid).lerp(P.top, 0.45).multiplyScalar(0.8);
        u.uSkyTop.value.copy(P.top).multiplyScalar(0.85);
        u.uHi.value.copy(this.hi);
      }
      if (this.reflector) this.reflector.material.uniforms.uHasRefl.value = Wetness.reflect ? 1 : 0; // 关掉倒影时退回只映天空
      for (const mesh of this.puddleMeshes) mesh.visible = this.wet > 0.05;
    }
    this.dropMat.uniforms.uColor.value.copy(this.hi).lerp(_white, 0.3);
    this.dropMat.uniforms.uScale.value = window.innerHeight * 0.9 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);

    // —— 角色踩水 ——
    if (this.puddles.length && this.wet > 0.2) {
      const chars = [this.game.player, ...(this.game.dummies?.bots || [])];
      for (const c of chars) {
        if (!c || !c.alive || !c.capsule) continue;
        c.feet(_p);
        const hv = Math.hypot(c.vel.x, c.vel.z);
        if (!c.onFloor) { c._wetFall = Math.min(c._wetFall ?? 0, c.vel.y); c._wetAir = true; continue; }
        if (c._wetAir) { // 刚落地
          const fall = -(c._wetFall ?? 0);
          c._wetAir = false; c._wetFall = 0;
          if (fall > 3 && this.puddleAt(_p)) { this.splash(_p, c.vel, Math.min(2.4, 1.2 + fall * 0.12)); c._wetDist = 0; continue; }
        }
        if (hv < 0.8) { c._wetDist = 0.6; continue; } // 站着不动不溅；一起步马上踩出第一下
        c._wetDist = (c._wetDist ?? 0) + hv * dt;
        const stride = hv > 5 ? 1.25 : 0.9;
        if (c._wetDist >= stride) {
          c._wetDist = 0;
          if (this.puddleAt(_p)) this.splash(_p, c.vel, THREE.MathUtils.clamp(hv / 6, 0.6, 1.3));
        }
      }
    }

    // —— 水珠 ——
    let any = false;
    for (let j = 0; j < MAX_DROPS; j++) {
      if (this.dLife[j] <= 0) continue;
      any = true;
      const t = (this.dT[j * 3] += dt), life = this.dT[j * 3 + 1];
      this.dVel[j * 3 + 1] -= 11 * dt;
      this.dPos[j * 3] += this.dVel[j * 3] * dt;
      this.dPos[j * 3 + 1] += this.dVel[j * 3 + 1] * dt;
      this.dPos[j * 3 + 2] += this.dVel[j * 3 + 2] * dt;
      const below = this.dPos[j * 3 + 1] < this.dT[j * 3 + 2] && this.dVel[j * 3 + 1] < 0;
      this.dLife[j] = t >= life || below ? 0 : 1 - t / life;
    }
    if (any || this._dropsDirty) {
      this.drops.geometry.attributes.position.needsUpdate = true;
      this.drops.geometry.attributes.aLife.needsUpdate = true;
    }
    this._dropsDirty = any;

    // —— 波纹圈 ——
    for (const R of this.rings) {
      if (!R.m.visible) continue;
      R.t += dt;
      if (R.t < 0) { R.m.material.opacity = 0; continue; }
      const k = R.t / R.life;
      if (k >= 1) { R.m.visible = false; continue; }
      R.m.scale.setScalar(R.size * (0.15 + 0.85 * Math.sqrt(k)));
      R.m.material.opacity = 0.28 * (1 - k);
      R.m.material.color.copy(this.hi).lerp(_white, 0.4);
    }
  }
}

const _tint = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);
const _p = new THREE.Vector3();
// 水洼几何：每个水洼一个四边形；local=true 时坐标放在 XY 平面里（给 Reflector 用）
function puddleGeometry(list, local) {
  const n = list.length;
  const pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), seed = new Float32Array(n * 4), idx = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  list.forEach((p, i) => {
    corners.forEach(([u, v], c) => {
      const lx = u * p.r * p.ax, lz = v * p.r * p.az;
      const wx = p.x + lx * p.cos - lz * p.sin, wz = p.z + lx * p.sin + lz * p.cos;
      pos.set(local ? [wx, -wz, 0] : [wx, p.y + 0.012, wz], (i * 4 + c) * 3);
      uv.set([u, v], (i * 4 + c) * 2);
      seed[i * 4 + c] = p.seed;
    });
    const b = i * 4;
    // 两种坐标系下三角形朝向都要朝上
    if (local) idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

function targetWet(rain) { return rain > 0.12 ? Math.min(1, 0.35 + rain * 0.9) : 0; }
