const { spawnSync } = require('child_process');

if (process.platform !== 'win32') process.exit(0);

spawnSync('taskkill', ['/F', '/IM', 'Aegis.exe'], {
  stdio: 'ignore',
  windowsHide: true
});

const command = [
  "$targets = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {",
  "  $_.Name -ieq 'electron.exe' -and [string]$_.CommandLine -match '(?i)(aegis-autopilot|AegisAutopilot|aegis-chatgpt-client)'",
  '};',
  '$targets | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
].join(' ');

spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
  stdio: 'ignore',
  windowsHide: true
});

console.log('[Aegis] Previous installed and development processes were closed.');
