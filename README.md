<<<<<<< HEAD
# Aegis 1.2.0

Минимальный Windows-клиент для ведения до трёх проектных чатов ChatGPT через Gemini Supervisor.

Главное окно разделено на две части: управление автопилотом слева и оригинальный ChatGPT справа. Декоративного 3D-интерфейса нет.

## Сборка

Дважды нажмите `build-installer.cmd`. Готовый установщик появится в `dist/Aegis-Setup-1.2.0.exe`.

## Защита бюджета

В настройках задаются максимальная сумма и число Gemini-вызовов в сутки. Gemini вызывается только после появления нового завершённого ответа ChatGPT; обычные проверки DOM не расходуют API.

## Development workflow (no installer)

Use the source checkout directly. ChatGPT login, pinned chats, settings, logs, and budget counters are stored in Electron `userData`, outside the repository, so pulling code does not erase them.

### First launch

Double-click `first-run.cmd`. It installs dependencies, runs the smoke tests, and starts Electron from source.

### Normal development

Double-click `dev.cmd`. It watches `main.js`, preload scripts, `renderer/`, and `adapters/`; source changes restart Electron automatically.

### Get the latest patch

Double-click `update-and-run.cmd`. It performs a fast-forward-only `git pull`, installs changed dependencies, runs tests, and launches dev mode. It never force-resets local changes.

### Recover a broken checkout

Double-click `reset-and-run.cmd`. This intentionally discards uncommitted source changes and resets to `origin/main`; application profile data remains untouched.

Build an installer only for stable releases with `build-installer.cmd`.
=======
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
>>>>>>> fbaa80af1fdbd2789f4dccdddac2b4d610a2f89a
