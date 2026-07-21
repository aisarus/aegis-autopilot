const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  assert(a, `invalid package version: ${left}`);
  assert(b, `invalid comparison version: ${right}`);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const main = fs.readFileSync('main.js', 'utf8');
const chatPreload = fs.readFileSync('chatgpt-preload.js', 'utf8');
const preload = fs.readFileSync('preload.js', 'utf8');
const renderer = fs.readFileSync('renderer/app.js', 'utf8');
const html = fs.readFileSync('renderer/index.html', 'utf8');
const updater = fs.readFileSync('AEGIS-UPDATE-AND-RUN.cmd', 'utf8');
const collector = fs.readFileSync('AEGIS-COLLECT-DEBUG.cmd', 'utf8');
const devCommand = fs.readFileSync('dev.cmd', 'utf8');
const devWatch = fs.readFileSync('scripts/dev-watch.ps1', 'utf8');
const prepare = fs.readFileSync('scripts/prepare-testing-source.js', 'utf8');
const atomicPrepare = fs.readFileSync('scripts/prepare-testing-source-atomic.js', 'utf8');
const doctor = fs.readFileSync('scripts/doctor.js', 'utf8');
const bundle = fs.readFileSync('scripts/create-debug-bundle.js', 'utf8');
const runtimePathspecs = ['main.js', 'preload.js', 'chatgpt-preload.js', 'package.json', 'package-lock.json', 'adapters', 'lib', 'renderer'];
const runtimePathspecText = runtimePathspecs.join(' ');

assert.strictEqual(pkg.version, lock.packages?.['']?.version || lock.version, 'package and lockfile versions must match');
const legacyVersionPath = 'patches/runtime-version.txt';
if (fs.existsSync(legacyVersionPath)) {
  const legacyVersion = fs.readFileSync(legacyVersionPath, 'utf8').trim();
  assert(compareVersions(pkg.version, legacyVersion) > 0, `direct-source version ${pkg.version} must be newer than legacy runtime ${legacyVersion}`);
}
assert(!pkg.scripts.prepare, 'npm lifecycle hook prepare must stay unused');
assert(!pkg.scripts['patch:current'], 'legacy patch:current script must be removed');
assert(!pkg.scripts['patch:check'], 'legacy patch:check script must be removed');
assert.strictEqual(pkg.scripts['source:prepare'], 'node scripts/prepare-testing-source-atomic.js', 'source:prepare must use the transactional wrapper');
assert.strictEqual(pkg.scripts['doctor:prepared'], 'node scripts/doctor.js', 'doctor:prepared must run only the prepared-source doctor');
assert.strictEqual(pkg.scripts.doctor, 'npm run source:prepare && npm run doctor:prepared', 'direct npm run doctor must prepare source first');
assert(pkg.scripts['test:prepared'].includes('tests/production-workflow-smoke.js'), 'test:prepared must include the production workflow regression gate');
assert.strictEqual(pkg.scripts.test, 'npm run source:prepare && npm run test:prepared', 'direct npm test must prepare source first');
assert.strictEqual(pkg.scripts.verify, 'npm run source:prepare && npm run doctor:prepared && npm run test:prepared', 'verify must prepare once and run only prepared checks');
assert.strictEqual(pkg.scripts.prestart, 'npm run source:prepare && node scripts/stop-old-aegis.js', 'npm start must prepare source before launch');
assert.strictEqual(pkg.scripts.predev, 'npm run source:prepare', 'npm run dev must prepare source before launch');
assert.strictEqual(pkg.scripts['predev:once'], 'npm run source:prepare', 'npm run dev:once must not bypass source preparation');
assert.strictEqual(pkg.scripts['predist:win'], 'npm run verify', 'Windows installer builds must verify and prepare source first');
assert.strictEqual(pkg.scripts['prepack:win'], 'npm run verify', 'Windows directory builds must verify and prepare source first');
assert(devCommand.includes('npm.cmd ci'), 'dev.cmd must install locked dependencies');
assert(devCommand.includes('npm.cmd run source:prepare'), 'dev.cmd must prepare source before file watchers are registered');
assert(devWatch.includes('npm.cmd run dev:once'), 'dev watch must restart through the prepared npm entrypoint');
assert(!devWatch.includes('npx electron .'), 'dev watch must not launch raw Electron directly');
assert(prepare.includes('expected source anchor was not found'), 'source preparation must fail with a named missing anchor');
assert(prepare.includes('source anchor is ambiguous'), 'source preparation must reject ambiguous replacements');
assert(atomicPrepare.includes('mkdtempSync'), 'transactional wrapper must use an isolated temporary checkout');
assert(atomicPrepare.includes('checkout was not modified'), 'transactional wrapper must report safe aborts');
assert(atomicPrepare.includes('current.equals(prepared)'), 'transactional wrapper must not rewrite identical prepared files');
assert(main.includes("ipcMain.handle('aegis:test-send'"), 'main process must expose isolated send test');
assert(main.includes("ipcMain.handle('aegis-chat:native-editor'"), 'main process must expose native editor bridge');
assert(main.includes("kind: 'AEGIS_SEND_TEST'"), 'send test must produce a typed diagnostic report');
assert(main.includes('buildId: BUILD_ID'), 'send report must include exact build id');
assert(chatPreload.includes("nativeEditor('insert-text'"), 'ChatGPT preload must use native Electron insertion');
assert(preload.includes('testSend:'), 'renderer bridge must expose testSend');
assert(html.includes('id="test-send"'), 'control panel must show the test-send button');
assert(renderer.includes("call('testSend')"), 'test-send button must invoke the isolated harness');
assert(updater.includes('npm.cmd ci'), 'one-click updater must install from the lockfile');
assert(updater.includes('npm.cmd run verify'), 'one-click updater must pass the full verification gate');
const resetIndex = updater.indexOf('git reset --hard origin/testing');
const cleanCommand = `git clean -fd -- ${runtimePathspecText}`;
const statusCommand = `git status --porcelain --untracked-files^=normal -- ${runtimePathspecText}`;
const cleanIndex = updater.indexOf(cleanCommand);
const cleanlinessCheckIndex = updater.indexOf(statusCommand);
assert(resetIndex >= 0, 'one-click updater must hard-reset tracked files');
assert(cleanIndex > resetIndex, 'one-click updater must remove stale untracked runtime files after reset');
assert(cleanlinessCheckIndex > cleanIndex, 'one-click updater must verify runtime paths after removing stale files');
assert(!updater.includes('git clean -fd -- .'), 'one-click updater must not delete unrelated untracked repository files');
assert(!updater.includes('git clean -fdx'), 'one-click updater must preserve ignored local files such as .env');
assert(!collector.includes('patch:current'), 'debug collection must never modify or prepare the checkout');
assert(doctor.includes('[Aegis doctor] OK'), 'local doctor must remain available');
assert(bundle.includes('# Aegis debug bundle'), 'debug bundle generator must remain available');

const cleanFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-clean-fixture-'));
try {
  assert.strictEqual(spawnSync('git', ['init'], { cwd: cleanFixture, encoding: 'utf8', windowsHide: true }).status, 0, 'clean fixture git init failed');
  fs.writeFileSync(path.join(cleanFixture, '.gitignore'), 'preserved.env\n', 'utf8');
  assert.strictEqual(spawnSync('git', ['add', '.gitignore'], { cwd: cleanFixture, encoding: 'utf8', windowsHide: true }).status, 0, 'clean fixture git add failed');
  fs.mkdirSync(path.join(cleanFixture, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(cleanFixture, 'lib', 'stale-runtime.js'), 'stale', 'utf8');
  fs.writeFileSync(path.join(cleanFixture, 'notes.txt'), 'unrelated user note', 'utf8');
  fs.writeFileSync(path.join(cleanFixture, 'preserved.env'), 'local secret placeholder', 'utf8');
  const cleaned = spawnSync('git', ['clean', '-fd', '--', ...runtimePathspecs], { cwd: cleanFixture, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(cleaned.status, 0, `git clean fixture failed:\n${cleaned.stdout || ''}\n${cleaned.stderr || ''}`);
  assert(!fs.existsSync(path.join(cleanFixture, 'lib', 'stale-runtime.js')), 'scoped git clean must remove stale untracked runtime files');
  assert(fs.existsSync(path.join(cleanFixture, 'notes.txt')), 'scoped git clean must preserve unrelated untracked files');
  assert(fs.existsSync(path.join(cleanFixture, 'preserved.env')), 'git clean without -x must preserve ignored local files');
  const runtimeStatus = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal', '--', ...runtimePathspecs], { cwd: cleanFixture, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(runtimeStatus.status, 0, `runtime status fixture failed:\n${runtimeStatus.stdout || ''}\n${runtimeStatus.stderr || ''}`);
  assert.strictEqual((runtimeStatus.stdout || '').trim(), '', 'runtime pathspecs must be clean after scoped cleanup');
} finally {
  fs.rmSync(cleanFixture, { recursive: true, force: true });
}

const preparedFiles = ['main.js', 'chatgpt-preload.js', 'preload.js', 'lib/supervisor-policy.js', 'lib/navigation-policy.js', 'renderer/index.html', 'renderer/app.js'];
const mtimesBefore = new Map(preparedFiles.map((file) => [file, fs.statSync(file, { bigint: true }).mtimeNs]));
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
const secondPass = spawnSync(process.execPath, ['scripts/prepare-testing-source-atomic.js'], { encoding: 'utf8', windowsHide: true });
assert.strictEqual(secondPass.status, 0, `transactional preparation must be idempotent:\n${secondPass.stdout || ''}\n${secondPass.stderr || ''}`);
assert.match(secondPass.stdout || '', /0 file\(s\) updated/, 'idempotent preparation must report zero checkout writes');
for (const file of preparedFiles) {
  assert.strictEqual(fs.statSync(file, { bigint: true }).mtimeNs, mtimesBefore.get(file), `idempotent preparation rewrote ${file}`);
}

console.log('production workflow smoke test: OK');
