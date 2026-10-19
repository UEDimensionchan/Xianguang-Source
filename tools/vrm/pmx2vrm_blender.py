# Blender 里把 PMX（mmd_tools 导入）整理成标准人形骨骼 + T 字姿势，导出 glb，之后再用 glb2vrm.py 转 VRM 1.0
# 用法（在 Blender 里）：exec(open(本文件).read()); convert(pmx路径, 输出glb路径) -> dict
import bpy, mathutils, os, re, numpy as np

KEEP_MORPHS = ['まばたき', 'ウィンク', 'ウィンク右', 'ウィンク２', 'ｳｨﾝｸ２右', 'ウィンク2', 'ウィンク2右', 'あ', 'い', 'う', 'え', 'お', '笑い', 'にこり', '怒り', '困る', 'なごみ', 'びっくり', '驚き', 'じと目', '悲しい', 'はぅ', 'ω', 'にやり', 'ニコ', '口角上げ']

SIDE = {'.L': 'Left', '.R': 'Right'}
BASE = {'上半身': 'Spine', '上半身2': 'Chest', '上半身3': 'UpperChest', '首': 'Neck', '頭': 'Head'}
LR = {'目': 'Eye', '肩': 'Shoulder', '腕': 'UpperArm', 'ひじ': 'LowerArm', '手首': 'Hand',
      '足D': 'UpperLeg', 'ひざD': 'LowerLeg', '足首D': 'Foot', '足先EX': 'Toes'}
FING = {'親指': 'Thumb', '人指': 'Index', '中指': 'Middle', '薬指': 'Ring', '小指': 'Little'}
SEG = ['Proximal', 'Intermediate', 'Distal']
TRANSP = re.compile(r'頬|赤面|照れ|涙|ハイライト|透|ガラス|レンズ|cheek|blush|tear|glass|lens|highlight|alpha', re.I)  # 只有真正半透明的部件用混合，其余用裁切（混合会有前后排序问题，口腔会透到脸前面）


def _log(L, *a):
    L.append(' '.join(str(x) for x in a))


def convert(pmx, out_glb, log=None, shrink=None):
    L = log if log is not None else []
    # —— 临时场景 ——
    win = bpy.context.window
    old = win.scene
    sc = bpy.data.scenes.new('conv')
    win.scene = sc
    try:
        before = set(bpy.data.objects)
        bpy.ops.mmd_tools.import_model(filepath=pmx, scale=0.08, types={'MESH', 'ARMATURE', 'MORPHS'}, clean_model=True, log_level='ERROR')
        new = [o for o in bpy.data.objects if o not in before]
        A = [o for o in new if o.type == 'ARMATURE'][0]
        M = [o for o in new if o.type == 'MESH']
        # 贴图路径修正（指向作者电脑的贴图：在模型文件夹里按文件名找）
        d = os.path.dirname(pmx); idx = {}
        for rr, ds, fs in os.walk(d):
            for f in fs: idx.setdefault(f.lower(), os.path.join(rr, f))
        _materials(M, idx, L)
        _morphs(M, L)
        if shrink: _shrink_breast(A, M, shrink, L)
        _rig(A, M, L)
        _tpose(A, M, L)
        # 导出：形态键默认值全部归零
        for o in M:
            if o.data.shape_keys:
                for k in o.data.shape_keys.key_blocks: k.value = 0.0
        _log(L, 'sk', [(o.name, [round(k.value, 2) for k in o.data.shape_keys.key_blocks][:5]) for o in M if o.data.shape_keys])
        bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
        for o in sc.objects: o.select_set(False)
        for o in [A] + M: o.select_set(True)
        bpy.context.view_layer.objects.active = A
        os.makedirs(os.path.dirname(out_glb), exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_skins=True, export_morph=True,
                                  export_morph_normal=False, export_apply=False, export_animations=False, export_yup=True,
                                  export_def_bones=False, export_image_format='AUTO', export_extras=False)
        _log(L, 'glb', os.path.getsize(out_glb))
    finally:
        for o in list(sc.objects): bpy.data.objects.remove(o, do_unlink=True)
        win.scene = old
        bpy.data.scenes.remove(sc)
        for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.images, bpy.data.node_groups):
            for b in list(blk):
                if b.users == 0: blk.remove(b)
    return L


def _materials(M, idx, L):
    import bmesh
    # 默认隐藏的部件（材质透明度为 0：表情差分的眼睛 / 嘴、特效等，MMD 里靠材质变形才显示）直接删掉
    for o in M:
        hide = [i for i, m in enumerate(o.data.materials) if m and hasattr(m, 'mmd_material') and m.mmd_material.alpha < 0.01]
        if hide:
            bm = bmesh.new(); bm.from_mesh(o.data)
            fs = [f for f in bm.faces if f.material_index in hide]
            bmesh.ops.delete(bm, geom=fs, context='FACES')
            bm.to_mesh(o.data); bm.free(); o.data.update()
            _log(L, 'hidden mats', [o.data.materials[i].name for i in hide], 'faces', len(fs))
    for o in M:
        for i, m in enumerate(o.data.materials):
            if not m: continue
            img = None
            if m.node_tree:
                n = m.node_tree.nodes.get('mmd_base_tex')
                if n and n.image: img = n.image
                if not img:
                    for n in m.node_tree.nodes:
                        if n.type == 'TEX_IMAGE' and n.image and 'toon' not in n.name.lower() and 'sphere' not in n.name.lower(): img = n.image; break
            if img and not os.path.exists(bpy.path.abspath(img.filepath)):
                alt = idx.get(os.path.basename(img.filepath.replace('\\', '/')).lower())
                img = bpy.data.images.load(alt, check_existing=True) if alt else None
            col = tuple(m.mmd_material.diffuse_color) + (1,) if hasattr(m, 'mmd_material') else (0.8, 0.8, 0.8, 1)
            alpha = m.mmd_material.alpha if hasattr(m, 'mmd_material') else 1.0
            nm = bpy.data.materials.new(m.name)
            nm.use_nodes = True
            nt = nm.node_tree; nt.nodes.clear()
            out = nt.nodes.new('ShaderNodeOutputMaterial')
            bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
            bs.inputs['Roughness'].default_value = 1.0
            bs.inputs['Metallic'].default_value = 0.0
            nt.links.new(bs.outputs[0], out.inputs[0])
            blend = bool(TRANSP.search(m.name)) or alpha < 0.999
            if img:
                tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img
                nt.links.new(tx.outputs['Color'], bs.inputs['Base Color'])
                has_a = img.depth in (32, 64, 128) or img.alpha_mode != 'NONE'
                if has_a:
                    if blend:
                        nt.links.new(tx.outputs['Alpha'], bs.inputs['Alpha'])
                    else:  # 不透明部件：用裁切，免得半透明排序出问题
                        mt = nt.nodes.new('ShaderNodeMath'); mt.operation = 'ROUND'
                        nt.links.new(tx.outputs['Alpha'], mt.inputs[0]); nt.links.new(mt.outputs[0], bs.inputs['Alpha'])
            else:
                bs.inputs['Base Color'].default_value = col
                if alpha < 0.999: bs.inputs['Alpha'].default_value = alpha
            if alpha < 0.01:
                bs.inputs['Alpha'].default_value = 0.0
            o.data.materials[i] = nm


def _morphs(M, L):
    for o in M:
        sk = o.data.shape_keys
        if not sk: continue
        names = [k.name for k in sk.key_blocks]
        o.active_shape_key_index = 0
        for k in list(sk.key_blocks)[1:]:
            if k.name not in KEEP_MORPHS: o.shape_key_remove(k)
        kept = [k.name for k in o.data.shape_keys.key_blocks][1:] if o.data.shape_keys else []
        _log(L, 'morphs', o.name, len(names), '->', kept)


def _rig(A, M, L):
    bpy.context.view_layer.objects.active = A
    # 去掉约束（IK、付与）和驱动
    for pb in A.pose.bones:
        for c in list(pb.constraints): pb.constraints.remove(c)
    if A.animation_data:
        for dr in list(A.animation_data.drivers): A.animation_data.drivers.remove(dr)
    for o in M:
        if o.data.shape_keys and o.data.shape_keys.animation_data:
            for dr in list(o.data.shape_keys.animation_data.drivers): o.data.shape_keys.animation_data.drivers.remove(dr)
    names = {b.name for b in A.data.bones}
    hasD = '足D.L' in names
    # 非 D 腿骨的权重并到 D 骨上
    if hasD:
        for s in ('.L', '.R'):
            for a, b in (('足', '足D'), ('ひざ', 'ひざD'), ('足首', '足首D'), ('つま先', '足先EX')):
                for o in M:
                    va = o.vertex_groups.get(a + s)
                    if not va: continue
                    vb = o.vertex_groups.get(b + s) or o.vertex_groups.new(name=b + s)
                    for v in o.data.vertices:
                        for g in v.groups:
                            if g.group == va.index and g.weight > 0: vb.add([v.index], g.weight, 'ADD')
    bpy.ops.object.mode_set(mode='EDIT')
    E = A.data.edit_bones
    # 删掉 IK、辅助骨
    dels = [b for b in E if re.search(r'ＩＫ|IK|^_dummy_|^_shadow_', b.name)]
    if hasD: dels += [b for b in E if re.sub(r'\.[LR]$', '', b.name) in ('足', 'ひざ', '足首', 'つま先')]
    for b in dels:
        for c in b.children: c.parent = b.parent
    for b in dels: E.remove(b)
    rn = {}
    hips = E.get('下半身')
    if hips:
        rn['下半身'] = 'Hips'
        sp = E.get('上半身')
        if sp: sp.use_connect = False; sp.parent = hips
    for jp, en in BASE.items():
        if E.get(jp): rn[jp] = en
    lr = dict(LR)
    if not hasD: lr.update({'足': 'UpperLeg', 'ひざ': 'LowerLeg', '足首': 'Foot', 'つま先': 'Toes'})
    for s, side in SIDE.items():
        for jp, en in lr.items():
            if E.get(jp + s): rn[jp + s] = side + en
        for jp, en in FING.items():
            segs = [k for k in ('０', '１', '２', '３') if E.get(jp + k + s)]
            for k, seg in zip(segs, SEG): rn[jp + k + s] = side + en + seg
    # 名字冲突的先挪开
    for b in E:
        if b.name in rn.values() and b.name not in rn: b.name = b.name + '_x'
    bpy.ops.object.mode_set(mode='OBJECT')
    for jp, en in rn.items():
        b = A.data.bones.get(jp)
        if b: b.name = en  # 顶点组会跟着改名
    miss = [x for x in ('Hips', 'Spine', 'Head', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand', 'RightUpperArm', 'RightLowerArm', 'RightHand', 'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot') if x not in A.data.bones]
    _log(L, 'bones', len(A.data.bones), 'renamed', len(rn), 'missing', miss)


def _tpose(A, M, L):
    bpy.context.view_layer.objects.active = A
    bpy.ops.object.mode_set(mode='POSE')
    P = A.pose.bones
    for pb in P: pb.matrix_basis = mathutils.Matrix()
    bpy.context.view_layer.update()

    def aim(name, child, target):
        pb, cb = P.get(name), P.get(child)
        if not pb or not cb: return 0
        h = pb.head.copy(); d = (cb.head - h).normalized()
        q = d.rotation_difference(target)
        if q.angle < 1e-4: return 0
        R = mathutils.Matrix.Translation(h) @ q.to_matrix().to_4x4() @ mathutils.Matrix.Translation(-h)
        pb.matrix = R @ pb.matrix
        bpy.context.view_layer.update()
        return round(q.angle * 57.3, 1)
    ang = []
    for side, sx in (('Left', 1), ('Right', -1)):
        # 左右判断：MMD 模型面朝 -Y，左手在 +X
        ua = P.get(side + 'UpperArm')
        if not ua: continue
        sx = 1 if (P[side + 'LowerArm'].head.x - ua.head.x) > 0 else -1
        t = mathutils.Vector((sx, 0, 0))
        ang.append(aim(side + 'UpperArm', side + 'LowerArm', t))
        ang.append(aim(side + 'LowerArm', side + 'Hand', t))
        # 手指伸直（中指方向作为手的方向）
        if P.get(side + 'MiddleProximal'): ang.append(aim(side + 'Hand', side + 'MiddleProximal', t))
    _log(L, 'tpose', ang)
    bpy.ops.object.mode_set(mode='OBJECT')
    # 把姿势应用成静止姿势（形态键一起处理）
    dg = bpy.context.evaluated_depsgraph_get()
    for o in M:
        n = len(o.data.vertices)
        sk = o.data.shape_keys
        keys = [k.name for k in sk.key_blocks] if sk else []
        res = {}
        for ki in range(len(keys) or 1):
            if sk:
                for j, k in enumerate(sk.key_blocks): k.value = 1.0 if (j == ki and j > 0) else 0.0
            dg = bpy.context.evaluated_depsgraph_get(); dg.update()
            ev = o.evaluated_get(dg); me = ev.to_mesh()
            co = np.empty(n * 3, dtype=np.float32); me.vertices.foreach_get('co', co)
            ev.to_mesh_clear()
            res[keys[ki] if keys else 'Basis'] = co
        if sk:
            for k in sk.key_blocks: k.value = 0.0
            for k in list(sk.key_blocks)[::-1]: o.shape_key_remove(k)
        base = res[keys[0] if keys else 'Basis']
        o.data.vertices.foreach_set('co', base)
        if keys:
            b = o.shape_key_add(name=keys[0], from_mix=False)
            for kn in keys[1:]:
                k = o.shape_key_add(name=kn, from_mix=False)
                k.data.foreach_set('co', res[kn])
        o.data.update()
    bpy.context.view_layer.objects.active = A
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def _shrink_breast(A, M, s, L):
    """胸部缩小：按胸骨权重把顶点往胸骨根部收（前后方向收 s 倍，上下左右收得少一点），所有形态键同样处理"""
    BRE = re.compile(r'^(胸|breast|bust)', re.I)
    PARENT = re.compile(r'^(胸親|breast|bust)$', re.I)
    DECOR = re.compile(r'飾|acce|ribbon|リボン', re.I)
    bones = [b for b in A.data.bones if BRE.search(b.name) and not PARENT.search(b.name) and not DECOR.search(b.name)]
    sides = {}
    for b in bones:
        side = 'L' if re.search(r'(\.|_)L$|左', b.name) else 'R' if re.search(r'(\.|_)R$|右', b.name) else None
        if side: sides.setdefault(side, []).append(b)
    if not sides: _log(L, 'shrink: no breast bones'); return
    k_fwd, k_side = s, (1 + s) / 2
    for o in M:
        n = len(o.data.vertices)
        inv = o.matrix_world.inverted()
        tot = 0
        for side, bl in sides.items():
            names = {b.name for b in bl}
            gi = {g.index for g in o.vertex_groups if g.name in names}
            if not gi: continue
            w = np.zeros(n, dtype=np.float32)
            for v in o.data.vertices:
                for g in v.groups:
                    if g.group in gi: w[v.index] += g.weight
            w = np.clip(w, 0, 1)
            if not w.any(): continue
            root = min(bl, key=lambda b: len(b.parent_recursive))  # 最上层的胸骨（根部）
            c = np.array(inv @ (A.matrix_world @ root.head_local), dtype=np.float32)
            fac = np.array([k_side, k_fwd, k_side], dtype=np.float32)  # Blender：-Y 是前方
            def tf(co):
                co = co.reshape(-1, 3); d = co - c
                co += w[:, None] * (d * fac - d)
                return co.reshape(-1)
            if o.data.shape_keys:
                for kb in o.data.shape_keys.key_blocks:
                    co = np.empty(n * 3, dtype=np.float32); kb.data.foreach_get('co', co); kb.data.foreach_set('co', tf(co))
            co = np.empty(n * 3, dtype=np.float32); o.data.vertices.foreach_get('co', co); o.data.vertices.foreach_set('co', tf(co))
            tot += int((w > 0).sum())
        o.data.update()
        _log(L, 'shrink', o.name, s, 'verts', tot, {k: [b.name for b in v] for k, v in sides.items()})
