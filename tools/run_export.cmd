@echo off
setlocal

set "SCRIPT=%~dp0export_pan.vbs"
set "CODE_FILE=%~1"
set "OUT_DIR=%~2"

if "%CODE_FILE%"=="" set "CODE_FILE=%~dp0code.txt"
if "%OUT_DIR%"=="" set "OUT_DIR=%~dp0..\data\txt"

set "CSCRIPT=%SystemRoot%\SysWOW64\cscript.exe"
if not exist "%CSCRIPT%" set "CSCRIPT=%SystemRoot%\System32\cscript.exe"

"%CSCRIPT%" //nologo "%SCRIPT%" "%CODE_FILE%" "%OUT_DIR%"

endlocal
