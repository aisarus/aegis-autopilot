@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is not installed. Install Node.js 22 LTS first.
  pause
  exit /b 1
)
where npm.cmd >nul 2>nul || (
  echo npm is not available. Reinstall Node.js 22 LTS.
  pause
  exit /b 1
)
if not exist node_modules (
  echo [Aegis] Installing locked dependencies...
  call npm.cmd ci || goto :error
)
echo [Aegis] Preparing source before the watcher starts...
call npm.cmd run source:prepare || goto :error
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-watch.ps1"
exit /b %errorlevel%
:error
echo [Aegis] Failed to start guarded dev mode.
pause
exit /b 1
