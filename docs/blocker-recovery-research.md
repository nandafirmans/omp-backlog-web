# Safe automatic blocker recovery

Research date: 2026-10-29. Scope: current blocker/retry implementation and a minimal recovery design. Research only; no execution policy, application code, settings, tickets or runtime state changed. “Proposed” below means not implemented. Sources inspected directly are listed at the end; earlier research provides context, not evidence of current execution.

## Recommendation

**Yes: give blocked tickets a durable suggested recovery prompt and a reviewed “Fix & retry” path. For genuinely hands-off recovery, prefer bounded repair inside the existing active ticket before declaring it Blocked.** Add optional preauthorized recovery only later, for narrowly defined operations. Do not treat a generated prompt, Automatic mode, or a retry button as permission to install packages, bypass workspace safety, or complete unmet requirements. Current runtime explicitly forbids dependency installation, disables OMP automatic retries, and requires operator retry after Blocked. [L1–L4]

Recommended sequence, not a new loop:

```text
Existing scheduler admits authorized ticket
  → native OMP goal: investigate → permitted repair → verify
  → recovered: continue same ticket within original limits
  → unresolved: preserve evidence + structured recovery proposal
  → host stops owned work → Blocked
  → operator reviews recovery, or future explicit standing recovery policy applies
  → existing scheduler admits a fresh attempt only after all current gates pass
  → fresh criterion evidence → Needs review → human Done
```

This preserves the existing division: scheduler owns admission/between-ticket selection; OMP goal mode owns within-ticket continuation. One active ticket globally; paused ownership is not released to run a “repair agent” alongside it. [L2–L4; U1]

**Practical goal: no repeated terminal work for known, preauthorized setup failures—not zero human decisions for every possible blocker.** Today human Done, explicit retry and dirty-workspace reconciliation intentionally prevent unconditional end-to-end autonomy. Removing those controls would be a separate policy change, not a blocker UX improvement. [L1–L4]

## Implemented behavior: source audit

| Area | What exists now | Consequence |
| --- | --- | --- |
| Blocker report | `backlog_result` accepts exact revision, partial criterion evidence, `prerequisite` and `unblock`; parser requires nonblank prerequisite/action, then combines them into `Run.blocker`, a nullable string. | Useful prose exists, but no typed cause, attempted-remediation history, policy decision, retry fingerprint or dedicated recovery prompt. [L4–L5] |
| Host lifecycle | Blocked host-tool submission initiates stop; `stop()` pauses goal, aborts and shuts down the child, checks surviving process group and captures changes. Unknown liveness retains Stopping ownership. | Never tell the model to complete an unmet goal merely to release the slot. [L4, L6] |
| Retry | Authenticated ticket action checks current revision; `retry` permits Failed/Blocked/Interrupted/Draft, sets `approvedRevision` to current revision and returns Ready. | Retry itself approves current requirements; it is not a harmless “rerun logs” action. Scheduler still checks eligibility and Git. [L7, L9] |
| Sessions | Fresh admission creates a new run; new launch creates a goal. Explicit Paused resume reads the stored snapshot and restores the same run/session. | Blocked retry is not Paused resume, and should not be relabeled as continuation of a living process. [L4, L9] |
| Correction context | New objective includes up to five previous same-ticket human `reviewFeedback` records, labeled when from older revisions. `changes` records feedback only from Needs review. | Reuse this durable-handoff pattern, but Blocked currently has no equivalent recovery-feedback API/composer. Prior `blocker` is not separately injected by this objective builder. [L4, L7] |
| UI | Ticket panel offers Review & retry; board retry confirmation warns about side effects. Run view renders the blocker and a read-only conversation; questions use separate controls. | Proposed prompt composer/recovery actions are additions, not already shipped chat capabilities. [L8, L10] |
| Admission | `eligible()` rejects handoff, paused project, invalid/removed ticket, missing criteria, unsuitable status, unapproved revision in approved mode, or dependencies not Done. Scheduler checks global pause/claims and Git, then atomically rechecks admission. | Automatic mode does not waive these gates. Blocked status is not automatically eligible. [L9] |
| Dirty work | Stopped work with Git changes persists a project handoff; clean, explicit Recheck workspace with no owned run releases only that gate. Commit and Done do not release it. | A fresh “fix” attempt cannot simply take over dirty partial work under current policy. Other eligible projects may proceed after safe shutdown. [L2, L4, L9, L11] |
| Verification | Receipt coverage validates reported outcomes for exact revision/criterion/journey/method; unresolved submitted failures/blocked/not-run prevent completion. Receipts use `source: agent_report`. | Stored bytes/hash/time do not prove execution, recipe identity or correctness. [L5, L12] |

The deterministic integration test contains assertions for blocked shutdown, no goal-complete operation, no automatic second run, retained proof and fresh-attempt feedback. This research read that test; it did not run it. Its child fixture is not live-provider verification. [L13]

## What can recover without user action?

The table is a **proposed classification**, not newly granted permission. Always intersect it with approved ticket scope, target repository policy, command permissions and remaining budget. Agents may recommend any lawful recovery; recommendation alone cannot authorize execution. Existing objective permits investigating actionable failures/independent work within the ticket but forbids installs and listed destructive/external operations. [L1, L4; U3]

| Category | Recommended handling |
| --- | --- |
| In-scope code defect or failing allowed check | Diagnose root cause, make minimal ticket-scoped correction, rerun permitted affected check in same active goal. Do not weaken assertions, replace expected behavior, or count unrun paths as passing. |
| Wrong path/command or existing tool overlooked | Inspect repository guidance and installed tooling; use documented equivalent only if it verifies the same criterion under repository policy. No silent substitution of a weaker check. |
| Known transient read-only failure, temporary readiness race or rate limit | Bounded retry of the specific safe operation after backoff; honor provider delay hints. No blind replay of an entire mutating turn. Failure classification requires evidence, not only an error-message guess. |
| Owned disposable test fixture/service needs reset | Only if the exact fixture/start/stop operation is already authorized and ownership is known. Never stop another process or reset shared/live data. Starting services still needs applicable permission. |
| Missing dependency/tool/browser binary | Block and propose setup by default. Future project-scoped preauthorized installation recipe may let agent perform setup without asking each time; see policy below. |
| Credential, provider login, MFA, account/billing/quota, access approval | Stop with exact safe prerequisite; owner handles authorization outside prompt/artifact storage. Do not search for tokens, invent credentials, auto-answer consent or rotate identities/models to evade restrictions. A known transient provider outage is distinct from missing authentication. |
| Ambiguous requirement, unavailable real data, missing required recipe | Ask focused question or propose a separately commissioned prerequisite. Synthetic data only when already acceptable; cannot replace required live verification and call it passed. |
| Dirty workspace, unresolved ownership, unavailable Git inspection | Preserve partial/unrelated work and handoff. Do not commit/stash/reset/delete or clear gate to make retry possible. |
| Permission/security policy/env/infra change, migration, deployment, paid operation, external write, destructive cleanup | Outside default recovery. Separate exact-action authorization/review required; some remain forbidden under project policy even if a prompt suggests them. No `sudo`, global installs or host configuration edits under generic recovery permission. |

These boundaries derive from current scope/approval/workspace rules and least-privilege/action-validation guidance. AWS also cautions that a timeout does not prove side effects did not happen; retries require idempotency or reconciliation. [L1–L4, L11; U2–U3]

### Dependency installation: authorize a recipe, not “whatever fixes it”

**Current state: no automatic installs.** The execution objective says “do not install dependencies”; a future policy needs an explicit, reviewed change to that contract, not an extra prompt contradicting it. Automatic project mode supplies ticket execution permission, not installation approval. [L2, L4]

Proposed opt-in policy should bind:

- Canonical project, recipe ID/content digest and versioned policy approval; permitted package manager/executable, exact argument template, working directory and writable paths.
- Existing manifest/lockfile identities and pinned dependency resolution; no new dependency, manifest rewrite, lockfile update, upgrade, manager installation or global changes by default.
- Registry/network allowlist, download/space/time budget, allowed cache/temp paths and environment handling; no credentials exposed to model/logs. Private registry authentication requires separately provisioned access, not discovery of secrets.
- Lifecycle-script decision: disabled by default; required scripts need explicit reviewed allowlist and constrained execution. Inspect project setup scripts before authorizing them.
- Effects on existing dependency directories, native compilation/downloads and cleanup; no implicit permission to delete existing installations or caches. Prefer a dedicated disposable setup location when compatible, not an automatically created per-ticket Git worktree.
- Success probe and allowed required checks; if setup fails, retain sanitized evidence and stop, without widening flags/permissions or falling back to an unapproved manager.

Frozen installation is reproducibility support, **not a safety guarantee**. For example, npm documents that `npm ci` rejects manifest/lock mismatch and does not rewrite them, but automatically removes existing `node_modules`; install lifecycle scripts and network-related configuration also matter. Therefore even a lockfile-based command needs explicit approval for its concrete effects. npm v11 documentation is illustrative only; no npm/Bun behavior was tested here. [U4]

Because ordinary execution has backend OS-user permissions, a prompt/recipe allowlist alone cannot enforce filesystem/network isolation against unrestricted shell access. A recovery dispatcher can constrain the actions it owns; claiming stronger guarantees requires restricting every execution path or adding separately approved OS isolation. Do not advertise this proposal as sandboxing. [L1–L3; U3]

## Minimal durable recovery model — proposed

Extend existing private run records/contracts; keep SQLite as runtime/recovery owner and Markdown as requirements owner. The store already persists JSON records transactionally. Do not add a second status file or put runtime recovery metadata into ticket Markdown/requirement attachments: those inputs determine revision and approval. A future data-contract change still needs compatibility validation; this note does not prescribe a migration or change the public API. [L3, L5, L14]

Suggested versioned blocker/recovery record:

| Group | Minimum information |
| --- | --- |
| Identity | Blocker ID, source run/ticket/project, exact requirements revision, created/updated time; link each subsequent attempt to its parent. |
| Diagnosis | Cause category, exact prerequisite, affected criteria/journeys, sanitized observed error/evidence references, uncertainty; agent classification explicitly labeled as a claim. |
| History | Actions attempted, outcomes, partial effects/paths, owned resources, unresolved checks and non-idempotent operations not to repeat. |
| Proposal | Human-readable summary, suggested recovery prompt, structured recipe/actions, expected effects, required permissions, preflight and success checks. Free text is not an executable shell script or authorization token. |
| Authorization | Policy ID/version or exact operator approval, revision + proposal hash, scope/expiry/revocation, allowed commands/paths/network/resources and check permission. Host decides; agent cannot mark itself approved. |
| Retry control | Normalized failure fingerprint, prerequisite-probe identity/result, attempt count, cumulative time/tokens, `nextEligibleAt`, progress summary, escalation reason and stopped/ready/awaiting-approval state. |
| Provenance | Distinguish agent-reported cause/checks from host-observed admission, process identity, storage and any future dispatcher-captured command outcome. Hashes protect stored identity, not semantic truth. |

Bound every free-text field/history and sanitize before persistence; avoid persisting raw environment dumps, credentials, cookies, auth/session payloads or unbounded provider output. Do not overload `reviewFeedback` as if model suggestions were human review requests. Keep legacy `blocker` readable while introducing typed data. These are design recommendations consistent with existing private proof/receipt contracts and OWASP guidance. [L5, L12, L14; U3]

### Recovery prompt UI

On the existing ticket panel, show **Why blocked**, **What was tried**, **Recommended fix**, **Permission needed**, **What will be checked**, and **Partial work / workspace gate**. Add an editable **Recovery instructions** field prefilled from the proposal. Save draft separately from requirements; saving must neither approve nor start anything. Use existing MarkdownEditor/Ant Design controls and visible safety notices, not another chat/drafting product or a second component system. [L8, L10, L15]

Recommended actions:

1. **Save recovery note** — durable context only.
2. **Review fix & retry** — bind confirmation to current revision, proposal/prompt hash, source blocker/run and required actions. Display “This approves the reviewed revision and may start a fresh run; previous side effects remain.” Reject stale prompt/revision/policy instead of silently approving changed content.
3. **Create prerequisite draft** — only when work is outside original scope; creating it is not permission to execute it.
4. **Keep blocked** — no side effects; show exact outstanding operator-only prerequisite.

If handoff exists, display “Recovery saved; execution blocked by workspace reconciliation” and link to the existing operator workflow. Do not put an unrestricted implementation agent behind “Diagnose” just because that action sounds read-only. A post-stop investigation capability would need its own restricted, authorized execution path; unnecessary for the first slice. Current drafting explicitly has no implementation tools or scheduler mutation. [L2, L7–L11]

Example suggested prompt, to be rendered from structured context rather than copied blindly from logs:

```text
Recover ticket <ticket>, approved revision <revision>, after blocker <id>.
Review prior run <run> and retained partial evidence before changing files.
Prerequisite: <exact unavailable condition>.
Already attempted: <actions and outcomes>; do not replay <uncertain side effect>.
Permitted recovery: <reviewed recipe/actions and policy identity> only.
First recheck <safe prerequisite probe>. If unavailable, stop with updated blocker.
If available, perform approved repair; verify <original criteria/journeys> using
<permitted checks>. Preserve unrelated changes and all approval/workspace gates.
Do not install or expand scope without separate applicable approval.
Report actual outcomes; unresolved checks remain blocked. Never mark Done.
```

This would improve a fresh attempt's memory, not guarantee that prerequisites are solved. Keep trusted host restrictions separate from untrusted blocker/log/prompt content, validate action arguments at execution boundaries, and never execute model-generated shell text directly as a recovery recipe. Labels and prompts are not security enforcement. [L4; U3]

## Bounded automation without another scheduler — proposed

### Stage A: repair before terminal Blocked

For actionable in-scope failures, use existing native OMP continuation to fix/recheck within the current run. Record permitted local repair attempts as they happen; this avoids surrendering ownership and then being unable to reacquire a dirty workspace. Do not delay a true permission/prerequisite blocker merely to keep the slot. Long waits should terminate safely, not become a hidden Paused job holding the global slot indefinitely. [L2, L4, L9; U1]

Suggested starting caps: at most **two remediation actions per fingerprint**, within the original run deadline/token budget and a smaller recovery sub-budget. Numbers are design defaults to tune, not measured optimums. Progress means a prerequisite probe changed, a concrete failure disappeared, or required check coverage improved—not merely different wording or more tool calls. OMP has tool-activity no-progress suppression, but that does not independently establish semantic progress. [U1]

### Stage B: after terminal Blocked

Keep explicit reviewed retry as default. A later project-scoped **Allow bounded recovery** policy may preauthorize narrowly eligible future attempts; this is a deliberate change from today's explicit-retry rule. Do not implement it by calling the human `retry` endpoint as if an owner clicked: that endpoint also approves current requirements. Retain approved-only exact-revision approval, and revalidate any Automatic-mode standing permission at admission. [L1–L4, L7]

Use the existing scheduler's reconciliation and durable `nextEligibleAt`, not a new daemon, cron job, queue processor or competing goal loop. A small deterministic policy decision can propose/release an eligible recovery attempt through the same claim path after prior shutdown is observed. Keep OMP `set_auto_retry` disabled so retry ownership is not duplicated. [L4, L9; U2]

For each attempt:

1. Validate current project/global permission, ticket/revision, dependency Done, policy/recovery approval and unchanged proposal identity. Canceled questions are still unanswered; do not auto-answer them under generic recovery permission.
2. Check fingerprint and safe prerequisite probe. Require changed prerequisite evidence for deterministic blockers; allow only explicitly classified, bounded transient failures without a change. Normalize volatile timestamps/IDs but preserve relevant error code, failing check, dependency/recipe identity and requirements revision. Also track a wider incident lineage so rewording or cosmetic edits cannot reset caps.
3. Apply bounded backoff, e.g. 30 seconds then 2 minutes with jitter and a capped total wait; honor longer permitted provider hints or escalate. Waiting stopped work holds no active slot; a Paused run still holds its slot and cannot be bypassed. Existing scheduler fairness remains authoritative. [L9; U2]
4. Admit only through normal safe claim/Git checks. A dirty workspace or recorded handoff forbids fresh automatic repair under current selected policy—even if the previous ticket caused the changes. No automatic clean recheck, commit, stash, reset, worktree creation or “same ticket” exception. [L1–L4, L9, L11]
5. Recheck after recovery and submit fresh criterion evidence for the new attempt. Earlier proof remains context, not automatic inherited pass; successful setup alone is not feature acceptance. [L2, L12]
6. Stop on repeated fingerprint/no progress, cap exhaustion, budget exhaustion, unknown side effects/liveness, policy revocation or changed scope. Persist a clear escalation with one concrete required action. No silent budget increase or restart to evade limits. [L1–L4; U2]

Persist a simple incident stop flag (“circuit open”) when repeated recovery fails; require explicit operator reset after a meaningful change, rather than automatically cycling half-open mutating attempts. For shared provider outages, a provider-scoped stop can prevent multiple tickets spending their retry caps on the same outage; do not globally pause unrelated providers/projects unnecessarily. This is a proposed bounded safety latch, not a recommendation for a complex circuit-breaker framework. AWS specifically warns that circuit breakers add modal/test complexity and favors bounded single-layer retries; start with caps and add the shared latch only when observed failures justify it. [U2]

## Same ticket or remediation ticket?

- **Same active ticket:** small correction/setup already inside approved scope and permitted operations, original criteria unchanged, existing ownership intact. Cheapest path; no new dependency or approval model. [L1–L4]
- **Fresh same-ticket attempt:** prerequisites fixed/reviewed, durable recovery context attached, safe workspace handoff complete and normal admission allowed. Reuse existing scheduler, not the old process. [L4, L7, L9]
- **Separate prerequisite draft:** reusable toolchain repair, missing verification skill commissioning, broad infrastructure/environment/security change, cross-project work, new dependency or work outside original acceptance. Give it its own observable Done criteria and approvals. Do not create these automatically merely to hide a blocker. Creation/skill mention does not authorize execution. [L1–L3]
- **Dependency linkage:** adding `depends_on` changes requirements and needs current-revision review/approval. Avoid cycles: remediation cannot depend on its blocked parent. Parent waits for human Done of prerequisite, not Needs review, and still needs applicable retry permission and workspace handoff. A child ticket in the same dirty repository is blocked by the same gate; ticket splitting is not a bypass. [L1–L3, L9]

## Concrete phased plan and acceptance gates — proposed, not delivered

### 1. Recovery handoff first

Add structured blocker fields, retained partial evidence/history and editable suggested recovery instructions in the existing ticket/run UI. Add one revision/proposal-bound reviewed recovery-and-retry action; inject accepted context into the next fresh objective alongside, but distinct from, human review feedback. Preserve legacy runs. **No auto-retry or installs.**

Acceptance: prompt/history survive reload/restart; saving does not start/approve/edit requirements; stale submissions rejected; next authorized attempt receives context; private evidence stays out of requirement attachments; dirty gate remains visible and blocking. Exercise panel and board entry points independently, keyboard/mobile and dark/Light surfaces under design-language policy. [L1–L2, L7–L8, L15]

### 2. Better bounded same-run remediation

Make allowed diagnosis/fix/recheck behavior explicit, with small caps, semantic progress notes and honest blocker escalation. Add host-recorded outcomes for narrowly approved recovery/preflight commands where practical; label all other evidence agent-reported. No unrestricted command dispatcher or new background agent needed.

Acceptance: actionable permitted failure can recover without manual setup; missing permission/install cannot; unchanged failure stops within cap; original time/token limits and run ownership hold; original failed journeys must be resolved, not renamed away. A protocol fixture passing is only protocol evidence. [L2, L4, L12–L13; U1–U3]

### 3. Opt-in setup recipes and bounded fresh retries

Only after explicit policy approval, introduce project-scoped preauthorization, manifest/recipe/policy identity checks, constrained action execution, durable retry counters/backoff and scheduler eligibility. Start with one proven recipe/category, not a generic arbitrary-shell recovery engine. Keep current handoff restrictions, human Done and explicit recovery review as default. Document that current instruction/policy contracts are changing before rollout. [L1–L4, L9; U2–U4]

Acceptance: unauthorized install/network/global/destructive actions rejected; approved recipe effects and success probes recorded; revocation/recipe edits invalidate grant; duplicate scheduler events/restarts cannot duplicate actions; crash after uncertain side effect does not replay it; shared outage and fingerprint exhaustion stop safely; Paused/global ownership, revision edits, dependencies and workspace gate all still block admission. Verify installation behavior only in explicitly approved disposable environments. [L1–L4, L9; U2–U4]

### 4. Measure before broadening

Track per-category recovery success, attempts/cost/time, false “resolved” claims, intervention cause and preserved-evidence quality; inspect failed cases before adding recipes. Commission real-provider disposable smoke only with separate authorization, then maintain project-local recipes/maps. Do not claim unattended production reliability from fixture coverage. Host-observed verification/provenance remains an existing adoption priority, not solved by this research. [L1–L3, L12–L13; U5]

## Feasibility and hard limits

**No manual install at each incident is feasible for a known setup path with installed tooling, preprovisioned access and an explicitly approved bounded recipe.** It is not feasible to guarantee every blocker resolves without user input: missing authorization/MFA, unavailable providers, insufficient budget, uncertain requirements, dirty unrelated work and subjective acceptance cannot be solved safely by prompt repetition. Current human-only Done also means automatic execution is not automatic accepted completion. This conclusion follows from the existing gates, not a product performance measurement. [L1–L4, L9, L11]

Under the selected operator-controlled handoff policy, a run that leaves tracked/untracked work creates a deliberate human boundary before any fresh same-project run. Therefore improve same-active-ticket recovery first; promise “automatic repair where authorized; actionable recovery otherwise,” not “all blockers disappear automatically.” Per-ticket worktrees, automatic commits, automatic handoff release or automatic Done would each require separately approved architecture/policy work and are outside this recommendation. [L1–L4, L11]

## Sources and verification limits

Local links cite the owning implementation/symbols as read on the research date; line anchors may drift. No installed OMP version was queried in this research. Upstream OMP source below is tag-pinned to v18.13.1, matching a version discussed in current workflow notes, but does not attest the installed executable. Official mutable web guidance was fetched on 2026-10-29; it is architecture/security guidance, not a guarantee about this app. [L2; U1]

### Repository primary sources

- **L1:** [AGENTS.md](../AGENTS.md#L24-L48), execution, ownership, revision, retry, evidence and workspace rules.
- **L2:** [Current agent workflow](current-agent-workflow.md#L32-L130), implemented lifecycle, missing-tool handling, acceptance, handoff, blocker semantics and security limits; [adoption priorities](current-agent-workflow.md#L147-L154).
- **L3:** [PLAN.md](../PLAN.md#L170-L307), scheduling, recovery and continuation ownership; [runtime/Markdown ownership](../PLAN.md#L104-L112); [delivered versus pending](../PLAN.md#L451-L461). Current AGENTS/workflow are stricter on human-only Done than the plan's older hypothetical automatic-completion text; this recommendation follows current policy.
- **L4:** [server/runtime.ts](../server/runtime.ts#L420-L524), `launch()` host-tool schemas, `set_auto_retry`, objective composition, current no-install contract, prompt/goal creation/resume and budgets.
- **L5:** [server/contracts.ts](../server/contracts.ts#L1-L32), `Run`, `VerificationReceipt`, `Settings`, `Runtime`; [result parsing](../server/runtime.ts#L130-L152), `parseResult()`.
- **L6:** [server/runtime.ts](../server/runtime.ts#L207-L281), `stop()`/`settled()`; [blocked host-tool handling](../server/runtime.ts#L325-L351).
- **L7:** [server/api.ts](../server/api.ts#L246-L278), ticket action revision validation, retry approval, review feedback and run control/answer endpoints.
- **L8:** [src/Workspace.tsx](../src/Workspace.tsx#L398-L418), ticket retry/actions; [run blocker rendering](../src/Workspace.tsx#L616); [src/TicketBoard.tsx](../src/TicketBoard.tsx#L127-L153), retry confirmation and side-effect warning.
- **L9:** [server/runtime.ts](../server/runtime.ts#L118-L127), `eligible()`; [scheduler/claim/control/reconciliation](../server/runtime.ts#L587-L692), `cycle()`, `control()`, periodic reconciliation.
- **L10:** [README.md](../README.md#L144-L178), recovery, read-only run conversation, fresh sessions and native continuation; [drafting restriction](current-agent-workflow.md#L18-L24).
- **L11:** [server/runtime.ts](../server/runtime.ts#L104-L115), `inspectWorkspaceHandoff()`; [post-run handoff](../server/runtime.ts#L186-L200); [server/api.ts](../server/api.ts#L206-L222), workspace recheck; [operator reconciliation](current-agent-workflow.md#L98-L114).
- **L12:** [server/evidence.ts](../server/evidence.ts#L51-L61), `assertVerifiedCriteria()`; [receipt/provenance limits](current-agent-workflow.md#L75-L88); [current evidence source contract](../server/contracts.ts#L9).
- **L13:** [server/runtime-integration.test.ts](../server/runtime-integration.test.ts#L382-L415), blocked lifecycle/fresh attempt fixture assertions; [README fixture limitations](../README.md#L210-L214).
- **L14:** [server/store.ts](../server/store.ts#L24-L65), private JSON record storage/transactions; [revision input boundary](current-agent-workflow.md#L65-L88).
- **L15:** [docs/design-language.md](design-language.md#L19-L39), shared editor/components, feedback and control rules; [AGENTS.md UI verification](../AGENTS.md#L10-L14).

### External primary sources, directly fetched

- **U1:** OMP v18.13.1 [`rpc-goal.ts`](https://github.com/can1357/oh-my-pi/blob/v18.13.1/packages/coding-agent/src/modes/rpc/rpc-goal.ts), `RpcGoalOp`, `stopForHostAbort()`, `observe()`, `#continuationWanted()` and `#scheduleContinuation()`: host lifecycle operations, same runtime for RPC modes, gate rechecks and tool-activity-based suppression. Does not independently verify ticket acceptance.
- **U2:** AWS Builders' Library, [Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/), especially Retries and backoff: idempotency, side-effect uncertainty, capped attempts, single retry layer and circuit-breaker tradeoffs. Numerical defaults proposed above are not AWS prescriptions.
- **U3:** OWASP, [LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html), Structured Prompts, Human-in-the-Loop, Agent-Specific Defenses, Least Privilege and Secure Implementation Pipeline: text labels are not enforcement; validate tools/arguments and exact authority outside model; protect sensitive logs.
- **U4:** npm v11, [`npm ci`](https://docs.npmjs.com/cli/v11/commands/npm-ci), Description and configuration: lockfile requirements, no manifest/lock rewrite, removal of existing `node_modules`, lifecycle-script controls and audit/network behavior. Not a verified recipe for Bun or this project.
- **U5:** Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), When (and when not), Agents and Coding agents: simplest adequate workflow, environmental feedback, iteration limits, guarded testing and human review. Published 2024-12-19; page itself notes tooling has evolved. Used only for design principles.

Existing [completion-loop research](agent-completion-loop-research.md) and [handoff UX research](workspace-handoff-ux-research.md) informed document convention/context; their historical line numbers or verification reports were not treated as fresh test results.

**Verification performed:** read repository docs/implementation/test source and fetched public official source/guidance; wrote this Markdown file only. No installs, application/agent launches, shell commands, tests, lint, typecheck, build, migration, browser smoke, workspace reconciliation or live-provider execution. No secrets/auth files inspected; no private repository content submitted to external services. Feasibility is a source-based design assessment, not measured recovery success or host-attested verification.
