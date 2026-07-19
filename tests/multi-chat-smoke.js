const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainPath = path.join(__dirname, '..', 'main.js');
const source = `${fs.readFileSync(mainPath, 'utf8')}
globalThis.__aegisTest = {
  defaultState,
  queuedChat,
  scheduleAutopilotScan,
  syncSupervisorMode,
  supervisorContext,
  validateDecision,
  recordGeminiUsage,
  publicState,
  setState(value) { state = value; },
  setLastDispatchedChatId(value) { lastDispatchedChatId = value; },
  scanQueue() { return autopilotScanQueue.slice(); }
};`;

const app = {
  whenReady: () => new Promise(() => {}),
  on: () => {},
  getVersion: () => '0.7.1'
};

const electron = {
  app,
  BrowserWindow: class {},
  WebContentsView: class {},
  clipboard: { writeText: () => {} },
  dialog: {},
  ipcMain: { handle: () => {}, on: () => {} },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: {}
};

const context = {
  Buffer,
  URL,
  clearInterval,
  clearTimeout,
  console,
  process,
  setInterval,
  setTimeout,
  require(name) {
    if (name === 'electron') return electron;
    if (name === '@google/genai') return { GoogleGenAI: class {} };
    return require(name);
  }
};

vm.runInNewContext(source, context, { filename: mainPath });
const api = context.__aegisTest;
const state = api.defaultState();
state.chats = [
  { id: 'chat-a', title: 'A', url: 'https://chatgpt.com/c/a', status: 'working', autopilotEnabled: true, autopilotState: 'watching', queuePaused: false },
  { id: 'chat-b', title: 'B', url: 'https://chatgpt.com/c/b', status: 'working', autopilotEnabled: true, autopilotState: 'watching', queuePaused: false }
];
state.activeChatId = 'chat-a';
state.queue = [
  { id: 'msg-a', chatId: 'chat-a', status: 'queued' },
  { id: 'msg-b', chatId: 'chat-b', status: 'queued' }
];
api.setState(state);

assert.equal(api.queuedChat().id, 'chat-a', 'active chat should win before the first dispatch');
api.setLastDispatchedChatId('chat-a');
assert.equal(api.queuedChat().id, 'chat-b', 'round-robin should move from A to B');
api.setLastDispatchedChatId('chat-b');
assert.equal(api.queuedChat().id, 'chat-a', 'round-robin should return from B to A');

state.settings.autoDispatch = false;
api.syncSupervisorMode();
assert.equal(state.settings.supervisorMode, 'auto');
assert.equal(state.settings.autoDispatch, true, 'an enabled autopilot requires the safe queue dispatcher');

assert.equal(api.scheduleAutopilotScan('chat-a'), true);
assert.equal(api.scheduleAutopilotScan('chat-a'), true);
assert.equal(api.scanQueue().filter((entry) => entry.chatId === 'chat-a').length, 1, 'scheduler entries must be deduplicated per chat');

state.supervisor.pendingDecisionsByChat['chat-b'] = { id: 'decision-b' };
assert.equal(api.scheduleAutopilotScan('chat-b'), false, 'a chat waiting for the user must not overwrite its decision');

const decision = api.validateDecision({
  action: 'continue',
  message: 'Next step',
  confidence: 0.9
}, 'chat-a');
assert.equal(decision.targetChatId, 'chat-a', 'a Gemini decision must stay bound to its source chat by default');

const enqueueDecision = api.validateDecision({ action: 'enqueue', message: 'Исправь один упавший тест.', confidence: 0.91 }, 'chat-b');
assert.equal(enqueueDecision.prompt, 'Исправь один упавший тест.');
assert.equal(enqueueDecision.targetChatId, 'chat-b');

state.browser.messages = [
  { role: 'user', text: 'old user request' },
  { role: 'assistant', text: 'old assistant answer' },
  { role: 'user', text: 'latest user request' },
  { role: 'assistant', text: 'latest completed assistant answer' }
];
const supervisorContext = api.supervisorContext(state.chats[0], 'response-complete');
assert.equal(supervisorContext.chatgpt.lastAssistantResponse, 'latest completed assistant answer');
assert.equal(JSON.stringify(supervisorContext).includes('old assistant answer'), false, 'Gemini context must not include conversation history');
assert.equal(JSON.stringify(supervisorContext).includes('latest user request'), false, 'Gemini context must not include user-message history');

api.recordGeminiUsage({ usage: { total_input_tokens: 1000, total_output_tokens: 20, total_thought_tokens: 10, total_tokens: 1030 } });

const publicState = api.publicState();
assert.equal(publicState.supervisor.autopilotChatCount, 2);
assert.equal(publicState.supervisor.pendingDecision, null, 'only the active chat decision is shown in the main decision card');
assert.equal(publicState.supervisor.pendingDecisionCount, 1);
assert.equal(publicState.supervisor.usageToday.calls, 1);
assert.equal(publicState.supervisor.usageToday.inputTokens, 1000);
assert.equal(publicState.supervisor.usageToday.outputTokens + publicState.supervisor.usageToday.thoughtTokens, 30);
assert.ok(Math.abs(publicState.supervisor.usageToday.estimatedPaidUsd - 0.000375) < 1e-12);

console.log('multi-chat scheduler smoke test: OK');
