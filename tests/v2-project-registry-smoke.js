const assert = require('assert');
const path = require('path');
const {
  loadProjectRegistry,
  redactSecrets,
  toPublicRegistry,
  validateRegistry
} = require('../v2/project-registry');

const registry = loadProjectRegistry(path.join(__dirname, '..', 'config', 'projects.v2.json'));
assert.strictEqual(registry.version, 1);
assert.strictEqual(registry.projects.length, 3);
assert.deepStrictEqual(registry.projects.map((project) => project.id), ['lamdan', 'edge', 'aegis']);
assert(registry.projects.every((project) => project.policy.commit === 'task_branch_only'));
assert(registry.projects.every((project) => project.policy.merge === 'user_approval'));

assert.throws(() => validateRegistry({ version: 1, projects: [registry.projects[0], registry.projects[0]] }), /Duplicate project id/);
assert.throws(() => validateRegistry({
  version: 1,
  projects: [{ ...registry.projects[0], id: 'unsafe id' }]
}), /must use lowercase letters/);
assert.throws(() => validateRegistry({
  version: 1,
  projects: [{
    ...registry.projects[0],
    policy: { ...registry.projects[0].policy, merge: 'automatic' }
  }]
}), /unsupported value/);

const redacted = redactSecrets({
  token: 'github-token',
  nested: {
    apiKey: 'openai-key',
    Authorization: 'Bearer secret',
    harmless: 'visible'
  },
  list: [{ password: 'hidden' }]
});
assert.strictEqual(redacted.token, '[redacted]');
assert.strictEqual(redacted.nested.apiKey, '[redacted]');
assert.strictEqual(redacted.nested.Authorization, '[redacted]');
assert.strictEqual(redacted.nested.harmless, 'visible');
assert.strictEqual(redacted.list[0].password, '[redacted]');

const publicRegistry = toPublicRegistry(registry);
assert.deepStrictEqual(publicRegistry, registry);
assert.notStrictEqual(publicRegistry, registry);

console.log('v2 project registry smoke test: OK');
