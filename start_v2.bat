@echo off
REM =========================================================
REM  AI Image Studio - v2 Launcher
REM  Starts the hidden v2 launcher. The launcher opens its own browser window.
REM =========================================================

chcp 65001 >nul
cd /d "%~dp0"

start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start_v2.ps1"
exit /b
