@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地服务器，浏览器会自动打开 http://localhost:5173
echo 关闭这个窗口就会停止游戏服务器。
start "" cmd /c "timeout /t 3 >nul & start http://localhost:5173/index.html"
where node >nul 2>nul
if %errorlevel%==0 (
  npx --yes http-server . -p 5173 -c-1 -s
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 5173
  goto :eof
)
echo 没找到 Node.js 或 Python，请先安装其中一个：https://nodejs.org
pause
