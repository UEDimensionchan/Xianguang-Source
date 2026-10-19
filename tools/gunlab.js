import * as THREE from 'three';
import { FBXLoader } from 'lab/loaders/FBXLoader.js';
window.THREE = THREE;
const loader = new FBXLoader();
const r3 = (v) => v.toArray().map((x) => +x.toFixed(3));
window.__probe = async (url) => {
  const g = await loader.loadAsync(url);
  g.updateMatrixWorld(true);
  const out = { scale: r3(g.scale), bones: [], meshes: [] };
  g.traverse((o) => {
    if (o.isBone) out.bones.push([o.name, r3(o.getWorldPosition(new THREE.Vector3()))]);
    if (o.isMesh) {
      const b = new THREE.Box3().setFromObject(o);
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m.name + (m.map ? '[map:' + (m.map.name || m.map.image?.src?.split('/').pop() || '?') + ']' : ''));
      out.meshes.push({ name: o.name, skinned: o.isSkinnedMesh, verts: o.geometry.attributes.position.count, mats, min: r3(b.min), max: r3(b.max) });
    }
  });
  return out;
};

import { GLTFExporter } from 'lab/exporters/GLTFExporter.js';

// 每把枪：主体 + 装到插槽上的配件。front:true 表示前准星放在护木前端顶部（没有专门插槽）
export const RECIPES = {
  AssaultRifle: { frame: 'SK_AssaultRifle_Frame', parts: [['SM_AssaultRifle_Handguard_Default', 'Handguard'], ['SM_AssaultRifle_Magazine', 'Magazine'], ['SM_AssaultRifle_Sight_Rear', 'Sight_Rear']] },
  SMG: { frame: 'SK_SMG_Frame', parts: [['SM_SMG_Handguard_Default', 'Handguard'], ['SM_SMG_Magazine', 'Magazine'], ['SM_SMG_Sight_Rear', 'Sight_Rear']], front: 'SM_SMG_Sight_Front' },
  LightMachineGun: { frame: 'SK_LightMachineGun_Frame', parts: [['SM_LightMachineGun_Handguard_Default', 'Handguard'], ['SM_LightMachineGun_Magazine', 'Magazine'], ['SM_LightMachineGun_Sight_Rear', 'Sight_Rear']] },
  Sniper: { frame: 'SK_Sniper_Frame', parts: [['SM_Sniper_Barrel_Default', 'Barrel'], ['SM_Sniper_Handguard_Default', 'Handguard'], ['SM_Sniper_Magazine', 'Magazine'], ['SM_Sniper_Scope', 'Scope']] },
  Pistol: { frame: 'SK_Pistol_Default_Combined', parts: [] },
  Revolver: { frame: 'SK_Revolver_Default_Combined', parts: [] },
  Shotgun: { frame: 'SK_Shotgun_Default_Combined', parts: [] },
  RocketLauncher: { frame: 'SK_RocketLauncher', parts: [['SM_RocketLauncher_Grip', 'Grip_Attachment'], ['SM_RocketLauncher_Muzzle_Round', 'Muzzle_Attachment'], ['SM_RocketLauncher_Scope', 'Rail_Attachment']] },
};

const texLoader = new THREE.TextureLoader();
const texCache = {};
// 贴图来自“弦光 / Prism Link”枪械材质包（_PrismLink_弦光项目材质），已缩成 1024 的 jpg 放在 ../_tex：
//   T_<枪>_<序号>_D.jpg = BaseColor，T_<枪>_<序号>_E.jpg = 薄荷青发光（没有发光的图集没有这个文件）
function texFor(matName, kind = 'D') {
  if (matName === 'M_SMG_Bullet') matName = 'M_Attachments_02'; // 材质包说明：SMG 子弹用配件 02 图集
  let m = matName.match(/^M_(.+)_(\d\d)$/);
  if (!m) return null;
  let [, gun, n] = m;
  let file = `T_${gun}_${n}_${kind}`;
  if (gun === 'Revolver') file = `T_Revolver_Silver_${n}_${kind}`;
  if (!texCache[file]) {
    texCache[file] = new Promise((res) => texLoader.load(`../_tex/${file}.jpg`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.userData.mimeType = 'image/jpeg'; t.name = file; res(t);
    }, undefined, () => res(null)));
  }
  return texCache[file];
}

async function material(src) {
  const name = src.name;
  const tex = await texFor(name);
  if (tex) {
    const em = await texFor(name, 'E');
    const m = new THREE.MeshStandardMaterial({ name, map: tex, metalness: 0.35, roughness: 0.55 });
    if (em) { m.emissiveMap = em; m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 0.6; }
    return m;
  }
  if (/Dot/.test(name)) return new THREE.MeshStandardMaterial({ name, color: 0xff3b3b, emissive: 0xff2020 });
  if (/Glass|Render|Fade|Front/.test(name)) return new THREE.MeshStandardMaterial({ name, color: 0x1b2a44, metalness: 0.2, roughness: 0.15 });
  return new THREE.MeshStandardMaterial({ name, color: 0x2a2c31, metalness: 0.4, roughness: 0.5 });
}

// 把一个 FBX 里的网格拷贝成静态网格（蒙皮网格取绑定姿势），变换烘焙进几何体
async function bakeMeshes(fbx, extraMatrix, out) {
  fbx.updateMatrixWorld(true);
  const list = [];
  fbx.traverse((o) => { if (o.isMesh) list.push(o); });
  for (const o of list) {
    const g = o.geometry.clone();
    g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight');
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(o.matrixWorld);
    if (extraMatrix) g.applyMatrix4(extraMatrix);
    const srcMats = Array.isArray(o.material) ? o.material : [o.material];
    const mats = await Promise.all(srcMats.map(material));
    out.push(new THREE.Mesh(g, mats.length === 1 ? mats[0] : mats));
  }
}

window.__buildGun = async (gun) => {
  const R = RECIPES[gun];
  const base = `../_guns/${gun}/Meshes/`;
  const frame = await loader.loadAsync(base + R.frame + '.fbx');
  frame.updateMatrixWorld(true);
  const bones = {};
  frame.traverse((o) => { if (o.isBone) bones[o.name] = o.getWorldPosition(new THREE.Vector3()); });
  const meshes = [];
  await bakeMeshes(frame, null, meshes);
  let hgBox = null, hgAt = null;
  for (const [part, socket] of R.parts) {
    const p = await loader.loadAsync(base + part + '.fbx');
    const at = bones[socket] || new THREE.Vector3();
    const m = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z);
    const before = meshes.length;
    await bakeMeshes(p, m, meshes);
    if (socket === 'Handguard') {
      hgBox = new THREE.Box3(); for (let i = before; i < meshes.length; i++) hgBox.expandByObject(meshes[i]);
      hgAt = at;
    }
  }
  if (R.front && hgBox) {
    const p = await loader.loadAsync(base + R.front + '.fbx');
    const m = new THREE.Matrix4().makeTranslation(0, hgBox.max.y - 0.3, hgBox.max.z - 2.5);
    await bakeMeshes(p, m, meshes);
  }
  const group = new THREE.Group();
  group.name = gun;
  for (const m of meshes) group.add(m);
  const box = new THREE.Box3().setFromObject(group);
  // 枪口：枪管高度上最靠前的点（单位 cm）
  const boreY = (bones.Barrel || bones.Muzzle_Attachment || bones.Handguard || bones.Bolt || new THREE.Vector3()).y;
  const muzzle = [0, boreY, box.max.z];
  // 换算成米：根节点缩放 0.01，原点就是握把
  const root = new THREE.Group();
  root.name = gun;
  root.scale.setScalar(0.01);
  root.add(group);
  root.userData = { muzzle: muzzle.map((v) => +(v * 0.01).toFixed(4)), length: +((box.max.z - box.min.z) * 0.01).toFixed(3), source: 'Infima Games' };
  window.__lastGun = root;
  const tris = meshes.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
  return { gun, parts: meshes.length, tris: Math.round(tris), size: box.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(1)), muzzle };
};

window.__exportGun = async () => {
  const exp = new GLTFExporter();
  const buf = await exp.parseAsync(window.__lastGun, { binary: true, maxTextureSize: 1024 });
  const bytes = new Uint8Array(buf);
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// 渲染一张预览图
window.__preview = async (gun) => {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(480, 280); r.outputColorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0xeef3fa);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(2, 3, 2); sc.add(d);
  const g = window.__lastGun; sc.add(g); g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g); const c = box.getCenter(new THREE.Vector3()); const L = box.getSize(new THREE.Vector3()).length();
  const cam = new THREE.PerspectiveCamera(30, 480 / 280, 0.01, 50);
  cam.position.set(c.x - L * 1.6, c.y + L * 0.25, c.z); cam.lookAt(c);
  r.render(sc, cam);
  sc.remove(g);
  return r.domElement.toDataURL('image/png').split(',')[1];
};

// ———————————— 带骨骼导出 + 换弹动画 ————————————
import { RELOADS } from './reloads.js';

// 每把枪：主体（带骨骼）+ 挂到插槽骨骼上的配件 + 换弹道具节点 + 双手 IK 目标点（厘米，枪的空间）
export const RIGS = {
  AssaultRifle: { frame: 'SK_AssaultRifle_Frame', parts: [['SM_AssaultRifle_Handguard_Default', 'Handguard'], ['SM_AssaultRifle_Magazine', 'Magazine'], ['SM_AssaultRifle_Sight_Rear', 'Sight_Rear']], support: [3, -2, 27] },
  SMG: { frame: 'SK_SMG_Frame', parts: [['SM_SMG_Handguard_Default', 'Handguard'], ['SM_SMG_Magazine', 'Magazine'], ['SM_SMG_Sight_Rear', 'Sight_Rear'], ['SM_SMG_Sight_Front', 'Handguard', [0, 3.3, 18.2]]], support: [3, -2.5, 19] },
  LightMachineGun: { frame: 'SK_LightMachineGun_Frame', parts: [['SM_LightMachineGun_Handguard_Default', 'Handguard'], ['SM_LightMachineGun_Magazine', 'Magazine'], ['SM_LightMachineGun_Sight_Rear', 'Sight_Rear']], support: [3.5, -2.5, 30] },
  Sniper: { frame: 'SK_Sniper_Frame', parts: [['SM_Sniper_Barrel_Default', 'Barrel'], ['SM_Sniper_Handguard_Default', 'Handguard'], ['SM_Sniper_Magazine', 'Magazine'], ['SM_Sniper_Scope', 'Scope']], support: [3, -2.5, 36] },
  Pistol: { frame: 'SK_Pistol_Frame', parts: [['SM_Pistol_Slide_Default', 'Slide'], ['SM_Pistol_Barrel_Default', 'Barrel'], ['SM_Pistol_Magazine', 'Magazine'], ['SM_Pistol_Sight_Rear', 'Sight_Rear'], ['SM_Pistol_Sight_Front', 'Slide', [0, 1.35, 9.4]]], support: [3.5, -6, -1] },
  Revolver: { frame: 'SK_Revolver_Default_Combined', parts: [], nodes: [['Reload_Speedloader', 'SM_Revolver_Speedloader', [8, -22, -2]]], support: [3.5, -6, -1] },
  Shotgun: { frame: 'SK_Shotgun_Default_Combined', parts: [], nodes: [['Reload_Shell', 'SM_Shotgun_Shell', [1, -16, 6]]], support: [3.5, -3, 36] },
  RocketLauncher: { frame: 'SK_RocketLauncher', parts: [['SM_RocketLauncher_Grip', 'Grip_Attachment'], ['SM_RocketLauncher_Muzzle_Round', 'Muzzle_Attachment'], ['SM_RocketLauncher_Scope', 'Rail_Attachment']], nodes: [['Reload_Rocket', 'SM_RocketLauncher_Rocket', [6, -38, -50]]], support: [3, -6, 18], rightWrist: [-0.5, -7.5, -1] },
};

const KEEP = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'];

async function partGroup(fbx, name) {
  fbx.updateMatrixWorld(true);
  const g = new THREE.Group();
  g.name = name;
  const list = [];
  fbx.traverse((o) => { if (o.isMesh) list.push(o); });
  for (const o of list) {
    const geo = o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    geo.applyMatrix4(o.matrixWorld);
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const mats = await Promise.all(src.map(material));
    const m = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
    m.name = name + '_mesh';
    g.add(m);
  }
  return g;
}

// 把配件挂到骨骼下：保持它在枪空间里的朝向不变，只放到插槽位置（+偏移）
function attach(group, bone, off) {
  const at = bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3().fromArray(off || [0, 0, 0]));
  const desired = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z);
  const local = bone.matrixWorld.clone().invert().multiply(desired);
  local.decompose(group.position, group.quaternion, group.scale);
  bone.add(group);
}

const deg = (a) => a.map((v) => THREE.MathUtils.degToRad(v || 0));
const qFromDeg = (r) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...deg(r), 'XYZ'));

// 某个通道在 t 时刻的值（线性插值）
function sample(keys, t) {
  if (!keys.length) return null;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a] = keys[i - 1], [t1, b] = keys[i];
      const k = (t - t0) / Math.max(1e-6, t1 - t0);
      return Array.isArray(a) ? a.map((v, j) => v + (b[j] - v) * k) : a + (b - a) * k;
    }
  }
  return keys[keys.length - 1][1];
}

function buildClip(gun, R, bones, nodeRest) {
  const keys = RELOADS[gun].slice().sort((a, b) => a.t - b.t);
  const ch = {}; // 通道名 → [[t, 值]]
  const put = (name, t, v) => { (ch[name] || (ch[name] = [])).push([t, v]); };
  const rest = { 'root.p': [0, 0, 0], 'root.r': [0, 0, 0] };
  // 先收集骨骼/节点通道，手的位置最后算（它可能依赖部件当时的位置）
  for (const k of keys) {
    if (k.root?.p) put('root.p', k.t, k.root.p);
    if (k.root?.r) put('root.r', k.t, k.root.r);
    for (const [b, v] of Object.entries(k.bones || {})) {
      if (v.p) put(`bone:${b}.p`, k.t, v.p);
      if (v.r) put(`bone:${b}.r`, k.t, v.r);
      if (v.s !== undefined) put(`bone:${b}.s`, k.t, v.s);
    }
    for (const [n, v] of Object.entries(k.nodes || {})) {
      if (v.p) put(`node:${n}.p`, k.t, v.p);
      if (v.r) put(`node:${n}.r`, k.t, v.r);
      if (v.s !== undefined) put(`node:${n}.s`, k.t, v.s);
    }
  }
  // 每个通道在 0 和 1 补上默认姿势
  for (const name of Object.keys(ch)) {
    let r;
    if (rest[name]) r = rest[name];
    else if (name.startsWith('bone:')) r = name.endsWith('.s') ? 1 : [0, 0, 0];
    else if (name.startsWith('node:')) { const n = name.slice(5, -2); r = name.endsWith('.p') ? nodeRest[n] : name.endsWith('.s') ? 0 : [0, 0, 0]; }
    const list = ch[name];
    if (!list.some((x) => x[0] === 0)) list.unshift([0, r]);
    if (!list.some((x) => x[0] === 1)) list.push([1, r]);
    list.sort((a, b) => a[0] - b[0]);
  }
  // 左手
  const where = (name, t) => {
    if (bones[name]) {
      const base = bones[name].getWorldPosition(new THREE.Vector3()).toArray();
      const off = sample(ch[`bone:${name}.p`] || [], t) || [0, 0, 0];
      return base.map((v, i) => v + off[i]);
    }
    return sample(ch[`node:${name}.p`] || [], t) || nodeRest[name] || [0, 0, 0];
  };
  const hand = [[0, R.support]];
  for (const k of keys) {
    if (!k.hand) continue;
    let v;
    if (k.hand === 'rest') v = R.support;
    else if (Array.isArray(k.hand)) v = k.hand;
    else { const p = where(k.hand.at, k.t); v = p.map((x, i) => x + (k.hand.off?.[i] || 0)); }
    hand.push([k.t, v]);
  }
  if (!hand.some((x) => x[0] === 1)) hand.push([1, R.support]);

  // 转成 three.js 动画轨道
  const tracks = [];
  const times = (l) => l.map((x) => x[0]);
  tracks.push(new THREE.VectorKeyframeTrack('IK_LeftHand.position', times(hand), hand.flatMap((x) => x[1])));
  for (const [name, list] of Object.entries(ch)) {
    const T = times(list);
    if (name === 'root.p') tracks.push(new THREE.VectorKeyframeTrack('ReloadRoot.position', T, list.flatMap((x) => x[1])));
    else if (name === 'root.r') tracks.push(new THREE.QuaternionKeyframeTrack('ReloadRoot.quaternion', T, list.flatMap((x) => qFromDeg(x[1]).toArray())));
    else if (name.startsWith('bone:')) {
      const [bn, prop] = name.slice(5).split('.');
      const b = bones[bn];
      if (!b) { console.warn('没有这个骨骼', gun, bn); continue; }
      const Qp = b.parent.getWorldQuaternion(new THREE.Quaternion());
      const QpInv = Qp.clone().invert();
      const Qb = b.getWorldQuaternion(new THREE.Quaternion());
      const p0 = b.userData.restPos, q0 = b.userData.restQuat, s0 = b.userData.restScale;
      if (prop === 'p') tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, T, list.flatMap((x) => p0.clone().add(new THREE.Vector3().fromArray(x[1]).applyQuaternion(QpInv)).toArray())));
      if (prop === 'r') tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, T, list.flatMap((x) => QpInv.clone().multiply(qFromDeg(x[1])).multiply(Qb).toArray())));
      if (prop === 's') tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.scale`, T, list.flatMap((x) => s0.clone().multiplyScalar(Math.max(x[1], 0.0001)).toArray())));
      void q0;
    } else if (name.startsWith('node:')) {
      const [nn, prop] = name.slice(5).split('.');
      if (prop === 'p') tracks.push(new THREE.VectorKeyframeTrack(`${nn}.position`, T, list.flatMap((x) => x[1])));
      if (prop === 'r') tracks.push(new THREE.QuaternionKeyframeTrack(`${nn}.quaternion`, T, list.flatMap((x) => qFromDeg(x[1]).toArray())));
      if (prop === 's') tracks.push(new THREE.VectorKeyframeTrack(`${nn}.scale`, T, list.flatMap((x) => [x[1], x[1], x[1]].map((v) => Math.max(v, 0.0001)))));
    }
  }
  return new THREE.AnimationClip('Reload_' + gun, 1, tracks);
}

// ———— 长枪：左手掌心接触点 + 手型（palm 模式）————
// rest = 静止时左手掌心贴住的位置（护木下沿偏左），厘米
const PALM_REST = { AssaultRifle: [0.4, 0.6, 19.5], SMG: [0.4, -0.6, 21], LightMachineGun: [0.5, -0.2, 21], Sniper: [0.4, -0.3, 25], Shotgun: [0.4, -2.4, 34] };
// 手型：d = 手腕到指根方向，n = 掌心朝向（枪的空间），c = 手指弯曲权重 [握持, 勾, 平掌]
const POSES = {
  rest: { d: [-0.4, 0.15, 0.9], n: [-0.3, 0.95, 0.05], c: [1, 0, 0] },
  mag: { d: [0, -0.35, 0.94], n: [-1, 0, 0], c: [1, 0, 0] },
  charge: { d: [-0.9, -0.1, -0.4], n: [-0.4, -0.9, 0], c: [0, 1, 0] },
  side: { d: [0, 0.2, 0.98], n: [-1, 0, 0], c: [0, 1, 0] },
  sideR: { d: [0, -0.2, 0.98], n: [1, 0, 0], c: [0, 1, 0] },
  flat: { d: [-0.3, 0, 0.95], n: [0, -1, 0], c: [0, 0, 1] },
  shell: { d: [-0.2, 0.1, 0.97], n: [0, 1, 0], c: [0, 0.5, 0.5] },
  open: { d: [-0.2, -0.5, 0.85], n: [-0.6, 0.3, 0.2], c: [0.25, 0, 0.55] },
};
const AUTO_POSE = { Magazine: 'mag', Charging_Handle: 'charge', Feed_Cover: 'flat', Forend: 'rest', Reload_Shell: 'shell', Bolt: 'side' };
const poseQuat = (P) => {
  const x = new THREE.Vector3().fromArray(P.d).normalize();
  const y = new THREE.Vector3().fromArray(P.n);
  y.addScaledVector(x, -y.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
};

// 单调三次插值（不会冲过关键帧），让动作有连续速度而不是每帧都急停
function smoothSampler(keys) {
  const T = keys.map((k) => k[0]);
  const isArr = Array.isArray(keys[0][1]);
  const V = keys.map((k) => (isArr ? k[1] : [k[1]]));
  const n = T.length, dim = V[0].length;
  const M = [];
  for (let j = 0; j < dim; j++) {
    const del = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) del.push((V[i + 1][j] - V[i][j]) / Math.max(1e-6, T[i + 1] - T[i]));
    for (let i = 1; i < n - 1; i++) m[i] = del[i - 1] * del[i] <= 0 ? 0 : (2 * del[i - 1] * del[i]) / (del[i - 1] + del[i]);
    M.push(m);
  }
  return (t) => {
    if (n === 1 || t <= T[0]) return isArr ? V[0].slice() : V[0][0];
    if (t >= T[n - 1]) return isArr ? V[n - 1].slice() : V[n - 1][0];
    let i = 0; while (t > T[i + 1]) i++;
    const h = T[i + 1] - T[i], s = (t - T[i]) / h;
    const h00 = 2 * s ** 3 - 3 * s * s + 1, h10 = s ** 3 - 2 * s * s + s, h01 = -2 * s ** 3 + 3 * s * s, h11 = s ** 3 - s * s;
    const out = V[i].map((a, j) => h00 * a + h10 * h * M[j][i] + h01 * V[i + 1][j] + h11 * h * M[j][i + 1]);
    return isArr ? out : out[0];
  };
}
const ease = (k) => k * k * (3 - 2 * k);

function buildClipPalm(gun, R, bones, nodeRest) {
  const keys = RELOADS[gun].slice().sort((a, b) => a.t - b.t);
  const ch = {};
  const put = (name, t, v) => { (ch[name] || (ch[name] = [])).push([t, v]); };
  for (const k of keys) {
    if (k.root?.p) put('root.p', k.t, k.root.p);
    if (k.root?.r) put('root.r', k.t, k.root.r);
    for (const [b, v] of Object.entries(k.bones || {})) {
      if (v.p) put(`bone:${b}.p`, k.t, v.p);
      if (v.r) put(`bone:${b}.r`, k.t, v.r);
      if (v.s !== undefined) put(`bone:${b}.s`, k.t, v.s);
    }
    for (const [nn, v] of Object.entries(k.nodes || {})) {
      if (v.p) put(`node:${nn}.p`, k.t, v.p);
      if (v.r) put(`node:${nn}.r`, k.t, v.r);
      if (v.s !== undefined) put(`node:${nn}.s`, k.t, v.s);
    }
  }
  for (const name of Object.keys(ch)) {
    let r;
    if (name.startsWith('root')) r = [0, 0, 0];
    else if (name.startsWith('bone:')) r = name.endsWith('.s') ? 1 : [0, 0, 0];
    else { const nn = name.slice(5, -2); r = name.endsWith('.p') ? nodeRest[nn] : name.endsWith('.s') ? 0 : [0, 0, 0]; }
    const list = ch[name];
    if (!list.some((x) => x[0] === 0)) list.unshift([0, r]);
    if (!list.some((x) => x[0] === 1)) list.push([1, r]);
    list.sort((a, b) => a[0] - b[0]);
  }
  const S = {};
  for (const [name, list] of Object.entries(ch)) S[name] = name.endsWith('.s') ? null : smoothSampler(list);
  const N = 120;
  const TS = Array.from({ length: N + 1 }, (_, i) => i / N);

  // 某部件在 t 时刻：位置 + 旋转（枪的空间）
  const partAt = (name, t) => {
    if (bones[name]) {
      const base = bones[name].getWorldPosition(new THREE.Vector3());
      const off = S[`bone:${name}.p`]?.(t) || [0, 0, 0];
      const r = S[`bone:${name}.r`]?.(t) || [0, 0, 0];
      return { p: base.add(new THREE.Vector3().fromArray(off)), q: qFromDeg(r) };
    }
    const p = S[`node:${name}.p`]?.(t) || nodeRest[name] || [0, 0, 0];
    const r = S[`node:${name}.r`]?.(t) || [0, 0, 0];
    return { p: new THREE.Vector3().fromArray(p), q: qFromDeg(r) };
  };
  const restP = PALM_REST[gun];
  // 手的关键帧：目标（随部件动）+ 手型
  const hk = [{ t: 0, hand: 'rest', pose: 'rest' }];
  for (const k of keys) {
    if (!k.hand) continue;
    let pose = k.pose;
    if (!pose) pose = k.hand === 'rest' ? 'rest' : (k.hand.at && AUTO_POSE[k.hand.at]) || 'open';
    hk.push({ t: k.t, hand: k.hand, pose });
  }
  if (!hk.some((x) => x.t === 1)) hk.push({ t: 1, hand: 'rest', pose: 'rest' });
  const evalKey = (k, t) => {
    const P = POSES[k.pose];
    let q = poseQuat(P);
    let p;
    if (k.hand === 'rest') p = new THREE.Vector3().fromArray(restP);
    else if (Array.isArray(k.hand)) p = new THREE.Vector3().fromArray(k.hand);
    else {
      const part = partAt(k.hand.at, t);
      p = part.p.add(new THREE.Vector3().fromArray(k.hand.off || [0, 0, 0]).applyQuaternion(part.q));
      q = part.q.clone().multiply(q);
    }
    return { p, q, c: P.c };
  };
  const hp = [], hq = [], hs = [];
  for (const t of TS) {
    let i = 0; while (i < hk.length - 2 && t > hk[i + 1].t) i++;
    const a = hk[i], b = hk[i + 1];
    const w = ease(THREE.MathUtils.clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1));
    const A = evalKey(a, t), B = evalKey(b, t);
    hp.push(...A.p.lerp(B.p, w).toArray());
    hq.push(...A.q.slerp(B.q, w).toArray());
    hs.push(...A.c.map((v, j) => 1 + v + (B.c[j] - v) * w));
  }
  const tracks = [
    new THREE.VectorKeyframeTrack('IK_LeftHand.position', TS, hp),
    new THREE.QuaternionKeyframeTrack('IK_LeftHand.quaternion', TS, hq),
    new THREE.VectorKeyframeTrack('IK_LeftHand.scale', TS, hs),
  ];
  for (const [name, list] of Object.entries(ch)) {
    const isS = name.endsWith('.s');
    const T = isS ? list.map((x) => x[0]) : TS;
    const vals = isS ? list.map((x) => x[1]) : TS.map((t) => S[name](t));
    if (name === 'root.p') tracks.push(new THREE.VectorKeyframeTrack('ReloadRoot.position', T, vals.flat()));
    else if (name === 'root.r') tracks.push(new THREE.QuaternionKeyframeTrack('ReloadRoot.quaternion', T, vals.flatMap((v) => qFromDeg(v).toArray())));
    else if (name.startsWith('bone:')) {
      const [bn, prop] = name.slice(5).split('.');
      const b = bones[bn];
      if (!b) { console.warn('没有这个骨骼', gun, bn); continue; }
      const QpInv = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const Qb = b.getWorldQuaternion(new THREE.Quaternion());
      const p0 = b.userData.restPos, s0 = b.userData.restScale;
      if (prop === 'p') tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, T, vals.flatMap((v) => p0.clone().add(new THREE.Vector3().fromArray(v).applyQuaternion(QpInv)).toArray())));
      if (prop === 'r') tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, T, vals.flatMap((v) => QpInv.clone().multiply(qFromDeg(v)).multiply(Qb).toArray())));
      if (prop === 's') tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.scale`, T, vals.flatMap((v) => s0.clone().multiplyScalar(Math.max(v, 0.0001)).toArray()), THREE.InterpolateDiscrete));
    } else {
      const [nn, prop] = name.slice(5).split('.');
      if (prop === 'p') tracks.push(new THREE.VectorKeyframeTrack(`${nn}.position`, T, vals.flat()));
      if (prop === 'r') tracks.push(new THREE.QuaternionKeyframeTrack(`${nn}.quaternion`, T, vals.flatMap((v) => qFromDeg(v).toArray())));
      if (prop === 's') tracks.push(new THREE.VectorKeyframeTrack(`${nn}.scale`, T, vals.flatMap((v) => [v, v, v].map((x) => Math.max(x, 0.0001))), THREE.InterpolateDiscrete));
    }
  }
  return new THREE.AnimationClip('Reload_' + gun, 1, tracks);
}

window.__buildRig = async (gun) => {
  const R = RIGS[gun];
  const base = `../_guns/${gun}/Meshes/`;
  const frame = await loader.loadAsync(base + R.frame + '.fbx');
  frame.name = 'Frame';
  frame.updateMatrixWorld(true);
  const bones = {};
  frame.traverse((o) => {
    if (o.isBone) { bones[o.name] = o; o.userData.restPos = o.position.clone(); o.userData.restQuat = o.quaternion.clone(); o.userData.restScale = o.scale.clone(); }
  });
  const fm = [];
  frame.traverse((o) => { if (o.isMesh) fm.push(o); });
  for (const o of fm) {
    for (const k of Object.keys(o.geometry.attributes)) if (!KEEP.includes(k)) o.geometry.deleteAttribute(k);
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const mats = await Promise.all(src.map(material));
    o.material = mats.length === 1 ? mats[0] : mats;
    o.frustumCulled = false;
  }
  for (const [file, socket, off] of R.parts) {
    const p = await loader.loadAsync(base + file + '.fbx');
    const g = await partGroup(p, 'Part_' + file.split('_').slice(2).join('_'));
    if (!bones[socket]) console.warn('没有插槽', gun, socket);
    attach(g, bones[socket], off);
  }
  // 静止时的包围盒和枪口
  frame.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(frame);
  const boreY = (bones.Barrel || bones.Muzzle_Attachment || bones.Handguard || bones.Bolt || new THREE.Object3D()).getWorldPosition(new THREE.Vector3()).y;
  const muzzle = [0, boreY, box.max.z];

  const reloadRoot = new THREE.Group();
  reloadRoot.name = 'ReloadRoot';
  reloadRoot.add(frame);
  const nodeRest = {};
  for (const [name, file, p] of R.nodes || []) {
    const pr = await loader.loadAsync(base + file + '.fbx');
    const g = await partGroup(pr, name);
    g.position.fromArray(p);
    g.scale.setScalar(0.0001);
    reloadRoot.add(g);
    nodeRest[name] = p;
  }
  const ikL = new THREE.Object3D(); ikL.name = 'IK_LeftHand'; ikL.position.fromArray(R.support); reloadRoot.add(ikL);
  const ikR = new THREE.Object3D(); ikR.name = 'IK_RightHand'; ikR.position.fromArray(R.rightWrist || [-0.5, -3, -6.5]); reloadRoot.add(ikR);

  const palm = !!PALM_REST[gun];
  if (palm) {
    ikL.position.fromArray(PALM_REST[gun]);
    ikL.quaternion.copy(poseQuat(POSES.rest));
    ikL.scale.set(2, 1, 1);
  }
  const clip = palm ? buildClipPalm(gun, R, bones, nodeRest) : buildClip(gun, R, bones, nodeRest);

  const root = new THREE.Group();
  root.name = gun;
  root.scale.setScalar(0.01);
  root.add(reloadRoot);
  root.userData = { muzzle: muzzle.map((v) => +(v * 0.01).toFixed(4)), length: +((box.max.z - box.min.z) * 0.01).toFixed(3), source: 'Infima Games', reload: `Asset/Animation/Reload/${gun}.json`, palmIK: palm };
  root.updateMatrixWorld(true);
  window.__lastGun = root;
  window.__lastClip = clip;
  return { gun, tracks: clip.tracks.map((t) => t.name), muzzle };
};

window.__clipJSON = () => JSON.stringify(THREE.AnimationClip.toJSON(window.__lastClip));

// 换弹过程逐帧预览：红点 = 左手目标，蓝点 = 右手目标
window.__reloadStrip = async (ts) => {
  const W = 300, H = 220;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(W * ts.length, H); r.outputColorSpace = THREE.SRGBColorSpace; r.setScissorTest(true);
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0xeef3fa);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.4));
  const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(3, 3, 1); sc.add(dl);
  const g = window.__lastGun; sc.add(g);
  const mixer = new THREE.AnimationMixer(g);
  const action = mixer.clipAction(window.__lastClip); action.play();
  const dotL = new THREE.Mesh(new THREE.SphereGeometry(0.018), new THREE.MeshBasicMaterial({ color: 0xff2244, depthTest: false })); dotL.renderOrder = 9; sc.add(dotL);
  const dotR = new THREE.Mesh(new THREE.SphereGeometry(0.018), new THREE.MeshBasicMaterial({ color: 0x2266ff, depthTest: false })); dotR.renderOrder = 9; sc.add(dotR);
  g.updateMatrixWorld(true);
  const b0 = new THREE.Box3().setFromObject(g.getObjectByName('Frame')); const c = b0.getCenter(new THREE.Vector3()); const L = b0.getSize(new THREE.Vector3()).length();
  const cam = new THREE.PerspectiveCamera(35, W / H, 0.01, 50);
  cam.position.set(c.x + L * 1.1, c.y - L * 0.15, c.z - L * 0.35); cam.lookAt(c.x, c.y - L * 0.12, c.z);
  ts.forEach((t, i) => {
    action.time = t; mixer.update(0); g.updateMatrixWorld(true);
    g.getObjectByName('IK_LeftHand').getWorldPosition(dotL.position);
    g.getObjectByName('IK_RightHand').getWorldPosition(dotR.position);
    r.setViewport(i * W, 0, W, H); r.setScissor(i * W, 0, W, H); r.render(sc, cam);
  });
  action.stop(); sc.remove(g);
  return r.domElement.toDataURL('image/png').split(',')[1];
};
