module.exports = {
  id: 'chatgpt-web-2026.07',
  priority: 100,
  description: 'Primary ChatGPT web adapter for the 2026 composer and conversation DOM.',
  probes(document) {
    let score = 0;
    if (document.querySelector('#prompt-textarea')) score += 50;
    if (document.querySelector('[data-message-author-role]')) score += 30;
    if (document.querySelector('button[data-testid="send-button"],button[data-testid="composer-submit-button"]')) score += 20;
    return score;
  },
  selectors: {
    composer: ['#prompt-textarea','main [contenteditable="true"][data-lexical-editor="true"]','form [contenteditable="true"]','textarea[data-id="root"]','form textarea'],
    stopButton: ['button[data-testid="stop-button"]','button[data-testid="composer-stop-button"]'],
    sendButton: ['button[data-testid="send-button"]','button[data-testid="composer-submit-button"]'],
    assistantMessages: ['[data-message-author-role="assistant"]'],
    messageTurns: ['article[data-testid^="conversation-turn-"]','main article'],
    roleNodes: ['main [data-message-author-role]'],
    streaming: ['[aria-busy="true"]','[data-streaming="true"]','.result-streaming','[class*="streaming"]']
  }
};
