'use strict';

const { GitHubConnector } = require('./github-connector');
const { buildProjectBaseline } = require('./baseline-service');
const { buildCommandPolicy, projectById } = require('./project-registry');
const { WorktreeService, assertId } = require('./worktree-service');
const { CodingAgentLoop, CodingAgentError } = require('./coding-agent-loop');
const { OpenAIResponsesAdapter } = require('./openai-responses-adapter');
const { GeminiInteractionsAdapter } = require('./gemini-interactions-adapter');

const PROVIDERS = Object.freeze(['openai', 'gemini']);

class ProjectAgentRunError extends Error {
  constructor(message, code = 'PROJECT_RUN_ERROR', details = {}) {
    super(message);
    this.name = 'ProjectAgentRunError';
    this.code = code;
    this.details = details;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new ProjectAgentRunError('Project-agent run was cancelled.', 'CANCELLED');
}

function assertProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!PROVIDERS.includes(provider)) throw new TypeError(`Unsupported model provider: ${provider || '<empty>'}`);
  return provider;
}

class ProjectAgentRunner {
  constructor({
    registry,
    credentialStore,
    repositorySyncService,
    worktreeRoot,
    connectorFactory = ({ token }) => new GitHubConnector({ token }),
    baselineBuilder = buildProjectBaseline,
    worktreeFactory,
    adapterFactories,
    agentLoopFactory = ({ modelAdapter, worktreeService }) => new CodingAgentLoop({ modelAdapter, worktreeService }),
    platform = process.platform
  } = {}) {
    if (!registry || !Array.isArray(registry.projects)) throw new TypeError('Validated project registry is required.');
    if (!credentialStore || typeof credentialStore.load !== 'function') throw new TypeError('Credential store is required.');
    if (!repositorySyncService || typeof repositorySyncService.syncProject !== 'function') throw new TypeError('Repository sync service is required.');
    if (!worktreeRoot && !worktreeFactory) throw new TypeError('Worktree root or worktree factory is required.');
    this.registry = registry;
    this.credentialStore = credentialStore;
    this.repositorySyncService = repositorySyncService;
    this.worktreeRoot = worktreeRoot;
    this.connectorFactory = connectorFactory;
    this.baselineBuilder = baselineBuilder;
    this.worktreeFactory = worktreeFactory || ((options) => new WorktreeService({ rootDir: this.worktreeRoot, ...options }));
    this.adapterFactories = adapterFactories || {
      openai: ({ apiKey, model }) => new OpenAIResponsesAdapter({ apiKey, ...(model ? { model } : {}) }),
      gemini: ({ apiKey, model }) => new GeminiInteractionsAdapter({ apiKey, ...(model ? { model } : {}) })
    };
    this.agentLoopFactory = agentLoopFactory;
    this.platform = platform;
    this.activeProjects = new Set();
  }

  async loadCredential(name) {
    const value = String(await this.credentialStore.load(name) || '').trim();
    if (!value) throw new ProjectAgentRunError(`Credential is not configured: ${name}.`, 'MISSING_CREDENTIAL', { credential: name });
    return value;
  }

  async reconciledBaseline({ connector, project, githubToken, signal }) {
    throwIfAborted(signal);
    let baseline = await this.baselineBuilder(connector, project);
    throwIfAborted(signal);
    if (!baseline?.baseSha) throw new ProjectAgentRunError(`GitHub baseline has no default-branch SHA for ${project.repository}.`, 'BASELINE_UNAVAILABLE');

    const sync = await this.repositorySyncService.syncProject({
      projectId: project.id,
      repository: project.repository,
      defaultBranch: baseline.defaultBranch || project.defaultBranch,
      githubToken
    });
    throwIfAborted(signal);

    if (sync.baseSha !== baseline.baseSha) {
      baseline = await this.baselineBuilder(connector, project);
      throwIfAborted(signal);
      if (!baseline?.baseSha || baseline.baseSha !== sync.baseSha) {
        throw new ProjectAgentRunError('Default branch moved during baseline synchronization. Retry from a fresh baseline.', 'BASE_MOVED', {
          observedSha: baseline?.baseSha || '',
          fetchedSha: sync.baseSha
        });
      }
    }
    return { baseline, sync };
  }

  async run({ projectId, provider, taskId, slug = 'task', instruction = '', model = '', signal } = {}) {
    const normalizedProjectId = assertId(projectId, 'project id');
    const normalizedProvider = assertProvider(provider);
    const normalizedTaskId = assertId(taskId, 'task id');
    const normalizedSlug = assertId(slug, 'task slug');
    const project = projectById(this.registry, normalizedProjectId);
    if (!project) throw new ProjectAgentRunError(`Project is not registered: ${normalizedProjectId}.`, 'PROJECT_NOT_FOUND');
    throwIfAborted(signal);
    if (this.activeProjects.has(project.id)) throw new ProjectAgentRunError(`Project already has an active agent run: ${project.id}.`, 'PROJECT_BUSY');

    this.activeProjects.add(project.id);
    let task = null;
    try {
      const [githubToken, providerKey] = await Promise.all([
        this.loadCredential('github'),
        this.loadCredential(normalizedProvider)
      ]);
      throwIfAborted(signal);

      const connector = this.connectorFactory({ token: githubToken });
      const { baseline, sync } = await this.reconciledBaseline({ connector, project, githubToken, signal });
      const commandPolicy = buildCommandPolicy(project, this.platform);
      const worktreeService = this.worktreeFactory({
        commandPolicy,
        secrets: [githubToken, providerKey]
      });
      task = await worktreeService.prepareTask({
        projectId: project.id,
        taskId: normalizedTaskId,
        slug: normalizedSlug,
        baseSha: sync.baseSha
      });
      throwIfAborted(signal);

      const adapterFactory = this.adapterFactories[normalizedProvider];
      if (typeof adapterFactory !== 'function') throw new ProjectAgentRunError(`Provider adapter is unavailable: ${normalizedProvider}.`, 'PROVIDER_UNAVAILABLE');
      const modelAdapter = adapterFactory({ apiKey: providerKey, model: String(model || '').trim() });
      const agentLoop = this.agentLoopFactory({ modelAdapter, worktreeService });
      const result = await agentLoop.run({
        project,
        task,
        baseline,
        instruction: String(instruction || project.nextTask || ''),
        signal
      });

      return {
        ok: true,
        project: { id: project.id, name: project.name, repository: project.repository },
        provider: normalizedProvider,
        model: String(model || modelAdapter.model || ''),
        baseline: {
          defaultBranch: baseline.defaultBranch,
          baseSha: baseline.baseSha,
          status: baseline.status,
          errors: baseline.errors || []
        },
        workspace: {
          branch: task.branch,
          baseSha: task.baseSha,
          repositoryPath: task.repositoryPath,
          workspacePath: task.workspacePath
        },
        result
      };
    } catch (error) {
      if (error instanceof ProjectAgentRunError || error instanceof CodingAgentError) {
        if (task?.workspacePath) error.details = { ...(error.details || {}), workspacePath: task.workspacePath, branch: task.branch };
        throw error;
      }
      const wrapped = new ProjectAgentRunError(String(error?.message || error || 'Project-agent run failed.'), 'PROJECT_RUN_FAILED', {
        ...(task?.workspacePath ? { workspacePath: task.workspacePath, branch: task.branch } : {})
      });
      throw wrapped;
    } finally {
      this.activeProjects.delete(project.id);
    }
  }
}

module.exports = {
  PROVIDERS,
  ProjectAgentRunError,
  ProjectAgentRunner,
  assertProvider,
  throwIfAborted
};
