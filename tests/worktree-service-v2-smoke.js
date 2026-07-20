'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { WorktreeService } = require('../orchestrator/worktree-service');

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return String(result.stdout || '').trim();
}

(async () => {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aegis-worktrees-'));
  const secret = 'never-print-this-token';
  const service = new WorktreeService({
    rootDir,
    secrets: [secret],
    defaultTimeoutMs: 3000,
    maxOutputBytes: 4096,
    commandPolicy: {
      pass: { executable: process.execPath, args: ['-e', "console.log('verification-pass')"] },
      fail: { executable: process.execPath, args: ['-e', "console.error('verification-fail');process.exit(3)"] },
      timeout: { executable: process.execPath, args: ['-e', 'setTimeout(()=>{},2000)'], timeoutMs: 100 },
      redact: { executable: process.execPath, args: ['-e', `console.log('${secret}')`] },
      bounded: { executable: process.execPath, args: ['-e', "console.log('x'.repeat(10000))"], maxOutputBytes: 128 }
    }
  });

  await service.ensureRoot();
  const repositoryPath = service.repositoryPath('demo');
  await fsp.mkdir(repositoryPath, { recursive: true });
  git(repositoryPath, 'init');
  git(repositoryPath, 'config', 'user.email', 'aegis@example.invalid');
  git(repositoryPath, 'config', 'user.name', 'Aegis Test');
  await fsp.writeFile(path.join(repositoryPath, 'README.md'), '# Demo\n', 'utf8');
  git(repositoryPath, 'add', 'README.md');
  git(repositoryPath, 'commit', '-m', 'initial');
  const baseSha = git(repositoryPath, 'rev-parse', 'HEAD');

  const task = await service.prepareTask({
    projectId: 'demo',
    taskId: 'v2-004',
    slug: 'confined-tools',
    baseSha
  });
  assert.equal(task.branch, 'agent/demo/v2-004-confined-tools');
  assert.equal(fs.existsSync(task.workspacePath), true);

  await service.writeFile(task, 'README.md', '# Demo\n\nChanged by agent.\n');
  await service.writeFile(task, 'src/example.txt', 'hello worktree\n');
  assert.equal((await service.readFile(task, 'src/example.txt')).text, 'hello worktree\n');

  const status = await service.status(task);
  assert(status.some((line) => line.includes('README.md')));
  assert(status.some((line) => line.includes('src/example.txt')));
  const diff = await service.diff(task);
  assert(diff.text.includes('Changed by agent.'));

  const pass = await service.runVerification(task, 'pass');
  assert.equal(pass.code, 0);
  assert(pass.stdout.includes('verification-pass'));

  const fail = await service.runVerification(task, 'fail');
  assert.equal(fail.code, 3);
  assert(fail.stderr.includes('verification-fail'));

  const timeout = await service.runVerification(task, 'timeout');
  assert.equal(timeout.timedOut, true);

  const redacted = await service.runVerification(task, 'redact');
  assert.equal(redacted.stdout.includes(secret), false);
  assert(redacted.stdout.includes('[REDACTED]'));

  const bounded = await service.runVerification(task, 'bounded');
  assert.equal(bounded.truncated, true);
  assert(bounded.stdout.length <= 128);

  await assert.rejects(() => service.writeFile(task, '../outside.txt', 'no'), /Unsafe workspace path|escapes/);
  await assert.rejects(() => service.readFile(task, '../outside.txt'), /Unsafe workspace path|escapes/);
  await assert.rejects(() => service.runVerification(task, 'not-allowed'), /not allowlisted/);

  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'aegis-outside-'));
  const link = path.join(task.workspacePath, 'escape-link');
  let symlinkCreated = false;
  try {
    await fsp.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    symlinkCreated = true;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) throw error;
  }
  if (symlinkCreated) {
    await assert.rejects(() => service.writeFile(task, 'escape-link/pwned.txt', 'no'), /Symlink escapes/);
    assert.equal(fs.existsSync(path.join(outside, 'pwned.txt')), false);
  }

  await service.cleanupTask(task);
  assert.equal(fs.existsSync(task.workspacePath), false);
  await fsp.rm(rootDir, { recursive: true, force: true });
  await fsp.rm(outside, { recursive: true, force: true });

  console.log('Confined worktree service v2 smoke test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
