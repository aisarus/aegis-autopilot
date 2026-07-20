const fs = require('fs');
const assert = require('assert');
const main = fs.readFileSync('main.js', 'utf8');
const preload = fs.readFileSync('chatgpt-preload.js', 'utf8');

const sendCall = main.match(/sendChatCommand\(\s*['"]send['"]\s*,\s*\{([\s\S]*?)\}\s*,\s*22000\s*\)/);
assert(sendCall, 'dispatcher must issue a verified send command');
assert(/\btext\s*:\s*item\.text\b/.test(sendCall[1]), 'dispatcher must send the queued item text');
assert(/\btargetUrl\s*:\s*chat\.url\b/.test(sendCall[1]), 'dispatcher must bind send to the target conversation');
assert(preload.includes("targetUrl && !sameUrl(location.href, targetUrl)"), 'send must reject cross-conversation races');
assert(preload.includes('function explicitUserMessages()'), 'send verification needs a direct user-turn scanner');
assert(preload.includes('evidence.fingerprint !== beforeUser.fingerprint && evidence.intendedMatch'), 'send must verify a new exact user turn');
assert(preload.includes('remainingDraft === intendedText && !generatingNow()'), 'Enter fallback must run only while the intended draft remains');
assert(preload.includes('Never press Enter after ChatGPT has already consumed the composer'), 'duplicate-send guard must remain documented');
console.log('conversation-bound send transaction smoke test: OK');