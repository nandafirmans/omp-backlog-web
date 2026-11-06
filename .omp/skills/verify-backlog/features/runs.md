# Execution, evidence and human acceptance

Entry points: authorized project permission + global scheduler; active-run alert; `/runs/:runId`; ticket Run history; ticket-panel and board Actions/drag review controls; run dialogs.

Live-provider prerequisites: separately authorized disposable repository, explicit safe dirty-tree policy, OMP installed/configured and provider access established without inspecting secrets. Missing prerequisites = Blocked/unverified. Default starter helper never enables execution. Optional `--review-fixture` enables only a deterministic protocol child in the owned scratch repository; this proves host/browser wiring, not a model's behavior.

Drive when authorized: create an approved immutable ticket, enable approved-only scheduling, observe the actual OMP run, answer required dialogs explicitly, and inspect affected real app/CLI outcomes and side effects. Submit criterion-by-criterion observed proof. Human-reviewed projects settle at Needs review; only a human accepts current-revision proof as Done. Separately commissioned Autonomous projects require host verification, fresh restricted review, guarded local publication, and stopped owned work before host Done. Dependencies wait for Done in both modes. Repeat Request changes through ticket panel, Actions menu, and drag confirmation separately when changed.

Other subfeatures include pause without rollback, retained paused capacity, same-session resume without canceled consent, edited requirements rejecting old proof, and retained partial recovery work. Human-reviewed blockers and stopped failed/interrupted runs require explicit action. Opted-in autonomous blockers may enter the host-controlled recovery below. Each needs its own observed scenario, not one green command.

Fixture browser path: configure owned protocol executable, approve literal `proof.txt contains verified.` ticket, enable approved-only scheduling, answer its completion barrier through run UI, pause global starts, inspect persisted receipts and download `proof.txt`. Request changes via ticket panel, Actions menu and drag-to-Ready separately. Each route must disable blank feedback, cancel without mutation, and save feedback linked to that run/revision on confirmation/reload. Subsequent authorized fixture attempt is separate from the human acceptance path; no Done claim.

Evidence: distinguish model claims, host records, protocol-fixture checks and real provider/browser checks. Receipts retain exact criterion, feature/entry point, method, outcome, details and reported recipe identity; host only attests stored artifact bytes/hash. Artifact downloads are authenticated, forced attachment, bounded and hash-checked. Preserve private artifacts after teardown. `server/runtime-integration.test.ts` is a fixture, never provider availability proof.

Gotchas: pstack grants engineering methodology only, never acceptance or shipping permission. No automatic Done or commit in Human review mode. Autonomous publication requires the separately commissioned host gates. Push, PR, merge, deploy, installs, and destructive cleanup remain unauthorized. Dirty worktree may block the next run; do not reset or auto-commit to continue. Run artifacts must not mutate requirement attachments.

## Blocker recovery handoff

Entry points: blocked ticket panel/direct URL, board Actions → Ready, native blocked-card drag → Ready, source run recovery link. Actions/drag open the panel without saving a move. Run details show saved notes and received handoff snapshots read-only; editing remains on the ticket.

Drive with an authorized disposable fixture: inspect agent-reported prerequisite/fix and optional attempts/permission/check plan; review source evidence/partial work. Save an edited recovery note; confirm requirements revision, approval and Blocked status are unchanged. Reload; note survives. Cancel unsaved close and retry separately. Change the saved note/revision in another tab; stale review must fail without discarding local text. Explicitly load/reconcile current note. Confirm Review fix & retry binds source run, saved-note identity and exact current revision, then requests Ready without releasing any workspace gate. A subsequent separately authorized run must receive the reviewed snapshot and fresh-check instructions, not inherited passing evidence. Old requirements require a new saved/reviewed note. Legacy blockers must show unavailable details honestly.

Check keyboard disclosure, unsaved navigation, visible errors, enabled retry and Dark/Light desktop/mobile layouts. This slice's browser evidence is synthetic-API UI coverage only (see current workflow); `server/recovery.test.ts` and runtime integration assertions were added but not run under lint-only policy. Persistence/backend/provider behavior needs separately authorized verification. No install or auto-retry authority granted.

## Host-controlled autonomous blocker recovery

Entry points include the existing run Evidence tab, blocked-ticket panel, lifecycle status tags, and manual recovery controls. Do not commission or run production projects merely to verify this interface.

Default verification uses `bun test server/autonomy-runtime.test.ts server/autonomous-recovery.test.ts server/rpc-retry.test.ts`. These tests create disposable Git repositories and real protocol-speaking child processes. They do not call providers or establish native OMP methodology compliance.

Drive an eligible engineering blocker through original-session repair, fresh host recipe, fresh restricted review, and one guarded local fixture commit. Check Standard and pstack separately. Inspect the original blocker and receipts, failure category and fingerprints, allowance ordinal, persisted dispatch, unchanged mode/session/deadline/budget, role usage, observed work, verification outcomes, and final outcome. Changing candidate bytes or only verification evidence must not reuse superseded acceptance.

Use explicit fixture barriers for pause/resume, shutdown/restart uncertainty, revocation, and independent repository scheduling. Paused repair keeps its claim while the independent repository can finish. Duplicate reports, repeated ineffective failures, exhausted limits, credentials, installation requests, product decisions, and human-reviewed mode must not acquire new recovery or publication authority.

In the browser, inspect Recovering, Recovered, Still blocked, and Needs assistance. Open history disclosures with Enter and Space. Check long diagnostics and fingerprints at desktop and 390px in a dark theme and Light. Inspect the token delta separately from the cumulative run limit. Existing operator recovery instructions must remain unchanged while opening history and canceling retry. A successful command alone must never appear as accepted completion.

Provider recovery remains a separate opt-in tier through `OMP_BACKLOG_LIVE_TESTS`. Never infer it from protocol fixtures, synthetic API browser data, or historical live greeting runs. Record actual model, thinking, tokens, attempts, outcomes, and retained sanitized proof only when that tier is explicitly authorized.


## Run usage and native compaction

Entry point: run detail token-usage section and its failed-run next-attempt link. Verify cumulative total/budget and actual percentage (including overshoot) independently from current estimated context/capacity. Check actual model/thinking, sample times, unknown legacy fields, native compaction running/ended/aborted/error state and no fabricated completion percentage. A paused/stopped run must not show an active compaction spinner from a stale sample.

For an explicitly authorized real run, confirm native automatic compaction is enabled before prompting, observe its lifecycle and context reduction if it actually triggers, and check that consumption/budget are not reset. This is a native OMP path, not a host polling compaction loop. Missing real triggering/provider authorization leaves native compaction unverified. Existing synthetic UI/protocol coverage is not live compaction proof.

For explicitly uncapped runs, expect actual consumption plus No cumulative token limit, not a made-up budget percentage. Native goal creation must omit `token_budget` rather than send null/zero. Check accounted usage beyond a former finite default does not itself stop the run; the original time deadline, errors/blockers and pause still stop it. Pause/resume must preserve uncapped or finite snapshots, including recorded legacy limits. Completion still requires fresh evidence and human acceptance.

## Engineering mode selection

Global Settings exposes Standard OMP / OMP + pstack; saved ticket Next attempt settings expose inheritance and explicit overrides. New stores default Standard; legacy stores/runs without a mode retain pstack. Exercise save/cancel/inheritance, stale/active ownership rejection, history/details against immutable admission mode, and unchanged model/thinking/budget values. Mode selection must not trigger ticket model discovery or execution.

Standard must complete with installed pstack and with its extensions disabled, without native router activation or pstack discovery/history observation. Explicit pstack ticket references stay subordinate to the selected Standard mode; unrelated project verification skills remain available. Requested pstack must fail closed on missing router/adapter/task, never fall back. Same-session pause/correction/recovery preserve mode, original deadline and cumulative author/reviewer consumption; separately reviewed blocker restarts preserve the source mode even after changing global/ticket defaults and restarting the backend.

`OMP_BACKLOG_LIVE_TESTS=1 bun test server/engineering-live.test.ts` exercises paired Standard/pstack human and autonomous greeting tickets plus Standard with pstack extensions disabled. It authorizes only disposable projects, fixed 600,000-token/four-minute caps, project verification reads, actual CLI output checks and, for autonomous cases, baseline Git setup and guarded host-local publication. Compare only equivalent model/thinking/criteria/policy samples; retain accounted author/reviewer totals, never infer billed cost or guaranteed savings. `server/concurrency-live.test.ts` separately overlaps Standard and pstack in independent disposable repositories.


## Default pstack engineering

The earlier Phase 5 default is now conditional on selecting pstack. Those authors use the installed `poteto-mode` router without a ticket skill mention. Before prompting, the actual RPC session must expose native `skill:poteto-mode`, `skill:pstack-pi`, and `task`. Native invocation provenance appears in the run conversation; observed playbook/verification reads remain tool activity, not acceptance proof. Drafting and restricted acceptance review do not load the router.

Run metadata-only installed/disabled/missing-plugin controls with `OMP_BACKLOG_NATIVE_TESTS=1 bun test server/engineering-native.test.ts server/restricted-native.test.ts`. These use disposable namespaces and no inference. The restricted startup test also proves a synthetic ancestor custom-tool module cannot execute, with a separate sensitivity control that removes only its generated private namespace anchor.

Live-provider permission and commands are described above. Both engineering modes must preserve the same host acceptance and publication gates. Missing native/provider prerequisites remain unverified; protocol success cannot substitute for a live run.

Protocol regressions remain in `server/runtime-integration.test.ts` and `server/autonomy-runtime.test.ts`. They cover missing discovery, same-session pause/correction/recovery without repeated router initialization, malicious author submissions, host checks/review/publication, blockers/inconclusive review, and dependent progression. Keep those results separate from installed RPC and live-provider proof.
