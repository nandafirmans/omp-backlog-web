# OMP Backlog Web — approved implementation plan

## Scope and defaults

Build a single-user, local-only website with login, separate repository workspaces, Markdown tickets with attachments, a persistent scheduler controlling OMP through RPC, explicit execution permission, pause controls, and verification evidence.

Approved defaults:

- Single owner account; no public registration or roles.
- Loopback-only access.
- TypeScript + Bun backend, React + Vite frontend, SQLite database.
- Markdown ticket directories inside each repository.
- Repositories initially paused.
- Bounded global execution capacity, default 1 and configurable 1–4, with fair rotation between independent repositories. One owner per physical workspace and Git common directory.
- Fresh OMP session per ticket.
- Human completion review by default.
- No automatic publication by default. Explicit project autonomy may authorize guarded host local commits and Done (section 12); push, deployment and destructive cleanup remain unauthorized.

One backend process and one database remain sufficient. Scheduling is a backend module, not another service. Opt-in independent reviewer sessions remain under their own ticket owner; no Redis, Docker or second scheduler is required. Phase 6A permits cross-repository concurrency only. See [architecture and Phase 6B boundary](docs/phase-6-concurrent-execution.md).

The initial project setup is runnable development tooling and a project overview only. Login, repository management, tickets, scheduling, and execution controls must not be presented as operational before implementation and verification.

## 1. Architecture

```mermaid
flowchart TD
    UI[Local website] --> APP[Backend]
    APP --> DB[(SQLite: users, permissions, runs, queue)]
    APP --> FILES[Per-repo Markdown tickets and attachments]
    FILES --> WATCH[File watcher and reconciliation]
    WATCH --> SCHED[Scheduler]
    DB --> SCHED
    SCHED --> OMP[OMP child process via RPC]
    OMP --> REPO[Selected repository]
    OMP --> APP
    APP --> EVENTS[Live events and approval requests]
    EVENTS --> UI
```

| Area | Choice | Reason |
| --- | --- | --- |
| Backend | TypeScript + Bun | OMP integration, child processes, SQLite support |
| Frontend | React + Vite | Interactive dashboard with familiar development tooling |
| Database | SQLite | Durable local state without a database server |
| Live updates | Server-Sent Events | Stream progress; use normal requests for actions |
| Agent transport | OMP rpc-ui | Progress plus agent questions and supported approval dialogs |
| Tickets | Markdown files per repository | Editable through website or editor; portable |

Keep process lifecycle independent of the browser. Closing a tab must not terminate work. The application's scheduler selects tickets; OMP executes each ticket's goal.

## 2. Login and local security

- Create the initial owner through terminal setup, not an unauthenticated website setup screen.
- Hash passwords with Argon2id; never store plaintext passwords.
- Use server-side sessions with HttpOnly, SameSite cookies, appropriate expiry, and session invalidation on logout.
- Implement login throttling, CSRF protection, and strict Host/Origin validation.
- Bind to 127.0.0.1; no LAN exposure by default.
- Restrict permissions on database, session records, and upload storage.
- Do not expose OMP credentials through the website, logs, or database exports.
- Logout does not silently cancel running work; expose execution controls separately.

Local login protects dashboard access. It does not sandbox commands. OMP operates with the backend user's filesystem permissions. Repository separation is organizational unless stronger OS isolation is implemented. Do not describe a selected working directory as a security sandbox.

## 3. Repository selection and separation

A browser folder-upload control does not reliably provide the normal server filesystem path needed for execution. Build an authenticated backend-powered folder picker.

Initial permitted root: ~/Development.

Registration flow:

1. User selects Add repository.
2. Browse directories within permitted roots.
3. Select a folder.
4. Resolve its canonical path, check access, and detect its Git root.
5. Show the actual execution directory and register a stable repository ID.

Rules:

- Reject duplicate canonical roots, including aliases through symlinks.
- Prevent browsing outside permitted roots, including through symlink traversal.
- Prefer existing Git repositories; permit non-Git workspaces with a clear warning that Git change tracking is unavailable.
- Never initialize Git, switch branches, reset files, or clean working trees automatically.
- Give each repository separate tickets, permissions, runs, and transcript history.
- Never overwrite unrelated working-tree changes. Surface conflicts or unsafe overlapping work before execution.

## 4. Backlog and ticket storage

Use one Markdown file per ticket instead of a growing single BACKLOG.md. This simplifies attachments, external edits, revisions, and conflicts.

```text
my-repo/
  .omp-backlog/
    tickets/
      T001/
        ticket.md
        attachments/
          login-reference.png
          example-response.json
      T002/
        ticket.md
```

Keep the application database, run snapshots, and transcript records in a private application data directory outside registered repositories.

### Ownership

- Markdown owns title, goal, requirements, acceptance criteria, dependencies, scope, verification instructions, and attachment references.
- SQLite owns approval, runtime status, ordering, attempts, pause state, and evidence records.
- The website combines these views; do not maintain competing status fields in both stores.
- Automatic conversion or splitting of existing BACKLOG.md files into tickets is out of scope and is not pending work. Users may explicitly load Markdown into a single-ticket draft and adapt it manually. Never silently rewrite or discard existing BACKLOG.md files.
- The RPC worker selects one ticket. Do not ask the installed backlog-worker skill to independently process the entire backlog in parallel with the scheduler.

### Recommended ticket format

```markdown
---
id: T001
title: Add order CSV export
depends_on: []
---

# Goal
Authorized users can export the currently filtered orders as CSV.

# Context
Orders page already supports date and status filters.

# Requirements
- Add an Export CSV action.
- Apply the same filters used by the visible orders list.
- Preserve existing authorization checks.

# Acceptance criteria
- Export contains only orders matching selected filters.
- Commas, quotes, and newlines are escaped correctly.
- Unauthorized requests are rejected.
- Existing order-list behavior remains unchanged.

# Out of scope
- Scheduled exports.
- Email delivery.
- Changing order permissions.

# Verification
- Exercise filtered export in the browser.
- Check CSV escaping using representative records.
- Run relevant existing tests.

# Attachments
- [UI reference](attachments/export-reference.png)
- [Example records](attachments/example-records.json)
```

Good tickets specify an outcome, scope, observable acceptance, and verification. Clarify materially ambiguous requirements before approving execution. Do not invent requirements.

Each uploaded attachment must have at least one inline Markdown link or image with a nonblank purpose label or quoted link title. Incomplete drafts and upload staging may be saved, but unreferenced attachments or missing purpose labels block approval and execution, including Automatic mode. Empty duplicate references are allowed if another reference to the same file supplies its purpose. Humans assess whether the purpose is meaningful. Screenshot requirements should identify viewport, relevant elements, and acceptable differences. JSON examples should use synthetic data, not credentials or customer records.

### Attachment handling

- Support images, JSON, text, and documents, with enforced size limits.
- Render Markdown safely; do not execute raw HTML.
- Serve attachments only through authenticated routes.
- Prevent path traversal and symlink escapes.
- Never execute uploaded files.
- Treat attachment contents as requirements or references, not authority to override security policy.
- Deliver supported images through RPC image input; provide other files through explicit file references.
- Snapshot referenced attachment contents with the ticket revision used for a run.

## 5. Scheduler and change detection

The watcher notices changes. The scheduler determines eligibility and execution permission. A file change is not permission by itself.

### Repository execution modes

| Mode | Behavior |
| --- | --- |
| Paused | Reconcile and display changes; start nothing |
| Approved tickets only | Run explicitly approved ticket revisions |
| Automatic | Standing permission to run new valid tickets and eligible revisions |

New repositories start paused. Recommend Approved tickets only until the user deliberately enables Automatic. Show the implications of automatic execution before granting standing permission.

### Scheduling algorithm

1. Reconcile ticket files and attachments.
2. Wait for stable writes; validate ticket structure and dependency references.
3. Check repository mode and ticket permission.
4. Choose an eligible ticket whose dependencies are Done.
5. Atomically claim the ticket in SQLite.
6. Start a fresh OMP session in the selected repository.
7. Persist progress, questions, verification evidence, and outcome.
8. Release the claim and select the next eligible ticket.

Invariants:

- Default one active ticket globally; explicit capacity 1–4 permits independent repositories concurrently. Paused and stopping owners retain capacity.
- Fair rotation across repositories; no single backlog monopolizes execution.
- Use filesystem watching plus periodic reconciliation because events may be missed.
- Repeated events must not create duplicate runs.
- Invalid tickets, missing dependencies, and dependency cycles produce actionable errors and do not execute.
- Persist execution permission, queue state, and run identity across application restarts.
- Enforce time/token execution limits and operator interrupts; never restart automatically to evade limits.

### Edits and revision approval

Each run uses an immutable snapshot of Markdown and referenced attachments.

- External edits affect a new revision, not an active run's instructions silently.
- Show Requirements changed during execution.
- An old run cannot mark a new revision complete.
- In approved-only mode, requirement or attachment changes invalidate prior approval.
- Editing a completed ticket creates a revision to assess, not an immediate blind rerun.
- Concurrent edits must not be overwritten silently; detect stale saves and ask the user to reconcile.

## 6. Pause, blockers, completion, and recovery

### Controls

- Pause repository: prevent new starts; current run continues.
- Pause current run: pause goal continuation and interrupt active execution.
- Resume: explicit permission to continue.
- Pause all: prevent new starts globally; make treatment of the current run explicit.

Pausing does not roll back completed actions. Show Stopping until the agent and relevant child work have actually stopped. Do not promise transactional cancellation of external side effects.

### Ticket lifecycle

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Ready: Valid and permitted
    Ready --> Running: Scheduler claims ticket
    Running --> Blocked: Missing prerequisite
    Blocked --> Ready: User resolves and permits retry
    Running --> Paused: User interrupts
    Paused --> Running: User resumes
    Running --> NeedsReview: Evidence submitted
    NeedsReview --> Done: Acceptance confirmed
    NeedsReview --> Ready: Changes requested
    Running --> Failed: Execution error
    Failed --> Ready: Explicit retry
    Running --> Interrupted: Backend or process crash
    Interrupted --> Ready: Recovery reviewed
```

### Completion gate

Needs review precedes Done by default. An agent's success claim, a successful command admission, or process exit is not sufficient proof.

- Require criterion-by-criterion evidence tied to the run's revision.
- Keep human review for visual or subjective criteria.
- Automatic completion is appropriate only for explicit, approved machine-checkable criteria; it must not weaken the criteria or trust arbitrary uploaded code as executable validation.
- Dependencies wait for Done, not merely an agent yield or Needs review.
- Do not claim unperformed verification passed.

### Blockers

- Investigate actionable failures before declaring a blocker.
- Record the exact unavailable prerequisite and required unblock action.
- Preserve partial work and evidence.
- Continue independent tickets when safe; never start dependent or conflicting work.
- If none remain actionable, wait rather than repeatedly retry an unchanged failure.
- Reassess prerequisites after the user's unblock update before retrying.
- Do not manufacture credentials, weaken acceptance, or bypass approvals to unblock work.

### Recovery

- Persist OMP session ID, run identity, selected repository, and revision.
- On startup, reconcile previously active runs and any surviving child process before launching another ticket.
- Mark unresolved runs Interrupted; do not blindly replay mutating actions.
- Require recovery review before retrying interrupted work.
- Closing the browser does not stop a run. Backend shutdown must explicitly coordinate child shutdown and persist the observed outcome.

## 7. OMP integration

Launch OMP with --mode rpc-ui so supported agent questions and approval dialogs can reach the browser. Do not use --no-ui for this approval-capable flow.

The backend must:

- Wait for the ready frame and correlate command IDs and responses.
- Negotiate supported protocol framing or reuse a compatible official client; enforce transport limits.
- Continuously drain stdout and stderr.
- Persist OMP session identity.
- Deliver progress through SSE and user actions through authenticated requests.
- Render agent questions and supported approval requests in the website.
- Fail closed when approval cannot be obtained; do not silently approve a disconnected browser's request.
- Distinguish prompt admission, agent yield, session settlement, and verified ticket completion.
- Record provider errors as execution failures even if the original prompt command was admitted successfully.
- Keep process lifecycle separate from ticket outcome.

Configure goal.continuationModes to include rpc through an application-owned launch overlay, not by modifying global OMP settings. This covers rpc and rpc-ui.

Only one mechanism owns each level of continuation:

- OMP goal mode continues work inside a ticket.
- Scheduler advances between tickets.
- Do not layer /loop over both.

Relevant primary documentation:

- OMP RPC protocol: omp://rpc.md
- Startup and framing: omp://rpc.md (Startup; Transport and Framing)
- Prompt completion and settlement: omp://rpc.md (Prompt payload; Yield vs settled)
- Goal operations and goal.continuationModes: omp://rpc.md (goal command documentation)
- Questions and approvals: omp://rpc.md (Extension UI Sub-Protocol)
- Public source repository: https://github.com/can1357/oh-my-pi

## 8. Website pages

| Page | Functions |
| --- | --- |
| Login | Owner authentication |
| Repositories | Folder registration, queue summary, execution mode |
| Repository backlog | Ordering, dependencies, status, permission, pause |
| Ticket editor | Markdown editor and preview, attachments, acceptance criteria |
| Run detail | Live transcript, questions, evidence, changed-file summary, controls |
| Settings | OMP executable/model, limits, permitted folder roots |

Keep blocker questions and approval requests prominent, not buried in logs. Support keyboard access, visible focus, readable contrast, responsive layouts, and reduced-motion preferences. Never use fake repositories, fabricated runs, or nonfunctional controls to imply implemented behavior.

## 9. Implementation sequence and acceptance

| Phase | Deliverable | Acceptance |
| --- | --- | --- |
| 1. Application and login | Local server, SQLite, owner setup, sessions | Unauthenticated protected access denied; logout invalidates session |
| 2. Repositories | Folder picker and separate workspace records | Symlink duplicates rejected; repositories remain separate |
| 3. Tickets | Markdown editor, attachments, external-change detection | External edits appear; unsafe paths and rendering rejected |
| 4. OMP execution | Single-ticket RPC execution and live website | Real ticket runs; questions and approvals reach browser; outcome persisted |
| 5. Scheduler | Watching, permissions, dependencies, pause/resume | New eligible ticket runs once; paused repository never starts work |
| 6. Recovery and verification | Snapshots, evidence review, restart handling | Crash becomes Interrupted; no blind replay; new revision cannot inherit old success |

Verify with disposable repositories and real OMP execution. Browser verification must cover login, upload, permission, pause, blockers, and completion review. Exercise watcher duplicate events, dependency cycles, active-ticket edits, browser disconnects, backend restart, and failed provider turns. Use deterministic automated tests for state transitions, permissions, path containment, approval/revision binding, and duplicate-run prevention.

### Implementation and verification status

All six implementation phases have code paths. Repository cards now show lifecycle-status counts, and attachment-purpose validation participates in ticket eligibility. Automatic BACKLOG.md conversion remains out of scope.

Verification completed using isolated application data and disposable workspaces:

- Real browser/OMP flow: owner login, folder registration, authenticated upload, exact-revision approval, paused repositories starting nothing, agent questions and supported tool approvals, proof-file write/read, persisted criterion evidence, human completion review, and dependent execution only after Done in a fresh session.
- Real interruption flow: closing the browser left an unanswered question pending without granting consent; pause cleared the dialog and stopped the child; resume retained the session and required a new answer. A Stop answer produced an investigated blocker and explicit retry used a fresh session.
- Real revision/restart flow: edits during execution invalidated approval without changing the run snapshot; restarting the backend left the unfinished run Interrupted without replay, preserved completed tickets, and rejected completion of changed requirements using old evidence.
- Browser surface: per-repository counts matched persisted statuses on desktop and mobile, with no horizontal overflow at a 390px viewport. Logout revoked protected access.
- Deterministic suite: 40 tests passed, covering permissions, paths, dependency cycles, revision/attachment approval binding, actual duplicate filesystem events, multi-repository fairness, global-slot exclusion, post-admission provider errors, pause/resume identity, active-edit completion binding, surviving-child recovery, and time/token limits. Provider-error and limit cases use a protocol-speaking child fixture, not an induced live-provider outage.
- ESLint and strict TypeScript checks passed. No production build was run.

These checks establish the exercised scenarios, not sandboxing or universal provider compatibility. Semantic attachment-purpose quality and visual/subjective ticket acceptance remain human review responsibilities.

## 10. Planned execution-loop improvements

Status: partially implemented; delivery boundaries below. Section 11 expands the verification and workflow adoption scope.

Keep the existing ownership model: scheduler selects tickets; native OMP goal mode continues within one ticket. No additional `/loop` or mandatory completion skill. Preserve revision guards, fixed lifetime limits and explicit interrupted retry. Human acceptance remains default; section 12 adds the separately authorized exact-candidate autonomous path.

Implement in this priority order:

### 1. Trustworthy verification evidence

- Link each acceptance criterion to observed verification: command/check, exit status or outcome, relevant output, and artifact paths. Distinguish host-recorded observations from agent-written claims.
- Capture results from supported verification paths; do not label unsupported or unobserved checks as independently verified.
- Run only explicitly permitted checks under repository policy. Never execute arbitrary ticket attachments or uploaded validation code as trusted checks.
- Human-reviewed projects keep human final acceptance. Explicit autonomous policy requires host checks plus a separate restricted reviewer; insufficient visual/subjective evidence stops inconclusive. A passing command alone never proves every criterion.
- Acceptance: reviewer can trace each completion claim to its evidence source and run revision; failed, missing, or unperformed required checks cannot be presented as passing.

### 2. Safe working-tree handoff

- Address the current constraint: agents cannot commit, while pre-existing Git changes block new ticket execution. Acceptance alone does not clean the working tree.
- Default/exception policy: operator-controlled reconciliation through a confirmed local commit or terminal. Dirty/unavailable Git persists a handoff gate; existing gates require explicit clean recheck. Section 12 allows only clean-admitted, exact-candidate host publication under separate standing authority, not broad agent commits or per-ticket isolation.
- Operator preserves/reconciles work under their own authorization, then explicitly chooses Recheck workspace. Authenticated/CSRF-protected recheck inspects Git with optional locks disabled and clears only the reviewed gate if clean and no run owns that workspace. A stale gate, dirty state, inspection failure, or active/paused work cannot be bypassed. Merely becoming clean or marking Done does not release a recorded gate. Existing permissions/dependencies/global pause still apply; previously blocked tickets still require explicit retry.
- Preserve unrelated changes and partial work. Never reset, discard, or automatically commit changes to advance the queue.
- Acceptance: prior-ticket changes produce an actionable handoff state; subsequent work starts only under the selected safe policy, with existing changes preserved.

### 3. Correct blocked-goal lifecycle

- An unresolved prerequisite produces a blocked result with partial evidence, exact prerequisite, and required unblock action—not a claim that the objective was achieved.
- Host pauses goal continuation and coordinates settlement/shutdown. Do not instruct the agent to complete an unmet goal; the model goal tool has no pause operation.
- Preserve evidence and partial changes; release execution ownership only after child work is observed stopped. Unchanged blockers require explicit retry, not an automatic loop.
- Acceptance: a blocked submission reaches Blocked without falsely completing the goal or leaving child work running; dependent tickets remain ineligible.

### 4. Clearer live progress

- Show current phase, criterion-level verification results, latest action, and available time/token usage alongside the live transcript.
- Distinguish agent-reported phases from host-observed execution and verification. Unknown or unverified states stay explicit.
- Show observed usage with its accounting basis; host session totals and OMP goal totals differ. Do not invent percentage completion from tool activity or elapsed time.
- Acceptance: running, waiting for an answer, blocked, stopping, and Needs review states remain distinguishable; progress updates survive reconnect without implying unsupported success.

### Verification before delivery

Add focused deterministic coverage for evidence provenance, failed/missing checks, blocked shutdown, safe handoff, and progress-state accuracy. Exercise affected browser and disposable-repository OMP flows before claiming end-to-end verification. Record checks actually performed separately from these planned acceptance conditions.

## 11. Planned pstack workflow adoption

Status: partially implemented; delivery boundaries below. Adopt the useful workflow discipline from [Cursor's official pstack plugin](https://github.com/cursor/plugins/tree/main/pstack), adapted to OMP and this application's existing safety gates. Upstream supplies no OMP adapter or bundled enforcement hooks; inventory completion does not authorize wholesale installation or execution.

### Scope and compatibility

- Separate two deliverables: project-local workflows for developing this application, and application support for equivalent workflows in each registered target repository. Proving this app's skill does not prove another project's skill.
- Compare every upstream component with current behavior before adoption. Record its purpose, dependencies, portability, gaps, policy conflicts, and proposed acceptance checks. Distinguish prompt instructions from executable enforcement and implemented features from recommendations.
- Keep bounded per-run ownership, revision-bound approval, native continuation, fixed lifetime limits and explicit blocker/recovery handling. Human acceptance remains default; section 12 defines the sole autonomous local-completion exception.
- Do not replace the scheduler, add a competing backlog loop, or automatically import Cursor-specific agents/hooks/configuration. Phase 6A authorizes cross-repository concurrency with canonical workspace exclusion and verification-instance isolation. Same-repository parallel execution remains disabled pending the separately verified Phase 6B worktree lifecycle.
- Ticket agents have no commit, push, PR, deployment, branch-change or destructive authority. Explicit completion policy allows only deterministic host local publication; upstream playbooks cannot grant broader shipping permission.

### A. Commission a verification skill per project

- Adapt the generator's repository interview: identify user surfaces, documented startup/setup, existing driving harnesses, observable side effects, and safe instance isolation. Prefer existing tooling; do not introduce dependencies without approval.
- Write the generated skill to an OMP-discoverable project location, such as `.omp/skills/verify-<app>/SKILL.md`, with valid name/description metadata. Copying `.cursor/skills/` alone does not integrate with current skill suggestions.
- Include exact Launch, Doctor, Drive, Evidence, Cleanup, and Helpers instructions. Startup must reach a usable state, including safe owner/seed setup, not merely an answering port. Doctor is read-only; driving uses real user paths and stable selectors/commands.
- Seed `features/README.md` and an initial 3–5 feature files. Record sub-features, all supported user entry points, concrete driving instructions, observable outcomes, and gotchas. Initial inventory is not exhaustive coverage.
- Commission by running launch → doctor → one mapped journey → capture proof → cleanup, then confirm proof survives. Clean up owned resources after failed attempts too. Unexecuted recipes remain Draft; unavailable prerequisites remain explicit failures/blockers.
- Acceptance: another agent can follow the documented recipe without hidden setup, demonstrate one real journey, and retain evidence after teardown. Keep protocol-fixture results distinct from real OMP/provider/browser proof.

### B. Integrate verification into the existing ticket flow

- Identify and read the applicable project verification skill and relevant feature-map entries before completing an affected ticket. Missing required recipes, access, or setup must be reported; never substitute invented checks.
- Flow: approved immutable ticket → inspect relevant skill/map → implement → drive affected journeys → observe outcomes and side effects → fix/recheck within budget → submit criterion evidence → settle safely → Needs review → human Done.
- Exercise relevant mapped entry points independently; one convenient route does not prove alternate UI/CLI paths. Match verification scope to the completion claim, without requiring a whole-project maintenance pass on every small ticket.
- Preserve repository verification policy. Skill instructions do not grant permission to run forbidden commands, use live credentials/data, or bypass approval. Stop on unavailable prerequisites, exhaustion, or no progress rather than weakening expected results.
- Acceptance: completion review identifies affected journeys, checks actually performed, observed failures, and remaining unverified boundaries; no skipped required journey is presented as passing.

### C. Store run-owned proof and provenance

- Store screenshots, command/check results, logs, and other proof as private run-owned artifacts, separate from immutable requirement attachments. Writing proof must not change ticket requirements or invalidate their approval.
- Associate evidence with run ID, ticket revision, criterion, feature/entry point, action, observed result, artifact reference, and evidence source. Record the verification recipe version or content identity used; distinguish agent assertions from host-observed records.
- Add authenticated, path-constrained access to supported proof artifacts and show them beside criterion evidence in the run panel. Apply appropriate file/type/size limits and safe rendering; do not expose arbitrary filesystem paths or credentials through artifacts.
- Keep artifacts outside disposable verification state so cleanup cannot erase proof. Define retention and operator-authorized deletion separately; avoid automatic destructive cleanup of existing data.
- Acceptance: reviewer can inspect action → outcome → relevant side effects and trace proof to the correct run. Proof survives teardown/reconnect; unauthorized access and path escapes are rejected.

### D. Maintain maps and preserve review feedback

- Add an explicitly invoked maintenance workflow that reconciles feature maps with source and live behavior. Commissioning proves one journey; a full maintenance pass covers every mapped feature and its required entry points.
- Classify failures as documentation drift, harness gaps, or product gaps. Re-drive harness fixes; never rewrite expected behavior to conceal a product failure. Missing prerequisites remain unverified, not passing.
- Drive shared live instances serially; isolate any separately driven instances. Bound attempts, time, and tokens, and preserve partial proof when blocked.
- Persist actionable human feedback when requesting changes, linked to the reviewed run/revision, and deliver it to the next authorized attempt. A status reset alone is not a corrective handoff. Revalidate changed requirements and safe working-tree ownership before another run.
- Acceptance: maintenance identifies stale/missing journeys without silently editing product behavior; a subsequent attempt receives the specific review findings and records fresh evidence rather than recycling old claims.

### Adoption order and delivery gate

1. Use the completed pinned upstream inventory and current-state comparison as the baseline; select components and resolve scope/policy conflicts before porting them.
2. Commission and prove this application's local verification skill and initial feature map in an isolated environment.
3. Implement run-owned evidence/provenance and review-feedback handoff, then integrate affected-journey verification into ticket execution and review.
4. Add explicit map maintenance and opt-in onboarding for other registered repositories. Broader pstack components remain individually research- and approval-gated.

### Broader component candidates, not blanket parity

- Current opt-in independent acceptance review is implemented in section 12. Phase 5 now invokes the installed engineering router for investigation, bug-fix, feature/refactoring, and other matching playbooks. This does not import another scheduler or require always-on multi-model fan-out; broader host-specific integrations remain separately scoped.
- Specialized candidates: measured performance/hillclimb recipes, competing designs for uncertain interfaces, and targeted formal/property checks for costly lifecycle invariants. A model must stay synchronized with code and demonstrate sensitivity to a deliberate scratch failure; model/diagram success is not whole-app proof. Tool installation needs separate approval.
- Defer PR watching/shipping, multiday orchestration, autonomous landing, Benny Slack/tracker integrations and webhook control until separately scoped and approved. Existing human Done remains ticket acceptance, not external-write or merge permission.
- Review upstream helpers before invoking them: some install dependencies on first use, watcher timeout defaults can be unbounded, and executable mapping files are trusted code. Impose explicit host budgets/ownership and preserve existing network, secret and destructive-action restrictions.

### Delivered slice and remaining gates (October 24, 2026)

- Added OMP-discoverable `verify-backlog` and explicit `maintain-backlog-verification` skills, four starter feature maps, and a bounded installed-Playwright helper with terminal owner setup, isolated data, no provider/installs and retained private proof. Starter browser commissioning passed; browser/protocol-fixture checks also exercised receipt downloads and feedback through ticket panel, Actions and drag separately. Receipts: [feature map commissioning record](.omp/skills/verify-backlog/features/README.md).
- Added structured agent-report receipts, private bounded run artifacts with authenticated hash-checked forced downloads, criterion completion checks, review-panel rendering and durable human feedback supplied to next authorized attempts. Existing stored runs remain readable; no database migration required. Host observes storage/time/hash, **not** whether reported checks actually ran. Recipe identity is reported, not independently attested. Semantic acceptance remains human-owned.
- Corrected blocked-result lifecycle: host pauses/stops owned work without asking goal completion. Added persisted host activity and sampled OMP session-token accounting, no inferred percentage.
- Added deterministic evidence/access/integrity/feedback and protocol shutdown/handoff coverage. Focused suite passed (14 tests); this is not live-provider verification. Browser coverage and recipe receipts distinguish real UI from protocol fixtures.
- Operator reconciliation delivered: project-level handoff persists after dirty run shutdown, initial dirty admission, and interrupted-run recovery; queued tickets are not consumed as synthetic blocked runs. Home/project UI exposes gate, source run and affected paths. Explicit clean recheck releases only that gate; no workspace mutation/commit/stash/reset. Focused suite passed (15 tests); isolated Git/browser/protocol-fixture recheck journey passed with proof retained at `/tmp/opencode/backlog-verify-qanhuh/proof/result.json`.
- Later approved extension: operator-only Review & commit with selected-file diffs/modes, message and explicit confirmation. Commits use exact reviewed raw file bytes, private indexes and compare-and-swap branch publication; preserve unselected staging, exclude sensitive/unsupported files, reject stale reviews/owned runs, and disable hooks/signing. Commit does not clear handoff or wake execution; Recheck stays separate. This grants no automatic agent commit or shipping authority. See README for limits and failure recovery.
- At this historical slice, independent command/code/recipe provenance and reviewer integration were pending; section 12 now delivers the narrow autonomous path. Full feature-map/live-provider journeys and other-project onboarding remain unproven. Conservative dirty-tree admission still applies.

This extends section 10 rather than replacing its remaining handoff/proof requirements. No full pstack parity or complete-plan delivery is claimed. Deferred components still need individual approval and verification evidence.

### Reviewed blocker recovery slice (October 29, 2026)

- Added structured, bounded agent blocker details and editable private source-run recovery notes, separate from requirements. Save alone grants no approval/execution. Legacy runs remain readable; no database schema migration.
- Added explicit Review fix & retry bound to current revision, source run and saved note identity. Fresh runs snapshot reviewed recovery context; no inherited passing checks. Panel, board Actions and blocked-to-Ready dragging converge on recovery review. Existing workspace/ownership/dependency/permission gates remain authoritative.
- Verification: changed-code ESLint and synthetic-API real-browser checks passed; details/limits in [current workflow](docs/current-agent-workflow.md#reviewed-blocker-recovery). Backend regression tests added, not run under lint-only policy. No live-provider recovery claim.
- At this checkpoint, stronger bounded same-run remediation, install/setup preauthorization, unattended fresh retries and independent host-observed command verification were not delivered. Section 12 records the later autonomous extension.

### Ticket execution settings and context telemetry (October 29, 2026)

- Added private per-ticket model/thinking/optional budget overrides with explicit save, version/revision checks and active-run rejection. Save grants no retry or approval. Fresh runs snapshot configuration; new snapshots preserve limits/model across pause/resume. Existing gates and explicit Failed retry remain.
- Run details distinguish cumulative consumption from estimated current context and surface model, native compaction status and sample age. Execution enables/validates native session-scoped automatic compaction; OMP owns thresholds, no second host compaction loop or budget reset.
- Corrected blank optional budget displaying zero. Current OMP admission permits major 18 minor/patch upgrades subject to capability checks; other majors require review.
- Verification: changed-code ESLint, synthetic-API browser journeys and installed metadata discovery passed. Backend/API/runtime/guard regression tests added or extended but not run under lint-only policy. No live-provider/native compaction or current strict-typecheck/build claim. [Current workflow and proof boundaries](docs/current-agent-workflow.md#ticket-model-overrides-and-context-compaction).

- Later explicit extension: global and per-ticket **No cumulative token limit** with cost warning/save confirmation. `null` is uncapped; omitted ticket cap inherits; numeric cap still bounds usage. Native goal omits `token_budget` and host skips only that token check; accounting, native compaction, fixed finite deadline, ownership and acceptance gates remain. Existing defaults/runs are not silently changed. Legacy resumes retain recorded progress limits when available. Browser/UI and lint verification only; additional backend/protocol tests added, not run. No guarantee of automatic completion or waived provider/account limits.

### Phase 5 engineering router

- Pstack-selected ticket implementation requires native `poteto-mode` and `pstack-pi` skill commands plus the native `task` tool in the actual author RPC session. Missing or disabled discovery fails before the implementation prompt with actionable setup diagnostics. Standard mode bypasses this requirement. No plugin installation or global configuration mutation is performed.
- Fresh authors invoke the installed router through native `/skill:poteto-mode` dispatch, not an implicit ticket mention. The host observes OMP's prompt-bound native skill record and retains its resolved path in existing run conversation/transcript storage. Playbook and project-verification reads remain observed tool activity, not proof of workflow compliance or acceptance.
- Same-session resume, bounded correction, and recovery retain the original workflow and do not initialize another router run. Model/thinking overrides, native goal continuation/compaction, budgets, evidence contracts, Human Needs review, and Autonomous host checks/restricted review/publication remain separate.
- Imported pstack autonomy/shipping instructions are subordinate to the host contract in the author system prompt and immutable objective. No scheduler, generic retry loop, settings UI, copied skills, ticket-agent commit grant, or executable plugin discovery in the restricted reviewer is added.
- Corrected a restricted-startup ancestor-plugin namespace gap. Private `work/.omp` now anchors plugin resolution; executable discovery remains disabled for acceptance review.
- Verification and current installed-version limits are recorded in [Current agent workflow](docs/current-agent-workflow.md#implementation-and-verification). Broader pstack parity, external shipping automation, and exhaustive provider/playbook coverage remain outside this delivery.

### Phase 7 prerequisite: engineering mode and token efficiency

- Implemented global Standard OMP / OMP + pstack selection and per-ticket inheritance/override. New configurations default Standard; legacy settings and sessions without a mode retain pstack.
- Admission snapshots mode alongside unchanged model/thinking and lifetime limits. Standard uses direct native implementation and applicable project verification skills; explicit pstack skill references cannot override that choice. Pstack alone performs capability preflight, native router dispatch and invocation observation.
- Pause/resume, bounded correction and same-attempt recovery retain the selected mode and cumulative accounting. Separately reviewed blocker restarts retain the source mode across settings changes and backend restart. Phase 7.1 added no general blocker-repair engine; Phase 7.2 below extends the existing runtime. Automatic mode escalation and budget increases or resets remain excluded.
- Both modes keep the existing host verification, restricted independent review and guarded local-publication contracts. Run details/history and Usage expose mode and recorded total consumption, including reviewers; token accounting is not actual provider billing.
- Verification evidence and observed equivalent-ticket consumption are recorded in [Current agent workflow](docs/current-agent-workflow.md#engineering-mode-verification-november-6-2026).

### Phase 7.2: autonomous blocker investigation and recovery

- Extend the existing autonomous run with durable typed failure and repair history. Keep the existing correction and recovery counters, scheduler, original author session, engineering mode, immutable revision, workspace claim, deadline, and cumulative author/reviewer accounting.
- Author-reported engineering blockers require host reproduction through the commissioned recipe and a scoped deterministic diagnostic. They share the single recovery allowance with incomplete verification. Host verification failures and independent reviewer findings retain the shared correction allowance. Unknown prerequisites, credentials, installations, product decisions, unsafe operations, infrastructure gaps, inconclusive review, exhausted limits, and ineffective repairs require assistance.
- Persist authorization and dispatch before repair. Duplicate submissions cannot grant another continuation. Explicit pause/resume retains instructions and limits. Restart reconciles ownership and preserves uncertain repair history without replay. A separate bounded read-only RPC retry never replays provider turns or mutations.
- Normalize diagnostics and bind failure fingerprints to recipe and candidate identity. Repeated ineffective failures stop; different failures do not reset bounds. Admission and running-author guards preserve final verification/review capacity without increasing budgets or promising monetary cost caps.
- Invalidate superseded evidence, capture the repaired candidate, execute the original final recipe, obtain a fresh restricted independent review, and use existing guarded publication and Done gates. Human review and operator-reviewed fresh retries retain their separate authority.
- Extend existing run and blocker panels with category, original blocker, attempt history, observed action, linked checks/reviews, token consumption, elapsed time, and outcome. Operator recovery instructions remain separate.
- Verification evidence and limitations are recorded in [Current agent workflow](docs/current-agent-workflow.md#bounded-recovery-exceptions). Deterministic process/Git fixtures remain distinct from explicitly opt-in live-provider checks. Phase 6B, adaptive mode switching, new installations, and external shipping remain deferred.

#### P0.3: native injected recovery validation

- Added opt-in `server/recovery-native.test.ts`, reusing the RPC native test's private synthetic-provider profile. Actual installed OMP executes source writes/checks and same-journal continuation; production recovery behavior is unchanged.
- Native synthetic scenarios cover failed host verification correction, independently reproduced author blocker and incomplete original criterion reporting. Each successful recovery requires fresh host verification, a distinct restricted native reviewer, exactly one guarded local commit and durable Done after SQLite/runtime restart. Native negative controls reject nonreproducible blocker claims and reviewer tool escalation; protocol suites retain broader policy/budget/revision/ownership/drift controls.
- November 8 validation passed all six native recovery/negative/cleanup tests on OMP 18.18.1, closing the scripted native recovery integration gap as **NATIVE_INJECTED_RECOVERY_PASS**. This is not **NATURAL_LIVE_RECOVERY_PASS**: November 8's CSV real-provider result remains PARTIAL, with natural recovery and complete lifetime usage still unproven. [Commands, retained proof and limitations](docs/current-agent-workflow.md#native-synthetic-provider-recovery).

#### P1: recovery reliability, CI and verification readiness

- Budget diagnostic keywords now require word boundaries, so “preserve” no longer denies an otherwise eligible engineering repair. Regression cases retain protected blockers and authored-path requirements; native recovery uses realistic whitespace diagnostics without weakening assertions or limits.
- [Ordinary GitHub CI](docs/ci.md) checks pull requests to `main` and pushes to `main` with frozen installation, TypeScript, lint, production build and deterministic tests. Installed native OMP and paid-provider validation remain separate; the native off-branch 146-token regression remains an unresolved failure.
- [Project verification commissioning](docs/verification-commissioning.md) defines scoped onboarding, feature/entry-point mapping, disposable defect sensitivity, bounded host recipes, restricted candidate review and explicit coverage limits. Guidance does not onboard another repository or enable autonomous completion.
- Phase 8 PR creation/CI consumption remains separately scoped: hosted CI must be observed, external-write authority designed and granted explicitly, and existing exact-candidate acceptance/security gates retained. No push, PR, merge or deployment automation is included here.




## 12. Opt-in autonomous local completion

Authorized implementation extends the existing OMP scheduler, not Cursor/Codex execution or an imported pstack loop. Current operating contract: [Autonomous completion](docs/current-agent-workflow.md#autonomous-completion).

- Separate revisioned Completion policy, Human review by default; explicit owner commissioning binds actual recipe bytes/argv, reviewer choice and bounded corrections/recovery. Start permission remains independent. Disabling revokes future autonomous phases, while pausing new starts leaves admitted work running.
- Clean baseline → author criterion reports/exact path declaration → stopped owned author → immutable candidate → actual commissioned host command → fresh restricted nonauthor review → bounded original-session correction if demonstrated findings → guarded local CAS publication → stopped-work host Done.
- One slot per attempt and fixed whole-attempt deadline/cumulative tokens across its roles. Independent repositories may own separate slots. Host receipts, author claims and independent review judgments remain distinct. Missing checks, stale recipe/candidate/requirements, identity mismatch, inconclusive review or exhausted bounds cannot publish.
- One shared recovery allowance covers narrow `incomplete_verification` continuation and host-reproduced, scoped engineering blockers. Both resume the original author within original limits. No general install/setup repair, credential invention, or automatic interrupted mutation replay is authorized.
- Durable publication intent recognizes the existing exact commit after crash, preserves unrelated staging/foreign locks and does not duplicate commits. Verified no-op Done creates no empty commit. Existing handoff gates are never implicitly cleared.
- UI separates project start/completion settings, commissioned policy confirmation, run stages/host proof/review/publication, and assistance count/filter. Default human review and operator Review & commit remain.
- Initial verification used disposable Git/protocol children and authenticated browser surfaces, not a real provider. Phase 5 subsequently exercised real native OMP/provider Human Needs review, autonomous host verification/fresh restricted review/guarded local publication/Done, and dependent Investigation no-op completion. All projects/data were disposable. No production repository commit or build was made; exact results and coverage limits are in the current workflow.

This does not claim full pstack parity, OS sandboxing/authorship attestation, universal provider/environment readiness, exhaustive acceptance coverage, or push/PR/merge/deploy authority. Each project needs its own commissioned meaningful recipe; unsupported workspace/file modes require assistance.

## 13. Unified Create with Agent — incremental delivery

**U1 baseline:** extend `/projects/:repoId/tickets/new/agent`, not a separate Planning Workspace. One project-scoped SQLite workspace owns discussion, saved composer and ticket-review text, selected model/thinking, and immutable plan revisions. Discussion / Plan / Tasks retain the same conversation. Quick ticket creation does not require a formal plan.

Reuse native restricted OMP drafting, host-selected context, existing Markdown/Preview editors, attachment staging, authentication/CSRF and reviewed single-ticket publication. Explicit Connect is distinct from Send. New native sessions receive bounded persisted text only on explicit Send; no historical inference replay, hidden summarizer, tools/skills/goal expansion or external-research credentials. Saved history is not proof of a live native process. Reconnection must fail closed on uncertain prior-child ownership.

Manual editor saves are version-bound. Plans remain independently editable; each save produces a new immutable revision, and approval binds to that revision only. Changing a plan does not grant ticket approval. Pasted attachment bytes remain tab-local; after reload, their Markdown references cannot publish without reattaching the required files.

**U1.1 / U2 scope:** stable browser-persisted pending turns with durable host receipt reconciliation and explicit exact-payload recovery; planning-aware discussion/planning/research/ticket-drafting/task-extraction intents; explicitly requested bounded host-only repository research with sanitized-content provenance; strict Auto/Single/Multiple JSON extraction with temporary keys and validated acyclic internal dependencies; immutable private proposal sets, explicit whole-set regeneration and plan-revision staleness inside the existing Tasks view. Valid output is persisted only after complete model output passes validation; failures preserve earlier sets and manual ticket-review edits. No new OMP tools, runtime or scheduler is introduced.

**U3 scope:** saved version-bound task review supports editing, selection, ordering and manual addition. A stale source plan requires explicit acknowledgment. Preview binds the selected review, allocated IDs, exact Markdown, dependencies and project execution mode; explicit confirmation publishes unapproved Draft tickets. Durable operation records support status checks and explicit same-confirmation recovery. Until integrity checks complete, the whole batch is hidden from ticket discovery and actions and barred from scheduling; blocked operations require inspection. This is not an atomic multi-directory rename; publication does not grant execution permission and Automatic mode retains its warned execution consequence.

**U3.5 recovery:** scoped authenticated inspection exposes per-ticket expected revisions, directory identities and file findings; explicit recovery revalidates the stored operation, pinned repository root identity, current project/mode, dependency bytes and directory identities before continuing. Legacy incomplete journals without a root identity fail closed. Confirmed payload authority survives later workspace edits. Interrupted/blocked tickets retain the activation barrier; unproven or foreign files are not adopted or cleaned up. Recognized renames are synced again before activation. Expired unused previews retain invalidated receipts; completed publications retain compact audit mappings and hashes, while recovery-critical journals remain full. Reservation and inactivity checks use indexed SQLite lookups. Minimal receipt cardinality is not capped because old confirmations must remain non-replayable.

**U4:** Planning proposals use an editable complete-candidate Markdown diff against the local Plan editor. Explicit acceptance rechecks local and fresh saved baselines, changes local text only, and rejects stale reviews without overwriting either version. Explicit saves append immutable revisions; exact-revision approval remains separate. Tasks and ticket details expose the existing publication journal's workspace/review/proposal-set/plan identities, dependencies and original ticket revisions, including compact completed records and modified tickets. No new planning store, route, agent, automatic inference or execution authority is added.

Per-task regeneration and approved external research remain deferred, not U4 requirements. Source retrieval verifies supplied bytes, not correctness of source/model claims. Deterministic fixtures do not prove real-provider planning quality. Verification results and limits are recorded in [Current agent workflow](docs/current-agent-workflow.md#u4-verification).

U1 validation: requested TypeScript, full lint, Vite build and ordinary test suite passed (309 tests, 21 opt-in skips); three installed restricted/native synthetic-transport checks passed separately. Actual-backend/protocol-child browser journeys covered persistence, plan and single-ticket review/publication, concurrency conflicts, failures and responsive Dark/Light layouts. The later focused runtime re-drive passed 16 overlapping tests. Current workflow records exact scope and the loss of transient screenshot files after runtime restart; neither full U2–U4 delivery nor live-provider planning is claimed.

U1.1/U2 validation: source-frozen ordinary suite passed 360 tests with 21 opt-in skips, zero failures across 43 files; strict TypeScript, full lint and the requested Vite build passed (large-chunk warning retained). Three installed OMP 18.18.3 restricted/native synthetic checks passed separately. Actual-backend/protocol-child browser proof covers Send recovery, host research, structured regeneration/review, stale/failure retention, cross-tab conflicts, reload/backend restart and legacy single-ticket publication with zero implementation runs. Dark/Light desktop/mobile were inspected. Proof and limitations: `/tmp/omp-u2-browser-8TTAyw/proof/result.json` and current workflow. No paid inference or U3 publication behavior is claimed.

## Initialization delivery

Provide a runnable Bun/React/Vite development app, strict TypeScript and lint commands, loopback-only development server, a read-only health endpoint, and a project overview linking this plan. Keep runtime state and local secrets out of source control. Do not start an OMP worker, register repositories, or mutate other projects during initialization.
