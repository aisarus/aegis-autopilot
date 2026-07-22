'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;

function assertId(value, label = 'identifier') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)) {
    throw new TypeError(`Invalid ${label}: ${normalized || '<empty>'}`);
  }
  return normalized;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveConfined(root, relativePath) {
  const value = String(relativePath || '').replace(/\\/g, '/');
  if (!value || path.isAbsolute(value) || value.split('/').some((segment) => segment === '..' || segment === '')) {
    throw new TypeError(`Unsafe workspace path: ${value || '<empty>'}`);
  }
  const candidate = path.resolve(root, ...value.split('/'));
  if (!isInside(path.resolve(root), candidate)) throw new TypeError(`Workspace path escapes root: ${value}`);
  return candidate;
}

function redact(text, secrets = []) {
  let output = String(text || '');
  for (const secret of secrets) {
    const value = String(secret || '');
    if (value) output = output.split(value).join('[REDACTED]');
  }
  return output;
}

function appendBounded(state, chunk, maxBytes) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = Math.max(0, maxBytes - state.bytes);
  if (remaining > 0) {
    const accepted = buffer.subarray(0, remaining);
    state.chunks.push(accepted);
    state.bytes += accepted.length;
  }
  if (buffer.length > remaining) state.truncated = true;
}

function runProcess(executable, args = [], {
  cwd,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  secrets = []
} = {}) {
  if (!executable || !Array.isArray(args)) throw new TypeError('Executable and argument array are required.');
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const stdout = { chunks: [], bytes: 0, truncated: false };
    const stderr = { chunks: [], bytes: 0, truncated: false };
    let timedOut = false;
    let spawnError = null;
    const child = spawn(executable, args.map((arg) => String(arg)), {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, Math.max(50, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    child.stdout.on('data', (chunk) => appendBounded(stdout, chunk, maxOutputBytes));
    child.stderr.on('data', (chunk) => appendBounded(stderr, chunk, maxOutputBytes));
    child.on('error', (error) => { spawnError = error; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: Number.isInteger(code) ? code : -1,
        signal: signal || null,
        timedOut,
        truncated: stdout.truncated || stderr.truncated,
        stdout: redact(Buffer.concat(stdout.chunks).toString('utf8'), secrets),
        stderr: redact(Buffer.concat(stderr.chunks).toString('utf8'), secrets),
        durationMs: Date.now() - startedAt,
        error: spawnError ? redact(spawnError.message, secrets) : ''
      });
    });
  });
}

class WorktreeService {
  constructor({
    rootDir,
    commandPolicy = {},
    secrets = [],
    processRunner = runProcess,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    defaultTimeoutMs = DEFAULT_TIMEOUT_MS
  } = {}) {
    if (!rootDir) throw new TypeError('Workspace root is required.');
    if (typeof processRunner !== 'function') throw new TypeError('Process runner is required.');
    this.rootDir = path.resolve(String(rootDir));
    this.repositoriesDir = path.join(this.rootDir, 'repositories');
    this.tasksDir = path.join(this.rootDir, 'tasks');
    this.commandPolicy = { ...commandPolicy };
    this.secrets = [...new Set(secrets.map((secret) => String(secret || '')).filter(Boolean))];
    this.processRunner = processRunner;
    this.maxOutputBytes = Math.max(4096, Number(maxOutputBytes) || DEFAULT_MAX_OUTPUT_BYTES);
    this.defaultTimeoutMs = Math.max(50, Number(defaultTimeoutMs) || DEFAULT_TIMEOUT_MS);
  }

  repositoryPath(projectId) {
    return path.join(this.repositoriesDir, assertId(projectId, 'project id'));
  }

  taskPath(projectId, taskId, slug = 'task') {
    const project = assertId(projectId, 'project id');
    const task = assertId(taskId, 'task id');
    const safeSlug = assertId(slug, 'task slug');
    return path.join(this.tasksDir, project, `${task}-${safeSlug}`);
  }

  async ensureRoot() {
    await fsp.mkdir(this.repositoriesDir, { recursive: true });
    await fsp.mkdir(this.tasksDir, { recursive: true });
    return this.rootDir;
  }

  async assertConfined(workspacePath, targetPath, { mustExist = false } = {}) {
    const resolvedWorkspace = path.resolve(workspacePath);
    const resolvedTarget = path.resolve(targetPath);
    if (!isInside(resolvedWorkspace, resolvedTarget)) throw new Error('Path escapes the task workspace.');

    const realWorkspace = await fsp.realpath(resolvedWorkspace);
    let existing = resolvedTarget;
    while (true) {
      try {
        await fsp.lstat(existing);
        break;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        if (mustExist || existing === resolvedWorkspace) throw error;
        existing = path.dirname(existing);
      }
    }
    const realExisting = await fsp.realpath(existing);
    if (!isInside(realWorkspace, realExisting)) throw new Error('Symlink escapes the task workspace.');
    if (mustExist) {
      const realTarget = await fsp.realpath(resolvedTarget);
      if (!isInside(realWorkspace, realTarget)) throw new Error('Symlink escapes the task workspace.');
    }
    return resolvedTarget;
  }

  async runGit(args, { cwd, timeoutMs = this.defaultTimeoutMs } = {}) {
    const result = await this.processRunner('git', args, {
      cwd,
      timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
      secrets: this.secrets
    });
    if (result.code !== 0 || result.timedOut) {
      const detail = (result.stderr || result.stdout || result.error || 'unknown git error').trim();
      throw new Error(`Git command failed${result.timedOut ? ' (timeout)' : ''}: ${detail.slice(0, 1000)}`);
    }
    return result;
  }

  async prepareTask({ projectId, taskId, slug = 'task', baseSha }) {
    await this.ensureRoot();
    const repositoryPath = this.repositoryPath(projectId);
    const workspacePath = this.taskPath(projectId, taskId, slug);
    const normalizedBaseSha = String(baseSha || '').trim();
    if (!normalizedBaseSha) throw new TypeError('Observed base SHA is required.');
    if (!fs.existsSync(path.join(repositoryPath, '.git'))) throw new Error(`Local repository is not initialized: ${repositoryPath}`);
    if (fs.existsSync(workspacePath)) throw new Error(`Task workspace already exists: ${workspacePath}`);

    await fsp.mkdir(path.dirname(workspacePath), { recursive: true });
    const branch = `agent/${assertId(projectId, 'project id')}/${assertId(taskId, 'task id')}-${assertId(slug, 'task slug')}`;
    await this.runGit(['-C', repositoryPath, 'worktree', 'add', '--detach', workspacePath, normalizedBaseSha]);
    try {
      await this.runGit(['-C', workspacePath, 'switch', '-c', branch]);
    } catch (error) {
      await this.runGit(['-C', repositoryPath, 'worktree', 'remove', '--force', workspacePath]).catch(() => {});
      throw error;
    }
    return { projectId, taskId, slug, branch, baseSha: normalizedBaseSha, repositoryPath, workspacePath };
  }

  async readFile(task, relativePath, { maxChars = 250000 } = {}) {
    const target = resolveConfined(task.workspacePath, relativePath);
    await this.assertConfined(task.workspacePath, target, { mustExist: true });
    const text = await fsp.readFile(target, 'utf8');
    return {
      path: String(relativePath).replace(/\\/g, '/'),
      truncated: text.length > maxChars,
      text: text.slice(0, Math.max(1, Number(maxChars) || 250000))
    };
  }

  async writeFile(task, relativePath, content) {
    const target = resolveConfined(task.workspacePath, relativePath);
    await this.assertConfined(task.workspacePath, target, { mustExist: false });
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await this.assertConfined(task.workspacePath, path.dirname(target), { mustExist: true });
    const temp = `${target}.aegis-tmp`;
    await fsp.writeFile(temp, String(content ?? ''), 'utf8');
    await this.assertConfined(task.workspacePath, temp, { mustExist: true });
    await fsp.rename(temp, target);
    return { path: String(relativePath).replace(/\\/g, '/'), bytes: Buffer.byteLength(String(content ?? ''), 'utf8') };
  }

  async status(task) {
    const result = await this.runGit(['-C', task.workspacePath, 'status', '--porcelain=v1', '--untracked-files=all']);
    return result.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  }

  async diff(task) {
    const result = await this.runGit(['-C', task.workspacePath, 'diff', '--no-ext-diff', '--unified=3', '--', '.']);
    return { text: result.stdout, truncated: result.truncated };
  }

  async runVerification(task, commandId) {
    const id = assertId(commandId, 'verification command id');
    const command = this.commandPolicy[id];
    if (!command || !command.executable || !Array.isArray(command.args)) {
      throw new Error(`Verification command is not allowlisted: ${id}`);
    }
    return this.processRunner(command.executable, command.args, {
      cwd: task.workspacePath,
      env: { ...process.env, ...(command.env || {}) },
      timeoutMs: command.timeoutMs || this.defaultTimeoutMs,
      maxOutputBytes: command.maxOutputBytes || this.maxOutputBytes,
      secrets: this.secrets
    });
  }

  async cleanupTask(task) {
    const repositoryPath = path.resolve(task.repositoryPath || this.repositoryPath(task.projectId));
    const workspacePath = path.resolve(task.workspacePath);
    if (!isInside(this.tasksDir, workspacePath)) throw new Error('Refusing to clean a workspace outside the task root.');
    if (fs.existsSync(path.join(repositoryPath, '.git'))) {
      await this.runGit(['-C', repositoryPath, 'worktree', 'remove', '--force', workspacePath]).catch(() => {});
      await this.runGit(['-C', repositoryPath, 'worktree', 'prune']).catch(() => {});
    }
    await fsp.rm(workspacePath, { recursive: true, force: true });
  }
}

module.exports = {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  WorktreeService,
  assertId,
  isInside,
  redact,
  resolveConfined,
  runProcess
};
