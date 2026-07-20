const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(main.includes("function automaticDecisionAllowed(decision, chat)"), 'shared automatic decision policy is missing');
assert(main.includes("new Set(['wait', 'enqueue', 'continue', 'review', 'send_next'])"), 'safe supervisor actions are not explicitly auto-executable');
assert(main.includes('const autoAllowed = automaticDecisionAllowed(decision, active);'), 'runSupervisor does not use the shared automatic policy');
assert(main.includes("const pending = pendingDecisionForChat(chat.id);\n      if (pending && automaticDecisionAllowed(pending, chat))"), 'enabling autopilot does not recover a pending decision');
assert(main.includes('recoverPendingAutopilotDecisions().catch'), 'startup does not recover pending autopilot decisions');
assert(main.includes("state.queue.push(item);"), 'enqueue decision no longer creates a queue item');
assert(packageJson.version !== '1.2.4', 'build version was not advanced, so users cannot distinguish this build');

console.log('supervisor auto-execution smoke test: OK');
