import * as THREE from 'three';
import { net } from './net.js';
import { Puppet, loadBotVRM } from './bots.js';
import { WEAPONS } from './weapons.js';

// 联机对战（组队房间）：
//  · 每个玩家只负责自己：自己的移动、开枪、受伤、阵亡都在自己电脑上算，再告诉别人
//  · 房主负责 AI：空位上的 AI 只在房主电脑上跑，其他人看到的是房主发来的位置（替身）
//  · 打中别人：在打的人这边判定命中，把伤害发给被打的人（或房主，如果打的是 AI），由对方扣血；
//    被打倒的一方广播击杀，所有人各自记分，比分保持一致
// 消息（都经服务器转发给同房间其他人，服务器会附上 from = 发送者 id）：
//  game.state  自己的位置 / 朝向 / 动作状态（每秒 15 次）
//  game.bots   房主：所有 AI 的状态（每秒 10 次）
//  game.roster 房主：AI 名单（开局、有人加入时）
//  game.fire   开枪（弹道终点，用来画火光和弹道）       game.proj  扔炸弹 / 发射火箭（只画）
//  game.hit    打中真人：{ to, dmg, head, by }            game.hitbot 打中 AI：{ bot, dmg, head, by }（房主处理）
//  game.kill   有人阵亡：{ k: 击杀者 id, v: 阵亡者 id, h }  game.emote 发表情
const STATE_HZ = 20, BOTS_HZ = 12;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Multiplayer {
  constructor(game, { loader, characters, animData, room }) {
    this.game = game;
    this.loader = loader; this.characters = characters; this.animData = animData;
    this.myId = net.id;
    this.objs = new Map();                 // id → 角色（替身、房主的 AI）
    this.loading = new Set();
    this.isHost = room.hostId === net.id;
    this.myTeam = (net.room?.players || room.players || []).find((p) => p.id === net.id)?.team || 'ally'; // 服务器分的绝对队伍（ally = A 队）
    this.stateT = 0; this.botsT = 0;
    this.offs = [];
    game.player.netId = net.id;
    game.mp = this;
    game.match.mp = this;
    if (this.myTeam !== 'ally') game.match.flipSides();
    const on = (t, fn) => this.offs.push(net.on(t, fn));
    on('room.update', (m) => this.syncPlayers(m.room.players));
    on('game.state', (m) => this._obj(m.from)?.setState?.(m));
    on('game.bots', (m) => { if (!this.isHost) for (const s of m.s) this._botState(s); });
    on('game.roster', (m) => { if (!this.isHost) this._roster(m.bots); });
    on('game.join', () => { if (this.isHost && this.rosterSent) this.sendRoster(); });
    on('game.leave', (m) => this.removePlayer(m.id));
    on('game.fire', (m) => this._obj(m.by || m.from)?.showFire?.(m.ends));
    on('game.proj', (m) => this._proj(m));
    on('game.hit', (m) => this._hit(m));
    on('game.hitbot', (m) => this._hitBot(m));
    on('game.kill', (m) => this._kill(m));
    on('game.env', (m) => { if (!this.isHost) this.game.env?.applyNet(m); });
    on('game.match', (m) => { if (!this.isHost) this._matchState(m); });
    on('game.end', (m) => { if (!this.isHost) { this._matchState(m); this.game.match.finish(true); } });
    on('game.reset', () => this.game.onMatchReset?.());
    on('game.emote', (m) => { const o = this._obj(m.from); if (o) game.emotes?.show(o, m.id); });
    // 加载地图期间可能已经有人加入了：用最新的房间名单
    this.syncPlayers(net.room?.players || room.players || []);
  }

  // 房主的 AI 有 netId；真人用服务器给的 id
  _obj(id) {
    if (id == null) return null;
    if (id === this.myId) return this.game.player;
    return this.objs.get(id) || null;
  }
  relTeam(abs) { return abs === this.myTeam ? 'ally' : 'enemy'; }
  absTeam(rel) { return rel === 'ally' ? this.myTeam : (this.myTeam === 'ally' ? 'enemy' : 'ally'); }

  // —— 真人：房间名单变化 → 加 / 删替身 ——
  syncPlayers(players) {
    const ids = new Set(players.map((p) => p.id));
    for (const p of players) if (p.id !== this.myId && !this.objs.has(p.id)) this._addPuppet({ id: p.id, name: p.name, char: p.char, team: this.relTeam(p.team), kind: 'player', w: 0 });
    for (const [id, o] of this.objs) if (o.kind === 'player' && !ids.has(id)) this.removePlayer(id);
  }
  removePlayer(id) {
    const o = this.objs.get(id);
    if (!o) return;
    this.objs.delete(id);
    this.game.match.removeBot(o);
    this.game.hud.feed(`「${o.name}」离开了房间`);
    this.game.hud.teamFaces?.();
  }
  async _addPuppet({ id, name, char, team, kind, w }) {
    if (this.objs.has(id) || this.loading.has(id)) return;
    this.loading.add(id);
    try {
      const ch = this.characters.find((c) => c.id === char) || this.characters[0];
      const p = new Puppet(this.game, this.game.match, { team, name, charName: ch.name, weaponId: WEAPONS[w || 0]?.id || 'ar', netId: id, kind, net, skill: {} });
      const vrm = await loadBotVRM(this.loader, ch.file);
      p.setModel(vrm, this.animData);
      await p.arm();
      if (!this.loading.has(id)) { p.pivot.removeFromParent(); p.gun?.removeFromParent(); return; } // 加载期间离开了
      p.alive = false; p.pivot.visible = false; // 收到第一份位置之前先藏起来
      const first = p.setState.bind(p);
      p.setState = (s) => {
        const firstTime = !p.hasPos;
        if (firstTime) { p.pivot.visible = true; p.alive = !!(s.f & 2); }
        first(s);
        if (firstTime) { p._animate(0.016, _v.set(0, 0, 0)); p.vrm.scene.updateMatrixWorld(true); this.game.hud.teamFaces?.(); } // 有了位置再拍头像
      };
      this.objs.set(id, p);
      this.game.match.bots.push(p);
      if (kind === 'player') this.game.hud.feed(`「${name}」加入了对局`, 'good');
      this.game.hud.teamFaces?.();
    } catch (e) { console.warn('联机角色加载失败', id, e); }
    this.loading.delete(id);
  }

  // —— 开局（房主按开始）——
  onStart(players) {
    if (!this.isHost) return;
    // 真人顶替 AI：每边按真人数量去掉同样多的 AI（房主自己在 A 队，本来就不占 AI 位）
    const M = this.game.match;
    const others = players.filter((p) => p.id !== this.myId);
    const need = { ally: others.filter((p) => this.relTeam(p.team) === 'ally').length, enemy: others.filter((p) => this.relTeam(p.team) === 'enemy').length };
    for (const team of ['ally', 'enemy']) {
      const bots = M.bots.filter((b) => b.team === team && !(b instanceof Puppet));
      for (let i = 0; i < Math.min(need[team], bots.length); i++) M.removeBot(bots[bots.length - 1 - i]);
    }
    this.game.hud.teamFaces?.();
    this.sendRoster();
  }
  _hostBots() { return this.game.match.bots.filter((b) => !(b instanceof Puppet)); }
  sendRoster() {
    this.rosterSent = true;
    let k = 0;
    for (const b of this._hostBots()) b.netId ||= `b${k++}_${Math.random().toString(36).slice(2, 5)}`;
    net.send('game.roster', { bots: this._hostBots().map((b) => ({ id: b.netId, name: b.name, char: b.charId, w: b.wi, team: this.absTeam(b.team) })) });
  }
  // 客户端：按房主给的名单建 AI 替身
  _roster(list) {
    const ids = new Set(list.map((b) => b.id));
    for (const b of list) if (!this.objs.has(b.id)) this._addPuppet({ id: b.id, name: b.name, char: b.char, team: this.relTeam(b.team), kind: 'bot', w: b.w });
    for (const [id, o] of this.objs) if (o.kind === 'bot' && !ids.has(id)) { this.objs.delete(id); this.game.match.removeBot(o); }
  }
  _botState(s) {
    const o = this.objs.get(s[0]);
    if (!o) return;
    o.setState({ p: [s[1], s[2], s[3]], y: s[4], pt: s[5], v: [s[6], s[7], s[8]], f: s[9], a: s[10], pp: s[11], w: s[12], e: s[13] });
  }

  // —— 比分 / 时间 / 天气：房主说了算 ——
  _absScore() { const S = this.game.match.score; return this.myTeam === 'ally' ? [S.ally, S.enemy] : [S.enemy, S.ally]; }
  _matchState(m) {
    const M = this.game.match;
    if (m.s) { const [a, b] = m.s; if (this.myTeam === 'ally') { M.score.ally = a; M.score.enemy = b; } else { M.score.ally = b; M.score.enemy = a; } }
    if (m.t != null && M.phase === 'live') M.timeLeft = m.t;
  }
  matchEnded() { if (this.isHost) net.send('game.end', { s: this._absScore(), t: this.game.match.timeLeft }); }
  requestReset() { net.send('game.reset', {}); this.game.onMatchReset?.(); }

  // —— 每帧：发自己的状态；房主再发 AI 的状态 ——
  update(dt) {
    if (this.isHost) {
      this.envT = (this.envT || 0) - dt;
      const E = this.game.env;
      if (E && (this.envT <= 0 || E.weather !== this._lastW)) {
        this.envT = 2; this._lastW = E.weather;
        net.send('game.env', { h: +E.hour.toFixed(3), w: E.weather });
      }
      this.matchT = (this.matchT || 0) - dt;
      if (this.matchT <= 0 && this.game.match.phase === 'live') { this.matchT = 1; net.send('game.match', { s: this._absScore(), t: +this.game.match.timeLeft.toFixed(1) }); }
    }
    const P = this.game.player;
    if ((this.stateT -= dt) <= 0) {
      this.stateT = 1 / STATE_HZ;
      const f = P.feet(_v);
      net.send('game.state', {
        p: [+f.x.toFixed(3), +f.y.toFixed(3), +f.z.toFixed(3)], y: +P.yaw.toFixed(3), pt: +P.pitch.toFixed(3),
        v: [+P.vel.x.toFixed(2), +P.vel.y.toFixed(2), +P.vel.z.toFixed(2)],
        f: (P.onFloor ? 1 : 0) | (P.alive ? 2 : 0) | (P.reloadT > 0 ? 4 : 0), w: P.wi, a: +P.ads.toFixed(2), pp: +P.paperAmt.toFixed(2), e: P.evPack,
      });
    }
    if (this.isHost && this.rosterSent && (this.botsT -= dt) <= 0) {
      this.botsT = 1 / BOTS_HZ;
      net.send('game.bots', {
        s: this._hostBots().filter((b) => b.netId).map((b) => {
          const f = b.feet(_v);
          return [b.netId, +f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2), +b.yaw.toFixed(3), +b.pitch.toFixed(3), +b.vel.x.toFixed(2), +b.vel.y.toFixed(2), +b.vel.z.toFixed(2),
            (b.onFloor ? 1 : 0) | (b.alive ? 2 : 0) | (b.reloadT > 0 ? 4 : 0), +b.ads.toFixed(2), +b.paperAmt.toFixed(2), b.wi, b.evPack];
        }),
      });
    }
  }

  // —— 本机发出去的事件 ——
  sendFire(ends) { net.send('game.fire', { ends: ends.slice(0, 4).map((e) => [+e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2)]) }); }
  botFired(bot, ends) { if (this.isHost && bot.netId && !(bot instanceof Puppet)) net.send('game.fire', { by: bot.netId, ends: ends.map((e) => [+e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2)]) }); }
  sendProj(kind, pos, vec, spec) { net.send('game.proj', { kind, p: pos.toArray().map((x) => +x.toFixed(2)), d: vec.toArray().map((x) => +x.toFixed(3)), w: spec ? 'rocket' : '' }); }
  sendEmote(id) { net.send('game.emote', { id }); }
  // 自己阵亡（Player.damage → game.onPlayerDeath）
  playerDied(by) { net.send('game.kill', { k: by?.netId ?? null, v: this.myId, h: false }); }
  // 房主：AI 被打倒
  botKilled(killer, victim, head) {
    if (!this.isHost || !victim?.netId || victim instanceof Puppet || victim === this.game.player) return;
    net.send('game.kill', { k: killer?.netId ?? null, v: victim.netId, h: !!head });
  }

  // —— 收到的事件 ——
  _proj(m) {
    const fx = this.game.fx;
    const p = _v.fromArray(m.p).clone(), d = _v2.fromArray(m.d).clone();
    if (m.kind === 'bomb') fx.throwBomb(p, d, true);
    else { const R = WEAPONS.find((w) => w.rocket)?.rocket; if (R) fx.fireRocket(p, d, R, null, true); }
  }
  // 我被打中（伤害在打我的人那边算好了）
  _hit(m) {
    if (m.to !== this.myId) return;
    const P = this.game.player;
    if (!P.alive || !this.game.match.live) return;
    const by = this._obj(m.by) || this._obj(m.from);
    const from = by ? by.feet(new THREE.Vector3()).add(_v2.set(0, 1.3, 0)) : null;
    P.damage(m.dmg, from, by, m.head);
  }
  // 房主：别人打中了我的 AI
  _hitBot(m) {
    if (!this.isHost) return;
    const bot = this._hostBots().find((b) => b.netId === m.bot);
    const by = this._obj(m.by) || this._obj(m.from);
    if (bot && bot.alive) bot.damage(m.dmg, by ? by.feet(new THREE.Vector3()) : bot.feet(new THREE.Vector3()), by, m.head);
  }
  // 别人那边有人阵亡：记分 + 击杀播报
  _kill(m) {
    const victim = this._obj(m.v) || this._hostBots().find((b) => b.netId === m.v);
    const killer = this._obj(m.k) || (m.k ? this._hostBots().find((b) => b.netId === m.k) : null);
    if (!victim || victim === this.game.player) return;
    if (victim instanceof Puppet) { victim.deaths = (victim.deaths || 0) + 1; if (victim.alive) { victim.alive = false; victim.anim?.die(); } }
    this.game.match.onKill(killer, victim, m.h);
  }

  dispose() { this.offs.forEach((f) => f()); this.offs = []; }
}
