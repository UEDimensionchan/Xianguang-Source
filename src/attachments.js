import * as THREE from 'three';
// 武器配件：只用每把枪自己带的配件模型（「弦光项目材质」PL_<枪>.blend 导出的 Asset/Weapon/Attachments/<枪>.glb，
// 生成脚本：Asset/Weapon/Attachments/export_attachments.py）。没有对应模型的槽位显示「未有」。
// · 模型在枪的空间里（厘米，原点 = 握把），自带 SOCKET_ 挂点：护木/枪管换长短后，枪口、镭射、握把跟着挪到对应挂点
// · 数值：applyAttachments(def, sel) 返回改过数值的武器定义（AI 用原版）
// · 选择按枪保存在本地

export const SLOTS = [
  { id: 'optic', name: '瞄具', en: 'OPTIC' },
  { id: 'muzzle', name: '枪口', en: 'MUZZLE' },
  { id: 'barrel', name: '枪管', en: 'BARREL' },
  { id: 'under', name: '下挂', en: 'UNDERBARREL' },
  { id: 'laser', name: '战术', en: 'TACTICAL' },
  { id: 'mag', name: '弹匣', en: 'MAGAZINE' },
];

// node = 配件库里的网格名（{G} 换成枪的模型名）
export const ATTACHMENTS = {
  scope: { slot: 'optic', node: 'SM_Scope', name: '棱镜瞄准镜', desc: '中倍率瞄准镜，开镜看得更远，开镜略慢', mods: { zoomSet: 2.2, adsSpeed: 0.8, spread: 0.9 } },
  scope_s: { slot: 'optic', node: 'SM_Scope_Small', name: '微型反射镜', desc: '小型反射式瞄具，开镜更快', mods: { zoomAdd: 0.15, adsSpeed: 1.12 } },
  scope_nw: { slot: 'optic', node: 'SM_RocketLauncher_Scope_NoWire', replace: 'Part_Scope', name: '无准线瞄具', desc: '去掉准线的瞄具外壳，视野更干净（外观）', mods: {} },
  silencer: { slot: 'muzzle', node: 'SM_Silencer', socket: 'Muzzle', name: '消音器', desc: '枪声和火光大幅减弱，后坐略降，伤害略降', mods: { vol: 0.6, pitch: 0.88, suppress: true, flash: 0.15, recoil: 0.92, damage: 0.94 } },
  muzzle_sq: { slot: 'muzzle', node: 'SM_RocketLauncher_Muzzle_Square', replace: 'Part_Muzzle_Round', name: '方形炮口', desc: '方形防护炮口（外观）', mods: {} },
  hg_ext: { slot: 'barrel', variant: 'Extended', parts: ['Handguard'], name: '延长护木', desc: '更长的护木和枪管，射程、稳定提升，开镜变慢', mods: { spread: 0.85, recoil: 0.92, adsSpeed: 0.88 } },
  hg_short: { slot: 'barrel', variant: 'Short', parts: ['Handguard'], name: '短护木', desc: '短小精悍，开镜更快，散布变大', mods: { spread: 1.15, recoil: 1.05, adsSpeed: 1.2 } },
  bl_ext: { slot: 'barrel', variant: 'Extended', parts: ['Barrel'], name: '加长枪管', desc: '射程、稳定提升，开镜变慢', mods: { spread: 0.85, recoil: 0.92, adsSpeed: 0.88 } },
  bl_short: { slot: 'barrel', variant: 'Short', parts: ['Barrel'], name: '短枪管', desc: '开镜更快，散布变大', mods: { spread: 1.15, recoil: 1.05, adsSpeed: 1.2 } },
  sl_ext: { slot: 'barrel', variant: 'Extended', parts: ['Slide', 'Barrel'], name: '加长套筒', desc: '加长枪管与套筒，射程、稳定提升', mods: { spread: 0.85, recoil: 0.92, adsSpeed: 0.9 } },
  sl_short: { slot: 'barrel', variant: 'Short', parts: ['Slide', 'Barrel'], name: '短套筒', desc: '更轻更快，散布变大', mods: { spread: 1.15, recoil: 1.05, adsSpeed: 1.2 } },
  grip_v: { slot: 'under', node: 'SM_Grip_Vertical', socket: 'Grip', name: '垂直握把', desc: '降低后坐，开镜略慢', mods: { recoil: 0.8, adsSpeed: 0.92 } },
  grip_a: { slot: 'under', node: 'SM_Grip_Angled', socket: 'Grip', name: '斜角握把', desc: '开镜更快，后坐略降', mods: { adsSpeed: 1.25, recoil: 0.93 } },
  grip_as: { slot: 'under', node: 'SM_Grip_Angled_Short', socket: 'Grip', name: '短斜角握把', desc: '开镜更快，后坐略降', mods: { adsSpeed: 1.25, recoil: 0.93 } },
  bipod: { slot: 'under', node: 'SM_Sniper_Bipod_Closed', socket: 'Bipod', name: '两脚架', desc: '大幅降低后坐，开镜变慢', mods: { recoil: 0.7, adsSpeed: 0.85 } },
  laser: { slot: 'laser', node: 'SM_Laser', socket: 'Laser', name: '镭射指示器', desc: '腰射散布大幅降低，会露出光束', mods: { hip: 0.68 } },
  mag_clear: { slot: 'mag', node: 'SM_{G}_Magazine_Transparent', replace: 'Part_Magazine', name: '透明弹匣', desc: '透明外壳，余弹一目了然（外观）', mods: {} },
};

// 每把枪真正有模型、能装上去的配件（枪身是合并网格的部件没法替换，就不提供）
export const GUN_ATT = {
  ar: ['scope', 'silencer', 'hg_ext', 'hg_short', 'grip_v', 'grip_a', 'laser', 'mag_clear'],
  smg: ['scope', 'silencer', 'hg_ext', 'grip_v', 'grip_a', 'laser', 'mag_clear'],
  lmg: ['scope', 'silencer', 'hg_ext', 'hg_short', 'grip_v', 'grip_a', 'laser'],
  sniper: ['silencer', 'bl_ext', 'bl_short', 'grip_v', 'grip_a', 'bipod', 'laser', 'mag_clear'],
  shotgun: ['scope', 'silencer', 'grip_v', 'grip_a', 'laser'],
  pistol: ['scope_s', 'silencer', 'sl_ext', 'sl_short', 'grip_v', 'grip_as', 'laser'],
  revolver: ['scope_s', 'silencer', 'grip_v', 'grip_as', 'laser'],
  rocket: [], // 火箭筒暂不开放配件
};
export function optionsFor(id, slot) { return (GUN_ATT[id] || []).filter((k) => ATTACHMENTS[k].slot === slot); }

const KEY = 'prismlink.attach2';
export function loadSel() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
export function saveSel(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* 无痕模式等 */ } }
export function selFor(all, id) {
  const s = { ...(all[id] || {}) };
  for (const k of Object.keys(s)) if (!optionsFor(id, k).includes(s[k])) delete s[k];
  return s;
}

// —— 数值 ——
export function applyAttachments(def, sel = {}) {
  const d = { ...def, ads: { ...(def.ads || {}) }, sound: { ...def.sound }, attach: { ...sel } };
  d.ads.speed ??= 12; d.ads.hip ??= 1.6; d.ads.zoom ??= 1.3;
  d.flash = def.flash ?? 1; d.sound.rate = 1;
  for (const id of Object.values(sel)) {
    const m = ATTACHMENTS[id]?.mods;
    if (!m) continue;
    if (m.recoil) d.recoil *= m.recoil;
    if (m.spread) d.spread *= m.spread;
    if (m.damage) d.damage = Math.round(d.damage * m.damage * 10) / 10;
    if (m.hip) d.ads.hip *= m.hip;
    if (m.adsSpeed) d.ads.speed *= m.adsSpeed;
    if (m.zoomAdd && !d.ads.scope) d.ads.zoom += m.zoomAdd;
    if (m.zoomSet && !d.ads.scope) d.ads.zoom = m.zoomSet;
    if (m.mag) d.mag = Math.round(def.mag * m.mag);
    if (m.reload) d.reload *= m.reload;
    if (m.vol) d.sound.vol *= m.vol;
    if (m.pitch) d.sound.rate *= m.pitch;
    if (m.suppress) d.sound.suppressed = true;
    if (m.flash != null) d.flash *= m.flash;
  }
  return d;
}

// —— 配件库（每把枪一个 glb）——
const libs = new Map();
const gunName = (def) => def.file.split('/').pop().replace(/\.glb(\.wasm)?$/, '');
function libUrl(def) { return def.file.replace('/Guns/', '/Attachments/'); }
export function loadLib(loader, def, gradient) {
  if (!libs.has(def.id)) {
    libs.set(def.id, loader.loadAsync(libUrl(def)).then((gltf) => {
      const root = gltf.scene; root.updateMatrixWorld(true);
      const byName = new Map();
      root.traverse((o) => {
        if (o.name && !byName.has(o.name)) byName.set(o.name, o);
        if (!o.isMesh) return;
        // 和枪一样换成卡通材质；玻璃（瞄具镜片、透明弹匣）保持半透明
        const conv = (m) => {
          // 瞄具镜片：原素材是橙色渐变层 + 准线层，这里换成淡蓝镀膜玻璃，准线另画一个红点
          if (/Scope_Sight/.test(m.name)) { o.visible = false; return m; }
          if (/Scope_Fade/.test(m.name)) o.userData.lensGlass = true;
          if (/Scope_Fade/.test(m.name)) return new THREE.MeshBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, fog: false });
          if (m.transparent || m.opacity < 1 || m.alphaTest > 0 || /Glass/.test(m.name)) {
            return new THREE.MeshBasicMaterial({ color: m.color, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
          }
          const t = new THREE.MeshToonMaterial({ name: m.name, color: m.color.clone().multiplyScalar(m.map ? 0.92 : 1.25), map: m.map, gradientMap: gradient || null });
          if (m.emissiveMap) { t.emissiveMap = m.emissiveMap; t.emissive = new THREE.Color(1, 1, 1); t.emissiveIntensity = m.emissiveIntensity ?? 1; }
          return t;
        };
        o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
        o.castShadow = true;
      });
      return { root, byName, G: gunName(def) };
    }));
  }
  return libs.get(def.id);
}

// —— 矩阵工具 ——
const CM = new THREE.Matrix4().makeScale(0.01, 0.01, 0.01);
const gunM = (o) => o.matrixWorld.clone(); // 配件库里的节点：枪的空间（厘米）
function relMatrix(o, holder) { // holder 里的节点 → holder 空间（米）
  const m = new THREE.Matrix4();
  for (let n = o; n && n !== holder; n = n.parent) { n.updateMatrix(); m.premultiply(n.matrix); }
  return m;
}
// 把 obj 放到 holder 空间里的矩阵 M（米），挂在 parent 下
function placeUnder(holder, parent, obj, M) {
  const local = relMatrix(parent, holder).invert().multiply(M);
  local.decompose(obj.position, obj.quaternion, obj.scale);
  parent.add(obj);
}

export function clearAttachments(holder) {
  const rm = [];
  holder.traverse((o) => { if (o.userData.isAttachment) rm.push(o); });
  for (const o of rm) o.parent?.remove(o);
  holder.traverse((o) => {
    if (o.userData.hiddenByAtt) { o.visible = true; delete o.userData.hiddenByAtt; }
    if (o.isMesh && clipped.has(o.geometry)) o.geometry = clipped.get(o.geometry);
    if (o.userData.attOrig) { new THREE.Matrix4().fromArray(o.userData.attOrig).decompose(o.position, o.quaternion, o.scale); delete o.userData.attOrig; }
  });
  if (holder.userData.muzzleBase) holder.userData.muzzle.copy(holder.userData.muzzleBase);
}
function hide(holder, name) {
  const o = holder.getObjectByName(name);
  if (o && o.visible) { o.visible = false; o.userData.hiddenByAtt = true; }
  return o;
}

// 当前护木/枪管长短下，某类挂点（Muzzle/Laser/Grip/Bipod/Sight_Front）在枪空间里的节点
function socketNode(lib, type, variant) {
  return lib.byName.get(`SOCKET_${type}_${variant}`) || lib.byName.get(`SOCKET_${type}_Default`) || lib.byName.get(`SOCKET_${type}`);
}
// 配件在库里装在哪个挂点（同类挂点里离它最近的一个）
function refSocketM(lib, type, M) {
  const p = new THREE.Vector3().setFromMatrixPosition(M);
  let best = null, bd = Infinity;
  lib.root.traverse((o) => {
    if (!o.name.startsWith(`SOCKET_${type}`)) return;
    const d = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).distanceTo(p);
    if (d < bd) { bd = d; best = o; }
  });
  return best ? gunM(best) : null;
}
// 挂点所在部件对应的骨骼
const BONE_OF = [['Handguard', 'Handguard'], ['Barrel', 'Barrel'], ['Slide', 'Slide'], ['Forend', 'Forend'], ['Rail', 'Rail']];
function partBone(partName, holder) {
  for (const [k, b] of BONE_OF) if (partName.includes(k)) return holder.getObjectByName(b) || holder;
  return holder;
}

// opts：loader、gradient、beam（是否画镭射光束，大厅展示时不画）
export async function mountAttachments(holder, def, sel = {}, { loader, gradient, beam = true } = {}) {
  clearAttachments(holder);
  if (!Object.keys(sel).length || !loader) return;
  let lib;
  try { lib = await loadLib(loader, def, gradient); } catch (e) { console.warn('配件模型加载失败', def.id, e); return; }
  clearAttachments(holder); // 加载期间可能又装过一次
  if (!holder.userData.muzzleBase && holder.userData.muzzle) holder.userData.muzzleBase = holder.userData.muzzle.clone();
  const G = lib.G;
  const add = (name, parent, M) => {
    const src = lib.byName.get(name);
    if (!src) return null;
    const obj = src.clone(true);
    obj.userData.isAttachment = true;
    placeUnder(holder, parent, obj, CM.clone().multiply(M || gunM(src)));
    return obj;
  };
  const rail = () => {
    let r = holder.getObjectByName('Attachment_Rail');
    if (!r && lib.byName.has(`SM_${G}_Rail`)) { r = add(`SM_${G}_Rail`, holder.getObjectByName('Rail') || holder); if (r) r.name = 'Attachment_Rail'; }
    return r;
  };
  const bar = sel.barrel ? ATTACHMENTS[sel.barrel] : null;
  const variant = bar?.variant || 'Default';

  // 1) 护木 / 枪管 / 套筒换长短：藏起原来的部件，换上同位置的新部件
  if (bar) {
    for (const part of bar.parts) {
      const old = hide(holder, `Part_${part}_Default`);
      const np = add(`SM_${G}_${part}_${variant}`, old?.parent || holder.getObjectByName(part) || holder);
      if (np) np.userData.attSlot = 'barrel';
    }
    // 套筒变长：前准星挪到新挂点
    const fs = holder.getObjectByName('Part_Sight_Front'), a = socketNode(lib, 'Sight_Front', variant), b = socketNode(lib, 'Sight_Front', 'Default');
    if (fs && a && b && a !== b) {
      fs.userData.attOrig = fs.matrix.toArray();
      const M = CM.clone().multiply(gunM(a)).multiply(gunM(b).invert()).multiply(CM.clone().invert()).multiply(relMatrix(fs, holder));
      placeUnder(holder, fs.parent, fs, M);
    }
    // 枪口位置跟着枪管长短走
    const ma = socketNode(lib, 'Muzzle', variant), mb = socketNode(lib, 'Muzzle', 'Default');
    if (ma && mb && ma !== mb) holder.userData.muzzle.add(new THREE.Vector3().setFromMatrixPosition(ma.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(mb.matrixWorld)).multiplyScalar(0.01));
  }

  for (const [slot, id] of Object.entries(sel)) {
    const A = ATTACHMENTS[id];
    if (!A || slot === 'barrel') continue;
    const name = A.node?.replace('{G}', G);
    if (!name || !lib.byName.has(name)) continue;
    if (A.replace) { // 整件替换（透明弹匣、火箭筒瞄具 / 炮口）
      const old = hide(holder, A.replace);
      const ro = add(name, old?.parent || holder);
      if (ro) ro.userData.attSlot = slot;
      continue;
    }
    if (A.socket) { // 挂在挂点上：从它在库里装的挂点挪到当前长短对应的挂点
      const M0 = gunM(lib.byName.get(name)), ref = refSocketM(lib, A.socket, M0), tgtN = socketNode(lib, A.socket, variant);
      const M = ref && tgtN ? gunM(tgtN).multiply(ref.clone().invert()).multiply(M0) : M0;
      let parent = partBone(tgtN?.parent?.name || '', holder);
      if (tgtN?.parent?.name?.includes('Rail')) parent = rail() || parent; // 手枪 / 左轮：镭射、握把装在导轨上
      const obj = add(name, parent, M);
      if (!obj) continue;
      obj.userData.attSlot = slot;
      if (id === 'silencer') { // 枪口火光从消音器前端出来
        const em = obj.getObjectByName('SOCKET_Emitter');
        if (em) holder.userData.muzzle.setFromMatrixPosition(relMatrix(em, holder));
        else holder.userData.muzzle.z += 0.17;
      }
      if (id === 'laser' && beam) addBeam(obj);
      continue;
    }
    if (slot === 'optic') { // 步枪装在 Scope 骨骼的导轨上；手枪 / 左轮先装导轨
      let parent = holder.getObjectByName('Scope') || holder;
      const r = rail(); if (r) parent = r;
      const obj = add(name, parent);
      if (!obj) continue;
      obj.userData.attSlot = slot;
      // 开镜对准镜片中心：取镜片（玻璃层）的中心；没有玻璃层再用 SOCKET_Center
      let c = null;
      const glass = []; obj.traverse((o) => { if (o.isMesh && o.userData.lensGlass) glass.push(o); });
      if (glass.length) {
        obj.updateMatrixWorld(true);
        const inv = obj.matrixWorld.clone().invert(), bb = new THREE.Box3();
        for (const gm of glass) { gm.geometry.computeBoundingBox(); bb.union(gm.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(gm.matrixWorld))); }
        c = new THREE.Object3D(); bb.getCenter(c.position); obj.add(c);
      }
      if (!c) c = obj.getObjectByName('SOCKET_Center');
      if (!c) {
        const bb = new THREE.Box3(); obj.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox); } });
        c = new THREE.Object3D(); c.position.set((bb.min.x + bb.max.x) / 2, bb.min.y + (bb.max.y - bb.min.y) * 0.62, (bb.min.z + bb.max.z) / 2); obj.add(c);
      }
      c.userData.sightLens = true;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), dotMat); // 红点准线（厘米）
      dot.renderOrder = 3; dot.visible = false; dot.userData.reticle = true; // 只在第一人称瞄准时亮
      c.add(dot);
      // 折起机械瞄具（有折叠版模型就换上，没有就藏起来）
      for (const s of ['Part_Sight_Rear', 'Part_Sight_Front']) {
        const o = holder.getObjectByName(s);
        if (!o || !o.visible) continue;
        hide(holder, s);
        const f = `SM_${G}_${s.slice(5)}_Folded`;
        if (lib.byName.has(f)) add(f, o.parent);
      }
      // 霰弹枪的机瞄是合并蒙皮网格的一部分：把立起来的照门、准星三角面剪掉，换上折叠版
      if (!holder.getObjectByName('Part_Sight_Rear')) {
        const boxes = [];
        for (const k of ['Rear', 'Front']) {
          const f = lib.byName.get(`SM_${G}_Sight_${k}_Folded`);
          if (!f) continue;
          const bb = new THREE.Box3().setFromObject(f); // 枪空间（厘米）
          boxes.push(new THREE.Box3(new THREE.Vector3(bb.min.x - 0.3, bb.max.y - 0.7, bb.min.z - 0.8), new THREE.Vector3(bb.max.x + 0.3, 99, bb.max.z + 0.8)));
          add(f.name, holder.getObjectByName('Grip') || holder);
        }
        if (boxes.length) clipSights(holder, boxes);
      }
    }
  }
}

// 剪掉合并网格里落在 boxes（枪空间，厘米）里的三角面；原几何体记下来，卸配件时换回
const clipped = new Map(); // 剪过的几何体 → 原几何体
function clipSights(holder, boxes) {
  holder.traverse((o) => {
    if (!o.isSkinnedMesh || clipped.has(o.geometry)) return;
    let p = o; while (p && !p.userData.isAttachment) p = p.parent;
    if (p) return;
    const g = o.geometry, pos = g.attributes.position, M = CM.clone().invert().multiply(relMatrix(o, holder)), v = new THREE.Vector3();
    const hit = new Uint8Array(pos.count);
    let any = false;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M); if (boxes.some((b) => b.containsPoint(v))) { hit[i] = 1; any = true; } }
    if (!any) return;
    const idx = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i), keep = [];
    const ok = (t) => !hit[idx[t]] && !hit[idx[t + 1]] && !hit[idx[t + 2]];
    for (let t = 0; t < idx.length; t += 3) if (ok(t)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    const ng = g.clone(); ng.setIndex(keep);
    if (g.groups.length) { // 多材质分组按新的索引重新算
      ng.clearGroups();
      let start = 0;
      for (const gr of g.groups) { let n = 0; for (let t = gr.start; t < gr.start + gr.count; t += 3) if (ok(t)) n += 3; ng.addGroup(start, n, gr.materialIndex); start += n; }
    }
    clipped.set(ng, g);
    o.geometry = ng;
  });
}

const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3048, side: THREE.DoubleSide, fog: false });
const beamMat = new THREE.MeshBasicMaterial({ color: 0x4dffe0, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
function addBeam(laser) {
  const bb = new THREE.Box3();
  laser.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox); } });
  // 激光沿模型前方（+Z）射出，单位厘米
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2500, 6, 1, true), beamMat);
  b.rotation.x = Math.PI / 2; b.position.set((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.max.z + 1250);
  b.userData.beam = true; b.renderOrder = 2; b.frustumCulled = false;
  laser.add(b);
}
