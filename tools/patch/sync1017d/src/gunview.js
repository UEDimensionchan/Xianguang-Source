import * as THREE from 'three';
import { mountAttachments } from './attachments.js';
// 武器页的 3D 展示台：用游戏里同一套枪模型（Arsenal）实时渲染，
// 可拖动 360° 旋转、滚轮/检视缩放，涂装直接给材质染色；列表和涂装缩略图也是从同一个模型现拍的。

const SKIN_TINT = [null, 0xbfe2ff, 0xa6f2dc, 0xf0bf62]; // 初始 / 晴空白昼 / 薄荷回响 / 暮色流金

export class GunViewer {
  constructor(host, arsenal) {
    this.host = host;
    this.arsenal = arsenal;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    r.setClearColor(0x000000, 0);
    r.domElement.className = 'wp-canvas';
    host.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xf4fbff, 0x8a96a8, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(2, 3, 4); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7ff5e0, 2.2); rim.position.set(-3, 1.5, -3); this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7); fill.position.set(-2, -1, 3); this.scene.add(fill);
    this.camera = new THREE.PerspectiveCamera(24, 2, 0.01, 50);
    this.camera.position.set(0, 0, 3);

    this.pivot = new THREE.Group(); // 用户拖动的旋转
    this.scene.add(this.pivot);
    this.yaw = -0.35; this.pitch = 0.12; this.vyaw = 0; this.zoom = 1; this.zoomT = 1;
    this.slide = 0; this.idle = 0; this.tint = 0;
    this.cur = null; this.curId = null; this.models = {}; this.token = 0;
    this._drag = null;
    this._bind();
    this._resize();
    new ResizeObserver(() => this._resize()).observe(r.domElement);
    this.clock = new THREE.Timer();
    this.active = () => true;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // 每把枪一份独立副本 + 独立材质（涂装染色不影响局内的枪）
  async _model(def) {
    if (!this.models[def.id]) {
      this.models[def.id] = this.arsenal.instance(def).then((g) => {
        const mats = [];
        g.traverse((o) => {
          if (!o.isMesh) return;
          o.frustumCulled = false;
          const cl = (m) => { const c = m.clone(); c.userData.base = m.color.clone(); mats.push(c); return c; };
          o.material = Array.isArray(o.material) ? o.material.map(cl) : cl(o.material);
        });
        // 枪口朝 +Z：转成侧视（枪口朝右），再按包围盒居中、统一大小
        const wrap = new THREE.Group();
        g.rotation.y = Math.PI / 2;
        wrap.add(g);
        wrap.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(wrap), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
        g.position.sub(c);
        const s = 1 / Math.max(size.x, size.y * 2.7, size.z * 1.4, 1e-3);
        wrap.scale.setScalar(s * 1.45);
        wrap.userData.mats = mats;
        wrap.userData.holder = g;
        return wrap;
      });
    }
    return this.models[def.id];
  }

  _paint(wrap, skin) {
    const t = SKIN_TINT[skin];
    for (const m of wrap.userData.mats) {
      m.color.copy(m.userData.base);
      if (t) m.color.multiply(new THREE.Color(t)).multiplyScalar(skin === 3 ? 1.05 : 1.12);
    }
  }

  // 配件预览：把选中的配件模型装到展示的枪上（不画镭射光束）
  async setAttach(def, sel) {
    const wrap = await this._model(def);
    const tok = (this._attTok = (this._attTok || 0) + 1);
    await mountAttachments(wrap.userData.holder, def, sel, { loader: this.arsenal.loader, gradient: this.arsenal.gradient, beam: false });
    if (tok !== this._attTok) return;
    // 新装上的配件也要单独的材质，才能跟着涂装染色
    wrap.userData.holder.traverse((o) => {
      if (!o.isMesh || o.userData.vmat) return;
      let p = o; while (p && !p.userData.isAttachment) p = p.parent;
      if (!p) return;
      o.frustumCulled = false; o.userData.vmat = true;
      const cl = (m) => { const c = m.clone(); c.userData.base = m.color.clone(); if (!m.transparent) wrap.userData.mats.push(c); return c; };
      o.material = Array.isArray(o.material) ? o.material.map(cl) : cl(o.material);
    });
    wrap.userData.mats = wrap.userData.mats.filter((m) => { let ok = false; wrap.traverse((o) => { if (!ok && o.isMesh && [].concat(o.material).includes(m)) ok = true; }); return ok; });
    if (wrap === this.cur) this._paint(wrap, this.tint);
    this._anchors(wrap);
  }

  async show(def, skin = 0) {
    const tok = ++this.token;
    const wrap = await this._model(def);
    if (tok !== this.token) return;
    this._paint(wrap, skin);
    if (this.curId !== def.id) {
      if (this.cur) this.pivot.remove(this.cur);
      this.pivot.add(wrap);
      this.cur = wrap; this.curId = def.id;
      this.slide = 1; this.vyaw = 0.9; // 换枪：从右侧滑入并带一点旋转
    }
    this.host.classList.add('ready');
  }

  // 缩略图：同一模型的固定侧视，渲成图片给列表/涂装卡用
  async snapshot(def, skin = 0, w = 440, h = 160) {
    const wrap = await this._model(def);
    const r = this.renderer, prev = r.getSize(new THREE.Vector2()), pr = r.getPixelRatio();
    const sc = new THREE.Scene();
    this.scene.children.filter((o) => o.isLight).forEach((l) => sc.add(l.clone()));
    const parent = wrap.parent;
    this._paint(wrap, skin);
    const holder = new THREE.Group(); holder.rotation.set(0.08, -0.12, 0); holder.add(wrap); sc.add(holder);
    const cam = new THREE.PerspectiveCamera(20, w / h, 0.01, 50);
    const tn = Math.tan(THREE.MathUtils.degToRad(10));
    cam.position.set(0, 0, Math.max(0.86 / (tn * (w / h)), 0.42 / tn));
    r.setPixelRatio(1); r.setSize(w, h, false);
    r.render(sc, cam);
    const url = r.domElement.toDataURL('image/png');
    holder.remove(wrap);
    if (parent) { parent.add(wrap); }
    if (wrap === this.cur) this._paint(wrap, this.tint);
    r.setPixelRatio(pr); r.setSize(prev.x, prev.y, false);
    return url;
  }

  // —— 改枪台 ——
  // 每个槽位在枪上的锚点（枪的本地坐标）：装了配件指向配件，没装指向原部件；连线每帧按当前姿态投影到屏幕
  _anchors(wrap) {
    const g = wrap.userData.holder;
    if (wrap.parent) wrap.parent.updateMatrixWorld(true); else wrap.updateMatrixWorld(true);
    const out = {}, box = new THREE.Box3(), tmp = new THREE.Box3(), v = new THREE.Vector3();
    const visible = (o) => { for (let p = o; p && p !== g; p = p.parent) if (!p.visible) return false; return true; };
    const boxOf = (root) => {
      box.makeEmpty();
      root.traverse((o) => {
        if (!o.isMesh || o.isSkinnedMesh || o.userData.beam || o.material?.transparent || !visible(o)) return;
        o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.union(tmp);
      });
      return box.isEmpty() ? null : box;
    };
    const att = {};
    g.traverse((o) => { const s = o.userData.attSlot; if (s && o.visible) (att[s] ||= []).push(o); });
    const part = (names) => {
      for (const n of names) {
        const o = g.getObjectByName(n);
        if (!o || !visible(o)) continue;
        const b = o.isBone ? null : boxOf(o);
        if (b) return b.clone();
        if (o.isBone || !o.isMesh) return new THREE.Box3().setFromCenterAndSize(o.getWorldPosition(v.clone()), new THREE.Vector3());
      }
      return null;
    };
    const PARTS = {
      optic: ['Part_Scope', 'Part_Sight_Rear', 'Scope', 'Sight_Rear', 'Slide'],
      barrel: ['Part_Handguard_Default', 'Part_Barrel_Default', 'Part_Slide_Default', 'Handguard', 'Barrel', 'Forend', 'Slide'],
      under: ['Part_Handguard_Default', 'Handguard', 'Forend', 'Barrel'],
      laser: ['Part_Handguard_Default', 'Handguard', 'Forend', 'Slide', 'Barrel'],
      mag: ['Part_Magazine', 'Magazine'],
    };
    for (const slot of ['optic', 'muzzle', 'barrel', 'under', 'laser', 'mag']) {
      let b = null;
      if (att[slot]) { const u = new THREE.Box3(); for (const o of att[slot]) { const bb = boxOf(o); if (bb) u.union(bb); } if (!u.isEmpty()) b = u; }
      let p;
      if (b) p = b.getCenter(new THREE.Vector3());
      else if (slot === 'muzzle') { p = g.userData.muzzle.clone(); g.localToWorld(p); }
      else {
        b = part(PARTS[slot]);
        if (!b) continue;
        p = b.getCenter(new THREE.Vector3());
        // 没装配件：下挂指护木下沿，战术指护木侧面，瞄具指顶部
        if (slot === 'under') p.y = b.min.y; else if (slot === 'optic') p.y = b.max.y;
      }
      out[slot] = g.worldToLocal(p);
    }
    wrap.userData.anchors = out;
  }

  // 锚点投影到屏幕（像素，相对视口）；没有这个槽位返回 null
  project(slot, out = { x: 0, y: 0 }) {
    const a = this.cur?.userData.anchors?.[slot];
    if (!a) return null;
    const v = a.clone(); this.cur.userData.holder.localToWorld(v); v.project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    out.x = r.left + (v.x + 1) / 2 * r.width; out.y = r.top + (1 - v.y) / 2 * r.height; out.z = v.z;
    return out;
  }

  // 镜头推到某个槽位（null = 回到全枪）
  focus(slot) { this.focusSlot = slot; this.idle = 0; }

  setSkin(skin) { this.tint = skin; if (this.cur) this._paint(this.cur, skin); }
  toggleZoom() { this.zoomT = this.zoomT > 1 ? 1 : 1.45; return this.zoomT > 1; }

  _bind() {
    const el = this.host;
    el.addEventListener('pointerdown', (e) => {
      this._drag = { x: e.clientX, y: e.clientY, t: performance.now() };
      el.setPointerCapture(e.pointerId); el.classList.add('drag');
    });
    el.addEventListener('pointermove', (e) => {
      const d = this._drag; if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y, dt = Math.max(1, performance.now() - d.t);
      this.yaw += dx * 0.011; this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.008, -0.9, 0.9);
      this.vyaw = (dx * 0.011) / dt * 16;
      d.x = e.clientX; d.y = e.clientY; d.t = performance.now();
      this.idle = 0;
    });
    const up = () => { this._drag = null; el.classList.remove('drag'); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomT = THREE.MathUtils.clamp(this.zoomT - e.deltaY * 0.0012, 0.75, 1.8); }, { passive: false });
  }

  _resize() {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    if (!w || !h) return;
    this._w = w;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 横向能放下长度 1.6 的枪，留点边
    const fitW = 0.95 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / this.camera.aspect;
    const fitH = 0.42 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.dist = Math.max(fitW, fitH);
  }

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (this.clock.update(), this.clock.getDelta()));
    if (!this.active() || !this.cur) return;
    if (!this.dist || this._w !== this.renderer.domElement.clientWidth) this._resize();
    const t = this.clock.getElapsed();
    if (!this._drag) {
      this.idle += dt;
      this.yaw += this.vyaw * dt * 3;
      this.vyaw *= Math.pow(0.04, dt);
      // 松手 2 秒后慢慢回到展示角度并轻轻摆动
      // 改枪台：松手很快回到侧面，只轻微摆动，方便看清连线
      if (this.idle > (this.modMode ? 0.8 : 2)) {
        const tyaw = this.modMode ? -0.2 + (this.focusSlot ? 0 : Math.sin(t * 0.4) * 0.08) : -0.35 + Math.sin(t * 0.45) * 0.35, k = 1 - Math.pow(this.modMode ? 0.08 : 0.3, dt);
        const wrapYaw = Math.round((this.yaw - tyaw) / (Math.PI * 2)) * Math.PI * 2;
        this.yaw += (tyaw + wrapYaw - this.yaw) * k;
        this.pitch += (0.12 - this.pitch) * k;
      }
    }
    this.slide *= Math.pow(0.002, dt);
    this.zoom += (this.zoomT - this.zoom) * (1 - Math.pow(0.002, dt));
    this.pivot.rotation.set(this.pitch, this.yaw, 0, 'XYZ');
    this.pivot.position.set(this.slide * 1.2, Math.sin(t * 1.3) * 0.02, 0);
    // 改枪台：镜头平移、推近到选中的槽位
    const fa = this.focusSlot && this.cur.userData.anchors?.[this.focusSlot];
    this.fk = (this.fk || 0) + ((fa ? 1 : 0) - (this.fk || 0)) * (1 - Math.pow(0.004, dt));
    if (fa) { this._ft ||= new THREE.Vector3(); this.pivot.updateMatrixWorld(true); this._ft.copy(fa); this.cur.userData.holder.localToWorld(this._ft); }
    const tx = this._ft ? this._ft.x * this.fk : 0, ty = this._ft ? this._ft.y * this.fk : 0;
    this.camera.position.set(tx, ty + 0.02 * (1 - this.fk), ((this.dist || 3) / this.zoom) * (1 - 0.38 * this.fk));
    this.camera.lookAt(tx, ty, 0);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  }

  dispose() {
    this.active = () => false;
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}
