# Aegis 0.8.0 — Windows foundation

## Added
- Standard NSIS installer configuration with desktop and Start menu shortcuts.
- Single-instance application lock.
- Atomic state-file writes to reduce corruption risk after a crash or power loss.
- Persistent file logging in Electron's Windows logs directory.
- Automatic recovery when the embedded ChatGPT renderer crashes or remains unresponsive.
- Connection refresh after Windows resumes from sleep.
- Process-level logging for unhandled exceptions and rejected promises.
- Unlimited local autopilot mode: `0` automatic turns means no local cap.

## Interface
- Reduced control dock width from 480px to 420px.
- Quieter visual hierarchy and less technical copy on the main screen.
- Simplified autopilot terminology and settings.

## Important
Aegis can remove its own local turn cap, but it does not and cannot bypass ChatGPT or Gemini service limits, account restrictions, rate limits, or login requirements.

## Build on Windows
1. Install Node.js LTS.
2. Run `npm install`.
3. Run `npm run dist:win`.
4. The installer will be created in `dist/Aegis-Setup-0.8.0.exe`.
