$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Start-Aegis {
  Write-Host "[Aegis] Starting Electron from source..." -ForegroundColor Cyan
  return Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx electron ." -WorkingDirectory $root -PassThru
}

$watchPaths = @(
  (Join-Path $root 'main.js'),
  (Join-Path $root 'preload.js'),
  (Join-Path $root 'chatgpt-preload.js'),
  (Join-Path $root 'renderer'),
  (Join-Path $root 'adapters')
)

$lastChange = Get-Date '2000-01-01'
$restartRequested = $false
$watchers = @()

foreach ($path in $watchPaths) {
  if (-not (Test-Path $path)) { continue }
  $item = Get-Item $path
  $watcher = New-Object System.IO.FileSystemWatcher
  if ($item.PSIsContainer) {
    $watcher.Path = $item.FullName
    $watcher.Filter = '*.*'
    $watcher.IncludeSubdirectories = $true
  } else {
    $watcher.Path = $item.DirectoryName
    $watcher.Filter = $item.Name
    $watcher.IncludeSubdirectories = $false
  }
  $watcher.NotifyFilter = [IO.NotifyFilters]'FileName, LastWrite, Size'
  $watcher.EnableRaisingEvents = $true
  foreach ($eventName in @('Changed', 'Created', 'Deleted', 'Renamed')) {
    Register-ObjectEvent $watcher $eventName -Action {
      $global:restartRequested = $true
      $global:lastChange = Get-Date
    } | Out-Null
  }
  $watchers += $watcher
}

$process = Start-Aegis
Write-Host "[Aegis] Watching source files. Ctrl+C stops dev mode." -ForegroundColor Green

try {
  while ($true) {
    Start-Sleep -Milliseconds 350
    if ($process.HasExited) {
      $process = Start-Aegis
      continue
    }
    if ($global:restartRequested -and ((Get-Date) - $global:lastChange).TotalMilliseconds -ge 700) {
      $global:restartRequested = $false
      Write-Host "[Aegis] Source changed; restarting Electron..." -ForegroundColor Yellow
      try { taskkill /PID $process.Id /T /F | Out-Null } catch {}
      Start-Sleep -Milliseconds 250
      $process = Start-Aegis
    }
  }
}
finally {
  try { taskkill /PID $process.Id /T /F | Out-Null } catch {}
  Get-EventSubscriber | Unregister-Event -Force -ErrorAction SilentlyContinue
  foreach ($watcher in $watchers) { $watcher.Dispose() }
}
