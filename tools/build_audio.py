# 从原始音效包生成游戏用的音效（单声道 ogg，去掉开头静音，裁剪长度，峰值归一化）
# 用法：python3 tools/build_audio.py <解压后的音效包目录> <输出 Asset/Audio 目录>
# 原始包：Snake's Authentic Gun Sounds 第一包和第二包（f8studios.itch.io），Kenney Impact Sounds、Interface Sounds（CC0）
import os, subprocess, sys, json

SRC, OUT = sys.argv[1], sys.argv[2]
S1 = os.path.join(SRC, "s1", "Snake's Authentic Gun Sounds")
S2 = os.path.join(SRC, "s2", "Snake's SECOND Authentic Gun Sounds")
RL1 = os.path.join(S1, "Reloads, Cycling & More", "WAV")
KI = os.path.join(SRC, "kimp", "Audio")
KU = os.path.join(SRC, "kui", "Audio")


def s1shot(cal):
    return os.path.join(S1, "Full Sound", cal, "WAV", {"5.56": "556", "7.62x39": "762x39", "7.62x54R": "762x54r", ".22LR": "22LR"}[cal] + " Single WAV.wav")


def s2shot(cal, name):
    return os.path.join(S2, "Full Sounds", cal, "WAV", name + " Single.wav")


def s2more(*p):
    return os.path.join(S2, "& More", *p)


# 每个条目：输出路径 → (源文件 | [多个源文件混合], 选项)
# 选项：len 最长秒数，fade 从第几秒开始淡出，rate 变调（<1 更低沉），lp 低通，hp 高通，gain 分贝，delay 每个源的延迟（毫秒）
R = {}
def add(path, src, **o):
    R[path] = (src, o)

# ———— 开火 ————
add("Weapon/AssaultRifle/shot", s1shot("5.56"), len=1.1, fade=0.18)
add("Weapon/SMG/shot", s2shot("9mm", "9mm"), len=0.75, fade=0.12, rate=1.06, hp=120)
add("Weapon/LightMachineGun/shot", s1shot("7.62x39"), len=1.1, fade=0.2, rate=0.97)
add("Weapon/Sniper/shot", s1shot("7.62x54R"), len=2.0, fade=0.5)
add("Weapon/Pistol/shot", s2shot("9mm", "9mm"), len=1.2, fade=0.25)
add("Weapon/Revolver/shot", s2shot(".308 (7.62x51)", "308"), len=1.6, fade=0.35, rate=1.08)
add("Weapon/Shotgun/shot", s2shot("20 Gauge", "20 Gauge"), len=1.8, fade=0.4)
add("Weapon/RocketLauncher/shot", [s2shot("20 Gauge", "20 Gauge"), s1shot("7.62x54R")], len=1.6, fade=0.4, rate=0.62, lp=3200, gain=-1)

# ———— 开火后的机械声（栓动、泵动） ————
add("Weapon/Sniper/bolt", os.path.join(RL1, "308 Bolt Cycle WAV.wav"))
add("Weapon/Shotgun/pump", os.path.join(RL1, "Pump Reload Full Fast WAV.wav"))

# ———— 换弹分段 ————
add("Weapon/AssaultRifle/mag_out", os.path.join(RL1, "AR Reload Part 1 WAV.wav"))
add("Weapon/AssaultRifle/mag_in", os.path.join(RL1, "AR Reload Part 2 WAV.wav"))
add("Weapon/AssaultRifle/charge", os.path.join(RL1, "AR Charging Handle WAV.wav"))
add("Weapon/SMG/mag_out", os.path.join(RL1, "AR Reload Part 1 WAV.wav"), rate=1.12)
add("Weapon/SMG/mag_in", os.path.join(RL1, "AR Reload Part 2 WAV.wav"), rate=1.12)
add("Weapon/SMG/bolt", os.path.join(RL1, "AR Bolt Release WAV.wav"), rate=1.05)
add("Weapon/LightMachineGun/cover_open", os.path.join(RL1, "Single Shot Reload Part 1 WAV.wav"), rate=0.9)
add("Weapon/LightMachineGun/mag_out", os.path.join(RL1, "AK Reload Part 1 WAV.wav"), rate=0.9)
add("Weapon/LightMachineGun/mag_in", os.path.join(RL1, "AK Reload Part 2 WAV.wav"), rate=0.9)
add("Weapon/LightMachineGun/cover_close", os.path.join(RL1, "Single Shot Reload Part 2 WAV.wav"), rate=0.9)
add("Weapon/LightMachineGun/charge", os.path.join(RL1, "AK Rack WAV.wav"))
add("Weapon/Sniper/bolt_open", os.path.join(RL1, "Mosin Bolt Cycle WAV.wav"), len=0.6, fade=0.45)
add("Weapon/Sniper/mag_out", os.path.join(RL1, "308 Magazine Part 1 WAV.wav"))
add("Weapon/Sniper/mag_in", os.path.join(RL1, "308 Magazine Part 2 WAV.wav"))
add("Weapon/Pistol/mag_out", s2more("Pistol", "WAV", "9mm Pistol Reload 1.wav"))
add("Weapon/Pistol/mag_in", s2more("Pistol", "WAV", "9mm Pistol Reload 2.wav"))
add("Weapon/Pistol/slide", s2more("Pistol", "WAV", "9mm Pistol Rack Full.wav"))
add("Weapon/Revolver/open", s2more("Revolver", "44 Magnum", "WAV", "44 Magnum Open Cylinder.wav"))
add("Weapon/Revolver/eject", s2more("Revolver", "44 Magnum", "WAV", "44 Magnum Eject Full With Floor Impact.wav"), len=1.6, fade=1.2)
add("Weapon/Revolver/load", s2more("Revolver", "44 Magnum", "WAV", "44 Magnum Single Load.wav"))
add("Weapon/Revolver/close", s2more("Revolver", "44 Magnum", "WAV", "44 Magnum Close Cylinder.wav"))
add("Weapon/Revolver/hammer", s2more("Revolver", "44 Magnum", "WAV", "44 Magnum Cock Hammer.wav"))
add("Weapon/Shotgun/shell", os.path.join(RL1, "Pump Shell Load WAV.wav"))
add("Weapon/Shotgun/pump_slow", os.path.join(RL1, "Pump Reload Full WAV.wav"))
add("Weapon/RocketLauncher/breech_open", os.path.join(RL1, "Single Shot Reload Part 1 WAV.wav"), rate=0.7)
add("Weapon/RocketLauncher/load", s2more("Mag Pack", "WAV", "Mosin Top Load.wav"), rate=0.62)
add("Weapon/RocketLauncher/breech_close", os.path.join(RL1, "Single Shot Reload Part 2 WAV.wav"), rate=0.7)

# ———— 通用 ————
add("Weapon/Common/dry_fire", s2more("Pistol", "WAV", "9mm Pistol Dry Fire.wav"))
add("Weapon/Common/switch", os.path.join(RL1, "AR Bolt Release WAV.wav"), rate=1.15, gain=-4)

# ———— 命中 / 击杀 ————
add("Combat/hit_body", [os.path.join(KU, "click_004.ogg"), os.path.join(KI, "impactSoft_medium_000.ogg")], len=0.25, gain=0)
add("Combat/hit_head", [os.path.join(KU, "glass_001.ogg"), os.path.join(KU, "click_004.ogg")], len=0.4)
add("Combat/kill", [os.path.join(KU, "confirmation_003.ogg"), os.path.join(KI, "impactPunch_heavy_000.ogg")], len=0.8, fade=0.5)
add("Combat/kill_head", [os.path.join(KU, "glass_004.ogg"), os.path.join(KI, "impactPunch_heavy_000.ogg"), os.path.join(KU, "confirmation_003.ogg")], len=1.0, fade=0.7, delay=[0, 0, 60])
for i in range(3):
    add(f"Combat/impact_wall_{i+1}", os.path.join(KI, f"impactPlate_light_00{i}.ogg"), gain=-3)
add("Combat/explosion", [s2shot("20 Gauge", "20 Gauge"), s1shot("7.62x54R"), os.path.join(KI, "impactPlate_heavy_000.ogg")], len=2.4, fade=0.7, rate=0.42, lp=1400, delay=[0, 30, 0])
add("Combat/player_hurt", os.path.join(KI, "impactPunch_medium_000.ogg"))

# ———— 角色 / 技能 ————
add("Player/paper", os.path.join(KU, "scratch_002.ogg"))
add("Player/unpaper", os.path.join(KU, "scratch_004.ogg"))


def detect_onset(path):
    # 用 silencedetect 找开头静音的长度
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "silencedetect=n=-45dB:d=0.005", "-f", "null", "-"], capture_output=True, text=True)
    for line in r.stderr.splitlines():
        if "silence_end" in line:
            t = float(line.split("silence_end:")[1].split("|")[0])
            first_start = None
            for l2 in r.stderr.splitlines():
                if "silence_start" in l2:
                    first_start = float(l2.split("silence_start:")[1]); break
            return max(0, t - 0.003) if first_start is not None and first_start < 0.01 else 0
    return 0


def build(name, src, o):
    srcs = src if isinstance(src, list) else [src]
    for s in srcs:
        if not os.path.exists(s):
            raise SystemExit("找不到源文件: " + s)
    out = os.path.join(OUT, name + ".ogg")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    for s in srcs:
        args += ["-ss", f"{detect_onset(s):.3f}", "-i", s]
    chains = []
    delays = o.get("delay", [0] * len(srcs))
    for i in range(len(srcs)):
        chains.append(f"[{i}:a]aformat=sample_rates=44100:channel_layouts=mono,adelay={delays[i]}[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(srcs)))
    f = f"{mix}amix=inputs={len(srcs)}:normalize=0" if len(srcs) > 1 else "[a0]anull"
    rate = o.get("rate")
    if rate:
        f += f",asetrate={int(44100 * rate)},aresample=44100"
    if o.get("hp"): f += f",highpass=f={o['hp']}"
    if o.get("lp"): f += f",lowpass=f={o['lp']}"
    L = o.get("len")
    if L:
        fade = o.get("fade", L * 0.7)
        f += f",atrim=0:{L},afade=t=out:st={fade}:d={max(0.02, L - fade)}:curve=exp"
    # 峰值归一化到 -1 dBFS，再加增益
    f += ",loudnorm=I=-14:TP=-1:LRA=11" if False else ""
    graph = ";".join(chains) + ";" + f + "[pre]"
    # 先跑一遍拿峰值
    tmp = out + ".tmp.wav"
    subprocess.run(args + ["-filter_complex", graph, "-map", "[pre]", tmp], check=True)
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", tmp, "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    peak = 0.0
    for line in r.stderr.splitlines():
        if "max_volume" in line:
            peak = float(line.split("max_volume:")[1].split("dB")[0])
    g = -1.0 - peak + o.get("gain", 0)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-af", f"volume={g:.2f}dB", "-c:a", "libvorbis", "-q:a", "4", out], check=True)
    os.remove(tmp)
    d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], capture_output=True, text=True).stdout)
    return {"file": name + ".ogg", "sec": round(d, 2), "peak_in": peak}


report = {k: build(k, s, o) for k, (s, o) in R.items()}
print(json.dumps(report, ensure_ascii=False, indent=0))
