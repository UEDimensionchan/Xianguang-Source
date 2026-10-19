import * as THREE from 'three';
import { TUNING } from './config.js';
import { LOCK, aimPoint } from './lockon.js';

const _v = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _q = new THREE.Quaternion();
const _q0 = new THREE.Quaternion();
const _w = new THREE.Vector3();
const _hA = new THREE.Vector3(), _hB = new THREE.Vector3(), _hC = new THREE.Vector3();

// 弹道、命中火花、墨水炸弹、爆炸
export class Fx {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.items = [];
    this.bombs = [];

    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff3a8, transparent: true, depthWrite: false });
    this.tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.sparkGeo = new THREE.PlaneGeometry(0.22, 0.22);
    this.sparkMat = new THREE.MeshBasicMaterial({ map: makeStarTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.flashMat = new THREE.MeshBasicMaterial({ map: makeStarTexture('#fff6c9'), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.inkMat = new THREE.MeshToonMaterial({ color: 0x23233a });
    this.splatTex = makeSplatTexture();
    // 命中特效（淡红色）：柔光 + 扩散光环 + 飞散的菱形碎片
    this.hitGlowTex = makeGlowTexture();
    this.hitSparkTex = makeSparkTexture();
    // 枪口闪光照亮周围用的点光：一直挂着（平时亮度 0），避免开枪时临时加灯导致所有材质重新编译卡一下
    this.flashLight = new THREE.PointLight(0xffc27a, 0, 7, 2);
    this.scene.add(this.flashLight);
  }

  // 子弹打中目标：鲜红色火花。一个小闪光 + 几道沿速度方向拉长的火星
  // dir 是子弹方向，head 爆头稍大、火星更多，small 用于霰弹枪的每一颗弹丸
  hitBurst(pos, cam, dir, head = false, small = false) {
    const k = (head ? 1.3 : 1) * (small ? 0.7 : 1);
    // 特效要被墙挡住（不能透墙看到），所以开深度测试；位置往射击方向回退一点，免得一半插进目标身体里被挡掉
    const at = pos.clone().addScaledVector(dir, -0.18);
    const add = (tex, color, sx, sy, life, kind, extra = {}) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthTest: true, depthWrite: false }));
      sp.position.copy(at);
      sp.scale.set(sx, sy, 1);
      sp.renderOrder = 20;
      this.scene.add(sp);
      this.items.push({ obj: sp, t: 0, life, kind, sx, sy, shared: true, sprite: true, ...extra });
      return sp;
    };
    // 白芯淡红的小闪光
    const f = add(this.hitGlowTex, 0xff2238, 0.46 * k, 0.46 * k, 0.1, 'glow');
    f.material.rotation = Math.random() * Math.PI;
    add(this.hitGlowTex, 0xffe6e6, 0.16 * k, 0.16 * k, 0.07, 'glow'); // 中心一点白热
    // 火星：朝子弹来的方向溅回去，散开一个锥形
    const back = dir.clone().negate();
    const n = small ? 3 : head ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const v = back.clone().multiplyScalar(0.6)
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.35, Math.random() - 0.5).normalize())
        .normalize().multiplyScalar((3.5 + Math.random() * 3.5) * (small ? 0.8 : 1));
      const col = new THREE.Color().setHSL(0.985 + Math.random() * 0.02, 1, 0.5 + Math.random() * 0.1);
      add(this.hitSparkTex, col, 0.26 * k, 0.055 * k, 0.14 + Math.random() * 0.1, 'spark', { vel: v });
    }
  }

  tracer(from, to) {
    const len = from.distanceTo(to);
    const m = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, len);
    this.scene.add(m);
    this.items.push({ obj: m, t: 0, life: 0.06, kind: 'fade' });
  }

  // 枪口火光：朝前喷出的一束火焰（两片十字交叉的火焰面）+ 正对镜头的一小团星形闪光 + 一闪而过的暖色点光。
  // anchor = { obj, local, cam, top }：挂在枪上跟着枪口走；top = 第一人称（画在手臂场景里、最上层）。
  // 枪口被墙挡住（从镜头看过去中间有东西）时不画。
  muzzle(pos, cam, size = 1, anchor = null) {
    const g = this.game, mc = g.camera;
    _v.copy(pos).sub(mc.position);
    const dist = _v.length();
    if (dist > 0.05 && g.raycastWorld(mc.position, _v.normalize(), Math.max(0, dist - 0.08))) return;
    const top = !!anchor?.top;
    if (!this.flameTex) { this.flameTex = makeFlameTexture(); this.burstTex = makeBurstTexture(); }
    const mat = (tex, color) => new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, depthTest: true, // 第一人称开镜时会被准星、枪管挡住
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const k = (top ? 0.36 : 1) * size;
    const L = (0.42 + Math.random() * 0.18) * k, H = (0.2 + Math.random() * 0.06) * k, F = (0.26 + Math.random() * 0.08) * k;
    const root = new THREE.Group();
    // 火焰：沿枪管方向（枪的局部 +Z）
    const flame = new THREE.Group();
    const fm = mat(this.flameTex, 0xffd08a);
    const a = new THREE.Mesh(this.flameGeo ||= new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2).translate(0, 0, 0.5), fm);
    const b2 = a.clone(); b2.rotation.z = Math.PI / 2;
    flame.add(a, b2);
    flame.rotation.z = Math.random() * Math.PI;
    flame.scale.set(H, H, L);
    // 正对镜头的星形闪光
    const burst = new THREE.Mesh(this.sparkGeo, mat(this.burstTex, 0xfff0c8));
    burst.scale.setScalar(F / 0.22);
    burst.userData.spin = Math.random() * Math.PI;
    root.add(flame, burst);
    const order = top ? 50 : 5;
    root.traverse((o) => { o.renderOrder = order; });
    if (anchor?.obj) {
      anchor.obj.updateWorldMatrix(true, false);
      anchor.obj.add(root);
      const ws = anchor.obj.getWorldScale(_v).x || 1;
      root.scale.setScalar(1 / ws);
      // 往前挪一点：火光从枪口外面开始，而不是糊在枪管上
      root.position.copy(anchor.local).add(_v.set(0, 0, 0.05 * k / ws));
    } else {
      root.position.copy(pos);
      root.quaternion.copy(cam.quaternion);
      this.scene.add(root);
    }
    const it = { obj: root, burst, mats: [fm, burst.material], t: 0, life: 0.055 * Math.max(1, size * 0.8), kind: 'flash', follow: anchor?.obj ? anchor : null, cam: anchor?.cam || cam };
    this._faceCam(it);
    this.items.push(it);
    // 照亮周围一下（只用一盏常驻的点光，避免频繁增删灯光导致重新编译着色器）
    if (dist < 30) {
      this.flashLight.position.copy(pos);
      this.flashLight.intensity = 5 * size;
    }
  }

  // 星形闪光正对镜头（挂在枪上时要抵消枪自己的旋转）
  _faceCam(it) {
    const m = it.burst;
    m.parent.updateWorldMatrix(true, false);
    m.parent.getWorldQuaternion(_q).invert();
    m.quaternion.copy(_q).multiply(it.cam.quaternion);
    m.rotateZ(m.userData.spin);
  }

  impact(pos, cam, big = false) {
    const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
    m.position.copy(pos);
    m.quaternion.copy(cam.quaternion);
    m.rotateZ(Math.random() * Math.PI);
    m.scale.setScalar(big ? 1.6 : 0.9);
    this.scene.add(m);
    this.items.push({ obj: m, t: 0, life: 0.12, kind: 'pop', shared: true });
  }

  throwBomb(pos, vel) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), this.inkMat);
    mesh.castShadow = true;
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.bombs.push({ mesh, vel: vel.clone(), t: 0 });
  }

  // 追踪（比例导引）：看“目标在视野里横着移动得多快”，往目标将要到的位置提前转，而不是追着目标屁股跑；
  // 再加一点直接朝目标转的修正。横向转向有上限（拐不了急弯）。离目标够近就近炸；目标死了或者跑到身后就放弃
  _home(b, dt) {
    const t = b.target;
    if (!t.alive) { b.target = null; return; }
    const rel = aimPoint(t, _w).sub(b.mesh.position);
    const dist = rel.length();
    if (dist < LOCK.fuse) { b.fuse = true; return; }
    const los = rel.divideScalar(dist);
    if (!b.prevLos) b.prevLos = los.clone();
    if (b.t < LOCK.delay) { b.prevLos.copy(los); return; }
    const speed = b.vel.length();
    const cur = _v.copy(b.vel).divideScalar(speed);
    if (cur.angleTo(los) > LOCK.lose) { b.target = null; return; }
    const losRate = _hA.copy(los).sub(b.prevLos).divideScalar(Math.max(dt, 1e-3));
    b.prevLos.copy(los);
    const acc = _hB.copy(losRate).multiplyScalar(LOCK.nav * speed)
      .addScaledVector(_hC.copy(los).addScaledVector(cur, -cur.dot(los)), LOCK.pursue * speed);
    acc.addScaledVector(cur, -acc.dot(cur));           // 只保留横向（转弯）分量，速度大小不变
    const amax = speed * LOCK.turn;
    if (acc.lengthSq() > amax * amax) acc.setLength(amax);
    b.vel.addScaledVector(acc, dt).setLength(speed);
    b.mesh.lookAt(_w.copy(b.mesh.position).add(b.vel));
  }

  // 火箭弹：直线飞行，撞到墙或靶子就爆炸
  // target：锁定的敌人（可以为空 = 直飞）
  fireRocket(pos, dir, spec, target = null) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.42, 10).rotateX(Math.PI / 2), new THREE.MeshToonMaterial({ color: 0x4d5a3a }));
    const flame = new THREE.Mesh(this.sparkGeo, this.flashMat);
    flame.position.z = -0.28;
    mesh.add(flame);
    mesh.position.copy(pos);
    mesh.lookAt(pos.clone().add(dir));
    this.scene.add(mesh);
    this.bombs.push({ mesh, vel: dir.clone().multiplyScalar(spec.speed), t: 0, rocket: spec, flame, target });
  }

  explode(pos, radius = TUNING.bomb.radius, damage = TUNING.bomb.damage) {
    // 墨水球
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x1d1d33, transparent: true, opacity: 0.85, depthWrite: false })
    );
    ball.position.copy(pos);
    this.scene.add(ball);
    this.items.push({ obj: ball, t: 0, life: 0.45, kind: 'blast', r: radius });

    // 地面墨迹
    const hit = this.game.raycastWorld(_v.copy(pos).add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, -1, 0), 4);
    if (hit) {
      const splat = new THREE.Mesh(
        new THREE.PlaneGeometry(radius * 1.6, radius * 1.6),
        new THREE.MeshBasicMaterial({ map: this.splatTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })
      );
      splat.position.copy(hit.position).addScaledVector(hit.normal, 0.02);
      splat.lookAt(_v.copy(splat.position).add(hit.normal));
      splat.rotateZ(Math.random() * Math.PI * 2);
      this.scene.add(splat);
      this.items.push({ obj: splat, t: 0, life: 6, kind: 'decal' });
    }

    this.game.dummies.explode(pos, radius, damage);
    const d = pos.distanceTo(this.game.camera.position);
    this.game.sfx.play('explosion', THREE.MathUtils.clamp(1.1 - d / 60, 0.25, 1), 0.95 + Math.random() * 0.1);
    this.game.shake(0.35);
  }

  update(dt) {
    const g = TUNING.gravity;
    if (this.flashLight && this.flashLight.intensity > 0) this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 120);
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t += dt;
      if (!b.rocket) { b.vel.y -= g * 0.6 * dt; b.mesh.rotation.x += dt * 8; }
      else { b.flame.quaternion.copy(this.game.camera.quaternion).premultiply(b.mesh.quaternion.clone().invert()); b.flame.scale.setScalar(0.8 + Math.random() * 0.6); }
      if (b.target) this._home(b, dt);
      b.mesh.position.addScaledVector(b.vel, dt);
      _sphere.set(b.mesh.position, 0.16);
      const hitWorld = this.game.octree.sphereIntersect(_sphere);
      const hitDummy = this.game.dummies.nearPoint(b.mesh.position, 0.7);
      if (hitWorld || hitDummy || b.fuse || b.t > 4) {
        if (b.rocket) this.explode(b.mesh.position.clone(), b.rocket.radius, b.rocket.damage);
        else this.explode(b.mesh.position.clone());
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        this.bombs.splice(i, 1);
      }
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        it.obj.removeFromParent();
        if (it.mats) it.mats.forEach((m) => m.dispose());
        else if (!it.shared) { it.obj.geometry?.dispose?.(); it.obj.material?.dispose?.(); }
        else if (it.sprite) it.obj.material.dispose(); // 精灵的几何体是全局共用的，只释放材质
        this.items.splice(i, 1);
        continue;
      }
      if (it.kind === 'fade') it.obj.material.opacity = 1 - k;
      else if (it.kind === 'pop') it.obj.scale.multiplyScalar(1 + dt * 6);
      else if (it.kind === 'flash') {
        const f = 1 - k * k;
        for (const m of it.mats) m.opacity = f;
        it.obj.children[0].scale.z *= 1 + dt * 5;   // 火焰往前窜一点
        this._faceCam(it);
      }
      else if (it.kind === 'glow') {
        it.obj.scale.set(it.sx * (1 + k * 0.8), it.sy * (1 + k * 0.8), 1);
        it.obj.material.opacity = 1 - k;
      } else if (it.kind === 'spark') {
        it.vel.y -= 9 * dt;
        it.obj.position.addScaledVector(it.vel, dt);
        // 让拉长的火星贴图在屏幕上顺着速度方向
        const cam = this.game.camera;
        _v.copy(it.obj.position).project(cam);
        const ax = _v.x, ay = _v.y;
        _v.copy(it.obj.position).addScaledVector(it.vel, 0.02).project(cam);
        it.obj.material.rotation = Math.atan2((_v.y - ay), (_v.x - ax) * cam.aspect);
        const sp = Math.min(1, it.vel.length() / 6);
        it.obj.scale.set(it.sx * (0.4 + 0.6 * sp) * (1 - k * 0.5), it.sy * (1 - k * 0.4), 1);
        it.obj.material.opacity = k < 0.5 ? 1 : (1 - k) * 2;
      } else if (it.kind === 'blast') {
        const s = it.r * (0.3 + 0.7 * Math.sqrt(k));
        it.obj.scale.setScalar(s);
        it.obj.material.opacity = 0.85 * (1 - k);
      } else if (it.kind === 'decal' && k > 0.7) {
        it.obj.material.opacity = (1 - k) / 0.3;
      }
    }
  }
}

function makeStarTexture(color = '#ffe27a') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.translate(32, 32);
  x.fillStyle = color;
  x.beginPath();
  for (let i = 0; i < 16; i++) {
    const r = i % 2 ? 9 : 30;
    const a = (i / 16) * Math.PI * 2;
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSplatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(29,29,51,0.85)';
  x.beginPath(); x.arc(128, 128, 70, 0, Math.PI * 2); x.fill();
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 60 + Math.random() * 55;
    const r = 6 + Math.random() * 18;
    x.beginPath(); x.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, r, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 命中柔光：白芯 → 淡红 → 透明（贴图本身是白/灰，颜色由材质 color 着色）
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,.95)');
  g.addColorStop(0.4, 'rgba(255,225,225,.55)');
  g.addColorStop(1, 'rgba(255,200,200,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  // 四角星芒
  x.translate(64, 64); x.fillStyle = 'rgba(255,255,255,.9)';
  for (let i = 0; i < 4; i++) { x.rotate(Math.PI / 2); x.beginPath(); x.moveTo(-4, 0); x.lineTo(0, -58); x.lineTo(4, 0); x.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 火星：横向拉长、两头尖、中间白亮
function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.35, 'rgba(255,255,255,.9)');
  g.addColorStop(0.8, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  // 外圈偏暗（着色后是深一点的红边，白色背景上也看得清），里面白亮
  const e = x.createLinearGradient(0, 0, 128, 0);
  e.addColorStop(0, 'rgba(200,200,200,0)'); e.addColorStop(0.5, 'rgba(200,200,200,.85)'); e.addColorStop(1, 'rgba(200,200,200,1)');
  x.fillStyle = e;
  x.beginPath(); x.moveTo(0, 16); x.quadraticCurveTo(90, 1, 128, 16); x.quadraticCurveTo(90, 31, 0, 16); x.fill();
  x.fillStyle = g;
  x.beginPath(); x.moveTo(8, 16); x.quadraticCurveTo(92, 5, 124, 16); x.quadraticCurveTo(92, 27, 8, 16); x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 枪口火焰：一头圆、一头尖的火舌，中间白热，往外橙黄，边缘透明（加法混合，黑色 = 不发光）
function makeFlameTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  // 贴图的 v 方向是火焰长度（底部 = 枪口）
  for (let i = 0; i < 3; i++) {
    const w = [26, 18, 9][i], col = ['rgba(255,140,40,.55)', 'rgba(255,205,110,.85)', 'rgba(255,250,225,1)'][i];
    const gr = x.createLinearGradient(0, 128, 0, 0);
    gr.addColorStop(0, col); gr.addColorStop(0.55, col); gr.addColorStop(1, 'rgba(255,120,30,0)');
    x.fillStyle = gr;
    x.beginPath();
    x.moveTo(32 - w, 124);
    x.bezierCurveTo(32 - w * 1.1, 70, 32 - w * 0.35, 30, 32, 4 + i * 10);
    x.bezierCurveTo(32 + w * 0.35, 30, 32 + w * 1.1, 70, 32 + w, 124);
    x.closePath(); x.fill();
  }
  x.globalCompositeOperation = 'destination-in';
  const fade = x.createLinearGradient(0, 128, 0, 100);
  fade.addColorStop(0, 'rgba(0,0,0,.6)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  x.fillStyle = fade; x.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // 平面旋转后：U 沿长度方向；把贴图转 90° 对上
  t.center.set(0.5, 0.5); t.rotation = -Math.PI / 2;
  return t;
}

// 正面闪光：柔和的光团 + 五道细长的光芒
function makeBurstTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 60);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.15, 'rgba(255,236,170,.95)');
  g.addColorStop(0.4, 'rgba(255,170,70,.45)'); g.addColorStop(1, 'rgba(255,120,30,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.translate(64, 64);
  for (let i = 0; i < 5; i++) {
    x.rotate(Math.PI * 2 / 5 + (Math.random() - 0.5) * 0.3);
    const len = 44 + Math.random() * 16;
    const sg = x.createLinearGradient(0, 0, 0, -len);
    sg.addColorStop(0, 'rgba(255,245,210,.95)'); sg.addColorStop(1, 'rgba(255,170,60,0)');
    x.fillStyle = sg;
    x.beginPath(); x.moveTo(-4, 0); x.quadraticCurveTo(-1.5, -len * 0.5, 0, -len); x.quadraticCurveTo(1.5, -len * 0.5, 4, 0); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
