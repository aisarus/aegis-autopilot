const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'chatgpt-preload.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer', 'app.css'), 'utf8');
const graph = fs.readFileSync(path.join(root, 'renderer', 'graph.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(main.includes("chatView.setVisible(chatPanelVisible)"), 'ChatGPT must be hidden with View.setVisible, not by destroying its viewport.');
assert(!main.includes("x: -10000, y: -10000, width: 1, height: 1"), 'The broken 1x1 off-screen ChatGPT viewport must not return.');
assert(main.includes("state.settings.chatSkin = 'off'"), 'Saved installs must migrate to original ChatGPT styling.');
assert(preload.includes("applyAegisSkin('off')"), 'ChatGPT preload must start with no injected skin.');
assert(css.includes('body.chat-panel-open .control-dock.app-shell'), 'Chat mode must show the autopilot controller on the left.');
assert(css.includes('body.chat-panel-open .cosmic-workspace { display: none'), 'Chat mode must hide the graph instead of stacking it under ChatGPT.');
assert(graph.includes('const stars = Array.from({ length: 720 }'), 'Cosmic mode must contain a real WebGL star field.');
assert(graph.includes('const gridLines = []'), 'Cosmic mode must contain a real 3D grid.');
assert(graph.includes("await api.setChatPanel({ visible: true })"), 'Opening a chat node must reveal the native ChatGPT view.');

console.log('stable cosmic split smoke test: OK');
