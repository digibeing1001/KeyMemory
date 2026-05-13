@echo off
chcp 65001 >nul
echo 🔄 KeyMemory 增量更新
echo ====================
echo.
echo 正在从 GitHub 拉取更新...
echo.

node update-hermes.js %*

pause
