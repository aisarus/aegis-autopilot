@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where git >nul 2>nul || (
  echo [Aegis] Git is not installed.
  echo Install Git for Windows, then run this shortcut again.
  pause
  exit /b 1
)

echo [Aegis] Switching to the testing channel...
git fetch origin testing
if errorlevel 1 goto :error

git switch testing 2>nul
if errorlevel 1 git checkout -b testing --track origin/testing
if errorlevel 1 goto :error

git pull --ff-only origin testing
if errorlevel 1 goto :error

call "%~dp0update-and-run.cmd"
exit /b %errorlevel%

:error
echo.
echo [Aegis] Testing-channel update failed.
echo Your local files were not reset or deleted.
pause
exit /b 1
