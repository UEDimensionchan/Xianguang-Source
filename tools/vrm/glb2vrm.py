# Blender 导出的 glb → VRM 1.0（VRMC_vrm + MToon + 摆动骨骼），并去掉表情用不到的变形目标、缩小贴图
import json, struct, sys, re, io
from PIL import Image
src, dst, cfgp = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = json.load(open(cfgp, encoding='utf-8'))
raw = open(src, 'rb').read()
L = struct.unpack('<I', raw[12:16])[0]
j = json.loads(raw[20:20 + L]); off = 20 + L; BL = struct.unpack('<I', raw[off:off + 4])[0]; bin_ = raw[off + 8:off + 8 + BL]
nodes = j['nodes']; names = [n.get('name', '') for n in nodes]
parent = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []): parent[c] = i

# —— 人形骨骼 ——
PARTS = {'hips', 'spine', 'chest', 'upperchest', 'neck', 'head', 'eye', 'shoulder', 'upperarm', 'lowerarm', 'hand', 'upperleg', 'lowerleg', 'foot', 'toes', 'toe', 'toebase'}
FING = {'thumb': ['Metacarpal', 'Proximal', 'Distal'], 'index': ['Proximal', 'Intermediate', 'Distal'], 'middle': ['Proximal', 'Intermediate', 'Distal'], 'ring': ['Proximal', 'Intermediate', 'Distal'], 'little': ['Proximal', 'Intermediate', 'Distal']}
def canon(n):
    s = n.strip(); side = ''
    m = re.match(r'^(left|right)(.*)$', s, re.I)
    if m: side = m.group(1).lower(); s = m.group(2)
    m = re.match(r'^(.*?)[._ ]([LR])$', s)
    if m: side = 'left' if m.group(2) == 'L' else 'right'; s = m.group(1)
    k = re.sub(r'[^a-z]', '', s.lower())
    return side, k
hb = {}
for i, n in enumerate(names):
    if 'mesh' in nodes[i]: continue
    side, k = canon(n)
    vrm = None
    if k in PARTS:
        k = {'toe': 'toes', 'toebase': 'toes'}.get(k, k)
        if side: vrm = side + k[0].upper() + k[1:].replace('arm', 'Arm').replace('leg', 'Leg')
        elif k in ('hips', 'spine', 'chest', 'upperchest', 'neck', 'head'): vrm = {'upperchest': 'upperChest'}.get(k, k)
    else:
        for f, segs in FING.items():
            for si, seg in enumerate(['proximal', 'intermediate', 'distal']):
                if side and k == f + seg: vrm = side + f.capitalize() + segs[si]
    if vrm and vrm not in hb: hb[vrm] = i
for k, v in cfg.get('boneOverride', {}).items(): hb[k] = names.index(v)
V0 = j.get('extensions', {}).pop('VRM', None)
if V0:  # 已经是 VRM 0.x：沿用它的骨骼、表情、摆动骨骼设置
    TH = {'ThumbProximal': 'ThumbMetacarpal', 'ThumbIntermediate': 'ThumbProximal', 'ThumbDistal': 'ThumbDistal'}
    hb = {}
    for b in V0['humanoid']['humanBones']:
        n = b['bone']
        for a, c in TH.items():
            if n.endswith(a): n = n[:-len(a)] + c
        hb[n] = b['node']
    j['extensionsUsed'] = [e for e in j.get('extensionsUsed', []) if e not in ('VRM', 'KHR_materials_unlit')]
    for mt in j['materials']: mt.get('extensions', {}).pop('KHR_materials_unlit', None)
req = ['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']
miss = [r for r in req if r not in hb]
assert not miss, miss
print('humanoid', len(hb))

# —— 表情 ——
meshnodes = [i for i, n in enumerate(nodes) if 'mesh' in n]
used = {}
exprs = {}
def find_target(tname):
    for ni in meshnodes:
        tn = j['meshes'][nodes[ni]['mesh']].get('extras', {}).get('targetNames', [])
        if tname in tn: return ni, tn.index(tname)
    return None
P0 = {'joy': 'happy', 'angry': 'angry', 'sorrow': 'sad', 'fun': 'relaxed', 'a': 'aa', 'i': 'ih', 'u': 'ou', 'e': 'ee', 'o': 'oh', 'blink': 'blink', 'blink_l': 'blinkLeft', 'blink_r': 'blinkRight', 'lookup': 'lookUp', 'lookdown': 'lookDown', 'lookleft': 'lookLeft', 'lookright': 'lookRight'}
node_of_mesh = {nodes[i]['mesh']: i for i in meshnodes}
if V0:
    cfg['expressions'] = {}
    for g in V0['blendShapeMaster']['blendShapeGroups']:
        pn = g.get('presetName', 'unknown')
        if pn == 'neutral':  # 默认表情：直接烘进模型
            for b in g['binds']:
                m = j['meshes'][b['mesh']]; n = len(m['primitives'][0].get('targets', []))
                w = m.setdefault('weights', [0] * n); w[b['index']] = b['weight'] / 100
            continue
        key = P0.get(pn) or g['name']
        binds = [{'node': node_of_mesh[b['mesh']], 'index': b['index'], 'weight': b['weight'] / 100} for b in g['binds'] if b['mesh'] in node_of_mesh]
        for b in binds: used.setdefault(nodes[b['node']]['mesh'], set()).add(b['index'])
        if binds:
            e = {'morphTargetBinds': binds, 'isBinary': bool(g.get('isBinary'))}
            if key.startswith('blink'): e['overrideBlink'] = 'none'
            exprs[key] = e
for preset, tlist in cfg['expressions'].items():
    binds = []
    for t in (tlist if isinstance(tlist, list) else [tlist]):
        w = 1.0
        if isinstance(t, dict): w = t['w']; t = t['name']
        r = find_target(t)
        if not r: print('  !! no target', preset, t); continue
        binds.append({'node': r[0], 'index': r[1], 'weight': w}); used.setdefault(nodes[r[0]]['mesh'], set()).add(r[1])
    if binds:
        e = {'morphTargetBinds': binds, 'isBinary': preset.startswith('blink')}
        if preset in ('blink', 'blinkLeft', 'blinkRight'): e['overrideBlink'] = 'none'
        exprs[preset] = e
# 模型默认开着的变形（比如穿裙子时的身体修正）先烘进顶点
import numpy as np
bin_ = bytearray(bin_)
def acc_np(ai):
    a = j['accessors'][ai]; n = a['count']
    assert a['componentType'] == 5126 and a['type'] == 'VEC3'
    o = None
    if 'bufferView' in a:
        bv = j['bufferViews'][a['bufferView']]; assert not bv.get('byteStride')
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        arr = np.frombuffer(bytes(bin_[o:o + n * 12]), dtype='<f4').reshape(n, 3).copy()
    else: arr = np.zeros((n, 3), dtype='<f4')
    sp = a.get('sparse')
    if sp:
        ib = j['bufferViews'][sp['indices']['bufferView']]; io_ = ib.get('byteOffset', 0) + sp['indices'].get('byteOffset', 0)
        dt = {5121: '<u1', 5123: '<u2', 5125: '<u4'}[sp['indices']['componentType']]
        idx = np.frombuffer(bytes(bin_[io_:io_ + sp['count'] * np.dtype(dt).itemsize]), dtype=dt)
        vb = j['bufferViews'][sp['values']['bufferView']]; vo = vb.get('byteOffset', 0) + sp['values'].get('byteOffset', 0)
        arr[idx] = np.frombuffer(bytes(bin_[vo:vo + sp['count'] * 12]), dtype='<f4').reshape(-1, 3)
    return o, arr
for mi, m in enumerate(j['meshes']):
    w = m.get('weights') or []
    for ti, wt in enumerate(w):
        if not wt: continue
        for p in m['primitives']:
            for attr in ('POSITION',):
                if attr not in p['targets'][ti]: continue
                o, base = acc_np(p['attributes'][attr]); _, d = acc_np(p['targets'][ti][attr])
                base += d * wt; bin_[o:o + base.nbytes] = base.astype('<f4').tobytes()
                a = j['accessors'][p['attributes'][attr]]; a['min'] = base.min(0).tolist(); a['max'] = base.max(0).tolist()
        print('  baked', m['name'], m['extras']['targetNames'][ti], wt)
        w[ti] = 0
bin_ = bytes(bin_)
# 去掉其它变形目标（模型自带的默认体型调整值保留：直接烘进顶点太麻烦，这里只保留权重为 0 的情况）
remap = {}
for mi, m in enumerate(j['meshes']):
    tn = m.get('extras', {}).get('targetNames', [])
    if not tn: continue
    keep = sorted(used.get(mi, set()))
    remap[mi] = {o: i for i, o in enumerate(keep)}
    for p in m['primitives']:
        if 'targets' in p:
            p['targets'] = [p['targets'][k] for k in keep]
            if not p['targets']: del p['targets']
    m['extras']['targetNames'] = [tn[k] for k in keep]
    if 'weights' in m: m['weights'] = [m['weights'][k] for k in keep]
    if not keep: m.pop('weights', None); m['extras'].pop('targetNames', None)
for e in exprs.values():
    for b in e['morphTargetBinds']: b['index'] = remap[nodes[b['node']]['mesh']][b['index']]

# —— 材质：MToon ——
for mt in j['materials']:
    pbr = mt.setdefault('pbrMetallicRoughness', {})
    pbr['metallicFactor'] = 0; pbr['roughnessFactor'] = 1
    tex = pbr.get('baseColorTexture')
    mt['doubleSided'] = True
    mtoon = {'specVersion': '1.0', 'transparentWithZWrite': False, 'renderQueueOffsetNumber': 0,
             'shadeColorFactor': cfg.get('shade', [0.82, 0.78, 0.86]), 'shadingShiftFactor': -0.05, 'shadingToonyFactor': 0.92,
             'giEqualizationFactor': 0.9, 'matcapFactor': [0, 0, 0], 'parametricRimColorFactor': [0, 0, 0], 'parametricRimFresnelPowerFactor': 5,
             'parametricRimLiftFactor': 0, 'rimLightingMixFactor': 1, 'outlineWidthMode': 'none', 'outlineWidthFactor': 0, 'outlineColorFactor': [0, 0, 0], 'outlineLightingMixFactor': 1, 'uvAnimationScrollXSpeedFactor': 0, 'uvAnimationScrollYSpeedFactor': 0, 'uvAnimationRotationSpeedFactor': 0}
    if tex: mtoon['shadeMultiplyTexture'] = {'index': tex['index']}
    mt.setdefault('extensions', {})['VRMC_materials_mtoon'] = mtoon
    mt.pop('emissiveFactor', None); mt.pop('emissiveTexture', None)

# —— 摆动骨骼 ——
hset = set(hb.values())
pat = re.compile(cfg.get('spring', r'hair|skirt|ribbon|tail|breast|belt|coat|ear|bust|ahoge|cap'), re.I)
excl = re.compile(cfg.get('springExclude', r'cheek|eye'), re.I)
cand = {i for i, n in enumerate(names) if 'mesh' not in nodes[i] and i not in hset and pat.search(n) and not excl.search(n)}
springs = []
def params(n):
    s = cfg.get('springParams', {})
    for k, v in s.items():
        if re.search(k, n, re.I): return v
    return {'stiffness': 1.0, 'gravityPower': 0.05, 'dragForce': 0.4, 'hitRadius': 0.02}
def walk(i):
    chain = [i]
    while True:
        ch = [c for c in nodes[chain[-1]].get('children', []) if c in cand]
        if not ch: break
        if len(ch) > 1 and cfg.get('splitHubs'):  # 分叉的根骨（裙子 / 头发的总控骨）不参与摆动，每个分支各自成链
            for c in ch: walk(c)
            break
        for c in ch[1:]: walk(c)
        chain.append(ch[0])
    if len(chain) >= 2:
        p = params(names[i])
        springs.append({'name': names[i], 'joints': [{'node': c, 'hitRadius': p.get('hitRadius', 0.02), 'stiffness': p['stiffness'], 'gravityPower': p['gravityPower'], 'gravityDir': [0, -1, 0], 'dragForce': p['dragForce']} for c in chain], 'colliderGroups': [0]})
if V0:
    for g in V0['secondaryAnimation']['boneGroups']:
        pr = {'stiffness': g.get('stiffiness', 1), 'gravityPower': g.get('gravityPower', 0), 'dragForce': g.get('dragForce', 0.4), 'hitRadius': g.get('hitRadius', 0.02)}
        for r in g.get('bones', []):
            cand = set(); st = [r]
            while st:
                x = st.pop(); cand.add(x); st += [c for c in nodes[x].get('children', []) if 'mesh' not in nodes[c]]
            n0 = len(springs)
            cfg.setdefault('springParams', {})
            params_bak = params
            params = lambda n, pr=pr: pr
            walk(r)
            params = params_bak
else:
    for i in sorted(cand):
        if parent.get(i) not in cand: walk(i)
print('springs', len(springs))
colliders = []
for b, r, off in [('head', 0.09, [0, 0.08, 0]), ('chest', 0.11, [0, 0.03, 0]), ('upperChest', 0.1, [0, 0.03, 0]), ('hips', 0.12, [0, 0, 0]), ('leftUpperLeg', 0.075, [0, -0.12, 0]), ('rightUpperLeg', 0.075, [0, -0.12, 0])]:
    if b in hb:
        if cfg.get('alongChild') and b.endswith('UpperLeg'):  # 骨骼本地轴不一定朝下（MMD 转来的）：沿着到膝盖的方向放
            t = nodes[hb[b.replace('Upper', 'Lower')]].get('translation', [0, -0.4, 0]); off = [x * 0.35 for x in t]
        elif cfg.get('alongChild') and b in ('chest', 'upperChest', 'hips'): continue  # 腰 / 胸的碰撞球会把一开始就在球里的裙摆弹开，不要
        colliders.append({'node': hb[b], 'shape': {'sphere': {'offset': off, 'radius': r * cfg.get('scale', 1)}}})
spring_ext = {'specVersion': '1.0', 'colliders': colliders, 'colliderGroups': [{'name': 'body', 'colliders': list(range(len(colliders)))}], 'springs': springs}

meta = cfg['meta']
vrm = {'specVersion': '1.0', 'meta': {'name': meta['name'], 'version': meta.get('version', '1.0'), 'authors': meta['authors'], 'licenseUrl': 'https://vrm.dev/licenses/1.0/',
       'references': meta.get('references', []), 'avatarPermission': 'onlyAuthor', 'allowExcessivelyViolentUsage': False, 'allowExcessivelySexualUsage': False,
       'commercialUsage': 'personalNonProfit', 'allowPoliticalOrReligiousUsage': False, 'allowAntisocialOrHateUsage': False, 'creditNotation': 'required', 'allowRedistribution': False, 'modification': 'prohibited',
       'otherLicenseUrl': meta.get('license', '')},
       'humanoid': {'humanBones': {k: {'node': v} for k, v in hb.items()}},
       'firstPerson': {'meshAnnotations': [{'node': i, 'type': 'auto'} for i in meshnodes]},
       'expressions': {'preset': {k: v for k, v in exprs.items() if k in ('happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'blinkLeft', 'blinkRight', 'lookUp', 'lookDown', 'lookLeft', 'lookRight', 'neutral')}, 'custom': {k: v for k, v in exprs.items() if k not in ('happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'blinkLeft', 'blinkRight', 'lookUp', 'lookDown', 'lookLeft', 'lookRight', 'neutral')}}}
if 'leftEye' in hb:
    rm = {'inputMaxValue': 90, 'outputScale': 10}
    vrm['lookAt'] = {'type': 'bone', 'offsetFromHeadBone': [0, 0.06, 0], 'rangeMapHorizontalInner': rm, 'rangeMapHorizontalOuter': rm, 'rangeMapVerticalDown': rm, 'rangeMapVerticalUp': rm}
j.setdefault('extensions', {})['VRMC_vrm'] = vrm
j['extensions']['VRMC_springBone'] = spring_ext
eu = set(j.get('extensionsUsed', [])) | {'VRMC_vrm', 'VRMC_springBone', 'VRMC_materials_mtoon'}
j['extensionsUsed'] = sorted(eu)

# —— 重新打包缓冲区（丢掉没用的 accessor），贴图缩小 ——
acc_used = set()
for m in j['meshes']:
    for p in m['primitives']:
        acc_used.update(p['attributes'].values())
        if 'indices' in p: acc_used.add(p['indices'])
        for t in p.get('targets', []): acc_used.update(t.values())
for s in j.get('skins', []):
    if 'inverseBindMatrices' in s: acc_used.add(s['inverseBindMatrices'])
order = sorted(acc_used); amap = {o: i for i, o in enumerate(order)}
for m in j['meshes']:
    for p in m['primitives']:
        p['attributes'] = {k: amap[a] for k, a in p['attributes'].items()}
        if 'indices' in p: p['indices'] = amap[p['indices']]
        if 'targets' in p: p['targets'] = [{k: amap[a] for k, a in t.items()} for t in p['targets']]
for s in j.get('skins', []):
    if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = amap[s['inverseBindMatrices']]
j['accessors'] = [j['accessors'][o] for o in order]
j.pop('animations', None)
out = bytearray(); views = []
def addview(data, extra):
    while len(out) % 4: out.append(0)
    d = dict(extra); d['buffer'] = 0; d['byteOffset'] = len(out); d['byteLength'] = len(data); out.extend(data); views.append(d); return len(views) - 1
bvm = {}
def mapbv(o):
    if o not in bvm:
        bv = j['bufferViews'][o]; s = bv.get('byteOffset', 0)
        bvm[o] = addview(bin_[s:s + bv['byteLength']], {k: bv[k] for k in ('byteStride', 'target') if k in bv})
    return bvm[o]
for a in j['accessors']:
    if 'bufferView' in a: a['bufferView'] = mapbv(a['bufferView'])
    if 'sparse' in a:
        a['sparse']['indices']['bufferView'] = mapbv(a['sparse']['indices']['bufferView'])
        a['sparse']['values']['bufferView'] = mapbv(a['sparse']['values']['bufferView'])
maxTex = cfg.get('maxTex', 2048)
for im in j.get('images', []):
    bv = j['bufferViews'][im['bufferView']]; s = bv.get('byteOffset', 0); data = bin_[s:s + bv['byteLength']]
    img = Image.open(io.BytesIO(data))
    if max(img.size) > maxTex:
        img = img.resize((maxTex, maxTex), Image.LANCZOS); b = io.BytesIO(); img.save(b, 'PNG', optimize=True); data = b.getvalue(); im['mimeType'] = 'image/png'
    im['bufferView'] = addview(bytes(data), {})
j['bufferViews'] = views; j['buffers'] = [{'byteLength': len(out)}]
while len(out) % 4: out.append(0)
js = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
with open(dst, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, 28 + len(js) + len(out))); f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js); f.write(struct.pack('<I4s', len(out), b'BIN\x00')); f.write(out)
print('wrote', dst, 28 + len(js) + len(out), 'exprs', list(exprs))
