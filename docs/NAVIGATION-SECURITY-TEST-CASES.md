# Navigation security regression cases

Allowed internally:

- `https://chatgpt.com/`
- `https://auth.openai.com/`
- `https://accounts.google.com/`
- `https://login.microsoftonline.com/`
- `https://appleid.apple.com/`
- `about:blank`

Rejected internally:

- HTTP ChatGPT URLs
- authentication-host prefix confusion such as `evilaccounts.google.com`
- `javascript:`
- `data:`
- `file:`
- malformed URLs

External opening is limited to HTTP and HTTPS URLs.
