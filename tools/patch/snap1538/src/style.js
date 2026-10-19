import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// 画风后期（一次全屏处理完）：
//  · 手绘墨线：额外渲染一张“法线 + 深度”图，在物体轮廓、折角处画线（线条颜色取底下颜色的深色版，像手描的），
//    采样位置带一点固定的抖动，线不是死板的直线；远处的线渐渐淡掉，避免糊成一片
//  · 纸张质感：细颗粒 + 很淡的大块水彩斑驳
//  · 调色：饱和度、冷暗部 / 暖亮部的分离色调（夜里更明显）、轻微抬黑、暗角
//  · 下雨时镜头上的水珠：会折射后面的画面，慢慢出现又消失

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

const FRAG = /* glsl */`
uniform sampler2D tDiffuse, tNormal, tDepth;
uniform vec2 res;
uniform float dbg, near, far, time, ink, inkOn, sat, vig, rain, night, paper;
uniform vec3 shadowTint, highTint;
varying vec2 vUv;

float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y);
}
float linDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float z = d * 2.0 - 1.0;
  return (2.0 * near * far) / (far + near - z * (far - near));
}
vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

// 镜头水珠：分格，每格一颗，随机大小和出现时间
vec3 drops(vec2 uv, out float mask) {
  vec2 a = vec2(res.x / res.y, 1.0);
  vec2 g = uv * a * 9.0;
  vec2 id = floor(g), f = fract(g) - 0.5;
  float r = h12(id);
  float life = fract(time * (0.05 + 0.08 * r) + r * 7.0);
  float on = step(1.0 - rain * 0.3, h12(id + 3.7));
  vec2 c = (vec2(h12(id + 1.3), h12(id + 2.9)) - 0.5) * 0.6;
  float size = (0.06 + 0.12 * h12(id + 5.1)) * smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.75, 1.0, life));
  vec2 d = f - c;
  d.y *= 1.0 + 0.25 * step(0.0, d.y); // 下面稍微鼓一点，像挂着的水珠
  float l = length(d);
  mask = on * (1.0 - smoothstep(size * 0.85, size, l));
  return vec3(d / max(size, 1e-3), l / max(size, 1e-3));
}

void main() {
  vec2 px = 1.0 / res;
  vec2 uv = vUv;

  // —— 镜头水珠：折射 ——
  float dm = 0.0;
  vec3 dd = vec3(0.0);
  if (rain > 0.01) {
    dd = drops(uv, dm);
    uv -= dd.xy * 0.035 * dm * vec2(res.y / res.x, 1.0);
  }

  vec4 col = texture2D(tDiffuse, uv);
  vec3 c = col.rgb;

  // —— 手绘墨线 ——
  if (inkOn > 0.5) {
    // 固定的手抖：每个位置偏一点点（不随时间动，避免线条闪）
    vec2 w = (vec2(vnoise(uv * res * 0.045), vnoise(uv * res * 0.045 + 17.0)) - 0.5) * 1.6 * px;
    vec2 u0 = uv + w;
    float th = max(1.0, res.y / 760.0);
    vec2 o = px * th;
    float dc = linDepth(u0);
    float dl = linDepth(u0 - vec2(o.x, 0.0)), dr = linDepth(u0 + vec2(o.x, 0.0));
    float du = linDepth(u0 + vec2(0.0, o.y)), dn = linDepth(u0 - vec2(0.0, o.y));
    // 深度二阶差：只在轮廓、台阶边缘有反应，大平面（地面斜看）不会误判
    float lap = (abs(dl + dr - 2.0 * dc) + abs(du + dn - 2.0 * dc)) / dc;
    float eDepth = smoothstep(0.025, 0.07, lap);
    // 法线：折角
    vec3 nc = nrm(u0);
    float nd = (1.0 - dot(nc, nrm(u0 - vec2(o.x, 0.0)))) + (1.0 - dot(nc, nrm(u0 + vec2(o.x, 0.0))))
             + (1.0 - dot(nc, nrm(u0 + vec2(0.0, o.y)))) + (1.0 - dot(nc, nrm(u0 - vec2(0.0, o.y))));
    float eNorm = smoothstep(0.3, 0.7, nd);
    float e = max(eDepth, eNorm);
    // 角色：中心或旁边是角色的像素，只画很淡、和底色同色系的线（角色自己已经有描边了）
    float ch = 1.0 - min(min(texture2D(tNormal, u0).a, texture2D(tNormal, u0 - vec2(o.x, 0.0)).a),
                         min(min(texture2D(tNormal, u0 + vec2(o.x, 0.0)).a, texture2D(tNormal, u0 + vec2(0.0, o.y)).a), texture2D(tNormal, u0 - vec2(0.0, o.y)).a));
    // 天空（没有几何体）那一侧不画；远处渐淡
    float sky = step(far * 0.98, min(min(dl, dr), min(min(du, dn), dc)));
    e *= (1.0 - sky) * (1.0 - smoothstep(55.0, 150.0, dc));
    // 线条也不是均匀的：沿屏幕有轻微的浓淡变化
    e *= 0.75 + 0.25 * vnoise(uv * res * 0.02);
    if (dbg > 2.5) { gl_FragColor = vec4(vec3(e, eDepth, eNorm), 1.0); return; }
    vec3 inkCol = mix(vec3(0.06, 0.07, 0.11), min(c, vec3(1.0)) * 0.45, 0.6);
    inkCol = mix(inkCol, c * 0.62, ch);
    c = mix(c, inkCol, clamp(e * ink * (1.0 - 0.55 * ch), 0.0, 1.0));
  }

  // —— 调色 ——
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // 高光柔和压缩：大白地面不再一片死白，亮处留住层次
  c *= 1.0 / (1.0 + 0.45 * max(l - 0.8, 0.0));
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, sat);
  float lt = clamp(l / (l + 0.6), 0.0, 1.0);          // 压到 0–1 的亮度，用来分暗部 / 亮部
  c *= mix(shadowTint, vec3(1.0), smoothstep(0.0, 0.55, lt));
  c *= mix(vec3(1.0), highTint, smoothstep(0.35, 0.95, lt));
  c = c * 0.97 + vec3(0.012, 0.014, 0.022);            // 轻微抬黑：画面像印出来的，不会死黑

  // —— 纸张质感 ——
  float grain = h12(floor(vUv * res)) - 0.5;
  float blot = vnoise(vUv * vec2(res.x / res.y, 1.0) * 3.0) - 0.5;
  c *= 1.0 + paper * (grain * 0.05 + blot * 0.06);

  // —— 水珠：亮边和高光 ——
  if (dm > 0.0) {
    float rim = smoothstep(0.6, 1.0, dd.z);
    c = mix(c, c * 0.88, rim * dm * 0.5);
    float hi = 1.0 - smoothstep(0.0, 0.28, length(dd.xy - vec2(-0.3, 0.35)));
    c += hi * dm * 0.35 * (0.4 + 0.6 * (1.0 - night * 0.6));
  }

  if (dbg > 0.5 && dbg < 1.5) c = texture2D(tNormal, vUv).rgb;
  if (dbg > 1.5 && dbg < 2.5) c = vec3(fract(linDepth(vUv) / 10.0));
  vec2 d = vUv - 0.5;
  c *= 1.0 - vig * dot(d, d) * 1.6;
  gl_FragColor = vec4(c, col.a);
}`;

const _tmpC = new THREE.Color();

export class StylePass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene; this.camera = camera;
    this.inkEnabled = true;
    this.normalMat = new THREE.MeshNormalMaterial();
    this.nrt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.nrt.depthTexture = new THREE.DepthTexture(1, 1);
    this.nrt.depthTexture.type = THREE.UnsignedIntType;
    this.uniforms = {
      tDiffuse: { value: null }, tNormal: { value: this.nrt.texture }, tDepth: { value: this.nrt.depthTexture },
      res: { value: new THREE.Vector2(1, 1) }, dbg: { value: 0 }, near: { value: 0.1 }, far: { value: 600 }, time: { value: 0 },
      ink: { value: 0.6 }, inkOn: { value: 1 }, sat: { value: 1.08 }, vig: { value: 0.3 }, rain: { value: 0 }, night: { value: 0 }, paper: { value: 1 },
      shadowTint: { value: new THREE.Color(0.9, 0.94, 1.06) }, highTint: { value: new THREE.Color(1.03, 1.0, 0.95) },
    };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG }));
    this._hidden = [];
    this._swapped = [];
    // 角色专用：法线一样，但透明通道写 0 当记号
    this.charNormalMat = new THREE.MeshNormalMaterial();
    this.charNormalMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace(/}\s*$/, '  gl_FragColor.a = 0.0;\n}'); };
    this.charNormalMat.customProgramCacheKey = () => 'ink-char-normal';
    this._clear = new THREE.Color(0.5, 0.5, 1);
  }

  setSize(w, h) {
    this.nrt.setSize(w, h);
    this.uniforms.res.value.set(w, h);
  }

  // 天气 / 昼夜传进来调色
  setEnv({ night = 0, rain = 0, warm = 0 } = {}) {
    const u = this.uniforms;
    u.night.value = night; u.rain.value = rain;
    // 暗部偏冷（夜里更蓝），亮部偏暖（夜里灯光更暖）
    u.shadowTint.value.setRGB(0.92 - night * 0.12, 0.95 - night * 0.06, 1.05 + night * 0.1);
    u.highTint.value.setRGB(1.03 + night * 0.07 + warm * 0.04, 1.0 + night * 0.01, 0.95 - night * 0.08);
    u.sat.value = 1.08 + night * 0.06;
  }

  _normalPass(renderer) {
    const scene = this.scene, hidden = this._hidden, swapped = this._swapped;
    hidden.length = 0; swapped.length = 0;
    scene.traverseVisible((o) => {
      if (o === scene) return;
      const m = o.material;
      if (o.userData.noInk || o.userData.isOutlineShell || (!o.isMesh) || (m && (Array.isArray(m) ? m.some((x) => x.transparent) : m.transparent))) {
        if (o.isMesh || o.isPoints || o.isLine || o.isSprite || o.userData.noInk || o.userData.isOutlineShell) hidden.push(o);
        return;
      }
      // 角色（VRM 的 MToon 材质）用另一种法线材质，在透明通道里做记号，描线时对角色手下留情
      const isChar = Array.isArray(m) ? m.some((x) => x.isMToonMaterial) : m?.isMToonMaterial;
      swapped.push(o, m);
      o.material = isChar ? this.charNormalMat : this.normalMat;
    });
    for (const o of hidden) o.visible = false;
    const bg = scene.background, fog = scene.fog;
    const autoSh = renderer.shadowMap.autoUpdate;
    const oldClear = renderer.getClearColor(_tmpC), oldAlpha = renderer.getClearAlpha();
    const clearR = oldClear.r, clearG = oldClear.g, clearB = oldClear.b;
    scene.background = null; scene.fog = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.nrt);
    renderer.setClearColor(this._clear, 1);
    renderer.clear();
    // 墨线 150 米外已经完全淡掉：这一遍只画 150 米以内，远处的东西直接被视锥剔掉
    const cam = this.camera, far = cam.far, cut = Math.min(far, 150);
    if (cut < far) { cam.far = cut; cam.updateProjectionMatrix(); }
    this.uniforms.far.value = cut;
    renderer.render(scene, cam);
    if (cut < far) { cam.far = far; cam.updateProjectionMatrix(); }
    renderer.setClearColor(_tmpC.setRGB(clearR, clearG, clearB), oldAlpha);
    renderer.shadowMap.autoUpdate = autoSh;
    scene.background = bg; scene.fog = fog;
    for (let i = 0; i < swapped.length; i += 2) swapped[i].material = swapped[i + 1];
    for (const o of hidden) o.visible = true;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime) {
    const u = this.uniforms;
    u.time.value += deltaTime || 0.016;
    u.near.value = this.camera.near; u.far.value = Math.min(this.camera.far, 150);
    u.inkOn.value = this.inkEnabled ? 1 : 0;
    if (this.inkEnabled) this._normalPass(renderer);
    u.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  dispose() { this.nrt.dispose(); this.quad.dispose(); }
}
