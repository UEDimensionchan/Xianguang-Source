import * as THREE from 'three';

// AI 寻路用的网格：俯视地图，每 1 米一个格子，记录这里能不能站、地面多高。
// 相邻格子之间高差小（台阶、坡道）并且中间没有墙，就算连通。用 A* 找路，再把路径拉直。
// 地图里不做能从下面穿过去的桥（高度图只记最上面那层）。
const STEP = 0.55;      // 能走上去的高差（楼梯、坡道每格的高差都在这以内）
const HEAD = 1.7;       // 头顶净空

export class NavGrid {
  constructor(game, box, cell = 1) {
    this.game = game;
    this.cell = cell;
    this.x0 = Math.floor(box.min.x) + cell / 2;
    this.z0 = Math.floor(box.min.z) + cell / 2;
    this.w = Math.ceil((box.max.x - box.min.x) / cell);
    this.h = Math.ceil((box.max.z - box.min.z) / cell);
    const n = this.w * this.h;
    this.height = new Float32Array(n).fill(NaN);
    this.near = new Uint8Array(n);       // 靠墙（寻路代价高一点，AI 不贴着墙走）
    this.link = new Uint8Array(n);       // 4 个方向是否连通：1 +x，2 -x，4 +z，8 -z
    const top = box.max.y + 2;
    const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
    const o = new THREE.Vector3();
    const under = game.navUnder || [];
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const x = this.x0 + i * cell, z = this.z0 + j * cell;
        let hit = game.raycastWorld(o.set(x, top, z), down);
        // 天桥、屋顶这类地图标记为「下面也能走」的区域（built.navUnder：Box3 列表）：从它底下再找一次地面
        for (let g = 0; hit && under.length && g < 3; g++) {
          const u = under.find((b) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && hit.position.y >= b.min.y - 0.01 && hit.position.y <= b.max.y + 0.01);
          if (!u) break;
          hit = game.raycastWorld(o.set(x, u.min.y - 0.05, z), down);
        }
        if (!hit || hit.normal.y < 0.7) continue;
        if (game.raycastWorld(o.set(x, hit.position.y + 0.1, z), up, HEAD)) continue;
        this.height[j * this.w + i] = hit.position.y;
      }
    }
    // 连通：高差够小，并且在腰和胸的高度横着打一条射线看中间有没有墙
    const dir = new THREE.Vector3();
    const tryLink = (i, j, di, dj, bit, back) => {
      const a = j * this.w + i, i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= this.w || j2 >= this.h) return;
      const b = j2 * this.w + i2;
      const ha = this.height[a], hb = this.height[b];
      if (Number.isNaN(ha) || Number.isNaN(hb) || Math.abs(ha - hb) > STEP) { if (!Number.isNaN(ha)) this.near[a] = 1; return; }
      const y = Math.max(ha, hb);
      dir.set(di, 0, dj);
      for (const dy of [0.5, 1.3]) {
        if (game.raycastWorld(o.set(this.x0 + i * cell, y + dy, this.z0 + j * cell), dir, cell)) { this.near[a] = this.near[b] = 1; return; }
      }
      this.link[a] |= bit; this.link[b] |= back;
    };
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      if (Number.isNaN(this.height[j * this.w + i])) continue;
      tryLink(i, j, 1, 0, 1, 2);
      tryLink(i, j, 0, 1, 4, 8);
    }
    this.walkable = 0;
    for (let k = 0; k < n; k++) if (this.link[k]) this.walkable++;
  }

  idx(x, z) {
    const i = Math.round((x - this.x0) / this.cell), j = Math.round((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }
  pos(k, out = new THREE.Vector3()) {
    const i = k % this.w, j = (k - i) / this.w;
    return out.set(this.x0 + i * this.cell, this.height[k], this.z0 + j * this.cell);
  }

  // 找离 (x, z) 最近的、能走的格子（站在箱子上、墙边时用）
  nearest(p, maxR = 6) {
    let k = this.idx(p.x, p.z);
    if (k >= 0 && this.link[k] && Math.abs(this.height[k] - p.y) < 2.5) return k;
    let best = -1, bd = Infinity;
    const ci = Math.round((p.x - this.x0) / this.cell), cj = Math.round((p.z - this.z0) / this.cell);
    for (let r = 1; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        k = j * this.w + i;
        if (!this.link[k]) continue;
        const d = di * di + dj * dj + (this.height[k] - p.y) ** 2 * 4;
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  randomCell() {
    for (let t = 0; t < 200; t++) {
      const k = Math.floor(Math.random() * this.link.length);
      if (this.link[k] && !this.near[k]) return k;
    }
    return -1;
  }

  // A*：返回世界坐标路径点（已拉直）；找不到返回 null
  findPath(from, to) {
    const s = this.nearest(from), g = this.nearest(to);
    if (s < 0 || g < 0) return null;
    if (s === g) return [this.pos(g)];
    const n = this.link.length;
    const cost = this._cost || (this._cost = new Float32Array(n));
    const came = this._came || (this._came = new Int32Array(n));
    const seen = this._seen || (this._seen = new Uint32Array(n));
    this._stamp = (this._stamp || 0) + 1;
    const stamp = this._stamp;
    const gi = g % this.w, gj = (g - gi) / this.w;
    const heur = (k) => { const i = k % this.w, j = (k - i) / this.w; const dx = Math.abs(i - gi), dz = Math.abs(j - gj); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    const heap = new MinHeap();
    seen[s] = stamp; cost[s] = 0; came[s] = -1;
    heap.push(s, heur(s));
    const W = this.w;
    let found = false, iter = 0;
    const link = this.link, near = this.near;
    const relax = (k, m, c) => {
      const nc = cost[k] + c + (near[m] ? 1.5 : 0);
      if (seen[m] !== stamp || nc < cost[m]) { seen[m] = stamp; cost[m] = nc; came[m] = k; heap.push(m, nc + heur(m)); }
    };
    while (heap.size && iter++ < 8000) {
      const k = heap.pop();
      if (k === g) { found = true; break; }
      const L = link[k];
      // 8 个方向：斜着走要求两条直边都通（不建临时数组，少分配内存）
      if (L & 1) relax(k, k + 1, 1);
      if (L & 2) relax(k, k - 1, 1);
      if (L & 4) relax(k, k + W, 1);
      if (L & 8) relax(k, k - W, 1);
      if ((L & 1) && (L & 4) && (link[k + 1] & 4) && (link[k + W] & 1)) relax(k, k + W + 1, Math.SQRT2);
      if ((L & 2) && (L & 4) && (link[k - 1] & 4) && (link[k + W] & 2)) relax(k, k + W - 1, Math.SQRT2);
      if ((L & 1) && (L & 8) && (link[k + 1] & 8) && (link[k - W] & 1)) relax(k, k - W + 1, Math.SQRT2);
      if ((L & 2) && (L & 8) && (link[k - 1] & 8) && (link[k - W] & 2)) relax(k, k - W - 1, Math.SQRT2);
    }
    if (!found) return null;
    const cells = [];
    for (let k = g; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    return this._smooth(cells);
  }

  // 拉直：从当前点往后找最远的、中间格子都连通的点
  _smooth(cells) {
    const out = [];
    let a = 0;
    while (a < cells.length - 1) {
      let b = Math.min(cells.length - 1, a + 12);
      while (b > a + 1 && !this._straight(cells[a], cells[b])) b--;
      out.push(this.pos(cells[b]));
      a = b;
    }
    return out;
  }

  _straight(ka, kb) {
    const ai = ka % this.w, aj = (ka - ai) / this.w, bi = kb % this.w, bj = (kb - bi) / this.w;
    const steps = Math.max(Math.abs(bi - ai), Math.abs(bj - aj)) * 2;
    let prev = ka;
    for (let t = 1; t <= steps; t++) {
      const i = Math.round(ai + (bi - ai) * t / steps), j = Math.round(aj + (bj - aj) * t / steps);
      const k = j * this.w + i;
      if (k === prev) continue;
      if (!this.link[k] || this.near[k]) return false;
      // 相邻两格必须直接连通（斜着跨的话两条直边都要通）
      const pi = prev % this.w, pj = (prev - pi) / this.w;
      const di = i - pi, dj = j - pj;
      const ok = (di === 1 && dj === 0 && (this.link[prev] & 1)) || (di === -1 && dj === 0 && (this.link[prev] & 2))
        || (dj === 1 && di === 0 && (this.link[prev] & 4)) || (dj === -1 && di === 0 && (this.link[prev] & 8))
        || (Math.abs(di) === 1 && Math.abs(dj) === 1 && (this.link[prev] & (di > 0 ? 1 : 2)) && (this.link[prev] & (dj > 0 ? 4 : 8))
          && (this.link[prev + di] & (dj > 0 ? 4 : 8)) && (this.link[prev + dj * this.w] & (di > 0 ? 1 : 2)));
      if (!ok) return false;
      prev = k;
    }
    return true;
  }
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p;
    let i = K.length; K.push(k); P.push(p);
    while (i > 0) {
      const u = (i - 1) >> 1;
      if (P[u] <= P[i]) break;
      let t = K[u]; K[u] = K[i]; K[i] = t; t = P[u]; P[u] = P[i]; P[i] = t;
      i = u;
    }
  }
  pop() {
    const K = this.k, P = this.p, top = K[0];
    const lk = K.pop(), lp = P.pop();
    if (K.length) {
      K[0] = lk; P[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < K.length && P[l] < P[m]) m = l;
        if (r < K.length && P[r] < P[m]) m = r;
        if (m === i) break;
        let t = K[m]; K[m] = K[i]; K[i] = t; t = P[m]; P[m] = P[i]; P[i] = t;
        i = m;
      }
    }
    return top;
  }
}
