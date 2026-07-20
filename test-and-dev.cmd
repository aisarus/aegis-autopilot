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

echo [Aegis] Running smoke tests before launch...
call npm test || goto :tests_failed

echo [Aegis] Tests passed. Starting watched development mode...
call dev.cmd
exit /b %errorlevel%

:tests_failed
echo.
echo [Aegis] Tests failed. Electron was not started.
echo Fix the failures and run test-and-dev.cmd again.
pause
exit /b 1

:error
echo [Aegis] Failed to prepare development environment.
pause
exit /b 1
