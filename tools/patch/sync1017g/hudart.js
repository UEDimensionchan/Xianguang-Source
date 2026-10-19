import * as THREE from 'three';

// 界面用的图片都在游戏里现场渲染：角色头像、武器剪影、小地图
// 这样换角色、换枪、换地图都不用另外准备图片

function readTarget(renderer, rt, w, h) {
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); // 上下翻转
  ctx.putImageData(img, 0, 0);
  return c;
}

function withTarget(renderer, w, h, fn) {
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  fn();
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  const c = readTarget(renderer, rt, w, h);
  rt.dispose();
  return c;
}

// 角色头像：不挪动模型（挪动 VRM 会打乱它的骨骼），只把角色放到单独的图层，从正面拍头部
const PORTRAIT_LAYER = 12;
export function renderPortrait(renderer, vrm, scene) {
  vrm.scene.updateMatrixWorld(true);
  // 只把角色本体放进头像层：敌人的红色描边外壳不要；场景里的灯也不用（夜里会把头像拍得很黑），
  // 换成一套固定的“摄影棚”灯光，白天黑夜拍出来都一样亮、一样好看
  const masks = [];
  vrm.scene.traverse((o) => { masks.push([o, o.layers.mask]); if (!o.userData.isOutlineShell) o.layers.enable(PORTRAIT_LAYER); else o.layers.disable(PORTRAIT_LAYER); });
  const head = vrm.humanoid.getRawBoneNode('head') || vrm.humanoid.getRawBoneNode('neck');
  const hp = head.getWorldPosition(new THREE.Vector3());
  // 角色面朝它所在节点（pivot）的 +Z
  const q = vrm.scene.parent ? vrm.scene.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 10);
  // 稍微侧一点、略俯视，像角色卡的证件照
  cam.position.copy(hp).addScaledVector(fwd, 1.0).addScaledVector(side, 0.14).add(new THREE.Vector3(0, 0.1, 0));
  cam.lookAt(hp.x, hp.y + 0.0, hp.z);
  cam.layers.set(PORTRAIT_LAYER);
  const rig = new THREE.Group();
  const amb = new THREE.HemisphereLight(0xffffff, 0xc9d6e6, 1.15);
  const key = new THREE.DirectionalLight(0xfff4ea, 2.0);
  key.position.copy(hp).addScaledVector(fwd, 2).addScaledVector(side, 1.2).add(new THREE.Vector3(0, 1.6, 0));
  key.target.position.copy(hp);
  const rim = new THREE.DirectionalLight(0xbff6ff, 1.2);
  rim.position.copy(hp).addScaledVector(fwd, -1.5).addScaledVector(side, -1.2).add(new THREE.Vector3(0, 0.8, 0));
  rim.target.position.copy(hp);
  for (const l of [amb, key, rim]) { l.layers.set(PORTRAIT_LAYER); rig.add(l); }
  rig.add(key.target, rim.target);
  scene.add(rig);
  rig.updateMatrixWorld(true);
  const bg = scene.background, fog = scene.fog, env = scene.environment;
  scene.background = null; scene.fog = null; scene.environment = null;
  const exp = renderer.toneMappingExposure;
  renderer.toneMappingExposure = 1;
  const c = withTarget(renderer, 256, 256, () => renderer.render(scene, cam));
  renderer.toneMappingExposure = exp;
  scene.background = bg; scene.fog = fog; scene.environment = env;
  scene.remove(rig);
  for (const [o, m] of masks) o.layers.mask = m;
  return c.toDataURL('image/png');
}

// 武器剪影：白色平涂，从左侧看（枪口朝右）
export function renderGunIcon(renderer, holder) {
  const scene = new THREE.Scene();
  const parent = holder.parent;
  const saved = { p: holder.position.clone(), q: holder.quaternion.clone(), s: holder.scale.clone(), v: holder.visible };
  scene.add(holder);
  holder.position.set(0, 0, 0); holder.quaternion.identity(); holder.scale.setScalar(1); holder.visible = true;
  holder.updateMatrixWorld(true);
  const masks = [];
  holder.traverse((o) => { if (o.isMesh) { masks.push([o, o.layers.mask]); o.layers.set(0); } });
  // 镭射光束很长，不算进剪影
  const beams = []; holder.traverse((o) => { if (o.userData.beam && o.visible) { beams.push(o); o.visible = false; } });
  const box = new THREE.Box3();
  holder.traverse((o) => { // 只算看得见的部分（被配件换掉的原部件、光束都不算）
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    if (o.isSkinnedMesh) { box.union(new THREE.Box3().expandByObject(o, true)); return; }
    o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); // 不递归子物体
  });
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const W = 320, H = 120;
  const half = Math.max(size.z / 2 / (W / H), size.y / 2) * 1.08;
  const cam = new THREE.OrthographicCamera(-half * W / H, half * W / H, half, -half, 0.01, 10);
  cam.position.set(c.x - 2, c.y, c.z);
  cam.lookAt(c);
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const canvas = withTarget(renderer, W, H, () => renderer.render(scene, cam));
  scene.overrideMaterial.dispose();
  for (const [o, m] of masks) o.layers.mask = m;
  for (const o of beams) o.visible = true;
  holder.position.copy(saved.p); holder.quaternion.copy(saved.q); holder.scale.copy(saved.s); holder.visible = saved.v;
  if (parent) parent.add(holder);
  return canvas.toDataURL('image/png');
}

// 小地图：正上方正交相机拍一张深度图（越高越亮），再染成灰白色调
export function renderMinimap(renderer, scene, box, hide = []) {
  const S = 512;
  const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 1.04;
  const c = box.getCenter(new THREE.Vector3());
  const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0.1, box.max.y - box.min.y + 20);
  cam.position.set(c.x, box.max.y + 10, c.z);
  cam.up.set(0, 0, -1); // 画面上方 = 世界 -Z（北）
  cam.lookAt(c.x, box.min.y, c.z);
  const vis = hide.map((o) => [o, o.visible]);
  hide.forEach((o) => { o.visible = false; });
  const prevBg = scene.background, prevFog = scene.fog;
  scene.background = null; scene.fog = null;
  scene.overrideMaterial = new THREE.MeshDepthMaterial();
  const canvas = withTarget(renderer, S, S, () => renderer.render(scene, cam));
  scene.overrideMaterial.dispose();
  scene.overrideMaterial = null;
  scene.background = prevBg; scene.fog = prevFog;
  vis.forEach(([o, v]) => { o.visible = v; });
  // 深度 → 灰度：地面暗灰，高处偏白，没有东西的地方透明
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const k = (d[i] - lo) / Math.max(1, hi - lo);
    const g = 90 + k * 140;
    d[i] = g; d[i + 1] = g + 4; d[i + 2] = g + 8; d[i + 3] = 235;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, minX: c.x - size / 2, minZ: c.z - size / 2, size };
}

// 纸片靶的头像（没有真实角色，用一个剪纸小人）
export const DUMMY_FACE = `<svg viewBox="0 0 48 48"><circle cx="24" cy="17" r="8" fill="#ffd9d9"/><path d="M10 46c0-10 6-16 14-16s14 6 14 16z" fill="#ffd9d9"/><circle cx="21" cy="17" r="1.4" fill="#5a2430"/><circle cx="27" cy="17" r="1.4" fill="#5a2430"/></svg>`;
export const HEADSHOT_ICON = `<svg class="hs" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 0v6M12 18v6M0 12h6M18 12h6" stroke="currentColor" stroke-width="2.5"/></svg>`;
