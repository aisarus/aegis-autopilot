# Aegis 1.1.2 — Collision-safe Cosmic Labels

This small follow-up keeps the 1.1.1 split workspace unchanged and fixes the next visible defect in the 3D graph.

## Fixed

- Chat and project labels are now resolved in screen space after 3D projection.
- Labels try a deterministic set of nearby placements instead of stacking on top of each other.
- The selected node, project node and active autopilot chats receive placement priority.
- Labels that cannot fit safely inside the viewport are temporarily hidden rather than becoming unreadable.
- The scheduler, verified send, ChatGPT WebContentsView and Gemini budget guard are unchanged.

## Tests

- Added `cosmic-label-collision-smoke.js`.
- The complete existing test suite still passes.
