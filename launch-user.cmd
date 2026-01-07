@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "PF=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"
set "LAP=%LocalAppData%"

call :add_python_paths
call :add_node_paths

call "%ROOT%start-user.bat"
exit /b %errorlevel%

:add_python_paths
for /d %%D in ("%LAP%\Programs\Python\Python*") do (
  call :add_to_path "%%~fD"
  if exist "%%~fD\Scripts" call :add_to_path "%%~fD\Scripts"
)
for /d %%D in ("%PF%\Python*") do (
  call :add_to_path "%%~fD"
  if exist "%%~fD\Scripts" call :add_to_path "%%~fD\Scripts"
)
if not "%PF86%"=="" (
  for /d %%D in ("%PF86%\Python*") do (
    call :add_to_path "%%~fD"
    if exist "%%~fD\Scripts" call :add_to_path "%%~fD\Scripts"
  )
)
goto :eof

:add_node_paths
call :add_to_path "%PF%\nodejs"
if not "%PF86%"=="" call :add_to_path "%PF86%\nodejs"
call :add_to_path "%LAP%\Programs\nodejs"
if defined NVM_SYMLINK call :add_to_path "%NVM_SYMLINK%"
if defined NVM_HOME call :add_to_path "%NVM_HOME%"
goto :eof

:add_to_path
set "DIR=%~1"
if "%DIR%"=="" goto :eof
if not exist "%DIR%" goto :eof
set "PATH_CHECK=;%PATH%;"
echo %PATH_CHECK% | find /I ";%DIR%;" >nul
if errorlevel 1 set "PATH=%DIR%;%PATH%"
goto :eof
