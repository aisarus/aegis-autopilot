# Aegis Autopilot

> **Historical predecessor.** This repository contains an earlier Aegis architecture. The current Aegis has evolved into a substantially different autonomous development operator and is developed in a private repository.
>
> For the sanitized employer-facing snapshot of the current system, live-run evidence, incident stories and role framing, read **[`CURRENT-AEGIS-CASE-STUDY.md`](CURRENT-AEGIS-CASE-STUDY.md)**.

## This repository

This version is an Electron client for running up to three project ChatGPT conversations under a Gemini Supervisor.

The main window combines autopilot controls with a normal ChatGPT surface. The project includes retries, diagnostics, loop protection and hard daily Gemini spending limits.

## First run

Run `first-run.cmd`. It installs dependencies, runs smoke tests and starts Aegis from source.

## Development

Run `dev.cmd`. Changes in `main.js`, preload scripts, `renderer/` and `adapters/` restart Electron automatically.

## Update and run

Run `update-and-run.cmd` to perform a safe `git pull --ff-only`, install changed dependencies, run tests and open development mode.

## Restore a broken local copy

Run `reset-and-run.cmd`. It resets source changes to `origin/main`. ChatGPT profile data, pinned chats, settings, logs and budget counters are stored in Electron `userData` outside the repository and are not removed.

## Stable build

The installer is built only for verified releases through `build-installer.cmd`.

## Budget protection

Settings define maximum Gemini spend and call count per day. Ordinary DOM checks do not consume the Gemini API; Gemini is called after a new completed ChatGPT response appears.

## Security

Do not commit Gemini API keys, cookies, Electron profiles, logs, `node_modules` or `dist`. These paths are excluded through `.gitignore`.