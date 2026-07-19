const fs = require('fs');
const source = fs.readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
for (const needle of ['maxGeminiSpendUsdPerDay: 0.5', 'const reserveUsd = 0.02', 'spentToday + reserveUsd > spendLimit', "active.autopilotState = 'paused'", "ipcMain.handle('aegis:set-chat-panel'"]) {
  if (!source.includes(needle)) throw new Error(`missing budget/graph contract: ${needle}`);
}
console.log('budget guard and graph panel smoke test: OK');
