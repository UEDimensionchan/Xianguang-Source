# 弦光 Windows 打包指南

基于当前仓库的 `tools/electron/main.js`、`preload.js` 和 `server/server.js` 编写。目标是制作 Windows x64 桌面客户端和安装包，继续使用现有 Three.js 游戏及房间联机功能。

本文是实施指南，下面的配置和脚本需要按步骤创建；仓库本次仅更新文档，尚未执行 Electron 下载、构建安装包或双机验收。

## 一、当前项目已经具备什么

| 部分 | 当前实现 | 打包时要做的事 |
|---|---|---|
| 窗口入口 | `tools/electron/main.js` | 作为 Electron 的主入口保留 |
| 本地网页加载 | `app://game/index.html`，资源根为 `__dirname/game` | 将网页、CSS、src、vendor、Asset 放到启动器的 game 目录 |
| 系统能力桥接 | `preload.js` 暴露 `window.native` | 将 preload 与 main 一起打包 |
| 联机服务器 | 主进程调用 `require('./server.bundle.js').createServer()` | 从 `server/server.js` 生成对应文件并包含 ws |
| 本机开房 | 启动时监听 8787；端口占用时复用现有服务 | 验证服务启动和 Windows 防火墙 |
| 多窗口测试 | 启动器给后续实例分配独立 userData 目录 | 多实例连接同一个 localhost 服务测试 |
| 打包配置 | 当前 package.json 只有名称、版本和入口 | 补充脚本与 electron-builder 配置 |

关键点：只复制 Electron 的 main.js，或者只把 index.html 打进 EXE，都无法得到可用的完整联机客户端。游戏资源和服务器 bundle 必须一起进入安装包。

## 二、打包方式

采用 **现有 Electron 启动器 + esbuild 打包联机模块 + electron-builder 26 的 NSIS 安装包**，保留当前资源路径，第一版无需重写游戏代码。

构建顺序：

```text
PaperGame 网页与素材 ──────────> tools/electron/game/
server/server.js + ws ────────> tools/electron/server.bundle.js
main.js + preload.js + 上述产物 ─> Electron Windows 目录
                             └─> NSIS 安装包
```

Electron 随客户端带上运行时，玩家安装后直接运行游戏，不需要再安装 Node.js 或 Python。开发机仍需安装 Node.js 与 npm。

## 三、准备开发环境和依赖

在 Windows 上安装 Electron 当前支持的 Node.js LTS，确认：

```powershell
node --version
npm --version
```

在 PowerShell 中进入项目根目录：

```powershell
Set-Location 'C:\Users\hp\Desktop\PaperGame'
npm --prefix .\server install --omit=dev
```

先安装 server 的依赖，是因为 esbuild 从 `server/server.js` 出发解析 `require('ws')`，需要能在 server 目录找到它。

下一步先按第四节补充桌面 package.json，再在项目根目录运行：

```powershell
npm --prefix .\tools\electron install --save-dev --save-exact electron electron-builder@26 esbuild
```

这里固定 electron-builder 的 26 大版本以匹配本文配置写法；Electron 与 esbuild 的具体版本由首次安装确定，`--save-exact` 和生成的 package-lock.json 记录实际版本。以后重建使用 `npm ci`，并在升级 Electron 时重新做启动与联机验收。

首次安装 / 打包需要联网下载 npm 包、Electron 和 Windows 打包工具。

## 四、补充桌面 package.json

编辑 `tools/electron/package.json`，先使用下面的基础内容，再执行上一节的桌面依赖安装命令。若已经安装过依赖，合并这些字段，保留已有 devDependencies，避免覆盖版本记录。

```json
{
  "name": "prism-link",
  "productName": "弦光",
  "version": "0.3.0",
  "private": true,
  "description": "弦光：支持房间联机的纸片人射击游戏",
  "author": "UEDimensionchan",
  "main": "main.js",
  "scripts": {
    "prepare:game": "node prepare.cjs",
    "start": "npm run prepare:game && electron .",
    "pack:win": "npm run prepare:game && electron-builder --win --x64 --dir",
    "dist:win": "npm run prepare:game && electron-builder --win nsis --x64 --publish never"
  },
  "build": {
    "appId": "com.uedimensionchan.xianguang",
    "productName": "弦光",
    "asar": true,
    "directories": {
      "output": "../../dist/windows"
    },
    "files": [
      "main.js",
      "preload.js",
      "icon.png",
      "server.bundle.js",
      "game/**/*",
      "package.json"
    ],
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ],
      "artifactName": "Xianguang-Setup-${version}-${arch}.${ext}"
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "弦光"
    }
  }
}
```

这份配置让游戏与入口都位于 app.asar 内，保持现有 `path.join(__dirname, 'game')` 有效，Electron 的 fs 支持读取 ASAR 中的文件。ASAR 是归档格式，不代表源码加密。

现有 `icon.png` 可以继续用于窗口图标。安装程序 / EXE 图标如需自定义，另外准备 Windows `.ico`（包含 256×256 等尺寸），放在桌面工程内，并设置 `build.win.icon`；没有 ICO 时，先接受默认可执行文件图标。

后续保持 appId、应用名称和资源 origin 稳定，并按版本递增 version。当前设置保存在用户数据目录中的网页存储里，随意变更应用身份或从 `app://game` 换到其他 origin，可能导致旧设置读不到。

## 五、增加资源整理和服务器打包脚本

创建 `tools/electron/prepare.cjs`：

```javascript
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const desktop = __dirname;
const project = path.resolve(desktop, '../..');
const game = path.join(desktop, 'game');
const bundle = path.join(desktop, 'server.bundle.js');

async function main() {
  for (const name of ['index.html', 'src', 'vendor', 'Asset', 'server/server.js']) {
    if (!fs.existsSync(path.join(project, name))) {
      throw new Error('缺少项目文件：' + name);
    }
  }

  // 先完成 bundle，解析失败时直接停止，不产生可发布的半成品。
  await esbuild.build({
    entryPoints: [path.join(project, 'server/server.js')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['bufferutil', 'utf-8-validate'],
    logLevel: 'info'
  });

  // 只重建启动器自身的生成目录，不清理原始游戏素材。
  if (path.resolve(game) !== path.resolve(project, 'tools/electron/game')) {
    throw new Error('生成目录校验失败');
  }
  fs.rmSync(game, { recursive: true, force: true });
  fs.mkdirSync(game, { recursive: true });

  for (const name of ['src', 'vendor', 'Asset']) {
    fs.cpSync(path.join(project, name), path.join(game, name), {
      recursive: true
    });
  }
  for (const entry of fs.readdirSync(project, { withFileTypes: true })) {
    if (entry.isFile() && /\.(html|css)$/i.test(entry.name)) {
      fs.copyFileSync(
        path.join(project, entry.name),
        path.join(game, entry.name)
      );
    }
  }
  fs.copyFileSync(
    path.join(project, 'README.md'),
    path.join(game, 'README.md')
  );
  console.log('游戏资源与联机服务器已准备完成：' + desktop);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

脚本会把整个 Asset 原样复制，以优先保证资源完整。不要第一轮就删掉「看起来没有使用」的模型或贴图；先通过打包后的实际加载检查，再逐项精简作者工程、转换产物和未使用素材。重新整理前应退出正在运行的开发版窗口。

`ws` 使用的 bufferutil / utf-8-validate 是可选扩展；上面的配置将它们保留为外部可选模块，首版不额外带入原生扩展，避免额外的原生模块打包步骤。核心 ws JavaScript 实现会进入 bundle。

当前服务器在 `require.main === module` 时才直接启动。被 Electron require 后保留 `createServer` 导出，由现有主进程调用，不需要再额外启动 node.exe。

## 六、先调试，再生成安装包

以下命令均在项目根目录执行。

### 1. 启动桌面开发版

```powershell
npm --prefix .\tools\electron run start
```

启动前确认没有另一个服务占用 8787，或者明确知道正在复用哪个服务。窗口加载后用 Ctrl+Shift+I 查看控制台，重点检查资源 404、preload 和服务器错误。

### 2. 生成可直接运行的 Windows 目录

```powershell
npm --prefix .\tools\electron run pack:win
```

预期输出：

```text
dist/windows/win-unpacked/弦光.exe
dist/windows/win-unpacked/resources/app.asar
dist/windows/win-unpacked/其他 Electron 运行文件
```

先从这个目录运行游戏。分享目录版时需要压缩整个 `win-unpacked`，不能只发送里面的 EXE。

### 3. 生成 NSIS 安装包

```powershell
npm --prefix .\tools\electron run dist:win
```

预期输出在 `dist/windows/`，安装包名称类似：

```text
Xianguang-Setup-0.3.0-x64.exe
```

测试安装包可以先不配置发布证书；正式面向玩家分发时再按 Electron 官方签名流程配置代码签名。未签名安装包可能触发 Windows 的来源提示。

### 4. 后续重建

将修改后的桌面 package.json、prepare.cjs、server/package-lock.json 和 tools/electron/package-lock.json 纳入 Git。再次获取源码后：

```powershell
npm --prefix .\server ci --omit=dev
npm --prefix .\tools\electron ci
npm --prefix .\tools\electron run dist:win
```

在根目录的 .gitignore 中补充以下生成文件规则：

```gitignore
/tools/electron/game/
/tools/electron/server.bundle.js
```

根目录已有 node_modules/ 和 dist/ 忽略规则。生成目录、node_modules 和安装包不放进源码提交。

## 七、打包后的联机验收

| 场景 | 操作 | 需要确认 |
|---|---|---|
| 单机启动 | 运行打包目录中的 EXE | 大厅、模型、贴图、声音、地图完整 |
| 本机服务 | 访问 http://localhost:8787/ | 返回在线人数 / 房间数 JSON |
| 本机双开 | 打开两个客户端，连接 ws://localhost:8787 | 搜到同一房间、独立昵称 / 设置、能加入和开局 |
| 局域网双机 | B 连接 ws://A的IPv4地址:8787 | 搜索、加入、开火、击杀、比分 / 时间同步 |
| AI 补位 | 少于满员时由房主开始 | AI 仅在房主运行，其他客户端能看到其状态 |
| 安装版 | 在另一台无 Node.js / Python 的电脑安装 | 可直接运行，能创建和加入房间 |
| 退出重开 | 关闭服务所属主实例，再重新启动 | 本机服务重新启动，端口不被残留进程占用 |
| 本地设置 | 修改设置后关闭，再正常重开同一应用 | 设置保持，资源地址仍为 app://game |
| 完整更新 | 修改源码后重新构建 | 新的网页代码和 server.bundle.js 都进入新包 |

服务所属主实例退出后，本机托管的所有房间会失去服务器连接；后续多开实例没有自动接管本机服务的逻辑。验收时要把「多窗口联机测试」与「服务器长期托管」分开考虑。

Windows 防火墙允许游戏在专用网络接受 TCP 8787 连接即可进行局域网测试。先用浏览器访问 `http://房主IP:8787/` 判断基本连通，再排查游戏协议。

## 八、客户端安装包与公网联机的关系

打包解决「把游戏变成可安装 Windows 程序」，公网联机解决「不同网络的玩家连接同一台可达服务器」。完成安装包不会自动提供公共服务器或穿透家庭路由器。

当前 `server/server.js` 可以在单独的服务器机器上安装 ws 后启动。所有玩家在「组队联机」填写该机器地址，才能看到相同的房间。使用 HTTPS 网页接入时需提供匹配的 WSS 接入端点；当前服务本身提供的是 HTTP / WS，TLS 可以由反向代理终止。

界面当前的地址补全逻辑还会给不带显式端口的地址加上 `:8787`，因此如配置标准 TLS 端口，应明确填写 `wss://你的域名:443`，并让反向代理正确转发 WebSocket Upgrade。

当前战斗仍由客户端与房主承担，独立部署转发服务器不会自动变成权威战斗服务。原型测试可以保留现有方案；完整的公网竞技版本还需按实际需求补充认证、消息校验与断线恢复。

## 九、现有 update.bat 的适用范围

`tools/electron/update.bat` 是旧版「桌面相邻目录 + resources/app/game」布局的手动同步脚本。其源路径按脚本位于成品根目录推算，不适合直接在当前 tools/electron 源码目录运行。

本文采用 app.asar 布局，不使用该脚本更新安装版，也不向安装目录直接覆盖源码。游戏或联机代码修改后重新生成 bundle 与安装包。自动更新属于后续工作，当前项目尚未接入自动更新服务。

## 十、常见问题

| 现象 | 优先检查 |
|---|---|
| 窗口空白 / 资源 404 | game/index.html、src、vendor、Asset 和根目录 CSS 是否完整，大小写及相对路径是否一致 |
| 提示找不到 server.bundle.js | 是否运行 prepare:game，build.files 是否包含该 bundle |
| esbuild 找不到 ws | 是否在 server 目录安装依赖；只在 tools/electron 安装不能替代 server 的依赖解析 |
| 能进入大厅，但 localhost 连接失败 | 8787 服务是否启动、bundle 导出是否正确、主进程控制台是否报错 |
| 本机能联机，好友搜不到房间 | 是否填房主 IP、是否连接同一服务器、防火墙、Wi-Fi 客户端隔离 |
| 好友看到自己的空列表 | 好友可能连接了自己的 localhost 服务 |
| 修改服务器代码却仍是旧行为 | 是否重建 server.bundle.js，并退出占用 8787 的旧客户端 |
| 修改后安装版没有变化 | 是否重建 game 目录和安装包，而非只修改原项目 |
| 打包失败但游戏源码无报错 | 检查 Electron / NSIS 工具下载、磁盘空间及打包日志，不要先修改战斗代码 |

## 官方参考

- [Electron 应用分发](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)
- [Electron ASAR 支持](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [electron-builder 26 Windows 配置](https://www.electron.build/v26/docs/win/)
- [electron-builder NSIS](https://www.electron.build/nsis/)
- [esbuild 打包 API](https://esbuild.github.io/api/#bundle)

本文的路径与联机行为来自当前仓库代码检查；真正的 Windows 启动、安装和双机结果，以执行第七节验收为准。
