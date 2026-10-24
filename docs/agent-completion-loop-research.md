# Agent completion and autonomous ticket loops

Research date: 2026-10-22. Scope: official OMP behavior, completion semantics, and bounded ticket execution. Research only; no application changes.

## Answer

**No special completion or loop skill is required.** OMP already supplies goal mode, an agent-callable completion tool, and opt-in RPC continuation. The model decides whether its objective is satisfied using instructions and observed tool results; this is not an infallible proof. This application separately requires revision-bound evidence, settled execution, and human acceptance. A skill can teach better verification, but cannot replace those gates. [S1–S7; L1–L3]

## Source and version identification

- Local `/usr/bin/omp --version` returned `omp/18.12.6`; `omp --help` identifies `--goal` as interactive-only and documents RPC, skills, and time limits. Only version/help metadata was requested; no credentials, sessions, or settings were read.
- Official package metadata identifies `@oh-my-pi/pi-coding-agent`, repository `can1357/oh-my-pi`, and homepage `omp.sh`. Its README identifies OMP as a fork of Pi, not identical to upstream Pi. [S0]
- Release tag `v18.12.6` resolves to commit `45c35e40c46166dc726ccc52f5d27f40f2449f99`. Goal runtime, goal tool, goal settings, RPC goal controller, continuation prompt, RPC docs, and skills docs were compared with inspected main commit `0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0`; these seven files were identical. Citations below pin the release commit. This establishes source-version alignment, not a cryptographic attestation of the installed binary. [S0a]
- No repository `AGENTS.md` was found. Existing documentation uses standalone Markdown under `docs/`; README carries ticket and runtime workflow guidance. Global injected safety and verification instructions remain applicable. [L1]

## Current OMP behavior

### How completion is determined

1. Goal prompts require retaining the entire objective, mapping it to concrete deliverables, inspecting current files, running relevant checks, and matching verification scope to claim scope. Missing or indirect evidence means not achieved. Budget exhaustion must never be presented as completion. These are model instructions, not independently executed assertions. [S1]
2. The **agent tool** is `goal({op:"complete"})`. `GoalTool.execute()` invokes `GoalRuntime.completeGoalFromTool()`. That method flushes usage, checks goal existence/status, disables goal mode, sets status `complete`, records exit reason `completed`, and persists state. It does **not** execute tests or validate acceptance evidence itself. Thus an accepted tool call means the model declared completion, not that an external verifier proved it. [S2–S3]
3. The **host RPC command** supports `goal` operations `get`, `create`, `resume`, `pause`, and `drop`; it intentionally has no `complete` operation. Do not confuse host lifecycle commands with the model's tool schema. [S2; S4]
4. RPC `prompt_result.status:"completed"` reports a prompt's yield/local outcome, not business acceptance. `session_settled` or `get_state.isSettled` reports quiescence: no admitted/live run, queued continuation/delivery, or background work able to wake the session. Neither proves a feature correct. Provider failures can occur after prompt admission, so a successful command acknowledgement is not successful task execution. [S5]

### Continuation and stop conditions

- `goal.enabled` defaults true; `goal.continuationModes` defaults to `["interactive"]`. RPC hosts must opt in with `"rpc"`; the same controller covers `rpc` and `rpc-ui`. CLI `--goal` is not the RPC entry point; use the RPC `goal create` command. [S4; S6; local CLI help]
- `RpcGoalController` schedules hidden continuation after terminal agent events, waits for idle, then rechecks live gates. It does not treat a merely yielding agent as finished while continuation is pending. Completion journals the goal and restores the prior tool set. [S4]
- Continuation stops/suppresses when goal is not active, host aborted, session disposed, plan mode active, configured mode disabled, or only blocked todos remain with no actionable task. Empty or repeated continuation tool-activity digests also suppress continuation until new activity/host action rearms it. The digest measures tool-call/result activity, not semantic progress or correctness. [S4; S8]
- Host abort latches continuation off; interrupted active goals become paused. Restoring a session normally pauses a previously active goal; explicit resume is distinct from merely loading its transcript. Some in-process switches preserve active goals, so hosts should use documented lifecycle behavior rather than assume every session transition is equivalent. [S3–S4]
- OMP token accounting is input + cache-write + output deltas, explicitly excluding cache-read. Reaching budget marks the goal `budget-limited`, suppresses normal continuation, and injects instructions to wrap up without new substantive work. This is not an exact hard request-time spending cap: usage is observed after work, and wrap-up may consume more. Host-enforced budgets remain valuable. [S3; S9]

## Current application behavior: separate from upstream

These observations are source inspection, not a real-provider execution test.

| Gate | Current implementation | Meaning |
| --- | --- | --- |
| Eligibility | `eligible()`, `server/runtime.ts:104–114` | Repository permission, valid criteria/revision approval, and dependencies already Done govern admission. |
| Single-ticket execution | `launch()`, `server/runtime.ts:314–414` | Snapshot requirements, register `backlog_result`, enable RPC continuation, prompt once, create/resume one goal. Scheduler owns next-ticket selection; prompt forbids `/loop` and `backlog-worker`. |
| Agent result | `parseResult()`, `server/runtime.ts:116–137` | Exact revision and every exact criterion require unique nonblank evidence text for a complete result; blocked requires prerequisite and unblock action. |
| Quiescence | `settled()`, `server/runtime.ts:240–251` | Recheck `isSettled` and pending async work. Missing result fails closed; valid complete result goes to `needs_review`, not Done. |
| Host shutdown | `stop()`, `server/runtime.ts:189–215` | Best-effort pause/abort followed by mandatory shutdown; surviving child work or failed final change inspection prevents successful review handoff. |
| Harder host limits | `server/runtime.ts:319–320,420–432` | Deadline and three-second polling stop execution as Failed; host uses whole-session token totals including cache-read, unlike OMP goal accounting. Polling can overshoot. |
| Human acceptance | `README.md:58–65,118–128` | Needs review is not Done; dependents wait for accepted Done work. Pauses/failures require deliberate operator handling. |

**Evidence caveat:** `parseResult()` validates correspondence, coverage, uniqueness, and text bounds. It does not verify that the narrated command ran, its exit code was successful, or the artifact actually demonstrates the criterion. Current upstream goal completion has the same model-trust limitation. Human review and stronger objective evidence address this; adding a skill alone does not. [L2; S3]

**Blocked caveat:** the local prompt says to complete/pause the goal after a blocked report, but upstream reserves `complete` for achieved objectives. Prefer host `goal pause` followed by controlled settlement/shutdown for an unresolved blocker; never describe blocked acceptance criteria as achieved. The model goal tool itself has no `pause` operation. This is a recommendation about lifecycle semantics, not a change made here. [L2:384–385; S1–S4]

## Skills: useful, optional, not enforcement

Official skills docs define skills as file-backed, optional capability packs: metadata in context, bodies read via `skill://`, optional `/skill:NAME` command injection. Tools perform executable actions; hooks can intercept/block runtime behavior; skills are passive workflow content. `alwaysApply` and `globs` are metadata, not automatic invocation controls. No special completion skill is required by the inspected goal implementation. [S7]

The official tree includes repository-maintenance skills such as `semantic-compression`, `system-prompts`, and `tool-prompt-optimization`, plus authoring examples. This is not evidence that a universal completion/loop skill must be installed. A separately named community or locally installed skill was not audited. The app resolves explicitly mentioned installed skills within one ticket; missing skills must be reported rather than invented. [S10; L1:108–112; L2:383]

## Recommended bounded ticket loop

This is design guidance, not a description of additional features already implemented.

1. **Define observable success before admission.** Immutable ticket revision; explicit scope and non-goals; each criterion names its expected evidence/check. Specify permitted verification and required external prerequisites. If verification conflicts with repository policy, resolve it or report the limitation; never silently skip a required gate and claim success. [S1; S11]
2. **Keep two loops separate.** Deterministic scheduler selects an authorized eligible ticket. One OMP goal iterates inspect → act → observe → verify within that ticket. No nested backlog-worker or generic `/loop` competing for ticket ownership. [L1:126; L2:377–414; S4]
3. **Use bounded execution.** Retain token/time limits, cancellation, no-progress suppression, and explicit blocker exits. Do not automatically raise limits or retry unchanged failures indefinitely. For any future retry policy, bound attempts and require a changed prerequisite or classified transient condition. [S4; S9; S11; L1:120–128]
4. **Submit evidence, not just a verdict.** Record exact criterion, command/check, result/exit status, relevant paths/artifacts, and what was not checked. Prefer host-observed command/artifact records for machine-checkable criteria; link evidence to the immutable revision. A broad end-to-end claim needs correspondingly broad evidence. [S1; S11]
5. **Stop on verified completion, blocker, exhaustion, or human intervention.** Agent `goal complete` is appropriate only for achieved objective. Blockers/exhaustion are non-success outcomes; pause/abort/shutdown safely and preserve partial work. Wait for actual quiescence, not a single assistant final message. [S1; S4–S5; S9]
6. **Accept separately.** Complete evidence + safe settlement → Needs review. Human checks subjective requirements, broader architecture, security, and evidence credibility before Done. Only then unblock dependent tickets. Independent eligible tickets may proceed under scheduler policy; unresolved dependencies may not. [L1–L3; S11]

Anthropic's first-party guidance supports exactly these boundaries: obtain ground truth from tools/environment, allow human checkpoints and blockers, include stopping conditions such as iteration limits, start simple, test in sandboxed environments, and keep human review even when coding tests are automated. It is architecture guidance, not documentation of OMP internals. [S11]

## Verification limits

- Read official source/docs and local README/runtime, checked installed CLI metadata, and compared relevant release/main files. No live model/provider run, UI smoke test, or proof of ticket completion was performed.
- No application code changed. No build/test/lint was needed for this Markdown-only research artifact.
- Existing unrelated working-tree edits were preserved. No private project contents were sent to external services; HTTP requests requested public upstream source and authoritative published guidance only.

## Primary sources

Pinned OMP source links use release commit `45c35e40c46166dc726ccc52f5d27f40f2449f99`.

- **S0 — Identity:** [official package metadata](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/package.json); [official README](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/README.md).
- **S0a — Release identity:** [GitHub tag reference API](https://api.github.com/repos/can1357/oh-my-pi/git/ref/tags/v18.12.6).
- **S1 — Verification contract:** [goal continuation prompt](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/prompts/goals/goal-continuation.md), numbered audit requirements; [active goal prompt](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/prompts/goals/goal-mode-active.md).
- **S2 — Agent tool schema/dispatch:** [`goal-tool.ts`](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/goals/tools/goal-tool.ts#L21-L25), `goalSchema`, `GoalTool.execute()`.
- **S3 — Durable goal state/accounting:** [`goals/runtime.ts`](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/goals/runtime.ts), `goalTokenDelta()` line 66, `onTaskAborted()`, `onThreadResumed()`, `#flushUsageLocked()`, `completeGoalFromTool()` line 482.
- **S4 — RPC lifecycle/continuation:** [`rpc-goal.ts`](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/modes/rpc/rpc-goal.ts), `RpcGoalOp`, `stopForHostAbort()`, `observe()`, `#continuationWanted()` line 405, `#scheduleContinuation()` line 424.
- **S5 — Protocol semantics:** [`docs/rpc.md`, Prompt payload and Yield vs settled, lines 315–353](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/rpc.md#L315-L353); lifecycle command schema includes `goal` at line 148.
- **S6 — Default settings:** [`goals/settings.ts`](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/goals/settings.ts), `cfgGoalEnabled`, `GOAL_CONTINUATION_MODES_DEFAULT` line 27, `cfgGoalContinuationModes`.
- **S7 — Skills mechanics:** [`docs/skills.md`](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/skills.md), What a skill is, Runtime usage behavior, Skills vs AGENTS.md/commands/tools/hooks.
- **S8 — Progress heuristic:** [`goals/state.ts`](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/goals/state.ts), `goalContinuationActivity()` hashes assistant tool calls and tool results.
- **S9 — Budget steering:** [goal-budget-limit prompt](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/prompts/goals/goal-budget-limit.md).
- **S10 — Official skill examples:** [repository `.omp/skills`](https://github.com/can1357/oh-my-pi/tree/45c35e40c46166dc726ccc52f5d27f40f2449f99/.omp/skills); [authoring skill docs](https://github.com/can1357/oh-my-pi/tree/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/skills).
- **S11 — Independent architecture guidance:** Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), “Agents,” “When (and when not) to use agents,” and “Appendix 1 / Coding agents” (published 2024-12-19; accessed 2026-10-22). Page notes tooling has evolved; cited design principles are not claims about current provider APIs.
- **L1 — Local workflow:** [`README.md`](../README.md), lines 58–95,108–128,138–148.
- **L2 — Local execution:** [`server/runtime.ts`](../server/runtime.ts), exact functions/line ranges in table above.
- **L3 — Human acceptance/dependency policy:** [`README.md`](../README.md), lines 64–65,95,120–128; `eligible()` and `settled()` in [runtime](../server/runtime.ts).
