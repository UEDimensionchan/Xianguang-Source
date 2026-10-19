# 素材来源与授权记录

所有素材均允许用于商业游戏和修改。上线前需要在游戏的「致谢 / Credits」页面写上下面标注 **需要署名** 的两项。

## 需要署名（必须保留）

| 文件 | 署名写法 |
|---|---|
| `Scene/LittlestTokyo.glb` | "Littlest Tokyo" by glenatron (https://sketchfab.com/glenatron), CC BY 4.0 |
| `Character/VRM/Seed-san.vrm` | Seed-san model by VirtualCast, Inc. (VRM Public License 1.0) |

## Character/VRM — 二次元角色（VRM 格式，网页用 @pixiv/three-vrm 加载）

| 文件 | 作者 | 授权 | 署名 |
|---|---|---|---|
| AvatarSample_D.vrm | pixiv（VRoid 官方样本） | VRoid Hub 授权：允许企业/个人商用、修改、再分发 | 不需要 |
| AvatarSample_D_Darkness.vrm | pixiv | CC0 | 不需要 |
| AvatarSample_E.vrm | pixiv | VRoid Hub 授权（同上） | 不需要 |
| AvatarSample_F.vrm | pixiv | VRoid Hub 授权（同上） | 不需要 |
| AvatarSample_G.vrm | pixiv | VRoid Hub 授权（同上） | 不需要 |
| Sakurada_Fumiriya.vrm | pixiv | VRoid Hub 授权（同上） | 不需要 |
| Sendagaya_Shino.vrm | pixiv | VRoid Hub 授权（同上） | 不需要 |
| Base_Female.vrm / Base_Male.vrm | pixiv | CC0 | 不需要 |
| HairSample_Female.vrm / HairSample_Male.vrm | pixiv | CC0 | 不需要 |
| Seed-san.vrm | VirtualCast, Inc. | VRM Public License 1.0：允许企业商用、修改再分发 | **需要** |
| VRM1_Constraint_Twist_Sample.vrm | pixiv | VRM Public License 1.0：允许企业商用、修改再分发 | 不需要 |

来源：VRoid 样本来自 https://opengameart.org/content/vroid-studio-cc0-models ；Seed-san 与 Twist Sample 来自 https://github.com/vrm-c/vrm-specification 。授权信息已从每个模型文件内的 meta 字段核对。

## Animation

| 文件 | 来源 | 授权 |
|---|---|---|
| Quaternius/UAL1_Standard.glb、UAL1_Standard_RM.glb | Universal Animation Library（Standard），作者 Quaternius，https://quaternius.itch.io/universal-animation-library | CC0，不需要署名 |
| ual_vrm.json | 由上面的动作包用 tools/bake.html 转换成 VRM 骨骼格式 | CC0（同原动作包） |
| Reload/*.json | 8 把枪的换弹动画，自己制作（tools/reloads.js），驱动 Infima 枪械模型的骨骼 | 和枪械模型一起使用 |
| VRMA/test.vrma | https://github.com/pixiv/three-vrm | MIT |

## Scene

| 文件 | 来源 | 授权 |
|---|---|---|
| LittlestTokyo.glb | three.js 示例（作者 glenatron） | CC BY 4.0，**需要署名** |
| collision-world.glb | https://github.com/mrdoob/three.js | MIT |

## Weapon/Guns（Infima Games 枪械包）

来源：你电脑上的 `Desktop\Blender\Gun\Guns`（Infima Games 的 Modern 系列枪械）。这是商业素材，按你获得它时的授权使用：可以作为游戏的一部分发布，但不要把模型或贴图单独分享、转售。

8 个 .glb 由 `tools/gunlab.html` 从原始 FBX 组装并保留骨骼（弹匣、拉机柄、枪栓、套筒、弹巢、泵动护木、炮尾可以动）（主体 + 护木、弹匣、瞄具等配件装到对应插槽），颜色贴图缩到 1024 像素。原点在握把，+Z 指向枪口，枪口位置记录在模型的 extras.muzzle 里。

| 文件 | 组成 |
|---|---|
| AssaultRifle.glb | 主体 + 默认护木 + 弹匣 + 后照门 |
| SMG.glb | 主体 + 默认护木 + 弹匣 + 前后照门 |
| LightMachineGun.glb | 主体 + 默认护木 + 弹鼓 + 后照门 |
| Sniper.glb | 主体 + 默认枪管 + 护木 + 弹匣 + 瞄准镜 |
| Pistol.glb | 主体 + 套筒 + 枪管 + 弹匣 + 前后照门 |
| Revolver.glb / Shotgun.glb | 官方合并版（Default_Combined）+ 换弹用的快速装弹器 / 霰弹 |
| RocketLauncher.glb | 主体 + 握把 + 圆形炮口 + 瞄准镜 |

## Audio（音效）

由 `tools/build_audio.py` 从下面几个音效包裁剪、去静音、归一化后生成，全部是单声道 ogg。

| 文件夹 | 来源 | 授权 |
|---|---|---|
| Weapon/*/shot.ogg、换弹分段、拉栓/泵动 | Snake's Authentic Gun Sounds（第一包和第二包），作者 Snake / F8 Studios，https://f8studios.itch.io/snakes-authentic-gun-sounds 、https://f8studios.itch.io/snakes-second-authentic-gun-sounds-pack | 作者声明可免费商用、不需要署名（欢迎署名） |
| Combat/hit_*、kill*、impact_wall_*、player_hurt、explosion 的撞击层 | Kenney Impact Sounds、Kenney Interface Sounds，https://kenney.nl | CC0 |
| Combat/explosion.ogg、Weapon/RocketLauncher/shot.ogg | 用上面的霰弹枪和狙击枪枪声降调、低通混合而成 | 同上 |
| Player/paper、unpaper | Kenney Interface Sounds（scratch） | CC0 |
| Player/jump、land、step，Enemy/throw | Kenney Starter Kit FPS | MIT |

每把枪用的口径：突击步枪 5.56，冲锋枪和手枪 9mm，轻机枪 7.62x39，狙击枪 7.62x54R，左轮 .308（升调），霰弹枪 20 号，火箭筒为合成音。

## Weapon / Prop（Kenney Starter Kit FPS）

来源：https://github.com/KenneyNL/Starter-Kit-FPS ，MIT 许可，© 2025 Kenney。

- Weapon：blaster.glb、blaster-repeater.glb
- Prop：cloud、enemy-flying、grass、grass-small、platform、platform-large-grass、wall-high、wall-low

注意：Weapon 和 Prop 的 .glb 引用了同目录下的 `Textures/colormap.png`，移动模型时要连这个文件夹一起移动。

### 枪械涂装：弦光 / Prism Link 材质包

- `Asset/Weapon/Guns/*.glb` 里的枪械贴图换成了用户自己的「弦光 / Prism Link」材质包（`_PrismLink_弦光项目材质`）：冷白色护壳、黑灰机械件、薄荷青识别带。
- 游戏里只用了 BaseColor（缩到 1024）和 Emissive（发光条，缩到 512）；法线、ORM 在卡通渲染下用不上，没有打包进模型。
- 重新生成：把 BaseColor / Emissive 转成 `T_<枪>_<序号>_D.jpg` / `_E.jpg` 放进 `tools/../_tex`，再跑 `tools/gunlab.html`。

## Scene/City — 城市场景素材（「雨夜街区」地图用）

全部 CC0：可商用、可修改，不需要署名。每个文件夹里有原始的 License.txt 和 Preview.png。

| 文件夹 | 素材包 | 作者 | 来源 |
|---|---|---|---|
| `Scene/City/KayKit/` | City Builder Bits 1.0（glTF：楼、车、红绿灯、长椅、垃圾箱、消防栓等） | Kay Lousberg | https://kaylousberg.itch.io/city-builder-bits （GitHub：KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0） |
| `Scene/City/Commercial/` | City Kit (Commercial) 2.1（GLB：商业楼、高楼，做远景） | Kenney | https://kenney.nl/assets/city-kit-commercial |
| `Scene/City/Roads/` | City Kit (Roads) 2.2（GLB：施工路障、路锥、施工灯等） | Kenney | https://kenney.nl/assets/city-kit-roads |
| `Scene/City/Suburban/` | City Kit (Suburban) 2.0（GLB：树、围栏、花坛） | Kenney | https://kenney.nl/assets/city-kit-suburban |

日式细节（便利店、自动贩卖机、灯笼、电线杆和电线、竖排灯箱、交番、歩道橋、路面「止まれ」等标字、车站招牌）都在 `src/street.js` 里用代码现场生成，不依赖外部文件。`UI/Lobby/map_street.jpg` 是游戏内截图。
