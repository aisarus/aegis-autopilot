module.exports = {
  id: 'chatgpt-web-legacy-generic',
  priority: 10,
  description: 'Generic fallback adapter with semantic and accessibility selectors.',
  probes(document) {
    let score = 1;
    if (document.querySelector('form textarea, form [contenteditable="true"]')) score += 20;
    if (document.querySelector('main article, main [data-message-author-role]')) score += 15;
    return score;
  },
  selectors: {
    composer: ['form textarea','form [contenteditable="true"]','main textarea','main [contenteditable="true"]'],
    stopButton: ['button[data-testid*="stop"]'],
    sendButton: ['button[data-testid*="send"]','form button[type="submit"]'],
    assistantMessages: ['[data-message-author-role="assistant"]','main article'],
    messageTurns: ['main article','main [data-message-author-role]'],
    roleNodes: ['main [data-message-author-role]'],
    streaming: ['[aria-busy="true"]','[data-streaming="true"]','[class*="streaming"]']
  }
};
