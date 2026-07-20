const { spawnSync } = require('child_process');
const path = require('path');

const repoDir = path.resolve(__dirname, '..');
const patchNames = [
  'current-direct-dev.patch',
  'production-debug-harness.patch'
];

function gitApply(patchPath, extraArgs) {
  return spawnSync('git', ['-C', repoDir, 'apply', '--recount', ...extraArgs, patchPath], {
    cwd: repoDir,
    encoding: 'utf8',
    windowsHide: true
  });
}

for (const patchName of patchNames) {
  const patchPath = path.join(repoDir, 'patches', patchName);
  const canApply = gitApply(patchPath, ['--check']);
  if (canApply.status === 0) {
    const applied = gitApply(patchPath, []);
    if (applied.status !== 0) {
      console.error(`[Aegis] Patch could not be applied: ${patchName}`);
      console.error(applied.stderr || applied.stdout || 'Unknown git apply error.');
      process.exit(applied.status || 1);
    }
    console.log(`[Aegis] Applied: ${patchName}`);
    continue;
  }

  const alreadyApplied = gitApply(patchPath, ['--reverse', '--check']);
  if (alreadyApplied.status === 0) {
    console.log(`[Aegis] Already applied: ${patchName}`);
    continue;
  }

  console.error(`[Aegis] Patch does not match this checkout: ${patchName}`);
  console.error(canApply.stderr || canApply.stdout || alreadyApplied.stderr || alreadyApplied.stdout || 'Unknown git apply error.');
  process.exit(1);
}

console.log(`[Aegis] Development source prepared with ${patchNames.length} ordered patch(es).`);
