@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)
call npm install || goto :error
call npm test || goto :error
call dev.cmd
exit /b %errorlevel%
:error
echo [Aegis] First run failed.
pause
exit /b 1
