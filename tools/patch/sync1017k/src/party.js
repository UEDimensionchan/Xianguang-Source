import { net } from './net.js';
import { settings, setSetting } from './settings.js';

// 组队联机界面：创建房间 / 寻找房间。
// 创建房间后直接进入地图（比赛不开始），等房主按开始；自己的房间会出现在别人的「寻找房间」列表里。
// onEnter(room)：进入房间对应的地图（由 main.js 加载地图、生成角色，比赛停在等待阶段）
export function setupParty({ stage, maps, toast, getProfile, onEnter }) {
  const ranked = maps.filter((m) => m.mode === 'ranked');
  const el = document.createElement('div');
  el.className = 'mx-modal pt-modal';
  el.innerHTML = `<div class="mx-box pt-box glass">
    <div class="mx-head"><div class="mt">组队联机</div>
      <div class="mx-tabs pt-tabs"><a data-v="create"><b>创建房间</b><span>CREATE</span></a><a data-v="find"><b>寻找房间</b><span>BROWSE</span></a></div>
      <div class="pt-srv"><i class="dot"></i><span class="st">未连接</span><input class="addr" spellcheck="false" title="联机服务器地址"><button class="re">连接</button></div>
      <a class="mx-x" title="关闭"></a></div>
    <section class="pt-view" data-v="create">
      <div class="pt-form">
        <label class="pt-row"><span>房间名称</span><input class="name" maxlength="24"></label>
        <div class="pt-row"><span>地图</span><div class="pt-maps">${ranked.map((m) => `<a data-map="${m.id}"><img src="Asset/UI/Lobby/map_${m.id}.jpg" alt=""><b>${m.name}</b><em>${m.en}</em></a>`).join('')}</div></div>
        <div class="pt-row"><span>人数上限</span><div class="pt-seg max">${[2, 4, 6, 8].map((n) => `<button data-n="${n}">${n} 人</button>`).join('')}</div></div>
        <p class="pt-note pt-lan" hidden></p>
        <p class="pt-note">创建后会直接进入地图等待，其他玩家可以在「寻找房间」里看到并加入；人到齐后由房主按 <kbd>Enter</kbd> 开始。空位由 AI 补上。</p>
      </div>
    </section>
    <section class="pt-view" data-v="find">
      <div class="pt-bar"><button class="pt-search">搜索房间</button><span class="pt-count"></span></div>
      <div class="pt-list"><div class="pt-empty">点击「搜索房间」查找服务器上的房间</div></div>
    </section>
    <div class="mx-foot"><span class="info"></span><button class="mx-cancel">取消</button><button class="mx-ok pt-ok">创建房间</button></div>
  </div>`;
  stage.appendChild(el);
  const $ = (s) => el.querySelector(s);
  let view = 'create', map = ranked[0]?.id, max = 8, busy = false;

  // PC 版：本机自带联机服务器，显示局域网地址，朋友填这个地址就能找到你的房间
  try {
    const L = window.native?.lanInfo?.();
    if (L?.server && L.ips.length) {
      const lan = $('.pt-lan');
      lan.hidden = false;
      lan.innerHTML = `本机已开启联机服务器 · 局域网好友在「寻找房间」右上角填：${L.ips.map((ip) => `<code>ws://${ip}:${L.port}</code>`).join(' 或 ')}`;
    }
  } catch (e) { /* 网页版没有 */ }

  // —— 服务器连接 ——
  const addr = $('.addr');
  addr.value = settings.serverUrl;
  const setStatus = (s, text) => {
    $('.pt-srv').dataset.s = s;
    $('.pt-srv .st').textContent = text || { on: '已连接', connecting: '连接中…', off: '未连接' }[s];
  };
  net.on('status', (s) => setStatus(s));
  async function connect() {
    let url = addr.value.trim() || 'ws://localhost:8787';
    if (!/^wss?:\/\//.test(url)) url = 'ws://' + url;
    if (!/:\d+/.test(url.replace(/^wss?:\/\//, ''))) url += ':8787';
    addr.value = url;
    if (url !== settings.serverUrl) setSetting('serverUrl', url);
    try {
      setStatus('connecting');
      const p = getProfile();
      await net.connect(url, p);
      setStatus('on');
      return true;
    } catch (e) {
      setStatus('off', '连接失败');
      toast(`连不上联机服务器（${url}）：${e.message}`);
      return false;
    }
  }
  $('.re').onclick = () => { net.close(); connect().then((ok) => ok && view === 'find' && search()); };
  addr.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') $('.re').click(); };

  // —— 创建 ——
  const pickMap = (id) => { map = id; el.querySelectorAll('.pt-maps a').forEach((a) => a.classList.toggle('on', a.dataset.map === id)); };
  el.querySelectorAll('.pt-maps a').forEach((a) => { a.onclick = () => pickMap(a.dataset.map); });
  const pickMax = (n) => { max = n; el.querySelectorAll('.pt-seg.max button').forEach((b) => b.classList.toggle('on', +b.dataset.n === n)); };
  el.querySelectorAll('.pt-seg.max button').forEach((b) => { b.onclick = () => pickMax(+b.dataset.n); });
  $('.name').onkeydown = (e) => e.stopPropagation();

  async function create() {
    if (busy) return;
    if (!net.online && !(await connect())) return;
    busy = true;
    try {
      const room = await net.createRoom({ name: $('.name').value.trim() || `${getProfile().name}的房间`, map, max });
      close();
      onEnter(room, true);
    } catch (e) { toast('创建房间失败：' + e.message); }
    busy = false;
  }

  // —— 寻找 ——
  const mapName = (id) => maps.find((m) => m.id === id)?.name || id;
  async function search() {
    if (!net.online && !(await connect())) return;
    const list = $('.pt-list');
    list.innerHTML = '<div class="pt-empty">正在搜索…</div>';
    $('.pt-search').disabled = true;
    try {
      const rooms = await net.listRooms();
      $('.pt-count').textContent = `找到 ${rooms.length} 个房间`;
      list.innerHTML = rooms.length ? rooms.map((r) => {
        const full = r.players.length >= r.max, playing = r.state === 'playing';
        return `<div class="pt-room" data-id="${r.id}">
          <img src="Asset/UI/Lobby/map_${r.map}.jpg" alt="">
          <div class="nm"><b></b><span>房主 <i></i> · ${mapName(r.map)}</span></div>
          <div class="ps"><b>${r.players.length}</b> / ${r.max}</div>
          <div class="sv ${playing ? 'play' : ''}">${playing ? '游戏中' : '等待中'}</div>
          <button class="pt-join" ${full ? 'disabled' : ''}>${full ? '已满' : '加入'}</button></div>`;
      }).join('') : '<div class="pt-empty">暂时没有房间，去「创建房间」开一个吧</div>';
      // 名字用 textContent 填（玩家自己起的名字，不当 HTML）
      list.querySelectorAll('.pt-room').forEach((row, i) => { row.querySelector('.nm b').textContent = rooms[i].name; row.querySelector('.nm i').textContent = rooms[i].host; });
      list.querySelectorAll('.pt-join').forEach((b) => { b.onclick = () => join(b.closest('.pt-room').dataset.id); });
    } catch (e) {
      list.innerHTML = `<div class="pt-empty err"></div>`;
      list.firstChild.textContent = '搜索失败：' + e.message;
    }
    $('.pt-search').disabled = false;
  }
  async function join(id) {
    if (busy) return;
    busy = true;
    try {
      const room = await net.joinRoom(id);
      close();
      onEnter(room, false);
    } catch (e) { toast('加入失败：' + e.message); search(); }
    busy = false;
  }
  $('.pt-search').onclick = search;

  // —— 页签 / 开关 ——
  function show(v) {
    view = v;
    el.querySelectorAll('.pt-tabs a').forEach((a) => a.classList.toggle('on', a.dataset.v === v));
    el.querySelectorAll('.pt-view').forEach((s) => s.classList.toggle('on', s.dataset.v === v));
    $('.pt-ok').textContent = v === 'create' ? '创建房间' : '刷新列表';
    $('.info').innerHTML = v === 'create' ? '房主可以随时开始，空位由 AI 补上' : '只显示同一台联机服务器上的房间';
    if (v === 'find') search();
  }
  el.querySelectorAll('.pt-tabs a').forEach((a) => { a.onclick = () => show(a.dataset.v); });
  $('.pt-ok').onclick = () => (view === 'create' ? create() : search());
  const close = () => el.classList.remove('on');
  $('.mx-x').onclick = close;
  $('.mx-cancel').onclick = close;
  el.onclick = (e) => { if (e.target === el) close(); };
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.classList.contains('on')) close(); });

  return {
    open(v = 'create', mapId) {
      $('.name').value = `${getProfile().name}的房间`;
      if (ranked.some((m) => m.id === mapId)) map = mapId; // 默认用模式窗口里选好的竞技地图
      pickMap(ranked.some((m) => m.id === map) ? map : ranked[0]?.id); pickMax(max);
      el.classList.add('on');
      show(v);
      if (!net.online) connect();
    },
  };
}
