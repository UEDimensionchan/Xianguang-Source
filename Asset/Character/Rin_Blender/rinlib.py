# 凛 配件建模工具（在 Blender 里 exec 这个文件）
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
DIR = r"C:\Users\hp\Desktop\PaperGame\Asset\Character\Rin_Blender"
ARM = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
BODY = bpy.data.objects['Body']; HAIR = bpy.data.objects['Hair']
# 贴图区域（像素，x0,y0,x1,y1；y 向下）
R = {'tagA': (8, 0, 120, 1024), 'tagB': (136, 0, 248, 1024), 'card': (256, 0, 512, 384), 'web': (512, 0, 640, 1024),
     'teal': (640, 0, 768, 1024), 'patch': (768, 0, 1024, 256), 'white': (790, 280, 1000, 490), 'black': (790, 540, 1000, 740),
     'silver': (768, 768, 1024, 1024), 'pouch': (256, 384, 512, 1024)}

def coll():
    c = bpy.data.collections.get('Rin_Acc')
    if not c:
        c = bpy.data.collections.new('Rin_Acc'); bpy.context.scene.collection.children.link(c)
    return c

def atlas_mat():
    m = bpy.data.materials.get('ACC_Atlas')
    if m: return m
    m = bpy.data.materials.new('ACC_Atlas'); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes.get('Principled BSDF') or next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    img = bpy.data.images.get('acc_atlas.png') or bpy.data.images.load(DIR + r"\acc_atlas.png")
    tex.image = img; tex.interpolation = 'Closest' if False else 'Linear'
    nt.links.new(tex.outputs[0], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.55
    return m

def metal_mat():
    m = bpy.data.materials.get('ACC_Metal')
    if m: return m
    m = bpy.data.materials.new('ACC_Metal'); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (0.78, 0.8, 0.84, 1); b.inputs['Metallic'].default_value = 0.9; b.inputs['Roughness'].default_value = 0.3
    return m

def uvr(key, u, v):
    """区域内归一化坐标 (u→x, v→y 向下) → Blender UV"""
    x0, y0, x1, y1 = R[key]
    return ((x0 + (x1 - x0) * u) / 1024, 1 - (y0 + (y1 - y0) * v) / 1024)

_bvh = {}
def inner_mask(me):
    """身体内层（皮肤 + 连衣裙/上衣），去掉外套、兜帽：按网格孤岛筛选"""
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    keep = set(); seen = set()
    for v in bm.verts:
        if v.index in seen: continue
        st = [v]; comp = []; seen.add(v.index)
        while st:
            x = st.pop(); comp.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen: seen.add(y.index); st.append(y)
        faces = {f.index for x in comp for f in x.link_faces}
        mats = {bm.faces[i].material_index for i in faces}
        xs = [abs(x.co.x) for x in comp]; ys = [x.co.y for x in comp]
        if mats == {0} or (2 in mats and max(xs) <= 0.17 and max(ys) <= 0.12) or (2 in mats and max(x.co.z for x in comp) < 0.2):
            keep |= faces
    bm.free()
    return keep

def bvh(obj):
    if obj.name not in _bvh:
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg); me = ev.to_mesh()
        mw = obj.matrix_world
        verts = [mw @ v.co for v in me.vertices]
        keep = inner_mask(obj.data) if obj == BODY else None
        polys = [tuple(p.vertices) for p in me.polygons if keep is None or p.index in keep]
        _bvh[obj.name] = BVHTree.FromPolygons(verts, polys); ev.to_mesh_clear()
    return _bvh[obj.name]

def first_hit(origin, d, obj=None, maxd=1.0):
    t = bvh(obj or BODY)
    loc, n, i, dist = t.ray_cast(Vector(origin), Vector(d).normalized(), maxd)
    return loc

def last_hit(origin, d, obj=None, maxd=0.35):
    """沿射线一直穿透，返回最后一层（内层里最外面那一层：连衣裙而不是皮肤）"""
    t = bvh(obj or BODY); o = Vector(origin); d = Vector(d).normalized(); last = None; walked = 0
    while walked < maxd:
        loc, n, i, dist = t.ray_cast(o, d, maxd - walked)
        if loc is None: break
        last = loc; walked += dist + 0.0005; o = loc + d * 0.0005
    return last

def surf(point, direction, obj=None):
    """从外面沿 direction 打向身体，返回最外层表面点"""
    o = Vector(point) - Vector(direction).normalized() * 0.6
    return first_hit(o, direction, obj, 1.2)

def profile(z, cx=0.0, cy=0.0, n=48, off=0.004, rx=None, obj=None, a0=0.0, maxd=0.3):
    pts = []
    for i in range(n):
        a = a0 + 2 * math.pi * i / n
        d = Vector((math.sin(a), -math.cos(a), 0))  # i=0 朝正前方（-Y）
        h = last_hit((cx, cy, z), d, obj, maxd)
        r = (h - Vector((cx, cy, z))).length if h else (rx or 0.1)
        pts.append(Vector((cx, cy, z)) + d * (r + off))
    return pts

def mk(name, bm, mat=None, smooth=False):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old)
    o = bpy.data.objects.new(name, me); coll().objects.link(o)
    o.data.materials.append(mat or atlas_mat())
    for p in o.data.polygons: p.use_smooth = smooth
    return o

def band(name, z0, z1, cx=0, cy=0, off=0.004, key="web", thick=0.003, n=48, obj=None, uvrep=1.0, maxd=0.3):
    """贴身的一圈带子（腰带、腿环、手腕）：z0 下沿 z1 上沿"""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    A = profile(z0, cx, cy, n, off, obj=obj, maxd=maxd); B = profile(z1, cx, cy, n, off, obj=obj, maxd=maxd)
    va = [bm.verts.new(p) for p in A]; vb = [bm.verts.new(p) for p in B]
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((va[i], va[j], vb[j], vb[i]))
        t0, t1 = i / n * uvrep, (i + 1) / n * uvrep
        for l, (u, v) in zip(f.loops, [(0, t0), (0, t1), (1, t1), (1, t0)]):
            l[uv].uv = uvr(key, u, v % 1.0001)
    o = mk(name, bm, smooth=True)
    if thick:
        s = o.modifiers.new('solid', 'SOLIDIFY'); s.thickness = thick; s.offset = 1
    return o

def box(name, center, size, key='black', rot=(0, 0, 0), mat=None, bevel=0.0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    uv = bm.loops.layers.uv.new()
    for f in bm.faces:
        for l, (u, v) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
            l[uv].uv = uvr(key, u, v)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.rotate(bm, matrix=Matrix.Rotation(rot[0], 3, 'X') @ Matrix.Rotation(rot[1], 3, 'Y') @ Matrix.Rotation(rot[2], 3, 'Z'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    o = mk(name, bm, mat)
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = 2
    return o

def strip(name, pts, width, normal_hint=(0, -1, 0), key='tagA', thick=0.002, vlen=None):
    """沿一串点做扁带（挂饰、吊带）。normal_hint：带子正面朝向"""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    pts = [Vector(p) for p in pts]
    L = [0.0]
    for i in range(1, len(pts)): L.append(L[-1] + (pts[i] - pts[i - 1]).length)
    tot = vlen or L[-1]
    rows = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(Vector(normal_hint)).normalized() * (width / 2)
        rows.append((bm.verts.new(p - side), bm.verts.new(p + side)))
    for i in range(len(pts) - 1):
        a, b = rows[i], rows[i + 1]
        f = bm.faces.new((a[0], a[1], b[1], b[0]))
        v0, v1 = L[i] / tot, L[i + 1] / tot
        for l, (u, v) in zip(f.loops, [(0, v0), (1, v0), (1, v1), (0, v1)]):
            l[uv].uv = uvr(key, u, min(v, 1))
    o = mk(name, bm)
    if thick:
        s = o.modifiers.new('solid', 'SOLIDIFY'); s.thickness = thick; s.offset = 0
    return o

def buckle(name, center, w, h, normal=(0, -1, 0), up=(0, 0, 1), t=0.004, bar=0.004):
    """方形金属扣：中空的框"""
    n = Vector(normal).normalized(); u = Vector(up).normalized(); s = u.cross(n).normalized()
    bm = bmesh.new()
    def rect(cx, cy, ww, hh):
        bmesh.ops.create_cube(bm, size=1.0)
    parts = [(0, h / 2 - bar / 2, w, bar), (0, -h / 2 + bar / 2, w, bar), (w / 2 - bar / 2, 0, bar, h), (-w / 2 + bar / 2, 0, bar, h), (0, 0, bar * 0.8, h)]
    for (px, py, ww, hh) in parts:
        g = bmesh.ops.create_cube(bm, size=1.0)['verts']
        M = Matrix(((s.x * ww, u.x * hh, n.x * t), (s.y * ww, u.y * hh, n.y * t), (s.z * ww, u.z * hh, n.z * t)))
        for v in g: v.co = M @ v.co + Vector(center) + s * px + u * py + n * (t / 2)
    return mk(name, bm, metal_mat())

def nearest_body_vertex(p):
    if '_kd' not in globals():
        me = BODY.data; mw = BODY.matrix_world
        kd = KDTree(len(me.vertices))
        for v in me.vertices: kd.insert(mw @ v.co, v.index)  # 含外套：挂饰要跟外套走
        kd.balance(); globals()['_kd'] = kd
    co, idx, d = globals()['_kd'].find(Vector(p))
    return idx

def weights_like_point(o, p):
    """整个物件跟随身体上离 p 最近的那个顶点（挂饰、扣子）"""
    vi = nearest_body_vertex(p)
    gn = {g.index: g.name for g in BODY.vertex_groups}
    ws = [(gn[g.group], g.weight) for g in BODY.data.vertices[vi].groups if g.weight > 0.01]
    bind(o, lambda co: ws)

def weights_bone(o, bone):
    bind(o, lambda co: [(bone, 1.0)])

def weights_transfer(o):
    """按最近表面插值复制身体权重（贴身的带子、靴子、手套）"""
    for g in BODY.vertex_groups:
        if g.name not in o.vertex_groups: o.vertex_groups.new(name=g.name)
    m = o.modifiers.new('dt', 'DATA_TRANSFER'); m.object = BODY; m.use_vert_data = True
    m.data_types_verts = {'VGROUP_WEIGHTS'}; m.vert_mapping = 'POLYINTERP_NEAREST'
    m.layers_vgroup_select_src = 'ALL'; m.layers_vgroup_select_dst = 'NAME'
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        bpy.ops.object.modifier_apply(modifier=m.name)
    finish(o)

def bind(o, fn):
    for v in o.data.vertices:
        for name, w in fn(v.co):
            g = o.vertex_groups.get(name) or o.vertex_groups.new(name=name)
            g.add([v.index], w, 'REPLACE')
    finish(o)

def finish(o):
    # 清掉空组，挂到骨架
    for g in list(o.vertex_groups):
        if not any(gg.group == g.index and gg.weight > 0.001 for v in o.data.vertices for gg in v.groups):
            o.vertex_groups.remove(g)
    o.parent = ARM
    if not any(m.type == 'ARMATURE' for m in o.modifiers):
        a = o.modifiers.new('arm', 'ARMATURE'); a.object = ARM

def render(name='_render_front', loc=(0, -4, 0.92), rot=(90, 0, 0), scale=1.95, res=(1312, 1200)):
    sc = bpy.context.scene; cam = bpy.data.objects['RefCam']
    cam.location = loc; cam.rotation_euler = tuple(math.radians(a) for a in rot); cam.data.ortho_scale = scale
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = DIR + "\\" + name + ".png"
    bpy.ops.render.render(write_still=True)

def shell(name, pred, push=0.002, key='black', thick=0.0, mats=(0, 2), smooth_iter=0, mask=True):
    """复制身体表面的一块（手套、靴子），沿法线往外推一点"""
    me = BODY.data; mw = BODY.matrix_world
    bm = bmesh.new(); uv = bm.loops.layers.uv.new(); vmap = {}
    keep = inner_mask(me) if mask else None
    for p in me.polygons:
        if (keep is not None and p.index not in keep) or p.material_index not in mats: continue
        c = mw @ p.center
        if not pred(c): continue
        vs = []
        for vi in p.vertices:
            if vi not in vmap: vmap[vi] = bm.verts.new(mw @ me.vertices[vi].co)
            vs.append(vmap[vi])
        try:
            f = bm.faces.new(vs)
            for l in f.loops: l[uv].uv = uvr(key, 0.5, 0.5)
        except ValueError: pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
    bm.normal_update()
    for v in bm.verts: v.co += v.normal * push
    for _ in range(smooth_iter): bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    o = mk(name, bm, smooth=True)
    if thick:
        s = o.modifiers.new('solid', 'SOLIDIFY'); s.thickness = thick; s.offset = 1
    return o

def quad(name, center, w, h, normal=(0, -1, 0), up=(0, 0, 1), key='card', thick=0.0015):
    n = Vector(normal).normalized(); u = Vector(up).normalized(); s = u.cross(n).normalized()
    bm = bmesh.new(); uv = bm.loops.layers.uv.new(); c = Vector(center)
    vs = [bm.verts.new(c + s * (w / 2 * a) + u * (h / 2 * b)) for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
    f = bm.faces.new(vs)
    for l, (a, b) in zip(f.loops, [(0, 1), (1, 1), (1, 0), (0, 0)]): l[uv].uv = uvr(key, a, b)
    o = mk(name, bm)
    if thick:
        m = o.modifiers.new('solid', 'SOLIDIFY'); m.thickness = thick; m.offset = 1
    return o

_full = {}
def full_hit(origin, d, maxd=1.5):
    """含外套的完整身体网格"""
    if 'b' not in _full:
        dg = bpy.context.evaluated_depsgraph_get(); ev = BODY.evaluated_get(dg); me = ev.to_mesh(); mw = BODY.matrix_world
        _full['b'] = BVHTree.FromPolygons([mw @ v.co for v in me.vertices], [tuple(p.vertices) for p in me.polygons]); ev.to_mesh_clear()
    loc, n, i, dist = _full['b'].ray_cast(Vector(origin), Vector(d).normalized(), maxd)
    return loc, n

def hang(name, top, length, width=0.03, key='tagA', normal=(0, -1, 0), sway=(0, 0, 0), seg=6, thick=0.0025):
    """从 top 往下垂的挂饰（带一点弧度）"""
    pts = [Vector(top) + Vector((sway[0] * (i / seg) ** 2, sway[1] * (i / seg) ** 2, -length * i / seg)) for i in range(seg + 1)]
    return strip(name, pts, width, normal_hint=normal, key=key, thick=thick)

def full_last(origin, d, maxd):
    full_hit((0, 0, 0), (0, 0, 1), 0.001)
    t = _full['b']; o = Vector(origin); d = Vector(d).normalized(); last = None; walked = 0
    while walked < maxd:
        loc, n, i, dist = t.ray_cast(o, d, maxd - walked)
        if loc is None: break
        last = loc; walked += dist + 0.0005; o = loc + d * 0.0005
    return last

def band_x(name, x0, x1, cy, cz, off=0.004, key='web', thick=0.003, n=40, maxd=0.15, full=False, rfix=None):
    """绕手臂（X 轴）的一圈：袖口、护腕"""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    rows = []
    for x in (x0, x1):
        row = []
        for i in range(n):
            a = 2 * math.pi * i / n
            d = Vector((0, math.cos(a), math.sin(a)))
            c = Vector((x, cy, cz))
            if rfix: r = rfix
            else:
                h = full_last(c, d, maxd) if full else last_hit(c, d, None, maxd)
                r = (h - c).length if h else 0.05
            row.append(bm.verts.new(c + d * (r + off)))
        rows.append(row)
    A, B = rows
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((A[i], A[j], B[j], B[i]))
        for l, (u, v) in zip(f.loops, [(0, i / n), (0, (i + 1) / n), (1, (i + 1) / n), (1, i / n)]): l[uv].uv = uvr(key, u, v)
    o = mk(name, bm, smooth=True)
    if thick:
        s = o.modifiers.new('solid', 'SOLIDIFY'); s.thickness = thick; s.offset = 1
    return o

def ptag(name, top, length, width=0.034, key='tagA', normal=(0, -1, 0), sway=(0, 0, 0), seg=8, thick=0.0025, point=0.6):
    """设定图里的挂饰：上宽下尖（剑尾形）的长条"""
    n = Vector(normal).normalized(); top = Vector(top)
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    pts = [top + Vector((sway[0] * (i / seg) ** 2, sway[1] * (i / seg) ** 2, -length * i / seg)) for i in range(seg + 1)]
    rows = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, seg)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(n).normalized()
        rows.append((bm.verts.new(p - side * width / 2), bm.verts.new(p + side * width / 2)))
    for i in range(seg):
        a, b = rows[i], rows[i + 1]
        f = bm.faces.new((a[0], a[1], b[1], b[0]))
        v0, v1 = i / seg * 0.88, (i + 1) / seg * 0.88
        for l, (u, v) in zip(f.loops, [(0, v0), (1, v0), (1, v1), (0, v1)]): l[uv].uv = uvr(key, u, v)
    # 尖头
    t = (pts[-1] - pts[-2]).normalized()
    tip = bm.verts.new(pts[-1] + t * width * point)
    a = rows[-1]
    f = bm.faces.new((a[0], a[1], tip))
    for l, (u, v) in zip(f.loops, [(0, 0.88), (1, 0.88), (0.5, 1.0)]): l[uv].uv = uvr(key, u, v)
    o = mk(name, bm)
    if thick:
        s = o.modifiers.new('solid', 'SOLIDIFY'); s.thickness = thick; s.offset = 0
    return o

def render_look(name, loc, target, scale=1.0, res=(800, 800)):
    sc = bpy.context.scene; cam = bpy.data.objects['RefCam']
    cam.location = Vector(loc); d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); cam.data.ortho_scale = scale
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = DIR + "\\" + name + ".png"
    bpy.ops.render.render(write_still=True)
