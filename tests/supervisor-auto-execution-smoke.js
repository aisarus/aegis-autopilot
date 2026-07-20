const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(main.includes("function automaticDecisionAllowed(decision, chat)"), 'shared automatic decision policy is missing');
assert(main.includes("new Set(['wait', 'enqueue', 'continue', 'review', 'send_next'])"), 'safe supervisor actions are not explicitly auto-executable');
assert(main.includes('const autoAllowed = automaticDecisionAllowed(decision, active);'), 'runSupervisor does not use the shared automatic policy');
assert(main.includes("const pending = pendingDecisionForChat(chat.id);\n      if (pending && automaticDecisionAllowed(pending, chat))"), 'enabling autopilot does not recover a pending decision');
assert(main.includes('recoverPendingAutopilotDecisions().catch'), 'startup does not recover pending autopilot decisions');
assert(main.includes("state.queue.push(item);"), 'enqueue decision no longer creates a queue item');
assert(main.includes("const BUILD_ID = String(process.env.AEGIS_BUILD_SHA || 'development').trim();"), 'exact build id is not exposed');
assert(main.includes('view.buildId = BUILD_ID;'), 'exact build id is not published to the UI');

console.log('supervisor auto-execution smoke test: OK');
