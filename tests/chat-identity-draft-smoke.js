const fs = require('fs');
const assert = require('assert');
const main = fs.readFileSync('main.js', 'utf8');
const preload = fs.readFileSync('chatgpt-preload.js', 'utf8');
assert(main.includes("pathname.match(/\\/c\\/([^/?#]+)/i)"), 'main must identify chats by durable conversation id');
assert(preload.includes('function conversationKey(value)'), 'preload must compare navigation by conversation id');
assert(preload.includes("existingDraft && existingDraft !== intendedText"), 'send must reject only a different draft');
assert(main.includes("composerText, 2000) !== compact(item.text, 2000)"), 'dispatcher must allow retrying its own persisted draft');
console.log('chat identity and draft-safe retry smoke test: OK');
