const fs = require('fs');

const source = fs.readFileSync('main.js', 'utf8');
const unresponsiveStart = source.indexOf("chatView.webContents.on('unresponsive'");
const responsiveStart = source.indexOf("chatView.webContents.on('responsive'");
const renderGoneStart = source.indexOf("chatView.webContents.on('render-process-gone'");

if (unresponsiveStart < 0 || responsiveStart < 0 || renderGoneStart < 0) {
  throw new Error('Renderer recovery handlers are missing.');
}

const unresponsiveHandler = source.slice(unresponsiveStart, responsiveStart);
const responsiveHandler = source.slice(responsiveStart, renderGoneStart);

if (unresponsiveHandler.includes('clearInterval(autopilotWatchdogTimer)')) {
  throw new Error('Unresponsive renderer still disables the autopilot watchdog.');
}
if (responsiveHandler.includes('clearInterval(autopilotWatchdogTimer)')) {
  throw new Error('Responsive renderer still disables the autopilot watchdog.');
}
if (!source.includes('autopilotWatchdogTimer = setInterval(runAutopilotWatchdog, 8000)')) {
  throw new Error('Autopilot watchdog startup is missing.');
}

console.log('autopilot watchdog survival smoke test: OK');
