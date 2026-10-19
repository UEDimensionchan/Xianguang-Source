# 展示动画工具（Blender 里运行）：在 VRM 归一化空间里写姿势 → 打到 MMD 骨架上做关键帧 → 导出成游戏用的 JSON
import bpy, json, math, builtins, os
from mathutils import Quaternion, Euler, Vector

FPS = 30
HUM = ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head',
       'LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand',
       'RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand',
       'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes',
       'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes']
FING = ['Thumb', 'Index', 'Middle', 'Ring', 'Little']
SEG = ['Proximal', 'Intermediate', 'Distal']
for s in ('Left', 'Right'):
    for f in FING:
        for g in SEG:
            HUM.append(s + f + g)
TH = {'ThumbProximal': 'ThumbMetacarpal', 'ThumbIntermediate': 'ThumbProximal', 'ThumbDistal': 'ThumbDistal'}

def vrm_name(b):
    for k, v in TH.items():
        if b.endswith(k):
            b = b[:-len(k)] + v
    return b[0].lower() + b[1:]

def q3_to_b(q):  # three(Y 上, Z 朝前) → blender(Z 上, -Y 朝前)
    return Quaternion((q.w, q.x, -q.z, q.y))

def qb_to_3(q):
    return Quaternion((q.w, q.x, q.z, -q.y))

def v3_to_b(v):
    return Vector((v[0], -v[2], v[1]))

def vb_to_3(v):
    return [v[0], v[2], -v[1]]

def eul(x, y, z):
    # 先绕 X（扭转）→ 再绕 Z（抬放）→ 再绕 Y（前后摆），都是父骨骼坐标系
    q = Quaternion((0, 1, 0), math.radians(y)) @ Quaternion((0, 0, 1), math.radians(z)) @ Quaternion((1, 0, 0), math.radians(x))
    return q

class Rig:
    def __init__(self, arm):
        self.arm = arm
        B = arm.data.bones
        self.bones = [b for b in HUM if b in B]
        self.rest = {b: B[b].matrix_local.to_quaternion() for b in self.bones}
        self.hp = {}
        for b in self.bones:
            p = B[b].parent
            while p and p.name not in self.rest:
                p = p.parent
            self.hp[b] = p.name if p else None
        self.hips_rest = B['Hips'].head_local.copy()
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'

    def basis(self, b, qn):
        R = self.rest[b]
        return R.inverted() @ q3_to_b(qn) @ R

def mirror(e):
    return (e[0], -e[1], -e[2])

def expand(pose):
    # 'L:UpperArm' 自动镜像到右边；'Fingers.L': 弯曲度 → 五指；其余原样
    out = {}
    for k, v in pose.items():
        if k.startswith('~'):  # ~UpperArm: 左右对称
            out['Left' + k[1:]] = v
            out['Right' + k[1:]] = mirror(v)
        elif k in ('FingersL', 'FingersR'):
            side = 'Left' if k == 'FingersL' else 'Right'
            c = v if isinstance(v, (list, tuple)) else (v,) * 5
            for i, f in enumerate(FING):
                for j, g in enumerate(SEG):
                    a = c[i]
                    if f == 'Thumb':
                        e = (0, -a * 0.5, -a * 0.25)  # 拇指往掌心收
                    else:
                        e = (0, 0, -a * (1.0 if j == 0 else 1.1))
                    out[side + f + g] = e if side == 'Left' else mirror(e)
        else:
            out[k] = v
    return out

def apply_clip(rig, name, keys, base, loop=False):
    arm = rig.arm
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    baseE = expand(base)
    prev = {}
    for t, pose, *rest in keys:
        f = round(t * FPS) + 1
        P = dict(baseE)
        P.update(expand(pose))
        hips = rest[0] if rest else (0, 0, 0)
        for b in rig.bones:
            pb = arm.pose.bones[b]
            e = P.get(b, (0, 0, 0))
            q = rig.basis(b, eul(*e))
            if b in prev and prev[b].dot(q) < 0:
                q = -q
            prev[b] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=f, group=b)
        hb = arm.pose.bones['Hips']
        hb.location = rig.rest['Hips'].inverted() @ v3_to_b(hips)
        hb.keyframe_insert('location', frame=f, group='Hips')
    end = round(keys[-1][0] * FPS) + 1
    act.frame_range = (1, end)
    act.use_frame_range = True
    return act, end

def bake(rig, act, end, loop):
    arm = rig.arm
    sc = bpy.context.scene
    arm.animation_data.action = act
    tracks = {b: [] for b in rig.bones}
    hp = []
    times = []
    for f in range(1, end + 1):
        sc.frame_set(f)
        times.append(round((f - 1) / FPS, 4))
        D = {}
        for b in rig.bones:
            pb = arm.pose.bones[b]
            D[b] = pb.matrix.to_quaternion() @ rig.rest[b].inverted()
        for b in rig.bones:
            p = rig.hp[b]
            qn = (D[p].inverted() @ D[b]) if p else D[b]
            q = qb_to_3(qn)
            tracks[b].extend([round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5)])
        hp.extend(round(x, 4) for x in vb_to_3(arm.pose.bones['Hips'].head))
    out = [{'bone': 'hips', 'type': 'p', 'times': times, 'values': hp}]
    for b in rig.bones:
        v = tracks[b]
        # 整段没动的骨骼（全是单位四元数）就不导出
        if all(abs(v[i]) < 1e-4 for i in range(len(v)) if i % 4 != 3) and vrm_name(b) not in ('hips',):
            pass
        out.append({'bone': vrm_name(b), 'type': 'q', 'times': times, 'values': v})
    return {'duration': times[-1], 'loop': loop, 'tracks': out}

builtins.ANIMLIB = dict(Rig=Rig, apply_clip=apply_clip, bake=bake, expand=expand, eul=eul)
