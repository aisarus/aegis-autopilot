'use strict';

const assert = require('assert');
const path = require('path');
const { loadProjectRegistry } = require('../orchestrator/project-registry');
const { ProjectAgentRunner } = require('../orchestrator/project-agent-runner');

const registry = loadProjectRegistry(path.join(__dirname, '..', 'orchestrator', 'projects.json'));

function baseline(baseSha) {
  return {
    id: 'lamdan',
    name: 'Lamdan',
    repository: 'aisarus/syllabus-to-os',
    status: 'ready',
    defaultBranch: 'main',
    baseSha,
    documents: [],
    openIssues: [],
    openPullRequests: [],
    errors: []
  };
}

function createHarness(overrides = {}) {
  const calls = { credentials: [], baselines: 0, sync: [], worktreeOptions: null, prepare: null, adapter: null, agent: null };
  const baselineValues = (overrides.baselines || [baseline('old-sha'), baseline('new-sha')]).slice();
  const credentialValues = { github: 'github-secret', openai: 'openai-secret', gemini: 'gemini-secret', ...(overrides.credentials || {}) };
  const credentialStore = {
    async load(name) {
      calls.credentials.push(name);
      return credentialValues[name] || '';
    }
  };
  const repositorySyncService = {
    async syncProject(input) {
      calls.sync.push({ ...input });
      if (overrides.sync) return overrides.sync(input);
      return {
        projectId: input.projectId,
        repository: input.repository,
        defaultBranch: input.defaultBranch,
        baseSha: 'new-sha',
        repositoryPath: '/repo/lamdan',
        remoteUrl: 'https://github.com/aisarus/syllabus-to-os.git'
      };
    }
  };
  const fakeWorktreeService = {
    async prepareTask(input) {
      calls.prepare = { ...input };
      return {
        projectId: input.projectId,
        taskId: input.taskId,
        slug: input.slug,
        branch: `agent/${input.projectId}/${input.taskId}-${input.slug}`,
        baseSha: input.baseSha,
        repositoryPath: '/repo/lamdan',
        workspacePath: '/tasks/lamdan/task'
      };
    }
  };
  const runner = new ProjectAgentRunner({
    registry,
    credentialStore,
    repositorySyncService,
    connectorFactory: ({ token }) => ({ token }),
    baselineBuilder: overrides.baselineBuilder || (async () => {
      calls.baselines += 1;
      return baselineValues.shift() || baseline('new-sha');
    }),
    worktreeFactory: (options) => {
      calls.worktreeOptions = options;
      return fakeWorktreeService;
    },
    adapterFactories: {
      openai: (options) => {
        calls.adapter = { provider: 'openai', ...options };
        return { model: options.model || 'gpt-test' };
      },
      gemini: (options) => {
        calls.adapter = { provider: 'gemini', ...options };
        return { model: options.model || 'gemini-test' };
      }
    },
    agentLoopFactory: ({ modelAdapter, worktreeService }) => ({
      async run(input) {
        calls.agent = { modelAdapter, worktreeService, input };
        if (overrides.agentError) throw overrides.agentError;
        return { ok: true, status: 'ready_for_review', summary: 'done', tests: ['pass'], risks: [], audit: [] };
      }
    }),
    platform: 'win32'
  });
  return { runner, calls };
}

(async () => {
  const { runner, calls } = createHarness();
  const result = await runner.run({
    projectId: 'lamdan',
    provider: 'openai',
    taskId: 's3-003',
    slug: 'cancellation',
    model: 'gpt-test',
    instruction: 'Implement cancellation propagation.'
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'openai');
  assert.equal(result.baseline.baseSha, 'new-sha');
  assert.equal(result.workspace.branch, 'agent/lamdan/s3-003-cancellation');
  assert.equal(calls.baselines, 2, 'Baseline must be rebuilt after fetched SHA movement.');
  assert.deepEqual(calls.credentials.sort(), ['github', 'openai']);
  assert.equal(calls.sync[0].githubToken, 'github-secret');
  assert.equal(calls.prepare.baseSha, 'new-sha');
  assert.equal(calls.worktreeOptions.commandPolicy.typecheck.executable, 'npm.cmd');
  assert(calls.worktreeOptions.secrets.includes('github-secret'));
  assert(calls.worktreeOptions.secrets.includes('openai-secret'));
  assert.equal(calls.adapter.apiKey, 'openai-secret');
  assert.equal(calls.agent.input.baseline.baseSha, 'new-sha');

  const missing = createHarness({ credentials: { gemini: '' } }).runner;
  await assert.rejects(
    () => missing.run({ projectId: 'lamdan', provider: 'gemini', taskId: 'x', slug: 'x' }),
    (error) => error.code === 'MISSING_CREDENTIAL' && error.details.credential === 'gemini'
  );

  const moved = createHarness({ baselines: [baseline('one'), baseline('three')], sync: () => ({
    baseSha: 'two', repositoryPath: '/repo', remoteUrl: 'remote', defaultBranch: 'main'
  }) }).runner;
  await assert.rejects(
    () => moved.run({ projectId: 'lamdan', provider: 'openai', taskId: 'x', slug: 'x' }),
    (error) => error.code === 'BASE_MOVED' && error.details.fetchedSha === 'two'
  );

  let releaseBaseline;
  let baselineStarted;
  const baselineStartedPromise = new Promise((resolve) => { baselineStarted = resolve; });
  const baselineWait = new Promise((resolve) => { releaseBaseline = resolve; });
  const busyHarness = createHarness({
    baselines: [baseline('same')],
    sync: () => ({ baseSha: 'same', repositoryPath: '/repo', remoteUrl: 'remote', defaultBranch: 'main' }),
    baselineBuilder: async () => {
      baselineStarted();
      await baselineWait;
      return baseline('same');
    }
  });
  const firstRun = busyHarness.runner.run({ projectId: 'lamdan', provider: 'openai', taskId: 'one', slug: 'one' });
  await baselineStartedPromise;
  await assert.rejects(
    () => busyHarness.runner.run({ projectId: 'lamdan', provider: 'openai', taskId: 'two', slug: 'two' }),
    (error) => error.code === 'PROJECT_BUSY'
  );
  releaseBaseline();
  await firstRun;

  const controller = new AbortController();
  controller.abort();
  const cancelledHarness = createHarness();
  await assert.rejects(
    () => cancelledHarness.runner.run({ projectId: 'lamdan', provider: 'openai', taskId: 'x', slug: 'x', signal: controller.signal }),
    (error) => error.code === 'CANCELLED'
  );
  assert.equal(cancelledHarness.calls.credentials.length, 0, 'Cancelled run must not read credentials.');

  const failure = new Error('agent failed');
  const failedHarness = createHarness({ agentError: failure });
  await assert.rejects(
    () => failedHarness.runner.run({ projectId: 'lamdan', provider: 'openai', taskId: 'x', slug: 'x' }),
    (error) => error.code === 'PROJECT_RUN_FAILED' && error.details.workspacePath === '/tasks/lamdan/task'
  );

  console.log('Executable project agent runner v2 smoke test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
