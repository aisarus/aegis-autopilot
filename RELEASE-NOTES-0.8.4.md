# Aegis 0.8.4

Critical composer-first autopilot fix.

- Chat readiness now depends on the working composer, not parsed message history.
- Missing or virtualized conversation turns no longer block sending.
- The scheduler can proceed when ChatGPT reports a loading indicator but the composer is usable.
- Stuck-chat recovery no longer reloads a page that already has a working composer.
- Added a broad assistant-message fallback and a composer-first regression test.
- Builder now detects the package version dynamically.
