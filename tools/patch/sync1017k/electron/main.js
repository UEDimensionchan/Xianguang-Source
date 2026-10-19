// 弦光 PC 版启动器：用独立显卡跑游戏，游戏文件放在同目录的 game 文件夹里
const { app, BrowserWindow, protocol, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// —— 显卡：强制用高性能（独立）显卡，忽略显卡黑名单 ——
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
// 启动动画可以直接带声音播放
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 只允许开一个
if (!app.requestSingleInstanceLock()) app.quit();

// 游戏文件通过 app:// 读取（地址固定，设置和存档不会丢）
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

const ROOT = path.join(__dirname, 'game');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.vrm': 'application/octet-stream',
  '.fbx': 'application/octet-stream', '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.md': 'text/plain; charset=utf-8',
};

function serve(req) {
  const u = new URL(req.url);
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return new Response('forbidden', { status: 403 });
  let stat;
  try { stat = fs.statSync(file); } catch (e) { return new Response('not found', { status: 404 }); }
  if (stat.isDirectory()) return new Response('not found', { status: 404 });
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.get('range');
  // 视频要支持分段读取（拖动 / 跳到片尾）
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || ['', '0', ''];
    let start, end;
    if (m[1] === '') { start = Math.max(0, stat.size - (+m[2] || 0)); end = stat.size - 1; } // bytes=-500：最后 500 字节
    else { start = +m[1]; end = m[2] ? Math.min(+m[2], stat.size - 1) : stat.size - 1; }
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    const buf = Buffer.alloc(end - start + 1);
    const fd = fs.openSync(file, 'r'); fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd);
    return new Response(buf, { status: 206, headers: { 'Content-Type': type, 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes' } });
  }
  return new Response(fs.readFileSync(file), { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' } });
}

let win = null;
function createWindow() {
  const icon = path.join(__dirname, 'icon.png');
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 600,
    title: '弦光', backgroundColor: '#0b0f14', show: false, autoHideMenuBar: true,
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('enter-full-screen', () => win.webContents.send('fs-changed', true));
  win.on('leave-full-screen', () => win.webContents.send('fs-changed', false));
  // 网页里的外部链接用系统浏览器打开，不在游戏窗口里跳走
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) require('electron').shell.openExternal(url); return { action: 'deny' }; });
  // 开发者工具：Ctrl+Shift+I
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.code === 'KeyI') win.webContents.toggleDevTools();
  });
  win.loadURL('app://game/index.html');
}

ipcMain.on('fs-set', (e, on) => win?.setFullScreen(!!on));
ipcMain.on('fs-get', (e) => { e.returnValue = !!win?.isFullScreen(); });
ipcMain.on('gpu-info', async (e) => { try { e.returnValue = await app.getGPUInfo('basic'); } catch (err) { e.returnValue = null; } });

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  protocol.handle('app', serve);
  createWindow();
  startServer();
});

// —— 联机服务器：PC 版启动时在本机后台开一个（端口 8787），这台电脑就能当房主；
//    同一局域网的朋友在「组队联机」里填这台电脑的地址（ws://局域网IP:8787）就能搜到房间。
//    端口被占用（比如已经开着一个游戏）就跳过。
let lanServer = null;
async function startServer() {
  try {
    const { createServer } = require('./server.bundle.js');
    lanServer = await createServer({ port: 8787, log: (...a) => console.log('[server]', ...a) });
  } catch (e) { console.warn('联机服务器没有启动：', e.message); }
}
function lanIPs() {
  const out = [];
  for (const list of Object.values(require('os').networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}
ipcMain.on('lan-info', (e) => { e.returnValue = { ips: lanIPs(), port: 8787, server: !!lanServer }; });
app.on('window-all-closed', () => { lanServer?.close(); app.quit(); });
