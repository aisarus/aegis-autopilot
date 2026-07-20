const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoDir = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-prepare-'));
const sourceFiles = [
  'main.js',
  'chatgpt-preload.js',
  'preload.js',
  'renderer/index.html',
  'renderer/app.js'
];
const helperFiles = ['scripts/prepare-testing-source.js'];

function copyIntoTemp(relativePath) {
  const source = path.join(repoDir, relativePath);
  const target = path.join(tempDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function run(command, args, cwd = tempDir) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
}

function fail(label, result) {
  const output = [result?.stdout, result?.stderr].filter(Boolean).join('\n').trim();
  console.error(`[Aegis prepare] ${label}`);
  if (output) console.error(output);
  process.exitCode = result?.status || 1;
}

try {
  [...sourceFiles, ...helperFiles].forEach(copyIntoTemp);

  const prepare = run(process.execPath, ['scripts/prepare-testing-source.js']);
  if (prepare.status !== 0) {
    fail('transaction aborted before touching the checkout', prepare);
  } else {
    const secondPass = run(process.execPath, ['scripts/prepare-testing-source.js']);
    if (secondPass.status !== 0) {
      fail('idempotence check failed; checkout was not modified', secondPass);
    }
  }

  if (!process.exitCode) {
    for (const relativePath of ['main.js', 'chatgpt-preload.js', 'preload.js', 'renderer/app.js']) {
      const syntax = run(process.execPath, ['--check', relativePath]);
      if (syntax.status !== 0) {
        fail(`syntax check failed for prepared ${relativePath}; checkout was not modified`, syntax);
        break;
      }
    }
  }

  if (!process.exitCode) {
    for (const relativePath of sourceFiles) {
      const prepared = path.join(tempDir, relativePath);
      const destination = path.join(repoDir, relativePath);
      fs.copyFileSync(prepared, destination);
    }
    const output = [prepare.stdout, prepare.stderr].filter(Boolean).join('\n').trim();
    if (output) console.log(output);
    console.log('[Aegis prepare] transaction committed');
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
