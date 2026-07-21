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
echo   AEGIS - UPDATE, VERIFY AND RUN
echo ========================================
echo [1/7] Downloading the latest testing code...
git fetch origin testing
if errorlevel 1 goto :error

echo [2/7] Synchronizing tracked files with origin/testing...
git checkout -B testing origin/testing
if errorlevel 1 goto :error
git reset --hard origin/testing
if errorlevel 1 goto :error

echo [3/7] Removing stale untracked repository files...
git clean -fd -- .
if errorlevel 1 goto :error
for /f "delims=" %%S in ('git status --porcelain --untracked-files^=normal') do (
  echo [Aegis] Worktree is not clean after synchronization: %%S
  goto :error
)

for /f %%I in ('git rev-parse --short=12 HEAD') do set "AEGIS_BUILD_SHA=%%I+testing"
echo [Aegis] Exact build: %AEGIS_BUILD_SHA%

echo [4/7] Installing the locked dependencies...
call npm.cmd ci
if errorlevel 1 goto :error

echo [5/7] Preparing and verifying the source...
call npm.cmd run verify
if errorlevel 1 goto :error

echo [6/7] Verification passed.
echo [Aegis] Source folder: %REPO%
echo [Aegis] Build: %AEGIS_BUILD_SHA%

echo [7/7] Starting Aegis...
echo.
call npm.cmd start
exit /b %ERRORLEVEL%

:missing_git
echo [Aegis] Git for Windows is not installed.
echo Install it once and run this button again.
pause
exit /b 1

:missing_node
echo [Aegis] Node.js 22 LTS is not installed.
echo Install it once and run this button again.
pause
exit /b 1

:not_repo
echo [Aegis] This button must be launched from the cloned aegis-autopilot repository.
pause
exit /b 1

:error
echo.
echo [Aegis] Update or verification failed. The application was not started.
echo [Aegis] Run AEGIS-COLLECT-DEBUG.cmd and send the created file.
pause
exit /b 1
