const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const testScript = String(packageJson.scripts?.test || '').trim();

if (!testScript) {
  console.error('[Aegis tests] package.json has no test script.');
  process.exit(1);
}

const commands = testScript
  .split(/\s*&&\s*/)
  .map((command) => command.trim())
  .filter(Boolean)
  .filter((command) => !/run-smoke-suite\.js/i.test(command));

if (!commands.length) {
  console.error('[Aegis tests] No smoke-test commands were discovered.');
  process.exit(1);
}

const failures = [];
for (const command of commands) {
  console.log(`\n[Aegis tests] ${command}`);
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    stdio: 'inherit',
    env: process.env
  });
  if (result.error || result.status !== 0) {
    failures.push({
      command,
      status: Number.isInteger(result.status) ? result.status : 1,
      error: result.error?.message || ''
    });
  }
}

console.log('\n[Aegis tests] Summary');
console.log(`[Aegis tests] Passed: ${commands.length - failures.length}/${commands.length}`);
if (failures.length) {
  for (const failure of failures) {
    console.error(`[Aegis tests] FAILED (${failure.status}): ${failure.command}${failure.error ? ` — ${failure.error}` : ''}`);
  }
  process.exit(1);
}

console.log('[Aegis tests] All smoke tests passed.');