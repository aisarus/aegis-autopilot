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
  if (index < 0) throw new Error(`[supervisor auto prepare] ${name}: source anchor not found in ${relativePath}`);
  if (content.indexOf(before, index + before.length) >= 0) throw new Error(`[supervisor auto prepare] ${name}: source anchor is ambiguous in ${relativePath}`);
  content = `${content.slice(0, index)}${after}${content.slice(index + before.length)}`;
  write(relativePath, content);
  applied.push(name);
}

const autoPolicy = `function automaticDecisionAllowed(decision, chat) {
  const policy = require('./lib/supervisor-policy');
  return policy.automaticDecisionAllowed({
    decision,
    autopilotEnabled: Boolean(chat?.autopilotEnabled),
    chatId: chat?.id || '',
    turnsUsed: Number(state.supervisor.autoTurnsByChat?.[chat?.id] || 0),
    maxTurns: Number(state.settings.maxAutoTurnsPerChat || 0),
    queueCount: chat ? state.queue.filter((item) => item.chatId === chat.id && item.status === 'queued').length : 0
  });
}

function pendingDecisionMatchesCurrentResponse(decision, chat) {
  if (!decision || !chat || !sameChatUrl(state.browser.url, chat.url)) return false;
  return require('./lib/supervisor-policy').pendingDecisionMatches({
    decision,
    currentResponseHash: responseHash(state.browser.messages)
  });
}

function invalidatePendingDecisionForRescan(chat, reason) {
  if (!chat) return;
  if (state.supervisor.pendingDecisionsByChat) delete state.supervisor.pendingDecisionsByChat[chat.id];
  if (state.supervisor.lastProcessedResponseByChat) delete state.supervisor.lastProcessedResponseByChat[chat.id];
  state.supervisor.pendingDecision = Object.values(state.supervisor.pendingDecisionsByChat || {})[0] || null;
  chat.autopilotState = 'queued';
  chat.autopilotPauseReason = reason;
  addEvent('SUPERVISOR RECHECK', chat.title, reason, 'attention');
  scheduleAutopilotScan(chat.id, { front: true, delay: 1500 });
}

async function recoverPendingAutopilotDecisions() {
  for (const chat of autopilotChats()) {
    const pending = pendingDecisionForChat(chat.id);
    if (!pending) continue;
    invalidatePendingDecisionForRescan(chat, 'Сохранённое решение Gemini будет пересчитано по актуальному ответу после перезапуска.');
  }
  await commit();
}

`;

replaceOnce(
  'main.js',
  'shared automatic decision policy',
  "async function runSupervisor({ trigger = 'manual', typedCommand = '', audioBase64 = '', chatId = '' } = {}) {",
  `${autoPolicy}async function runSupervisor({ trigger = 'manual', typedCommand = '', audioBase64 = '', chatId = '' } = {}) {`,
  'function pendingDecisionMatchesCurrentResponse(decision, chat) {'
);

replaceOnce(
  'main.js',
  'capture source response before Gemini request',
  "    const apiKey = await readGeminiKey();\n    const input = [{ type: 'text', text: supervisorInstruction(supervisorContext(active, trigger, typedCommand)) }];",
  "    const apiKey = await readGeminiKey();\n    const sourceResponseHash = responseHash(state.browser.messages);\n    const input = [{ type: 'text', text: supervisorInstruction(supervisorContext(active, trigger, typedCommand)) }];",
  'const sourceResponseHash = responseHash(state.browser.messages);'
);

replaceOnce(
  'main.js',
  'bind decision to source response',
  '    decision.sourceChatId = active.id;\n    state.supervisor.pendingDecision = decision;',
  '    decision.sourceChatId = active.id;\n    decision.sourceResponseHash = sourceResponseHash;\n    state.supervisor.pendingDecision = decision;',
  'decision.sourceResponseHash = sourceResponseHash;'
);

replaceOnce(
  'main.js',
  'safe decisions execute automatically',
  "    const confidenceThreshold = ({ wait: 0.65, continue: 0.68, review: 0.72, enqueue: 0.76, send_next: 0.76, switch_chat: 0.82, mark_done: 0.9, pause: 0.65 })[decision.action] ?? 0.82;\n    const autoAllowed = active.autopilotEnabled\n      && decision.targetChatId === active.id\n      && decision.confidence >= confidenceThreshold\n      && !['ask_user'].includes(decision.action)\n      && (state.settings.maxAutoTurnsPerChat === 0 || Number(state.supervisor.autoTurnsByChat?.[active.id] || 0) < state.settings.maxAutoTurnsPerChat);",
  '    const autoAllowed = automaticDecisionAllowed(decision, active);',
  'const autoAllowed = automaticDecisionAllowed(decision, active);'
);

replaceOnce(
  'main.js',
  'reject stale automatic decisions at execution boundary',
  "  if (!target) return { ok: false, error: 'У решения нет проектного чата.' };\n  let result = { ok: true };",
  "  if (!target) return { ok: false, error: 'У решения нет проектного чата.' };\n  if (automatic && !pendingDecisionMatchesCurrentResponse(decision, target)) {\n    return { ok: false, error: 'Автоматическое решение устарело или относится к другому ответу ChatGPT.' };\n  }\n  let result = { ok: true };",
  'Автоматическое решение устарело или относится к другому ответу ChatGPT.'
);

replaceOnce(
  'main.js',
  'resolve pending decision when autopilot is enabled',
  "    await commit();\n    if (!enabled) scheduleAutopilotScan(chat.id, { front: true });\n    else requestAutopilotScheduler(80);\n    return { ok: true, enabled: !enabled, chat, autopilotChatCount: autopilotChats().length };",
  "    await commit();\n    if (!enabled) {\n      const pending = pendingDecisionForChat(chat.id);\n      if (pending && automaticDecisionAllowed(pending, chat) && pendingDecisionMatchesCurrentResponse(pending, chat)) {\n        const executed = await executeSupervisorDecision(pending.id, { automatic: true });\n        if (!executed.ok) {\n          invalidatePendingDecisionForRescan(chat, executed.error || 'Сохранённое решение Gemini требует повторной проверки.');\n          await commit();\n        }\n      } else if (pending) {\n        invalidatePendingDecisionForRescan(chat, 'Сохранённое решение Gemini не подтверждено актуальным ответом и будет пересчитано.');\n        await commit();\n      } else {\n        scheduleAutopilotScan(chat.id, { front: true });\n      }\n    } else {\n      requestAutopilotScheduler(80);\n    }\n    return { ok: true, enabled: !enabled, chat, autopilotChatCount: autopilotChats().length };",
  'pendingDecisionMatchesCurrentResponse(pending, chat)'
);

replaceOnce(
  'main.js',
  'recover pending decisions after restart',
  "  registerIpc();\n  createWindow();\n  autopilotWatchdogTimer = setInterval(runAutopilotWatchdog, 8000);",
  "  registerIpc();\n  createWindow();\n  setTimeout(() => recoverPendingAutopilotDecisions().catch((error) => {\n    writeLog('warn', 'Pending autopilot decision recovery failed', sanitizedGeminiError(error));\n  }), 1200);\n  autopilotWatchdogTimer = setInterval(runAutopilotWatchdog, 8000);",
  "setTimeout(() => recoverPendingAutopilotDecisions().catch"
);

console.log(`[Aegis supervisor auto prepare] applied ${applied.length}, already present ${skipped.length}`);
if (applied.length) console.log(`[Aegis supervisor auto prepare] ${applied.join('; ')}`);
