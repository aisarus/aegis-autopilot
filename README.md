# Aegis Autopilot

Minimal Electron desktop agent for supervising up to three ChatGPT project conversations with Gemini, retries, diagnostics, and hard daily budget limits.

## One-time source bootstrap

The GitHub connector initialized this repository, but the first full source push must be performed from the local dev package because the connector cannot expand a local ZIP into a repository tree.

1. Download and extract `Aegis-Client-v1.2.2-dev-repository.zip`.
2. Open a terminal in the extracted folder.
3. Run:

```bat
git init
git branch -M main
git remote add origin https://github.com/aisarus/aegis-autopilot.git
git add .
git commit -m "feat: bootstrap Aegis 1.2.2 dev repository"
git pull origin main --allow-unrelated-histories --no-rebase
git push -u origin main
```

After that, normal development requires no installers:

- `first-run.cmd` — install dependencies, run tests, start Aegis.
- `dev.cmd` — run directly from source with automatic Electron restart.
- `update-and-run.cmd` — pull the latest patch, install changed dependencies, run tests, and start.
- `reset-and-run.cmd` — discard broken local source changes and restore `origin/main` while keeping Electron user data.

ChatGPT login, pinned chats, settings, logs, and budget counters are stored in Electron `userData` outside the repository.

## Security

Do not commit Gemini API keys, logs, Electron profiles, cookies, `node_modules`, or `dist`. The included `.gitignore` excludes these paths.
