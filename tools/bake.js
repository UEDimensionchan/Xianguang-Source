// 把 Quaternius UAL 动作烘焙成 VRM 标准骨骼（normalized humanoid）的动画数据。
// 打开 tools/bake.html 运行，结果写到 Asset/Animation/ual_vrm.json。
// 输出约定：VRM1 朝向（+Z 为前方）；VRM0 角色在运行时把四元数的 x/z 取反即可。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// UE 风格骨骼名 → VRM 人形骨骼名
export const BONE_MAP = {
  pelvis: 'hips', spine_01: 'spine', spine_02: 'chest', spine_03: 'upperChest', neck_01: 'neck', Head: 'head',
  clavicle_l: 'leftShoulder', upperarm_l: 'leftUpperArm', lowerarm_l: 'leftLowerArm', hand_l: 'leftHand',
  clavicle_r: 'rightShoulder', upperarm_r: 'rightUpperArm', lowerarm_r: 'rightLowerArm', hand_r: 'rightHand',
  thigh_l: 'leftUpperLeg', calf_l: 'leftLowerLeg', foot_l: 'leftFoot', ball_l: 'leftToes',
  thigh_r: 'rightUpperLeg', calf_r: 'rightLowerLeg', foot_r: 'rightFoot', ball_r: 'rightToes',
};
for (const s of ['l', 'r']) {
  const side = s === 'l' ? 'left' : 'right';
  BONE_MAP[`thumb_01_${s}`] = `${side}ThumbMetacarpal`;
  BONE_MAP[`thumb_02_${s}`] = `${side}ThumbProximal`;
  BONE_MAP[`thumb_03_${s}`] = `${side}ThumbDistal`;
  for (const [ue, vrm] of [['index', 'Index'], ['middle', 'Middle'], ['ring', 'Ring'], ['pinky', 'Little']]) {
    BONE_MAP[`${ue}_01_${s}`] = `${side}${vrm}Proximal`;
    BONE_MAP[`${ue}_02_${s}`] = `${side}${vrm}Intermediate`;
    BONE_MAP[`${ue}_03_${s}`] = `${side}${vrm}Distal`;
  }
}

export const CLIPS = [
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Jump_Start', 'Jump_Loop', 'Jump_Land',
  'Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down', 'Pistol_Shoot', 'Pistol_Reload',
  'Roll', 'Death01', 'Hit_Chest', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop',
];

const r4 = (v) => Math.round(v * 10000) / 10000;

export async function bake(url, rmUrl, restClipName = 'A_TPose') {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const holder = new THREE.Group();
  // 源骨架转成 Y 向上后已经朝 +Z（左臂在 +X），和 VRM1 一致，不需要再转
  holder.add(gltf.scene);
  holder.updateMatrixWorld(true);

  // 用 T 姿势那一帧作为重定向的基准姿势
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const restClip = gltf.animations.find((a) => a.name === restClipName);
  if (restClip) { mixer.clipAction(restClip).play(); mixer.update(0); }
  holder.updateMatrixWorld(true);

  const nodes = {};
  gltf.scene.traverse((o) => { if (BONE_MAP[o.name]) nodes[o.name] = o; });
  const rest = {};
  for (const [name, node] of Object.entries(nodes)) {
    rest[name] = {
      inv: node.getWorldQuaternion(new THREE.Quaternion()).invert(),
      parent: node.parent.getWorldQuaternion(new THREE.Quaternion()),
      parentMatrix: node.parent.matrixWorld.clone(),
    };
  }
  const hipsHeight = nodes.pelvis.getWorldPosition(new THREE.Vector3()).y;

  // 诊断：T 姿势里手臂方向
  const dir = (a, b) => nodes[b].getWorldPosition(new THREE.Vector3()).sub(nodes[a].getWorldPosition(new THREE.Vector3())).normalize();
  const diag = {
    leftArm: dir('upperarm_l', 'lowerarm_l').toArray().map(r4),
    rightArm: dir('upperarm_r', 'lowerarm_r').toArray().map(r4),
    leftLeg: dir('thigh_l', 'calf_l').toArray().map(r4),
    headUp: dir('neck_01', 'Head').toArray().map(r4),
    hipsHeight: r4(hipsHeight),
  };
  mixer.stopAllAction();

  // 根运动版本：测每个动作的前进速度，用来匹配脚步
  const speeds = {};
  if (rmUrl) {
    const rm = await loader.loadAsync(rmUrl);
    for (const clip of rm.animations) {
      if (clip.duration === 0) continue;
      let best = 0;
      for (const tr of clip.tracks) {
        if (!/^(root|pelvis)\.position$/.test(tr.name)) continue;
        const v = tr.values, n = v.length;
        best = Math.max(best, Math.hypot(v[n - 3] - v[0], v[n - 2] - v[1], v[n - 1] - v[2]));
      }
      speeds[clip.name] = r4(best / clip.duration);
    }
  }

  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const out = { hipsHeight: r4(hipsHeight), diag, speeds, clips: {} };
  for (const name of CLIPS) {
    const clip = gltf.animations.find((a) => a.name === name);
    if (!clip) continue;
    const tracks = [];
    for (const track of clip.tracks) {
      const [boneName, prop] = track.name.split('.');
      const vrmBone = BONE_MAP[boneName];
      if (!vrmBone || !rest[boneName]) continue;
      const rs = rest[boneName];
      if (prop === 'quaternion') {
        const vals = new Array(track.values.length);
        for (let i = 0; i < track.values.length; i += 4) {
          q.fromArray(track.values, i).premultiply(rs.parent).multiply(rs.inv);
          vals[i] = r4(q.x); vals[i + 1] = r4(q.y); vals[i + 2] = r4(q.z); vals[i + 3] = r4(q.w);
        }
        tracks.push({ bone: vrmBone, type: 'q', times: Array.from(track.times, r4), values: vals });
      } else if (prop === 'position' && boneName === 'pelvis') {
        const vals = new Array(track.values.length);
        for (let i = 0; i < track.values.length; i += 3) {
          p.fromArray(track.values, i).applyMatrix4(rs.parentMatrix);
          vals[i] = r4(p.x); vals[i + 1] = r4(p.y); vals[i + 2] = r4(p.z);
        }
        tracks.push({ bone: vrmBone, type: 'p', times: Array.from(track.times, r4), values: vals });
      }
    }
    out.clips[name] = { duration: r4(clip.duration), tracks };
  }
  return out;
}
