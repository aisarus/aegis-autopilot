# Aegis production workflow

## Goal

Every testing commit must be reproducible from one clean checkout and diagnosable without guessing. No ZIP archives, no reinstall loop, no hidden runtime worktree.

## Branches

- `testing` — active development and user testing.
- `main` — last user-confirmed working build.
- New work lands in `testing` first. `main` is updated only after the acceptance checklist passes on the user's Windows machine.

## User workflow

1. Keep one cloned repository folder.
2. Run `AEGIS-UPDATE-AND-RUN.cmd`.
3. The button resets the folder to `origin/testing`, runs `npm ci`, prepares the source, runs the doctor and smoke tests, then starts the exact commit.
4. Never launch the installed desktop shortcut while testing. The runner closes stale installed and development processes before launch.
5. The Aegis status panel shows the exact build id.

## Supported launch and build entrypoints

The checked-in testing source is prepared transactionally before every supported runtime or packaging path:

- `npm start`
- `npm run dev`
- `npm run dev:once`
- `npm run dist:win`
- `npm run pack:win`

The Windows build commands run the full verification gate before invoking `electron-builder`. Do not invoke `electron .` or `electron-builder` directly from a clean checkout because that bypasses npm lifecycle guards.

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
- ordered source preparation
- `npm run doctor`
- JavaScript syntax checks
- the full smoke suite
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

- Patch version increases for every user-testable build.
- The runtime exposes both the semantic version and exact Git commit.
- Diagnostic reports must include both values.
