# AGENTS.md — 给 AI 编程助手的项目说明

这份文件写给参与开发的 AI 助手（Claude Code、Codex、Cursor 等）和新加入的开发者：项目怎么跑、代码在哪、改动有什么约定、怎么自测。玩家向的介绍见 [README.md](README.md)。

## 1. 一句话概览

浏览器里运行的 Three.js 射击游戏。原生 ES Module，**没有构建步骤**：改完 `src/*.js` 后刷新页面就生效。角色是 VRM（`@pixiv/three-vrm`），枪是 glb，联机服务器在 `server/`（Node.js + ws）。

## 2. 运行

```bash
# 静态服务器（任选其一），在项目根目录运行
npx --yes http-server . -p 5173 -c-1 -s
python -m http.server 5173
# 联机服务器（测试联机时才需要）
npm --prefix server install --omit=dev && node server/server.js 8787
```

打开 `http://localhost:5173/index.html`。不能用 `file://` 打开。

### 网址参数（测试很有用）

| 参数 | 作用 |
|---|---|
| `?nointro` | 跳过启动动画和海报加载页，直接进大厅（资源在后台预加载） |
| `?noboot` | 只跳过海报加载页 |
| `?test` | 测试模式：跳过启动动画，不建大厅 3D 展示台，配合 `map=` 使用 |
| `?map=skyterrace` / `range` / `core` / `street` | 指定地图（配合 `test`） |
| `?char=kikyo` | 指定出战角色 id（见 `src/config.js`） |

### 调试用的全局对象

- `window.__game`：`{ game, input, stats, start, step, menu, renderer, perf, select }`。`__game.start()` 直接开局。`__game.game.player` 是玩家，`__game.game.match.bots` 是 AI 和联机替身。
- `window.__net`：联机连接。
- `window.__ns` / `window.__hs`：引航者页 / 大厅主页的 3D 展示台（`NavStage`），`fxT` 是出场动画已播放的秒数，`replay()` 重播。
- `window.__freeze = true` 冻结主循环，之后可以用 `__game.step(dt)` 手动步进，便于截图。

## 3. 代码地图（`src/`）

| 文件 | 负责 |
|---|---|
| `main.js` | 入口：渲染器、后期、输入、主循环、开局流程（`start()`）、启动海报与预加载、联机接入、Alt 自由视角输入 |
| `config.js` | `CHARACTERS`（角色列表）、`ASSETS`（资源路径）、`TUNING`（移动、技能数值） |
| `lobby.js` | 大厅全部页面：主页、引航者（`NAVIGATORS`，外观 / 技能 / 档案）、武器与配件、商城、选择模式（含 AI 难度） |
| `player.js` | 玩家：移动物理、技能、镜头（越肩 / 第一人称 / 开镜 / Alt 环绕）、持枪 IK（`_holdGun`）、身高统一（`heightScale`） |
| `bots.js` | `Bot`（AI 寻路、交战，难度 `AI_LEVELS`）、`Puppet`（联机替身）、`Squads`（两队比赛管理） |
| `mp.js` | 局内同步：状态快照、AI 名单、配件、开火、伤害、击杀、比分、天气 |
| `net.js` / `party.js` | WebSocket 封装 / 组队界面（建房、搜房、加入） |
| `weapons.js` | 8 把枪的数值（`WEAPONS`）和模型加载（`Arsenal`：`load` 给玩家用，`instance` 复制给 AI 和替身） |
| `attachments.js` | 配件定义、数值修正、挂载到枪上 |
| `anim.js` | `CharacterAnimator`：用烘焙好的通用动作驱动 VRM（跑跳、瞄准、换弹、翻滚、倒地） |
| `ik.js` | 手臂两骨骼 IK、手指弯曲 |
| `viewmodel.js` | 第一人称手臂和枪（单独场景、单独相机，叠加在最上层） |
| `navstage.js` | 大厅和引航者页的 3D 展示台：出场动画、传送特效、待机循环 |
| `lobbystage.js` | 旧的大厅抱枪展示（目前关闭，`LOBBY_3D = false`） |
| `preload.js` | 启动时预加载所有角色和枪：`preloadAll` / `whenLoaded` / `preloadedJSON` |
| `intro.js` | 启动动画（播完自动淡出到海报） |
| `springs.js` | 调整 VRM 头发 / 裙子的摆动骨骼，并给裙子加腿部碰撞 |
| `outline.js` | 角色描边（反向外壳法，脸部不描边） |
| `charlight.js` | MToon 材质跟随昼夜光照 |
| `maps.js` / `street.js` / `env.js` / `wet.js` | 地图构建 / 雨夜街区 / 昼夜与天气 / 积水倒影 |
| `nav.js` | AI 寻路用的高度图网格 |
| `hud.js` / `hudart.js` | 局内 HUD、比分栏头像 |
| `fx.js` / `audio.js` / `uisound.js` | 特效 / 音效 / 界面音效 |
| `pet.js` | 右下角桌宠（每个角色的台词和动作在 `PROFILES` 里） |
| `emote.js` / `lockon.js` / `dummies.js` / `menu.js` / `settings.js` / `style.js` / `optimize.js` | 表情轮盘 / 锁定提示 / 训练场靶子 / Esc 菜单与设置界面 / 设置存储与键位 / 手绘风后期 / 静态合批与远处剔除 |

## 4. 重要约定（改代码前必读）

1. **不加构建工具**：保持原生 ES Module + `index.html` 里的 importmap（`three`、`three/addons/`、`@pixiv/three-vrm` 指向 `vendor/`）。不要引入打包器或 npm 前端依赖。
2. **注释和界面文字用中文**：代码注释写"为什么这样做"，风格和现有代码保持一致。
3. **单骨架 MMD 模型不要合并骨骼**：只有 `gltf.parser.json.skins.length > 1` 时才调用 `VRMUtils.combineSkeletons`。对 MMD 转来的单骨架模型合并后，裙子会被扯成尖刺。新增加载 VRM 的地方要照抄这个判断（`main.js`、`bots.js`、`pet.js`、`lobbystage.js`、`navstage.js` 都有）。
4. **VRM0 和 VRM1**：`VRMUtils.rotateVRM0(vrm)` 之后，VRM0 模型的四元数 x、z 分量和位置的 x、z 分量要取反（见 `anim.js`、`navstage.js` 里的 `isVRM0` 处理）。
5. **角色缩放放在 `pivot` 上**：`vrm.scene.scale` 被纸化动画占用（压扁 x 轴），身高统一用 `pivot.scale`（`player.js` 的 `heightScale`）。
6. **复制枪要还原图层**：第一人称会把玩家自己的枪换到隐藏图层（`viewmodel.js` 的 `HIDDEN_LAYER`）。`Arsenal.instance()` 复制枪时必须还原 `layers.mask`，否则别人手里的同款枪会看不见。
7. **加载资源先查预加载**：读模型 / JSON 前先用 `whenLoaded(url)` 或 `preloadedJSON(url)`（`preload.js`），不要重复下载。新加的大文件记得放进 `main.js` 里的预加载列表。
8. **联机消息**：改 `game.state` / `game.bots` 的字段时，`mp.js` 的发送端和 `bots.js` 的 `Puppet.setState` 必须同时改。动作事件（换弹 / 突进 / 受击）打包在 `evPack` 计数器里，计数变化就播放一次。
9. **设置项**：新的设置加到 `settings.js` 的 `DEFAULTS`，用 `setSetting(k, v)` 保存（存在 localStorage）。
10. **桌面版资源命名**：本仓库里的资源是 `.vrm` / `.glb` 原名。另有一个在线版本会把资源改名为 `.vrm.wasm` 之类，代码里少数正则（例如 `\.glb(\.wasm)?$`）是为了兼容两种命名，不要删掉。

## 5. 自测方法

没有单元测试，靠浏览器自动化截图和读取状态来验证。推荐 Playwright + 无 GPU 渲染：

```python
b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
pg = await b.new_page(viewport={'width': 1280, 'height': 720})
await pg.goto('http://localhost:5173/index.html?nointro')
await pg.wait_for_selector('.lb-mode', state='visible', timeout=200000)
await pg.evaluate("window.__game.start()")           # 直接进训练场
await pg.wait_for_function("window.__game.game.player && window.__game.game.player.vrm", timeout=300000)
await pg.screenshot(path='out.png')
```

经验：

- 软件渲染很慢（几帧每秒）。等动画时用游戏里的计时（比如 `__ns.fxT`）判断进度，不要按真实秒数等。
- 页面上的按钮用 `evaluate("document.querySelector(...).click()")` 点，比 `page.click` 稳定（游戏在跑时元素会一直判定为"不稳定"）。
- **联机测试**：
  - 启动 `server/server.js` 后，开两个页面：A 走「选择模式 → 竞技 → 组队联机 → 开始 → 创建房间」，B 走「寻找房间 → 加入」。
  - 然后读 `__game.game.match.bots.filter(b => b.kind === 'player')` 检查替身的状态（位置、`wi`、`gun.visible`、`gun.layers.mask` 等）。
  - 测第一人称相关的问题时，先设 `localStorage.paper_fp = '1'`。
- 改动角色渲染、动作、特效时，一定要截图确认，不要只看代码。

## 6. 角色管线（`tools/vrm/`，需要 Blender 5.x + MMD Tools）

PMX → VRM 的流程：

1. `pmx2vrm_blender.py`（在 Blender 里运行）：
   - 导入 PMX，骨骼改成 VRM 人形骨骼名，保留 D 系腿骨、删掉 IK 骨。
   - 摆成 T 姿势并重新烘焙形态键。
   - 材质转成 Principled（贴图透明部分用 MASK，真半透明才用 BLEND），可选缩小胸部（`_shrink_breast`）。
   - 最后导出 glb。
2. `glb2vrm.py`：把 glb 转成 VRM 1.0（表情映射、摆动骨骼、碰撞体、MToon）。
   - 配置在 `cfg/`：`splitHubs` 让分叉根骨骼不摆动，`alongChild` 让腿部碰撞体沿子骨骼放置。
   - 裙子骨骼（MMD 里常见的 `Sk…`、`スカート`）要能被摆动骨骼的正则匹配到。

转好的模型放在 `Asset/Character/VRM/MMD/`。

## 7. 展示动画（`tools/anim/`）

- `anim_lib.py`：Blender 里的工具库。
  - 姿势写在 VRM 归一化空间（X 扭转 / 前倾，Z 抬放，Y 前后摆，`~` 前缀表示左右对称）。
  - 先打到 MMD 骨架上做关键帧，再导出成游戏用的 JSON。
- `anim_defs.py`：每个角色（按 `persona`）的 `enter`（出场）和 `idle`（待机循环）关键帧。
- **改动流程**：
  1. 在 Blender 里打开一个转好的角色 glb，`exec` 运行 `anim_lib.py`，再运行 `anim_defs.py`。
  2. 对每段动画调用 `apply_clip` + `bake`，导出 JSON。
  3. 去掉不动的轨道、压缩后，保存为 `Asset/Animation/nav_show.json`。

## 8. 打包（Windows）

- 见 `docs/windows-packaging.md`。
- 启动器源码在 `tools/electron/`（`main.js` 用 `app://` 协议提供 `game/` 目录，并在启动时开本机联机服务器）。
- 更新已打包的版本：把根目录的网页、`src`、`vendor`、`Asset` 复制到 `resources/app/game/`（`tools/electron/update.bat`）。

## 9. 不要做的事

- 不要提交 `node_modules/`、`tools/patch/`（同步用的临时文件）、Blender 的 `.blend1` 备份。
- 不要把第三方模型 / 枪械单独公开分发（见 `Asset/LICENSES.md`）。
- 不要一次性大改架构。这是一个能玩的原型，优先做小而可验证的改动，每次改完都截图或读状态确认。
