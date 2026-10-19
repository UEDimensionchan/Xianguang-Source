import * as THREE from 'three';

// 火箭筒锁定：右键瞄准时，准星附近（视线没被挡住）的敌人会被“框住”，持续对准约 1.4 秒完成锁定。
// 锁定后发射的火箭弹用比例导引追踪目标（会打提前量），转向有上限（每秒最多拐 100°），
// 目标贴脸或者在最后一瞬间急转侧闪仍然躲得开；离目标 1.5 米内近炸。
// 目标跑到火箭身后（偏离超过 80°）就彻底丢失，变回直飞。
export const LOCK = {
  time: 1.4,                                  // 锁定需要的时间（秒）
  cone: THREE.MathUtils.degToRad(6),          // 开始锁定：目标离准星的角度
  keep: THREE.MathUtils.degToRad(11),         // 锁定过程中允许的晃动范围（宽一点，不会稍微一抖就断）
  range: 90,                                  // 最远锁定距离（米）
  turn: THREE.MathUtils.degToRad(100),        // 火箭弹每秒最多转多少（横向转弯上限）
  nav: 3.5,                                   // 比例导引系数：越大提前量越足
  pursue: 1.2,                                // 直接朝目标转的修正强度
  fuse: 1.5,                                  // 近炸距离（米）
  lose: THREE.MathUtils.degToRad(80),         // 目标偏离火箭飞行方向超过这个角度就丢失
  delay: 0.12,                                // 出膛后多久开始追踪
};

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();

// 目标的瞄准点（胸口）
export function aimPoint(t, out) {
  if (t.feet) return t.feet(out).add(_p.set(0, 1.1, 0));
  return out.copy(t.group.position).add(_p.set(0, 1.1, 0));
}

export class LockOn {
  constructor(game) {
    this.game = game;
    this.target = null;
    this.progress = 0;
    this.locked = false;
    this.beepT = 0;
    const el = document.createElement('div');
    el.id = 'lockbox';
    el.innerHTML = '<i></i><i></i><i></i><i></i><span></span>';
    document.getElementById('hud').appendChild(el);
    this.el = el;
    this.label = el.querySelector('span');
  }

  _candidates() {
    const g = this.game;
    if (g.match) return g.match.bots.filter((b) => b.team === 'enemy' && b.alive);
    return (g.dummies?.list || []).filter((d) => d.alive);
  }

  reset() {
    this.target = null; this.progress = 0; this.locked = false;
    this.el.className = '';
  }

  lockedTarget() { return this.locked && this.target?.alive ? this.target : null; }

  update(dt, p, cam) {
    const W = p.weapon?.def;
    const active = !!(W?.rocket && p.alive && p.ads > 0.6 && p.reloadT <= 0 && p.ammo > 0 && p.paperAmt < 0.3);
    if (!active) { if (this.target || this.progress) this.reset(); return; }
    const g = this.game;
    const fwd = cam.getWorldDirection(_d);
    let best = null, bestAng = Infinity;
    for (const c of this._candidates()) {
      aimPoint(c, _v).sub(cam.position);
      const dist = _v.length();
      if (dist > LOCK.range || dist < 2) continue;
      const ang = _v.angleTo(fwd);
      if (ang > (c === this.target ? LOCK.keep : LOCK.cone)) continue;
      // 视线被墙挡住的不能锁
      if (g.raycastWorld(cam.position, _v.normalize(), dist - 0.6)) continue;
      // 正在锁的目标优先（不会被旁边路过的抢走）
      const score = c === this.target ? ang * 0.5 : ang;
      if (score < bestAng) { bestAng = score; best = c; }
    }
    if (best !== this.target) { this.target = best; this.progress = 0; this.locked = false; this.beepT = 0; }
    if (this.target) {
      const was = this.locked;
      this.progress = Math.min(1, this.progress + dt / LOCK.time);
      this.locked = this.progress >= 1;
      // 提示音：越接近锁定越急，锁定后变成高音连响
      this.beepT -= dt;
      if (!was && this.locked) { this._beep(1760, 0.16, 0.16); this.beepT = 0.22; }
      else if (this.beepT <= 0) {
        if (this.locked) { this._beep(1760, 0.07, 0.1); this.beepT = 0.14; }
        else { this._beep(1040, 0.05, 0.09); this.beepT = 0.34 - 0.24 * this.progress; }
      }
    }
    this._draw(cam);
  }

  _draw(cam) {
    const el = this.el;
    if (!this.target) { el.className = ''; return; }
    aimPoint(this.target, _v).project(cam);
    if (_v.z > 1) { el.className = ''; return; }
    const x = (_v.x * 0.5 + 0.5) * innerWidth, y = (-_v.y * 0.5 + 0.5) * innerHeight;
    // 框从大往小收紧，锁定后变红
    const s = 1 + (1 - this.progress) * 1.2;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    el.style.setProperty('--s', s.toFixed(3));
    el.className = this.locked ? 'on locked' : 'on';
    this.label.textContent = this.locked ? '锁定' : `${Math.floor(this.progress * 100)}%`;
  }

  _beep(freq, len, vol) {
    const sfx = this.game.sfx, ctx = sfx?.ctx;
    if (!ctx || !sfx.master) return;
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    const t = ctx.currentTime;
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(vol * 0.35, t + 0.005);
    gn.gain.setValueAtTime(vol * 0.35, t + len - 0.01);
    gn.gain.linearRampToValueAtTime(0, t + len);
    o.connect(gn).connect(sfx.master);
    o.start(t); o.stop(t + len + 0.02);
  }
}
