import { bindLobbySounds, lobbySoundHint } from './uisound.js';
import { setupParty } from './party.js';
import { loadName, saveName, nameWidth, NAME_MAX } from './profile.js';
import { SLOTS, ATTACHMENTS, optionsFor, applyAttachments, selFor, loadSel, saveSel } from './attachments.js';
// 主界面（大厅）五个页面：大厅 / 引航者 / 武器 / 仓库 / 商城
// 页面布局按「弦光 · 界面拆分素材」的设计稿（1672×941）；数据目前写在本文件里（单机展示数据），
// 以后接服务器时把这些数组换成服务器返回的数据即可。

const IMG = 'Asset/UI/Lobby/';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => n.toLocaleString('en-US');

// ———— 账号（货币会在商城购买时变化）————
const account = { coin: 12580, crystal: 680 };

// ———— 引航者：设计稿里的引航者（烬、苍先拿掉了；现在全部解锁）；char 是对应的 3D 角色模型（config.js 里的 id），没有模型的先锁住 ————
// skins：同一个引航者的不同衣服（config.js 里的角色 id），在「外观」页切换；fallback：网页版没有那套模型时用的替身模型
// 默认出战：DEFAULT_NAV（澪 / 桔梗）
const NAVIGATORS = [
  { name: '凛', img: 'nav_av1.jpg', code: '07', cls: '突击', motto: '凌空而至，自由成锋。', lv: 12, xp: [320, 600], voice: '「风会替我开路。」', skins: [{ id: 'mint', name: '晴空薄荷' }] },
  { name: '澪', img: 'nav_av2.jpg', code: '03', cls: '支援', motto: '潮声为引，护你周全。', lv: 8, xp: [140, 450], voice: '「别怕，我在后面。」', skins: [{ id: 'kikyo', name: '夜航外套' }] },
  { name: '星野', img: 'nav_av4.jpg', code: '05', cls: '侦察', motto: '星光所至，无处遁形。', lv: 9, xp: [210, 450], voice: '「目标位置已标记。」', skins: [{ id: 'selestia', name: '星辉礼裙' }] },
  { name: '露希', img: 'nav_av6.jpg', code: '12', cls: '控场', motto: '光影交错，皆在掌中。', lv: 1, xp: [0, 300], voice: '「光与影，都听我的。」', skins: [{ id: 'sakamata', name: '暗影洋装' }], fallback: 'sampleG' },
  { name: '白羽', img: 'nav_av7.jpg', code: '02', cls: '突击', motto: '羽落无声，锋芒自现。', lv: 1, xp: [0, 300], voice: '「无声，即是锋芒。」', skins: [{ id: 'bijou', name: '晶羽礼装' }, { id: 'bijou2', name: '晶羽礼装 · 澄' }], fallback: 'shino' },
  { name: '黛音', img: 'nav_chihaya.jpg', code: '16', cls: '突击', motto: '耳机里的节拍，就是冲锋的号角。', lv: 1, xp: [0, 300], voice: '「跟上节拍，别掉拍子。」', skins: [{ id: 'chihaya', name: '暗夜回响' }, { id: 'chihaya2', name: '街头轻装' }] },
  { name: '绯樱', img: 'nav_sakuna.jpg', code: '21', cls: '支援', motto: '甜点与弹药，都由我来补给。', lv: 1, xp: [0, 300], voice: '「补给送到～请慢用！」', skins: [{ id: 'sakuna', name: '樱糖女仆' }] },
  { name: '雪兔', img: 'nav_pekomama.jpg', code: '18', cls: '侦察', motto: '竖起耳朵，风吹草动都逃不过。', lv: 1, xp: [0, 300], voice: '「听到了，三点钟方向。」', skins: [{ id: 'pekomama', name: '蓝白午后' }] },
  { name: '琉璃', img: 'nav_vivi.jpg', code: '24', cls: '爆破', motto: '闪闪发光的，才是最好的炸药。', lv: 1, xp: [0, 300], voice: '「准备好看烟花了吗？」', skins: [{ id: 'vivi', name: '炫彩机能' }] },
  { name: '绮罗', img: 'nav_calli.jpg', code: '09', cls: '狙击', motto: '安静地瞄准，温柔地终结。', lv: 1, xp: [0, 300], voice: '「别动……很快就结束。」', skins: [{ id: 'calli_k2l', name: '学院卫衣 · 长发' }, { id: 'calli_k2s', name: '学院卫衣 · 短发' }, { id: 'calli_kl', name: '白衬衫 · 长发' }, { id: 'calli_ks', name: '白衬衫 · 短发' }] },
];
const DEFAULT_NAV = 1;
// 技能是游戏里真实的三个技能（所有引航者目前共用）
const SKILLS = [
  { key: 'Q', icon: 'skill_bomb.png', name: '墨水炸弹', type: '主动技能', desc: '抛出一枚墨水炸弹，\n落地爆炸造成范围伤害。', cd: '冷却 9 秒' },
  { key: 'E', icon: 'skill_dash.png', name: '纸鹤突进', type: '主动技能', desc: '化作纸鹤朝移动方向\n快速突进一段距离。', cd: '冷却 5 秒' },
  { key: 'C', icon: 'skill_paper.png', name: '纸化', type: '按住发动', desc: '侧身化作一张纸，正面几乎\n无法被命中，移动更快。', cd: '消耗能量' },
];

// ———— 仓库道具 ————
const ITEMS = [
  { name: '标准补给箱', cat: '补给', q: 2, n: 12, desc: '可获得基础养成材料\n用于引航者与武器培养', from: '每日任务' },
  { name: '引航凭证', cat: '材料', q: 3, n: 8, desc: '可在引航者页面\n解锁新的引航者', from: '活动商店' },
  { name: '强化模块', cat: '材料', q: 3, n: 24, desc: '用于提升武器的\n属性等级', from: '训练场结算' },
  { name: '武器零件', cat: '材料', q: 2, n: 36, desc: '武器改造的基础零件', from: '分解武器' },
  { name: '双倍经验卡', cat: '消耗品', q: 4, n: 3, desc: '使用后 1 小时内\n对局经验翻倍', from: '航迹通行证' },
  { name: '改名卡', cat: '消耗品', q: 3, n: 1, desc: '可修改一次玩家昵称', from: '商城' },
  { name: '角色碎片', cat: '材料', q: 3, n: 18, desc: '集齐 30 个可兑换\n引航者「凛」', from: '限时活动' },
  { name: '涂装兑换券', cat: '外观', q: 2, n: 2, desc: '可兑换任意一款\n普通品质武器涂装', from: '航迹通行证' },
  { name: '通行证经验', cat: '消耗品', q: 2, n: 5, desc: '增加航迹通行证经验', from: '每日任务' },
  { name: '补给钥匙', cat: '补给', q: 4, n: 4, desc: '开启高级补给箱', from: '商城' },
  { name: '纪念徽章', cat: '收藏', q: 2, n: 1, desc: '赛季 02 参与纪念', from: '赛季奖励' },
  { name: '礼物盒', cat: '补给', q: 2, n: 6, desc: '打开后随机获得\n外观或养成材料', from: '好友赠礼' },
];
const QUALITY = ['', '普通', '稀有', '史诗', '传说'];
const ITEM_CATS = [
  ['全部', '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>'],
  ['补给', '<path d="M5 9h14v10H5zM3 6h18v3H3zM12 6v13"/>'],
  ['材料', '<circle cx="8" cy="9" r="4"/><circle cx="16" cy="9" r="3"/><circle cx="12" cy="16" r="4"/>'],
  ['消耗品', '<path d="M9 3h6M10 3v6L5 19h14l-5-10V3"/>'],
  ['外观', '<path d="M8 4l4 2 4-2 4 4-3 3v9H7v-9L4 8z"/>'],
  ['收藏', '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>'],
];

// ———— 商城 ————
const SHOP_CATS = [
  ['精选', '<path d="M12 2l2.4 7.6H22l-6.2 4.5 2.4 7.6L12 17.2l-6.2 4.5 2.4-7.6L2 9.6h7.6z"/>'],
  ['引航者外观', '<path d="M12 3a3 3 0 0 1 3 3c0 1.5-1 2-3 3l-9 7h18l-9-7"/>'],
  ['武器涂装', '<path d="M3 9h15l3-2v4h-4l-1 2h-3l-1 4H8l1-4H3z"/>'],
  ['组合礼包', '<path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0"/>'],
  ['兑换商店', '<path d="M3 6h18v12H3zM7 10h4M7 14h7M16 10h2"/>'],
];
const HERO_SLIDES = [
  { tag: '全新外观', title: '晴空白昼', sub: '凛 · 典藏外观', copy: '在更高的天空下，\n我们依然并肩。', price: 1680, img: 'shop_hero.jpg', cat: '引航者外观' },
  { tag: '限定涂装', title: '暮色流金', sub: 'AR-07 · 武器涂装', copy: '落日熔金，\n枪火也有温度。', price: 980, img: 'shop_card_gun.jpg', cat: '武器涂装', wide: true },
  { tag: '新人福利', title: '启航礼盒', sub: '组合礼包', copy: '整装待发，\n航线从这里开始。', price: 680, img: 'shop_card_gift.jpg', cat: '组合礼包', wide: true },
];
const SHOP_ITEMS = [
  { name: '天际回声', type: '武器涂装', price: 880, img: 'shop_item1.jpg', cat: '武器涂装' },
  { name: '折光挂饰', type: '武器挂饰', price: 180, img: 'shop_item2.jpg', cat: '兑换商店' },
  { name: '星轨头像框', type: '头像框', price: 120, img: 'shop_item3.jpg', cat: '兑换商店' },
  { name: '澪 · 云间来信', type: '引航者外观', price: 1280, img: 'shop_item4.jpg', cat: '引航者外观' },
  { name: '暮色流金', type: '武器涂装', price: 980, img: 'shop_card_gun.jpg', cat: '武器涂装', side: true },
  { name: '启航礼盒', type: '组合礼包', price: 680, img: 'shop_card_gift.jpg', cat: '组合礼包', side: true },
];

// ———— 武器：分类 + 每把枪的展示信息（数值来自 weapons.js 的真实参数）————
const WEAPON_CATS = [
  ['突击步枪', ['ar', 'lmg']], ['冲锋枪', ['smg']], ['狙击步枪', ['sniper']], ['霰弹枪', ['shotgun']], ['手枪', ['pistol', 'revolver']], ['重武器', ['rocket']],
];
const SKINS = [
  { name: '初始涂装', filter: 'none' },
  // 涂装目前只是给展示图加滤镜调色（模型本身是白色，加一点棕褐再转色相就能染上颜色）
  { name: '晴空白昼', filter: 'sepia(.5) hue-rotate(165deg) saturate(2.2) brightness(1.02)' },
  { name: '薄荷回响', filter: 'sepia(.55) hue-rotate(115deg) saturate(2.4)' },
  { name: '暮色流金', filter: 'sepia(1) saturate(2.4) hue-rotate(-8deg) brightness(.82) contrast(1.15)', locked: true },
];
const clamp = (v) => Math.max(5, Math.min(100, Math.round(v)));
// 配件图标（线稿 SVG）：槽位默认图标 + 每个配件自己的
const SV = (b) => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">${b}</svg>`;
const ATT_ICON = {
  optic: SV('<rect x="10" y="18" width="28" height="14" rx="3"/><circle cx="24" cy="25" r="4"/><path d="M14 36h20"/>'),
  muzzle: SV('<rect x="6" y="19" width="26" height="10" rx="2"/><path d="M32 21h8M32 27h8M36 17v14"/>'),
  under: SV('<path d="M6 16h36M14 16v6h20v-6M22 22l-3 18h8l1-18"/>'),
  mag: SV('<path d="M17 8h14l-2 32H19z"/><path d="M19 16h10M19 24h10"/>'),
  none: SV('<circle cx="24" cy="24" r="14"/><path d="M14 34L34 14"/>'),
  barrel: SV('<rect x="4" y="20" width="22" height="8" rx="1"/><path d="M26 22h18v4H26"/>'),
  laser: SV('<rect x="6" y="18" width="16" height="12" rx="2"/><path d="M22 24h20" stroke-dasharray="3 3"/>'),
  scope: SV('<path d="M6 21h28l8-4v14l-8-4H6z"/><path d="M14 31v5M28 31v5"/><circle cx="20" cy="24" r="2"/>'),
  scope_s: SV('<rect x="12" y="20" width="24" height="12" rx="6"/><circle cx="24" cy="26" r="2.5" fill="currentColor"/><path d="M14 36h20"/>'),
  scope_nw: SV('<path d="M10 34h28M14 34V16h20v18"/><path d="M14 16l4-4h12l4 4"/>'),
  silencer: SV('<rect x="6" y="19" width="36" height="10" rx="5"/><path d="M30 19v10"/>'),
  muzzle_sq: SV('<rect x="10" y="16" width="26" height="16" rx="1"/><path d="M36 20h6v8h-6"/>'),
  hg_ext: SV('<path d="M4 20h40v8H4z"/><path d="M12 20v8M20 20v8M28 20v8M36 20v8"/>'),
  hg_short: SV('<path d="M12 20h24v8H12z"/><path d="M20 20v8M28 20v8"/>'),
  bl_ext: SV('<rect x="4" y="20" width="14" height="8" rx="1"/><path d="M18 22h26v4H18"/>'),
  bl_short: SV('<rect x="8" y="20" width="18" height="8" rx="1"/><path d="M26 22h10v4H26"/>'),
  sl_ext: SV('<path d="M6 16h36v8H6zM10 24h8l-2 14h-6z"/>'),
  sl_short: SV('<path d="M10 16h24v8H10zM12 24h8l-2 14h-6z"/>'),
  grip_v: SV('<path d="M8 14h32M20 14v4h10v-4M22 18l-1 22h8l-1-22"/>'),
  grip_a: SV('<path d="M8 14h32M14 14l6 6h16l4-6M20 20l10 16"/>'),
  grip_as: SV('<path d="M8 16h32M16 16l5 5h12l3-5M22 21l6 10"/>'),
  bipod: SV('<path d="M8 14h32M24 14v6M24 20l-12 20M24 20l12 20"/>'),
  mag_clear: SV('<path d="M17 8h14l-2 32H19z"/><path d="M20 30h8M20 34h8" stroke-dasharray="2 2"/>'),
};
function weaponStats(w, base = w) {
  let mobility = { pistol: 92, launcher: 30 }[w.hold] ?? (w.id === 'lmg' ? 48 : w.id === 'sniper' ? 55 : w.id === 'smg' ? 82 : 70);
  // 配件改了开镜速度：机动跟着变
  const sp = w.ads?.speed ?? 12, sp0 = base.ads?.speed ?? 12;
  if (sp !== sp0) mobility = clamp(mobility * Math.pow(sp / sp0, 0.45));
  return [
    ['伤害', clamp(w.damage * (w.pellets || 1) * (w.rocket ? 0.75 : 1) / 1.2)],
    ['射速', clamp(w.rate / 15 * 100)],
    ['稳定', clamp(100 - w.recoil * 900)],
    ['机动', mobility],
    ['射程', clamp(100 - w.spread * 900)],
  ];
}

// ———— 页面 HTML ————
function navigatorPage() {
  return `
  <div class="nv-hero">
    <div class="code">NAVIGATOR / <span id="nv-code"></span></div>
    <div class="name" id="nv-name"></div>
    <div class="cls"><img src="${IMG}class_icon.png" alt=""><span id="nv-cls"></span></div>
    <div class="motto" id="nv-motto"></div>
    <div class="model" id="nv-model"></div>
  </div>
  <div class="nv-mastery glass">
    <div class="row"><b>熟练度</b><span class="lv" id="nv-lv"></span><span class="xp" id="nv-xp"></span></div>
    <div class="bar"><i id="nv-xpbar"></i></div>
    <span class="go chev"></span>
  </div>
  <img class="nv-char" src="${IMG}navigator.png" alt="">
  <div class="nv-stage"></div>
  <div class="nv-skill glass">
    <div class="tabs"><a class="on" data-t="skill">技能</a><a data-t="skin">外观</a><a data-t="bio">档案</a></div>
    <div class="nv-skins"></div>
    <div class="nv-bio"></div>
    <div class="intro">
      <div class="emblem"><img id="nv-skill-icon" src="" alt=""></div>
      <div class="txt"><b id="nv-skill-name"></b><span class="tag" id="nv-skill-type"></span><p id="nv-skill-desc"></p><em id="nv-skill-cd"></em></div>
      <img class="art" src="${IMG}skill_art.jpg" alt="">
    </div>
    <div class="cards">${SKILLS.map((s, i) => `<div class="sk${i ? '' : ' on'}" data-i="${i}"><img src="${IMG}${s.icon}" alt=""><kbd>${s.key}</kbd></div>`).join('')}</div>
    <div class="traits"><div class="tt">技能特性</div><span><img src="${IMG}trait_move.png" alt="">机动</span><span><img src="${IMG}trait_break.png" alt="">突破</span></div>
    <div class="voice"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><b>角色语音</b><span id="nv-voice"></span><i class="wave">${'<b></b>'.repeat(16)}</i><span class="chev"></span></div>
  </div>
  <div class="nv-roster glass">
    <div class="hd"><b><svg viewBox="0 0 24 24"><path d="M12 3l9 9-9 9-9-9z"/><path d="M12 8l4 4-4 4-4-4z"/></svg>引航者</b><span class="cnt"></span>
      <div class="filter">全部<span class="dd"></span></div></div>
    <div class="list"></div>
    <span class="more chev"></span>
  </div>
  <button class="nv-try glass" data-act="start"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/></svg><span>试用</span><span class="chev"></span></button>
  <button class="nv-deploy" id="nv-deploy"><span>设为出战</span><span class="chev"></span></button>`;
}

function weaponPage() {
  return `
  <div class="wp-title"><div class="code">ARSENAL</div><div class="name">武器</div></div>
  <div class="wp-cats">${WEAPON_CATS.map(([n], i) => `<a data-i="${i}"${i ? '' : ' class="on"'}>${n}<span class="chev"></span></a>`).join('')}</div>
  <div class="wp-list" id="wp-list"></div>
  <div class="wp-info"><div class="code" id="wp-code"></div><div class="name"><b id="wp-name"></b><svg viewBox="0 0 24 24"><path d="M12 2l10 10-10 10L2 12z"/><path d="M12 7l5 5-5 5-5-5z"/></svg></div><span class="tag">标准型</span></div>
  <div class="wp-show" id="wp-show"><img id="wp-gun" src="" alt=""></div>
  <div class="wp-tool glass"><span><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>拖动旋转</span><i></i><span id="wp-inspect"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5M11 8v6M8 11h6"/></svg>检视</span></div>
  <div class="wp-stats glass">
    <div class="hd"><svg viewBox="0 0 24 24"><path d="M12 3l9 9-9 9-9-9z"/></svg>武器属性</div>
    <div id="wp-rows"></div>
    <div class="ammo"><span><i class="mag"></i>弹匣<b id="wp-mag"></b></span><em></em><span><i class="mag"></i>备弹<b id="wp-res"></b></span></div>
  </div>
  <div class="wp-tabs glass"><a class="on">外观</a><a>配件</a></div>
  <div class="wp-skins" id="wp-skins"></div>
  <div class="wp-attach" id="wp-attach"></div>
  <div class="wp-attopt glass" id="wp-attopt"></div>
  <button class="wp-equip" id="wp-equip"><span>装备武器</span><span class="chev"></span></button>
  <button class="wp-train glass" data-act="start"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/></svg><span>训练场</span><span class="chev"></span></button>
  <div class="lb-deco"><i>///</i> PRISM / LINK</div>`;
}

function storagePage() {
  return `
  <div class="st-title"><div class="code">INVENTORY / 01</div><div class="name">仓库</div><p>管理并使用各类道具。</p></div>
  <div class="st-cats glass">${ITEM_CATS.map(([n, ic], i) => `<a data-cat="${n}"${i ? '' : ' class="on"'}><svg viewBox="0 0 24 24">${ic}</svg>${n}</a>`).join('')}
    <div class="own"><svg viewBox="0 0 24 24"><path d="M4 8h16v12H4zM8 8V5h8v3M4 12h16"/></svg>已拥有<b id="st-own"></b></div></div>
  <div class="st-search glass"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg><input id="st-q" placeholder="搜索道具" autocomplete="off"></div>
  <div class="st-filter glass"><svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg></div>
  <div class="st-sort glass" id="st-sort"><span>品质优先</span><span class="dd"></span></div>
  <div class="st-grid" id="st-grid"></div>
  <div class="st-pager"><a class="glass"><span class="chev l"></span></a><span class="glass">1 / 1</span><a class="glass"><span class="chev"></span></a><em id="st-total"></em></div>
  <div class="st-detail glass">
    <b class="t" id="st-name"></b><span class="q" id="st-qual"></span>
    <div class="big"><img id="st-img" src="" alt=""></div>
    <div class="own">拥有数量<b id="st-count"></b></div>
    <p id="st-desc"></p>
    <div class="src"><span>获取途径</span><a class="glass"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="1"/><path d="M4 9h16M8 3v4M16 3v4"/></svg><b id="st-from"></b><span class="chev"></span></a></div>
    <div class="use-n"><span>使用数量</span><a class="glass" data-d="-1">−</a><input id="st-n" value="1"><a class="glass" data-d="1">+</a><a class="glass all" data-d="all">批量使用</a></div>
    <button class="use" id="st-use"><span>使用</span><span class="chev"></span></button>
  </div>`;
}

function shopPage() {
  return `
  <div class="sh-side glass"></div>
  <div class="sh-title"><div class="code">STORE</div><div class="name">商城</div><div class="sub">PRISM / LINK</div></div>
  <div class="sh-cats">${SHOP_CATS.map(([n, ic], i) => `<a data-cat="${n}"${i ? '' : ' class="on"'}><svg viewBox="0 0 24 24">${ic}</svg>${n}<span class="chev"></span></a>`).join('')}</div>
  <div class="sh-gift glass"><svg viewBox="0 0 24 24"><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0"/></svg>赠礼记录<span class="chev"></span></div>
  <div class="sh-hero" id="sh-hero">
    ${HERO_SLIDES.map((s, i) => `<div class="slide${i ? '' : ' on'}${s.wide ? ' wide' : ''}" data-i="${i}"><img src="${IMG}${s.img}" alt=""></div>`).join('')}
    <div class="sh-panel"><span class="new">NEW</span><div class="tag" id="sh-tag"></div><div class="tt" id="sh-title"></div><div class="sb" id="sh-sub"></div><p id="sh-copy"></p>
      <div class="buy"><span class="price"><img src="${IMG}crystal.png" alt=""><b id="sh-price"></b></span><button id="sh-detail">查看详情<span class="chev"></span></button></div></div>
    <div class="dots">${HERO_SLIDES.map((s, i) => `<i data-i="${i}"${i ? '' : ' class="on"'}></i>`).join('')}</div>
  </div>
  ${SHOP_ITEMS.filter((s) => s.side).map((s, i) => `<div class="sh-card side s${i}" data-name="${esc(s.name)}"><div class="t"><b>${s.name}</b><span>${s.type}</span></div><img src="${IMG}${s.img}" alt=""><div class="p"><img src="${IMG}crystal.png" alt=""><b>${s.price}</b><span class="chev"></span></div></div>`).join('')}
  <div class="sh-rec"><b>精选推荐</b><i></i><a>查看全部<span class="chev"></span></a></div>
  <div class="sh-items" id="sh-items"></div>
  <div class="sh-modal" id="sh-modal"><div class="box glass"><div class="mt">购买确认</div><img id="sh-m-img" src="" alt=""><b id="sh-m-name"></b><span id="sh-m-type"></span>
    <div class="mp"><img src="${IMG}crystal.png" alt=""><b id="sh-m-price"></b><em id="sh-m-left"></em></div>
    <div class="mb"><button class="glass" data-m="cancel">取消</button><button class="ok" data-m="ok">确认购买</button></div></div></div>`;
}

// ———— 初始化 ————
export function initLobby({ characters, weapons, onStart, onCharacter, onWeapon, maps = [], onMap, gunViewer, navViewer, getProfile, onRoom }) {
  const lobby = $('#lobby');
  const stage = $('.lb-stage', lobby);
  // 生成四个子页面
  const pages = { navigator: navigatorPage, weapon: weaponPage, storage: storagePage, shop: shopPage };
  for (const [id, fn] of Object.entries(pages)) {
    const div = document.createElement('div');
    div.className = 'lb-page';
    div.dataset.page = id;
    div.innerHTML = fn();
    stage.appendChild(div);
  }
  const toastEl = document.createElement('div');
  toastEl.className = 'lb-toast';
  stage.appendChild(toastEl);
  let toastT = 0;
  // 提示同时决定这次点击的音效：失败/未开放 → 错误音，成功 → 确认音
  const toast = (t) => {
    if (/尚未|可在商城|开发中|暂未|已拥有|不足/.test(t)) lobbySoundHint('error');
    else if (/成功|已设为|手持|已使用/.test(t)) lobbySoundHint('confirm');
    showToast(t);
  };
  const showToast = (t) => { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 1800); };

  bindLobbySounds(lobby);

  // —— 昵称：头像卡片右下角的笔 → 改名窗口 ——
  const nameEl = $('.lb-profile .pf b', lobby);
  nameEl.textContent = loadName();
  const RANDOM_NAMES = ['晴空旅人', '折纸飞鸟', '薄荷汽水', '星屑邮差', '云端信号', '午后雷鸣', '纸鹤三号', '霓虹回声', '白夜航标', '夏日余晖'];
  const rn = document.createElement('div');
  rn.className = 'lb-rename';
  rn.innerHTML = `<div class="box glass" role="dialog" aria-label="修改昵称">
      <div class="hd"><b>修改昵称</b><span>局内 HUD 和击杀播报都会显示这个名字</span></div>
      <div class="field"><input id="rn-input" maxlength="24" autocomplete="off" spellcheck="false"><button class="dice" title="随机一个名字"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.3"/><circle cx="15" cy="15" r="1.3"/><circle cx="15" cy="9" r="1.3"/><circle cx="9" cy="15" r="1.3"/></svg></button></div>
      <div class="tip"><span id="rn-tip">2–${NAME_MAX} 个字符（中文算 2 个）</span><em id="rn-count"></em></div>
      <div class="btns"><button class="cancel">取消</button><button class="ok">确认修改</button></div>
    </div>`;
  stage.appendChild(rn);
  const rnInput = $('#rn-input', rn), rnTip = $('#rn-tip', rn), rnCount = $('#rn-count', rn), rnOk = $('.ok', rn);
  const checkName = () => {
    const v = rnInput.value.trim(), w = nameWidth(v);
    rnCount.textContent = `${w}/${NAME_MAX}`;
    let err = '';
    if (w < 2) err = '至少 2 个字符';
    else if (w > NAME_MAX) err = '名字太长了';
    else if (/[<>"'`\\/]/.test(v)) err = '不能包含特殊符号';
    rnTip.textContent = err || '可以使用';
    rn.classList.toggle('bad', !!err);
    rnOk.disabled = !!err || v === loadName();
    return !err;
  };
  const openRename = () => { rnInput.value = loadName(); checkName(); rn.classList.add('on'); setTimeout(() => { rnInput.focus(); rnInput.select(); }, 30); };
  const closeRename = () => rn.classList.remove('on');
  const commitRename = () => {
    if (!checkName() || rnOk.disabled) return;
    const v = rnInput.value.trim();
    saveName(v); nameEl.textContent = v;
    closeRename(); toast(`改名成功：${v}`);
  };
  $('.lb-profile .edit', lobby).addEventListener('click', (e) => { e.stopPropagation(); openRename(); });
  $('.lb-profile .pf b', lobby).addEventListener('click', openRename);
  rnInput.addEventListener('input', checkName);
  rnInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') closeRename(); });
  rnInput.addEventListener('keyup', (e) => e.stopPropagation());
  $('.dice', rn).onclick = () => { const cur = rnInput.value.trim(); let n; do n = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]; while (n === cur); rnInput.value = n; checkName(); rnInput.focus(); };
  $('.cancel', rn).onclick = closeRename;
  rnOk.onclick = commitRename;
  rn.addEventListener('pointerdown', (e) => { if (e.target === rn) closeRename(); });

  // —— 货币 ——
  const coinEl = $$('.lb-res .cur b', lobby)[0], crystalEl = $$('.lb-res .cur b', lobby)[1];
  const refreshMoney = () => { coinEl.textContent = fmt(account.coin); crystalEl.textContent = fmt(account.crystal); };
  refreshMoney();

  // —— 页面切换 + 动画 ——
  const NAV = ['home', 'navigator', 'weapon', 'storage', 'shop'];
  const navLinks = $$('.lb-nav a', lobby);
  const bar = document.createElement('i');
  bar.className = 'bar';
  $('.lb-nav', lobby).appendChild(bar);
  const moveBar = (a) => { bar.style.left = a.offsetLeft + 6 + 'px'; bar.style.width = a.offsetWidth - 12 + 'px'; };
  let current = 'home';
  let navStageReplay = null;
  const pageEl = (id) => $(`.lb-page[data-page="${id}"]`, stage);
  function go(id) {
    if (id === current) return;
    const from = pageEl(current), to = pageEl(id);
    const dir = NAV.indexOf(id) > NAV.indexOf(current) ? 1 : -1;
    lobby.style.setProperty('--dir', dir);
    from.classList.remove('on', 'enter');
    from.classList.add('leave');
    setTimeout(() => from.classList.remove('leave'), 320);
    // 元素依次入场
    [...to.children].forEach((c, i) => c.style.setProperty('--i', i));
    to.classList.remove('leave');
    to.classList.add('on', 'enter');
    setTimeout(() => to.classList.remove('enter'), 900);
    current = id;
    lobby.dataset.page = id;
    if (id === 'navigator') navStageReplay?.();
    navLinks.forEach((a, i) => a.classList.toggle('on', NAV[i] === id));
    moveBar(navLinks[NAV.indexOf(id)]);
  }
  navLinks.forEach((a, i) => { a.onclick = () => go(NAV[i]); });
  pageEl('home').classList.add('on');
  requestAnimationFrame(() => { moveBar(navLinks[0]); bar.classList.add('ready'); });
  addEventListener('resize', () => moveBar(navLinks[NAV.indexOf(current)]));
  $$('[data-open="chars"]', lobby).forEach((el) => { el.onclick = () => go('navigator'); });
  $$('[data-act="start"]', lobby).forEach((el) => { el.onclick = onStart; });
  // 开始：竞技模式先播一段“匹配中”，训练直接进
  const startGame = () => {
    if (!mapSel?.ranked()) return onStart();
    if (mapSel.party()) return party.open('create', mapSel.current()); // 组队联机：打开创建 / 寻找房间
    if (stage.querySelector('.mm-overlay')) return;
    const mm = document.createElement('div');
    mm.className = 'mm-overlay';
    mm.innerHTML = `<div class="mm-box glass"><div class="mm-ring"><i></i></div><b>正在匹配</b><span class="mm-t">00:00</span>
      <div class="mm-slots">${Array.from({ length: 8 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div><p class="mm-n">寻找对手中…</p><button class="mm-cancel">取消匹配</button></div>`;
    stage.appendChild(mm);
    requestAnimationFrame(() => mm.classList.add('on'));
    let t = 0, found = 1;
    const slots = [...mm.querySelectorAll('.mm-slots i')];
    slots[0].classList.add('ok');
    const timer = setInterval(() => {
      t += 0.25;
      mm.querySelector('.mm-t').textContent = `00:${String(Math.floor(t)).padStart(2, '0')}`;
      if (found < 8 && Math.random() < 0.55) { slots[found++].classList.add('ok'); mm.querySelector('.mm-n').textContent = `已找到 ${found} / 8 名玩家`; }
      if (found >= 8 && t > 2) {
        clearInterval(timer);
        mm.querySelector('b').textContent = '匹配成功';
        mm.querySelector('.mm-n').textContent = '正在进入「棱镜中枢」…';
        mm.classList.add('done');
        setTimeout(() => { onStart(); setTimeout(() => mm.remove(), 600); }, 700);
      }
    }, 250);
    mm.querySelector('.mm-cancel').onclick = () => { clearInterval(timer); mm.classList.remove('on'); setTimeout(() => mm.remove(), 300); };
  };
  $('#lobby-start').onclick = () => startGame();

  // —— 模式 / 地图选择（主页右下的模式卡）——
  const mapSel = maps.length ? setupMapSelect(stage, $('.lb-mode', lobby), maps, onMap, toast) : null;
  const party = setupParty({
    stage, maps, toast,
    getProfile: () => ({ name: loadName(), ...(getProfile?.() || {}) }),
    onEnter: (room, host) => { onMap && onMap(room.map); onRoom?.(room, host); },
  });

  // —— 引航者 ——
  // 只显示有模型的引航者（网页版没有 MMD 模型：露希、白羽用替身模型，其他的不显示）
  const has = (id) => characters.some((c) => c.id === id);
  const NAVS = NAVIGATORS.map((n) => {
    let skins = n.skins.filter((k) => has(k.id));
    if (!skins.length && n.fallback && has(n.fallback)) skins = [{ id: n.fallback, name: '默认' }];
    return { ...n, skins };
  }).filter((n) => n.skins.length);
  const SKIN_KEY = 'prismlink.skins';
  let skinPick = {};
  try { skinPick = JSON.parse(localStorage.getItem(SKIN_KEY) || '{}') || {}; } catch (e) { /* 无痕模式 */ }
  const skinOf = (n) => n.skins.find((k) => k.id === skinPick[n.name]) || n.skins[0];
  const charOf = (n) => characters.find((c) => c.id === skinOf(n).id) || null;
  const avOf = (n) => `${IMG}${n.img}?v=3`; // 头像换过图，版本号避免旧缓存
  let navSel = Math.min(DEFAULT_NAV, NAVS.length - 1), navDeployed = navSel, skillSel = 0, tab = 'skill';
  // 卡片列表
  const rosterList = $('.nv-roster .list', lobby);
  rosterList.innerHTML = NAVS.map((n, i) => `<div class="card${n.locked ? ' locked' : ''}" data-i="${i}"><img src="${avOf(n)}" alt=""><span>${n.name}</span></div>`).join('');
  $('.nv-roster .hd .cnt', lobby).textContent = `${NAVS.filter((n) => !n.locked).length} / ${NAVS.length}`;
  $('.nv-roster .more', lobby).onclick = () => rosterList.scrollBy({ left: rosterList.clientWidth * 0.8, behavior: 'smooth' });
  rosterList.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { rosterList.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  $$('.nv-roster .card.locked', lobby).forEach((c) => { c.classList.add('addlock'); });
  const homeHero = $('.lb-hero', lobby);
  // 技能 / 外观 / 档案 三个页签
  const skillBox = $('.nv-skill', lobby);
  function showTab(t) {
    tab = t;
    skillBox.dataset.tab = t;
    $$('.nv-skill .tabs a', lobby).forEach((a) => a.classList.toggle('on', a.dataset.t === t));
    if (t === 'skin') renderSkins();
    if (t === 'bio') renderBio();
  }
  $$('.nv-skill .tabs a', lobby).forEach((a) => { a.onclick = () => showTab(a.dataset.t); });
  function renderSkins() {
    const n = NAVS[navSel], cur = skinOf(n);
    const box = $('.nv-skins', lobby);
    box.innerHTML = `<div class="sk-hd"><b>${n.name} · 外观</b><span>${n.skins.length} 套</span></div><div class="sk-list">${n.skins.map((k) => `<div class="sk-card${k.id === cur.id ? ' on' : ''}" data-id="${k.id}"><img src="Asset/UI/Skins/${k.id}.jpg" alt="" onerror="this.style.visibility='hidden'"><span></span>${k.id === cur.id ? '<em>穿戴中</em>' : ''}</div>`).join('')}</div><p class="sk-tip">点击切换外观 · 出战时使用当前穿戴的外观</p>`;
    box.querySelectorAll('.sk-card').forEach((c, i) => { c.querySelector('span').textContent = n.skins[i].name; c.onclick = () => pickSkin(n, c.dataset.id); });
  }
  function pickSkin(n, id) {
    if (skinOf(n).id === id) return;
    skinPick[n.name] = id;
    try { localStorage.setItem(SKIN_KEY, JSON.stringify(skinPick)); } catch (e) { /* 无痕模式 */ }
    const k = n.skins.find((x) => x.id === id);
    toast(`已换上「${k.name}」`);
    if (NAVS[navDeployed] === n) onCharacter?.(charOf(n)); // 出战中的引航者：马上换模型
    renderSkins(); showNav(navSel, true);
  }
  function renderBio() {
    const n = NAVS[navSel];
    $('.nv-bio', lobby).innerHTML = `<div class="bio-row"><b>代号</b><span>NAVIGATOR / ${n.code}</span></div><div class="bio-row"><b>定位</b><span>${n.cls}</span></div><div class="bio-row"><b>信条</b><span>${n.motto}</span></div><div class="bio-row"><b>台词</b><span>${n.voice}</span></div><div class="bio-row"><b>外观</b><span>${n.skins.map((k) => k.name).join(' / ')}</span></div>`;
  }
  function showSkill(i) {
    skillSel = i;
    const s = SKILLS[i];
    $('#nv-skill-icon').src = IMG + s.icon;
    $('#nv-skill-name').textContent = s.name;
    $('#nv-skill-type').textContent = s.type;
    $('#nv-skill-desc').textContent = s.desc;
    $('#nv-skill-cd').textContent = s.cd;
    $$('.nv-skill .sk').forEach((c, k) => c.classList.toggle('on', k === i));
    const intro = $('.nv-skill .intro');
    intro.classList.remove('swap'); void intro.offsetWidth; intro.classList.add('swap');
  }
  // 引航者 3D 展示台（出场动画 + 待机）；不可用时保留原来的立绘
  let navStage = null;
  try {
    if (navViewer) {
      navStage = navViewer($('.nv-stage', lobby));
      navStage.active = () => lobby.dataset.page === 'navigator' && !lobby.classList.contains('hide');
      pageEl('navigator').classList.add('has3d');
    }
  } catch (e) { console.warn('引航者 3D 展示不可用，改用立绘', e); }
  function showNav(i, keep) {
    navSel = i;
    const n = NAVS[i], ch = charOf(n);
    if (navStage && ch && current === 'navigator') navStage.show(ch, ch.persona || ch.id).catch((e) => console.warn('引航者展示加载失败', e));
    $('#nv-code').textContent = n.code;
    $('#nv-name').textContent = n.name;
    $('#nv-cls').textContent = n.cls;
    $('#nv-motto').textContent = n.motto;
    $('#nv-model').textContent = ch ? `外观 · ${skinOf(n).name}` : '';
    $('#nv-lv').textContent = n.locked ? '未解锁' : `Lv.${n.lv}`;
    $('#nv-xp').textContent = n.locked ? '' : `${n.xp[0]} / ${n.xp[1]}`;
    $('#nv-xpbar').style.width = (n.xp[0] / n.xp[1] * 100).toFixed(0) + '%';
    $('#nv-voice').textContent = n.voice;
    $$('.nv-roster .card').forEach((c, k) => { c.classList.toggle('on', k === i); c.classList.toggle('deployed', k === navDeployed); });
    const dep = $('#nv-deploy');
    dep.classList.toggle('done', i === navDeployed);
    dep.classList.toggle('lockd', !!n.locked);
    dep.querySelector('span').textContent = n.locked ? '尚未解锁' : i === navDeployed ? '出战中' : '设为出战';
    if (!keep) {
      if (tab === 'skin') renderSkins();
      if (tab === 'bio') renderBio();
      const page = pageEl('navigator');
      page.classList.remove('swap'); void page.offsetWidth; page.classList.add('swap');
    }
  }
  $$('.nv-roster .card', lobby).forEach((c) => { c.onclick = () => showNav(+c.dataset.i); });
  $$('.nv-skill .sk', lobby).forEach((c) => { c.onclick = () => showSkill(+c.dataset.i); });
  $('#nv-deploy').onclick = () => deploy(false);
  function deploy(quiet, init) {
    const n = NAVS[navSel];
    if (n.locked) return quiet || toast(`「${n.name}」尚未解锁，可用引航凭证解锁`);
    navDeployed = navSel;
    if (!init) onCharacter?.(charOf(n)); // 初始化时 main.js 已经用默认角色（桔梗）
    // 大厅左侧名片跟着换
    $('.code', homeHero).textContent = `NAVIGATOR / ${n.code}`;
    $('.name', homeHero).textContent = n.name;
    $('.motto', homeHero).textContent = n.motto;
    // 头像固定用出战引航者的头像：右上角名片、小队栏
    const face = avOf(n);
    $('.lb-squad .slot.me img', lobby).src = face;
    $('.lb-profile .av', lobby).src = face;
    if (!quiet) toast(`「${n.name}」已设为出战`);
    showNav(navSel);
  }
  deploy(true, true);
  // 进入引航者页时才加载模型（大厅启动不多占内存）；已是同一个角色就重播出场
  navStageReplay = () => {
    const ch = charOf(NAVS[navSel]);
    if (!navStage || !ch) return;
    if (navStage.charKey === ch.file) navStage.replay();
    else navStage.show(ch, ch.persona || ch.id).catch((e) => console.warn('引航者展示加载失败', e));
  };
  showSkill(0);

  // —— 武器 ——
  // 3D 展示器（WebGL 不可用或没传进来时退回展示图）
  let viewer = null;
  try { if (gunViewer) viewer = gunViewer($('#wp-show')); } catch (e) { console.warn('武器 3D 展示不可用，改用图片', e); }
  if (viewer) viewer.active = () => lobby.dataset.page === 'weapon' && !lobby.classList.contains('hide');
  const shots = {};
  const shot = (w, skin, W, H) => (shots[`${w.id}/${skin}/${W}`] ||= viewer.snapshot(w, skin, W, H).catch(() => null));
  let catSel = 0, wSel = weapons[0], wEquipped = weapons[0], skinSel = 0;
  let attAll = loadSel(), attTab = false, attSlot = null;
  const wById = Object.fromEntries(weapons.map((w) => [w.id, w]));
  function renderWeapon() {
    const w = wSel;
    $('#wp-code').textContent = `${WEAPON_CATS.find(([, ids]) => ids.includes(w.id))[0]} / ${w.code}`;
    $('#wp-name').textContent = w.callsign;
    const gun = $('#wp-gun');
    const show = $('#wp-show');
    if (viewer) {
      // 3D 展示台：真模型实时渲染，涂装直接染材质
      viewer.setSkin(skinSel);
      viewer.show(w, skinSel).catch((e) => { console.warn('武器 3D 预览失败', e); show.classList.remove('ready'); });
    } else {
      gun.src = `${IMG}gun_${w.id}.png`;
      gun.style.filter = SKINS[skinSel].filter;
      show.classList.remove('swap'); void show.offsetWidth; show.classList.add('swap');
    }
    // 数值：装上配件之后的，和原版比较显示增减
    const md = applyAttachments(w, selFor(attAll, w.id));
    const st0 = weaponStats(w), st = weaponStats(md, w);
    $('#wp-rows').innerHTML = st.map(([k, v], i) => {
      const d = v - st0[i][1];
      return `<div class="row"><span>${k}</span><div class="bar"><i style="--v:${v}%"></i>${d < 0 ? `<u style="left:${v}%;width:${-d}%"></u>` : ''}</div><b>${v}${d ? `<sup class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${d}</sup>` : ''}</b></div>`;
    }).join('');
    $('#wp-mag').innerHTML = md.mag + (md.mag !== w.mag ? `<sup class="up">+${md.mag - w.mag}</sup>` : '');
    $('#wp-res').textContent = md.mag * 3;
    viewer?.setAttach(w, selFor(attAll, w.id)).catch(() => {});
    renderAttach();
    $$('#wp-list .card').forEach((c) => { c.classList.toggle('on', c.dataset.id === w.id); c.classList.toggle('eq', c.dataset.id === wEquipped.id); });
    const eq = $('#wp-equip');
    eq.classList.toggle('done', w === wEquipped);
    eq.querySelector('span').textContent = w === wEquipped ? '已装备' : '装备武器';
    $('#wp-skins').innerHTML = SKINS.map((s, i) => `<div class="skin${i === skinSel ? ' on' : ''}${s.locked ? ' locked' : ''}" data-i="${i}"><img src="${IMG}gun_${w.id}.png" style="filter:${s.filter}" alt=""><span>${s.name}</span>${i === 0 ? '<em>已装备</em>' : ''}${s.locked ? '<i class="lock"></i>' : ''}</div>`).join('');
    $$('#wp-skins .skin').forEach((c) => {
      c.onclick = () => {
        const s = SKINS[+c.dataset.i];
        if (s.locked) return toast(`「${s.name}」可在商城购买`);
        skinSel = +c.dataset.i;
        renderWeapon();
      };
    });
    if (viewer) $$('#wp-skins .skin img').forEach((img, i) => shot(w, i, 410, 168).then((u) => { if (u && img.isConnected) { img.src = u; img.style.filter = 'none'; } }));
  }
  function renderCat(i) {
    catSel = i;
    $$('.wp-cats a', lobby).forEach((a, k) => a.classList.toggle('on', k === i));
    const ids = WEAPON_CATS[i][1];
    const list = $('#wp-list');
    list.innerHTML = ids.map((id) => `<div class="card" data-id="${id}"><img src="${IMG}gun_${id}.png" alt=""><b>${wById[id].code}</b><span>${wById[id].name}</span></div>`).join('');
    list.classList.remove('swap'); void list.offsetWidth; list.classList.add('swap');
    $$('#wp-list .card').forEach((c) => { c.onclick = () => { wSel = wById[c.dataset.id]; skinSel = 0; attSlot = null; renderWeapon(); }; });
    if (viewer) $$('#wp-list .card img').forEach((img) => shot(wById[img.parentNode.dataset.id], 0, 440, 160).then((u) => { if (u && img.isConnected) img.src = u; }));
    if (!ids.includes(wSel.id)) { wSel = wById[ids[0]]; skinSel = 0; }
    renderWeapon();
  }
  $$('.wp-cats a', lobby).forEach((a) => { a.onclick = () => renderCat(+a.dataset.i); });
  $('#wp-equip').onclick = () => {
    wEquipped = wSel;
    onWeapon?.(weapons.indexOf(wSel));
    toast(`进入训练场时手持「${wSel.name}」`);
    renderWeapon();
  };
  // 配件槽位一排可以左右滑：滚轮转成横向，按住拖动也行
  {
    const box = $('#wp-attach');
    box.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); box.scrollLeft += e.deltaY; } }, { passive: false });
    let drag = null;
    box.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, s: box.scrollLeft, moved: false }; });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; box.setPointerCapture(e.pointerId); box.style.scrollBehavior = 'auto'; }
      if (drag.moved) box.scrollLeft = drag.s - dx;
    });
    const end = () => { if (drag?.moved) { box.style.scrollBehavior = ''; box.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true }); } drag = null; };
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  }
  $$('.wp-tabs a', lobby).forEach((a, i) => { a.onclick = () => { $$('.wp-tabs a', lobby).forEach((x) => x.classList.toggle('on', x === a)); attTab = !!i; attSlot = null; renderAttach(); }; });

  // —— 配件：下方一排六个槽位（这把枪没有对应配件模型的显示「未有」）。
  // 点槽位：镜头推到枪上对应的部件，上方列出可选配件；再点一次同一个槽位：镜头复原。按枪保存 ——
  function renderAttach() {
    const page = $('.lb-page[data-page="weapon"]', lobby) || lobby;
    page.classList.toggle('att-mode', attTab);
    const box = $('#wp-attach');
    viewer?.focus(attTab ? attSlot : null);
    page.classList.toggle('att-open', attTab && !!attSlot);
    if (!attTab) return;
    const w = wSel, sel = selFor(attAll, w.id);
    // 点开的槽位右边像抽屉一样拉出可选配件，其它槽位收窄
    box.innerHTML = SLOTS.map((s) => {
      const list = optionsFor(w.id, s.id), cur = sel[s.id] ? ATTACHMENTS[sel[s.id]] : null;
      let h = `<div class="slot${list.length ? '' : ' na'}${attSlot === s.id ? ' on' : ''}${cur ? ' eq' : ''}" data-s="${s.id}" title="${s.name}${cur ? '：' + cur.name : ''}">
        <div class="ic">${ATT_ICON[sel[s.id] || s.id] || ''}</div>
        <span class="sn">${s.name}<em>${s.en}</em></span><b>${list.length ? (cur ? cur.name : '原厂') : '未有'}</b></div>`;
      if (attSlot === s.id) {
        h += `<div class="drawer">` + [null, ...list].map((id) => {
          const a = id ? ATTACHMENTS[id] : null, on = (sel[s.id] || null) === id;
          return `<div class="opt${on ? ' on' : ''}" data-id="${id || ''}" title="${a ? a.desc : '不装配件'}"><div class="ic">${id ? ATT_ICON[id] : ATT_ICON.none}</div><b>${a ? a.name : '原厂配置'}</b><p>${a ? a.desc : '不装配件'}</p></div>`;
        }).join('') + `</div>`;
      }
      return h;
    }).join('');
    $$('#wp-attach .slot').forEach((c) => {
      c.onclick = () => {
        if (c.classList.contains('na')) return toast(`${w.name}未有${SLOTS.find((s) => s.id === c.dataset.s).name}配件`);
        attSlot = attSlot === c.dataset.s ? null : c.dataset.s; renderAttach();
      };
    });
    // 抽屉拉出来之后，把它滑到看得见的位置
    const dr = $('#wp-attach .drawer');
    if (dr && !box.classList.contains('keep')) requestAnimationFrame(() => {
      const r = dr.getBoundingClientRect(), b = box.getBoundingClientRect(), sl = $('#wp-attach .slot.on').getBoundingClientRect();
      if (r.right > b.right - 20) box.scrollLeft += r.right - b.right + 30;
      else if (sl.left < b.left) box.scrollLeft -= b.left - sl.left + 10;
    });
    $$('#wp-attach .drawer .opt').forEach((c) => {
      c.onclick = () => {
        const all = { ...attAll, [w.id]: { ...selFor(attAll, w.id) } };
        if (c.dataset.id) all[w.id][attSlot] = c.dataset.id; else delete all[w.id][attSlot];
        attAll = all; saveSel(attAll);
        toast(c.dataset.id ? `已装配「${ATTACHMENTS[c.dataset.id].name}」` : `已卸下${SLOTS.find((s) => s.id === attSlot).name}`);
        const x = box.scrollLeft;
        box.classList.add('keep'); // 换配件时抽屉不再重播展开动画
        renderWeapon();
        box.style.scrollBehavior = 'auto'; box.scrollLeft = x; box.style.scrollBehavior = '';
        box.classList.remove('keep');
      };
    });
  }
  // 拖动旋转：有 3D 展示器时由它处理（360° 自由转、滚轮缩放）；否则用图片的假 3D 倾斜
  const show = $('#wp-show');
  if (!viewer) {
    let drag = null;
    show.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY }; show.setPointerCapture(e.pointerId); show.classList.add('drag'); };
    show.onpointermove = (e) => {
      if (!drag) return;
      const ry = Math.max(-40, Math.min(40, (e.clientX - drag.x) * 0.25)), rx = Math.max(-20, Math.min(20, -(e.clientY - drag.y) * 0.2));
      $('#wp-gun').style.transform = `rotateY(${ry}deg) rotateX(${rx}deg)`;
    };
    show.onpointerup = show.onpointercancel = () => { drag = null; show.classList.remove('drag'); $('#wp-gun').style.transform = ''; };
  }
  $('#wp-inspect').onclick = () => (viewer ? viewer.toggleZoom() : show.classList.toggle('zoom'));
  renderCat(0);

  // —— 仓库 ——
  let itemCat = '全部', itemSel = 0, sortBy = 'q';
  function renderItems() {
    const q = $('#st-q').value.trim();
    const list = ITEMS.map((it, i) => ({ ...it, i })).filter((it) => (itemCat === '全部' || it.cat === itemCat) && (!q || it.name.includes(q)) && it.n > 0);
    list.sort((a, b) => (sortBy === 'q' ? b.q - a.q || a.i - b.i : b.n - a.n));
    const grid = $('#st-grid');
    grid.innerHTML = list.map((it) => `<div class="item q${it.q}${it.i === itemSel ? ' on' : ''}" data-i="${it.i}"><img src="${IMG}item${String(it.i + 1).padStart(2, '0')}.jpg" alt=""><span>${it.name}</span><b>${it.n}</b><i></i></div>`).join('') || '<div class="empty">没有符合条件的道具</div>';
    [...grid.children].forEach((c, k) => c.style.setProperty('--k', k));
    grid.classList.remove('swap'); void grid.offsetWidth; grid.classList.add('swap');
    $$('#st-grid .item').forEach((c) => { c.onclick = () => { itemSel = +c.dataset.i; renderItems(); renderDetail(); }; });
    $('#st-total').textContent = `共 ${list.length} 种道具`;
    $('#st-own').textContent = ITEMS.reduce((s, it) => s + it.n, 0);
  }
  function renderDetail() {
    const it = ITEMS[itemSel];
    $('#st-name').textContent = it.name;
    const qe = $('#st-qual');
    qe.textContent = QUALITY[it.q];
    qe.className = 'q q' + it.q;
    $('#st-img').src = `${IMG}item${String(itemSel + 1).padStart(2, '0')}.jpg`;
    $('#st-count').textContent = it.n;
    $('#st-desc').textContent = it.desc;
    $('#st-from').textContent = it.from;
    $('#st-n').value = Math.min(Math.max(1, +$('#st-n').value || 1), Math.max(1, it.n));
    const d = $('.st-detail');
    d.classList.remove('swap'); void d.offsetWidth; d.classList.add('swap');
  }
  $$('.st-cats a', lobby).forEach((a) => { a.onclick = () => { itemCat = a.dataset.cat; $$('.st-cats a', lobby).forEach((x) => x.classList.toggle('on', x === a)); renderItems(); }; });
  $('#st-q').oninput = renderItems;
  $('#st-sort').onclick = () => { sortBy = sortBy === 'q' ? 'n' : 'q'; $('#st-sort span').textContent = sortBy === 'q' ? '品质优先' : '数量优先'; renderItems(); };
  $$('.use-n a', lobby).forEach((a) => {
    a.onclick = () => {
      const it = ITEMS[itemSel], el = $('#st-n');
      const v = a.dataset.d === 'all' ? it.n : (+el.value || 1) + +a.dataset.d;
      el.value = Math.max(1, Math.min(it.n, v));
    };
  });
  $('#st-use').onclick = () => {
    const it = ITEMS[itemSel], n = Math.min(it.n, Math.max(1, +$('#st-n').value || 1));
    if (!it.n) return;
    it.n -= n;
    toast(`已使用「${it.name}」× ${n}`);
    if (!it.n) { const next = ITEMS.findIndex((x) => x.n > 0); if (next >= 0) itemSel = next; }
    $('#st-n').value = 1;
    renderItems();
    renderDetail();
  };
  renderItems();
  renderDetail();

  // —— 商城 ——
  let slide = 0, slideTimer = 0, shopCat = '精选';
  const owned = new Set();
  function showSlide(i) {
    slide = (i + HERO_SLIDES.length) % HERO_SLIDES.length;
    const s = HERO_SLIDES[slide];
    $$('#sh-hero .slide').forEach((el, k) => el.classList.toggle('on', k === slide));
    $$('#sh-hero .dots i').forEach((el, k) => el.classList.toggle('on', k === slide));
    $('#sh-tag').textContent = s.tag;
    $('#sh-title').textContent = s.title;
    $('#sh-sub').textContent = s.sub;
    $('#sh-copy').textContent = s.copy;
    $('#sh-price').textContent = fmt(s.price);
    const p = $('#sh-hero .sh-panel');
    p.classList.remove('swap'); void p.offsetWidth; p.classList.add('swap');
    clearInterval(slideTimer);
    slideTimer = setInterval(() => { if (current === 'shop') showSlide(slide + 1); }, 5000);
  }
  $$('#sh-hero .dots i').forEach((d) => { d.onclick = () => showSlide(+d.dataset.i); });
  function renderShop() {
    const list = SHOP_ITEMS.filter((s) => !s.side || shopCat !== '精选').filter((s) => shopCat === '精选' || s.cat === shopCat);
    const box = $('#sh-items');
    box.innerHTML = list.map((s) => `<div class="sh-card" data-name="${esc(s.name)}"><img src="${IMG}${s.img}" alt=""><div class="t"><b>${s.name}</b><span>${s.type}</span></div><div class="p">${owned.has(s.name) ? '<em>已拥有</em>' : `<img src="${IMG}crystal.png" alt=""><b>${fmt(s.price)}</b>`}<span class="chev"></span></div></div>`).join('') || '<div class="empty">该分类暂无商品</div>';
    [...box.children].forEach((c, k) => c.style.setProperty('--k', k));
    box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap');
    $$('.sh-card', pageEl('shop')).forEach((c) => { c.onclick = () => openBuy(SHOP_ITEMS.find((s) => s.name === c.dataset.name)); });
  }
  $$('.sh-cats a', lobby).forEach((a) => { a.onclick = () => { shopCat = a.dataset.cat; $$('.sh-cats a', lobby).forEach((x) => x.classList.toggle('on', x === a)); renderShop(); }; });
  // 购买确认
  const modal = $('#sh-modal');
  let buying = null;
  function openBuy(item) {
    if (!item) return;
    if (owned.has(item.name)) return toast(`已拥有「${item.name}」`);
    buying = item;
    $('#sh-m-img').src = IMG + item.img;
    $('#sh-m-name').textContent = item.name;
    $('#sh-m-type').textContent = item.type;
    $('#sh-m-price').textContent = fmt(item.price);
    const left = account.crystal - item.price;
    $('#sh-m-left').textContent = left >= 0 ? `购买后剩余 ${fmt(left)}` : `晶体不足，还差 ${fmt(-left)}`;
    $('#sh-m-left').classList.toggle('bad', left < 0);
    $('.ok', modal).disabled = left < 0;
    modal.classList.add('on');
  }
  $('#sh-detail').onclick = () => { const s = HERO_SLIDES[slide]; openBuy({ name: s.title, type: s.sub, price: s.price, img: s.img }); };
  modal.onclick = (e) => {
    const m = e.target.dataset.m;
    if (e.target === modal || m === 'cancel') modal.classList.remove('on');
    if (m === 'ok' && buying && account.crystal >= buying.price) {
      account.crystal -= buying.price;
      owned.add(buying.name);
      refreshMoney();
      modal.classList.remove('on');
      toast(`购买成功：「${buying.name}」`);
      renderShop();
    }
  };
  showSlide(0);
  renderShop();

  // 从局内返回大厅（页面重新加载）后，恢复之前的出战角色、武器和地图
  function restore({ nav, weapon, map } = {}) {
    const ni = NAVS.findIndex((x) => !x.locked && x.skins.some((k) => k.id === nav)); // nav：出战角色的模型 id（某个引航者的某套外观）
    if (ni >= 0) { navSel = ni; if (skinOf(NAVS[ni]).id !== nav) skinPick[NAVS[ni].name] = nav; deploy(true); }
    const w = weapons.find((x) => x.id === weapon);
    if (w) { wSel = w; wEquipped = w; onWeapon?.(weapons.indexOf(w)); renderWeapon(); }
    if (map && mapSel) mapSel.set(map);
  }
  return { go, restore };
}

// ———————————— 模式 / 训练地图选择 ————————————
const MODES = [
  { id: 'train', name: '训练模式', en: 'TRAINING', open: true, sub: '训练地图', note: '纸片靶自动刷新，随时切换武器练枪' },
  { id: 'rank', name: '竞技模式', en: 'RANKED', open: true, sub: '竞技地图', note: '4V4 团队竞技 · AI 队友与对手 · 先拿到 30 击杀的队伍获胜' },
  { id: 'fun', name: '娱乐模式', en: 'ARCADE', open: false },
];
const modeOf = (m) => (m.mode === 'ranked' ? 'rank' : 'train');
function setupMapSelect(stage, card, maps, onMap, toast) {
  let chosen = (maps.find((m) => modeOf(m) === 'train') || maps[0]).id, pick = chosen, view = 'train';
  let play = 'ai', playPick = 'ai'; // 竞技：AI 对战 / 组队联机
  const el = document.createElement('div');
  el.className = 'mx-modal';
  el.innerHTML = `<div class="mx-box glass">
    <div class="mx-head"><div class="mt">选择模式</div>
      <div class="mx-tabs">${MODES.map((m) => `<a data-mode="${m.id}" class="${m.open ? '' : ' off'}"><b>${m.name}</b><span>${m.en}</span></a>`).join('')}</div>
      <div class="mx-play" hidden>
        <a data-play="ai"><svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 7V4M9 12h.01M15 12h.01M9.5 15h5"/></svg><div><b>AI 对战</b><span>和 AI 队友一起 4V4</span></div></a>
        <a data-play="party"><svg viewBox="0 0 24 24"><circle cx="8" cy="9" r="3"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M3 19c.6-3 2.6-5 5-5s4.4 2 5 5M13.5 15.2c.9-.8 1.9-1.2 3-1.2 2 0 3.6 1.6 4 4.5"/></svg><div><b>组队联机</b><span>创建 / 加入玩家房间</span></div></a>
      </div>
      <a class="mx-x" title="关闭"></a></div>
    <div class="mx-sub"><i></i><b class="st"></b> <span></span></div>
    <div class="mx-list"></div>
    <div class="mx-foot"><span class="info"></span><button class="mx-cancel">取消</button><button class="mx-ok">确定</button></div>
  </div>`;
  stage.appendChild(el);
  const list = el.querySelector('.mx-list');
  const info = el.querySelector('.info');
  const cards = () => [...list.querySelectorAll('.mx-card')];
  const select = (id) => {
    pick = id;
    cards().forEach((c) => c.classList.toggle('on', c.dataset.map === id));
    const m = maps.find((x) => x.id === id);
    info.innerHTML = m ? `已选择 <b>${m.name}</b> <span>${m.en}</span>` : '';
  };
  // 切换模式页签：列出这个模式的地图
  const show = (mode) => {
    view = mode;
    const M = MODES.find((x) => x.id === mode);
    el.querySelectorAll('.mx-tabs a').forEach((a) => a.classList.toggle('on', a.dataset.mode === mode));
    el.querySelector('.mx-play').hidden = mode !== 'rank';
    setPlay(playPick);
    const ms = maps.filter((m) => modeOf(m) === mode);
    el.querySelector('.mx-sub .st').textContent = M.sub;
    el.querySelector('.mx-sub span').textContent = `${ms.length} 张 · ${M.note}`;
    list.dataset.n = ms.length;
    list.innerHTML = ms.map((m, i) => `<div class="mx-card${m.mode === 'ranked' ? ' ranked' : ''}" data-map="${m.id}" style="--i:${i}">
      <div class="im"><img src="Asset/UI/Lobby/map_${m.id}.jpg" alt=""><em>0${i + 1}</em></div>
      <div class="tx"><b>${m.name}</b><span class="en">${m.en}</span>
      <p>${m.desc}</p><div class="tg">${m.tags.map((t) => `<i>${t}</i>`).join('')}</div></div>
      <span class="ck"></span></div>`).join('');
    cards().forEach((c) => { c.onclick = () => select(c.dataset.map); c.ondblclick = () => { select(c.dataset.map); el.querySelector('.mx-ok').click(); }; });
    select(ms.some((m) => m.id === pick) ? pick : ms[0]?.id);
  };
  const setPlay = (p) => {
    playPick = p;
    el.querySelectorAll('.mx-play a').forEach((a) => a.classList.toggle('on', a.dataset.play === p));
  };
  el.querySelectorAll('.mx-play a').forEach((a) => { a.onclick = () => setPlay(a.dataset.play); });
  const apply = () => {
    const m = maps.find((x) => x.id === chosen);
    const ranked = m.mode === 'ranked';
    card.querySelector('.md span').textContent = ranked ? (play === 'party' ? '竞技模式 · 组队联机' : '竞技模式 · 4V4') : '训练模式';
    card.querySelector('.md b').textContent = m.name;
    card.querySelector('.pv').style.backgroundImage = `url(Asset/UI/Lobby/map_${m.id}.jpg)`;
    const st = document.querySelector('#lobby-start span');
    if (st) st.textContent = ranked ? (play === 'party' ? '组队联机' : '开始匹配') : '开始训练';
  };
  const open = () => { pick = chosen; show(modeOf(maps.find((x) => x.id === chosen))); el.classList.add('on'); };
  const close = () => el.classList.remove('on');
  card.onclick = open;
  el.querySelectorAll('.mx-tabs a').forEach((a) => {
    a.onclick = () => {
      if (a.classList.contains('off')) return toast(`${a.querySelector('b').textContent}暂未开放，敬请期待`);
      show(a.dataset.mode);
    };
  });
  el.querySelector('.mx-x').onclick = close;
  el.querySelector('.mx-cancel').onclick = close;
  el.onclick = (e) => { if (e.target === el) close(); };
  el.querySelector('.mx-ok').onclick = () => {
    if (!maps.some((m) => m.id === pick)) return;
    chosen = pick;
    if (view === 'rank') play = playPick;
    onMap && onMap(chosen);
    apply();
    close();
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
  };
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.classList.contains('on')) close(); });
  apply();
  return {
    set(id) { if (maps.some((m) => m.id === id)) { chosen = id; onMap && onMap(id); apply(); } },
    ranked: () => maps.find((m) => m.id === chosen)?.mode === 'ranked',
    current: () => chosen,
    party: () => play === 'party' && maps.find((m) => m.id === chosen)?.mode === 'ranked',
  };
}
