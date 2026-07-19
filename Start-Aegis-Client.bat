@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "NODE_EXE="

rem Check the normal Windows installer locations first. This also works when
rem Explorer has not refreshed PATH after installing Node.js.
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.volta\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.volta\bin\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\scoop\apps\nodejs-lts\current\node.exe" set "NODE_EXE=%USERPROFILE%\scoop\apps\nodejs-lts\current\node.exe"

rem Fall back to PATH for nvm, fnm and custom installations.
if not defined NODE_EXE for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE goto node_missing

for %%I in ("%NODE_EXE%") do set "NODE_DIR=%%~dpI"
set "PATH=%NODE_DIR%;%PATH%"

echo [Aegis] Node found at:
echo %NODE_EXE%
"%NODE_EXE%" -v
"%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 goto node_old

set "NPM_CMD=%NODE_DIR%npm.cmd"
if not exist "%NPM_CMD%" goto npm_missing

if not exist "node_modules\electron\package.json" goto install_dependencies
goto start_aegis

:install_dependencies
echo [Aegis] First run. Installing components...
call "%NPM_CMD%" install --no-fund --no-audit
if errorlevel 1 goto install_failed

:start_aegis
echo [Aegis] Starting...
call "%NPM_CMD%" start
if errorlevel 1 goto app_failed
exit /b 0

:node_missing
echo [Aegis] ERROR: Node.js was not found.
echo Install Node.js LTS 20 or newer, then run this file again.
echo https://nodejs.org/en/download
pause
exit /b 1

:node_old
echo [Aegis] ERROR: Node.js 20 or newer is required.
echo The installed version is shown above.
pause
exit /b 1

:npm_missing
echo [Aegis] ERROR: npm.cmd was not found next to node.exe.
echo Install the standard Node.js LTS package with npm included.
pause
exit /b 1

:install_failed
echo [Aegis] ERROR: Dependency installation failed.
echo Check the messages above and send them to support.
pause
exit /b 1

:app_failed
echo [Aegis] ERROR: The application stopped with an error.
echo Copy the messages above and send them to support.
pause
exit /b 1
