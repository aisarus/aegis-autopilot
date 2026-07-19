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
