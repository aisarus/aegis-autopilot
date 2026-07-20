'use strict';

const { assertRelativePath } = require('./agent-tools');
const { assertBranchName } = require('./repository-sync-service');

class PublicationError extends Error {
  constructor(message, code = 'PUBLICATION_ERROR', details = {}) {
    super(message);
    this.name = 'PublicationError';
    this.code = code;
    this.details = details;
  }
}

function compact(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeChangedFiles(result) {
  const files = Array.isArray(result?.changedFiles) ? result.changedFiles : [];
  const normalized = [...new Set(files.map((filePath) => assertRelativePath(filePath)))].sort();
  if (!normalized.length) {
    throw new PublicationError('Agent result does not declare any changed files.', 'EMPTY_CHANGED_FILE_SET');
  }
  return normalized;
}

function validateReadyResult(result) {
  if (!result || result.status !== 'ready_for_review') {
    throw new PublicationError('Only ready_for_review agent results may be published.', 'RESULT_NOT_READY');
  }
  const verifications = Array.isArray(result.verifications) ? result.verifications : [];
  if (!verifications.length || verifications.some((entry) => Number(entry.code) !== 0 || entry.timedOut)) {
    throw new PublicationError('All recorded verification commands must pass before publication.', 'VERIFICATION_FAILED');
  }
  return { verifications, changedFiles: normalizeChangedFiles(result) };
}

function assertAgentBranch(branch, projectId) {
  const value = assertBranchName(branch);
  const prefix = `agent/${String(projectId || '').trim().toLowerCase()}/`;
  if (!value.startsWith(prefix) || value === prefix) {
    throw new PublicationError(`Refusing to publish a non-agent branch: ${value}.`, 'UNSAFE_BRANCH');
  }
  return value;
}

function parseNulPaths(value) {
  return String(value || '').split('\0').filter(Boolean);
}

function parsePorcelainStatus(value) {
  const records = parseNulPaths(value);
  return records.map((record) => {
    if (record.length < 4 || record[2] !== ' ') {
      throw new PublicationError('Git returned an invalid porcelain status record.', 'INVALID_GIT_STATUS');
    }
    const status = record.slice(0, 2);
    const filePath = assertRelativePath(record.slice(3));
    if (/[DRCU]/.test(status)) {
      throw new PublicationError(`Agent publication does not permit delete, rename, copy or unresolved paths: ${filePath}.`, 'UNSUPPORTED_CHANGE_TYPE', {
        path: filePath,
        status
      });
    }
    return { status, path: filePath };
  });
}

function assertExactPathSet(actualPaths, declaredPaths, code = 'UNDECLARED_CHANGES') {
  const actual = [...new Set(actualPaths)].sort();
  const declared = [...new Set(declaredPaths)].sort();
  const undeclared = actual.filter((filePath) => !declared.includes(filePath));
  const missing = declared.filter((filePath) => !actual.includes(filePath));
  if (undeclared.length || missing.length) {
    throw new PublicationError('Git changes do not exactly match the files written through the bounded agent tools.', code, {
      undeclared,
      missing,
      actual,
      declared
    });
  }
  return actual;
}

function buildPullRequestBody({ project, task, result, commitSha }) {
  const tests = Array.isArray(result.tests) ? result.tests : [];
  const risks = Array.isArray(result.risks) ? result.risks : [];
  const changedFiles = Array.isArray(result.changedFiles) ? result.changedFiles : [];
  return [
    '## Agent task',
    '',
    compact(result.summary, 4000),
    '',
    '## Changed files',
    '',
    ...changedFiles.map((filePath) => `- \`${filePath}\``),
    '',
    '## Verification',
    '',
    ...(tests.length ? tests.map((test) => `- ${compact(test, 500)}`) : ['- No human-readable test summary supplied; see structured verification metadata.']),
    '',
    '## Risks',
    '',
    ...(risks.length ? risks.map((risk) => `- ${compact(risk, 500)}`) : ['- None reported by the primary agent.']),
    '',
    '## Provenance',
    '',
    `- Repository: \`${project.repository}\``,
    `- Base branch: \`${project.defaultBranch}\``,
    `- Base SHA: \`${task.baseSha}\``,
    `- Agent branch: \`${task.branch}\``,
    `- Commit SHA: \`${commitSha}\``,
    '',
    '> This is a draft PR. Aegis does not merge agent work automatically.'
  ].join('\n');
}

class PublicationService {
  constructor({ githubConnector, repositorySyncService } = {}) {
    if (!githubConnector || typeof githubConnector.listPullRequests !== 'function' || typeof githubConnector.createPullRequest !== 'function' || typeof githubConnector.getBranch !== 'function') {
      throw new TypeError('GitHub connector with branch and pull-request operations is required.');
    }
    if (!repositorySyncService || typeof repositorySyncService.runGit !== 'function') {
      throw new TypeError('Repository sync service is required for credential-safe Git commands.');
    }
    this.github = githubConnector;
    this.git = repositorySyncService;
  }

  async openPullRequestForBranch(project, branch) {
    const pulls = await this.github.listPullRequests(project.repository, { state: 'open', perPage: 100 });
    return (Array.isArray(pulls) ? pulls : []).find((pull) => pull?.head?.ref === branch) || null;
  }

  async reconcilePush(project, branch, commitSha) {
    try {
      const remote = await this.github.getBranch(project.repository, branch);
      return String(remote?.commit?.sha || '') === commitSha;
    } catch {
      return false;
    }
  }

  async changedPathsBetween(task, revision) {
    const diff = await this.git.runGit(['diff', '--name-only', '-z', `${task.baseSha}..${revision}`, '--'], { cwd: task.workspacePath });
    return parseNulPaths(diff.stdout).map(assertRelativePath);
  }

  async publish({ project, task, agentResult, githubToken } = {}) {
    if (!project?.repository || !project?.defaultBranch || !project?.id) throw new TypeError('Validated project is required.');
    if (!task?.workspacePath || !task?.baseSha || !task?.branch) throw new TypeError('Prepared task workspace is required.');
    const { changedFiles } = validateReadyResult(agentResult);
    const branch = assertAgentBranch(task.branch, project.id);

    const currentBranch = await this.git.runGit(['branch', '--show-current'], { cwd: task.workspacePath });
    if (String(currentBranch.stdout || '').trim() !== branch) {
      throw new PublicationError('Prepared worktree is not on the expected agent branch.', 'BRANCH_MISMATCH');
    }
    const mergeBase = await this.git.runGit(['merge-base', 'HEAD', task.baseSha], { cwd: task.workspacePath });
    if (String(mergeBase.stdout || '').trim() !== task.baseSha) {
      throw new PublicationError('Agent branch is not based on the recorded base SHA.', 'BASE_MISMATCH');
    }

    const existingPull = await this.openPullRequestForBranch(project, branch);
    const status = await this.git.runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: task.workspacePath });
    const statusEntries = parsePorcelainStatus(status.stdout);
    const hasChanges = statusEntries.length > 0;

    if (hasChanges) {
      assertExactPathSet(statusEntries.map((entry) => entry.path), changedFiles, 'UNDECLARED_CHANGES');
      await this.git.runGit(['add', '--', ...changedFiles], { cwd: task.workspacePath });

      const stagedPaths = await this.git.runGit(['diff', '--cached', '--name-only', '-z', '--'], { cwd: task.workspacePath });
      assertExactPathSet(parseNulPaths(stagedPaths.stdout).map(assertRelativePath), changedFiles, 'STAGED_PATH_MISMATCH');

      const staged = await this.git.runGit(['diff', '--cached', '--quiet', '--exit-code'], { cwd: task.workspacePath, allowFailure: true });
      if (staged.code === 0) throw new PublicationError('Worktree contains no staged changes to publish.', 'EMPTY_CHANGES');
      if (staged.code !== 1) throw new PublicationError('Unable to inspect staged changes.', 'STAGED_DIFF_FAILED');

      const message = `agent(${project.id}): ${compact(task.taskId || task.slug || 'verified task', 72)}`;
      await this.git.runGit([
        '-c', 'user.name=Aegis Agent',
        '-c', 'user.email=aegis-agent@users.noreply.github.com',
        'commit', '-m', message
      ], { cwd: task.workspacePath });
    }

    const revision = await this.git.runGit(['rev-parse', 'HEAD'], { cwd: task.workspacePath });
    const commitSha = String(revision.stdout || '').trim();
    if (!/^[0-9a-f]{40,64}$/i.test(commitSha)) throw new PublicationError('Local commit SHA is invalid.', 'INVALID_COMMIT');
    if (commitSha === task.baseSha && !existingPull) {
      throw new PublicationError('There are no committed task changes to publish.', 'EMPTY_CHANGES');
    }
    if (commitSha !== task.baseSha) {
      const committedPaths = await this.changedPathsBetween(task, commitSha);
      assertExactPathSet(committedPaths, changedFiles, 'COMMITTED_PATH_MISMATCH');
    }

    const push = await this.git.runGit([
      'push', '--set-upstream', 'origin', `HEAD:refs/heads/${branch}`
    ], { cwd: task.workspacePath, githubToken, allowFailure: true });
    if (push.code !== 0 || push.timedOut) {
      const reconciled = await this.reconcilePush(project, branch, commitSha);
      if (!reconciled) {
        throw new PublicationError(`Agent branch push failed: ${compact(push.stderr || push.stdout || push.error, 1000)}`, 'PUSH_FAILED', { commitSha, branch });
      }
    }

    let pullRequest = existingPull || await this.openPullRequestForBranch(project, branch);
    if (!pullRequest) {
      const title = `Agent: ${compact(task.taskId || task.slug || project.nextTask || 'verified task', 180)}`;
      const body = buildPullRequestBody({ project, task, result: { ...agentResult, changedFiles }, commitSha });
      try {
        pullRequest = await this.github.createPullRequest(project.repository, {
          title,
          head: branch,
          base: project.defaultBranch,
          body,
          draft: true
        });
      } catch (error) {
        pullRequest = await this.openPullRequestForBranch(project, branch);
        if (!pullRequest) throw new PublicationError(`Draft PR creation failed: ${compact(error?.message || error, 1000)}`, 'PR_CREATE_FAILED', { commitSha, branch });
      }
    }

    return {
      ok: true,
      repository: project.repository,
      baseBranch: project.defaultBranch,
      baseSha: task.baseSha,
      branch,
      commitSha,
      changedFiles,
      pullRequest: {
        number: Number(pullRequest?.number) || 0,
        url: String(pullRequest?.html_url || pullRequest?.url || ''),
        draft: pullRequest?.draft !== false
      },
      reusedPullRequest: Boolean(existingPull)
    };
  }
}

module.exports = {
  PublicationError,
  PublicationService,
  assertAgentBranch,
  assertExactPathSet,
  buildPullRequestBody,
  normalizeChangedFiles,
  parseNulPaths,
  parsePorcelainStatus,
  validateReadyResult
};
