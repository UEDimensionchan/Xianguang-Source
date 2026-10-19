# 设定图的乱翘短发：在 VRoid 头发上面加一层尖尾发束 + 呆毛
import random
random.seed(7)
def hair_mat():
    m = bpy.data.materials.get('ACC_Hair')
    if m: return m
    m = bpy.data.materials.new('ACC_Hair'); m.use_nodes = True
    nt = m.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(DIR + r"\hair_grad.png", check_existing=True)
    b.inputs['Base Color'].default_value = (0, 0, 0, 1); b.inputs['Specular IOR Level'].default_value = 0.0
    nt.links.new(tex.outputs[0], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = 1.0
    return m
HT = bvh(HAIR)
AX = Vector((0, 0.015, 0))
def hsurf(a, z):
    d = Vector((math.sin(a), -math.cos(a), 0)); c = AX + Vector((0, 0, z))
    loc, n, i, dist = HT.ray_cast(c + d * 0.4, -d, 0.6)
    return (loc, d) if loc else (None, d)
def lock(name, a_deg, z0, z1, width, flick=0.012, teal=False, drift=0.0, lift=0.003, n=10, fwd=0.0, thick=0.0028):
    a0 = math.radians(a_deg)
    pts = []; last = None
    for k in range(n + 1):
        s = k / n
        a = a0 + math.radians(drift) * s
        z = z0 + (z1 - z0) * s
        loc, d = hsurf(a, z)
        if loc is None:
            if last is None: continue
            loc = last[0] + (last[0] - (pts[-2] if len(pts) > 1 else last[0] + Vector((0, 0, 0.01)))).normalized() * 0
            loc = last[0] + Vector((0, 0, z - last[0].z)) + d * 0.004
        lf = -0.006 + (lift + 0.006) * min(1.0, s / 0.3)  # 发根埋进头发里
        p = loc + d * (lf + flick * s ** 2.2) + Vector((0, -fwd * s, 0))
        pts.append(p); last = (loc, d)
    if len(pts) < 3: return None
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    rings = []
    m = len(pts)
    for k, p in enumerate(pts):
        s = k / (m - 1)
        t = (pts[min(k + 1, m - 1)] - pts[max(k - 1, 0)]).normalized()
        out = (p - (AX + Vector((0, 0, p.z)))); out.z = 0; out.normalize()
        side = t.cross(out).normalized(); nrm = side.cross(t).normalized()
        w = width * (1 - s) ** 1.15 * (0.7 + 0.3 * min(1.0, s * 4)); th = thick * (1 - s) ** 0.9 + 0.0004
        if k == m - 1: w = 0.0006; th = 0.0004
        prof = [(-0.5, 0), (-0.25, 0.5), (0.25, 0.5), (0.5, 0), (0.25, -0.5), (-0.25, -0.5)]
        rings.append([bm.verts.new(p + side * (w * u) + nrm * (th * v)) for u, v in prof])
    col = 0.75 if teal else 0.25
    for k in range(m - 1):
        A, B = rings[k], rings[k + 1]
        for i in range(6):
            j = (i + 1) % 6
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
            for l, (uu, vv) in zip(f.loops, [(col, 1 - k / (m - 1)), (col, 1 - k / (m - 1)), (col, 1 - (k + 1) / (m - 1)), (col, 1 - (k + 1) / (m - 1))]):
                l[uv].uv = (uu, max(0.01, min(0.99, vv)))
    f = bm.faces.new(list(reversed(rings[0])))
    for l in f.loops: l[uv].uv = (col, 0.99)
    o = mk(name, bm, mat=hair_mat(), smooth=True)
    return o

for o in [o for o in coll().objects if o.name.startswith('Acc_Lock')]: bpy.data.objects.remove(o)
# 外层乱翘发束（侧面、后面）
k = 0
for a in list(range(60, 301, 17)):
    z1 = 1.468 + random.uniform(-0.006, 0.03) if 70 < a < 290 else 1.47 + random.uniform(0, 0.02)
    lock(f'Acc_Lock_Out{k}', a + random.uniform(-4, 4), 1.625 + random.uniform(-0.01, 0.02), z1, random.uniform(0.028, 0.042),
         flick=random.uniform(0.008, 0.02) * (1.4 if (60 < a < 130 or 230 < a < 300) else 0.8), drift=random.uniform(-9, 9)); k += 1
# 第二层：短一点，交错
for a in list(range(60, 300, 23)):
    lock(f'Acc_Lock_Mid{k}', a + 8, 1.6, 1.5 + random.uniform(0, 0.025), random.uniform(0.024, 0.032), flick=0.008, drift=random.uniform(-12, 12), lift=0.006); k += 1
# 内层薄荷色发梢
for a in list(range(75, 290, 26)):
    lock(f'Acc_Lock_Teal{k}', a + 5, 1.54, 1.462 + random.uniform(-0.004, 0.012), 0.024, flick=0.006, teal=True, lift=-0.002, drift=random.uniform(-6, 6)); k += 1
# 脸两侧的鬓发（到下巴）
for s in (1, -1):
    lock(f'Acc_Lock_Side{k}', 56 * s, 1.575, 1.462, 0.028, flick=0.004, drift=-3 * s, fwd=0.004); k += 1
    lock(f'Acc_Lock_Side{k}', 52 * s, 1.56, 1.475, 0.02, flick=0.002, drift=-4 * s, fwd=0.005, teal=True, lift=0.001); k += 1
# 刘海：尖、乱，中间一缕垂到两眼之间
for a, z1, w in [(-24, 1.56, 0.022), (12, 1.556, 0.022), (3, 1.53, 0.012)]:
    lock(f'Acc_Lock_Bang{k}', a, 1.64, z1, w, flick=0.004, drift=random.uniform(-10, 10), lift=0.002, n=8); k += 1
# 呆毛
def ahoge(name, root, ctrl, tip, width):
    pts = []
    for i in range(9):
        t = i / 8
        p = (1 - t) ** 2 * Vector(root) + 2 * (1 - t) * t * Vector(ctrl) + t * t * Vector(tip); pts.append(p)
    bm = bmesh.new(); uv = bm.loops.layers.uv.new(); rings = []
    for i, p in enumerate(pts):
        s = i / 8; tt = (pts[min(i + 1, 8)] - pts[max(i - 1, 0)]).normalized()
        side = tt.cross(Vector((1, 0, 0))).normalized(); nrm = side.cross(tt).normalized()
        w = width * (1 - s) ** 0.8 + 0.0005; th = 0.004 * (1 - s) + 0.0003
        rings.append([bm.verts.new(p + side * (w * u) + nrm * (th * v)) for u, v in [(-0.5, 0), (0, 0.5), (0.5, 0), (0, -0.5)]])
    for i in range(8):
        for j in range(4):
            f = bm.faces.new((rings[i][j], rings[i][(j + 1) % 4], rings[i + 1][(j + 1) % 4], rings[i + 1][j]))
            for l in f.loops: l[uv].uv = (0.25, 1 - i / 8 * 0.6)
    return mk(name, bm, mat=hair_mat(), smooth=True)
for o in [o for o in coll().objects if o.name.startswith('Acc_Ahoge')]: bpy.data.objects.remove(o)
top = Vector((0, 0.01, 1.706))
ahoge('Acc_Ahoge1', top + Vector((0.004, 0, -0.004)), top + Vector((0.01, -0.03, 0.06)), top + Vector((0.035, -0.055, 0.04)), 0.014)
ahoge('Acc_Ahoge2', top + Vector((-0.004, 0.006, -0.004)), top + Vector((-0.012, 0.0, 0.055)), top + Vector((-0.03, 0.03, 0.05)), 0.012)
ahoge('Acc_Ahoge3', top + Vector((0.0, 0.02, -0.006)), top + Vector((0.004, 0.04, 0.04)), top + Vector((0.02, 0.07, 0.035)), 0.01)
