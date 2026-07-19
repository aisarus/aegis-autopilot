@echo off
setlocal
cd /d "%~dp0"
where git >nul 2>nul || (
  echo Git is not installed.
  pause
  exit /b 1
)
echo [Aegis] Pulling latest code...
git pull --ff-only || goto :error
echo [Aegis] Syncing dependencies...
call npm install || goto :error
echo [Aegis] Running tests...
call npm test || goto :error
call dev.cmd
exit /b %errorlevel%
:error
echo [Aegis] Update failed. Existing files were not replaced by a forced reset.
pause
exit /b 1
