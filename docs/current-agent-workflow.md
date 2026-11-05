# Current agent workflow

This guide describes the implemented workflow, not full pstack parity. See [PLAN.md](../PLAN.md#10-planned-execution-loop-improvements) for delivery boundaries and remaining work, and [README.md](../README.md) for setup and navigation.

## What changed

| Addition | Current behavior |
| --- | --- |
| Verification skills | Project-local [verify-backlog](../.omp/skills/verify-backlog/SKILL.md) documents isolated launch, read-only diagnosis, real user journeys, evidence and cleanup. Its [feature map](../.omp/skills/verify-backlog/features/README.md) identifies relevant paths. [Maintenance](../.omp/skills/maintain-backlog-verification/SKILL.md) is explicitly invoked, not an automatic whole-project audit on every ticket. |
| Structured verification receipts | New runs report exact criterion, feature, entry point, method/command, outcome, details and recipe identity through `backlog_evidence`. These remain agent reports, not independently observed command execution. |
| Private run proof | Optional sanitized artifacts belong to the run, separate from requirement attachments. Downloads require authentication and check recorded size/hash. Proof survives run shutdown. |
| Durable review feedback | Request changes requires an explanation through ticket panel, board Actions or drag confirmation. Feedback remains linked to the reviewed run/revision and is included in subsequent authorized attempts. |
| Correct blocked shutdown | Host pauses goal continuation and stops owned child work without asking the model to complete an unmet goal. |
| Blocker recovery handoff | Blocked ticket panel retains structured agent suggestions and editable private recovery notes. Explicit retry binds the current revision, source run and saved note; a fresh run snapshots reviewed context without inheriting passing evidence. No automatic retries or installs. |
| Progress visibility | Run panel shows host-observed activity, deadline/budget and last reported session-token sample with its accounting basis. It does not infer percentage completion. |
| Operator reconciliation | Git changes or unavailable Git inspection create a persistent project gate. Operator reviews/reconciles through an explicitly confirmed local commit or in a terminal, then separately requests a clean recheck before new work can start. |
| Optional ticket drafting | New ticket retains its manual Markdown/import drawer. The sibling Create with agent action opens a dedicated Discuss / Review ticket page with an explicitly connected, capability-restricted OMP conversation, model/thinking controls and pasted file/skill context. Only reviewed explicit creation publishes a ticket; drafting never implements or approves it. |

### Agent-assisted creation

See [Create with agent](../README.md#create-with-agent-optional) for controls and limits. Conversation state is separate from ticket/run storage. Drafting uses a private startup namespace for audited OMP v18.12.6, disables executable discovery and model tools, resolves bounded selected context in host code, and escapes OMP's implicit file/model mention dispatch. Skills supply text only; their scripts cannot run. Normal execution retains its existing permissions and tools.

Model/thinking changes affect drafting only. PDF/Office and WebP remain explicitly reference-only unless replaced with readable input; unsupported context cannot silently disappear. Cancellation/errors preserve available output without replay. Drafting has no goal continuation, implementation evidence tools, approval or scheduler mutation.

Assisted creation stages the complete validated payload outside the watched ticket namespace and publishes atomically without overwriting an existing ID. Ten-minute confirmations bind payload hashes and current project mode; retries require the same unchanged publication. Automatic mode can admit a valid ticket after explicit creation, so its confirmation warns about implementation. Approved-only and Paused gates are unchanged. Manual creation/import remains available without OMP.

Verification for this addition: full Bun suite passed (70 tests, 628 assertions), changed-file ESLint and strict TypeScript passed. Isolated real-browser/live-provider drafting passed with `openai-codex/gpt-6.1-sol`, thinking `low`, clarification/follow-up, file/skill/text/image context, unsupported-PDF exclusion, editable Markdown/Preview handoff and complete three-attachment creation. Separate protocol-child browser checks covered cancellation, partial output, sanitized provider failure and unsaved navigation; these error fixtures are not live-provider failures. Real OMP executable-discovery positive-control/restricted-startup sentinel check passed without inference; the synthetic uncredentialed restricted profile itself returned a failed metadata snapshot, not provider-success evidence.

Private proof is retained under `/tmp/backlog-agent-smoke-PyWw4u/proof`. Browser smoke kept global scheduling paused and launched zero ticket implementation runs; it does not establish live implementation execution or exhaustive model/provider coverage.

The dedicated drafting-page UI was separately exercised in a real browser using actual Workspace/MarkdownEditor components and styles with an in-memory synthetic API: independent manual drawer and agent page, proposal handoff, retained unsent prompt/pasted file/human review edits across views, canceled overwrite, unresolved-context blocking, disconnect and route-unmount DELETE requests, canceled navigation and publication, and confirmed synthetic publication with the staged attachment. Desktop and 390px mobile surfaces were inspected; no horizontal document overflow was observed. Changed-file ESLint passed. This frontend smoke did not run OMP, validate real backend publication, or prove provider/process behavior; the earlier live-provider evidence above predates this layout change.

## Human-reviewed ticket lifecycle (default)

```text
Create ticket with observable acceptance criteria and references
    ↓
Approve exact requirements revision
    ↓
Scheduler checks project/global permission, dependencies,
global execution slot, workspace handoff and Git status
    ↓
OMP receives immutable ticket/attachment snapshot
and reads applicable verification guidance/maps
    ↓
Investigate → implement → drive affected journeys
    └──────────── bounded fix/recheck on actionable failures
    ↓
Submit criterion receipts + optional sanitized artifacts
    ↓
Submit backlog_result → settle → stop owned work
    ↓
Needs review, never automatic Done
    ├─ Human accepts evidence → Done
    └─ Human requests changes + feedback → Ready for another attempt
```

The scheduler selects tickets; native OMP goal mode continues work within one ticket. There is no additional `/loop` or second scheduler. Only one ticket is active globally, and an observed paused run retains that slot.

Global Settings offers discovered workspace-default model and thinking choices, with explicit OMP defaults. Metadata discovery uses the restricted drafting profile and submits no prompt or goal; its default model can differ from normal execution configuration. Explicit thinking is checked and verified before a fresh run prompts; existing/resumed session thinking is preserved. Saved tickets can now override these defaults for their next fresh attempt; see below and [execution settings](../README.md#execution-model-and-thinking).

The v18.13.1 isolation update was checked against the [upstream v18.12.6…v18.13.1 changes](https://github.com/can1357/oh-my-pi/compare/v18.12.6...v18.13.1): discovery registry/root/plugin loaders remain unchanged, extension loading only adds realpath-based deduplication, and startup configuration still honors the restricted profile. Metadata-only discovery on installed v18.13.1 returned 18 models and exact `openai-codex/gpt-6.1-sol` selection with `off`, `low`, `medium`, `high`, `xhigh`, `max`. No provider inference or real ticket execution was exercised.

Verification for execution selectors: focused settings/drafting/runtime tests passed (24 tests, 332 assertions), and changed-code ESLint passed. A real browser rendered the actual Settings UI with synthetic API responses: model/thinking save, incompatible-level reset, discovery failure/explicit retry and mobile save-control reachability were exercised. Dark/Light desktop and 390px mobile were visually inspected, with no horizontal document overflow or recorded browser runtime errors. UI fixture proof is separate from installed-OMP metadata discovery and does not establish provider inference or real ticket execution.

### Ticket model overrides and context compaction

**Next attempt · model & budget** on a saved ticket provides optional private model/thinking/budget overrides. Model discovery requires an explicit action, not merely opening the ticket. Save confirms scope, retains requirements/revision/approval/status, and does not wake scheduling or retry failed work. A Ready ticket still follows its existing scheduling permission. Unsaved selections prevent panel retry and participate in navigation/reload protection. Active/stopping/paused ticket ownership rejects setting changes; stale settings versions/revisions reject saves and start/retry confirmations. Defaults can be restored without installing anything or modifying global OMP config.

Fresh admission snapshots effective model/thinking, token budget and time limit. Pause/resume preserves that snapshot; it does not silently inherit later global increases. Old runs without a configuration snapshot keep legacy fallback behavior. An exhausted Failed run is stopped: choose/save settings, review partial work and reconcile workspace, then explicitly retry into a fresh session. Switching models cannot resume the old exhausted run or erase consumption. Human Done and other gates remain unchanged.

Run details display formatted cumulative consumption/budget and estimated current context/capacity separately, with actual reported model/thinking, timestamps and native automatic-compaction state. Missing telemetry stays unknown. Native `set_auto_compaction` is enabled and confirmed before execution prompts; OMP owns threshold/method selection. The toggle is session-scoped in supported releases, not a global config write. Native compaction lifecycle events and polled state are surfaced without a second host compaction loop. Compaction can consume tokens and never resets the host's cumulative budget; periodic sampling may overshoot the limit. Context/compaction activity is not completion evidence.

Installed OMP 18.13.3 was reproduced failing the old discovery guard, then passed restricted metadata discovery (18 models) after scoped source review and exact-version support. Unknown versions still reject; diagnostics identify detected versions. See [compatibility scope and primary sources](omp-18.13.3-compatibility.md). Optional-budget blank-to-zero formatting was reproduced by the browser and fixed; clearing now preserves inheritance.

Verification: changed-code ESLint and actual-React/synthetic-API UI checks passed. Covered model/thinking/budget selection, canceled save/navigation, stale-save reconciliation, saved choices/reload, cleared-budget inheritance, separate usage meters, simulated compaction/context reduction without cumulative reset and missing legacy telemetry. Dark/Light desktop/mobile were inspected. UI proof is recorded in the design-language entry. Existing blocker-recovery UI was also re-driven at `/tmp/opencode/blocker-recovery-ui-KORDXe`. Backend/API/guard/protocol regression tests were added or extended, not run under lint-only policy. No live ticket/provider/native compaction, strict TypeScript or build was run; metadata discovery success does not verify those journeys.

#### Optional uncapped cumulative tokens

Global Settings → Run limits and ticket Next attempt settings now expose **No cumulative token limit**. Both require explicit save; enabling a global uncapped default also requires a cost-warning confirmation. Defaults are not changed automatically. Tickets distinguish a numeric cap, explicit `null` (uncapped), and omitted budget (inherit workspace); a finite ticket cap overrides a global uncapped default. Time limits remain mandatory. New admission snapshots the resolved mode; existing runs and paused/resumed snapshots keep their limits. Legacy resumes with progress limits preserve those recorded budgets/deadlines rather than adopting a newly uncapped global default.

Uncapped execution omits the native goal's optional `token_budget`, skips only host cumulative-token exhaustion, and keeps accounting, native automatic compaction, finite deadlines, ownership, blockers/errors, pause controls, evidence and human Done gates. Run usage shows the actual total and explicit no-cap warning, without a finite-budget percentage. No automatic retry, budget reset, scope expansion or guarantee of completion is added. Underlying OMP provider/account or separately configured limits can still stop work.

Added/extended regression coverage for `null` validation/persistence, inheritance/finite overrides, native field omission, over-budget accounting, fixed pause/resume limits and deadline shutdown. These tests were not run under lint-only policy. Real-browser synthetic-API coverage exercised global/ticket confirmation cancellation and save/reload, keyboard controls, restored caps, inherited uncapped warnings, unchanged prior run/time/pause settings, and uncapped usage presentation in Dark/Light desktop/mobile. Final proof is recorded in the design-language entry; this is not backend/runtime/provider/native-compaction verification.

Projects support Paused, Approved tickets only and Automatic start permissions. Automatic is standing permission for eligible revisions, not a waiver of dependency, workspace or completion gates. The separate completion policy below determines who may accept Done. Dependencies always require Done.

Markdown and requirement attachments determine the ticket revision. Changing them invalidates approval. A run retains its immutable snapshot, but proof from an older revision cannot accept newly edited requirements.

### Implementation and verification

Agent instructions require reading applicable project verification skills and relevant feature-map entries, then exercising affected entry points independently. One convenient UI route does not prove alternate routes. The host does not independently attest that the agent followed those instructions.

Agents must respect target repository check policy and time/token limits. Missing required setup or tools remain blocked/unverified; no automatic dependency installation, credential invention or weakened acceptance is authorized. Commissioning this app's verification skill does not commission a skill for every registered project.

### Completion and evidence gates

1. Record checks using `backlog_evidence`, with the exact run revision and criterion.
2. Report `passed`, `failed`, `blocked` or `not_run` honestly. Rechecking the same criterion/feature/entry point/method supersedes its earlier outcome; failures on different journeys remain unresolved.
3. Completion requires reported passing checks for every criterion and no unresolved failed/blocked/not-run checks among those submitted.
4. Submit `backlog_result` with exact revision and criterion-by-criterion evidence.
5. Host waits for settlement and observed owned-child shutdown before Needs review. A command exit, agent yield or success message alone cannot complete a ticket.
6. Human reviews evidence and visual/subjective requirements before Done.

These checks validate submitted coverage and reported outcomes, **not the truth of the reports or exhaustive feature-map coverage**. An agent can still make an unsupported claim; human review remains necessary.

Artifacts support simple png/jpg/txt/json filenames, up to 512 KiB each, 10 MiB per run and 100 receipts. Host records receipt identity/time and artifact bytes/hash, not semantic correctness. Downloads are forced attachments with safe-response headers. There is no automatic proof deletion; retention/deletion policy is separate.

Never submit credentials, cookies, sessions or other secrets as proof. Never upload verification output as requirement attachments: those are inputs, and changing them changes approval/revision. Existing runs without structured receipts remain readable as unverified legacy text evidence.

## Autonomous completion

Explicit project opt-in now extends the same scheduler/native OMP lifecycle; it does not install pstack, add `/loop`, or enable another queue. **Completion** is independent of start permission. Existing projects and runs retain human-reviewed behavior.

### Commissioning and authority

The project header opens a revision-checked completion-policy form. Human review is default. Enabling/recommissioning requires explicit confirmation, Git with a committed attached branch, clean admission, no recorded handoff and no active/paused owner. The owner supplies exact command argv, repository recipe files, command timeout (1–1800 seconds), correction bound (0–2), recovery bound (0–1), and optional exact reviewer model. Recipe file bytes, argv and timeout are hashed at save and checked again at admission and every no-edit phase. Agents cannot rewrite a recipe to make failed verification pass; changed recipe bytes require owner recommissioning.

The standing grant permits only implementation within the ticket, commissioned verification, fresh restricted review, exact local publication and host Done. No push, PR, merge, deployment, dependency installation, generic setup repair or destructive permission is added. Blank reviewer selection snapshots the actual author's model for a separate session; it does not promise cross-family diversity. Author and reviewer sessions, role token totals, current policy revision and ticket revision remain recorded.

### Phases and acceptance

1. Capture a clean baseline and immutable ticket/configuration/policy snapshot. One admitted attempt retains the single global slot across every phase.
2. Author implements and reports concrete criterion/journey receipts plus an exact authored-file manifest. Reports remain claims, not independent proof.
3. Stop and observe author-child exit. Capture raw file bytes/modes into an exact Git candidate tree through a private index; reject unexpected paths, staging, parent/ref drift and unsupported content.
4. Host runs only the commissioned argv, with a durable owned process-group identity before the command begins. Receipt records actual exit/times, candidate/recipe hashes, bounded sanitized output/hash, truncation and host platform/architecture/Bun version. It proves that command's execution, not exhaustive acceptance or a reproducible dependency image.
5. A fresh capability-restricted reviewer has only host-scoped candidate diff/source reads and structured verdict submission. Private audited OMP startup disables discovery/tools/extensions/skills; it does not inherit the author's writable tools. It must inspect diff/source, bind exact tree/session/revision, address every criterion and return Pass / Changes required / Inconclusive. Pass with findings, wrong identity or missing evidence rejects. Insufficient subjective/visual evidence must remain inconclusive.
6. Demonstrated check failures or review findings return to the original author session for bounded corrections. Earlier author checks are invalidated; changed candidates require fresh host checks and independent review. A non-pass host receipt or inconclusive review cannot publish.
7. Host records publication intent and the exact commit object before compare-and-swap of the existing local branch. It takes the index lock, preserves foreign staging, disables hooks/signing and verifies parent/tree/workspace before final index synchronization and Done. No changes means a verified no-op Done, never an empty commit.

All roles retain the attempt's original finite deadline and cumulative session-token accounting. Pausing new starts affects admission only. Pause run aborts host/reviewer/author work, waits for owned exit and retains the slot; host-phase resume repeats no-edit verification/review against the same candidate. Saving Human review revokes future privileged phases. No pause can undo an already-published side effect.

### Bounded recovery and exceptions

Ordinary implementation/check fixes stay within the authorized native goal. The only extra autonomous blocker-recovery cause is `incomplete_verification`: exact criterion evidence must already exist, no submitted failed/blocked/not-run checks or missing permission may remain, and the saved bound permits at most one same-session continuation to finish the original checks. It is not a general install/environment-repair engine. Other blockers, unavailable credentials/authority, ambiguous acceptance, drift, bounds or unknown ownership stop with **Needs assistance** and preserved evidence.

The board/list assistance filter shows those exceptional runs; details retain the exact missing prerequisite, attempted outcomes, candidate, role/review/check history and publication state. Existing reviewed recovery/retry and operator reconciliation remain the explicit escape path. A retry is a new authorized attempt, not blind replay or a budget reset within the old attempt.

### Publication recovery and workspace limits

After restart, process identity/exit is reconciled before releasing ownership. An already-published commit with the exact durable intent, parent/tree/ref and safe index can be finalized without another commit or author replay. An unpublished intent does not automatically replay a ref mutation. Ref/index/worktree drift, changed policy/recipe, foreign locks or uncertain partial publication require operator assistance; partial work and commits are preserved.

Conservative opt-in limits: 100 changed paths, 128 KiB per changed/recipe text file, 512 KiB aggregate review content; 8 MiB per unchanged tracked file and 64 MiB aggregate tracked snapshot. Sensitive/binary changed files, symlinks/hardlinks/submodules, custom Git filters/working-tree encodings, conflicted/split/flagged indexes, detached/unborn branches and unsupported content fail closed. Host check output is retained to 60 KiB with explicit truncation. Reviewer reads are bounded UTF-8 candidate blobs, not arbitrary filesystem paths or shell commands.

This is **not an OS sandbox or authorship attestation**. Author/check commands run as the backend user. Clean admission, declared paths and exact no-edit hashes cannot identify a simultaneous external edit to the same declared path during authoring. Keep external writers/Git operations idle. Ignored/external state and arbitrary secret disclosure remain outside Git proof; redact recognized patterns but never supply secrets. Host exit-zero and a model pass cannot establish unexercised browser/provider/security behavior.


## Human review and corrective attempts

**Accept evidence → Done:** accepts only the current revision's run evidence. This releases dependency eligibility, not commit/merge/deploy permission or a workspace handoff gate.

**Request changes:** enter specific missing behavior or evidence. Blank feedback cannot be submitted; cancel leaves status unchanged. Confirmation returns the ticket to Ready, retaining the revision's approval. Feedback stays on the reviewed run/revision; later authorized attempts receive it, with older-revision context identified when applicable.

A new attempt still needs safe workspace handoff, execution permission, satisfied dependencies and the global slot. Status Ready is not a promise of immediate execution.

## Operator reconciliation

Default/exception policy: **operator-controlled reconciliation**, not blanket automatic commits or per-ticket worktrees. Explicit autonomous completion above is the narrow host-publication exception; the confirmed operator commit remains available for other work.

A project-level gate is recorded when initial admission finds Git changes, a stopped run leaves changes, interrupted-run recovery finds changes, or required Git inspection is unavailable. It blocks that project's new starts without consuming every queued ticket as a synthetic blocked run. Other projects can still use the global slot.

Home displays a warning. The project page shows the gate, affected files, originating run when available, and recovery instructions.

1. Review evidence, partial work and unrelated edits. Preserve them.
2. Reconcile in your terminal, or choose **Review & commit**: inspect HEAD-to-working-tree diffs/modes, select files, enter a message, review the exact selection, then explicitly Confirm commit. Selected working-tree versions replace any staged versions for those files; unselected staged/unstaged work is preserved. No push/reset/stash/worktree deletion or automatic agent commits. See [operator commit limits](../README.md#operator-controlled-local-commits).
3. Choose **Recheck workspace** and confirm. This performs authenticated, CSRF-protected Git inspection with optional locks disabled.
4. Only a clean observed workspace outside `.omp-backlog/`, with no running/stopping/paused work owning that workspace, can release the current gate. Stale gate IDs, dirty state and unavailable inspection are rejected.
5. Existing project/global permissions, dependencies and retry rules still apply. Clearing the gate may allow eligible queued work to start.

**Done, switching execution modes, and merely becoming clean do not clear a recorded gate.** Previously blocked tickets still require explicit retry. The scheduler checks Git again before each new start.

Git ignore rules still apply: this is not proof about ignored files or a security sandbox. Non-Git projects have no Git handoff/changed-file guarantee. Operator commits remain behind authentication/CSRF, revision-bound review, exclusive workspace-operation/index locks, and no owned run. Successful commit leaves the gate intact and does not wake the scheduler. No reconciliation of this repository or expense-tracker was performed while implementing this action; authorized commit checks use disposable repositories only.

## Blocked, failed, paused and interrupted work

- **Blocked:** submit partial evidence, exact unavailable prerequisite and required unblock action. Host pauses/stops continuation without falsely completing the goal. Preserve work and explicitly retry after resolving the prerequisite; dependents remain ineligible until Done.
- **Failed:** provider/check/execution errors or exhausted time/token budgets require review and explicit action. Limits are not silently increased.
- **Paused:** stops continuation, not side effects. Paused work retains the global slot; resuming preserves session/snapshot. Canceled questions remain unanswered, not consent.
- **Interrupted:** recovery checks surviving process identity/liveness before releasing ownership. Inspect partial work and explicitly retry; mutating actions are not automatically replayed.

### Reviewed blocker recovery

Open the blocked ticket directly, through board Actions, or by dragging it toward Ready. The latter two routes open the recovery panel without changing queue order/status. Review the prerequisite, agent-suggested fix, attempts, permission/check plan, partial evidence and source run. Optional structured details are agent reports; older runs remain readable and show missing details honestly.

Edit **Recovery instructions** and **Save recovery note**. This saves a bounded, sanitized note on the private source run only; it does not edit requirements, grant approval, wake scheduling or release workspace handoff. Concurrent note changes and revision edits reject stale submissions. Unsaved text participates in ticket navigation/reload protection; an explicit current-note reload supports reconciliation after errors.

Choose **Review fix & retry**, inspect the exact saved instructions and current revision, then confirm **Approve revision & retry**. The host saves the reviewed note and Ready/approval state together. Editing requirements requires saving/reviewing a new note. Generic approval/retry cannot bypass recovery for a Blocked ticket or an edited Draft whose current source run is Blocked. Fresh admission snapshots only the exact-revision reviewed note, source identity, blocker, partial evidence and changed-file summary. It supplies that context separately from human change requests; earlier evidence is not automatically counted as passing.

This addition does not change within-ticket remediation budgets, installation permission, explicit retry policy, dirty-workspace reconciliation or human-only Done. A recovery prompt is not an executable recipe, an authorization override, independent verification or sandboxing.

Verification for this addition: changed-code ESLint passed. Actual React UI with a synthetic API exercised note save/reload, unsaved-close cancellation, retry cancellation, stale-note rejection/current-note reload, confirmation payload and independent panel/Actions/native-drag entry points. Dark/Light at 1440px and 390px were inspected without document/drawer horizontal overflow or recorded browser runtime errors. Final proof: `/tmp/opencode/blocker-recovery-ui-krZoQW`; earlier visually inspected proof: `/tmp/opencode/blocker-recovery-ui-fq6ep5`. Backend/API/persistence and protocol handoff regression tests were added but not run under lint-only policy; no real backend, ticket execution or live provider was exercised by this UI check.

Project/global pause prevents new starts; it does not stop an already active run. Use run pause to interrupt that work. Closing the browser does not stop execution.

## Safety and current limits

- Human-reviewed projects retain human Done. Autonomous projects require commissioned host checks plus exact-candidate independent review and local publication; subjective acceptance without sufficient evidence stops.
- Ticket agents cannot commit. Only explicit autonomous host publication or a confirmed operator commit grants local commit authority. Stash/reset/push/PR/merge/deploy/destructive actions remain separately unauthorized.
- Owner sessions, CSRF, Host/Origin checks and private storage protect dashboard access. OMP author/check processes run with backend OS-user permissions; registered projects are not sandboxes.
- Agent receipts, host execution receipts and independent review judgments have separate provenance. Hashes do not prove semantic correctness or exhaustive coverage.
- Feature maps cover starter paths, not every feature. Each target project needs its own commissioned recipe.

## Verification performed

Implementation verification passed:

- ESLint for changed code; earlier core-slice verification also ran full-project ESLint.
- Focused deterministic suite: **15 tests, 153 assertions**, including evidence/access/integrity, blocked shutdown, feedback handoff and operator reconciliation. These counts describe the recorded implementation check, not a continuously refreshed CI status.
- Isolated browser journeys for login, project registration, ticket creation/approval/invalidation, receipt download, and review feedback through ticket panel, Actions and drag independently.
- Disposable Git/browser/protocol-fixture checks for canceled/dirty/clean rechecks, preserved synthetic output, gate persistence and retained global pause.
- Diff whitespace check; owned-process cleanup completed and private proof survived.

See [commissioning receipts](../.omp/skills/verify-backlog/features/README.md#commissioning-receipts) for paths and scope. Fixture reconciliation preserved generated files outside its disposable repository; no commits, stashes or resets were used, even in fixtures.

**Not established by the earlier execution/review checks:** live OMP ticket implementation, exhaustive feature-map coverage, independently observed agent checks, or permanent correctness after later edits. Those earlier delivery checks did not run strict typecheck or production build. The later optional-drafting addition above did pass strict TypeScript and live-provider drafting; that does not verify implementation execution. Passing a protocol-speaking child is not provider availability proof.

### Autonomous lifecycle verification

Implemented path was exercised with an authenticated disposable instance and deterministic OMP protocol peers, not a real provider. Explicit policy commissioning left start permission unchanged; an approved ticket ran an actual host check, a fresh restricted nonauthor reviewer, exactly one local publication and host Done. The resulting local commit was `6f9fc92c326a71529f402a201a838e55d843f8ff` in the disposable repository only. A dependent permission-blocked ticket stopped with assistance and no publication. Global starts were paused afterward, completion authority was returned to Human review, both runs had no owned PID, and the owned browser/server were stopped.

Focused regression command covered `server/autonomy.test.ts`, `server/autonomy-runtime.test.ts`, `server/autonomy-policy.test.ts`, `server/transcript.test.ts`, `src/completionPolicy.test.ts` and `src/lifecyclePresentation.test.ts`: **53 passed, 0 failed, 333 assertions**. Coverage includes exact-tree publication/no-op, drift/staging/recipe changes, policy revocation, bounded corrections/recovery, same-author continuation, independent review validation, cumulative role limits, host-phase pause, process-group shutdown and publication crash reconciliation. Full-project ESLint and strict TypeScript passed. No production build ran.

Full Bun suite was **169 passed, 5 failed**; it is not green. Three existing tests (`execution`, `recovery`, `board-api`) supply descriptions rejected by current ticket validation; two assisted-publication assertions compare LF strings against multipart values normalized to CRLF by Bun 1.4.4. The initial run also exposed a real quadratic redaction path on long output; token-boundary matching fixed it without weakening redaction, and the focused regression passed. Restricted fixture launchers explicitly select embedded Bun runtime mode, preserving the audited OMP version gate.

Actual browser checks covered canceled opt-in, committed policy persistence, normal modal dismissal, canceled unsaved-close with retained draft, reachable mobile actions, keyboard evidence expansion, assistance filtering, and cross-tab revocation/stale-form protection. Kanagawa/Light at 1440px and 390px were inspected. Browser-discovered duplicate sibling keys and mobile grid clipping were corrected and rechecked. This is exercised UI/protocol behavior, not live-provider execution, exhaustive accessibility or acceptance coverage.

Original private captures were written under `/tmp/omp-autonomous-browser-5EJXDe/proof`; that scratch path was unavailable after session resumption. Screenshots and observed results remain in the session transcript; no currently retained filesystem artifact or live-provider proof is claimed. No registered project was enabled and no commit was made in this application repository.


## Next adoption stages

1. Broader commissioned verification/environment provenance: current host-command receipts establish actual execution and candidate/recipe identity, not exhaustive coverage or a reproducible dependency image.
2. Explicitly authorized real OMP/provider smoke in a disposable project.
3. Full feature-map maintenance, with unverified prerequisites clearly recorded.
4. Opt-in onboarding and proven verification recipes for other registered projects.

Broader playbooks and external automation remain separately scoped. Autonomous completion is implemented only under the explicit local policy above; this guide grants no additional execution or external-write permission.
