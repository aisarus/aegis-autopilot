'use strict';

const CHATGPT_HOSTS = Object.freeze(['chatgpt.com', 'openai.com']);
const EXACT_AUTH_HOSTS = new Set([
  'accounts.google.com',
  'login.microsoftonline.com',
  'appleid.apple.com'
]);
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:']);

function parseUrl(value) {
  try {
    return new URL(String(value || ''));
  } catch {
    return null;
  }
}

function hostMatches(hostname, baseHost) {
  return hostname === baseHost || hostname.endsWith(`.${baseHost}`);
}

function isAllowedInternalNavigation(value) {
  if (value === 'about:blank') return true;
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:') return false;
  const hostname = url.hostname.toLowerCase();
  return CHATGPT_HOSTS.some((baseHost) => hostMatches(hostname, baseHost)) || EXACT_AUTH_HOSTS.has(hostname);
}

function isAllowedExternalNavigation(value) {
  const url = parseUrl(value);
  return Boolean(url && EXTERNAL_PROTOCOLS.has(url.protocol));
}

function navigationLogLabel(value) {
  const url = parseUrl(value);
  if (!url) return 'invalid-url';
  const hostname = url.hostname.toLowerCase();
  return hostname ? `${url.protocol}//${hostname}` : url.protocol;
}

module.exports = {
  isAllowedExternalNavigation,
  isAllowedInternalNavigation,
  navigationLogLabel
};
