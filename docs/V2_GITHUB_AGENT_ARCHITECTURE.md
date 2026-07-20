# Aegis v2 — GitHub-first multi-project agent

## Decision

The ChatGPT DOM autopilot is legacy and will not be extended. Aegis v2 works directly with the real project repositories through API agents and a bidirectional GitHub connector.

The three initial projects are:

1. `aisarus/syllabus-to-os` — Lamdan.
2. `aisarus/edge-mobile-betting-app` — Edge mobile betting app.
3. `aisarus/aegis-autopilot` — Aegis itself.

Existing ChatGPT conversations are not required for continuity. Repository code, repository documentation, issues, pull requests, checks, and Aegis project memory are the source of truth.

## Product contract

Aegis is a desktop orchestrator for several independent software-project agents. Each project has its own persistent conversation, repository binding, instructions, memory, budget, queue, and execution state.

The user can leave three projects running without keeping three browser conversations open.

## Components

### 1. Project registry

Each project record contains:

- stable local project id;
- GitHub repository full name;
- default branch;
- agent instructions;
- documentation entry points;
- OpenAI conversation id;
- optional Gemini reviewer state;
- current task and run state;
- permissions and approval policy;
- model and budget limits.

### 2. GitHub connector

The connector exposes explicit allowlisted tools. Read operations:

- repository metadata;
- file tree and file contents;
- commits and diffs;
- issues and pull requests;
- comments and review feedback;
- workflow/check status.

Write operations:

- create a task branch;
- create or update text files;
- commit changes;
- open a pull request;
- add progress comments;
- update project status documents.

The first production mode never writes directly to `main`. Every implementation run must use a branch and PR.

### 3. OpenAI project agent

Each project receives one persistent OpenAI Responses API conversation. The agent is responsible for repository analysis, planning, implementation decisions, code review, and selecting GitHub tool calls.

The agent must operate in small verified increments:

1. Read the current repository state.
2. Read repository instructions and status documents.
3. Select the smallest unfinished task.
4. State acceptance criteria.
5. Create a task branch.
6. Implement only that task.
7. Run relevant checks.
8. Inspect the resulting diff.
9. Open or update a PR.
10. Persist a concise run summary and next step.

### 4. Optional Gemini reviewer

Gemini is not the transport and does not control ChatGPT. It may independently review a proposed task, diff, test output, or completed PR. It returns a structured decision:

- `approve`;
- `request_changes`;
- `ask_user`;
- `pause`.

A reviewer failure never destroys the OpenAI agent state and never causes duplicate GitHub writes.

### 5. Local persistence

Use SQLite rather than one large JSON file. Required tables:

- `projects`;
- `agent_conversations`;
- `tasks`;
- `runs`;
- `tool_calls`;
- `approvals`;
- `usage_ledger`;
- `events`.

Every external write receives a stable idempotency key. A restarted process must resume or reconcile the prior operation instead of repeating it.

## State machines

### Project

`idle -> planning -> awaiting_approval -> implementing -> testing -> reviewing -> pr_ready -> idle`

Exceptional states:

`waiting_user`, `rate_limited`, `auth_required`, `failed`, `paused`, `done`.

### Tool call

`prepared -> executing -> confirmed`

If confirmation is lost:

`prepared -> executing -> reconciling -> confirmed | failed`

The connector must inspect GitHub before retrying a write.

## Approval policy

Initial safe mode:

- reads: automatic;
- task selection: automatic;
- branch creation: automatic;
- file changes: automatic on task branch;
- tests: automatic;
- PR creation/update: automatic;
- merge, deletion, secrets, billing, repository visibility, releases, and direct `main` writes: explicit user approval.

## Repository instruction discovery

For every run the agent searches, in priority order:

1. `AGENTS.md` nearest to the changed files;
2. root `AGENTS.md`;
3. `STATUS.md`;
4. `TASKS.md` or `ROADMAP.md`;
5. `PRODUCT.md`;
6. `ARCHITECTURE.md`;
7. `README.md`;
8. relevant issue/PR context.

The agent must not claim to have read missing or inaccessible material.

## Initial project instructions

### Lamdan

Continue from current `main`. Treat repository documentation and current issues/PRs as authoritative. Preserve the core learning cycle: understand, recall, verify. Prefer durable state and real functionality over decorative redesign. Use small PRs with acceptance criteria and browser-facing checks where applicable.

### Edge mobile betting app

Begin with a repository audit. Identify the actual product, stack, current runnable state, tests, security boundaries, regulated-domain risks, and smallest path to a trustworthy development baseline. Do not add real-money transaction functionality without an explicit product and legal decision.

### Aegis

Replace the DOM/ChatGPT transport incrementally. Preserve only reusable Electron UI, secure local credential storage, logging, budgeting, and project controls. Build the GitHub-first read-only vertical slice before removing legacy runtime files.

## First implementation milestone

`V2-M1 — Read-only project cockpit`

Acceptance criteria:

- the app loads the three repository bindings;
- GitHub authentication is validated without exposing the token;
- each project card displays repository visibility, default branch, latest commit, instruction files found, and current open PR/check summary;
- each project has an independent persisted OpenAI conversation id placeholder;
- no ChatGPT page is embedded or navigated in the v2 route;
- no repository writes are available yet;
- failures are isolated per project;
- automated tests cover registry validation, secret redaction, connector error handling, and persistence recovery.

## Next milestone

After M1 is verified, implement `V2-M2 — one branch, one file change, one test, one PR` for Aegis itself. Only then enable the same write loop for Lamdan and Edge.
