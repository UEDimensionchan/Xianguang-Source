@echo off
chcp 65001 >nul
rem 单独运行联机服务器（需要安装 Node.js）。PC 版游戏启动时会自动在本机开一个，不用这个也行。
cd /d "%~dp0"
if not exist node_modules\ws ( echo 首次运行，正在安装依赖… & call npm install --omit=dev )
node server.js 8787
pause
