@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where git >nul 2>nul || (
  echo Git is not installed.
  pause
  exit /b 1
)
where powershell >nul 2>nul || (
  echo Windows PowerShell is not available.
  pause
  exit /b 1
)

echo [Aegis] Pulling latest repository state...
git pull --ff-only
if errorlevel 1 goto :error

powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\update-and-run.ps1"
set "RUN_RESULT=%errorlevel%"
if not "%RUN_RESULT%"=="0" pause
exit /b %RUN_RESULT%

:error
echo [Aegis] Repository update failed. Local files were not reset.
pause
exit /b 1
