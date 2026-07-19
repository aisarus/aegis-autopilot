const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const openChat = source.slice(source.indexOf('async function openChat'), source.indexOf('async function dispatchNext'));
const monitor = source.slice(source.indexOf('function monitorStuckConversation'), source.indexOf('function applyChatSnapshot'));
if (/reloadIgnoringCache/.test(openChat)) throw new Error('openChat must not hard-reload an already open chat');
if (/reloadIgnoringCache/.test(monitor)) throw new Error('stuck-conversation monitor must not reload ChatGPT');
if (!/reload suppressed|Автоперезагрузка отключена/.test(monitor)) throw new Error('monitor must log that reload is suppressed');
console.log('no reload loop smoke test: OK');
