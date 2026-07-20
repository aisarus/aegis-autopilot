$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoDir = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $env:LOCALAPPDATA 'AegisAutopilot\dev-runtime'
$PatchManifest = Join-Path $RepoDir 'patches\runtime-manifest.txt'
$ExpectedVersionFile = Join-Path $RepoDir 'patches\runtime-version.txt'

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($Arguments -join ' ') exited with code $LASTEXITCODE."
  }
}

function Get-NativeOutput {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )

  $output = & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($Arguments -join ' ') exited with code $LASTEXITCODE."
  }
  return ($output | Out-String).Trim()
}

function Rebuild-Runtime {
  param([Parameter(Mandatory = $true)][string]$TargetSha)

  Write-Host '[Aegis] Rebuilding isolated runtime...'
  & git -C $RepoDir worktree remove --force $RuntimeDir 2>$null
  if (Test-Path $RuntimeDir) {
    Remove-Item -LiteralPath $RuntimeDir -Recurse -Force
  }
  Invoke-Native git -C $RepoDir worktree prune
  Invoke-Native git -C $RepoDir worktree add --detach $RuntimeDir $TargetSha
}

function Prepare-Runtime {
  param([Parameter(Mandatory = $true)][string]$TargetSha)

  $gitMarker = Join-Path $RuntimeDir '.git'
  if (Test-Path $gitMarker) {
    try {
      Write-Host "[Aegis] Refreshing isolated runtime at $TargetSha..."
      Invoke-Native git -C $RuntimeDir reset --hard
      Invoke-Native git -C $RuntimeDir clean -fd -e 'node_modules/'
      Invoke-Native git -C $RuntimeDir checkout --detach $TargetSha
      return
    } catch {
      Write-Host "[Aegis] Existing runtime cannot be refreshed: $($_.Exception.Message)"
    }
  }

  Rebuild-Runtime -TargetSha $TargetSha
}

function Apply-RuntimePatches {
  if (-not (Test-Path $PatchManifest)) { return }

  $patchNames = Get-Content -LiteralPath $PatchManifest |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') }

  foreach ($patchName in $patchNames) {
    $patchPath = Join-Path (Join-Path $RepoDir 'patches') $patchName
    if (-not (Test-Path $patchPath)) {
      throw "Runtime patch is listed but missing: $patchName"
    }

    Write-Host "[Aegis] Preflighting patch $patchName..."
    try {
      Invoke-Native git -C $RuntimeDir apply --recount --check $patchPath
    } catch {
      throw "Patch preflight failed: $patchName. $($_.Exception.Message)"
    }

    Write-Host "[Aegis] Applying patch $patchName..."
    try {
      Invoke-Native git -C $RuntimeDir apply --recount $patchPath
    } catch {
      throw "Patch apply failed: $patchName. $($_.Exception.Message)"
    }
  }
}

function Assert-RuntimeVersion {
  $packagePath = Join-Path $RuntimeDir 'package.json'
  $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
  $runtimeVersion = [string]$package.version
  $expectedVersion = if (Test-Path $ExpectedVersionFile) {
    (Get-Content -LiteralPath $ExpectedVersionFile -Raw).Trim()
  } else {
    ''
  }

  Write-Host "[Aegis] Prepared runtime version $runtimeVersion; expected $expectedVersion."
  if ($expectedVersion -and $runtimeVersion -ne $expectedVersion) {
    throw "Runtime version mismatch: prepared $runtimeVersion, expected $expectedVersion."
  }
  return $runtimeVersion
}

function Stop-ExistingAegis {
  Write-Host '[Aegis] Closing stale Aegis processes before verified launch...'
  $targets = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -ieq 'Aegis.exe' -or
    ($_.Name -ieq 'electron.exe' -and [string]$_.CommandLine -match '(?i)(AegisAutopilot\\dev-runtime|aegis-autopilot|aegis-chatgpt-client)')
  })

  foreach ($target in $targets) {
    try {
      $process = Get-Process -Id $target.ProcessId -ErrorAction Stop
      if ($process.MainWindowHandle -ne 0) {
        $null = $process.CloseMainWindow()
      }
    } catch {}
  }

  if ($targets.Count -gt 0) {
    Start-Sleep -Seconds 2
    foreach ($target in $targets) {
      Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

try {
  $targetSha = Get-NativeOutput git -C $RepoDir rev-parse HEAD
  Prepare-Runtime -TargetSha $targetSha
  Apply-RuntimePatches
  $runtimeVersion = Assert-RuntimeVersion

  Push-Location $RuntimeDir
  try {
    Write-Host '[Aegis] Syncing dependencies in isolated runtime...'
    Invoke-Native npm.cmd install

    Write-Host '[Aegis] Checking syntax...'
    Invoke-Native node --check main.js
    Invoke-Native node --check chatgpt-preload.js

    Write-Host '[Aegis] Running tests...'
    Invoke-Native npm.cmd test

    Stop-ExistingAegis
    Write-Host "[Aegis] Starting verified runtime $runtimeVersion from $RuntimeDir..."
    & cmd.exe /d /c dev.cmd
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
} catch {
  Write-Host ''
  Write-Host "[Aegis] Update failed: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ScriptStackTrace) {
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
  }
  Write-Host "[Aegis] Repository left untouched: $RepoDir"
  Write-Host "[Aegis] Runtime path: $RuntimeDir"
  exit 1
}
