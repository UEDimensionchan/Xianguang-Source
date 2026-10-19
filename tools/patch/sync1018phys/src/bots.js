import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { VRMUtils } from '@pixiv/three-vrm';
import { Player, adsOf } from './player.js';
import { CharacterAnimator } from './anim.js';
import { WEAPONS } from './weapons.js';
import { TUNING } from './config.js';
import { NavGrid } from './nav.js';
import { registerCharacter } from './charlight.js';
import { addOutline } from './outline.js';
import { attachAccessories, accessoryFile } from './accessories.js';
import { tameSprings } from './springs.js';
import { applyAttachments, selFor, mountAttachments } from './attachments.js';

// 竞技模式的 AI 角色：和玩家用同一套角色控制（移动物理、动作、持枪 IK），只是“按键”由 AI 每帧决定。
// Squads 管理两队机器人、伤害判定、击杀计分；对外接口和训练场的 Dummies 一样（raycast / damage / explode / nearPoint / update），
// 所以玩家开枪、火箭、墨水炸弹的逻辑不用改。

const BOT_DMG = 0.55;          // AI 的子弹伤害倍率（AI 枪法稳定，伤害打个折，玩家才打得过）
const RESPAWN = 4;             // 复活时间（秒）
const SIGHT = 62;              // 最远发现距离
const NAMES = {
  ally: ['白羽', '晴岚', '露希'],
  enemy: ['夜鸦', '绯烬', '霜刃', '赤羽'],
};
const BOT_WEAPONS = ['ar', 'smg', 'lmg', 'shotgun', 'sniper', 'ar', 'smg'];
// 各武器的理想交战距离
const RANGE = { ar: 18, smg: 10, lmg: 20, sniper: 34, pistol: 13, revolver: 15, shotgun: 6, rocket: 22 };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _ray = new THREE.Ray(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();

// ———— 角色命中盒：头（球）+ 躯干（胶囊）+ 腿（胶囊），跟着骨骼走 ————
function hitBones(ch) {
  if (ch._hb) return ch._hb;
  const H = ch.vrm.humanoid;
  const g = (n) => H.getRawBoneNode(n);
  ch._hb = { head: g('head'), neck: g('neck') || g('head'), hips: g('hips'), lFoot: g('leftLowerLeg'), rFoot: g('rightLowerLeg') };
  return ch._hb;
}
// 射线打角色：返回 { distance, point, head } 或 null
export function hitCharacter(ray, ch, maxDist) {
  if (!ch.alive || !ch.vrm) return null;
  const b = hitBones(ch);
  const paper = THREE.MathUtils.lerp(1, 0.25, ch.paperAmt || 0);
  let best = null;
  const test = (d, head) => { if (d < maxDist && (!best || d < best.distance)) best = { distance: d, head }; };
  // 头
  const hp = b.head.getWorldPosition(_a); hp.y += 0.06;
  const sphere = new THREE.Sphere(hp, 0.15 * Math.max(0.6, paper));
  if (ray.intersectSphere(sphere, _p1)) test(_p1.distanceTo(ray.origin), true);
  // 躯干和腿：射线到线段的距离小于半径就算中
  const seg = (A, B, r) => {
    const d2 = ray.distanceSqToSegment(A, B, _p1, _p2);
    if (d2 < r * r) test(_p1.distanceTo(ray.origin), false);
  };
  const neck = b.neck.getWorldPosition(_b), hips = b.hips.getWorldPosition(_c);
  seg(neck, hips, 0.26 * paper);
  const feet = b.lFoot.getWorldPosition(_d).add(b.rFoot.getWorldPosition(_p2.clone())).multiplyScalar(0.5);
  seg(hips, feet, 0.2 * paper);
  if (best) best.point = ray.at(best.distance, new THREE.Vector3());
  return best;
}

// ———— 加载机器人用的角色模型：同一个文件只下载一次，每个机器人各自解析一份；贴图缩到 512 省显存 ————
const bufCache = {};
export async function loadBotVRM(loader, file) {
  if (!bufCache[file]) bufCache[file] = fetch(file).then((r) => r.arrayBuffer());
  const buf = await bufCache[file];
  const gltf = await loader.parseAsync(buf.slice(0), '');
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons?.(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  shrinkTextures(vrm.scene, 512);
  vrm.scene.traverse((o) => { o.frustumCulled = false; if (o.isMesh) o.castShadow = true; });
  await attachAccessories(loader, vrm, accessoryFile(file)).catch((e) => console.warn('角色配件加载失败', e));
  return vrm;
}
function shrinkTextures(root, max) {
  const done = new Map();
  const shrink = (t) => {
    const img = t.image;
    if (!img || !img.width || Math.max(img.width, img.height) <= max) return;
    if (!done.has(img)) {
      const k = max / Math.max(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      done.set(img, c);
    }
    t.image = done.get(img);
    t.needsUpdate = true;
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      const set = new Set();
      for (const k in m) if (m[k]?.isTexture) set.add(m[k]);
      if (m.uniforms) for (const k in m.uniforms) if (m.uniforms[k]?.value?.isTexture) set.add(m.uniforms[k].value);
      set.forEach(shrink);
    }
  });
}

// ———— 单个 AI 角色 ————
export class Bot extends Player {
  constructor(game, mgr, { team, name, weaponId, skill, charName }) {
    super(game);
    this.mgr = mgr;
    this.team = team;
    this.name = name;
    this.charName = charName;
    this.skill = skill;
    this.firstPerson = false;
    this.wi = Math.max(0, WEAPONS.findIndex((w) => w.id === weaponId));
    this.kills = 0; this.deaths = 0;
    this.input = { keys: {}, pressed: {}, fire: false, firePressed: false, aim: false, paper: false, wheel: 0 };
    this._aimPt = new THREE.Vector3();
    this.pivot.userData.noMinimap = true;
    this.resetAI();
  }

  get isPlayer() { return false; }
  // 声音按离镜头的距离衰减，太远就不播
  _sfx(key, vol = 1, rate = 1) {
    const d2 = this.pivot.position.distanceToSquared(this.game.camera.position);
    const att = 1 / (1 + d2 / 90);
    if (att > 0.04) this.game.sfx.play(key, vol * att, rate);
  }
  respawnPoint() { return this.mgr.spawnPoint(this.team); }
  aimTarget() { return this._aimPt; }
  // 离镜头远的角色不算头发、衣服的摆动物理（最耗性能的部分）
  _vrmUpdate(dt) {
    const d2 = this.pivot.position.distanceToSquared(this.game.camera.position);
    // 影子：20 米外的 AI 不投影（影子贴图里少画几十个蒙皮网格）
    const sh = d2 < 20 * 20 && this.vrm.scene.visible !== false;
    if (sh !== this._shadowOn) {
      this._shadowOn = sh;
      this.vrm.scene.traverse((o) => { if (o.isMesh && !o.userData.isOutlineShell) o.castShadow = sh; });
    }
    const near = d2 < 14 * 14 && this.vrm.scene.visible !== false;
    if (near) this.vrm.update(dt);
    else { this.vrm.humanoid.update(); this.vrm.expressionManager?.update(); }
  }
  equip() { /* 机器人只用一把枪 */ }
  // —— 动画分级更新（AI 的骨骼动画、持枪 IK、头发物理是最耗 CPU 的部分）——
  // 近处每帧更新；远一点隔帧；再远隔两帧；看不见（视野外 / 雾外）的每 6 帧更新一次。
  // 没轮到的帧只挪位置和朝向（很便宜），枪跟着平移，不会掉在原地。
  _animate(dt, wish) {
    this._animAcc = (this._animAcc || 0) + dt;
    const d2 = this.pivot.position.distanceToSquared(this.game.camera.position);
    const seen = this.vrm?.scene.visible !== false;
    const every = this.kind === 'player' ? 1 : !seen ? 6 : d2 < 15 * 15 ? 1 : d2 < 35 * 35 ? 2 : 3; // 真人替身每帧都更新，动作才跟得上
    this._animN = ((this._animN || 0) + 1) % every;
    this._animTick = this._animN === 0 || !this.alive;
    if (this._animTick) {
      super._animate(Math.min(this._animAcc, 0.2), wish);
      this._animAcc = 0;
      return;
    }
    // 只更新位置和朝向
    this.feet(this.pivot.position);
    this.pivot.position.y -= this.stepOffset;
    this.pivot.position.x -= this.stepOffsetH.x; this.pivot.position.z -= this.stepOffsetH.z;
    this.pivot.rotation.y = this.yaw;
  }
  _updateCamera() {
    if (!this.gun || !this.vrm) return;
    // 远处的 AI 手指细节看不清：只算手臂，不摆手指
    this._ikLite = this.pivot.position.distanceToSquared(this.game.camera.position) > 12 * 12;
    if (this._animTick !== false) { this._holdGun(); this._gunAt = (this._gunAt || new THREE.Vector3()).copy(this.pivot.position); return; }
    // 这帧没更新动画：枪跟着角色平移
    if (this._gunAt) { this.gun.position.add(_p2.copy(this.pivot.position).sub(this._gunAt)); this._gunAt.copy(this.pivot.position); this.gun.updateMatrixWorld(); }
  }
  muzzle(out) { return this.gun ? out.copy(this.muzzleLocal).applyMatrix4(this.gun.matrixWorld) : this.shoulder(out); }
  eye(out) { this.feet(out); out.y += 1.5; return out; }

  setModel(vrm, animData) {
    this.vrm = vrm;
    registerCharacter(vrm.scene);
    this.isVRM0 = vrm.meta?.metaVersion === '0';
    tameSprings(vrm);
    this.pivot.add(vrm.scene);
    // 敌人加一圈红色描边，远处、暗处也好认
    if (this.team === 'enemy') this.outline = addOutline(vrm.scene, 0xff2a3d);
    this.bones = {};
    for (const n of ['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm']) this.bones[n] = vrm.humanoid.getNormalizedBoneNode(n);
    this.hipsRestY = this.bones.hips.position.y;
    this.anim = animData ? new CharacterAnimator(vrm, animData) : null;
  }

  async arm() {
    const def = WEAPONS[this.wi];
    this.gun = await this.game.arsenal.instance(def);
    this.gun.userData.noMinimap = true;
    this.muzzleLocal = this.gun.userData.muzzle;
    this.game.scene.add(this.gun);
  }

  spawn(pos) {
    super.spawn(pos);
    this.yaw = this.mgr.teamYaw(this.team) + (Math.random() - 0.5) * 0.6;
    this.resetAI();
  }

  resetAI() {
    this.target = null;
    this.lastSeen = null; this.lastSeenT = 99;
    this.state = 'roam';
    this.path = null; this.goal = null; this.waitT = Math.random() * 1.5;
    this.senseT = Math.random() * 0.2;
    this.reactT = 0;
    this.err = new THREE.Vector3();
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0;
    this.burstT = 0; this.pauseT = 0;
    this.stuckT = 0; this.stuckFrom = null;
    this.paperT = 0; this.repathT = 0;
    this.hurtBy = null;
  }

  damage(n, from, by, head) {
    if (!this.alive || !this.mgr.live) return false;
    this.hp -= n;
    this.regenT = TUNING.player.regenDelay;
    this.anim?.hurt();
    if (by && by.alive && !this.target) { this.lastSeen = by.feet(new THREE.Vector3()); this.lastSeenT = 0; this.state = 'search'; this.path = null; }
    this.hurtBy = by;
    if (Math.random() < 0.3 && this.energy > 30) this.paperT = 0.5 + Math.random() * 0.4; // 被打时有时会纸化闪避
    if (this.hp <= 0) {
      this.alive = false;
      this.anim?.die();
      this.deadT = RESPAWN;
      this.deaths++;
      this.mgr.onKill(by, this, head);
      return true;
    }
    return false;
  }

  fireWeapon() { this.mgr.botShoot(this); }

  update(dt) {
    this.think(dt);
    super.update(dt, this.input);
    if (this.outline) this.outline.visible = this.alive; // 倒下以后不再描边
    this.input.pressed = {};
    this.input.firePressed = false;
  }

  // ———— AI：感知 → 选目标 → 移动 / 瞄准 / 开火 ————
  think(dt) {
    const I = this.input;
    I.keys = {}; I.fire = false; I.aim = false; I.paper = false;
    if (!this.alive || !this.mgr.live) return;
    const S = this.skill;
    const me = this.feet(_a);

    this.senseT -= dt;
    if (this.senseT <= 0) { this.senseT = 0.12 + Math.random() * 0.1; this.sense(); }
    this.lastSeenT += dt;

    const T = this.target;
    const W = this.weapon.def;
    let moveDir = null;           // 想往哪个方向走（世界坐标，水平）
    let face = null;              // 想看向的点

    if (T && T.alive) {
      // —— 交战 ——
      const tp = T.feet(_b);
      const dist = tp.distanceTo(me);
      const range = RANGE[W.id] || 16;
      // 瞄准点：胸口（准的 AI 有时瞄头），加上逐渐收敛的误差
      const aimAt = _c.copy(tp).add(_d.set(0, this.aimHead ? 1.5 : 1.15, 0));
      this.err.multiplyScalar(Math.exp(-dt * S.focus));
      aimAt.add(this.err);
      face = aimAt;
      // 距离：太远就靠近，太近就后撤，合适就左右横移
      const toT = _d.copy(tp).sub(me).setY(0).normalize();
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0.5 + Math.random() * 1.2; }
      const side = new THREE.Vector3(-toT.z, 0, toT.x).multiplyScalar(this.strafe);
      if (dist > range + 8) moveDir = this.follow(tp, dt) || toT.clone();
      else if (dist < range - 5) moveDir = toT.clone().negate().multiplyScalar(0.8).add(side.multiplyScalar(0.6));
      else moveDir = side;
      if (W.id === 'sniper' && dist > 12) moveDir = moveDir.multiplyScalar(0.25);
      // 开镜：远距离用步枪 / 机枪 / 狙击时
      I.aim = dist > 14 && ['ar', 'lmg', 'sniper'].includes(W.id);
      // 开火：反应时间过了、准星大致对准
      this.reactT -= dt;
      const want = this._dirTo(aimAt);
      const off = Math.abs(angDiff(this.yaw, want.yaw)) + Math.abs(want.pitch - this.pitch);
      if (this.reactT <= 0 && off < 0.09 + 1.2 / Math.max(6, dist) && this.visible) {
        if (W.auto) {
          if (this.pauseT > 0) this.pauseT -= dt;
          else {
            I.fire = true;
            this.burstT -= dt;
            if (this.burstT <= 0) { this.burstT = 0.35 + Math.random() * 0.7; this.pauseT = 0.15 + Math.random() * 0.35; }
          }
        } else if (this.fireCd <= -S.tap * Math.random()) {
          if (W.id !== 'sniper' || this.ads > 0.85 || dist < 12) I.firePressed = true;
        }
      }
      if (Math.random() < dt * 0.25 && this.onFloor && dist > 6) I.pressed.Space = true; // 偶尔跳一下
    } else {
      this.target = null;
      if (this.hp < 35 && this.state !== 'retreat') { this.state = 'retreat'; this.path = null; }
      if (this.state === 'retreat') {
        moveDir = this.follow(this.mgr.home(this.team), dt);
        if (!moveDir || this.hp > 80) { this.state = 'roam'; this.path = null; }
      } else if (this.state === 'search' && this.lastSeen) {
        moveDir = this.follow(this.lastSeen, dt);
        face = _c.copy(this.lastSeen).add(_d.set(0, 1.2, 0));
        if (!moveDir || this.lastSeenT > 6) { this.state = 'roam'; this.path = null; this.lastSeen = null; }
      } else {
        // 巡逻：去地图上的争夺点，到了停一会再换下一个
        if (!this.goal || (this.arrived && (this.waitT -= dt) <= 0)) { this.goal = this.mgr.pickGoal(this); this.path = null; this.arrived = false; this.waitT = 0.4 + Math.random() * 1.6; }
        moveDir = this.arrived ? null : this.follow(this.goal, dt);
        if (!moveDir) this.arrived = true;
      }
      if (this.ammo < this.magSize * 0.5 && this.reloadT <= 0 && Math.random() < dt) I.pressed.KeyR = true;
    }

    // 和队友保持一点距离
    if (moveDir) for (const o of this.mgr.bots) {
      if (o === this || !o.alive || o.team !== this.team) continue;
      const d = o.feet(_d).sub(me).setY(0);
      const l = d.length();
      if (l < 1.3 && l > 0.01) moveDir.addScaledVector(d, -(1.3 - l) / l * 1.2);
    }

    // 卡住检测：想走却 1.2 秒没挪动多少 → 跳一下、重新找路
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      if (moveDir && this.stuckFrom && this.stuckFrom.distanceTo(me) < 0.5) { I.pressed.Space = true; this.path = null; if (this.state === 'roam') this.goal = null; }
      this.stuckFrom = me.clone(); this.stuckT = 0;
    }

    // 纸化闪避
    if (this.paperT > 0) { this.paperT -= dt; I.paper = true; }

    // 转向：交战时看目标，否则看前进方向
    if (!face && moveDir && moveDir.lengthSq() > 0.01) face = _c.copy(me).add(_d.copy(moveDir).setY(0).normalize().multiplyScalar(5)).add(_p1.set(0, 1.45, 0));
    if (face) {
      const want = this._dirTo(face);
      const turn = (T ? S.turn : 5) * dt;
      this.yaw += THREE.MathUtils.clamp(angDiff(this.yaw, want.yaw), -turn, turn);
      this.pitch += THREE.MathUtils.clamp(want.pitch - this.pitch, -turn, turn);
    }
    this.aimDir(_d);
    this._aimPt.copy(this.eye(_p1)).addScaledVector(_d, 30);

    // 把想走的方向换成 WASD
    if (moveDir && moveDir.lengthSq() > 0.01) {
      moveDir.setY(0).normalize();
      const f = Math.sin(this.yaw) * moveDir.x + Math.cos(this.yaw) * moveDir.z;
      const r = -Math.cos(this.yaw) * moveDir.x + Math.sin(this.yaw) * moveDir.z;
      if (f > 0.38) I.keys.KeyW = true; else if (f < -0.38) I.keys.KeyS = true;
      if (r > 0.38) I.keys.KeyD = true; else if (r < -0.38) I.keys.KeyA = true;
    }
  }

  _dirTo(p) {
    const e = this.eye(_p2);
    const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
    return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  }

  // 沿路径走向 goal：返回这一帧的移动方向；已经到了返回 null
  follow(goal, dt) {
    const me = this.feet(_p1);
    const flat = Math.hypot(goal.x - me.x, goal.z - me.z);
    if (flat < 1.2 && Math.abs(goal.y - me.y) < 1.5) return null;
    this.repathT -= dt;
    const moved = this.pathGoal && this.pathGoal.distanceToSquared(goal) > 9;
    const need = !this.path || !this.path.length || this.repathT <= 0 || (moved && this.repathT < 1.6);
    // 寻路比较贵：全队每帧最多算 2 次，轮不到的先沿旧路线（或直线）走，下一帧再算
    if (need && this.mgr.pathBudget > 0) {
      this.mgr.pathBudget--;
      this.path = this.mgr.nav.findPath(me, goal) || [goal.clone()];
      this.pathGoal = (this.pathGoal || new THREE.Vector3()).copy(goal);
      this.repathT = 2 + Math.random();
    } else if (!this.path || !this.path.length) this.path = [goal.clone()];
    let wp = this.path[0];
    while (wp && Math.hypot(wp.x - me.x, wp.z - me.z) < 0.9 && this.path.length > 1) { this.path.shift(); wp = this.path[0]; }
    if (!wp) return null;
    return new THREE.Vector3(wp.x - me.x, 0, wp.z - me.z);
  }

  // 视野检查：找最近的、看得见的敌人
  sense() {
    const eye = this.eye(new THREE.Vector3());
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let best = null, bestD = Infinity;
    for (const e of this.mgr.enemiesOf(this.team)) {
      if (!e.alive) continue;
      const tp = e.feet(_b).add(_c.set(0, 1.2, 0));
      const d = tp.distanceTo(eye);
      if (d > SIGHT) continue;
      const to = _d.copy(tp).sub(eye).setY(0).normalize();
      const inFov = to.dot(fwd) > 0.3 || d < 9 || e === this.hurtBy || e === this.target;
      if (!inFov) continue;
      if ((e.paperAmt || 0) > 0.5 && d > 14 && Math.random() < 0.6) continue; // 纸化的人远了不好发现
      if (!this.mgr.canSee(eye, tp, d)) continue;
      const score = d * (e === this.target ? 0.7 : 1);
      if (score < bestD) { bestD = score; best = e; }
    }
    const was = this.target;
    this.visible = !!best;
    if (best) {
      if (best !== was) {
        // 新目标：反应时间 + 初始瞄准误差（越远越大）
        this.reactT = this.skill.react * (0.75 + Math.random() * 0.5);
        const e0 = this.skill.err * (1 + best.feet(_b).distanceTo(eye) / 25);
        this.err.set((Math.random() - 0.5) * e0, (Math.random() - 0.5) * e0 * 0.6, (Math.random() - 0.5) * e0);
        this.aimHead = Math.random() < this.skill.head;
      }
      this.target = best;
      this.lastSeen = best.feet(new THREE.Vector3());
      this.lastSeenT = 0;
      this.state = 'search';
    } else if (was) {
      // 目标丢失：短时间内还盯着，之后去最后看到的位置找
      if (this.lastSeenT > 0.8) this.target = null;
    }
  }
}

function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

// ———— 联机：别的玩家（或房主那边的 AI）在本机的“替身” ————
// 不跑 AI 和物理，位置、朝向、动作状态都来自网络快照（平滑插值）；被本机打中时不在本地扣血，而是把伤害发给对方。
export class Puppet extends Bot {
  constructor(game, mgr, opts) {
    super(game, mgr, opts);
    this.netId = opts.netId;
    this.kind = opts.kind || 'player'; // player = 真人；bot = 房主的 AI
    this.net = opts.net;
    this.snap = null; this.snapT = 0;
    this._pos = new THREE.Vector3(); this._target = new THREE.Vector3();
    this.hasPos = false;
  }
  think() {}
  // 收到网络快照
  setState(s) {
    this.snap = s; this.snapT = performance.now();
    if (!this.hasPos) { this._pos.fromArray(s.p); this.hasPos = true; this.yaw = s.y; this.pitch = s.pt; this._place(); }
    const alive = !!(s.f & 2);
    if (alive && !this.alive) { super.spawn(this._pos.fromArray(s.p)); this.yaw = s.y; }
    else if (!alive && this.alive) { this.alive = false; this.anim?.die(); this.deadT = 99; }
    if (s.w != null && s.w !== this.wi && WEAPONS[s.w]) this._switch(s.w);
    // 动作事件：换弹 / 突进 / 受击（计数变了就播一次）
    if (s.e != null) {
      const prev = this._ev;
      this._ev = s.e;
      if (prev != null && this.alive) {
        const d = (k) => ((s.e >> k) & 255) !== ((prev >> k) & 255);
        const W = this.weapon.def;
        if (d(0)) {
          this.reloadT = W.reload; this._playReload(W);
          this._sounds = (W.sound?.reload || []).map(([t, n]) => ({ at: t * W.reload, key: `${W.id}/${n}`, vol: 0.7 })); this._soundT = 0;
        }
        if (d(8)) { this.anim?.dash(); this._sfx('jump', 0.6, 1.5); }
        if (d(16)) this.anim?.hurt();
      }
    }
  }
  async arm() { await super.arm(); if (this.gear) await this._switch(this.wi); }
  // 对方的配件选择（game.gear）：枪的数值、外形都按对方装的来
  setGear(at) {
    this.gear = at || {};
    this.weapons = WEAPONS.map((base) => { const def = applyAttachments(base, selFor(this.gear, base.id)); return { def, ammo: def.mag, holder: null }; });
    if (this.gun) this._switch(this.wi);
  }
  async _switch(i) {
    this.wi = i;
    const old = this.gun;
    const token = (this._swTok = (this._swTok || 0) + 1);
    const gun = await this.game.arsenal.instance(WEAPONS[i]).catch(() => null);
    if (!gun || token !== this._swTok || this.removed) return;
    const def = this.weapons[i]?.def;
    if (this.gear && def?.attach && Object.keys(def.attach).length) {
      await mountAttachments(gun, def, def.attach, { loader: this.game.arsenal.loader, gradient: this.game.arsenal.gradient }).catch((e) => console.warn('联机配件加载失败', e));
      if (token !== this._swTok || this.removed) return;
    }
    old?.removeFromParent();
    this.gun = gun; gun.userData.noMinimap = true; this.muzzleLocal = gun.userData.muzzle;
    this._ik = null;
    this.game.scene.add(gun);
  }
  _place() {
    const R = TUNING.player.radius, Hh = TUNING.player.height;
    this.capsule.start.set(this._pos.x, this._pos.y + R, this._pos.z);
    this.capsule.end.set(this._pos.x, this._pos.y + Hh - R, this._pos.z);
  }
  update(dt) {
    const s = this.snap;
    if (s) {
      // 按速度往前推一点（最多 0.15 秒），再平滑追过去
      const age = Math.min(0.15, (performance.now() - this.snapT) / 1000);
      this._target.set(s.p[0] + s.v[0] * age, s.p[1] + s.v[1] * age, s.p[2] + s.v[2] * age);
      const far = this._pos.distanceToSquared(this._target) > 16; // 差太远（复活、传送）直接跳过去
      if (far) this._pos.copy(this._target); else this._pos.lerp(this._target, 1 - Math.exp(-dt * 14));
      this._place();
      this.vel.fromArray(s.v);
      this.yaw += angDiff(this.yaw, s.y) * (1 - Math.exp(-dt * 18));
      this.pitch += (s.pt - this.pitch) * (1 - Math.exp(-dt * 18));
      this.onFloor = !!(s.f & 1);
      this.reloadT = Math.max(0, this.reloadT - dt);
      if (s.f & 4 && this.reloadT <= 0) this.reloadT = 0.1; // 换弹中（错过了事件也保持换弹状态）
      this.ads = s.a || 0;
      this.paperAmt = s.pp || 0;
      this._aimPt.copy(this.eye(_p1)).addScaledVector(this.aimDir(_d), 30);
    }
    this._dt = dt;
    this._updateSounds?.(dt);
    this._animate(dt, _a.set(0, 0, 0));
    this._updateCamera(dt);
    if (this.outline) this.outline.visible = this.alive;
  }
  // 本机打中替身：伤害发给对方（真人由对方自己扣血；AI 由房主扣血）
  damage(n, from, by, head) {
    if (!this.alive || !this.mgr.live) return false;
    const byId = by?.netId ?? null;
    if (this.kind === 'bot') this.net.send('game.hitbot', { bot: this.netId, dmg: n, head: !!head, by: byId });
    else this.net.send('game.hit', { to: this.netId, dmg: n, head: !!head, by: byId });
    return false; // 受击动作等对方的状态回来再播（对方真的被打中才会播）
  }
  // 远端开火：火光、枪声、弹道
  showFire(ends) {
    const game = this.game;
    const muzzle = this.muzzle(new THREE.Vector3());
    const near = muzzle.distanceToSquared(game.camera.position) < 60 * 60;
    const W = this.weapon.def;
    if (near) game.fx.muzzle(muzzle, game.camera, W.flash ?? 0.9, this.muzzleAnchor());
    this._sfx(`${W.id}/shot`, W.sound.vol * 1.1, 0.97 + Math.random() * 0.06);
    this.anim?.shoot();
    if (near) for (const e of ends || []) game.fx.tracer(muzzle, _b.fromArray(e).clone());
  }
}

// ———— 两队管理 + 一局比赛 ————
export class Squads {
  constructor(game, map, opts = {}) {
    this.game = game;
    this.map = map;
    this.bots = [];
    this.list = this.bots; // 兼容训练场靶子的接口名
    this.score = { ally: 0, enemy: 0 };
    this.target = opts.target || 30;
    this.duration = opts.duration || 360;
    this.timeLeft = this.duration;
    this.phase = 'warmup';
    this.warmT = 4;
    this.live = false;
    this.events = [];
    this.nav = new NavGrid(game, game.worldBox, 1);
  }

  // 联机：我在 B 队时，地图上两边的出生点、基地对调（“我方”永远叫 ally）
  flipSides() { const t = this.map.teams; this.map = { ...this.map, teams: { ally: t.enemy, enemy: t.ally } }; }
  // 移除一个角色（联机时真人顶替 AI、玩家离开房间）
  removeBot(b) {
    const i = this.bots.indexOf(b);
    if (i >= 0) this.bots.splice(i, 1);
    b.pivot.removeFromParent();
    b.gun?.removeFromParent();
    b.removed = true;
  }

  get allies() { return this.bots.filter((b) => b.team === 'ally'); }
  get enemies() { return this.bots.filter((b) => b.team === 'enemy'); }
  enemiesOf(team) { return team === 'ally' ? this.enemies : [...this.allies, this.game.player]; }
  teamYaw(team) { return this.map.teams[team].yaw; }
  home(team) { return this.map.teams[team].home; }
  spawnPoint(team) {
    const list = this.map.teams[team].spawns;
    // 选离敌人最远的出生点
    let best = list[0], bd = -1;
    for (const p of list) {
      let dmin = Infinity;
      for (const e of this.enemiesOf(team)) if (e.alive) dmin = Math.min(dmin, e.feet(_a).distanceTo(p));
      dmin += Math.random() * 3;
      if (dmin > bd) { bd = dmin; best = p; }
    }
    return best.clone();
  }

  // 巡逻目标：大多去中间的争夺点，偶尔推进到对方半场
  pickGoal(bot) {
    const H = this.map.hotspots;
    const side = bot.team === 'ally' ? 1 : -1;
    const pool = H.filter((p) => p.z * side > -12);
    const p = pool[Math.floor(Math.random() * pool.length)] || H[0];
    return p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
  }

  canSee(from, to, dist) {
    const dir = _p1.copy(to).sub(from).normalize();
    const hit = this.game.raycastWorld(from, dir, dist);
    return !hit || hit.distance > dist - 0.4;
  }

  async spawnTeams(loader, characters, animData, playerChar, onProgress) {
    const pool = characters.filter((c) => c !== playerChar);
    const list = [...pool, ...pool, ...pool];
    const skillFor = (team, i) => ({
      react: team === 'enemy' ? 0.42 : 0.38, err: 1.0, focus: 2.2 + Math.random(), turn: 4.5 + Math.random() * 1.5,
      head: 0.15 + Math.random() * 0.15, tap: 0.08 + Math.random() * 0.1, i,
    });
    const defs = [];
    NAMES.ally.forEach((n, i) => defs.push({ team: 'ally', name: n, i }));
    NAMES.enemy.forEach((n, i) => defs.push({ team: 'enemy', name: n, i }));
    let done = 0;
    // 一个一个解析，避免同时解析很多大文件卡住浏览器
    for (let k = 0; k < defs.length; k++) {
      const d = defs[k];
      const ch = list[k % list.length];
      const bot = new Bot(this.game, this, { team: d.team, name: d.name, charName: ch.name, weaponId: BOT_WEAPONS[k % BOT_WEAPONS.length], skill: skillFor(d.team, d.i) });
      bot.charId = ch.id;
      const vrm = await loadBotVRM(loader, ch.file);
      bot.setModel(vrm, animData);
      await bot.arm();
      bot.spawn(this.map.teams[d.team].spawns[d.i % this.map.teams[d.team].spawns.length]);
      this.bots.push(bot);
      onProgress?.(++done / defs.length);
    }
  }

  // ———— 和 Dummies 一样的接口：玩家开枪 / 爆炸打敌方 ————
  raycast(ray, maxDist) {
    let best = null;
    for (const b of this.enemies) {
      const h = hitCharacter(ray, b, maxDist);
      if (h && (!best || h.distance < best.distance)) best = { dummy: b, ...h };
    }
    return best;
  }
  damage(bot, amount, point, head) {
    if (!bot.alive) return false;
    this.game.hud.damageNumber(point, amount, head);
    return bot.damage(amount, this.game.player.feet(new THREE.Vector3()), this.game.player, head);
  }
  explode(pos, radius, dmg) {
    let hits = 0;
    for (const b of this.enemies) {
      if (!b.alive) continue;
      const p = b.feet(_a).add(_b.set(0, 0.9, 0));
      const d = p.distanceTo(pos);
      if (d < radius) { this.damage(b, dmg * (1 - (d / radius) * 0.6), p.clone(), false); hits++; }
    }
    if (hits) this.game.hud.hit(false, false);
  }
  nearPoint(pos, r) {
    for (const b of this.enemies) {
      if (!b.alive) continue;
      const p = b.feet(_a).add(_b.set(0, 0.9, 0));
      if (Math.abs(p.x - pos.x) < r && Math.abs(p.z - pos.z) < r && Math.abs(p.y - pos.y) < 1) return b;
    }
    return null;
  }

  // AI 开枪：从眼睛沿瞄准方向打射线（带散布），先撞墙还是先打到人
  botShoot(bot) {
    const W = bot.weapon.def, game = this.game;
    const origin = bot.eye(new THREE.Vector3());
    const aim = bot.aimDir(new THREE.Vector3());
    const muzzle = bot.muzzle(new THREE.Vector3());
    const near = muzzle.distanceToSquared(game.camera.position) < 60 * 60;
    if (near) game.fx.muzzle(muzzle, game.camera, 0.9, bot.muzzleAnchor());
    bot._sfx(`${W.id}/shot`, W.sound.vol * 1.1, 0.97 + Math.random() * 0.06);
    bot.anim?.shoot();
    const pellets = W.pellets || 1;
    const spread = W.spread * (bot.input.aim ? 1 : adsOf(W).hip) * 1.15 + bot.bloom;
    const range = TUNING.gun.range;
    const targets = this.enemiesOf(bot.team);
    const ends = [];
    for (let i = 0; i < pellets; i++) {
      const dir = aim.clone();
      dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
      _ray.set(origin, dir);
      const wh = game.raycastWorld(origin, dir, range);
      let maxD = wh ? wh.distance : range, hit = null, who = null;
      for (const t of targets) {
        const h = hitCharacter(_ray, t, maxD);
        if (h) { hit = h; who = t; maxD = h.distance; }
      }
      const end = hit ? hit.point : wh ? wh.position : origin.clone().addScaledVector(dir, range);
      if (i < 3) ends.push(end);
      if (i < 3 && near) game.fx.tracer(muzzle, end);
      if (hit) {
        const fall = pellets > 1 ? THREE.MathUtils.clamp(1.3 - hit.distance / 22, 0.25, 1) : 1;
        const dmg = W.damage * fall * (hit.head ? W.headMul : 1) * BOT_DMG;
        if (who === game.player) who.damage(dmg, origin, bot);
        else { who.damage(dmg, origin, bot, hit.head); if (near) game.fx.hitBurst(end, game.camera, dir, hit.head, pellets > 1); }
      } else if (wh && near && i === 0) game.fx.impact(end, game.camera);
    }
    this.mp?.botFired(bot, ends); // 联机：房主的 AI 开枪，告诉其他人画出来
  }

  // 击杀：计分、击杀播报
  onKill(killer, victim, head) {
    if (!this.live) return;
    const team = killer ? (killer === this.game.player ? 'ally' : killer.team) : null;
    if (team) this.score[team]++;
    if (killer && killer !== this.game.player) killer.kills++;
    // AI 偶尔发个表情：击杀后嘲讽 / 叫好，被击杀的喊一句
    const em = this.game.emotes;
    if (em) {
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      if (killer && killer !== this.game.player && Math.random() < 0.3) setTimeout(() => killer.alive !== false && em.show(killer, pick(['thatsit', 'taunt', 'nice'])), 350);
      else if (victim && victim !== this.game.player && Math.random() < 0.15) em.show(victim, pick(['mybad', 'mercy', 'help']));
    }
    this.game.hud.killEvent?.({ killer, victim, head, def: killer?.weapon?.def, player: this.game.player });
    this.mp?.botKilled(killer, victim, head); // 联机：房主这边的 AI 被打倒，通知其他人
    if (killer === this.game.player) this.game.onKill(head, victim);
    if (this.score.ally >= this.target || this.score.enemy >= this.target) this.finish();
  }
  // 玩家被打倒（由 Player.damage 调用）
  onPlayerDeath(by) {
    this.onKill(by, this.game.player, false);
  }

  // force：联机时由房主宣布结束（其他人自己不结束，免得比分差一点就各说各的）
  finish(force = false) {
    if (this.phase === 'end') return;
    if (this.mp && !this.mp.isHost && !force) return;
    this.mp?.matchEnded();
    this.phase = 'end';
    this.live = false;
    this.game.onMatchEnd?.(this.score.ally > this.score.enemy ? 'win' : this.score.ally < this.score.enemy ? 'lose' : 'draw');
  }

  update(dt) {
    if (this.phase === 'warmup') {
      this.warmT -= dt;
      if (this.warmT <= 0) { this.phase = 'live'; this.live = true; this.game.hud.feed('战斗开始！先拿到 ' + this.target + ' 击杀的队伍获胜', 'good'); }
    } else if (this.phase === 'live') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.finish(); }
    }
    this.pathBudget = 2;
    for (const b of this.bots) b.update(dt);
    // 敌人是否在玩家视野里（用来显示敌人头顶的红色标记），每 0.2 秒检查一次
    this._visT = (this._visT || 0) - dt;
    if (this._visT <= 0) {
      this._visT = 0.2;
      const eye = this.game.camera.position;
      for (const b of this.enemies) {
        if (!b.alive) { b.spotted = false; continue; }
        const p = b.feet(_a).add(_b.set(0, 1.3, 0));
        const d = p.distanceTo(eye);
        b.spotted = d < 70 && this.canSee(eye, p, d);
      }
    }
  }
}
