import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildRainStreet } from './street.js';

// 训练地图。每张图由代码现场搭建（不需要外部模型文件）：
//   solid  —— 参与碰撞的几何（地面、墙、楼梯、坡道、掩体）
//   decor  —— 只看不碰的装饰（树、旗帜、远景浮岛、云、天空），不画进小地图
// 风格跟「弦光」大厅一致：白色大理石 + 浅灰 + 薄荷青点缀，天空之城。

export const MAPS = [
  { id: 'core', mode: 'ranked', name: '棱镜中枢', en: 'PRISM CORE', desc: '4V4 团队竞技。中央高台控场，左侧长廊架枪，右侧街区近战。', tags: ['4V4', '团队竞技', '三路'], build: buildArena },
  { id: 'street', mode: 'ranked', name: '雨夜街区', en: 'RAINY BLOCK', desc: '4V4 团队竞技。雨夜的十字路口：中路大道远距离对枪，两座歩道橋抢高点，便利店和小巷近战。', tags: ['4V4', '团队竞技', '夜雨'], build: buildRainStreet },
  { id: 'skyterrace', name: '晴空露台', en: 'SKY TERRACE', desc: '浮空城中央的白石广场，两座高台与长廊提供立体对枪。', tags: ['中型', '高低差', '推荐'], build: buildSkyTerrace },
  { id: 'range', name: '折光靶场', en: 'PRISM RANGE', desc: '纵深 80 米的直线靶场，地面标注距离，适合练枪和狙击。', tags: ['长距离', '练枪'], build: buildRange },
];

// ———————————— 材质 ————————————
function makeTileTexture(base, line, accent) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  // 大理石微弱纹理
  for (let i = 0; i < 140; i++) {
    x.strokeStyle = `rgba(150,165,180,${Math.random() * 0.06})`;
    x.lineWidth = 1 + Math.random() * 2;
    x.beginPath();
    let px = Math.random() * 256, py = Math.random() * 256;
    x.moveTo(px, py);
    for (let k = 0; k < 4; k++) { px += (Math.random() - 0.5) * 80; py += (Math.random() - 0.5) * 80; x.lineTo(px, py); }
    x.stroke();
  }
  x.strokeStyle = line; x.lineWidth = 3;
  x.strokeRect(1.5, 1.5, 253, 253);
  x.beginPath(); x.moveTo(128, 0); x.lineTo(128, 256); x.moveTo(0, 128); x.lineTo(256, 128); x.lineWidth = 1.5; x.stroke();
  if (accent) { x.fillStyle = accent; x.fillRect(0, 0, 10, 3); x.fillRect(0, 0, 3, 10); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function materials(gradient) {
  const toon = (o) => new THREE.MeshToonMaterial({ gradientMap: gradient, ...o });
  return {
    floor: toon({ map: makeTileTexture('#f4f6f8', 'rgba(150,165,180,.55)', 'rgba(51,230,200,.6)') }),
    stone: toon({ map: makeTileTexture('#eceff3', 'rgba(150,165,180,.35)') }),
    gray: toon({ color: 0xc9d1d9 }),
    inlay: toon({ map: makeTileTexture('#d5e0ea', 'rgba(120,140,160,.5)') }),
    dark: toon({ color: 0x3b444e }),
    mint: toon({ color: 0x33e6c8, emissive: 0x13a893, emissiveIntensity: 0.55 }),
    coral: toon({ color: 0xff6b5e, emissive: 0xb8322a, emissiveIntensity: 0.5 }),
    glass: new THREE.MeshBasicMaterial({ color: 0x9ff3e4, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    leaf: toon({ color: 0x9fdcb9 }),
    leaf2: toon({ color: 0xc7ecd4 }),
    trunk: toon({ color: 0xb9a48c }),
    flower: toon({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.15 }),
    banner: toon({ color: 0x4d5864, side: THREE.DoubleSide }),
    edge: new THREE.LineBasicMaterial({ color: 0x6d7b8a, transparent: true, opacity: 0.38 }),
  };
}

// 按面朝向给每个顶点算世界坐标 UV（地砖纹理在所有方块上连续、比例一致）
export function worldUV(geo, scale = 4) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    let u, v;
    if (ay > 0.5) { u = p.getX(i); v = p.getZ(i); } else if (ax > 0.5) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// 搭积木的小工具
export class Builder {
  constructor(gradient) {
    this.M = materials(gradient);
    this.solid = new THREE.Group(); this.solid.name = 'MapSolid';
    this.decor = new THREE.Group(); this.decor.name = 'MapDecor';
    this.anim = []; // 每帧更新的装饰（旋转的棱镜、飘动的旗）
  }

  // 方块：中心 (x, y, z)，尺寸 (w, h, d)；ry 绕 Y 转；rx 绕 X 转（坡道）
  box(w, h, d, x, y, z, mat = 'stone', { solid = true, ry = 0, rx = 0, edges = true, shadow = true, uvScale = 4 } = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, this.M[mat]);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0, 'YXZ');
    m.updateMatrixWorld(true);
    if (this.M[mat].map) {
      // 先转到世界坐标算 UV 再转回来
      const wg = g.clone().applyMatrix4(m.matrixWorld);
      worldUV(wg, uvScale);
      g.setAttribute('uv', wg.attributes.uv);
    }
    m.castShadow = shadow; m.receiveShadow = true;
    if (edges) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), this.M.edge));
    (solid ? this.solid : this.decor).add(m);
    return m;
  }

  // 楼梯：从 (x, y0, z) 出发沿 dir 方向（'+x' '-x' '+z' '-z'）向上 n 级
  stairs(x, y0, z, dir, n, { w = 4, rise = 0.3, run = 0.55, mat = 'stone' } = {}) {
    const [ax, sx] = { '+x': ['x', 1], '-x': ['x', -1], '+z': ['z', 1], '-z': ['z', -1] }[dir];
    for (let i = 0; i < n; i++) {
      const h = rise * (i + 1);
      const off = sx * (run * i + run / 2);
      const cx = ax === 'x' ? x + off : x, cz = ax === 'z' ? z + off : z;
      this.box(ax === 'x' ? run : w, h, ax === 'x' ? w : run, cx, y0 + h / 2, cz, mat, { edges: i === n - 1 || i % 2 === 0 });
    }
    // 看不见的碰撞斜坡，贴着每一级的台阶边：走楼梯和走坡一样顺，不会一级一级地卡
    // （从第一级前面一个踏步处的地面，斜到最上面一级的前沿）
    const len = run * n, height = rise * n, slope = Math.hypot(len, height), ang = Math.atan2(height, len), t = 0.2;
    const sx0 = ax === 'x' ? x - sx * run : x, sz0 = ax === 'z' ? z - sx * run : z;
    const cx = ax === 'x' ? sx0 + sx * len / 2 : sx0, cz = ax === 'z' ? sz0 + sx * len / 2 : sz0;
    const cy = y0 + height / 2 - (t / 2) / Math.cos(ang);
    const r = ax === 'z' ? this.box(w - 0.1, t, slope, cx, cy, cz, mat, { rx: -sx * ang, edges: false, shadow: false })
      : this.box(w - 0.1, t, slope, cx, cy, cz, mat, { ry: Math.PI / 2, rx: -sx * ang, edges: false, shadow: false });
    r.visible = false; r.userData.stairRamp = true;
  }

  // 坡道：底边中心 (x, y0, z)，沿 dir 爬升 height，水平长度 len
  ramp(x, y0, z, dir, len, height, { w = 3, mat = 'stone' } = {}) {
    const slope = Math.hypot(len, height), ang = Math.atan2(height, len), t = 0.4;
    const [ax, sx] = { '+x': ['x', 1], '-x': ['x', -1], '+z': ['z', 1], '-z': ['z', -1] }[dir];
    // 斜板中心：水平走一半、升一半，再往下沉半个板厚（让表面过底边）
    const cx = ax === 'x' ? x + sx * len / 2 : x, cz = ax === 'z' ? z + sx * len / 2 : z;
    const cy = y0 + height / 2 - (t / 2) / Math.cos(ang);
    if (ax === 'z') this.box(w, t, slope, cx, cy, cz, mat, { rx: -sx * ang });
    else this.box(w, t, slope, cx, cy, cz, mat, { ry: Math.PI / 2, rx: -sx * ang });
    // 侧面的薄荷色护栏线（装饰）
    for (const s of [-1, 1]) {
      const o = (w / 2 + 0.06) * s;
      if (ax === 'z') this.box(0.08, 0.08, slope, cx + o, cy + 0.9, cz, 'mint', { solid: false, rx: -sx * ang, edges: false, shadow: false });
      else this.box(0.08, 0.08, slope, cx, cy + 0.9, cz + o, 'mint', { solid: false, ry: Math.PI / 2, rx: -sx * ang, edges: false, shadow: false });
    }
  }

  // 玻璃护栏：从 (x1,z1) 到 (x2,z2)，高 h，底在 y
  rail(x1, z1, x2, z2, y = 0, h = 1.05) {
    const len = Math.hypot(x2 - x1, z2 - z1), ry = Math.atan2(x2 - x1, z2 - z1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    // 碰撞用一块看不见的薄墙
    const wall = this.box(0.12, h, len, cx, y + h / 2, cz, 'glass', { ry, edges: false, shadow: false });
    wall.castShadow = false;
    this.box(0.14, 0.08, len, cx, y + h, cz, 'gray', { solid: false, ry, edges: false });
    this.box(0.1, 0.05, len, cx, y + h - 0.12, cz, 'mint', { solid: false, ry, edges: false, shadow: false });
    const posts = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= posts; i++) {
      const k = i / posts;
      this.box(0.16, h, 0.16, x1 + (x2 - x1) * k, y + h / 2, z1 + (z2 - z1) * k, 'gray', { solid: false, edges: false });
    }
  }

  // 方形花坛 + 树（花坛能挡子弹，树不碰撞）
  planter(x, z, s = 3, y = 0, tree = true) {
    this.box(s, 0.8, s, x, y + 0.4, z, 'stone');
    this.box(s - 0.3, 0.1, s - 0.3, x, y + 0.82, z, 'leaf', { solid: false, edges: false });
    if (tree) this.tree(x, y + 0.8, z, 0.9 + Math.random() * 0.4);
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), this.M.flower);
      f.position.set(x + (Math.random() - 0.5) * (s - 0.6), y + 0.93, z + (Math.random() - 0.5) * (s - 0.6));
      this.decor.add(f);
    }
  }

  tree(x, y, z, k = 1) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * k, 0.18 * k, 2.2 * k, 6), this.M.trunk);
    t.position.set(x, y + 1.1 * k, z); t.castShadow = true;
    this.decor.add(t);
    const blobs = [[0, 2.6, 0, 1.15], [0.6, 2.2, 0.2, 0.8], [-0.5, 2.3, -0.3, 0.85], [0.1, 3.2, -0.1, 0.75]];
    for (const [ox, oy, oz, r] of blobs) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r * k, 0), Math.random() < 0.5 ? this.M.leaf : this.M.leaf2);
      b.position.set(x + ox * k, y + oy * k, z + oz * k);
      b.rotation.set(Math.random(), Math.random(), 0);
      b.castShadow = true;
      this.decor.add(b);
    }
  }

  // 旗杆 + 印着星形标志的旗帜
  banner(x, z, y = 0, ry = 0, h = 7, accent = '#33e6c8') {
    this.box(0.18, h, 0.18, x, y + h / 2, z, 'gray', { solid: true, edges: false });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.4, 1, 8), new THREE.MeshToonMaterial({ map: bannerTexture(accent), side: THREE.DoubleSide, gradientMap: this.M.floor.gradientMap }));
    flag.position.set(x + Math.sin(ry) * 0.9, y + h - 2, z + Math.cos(ry) * 0.9);
    flag.rotation.y = ry + Math.PI / 2;
    flag.castShadow = true;
    this.decor.add(flag);
    const base = flag.geometry.attributes.position.array.slice();
    this.anim.push((t) => {
      const p = flag.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = base[i * 3] + 0.8; // 0（靠杆）…1.6
        p.setZ(i, Math.sin(t * 2.2 + u * 2.4 + base[i * 3 + 1] * 0.6) * 0.12 * u);
      }
      p.needsUpdate = true;
    });
  }

  // 漂浮旋转的棱镜雕塑（发光，不碰撞）
  prism(x, y, z, s = 1.6) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), new THREE.MeshToonMaterial({ color: 0xe8fffb, emissive: 0x33e6c8, emissiveIntensity: 0.45, gradientMap: this.M.floor.gradientMap }));
    core.scale.y = 1.6;
    core.add(new THREE.LineSegments(new THREE.EdgesGeometry(core.geometry), new THREE.LineBasicMaterial({ color: 0x1fbfa8 })));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 1.9, 0.07, 6, 48), this.M.mint);
    ring.rotation.x = Math.PI / 2.3;
    const ring2 = ring.clone(); ring2.rotation.set(Math.PI / 1.8, 0.6, 0); ring2.scale.setScalar(1.18);
    g.add(core, ring, ring2);
    g.position.set(x, y, z);
    this.decor.add(g);
    const light = new THREE.PointLight(0x7ff5e1, 6, 16, 1.6);
    light.position.set(x, y, z);
    this.decor.add(light);
    this.anim.push((t) => { core.rotation.y = t * 0.6; g.position.y = y + Math.sin(t * 1.2) * 0.25; ring.rotation.z = t * 0.4; ring2.rotation.z = -t * 0.3; });
  }
}

function bannerTexture(accent = '#33e6c8') {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 272;
  const x = c.getContext('2d');
  x.fillStyle = '#4d5864'; x.fillRect(0, 0, 128, 272);
  x.fillStyle = accent; x.fillRect(0, 0, 128, 6); x.fillRect(0, 266, 128, 6);
  x.save(); x.translate(64, 110); x.fillStyle = '#eef4f7';
  x.beginPath();
  for (let i = 0; i < 8; i++) { const r = i % 2 ? 9 : 38, a = i / 8 * Math.PI * 2 - Math.PI / 2; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  x.closePath(); x.fill(); x.restore();
  x.fillStyle = '#eef4f7'; x.font = '600 13px sans-serif'; x.textAlign = 'center';
  x.fillText('PRISM / LINK', 64, 190);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ———————————— 天空、云、远景 ————————————
// 天空球：渐变 + 二次元风格的太阳（硬边圆盘 + 光晕）、月亮、星星。颜色和太阳位置由 env.js 按时间、天气更新
const SKY_FRAG = `
uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunColor;
uniform vec3 sunDir; uniform vec3 moonDir; uniform float night; uniform float overcast; uniform float time; uniform float flash;
varying vec3 vP;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vP); float h = d.y;
  vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h * 1.5, 0.0, 1.0), 0.75)) : mix(mid, bottom, clamp(-h * 4.0, 0.0, 1.0));
  float clear = 1.0 - overcast;
  // 太阳方向的地平线暖光
  float sd = max(dot(d, sunDir), 0.0);
  c += sunColor * pow(sd, 6.0) * 0.28 * clear * (1.0 - smoothstep(0.2, 0.9, sunDir.y) * 0.6);
  // 太阳：硬边圆盘 + 一圈柔光（日漫画法）
  float up = smoothstep(-0.08, 0.02, sunDir.y);
  c += sunColor * smoothstep(0.975, 0.997, sd) * 0.35 * clear * up;
  c = mix(c, vec3(1.0, 0.97, 0.9), smoothstep(0.99935, 0.99955, sd) * clear * up);
  // 月亮 + 月晕
  float md = max(dot(d, moonDir), 0.0);
  c += vec3(0.45, 0.55, 0.9) * pow(md, 120.0) * 0.35 * night * clear;
  c = mix(c, vec3(0.93, 0.95, 1.0), smoothstep(0.99955, 0.9997, md) * night * (1.0 - overcast * 0.8));
  // 星星（会闪）
  vec3 q = floor(d * 240.0);
  float s = hash(q);
  float star = step(0.9972, s) * (0.55 + 0.45 * sin(time * 2.5 + s * 80.0)) * night * clear * smoothstep(0.02, 0.3, h);
  c += vec3(star) * vec3(0.9, 0.95, 1.0);
  // 闪电
  c += vec3(0.75, 0.8, 1.0) * flash;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
export function skyDome(top = '#7fb8f0', mid = '#cfe6fa', bottom = '#f4fbff') {
  const g = new THREE.SphereGeometry(400, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, bottom: { value: new THREE.Color(bottom) },
      sunColor: { value: new THREE.Color('#ffe2b0') }, sunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
      moonDir: { value: new THREE.Vector3(-0.4, -0.6, -0.3).normalize() }, night: { value: 0 }, overcast: { value: 0 }, time: { value: 0 }, flash: { value: 0 },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: SKY_FRAG,
  });
  const s = new THREE.Mesh(g, m);
  s.renderOrder = -1;
  s.frustumCulled = false;
  s.userData.noInk = true; // 手绘描线不描天空
  return s;
}

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const px = 30 + Math.random() * 68, py = 50 + Math.random() * 30, r = 18 + Math.random() * 22;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 远处的浮空城：尖塔群、浮岛、云海
function skyCity(B, { radius = 140, y = 0 } = {}) {
  const decor = B.decor;
  B.sky = skyDome();
  decor.add(B.sky);
  const cloudTex = cloudTexture();
  const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.95 });
  B.cloudMat = cloudMat;
  // 下方云海
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 260;
    const sp = new THREE.Sprite(cloudMat);
    sp.position.set(Math.cos(a) * r, y - 18 - Math.random() * 16, Math.sin(a) * r);
    const s = 40 + Math.random() * 60;
    sp.scale.set(s, s * 0.45, 1);
    decor.add(sp);
  }
  // 地平线上的云带
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = radius + 60 + Math.random() * 80;
    const sp = new THREE.Sprite(cloudMat);
    sp.position.set(Math.cos(a) * r, y + 4 + Math.random() * 30, Math.sin(a) * r);
    const s = 50 + Math.random() * 50;
    sp.scale.set(s, s * 0.4, 1);
    decor.add(sp);
  }
  const white = new THREE.MeshToonMaterial({ color: 0xf2f6fa, gradientMap: B.M.floor.gradientMap, fog: true });
  const blue = new THREE.MeshToonMaterial({ color: 0xc9dced, gradientMap: B.M.floor.gradientMap });
  // 尖塔群（合并成一个网格，省性能）
  const geos = [];
  const spire = (cx, cz, base, h) => {
    const c = new THREE.CylinderGeometry(base * 0.7, base, h, 8);
    c.translate(cx, y - 10 + h / 2, cz);
    const tip = new THREE.ConeGeometry(base * 0.7, h * 0.35, 8);
    tip.translate(cx, y - 10 + h + h * 0.175, cz);
    geos.push(c, tip);
  };
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2 + 0.6, r = radius + 30 * Math.random();
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    spire(cx, cz, 5, 70 + Math.random() * 30);
    for (let i = 0; i < 9; i++) spire(cx + (Math.random() - 0.5) * 50, cz + (Math.random() - 0.5) * 50, 2 + Math.random() * 3, 20 + Math.random() * 45);
    // 圆盘平台
    const disk = new THREE.CylinderGeometry(22, 18, 3, 24);
    disk.translate(cx, y + 6 + Math.random() * 12, cz);
    geos.push(disk);
  }
  const city = new THREE.Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed())), white);
  decor.add(city);
  // 浮岛（倒锥）
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 90, s = 4 + Math.random() * 7;
    const isl = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(s, s * 0.9, 1.2, 10), white);
    const bot = new THREE.Mesh(new THREE.ConeGeometry(s * 0.9, s * 1.6, 10), blue);
    bot.rotation.x = Math.PI; bot.position.y = -s * 0.8 - 0.6;
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.35, 0), B.M.leaf);
    bush.position.set(s * 0.2, 1, 0);
    isl.add(top, bot, bush);
    const py = y + 8 + Math.random() * 30;
    isl.position.set(Math.cos(a) * r, py, Math.sin(a) * r);
    decor.add(isl);
    const ph = Math.random() * 6;
    B.anim.push((t) => { isl.position.y = py + Math.sin(t * 0.4 + ph) * 0.8; });
  }
  // 飞行器
  for (let i = 0; i < 3; i++) {
    const ship = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 6, 4, 8), white);
    hull.rotation.z = Math.PI / 2;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 8), blue);
    ship.add(hull, wing);
    decor.add(ship);
    const r = 90 + i * 25, h = y + 25 + i * 8, sp = 0.03 + i * 0.01, ph = i * 2;
    B.anim.push((t) => { const a = t * sp + ph; ship.position.set(Math.cos(a) * r, h, Math.sin(a) * r); ship.rotation.y = -a; });
  }
}

// ———————————— 地图一：晴空露台 ————————————
function buildSkyTerrace(gradient) {
  const B = new Builder(gradient);
  const S = 32; // 广场半边长
  // 地面（厚 1，表面 y = 0）+ 薄荷色描边
  B.box(S * 2, 1, S * 2, 0, -0.5, 0, 'floor', { edges: true });
  B.box(S * 2 + 1.2, 2.4, S * 2 + 1.2, 0, -2.2, 0, 'gray', { solid: false });
  for (const s of [-1, 1]) {
    B.box(S * 2 + 1.2, 0.12, 0.12, 0, -1.0, s * (S + 0.6), 'mint', { solid: false, edges: false });
    B.box(0.12, 0.12, S * 2 + 1.2, s * (S + 0.6), -1.0, 0, 'mint', { solid: false, edges: false });
  }
  // 四周玻璃护栏
  B.rail(-S, -S, S, -S); B.rail(S, -S, S, S); B.rail(S, S, -S, S); B.rail(-S, S, -S, -S);

  // 中央高台（顶面 y = 1.2），四面楼梯，中间悬浮棱镜
  B.box(14, 1.2, 14, 0, 0.6, 0, 'floor');
  for (const s of [-1, 1]) { // 台沿的薄荷色灯带
    B.box(14.1, 0.14, 0.14, 0, 1.12, s * 7.02, 'mint', { solid: false, edges: false, shadow: false });
    B.box(0.14, 0.14, 14.1, s * 7.02, 1.12, 0, 'mint', { solid: false, edges: false, shadow: false });
  }
  // 四面楼梯：从台子外 2.2 米处起步，朝台子爬 4 级
  B.stairs(0, 0, 9.2, '-z', 4, { w: 5 }); B.stairs(0, 0, -9.2, '+z', 4, { w: 5 });
  B.stairs(9.2, 0, 0, '-x', 4, { w: 5 }); B.stairs(-9.2, 0, 0, '+x', 4, { w: 5 });
  B.box(3, 1, 3, 0, 1.7, 0, 'stone');
  B.box(2.2, 0.2, 2.2, 0, 2.3, 0, 'mint', { solid: false, edges: false });
  B.prism(0, 5.2, 0, 1.3);
  // 高台四角的低矮掩体
  for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) B.box(2.2, 1.1, 0.6, x, 1.2 + 0.55, z, 'stone', { ry: Math.atan2(x, z) });

  // 西北高塔（顶面 y = 6）+ 坡道
  const tower = (x, z, dir) => {
    B.box(8, 6, 8, x, 3, z, 'stone');
    B.box(8.3, 0.25, 8.3, x, 5.9, z, 'gray', { solid: false });
    for (const [a, b, c, d] of [[-4, -4, 4, -4], [4, -4, 4, 4], [4, 4, -4, 4], [-4, 4, -4, -4]]) {
      // 坡道那一边留出口
      const sideZ = dir === '+z' ? 4 : -4;
      if (b === d && b === sideZ) { B.rail(x + a, z + b, x + Math.sign(a) * 1.6, z + d, 6); B.rail(x + Math.sign(c) * 1.6, z + b, x + c, z + d, 6); continue; }
      B.rail(x + a, z + b, x + c, z + d, 6);
    }
    // 塔身的拱门和薄荷色腰线（装饰）
    for (const s of [-1, 1]) {
      B.box(8.05, 0.15, 0.15, x, 4.6, z + s * 4.02, 'mint', { solid: false, edges: false });
      B.box(0.15, 0.15, 8.05, x + s * 4.02, 4.6, z, 'mint', { solid: false, edges: false });
    }
    const sz = dir === '+z' ? 1 : -1;
    B.ramp(x, 0, z + sz * 18, dir === '+z' ? '-z' : '+z', 14, 6, { w: 3.2 });
    B.banner(x + 4.6, z - sz * 4.6, 6, 0, 5);
  };
  tower(-21, -21, '+z');
  tower(21, 21, '-z');

  // 东侧长廊（顶面 y = 3）：南头坡道，北头楼梯
  B.box(4, 3, 18, 25, 1.5, -8, 'stone');
  B.rail(23, -17, 23, 1, 3); B.rail(27, -17, 27, 1, 3);
  B.ramp(25, 0, 9, '-z', 8, 3, { w: 4 });
  // 北头用一组真正的楼梯（往北下）
  for (let i = 0; i < 10; i++) B.box(4, 3 - i * 0.3, 0.55, 25, (3 - i * 0.3) / 2, -17.27 - i * 0.55, 'stone', { edges: i % 2 === 0 });
  // 长廊下方的拱门柱（装饰，不碰撞的薄荷灯条）
  for (let z = -15; z <= -1; z += 4.5) B.box(4.1, 0.12, 0.3, 25, 2.2, z, 'mint', { solid: false, edges: false });

  // 西侧柱廊（柱子能挡子弹）
  for (let z = -2; z <= 14; z += 4) {
    B.box(1, 5, 1, -26, 2.5, z, 'stone');
    B.box(1.4, 0.4, 1.4, -26, 0.2, z, 'gray');
  }
  B.box(1.2, 0.6, 18, -26, 5.3, 6, 'stone', { solid: false });
  B.box(1.25, 0.1, 18, -26, 4.95, 6, 'mint', { solid: false, edges: false });

  // 掩体：矮墙、方块、花坛
  const walls = [[-12, 14, 4, 0], [12, -14, 4, 0], [-14, -6, 3.5, Math.PI / 2], [14, 7, 3.5, Math.PI / 2], [0, 20, 5, 0], [0, -20, 5, 0], [-8, -14, 3, 0.5], [9, 15, 3, -0.4]];
  for (const [x, z, l, ry] of walls) {
    B.box(l, 1.15, 0.7, x, 0.575, z, 'stone', { ry });
    B.box(l + 0.02, 0.08, 0.72, x, 1.17, z, 'mint', { solid: false, ry, edges: false });
  }
  const crates = [[-17, 8], [17, -6], [-6, 24], [7, -25], [-24, -6], [14, 25], [-15, -26], [20, -24]];
  for (const [x, z] of crates) {
    B.box(1.6, 1.6, 1.6, x, 0.8, z, 'gray', { ry: Math.random() * 0.5 });
    if (Math.random() < 0.6) B.box(1.1, 1.1, 1.1, x + 0.4, 2.15, z - 0.2, 'stone', { ry: Math.random() });
  }
  for (const [x, z] of [[-13, 25], [13, -25], [-28, 26], [28, -28], [-28, -12], [10, 4], [-10, -3], [18, 12]]) B.planter(x, z, 3);
  // 旗帜
  B.banner(-30, -30, 0, Math.PI / 4); B.banner(30, -30, 0, -Math.PI / 4); B.banner(-30, 30, 0, Math.PI * 0.75); B.banner(30, 30, 0, -Math.PI * 0.75);
  // 中央台四周一圈浅蓝灰色地砖（装饰）
  for (const s of [-1, 1]) {
    B.box(26, 0.03, 2.4, 0, 0.015, s * 11.8, 'inlay', { solid: false, edges: false, shadow: false });
    B.box(2.4, 0.03, 21.2, s * 11.8, 0.015, 0, 'inlay', { solid: false, edges: false, shadow: false });
  }
  // 地面的薄荷色引导线（装饰）
  for (const [x, z, w, d] of [[0, 14, 0.15, 10], [0, -14, 0.15, 10], [14, 0, 10, 0.15], [-14, 0, 10, 0.15]]) B.box(w, 0.02, d, x, 0.01, z, 'mint', { solid: false, edges: false, shadow: false });

  skyCity(B);
  return { ...B, spawn: new THREE.Vector3(0, 0, 26), yaw: Math.PI, spawnFilter: (x, z) => Math.abs(x) < S - 1.5 && Math.abs(z) < S - 1.5, fog: [0xdcefff, 60, 260], background: 0xcfe6fa };
}

// ———————————— 地图二：折光靶场 ————————————
function buildRange(gradient) {
  const B = new Builder(gradient);
  const W = 16, L = 50; // 半宽、半长
  B.box(W * 2, 1, L * 2, 0, -0.5, 0, 'floor');
  B.box(W * 2 + 1.2, 2.4, L * 2 + 1.2, 0, -2.2, 0, 'gray', { solid: false });
  // 侧墙（高 4）和尽头的挡弹墙（高 9）
  for (const s of [-1, 1]) {
    B.box(1, 4, L * 2, s * (W + 0.5), 2, 0, 'stone');
    B.box(1.05, 0.15, L * 2, s * (W + 0.5), 3.4, 0, 'mint', { solid: false, edges: false });
  }
  B.box(W * 2 + 2, 9, 1.5, 0, 4.5, L + 0.75, 'stone');
  B.box(W * 2 + 2, 0.2, 1.55, 0, 7.5, L + 0.75, 'mint', { solid: false, edges: false });
  B.rail(-W, -L, W, -L);
  // 射击线（z = -34）：齐腰高的台子，中间留通道
  for (const x of [-11, 0, 11]) B.box(8, 1.05, 1.2, x, 0.525, -34, 'stone');
  B.box(32, 0.08, 0.15, 0, 0.02, -33.2, 'mint', { solid: false, edges: false, shadow: false });
  // 地面距离线和距离牌
  for (let d = 10; d <= 80; d += 10) {
    const z = -34 + d;
    if (z > L - 2) break;
    B.box(W * 2 - 0.4, 0.02, 0.12, 0, 0.01, z, 'mint', { solid: false, edges: false, shadow: false });
    for (const s of [-1, 1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ map: distTexture(d), transparent: true }));
      sign.position.set(s * (W - 0.05), 2.6, z);
      sign.rotation.y = -s * Math.PI / 2;
      B.decor.add(sign);
    }
  }
  // 场地里的掩体
  for (const [x, z] of [[-8, -18], [6, -12], [-3, -2], [9, 4], [-10, 10], [2, 16], [-6, 24], [8, 30], [0, 38]]) {
    B.box(2.2, 1.2, 1.2, x, 0.6, z, 'gray', { ry: Math.random() * 0.6 - 0.3 });
  }
  for (const [x, z] of [[-12, -4], [12, 20], [-12, 34]]) B.box(1.2, 3.2, 1.2, x, 1.6, z, 'stone');
  // 后方狙击塔（顶面 y = 4.2），楼梯上
  B.box(6, 4.2, 6, 11, 2.1, -42, 'stone');
  B.rail(8, -39, 14, -39, 4.2); B.rail(14, -45, 14, -39, 4.2);
  B.stairs(8 - 14 * 0.55, 0, -43.5, '+x', 14, { w: 3 });
  B.banner(-14, -46, 0, 0.6);
  B.banner(14, 46, 0, Math.PI - 0.4);
  for (const x of [-12, 12]) B.planter(x, -46, 2.4, 0, false);
  skyCity(B, { radius: 150 });
  return { ...B, spawn: new THREE.Vector3(0, 0, -40), yaw: 0, dummyRange: [10, 75], spawnFilter: (x, z) => z > -28 && Math.abs(x) < W - 1.5, fog: [0xdcefff, 70, 280], background: 0xcfe6fa };
}

function distTexture(d) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(59,68,78,.88)'; x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#33e6c8'; x.fillRect(0, 0, 8, 128);
  x.fillStyle = '#fff'; x.font = '700 70px Bahnschrift, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(`${d} m`, 132, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ———————————— 竞技地图：棱镜中枢（4V4 团队竞技）————————————
// 以 z = 0 镜像对称：我方基地在 -Z，敌方在 +Z。三路：左侧高架长廊（远距离）、中路高台、右侧街区（近战，用 Kenney 的掩体模型）。
// 注意：AI 寻路用的是“俯视高度图”，所以场景里不做能从下面穿过去的桥或屋顶。
const PROPS = ['wall-high', 'wall-low', 'platform-large-grass', 'grass', 'grass-small'];
async function loadProps(loader, gradient) {
  const out = {};
  await Promise.all(PROPS.map(async (n) => {
    const g = await loader.loadAsync(`Asset/Prop/${n}.glb`);
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      o.material = new THREE.MeshToonMaterial({ map: m.map, color: m.color, gradientMap: gradient });
      o.castShadow = o.receiveShadow = true;
    });
    out[n] = g.scene;
  }));
  return out;
}

async function buildArena(gradient, { loader }) {
  const B = new Builder(gradient);
  const props = await loadProps(loader, gradient);
  const X = 30, Z = 48;
  // 放一个 Kenney 模型：scale 缩放，solid = 参与碰撞
  const prop = (name, x, z, { ry = 0, sc = 1.4, sy = sc, solid = true, y = 0 } = {}) => {
    const o = props[name].clone();
    o.position.set(x, y, z); o.rotation.y = ry; o.scale.set(sc, sy, sc);
    o.traverse((m) => { if (m.isMesh && solid) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 35), B.M.edge)); });
    (solid ? B.solid : B.decor).add(o);
    return o;
  };

  // 地面 + 四周高玻璃墙（跳不出去）
  B.box(X * 2, 1, Z * 2, 0, -0.5, 0, 'floor');
  B.box(X * 2 + 1.2, 2.4, Z * 2 + 1.2, 0, -2.2, 0, 'gray', { solid: false });
  for (const s of [-1, 1]) {
    B.box(X * 2 + 1.2, 0.12, 0.12, 0, -1.0, s * (Z + 0.6), 'mint', { solid: false, edges: false });
    B.box(0.12, 0.12, Z * 2 + 1.2, s * (X + 0.6), -1.0, 0, 'mint', { solid: false, edges: false });
  }
  B.rail(-X, -Z, X, -Z, 0, 2.6); B.rail(X, -Z, X, Z, 0, 2.6); B.rail(X, Z, -X, Z, 0, 2.6); B.rail(-X, Z, -X, -Z, 0, 2.6);

  // —— 中央高台（顶面 1.2）+ 四面楼梯 + 中间挡视线的立柱 ——
  B.box(12, 1.2, 12, 0, 0.6, 0, 'floor');
  for (const s of [-1, 1]) {
    B.box(12.1, 0.14, 0.14, 0, 1.12, s * 6.02, 'mint', { solid: false, edges: false, shadow: false });
    B.box(0.14, 0.14, 12.1, s * 6.02, 1.12, 0, 'mint', { solid: false, edges: false, shadow: false });
  }
  B.stairs(0, 0, 8.2, '-z', 4, { w: 4 }); B.stairs(0, 0, -8.2, '+z', 4, { w: 4 });
  B.stairs(8.2, 0, 0, '-x', 4, { w: 4 }); B.stairs(-8.2, 0, 0, '+x', 4, { w: 4 });
  B.box(2.4, 4, 2.4, 0, 3.2, 0, 'stone');
  B.box(2.5, 0.15, 2.5, 0, 4.4, 0, 'mint', { solid: false, edges: false });
  B.prism(0, 7.4, 0, 1.1);
  for (const [x, z] of [[-4, -4], [4, 4]]) B.box(2.2, 1.1, 0.6, x, 1.75, z, 'stone', { ry: Math.PI / 4 });
  for (const [x, z] of [[4, -4], [-4, 4]]) B.box(2.2, 1.1, 0.6, x, 1.75, z, 'stone', { ry: -Math.PI / 4 });

  // —— 两边各一半，按 z 镜像 ——
  for (const s of [-1, 1]) {
    const team = s < 0 ? 'mint' : 'coral', hex = s < 0 ? '#33e6c8' : '#ff6b5e';
    // 基地：抬高 1 米的平台，前面整排台阶，后面高墙
    B.box(18, 1, 9, 0, 0.5, s * 40.5, 'stone');
    B.box(18.1, 0.14, 0.14, 0, 0.94, s * 36.02, team, { solid: false, edges: false, shadow: false });
    B.stairs(0, 0, s * (36 - 4 * 0.55), s < 0 ? '-z' : '+z', 4, { w: 18, rise: 0.25 });
    B.box(26, 6, 1, 0, 3, s * 46, 'stone');
    B.box(26.1, 0.2, 1.05, 0, 4.6, s * 46, team, { solid: false, edges: false });
    for (const x of [-12.5, 12.5]) B.box(1, 4, 10, x, 2, s * 41.5, 'stone');
    for (const x of [-6, 6]) B.box(2.6, 1.15, 0.7, x, 1.575, s * 38, 'stone');
    B.banner(-9, s * 45.2, 1, s < 0 ? 0 : Math.PI, 6, hex); B.banner(9, s * 45.2, 1, s < 0 ? 0 : Math.PI, 6, hex);
    // 地面上的队伍色引导线
    B.box(0.15, 0.02, 8, 0, 0.01, s * 28, team, { solid: false, edges: false, shadow: false });

    // 中路两侧的长墙（x = ±10），留出 z = 16–20 的门洞和中央通道
    for (const x of [-10, 10]) {
      B.box(1, 3.2, 8, x, 1.6, s * 12, 'stone');
      B.box(1, 3.2, 10, x, 1.6, s * 25, 'stone');
      B.box(1.05, 0.12, 8, x, 2.5, s * 12, team, { solid: false, edges: false, shadow: false });
    }
    // 中路掩体
    for (const x of [-4.5, 4.5]) { B.box(3, 1.15, 0.7, x, 0.575, s * 14, 'stone'); B.box(3.02, 0.08, 0.72, x, 1.17, s * 14, team, { solid: false, edges: false }); }
    B.box(1.8, 1.8, 1.8, 0, 0.9, s * 21, 'gray', { ry: 0.3 });
    for (const x of [-6, 6]) B.box(2, 2.6, 2, x, 1.3, s * 27, 'stone');
    // 基地前的屏风墙：挡住两边基地之间的直线视野，出生时不会被对面远距离点到
    B.box(9, 2.8, 0.8, 0, 1.4, s * 31.5, 'stone');
    B.box(9.05, 0.14, 0.85, 0, 2.2, s * 31.5, team, { solid: false, edges: false });

    // 左路：高架长廊（顶面 3 米），两端坡道
    B.ramp(-22, 0, s * 25, s < 0 ? '+z' : '-z', 10, 3, { w: 4.2 });
    B.box(3, 1.1, 0.6, -22.6, 3.55, s * 7, 'stone');
    B.box(1.6, 1.1, 0.6, -20.6, 3.55, s * 12.5, 'stone');
    for (const [x, z] of [[-27, 8], [-27.5, 17], [-17, 21]]) {
      B.box(1.6, 1.6, 1.6, x, 0.8, s * z, 'gray', { ry: Math.random() * 0.5 });
    }
    B.box(1.1, 1.1, 1.1, -27.3, 2.15, s * 8.2, 'stone', { ry: 0.6 });
    B.planter(-26, s * 29, 3);

    // 右路：街区掩体（Kenney Starter Kit 的墙块）
    prop('wall-high', 16, s * 9, { ry: 0 });
    prop('wall-high', 18.1, s * 9, { ry: 0 });
    prop('wall-high', 13.4, s * 10.4, { ry: Math.PI / 2 });
    prop('wall-low', 24, s * 13, { ry: Math.PI / 2 });
    prop('wall-high', 21, s * 19, { ry: 0 });
    prop('wall-high', 22.9, s * 20.4, { ry: Math.PI / 2 });
    prop('wall-low', 14.5, s * 22, { ry: 0.25 });
    prop('wall-high', 26.5, s * 26, { ry: 0 });
    prop('wall-low', 17, s * 30, { ry: 0 });
    prop('platform-large-grass', 25, s * 4.5, { sc: 1, sy: 0.84 });
    for (const [x, z] of [[24, 3], [26.5, 5.5], [23.5, 6.4], [15, 15], [27, 23], [12.5, 27]]) prop(Math.random() < 0.5 ? 'grass' : 'grass-small', x, s * z, { sc: 2, solid: false, ry: Math.random() * 6 });
    B.box(1.6, 1.6, 1.6, 19.5, 0.8, s * 26.5, 'gray', { ry: 0.2 });
    B.planter(27, s * 15, 2.6);
  }
  // 左路长廊主体（两半共用一段）
  B.box(5, 3, 30, -22, 1.5, 0, 'stone');
  B.box(5.05, 0.14, 30.05, -22, 2.96, 0, 'mint', { solid: false, edges: false, shadow: false });
  B.box(3, 1.1, 0.6, -22, 3.55, 0, 'stone');

  skyCity(B, { radius: 160 });

  const spawns = (s) => [-6, -3, 0, 3, 6].map((x, i) => new THREE.Vector3(x, 1, s * (39 + (i % 2) * 2.5)));
  // AI 会去争夺的位置（y 是大概高度，寻路时会贴到地面）
  const hot = [[0, 0, 1.2], [-22, 0, 3], [20, 0, 0], [0, 14, 0], [-22, 10, 3], [-25, 20, 0], [19, 14, 0], [16, 25, 0], [5, 27, 0], [-5, 18, 0], [24, 8, 0]];
  const hotspots = [];
  for (const [x, z, y] of hot) { hotspots.push(new THREE.Vector3(x, y, z)); if (z) hotspots.push(new THREE.Vector3(x, y, -z)); }
  return {
    ...B, mode: 'ranked', spawn: spawns(-1)[3], yaw: 0,
    teams: { ally: { spawns: spawns(-1), yaw: 0, home: new THREE.Vector3(0, 1, -40) }, enemy: { spawns: spawns(1), yaw: Math.PI, home: new THREE.Vector3(0, 1, 40) } },
    hotspots, fog: [0xdcefff, 70, 280], background: 0xcfe6fa,
  };
}
