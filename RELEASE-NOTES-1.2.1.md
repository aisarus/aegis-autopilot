# Aegis 1.2.1

- Chat routing now uses the durable conversation id after `/c/` instead of the mutable ChatGPT project slug.
- Navigation no longer treats cosmetic project-slug changes as a different conversation.
- Verified-send retries may reuse Aegis's own identical draft left in the composer.
- A different user draft is still protected and never overwritten.
- Added chat identity and draft-safe retry regression coverage.
