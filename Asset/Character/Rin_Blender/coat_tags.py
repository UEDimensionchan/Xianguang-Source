# 根据当前外套形状重建外套上的挂饰（外套改形后重新跑）
exec(open(DIR + r"\rinlib.py", encoding='utf-8').read()) if 'DIR' in dir() else None
for o in [o for o in coll().objects if o.name.startswith(('Acc_TagEdge', 'Acc_TagHem', 'Acc_TagCoatSide'))]: bpy.data.objects.remove(o)
_bvh.clear(); _full.clear()
keep = inner_mask(BODY.data); me = BODY.data
cv = set()
for p in me.polygons:
    if p.index not in keep and p.material_index == 2 and abs(p.center.x) < 0.4 and p.center.z < 1.3: cv.update(p.vertices)
coat = [me.vertices[i].co.copy() for i in cv]
def edge_x(z):
    c = [v for v in coat if abs(v.z - z) < 0.012 and v.x > 0 and v.y < 0.0]
    return min(c, key=lambda v: v.x).x if c else None
def lowest(x0, ymin, ymax):
    c = [v for v in coat if abs(v.x - x0) < 0.008 and ymin < v.y < ymax]
    return min(c, key=lambda v: v.z) if c else None
zs = [1.22 - i * 0.03 for i in range(30)]
E = [(z, edge_x(z)) for z in zs]
E = [(z, x) for z, x in E if x is not None]
# 前襟：沿边缘往外 1.4cm 缝一条（上下两段）
for s, nm in [(1, 'L'), (-1, 'R')]:
    for tag, zr, key in [('Up', (1.22, 0.97), 'tagB'), ('Lo', (0.95, 0.62), 'tagA')]:
        pts = []
        for z, x in E:
            if zr[1] <= z <= zr[0]:
                h, n = full_hit(((x + 0.016) * s, -0.6, z), (0, 1, 0))
                if h: pts.append(h + Vector((0, -0.003, 0)))
        if len(pts) > 2: strip(f'Acc_TagEdge{tag}_{nm}', pts, 0.026, normal_hint=(0, -1, 0), key=key, thick=0.0015)
    # 下摆垂下来的尖尾挂饰
    lows = []
    for x0, yr, L, key, nrm in [(0.2, (-0.12, -0.03), 0.2, 'tagA', (0.2, -1, 0)), (0.26, (-0.1, 0.02), 0.24, 'tagB', (0.6, -0.8, 0)),
                               (0.3, (-0.05, 0.08), 0.18, 'tagA', (1, -0.3, 0)), (0.24, (0.05, 0.2), 0.22, 'tagA', (0.8, 0.6, 0))]:
        lw = lowest(x0, *yr)
        if lw is None: continue
        top = Vector((lw.x * s, lw.y, lw.z + 0.04))
        ptag(f'Acc_TagHem_{x0}_{nm}', top, L, 0.034, key, normal=(nrm[0] * s, nrm[1], 0), sway=(0.006 * s, 0, 0))
        lows.append((x0, tuple(round(a, 3) for a in lw)))
    # 袖子下面的挂饰
    for i, (x, L, k, w) in enumerate([(0.25, 0.21, 'tagA', 0.034), (0.40, 0.23, 'tagA', 0.034), (0.33, 0.11, 'teal', 0.012)]):
        o = bpy.data.objects.get(f'Acc_TagSleeve{i+1}_{nm}')
        if o: bpy.data.objects.remove(o)
        h, n = full_hit((x * s, 0.0, 1.0), (0, 0, 1))
        if h: ptag(f'Acc_TagSleeve{i+1}_{nm}', h + Vector((0, 0, 0.012)), L, w, k, normal=(0, -1, 0), sway=(0.012 * s, 0, 0))
