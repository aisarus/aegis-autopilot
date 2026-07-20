$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoDir = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $env:LOCALAPPDATA 'AegisAutopilot\dev-runtime'
$PatchManifest = Join-Path $RepoDir 'patches\runtime-manifest.txt'
$ExpectedVersionFile = Join-Path $RepoDir 'patches\runtime-version.txt'
$NormalizedPatchDir = Join-Path $env:TEMP 'AegisAutopilot\normalized-patches'

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($Arguments -join ' ') exited with code $LASTEXITCODE."
  }
}

function Get-NativeOutput {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $output = & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($Arguments -join ' ') exited with code $LASTEXITCODE."
  }
  return ($output | Out-String).Trim()
}

function New-NormalizedPatch {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$PatchName
  )

  $raw = [System.IO.File]::ReadAllText($SourcePath)
  $raw = $raw.Replace("`r`n", "`n").Replace("`r", "`n")
  $lines = [System.Text.RegularExpressions.Regex]::Split($raw, "`n")
  $normalized = New-Object 'System.Collections.Generic.List[string]'
  $headerPattern = '^@@ -(?<oldStart>\d+)(?:,(?<oldCount>\d+))? \+(?<newStart>\d+)(?:,(?<newCount>\d+))? @@(?<suffix>.*)$'

  $index = 0
  while ($index -lt $lines.Length) {
    $line = $lines[$index]
    $match = [System.Text.RegularExpressions.Regex]::Match($line, $headerPattern)
    if (-not $match.Success) {
      $normalized.Add($line)
      $index += 1
      continue
    }

    $oldCount = 0
    $newCount = 0
    $cursor = $index + 1
    while ($cursor -lt $lines.Length) {
      $candidate = $lines[$cursor]
      if ($candidate.StartsWith('diff --git ') -or $candidate.StartsWith('@@ ')) { break }
      if ($candidate.Length -eq 0) { break }

      $prefix = $candidate[0]
      if ($prefix -eq '\') {
        $cursor += 1
        continue
      }
      if ($prefix -ne ' ' -and $prefix -ne '+' -and $prefix -ne '-') { break }
      if ($prefix -eq ' ' -or $prefix -eq '-') { $oldCount += 1 }
      if ($prefix -eq ' ' -or $prefix -eq '+') { $newCount += 1 }
      $cursor += 1
    }

    if ($cursor -eq $index + 1) {
      throw "Patch contains an empty hunk: $PatchName at source line $($index + 1)."
    }

    $oldStart = $match.Groups['oldStart'].Value
    $newStart = $match.Groups['newStart'].Value
    $suffix = $match.Groups['suffix'].Value
    $normalized.Add("@@ -$oldStart,$oldCount +$newStart,$newCount @@$suffix")
    for ($copy = $index + 1; $copy -lt $cursor; $copy += 1) {
      $normalized.Add($lines[$copy])
    }
    $index = $cursor
  }

  if (-not (Test-Path $NormalizedPatchDir)) {
    New-Item -ItemType Directory -Path $NormalizedPatchDir -Force | Out-Null
  }
  $targetPath = Join-Path $NormalizedPatchDir $PatchName
  $utf8NoBom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
  $normalizedText = ($normalized -join "`n").TrimEnd([char]10) + "`n"
  [System.IO.File]::WriteAllText($targetPath, $normalizedText, $utf8NoBom)
  return $targetPath
}

function Rebuild-Runtime {
  param([Parameter(Mandatory = $true)][string]$TargetSha)

  Write-Host '[Aegis] Rebuilding isolated runtime...'
  & git @('-C', $RepoDir, 'worktree', 'remove', '--force', $RuntimeDir) 2>$null
  if (Test-Path $RuntimeDir) {
    Remove-Item -LiteralPath $RuntimeDir -Recurse -Force
  }
  Invoke-Native -FilePath 'git' -Arguments @('-C', $RepoDir, 'worktree', 'prune')
  Invoke-Native -FilePath 'git' -Arguments @('-C', $RepoDir, 'worktree', 'add', '--detach', $RuntimeDir, $TargetSha)
}

function Prepare-Runtime {
  param([Parameter(Mandatory = $true)][string]$TargetSha)

  $gitMarker = Join-Path $RuntimeDir '.git'
  if (Test-Path $gitMarker) {
    try {
      Write-Host "[Aegis] Refreshing isolated runtime at $TargetSha..."
      Invoke-Native -FilePath 'git' -Arguments @('-C', $RuntimeDir, 'reset', '--hard')
      Invoke-Native -FilePath 'git' -Arguments @('-C', $RuntimeDir, 'clean', '-fd', '-e', 'node_modules/')
      Invoke-Native -FilePath 'git' -Arguments @('-C', $RuntimeDir, 'checkout', '--detach', $TargetSha)
      return
    } catch {
      Write-Host "[Aegis] Existing runtime cannot be refreshed: $($_.Exception.Message)"
    }
  }

  Rebuild-Runtime -TargetSha $TargetSha
}

function Apply-RuntimePatches {
  if (-not (Test-Path $PatchManifest)) { return }

  if (Test-Path $NormalizedPatchDir) {
    Remove-Item -LiteralPath $NormalizedPatchDir -Recurse -Force
  }

  $patchNames = Get-Content -LiteralPath $PatchManifest |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') }

  foreach ($patchName in $patchNames) {
    $patchPath = Join-Path (Join-Path $RepoDir 'patches') $patchName
    if (-not (Test-Path $patchPath)) {
      throw "Runtime patch is listed but missing: $patchName"
    }

    $normalizedPatchPath = New-NormalizedPatch -SourcePath $patchPath -PatchName $patchName
    Write-Host "[Aegis] Preflighting normalized patch $patchName..."
    try {
      Invoke-Native -FilePath 'git' -Arguments @('-C', $RuntimeDir, 'apply', '--check', $normalizedPatchPath)
    } catch {
      throw "Patch preflight failed: $patchName. $($_.Exception.Message)"
    }

    Write-Host "[Aegis] Applying normalized patch $patchName..."
    try {
      Invoke-Native -FilePath 'git' -Arguments @('-C', $RuntimeDir, 'apply', $normalizedPatchPath)
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
  $targetSha = Get-NativeOutput -FilePath 'git' -Arguments @('-C', $RepoDir, 'rev-parse', 'HEAD')
  Prepare-Runtime -TargetSha $targetSha
  Apply-RuntimePatches
  $runtimeVersion = Assert-RuntimeVersion

  Push-Location $RuntimeDir
  try {
    Write-Host '[Aegis] Syncing dependencies in isolated runtime...'
    Invoke-Native -FilePath 'npm.cmd' -Arguments @('install')

    Write-Host '[Aegis] Checking syntax...'
    Invoke-Native -FilePath 'node' -Arguments @('--check', 'main.js')
    Invoke-Native -FilePath 'node' -Arguments @('--check', 'chatgpt-preload.js')

    Write-Host '[Aegis] Running tests...'
    Invoke-Native -FilePath 'npm.cmd' -Arguments @('test')

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