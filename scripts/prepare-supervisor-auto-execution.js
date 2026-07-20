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
  if (!decision || !chat?.autopilotEnabled || decision.targetChatId !== chat.id || decision.action === 'ask_user') return false;
  const automaticSafeActions = new Set(['wait', 'enqueue', 'continue', 'review', 'send_next']);
  const confidenceThreshold = ({ mark_done: 0.9, pause: 0.65 })[decision.action] ?? 1;
  const turnsAvailable = state.settings.maxAutoTurnsPerChat === 0
    || Number(state.supervisor.autoTurnsByChat?.[chat.id] || 0) < state.settings.maxAutoTurnsPerChat;
  return turnsAvailable && (automaticSafeActions.has(decision.action) || decision.confidence >= confidenceThreshold);
}

async function recoverPendingAutopilotDecisions() {
  for (const chat of autopilotChats()) {
    const pending = pendingDecisionForChat(chat.id);
    if (!pending) continue;
    if (!automaticDecisionAllowed(pending, chat)) {
      chat.autopilotState = 'needs-user';
      continue;
    }
    const executed = await executeSupervisorDecision(pending.id, { automatic: true });
    if (!executed.ok) {
      chat.autopilotState = 'retrying';
      chat.autopilotPauseReason = executed.error || 'Не удалось восстановить отложенное решение Gemini.';
    }
  }
  await commit();
}

`;

replaceOnce(
  'main.js',
  'shared automatic decision policy',
  "async function runSupervisor({ trigger = 'manual', typedCommand = '', audioBase64 = '', chatId = '' } = {}) {",
  `${autoPolicy}async function runSupervisor({ trigger = 'manual', typedCommand = '', audioBase64 = '', chatId = '' } = {}) {`,
  'function automaticDecisionAllowed(decision, chat) {'
);

replaceOnce(
  'main.js',
  'safe decisions execute automatically',
  "    const confidenceThreshold = ({ wait: 0.65, continue: 0.68, review: 0.72, enqueue: 0.76, send_next: 0.76, switch_chat: 0.82, mark_done: 0.9, pause: 0.65 })[decision.action] ?? 0.82;\n    const autoAllowed = active.autopilotEnabled\n      && decision.targetChatId === active.id\n      && decision.confidence >= confidenceThreshold\n      && !['ask_user'].includes(decision.action)\n      && (state.settings.maxAutoTurnsPerChat === 0 || Number(state.supervisor.autoTurnsByChat?.[active.id] || 0) < state.settings.maxAutoTurnsPerChat);",
  "    const autoAllowed = automaticDecisionAllowed(decision, active);",
  'const autoAllowed = automaticDecisionAllowed(decision, active);'
);

replaceOnce(
  'main.js',
  'resolve pending decision when autopilot is enabled',
  "    await commit();\n    if (!enabled) scheduleAutopilotScan(chat.id, { front: true });\n    else requestAutopilotScheduler(80);\n    return { ok: true, enabled: !enabled, chat, autopilotChatCount: autopilotChats().length };",
  "    await commit();\n    if (!enabled) {\n      const pending = pendingDecisionForChat(chat.id);\n      if (pending && automaticDecisionAllowed(pending, chat)) {\n        const executed = await executeSupervisorDecision(pending.id, { automatic: true });\n        if (!executed.ok) {\n          chat.autopilotState = 'retrying';\n          chat.autopilotPauseReason = executed.error || 'Не удалось выполнить сохранённое решение Gemini.';\n          await commit();\n        }\n      } else if (pending) {\n        chat.autopilotState = 'needs-user';\n        await commit();\n      } else {\n        scheduleAutopilotScan(chat.id, { front: true });\n      }\n    } else {\n      requestAutopilotScheduler(80);\n    }\n    return { ok: true, enabled: !enabled, chat, autopilotChatCount: autopilotChats().length };",
  "const pending = pendingDecisionForChat(chat.id);\n      if (pending && automaticDecisionAllowed(pending, chat))"
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
