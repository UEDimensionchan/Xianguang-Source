import * as THREE from 'three';
import { VRMUtils } from '@pixiv/three-vrm';
import { CharacterAnimator } from './anim.js';
import { Player, GUN_SCALE } from './player.js';
import { attachAccessories } from './accessories.js';
import { tameSprings } from './springs.js';
// 大厅主页的 3D 角色：出战角色（VRM）待机，双手抱着当前装备的枪（低位持枪）。
// 持枪直接复用局内的 Player._holdGun（同一套握把 IK、手指弯曲），只是把“准星”放到身前斜下方。

export class LobbyStage {
  constructor(host, { loader, arsenal, animData }) {
    this.host = host;
    this.loader = loader;
    this.arsenal = arsenal;
    this.animData = animData; // Promise
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    r.setClearColor(0x000000, 0);
    r.domElement.className = 'lb-stage';
    host.appendChild(r.domElement);

    const sc = (this.scene = new THREE.Scene());
    sc.add(new THREE.HemisphereLight(0xf2f8ff, 0x9aa6b4, 1.5));
    const key = new THREE.DirectionalLight(0xfff6ec, 2.2); key.position.set(1.5, 3, 3); sc.add(key);
    const rim = new THREE.DirectionalLight(0xbff8ff, 1.6); rim.position.set(-2.5, 2, -2.5); sc.add(rim);
    this.camera = new THREE.PerspectiveCamera(22, 0.78, 0.05, 50);

    this.pivot = new THREE.Group();
    sc.add(this.pivot);
    this.vrm = null; this.gun = null; this.charKey = null; this.gunKey = null;
    this.token = 0;
    this.active = () => true;
    this.clock = new THREE.Timer();
    this.t = 0;
    // 借用 Player 的持枪逻辑：给一个只有持枪所需字段的对象
    this.body = Object.create(Player.prototype);
    Object.assign(this.body, { yaw: 0.32, kick: 0, paperAmt: 0, switchT: 0, alive: true, scoped: false, reloadT: 0, _dt: 0, anim: null });
    this.body.aimTarget = () => this._aimPt;
    // 抱枪姿势：长枪和火箭筒斜抱在胸前（握把在右腰前、枪口朝左上），枪身侧面朝向镜头；手枪低位双手持
    this.body.holdPose = (grip, dir, up, right, fwd) => {
      const H = this.vrm.humanoid, hold = this.body.weapon.def.hold, br = Math.sin(this.t * 1.6) * 0.008;
      const hips = H.getRawBoneNode('hips').getWorldPosition(new THREE.Vector3());
      const top = new THREE.Vector3();
      if (hold === 'pistol') {
        // 手枪：双手低位握在腹前，枪口朝左前下方，侧面朝镜头
        grip.copy(hips).addScaledVector(up, 0.1 + br).addScaledVector(fwd, 0.3).addScaledVector(right, 0.1);
        dir.copy(right).multiplyScalar(-0.75).addScaledVector(up, -0.45).addScaledVector(fwd, 0.35).normalize();
        top.copy(up);
      } else {
        // 长枪 / 火箭筒：斜抱在胸前
        grip.copy(hips).addScaledVector(right, 0.14).addScaledVector(fwd, hold === 'launcher' ? 0.26 : 0.2).addScaledVector(up, (hold === 'launcher' ? 0.2 : 0.06) + br);
        dir.copy(up).multiplyScalar(0.62).addScaledVector(right, -0.76).addScaledVector(fwd, 0.2).normalize();
        top.copy(up).multiplyScalar(0.76).addScaledVector(right, 0.62).addScaledVector(fwd, 0.15);
      }
      this.body.gun.up.copy(top.addScaledVector(dir, -top.dot(dir)).normalize());
    };
    this._aimPt = new THREE.Vector3();

    // 拖动转身，松手慢慢转回
    this.yaw0 = 0.32;
    host.addEventListener('pointerdown', (e) => { this._drag = e.clientX; host.setPointerCapture(e.pointerId); host.classList.add('drag'); });
    host.addEventListener('pointermove', (e) => { if (this._drag == null) return; this.body.yaw += (e.clientX - this._drag) * 0.012; this._drag = e.clientX; this._idle = 0; });
    const up = () => { this._drag = null; host.classList.remove('drag'); };
    host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
    this._resize();
    new ResizeObserver(() => this._resize()).observe(r.domElement);
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  async setCharacter(ch) {
    if (!ch || ch.file === this.charKey) return;
    this.charKey = ch.file;
    const tok = ++this.token;
    const [gltf, data] = await Promise.all([this.loader.loadAsync(ch.file), this.animData]);
    if (tok !== this.token) return;
    const vrm = gltf.userData.vrm;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    if ((gltf.parser?.json?.skins?.length || 0) > 1) VRMUtils.combineSkeletons?.(gltf.scene); // 只有一套骨骼的模型（MMD 转的）不用合并，合并反而会把裙子扯坏
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
      for (const m of [].concat(o.material || [])) if (m.isMToonMaterial) m.rimLightingMixFactor = 1;
    });
    if (ch.acc) await attachAccessories(this.loader, vrm, ch.acc).catch((e) => console.warn('角色配件加载失败', e));
    if (tok !== this.token) return;
    if (this.vrm) { this.pivot.remove(this.vrm.scene); VRMUtils.deepDispose(this.vrm.scene); }
    this.vrm = vrm;
    tameSprings(vrm);
    this.pivot.add(vrm.scene);
    const b = this.body;
    b.vrm = vrm; b._ik = null; b.isVRM0 = vrm.meta?.metaVersion === '0';
    b.anim = data ? new CharacterAnimator(vrm, data) : null;
    if (vrm.lookAt) { this._look = new THREE.Object3D(); this.scene.add(this._look); vrm.lookAt.target = this._look; }
    vrm.scene.updateMatrixWorld(true);
    this.height = vrm.humanoid.getNormalizedBoneNode('head').getWorldPosition(new THREE.Vector3()).y + 0.12;
    this._frame();
    this.host.classList.add('ready');
  }

  async setWeapon(def) {
    if (!def || def.id === this.gunKey) return;
    this.gunKey = def.id;
    const g = await this.arsenal.instance(def);
    if (this.gunKey !== def.id) return;
    if (this.gun) this.scene.remove(this.gun);
    this.gun = g;
    this.scene.add(g);
    this.body.gun = g;
    Object.defineProperty(this.body, 'weapon', { value: { def }, configurable: true, writable: true });
    this.body.muzzleLocal = g.userData.muzzle;
    this.swapT = 1;
  }

  _frame() {
    // 机位：半身偏全身，人物站在画面中下方
    const h = this.height || 1.5;
    this.camera.position.set(0.1, h * 0.66, h * 2.45);
    this.camera.lookAt(0, h * 0.56, 0);
  }

  _resize() {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    if (!w || !h) return;
    this._w = w;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loop() {
    requestAnimationFrame(this._loop);
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    if (!this.active() || !this.vrm) return;
    if (this._w !== this.renderer.domElement.clientWidth) this._resize();
    this.t += dt;
    const b = this.body, t = this.t;
    this._idle = (this._idle || 0) + dt;
    if (this._drag == null && this._idle > 1.5) b.yaw += (this.yaw0 - b.yaw) * (1 - Math.pow(0.15, dt));
    this.pivot.rotation.y = b.yaw;
    if (b.anim) b.anim.update(dt, { speed: 0, localX: 0, localZ: 1, onFloor: true, velY: 0, pitch: -0.28, paper: 0, reloading: false });
    // 头微微看向镜头，带一点呼吸摆动
    const head = this.vrm.humanoid.getNormalizedBoneNode('head'), neck = this.vrm.humanoid.getNormalizedBoneNode('neck');
    const s = b.isVRM0 ? -1 : 1;
    const q0 = head?.quaternion.clone(), q1 = neck?.quaternion.clone();
    if (neck) neck.rotation.y += -b.yaw * 0.35;
    if (head) { head.rotation.y += -b.yaw * 0.35 + Math.sin(t * 0.5) * 0.04; head.rotation.x += s * (0.12 + Math.sin(t * 0.8) * 0.015); }
    if (this._look) this._look.position.copy(this.camera.position);
    this.vrm.update(dt);
    if (head) head.quaternion.copy(q0);
    if (neck) neck.quaternion.copy(q1);
    if (this.gun) {
      this._aimPt.set(0, 1, 5); // 不用：抱枪姿势由 holdPose 决定
      this.swapT = Math.max(0, (this.swapT || 0) - dt * 3);
      b.switchT = this.swapT * 0.3;
      b._dt = dt;
      b._holdGun();
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.active = () => false;
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}
