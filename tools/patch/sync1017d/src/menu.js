// ESC 菜单：局内 = 暂停菜单（继续 / 设置 / 操作说明 / 重置训练 / 返回大厅）
//          大厅 = 系统菜单（返回 / 设置 / 操作说明 / 更新公告 / 退出游戏）
// 右侧是内容区：局内默认显示本局战绩，大厅默认显示更新公告；设置、操作说明也在右侧切换。
import { settings, setSetting, resetSettings, applyPreset, DEFAULTS, XH_COLORS, ACTIONS, keyLabel, bindKey, resetKeys, RESERVED, findKey, swapKey } from './settings.js';
import { bindLobbySounds, uiSound } from './uisound.js';

const ICON = {
  resume: '<path d="M8 5.5v13l10.5-6.5z"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8l1.6 2.3 2.7-.8.6 2.8 2.7 1-1 2.6 1.9 2-2.2 1.8.6 2.8-2.8.4-.8 2.7-2.6-1.1L12 21.2l-1.6-2.3-2.7.8-.6-2.8-2.7-1 1-2.6-1.9-2 2.2-1.8-.6-2.8 2.8-.4.8-2.7 2.6 1.1z"/>',
  controls: '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><path d="M6 10h1M9 10h1M12 10h1M15 10h1M18 10h0M7 14h10"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4v4.5h4.5"/>',
  notice: '<path d="M5 4.5h14v15H5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
  overview: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  leave: '<path d="M14 4.5h5.5v15H14"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  quit: '<path d="M12 3v8"/><path d="M6.6 6.6a7.5 7.5 0 1 0 10.8 0"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;

const NOTES = [
  ['火箭筒追踪', '火箭筒右键瞄准时，把准星对准敌人约 1.4 秒即可锁定（锁定框收紧变红并有提示音），这时发射的火箭弹会追踪目标：会自动打提前量，离目标 1.5 米内近炸。转弯能力有上限，贴脸或最后一刻急转侧闪仍能躲开；视线被挡住时无法锁定。'],
  ['手绘画风', '画面改成日系动画的手绘风格：所有物体带手描墨线，纸张颗粒质感，阴影更柔和，暗部偏冷、亮部偏暖；雨天积水能实时倒映出人物和场景，镜头上会挂雨珠。设置 → 画面里可以单独关闭「手绘描线」和「积水倒影」。'],
  ['标记与描边', '狙击镜开着时也会显示队友名字和发现的敌人标记（只显示在镜片范围内）。竞技模式里敌方角色加了红色描边，远处、暗处更容易看清，被墙挡住时不会透出来。'],
  ['雨天积水', '下雨后地面会慢慢变湿、积出水洼，雨点在水面打出涟漪；跑过水洼会溅起水花，还有踩水声，跳下来落进水里溅得更大。雨停后约一分钟慢慢变干。命中特效不再透墙显示。'],
  ['昼夜与天气', '对局里有完整的昼夜循环（一天约 12 分钟）和动态天气：晴、樱吹雪、多云、小雨、雷雨，每 1.5～3 分钟渐变切换。夜晚棱镜和灯带会发光。小地图下方显示当前时间和天气，设置 → 画面里可以关闭。'],
  ['竞技模式', '新地图「棱镜中枢」：4V4 团队竞技，AI 队友和对手，先拿到 30 击杀的队伍获胜。小地图只显示队友，按住 Tab 看比分。'],
  ['新地图', '「晴空露台」与「折光靶场」上线，旧城试炼场下线。大厅右下角的模式卡可以选择训练地图。'],
  ['命中反馈', '击中目标会迸出鲜红色火花，爆头更大更亮；霰弹枪每颗弹丸单独显示。'],
  ['界面音效', '大厅按钮全部配上了音效，音量统一调整过，可在「设置 · 声音」里单独调节。'],
  ['手感', '修复了台阶较深时卡在第二级的问题；坡道和楼梯可以顺畅上下。'],
];

const TABS = [
  ['video', '画面'], ['audio', '声音'], ['input', '鼠标'], ['keys', '键位'], ['hud', '界面'],
];
const ROWS = {
  video: [
    ['§', '画质'],
    ['quality', 'seg', '画质预设', { opts: [['low', '低'], ['medium', '中'], ['high', '高'], ['ultra', '极致'], ['custom', '自定义', true]] }],
    ['scale', 'range', '渲染精度', { min: 50, max: 150, step: 10, unit: '%' }],
    ['autoRes', 'toggle', '动态分辨率'],
    ['shadowQ', 'seg', '实时阴影', { opts: [['off', '关'], ['low', '低'], ['high', '高']] }],
    ['post', 'toggle', '后期效果（辉光 / 调色）'],
    ['ink', 'toggle', '手绘描线'],
    ['reflect', 'toggle', '积水倒影'],
    ['lensRain', 'toggle', '镜头雨滴'],
    ['§', '显示'],
    ['display', 'display', '显示模式'],
    ['fpsCap', 'seg', '帧率上限', { opts: [[30, '30'], [60, '60'], [120, '120'], [144, '144'], [0, '不限']] }],
    ['fov', 'range', '视野', { min: 60, max: 100, step: 1, unit: '°' }],
    ['showFps', 'toggle', '显示帧率'],
    ['§', '环境'],
    ['cycle', 'toggle', '昼夜循环'],
    ['weather', 'toggle', '动态天气'],
    ['gpu', 'gpu', '显卡'],
  ],
  audio: [
    ['master', 'range', '主音量', { min: 0, max: 100, step: 1, unit: '' }],
    ['sfx', 'range', '战斗音效', { min: 0, max: 100, step: 1, unit: '' }],
    ['ui', 'range', '界面音效', { min: 0, max: 100, step: 1, unit: '' }],
    ['muteBlur', 'toggle', '切到其他窗口时静音'],
  ],
  input: [
    ['sens', 'range', '鼠标灵敏度', { min: 0.2, max: 3, step: 0.05, unit: '×', fix: 2 }],
    ['adsSens', 'range', '开镜灵敏度', { min: 0.2, max: 2, step: 0.05, unit: '×', fix: 2 }],
    ['invertY', 'toggle', '反转 Y 轴'],
  ],
  hud: [
    ['xhColor', 'swatch', '准星颜色'],
    ['xhSize', 'range', '准星大小', { min: 60, max: 160, step: 10, unit: '%' }],
    ['dmgDir', 'toggle', '受击方向提示'],
  ],
};

// 全屏 / 窗口（F11 也能切）
export const isFullscreen = () => (window.native ? window.native.isFullscreen() : !!document.fullscreenElement);
export function setFullscreen(on) {
  // PC 版：用窗口自己的全屏（按 Esc 不会被浏览器退出全屏）
  if (window.native) { window.native.setFullscreen(on); return new Promise((r) => setTimeout(r, 120)); }
  try {
    if (on && !document.fullscreenElement) return document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    if (!on && document.fullscreenElement) return document.exitFullscreen().catch(() => {});
  } catch (e) { /* 不支持全屏 */ }
  return Promise.resolve();
}
// 当前用的显卡名（看是不是跑在独显上）
let _gpu = null;
function gpuInfo() {
  if (_gpu) return _gpu;
  let name = '未知';
  try {
    const gl = window.__game?.renderer?.getContext() || document.createElement('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || name;
  } catch (e) { /* 拿不到就算了 */ }
  // ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11) → 只留中间的型号
  let short = name;
  const am = name.match(/^ANGLE \((.*)\)$/);
  if (am) {
    const parts = am[1].split(', ');
    short = (parts[1] || parts[0]).replace(/\s*\(0x[0-9a-f]+\)/ig, '').replace(/\s+(Direct3D|vs_|ps_).*$/i, '').trim() || name;
  }
  const weak = /intel|uhd|iris|swiftshader|llvmpipe|microsoft basic|radeon\(tm\) graphics|vega \d+ graphics/i.test(short) && !/arc /i.test(short);
  return (_gpu = { name: short, weak });
}

export function initMenu({ context, info, onResume, onRestart, onLeave, onQuit }) {
  const root = document.createElement('div');
  root.id = 'esc';
  document.body.appendChild(root);
  let ctx = 'lobby', pane = 'overview', tab = 'video', opened = false, confirmAct = null;

  const items = () => ctx === 'game'
    ? [['resume', '继续游戏', 'RESUME'], ['overview', '本局战绩', 'MATCH STATS'], ['settings', '设置', 'SETTINGS'], ['controls', '操作说明', 'CONTROLS'], ...(info().ranked ? [] : [['restart', '重置训练', 'RESTART']])]
    : [['resume', '关闭菜单', 'CLOSE'], ['notice', '更新公告', 'PATCH NOTES'], ['settings', '设置', 'SETTINGS'], ['controls', '操作说明', 'CONTROLS']];

  function render() {
    const g = ctx === 'game';
    root.dataset.ctx = ctx;
    shown = '';
    root.innerHTML = `<div class="esc-bg"></div>
    <div class="esc-stage">
      <aside class="esc-side">
        <div class="esc-brand"><i></i>PRISM / LINK</div>
        <div class="esc-title"><b>${g ? '暂停' : '菜单'}</b><span>${g ? 'PAUSED' : 'SYSTEM'}</span></div>
        <div class="esc-meta">${g ? `<span>${info().map}</span><span>${info().ranked ? '团队竞技' : '训练模式'}</span><span class="tm">${info().time}</span>` : '<span>弦光 · 大厅</span><span>训练版本 0.3</span>'}</div>
        <nav class="esc-list">${items().map(([k, n, en], i) => `<a class="esc-item${k === 'resume' ? ' primary' : ''}" data-act="${k}" style="--i:${i}" tabindex="0">${svg(k === 'overview' ? 'overview' : k)}<b>${n}</b><span>${en}</span></a>`).join('')}</nav>
        <a class="esc-item danger" data-act="${g ? 'leave' : 'quit'}" style="--i:6" tabindex="0">${svg(g ? 'leave' : 'quit')}<b>${g ? '返回大厅' : '退出游戏'}</b><span>${g ? 'LEAVE MATCH' : 'QUIT GAME'}</span></a>
        <div class="esc-foot"><kbd>Esc</kbd>${g ? '鼠标已解锁 · 点「继续游戏」回到战斗' : '关闭菜单'}</div>
      </aside>
      <section class="esc-main"></section>
    </div>
    <div class="esc-confirm"><div class="box"><div class="mt"></div><p></p><div class="row"><button class="no">取消</button><button class="alt" hidden>覆盖</button><button class="ok">确认</button></div></div></div>
    <div class="esc-hint"></div>`;
    renderPane();
  }

  let shown = '';
  function renderPane() {
    const main = root.querySelector('.esc-main');
    root.querySelectorAll('.esc-item').forEach((a) => a.classList.toggle('on', a.dataset.act === pane));
    main.dataset.pane = pane;
    // 同一页重新渲染（比如改了一个设置）时不重播入场动画，也保持键位列表的滚动位置
    const key = pane + '/' + tab, same = key === shown && main.firstChild;
    const scroll = same ? main.querySelector('.esc-klist, .esc-rows')?.scrollTop || 0 : 0;
    shown = key;
    if (pane === 'overview') main.innerHTML = overviewHTML();
    else if (pane === 'notice') main.innerHTML = noticeHTML();
    else if (pane === 'controls') main.innerHTML = controlsHTML();
    else if (pane === 'settings') { main.innerHTML = settingsHTML(); bindSettings(main); }
    const kl = main.querySelector('.esc-klist, .esc-rows'); if (kl) kl.scrollTop = scroll;
    if (!same) { main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap'); }
  }

  const head = (t, en) => `<header class="esc-h"><b>${t}</b><span>${en}</span></header>`;

  function overviewHTML() {
    const s = info();
    return `${head('本局战绩', 'MATCH STATS')}
    <div class="esc-stats">
      <div><span>击杀</span><b>${s.kills}</b></div>
      <div><span>命中率</span><b>${s.acc}</b></div>
      <div><span>爆头命中</span><b>${s.heads}</b></div>
      <div><span>开火</span><b>${s.shots}</b></div>
    </div>
    <div class="esc-cards">
      <div class="esc-card map"><img src="Asset/UI/Lobby/map_${s.mapId}.jpg" alt=""><div><span>当前地图</span><b>${s.map}</b><em>${s.mapEn}</em></div></div>
      <div class="esc-card gun"><img src="Asset/UI/Lobby/gun_${s.weaponId}.png" alt=""><div><span>手持武器</span><b>${s.weapon}</b><em>${s.weaponCode}</em></div></div>
    </div>
    <p class="esc-tip"><i></i>${s.tip}</p>`;
  }

  function noticeHTML() {
    return `${head('更新公告', 'PATCH NOTES')}
    <div class="esc-notes">${NOTES.map(([t, d], i) => `<article style="--i:${i}"><b>${t}</b><p>${d}</p></article>`).join('')}</div>`;
  }

  // 操作说明按当前键位生成
  function controlsHTML() {
    const k = (id) => settings.keys[id].filter(Boolean).map(keyLabel);
    const w = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => settings.keys['w' + n][0]);
    const wDefault = w.every((c, i) => c === `Digit${i + 1}`);
    const list = [
      ['移动', ['forward', 'left', 'back', 'right'].map((id) => keyLabel(settings.keys[id][0]))], ['跳跃', k('jump')],
      ['射击', ['左键']], ['瞄准 / 开镜', ['右键']], ['换弹', k('reload')],
      ['切换武器', [wDefault ? '1 – 8' : w.map(keyLabel).join(' '), '滚轮']], ['纸化（侧身躲避）', k('paper')], ['纸鹤突进', k('dash')],
      ['墨水炸弹', k('bomb')], ['第一 / 第三人称', k('view')], ['菜单', ['Esc']],
    ];
    return `${head('操作说明', 'CONTROLS')}
    <div class="esc-keys">${list.map(([n, ks]) => `<div><span>${n}</span><em>${(ks.length ? ks : ['未绑定']).map((x) => `<kbd>${x}</kbd>`).join('<i>/</i>')}</em></div>`).join('')}</div>
    <p class="esc-tip"><i></i>键位可以在「设置 · 键位」里修改</p>`;
  }

  // 键位页
  let capture = null, keyNote = '';
  function keysHTML() {
    const groups = {};
    for (const [id, label, , g] of ACTIONS) (groups[g] ||= []).push([id, label]);
    const bind = (id, i) => {
      const c = settings.keys[id][i], on = capture && capture.a === id && capture.s === i;
      return `<button class="esc-bind${on ? ' cap' : ''}${c ? '' : ' empty'}" data-a="${id}" data-s="${i}">${on ? '按下新按键…' : keyLabel(c)}</button>`;
    };
    const fixed = (label, key) => `<div class="esc-krow"><span>${label}</span><button class="esc-bind fixed" disabled>${key}</button><button class="esc-bind fixed" disabled>—</button></div>`;
    return `<div class="esc-khead"><span></span><em>主按键</em><em>副按键</em></div>
    <div class="esc-klist">${Object.entries(groups).map(([g, rows]) => `<div class="esc-kgroup">${g}</div>
      ${g === '战斗' ? fixed('射击', '左键') + fixed('瞄准 / 开镜', '右键') : ''}
      ${rows.map(([id, label]) => `<div class="esc-krow${settings.keys[id].some(Boolean) ? '' : ' unbound'}"><span>${label}</span>${bind(id, 0)}${bind(id, 1)}</div>`).join('')}`).join('')}
      <div class="esc-kgroup">系统</div>${fixed('菜单', 'Esc')}</div>`;
  }
  function stopCapture() {
    capture = null;
    removeEventListener('keydown', onCapKey, true);
    removeEventListener('mousedown', onCapMouse, true);
  }
  let conflict = null; // 等玩家在冲突提示里选择：{ a, s, code, other }
  const SLOT = ['主按键', '副按键'];
  const kc = (c) => `<kbd>${keyLabel(c)}</kbd>`;
  function finishBind(code) {
    const { a, s } = capture;
    stopCapture();
    const other = findKey(code, a, s);
    if (other && other.id !== a) {
      // 冲突：问玩家是交换、覆盖还是取消
      conflict = { a, s, code, other };
      const name = ACTIONS.find((x) => x[0] === a)[1], old = settings.keys[a][s];
      ask('按键冲突',
        `${kc(code)} 已经是「${other.label}」的${SLOT[other.slot]}。<br>` +
        (old ? `交换后，「${other.label}」改用 ${kc(old)}，「${name}」使用 ${kc(code)}。` : `「${name}」原来没有按键，交换和覆盖效果相同：「${other.label}」的这个位置会被清空。`),
        'swap', '交换按键', { html: true, alt: old ? '覆盖' : null, tone: 'warn' });
      uiSound.play('error');
      renderPane();
      return;
    }
    if (other) { swapKey(a, s, code); keyNote = `「${other.label}」的主 / 副按键已互换`; uiSound.play('confirm'); renderPane(); return; } // 同一个动作的主副键互换
    const taken = bindKey(a, s, code);
    const name = ACTIONS.find((x) => x[0] === a)[1];
    keyNote = code ? `「${name}」已设为 ${keyLabel(code)}${taken && taken !== name ? `，已从「${taken}」上移除` : ''}` : `已清除「${name}」的按键`;
    uiSound.play(code ? 'confirm' : 'back');
    renderPane();
  }
  function onCapKey(e) {
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.code === 'Escape') { stopCapture(); keyNote = '已取消'; renderPane(); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') return finishBind(null);
    if (RESERVED.includes(e.code)) return;
    finishBind(e.code);
  }
  function onCapMouse(e) {
    if (e.button === 1 || e.button === 3 || e.button === 4) { e.preventDefault(); e.stopImmediatePropagation(); finishBind('Mouse' + e.button); return; }
    // 左键点到别的地方 = 取消（点到另一个按键格子会由它自己的 onclick 开始新的录入）
    if (!e.target.closest('.esc-bind')) { stopCapture(); keyNote = ''; renderPane(); }
  }

  function settingsHTML() {
    const row = ([k, type, label, o]) => {
      const v = settings[k];
      if (type === 'range') {
        const pct = ((v - o.min) / (o.max - o.min)) * 100;
        return `<label class="esc-row"><span>${label}</span><input type="range" id="set-${k}" data-k="${k}" min="${o.min}" max="${o.max}" step="${o.step}" value="${v}" style="--p:${pct}%"><output>${o.fix ? (+v).toFixed(o.fix) : v}${o.unit}</output></label>`;
      }
      if (type === 'toggle') return `<div class="esc-row"><span>${label}</span><button class="esc-toggle${v ? ' on' : ''}" id="set-${k}" data-k="${k}" role="switch" aria-checked="${v}"><i></i><em>${v ? '开' : '关'}</em></button></div>`;
      if (k === '§') return `<div class="esc-sec">${type}</div>`;
      if (type === 'seg') return `<div class="esc-row"><span>${label}</span><div class="esc-seg">${o.opts.filter(([val, , auto]) => !auto || v === val).map(([val, n, auto]) => `<button data-k="${k}" data-v="${val}" class="${v === val ? 'on' : ''}${auto ? ' auto' : ''}"${auto ? ' disabled' : ''}>${n}</button>`).join('')}</div></div>`;
      if (type === 'display') { const fs = isFullscreen(); return `<div class="esc-row"><span>${label}</span><div class="esc-seg"><button data-fs="1" class="${fs ? 'on' : ''}">全屏</button><button data-fs="0" class="${fs ? '' : 'on'}">窗口</button></div><output class="esc-sub">F11</output></div>`; }
      if (type === 'gpu') { const g = gpuInfo(); return `<div class="esc-row gpu"><span>${label}</span><div class="esc-gpu${g.weak ? ' weak' : ''}"><b>${g.name}</b>${g.weak ? '<em>正在使用集成显卡 / 软件渲染，帧率会偏低</em>' : ''}</div></div>`; }
      if (type === 'swatch') return `<div class="esc-row"><span>${label}</span><div class="esc-swatch">${Object.entries(XH_COLORS).map(([n, c]) => `<button data-k="${k}" data-v="${n}" class="${v === n ? 'on' : ''}" style="--c:${c}" aria-label="${n}"></button>`).join('')}</div></div>`;
      return '';
    };
    return `${head('设置', 'SETTINGS')}
    <div class="esc-tabs">${TABS.map(([id, n]) => `<a data-tab="${id}" class="${id === tab ? 'on' : ''}">${n}</a>`).join('')}</div>
    ${tab === 'keys' ? keysHTML() : `<div class="esc-rows">${ROWS[tab].map(row).join('')}</div>`}
    <div class="esc-set-foot"><span class="${tab === 'keys' && keyNote ? 'note' : ''}">${tab === 'keys' ? (keyNote || '点击按键格子后按下新按键 · Esc 取消 · Delete 清除') : '设置会自动保存在这台电脑上'}</span><button class="esc-reset">${tab === 'keys' ? '恢复默认键位' : '恢复默认'}</button></div>`;
  }

  function bindSettings(main) {
    main.querySelectorAll('.esc-tabs a').forEach((a) => { a.onclick = () => { stopCapture(); keyNote = ''; tab = a.dataset.tab; renderPane(); }; });
    main.querySelectorAll('.esc-bind:not(.fixed)').forEach((b) => {
      b.onclick = () => {
        stopCapture();
        capture = { a: b.dataset.a, s: +b.dataset.s };
        keyNote = '';
        renderPane();
        // 下一帧再开始监听，避免这次点击本身被当成输入
        setTimeout(() => { if (!capture) return; addEventListener('keydown', onCapKey, true); addEventListener('mousedown', onCapMouse, true); }, 0);
      };
    });
    main.querySelectorAll('input[type=range]').forEach((r) => {
      const o = ROWS[tab].find((x) => x[0] === r.dataset.k)[3];
      r.oninput = () => {
        const v = +r.value;
        r.style.setProperty('--p', ((v - o.min) / (o.max - o.min)) * 100 + '%');
        r.nextElementSibling.textContent = (o.fix ? v.toFixed(o.fix) : v) + o.unit;
        setSetting(r.dataset.k, v);
      };
      r.onchange = () => { if (r.dataset.k === 'ui' || r.dataset.k === 'master') uiSound.play('click'); if (r.dataset.k === 'scale') renderPane(); };
    });
    main.querySelectorAll('.esc-toggle').forEach((b) => { b.onclick = () => { setSetting(b.dataset.k, !settings[b.dataset.k]); renderPane(); }; });
    main.querySelectorAll('.esc-seg button[data-k]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.k, raw = b.dataset.v, v = typeof settings[k] === 'number' ? +raw : raw;
        if (k === 'quality') applyPreset(v); else setSetting(k, v);
        uiSound.play('click'); renderPane();
      };
    });
    main.querySelectorAll('.esc-seg button[data-fs]').forEach((b) => {
      b.onclick = () => { setFullscreen(b.dataset.fs === '1').then(() => setTimeout(renderPane, 150)); uiSound.play('click'); };
    });
    main.querySelectorAll('.esc-swatch button').forEach((b) => { b.onclick = () => { setSetting(b.dataset.k, b.dataset.v); renderPane(); }; });
    main.querySelector('.esc-reset').onclick = () => tab === 'keys'
      ? ask('恢复默认键位', '所有按键都会回到初始设置（WASD 移动、空格跳跃、C 纸化…）。', 'resetKeys')
      : ask('恢复默认设置', '画面、声音、鼠标和界面设置会回到初始值，键位不受影响。', 'reset');
  }

  function ask(title, text, act, okLabel = '确认', { html = false, alt = null, tone = '' } = {}) {
    confirmAct = act;
    const c = root.querySelector('.esc-confirm');
    c.querySelector('.mt').textContent = title;
    c.querySelector('p')[html ? 'innerHTML' : 'textContent'] = text;
    c.querySelector('.ok').textContent = okLabel;
    const altBtn = c.querySelector('.alt');
    altBtn.hidden = !alt; altBtn.textContent = alt || '';
    c.classList.toggle('danger', act === 'leave' || act === 'quit');
    c.classList.toggle('warn', tone === 'warn');
    c.classList.add('on');
    (act === 'swap' ? c.querySelector('.ok') : c.querySelector('.no')).focus();
  }
  const closeAsk = () => {
    root.querySelector('.esc-confirm').classList.remove('on');
    if (confirmAct === 'swap' && conflict) { keyNote = '已取消，键位没有变化'; conflict = null; renderPane(); }
    confirmAct = null;
  };

  root.addEventListener('click', (e) => {
    const it = e.target.closest('.esc-item');
    if (it) {
      const a = it.dataset.act;
      if (a === 'resume') return close(true);
      if (a === 'restart') return ask('重置训练', '回到出生点，本局击杀和命中数据清零。', 'restart', '重置');
      if (a === 'leave') return ask('返回大厅', '离开训练场回到大厅，本局数据不会保留。', 'leave', '返回大厅');
      if (a === 'quit') return ask('退出游戏', '确定要退出「弦光」吗？', 'quit', '退出');
      stopCapture(); pane = a; renderPane();
      return;
    }
    if (e.target.closest('.esc-confirm .no') || e.target.classList.contains('esc-confirm')) return closeAsk();
    if (e.target.closest('.esc-confirm .alt') && confirmAct === 'swap' && conflict) {
      // 覆盖：新按键给当前动作，对方那个位置清空
      const { a, s, code, other } = conflict; conflict = null; confirmAct = null;
      root.querySelector('.esc-confirm').classList.remove('on');
      bindKey(a, s, code);
      keyNote = `「${ACTIONS.find((x) => x[0] === a)[1]}」已设为 ${keyLabel(code)}，「${other.label}」的${SLOT[other.slot]}已清空`;
      renderPane();
      return;
    }
    if (e.target.closest('.esc-confirm .ok')) {
      if (confirmAct === 'swap' && conflict) {
        const { a, s, code, other } = conflict; conflict = null; confirmAct = null;
        root.querySelector('.esc-confirm').classList.remove('on');
        const old = settings.keys[a][s];
        swapKey(a, s, code);
        keyNote = old ? `已交换：「${ACTIONS.find((x) => x[0] === a)[1]}」→ ${keyLabel(code)}，「${other.label}」→ ${keyLabel(old)}` : `「${ACTIONS.find((x) => x[0] === a)[1]}」已设为 ${keyLabel(code)}`;
        renderPane();
        return;
      }
      const a = confirmAct; closeAsk();
      if (a === 'reset') { resetSettings(); renderPane(); }
      if (a === 'resetKeys') { resetKeys(); keyNote = '键位已恢复默认'; renderPane(); }
      if (a === 'restart') { onRestart?.(); close(true); }
      if (a === 'leave') onLeave?.();
      if (a === 'quit') onQuit?.();
    }
  });
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('esc-item')) { e.preventDefault(); e.target.click(); }
  });
  bindLobbySounds(root);
  // 全屏状态变了（F11、浏览器退出全屏）时刷新设置页上的按钮
  const fsRefresh = () => { if (opened && pane === 'settings' && tab === 'video') renderPane(); };
  document.addEventListener('fullscreenchange', fsRefresh);
  window.native?.onFullscreen?.(fsRefresh);

  // 局内战绩里的用时每秒刷新
  setInterval(() => {
    if (!opened || ctx !== 'game') return;
    const tm = root.querySelector('.esc-meta .tm');
    if (tm) tm.textContent = info().time;
  }, 1000);

  function open(startPane) {
    ctx = context();
    pane = startPane || (ctx === 'game' ? 'overview' : 'notice');
    render();
    opened = true;
    root.classList.add('on');
    hint('');
    uiSound.play('open');
  }
  function close(resume) {
    stopCapture();
    if (!opened) return;
    opened = false;
    root.classList.remove('on');
    if (resume) onResume?.();
  }
  function hint(t) { const h = root.querySelector('.esc-hint'); if (!h) return; h.textContent = t; h.classList.toggle('on', !!t); }

  return {
    open, close, hint,
    isOpen: () => opened,
    // Esc：先关确认框，再从子页面回到默认页，最后关菜单（局内要点按钮才能重新锁定鼠标）
    back(canClose) {
      if (root.querySelector('.esc-confirm.on')) { closeAsk(); return true; }
      const def = ctx === 'game' ? 'overview' : 'notice';
      if (pane !== def) { pane = def; renderPane(); uiSound.play('back'); return true; }
      if (canClose) { close(true); uiSound.play('back'); return true; }
      return false;
    },
  };
}

export { DEFAULTS };
