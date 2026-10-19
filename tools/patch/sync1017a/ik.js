import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

// 让骨骼在世界空间里转动，使 from 方向对准 to 方向
function rotateWorld(bone, from, to) {
  _q.setFromUnitVectors(from, to);
  bone.getWorldQuaternion(_qw);
  bone.parent.getWorldQuaternion(_qp);
  _qw.premultiply(_q);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}

// 两段骨骼 IK（上臂 → 前臂 → 手腕）
// target：手腕要到的世界坐标；pole：肘部朝向的参考点；weight：0 = 保持动画，1 = 完全贴到目标
export function solveArm(upper, lower, hand, target, pole, weight = 1) {
  if (weight <= 0.001) return;
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E = lower.getWorldPosition(new THREE.Vector3());
  const W = hand.getWorldPosition(new THREE.Vector3());
  const T = new THREE.Vector3().lerpVectors(W, target, weight);

  const a = S.distanceTo(E);
  const b = E.distanceTo(W);
  const toT = _a.subVectors(T, S);
  let d = toT.length();
  if (d < 1e-5) return;
  const dir = toT.divideScalar(d);
  d = THREE.MathUtils.clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3);

  // 肘部所在平面：由目标方向和 pole 决定
  const toPole = _b.subVectors(pole, S);
  const side = _c.copy(toPole).addScaledVector(dir, -toPole.dot(dir));
  if (side.lengthSq() < 1e-8) side.set(0, -1, 0);
  side.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const elbowDir = _d.copy(dir).multiplyScalar(cosA).addScaledVector(side, sinA).normalize();

  rotateWorld(upper, E.clone().sub(S).normalize(), elbowDir);
  const E2 = lower.getWorldPosition(new THREE.Vector3());
  const W2 = hand.getWorldPosition(new THREE.Vector3());
  const wristGoal = S.clone().addScaledVector(dir, d);
  rotateWorld(lower, W2.sub(E2).normalize(), wristGoal.sub(E2).normalize());
}

// 把手掌转到指定朝向：dir = 手腕到指根的方向，normal = 掌心朝向（都是世界空间单位向量）
// bones: { hand, middle, index, little }（原始骨骼），isRight 区分左右手
export function orientHand(bones, isRight, dir, normal, weight = 1) {
  if (weight <= 0.001) return;
  const H = bones.hand.getWorldPosition(new THREE.Vector3());
  const M = bones.middle.getWorldPosition(new THREE.Vector3());
  const I = bones.index.getWorldPosition(new THREE.Vector3());
  const L = bones.little.getWorldPosition(new THREE.Vector3());
  const d = M.sub(H).normalize();
  const sd = I.sub(L).normalize();
  const n = (isRight ? sd.clone().cross(d) : d.clone().cross(sd)).normalize();
  const cur = new THREE.Matrix4().makeBasis(d, n, d.clone().cross(n));
  const td = dir.clone().normalize();
  const tn = normal.clone().addScaledVector(td, -normal.dot(td)).normalize();
  const tgt = new THREE.Matrix4().makeBasis(td, tn, td.clone().cross(tn));
  const q = new THREE.Quaternion().setFromRotationMatrix(tgt.multiply(cur.transpose()));
  if (weight < 1) q.slerp(new THREE.Quaternion(), 1 - weight);
  // 手腕翻转（掌心朝上 / 朝侧面）大部分交给前臂绕自身轴转（旋前/旋后），
  // 只让手腕自己转一小部分，不然手腕处的蒙皮会像拧毛巾一样绞在一起
  if (bones.lower && TWIST_SHARE > 0) {
    const E = bones.lower.getWorldPosition(new THREE.Vector3());
    const axis = H.clone().sub(E).normalize();
    const tw = twistAbout(q, axis);
    const share = new THREE.Quaternion().slerp(tw, TWIST_SHARE);
    rotateWorldQ(bones.lower, share);
    // 前臂转过之后重新算手要转多少
    return orientHand({ ...bones, lower: null }, isRight, dir, normal, weight);
  }
  rotateWorldQ(bones.hand, q);
}

// 前臂承担的手腕翻转比例
const TWIST_SHARE = 0.5;
// 四元数 q 绕 axis 的“扭转”分量（swing-twist 分解）
function twistAbout(q, axis) {
  if (q.w < 0) q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w); // 走短的那条路
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const t = new THREE.Quaternion(axis.x * d, axis.y * d, axis.z * d, q.w);
  if (t.lengthSq() < 1e-10) return new THREE.Quaternion();
  return t.normalize();
}

function rotateWorldQ(bone, q) {
  bone.getWorldQuaternion(_qw);
  bone.parent.getWorldQuaternion(_qp);
  _qw.premultiply(q);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}

// 手掌贴在某个接触点上时，手腕骨骼应该在的位置（掌心中心在指根方向约一半处，掌心表面到骨骼约 1.2 厘米）
export function wristForContact(contact, dir, normal, palmLen) {
  const td = dir.clone().normalize();
  const tn = normal.clone().addScaledVector(td, -normal.dot(td)).normalize();
  return contact.clone().addScaledVector(td, -0.5 * palmLen).addScaledVector(tn, -0.012);
}

// 手指弯曲：每节手指绕“手指方向 × 掌心朝向”的轴往掌心弯（角度单位：度）
// curl: { Index:[近节,中节,远节], Middle:[...], Ring:[...], Little:[...], Thumb:[掌骨,近节,远节] }
const _axis = new THREE.Vector3();
const _qa = new THREE.Quaternion();
export function curlFingers(humanoid, side, dir, normal, curl, weight = 1) {
  if (weight <= 0.001) return;
  const tn = normal.clone().addScaledVector(dir, -normal.dot(dir)).normalize();
  _axis.copy(dir).cross(tn).normalize();
  for (const [finger, angles] of Object.entries(curl)) {
    const segs = finger === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    segs.forEach((seg, i) => {
      const b = humanoid.getRawBoneNode(side + finger + seg);
      if (!b || !angles[i]) return;
      // 拇指往掌心方向收，绕手指方向轴转一点
      const ax = finger === 'Thumb' ? dir : _axis;
      _qa.setFromAxisAngle(ax, THREE.MathUtils.degToRad(angles[i] * weight) * (finger === 'Thumb' && side === 'left' ? -1 : 1));
      rotateWorldQ(b, _qa);
    });
  }
}

// 握枪时手指弯曲角度（度）：右手食指搭在扳机附近，其余三指包住握把；左手四指包住
export const CURL_RIGHT = { Index: [30, 45, 25], Middle: [70, 85, 50], Ring: [75, 85, 50], Little: [80, 85, 50], Thumb: [10, 25, 20] };
export const CURL_LEFT = { Index: [55, 70, 40], Middle: [65, 80, 45], Ring: [70, 80, 45], Little: [75, 80, 45], Thumb: [10, 20, 15] };
// 左手手型（palm 模式的长枪，换弹动画里按权重混合）：握持 / 勾 / 平掌
export const CURL_HOOK = { Index: [70, 80, 50], Middle: [70, 80, 50], Ring: [60, 70, 40], Little: [55, 65, 40], Thumb: [5, 30, 25] };
export const CURL_FLAT = { Index: [8, 10, 5], Middle: [8, 10, 5], Ring: [10, 12, 6], Little: [12, 14, 8], Thumb: [0, 8, 5] };
export function mixCurl(w) {
  const out = {};
  for (const f of Object.keys(CURL_LEFT)) out[f] = [0, 1, 2].map((i) => CURL_LEFT[f][i] * w[0] + CURL_HOOK[f][i] * w[1] + CURL_FLAT[f][i] * w[2]);
  return out;
}
