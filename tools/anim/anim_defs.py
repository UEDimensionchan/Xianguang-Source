# 每个引航者的出场动画 + 待机循环。姿势写在 VRM 归一化空间（角度：X 扭转/前倾，Z 抬放，Y 前后摆；左侧为准，~ 表示左右对称）
L = ANIMLIB
expand = L['expand']

def m(e):
    return (e[0], -e[1], -e[2])

def add(base, *ds):
    e = dict(expand(base))
    for d in ds:
        for k, v in expand(d).items():
            o = e.get(k, (0, 0, 0))
            e[k] = tuple(a + b for a, b in zip(o, v))
    return e

def over(base, *ds):
    e = dict(expand(base))
    for d in ds:
        e.update(expand(d))
    return e

REL = {'~UpperArm': (0, -5, -72), '~LowerArm': (0, -14, 0), '~Hand': (0, -5, -6),
       'FingersL': (10, 12, 15, 18, 22), 'FingersR': (10, 12, 15, 18, 22)}
CLASP = {'~UpperArm': (0, -30, -68), '~LowerArm': (0, -80, 0), '~Hand': (0, -10, 0), 'FingersL': 25, 'FingersR': 25}
HIP_L = {'LeftUpperArm': (40, 30, -45), 'LeftLowerArm': (0, -110, 0), 'LeftHand': (0, 0, -10), 'FingersL': 20}
HIP_R = {'RightUpperArm': m((40, 30, -45)), 'RightLowerArm': m((0, -110, 0)), 'RightHand': m((0, 0, -10)), 'FingersR': 20}
CROSS = {'~UpperArm': (0, -60, -62), 'LeftLowerArm': (0, -115, 8), 'RightLowerArm': m((0, -115, -4)), 'FingersL': 30, 'FingersR': 30}
PEACE_R = {'RightUpperArm': m((0, -40, -30)), 'RightLowerArm': m((0, -40, 120)), 'RightHand': (0, 0, 0), 'FingersR': (60, 0, 0, 90, 90)}
CROUCH = {'~UpperLeg': (-55, 0, 4), '~LowerLeg': (95, 0, 0), '~Foot': (-40, 0, 0), 'Spine': (25, 0, 0), 'Chest': (10, 0, 0), 'Head': (-12, 0, 0)}
FIST = 95

def idle(base, T=4.0, sway=1.0, bob=0.0, extra=None):
    # 呼吸 + 左右重心轻摆，首尾一致可循环
    br = {'Chest': (-2.2, 0, 0), 'Neck': (-1, 0, 0), '~Shoulder': (0, 0, 2), '~UpperArm': (0, 0, 1.5), '~LowerArm': (0, -2, 0)}
    sR = {'Hips': (0, 0, 1.6 * sway), 'Spine': (0, 0, -1.2 * sway), 'Head': (1, 3 * sway, -2.5 * sway),
          '~UpperLeg': (0, 0, -1.6 * sway)}
    sL = {k: (v[0], -v[1], -v[2]) for k, v in sR.items()}
    sL['Head'] = (1, -3 * sway, 2.5 * sway)
    ex = extra or [{}, {}, {}, {}]
    q = T / 4
    return [
        (0, over(base), (0, 0, 0)),
        (q, add(base, br, sR, ex[0]), (-0.012 * sway, -bob, 0)),
        (2 * q, add(base, ex[1]), (0, 0, 0)),
        (3 * q, add(base, br, sL, ex[2]), (0.012 * sway, -bob, 0)),
        (T, over(base), (0, 0, 0)),
    ]

C = {}

# 凛（薄荷）：蹲下起跳 → 落地 → 眼前比耶
b = over(REL, {'~UpperArm': (0, 8, -70), 'Hips': (0, 0, 2), 'Head': (0, 0, 3)})
C['mint'] = dict(base=b, enter=[
    (0.0, over(REL, CROUCH, {'~UpperArm': (0, 40, -60), '~LowerArm': (0, -20, 0)}), (0, -0.22, 0)),
    (0.35, over(REL, {'~UpperLeg': (-15, 0, 3), '~LowerLeg': (35, 0, 0), '~Foot': (20, 0, 0), 'Spine': (-8, 0, 0), 'Head': (-8, 0, 0),
                      '~UpperArm': (0, -20, 30), 'FingersL': 0, 'FingersR': 0}), (0, 0.16, 0)),
    (0.7, over(REL, {'~UpperLeg': (-38, 0, 4), '~LowerLeg': (70, 0, 0), '~Foot': (-32, 0, 0), 'Spine': (18, 0, 0), '~UpperArm': (0, 0, -40)}), (0, -0.12, 0)),
    (1.1, over(REL, PEACE_R, HIP_L, {'Head': (0, -6, 9), 'Hips': (0, 0, -4), 'Spine': (0, 0, 5)}), (0.01, 0, 0)),
    (1.9, over(REL, PEACE_R, HIP_L, {'Head': (0, -4, 12), 'Hips': (0, 0, -4), 'Spine': (0, 0, 6), 'RightLowerArm': m((0, -40, 126))}), (0.01, 0, 0)),
    (2.6, b, (0, 0, 0)),
], idle=idle(b, T=3.2, sway=1.2, bob=0.012))

# 澪（桔梗）：侧身走上前 → 转正 → 双手交叠鞠躬 → 歪头微笑
b = over(CLASP, {'Head': (0, 0, 4)})
C['kikyo'] = dict(base=b, enter=[
    (0.0, over(REL, {'Hips': (0, -25, 0), 'Head': (6, -18, 0), 'LeftUpperLeg': (-18, 0, 0), 'LeftLowerLeg': (20, 0, 0)}), (0, 0, -0.05)),
    (0.6, over(CLASP, {'Head': (2, 0, 0)}), (0, 0, 0)),
    (1.05, over(CLASP, {'Spine': (18, 0, 0), 'Chest': (10, 0, 0), 'Neck': (8, 0, 0), 'Head': (12, 0, 0)}), (0, -0.01, -0.03)),
    (1.65, over(CLASP, {'Spine': (20, 0, 0), 'Chest': (11, 0, 0), 'Neck': (8, 0, 0), 'Head': (13, 0, 0)}), (0, -0.01, -0.035)),
    (2.2, over(CLASP, {'Head': (0, 0, 9)}), (0, 0, 0)),
    (2.9, b, (0, 0, 0)),
], idle=idle(b, T=4.4, sway=0.8))

# 星野（赛蕾斯蒂娅）：背身旋转一圈 → 一手抚胸、一手向外舒展
b = over(REL, {'LeftUpperArm': (0, -25, -70), 'LeftLowerArm': (0, -95, 0), 'Hips': (0, 0, 3), 'Spine': (0, 0, -2), 'Head': (-3, 0, -3)})
SPIN = {'~UpperArm': (0, -10, -40), '~LowerArm': (0, -20, 0), 'LeftUpperLeg': (-15, 0, 0), 'LeftLowerLeg': (30, 0, 0), 'FingersL': 5, 'FingersR': 5}
OPEN = {'RightUpperArm': m((0, -30, 15)), 'RightLowerArm': m((0, -10, 0)), 'RightHand': m((-60, 0, 10)),
        'LeftUpperArm': (0, -40, -70), 'LeftLowerArm': (0, -120, 10), 'Head': (-6, 0, -6), 'FingersR': 5}
C['selestia'] = dict(base=b, enter=[
    (0.0, over(REL, SPIN, {'Hips': (0, 180, 0)}), (0, 0, 0)),
    (0.3, over(REL, SPIN, {'Hips': (0, 270, 0)}), (0, 0.02, 0)),
    (0.6, over(REL, SPIN, {'Hips': (0, 355, 0), 'LeftUpperLeg': (-5, 0, 0), 'LeftLowerLeg': (10, 0, 0)}), (0, 0, 0)),
    (1.0, over(REL, OPEN), (0, 0, 0)),
    (1.8, over(REL, OPEN, {'RightUpperArm': m((0, -35, 20)), 'Head': (-7, 0, -8)}), (0, 0, 0)),
    (2.5, b, (0, 0, 0)),
], idle=idle(b, T=4.6, sway=0.9))

# 露希（SAKAMATA）：低头 → 抬头 → 敬礼
b = over(REL, HIP_L, {'Hips': (0, 0, -3), 'Head': (0, 0, 3)})
SALUTE = {'RightUpperArm': m((0, -40, 28)), 'RightLowerArm': m((0, -148, 40)), 'RightHand': m((0, 0, -10)), 'FingersR': 0}
C['luxi'] = dict(base=b, enter=[
    (0.0, over(REL, {'Spine': (12, 0, 0), 'Head': (14, 0, 0), '~UpperArm': (0, 15, -72)}), (0, -0.05, 0)),
    (0.4, over(REL, {'Spine': (-6, 0, 0), 'Head': (-8, 0, 0)}), (0, 0.03, 0)),
    (0.8, over(REL, HIP_L, SALUTE, {'Head': (0, 0, -6), 'RightUpperLeg': (-8, 0, 0), 'RightLowerLeg': (18, 0, 0)}), (0, 0, 0)),
    (1.6, over(REL, HIP_L, SALUTE, {'Head': (0, 0, -8), 'RightUpperArm': m((0, -35, 12))}), (0, 0, 0)),
    (2.3, b, (0, 0, 0)),
], idle=idle(b, T=3.8))

# 白羽（BIJOU）：侧着头害羞 → 小幅挥手 → 双手交叠
b = over(CLASP, {'Head': (5, 0, 8), '~UpperLeg': (0, 0, -3)})
WAVE = {'RightUpperArm': m((0, -25, -45)), 'RightHand': (0, 0, 0), 'FingersR': 5}
C['baiyu'] = dict(base=b, enter=[
    (0.0, over(CLASP, {'Hips': (0, 25, 0), 'Head': (12, 20, 0)}), (0, 0, 0)),
    (0.6, over(CLASP, WAVE, {'Head': (4, 0, 6), 'RightLowerArm': m((0, -30, 100))}), (0, 0, 0)),
    (0.9, over(CLASP, WAVE, {'Head': (4, 0, 8), 'RightLowerArm': m((0, -30, 118))}), (0, 0, 0)),
    (1.2, over(CLASP, WAVE, {'Head': (4, 0, 8), 'RightLowerArm': m((0, -30, 92))}), (0, 0, 0)),
    (1.5, over(CLASP, WAVE, {'Head': (4, 0, 9), 'RightLowerArm': m((0, -30, 118))}), (0, 0, 0)),
    (1.8, over(CLASP, WAVE, {'Head': (5, 0, 9), 'RightLowerArm': m((0, -30, 96))}), (0, 0, 0)),
    (2.5, b, (0, 0, 0)),
], idle=idle(b, T=4.4, sway=1.1))

# 黛音（CHIHAYA）：侧身走来 → 撩头发 → 单手叉腰
b = over(REL, HIP_R, {'Hips': (0, 0, 4), 'Spine': (0, 0, -3), 'Head': (-3, 0, 0)})
C['daiyin'] = dict(base=b, enter=[
    (0.0, over(REL, {'Hips': (0, -30, 0), 'Head': (0, -15, 0), 'LeftUpperLeg': (-20, 0, 0), 'LeftLowerLeg': (25, 0, 0)}), (0, 0, -0.05)),
    (0.5, over(REL, {'LeftUpperArm': (0, 10, 40), 'LeftLowerArm': (0, -130, 0), 'Head': (0, 10, -8), 'FingersL': 10}), (0, 0, 0)),
    (1.2, over(REL, {'LeftUpperArm': (0, 12, 42), 'LeftLowerArm': (0, -132, 0), 'Head': (0, 12, -10), 'FingersL': 10}), (0, 0, 0)),
    (1.5, over(REL, {'LeftUpperArm': (0, 30, 50), 'LeftLowerArm': (0, -100, 0), 'Head': (0, -5, 6), 'FingersL': 5}), (0, 0, 0)),
    (2.0, over(REL, HIP_R, {'Hips': (0, 0, 4), 'Head': (-3, 0, 2)}), (0, 0, 0)),
    (2.6, b, (0, 0, 0)),
], idle=idle(b, T=4.2, sway=0.9))

# 绯樱（SAKUNA）：高高跳起 → 落地 → 握拳振臂
b = over(REL, {'FingersL': 45, 'FingersR': 45, '~UpperArm': (0, 0, -70), 'Head': (-2, 0, 0)})
PUMP = {'RightUpperArm': m((0, -20, 40)), 'RightLowerArm': m((0, -30, 60)), 'FingersR': FIST,
        'LeftUpperArm': (0, 20, -70), 'LeftLowerArm': (0, -100, 0), 'FingersL': FIST, 'Head': (-8, 0, 0), 'Spine': (-5, 0, 0)}
C['feiying'] = dict(base=b, enter=[
    (0.0, over(REL, CROUCH, {'~UpperArm': (0, 35, -65)}), (0, -0.2, 0)),
    (0.3, over(REL, {'~UpperLeg': (-40, 0, 6), '~LowerLeg': (80, 0, 0), '~Foot': (10, 0, 0), '~UpperArm': (0, -10, 50), 'FingersL': 0, 'FingersR': 0, 'Head': (-10, 0, 0)}), (0, 0.24, 0)),
    (0.65, over(REL, {'~UpperLeg': (-36, 0, 5), '~LowerLeg': (68, 0, 0), '~Foot': (-30, 0, 0), 'Spine': (16, 0, 0), '~UpperArm': (0, 0, -45)}), (0, -0.11, 0)),
    (1.0, over(REL, PUMP), (0, 0, 0)),
    (1.3, over(REL, PUMP, {'RightUpperArm': m((0, -20, 22)), 'RightLowerArm': m((0, -30, 80))}), (0, -0.015, 0)),
    (1.6, over(REL, PUMP, {'RightUpperArm': m((0, -20, 45))}), (0, 0, 0)),
    (2.4, b, (0, 0, 0)),
], idle=idle(b, T=3.0, sway=1.2, bob=0.015))

# 雪兔（PEKOMAMA）：双手挥手 → 双手捧在胸前
b = over(CLASP, {'Head': (2, 0, -5), '~UpperArm': (0, -28, -70)})
W2 = {'~UpperArm': (0, -30, -35), 'FingersL': 5, 'FingersR': 5, '~Hand': (0, 0, 0)}
C['xuetu'] = dict(base=b, enter=[
    (0.0, over(CLASP, {'Head': (10, 0, 0), 'Spine': (10, 0, 0)}), (0, 0, 0)),
    (0.5, over(REL, W2, {'~LowerArm': (0, -30, 105), 'Head': (-5, 0, 6)}), (0, 0, 0)),
    (0.85, over(REL, W2, {'LeftLowerArm': (0, -30, 88), 'RightLowerArm': m((0, -30, 115)), 'Head': (-5, 0, 7)}), (0, 0, 0)),
    (1.2, over(REL, W2, {'LeftLowerArm': (0, -30, 115), 'RightLowerArm': m((0, -30, 88)), 'Head': (-5, 0, 5)}), (0, 0, 0)),
    (1.55, over(REL, W2, {'LeftLowerArm': (0, -30, 90), 'RightLowerArm': m((0, -30, 112)), 'Head': (-5, 0, 7)}), (0, 0, 0)),
    (2.3, over(REL, {'~UpperArm': (0, -45, -62), '~LowerArm': (0, -125, 10), 'Head': (0, 0, 10), 'FingersL': 20, 'FingersR': 20}), (0, 0, 0)),
    (3.0, b, (0, 0, 0)),
], idle=idle(b, T=4.8, sway=0.8))

# 琉璃（VIVI）：俯身凑近镜头 → 双手捧脸左右歪头
b = over(REL, {'~UpperArm': (0, -15, -70), '~LowerArm': (0, -40, 0), 'LeftUpperLeg': (-8, 0, 0), 'LeftLowerLeg': (16, 0, 0), 'LeftFoot': (-6, 0, 0), 'Hips': (0, 0, -3), 'Head': (0, 0, -4)})
CHEEK = {'~UpperArm': (0, -48, -36), '~LowerArm': (0, -142, 50), 'FingersL': 10, 'FingersR': 10}
C['liuli'] = dict(base=b, enter=[
    (0.0, over(REL, {'Spine': (25, 0, 0), 'Chest': (8, 0, 0), 'Head': (-25, 0, 0), '~UpperArm': (0, -60, -70), '~LowerArm': (0, -10, 0)}), (0, -0.03, -0.06)),
    (0.6, over(REL, CHEEK, {'Spine': (15, 0, 0), 'Head': (-10, 0, 10)}), (0, -0.02, -0.03)),
    (1.2, over(REL, CHEEK, {'Spine': (14, 0, 0), 'Head': (-10, 0, -10), 'Hips': (0, 0, 3)}), (0, -0.02, -0.03)),
    (1.8, over(REL, CHEEK, {'Spine': (12, 0, 0), 'Head': (-8, 0, 9)}), (0, -0.015, -0.02)),
    (2.5, b, (0, 0, 0)),
], idle=idle(b, T=3.6, sway=1.1, bob=0.006))

# 绮罗（CALLI）：大步走来 → 指向镜头 → 抱臂
b = over(REL, CROSS, {'Hips': (0, 0, 3), 'Head': (-4, 0, 0), '~UpperLeg': (0, 0, 4)})
POINT = {'RightUpperArm': m((0, -80, -5)), 'RightLowerArm': (0, 0, 0), 'RightHand': (0, 0, 0), 'FingersR': (60, 0, 90, 90, 90)}
C['qiluo'] = dict(base=b, enter=[
    (0.0, over(REL, {'LeftUpperLeg': (-30, 0, 0), 'LeftLowerLeg': (20, 0, 0), 'RightUpperLeg': (15, 0, 0), 'RightLowerLeg': (30, 0, 0),
                     'LeftUpperArm': (0, 30, -72), 'RightUpperArm': m((0, -30, -72)), 'Hips': (0, 10, 0)}), (0, 0, -0.25)),
    (0.4, over(REL, {'RightUpperLeg': (-30, 0, 0), 'RightLowerLeg': (20, 0, 0), 'LeftUpperLeg': (15, 0, 0), 'LeftLowerLeg': (30, 0, 0),
                     'RightUpperArm': m((0, 30, -72)), 'LeftUpperArm': (0, -30, -72), 'Hips': (0, -10, 0)}), (0, 0.01, -0.12)),
    (0.8, over(REL, POINT, HIP_L, {'Hips': (0, -15, 0), 'Spine': (0, 10, 0), 'Head': (-4, 6, 0)}), (0, 0, 0)),
    (1.6, over(REL, POINT, HIP_L, {'Hips': (0, -15, 0), 'Spine': (0, 12, 0), 'Head': (-5, 6, -3), 'RightUpperArm': m((0, -78, -2))}), (0, 0, 0)),
    (2.1, over(REL, CROSS, {'Head': (-4, 0, 3)}), (0, 0, 0)),
    (2.6, b, (0, 0, 0)),
], idle=idle(b, T=4.2, sway=0.9))

import builtins
builtins.CLIPS = C
