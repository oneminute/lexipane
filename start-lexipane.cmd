@echo off
setlocal
cd /d "%~dp0"

echo.
echo LexiPane Launcher
echo -----------------
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start-lexipane.ps1" %*

set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo LexiPane launcher exited with code %EXITCODE%.
  pause
)

exit /b %EXITCODE%
