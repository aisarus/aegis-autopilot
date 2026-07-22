'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { createRuntimeComponents } = require('../orchestrator/electron-runtime-factory');

(async () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'v2-main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'v2-preload.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'renderer-v2', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer-v2', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'renderer-v2', 'app.css'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  for (const token of [
    "const APP_NAME = 'Aegis Orchestrator'",
    "const APP_ID = 'com.aegis.orchestrator.v2'",
    'contextIsolation: true',
    'nodeIntegration: false',
    'sandbox: true',
    "mainWindow.loadFile(path.join(__dirname, 'renderer-v2', 'index.html'))",
    'mainWindow.webContents.setWindowOpenHandler',
    "url.protocol === 'https:'",
    "url.hostname === 'github.com'",
    "registerHandler(IPC.startRun",
    "registerHandler(IPC.cancelRun",
    "registerHandler(IPC.publishRun"
  ]) {
    assert(main.includes(token), `Missing v2 main-process contract: ${token}`);
  }
  assert.equal(main.includes('chatgpt.com'), false, 'Standalone v2 main process must not load ChatGPT.');
  assert.equal(main.includes('nodeIntegration: true'), false, 'Node integration must remain disabled.');
  assert.equal(main.includes('shell.openExternal(value)'), false, 'Unvalidated external URLs must not be opened.');

  for (const token of [
    "contextBridge.exposeInMainWorld('aegisV2'",
    'saveCredential: (name, secret)',
    'refreshBaselines:',
    'startRun:',
    'cancelRun:',
    'publishRun:',
    'openPullRequest:',
    'ipcRenderer.removeListener'
  ]) {
    assert(preload.includes(token), `Missing v2 preload contract: ${token}`);
  }
  assert.equal(preload.includes('require(') && !preload.includes("require('electron')"), false, 'Preload must expose only the Electron IPC bridge.');

  for (const token of [
    "default-src 'self'",
    "connect-src 'none'",
    'id="credential-grid"',
    'id="project-grid"',
    'id="event-list"',
    'renderer-v2'
  ]) {
    assert(html.includes(token) || (token === 'renderer-v2' && main.includes(token)), `Missing v2 HTML contract: ${token}`);
  }
  assert.equal(/https?:\/\//.test(html), false, 'Renderer HTML must not load remote assets.');

  for (const token of [
    'const projectDefaults =',
    "lamdan:",
    "edge:",
    "aegis:",
    "invoke('saveCredential'",
    "invoke('refreshBaselines'",
    "invoke('startRun'",
    "invoke('cancelRun'",
    "invoke('publishRun'",
    'document.createElement',
    'textContent'
  ]) {
    assert(renderer.includes(token), `Missing v2 renderer contract: ${token}`);
  }
  for (const forbidden of ['innerHTML', 'eval(', 'new Function(', 'window.open(', 'localStorage']) {
    assert.equal(renderer.includes(forbidden), false, `Unsafe renderer primitive is present: ${forbidden}`);
  }
  assert(css.includes('--purple-soft'));
  assert(css.includes('--pink-soft'));
  assert(css.includes('--green-soft'));
  assert(css.includes('.project-grid'));

  assert.equal(pkg.scripts['dev:v2'], 'electron v2-main.js');
  assert.equal(pkg.scripts['start:v2'], 'electron v2-main.js');
  for (const packagedFile of ['v2-main.js', 'v2-preload.js', 'renderer-v2/**/*', 'orchestrator/**/*']) {
    assert(pkg.build.files.includes(packagedFile), `V2 build file is missing: ${packagedFile}`);
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aegis-v2-factory-'));
  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').slice(4)
  };
  const components = createRuntimeComponents({
    safeStorage: fakeSafeStorage,
    userDataPath: tempDir,
    platform: 'win32'
  });
  assert.equal(components.registry.projects.length, 3);
  assert(components.rootDir.startsWith(tempDir));
  assert.equal((await components.credentialStore.metadata()).available, true);
  assert.equal(typeof components.runtime.startRun, 'function');
  assert.equal(typeof components.projectAgentRunner.run, 'function');
  await fsp.rm(tempDir, { recursive: true, force: true });

  console.log('Standalone Electron orchestrator v2 smoke test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
