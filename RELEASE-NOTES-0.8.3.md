# Aegis 0.8.3

## Critical send-path repair

- Message delivery is now verified instead of assuming that `button.click()` worked.
- Composer input emits beforeinput/input/change events for React and Lexical editors.
- Send attempts use button click, form requestSubmit, and Enter fallback.
- A queue item is marked sent only after the composer clears and a new user turn or generation appears.
- False-success events are eliminated; failed deliveries remain retryable.

## Interface

- Narrower and calmer control dock.
- Removed heavy shadows and card-like visual noise.
- Autopilot is the dominant primary action.
- Updated visible version to 0.8.3.
