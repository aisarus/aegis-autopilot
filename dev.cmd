@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is not installed. Install Node.js LTS first.
  pause
  exit /b 1
)
if not exist node_modules (
  echo [Aegis] Installing dependencies...
  call npm install || goto :error
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-watch.ps1"
exit /b %errorlevel%
:error
echo [Aegis] Failed to start dev mode.
pause
exit /b 1
