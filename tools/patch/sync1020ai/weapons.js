import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { clearAttachments } from './attachments.js';

// 8 把枪的数值。模型来自 Infima Games 枪械包（tools/gunlab.html 从 FBX 组装导出）
// hold = 持枪方式（rifle 枪托抵肩 / pistol 双手前伸 / launcher 扛在肩上）；stock = 握把到枪托末端的距离（米）
// support = 左手手腕要放到的位置，在枪的本地坐标里（米，+X 枪的左侧，+Y 上，+Z 前）
// sound = 音效：dir 是 Asset/Audio/Weapon/ 下的文件夹，vol 开火音量，after = [开火后几秒, 文件名]（栓动/泵动），
//         reload = [[换弹进度 0–1, 文件名], ...]，和 Asset/Animation/Reload 里的换弹动画对齐
// code = 型号，callsign = 武器页面上的代号；ads = 右键瞄准：rangefinder = 第一人称瞄准时显示测距仪界面且不放大，reticle = 第一人称瞄准时叠加一个准心圈，sightDy = 第一人称瞄准时照门高度微调（米），zoom 镜头放大倍数，hip 腰射时散布是瞄准时的几倍，scope = 开镜（第一人称瞄准镜），speed = 开镜快慢
// rate = 每秒发数；auto = 按住连发，否则每次点击一发；pellets = 一次射出几颗弹丸；rocket = 发射火箭弹
// 握持手型（枪的空间，单位厘米，+X 枪的左侧，+Y 上，+Z 枪口方向）
// c = 掌心贴住的位置，d = 手腕到指根的方向，n = 掌心朝向。左手没写 c 就用模型里的 IK 点
// 数值按实测握把几何定的：掌心贴握把右后侧、虎口顶到握把上沿，四指从前面包过去
const GRIP_PISTOL = { r: { c: [-1.9, -3.4, -3.2], d: [0.1, -0.22, 0.97], n: [1, 0, 0] }, l: { c: [2.0, -5.0, -1.8], d: [-0.15, -0.32, 0.93], n: [-1, 0.15, 0] } };
const GRIP_REVOLVER = { r: { c: [-2.0, -3.6, -3.4], d: [0.1, -0.25, 0.96], n: [1, 0, 0] }, l: { c: [2.1, -5.3, -1.8], d: [-0.15, -0.35, 0.92], n: [-1, 0.15, 0] } };
const GRIP_RIFLE = { r: { c: [-1.8, -4.4, -2.6], d: [0.1, -0.38, 0.92], n: [1, 0, 0] }, l: { d: [-0.35, 0.05, 0.94], n: [-0.55, 0.84, 0] } };
const GRIP_LAUNCHER = { r: { c: [-1.5, -7.6, -0.8], d: [0.1, -0.3, 0.95], n: [1, 0, 0] }, l: { c: [3.4, -8.5, 19.7], d: [-0.3, -0.25, 0.92], n: [-1, 0, 0] } };

export const WEAPONS = [
  { id: 'ar', code: 'AR-07', callsign: '折光', ads: { zoom: 1.35, hip: 1.7 },  name: '突击步枪', file: 'Asset/Weapon/Guns/AssaultRifle.glb', auto: true, damage: 24, headMul: 2, rate: 10, mag: 30, reload: 2.0, spread: 0.017, recoil: 0.011, pitch: 1.0, hold: 'rifle', stock: 0.25, support: [0.03, -0.02, 0.27], grip: GRIP_RIFLE, sound: { dir: 'AssaultRifle', vol: 0.42, reload: [[0.2, 'mag_out'], [0.66, 'mag_in'], [0.86, 'charge']] } },
  { id: 'smg', code: 'SM-15', callsign: '疾羽', ads: { zoom: 1.25, hip: 1.4, speed: 16 },  name: '冲锋枪', file: 'Asset/Weapon/Guns/SMG.glb', auto: true, damage: 16, headMul: 1.8, rate: 15, mag: 35, reload: 1.6, spread: 0.031, recoil: 0.007, pitch: 1.15, hold: 'rifle', stock: 0.26, support: [0.03, -0.025, 0.19], grip: GRIP_RIFLE, sound: { dir: 'SMG', vol: 0.36, reload: [[0.2, 'mag_out'], [0.66, 'mag_in'], [0.86, 'bolt']] } },
  { id: 'lmg', code: 'LM-80', callsign: '磐石', ads: { zoom: 1.3, hip: 1.8, speed: 9, sightDy: -0.0045, reticle: true },  name: '轻机枪', file: 'Asset/Weapon/Guns/LightMachineGun.glb', auto: true, damage: 22, headMul: 1.8, rate: 12, mag: 80, reload: 3.4, spread: 0.034, recoil: 0.012, pitch: 0.85, hold: 'rifle', stock: 0.31, support: [0.035, -0.025, 0.30], grip: GRIP_RIFLE, sound: { dir: 'LightMachineGun', vol: 0.42, reload: [[0.18, 'cover_open'], [0.38, 'mag_out'], [0.64, 'mag_in'], [0.8, 'cover_close'], [0.88, 'charge']] } },
  { id: 'sniper', code: 'SR-05', callsign: '寂星', ads: { zoom: 3, hip: 28, scope: true, speed: 8 },  name: '狙击枪', file: 'Asset/Weapon/Guns/Sniper.glb', auto: false, damage: 100, headMul: 2.5, rate: 1.1, mag: 5, reload: 2.8, spread: 0.0021, recoil: 0.06, pitch: 0.6, hold: 'rifle', stock: 0.31, support: [0.03, -0.025, 0.36], grip: GRIP_RIFLE, sound: { dir: 'Sniper', vol: 0.8, after: [0.32, 'bolt'], reload: [[0.1, 'bolt_open'], [0.38, 'mag_out'], [0.6, 'mag_in'], [0.76, 'bolt']] } },
  { id: 'pistol', code: 'P-12', callsign: '晨曦', ads: { zoom: 1.25, hip: 1.5, speed: 16 },  name: '手枪', file: 'Asset/Weapon/Guns/Pistol.glb', auto: false, damage: 32, headMul: 2, rate: 6, mag: 12, reload: 1.3, spread: 0.011, recoil: 0.02, pitch: 1.3, hold: 'pistol', stock: 0, support: [0.035, -0.06, -0.01], grip: GRIP_PISTOL, sound: { dir: 'Pistol', vol: 0.55, reload: [[0.14, 'mag_out'], [0.58, 'mag_in'], [0.76, 'slide']] } },
  { id: 'revolver', code: 'RV-06', callsign: '流萤', ads: { zoom: 1.3, hip: 1.8, speed: 14 },  name: '左轮', file: 'Asset/Weapon/Guns/Revolver.glb', auto: false, damage: 62, headMul: 2, rate: 2.2, mag: 6, reload: 2.4, spread: 0.007, recoil: 0.05, pitch: 0.75, hold: 'pistol', stock: 0, support: [0.035, -0.06, -0.01], grip: GRIP_REVOLVER, sound: { dir: 'Revolver', vol: 0.72, reload: [[0.14, 'open'], [0.28, 'eject'], [0.6, 'load'], [0.78, 'close'], [0.9, 'hammer']] } },
  { id: 'shotgun', code: 'SG-09', callsign: '碎浪', ads: { zoom: 1.2, hip: 1.2, z: -0.1 },  name: '霰弹枪', file: 'Asset/Weapon/Guns/Shotgun.glb', auto: false, damage: 14, headMul: 1.5, rate: 1.4, mag: 6, reload: 2.6, spread: 0.09, recoil: 0.05, pitch: 0.7, pellets: 9, hold: 'rifle', stock: 0.21, support: [0.035, -0.03, 0.36], grip: GRIP_RIFLE, sound: { dir: 'Shotgun', vol: 0.75, after: [0.3, 'pump'], reload: [[0.2, 'shell'], [0.39, 'shell'], [0.58, 'shell'], [0.76, 'pump_slow']] } },
  { id: 'rocket', code: 'RL-01', callsign: '烈阳', ads: { zoom: 1.4, hip: 3, speed: 9, rangefinder: true },  name: '火箭筒', file: 'Asset/Weapon/Guns/RocketLauncher.glb', auto: false, damage: 0, headMul: 1, rate: 0.8, mag: 1, reload: 2.4, spread: 0.003, recoil: 0.07, pitch: 0.5, rocket: { speed: 34, radius: 4.2, damage: 140 }, hold: 'launcher', stock: 0, support: [0.03, -0.06, 0.18], grip: GRIP_LAUNCHER, sound: { dir: 'RocketLauncher', vol: 0.85, reload: [[0.2, 'breech_open'], [0.42, 'load'], [0.78, 'breech_close']] } },
];

// 读取并缓存枪模型：原点是握把，+Z 指向枪口，单位米；枪口位置存在模型里
export class Arsenal {
  constructor(loader, gradient) {
    this.loader = loader;
    this.gradient = gradient;
    this.cache = {};
  }

  load(def) {
    if (!this.cache[def.id]) {
      this.cache[def.id] = this.loader.loadAsync(def.file).then((gltf) => {
        const holder = new THREE.Group();
        holder.name = 'weapon_' + def.id;
        let muzzle = null, palmIK = false;
        gltf.scene.traverse((o) => {
          if (o.userData?.muzzle && !muzzle) muzzle = new THREE.Vector3().fromArray(o.userData.muzzle);
          if (o.userData?.palmIK) palmIK = true;
          if (!o.isMesh) return;
          o.castShadow = true;
          const conv = (m) => {
            // 换成卡通材质，和角色画风统一；弦光材质本身是冷白色，有贴图时略压暗避免过曝；没贴图的零件稍微提亮
            const t = new THREE.MeshToonMaterial({ name: m.name, color: m.color.clone().multiplyScalar(m.map ? 0.92 : 1.25), map: m.map, gradientMap: this.gradient });
            if (m.emissive && m.emissive.getHex()) { t.emissive = m.emissive.clone(); t.emissiveIntensity = m.emissiveIntensity ?? 1; }
            if (m.emissiveMap) t.emissiveMap = m.emissiveMap; // 弦光材质的薄荷青发光条
            return t;
          };
          o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
        });
        gltf.scene.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
        holder.add(gltf.scene);
        holder.userData.muzzle = muzzle || new THREE.Vector3(0, 0.03, 0.4);
        holder.userData.ikL = gltf.scene.getObjectByName('IK_LeftHand');
        holder.userData.ikR = gltf.scene.getObjectByName('IK_RightHand');
        holder.userData.palmIK = palmIK;
        return this._loadReload(def, holder, gltf.scene);
      });
    }
    return this.cache[def.id];
  }

  // AI 角色 / 联机替身用：每人一把独立的枪（复制模型，带一份换弹动画）
  async instance(def) {
    const src = await this.load(def);
    // clone 会用 JSON 复制 userData，而原模型的 userData 里有换弹动画的 mixer（循环引用），先临时拿掉
    const ud = src.userData;
    src.userData = {};
    let c;
    try { c = cloneSkinned(src); } finally { src.userData = ud; }
    // 玩家的枪上可能装了配件：副本不要（AI 和大厅展示自己决定装什么）
    c.userData = { muzzle: (ud.muzzleBase || ud.muzzle).clone(), palmIK: ud.palmIK };
    clearAttachments(c); // 去掉配件，把被藏起来/挪过的原部件还原
    c.userData.ikL = c.getObjectByName('IK_LeftHand');
    c.userData.ikR = c.getObjectByName('IK_RightHand');
    c.position.set(0, 0, 0); c.quaternion.identity(); c.scale.setScalar(1); c.visible = true;
    // 换弹动画也给副本一份（弹匣、拉机柄会动），联机时别人看到的换弹和自己看到的一样
    if (ud.reloadClip && c.children[0]) {
      const mixer = new THREE.AnimationMixer(c.children[0]);
      const action = mixer.clipAction(ud.reloadClip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
      c.userData.mixer = mixer;
      c.userData.reloadAction = action;
      c.userData.reloadClip = ud.reloadClip;
    }
    return c;
  }

  // 换弹动画：Asset/Animation/Reload/<枪名>.json（tools/gunlab.html 生成），驱动弹匣、拉机柄、枪身和左手位置
  async _loadReload(def, holder, scene) {
    const url = def.file.replace('Weapon/Guns', 'Animation/Reload').replace(/\.glb(\.wasm)?$/, '.json');
    try {
      const json = await (await fetch(url)).json();
      const clip = THREE.AnimationClip.parse(json);
      const mixer = new THREE.AnimationMixer(scene);
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
      holder.userData.mixer = mixer;
      holder.userData.reloadAction = action;
      holder.userData.reloadClip = clip; // 第一人称手臂的枪也要用同一段换弹动画
    } catch (e) {
      console.warn('没有换弹动画，用角色自带的换弹动作', url);
    }
    return holder;
  }
}

// 把所有武器用到的音效整理成 { 名字: 路径 }，交给 Sfx 统一加载
export function weaponSoundMap(ext = '') {
  const map = {};
  for (const w of WEAPONS) {
    const S = w.sound;
    const names = new Set(['shot', ...(S.reload || []).map((r) => r[1])]);
    if (S.after) names.add(S.after[1]);
    for (const n of names) map[`${w.id}/${n}`] = `Asset/Audio/Weapon/${S.dir}/${n}.ogg${ext}`;
  }
  return map;
}
