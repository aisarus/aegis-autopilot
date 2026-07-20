const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoDir = path.resolve(__dirname, '..');
const failures = [];
const notes = [];
const warnings = [];

function run(command, args) {
  return spawnSync(command, args, { cwd: repoDir, encoding: 'utf8', windowsHide: true });
}

function requireFile(relativePath) {
  const absolutePath = path.join(repoDir, relativePath);
  if (!fs.existsSync(absolutePath)) failures.push(`Missing required file: ${relativePath}`);
  return absolutePath;
}

const packagePath = requireFile('package.json');
const lockPath = requireFile('package-lock.json');
[
  'main.js',
  'preload.js',
  'chatgpt-preload.js',
  'renderer/index.html',
  'renderer/app.js',
  'patches/current-direct-dev.patch',
  'patches/production-debug-harness.patch',
  'AEGIS-UPDATE-AND-RUN.cmd',
  'AEGIS-COLLECT-DEBUG.cmd'
].forEach(requireFile);

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) failures.push(`Node.js 22+ required; found ${process.versions.node}`);

if (fs.existsSync(packagePath) && fs.existsSync(lockPath)) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const lockVersion = lock.packages?.['']?.version || lock.version;
  if (pkg.version !== lockVersion) warnings.push(`package metadata version is ${pkg.version}; lock metadata still says ${lockVersion}`);
  notes.push(`Aegis ${pkg.version}`);
}

const sha = run('git', ['rev-parse', '--short=12', 'HEAD']);
if (sha.status === 0) notes.push(`commit ${sha.stdout.trim()}`);
else failures.push(`git rev-parse failed: ${(sha.stderr || sha.stdout).trim()}`);

for (const file of ['main.js', 'preload.js', 'chatgpt-preload.js', 'renderer/app.js', 'scripts/apply-current-patch.js', 'scripts/create-debug-bundle.js']) {
  const checked = run(process.execPath, ['--check', file]);
  if (checked.status !== 0) failures.push(`Syntax check failed for ${file}: ${(checked.stderr || checked.stdout).trim()}`);
}

const diffCheck = run('git', ['diff', '--check']);
if (diffCheck.status !== 0) failures.push(`git diff --check failed: ${(diffCheck.stderr || diffCheck.stdout).trim()}`);

if (failures.length) {
  console.error('[Aegis doctor] FAILED');
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log(`[Aegis doctor] OK — ${notes.join(' · ')}`);
console.log(`[Aegis doctor] Node ${process.versions.node} · ${process.platform} ${process.arch}`);
warnings.forEach((warning) => console.warn(`[Aegis doctor] warning: ${warning}`));
