const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoDir = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-patch-check-'));
const patchNames = ['current-direct-dev.patch', 'production-debug-harness.patch'];
const sourceFiles = [
  'main.js',
  'chatgpt-preload.js',
  'preload.js',
  'renderer/index.html',
  'renderer/app.js'
];

function copy(relativePath) {
  const source = path.join(repoDir, relativePath);
  const target = path.join(tempDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function run(command, args, cwd = tempDir) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
}

function fail(message, result) {
  const detail = String(result?.stderr || result?.stdout || '').trim();
  console.error(`[patch application smoke] ${message}`);
  if (detail) console.error(detail);
  process.exitCode = 1;
}

try {
  sourceFiles.forEach(copy);

  for (const patchName of patchNames) {
    const patchPath = path.join(repoDir, 'patches', patchName);
    if (!fs.existsSync(patchPath)) {
      fail(`missing patch: ${patchName}`);
      break;
    }

    const parse = run('git', ['apply', '--numstat', patchPath]);
    if (parse.status !== 0) {
      fail(`invalid unified diff: ${patchName}`, parse);
      break;
    }

    const check = run('git', ['apply', '--check', '--recount', patchPath]);
    if (check.status !== 0) {
      fail(`patch does not apply cleanly after previous patches: ${patchName}`, check);
      break;
    }

    const apply = run('git', ['apply', '--recount', patchPath]);
    if (apply.status !== 0) {
      fail(`could not apply patch: ${patchName}`, apply);
      break;
    }
  }

  if (!process.exitCode) {
    for (const relativePath of ['main.js', 'chatgpt-preload.js', 'preload.js', 'renderer/app.js']) {
      const syntax = run(process.execPath, ['--check', path.join(tempDir, relativePath)], repoDir);
      if (syntax.status !== 0) {
        fail(`syntax check failed after patches: ${relativePath}`, syntax);
        break;
      }
    }
  }

  if (!process.exitCode) console.log('patch application smoke test: OK');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
