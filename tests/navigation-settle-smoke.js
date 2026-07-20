const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const main = read('main.js');
const adapter = read('adapters/chatgpt/v2026_07.js');
const atomic = read('scripts/prepare-testing-source-atomic.js');

const checks = [
  ['prepared main includes a bounded chat settling loop', main.includes('async function settleAutopilotChat(chat, timeoutMs = 12000)')],
  ['scheduler awaits chat settling before hashing the response', main.includes('const settling = await settleAutopilotChat(chat, 12000);')],
  ['settling is surfaced as an explicit autopilot state', main.includes("chat.autopilotState = 'settling-chat';")],
  ['settling repeatedly requests fresh DOM inspection', main.includes("await sendChatCommand('inspect', {}, 5000)")],
  ['primary adapter recognizes the transitional ChatGPT textarea', adapter.includes('textarea[aria-label*="ChatGPT"]')],
  ['primary adapter recognizes the transitional submit button', adapter.includes('button#composer-submit-button')],
  ['atomic preparation includes navigation settling helper', atomic.includes("'scripts/prepare-navigation-settle.js'")]
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length) {
  for (const [label] of failed) console.error(`[navigation settle smoke] FAIL: ${label}`);
  process.exit(1);
}

console.log('navigation settle smoke test: OK');
