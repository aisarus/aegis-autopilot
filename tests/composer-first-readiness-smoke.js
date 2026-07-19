const fs = require('fs');
const preload = fs.readFileSync('chatgpt-preload.js', 'utf8');
const main = fs.readFileSync('main.js', 'utf8');

function expect(pattern, source, message) {
  if (!pattern.test(source)) throw new Error(message);
}

expect(/const conversationReady = Boolean\(currentPathIsChat && composer\)/, preload,
  'conversation readiness must be based on chat URL + composer');
expect(/composerReady: Boolean\(composer && !generating && !limitDetected\)/, preload,
  'composer readiness must not depend on message-history parsing');
expect(/sameChatUrl\(browser\.url, chat\.url\) && browser\.composerReady/, main,
  'chat opening must wait for composer readiness');
expect(/conversationLoading && !state\.browser\.composerReady/, main,
  'loading state must not block scheduler when composer is ready');
expect(/browser\.generating \|\| browser\.composerReady/, main,
  'stuck-conversation recovery must not reload a usable composer');

console.log('composer-first readiness smoke test: OK');
