@echo off
chcp 65001 >nul
echo 🧠 KeyMemory 默认记忆系统安装器
echo ===================================
echo.
echo 正在配置 KeyMemory 为默认记忆系统...
echo.

node install-default-memory.js %*

pause
