# Aegis 0.8.2

## Windows installer
- NSIS installer configuration with install directory selection.
- Desktop and Start Menu shortcuts.
- Windows Apps & Features uninstall entry.
- Bundled application/installer icon.
- Installer artifact name: `Aegis-Setup-0.8.2.exe`.

## Versioned ChatGPT adapters
- Added adapter registry under `adapters/chatgpt/`.
- Added primary adapter `chatgpt-web-2026.07`.
- Added generic accessibility/semantic fallback adapter.
- Adapters are scored against the live page and selected automatically.
- Adapter version is exposed in runtime diagnostics.
- Registry can accept future DOM versions without rewriting the autopilot core.

## Verification
- Multi-chat scheduler smoke test passes.
- Autopilot resilience smoke test passes.
- JavaScript syntax validation passes.
