import * as THREE from 'three';

// 角色描边（反向外壳法）：给每个网格复制一份“只画背面、沿法线往外推一点”的纯色网格，
// 和原网格共用几何体、骨骼和表情，所以动画、头发摆动、表情都跟着走。
// 描边宽度按离镜头的距离放大，远处也看得清；不透墙（被挡住就看不到）。
const cache = new Map();
function outlineMaterial(color, skinned) {
  const key = color + (skinned ? 's' : 'r');
  const N = skinned ? 'objectNormal' : 'normal'; // 不带骨骼的网格在基础材质里没有 objectNormal
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false, toneMapped: false });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <skinning_vertex>', `#include <skinning_vertex>
      {
        vec4 _mv = modelViewMatrix * vec4(transformed, 1.0);
        // 屏幕上大致恒定的粗细：按距离放大、按镜头放大倍数（开镜）缩小
        float _w = clamp(0.00085 * -_mv.z / projectionMatrix[1][1], 0.0022, 0.03);
        transformed += normalize(${N}) * _w;
      }`);
  };
  m.customProgramCacheKey = () => 'char-outline-' + N;
  cache.set(key, m);
  return m;
}

export function addOutline(root, color = 0xff2a3d) {
  const shells = [];
  const src = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isOutlineShell) return;
    // VRM 自带的描边材质（isOutline）那一份不用再加
    const mats = [].concat(o.material);
    if (mats.every((m) => m.isOutline)) return;
    // 脸上的眼睛、眉毛、睫毛、嘴这些都在头的轮廓里面，透明的贴片也不用描，省掉一大半绘制次数
    // （MMD 转的模型：口内、歯、白目、ハイライト、眉睫、舌、モーフ 这些也跳过）
    if (mats.every((m) => m.transparent || /EYE|FACE(?!_00_SKIN)|Eye|Brow|Lash|Mouth/.test(m.name) && !/SKIN/.test(m.name)
      || /顔|face|口内|歯|白目|ハイライト|眉|睫|舌|モーフ|^shadow|eyeball|eyeEX|brow|innermouth|teeth|tongue|trance/i.test(m.name))) return; // 脸整块不描边
    src.push(o);
  });
  for (const o of src) {
    const s = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, outlineMaterial(color, true)) : new THREE.Mesh(o.geometry, outlineMaterial(color, false));
    if (o.isSkinnedMesh) s.bind(o.skeleton, o.bindMatrix);
    if (o.morphTargetInfluences) { s.morphTargetInfluences = o.morphTargetInfluences; s.morphTargetDictionary = o.morphTargetDictionary; }
    s.userData.isOutlineShell = true;
    s.userData.noMinimap = true;
    s.frustumCulled = false;
    s.castShadow = false;
    s.layers.mask = o.layers.mask;
    s.renderOrder = o.renderOrder;
    o.parent.add(s);
    s.position.copy(o.position); s.quaternion.copy(o.quaternion); s.scale.copy(o.scale);
    shells.push(s);
  }
  return {
    shells,
    set visible(v) { for (const s of shells) s.visible = v; },
  };
}
