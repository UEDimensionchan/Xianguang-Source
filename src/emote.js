import * as THREE from 'three';

// 表情包：按住 X 打开轮盘，鼠标（仍然锁定，不出现指针）往哪个方向移就选哪个，松开 X 发出去。
// 发出的表情贴在角色头顶（第一人称时自己看不到头顶，就在屏幕上方弹一下），0.6 秒后消失。
export const EMOTES = [
  { id: 'nice', name: '好活！' },
  { id: 'thatsit', name: '就这？' },
  { id: 'taunt', name: '来打我呀' },
  { id: 'mybad', name: '我的锅' },
  { id: 'help', name: '救一下！' },
  { id: 'mercy', name: '饶命！' },
];
const LIFE = 1.2;       // 显示时长（秒）
const PICK_R = 26;      // 鼠标累计移动超过这个距离才算选中
const MAX_R = 90;

const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _dir = new THREE.Vector3();
const url = (id) => `Asset/UI/Emote/${id}.webp`;

export class Emotes {
  constructor(game) {
    this.game = game;
    this.loader = new THREE.TextureLoader();
    this.tex = {};
    this.live = [];          // { owner, img, t }
    this.open = false;
    this.v = new THREE.Vector2();
    this.sel = -1;
    this.cooldown = 0;
    EMOTES.forEach((e) => { new Image().src = url(e.id); }); // 提前加载，第一次发不会空一下
    this._buildWheel();
    this._buildFp();
  }

  texture(id) {
    if (!this.tex[id]) {
      const t = this.loader.load(url(id));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      this.tex[id] = t;
    }
    return this.tex[id];
  }

  // —— 轮盘 ——
  _buildWheel() {
    const el = document.createElement('div');
    el.id = 'emote-wheel';
    const n = EMOTES.length;
    el.innerHTML = `<div class="ew-ring"></div><div class="ew-hl"></div>${EMOTES.map((e, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return `<div class="ew-item" style="--x:${Math.cos(a).toFixed(4)};--y:${Math.sin(a).toFixed(4)}"><img src="${url(e.id)}" alt=""></div>`;
    }).join('')}<div class="ew-center"><b>表情</b><span>移动鼠标选择 · 松开 X 发送</span></div><i class="ew-dot"></i>`;
    (document.getElementById('hud') || document.body).appendChild(el);
    this.el = el;
    this.items = [...el.querySelectorAll('.ew-item')];
    this.center = el.querySelector('.ew-center');
    this.hl = el.querySelector('.ew-hl');
    this.dot = el.querySelector('.ew-dot');
  }
  openWheel() {
    if (this.open) return;
    this.open = true; this.v.set(0, 0); this._select(-1);
    this.el.classList.add('on');
  }
  // 返回选中的表情 id（没选就是 null）
  closeWheel() {
    if (!this.open) return null;
    this.open = false;
    this.el.classList.remove('on');
    return this.sel >= 0 ? EMOTES[this.sel].id : null;
  }
  wheelMove(dx, dy) {
    this.v.x += dx; this.v.y += dy;
    if (this.v.length() > MAX_R) this.v.setLength(MAX_R);
    this.el.style.setProperty('--dx', (this.v.x / MAX_R).toFixed(3)); this.el.style.setProperty('--dy', (this.v.y / MAX_R).toFixed(3));
    if (this.v.length() < PICK_R) return;
    const n = EMOTES.length;
    let a = Math.atan2(this.v.y, this.v.x) + Math.PI / 2; // 0 = 正上方，顺时针
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this._select(Math.round(a / (Math.PI * 2 / n)) % n);
  }
  _select(i) {
    if (i === this.sel) return;
    this.sel = i;
    this.items.forEach((it, k) => it.classList.toggle('on', k === i));
    this.hl.style.opacity = i < 0 ? 0 : 1;
    if (i >= 0) this.hl.style.transform = `rotate(${(i / EMOTES.length) * 360}deg)`;
    this.center.innerHTML = i < 0 ? '<b>表情</b><span>移动鼠标选择 · 松开 X 发送</span>' : `<b>${EMOTES[i].name}</b><span>松开 X 发送</span>`;
  }

  // —— 第一人称：屏幕上方弹一下 ——
  _buildFp() {
    const img = document.createElement('img');
    img.id = 'emote-fp'; img.alt = '';
    (document.getElementById('hud') || document.body).appendChild(img);
    this.fpEl = img;
    this.layer = document.createElement('div');
    this.layer.id = 'emote-layer';
    (document.getElementById('hud') || document.body).appendChild(this.layer);
  }

  // owner：玩家或 AI（有 pivot、headH）。贴纸用屏幕上的图片画（投影到头顶位置），不受辉光 / 描线影响，颜色和原图一样
  show(owner, id) {
    if (!owner?.pivot) return;
    const i = this.live.findIndex((x) => x.owner === owner);
    if (i >= 0) { this._kill(this.live[i]); this.live.splice(i, 1); }
    const img = document.createElement('img');
    img.className = 'emote-head'; img.alt = ''; img.src = url(id);
    this.layer.appendChild(img);
    this.live.push({ owner, img, t: 0 });
    if (owner === this.game.player) {
      this.fpEl.src = url(id);
      this.fpEl.classList.remove('pop'); void this.fpEl.offsetWidth; this.fpEl.classList.add('pop');
      clearTimeout(this._fpT); this._fpT = setTimeout(() => this.fpEl.classList.remove('pop'), LIFE * 1000 + 50);
    }
  }
  _kill(e) { e.img.remove(); }

  // 玩家发一个（有很短的冷却，避免连发刷屏）
  send(id) {
    if (!id || this.cooldown > 0) return;
    this.cooldown = 0.35;
    this.show(this.game.player, id);
    this.game.mp?.sendEmote(id); // 联机：别人也看得到
    this.game.pet?.react('emote'); // 桌宠也接一句
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const fp = !!this.game.player?.firstPerson;
    this.fpEl.classList.toggle('fp', fp);
    const cam = this.game.camera, H = innerHeight, W = innerWidth;
    const focal = H / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)); // 1 米在 1 米外占多少像素
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.t += dt;
      const o = e.owner;
      if (e.t >= LIFE || !o.pivot.parent) { this._kill(e); this.live.splice(i, 1); continue; }
      // 弹出：0.12 秒内带一点回弹放大；最后 0.15 秒淡出并上浮
      const pin = Math.min(1, e.t / 0.12);
      const back = 1 + 0.35 * Math.sin(pin * Math.PI) * (1 - pin * 0.4);
      const pop = pin < 1 ? (1 - Math.pow(1 - pin, 3)) * back : 1;
      const out = Math.max(0, (e.t - (LIFE - 0.15)) / 0.15);
      // 大小跟距离走：自己（镜头就在身后）别太大挡视线，远处的 AI 也还能看清
      const d = cam.position.distanceTo(o.pivot.position);
      const base = THREE.MathUtils.clamp(d * 0.13, 0.28, 0.95);
      _p.copy(o.pivot.position); _p.y += (o.headH || 1.55) + 0.18 + base * 0.5 + out * 0.15 * base;
      _p.project(cam);
      // 自己第一人称时头顶那张看不到（改用屏幕上方那张）；在镜头后面的也不画
      const hide = (o === this.game.player && fp) || _p.z > 1 || o.pivot.visible === false;
      e.img.style.display = hide ? 'none' : '';
      if (hide) continue;
      const dist = Math.max(0.5, _v.copy(o.pivot.position).sub(cam.position).dot(cam.getWorldDirection(_dir)));
      const px = base * focal / dist * pop;
      e.img.style.width = px.toFixed(1) + 'px';
      e.img.style.opacity = (1 - out).toFixed(3);
      e.img.style.transform = `translate(${((_p.x * 0.5 + 0.5) * W - px / 2).toFixed(1)}px, ${((-_p.y * 0.5 + 0.5) * H - px / 2).toFixed(1)}px)`;
    }
  }

  clear() {
    for (const e of this.live) this._kill(e);
    this.live.length = 0;
    this.closeWheel();
  }
}
