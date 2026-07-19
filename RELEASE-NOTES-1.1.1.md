# Aegis 1.1.1 — Stable Cosmic Split

This recovery release fixes the architectural regression introduced by Cosmic Graph 1.1.0.

## Critical fixes

- ChatGPT is no longer hidden by moving its native viewport off-screen at 1×1 pixels.
- The WebContentsView keeps a desktop-sized viewport and is hidden with Electron View.setVisible(false).
- The original ChatGPT interface is restored; injected Safe/Deep skins are disabled by default and old saved skins migrate to off.
- Chat mode is now a true split workspace: compact autopilot controller on the left, ordinary ChatGPT on the right.
- The graph is completely removed from the chat workspace instead of being layered underneath it.
- The top “Закрыть чат · Космос” control returns to the graph.

## Cosmic workspace

- Added a real WebGL star field.
- Added a perspective 3D floor grid.
- Removed invented decorative branch nodes; the graph now shows the project and real pinned chats only.
- Enlarged glowing node bodies and improved labels and camera focus.

## Autopilot and budget safety

- The verified-send, response detection, scheduler, backoff, loop detection, circuit breaker, daily call limit and daily spend limit are retained from 1.0/1.1.
- The hidden ChatGPT page keeps normal DOM dimensions so the autopilot can continue observing it while the graph is open.

## Tests

- Existing scheduler, resilience, send-contract, composer readiness, reload-loop and budget tests pass.
- Added `stable-cosmic-split-smoke.js` to prevent the 1×1 viewport regression.
