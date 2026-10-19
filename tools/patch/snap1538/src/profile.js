// 玩家资料：昵称（大厅头像卡片可以改，局内 HUD、击杀播报都用它）
const KEY = 'prismlink.name';
export const DEFAULT_NAME = '白昼航线';
export const NAME_MAX = 12;
export function loadName() {
  try { return localStorage.getItem(KEY) || DEFAULT_NAME; } catch { return DEFAULT_NAME; }
}
export function saveName(n) {
  try { localStorage.setItem(KEY, n); } catch { /* 无痕模式等 */ }
}
// 名字长度按“中文算 2、英文算 1”计，最多 NAME_MAX
export function nameWidth(s) { let w = 0; for (const ch of s) w += /[\x00-\xff]/.test(ch) ? 1 : 2; return w; }
