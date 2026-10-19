import * as THREE from 'three';
import { VRMUtils } from '@pixiv/three-vrm';

// 桌宠：右下角一个 Q 版的“当前角色”（用同一个 VRM 模型，头放大、身体缩短，像手办），
// 会眨眼、呼吸、东张西望；击杀时欢呼、爆头更兴奋、连杀跳起来，被击倒会难过然后鼓励你，
// 复活打气、血少了提醒。说的话按角色性格不同。画在主画面的右下角一小块（和第一人称手臂一样直接叠在画面上）。

// —— 台词：按性格分组 ——
const LINES = {
  cheerful: {
    kill: ['漂亮！', '好耶～再来一个！', '太帅了吧！', '干得好！', '就是这样！'],
    head: ['爆头！准得不行！', '一枪带走，好厉害！', '正中眉心～'],
    streak: ['连杀！停不下来啦！', '今天手感火热～', '谁都挡不住你！'],
    death: ['没关系，下次一定行！', '别灰心，我陪着你～', '深呼吸，重新来过！'],
    respawn: ['满血复活！冲呀！', '这次一定赢回来！'],
    low: ['小心！血量不多了！', '快找掩体躲一下！'],
    win: ['赢啦！你最棒了！'], lose: ['输了也没关系，下一局见～'],
    idle: ['……在想什么呢？', '要不要去高处看看？', '我会一直看着你的～'],
    hello: ['一起加油吧！', '准备好了吗？出发！'],
  },
  cool: {
    kill: ['……不错。', '干净利落。', '合格。', '下一个。'],
    head: ['精准。', '一击毙命。', '这枪，满分。'],
    streak: ['势不可挡。', '保持这个节奏。'],
    death: ['失误而已，重整旗鼓。', '调整呼吸，再来。', '别急，看清再开枪。'],
    respawn: ['出发。', '这次别大意。'],
    low: ['后撤，别硬拼。', '状态不好，先躲。'],
    win: ['意料之中。'], lose: ['记住这次的教训。'],
    idle: ['……注意四周。', '风向变了。'],
    hello: ['我在这边看着。'],
  },
  gentle: {
    kill: ['好厉害呀～', '做得很好哦！', '真棒～'],
    head: ['哇，正中目标！', '好准……好帅气！'],
    streak: ['好强……我都看呆了', '连胜好开心～'],
    death: ['没事的，休息一下就好～', '你已经很努力了！', '痛痛飞走～再来一次吧'],
    respawn: ['一起加油吧～', '慢慢来，不着急'],
    low: ['受伤了……要小心哦', '先回点血吧？'],
    win: ['辛苦啦～赢了呢！'], lose: ['下一局一定可以的～'],
    idle: ['今天也要开开心心的～', '累了就歇一会儿吧'],
    hello: ['请多关照～'],
  },
  tsundere: {
    kill: ['哼，还算可以吧。', '才、才不是在夸你！', '这种程度理所当然。'],
    head: ['……这枪倒是挺准的。', '哼，运气好而已！'],
    streak: ['哼哼，有我看着当然厉害！', '别得意忘形哦！'],
    death: ['笨蛋！怎么又倒下了！', '真是的……下次给我赢回来！', '我、我才没担心你呢'],
    respawn: ['快去报仇啦！', '还愣着干嘛，上啊！'],
    low: ['喂！血要没了！', '你是想吓死我吗！'],
    win: ['哼，赢是理所当然的！'], lose: ['……我才没有难过呢。'],
    idle: ['看什么看，快去打啊！', '无聊死了……'],
    hello: ['哼，我就勉强陪你一局吧。'],
  },
};
const PERSONA = {
  selestia: 'cheerful', rin: 'cheerful', sampleE: 'cheerful', sampleG: 'cheerful',
  kikyo: 'cool', shino: 'cool', darkness: 'cool',
  mint: 'gentle', fumiriya: 'gentle', sampleF: 'gentle',
  sampleD: 'tsundere',
};

// 动作：表情 + 身体动作，持续时间
const ACTS = {
  kill:    { t: 1.6, face: { happy: 1 }, pose: 'cheer' },
  head:    { t: 1.9, face: { happy: 1 }, pose: 'jump' },
  streak:  { t: 2.2, face: { happy: 1 }, pose: 'jump' },
  death:   { t: 2.6, face: { sad: 1 }, pose: 'slump' },
  respawn: { t: 1.6, face: { happy: 0.6 }, pose: 'pump' },
  low:     { t: 1.6, face: { surprised: 0.9 }, pose: 'shake' },
  win:     { t: 4.0, face: { happy: 1 }, pose: 'jump' },
  lose:    { t: 4.0, face: { sad: 0.8 }, pose: 'slump' },
  hello:   { t: 2.0, face: { happy: 0.7 }, pose: 'wave' },
  idle:    { t: 2.2, face: { relaxed: 0.6 }, pose: 'look' },
};
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
    this.vrm = null; this.charId = null; this.persona = 'cheerful';
    this.act = null; this.actT = 0; this.t = 0;
    this.blinkT = 2; this.idleT = 9; this.lastSay = -10; this.recent = []; this.cool = {};
    this.prev = { alive: true, low: false };
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
    this.persona = PERSONA[ch.id] || 'cheerful';
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
    this.root.rotation.y = -0.38; // 稍微侧身，朝向画面中间
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

  // 事件：kill / head / death / respawn / low / win / lose
  react(kind) {
    if (kind === 'kill' || kind === 'head') {
      const now = this.t;
      this.recent = this.recent.filter((x) => now - x < 8);
      this.recent.push(now);
      if (this.recent.length >= 3) kind = 'streak';
    }
    this.say(kind, kind !== 'idle' && kind !== 'low');
  }

  say(kind, force = false) {
    if (!force && this.t - this.lastSay < 3) return;
    if ((this.cool[kind] || 0) > this.t) return;
    this.cool[kind] = this.t + (kind === 'low' ? 8 : 0.4);
    const L = LINES[this.persona] || LINES.cheerful;
    const text = pick(L[kind] || L.kill);
    this.act = ACTS[kind] || ACTS.kill; this.actT = 0; this.actKind = kind;
    this.lastSay = this.t; this.idleT = 10 + Math.random() * 8;
    const b = this.bubble;
    b.textContent = text;
    // 先收起再弹出（换句话时也有弹一下的感觉）
    b.className = kind === 'death' || kind === 'lose' ? 'sad' : kind === 'low' ? 'warn' : '';
    void b.offsetWidth;
    b.classList.add('on');
    clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.remove('on'), Math.max(2200, text.length * 180));
  }

  // 每帧：看玩家状态（倒下 / 复活 / 血少），驱动动作
  update(dt, player) {
    this.t += dt;
    if (player) {
      if (this.prev.alive && !player.alive) this.react('death');
      if (!this.prev.alive && player.alive) this.react('respawn');
      const low = player.alive && player.hp < (player.maxHp || 100) * 0.3;
      if (low && !this.prev.low) this.react('low');
      this.prev.alive = player.alive; this.prev.low = low;
    }
    if ((this.idleT -= dt) <= 0) { this.say('idle'); this.idleT = 14 + Math.random() * 10; }
    const vrm = this.vrm;
    if (!vrm) return;
    const H = vrm.humanoid, nb = (n) => H.getNormalizedBoneNode(n);
    const set = (n, x, y, z) => { const b = nb(n); if (b) b.quaternion.setFromEuler(_e.set(x, y, z)); };
    const t = this.t;
    // 默认：手臂放下、呼吸、轻微左右晃
    const br = Math.sin(t * 2.2);
    let hipY = 0, spineX = 0.02 * br, headX = 0, headY = 0.15 * Math.sin(t * 0.6), headZ = 0.04 * Math.sin(t * 0.9);
    let lArm = [0, 0, -1.2 + 0.03 * br], rArm = [0, 0, 1.2 - 0.03 * br], lFore = [0, 0, -0.15], rFore = [0, 0, 0.15];
    const face = { happy: 0, sad: 0, surprised: 0, relaxed: 0.25, angry: 0 };
    if (this.act) {
      this.actT += dt;
      const k = this.actT / this.act.t, a = this.actT;
      const ease = Math.min(1, a * 6) * Math.min(1, (this.act.t - a) * 4); // 进出过渡
      for (const [n, v] of Object.entries(this.act.face)) face[n] = Math.max(face[n], v * ease);
      face.relaxed *= 1 - ease;
      switch (this.act.pose) {
        case 'cheer': // 右手举起挥两下
          rArm = [0, 0.85 * ease, THREE.MathUtils.lerp(1.2, -0.95 + 0.22 * Math.sin(a * 14), ease)];
          rFore = [0, 0.4 * ease, THREE.MathUtils.lerp(0.15, -0.9, ease)];
          hipY = 0.03 * Math.abs(Math.sin(a * 9)) * ease; headZ += 0.12 * ease;
          break;
        case 'jump': // 双手举高蹦跳
          lArm = [0, -0.5 * ease, THREE.MathUtils.lerp(-1.2, 1.0 + 0.2 * Math.sin(a * 12), ease)];
          rArm = [0, 0.5 * ease, THREE.MathUtils.lerp(1.2, -1.0 - 0.2 * Math.sin(a * 12), ease)];
          hipY = 0.12 * Math.abs(Math.sin(a * 7)) * ease; headX = -0.15 * ease;
          break;
        case 'slump': // 垂头丧气
          spineX = 0.25 * ease; headX = 0.35 * ease; headY *= 1 - ease;
          lArm = [0.2 * ease, 0, -1.35]; rArm = [0.2 * ease, 0, 1.35];
          hipY = -0.03 * ease;
          break;
        case 'pump': // 握拳打气：手臂收到胸前上下
          lArm = [0, -0.7 * ease, -1.2 + 0.25 * ease]; rArm = [0, 0.7 * ease, 1.2 - 0.25 * ease];
          lFore = [0, -2.0 * ease, 0.3 * ease]; rFore = [0, 2.0 * ease, -0.3 * ease];
          hipY = 0.04 * Math.abs(Math.sin(a * 10)) * ease; headX = 0.1 * Math.sin(a * 10) * ease;
          break;
        case 'shake': // 着急地左右看
          headY = 0.45 * Math.sin(a * 11) * ease; lArm = [0, 0, -0.9]; rArm = [0, 0, 0.9];
          break;
        case 'wave': // 挥手打招呼
          rArm = [0, 0, THREE.MathUtils.lerp(1.2, -1.1, ease)];
          rFore = [0, 0, THREE.MathUtils.lerp(0.15, -0.6 + 0.45 * Math.sin(a * 10), ease)];
          headZ += 0.15 * ease;
          break;
        case 'look': // 东张西望
          headY = 0.5 * Math.sin(a * 2.4) * ease;
          break;
      }
      if (k >= 1) this.act = null;
    }
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
    set('hips', 0, 0, 0); nb('hips') && (nb('hips').position.y = (this._hip0 ??= nb('hips').position.y) + hipY);
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
