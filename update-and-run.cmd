@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

where git >nul 2>nul || (
  echo Git is not installed.
  pause
  exit /b 1
)
where node >nul 2>nul || (
  echo Node.js is not installed. Install Node.js LTS first.
  pause
  exit /b 1
)
where powershell >nul 2>nul || (
  echo Windows PowerShell is not available.
  pause
  exit /b 1
)

set "REPO_DIR=%CD%"
set "RUNTIME_DIR=%LOCALAPPDATA%\AegisAutopilot\dev-runtime"
set "PATCH_MANIFEST=%REPO_DIR%\patches\runtime-manifest.txt"
set "EXPECTED_VERSION_FILE=%REPO_DIR%\patches\runtime-version.txt"

echo [Aegis] Pulling latest repository state...
git pull --ff-only || goto :error
for /f %%I in ('git rev-parse HEAD') do set "TARGET_SHA=%%I"

call :prepare_runtime || goto :error
call :apply_runtime_patches || goto :error

pushd "%RUNTIME_DIR%" || goto :error
set "EXPECTED_RUNTIME_VERSION="
if exist "%EXPECTED_VERSION_FILE%" set /p EXPECTED_RUNTIME_VERSION=<"%EXPECTED_VERSION_FILE%"
set "RUNTIME_VERSION="
for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "RUNTIME_VERSION=%%V"
echo [Aegis] Prepared runtime version !RUNTIME_VERSION!; expected !EXPECTED_RUNTIME_VERSION!.
if defined EXPECTED_RUNTIME_VERSION if /I not "!RUNTIME_VERSION!"=="!EXPECTED_RUNTIME_VERSION!" (
  echo [Aegis] Runtime version verification failed.
  goto :runtime_error
)

echo [Aegis] Syncing dependencies in isolated runtime...
call npm install || goto :runtime_error

echo [Aegis] Checking syntax...
node --check main.js || goto :runtime_error
node --check chatgpt-preload.js || goto :runtime_error

echo [Aegis] Running tests...
call npm test || goto :runtime_error

call :stop_existing_aegis || goto :runtime_error
echo [Aegis] Starting verified runtime !RUNTIME_VERSION! from %RUNTIME_DIR%...
call dev.cmd
set "RUN_RESULT=%errorlevel%"
popd
exit /b %RUN_RESULT%

:prepare_runtime
if exist "%RUNTIME_DIR%\.git" (
  echo [Aegis] Refreshing isolated runtime at %TARGET_SHA%...
  git -C "%RUNTIME_DIR%" reset --hard >nul 2>nul
  if errorlevel 1 goto :rebuild_runtime
  git -C "%RUNTIME_DIR%" clean -fd -e node_modules/ >nul 2>nul
  if errorlevel 1 goto :rebuild_runtime
  git -C "%RUNTIME_DIR%" checkout --detach "%TARGET_SHA%" >nul 2>nul
  if not errorlevel 1 exit /b 0
)

:rebuild_runtime
echo [Aegis] Rebuilding isolated runtime...
git worktree remove --force "%RUNTIME_DIR%" >nul 2>nul
if exist "%RUNTIME_DIR%" rmdir /s /q "%RUNTIME_DIR%"
git worktree prune >nul 2>nul
git worktree add --detach "%RUNTIME_DIR%" "%TARGET_SHA%" || exit /b 1
exit /b 0

:apply_runtime_patches
if not exist "%PATCH_MANIFEST%" exit /b 0
for /f "usebackq eol=# delims=" %%P in ("%PATCH_MANIFEST%") do (
  set "PATCH_NAME=%%P"
  if not "!PATCH_NAME!"=="" (
    echo [Aegis] Preflighting patch !PATCH_NAME!...
    git -C "%RUNTIME_DIR%" apply --recount --check "%REPO_DIR%\patches\!PATCH_NAME!"
    if errorlevel 1 (
      echo [Aegis] Patch preflight failed: !PATCH_NAME!
      exit /b 1
    )
    echo [Aegis] Applying patch !PATCH_NAME!...
    git -C "%RUNTIME_DIR%" apply --recount "%REPO_DIR%\patches\!PATCH_NAME!"
    if errorlevel 1 (
      echo [Aegis] Patch apply failed: !PATCH_NAME!
      exit /b 1
    )
  )
)
exit /b 0

:stop_existing_aegis
echo [Aegis] Closing stale Aegis processes before verified launch...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue; $targets = @($all | Where-Object { $_.Name -ieq 'Aegis.exe' -or ($_.Name -ieq 'electron.exe' -and [string]$_.CommandLine -match '(?i)(AegisAutopilot\\dev-runtime|aegis-autopilot|aegis-chatgpt-client)') }); foreach ($target in $targets) { try { $process = Get-Process -Id $target.ProcessId -ErrorAction Stop; if ($process.MainWindowHandle -ne 0) { $null = $process.CloseMainWindow() } } catch {} }; Start-Sleep -Seconds 2; foreach ($target in $targets) { Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue }"
if errorlevel 1 exit /b 1
exit /b 0

:runtime_error
set "RUN_RESULT=%errorlevel%"
if "%RUN_RESULT%"=="0" set "RUN_RESULT=1"
popd
exit /b %RUN_RESULT%

:error
echo [Aegis] Update failed. The repository itself was left untouched.
echo [Aegis] Runtime path: %RUNTIME_DIR%
pause
exit /b 1