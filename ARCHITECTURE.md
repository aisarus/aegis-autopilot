# Aegis Client v0.7.1 — architecture contract

## Product sentence

Aegis is a normal desktop ChatGPT client with a narrow local control dock: per-chat queues, document-to-prompt packs, voice commands and an optional Gemini supervisor that can review progress and propose or execute the next safe turn.

## The foundation

The application embeds the real `https://chatgpt.com` page in an Electron `WebContentsView` using a persistent browser session. The user sees the real ChatGPT sidebar, conversations, composer and account state. A local preload adapter reads only the rendered page DOM and exposes a very small set of operations to the trusted Aegis main process.

Screenshots and local vision are not required to discover chats or decide whether generation ended. They may be added later as a fallback when the ChatGPT DOM adapter reports an unknown state.

## Trust boundaries

1. The remote ChatGPT page has no Node.js access.
2. Its preload adapter can report normalized page state and respond to a fixed command allowlist only.
3. The local Aegis control UI cannot inject arbitrary JavaScript into ChatGPT.
4. Gemini never receives credentials, cookies, arbitrary files, screenshots or conversation history. One completed ChatGPT response is sent once, together with a compact project goal, current-chat metadata and queue count, only when supervision is enabled.
5. Gemini returns structured decisions from a fixed allowlist. It never gets mouse, keyboard, shell or unrestricted browser tools.

## Stable chat identity

Chats are stored by their ChatGPT URL path, not by OCR text and not only by title. A title can change without losing its queue. The embedded ChatGPT sidebar remains the source of truth; Aegis can pin the currently open conversation or any discovered sidebar link.

## Dispatch state machine

`queued → navigating → waiting_ready → sending → sent → waiting_response`

Dispatch is allowed only when:

- the queue item belongs to the selected project chat;
- the embedded page is on that chat URL;
- ChatGPT is not generating;
- the composer exists and is empty;
- the send operation is acknowledged by the DOM adapter.

If a limit, login page, draft, missing composer or changed DOM is detected, the item stays queued and Aegis pauses instead of guessing.

## Supervisor modes

- **Off** — Gemini is never called.
- **Review** — Gemini proposes one next action; the user approves or rejects it.
- **Auto** — Gemini may enqueue or send allowlisted prompts within explicit limits: cooldown, maximum automatic turns per chat and one action per completed ChatGPT response.

The supervisor actions are: `wait`, `enqueue`, `continue`, `review`, `send_next`, `mark_done`, `ask_user`, and `pause`. Chat switching belongs only to the deterministic round-robin scheduler. Gemini cannot create accounts, bypass limits, pay, delete chats or operate other applications.

For Gemini 2.5 Flash, Interactions use low thinking, no thinking summary and a 192-token output ceiling. The response schema is the compact `{action,message,confidence}` object; Aegis expands it into its richer local decision object. Interaction usage is retained as 31 daily aggregates, while response text remains ephemeral.

## Multi-chat autopilot scheduler

Autopilot enablement, turn counts, pending decisions, pause state and queue state belong to a stable chat id rather than to the currently visible page. A single scheduler serializes all browser work because the client embeds one authenticated ChatGPT view.

Ready chats are served in round-robin order. The scheduler never navigates away while ChatGPT is generating, while a response acknowledgement gate is open or while the composer contains a protected draft. A response from one chat is evaluated once by hash. A failure pauses only that chat; other enabled chats remain eligible.

## Recovery

Durable project state is local and persisted after each mutation. Ephemeral DOM telemetry and visible conversation text stay in memory and are not written into the project state file. When the client restarts, queued items remain and any interrupted send is returned to `queued`. The persistent Electron browser partition preserves the ChatGPT login session independently of Aegis project state.
