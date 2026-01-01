@echo off
setlocal

set "ROOT=%~dp0"

start "Backend" powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $root = '%ROOT%'; $backend = Join-Path $root 'app\\backend'; Set-Location $backend; if (-not (Test-Path '.venv\\Scripts\\python.exe')) { python -m venv .venv; . .\\.venv\\Scripts\\Activate.ps1; pip install -r requirements.txt } else { . .\\.venv\\Scripts\\Activate.ps1 }; python ingest_txt.py; python -m uvicorn main:app --reload --port 8000 }"
start "Frontend" powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $root = '%ROOT%'; $frontend = Join-Path $root 'app\\frontend'; Set-Location $frontend; npm run dev }"

endlocal
