// 大厅界面音效（Asset/Audio/UI/，用 tools/ui_sound_import.py 统一过响度，所以这里音量都一样）
// 用法：uiSound.play('click')；大厅里的点击由 bindLobbySounds 统一分派，不用每个按钮单独接
const FILES = ['click', 'hover', 'tab', 'select', 'confirm', 'back', 'error', 'open', 'start'];
const UI_VOLUME = 0.6; // 整体音量；各个音效的相对大小已经在文件里对齐好了

class UiSound {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = AC ? new AC() : null; // 先建好（处于暂停状态），首次点击时恢复
    this.buffers = {};
    this.muted = false;
    if (!this.ctx) return;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.8;
    this.out.connect(this.ctx.destination);
    for (const n of FILES) {
      fetch(`Asset/Audio/UI/${n}.ogg`).then((r) => r.arrayBuffer()).then((a) => this.ctx.decodeAudioData(a))
        .then((b) => { this.buffers[n] = b; }).catch((e) => console.warn('界面音效加载失败', n, e));
    }
    const wake = () => { if (this.ctx.state === 'suspended') this.ctx.resume(); };
    addEventListener('pointerdown', wake, true);
    addEventListener('keydown', wake, true);
  }

  play(name, vol = 1) {
    const b = this.buffers[name];
    if (!b || this.muted || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    const g = this.ctx.createGain();
    g.gain.value = UI_VOLUME * vol;
    s.connect(g).connect(this.out);
    s.start();
  }
}

export const uiSound = new UiSound();

// 点击某个元素时该放哪种声音（从具体到笼统，第一条匹配的生效）
const RULES = [
  ['.esc-confirm .ok', 'confirm'],
  ['.esc-confirm .alt', 'confirm'],
  ['.esc-confirm .no, .esc-item[data-act="resume"]', 'back'],
  ['.esc-item.danger, .esc-item[data-act="restart"], .esc-reset', 'open'],
  ['.esc-tabs a', 'tab'],
  ['.esc-item', 'select'],
  ['.lb-nav a', 'tab'],
  ['#lobby-start, [data-act="start"]', 'start'],
  ['.lb-mode', 'open'],
  ['.mx-tabs a.off', 'error'],
  ['.mx-ok, [data-m="ok"]', 'confirm'],
  ['.mx-x, .mx-cancel, .mm-cancel, [data-m="cancel"]', 'back'],
  ['.sh-card, #sh-detail', 'open'],
  ['.mx-card, .nv-roster .card, .nv-skill .sk, #wp-list .card, #wp-skins .skin, #st-grid .item', 'select'],
];
const HOVER = '.lb-nav a, #lobby-start, .lb-mode, .mx-card, .mx-ok, .esc-item';

// 大厅：捕获阶段先记下“默认要放的声音”，按钮自己的处理函数可以通过 lobbySoundHint 改成别的（比如弹出“未解锁”就改成 error），最后统一播放一次
let pending = null;
export function lobbySoundHint(name) { if (pending) pending.name = name; }

export function bindLobbySounds(root) {
  root.addEventListener('click', (e) => {
    let el = e.target, name = null;
    for (const [sel, n] of RULES) { if (el.closest(sel)) { name = n; break; } }
    if (!name) {
      // 其他能点的东西（鼠标是手形）统一用普通点击声
      for (; el && el !== root; el = el.parentElement) {
        if (el.tagName === 'BUTTON' || el.tagName === 'A' || getComputedStyle(el).cursor === 'pointer') { name = 'click'; break; }
      }
    }
    if (!name) return;
    const p = pending = { name };
    setTimeout(() => { uiSound.play(p.name); if (pending === p) pending = null; }, 0);
  }, true);
  let last = null;
  root.addEventListener('pointerover', (e) => {
    const el = e.target.closest(HOVER);
    if (!el || el === last) return;
    last = el;
    uiSound.play('hover');
  });
  root.addEventListener('pointerout', (e) => { if (last && !last.contains(e.relatedTarget)) last = null; });
}
