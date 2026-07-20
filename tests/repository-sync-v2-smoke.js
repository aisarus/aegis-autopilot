'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runProcess } = require('../orchestrator/worktree-service');
const {
  RepositorySyncService,
  assertBranchName,
  buildGitAuthEnvironment
} = require('../orchestrator/repository-sync-service');

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return String(result.stdout || '').trim();
}

(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'aegis-sync-'));
  const source = path.join(temp, 'source');
  const remote = path.join(temp, 'remote.git');
  const root = path.join(temp, 'aegis-root');
  await fsp.mkdir(source, { recursive: true });
  git(source, 'init');
  git(source, 'config', 'user.email', 'aegis@example.invalid');
  git(source, 'config', 'user.name', 'Aegis Test');
  await fsp.writeFile(path.join(source, 'README.md'), '# One\n', 'utf8');
  git(source, 'add', 'README.md');
  git(source, 'commit', '-m', 'one');
  git(source, 'branch', '-M', 'main');
  git(temp, 'clone', '--bare', source, remote);

  const calls = [];
  const processRunner = async (executable, args, options) => {
    calls.push({ executable, args: args.slice(), env: { ...options.env } });
    return runProcess(executable, args, options);
  };
  const secret = 'github-secret-token';
  const service = new RepositorySyncService({
    rootDir: root,
    processRunner,
    remoteUrlResolver: () => remote
  });

  const first = await service.syncProject({
    projectId: 'demo',
    repository: 'owner/demo',
    defaultBranch: 'main',
    githubToken: secret
  });
  assert.equal(first.repository, 'owner/demo');
  assert.equal(fs.existsSync(path.join(first.repositoryPath, '.git')), true);
  assert.equal(first.baseSha, git(source, 'rev-parse', 'HEAD'));
  assert.equal(git(first.repositoryPath, 'remote', 'get-url', 'origin'), remote);

  await fsp.writeFile(path.join(source, 'README.md'), '# Two\n', 'utf8');
  git(source, 'add', 'README.md');
  git(source, 'commit', '-m', 'two');
  git(source, 'push', remote, 'main');
  const second = await service.syncProject({
    projectId: 'demo',
    repository: 'owner/demo',
    defaultBranch: 'main',
    githubToken: secret
  });
  assert.notEqual(second.baseSha, first.baseSha);
  assert.equal(second.baseSha, git(source, 'rev-parse', 'HEAD'));

  assert(calls.some((entry) => entry.args.includes('fetch')));
  for (const entry of calls) {
    assert.equal(JSON.stringify(entry.args).includes(secret), false, 'Git token leaked into process arguments.');
  }
  const authenticatedCall = calls.find((entry) => entry.env.GIT_CONFIG_VALUE_0);
  assert(authenticatedCall, 'Git authentication environment was not installed.');
  assert.equal(authenticatedCall.env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.equal(authenticatedCall.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(authenticatedCall.env.GIT_CONFIG_VALUE_0.includes(secret), false, 'Raw token leaked into Git config environment.');

  const auth = buildGitAuthEnvironment(secret, { PATH: process.env.PATH });
  assert.equal(auth.GIT_CONFIG_COUNT, '1');
  assert.equal(auth.GIT_CONFIG_VALUE_0.includes(secret), false);
  assert.throws(() => assertBranchName('../main'), /Invalid Git branch/);
  assert.throws(() => assertBranchName('bad branch'), /Invalid Git branch/);
  await assert.rejects(
    () => service.syncProject({ projectId: 'bad', repository: '../unsafe', defaultBranch: 'main' }),
    /Invalid GitHub repository/
  );

  const occupiedPath = service.repositoryPath('occupied');
  await fsp.mkdir(occupiedPath, { recursive: true });
  await fsp.writeFile(path.join(occupiedPath, 'file.txt'), 'not git', 'utf8');
  await assert.rejects(
    () => service.syncProject({ projectId: 'occupied', repository: 'owner/occupied', defaultBranch: 'main' }),
    /not a Git repository/
  );

  await fsp.rm(temp, { recursive: true, force: true });
  console.log('Credential-safe repository sync v2 smoke test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
