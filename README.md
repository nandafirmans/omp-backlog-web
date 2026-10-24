# OMP Backlog Web

Local, single-owner website for Markdown backlogs and OMP RPC execution. Approved requirements and lifecycle: [PLAN.md](PLAN.md).

See [Current agent workflow](docs/current-agent-workflow.md) for implemented changes, end-to-end ticket execution, evidence/review gates, operator reconciliation, verification status and remaining adoption work.

## Start

Requires Linux (process recovery uses `/proc`), Bun 1.3+, and an installed, configured `omp` for agent execution.

```bash
cd ~/Development/omp-backlog-web
bun install
bun server/setup.ts
bun run dev
```

Owner creation happens in the terminal, never through an open registration page. Open http://127.0.0.1:4310 and sign in. Never put the owner password or provider credentials in tickets or attachments.

The default data directory is `~/.local/share/omp-backlog-web`, outside repository source. `OMP_BACKLOG_DATA` selects a separate private data directory; `OMP_BACKLOG_PORT` selects a development port. Keep database, snapshots, and sessions together when backing up. Do not delete runtime data to resolve an interrupted run.

### Private remote access

Example endpoint: **https://backlog.example.com/**. Replace example domains and addresses with your own; never commit private deployment notes or credentials.

See the [private HTTPS over Tailscale runbook](docs/private-tailnet-https.md) for:

- Hostinger subdomain records and why public DNS does not make the application public.
- Caddy, acme.sh, certificate renewal, user services, and the canonical [`deploy/`](deploy/) configuration.
- Safe token entry in Bash or zsh, exact-origin configuration, and HTTPS cutover.
- Android Secure DNS, HTTP versus HTTPS failures, service diagnostics, and rollback.

Remote access remains tailnet-only and requires application login. Bun and Caddy bind to loopback; Tailscale supplies the external TCP listener. **Bun still runs manually in its owning terminal**—the proxy and renewal timer are the automatic services.

## Navigation

Home (`/`) puts projects first in a full-width, viewport-height workspace, with compact scheduler controls and rounded folder cards showing each project's path, execution permission, total ticket count, and nonzero lifecycle-status counts. Removed tickets are excluded. Ready counts describe ticket status, not a promise of execution: repository permission, dependencies, and the global slot still govern eligibility. Long paths truncate visually but remain available on hover. **Add project** opens the local-folder picker. **Home**, **Settings**, and **Implementation plan** live in the header; secondary navigation collapses under **Menu** on mobile. The pause control remains visible, and pausing new starts never stops a current run.

Global scheduler controls appear on Home only, not project, ticket, run, settings, or folder-picker pages. Project execution permissions and actionable active-run alerts remain contextual.

Header navigation pairs icons with visible labels and highlights the current page. The labeled theme button opens a keyboard-accessible menu for Tokyo Night, Kanagawa, Gruvbox, Catppuccin, Light, or System; selection persists locally. System follows operating-system appearance changes. Mobile navigation closes after following a link.

Project tickets use a compact execution header and a **Board / List** switch. Six visual stages retain exact status badges: **Draft**, **Ready**, **In progress** (Running, Stopping, Paused), **Needs attention** (Failed, Blocked, Interrupted), **Needs review**, and **Done**. Paused work still holds the global execution slot. Attention status chips filter the group without changing queue order. Cards show short failure/blocker reasons, recovery warnings, revision approval, and contextual review links.

Drag a card by its grip to reorder within a stage or request a supported move into Ready or Done. Cross-stage moves require explicit Yes/No confirmation before any request is saved: approve a Draft revision, retry Failed/Blocked/Interrupted work, request changes from Needs review, or accept revision-bound evidence as Done. Interrupted retries warn about remaining partial changes and repeated actions; Done shows acceptance criteria and recorded evidence. Execution-owned stages are not arbitrary drop targets, and active tickets cannot be dragged. Each card’s **Actions** menu provides the same moves plus Move up/Move down without dragging, including on keyboard and touch devices. Native dragging is intended for desktop pointers; touch users can use Actions. Reordering never changes the ticket’s exact status. Existing backend permissions, revision checks, review gates, and scheduler rules still apply.

Empty stages are hidden by default; eligible empty destinations appear temporarily during dragging. **Display** reveals empty stages or hides individual statuses inside their groups. Hidden matching tickets remain counted in the toolbar and footer. Layout and display preferences persist in this browser. Search filters titles and IDs without changing queue order. Canceling a confirmation leaves status and order unchanged; failed or stale requests show an error rather than an optimistic status change.

The board fills the remaining viewport rather than a centered, fixed-width wrapper. Its toolbar and footer stay visible; long columns scroll independently, with horizontal scrolling confined to the board. List view scrolls within the same workspace. Short mobile viewports can scroll the surrounding workspace to keep controls accessible. Status ordering, Board/List switching, and empty-group visibility follow the interaction patterns documented in [Linear's board layout guidance](https://linear.app/docs/board-layout).

Opening a ticket keeps the board in place and shows a right-side panel with readable requirements, permission/review actions, attachments, and run history. **Edit Markdown** opens the existing Markdown/Preview editors; **Reading view** becomes available again after saving unsaved work. **New ticket** opens a focused creation editor with optional Markdown import under **Import existing Markdown**. Panels can expand to full width and fit the mobile viewport. Closing follows normal route navigation, including unsaved-change confirmation, and returns focus to the originating card or New ticket control when available. **Project settings** contains the repository path and project switcher; execution permission and its consequences stay visible in the header.


- `/projects/new`: authenticated local-folder picker.
- `/projects/:repoId`: project permissions and backlog.
- `/projects/:repoId/tickets/new`: focused new-ticket panel.
- `/projects/:repoId/tickets/:ticketId`: readable ticket panel, editor, and run history.
- `/runs/:runId`: run details.
- `/settings`: workspace settings.
- `/plan`: implementation plan.

React Router supports direct links, reloads, and browser Back/Forward. Unknown projects, tickets, runs, and paths show an unavailable state instead of selecting another project. Unsaved ticket edits prompt before route changes and browser reloads.

## Ticket workflow

1. Add a local directory using the authenticated folder picker. Initial allowed root: `~/Development`.
2. New repositories start **Paused**. Create a Markdown ticket with an ID, title, a short request, optional constraints, and **Done when:** bullets describing observable results and verification.
3. Paste images or supported files into **Markdown** or **Preview**. Existing tickets upload immediately into their `attachments/` directory and insert relative image/file links without saving your text. New tickets stage files in the current tab until **Create ticket**. Use synthetic examples; explain what each screenshot or document demonstrates.
4. Save and inspect validation errors. Dependencies use ticket IDs within the same repository.
5. Approve the exact revision, then choose **Approved tickets only**. Changing Markdown or referenced attachments invalidates approval. **Automatic** is standing permission to execute eligible revisions; enable deliberately.
6. Watch the run, answer questions, and inspect verification evidence. **Needs review** is not **Done**. Confirm acceptance before dependents can run.

Ticket files remain editable outside the website:

```text
<repository>/.omp-backlog/tickets/T001/ticket.md
<repository>/.omp-backlog/tickets/T001/attachments/reference.png
```

Recommended document:

```markdown
---
id: T001
title: Add CSV export
depends_on: []
---

Export the currently filtered orders as CSV.
Preserve authorization and current filters. No scheduled exports or email delivery.

Done when:
- Export contains only matching rows.
- Commas, quotes, and newlines are escaped correctly.
- Unauthorized access is rejected.
- Verify through the browser action and inspect representative CSV output.

Reference: [Synthetic records](attachments/records.json)
```

`depends_on: []` means no prerequisites. Use `[T001, T002]` only when those tickets must be Done before this one starts. Existing tickets with an **Acceptance criteria** heading remain supported; separate Goal, Requirements, Scope, and Verification sections are optional.

### Editor controls

The workspace takes its terminal-inspired direction from [Nanda's portfolio](https://nandafirmans.my.id/): monospace chrome, themed surfaces, accent lighting, and subtle gradients. Rounded cards, panels, controls, editors, and dialogs share the selected palette, including Ant Design popups. Glow stays on accent controls, focused fields, and hovered cards rather than body text. Tokyo Night preserves the original slate/teal palette; the other terminal palettes change the entire interface. Light uses darker accents for contrast. Reduced-motion preferences disable decorative transitions.
Typography pairs self-hosted IBM Plex Sans for content with IBM Plex Mono for controls, metadata, and Markdown. Font files and their OFL license live in `public/fonts`; no external font requests are required. Browsers synthesize italics for these normal-only font faces so Markdown emphasis remains visible; weight synthesis stays disabled. App copy stays at 15px; desktop Markdown and editable Preview use 14px. Markdown increases to 16px on small screens to avoid mobile input zoom. Ant Design's compact density is disabled to keep controls readable.

Markdown source highlighting uses theme-aware Tokyo Night colors: blue headings, violet emphasis, teal links, amber code, green quotes, and quieter syntax markers. Font sizes stay unchanged.

- **Markdown** uses CodeMirror with syntax highlighting, line numbers, undo, and optional Vim keybindings. **Preview** is an editable MDXEditor surface with formatting controls, task lists, tables, links, images, and fenced code. Both modes share one draft; saving remains explicit.
- Preview keeps leading YAML metadata separate and read-only, preserving its bytes and line endings. Edit metadata in Markdown. Unsupported constructs, including raw HTML, show preserved source instead of silently dropping content.
- Paste uploads use unique filenames, enforce existing file limits, and preserve unsaved edits. Upload failures retain staged files and offer **Retry uploads**; interrupted ticket creation can finish without creating a second ticket. New-ticket staged files exist only in the current tab until creation succeeds. External revision conflicts require reconciliation before uploading. **Load current version** fetches the latest revision even after partial ticket creation and keeps staged files for retry; copy or download unsaved Markdown before replacing the draft.
- Every uploaded attachment needs at least one inline Markdown link or image with a nonblank purpose label or quoted link title, for example `[Expected export rows](attachments/rows.json)`. Incomplete drafts and uploads can be saved, but unreferenced files and missing purpose labels block approval and execution, including Automatic mode. Empty duplicate references are allowed when another reference to the same file supplies its purpose. Humans still review whether descriptions are meaningful and screenshots specify viewport and acceptable differences.
- Type `/skill:` to search installed skill names and descriptions. Type `@` to search files in the selected repository. Use arrows to choose a result and **Enter** or **Tab** to insert it; **Ctrl-Space** requests completion again. Files with spaces insert as `@"path with spaces"`.
- Toggle **VIM** in the editor toolbar for Vim keybindings. The preference persists in this browser. `i` enters Insert mode, **Esc** returns to Normal mode and dismisses completion, and `u` undoes edits. The toolbar displays the current mode.
- Completion shows loading, no-match, and request-error states without changing the draft. It never saves, approves, or starts work. **Save revision** remains explicit.

Skill suggestions use repository `.omp/skills`, `.agent/skills`, and `.agents/skills`, plus global `~/.omp/agent/skills`, `~/.omp/agent/managed-skills`, `~/.agent/skills`, and `~/.agents/skills`. `PI_CODING_AGENT_DIR` overrides the global OMP agent directory. Custom plugin/config skill sources are not enumerated. During execution, inline `/skill:NAME` references instruct OMP to read the installed `skill://NAME`; unavailable skills must be reported.

File suggestions return names only, respect Git ignore rules in Git repositories, and omit symlinks, sensitive filenames, dependency folders, and private application data. Searches are bounded and indicate truncated results. References do not grant execution permission or authorize reading credentials.

## Scheduling and recovery

The backend owns one active ticket globally. Filesystem events and periodic reconciliation refresh the persistent queue; no cron job is required. File changes alone do not grant permission. The browser may close without stopping execution.

Repository pause stops new starts, not the active run. Run pause interrupts goal continuation; stopping is not rollback. Inspect partial work before resuming or retrying. Blocked, failed, and interrupted work requires explicit operator action; unchanged failures are not blindly retried. Completing an old run cannot complete newly edited requirements.

An observed paused run keeps the global execution slot until explicitly resumed. A resumed run keeps the same session and immutable requirements; canceled questions must be asked again, never treated as consent. Startup reconciles surviving process identities before permitting new work; unresolved work becomes Interrupted rather than replaying automatically.

Git workspaces use **operator reconciliation**, not automatic commits or per-ticket worktrees. Git changes outside `.omp-backlog/` or unavailable Git inspection persist a project-level handoff gate and stop new starts in that project, without consuming each queued ticket as a blocked run. Dirty changes left after a run or interrupted-run recovery also require handoff. Home shows the warning; the project page lists affected paths, source run and recovery steps. Other projects can still use the global slot.

Review evidence/partial work, preserve unrelated edits, then reconcile in your terminal under your own authorization. The app never commits, stashes, resets, or deletes work. Choose **Recheck workspace** and confirm: authenticated inspection uses Git status with optional locks disabled; only a clean observed tree outside `.omp-backlog/` and no active/paused work can release the current gate. Dirty/unavailable Git stays blocked. Git ignore rules still apply; this is not sandboxing or proof about ignored files. Done, switching execution modes, and merely becoming clean do not clear a recorded gate. Clearing it may let eligible queued work start under existing permissions/dependencies/global pause; previously blocked tickets still need explicit retry. Non-Git workspaces have no Git handoff/changed-file guarantee.

Each run has a private requirements/attachment snapshot and a fresh OMP session. The scheduler advances between tickets; OMP goal mode continues within a ticket. No additional `/loop` is needed. Time and token limits prevent indefinite unattended continuation.

Token accounting includes the OMP session's reported usage, including repeated context/cache tokens and resumed turns—not just newly generated output. Large global instruction sets can consume the default budget quickly. Set a deliberate budget in Settings; exhaustion records Failed and requires review rather than silently increasing limits.

## Security boundaries

Loopback-only HTTP transport, owner sessions, CSRF protection, Host/Origin checks, authenticated attachment routes, and private storage protect dashboard access. `OMP_BACKLOG_ORIGIN` permits one exact HTTPS remote origin; the [private deployment](docs/private-tailnet-https.md) restricts remote connectivity to Tailscale without opening Bun or Caddy to the LAN. These controls do **not** sandbox OMP: it runs with the backend OS user's permissions. Repository separation is organizational. Agent commands and attachments must be reviewed accordingly.

This is a local Vite development website, not an Internet deployment. Do not bind it to a LAN address or reverse-proxy it publicly. Vite serves project source; keep secrets outside this project. No automatic commits, pushes, deployments, or destructive cleanup are authorized by ticket scheduling.

Markdown preview skips raw HTML and unsafe URL protocols. Mermaid uses strict security mode. Uploaded attachments are references, never executable validation scripts.

## Verification commands

```bash
bun run lint
bun run typecheck
bun run test
```

For isolated verification, use a disposable repository and a separate `OMP_BACKLOG_DATA` directory. Do not run smoke tickets against existing projects. A real model run requires working OMP provider authentication; provider failures are execution failures, not completion evidence.

Project-local recipe: [verify-backlog](.omp/skills/verify-backlog/SKILL.md), with a starter [feature map](.omp/skills/verify-backlog/features/README.md). Its helper uses installed Playwright, terminal-only owner setup and private disposable data; no automatic installs. Optional `--review-fixture` drives review paths using a protocol child, not a live provider. Explicit map maintenance lives in [maintain-backlog-verification](.omp/skills/maintain-backlog-verification/SKILL.md).

New ticket runs submit `backlog_evidence` receipts before `backlog_result`: criterion, feature/entry point, method/command, reported outcome/details and recipe identity, optionally a sanitized png/jpg/txt/json artifact. Each criterion needs reported passing checks; unresolved failed/blocked/not-run journeys prevent completion. Reports are **agent claims**, not independent command verification. Host records receipt identity/time and artifact bytes/hash. Proof is private and run-owned (100 receipts, 512 KiB/file, 10 MiB/run), authenticated on download, retained after run teardown, and never uploaded as requirement attachments. Legacy runs remain readable with unverified text evidence.

Request changes requires specific feedback through ticket panel, board Actions or drag confirmation. Feedback stays on the reviewed run/revision and is included in subsequent authorized attempts, including older-revision context. This does not bypass dirty-tree safety or authorize automatic commits. Blocked results trigger host-owned pause/shutdown without asking the model to complete an unmet goal. Run progress shows host activity and last reported OMP session-token usage with its accounting basis; no completion percentage is inferred.

The deterministic runtime integration suite uses a protocol-speaking child process, not a model or credentials. It covers real filesystem watch events, cross-repository fairness, the global execution slot, provider-error events after admission, pause/resume session identity, active revision edits, surviving-child recovery, and time/token limits. Keep this coverage distinct from a real OMP/browser smoke run; passing a fixture does not establish provider availability.
