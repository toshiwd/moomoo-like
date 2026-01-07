param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('user', 'admin')]
  [string]$Mode
)

try {
  $ErrorActionPreference = 'Stop'

  $root = Split-Path -Parent $PSScriptRoot
  $frontend = Join-Path $root 'app\frontend'
  Set-Location $frontend

  $lockFile = 'package-lock.json'
  if (-not (Test-Path $lockFile)) { throw 'package-lock.json が見つかりません。' }

  $stateDir = Join-Path $env:APPDATA 'moomoo-like\state'
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

  $hashName = if ($Mode -eq 'user') { 'user_package_lock.sha256' } else { 'admin_package_lock.sha256' }
  $hashFile = Join-Path $stateDir $hashName
  $curHash = (Get-FileHash $lockFile -Algorithm SHA256).Hash
  $oldHash = if (Test-Path $hashFile) { (Get-Content $hashFile -ErrorAction SilentlyContinue).Trim() } else { '' }

  $nodeModulesExists = Test-Path 'node_modules'
  $tag = if ($Mode -eq 'user') { '[Frontend/User]' } else { '[Frontend/Admin]' }

  if ((-not $nodeModulesExists) -or ($curHash -ne $oldHash)) {
    Write-Host "$tag 依存関係を更新します（npm ci）"
    npm ci
    Set-Content -Path $hashFile -Value $curHash -NoNewline
  } else {
    Write-Host "$tag 依存関係は変更なし（npm ci スキップ）"
  }

  npm run dev
} catch {
  $label = if ($Mode -eq 'user') { 'Frontend (User)' } else { 'Frontend (Admin)' }
  Write-Host "--- $label 起動に失敗 ---" -ForegroundColor Red
  Write-Host $_
  Read-Host 'Enterで閉じる'
  exit 1
}
