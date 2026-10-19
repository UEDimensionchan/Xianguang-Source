import * as THREE from 'three';
import { VRMUtils } from '@pixiv/three-vrm';

// 桌宠：右下角一个 Q 版的“当前角色”（用同一个 VRM 模型，头放大、身体缩短，像手办），
// 会眨眼、呼吸、东张西望；击杀时欢呼、爆头更兴奋、连杀跳起来，被击倒会难过然后鼓励你，
// 复活打气、血少了提醒，还会对冲刺 / 炸弹 / 换弹 / 比分 / 表情包做反应。每个引航者的台词、动作和待机小习惯都不同（PROFILES）。画在主画面的右下角一小块（和第一人称手臂一样直接叠在画面上）。

// —— 每个引航者自己的桌宠：台词、动作、待机小习惯都不一样 ——
// 凛（薄荷）：突击，爽朗热血，嘴边总挂着“风”；澪（桔梗）：支援，温柔沉稳，像潮水一样护着你；
// 星野（赛蕾斯蒂娅）：侦察，古灵精怪，爱说星星、爱“标记目标”。
// lines[事件] = 台词；poses[事件] = 这个角色做的动作（随机选一个）；idle = 没事时的小动作
const PROFILES = {
  mint: { // 凛
    color: '#33e6c8',
    lines: {
      hello: ['风向正好，出发！', '凛，就位！跟紧我！', '今天也要把天空踩在脚下！', '准备好了吗？我已经等不及了！'],
      start: ['开打了！冲在最前面的一定是我们！', '风已经替我们开好路了！', '上吧——自由成锋！', '别犹豫，第一个冲出去！'],
      kill: ['漂亮！就是这股劲！', '好快的一枪！', '风都追不上你！', '干脆利落，我喜欢！', '下一个！别停！', '这就是突击手的速度！', '帅呆了！', '一口气推过去！'],
      head: ['爆头！准到起风了！', '眉心一枪，帅！', '就该这么打！正中！', '一发入魂！', '哇——这枪我要记下来！'],
      double: ['双杀！风越来越大了！', '一口气两个！', '连着带走，好样的！'],
      streak: ['三连杀！谁都挡不住我们！', '风暴来了！', '停不下来啦！', '整条街都是我们的！'],
      rampage: ['无人能挡！！', '这才是自由成锋！', '你就是这片天空的风！'],
      death: ['摔一跤而已，站起来！', '风停一下，马上还会再吹的！', '没事！下一波我们一起冲！', '别泄气，刚才那波已经很帅了！', '记住他的位置，等会儿还回去！', '拍拍灰，继续！'],
      respawn: ['满血！冲啊！', '风又起来了！', '这次换我们开路！', '去把刚才那个打回来！'],
      low: ['血不多了！先闪开！', '别硬冲，绕一下！', '喂喂，快找掩体！', '退一步，等风来！'],
      healed: ['状态满了，继续冲！', '好了好了，又能冲了！'],
      hurt: ['啧，被打到了！', '在那边！', '小心侧面！'],
      reload: ['快换弹！', '换弹别站着！'],
      dash: ['飞起来——！', '就是这个速度！', '呼——好爽！'],
      bomb: ['送你个大礼包！', '炸开它！'],
      paper: ['变薄！躲过去！', '嘿，打不着～'],
      lead: ['领先了！再拉开点！', '就这样一路冲到底！'],
      behind: ['落后一点而已，追上去！', '别慌，风向会变的！'],
      matchpoint: ['就差一个了！最后一冲！', '赛点！拿下它！'],
      win: ['赢啦——！这片天空是我们的！', '漂亮的胜利！击个掌！', '就说了跟着风走没错吧！'],
      lose: ['这局风向不对……下局一定赢！', '输了也要笑着！再来一局！', '记住了，下次加倍还回去！'],
      idle: ['腿都痒了，去前面看看？', '风从那边吹过来……', '站着不动可不像我们！', '要不要比比谁先拿下一杀？', '嗯——伸个懒腰！', '天气不错，适合冲锋！', '我在想下一条进攻路线～'],
      emote: ['哈哈，说得好！', '我也来一个！', '气势不能输！'],
    },
    poses: {
      hello: ['salute', 'wave'], start: ['fist', 'point'], kill: ['fist', 'cheer', 'point'], head: ['jump', 'spin'], double: ['jump', 'fist'],
      streak: ['spin', 'jump'], rampage: ['spin'], death: ['slump', 'shrug'], respawn: ['pump', 'fist'], low: ['shake'], healed: ['pump'],
      hurt: ['flinch'], reload: ['nod'], dash: ['lean'], bomb: ['throw'], paper: ['tilt'], lead: ['fist'], behind: ['pump'], matchpoint: ['point'],
      win: ['spin', 'jump'], lose: ['shrug'], emote: ['cheer'],
    },
    idle: ['stretch', 'bounce', 'look', 'windhair', 'point', 'fist'],
  },
  kikyo: { // 澪
    color: '#8fa8ff',
    lines: {
      hello: ['澪在这里，别怕。', '我会一直在你身后。', '潮声为引……开始吧。', '今天也请多指教。'],
      start: ['战斗开始了，注意走位。', '我会看着你的背后，放心往前。', '慢一点，稳一点，就不会输。', '深呼吸——好，走吧。'],
      kill: ['做得很好。', '干净的一枪。', '嗯，很稳。', '就是这样，保持住。', '辛苦了，下一个。', '漂亮……我都看到了。', '这一下很果断呢。'],
      head: ['正中，很准呢。', '精准……真了不起。', '这一枪，我会记住的。', '安静又致命，很好。'],
      double: ['两个了，别贪，稳住。', '连续拿下，节奏很好。'],
      streak: ['像潮水一样，一波接一波。', '你今天状态真好。', '我有点为你骄傲了。'],
      rampage: ['……无人能挡呢。', '这片战场已经是你的了。'],
      death: ['没关系，我在。', '先休息一下，我们重新来。', '不是你的错，对方只是运气好。', '别难过，下一次会更好的。', '刚才的位置有点危险，换个路线吧。', '深呼吸……好，我们再试一次。'],
      respawn: ['回来了就好，这次我护着你。', '慢慢来，不着急。', '先看清楚，再出手。', '我一直在后面，放心去吧。'],
      low: ['你受伤了……先退下来。', '别逞强，找个掩体。', '我很担心，先回点血好不好？', '小心，血量很低了。'],
      healed: ['恢复了，太好了。', '嗯，状态回来了。'],
      hurt: ['小心……', '那边有人。', '别站在空地上。'],
      reload: ['换弹的时候我帮你看着。', '记得找掩体换弹。'],
      dash: ['小心落地。', '好灵活。'],
      bomb: ['范围很好。', '躲远一点哦。'],
      paper: ['藏好了。', '嗯，这样更安全。'],
      lead: ['我们领先了，别松懈。', '保持节奏，就这样。'],
      behind: ['没事，稳住就能追回来。', '不急，一个一个来。'],
      matchpoint: ['最后一个了，冷静。', '就差一步……别着急。'],
      win: ['赢了呢……辛苦了。', '我就知道你可以的。', '谢谢你，一路都很可靠。'],
      lose: ['没关系，你已经尽力了。', '输赢都没关系，我们下次再来。', '休息一下吧，我陪着你。'],
      idle: ['……听，海浪的声音。', '累了的话就歇一会儿。', '我在这里，一直都在。', '要注意补给哦。', '风有点凉呢。', '慢慢来，没有人会催你的。', '嗯？在想什么呢？'],
      emote: ['……呵呵。', '你还真是有精神呢。', '嗯，我听到了。'],
    },
    poses: {
      hello: ['bow', 'wave'], start: ['nod', 'guard'], kill: ['nod', 'clap', 'heart'], head: ['clap', 'heart'], double: ['clap'],
      streak: ['heart', 'clap'], rampage: ['heart'], death: ['hug', 'slump'], respawn: ['guard', 'nod'], low: ['hide', 'shake'], healed: ['heart'],
      hurt: ['flinch'], reload: ['guard'], dash: ['look'], bomb: ['nod'], paper: ['nod'], lead: ['nod'], behind: ['guard'], matchpoint: ['guard'],
      win: ['bow', 'heart'], lose: ['hug'], emote: ['tilt'],
    },
    idle: ['guard', 'tilt', 'look', 'hug', 'think', 'bow'],
  },
  selestia: { // 星野
    color: '#ff9ccf',
    lines: {
      hello: ['星野报到～目标已锁定☆', '一起去找星星吧！', '侦察兵星野，开工啦～', '嘿嘿，今天我负责标记！'],
      start: ['目标位置已标记～冲呀！', '雷达全开☆', '开打了开打了！', '星星说我们会赢哦～'],
      kill: ['命中☆', '标记的目标，清除～', '好耶好耶！', '这颗星星归你啦！', '嘿嘿，太准了吧～', '耶～干得漂亮！', '下一个目标在……那边！', '嗖——命中！'],
      head: ['爆头☆满分！', '正中星心～', '哇哇哇，好准！', '一闪一闪，一枪一个～'],
      double: ['双杀～星星连成线啦！', '两颗！再来再来！'],
      streak: ['流星雨来啦☆', '三连～天上的星星都在鼓掌！', '无敌了无敌了！'],
      rampage: ['你是最亮的那颗星☆', '星野要给你做个勋章！'],
      death: ['呜……没关系，星星落下还会再升起～', '别哭别哭，我给你标记一下仇人！', '下次我会提前告诉你敌人在哪的！', '呼呼～痛痛飞走！', '休息一下，星野陪你数星星～'],
      respawn: ['重新起飞☆', '复活！目标已经标记好了！', '这次跟着我的标记走～', '冲鸭！'],
      low: ['呜哇，血好少！快躲！', '危险危险！先藏起来！', '星野的雷达在报警了！', '先回血啦笨蛋！'],
      healed: ['满血复活☆', '又亮起来啦～'],
      hurt: ['哎呀！', '那边那边！有人！', '中弹了！'],
      reload: ['快快换弹～', '我帮你盯着！'],
      dash: ['咻——☆', '好快好快！'],
      bomb: ['烟花～！', '嘭——！'],
      paper: ['变成纸片啦～', '看不见我看不见我～'],
      lead: ['领先啦～继续保持☆', '星星在我们这边！'],
      behind: ['落后啦……没事我会找到他们的！', '别急，下一个目标马上标记！'],
      matchpoint: ['最后一颗星星了！', '赛点赛点！'],
      win: ['赢啦☆星野最喜欢你了！', '胜利～今晚要看流星！', '耶耶耶！我们是最亮的星！'],
      lose: ['呜……下次一定！', '星星今天有点害羞而已～', '没关系，星野还是最喜欢你～'],
      idle: ['今天能看到流星吗？', '……那边好像有什么？我去看看！', '嘿嘿，在发呆吗？', '星野的雷达一切正常☆', '无聊……来比赛数星星吧！', '一、二、三……数到哪了？', '哼哼～哼～'],
      emote: ['哈哈哈好好笑！', '星野也要发一个！', '嘿嘿～收到！'],
    },
    poses: {
      hello: ['peace', 'wave'], start: ['point', 'jump'], kill: ['peace', 'cheer', 'dance'], head: ['spin', 'jump'], double: ['dance', 'jump'],
      streak: ['spin', 'dance'], rampage: ['spin'], death: ['hide', 'slump'], respawn: ['jump', 'peace'], low: ['shake', 'hide'], healed: ['peace'],
      hurt: ['flinch'], reload: ['point'], dash: ['spin'], bomb: ['cheer'], paper: ['dance'], lead: ['peace'], behind: ['stomp'], matchpoint: ['point'],
      win: ['spin', 'dance'], lose: ['stomp', 'hide'], emote: ['dance'],
    },
    idle: ['stargaze', 'dance', 'peace', 'look', 'tilt', 'bounce', 'think'],
  },
  sampleG: { // 露希
    color: '#ffd27a',
    lines: {
      hello: ['光与影，都听我的。', '露希，就位……今天的舞台交给我。', '呵，让我看看你的本事。', '准备好了吗？帷幕要拉开了。'],
      start: ['光影交错，开演。', '这一局的节奏，由我来定。', '别急，先把他们逼进影子里。', '一切尽在掌中。'],
      kill: ['漂亮的一幕。', '落幕了，下一位。', '这就是控场。', '呵，正如所料。', '影子吞掉了他。', '干净利落，我喜欢。', '观众会为你鼓掌的。'],
      head: ['聚光灯下，一击谢幕。', '正中靶心……优雅。', '这一枪，值得返场。', '呵呵，完美的演出。'],
      double: ['二重奏，不错。', '连续落幕，节奏很好。'],
      streak: ['全场都在你掌心里了。', '这场戏，你是主角。', '光与影都站在你这边。'],
      rampage: ['……无人能出其右。', '这片战场，已经是你的舞台。'],
      death: ['只是中场休息而已。', '影子也会退场，然后再登台。', '别在意，下一幕更精彩。', '被抢了戏？那就抢回来。', '呵，失手了呢。没关系，我在。'],
      respawn: ['返场。这次让他们看清楚。', '灯光重新亮起来了。', '第二幕，开始。', '慢一点，先读懂他们的走位。'],
      low: ['光快熄了……先退到暗处。', '别逞强，躲进影子里。', '血量不多了，小心。', '先撤，等时机。'],
      healed: ['重新闪耀了。', '状态回来了，继续。'],
      hurt: ['……有人在暗处。', '小心，那边。', '被看见了。'],
      reload: ['换弹的空档，我替你盯着。', '慢慢来。'],
      dash: ['身法不错。', '像影子一样。'],
      bomb: ['烟火表演。', '退场礼物。'],
      paper: ['藏进影子里。', '嗯，看不见了。'],
      lead: ['节奏在我们手里。', '保持住，别给他们机会。'],
      behind: ['剧本还没写完呢。', '逆转才是好戏。'],
      matchpoint: ['最后一幕了。', '谢幕之前，别松懈。'],
      win: ['完美落幕。', '掌声送给你。', '这一局，演得很好。'],
      lose: ['这一幕……就当是彩排吧。', '下一场，我们重新编排。', '没关系，好戏还在后头。'],
      idle: ['光影在变化……', '……在想下一幕的剧本。', '帽子有点歪了吗？', '今天的光线，真不错。', '安静一点，有人在靠近。', '呵，发什么呆呢？'],
      emote: ['呵呵。', '有意思。', '收到了。'],
    },
    poses: {
      hello: ['bow', 'peace'], start: ['point', 'guard'], kill: ['nod', 'tilt', 'clap'], head: ['spin', 'bow'], double: ['clap'],
      streak: ['spin', 'heart'], rampage: ['spin'], death: ['shrug', 'tilt'], respawn: ['point', 'nod'], low: ['shake', 'hide'], healed: ['tilt'],
      hurt: ['flinch'], reload: ['guard'], dash: ['lean'], bomb: ['throw'], paper: ['tilt'], lead: ['nod'], behind: ['think'], matchpoint: ['point'],
      win: ['bow', 'spin'], lose: ['shrug'], emote: ['tilt'],
    },
    idle: ['think', 'tilt', 'look', 'guard', 'windhair', 'stargaze'],
  },
  shino: { // 白羽
    color: '#cfd8ff',
    lines: {
      hello: ['……白羽，到。', '无声，即是锋芒。', '跟上，别掉队。', '我会替你斩开前路。'],
      start: ['走。', '羽落之前，结束它。', '目标确认，突入。', '安静点，跟着我。'],
      kill: ['……一个。', '利落。', '下一个。', '嗯，干净。', '没给他出声的机会。', '不错的突入。'],
      head: ['一击。', '……很准。', '羽落无声。', '这就是锋芒。'],
      double: ['两个。继续。', '连斩。'],
      streak: ['无人能挡。', '保持这个速度。', '……你很强。'],
      rampage: ['战场已经安静了。', '……全都斩开了。'],
      death: ['……起来。', '一次失手而已。', '记住他的位置。', '别泄气，再来。', '下次，先发制人。'],
      respawn: ['再上。', '这次别停。', '跟紧我。', '把场子找回来。'],
      low: ['退。', '血不够了，找掩体。', '别硬拼。'],
      healed: ['可以了。', '状态恢复。'],
      hurt: ['……！', '侧面。', '有人。'],
      reload: ['换弹，快。', '我掩护。'],
      dash: ['快。', '……好身法。'],
      bomb: ['炸开。', '清场。'],
      paper: ['隐蔽。', '嗯。'],
      lead: ['压住他们。', '别松。'],
      behind: ['……追。', '还没结束。'],
      matchpoint: ['最后一个。', '收尾。'],
      win: ['……赢了。', '辛苦。', '做得好。'],
      lose: ['……下次。', '记住这次。', '我们会变强的。'],
      idle: ['……', '风停了。', '在想什么？', '保持警惕。', '羽毛……落了。', '我在。'],
      emote: ['……嗯。', '呵。', '知道了。'],
    },
    poses: {
      hello: ['salute', 'nod'], start: ['point', 'fist'], kill: ['nod', 'fist'], head: ['salute', 'nod'], double: ['fist'],
      streak: ['fist', 'point'], rampage: ['spin'], death: ['slump', 'hug'], respawn: ['fist', 'pump'], low: ['shake'], healed: ['nod'],
      hurt: ['flinch'], reload: ['guard'], dash: ['lean'], bomb: ['throw'], paper: ['nod'], lead: ['nod'], behind: ['fist'], matchpoint: ['point'],
      win: ['salute', 'nod'], lose: ['slump'], emote: ['nod'],
    },
    idle: ['look', 'windhair', 'guard', 'stretch', 'think'],
  },
};
// 其他角色（还没开放的）：通用台词
const GENERIC = {
  color: '#33e6c8',
  lines: {
    hello: ['一起加油吧！'], start: ['开始了！'], kill: ['漂亮！', '干得好！'], head: ['爆头！'], double: ['双杀！'], streak: ['连杀！'], rampage: ['无人能挡！'],
    death: ['没关系，再来！'], respawn: ['冲呀！'], low: ['小心！血量不多了！'], healed: ['恢复了！'], hurt: ['小心！'], reload: ['换弹！'], dash: ['冲！'], bomb: ['炸！'],
    paper: ['躲！'], lead: ['领先了！'], behind: ['追上去！'], matchpoint: ['最后一个！'], win: ['赢啦！'], lose: ['下一局见～'], idle: ['……'], emote: ['哈哈！'],
  },
  poses: {}, idle: ['look', 'stretch'],
};

// 事件：持续时间、表情、要不要说话（chance：小事件不是每次都说），prio：重要程度（低的不打断高的）
const EVENTS = {
  hello:      { t: 2.2, face: { happy: 0.7 }, prio: 2, pose: 'wave' },
  start:      { t: 2.0, face: { happy: 0.6 }, prio: 2, pose: 'fist' },
  kill:       { t: 1.6, face: { happy: 1 }, prio: 3, pose: 'cheer' },
  head:       { t: 1.9, face: { happy: 1 }, prio: 4, pose: 'jump' },
  double:     { t: 2.0, face: { happy: 1 }, prio: 4, pose: 'jump' },
  streak:     { t: 2.3, face: { happy: 1 }, prio: 5, pose: 'jump' },
  rampage:    { t: 2.6, face: { happy: 1, surprised: 0.3 }, prio: 6, pose: 'spin' },
  death:      { t: 2.6, face: { sad: 1 }, prio: 5, pose: 'slump' },
  respawn:    { t: 1.8, face: { happy: 0.6 }, prio: 3, pose: 'pump' },
  low:        { t: 1.8, face: { surprised: 0.9 }, prio: 4, pose: 'shake', cd: 8 },
  healed:     { t: 1.4, face: { happy: 0.6 }, prio: 1, pose: 'pump', chance: 0.5, cd: 10 },
  hurt:       { t: 0.7, face: { surprised: 0.8 }, prio: 1, pose: 'flinch', chance: 0.25, cd: 4 },
  reload:     { t: 1.0, face: { relaxed: 0.5 }, prio: 0, pose: 'nod', chance: 0.12, cd: 12 },
  dash:       { t: 0.9, face: { happy: 0.7 }, prio: 1, pose: 'lean', chance: 0.35, cd: 6 },
  bomb:       { t: 1.1, face: { happy: 0.8 }, prio: 1, pose: 'throw', chance: 0.5, cd: 6 },
  paper:      { t: 1.0, face: { surprised: 0.4 }, prio: 0, pose: 'tilt', chance: 0.25, cd: 10 },
  lead:       { t: 1.8, face: { happy: 0.8 }, prio: 2, pose: 'fist', cd: 20 },
  behind:     { t: 1.8, face: { sad: 0.4 }, prio: 2, pose: 'pump', cd: 20 },
  matchpoint: { t: 2.0, face: { surprised: 0.5 }, prio: 3, pose: 'point', cd: 30 },
  win:        { t: 4.0, face: { happy: 1 }, prio: 9, pose: 'jump' },
  lose:       { t: 4.0, face: { sad: 0.8 }, prio: 9, pose: 'slump' },
  idle:       { t: 2.6, face: { relaxed: 0.6 }, prio: 0, pose: 'look' },
  emote:      { t: 1.6, face: { happy: 0.9 }, prio: 1, pose: 'cheer', chance: 0.7, cd: 3 },
};
// 有的动作配自己的表情（待机时用）
const POSE_FACE = { stretch: { relaxed: 1 }, think: { relaxed: 0.4 }, stargaze: { happy: 0.5 }, hug: { relaxed: 0.8 }, stomp: { angry: 0.9 }, hide: { sad: 0.6 }, tilt: { happy: 0.4 }, peace: { happy: 1 }, dance: { happy: 0.9 }, windhair: { relaxed: 0.7 }, bow: { relaxed: 0.7 }, guard: { relaxed: 0.5 } };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class DeskPet {
  constructor(loader) {
    this.loader = loader;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    const amb = new THREE.HemisphereLight(0xffffff, 0xc4d2e4, 1.2);
    const key = new THREE.DirectionalLight(0xfff3e8, 2.0); key.position.set(-1.5, 2.5, 3);
    const rim = new THREE.DirectionalLight(0xbff6ff, 1.1); rim.position.set(2, 1.5, -2);
    this.scene.add(amb, key, rim);
    // 脚下的光圈
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(51,230,200,.55)'); gr.addColorStop(.55, 'rgba(51,230,200,.18)'); gr.addColorStop(1, 'rgba(51,230,200,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.005;
    this.scene.add(disc);
    this.vrm = null; this.charId = null; this.prof = GENERIC;
    this.act = null; this.actT = 0; this.t = 0;
    this.blinkT = 2; this.idleT = 9; this.lastSay = -10; this.recent = []; this.cool = {};
    this.prev = { alive: true, low: false, hp: 100, reload: 0, dash: 0, bomb: 0, paper: 0, phase: '', lead: 0, mp: false };
    this.streak = 0; // 这条命的击杀数
    this.lastLine = {};
    this._ui();
  }

  _ui() {
    const el = document.createElement('div');
    el.id = 'pet-bubble';
    (document.getElementById('hud') || document.body).appendChild(el);
    this.bubble = el;
  }

  // 换成当前角色（另外加载一份模型，不影响游戏里的角色）
  async setCharacter(ch) {
    if (!ch || ch.id === this.charId) return;
    this.charId = ch.id;
    this.prof = PROFILES[ch.id] || GENERIC;
    this.bubble.style.setProperty('--pc', this.prof.color);
    const id = ch.id;
    let gltf;
    try { gltf = await this.loader.loadAsync(ch.file); } catch (e) { console.warn('桌宠加载失败', e); return; }
    if (this.charId !== id) return;
    const vrm = gltf.userData.vrm;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons?.(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => { o.frustumCulled = false; });
    if (this.vrm) { this.root.remove(this.vrm.scene); VRMUtils.deepDispose?.(this.vrm.scene); }
    this.vrm = vrm;
    this._armSign(vrm);
    this._chibi(vrm);
    this.root.add(vrm.scene);
    this.say('hello', true);
  }

  // 测一下这个模型的手臂旋转方向：左上臂绕 z 转 -1，看手是往下还是往上；绕 y 转 -1，看手是往前还是往后
  _armSign(vrm) {
    const H = vrm.humanoid, b = H.getNormalizedBoneNode('leftUpperArm'), sh = H.getRawBoneNode('leftUpperArm'), hand = H.getRawBoneNode('leftHand') || H.getRawBoneNode('leftLowerArm');
    this.sz = 1; this.sy = 1;
    if (!b || !sh || !hand) return;
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    const probe = (x, y, z) => { b.rotation.set(x, y, z); vrm.update(0); vrm.scene.updateMatrixWorld(true); sh.getWorldPosition(p0); hand.getWorldPosition(p1); return p1.sub(p0); };
    if (probe(0, 0, -1).y > 0) this.sz = -1;
    if (probe(0, -1, 0).z < 0) this.sy = -1; // 模型面朝 +Z
    b.rotation.set(0, 0, 0); vrm.update(0);
  }

  // Q 版比例：头放大，躯干和腿缩短（直接缩放原始骨骼；动作用规范化骨骼转，互不影响）
  _chibi(vrm) {
    const H = vrm.humanoid, raw = (n) => H.getRawBoneNode(n);
    const S = { head: 1.4, upperChest: 0.95, leftUpperLeg: 0.86, rightUpperLeg: 0.86, leftUpperArm: 0.9, rightUpperArm: 0.9 };
    // 缩放会传给子骨骼：头的倍数要除掉上面躯干已经缩掉的部分
    raw('head') && raw('head').scale.setScalar(S.head / (raw('upperChest') ? S.upperChest : 1));
    if (raw('upperChest')) raw('upperChest').scale.setScalar(S.upperChest);
    for (const n of ['leftUpperLeg', 'rightUpperLeg']) raw(n)?.scale.setScalar(S[n]);
    for (const n of ['leftUpperArm', 'rightUpperArm']) raw(n)?.scale.setScalar(S[n] / (raw('upperChest') ? S.upperChest : 1));
    // 腿短了，整体往下放，脚贴地
    vrm.scene.updateMatrixWorld(true);
    const foot = raw('leftFoot') || raw('leftLowerLeg');
    const fy = foot ? foot.getWorldPosition(new THREE.Vector3()).y : 0;
    vrm.scene.position.y = -fy + 0.06;
    vrm.springBoneManager?.setInitState?.();
    vrm.scene.updateMatrixWorld(true);
    const hd = raw('head').getWorldPosition(new THREE.Vector3());
    this.headY = hd.y;
    // 镜头：整个人放进画面，头在上三分之一
    const top = hd.y + 0.42, mid = top * 0.5;
    this.camera.position.set(0, mid + 0.12, 3.1);
    this.camera.lookAt(0, mid, 0);
    this.camera.fov = 2 * Math.atan((top * 0.56) / 3.1) * 180 / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  // 外部事件：kill / head / win / lose / emote
  react(kind) {
    if (kind === 'kill' || kind === 'head') {
      const now = this.t;
      this.recent = this.recent.filter((x) => now - x < 8);
      this.recent.push(now);
      this.streak++;
      const quick = this.recent.filter((x) => now - x < 3.5).length;
      if (this.streak >= 5 && this.streak % 5 === 0) kind = 'rampage';
      else if (this.recent.length >= 3) kind = 'streak';
      else if (quick >= 2) kind = 'double';
    }
    this.say(kind);
  }

  say(kind, force = false) {
    const ev = EVENTS[kind] || EVENTS.kill;
    if ((this.cool[kind] || 0) > this.t) return;
    // 正在演一个更重要的动作：不打断
    if (!force && this.act && this.actPrio > (ev.prio ?? 1) && this.actT < this.act.t * 0.7) return;
    // 小事件只是偶尔说
    if (!force && ev.chance != null && Math.random() > ev.chance) return;
    if (!force && kind === 'idle' && this.t - this.lastSay < 6) return;
    this.cool[kind] = this.t + (ev.cd ?? 0.4);
    const P = this.prof;
    const list = P.lines[kind] || GENERIC.lines[kind] || GENERIC.lines.kill;
    // 不连着说同一句
    let text = pick(list);
    if (list.length > 1) for (let i = 0; i < 4 && text === this.lastLine[kind]; i++) text = pick(list);
    this.lastLine[kind] = text;
    const poses = kind === 'idle' ? P.idle : P.poses[kind];
    const pose = poses?.length ? pick(poses) : ev.pose;
    this.act = { t: ev.t * (kind === 'idle' ? 1.3 : 1), face: { ...(POSE_FACE[pose] && kind === 'idle' ? POSE_FACE[pose] : ev.face) }, pose };
    this.actT = 0; this.actKind = kind; this.actPrio = ev.prio ?? 1;
    this.lastSay = this.t; this.idleT = 9 + Math.random() * 9;
    const b = this.bubble;
    b.textContent = text;
    // 先收起再弹出（换句话时也有弹一下的感觉）
    b.className = kind === 'death' || kind === 'lose' ? 'sad' : kind === 'low' || kind === 'hurt' ? 'warn' : '';
    void b.offsetWidth;
    b.classList.add('on');
    clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.remove('on'), Math.max(kind === 'hurt' ? 1200 : 2200, text.length * 170));
  }

  // 每帧：看玩家和比赛的状态（倒下 / 复活 / 血量 / 换弹 / 技能 / 比分），驱动动作
  update(dt, player, match) {
    this.t += dt;
    const pv = this.prev;
    if (player) {
      if (pv.alive && !player.alive) { this.streak = 0; this.say('death', true); }
      if (!pv.alive && player.alive) this.say('respawn', true);
      const max = player.maxHp || 100, hp = player.hp;
      const low = player.alive && hp < max * 0.3;
      if (low && !pv.low) this.say('low', true);
      else if (player.alive && hp < pv.hp - 4 && !low) this.say('hurt');
      if (player.alive && hp >= max && pv.hp < max * 0.5 && pv.alive) this.say('healed');
      if ((player.reloadT || 0) > 0 && !(pv.reload > 0)) this.say('reload');
      if ((player.dashCd || 0) > pv.dash + 0.5) this.say('dash');
      if ((player.bombCd || 0) > pv.bomb + 0.5) this.say('bomb');
      if ((player.paperAmt || 0) > 0.5 && pv.paper <= 0.5) this.say('paper');
      pv.alive = player.alive; pv.low = low; pv.hp = hp; pv.reload = player.reloadT || 0;
      pv.dash = player.dashCd || 0; pv.bomb = player.bombCd || 0; pv.paper = player.paperAmt || 0;
    }
    if (match) {
      if (match.phase === 'live' && pv.phase && pv.phase !== 'live') this.say('start', true);
      pv.phase = match.phase;
      if (match.live && match.score) {
        const d = match.score.ally - match.score.enemy;
        const lead = d >= 2 ? 1 : d <= -2 ? -1 : 0;
        if (lead !== pv.lead) { if (lead > 0) this.say('lead'); else if (lead < 0) this.say('behind'); pv.lead = lead; }
        if (match.target && match.score.ally === match.target - 1 && !pv.mp) { pv.mp = true; this.say('matchpoint'); }
      }
    }
    if ((this.idleT -= dt) <= 0) { this.say('idle'); this.idleT = 12 + Math.random() * 10; }
    const vrm = this.vrm;
    if (!vrm) return;
    const H = vrm.humanoid, nb = (n) => H.getNormalizedBoneNode(n);
    const set = (n, x, y, z) => { const b = nb(n); if (b) b.quaternion.setFromEuler(_e.set(x, y, z)); };
    const t = this.t;
    const L = THREE.MathUtils.lerp;
    // 默认：手臂放下、呼吸、轻微左右晃
    const br = Math.sin(t * 2.2);
    let hipY = 0, hipZ = 0, twist = 0, spin = 0, spineX = 0.02 * br, headX = 0, headY = 0.15 * Math.sin(t * 0.6), headZ = 0.04 * Math.sin(t * 0.9);
    let lArm = [0, 0, -1.2 + 0.03 * br], rArm = [0, 0, 1.2 - 0.03 * br], lFore = [0, 0, -0.15], rFore = [0, 0, 0.15];
    const face = { happy: 0, sad: 0, surprised: 0, relaxed: 0.25, angry: 0 };
    if (this.act) {
      this.actT += dt;
      const k = this.actT / this.act.t, a = this.actT;
      const ease = Math.min(1, a * 6) * Math.min(1, (this.act.t - a) * 4); // 进出过渡
      for (const [n, v] of Object.entries(this.act.face)) face[n] = Math.max(face[n], v * ease);
      face.relaxed *= 1 - ease * (this.act.face.relaxed ? 0 : 1);
      const S = Math.sin;
      switch (this.act.pose) {
        case 'cheer': // 右手举起挥两下
          rArm = [0, 0.85 * ease, L(1.2, -0.95 + 0.22 * S(a * 14), ease)];
          rFore = [0, 0.4 * ease, L(0.15, -0.9, ease)];
          hipY = 0.03 * Math.abs(S(a * 9)) * ease; headZ += 0.12 * ease;
          break;
        case 'jump': // 双手举高蹦跳
          lArm = [0, -0.5 * ease, L(-1.2, 1.0 + 0.2 * S(a * 12), ease)];
          rArm = [0, 0.5 * ease, L(1.2, -1.0 - 0.2 * S(a * 12), ease)];
          hipY = 0.12 * Math.abs(S(a * 7)) * ease; headX = -0.15 * ease;
          break;
        case 'spin': // 原地转一圈，双手张开
          spin = Math.PI * 2 * Math.min(1, a / (this.act.t * 0.7)) ** 0.8;
          lArm = [0, 0, L(-1.2, 0.1, ease)]; rArm = [0, 0, L(1.2, -0.1, ease)];
          hipY = 0.1 * S(Math.min(1, a / (this.act.t * 0.7)) * Math.PI) * ease; headX = -0.1 * ease;
          break;
        case 'slump': // 垂头丧气
          spineX = 0.25 * ease; headX = 0.35 * ease; headY *= 1 - ease;
          lArm = [0.2 * ease, 0, -1.35]; rArm = [0.2 * ease, 0, 1.35];
          hipY = -0.03 * ease;
          break;
        case 'pump': // 握拳打气：手臂收到胸前上下
          lArm = [0, -0.7 * ease, -1.2 + 0.25 * ease]; rArm = [0, 0.7 * ease, 1.2 - 0.25 * ease];
          lFore = [0, -2.0 * ease, 0.3 * ease]; rFore = [0, 2.0 * ease, -0.3 * ease];
          hipY = 0.04 * Math.abs(S(a * 10)) * ease; headX = 0.1 * S(a * 10) * ease;
          break;
        case 'fist': // 右拳向上冲两下
          rArm = [0, 0.3 * ease, L(1.2, -1.15 + 0.25 * Math.abs(S(a * 9)), ease)];
          rFore = [0, 0.5 * ease, L(0.15, -0.5, ease)];
          lArm = [0, -0.4 * ease, -1.15]; lFore = [0, -1.0 * ease, 0];
          hipY = 0.05 * Math.abs(S(a * 9)) * ease; headX = -0.08 * ease;
          break;
        case 'point': // 右手指向前方
          rArm = [0, 1.35 * ease, L(1.2, -0.05, ease)]; rFore = [0, 0.15 * ease, 0];
          lArm = [0, 0, -1.25]; twist = 0.25 * ease; headX = -0.05 * ease; headY = 0.2 * ease;
          break;
        case 'salute': // 敬礼
          rArm = [0, 0.7 * ease, L(1.2, -0.45, ease)]; rFore = [0, 2.3 * ease, L(0.15, -0.5, ease)];
          headX = -0.06 * ease; spineX = -0.05 * ease;
          break;
        case 'peace': // 比耶歪头
          rArm = [0, 0.45 * ease, L(1.2, -0.55, ease)]; rFore = [0, 0.5 * ease, L(0.15, -1.1, ease)];
          lArm = [0, -0.3 * ease, -1.1]; headZ += -0.28 * ease; hipZ = 0.06 * ease;
          break;
        case 'heart': // 双手放在胸口，轻轻摇
          lArm = [0, -1.0 * ease, L(-1.2, -0.75, ease)]; rArm = [0, 1.0 * ease, L(1.2, 0.75, ease)];
          lFore = [0, -1.7 * ease, 0]; rFore = [0, 1.7 * ease, 0];
          headZ += 0.2 * S(a * 3) * ease; hipZ = 0.05 * S(a * 3) * ease;
          break;
        case 'clap': // 拍手
          lArm = [0, -1.15 * ease, L(-1.2, -0.75, ease)]; rArm = [0, 1.15 * ease, L(1.2, 0.75, ease)];
          lFore = [0, (-1.0 - 0.45 * Math.abs(S(a * 13))) * ease, 0]; rFore = [0, (1.0 + 0.45 * Math.abs(S(a * 13))) * ease, 0];
          hipY = 0.02 * Math.abs(S(a * 13)) * ease;
          break;
        case 'nod': // 点头
          headX = 0.22 * Math.max(0, S(a * 9)) * ease;
          break;
        case 'bow': // 鞠躬
          spineX = 0.42 * S(Math.min(1, a / this.act.t) * Math.PI); headX = 0.2 * ease;
          lArm = [0, -0.3 * ease, -1.25]; rArm = [0, 0.3 * ease, 1.25];
          break;
        case 'guard': // 双手交握在身前，安静站着
          lArm = [0, -0.85 * ease, L(-1.2, -1.15, ease)]; rArm = [0, 0.85 * ease, L(1.2, 1.15, ease)];
          lFore = [0, -1.25 * ease, 0]; rFore = [0, 1.25 * ease, 0]; headZ += 0.1 * ease;
          break;
        case 'hug': // 抱着自己（安慰 / 担心）
          lArm = [0, -1.05 * ease, L(-1.2, -0.8, ease)]; rArm = [0, 1.05 * ease, L(1.2, 0.8, ease)];
          lFore = [0, -2.2 * ease, 0]; rFore = [0, 2.2 * ease, 0];
          headX = 0.15 * ease; hipZ = 0.04 * S(a * 2.5) * ease; headZ += 0.12 * S(a * 2.5) * ease;
          break;
        case 'hide': // 双手捂脸
          lArm = [0, -1.0 * ease, L(-1.2, -0.25, ease)]; rArm = [0, 1.0 * ease, L(1.2, 0.25, ease)];
          lFore = [0, -2.35 * ease, 0]; rFore = [0, 2.35 * ease, 0];
          headX = 0.18 * ease; headY = 0.12 * S(a * 8) * ease;
          break;
        case 'shrug': // 摊手
          lArm = [0, -0.5 * ease, L(-1.2, -0.95, ease)]; rArm = [0, 0.5 * ease, L(1.2, 0.95, ease)];
          lFore = [0, -1.2 * ease, 0.3 * ease]; rFore = [0, 1.2 * ease, -0.3 * ease];
          headZ += 0.22 * ease; spineX = 0.05 * ease;
          break;
        case 'stomp': // 生气跺脚
          hipY = 0.05 * Math.abs(S(a * 16)) * ease; lArm = [0, 0.2 * ease, -0.85]; rArm = [0, -0.2 * ease, 0.85];
          lFore = [0, 0, -0.5 * ease]; rFore = [0, 0, 0.5 * ease]; headX = 0.12 * ease; headY = 0.2 * S(a * 8) * ease;
          break;
        case 'dance': // 扭一扭
          hipZ = 0.12 * S(a * 7) * ease; hipY = 0.04 * Math.abs(S(a * 7)) * ease; twist = 0.15 * S(a * 3.5) * ease;
          lArm = [0, -0.4 * ease, L(-1.2, -0.2 + 0.6 * S(a * 7), ease)]; rArm = [0, 0.4 * ease, L(1.2, 0.2 + 0.6 * S(a * 7), ease)];
          lFore = [0, -0.8 * ease, 0]; rFore = [0, 0.8 * ease, 0]; headZ += -0.15 * S(a * 7) * ease;
          break;
        case 'bounce': // 原地小跳
          hipY = 0.06 * Math.abs(S(a * 6)) * ease; lArm = [0, 0.2 * S(a * 6) * ease, -1.15]; rArm = [0, -0.2 * S(a * 6) * ease, 1.15];
          break;
        case 'stretch': // 伸懒腰
          lArm = [0, -0.2 * ease, L(-1.2, 1.35, ease)]; rArm = [0, 0.2 * ease, L(1.2, -1.35, ease)];
          lFore = [0, 0, L(-0.15, 0.4, ease)]; rFore = [0, 0, L(0.15, -0.4, ease)];
          spineX = -0.15 * ease; headX = -0.25 * ease; hipY = 0.02 * ease;
          break;
        case 'think': // 托着下巴想事情
          rArm = [0, 0.95 * ease, L(1.2, 0.7, ease)]; rFore = [0, 2.2 * ease, 0];
          lArm = [0, -0.8 * ease, L(-1.2, -0.95, ease)]; lFore = [0, -1.4 * ease, 0];
          headZ += 0.18 * ease; headY = 0.25 * ease; headX = -0.05 * ease;
          break;
        case 'tilt': // 歪头
          headZ += 0.3 * ease * (this.tiltDir ||= Math.random() < 0.5 ? 1 : -1); hipZ = -0.04 * ease * this.tiltDir;
          lArm = [0, 0.2 * ease, -1.1]; rArm = [0, -0.2 * ease, 1.1]; // 手背到身后一点
          break;
        case 'stargaze': // 抬头看星星，手背在身后
          headX = -0.45 * ease; headY = 0.2 * S(a * 1.2) * ease; spineX = -0.08 * ease;
          lArm = [0, 0.55 * ease, -1.15]; rArm = [0, -0.55 * ease, 1.15]; hipZ = 0.03 * S(a * 2) * ease;
          break;
        case 'windhair': // 撩一下头发
          rArm = [0, 0.6 * ease, L(1.2, -0.75, ease)]; rFore = [0, 1.9 * ease, L(0.15, -0.6, ease)];
          headZ += -0.18 * ease; headY = -0.2 * ease;
          break;
        case 'flinch': // 被打到缩一下
          spineX = 0.12 * ease; headX = 0.15 * ease; hipY = -0.03 * ease;
          lArm = [0, -0.6 * ease, -1.0]; rArm = [0, 0.6 * ease, 1.0]; lFore = [0, -1.0 * ease, 0]; rFore = [0, 1.0 * ease, 0];
          break;
        case 'lean': // 冲刺：往前倾
          spineX = 0.18 * ease; lArm = [0, 0.6 * ease, -1.0]; rArm = [0, 0.6 * ease, 1.0]; hipY = 0.04 * ease; headX = -0.1 * ease;
          break;
        case 'throw': // 扔东西
          rArm = [0, L(0, -0.6, Math.min(1, a * 3)) * ease + (a > 0.35 ? 1.4 * ease : 0), L(1.2, -0.6, ease)]; rFore = [0, 0.4 * ease, -0.6 * ease];
          twist = (a > 0.35 ? 0.3 : -0.25) * ease;
          break;
        case 'shake': // 着急地左右看
          headY = 0.45 * S(a * 11) * ease; lArm = [0, 0, -0.9]; rArm = [0, 0, 0.9];
          break;
        case 'wave': // 挥手打招呼
          rArm = [0, 0, L(1.2, -1.1, ease)];
          rFore = [0, 0, L(0.15, -0.6 + 0.45 * S(a * 10), ease)];
          headZ += 0.15 * ease;
          break;
        case 'look': // 东张西望
          headY = 0.5 * S(a * 2.4) * ease;
          break;
      }
      if (k >= 1) { this.act = null; this.tiltDir = 0; }
    }
    this.root.rotation.y = -0.38 + spin + twist * 0.3;
    // 眨眼
    this.blinkT -= dt;
    let blink = 0;
    if (this.blinkT < 0.12) blink = Math.sin(Math.max(0, this.blinkT) / 0.12 * Math.PI);
    if (this.blinkT <= 0) this.blinkT = 2.5 + Math.random() * 3;
    if (face.happy > 0.5 || face.sad > 0.5) blink = 0;
    const em = vrm.expressionManager;
    if (em) {
      for (const [n, v] of Object.entries(face)) em.setValue(n, v);
      em.setValue('blink', blink);
    }
    set('hips', 0, twist * 0.5, hipZ); nb('hips') && (nb('hips').position.y = (this._hip0 ??= nb('hips').position.y) + hipY);
    set('spine', spineX, 0, 0);
    set('neck', headX * 0.4, headY * 0.4, headZ * 0.4);
    set('head', headX * 0.6, headY * 0.6, headZ * 0.6);
    // 上面的数值按“z 负 = 左臂放下、y 负 = 左臂往前”写；不同模型（VRM0 / VRM1）规范化骨骼的方向可能相反，加载时测过（_armSign）
    const sz = this.sz, sy = this.sy;
    set('leftUpperArm', lArm[0], lArm[1] * sy, lArm[2] * sz); set('rightUpperArm', rArm[0], rArm[1] * sy, rArm[2] * sz);
    set('leftLowerArm', lFore[0], lFore[1] * sy, lFore[2] * sz); set('rightLowerArm', rFore[0], rFore[1] * sy, rFore[2] * sz);
    vrm.update(Math.min(dt, 0.05));
  }

  // 画在屏幕右下角（弹药框左边）一块
  render(renderer) {
    if (!this.vrm) return;
    const u = Math.min(innerWidth / 1672, innerHeight / 941);
    const w = Math.round(230 * u), h = Math.round(240 * u);
    const x = Math.round(innerWidth - 300 * u - w), y = Math.round(24 * u);
    if (this.camera.aspect !== w / h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h); renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
    renderer.autoClear = ac;
    // 对话气泡放在桌宠头顶左边
    this.bubble.style.right = (300 * u + w * 0.42) + 'px';
    this.bubble.style.bottom = (24 * u + h * 0.86) + 'px';
  }

  hide() { this.bubble.classList.remove('on'); }
}
