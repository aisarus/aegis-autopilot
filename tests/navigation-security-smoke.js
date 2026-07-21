const fs = require('fs');
const {
  isAllowedExternalNavigation,
  isAllowedInternalNavigation
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
  'https://evilaccounts.google.com/',
  'https://notlogin.microsoftonline.com/',
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

const main = fs.readFileSync('main.js', 'utf8');
assert(main.includes("require('./lib/navigation-policy')"), 'prepared main does not load the navigation policy');
assert(main.includes('isAllowedInternalNavigation(url)'), 'prepared main does not enforce internal navigation policy');
assert(main.includes('isAllowedExternalNavigation(url)'), 'prepared main does not enforce external protocol policy');
assert(!main.includes('accounts\\.google\\.com$'), 'unsafe suffix-only auth hostname regex remains');
assert(!main.includes("shell.openExternal(url).catch(() => {})"), 'unsafe unvalidated external open remains');

console.log('navigation security smoke test: OK');
