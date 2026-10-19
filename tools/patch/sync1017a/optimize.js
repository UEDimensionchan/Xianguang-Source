import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// 地图性能优化（主要给雨夜街区这种东西多的图）：
// 1) 静态物体按「材质 + 阴影设置 + 所在区块」合并成大网格：几百个方块变成几十次绘制，
//    主画面、阴影、积水倒影、描线四遍渲染都跟着省；区块（默认 24 米见方）仍然能被视锥剔除
// 2) 雾外面完全看不见的区块直接隐藏
// 3) 路灯点光源池：场景里同时只保留离镜头最近的几盏真实光源，其余只留灯罩和光锥
// 4) 阴影隔帧更新

const _box = new THREE.Box3(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();

// 跑两次动画，看哪些物体会动：会动的不能合并
function movingSet(root, anims) {
  const set = new Set();
  if (!anims?.length) return set;
  const before = new Map();
  root.updateMatrixWorld(true);
  root.traverse((o) => before.set(o, o.matrixWorld.clone()));
  for (const t of [1.37, 7.91, 23.3]) { for (const f of anims) { try { f(t); } catch { /* 忽略 */ } } root.updateMatrixWorld(true); root.traverse((o) => { if (!before.get(o)?.equals(o.matrixWorld)) set.add(o); }); }
  for (const f of anims) { try { f(0); } catch { /* 忽略 */ } }
  root.updateMatrixWorld(true);
  // 会动的物体，子物体也算会动
  const out = new Set();
  for (const o of set) o.traverse((c) => out.add(c));
  return out;
}

function attrSig(g) {
  return Object.keys(g.attributes).sort().map((k) => `${k}${g.attributes[k].itemSize}${g.attributes[k].normalized ? 'n' : ''}`).join(',') + (g.index ? '|i' : '|n') + (g.morphAttributes && Object.keys(g.morphAttributes).length ? '|m' : '');
}

export function mergeStatic(group, { anims = [], cell = 24 } = {}) {
  const moving = movingSet(group, anims);
  group.updateMatrixWorld(true);
  const buckets = new Map();
  const victims = [], victimSet = new Set();
  group.traverse((o) => {
    if (!(o.isMesh || o.isLineSegments) || o.isSkinnedMesh || o.isInstancedMesh || o.isPoints) return;
    if (moving.has(o) || o.userData.noMerge || o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
    if (Array.isArray(o.material) || !o.geometry?.attributes?.position || o.morphTargetInfluences) return;
    if (o.material.isShaderMaterial && !o.material.isMeshToonMaterial) return;
    for (let p = o; p && p !== group; p = p.parent) if (!p.visible) return;
    o.geometry.computeBoundingBox();
    _box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    const size = _box.getSize(_v);
    if (size.x > cell * 2.5 || size.z > cell * 2.5) return; // 很大的东西（地面、天空、远景）不合并，免得一整块永远剔除不掉
    _box.getCenter(_v);
    const cx = Math.floor(_v.x / cell), cz = Math.floor(_v.z / cell);
    const u = o.userData;
    const key = [o.isLineSegments ? 'L' : 'M', o.material.uuid, o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, o.layers.mask, o.renderOrder, u.noInk ? 1 : 0, u.noMinimap ? 1 : 0, cx, cz, attrSig(o.geometry)].join('/');
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { list: [], proto: o }));
    b.list.push(o);
  });
  let before = 0, after = 0;
  for (const { list, proto } of buckets.values()) {
    before += list.length;
    if (list.length < 2) { after += list.length; continue; }
    const geos = list.map((o) => {
      const g = o.geometry.clone();
      g.applyMatrix4(_m.copy(o.matrixWorld));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'uv1', 'uv2', 'tangent'].includes(k)) g.deleteAttribute(k);
      g.morphAttributes = {};
      return g;
    });
    let merged = null;
    try { merged = mergeGeometries(geos, false); } catch { merged = null; }
    geos.forEach((g) => g.dispose());
    if (!merged) { after += list.length; continue; }
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    const m = proto.isLineSegments ? new THREE.LineSegments(merged, proto.material) : new THREE.Mesh(merged, proto.material);
    m.castShadow = proto.castShadow; m.receiveShadow = proto.receiveShadow;
    m.layers.mask = proto.layers.mask; m.renderOrder = proto.renderOrder;
    m.userData = { ...proto.userData, merged: list.length };
    m.name = 'merged';
    group.add(m); // 已经是世界坐标；group 本身没有变换
    m.updateMatrixWorld(true);
    for (const o of list) { victims.push(o); victimSet.add(o); }
    after++;
  }
  // 把被合并的原物体从场景里拿掉（只拿掉网格本身；它的子物体如果也被合并了一并移除）
  for (const o of victims) {
    // 还有没被合并的子物体：原物体留着当空节点（换成空几何，不再绘制）；否则直接拿掉
    if (o.children.some((c) => !victimSet.has(c))) { o.geometry = new THREE.BufferGeometry(); o.castShadow = false; }
    else o.parent?.remove(o);
  }
  return { before, after };
}

// 雾外看不见的东西：隐藏（每隔几帧算一次）
export class DistanceCull {
  constructor(groups) {
    this.items = [];
    for (const g of groups) g.traverse((o) => {
      if (!(o.isMesh || o.isLineSegments) || o.isSkinnedMesh) return;
      if (!o.geometry?.boundingSphere) o.geometry?.computeBoundingSphere?.();
      const s = o.geometry?.boundingSphere;
      if (!s || s.radius > 60) return;
      const c = s.center.clone().applyMatrix4(o.matrixWorld);
      this.items.push({ o, c, r: s.radius * o.matrixWorld.getMaxScaleOnAxis() });
    });
    this.t = 0;
  }
  // 全部显示（画小地图这种俯视全图之前用），下一帧再重新按距离隐藏
  reveal() { for (const it of this.items) it.o.visible = true; this.t = 0; }
  update(camera, far, dt) {
    if ((this.t -= dt) > 0) return;
    this.t = 0.25;
    const p = camera.position;
    for (const it of this.items) {
      const d = it.c.distanceTo(p) - it.r;
      const vis = d < far;
      if (it.o.visible !== vis) it.o.visible = vis;
    }
  }
}

// 点光源池：真正的 PointLight 只保留 n 盏，每隔一会儿分给离镜头最近的灯位
// lamps：[{ light, base }]（会被替换成池里的光源，返回新的 lamps 数组给 env.js 调亮度）
export class LightPool {
  constructor(scene, lamps, n = 6) {
    this.anchors = lamps.map(({ light, base }) => {
      light.parent?.remove(light);
      return { pos: light.getWorldPosition(new THREE.Vector3()), color: light.color.clone(), distance: light.distance, decay: light.decay, base };
    });
    this.lights = [];
    this.lamps = [];
    const proto = lamps[0]?.light;
    for (let i = 0; i < Math.min(n, this.anchors.length); i++) {
      const l = new THREE.PointLight(0xffffff, 0, proto?.distance || 14, proto?.decay ?? 2);
      scene.add(l);
      const entry = { light: l, anchor: null, get base() { return this.anchor ? this.anchor.base : 0; } };
      this.lights.push(entry); this.lamps.push(entry);
    }
    this.t = 0;
  }
  update(camera, dt) {
    if (!this.lights.length || (this.t -= dt) > 0) return;
    this.t = 0.3;
    const p = camera.position;
    const near = this.anchors.map((a) => [a.pos.distanceToSquared(p), a]).sort((x, y) => x[0] - y[0]).slice(0, this.lights.length).map((x) => x[1]);
    // 已经分配好的灯位尽量不动，只换掉不在最近名单里的
    const free = this.lights.filter((e) => !near.includes(e.anchor));
    const need = near.filter((a) => !this.lights.some((e) => e.anchor === a));
    for (let i = 0; i < free.length && i < need.length; i++) {
      const e = free[i], a = need[i];
      e.anchor = a;
      e.light.position.copy(a.pos); e.light.color.copy(a.color); e.light.distance = a.distance; e.light.decay = a.decay;
    }
  }
}
