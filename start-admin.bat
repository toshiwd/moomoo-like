@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"

REM ============================================================
REM start-admin.bat（管理者用）
REM - 開発・検証向け（uvicorn --reload）
REM - ingest_txt.py は毎回実行（データ更新が頻繁な前提）
REM - requirements.txt / package-lock.json が変わったら依存更新
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

start "Backend (Admin)" powershell -NoProfile -ExecutionPolicy Bypass -Command "& {
  try {
    $ErrorActionPreference = 'Stop';

    $root = '%ROOT%';
    $backend = Join-Path $root 'app\backend';
    Set-Location $backend;

    # venv 作成（初回のみ）
    if (-not (Test-Path '.venv\Scripts\python.exe')) {
      python -m venv .venv;
    }

    # venv 有効化
    . .\.venv\Scripts\Activate.ps1;

    # requirements.txt 変化時のみ pip install
    $stateDir = Join-Path $env:APPDATA 'moomoo-like\state';
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null;

    $reqFile = 'requirements.txt';
    if (-not (Test-Path $reqFile)) { throw 'requirements.txt が見つかりません。'; }

    $hashFile = Join-Path $stateDir 'admin_requirements.sha256';
    $curHash = (Get-FileHash $reqFile -Algorithm SHA256).Hash;
    $oldHash = if (Test-Path $hashFile) { (Get-Content $hashFile -ErrorAction SilentlyContinue).Trim() } else { '' };

    if ($curHash -ne $oldHash) {
      Write-Host '[Backend/Admin] 依存関係を更新します（pip install -r requirements.txt）';
      pip install -r $reqFile;
      Set-Content -Path $hashFile -Value $curHash -NoNewline;
    } else {
      Write-Host '[Backend/Admin] 依存関係は変更なし（pip install スキップ）';
    }

    # 開発・検証用：毎回 ingest 実行
    Write-Host '[Backend/Admin] ingest_txt.py を実行します';
    python ingest_txt.py;

    # API 起動（開発向け）
    python -m uvicorn main:app --reload --port 8000;

  } catch {
    Write-Host '--- Backend (Admin) 起動に失敗 ---' -ForegroundColor Red;
    Write-Host $_;
    Read-Host 'Enterで閉じる';
    exit 1
  }
}"

start "Frontend (Admin)" powershell -NoProfile -ExecutionPolicy Bypass -Command "& {
  try {
    $ErrorActionPreference = 'Stop';

    $root = '%ROOT%';
    $frontend = Join-Path $root 'app\frontend';
    Set-Location $frontend;

    $lockFile = 'package-lock.json';
    if (-not (Test-Path $lockFile)) { throw 'package-lock.json が見つかりません。'; }

    $stateDir = Join-Path $env:APPDATA 'moomoo-like\state';
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null;

    $hashFile = Join-Path $stateDir 'admin_package_lock.sha256';
    $curHash = (Get-FileHash $lockFile -Algorithm SHA256).Hash;
    $oldHash = if (Test-Path $hashFile) { (Get-Content $hashFile -ErrorAction SilentlyContinue).Trim() } else { '' };

    $nodeModulesExists = Test-Path 'node_modules';

    if ((-not $nodeModulesExists) -or ($curHash -ne $oldHash)) {
      Write-Host '[Frontend/Admin] 依存関係を更新します（npm ci）';
      npm ci;
      Set-Content -Path $hashFile -Value $curHash -NoNewline;
    } else {
      Write-Host '[Frontend/Admin] 依存関係は変更なし（npm ci スキップ）';
    }

    npm run dev;

  } catch {
    Write-Host '--- Frontend (Admin) 起動に失敗 ---' -ForegroundColor Red;
    Write-Host $_;
    Read-Host 'Enterで閉じる';
    exit 1
  }
}"

start "Browser" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:5173'"

endlocal
