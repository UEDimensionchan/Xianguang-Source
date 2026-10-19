# 压缩 VRM：不透明贴图转 JPEG、变形目标转稀疏并去掉法线差值
import json, struct, sys, io
import numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
q = int(sys.argv[3]) if len(sys.argv) > 3 else 88
raw = open(src, 'rb').read(); L = struct.unpack('<I', raw[12:16])[0]
j = json.loads(raw[20:20 + L]); off = 20 + L; bin_ = raw[off + 8:off + 8 + struct.unpack('<I', raw[off:off + 4])[0]]
out = bytearray(); views = []
def addview(data, extra={}):
    while len(out) % 4: out.append(0)
    d = dict(extra); d.update(buffer=0, byteOffset=len(out), byteLength=len(data)); out.extend(data); views.append(d); return len(views) - 1
def read(a):
    bv = j['bufferViews'][a['bufferView']]; o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    comp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    dt = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: '<u1', 5122: '<i2', 5120: '<i1'}[a['componentType']]
    isz = np.dtype(dt).itemsize; stride = bv.get('byteStride') or comp * isz
    arr = np.frombuffer(bin_, dtype=np.uint8, count=stride * (a['count'] - 1) + comp * isz, offset=o)
    return np.lib.stride_tricks.as_strided(arr.view(dt) if stride == comp * isz else np.frombuffer(bin_, dtype=dt, count=(stride * a['count']) // isz, offset=o).reshape(a['count'], stride // isz)[:, :comp], shape=(a['count'], comp)).copy() if stride == comp * isz else np.frombuffer(bin_, dtype=dt, count=(stride * a['count']) // isz, offset=o).reshape(a['count'], stride // isz)[:, :comp].copy()
newacc = []; amap = {}
def copy_acc(i):
    if i in amap: return amap[i]
    a = dict(j['accessors'][i])
    if 'bufferView' in a:
        arr = read(j['accessors'][i]); bv = j['bufferViews'][a['bufferView']]
        a['bufferView'] = addview(arr.tobytes(), {'target': bv['target']} if 'target' in bv else {}); a.pop('byteOffset', None)
    if 'sparse' in a:
        sp = json.loads(json.dumps(a['sparse']))
        for k in ('indices', 'values'):
            bv = j['bufferViews'][sp[k]['bufferView']]; o = bv.get('byteOffset', 0) + sp[k].get('byteOffset', 0)
            isz = {5125: 4, 5123: 2, 5121: 1}[sp[k]['componentType']] if k == 'indices' else 12
            sp[k]['bufferView'] = addview(bin_[o:o + sp['count'] * isz]); sp[k].pop('byteOffset', None)
        a['sparse'] = sp
    newacc.append(a); amap[i] = len(newacc) - 1; return amap[i]
def sparse_acc(i):
    a = j['accessors'][i]
    if 'sparse' in a or 'bufferView' not in a: return copy_acc(i)
    arr = read(a); nz = np.nonzero(np.abs(arr).max(1) > 1e-7)[0].astype('<u4')
    s = {'componentType': 5126, 'count': a['count'], 'type': a['type'], 'max': a.get('max', [0, 0, 0]), 'min': a.get('min', [0, 0, 0])}
    if len(nz):
        s['sparse'] = {'count': int(len(nz)), 'indices': {'bufferView': addview(nz.tobytes()), 'componentType': 5125}, 'values': {'bufferView': addview(arr[nz].astype('<f4').tobytes())}}
    newacc.append(s); return len(newacc) - 1
for m in j['meshes']:
    for p in m['primitives']:
        p['attributes'] = {k: copy_acc(v) for k, v in p['attributes'].items()}
        if 'indices' in p: p['indices'] = copy_acc(p['indices'])
        if 'targets' in p: p['targets'] = [{'POSITION': sparse_acc(t['POSITION'])} for t in p['targets']]
for s in j.get('skins', []):
    if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = copy_acc(s['inverseBindMatrices'])
j['accessors'] = newacc
for im in j['images']:
    bv = j['bufferViews'][im['bufferView']]; o = bv.get('byteOffset', 0); data = bin_[o:o + bv['byteLength']]
    img = Image.open(io.BytesIO(data)); img.load()
    if img.mode in ('RGBA', 'LA') and np.asarray(img.getchannel('A')).min() < 250: pass
    else:
        b = io.BytesIO(); img.convert('RGB').save(b, 'JPEG', quality=q, optimize=True)
        if len(b.getvalue()) < len(data): data = b.getvalue(); im['mimeType'] = 'image/jpeg'
    im['bufferView'] = addview(bytes(data))
j['bufferViews'] = views; j['buffers'] = [{'byteLength': len(out)}]
while len(out) % 4: out.append(0)
js = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
with open(dst, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, 28 + len(js) + len(out))); f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js); f.write(struct.pack('<I4s', len(out), b'BIN\x00')); f.write(out)
print(dst, (28 + len(js) + len(out)) / 1e6)
