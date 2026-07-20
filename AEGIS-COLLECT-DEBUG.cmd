@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul || (
  echo [Aegis] Node.js is not installed.
  pause
  exit /b 1
)

echo [Aegis] Collecting diagnostics without modifying the checkout...
node scripts\create-debug-bundle.js
if errorlevel 1 goto :error

echo.
echo [Aegis] Debug bundle is ready on the Desktop.
pause
exit /b 0

:error
echo.
echo [Aegis] Could not create the debug bundle.
echo [Aegis] No patch or source change was attempted.
pause
exit /b 1
