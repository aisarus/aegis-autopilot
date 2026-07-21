const fs = require('fs');
const path = require('path');

const mainPath = path.resolve(__dirname, '..', 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');
const before = source;

const handlers = [
  ["chatView.webContents.on('unresponsive'", "chatView.webContents.on('responsive'"],
  ["chatView.webContents.on('responsive'", "chatView.webContents.on('render-process-gone'"]
];

for (const [startMarker, endMarker] of handlers) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`[watchdog prepare] handler boundary not found: ${startMarker}`);
  const handler = source.slice(start, end);
  const cleaned = handler.replace(/^\s*clearInterval\(autopilotWatchdogTimer\);\s*\r?\n/gm, '');
  source = `${source.slice(0, start)}${cleaned}${source.slice(end)}`;
}

if (!source.includes('autopilotWatchdogTimer = setInterval(runAutopilotWatchdog, 8000)')) {
  throw new Error('[watchdog prepare] watchdog startup is missing');
}

if (source !== before) fs.writeFileSync(mainPath, source, 'utf8');
console.log(source === before ? '[Aegis watchdog prepare] already present' : '[Aegis watchdog prepare] removed renderer-stall watchdog shutdowns');
