@echo off
chcp 65001 >nul
rem 把桌面 PaperGame 文件夹里最新的游戏文件同步进来（游戏更新后双击运行一次）
set SRC=%~dp0..\PaperGame
set DST=%~dp0resources\app\game
if not exist "%SRC%\index.html" (
  echo 没找到 %SRC% ，请确认 PaperGame 文件夹在桌面上。
  pause
  exit /b 1
)
robocopy "%SRC%" "%DST%" /MIR /XD tools .git Rin_Blender Rin_VRoid _convert /XF README.md start.bat /NFL /NDL /NJH /NP
echo 更新完成。
timeout /t 2 >nul
