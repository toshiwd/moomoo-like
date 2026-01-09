@echo off
setlocal
set "err=0"

set "ROOT=%~dp0"

start "Backend" powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $root = '%ROOT%'; $backend = Join-Path $root 'app\\backend'; Set-Location $backend; if (-not (Test-Path '.venv\\Scripts\\python.exe')) { python -m venv .venv; . .\\.venv\\Scripts\\Activate.ps1; pip install -r requirements.txt } else { . .\\.venv\\Scripts\\Activate.ps1 }; python ingest_txt.py; python -m uvicorn main:app --reload --port 8000 }"
if errorlevel 1 set err=1

start "Frontend" powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $root = '%ROOT%'; $frontend = Join-Path $root 'app\\frontend'; Set-Location $frontend; npm run dev }"
if errorlevel 1 set err=1

start "Browser" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3; Start-Process -FilePath 'msedge' -ArgumentList '--app=http://localhost:5173'"
if errorlevel 1 set err=1

if %err% equ 1 (
    echo.
    echo An error occurred while starting the development environment.
    echo Please check that Python and Node.js are installed and in your PATH.
    pause
)

endlocal
