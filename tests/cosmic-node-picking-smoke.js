const fs = require('fs');
const path = require('path');

const graph = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'graph.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(graph.includes('let projectedNodeHits = []'), 'Projected node hit targets must be retained from the render pass.');
assert(graph.includes('function pickNodeAt(clientX, clientY)'), 'Canvas must support direct node hit-testing.');
assert(graph.includes('if (moved) return;'), 'Camera drags must not accidentally open chats.');
assert(graph.includes('if (node.chat) void openSelected(node.id);'), 'A direct click on a chat node must open its native ChatGPT conversation.');
assert(!graph.includes("element.addEventListener('dblclick'"), 'Chat labels must not require a double click.');

console.log('cosmic node picking smoke test: OK');
