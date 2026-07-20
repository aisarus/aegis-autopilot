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
const helperFiles = [
  'scripts/prepare-testing-source.js',
  'scripts/prepare-autopilot-response.js'
];

function copyIntoTemp(relativePath) {
  const source = path.join(repoDir, relativePath);
  const target = path.join(tempDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function normalizeKnownSourceFormatting() {
  const rendererPath = path.join(tempDir, 'renderer/app.js');
  const source = fs.readFileSync(rendererPath, 'utf8');
  const normalized = source.replace(/\n[ \t]+(\$\('#summary'\)\.innerHTML=)/, '\n  $1');
  fs.writeFileSync(rendererPath, normalized, 'utf8');
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

function runHelper(relativePath, label) {
  const first = run(process.execPath, [relativePath]);
  if (first.status !== 0) {
    fail(`${label} failed; transaction aborted before touching the checkout`, first);
    return null;
  }
  const second = run(process.execPath, [relativePath]);
  if (second.status !== 0) {
    fail(`${label} idempotence check failed; checkout was not modified`, second);
    return null;
  }
  return first;
}

try {
  [...sourceFiles, ...helperFiles].forEach(copyIntoTemp);
  normalizeKnownSourceFormatting();

  const basePrepare = runHelper('scripts/prepare-testing-source.js', 'base source preparation');
  const responsePrepare = process.exitCode
    ? null
    : runHelper('scripts/prepare-autopilot-response.js', 'autopilot response preparation');

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
    for (const result of [basePrepare, responsePrepare]) {
      const output = [result?.stdout, result?.stderr].filter(Boolean).join('\n').trim();
      if (output) console.log(output);
    }
    console.log('[Aegis prepare] transaction committed');
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
