const fs = require('fs');
const assert = require('assert');

const main = fs.readFileSync('main.js', 'utf8');
const chatPreload = fs.readFileSync('chatgpt-preload.js', 'utf8');
const atomicPrepare = fs.readFileSync('scripts/prepare-testing-source-atomic.js', 'utf8');
const responsePrepare = fs.readFileSync('scripts/prepare-autopilot-response.js', 'utf8');

assert(chatPreload.includes('function semanticAssistantFallback()'), 'semantic assistant fallback must be present after source preparation');
assert(chatPreload.includes('return semanticAssistantFallback();'), 'fallbackAssistantMessage must delegate to the semantic fallback');
assert(chatPreload.includes('assistantTextLength:'), 'ChatGPT diagnostics must expose assistant extraction length');
assert(main.includes("chat.autopilotState = 'waiting-response-dom'"), 'missing assistant extraction must be visible instead of silently watching');
assert(main.includes("addEvent('AUTOPILOT WAIT'"), 'missing assistant extraction must emit a user-visible event');
assert(main.includes("sendChatCommand('inspect', {}, 5000)"), 'response detection must actively request a fresh DOM inspection');
assert(atomicPrepare.includes("'scripts/prepare-autopilot-response.js'"), 'response preparation must run inside the atomic transaction');
assert(responsePrepare.includes('semantic assistant fallback extractor'), 'response preparation must retain its named transformation');

console.log('autopilot response detection smoke test: OK');
