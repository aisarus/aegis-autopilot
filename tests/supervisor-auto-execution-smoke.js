const fs = require('fs');
const path = require('path');
const {
  automaticDecisionAllowed,
  pendingDecisionMatches
} = require('../lib/supervisor-policy');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const base = {
  autopilotEnabled: true,
  chatId: 'chat-a',
  turnsUsed: 0,
  maxTurns: 5,
  queueCount: 1
};
const decision = (action, confidence, extra = {}) => ({
  action,
  confidence,
  targetChatId: 'chat-a',
  prompt: action === 'enqueue' ? 'Continue safely' : '',
  ...extra
});

assert(!automaticDecisionAllowed({ ...base, decision: decision('enqueue', 0.75) }), 'low-confidence enqueue was allowed');
assert(automaticDecisionAllowed({ ...base, decision: decision('enqueue', 0.76) }), 'threshold enqueue was rejected');
assert(!automaticDecisionAllowed({ ...base, decision: decision('mark_done', 1) }), 'mark_done must never execute automatically');
assert(!automaticDecisionAllowed({ ...base, decision: decision('pause', 1) }), 'pause must never execute automatically');
assert(!automaticDecisionAllowed({ ...base, queueCount: 0, decision: decision('send_next', 1) }), 'send_next was allowed without a queued message');
assert(!automaticDecisionAllowed({ ...base, turnsUsed: 5, decision: decision('continue', 1) }), 'turn limit was ignored');
assert(!automaticDecisionAllowed({ ...base, chatId: 'chat-b', decision: decision('continue', 1) }), 'cross-chat decision was allowed');

const createdAt = '2026-07-20T13:00:00.000Z';
const bound = { sourceResponseHash: 'hash-1', createdAt };
const nowMs = Date.parse('2026-07-20T13:05:00.000Z');
assert(pendingDecisionMatches({ decision: bound, currentResponseHash: 'hash-1', nowMs }), 'fresh bound decision was rejected');
assert(!pendingDecisionMatches({ decision: bound, currentResponseHash: 'hash-2', nowMs }), 'decision for another response was accepted');
assert(!pendingDecisionMatches({ decision: bound, currentResponseHash: 'hash-1', nowMs: Date.parse('2026-07-20T13:11:00.001Z') }), 'expired decision was accepted');
assert(!pendingDecisionMatches({ decision: { createdAt }, currentResponseHash: 'hash-1', nowMs }), 'unbound legacy decision was accepted');

assert(main.includes("require('./lib/supervisor-policy')"), 'main does not use the tested policy module');
assert(main.includes('decision.sourceResponseHash = responseHash(state.browser.messages);'), 'decisions are not bound to the source response');
assert(main.includes('pendingDecisionMatchesCurrentResponse(decision, target)'), 'execution boundary does not reject stale decisions');
assert(main.includes('invalidatePendingDecisionForRescan'), 'stale pending decisions are not invalidated for a fresh scan');
assert(main.includes("state.queue.push(item);"), 'enqueue decision no longer creates a queue item');
assert(main.includes("const BUILD_ID = String(process.env.AEGIS_BUILD_SHA || 'development').trim();"), 'exact build id is not exposed');
assert(main.includes('view.buildId = BUILD_ID;'), 'exact build id is not published to the UI');

console.log('supervisor auto-execution behavioral smoke test: OK');
