@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"

REM ============================================================
REM start-admin.bat - admin mode
REM ============================================================

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] python が見つかりません。Python をインストールして PATH を通してください。
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm が見つかりません。Node.js（LTS推奨）をインストールしてください。
  pause
  exit /b 1
)

start "Backend (Admin)" powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\start-backend.ps1" -Mode admin

start "Frontend (Admin)" powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\start-frontend.ps1" -Mode admin

start "Browser" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:5173'"

endlocal
