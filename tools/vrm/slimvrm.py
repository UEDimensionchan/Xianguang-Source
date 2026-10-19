# 精简 VRM0：只保留表情用到的变形目标，贴图缩到 maxTex，重新打包缓冲区
import json, struct, sys, io
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
maxTex = int(sys.argv[3]) if len(sys.argv) > 3 else 2048
keepAll = set(sys.argv[4].split(',')) if len(sys.argv) > 4 else set()
raw = open(src, 'rb').read()
L = struct.unpack('<I', raw[12:16])[0]
j = json.loads(raw[20:20 + L])
off = 20 + L; BL = struct.unpack('<I', raw[off:off + 4])[0]; bin_ = raw[off + 8: off + 8 + BL]
v = j['extensions'].get('VRM')
import numpy as np
bin_ = bytearray(bin_)
def acc_np(ai):
    a = j['accessors'][ai]; n = a['count']; o = None
    if 'bufferView' in a:
        bv = j['bufferViews'][a['bufferView']]; o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        assert not bv.get('byteStride') or bv['byteStride'] == 12
        arr = np.frombuffer(bytes(bin_[o:o + n * 12]), dtype='<f4').reshape(n, 3).copy()
    else: arr = np.zeros((n, 3), dtype='<f4')
    assert 'sparse' not in a
    return o, arr
# 默认表情 Neutral（丝袜、高跟、上衣开关等体型修正）直接烘进顶点
groups = v['blendShapeMaster']['blendShapeGroups']
for g in groups:
    if g.get('presetName') != 'neutral': continue
    for b in g['binds']:
        for p in j['meshes'][b['mesh']]['primitives']:
            t = p['targets'][b['index']]
            o, base = acc_np(p['attributes']['POSITION']); _, d = acc_np(t['POSITION'])
            base += d * (b['weight'] / 100); bin_[o:o + base.nbytes] = base.astype('<f4').tobytes()
            acc = j['accessors'][p['attributes']['POSITION']]; acc['min'] = base.min(0).tolist(); acc['max'] = base.max(0).tolist()
    g['binds'] = []
bin_ = bytes(bin_)
used = {}
for g in v['blendShapeMaster']['blendShapeGroups']:
    for b in g['binds']: used.setdefault(b['mesh'], set()).add(b['index'])
remap = {}
for mi, m in enumerate(j['meshes']):
    n = len(m['primitives'][0].get('targets', []))
    if not n: continue
    keep = sorted(used.get(mi, set())) if m['name'] not in keepAll else list(range(n))
    remap[mi] = {o: i for i, o in enumerate(keep)}
    for p in m['primitives']:
        if 'targets' in p:
            p['targets'] = [p['targets'][k] for k in keep]
            if not p['targets']: del p['targets']
        if 'extras' in p and 'targetNames' in p['extras']: p['extras']['targetNames'] = [p['extras']['targetNames'][k] for k in keep]
    if 'extras' in m and 'targetNames' in m['extras']: m['extras']['targetNames'] = [m['extras']['targetNames'][k] for k in keep]
    if 'weights' in m: m['weights'] = [m['weights'][k] for k in keep] or None
    if m.get('weights') is None: m.pop('weights', None)
for g in v['blendShapeMaster']['blendShapeGroups']:
    for b in g['binds']: b['index'] = remap[b['mesh']][b['index']]
# 收集还在用的 accessor / bufferView
acc_used = set()
for m in j['meshes']:
    for p in m['primitives']:
        acc_used.update(p['attributes'].values())
        if 'indices' in p: acc_used.add(p['indices'])
        for t in p.get('targets', []): acc_used.update(t.values())
for s in j.get('skins', []):
    if 'inverseBindMatrices' in s: acc_used.add(s['inverseBindMatrices'])
for a in j.get('animations', []):
    for smp in a['samplers']: acc_used.update([smp['input'], smp['output']])
acc_map = {o: i for i, o in enumerate(sorted(acc_used))}
newacc = [j['accessors'][o] for o in sorted(acc_used)]
def fix_acc(x): return acc_map[x]
for m in j['meshes']:
    for p in m['primitives']:
        p['attributes'] = {k: fix_acc(a) for k, a in p['attributes'].items()}
        if 'indices' in p: p['indices'] = fix_acc(p['indices'])
        if 'targets' in p: p['targets'] = [{k: fix_acc(a) for k, a in t.items()} for t in p['targets']]
for s in j.get('skins', []):
    if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = fix_acc(s['inverseBindMatrices'])
for a in j.get('animations', []):
    for smp in a['samplers']: smp['input'] = fix_acc(smp['input']); smp['output'] = fix_acc(smp['output'])
j['accessors'] = newacc
out = bytearray(); views = []
def addview(data, extra):
    while len(out) % 4: out.append(0)
    d = dict(extra); d['buffer'] = 0; d['byteOffset'] = len(out); d['byteLength'] = len(data)
    out.extend(data); views.append(d); return len(views) - 1
bv_map = {}
for a in j['accessors']:
    if 'bufferView' not in a: continue
    o = a['bufferView']
    if o not in bv_map:
        bv = j['bufferViews'][o]; s = bv.get('byteOffset', 0)
        ex = {k: bv[k] for k in ('byteStride', 'target') if k in bv}
        bv_map[o] = addview(bin_[s:s + bv['byteLength']], ex)
    a['bufferView'] = bv_map[o]
for im in j.get('images', []):
    bv = j['bufferViews'][im['bufferView']]; s = bv.get('byteOffset', 0); data = bin_[s:s + bv['byteLength']]
    img = Image.open(io.BytesIO(data))
    if max(img.size) > maxTex:
        r = maxTex / max(img.size); img = img.resize((max(1, round(img.size[0] * r)), max(1, round(img.size[1] * r))), Image.LANCZOS)
        b = io.BytesIO(); img.save(b, 'PNG', optimize=True); data = b.getvalue()
    im['bufferView'] = addview(data, {})
j['bufferViews'] = views
j['buffers'] = [{'byteLength': len(out)}]
while len(out) % 4: out.append(0)
js = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
total = 12 + 8 + len(js) + 8 + len(out)
with open(dst, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, total)); f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
    f.write(struct.pack('<I4s', len(out), b'BIN\x00')); f.write(out)
print('out', total)
