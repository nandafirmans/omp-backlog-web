# OMP Backlog Web — approved implementation plan

## Scope and defaults

Build a single-user, local-only website with login, separate repository workspaces, Markdown tickets with attachments, a persistent scheduler controlling OMP through RPC, explicit execution permission, pause controls, and verification evidence.

Approved defaults:

- Single owner account; no public registration or roles.
- Loopback-only access.
- TypeScript + Bun backend, React + Vite frontend, SQLite database.
- Markdown ticket directories inside each repository.
- Repositories initially paused.
- One active ticket globally, with fair rotation between repositories.
- Fresh OMP session per ticket.
- Human completion review by default.
- No automatic commits, pushes, deployments, or destructive cleanup.

One backend process and one database are sufficient. Scheduling is a module inside the backend, not a separate service. No Redis, Docker, or multi-agent orchestration is needed.

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

- One active ticket globally initially.
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

## Initialization delivery

Provide a runnable Bun/React/Vite development app, strict TypeScript and lint commands, loopback-only development server, a read-only health endpoint, and a project overview linking this plan. Keep runtime state and local secrets out of source control. Do not start an OMP worker, register repositories, or mutate other projects during initialization.
