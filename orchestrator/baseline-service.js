'use strict';

const DEFAULT_MAX_DOCUMENT_CHARS = 60000;

function safeText(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeError(error, source) {
  return {
    source,
    status: Math.max(0, Number(error?.status) || 0),
    message: safeText(error?.message || error || 'Unknown error', 700)
  };
}

function normalizeIssue(issue) {
  return {
    number: Number(issue?.number) || 0,
    title: safeText(issue?.title, 300),
    state: safeText(issue?.state, 30),
    url: String(issue?.html_url || issue?.url || ''),
    updatedAt: issue?.updated_at || null,
    labels: Array.isArray(issue?.labels)
      ? issue.labels.map((label) => safeText(typeof label === 'string' ? label : label?.name, 80)).filter(Boolean)
      : []
  };
}

function normalizePullRequest(pull) {
  return {
    number: Number(pull?.number) || 0,
    title: safeText(pull?.title, 300),
    state: safeText(pull?.state, 30),
    draft: Boolean(pull?.draft),
    url: String(pull?.html_url || pull?.url || ''),
    updatedAt: pull?.updated_at || null,
    head: {
      ref: safeText(pull?.head?.ref, 200),
      sha: safeText(pull?.head?.sha, 80)
    },
    base: {
      ref: safeText(pull?.base?.ref, 200),
      sha: safeText(pull?.base?.sha, 80)
    }
  };
}

async function readStatusDocument(connector, project, documentPath, ref, maxDocumentChars) {
  try {
    const file = await connector.getFile(project.repository, documentPath, { ref });
    const fullText = String(file.decodedContent || '');
    return {
      path: documentPath,
      sha: safeText(file.sha, 100),
      size: Number(file.size) || Buffer.byteLength(fullText, 'utf8'),
      truncated: fullText.length > maxDocumentChars,
      text: fullText.slice(0, maxDocumentChars),
      error: null
    };
  } catch (error) {
    return {
      path: documentPath,
      sha: '',
      size: 0,
      truncated: false,
      text: '',
      error: safeError(error, `document:${documentPath}`)
    };
  }
}

async function buildProjectBaseline(connector, project, { maxDocumentChars = DEFAULT_MAX_DOCUMENT_CHARS } = {}) {
  const errors = [];
  let repository = null;
  try {
    repository = await connector.getRepository(project.repository);
  } catch (error) {
    errors.push(safeError(error, 'repository'));
  }

  const defaultBranch = safeText(repository?.default_branch || project.defaultBranch || 'main', 200);
  let branch = null;
  try {
    branch = await connector.getBranch(project.repository, defaultBranch);
  } catch (error) {
    errors.push(safeError(error, `branch:${defaultBranch}`));
  }
  const baseSha = safeText(branch?.commit?.sha, 80);

  const documents = await Promise.all(
    project.statusDocuments.map((documentPath) => readStatusDocument(
      connector,
      project,
      documentPath,
      baseSha || defaultBranch,
      Math.max(1000, Number(maxDocumentChars) || DEFAULT_MAX_DOCUMENT_CHARS)
    ))
  );
  documents.filter((document) => document.error).forEach((document) => errors.push(document.error));

  let openIssues = [];
  try {
    const issues = await connector.listIssues(project.repository, { state: 'open', perPage: 100 });
    openIssues = (Array.isArray(issues) ? issues : [])
      .filter((issue) => !issue?.pull_request)
      .map(normalizeIssue);
  } catch (error) {
    errors.push(safeError(error, 'open-issues'));
  }

  let openPullRequests = [];
  try {
    const pulls = await connector.listPullRequests(project.repository, { state: 'open', perPage: 100 });
    openPullRequests = (Array.isArray(pulls) ? pulls : []).map(normalizePullRequest);
  } catch (error) {
    errors.push(safeError(error, 'open-pull-requests'));
  }

  let commitStatus = null;
  if (baseSha) {
    try {
      const status = await connector.getCommitStatus(project.repository, baseSha);
      commitStatus = {
        state: safeText(status?.state || 'unknown', 40),
        totalCount: Number(status?.total_count) || (Array.isArray(status?.statuses) ? status.statuses.length : 0),
        statuses: (Array.isArray(status?.statuses) ? status.statuses : []).slice(0, 50).map((entry) => ({
          context: safeText(entry?.context, 160),
          state: safeText(entry?.state, 40),
          description: safeText(entry?.description, 300),
          targetUrl: String(entry?.target_url || '')
        }))
      };
    } catch (error) {
      errors.push(safeError(error, `commit-status:${baseSha}`));
    }
  }

  return {
    id: project.id,
    name: project.name,
    repository: project.repository,
    status: errors.length ? 'degraded' : 'ready',
    defaultBranch,
    baseSha,
    visibility: safeText(repository?.visibility || (repository?.private ? 'private' : 'public'), 30),
    archived: Boolean(repository?.archived),
    nextTask: project.nextTask,
    documents,
    openIssues,
    openPullRequests,
    commitStatus,
    errors
  };
}

async function buildAllBaselines({ connector, registry, maxDocumentChars = DEFAULT_MAX_DOCUMENT_CHARS, now = () => new Date() }) {
  if (!connector) throw new TypeError('GitHub connector is required.');
  if (!registry || !Array.isArray(registry.projects)) throw new TypeError('Validated project registry is required.');

  const projects = await Promise.all(
    registry.projects.map((project) => buildProjectBaseline(connector, project, { maxDocumentChars }))
  );
  return {
    version: 1,
    observedAt: now().toISOString(),
    status: projects.every((project) => project.status === 'ready') ? 'ready' : 'degraded',
    projects
  };
}

module.exports = {
  DEFAULT_MAX_DOCUMENT_CHARS,
  buildAllBaselines,
  buildProjectBaseline,
  normalizeIssue,
  normalizePullRequest,
  readStatusDocument,
  safeError
};
