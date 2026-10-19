// 玩家设置：保存在本机浏览器（localStorage），改了立即生效
const KEY = 'prismlink.settings.v1';

export const DEFAULTS = {
  master: 80,      // 主音量 %
  sfx: 100,        // 战斗音效 %
  ui: 100,         // 界面音效 %
  sens: 1.0,       // 鼠标灵敏度倍率
  adsSens: 1.0,    // 开镜灵敏度倍率
  invertY: false,  // 反转 Y 轴
  fov: 70,         // 视野（第三人称 / 第一人称不开镜时）
  quality: 'high', // 画质预设：low / medium / high / ultra / custom（手动改了下面某一项就变成 custom）
  fpsCap: 0,       // 帧率上限，0 = 跟随显示器
  scale: 100,      // 渲染精度 %
  shadowQ: 'high', // 阴影：off / low / high
  autoRes: true,   // 帧率低时自动降低渲染精度
  serverUrl: 'ws://localhost:8787', // 组队联机：联机服务器地址
  shadows: true,   // 实时阴影
  post: true,      // 后期效果（辉光 + 调色）
  ink: true,       // 手绘描线（需要后期效果）
  reflect: true,   // 积水实时倒影
  cycle: true,     // 昼夜循环
  weather: true,   // 动态天气
  showFps: true,   // 右上角帧率
  xhColor: 'white',// 准星颜色
  dmgDir: true,    // 受击方向提示
  xhSize: 100,     // 准星大小 %
  pet: true,       // 右下角桌宠
  lensRain: true,  // 下雨时镜头上的水珠
  muteBlur: true,  // 切到别的窗口时静音
  keys: null,      // 键位，见下面的 DEFAULT_KEYS
};

// ———— 键位 ————
// 游戏代码里每个动作用一个固定的“规范键”来读（比如前进永远读 input.keys.KeyW），
// 玩家改键只改“哪个实体按键 → 哪个动作”的对应关系，在输入层翻译过去。
// 每个动作有主、副两个按键；鼠标中键 / 侧键记作 Mouse1 / Mouse3 / Mouse4。
export const ACTIONS = [
  ['forward', '前进', 'KeyW', '移动'], ['back', '后退', 'KeyS', '移动'], ['left', '向左', 'KeyA', '移动'], ['right', '向右', 'KeyD', '移动'],
  ['jump', '跳跃', 'Space', '移动'], ['sprint', '冲刺跑（按住）', 'ShiftLeft', '移动'],
  ['reload', '换弹', 'KeyR', '战斗'], ['paper', '纸化', 'KeyC', '战斗'], ['dash', '纸鹤突进', 'KeyE', '战斗'], ['bomb', '墨水炸弹', 'KeyQ', '战斗'],
  ['view', '切换第一 / 第三人称', 'KeyV', '战斗'],
  ['emote', '表情轮盘（按住）', 'KeyX', '战斗'],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`w${n}`, `武器 ${n}`, `Digit${n}`, '武器']),
];
export const DEFAULT_KEYS = Object.fromEntries(ACTIONS.map(([id, , canon]) => [id, [canon, id === 'paper' ? 'ControlLeft' : null]]));
export const RESERVED = ['Escape']; // 不能绑定的键（菜单）

const KEY_NAMES = {
  Space: '空格', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl', ShiftLeft: '左 Shift', ShiftRight: '右 Shift', AltLeft: '左 Alt', AltRight: '右 Alt',
  Tab: 'Tab', CapsLock: '大写', Enter: '回车', Backspace: '退格', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  Mouse1: '鼠标中键', Mouse3: '鼠标侧键 1', Mouse4: '鼠标侧键 2',
};
const SHORT = { ControlLeft: 'Ctrl', ControlRight: 'Ctrl', ShiftLeft: 'Shift', ShiftRight: 'Shift', AltLeft: 'Alt', AltRight: 'Alt', Mouse1: '中键', Mouse3: '侧键1', Mouse4: '侧键2', Space: '空格' };
// short：HUD 上的小键帽用短名字
export function keyLabel(code, short = false) {
  if (!code) return '—';
  if (short && SHORT[code]) return SHORT[code];
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '小键盘 ' + code.slice(6);
  return code;
}
// 实体按键 → 它触发的动作的规范键（一个按键只属于一个动作）
let codeMap = {};
function rebuild() {
  codeMap = {};
  for (const [id, , canon] of ACTIONS) for (const c of settings.keys[id] || []) if (c) (codeMap[c] ||= []).push(canon);
}
export function canonOf(code) { return codeMap[code] || null; }
// 绑定：把 code 设到 action 的第 slot 个位置；如果别的动作占着这个键，从那边移除，返回被移除的动作名
export function bindKey(action, slot, code) {
  let taken = null;
  if (code) for (const [id, label] of ACTIONS) {
    const arr = settings.keys[id];
    arr.forEach((c, i) => { if (c === code && !(id === action && i === slot)) { arr[i] = null; taken = label; } });
  }
  settings.keys[action][slot] = code;
  setSetting('keys', settings.keys);
  return taken;
}
// 查找某个按键现在绑在哪个动作的哪个位置（除了 action/slot 本身）
export function findKey(code, action, slot) {
  if (!code) return null;
  for (const [id, label] of ACTIONS) {
    const i = settings.keys[id].indexOf(code);
    if (i >= 0 && !(id === action && i === slot)) return { id, label, slot: i };
  }
  return null;
}
// 交换：action/slot 拿到 code，原来占着 code 的位置拿到 action/slot 原来的按键
export function swapKey(action, slot, code) {
  const other = findKey(code, action, slot);
  const old = settings.keys[action][slot];
  if (other) settings.keys[other.id][other.slot] = old;
  settings.keys[action][slot] = code;
  setSetting('keys', settings.keys);
}
export function resetKeys() { setSetting('keys', JSON.parse(JSON.stringify(DEFAULT_KEYS))); }

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* 隐私模式等情况下存不了，只在本次生效 */ }
}

const saved = load();
export const settings = { ...DEFAULTS, ...saved };
// 键位单独合并：以后新增的动作也能拿到默认键
settings.keys = Object.fromEntries(ACTIONS.map(([id]) => [id, [...(saved.keys?.[id] || DEFAULT_KEYS[id])].slice(0, 2).concat([null, null]).slice(0, 2)]));
const subs = [];
rebuild();

// 订阅：注册时立即按当前设置调用一次
// 画质预设：一键套用下面这些项
export const PRESETS = {
  low:    { scale: 75,  autoRes: true, shadowQ: 'off',  post: true, ink: false, reflect: false, lensRain: false },
  medium: { scale: 90,  autoRes: true, shadowQ: 'low',  post: true, ink: true,  reflect: false, lensRain: true },
  high:   { scale: 100, autoRes: true, shadowQ: 'high', post: true, ink: true,  reflect: true,  lensRain: true },
  ultra:  { scale: 130, autoRes: true, shadowQ: 'high', post: true, ink: true,  reflect: true,  lensRain: true },
};
export const PRESET_KEYS = Object.keys(PRESETS.high);
export function applyPreset(id) {
  const p = PRESETS[id]; if (!p) return;
  Object.assign(settings, p, { quality: id });
  settings.shadows = settings.shadowQ !== 'off';
  save(); subs.forEach((f) => f(settings, 'quality'));
}
export function onSettings(fn) { subs.push(fn); fn(settings); }
export function setSetting(k, v) {
  settings[k] = v;
  if (k === 'keys') rebuild();
  if (k === 'shadowQ') settings.shadows = v !== 'off';
  if (PRESET_KEYS.includes(k)) settings.quality = matchPreset();
  save(); subs.forEach((f) => f(settings, k));
}
// 当前这些画面项刚好等于哪个预设（都不等就是 custom）
function matchPreset() {
  for (const [id, p] of Object.entries(PRESETS)) if (PRESET_KEYS.every((k) => settings[k] === p[k])) return id;
  return 'custom';
}
// 恢复默认不动键位（键位有自己的「恢复默认键位」）
export function resetSettings() { const keys = settings.keys; Object.assign(settings, DEFAULTS, { keys }); save(); subs.forEach((f) => f(settings)); }

export const XH_COLORS = { white: '#ffffff', mint: '#33e6c8', yellow: '#ffe14d', red: '#ff4d5e', pink: '#ff7ad9' };

// 旧存档迁移：以前只有“阴影开 / 关”
if (saved.shadowQ == null && saved.shadows === false) settings.shadowQ = 'off';
settings.shadows = settings.shadowQ !== 'off';
settings.quality = matchPreset();
