import * as THREE from 'three';
import { CHARACTERS } from './config.js';
// 角色配件（Blender 里做的腰带、挂饰、靴子、手套、发卡等，见 Asset/Character/Rin_Blender/）
// 配件文件是带骨骼的 glb，骨骼名和 VRM 一样（J_Bip_… / J_Sec_…）。
// 加载后把每个蒙皮网格重新绑到 VRM 自己的骨骼上：绑定姿势用 VRM 加载时的 T 字姿势现算，
// 不依赖 Blender 导出时骨骼的朝向，所以腰带跟着身体、挂饰跟着外套、内层发色跟着头发的摆动骨骼一起动。

const grad = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]), 3, 1);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.needsUpdate = true;

export function accessoryFile(vrmFile) {
  return CHARACTERS.find((c) => c.file === vrmFile)?.acc || null;
}

// 第一人称时要藏起来的（头上的）
const HEAD = /^Acc_(Hair|Ear)/;

export async function attachAccessories(loader, vrm, url) {
  if (!url) return [];
  const gltf = await loader.loadAsync(url);
  const root = vrm.scene;
  root.updateMatrixWorld(true);
  const toModel = root.matrixWorld.clone().invert();
  const byName = new Map();
  root.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
  gltf.scene.updateMatrixWorld(true);
  const src = [];
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) src.push(o); });
  const mats = new Map();
  const toon = (m) => {
    if (!mats.has(m)) {
      const t = new THREE.MeshToonMaterial({ name: m.name, color: m.color.clone(), map: m.map || null, gradientMap: grad });
      if (m.metalness > 0.5) t.color.setRGB(0.86, 0.88, 0.92); // 金属扣：卡通画风里用亮灰
      mats.set(m, t);
    }
    return mats.get(m);
  };
  const out = [];
  for (const m of src) {
    const bones = m.skeleton.bones.map((b) => byName.get(b.name));
    if (bones.some((b) => !b)) { console.warn('配件骨骼对不上，跳过', m.name); continue; }
    const inverses = bones.map((b) => new THREE.Matrix4().multiplyMatrices(toModel, b.matrixWorld).invert());
    const sm = new THREE.SkinnedMesh(m.geometry, Array.isArray(m.material) ? m.material.map(toon) : toon(m.material));
    sm.name = m.name;
    sm.frustumCulled = false;
    sm.castShadow = true;
    sm.userData.fpHide = HEAD.test(m.name);
    root.add(sm);
    sm.bind(new THREE.Skeleton(bones, inverses), m.matrixWorld.clone());
    out.push(sm);
  }
  return out;
}
