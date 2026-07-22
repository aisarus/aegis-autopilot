@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul || (
  echo [Aegis v2] Node.js LTS is required.
  pause
  exit /b 1
)

echo [Aegis v2] Installing verified dependencies...
call npm install || goto :error

echo [Aegis v2] Running the full orchestrator smoke suite...
call npm run test:v2 || goto :error

echo [Aegis v2] Starting GitHub-native orchestrator...
call npm run start:v2
exit /b %errorlevel%

:error
echo [Aegis v2] Launch cancelled because installation or verification failed.
pause
exit /b 1
