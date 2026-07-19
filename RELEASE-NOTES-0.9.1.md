# Aegis 0.9.1

Critical fix for ChatGPT preload startup.

- Disabled Electron sandbox only for the isolated ChatGPT WebContentsView so the versioned local adapter registry can load.
- Kept contextIsolation enabled and nodeIntegration disabled.
- Added explicit preload-error diagnostics instead of an endless loading state.
- Added author metadata to the installer package.
