Option Explicit

' Run backend/frontend without showing console windows.

Dim shell, fso, baseDir
Dim backendCmd, frontendCmd, browserCmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)

backendCmd = "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command ""& { " & _
             "$root = '" & baseDir & "'; " & _
             "$backend = Join-Path $root 'app\\backend'; " & _
             "Set-Location $backend; " & _
             "if (-not (Test-Path '.venv\\Scripts\\python.exe')) { " & _
             "python -m venv .venv; . .\\.venv\\Scripts\\Activate.ps1; pip install -r requirements.txt } " & _
             "else { . .\\.venv\\Scripts\\Activate.ps1 }; " & _
             "python ingest_txt.py; python -m uvicorn main:app --reload --port 8000 }"""

frontendCmd = "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command ""& { " & _
              "$root = '" & baseDir & "'; " & _
              "$frontend = Join-Path $root 'app\\frontend'; " & _
              "Set-Location $frontend; npm run dev }"""

browserCmd = "powershell -NoProfile -WindowStyle Hidden -Command ""Start-Sleep -Seconds 3; " & _
             "Start-Process 'http://localhost:5173'"""

shell.Run backendCmd, 0, False
shell.Run frontendCmd, 0, False
shell.Run browserCmd, 0, False
