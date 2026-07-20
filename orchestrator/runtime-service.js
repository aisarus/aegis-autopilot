'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { buildAllBaselines } = require('./baseline-service');
const { GitHubConnector } = require('./github-connector');
const { projectById } = require('./project-registry');
const { PublicationService } = require('./publication-service');
const { assertId } = require('./worktree-service');
const { assertProvider } = require('./project-agent-runner');

const MAX_EVENTS = 300;

class RuntimeServiceError extends Error {
  constructor(message, code = 'RUNTIME_ERROR', details = {}) {
    super(message);
    this.name = 'RuntimeServiceError';
    this.code = code;
    this.details = details;
  }
}

function isoNow(clock) {
  return clock().toISOString();
}

function redactLikelySecrets(value, max = 2000) {
  return String(value ?? '')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{25,}\b/g, '[REDACTED]')
    .slice(0, max);
}

function sanitizeStructured(value, depth = 0) {
  if (depth > 5) return '[TRUNCATED]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return redactLikelySecrets(value, 1000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeStructured(entry, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 50)) {
      const safeKey = redactLikelySecrets(key, 120);
      output[safeKey] = sanitizeStructured(entry, depth + 1);
    }
    return output;
  }
  return redactLikelySecrets(value, 500);
}

function publicError(error) {
  return {
    code: String(error?.code || 'ERROR').slice(0, 100),
    message: redactLikelySecrets(error?.message || error || 'Unknown error'),
    details: error?.details && typeof error.details === 'object' ? sanitizeStructured(error.details) : {}
  };
}

function publicRun(record) {
  return {
    id: record.id,
    projectId: record.projectId,
    provider: record.provider,
    model: record.model,
    taskId: record.taskId,
    slug: record.slug,
    instruction: record.instruction,
    autoPublish: record.autoPublish,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    updatedAt: record.updatedAt,
    summary: record.agentResult?.summary || '',
    tests: record.agentResult?.tests || [],
    risks: record.agentResult?.risks || [],
    changedFiles: record.agentResult?.changedFiles || [],
    usage: record.agentResult?.usage || null,
    verifications: record.agentResult?.verifications || [],
    workspace: record.workspace || null,
    baseline: record.baseline || null,
    publication: record.publication || null,
    error: record.error || null
  };
}

class OrchestratorRuntime extends EventEmitter {
  constructor({
    registry,
    credentialStore,
    projectAgentRunner,
    repositorySyncService,
    connectorFactory = ({ token }) => new GitHubConnector({ token }),
    baselineBuilder = ({ connector, registry: projectRegistry }) => buildAllBaselines({ connector, registry: projectRegistry }),
    publicationFactory = ({ githubConnector, syncService }) => new PublicationService({
      githubConnector,
      repositorySyncService: syncService
    }),
    clock = () => new Date(),
    idFactory = () => `run-${crypto.randomUUID()}`
  } = {}) {
    super();
    if (!registry || !Array.isArray(registry.projects)) throw new TypeError('Validated project registry is required.');
    if (!credentialStore || typeof credentialStore.load !== 'function' || typeof credentialStore.metadata !== 'function') throw new TypeError('Credential store is required.');
    if (!projectAgentRunner || typeof projectAgentRunner.run !== 'function') throw new TypeError('Project agent runner is required.');
    if (!repositorySyncService || typeof repositorySyncService.runGit !== 'function') throw new TypeError('Repository sync service is required.');
    this.registry = registry;
    this.credentialStore = credentialStore;
    this.projectAgentRunner = projectAgentRunner;
    this.repositorySyncService = repositorySyncService;
    this.connectorFactory = connectorFactory;
    this.baselineBuilder = baselineBuilder;
    this.publicationFactory = publicationFactory;
    this.clock = clock;
    this.idFactory = idFactory;
    this.runs = new Map();
    this.runPromises = new Map();
    this.controllers = new Map();
    this.activeByProject = new Map();
    this.publishingRuns = new Set();
    this.events = [];
    this.baselines = null;
    this.baselinePromise = null;
  }

  event(type, message, details = {}) {
    const entry = {
      id: `event-${crypto.randomUUID()}`,
      at: isoNow(this.clock),
      type: String(type || 'event').slice(0, 100),
      message: redactLikelySecrets(message),
      details: sanitizeStructured(details || {})
    };
    this.events.unshift(entry);
    this.events = this.events.slice(0, MAX_EVENTS);
    this.emit('state', this.snapshotSync());
    return entry;
  }

  snapshotSync() {
    return {
      version: 2,
      projects: this.registry.projects.map((project) => ({
        id: project.id,
        name: project.name,
        repository: project.repository,
        nextTask: project.nextTask,
        activeRunId: this.activeByProject.get(project.id) || '',
        baseline: this.baselines?.projects?.find((entry) => entry.id === project.id) || null
      })),
      baselineStatus: this.baselines?.status || 'not_loaded',
      baselineObservedAt: this.baselines?.observedAt || null,
      runs: [...this.runs.values()].map(publicRun).sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt))),
      events: this.events.slice(),
      activeRunCount: this.activeByProject.size
    };
  }

  async snapshot() {
    return {
      ...this.snapshotSync(),
      credentials: await this.credentialStore.metadata()
    };
  }

  credentialMetadata() {
    return this.credentialStore.metadata();
  }

  async saveCredential(name, secret) {
    await this.credentialStore.save(name, secret);
    this.event('credential-saved', `Credential configured: ${name}.`, { name: String(name) });
    return this.credentialStore.metadata();
  }

  async removeCredential(name) {
    await this.credentialStore.remove(name);
    this.event('credential-removed', `Credential removed: ${name}.`, { name: String(name) });
    return this.credentialStore.metadata();
  }

  async requireCredential(name) {
    const value = String(await this.credentialStore.load(name) || '').trim();
    if (!value) throw new RuntimeServiceError(`Credential is not configured: ${name}.`, 'MISSING_CREDENTIAL', { credential: name });
    return value;
  }

  async refreshBaselines() {
    if (this.baselinePromise) return this.baselinePromise;
    this.baselinePromise = (async () => {
      this.event('baseline-started', 'Refreshing all project baselines.');
      try {
        const token = await this.requireCredential('github');
        const connector = this.connectorFactory({ token });
        const baselines = await this.baselineBuilder({ connector, registry: this.registry });
        this.baselines = baselines;
        this.event('baseline-completed', `Project baselines refreshed: ${baselines.status}.`, {
          status: baselines.status,
          projectCount: baselines.projects?.length || 0
        });
        return baselines;
      } catch (error) {
        const safe = publicError(error);
        this.event('baseline-failed', safe.message, safe);
        throw error;
      } finally {
        this.baselinePromise = null;
      }
    })();
    return this.baselinePromise;
  }

  startRun({ projectId, provider, taskId, slug = 'task', instruction = '', model = '', autoPublish = false } = {}) {
    const normalizedProjectId = assertId(projectId, 'project id');
    const normalizedProvider = assertProvider(provider);
    const normalizedTaskId = assertId(taskId, 'task id');
    const normalizedSlug = assertId(slug, 'task slug');
    const project = projectById(this.registry, normalizedProjectId);
    if (!project) throw new RuntimeServiceError(`Project is not registered: ${normalizedProjectId}.`, 'PROJECT_NOT_FOUND');
    if (this.activeByProject.has(project.id)) {
      throw new RuntimeServiceError(`Project already has an active run: ${project.id}.`, 'PROJECT_BUSY', {
        activeRunId: this.activeByProject.get(project.id)
      });
    }

    const runId = String(this.idFactory());
    if (!runId || this.runs.has(runId)) throw new RuntimeServiceError('Run id factory returned a duplicate or empty id.', 'INVALID_RUN_ID');
    const controller = new AbortController();
    const now = isoNow(this.clock);
    const record = {
      id: runId,
      projectId: project.id,
      provider: normalizedProvider,
      model: String(model || ''),
      taskId: normalizedTaskId,
      slug: normalizedSlug,
      instruction: String(instruction || project.nextTask || ''),
      autoPublish: Boolean(autoPublish),
      status: 'starting',
      startedAt: now,
      finishedAt: null,
      updatedAt: now,
      baseline: null,
      workspace: null,
      agentResult: null,
      publication: null,
      error: null
    };
    this.runs.set(runId, record);
    this.controllers.set(runId, controller);
    this.activeByProject.set(project.id, runId);
    this.event('run-started', `Agent run started for ${project.name}.`, { runId, projectId: project.id, provider: normalizedProvider });

    const promise = this.executeRun(record, project, controller.signal)
      .catch(() => {})
      .finally(() => {
        this.controllers.delete(runId);
        if (this.activeByProject.get(project.id) === runId) this.activeByProject.delete(project.id);
        this.emit('state', this.snapshotSync());
      });
    this.runPromises.set(runId, promise);
    promise.finally(() => this.runPromises.delete(runId));
    return publicRun(record);
  }

  async executeRun(record, project, signal) {
    record.status = 'running';
    record.updatedAt = isoNow(this.clock);
    this.emit('state', this.snapshotSync());
    try {
      const output = await this.projectAgentRunner.run({
        projectId: project.id,
        provider: record.provider,
        taskId: record.taskId,
        slug: record.slug,
        instruction: record.instruction,
        model: record.model,
        signal
      });
      record.baseline = output.baseline || null;
      record.workspace = output.workspace || null;
      record.agentResult = output.result || null;
      record.status = output.result?.status || 'completed';
      record.updatedAt = isoNow(this.clock);
      this.event('run-completed', `Agent run completed for ${project.name}: ${record.status}.`, {
        runId: record.id,
        projectId: project.id,
        status: record.status
      });
      if (record.autoPublish && record.status === 'ready_for_review') {
        await this.publishRun(record.id);
      }
    } catch (error) {
      const cancelled = signal.aborted || error?.code === 'CANCELLED';
      record.status = cancelled ? 'cancelled' : 'failed';
      record.error = publicError(error);
      if (error?.details?.workspacePath && !record.workspace) {
        record.workspace = {
          workspacePath: error.details.workspacePath,
          branch: error.details.branch || '',
          baseSha: ''
        };
      }
      record.updatedAt = isoNow(this.clock);
      this.event(cancelled ? 'run-cancelled' : 'run-failed', cancelled ? `Agent run cancelled for ${project.name}.` : record.error.message, {
        runId: record.id,
        projectId: project.id,
        error: record.error
      });
    } finally {
      record.finishedAt = isoNow(this.clock);
      record.updatedAt = record.finishedAt;
    }
  }

  cancelRun(runId) {
    const record = this.runs.get(String(runId || ''));
    if (!record) throw new RuntimeServiceError(`Run not found: ${runId}.`, 'RUN_NOT_FOUND');
    const controller = this.controllers.get(record.id);
    if (!controller || controller.signal.aborted) return publicRun(record);
    record.status = 'cancelling';
    record.updatedAt = isoNow(this.clock);
    controller.abort();
    this.event('run-cancelling', `Cancelling run ${record.id}.`, { runId: record.id, projectId: record.projectId });
    return publicRun(record);
  }

  cancelProject(projectId) {
    const normalizedProjectId = assertId(projectId, 'project id');
    const runId = this.activeByProject.get(normalizedProjectId);
    if (!runId) throw new RuntimeServiceError(`Project has no active run: ${normalizedProjectId}.`, 'RUN_NOT_FOUND');
    return this.cancelRun(runId);
  }

  async waitForRun(runId) {
    const id = String(runId || '');
    const promise = this.runPromises.get(id);
    if (promise) await promise;
    const record = this.runs.get(id);
    if (!record) throw new RuntimeServiceError(`Run not found: ${id}.`, 'RUN_NOT_FOUND');
    return publicRun(record);
  }

  async publishRun(runId) {
    const id = String(runId || '');
    const record = this.runs.get(id);
    if (!record) throw new RuntimeServiceError(`Run not found: ${id}.`, 'RUN_NOT_FOUND');
    if (this.publishingRuns.has(id)) throw new RuntimeServiceError(`Run is already being published: ${id}.`, 'PUBLICATION_BUSY');
    if (record.status === 'published' && record.publication) return publicRun(record);
    if (!record.agentResult || record.agentResult.status !== 'ready_for_review' || !record.workspace) {
      throw new RuntimeServiceError('Only a completed ready_for_review run may be published.', 'RUN_NOT_PUBLISHABLE');
    }
    const project = projectById(this.registry, record.projectId);
    if (!project) throw new RuntimeServiceError(`Project is not registered: ${record.projectId}.`, 'PROJECT_NOT_FOUND');

    this.publishingRuns.add(id);
    record.status = 'publishing';
    record.updatedAt = isoNow(this.clock);
    this.event('publication-started', `Publishing run ${id} as a draft PR.`, { runId: id, projectId: project.id });
    try {
      const githubToken = await this.requireCredential('github');
      const connector = this.connectorFactory({ token: githubToken });
      const publisher = this.publicationFactory({ githubConnector: connector, syncService: this.repositorySyncService });
      const publication = await publisher.publish({
        project,
        task: {
          projectId: project.id,
          taskId: record.taskId,
          slug: record.slug,
          branch: record.workspace.branch,
          baseSha: record.workspace.baseSha,
          repositoryPath: record.workspace.repositoryPath,
          workspacePath: record.workspace.workspacePath
        },
        agentResult: record.agentResult,
        githubToken
      });
      record.publication = publication;
      record.status = 'published';
      record.error = null;
      record.updatedAt = isoNow(this.clock);
      this.event('publication-completed', `Draft PR published for ${project.name}.`, {
        runId: id,
        projectId: project.id,
        pullRequest: publication.pullRequest
      });
      return publicRun(record);
    } catch (error) {
      record.status = 'publish_failed';
      record.error = publicError(error);
      record.updatedAt = isoNow(this.clock);
      this.event('publication-failed', record.error.message, { runId: id, projectId: project.id, error: record.error });
      throw error;
    } finally {
      this.publishingRuns.delete(id);
    }
  }
}

module.exports = {
  MAX_EVENTS,
  OrchestratorRuntime,
  RuntimeServiceError,
  publicError,
  publicRun,
  redactLikelySecrets,
  sanitizeStructured
};
