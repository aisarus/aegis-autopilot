@echo off
setlocal
cd /d "%~dp0"

echo [1/6] Updating repository...
git pull --ff-only || goto :fail

findstr /C:"\"version\": \"1.2.4\"" package.json >nul
if %errorlevel%==0 goto :already

echo [2/6] Checking patch...
git apply --check patches\1.2.4-own-draft-retry.patch || goto :fail

echo [3/6] Applying patch...
git apply patches\1.2.4-own-draft-retry.patch || goto :fail

echo [4/6] Verifying syntax and tests...
node --check main.js || goto :rollback
call npm test || goto :rollback

echo [5/6] Committing verified fix...
git add main.js package.json package-lock.json tests\own-draft-retry-smoke.js
git commit -m "fix: automatically retry Aegis-owned drafts" || goto :fail

echo [6/6] Pushing to GitHub...
git push origin main || goto :fail

echo.
echo Aegis 1.2.4 applied, tested and pushed successfully.
pause
exit /b 0

:already
echo Aegis 1.2.4 is already applied.
pause
exit /b 0

:rollback
echo Verification failed. Rolling back patch changes...
git restore main.js package.json package-lock.json tests\own-draft-retry-smoke.js 2>nul
git clean -f tests\own-draft-retry-smoke.js 2>nul
goto :fail

:fail
echo.
echo Aegis 1.2.4 was not applied. Copy this window output into ChatGPT.
pause
exit /b 1
