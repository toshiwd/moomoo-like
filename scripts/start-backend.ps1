param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('user', 'admin')]
  [string]$Mode
)

try {
  $ErrorActionPreference = 'Stop'

  $scriptDir = $PSScriptRoot
  if (-not $scriptDir) {
    $scriptPath = if ($PSCommandPath) { $PSCommandPath } elseif ($MyInvocation.MyCommand.Path) { $MyInvocation.MyCommand.Path } else { $null }
    if (-not $scriptPath) { throw 'Cannot determine script path.' }
    $scriptDir = Split-Path -Parent $scriptPath
  }

  $scriptDir = (Resolve-Path -LiteralPath $scriptDir).Path
  $root = Split-Path -Parent $scriptDir
  if (-not $root) { throw 'Cannot determine repo root.' }
  $backend = Join-Path $root 'app\backend'
  Set-Location $backend

  if (-not (Test-Path '.venv\Scripts\python.exe')) {
    python -m venv .venv
  }

  . .\.venv\Scripts\Activate.ps1

  $appDataRoot = if ($env:APPDATA) { $env:APPDATA } elseif ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $root }
  if (-not $appDataRoot) { throw 'APPDATA/LOCALAPPDATA not set.' }
  $stateDir = Join-Path $appDataRoot 'meemee-screener\state'
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

  $reqFile = 'requirements.txt'
  if (-not (Test-Path $reqFile)) { throw 'requirements.txt not found.' }

  $hashName = if ($Mode -eq 'user') { 'user_requirements.sha256' } else { 'admin_requirements.sha256' }
  $hashFile = Join-Path $stateDir $hashName
  $curHash = (Get-FileHash $reqFile -Algorithm SHA256).Hash
  $oldHash = if (Test-Path $hashFile) { (Get-Content $hashFile -ErrorAction SilentlyContinue).Trim() } else { '' }

  $tag = if ($Mode -eq 'user') { '[Backend/User]' } else { '[Backend/Admin]' }

  if ($curHash -ne $oldHash) {
    Write-Host "$tag Installing backend dependencies (pip install -r requirements.txt)..."
    pip install -r $reqFile
    Set-Content -Path $hashFile -Value $curHash -NoNewline
  } else {
    Write-Host "$tag Dependencies unchanged. Skipping pip install."
  }

  if ($Mode -eq 'user') {
    $txtDir = Join-Path $root 'data\txt'
    $ingestStampFile = Join-Path $stateDir 'last_ingest_utc.txt'

    $lastIngestUtc = [DateTime]::MinValue
    if (Test-Path $ingestStampFile) {
      $raw = (Get-Content $ingestStampFile -Raw -ErrorAction SilentlyContinue).Trim()
      if ($raw) {
        try {
          # Use Parse with RoundtripKind for ISO 8601 dates, which is more robust than TryParse across PS versions.
          $parsed = [DateTime]::Parse($raw, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)
          $lastIngestUtc = $parsed.ToUniversalTime()
        } catch {
          Write-Host "[Backend/User] WARN: last_ingest_utc.txt contains invalid timestamp ('$raw'), forcing ingest."
        }
      }
    }

    $needIngest = $true

    if (-not (Test-Path $txtDir)) {
      Write-Host '[Backend/User] WARN: data\\txt not found. Ingest will still run.'
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
      Write-Host '[Backend/User] Running ingest_txt.py...'
      python ingest_txt.py
      Set-Content -Path $ingestStampFile -Value ([DateTime]::UtcNow.ToString('o')) -NoNewline
    } else {
      Write-Host '[Backend/User] TXT not updated. Skipping ingest.'
    }

    python -c "import uvicorn; uvicorn.run('main:app', host='127.0.0.1', port=8000, log_level='info', lifespan='off')"
  } else {
    Write-Host '[Backend/Admin] Running ingest_txt.py...'
    python ingest_txt.py
    python -c "import uvicorn; uvicorn.run('main:app', host='127.0.0.1', port=8000, log_level='info', reload=True, lifespan='off')"
  }
} catch {
  $label = if ($Mode -eq 'user') { 'Backend (User)' } else { 'Backend (Admin)' }
  Write-Host "--- $label failed ---" -ForegroundColor Red
  Write-Host $_
  Read-Host 'Press Enter to exit'
  exit 1
}
