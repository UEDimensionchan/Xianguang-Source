import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { TUNING } from './config.js';
import { CharacterAnimator } from './anim.js';
import { WEAPONS } from './weapons.js';
import { applyAttachments, selFor, mountAttachments } from './attachments.js';
import { registerCharacter, unregisterCharacter } from './charlight.js';
import { solveArm, orientHand, wristForContact, curlFingers, CURL_RIGHT, CURL_LEFT, mixCurl } from './ik.js';
import { tameSprings } from './springs.js';


const P = TUNING.player;
const PAPER = TUNING.paper;

const UP = new THREE.Vector3(0, 1, 0);
// 枪相对默认握持位置往角色右边挪多少（米）
const HOLD_RIGHT = { pistol: 0.1, rifle: -0.02, launcher: 0.04 };
// 手枪握把离胸口往前伸多远（米）
const PISTOL_REACH = 0.36;
// 长枪模型缩小一点，角色手臂不用伸得笔直（手枪、火箭筒保持原样）
export const GUN_SCALE = { pistol: 1, rifle: 0.85, launcher: 1 };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
// 瞄准：移动速度倍率；各武器的镜头放大倍数 zoom、腰射散布倍数 hip（瞄准时散布 = spread，腰射 = spread × hip）、开镜速度
const ADS_SPEED = 0.5;
const ADS_DEFAULT = { zoom: 1.3, hip: 1.6, speed: 12 };
export function adsOf(def) { return { ...ADS_DEFAULT, ...(def.ads || {}) }; }
const STEP_UP = 0.45;   // 能直接走上去的台阶高度（米）；地图里楼梯每级约 0.35
const SNAP_DOWN = 0.4;  // 下坡、下台阶时最多往下贴地多少
// 镜头遮挡检测的射线偏移（米）：中心 + 上下左右
const CAM_PROBES = [[0, 0], [0.18, 0], [-0.18, 0], [0, 0.14], [0, -0.14]];
// 平滑趋近：变小用 down 速率，变大用 up 速率
function smoothTo(cur, target, dt, down, up) {
  return cur + (target - cur) * Math.min(1, dt * (target < cur ? down : up));
}

export class Player {
  constructor(game) {
    this.game = game;
    this.capsule = new Capsule(new THREE.Vector3(0, P.radius, 0), new THREE.Vector3(0, P.height - P.radius, 0), P.radius);
    this.vel = new THREE.Vector3();
    this.onFloor = false;
    this.stepOffset = 0;
    this.stepOffsetH = new THREE.Vector3(); // 上台阶时往前多挪的那一点，模型和镜头平滑跟上
    this.yaw = 0;
    this.pitch = 0;

    this.maxHp = P.maxHp;
    this.hp = P.maxHp;
    this.alive = true;
    this.regenT = 0;
    this.deadT = 0;

    // 武器：每把枪单独记弹药
    // 玩家的枪按大厅里选的配件改数值（AI 用原版数值）
    const sel = this.isPlayer ? (game.attachSel || {}) : {};
    this.weapons = WEAPONS.map((base) => { const def = this.isPlayer ? applyAttachments(base, selFor(sel, base.id)) : base; return { def, ammo: def.mag, holder: null }; });
    this.wi = 0;
    this.switchT = 0;
    this.reloadT = 0;
    this.fireCd = 0;
    this.bloom = 0;

    this.energyMax = PAPER.energyMax;
    this.energy = PAPER.energyMax;
    this.paperAmt = 0;
    this.ads = 0;       // 瞄准程度 0–1
    this.scoped = false; // 狙击镜打开中
    this.firstPerson = false; // V 切换第一人称
    try { this.firstPerson = localStorage.getItem('paper_fp') === '1'; } catch (e) { /* 忽略 */ }
    this.paperLock = false; // 能量耗尽后要松开按键才能再次纸化

    this.dashCdMax = TUNING.dash.cooldown;
    this.dashCd = 0;
    this.dashT = 0;
    this.bombCdMax = TUNING.bomb.cooldown;
    this.bombCd = 0;

    this.pivot = new THREE.Group(); // 脚底位置，绕 Y 转向
    game.scene.add(this.pivot);
    this.vrm = null;
    this.gun = null;
    this.phase = 0;
    this.stepT = 0;
    this.wasOnFloor = true;
    this.aimPoint = new THREE.Vector3();
  }

  setModel(vrm, animData) {
    if (this.vrm) { this.pivot.remove(this.vrm.scene); unregisterCharacter(this.vrm.scene); }
    this.vrm = vrm;
    registerCharacter(vrm.scene);
    this.isVRM0 = vrm.meta?.metaVersion === '0';
    tameSprings(vrm);
    this.pivot.add(vrm.scene);
    // 第一人称手臂：趁模型还是静止姿势时复制一份
    try { this.game.viewmodel?.setCharacter(vrm); } catch (e) { console.warn('第一人称手臂创建失败', e); }
    // VRM 自带第一人称标注：把头、头发放进“只在第三人称显示”的图层，第一人称时镜头看不到自己的脸和头发
    try { vrm.firstPerson?.setup(); } catch (e) { console.warn('VRM 第一人称设置失败', e); }
    // 头上的配件（发卡、耳坠、内层发色）同样只在第三人称显示
    const tpl = vrm.firstPerson?.thirdPersonOnlyLayer;
    if (tpl != null) vrm.scene.traverse((o) => { if (o.userData.fpHide) o.layers.set(tpl); });
    this._eye = null;
    this.bones = {};
    for (const n of ['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
      'leftFoot', 'rightFoot', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
      'leftShoulder', 'rightShoulder']) {
      this.bones[n] = vrm.humanoid.getNormalizedBoneNode(n);
    }
    this.hipsRestY = this.bones.hips.position.y; // 髋部原始高度，走路起伏要在这个基础上加
    // 头的高度（各模型身高不同）：越肩镜头和开火起点都按它算
    vrm.scene.updateMatrixWorld(true);
    const hy = vrm.humanoid.getRawBoneNode('head').getWorldPosition(new THREE.Vector3()).y - vrm.scene.getWorldPosition(new THREE.Vector3()).y;
    this.headH = THREE.MathUtils.clamp(hy, 0.8, 1.9);
    this.rawRightHand = vrm.humanoid.getRawBoneNode('rightHand');
    this.rawLeftHand = vrm.humanoid.getRawBoneNode('leftHand');
    // 有动作数据就用正式动作，没有就退回代码驱动的简易动画
    this.anim = animData ? new CharacterAnimator(vrm, animData) : null;
  }

  // ———— 以下几个方法是给 AI 角色（bots.js）覆盖用的 ————
  get isPlayer() { return true; }
  _sfx(key, vol = 1, rate = 1) { this.game.sfx.play(key, vol, rate); }
  respawnPoint() { return this.game.playerSpawn ? this.game.playerSpawn() : this.game.randomSpawn(0, 12, true); }
  fireWeapon() { this.game.shoot(); }
  aimTarget() { return this.game.crosshairPoint; }
  _vrmUpdate(dt) { this.vrm.update(dt); }

  // 延迟播放一个音效（开火后的拉栓、泵动等）
  queueSound(delay, key, vol = 0.7) {
    (this._sounds || (this._sounds = [])).push({ at: (this._soundT || 0) + delay, key, vol });
  }

  _updateSounds(dt) {
    if (!this._sounds?.length) { this._soundT = 0; return; }
    this._soundT = (this._soundT || 0) + dt;
    for (let i = this._sounds.length - 1; i >= 0; i--) {
      const s = this._sounds[i];
      if (this._soundT >= s.at) { this._sfx(s.key, s.vol); this._sounds.splice(i, 1); }
    }
  }

  get weapon() { return this.weapons[this.wi]; }
  get magSize() { return this.weapon.def.mag; }
  get ammo() { return this.weapon.ammo; }
  set ammo(v) { this.weapon.ammo = v; }

  // 切换武器；模型没加载完就先加载，加载好了再换上
  async equip(i) {
    if (i === this.wi && this.gun) return;
    const slot = this.weapons[i];
    this.gun?.userData.reloadAction?.stop();
    this.wi = i;
    this.reloadT = 0;
    this.switchT = 0.35;
    this.ads = 0;
    this.fireCd = 0.3; // 掏枪时间，不继承上一把枪的射击间隔
    this._sfx('switch', 0.5);
    this._sounds = [];
    this.game.hud.weapon(slot.def, i);
    if (!slot.holder) {
      slot.holder = await this.game.arsenal.load(slot.def);
      if (this.isPlayer && slot.def.attach) await mountAttachments(slot.holder, slot.def, slot.def.attach, { loader: this.game.arsenal.loader, gradient: this.game.arsenal.gradient });
    }
    if (this.wi !== i) return; // 加载期间又换了别的
    if (this.gun) this.game.scene.remove(this.gun);
    this.gun = slot.holder;
    this.muzzleLocal = slot.holder.userData.muzzle;
    this.game.scene.add(this.gun);
  }

  spawn(pos) {
    this.capsule.start.set(pos.x, pos.y + P.radius, pos.z);
    this.capsule.end.set(pos.x, pos.y + P.height - P.radius, pos.z);
    this.vel.set(0, 0, 0);
    this.stepOffset = 0; this.stepOffsetH.set(0, 0, 0); this.moveDebt = 0;
    this.hp = this.maxHp;
    this.alive = true;
    for (const w of this.weapons) w.ammo = w.def.mag;
    this.reloadT = 0;
    this._dropAim();
    this.energy = this.energyMax;
    this.pivot.visible = true;
    if (this.gun) this.gun.visible = true;
    this.vrm?.springBoneManager?.reset();
    this.anim?.revive();
  }

  // 换弹动作：枪自己有换弹动画就播枪的（左手跟着走），没有就播角色的换弹动作
  _playReload(W) {
    const ra = this.gun?.userData.reloadAction;
    if (ra) { ra.reset(); ra.timeScale = ra.getClip().duration / W.reload; ra.play(); }
    else this.anim?.reload(W.reload);
  }
  // 联机同步用：换弹 / 突进 / 受击 三种动作各自的次数，打包成一个数
  get evPack() { return ((this.evReload || 0) & 255) | (((this.evDash || 0) & 255) << 8) | (((this.evHurt || 0) & 255) << 16); }

  // 退出瞄准 / 狙击镜，清掉后坐力和没打出去的预输入
  _dropAim() {
    this.ads = 0;
    this.scoped = false;
    this.fireBuf = 0;
    this.recoilPitch = 0; this.recoilYaw = 0;
  }

  // 当前散布（弧度级）：腰射 = spread × hip，瞄准时收到 spread，再加上连射的扩散
  spread() {
    const W = this.weapon.def, AD = adsOf(W);
    return W.spread * THREE.MathUtils.lerp(AD.hip, 1, this.ads) + this.bloom * (1 - 0.4 * this.ads);
  }

  feet(out) { return out.copy(this.capsule.start).sub(_v2.set(0, P.radius, 0)); }
  chestPosition(out) { return this.feet(out).add(_v2.set(0, 1.15, 0)); }

  aimDir(out) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.2, 1.25);
  }

  // 纸飞机命中判定：在角色本地坐标里比较，纸化时左右只剩一条线
  hitTest(worldPos, r) {
    _m.copy(this.pivot.matrixWorld).invert();
    _v.copy(worldPos).applyMatrix4(_m);
    const hw = THREE.MathUtils.lerp(0.28, PAPER.hitHalfWidth, this.paperAmt) + r;
    return Math.abs(_v.x) < hw && _v.y > 0.1 && _v.y < 1.65 && Math.abs(_v.z) < 0.18 + r;
  }

  // from = 攻击来源的位置（世界坐标），用来显示受击方向
  damage(n, from, by) {
    if (!this.alive) return;
    this.hp -= n;
    this.regenT = P.regenDelay;
    this.game.hud.hurt(from);
    this._sfx('hurt', 0.6);
    this.anim?.hurt();
    this.evHurt = (this.evHurt || 0) + 1; // 联机：动作事件计数，别人那边照着播
    if (this.hp <= 0) {
      this.alive = false;
      this._dropAim(); // 开着镜被击倒：立刻关镜（不然死亡这几秒画面一直停在镜子里，也开不了火）
      this.anim?.die();
      this.deadT = this.game.respawnTime || 2.5;
      if (this.game.stats) this.game.stats.deaths++;
      this.game.hud.feed(by ? `你被「${by.name}」击倒了，${this.deadT} 秒后复活` : `你被纸飞机击倒了，${this.deadT} 秒后复活`, 'bad');
      this.game.onPlayerDeath?.(by);
    }
  }

  update(dt, input) {
    this._dt = dt;
    if (!this.alive) {
      if (this.scoped || this.ads) this._dropAim();
      this.deadT -= dt;
      if (!this.anim) this.pivot.rotation.x = Math.min(Math.PI / 2, this.pivot.rotation.x + dt * 5);
      else this._animate(dt, new THREE.Vector3());
      if (this.deadT <= 0) {
        this.pivot.rotation.x = 0;
        this.spawn(this.respawnPoint());
      }
      this._updateCamera(dt);
      return;
    }

    // —— 纸化 ——
    if (!input.paper) this.paperLock = false;
    const wantPaper = input.paper && !this.paperLock && this.energy > 0 && this.reloadT <= 0;
    if (wantPaper) {
      this.energy = Math.max(0, this.energy - PAPER.drain * dt);
      if (this.energy <= 0) this.paperLock = true;
    } else {
      this.energy = Math.min(this.energyMax, this.energy + PAPER.regen * dt);
    }
    const before = this.paperAmt;
    this.paperAmt += ((wantPaper ? 1 : 0) - this.paperAmt) * Math.min(1, dt * 14);
    if (before < 0.5 && this.paperAmt >= 0.5) this._sfx('paper', 0.55, 0.95 + Math.random() * 0.1);
    if (before >= 0.5 && this.paperAmt < 0.5) this._sfx('unpaper', 0.45);

    if (input.pressed.KeyV) {
      this.firstPerson = !this.firstPerson;
      try { localStorage.setItem('paper_fp', this.firstPerson ? '1' : '0'); } catch (e) { /* 无痕模式等情况读写不了，忽略 */ }
      this.game.hud.feed(this.firstPerson ? '第一人称（V 切回第三人称）' : '第三人称');
    }

    // —— 瞄准（按住右键）：移动变慢、散布变小、镜头拉近；狙击枪开 3 倍镜 ——
    const AD = adsOf(this.weapon.def);
    const wantAds = input.aim && !wantPaper && this.paperAmt < 0.3 && this.reloadT <= 0 && this.switchT <= 0 && this.dashT <= 0 && !!this.gun;
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * (wantAds ? AD.speed : 16));
    if (this.ads < 0.001) this.ads = 0;
    const scoped = !!AD.scope && wantAds && this.ads > 0.9;
    if (scoped && !this.scoped) this._sfx('switch', 0.3, 1.7);
    this.scoped = scoped;

    // —— 移动 ——
    const fwd = _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = _v2.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (input.keys.KeyW) wish.add(fwd);
    if (input.keys.KeyS) wish.sub(fwd);
    if (input.keys.KeyD) wish.add(right);
    if (input.keys.KeyA) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();

    // —— 冲刺跑：按住 Shift 往前跑，消耗体力；体力耗尽、开镜、射击、纸化时不能跑 ——
    const ST = P.stamina;
    if (this.stamina == null) { this.stamina = ST.max; this.staminaT = 0; this.sprintAmt = 0; }
    const forward = wish.lengthSq() > 0 && wish.dot(_v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))) > 0.5;
    const wantSprint = !!input.keys.ShiftLeft && forward && !input.aim && this.ads < 0.15 && !input.fire && this.paperAmt < 0.2 && this.reloadT <= 0 && this.alive;
    if (this.stamina <= 0) this.tired = true;
    if (this.tired && this.stamina >= ST.resume) this.tired = false;
    const moving = (this.realSpeed ?? 0) > 1.2; // 顶着墙原地跑不算，不扣体力
    this.sprinting = wantSprint && !this.tired && moving && (this.onFloor || this.sprinting);
    if (this.sprinting) { this.stamina = Math.max(0, this.stamina - ST.drain * dt); this.staminaT = ST.delay; }
    else if (input.keys.ShiftLeft) this.staminaT = ST.delay; // 还按着奔跑键（比如体力耗尽了还想跑）：不恢复，松开后才慢慢恢复
    else if ((this.staminaT -= dt) <= 0) this.stamina = Math.min(ST.max, this.stamina + ST.regen * dt);
    this.sprintAmt += ((this.sprinting ? 1 : 0) - this.sprintAmt) * Math.min(1, dt * (this.sprinting ? 5 : 8));
    const speedMul = THREE.MathUtils.lerp(1, PAPER.speedMul, this.paperAmt) * THREE.MathUtils.lerp(1, ADS_SPEED, this.ads) * THREE.MathUtils.lerp(1, P.sprintMul, this.sprintAmt);
    const accel = (this.onFloor ? P.walkAccel : P.airAccel) * speedMul;
    this.vel.addScaledVector(wish, accel * dt);

    if (this.onFloor && input.pressed.Space) {
      this.vel.y = P.jumpSpeed;
      this._sfx('jump', 0.5);
    }

    // E 纸鹤突进
    this.dashCd = Math.max(0, this.dashCd - dt);
    if (input.pressed.KeyE && this.dashCd <= 0) {
      const dir = wish.lengthSq() > 0 ? wish.clone() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.vel.x = dir.x * TUNING.dash.speed;
      this.vel.z = dir.z * TUNING.dash.speed;
      this.vel.y = Math.max(this.vel.y, 3);
      this.dashCd = this.dashCdMax;
      this.dashT = 0.25;
      this._sfx('jump', 0.6, 1.5);
      if (this.isPlayer) this.game.fovKick = 10;
      this.anim?.dash();
      this.evDash = (this.evDash || 0) + 1;
    }
    this.dashT = Math.max(0, this.dashT - dt);

    // Q 墨水炸弹
    this.bombCd = Math.max(0, this.bombCd - dt);
    if (input.pressed.KeyQ && this.bombCd <= 0 && this.paperAmt < 0.5) {
      const dir = this.aimDir(new THREE.Vector3());
      const from = this.shoulder(new THREE.Vector3()).addScaledVector(dir, 0.8);
      const vel = dir.multiplyScalar(TUNING.bomb.speed).add(new THREE.Vector3(0, 4, 0));
      this.game.fx.throwBomb(from, vel);
      this.bombCd = this.bombCdMax;
      this._sfx('switch', 0.6, 0.75);
    }

    // 物理（分步，防穿墙）
    const px0 = this.capsule.start.x, pz0 = this.capsule.start.z;
    const steps = 4;
    const sdt = dt / steps;
    let grounded = false;
    for (let i = 0; i < steps; i++) { this._physics(sdt); grounded = grounded || this.onFloor; }
    if (!grounded && this.wasOnFloor && this.vel.y <= 0.1 && this.dashT <= 0) grounded = this._snapGround();
    this.onFloor = grounded; // 任意一个物理子步踩到地面就算着地，避免着地状态每帧闪烁
    if (grounded && this.vel.y < 0) this.vel.y = 0;
    this.stepOffset *= Math.exp(-dt * 12);
    if (Math.abs(this.stepOffset) < 1e-4) this.stepOffset = 0;
    this.stepOffsetH.multiplyScalar(Math.exp(-dt * 16));
    this.realSpeed = dt > 0 ? Math.hypot(this.capsule.start.x - px0, this.capsule.start.z - pz0) / dt : 0; // 这一帧实际走了多快

    if (this.onFloor && !this.wasOnFloor && this.vel.y > -1) this._sfx('land', 0.45);
    this.wasOnFloor = this.onFloor;

    if (this.capsule.end.y < -30) this.spawn(this.respawnPoint());

    // 回血
    this.regenT -= dt;
    if (this.regenT <= 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + P.regenRate * dt);

    // —— 射击 ——
    this.fireCd -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.ammo = this.magSize;
    }
    // 切枪：1–8 或滚轮
    for (let i = 0; i < this.weapons.length; i++) if (input.pressed['Digit' + (i + 1)]) this.equip(i);
    if (input.wheel) { this.equip((this.wi + (input.wheel > 0 ? 1 : -1) + this.weapons.length) % this.weapons.length); input.wheel = 0; }
    this.switchT = Math.max(0, this.switchT - dt);
    this._updateSounds(dt);
    const W = this.weapon.def;

    if ((input.pressed.KeyR && this.ammo < this.magSize || this.ammo === 0) && this.reloadT <= 0 && this.paperAmt < 0.5) {
      this.reloadT = W.reload;
      const ra = this.gun?.userData.reloadAction;
      this._playReload(W);
      this.evReload = (this.evReload || 0) + 1;
      // 换弹分段音效：按换弹进度触发，和枪的换弹动画对齐
      this._sounds = (W.sound?.reload || []).map(([t, n]) => ({ at: t * W.reload, key: `${W.id}/${n}`, vol: 0.7 }));
      this._soundT = 0;
    }
    if (input.firePressed && this.reloadT > 0 && this.paperAmt < 0.25) this._sfx('dryFire', 0.5);
    // 单发武器（狙击、霰弹、手枪）的预输入：射击间隔快结束时提前点的那一下记住 0.2 秒，
    // 冷却一好就打出去，不会因为点早了几帧被吞掉、看起来像“开不了火”
    if (!W.auto) {
      if (input.firePressed) this.fireBuf = 0.2;
      else this.fireBuf = Math.max(0, (this.fireBuf || 0) - dt);
    }
    const trigger = W.auto ? input.fire : this.fireBuf > 0;
    if (trigger && this.fireCd <= 0 && this.ammo > 0 && this.reloadT <= 0 && this.paperAmt < 0.25 && this.gun) {
      this.fireCd = 1 / W.rate;
      this.fireBuf = 0;
      this.ammo--;
      this.fireWeapon();
      this.anim?.shoot();
      this.bloom = Math.min(0.06, this.bloom + W.recoil * 0.5 * (1 - 0.4 * this.ads));
      // 后坐力分摊到接下来约 0.07 秒里平滑地抬枪口，不是一帧瞬间跳上去
      this.recoilPitch = (this.recoilPitch || 0) + W.recoil;
      this.recoilYaw = (this.recoilYaw || 0) + (Math.random() - 0.5) * W.recoil * 0.6;
      this.kick = Math.min(1.5, (this.kick || 0) + 1);
    }
    this.kick = Math.max(0, (this.kick || 0) - dt * 14);
    if (this.recoilPitch || this.recoilYaw) {
      const k = Math.min(1, dt * 15);
      const dp = this.recoilPitch * k, dy = this.recoilYaw * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dp, -1.2, 1.25);
      this.yaw += dy;
      this.recoilPitch -= dp; this.recoilYaw -= dy;
      if (Math.abs(this.recoilPitch) < 1e-4) this.recoilPitch = 0;
      if (Math.abs(this.recoilYaw) < 1e-4) this.recoilYaw = 0;
    }

    this._animate(dt, wish);
    this._updateCamera(dt);
  }

  _physics(dt) {
    let damping = Math.exp(-6 * dt) - 1;
    if (!this.onFloor) {
      this.vel.y -= TUNING.gravity * dt;
      damping *= 0.1;
    }
    if (this.dashT > 0) damping *= 0.2;
    this.vel.addScaledVector(new THREE.Vector3(this.vel.x, 0, this.vel.z), damping);

    const wasFloor = this.onFloor;
    const cap = this.capsule;
    const s0 = cap.start.clone(), e0 = cap.end.clone();
    const move = _v.copy(this.vel).multiplyScalar(dt);
    // 上台阶时多走的距离，在接下来几步里扣回来，楼梯上不会忽快忽慢
    if (this.moveDebt > 0) {
      const hm = Math.hypot(move.x, move.z);
      if (hm > 1e-6) { const take = Math.min(this.moveDebt, hm * 0.6); move.x *= (hm - take) / hm; move.z *= (hm - take) / hm; this.moveDebt -= take; }
    }
    cap.translate(move);
    const res = this._resolve();
    this.onFloor = res.floor;
    if (res.wall && !res.floor) this.vel.addScaledVector(res.wall, -res.wall.dot(this.vel));
    if (res.floor && this.vel.y < 0) this.vel.y = 0;
    // 下坡：每个物理子步都贴地（最多按 50° 坡算），不然会离地“飘”下去，没有地面阻力越跑越快
    if (!res.floor && wasFloor && this.vel.y <= 0.1 && this.dashT <= 0) {
      const hm = Math.hypot(move.x, move.z), d = Math.max(0.03, hm * 1.25);
      const a = cap.start.clone(), b = cap.end.clone();
      cap.translate(_v3.set(0, -d, 0));
      // 只接受“正下方踩到地”：如果是蹭到台阶边被横着推开，就不算（不然下楼梯时会被弹出去一截）
      if (this._resolve().floor && Math.hypot(cap.start.x - a.x, cap.start.z - a.z) < 0.01) { this.onFloor = true; this.vel.y = 0; return; }
      cap.start.copy(a); cap.end.copy(b);
    }

    // 上台阶：站在地上往前走被竖直面挡住时，先抬高一个台阶再往前、再落下去
    if (wasFloor && res.wall && this.vel.y <= 0.5) {
      const r1 = cap.start.clone(), r2 = cap.end.clone();
      cap.start.copy(s0); cap.end.copy(e0);
      // 往前探的距离至少 0.2 米：只挪几厘米的话会落在台阶边角上，又被斜着推回来，卡在台阶前
      const h = _v2.set(move.x, 0, move.z);
      if (h.lengthSq() < 1e-6) h.set(-res.wall.x, 0, -res.wall.z);
      if (h.lengthSq() > 1e-8) h.setLength(Math.max(h.length(), 0.2));
      if (h.lengthSq() > 1e-8) {
        // 往上抬得比台阶高一些：楼梯的下一级立面不会挡住往前探
        const lift = STEP_UP + 0.3;
        cap.translate(_v3.set(0, lift, 0));
        const up = this._resolve();
        cap.translate(h);
        const fwd = this._resolve();
        // 分几小步往下落：一次落太深会陷进台阶，碰撞把胶囊横着推回去
        let down = { floor: false };
        for (let k = 0; k < 8 && !down.floor; k++) {
          cap.translate(_v3.set(0, -(lift + 0.05) / 8, 0));
          down = this._resolve();
        }
        const rise = cap.start.y - s0.y;
        const moved = Math.hypot(cap.start.x - s0.x, cap.start.z - s0.z);
        if (!up.ceil && down.floor && rise > 0.02 && rise <= STEP_UP + 0.01 && moved > 0.03 && !fwd.ceil) {
          this.onFloor = true;
          this.vel.y = 0;
          this.stepOffset += rise; // 模型和镜头平滑地升上去，不是一帧跳上台阶
          // 为了不卡在台阶边，这一步往前多挪了一点：多出来的部分让模型和镜头平滑跟上，看起来是匀速走上楼梯
          const ex = (cap.start.x - s0.x) - move.x, ez = (cap.start.z - s0.z) - move.z;
          if (ex * move.x + ez * move.z > 0) { this.stepOffsetH.add(_v3.set(ex, 0, ez)); this.moveDebt = (this.moveDebt || 0) + Math.hypot(ex, ez); }
          return;
        }
      }
      cap.start.copy(r1); cap.end.copy(r2);
    }
  }

  // 胶囊体和地图碰撞，多推几次处理墙角；返回 地面/墙/天花板 的接触情况
  _resolve() {
    const out = { floor: false, wall: null, ceil: false };
    for (let i = 0; i < 3; i++) {
      const r = this.game.octree.capsuleIntersect(this.capsule);
      if (!r) break;
      if (r.normal.y > 0.3) out.floor = true;
      else if (r.normal.y < -0.3) out.ceil = true;
      else out.wall = r.normal.clone();
      if (r.depth < 1e-10) break;
      // 踩在坡面上：只往上推，不顺着坡面法线推（那样会把人沿坡往下推，下坡越走越快、上坡变慢）
      if (r.normal.y > 0.55) this.capsule.translate(_v3.set(0, Math.min(r.depth / r.normal.y, r.depth * 2), 0));
      else this.capsule.translate(r.normal.multiplyScalar(r.depth));
    }
    return out;
  }

  // 贴地：上一帧在地上、这帧没跳却离开了地面（下坡、下台阶），往下找地面直接贴上去，不会一路“飞”下坡
  _snapGround() {
    const cap = this.capsule;
    const s0 = cap.start.clone(), e0 = cap.end.clone();
    cap.translate(_v3.set(0, -SNAP_DOWN, 0));
    const r = this._resolve();
    if (r.floor && Math.hypot(cap.start.x - s0.x, cap.start.z - s0.z) < 0.01) {
      const drop = s0.y - cap.start.y;
      if (drop > 0.0005) this.stepOffset -= Math.min(drop, 0.5) * (drop > 0.15 ? 1 : 0);
      return true;
    }
    cap.start.copy(s0); cap.end.copy(e0);
    return false;
  }

  // 脚步声：跟着动画里脚真正落地的那一下响（脚的高度到了最低点、开始抬起）
  _footsteps(dt, hs) {
    if (!this.onFloor || hs < 0.5 || !this.alive || this.paperAmt > 0.5 || !this.vrm || dt <= 0) { this._feet = null; return; }
    const H = this.vrm.humanoid;
    const st = this._feet ||= { L: { n: H.getRawBoneNode('leftFoot') }, R: { n: H.getRawBoneNode('rightFoot') } };
    const base = this.pivot.position.y;
    st.cd = Math.max(0, (st.cd || 0) - dt);
    for (const f of [st.L, st.R]) {
      if (!f.n) continue;
      const y = f.n.getWorldPosition(_v3).y - base;
      const vy = f.y == null ? 0 : (y - f.y) / dt;
      f.min = f.min == null ? y : Math.min(y, f.min + dt * 0.04); // 记住脚最低能到多低（慢慢回升，适应坡道）
      f.cd = Math.max(0, (f.cd || 0) - dt);
      if ((f.vy ?? 0) < -0.05 && vy >= -0.05 && y < f.min + 0.07 && f.cd <= 0 && (st.cd || 0) <= 0) {
        f.cd = 0.25; st.cd = 0.2; // 两只脚之间也隔开一点，同一步不会响两下
        const k = THREE.MathUtils.clamp(hs / 7.5, 0, 1);
        this._sfx('step', 0.13 + 0.12 * k, 0.95 + Math.random() * 0.12 + k * 0.08);
      }
      f.y = y; f.vy = vy;
    }
  }

  shoulder(out) {
    return this.feet(out).add(_v2.set(0, (this.headH ?? 1.45) + 0.05, 0));
  }

  _animate(dt, wish) {
    this.feet(this.pivot.position);
    this.pivot.position.y -= this.stepOffset;
    this.pivot.position.x -= this.stepOffsetH.x; this.pivot.position.z -= this.stepOffsetH.z;
    this.pivot.rotation.y = this.yaw;
    if (!this.vrm) return;

    // 纸化：左右压扁成一张纸，轻微翻转
    const sx = THREE.MathUtils.lerp(1, PAPER.thickness, this.paperAmt);
    this.vrm.scene.scale.set(sx, 1, 1);
    this.vrm.scene.rotation.z = Math.sin(this.paperAmt * Math.PI) * 0.12;

    if (this.anim) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      // 速度换算到角色本地坐标：localZ 向前，localX 向左
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const lz = hs > 0.01 ? (this.vel.x * sy + this.vel.z * cy) / hs : 1;
      const lx = hs > 0.01 ? (this.vel.x * cy - this.vel.z * sy) / hs : 0;
      this.anim.update(dt, {
        speed: hs, localX: lx, localZ: lz, onFloor: this.onFloor, velY: this.vel.y,
        pitch: this.pitch, paper: this.paperAmt, reloading: this.reloadT > 0 && !this.gun?.userData.reloadAction,
      });
      this._vrmUpdate(dt);
      this._footsteps(dt, hs);
      return;
    }

    const b = this.bones;
    const s = this.isVRM0 ? -1 : 1; // VRM0 骨骼的 X/Z 旋转方向相反
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const amp = THREE.MathUtils.clamp(hs / 6, 0, 1) * (this.onFloor ? 1 : 0.25);
    this.phase += dt * (4 + hs * 1.25);
    const sin = Math.sin(this.phase);

    // 移动方向相对于朝向（倒退时腿也要往回摆）
    const localFwd = wish.lengthSq() ? (wish.x * Math.sin(this.yaw) + wish.z * Math.cos(this.yaw)) : 1;
    const dirSign = localFwd < -0.3 ? -1 : 1;

    const air = this.onFloor ? 0 : 1;
    b.leftUpperLeg.rotation.set(s * (dirSign * sin * 0.75 * amp - air * 0.55), 0, 0);
    b.rightUpperLeg.rotation.set(s * (-dirSign * sin * 0.75 * amp - air * 0.25), 0, 0);
    b.leftLowerLeg.rotation.set(s * (Math.max(0, -Math.sin(this.phase - 0.9)) * 1.1 * amp + air * 0.9), 0, 0);
    b.rightLowerLeg.rotation.set(s * (Math.max(0, Math.sin(this.phase - 0.9)) * 1.1 * amp + air * 0.5), 0, 0);

    // 上半身跟随准星俯仰
    const p = this.pitch;
    b.spine.rotation.set(s * (-p * 0.25 + 0.05 * amp), 0, 0);
    if (b.chest) b.chest.rotation.set(s * (-p * 0.25), Math.sin(this.phase) * 0.05 * amp, 0);
    if (b.neck) b.neck.rotation.set(s * (-p * 0.15), 0, 0);
    b.head.rotation.set(s * (-p * 0.2), 0, 0);
    b.hips.position.y = this.hipsRestY + Math.abs(Math.cos(this.phase)) * 0.025 * amp;

    // 双手持枪
    const armPitch = s * (-p * 0.5);
    const paperArm = this.paperAmt;
    b.rightUpperArm.rotation.set(armPitch, THREE.MathUtils.lerp(1.3, 0, paperArm), s * THREE.MathUtils.lerp(0, 1.2, paperArm));
    b.rightLowerArm.rotation.set(0, THREE.MathUtils.lerp(0.65, 0, paperArm), 0);
    b.leftUpperArm.rotation.set(armPitch, THREE.MathUtils.lerp(-1.65, 0, paperArm), s * THREE.MathUtils.lerp(0, -1.2, paperArm));
    b.leftLowerArm.rotation.set(0, THREE.MathUtils.lerp(-0.9, 0, paperArm), 0);

    this.vrm.update(dt);

    // 脚步声
    if (this.onFloor && hs > 2) {
      this.stepT -= dt * hs;
      if (this.stepT <= 0) { this.stepT = 1.3; this._sfx('step', 0.18, 1 + Math.random() * 0.1); }
    }
  }

  _updateCamera(dt) {
    const cam = this.game.camera;
    const aim = this.aimDir(new THREE.Vector3());
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const head = this.shoulder(new THREE.Vector3()).sub(this.stepOffsetH);
    // 上台阶、落地时脚的高度会突变，镜头高度平滑跟随，避免画面一顿
    if (this._camY === undefined || Math.abs(this._camY - head.y) > 1.5) this._camY = head.y;
    this._camY += (head.y - this._camY) * Math.min(1, dt * (this.onFloor ? 18 : 40));
    head.y = this._camY;

    // 镜头在右肩外侧；右边贴墙时肩膀偏移收回来，而不是从墙里面往后打射线
    let side = THREE.MathUtils.lerp(0.42, 0.5, this.ads); // 越肩视角：人物在画面偏左，准星在右肩前方
    const sideHit = this.game.raycastWorld(head, right, side + 0.25);
    if (sideHit) side = Math.max(0.05, sideHit.distance - 0.25);
    this._camSide = smoothTo(this._camSide ?? side, side, dt, 25, 6);
    const pivot = head.addScaledVector(right, this._camSide).add(_v.set(0, 0.04, 0));

    // 往后的遮挡检测：中心 + 四周 4 条射线（近似一个有半径的球），取最近的
    const back = aim.clone().negate();
    const dist = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.75, 1.45, this.ads), 2.6, this.paperAmt); // 靠近一点的越肩镜头
    let d = dist;
    const camUp = _v2.crossVectors(right, back).normalize();
    for (const [ox, oy] of CAM_PROBES) {
      const o = pivot.clone().addScaledVector(right, ox).addScaledVector(camUp, oy);
      const hit = this.game.raycastWorld(o, back, dist + 0.3);
      if (hit) d = Math.min(d, hit.distance - 0.3);
    }
    d = Math.max(0.4, d);
    // 被挡住时较快拉近（约 0.15 秒到位），挡住的东西离开后慢慢退回去，不会一帧跳过去
    this._camDist = smoothTo(this._camDist ?? d, d, dt, 16, 4);
    cam.position.copy(pivot).addScaledVector(back, this._camDist);
    this.aimPoint.copy(pivot).addScaledVector(aim, 60);
    cam.lookAt(this.aimPoint);

    // 第一人称（简易版）：镜头放在头部骨骼前方一点，位置平滑跟随，避免跑步时晃得太厉害
    if (this.firstPerson && !this.scoped && this.vrm && this.alive) {
      const head = this.vrm.humanoid.getRawBoneNode('head');
      const hp = head.getWorldPosition(_v3);
      hp.y += 0.07;
      hp.addScaledVector(_v.set(aim.x, 0, aim.z).normalize(), 0.09);
      if (!this._eye || this._eye.distanceToSquared(hp) > 1) this._eye = hp.clone();
      this._eye.lerp(hp, Math.min(1, dt * 20));
      cam.position.copy(this._eye);
      this.aimPoint.copy(this._eye).addScaledVector(aim, 60);
      cam.lookAt(this.aimPoint);
    }

    // 狙击镜：镜头移到眼睛位置，隐藏自己的模型，镜内轻微呼吸晃动（会影响弹着点，跑动时晃得更厉害）
    if (this.vrm) this.vrm.scene.visible = !this.scoped;
    // 第一人称时镜头只看 firstPersonOnly 图层，自己的头和头发不渲染（阴影照样有）
    const fp = this.firstPerson && this.alive && this.vrm?.firstPerson && !(this.orbitK > 0.01);
    if (this.vrm?.firstPerson) {
      const F = this.vrm.firstPerson;
      if (fp) { cam.layers.enable(F.firstPersonOnlyLayer); cam.layers.disable(F.thirdPersonOnlyLayer); }
      else { cam.layers.disable(F.firstPersonOnlyLayer); cam.layers.enable(F.thirdPersonOnlyLayer); }
    }
    if (this.scoped) {
      const eye = this.shoulder(_v3).add(_v.set(0, 0.06, 0)).addScaledVector(aim, 0.25);
      cam.position.copy(eye);
      this.aimPoint.copy(eye).addScaledVector(aim, 60);
      cam.lookAt(this.aimPoint);
      this._swayT = (this._swayT || 0) + dt;
      const t = this._swayT, mv = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 2.5);
      const amp = 0.0011 * (1 + mv * 3);
      cam.rotateY(Math.sin(t * 0.9) * amp + Math.sin(t * 2.3) * amp * 0.3);
      cam.rotateX(Math.sin(t * 1.4 + 1) * amp * 0.7);
    }

    // 按住 Alt：临时自由视角，镜头围着角色转；进出时平滑过渡
    const on = !!(this.orbit?.on && this.alive && this.vrm);
    this.orbitK = THREE.MathUtils.clamp((this.orbitK || 0) + (on ? dt : -dt) * 5, 0, 1);
    if (this.orbitK > 0 && this.orbit && this.vrm) {
      const o = this.orbit, k = this.orbitK * this.orbitK * (3 - 2 * this.orbitK);
      const c = this._orbitCenter(_v3);
      const dir = _v.set(Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw) * Math.cos(o.pitch));
      const hit = this.game.raycastWorld(c, dir, o.dist + 0.25);
      o.cur = smoothTo(o.cur ?? o.dist, hit ? Math.max(0.35, hit.distance - 0.25) : o.dist, dt, 16, 5);
      const pos = c.clone().addScaledVector(dir, o.cur);
      const look = this.aimPoint.clone().lerp(c, k);
      cam.position.lerp(pos, k);
      cam.lookAt(look);
      this.vrm.scene.visible = true;
    }

    // 屏幕震动
    if (this.game.shakeAmt > 0) {
      const a = this.game.shakeAmt * 0.04;
      cam.rotation.x += (Math.random() - 0.5) * a;
      cam.rotation.y += (Math.random() - 0.5) * a;
    }

    if (this.gun && this.vrm) this._holdGun();
    this.game.viewmodel?.update(dt, this, cam);
  }

  // —— 自由视角（按住 Alt）——
  _orbitCenter(v) {
    const hips = this.vrm?.humanoid.getRawBoneNode('hips');
    if (hips) hips.getWorldPosition(v); else v.copy(this.capsule.start).add(_v2.set(0, 0.6, 0));
    v.y += 0.3;
    return v;
  }
  orbitStart() {
    if (!this.vrm || !this.alive) return;
    const c = this._orbitCenter(new THREE.Vector3());
    const off = this.game.camera.position.clone().sub(c);
    const len = Math.max(0.5, off.length());
    // 从当前镜头的位置开始转，不会一按下去画面就跳
    const prev = this.orbit;
    this.orbit = { on: true, yaw: Math.atan2(off.x, off.z), pitch: Math.asin(THREE.MathUtils.clamp(off.y / len, -0.9, 0.9)), dist: THREE.MathUtils.clamp(Math.max(len, 2.2), 1, 7) };
    // 第一人称时镜头在眼睛上，从身后斜上方开始转
    if (this.firstPerson) {
      const a = this.aimDir(new THREE.Vector3());
      Object.assign(this.orbit, { yaw: Math.atan2(-a.x, -a.z), pitch: 0.3, dist: 2.4 });
    }
    if (prev && this.orbitK > 0) Object.assign(this.orbit, { yaw: prev.yaw, pitch: prev.pitch, dist: prev.dist, cur: prev.cur });
  }
  orbitEnd() { if (this.orbit) this.orbit.on = false; }
  orbitLook(dx, dy) {
    const o = this.orbit;
    if (!o?.on) return;
    o.yaw -= dx;
    o.pitch = THREE.MathUtils.clamp(o.pitch + dy, -1.1, 1.35);
  }
  orbitZoom(s) { const o = this.orbit; if (o?.on) o.dist = THREE.MathUtils.clamp(o.dist * (1 + s * 0.12), 1, 7); }

  // 持枪：先按持枪方式把枪放在身体前方并对准准星，再用 IK 把双手拉到握把和护木上
  _holdGun() {
    const H = this.vrm.humanoid;
    const W = this.weapon.def;
    const w = this.anim ? this.anim.aimWeight : 1;
    const gu = this.gun.userData;
    if (gu.mixer) {
      if (this.reloadT <= 0 && gu.reloadAction?.isRunning()) gu.reloadAction.stop();
      gu.mixer.update(this._dt || 0);
    }
    if (!this._ik) {
      this._ik = {
        rU: H.getRawBoneNode('rightUpperArm'), rL: H.getRawBoneNode('rightLowerArm'), rH: H.getRawBoneNode('rightHand'),
        lU: H.getRawBoneNode('leftUpperArm'), lL: H.getRawBoneNode('leftLowerArm'), lH: H.getRawBoneNode('leftHand'),
        rightWrist: new THREE.Vector3(-0.005, -0.03, -0.065), // 右手手腕在握把后下方
        launcherWrist: new THREE.Vector3(-0.005, -0.075, -0.01),
      };
    }
    const k = this._ik;
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const shR = k.rU.getWorldPosition(new THREE.Vector3());
    const shL = k.lU.getWorldPosition(new THREE.Vector3());
    const aimPt = this.aimTarget();

    // 枪托抵住的位置 / 握把的位置
    let base, reach;
    // 镜头在右肩后方，枪整体往角色右侧放，玩家才看得到（HOLD_RIGHT 可调）
    if (W.hold === 'pistol') {
      base = shR.clone().add(shL).multiplyScalar(0.5).addScaledVector(right, HOLD_RIGHT.pistol).addScaledVector(up, -0.02);
      reach = PISTOL_REACH;
    } else if (W.hold === 'launcher') {
      base = shR.clone().addScaledVector(up, 0.1).addScaledVector(right, HOLD_RIGHT.launcher);
      reach = 0.06;
    } else {
      base = shR.clone().addScaledVector(right, HOLD_RIGHT.rifle).addScaledVector(up, -0.04);
      reach = W.stock * GUN_SCALE.rifle - 0.03;
    }
    const sc = GUN_SCALE[W.hold] || 1;
    const dir = aimPt.clone().sub(base).normalize();
    const grip = base.addScaledVector(dir, reach);
    if (W.hold === 'rifle') grip.addScaledVector(up, -0.005);
    // 开枪后坐：枪往后顶一下、枪口微抬，很快回位
    const kick = W.hold === 'rifle' ? Math.min(1, this.kick || 0) : 0;
    grip.addScaledVector(dir, -0.022 * kick).addScaledVector(up, 0.008 * kick);
    dir.addScaledVector(up, 0.05 * kick * Math.min(1, W.recoil * 40)).normalize();

    this.holdPose?.(grip, dir, up, right, fwd); // 大厅展示用：改成抱枪姿势（局内不设置）
    // 换弹等动作时让枪跟着右手走
    const handPos = k.rH.getWorldPosition(new THREE.Vector3());
    this.gun.position.lerpVectors(handPos, grip, w);
    this.gun.lookAt(this.gun.position.clone().add(dir));
    const gs = 1 - this.paperAmt;
    this.gun.scale.setScalar(Math.max(0.001, sc * gs * (1 - this.switchT * 1.5)));
    this.gun.visible = this.alive && gs > 0.05 && !this.scoped;
    this.gun.updateMatrixWorld(true);

    // 右手握把，左手护木；肘部朝下、向外
    // 握持点优先用枪模型里的 IK 节点（换弹动画会移动左手节点）
    // 枪的空间（换弹时会跟着枪身一起转）：点用 localToWorld，方向用世界旋转
    const space = gu.ikR ? gu.ikR.parent : this.gun;
    const unit = gu.ikR ? 1 : 100; // 模型里的节点是厘米，旧模型直接用米
    const spaceQ = space.getWorldQuaternion(new THREE.Quaternion());
    const P = (a) => space.localToWorld(new THREE.Vector3(a[0], a[1], a[2]).divideScalar(unit));
    const D = (a) => new THREE.Vector3().fromArray(a).applyQuaternion(spaceQ).normalize();
    if (!k.palm) {
      const len = (h, m) => H.getRawBoneNode(h).getWorldPosition(new THREE.Vector3()).distanceTo(H.getRawBoneNode(m).getWorldPosition(new THREE.Vector3()));
      k.palm = { r: len('rightHand', 'rightMiddleProximal'), l: len('leftHand', 'leftMiddleProximal') };
      const fb = (side) => ({ lower: H.getRawBoneNode(side + 'LowerArm'), hand: H.getRawBoneNode(side + 'Hand'), middle: H.getRawBoneNode(side + 'MiddleProximal'), index: H.getRawBoneNode(side + 'IndexProximal'), little: H.getRawBoneNode(side + 'LittleProximal') });
      k.rFingers = fb('right'); k.lFingers = fb('left');
    }
    const G = W.grip;
    const reloading = !!gu.reloadAction?.isRunning();

    // 右手：掌心贴住握把
    let rTarget;
    if (G?.r?.c) rTarget = wristForContact(P(G.r.c), D(G.r.d), D(G.r.n), k.palm.r);
    else rTarget = gu.ikR ? gu.ikR.getWorldPosition(new THREE.Vector3()) : this.gun.localToWorld((W.hold === 'launcher' ? k.launcherWrist : k.rightWrist).clone());
    const rPole = shR.clone().addScaledVector(up, -0.7).addScaledVector(right, 0.45).addScaledVector(fwd, -0.2);
    solveArm(k.rU, k.rL, k.rH, rTarget, rPole, w);
    if (G?.r && k.rFingers.middle && !this._ikLite) { orientHand(k.rFingers, true, D(G.r.d), D(G.r.n), w); curlFingers(H, 'right', D(G.r.d), D(G.r.n), CURL_RIGHT, w); }

    // 左手：换弹时跟着动画走，平时贴在护木 / 前握把 / 包住右手
    const lPole = shL.clone().addScaledVector(up, -0.7).addScaledVector(right, -0.4).addScaledVector(fwd, -0.1);
    if (gu.palmIK && gu.ikL && k.lFingers.middle) {
      // 长枪：模型里的 IK_LeftHand 就是掌心贴住的点，旋转 = 手型方向（X 指尖、Y 掌心），缩放 = 手指弯曲权重
      const c = gu.ikL.getWorldPosition(new THREE.Vector3());
      const q = gu.ikL.getWorldQuaternion(new THREE.Quaternion());
      const d = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const s3 = gu.ikL.scale;
      const curl = mixCurl([s3.x - 1, s3.y - 1, s3.z - 1]);
      solveArm(k.lU, k.lL, k.lH, wristForContact(c, d, n, k.palm.l), lPole, w);
      if (!this._ikLite) { orientHand(k.lFingers, false, d, n, w); curlFingers(H, 'left', d, n, curl, w); }
      return;
    }
    let lTarget;
    if (!reloading && G?.l?.c) lTarget = wristForContact(P(G.l.c), D(G.l.d), D(G.l.n), k.palm.l);
    else lTarget = gu.ikL ? gu.ikL.getWorldPosition(new THREE.Vector3()) : this.gun.localToWorld(new THREE.Vector3().fromArray(W.support));
    solveArm(k.lU, k.lL, k.lH, lTarget, lPole, w);
    if (!reloading && G?.l && k.lFingers.middle && !this._ikLite) { orientHand(k.lFingers, false, D(G.l.d), D(G.l.n), w); curlFingers(H, 'left', D(G.l.d), D(G.l.n), CURL_LEFT, w); }
  }

  // 枪口火光挂在哪里：第一人称挂在手臂场景的枪上，否则挂在角色手里的枪上
  muzzleAnchor() {
    const vm = this.game.viewmodel;
    if (this === this.game.player && vm?.visibleNow && vm.gun) return { obj: vm.gun.obj, local: vm.gun.muzzle, cam: vm.camera, top: true };
    if (this.gun && this.muzzleLocal) return { obj: this.gun, local: this.muzzleLocal, cam: this.game.camera };
    return null;
  }

  muzzle(out) {
    if (!this.gun) return this.shoulder(out);
    if (this.game.viewmodel?.visibleNow && this.game.viewmodel.muzzleWorld(out, this.game.camera)) return out;
    return out.copy(this.muzzleLocal).applyMatrix4(this.gun.matrixWorld);
  }
}
