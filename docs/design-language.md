# Workspace design language

OMP Backlog is a compact developer workspace, not a marketing site. The project board is the visual reference. Extend its existing Ant Design components and theme tokens rather than introducing another UI system.

## Audit and direction

The board already established square borders, IBM Plex typography, restrained theme accents, full-width work areas, and compact toolbars. The drafting page diverged with a centered 1180px wrapper, lighter display headings, smaller controls and unframed content. Home and other route headings also used different scales; route-action links had separate geometry.

The correction preserves the brand, navigation, routes, theme selection, editing behavior and safety copy. This authenticated local application has no public SEO migration. Design settings: `DESIGN_VARIANCE: 3`, `MOTION_INTENSITY: 1`, `VISUAL_DENSITY: 7`. Predictability and readable controls take precedence over decorative motion or display typography.

## Foundations

| Element | Rule | Existing implementation |
| --- | --- | --- |
| Page layout | Full available width with shared outer gutters. Constrain prose, not the whole workspace. | `main`, `.workspace-main` |
| Page title | 24px, weight 700, compact line height. Same scale on Home, project, settings, plan and drafting pages. | `--page-title-size`, global `h1` |
| Section title | 16-18px, strong weight. No separate display type for empty states. | Global `h2` / `h3` |
| Reading text | IBM Plex Sans; 14-15px for substantive text. | `--font-sans` |
| Controls and metadata | IBM Plex Mono. Control text is 13px, regular weight (400). Preserve Ant Design's native heights (32px standard) and padding; small/large variants retain native geometry. Route-action links and navigation match. Status badges retain stronger weight. | App ConfigProvider `fontSize: 13`, Button `fontWeight: 400`; shared control CSS and link geometry |
| Helper text | Generally 13px. Smaller type only for secondary metadata, not primary actions or form labels. | `.muted`, `.path`, component metadata |
| Shape | Square panels, inputs, buttons and tags. Circles only for meaningful swatches/status marks and existing switches. | ConfigProvider `borderRadius: 0` |
| Surfaces | Workspace background, elevated framed work area, inset reading/editing area. One-pixel borders define ownership. | `--surface`, `--surface-elevated`, `--surface-inset`, `--line` |
| Color | Use semantic theme variables. Accent for selection/primary action; warning/danger retain real safety meanings. | `src/themes.ts`, App theme mapping |
| Motion | No entrance choreography or continuous effects. Existing hover/pressed/focus feedback only. Respect reduced motion. | ConfigProvider `motion: false`, shared CSS |

Self-hosted IBM Plex fonts and existing theme palettes remain authoritative. Do not add fonts, icon families, hardcoded page palettes or dependencies for visual consistency.

## Composition and components

- **Page header:** one route title, short description and contextual actions. Project and drafting pages use Ant Design `Breadcrumb` above the title: Projects / project / current task. Ancestors are React Router links; the current location is text with `aria-current="page"`. Do not combine a back arrow and slash-separated labels into one link, or place a breadcrumb inline with the heading. Use shared gutters; wrap at narrow widths.
- **Global header:** brand links to Projects; do not duplicate it with Home/Projects navigation. Keep compact icon-only Settings and Log out controls with accessible names and tooltips; connection status retains its semantic name and state-specific icon. Theme selection belongs in Settings > Appearance, not the navbar. Keep existing routes, including direct `/plan` access; implementation documentation is not primary navigation. Preserve native control sizing and keyboard focus. Header wraps only when needed on narrow screens.
- **Work surface:** border plus elevated surface. Toolbars use the same quiet tinted treatment as `.board-toolbar`; they are not floating marketing navigation.
- **Route actions:** `.home-action`, `.new-ticket-link` and `.agent-ticket-link` share geometry in `src/styles.css`. Keep React Router links for navigation. Primary links match primary buttons; secondary links match bordered buttons.
- **Local view switches:** existing Ant Design `Segmented`, with explicit accessible labels. Board/List, Discuss/Review ticket and Markdown/Preview remain separate scopes.
- **Forms:** labels above inputs, helper text adjacent, errors visible near the affected control. Use installed Ant Design inputs/selects/buttons, not styled native lookalikes.
- **Control ownership:** Ant Design owns control heights and padding. The selected typography intentionally uses `fontSize: 13` and regular-weight buttons, inputs, selects, view switches and navigation. Do not add per-screen size/weight overrides. Route-action links match without replacing router behavior. Segmented labels inherit their control font rather than global form-label styling; icon labels use flex to avoid baseline inflation. Multiline run/folder rows retain content-driven height because they are lists, not standard action buttons.
- **Editors:** reuse MarkdownEditor and its existing CodeMirror skin, Vim support, completion and paste behavior. The chat composer is shorter than a document editor, not a second editor design system.
- **Empty states:** a compact heading, an explanation and a relevant next action. Conversation and board empty states use quiet dashed boundaries; no hero typography or decorative eyebrow sequence.
- **Feedback:** reuse `.notice`, `.error-banner`, `.warning-text`, status tags and existing dialogs. Never hide blocking errors or execution consequences for a cleaner screenshot.
- **Project header:** execution permission uses 16px Phosphor icons: pause for Paused, shield-check for Approved tickets only, lightning for Automatic. Field and menu share the icon/label; preserve the accessible name and full labels without ellipsis. The menu can be wider than its trigger; mobile gives the selector a full row. No redundant Project settings button. Home breadcrumb switches projects; project title hover text and Home card expose the repository path. Keep non-Git tracking warnings visible below the header.

## Screen-specific rules

Final operator-commit UI re-drive, including regular-weight file-selection controls: `/tmp/opencode/backlog-verify-52IQpg/proof/result.json`. Dark/Light desktop/mobile checks passed without horizontal modal/page overflow or browser runtime errors.

| Surface | Preserve |
| --- | --- |
| Home | Project-first navigation, reusable route action, familiar folder cards and contextual scheduler controls. |
| Project board/list | Full-width viewport workspace; scrolling contained in the board; established cards, toolbar and footer. |
| Manual ticket/detail | Existing drawer, expandable width, Markdown/Preview, attachments, revision and review safeguards. |
| Agent creation | Separate full-width page; main page owns vertical scrolling, not an inset editor-panel scroller. Framed session toolbar/conversation/composer and Discuss/Review ticket switch. Review uses the same framed form language as settings/manual editing. |
| Settings | Shared route title and one bordered form, divided into OMP & model, Run limits, and Folder access. Desktop uses a narrow section-introduction column and full-width fields; model/thinking and time/tokens use matching equal columns, top-aligned independently of helper-text wrapping. Below 768px, stack sections, controls and full-width action buttons. Keep native component sizing, visible safety explanations and discovery errors; put detailed discovery/default/pause guidance in keyboard-accessible disclosures. |
| Plan | Shared route title and framed reading document. Document headings retain their own reading hierarchy. |
| Run evidence | Existing framed panel, metadata, readable transcript, explicit evidence provenance and contextual controls. |
| Operator commit | Handoff-panel action opens an Ant Design modal with framed file selections, bounded diff readers and labeled message. Keep warnings, explicit final confirmation, back/cancel and unsaved-draft close protection. Body scrolls on short/mobile viewports; no new typography or palette. |
| Login | Deliberate public-entry composition; its larger introductory headline is not a workspace page-title pattern. |

Project reconciliation uses a compact, non-dismissible **New starts blocked** notice above the board. Keep the short consequence, recorded-path count (when known), **Review & commit**, and **Recheck workspace** visible. Put the exact reason, originating-run link, recovery instructions, and bounded recorded-path reader under a native **Details & recovery** disclosure, collapsed by default. Empty recorded paths never imply a clean workspace. Preserve existing confirmations, owned-run disabling, safety copy and independent recheck; mobile actions wrap without shrinking controls.

### Live run transcript

The run page is a transcript-first console, not one long evidence report. Use existing Ant Design tabs in this order: **Transcript**, **Evidence** (receipt count), **Files**, **Usage**. Keep status/control actions, ticket context, agent-reported check/evidence counts and explicit unresolved-check navigation above them. Errors, blockers, old-revision warnings, human change requests, recovery context and agent dialogs remain outside the tabs. Evidence notes and receipts use native individually expandable records; outcome labels stay visible when collapsed, and full provenance/artifact links remain inside. Usage retains separate cumulative/context meters; technical identifiers use a disclosure. Preserve mounted transcript inspection across tab switches and start each newly opened run on Transcript. Use IBM Plex Sans for reading, Mono for tabs/control metadata, existing 24px title, square borders and semantic theme colors. Mobile tabs must remain usable without shrinking typography or controls.

Run evidence uses a square, bordered conversation surface with IBM Plex Sans for agent Markdown and IBM Plex Mono for tool names, status, arguments and output. Tool calls are native keyboard-accessible disclosures keyed by persisted entry ID, so streaming updates preserve their expanded state. Running, Complete and Error are explicit text states; Complete means the call returned, not independent verification or acceptance.

The bounded conversation follows latest output only while the reader is at the bottom. Scrolling up pauses following and exposes **Jump to latest**; output updates never move the surrounding page. Agent Markdown skips raw HTML, uses the existing safe URL transform, and exposes image references without automatically fetching images. User/system messages remain distinct plain text. Structured runs show only the conversation, without a separate legacy/raw log disclosure; older runs show only their recorded plain log and an honest unavailable-details notice. The view is read-only and does not change execution, approval or process lifetime.

Keep run activity visible in the transcript toolbar, separate from scroll-follow state and individual tool outcomes. Use the existing Ant Design small Spin with a polite text status for running/stopping, a waiting label for pending run dialogs, and non-spinning paused/terminal labels. A completed last tool does not imply the run has stopped. Respect reduced motion; never animate without a visible status label.

Tool summaries expose the file/command target and up to eight logical lines in a bounded preview. Decode tool text envelopes, pretty-print application JSON, and wrap long source/text within the reader. Edit diffs use real source-line gutters with `+`/`−` markers, context, and theme-aware addition/removal tinting—not ordinal preview numbers or raw `PUT` commands. Keep proposed edit arguments in the raw-record disclosure; write input without a result diff remains explicitly proposed. Independently retain sanitized result diffs before raw-output truncation; never present an unfinished stream preview as a confirmed final diff. When an older recording lacks the source diff, say so. Syntax colors reuse installed CodeMirror grammars and existing theme tokens; choose grammar by file/fence, switch at multi-file headers, and preserve plain text for unknown/unavailable grammars. Full retained content and a secondary sanitized raw-record disclosure remain keyboard-accessible. Opening a tool pauses following; layout changes from lazy highlighting follow only when already following. Keep truncation warnings outside clipped previews; recovered complete text blocks from incomplete envelopes must be explicitly labeled partial, never silently repaired.

## Responsive and accessibility contract

Operator commit verification: actual authenticated app in a disposable instance was exercised at 1440px and 390px in Dark and Light. Modal/body had no horizontal overflow, file selection worked with Space, message/confirmation controls were reachable by scrolling, and back/cancel/unsaved-close protection retained their distinct effects. Screenshots were inspected; no browser runtime errors were observed. Evidence: `/tmp/opencode/backlog-verify-25VZZZ/proof`. This is not exhaustive accessibility certification or live-provider verification.

At narrow widths, headers and controls wrap into a single-column flow. Keep horizontal scrolling inside editors, tables and the board rather than the document. Do not shrink text or controls to force desktop layouts onto mobile. Keep all actions reachable on short viewports.


Board/list workspaces retain a 680px minimum height at every width. The surrounding main container scrolls vertically when headers, warnings and the board no longer fit, rather than compressing the ticket viewport. Project headers do not shrink. Tall windows still fill available space without unnecessary page scrolling; horizontal overflow stays inside the board. Empty-stage placeholders fill the column body instead of sitting below a blank flex list; drag grips retain visible square 36px targets.
Page and bounded-conversation scrollbars use the board's `scrollbar-width: thin` and `scrollbar-color: var(--line) transparent`. Drafting content grows naturally inside the main page scroller. Keep bounded conversation/editor scrolling and board column/surface scrolling where content needs its own viewport; do not add a second full-page scrollbar inside the drafting panel.

Preserve labeled controls, keyboard navigation, focus outlines, unsaved-change confirmation, semantic status text and theme selection. Do not convey state through color alone. Check both a dark theme and Light after changing shared styles; verify enabled action/label contrast against its actual surface. Disabled controls must remain distinguishable but are not evidence that an enabled state was tested.

## Verification for this correction

Changed frontend code passed ESLint. A Vite-only real-browser smoke rendered the actual App, Workspace, MarkdownEditor and styles using synthetic session/state/drafting responses, with no backend or provider attached.

Observed at 1568px: Home, settings, plan, project and drafting route titles were 24px/700; both project creation links and drafting connection/model controls were 38px high. Manual creation still opened its drawer without the agent component. Synthetic connect/disconnect controls and Discuss/Review switching remained operable. Drafting Discuss was visually inspected with Kanagawa and Light at desktop and 390px mobile widths. Review mounted its framed editor on desktop and mobile; Home, settings, plan, board and drafting Review had no horizontal document overflow at 390px.

Screenshots were visually inspected for drafting, manual drawer and settings. This is presentation/synthetic-interaction proof, not live-provider verification, exhaustive accessibility certification or a Lighthouse performance result. Safety and process lifecycle behavior were not changed by this correction.

### Button and location-navigation correction

The next screenshot audit found remaining 15px Ant Design controls, 13px route actions and a 12px theme button. Removed the competing typography overrides and aligned the global control token to 13px. Replaced both handcrafted project/back strings with Ant Design breadcrumbs above the title. Corrected the global form-label and inline-icon baseline leaks into Segmented: Board/List now measures 38px instead of 41px.

Changed TSX passed ESLint. A Vite-only real-browser smoke with synthetic API responses measured 13px button labels on Home, settings, plan and board; standard navigation/buttons/selects and Board/List measured 38px. Exercised Home-to-project navigation, project breadcrumb return, manual drawer open/close, Board/List and Discuss/Review switching. Visually inspected Kanagawa board/manual/drafting and Light drafting, including 390px board/drafting layouts without horizontal document overflow. No backend/provider processes or real ticket mutations were involved. This is presentation and synthetic-interaction evidence, not exhaustive accessibility or live-provider verification.

### Native Ant Design sizing

The 38px/13px sizing described in earlier verification above is historical, not the current convention. Removed ConfigProvider overrides for `controlHeight`, `fontSize` and `fontSizeSM`, theme/mobile button padding overrides and the mobile drafting-send height override. Router links now match native standard buttons at 32px/14px; theme colors, IBM Plex Mono and square corners remain.

ESLint passed. Actual App screens with synthetic API responses measured 32px/14px standard buttons on Home, settings, plan, board, manual creation and drafting; board/drafting view switches and execution select also measured 32px/14px. Small Check context retained its native 24px height. Exercised Discuss/Review and manual drawer open/close. Drafting was visually inspected in Kanagawa and Light at desktop and 390px, with no horizontal document overflow or recorded runtime errors. No backend or provider was attached.

### Lighter control typography

User-requested refinement after native sizing: standard control text is now 13px/400 rather than 14px/600. Native 32px height stays unchanged; headings and status badge emphasis stay intact. ESLint passed. Synthetic-API browser measurements confirmed 13px/400 on header navigation, buttons, route actions, execution select, search and Board/List; manual Create ticket and drafting Connect also remained 32px high. Exercised List switching, manual drawer open/close and drafting navigation. Kanagawa/Light drafting was inspected at desktop and 390px without horizontal page overflow or recorded runtime errors. No backend/provider was attached.

### Execution menu refinement

Added mode-specific icons to every option and the selected value, removed the redundant Project settings popover, and made permission labels fit the trigger and menu. ESLint passed. Synthetic-API real-browser checks confirmed all three menu options contain icons and fit without text overflow at desktop, full Approved tickets only text fits at 390px and 320px, and no horizontal page overflow occurred. Kanagawa and Light mobile menus were visually inspected. Non-Git warning remains visible; selecting Automatic still opens the existing safety confirmation, and canceling preserves the current permission. No real permission changes or provider runs were performed.

### Drafting page scroll ownership

Removed overflow and flex viewport constraints from the drafting root, and routed agent creation to the normal scrolling main container instead of the board's overflow-hidden workspace layout. ESLint passed. Synthetic-API browser assertions confirmed main owns drafting scrolling, the drafting root has visible overflow/no scroll range, and main uses the thin theme-colored scrollbar. Expanded context and mobile Review creation controls were reachable by scrolling main; Kanagawa/Light mobile Review was visually inspected without horizontal page overflow. Board main remains overflow-hidden while its surface retains auto/thin scrolling. No runtime errors were recorded; no backend/provider was attached.

### Settings form usability

Settings retains IBM Plex, square surfaces and existing theme tokens. Helpers use regular weight; token budgets display thousands separators. The footer reports unsaved changes, disables unchanged saves, and restores saved values without writing. Its enabled primary action uses a flat existing accent rather than a lighter gradient to preserve text contrast.

Changed TSX passed ESLint. Real-browser checks with synthetic APIs covered equal desktop control widths/top edges, save/restore, comma-formatted token persistence, blank-budget rejection, incompatible-thinking reset and discovery failure/retry. Dark/Light desktop and 390px mobile were visually inspected without horizontal document overflow or recorded browser errors. Enabled primary text contrast measured 5.28:1 in Light and 7.26:1 in Tokyo Night; checked labels, helpers, input text and unsaved-state text exceeded 4.5:1. These are scoped UI observations, not exhaustive accessibility, Lighthouse or live-provider verification.


### Live transcript verification

Changed-code ESLint, strict TypeScript and the focused transcript/runtime protocol suite passed (20 tests, 193 assertions). A real browser rendered the actual App/run detail with synthetic session/state/events, exercising streaming Markdown, running-to-error updates, retained expanded tool details, keyboard disclosure, bottom-follow, scroll-up preservation, Jump to latest, raw log access and legacy fallback. Dark and Light were visually inspected at 1440px and 390px without horizontal document overflow. This is UI/protocol-fixture coverage, not live OMP/provider execution.

### Card drag interactions

Desktop board cards and their grips initiate native dragging; links and Actions retain their own interactions. Midpoint targeting shows insertion before a card or a dashed end placeholder using existing accent/surface tokens. Edge scrolling stays inside the horizontal board and vertical ticket lists. Status transitions still require explicit lifecycle confirmation; Actions remain the keyboard/touch alternative, not a claim of native touch-drag parity. Interaction research: [Trello-like kanban](kanban-drag-drop-research.md).

Changed-code ESLint passed. Isolated real-browser checks with synthetic API responses passed whole-card reordering after the last card, canceled approval without a request, confirmed cross-column placement, Actions reordering, keyboard menu open/Escape, vertical/horizontal edge scrolling and drag Escape cancellation. Dark/Light desktop and 390px layouts were inspected without horizontal document overflow or recorded runtime errors. Proof: `/tmp/opencode/kanban-ui-proof/result.json`. Backend regression tests were added but not run under the lint-only check policy; no backend/provider execution or touch hardware was verified.

### Compact workspace handoff verification

Changed TSX passed ESLint. A real browser rendered the actual App/project board with synthetic session/state/API responses: default-collapsed notice, Enter/Space disclosure, full recorded paths and source-run link, recheck cancel with no request, confirmed dirty-recheck feedback retaining the gate, commit-review open/close without a commit request, unavailable-inspection details, and paused-run action disabling. Dark and Light desktop/mobile were visually inspected at 1568px and 390px without horizontal document overflow. The collapsed desktop notice measured 114px in this fixture. No real workspace was reconciled or committed; this is UI-fixture coverage, not backend/Git/provider verification.

### Kanban working-area correction

CSS-only correction. In a real-browser synthetic App/project fixture at 1568×780, the board increased from 480px to 680px and populated-column readers from 239px to 439px; empty-stage targets measured 401–439px after the change. Native mouse dragging reordered a draft ticket and saved the expected fixture action/order. Dropping into the large empty Ready target opened the existing approval dialog; cancel retained Draft and sent no additional action. Dark and Light desktop/mobile were visually inspected; 390px kept horizontal scrolling inside the board, Actions remained reachable, and List switching worked. No recorded browser errors. No CSS linter is configured. No backend/provider execution or real ticket mutations were exercised.

### Transcript activity indicator verification

Changed TSX passed ESLint. Real-browser synthetic run fixtures exercised executing after a completed tool, waiting for a dialog, stopping, paused, Needs review, Failed, Blocked, Interrupted and Done, with spinner presence matching each state. Reduced motion disabled spinner animations and retained the text. Dark/Light desktop/mobile were visually inspected; activity remained visible with scroll-follow paused and Jump to latest present at 390px, without horizontal document overflow or recorded browser errors. This is UI-fixture coverage, not live-provider execution. Project TypeScript check remains blocked by three nullability errors in untouched `src/TicketBoard.tsx:77–78`.

### Blocked-ticket recovery

Recovery stays inside the existing ticket drawer: structured prerequisite/fix copy, a keyboard-accessible attempts/checks/partial-work disclosure, the shared MarkdownEditor and native Ant Design actions. Save is separate from explicit revision/note-bound retry confirmation. Keep workspace-gate warnings, agent-report labels, stale/error feedback and unsaved-navigation protection visible. Existing run details expose source notes and received context read-only; no second chat or component system.

Changed TSX passed ESLint. Actual React UI with synthetic API responses exercised panel/board Actions/native-drag recovery entry points independently, save/reload, canceled unsaved close and retry, stale-note rejection/current-note reconciliation and confirmed exact source/note/revision payload. Dark/Light at 1440px and 390px were visually inspected, with reachable enabled retry, keyboard disclosure and no document/drawer horizontal overflow or recorded browser runtime errors. Final label refinement rechecked at `/tmp/opencode/blocker-recovery-ui-krZoQW`; earlier visual proof at `/tmp/opencode/blocker-recovery-ui-fq6ep5`. Owned Vite/browser stopped; no backend/provider/real ticket runs. Backend tests added but not run under lint-only policy; no current typecheck/build claim.

### Ticket model and token usage

Saved-ticket execution overrides reuse native Ant Design Select/InputNumber controls, the existing two-column form grid (stacked on mobile), regular-weight helper text, explicit save confirmation and parent unsaved-navigation protection. Run detail places cumulative-consumption and estimated-context readings before run metadata; semantic progress bars indicate token usage, never feature completion. Actual model/thinking, sample age, unknown telemetry and native compaction state stay visible. Paused/stopped work does not animate a stale compaction sample.

Ticket execution controls now sit in a native keyboard-accessible disclosure, collapsed on opening a ticket. Its summary distinguishes global inheritance, saved ticket overrides and unsaved edits. Collapsing changes no settings and preserves drafts/navigation/retry protection; errors and stale-save reconciliation remain outside the disclosure. Changed TSX ESLint and synthetic-API browser checks passed, including Enter/Space, retained edits, visible collapsed stale-save errors and existing model/budget journeys. Dark/Light at 1440px and 390px were inspected without horizontal overflow or recorded browser errors. Proof: `/tmp/opencode/ticket-model-usage-ui-9npfrS`; owned Vite/browser stopped. No backend/provider execution was exercised.

Changed-code ESLint passed. Actual React UI with synthetic APIs covered explicit model discovery/selection, thinking/budget choices, canceled save/navigation, stale-save reconciliation, persisted overrides, cleared-budget inheritance and unchanged global settings/failed status/workspace gate. Separate usage/context meters, simulated compaction/context reduction without consumption reset, paused-spinner suppression and unknown legacy telemetry were checked. Dark/Light at 1440px and 390px were visually inspected, including enabled save controls, without document/drawer horizontal overflow or recorded browser runtime errors. Final proof: `/tmp/opencode/ticket-model-usage-ui-tRKyIB`; owned Vite/browser stopped. Blocker-recovery UI was separately re-driven at `/tmp/opencode/blocker-recovery-ui-KORDXe`.

Installed OMP 18.13.3 restricted metadata discovery returned 18 models after the guard fix; no inference. Both the old-version rejection and blank-budget `0` display were reproduced before fixes. Source review and limits: [compatibility note](omp-18.13.3-compatibility.md). No real backend/provider/native compaction UI journey, backend regression suite, strict TypeScript or build was run for this change.

### Global and ticket uncapped-token controls

Global Run limits and ticket next-attempt settings use native Ant Design checkboxes with regular control typography. Selecting **No cumulative token limit** disables the numeric field with an explicit placeholder, keeps the finite time control available, and shows cost/safety warnings. Global enablement and ticket save retain their explicit confirmations. Inherited global uncapped mode is labeled separately from a ticket override. Uncapped run usage keeps the actual token total/context meter and removes the meaningless finite-budget percentage.

Changed-code ESLint passed. Actual React UI with synthetic APIs exercised keyboard toggles, canceled/confirmed global and ticket saves, Load saved settings, reload persistence, inherited uncapped warnings, finite ticket override/global restoration, unchanged previous-run limits/time/pause, uncapped accounting display, and existing model/stale-save/compaction UI regressions. Dark/Light at 1440px and 390px were inspected without document/drawer horizontal overflow or recorded browser runtime errors. Final proof: `/tmp/opencode/ticket-model-usage-ui-8Uj0B8`; owned Vite/browser stopped. Backend/API/runtime regression tests were added/extended but not run under lint-only policy; no real runtime/provider/native compaction or current strict-typecheck/build verification is claimed.

### OMP-style transcript previews

Changed-code ESLint passed. Decoder/capture regressions passed: 23 tests, 83 assertions across `src/transcript-presentation.test.ts` and `server/transcript.test.ts`. Real-browser synthetic App/run fixtures exercised nested read JSON, truncated outer envelopes, long eval JSON, recorded edit diffs, failed-edit output, raw-record expansion, keyboard disclosure, incremental assistant Markdown and running-to-complete tool updates with expansion retained. Expanding paused follow; Jump to latest restored the bottom position. Incomplete code fences and completed Markdown tables rendered without runtime errors; raw HTML stayed inert and image references created no image elements. Running-to-Needs-review removed the spinner. Dark/Light desktop 1440px and mobile 390px were visually inspected, with long ordinary text wrapping and no horizontal document overflow or recorded browser errors. No live OMP/provider execution was exercised; backend streaming was unchanged. The previously reported `src/TicketBoard.tsx:77–78` TypeScript errors were not rerun or changed in this task.

### Source diff and syntax-highlighting correction

Reproduced the reported defect through `RunConversation` → `toolPresentation`: an oversized content snapshot truncated the serialized result before `details.diff`, causing fallback to hashline patch input. The repaired path independently retains the bounded/sanitized actual diff; the same smoke produced context line 115, removed/added line 116 and context line 117, with no patch command in the default diff. Missing final diffs clear provisional previews; older recordings without retained diffs expose an unavailable notice and keep patch instructions only in raw arguments.

Focused presentation/capture/runtime integration checks passed: 52 tests, 279 assertions. Targeted strict TypeScript for the changed transcript modules passed; this is not a whole-project typecheck. Actual React/browser fixtures rendered the captured oversized-result entry, source-numbered replacement and Markdown additions, mixed JavaScript/JSON per-file grammars, multiline-comment syntax, and fenced HTML/JSON. Source remained text: no script execution, image elements or nested preformatted blocks. Native keyboard expansion and raw-argument inspection worked; tool completion preserved expansion and both transcript/page scroll positions. Following stayed at the bottom after asynchronous syntax rendering. Dark/Light desktop 1440px and mobile 390px were visually inspected without horizontal document/source overflow or recorded runtime errors. Fixtures/protocol tests are not live-provider verification; no actual project edit or provider execution was exercised.

### Run page hierarchy correction

Replaced the uninterrupted usage/metadata/evidence/receipt/file/transcript stack with Transcript, Evidence, Files and Usage tabs. Evidence notes, criteria and receipts expand independently; status and actionable safety context remain outside the tabs. Run identifiers and finish timing stay available under Usage without dominating the page.

Changed Workspace code passed ESLint. Actual React/browser fixtures exercised tab navigation, keyboard evidence expansion, preserved tool expansion across tabs, criteria, artifact-link targets, file summaries, usage identifiers, new-run reset to Transcript, paused resume-control visibility, pending questions outside tabs, blockers, errors and stale-revision warnings. Dark and Light were visually inspected at desktop 1440px and mobile 390px; all four tabs fit at 390px, no horizontal document overflow or browser runtime errors were observed. These are synthetic UI checks, not backend execution, proof downloads, live-provider verification or acceptance.

### Opt-in autonomous completion

Project Completion is a separate compact control beside execution permission. Its Ant Design modal commissions exact argv/recipe files, reviewer inheritance and bounded limits with explicit local-commit/Done confirmation. Default Human review, revocation, stale-save feedback and unsaved protection remain visible. No page-specific font/control sizing or second component system was added.

Run Evidence distinguishes author claims, host command receipts, independent review findings, candidate identity and local publication/no-op. Board/list keep their existing columns and add phase labels plus an assistance count/filter; active autonomous phases do not expose routine human Done. Exceptions retain existing reviewed recovery and reconciliation entry points.

Actual authenticated app/browser checks used disposable Git and protocol children: canceled and confirmed commissioning, saved authority/start-policy independence, exact-candidate local commit to Done, permission exception/filter, keyboard evidence disclosure, canceled unsaved close, mobile footer reachability, cross-tab revocation and stale draft retention. Kanagawa/Light were visually inspected at 1440px and 390px. Fixed duplicate modal/board sibling keys and implicit grid min-content overflow; final mobile policy body measured 326px client/scroll width with zero horizontal scroll, and document overflow was absent. Full-project lint and strict TypeScript passed.

This is browser/protocol evidence, not real OMP/provider or exhaustive accessibility verification. Original screenshots under `/tmp/omp-autonomous-browser-5EJXDe/proof` became unavailable after session resumption; session transcript retains the visual observations, not a currently accessible artifact directory. Owned browser/server were stopped; no registered project was enabled.

### Engineering mode controls and usage

Global and saved-ticket engineering-mode selectors reuse existing Ant Design fields and native sizing. Run history/details display immutable admission mode, not current defaults. Usage separates recorded author/reviewer components from their cumulative total and from actual provider billing. No shared visual convention changed.

Actual-React/synthetic-API browser checks covered global mode save without model discovery or budget changes, ticket override save/cancel/inheritance, unsaved Settings navigation/restore, active-owner disabling, legacy pstack labels, immutable history and 22 author + 14 reviewer = 36 total without double counting. Tokyo Night/Light desktop (1440px) and mobile (390px) were visually inspected without horizontal document overflow or recorded browser runtime errors. Global-helper contrast measured 6.43:1 dark and 6.04:1 Light; selector focus and accessible names were inspected. Native 32px controls remain intentional repository geometry, not blanket touch-target certification.

Private UI proof: `/tmp/omp-engineering-ui-mQQjTW/result.json` and adjacent screenshots. Requested AFTER audit: `anti-slop/audit-001-2026-11-06.md`. This is frontend/synthetic-API proof; backend/native/provider results and limitations are recorded separately in `docs/current-agent-workflow.md`.

