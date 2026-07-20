const fs = require('fs');

const source = fs.readFileSync('main.js', 'utf8');
const required = [
  'function browserDraftMatchesQueueItem',
  "draft === compact(item.text, 2000)",
  "sameChatUrl(state.browser.url, chat.url)",
  "autopilotState = 'retrying-send'",
  'await dispatchNext({ chatId: draftOwner.id })',
  'requestAutopilotScheduler(3000)',
  '!browserDraftMatchesQueueItem(chat, item)'
];

for (const token of required) {
  if (!source.includes(token)) throw new Error(`Missing own-draft retry contract: ${token}`);
}

if (!source.includes('const draftOwner = candidates.find((chat) => browserDraftMatchesQueueItem(chat));')) {
  throw new Error('Queued chat selection does not prioritize the owner of an Aegis draft.');
}
