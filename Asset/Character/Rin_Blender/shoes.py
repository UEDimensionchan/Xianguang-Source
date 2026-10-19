# 设定图里的高帮运动靴：鞋身/鞋底用截面放样重新做，鞋筒沿用之前的靴筒
def rm(n):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o)
SEC = [  # (t, 半宽, 鞋面高度)
    (0.00, 0.040, 0.135), (0.12, 0.047, 0.15), (0.30, 0.052, 0.15), (0.45, 0.054, 0.125),
    (0.60, 0.056, 0.095), (0.74, 0.055, 0.072), (0.86, 0.050, 0.058), (0.94, 0.040, 0.048), (1.0, 0.024, 0.040)]
Y0, Y1, Z0 = 0.102, -0.15, 0.03
def sec_y(t): return Y0 + (Y1 - Y0) * t
def ring_pts(cx, y, w, h, z0, K=14, e=0.55, flat=4):
    pts = []
    for k in range(K + 1):
        a = math.pi * k / K
        c, s_ = math.cos(a), math.sin(a)
        x = cx + w * (abs(c) ** e) * (1 if c >= 0 else -1)
        z = z0 + (h - z0) * (abs(s_) ** e)
        pts.append(Vector((x, y, z)))
    for k in range(1, flat):  # 底边
        pts.append(Vector((cx - w + 2 * w * k / flat, y, z0)))
    return pts
def loft(name, cx, sections, z0, key, grow=0.0, cap=True):
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    rings = []
    for t, w, h in sections:
        rings.append([bm.verts.new(p) for p in ring_pts(cx, sec_y(t), w + grow, h + grow, z0 - grow * 0.2)])
    n = len(rings[0])
    for r in range(len(rings) - 1):
        A, B = rings[r], rings[r + 1]
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
            for l in f.loops: l[uv].uv = uvr(key, 0.5, 0.5)
    if cap:
        for R_, rev in ((rings[0], True), (rings[-1], False)):
            f = bm.faces.new(list(reversed(R_)) if rev else R_)
            for l in f.loops: l[uv].uv = uvr(key, 0.5, 0.5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mk(name, bm, smooth=True)
    sub = o.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
    return o
def outline_slab(name, cx, z0, z1, grow, key, toe_up=0.0):
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    left = [(cx - w - grow, sec_y(t)) for t, w, h in SEC]
    right = [(cx + w + grow, sec_y(t)) for t, w, h in SEC]
    poly = right + [(cx, Y1 - grow * 0.9)] + list(reversed(left)) + [(cx, Y0 + grow * 0.9)]
    def ztop(y):
        t = (y - Y0) / (Y1 - Y0); return z1 + toe_up * max(0, (t - 0.75) / 0.25) ** 1.5
    bot = [bm.verts.new((x, y, z0)) for x, y in poly]
    top = [bm.verts.new((x, y, ztop(y))) for x, y in poly]
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((bot[i], bot[j], top[j], top[i]))
        for l in f.loops: l[uv].uv = uvr(key, 0.5, 0.5)
    for ring, rev in ((bot, True), (top, False)):
        f = bm.faces.new(list(reversed(ring)) if rev else ring)
        for l in f.loops: l[uv].uv = uvr(key, 0.5, 0.5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mk(name, bm)
    b = o.modifiers.new('bev', 'BEVEL'); b.width = 0.003; b.segments = 2
    return o
def upper_point(cx, t, side=0.0):
    """鞋面顶部（t 位置，side=-1..1 横向）"""
    for tt in range(len(SEC) - 1):
        a, b = SEC[tt], SEC[tt + 1]
        if a[0] <= t <= b[0]:
            k = (t - a[0]) / (b[0] - a[0]); w = a[1] + (b[1] - a[1]) * k; h = a[2] + (b[2] - a[2]) * k
            ang = math.acos(max(-1, min(1, side)))
            c, s_ = math.cos(ang), math.sin(ang)
            return Vector((cx + w * (abs(c) ** 0.55) * (1 if c >= 0 else -1), sec_y(t), Z0 + (h - Z0) * (abs(s_) ** 0.55)))
    return None

for s, nm in [(1, 'L'), (-1, 'R')]:
    cx = 0.077 * s
    for k in ['Acc_ShoeUpper_', 'Acc_ShoeSole_', 'Acc_ShoeMid_', 'Acc_ShoeHeel_', 'Acc_ShoeTongue_', 'Acc_BootSole_', 'Acc_BootToe_', 'Acc_BootTongue_']: rm(k + nm)
    for o in [o for o in coll().objects if o.name.startswith(('Acc_BootLace', 'Acc_ShoeLace', 'Acc_ShoeEyelet')) and o.name.endswith(nm)]: bpy.data.objects.remove(o)
    # 旧靴子只留鞋筒（z>0.11）
    boot = bpy.data.objects['Acc_Boot_' + nm]
    bm = bmesh.new(); bm.from_mesh(boot.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < 0.115], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(boot.data); bm.free()
    loft('Acc_ShoeUpper_' + nm, cx, SEC, Z0, 'white')
    outline_slab('Acc_ShoeSole_' + nm, cx, -0.006, 0.014, 0.0105, 'black', toe_up=0.026)
    outline_slab('Acc_ShoeMid_' + nm, cx, 0.012, 0.034, 0.0085, 'white', toe_up=0.008)
    # 后跟薄荷色块
    hb = surf((cx, 0.0, 0.16), (0, -1, 0))
    quad('Acc_ShoeHeel_' + nm, (cx, (hb.y + 0.016) if hb else Y0, 0.15), 0.04, 0.09, normal=(0, 1, 0), key='teal', thick=0.002)
    # 鞋舌 + 鞋带：脚背到鞋筒前面
    path = [upper_point(cx, t) + Vector((0, 0, 0.004)) for t in (0.68, 0.6, 0.52, 0.45)]
    for z in (0.15, 0.18, 0.21, 0.24, 0.26):
        h = surf((cx, 0, z), (0, 1, 0))
        if h: path.append(h + Vector((0, -0.0135, 0)))
    strip('Acc_ShoeTongue_' + nm, path, 0.032, normal_hint=(0, -0.6, 0.8), key='black', thick=0.0015)
    k = 0
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        dvec = (b - a); nrm = Vector((0, -0.6, 0.8)) if i < 3 else Vector((0, -1, 0))
        side = dvec.cross(nrm).normalized() * 0.014
        lift = nrm.normalized() * 0.003
        strip(f'Acc_ShoeLace{k}_{nm}', [a - side + lift, b + side + lift], 0.0045, normal_hint=tuple(nrm), key='white', thick=0.002); k += 1
        strip(f'Acc_ShoeLace{k}_{nm}', [a + side + lift, b - side + lift], 0.0045, normal_hint=tuple(nrm), key='white', thick=0.002); k += 1
        for sd in (-1, 1):
            box(f'Acc_ShoeEyelet{k}_{sd}_{nm}', a + side * 1.25 * sd + lift, (0.005, 0.005, 0.005), mat=metal_mat())
