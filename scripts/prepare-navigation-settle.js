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
  if (index < 0) throw new Error(`[navigation settle prepare] ${name}: source anchor not found in ${relativePath}`);
  if (content.indexOf(before, index + before.length) >= 0) throw new Error(`[navigation settle prepare] ${name}: source anchor is ambiguous in ${relativePath}`);
  content = `${content.slice(0, index)}${after}${content.slice(index + before.length)}`;
  write(relativePath, content);
  applied.push(name);
}

const settleHelper = `async function settleAutopilotChat(chat, timeoutMs = 12000) {
  const startedAt = Date.now();
  let inspections = 0;
  while (Date.now() - startedAt < timeoutMs) {
    if (!chat?.autopilotEnabled) return { ok: false, error: 'Autopilot was disabled while the chat was settling.', inspections };
    if (!sameChatUrl(state.browser.url, chat.url)) return { ok: false, error: 'Chat changed while waiting for its conversation DOM.', inspections };
    const hash = responseHash(state.browser.messages);
    if (hash) {
      chat.autopilotPauseReason = '';
      return { ok: true, hash, inspections };
    }
    chat.autopilotState = 'settling-chat';
    chat.autopilotPauseReason = 'Жду, пока ChatGPT догрузит сообщения после переключения чата.';
    sendState();
    inspections += 1;
    await sendChatCommand('inspect', {}, 5000).catch(() => ({ ok: false }));
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  return { ok: false, error: 'Assistant response was not visible after the navigation settling window.', inspections };
}

`;

replaceOnce(
  'main.js',
  'add post-navigation autopilot settling loop',
  'async function openChat(chatId) {',
  `${settleHelper}async function openChat(chatId) {`,
  'async function settleAutopilotChat(chat, timeoutMs = 12000) {'
);

replaceOnce(
  'main.js',
  'wait for assistant DOM before leaving a project chat',
  "    const ready = await waitForBrowser((browser) => sameChatUrl(browser.url, chat.url) && browser.composerReady && !browser.generating, 22000);\n    if (!ready.ok) throw new Error(ready.error);\n    const hash = responseHash(state.browser.messages);\n    const processed = state.supervisor.lastProcessedResponseByChat || {};",
  "    const ready = await waitForBrowser((browser) => sameChatUrl(browser.url, chat.url) && browser.composerReady && !browser.generating, 22000);\n    if (!ready.ok) throw new Error(ready.error);\n    let hash = responseHash(state.browser.messages);\n    if (!hash) {\n      const settling = await settleAutopilotChat(chat, 12000);\n      hash = responseHash(state.browser.messages);\n      writeLog(settling.ok ? 'info' : 'warn', 'Autopilot navigation settling completed', JSON.stringify({ chatId: chat.id, ok: settling.ok, inspections: settling.inspections, adapter: state.browser.diagnostics?.adapterVersion || '', messageCount: state.browser.diagnostics?.messageCount || 0, assistantTextLength: state.browser.diagnostics?.assistantTextLength || 0 }));\n    }\n    const processed = state.supervisor.lastProcessedResponseByChat || {};",
  "const settling = await settleAutopilotChat(chat, 12000);"
);

console.log(`[Aegis navigation settle prepare] applied ${applied.length}, already present ${skipped.length}`);
if (applied.length) console.log(`[Aegis navigation settle prepare] ${applied.join('; ')}`);
