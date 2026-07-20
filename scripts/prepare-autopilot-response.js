const fs = require('fs');
const path = require('path');

const repoDir = path.resolve(__dirname, '..');
const applied = [];
const skipped = [];

function read(relativePath) {
  return fs.readFileSync(path.join(repoDir, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(repoDir, relativePath), content, 'utf8');
}

function replaceOnce(relativePath, name, before, after, marker = after) {
  let content = read(relativePath);
  if (content.includes(marker)) {
    skipped.push(name);
    return;
  }
  const index = content.indexOf(before);
  if (index < 0) throw new Error(`[autopilot response prepare] ${name}: source anchor not found in ${relativePath}`);
  if (content.indexOf(before, index + before.length) >= 0) throw new Error(`[autopilot response prepare] ${name}: source anchor is ambiguous in ${relativePath}`);
  content = `${content.slice(0, index)}${after}${content.slice(index + before.length)}`;
  write(relativePath, content);
  applied.push(name);
}

const semanticFallback = `function semanticAssistantFallback() {
  const main = document.querySelector('main');
  if (!main) return null;
  const composer = composerElement();
  const composerText = cleanMessageText(composerValue(composer));
  const candidates = [];
  const seen = new Set();

  const addCandidate = (node, source) => {
    if (!node || !node.isConnected || node.closest('form, nav, aside')) return;
    if (node.closest('[data-message-author-role="user"]')) return;
    const explicitRole = cleanText(node.getAttribute?.('data-message-author-role'), 30).toLowerCase();
    const nestedRole = cleanText(node.querySelector?.('[data-message-author-role]')?.getAttribute('data-message-author-role'), 30).toLowerCase();
    if (explicitRole === 'user' || nestedRole === 'user') return;
    const textNode = node.matches?.('.markdown, [class*="markdown"]')
      ? node
      : (node.querySelector?.('.markdown, [class*="markdown"], [data-message-author-role="assistant"]') || node);
    const text = cleanMessageText(textNode.innerText || textNode.textContent);
    if (!text || text.length < 8 || text === composerText) return;
    if (/^(?:copy|copied|regenerate|retry|good response|bad response|копировать|скопировано|повторить|оценить)[\\s\\n]*$/i.test(text)) return;
    const composerRect = composer?.getBoundingClientRect?.();
    const rect = node.getBoundingClientRect?.();
    if (composerRect && rect && rect.top > composerRect.top + 24) return;
    const key = \\`${text.slice(0, 400)}:\\${text.length}\\`;
    if (seen.has(key)) return;
    seen.add(key);
    const id = cleanText(node.getAttribute?.('data-message-id') || node.getAttribute?.('data-testid') || node.id || '', 180);
    candidates.push({ role: 'assistant', text, id, source, node });
  };

  const primary = main.querySelectorAll('[data-message-author-role="assistant"], .markdown, [class*="markdown"], article, [data-testid*="conversation-turn"]');
  for (const node of primary) {
    const role = cleanText(node.getAttribute?.('data-message-author-role'), 30).toLowerCase();
    const hasAssistant = role === 'assistant' || Boolean(node.querySelector?.('[data-message-author-role="assistant"]'));
    const hasMarkdown = node.matches?.('.markdown, [class*="markdown"]') || Boolean(node.querySelector?.('.markdown, [class*="markdown"]'));
    const hasAssistantActions = [...(node.querySelectorAll?.('button') || [])].some((button) => /copy|regenerate|retry|good response|bad response|копир|повтор|оцен/i.test(cleanText(\\`${button.getAttribute('aria-label') || ''} \\${button.getAttribute('data-testid') || ''}\\`, 180)));
    if (hasAssistant || hasMarkdown || hasAssistantActions) addCandidate(node, hasAssistant ? 'role' : (hasMarkdown ? 'markdown' : 'actions'));
  }

  if (!candidates.length) {
    const actionButtons = [...main.querySelectorAll('button')].filter((button) => /copy|regenerate|retry|good response|bad response|копир|повтор|оцен/i.test(cleanText(\\`${button.getAttribute('aria-label') || ''} \\${button.getAttribute('data-testid') || ''}\\`, 180)));
    for (const button of actionButtons) {
      let node = button.parentElement;
      for (let depth = 0; node && depth < 14; depth += 1, node = node.parentElement) {
        if (node === main || node.closest?.('[data-message-author-role="user"]')) continue;
        const textNode = node.querySelector?.('.markdown, [class*="markdown"], [data-message-author-role="assistant"]');
        if (!textNode) continue;
        addCandidate(node, 'toolbar');
        break;
      }
    }
  }

  candidates.sort((left, right) => {
    if (left.node === right.node) return 0;
    const position = left.node.compareDocumentPosition(right.node);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  const last = candidates.at(-1);
  return last ? { role: 'assistant', text: last.text, id: last.id, source: last.source } : null;
}

`;

replaceOnce(
  'chatgpt-preload.js',
  'semantic assistant fallback extractor',
  'function fallbackAssistantMessage() {',
  `${semanticFallback}function fallbackAssistantMessage() {`,
  'function semanticAssistantFallback() {'
);

replaceOnce(
  'chatgpt-preload.js',
  'use semantic assistant fallback',
  '  return null;\n}\n\nfunction conversationLoading(messages = []) {',
  '  return semanticAssistantFallback();\n}\n\nfunction conversationLoading(messages = []) {',
  'return semanticAssistantFallback();\n}\n\nfunction conversationLoading'
);

replaceOnce(
  'chatgpt-preload.js',
  'publish assistant extraction diagnostics',
  '      messageCount: messages.length,\n      loadingIndicator: loadingConversation,',
  "      messageCount: messages.length,\n      assistantSource: cleanText(fallbackAssistant?.source || (lastAssistant ? 'conversation' : ''), 80),\n      assistantTextLength: String(lastAssistant?.text || '').length,\n      loadingIndicator: loadingConversation,",
  'assistantTextLength: String(lastAssistant?.text || \'\').length'
);

replaceOnce(
  'main.js',
  'retain assistant extraction diagnostics',
  '    messageCount: Math.min(10000, Math.max(0, Number(input.messageCount) || 0)),\n    loadingIndicator: Boolean(input.loadingIndicator),',
  "    messageCount: Math.min(10000, Math.max(0, Number(input.messageCount) || 0)),\n    assistantSource: compact(input.assistantSource, 80),\n    assistantTextLength: Math.min(1000000, Math.max(0, Number(input.assistantTextLength) || 0)),\n    loadingIndicator: Boolean(input.loadingIndicator),",
  'assistantTextLength: Math.min(1000000'
);

replaceOnce(
  'main.js',
  'surface missing assistant response instead of silent watching',
  "    if (!hash || hash === processed[chat.id]) {\n      chat.autopilotState = 'watching';\n      await commit();\n      scheduleAutopilotScan(chat.id, { delay: Math.max(15000, state.settings.supervisorCooldownSec * 1000) });\n    } else {",
  "    if (!hash) {\n      const reason = 'Aegis пока не видит последний ответ ChatGPT в DOM. Повторяю semantic-проверку.';\n      const firstMiss = chat.autopilotState !== 'waiting-response-dom' || chat.autopilotPauseReason !== reason;\n      scheduleAutopilotScan(chat.id, { delay: 5000 });\n      chat.autopilotState = 'waiting-response-dom';\n      chat.autopilotPauseReason = reason;\n      if (firstMiss) {\n        addEvent('AUTOPILOT WAIT', chat.title, reason, 'attention');\n        writeLog('warn', 'Autopilot assistant response not detected', JSON.stringify({ chatId: chat.id, url: state.browser.url, diagnostics: state.browser.diagnostics || {} }));\n      }\n      await commit();\n      sendChatCommand('inspect', {}, 5000).catch(() => {});\n    } else if (hash === processed[chat.id]) {\n      chat.autopilotState = 'watching';\n      chat.autopilotPauseReason = '';\n      await commit();\n      scheduleAutopilotScan(chat.id, { delay: Math.max(15000, state.settings.supervisorCooldownSec * 1000) });\n    } else {",
  "chat.autopilotState = 'waiting-response-dom';"
);

console.log(`[Aegis autopilot response prepare] applied ${applied.length}, already present ${skipped.length}`);
if (applied.length) console.log(`[Aegis autopilot response prepare] ${applied.join('; ')}`);
