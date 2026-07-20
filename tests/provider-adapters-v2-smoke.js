'use strict';

const assert = require('assert');
const { TOOL_DEFINITIONS } = require('../orchestrator/agent-tools');
const { OpenAIResponsesAdapter } = require('../orchestrator/openai-responses-adapter');
const { GeminiInteractionsAdapter } = require('../orchestrator/gemini-interactions-adapter');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return payload === undefined || payload === null ? '' : JSON.stringify(payload); }
  };
}

function queuedFetch(entries, calls) {
  return async (url, options) => {
    calls.push({ url, options });
    const next = entries.shift();
    if (next instanceof Error) throw next;
    return next;
  };
}

(async () => {
  const openAICalls = [];
  const openAI = new OpenAIResponsesAdapter({
    apiKey: 'openai-test-secret',
    model: 'gpt-test',
    fetchImpl: queuedFetch([
      response(200, {
        id: 'resp-1',
        status: 'completed',
        output: [
          { type: 'function_call', call_id: 'oa-call-1', name: 'read_file', arguments: '{"path":"README.md"}' },
          { type: 'function_call', call_id: 'oa-call-2', name: 'git_status', arguments: '{}' }
        ]
      }),
      response(200, {
        id: 'resp-2',
        status: 'completed',
        output: [{ type: 'function_call', call_id: 'oa-call-3', name: 'finish', arguments: '{"status":"blocked","summary":"Done","tests":[],"risks":["Need input"]}' }]
      })
    ], openAICalls)
  });

  const oaFirst = await openAI.start({ systemPrompt: 'system', input: 'task', tools: TOOL_DEFINITIONS });
  assert.equal(oaFirst.sessionId, 'resp-1');
  assert.equal(oaFirst.toolCalls.length, 2);
  assert.equal(oaFirst.toolCalls[0].id, 'oa-call-1');
  assert.equal(oaFirst.toolCalls[0].arguments, '{"path":"README.md"}');

  const oaSecond = await openAI.continue({
    systemPrompt: 'system',
    sessionId: oaFirst.sessionId,
    tools: TOOL_DEFINITIONS,
    toolResults: [
      { callId: 'oa-call-1', name: 'read_file', output: { ok: true, result: { text: '# Readme' } } },
      { callId: 'oa-call-2', name: 'git_status', output: { ok: true, result: { lines: [] } } }
    ]
  });
  assert.equal(oaSecond.sessionId, 'resp-2');
  assert.equal(oaSecond.toolCalls[0].name, 'finish');

  assert.equal(openAICalls.length, 2);
  assert.equal(openAICalls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(openAICalls[0].options.headers.Authorization, 'Bearer openai-test-secret');
  const oaStartBody = JSON.parse(openAICalls[0].options.body);
  assert.equal(oaStartBody.model, 'gpt-test');
  assert.equal(oaStartBody.instructions, 'system');
  assert.equal(oaStartBody.tool_choice, 'required');
  assert.equal(oaStartBody.parallel_tool_calls, false);
  assert(oaStartBody.tools.every((tool) => tool.strict === true));
  const oaContinueBody = JSON.parse(openAICalls[1].options.body);
  assert.equal(oaContinueBody.previous_response_id, 'resp-1');
  assert.equal(oaContinueBody.instructions, 'system', 'Instructions must be repeated on continuation.');
  assert.equal(oaContinueBody.tools.length, TOOL_DEFINITIONS.length, 'Tools must be repeated on continuation.');
  assert.equal(oaContinueBody.input[0].type, 'function_call_output');
  assert.equal(oaContinueBody.input[0].call_id, 'oa-call-1');

  const geminiCalls = [];
  const gemini = new GeminiInteractionsAdapter({
    apiKey: 'gemini-test-secret',
    model: 'gemini-test',
    fetchImpl: queuedFetch([
      response(200, {
        id: 'int-1',
        status: 'requires_action',
        steps: [{ type: 'function_call', id: 'g-call-1', name: 'read_file', arguments: { path: 'STATUS.md' } }]
      }),
      response(200, {
        id: 'int-2',
        status: 'requires_action',
        steps: [{ type: 'function_call', id: 'g-call-2', name: 'git_diff', arguments: {} }]
      })
    ], geminiCalls)
  });

  const gFirst = await gemini.start({ systemPrompt: 'system', input: 'task', tools: TOOL_DEFINITIONS });
  assert.equal(gFirst.sessionId, 'int-1');
  assert.deepEqual(gFirst.toolCalls[0].arguments, { path: 'STATUS.md' });
  const gSecond = await gemini.continue({
    systemPrompt: 'system',
    sessionId: gFirst.sessionId,
    tools: TOOL_DEFINITIONS,
    toolResults: [{ callId: 'g-call-1', name: 'read_file', output: { ok: true, result: { text: '# Status' } } }]
  });
  assert.equal(gSecond.sessionId, 'int-2');
  assert.equal(gSecond.toolCalls[0].name, 'git_diff');

  assert.equal(geminiCalls.length, 2);
  assert.equal(geminiCalls[0].url, 'https://generativelanguage.googleapis.com/v1/interactions');
  assert.equal(geminiCalls[0].options.headers['x-goog-api-key'], 'gemini-test-secret');
  const gStartBody = JSON.parse(geminiCalls[0].options.body);
  assert.equal(gStartBody.system_instruction, 'system');
  assert.equal(gStartBody.generation_config.tool_choice, 'any');
  const gContinueBody = JSON.parse(geminiCalls[1].options.body);
  assert.equal(gContinueBody.previous_interaction_id, 'int-1');
  assert.equal(gContinueBody.system_instruction, 'system', 'System instruction must be repeated on continuation.');
  assert.equal(gContinueBody.tools.length, TOOL_DEFINITIONS.length, 'Tools must be repeated on continuation.');
  assert.equal(gContinueBody.input[0].type, 'function_result');
  assert.equal(gContinueBody.input[0].name, 'read_file');
  assert.equal(gContinueBody.input[0].call_id, 'g-call-1');
  assert.equal(gContinueBody.input[0].result[0].type, 'text');

  const leakedSecret = 'secret-that-must-not-leak';
  const failingOpenAI = new OpenAIResponsesAdapter({
    apiKey: leakedSecret,
    fetchImpl: async () => response(401, { error: { message: `Bad key ${leakedSecret}` } })
  });
  await assert.rejects(
    () => failingOpenAI.start({ systemPrompt: 'x', input: 'x', tools: TOOL_DEFINITIONS }),
    (error) => error.status === 401 && error.code === 'HTTP_ERROR' && !error.message.includes(leakedSecret) && error.message.includes('[REDACTED]')
  );

  const incompleteGemini = new GeminiInteractionsAdapter({
    apiKey: 'key',
    fetchImpl: async () => response(200, { id: 'bad-int', status: 'incomplete', incomplete_details: { reason: 'max_tokens' }, steps: [] })
  });
  await assert.rejects(
    () => incompleteGemini.start({ systemPrompt: 'x', input: 'x', tools: TOOL_DEFINITIONS }),
    (error) => error.code === 'INTERACTION_INCOMPLETE'
  );

  const controller = new AbortController();
  controller.abort();
  let observedSignal = null;
  const cancelled = new OpenAIResponsesAdapter({
    apiKey: 'key',
    fetchImpl: async (_url, options) => {
      observedSignal = options.signal;
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
  });
  await assert.rejects(
    () => cancelled.start({ systemPrompt: 'x', input: 'x', tools: TOOL_DEFINITIONS, signal: controller.signal }),
    (error) => error.code === 'CANCELLED'
  );
  assert.equal(observedSignal, controller.signal);

  console.log('OpenAI and Gemini provider adapters v2 smoke test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
