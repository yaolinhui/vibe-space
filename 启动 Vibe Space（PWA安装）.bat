@echo off
chcp 65001 >nul
cd /d "%~dp0"
node bin\vibe-space.js --no-open
echo.
echo 请在 Chrome 地址栏右侧点击"安装 Vibe Space"图标，将其安装为桌面应用。
