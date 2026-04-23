@echo off
REM =========================================================
REM  AI Image Studio - Quick Launcher (double-click entry)
REM  Calls start.ps1 via PowerShell with execution policy bypass
REM =========================================================

chcp 65001 >nul
title AI Image Studio Launcher

cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"

echo.
echo (Press any key to close this launcher window)
pause >nul
