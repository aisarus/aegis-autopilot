'use strict';

const assert = require('assert');
const path = require('path');
const {
  GitHubConnector,
  GitHubConnectorError
} = require('../orchestrator/github-connector');
const {
  loadProjectRegistry,
  projectById
} = require('../orchestrator/project-registry');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return payload === null || payload === undefined ? '' : JSON.stringify(payload); }
  };
}

(async () => {
  const calls = [];
  const queuedResponses = [
    response(200, { full_name: 'aisarus/syllabus-to-os', default_branch: 'main' }),
    response(200, { type: 'file', encoding: 'base64', content: Buffer.from('# Status\nReady', 'utf8').toString('base64'), sha: 'abc' }),
    response(201, { number: 101, title: 'Agent task' }),
    response(201, { ref: 'refs/heads/agent/test' }),
    response(200, { content: { sha: 'file-sha' }, commit: { sha: 'commit-sha' } }),
    response(201, { number: 102, draft: true }),
    response(200, { state: 'success', statuses: [] })
  ];
  const connector = new GitHubConnector({
    token: 'test-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return queuedResponses.shift();
    }
  });

  assert.equal(connector.isConfigured(), true);
  const repo = await connector.getRepository('aisarus/syllabus-to-os');
  assert.equal(repo.default_branch, 'main');

  const file = await connector.getFile('aisarus/syllabus-to-os', 'docs/STATUS.md', { ref: 'main' });
  assert.equal(file.decodedContent, '# Status\nReady');

  await connector.createIssue('aisarus/syllabus-to-os', {
    title: 'Agent task',
    body: 'Do the next verified slice.',
    labels: ['agent']
  });
  await connector.createBranch('aisarus/syllabus-to-os', { branch: 'agent/test', sha: 'base-sha' });
  await connector.putFile('aisarus/syllabus-to-os', 'docs/agent/state.md', {
    content: 'state',
    message: 'docs: update agent state',
    branch: 'agent/test'
  });
  await connector.createPullRequest('aisarus/syllabus-to-os', {
    title: 'Agent test',
    head: 'agent/test',
    base: 'main',
    body: 'Automated verified slice.'
  });
  await connector.getCommitStatus('aisarus/syllabus-to-os', 'commit-sha');

  assert.equal(calls.length, 7);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, 'Bearer test-token');
    assert.equal(call.options.headers['X-GitHub-Api-Version'], '2022-11-28');
  }
  assert(calls[1].url.includes('/contents/docs/STATUS.md?ref=main'));
  assert.equal(calls[2].options.method, 'POST');
  assert.equal(JSON.parse(calls[2].options.body).title, 'Agent task');
  assert.equal(calls[4].options.method, 'PUT');
  assert.equal(Buffer.from(JSON.parse(calls[4].options.body).content, 'base64').toString('utf8'), 'state');
  assert.equal(JSON.parse(calls[5].options.body).draft, true);

  const registry = loadProjectRegistry(path.join(__dirname, '..', 'orchestrator', 'projects.json'));
  assert.equal(registry.projects.length, 3);
  assert.equal(projectById(registry, 'lamdan').repository, 'aisarus/syllabus-to-os');
  assert.equal(projectById(registry, 'edge').repository, 'aisarus/edge-mobile-betting-app');
  assert.equal(projectById(registry, 'aegis').repository, 'aisarus/aegis-autopilot');

  const unauthorized = new GitHubConnector({
    token: 'bad-token',
    fetchImpl: async () => response(401, { message: 'Bad credentials' })
  });
  await assert.rejects(
    () => unauthorized.getRepository('aisarus/aegis-autopilot'),
    (error) => error instanceof GitHubConnectorError && error.status === 401 && !error.message.includes('bad-token')
  );

  assert.throws(() => connector.getRepository('../unsafe'), /Invalid GitHub repository/);
  assert.throws(() => connector.putFile('aisarus/aegis-autopilot', '../secret', { content: '', message: 'x', branch: 'main' }), /Invalid repository path/);

  console.log('GitHub connector v2 smoke test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
