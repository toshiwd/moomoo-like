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
  $frontend = Join-Path $root 'app\frontend'
  Set-Location $frontend

  $lockFile = 'package-lock.json'
  if (-not (Test-Path $lockFile)) { throw 'package-lock.json not found.' }

  $appDataRoot = if ($env:APPDATA) { $env:APPDATA } elseif ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $root }
  if (-not $appDataRoot) { throw 'APPDATA/LOCALAPPDATA not set.' }
  $stateDir = Join-Path $appDataRoot 'meemee-screener\state'
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

  $hashName = if ($Mode -eq 'user') { 'user_package_lock.sha256' } else { 'admin_package_lock.sha256' }
  $hashFile = Join-Path $stateDir $hashName
  $curHash = (Get-FileHash $lockFile -Algorithm SHA256).Hash
  $oldHash = if (Test-Path $hashFile) { (Get-Content $hashFile -ErrorAction SilentlyContinue).Trim() } else { '' }

  $nodeModulesExists = Test-Path 'node_modules'
  $tag = if ($Mode -eq 'user') { '[Frontend/User]' } else { '[Frontend/Admin]' }

  if ((-not $nodeModulesExists) -or ($curHash -ne $oldHash)) {
    Write-Host "$tag Installing frontend dependencies (npm ci)..."
    npm ci
    Set-Content -Path $hashFile -Value $curHash -NoNewline
  } else {
    Write-Host "$tag Dependencies unchanged. Skipping npm ci."
  }

  npm run dev
} catch {
  $label = if ($Mode -eq 'user') { 'Frontend (User)' } else { 'Frontend (Admin)' }
  Write-Host "--- $label failed ---" -ForegroundColor Red
  Write-Host $_
  Read-Host 'Press Enter to exit'
  exit 1
}
