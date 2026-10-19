# 弦光 · 纸片枪战

基于 Three.js 与 VRM 角色的第一 / 第三人称射击游戏原型，已实现单机训练、AI 对战和 WebSocket 房间联机，并提供 Electron 桌面启动器源码。

## 当前功能

- 大厅、角色选择、武器与配件、画面设置。
- 第一 / 第三人称切换、纸化、纸鹤突进、墨水炸弹和多种枪械。
- 「棱镜中枢」「雨夜街区」团队竞技地图，以及其他训练 / 对战地图。
- 创建房间、搜索房间、加入房间；人数上限可设为 2、4、6、8。
- 房主按 Enter 开始比赛，空位由 AI 补充。
- 同步真人位置与动作、武器配件、开火与投射物、伤害与击杀、比分、时间及天气。
- Electron 桌面启动器：独立窗口、全屏、本地资源协议、本机联机服务器和多窗口测试。

这里的「联机」已经接入游戏流程。浏览器版需要单独启动联机服务器；桌面版在正确打包服务器模块后，会自动启动本机服务器。

## 浏览器运行

开发电脑安装 Node.js，或使用已安装的 Python 提供静态文件服务。

双击根目录的 `start.bat`，打开：

```text
http://localhost:5173/index.html
```

它只负责提供网页和游戏素材，不会自动启动 8787 端口的联机服务器。首次使用 Node.js 启动方式时，`npx http-server` 可能需要下载依赖。不要直接通过 `file://` 打开 `index.html`。

## 联机运行

### 1. 启动联机服务器

网页版：双击 `server/启动联机服务器.bat`，或在项目根目录运行：

```powershell
npm --prefix .\server install --omit=dev
node .\server\server.js 8787
```

以上命令是一个持续运行的服务，游戏期间保持窗口开启。已按打包指南制作的 PC 版会自动启动本机服务器，无需重复执行。

### 2. 创建与加入房间

1. 房主进入「组队联机」，连接 `ws://localhost:8787`。
2. 选择地图、房间名和人数上限，创建房间后进入地图等待。
3. 同一台电脑多窗口测试时，其他窗口也连接 `ws://localhost:8787`。
4. 局域网好友连接房主的地址，例如 `ws://192.168.1.20:8787`，再搜索并加入房间。示例 IP 要替换成房主实际 IPv4 地址。
5. 玩家进入后，由房主按 Enter 开始。

房间列表来自玩家当前连接的那一台服务器；连接不同服务器的玩家看不到彼此的房间。好友电脑上的 `localhost` 指向好友自己，必须换成房主 IP。房主的 Windows 防火墙需要允许游戏在专用网络上接受 TCP 8787 连接。

检查服务器是否启动，可在浏览器访问 `http://localhost:8787/`，它会返回包含在线人数与房间数的 JSON。这个地址是状态接口，不是游戏页面。

当前可以部署独立服务器供多个客户端连接；跨公网访问还需要可达的服务器地址、对应端口或反向代理配置。项目尚未提供自动 NAT 穿透或内置公共匹配服务。

## Windows 软件打包

详细步骤见 **[Windows 打包指南](docs/windows-packaging.md)**。

现有入口在 `tools/electron/`。需要准备游戏资源目录、生成 `server.bundle.js`，再由 Electron 与 electron-builder 生成 Windows 程序 / NSIS 安装包。安装后的玩家不需要另装 Node.js 或 Python。

> 仓库目前提供桌面启动器源码；Windows 打包指南包含待应用的脚本与配置示例。本次文档更新没有生成或验证 EXE 安装包。

## 默认操作

| 按键 | 作用 |
|---|---|
| WASD | 移动 |
| 空格 | 跳跃 |
| 鼠标左键 | 射击 |
| R | 换弹 |
| 鼠标右键（按住） | 瞄准 |
| C / 左 Ctrl（按住） | 纸化 |
| E | 纸鹤突进 |
| Q | 墨水炸弹 |
| 1–8 / 滚轮 | 切换武器 |
| V | 切换第一 / 第三人称 |
| Enter | 房主在房间等待阶段开始比赛 |
| Esc | 暂停 / 菜单 |

## 代码结构

```text
index.html              页面、大厅与 HUD 入口
*.css                   大厅、菜单、HUD 与游戏界面样式
src/main.js             初始化、地图加载、输入、主循环和联机对局接入
src/config.js           角色、素材路径与基础配置
src/player.js           玩家移动、纸化、技能、镜头与持枪表现
src/maps.js / street.js  地图与场景构建
src/bots.js              AI、比赛逻辑与远程角色替身
src/party.js             组队界面、服务器连接、房间创建与搜索加入
src/net.js               WebSocket 连接、请求响应与消息订阅
src/mp.js                局内同步、房主 AI、伤害、比分与环境同步
src/settings.js          玩家设置和联机地址，本地 localStorage 保存
src/weapons.js           武器配置、枪械加载
src/attachments.js       枪械配件
src/anim.js / ik.js      动画与持枪 IK
src/viewmodel.js         第一人称手臂与枪械显示
src/fx.js / audio.js     特效与音效
server/server.js         HTTP 状态接口、WebSocket 房间服务与消息转发
server/package.json      联机服务依赖 ws
tools/electron/          Electron 主进程、preload、图标和旧同步脚本
tools/                  动画、模型、音效等制作工具
vendor/                 本地 Three.js、three-vrm 等依赖
Asset/                  模型、贴图、场景、UI、音效与授权记录
docs/windows-packaging.md Windows 打包与联机验收指南
```

## 添加角色

把 `.vrm` 文件放进 `Asset/Character/VRM/`，再到 `src/config.js` 的 `CHARACTERS` 中配置角色。头像和 UI 素材按现有角色配置一起补充。

## 当前联机架构与边界

- 服务器负责连接、房间、分队及同房间消息转发；它不是独立运行完整游戏模拟的权威战斗服务器。
- 每个客户端计算自己的移动和状态；命中先在攻击端判断，再通过消息通知受击方。房主运行 AI，并广播比赛状态。
- 房主离开时服务器会更新房间的 `hostId`，但当前局内的 `Multiplayer.isHost` 在创建实例时固定；完整的进行中对局主机迁移仍需完善。
- 房间与在线玩家状态保存在服务器内存中，服务重启后需要重新建房。
- 当前功能适合原型和联机测试；正式竞技版本还需要补充服务端校验、身份认证及断线恢复。

## 素材与授权

来源与使用要求见 [Asset/LICENSES.md](Asset/LICENSES.md)，第三方库的 LICENSE 随仓库保留。打包时同时保留这些授权记录。
