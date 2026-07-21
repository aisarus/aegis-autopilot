# Navigation security audit

## Root cause

The previous navigation allowlist matched the authentication hostnames only by a suffix regular expression. A hostname such as `evilaccounts.google.com` therefore matched `accounts.google.com$`. Rejected in-app navigations were also passed directly to `shell.openExternal` without an explicit protocol policy.

The first hotfix revision logged rejected URLs almost verbatim. A custom OAuth callback could therefore expose authorization codes, state values, credentials, paths or fragments in the local diagnostic log.

## Fix

- central strict navigation policy;
- HTTPS-only internal navigation;
- boundary-aware ChatGPT/OpenAI subdomain matching;
- exact authentication hostnames;
- HTTP/HTTPS-only external opening;
- unsafe external schemes are blocked;
- navigation diagnostics contain only protocol and hostname;
- regression coverage for hostile host prefixes, unsafe protocols and secret-bearing URLs.

## Validation

- transformation fixture executed twice without changing the second result;
- JavaScript syntax checks passed on the fixture;
- policy unit cases passed locally;
- Windows Node 22 and Node 24 repository gates must pass on the final commit before merge.
