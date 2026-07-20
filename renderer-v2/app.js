'use strict';

const credentialDefinitions = [
  { name: 'github', label: 'GitHub token', placeholder: 'Fine-grained PAT: Contents + PRs + Issues' },
  { name: 'openai', label: 'OpenAI API key', placeholder: 'Используется агентами OpenAI Responses' },
  { name: 'gemini', label: 'Gemini API key', placeholder: 'Используется агентами Gemini Interactions' }
];

const projectDefaults = {
  lamdan: { provider: 'openai', taskId: 's3-003', slug: 'cancellation', model: '' },
  edge: { provider: 'gemini', taskId: 'security-headers', slug: 'csp', model: '' },
  aegis: { provider: 'openai', taskId: 'v2-010', slug: 'electron-shell', model: '' }
};

let state = null;
let toastTimer = null;
const projectRefs = new Map();
const credentialRefs = new Map();

function $(selector) {
  return document.querySelector(selector);
}

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}

function button(text, className = 'button') {
  const element = node('button', className, text);
  element.type = 'button';
  return element;
}

function showToast(message, error = false) {
  const toast = $('#toast');
  toast.textContent = String(message || 'Готово');
  toast.classList.toggle('error', Boolean(error));
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

async function invoke(method, ...args) {
  try {
    const response = await window.aegisV2[method](...args);
    if (!response?.ok) throw new Error(response?.error?.message || 'Операция не выполнена.');
    return response.data;
  } catch (error) {
    showToast(error?.message || error, true);
    throw error;
  }
}

function toneForStatus(status) {
  if (['published', 'ready_for_review', 'ready', 'success'].includes(status)) return 'success';
  if (['starting', 'running', 'publishing', 'cancelling'].includes(status)) return 'working';
  if (['failed', 'publish_failed', 'cancelled'].includes(status)) return 'danger';
  if (['blocked', 'needs_user', 'degraded'].includes(status)) return 'warning';
  return 'neutral';
}

function createField(labelText, control, wide = false) {
  const wrapper = node('div', `field${wide ? ' wide' : ''}`);
  const label = node('label', '', labelText);
  label.htmlFor = control.id;
  wrapper.append(label, control);
  return wrapper;
}

function createResultBlock(title) {
  const wrapper = node('div', 'result-block');
  const heading = node('div', 'result-title', title);
  const content = node('div', 'result-content');
  wrapper.append(heading, content);
  return { wrapper, content };
}

function renderCredentials() {
  const grid = $('#credential-grid');
  grid.replaceChildren();
  credentialRefs.clear();

  for (const definition of credentialDefinitions) {
    const card = node('div', 'credential-card');
    const head = node('div', 'credential-head');
    const name = node('div', 'credential-name', definition.label);
    const status = node('span', 'badge', 'не настроен');
    status.dataset.tone = 'warning';
    head.append(name, status);

    const actions = node('div', 'credential-actions');
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.placeholder = definition.placeholder;
    input.setAttribute('aria-label', definition.label);
    const save = button('Сохранить', 'button button-primary button-small');
    const remove = button('Удалить', 'button button-danger button-small');
    actions.append(input, save, remove);
    card.append(head, actions);
    grid.append(card);

    save.addEventListener('click', async () => {
      const secret = input.value.trim();
      if (!secret) return showToast(`Вставь ${definition.label}.`, true);
      save.disabled = true;
      try {
        await invoke('saveCredential', definition.name, secret);
        input.value = '';
        showToast(`${definition.label}: сохранено в защищённом хранилище.`);
        await refreshState();
      } finally {
        save.disabled = false;
      }
    });
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await invoke('removeCredential', definition.name);
        input.value = '';
        showToast(`${definition.label}: удалено.`);
        await refreshState();
      } finally {
        remove.disabled = false;
      }
    });

    credentialRefs.set(definition.name, { status, input, save, remove });
  }
}

function buildProjectCard(project) {
  const defaults = projectDefaults[project.id] || { provider: 'openai', taskId: 'task', slug: 'task', model: '' };
  const card = node('article', 'project-card');
  card.dataset.projectId = project.id;

  const header = node('div', 'project-header');
  const titleGroup = node('div');
  titleGroup.append(node('h3', '', project.name), node('div', 'repo', project.repository));
  const runBadge = node('span', 'badge', 'idle');
  runBadge.dataset.tone = 'neutral';
  header.append(titleGroup, runBadge);

  const meta = node('div', 'project-meta');
  const baselineBox = node('div', 'meta-box');
  baselineBox.append(node('span', 'meta-label', 'Baseline'), node('span', 'meta-value', 'не загружен'));
  const baselineValue = baselineBox.lastElementChild;
  const shaBox = node('div', 'meta-box');
  shaBox.append(node('span', 'meta-label', 'Default SHA'), node('span', 'meta-value', '—'));
  const shaValue = shaBox.lastElementChild;
  meta.append(baselineBox, shaBox);

  const form = node('div', 'form-grid');
  const provider = document.createElement('select');
  provider.id = `provider-${project.id}`;
  for (const value of ['openai', 'gemini']) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value === 'openai' ? 'OpenAI Responses' : 'Gemini Interactions';
    provider.append(option);
  }
  provider.value = defaults.provider;

  const model = document.createElement('input');
  model.id = `model-${project.id}`;
  model.value = defaults.model;
  model.placeholder = 'пусто = модель по умолчанию';

  const taskId = document.createElement('input');
  taskId.id = `task-${project.id}`;
  taskId.value = defaults.taskId;
  taskId.pattern = '[a-z0-9][a-z0-9._-]{0,63}';

  const slug = document.createElement('input');
  slug.id = `slug-${project.id}`;
  slug.value = defaults.slug;
  slug.pattern = '[a-z0-9][a-z0-9._-]{0,63}';

  const instruction = document.createElement('textarea');
  instruction.id = `instruction-${project.id}`;
  instruction.value = project.nextTask || '';

  form.append(
    createField('Провайдер', provider),
    createField('Модель', model),
    createField('Task ID', taskId),
    createField('Branch slug', slug),
    createField('Инструкция агенту', instruction, true)
  );

  const autoPublishRow = node('label', 'checkbox-row');
  const autoPublish = document.createElement('input');
  autoPublish.type = 'checkbox';
  autoPublishRow.append(autoPublish, document.createTextNode('Автоматически открыть draft PR после зелёных проверок'));

  const actions = node('div', 'card-actions');
  const start = button('Запустить агента', 'button button-primary');
  const cancel = button('Остановить', 'button button-danger');
  const publish = button('Опубликовать draft PR', 'button button-green');
  const openPr = button('Открыть PR', 'button button-secondary');
  actions.append(start, cancel, publish, openPr);

  const result = node('div', 'run-result');
  const summaryBlock = createResultBlock('Результат');
  const filesBlock = createResultBlock('Изменённые файлы');
  const testsBlock = createResultBlock('Проверки');
  const risksBlock = createResultBlock('Риски / ошибка');
  result.append(summaryBlock.wrapper, filesBlock.wrapper, testsBlock.wrapper, risksBlock.wrapper);

  card.append(header, meta, form, autoPublishRow, actions, result);

  start.addEventListener('click', async () => {
    const input = {
      projectId: project.id,
      provider: provider.value,
      model: model.value.trim(),
      taskId: taskId.value.trim().toLowerCase(),
      slug: slug.value.trim().toLowerCase(),
      instruction: instruction.value.trim(),
      autoPublish: autoPublish.checked
    };
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.taskId) || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.slug)) {
      return showToast('Task ID и slug: только a-z, 0-9, точка, дефис и подчёркивание.', true);
    }
    start.disabled = true;
    try {
      const run = await invoke('startRun', input);
      showToast(`${project.name}: запуск ${run.id} создан.`);
      await refreshState();
    } finally {
      updateState(state);
    }
  });

  cancel.addEventListener('click', async () => {
    const activeRunId = card.dataset.activeRunId;
    if (!activeRunId) return;
    await invoke('cancelRun', activeRunId);
    showToast(`${project.name}: отправлена отмена.`);
    await refreshState();
  });

  publish.addEventListener('click', async () => {
    const runId = card.dataset.latestRunId;
    if (!runId) return;
    publish.disabled = true;
    try {
      const run = await invoke('publishRun', runId);
      showToast(`${project.name}: draft PR #${run.publication?.pullRequest?.number || '—'} опубликован.`);
      await refreshState();
    } finally {
      updateState(state);
    }
  });

  openPr.addEventListener('click', async () => {
    const url = card.dataset.pullRequestUrl;
    if (url) await invoke('openPullRequest', url);
  });

  provider.addEventListener('change', () => updateState(state));

  projectRefs.set(project.id, {
    card,
    runBadge,
    baselineValue,
    shaValue,
    provider,
    model,
    taskId,
    slug,
    instruction,
    autoPublish,
    start,
    cancel,
    publish,
    openPr,
    summary: summaryBlock.content,
    files: filesBlock.content,
    tests: testsBlock.content,
    risks: risksBlock.content
  });
  return card;
}

function ensureProjectCards(projects) {
  const grid = $('#project-grid');
  const ids = projects.map((project) => project.id).join(',');
  if (grid.dataset.projectIds === ids) return;
  grid.dataset.projectIds = ids;
  grid.replaceChildren();
  projectRefs.clear();
  for (const project of projects) grid.append(buildProjectCard(project));
}

function renderList(container, values, emptyText) {
  container.replaceChildren();
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) {
    container.append(node('div', 'result-text', emptyText));
    return;
  }
  const list = node('ul', 'file-list');
  for (const value of items) list.append(node('li', '', String(value)));
  container.append(list);
}

function updateProject(project) {
  const refs = projectRefs.get(project.id);
  if (!refs) return;
  const baseline = project.baseline;
  const latestRun = (state.runs || []).find((run) => run.projectId === project.id) || null;
  const activeRun = project.activeRunId ? (state.runs || []).find((run) => run.id === project.activeRunId) : null;
  const status = activeRun?.status || latestRun?.status || 'idle';

  refs.runBadge.textContent = status;
  refs.runBadge.dataset.tone = toneForStatus(status);
  refs.baselineValue.textContent = baseline?.status || 'не загружен';
  refs.baselineValue.title = baseline?.errors?.map((error) => error.message).join('\n') || '';
  refs.shaValue.textContent = baseline?.baseSha ? baseline.baseSha.slice(0, 10) : '—';
  refs.shaValue.title = baseline?.baseSha || '';

  refs.card.dataset.activeRunId = project.activeRunId || '';
  refs.card.dataset.latestRunId = latestRun?.id || '';
  refs.card.dataset.pullRequestUrl = latestRun?.publication?.pullRequest?.url || '';

  const providerConfigured = Boolean(state.credentials?.configured?.[refs.provider.value]);
  const githubConfigured = Boolean(state.credentials?.configured?.github);
  refs.start.disabled = Boolean(project.activeRunId) || !providerConfigured || !githubConfigured;
  refs.cancel.disabled = !project.activeRunId;
  refs.publish.disabled = !latestRun || !['ready_for_review', 'publish_failed'].includes(latestRun.status) || !githubConfigured;
  refs.openPr.disabled = !latestRun?.publication?.pullRequest?.url;

  refs.summary.replaceChildren(node('p', 'result-text', latestRun?.summary || latestRun?.error?.message || 'Запусков ещё не было.'));
  renderList(refs.files, latestRun?.changedFiles, 'Файлы ещё не изменялись.');
  renderList(refs.tests, latestRun?.tests, 'Проверки ещё не запускались.');
  const riskValues = [...(latestRun?.risks || [])];
  if (latestRun?.error?.message) riskValues.unshift(`${latestRun.error.code}: ${latestRun.error.message}`);
  renderList(refs.risks, riskValues, 'Риски не зафиксированы.');
}

function updateCredentials() {
  for (const definition of credentialDefinitions) {
    const refs = credentialRefs.get(definition.name);
    if (!refs) continue;
    const configured = Boolean(state.credentials?.configured?.[definition.name]);
    refs.status.textContent = configured ? 'настроен' : 'не настроен';
    refs.status.dataset.tone = configured ? 'success' : 'warning';
    refs.remove.disabled = !configured;
  }
}

function renderEvents(events) {
  const list = $('#event-list');
  list.replaceChildren();
  const entries = Array.isArray(events) ? events.slice(0, 80) : [];
  if (!entries.length) return list.append(node('div', 'empty', 'Событий пока нет.'));
  for (const event of entries) {
    const row = node('div', 'event-item');
    const time = event.at ? new Date(event.at).toLocaleString('ru-RU') : '—';
    row.append(
      node('div', 'event-time', time),
      node('div', 'event-type', event.type || 'event'),
      node('div', 'event-message', event.message || '')
    );
    list.append(row);
  }
}

function updateState(nextState) {
  if (!nextState) return;
  state = nextState;
  ensureProjectCards(state.projects || []);
  updateCredentials();
  for (const project of state.projects || []) updateProject(project);
  $('#active-summary').textContent = `Активных запусков: ${state.activeRunCount || 0} / 3`;
  const baselineStatus = $('#baseline-status');
  baselineStatus.textContent = state.baselineStatus === 'not_loaded'
    ? 'GitHub ещё не прочитан'
    : `Baseline: ${state.baselineStatus}${state.baselineObservedAt ? ` · ${new Date(state.baselineObservedAt).toLocaleTimeString('ru-RU')}` : ''}`;
  baselineStatus.dataset.tone = toneForStatus(state.baselineStatus);
  renderEvents(state.events);
}

async function refreshState() {
  const nextState = await invoke('getState');
  updateState(nextState);
  return nextState;
}

$('#refresh-baselines').addEventListener('click', async (event) => {
  const control = event.currentTarget;
  control.disabled = true;
  try {
    await invoke('refreshBaselines');
    showToast('GitHub baseline трёх проектов обновлён.');
    await refreshState();
  } finally {
    control.disabled = false;
  }
});

renderCredentials();
window.aegisV2.onState(updateState);
refreshState().catch(() => {});
