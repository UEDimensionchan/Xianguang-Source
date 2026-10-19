// 可选角色：file 相对于 index.html
export const CHARACTERS = [
  // 下面三个是从 Booth 购买的模型转换的（SELESTIA 自带 VRM；桔梗、薄荷由 tools/vrm 转换）。
  // 许可只允许购买者本人使用、禁止再分发：只放在本地，不要上传到公开网页
  { id: 'selestia', name: '赛蕾斯蒂娅', file: 'Asset/Character/VRM/Selestia.vrm', color: '#ff9ccf', face: 'Asset/UI/Lobby/nav_av4.jpg' },
  { id: 'kikyo',    name: '桔梗',       file: 'Asset/Character/VRM/Kikyo.vrm',    color: '#a9a6ff', face: 'Asset/UI/Lobby/nav_av2.jpg' },
  { id: 'mint',     name: '薄荷',       file: 'Asset/Character/VRM/Mint.vrm',     color: '#8fe3ff', face: 'Asset/UI/Lobby/nav_av1.jpg' },
  // MMD 粉丝模型（Character 文件夹转的 VRM，tools/vrm/pmx2vrm_blender.py + glb2vrm.py）：只放本地，不要上传到网页
  { id: 'sakamata', name: '露希', file: 'Asset/Character/VRM/MMD/SAKAMATA.vrm', color: '#d0d0dc', face: 'Asset/UI/Lobby/nav_av6.jpg', persona: 'luxi' },
  { id: 'bijou', name: '白羽', file: 'Asset/Character/VRM/MMD/BIJOU.vrm', color: '#c9b6ff', face: 'Asset/UI/Lobby/nav_av7.jpg', persona: 'baiyu' },
  { id: 'bijou2', name: '白羽', file: 'Asset/Character/VRM/MMD/BIJOU2.vrm', color: '#c9b6ff', face: 'Asset/UI/Lobby/nav_av7.jpg', persona: 'baiyu' },
  { id: 'chihaya', name: '黛音', file: 'Asset/Character/VRM/MMD/CHIHAYA.vrm', color: '#3fd6d0', face: 'Asset/UI/Lobby/nav_chihaya.jpg', persona: 'daiyin' },
  { id: 'chihaya2', name: '黛音', file: 'Asset/Character/VRM/MMD/CHIHAYA2.vrm', color: '#3fd6d0', face: 'Asset/UI/Lobby/nav_chihaya.jpg', persona: 'daiyin' },
  { id: 'sakuna', name: '绯樱', file: 'Asset/Character/VRM/MMD/SAKUNA.vrm', color: '#ff8fbf', face: 'Asset/UI/Lobby/nav_sakuna.jpg', persona: 'feiying' },
  { id: 'pekomama', name: '雪兔', file: 'Asset/Character/VRM/MMD/PEKOMAMA.vrm', color: '#8fc2ff', face: 'Asset/UI/Lobby/nav_pekomama.jpg', persona: 'xuetu' },
  { id: 'vivi', name: '琉璃', file: 'Asset/Character/VRM/MMD/VIVI.vrm', color: '#d58cff', face: 'Asset/UI/Lobby/nav_vivi.jpg', persona: 'liuli' },
  { id: 'calli_k2l', name: '绮罗', file: 'Asset/Character/VRM/MMD/CALLI_kawaii2_Long.vrm', color: '#ff9fb8', face: 'Asset/UI/Lobby/nav_calli.jpg', persona: 'qiluo' },
  { id: 'calli_k2s', name: '绮罗', file: 'Asset/Character/VRM/MMD/CALLI_kawaii2_Short.vrm', color: '#ff9fb8', face: 'Asset/UI/Lobby/nav_calli.jpg', persona: 'qiluo' },
  { id: 'calli_kl', name: '绮罗', file: 'Asset/Character/VRM/MMD/CALLI_kawaii_Long.vrm', color: '#ff9fb8', face: 'Asset/UI/Lobby/nav_calli.jpg', persona: 'qiluo' },
  { id: 'calli_ks', name: '绮罗', file: 'Asset/Character/VRM/MMD/CALLI_kawaii_Short.vrm', color: '#ff9fb8', face: 'Asset/UI/Lobby/nav_calli.jpg', persona: 'qiluo' },
  { id: 'rin',      name: '凛',           file: 'Asset/Character/VRM/Rin.vrm', color: '#33e6c8' },
  { id: 'shino',    name: '千駄ヶ谷 篠',   file: 'Asset/Character/VRM/Sendagaya_Shino.vrm',   color: '#7fb8ff', face: 'Asset/UI/Lobby/nav_av7.jpg', persona: 'baiyu' },
  { id: 'fumiriya', name: '桜田 史利矢',   file: 'Asset/Character/VRM/Sakurada_Fumiriya.vrm', color: '#ff9ec4' },
  { id: 'sampleD',  name: '样本 D',        file: 'Asset/Character/VRM/AvatarSample_D.vrm',    color: '#ffd27f' },
  { id: 'sampleE',  name: '样本 E',        file: 'Asset/Character/VRM/AvatarSample_E.vrm',    color: '#9fe3c4' },
  { id: 'sampleF',  name: '样本 F',        file: 'Asset/Character/VRM/AvatarSample_F.vrm',    color: '#c6b3ff' },
  { id: 'sampleG',  name: '样本 G',        file: 'Asset/Character/VRM/AvatarSample_G.vrm',    color: '#ffb38a', face: 'Asset/UI/Lobby/nav_av6.jpg', persona: 'luxi' },
  { id: 'darkness', name: '样本 D·暗',     file: 'Asset/Character/VRM/AvatarSample_D_Darkness.vrm', color: '#9a8cb8' },
];

// 固定头像：用映射的引航者头像（薄荷→凛、桔梗→澪、赛蕾斯蒂娅→星野），大厅、比分栏、联机房间都用这张；没有的角色局内现场渲染
for (const c of CHARACTERS) if (c.face && !c.face.includes('?')) c.face += '?v=3'; // 头像换过图，加版本号避免浏览器用旧缓存
export const charFace = (id) => CHARACTERS.find((c) => c.id === id)?.face || '';

export const ASSETS = {
  world: 'Asset/Scene/collision-world.glb',
  gun: 'Asset/Weapon/blaster-repeater.glb',
  navShow: 'Asset/Animation/nav_show.json', // 引航者页的出场 / 待机展示动画（Blender：Character/_blender/展示动画.blend）
  anim: 'Asset/Animation/ual_vrm.json', // Quaternius 动作包烘焙后的 VRM 通用动作（tools/bake.html 生成）
  // 通用音效（每把枪自己的开火、换弹音效在 src/weapons.js 里配置）
  sfx: {
    jump: 'Asset/Audio/Player/jump.ogg',
    land: 'Asset/Audio/Player/land.ogg',
    step: 'Asset/Audio/Player/step.ogg',
    paper: 'Asset/Audio/Player/paper.ogg',
    unpaper: 'Asset/Audio/Player/unpaper.ogg',
    hurt: 'Asset/Audio/Combat/player_hurt.ogg',
    hitBody: 'Asset/Audio/Combat/hit_body.ogg',
    hitHead: 'Asset/Audio/Combat/hit_head.ogg',
    kill: 'Asset/Audio/Combat/kill.ogg',
    killHead: 'Asset/Audio/Combat/kill_head.ogg',
    wall1: 'Asset/Audio/Combat/impact_wall_1.ogg',
    wall2: 'Asset/Audio/Combat/impact_wall_2.ogg',
    wall3: 'Asset/Audio/Combat/impact_wall_3.ogg',
    explosion: 'Asset/Audio/Combat/explosion.ogg',
    dryFire: 'Asset/Audio/Weapon/Common/dry_fire.ogg',
    switch: 'Asset/Audio/Weapon/Common/switch.ogg',
    enemyShoot: 'Asset/Audio/Enemy/throw.ogg',
  },
};

// 玩法数值，调手感改这里
export const TUNING = {
  worldScale: 1.6,
  gravity: 30,

  player: {
    radius: 0.35,
    height: 1.62,
    maxHp: 100,
    walkAccel: 26,   // 地面最高速度约 = walkAccel / 6（米/秒）：平时慢跑约 4.3
    sprintMul: 1.7,  // 按住 Shift 冲刺：速度 ×1.7（约 7.4 米/秒）
    stamina: { max: 100, drain: 24, regen: 22, delay: 0.9, resume: 25 }, // 冲刺体力：每秒消耗 / 恢复，停跑多久后开始恢复，耗尽后恢复到多少才能再跑
    airAccel: 9,
    jumpSpeed: 10,
    regenDelay: 4,
    regenRate: 25,
  },

  paper: {            // 纸化
    thickness: 0.05,  // 纸化时侧面厚度比例
    speedMul: 1.3,
    energyMax: 100,
    drain: 28,        // 每秒消耗
    regen: 18,
    hitHalfWidth: 0.035,
  },

  gun: {
    damage: 20,
    headMul: 2,
    rate: 10,         // 每秒发数
    mag: 30,
    reload: 1.6,
    spread: 0.012,
    recoil: 0.011,
    range: 120,
  },

  dash: { speed: 17, cooldown: 5 },                                  // E 纸鹤突进
  bomb: { speed: 19, cooldown: 9, radius: 3.6, damage: 95 },         // Q 墨水炸弹

  dummy: {
    count: 5,
    hp: 150,
    respawn: 3,
    strafeSpeed: 2.6,
    projectileSpeed: 11,
    projectileDamage: 10,
  },
};
