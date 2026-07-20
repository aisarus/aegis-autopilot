'use strict';

const DEFAULT_API_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';

class GitHubConnectorError extends Error {
  constructor(message, { status = 0, method = '', endpoint = '', response = null } = {}) {
    super(message);
    this.name = 'GitHubConnectorError';
    this.status = status;
    this.method = method;
    this.endpoint = endpoint;
    this.response = response;
  }
}

function assertRepository(repository) {
  const value = String(repository || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new TypeError(`Invalid GitHub repository: ${value || '<empty>'}`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new TypeError(`Invalid GitHub repository: ${value}`);
  }
  return value;
}

function encodeRepository(repository) {
  return assertRepository(repository).split('/').map(encodeURIComponent).join('/');
}

function encodePath(filePath) {
  const value = String(filePath || '').replace(/^\/+/, '');
  if (!value || value.includes('..')) throw new TypeError(`Invalid repository path: ${value || '<empty>'}`);
  return value.split('/').map(encodeURIComponent).join('/');
}

class GitHubConnector {
  constructor({ token, apiUrl = DEFAULT_API_URL, fetchImpl = globalThis.fetch, userAgent = 'Aegis-GitHub-Orchestrator' } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    this.token = String(token || '').trim();
    this.apiUrl = String(apiUrl || DEFAULT_API_URL).replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.userAgent = userAgent;
  }

  isConfigured() {
    return Boolean(this.token);
  }

  async request(method, endpoint, { body, headers = {} } = {}) {
    if (!this.token) throw new GitHubConnectorError('GitHub token is not configured.');
    const normalizedMethod = String(method || 'GET').toUpperCase();
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const response = await this.fetch(`${this.apiUrl}${normalizedEndpoint}`, {
      method: normalizedMethod,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': this.userAgent,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = text; }
    }

    if (!response.ok) {
      const detail = payload && typeof payload === 'object' ? payload.message : payload;
      throw new GitHubConnectorError(
        `GitHub ${normalizedMethod} ${normalizedEndpoint} failed (${response.status})${detail ? `: ${detail}` : ''}`,
        { status: response.status, method: normalizedMethod, endpoint: normalizedEndpoint, response: payload }
      );
    }

    return payload;
  }

  getRepository(repository) {
    return this.request('GET', `/repos/${encodeRepository(repository)}`);
  }

  async getFile(repository, filePath, { ref = '' } = {}) {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const payload = await this.request('GET', `/repos/${encodeRepository(repository)}/contents/${encodePath(filePath)}${query}`);
    if (!payload || Array.isArray(payload) || payload.type !== 'file') {
      throw new GitHubConnectorError(`Repository path is not a file: ${filePath}`);
    }
    return {
      ...payload,
      decodedContent: payload.encoding === 'base64'
        ? Buffer.from(String(payload.content || '').replace(/\s+/g, ''), 'base64').toString('utf8')
        : String(payload.content || '')
    };
  }

  listIssues(repository, { state = 'open', perPage = 30 } = {}) {
    const count = Math.min(100, Math.max(1, Number(perPage) || 30));
    return this.request('GET', `/repos/${encodeRepository(repository)}/issues?state=${encodeURIComponent(state)}&per_page=${count}`);
  }

  createIssue(repository, { title, body = '', labels = [], assignees = [] }) {
    const normalizedTitle = String(title || '').trim();
    if (!normalizedTitle) throw new TypeError('Issue title is required.');
    return this.request('POST', `/repos/${encodeRepository(repository)}/issues`, {
      body: { title: normalizedTitle, body: String(body || ''), labels, assignees }
    });
  }

  createBranch(repository, { branch, sha }) {
    const normalizedBranch = String(branch || '').trim().replace(/^refs\/heads\//, '');
    const normalizedSha = String(sha || '').trim();
    if (!normalizedBranch || !normalizedSha) throw new TypeError('Branch name and base SHA are required.');
    return this.request('POST', `/repos/${encodeRepository(repository)}/git/refs`, {
      body: { ref: `refs/heads/${normalizedBranch}`, sha: normalizedSha }
    });
  }

  putFile(repository, filePath, { content, message, branch, sha = '' }) {
    const normalizedMessage = String(message || '').trim();
    const normalizedBranch = String(branch || '').trim();
    if (!normalizedMessage || !normalizedBranch) throw new TypeError('Commit message and branch are required.');
    const body = {
      message: normalizedMessage,
      branch: normalizedBranch,
      content: Buffer.from(String(content ?? ''), 'utf8').toString('base64')
    };
    if (sha) body.sha = String(sha);
    return this.request('PUT', `/repos/${encodeRepository(repository)}/contents/${encodePath(filePath)}`, { body });
  }

  createPullRequest(repository, { title, head, base = 'main', body = '', draft = true }) {
    const normalizedTitle = String(title || '').trim();
    const normalizedHead = String(head || '').trim();
    const normalizedBase = String(base || '').trim();
    if (!normalizedTitle || !normalizedHead || !normalizedBase) {
      throw new TypeError('Pull request title, head and base are required.');
    }
    return this.request('POST', `/repos/${encodeRepository(repository)}/pulls`, {
      body: { title: normalizedTitle, head: normalizedHead, base: normalizedBase, body: String(body || ''), draft: Boolean(draft) }
    });
  }

  getCommitStatus(repository, ref) {
    const normalizedRef = String(ref || '').trim();
    if (!normalizedRef) throw new TypeError('Commit ref is required.');
    return this.request('GET', `/repos/${encodeRepository(repository)}/commits/${encodeURIComponent(normalizedRef)}/status`);
  }
}

module.exports = {
  API_VERSION,
  DEFAULT_API_URL,
  GitHubConnector,
  GitHubConnectorError,
  assertRepository,
  encodePath,
  encodeRepository
};
