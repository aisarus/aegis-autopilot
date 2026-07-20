# Aegis v2 — GitHub-native three-project orchestrator

## Product decision

Aegis v2 does not automate the `chatgpt.com` DOM. The browser client may remain available during migration, but it is not a control plane.

The durable control plane is GitHub plus local verified worktrees:

```text
Aegis project registry
  -> GitHub connector reads repository state and documentation
  -> primary coding agent receives one bounded task and repository tools
  -> local worktree records edits and test evidence
  -> GitHub connector pushes a branch and opens a draft PR
  -> independent reviewer checks diff, tests and project invariants
  -> user or policy merges; Aegis advances the project ledger
```

## Registered projects

1. `aisarus/syllabus-to-os` — Lamdan.
2. `aisarus/edge-mobile-betting-app` — Edge Research Cockpit.
3. `aisarus/aegis-autopilot` — Aegis itself.

The machine-readable source of truth is `orchestrator/projects.json`.

## Two-way GitHub connector

`orchestrator/github-connector.js` is intentionally independent from Electron UI code. It supports:

- repository metadata;
- file reads at a specific ref;
- issue reads and issue creation;
- branch creation;
- UTF-8 file creation/update through the Contents API;
- draft pull-request creation;
- combined commit status reads.

Authentication is injected at runtime. Tokens must never be committed, logged, sent to an LLM, or included in diagnostic exports. The first desktop integration may use a fine-grained personal access token stored with Electron `safeStorage`; GitHub Device Flow is the preferred later UX.

## Agent protocol

Every project run follows the same bounded protocol:

1. **Baseline** — read the configured status documents and current default-branch SHA.
2. **Select** — choose exactly one smallest executable task already present in the project ledger. Do not invent a parallel roadmap while a canonical active task exists.
3. **Branch** — create `agent/<project-id>/<task-id>-<short-slug>` from the observed SHA.
4. **Implement** — edit only files required by that task. Preserve repository-specific guardrails.
5. **Verify** — run the project's documented focused checks and relevant regression suite. Record exact commands and outcomes.
6. **Publish** — push the branch and open a draft PR with scope, evidence, risks and remaining work.
7. **Review** — an independent reviewer evaluates the actual diff and test evidence. It may approve, request changes, ask one blocking question or mark the task blocked.
8. **Advance** — update the canonical task/status documents only after the implementation evidence exists.

## Repository-specific invariants

### Lamdan

- `STATUS.md`, `TASKS.md`, `PLANS.md` and `AGENTS.md` are authoritative.
- Preserve Lovable-compatible history: no force-push or rewrite of published commits.
- Preserve source links, localStorage compatibility, RU/EN localization and draft-before-save AI output.
- Current task at registration: `S3-003 real cancellation propagation and late-result rejection`.

### Edge

- `docs/PROJECT_STATE.md` is the current execution ledger.
- The product remains a calm research cockpit, not a real betting product.
- Permanent safety invariants: `allow_live_recommendations = false`, `allowed_stake_amount = 0`.
- Current next slice at registration: security headers and CSP for frontend and API responses.

### Aegis

- New v2 work must not depend on ChatGPT DOM selectors, composer state or browser navigation.
- The GitHub connector remains isolated and unit-testable with an injected `fetch` implementation.
- Write operations default to branches and draft PRs; direct writes to `main` are forbidden by orchestration policy.

## Execution-state model

Each project has one state:

```text
idle
  -> reading-baseline
  -> planning-task
  -> editing
  -> verifying
  -> publishing-pr
  -> awaiting-review
  -> approved | changes-requested | blocked | awaiting-user
```

The state is bound to `{repository, baseSha, branch, taskId}`. Retries must be idempotent. Aegis must never publish the same file mutation or PR twice after an uncertain network response; it reconciles by branch name, commit SHA and open PR head.

## Next implementation slices

1. **V2-001 — connector and registry foundation**: complete in this branch when `npm run test:v2` passes.
2. **V2-002 — read-only baseline service**: read each project's configured status documents, default SHA, open PRs and checks; emit one normalized project snapshot.
3. **V2-003 — secure credential storage and settings UI**: GitHub token plus model keys, redacted diagnostics.
4. **V2-004 — local worktree tool service**: clone/fetch, branch, safe file tools, command allowlist and test capture.
5. **V2-005 — primary agent loop**: structured tool calls against one worktree and one bounded task.
6. **V2-006 — independent review loop**: diff/test review with explicit approve/change/block schema.
7. **V2-007 — branch/PR publication and reconciliation**.
8. **V2-008 — three-project dashboard and scheduler**.

## Definition of done for V2-001

- the three repositories are registered and validated;
- read and write GitHub operations are implemented behind one connector;
- the connector never exposes its token in an error;
- file paths and repository identifiers are validated;
- a deterministic test covers repository read, file read, issue creation, branch creation, file write, draft PR creation and status read;
- no production UI claims are made yet.
