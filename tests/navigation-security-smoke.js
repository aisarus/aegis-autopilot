const fs = require('fs');
const {
  isAllowedExternalNavigation,
  isAllowedInternalNavigation,
  navigationLogLabel
} = require('../lib/navigation-policy');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const url of [
  'https://chatgpt.com/',
  'https://auth.openai.com/',
  'https://accounts.google.com/',
  'https://login.microsoftonline.com/',
  'https://appleid.apple.com/',
  'about:blank'
]) {
  assert(isAllowedInternalNavigation(url), `expected internal URL to be allowed: ${url}`);
}

for (const url of [
  'http://chatgpt.com/',
  'https://chatgpt.com.evil.example/',
  'https://openai.com.evil.example/',
  'https://evilaccounts.google.com/',
  'https://sub.accounts.google.com/',
  'https://accounts.google.com.evil.example/',
  'https://notlogin.microsoftonline.com/',
  'https://login.microsoftonline.com.evil.example/',
  'https://evilappleid.apple.com/',
  'javascript:alert(1)',
  'data:text/html,unsafe',
  'file:///C:/Windows/System32/calc.exe',
  'not a url'
]) {
  assert(!isAllowedInternalNavigation(url), `unsafe internal URL was allowed: ${url}`);
}

assert(isAllowedExternalNavigation('https://example.com/'), 'HTTPS external URL was rejected');
assert(isAllowedExternalNavigation('http://example.com/'), 'HTTP external URL was rejected');
assert(!isAllowedExternalNavigation('javascript:alert(1)'), 'javascript external URL was allowed');
assert(!isAllowedExternalNavigation('file:///tmp/unsafe'), 'file external URL was allowed');
assert(!isAllowedExternalNavigation('data:text/html,unsafe'), 'data external URL was allowed');

const sensitiveUrl = 'custom-auth://callback/path?code=top-secret&state=private#fragment';
const sensitiveLabel = navigationLogLabel(sensitiveUrl);
assert(sensitiveLabel === 'custom-auth://callback', `unexpected redacted label: ${sensitiveLabel}`);
assert(!sensitiveLabel.includes('top-secret'), 'navigation log label leaked query data');
assert(!sensitiveLabel.includes('private'), 'navigation log label leaked state data');
assert(navigationLogLabel('not a url') === 'invalid-url', 'malformed URL label is not stable');
assert(navigationLogLabel('https://user:password@example.com/path?token=secret#state') === 'https://example.com', 'HTTP navigation label leaked credentials, path or query');

const main = fs.readFileSync('main.js', 'utf8');
assert(main.includes("require('./lib/navigation-policy')"), 'prepared main does not load the navigation policy');
assert(main.includes('isAllowedInternalNavigation(url)'), 'prepared main does not enforce internal navigation policy');
assert(main.includes('isAllowedExternalNavigation(url)'), 'prepared main does not enforce external protocol policy');
assert(main.includes('navigationLogLabel(url)'), 'prepared main does not redact navigation diagnostics');
assert(!main.includes('accounts\\.google\\.com$'), 'unsafe suffix-only auth hostname regex remains');
assert(!main.includes("shell.openExternal(url).catch(() => {})"), 'unsafe unvalidated external open remains');
assert(!main.includes('compact(url, 500)'), 'raw navigation URL is still written to diagnostics');

console.log('navigation security smoke test: OK');
