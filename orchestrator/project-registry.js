'use strict';

const fs = require('fs');
const path = require('path');
const { assertRepository } = require('./github-connector');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, 'projects.json');

function normalizeVerificationCommand(command, projectId) {
  const id = String(command?.id || '').trim().toLowerCase();
  const executable = String(command?.executable || '').trim();
  const windowsExecutable = String(command?.windowsExecutable || executable).trim();
  const args = Array.isArray(command?.args) ? command.args.map((entry) => String(entry)) : [];
  const timeoutMs = Math.max(1000, Math.min(60 * 60 * 1000, Number(command?.timeoutMs) || 600000));

  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) throw new TypeError(`Project ${projectId} has an invalid verification command id: ${id || '<empty>'}`);
  for (const [label, value] of [['executable', executable], ['windowsExecutable', windowsExecutable]]) {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(value)) throw new TypeError(`Project ${projectId} verification ${id} has an invalid ${label}.`);
  }
  if (args.length > 40 || args.some((entry) => entry.length > 1000 || entry.includes('\0'))) {
    throw new TypeError(`Project ${projectId} verification ${id} has invalid arguments.`);
  }
  return { id, executable, windowsExecutable, args, timeoutMs };
}

function normalizeProject(project) {
  const id = String(project?.id || '').trim();
  const name = String(project?.name || '').trim();
  const repository = assertRepository(project?.repository);
  const defaultBranch = String(project?.defaultBranch || 'main').trim();
  const statusDocuments = Array.isArray(project?.statusDocuments)
    ? [...new Set(project.statusDocuments.map((entry) => String(entry || '').trim()).filter(Boolean))]
    : [];
  const nextTask = String(project?.nextTask || '').trim();
  const verificationCommands = Array.isArray(project?.verificationCommands)
    ? project.verificationCommands.map((command) => normalizeVerificationCommand(command, id))
    : [];

  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) throw new TypeError(`Invalid project id: ${id || '<empty>'}`);
  if (!name) throw new TypeError(`Project ${id} has no name.`);
  if (!defaultBranch) throw new TypeError(`Project ${id} has no default branch.`);
  if (!statusDocuments.length) throw new TypeError(`Project ${id} has no status documents.`);
  if (!verificationCommands.length) throw new TypeError(`Project ${id} has no verification command allowlist.`);
  const commandIds = new Set();
  for (const command of verificationCommands) {
    if (commandIds.has(command.id)) throw new TypeError(`Project ${id} has duplicate verification command: ${command.id}`);
    commandIds.add(command.id);
  }

  return { id, name, repository, defaultBranch, statusDocuments, nextTask, verificationCommands };
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

function buildCommandPolicy(project, platform = process.platform) {
  if (!project || !Array.isArray(project.verificationCommands)) throw new TypeError('Validated project is required.');
  return Object.fromEntries(project.verificationCommands.map((command) => [command.id, {
    executable: platform === 'win32' ? command.windowsExecutable : command.executable,
    args: command.args.slice(),
    timeoutMs: command.timeoutMs
  }]));
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  buildCommandPolicy,
  loadProjectRegistry,
  normalizeProject,
  normalizeVerificationCommand,
  projectById,
  validateRegistry
};
