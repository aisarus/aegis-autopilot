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

set "REPO_DIR=%CD%"
set "RUNTIME_DIR=%LOCALAPPDATA%\AegisAutopilot\dev-runtime"
set "PATCH_MANIFEST=%REPO_DIR%\patches\runtime-manifest.txt"

echo [Aegis] Pulling latest repository state...
git pull --ff-only || goto :error
for /f %%I in ('git rev-parse HEAD') do set "TARGET_SHA=%%I"

call :prepare_runtime || goto :error
call :apply_runtime_patches || goto :error

pushd "%RUNTIME_DIR%" || goto :error
echo [Aegis] Syncing dependencies in isolated runtime...
call npm install || goto :runtime_error

echo [Aegis] Checking syntax...
node --check main.js || goto :runtime_error
node --check chatgpt-preload.js || goto :runtime_error

echo [Aegis] Running tests...
call npm test || goto :runtime_error

echo [Aegis] Starting verified runtime...
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
    echo [Aegis] Applying verified patch !PATCH_NAME!...
    git -C "%RUNTIME_DIR%" apply --check "%REPO_DIR%\patches\!PATCH_NAME!" || exit /b 1
    git -C "%RUNTIME_DIR%" apply "%REPO_DIR%\patches\!PATCH_NAME!" || exit /b 1
  )
)
exit /b 0

:runtime_error
set "RUN_RESULT=%errorlevel%"
popd
exit /b %RUN_RESULT%

:error
echo [Aegis] Update failed. The repository itself was left untouched.
echo [Aegis] Runtime path: %RUNTIME_DIR%
pause
exit /b 1
