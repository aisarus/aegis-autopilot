'use strict';

const assert = require('assert');
const { CodingAgentLoop } = require('../orchestrator/coding-agent-loop');

function call(id, name, args = {}) {
  return { id, name, arguments: args };
}

class SequenceAdapter {
  constructor(responses) {
    this.responses = responses.slice();
    this.startCalls = 0;
    this.continueCalls = 0;
    this.receivedToolResults = [];
  }

  async start(input) {
    this.startCalls += 1;
    assert(Array.isArray(input.tools));
    assert(input.systemPrompt.includes('bounded coding agent'));
    return this.responses.shift();
  }

  async continue(input) {
    this.continueCalls += 1;
    this.receivedToolResults.push(input.toolResults);
    return this.responses.shift();
  }
}

function fakeWorktree() {
  const files = { 'src/example.js': 'module.exports = 1;\n' };
  const actions = [];
  return {
    actions,
    files,
    async readFile(_task, filePath, { maxChars }) {
      actions.push(['read', filePath, maxChars]);
      const text = files[filePath] || '';
      return { path: filePath, text: text.slice(0, maxChars), truncated: text.length > maxChars };
    },
    async writeFile(_task, filePath, content) {
      actions.push(['write', filePath, content.length]);
      files[filePath] = content;
      return { path: filePath, bytes: Buffer.byteLength(content, 'utf8') };
    },
    async status() {
      actions.push(['status']);
      return [' M src/example.js'];
    },
    async diff() {
      actions.push(['diff']);
      return { text: '-module.exports = 1;\n+module.exports = 2;\n', truncated: false };
    },
    async runVerification(_task, commandId) {
      actions.push(['verify', commandId]);
      return { code: commandId === 'fail' ? 2 : 0, stdout: 'ok', stderr: '', timedOut: false, truncated: false, durationMs: 8 };
    }
  };
}

const task = {
  projectId: 'demo',
  taskId: 'v2-005',
  branch: 'agent/demo/v2-005-loop',
  baseSha: 'base-sha',
  workspacePath: '/tmp/fake-worktree'
};
const project = { id: 'demo', name: 'Demo', repository: 'owner/demo', nextTask: 'Change one value.' };
const baseline = {
  status: 'ready',
  defaultBranch: 'main',
  baseSha: 'base-sha',
  documents: [{ path: 'STATUS.md', sha: 'doc-sha', text: '# Status\nChange one value.', truncated: false }],
  openIssues: [],
  openPullRequests: [],
  errors: []
};

(async () => {
  const worktree = fakeWorktree();
  const adapter = new SequenceAdapter([
    { sessionId: 's1', toolCalls: [call('c1', 'read_file', { path: 'src/example.js', maxChars: 1000 })] },
    { sessionId: 's2', toolCalls: [call('c2', 'write_file', { path: 'src/example.js', content: 'module.exports = 2;\n' })] },
    { sessionId: 's3', toolCalls: [call('c3', 'run_verification', { commandId: 'unit' })] },
    { sessionId: 's4', toolCalls: [call('c4', 'git_status'), call('c5', 'git_diff')] },
    { sessionId: 's5', toolCalls: [call('c6', 'finish', {
      status: 'ready_for_review',
      summary: 'Changed the requested value and verified it.',
      tests: ['unit: passed'],
      risks: []
    })] }
  ]);
  const loop = new CodingAgentLoop({ modelAdapter: adapter, worktreeService: worktree });
  const result = await loop.run({ project, task, baseline, instruction: 'Change one value.' });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ready_for_review');
  assert.equal(result.usage.turns, 5);
  assert.equal(result.usage.toolCalls, 6);
  assert.equal(result.usage.writes, 1);
  assert.equal(result.verifications.length, 1);
  assert.equal(result.verifications[0].code, 0);
  assert.equal(worktree.files['src/example.js'], 'module.exports = 2;\n');
  assert.deepEqual(worktree.actions.map((entry) => entry[0]), ['read', 'write', 'verify', 'status', 'diff']);
  assert.equal(result.audit.some((entry) => entry.summary.includes('module.exports')), false, 'Audit must not contain file contents.');
  assert.equal(adapter.receivedToolResults.length, 4);

  const unknown = new CodingAgentLoop({
    modelAdapter: new SequenceAdapter([{ sessionId: 'u1', toolCalls: [call('u-call', 'shell', { command: 'rm -rf .' })] }]),
    worktreeService: fakeWorktree()
  });
  await assert.rejects(() => unknown.run({ project, task, baseline }), /Unknown coding-agent tool/);

  const multipleWrites = new CodingAgentLoop({
    modelAdapter: new SequenceAdapter([{
      sessionId: 'm1',
      toolCalls: [
        call('m-call-1', 'write_file', { path: 'a.txt', content: 'a' }),
        call('m-call-2', 'write_file', { path: 'b.txt', content: 'b' })
      ]
    }]),
    worktreeService: fakeWorktree()
  });
  await assert.rejects(() => multipleWrites.run({ project, task, baseline }), (error) => error.code === 'MULTIPLE_MUTATIONS');

  const premature = new CodingAgentLoop({
    modelAdapter: new SequenceAdapter([{ sessionId: 'p1', toolCalls: [call('p-call', 'finish', {
      status: 'ready_for_review', summary: 'Too early', tests: [], risks: []
    })] }]),
    worktreeService: fakeWorktree()
  });
  await assert.rejects(() => premature.run({ project, task, baseline }), (error) => error.code === 'PREMATURE_FINISH');

  const budget = new CodingAgentLoop({
    modelAdapter: new SequenceAdapter([{
      sessionId: 'b1',
      toolCalls: [call('b-call-1', 'read_file', { path: 'a.txt' }), call('b-call-2', 'read_file', { path: 'b.txt' })]
    }]),
    worktreeService: fakeWorktree(),
    budgets: { maxToolCalls: 1 }
  });
  await assert.rejects(() => budget.run({ project, task, baseline }), (error) => error.code === 'TOOL_BUDGET_EXHAUSTED');

  const failedVerification = new CodingAgentLoop({
    modelAdapter: new SequenceAdapter([
      { sessionId: 'f1', toolCalls: [call('f-call-1', 'run_verification', { commandId: 'fail' })] },
      { sessionId: 'f2', toolCalls: [call('f-call-2', 'git_status'), call('f-call-3', 'git_diff')] },
      { sessionId: 'f3', toolCalls: [call('f-call-4', 'finish', {
        status: 'ready_for_review', summary: 'Incorrect claim', tests: ['failed'], risks: []
      })] }
    ]),
    worktreeService: fakeWorktree()
  });
  await assert.rejects(() => failedVerification.run({ project, task, baseline }), (error) => error.code === 'INVALID_FINISH_STATUS');

  const controller = new AbortController();
  controller.abort();
  const cancelledAdapter = new SequenceAdapter([{ sessionId: 'x', toolCalls: [] }]);
  const cancelled = new CodingAgentLoop({ modelAdapter: cancelledAdapter, worktreeService: fakeWorktree() });
  await assert.rejects(() => cancelled.run({ project, task, baseline, signal: controller.signal }), (error) => error.code === 'CANCELLED');
  assert.equal(cancelledAdapter.startCalls, 0, 'Cancelled run must not call the model.');

  console.log('Bounded coding agent loop v2 smoke test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
