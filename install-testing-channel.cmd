@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "AEGIS_REPO=https://github.com/aisarus/aegis-autopilot.git"
set "AEGIS_BRANCH=testing"
set "AEGIS_HOME=%USERPROFILE%\AegisAutopilot"
set "AEGIS_SHORTCUT=%USERPROFILE%\Desktop\Aegis - Update and Run.lnk"

echo [Aegis] One-time testing channel setup
echo [Aegis] Folder: %AEGIS_HOME%
echo.

where git >nul 2>nul || goto :missing_git
where node >nul 2>nul || goto :missing_node
where powershell >nul 2>nul || goto :missing_powershell

if exist "%AEGIS_HOME%\.git" goto :existing

echo [Aegis] Cloning the repository once...
git clone --branch "%AEGIS_BRANCH%" --single-branch "%AEGIS_REPO%" "%AEGIS_HOME%"
if errorlevel 1 goto :error
goto :shortcut

:existing
echo [Aegis] Existing development copy found. Updating it...
git -C "%AEGIS_HOME%" fetch origin "%AEGIS_BRANCH%"
if errorlevel 1 goto :error
git -C "%AEGIS_HOME%" switch "%AEGIS_BRANCH%" 2>nul
if errorlevel 1 git -C "%AEGIS_HOME%" checkout -b "%AEGIS_BRANCH%" --track "origin/%AEGIS_BRANCH%"
if errorlevel 1 goto :error
git -C "%AEGIS_HOME%" pull --ff-only origin "%AEGIS_BRANCH%"
if errorlevel 1 goto :error

:shortcut
echo [Aegis] Creating the permanent desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%AEGIS_SHORTCUT%');$s.TargetPath='%AEGIS_HOME%\testing-update-and-run.cmd';$s.WorkingDirectory='%AEGIS_HOME%';$s.Description='Pull the latest Aegis testing patch, verify it, and launch from source';$s.Save()"
if errorlevel 1 goto :error

echo [Aegis] Starting the latest testing build...
call "%AEGIS_HOME%\testing-update-and-run.cmd"
exit /b %errorlevel%

:missing_git
echo [Aegis] Git for Windows is required once.
echo Download it from: https://git-scm.com/download/win
pause
exit /b 1

:missing_node
echo [Aegis] Node.js LTS is required once.
echo Download it from: https://nodejs.org/
pause
exit /b 1

:missing_powershell
echo [Aegis] Windows PowerShell is unavailable.
pause
exit /b 1

:error
echo.
echo [Aegis] Setup or update failed. No application reinstall was performed.
pause
exit /b 1
