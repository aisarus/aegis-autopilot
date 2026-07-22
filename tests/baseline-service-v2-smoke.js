'use strict';

const assert = require('assert');
const path = require('path');
const { loadProjectRegistry } = require('../orchestrator/project-registry');
const { buildAllBaselines } = require('../orchestrator/baseline-service');

(async () => {
  const registry = loadProjectRegistry(path.join(__dirname, '..', 'orchestrator', 'projects.json'));
  const longDocument = 'x'.repeat(5000);

  const connector = {
    async getRepository(repository) {
      return {
        full_name: repository,
        default_branch: 'main',
        visibility: repository.includes('edge-mobile') ? 'private' : 'public',
        archived: false
      };
    },
    async getBranch(repository, branch) {
      return { name: branch, commit: { sha: `${repository.split('/')[1]}-sha` } };
    },
    async getFile(repository, filePath) {
      if (repository.endsWith('edge-mobile-betting-app') && filePath === 'docs/ROADMAP.md') {
        const error = new Error('Not Found');
        error.status = 404;
        throw error;
      }
      return {
        type: 'file',
        sha: `${filePath}-sha`,
        size: filePath === 'STATUS.md' ? longDocument.length : 120,
        decodedContent: filePath === 'STATUS.md' ? longDocument : `# ${filePath}\nCurrent state for ${repository}`
      };
    },
    async listIssues(repository) {
      return [
        { number: 10, title: `Issue for ${repository}`, state: 'open', html_url: 'https://example.test/issue', labels: [{ name: 'agent' }] },
        { number: 11, title: 'PR-shaped issue', state: 'open', pull_request: { url: 'https://example.test/pr' } }
      ];
    },
    async listPullRequests(repository) {
      return [{
        number: 20,
        title: `PR for ${repository}`,
        state: 'open',
        draft: true,
        html_url: 'https://example.test/pr/20',
        head: { ref: 'agent/task', sha: 'head-sha' },
        base: { ref: 'main', sha: 'base-sha' }
      }];
    },
    async getCommitStatus(repository) {
      if (repository.endsWith('aegis-autopilot')) {
        const error = new Error('Status service unavailable');
        error.status = 503;
        throw error;
      }
      return { state: 'success', total_count: 1, statuses: [{ context: 'tests', state: 'success', description: 'Passed' }] };
    }
  };

  const snapshot = await buildAllBaselines({
    connector,
    registry,
    maxDocumentChars: 2000,
    now: () => new Date('2026-07-20T09:20:00.000Z')
  });

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.observedAt, '2026-07-20T09:20:00.000Z');
  assert.equal(snapshot.projects.length, 3);
  assert.equal(snapshot.status, 'degraded');

  const lamdan = snapshot.projects.find((project) => project.id === 'lamdan');
  const edge = snapshot.projects.find((project) => project.id === 'edge');
  const aegis = snapshot.projects.find((project) => project.id === 'aegis');

  assert.equal(lamdan.baseSha, 'syllabus-to-os-sha');
  assert.equal(lamdan.openIssues.length, 1, 'pull-request entries must be removed from the issues endpoint');
  assert.equal(lamdan.openPullRequests.length, 1);
  assert.equal(lamdan.documents.find((document) => document.path === 'STATUS.md').truncated, true);
  assert.equal(lamdan.documents.find((document) => document.path === 'STATUS.md').text.length, 2000);
  assert.equal(lamdan.status, 'ready');

  assert.equal(edge.visibility, 'private');
  assert.equal(edge.status, 'degraded');
  assert(edge.errors.some((error) => error.source === 'document:docs/ROADMAP.md' && error.status === 404));
  assert(edge.documents.some((document) => document.path === 'docs/ROADMAP.md' && document.error));

  assert.equal(aegis.status, 'degraded');
  assert.equal(aegis.commitStatus, null);
  assert(aegis.errors.some((error) => error.source.startsWith('commit-status:') && error.status === 503));
  assert.equal(JSON.stringify(snapshot).includes('token'), false);

  console.log('GitHub baseline service v2 smoke test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
