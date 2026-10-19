import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Builder, skyDome } from './maps.js';

// ———————————— 竞技地图：雨夜街区（4V4 团队竞技）————————————
// 日本街角的雨夜。以 z = 0 镜像：我方（薄荷）在 -Z 的车站东口，敌方（珊瑚）在 +Z 的车站西口。
//   中路：双车道大道（远距离），路口中央是施工围挡，路边停着车可以当掩体
//   两座歩道橋（z = ±18.5）横跨大道，是中距离的高点；AI 从桥下走，不上桥（nav.js 的 navUnder）
//   东侧：便利店「ことりマート」横在十字路口上，前后门对穿（近战）；再往东是电线杆密集的后街
//   西侧：路口有交番；西边是挂满灯笼的「あまね銀座商店街」
//   两边街区中间各有一条小巷（z = ±29.5）连通大道和商店街
// 素材：Asset/Scene/City 下的 KayKit City Builder Bits（楼、车、红绿灯、街道小物）、
//       Kenney City Kit Roads / Suburban / Commercial（施工路障、树、远景楼），其余日式细节都是代码画的。

const CITY = 'Asset/Scene/City/';
const JP = '"Yu Gothic UI","Yu Gothic","Meiryo","Hiragino Sans","Noto Sans CJK JP","Noto Sans JP","Microsoft YaHei",sans-serif';

const KIT = [
  ...'ABCDEFGH'.split('').map((c) => [`b${c}`, `KayKit/building_${c}_withoutBase.gltf`, 5]),
  ['taxi', 'KayKit/car_taxi.gltf', 5], ['sedan', 'KayKit/car_sedan.gltf', 5], ['hatch', 'KayKit/car_hatchback.gltf', 5],
  ['police', 'KayKit/car_police.gltf', 5], ['wagon', 'KayKit/car_stationwagon.gltf', 5],
  ['signal', 'KayKit/trafficlight_C.gltf', 5], ['bench', 'KayKit/bench.gltf', 5], ['dumpster', 'KayKit/dumpster.gltf', 5],
  ['boxA', 'KayKit/box_A.gltf', 5], ['boxB', 'KayKit/box_B.gltf', 5], ['hydrant', 'KayKit/firehydrant.gltf', 5],
  ['trashA', 'KayKit/trash_A.gltf', 5], ['trashB', 'KayKit/trash_B.gltf', 5], ['bush', 'KayKit/bush.gltf', 5], ['tank', 'KayKit/watertower.gltf', 5],
  ['cone', 'Roads/construction-cone.glb', 8], ['barrier', 'Roads/construction-barrier.glb', 8], ['clight', 'Roads/construction-light.glb', 8],
  ['tree', 'Suburban/tree-large.glb', 9], ['treeS', 'Suburban/tree-small.glb', 9],
  ...'abcde'.split('').map((c) => [`sky${c}`, `Commercial/building-skyscraper-${c}.glb`, 8]),
  ...'abcdefghijklmn'.split('').map((c) => [`low${c}`, `Commercial/low-detail-building-${c}.glb`, 8]),
];

async function loadKit(loader, gradient) {
  const out = {}, mats = new Map();
  const toon = (m) => {
    if (!mats.has(m.uuid)) mats.set(m.uuid, new THREE.MeshToonMaterial({ map: m.map, color: m.color, gradientMap: gradient, side: m.side }));
    return mats.get(m.uuid);
  };
  await Promise.all(KIT.map(async ([key, path, sc]) => {
    try {
      const g = await loader.loadAsync(CITY + path);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.material = Array.isArray(o.material) ? o.material.map(toon) : toon(o.material);
        o.castShadow = o.receiveShadow = true;
      });
      g.scene.userData.kitScale = sc;
      out[key] = g.scene;
    } catch (e) { console.warn('城市素材加载失败', path, e); }
  }));
  return out;
}

// ———————————— 画布贴图 ————————————
function canvasTex(w, h, draw, { repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);

function asphaltTex() {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#4a4e57'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '20,22,28' : '120,125,135'},${rnd(0.05, 0.22)})`; x.fillRect(Math.random() * w, Math.random() * h, rnd(1, 3), rnd(1, 3)); }
    // 补过的沥青块
    for (let i = 0; i < 3; i++) { x.fillStyle = 'rgba(30,32,38,.25)'; x.fillRect(rnd(0, w), rnd(0, h), rnd(30, 90), rnd(20, 60)); }
  }, { repeat: true });
}
function pavingTex() {
  return canvasTex(256, 256, (x, w, h) => {
    const cols = ['#8d8480', '#9a908a', '#7f7774', '#a39a92'];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) {
      x.fillStyle = cols[(i * 7 + j * 3) % 4]; const off = (j % 2) * 32;
      x.fillRect(i * 64 + off - 64, j * 32, 64, 32); x.fillRect(i * 64 + off, j * 32, 64, 32);
    }
    x.strokeStyle = 'rgba(40,36,34,.55)'; x.lineWidth = 2;
    for (let j = 0; j <= 8; j++) { x.beginPath(); x.moveTo(0, j * 32); x.lineTo(w, j * 32); x.stroke(); for (let i = 0; i <= 4; i++) { const xx = i * 64 + (j % 2) * 32; x.beginPath(); x.moveTo(xx, j * 32); x.lineTo(xx, j * 32 + 32); x.stroke(); } }
  }, { repeat: true });
}
function sidewalkTex() {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#a9adb3'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(80,85,95,${rnd(0.04, 0.12)})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    x.strokeStyle = 'rgba(70,74,82,.5)'; x.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, h); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(w, i * 64); x.stroke(); }
  }, { repeat: true });
}

// 竖排文字招牌（日本街头的縦看板）
function verticalSign(text, bg, fg, { sub = '', border = fg } = {}) {
  const n = [...text].length;
  return canvasTex(96, 64 + n * 76, (x, w, h) => {
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.strokeStyle = border; x.lineWidth = 5; x.strokeRect(6, 6, w - 12, h - 12);
    x.fillStyle = fg; x.font = `900 64px ${JP}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    [...text].forEach((ch, i) => x.fillText(ch, w / 2, 48 + i * 76));
    if (sub) { x.font = `700 14px ${JP}`; x.fillText(sub, w / 2, h - 18); }
  });
}
function hSign(lines, bg, fg, w = 512, h = 128, { stripe = null } = {}) {
  return canvasTex(w, h, (x) => {
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    if (stripe) stripe(x, w, h);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    lines.forEach(([t, size, y, col]) => { x.fillStyle = col || fg; x.font = `900 ${size}px ${JP}`; x.fillText(t, w / 2, y); });
  });
}
// 自动贩卖机正面
function vendingTex(body) {
  return canvasTex(128, 240, (x, w, h) => {
    x.fillStyle = body; x.fillRect(0, 0, w, h);
    x.fillStyle = '#f4f8ff'; x.fillRect(8, 10, w - 16, 132);
    const drinks = ['#2b6cff', '#ff5a3c', '#2fbf71', '#ffd23f', '#8e5cff', '#ff8fb1', '#1fb5c9', '#ffffff', '#c0392b', '#3d3d3d', '#ffa62b', '#5bc0eb'];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const px = 14 + c * 27, py = 16 + r * 42;
      x.fillStyle = drinks[(r * 4 + c + body.length) % drinks.length]; x.fillRect(px + 4, py, 15, 28); x.fillRect(px + 7, py - 4, 9, 5);
      x.fillStyle = '#ffffff'; x.fillRect(px + 6, py + 9, 11, 8);
      x.fillStyle = r === 2 ? '#e53935' : '#1e88e5'; x.fillRect(px, py + 31, 23, 6);
    }
    x.font = `700 9px ${JP}`; x.textAlign = 'center'; x.fillStyle = '#fff';
    x.fillText('つめた〜い', 40, 137); x.fillStyle = '#ffdddd'; x.fillText('あったか〜い', 92, 137);
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(8, 150, w - 16, 40);
    x.fillStyle = '#fff'; x.font = `900 15px ${JP}`; x.fillText('冷たい飲み物', w / 2, 175);
    x.fillStyle = '#222'; x.fillRect(84, 198, 30, 12); x.fillRect(14, 214, w - 28, 18);
    x.fillStyle = '#7fff7f'; x.fillRect(88, 201, 22, 6);
  });
}
function lanternTex() {
  return canvasTex(128, 128, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ff7a3c'); g.addColorStop(0.5, '#ffd28a'); g.addColorStop(1, '#ff7a3c');
    x.fillStyle = '#e8432f'; x.fillRect(0, 0, w, h); x.fillStyle = g; x.globalAlpha = 0.55; x.fillRect(0, 0, w, h); x.globalAlpha = 1;
    x.strokeStyle = 'rgba(120,20,10,.5)'; x.lineWidth = 2;
    for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo(0, i * 16); x.lineTo(w, i * 16); x.stroke(); }
    x.fillStyle = '#1a0d08'; x.font = `900 46px ${JP}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('祭', w * 0.25, h / 2); x.fillText('祭', w * 0.75, h / 2);
  });
}
function windowsTex(seed) {
  return canvasTex(128, 256, (x, w, h) => {
    x.fillStyle = '#1b2030'; x.fillRect(0, 0, w, h);
    for (let r = 0; r < 20; r++) for (let c = 0; c < 6; c++) {
      const on = Math.random() < 0.38;
      x.fillStyle = on ? (Math.random() < 0.75 ? `hsl(${38 + Math.random() * 12},90%,${62 + Math.random() * 18}%)` : '#cfe4ff') : '#262d40';
      x.fillRect(6 + c * 20, 6 + r * 12.5, 13, 7);
    }
    void seed;
  });
}
// 路面标字：文字朝 +V 方向（贴图上方 = 车开过去的方向）
// 日本的路面标字是横着写、纵向拉长的，站在车里从近往远看也是从左往右读
function roadText(text, w = 512, h = 384) {
  const n = [...text].length;
  return canvasTex(w, h, (x) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#f3f3ee'; x.font = `900 ${Math.min(150, (w / n) * 0.92)}px ${JP}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.save(); x.scale(1, 2.3);
    [...text].forEach((ch, i) => x.fillText(ch, (w * (i + 0.5)) / n, h / 2 / 2.3));
    x.restore();
  });
}
function zebraTex() {
  return canvasTex(256, 64, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.fillStyle = '#f3f3ee';
    for (let i = 0; i < 8; i++) x.fillRect(i * 32 + 4, 0, 18, h);
  });
}
function manholeTex() {
  return canvasTex(128, 128, (x, w) => {
    x.fillStyle = '#5b5550'; x.beginPath(); x.arc(64, 64, 62, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#3a3532'; x.lineWidth = 4; x.beginPath(); x.arc(64, 64, 56, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = '#7a726b'; x.lineWidth = 3;
    for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(64 + Math.cos(i) * 22, 64 + Math.sin(i * 1.3) * 22, 14, 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = '#8a8178'; x.font = `900 22px ${JP}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('雨水', w / 2, 64);
  });
}
function constructionTex() {
  return canvasTex(512, 224, (x, w, h) => {
    x.fillStyle = '#f2f2ee'; x.fillRect(0, 0, w, h);
    for (let i = -4; i < 30; i++) { x.fillStyle = i % 2 ? '#1b1b1b' : '#ffc400'; x.beginPath(); x.moveTo(i * 24, 0); x.lineTo(i * 24 + 24, 0); x.lineTo(i * 24 - 6, 34); x.lineTo(i * 24 - 30, 34); x.fill(); x.beginPath(); x.moveTo(i * 24, h - 34); x.lineTo(i * 24 + 24, h - 34); x.lineTo(i * 24 - 6, h); x.lineTo(i * 24 - 30, h); x.fill(); }
    x.fillStyle = '#d81b1b'; x.font = `900 76px ${JP}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('工事中', w / 2, 92);
    x.fillStyle = '#1b3b8a'; x.font = `700 24px ${JP}`; x.fillText('ご迷惑をおかけします', w / 2, 152);
  });
}
function posterTex(i) {
  const P = [['雨の日セール', '#ff6f91', '#fff'], ['夜カフェ', '#3d2c8d', '#ffe082'], ['新発売', '#00a6a6', '#fff']][i % 3];
  return canvasTex(256, 160, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, P[1]); g.addColorStop(1, '#141824');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = P[2]; x.font = `900 40px ${JP}`; x.textAlign = 'center'; x.fillText(P[0], w / 2, 82);
    x.font = `700 16px ${JP}`; x.fillText('あまね駅前 · 21:00 まで', w / 2, 124);
  });
}

// 提灯的外形（绕 Y 轴旋转出来）
function lanternGeo() {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10, y = (t - 0.5) * 0.62; pts.push(new THREE.Vector2(0.06 + Math.sin(t * Math.PI) * 0.2, y)); }
  return new THREE.LatheGeometry(pts, 12);
}
// 悬链线：两点之间垂下 sag 米
function catenary(a, b, sag, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0))); }
  return out;
}

export async function buildRainStreet(gradient, { loader }) {
  const B = new Builder(gradient);
  const kit = await loadKit(loader, gradient);
  const toon = (o) => new THREE.MeshToonMaterial({ gradientMap: gradient, ...o });
  const glowMats = [], lamps = [], lampMats = [];
  // 发光招牌：夜里 env.js 会再调亮到 2～3 倍，所以底数要低；indoor = 室内灯，不跟着天色变
  const glow = (map, i = 0.24, extra = {}, indoor = false) => { const m = toon({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: i, ...extra }); if (!indoor) glowMats.push(m); return m; };

  // 地面材质
  Object.assign(B.M, {
    asphalt: toon({ map: asphaltTex() }),
    paving: toon({ map: pavingTex() }),
    walk: toon({ map: sidewalkTex() }),
    curb: toon({ color: 0x9ea2a8 }),
    concrete: toon({ color: 0x8f949b }),
    wall: toon({ color: 0xd9d2c5 }),
    shopWall: toon({ color: 0xb9bec4 }),
    wallDark: toon({ color: 0x5a5f6b }),
    bridge: toon({ color: 0x5f86a3 }),
    bridgeDark: toon({ color: 0x3f5c73 }),
    white: toon({ color: 0xf1f1ee }),
    pole: toon({ color: 0x9c9a94 }),
    metal: toon({ color: 0x3a3f48 }),
    glassStore: new THREE.MeshBasicMaterial({ color: 0xcff6ff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
  });
  const edgeMat = B.M.edge;

  // 放一个素材模型。sc 不填就用素材包的默认缩放（让各家的比例统一）；sx/sy/sz 是额外的拉伸
  const place = (name, x, z, { ry = 0, sc, sx = 1, sy = 1, sz = 1, solid = true, y = 0, edges = solid } = {}) => {
    const src = kit[name];
    if (!src) return null;
    const o = src.clone();
    const k = sc ?? src.userData.kitScale ?? 1;
    o.position.set(x, y, z); o.rotation.y = ry; o.scale.set(k * sx, k * sy, k * sz);
    if (edges) o.traverse((m) => { if (m.isMesh) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 35), edgeMat)); });
    (solid ? B.solid : B.decor).add(o);
    return o;
  };
  // 不参与碰撞的发光方块（招牌、灯箱）。front 贴图只贴前后两面，其他面用 side 材质
  const panel = (w, h, d, x, y, z, ry, frontMat, sideMat = B.M.metal, { solid = false, back = true } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sideMat, sideMat, sideMat, sideMat, frontMat, back ? frontMat : sideMat]);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = false; m.receiveShadow = true;
    (solid ? B.solid : B.decor).add(m);
    return m;
  };
  // 地面贴花（路面标线、斑马线、井盖）
  const decal = (tex, w, d, x, z, ry = 0, y = 0.012, opacity = 0.92) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), toon({ map: tex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.rotation.set(-Math.PI / 2, ry, 0, 'YXZ'); // 先放平，再绕 Y 转：贴图上方朝 (-sin ry, -cos ry)
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.userData.noInk = true;
    B.decor.add(m);
    return m;
  };
  // 夜里会亮的点光源（白天几乎关掉，由 env.js 根据天色调亮度）
  const lamp = (x, y, z, color, base, dist = 14) => {
    const l = new THREE.PointLight(color, base, dist, 1.6);
    l.position.set(x, y, z);
    B.decor.add(l);
    lamps.push({ light: l, base });
    return l;
  };
  // 雨夜里的光锥（加法混合的半透明圆锥）
  const coneFade = canvasTex(4, 64, (x) => { const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, '#000'); g.addColorStop(0.75, '#776040'); g.addColorStop(1, '#fff0d0'); x.fillStyle = g; x.fillRect(0, 0, 4, 64); });
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, map: coneFade, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
  lampMats.push({ mat: coneMat, base: 0.12 });
  const lightCone = (x, y, z, r = 2.4, h = y) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 20, 1, true), coneMat);
    c.position.set(x, y - h / 2, z);
    c.userData.noInk = true; c.userData.noMinimap = true;
    B.decor.add(c);
  };

  // ———— 地面 ————（所有地面顶面都在 y = 0，积水倒影才能连成一片）
  const floor = (x1, x2, z1, z2, mat) => B.box(x2 - x1, 1, z2 - z1, (x1 + x2) / 2, -0.5, (z1 + z2) / 2, mat, { edges: false, uvScale: 6 });
  floor(-6, 6, -37, 37, 'asphalt');                 // 大道
  floor(-19, -6, -8, 8, 'asphalt');                 // 西侧横街
  for (const s of [-1, 1]) floor(-19, -6, s < 0 ? -37 : 8, s < 0 ? -8 : 37, 'asphalt'); // 西街区（楼脚下 + 小巷）
  floor(6, 19, -37, 37, 'asphalt');                 // 东街区（便利店、小巷）
  floor(-27, -19, -37, 37, 'paving');               // 西：商店街
  floor(19, 27, -37, 37, 'paving');                 // 东：后街
  floor(-38, -27, -56, 56, 'asphalt'); floor(27, 38, -56, 56, 'asphalt');
  for (const s of [-1, 1]) floor(-27, 27, s < 0 ? -56 : 37, s < 0 ? -37 : 56, 'paving'); // 两边车站前广场
  B.box(80, 3, 116, 0, -2.6, 0, 'concrete', { solid: false, edges: false });

  // 人行道：比路面高 15 厘米
  const walk = (x1, x2, z1, z2) => {
    B.box(x2 - x1, 0.15, z2 - z1, (x1 + x2) / 2, 0.075, (z1 + z2) / 2, 'walk', { edges: false, uvScale: 3 });
    B.box(x2 - x1 + 0.04, 0.02, 0.18, (x1 + x2) / 2, 0.16, z1 + 0.09, 'curb', { solid: false, edges: false, shadow: false });
    B.box(x2 - x1 + 0.04, 0.02, 0.18, (x1 + x2) / 2, 0.16, z2 - 0.09, 'curb', { solid: false, edges: false, shadow: false });
  };
  for (const s of [-1, 1]) {
    const [a, b] = s < 0 ? [-37, -10] : [10, 37];
    walk(6, 9, a, b); walk(-9, -6, a, b);
  }
  walk(6, 9, -6, 6); // 便利店门口

  // ———— 路面标线 ————
  const lineMat = toon({ color: 0xf3f3ee, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const yellowMat = toon({ color: 0xf2b632, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const lines = [], yellows = [];
  const strip = (arr, w, d, x, z) => { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(x, 0.011, z); arr.push(g); };
  for (const s of [-1, 1]) {
    // 大道：中间黄色实线（禁止超车），两侧白色车道边线
    strip(yellows, 0.15, 26, -0.12, s * 24); strip(yellows, 0.15, 26, 0.12, s * 24);
    strip(lines, 0.15, 27, -5.6, s * 23.5); strip(lines, 0.15, 27, 5.6, s * 23.5);
    // 停止线（日本靠左行驶：往路口开的车道在 x 的哪一侧取决于方向）
    strip(lines, 5.5, 0.45, s * 2.9, s * 10.6);
    for (let z = 38; z < 52; z += 3) strip(lines, 0.15, 1.6, 0, s * z);
  }
  strip(yellows, 7, 0.15, -15, 0);
  strip(lines, 0.45, 7, -11.6, -3.8);
  B.decor.add(new THREE.Mesh(mergeGeometries(lines), lineMat), new THREE.Mesh(mergeGeometries(yellows), yellowMat));
  const zebra = zebraTex();
  for (const s of [-1, 1]) {
    decal(zebra, 12, 3, 0, s * 8.6, 0);                 // 横穿大道的斑马线
    // 「止まれ」：朝着开向路口的车，文字上方朝路口
    decal(roadText('止まれ'), 4.6, 3.4, s * 2.9, s * 13.4, s > 0 ? 0 : Math.PI);
    decal(roadText('◇'), 2.2, 2.6, s * 2.9, s * 26, s > 0 ? 0 : Math.PI, 0.012, 0.8);
  }
  decal(zebra, 15, 3, -9.6, 0, Math.PI / 2);            // 横穿西侧横街
  decal(roadText('止まれ'), 4.6, 3.4, -14.2, -4.4, -Math.PI / 2);
  decal(roadText('通学路'), 4.4, 3.2, 23, -24, Math.PI, 0.012, 0.75); decal(roadText('通学路'), 4.4, 3.2, 23, 24, 0, 0.012, 0.75);
  const mh = manholeTex();
  for (const [x, z] of [[-3, 5.5], [3, -5.5], [-2.5, 27], [2.5, -27], [-22, 9], [23, -11], [-14, 32], [14, -32]]) decal(mh, 1.1, 1.1, x, z, Math.random() * 6, 0.013, 1);

  // ———— 施工围挡（路口正中，挡住两边基地之间的直线视野）————
  const cons = constructionTex();
  const consMat = toon({ map: cons });
  for (const [x, z, ry] of [[0, -2.6, 0], [0, 2.6, Math.PI], [-2.6, 0, -Math.PI / 2], [2.6, 0, Math.PI / 2]]) panel(5.2, 2.3, 0.18, x, 1.15, z, ry, consMat, B.M.white, { solid: true });
  for (const [x, z] of [[-3.4, -3.4], [3.4, 3.4], [-3.4, 3.4], [3.4, -3.4]]) { place('cone', x, z, { solid: false }); place('clight', x * 0.82, z * 1.1, { solid: false, ry: Math.random() }); }
  const warn = toon({ color: 0xff3d00, emissive: 0xff3d00, emissiveIntensity: 1.2 }); glowMats.push(warn);
  for (const [x, z] of [[-2.6, -2.6], [2.6, 2.6], [-2.6, 2.6], [2.6, -2.6]]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), warn); b.position.set(x, 2.45, z); B.decor.add(b); }
  place('barrier', -4.6, -1, { ry: Math.PI / 2 }); place('barrier', 4.6, 1, { ry: Math.PI / 2 });

  // ———— 建筑 ————
  // KayKit 的楼占地 10×10（缩放 5），正面朝自己的 +Z；ry 让正面朝街
  const bnames = ['bA', 'bB', 'bC', 'bD', 'bE', 'bF', 'bG', 'bH'];
  let bi = 0;
  const building = (x, z, faceX, { lenZ = 10, name } = {}) => {
    const n = name || bnames[bi++ % bnames.length];
    return place(n, x, z, { ry: faceX > 0 ? Math.PI / 2 : -Math.PI / 2, sx: lenZ / 10 });
  };
  for (const s of [-1, 1]) {
    // 外圈：东西两排楼，正面朝商店街 / 后街
    for (const z of [5, 15, 25, 35]) { building(-32, s * z, 1); building(32, s * z, -1); }
    // 西街区：两栋 + 小巷 + 一栋窄楼
    building(-14, s * 13, -1); building(-14, s * 23, 1); building(-14, s * 34, -1, { lenZ: 6 });
    // 东街区（便利店北/南）
    building(14, s * 13, 1); building(14, s * 23, -1); building(14, s * 34, 1, { lenZ: 6 });
    // 车站前广场两侧的高楼
    place(s < 0 ? 'lown' : 'lowj', -32.5, s * 47, { sc: 5.2, ry: Math.PI / 2 });
    place(s < 0 ? 'lowj' : 'lown', 32.5, s * 47, { sc: 5.2, ry: -Math.PI / 2 });
    // 屋顶水箱（装饰）
    place('tank', -31, s * 15, { y: 14.6, solid: false }); place('tank', 33, s * 25, { y: 14.6, solid: false });
  }

  // ———— 车站（两边基地的背景）————
  for (const s of [-1, 1]) {
    const zc = s * 56;
    B.box(56, 9, 6, 0, 4.5, zc, 'wall');
    B.box(56.4, 0.6, 6.4, 0, 9.3, zc, 'wallDark');
    B.box(20, 3.2, 0.3, 0, 1.6, zc - s * 3.1, 'wallDark', { solid: false, edges: false });
    const name = s < 0 ? ['雨音駅 東口', 'AMANE STA. EAST EXIT'] : ['雨音駅 西口', 'AMANE STA. WEST EXIT'];
    const sign = glow(hSign([[name[0], 64, 52], [name[1], 22, 104, '#bfe9ff']], '#14365c', '#ffffff', 512, 128), 0.35);
    panel(12, 3, 0.25, 0, 6.6, zc - s * 3.2, s < 0 ? 0 : Math.PI, sign, B.M.metal, { back: false });
    lamp(0, 6, zc - s * 6, 0xbfe0ff, 5, 22);
    // 车站前的屏风：公交站台（挡住出生点的远距离视野）
    const ad = glow(posterTex(s < 0 ? 0 : 1), 0.18);
    panel(10, 2.6, 0.3, 0, 1.3, s * 39.5, s < 0 ? Math.PI : 0, ad, B.M.metal, { solid: true });
    B.box(10.6, 0.15, 2.4, 0, 2.9, s * 40.2, 'metal', { solid: false });
    for (const x of [-5, 5]) B.box(0.12, 2.9, 0.12, x, 1.45, s * 41.2, 'metal', { solid: false, edges: false });
    place('bench', -2, s * 40.4, { ry: s < 0 ? Math.PI : 0, solid: false }); place('bench', 2, s * 40.4, { ry: s < 0 ? Math.PI : 0, solid: false });
    // 出租车等候处 + 树
    place('taxi', 15, s * 44, { ry: 0.1 }); place('taxi', -16, s * 45.5, { ry: -0.08 });
    for (const x of [-10, 10, -22, 22]) { B.box(2.2, 0.6, 2.2, x, 0.3, s * 43 + (Math.abs(x) > 15 ? s * 6 : 0), 'concrete'); place('tree', x, s * 43 + (Math.abs(x) > 15 ? s * 6 : 0), { y: 0.6, solid: false }); }
    lamp(-12, 5, s * 46, 0xffc98a, 6, 16);
  }

  // ———— 歩道橋（z = ±18.5，横跨大道）————
  const navUnder = [];
  const bridgeSign = glow(hSign([['雨音歩道橋', 52, 50], ['AMANE FOOTBRIDGE', 18, 100, '#d6f1ff']], '#1f4f8a', '#ffffff', 512, 128), 0.3);
  for (const s of [-1, 1]) {
    const zc = s * 18.5, top = 4.8, z1 = zc - 1.5, z2 = zc + 1.5;
    B.box(17.6, 0.4, 3, 0, top - 0.2, zc, 'bridge');
    B.box(17.7, 0.12, 3.1, 0, top - 0.42, zc, 'bridgeDark', { solid: false, edges: false });
    // 栏杆：靠中间那侧整段；靠楼梯那侧只在两段楼梯之间
    const inner = s > 0 ? z1 : z2, outer = s > 0 ? z2 : z1;
    B.box(17.6, 1.1, 0.12, 0, top + 0.55, inner + s * 0.06, 'bridge');
    B.box(12.4, 1.1, 0.12, 0, top + 0.55, outer - s * 0.06, 'bridge');
    for (const x of [-8.74, 8.74]) B.box(0.12, 1.1, 3, x, top + 0.55, zc, 'bridge');
    panel(5.2, 1.3, 0.12, 0, top - 1.0, inner - s * 0.02, s > 0 ? Math.PI : 0, bridgeSign, B.M.bridgeDark, { back: false });
    panel(5.2, 1.3, 0.12, 0, top - 1.0, outer + s * 0.02, s > 0 ? 0 : Math.PI, bridgeSign, B.M.bridgeDark, { back: false });
    for (const x of [-5.6, 5.6]) for (const dz of [-1, 1]) B.box(0.45, top - 0.4, 0.45, x, (top - 0.4) / 2, zc + dz, 'bridgeDark');
    // 两头的楼梯：在人行道上，朝路口方向往上爬
    for (const x of [-7.5, 7.5]) {
      B.stairs(x, 0.15, s * 27.6, s > 0 ? '-z' : '+z', 15, { w: 2.6, rise: (top - 0.15) / 15, run: 0.5, mat: 'bridge' });
      for (const o of [-1.36, 1.36]) {
        const len = Math.hypot(7.5, top), ang = Math.atan2(top, 7.5);
        B.box(0.08, 0.08, len, x + o, top / 2 + 1.0, s * 23.85, 'metal', { solid: false, rx: s * ang, edges: false });
      }
    }
    navUnder.push(new THREE.Box3(new THREE.Vector3(-8.9, top - 0.45, Math.min(z1, z2) - 0.1), new THREE.Vector3(8.9, top + 1.2, Math.max(z1, z2) + 0.1)));
  }

  // ———— 便利店「ことりマート」（东侧，横在十字路口上，前后门对穿）————
  {
    const x1 = 9, x2 = 19, z1 = -6, z2 = 6, H = 3.6, T = 0.3;
    B.box(x2 - x1, 0.15, z2 - z1, (x1 + x2) / 2, 0.075, 0, 'shopWall', { edges: false });
    // 侧墙
    for (const z of [z1, z2]) B.box(x2 - x1, H, T, (x1 + x2) / 2, H / 2, z + (z < 0 ? T / 2 : -T / 2), 'shopWall');
    // 正面（朝大道）：落地玻璃 + 中间自动门
    for (const [za, zb] of [[z1, -1.4], [1.4, z2]]) {
      B.box(0.12, H - 0.9, zb - za, x1 + 0.1, (H - 0.9) / 2 + 0.15, (za + zb) / 2, 'glassStore', { edges: false, shadow: false });
      B.box(0.3, 0.55, zb - za, x1 + 0.15, 0.3, (za + zb) / 2, 'white');
    }
    // 背面（朝后街）：员工门 + 墙
    for (const [za, zb] of [[z1, -1.2], [1.2, z2]]) B.box(T, H, zb - za, x2 - T / 2, H / 2, (za + zb) / 2, 'wall');
    B.box(T, H - 2.5, 2.4, x2 - T / 2, 2.5 + (H - 2.5) / 2, 0, 'wall');
    B.box(T + 0.02, H - 2.5, 2.8, x1 + 0.15, 2.5 + (H - 2.5) / 2, 0, 'white');
    // 屋顶（AI 当它不存在，从里面走）
    B.box(x2 - x1 + 0.6, 0.4, z2 - z1 + 0.6, (x1 + x2) / 2, H + 0.2, 0, 'white');
    navUnder.push(new THREE.Box3(new THREE.Vector3(x1 - 0.5, H - 0.05, z1 - 0.5), new THREE.Vector3(x2 + 0.5, H + 2, z2 + 0.5)));
    // 招牌：彩色条纹 + 店名 + 24H
    const fascia = glow(hSign([['ことりマート', 70, 62, '#1f6e5c'], ['KOTORI MART · 24H OPEN', 24, 110, '#ff7a1a']], '#ffffff', '#1f6e5c', 768, 136, {
      stripe: (x, w) => { x.fillStyle = '#2fbf8f'; x.fillRect(0, 0, w, 14); x.fillStyle = '#ffffff'; x.fillRect(0, 14, w, 6); x.fillStyle = '#ff8a1f'; x.fillRect(0, 20, w, 10); },
    }), 0.1, { color: 0xb0b0b0 });
    panel(12.6, 1.0, 0.3, x1 - 0.5, H + 0.15, 0, -Math.PI / 2, fascia, B.M.white, { back: false });
    const h24 = glow(hSign([['24H', 80, 70, '#ffffff']], '#ff7a1a', '#fff', 256, 140), 0.35);
    panel(1.6, 0.9, 0.2, x2 + 0.3, 3.0, 0, Math.PI / 2, h24);
    // 店里：两排货架（能挡子弹，可以隔着货架对枪）、收银台、冰柜
    const shelf = toon({ color: 0xe7ecef });
    const goods = glow(canvasTex(256, 64, (x, w, h) => { for (let i = 0; i < 26; i++) { x.fillStyle = `hsl(${Math.random() * 360},70%,${45 + Math.random() * 25}%)`; x.fillRect(i * 10, Math.random() * 16, 8, h); } }), 0.08, {}, true);
    for (const z of [-2.6, 2.6]) {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(5, 1.45, 1.1), [shelf, shelf, shelf, shelf, goods, goods]);
      sh.position.set(14.2, 0.15 + 0.725, z); sh.castShadow = sh.receiveShadow = true;
      B.solid.add(sh);
    }
    B.box(1.2, 1.05, 3.2, 11, 0.675, -4.1, 'wallDark');
    B.box(1.25, 0.06, 3.25, 11, 1.23, -4.1, 'white', { solid: false, edges: false });
    const fridge = glow(canvasTex(256, 128, (x, w, h) => { x.fillStyle = '#d9f4ff'; x.fillRect(0, 0, w, h); for (let r = 0; r < 4; r++) for (let c = 0; c < 16; c++) { x.fillStyle = `hsl(${(c * 37 + r * 90) % 360},70%,55%)`; x.fillRect(4 + c * 16, 6 + r * 31, 10, 24); } x.fillStyle = 'rgba(255,255,255,.4)'; for (let c = 0; c < 4; c++) x.fillRect(c * 64, 0, 3, h); }), 0.22, {}, true);
    panel(7, 2.0, 0.6, 18.5, 1.15, 0.6, -Math.PI / 2, fridge, B.M.white, { solid: true, back: false });
    const ceil = toon({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35 });
    for (const z of [-3, 0, 3]) { const p = new THREE.Mesh(new THREE.BoxGeometry(7, 0.06, 0.4), ceil); p.position.set(14, H - 0.04, z); B.decor.add(p); }
    lamp(14, 2.2, 0, 0xeaf6ff, 1.6, 12);
    lamp(5.6, 1.8, 0, 0xfff1d0, 1.6, 8);
    // 门口：自动贩卖机两台、垃圾桶、伞架
  }

  // 自动贩卖机：ry 让正面朝外
  const vendBodies = ['#d6262e', '#1e5bb8', '#f5f5f5', '#2c9a5a', '#222831'];
  const vending = (x, z, ry, k = 0) => {
    const tex = glow(vendingTex(vendBodies[k % vendBodies.length]), 0.17);
    const body = toon({ color: new THREE.Color(vendBodies[k % vendBodies.length]) });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.85, 0.75), [body, body, body, body, tex, body]);
    m.position.set(x, 0.925, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true;
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat));
    B.solid.add(m);
  };
  vending(8.2, -4.6, -Math.PI / 2, 0); vending(8.2, 4.6, -Math.PI / 2, 1);
  for (const s of [-1, 1]) {
    vending(-26.4, s * 19.5, Math.PI / 2, 2); vending(-26.4, s * 20.6, Math.PI / 2, 3);
    vending(26.4, s * 9.5, -Math.PI / 2, 4); vending(18.6, s * 30.6, -Math.PI / 2, 0);
    vending(-8.6, s * 33.5, Math.PI / 2, 1);
  }

  // ———— 交番（西侧横街）————
  {
    const x = -14.5;
    B.box(4.2, 3.2, 4.2, x, 1.6, 0, 'wall');
    B.box(4.6, 0.3, 4.6, x, 3.35, 0, 'wallDark');
    const kb = glow(hSign([['交番', 64, 50], ['KOBAN', 22, 102, '#ffe0e0']], '#f2f2f2', '#16233f', 256, 128), 0.12);
    panel(2.2, 1.0, 0.1, x + 2.16, 2.6, 0, Math.PI / 2, kb, B.M.white, { back: false });
    const red = toon({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 1.6 }); glowMats.push(red);
    const rl = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), red); rl.position.set(x + 2.3, 3.4, 0); B.decor.add(rl);
    lamp(x + 2.6, 3.2, 0, 0xff4a4a, 3, 8);
    place('police', -12, -5.2, { ry: Math.PI / 2 + 0.15 });
    place('sedan', -16.5, 5.4, { ry: -Math.PI / 2 - 0.1 });
  }

  // ———— 大道上的车（掩体）、红绿灯 ————
  for (const s of [-1, 1]) {
    place(s < 0 ? 'taxi' : 'wagon', 4.4, s * 13.5, { ry: s < 0 ? Math.PI : 0 });
    place('sedan', -2.4, s * 22.5, { ry: (s < 0 ? 0 : Math.PI) + 0.12 });
    place(s < 0 ? 'hatch' : 'taxi', -4.4, s * 31, { ry: s < 0 ? 0 : Math.PI });
    place('hatch', 2.6, s * 33.5, { ry: (s < 0 ? Math.PI : 0) - 0.2 });
    // 红绿灯（悬臂伸向路口）
    place('signal', s * 6.6, s * 10.2, { ry: s < 0 ? 0 : Math.PI, solid: false });
    place('hydrant', 6.6, s * 16, { solid: false }); place('hydrant', -6.6, s * 35.5, { solid: false });
  }
  place('signal', -6.6, 8.4, { ry: -Math.PI / 2, solid: false });

  // ———— 路灯：暖黄色，钠灯颜色 ————
  const lampHead = toon({ color: 0xfff1c9, emissive: 0xffc46b, emissiveIntensity: 0.6 }); glowMats.push(lampHead);
  const streetLamp = (x, z, dir, withLight = true) => {
    B.box(0.18, 5.6, 0.18, x, 2.8, z, 'pole', { edges: false });
    B.box(1.6, 0.12, 0.12, x + dir * 0.8, 5.55, z, 'pole', { solid: false, edges: false });
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.32), lampHead); h.position.set(x + dir * 1.5, 5.45, z); B.decor.add(h);
    if (withLight) { lamp(x + dir * 1.5, 5.1, z, 0xffbf73, 10, 16); lightCone(x + dir * 1.5, 5.4, z, 2.3, 5.4); }
  };
  for (const s of [-1, 1]) {
    streetLamp(8.6, s * 12, -1); streetLamp(-8.6, s * 30, 1);
    streetLamp(8.6, s * 33, -1, false); streetLamp(-8.6, s * 12, 1, false);
    streetLamp(-18.6, s * 5.5, 1, s > 0);
  }

  // ———— 电线杆 + 电线 ————
  const wires = [];
  const poleTop = [];
  const utilityPole = (x, z, armDir = 1) => {
    B.box(0.32, 9, 0.32, x, 4.5, z, 'pole');
    B.box(0.34, 1.6, 0.34, x, 0.8, z, 'curb', { solid: false, edges: false });
    const stripes = toon({ map: canvasTex(32, 128, (c) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#111' : '#ffd400'; c.fillRect(0, i * 16, 32, 16); } }) });
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.4, 0.36), stripes); g.position.set(x, 0.9, z); B.decor.add(g);
    B.box(0.12, 0.12, 2.2, x, 8.4, z, 'metal', { solid: false, edges: false });
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), B.M.concrete); tr.position.set(x + armDir * 0.45, 7.2, z); B.decor.add(tr);
    poleTop.push(new THREE.Vector3(x, 8.4, z));
    return [new THREE.Vector3(x, 8.4, z - 1), new THREE.Vector3(x, 8.4, z + 1), new THREE.Vector3(x, 8.0, z)];
  };
  const chain = (pts) => { for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 3; k++) { const c = catenary(pts[i][k], pts[i + 1][k], 0.55 + k * 0.15); for (let j = 0; j < c.length - 1; j++) wires.push(c[j], c[j + 1]); } };
  chain([-34, -24, -14, -4, 6, 16, 26, 34].map((z) => utilityPole(26.5, z, -1)));
  for (const s of [-1, 1]) chain([4, 14].map((z) => utilityPole(-26.6, s * z, 1)));
  // 横过后街、连到楼上的电线
  for (const p of poleTop.slice(0, 8)) { const c = catenary(p, new THREE.Vector3(19.2, 7.2, p.z + 2), 0.6); for (let j = 0; j < c.length - 1; j++) wires.push(c[j], c[j + 1]); }
  {
    const g = new THREE.BufferGeometry().setFromPoints(wires);
    const w = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x15171c }));
    w.userData.noMinimap = true;
    B.decor.add(w);
  }

  // ———— 商店街（西）：入口牌坊、灯笼、屋台 ————
  const lanternMat = glow(lanternTex(), 0.4, { side: THREE.DoubleSide });
  const lanterns = [];
  const ropes = [];
  for (let z = -33; z <= 33; z += 5.5) {
    const a = new THREE.Vector3(-26.8, 5.6, z), b = new THREE.Vector3(-19.2, 5.6, z + 0.8);
    const c = catenary(a, b, 0.7, 12);
    for (let j = 0; j < c.length - 1; j++) ropes.push(c[j], c[j + 1]);
    for (let j = 1; j < c.length - 1; j += 2) lanterns.push(c[j].clone().add(new THREE.Vector3(0, -0.42, 0)));
  }
  {
    const inst = new THREE.InstancedMesh(lanternGeo(), lanternMat, lanterns.length);
    const m4 = new THREE.Matrix4();
    lanterns.forEach((p, i) => { m4.makeRotationY(Math.random() * 6).setPosition(p); inst.setMatrixAt(i, m4); });
    inst.userData.noMinimap = true;
    B.decor.add(inst);
    const r = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ropes), new THREE.LineBasicMaterial({ color: 0x2a1a12 }));
    r.userData.noMinimap = true;
    B.decor.add(r);
  }
  const gate = glow(hSign([['あまね銀座商店街', 58, 58], ['AMANE GINZA SHOPPING STREET', 18, 108, '#ffe6b0']], '#7a1f1f', '#fff3d6', 768, 128), 0.3);
  for (const s of [-1, 1]) {
    for (const x of [-26.6, -19.4]) B.box(0.35, 6.4, 0.35, x, 3.2, s * 36.6, 'metal');
    panel(7.6, 1.3, 0.3, -23, 6.2, s * 36.6, s < 0 ? Math.PI : 0, gate, B.M.metal);
    lamp(-23, 4.4, s * 18, 0xff9a55, 7, 15);
    // 屋台（低矮掩体）
    const stall = (x, z, col) => {
      B.box(2.6, 1.1, 1.4, x, 0.55, z, 'wallDark');
      const cloth = toon({ color: col, side: THREE.DoubleSide });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 1.9), cloth); roof.position.set(x, 2.35, z); roof.rotation.x = 0.12; B.decor.add(roof);
      for (const dx of [-1.2, 1.2]) B.box(0.08, 2.3, 0.08, x + dx, 1.15, z + 0.6, 'metal', { solid: false, edges: false });
      const nr = glow(hSign([['やきとり', 40, 34]], '#f5e6c8', '#a1261b', 256, 64), 0.15);
      panel(2.4, 0.5, 0.05, x, 1.8, z + 0.68, 0, nr, cloth, { back: false });
    };
    stall(-23.5, s * 12, 0xb33a2c); stall(-22.4, s * 26, 0x2c5fb3);
    place('boxA', -20, s * 15.5); place('boxB', -20.2, s * 16.3, { ry: 0.4 }); place('trashA', -25.5, s * 9, { solid: false });
    place('bench', -20, s * 33, { ry: Math.PI / 2, solid: false });
    place('bush', -26.2, s * 28, { solid: false }); place('bush', -26.2, s * 11, { solid: false });
  }

  // ———— 后街（东）：垃圾箱、纸箱、树 ————
  for (const s of [-1, 1]) {
    place('dumpster', 25.8, s * 19, { ry: -Math.PI / 2 });
    place('boxA', 20.2, s * 11); place('boxA', 20.4, s * 11.9, { y: 0.9, ry: 0.3, solid: false }); place('boxB', 21, s * 12.4);
    place('cone', 22, s * 26, { solid: false }); place('cone', 23, s * 26.5, { solid: false });
    place('barrier', 22.6, s * 27.2, { ry: 0 });
    place('trashB', 25, s * 33, { solid: false });
  }

  // ———— 小巷（z = ±29.5）————
  const bar = glow(hSign([['BAR 月影', 44, 40]], '#200b2e', '#ff7ad9', 256, 80), 0.5);
  for (const s of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const x = sx * 14;
      place('dumpster', x - sx * 2.5, s * 29.4, { ry: 0 });
      place('boxB', x + sx * 2, s * 29, { ry: 0.5 });
      place('boxA', x + sx * 1.6, s * 29.9, { ry: 0.2 });
      // 空调外机
      for (const dx of [-3, 1]) B.box(0.8, 0.6, 0.35, x + dx, 2.2, s * (28 + 0.2), 'white', { solid: false });
    }
    panel(1.6, 0.5, 0.06, 12, 2.9, s * 28.1, s > 0 ? 0 : Math.PI, bar, B.M.metal, { back: false });
    lamp(12, 2.6, s * 29.5, 0xff6ad5, 1.0, 6);
  }

  // ———— 树（大道两侧的行道树）————
  for (const s of [-1, 1]) for (const [x, z] of [[-7.6, 15], [7.6, 29.5], [-7.6, 35.5]]) {
    B.box(1.4, 0.3, 1.4, x, 0.3, s * z, 'curb');
    place('tree', x, s * z, { y: 0.4, solid: false });
  }

  // ———— 楼上的竖排灯箱招牌 ————
  const SIGNS = [['ラーメン', '#d7262e', '#ffffff'], ['居酒屋', '#16161c', '#ffd36b'], ['カラオケ', '#7b2cbf', '#ffffff'], ['くすり', '#1e88e5', '#ffffff'], ['喫茶', '#5d4037', '#ffe0b2'], ['焼鳥', '#ff8f00', '#2b1600'],
    ['書店', '#2e7d32', '#ffffff'], ['質', '#fafafa', '#c62828'], ['寿司', '#004d40', '#ffffff'], ['ゲーム', '#e91e63', '#ffffff'], ['銭湯', '#0d47a1', '#ffffff'], ['たばこ', '#c62828', '#ffffff'], ['美容室', '#ffffff', '#ff4f8b'], ['麻雀', '#1b5e20', '#ffeb3b']];
  const signMats = SIGNS.map(([t, bg, fg]) => glow(verticalSign(t, bg, fg), bg === '#fafafa' || bg === '#ffffff' ? 0.12 : 0.22));
  let si = 0;
  // 灯箱竖着挂在楼的正面，垂直于墙伸出去（两面都有字）
  const hang = (x, z, wallNormalX, y = 4.6) => {
    const m = signMats[si % signMats.length], n = [...SIGNS[si % SIGNS.length][0]].length; si++;
    const h = 0.55 + n * 0.62;
    panel(0.9, h, 0.18, x + wallNormalX * 0.55, y + h / 2, z, 0, m, B.M.metal);
  };
  for (const s of [-1, 1]) {
    for (const z of [3, 12, 21, 30]) { hang(-27, s * z, 1, 3.2 + (z % 2)); hang(27, s * z + s * 3, -1, 3.6); }
    hang(-9, s * 16, 1, 4.2); hang(9, s * 26, -1, 3.6); hang(-19, s * 22, -1, 3.4); hang(19, s * 14, 1, 3.8);
  }

  // ———— 远景：夜里亮着窗的高楼群（装饰）————
  {
    const wins = [0, 1, 2].map((i) => glow(windowsTex(i), 0.32, { color: 0x6b7385 }));
    const top = toon({ color: 0x2a3142 });
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + Math.random() * 0.05;
      const r = 92 + Math.random() * 70;
      const w = 10 + Math.random() * 16, d = 10 + Math.random() * 14, h = 24 + Math.random() * 60;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [wins[i % 3], wins[(i + 1) % 3], top, top, wins[(i + 2) % 3], wins[i % 3]]);
      m.position.set(Math.cos(a) * r * 0.75, h / 2 - 2, Math.sin(a) * r);
      m.rotation.y = -a;
      B.decor.add(m);
      if (Math.random() < 0.3) {
        const red = toon({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 1.5 }); glowMats.push(red);
        const bl = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), red); bl.position.set(m.position.x, h - 1.5, m.position.z); B.decor.add(bl);
      }
    }
    // 近一点的一圈 Kenney 楼（城市边缘）
    const ring = ['skya', 'skyb', 'skyc', 'skyd', 'skye', 'lowa', 'lowb', 'lowc', 'lowd', 'lowe', 'lowf', 'lowg', 'lowh', 'lowi', 'lowk', 'lowl', 'lowm'];
    let k = 0;
    for (const s of [-1, 1]) {
      for (let z = -64; z <= 64; z += 12) place(ring[k++ % ring.length], s * (48 + Math.random() * 6), z, { sc: 5 + Math.random() * 1.5, ry: Math.round(Math.random() * 4) * Math.PI / 2, solid: false, edges: false });
      for (let x = -42; x <= 42; x += 12) place(ring[k++ % ring.length], x, s * (70 + Math.random() * 6), { sc: 5 + Math.random() * 1.5, ry: Math.round(Math.random() * 4) * Math.PI / 2, solid: false, edges: false });
    }
  }

  // 天空（只要天空球，不要浮空城）
  B.sky = skyDome('#1a2440', '#3a4466', '#4a4f66');
  B.decor.add(B.sky);

  // ———— 出生点、AI 热点 ————
  // 地图外圈的隐形墙（广场两角、车站背后都封住）
  for (const [w, d, x, z] of [[1, 120, -37.6, 0], [1, 120, 37.6, 0], [76, 1, 0, -59.4], [76, 1, 0, 59.4]]) B.box(w, 30, d, x, 15, z, 'glassStore', { edges: false, shadow: false }).visible = false;

  const spawns = (s) => [-6, -3, 0, 3, 6].map((x, i) => new THREE.Vector3(x, 0, s * (46 + (i % 2) * 2.5)));
  const hot = [[0, 0, 0], [-4.5, 0, 0], [13.5, 0, 0.15], [-12, 0, 0], [-23, 0, 0], [23, 0, 0], [3, 16, 0], [-3, 26, 0], [0, 33, 0],
    [-23, 12, 0], [-23, 26, 0], [23, 13, 0], [23, 27, 0], [-14, 29.5, 0], [14, 29.5, 0], [7.6, 18.5, 0.15], [-7.6, 18.5, 0.15], [-12, 7, 0], [7.6, 7, 0.15]];
  const hotspots = [];
  for (const [x, z, y] of hot) { hotspots.push(new THREE.Vector3(x, y, z)); if (z) hotspots.push(new THREE.Vector3(x, y, -z)); }

  return {
    ...B, mode: 'ranked', spawn: spawns(-1)[2], yaw: 0,
    teams: { ally: { spawns: spawns(-1), yaw: 0, home: new THREE.Vector3(0, 0, -46) }, enemy: { spawns: spawns(1), yaw: Math.PI, home: new THREE.Vector3(0, 0, 46) } },
    hotspots, navUnder, lamps, lampMats, glowMats,
    wetMats: [B.M.asphalt, B.M.paving, B.M.walk, B.M.concrete],
    fog: [0x2a3350, 50, 195], background: 0x1b2340,
    // 默认雨夜：开局 20～23 点；一天 48 分钟，一局 6 分钟只过 3 个小时；天气倾向小雨 / 雷雨
    env: {
      hour: 21.5, hourJitter: 3, daySeconds: 2880,
      weather: { rain: 0.55, storm: 0.3, cloudy: 0.15 },
      next: { clear: { cloudy: 3, clear: 1 }, sakura: { cloudy: 1 }, cloudy: { rain: 4, cloudy: 1, storm: 1 }, rain: { rain: 3, storm: 2, cloudy: 1 }, storm: { rain: 3, storm: 1 } },
    },
  };
}
