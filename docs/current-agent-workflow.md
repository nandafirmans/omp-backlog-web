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
| Blocker recovery handoff | Blocked ticket panel retains structured agent suggestions and editable private recovery notes. Explicit retry binds the current revision, source run and saved note for a fresh attempt. Separately opted-in autonomous projects may authorize bounded same-attempt engineering recovery under the gates below. Neither path grants installation or new permissions. |
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
available capacity, physical workspace ownership, handoff and Git status
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

The scheduler selects tickets; native OMP goal mode continues work within one ticket. There is no additional `/loop` or second scheduler. Global capacity defaults to 1 and accepts 1–4 in Settings. Only independent repositories may run concurrently. Running, stopping and paused owners retain slots; aliases, overlapping paths and shared Git common directories remain mutually exclusive. See [Phase 6 ownership and isolation](phase-6-concurrent-execution.md).

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

Fresh configurations default to **Standard OMP**: ordinary native tools and goal continuation implement the ticket directly, with applicable project-local verification skills. pstack need not be installed. Existing persisted settings without an engineering-mode field retain **OMP + pstack**, preserving the previous workflow rather than silently changing it.

Global **Settings → Engineering Mode** selects Standard OMP or OMP + pstack. Saved ticket **Next attempt · mode, model & budget** offers Inherit global, Standard OMP and OMP + pstack. Admission snapshots the effective choice alongside model/thinking, token cap and time limit. Run details, Usage and ticket execution history display that immutable mode. Changing defaults never changes admitted work. Same-session pause/resume, correction and incomplete-verification recovery retain mode, investigation, cumulative accounting and the original deadline.

Only pstack runs check the actual author RPC session's `get_available_commands` for native `skill:poteto-mode` and `skill:pstack-pi`, and `get_state.dumpTools` for `task`. Missing/disabled capabilities stop before implementation prompts or goals. A fresh pstack author submits `/skill:poteto-mode` once; the host observes its prompt-bound native `custom` / `skill-prompt` record and retains the resolved router path. Same-session continuations recheck availability without routing again. No fallback, plugin installation or global OMP configuration change occurs.

The pstack router selects its installed engineering playbook; author instructions require an explicit `skill://pstack-pi` read. Standard instructions instead prohibit invoking or reading poteto-mode, pstack-pi and their playbooks, including explicit references in ticket text, attachments or other skills. A requirement that actually needs pstack is a mode conflict to report as blocked, not permission to switch. Other project skills remain enabled. This boundary is an author instruction plus conditional native dispatch, not a sandbox preventing an untrusted author from calling its ordinary tools.

Both modes receive the same host authorization/evidence contract. Native OMP owns goal continuation and compaction; the scheduler, fixed limits, host verification, fresh restricted acceptance reviewer, guarded local publication and Done gates remain unchanged. Drafting and restricted acceptance review do not load the engineering router.

A separately operator-reviewed blocker retry still creates a new authorized attempt with fresh checks, not a resumed exhausted session. Its recovery context pins the source run's engineering mode, including legacy pstack, even after global or ticket mode edits and backend restart. It never switches methodology to bypass a capability failure. Autonomous same-attempt recovery/correction never resets consumption or limits. The bounded blocker-repair extension below preserves these rules. Adaptive mode escalation remains out of scope.

Usage presents cumulative accounted tokens, including recorded independent reviewer sessions without double counting. Input/output/cache accounting is not provider billing or a monetary spending cap; missing usage remains unavailable. Enabling pstack does not increase budgets or alter model/thinking overrides. Observed router/playbook reads establish tool activity, not methodology compliance or acceptance.

Agent instructions require reading applicable project verification skills and relevant feature-map entries, then exercising affected entry points independently. One convenient UI route does not prove alternate routes. The host does not independently attest that the agent followed those instructions.

Agents must respect target repository check policy and time/token limits. Missing required setup or tools remain blocked/unverified; no automatic dependency installation, credential invention or weakened acceptance is authorized. Commissioning this app's verification skill does not commission a skill for every registered project.

#### Engineering mode verification, November 6, 2026

- Final focused protocol/API coverage passed **64 tests** across `runtime-integration`, `autonomy-runtime`, `execution`, `settings-api` and `recovery`. Covered capability failures, direct Standard execution with/without pstack, explicit skill references, inheritance/override validation, legacy settings/sessions, pause/resume, correction/recovery, restart, mixed-mode repositories, cumulative exhaustion and host acceptance/publication. A later focused recovery-context check passed **3 tests**; it is overlapping coverage, not three additional distinct tests.
- Installed OMP **18.16.0** discovery/isolation checks passed **5 tests**: `OMP_BACKLOG_NATIVE_TESTS=1 bun test server/engineering-native.test.ts server/restricted-native.test.ts`.
- Live-provider checks passed **6 tests** in two invocations: the four paired `server/engineering-live.test.ts` lifecycles, then Standard with extensions disabled and `server/concurrency-live.test.ts` mixed-mode overlap. Standard did not record router invocation or pstack reads. The extension-disabled control changed only its disposable author's launch flags, not installed/global configuration.
- Both autonomous greeting runs passed actual host commands, distinct-session restricted acceptance review and guarded local publication, with owned work stopped before Done. Human runs stopped at Needs review. The test independently executed both greeting outputs after each lifecycle.
- Changed-code ESLint and strict `tsc --noEmit` passed. Initial protocol failures were fixture errors: revision-less ticket overwrite, missing permitted scratch root, and survivor processes without author-prompt arguments. Corrected before the passing run. Initial TypeScript fixture literal/optional-field errors were corrected. No production build ran.

Equivalent greeting tickets used `openai-codex/gpt-6.1-sol`, thinking `low`, identical criteria, explicit 600,000 accounted-token caps and four-minute deadlines. These are single observations per mode/policy, not billing totals or guaranteed percentage savings:

| Completion policy | Engineering mode | Accounted author tokens | Accounted reviewer tokens | Accounted total | Outcome |
| --- | --- | ---: | ---: | ---: | --- |
| Human | Standard | 258,181 | Not commissioned | 258,181 | Needs review |
| Human | pstack | 465,641 | Not commissioned | 465,641 | Needs review |
| Autonomous | Standard | 304,582 | 13,996 | 318,578 | Done |
| Autonomous | pstack | 578,964 | 14,174 | 593,138 | Done |

Paired proof: `/tmp/omp-engineering-standard-live-rmhruq/proof.json`, `/tmp/omp-engineering-standard-live-UzW7lF/proof.json`, `/tmp/omp-engineering-pstack-live-NMbytq/proof.json`, `/tmp/omp-engineering-pstack-live-lEA7uI/proof.json`. Both autonomous candidates had the same tree `6ff44c5b9958594be153d55cf8804fd2c4763f36`; their disposable publication commits were `8a52a55370b7fb22aa1f4b47b972a0b2f46e5274` and `936692ea8738cdf49329f0d2e28586aca0ccbf35`.

Extension-disabled Standard proof: `/tmp/omp-engineering-standard-live-hJfaaG/proof.json` (Needs review, 244,339 accounted tokens). Concurrent mixed-mode proof: `/tmp/omp-concurrency-live-jRTJNk/proof.json` (distinct live processes/sessions observed together; both stopped at Needs review with repository-specific evidence). No production-ticket execution, source-repository commit, push, PR, deployment or global OMP change occurred.

These successful greeting samples all exceeded the unchanged 100,000-token new-store default. They do not establish that default as sufficient for either mode. No cap was automatically raised or reset within a run.

Frontend verification used actual React/styles in isolated Chromium with synthetic APIs, separate from backend/native proof. Settings/ticket mode save/cancel/inheritance, unsaved-navigation/restore, active-owner disabling, legacy labels, immutable history and author/reviewer totals were exercised. Tokyo Night/Light desktop and 390px mobile were inspected without document overflow or recorded runtime errors. Helper contrast measured 6.43:1 dark and 6.04:1 Light. Private UI proof: `/tmp/omp-engineering-ui-mQQjTW/result.json`; [requested AFTER audit](../anti-slop/audit-001-2026-11-06.md).

Remaining limits of the Phase 7.1 evidence above include exhaustive feature-map/provider/playbook/theme/accessibility coverage, native-compaction triggers, and live pause/correction/blocker-restart journeys. Those continuation paths have protocol coverage, not live-provider proof. General blocker repair was not part of that checkpoint. Reviewed pstack restart context retains previously observed `skill://poteto-mode/playbooks/*.md` reads; legacy runs without those observations cannot recover an unrecorded selected playbook.


#### Phase 5 verification, November 5, 2026

Baseline was clean `main` at `652d5d746f7c87b395a802dbc35f2c9aee5849f1`. Installed OMP was 18.16.0. Separate installation inspection found enabled `pstack-pi` 0.15.36-pi.1; installed router/adapter bytes matched the local intended fork. Runtime provenance records only OMP's observed invocation path and tool reads, not an invented package revision or adherence claim.

The installed-version audit found and reproduced an existing restricted-startup ancestor-plugin import gap. The private working directory now has its own empty `.omp` namespace anchor as well as `.git`. Exact 18.16.0 support was added only after source review and real positive/negative executable-import controls. Reviewer plugin discovery was not enabled. See [compatibility evidence and source links](omp-18.16.0-compatibility.md).

Executed checks:

- Focused runtime, autonomy, admission, execution-settings, drafting, and API regressions passed **67 tests**, with six opt-in native/live tests skipped in the ordinary run. Exact command files are `runtime-integration`, `autonomy-runtime`, `runtime`, `acceptance`, `execution`, `drafting`, `drafting-api`, `engineering-native`, `engineering-live`, and `restricted-native`, all under `server/` with `.test.ts`.
- `OMP_BACKLOG_NATIVE_TESTS=1 bun test server/engineering-native.test.ts server/restricted-native.test.ts` passed all five installed-OMP RPC tests. Controls cover installed/disabled/missing pstack, project-local skill compatibility, native task discovery, and ancestor-plugin import isolation.
- `OMP_BACKLOG_LIVE_TESTS=1 bun test server/engineering-live.test.ts` passed its bounded real-provider implementation test. It independently executed both CLI outputs after the run, in addition to inspecting author receipts and the stopped Human Needs review state.
- Changed-code ESLint and strict `tsc --noEmit` passed. No production build or new browser/UI check ran. Existing frontend architecture was unchanged.

Real runtime/provider observations used disposable repositories and private data, `openai-codex/gpt-6.1-sol`, thinking low, four-minute per-attempt deadlines, and finite cumulative token caps:

| Journey | Observed playbook read | Final state | Host verification | Fresh restricted acceptance review | Publication |
| --- | --- | --- | --- | --- | --- |
| Human-reviewed greeting fix | Bug fix | Needs review, no owned PID | Not commissioned | Not commissioned | None |
| Autonomous T001 greeting fix | Bug fix | Done, no owned PID | Passed, exit 0 | Pass on exact candidate, distinct session | One guarded local commit |
| Dependent autonomous T002 read-only explanation | Investigation | Done, no owned PID | Passed, exit 0 | Pass on exact candidate, distinct session | Verified no-op, no empty commit |

Human proof is retained at `/tmp/omp-engineering-live-tucYP2/proof.json`. Autonomous proof is `/tmp/backlog-pstack-autonomous-live-8pQ0nH/proof.json`. T002 admission occurred after T001's recorded finish. The disposable completion commit is `0b0255f545b3bdf288a87e8bd79a773dccc79a53`, on candidate tree `9af3890cabba49e65aa8bc4daa9b97515ac484af`; the final worktree was clean. The application repository was not committed, and no push, PR, merge, deployment, installation, or production-ticket execution occurred.

The runtime review passed its implementation/lifecycle slice. The later security/compatibility review passed the corrected private-namespace and exact-version changes. Final test-contract and evidence reviews covered their assigned test/proof scopes. These are complementary scoped judgments, not independent full-generation audits or a claim of model diversity. Parent-executed checks remain separate from those judgments and from author claims.

Earlier experiments caught an incorrect prompt-acknowledgement assumption and native whitespace normalization before delivery. A 120,000-token synthetic attempt reached its existing cumulative accounting limit and stopped; successful later experiments used fresh disposable attempts capped at 600,000. The unchanged new-store default is 100,000 cumulative tokens, including cache accounting. These successful smokes do not establish that the default cap is sufficient for pstack. Review the existing ticket budget explicitly before regular execution; no automatic increase was made. No failed attempt was silently replayed or had its budget reset.

This does not establish every playbook, provider, browser acceptance journey, real native-compaction trigger, live pause/correction/blocker scenario, or exhaustive feature-map coverage. Those continuation and exception paths have protocol coverage, not live-provider proof. The full Bun suite was not rerun for Phase 5. The historical full-suite result below remains separate; this work repaired the invalid execution-settings fixture and removed the incidental pre-multipart Markdown equality assertion from the drafting scheduling test without changing application validation.

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

1. Capture a clean baseline and immutable ticket/configuration/policy/workspace snapshot. Each admitted attempt retains its slot and physical workspace ownership across every phase.
2. Author implements and reports concrete criterion/journey receipts plus an exact authored-file manifest. Reports remain claims, not independent proof.
3. Stop and observe author-child exit. Capture raw file bytes/modes into an exact Git candidate tree through a private index; reject unexpected paths, staging, parent/ref drift and unsupported content.
4. Host runs only the commissioned argv, with a durable owned process-group identity before the command begins. Receipt records actual exit/times, candidate/recipe hashes, bounded sanitized output/hash, truncation and host platform/architecture/Bun version. It proves that command's execution, not exhaustive acceptance or a reproducible dependency image.
5. A fresh capability-restricted reviewer has only host-scoped candidate diff/source reads and structured verdict submission. Private audited OMP startup disables discovery/tools/extensions/skills; it does not inherit the author's writable tools. It must inspect diff/source, bind exact tree/session/revision, address every criterion and return Pass / Changes required / Inconclusive. Pass with findings, wrong identity or missing evidence rejects. Insufficient subjective/visual evidence must remain inconclusive.
6. Demonstrated check failures or review findings return to the original author session for bounded corrections. Earlier author checks are invalidated; changed candidates require fresh host checks and independent review. A non-pass host receipt or inconclusive review cannot publish.
7. Host records publication intent and the exact commit object before compare-and-swap of the existing local branch. It takes the index lock, preserves foreign staging, disables hooks/signing and verifies parent/tree/workspace before final index synchronization and Done. No changes means a verified no-op Done, never an empty commit.

All roles retain the attempt's original finite deadline and cumulative session-token accounting. Pausing new starts affects admission only. Pause run aborts host/reviewer/author work, waits for owned exit and retains the slot; host-phase resume repeats no-edit verification/review against the same candidate. Saving Human review revokes future privileged phases. No pause can undo an already-published side effect.

### Bounded recovery and exceptions

Autonomous recovery extends the admitted run, not scheduler admission. Human-reviewed projects still stop on blockers and never gain automatic commit authority. Operator-reviewed **Review fix & retry** remains a separate, newly authorized attempt.

| Observed failure | Host decision | Existing allowance |
| --- | --- | --- |
| Incomplete original verification | Preserve the narrow criterion-evidence and no-permission gate. Continue only the original missing checks. | Shared `maxRecoveries`, at most 1 |
| Author-reported engineering blocker | Stop and account the original author, capture its exact candidate, and reproduce the failure with the commissioned recipe. Require a concrete scoped engineering diagnostic before authorizing repair. | Same shared `maxRecoveries`, at most 1 |
| Failed host verification after a complete author report | Retain the actual command receipt and return demonstrated findings to the original author. | Shared `maxCorrections`, at most 2 |
| Restricted reviewer changes required | Retain the independent findings and return them to the original author. | Same shared `maxCorrections`, at most 2 |
| Inconclusive review or unavailable authority | Preserve evidence and require assistance. | No author continuation |
| Explicit temporary failure of a read-only RPC observation | Retry only allowlisted reads with bounded backoff and durable observations. Never replay a provider turn, timeout, transport uncertainty, or mutating command. | Separate observation history, no extra author allowance |

Agent `recoverableCause` and `failureCategory` fields are suggestions, not authority. Credentials, permissions, dependency installation, unclear requirements, destructive or external operations, unavailable infrastructure, exhausted budgets, and ineffective repairs require assistance. A failed commissioned command alone does not prove that source repair is authorized. Unknown or unsupported diagnostics remain blocked.

`Lifecycle.recoveryHistory` retains the original blocker, evidence and agent receipts, source and category, candidate-bound failure fingerprint, candidate-independent diagnostic fingerprint, existing allowance and ordinal, host instructions, dispatch state, observed work, linked host checks and reviews, accounted tokens, elapsed time, and outcome. Reservation and counter consumption persist before author continuation. Duplicate submissions do not authorize another repair. Pausing an authorized repair retains its instructions and allowance. An interrupted initial blocker-reproduction command cannot be resumed automatically. Cancel, reconcile the workspace, and explicitly authorize a reviewed retry instead. Restart preserves uncertain work for reconciliation and never replays a repair.

Repairs retain the original run, immutable revision, author session and session file, engineering mode, deadline, and cumulative author plus reviewer accounting. Admission requires at least 6,144 remaining tokens and the commissioned verifier timeout plus 105 seconds. Active or paused repairs preserve 4,096 tokens and the verifier timeout plus 45 seconds for final checks and review. These are conservative eligibility reserves, not guaranteed completion estimates. No cap increases, session resets, deadline extensions, or exact monetary spending guarantees are added. The author reuses existing investigation and pstack context where selected rather than restarting broad analysis.

Repeated normalized diagnostics stop ineffective repair even when a candidate changes cosmetically. Different failures do not reset the overall bounds. Current author evidence is invalidated before continuation; historical receipts remain inspectable but cannot accept the new candidate. Completion still requires fresh original host checks, a fresh restricted nonauthor review, exact-candidate guarded publication, and observed owned-work shutdown before Done.

Run Evidence and the blocked-ticket panel show recovery history, failure category, original blocker, latest observed action, latest host result, attempt token consumption, and **Recovered / Still blocked / Needs assistance**. Operator-provided recovery notes remain separate and are not overwritten. The board/list assistance filter and explicit workspace reconciliation remain available.

### Phase 7.2 verification

- Complete deterministic suite passed with `bun test`: 287 passed, 11 skipped, zero failures across 34 files. Strict TypeScript (`bun run typecheck`) and full-project ESLint (`bun run lint`) passed. The skips retain existing opt-in provider/native boundaries.
- Disposable process/Git fixtures exercised both engineering modes through host-reproduced blocker repair, original-session continuation, fresh host checks, restricted independent review, one guarded local commit and Done. Negative fixtures covered prerequisites, shared bounds, ineffective repairs, fixed budgets, revoked policy/revision, stale evidence, manual recovery, human completion policy and independent repositories.
- Teardown accounting fixtures observed final author and reviewer usage after cancellation. A restart fixture also restored the persisted dispatched-run snapshot after owned-child cleanup and proved reconciliation did not launch another author. This is a deterministic crash-window simulation, not a backend SIGKILL experiment.
- Real Chromium exercised the actual React run and blocker panels using synthetic intercepted API data. Dark and Light passed at 1,440 and 390 pixels without document overflow. Native Enter/Space disclosure, attempt token display, all recovery outcomes and manual retry cancellation preserved the operator note. Synthetic API screenshots are UI evidence, not backend/provider lifecycle proof.
- Separate source correctness and security reviews passed after fixing diagnostic-scope authorization and final role-accounting defects. Review judgments are distinct from executed checks. No live-provider tests, production build, project commit, PR, push, merge or deployment were performed. The 100,000-token production default is unchanged.

#### Real-provider recovery validation, November 7, 2026

Validation is **INCONCLUSIVE**, not a live recovery pass. Baseline application HEAD was `0ecff9c30298f2b0377e690aa51b642e711e645f` with a clean working tree. Installed OMP reported `18.18.0`; the existing restricted-review startup guard accepts only audited `18.12.6`, `18.13.1`, `18.13.3` and `18.16.0`. The actual guard rejected `18.18.0` with HTTP 503 before model discovery or any author inference. No version spoofing, guard bypass, installation, methodology switch or repeated provider attempt occurred.

`OMP_BACKLOG_LIVE_TESTS=1 bun test server/recovery-live.test.ts` now prepares a disposable committed TypeScript CSV module, unchanged verification recipe, approved two-criterion ticket and explicit autonomous policy. It uses Standard, `openai-codex/gpt-6.1-sol`, low thinking, one slot, a fixed 500,000-accounted-token cap, ten-minute deadline and one correction plus one recovery allowance. The scenario requires correct CSV encoding and independent parsing, covering delimiters, escaped quotes, LF/CR, whitespace and empty fields. It never instructs the author to leave a defect or invent evidence. First-attempt completion without host-managed engineering repair is reported as partial validation, not recovery success.

Observed setup check exited 1 with `AssertionError: csv.ts encodeRow assertion failed`. This is a baseline engineering failure, **not** a provider-backed author failure or host-managed recovery. Private proof and isolated SQLite data remain at `/tmp/omp-recovery-live-aThBjU/proof.json` and `/tmp/omp-recovery-live-aThBjU/private`. The database contains one repository and one approved Ready ticket, with zero Runs. Initial disposable commit: `7aa3f5a312163c33169efae0a421cbf9976ff4e7`. No completion commit exists.

Preflight/scenario setup took 159 ms. Initial author, repair and reviewer consumption were all zero; all 500,000 tokens remain. Authentication and actual model availability were not established. Author continuation, recovery classification/history, fresh host verification, independent reviewer Pass, publication and automatic Done remain unverified with a real provider. Host-verification, author-reported-blocker and reviewer recovery sources remain distinct and none gained live proof here. Unblocking requires an already-audited installed executable or a separately reviewed compatibility/isolation audit for the new OMP version; simply adding a version string is insufficient.

Strict TypeScript and full-project ESLint passed; after adding the opt-in test, TypeScript and changed-file ESLint passed again. The new test skips without the opt-in environment variable. Requested `bunx vite build` passed with the existing large-chunk warning (over 500 kB); no bundle optimization was attempted. The opted-in test itself failed at the genuine version guard, not at recovery execution. No confirmed application recovery defect was established, and production code/defaults were left unchanged.

The first combined deterministic command exceeded its 300-second shell deadline without returning test totals. Subsequent smaller batches all passed: 66 tests/352 assertions across `autonomous-recovery`, `recovery`, `runtime`, `rpc-retry`, `autonomy` and `autonomy-policy`; 35 tests/373 assertions in `runtime-integration`; 54 tests/830 assertions in `autonomy-runtime`. Total: **155 passed, 1,555 assertions, zero failures** across eight files. Negative cases include unauthorized prerequisites, revoked policy/revision, exhausted shared allowances and budgets, protected reviewer reserves, ineffective repairs, pause/resume and interrupted/restarted mutation without replay. These are deterministic process/Git checks, not provider evidence.

#### OMP 18.18.0 compatibility assessment, November 7, 2026

The later source and native compatibility assessment keeps **18.18.0 blocked**. Real installed startup/discovery controls and independently executed extension/custom-tool/ancestor-plugin sentinels passed. A native imported-journal accounting probe found that identical known usage totals 146 on the active branch but zero as off-branch discarded-turn usage, including the final RPC sample. The statistics implementation is unchanged from 18.16.0; upstream's improved durable journal does not make `get_session_stats` cumulative across branches or context windows.

This is an existing token-accounting limitation, not a regression caused by the release under review. The API can omit consumed tokens from discarded responses outside the active conversation, so reported totals cannot establish complete lifetime token consumption. Token statistics alone do not establish provider billing.

The allowlist, restricted reviewer authority, original session/mode, token caps, deadlines, correction/recovery allowances, and CSV live scenario remain unchanged. Direct native model metadata includes `openai-codex/gpt-6.1-sol` and `low` thinking, but the application's live preflight still rejects the installed release. No provider-backed implementation or recovery was attempted. See the [exact source comparison, proof tiers, verification results, and actionable unblock requirements](omp-18.18.0-compatibility.md).

Phase 7.3 audited author/reviewer sampling, limits/reserves, same-session recovery, shutdown, restart persistence and consumed-token display. The current implementation persists sampled maxima/latest statistics, not unique lifetime usage events. `get_entries` exposes off-branch records and rejects unknown cursors, but cannot establish complete consumption: native skill-description compression meters only cost without durable token receipts, discarded assistant replacement records get new IDs, and child transcript observability is not a durable exhaustive ledger. No partial adapter, private SDK import, fork, cap increase, security-boundary change or 18.18.0 enablement was introduced. See [source evidence, cursor/deduplication rules and proposed upstream capability](omp-18.18.0-compatibility.md#phase-73--cumulative-accounting-feasibility). Earlier “cumulative” UI/proof descriptions report application counters, not a newly proven lifetime guarantee; Phase 7.2 live recovery remains blocked.




### Publication recovery and workspace limits

After restart, process identity/exit is reconciled before releasing ownership. An already-published commit with the exact durable intent, parent/tree/ref and safe index can be finalized without another commit or author replay. An unpublished intent does not automatically replay a ref mutation. Ref/index/worktree drift, changed policy/recipe, foreign locks or uncertain partial publication require operator assistance; partial work and commits are preserved.

Conservative opt-in limits: 100 changed paths, 128 KiB per changed/recipe text file, 512 KiB aggregate review content; 8 MiB per unchanged tracked file and 64 MiB aggregate tracked snapshot. Sensitive/binary changed files, symlinks/hardlinks/submodules, custom Git filters/working-tree encodings, conflicted/split/flagged indexes, detached/unborn branches and unsupported content fail closed. Host check output is retained to 60 KiB with explicit truncation. Reviewer reads are bounded UTF-8 candidate blobs, not arbitrary filesystem paths or shell commands.

This is **not an OS sandbox or authorship attestation**. Author/check commands run as the backend user. Clean admission, declared paths and exact no-edit hashes cannot identify a simultaneous external edit to the same declared path during authoring. Keep external writers/Git operations idle. Ignored/external state and arbitrary secret disclosure remain outside Git proof; redact recognized patterns but never supply secrets. Host exit-zero and a model pass cannot establish unexercised browser/provider/security behavior.


## Human review and corrective attempts

**Accept evidence → Done:** accepts only the current revision's run evidence. This releases dependency eligibility, not commit/merge/deploy permission or a workspace handoff gate.

**Request changes:** enter specific missing behavior or evidence. Blank feedback cannot be submitted; cancel leaves status unchanged. Confirmation returns the ticket to Ready, retaining the revision's approval. Feedback stays on the reviewed run/revision; later authorized attempts receive it, with older-revision context identified when applicable.

A new attempt still needs safe workspace handoff, execution permission, satisfied dependencies, available capacity and exclusive physical workspace ownership. Status Ready is not a promise of immediate execution.

## Operator reconciliation

Default/exception policy: **operator-controlled reconciliation**, not blanket automatic commits or per-ticket worktrees. Explicit autonomous completion above is the narrow host-publication exception; the confirmed operator commit remains available for other work.

A project-level gate is recorded when initial admission finds Git changes, a stopped run leaves changes, interrupted-run recovery finds changes, or required Git inspection is unavailable. It blocks that project's new starts without consuming every queued ticket as a synthetic blocked run. Other independent projects can still use available capacity.

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
- **Paused:** stops continuation, not side effects. Paused work retains its slot and workspace ownership; resuming preserves session/snapshot even after a capacity reduction. Canceled questions remain unanswered, not consent. Canceling a selected run preserves partial work and requires explicit review before retry.
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
2. Broader live-provider coverage beyond the bounded Phase 5 Bug fix and Investigation journeys above, including real pause/correction/blocker and native-compaction scenarios.
3. Full feature-map maintenance, with unverified prerequisites clearly recorded.
4. Opt-in onboarding and proven verification recipes for other registered projects.

Broader playbooks and external automation remain separately scoped. Autonomous completion is implemented only under the explicit local policy above; this guide grants no additional execution or external-write permission.
