param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('user', 'admin')]
  [string]$Mode
)

try {
  $ErrorActionPreference = 'Stop'

  $root = Split-Path -Parent $PSScriptRoot
  $backend = Join-Path $root 'app\backend'
  Set-Location $backend

  if (-not (Test-Path '.venv\Scripts\python.exe')) {
    python -m venv .venv
  }

  . .\.venv\Scripts\Activate.ps1

  $stateDir = Join-Path $env:APPDATA 'meemee-screener\state'
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

  $reqFile = 'requirements.txt'
  if (-not (Test-Path $reqFile)) { throw 'requirements.txt が見つかりません。' }

  $hashName = if ($Mode -eq 'user') { 'user_requirements.sha256' } else { 'admin_requirements.sha256' }
  $hashFile = Join-Path $stateDir $hashName
  $curHash = (Get-FileHash $reqFile -Algorithm SHA256).Hash
  $oldHash = if (Test-Path $hashFile) { (Get-Content $hashFile -ErrorAction SilentlyContinue).Trim() } else { '' }

  $tag = if ($Mode -eq 'user') { '[Backend/User]' } else { '[Backend/Admin]' }

  if ($curHash -ne $oldHash) {
    Write-Host "$tag 依存関係を更新します（pip install -r requirements.txt）"
    pip install -r $reqFile
    Set-Content -Path $hashFile -Value $curHash -NoNewline
  } else {
    Write-Host "$tag 依存関係は変更なし（pip install スキップ）"
  }

  if ($Mode -eq 'user') {
    $txtDir = Join-Path $root 'data\txt'
    $ingestStampFile = Join-Path $stateDir 'last_ingest_utc.txt'

    $lastIngestUtc = [DateTime]::MinValue
    if (Test-Path $ingestStampFile) {
      $raw = (Get-Content $ingestStampFile -ErrorAction SilentlyContinue).Trim()
      if ($raw) { $lastIngestUtc = [DateTime]::Parse($raw).ToUniversalTime() }
    }

    $needIngest = $true

    if (-not (Test-Path $txtDir)) {
      Write-Host '[Backend/User] WARN: data\txt が見つかりません。ingest を試みますが失敗する可能性があります。'
      $needIngest = $true
    } else {
      $latest = (Get-ChildItem $txtDir -File -Recurse -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1).LastWriteTimeUtc

      if ($latest -and ($latest -le $lastIngestUtc)) {
        $needIngest = $false
      }
    }

    if ($needIngest) {
      Write-Host '[Backend/User] データ更新を検知: ingest_txt.py を実行します'
      python ingest_txt.py
      Set-Content -Path $ingestStampFile -Value ([DateTime]::UtcNow.ToString('o')) -NoNewline
    } else {
      Write-Host '[Backend/User] データ更新なし: ingest をスキップします'
    }

    python -m uvicorn main:app --host 127.0.0.1 --port 8000
  } else {
    Write-Host '[Backend/Admin] ingest_txt.py を実行します'
    python ingest_txt.py
    python -m uvicorn main:app --reload --port 8000
  }
} catch {
  $label = if ($Mode -eq 'user') { 'Backend (User)' } else { 'Backend (Admin)' }
  Write-Host "--- $label 起動に失敗 ---" -ForegroundColor Red
  Write-Host $_
  Read-Host 'Enterで閉じる'
  exit 1
}
