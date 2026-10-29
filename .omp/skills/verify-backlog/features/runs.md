# Execution, evidence and human acceptance

Entry points: authorized project permission + global scheduler; active-run alert; `/runs/:runId`; ticket Run history; ticket-panel and board Actions/drag review controls; run dialogs.

Live-provider prerequisites: separately authorized disposable repository, explicit safe dirty-tree policy, OMP installed/configured and provider access established without inspecting secrets. Missing prerequisites = Blocked/unverified. Default starter helper never enables execution. Optional `--review-fixture` enables only a deterministic protocol child in the owned scratch repository; this proves host/browser wiring, not a model's behavior.

Drive when authorized: create approved immutable ticket, enable approved-only scheduling, observe actual OMP run, answer required dialog explicitly, inspect affected real app/CLI outcome and side effects. Submit criterion-by-criterion observed proof; wait for child settlement and Needs review. Reload run, inspect persisted revision and evidence. Only human accepts current-revision proof as Done; dependencies wait for Done. Repeat Request changes through ticket panel, Actions menu and drag confirmation separately when changed.

Other subfeatures: pause stops continuation not rollback; paused run retains global slot; resume same session never assumes canceled approval; blocked/failed requires explicit action; editing active requirements prevents old proof accepting new revision; recovery preserves partial work. Each needs its own observed scenario, not one green command.

Fixture browser path: configure owned protocol executable, approve literal `proof.txt contains verified.` ticket, enable approved-only scheduling, answer its completion barrier through run UI, pause global starts, inspect persisted receipts and download `proof.txt`. Request changes via ticket panel, Actions menu and drag-to-Ready separately. Each route must disable blank feedback, cancel without mutation, and save feedback linked to that run/revision on confirmation/reload. Subsequent authorized fixture attempt is separate from the human acceptance path; no Done claim.

Evidence: distinguish model claims, host records, protocol-fixture checks and real provider/browser checks. Receipts retain exact criterion, feature/entry point, method, outcome, details and reported recipe identity; host only attests stored artifact bytes/hash. Artifact downloads are authenticated, forced attachment, bounded and hash-checked. Preserve private artifacts after teardown. `server/runtime-integration.test.ts` is a fixture, never provider availability proof.

Gotchas: no auto-Done, commit, push or deploy. Dirty worktree may block next run; do not reset or auto-commit to continue. Run artifacts must not mutate requirement attachments.

## Blocker recovery handoff

Entry points: blocked ticket panel/direct URL, board Actions → Ready, native blocked-card drag → Ready, source run recovery link. Actions/drag open the panel without saving a move. Run details show saved notes and received handoff snapshots read-only; editing remains on the ticket.

Drive with an authorized disposable fixture: inspect agent-reported prerequisite/fix and optional attempts/permission/check plan; review source evidence/partial work. Save an edited recovery note; confirm requirements revision, approval and Blocked status are unchanged. Reload; note survives. Cancel unsaved close and retry separately. Change the saved note/revision in another tab; stale review must fail without discarding local text. Explicitly load/reconcile current note. Confirm Review fix & retry binds source run, saved-note identity and exact current revision, then requests Ready without releasing any workspace gate. A subsequent separately authorized run must receive the reviewed snapshot and fresh-check instructions, not inherited passing evidence. Old requirements require a new saved/reviewed note. Legacy blockers must show unavailable details honestly.

Check keyboard disclosure, unsaved navigation, visible errors, enabled retry and Dark/Light desktop/mobile layouts. This slice's browser evidence is synthetic-API UI coverage only (see current workflow); `server/recovery.test.ts` and runtime integration assertions were added but not run under lint-only policy. Persistence/backend/provider behavior needs separately authorized verification. No install or auto-retry authority granted.

## Run usage and native compaction

Entry point: run detail token-usage section and its failed-run next-attempt link. Verify cumulative total/budget and actual percentage (including overshoot) independently from current estimated context/capacity. Check actual model/thinking, sample times, unknown legacy fields, native compaction running/ended/aborted/error state and no fabricated completion percentage. A paused/stopped run must not show an active compaction spinner from a stale sample.

For an explicitly authorized real run, confirm native automatic compaction is enabled before prompting, observe its lifecycle and context reduction if it actually triggers, and check that consumption/budget are not reset. This is a native OMP path, not a host polling compaction loop. Missing real triggering/provider authorization leaves native compaction unverified. Existing synthetic UI/protocol coverage is not live compaction proof.

For explicitly uncapped runs, expect actual consumption plus No cumulative token limit, not a made-up budget percentage. Native goal creation must omit `token_budget` rather than send null/zero. Check accounted usage beyond a former finite default does not itself stop the run; the original time deadline, errors/blockers and pause still stop it. Pause/resume must preserve uncapped or finite snapshots, including recorded legacy limits. Completion still requires fresh evidence and human acceptance.
