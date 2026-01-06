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

start "Backend (User)" powershell -NoProfile -ExecutionPolicy Bypass -Command "& {
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

    # 状態保存（AppData）
    $stateDir = Join-Path $env:APPDATA 'moomoo-like\state';
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null;

    # requirements.txt 変化時のみ pip install
    $reqFile = 'requirements.txt';
    if (-not (Test-Path $reqFile)) { throw 'requirements.txt が見つかりません。'; }

    $reqHashFile = Join-Path $stateDir 'user_requirements.sha256';
    $curReqHash = (Get-FileHash $reqFile -Algorithm SHA256).Hash;
    $oldReqHash = if (Test-Path $reqHashFile) { (Get-Content $reqHashFile -ErrorAction SilentlyContinue).Trim() } else { '' };

    if ($curReqHash -ne $oldReqHash) {
      Write-Host '[Backend/User] 依存関係を更新します（pip install -r requirements.txt）';
      pip install -r $reqFile;
      Set-Content -Path $reqHashFile -Value $curReqHash -NoNewline;
    } else {
      Write-Host '[Backend/User] 依存関係は変更なし（pip install スキップ）';
    }

    # data\txt 更新時のみ ingest 実行
    $txtDir = Join-Path $root 'data\txt';
    $ingestStampFile = Join-Path $stateDir 'last_ingest_utc.txt';

    $lastIngestUtc = [DateTime]::MinValue;
    if (Test-Path $ingestStampFile) {
      $raw = (Get-Content $ingestStampFile -ErrorAction SilentlyContinue).Trim();
      if ($raw) { $lastIngestUtc = [DateTime]::Parse($raw).ToUniversalTime(); }
    }

    $needIngest = $true;

    if (-not (Test-Path $txtDir)) {
      Write-Host '[Backend/User] WARN: data\txt が見つかりません。ingest を試みますが失敗する可能性があります。';
      $needIngest = $true;
    } else {
      $latest = (Get-ChildItem $txtDir -File -Recurse -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1).LastWriteTimeUtc;

      if ($latest -and ($latest -le $lastIngestUtc)) {
        $needIngest = $false;
      }
    }

    if ($needIngest) {
      Write-Host '[Backend/User] データ更新を検知: ingest_txt.py を実行します';
      python ingest_txt.py;
      Set-Content -Path $ingestStampFile -Value ([DateTime]::UtcNow.ToString('o')) -NoNewline;
    } else {
      Write-Host '[Backend/User] データ更新なし: ingest をスキップします';
    }

    # API 起動（配布向け：reload なし）
    python -m uvicorn main:app --host 127.0.0.1 --port 8000;

  } catch {
    Write-Host '--- Backend (User) 起動に失敗 ---' -ForegroundColor Red;
    Write-Host $_;
    Read-Host 'Enterで閉じる';
    exit 1
  }
}"

start "Frontend (User)" powershell -NoProfile -ExecutionPolicy Bypass -Command "& {
  try {
    $ErrorActionPreference = 'Stop';

    $root = '%ROOT%';
    $frontend = Join-Path $root 'app\frontend';
    Set-Location $frontend;

    $lockFile = 'package-lock.json';
    if (-not (Test-Path $lockFile)) { throw 'package-lock.json が見つかりません。'; }

    $stateDir = Join-Path $env:APPDATA 'moomoo-like\state';
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null;

    $lockHashFile = Join-Path $stateDir 'user_package_lock.sha256';
    $curLockHash = (Get-FileHash $lockFile -Algorithm SHA256).Hash;
    $oldLockHash = if (Test-Path $lockHashFile) { (Get-Content $lockHashFile -ErrorAction SilentlyContinue).Trim() } else { '' };

    $nodeModulesExists = Test-Path 'node_modules';

    if ((-not $nodeModulesExists) -or ($curLockHash -ne $oldLockHash)) {
      Write-Host '[Frontend/User] 依存関係を更新します（npm ci）';
      npm ci;
      Set-Content -Path $lockHashFile -Value $curLockHash -NoNewline;
    } else {
      Write-Host '[Frontend/User] 依存関係は変更なし（npm ci スキップ）';
    }

    npm run dev;

  } catch {
    Write-Host '--- Frontend (User) 起動に失敗 ---' -ForegroundColor Red;
    Write-Host $_;
    Read-Host 'Enterで閉じる';
    exit 1
  }
}"

start "Browser" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:5173'"

endlocal
