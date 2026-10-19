import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { TUNING } from './config.js';
import { renderPortrait, renderGunIcon, renderMinimap, DUMMY_FACE, HEADSHOT_ICON } from './hudart.js';

const $ = (id) => document.getElementById(id);
// 只在内容变化时才改 DOM，避免每帧重建节点引起卡顿
const setText = (el, v) => { v = String(v); if (el._t !== v) { el._t = v; el.textContent = v; } };
const setHTML = (el, v) => { if (el._h !== v) { el._h = v; el.innerHTML = v; } };
const setStyle = (el, k, v) => { const key = '_s_' + k; if (el[key] !== v) { el[key] = v; el.style[k] = v; } };
const DIR_LIFE = 0.5;   // 受击方向提示持续时间（秒）
const DIR_RADIUS = 150; // 离准星的距离（像素）
const _dv = new THREE.Vector3(), _dp = new THREE.Vector3(), _dt = new THREE.Vector3(), _mv = new THREE.Vector3();
const MAP_RADIUS = 26; // 小地图显示玩家周围多少米
// 小地图上的玩家箭头、队友圆点（Asset/UI/HUD，来自美术切图）
const MAP_IMG = { me: new Image(), ally: new Image() };
MAP_IMG.me.src = 'Asset/UI/HUD/map_me.png'; MAP_IMG.ally.src = 'Asset/UI/HUD/map_ally.png';

export class Hud {
  constructor(camera) {
    this.camera = camera;
    this.floaters = [];
    this.el = {
      hpFill: $('hp-fill'), hpText: $('hp-text'), energyFill: $('energy-fill'), energyText: $('energy-text'), vitals: $('vitals'),
      ammoCur: $('ammo-cur'), ammoMax: $('ammo-max'), reload: $('reload'), wname: $('weapon-name'), slots: $('slots'),
      skillQ: $('skill-q'), skillE: $('skill-e'), skillC: $('skill-c'), paperFill: $('paper-fill'), paperState: $('paper-state'),
      scoreAlly: $('score-ally'), scoreEnemy: $('score-enemy'), time: $('match-time'), mode: $('match-mode'),
      allyFaces: $('ally-faces'), enemyFaces: $('enemy-faces'), net: $('net'), netText: $('net-text'),
      killfeed: $('killfeed'), notice: $('notice'), markers: $('markers'),
      map: $('minimap-canvas'), mapName: $('map-name'),
      rf: $('rangefinder'), reticle: $('reticle'), rfDist: $('rf-dist'), rfRadius: $('rf-radius'), rfState: $('rf-state'), rfPointer: $('rf-pointer'),
      hitmarker: $('hitmarker'), crosshair: $('crosshair'), selfFace: $('self-face'),
      damage: $('damage-vignette'), paper: $('paper-overlay'),
      layer: $('float-layer'), charName: $('char-name'), dirLayer: $('dmg-dirs'), scope: $('scope'),
    };
    this._hitT = 0;
    this._dmgT = 0;
    this.dirs = [];
    this.time = 0;
    this.fps = 60;
    this.face = '';
    this.gunIcons = {};
    this.marks = [];
    // 武器槽：8 把枪，剪影等模型加载好再画
    this.slotEls = WEAPONS.map((w, i) => {
      const d = document.createElement('div');
      d.className = 'slot';
      d.innerHTML = `<img alt=""><span class="k">${i + 1}</span>`;
      this.el.slots.appendChild(d);
      return d;
    });
  }

  // 开局时调用：画小地图、角色头像、每把枪的剪影
  setup(game, renderer, vrm) {
    this.game = game;
    try { this.face = renderPortrait(renderer, vrm, game.scene); } catch (e) { console.warn('头像渲染失败', e); }
    this.el.selfFace.src = this.face;
    if (game.match) {
      // 竞技：双方每个角色一个头像（AI 的头像现场渲染）
      for (const b of game.match.bots) { try { b.face = renderPortrait(renderer, b.vrm, game.scene); } catch (e) { b.face = ''; } }
      const face = (src) => `<div class="face">${src ? `<img src="${src}" alt="">` : DUMMY_FACE}</div>`;
      this.el.allyFaces.innerHTML = face(this.face) + game.match.allies.map((b) => face(b.face)).join('');
      this.el.enemyFaces.innerHTML = game.match.enemies.map((b) => face(b.face)).join('');
      this.allyFaceEls = [...this.el.allyFaces.children];
    } else {
      this.el.allyFaces.innerHTML = `<div class="face"><img src="${this.face}" alt=""></div>`;
      this.el.enemyFaces.innerHTML = game.dummies.list.map(() => `<div class="face">${DUMMY_FACE}</div>`).join('');
    }
    this.enemyFaceEls = [...this.el.enemyFaces.children];
    try {
      game.distCull?.reveal();
      const hide = [];
      game.scene.traverse((o) => { if (o.userData?.noMinimap) hide.push(o); });
      this.mapData = renderMinimap(renderer, game.scene, game.worldBox, [game.player.pivot, ...(game.mapHide || []), ...hide]);
    } catch (e) { console.warn('小地图渲染失败', e); }
    WEAPONS.forEach((w, i) => game.arsenal.load(w).then((holder) => {
      try { this.gunIcons[w.id] = renderGunIcon(renderer, holder); } catch (e) { console.warn('武器剪影渲染失败', w.id, e); return; }
      this.slotEls[i].querySelector('img').src = this.gunIcons[w.id];
    }).catch(() => {}));
  }

  weapon(def, index) {
    const el = this.el.wname;
    el.textContent = `${def.code || def.id.toUpperCase()} / ${def.name}`;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    this.slotEls.forEach((d, i) => d.classList.toggle('on', i === index));
  }

  // 冲刺体力条：第三人称竖条跟在角色头部右边，第一人称横条放在准心下方
  _stamina(p) {
    const el = this._st ||= { root: document.getElementById('stamina'), v: new THREE.Vector3() };
    if (!el.root || p.stamina == null) return;
    el.i ||= el.root.querySelector('i');
    const k = Math.max(0, p.stamina / TUNING.player.stamina.max);
    const fp = !!p.firstPerson;
    el.root.classList.toggle('fp', fp);
    el.i.style.transform = fp ? `scaleX(${k.toFixed(3)})` : `scaleY(${k.toFixed(3)})`;
    el.root.classList.toggle('on', p.alive && (k < 0.995 || p.sprinting));
    el.root.classList.toggle('tired', !!p.tired);
    // 第一人称：技能栏上方，居中
    el.sk ||= document.getElementById('skills');
    let x = innerWidth / 2, y = el.sk ? el.sk.getBoundingClientRect().top - innerHeight * 0.016 : innerHeight * 0.8;
    // 第三人称：固定在画面上角色右侧腰旁（越肩镜头里角色在画面偏左），不跟着角色动
    if (!fp) { x = innerWidth / 2 - innerHeight * 0.09; y = innerHeight * 0.625; }
    if (el.fp !== fp) { el.x = null; el.fp = fp; }
    el.x = x; el.y = y;
    el.root.style.transform = `translate(${el.x.toFixed(1)}px, ${el.y.toFixed(1)}px)`;
  }

  // 换弹圆弧：换弹中按进度充满；换完（弹匣满了）亮一下再慢慢淡出；中途被打断（切枪、死亡）直接消失
  _reloadArc(p) {
    const el = this._ra ||= { root: document.getElementById('reload-arc') };
    if (!el.root) return;
    el.fg ||= el.root.querySelector('.fg'); el.tip ||= el.root.querySelector('.tip'); el.path ||= el.fg;
    const W = p.weapon.def;
    if (p.reloadT > 0 && p.alive) {
      const k = Math.min(1, Math.max(0, 1 - p.reloadT / W.reload));
      if (!el.active) { el.active = true; el.root.classList.remove('done'); el.root.classList.add('on'); el.len ||= el.path.getTotalLength(); }
      el.fg.style.strokeDashoffset = (100 - k * 100).toFixed(2);
      const pt = el.path.getPointAtLength(el.len * k);
      el.tip.setAttribute('cx', pt.x.toFixed(2)); el.tip.setAttribute('cy', pt.y.toFixed(2));
    } else if (el.active) {
      el.active = false;
      if (p.alive && p.ammo >= p.magSize) {
        el.fg.style.strokeDashoffset = '0';
        el.root.classList.remove('done'); void el.root.offsetWidth; el.root.classList.add('done');
      } else el.root.classList.remove('on', 'done');
    }
  }

  setCharacter(name) {
    this.el.charName.textContent = name;
  }

  update(dt, p, stats) {
    const e = this.el;
    this.time += dt;
    // 生命 / 纸化能量
    const hpPct = Math.max(0, p.hp / p.maxHp);
    setStyle(e.hpFill, 'width', (hpPct * 100).toFixed(1) + '%');
    e.hpFill.classList.toggle('low', hpPct < 0.35);
    e.vitals.classList.toggle('hurt', hpPct < 0.35);
    setText(e.hpText, Math.ceil(Math.max(0, p.hp)));
    const en = p.energy / p.energyMax;
    setStyle(e.energyFill, 'width', (en * 100).toFixed(1) + '%');
    setText(e.energyText, Math.round(p.energy));

    // 弹药
    setText(e.ammoCur, p.ammo);
    setText(e.ammoMax, p.magSize);
    e.ammoCur.classList.toggle('low', p.ammo <= Math.max(1, p.magSize * 0.25));
    setStyle(e.reload, 'opacity', p.reloadT > 0 ? '1' : '0');
    this._reloadArc(p);
    this._stamina(p);

    // 技能
    setSkill(e.skillQ, p.bombCd, p.bombCdMax);
    setSkill(e.skillE, p.dashCd, p.dashCdMax);
    setStyle(e.paperFill, 'height', (en * 100).toFixed(1) + '%');
    const active = p.paperAmt > 0.5, empty = p.energy < 5;
    e.skillC.classList.toggle('active', active);
    e.skillC.classList.toggle('empty', empty);
    e.skillC.classList.toggle('ready', !empty);
    setText(e.paperState, active ? '纸化中' : empty ? '充能中' : '可用');

    // 顶部：比分 / 计时。训练场 = 击破数 : 被击倒数，竞技 = 两队击杀数 + 倒计时
    const M = this.game?.match;
    if (M) {
      setText(e.scoreAlly, String(M.score.ally).padStart(2, '0'));
      setText(e.scoreEnemy, String(M.score.enemy).padStart(2, '0'));
      const t = M.phase === 'warmup' ? Math.ceil(M.warmT) : Math.ceil(M.timeLeft);
      setText(e.time, M.phase === 'warmup' ? `准备 ${t}` : `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
      setText(e.mode, `${this.mapName} · 团队竞技 · 先到 ${M.target} 击杀`);
      if (this.allyFaceEls) { this.allyFaceEls[0]?.classList.toggle('dead', !p.alive); M.allies.forEach((b, i) => this.allyFaceEls[i + 1]?.classList.toggle('dead', !b.alive)); }
      if (this.enemyFaceEls) M.enemies.forEach((b, i) => this.enemyFaceEls[i]?.classList.toggle('dead', !b.alive));
    } else {
      setText(e.scoreAlly, String(stats.kills).padStart(2, '0'));
      setText(e.scoreEnemy, String(stats.deaths || 0).padStart(2, '0'));
      const t = Math.floor(this.time);
      setText(e.time, `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
      setText(e.mode, `${this.mapName || '训练场'} · 命中率 ${stats.shots ? Math.round(stats.hits / stats.shots * 100) + '%' : '—'}`);
      if (this.enemyFaceEls) this.game.dummies.list.forEach((d, i) => this.enemyFaceEls[i]?.classList.toggle('dead', !d.alive));
    }

    // 帧率（单机训练场没有网络延迟，这里显示帧率）
    if (dt > 0) this.fps += (1 / dt - this.fps) * Math.min(1, dt * 2);
    const f = Math.round(this.fps);
    setText(e.netText, `${f} fps`);
    e.net.classList.toggle('mid', f < 50 && f >= 30);
    e.net.classList.toggle('bad', f < 30);

    // 准星
    const sights = (p.firstPerson && p.ads > 0.5) || this.rangefinderOn(p);
    setStyle(e.crosshair, 'opacity', p.scoped || sights ? '0' : p.paperAmt > 0.3 ? '0.15' : '1');
    e.scope.classList.toggle('on', !!p.scoped);
    this._updateRangefinder(p);
    this._kick = Math.max(0, (this._kick || 0) - dt * 4.5 * (1 + (this._kick || 0)));
    this._killT = Math.max(0, (this._killT || 0) - dt);
    const u = Math.min(innerWidth / 1672, innerHeight / 941);
    const spread = 4 + p.spread() * 280 + (this._kick || 0) * 30 * u * (1 - 0.4 * p.ads);
    e.crosshair.style.setProperty('--spread', Math.min(120, spread).toFixed(1) + 'px');
    e.crosshair.classList.toggle('hit', this._hitT > 0);
    // 第一人称瞄准的准心圈（轻机枪）：开枪时跟着撑开一点
    const ret = !!(p.weapon.def.ads?.reticle && !p.weapon.def.attach?.optic && p.firstPerson && p.ads > 0.7 && p.reloadT <= 0 && p.alive);
    e.reticle.classList.toggle('on', ret);
    if (ret) {
      e.reticle.style.setProperty('--rs', (1 + (this._kick || 0) * 0.18).toFixed(3));
      e.reticle.classList.toggle('hit', this._hitT > 0);
      e.reticle.classList.toggle('kill', this._killT > 0);
    }
    e.crosshair.classList.toggle('kill', this._killT > 0);
    setStyle(e.paper, 'opacity', (p.paperAmt * 0.9).toFixed(2));

    this._hitT = Math.max(0, this._hitT - dt);
    // 命中标记：先放大 1.8 倍再收回，最后淡出
    if (this._hitT > 0) {
      const k = 1 - this._hitT / this._hitLife;
      e.hitmarker.style.setProperty('--hs', (1 + 1.3 * Math.pow(1 - Math.min(1, k * 2.5), 2)).toFixed(3));
      e.hitmarker.style.opacity = (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4).toFixed(2);
    } else if (e.hitmarker.style.opacity !== '0') e.hitmarker.style.opacity = '0';
    this._updateDirs(dt, p);
    this._dmgT = Math.max(0, this._dmgT - dt);
    setStyle(e.damage, 'opacity', Math.min(1, this._dmgT * 2.2).toFixed(2));

    this._updateFloaters(dt);
    this._updateMarkers(p);
    this._drawMinimap(p);
  }

  // 测距仪是否显示：火箭筒右键瞄准（第一、第三人称都有），换弹时隐藏
  rangefinderOn(p) {
    return !!(p.weapon.def.ads?.rangefinder && p.ads > 0.6 && p.alive && p.reloadT <= 0 && p.paperAmt < 0.3);
  }

  // 火箭筒瞄准：测距仪显示准星所指的距离，对准纸片靶时变成珊瑚色“目标锁定”
  _updateRangefinder(p) {
    const e = this.el, W = p.weapon.def;
    const on = this.rangefinderOn(p);
    e.rf.classList.toggle('on', on);
    if (!on || !this.game) { e.rf.classList.remove('lock'); return; }
    if (!this._rfTicks) {
      this._rfTicks = true;
      const g = e.rf.querySelector('.ticks');
      let html = '';
      for (let i = 0; i < 72; i++) {
        const a = i / 72 * Math.PI * 2, big = i % 9 === 0, r0 = big ? 136 : 142;
        html += `<line class="${big ? 'big' : ''}" x1="${(Math.sin(a) * r0).toFixed(1)}" y1="${(-Math.cos(a) * r0).toFixed(1)}" x2="${(Math.sin(a) * 150).toFixed(1)}" y2="${(-Math.cos(a) * 150).toFixed(1)}"/>`;
      }
      g.innerHTML = html;
    }
    const cam = this.camera;
    const dir = cam.getWorldDirection(_dv);
    const wh = this.game.raycastWorld(cam.position, dir, 150);
    const ray = this._ray || (this._ray = new THREE.Ray());
    ray.set(cam.position, dir);
    const dh = this.game.dummies.raycast(ray, wh ? wh.distance : 150);
    let dist = dh ? dh.distance : wh ? wh.distance : null;
    // 第三人称镜头在身后，距离按角色到目标点算
    if (dist !== null) dist = _mv.copy(cam.position).addScaledVector(dir, dist).distanceTo(p.shoulder(_dp));
    setText(e.rfDist, dist === null ? '---.-' : dist.toFixed(1).padStart(5, '0'));
    setText(e.rfRadius, `${(W.rocket?.radius || 0).toFixed(1)} m`);
    setText(e.rfState, p.ammo > 0 ? '已装填' : '待装填');
    // 锁定状态（见 lockon.js）：锁定中显示进度，锁定完成显示“目标锁定”
    const L = this.game.lock;
    e.rf.classList.toggle('lock', !!(L && L.target));
    setText(e.rfLock || (e.rfLock = document.getElementById('rf-lock')), L?.locked ? '目标锁定 · 追踪弹' : L?.target ? `锁定中 ${Math.floor(L.progress * 100)}%` : '');
    // 右侧刻度尺：0–120 米
    const k = dist === null ? 1 : Math.min(1, dist / 120);
    setStyle(e.rfPointer, 'top', `${((1 - k) * 100).toFixed(1)}%`);
  }

  // 敌人头顶的珊瑚色菱形（被墙挡住也显示，方便找靶子）
  _updateMarkers(p) {
    if (!this.game) return;
    if (this.game.match) return this._updateTeamMarkers(p);
    const list = this.game.dummies.list, w = innerWidth, h = innerHeight;
    while (this.marks.length < list.length) {
      const m = document.createElement('div');
      m.className = 'mk';
      this.el.markers.appendChild(m);
      this.marks.push(m);
    }
    const me = p.feet(_dp);
    list.forEach((d, i) => {
      const m = this.marks[i];
      let show = d.alive;
      if (show) {
        _mv.copy(d.group.position); _mv.y += 2.25;
        const dist = _mv.distanceTo(me);
        _mv.project(this.camera);
        show = _mv.z < 1 && Math.abs(_mv.x) < 1.05 && Math.abs(_mv.y) < 1.05 && dist > 3 && inScope(p, _mv, w, h);
        if (show) {
          const s = THREE.MathUtils.clamp(1.25 - dist / 50, 0.6, 1.1);
          m.style.transform = `translate(${((_mv.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-_mv.y * 0.5 + 0.5) * h).toFixed(1)}px) scale(${s.toFixed(2)})`;
        }
      }
      setStyle(m, 'display', show ? 'block' : 'none');
    });
  }

  // 竞技：队友头顶一直显示名字（隔墙也能看到），敌人只有直接看得见时才显示红色标记
  _updateTeamMarkers(p) {
    const bots = this.game.match.bots, w = innerWidth, h = innerHeight;
    while (this.marks.length < bots.length) {
      const m = document.createElement('div');
      m.className = 'tm';
      m.innerHTML = '<span></span><i></i>';
      this.el.markers.appendChild(m);
      this.marks.push(m);
    }
    const me = p.feet(_dp);
    bots.forEach((b, i) => {
      const m = this.marks[i];
      const ally = b.team === 'ally';
      let show = b.alive && (ally || b.spotted);
      if (show) {
        b.feet(_mv); _mv.y += 2.05;
        const dist = _mv.distanceTo(me);
        _mv.project(this.camera);
        show = _mv.z < 1 && Math.abs(_mv.x) < 1.05 && Math.abs(_mv.y) < 1.05 && dist > 2 && inScope(p, _mv, w, h);
        if (show) {
          if (m._team !== b.team) { m._team = b.team; m.className = 'tm ' + b.team; m.firstChild.textContent = ally ? b.name : ''; }
          const s = THREE.MathUtils.clamp(1.2 - dist / 60, 0.55, 1);
          m.style.transform = `translate(${((_mv.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-_mv.y * 0.5 + 0.5) * h).toFixed(1)}px) scale(${s.toFixed(2)})`;
          m.style.opacity = ally ? (dist > 45 ? 0.6 : 0.95) : 1;
        }
      }
      setStyle(m, 'display', show ? 'block' : 'none');
    });
  }

  // 击杀播报（竞技）：击杀者头像 + 名字 + 武器剪影 → 被击倒者
  killEvent({ killer, victim, head, def, player }) {
    const nameOf = (c) => (c === player ? this.el.charName.textContent : c?.name || '？');
    const faceOf = (c) => (c === player ? this.face : c?.face);
    const teamOf = (c) => (c === player ? 'ally' : c?.team);
    const d = document.createElement('div');
    d.className = 'kf' + (killer === player || victim === player ? ' me' : '');
    const gun = def ? this.gunIcons[def.id] : null;
    const face = (c) => `<div class="face ${teamOf(c) === 'enemy' ? 'enemy' : ''}">${faceOf(c) ? `<img src="${faceOf(c)}" alt="">` : DUMMY_FACE}</div>`;
    d.innerHTML = (killer ? face(killer) + `<span class="who ${teamOf(killer)}"></span>` : '')
      + (gun ? `<img class="gun" src="${gun}" alt="">` : '') + (head ? HEADSHOT_ICON : '')
      + face(victim) + `<span class="vic ${teamOf(victim)}"></span>`;
    if (killer) d.querySelector('.who').textContent = nameOf(killer);
    d.querySelector('.vic').textContent = nameOf(victim);
    this.el.killfeed.prepend(d);
    setTimeout(() => d.classList.add('out'), 4500);
    setTimeout(() => d.remove(), 5000);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
  }

  // 小地图（圆形）：北朝上，玩家在中间，三角形指向朝向；红点 = 纸片靶
  _drawMinimap(p) {
    const M = this.mapData, cv = this.el.map;
    if (!M || !cv) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(14, 18, 24, 0.55)';
    ctx.fillRect(0, 0, W, H);
    const me = p.feet(_dp);
    const px = (me.x - M.minX) / M.size * M.canvas.width, pz = (me.z - M.minZ) / M.size * M.canvas.height;
    const r = MAP_RADIUS / M.size * M.canvas.width;
    ctx.drawImage(M.canvas, px - r, pz - r, r * 2, r * 2, 0, 0, W, H);
    const toMap = (x, z) => [W / 2 + (x - me.x) / MAP_RADIUS * (W / 2), H / 2 + (z - me.z) / MAP_RADIUS * (H / 2)];
    // 竞技：只画队友（薄荷色箭头），不画敌人
    if (this.game.match) for (const b of this.game.match.allies) {
      if (!b.alive) continue;
      b.feet(_mv);
      const [x, y] = toMap(_mv.x, _mv.z);
      if (Math.hypot(x - W / 2, y - H / 2) > W / 2 - 8) continue; // 圆形小地图：圈外的不画
      if (MAP_IMG.ally.complete && MAP_IMG.ally.naturalWidth) ctx.drawImage(MAP_IMG.ally, x - 7, y - 7, 14, 14); // 队友：美术切图的薄荷色圆点
      else { ctx.fillStyle = '#7ff5e1'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
    }
    else for (const d of this.game.dummies.list) {
      if (!d.alive) continue;
      const [x, y] = toMap(d.group.position.x, d.group.position.z);
      if (Math.hypot(x - W / 2, y - H / 2) > W / 2 - 6) continue;
      ctx.fillStyle = '#ff6464';
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    }
    // 视野扇形 + 玩家三角形
    const ang = Math.atan2(Math.cos(p.yaw), Math.sin(p.yaw)); // 地图上：x = 世界 X，y = 世界 Z
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(ang);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 70);
    g.addColorStop(0, 'rgba(51, 230, 200, 0.35)'); g.addColorStop(1, 'rgba(51, 230, 200, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 70, -0.55, 0.55); ctx.closePath(); ctx.fill();
    if (MAP_IMG.me.complete && MAP_IMG.me.naturalWidth) { ctx.rotate(Math.PI / 2); ctx.drawImage(MAP_IMG.me, -10, -11, 20, 22); } // 玩家：美术切图的三角箭头（切图朝上，转到朝 +x）
    else {
      ctx.fillStyle = '#33e6c8'; ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // 击杀播报：我方头像 + 名字 + 武器剪影 → 纸片靶
  kill(head, def) {
    const d = document.createElement('div');
    d.className = 'kf';
    const gun = this.gunIcons[def?.id];
    d.innerHTML = `<div class="face"><img src="${this.face}" alt=""></div><span class="who"></span>`
      + (gun ? `<img class="gun" src="${gun}" alt="">` : '') + (head ? HEADSHOT_ICON : '')
      + `<div class="face enemy">${DUMMY_FACE}</div><span class="vic">纸片靶</span>`;
    d.querySelector('.who').textContent = this.el.charName.textContent;
    this.el.killfeed.prepend(d);
    setTimeout(() => d.classList.add('out'), 4000);
    setTimeout(() => d.remove(), 4500);
    while (this.el.killfeed.children.length > 4) this.el.killfeed.lastChild.remove();
  }

  // 命中：命中标记弹出，准星再撑开一下
  hit(head, kill) {
    this._hitT = this._hitLife = kill ? 0.35 : head ? 0.26 : 0.2;
    this._kick = Math.min(2.2, (this._kick || 0) + (kill ? 1.4 : head ? 1.0 : 0.6));
    this._killT = kill ? 0.3 : this._killT || 0;
    const hm = this.el.hitmarker;
    hm.classList.toggle('head', !!head && !kill);
    hm.classList.toggle('kill', !!kill);
  }

  // 开枪：准星一下子撑开，再弹回来（后坐越大撑得越开）
  fire(recoil) {
    this._kick = Math.min(2.5, (this._kick || 0) + THREE.MathUtils.clamp(recoil * 50, 0.9, 1.8));
  }

  // 受击方向提示：红色弧形指向攻击来源，持续 0.5 秒，转动视角时会实时跟着转
  hurt(from) {
    this._dmgT = 0.5;
    if (!from) return;
    const near = this.dirs.find((d) => d.from.distanceToSquared(from) < 4);
    if (near) { near.t = 0; near.from.copy(from); return; }
    const el = document.createElement('div');
    el.className = 'dmg-dir';
    el.innerHTML = '<svg viewBox="-60 -20 120 40" width="120" height="40"><path class="arc" d="M-52 12 Q0 -14 52 12" /><path class="tip" d="M-9 -2 L0 -16 L9 -2 Z" /></svg>';
    this.el.dirLayer.appendChild(el);
    this.dirs.push({ el, from: from.clone(), t: 0 });
    if (this.dirs.length > 6) this.dirs.shift().el.remove();
  }

  _updateDirs(dt, p) {
    if (!this.dirs.length) return;
    const cam = this.camera;
    const fwd = cam.getWorldDirection(_dv).setY(0).normalize();
    const me = p.feet(_dp);
    for (let i = this.dirs.length - 1; i >= 0; i--) {
      const d = this.dirs[i];
      d.t += dt;
      if (d.t >= DIR_LIFE) { d.el.remove(); this.dirs.splice(i, 1); continue; }
      const to = _dt.copy(d.from).sub(me).setY(0);
      // 0 = 正前方（屏幕上方），顺时针为正（右边）
      const ang = Math.atan2(fwd.x * to.z - fwd.z * to.x, fwd.x * to.x + fwd.z * to.z);
      const k = d.t / DIR_LIFE;
      const a = k < 0.08 ? k / 0.08 : k > 0.5 ? 1 - (k - 0.5) / 0.5 : 1;
      d.el.style.transform = `rotate(${ang.toFixed(3)}rad) translateY(-${DIR_RADIUS}px) scale(${(1.15 - 0.15 * Math.min(1, k * 4)).toFixed(3)})`;
      d.el.style.opacity = a.toFixed(3);
    }
  }

  // 提示信息：屏幕上方中间一条，3 秒后淡出
  feed(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'note ' + cls;
    d.textContent = text;
    this.el.notice.appendChild(d);
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3200);
    while (this.el.notice.children.length > 3) this.el.notice.firstChild.remove();
  }

  damageNumber(pos, amount, head) {
    const d = document.createElement('div');
    d.className = 'dmg' + (head ? ' head' : '');
    d.textContent = Math.round(amount);
    this.el.layer.appendChild(d);
    this.floaters.push({
      el: d, pos: pos.clone(), t: 0,
      dx: (Math.random() - 0.5) * 30,
    });
  }

  _updateFloaters(dt) {
    const v = new THREE.Vector3();
    const w = innerWidth, h = innerHeight;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t > 0.8) { f.el.remove(); this.floaters.splice(i, 1); continue; }
      v.copy(f.pos); v.y += f.t * 0.9;
      v.project(this.camera);
      if (v.z > 1) { f.el.style.opacity = 0; continue; }
      const x = (v.x * 0.5 + 0.5) * w + f.dx * f.t;
      const y = (-v.y * 0.5 + 0.5) * h;
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.3 - f.t)})`;
      f.el.style.opacity = (1 - f.t / 0.8).toFixed(2);
    }
  }
}

function setSkill(el, cd, max) {
  const ready = cd <= 0;
  el.classList.toggle('ready', ready);
  el.style.setProperty('--cd', ready ? 0 : (cd / max));
  setText(el._cd || (el._cd = el.querySelector('.cd')), ready ? '' : Math.ceil(cd));
}

// 开着狙击镜时，只显示落在圆形镜片里的标记（镜片外是黑的）。镜片半径和 style.css 里 #scope 的 --r 一致
function inScope(p, ndc, w, h) {
  if (!p.scoped) return true;
  const r = Math.min(h, w) * 0.44 * 0.96;
  return Math.hypot(ndc.x * 0.5 * w, ndc.y * 0.5 * h) < r;
}
