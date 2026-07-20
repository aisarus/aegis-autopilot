const { spawnSync } = require('child_process');
const path = require('path');

const repoDir = path.resolve(__dirname, '..');
const patchPath = path.join(repoDir, 'patches', 'current-direct-dev.patch');

function gitApply(extraArgs) {
  return spawnSync('git', ['-C', repoDir, 'apply', '--recount', ...extraArgs, patchPath], {
    cwd: repoDir,
    encoding: 'utf8',
    windowsHide: true
  });
}

const canApply = gitApply(['--check']);
if (canApply.status === 0) {
  const applied = gitApply([]);
  if (applied.status !== 0) {
    console.error('[Aegis] Current patch could not be applied.');
    console.error(applied.stderr || applied.stdout || 'Unknown git apply error.');
    process.exit(applied.status || 1);
  }
  console.log('[Aegis] Current ChatGPT native-send patch applied.');
  process.exit(0);
}

const alreadyApplied = gitApply(['--reverse', '--check']);
if (alreadyApplied.status === 0) {
  console.log('[Aegis] Current ChatGPT native-send patch is already applied.');
  process.exit(0);
}

console.error('[Aegis] Current patch does not match this checkout.');
console.error(canApply.stderr || canApply.stdout || alreadyApplied.stderr || alreadyApplied.stdout || 'Unknown git apply error.');
process.exit(1);
