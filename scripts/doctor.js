const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoDir = path.resolve(__dirname, '..');
const failures = [];
const notes = [];

function run(command, args) {
  return spawnSync(command, args, { cwd: repoDir, encoding: 'utf8', windowsHide: true });
}

function requireFile(relativePath) {
  const absolutePath = path.join(repoDir, relativePath);
  if (!fs.existsSync(absolutePath)) failures.push(`Missing required file: ${relativePath}`);
  return absolutePath;
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

const packagePath = requireFile('package.json');
const lockPath = requireFile('package-lock.json');
[
  'main.js',
  'preload.js',
  'chatgpt-preload.js',
  'renderer/index.html',
  'renderer/app.js',
  'scripts/prepare-testing-source.js',
  'scripts/prepare-testing-source-atomic.js',
  'scripts/create-debug-bundle.js',
  'scripts/stop-old-aegis.js',
  'tests/production-workflow-smoke.js',
  'AEGIS-UPDATE-AND-RUN.cmd',
  'AEGIS-COLLECT-DEBUG.cmd'
].forEach(requireFile);

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) failures.push(`Node.js 22+ required; found ${process.versions.node}`);

if (fs.existsSync(packagePath) && fs.existsSync(lockPath)) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const lockVersion = lock.packages?.['']?.version || lock.version;
  if (pkg.version !== lockVersion) failures.push(`package.json version ${pkg.version} does not match package-lock ${lockVersion}`);
  if (!parseVersion(pkg.version)) failures.push(`package version must be numeric semver; found ${pkg.version}`);
  const legacyVersionPath = path.join(repoDir, 'patches', 'runtime-version.txt');
  if (fs.existsSync(legacyVersionPath)) {
    const legacyVersion = fs.readFileSync(legacyVersionPath, 'utf8').trim();
    const order = compareVersions(pkg.version, legacyVersion);
    if (order === null) failures.push(`cannot compare package version ${pkg.version} with legacy runtime ${legacyVersion}`);
    else if (order <= 0) failures.push(`direct-source version ${pkg.version} must be newer than legacy runtime ${legacyVersion}`);
  }
  if (pkg.scripts?.prepare) failures.push('npm lifecycle script "prepare" must stay unused');
  if (pkg.scripts?.['patch:current'] || pkg.scripts?.['patch:check']) failures.push('legacy patch-on-start scripts are still registered');
  if (pkg.scripts?.['source:prepare'] !== 'node scripts/prepare-testing-source-atomic.js') failures.push('source:prepare must use the transactional source wrapper');
  if (!String(pkg.scripts?.verify || '').startsWith('npm run source:prepare')) failures.push('verify must start with explicit transactional source preparation');
  notes.push(`Aegis ${pkg.version}`);
}

const sha = run('git', ['rev-parse', '--short=12', 'HEAD']);
if (sha.status === 0) notes.push(`commit ${sha.stdout.trim()}`);
else failures.push(`git rev-parse failed: ${(sha.stderr || sha.stdout).trim()}`);

for (const file of [
  'main.js',
  'preload.js',
  'chatgpt-preload.js',
  'renderer/app.js',
  'scripts/prepare-testing-source.js',
  'scripts/prepare-testing-source-atomic.js',
  'scripts/create-debug-bundle.js',
  'scripts/stop-old-aegis.js',
  'tests/production-workflow-smoke.js'
]) {
  const checked = run(process.execPath, ['--check', file]);
  if (checked.status !== 0) failures.push(`Syntax check failed for ${file}: ${(checked.stderr || checked.stdout).trim()}`);
}

const requiredMarkers = [
  ['main.js', "ipcMain.handle('aegis-chat:native-editor'"],
  ['main.js', "ipcMain.handle('aegis:test-send'"],
  ['chatgpt-preload.js', "nativeEditor('insert-text'"],
  ['chatgpt-preload.js', "return 'native-enter'"],
  ['preload.js', 'testSend:'],
  ['renderer/index.html', 'id="test-send"'],
  ['renderer/app.js', "call('testSend')"]
];
for (const [relativePath, marker] of requiredMarkers) {
  const absolutePath = path.join(repoDir, relativePath);
  if (fs.existsSync(absolutePath) && !fs.readFileSync(absolutePath, 'utf8').includes(marker)) {
    failures.push(`Prepared source marker missing in ${relativePath}: ${marker}`);
  }
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
