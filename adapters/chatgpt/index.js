const adapters = [require('./v2026_07'), require('./legacy')].sort((a, b) => b.priority - a.priority);
let active = null;
let lastSelectionAt = 0;

function scoreAdapter(adapter, document) {
  try { return Number(adapter.probes(document)) || 0; } catch { return 0; }
}

function select(document, force = false) {
  const now = Date.now();
  if (!force && active && now - lastSelectionAt < 5000) return active;
  const ranked = adapters.map((adapter) => ({ adapter, score: scoreAdapter(adapter, document) }))
    .sort((a, b) => b.score - a.score || b.adapter.priority - a.adapter.priority);
  active = ranked[0]?.adapter || adapters.at(-1);
  lastSelectionAt = now;
  return active;
}

function queryFirst(document, selectorList, visiblePredicate) {
  for (const selector of selectorList || []) {
    for (const element of document.querySelectorAll(selector)) {
      if (!visiblePredicate || visiblePredicate(element)) return element;
    }
  }
  return null;
}

function queryAll(document, selectorList) {
  const result = [];
  const seen = new Set();
  for (const selector of selectorList || []) {
    for (const element of document.querySelectorAll(selector)) {
      if (!seen.has(element)) { seen.add(element); result.push(element); }
    }
  }
  return result;
}

module.exports = {
  select,
  queryFirst,
  queryAll,
  list: () => adapters.map(({ id, priority, description }) => ({ id, priority, description })),
  activeId: () => active?.id || 'unselected'
};
