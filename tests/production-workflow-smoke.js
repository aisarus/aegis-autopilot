const fs = require('fs');
const assert = require('assert');

const main = fs.readFileSync('main.js', 'utf8');
const preload = fs.readFileSync('preload.js', 'utf8');
const renderer = fs.readFileSync('renderer/app.js', 'utf8');
const html = fs.readFileSync('renderer/index.html', 'utf8');
const updater = fs.readFileSync('AEGIS-UPDATE-AND-RUN.cmd', 'utf8');
const doctor = fs.readFileSync('scripts/doctor.js', 'utf8');
const bundle = fs.readFileSync('scripts/create-debug-bundle.js', 'utf8');

assert(main.includes("ipcMain.handle('aegis:test-send'"), 'main process must expose isolated send test');
assert(main.includes("kind: 'AEGIS_SEND_TEST'"), 'send test must produce a typed diagnostic report');
assert(main.includes('buildId: BUILD_ID'), 'send report must include exact build id');
assert(preload.includes('testSend:'), 'renderer bridge must expose testSend');
assert(html.includes('id="test-send"'), 'control panel must show the test-send button');
assert(renderer.includes("call('testSend')"), 'test-send button must invoke the isolated harness');
assert(updater.includes('npm.cmd ci'), 'one-click updater must install from the lockfile');
assert(updater.includes('npm.cmd run verify'), 'one-click updater must pass the full verification gate');
assert(doctor.includes('[Aegis doctor] OK'), 'local doctor must remain available');
assert(bundle.includes('# Aegis debug bundle'), 'debug bundle generator must remain available');

console.log('production workflow smoke test: OK');
