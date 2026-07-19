@echo off
setlocal
cd /d "%~dp0"
echo WARNING: this deletes all uncommitted source-code changes in this folder.
choice /M "Reset source to origin/main"
if errorlevel 2 exit /b 0
git fetch origin || goto :error
git reset --hard origin/main || goto :error
call npm install || goto :error
call npm test || goto :error
call dev.cmd
exit /b %errorlevel%
:error
echo [Aegis] Reset/update failed.
pause
exit /b 1
