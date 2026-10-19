import * as THREE from 'three';
import { VRMUtils } from '@pixiv/three-vrm';
import { attachAccessories } from './accessories.js';
import { tameSprings } from './springs.js';
// 引航者页的 3D 展示台：切换角色时播放出场动画（Blender 里 K 的，见 Character/_blender/展示动画.blend），
// 配合传送特效（地面法阵、光柱、粒子、从脚往上“扫描成形”），之后循环播放该角色的待机动作。

const COLORS = {
  mint: '#33e6c8', kikyo: '#8fa8ff', selestia: '#ffd27a', luxi: '#3fd6d0', baiyu: '#b9c8ff',
  daiyin: '#c58cff', feiying: '#ff7fb0', xuetu: '#8fc2ff', liuli: '#ff9fb8', qiluo: '#ff8fa8',
};

let showData = null;
function loadShow(url) {
  if (!showData) showData = fetch(url).then((r) => r.json());
  return showData;
}

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = () => canvasTex(64, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
});
// 地面法阵：同心圆 + 刻度 + 两个交错的三角 + 弧形符文
const circleTex = () => canvasTex(512, (g, s) => {
  const c = s / 2;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff';
  g.lineWidth = 6; g.beginPath(); g.arc(c, c, c - 8, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.arc(c, c, c - 24, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(c, c, c * 0.62, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(c, c, c * 0.3, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2, r0 = c - 24, r1 = r0 - (i % 6 ? 10 : 24);
    g.lineWidth = i % 6 ? 2 : 4;
    g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
  }
  g.lineWidth = 3;
  for (const off of [0, Math.PI]) {
    g.beginPath();
    for (let k = 0; k <= 3; k++) { const a = off + k * (Math.PI * 2 / 3) - Math.PI / 2, r = c * 0.6; g[k ? 'lineTo' : 'moveTo'](c + Math.cos(a) * r, c + Math.sin(a) * r); }
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath(); g.arc(c + Math.cos(a) * c * 0.78, c + Math.sin(a) * c * 0.78, 9, 0, Math.PI * 2); g.stroke();
    g.fillRect(c + Math.cos(a + 0.13) * c * 0.78 - 2, c + Math.sin(a + 0.13) * c * 0.78 - 2, 4, 4);
  }
});

const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

export class NavStage {
  constructor(host, { loader, url }) {
    this.host = host;
    this.loader = loader;
    this.data = loadShow(url).catch((e) => { console.warn('展示动画加载失败', e); return null; });
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    r.setClearColor(0x000000, 0);
    r.localClippingEnabled = true;
    r.domElement.className = 'nv-stage-cv';
    host.appendChild(r.domElement);

    const sc = (this.scene = new THREE.Scene());
    sc.add(new THREE.HemisphereLight(0xf2f8ff, 0x9aa6b4, 1.5));
    const key = new THREE.DirectionalLight(0xfff6ec, 2.1); key.position.set(1.2, 3, 3); sc.add(key);
    this.rim = new THREE.DirectionalLight(0xbff8ff, 1.8); this.rim.position.set(-2.5, 2, -2.5); sc.add(this.rim);
    this.camera = new THREE.PerspectiveCamera(22, 0.7, 0.05, 50);
    this.pivot = new THREE.Group();
    sc.add(this.pivot);
    this.yaw0 = 0.18; this.yaw = this.yaw0;

    // —— 特效 ——
    this.color = new THREE.Color('#33e6c8');
    const glow = glowTex();
    this.fx = new THREE.Group();
    sc.add(this.fx);
    const add = (m) => { m.renderOrder = 2; this.fx.add(m); return m; };
    this.fxMats = [];
    const addMat = (o) => { const mm = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: this.color, side: THREE.DoubleSide, ...o }); this.fxMats.push(mm); return mm; };
    this.circle = add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat({ map: circleTex() })));
    this.circle.rotation.x = -Math.PI / 2;
    this.circle.position.y = 0.005;
    this.circleIn = add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat({ map: this.circle.material.map })));
    this.circleIn.rotation.x = -Math.PI / 2;
    this.circleIn.position.y = 0.008;
    this.floorGlow = add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat({ map: glow })));
    this.floorGlow.rotation.x = -Math.PI / 2;
    this.floorGlow.position.y = 0.003;
    // 光柱：竖直渐隐的圆筒
    const pillarMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: this.color }, uA: { value: 0 }, uT: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying float vE; void main(){ vUv = uv; vec3 n = normalize(normalMatrix * normal); vE = 1.0 - abs(n.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uColor; uniform float uA; uniform float uT; varying vec2 vUv; varying float vE;
        void main(){ float v = pow(1.0 - vUv.y, 1.8); float s = 0.7 + 0.3 * sin(vUv.x * 60.0 + uT * 6.0) * sin(vUv.y * 9.0 - uT * 8.0);
          float e = 0.12 + 0.88 * pow(vE, 2.5);
          gl_FragColor = vec4(uColor * 1.5, v * s * e * uA); }`,
    });
    this.pillar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.44, 2.6, 48, 1, true), pillarMat));
    this.pillar.position.y = 1.3;
    // 成形扫描线：跟着裁剪面一起往上走的光环
    this.scan = add(new THREE.Mesh(new THREE.RingGeometry(0.2, 0.42, 64), addMat({ map: null, opacity: 0 })));
    this.scan.rotation.x = -Math.PI / 2;
    this.scanGlow = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: this.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })));
    this.fxMats.push(this.scanGlow.material);
    // 粒子：出场时一圈往上冲，之后零星飘起
    const N = (this.pN = 220);
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pMax = new Float32Array(N); this.pSize = new Float32Array(N);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.pLife, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    this.pMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: glow }, uColor: { value: this.color }, uScale: { value: 300 } },
      vertexShader: `attribute float aLife; attribute float aSize; varying float vA; uniform float uScale;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vA = aLife; gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; varying float vA;
        void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.45) * t.rgb, t.a * vA); }`,
    });
    this.points = add(new THREE.Points(g, this.pMat));
    this.points.frustumCulled = false;
    this.pNext = 0;

    this.vrm = null; this.mixer = null; this.charKey = null; this.token = 0;
    this.fxT = 99; this.t = 0;
    this.active = () => true;
    this.clock = new THREE.Timer();
    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

    // 拖动转身；单击重播出场
    host.addEventListener('pointerdown', (e) => { this._drag = e.clientX; this._moved = 0; host.setPointerCapture(e.pointerId); });
    host.addEventListener('pointermove', (e) => { if (this._drag == null) return; const dx = e.clientX - this._drag; this._moved += Math.abs(dx); this.yaw += dx * 0.012; this._drag = e.clientX; this._idle = 0; });
    const up = () => { if (this._drag != null && this._moved < 4) this.replay(); this._drag = null; };
    host.addEventListener('pointerup', up); host.addEventListener('pointercancel', () => { this._drag = null; });
    this._resize();
    new ResizeObserver(() => this._resize()).observe(r.domElement);
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  async show(ch, persona) {
    if (!ch) return;
    if (ch.file === this.charKey) return;
    this.charKey = ch.file;
    const tok = ++this.token;
    this.host.classList.add('loading');
    const [gltf, data] = await Promise.all([this.loader.loadAsync(ch.file), this.data]);
    if (tok !== this.token) return;
    const vrm = gltf.userData.vrm;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    if ((gltf.parser?.json?.skins?.length || 0) > 1) VRMUtils.combineSkeletons?.(gltf.scene); // 单骨架的 MMD 模型不合并，合并会扯坏裙子
    VRMUtils.rotateVRM0(vrm);
    const mats = [];
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
      for (const m of [].concat(o.material || [])) { if (m.isMToonMaterial) m.rimLightingMixFactor = 1; mats.push(m); }
    });
    if (ch.acc) await attachAccessories(this.loader, vrm, ch.acc).catch((e) => console.warn('角色配件加载失败', e));
    if (tok !== this.token) return;
    vrm.scene.traverse((o) => { for (const m of [].concat(o.material || [])) if (!mats.includes(m)) mats.push(m); });
    if (this.vrm) { this.pivot.remove(this.vrm.scene); VRMUtils.deepDispose(this.vrm.scene); }
    this.vrm = vrm; this.mats = mats;
    tameSprings(vrm);
    this.pivot.add(vrm.scene);
    vrm.scene.updateMatrixWorld(true);
    const H = vrm.humanoid;
    this.height = H.getNormalizedBoneNode('head').getWorldPosition(new THREE.Vector3()).y + 0.14;
    if (vrm.lookAt) vrm.lookAt.target = this.camera;
    this._buildClips(data, persona || ch.id);
    this.host.classList.remove('loading');
    this.color.set(COLORS[persona] || COLORS[ch.id] || '#33e6c8');
    for (const mm of this.fxMats) mm.color.copy(this.color);
    this.rim.color.copy(this.color).lerp(new THREE.Color(0xffffff), 0.5);
    this._frame();
    this.replay();
  }

  _buildClips(data, key) {
    const vrm = this.vrm, H = vrm.humanoid;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.enterA = this.idleA = null;
    if (!data) return;
    const clips = data.clips;
    const k = clips[key + '_enter'] ? key : 'mint';
    const isVRM0 = vrm.meta?.metaVersion === '0';
    const hips = H.getNormalizedBoneNode('hips');
    const hipsY = hips.getWorldPosition(new THREE.Vector3()).y - vrm.scene.getWorldPosition(new THREE.Vector3()).y;
    const scale = hipsY / data.hipsHeight;
    const make = (name, loop) => {
      const src = clips[name];
      if (!src) return null;
      const tracks = [];
      for (const t of src.tracks) {
        const node = H.getNormalizedBoneNode(t.bone);
        if (!node) continue;
        node.name ||= 'VRM_' + t.bone;
        node.name = THREE.PropertyBinding.sanitizeNodeName(node.name);
        if (t.type === 'q') {
          const vals = isVRM0 ? t.values.map((v, i) => (i % 2 === 0 ? -v : v)) : t.values;
          tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, t.times, vals));
        } else {
          const vals = t.values.map((v, i) => (isVRM0 && i % 3 !== 1 ? -v : v) * scale);
          tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, t.times, vals));
        }
      }
      const a = this.mixer.clipAction(new THREE.AnimationClip(name, src.duration, tracks));
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      return a;
    };
    this.enterA = make(k + '_enter', false);
    this.idleA = make(k + '_idle', true);
  }

  replay() {
    if (!this.vrm) return;
    this.fxT = 0;
    this.yaw = this.yaw0; this._idle = 0;
    this.blinkT = 2;
    this._exprBase = 0;
    this.mixer?.stopAllAction();
    if (this.enterA) {
      this.enterA.reset().setEffectiveWeight(1).play();
      this._idleQueued = true;
    } else this.idleA?.reset().play();
    // 成形裁剪：从脚往上
    for (const m of this.mats) { m.clippingPlanes = [this.clip]; m.needsUpdate = true; }
    this._clipping = true;
    this.clip.constant = -0.02;
    // 粒子爆发
    for (let i = 0; i < 90; i++) this._spawn(true);
    this.mixer?.update(0);
  }

  _spawn(burst) {
    const i = this.pNext; this.pNext = (this.pNext + 1) % this.pN;
    const a = Math.random() * Math.PI * 2, r = burst ? 0.25 + Math.random() * 0.3 : 0.15 + Math.random() * 0.45;
    this.pPos.set([Math.cos(a) * r, burst ? Math.random() * 0.2 : Math.random() * 0.3, Math.sin(a) * r], i * 3);
    const out = burst ? 0.25 + Math.random() * 0.5 : 0.02;
    this.pVel.set([Math.cos(a) * out, burst ? 0.8 + Math.random() * 1.6 : 0.15 + Math.random() * 0.3, Math.sin(a) * out], i * 3);
    this.pMax[i] = this.pLife[i] = burst ? 0.9 + Math.random() * 0.9 : 2 + Math.random() * 2;
    this.pSize[i] = burst ? 0.02 + Math.random() * 0.035 : 0.012 + Math.random() * 0.02;
  }

  _frame() {
    const h = this.height || 1.6;
    this.camera.position.set(0, h * 0.5, h * 3.8);
    this.camera.lookAt(0, h * 0.46, 0);
  }

  _resize() {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    if (!w || !h) return;
    this._w = w;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pMat.uniforms.uScale.value = h * 1.6;
  }

  _expr(dt) {
    const em = this.vrm.expressionManager;
    if (!em) return;
    const f = this.fxT;
    // 出场时笑一下，之后保持一点点笑意；隔几秒眨眼
    const happy = f < 3 ? Math.sin(Math.min(1, Math.max(0, (f - 0.6) / 2.2)) * Math.PI) * 0.7 : 0;
    em.setValue('happy', Math.max(happy, 0.12));
    this.blinkT -= dt;
    let blink = 0;
    if (this.blinkT < 0.16) blink = Math.sin(Math.max(0, this.blinkT) / 0.16 * Math.PI);
    if (this.blinkT <= 0) this.blinkT = 2.5 + Math.random() * 3;
    em.setValue('blink', Math.max(0, blink - happy));
  }

  _loop() {
    requestAnimationFrame(this._loop);
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    if (!this.active() || !this.vrm) return;
    if (this._w !== this.renderer.domElement.clientWidth) this._resize();
    this.t += dt; this.fxT += dt;
    const f = this.fxT, h = this.height || 1.6;
    this._idle = (this._idle || 0) + dt;
    if (this._drag == null && this._idle > 1.5) this.yaw += (this.yaw0 - this.yaw) * (1 - Math.pow(0.15, dt));
    this.pivot.rotation.y = this.yaw;

    // 出场动作播完前 0.35 秒淡入待机
    if (this._idleQueued && this.enterA && this.idleA) {
      const left = this.enterA.getClip().duration - this.enterA.time;
      if (left < 0.35 || !this.enterA.isRunning()) { this.idleA.reset().play(); this.enterA.crossFadeTo(this.idleA, 0.35, false); this._idleQueued = false; }
    }
    this.mixer?.update(dt);
    this._expr(dt);
    this.vrm.update(dt);

    // —— 特效时间轴 ——
    // 成形：0.15s 开始，0.9s 内从脚扫到头顶
    const k = ease((f - 0.15) / 0.9);
    if (this._clipping) {
      this.clip.constant = -0.02 + k * (h + 0.35);
      if (k >= 1) { for (const m of this.mats) { m.clippingPlanes = null; m.needsUpdate = true; } this._clipping = false; }
    }
    const scanA = f < 0.15 ? 0 : Math.min(1, (1 - k) * 5);
    this.scan.position.y = this.clip.constant;
    this.scan.material.opacity = scanA * 0.9;
    const sw = 0.9 + 0.2 * Math.sin(this.t * 20);
    this.scan.scale.setScalar(sw * (0.9 + 0.35 * Math.sin(Math.PI * Math.min(1, k * 1.1))));
    this.scanGlow.position.set(0, this.clip.constant, 0);
    this.scanGlow.scale.set(1.6, 0.25, 1);
    this.scanGlow.material.opacity = scanA * 0.5;
    // 光柱：出现 → 停留 → 消失
    const pa = f < 0.12 ? f / 0.12 : Math.max(0, 1 - (f - 0.5) / 0.9);
    this.pillar.material.uniforms.uA.value = pa * 0.55;
    this.pillar.material.uniforms.uT.value = this.t;
    this.pillar.scale.set(1 + (1 - pa) * 0.6, Math.min(1, f * 6), 1 + (1 - pa) * 0.6);
    // 地面法阵：迅速展开，之后保持淡淡的旋转
    const cs = 1.7 * (0.3 + 0.7 * ease(f / 0.45));
    this.circle.scale.set(cs, cs, 1);
    this.circle.rotation.z = this.t * 0.25;
    this.circle.material.opacity = f < 1.2 ? 0.95 : 0.95 - Math.min(0.62, (f - 1.2) * 0.5);
    this.circleIn.scale.set(cs * 0.55, cs * 0.55, 1);
    this.circleIn.rotation.z = -this.t * 0.5;
    this.circleIn.material.opacity = this.circle.material.opacity * 0.7;
    this.floorGlow.scale.setScalar(2.4 * (0.6 + 0.4 * ease(f / 0.4)));
    this.floorGlow.material.opacity = 0.35 + (f < 1 ? 0.5 * (1 - f) : 0) + 0.05 * Math.sin(this.t * 2);
    // 粒子
    if (Math.random() < dt * (f < 1.5 ? 40 : 6)) this._spawn(false);
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) { this.pSize[i] = 0; continue; }
      this.pLife[i] -= dt;
      const o = i * 3;
      this.pVel[o + 1] *= 1 - dt * 0.8;
      this.pVel[o] *= 1 - dt * 1.5; this.pVel[o + 2] *= 1 - dt * 1.5;
      this.pPos[o] += this.pVel[o] * dt; this.pPos[o + 1] += this.pVel[o + 1] * dt; this.pPos[o + 2] += this.pVel[o + 2] * dt;
    }
    const life = this.points.geometry.attributes.aLife;
    for (let i = 0; i < this.pN; i++) life.array[i] = this.pMax[i] > 0 ? Math.max(0, Math.min(1, this.pLife[i] / this.pMax[i] * 2)) * Math.min(1, (this.pMax[i] - this.pLife[i]) * 6) : 0;
    life.needsUpdate = true;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.active = () => false;
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}
