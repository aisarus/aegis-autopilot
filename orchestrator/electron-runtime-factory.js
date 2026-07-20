'use strict';

const path = require('path');
const { CredentialStore } = require('./credential-store');
const { loadProjectRegistry } = require('./project-registry');
const { ProjectAgentRunner } = require('./project-agent-runner');
const { RepositorySyncService } = require('./repository-sync-service');
const { OrchestratorRuntime } = require('./runtime-service');

function createRuntimeComponents({
  safeStorage,
  userDataPath,
  registryPath,
  platform = process.platform,
  connectorFactory,
  baselineBuilder,
  publicationFactory,
  adapterFactories
} = {}) {
  if (!safeStorage) throw new TypeError('Electron safeStorage is required.');
  if (!userDataPath) throw new TypeError('Electron userData path is required.');

  const rootDir = path.join(path.resolve(String(userDataPath)), 'github-orchestrator-v2');
  const registry = loadProjectRegistry(registryPath);
  const credentialStore = new CredentialStore({
    safeStorage,
    filePath: path.join(rootDir, 'credentials.json')
  });
  const repositorySyncService = new RepositorySyncService({ rootDir });
  const projectAgentRunner = new ProjectAgentRunner({
    registry,
    credentialStore,
    repositorySyncService,
    worktreeRoot: rootDir,
    platform,
    ...(connectorFactory ? { connectorFactory } : {}),
    ...(adapterFactories ? { adapterFactories } : {})
  });
  const runtime = new OrchestratorRuntime({
    registry,
    credentialStore,
    projectAgentRunner,
    repositorySyncService,
    ...(connectorFactory ? { connectorFactory } : {}),
    ...(baselineBuilder ? { baselineBuilder } : {}),
    ...(publicationFactory ? { publicationFactory } : {})
  });

  return {
    rootDir,
    registry,
    credentialStore,
    repositorySyncService,
    projectAgentRunner,
    runtime
  };
}

module.exports = {
  createRuntimeComponents
};
