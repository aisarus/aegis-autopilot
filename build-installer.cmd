@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Aegis Installer Builder

where npm >nul 2>nul || (
  echo [ERROR] Node.js is not installed or npm is not in PATH.
  echo Install Node.js LTS from nodejs.org and run this file again.
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "APP_VERSION=%%V"
set "INSTALLER=%~dp0dist\Aegis-Setup-%APP_VERSION%.exe"

echo [1/4] Using public npm registry...
call npm config set registry https://registry.npmjs.org/
call npm config set fetch-retries 2
call npm config set fetch-retry-mintimeout 2000
call npm config set fetch-retry-maxtimeout 10000
call npm config set fetch-timeout 120000

echo [2/4] Cleaning an incomplete previous installation...
if exist node_modules rmdir /s /q node_modules
if exist dist rmdir /s /q dist

echo [3/4] Installing exact dependencies...
call npm ci --no-audit --no-fund --loglevel=notice
if errorlevel 1 goto :error

echo [4/4] Building Windows installer...
set ELECTRON_GET_USE_PROXY=1
call npm run dist:win
if errorlevel 1 goto :error

if not exist "%INSTALLER%" (
  echo [ERROR] Build finished without the expected installer file:
  echo %INSTALLER%
  goto :error
)

echo.
echo SUCCESS: Aegis-Setup-%APP_VERSION%.exe was created.
explorer /select,"%INSTALLER%"
pause
exit /b 0

:error
echo.
echo BUILD FAILED.
echo Copy the last 30 lines from this window and send them for diagnosis.
pause
exit /b 1
