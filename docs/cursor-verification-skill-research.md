# Cursor pstack verification skills: research and OMP fit

Research date: 2026-10-22. Research only: no skill generated, application started, dependency installed, test executed, or application/PLAN.md edit made. Local observations include the existing uncommitted working tree; they describe inspected source, not a tested release.

## Findings

**Adopt the verification discipline, not another completion loop.** pstack's `create-verification-skill` is a generator: it researches a repository, writes a project-specific runnable verification recipe and feature map, then proves that recipe. The generated `verify-<app>` skill is what subsequent agents use to launch and drive the real application. `maintain-verification-skill` keeps that recipe/map aligned with source and live behavior. Neither is an independent correctness oracle or an OMP scheduler/completion mechanism. [P1–P2; L3]

**Proof means user action → observed outcome → checked side effects.** A final screenshot, green unit suite, successful RPC acknowledgement, or agent's completion text alone cannot prove an end-to-end OMP workflow. Missing provider authentication must remain a blocker, not be hidden behind the protocol fixture. [P1; P3; L1; L3–L5]

**Cursor output location is not OMP discovery.** The generator defaults to `.cursor/skills/verify-<app>/`. This application's skill suggestions search repository `.omp/skills`, `.agent/skills`, `.agents/skills`, plus documented global roots—not `.cursor/skills`. An eventual OMP adaptation must deliberately select a supported location; merely generating Cursor files does not make `/skill:verify-...` discoverable here. This is a source observation about app suggestions, not a claim about every possible custom OMP plugin configuration. [P1; L1; L6]

## Provenance and pinned sources

- User-provided starting point: [Cursor's generator on main](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md).
- Inspected upstream snapshot: `cursor/plugins` main commit **`eb4db2b55b2b7dec3d9282754cddf0a56bf4ff10`**, returned by the [GitHub main commit API](https://api.github.com/repos/cursor/plugins/commits/main), committer timestamp `2026-10-22T06:08:55Z`. All P citations below pin this same snapshot, including maintenance and examples.
- Official pstack README identifies its voice as **poteto**. The generator's latest path-change commit returned by the [path history API](https://api.github.com/repos/cursor/plugins/commits?path=pstack/skills/create-verification-skill/SKILL.md&per_page=1) was [`c49b37a2c0e7bede60a71ad7322e3f12c337a3da`](https://github.com/cursor/plugins/commit/c49b37a2c0e7bede60a71ad7322e3f12c337a3da), whose author metadata says `lauren`/`poteto` and includes coauthor trailers. This establishes repository/commit provenance, not sole authorship. **No verified attribution to Laurent was found or is made.** [P6]

## Generator contract versus generated skill

The generator and maintainer both declare `disable-model-invocation: true`; these are explicitly invoked workflows in the inspected source, not always-on autonomous checks. Generator output must be written for another agent reading it cold, with real commands/selectors and no placeholders. It first inspects surface, start command, harness, observability, and isolation; it asks only for facts the repository cannot supply. Existing harnesses take priority over introducing a generic browser/PTY/HTTP recipe. A broken baseline must be fixed or precisely reported, not encoded as if working. This research task does not authorize those repairs. [P1–P2]

| Generated section | Required behavior | Implication for omp-backlog-web (recommendation, not implemented) |
| --- | --- | --- |
| Launch | Exact start/setup commands; usable state from empty data, including initialization/seed prerequisites; readiness beyond an answering port; teardown. | Follow `bun server/setup.ts` and `bun run dev` with a distinct `OMP_BACKLOG_DATA` and port. Owner setup requires a real TTY, hidden password entry, and no arguments; an HTTP login page is not proof that an authenticated project workflow is ready. [L1; L7–L8] |
| Doctor | One read-only assessment of instance health, identity/version, port ownership, and auth before driving suspect state. | Confirm owned PID/port, correct checkout and private data root, configured owner and valid session, then usable UI/state. No dedicated project doctor helper was established by this inspection; do not invent an existing command. [L7–L8] |
| Drive | Actual user surface using stable names/routes/ARIA handles; not internal setters or test-only endpoints. | Use browser login, folder picker, ticket editors, permission controls, board/panel actions, and run dialogs. Direct store mutations used by fixture tests do not establish those UI paths. [L2; L4–L5; L9] |
| Evidence | Action plus result; screenshots/transcripts/responses and independently observed mutations; mocks only at existing production boundaries. Inspect what dry-run/test modes actually skip. | Record ticket/revision/criterion, entry point, action, outcome, artifact paths, command/exit status where applicable, reopened ticket/file state, and unverified boundaries. Observe no unintended starts or changes on cancel/pause/read-only actions. [L1–L5] |
| Cleanup | Kill only owned instances, never by process name; remove owned scratch state but retain proof. | Respect OMP child liveness and the global slot. Stop owned app/child work safely, preserve artifacts outside disposable state, never reset a repository or delete existing private data. Stopping is not rollback. [L1; L4] |
| Helpers | Scripts executable; exact invocation documented in skill body. | Add helpers only if a later authorized implementation needs them; no dependency/harness installation or helper creation is part of this report. |

Section requirements come from P1; OMP-specific items are derived from the cited local sources, not claims that the upstream skill already supports this application.

## Feature maps: contract, examples, and upkeep

The generator seeds `features/README.md` and roughly **3–5 initial user-facing feature files**, discovered from routes, commands, menus, and docs. That is a starting inventory, not a claim of complete application coverage. Each feature has an H1/behavior summary and exactly these four H2 sections: [P1; P3]

1. `Sub-features`: short behavioral IDs.
2. `How to get to it (user POV)`: every supported user entry point.
3. `Driving it with <harness>`: preconditions, literal action/command and observable result.
4. `Gotchas`: invalidating conditions, prerequisites, timing/focus traps.

The official **Notes** reference is illustrative, not an OMP harness or installable `control-notes` dependency. Its index defines disposable data, identity/doctor checks, stable accessible handles, baseline restoration, screenshot + ARIA proof, CLI stdout/stderr/exit code, second-view mutation proof, and artifact tagging by feature ID and entry point. A skipped entry point cannot be marked verified through another one. [P3]

- **Create note:** toolbar, keyboard shortcut, and CLI entry points; save then reopen; cancel leaves no saved draft; retain proof after fixture cleanup. Its open-editor prose also requires each browser entry point—do not treat one convenient sample command as permission to omit another listed route. [P4]
- **Search:** toolbar and keyboard independently exercised, then title/body matches, result opening, no matches, clearing, CLI hit/miss; wait for results rather than sleep; restore the right state between journeys. [P5]
- Missing seed preconditions must produce a failed journey with the reason in Gotchas; never weaken the expected result merely to get green. [P1]

### Maintenance pass

The maintainer locates an existing verification skill (none → stop and recommend generation; multiple → ask), reconciles index/files, and launches one **read-only source reader per feature** concurrently. Each returns summary, concrete source entry points, likely drift, and one live recipe. A coordinator reconciles overlaps and recent missing surfaces, then alone drives the live app: serial driving of one long-lived server/UI instance, or fresh isolated sessions for short-lived CLIs. This describes upstream workflow; no such agents or live pass were run for this report. [P2]

Source coverage and live coverage are required for **every feature file**; the map contract additionally prevents substituting one entry point for another. Do not confuse “one feature live” during generator commissioning with complete map verification during maintenance. Recheck doctor after surprises/failed drives; if doctor cannot detect a wedged UI, reset to a known state or relaunch. Clean failed-iteration residue and check that previously captured evidence still exists after every cleanup. [P1–P3]

Classify failures without rewriting requirements: **doc drift** → correct description; **harness gap** → fix owned harness and re-drive; **product gap** → report product regression, not a documentation patch that conceals it. `verified-unreachable` requires the attempted route and concrete unavailable prerequisite (auth, entitlement, OS, external state); it is not evidence that the inaccessible behavior passed. [P2]

Upstream outcomes are `clean`, `changed`, or `blocked`. Maintenance edits only its verification directory, never product code, and proposes at most one PR of proven corrections; clean/blocked yield no PR. These instructions confer **no permission here to branch, commit, push, or open a PR**. Local authorization rules still apply. [P2]

## Candidate OMP feature inventory and observable proof

This is a research inventory for a future map, **not generated feature files, tested journeys, or an exhaustive source audit**. Initial files could group the rows into 3–5 domains, but every listed supported entry point needs its own coverage record rather than being silently collapsed. Source handles below come from current README and UI source. [L1–L2; L9]

| Feature/domain | Entry points to retain in a future map | User-facing proof and side-effect checks |
| --- | --- | --- |
| Access and navigation | Terminal owner setup; Sign in/Log out; brand/Home, Settings, Implementation plan; mobile Menu; direct URLs, reload, Back/Forward; unavailable routes; theme menu. | No browser registration; correct session/error states; correct destination/current page and mobile closure; preference persists/System responds; unknown IDs never silently select another object. `/plan` rendering precedes the auth gate in App, so do not falsely document the plan page as login-protected. [L2; L7] |
| Project discovery and permission | Home Add project → `/projects/new`; permitted-root/parent/child picker controls; register/cancel; project cards → `/projects/:repoId`; Project settings/switcher; repository execution mode; Home scheduler control. | Registered canonical directory starts Paused; disallowed paths rejected; cancel creates no project; ready counts not mistaken for admission. Pausing new starts does not stop a current run; global controls stay Home-only. [L1; L9] |
| Ticket authoring and references | New ticket link/direct URL; optional Import existing Markdown; existing ticket card/direct URL → Reading view/Edit Markdown; Markdown/Preview; paste attachments in both; retry uploads/load current version; `/skill:`, `@`, Ctrl-Space, arrows/Enter/Tab/Esc; VIM; save and route/panel close. | One shared draft, explicit save, correct persisted bytes/reopened document, revision invalidation, attachment files/links/purpose gating, no duplicate ticket after partial upload, unsaved navigation prompt/focus restoration. Completion only inserts text: no save/approval/start. Metadata/unsupported Markdown preserved; sensitive/symlink/private paths excluded from file suggestions. [L1; L6; L9] |
| Board and review | Board/List; search, Display, attention chips; desktop drag grip; Actions menu including keyboard/touch Move up/down; ticket panel reorder/approve/retry/accept/request changes. | Exact statuses and queue order preserved unless confirmed action requests change; Yes/No cancellation has no mutation; stale/error requests show failure. Cover both drag and non-drag controls and panel equivalents. Active stages cannot be arbitrarily dragged; Needs review is not Done; Done accepts only current-revision evidence. Reopen/refresh and inspect persisted status/order, approval and dependent eligibility. [L1; L9–L10] |
| Runs, questions, and recovery | Open current run; ticket run history; `/runs/:runId`; contextual pause/resume and run-panel controls; confirm/decline/select/input/editor/cancel dialog; Settings time/token/executable/model controls. | Transcript/evidence visible for correct immutable revision; real child identity/session on resume; canceled question never implies consent; provider failure stays failure. Verify global single slot, dependency gate, no replay on unchanged failure, partial-change warnings, safe child shutdown, and budget exhaustion as non-success. Scheduling/recovery edge cases need isolated protocol tests as well as separately labeled real-provider/browser coverage. [L1; L4–L5; L9] |

These observations deliberately prioritize what a user can reach and what changes afterward. Low-level API/unit tests remain valuable for guards and races; they complement, rather than replace, user-path evidence. Production HTTP endpoints may support read-only corroboration, but bypassing the UI under test cannot prove that UI's entry point. [P1; P3; L5]

## Isolation, security, and evidence tiers

For any later authorized live verification: use a disposable target repository, separate private `OMP_BACKLOG_DATA` **outside application source**, unshared port and browser profile/session, and synthetic attachments/tickets. The initial allowed root is `~/Development`; a scratch repository elsewhere requires an explicitly permitted verification root, not disabling the path guard. Do not run smoke tickets against existing projects or borrow the owner's live session. Empty-data setup must include safe terminal-only owner creation; do not log passwords, cookies, CSRF values, tokens, provider config, or private transcript contents into artifacts. [P1; P3; L1; L6–L8]

Keep loopback binding, Host/Origin/CSRF/auth protections, and file/attachment restrictions intact. OMP has the backend OS user's permissions: choosing a disposable repo does **not** sandbox arbitrary agent commands. Explicit authorization, safe synthetic work, reviewed attachments, and no commits/pushes/deploys/destructive cleanup remain necessary. Never infer safety from a “dry-run” name; inspect actual file, network, git-ref and process side effects. Cleanup must target only run-owned resources, leaving original data and unrelated work untouched. [P1; L1; L4; L7]

| Evidence tier | What it can establish | What it cannot establish |
| --- | --- | --- |
| Source inspection (this report) | Documented behavior and code paths at inspected snapshots. | Working startup, browser interactions, provider access, or actual completed ticket. |
| Deterministic runtime fixture | Real process transport/filesystem/runtime lifecycle checks around a protocol-speaking child; isolated proof-file evidence. | Installed OMP execution, real model/provider/auth, or browser flow. Test source explicitly says so. [L5] |
| Real app/browser without provider turn | User navigation, editing, permission/review UI and observed persistence within exercised scope. | Autonomous OMP execution or model goal completion. [L1; L4] |
| Real OMP + provider + browser smoke | Only actually exercised real-model journey, observed file effects, revision-bound evidence, settlement and human review handoff. | Unexercised entry points, all recovery races, or automatic human acceptance. Provider failures block this tier. [L1; L4] |

Mocks belong only at existing isolated external boundaries and must be labeled. A protocol child is not fraudulent evidence when described honestly; relabeling its pass as real OMP proof would be. Stand-in environments must list setup they performed that the real target will not; those setup steps stay unverified until exercised on the real target. [P1; L5]

## Proof-before-delivery and bounded loops

**Generator commissioning:** run launch → doctor → **one mapped feature** → evidence → cleanup; check retained artifacts at their named location. Clean up after failed attempts too. Never-executed generated instructions are a **draft**, not a delivered proven skill. This research report creates no such deliverable and therefore makes no live-proof claim. [P1]

**Maintenance:** all feature files need source and live coverage; re-drive harness fixes. Doctor drift gets a correction and **one retry** before blocked. The generator does not prescribe a universal retry/time cap for every failed proof iteration, and maintenance's one-retry rule is specifically for doctor drift—not license for unlimited other retries. A future adaptation should explicitly bound attempts, elapsed time, tokens and no-progress, preserve partial proof, and stop on unavailable prerequisites rather than fabricate credentials or loosen journeys. That last bounding policy is a recommendation, not a quoted universal pstack limit. [P1–P2; L3]

The [prior completion-loop research](agent-completion-loop-research.md) already separates: scheduler chooses authorized ticket → OMP goal continues inside one ticket → `backlog_result` records exact revision/criterion evidence → settled state and safe shutdown → **Needs review** → human **Done**. Current runtime confirms these gates and forbids `/loop`/backlog-worker. A verification skill would improve how evidence is obtained inside that boundary, not replace or nest those loops. [L3–L4]

Crucial limitation remains: `parseResult()` checks revision, criterion coverage, uniqueness and nonblank bounded text; it does not independently establish that narrated commands actually ran or artifacts prove the claim. The OMP completion tool discussed in the prior report similarly records a model declaration, not independent acceptance proof. Require observed evidence with scope matched to claim, preserve token/time/cancel/blocker exits, and keep human acceptance separate. Missing prerequisites and budget exhaustion are non-success outcomes. [L3–L4]

## Sources

Pinned public first-party sources:

- **P1:** [create-verification-skill/SKILL.md](https://github.com/cursor/plugins/blob/eb4db2b55b2b7dec3d9282754cddf0a56bf4ff10/pstack/skills/create-verification-skill/SKILL.md), sections 1–5.
- **P2:** [maintain-verification-skill/SKILL.md](https://github.com/cursor/plugins/blob/eb4db2b55b2b7dec3d9282754cddf0a56bf4ff10/pstack/skills/maintain-verification-skill/SKILL.md), Outcomes, Edit scope, Pass 0–6.
- **P3:** [reference feature-map README](https://github.com/cursor/plugins/blob/eb4db2b55b2b7dec3d9282754cddf0a56bf4ff10/pstack/skills/create-verification-skill/references/feature-map-example/README.md).
- **P4:** [reference create-note.md](https://github.com/cursor/plugins/blob/eb4db2b55b2b7dec3d9282754cddf0a56bf4ff10/pstack/skills/create-verification-skill/references/feature-map-example/create-note.md).
- **P5:** [reference search.md](https://github.com/cursor/plugins/blob/eb4db2b55b2b7dec3d9282754cddf0a56bf4ff10/pstack/skills/create-verification-skill/references/feature-map-example/search.md).
- **P6:** [official pstack README](https://github.com/cursor/plugins/blob/eb4db2b55b2b7dec3d9282754cddf0a56bf4ff10/pstack/README.md), introduction, skills table, Not shipped here. Browser/CLI control skills are not bundled with pstack; examples are not proof that those tools exist locally.

Local source citations (working tree at research time; no stable line-number assumption for unrelated ongoing edits):

- **L1:** [README.md](../README.md), Start, Navigation, Ticket workflow, Editor controls, Scheduling and recovery, Security boundaries, Verification commands.
- **L2:** [src/App.tsx](../src/App.tsx), `login()`, `logout()`, session/events handling and rendered header/login/plan branches.
- **L3:** [docs/agent-completion-loop-research.md](agent-completion-loop-research.md), Current OMP behavior, Current application behavior, Recommended bounded ticket loop; contains pinned OMP primary-source references. OMP internals summarized here derive from that prior report, not a new installed-binary/live audit.
- **L4:** [server/runtime.ts](../server/runtime.ts), `eligible()`, `parseResult()`, `stop()`, `settled()`, `onFrame()`, `launch()` objective/configuration and budget polling (inspected lines 104–432).
- **L5:** [server/runtime-integration.test.ts](../server/runtime-integration.test.ts), explicit fixture limitation, `withHarness()`, `ticket()`, `finish()` and global-slot/fairness test (inspected lines 1–110).
- **L6:** [server/completions.ts](../server/completions.ts), `safeName()`, `safeFile()`, `fileCompletions()`, `skillCompletions()` roots at lines 103–111 and bounded metadata discovery.
- **L7:** [server/index.ts](../server/index.ts), private-source separation, loopback/strict port/Host configuration, `shutdown()`; [package.json](../package.json), dev/setup/check scripts and installed dependencies.
- **L8:** [server/setup.ts](../server/setup.ts), TTY-only no-argument setup, hidden password input, refusal to overwrite owner, owner insertion.
- **L9:** [src/Workspace.tsx](../src/Workspace.tsx), route selection, scheduler/project/panel controls, ticket editor/actions, `FolderPicker`, run detail and `DialogForm`; targeted source matches cross-checked against README.
- **L10:** [src/TicketBoard.tsx](../src/TicketBoard.tsx), confirmation and stale-revision checks, drag grips, Actions move controls, display/attention/footer state.

Verification limits: public source retrieval and local read-only inspection only. No private project data sent upstream. Existing unrelated edits preserved; only this report was added. No lint/build/test was run for this Markdown-only research task, as requested.
