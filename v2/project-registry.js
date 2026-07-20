const fs = require('fs');
const path = require('path');

const ALLOWED_POLICIES = Object.freeze({
  read: new Set(['automatic', 'user_approval', 'disabled']),
  branch: new Set(['automatic', 'user_approval', 'disabled']),
  commit: new Set(['task_branch_only', 'user_approval', 'disabled']),
  pullRequest: new Set(['automatic', 'user_approval', 'disabled']),
  merge: new Set(['user_approval', 'disabled'])
});

const SECRET_KEY_PATTERN = /(token|secret|api.?key|password|credential|authorization)/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function validatePolicy(policy, projectId) {
  assertPlainObject(policy, `Project ${projectId} policy`);
  const normalized = {};

  for (const [key, allowed] of Object.entries(ALLOWED_POLICIES)) {
    const value = assertNonEmptyString(policy[key], `Project ${projectId} policy.${key}`);
    if (!allowed.has(value)) {
      throw new Error(`Project ${projectId} policy.${key} has unsupported value: ${value}.`);
    }
    normalized[key] = value;
  }

  return normalized;
}

function validateProject(project, index) {
  assertPlainObject(project, `Project at index ${index}`);

  const id = assertNonEmptyString(project.id, `Project at index ${index} id`);
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Project id "${id}" must use lowercase letters, numbers, and hyphens.`);
  }

  const repository = assertNonEmptyString(project.repository, `Project ${id} repository`);
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`Project ${id} repository must use owner/name format.`);
  }

  assertPlainObject(project.agent, `Project ${id} agent`);
  assertPlainObject(project.reviewer, `Project ${id} reviewer`);

  const conversationId = project.agent.conversationId;
  if (conversationId !== null && (typeof conversationId !== 'string' || !conversationId.trim())) {
    throw new Error(`Project ${id} agent.conversationId must be null or a non-empty string.`);
  }

  return {
    id,
    name: assertNonEmptyString(project.name, `Project ${id} name`),
    repository,
    defaultBranch: assertNonEmptyString(project.defaultBranch, `Project ${id} defaultBranch`),
    agent: {
      provider: assertNonEmptyString(project.agent.provider, `Project ${id} agent.provider`),
      conversationId: conversationId === null ? null : conversationId.trim(),
      instructionProfile: assertNonEmptyString(project.agent.instructionProfile, `Project ${id} agent.instructionProfile`)
    },
    reviewer: {
      provider: assertNonEmptyString(project.reviewer.provider, `Project ${id} reviewer.provider`),
      enabled: Boolean(project.reviewer.enabled)
    },
    policy: validatePolicy(project.policy, id)
  };
}

function validateRegistry(raw) {
  assertPlainObject(raw, 'Project registry');
  if (raw.version !== 1) throw new Error(`Unsupported project registry version: ${raw.version}.`);
  if (!Array.isArray(raw.projects) || raw.projects.length === 0) {
    throw new Error('Project registry must contain at least one project.');
  }

  const projects = raw.projects.map(validateProject);
  const ids = new Set();
  const repositories = new Set();

  for (const project of projects) {
    if (ids.has(project.id)) throw new Error(`Duplicate project id: ${project.id}.`);
    if (repositories.has(project.repository.toLowerCase())) {
      throw new Error(`Duplicate project repository: ${project.repository}.`);
    }
    ids.add(project.id);
    repositories.add(project.repository.toLowerCase());
  }

  return { version: 1, projects };
}

function loadProjectRegistry(filePath = path.join(__dirname, '..', 'config', 'projects.v2.json')) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to load project registry at ${filePath}: ${error.message}`);
  }
  return validateRegistry(raw);
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => {
    if (SECRET_KEY_PATTERN.test(key)) return [key, nestedValue == null ? nestedValue : '[redacted]'];
    return [key, redactSecrets(nestedValue)];
  }));
}

function toPublicRegistry(registry) {
  return redactSecrets(validateRegistry(registry));
}

module.exports = {
  loadProjectRegistry,
  redactSecrets,
  toPublicRegistry,
  validateRegistry
};
