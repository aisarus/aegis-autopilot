# Navigation security audit

## Root cause

The previous navigation allowlist matched the authentication hostnames only by a suffix regular expression. A hostname such as `evilaccounts.google.com` therefore matched `accounts.google.com$`. Rejected in-app navigations were also passed directly to `shell.openExternal` without an explicit protocol policy.

## Fix

- central strict navigation policy;
- HTTPS-only internal navigation;
- boundary-aware ChatGPT/OpenAI subdomain matching;
- exact authentication hostnames;
- HTTP/HTTPS-only external opening;
- unsafe external schemes are blocked and logged;
- regression coverage for hostile host prefixes and unsafe protocols.

## Validation

- transformation fixture executed twice without changing the second result;
- JavaScript syntax checks passed on the fixture;
- policy unit cases passed locally;
- Windows repository CI remains required before merge.
