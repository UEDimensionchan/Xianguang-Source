import * as THREE from 'three';
import { VRMSpringBoneCollider, VRMSpringBoneColliderShapeCapsule } from '@pixiv/three-vrm';
// 头发、衣服的摆动骨骼：原模型的参数在激烈移动时甩得太厉害（头发甩到脸前、裙摆飞起、穿进身体）。
// 这里统一调软一点：更硬、阻尼更大、带一点向下的重力，并且每根骨骼相对静止姿势的摆动角度有上限。

const KINDS = [
  ['breast', /breast|bust|胸/i, { stiff: 3, maxDeg: 4 }],
  // 裙子：碰撞要真的推得开（不减弱、角度上限放宽），不然跑起来大腿会穿出裙子
  ['cloth', /skirt|スカート|スカ|裾|裙|coat|cloth|costume|dress|belt|ribbon|apron|frill|hem|parka|hood|^sk\d|^sk[_.-]|skf|skb|undsk/i, { stiff: 2.4, maxDeg: 32, free: true }],
  ['hair', /hair|髪|ahoge|tail|ear|bang|もみあげ/i, { stiff: 2.5, maxDeg: 14 }],
];
const DAMP = 0.45;
const OTHER = { stiff: 2.5, maxDeg: 10 }; // maxDeg：整串骨骼加起来最多偏离静止姿势多少度

export function tameSprings(vrm) {
  const m = vrm?.springBoneManager;
  if (!m || vrm.userData?.springsTamed) return;
  (vrm.userData ||= {}).springsTamed = true;
  const list = [];
  const clothJoints = [];
  const bones = new Set([...m.joints].map((j) => j.bone));
  // 一串骨骼的长度：每节分到的角度 = 整串上限 / 节数，免得一节节累加起来甩到 90°
  const chainLen = (b) => {
    let n = 1;
    for (let p = b.parent; p && bones.has(p); p = p.parent) n++;
    for (let c = b; ;) { c = c.children.find((x) => bones.has(x)); if (!c) break; n++; }
    return n;
  };
  for (const j of m.joints) {
    const name = j.bone.name || '';
    const k = KINDS.find(([, re]) => re.test(name))?.[2] || OTHER;
    const s = j.settings;
    s.stiffness = Math.max(s.stiffness * k.stiff, 0.8 * k.stiff);
    s.dragForce = THREE.MathUtils.clamp(Math.max(s.dragForce, 0.7), 0, 0.92);
    s.gravityPower = THREE.MathUtils.clamp(s.gravityPower, 0.08, 0.35);
    s.gravityDir?.set(0, -1, 0);
    const rest = (j._initialLocalRotation || j.bone.quaternion).clone();
    list.push({ bone: j.bone, local: new THREE.Matrix4(), rest, free: !!k.free, max: THREE.MathUtils.degToRad(k.maxDeg / Math.max(1, chainLen(j.bone) - 1)) });
    if (k.free) { s.gravityPower = Math.max(s.gravityPower, 0.45); s.dragForce = Math.max(s.dragForce, 0.85); clothJoints.push(j); }
  }
  // 腿上加胶囊碰撞体（大腿、小腿），裙摆被腿顶开，而不是腿穿出裙子
  const colliders = clothJoints.length ? legColliders(vrm) : [];
  if (colliders.length) {
    const group = { colliders, name: 'legs' };
    for (const j of clothJoints) { j.colliderGroups = [...j.colliderGroups.filter((g) => g.name !== 'legs'), group]; j.settings.hitRadius = Math.max(j.settings.hitRadius, 0.025); }
  }
  vrm.userData.springList = list;
  const q = new THREE.Quaternion(), tmp = new THREE.Quaternion(), cur = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const roots = list.filter((e) => !bones.has(e.bone.parent)).map((e) => e.bone);
  const orig = vrm.update.bind(vrm);
  vrm.update = (dt) => {
    for (const c of colliders) c.updateWorldMatrix(false, false); // 碰撞体的位置跟着腿走
    orig(Math.min(dt, 1 / 30)); // 卡顿时不让一大步模拟把头发甩飞
    // 摆动的结果直接写在骨骼的世界矩阵里：先按模拟结果算出每节的本地旋转（全部算完再改，免得互相影响）
    for (const e of list) {
      const { bone } = e;
      e.local.copy(bone.parent.matrixWorld).invert().multiply(bone.matrixWorld);
    }
    for (const e of list) {
      const { bone, rest, max } = e;
      e.local.decompose(pos, cur, scl);
      if (!e.free) cur.copy(tmp.copy(rest).slerp(cur, DAMP)); // 模拟出来的摆动只取一部分（裙子除外：要保留碰撞推开的结果）
      q.copy(rest).invert().multiply(cur);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
      if (ang > max) cur.copy(tmp.copy(rest).slerp(cur, max / ang));
      bone.matrix.compose(pos, cur, scl);
    }
    // 从每串的根往下重新算世界矩阵
    for (const r of roots) r.updateMatrixWorld(true);
  };
}

// 大腿、小腿的胶囊碰撞体（挂在原始骨骼上，跟着动作走）
function legColliders(vrm) {
  const H = vrm.humanoid, out = [];
  vrm.scene.updateMatrixWorld(true);
  const head = H.getRawBoneNode('head'), foot = H.getRawBoneNode('leftFoot');
  const height = head && foot ? head.getWorldPosition(new THREE.Vector3()).y - foot.getWorldPosition(new THREE.Vector3()).y : 1.4;
  const k = THREE.MathUtils.clamp(height / 1.35, 0.6, 1.4);
  for (const side of ['left', 'right']) {
    for (const [a, b, r] of [['UpperLeg', 'LowerLeg', 0.075], ['LowerLeg', 'Foot', 0.05]]) {
      const bone = H.getRawBoneNode(side + a), end = H.getRawBoneNode(side + b);
      if (!bone || !end) continue;
      const tail = bone.worldToLocal(end.getWorldPosition(new THREE.Vector3()));
      const shape = new VRMSpringBoneColliderShapeCapsule({ offset: new THREE.Vector3(0, 0, 0), tail, radius: r * k });
      const c = new VRMSpringBoneCollider(shape);
      c.name = 'legCollider';
      bone.add(c);
      c.updateWorldMatrix(true, false);
      out.push(c);
    }
  }
  return out;
}
