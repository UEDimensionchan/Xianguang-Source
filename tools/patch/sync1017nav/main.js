import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Octree } from 'three/addons/math/Octree.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { CHARACTERS, ASSETS, TUNING } from './config.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Player, adsOf } from './player.js';
import { ViewModel } from './viewmodel.js';
import { initLobby } from './lobby.js';
import { GunViewer } from './gunview.js';
import { LobbyStage } from './lobbystage.js';
import { attachAccessories } from './accessories.js';
import { loadSel } from './attachments.js';
import { loadName } from './profile.js';
import { playIntro } from './intro.js';
import { mergeStatic, DistanceCull, LightPool } from './optimize.js';
import { MAPS } from './maps.js';
import { initMenu, setFullscreen, isFullscreen } from './menu.js';
import { settings, onSettings, XH_COLORS, canonOf, keyLabel } from './settings.js';
import { uiSound } from './uisound.js';
import { Dummies } from './dummies.js';
import { Squads } from './bots.js';
import { Environment } from './env.js';
import { StylePass } from './style.js';
import { LockOn } from './lockon.js';
import { Wetness } from './wet.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Fx } from './fx.js';
import { Emotes } from './emote.js';
import { DeskPet } from './pet.js';
import { net } from './net.js';
import { Multiplayer } from './mp.js';
import { loadAnimData } from './anim.js';
import { Arsenal, WEAPONS, weaponSoundMap } from './weapons.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
if (!TEST && !params.has('nointro') && document.getElementById('intro')) playIntro(); // 启动动画，播完点左键进大厅

// ———————————— 渲染基础 ————————————
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe6ff);
scene.fog = new THREE.Fog(0xd7efff, 40, 120);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 600);
let baseFov = 70; // 由设置里的「视野」决定
// 放大 zoom 倍对应的视野角（按画面尺寸换算，3 倍镜 = 画面上的东西看起来大 3 倍）
const zoomFov = (fov, zoom) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) / zoom));

const hemi = new THREE.HemisphereLight(0xffffff, 0x9fb4d6, 1.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
sun.shadow.camera.layers.enable(9); sun.shadow.camera.layers.enable(10); sun.shadow.camera.layers.enable(11); // VRM 第一/第三人称图层、第一人称时隐藏的全身模型也要投影
const viewmodel = new ViewModel(); // 第一人称手臂（单独的场景和相机）
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -35;
sun.shadow.camera.right = sun.shadow.camera.top = 35;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// 三段色阶，做卡通光照（暗部比较亮、过渡柔和，偏日系动画的平涂感）
const gradient = new THREE.DataTexture(new Uint8Array([140, 140, 140, 255, 208, 208, 208, 255, 255, 255, 255, 255]), 3, 1);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

// 后期：画风（手绘墨线 + 纸张质感 + 调色 + 镜头水珠）→ 辉光（发光条、枪口火光、夜里的灯）→ 输出
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const stylePass = new StylePass(scene, camera);
composer.addPass(stylePass);
if (TEST) window.__style = stylePass;
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.25, 0.45, 0.92);
composer.addPass(bloomPass);
if (TEST) window.__bloom = bloomPass;
composer.addPass(new OutputPass());
let postOn = true;
function resizeComposer() {
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
}
resizeComposer();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  resizeComposer();
});

// ———————————— 游戏对象 ————————————
const octree = new Octree();
const sfx = new Sfx({ ...ASSETS.sfx, ...weaponSoundMap() });
const hud = new Hud(camera);
const stats = { kills: 0, shots: 0, hits: 0, heads: 0, deaths: 0 };

const game = {
  scene, camera, octree, sfx, hud, gradient, viewmodel, stats,
  player: null, dummies: null, fx: null,
  crosshairPoint: new THREE.Vector3(),
  shakeAmt: 0, fovKick: 0,
  worldBox: new THREE.Box3(),
  spawnPoint: new THREE.Vector3(),

  raycastWorld(origin, dir, maxDist = Infinity) {
    const r = octree.rayIntersect(new THREE.Ray(origin.clone(), dir.clone().normalize()));
    if (!r || r.distance > maxDist) return null;
    const normal = r.triangle.getNormal(new THREE.Vector3());
    if (normal.dot(dir) > 0) normal.negate();
    return { distance: r.distance, position: r.position.clone(), normal };
  },

  // 在地图里找一块平地；near=true 时围绕出生点
  randomSpawn(minDist, maxDist, near = false) {
    const center = near ? this.spawnPoint : (this.player ? this.player.feet(new THREE.Vector3()) : this.spawnPoint);
    const b = this.worldBox;
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = minDist + Math.random() * (maxDist - minDist);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (x < b.min.x + 1 || x > b.max.x - 1 || z < b.min.z + 1 || z > b.max.z - 1) continue;
      if (!near && this.spawnFilter && !this.spawnFilter(x, z)) continue; // 地图可以限定靶子刷新的区域
      const hit = this.raycastWorld(new THREE.Vector3(x, b.max.y + 5, z), new THREE.Vector3(0, -1, 0));
      if (!hit || hit.normal.y < 0.85) continue;
      // 头顶要有空间
      const above = this.raycastWorld(hit.position.clone().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(0, 1, 0), 2.2);
      if (above) continue;
      return hit.position;
    }
    return this.spawnPoint.clone();
  },

  shoot() {
    const W = this.player.weapon.def;
    const origin = camera.position.clone();
    const aim = camera.getWorldDirection(new THREE.Vector3());
    const muzzle = this.player.muzzle(new THREE.Vector3());
    const flash = W.rocket ? 2 : (W.flash ?? 1); // 消音器、消焰器让火光变小
    if (flash > 0.05) this.fx.muzzle(muzzle, camera, flash, this.player.muzzleAnchor());
    const pitch = (0.97 + Math.random() * 0.06) * (W.sound.rate || 1);
    if (W.sound.suppressed) sfx.playSuppressed(`${W.id}/shot`, W.sound.vol, pitch); // 消音器：闷、短、低
    else sfx.play(`${W.id}/shot`, W.sound.vol, pitch);
    if (W.sound.after) this.player.queueSound(W.sound.after[0], `${W.id}/${W.sound.after[1]}`, 0.6);
    this.shake(W.recoil * 4);
    hud.fire(W.recoil);

    // 火箭筒：朝准星打出一发会爆炸的火箭弹
    if (W.rocket) {
      const target = this.crosshairPoint.clone();
      const dir = target.sub(muzzle).normalize();
      this.fx.fireRocket(muzzle.clone(), dir, W.rocket, this.lock?.lockedTarget());
      this.lock?.reset();
      stats.shots++;
      return;
    }

    const range = TUNING.gun.range;
    const pellets = W.pellets || 1;
    let anyHit = false, anyHead = false, anyKill = false;
    for (let i = 0; i < pellets; i++) {
      const dir = aim.clone();
      const spread = this.player.spread();
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
      const ray = new THREE.Ray(origin, dir);
      const worldHit = this.raycastWorld(origin, dir, range);
      const dHit = this.dummies.raycast(ray, worldHit ? worldHit.distance : range);
      let end;
      if (dHit) {
        end = dHit.point;
        anyHit = true; anyHead = anyHead || dHit.head;
        // 霰弹枪距离越远伤害越低
        const falloff = pellets > 1 ? THREE.MathUtils.clamp(1.3 - dHit.distance / 22, 0.25, 1) : 1;
        const dmg = W.damage * falloff * (dHit.head ? W.headMul : 1);
        anyKill = this.dummies.damage(dHit.dummy, dmg, dHit.point, dHit.head) || anyKill;
        this.fx.hitBurst(end, camera, dir, dHit.head, pellets > 1);
      } else if (worldHit) {
        end = worldHit.position;
        this.fx.impact(end, camera);
        if (i === 0) this.impactSound(end);
      } else {
        end = origin.clone().addScaledVector(dir, range);
      }
      if (i < 4) { this.fx.tracer(muzzle, end); (this._ends ||= []).push(end); }
    }
    if (this.mp) this.mp.sendFire(this._ends || []);
    this._ends = null;
    stats.shots++;
    if (anyHit) {
      stats.hits++;
      if (anyHead) stats.heads++;
      hud.hit(anyHead, anyKill);
      if (!anyKill) sfx.play(anyHead ? 'hitHead' : 'hitBody', anyHead ? 0.75 : 0.6, 0.96 + Math.random() * 0.08);
    }
  },

  onKill(head) {
    stats.kills++;
    this.pet?.react(head ? 'head' : 'kill');
    sfx.play(head ? 'killHead' : 'kill', 0.8);
    if (!this.match) hud.kill(head, this.player.weapon.def); // 竞技模式的击杀播报由 Squads 统一发
  },

  // 子弹打到墙：距离越远越小声
  impactSound(pos) {
    const d = pos.distanceTo(camera.position);
    const v = THREE.MathUtils.clamp(0.5 * (1 - d / 45), 0, 0.5);
    if (v > 0.02) sfx.play('wall' + (1 + Math.floor(Math.random() * 3)), v, 0.9 + Math.random() * 0.2);
  },

  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); },
};

// ———————————— 加载 ————————————
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
const progressEl = document.getElementById('load-progress');
const loadText = document.getElementById('load-text');
const loadPct = document.getElementById('load-pct');
// 加载进度：条和右下角的百分比数字一起走（数字平滑滚动，不会一下跳很多）
let loadShown = 0, loadTarget = 0, loadRaf = 0;
function setLoad(v) {
  loadTarget = Math.max(loadTarget, Math.min(100, v));
  progressEl.style.width = loadTarget + '%';
  if (!loadRaf) loadRaf = requestAnimationFrame(tickLoad);
}
function tickLoad() {
  loadShown += (loadTarget - loadShown) * 0.12;
  if (loadTarget - loadShown < 0.4) loadShown = loadTarget;
  loadPct.firstChild.nodeValue = Math.floor(loadShown);
  loadRaf = loadShown < loadTarget ? requestAnimationFrame(tickLoad) : 0;
}
const LOAD_TIPS = [
  '按住右键瞄准；狙击枪开镜是 3 倍镜，镜里也能看到队友和敌人标记。',
  '纸化（C）时身体变成一张纸，侧面几乎打不中，但不能开枪。',
  '纸鹤突进（E）可以快速拉开距离，也能冲上高台。',
  '墨水炸弹（Q）的爆炸会穿过掩体边缘，适合逼出躲着的敌人。',
  '下雨天地面会积水，跑过水坑会溅起水花，也会发出踩水声。',
  '竞技模式里小地图只显示队友，按住 Tab 查看双方比分。',
  '敌人带红色描边；被墙挡住时不会透出来。',
  '觉得卡顿？在 设置 → 画面 里关掉「手绘描线」或「积水倒影」。',
  '一局里的时间和天气是随机的，一整天大约 12 分钟。',
];
let tipTimer = 0;
// 加载画面：换成所选地图的插画和名字，小提示每 4 秒换一条
function showLoading(mapId) {
  const m = MAPS.find((x) => x.id === mapId) || MAPS[0];
  const el = document.getElementById('loading');
  el.querySelector('.ld-img').style.backgroundImage = `url("Asset/UI/Lobby/map_${m.id}.jpg"), url("Asset/UI/Lobby/bg.jpg")`;
  el.querySelector('.ld-mode').textContent = m.mode === 'ranked' ? '团队竞技 · 4V4' : '训练场';
  el.querySelector('.ld-name').textContent = m.name;
  el.querySelector('.ld-en').textContent = m.en || '';
  el.querySelector('.ld-desc').textContent = m.desc || '';
  loadShown = loadTarget = 0; progressEl.style.width = '0%'; loadPct.firstChild.nodeValue = '0';
  const tip = el.querySelector('.ld-tip span');
  let i = Math.floor(Math.random() * LOAD_TIPS.length);
  tip.textContent = LOAD_TIPS[i];
  clearInterval(tipTimer);
  tipTimer = setInterval(() => {
    tip.classList.add('out');
    setTimeout(() => { i = (i + 1) % LOAD_TIPS.length; tip.textContent = LOAD_TIPS[i]; tip.classList.remove('out'); }, 350);
  }, 4000);
  el.classList.add('show');
}
function hideLoading() {
  setLoad(100);
  clearInterval(tipTimer);
  document.getElementById('loading').classList.remove('show');
}

// 按选中的地图现场搭建场景
let builtMap = null;
async function loadWorld(id) {
  const map = MAPS.find((m) => m.id === id) || MAPS[0];
  const built = await map.build(gradient, { loader, url: ASSETS.world, scale: TUNING.worldScale });
  builtMap = built;
  scene.add(built.solid, built.decor);
  built.solid.updateMatrixWorld(true);
  octree.fromGraphNode(built.solid);
  game.worldBox.setFromObject(built.solid);
  // 性能：碰撞建好之后，把静态物体按材质和区块合并、雾外的隐藏、路灯只留最近几盏真光源
  try {
    const a = mergeStatic(built.solid, { anims: built.anim }), b = mergeStatic(built.decor, { anims: built.anim });
    console.info(`地图合并：${a.before + b.before} 个物体 → ${a.after + b.after} 次绘制`);
  } catch (e) { console.warn('地图合并失败（不影响游戏）', e); }
  game.distCull = new DistanceCull([built.solid, built.decor]);
  game.lightPool = built.lamps?.length > 6 ? new LightPool(scene, built.lamps, 6) : null;
  if (game.lightPool) built.lamps = game.lightPool.lamps;
  game.mapHide = [built.decor];
  game.navUnder = built.navUnder || [];
  game.spawnFilter = built.spawnFilter || null;
  hud.mapName = map.name;
  document.getElementById('map-name').textContent = map.name;
  game.dummyRange = built.dummyRange || null;
  scene.background = new THREE.Color(built.background);
  scene.fog = new THREE.Fog(...built.fog);

  const c = game.worldBox.getCenter(new THREE.Vector3());
  if (built.spawn) game.spawnPoint.copy(built.spawn);
  else {
    const hit = game.raycastWorld(new THREE.Vector3(0, game.worldBox.max.y + 5, 0), new THREE.Vector3(0, -1, 0))
      || game.raycastWorld(new THREE.Vector3(c.x, game.worldBox.max.y + 5, c.z), new THREE.Vector3(0, -1, 0));
    game.spawnPoint.copy(hit ? hit.position : c);
  }
  game.spawnYaw = built.yaw ?? Math.atan2(c.x - game.spawnPoint.x, c.z - game.spawnPoint.z);
  sun.target.position.copy(c);
}

async function loadCharacter(ch) {
  loadText.textContent = `正在加载角色：${ch.name}`;
  const gltf = await loader.loadAsync(ch.file, (e) => {
    if (e.total) setLoad(40 + e.loaded / e.total * 15);
  });
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons?.(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
    if (o.isMesh) o.castShadow = true;
  });
  // Blender 里补做的配件（腰带、挂饰、靴子……），失败也不影响进游戏
  if (ch.acc) await attachAccessories(loader, vrm, ch.acc).catch((e) => console.warn('角色配件加载失败', e));
  return vrm;
}

// ———————————— 输入 ————————————
const input = { keys: {}, pressed: {}, fire: false, firePressed: false, wheel: 0, paper: false };
let locked = false;
let everLocked = false; // 成功锁定过一次，说明浏览器支持；之后的失败多半是 Esc 后的冷却时间，不切换成直接转视角
let freeLook = false; // 浏览器不允许锁定鼠标时（比如嵌在网页里），改用直接移动鼠标转视角
let running = false;

// fromGesture：这次请求是不是在玩家点击的那一刻发出的。
// 浏览器只允许在点击之后马上锁定鼠标；加载完自动锁定那一下常常被拒（尤其竞技模式加载要好几秒），
// 这种情况不能当成“浏览器不支持”，而是提示玩家点一下屏幕。
let lockFromGesture = false;
function lockPointer(fromGesture = true, quiet = false) {
  if (freeLook && !quiet) return;
  lockFromGesture = fromGesture;
  const fail = () => {
    if (quiet) return; // 直接转视角模式下顺手再试一次锁定，失败就算了
    // PC 版一定能锁定鼠标：失败只是时机不对（比如刚按过 Esc），提示再点一下，不切到会让鼠标跑出窗口的直接转视角模式
    if (!fromGesture || window.native) { clickHint(true); return; }
    if (everLocked) { menu.hint('鼠标锁定失败，请稍等一下再点「继续游戏」'); if (!menu.isOpen()) menu.open(); return; }
    enableFreeLook();
  };
  try {
    // unadjustedMovement：直接读鼠标原始位移，绕开系统加速，也避免 Chrome 在锁定鼠标时偶尔给出的异常大跳变
    const r = renderer.domElement.requestPointerLock({ unadjustedMovement: true });
    if (r && r.catch) r.catch((err) => {
      if (!fromGesture || (everLocked && err && err.name !== 'NotSupportedError')) return fail();
      try {
        const r2 = renderer.domElement.requestPointerLock();
        if (r2 && r2.catch) r2.catch(fail);
      } catch (e) { fail(); }
    });
  } catch (e) { fail(); }
}
// 屏幕中间的“点击开始”提示
function clickHint(on) {
  let el = document.getElementById('click-hint');
  if (!el) {
    if (!on) return;
    el = document.createElement('div');
    el.id = 'click-hint';
    el.innerHTML = '<b>点击屏幕开始</b><span>鼠标会被锁定用来转动视角 · 按 Esc 打开菜单</span>';
    document.getElementById('hud').appendChild(el);
  }
  el.classList.toggle('on', on);
}
function enableFreeLook() {
  if (freeLook) return;
  freeLook = true;
  clickHint(false);
  menu.close();
  setPaused(false);
  hud.feed('浏览器不允许锁定鼠标，已切换为直接移动鼠标转视角 · Esc 打开菜单');
}
document.addEventListener('pointerlockerror', () => { if (!everLocked && lockFromGesture && !window.native && !freeLook) enableFreeLook(); else if (!lockFromGesture || window.native) clickHint(true); });
const SENS = 0.0022;

// 暂停：局内打开菜单时游戏停住（单机训练场）
let wheelUsed = false; // 这次按住 X 已经用左键发过了，松开前不再打开轮盘
function setPaused(p) {
  game.paused = p;
  if (p) game.emotes?.closeWheel();
  if (p) { input.fire = false; input.mouseAim = false; input.keys = {}; input.pressed = {}; }
}

// 按键按设置里的键位翻译成动作的“规范键”（见 settings.js），游戏逻辑只读规范键
function press(code) {
  const canon = canonOf(code);
  if (!canon) return false;
  for (const c of canon) { if (!input.keys[c]) input.pressed[c] = true; input.keys[c] = true; }
  return true;
}
function release(code) { for (const c of canonOf(code) || []) input.keys[c] = false; }
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { onEscape(e); return; }
  if (!running || game.paused) return;
  if (press(e.code) && !e.code.startsWith('F')) e.preventDefault(); // 绑定了动作的键不触发浏览器默认行为（空格滚动、Ctrl 快捷键等）
});
addEventListener('keyup', (e) => release(e.code));
addEventListener('mousedown', (e) => {
  // 菜单、结算界面、过场上的点击是点按钮，不能顺手把鼠标锁进游戏里
  if (!running || menu.isOpen() || leaving || matchOver) return;
  if (e.target.closest?.('#result, #esc, #esc-curtain')) return;
  if (!locked && !freeLook && !TEST) { lockPointer(); return; }
  // 直接转视角模式（鼠标没锁住，会移出窗口）：每次点击都再试着锁定一次，成功了就回到正常模式
  if (freeLook && !locked && !TEST) lockPointer(true, true);
  if (game.emotes?.open) { if (e.button === 0) { game.emotes.send(game.emotes.closeWheel()); wheelUsed = true; } return; } // 轮盘开着时点左键也能发送，不开枪
  if (e.button === 0) { input.fire = true; input.firePressed = true; }
  else if (e.button === 2) input.mouseAim = true;
  else if (press('Mouse' + e.button)) e.preventDefault(); // 中键 / 侧键可以绑动作
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
  else if (e.button === 2) input.mouseAim = false;
  else release('Mouse' + e.button);
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (running && !game.paused) input.wheel += Math.sign(e.deltaY); }, { passive: true });
// 有的浏览器/系统在锁定鼠标后，偶尔会报一个远超正常的位移（视角突然跳一下），这里把这种异常值滤掉
let lastMove = 0;
addEventListener('mousemove', (e) => {
  if (!((locked || freeLook) && running && game.player && !game.paused)) return;
  const m = Math.hypot(e.movementX, e.movementY);
  if (m > 250 && m > lastMove * 6 + 60) return; // 单次跳变异常大，且和上一次差太多：丢弃
  lastMove = m;
  // 表情轮盘打开时，鼠标移动用来选表情，视角不动
  if (game.emotes?.open) { game.emotes.wheelMove(e.movementX, e.movementY); return; }
  // 放大时灵敏度跟着降低，开镜后转动手感和不开镜一致；再乘上设置里的灵敏度
  const pl = game.player;
  const k = settings.sens * (pl.scoped || pl.ads > 0.5 ? settings.adsSens : 1);
  const s = SENS * k * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(baseFov) / 2);
  pl.look(e.movementX * s, e.movementY * s * (settings.invertY ? -1 : 1));
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    everLocked = true; clickHint(false);
    if (freeLook) { freeLook = false; hud.feed('鼠标已锁定'); }
  }
  lastMove = 0;
  if (!locked) { input.fire = false; input.mouseAim = false; input.keys = {}; }
  if (!running || leaving || matchOver) return;
  if (locked) { menu.close(); setPaused(false); } // 点「继续游戏」后真正锁定成功才关菜单
  else if (!freeLook && !menu.isOpen()) { setPaused(true); menu.open(); } // 按 Esc 退出锁定 = 打开暂停菜单
});

// Esc：大厅里开关系统菜单；局内（鼠标已解锁时）在菜单里逐级返回
function onEscape(e) {
  if (leaving || matchOver) return;
  if (!running) {
    if (document.querySelector('#lobby.hide')) return;
    if (document.querySelector('.mx-modal.on, .sh-modal.on')) return; // 大厅自己的弹窗先处理
    if (menu.isOpen()) menu.back(true);
    else menu.open();
    return;
  }
  e.preventDefault();
  if (menu.isOpen()) menu.back(freeLook || TEST); // 锁定模式下 Esc 不能重新锁鼠标，得点按钮
  else if (freeLook || TEST) { setPaused(true); menu.open(); }
}

// ———————————— 主循环 ————————————
const clock = new THREE.Timer();
const _v = new THREE.Vector3();

let cursorHidden = false;
let envLabelT = 0;
const mapNameEl = document.getElementById('map-name');
let lastFrameT = 0;
function frame(now) {
  // 帧率上限：没到时间就跳过这一帧（留 1ms 余量，避免 60 帧上限在 60Hz 屏上掉到 30）
  const cap = settings.fpsCap;
  if (cap > 0 && now && now - lastFrameT < 1000 / cap - 1) { requestAnimationFrame(frame); return; }
  lastFrameT = now || performance.now();
  clock.update();
  rawDt = clock.getDelta();
  const dt = Math.min(0.05, rawDt);
  if (!window.__freeze) step(dt); // 测试截图时冻结实时循环，改用手动步进
  // 鼠标指针：战斗中隐藏，弹出菜单 / 设置 / 结算 / “点击开始”提示时显示
  const hideCursor = running && (locked || freeLook) && !game.paused && !matchOver && !leaving && !menu.isOpen();
  if (hideCursor !== cursorHidden) { cursorHidden = hideCursor; document.body.classList.toggle('no-cursor', hideCursor); }
  if (postOn && running) {
    if (game.env) {
      const b = game.env.bloomParams(); bloomPass.strength = b.strength; bloomPass.threshold = b.threshold; bloomPass.radius = b.radius;
      stylePass.setEnv(game.env.styleParams());
      if (settings.lensRain === false) stylePass.uniforms.rain.value = 0;
    }
    stylePass.inkEnabled = settings.ink !== false;
    composer.render();
  } else renderer.render(scene, camera);
  viewmodel.render(renderer); // 第一人称手臂画在最上层
  if (game.pet && running && settings.pet !== false && !leaving) game.pet.render(renderer);
  requestAnimationFrame(frame);
}

// 每帧的性能处理：雾外隐藏、路灯池、阴影隔帧、看不见的机器人不画
const _frus = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
let shadowFlip = false;
// 动态分辨率：最近 1.5 秒平均帧时间太长就降低渲染精度（最低 60%），帧率富余了再慢慢升回来
let rawDt = 0.016, autoRes = 1, autoResOn = true, frameAcc = 0, frameN = 0;
function autoResTick(dt) {
  if (!autoResOn || dt > 0.25) return;
  frameAcc += dt; frameN++;
  if (frameAcc < 1.5) return;
  const avg = frameAcc / frameN; frameAcc = 0; frameN = 0;
  let next = autoRes;
  if (avg > 1 / 45) next = Math.max(0.6, autoRes - (avg > 1 / 30 ? 0.15 : 0.08));
  else if (avg < 1 / 57 && autoRes < 1) next = Math.min(1, autoRes + 0.05);
  if (Math.abs(next - autoRes) > 0.001) { autoRes = next; applyPixelRatio(); }
}
function perfTick(dt) {
  autoResTick(rawDt);
  const far = scene.fog ? scene.fog.far + 6 : 400;
  game.distCull?.update(camera, far, dt);
  game.lightPool?.update(camera, dt);
  // 阴影：每两帧更新一次（人物移动的阴影 30 次/秒足够）
  renderer.shadowMap.autoUpdate = false;
  shadowFlip = !shadowFlip;
  if (shadowFlip) renderer.shadowMap.needsUpdate = true;
  // 机器人：模型关了视锥剔除（蒙皮包围盒不准），这里按人物位置自己判断：视野外、雾外的不画
  const bots = game.match?.bots;
  if (bots?.length) {
    camera.updateMatrixWorld();
    _frus.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const b of bots) {
      const root = b.vrm?.scene;
      if (!root) continue;
      _sph.center.copy(b.pivot.position); _sph.center.y += 0.9; _sph.radius = 1.6;
      const d = _sph.center.distanceTo(camera.position);
      // 稍微放宽：视野外 4 米内的也画（影子、倒影还在画面里）
      const vis = d < far && (d < 4 || _frus.intersectsSphere(_sph));
      if (root.visible !== vis) root.visible = vis;
    }
  }
}

function step(dt) {
  // 联机对局不能暂停：打开菜单时世界照常运行（只是自己的按键不起作用），别人也照常能打到你
  if (running && game.player && (!game.paused || game.mp)) {
    input.paper = !!(input.keys.KeyC || input.forcePaper);
    input.aim = !!(input.mouseAim || input.forceAim);
    // 准星指向的世界点（给枪口朝向用）
    const dir = camera.getWorldDirection(_v);
    const wh = game.raycastWorld(camera.position, dir, 120);
    game.crosshairPoint.copy(camera.position).addScaledVector(dir, wh ? Math.max(4, wh.distance) : 120);
    if (game.debugCam && game.player) game.crosshairPoint.copy(game.player.aimPoint); // 测试机位时枪仍然朝角色前方

    mapTime += dt;
    if (builtMap) for (const f of builtMap.anim) f(mapTime);
    perfTick(dt);
    // 表情：按住 X 打开轮盘，松开发送
    const em = game.emotes;
    if (em) {
      const held = !!input.keys.KeyX && game.player.alive !== false;
      if (held && !em.open && !wheelUsed) em.openWheel();
      else if (!held && em.open) em.send(em.closeWheel());
      if (!input.keys.KeyX) wheelUsed = false;
      em.update(dt);
    }
    if (game.pet && settings.pet !== false) game.pet.update(dt, game.player);
    game.mp?.update(dt);
    game.player.update(dt, input);
    game.lock?.update(dt, game.player, camera);
    game.dummies.update(dt);
    game.fx.update(dt);
    hud.update(dt, game.player, stats);
    if (game.debugCam) { // 测试用：自由机位
      game.player.feet(_v);
      camera.position.copy(_v).add(game.debugCam.offset);
      camera.lookAt(_v.add(game.debugCam.look));
    }

    game.shakeAmt = Math.max(0, game.shakeAmt - dt * 1.5);
    game.fovKick = Math.max(0, game.fovKick - dt * 30);
    // 瞄准时视野变窄（镜头放大）；狙击镜开着时直接 3 倍
    const pl = game.player, AD = adsOf(pl.weapon.def);
    // 第三人称瞄准只轻微放大，不然人物会被挤出画面；第一人称才用武器 / 瞄具的完整倍率
    const adsZoom = AD.scope ? 1.5 : pl.firstPerson ? AD.zoom : Math.min(AD.zoom, 1.3);
    const zoom = pl.scoped ? AD.zoom : (pl.firstPerson && AD.rangefinder) ? 1 : THREE.MathUtils.lerp(1, adsZoom, pl.ads);
    const fov = zoomFov(baseFov, zoom) + game.fovKick * (1 - pl.ads) + pl.paperAmt * 4 + (pl.sprintAmt || 0) * 6; // 冲刺时视野稍微拉宽
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    // 昼夜、天气；阴影跟着玩家，方向跟着太阳（夜里是月亮）
    if (game.env) {
      game.env.update(dt);
      // 小地图下面显示时间和天气，每秒刷新
      if ((envLabelT -= dt) <= 0) { envLabelT = 1; mapNameEl.textContent = `${hud.mapName || ''} · ${game.env.label}`; }
    }
    game.player.feet(_v);
    if (game.env) sun.position.copy(_v).addScaledVector(game.env.keyDir, 40);
    else sun.position.set(_v.x + 18, _v.y + 30, _v.z + 12);
    sun.target.position.copy(_v);

    input.pressed = {};
    input.firePressed = false;
  }
}

// ———————————— 开始界面 ————————————
let selected = CHARACTERS.find((c) => c.id === 'kikyo') || CHARACTERS[0]; // 默认：桔梗（澪）
let pendingRoom = null; // 组队联机：正在进入的房间
const grid = document.getElementById('char-grid');
for (const ch of CHARACTERS) {
  const b = document.createElement('button');
  b.className = 'char-card';
  b.style.setProperty('--c', ch.color);
  b.innerHTML = `<span class="swatch"></span><span class="nm">${ch.name}</span>`;
  b.onclick = () => {
    selected = ch;
    grid.querySelectorAll('.char-card').forEach((x) => x.classList.toggle('sel', x === b));
  };
  if (ch === selected) b.classList.add('sel');
  grid.appendChild(b);
}

// 训练地图：大厅里选，测试时用 ?map=xxx
let selectedMap = (TEST && params.get('map')) || 'skyterrace';
let mapTime = 0;

async function start() {
  document.getElementById('start').classList.add('hide');
  document.getElementById('lobby').classList.add('hide');
  document.querySelector('#lobby .lb-video')?.pause(); // 进了训练场就不用再解码背景视频
  showLoading(selectedMap);
  sfx.init().then(applyAudio).catch(() => {});
  loadText.textContent = '正在加载地图';
  setLoad(10);
  await loadWorld(selectedMap);
  setLoad(40);
  game.env = new Environment({ scene, camera, sun, hemi, built: builtMap, sfx, viewmodel, hud, game });
  game.env.setOptions({ cycle: settings.cycle, dynamic: settings.weather });
  const animPromise = loadAnimData(ASSETS.anim).catch((e) => { console.warn('动作数据加载失败，改用简易动画', e); return null; });
  const vrm = await loadCharacter(selected);
  const animData = await animPromise;

  game.attachSel = loadSel(); // 武器页「配件」里给每把枪选的配件
  game.player = new Player(game);
  game.player.setModel(vrm, animData);
  game.arsenal = lobbyArsenal;
  gunViewer?.dispose(); gunViewer = null; lobbyStage?.dispose(); lobbyStage = null; // 进局后释放大厅的 3D 展示台
  loadText.textContent = '正在加载武器';
  await game.player.equip(startWeapon);
  setLoad(56);
  // 其余武器在后台慢慢加载，切枪时不用等
  setTimeout(() => WEAPONS.forEach((w) => game.arsenal.load(w).catch((e) => console.warn('武器加载失败', w.file, e))), 1500);
  game.fx = new Fx(game);
  game.emotes ||= new Emotes(game);
  game.pet ||= new DeskPet(loader);
  game.pet.setCharacter(selected); // 后台加载，不耽误进游戏
  if (!game.lock) game.lock = new LockOn(game); else game.lock.reset();
  if (builtMap.mode === 'ranked') {
    // 竞技：两队 AI，玩家在我方（薄荷色）
    loadText.textContent = '正在生成寻路网格';
    setLoad(58);
    await new Promise((r) => setTimeout(r, 30));
    game.match = new Squads(game, builtMap, { target: 30, duration: 360 });
    game.dummies = game.match;
    game.playerSpawn = () => game.match.spawnPoint('ally');
    game.respawnTime = 4;
    game.onPlayerDeath = (by) => game.match.onPlayerDeath(by);
    game.onMatchEnd = (result) => showResult(result);
    // 组队联机：AI 只在房主那边生成（其他人看到的是房主同步过来的替身）
    if (!pendingRoom || pendingRoom.host) await game.match.spawnTeams(loader, CHARACTERS, animData, selected, (k) => {
      loadText.textContent = `正在召集队员 ${Math.round(k * 7)} / 7`;
      setLoad(58 + k * 38);
    });
    game.match.update(1 / 60); // 先摆好姿势，好渲染头像
    if (pendingRoom) enterRoom(pendingRoom, animData);
  } else {
    game.dummies = new Dummies(game);
    setLoad(90);
  }
  game.player.spawn(game.spawnPoint);
  game.player.yaw = game.spawnYaw;
  if (game.mp) { game.player.spawn(game.match.spawnPoint('ally')); game.player.yaw = game.match.teamYaw('ally'); } // 联机：在自己队伍那边出生

  hud.setCharacter(loadName()); // 局内显示玩家的昵称（大厅头像卡片里改）
  hud.setup(game, renderer, vrm);
  hideLoading();
  document.getElementById('hud').classList.add('show');
  running = true;
  if (!TEST) lockPointer(false); // 加载完试着自动锁定；不行就提示点一下屏幕
  { const k = (id) => keyLabel(settings.keys[id][0] || settings.keys[id][1]); hud.feed(`右键瞄准 · ${k('paper')} 纸化 · ${k('dash')} 突进 · ${k('bomb')} 墨水炸弹`); }
  if (game.room) hud.feed(game.room.host ? '房间已创建 · 等其他玩家加入，按 Enter 开始游戏' : '已加入房间 · 等待房主开始游戏', 'good');
  else if (game.match) hud.feed('团队竞技 · 4 秒后开战 · 按住 Tab 查看比分', 'good');
}

// ———— 组队联机：房间里等待开始 ————
// 进入房间的地图后比赛停在 room 阶段（不倒计时），房主按 Enter 开始 → 服务器通知所有人 → 进入 3 秒热身后开战。
// 现在空位由 AI 补上；玩家之间的局内同步（位置、开火……）走 net.send('game.*')，后续接上。
let roomBar = null;
function enterRoom(r, animData) {
  game.room = { id: r.id, name: r.name, host: !!r.host, max: r.max, players: net.room?.players || r.players || [] };
  game.match.phase = 'room'; game.match.live = false;
  game.mp = new Multiplayer(game, { loader, characters: CHARACTERS, animData, room: { ...r, hostId: r.host ? net.id : r.hostId } });
  const died = game.onPlayerDeath;
  game.onPlayerDeath = (by) => { died?.(by); game.mp?.playerDied(by); };
  // 加入的时候对局已经开始了：直接进热身
  if (r.state === 'playing') { game.match.phase = 'warmup'; game.match.warmT = 1; setTimeout(() => roomBar?.remove(), 0); }
  roomBar = document.createElement('div');
  roomBar.id = 'room-bar';
  document.getElementById('hud').appendChild(roomBar);
  drawRoomBar();
  net.on('room.update', (m) => { if (!game.room) return; game.room.players = m.room.players; game.room.host = m.room.hostId === net.id; drawRoomBar(); });
  net.on('game.join', (m) => hud.feed(`「${m.name}」加入了房间`, 'good'));
  net.on('game.leave', () => hud.feed('有玩家离开了房间'));
  net.on('room.started', (m) => {
    if (!game.match || game.match.phase !== 'room') return;
    game.mp?.onStart(m.room.players);
    game.match.phase = 'warmup'; game.match.warmT = 3;
    roomBar?.classList.add('go');
    setTimeout(() => roomBar?.remove(), 1200);
    hud.feed('房主开始了游戏 · 3 秒后开战', 'good');
  });
  net.on('disconnect', () => hud.feed('与联机服务器断开连接', 'bad'));
}
function drawRoomBar() {
  if (!roomBar || !game.room) return;
  const R = game.room;
  roomBar.innerHTML = `<b></b><span>${R.players.length} / ${R.max} 名玩家</span>${R.host ? '<em>按 <kbd>Enter</kbd> 开始游戏</em>' : '<em>等待房主开始…</em>'}`;
  roomBar.querySelector('b').textContent = R.name;
}
addEventListener('keydown', (e) => {
  if (e.code !== 'Enter' || !game.room?.host || game.match?.phase !== 'room' || menu.isOpen()) return;
  e.preventDefault();
  net.startRoom().catch((err) => hud.feed('开始失败：' + err.message, 'bad'));
});

// ———— 竞技：比分板（按住 Tab）和结算界面 ————
function scoreRows(team) {
  const M = game.match;
  const rows = (team === 'ally' ? M.allies : M.enemies).map((b) => ({ name: b.name, k: b.kills, d: b.deaths, face: b.face, me: false }));
  if (team === 'ally') rows.unshift({ name: loadName() || selected.name, k: stats.kills, d: stats.deaths, face: hud.face, me: true }); // 自己显示昵称
  return rows.sort((a, b) => b.k - a.k || a.d - b.d);
}
function scoreTable(team) {
  return `<table class="sb-t ${team}"><thead><tr><th>${team === 'ally' ? '我方' : '敌方'}</th><th>击杀</th><th>阵亡</th></tr></thead><tbody>${
    scoreRows(team).map((r) => `<tr class="${r.me ? 'me' : ''}"><td><span class="f">${r.face ? `<img src="${r.face}" alt="">` : ''}</span><b></b></td><td>${r.k}</td><td>${r.d}</td></tr>`).join('')}</tbody></table>`;
}
function fillNames(root, team) {
  const rows = scoreRows(team);
  root.querySelectorAll(`.sb-t.${team} tbody b`).forEach((b, i) => { b.textContent = rows[i].name; });
}
let sbEl = null;
function showScoreboard(on) {
  if (!game.match) return;
  if (!sbEl) { sbEl = document.createElement('div'); sbEl.id = 'scoreboard'; document.getElementById('hud').appendChild(sbEl); }
  if (on) {
    const M = game.match;
    sbEl.innerHTML = `<div class="sb-head"><span class="a">${M.score.ally}</span><em>团队竞技 · 先到 ${M.target}</em><span class="e">${M.score.enemy}</span></div><div class="sb-body">${scoreTable('ally')}${scoreTable('enemy')}</div>`;
    fillNames(sbEl, 'ally'); fillNames(sbEl, 'enemy');
  }
  sbEl.classList.toggle('on', on);
}
addEventListener('keydown', (e) => { if (e.code === 'Tab' && running) { e.preventDefault(); if (!e.repeat) showScoreboard(true); } });
addEventListener('keyup', (e) => { if (e.code === 'Tab') showScoreboard(false); });

let matchOver = false;
function showResult(result) {
  matchOver = true;
  if (result === 'win' || result === 'lose') game.pet?.react(result);
  showScoreboard(false);
  setTimeout(() => {
    setPaused(true);
    if (document.pointerLockElement) document.exitPointerLock();
    const M = game.match;
    const T = { win: ['胜利', 'VICTORY'], lose: ['失败', 'DEFEAT'], draw: ['平局', 'DRAW'] }[result];
    const all = [...scoreRows('ally'), ...scoreRows('enemy')];
    const mvp = all.reduce((a, b) => (b.k > a.k ? b : a), all[0]);
    const el = document.createElement('div');
    el.id = 'result';
    el.className = result;
    el.innerHTML = `<div class="rs-title"><b>${T[0]}</b><span>${T[1]}</span></div>
      <div class="rs-score"><span class="a">${M.score.ally}</span><i>:</i><span class="e">${M.score.enemy}</span></div>
      <div class="rs-mvp">本局 MVP <b></b> · ${mvp.k} 击杀</div>
      <div class="sb-body">${scoreTable('ally')}${scoreTable('enemy')}</div>
      <div class="rs-btns"><button class="rs-lobby">返回大厅</button><button class="rs-again">再来一局</button></div>`;
    document.body.appendChild(el);
    el.querySelector('.rs-mvp b').textContent = mvp.name;
    fillNames(el, 'ally'); fillNames(el, 'enemy');
    requestAnimationFrame(() => el.classList.add('on'));
    sfx.play(result === 'win' ? 'killHead' : 'hurt', 0.7);
    el.querySelector('.rs-lobby').onclick = () => backToLobby(false);
    // 联机：再来一局 = 这个房间原地重开（所有人一起），不回大厅
    // 再来一局：原地重开（联机时整个房间一起重开）
    el.querySelector('.rs-again').onclick = () => (game.mp ? game.mp.requestReset() : resetMatch());
  }, 1200);
}

// 联机：房间原地重开一局（比分、时间清零，所有人回出生点，3 秒后开打）
function resetMatch() {
  const M = game.match;
  if (!M) return;
  document.getElementById('result')?.remove();
  matchOver = false;
  M.score.ally = 0; M.score.enemy = 0;
  M.timeLeft = M.duration; M.phase = 'warmup'; M.warmT = 3; M.live = false;
  for (const b of M.bots) { b.kills = 0; b.deaths = 0; if (!b.kind) b.spawn(M.spawnPoint(b.team)); } // 房主的 AI 回出生点（替身跟着各自的状态走）
  stats.kills = 0; stats.deaths = 0; stats.shots = 0; stats.hits = 0; stats.heads = 0;
  game.player.spawn(M.spawnPoint('ally')); game.player.yaw = M.teamYaw('ally');
  setPaused(false);
  hud.feed('房间重开 · 3 秒后开战', 'good');
  if (!locked && !TEST) clickHint(true);
}
game.onMatchReset = resetMatch;
function backToLobby(again) {
  leaving = true;
  if (document.pointerLockElement) document.exitPointerLock();
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ nav: selected?.id, weapon: WEAPONS[startWeapon]?.id, map: selectedMap, again }));
  } catch (e) { /* 忽略 */ }
  // 先淡入过渡画面再切走，不会“啪”一下闪回去
  for (const b of document.querySelectorAll('#result button')) b.disabled = true;
  curtain(`<div class="lg">弦光</div><div class="en">PRISM / LINK</div><p>${again ? '正在重新匹配…' : '正在返回大厅…'}</p><div class="bar"><i></i></div>`);
  setTimeout(() => location.reload(), 800);
}

document.getElementById('start-btn').onclick = start;
// 大厅：开始匹配 / 试用 / 训练场 进训练场；引航者页「设为出战」换 3D 角色，武器页「装备武器」换初始武器
let startWeapon = 0;
const lobbyArsenal = new Arsenal(loader, gradient); // 大厅武器页 3D 展示和局内共用同一份模型缓存
let gunViewer = null;
const lobbyApi = initLobby({
  gunViewer: (host) => (gunViewer = new GunViewer(host, lobbyArsenal)),
  characters: CHARACTERS, weapons: WEAPONS, onStart: start,
  onCharacter: (ch) => { if (ch) { selected = ch; lobbyStage?.setCharacter(ch).catch((e) => console.warn('大厅角色加载失败', e)); } },
  onWeapon: (i) => { startWeapon = i; lobbyStage?.setWeapon(WEAPONS[i]).catch((e) => console.warn('大厅武器加载失败', e)); },
  maps: MAPS, onMap: (id) => { selectedMap = id; },
  getProfile: () => ({ char: selected?.id || '' }),
  // 组队联机：创建 / 加入房间后进入房间的地图，比赛停在「等待开始」
  onRoom: (room, host) => { pendingRoom = { ...room, host }; selectedMap = room.map; start(); },
});

// 大厅主页的 3D 角色（出战角色抱着当前装备的枪）；WebGL 出问题时保留原来的立绘
let lobbyStage = null;
const LOBBY_3D = false; // 大厅主页用立绘；改成 true 换回 3D 角色抱枪
if (LOBBY_3D && !TEST) try {
  const home = document.querySelector('#lobby .lb-page[data-page="home"]');
  const wrap = document.createElement('div');
  wrap.className = 'lb-stage-wrap';
  home.querySelector('.lb-char').after(wrap);
  lobbyStage = new LobbyStage(wrap, { loader, arsenal: lobbyArsenal, animData: loadAnimData(ASSETS.anim).catch(() => null) });
  const lb = document.getElementById('lobby');
  lobbyStage.active = () => (lb.dataset.page || 'home') === 'home' && !lb.classList.contains('hide');
  lobbyStage.setCharacter(selected).catch((e) => { console.warn('大厅角色加载失败', e); wrap.remove(); });
  lobbyStage.setWeapon(WEAPONS[startWeapon]).catch((e) => console.warn('大厅武器加载失败', e));
} catch (e) { console.warn('大厅 3D 角色不可用', e); }

// ———————————— ESC 菜单 / 设置 ————————————
const RETURN_KEY = 'prismlink.return';
let leaving = false;
const TIPS = [
  '纸化（C）时侧面几乎打不中，可以用来躲开纸飞机。',
  '爆头伤害更高，命中时准星会变成橙色。',
  '右键开镜移动变慢，但扩散大幅减小；狙击枪是 3 倍镜。',
  '纸鹤突进（E）可以快速拉开距离，也能冲上高台。',
  '晴空露台的两座高塔视野最好，坡道就在塔的正前方。',
  '折光靶场地面每 10 米一条距离线，适合练习远距离压枪。',
];
const fmtTime = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t) % 60).padStart(2, '0')}`;
let tip = TIPS[0];
const menu = initMenu({
  context: () => (running ? 'game' : 'lobby'),
  info: () => {
    const W = game.player?.weapon?.def, m = MAPS.find((x) => x.id === selectedMap) || MAPS[0];
    return {
      map: m.name, mapEn: m.en, mapId: m.id, time: fmtTime(hud.time || 0),
      kills: stats.kills, shots: stats.shots, heads: stats.heads,
      acc: stats.shots ? Math.round(stats.hits / stats.shots * 100) + '%' : '—',
      weapon: W ? W.name : '—', weaponCode: W ? `${W.code} · ${W.callsign}` : '', weaponId: W ? W.id : 'ar', tip,
      ranked: !!game.match, online: !!game.mp,
    };
  },
  onResume: () => {
    tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    if (!running) return;
    if (freeLook || TEST) setPaused(false); else lockPointer();
  },
  onRestart: () => {
    Object.assign(stats, { kills: 0, shots: 0, hits: 0, heads: 0 });
    hud.time = 0;
    game.player.spawn(game.spawnPoint);
    game.player.yaw = game.spawnYaw;
    hud.feed('训练已重置');
  },
  onLeave: () => {
    leaving = true;
    if (game.room) { net.leaveRoom(); setTimeout(() => net.close(), 300); }
    try {
      sessionStorage.setItem(RETURN_KEY, JSON.stringify({ nav: selected?.id, weapon: WEAPONS[startWeapon]?.id, map: selectedMap }));
    } catch (e) { /* 存不了就回到默认选择 */ }
    if (document.pointerLockElement) document.exitPointerLock();
    curtain('<div class="lg">弦光</div><div class="en">PRISM / LINK</div><p>正在返回大厅…</p><div class="bar"><i></i></div>');
    setTimeout(() => location.reload(), 700);
  },
  onQuit: () => {
    leaving = true;
    try { window.close(); } catch (e) { /* 浏览器里不一定允许关闭标签页 */ }
    // 打包成 PC 程序后 window.close() 会直接退出；网页里关不掉，就显示退出画面
    setTimeout(() => {
      curtain('<div class="lg">弦光</div><div class="en">PRISM / LINK</div><p>已退出游戏，感谢游玩</p><button id="esc-reenter">重新进入</button>');
      document.getElementById('esc-reenter').onclick = () => location.reload();
    }, 150);
  },
});
function curtain(html) {
  let c = document.getElementById('esc-curtain');
  if (!c) { c = document.createElement('div'); c.id = 'esc-curtain'; document.body.appendChild(c); }
  c.innerHTML = html;
  c.classList.add('on');
  requestAnimationFrame(() => c.classList.add('show'));
  menu.close();
}
// 大厅右上角的齿轮 = 打开设置
document.querySelector('#lobby .lb-res .ico:not(.mail)')?.addEventListener('click', () => menu.open('settings'));

// 设置生效：画面 / 声音 / 界面
const netEl = document.getElementById('net'), xhEl = document.getElementById('crosshair'), ddEl = document.getElementById('dmg-dirs');
let lastScale = 0;
function applyPixelRatio() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * (lastScale || 100) / 100 * autoRes);
  renderer.setSize(innerWidth, innerHeight);
  resizeComposer();
}
let blurred = false;
addEventListener('blur', () => { blurred = true; applyAudio(); });
addEventListener('focus', () => { blurred = false; applyAudio(); });
// F11：全屏 / 窗口
addEventListener('keydown', (e) => { if (e.code === 'F11') { e.preventDefault(); setFullscreen(!isFullscreen()); } });
function applyAudio() {
  const m = settings.master / 100 * (blurred && settings.muteBlur !== false ? 0 : 1);
  if (sfx.master) sfx.master.gain.value = 0.55 * m * settings.sfx / 100;
  if (uiSound.out) uiSound.out.gain.value = 0.8 * m * settings.ui / 100;
}
onSettings((st) => {
  baseFov = st.fov;
  autoResOn = st.autoRes !== false;
  if (!autoResOn) autoRes = 1;
  if (st.scale !== lastScale) {
    lastScale = st.scale;
    applyPixelRatio();
  }
  sun.castShadow = st.shadows;
  const sres = st.shadowQ === 'low' ? 1024 : 2048;
  if (sun.shadow.mapSize.x !== sres) { sun.shadow.mapSize.set(sres, sres); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  postOn = st.post;
  Wetness.reflect = st.reflect !== false;
  game.env?.setOptions({ cycle: st.cycle, dynamic: st.weather });
  netEl.style.visibility = st.showFps ? '' : 'hidden';
  xhEl.style.setProperty('--xh', XH_COLORS[st.xhColor] || '#fff');
  xhEl.style.scale = String((st.xhSize || 100) / 100);
  ddEl.style.display = st.dmgDir ? '' : 'none';
  // 技能和武器槽上显示的按键跟着键位变
  const k = (id) => keyLabel(st.keys[id][0] || st.keys[id][1], true);
  for (const [sel, id] of [['#skill-q kbd', 'bomb'], ['#skill-e kbd', 'dash'], ['#skill-c kbd', 'paper']]) { const el = document.querySelector(sel); if (el) el.textContent = k(id); }
  document.querySelectorAll('#slots .slot .k').forEach((el, i) => { el.textContent = k('w' + (i + 1)); });
  applyAudio();
});

// 从局内返回大厅：恢复之前选的角色、武器和地图
if (!TEST) {
  try {
    const r = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null');
    if (r) { sessionStorage.removeItem(RETURN_KEY); lobbyApi.restore(r); if (r.again) setTimeout(start, 300); }
  } catch (e) { /* 忽略 */ }
}

// 测试钩子：?test 自动开始，便于自动化截图
window.__game = { game, input, stats, start, step, menu, renderer, perf: () => ({ autoRes, autoResOn, rawDt, frameN, frameAcc }), select: (id) => { selected = CHARACTERS.find((c) => c.id === id) || selected; } };
if (TEST) {
  const id = params.get('char');
  if (id) window.__game.select(id);
  start();
}

requestAnimationFrame(frame);
