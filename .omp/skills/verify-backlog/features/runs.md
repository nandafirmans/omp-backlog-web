# Execution, evidence and human acceptance

Entry points: authorized project permission + global scheduler; active-run alert; `/runs/:runId`; ticket Run history; ticket-panel and board Actions/drag review controls; run dialogs.

Live-provider prerequisites: separately authorized disposable repository, explicit safe dirty-tree policy, OMP installed/configured and provider access established without inspecting secrets. Missing prerequisites = Blocked/unverified. Default starter helper never enables execution. Optional `--review-fixture` enables only a deterministic protocol child in the owned scratch repository; this proves host/browser wiring, not a model's behavior.

Drive when authorized: create approved immutable ticket, enable approved-only scheduling, observe actual OMP run, answer required dialog explicitly, inspect affected real app/CLI outcome and side effects. Submit criterion-by-criterion observed proof; wait for child settlement and Needs review. Reload run, inspect persisted revision and evidence. Only human accepts current-revision proof as Done; dependencies wait for Done. Repeat Request changes through ticket panel, Actions menu and drag confirmation separately when changed.

Other subfeatures: pause stops continuation not rollback; paused run retains global slot; resume same session never assumes canceled approval; blocked/failed requires explicit action; editing active requirements prevents old proof accepting new revision; recovery preserves partial work. Each needs its own observed scenario, not one green command.

Fixture browser path: configure owned protocol executable, approve literal `proof.txt contains verified.` ticket, enable approved-only scheduling, answer its completion barrier through run UI, pause global starts, inspect persisted receipts and download `proof.txt`. Request changes via ticket panel, Actions menu and drag-to-Ready separately. Each route must disable blank feedback, cancel without mutation, and save feedback linked to that run/revision on confirmation/reload. Subsequent authorized fixture attempt is separate from the human acceptance path; no Done claim.

Evidence: distinguish model claims, host records, protocol-fixture checks and real provider/browser checks. Receipts retain exact criterion, feature/entry point, method, outcome, details and reported recipe identity; host only attests stored artifact bytes/hash. Artifact downloads are authenticated, forced attachment, bounded and hash-checked. Preserve private artifacts after teardown. `server/runtime-integration.test.ts` is a fixture, never provider availability proof.

Gotchas: no auto-Done, commit, push or deploy. Dirty worktree may block next run; do not reset or auto-commit to continue. Run artifacts must not mutate requirement attachments.
