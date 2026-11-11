# OMP Backlog Web

Local, single-owner website for Markdown backlogs and OMP RPC execution. Approved requirements and lifecycle: [PLAN.md](PLAN.md).

See [Current agent workflow](docs/current-agent-workflow.md) for implemented changes, end-to-end ticket execution, evidence/review gates, operator reconciliation, verification status and remaining adoption work.

UI conventions and consistency checks: [Workspace design language](docs/design-language.md). The project board is the reference for shared typography, controls, surfaces and responsive layout.

## Start

Requires Linux (process recovery uses `/proc`), Bun 1.3+, and an installed, configured `omp` for agent execution. Standard OMP implementation does not require pstack. Selecting OMP + pstack requires the installed [pstack-pi fork](https://github.com/nandafirmans/oh-my-pstack), native `poteto-mode` and `pstack-pi` skill commands, and native `task`. The app does not install plugins or change global OMP settings.

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

Projects (`/`) puts repositories first in a full-width workspace, with compact scheduler controls and folder cards showing path, execution permission, total ticket count and nonzero lifecycle-status counts. Removed tickets are excluded. Ready counts describe status, not execution eligibility. Long paths remain available on hover. **Add project** opens the local-folder picker.

Global scheduler controls appear on Projects only. Project execution permissions and active-run alerts remain contextual. Pausing new starts never stops a current run.

The brand returns to Projects. The compact header contains Settings and Log out icon controls with accessible names/tooltips, plus a semantic connection-status icon. Theme selection lives under **Settings > Appearance**, applies immediately and persists in this browser. System follows operating-system appearance changes. The implementation plan remains available directly at `/plan`, not in the navbar.

Project tickets use a compact execution header and a **Board / List** switch. Six visual stages retain exact status badges: **Draft**, **Ready**, **In progress** (Running, Stopping, Paused), **Needs attention** (Failed, Blocked, Interrupted), **Needs review**, and **Done**. Paused work still holds a worker slot and workspace ownership. Attention status chips filter the group without changing queue order. Cards show short failure/blocker reasons, recovery warnings, revision approval, and contextual review links.

Drag a card or its grip to reorder within a stage or request a supported move into Ready or Done. Drop above or below a card to choose its position; hold near the board’s horizontal edges or a column’s vertical edges to scroll. Cross-stage moves require explicit Yes/No confirmation before status and position are saved together: approve a Draft revision, retry Failed/Blocked/Interrupted work, request changes from Needs review, or accept revision-bound evidence as Done. Interrupted retries warn about remaining partial changes and repeated actions; Done shows acceptance criteria and recorded evidence. Execution-owned stages are not arbitrary drop targets, and active tickets cannot be dragged. Each card’s **Actions** menu provides the same moves plus Move up/Move down without dragging, including on keyboard and touch devices. Native dragging is intended for desktop pointers; touch users can use Actions. Reordering never changes the ticket’s exact status. Existing backend permissions, revision checks, review gates, and scheduler rules still apply.

Empty stages are hidden by default; eligible empty destinations appear temporarily during dragging. **Display** reveals empty stages or hides individual statuses inside their groups. Hidden matching tickets remain counted in the toolbar and footer. Layout and display preferences persist in this browser. Search filters titles and IDs without changing queue order. Canceling a confirmation leaves status and order unchanged; failed or stale requests show an error rather than an optimistic status change.

The board fills the remaining viewport rather than a centered, fixed-width wrapper, with a 680px minimum height to leave usable card and drop space after toolbars and notices. When space runs out, the surrounding workspace scrolls vertically to reach the board and footer. Long columns still scroll independently, with horizontal scrolling confined to the board. Empty-stage drop zones fill the available column body; card grips are visible 36px targets. List view scrolls within the same workspace. Status ordering, Board/List switching, and empty-group visibility follow the interaction patterns documented in [Linear's board layout guidance](https://linear.app/docs/board-layout).

Opening a ticket keeps the board in place and shows a right-side panel with readable requirements, permission/review actions, attachments, and run history. **Edit Markdown** opens the existing Markdown/Preview editors; **Reading view** becomes available again after saving unsaved work. **New ticket** opens a focused creation editor with optional Markdown import under **Import existing Markdown**. Panels can expand to full width and fit the mobile viewport. Closing follows normal route navigation, including unsaved-change confirmation, and returns focus to the originating card or New ticket control when available. Use **Projects** in the breadcrumb to switch projects. Hover the project title for its repository path; project cards on Projects also expose the path. The execution selector shows a mode-specific icon and full permission label in both the field and menu; its consequences and non-Git tracking warnings remain visible below the header.


- `/projects/new`: authenticated local-folder picker.
- `/projects/:repoId`: project permissions and backlog.
- `/projects/:repoId/tickets/new`: focused new-ticket panel.
- `/projects/:repoId/tickets/new/agent`: unified Create with Agent page with persistent discussion, read-only research, revisioned plan, generated task proposals and legacy single-ticket review.
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
6. Watch the run, answer questions, and inspect verification evidence. Human review is the default: **Needs review** is not **Done**. Alternatively commission the separate [autonomous completion policy](#autonomous-completion-opt-in). Dependents wait for Done in both modes.

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

### Engineering mode

**Settings → Engineering Mode** chooses Standard OMP or OMP + pstack. New configurations default to Standard OMP; older persisted configurations without this field retain pstack. Saved tickets offer **Inherit global**, **Standard OMP**, and **OMP + pstack** under **Next attempt · mode, model & budget**.

Standard OMP implements directly through native tools and goal continuation, retaining applicable project verification skills. It does not run pstack discovery, router activation or invocation observation. Explicit poteto-mode/pstack-pi references in requirements do not override Standard selection; a genuine mode conflict must be reported as blocked.

Pstack runs preserve the installed engineering workflow. Before prompting, their author RPC session must expose both native skill commands through `get_available_commands` and `task` through `get_state`. Missing/disabled capabilities fail closed without fallback. Fresh startup submits one native `/skill:poteto-mode` prompt and observes its actual `skill-prompt` record before creating the native goal. The bounded observation sends no second prompt and is not an implementation retry loop.

Admission snapshots effective mode, model/thinking and limits. Run details, Usage and execution history show the selected mode; changing settings does not change active work. Same-session pause/resume, bounded correction and incomplete-verification recovery preserve the author session, selected workflow, original deadline and cumulative accounting. A separately reviewed blocker retry starts a new authorized attempt but retains the source run's mode, including after backend restart. No adaptive switching or automatic escalation is added.

Both modes retain host scheduling, revision-bound evidence, host verification, fresh restricted acceptance review, guarded local publication and Done gates. Human-reviewed completion still stops at Needs review. Ticket drafting and restricted acceptance review do not load the router. Enabling pstack does not increase budgets. Usage includes recorded reviewer consumption; accounted input/output/cache tokens are not actual provider billing or a spending limit.

Pstack run conversation/transcript records the router path observed in OMP's native invocation message. Skill/playbook reads remain tool observations, not proof of adherence or acceptance. Package revision is not inferred from a skill name. See [current mode behavior and verification](docs/current-agent-workflow.md#implementation-and-verification).

Optional installed-environment discovery checks use `OMP_BACKLOG_NATIVE_TESTS=1 bun test server/engineering-native.test.ts`. They exercise the author RPC launch profile with installed, disabled, and isolated missing-plugin controls plus a synthetic project-local verification skill. They submit no inference and do not prove live-provider completion.

### Create with agent (optional)

**New ticket** retains the manual Markdown/import drawer. **Create with agent** opens the existing dedicated route: Discussion → Research → Living Plan → Generate Tasks → Review Proposals. A formal plan is optional for quick tickets.

- Create, reopen, rename or archive a project-scoped workspace on that page. This browser remembers the last opened workspace for each project; its contents remain in private SQLite storage. Saved messages, model/thinking selection, composer text, plan revisions and ticket-review Markdown survive reload and backend restart. Save editor changes explicitly before leaving; unsaved changes remain protected. Pasted attachment bytes still live only in the current tab: after reload, reattach files before publication. A saved Markdown link is not a saved upload.
- **Discussion / Plan / Tasks** are views of the same workspace. The conversation remains available while editing a plan or reviewing generated proposals. Response intents **Discussion**, **Planning**, **Research** and **Ticket drafting** share that context. Ordinary discussion/planning does not require ticket frontmatter; Ticket drafting preserves `id`, `title`, `depends_on` and observable `Done when:` Markdown. **Generate Tasks** selects the structured `task_extraction` intent.
- **Connect to OMP** is explicit and does not send a model turn. Select an enumerated model and supported thinking level; unavailable selections never silently fall back. **Send message** starts inference. Before submission, IndexedDB durably reserves one key and the exact multipart fields/upload bytes for that workspace. Lost responses or reload never create an automatic inference retry. Host receipts reconcile accepted turns across backend restart; **Check pending Send** reads state, **Retry exact saved request** checks state before resubmitting the same key/bytes, and **Discard unaccepted request** records a durable rejection before clearing local pending state. Modified payloads require a new identity. Browser storage failure blocks Send rather than losing recovery identity.
- Use `@file`, quoted-space paths and `/skill:NAME` completion, or paste files/images into the composer. **Check context** validates host-selected bytes. Unreadable references must be replaced or explicitly excluded. UTF-8 text and supported PNG/JPEG/GIF inputs are supported; PDF/Office and WebP remain reference-only. Source text and skill bodies grant no execution authority; skill scripts cannot run.
- Discuss a plan in the same conversation, then explicitly review its proposed text before applying it to the editable Plan. Saving creates an immutable revision; approving binds to that exact revision. Further edits create an unapproved revision. Plan approval never approves a ticket or grants execution.
- A simple ticket needs no formal plan. **Review as single ticket…** transfers assistant text to the existing Markdown/Preview ticket editor, with confirmation before replacing human edits. Single-ticket creation still validates the complete Markdown and staged attachment bytes, requires an exact-payload/current-mode confirmation and never overwrites an existing ID.
- **Disconnect** and **Cancel turn** stop owned native work while retaining saved discussion and available partial output. Reconnection and another Send are explicit. A failed/interrupted turn is never automatically replayed. Saved conversation does not imply a live native process.
- **Read-only repository evidence** accepts exact repository-relative paths suggested by you or the agent. Explicit retrieval independently checks registration, permitted roots, private-data exclusion, traversal, symlinks, regular files, UTF-8 and resource limits. Safe project verification recipes/feature maps and existing ticket Markdown can be read; credentials/authentication files cannot. Credential-like sources are withheld completely. No shell, tools, installation, repository writes or internet access is enabled. External research remains explicitly unavailable and never blocks repository work.
- References carry host identity, path, retrieval time and SHA-256 of sanitized supplied content. **Host-retrieved snapshot** attests retrieval, not source correctness, model understanding or current-file freshness. Model assumptions/suggestions and unresolved questions remain separate from that provenance; citations must name provided reference IDs.
- **Generate Tasks** explicitly starts one turn: **Auto** recommends one or multiple independently verifiable outcomes and explains the breakdown; **Single** requires exactly one; **Multiple** requires 2–12 scoped proposals. The host accepts one complete strict JSON object, not Markdown fences, with workspace/plan identity, rationale, temporary `task-*` keys, descriptions labeling Why/Scope/Out-of-scope, acceptance criteria, verification, dependencies, source reference IDs and open questions. Unknown/duplicate keys, self/cyclic/unknown dependencies, missing/extra fields and limit violations reject extraction. No hidden repair or provider retries occur.
- Valid results become immutable private proposal sets containing generation time, strategy, exact source plan revision and research references. Reload/backend restart retains every accepted set. Explicit regeneration appends a new set and preserves existing single-ticket review edits; malformed/failed/partial output leaves earlier sets untouched. Changing the current plan marks older sets stale without overwriting them. Tasks exposes criteria, verification, dependencies, source identity, rationale and questions. Generation creates no tickets or implementation runs.

**Batch review and publication:** Choose a saved proposal set and edit, select, reorder or add tasks. Save the task review separately; incomplete drafts can be saved. Dependency feedback identifies missing, self and cyclic references. The host validates the selected tasks at preview; task keys use the `task-*` format, descriptions need Why/Scope/Out-of-scope, and selected tasks need observable criteria and verification. Review and explicitly acknowledge a stale source plan before previewing it.

The preview displays the exact allocated IDs, dependencies, ticket Markdown and project execution mode. Confirm that mode and exact preview explicitly to publish unapproved Draft tickets. Automatic mode may start eligible work under existing project permissions; publication is not execution approval. Batch publication does not include attachments.

After an uncertain response or restart, check the saved operation and choose **Inspect publication**. Inspection shows expected revisions, staged and published directory identities, file findings and reasons; it does not alter files. If the operation is safe to resume, **Resume same publication** requires explicit confirmation and rechecks the journal, pinned repository root identity, project mode, dependencies and filesystem. Unproven staging or conflicts remain blocked for operator inspection; no file is automatically adopted, overwritten or deleted. Legacy incomplete operations without a pinned root identity cannot be resumed automatically; inspect them and request a new review. Changes to the saved workspace after publication began do not change the confirmed payload. Nothing is automatically replayed.

Incomplete or blocked batches remain hidden from ticket discovery, actions and scheduling until integrity checks complete. Individual directories may already be visible to filesystem users; publication is not an atomic multi-directory transaction. A workspace permits at most 64 outstanding unexpired previews or interrupted operations. Its snapshot shows at most 128 prioritized operations; older confirmations remain directly addressable. Expired unused previews become permanently invalidated receipts. Completed publications retain compact audit mappings and hashes instead of full Markdown previews; incomplete journals remain intact for recovery. Minimal receipts remain durable so old confirmations cannot publish twice. No ticket files are cleaned up automatically. Per-proposal regeneration remains unavailable. See [recovery boundaries and verification](docs/current-agent-workflow.md#agent-assisted-creation).

Single-ticket publication retains its existing boundary: ten-minute confirmations and unchanged-payload retries are process-local; backend restart/expiry requires renewed review. Atomic no-overwrite directory publication requires Linux/glibc `renameat2(RENAME_NOREPLACE)` and filesystem support. This is **not** a multi-directory transaction or durable batch journal. **Automatic may start implementation after explicit single-ticket creation** under standing project permission; Approved-only still requires ticket revision approval, and Paused prevents starts.

Author execution, drafting, execution-model discovery, and restricted acceptance review use **OMP 18.x plus capability checks, not an exact-version allowlist**. Minor and patch updates within major 18 are admitted; other majors or unreadable versions stop before author/reviewer work and require compatibility review. The CLI must also negotiate lossless RPC v2 and implement the required commands and state shapes; incompatible peers fail closed without unrestricted fallback. Restricted sessions use a private HOME/config/discovery namespace and working directory, no ambient executable project discovery, and bounded host-selected context. Drafting/discovery require empty tools and no goal; the reviewer must start empty, then expose exactly `candidate_diff`, `candidate_source`, and `backlog_review` before its prompt. Existing local OMP authentication stays inside OMP; executable config-based credential resolution and custom model/plugin configuration are not inherited by restricted sessions. Configure provider authentication outside this website. These capability restrictions are **not an OS sandbox**. Runtime metadata cannot prove a future CLI honors startup isolation before loading code; rerun native import-sentinel checks after CLI upgrades. Explicit metadata/model selection can make discovery/auth requests and OMP's credential-less connection probe; no drafting inference runs before Send.

Minor/patch release numbers within OMP 18.x no longer require application edits or downgrades; a new major requires explicit compatibility review. The token-accounting gap remains an accepted operational limitation: limits are best-effort based on reported usage, not hard lifetime usage or monetary spending caps. Real-provider Phase 7.2 recovery has not yet been proven; run its separate opt-in test only with authorized provider access.

Phase 7.3 found that a host ledger derived only from `get_entries` would still be incomplete: background skill-description compression records cost without durable token events, discarded assistant replacements change entry IDs, and child observability is not a durable exhaustive usage inventory. No cumulative ledger was added. Existing token samples are not proven lifetime consumption, regardless of release.

Drafting limits: four live conversations; 32 KiB prompt; 128 KiB per text reference; 512 KiB per image subject to 256 KiB combined readable context and the inbound RPC frame limit; 16 turns; 32K accounted session tokens; two minutes/turn; ten-minute idle and 45-minute session expiry. Ordinary ticket attachment limits still apply. Previously transmitted images prevent switching that conversation to a text-only model; start a fresh conversation instead.

Persistent workspace limits: 16 per project and 64 total, including archived workspaces; 32 plan revisions; 32 KiB per prompt/plan; 256 KiB combined saved editor text; 128 messages, 64 accepted turns and 512 KiB saved history. New-session context selects at most the latest 12 messages with the current plan, capped at 64 KiB of encoded text; oversized history/plan truncation is disclosed in Model context, with no generated summary. Archiving preserves data and does not free quota. Limits reject further writes rather than deleting earlier work. Native-session limits above remain separate and reported-token caps remain best-effort.
Research limits: 12 sources per retrieval, 128 KiB per text file and 256 KiB combined raw retrieval; persisted workspace research is further bounded to 32 references / 48 KiB encoded content. References identify historical snapshots; retrieve explicitly again when freshness matters. Extraction limits: 12 proposals, 64 KiB output, 12 retained sets / 256 KiB aggregate. Limits reject further writes without deleting previous artifacts. Accepted/rejected turn keys are retained rather than evicted. Pending Send upload bytes are stored in this browser solely for exact-request recovery; publication attachments otherwise remain tab-local and may need reattaching.

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

The backend owns a bounded global pool. **Settings > Run limits > Concurrent tickets** accepts 1–4, defaulting to 1 for existing and new installations. Capacity 2 permits two independent repositories to run together. Each run retains its own RPC process, session, immutable requirements, evidence, limits and completion policy. One scheduler scans past busy projects in deterministic least-recently-started order. Filesystem events and periodic reconciliation refresh the persistent queue; no cron job is required. The browser may close without stopping execution.

Running, stopping and paused work consume slots. Reducing capacity does not terminate existing runs. Global pause prevents new starts without canceling active work. Per-run pause, resume and cancellation address only the selected run. Cancellation stops owned work, preserves partial edits and evidence, and leaves an Interrupted attempt requiring explicit review and retry.

Only independent workspaces may overlap in time. Canonical filesystem identity, overlapping parent/child paths and shared Git common-directory ownership exclude aliases and linked worktrees. Same-repository parallel execution remains disabled. Unknown workspace/process ownership fails closed. Workspace exclusion is not OS sandboxing. See [Phase 6 architecture and worktree recommendation](docs/phase-6-concurrent-execution.md).

Repository pause stops new starts, not the active run. Run pause interrupts goal continuation; stopping is not rollback. Inspect partial work before resuming or retrying. Human-reviewed blockers and stopped failed/interrupted work require explicit operator action. Opted-in autonomous projects may authorize the bounded same-attempt recovery below; unchanged failures are never blindly retried. Completing an old run cannot complete newly edited requirements.

Blocked tickets show **Blocker recovery**: the agent-reported prerequisite, recommended fix, attempts, permission needed, verification plan and retained partial evidence. Edit **Recovery instructions**, then **Save recovery note**. Notes persist privately with the source run, separate from requirement Markdown/attachments; saving neither approves nor starts execution. Legacy blockers get a suggested prompt without inventing missing attempt details. Recognized credential patterns are redacted, not comprehensively scanned—never enter secrets.

**Review fix & retry** explicitly approves the current requirements revision and exact saved note for a fresh attempt. Stale source runs, notes or revisions require renewed review; requirement edits require saving a note for the new revision. Board Actions and dragging blocked work toward Ready open its recovery panel rather than silently retrying. The next admitted run snapshots the reviewed context; previous evidence does not count as fresh passing checks. Workspace reconciliation, permissions, pauses, dependencies, capacity and workspace exclusion still apply. No automatic retry, installation or expanded execution authority is added.

An observed paused run keeps its slot and workspace ownership until explicitly resumed or canceled. A resumed run keeps the same session and immutable requirements, even after capacity is reduced; canceled questions must be asked again, never treated as consent. Startup reconciles every surviving process identity before admitting conflicting work. Uncertain surviving ownership remains Stopping and consumes capacity; observed stopped interrupted work requires explicit retry rather than replay.
### Autonomous completion (opt-in)

Project **Completion: Human review / Autonomous** is separate from **Execution permission** and global new-start pause. Existing projects remain human-reviewed. Enabling requires an attached, committed, clean Git workspace with no recorded handoff or active/paused owner.

Enter the exact verification **argv JSON array**, existing repository-relative recipe files, timeout, and correction/recovery limits. Explicit confirmation authorizes host-executed checks, a fresh restricted nonauthor OMP review, one exact-candidate local commit, and automatic Done—not push, PR, merge, deploy, installs or arbitrary setup. Recipe bytes/configuration are pinned at save; changed recipes require explicit recommissioning. A blank reviewer model inherits the actual attempt model in a distinct session, not necessarily another model family.

Normal path: **Implement → Host verification → Independent review → Local publication → Done**. Author reports alone cannot complete. Demonstrated check/review failures share at most two corrections. Incomplete original verification and host-reproduced, scoped engineering blockers share at most one recovery. All continuations resume the original author with unchanged mode, deadline, and cumulative accounting. Repair admission reserves capacity for final checks and fresh review; it never raises a cap. Credentials, permissions, unapproved installations, product decisions, unavailable infrastructure, ineffective repairs, inconclusive review, drift, and exhausted limits enter **Needs assistance** with retained history and manual recovery controls. See [recovery categories and safeguards](docs/current-agent-workflow.md#bounded-recovery-exceptions).

Within each attempt, all roles share one ownership slot, finite deadline and cumulative token accounting. Independent repositories retain separate candidate trees, receipts, reviewer sessions and publication authority. Pausing new starts leaves admitted attempts running; **Pause run** stops selected owned work and retains its slot. Saving Human review revokes future autonomous phases. Interrupted mutation is never replayed. Durable publication intent reconciles an already-published exact commit without creating another; uncertainty requires assistance. Verified no-op tickets become Done without an empty commit. A pre-existing handoff is never automatically released.

Run **Evidence** separates author claims, actual host argv/exit/output receipts, independent reviewer findings, candidate/recipe identities, and publication hash. Board/list stages remain coarse; phase labels and **Needs assistance** filtering expose progress/exceptions.

Scope and limits: [current autonomous workflow](docs/current-agent-workflow.md#autonomous-completion). Author commands and commissioned checks retain backend OS permissions; neither a clean tree nor a declared author-file list proves OS-level authorship. Keep external editors/Git idle during autonomous work. Unsupported/sensitive/binary changes, Git filters/links/submodules, flagged indexes and oversized snapshots fail closed rather than being swept into a commit. Every target project needs its own trusted acceptance recipe.


### Live run conversation

Run details open on **Transcript**. Use **Evidence** for expandable requirement criteria, evidence notes and verification receipts; **Files** for the recorded change summary; and **Usage** for token/context meters, progress and expandable run identifiers. The header keeps run status, ticket context, reported-check counts and unresolved-check navigation visible. Errors, blockers, revision warnings and agent questions remain visible regardless of the selected tab. Switching tabs preserves transcript inspection; opening another run resets to Transcript. None of these views accepts work or changes execution permissions.

Run details show a read-only, OMP-style conversation: streaming agent Markdown, tool action summaries, expandable sanitized arguments and partial/final results, and explicit running/error states. A completed tool call is not verification or acceptance. Questions and approvals still use the existing run controls; the transcript is not a message composer.

Tool cards show the recorded file path or command and a bounded eight-line output preview before expansion. Read/result envelopes are decoded into readable text; application JSON is pretty-printed and long text wraps within the browser. Edits show actual source-numbered context, additions and removals—not hashline `PUT` instructions or invented preview-row numbers. Patch instructions remain under **Recorded arguments & raw result**. Write contents without a result diff are explicitly labeled **Recorded input · not a confirmed file change**; failed file tools prioritize their error. Opening a tool pauses following so streaming does not pull you away.

Truncated recordings keep a visible warning. Complete text blocks can be recovered from a truncated JSON envelope and are labeled as a partial preview; incomplete strings are not repaired, and missing diffs are not invented. Expansion exposes retained content only, not the original unbounded result.

New tool recordings retain sanitized result diffs independently before large raw results are truncated, within the same per-field and total conversation limits. Streaming diffs are previews; a final result without a diff does not confirm an earlier preview. Older runs can show a source diff only if it was retained; otherwise the view explicitly reports it unavailable rather than substituting patch instructions.

Source diffs and agent code fences use the existing CodeMirror language grammars for syntax colors, selected by file extension or fenced language. Multi-file diffs switch grammar at file headers. Added/removed markers and theme-aware backgrounds remain visible alongside syntax colors, including wrapped continuation lines. Unknown languages remain plain source; a grammar-load failure preserves the text and labels highlighting unavailable. No source is interpreted as browser HTML.

The transcript toolbar shows a spinner and **Agent executing…** while the recorded run is running, even between tool calls. Questions switch it to **Waiting for your response**; stopping retains a spinner, while paused and finished runs show explicit non-spinning states. This reflects run status, not percentage completion or proof of current tool execution. Reduced-motion preferences disable animation while keeping the label visible.

The conversation follows new output only while at the bottom. Scroll up to inspect earlier work; **Jump to latest** resumes following. Entries persist across reload and same-session resume. Unfinished entries are marked stopped when execution pauses or ends. Older runs retain their plain transcript; missing tool details are not reconstructed. Structured runs show only the conversation, without a separate legacy/raw log panel.

Display retention is bounded: 10,000 characters per field, 256 entries and 192,000 serialized characters, with omission/truncation notices. Recognized credential values are redacted and image/evidence bytes omitted before new transcript persistence. This is not a complete secret scanner; never instruct agents to read or print credentials. Private reasoning is not displayed.

Human-reviewed Git workspaces and exceptional autonomous stops use **operator reconciliation**, not blanket auto-commits or per-ticket worktrees. Git changes outside `.omp-backlog/` or unavailable inspection persist a project handoff gate and stop new starts without consuming each queued ticket. Home/project notices expose the reason, paths and source run. Other independent projects can still use available capacity. Successful autonomous publication needs no operator handoff when its exact workspace is clean; it never clears a pre-existing gate.

Review partial work and preserve unrelated edits. Reconcile in your terminal, or use the explicitly confirmed **Review & commit** action below. Handoff does not grant automatic publication, push, stash, reset or cleanup. **Recheck workspace** clears only the current gate after a clean observed tree outside `.omp-backlog/` and no active/paused owner. Dirty/unavailable inspection stays blocked. Done, mode changes and merely becoming clean do not release it. Other start/dependency/retry rules still apply. Non-Git workspaces have no Git handoff/changed-file guarantee.

### Operator-controlled local commits

In the handoff panel choose **Review & commit**, inspect each HEAD-to-working-tree diff, file mode and optional complete before/after text, select individual files, enter a commit message, then **Review commit → Confirm commit**. No files are preselected. Back/cancel creates no commit; closing an unsaved draft requires confirmation. Initial commits are supported. The reviewed working-tree version of each selected file is committed (including deletion/executable mode); its older staged version, if any, is replaced. Unselected staged/unstaged work remains untouched. Staged-only content is not a separate commit choice.

Authenticated/CSRF-protected operations require the current handoff and no running/stopping/paused run. Reviews expire after ten minutes; changed HEAD, branch, index or reviewable content requires re-review. A shared operation gate excludes concurrent Recheck/commit actions; the commit takes Git's index lock, prepares private indexes and exact reviewed blobs, then compare-and-swaps the branch reference. Commit failures are never automatically replayed. Keep external editors/Git operations idle while confirming; this is not an OS-level workspace freeze. A rare failure after branch publication reports the created hash and requires terminal inspection rather than blind retry.

Hooks, signing, external diff drivers and clean filters are not executed. Git identity must already be configured. Detached HEAD, in-progress merges/rebases/sequencers and split indexes require terminal reconciliation. Sensitive paths, suspected credential content, links/submodules, conflicts, binary/non-UTF-8 files, custom filters/encodings and files over 128 KiB are not selectable; reviews are bounded to 100 changed paths and 512 KiB combined before/after text. These conservative guards are not a complete secret scanner. Files requiring unsupported handling stay for operator review in a terminal; blocked file contents are never sent to the browser.

**Commit does not mark Done, approve tickets, wake execution or clear the handoff.** Close the dialog and separately choose Recheck workspace when ready. No push, reset, stash or deletion of working files is offered. This explicit operator action grants no commit authority to ticket agents.

Each run has a private requirements/attachment snapshot and a fresh OMP session. The scheduler advances between tickets; OMP goal mode continues within a ticket. No additional `/loop` is needed. Time and token limits prevent indefinite unattended continuation.

Token accounting includes the OMP session's reported usage, including repeated context/cache tokens and resumed turns—not just newly generated output. Large global instruction sets can consume the default budget quickly. Set a deliberate budget in Settings, or explicitly choose **No cumulative token limit**. A configured cap still records Failed on exhaustion and requires review rather than silently increasing limits.

**Known token-accounting limitation.** OMP's reported totals can omit consumed tokens from discarded responses outside the active conversation. Backlog Web cannot enforce a token cap against usage the API does not report. Displayed consumption is therefore not a complete billing ledger.

Run details separate **Cumulative run consumption** (formatted total/budget and percentage) from **Current context window · estimate** (used/capacity). They show actual reported model/thinking, sample time and native compaction state; missing legacy telemetry stays unknown. Sampling is periodic, not a hard provider-side spending cap, and usage may overshoot between samples. Context compaction cannot refund consumed tokens.

Execution explicitly enables **native OMP automatic compaction**, using OMP's configured threshold/methods and a session-scoped override; no global OMP config edit or second compaction loop. A compaction-start/end status is not proof of passing acceptance checks. Compaction may itself consume tokens; any configured cumulative cap and the time limit still apply. Old stopped runs cannot be compacted retroactively by this website.

### Execution model and thinking

Settings provides a searchable model dropdown and a thinking-level dropdown. Models and supported levels are discovered through an isolated, tool-disabled OMP process; no prompt, goal or ticket run is submitted. Refresh models after editing the executable. Discovery errors stay visible and can be retried without replacing saved settings.

The form groups OMP/model choices, run limits and folder access. Token budgets display thousands separators. Save settings requires changed values, valid run limits and any required thinking-level discovery; the backend still validates all submitted settings. Load saved settings discards local form edits without saving. The footer identifies unsaved changes. Additional discovery/default and pause-control guidance is available in the form's disclosures; safety warnings and blocking feedback remain visible.

Choose **OMP configured default** for the model or **OMP default** for thinking to leave that choice to OMP at execution time. The restricted discovery profile does not inherit executable configuration or custom models, so its displayed discovery model is not a guarantee of the normal execution default. Explicit model choices use exact provider/model IDs. Changing models resets incompatible thinking to default; fresh execution rejects an unsupported or clamped explicit thinking level before prompting.

Settings supplies workspace defaults. On a saved ticket, **Next attempt · model & budget** overrides model/thinking and optionally the token budget for only that ticket. **Load ticket models** explicitly requests restricted metadata discovery. Choose Workspace default to inherit the model; choosing a ticket-specific model defaults thinking to OMP default unless explicitly selected. Clear the optional budget to inherit—it stays blank, not zero. Save confirmation grants no approval or retry; an already Ready ticket retains existing scheduling permission. Run-owned/paused tickets cannot change these choices. Concurrent revisions/settings reject stale saves; unsaved selections are protected during navigation.

**Settings → Run limits → No cumulative token limit** makes new inheriting attempts uncapped, after explicit cost-warning confirmation. The same checkbox on a ticket overrides a finite workspace default for that ticket only. A ticket's explicit numeric cap overrides an uncapped workspace; clearing the field/unchecking the ticket option returns to inheritance. Existing defaults are not automatically changed. Usage is still displayed without a fictitious budget percentage; context capacity is still shown separately. Uncapped token use/cost can grow until completion, a blocker/failure, pause or the finite time deadline—this does not promise completion. Native auto-compaction, workspace/dependency gates and human acceptance remain.

Internally `tokenBudget: null` explicitly means no cumulative cap; an omitted ticket budget inherits. The native goal omits `token_budget` in uncapped mode (never null/zero/Infinity), and host token-limit enforcement is skipped while accounting/time checks remain. Numeric stored settings/runs stay compatible; no schema migration is needed. Settings save does not change an already recorded run budget/deadline, including legacy resumed runs with recorded progress limits.

Fresh admission snapshots the effective model, thinking, budget and deadline settings. These stay fixed across pause/resume even if workspace defaults later change. Legacy runs without configuration snapshots preserve recorded progress limits when available; otherwise legacy fallback behavior and missing telemetry remain. A failed/exhausted run requires a **fresh explicit retry**, not a live model switch; reconcile partial work and workspace handoff first. Start/retry confirmations reject outdated ticket-execution-setting versions. Drafting-page model/thinking choices remain independent.

## Security boundaries

Loopback-only HTTP transport, owner sessions, CSRF protection, Host/Origin checks, authenticated attachment routes, and private storage protect dashboard access. `OMP_BACKLOG_ORIGIN` permits one exact HTTPS remote origin; the [private deployment](docs/private-tailnet-https.md) restricts remote connectivity to Tailscale without opening Bun or Caddy to the LAN. These controls do **not** sandbox OMP: it runs with the backend OS user's permissions. Repository separation is organizational. Agent commands and attachments must be reviewed accordingly.

This is a local Vite development website, not an Internet deployment. Do not bind it to a LAN address or reverse-proxy it publicly. Vite serves project source; keep secrets outside this project. Scheduling alone grants no commit authority. Explicit autonomous completion permits only the guarded host local publication above; push, deployment and destructive cleanup remain unauthorized.

Markdown preview skips raw HTML and unsafe URL protocols. Mermaid uses strict security mode. Uploaded attachments are references, never executable validation scripts.

## Verification commands

Pull requests targeting `main` and pushes to `main` use [ordinary GitHub CI](docs/ci.md): frozen Bun install, strict TypeScript, ESLint, Vite production build and deterministic tests. Native OMP checks remain explicit; paid-provider validation is never part of ordinary CI. Hosted results must be observed separately from local checks.

```bash
bun run lint
bun run typecheck
bun run test
```

Installed-OMP deterministic recovery, with no paid provider or real authentication:

```bash
OMP_BACKLOG_NATIVE_TESTS=1 bun test server/recovery-native.test.ts
```

This uses private disposable configuration, a loopback synthetic model provider and real native tools, host checks, same-session repair, restricted review and guarded publication. Proof paths are printed and retained under `/tmp/omp-recovery-native-*/proof.json`. See [native recovery validation](docs/current-agent-workflow.md#native-synthetic-provider-recovery) for scenarios, negative-control coverage and limits. This is not natural real-model recovery. The separate `rpc-native.test.ts` suite retains its known failing discarded-turn cumulative-usage assertion; do not describe the entire native suite as green.

For isolated verification, use a disposable repository and a separate `OMP_BACKLOG_DATA` directory. Do not run smoke tickets against existing projects. A real model run requires working OMP provider authentication; provider failures are execution failures, not completion evidence.

Project-local recipe: [verify-backlog](.omp/skills/verify-backlog/SKILL.md), with a starter [feature map](.omp/skills/verify-backlog/features/README.md). Its helper uses installed Playwright, terminal-only owner setup and private disposable data; no automatic installs. Optional `--review-fixture` drives review paths using a protocol child, not a live provider. Explicit map maintenance lives in [maintain-backlog-verification](.omp/skills/maintain-backlog-verification/SKILL.md).

For another repository, follow [verification commissioning](docs/verification-commissioning.md): scope authorization, map real entry points, prove a disposable defect fails and its correction passes, establish bounded host recipes and restricted candidate inspection, then record coverage limits. Preparing a recipe does not approve tickets, enable autonomy or change completion policy.

New ticket runs submit `backlog_evidence` receipts before `backlog_result`: criterion, feature/entry point, method/command, reported outcome/details and recipe identity, optionally a sanitized png/jpg/txt/json artifact. Each criterion needs reported passing checks; unresolved failed/blocked/not-run journeys prevent completion. Reports are **agent claims**, not independent command verification. Host records receipt identity/time and artifact bytes/hash. Proof is private and run-owned (100 receipts, 512 KiB/file, 10 MiB/run), authenticated on download, retained after run teardown, and never uploaded as requirement attachments. Legacy runs remain readable with unverified text evidence.

Request changes requires specific feedback through ticket panel, board Actions or drag confirmation. Feedback stays on the reviewed run/revision and is included in subsequent authorized attempts, including older-revision context. This does not bypass dirty-tree safety or authorize automatic commits. Blocked results trigger host-owned pause/shutdown without asking the model to complete an unmet goal. Run progress shows host activity and last reported OMP session-token usage with its accounting basis; no completion percentage is inferred.

The deterministic runtime integration suite uses protocol-speaking child processes, not models or credentials. It covers real filesystem watch events, cross-repository fairness, bounded capacity, per-workspace exclusion, provider-error events after admission, pause/resume session identity, active revision edits, surviving-child recovery, and independent time/token limits. Keep this coverage distinct from a real OMP/browser smoke run; passing a fixture does not establish provider availability.
