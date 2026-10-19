// 弦光 联机服务器
// 负责：玩家连接、房间（创建 / 列表 / 加入 / 离开 / 准备 / 开始）、局内消息转发。
// 运行：node server.js [端口]，默认 8787。PC 版游戏启动时也会在本机自动开一个（见 resources/app/main.js）。
//
// 协议：WebSocket，每条消息是 JSON：{ t: 类型, ...数据, rid?: 请求编号 }。
// 带 rid 的请求，服务器回 { t: 'res', rid, ok, ...结果 } 或 { t: 'res', rid, ok: false, err }。
// 服务器主动推送：room.update（房间信息变了）、room.started（开局）、room.closed、game.*（其他玩家的局内消息）。
'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');

const VERSION = 1;
const MAX_ROOMS = 200;

function createServer({ port = 8787, log = console.log } = {}) {
  const clients = new Map();   // id -> { id, ws, name, char, roomId, ready, alive }
  const rooms = new Map();     // id -> { id, name, hostId, map, max, mode, state, members: [id], created }
  let nextId = 1;
  const newId = (p) => p + (nextId++).toString(36) + Math.random().toString(36).slice(2, 6);

  const send = (c, msg) => { if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };
  const roomInfo = (r) => ({
    id: r.id, name: r.name, map: r.map, max: r.max, mode: r.mode, state: r.state, host: clients.get(r.hostId)?.name || '?', hostId: r.hostId,
    players: r.members.map((id) => { const c = clients.get(id); return { id, name: c?.name || '?', char: c?.char || '', ready: !!c?.ready, team: c?.team || 'ally' }; }),
  });
  const broadcast = (r, msg, exceptId) => { for (const id of r.members) if (id !== exceptId) send(clients.get(id), msg); };
  const pushRoom = (r) => broadcast(r, { t: 'room.update', room: roomInfo(r) });

  function leaveRoom(c) {
    const r = rooms.get(c.roomId);
    c.roomId = null; c.ready = false;
    if (!r) return;
    r.members = r.members.filter((id) => id !== c.id);
    if (!r.members.length) { rooms.delete(r.id); log(`[房间] 关闭 ${r.name}`); return; }
    if (r.hostId === c.id) r.hostId = r.members[0]; // 房主走了：交给下一个人
    broadcast(r, { t: 'game.leave', id: c.id });
    pushRoom(r);
  }
  // 分队：轮流放进两边
  const assignTeams = (r) => r.members.forEach((id, i) => { const c = clients.get(id); if (c) c.team = i % 2 ? 'enemy' : 'ally'; });

  const handlers = {
    hello(c, m) {
      c.name = String(m.name || '玩家').slice(0, 16);
      c.char = String(m.char || '').slice(0, 32);
      return { id: c.id, version: VERSION };
    },
    'room.list'() {
      return { rooms: [...rooms.values()].map(roomInfo) };
    },
    'room.create'(c, m) {
      if (rooms.size >= MAX_ROOMS) throw new Error('服务器房间已满');
      if (c.roomId) leaveRoom(c);
      const r = {
        id: newId('r'), name: String(m.name || `${c.name}的房间`).slice(0, 24), hostId: c.id,
        map: String(m.map || 'street'), max: Math.max(2, Math.min(8, m.max | 0 || 8)), mode: 'team', state: 'waiting', members: [c.id], created: Date.now(),
      };
      rooms.set(r.id, r);
      c.roomId = r.id; c.ready = true;
      assignTeams(r);
      log(`[房间] ${c.name} 创建了 ${r.name}（${r.map}）`);
      return { room: roomInfo(r) };
    },
    'room.join'(c, m) {
      const r = rooms.get(m.id);
      if (!r) throw new Error('房间不存在或已关闭');
      if (r.members.includes(c.id)) return { room: roomInfo(r) };
      if (r.members.length >= r.max) throw new Error('房间已满');
      if (c.roomId) leaveRoom(c);
      r.members.push(c.id);
      c.roomId = r.id; c.ready = false;
      assignTeams(r);
      broadcast(r, { t: 'game.join', id: c.id, name: c.name, char: c.char }, c.id);
      pushRoom(r);
      return { room: roomInfo(r) };
    },
    'room.leave'(c) { leaveRoom(c); return {}; },
    'room.ready'(c, m) {
      const r = rooms.get(c.roomId); if (!r) throw new Error('不在房间里');
      c.ready = !!m.ready; pushRoom(r); return {};
    },
    'room.start'(c) {
      const r = rooms.get(c.roomId); if (!r) throw new Error('不在房间里');
      if (r.hostId !== c.id) throw new Error('只有房主可以开始');
      r.state = 'playing';
      const seed = Math.floor(Math.random() * 1e9);
      broadcast(r, { t: 'room.started', room: roomInfo(r), seed });
      log(`[房间] ${r.name} 开始游戏（${r.members.length} 人）`);
      return {};
    },
    'room.end'(c) {
      const r = rooms.get(c.roomId); if (!r || r.hostId !== c.id) return {};
      r.state = 'waiting'; pushRoom(r); return {};
    },
  };

  const server = http.createServer((req, res) => {
    // 健康检查 / 在浏览器里打开看看服务器状态
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ name: '弦光 联机服务器', version: VERSION, players: clients.size, rooms: rooms.size }));
  });
  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

  wss.on('connection', (ws, req) => {
    const c = { id: newId('p'), ws, name: '玩家', char: '', roomId: null, ready: false, alive: true, team: 'ally' };
    clients.set(c.id, c);
    log(`[连接] ${c.id} 来自 ${req.socket.remoteAddress}（在线 ${clients.size}）`);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(data); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      // 局内消息（位置、开火、受伤……）：原样转发给同房间的其他人，附上发送者 id
      if (m.t.startsWith('game.')) {
        const r = rooms.get(c.roomId);
        if (r) { m.from = c.id; broadcast(r, m, c.id); }
        return;
      }
      const h = handlers[m.t];
      if (!h) { if (m.rid) send(c, { t: 'res', rid: m.rid, ok: false, err: '未知请求 ' + m.t }); return; }
      try {
        const out = h(c, m) || {};
        if (m.rid) send(c, { t: 'res', rid: m.rid, ok: true, ...out });
      } catch (e) {
        if (m.rid) send(c, { t: 'res', rid: m.rid, ok: false, err: e.message });
      }
    });
    ws.on('close', () => { leaveRoom(c); clients.delete(c.id); log(`[断开] ${c.name}（在线 ${clients.size}）`); });
  });

  // 心跳：30 秒没回应的连接断掉
  const beat = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false; c.ws.ping();
    }
  }, 30000);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      log(`弦光 联机服务器已启动：ws://localhost:${port}`);
      resolve({ port, close: () => { clearInterval(beat); wss.close(); server.close(); } });
    });
  });
}

module.exports = { createServer };

if (require.main === module) {
  const port = +process.argv[2] || +process.env.PORT || 8787;
  createServer({ port }).catch((e) => { console.error('启动失败：', e.message); process.exit(1); });
}
