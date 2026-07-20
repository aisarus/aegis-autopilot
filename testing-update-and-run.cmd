@echo off
setlocal EnableExtensions
chcp 65001 >nul

if /I "%~1"=="--from-temp" goto :from_temp

set "BOOTSTRAP=%TEMP%\AegisAutopilot-testing-bootstrap-%RANDOM%-%RANDOM%.cmd"
copy /Y "%~f0" "%BOOTSTRAP%" >nul
if errorlevel 1 goto :copy_error

call "%BOOTSTRAP%" --from-temp "%~dp0"
set "RUN_RESULT=%errorlevel%"
del /Q "%BOOTSTRAP%" >nul 2>nul
exit /b %RUN_RESULT%

:from_temp
set "REPO=%~2"
if not defined REPO goto :path_error
cd /d "%REPO%"
if errorlevel 1 goto :path_error

where git >nul 2>nul || (
  echo [Aegis] Git is not installed.
  echo Install Git for Windows, then run this shortcut again.
  pause
  exit /b 1
)

echo [Aegis] Repairing and synchronizing the testing channel...
git reset --hard
if errorlevel 1 goto :error

git fetch origin testing
if errorlevel 1 goto :error

git switch testing 2>nul
if errorlevel 1 git checkout -B testing origin/testing
if errorlevel 1 goto :error

git reset --hard origin/testing
if errorlevel 1 goto :error

echo [Aegis] Testing channel is synchronized.
call "%REPO%update-and-run.cmd"
exit /b %errorlevel%

:copy_error
echo.
echo [Aegis] Could not create a temporary updater copy.
pause
exit /b 1

:path_error
echo.
echo [Aegis] Repository path is unavailable.
pause
exit /b 1

:error
echo.
echo [Aegis] Testing-channel repair or update failed.
echo The application profile and settings were not deleted.
pause
exit /b 1
