# 从「弦光项目材质」的 PL_<枪>.blend 导出该枪自带的配件模型（含 SOCKET_ 挂点）→ Asset/Weapon/Attachments/<枪>.glb
# 在 Blender 里：exec(open(此文件).read()); export_gun('AssaultRifle')
import bpy, re, os
BASE = r"C:\Users\hp\Desktop\Blender\Gun\Guns\_PrismLink_弦光项目材质"
OUT = r"C:\Users\hp\Desktop\PaperGame\Asset\Weapon\Attachments"
KEEP = re.compile(r'^(SM_Silencer|SM_Scope(_Small)?|SM_Laser|SM_Grip_\w+|SM_\w+_(Handguard|Barrel|Slide|Forend)_\w+|SM_\w+_Magazine_Transparent|SM_\w+_Sight_(Rear|Front)_Folded|SM_\w+_Rail|SM_Sniper_Bipod(_Closed)?|SM_RocketLauncher_(Scope|Scope_NoWire|Muzzle_\w+|Grip))$')
TEX = 1024

def clear():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.collections):
        for d in list(coll):
            if d.users == 0 or coll is bpy.data.collections: coll.remove(d)

def small(img):
    key = img.name + '_s'
    if key in bpy.data.images: return bpy.data.images[key]
    c = img.copy(); c.name = key
    if max(c.size) > TEX: c.scale(TEX, TEX)
    return c

def simplify(m):
    if m.get('_exp'): return m
    new = bpy.data.materials.new(m.name); new['_exp'] = True; new.use_nodes = True
    nt = new.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bc = em = None; alpha = 1.0; col = (0.8, 0.8, 0.8, 1)
    if m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                nm = n.image.name.upper()
                if '_BC' in nm: bc = n.image
                elif nm.endswith('_E.PNG') or '_E.' in nm: em = n.image
            if n.type == 'BSDF_PRINCIPLED':
                col = tuple(n.inputs['Base Color'].default_value); alpha = n.inputs['Alpha'].default_value
    if bc:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = small(bc); nt.links.new(t.outputs[0], b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = col
    if em:
        t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = small(em); nt.links.new(t2.outputs[0], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = 1.0
    if alpha < 1 or 'Glass' in m.name or 'Fade' in m.name or 'Sight' in m.name and not bc:
        b.inputs['Alpha'].default_value = min(alpha, 0.35); new.blend_method = 'BLEND' if hasattr(new, 'blend_method') else None
    b.inputs['Roughness'].default_value = 0.6
    return new

def export_gun(g):
    clear()
    sc = bpy.context.scene
    p = f"{BASE}\\{g}\\Blender\\PL_{g}.blend"
    with bpy.data.libraries.load(p) as (src, dst):
        dst.objects = [n for n in src.objects if KEEP.match(n) or n.startswith('SOCKET_')]
    for o in dst.objects:
        if o: sc.collection.objects.link(o)
    objs = [o for o in dst.objects if o]
    tops = [o for o in objs if o.type == 'MESH' and KEEP.match(o.name)]
    # SOCKET 只留挂在导出网格上的
    for o in objs:
        if o.name.startswith('SOCKET_') and (not o.parent or o.parent not in tops): bpy.data.objects.remove(o)
    for o in tops:
        o.data = o.data.copy()
        for i, m in enumerate(o.data.materials):
            if m: o.data.materials[i] = simplify(m)
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in sc.objects: o.select_set(True)
    out = os.path.join(OUT, g + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=False, export_animations=False,
                              export_skins=False, export_yup=True, export_image_format='JPEG', export_jpeg_quality=85, export_materials='EXPORT')
    return {'file': out, 'size': os.path.getsize(out), 'objects': sorted(o.name for o in tops), 'sockets': sorted(o.name + '<' + o.parent.name for o in sc.objects if o.name.startswith('SOCKET_'))}
