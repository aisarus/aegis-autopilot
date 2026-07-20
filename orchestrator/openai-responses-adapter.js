'use strict';

const {
  ProviderAdapterError,
  jsonToolOutput,
  normalizeTools,
  requestJson
} = require('./provider-adapter-utils');

const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';

function extractOpenAIText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  const parts = [];
  for (const item of Array.isArray(response.output) ? response.output : []) {
    if (item?.type !== 'message') continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content?.type === 'output_text' && content.text) parts.push(String(content.text));
      if (content?.type === 'refusal' && content.refusal) parts.push(String(content.refusal));
    }
  }
  return parts.join('\n');
}

function normalizeOpenAIResponse(response) {
  const status = String(response?.status || 'completed');
  if (['failed', 'cancelled', 'incomplete'].includes(status)) {
    const detail = response?.error?.message || response?.incomplete_details?.reason || status;
    throw new ProviderAdapterError(`OpenAI response did not complete: ${String(detail).slice(0, 600)}`, {
      provider: 'OpenAI',
      code: `RESPONSE_${status.toUpperCase()}`
    });
  }
  const sessionId = String(response?.id || '').trim();
  if (!sessionId) throw new ProviderAdapterError('OpenAI response has no id.', { provider: 'OpenAI', code: 'INVALID_RESPONSE' });
  const toolCalls = (Array.isArray(response.output) ? response.output : [])
    .filter((item) => item?.type === 'function_call')
    .map((item) => ({
      id: String(item.call_id || item.id || '').trim(),
      name: String(item.name || '').trim(),
      arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {})
    }));
  return { sessionId, toolCalls, text: extractOpenAIText(response) };
}

class OpenAIResponsesAdapter {
  constructor({
    apiKey,
    model = 'gpt-5.2',
    endpoint = DEFAULT_OPENAI_ENDPOINT,
    fetchImpl = globalThis.fetch,
    reasoningEffort = 'medium',
    maxOutputTokens = 4096,
    store = true
  } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.model = String(model || '').trim();
    this.endpoint = String(endpoint || DEFAULT_OPENAI_ENDPOINT);
    this.fetchImpl = fetchImpl;
    this.reasoningEffort = String(reasoningEffort || '').trim();
    this.maxOutputTokens = Math.max(256, Number(maxOutputTokens) || 4096);
    this.store = Boolean(store);
    if (!this.model) throw new TypeError('OpenAI model is required.');
  }

  requestBody({ systemPrompt, tools, input, previousResponseId = '' }) {
    return {
      model: this.model,
      instructions: String(systemPrompt || ''),
      input,
      tools: normalizeTools(tools, { strict: true }),
      tool_choice: 'required',
      parallel_tool_calls: false,
      max_output_tokens: this.maxOutputTokens,
      store: this.store,
      ...(this.reasoningEffort ? { reasoning: { effort: this.reasoningEffort } } : {}),
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {})
    };
  }

  async create(body, signal) {
    const response = await requestJson({
      provider: 'OpenAI',
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      fetchImpl: this.fetchImpl,
      signal,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body
    });
    return normalizeOpenAIResponse(response);
  }

  start({ systemPrompt, input, tools, signal }) {
    return this.create(this.requestBody({ systemPrompt, input, tools }), signal);
  }

  continue({ systemPrompt, sessionId, toolResults, tools, signal }) {
    if (!sessionId) throw new TypeError('OpenAI previous response id is required.');
    const input = (Array.isArray(toolResults) ? toolResults : []).map((result) => ({
      type: 'function_call_output',
      call_id: String(result.callId || ''),
      output: jsonToolOutput(result.output)
    }));
    if (!input.length) throw new TypeError('OpenAI continuation requires tool results.');
    return this.create(this.requestBody({
      systemPrompt,
      input,
      tools,
      previousResponseId: sessionId
    }), signal);
  }
}

module.exports = {
  DEFAULT_OPENAI_ENDPOINT,
  OpenAIResponsesAdapter,
  extractOpenAIText,
  normalizeOpenAIResponse
};
