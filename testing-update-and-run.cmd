@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where git >nul 2>nul || (
  echo [Aegis] Git is not installed.
  echo Install Git for Windows, then run this shortcut again.
  pause
  exit /b 1
)

echo [Aegis] Switching to the testing channel...
git fetch origin testing
if errorlevel 1 goto :error

git switch testing 2>nul
if errorlevel 1 git checkout -b testing --track origin/testing
if errorlevel 1 goto :error

git pull --ff-only origin testing
if errorlevel 1 goto :error

echo [Aegis] Verifying isolated runtime registration...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$repo=(Resolve-Path '%~dp0').Path.TrimEnd('\'); $runtime=Join-Path $env:LOCALAPPDATA 'AegisAutopilot\dev-runtime'; $runtimeValid=$false; if (Test-Path -LiteralPath (Join-Path $runtime '.git')) { & git -C $runtime rev-parse --is-inside-work-tree *> $null; $runtimeValid=($LASTEXITCODE -eq 0) }; if (-not $runtimeValid) { Write-Host '[Aegis] Repairing orphaned runtime...'; & git -C $repo worktree remove --force $runtime 2>$null; & git -C $repo worktree prune | Out-Null; if (Test-Path -LiteralPath $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }; & git -C $repo worktree add --detach $runtime HEAD; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }"
if errorlevel 1 goto :error

call "%~dp0update-and-run.cmd"
exit /b %errorlevel%

:error
echo.
echo [Aegis] Testing-channel update failed.
echo Your local files were not reset or deleted.
pause
exit /b 1
