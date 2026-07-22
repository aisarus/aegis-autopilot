'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const { createRuntimeComponents } = require('./orchestrator/electron-runtime-factory');
const { publicError } = require('./orchestrator/runtime-service');

const APP_NAME = 'Aegis Orchestrator';
const APP_ID = 'com.aegis.orchestrator.v2';
const IPC = Object.freeze({
  getState: 'aegis-v2:get-state',
  saveCredential: 'aegis-v2:save-credential',
  removeCredential: 'aegis-v2:remove-credential',
  refreshBaselines: 'aegis-v2:refresh-baselines',
  startRun: 'aegis-v2:start-run',
  cancelRun: 'aegis-v2:cancel-run',
  publishRun: 'aegis-v2:publish-run',
  openPullRequest: 'aegis-v2:open-pull-request',
  state: 'aegis-v2:state'
});

if (typeof app.setName === 'function') app.setName(APP_NAME);
if (typeof app.setAppUserModelId === 'function') app.setAppUserModelId(APP_ID);

let mainWindow = null;
let runtime = null;
let unsubscribeRuntime = null;

function trustedGithubUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && (url.hostname === 'github.com' || url.hostname.endsWith('.github.com')) ? url.href : '';
  } catch {
    return '';
  }
}

function secureWindowOptions() {
  return {
    width: 1320,
    height: 900,
    minWidth: 1050,
    minHeight: 720,
    show: false,
    title: APP_NAME,
    backgroundColor: '#f2efe9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'v2-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged
    }
  };
}

async function sendState() {
  if (!runtime || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send(IPC.state, await runtime.snapshot());
  } catch {}
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await handler(...args) };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });
}

function registerIpc() {
  registerHandler(IPC.getState, () => runtime.snapshot());
  registerHandler(IPC.saveCredential, (input = {}) => runtime.saveCredential(input.name, input.secret));
  registerHandler(IPC.removeCredential, (name) => runtime.removeCredential(name));
  registerHandler(IPC.refreshBaselines, () => runtime.refreshBaselines());
  registerHandler(IPC.startRun, (input = {}) => runtime.startRun(input));
  registerHandler(IPC.cancelRun, (runId) => runtime.cancelRun(runId));
  registerHandler(IPC.publishRun, (runId) => runtime.publishRun(runId));
  registerHandler(IPC.openPullRequest, async (value) => {
    const url = trustedGithubUrl(value);
    if (!url) throw new Error('Only HTTPS GitHub pull-request links may be opened.');
    await shell.openExternal(url);
    return { opened: true };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow(secureWindowOptions());
  mainWindow.loadFile(path.join(__dirname, 'renderer-v2', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!String(url || '').startsWith('file:')) event.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

async function startApplication() {
  const components = createRuntimeComponents({
    safeStorage,
    userDataPath: app.getPath('userData'),
    platform: process.platform
  });
  runtime = components.runtime;
  registerIpc();
  createWindow();
  const onState = () => { sendState().catch(() => {}); };
  runtime.on('state', onState);
  unsubscribeRuntime = () => runtime?.off('state', onState);
  await sendState();
}

const hasSingleInstanceLock = typeof app.requestSingleInstanceLock === 'function'
  ? app.requestSingleInstanceLock()
  : true;

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(startApplication).catch((error) => {
    console.error(publicError(error));
    app.quit();
  });
}

app.on('before-quit', () => {
  unsubscribeRuntime?.();
  unsubscribeRuntime = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow && runtime) createWindow();
});

module.exports = {
  APP_ID,
  APP_NAME,
  IPC,
  secureWindowOptions,
  trustedGithubUrl
};
