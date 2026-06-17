@echo off
chcp 65001 > nul
:: Vibe Space Windows 开机自启脚本
:: 使用方法：把本文件的快捷方式放到以下目录
::   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
:: 或者直接在任务计划程序里创建“登录时”触发任务，执行此脚本。

cd /d "%~dp0"
if not exist "node_modules" (
  echo [VibeSpace] 未找到 node_modules，请先运行 npm install
  pause
  exit /b 1
)

:: 使用 daemon.js 作为看门狗启动，确保崩溃后自动重启
start "" /min cmd /c "node daemon.js --port=9988"

echo [VibeSpace] 已后台启动，访问 http://localhost:9988/workspace
