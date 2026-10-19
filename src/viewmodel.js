import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { solveArm, orientHand, wristForContact, curlFingers, CURL_RIGHT, CURL_LEFT, mixCurl } from './ik.js';
import { GUN_SCALE } from './player.js';
import { registerCharacter, unregisterCharacter } from './charlight.js';

// 第一人称手臂（viewmodel）
// 和全身模型分开的第二套：从当前角色复制一份，只留两条手臂，和一把单独的枪一起固定在镜头前，
// 单独一个场景、单独一个相机渲染，画在最上层（不会穿墙）。全身模型照常动（影子、联机时别人看到的都是它），
// 只是第一人称时主镜头不渲染它。

const HIDDEN_LAYER = 11; // 第一人称时全身模型和它的枪放到这个图层：主镜头看不到，但还会投影

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const SEGS = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], other: ['Proximal', 'Intermediate', 'Distal'] };
const ARM_BONES = [];
for (const side of ['left', 'right']) {
  ARM_BONES.push(side + 'UpperArm', side + 'LowerArm', side + 'Hand');
  for (const f of FINGERS) for (const s of SEGS[f === 'Thumb' ? 'Thumb' : 'other']) ARM_BONES.push(side + f + s);
}

// 枪在镜头空间里的位置（米，镜头在原点看向 -Z，+X 右，+Y 上）
// hip = 平时，ads = 右键瞄准（x / y 为 null 表示自动对齐：照门/瞄准镜正好在视线上）
const POSE = {
  rifle: { hip: [0.105, -0.128, -0.22], ads: [0, null, -0.17] },
  pistol: { hip: [0.09, -0.135, -0.26], ads: [0, null, -0.19] },
  launcher: { hip: [0.17, -0.1, -0.08], ads: [0.15, -0.105, -0.1] }, // 火箭筒瞄准时筒身靠右，中间留给测距仪
};
// 换弹时枪在镜头前的姿势（叠加在平时位置上）：p 位移，r = [枪口上抬, 枪口左转, 顺时针侧倾]（弧度）
// 火箭筒的换弹动画是给第三人称做的（整根筒横到胸前），第一人称下改成把筒横放在眼前、炮尾朝左
const RELOAD_POSE = {
  rifle: { p: [-0.05, 0.07, -0.09], r: [0.12, 0.3, 0.5] },
  pistol: { p: [-0.04, 0.05, -0.05], r: [0.25, 0.25, 0.4] },
  launcher: { p: [0.18, -0.03, -0.38], r: [0.05, -1.45, 0.1], resetRoot: true },
};
const SHOULDER = new THREE.Vector3(0, -0.2, 0.05); // 两肩中点相对镜头的位置：抬高、靠前一点，能看到前臂和手肘（完整的手臂）
const FOV = 58;
const ease = (k) => k * k * (3 - 2 * k);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x9fb4d6, 1.7);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun = sun; // 昼夜循环时 env.js 会同步这两盏灯的颜色和亮度
    sun.position.set(0.6, 1, 0.5);
    this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 10);
    this.camera.layers.enableAll();
    this.root = new THREE.Group(); // 手臂
    this.anchor = new THREE.Group(); // 枪
    this.scene.add(this.root, this.anchor);
    this.arms = null;
    this.guns = {};
    this.gun = null;
    this.visibleNow = false;
    this.s = { bobT: 0, t: 0, swayX: 0, swayY: 0, swayRot: 0, jumpY: 0, land: 0, reach: 0, lastYaw: null, lastPitch: 0, wasFloor: true, reload: 0 };
    this._hidden = { vrm: null, gun: null, on: false };
  }

  // 换角色时：复制一份角色模型，只保留手臂的三角面
  setCharacter(vrm) {
    if (this.arms) { this.root.remove(this.arms.obj); unregisterCharacter(this.arms.obj); this.arms = null; }
    const src = vrm.scene;
    src.updateMatrixWorld(true);
    const copy = cloneSkinned(src);
    // 原模型节点 → 复制品节点（两棵树结构完全相同，按顺序对应）
    const a = [], b = [];
    src.traverse((o) => a.push(o));
    copy.traverse((o) => b.push(o));
    const map = new Map(a.map((o, i) => [o, b[i]]));
    const H = vrm.humanoid;
    const bones = {};
    for (const n of [...ARM_BONES, 'leftShoulder', 'rightShoulder']) {
      const o = H.getRawBoneNode(n);
      if (o) bones[n] = map.get(o);
    }
    if (!bones.leftUpperArm || !bones.rightUpperArm || !bones.leftHand || !bones.rightHand) { console.warn('角色缺少手臂骨骼，第一人称手臂不可用'); return; }
    // 手臂骨骼 + 它们下面的所有骨骼：MMD 转的模型前臂大多绑在“捩”（扭转）骨和袖子的摆动骨上，
    // 只认人形骨骼的话这些三角面会被丢掉，手臂就只剩一截
    const armSet = new Set(ARM_BONES.map((n) => bones[n]).filter(Boolean));
    for (const side of ['left', 'right']) bones[side + 'UpperArm'].traverse((o) => armSet.add(o));
    const isArmNode = (o) => { for (let p = o; p; p = p.parent) if (armSet.has(p)) return true; return false; };

    copy.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      if (o.isSkinnedMesh) keepArmTriangles(o, armSet);
      else if (!isArmNode(o)) o.visible = false;
    });

    // 复制品的静止姿势（每帧先恢复，再做 IK）
    const rest = [];
    copy.traverse((o) => rest.push([o, o.position.clone(), o.quaternion.clone()]));

    this.root.add(copy);
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    // 让角色的右边朝向镜头的 +X
    const L = bones.leftUpperArm.getWorldPosition(new THREE.Vector3());
    const R = bones.rightUpperArm.getWorldPosition(new THREE.Vector3());
    const d = R.clone().sub(L);
    this.root.rotation.y = Math.atan2(d.z, d.x);
    this.root.updateMatrixWorld(true);
    const mid = bones.leftUpperArm.getWorldPosition(new THREE.Vector3()).add(bones.rightUpperArm.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    const len = (x, y) => bones[x].getWorldPosition(new THREE.Vector3()).distanceTo(bones[y].getWorldPosition(new THREE.Vector3()));
    const fingers = (side) => ({ lower: bones[side + 'LowerArm'], hand: bones[side + 'Hand'], middle: bones[side + 'MiddleProximal'], index: bones[side + 'IndexProximal'], little: bones[side + 'LittleProximal'] });
    registerCharacter(copy);
    this.arms = {
      obj: copy, bones, rest, mid0: mid.sub(this.root.position),
      armL: len('leftUpperArm', 'leftLowerArm') + len('leftLowerArm', 'leftHand'),
      armR: len('rightUpperArm', 'rightLowerArm') + len('rightLowerArm', 'rightHand'),
      palm: { l: bones.leftMiddleProximal ? len('leftHand', 'leftMiddleProximal') : 0.08, r: bones.rightMiddleProximal ? len('rightHand', 'rightMiddleProximal') : 0.08 },
      fl: fingers('left'), fr: fingers('right'),
      hum: { getRawBoneNode: (n) => bones[n] || null },
    };
    this.s.lastYaw = null;
  }

  // 第一人称用的那把枪：从全身模型的枪复制一份，带自己的换弹动画播放器
  _gunFor(def, holder) {
    const key = def.id;
    if (this.guns[key]?.src === holder) return this.guns[key];
    const g = new THREE.Group();
    const inner = cloneSkinned(holder.children[0]);
    inner.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      o.castShadow = false;
      o.layers.set(0);
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    });
    g.add(inner);
    const U = holder.userData;
    const info = { src: holder, obj: g, reloadRoot: inner.getObjectByName('ReloadRoot'), muzzle: U.muzzle.clone(), palmIK: !!U.palmIK, ikL: inner.getObjectByName('IK_LeftHand'), ikR: inner.getObjectByName('IK_RightHand') };
    if (U.reloadClip) {
      info.mixer = new THREE.AnimationMixer(inner);
      info.action = info.mixer.clipAction(U.reloadClip);
      info.action.setLoop(THREE.LoopOnce, 1);
    }
    // 瞄具高度：照门（或瞄准镜中心）在枪的空间里有多高，右键瞄准时把它放到视线上
    g.updateMatrixWorld(true);
    let part = null;
    let lens = null;
    inner.traverse((o) => { if (!lens && o.userData.sightLens) lens = o; });
    inner.traverse((o) => { if (!part && /Part_(Sight_Rear|Scope)/.test(o.name)) part = o; });
    if (lens) { // 装了瞄具：视线对准镜片中心
      const c = lens.getWorldPosition(new THREE.Vector3());
      const inv = g.matrixWorld.clone().invert(); c.applyMatrix4(inv);
      info.sightX = c.x; info.sightY = c.y; info.sightZ = c.z; info.optic = true;
      info.dots = []; inner.traverse((o) => { if (o.userData.reticle) info.dots.push(o); });
      this.guns[key] = info;
      return info;
    }
    const box = new THREE.Box3().setFromObject(part || inner);
    info.sightX = part ? (box.min.x + box.max.x) / 2 : 0;
    info.sightY = part ? (/Scope/.test(part.name) ? (box.min.y + box.max.y) / 2 : box.max.y - 0.004) : box.max.y * 0.9;
    this.guns[key] = info;
    return info;
  }

  // 第一人称时把全身模型和它的枪换到隐藏图层（还会投影）；切回第三人称时恢复
  _hideWorld(player, on) {
    const H = this._hidden;
    if (H.vrm === player.vrm && H.gun === player.gun && H.on === on) return;
    const apply = (root, hide) => root?.traverse((o) => {
      if (!o.isMesh) return;
      if (hide) { if (o.userData._mask === undefined) o.userData._mask = o.layers.mask; o.layers.mask = 1 << HIDDEN_LAYER; }
      else if (o.userData._mask !== undefined) { o.layers.mask = o.userData._mask; delete o.userData._mask; }
    });
    if (H.gun && H.gun !== player.gun) apply(H.gun, false);
    if (H.vrm && H.vrm !== player.vrm) apply(H.vrm.scene, false);
    apply(player.vrm?.scene, on);
    apply(player.gun, on);
    Object.assign(H, { vrm: player.vrm, gun: player.gun, on });
  }

  update(dt, player, mainCam) {
    const active = !!(player.firstPerson && player.alive && player.gun && player.vrm && this.arms && !(player.orbitK > 0.01));
    this._hideWorld(player, active);
    this.visibleNow = active && !player.scoped;
    if (!active) { this.s.lastYaw = null; return; }

    const W = player.weapon.def;
    const gun = this._gunFor(W, player.gun);
    if (this.gun !== gun) {
      if (this.gun) this.anchor.remove(this.gun.obj);
      this.gun = gun;
      this.anchor.add(gun.obj);
    }
    const cam = this.camera;
    if (cam.aspect !== mainCam.aspect) { cam.aspect = mainCam.aspect; cam.updateProjectionMatrix(); }

    // —— 枪的位置：腰射 / 瞄准，再叠加 走路摆动、转视角滞后、跳跃、后坐、切枪、纸化 ——
    const S = this.s;
    S.t += dt;
    const e = ease(player.ads);
    if (gun.dots) for (const d of gun.dots) d.visible = player.ads > 0.6; // 瞄具红点：瞄准时才出现
    const scale = GUN_SCALE[W.hold] || 1;
    const pose = POSE[W.hold] || POSE.rifle;
    const ads = pose.ads.slice();
    if (ads[0] === null) ads[0] = gun.sightX * scale; // 枪朝 -Z 时枪的 +X（左侧）在镜头的 -X 方向
    if (ads[1] === null) ads[1] = -(gun.sightY + (gun.optic ? 0 : (W.ads?.sightDy || 0))) * scale; // sightDy：个别枪照门形状特殊，单独微调
    if (W.ads?.z != null) ads[2] = W.ads.z; // 个别枪开镜时枪离眼睛的距离（越接近 0 越近）
    if (gun.optic) ads[2] = Math.max(ads[2], -(gun.sightZ + 0.075) * scale); // 瞄具：眼睛贴近镜片（适眼距 7.5cm）
    const pos = new THREE.Vector3().fromArray(pose.hip).lerp(new THREE.Vector3().fromArray(ads), e);

    // 转视角时枪稍微落后一点（惯性）
    if (S.lastYaw === null) { S.lastYaw = player.yaw; S.lastPitch = player.pitch; }
    let dy = player.yaw - S.lastYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const dp = player.pitch - S.lastPitch;
    S.lastYaw = player.yaw; S.lastPitch = player.pitch;
    const k = 1 - 0.75 * e;
    const tx = THREE.MathUtils.clamp(dy * 0.5, -0.03, 0.03) * k;
    const ty = THREE.MathUtils.clamp(-dp * 0.5, -0.025, 0.025) * k;
    S.swayX += (tx - S.swayX) * Math.min(1, dt * 10);
    S.swayY += (ty - S.swayY) * Math.min(1, dt * 10);
    S.swayRot += (THREE.MathUtils.clamp(dy * 2, -0.12, 0.12) * k - S.swayRot) * Math.min(1, dt * 8);

    // 走路摆动（瞄准时很小）
    const hs = Math.hypot(player.vel.x, player.vel.z);
    const amp = THREE.MathUtils.clamp(hs / 4.8, 0, 1) * (player.onFloor ? 1 : 0.15) * (1 - 0.8 * e);
    S.bobT += dt * (2 + hs * 1.75);
    const bobX = Math.sin(S.bobT) * 0.013 * amp;
    const bobY = -Math.abs(Math.cos(S.bobT)) * 0.011 * amp + Math.sin(S.t * 1.7) * 0.0018 * (1 - e);
    // 跳跃 / 落地
    if (player.onFloor && !S.wasFloor) S.land = Math.min(1, S.land + 0.6);
    S.wasFloor = player.onFloor;
    S.land = Math.max(0, S.land - dt * 4);
    S.jumpY += (THREE.MathUtils.clamp(-player.vel.y * 0.0035, -0.025, 0.03) * (player.onFloor ? 0 : 1) - S.jumpY) * Math.min(1, dt * 10);
    // 后坐：往后顶、枪口上抬
    const rk = THREE.MathUtils.clamp(W.recoil * 45, 0.4, 1.4) * (1 - 0.45 * e);
    const kick = Math.min(1.2, player.kick || 0) * rk;
    // 切枪：从下面举上来
    const sw = ease(Math.min(1, (player.switchT || 0) / 0.35));
    const paper = player.paperAmt;
    // 换弹时枪稍微往下、往里歪一点，让动作更容易看清
    S.reload += ((player.reloadT > 0 ? 1 : 0) - S.reload) * Math.min(1, dt * 8);

    const RP = RELOAD_POSE[W.hold] || RELOAD_POSE.rifle;
    const rl = ease(S.reload);
    pos.x += bobX + S.swayX + RP.p[0] * rl;
    pos.y += bobY + S.swayY + S.jumpY - S.land * 0.02 - sw * 0.22 - paper * 0.35 + RP.p[1] * rl;
    pos.z += kick * 0.04 + RP.p[2] * rl;
    this.anchor.position.copy(pos);
    _e.set(-sw * 0.7 + kick * 0.07 + RP.r[0] * rl, S.swayRot * 0.5 + RP.r[1] * rl, Math.sin(S.bobT) * 0.025 * amp + S.swayRot * 0.6 - RP.r[2] * rl, 'YXZ');
    this.anchor.quaternion.setFromEuler(_e).multiply(_q.setFromAxisAngle(_v.set(0, 1, 0), Math.PI)); // 枪的 +Z（枪口）朝向镜头前方 -Z
    this.anchor.scale.setScalar(scale);

    // 换弹动画：和全身模型那把枪同步播放
    const wa = player.gun.userData.reloadAction;
    if (gun.action) {
      if (wa?.isRunning()) {
        if (!gun.action.isRunning()) gun.action.reset().play();
        gun.action.time = wa.time;
        gun.mixer.update(0);
        if (RP.resetRoot && gun.reloadRoot) { gun.reloadRoot.position.set(0, 0, 0); gun.reloadRoot.quaternion.identity(); }
      } else if (gun.action.isRunning()) { gun.action.stop(); gun.mixer.update(0); }
    }
    this.scene.updateMatrixWorld(true);

    // —— 手臂：恢复静止姿势 → 肩膀放到镜头下方 → IK 把双手放到握把和护木上 ——
    const A = this.arms;
    for (const [o, p, q] of A.rest) { o.position.copy(p); o.quaternion.copy(q); }
    const G = W.grip;
    const reloading = !!wa?.isRunning();
    const space = gun.ikR ? gun.ikR.parent : gun.obj;
    const spaceQ = space.getWorldQuaternion(new THREE.Quaternion());
    const P = (v) => space.localToWorld(new THREE.Vector3(v[0], v[1], v[2]));
    const D = (v) => new THREE.Vector3().fromArray(v).applyQuaternion(spaceQ).normalize();

    let rT, rD, rN, lT, lD, lN, lCurl = null;
    if (G?.r?.c) { rD = D(G.r.d); rN = D(G.r.n); rT = wristForContact(P(G.r.c), rD, rN, A.palm.r); }
    else rT = gun.ikR.getWorldPosition(new THREE.Vector3());
    if (gun.palmIK && gun.ikL) {
      const c = gun.ikL.getWorldPosition(new THREE.Vector3());
      const q = gun.ikL.getWorldQuaternion(new THREE.Quaternion());
      lD = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      lN = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const s3 = gun.ikL.scale;
      lCurl = mixCurl([s3.x - 1, s3.y - 1, s3.z - 1]);
      lT = wristForContact(c, lD, lN, A.palm.l);
    } else if (!reloading && G?.l?.c) {
      lD = D(G.l.d); lN = D(G.l.n); lCurl = CURL_LEFT;
      lT = wristForContact(P(G.l.c), lD, lN, A.palm.l);
    } else {
      lT = gun.ikL ? gun.ikL.getWorldPosition(new THREE.Vector3()) : P([3, -3, 20]);
      if (!reloading && G?.l) { lD = D(G.l.d); lN = D(G.l.n); lCurl = CURL_LEFT; }
    }

    // 肩膀放到镜头下方；够不着枪的时候整副手臂往前挪（躯干被去掉了，看不出来）
    const shoulders = (z) => {
      this.root.position.copy(SHOULDER).sub(A.mid0);
      this.root.position.z -= z;
      this.root.updateMatrixWorld(true);
    };
    shoulders(S.reach);
    const need = Math.max(
      A.bones.leftUpperArm.getWorldPosition(_v).distanceTo(lT) - A.armL * 0.93,
      A.bones.rightUpperArm.getWorldPosition(_v).distanceTo(rT) - A.armR * 0.93,
      0,
    );
    S.reach += (Math.min(0.35, S.reach + need * 0.9) - S.reach) * Math.min(1, dt * 12);
    S.reach = Math.max(0, S.reach - dt * 0.05); // 不需要时慢慢退回来
    shoulders(S.reach);

    const rU = A.bones.rightUpperArm, lU = A.bones.leftUpperArm;
    const rPole = rU.getWorldPosition(new THREE.Vector3()).add(_v.set(0.45, -0.7, 0.2));
    solveArm(rU, A.bones.rightLowerArm, A.bones.rightHand, rT, rPole, 1);
    if (rD && A.fr.middle) { orientHand(A.fr, true, rD, rN, 1); curlFingers(A.hum, 'right', rD, rN, CURL_RIGHT, 1); }
    const lPole = lU.getWorldPosition(new THREE.Vector3()).add(_v.set(-0.4, -0.7, 0.1));
    solveArm(lU, A.bones.leftLowerArm, A.bones.leftHand, lT, lPole, 1);
    if (lD && A.fl.middle) { orientHand(A.fl, false, lD, lN, 1); curlFingers(A.hum, 'left', lD, lN, lCurl, 1); }
    this.dbg = { lT, lD, lN, rT, rD, rN }; // 调试用
  }

  render(renderer) {
    if (!this.visibleNow) return;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }

  // 第一人称枪口在世界里的位置：把手臂场景里的枪口投到屏幕上，再按同样的深度放回主镜头的世界里
  muzzleWorld(out, mainCam) {
    if (!this.gun) return null;
    const p = this.gun.obj.localToWorld(_v.copy(this.gun.muzzle));
    const depth = -p.z;
    const ndc = p.clone().project(this.camera);
    const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(mainCam).sub(mainCam.position).normalize();
    const fwd = mainCam.getWorldDirection(new THREE.Vector3());
    return out.copy(mainCam.position).addScaledVector(dir, depth / Math.max(0.2, dir.dot(fwd)));
  }
}

// 只保留主要受手臂骨骼影响的三角面（衣袖、手），其余（躯干、腿、头发）删掉
function keepArmTriangles(mesh, armSet) {
  const g = mesh.geometry.clone();
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const bones = mesh.skeleton.bones;
  const n = g.attributes.position.count;
  const armW = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    let w = 0;
    for (let j = 0; j < 4; j++) { const b = bones[si.getComponent(v, j)]; if (b && armSet.has(b)) w += sw.getComponent(v, j); }
    armW[v] = w;
  }
  const idx = g.index ? g.index.array : Array.from({ length: n }, (_, i) => i);
  const groups = g.groups.length ? g.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
  const out = [];
  const newGroups = [];
  for (const gr of groups) {
    const start = out.length;
    for (let i = gr.start; i < gr.start + gr.count; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      if ((armW[a] + armW[b] + armW[c]) / 3 > 0.5) out.push(a, b, c);
    }
    if (out.length > start) newGroups.push({ start, count: out.length - start, materialIndex: gr.materialIndex });
  }
  if (!out.length) { mesh.visible = false; return; }
  // 留下来的顶点里还有一部分权重在躯干骨骼上（肩膀、腋下、袖口）。第一人称手臂离躯干原位很远，
  // 这些顶点会被拉成长长的尖刺，所以把躯干那部分权重都转给这个顶点上权重最大的手臂骨骼
  for (let v = 0; v < n; v++) {
    if (armW[v] <= 0 || armW[v] >= 0.999) continue;
    let best = -1, bw = -1, moved = 0;
    for (let j = 0; j < 4; j++) {
      const b = bones[si.getComponent(v, j)], w = sw.getComponent(v, j);
      if (b && armSet.has(b)) { if (w > bw) { bw = w; best = j; } } else { moved += w; sw.setComponent(v, j, 0); }
    }
    if (best >= 0) sw.setComponent(v, best, bw + moved);
  }
  sw.needsUpdate = true;
  g.setIndex(out);
  g.clearGroups();
  for (const gr of newGroups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  mesh.geometry = g;
}
