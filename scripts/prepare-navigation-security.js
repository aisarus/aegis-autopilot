const fs = require('fs');
const path = require('path');

const mainPath = path.resolve(__dirname, '..', 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');
const before = source;

const startMarker = 'function layoutAndSecurity() {';
const endMarker = 'function createWindow() {';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);
if (start < 0 || end < 0) throw new Error('[navigation security prepare] layoutAndSecurity boundary not found');

const replacement = `function layoutAndSecurity() {
  const { isAllowedExternalNavigation, isAllowedInternalNavigation, navigationLogLabel } = require('./lib/navigation-policy');
  resizeViews();
  mainWindow.on('resize', resizeViews);
  const openExternalSafely = (url) => {
    const logLabel = navigationLogLabel(url);
    if (!isAllowedExternalNavigation(url)) {
      writeLog('warn', 'Blocked unsafe external URL', logLabel);
      return;
    }
    shell.openExternal(url).catch((error) => {
      const failure = compact(error?.code || error?.name || 'unknown error', 100);
      writeLog('warn', 'External URL open failed', `${logLabel} | ${failure}`);
    });
  };
  chatView.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedInternalNavigation(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: 'persist:aegis-chatgpt', nodeIntegration: false, contextIsolation: true, sandbox: true } } };
    }
    openExternalSafely(url);
    return { action: 'deny' };
  });
  chatView.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedInternalNavigation(url)) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });
}

`;

source = `${source.slice(0, start)}${replacement}${source.slice(end)}`;

if (source.includes('accounts\\.google\\.com$') || source.includes("shell.openExternal(url).catch(() => {})") || source.includes("compact(url, 500)")) {
  throw new Error('[navigation security prepare] unsafe navigation implementation remains');
}

if (source !== before) fs.writeFileSync(mainPath, source, 'utf8');
console.log(source === before ? '[Aegis navigation security prepare] already present' : '[Aegis navigation security prepare] strict host, protocol and diagnostic-redaction policy applied');
