# Aegis 0.9.2 — recovery-safe autopilot

- Removed automatic hard reloads from normal navigation and DOM recovery.
- An already open ChatGPT conversation is never reloaded merely because the composer was not detected in time.
- Failed verified sends stay queued and retry with bounded backoff instead of disabling the autopilot.
- Diagnostics now include the last 50 KB of the persistent application log.
- Added an **Open log** action that reveals the actual `aegis.log` file in Explorer.
- Added a draggable divider. The control panel can be resized from 340 to 620 px.
- Reworked the window as an inset split workspace so ChatGPT and controls read as parts of one application.
