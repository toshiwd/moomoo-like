@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"

REM ============================================================
REM start-user.bat（ユーザー用）
REM - 起動前に git pull（FFのみ）。失敗しても既存で起動を続行
REM - 依存は変化時のみ更新（pip/npm）
REM - ingest_txt.py は data\txt が更新された時だけ実行
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

REM --- 更新チェック（git pull） ---
if exist "%ROOT%\.git" (
  where git >nul 2>&1
  if errorlevel 1 (
    echo [WARN] git が見つかりません。更新はスキップして起動します。
  ) else (
    pushd "%ROOT%"
    echo [INFO] 更新を確認します（git pull --ff-only）...
    git pull --ff-only
    if errorlevel 1 (
      echo [WARN] 更新に失敗しました。現行バージョンで起動を続行します。
    )
    popd
  )
) else (
  echo [WARN] .git がないため更新をスキップします（ZIP配布などの場合）。
)

start "Backend (User)" powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $script = Get-Content -Raw -Path '%ROOT%scripts\start-backend.ps1'; & ([ScriptBlock]::Create($script)) -Mode user }"

start "Frontend (User)" powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $script = Get-Content -Raw -Path '%ROOT%scripts\start-frontend.ps1'; & ([ScriptBlock]::Create($script)) -Mode user }"

start "Browser" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:5173'"

endlocal
