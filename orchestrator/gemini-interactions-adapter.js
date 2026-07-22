'use strict';

const {
  ProviderAdapterError,
  jsonToolOutput,
  normalizeTools,
  requestJson
} = require('./provider-adapter-utils');

const DEFAULT_GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1/interactions';

function extractGeminiText(interaction) {
  if (typeof interaction.output_text === 'string') return interaction.output_text;
  const parts = [];
  for (const step of Array.isArray(interaction.steps) ? interaction.steps : []) {
    if (step?.type !== 'model_output' && step?.type !== 'assistant_message') continue;
    for (const content of Array.isArray(step.content) ? step.content : []) {
      if (content?.type === 'text' && content.text) parts.push(String(content.text));
    }
  }
  return parts.join('\n');
}

function normalizeGeminiInteraction(interaction) {
  const status = String(interaction?.status || 'completed');
  if (['failed', 'cancelled', 'incomplete'].includes(status)) {
    const detail = interaction?.error?.message || interaction?.incomplete_details?.reason || status;
    throw new ProviderAdapterError(`Gemini interaction did not complete: ${String(detail).slice(0, 600)}`, {
      provider: 'Gemini',
      code: `INTERACTION_${status.toUpperCase()}`
    });
  }
  const sessionId = String(interaction?.id || '').trim();
  if (!sessionId) throw new ProviderAdapterError('Gemini interaction has no id.', { provider: 'Gemini', code: 'INVALID_RESPONSE' });
  const toolCalls = (Array.isArray(interaction.steps) ? interaction.steps : [])
    .filter((step) => step?.type === 'function_call')
    .map((step) => ({
      id: String(step.id || step.call_id || '').trim(),
      name: String(step.name || '').trim(),
      arguments: step.arguments && typeof step.arguments === 'object' ? step.arguments : String(step.arguments || '{}')
    }));
  return { sessionId, toolCalls, text: extractGeminiText(interaction) };
}

class GeminiInteractionsAdapter {
  constructor({
    apiKey,
    model = 'gemini-3.5-flash',
    endpoint = DEFAULT_GEMINI_ENDPOINT,
    fetchImpl = globalThis.fetch,
    thinkingLevel = 'medium',
    store = true
  } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.model = String(model || '').trim();
    this.endpoint = String(endpoint || DEFAULT_GEMINI_ENDPOINT);
    this.fetchImpl = fetchImpl;
    this.thinkingLevel = String(thinkingLevel || '').trim();
    this.store = Boolean(store);
    if (!this.model) throw new TypeError('Gemini model is required.');
  }

  requestBody({ systemPrompt, tools, input, previousInteractionId = '' }) {
    return {
      model: this.model,
      input,
      system_instruction: String(systemPrompt || ''),
      tools: normalizeTools(tools),
      generation_config: {
        tool_choice: 'any',
        ...(this.thinkingLevel ? { thinking_level: this.thinkingLevel } : {})
      },
      store: this.store,
      ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {})
    };
  }

  async create(body, signal) {
    const interaction = await requestJson({
      provider: 'Gemini',
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      fetchImpl: this.fetchImpl,
      signal,
      headers: { 'x-goog-api-key': this.apiKey },
      body
    });
    return normalizeGeminiInteraction(interaction);
  }

  start({ systemPrompt, input, tools, signal }) {
    return this.create(this.requestBody({ systemPrompt, input, tools }), signal);
  }

  continue({ systemPrompt, sessionId, toolResults, tools, signal }) {
    if (!sessionId) throw new TypeError('Gemini previous interaction id is required.');
    const input = (Array.isArray(toolResults) ? toolResults : []).map((result) => ({
      type: 'function_result',
      name: String(result.name || ''),
      call_id: String(result.callId || ''),
      result: [{ type: 'text', text: jsonToolOutput(result.output) }]
    }));
    if (!input.length) throw new TypeError('Gemini continuation requires tool results.');
    return this.create(this.requestBody({
      systemPrompt,
      input,
      tools,
      previousInteractionId: sessionId
    }), signal);
  }
}

module.exports = {
  DEFAULT_GEMINI_ENDPOINT,
  GeminiInteractionsAdapter,
  extractGeminiText,
  normalizeGeminiInteraction
};
