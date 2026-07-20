'use strict';

const fs = require('fs');
const path = require('path');
const { assertRepository } = require('./github-connector');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, 'projects.json');

function normalizeProject(project) {
  const id = String(project?.id || '').trim();
  const name = String(project?.name || '').trim();
  const repository = assertRepository(project?.repository);
  const defaultBranch = String(project?.defaultBranch || 'main').trim();
  const statusDocuments = Array.isArray(project?.statusDocuments)
    ? [...new Set(project.statusDocuments.map((entry) => String(entry || '').trim()).filter(Boolean))]
    : [];
  const nextTask = String(project?.nextTask || '').trim();

  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) throw new TypeError(`Invalid project id: ${id || '<empty>'}`);
  if (!name) throw new TypeError(`Project ${id} has no name.`);
  if (!defaultBranch) throw new TypeError(`Project ${id} has no default branch.`);
  if (!statusDocuments.length) throw new TypeError(`Project ${id} has no status documents.`);

  return { id, name, repository, defaultBranch, statusDocuments, nextTask };
}

function validateRegistry(input) {
  if (!input || Number(input.version) !== 1 || !Array.isArray(input.projects)) {
    throw new TypeError('Unsupported project registry format.');
  }
  const projects = input.projects.map(normalizeProject);
  const ids = new Set();
  const repositories = new Set();
  for (const project of projects) {
    if (ids.has(project.id)) throw new TypeError(`Duplicate project id: ${project.id}`);
    if (repositories.has(project.repository.toLowerCase())) throw new TypeError(`Duplicate project repository: ${project.repository}`);
    ids.add(project.id);
    repositories.add(project.repository.toLowerCase());
  }
  if (projects.length !== 3) throw new TypeError(`Aegis v2 requires exactly three projects; received ${projects.length}.`);
  return { version: 1, projects };
}

function loadProjectRegistry(filePath = DEFAULT_REGISTRY_PATH) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return validateRegistry(JSON.parse(raw));
}

function projectById(registry, projectId) {
  return registry.projects.find((project) => project.id === projectId) || null;
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  loadProjectRegistry,
  normalizeProject,
  projectById,
  validateRegistry
};
