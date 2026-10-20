# OMP Backlog Web

Local, single-owner website for Markdown backlogs and OMP RPC execution. Approved requirements and lifecycle: [PLAN.md](PLAN.md).

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

Home (`/`) contains the project selector, **Add project**, **Settings**, and **Implementation plan**. There is no sidebar. The header's **Home** link returns to this hub from every page.

- `/projects/new`: authenticated local-folder picker.
- `/projects/:repoId`: project permissions and backlog.
- `/projects/:repoId/tickets/new`: new ticket editor.
- `/projects/:repoId/tickets/:ticketId`: ticket editor and run history.
- `/runs/:runId`: run details.
- `/settings`: workspace settings.
- `/plan`: implementation plan.

React Router supports direct links, reloads, and browser Back/Forward. Unknown projects, tickets, runs, and paths show an unavailable state instead of selecting another project. Unsaved ticket edits prompt before route changes and browser reloads.

## Ticket workflow

1. Add a local directory using the authenticated folder picker. Initial allowed root: `~/Development`.
2. New repositories start **Paused**. Create a Markdown ticket with an ID, title, goal, requirements, acceptance criteria, scope, and verification instructions.
3. Upload references into the ticket's `attachments/` directory and link the files from the Markdown. Use synthetic JSON; explain what each screenshot or document demonstrates.
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

# Goal
Export the currently filtered orders as CSV.

# Requirements
- Preserve authorization and current filters.

# Acceptance criteria
- Export contains only matching rows.
- Commas, quotes, and newlines are escaped correctly.
- Unauthorized access is rejected.

# Out of scope
- Scheduled exports and email delivery.

# Verification
Exercise the browser action and inspect representative CSV output.

# Attachments
- [Synthetic records](attachments/records.json)
```

### Editor controls

The workspace uses Ant Design with a terminal-style monospace theme. Choose **System theme**, **Dark theme**, or **Light theme** in the header; the selection persists in this browser.
Typography uses semibold text, 15px controls/body copy, 13px minimum helper text, and a 16px Markdown editor. Ant Design's compact density is disabled to keep controls readable.

- Markdown entry uses CodeMirror, including syntax highlighting, line numbers, undo, and the existing preview.
- Type `/skill:` to search installed skill names and descriptions. Type `@` to search files in the selected repository. Use arrows to choose a result and **Enter** or **Tab** to insert it; **Ctrl-Space** requests completion again. Files with spaces insert as `@"path with spaces"`.
- Toggle **VIM** in the editor toolbar for Vim keybindings. The preference persists in this browser. `i` enters Insert mode, **Esc** returns to Normal mode and dismisses completion, and `u` undoes edits. The toolbar displays the current mode.
- Completion shows loading, no-match, and request-error states without changing the draft. It never saves, approves, or starts work. **Save revision** remains explicit.

Skill suggestions use repository `.omp/skills`, `.agent/skills`, and `.agents/skills`, plus global `~/.omp/agent/skills`, `~/.omp/agent/managed-skills`, `~/.agent/skills`, and `~/.agents/skills`. `PI_CODING_AGENT_DIR` overrides the global OMP agent directory. Custom plugin/config skill sources are not enumerated. During execution, inline `/skill:NAME` references instruct OMP to read the installed `skill://NAME`; unavailable skills must be reported.

File suggestions return names only, respect Git ignore rules in Git repositories, and omit symlinks, sensitive filenames, dependency folders, and private application data. Searches are bounded and indicate truncated results. References do not grant execution permission or authorize reading credentials.

## Scheduling and recovery

The backend owns one active ticket globally. Filesystem events and periodic reconciliation refresh the persistent queue; no cron job is required. File changes alone do not grant permission. The browser may close without stopping execution.

Repository pause stops new starts, not the active run. Run pause interrupts goal continuation; stopping is not rollback. Inspect partial work before resuming or retrying. Blocked, failed, and interrupted work requires explicit operator action; unchanged failures are not blindly retried. Completing an old run cannot complete newly edited requirements.

An observed paused run keeps the global execution slot until explicitly resumed. A resumed run keeps the same session and immutable requirements; canceled questions must be asked again, never treated as consent. Startup reconciles surviving process identities before permitting new work; unresolved work becomes Interrupted rather than replaying automatically.

Git workspaces with pre-existing changes outside `.omp-backlog/` are conservatively blocked: inspect/reconcile those changes, then explicitly retry. The app never resets the tree. Non-Git workspaces have no Git changed-file summary.

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
