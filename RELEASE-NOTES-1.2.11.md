# Aegis 1.2.11 — resilient ChatGPT message parsing

## Fixed

- Conversation turns are discovered from generic `conversation-turn`, message ID and turn ID containers, not only `<article>` nodes.
- Message roles are recognized through `data-message-author-role`, `data-author`, `data-role`, semantic test IDs, headings and content structure.
- User send verification reuses the same resilient message-host and content extraction logic.
- Assistant fallback extraction supports current and legacy ChatGPT DOM shapes.

## Diagnostics

Copied diagnostics now include:

- `messageCandidateCount`
- `assistantMessageCount`
- `userMessageCount`
- existing final `messageCount`

This distinguishes “no message containers found” from “containers found but roles/text were not recognized”.

## Verification

- `node --check main.js`
- `node --check chatgpt-preload.js`
- adapter syntax checks
- existing available smoke tests
- `message-parser-resilience-smoke.js`
- clean `git apply --check` and re-application against the reconstructed 1.2.10 parser baseline

Live validation against the authenticated Windows ChatGPT DOM is still required.
