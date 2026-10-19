// 给网页用的几个本机功能：全屏
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('native', {
  pc: true,
  setFullscreen: (on) => ipcRenderer.send('fs-set', !!on),
  isFullscreen: () => ipcRenderer.sendSync('fs-get'),
  onFullscreen: (fn) => ipcRenderer.on('fs-changed', (e, on) => fn(on)),
  lanInfo: () => ipcRenderer.sendSync('lan-info'),
});
