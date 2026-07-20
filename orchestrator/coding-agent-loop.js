'use strict';

const { TOOL_DEFINITIONS, validateToolCall } = require('./agent-tools');

const DEFAULT_BUDGETS = Object.freeze({
  maxTurns: 30,
  maxToolCalls: 80,
  maxWrites: 20,
  maxWrittenBytes: 2 * 1024 * 1024,
  maxToolResultChars: 120000,
  maxAuditEntries: 200
});

class CodingAgentError extends Error {
  constructor(message, code = 'AGENT_ERROR', details = {}) {
    super(message);
    this.name = 'CodingAgentError';
    this.code = code;
    this.details = details;
  }
}

function compact(value, max = 600) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new CodingAgentError('Coding-agent run was cancelled.', 'CANCELLED');
}

function normalizeModelResponse(response) {
  if (!response || typeof response !== 'object') throw new CodingAgentError('Model adapter returned an invalid response.', 'INVALID_MODEL_RESPONSE');
  const sessionId = String(response.sessionId || response.id || '').trim();
  const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
  const text = String(response.text || response.outputText || '');
  if (!sessionId) throw new CodingAgentError('Model adapter response has no session id.', 'INVALID_MODEL_RESPONSE');
  return { sessionId, toolCalls, text };
}

function boundedJson(value, maxChars) {
  const json = JSON.stringify(value);
  if (json.length <= maxChars) return value;
  return {
    truncated: true,
    preview: json.slice(0, Math.max(0, maxChars - 120)),
    originalChars: json.length
  };
}

function buildSystemPrompt() {
  return [
    'You are a bounded coding agent working on exactly one repository task in one prepared Git worktree.',
    'Do not change the task, repository, branch or product scope.',
    'Use only the supplied tools. You cannot run arbitrary shell, commit, push, merge or create pull requests.',
    'Read the relevant files before editing. Make the smallest coherent change that satisfies the task.',
    'After edits, run at least one allowlisted verification command, inspect git_status and git_diff, then call finish.',
    'Use finish status ready_for_review only when all executed verification commands passed.',
    'Use blocked or needs_user when evidence is insufficient, a required external dependency is unavailable, or checks fail.',
    'Never claim a test ran unless run_verification returned its result.'
  ].join('\n');
}

function buildTaskInput({ project, task, baseline, instruction }) {
  const documents = Array.isArray(baseline?.documents)
    ? baseline.documents.map((document) => ({
        path: document.path,
        sha: document.sha,
        truncated: Boolean(document.truncated),
        text: String(document.text || '').slice(0, 60000),
        error: document.error || null
      }))
    : [];
  return JSON.stringify({
    project: {
      id: project?.id || task?.projectId || '',
      name: project?.name || '',
      repository: project?.repository || '',
      nextTask: project?.nextTask || ''
    },
    task: {
      id: task?.taskId || '',
      branch: task?.branch || '',
      baseSha: task?.baseSha || ''
    },
    instruction: String(instruction || project?.nextTask || ''),
    baseline: {
      defaultBranch: baseline?.defaultBranch || '',
      baseSha: baseline?.baseSha || task?.baseSha || '',
      status: baseline?.status || '',
      documents,
      openIssues: Array.isArray(baseline?.openIssues) ? baseline.openIssues.slice(0, 50) : [],
      openPullRequests: Array.isArray(baseline?.openPullRequests) ? baseline.openPullRequests.slice(0, 30) : [],
      errors: Array.isArray(baseline?.errors) ? baseline.errors.slice(0, 30) : []
    }
  }, null, 2);
}

class CodingAgentLoop {
  constructor({ modelAdapter, worktreeService, budgets = {} } = {}) {
    if (!modelAdapter || typeof modelAdapter.start !== 'function' || typeof modelAdapter.continue !== 'function') {
      throw new TypeError('Model adapter with start() and continue() is required.');
    }
    if (!worktreeService) throw new TypeError('Worktree service is required.');
    this.modelAdapter = modelAdapter;
    this.worktreeService = worktreeService;
    this.budgets = { ...DEFAULT_BUDGETS, ...budgets };
  }

  async executeTool({ call, task, state, turn, signal }) {
    throwIfAborted(signal);
    const startedAt = Date.now();
    let result;

    if (call.name === 'read_file') {
      result = await this.worktreeService.readFile(task, call.arguments.path, { maxChars: call.arguments.maxChars });
    } else if (call.name === 'write_file') {
      const bytes = Buffer.byteLength(call.arguments.content, 'utf8');
      if (state.writes + 1 > this.budgets.maxWrites) throw new CodingAgentError('File-write budget exhausted.', 'WRITE_BUDGET_EXHAUSTED');
      if (state.writtenBytes + bytes > this.budgets.maxWrittenBytes) throw new CodingAgentError('Written-byte budget exhausted.', 'WRITE_BUDGET_EXHAUSTED');
      result = await this.worktreeService.writeFile(task, call.arguments.path, call.arguments.content);
      state.writes += 1;
      state.writtenBytes += bytes;
    } else if (call.name === 'git_status') {
      const lines = await this.worktreeService.status(task);
      state.inspectedStatus = true;
      result = { lines };
    } else if (call.name === 'git_diff') {
      result = await this.worktreeService.diff(task);
      state.inspectedDiff = true;
    } else if (call.name === 'run_verification') {
      result = await this.worktreeService.runVerification(task, call.arguments.commandId);
      state.verifications.push({
        commandId: call.arguments.commandId,
        code: Number(result.code),
        timedOut: Boolean(result.timedOut),
        truncated: Boolean(result.truncated)
      });
    } else if (call.name === 'finish') {
      if (!state.inspectedStatus || !state.inspectedDiff || !state.verifications.length) {
        throw new CodingAgentError('finish requires git_status, git_diff and at least one verification result.', 'PREMATURE_FINISH');
      }
      const allPassed = state.verifications.every((verification) => verification.code === 0 && !verification.timedOut);
      if (call.arguments.status === 'ready_for_review' && !allPassed) {
        throw new CodingAgentError('ready_for_review is forbidden while a verification command failed or timed out.', 'INVALID_FINISH_STATUS');
      }
      result = { accepted: true };
    } else {
      throw new CodingAgentError(`Unknown tool: ${call.name}`, 'UNKNOWN_TOOL');
    }

    const durationMs = Date.now() - startedAt;
    const audit = {
      turn,
      callId: call.id,
      tool: call.name,
      ok: true,
      durationMs,
      summary: this.auditSummary(call, result)
    };
    state.audit.push(audit);
    if (state.audit.length > this.budgets.maxAuditEntries) state.audit.shift();
    return boundedJson({ ok: true, result }, this.budgets.maxToolResultChars);
  }

  auditSummary(call, result) {
    if (call.name === 'read_file') return `read ${compact(call.arguments.path, 300)} (${Number(result?.text?.length) || 0} chars)`;
    if (call.name === 'write_file') return `wrote ${compact(call.arguments.path, 300)} (${Number(result?.bytes) || 0} bytes)`;
    if (call.name === 'git_status') return `status lines: ${Array.isArray(result?.lines) ? result.lines.length : 0}`;
    if (call.name === 'git_diff') return `diff chars: ${Number(result?.text?.length) || 0}${result?.truncated ? ', truncated' : ''}`;
    if (call.name === 'run_verification') return `verification ${compact(call.arguments.commandId, 100)} exit=${Number(result?.code)}${result?.timedOut ? ' timeout' : ''}`;
    return `finish ${compact(call.arguments.status, 50)}`;
  }

  async run({ project, task, baseline, instruction = '', signal } = {}) {
    throwIfAborted(signal);
    if (!task?.workspacePath) throw new TypeError('Prepared task worktree is required.');

    const state = {
      turn: 0,
      toolCalls: 0,
      writes: 0,
      writtenBytes: 0,
      inspectedStatus: false,
      inspectedDiff: false,
      verifications: [],
      seenCallIds: new Set(),
      audit: []
    };
    const common = {
      systemPrompt: buildSystemPrompt(),
      tools: TOOL_DEFINITIONS,
      signal
    };
    let response = normalizeModelResponse(await this.modelAdapter.start({
      ...common,
      input: buildTaskInput({ project, task, baseline, instruction })
    }));

    while (state.turn < this.budgets.maxTurns) {
      throwIfAborted(signal);
      state.turn += 1;
      if (!response.toolCalls.length) {
        throw new CodingAgentError('Model returned no tool call before finishing the task.', 'NO_TOOL_CALL', { text: compact(response.text, 1000) });
      }

      const calls = response.toolCalls.map((rawCall) => validateToolCall(rawCall));
      const writeCount = calls.filter((call) => call.name === 'write_file').length;
      if (writeCount > 1) throw new CodingAgentError('Only one write_file call is allowed per model turn.', 'MULTIPLE_MUTATIONS');
      const finishCalls = calls.filter((call) => call.name === 'finish');
      if (finishCalls.length && calls.length !== 1) throw new CodingAgentError('finish must be the only tool call in its turn.', 'INVALID_FINISH_TURN');

      const toolResults = [];
      for (const call of calls) {
        throwIfAborted(signal);
        if (state.seenCallIds.has(call.id)) throw new CodingAgentError(`Duplicate tool call id: ${call.id}`, 'DUPLICATE_CALL_ID');
        state.seenCallIds.add(call.id);
        state.toolCalls += 1;
        if (state.toolCalls > this.budgets.maxToolCalls) throw new CodingAgentError('Tool-call budget exhausted.', 'TOOL_BUDGET_EXHAUSTED');

        try {
          const output = await this.executeTool({ call, task, state, turn: state.turn, signal });
          toolResults.push({ callId: call.id, name: call.name, output });
        } catch (error) {
          state.audit.push({
            turn: state.turn,
            callId: call.id,
            tool: call.name,
            ok: false,
            durationMs: 0,
            summary: compact(error?.message || error, 600)
          });
          throw error;
        }

        if (call.name === 'finish') {
          return {
            ok: true,
            status: call.arguments.status,
            summary: call.arguments.summary,
            tests: call.arguments.tests,
            risks: call.arguments.risks,
            usage: {
              turns: state.turn,
              toolCalls: state.toolCalls,
              writes: state.writes,
              writtenBytes: state.writtenBytes
            },
            verifications: state.verifications,
            audit: state.audit.slice()
          };
        }
      }

      throwIfAborted(signal);
      response = normalizeModelResponse(await this.modelAdapter.continue({
        ...common,
        sessionId: response.sessionId,
        toolResults
      }));
    }

    throw new CodingAgentError('Model-turn budget exhausted.', 'TURN_BUDGET_EXHAUSTED');
  }
}

module.exports = {
  CodingAgentError,
  CodingAgentLoop,
  DEFAULT_BUDGETS,
  boundedJson,
  buildSystemPrompt,
  buildTaskInput,
  normalizeModelResponse,
  throwIfAborted
};
