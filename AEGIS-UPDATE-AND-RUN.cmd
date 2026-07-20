@echo off
setlocal EnableExtensions
chcp 65001 >nul

rem Run the real updater from TEMP so Git can safely replace this file.
if /I "%~1"=="--worker" goto :worker

set "TEMP_RUNNER=%TEMP%\Aegis-Update-And-Run-%RANDOM%-%RANDOM%.cmd"
copy /Y "%~f0" "%TEMP_RUNNER%" >nul
if errorlevel 1 (
  echo [Aegis] Could not create the temporary updater.
  pause
  exit /b 1
)

call "%TEMP_RUNNER%" --worker "%~dp0"
set "RESULT=%ERRORLEVEL%"
del /Q "%TEMP_RUNNER%" >nul 2>nul
exit /b %RESULT%

:worker
set "REPO=%~2"
cd /d "%REPO%"

where git >nul 2>nul || goto :missing_git
where node >nul 2>nul || goto :missing_node
where npm.cmd >nul 2>nul || goto :missing_node

if not exist ".git" goto :not_repo

echo.
echo ========================================
echo   AEGIS - UPDATE AND RUN
echo ========================================
echo [1/5] Downloading the latest testing patch...
git fetch origin testing
if errorlevel 1 goto :error

echo [2/5] Synchronizing this folder with origin/testing...
git checkout -B testing origin/testing
if errorlevel 1 goto :error
git reset --hard origin/testing
if errorlevel 1 goto :error

echo [3/5] Updating dependencies...
call npm.cmd install
if errorlevel 1 goto :error

echo [4/5] Running smoke tests...
call npm.cmd test
if errorlevel 1 goto :error

echo [5/5] Closing the previous development process...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$repo=[Regex]::Escape('%REPO%'); Get-CimInstance Win32_Process -ErrorAction SilentlyContinue ^| Where-Object { $_.Name -ieq 'electron.exe' -and [string]$_.CommandLine -match $repo } ^| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo.
echo [Aegis] Starting directly from:
echo %REPO%
echo.
call npm.cmd start
exit /b %ERRORLEVEL%

:missing_git
echo [Aegis] Git for Windows is not installed.
echo Install it once and run this button again.
pause
exit /b 1

:missing_node
echo [Aegis] Node.js LTS is not installed.
echo Install it once and run this button again.
pause
exit /b 1

:not_repo
echo [Aegis] This button must be launched from the cloned aegis-autopilot repository.
pause
exit /b 1

:error
echo.
echo [Aegis] Update or verification failed.
echo [Aegis] The application was not reinstalled and your ChatGPT profile was not deleted.
pause
exit /b 1
