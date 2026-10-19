import * as THREE from 'three';
import { TUNING } from './config.js';

const T = TUNING.dummy;
const _m = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _sphere = new THREE.Sphere();

// 纸片靶子在本地坐标下的命中盒（前后很薄）
const BODY_BOX = new THREE.Box3(new THREE.Vector3(-0.38, 0, -0.04), new THREE.Vector3(0.38, 1.36, 0.04));
const HEAD_BOX = new THREE.Box3(new THREE.Vector3(-0.19, 1.34, -0.04), new THREE.Vector3(0.19, 1.76, 0.04));

const COLORS = [0xff8fa3, 0x8fc9ff, 0xffc878, 0xa8e6a1, 0xc9a8ff];

// 训练场靶子：会横移、会纸化（侧身变成一条线）、会丢纸飞机
export class Dummies {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.planes = [];
    this.planeGeo = makePaperPlaneGeo();
    this.planeMat = new THREE.MeshToonMaterial({ color: 0xffffff, side: THREE.DoubleSide, gradientMap: game.gradient });
    for (let i = 0; i < T.count; i++) this.list.push(this._make(i));
  }

  _make(i) {
    const group = new THREE.Group();
    const color = COLORS[i % COLORS.length];
    const front = new THREE.MeshToonMaterial({ color, gradientMap: this.game.gradient });
    const edge = new THREE.MeshToonMaterial({ color: 0xfbf7ee, gradientMap: this.game.gradient });
    const ink = new THREE.MeshBasicMaterial({ color: 0x2a2a40 });

    const body = new THREE.Mesh(makeBodyGeo(), [front, edge]);
    const head = new THREE.Mesh(
      new THREE.ExtrudeGeometry(circleShape(0.19), { depth: 0.04, bevelEnabled: false, curveSegments: 20 }).translate(0, 1.55, -0.02),
      [front, edge]);
    // 脸：两只眼睛，前后都画
    for (const z of [0.025, -0.025]) {
      for (const x of [-0.07, 0.07]) {
        const eye = new THREE.Mesh(new THREE.CircleGeometry(0.03, 10), ink);
        eye.position.set(x, 1.58, z);
        if (z < 0) eye.rotation.y = Math.PI;
        group.add(eye);
      }
    }
    // 胸口靶环
    for (const z of [0.022, -0.022]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 24), ink);
      ring.position.set(0, 0.95, z);
      if (z < 0) ring.rotation.y = Math.PI;
      group.add(ring);
    }
    body.castShadow = head.castShadow = true;
    group.add(body, head);

    // 头顶血条
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.07), new THREE.MeshBasicMaterial({ color: 0x222233, transparent: true, opacity: 0.6 }));
    const barFg = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.07).translate(0.35, 0, 0), new THREE.MeshBasicMaterial({ color: 0xff5c7a, polygonOffset: true, polygonOffsetFactor: -1 }));
    barFg.position.x = -0.35;
    barBg.renderOrder = barFg.renderOrder = 10;
    const bar = new THREE.Group();
    bar.add(barBg, barFg);
    bar.position.y = 2.0;
    this.game.scene.add(bar);

    this.game.scene.add(group);
    const d = {
      group, bar, barFg, front,
      hp: T.hp, alive: false, deadT: 0, respawnT: 0.5 + i * 0.4,
      yaw: 0, paperAmt: 0, paperT: 2 + Math.random() * 3, paperOn: false,
      strafeDir: new THREE.Vector3(1, 0, 0), strafeSign: 1, strafeT: 0,
      fireT: 2 + Math.random() * 2, flashT: 0,
    };
    group.visible = bar.visible = false;
    return d;
  }

  _spawn(d) {
    // 优先刷在玩家看得见的位置
    let p = null;
    const eye = this.game.player.chestPosition(new THREE.Vector3());
    for (let k = 0; k < 12; k++) {
      const [r0, r1] = this.game.dummyRange || [9, 30];
      const c = this.game.randomSpawn(r0, r1);
      const from = c.clone(); from.y += 1.2;
      const dist = from.distanceTo(eye);
      if (!this.game.raycastWorld(from, eye.clone().sub(from), dist - 0.5)) { p = c; break; }
      if (!p) p = c;
    }
    d.group.position.copy(p);
    d.hp = T.hp;
    d.alive = true;
    d.deadT = 0;
    d.group.visible = d.bar.visible = true;
    d.group.rotation.set(0, 0, 0);
    d.group.scale.setScalar(1);
    d.paperOn = false;
    d.paperAmt = 0;
    d.fireT = 1.5 + Math.random() * 2;
    const a = Math.random() * Math.PI * 2;
    d.strafeDir.set(Math.cos(a), 0, Math.sin(a));
  }

  update(dt) {
    const player = this.game.player;
    const target = player.chestPosition(_v2);

    for (const d of this.list) {
      if (!d.alive) {
        if (d.deadT > 0) { // 倒下动画
          d.deadT += dt;
          const k = Math.min(1, d.deadT / 0.35);
          d.group.rotation.x = -k * Math.PI / 2;
          d.group.position.y -= dt * 0.4;
          if (d.deadT > 1.2) { d.group.visible = false; d.deadT = 0; }
        }
        d.respawnT -= dt;
        if (d.respawnT <= 0) this._spawn(d);
        continue;
      }

      // 横移，遇到墙或悬崖就掉头
      d.strafeT -= dt;
      if (d.strafeT <= 0) { d.strafeSign *= -1; d.strafeT = 1.2 + Math.random() * 2.2; }
      const step = _v.copy(d.strafeDir).multiplyScalar(d.strafeSign * T.strafeSpeed * dt * (d.paperOn ? 1.6 : 1));
      const next = _hit.copy(d.group.position).add(step);
      const floor = this.game.raycastWorld(_v.set(next.x, next.y + 1.5, next.z), new THREE.Vector3(0, -1, 0), 3);
      const blocked = this.game.raycastWorld(_v.copy(d.group.position).setY(d.group.position.y + 0.9), step.clone().normalize(), 0.6);
      if (floor && !blocked && Math.abs(floor.position.y - d.group.position.y) < 0.6) {
        d.group.position.set(next.x, floor.position.y, next.z);
      } else {
        d.strafeSign *= -1;
      }

      // 朝向玩家；纸化时再转 90°，变成一条线
      d.paperT -= dt;
      if (d.paperT <= 0) {
        d.paperOn = !d.paperOn;
        d.paperT = d.paperOn ? 1.2 + Math.random() * 1.0 : 2.5 + Math.random() * 3.5;
      }
      d.paperAmt += ((d.paperOn ? 1 : 0) - d.paperAmt) * Math.min(1, dt * 12);
      const dx = target.x - d.group.position.x, dz = target.z - d.group.position.z;
      d.yaw = Math.atan2(dx, dz);
      d.group.rotation.y = d.yaw + d.paperAmt * Math.PI / 2;

      // 受击闪白
      d.flashT = Math.max(0, d.flashT - dt);
      d.front.emissive.setScalar(d.flashT > 0 ? 0.6 : 0);

      // 丢纸飞机
      d.fireT -= dt;
      if (d.fireT <= 0 && !d.paperOn && player.alive) {
        d.fireT = 2.2 + Math.random() * 2.0;
        const from = _v.copy(d.group.position); from.y += 1.2;
        const dist = from.distanceTo(target);
        if (dist < 40 && !this.game.raycastWorld(from, target.clone().sub(from).normalize(), dist - 0.3)) {
          this._firePlane(from.clone(), target.clone());
        }
      }

      // 血条
      d.bar.position.set(d.group.position.x, d.group.position.y + 2.0, d.group.position.z);
      d.bar.quaternion.copy(this.game.camera.quaternion);
      d.barFg.scale.x = Math.max(0.001, d.hp / T.hp);
    }

    this._updatePlanes(dt, player);
  }

  _firePlane(from, to) {
    const m = new THREE.Mesh(this.planeGeo, this.planeMat);
    m.castShadow = true;
    m.position.copy(from);
    // 稍微加一点随机，别每发都正中
    to.x += (Math.random() - 0.5) * 0.5;
    to.y += (Math.random() - 0.5) * 0.4;
    const vel = to.sub(from).normalize().multiplyScalar(T.projectileSpeed);
    m.lookAt(from.clone().add(vel));
    this.game.scene.add(m);
    this.planes.push({ mesh: m, vel, t: 0, src: from.clone() });
    this.game.sfx.play('enemyShoot', 0.25, 1.3);
  }

  _updatePlanes(dt, player) {
    for (let i = this.planes.length - 1; i >= 0; i--) {
      const p = this.planes[i];
      p.t += dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotateZ(dt * 3);
      _sphere.set(p.mesh.position, 0.06);
      let remove = p.t > 5 || this.game.octree.sphereIntersect(_sphere);
      if (!remove && player.alive && player.hitTest(p.mesh.position, 0.07)) {
        player.damage(T.projectileDamage, p.src);
        remove = true;
      }
      if (remove) {
        this.game.scene.remove(p.mesh);
        this.planes.splice(i, 1);
      }
    }
  }

  // 射线命中检测：返回 {dummy, distance, point, head}
  raycast(ray, maxDist) {
    let best = null;
    for (const d of this.list) {
      if (!d.alive) continue;
      _m.copy(d.group.matrixWorld).invert();
      _ray.copy(ray).applyMatrix4(_m);
      for (const [box, head] of [[HEAD_BOX, true], [BODY_BOX, false]]) {
        if (_ray.intersectBox(box, _hit)) {
          _hit.applyMatrix4(d.group.matrixWorld);
          const dist = _hit.distanceTo(ray.origin);
          if (dist < maxDist && (!best || dist < best.distance)) {
            best = { dummy: d, distance: dist, point: _hit.clone(), head };
          }
        }
      }
    }
    return best;
  }

  damage(d, amount, point, head) {
    if (!d.alive) return false;
    d.hp -= amount;
    d.flashT = 0.08;
    this.game.hud.damageNumber(point, amount, head);
    if (d.hp <= 0) {
      d.alive = false;
      d.deadT = 0.001;
      d.respawnT = T.respawn;
      d.bar.visible = false;
      this.game.onKill(head);
      return true;
    }
    return false;
  }

  explode(pos, radius, dmg) {
    let hits = 0;
    for (const d of this.list) {
      if (!d.alive) continue;
      _v.copy(d.group.position); _v.y += 0.9;
      const dist = _v.distanceTo(pos);
      if (dist < radius) {
        const amount = dmg * (1 - (dist / radius) * 0.6);
        this.damage(d, amount, _v.clone(), false);
        hits++;
      }
    }
    if (hits) this.game.hud.hit(false, false);
  }

  nearPoint(pos, r) {
    for (const d of this.list) {
      if (!d.alive) continue;
      _v.copy(d.group.position); _v.y += 0.9;
      if (Math.abs(_v.x - pos.x) < r && Math.abs(_v.z - pos.z) < r && Math.abs(_v.y - pos.y) < 1.0) return d;
    }
    return null;
  }
}

function circleShape(r) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  return s;
}

function makeBodyGeo() {
  // 剪纸人形：肩、手臂、腿
  const s = new THREE.Shape();
  s.moveTo(-0.12, 0);
  s.lineTo(-0.2, 0);
  s.lineTo(-0.24, 0.72);
  s.lineTo(-0.36, 0.7);
  s.lineTo(-0.38, 1.22);
  s.quadraticCurveTo(-0.36, 1.33, -0.22, 1.34);
  s.lineTo(0.22, 1.34);
  s.quadraticCurveTo(0.36, 1.33, 0.38, 1.22);
  s.lineTo(0.36, 0.7);
  s.lineTo(0.24, 0.72);
  s.lineTo(0.2, 0);
  s.lineTo(0.12, 0);
  s.lineTo(0.03, 0.55);
  s.lineTo(-0.03, 0.55);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false }).translate(0, 0, -0.02);
}

function makePaperPlaneGeo() {
  // 折纸飞机：两片三角翼 + 机身，朝 +Z 飞
  const g = new THREE.BufferGeometry();
  const v = [
    0, 0, 0.32,  -0.16, 0.0, -0.18,  0, -0.03, -0.14,
    0, 0, 0.32,   0, -0.03, -0.14,    0.16, 0.0, -0.18,
    0, 0, 0.32,   0, -0.03, -0.14,    0, -0.09, -0.18,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
