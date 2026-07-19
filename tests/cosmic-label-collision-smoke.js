const fs = require('fs');
const path = require('path');

const graph = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'graph.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(graph.includes('function resolveLabelCollisions(items, width, height)'), 'Cosmic labels must use screen-space collision resolution.');
assert(graph.includes('rectanglesOverlap(rect, used)'), 'Label placement must reject overlapping rectangles.');
assert(graph.includes("element.dataset.overlapHidden = 'true'"), 'Unplaceable labels must be hidden instead of stacked.');
assert(graph.includes("a.node.id === selectedId ? 3"), 'The selected node must keep highest label priority.');

console.log('cosmic label collision smoke test: OK');
