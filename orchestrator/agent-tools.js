'use strict';

const TOOL_NAMES = Object.freeze([
  'read_file',
  'write_file',
  'git_status',
  'git_diff',
  'run_verification',
  'finish'
]);

const FINAL_STATUSES = Object.freeze(['ready_for_review', 'blocked', 'needs_user']);

const TOOL_DEFINITIONS = Object.freeze([
  {
    type: 'function',
    name: 'read_file',
    description: 'Read one UTF-8 file inside the current task worktree. Paths are relative to the worktree.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 500 },
        maxChars: { type: 'integer', minimum: 100, maximum: 250000 }
      },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'write_file',
    description: 'Create or replace one UTF-8 file inside the current task worktree. Paths are relative to the worktree.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 500 },
        content: { type: 'string', maxLength: 250000 }
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'git_status',
    description: 'Return the current worktree git status. Call this after edits and before finish.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    type: 'function',
    name: 'git_diff',
    description: 'Return the current bounded unified diff. Call this after edits and before finish.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    type: 'function',
    name: 'run_verification',
    description: 'Run one verification command from the project allowlist. Arbitrary commands are unavailable.',
    parameters: {
      type: 'object',
      properties: {
        commandId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' }
      },
      required: ['commandId'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'finish',
    description: 'Finish the bounded task after inspecting status and diff and running verification.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: FINAL_STATUSES },
        summary: { type: 'string', minLength: 1, maxLength: 4000 },
        tests: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 500 } },
        risks: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 500 } }
      },
      required: ['status', 'summary', 'tests', 'risks'],
      additionalProperties: false
    }
  }
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoExtraKeys(value, allowed, toolName) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new TypeError(`${toolName} contains unsupported arguments: ${extras.join(', ')}`);
}

function assertRelativePath(value) {
  const path = String(value || '').trim().replace(/\\/g, '/');
  if (!path || path.length > 500 || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) {
    throw new TypeError('Tool path must be a non-empty relative path.');
  }
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TypeError('Tool path contains an unsafe segment.');
  }
  return path;
}

function parseArguments(input, toolName) {
  let value = input;
  if (typeof value === 'string') {
    if (value.length > 300000) throw new TypeError(`${toolName} arguments are too large.`);
    try { value = JSON.parse(value); }
    catch { throw new TypeError(`${toolName} arguments are not valid JSON.`); }
  }
  if (!isPlainObject(value)) throw new TypeError(`${toolName} arguments must be an object.`);
  return value;
}

function boundedString(value, { name, min = 0, max }) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
  if (value.length < min || value.length > max) throw new TypeError(`${name} must contain ${min}-${max} characters.`);
  return value;
}

function boundedStringArray(value, { name, maxItems, maxChars }) {
  if (!Array.isArray(value) || value.length > maxItems) throw new TypeError(`${name} must be an array with at most ${maxItems} items.`);
  return value.map((entry, index) => boundedString(entry, { name: `${name}[${index}]`, min: 1, max: maxChars }).trim());
}

function validateToolArguments(toolName, rawArguments) {
  if (!TOOL_NAMES.includes(toolName)) throw new TypeError(`Unknown coding-agent tool: ${toolName}`);
  const args = parseArguments(rawArguments, toolName);

  if (toolName === 'read_file') {
    assertNoExtraKeys(args, ['path', 'maxChars'], toolName);
    const maxChars = args.maxChars === undefined ? 60000 : Number(args.maxChars);
    if (!Number.isInteger(maxChars) || maxChars < 100 || maxChars > 250000) throw new TypeError('read_file.maxChars must be an integer between 100 and 250000.');
    return { path: assertRelativePath(args.path), maxChars };
  }

  if (toolName === 'write_file') {
    assertNoExtraKeys(args, ['path', 'content'], toolName);
    return {
      path: assertRelativePath(args.path),
      content: boundedString(args.content, { name: 'write_file.content', min: 0, max: 250000 })
    };
  }

  if (toolName === 'git_status' || toolName === 'git_diff') {
    assertNoExtraKeys(args, [], toolName);
    return {};
  }

  if (toolName === 'run_verification') {
    assertNoExtraKeys(args, ['commandId'], toolName);
    const commandId = String(args.commandId || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(commandId)) throw new TypeError('run_verification.commandId is invalid.');
    return { commandId };
  }

  assertNoExtraKeys(args, ['status', 'summary', 'tests', 'risks'], toolName);
  const status = String(args.status || '').trim();
  if (!FINAL_STATUSES.includes(status)) throw new TypeError(`finish.status must be one of: ${FINAL_STATUSES.join(', ')}.`);
  return {
    status,
    summary: boundedString(args.summary, { name: 'finish.summary', min: 1, max: 4000 }).trim(),
    tests: boundedStringArray(args.tests, { name: 'finish.tests', maxItems: 50, maxChars: 500 }),
    risks: boundedStringArray(args.risks, { name: 'finish.risks', maxItems: 30, maxChars: 500 })
  };
}

function validateToolCall(input) {
  if (!isPlainObject(input)) throw new TypeError('Tool call must be an object.');
  const id = String(input.id || input.callId || '').trim();
  const name = String(input.name || '').trim();
  if (!id || id.length > 200) throw new TypeError('Tool call id is missing or too long.');
  if (!TOOL_NAMES.includes(name)) throw new TypeError(`Unknown coding-agent tool: ${name || '<empty>'}`);
  return { id, name, arguments: validateToolArguments(name, input.arguments ?? input.args ?? {}) };
}

module.exports = {
  FINAL_STATUSES,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  assertRelativePath,
  validateToolArguments,
  validateToolCall
};
