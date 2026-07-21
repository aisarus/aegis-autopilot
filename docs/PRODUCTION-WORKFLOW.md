# Aegis production workflow

## Goal

Every testing commit must be reproducible from one clean checkout and diagnosable without guessing. No ZIP archives, no reinstall loop, no hidden runtime worktree.

## Branches

- `testing` — active development and user testing.
- `main` — last user-confirmed working build.
- New work lands in `testing` first. `main` is updated only after the acceptance checklist passes on the user's Windows machine.

## User workflow

1. Keep one dedicated cloned repository folder. Tracked edits will be discarded by the one-click runner, so commit or copy them elsewhere first.
2. Run `AEGIS-UPDATE-AND-RUN.cmd`.
3. The button resets tracked files to `origin/testing`, removes stale untracked files only from packaged/runtime paths, verifies those paths, runs `npm ci`, prepares the source, runs the doctor and smoke tests, then starts the displayed commit.
4. Unrelated untracked files outside the runtime pathspecs and ignored local files such as `.env` are preserved. They are not part of the tested or packaged runtime.
5. Never launch the installed desktop shortcut while testing. The runner closes stale installed and development processes before launch.
6. The Aegis status panel shows the exact build id.

## Supported launch, check and build entrypoints

The checked-in testing source is prepared transactionally before every supported public runtime, check or packaging path:

- `AEGIS-UPDATE-AND-RUN.cmd`
- `dev.cmd` for watched development restarts
- `npm start`
- `npm run dev`
- `npm run dev:once`
- `npm run doctor`
- `npm test`
- `npm run verify`
- `npm run dist:win`
- `npm run pack:win`

The development command prepares source before registering file watchers. Every later watcher restart goes through `npm run dev:once`; it must never launch `electron` or `npx electron` directly. Transactional preparation writes a checkout file only when the prepared bytes differ, so an idempotent pass reports zero updated files and must not trigger another watched restart.

`doctor:prepared` and `test:prepared` are internal building blocks used only after `source:prepare`; do not invoke them directly from a clean checkout. Windows build commands run the full verification gate before invoking `electron-builder`. Do not invoke `electron .`, `npx electron .` or `electron-builder` directly from a clean checkout because that bypasses preparation guards.

## Debug workflow

Do not test the full Gemini autopilot first.

1. Stop all autopilots.
2. Open one ordinary ChatGPT conversation.
3. Clear the ChatGPT composer.
4. Press **Тест отправки**.
5. Aegis sends a short unique `AEGIS_TEST_*` message without Gemini or the project queue.
6. The detailed before/result/after report is copied to the clipboard automatically.
7. If the test fails, run `AEGIS-COLLECT-DEBUG.cmd` and send both the copied SEND TEST report and the generated desktop file.

This separates four layers:

1. ChatGPT page discovery.
2. Composer focus and text insertion.
3. Submit action.
4. Post-submit recognition.

Only after the isolated send test passes should the queue and Gemini supervisor be tested.

## Automated gates

Every push to `testing` or `main` and every pull request runs Windows CI with Node.js 22:

- `npm ci`
- one ordered transactional source preparation
- prepared-source doctor checks
- JavaScript syntax checks
- the full prepared smoke suite
- an idempotence check proving a second preparation performs zero checkout writes
- a scoped-clean fixture proving stale untracked runtime files are removed while unrelated and ignored local files remain
- package and lockfile version equality
- a direct-source version newer than the legacy runtime floor while that legacy marker exists
- a debug artifact on failure

A red CI build must not be offered for user testing.

## Acceptance checklist for promotion to main

- Windows CI is green.
- `AEGIS-UPDATE-AND-RUN.cmd` starts the displayed commit.
- **Тест отправки** succeeds three times in one chat.
- **Тест отправки** succeeds after switching to a second chat.
- One queued manual message is sent correctly.
- One Gemini autopilot turn completes without duplicate messages.
- Restart preserves login, API key and project state.
- The user explicitly confirms the build works.

## Definition of done for a bug fix

A fix is not done because code was changed. It is done only when:

- the failing stage is captured in a deterministic report;
- a regression test or doctor check covers the root cause where practical;
- Windows CI passes;
- the exact testing commit is verified on the user's machine;
- the result is promoted to `main` only after confirmation.

## Versioning

- Patch version increases before a testing commit is offered as a new user acceptance candidate.
- The direct-source line starts at `1.2.20`, which is newer than the retained legacy runtime marker `1.2.19`.
- `package.json` and the root package entry in `package-lock.json` must always match.
- The runtime exposes both the semantic version and exact Git commit.
- Diagnostic reports must include both values.
