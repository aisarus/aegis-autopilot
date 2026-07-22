'use strict';

const assert = require('assert');
const path = require('path');
const {
  buildCommandPolicy,
  loadProjectRegistry,
  validateRegistry
} = require('../orchestrator/project-registry');

const registry = loadProjectRegistry(path.join(__dirname, '..', 'orchestrator', 'projects.json'));
assert.equal(registry.projects.length, 3);

const lamdan = registry.projects.find((project) => project.id === 'lamdan');
const edge = registry.projects.find((project) => project.id === 'edge');
const aegis = registry.projects.find((project) => project.id === 'aegis');

assert.deepEqual(Object.keys(buildCommandPolicy(lamdan, 'win32')), ['typecheck', 'check', 'verify-docs']);
assert.equal(buildCommandPolicy(lamdan, 'win32').typecheck.executable, 'npm.cmd');
assert.equal(buildCommandPolicy(lamdan, 'linux').typecheck.executable, 'npm');
assert.equal(buildCommandPolicy(edge, 'win32')['quality-fast'].executable, 'python');
assert.equal(buildCommandPolicy(edge, 'win32')['web-test'].executable, 'npm.cmd');
assert.equal(JSON.stringify(edge.verificationCommands).includes('make'), false, 'Edge Windows checks must not depend on make.');
assert.deepEqual(Object.keys(buildCommandPolicy(aegis, 'win32')), ['v2-smoke']);

const baseProject = {
  id: 'one',
  name: 'One',
  repository: 'owner/one',
  defaultBranch: 'main',
  statusDocuments: ['STATUS.md'],
  nextTask: 'Task',
  verificationCommands: [{ id: 'test', executable: 'node', windowsExecutable: 'node', args: ['--version'] }]
};
const three = {
  version: 1,
  projects: [
    baseProject,
    { ...baseProject, id: 'two', name: 'Two', repository: 'owner/two' },
    { ...baseProject, id: 'three', name: 'Three', repository: 'owner/three' }
  ]
};
assert.equal(validateRegistry(three).projects.length, 3);
assert.throws(() => validateRegistry({
  version: 1,
  projects: [
    { ...baseProject, verificationCommands: [] },
    { ...baseProject, id: 'two', repository: 'owner/two' },
    { ...baseProject, id: 'three', repository: 'owner/three' }
  ]
}), /no verification command allowlist/);
assert.throws(() => validateRegistry({
  version: 1,
  projects: [
    { ...baseProject, verificationCommands: [
      { id: 'test', executable: 'node', args: [] },
      { id: 'test', executable: 'node', args: [] }
    ] },
    { ...baseProject, id: 'two', repository: 'owner/two' },
    { ...baseProject, id: 'three', repository: 'owner/three' }
  ]
}), /duplicate verification command/);
assert.throws(() => validateRegistry({
  version: 1,
  projects: [
    { ...baseProject, verificationCommands: [{ id: 'bad', executable: '../shell', args: [] }] },
    { ...baseProject, id: 'two', repository: 'owner/two' },
    { ...baseProject, id: 'three', repository: 'owner/three' }
  ]
}), /invalid executable/);

console.log('Project registry verification policy v2 smoke test: OK');
