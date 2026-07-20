'use strict';

const assert = require('assert');
const path = require('path');
const { loadProjectRegistry } = require('../orchestrator/project-registry');
const { OrchestratorRuntime } = require('../orchestrator/runtime-service');

const registry = loadProjectRegistry(path.join(__dirname, '..', 'orchestrator', 'projects.json'));

function readyOutput(input) {
  return {
    ok: true,
    project: { id: input.projectId, name: input.projectId, repository: `owner/${input.projectId}` },
    provider: input.provider,
    model: input.model || 'test-model',
    baseline: { defaultBranch: 'main', baseSha: `${input.projectId}-sha`, status: 'ready', errors: [] },
    workspace: {
      branch: `agent/${input.projectId}/${input.taskId}-${input.slug}`,
      baseSha: `${input.projectId}-sha`,
      repositoryPath: `/repositories/${input.projectId}`,
      workspacePath: `/tasks/${input.projectId}/${input.taskId}`
    },
    result: {
      ok: true,
      status: 'ready_for_review',
      summary: `Completed ${input.taskId}`,
      tests: ['verification: passed'],
      risks: [],
      changedFiles: ['src/change.js'],
      usage: { turns: 3, toolCalls: 5, writes: 1, writtenBytes: 20 },
      verifications: [{ commandId: 'test', code: 0, timedOut: false }],
      audit: []
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

(async () => {
  const credentials = {
    github: 'github_pat_abcdefghijklmnopqrstuvwxyz123456',
    openai: 'sk-abcdefghijklmnopqrstuvwxyz123456',
    gemini: 'AIzaabcdefghijklmnopqrstuvwxyz123456'
  };
  const credentialCalls = [];
  const credentialStore = {
    async load(name) {
      credentialCalls.push(['load', name]);
      return credentials[name] || '';
    },
    async save(name, value) {
      credentialCalls.push(['save', name]);
      credentials[name] = String(value);
    },
    async remove(name) {
      credentialCalls.push(['remove', name]);
      delete credentials[name];
    },
    async metadata() {
      return {
        available: true,
        configured: {
          github: Boolean(credentials.github),
          openai: Boolean(credentials.openai),
          gemini: Boolean(credentials.gemini)
        }
      };
    }
  };

  const holds = new Map();
  const runnerCalls = [];
  const projectAgentRunner = {
    async run(input) {
      runnerCalls.push(input);
      if (input.taskId.startsWith('hold')) {
        const gate = deferred();
        holds.set(input.projectId, { gate, input });
        return gate.promise;
      }
      if (input.taskId === 'cancel') {
        return new Promise((_resolve, reject) => {
          const fail = () => {
            const error = new Error('cancelled');
            error.code = 'CANCELLED';
            reject(error);
          };
          if (input.signal.aborted) fail();
          else input.signal.addEventListener('abort', fail, { once: true });
        });
      }
      if (input.taskId === 'fail') {
        const error = new Error(`Provider rejected ${credentials.openai}`);
        error.code = 'PROVIDER_FAILED';
        error.details = {
          workspacePath: '/tasks/aegis/fail',
          branch: 'agent/aegis/fail-provider',
          nested: { github: credentials.github }
        };
        throw error;
      }
      return readyOutput(input);
    }
  };

  const baselineCalls = [];
  const baselineBuilder = async ({ connector, registry: inputRegistry }) => {
    baselineCalls.push({ connector, registry: inputRegistry });
    return {
      version: 1,
      observedAt: '2026-07-20T10:20:00.000Z',
      status: 'ready',
      projects: inputRegistry.projects.map((project) => ({
        id: project.id,
        name: project.name,
        repository: project.repository,
        status: 'ready',
        baseSha: `${project.id}-sha`
      }))
    };
  };

  const publications = [];
  const publicationFactory = ({ githubConnector, syncService }) => ({
    async publish(input) {
      publications.push({ githubConnector, syncService, input });
      return {
        ok: true,
        repository: input.project.repository,
        branch: input.task.branch,
        commitSha: 'f'.repeat(40),
        changedFiles: input.agentResult.changedFiles,
        pullRequest: { number: 101 + publications.length, url: `https://example.test/pr/${101 + publications.length}`, draft: true }
      };
    }
  });

  let runSequence = 0;
  const runtime = new OrchestratorRuntime({
    registry,
    credentialStore,
    projectAgentRunner,
    repositorySyncService: { async runGit() { return { code: 0 }; } },
    connectorFactory: ({ token }) => ({ token: token ? '[configured]' : '' }),
    baselineBuilder,
    publicationFactory,
    clock: () => new Date(`2026-07-20T10:${String(20 + Math.min(runSequence, 30)).padStart(2, '0')}:00.000Z`),
    idFactory: () => `run-${++runSequence}`
  });

  const initialCredentials = await runtime.credentialMetadata();
  assert.deepEqual(initialCredentials.configured, { github: true, openai: true, gemini: true });
  await runtime.saveCredential('gemini', 'AIza-newabcdefghijklmnopqrstuvwxyz123456');
  await runtime.removeCredential('gemini');
  assert.equal((await runtime.credentialMetadata()).configured.gemini, false);
  await runtime.saveCredential('gemini', 'AIzaabcdefghijklmnopqrstuvwxyz123456');
  assert(credentialCalls.some((entry) => entry[0] === 'save' && entry[1] === 'gemini'));
  assert(credentialCalls.some((entry) => entry[0] === 'remove' && entry[1] === 'gemini'));

  const baselines = await runtime.refreshBaselines();
  assert.equal(baselines.projects.length, 3);
  assert.equal(baselineCalls.length, 1);
  assert.equal(baselineCalls[0].connector.token, '[configured]');

  const lamdan = runtime.startRun({ projectId: 'lamdan', provider: 'openai', taskId: 'hold-lamdan', slug: 'one' });
  const edge = runtime.startRun({ projectId: 'edge', provider: 'gemini', taskId: 'hold-edge', slug: 'two' });
  const aegis = runtime.startRun({ projectId: 'aegis', provider: 'openai', taskId: 'hold-aegis', slug: 'three' });
  assert.equal(lamdan.id, 'run-1');
  assert.equal(edge.id, 'run-2');
  assert.equal(aegis.id, 'run-3');
  assert.equal(runtime.snapshotSync().activeRunCount, 3, 'All three projects must be able to run concurrently.');
  assert.throws(
    () => runtime.startRun({ projectId: 'lamdan', provider: 'openai', taskId: 'other', slug: 'other' }),
    (error) => error.code === 'PROJECT_BUSY'
  );

  holds.get('lamdan').gate.resolve(readyOutput(holds.get('lamdan').input));
  holds.get('edge').gate.resolve(readyOutput(holds.get('edge').input));
  holds.get('aegis').gate.resolve(readyOutput(holds.get('aegis').input));
  const completed = await Promise.all([
    runtime.waitForRun(lamdan.id),
    runtime.waitForRun(edge.id),
    runtime.waitForRun(aegis.id)
  ]);
  assert(completed.every((run) => run.status === 'ready_for_review'));
  assert.equal(runtime.snapshotSync().activeRunCount, 0);

  const published = await runtime.publishRun(lamdan.id);
  assert.equal(published.status, 'published');
  assert.equal(published.publication.pullRequest.draft, true);
  assert.equal(publications.length, 1);
  assert.equal(publications[0].input.githubToken, credentials.github);
  const repeatedPublication = await runtime.publishRun(lamdan.id);
  assert.equal(repeatedPublication.publication.pullRequest.number, published.publication.pullRequest.number);
  assert.equal(publications.length, 1, 'Repeated publication must reuse the stored result.');

  const automatic = runtime.startRun({
    projectId: 'lamdan',
    provider: 'openai',
    taskId: 'auto',
    slug: 'publish',
    autoPublish: true
  });
  const autoCompleted = await runtime.waitForRun(automatic.id);
  assert.equal(autoCompleted.status, 'published');
  assert.equal(publications.length, 2);

  const cancelling = runtime.startRun({ projectId: 'edge', provider: 'gemini', taskId: 'cancel', slug: 'cancel' });
  const cancellingState = runtime.cancelProject('edge');
  assert.equal(cancellingState.status, 'cancelling');
  const cancelled = await runtime.waitForRun(cancelling.id);
  assert.equal(cancelled.status, 'cancelled');

  const failing = runtime.startRun({ projectId: 'aegis', provider: 'openai', taskId: 'fail', slug: 'provider' });
  const failed = await runtime.waitForRun(failing.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.workspace.workspacePath, '/tasks/aegis/fail');
  assert.equal(failed.error.message.includes(credentials.openai), false);
  assert.equal(failed.error.message.includes('[REDACTED]'), true);
  assert.equal(JSON.stringify(failed.error.details).includes(credentials.github), false);

  const snapshot = await runtime.snapshot();
  const serialized = JSON.stringify(snapshot);
  for (const secret of Object.values(credentials)) {
    assert.equal(serialized.includes(secret), false, `Runtime snapshot leaked a credential: ${secret}`);
  }
  assert.equal(snapshot.projects.length, 3);
  assert.equal(snapshot.credentials.available, true);
  assert(snapshot.events.some((event) => event.type === 'publication-completed'));
  assert(snapshot.events.some((event) => event.type === 'run-cancelled'));
  assert(snapshot.events.some((event) => event.type === 'run-failed'));
  assert.equal(runnerCalls.some((call) => call.signal instanceof AbortSignal), true);

  console.log('Three-project orchestration runtime v2 smoke test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
