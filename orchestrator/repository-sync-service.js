'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { assertRepository } = require('./github-connector');
const { assertId, runProcess } = require('./worktree-service');

const DEFAULT_SYNC_TIMEOUT_MS = 180000;

function assertBranchName(value) {
  const branch = String(value || '').trim();
  if (!branch || branch.length > 240 || branch.startsWith('-') || branch.endsWith('/') || branch.includes('..') || /[\s~^:?*\[\\]/.test(branch)) {
    throw new TypeError(`Invalid Git branch: ${branch || '<empty>'}`);
  }
  return branch;
}

function buildGitAuthEnvironment(githubToken, baseEnvironment = process.env) {
  const env = { ...baseEnvironment, GIT_TERMINAL_PROMPT: '0' };
  const token = String(githubToken || '').trim();
  if (!token) return env;
  const authorization = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')}`;
  env.GIT_CONFIG_COUNT = '1';
  env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
  env.GIT_CONFIG_VALUE_0 = authorization;
  return env;
}

function defaultRemoteUrl(repository) {
  return `https://github.com/${assertRepository(repository)}.git`;
}

class RepositorySyncService {
  constructor({
    rootDir,
    processRunner = runProcess,
    remoteUrlResolver = defaultRemoteUrl,
    timeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
    maxOutputBytes = 1024 * 1024
  } = {}) {
    if (!rootDir) throw new TypeError('Repository root is required.');
    if (typeof processRunner !== 'function') throw new TypeError('Process runner is required.');
    if (typeof remoteUrlResolver !== 'function') throw new TypeError('Remote URL resolver is required.');
    this.rootDir = path.resolve(String(rootDir));
    this.repositoriesDir = path.join(this.rootDir, 'repositories');
    this.processRunner = processRunner;
    this.remoteUrlResolver = remoteUrlResolver;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || DEFAULT_SYNC_TIMEOUT_MS);
    this.maxOutputBytes = Math.max(4096, Number(maxOutputBytes) || 1024 * 1024);
  }

  repositoryPath(projectId) {
    return path.join(this.repositoriesDir, assertId(projectId, 'project id'));
  }

  async runGit(args, { cwd, githubToken = '', allowFailure = false } = {}) {
    const token = String(githubToken || '').trim();
    const authEnvironment = buildGitAuthEnvironment(token);
    const encodedCredential = token ? String(authEnvironment.GIT_CONFIG_VALUE_0 || '') : '';
    const result = await this.processRunner('git', args, {
      cwd,
      env: authEnvironment,
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
      secrets: [token, encodedCredential].filter(Boolean)
    });
    if (!allowFailure && (result.code !== 0 || result.timedOut)) {
      const detail = String(result.stderr || result.stdout || result.error || 'unknown git error').replace(/\s+/g, ' ').trim().slice(0, 1200);
      throw new Error(`Git synchronization failed${result.timedOut ? ' (timeout)' : ''}: ${detail}`);
    }
    return result;
  }

  async ensureRepositoryDirectory(repositoryPath) {
    await fsp.mkdir(this.repositoriesDir, { recursive: true });
    if (fs.existsSync(repositoryPath) && !fs.existsSync(path.join(repositoryPath, '.git'))) {
      const entries = await fsp.readdir(repositoryPath);
      if (entries.length) throw new Error(`Repository directory exists but is not a Git repository: ${repositoryPath}`);
    }
    await fsp.mkdir(repositoryPath, { recursive: true });
  }

  async syncProject({ projectId, repository, defaultBranch = 'main', githubToken = '' } = {}) {
    const normalizedRepository = assertRepository(repository);
    const branch = assertBranchName(defaultBranch);
    const repositoryPath = this.repositoryPath(projectId);
    const remoteUrl = String(this.remoteUrlResolver(normalizedRepository) || '').trim();
    if (!remoteUrl) throw new Error(`No remote URL resolved for ${normalizedRepository}.`);

    await this.ensureRepositoryDirectory(repositoryPath);
    if (!fs.existsSync(path.join(repositoryPath, '.git'))) {
      await this.runGit(['init'], { cwd: repositoryPath });
    }

    const existingRemote = await this.runGit(['remote', 'get-url', 'origin'], {
      cwd: repositoryPath,
      allowFailure: true
    });
    if (existingRemote.code === 0) {
      if (String(existingRemote.stdout || '').trim() !== remoteUrl) {
        await this.runGit(['remote', 'set-url', 'origin', remoteUrl], { cwd: repositoryPath });
      }
    } else {
      await this.runGit(['remote', 'add', 'origin', remoteUrl], { cwd: repositoryPath });
    }

    const refspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
    await this.runGit(['fetch', '--prune', '--no-tags', 'origin', refspec], {
      cwd: repositoryPath,
      githubToken
    });
    const revision = await this.runGit(['rev-parse', `refs/remotes/origin/${branch}^{commit}`], { cwd: repositoryPath });
    const baseSha = String(revision.stdout || '').trim();
    if (!/^[0-9a-f]{40,64}$/i.test(baseSha)) throw new Error(`Git returned an invalid base SHA for ${normalizedRepository}.`);

    return {
      projectId: assertId(projectId, 'project id'),
      repository: normalizedRepository,
      defaultBranch: branch,
      baseSha,
      repositoryPath,
      remoteUrl
    };
  }
}

module.exports = {
  DEFAULT_SYNC_TIMEOUT_MS,
  RepositorySyncService,
  assertBranchName,
  buildGitAuthEnvironment,
  defaultRemoteUrl
};
