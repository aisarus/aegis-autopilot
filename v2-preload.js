'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
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

contextBridge.exposeInMainWorld('aegisV2', {
  getState: () => ipcRenderer.invoke(CHANNELS.getState),
  saveCredential: (name, secret) => ipcRenderer.invoke(CHANNELS.saveCredential, { name, secret }),
  removeCredential: (name) => ipcRenderer.invoke(CHANNELS.removeCredential, name),
  refreshBaselines: () => ipcRenderer.invoke(CHANNELS.refreshBaselines),
  startRun: (input) => ipcRenderer.invoke(CHANNELS.startRun, input),
  cancelRun: (runId) => ipcRenderer.invoke(CHANNELS.cancelRun, runId),
  publishRun: (runId) => ipcRenderer.invoke(CHANNELS.publishRun, runId),
  openPullRequest: (url) => ipcRenderer.invoke(CHANNELS.openPullRequest, url),
  onState(callback) {
    if (typeof callback !== 'function') throw new TypeError('State callback must be a function.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on(CHANNELS.state, listener);
    return () => ipcRenderer.removeListener(CHANNELS.state, listener);
  }
});
