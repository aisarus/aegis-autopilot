const fs = require('fs');
const assert = require('assert');

const main = fs.readFileSync(require.resolve('../main.js'), 'utf8');
const preload = fs.readFileSync(require.resolve('../chatgpt-preload.js'), 'utf8');

assert(main.includes('runAutopilotWatchdog'), 'autopilot watchdog is missing');
assert(main.includes('setInterval(runAutopilotWatchdog, 8000)'), 'watchdog interval is not installed');
assert(main.includes("chat.autopilotState = 'rechecking-response'"), 'response reconciliation state is missing');
assert(main.includes('Autopilot не выключен') || main.includes('Автопилот не выключен'), 'ambiguous response must not disable autopilot');
assert(!main.includes("autopilotPauseReason = 'DOM-адаптер не прочитал новый ответ уверенно.'"), 'old fatal DOM pause is still present');
assert(preload.includes('adapterRegistry.activeId()'), 'versioned adapter registry is not wired into diagnostics');
const registry = fs.readFileSync(require.resolve('../adapters/chatgpt/index.js'), 'utf8');
assert(registry.includes("require('./v2026_07')"), 'primary versioned adapter is missing');
assert(registry.includes("require('./legacy')"), 'fallback adapter is missing');
assert(registry.includes('scoreAdapter'), 'adapter scoring/fallback selection is missing');
assert(preload.includes('lastAssistantStableMs'), 'assistant stability telemetry is missing');
assert(preload.includes("message.id") || preload.includes('turnId'), 'message identity is missing');

console.log('autopilot resilience smoke test: OK');
