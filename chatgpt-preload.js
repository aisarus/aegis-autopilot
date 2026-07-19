const { ipcRenderer } = require('electron');
const adapterRegistry = require('./adapters/chatgpt');

const AEGIS_SKIN_STYLE_ID = 'aegis-chat-skin';
function applyAegisSkin(mode = 'off') {
  const safeMode = ['off', 'safe', 'deep'].includes(mode) ? mode : 'off';
  document.documentElement.dataset.aegisSkin = safeMode;
  let style = document.getElementById(AEGIS_SKIN_STYLE_ID);
  if (!style) { style = document.createElement('style'); style.id = AEGIS_SKIN_STYLE_ID; document.documentElement.appendChild(style); }
  if (safeMode === 'off') { style.textContent = ''; return { ok: true, mode: safeMode }; }
  const safeCss = `
    :root { color-scheme: light !important; --aegis-cream:#f6f0e7; --aegis-paper:#fffaf3; --aegis-ink:#362f2b; --aegis-purple:#9d8be8; --aegis-pink:#efb6c6; --aegis-green:#b7d8b3; }
    html, body { background:var(--aegis-cream)!important; }
    body { color:var(--aegis-ink)!important; }
    main { background:transparent!important; }
    nav, aside { scrollbar-color:#c9bdde transparent; }
    #prompt-textarea, [contenteditable="true"][data-virtualkeyboard], textarea { border-radius:24px!important; }
    form:has(#prompt-textarea), form:has([contenteditable="true"]) { border-radius:28px!important; box-shadow:0 10px 32px rgba(92,72,67,.10)!important; }
    button { border-radius:999px!important; }
    ::selection { background:rgba(157,139,232,.28)!important; }
    * { scrollbar-width:thin; scrollbar-color:#c9bdde transparent; }
  `;
  const deepCss = `
    body, main, [class*="bg-token-main-surface"] { background:var(--aegis-cream)!important; }
    [data-message-author-role="assistant"] .markdown { background:rgba(255,250,243,.72)!important; border:1px solid rgba(157,139,232,.14)!important; border-radius:22px!important; padding:18px 20px!important; }
    [data-message-author-role="user"] { border-radius:22px!important; }
    header { background:rgba(246,240,231,.86)!important; backdrop-filter:blur(16px)!important; }
    [class*="bg-token-sidebar-surface"] { background:#efe7dc!important; }
    a:hover, button:hover { filter:saturate(.9); }
  `;
  style.textContent = safeCss + (safeMode === 'deep' ? deepCss : '');
  return { ok: true, mode: safeMode };
}

const CHAT_PATH = /^\/(?:c\/[^/?#]+|g\/[^/?#]+\/c\/[^/?#]+)\/?$/i;
const JUNK_CHAT_TITLE = /^(?:skip to (?:main )?content|перейти к содержимому|перейти к основному содержимому|דלג לתוכן|chatgpt|open sidebar|открыть боковую панель)$/i;
let lastFingerprint = '';
let scheduled = null;
let lastAssistantChangeAt = 0;
let lastAssistantFingerprint = '';


function cleanText(value, max = 12000) {
  return String(value || '').replace(/\u200b/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

function cleanMessageText(value, max = 24000) {
  const text = String(value || '').replace(/\u200b/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? text.slice(-max) : text;
}

function normalizedUrl(value) {
  try {
    const parsed = new URL(value, location.origin);
    parsed.hash = '';
    parsed.search = '';
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '') || '/'}`;
  } catch {
    return '';
  }
}

function conversationKey(value) {
  const normalized = normalizedUrl(value);
  if (!normalized) return '';
  try {
    const pathname = new URL(normalized).pathname;
    const match = pathname.match(/\/c\/([^/?#]+)/i);
    return match ? `c:${match[1].toLocaleLowerCase()}` : pathname.toLocaleLowerCase();
  } catch {
    return '';
  }
}

function sameUrl(left, right) {
  const leftKey = conversationKey(left);
  const rightKey = conversationKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function isVisible(element) {
  if (!element || !(element instanceof Element)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
}

function chatTitleFromAnchor(anchor) {
  const sources = [anchor.innerText, anchor.getAttribute('aria-label'), anchor.getAttribute('title')];
  for (const source of sources) {
    for (const rawLine of String(source || '').split('\n')) {
      const title = cleanText(rawLine, 200).replace(/^(?:(?:open|открыть)\s+|(?:chat history|conversation|история чата)\s*[:—-]\s*)/i, '').trim();
      if (title.length >= 2 && !JUNK_CHAT_TITLE.test(title)) return title;
    }
  }
  return '';
}

function chatAnchorScore(anchor, title) {
  let score = 0;
  const rawHref = String(anchor.getAttribute('href') || '');
  if (anchor.closest('nav, aside, [data-testid*="sidebar"], [data-testid*="history"]')) score += 120;
  if (anchor.getAttribute('aria-current') === 'page') score += 45;
  if (isVisible(anchor)) score += 25;
  if (!rawHref.includes('#')) score += 30;
  if (anchor.closest('main')) score -= 80;
  if (rawHref.includes('#')) score -= 240;
  if (!title || JUNK_CHAT_TITLE.test(title)) score -= 1000;
  return score;
}

function rankedChatAnchors(targetUrl = '') {
  const candidates = [];
  for (const anchor of document.querySelectorAll('a[href]')) {
    const url = normalizedUrl(anchor.href);
    if (!url || new URL(url).hostname !== 'chatgpt.com' || !CHAT_PATH.test(new URL(url).pathname)) continue;
    if (targetUrl && !sameUrl(url, targetUrl)) continue;
    const title = chatTitleFromAnchor(anchor);
    const score = chatAnchorScore(anchor, title);
    if (score <= -500) continue;
    candidates.push({ anchor, title, url, score });
  }
  return candidates.sort((left, right) => right.score - left.score);
}

function chatLinks() {
  const bestByPath = new Map();
  for (const candidate of rankedChatAnchors()) {
    const key = new URL(candidate.url).pathname.toLocaleLowerCase();
    const current = bestByPath.get(key);
    if (!current || candidate.score > current.score) bestByPath.set(key, candidate);
  }
  return [...bestByPath.values()].slice(0, 150).map(({ title, url }) => ({ title, url }));
}

function activeAdapter(force = false) { return adapterRegistry.select(document, force); }

function composerElement() {
  return adapterRegistry.queryFirst(document, activeAdapter().selectors.composer, isVisible);
}

function composerValue(element = composerElement()) {
  if (!element) return '';
  if ('value' in element) return cleanText(element.value, 4000);
  return cleanText(element.innerText || element.textContent, 4000);
}

function buttonMatches(button, patterns) {
  const text = cleanText(`${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.innerText || ''}`, 300).toLocaleLowerCase();
  return patterns.some((pattern) => text.includes(pattern));
}

function generatingNow() {
  const direct = adapterRegistry.queryFirst(document, activeAdapter().selectors.stopButton, isVisible);
  if (direct && isVisible(direct)) return true;
  const patterns = ['stop generating', 'stop response', 'stop streaming', 'остановить', 'прервать ответ', 'עצור'];
  if ([...document.querySelectorAll('main button, form button')].some((button) => isVisible(button) && buttonMatches(button, patterns))) return true;
  const lastAssistant = adapterRegistry.queryAll(document, activeAdapter().selectors.assistantMessages).filter(isVisible).at(-1);
  if (lastAssistant?.matches('[aria-busy="true"], [data-streaming="true"]') || lastAssistant?.querySelector('[aria-busy="true"], [data-streaming="true"], .result-streaming, [class*="streaming"]')) return true;
  return false;
}

function sendButton() {
  const direct = adapterRegistry.queryFirst(document, activeAdapter().selectors.sendButton, isVisible);
  if (direct && isVisible(direct)) return direct;
  const patterns = ['send message', 'send prompt', 'отправить', 'שלח'];
  return [...document.querySelectorAll('form button, main button')].find((button) => isVisible(button) && buttonMatches(button, patterns)) || null;
}

function systemBlockDetected() {
  const nodes = [...document.querySelectorAll('[role="alert"], [role="dialog"], [data-testid*="toast"], main form + div')].filter(isVisible).slice(-12);
  const text = cleanText(nodes.map((node) => node.innerText).join('\n'), 6000).toLocaleLowerCase();
  return [
    'you have reached the limit', 'you’ve reached the limit', 'usage limit', 'too many requests', 'try again later',
    'достигли лимита', 'лимит сообщений', 'слишком много запросов', 'повторите попытку позже',
    'הגעת למגבלה', 'נסה שוב מאוחר יותר'
  ].some((phrase) => text.includes(phrase));
}

function conversationMessages() {
  let turns = adapterRegistry.queryAll(document, activeAdapter().selectors.messageTurns).filter(isVisible);
  if (!turns.length) turns = adapterRegistry.queryAll(document, activeAdapter().selectors.roleNodes).map((node) => node.closest('article') || node).filter(isVisible);
  const messages = [];
  for (const turn of turns.slice(-10)) {
    const roleNode = turn.matches('[data-message-author-role]') ? turn : turn.querySelector('[data-message-author-role]');
    const attributeRole = roleNode?.getAttribute('data-message-author-role');
    const heading = cleanText(turn.querySelector('h5, h6')?.innerText, 120).toLocaleLowerCase();
    const role = attributeRole === 'assistant' || /chatgpt|assistant|сказал chatgpt/.test(heading) ? 'assistant' : 'user';
    const contentNode = turn.querySelector('[data-message-author-role] .markdown, .markdown, [data-message-author-role]') || turn;
    let text = cleanMessageText(contentNode.innerText);
    text = text.replace(/^(you said:|chatgpt said:|вы сказали:|chatgpt сказал:)\s*/i, '');
    if (!text || messages.some((entry) => entry.role === role && entry.text === text)) continue;
    const turnId = cleanText(turn.getAttribute('data-testid') || turn.id || roleNode?.getAttribute('data-message-id') || '', 180);
    messages.push({ role, text, id: turnId });
  }
  if (!messages.some((entry) => entry.role === 'assistant')) {
    // Last-resort semantic scan. This is intentionally broad and only used when
    // the versioned adapter could not see any assistant turns.
    const candidates = [...document.querySelectorAll('main article, main [data-message-author-role="assistant"], main [data-testid*="conversation-turn"]')].filter(isVisible);
    for (const node of candidates.slice(-12)) {
      const explicitRole = cleanText(node.getAttribute('data-message-author-role'), 30).toLowerCase();
      const roleNode = node.querySelector('[data-message-author-role]');
      const nestedRole = cleanText(roleNode?.getAttribute('data-message-author-role'), 30).toLowerCase();
      const role = explicitRole || nestedRole;
      if (role !== 'assistant') continue;
      const text = cleanText(node.innerText || node.textContent, 120000);
      if (!text) continue;
      const id = cleanText(node.getAttribute('data-testid') || node.id || '', 180);
      if (!messages.some((entry) => entry.role === 'assistant' && entry.text === text)) messages.push({ role: 'assistant', text, id });
    }
  }
  return messages.slice(-8);
}

function fallbackAssistantMessage() {
  const explicit = [...document.querySelectorAll('main [data-message-author-role="assistant"]')].filter(isVisible).at(-1);
  if (explicit) {
    const host = explicit.closest('article, [data-testid*="conversation-turn"]') || explicit;
    const text = cleanMessageText((host.querySelector('.markdown') || explicit).innerText || explicit.textContent);
    if (text) return { role: 'assistant', text, id: cleanText(host.id || host.getAttribute('data-testid') || '', 180) };
  }
  // Current ChatGPT builds keep action buttons (copy / feedback / retry) under
  // assistant turns. Walk upward from the last such toolbar instead of relying
  // on one version-specific class name.
  const actionButtons = [...document.querySelectorAll('main button')].filter((button) => {
    if (!isVisible(button)) return false;
    const label = cleanText(`${button.getAttribute('aria-label') || ''} ${button.getAttribute('data-testid') || ''}`, 180).toLowerCase();
    return /copy|thumb|feedback|good response|bad response|retry|regenerate|копир|оцен|повтор/.test(label);
  });
  for (const button of actionButtons.reverse()) {
    let node = button.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      if (!node.matches?.('article, [data-testid*="conversation-turn"], main > div > div')) continue;
      const textNode = node.querySelector?.('.markdown, [class*="markdown"], [data-message-author-role="assistant"]');
      const text = cleanMessageText((textNode || node).innerText || (textNode || node).textContent);
      if (text && text.length > 8) return { role: 'assistant', text, id: cleanText(node.id || node.getAttribute?.('data-testid') || '', 180) };
    }
  }
  return null;
}

function conversationLoading(messages = []) {
  if (!CHAT_PATH.test(location.pathname)) return false;
  const main = document.querySelector('main');
  if (!main) return true;
  const composer = composerElement();
  const composerTop = composer?.getBoundingClientRect().top || window.innerHeight;
  const selectors = ['[role="progressbar"]', '[aria-busy="true"]', '[data-testid*="loading"]', '.animate-spin', '[class*="loading-spinner"]', '[class~="spinner"]', 'svg[class*="animate-spin"]'];
  const indicators = [...main.querySelectorAll(selectors.join(','))].filter((element) => {
    if (!isVisible(element) || element.closest('form')) return false;
    return element.getBoundingClientRect().top < composerTop - 20;
  });
  if (indicators.length) return true;
  const animatedSvg = [...main.querySelectorAll('svg')].some((element) => {
    if (!isVisible(element) || element.closest('button, form')) return false;
    const rect = element.getBoundingClientRect();
    const animationName = getComputedStyle(element).animationName;
    return rect.width >= 12 && rect.width <= 96 && rect.height >= 12 && rect.height <= 96
      && rect.top < composerTop - 20 && animationName && animationName !== 'none';
  });
  if (animatedSvg) return true;
  if (messages.length) return false;
  const text = cleanText(main.innerText, 500).toLocaleLowerCase();
  return /^(?:loading|загрузка|загружаем|טוען)[. …]*$/i.test(text);
}

function currentChatTitle(chats) {
  const currentAnchor = rankedChatAnchors(location.href)[0];
  if (currentAnchor?.title) return currentAnchor.title;
  const current = chats.find((chat) => sameUrl(chat.url, location.href) && !JUNK_CHAT_TITLE.test(chat.title));
  if (current) return current.title;
  const candidates = [
    document.querySelector('main h1')?.innerText,
    document.querySelector('header h1')?.innerText,
    document.title.replace(/\s*[-–|]\s*ChatGPT.*$/i, '')
  ];
  for (const value of candidates) {
    const title = cleanText(value, 160);
    if (title.length > 1 && !JUNK_CHAT_TITLE.test(title)) return title;
  }
  return '';
}

function elementSignature(element) {
  if (!element) return '';
  const bits = [element.tagName.toLocaleLowerCase()];
  if (element.id) bits.push(`#${cleanText(element.id, 120)}`);
  for (const attribute of ['data-testid', 'data-id', 'role', 'contenteditable']) {
    const value = element.getAttribute(attribute);
    if (value) bits.push(`[${attribute}="${cleanText(value, 120)}"]`);
  }
  const ariaLabel = cleanText(element.getAttribute('aria-label'), 160);
  if (ariaLabel) bits.push(`[aria-label="${ariaLabel}"]`);
  return bits.join('');
}

function inspect() {
  const composer = composerElement();
  const chats = chatLinks();
  const generating = generatingNow();
  const limitDetected = systemBlockDetected();
  const send = sendButton();
  const messages = conversationMessages();
  const fallbackAssistant = fallbackAssistantMessage();
  if (fallbackAssistant && !messages.some((message) => message.role === 'assistant' && message.text === fallbackAssistant.text)) messages.push(fallbackAssistant);
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant' && message.text);
  const assistantFingerprint = lastAssistant ? `${lastAssistant.id || ''}:${lastAssistant.text}` : '';
  if (assistantFingerprint && assistantFingerprint !== lastAssistantFingerprint) {
    lastAssistantFingerprint = assistantFingerprint;
    lastAssistantChangeAt = Date.now();
  }
  const currentPathIsChat = CHAT_PATH.test(location.pathname);
  // The composer is the operational source of truth. ChatGPT frequently virtualizes
  // or reshapes old message turns, so missing history must never block sending.
  const rawLoadingConversation = conversationLoading(messages);
  const loadingConversation = Boolean(rawLoadingConversation && !composer);
  const conversationReady = Boolean(currentPathIsChat && composer);
  const loginVisible = [...document.querySelectorAll('button, a')].some((node) => isVisible(node) && /^(log in|sign up|войти|зарегистрироваться|התחבר)$/i.test(cleanText(node.innerText, 80)));
  const signedIn = Boolean(composer || chats.length || (!loginVisible && currentPathIsChat));
  let status = 'loading';
  let detail = 'ChatGPT загружается…';
  if (limitDetected) { status = 'blocked'; detail = 'ChatGPT показывает лимит или системную блокировку.'; }
  else if (generating) { status = 'generating'; detail = 'ChatGPT отвечает; Aegis ждёт завершения.'; }
  else if (loadingConversation) { status = 'loading-chat'; detail = 'ChatGPT загружает содержимое разговора…'; }
  else if (composer) { status = 'ready'; detail = currentPathIsChat ? 'Чат готов к следующему сообщению.' : 'ChatGPT готов; открой разговор в настоящем сайдбаре.'; }
  else if (loginVisible || /auth|login|signup/i.test(location.pathname)) { status = 'login'; detail = 'Войди в ChatGPT внутри этого окна.'; }
  else { status = 'unknown'; detail = 'DOM ChatGPT ещё не распознан. Возможно, страница загружается или интерфейс изменился.'; }
  return {
    status,
    url: location.href,
    title: document.title,
    signedIn,
    currentChatTitle: currentChatTitle(chats),
    chats,
    generating,
    composerReady: Boolean(composer && !generating && !limitDetected),
    composerText: composerValue(composer),
    conversationLoading: loadingConversation,
    conversationReady,
    limitDetected,
    detail,
    messages,
    lastAssistantText: String(lastAssistant?.text || '').slice(-24000),
    lastAssistantId: cleanText(lastAssistant?.id || '', 180),
    lastAssistantStableMs: lastAssistant ? Math.max(0, Date.now() - lastAssistantChangeAt) : 0,
    diagnostics: {
      adapterVersion: adapterRegistry.activeId(),
      pathname: location.pathname,
      readyState: document.readyState,
      composer: elementSignature(composer),
      sendButton: elementSignature(send),
      mainFound: Boolean(document.querySelector('main')),
      chatLinkCount: chats.length,
      messageCount: messages.length,
      loadingIndicator: loadingConversation,
      generating,
      limitDetected
    }
  };
}

function emitSnapshot(force = false) {
  try {
    activeAdapter(true);
    const snapshot = inspect();
    const fingerprint = JSON.stringify(snapshot);
    if (!force && fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    ipcRenderer.send('aegis-chat:snapshot', snapshot);
  } catch (error) {
    ipcRenderer.send('aegis-chat:snapshot', { status: 'unknown', url: location.href, title: document.title, signedIn: false, currentChatTitle: '', chats: [], generating: false, composerReady: false, composerText: '', conversationLoading: false, conversationReady: false, limitDetected: false, detail: `DOM adapter error: ${error.message}`, messages: [], lastAssistantStableMs: 0, diagnostics: { adapterVersion: adapterRegistry.activeId(), pathname: location.pathname, readyState: document.readyState } });
  }
}

function scheduleSnapshot() {
  clearTimeout(scheduled);
  scheduled = setTimeout(() => emitSnapshot(), 240);
}

function dispatchInputLikeUser(element, text, inputType = 'insertText') {
  try {
    element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType, data: text }));
  } catch {}
  try {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType, data: text }));
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function clearComposer(element) {
  element.focus();
  if ('value' in element) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, ''); else element.value = '';
    dispatchInputLikeUser(element, '', 'deleteContentBackward');
    return;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  try { document.execCommand('delete', false); } catch {}
  if (cleanText(element.innerText || element.textContent)) element.replaceChildren();
  dispatchInputLikeUser(element, '', 'deleteContentBackward');
  selection.removeAllRanges();
}

async function setComposerText(element, text) {
  if (!element) throw new Error('Поле ввода ChatGPT не найдено.');
  clearComposer(element);
  element.focus();

  if ('value' in element) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, text); else element.value = text;
    dispatchInputLikeUser(element, text);
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand('insertText', false, text); } catch {}
    if (!inserted || cleanText(element.innerText || element.textContent) !== cleanText(text)) {
      element.replaceChildren(document.createTextNode(text));
      dispatchInputLikeUser(element, text);
    }
    selection.removeAllRanges();
  }

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return composerValue(element);
}

function explicitUserMessages() {
  const seen = new Set();
  const messages = [];
  const nodes = [...document.querySelectorAll('main [data-message-author-role="user"]')].filter(isVisible);
  for (const roleNode of nodes) {
    const host = roleNode.closest('article, [data-testid*="conversation-turn"]') || roleNode;
    const contentNode = host.querySelector('[data-message-author-role="user"] .whitespace-pre-wrap, [data-message-author-role="user"] [class*="whitespace-pre-wrap"], [data-message-author-role="user"]') || roleNode;
    const text = cleanMessageText(contentNode.innerText || contentNode.textContent, 24000);
    if (!text) continue;
    const messageId = cleanText(host.getAttribute('data-message-id') || roleNode.getAttribute('data-message-id') || host.getAttribute('data-testid') || host.id || '', 180);
    const key = `${messageId}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push({ id: messageId, text });
  }
  if (messages.length) return messages;
  return conversationMessages().filter((message) => message.role === 'user');
}

function userMessageEvidence(intendedText = '') {
  const users = explicitUserMessages();
  const last = users.at(-1);
  const intended = cleanMessageText(intendedText, 24000);
  const lastText = cleanMessageText(last?.text || '', 24000);
  return {
    fingerprint: `${users.length}:${last?.id || ''}:${cleanText(lastText, 1200)}`,
    count: users.length,
    lastText,
    intendedMatch: Boolean(intended && lastText === intended)
  };
}

function pressEnterToSend(element) {
  element.focus();
  const options = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
  element.dispatchEvent(new KeyboardEvent('keydown', options));
  element.dispatchEvent(new KeyboardEvent('keypress', options));
  element.dispatchEvent(new KeyboardEvent('keyup', options));
}

async function submitComposer(element) {
  const button = await waitFor(() => {
    const candidate = sendButton();
    return candidate && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true' ? candidate : null;
  }, 2500);
  if (button) {
    button.focus();
    button.click();
    return 'button';
  }

  const form = element.closest('form');
  if (form && typeof form.requestSubmit === 'function') {
    try { form.requestSubmit(); return 'requestSubmit'; } catch {}
  }

  pressEnterToSend(element);
  return 'enter';
}

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function executeCommand(type, payload) {
  if (type === 'apply-skin') return applyAegisSkin(payload?.mode);
  if (type === 'inspect') {
    emitSnapshot(true);
    return { ok: true };
  }
  if (type === 'navigate') {
    const target = normalizedUrl(payload?.url);
    if (!target || new URL(target).hostname !== 'chatgpt.com' || !CHAT_PATH.test(new URL(target).pathname)) throw new Error('Aegis отказался открыть неизвестный адрес.');
    if (sameUrl(location.href, target)) {
      return { ok: true, url: target, method: 'already-current' };
    }
    const candidate = rankedChatAnchors(target)[0];
    if (candidate?.anchor) {
      candidate.anchor.click();
      setTimeout(() => { if (!sameUrl(location.href, target)) location.assign(target); }, 1200);
      return { ok: true, url: target, method: 'sidebar' };
    }
    location.assign(target);
    return { ok: true, url: target, method: 'full-navigation' };
  }
  if (type === 'send') {
    const text = String(payload?.text || '').trim();
    const targetUrl = normalizedUrl(payload?.targetUrl);
    if (!text) throw new Error('Пустое сообщение не отправляется.');
    if (targetUrl && !sameUrl(location.href, targetUrl)) throw new Error('Открыт другой разговор ChatGPT. Отправка отменена до завершения навигации.');
    if (generatingNow()) throw new Error('ChatGPT ещё отвечает.');
    if (systemBlockDetected()) throw new Error('ChatGPT показывает лимит или блокировку.');
    const composer = composerElement();
    if (!composer) throw new Error('Поле ввода ChatGPT не найдено.');
    const existingDraft = cleanText(composerValue(composer));
    const intendedText = cleanText(text);
    if (existingDraft && existingDraft !== intendedText) throw new Error('В поле ChatGPT уже есть другой черновик.');
    const beforeUser = userMessageEvidence(intendedText);
    if (existingDraft !== intendedText) await setComposerText(composer, text);
    const filled = await waitFor(() => cleanText(composerValue(composer)) === intendedText, 5000);
    if (!filled) throw new Error('ChatGPT не принял текст в поле ввода.');
    if (targetUrl && !sameUrl(location.href, targetUrl)) throw new Error('ChatGPT переключил разговор во время заполнения поля. Отправка отменена.');

    let method = await submitComposer(composer);
    const verifyAccepted = () => {
      if (targetUrl && !sameUrl(location.href, targetUrl)) return null;
      const evidence = userMessageEvidence(intendedText);
      const newUserMessage = evidence.fingerprint !== beforeUser.fingerprint && evidence.intendedMatch;
      return newUserMessage ? { composerCleared: !composerValue(composer), newUserMessage, evidence } : null;
    };
    let accepted = await waitFor(verifyAccepted, 9000);

    if (!accepted) {
      const remainingDraft = cleanText(composerValue(composer));
      // Never press Enter after ChatGPT has already consumed the composer: the
      // user turn may simply be late to render, and retrying here can duplicate it.
      if (remainingDraft === intendedText && !generatingNow() && (!targetUrl || sameUrl(location.href, targetUrl))) {
        pressEnterToSend(composer);
        method = `${method}+enter`;
      }
      accepted = await waitFor(verifyAccepted, 9000);
    }

    if (!accepted) throw new Error('ChatGPT не подтвердил отправку новым сообщением пользователя в нужном разговоре. Повтор будет выполнен безопасно.');
    emitSnapshot(true);
    return { ok: true, verified: true, method, conversationKey: conversationKey(location.href), userMessageFingerprint: accepted.evidence.fingerprint };
  }
  throw new Error(`Неизвестная команда: ${type}`);
}

ipcRenderer.on('aegis-chat:command', async (_event, command) => {
  try {
    const result = await executeCommand(command?.type, command?.payload || {});
    ipcRenderer.send('aegis-chat:command-result', { commandId: command?.commandId, ...result });
  } catch (error) {
    ipcRenderer.send('aegis-chat:command-result', { commandId: command?.commandId, ok: false, error: cleanText(error.message || error, 600) });
  }
});

window.addEventListener('DOMContentLoaded', () => {
  applyAegisSkin('off');
  emitSnapshot(true);
  const observer = new MutationObserver(scheduleSnapshot);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'aria-disabled', 'disabled', 'href', 'class'] });
  // A forced heartbeat lets the main process verify that an assistant answer
  // has stopped changing even if ChatGPT changes its stop-button selectors.
  setInterval(() => emitSnapshot(true), 1600);
});
window.addEventListener('load', () => emitSnapshot(true));
window.addEventListener('popstate', () => setTimeout(() => emitSnapshot(true), 120));
