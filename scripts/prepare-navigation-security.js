const fs = require('fs');
const path = require('path');

const mainPath = path.resolve(__dirname, '..', 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');
const before = source;

const importLine = "const { isAllowedExternalNavigation, isAllowedInternalNavigation } = require('./lib/navigation-policy');";
if (!source.includes(importLine)) {
  const anchor = "const { GoogleGenAI } = require('@google/genai');";
  if (!source.includes(anchor)) throw new Error('[navigation security prepare] import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

const startMarker = 'function layoutAndSecurity() {';
const endMarker = 'function createWindow() {';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);
if (start < 0 || end < 0) throw new Error('[navigation security prepare] layoutAndSecurity boundary not found');

const replacement = `function layoutAndSecurity() {
  resizeViews();
  mainWindow.on('resize', resizeViews);
  const openExternalSafely = (url) => {
    if (!isAllowedExternalNavigation(url)) {
      writeLog('warn', 'Blocked unsafe external URL', compact(url, 500));
      return;
    }
    shell.openExternal(url).catch((error) => writeLog('warn', 'External URL open failed', error?.message || String(error)));
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

if (source.includes('accounts\\.google\\.com$') || source.includes("shell.openExternal(url).catch(() => {})")) {
  throw new Error('[navigation security prepare] unsafe navigation implementation remains');
}

if (source !== before) fs.writeFileSync(mainPath, source, 'utf8');
console.log(source === before ? '[Aegis navigation security prepare] already present' : '[Aegis navigation security prepare] strict host and protocol policy applied');
