'use strict';

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

function validateReadyResult(result) {
  if (!result || result.status !== 'ready_for_review') {
    throw new PublicationError('Only ready_for_review agent results may be published.', 'RESULT_NOT_READY');
  }
  const verifications = Array.isArray(result.verifications) ? result.verifications : [];
  if (!verifications.length || verifications.some((entry) => Number(entry.code) !== 0 || entry.timedOut)) {
    throw new PublicationError('All recorded verification commands must pass before publication.', 'VERIFICATION_FAILED');
  }
  return verifications;
}

function assertAgentBranch(branch, projectId) {
  const value = assertBranchName(branch);
  const prefix = `agent/${String(projectId || '').trim().toLowerCase()}/`;
  if (!value.startsWith(prefix) || value === prefix) {
    throw new PublicationError(`Refusing to publish a non-agent branch: ${value}.`, 'UNSAFE_BRANCH');
  }
  return value;
}

function buildPullRequestBody({ project, task, result, commitSha }) {
  const tests = Array.isArray(result.tests) ? result.tests : [];
  const risks = Array.isArray(result.risks) ? result.risks : [];
  return [
    `## Agent task`,
    '',
    compact(result.summary, 4000),
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

  async publish({ project, task, agentResult, githubToken } = {}) {
    if (!project?.repository || !project?.defaultBranch || !project?.id) throw new TypeError('Validated project is required.');
    if (!task?.workspacePath || !task?.baseSha || !task?.branch) throw new TypeError('Prepared task workspace is required.');
    validateReadyResult(agentResult);
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
    const status = await this.git.runGit(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: task.workspacePath });
    const hasChanges = Boolean(String(status.stdout || '').trim());

    if (hasChanges) {
      await this.git.runGit(['add', '--all'], { cwd: task.workspacePath });
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
    if (!hasChanges && commitSha === task.baseSha && !existingPull) {
      throw new PublicationError('There are no committed task changes to publish.', 'EMPTY_CHANGES');
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
      const body = buildPullRequestBody({ project, task, result: agentResult, commitSha });
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
  buildPullRequestBody,
  validateReadyResult
};
