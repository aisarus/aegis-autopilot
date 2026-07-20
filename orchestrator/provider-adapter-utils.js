'use strict';

const DEFAULT_MAX_RESPONSE_CHARS = 2 * 1024 * 1024;

class ProviderAdapterError extends Error {
  constructor(message, { provider = '', status = 0, code = 'PROVIDER_ERROR' } = {}) {
    super(message);
    this.name = 'ProviderAdapterError';
    this.provider = provider;
    this.status = status;
    this.code = code;
  }
}

function redact(value, secrets = []) {
  let output = String(value ?? '');
  for (const secret of secrets) {
    const text = String(secret || '');
    if (text) output = output.split(text).join('[REDACTED]');
  }
  return output;
}

function safeMessage(value, secrets = [], max = 1200) {
  return redact(value, secrets).replace(/\s+/g, ' ').trim().slice(0, max);
}

function assertApiKey(apiKey, provider) {
  const value = String(apiKey || '').trim();
  if (!value) throw new ProviderAdapterError(`${provider} API key is not configured.`, { provider, code: 'NOT_CONFIGURED' });
  return value;
}

async function readResponseBody(response, { maxChars = DEFAULT_MAX_RESPONSE_CHARS } = {}) {
  const text = await response.text();
  if (text.length > maxChars) throw new ProviderAdapterError('Provider response exceeded the configured size limit.', { code: 'RESPONSE_TOO_LARGE' });
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return text; }
}

async function requestJson({ provider, endpoint, apiKey, headers, body, fetchImpl = globalThis.fetch, signal, maxResponseChars = DEFAULT_MAX_RESPONSE_CHARS }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  const secret = assertApiKey(apiKey, provider);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      throw new ProviderAdapterError(`${provider} request was cancelled.`, { provider, code: 'CANCELLED' });
    }
    throw new ProviderAdapterError(`${provider} request failed: ${safeMessage(error?.message || error, [secret])}`, {
      provider,
      code: 'NETWORK_ERROR'
    });
  }

  let payload;
  try {
    payload = await readResponseBody(response, { maxChars: maxResponseChars });
  } catch (error) {
    if (error instanceof ProviderAdapterError) {
      error.provider = provider;
      error.status = response.status;
      throw error;
    }
    throw new ProviderAdapterError(`${provider} returned an unreadable response.`, { provider, status: response.status, code: 'INVALID_RESPONSE' });
  }

  if (!response.ok) {
    const detail = payload && typeof payload === 'object'
      ? payload.error?.message || payload.message || payload.error?.status || ''
      : payload;
    throw new ProviderAdapterError(
      `${provider} request failed (${response.status})${detail ? `: ${safeMessage(detail, [secret])}` : ''}`,
      { provider, status: response.status, code: 'HTTP_ERROR' }
    );
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProviderAdapterError(`${provider} returned an invalid JSON object.`, { provider, status: response.status, code: 'INVALID_RESPONSE' });
  }
  return payload;
}

function normalizeTools(tools, { strict = false } = {}) {
  if (!Array.isArray(tools) || !tools.length) throw new TypeError('At least one function tool is required.');
  return tools.map((tool) => {
    if (!tool || tool.type !== 'function' || !tool.name || !tool.parameters) throw new TypeError('Invalid function tool declaration.');
    return {
      type: 'function',
      name: String(tool.name),
      description: String(tool.description || ''),
      parameters: tool.parameters,
      ...(strict ? { strict: true } : {})
    };
  });
}

function jsonToolOutput(value, maxChars = 120000) {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return text;
  return JSON.stringify({ truncated: true, preview: text.slice(0, maxChars - 100), originalChars: text.length });
}

module.exports = {
  DEFAULT_MAX_RESPONSE_CHARS,
  ProviderAdapterError,
  assertApiKey,
  jsonToolOutput,
  normalizeTools,
  readResponseBody,
  redact,
  requestJson,
  safeMessage
};
