'use strict';

const assert = require('assert');
const { PublicationService } = require('../orchestrator/publication-service');

const project = {
  id: 'lamdan',
  repository: 'aisarus/syllabus-to-os',
  defaultBranch: 'main',
  nextTask: 'S3-003 cancellation'
};
const task = {
  projectId: 'lamdan',
  taskId: 's3-003',
  slug: 'cancellation',
  branch: 'agent/lamdan/s3-003-cancellation',
  baseSha: 'a'.repeat(40),
  workspacePath: '/task/worktree'
};
const changedFiles = ['src/file.js', 'tests/file.test.js'];
const agentResult = {
  status: 'ready_for_review',
  summary: 'Implemented cancellation propagation.',
  tests: ['typecheck: passed', 'focused cancellation tests: passed'],
  risks: ['Live provider cancellation remains externally unverified.'],
  changedFiles,
  verifications: [{ commandId: 'typecheck', code: 0, timedOut: false }]
};

function gitResult(overrides = {}) {
  return { code: 0, stdout: '', stderr: '', timedOut: false, truncated: false, error: '', ...overrides };
}

function emptyGithub() {
  return {
    async listPullRequests() { return []; },
    async getBranch() { return { commit: { sha: '0'.repeat(40) } }; },
    async createPullRequest() { throw new Error('must not create'); }
  };
}

(async () => {
  const gitCalls = [];
  const commitSha = 'b'.repeat(40);
  const git = {
    async runGit(args, options) {
      gitCalls.push({ args: args.slice(), options: { ...options } });
      const joined = args.join(' ');
      if (joined === 'branch --show-current') return gitResult({ stdout: `${task.branch}\n` });
      if (joined.startsWith('merge-base ')) return gitResult({ stdout: `${task.baseSha}\n` });
      if (joined.startsWith('status ')) return gitResult({ stdout: ' M src/file.js\0?? tests/file.test.js\0' });
      if (joined === 'add -- src/file.js tests/file.test.js') return gitResult();
      if (joined === 'diff --cached --name-only -z --') return gitResult({ stdout: 'src/file.js\0tests/file.test.js\0' });
      if (joined.startsWith('diff --cached --quiet')) return gitResult({ code: 1 });
      if (joined.includes(' commit -m ')) return gitResult({ stdout: '[agent commit]\n' });
      if (joined === 'rev-parse HEAD') return gitResult({ stdout: `${commitSha}\n` });
      if (joined === `diff --name-only -z ${task.baseSha}..${commitSha} --`) return gitResult({ stdout: 'src/file.js\0tests/file.test.js\0' });
      if (joined.startsWith('push --set-upstream')) return gitResult({ code: 1, stderr: 'network timeout' });
      throw new Error(`Unexpected git call: ${joined}`);
    }
  };

  let listCalls = 0;
  let createdInput = null;
  const github = {
    async listPullRequests() {
      listCalls += 1;
      if (listCalls >= 3) return [{ number: 84, html_url: 'https://example.test/pr/84', draft: true, head: { ref: task.branch } }];
      return [];
    },
    async getBranch(_repository, branch) {
      assert.equal(branch, task.branch);
      return { commit: { sha: commitSha } };
    },
    async createPullRequest(_repository, input) {
      createdInput = input;
      throw new Error('response lost after creation');
    }
  };

  const service = new PublicationService({ githubConnector: github, repositorySyncService: git });
  const published = await service.publish({ project, task, agentResult, githubToken: 'github-secret' });
  assert.equal(published.ok, true);
  assert.equal(published.commitSha, commitSha);
  assert.deepEqual(published.changedFiles, changedFiles);
  assert.equal(published.pullRequest.number, 84);
  assert.equal(published.pullRequest.draft, true);
  assert.equal(published.reusedPullRequest, false);
  assert.equal(createdInput.draft, true);
  assert.equal(createdInput.head, task.branch);
  assert.equal(createdInput.base, 'main');
  assert(createdInput.body.includes('typecheck: passed'));
  assert(createdInput.body.includes('`src/file.js`'));
  assert(createdInput.body.includes(task.baseSha));
  assert(createdInput.body.includes(commitSha));
  assert(gitCalls.some((entry) => entry.args[0] === 'add' && entry.args[1] === '--' && entry.args.slice(2).join(',') === changedFiles.join(',')));
  assert.equal(gitCalls.some((entry) => entry.args.includes('--all')), false, 'Publication must never stage all worktree files.');
  assert(gitCalls.some((entry) => entry.args[0] === 'push' && entry.options.githubToken === 'github-secret'));
  assert.equal(gitCalls.some((entry) => entry.args.includes('merge')), false, 'Publication must never merge.');

  const existingGitCalls = [];
  const existingGit = {
    async runGit(args, options) {
      existingGitCalls.push({ args, options });
      const joined = args.join(' ');
      if (joined === 'branch --show-current') return gitResult({ stdout: task.branch });
      if (joined.startsWith('merge-base ')) return gitResult({ stdout: task.baseSha });
      if (joined.startsWith('status ')) return gitResult({ stdout: '' });
      if (joined === 'rev-parse HEAD') return gitResult({ stdout: commitSha });
      if (joined === `diff --name-only -z ${task.baseSha}..${commitSha} --`) return gitResult({ stdout: 'src/file.js\0tests/file.test.js\0' });
      if (joined.startsWith('push ')) return gitResult();
      throw new Error(`Unexpected existing git call: ${joined}`);
    }
  };
  let existingCreateCalls = 0;
  const existingGithub = {
    async listPullRequests() {
      return [{ number: 85, url: 'https://example.test/pr/85', draft: true, head: { ref: task.branch } }];
    },
    async getBranch() { return { commit: { sha: commitSha } }; },
    async createPullRequest() { existingCreateCalls += 1; throw new Error('must not create'); }
  };
  const existingService = new PublicationService({ githubConnector: existingGithub, repositorySyncService: existingGit });
  const reused = await existingService.publish({ project, task, agentResult, githubToken: 'token' });
  assert.equal(reused.pullRequest.number, 85);
  assert.equal(reused.reusedPullRequest, true);
  assert.equal(existingCreateCalls, 0);
  assert.equal(existingGitCalls.some((entry) => entry.args.includes('commit')), false, 'Clean repeated publish must not create another commit.');

  await assert.rejects(
    () => service.publish({ project, task, agentResult: { ...agentResult, status: 'blocked' }, githubToken: 'x' }),
    (error) => error.code === 'RESULT_NOT_READY'
  );
  await assert.rejects(
    () => service.publish({ project, task, agentResult: { ...agentResult, verifications: [{ code: 2, timedOut: false }] }, githubToken: 'x' }),
    (error) => error.code === 'VERIFICATION_FAILED'
  );
  await assert.rejects(
    () => service.publish({ project, task, agentResult: { ...agentResult, changedFiles: [] }, githubToken: 'x' }),
    (error) => error.code === 'EMPTY_CHANGED_FILE_SET'
  );
  await assert.rejects(
    () => service.publish({ project, task: { ...task, branch: 'main' }, agentResult, githubToken: 'x' }),
    (error) => error.code === 'UNSAFE_BRANCH'
  );

  const noChangeGit = {
    async runGit(args) {
      const joined = args.join(' ');
      if (joined === 'branch --show-current') return gitResult({ stdout: task.branch });
      if (joined.startsWith('merge-base ')) return gitResult({ stdout: task.baseSha });
      if (joined.startsWith('status ')) return gitResult({ stdout: '' });
      if (joined === 'rev-parse HEAD') return gitResult({ stdout: task.baseSha });
      throw new Error(`Unexpected no-change git call: ${joined}`);
    }
  };
  const noChangeService = new PublicationService({ githubConnector: emptyGithub(), repositorySyncService: noChangeGit });
  await assert.rejects(
    () => noChangeService.publish({ project, task, agentResult, githubToken: 'x' }),
    (error) => error.code === 'EMPTY_CHANGES'
  );

  const undeclaredGit = {
    async runGit(args) {
      const joined = args.join(' ');
      if (joined === 'branch --show-current') return gitResult({ stdout: task.branch });
      if (joined.startsWith('merge-base ')) return gitResult({ stdout: task.baseSha });
      if (joined.startsWith('status ')) return gitResult({ stdout: ' M src/file.js\0?? tests/file.test.js\0?? dist/bundle.js\0' });
      throw new Error(`Unexpected undeclared git call: ${joined}`);
    }
  };
  const undeclaredService = new PublicationService({ githubConnector: emptyGithub(), repositorySyncService: undeclaredGit });
  await assert.rejects(
    () => undeclaredService.publish({ project, task, agentResult, githubToken: 'x' }),
    (error) => error.code === 'UNDECLARED_CHANGES' && error.details.undeclared.includes('dist/bundle.js')
  );

  const stagedMismatchGit = {
    async runGit(args) {
      const joined = args.join(' ');
      if (joined === 'branch --show-current') return gitResult({ stdout: task.branch });
      if (joined.startsWith('merge-base ')) return gitResult({ stdout: task.baseSha });
      if (joined.startsWith('status ')) return gitResult({ stdout: ' M src/file.js\0?? tests/file.test.js\0' });
      if (joined === 'add -- src/file.js tests/file.test.js') return gitResult();
      if (joined === 'diff --cached --name-only -z --') return gitResult({ stdout: 'src/file.js\0' });
      throw new Error(`Unexpected staged-mismatch git call: ${joined}`);
    }
  };
  const stagedMismatchService = new PublicationService({ githubConnector: emptyGithub(), repositorySyncService: stagedMismatchGit });
  await assert.rejects(
    () => stagedMismatchService.publish({ project, task, agentResult, githubToken: 'x' }),
    (error) => error.code === 'STAGED_PATH_MISMATCH' && error.details.missing.includes('tests/file.test.js')
  );

  console.log('Idempotent draft PR publication v2 smoke test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
