@echo off
chcp 65001 >nul
echo 🌐 KeyMemory Web UI 后台启动
echo ============================
echo.
echo 正在后台启动 KeyMemory Web UI...
echo 关闭此窗口不会影响服务运行
echo.

node start-ui.js --background

echo.
echo 服务已在后台启动
echo   - Web UI: http://localhost:5173
echo.
pause
