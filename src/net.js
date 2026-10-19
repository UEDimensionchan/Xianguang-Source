// 联机客户端：连接联机服务器（server/server.js），请求 / 推送消息。
// 用法：await net.connect(url, { name, char })；const { rooms } = await net.req('room.list')；net.on('room.update', fn)
// 局内消息用 net.send('game.xxx', {...})，服务器会原样转发给同房间的其他人（带上 from）。

class Net {
  constructor() {
    this.ws = null; this.url = ''; this.id = null; this.room = null;
    this._rid = 0; this._pending = new Map(); this._subs = new Map();
    this.status = 'off'; // off / connecting / on
  }

  get online() { return this.status === 'on'; }

  connect(url, hello = {}) {
    if (this.ws && this.url === url && this.status !== 'off') return this._ready;
    this.close();
    this.url = url; this.status = 'connecting'; this._emit('status', this.status);
    this._ready = new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { this.status = 'off'; this._emit('status', this.status); reject(new Error('服务器地址不对')); return; }
      this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('连接超时')); try { ws.close(); } catch (e) { /* 已关闭 */ } }, 5000);
      ws.onopen = async () => {
        clearTimeout(timer);
        try {
          const r = await this.req('hello', hello);
          this.id = r.id; this.status = 'on'; this._emit('status', this.status);
          resolve(this);
        } catch (e) { reject(e); }
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('连不上服务器')); };
      ws.onclose = () => {
        clearTimeout(timer);
        const was = this.status;
        this.status = 'off'; this.ws = null; this.room = null;
        for (const p of this._pending.values()) p.reject(new Error('连接已断开'));
        this._pending.clear();
        if (was === 'on') this._emit('disconnect');
        this._emit('status', this.status);
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'res') {
          const p = this._pending.get(m.rid); if (!p) return;
          this._pending.delete(m.rid);
          if (m.ok) p.resolve(m); else p.reject(new Error(m.err || '请求失败'));
          return;
        }
        if (m.t === 'room.update' || m.t === 'room.started') this.room = m.room;
        this._emit(m.t, m);
      };
    });
    return this._ready;
  }

  // 请求：返回 Promise（服务器回复或报错）
  req(t, data = {}) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('还没连上服务器'));
    const rid = ++this._rid;
    return new Promise((resolve, reject) => {
      this._pending.set(rid, { resolve, reject });
      this.ws.send(JSON.stringify({ t, rid, ...data }));
      setTimeout(() => { if (this._pending.delete(rid)) reject(new Error('服务器没有回应')); }, 8000);
    });
  }
  // 单向消息（局内同步用，不等回复）
  send(t, data = {}) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t, ...data })); }

  on(t, fn) { if (!this._subs.has(t)) this._subs.set(t, new Set()); this._subs.get(t).add(fn); return () => this._subs.get(t)?.delete(fn); }
  _emit(t, m) { for (const fn of this._subs.get(t) || []) { try { fn(m); } catch (e) { console.warn(e); } } }

  // —— 房间 ——
  async createRoom(opts) { const r = await this.req('room.create', opts); this.room = r.room; return r.room; }
  async joinRoom(id) { const r = await this.req('room.join', { id }); this.room = r.room; return r.room; }
  async listRooms() { return (await this.req('room.list')).rooms; }
  async leaveRoom() { if (this.online) await this.req('room.leave').catch(() => {}); this.room = null; }
  startRoom() { return this.req('room.start'); }
  get isHost() { return !!this.room && this.room.hostId === this.id; }

  close() { try { this.ws?.close(); } catch (e) { /* 已关闭 */ } this.ws = null; this.status = 'off'; this.room = null; }
}

export const net = new Net();
if (typeof window !== 'undefined') window.__net = net;
