import * as THREE from 'three';

// 上半身骨骼（其余属于下半身：髋、腿、脚）
const UPPER = new Set(['spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand']);
const TWIST = ['hips', 'spine', 'chest'];
// 跑步动作收敛：动作包里的慢跑步子很大、后脚踢得高，按比例把腿的摆动往直立姿势拉回来，再提高步频
const LEGS = ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
const STRIDE = { upper: 0.68, lower: 0.62, foot: 0.7, hipsBob: 0.55, cadence: 1.22 };
const _qI = new THREE.Quaternion();
const TWIST_ALL = [...TWIST, ...LEGS];
const ease = (k) => k * k * (3 - 2 * k);
const isUpper = (b) => UPPER.has(b) || /Thumb|Index|Middle|Ring|Little/.test(b);

let dataPromise = null;
export function loadAnimData(url) {
  if (!dataPromise) dataPromise = fetch(url).then((r) => r.json());
  return dataPromise;
}

const _qY = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const smooth = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, dt * rate);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// 用烘焙好的 VRM 通用动作驱动一个角色：下半身跑跳 + 上半身瞄准，叠加开枪、换弹、翻滚、倒地
export class CharacterAnimator {
  constructor(vrm, data) {
    this.vrm = vrm;
    this.data = data;
    this.isVRM0 = vrm.meta?.metaVersion === '0';
    this.mixer = new THREE.AnimationMixer(vrm.scene);

    const hum = vrm.humanoid;
    this.nodes = {};
    for (const clip of Object.values(data.clips)) {
      for (const t of clip.tracks) {
        if (this.nodes[t.bone] !== undefined) continue;
        const n = hum.getNormalizedBoneNode(t.bone);
        if (n) n.name = THREE.PropertyBinding.sanitizeNodeName(n.name || ('VRM_' + t.bone));
        this.nodes[t.bone] = n || null;
      }
    }
    vrm.scene.updateMatrixWorld(true);
    const hips = this.nodes.hips;
    const hipsY = hips.getWorldPosition(_v).y - vrm.scene.getWorldPosition(_v2).y;
    this.scale = hipsY / data.hipsHeight;
    this.restHipsY = hips.position.y;

    // 每个动作拆成 下半身 / 上半身 / 全身 三个版本
    const make = (name, part, loop = true) => {
      const src = data.clips[name];
      if (!src) return null;
      const tracks = [];
      for (const t of src.tracks) {
        const node = this.nodes[t.bone];
        if (!node) continue;
        const upper = isUpper(t.bone);
        if (part === 'lower' && upper) continue;
        if (part === 'upper' && !upper) continue;
        if (t.type === 'q') {
          const vals = this.isVRM0 ? t.values.map((v, i) => (i % 2 === 0 ? -v : v)) : t.values;
          tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, t.times, vals));
        } else if (t.type === 'p') {
          const vals = t.values.map((v, i) => (this.isVRM0 && i % 3 !== 1 ? -v : v) * this.scale);
          tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, t.times, vals));
        }
      }
      const clip = new THREE.AnimationClip(`${name}_${part}`, src.duration, tracks);
      const a = this.mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      return a;
    };

    const S = data.speeds || {};
    const sc = this.scale;
    this.loco = [
      { a: make('Idle_Loop', 'lower'), u: make('Idle_Loop', 'upper'), speed: 0 },
      { a: make('Walk_Loop', 'lower'), u: make('Walk_Loop', 'upper'), speed: (S.Walk_Loop || 1) * sc },
      { a: make('Jog_Fwd_Loop', 'lower'), u: make('Jog_Fwd_Loop', 'upper'), speed: (S.Jog_Fwd_Loop || 5) * sc },
      { a: make('Sprint_Loop', 'lower'), u: make('Sprint_Loop', 'upper'), speed: (S.Sprint_Loop || 8) * sc },
    ];
    for (const l of this.loco) { l.a.timeScale = 0; if (l.u) l.u.timeScale = 0; } // 手动对齐步伐相位

    this.jumpLoop = make('Jump_Loop', 'lower');
    this.jumpStart = make('Jump_Start', 'lower', false);
    this.jumpLand = make('Jump_Land', 'lower', false);
    this.aimN = make('Pistol_Aim_Neutral', 'upper');
    this.aimUp = make('Pistol_Aim_Up', 'upper');
    this.aimDown = make('Pistol_Aim_Down', 'upper');
    this.shootA = make('Pistol_Shoot', 'upper', false);
    this.reloadA = make('Pistol_Reload', 'upper', false);
    this.roll = make('Roll', 'full', false);
    this.death = make('Death01', 'full', false);
    this.hit = make('Hit_Chest', 'upper', false);

    this.phase = 0;
    this.air = 0;
    this.takeoffT = 0;
    this.landT = 0;
    this.shootW = 0;
    this.reloadW = 0;
    this.rollT = 0;
    this.deathW = 0;
    this.hitT = 0;
    this.hipYaw = 0;
    this._pure = {};
    this.wasOnFloor = true;
    this.airTime = 0;
  }

  shoot() {
    this.shootA.reset().play();
    this.shootA.time = 0.04;
    this.shootW = 0.55;
  }

  reload(duration) {
    this.reloadA.reset().play();
    this.reloadA.timeScale = this.data.clips.Pistol_Reload.duration / duration;
  }

  dash() {
    this.roll.reset().play();
    this.roll.timeScale = 2.3;
    this.rollT = this.data.clips.Roll.duration / 2.3;
  }

  die() { this.death.reset().play(); this.deathOn = true; }
  revive() { this.deathOn = false; this.deathW = 0; this.death.stop(); this.death.play(); }
  hurt() { this.hit.reset().play(); this.hitT = 0.33; }

  // s: { speed, localX, localZ, onFloor, velY, pitch, paper, reloading }
  update(dt, s) {
    // —— 下半身：按速度在 待机/走/跑/冲刺 之间混合 ——
    const backward = s.localZ < -0.3;
    const sp = s.speed;
    const w = [0, 0, 0, 0];
    const L = this.loco;
    if (sp < 0.15) w[0] = 1;
    else if (sp < L[1].speed * 1.6) { const k = clamp01((sp - 0.15) / (L[1].speed * 1.6 - 0.15)); w[0] = 1 - k; w[1] = k; }
    else if (sp < L[2].speed) { const k = clamp01((sp - L[1].speed * 1.6) / (L[2].speed - L[1].speed * 1.6)); w[1] = 1 - k; w[2] = k; }
    else { const k = clamp01((sp - L[2].speed) / (L[3].speed - L[2].speed)); w[2] = 1 - k; w[3] = k; }
    let freq = 0, wsum = 0;
    for (let i = 1; i < 4; i++) {
      if (!w[i]) continue;
      const dur = L[i].a.getClip().duration;
      freq += w[i] * (1 / dur) * THREE.MathUtils.clamp(sp / L[i].speed, 0.55, 1.7) * (i === 2 ? STRIDE.cadence : 1);
      wsum += w[i];
    }
    if (wsum > 0) this.phase += dt * (freq / wsum) * (backward ? -1 : 1);
    const ph = ((this.phase % 1) + 1) % 1;

    // —— 跳跃：起跳 → 上升 → 下落 → 落地，全部平滑交叉淡入淡出 ——
    if (!s.onFloor) this.airTime += dt; else this.airTime = 0;
    if (this.wasOnFloor && !s.onFloor && s.velY > 2) { this.takeoffT = 0.22; this.jumpStart.reset().play(); this.jumpStart.time = 0.6; this.jumpStart.timeScale = 1.3; }
    if (!s.onFloor) this._fallV = Math.min(this._fallV || 0, s.velY);
    if (!this.wasOnFloor && s.onFloor && this._lastAir > 0.2) {
      // 落地缓冲：下落越快蹲得越深；跑动中落地只轻轻一顿，直接接上跑步
      const impact = THREE.MathUtils.clamp(-(this._fallV || 0) / 14, 0.2, 0.75);
      this.landPeak = impact * (1 - 0.55 * clamp01(sp / 4));
      this.landT = this.landDur = 0.32;
      this.jumpLand.reset().play(); this.jumpLand.time = 0.12; this.jumpLand.timeScale = 1.5;
    }
    if (s.onFloor) this._fallV = 0;
    this._lastAir = this.airTime || this._lastAir;
    if (s.onFloor) this._lastAir = 0;
    this.wasOnFloor = s.onFloor;
    this.air = smooth(this.air, !s.onFloor && this.airTime > 0.05 ? 1 : 0, s.onFloor ? 16 : 9, dt);
    this.takeoffT = Math.max(0, this.takeoffT - dt);
    this.landT = Math.max(0, this.landT - dt);
    const takeW = ease(this.takeoffT / 0.22);
    const landW = this.landT > 0 ? (this.landPeak || 0) * ease(this.landT / this.landDur) : 0;
    // 空中：上升时保持起跳后的收腿姿势，过了最高点慢慢换成下落姿势
    this.rise = smooth(this.rise ?? 1, clamp01(s.velY / 5 + 0.3), 6, dt);
    // 空中保留一点跑步动作，起跳那一下不会从大步突然变成收腿
    const carry = 0.3 * clamp01(sp / 4);

    // —— 全身覆盖：翻滚、倒地 ——
    this.rollT = Math.max(0, this.rollT - dt);
    const rollW = this.rollT > 0 ? Math.min(1, this.rollT / 0.12, 1) : 0;
    this.deathW = smooth(this.deathW, this.deathOn ? 1 : 0, 10, dt);
    const fullW = Math.max(rollW, this.deathW);
    this.roll.setEffectiveWeight(rollW * (1 - this.deathW));
    this.death.setEffectiveWeight(this.deathW);
    const rest = 1 - fullW;

    const airW = this.air * (1 - carry);
    const groundW = (1 - airW) * (1 - takeW * 0.7) * (1 - landW);
    for (let i = 0; i < 4; i++) {
      const a = L[i].a;
      a.time = ph * a.getClip().duration;
      a.setEffectiveWeight(w[i] * groundW * rest);
      if (L[i].u) { L[i].u.time = a.time; }
    }
    if (this.air > 0.01 && this.jumpStart.time > 1.0) this.jumpStart.time = 1.0; // 停在离地后的姿势
    const startW = Math.max(takeW * 0.7, airW * this.rise) * (1 - landW);
    this.jumpStart.setEffectiveWeight(startW * rest);
    this.jumpLoop.setEffectiveWeight(airW * (1 - this.rise) * (1 - takeW) * rest);
    this.jumpLand.setEffectiveWeight(landW * rest);
    this._runW = w[2] * groundW * rest;

    // —— 上半身：持枪瞄准随准星俯仰；纸化时手臂跟随跑动 ——
    this.reloadW = smooth(this.reloadW, s.reloading ? 1 : 0, 12, dt);
    this.shootW = Math.max(0, this.shootW - dt * 3.5);
    this.hitT = Math.max(0, this.hitT - dt);
    const hitW = this.hitT > 0 ? 0.6 * (this.hitT / 0.33) : 0;
    const paper = s.paper;
    const aimW = (1 - paper) * (1 - this.reloadW) * rest;
    this.aimWeight = aimW; // 给手臂 IK 用：换弹、纸化、翻滚、倒地时双手离开握持点
    // 瞄准姿势实测：向上约 70°（1.22 rad），向下约 75°（1.3 rad）
    const up = clamp01(s.pitch / 1.22), down = clamp01(-s.pitch / 1.3);
    this.aimUp.setEffectiveWeight(up * aimW);
    this.aimDown.setEffectiveWeight(down * aimW);
    this.aimN.setEffectiveWeight((1 - up - down) * aimW);
    this.reloadA.setEffectiveWeight(this.reloadW * (1 - paper) * rest);
    this.shootA.setEffectiveWeight(this.shootW * (1 - paper) * (1 - this.reloadW) * rest);
    this.hit.setEffectiveWeight(hitW * rest);
    for (let i = 0; i < 4; i++) if (L[i].u) L[i].u.setEffectiveWeight(w[i] * paper * rest);

    // 动画库只在数值变化时才写骨骼。我们下面会给髋/胸额外加扭转，
    // （腿也会被收小步子改写，同样处理）所以先把这几根骨骼恢复成上一帧的“纯动画”姿势，避免扭转每帧叠加导致角色转圈
    for (const k of TWIST_ALL) {
      const n = this.nodes[k];
      if (n && this._pure[k]) n.quaternion.copy(this._pure[k]);
    }
    if (this._pureHipsY !== undefined) this.nodes.hips.position.y = this._pureHipsY;
    this.mixer.update(dt);
    for (const k of TWIST_ALL) {
      const n = this.nodes[k];
      if (n) (this._pure[k] || (this._pure[k] = new THREE.Quaternion())).copy(n.quaternion);
    }
    this._pureHipsY = this.nodes.hips.position.y;

    // —— 跑步时把腿的摆动收小一点（只作用在慢跑权重上）——
    const rw = this._runW || 0;
    if (rw > 0.01) {
      for (const b of LEGS) {
        const n = this.nodes[b];
        if (!n) continue;
        const k = b.includes('Upper') ? STRIDE.upper : b.includes('Lower') ? STRIDE.lower : STRIDE.foot;
        n.quaternion.slerp(_qI, (1 - k) * rw);
      }
      const h = this.nodes.hips;
      h.position.y = this.restHipsY + (h.position.y - this.restHipsY) * (1 - (1 - STRIDE.hipsBob) * rw);
    }

    // —— 侧移 / 后退时，髋部转向移动方向，上身转回来对准准星 ——
    let target = 0;
    if (sp > 0.6 && this.air < 0.5 && fullW < 0.5) {
      const ang = Math.atan2(s.localX, s.localZ); // 0 = 正前方，正值 = 向左
      target = backward ? ang - Math.sign(ang || 1) * Math.PI : ang;
      target = THREE.MathUtils.clamp(target, -1.1, 1.1);
    }
    this.hipYaw = smooth(this.hipYaw, target, 10, dt);
    if (Math.abs(this.hipYaw) > 0.001) {
      this.nodes.hips.quaternion.premultiply(_qY.setFromAxisAngle(Y, this.hipYaw));
      this.nodes.spine?.quaternion.premultiply(_qY.setFromAxisAngle(Y, -this.hipYaw * 0.55));
      this.nodes.chest?.quaternion.premultiply(_qY.setFromAxisAngle(Y, -this.hipYaw * 0.45));
    }
  }
}
