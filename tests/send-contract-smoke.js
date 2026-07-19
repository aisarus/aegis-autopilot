const fs = require('fs');
const source = fs.readFileSync(require('path').join(__dirname, '..', 'chatgpt-preload.js'), 'utf8');
const required = [
  'dispatchInputLikeUser',
  "new InputEvent('beforeinput'",
  'form.requestSubmit()',
  'pressEnterToSend(composer)',
  'evidence.fingerprint !== beforeUser.fingerprint && evidence.intendedMatch',
  "ChatGPT не подтвердил отправку"
];
for (const token of required) {
  if (!source.includes(token)) throw new Error(`Missing verified-send contract: ${token}`);
}
console.log('verified send contract smoke test: OK');
