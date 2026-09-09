# Aegis — Current Project Case Study

**Snapshot: 2026-09-09**

> This repository is the **historical predecessor** of the current Aegis project. The production-development repository is currently private. The case study below describes the current system and is published here as a sanitized hiring artifact; do not assume every capability described below exists in this older codebase.

## What Aegis is

**Aegis is a local autonomous development operator that turns an ambiguous task into a verifiable contract, builds a strategy, compiles work into jobs, routes those jobs between reasoning/chat models and coding agents, collects evidence, replans after failure, and returns the result to the owner for final acceptance.**

The economic idea is simple: scarce coding-agent quota should not be burned on work that cheaper text/reasoning workers can do. Research and reasoning are routed to text-class workers; filesystem, shell, tests and git go to coding agents.

Current worker classes include consumer/chat routes and coding routes such as Claude Code and Codex.

## Why it exists

Long AI coding sessions fail in predictable ways. A model can confidently announce success based on its own output, repeat a bad plan, waste expensive agent quota on research, confuse one provider's limit with a system-wide failure, or lose state between steps.

Aegis is built around the opposite rule:

> **Models may judge where judgment is useful, but verifiable facts and dangerous boundaries stay deterministic whenever possible.**

That means exit codes, evidence collection, locks, budget accounting, state transitions and similar facts are not delegated to a model simply because a model is available.

## Architecture in one pass

1. **Task → acceptance contract.** The goal becomes falsifiable acceptance criteria backed by commands or evidence.
2. **Task → strategy.** A separate layer decides how the work should be approached without choosing a specific provider.
3. **Strategy → jobs.** A deterministic compiler converts tactics into executable jobs and required capabilities.
4. **Job → worker.** Candidates are filtered by capability and then considered by cost class and accumulated experience.
5. **Evidence → acceptance.** Mechanical checks are judged mechanically; evidence-only criteria are reviewed separately from the worker's self-report.
6. **Failure → replan.** Repeated rejection or a failed job can trigger a new strategy rather than endless retries of the same idea.
7. **Owner-in-the-loop.** Pause, stop, direction changes, final review and sensitive approvals stay available to the owner, including through Telegram.

The current system also works against real repositories in isolated git worktrees and maintains operational memory, quota/cost reporting and recovery state.

## Evidence from live runs

This section contains evidence recorded in the private development repository and its run documentation. It is intentionally more conservative than a marketing page.

### End-to-end owner run

A documented September 3 run went through the complete path from launch and intake to contract, execution, evidence, acceptance and owner completion review. The contract contained **12 criteria; all 12 received `pass`**, after which the owner accepted the result.

Caveat: Aegis source code was being edited in parallel during that experiment. Those edits did not enter the already-running Node process, but the run should not be presented as a laboratory-pure benchmark.

### Mixed text → code run

A later documented five-step run routed research to a text worker and filesystem implementation to a coding worker. The cross-worker handoff preserved 1,074 characters of context and **7/7 acceptance criteria passed**. The run produced `notes.md` and an `index.html` of roughly 20 KB without manual intervention during execution.

Caveat: that run was launched by the headless live-run script rather than the main-window button.

### Concurrent-run regression

A documented three-run concurrency regression improved from **1/3 completing successfully to 3/3** after shared-resource locking and isolation work. Resources that cannot safely be concurrent, such as ownership of one browser profile, remain deliberately serialized.

### Operational measurement

A September 2–6 reporting slice covered **122 run journals** and included repeatable cost/time reporting. Median recorded step time in that slice was **5.3 seconds**. The point is not the absolute number; it is that timing and cost are derived from ledger data rather than estimated by feel.

## Three failures that shaped the project

### 1. The observer changed what it was observing

A run ledger originally lived inside the workspace whose hash was used for loop detection. Every ledger write therefore changed the workspace hash, so repeated work never looked repeated.

The documented result was six duplicate rounds before manual stop, costing **$4.01**.

The fix was architectural: move the ledger outside the observed region and add a regression test for the invariant.

**Lesson:** instrumentation can invalidate the system it is measuring.

### 2. A “rate limit” was actually a session-lifecycle bug

On September 8, first calls to Claude Code failed with `No conversation found with session ID`. A fallback then tried Codex, which really was rate-limited, producing a plausible but wrong outward diagnosis that “the coding agent is rate-limited.”

The root cause was ordering: the session was marked as started before invocation arguments were computed, so the **first call used `--resume`** instead of creating the session.

After changing the order, two sequential live calls succeeded — first creating the conversation, second resuming it — and the failure received regression coverage.

**Lesson:** do not accept the first convenient explanation produced by a fallback chain.

### 3. A dead run could make the wallet look empty

Budget was reserved for a running child process. Because a detached run could survive the Electron window, a later app restart could leave a dead reservation with nobody left to release it. One stale reservation was enough to block the remaining daily budget.

The wallet gained recovery logic that distinguishes proven-live, proven-dead and unknown run holders; only proven-dead reservations are reclaimed.

A nearby UX failure was also fixed: the task input previously cleared before launch was confirmed, so a rejected launch could destroy the user's hand-written task text.

**Lesson:** recovery semantics and user data are part of system reliability, not polish.

## My role

Aegis is deliberately an **AI-native development project**. Coding agents produced a substantial share of implementation code. I do not present the project as thousands of lines typed manually.

My role is best described as **Product Owner / System Designer / AI-native Builder**:

- define the product problem and acceptance boundaries;
- turn vague goals into executable work;
- decide which decisions belong to models and which must remain deterministic;
- direct coding/research agents and provide the missing context;
- identify when generated code fixes a symptom rather than the cause;
- diagnose live-run failures across routing, sessions, quotas and recovery;
- require evidence and regression coverage after failures;
- make product, architecture, cost, safety and human-in-the-loop decisions;
- abandon weak architectures instead of polishing them indefinitely.

The skill demonstrated here is not “prompting Claude to code.” It is **using AI workers as an implementation force while retaining ownership of system behavior and verification.**

## Skills demonstrated

- agent orchestration and task decomposition
- AI-assisted product development
- capability- and cost-aware routing
- acceptance/evaluation design
- human-in-the-loop workflows
- debugging AI-generated implementations
- incident analysis and recovery semantics
- quota/cost-aware architecture
- process orchestration
- git-worktree isolation
- deterministic boundaries around probabilistic workers
- telemetry and evidence-driven iteration

This case is **not** evidence of a traditional senior JavaScript/Electron background, and I do not present it that way.

## Current limitations

Aegis remains an active experimental system rather than a production SaaS. In particular, this case study does not claim that:

- every multi-hour run finishes without human intervention;
- every consumer-web surface is equally stable;
- every planned replan trigger is wired into the runtime;
- subscription quota can always be calculated exactly when vendors do not publish limits;
- the private codebase is ready for arbitrary third-party installation;
- I manually authored all implementation code.

## CV version

**Aegis — Autonomous AI Development Operator · Product Owner / AI-native Builder**

Designed and iteratively developed an autonomous task-execution system that converts ambiguous goals into verifiable acceptance contracts, decomposes work into capability-based jobs, routes research/reasoning to text models and implementation to coding agents, and validates outcomes through deterministic evidence and independent review. Built product direction around cost/quota accounting, human approval gates, git-worktree isolation, replanning and failure recovery. Led the project through multiple failed architectures and live incidents while using coding agents for implementation and retaining ownership of system design, debugging direction and acceptance decisions.

## Repository note

The source in this public repository represents an **earlier Aegis architecture** centered on an Electron client, ChatGPT and Gemini Supervisor. It is intentionally retained as historical evidence of the project's evolution.

The current Aegis source remains private; this document is the public hiring snapshot.