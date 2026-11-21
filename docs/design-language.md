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
| Controls and metadata | IBM Plex Mono. Control text is 13px, regular weight (400). Desktop preserves Ant Design's native heights (32px standard). Below 768px, one responsive ConfigProvider `controlHeight: 44` token lets Ant Design size buttons, inputs, selects and segmented controls together. No per-control CSS height/padding overrides. Switch tracks retain their geometry with an expanded hit area. | App ConfigProvider tokens and Button `fontWeight: 400` |
| Helper text | Generally 13px. Smaller type only for secondary metadata, not primary actions or form labels. | `.muted`, `.path`, component metadata |
| Shape | Square panels, inputs, buttons and tags. Circles only for meaningful swatches/status marks and existing switches. | ConfigProvider `borderRadius: 0` |
| Surfaces | Workspace background, elevated framed work area, inset reading/editing area. One-pixel borders define ownership. | `--surface`, `--surface-elevated`, `--surface-inset`, `--line` |
| Color | Use semantic theme variables. Accent for selection/primary action; warning/danger retain real safety meanings. | `src/themes.ts`, App theme mapping |
| Decoration | None: no gradients, glows, drop shadows or coloured edge stripes on surfaces. State is shown by a full border colour (warning/danger/accent), a dot or a tag. Hover changes the border colour only. Focus rings are the one glow. | `.project-folder`, `.execution-strip`, `.workspace-handoff`, `.error-banner` |
| Spacing and type floor | Panels pad 20px (16px on mobile); inline notices and strips 12-16px; grid gaps 16px. Smallest text is 12px; scale is 12/13/14/15/18/24. | `.panel`, `.notice`, `.project-grid` |
| Button icons | Every button carries a Phosphor icon (`…Icon`, 16px, `aria-hidden`), including text buttons: icon plus label for decisions and form actions (Approve, Save, Retry), icon-only with a Tooltip and the same `aria-label` for repeated toolbar controls. Reuse one icon per meaning (ArrowClockwise retry/reload, FloppyDisk save, CheckCircle approve, SealCheck accept, PencilSimple edit, Copy copy). No text-only buttons on new surfaces. |
| Icon-led sections | The ticket modal Activity tab is the reference for detail surfaces: every section heading, tab label and fact row leads with a 16px Phosphor icon; field labels stay plain text and their icon sits in the control's suffix (`suffix` on Input/InputNumber, `suffixIcon` on Select, so the dropdown caret is replaced) rather than beside the label; only controls with no suffix slot, such as a textarea, keep a leading label icon (Requirements FileText, Run history ClockCounterClockwise, Attachments Paperclip, Published from GitBranch, Engineering mode GearSix, Model Cpu, Thinking Brain, Token budget Coins, Dependencies TreeStructure, Approval SealCheck, Criteria ListChecks). Headings are 14px, 8px icon gap, no divider rules between sections; long help text moves into an info-icon Tooltip with an `aria-label`, leaving one short line visible. Identifier dumps use a collapsed `dl` grid. | Segmented view switches (Markdown/Preview, Board/List) are icon-only with a Tooltip and visually hidden text.
| Concise text | Visible copy is one short line per element: a label, a state or a single instruction (max about 12 words). Rationale, safety detail and edge cases go in an info-icon Tooltip (`aria-label` names it) or a collapsed disclosure, never in a paragraph under every field. No repeated explanations: say a rule once, where it applies. Empty states are one sentence. Safety and blocking messages stay visible but state only what to do next. |
| Status colours | Each status has its own hue from the `--st-*` tokens (defined for Light and dark): draft slate, ready blue, running teal, needs review violet, done green, blocked/paused amber, failed/interrupted red. Tags use that hue for text and border over a 14% tint of it; dots use the same token. The Tokyo-Night-derived hues keep the teal accent scheme; never hard-code a status colour. | Board column headings and counts use the same tokens (Draft slate, Ready blue, In progress teal, Needs attention red, Needs review violet, Done green).
| Prose (Plan, ticket, run) | Same recipe as chat: 15px / 1.75, headings 18/15px with 24px above and 8px below, muted left-rule quotes in `--line`, inset bordered inline code at .87em, tables with an elevated header row. | `.plan-document`, `.ticket-reading`, `.run-transcript-markdown` |
| Chat prose | Agent Markdown: 15px / 1.75, 12px paragraph gap, 24px list indent with 4px item gap, headings 20/18/15px semibold with 24px above and 8px below, accent underlined links, muted left-rule quotes, tinted-header bordered tables with inner scroll. Inline code is a bordered inset chip at .87em. Fenced code uses a language bar with a Copy button and scrolls horizontally instead of wrapping. | `.agent-message-content`, `.chat-code`, `ChatCodeBlock.tsx` |
| Tooltips | Follow the active theme: `colorBgSpotlight` is the raised surface and text is the theme text colour. | App ConfigProvider `Tooltip` tokens |
| Motion | No entrance choreography or continuous effects. Existing hover/pressed/focus feedback only. Respect reduced motion. | ConfigProvider `motion: false`, shared CSS |

Self-hosted IBM Plex fonts and existing theme palettes remain authoritative. Do not add fonts, icon families, hardcoded page palettes or dependencies for visual consistency.

## Composition and components

- **Page location:** the shared navbar owns breadcrumbs for every authenticated route, including projects, manual creation, saved tickets, chat, runs, settings, the implementation plan and unavailable routes. Desktop uses Ant Design Breadcrumb with React Router ancestor links; the current location is text with `aria-current="page"`. Mobile uses the same hierarchy through a named Page ancestors dropdown and an ellipsized, fully accessible current label. Never repeat a breadcrumb inside main content.
- **Global header:** brand links to Projects; breadcrumbs provide location rather than a second navigation menu. Keep compact icon-only Settings and Log out controls with accessible names and tooltips; connection status retains its semantic name and state-specific icon. Theme selection belongs in Settings > Appearance. Keep existing routes, including direct `/plan` access. Desktop header is 56px; mobile stays on one 61px row with the text brand hidden but its accessible name retained. Ancestor links remain keyboard/touch accessible. Chat omits its redundant visible route heading, retaining a screen-reader h1; other task-specific titles remain.
- **Work surface:** border plus elevated surface. Toolbars use the same quiet tinted treatment as `.board-toolbar`; they are not floating marketing navigation.
- **Route actions:** use Ant Design Button with `href` and React Router's `useLinkClickHandler`. Ant Design owns the anchor's geometry and icon spacing; router handling preserves client navigation, modifier clicks and unsaved-work guards. Do not reproduce button styling on plain links.
- **Local view switches:** existing Ant Design `Segmented`, with explicit accessible labels. Board/List and editor Markdown/Preview remain separate scopes. Chat has no plan/task selector or legacy review wizard; read-only historical records live in Chat settings and accepted-publication recovery remains below the conversation.
- **Forms:** labels above inputs, helper text adjacent, errors visible near the affected control. Use installed Ant Design inputs/selects/buttons, not styled native lookalikes.
- **Control ownership:** Ant Design owns control heights and padding through its tokens. The selected typography intentionally uses `fontSize: 13` and regular-weight buttons, inputs, selects, view switches and navigation. Do not add per-screen size/weight overrides or CSS minimum heights to Ant Design controls. Segmented labels inherit their control font rather than global form-label styling; icon labels use flex to avoid baseline inflation. Multiline run/folder rows retain content-driven height because they are lists, not standard action buttons.
- **Editors:** reuse MarkdownEditor and its existing CodeMirror skin, Vim support, completion and paste behavior. Add files uses the same asynchronous cursor-mapped insertion as paste. Chat and clarification composers start with the text input; Message/Reply labels remain screen-reader-only. One footer holds named attachment/editor-options icon buttons on the left, with the selected-model trigger, context icon and Send arrow on the right. Vim mode/keybindings and shortcut help live in Editor options; model/thinking and context/research open in separate click popovers. Keep blocked-context diagnostics discoverable automatically, errors visible after dismissal, readable staged filenames and inline upload/completion feedback. Document editors retain their visible title and top toolbar. The composer keeps one square frame, no line-number gutter or active-line stripe, and an auto-growing text scroller: one line by default, up to 5 lines (1.6em line height plus 8px block padding), then scrolling with no visible scrollbar. Popovers use viewport-bounded scrolling and centered placement with horizontal shifting; controls retain native responsive sizes.
- **Empty states:** a compact heading, an explanation and a relevant next action. Board empty states use quiet dashed boundaries; chat uses unframed introductory text in the conversation column. No hero typography or decorative eyebrow sequence.
- **Feedback:** reuse `.notice`, `.error-banner`, `.warning-text`, status tags and existing dialogs. Never hide blocking errors or execution consequences for a cleaner screenshot.
- **Project header:** execution permission uses 16px Phosphor icons: pause for Paused, shield-check for Approved tickets only, lightning for Automatic. Field and menu share the icon/label; preserve the accessible name and full labels without ellipsis. The menu can be wider than its trigger; mobile gives the selector a full row. No redundant Project settings button. Home breadcrumb switches projects; project title hover text and Home card expose the repository path. Keep non-Git tracking warnings visible below the header.

## Screen-specific rules

Final operator-commit UI re-drive, including regular-weight file-selection controls: `/tmp/opencode/backlog-verify-52IQpg/proof/result.json`. Dark/Light desktop/mobile checks passed without horizontal modal/page overflow or browser runtime errors.

| Surface | Preserve |
| --- | --- |
| Home | Projects heading with no intro line and an icon "Add project" action. One compact scheduler strip (state icon, slot count, info Tooltip for the rules, icon Pause/Allow button). Folder cards show one icon-led line each: mode, ticket count, completion, active runs; then coloured status tags. | The folder picker modal: icon title with an info Tooltip, one visible line ("New projects start paused."), an icon-only roots/parent bar beside the path field, icon-led folder rows and icon Cancel/Register buttons.
| Project board/list | Compact, icon-first toolbar like chat: Board/List switch, Needs assistance (count), Move help and Display are icon buttons with tooltips and unchanged accessible names; header Completion and Create with agent are icon buttons, New ticket stays the one labelled primary. Execution context sits under the title. All six columns show by default (Display > Show empty columns, board only; List hides empty groups). Cards pad 10px 12px with an 8px gap: small drag handle, ID, status tag and Actions menu on one row, then the title link; the secondary link appears only when it carries meaning (answer needed, recovery, blocker, error, evidence). The board has no outer frame: toolbar, columns and footer sit directly on the page with 12px column padding and gaps. Full-width viewport workspace; scrolling contained in the board. Quiet solid cards and unframed columns prioritize tickets. Move help uses an Ant Design Button/Popover rather than a handcrafted summary control. Desktop List aligns ID, title, status, next action and Actions; details remain visible below the title, and narrow layouts stack each row. List view: one compact row per ticket (coloured ID, title with icon-led meta below, status tag with dot, actions), no column-label row. |
| Active run bar | Neutral `--surface` bar with `--line` border and a 3px accent left rule, 20px gap before the page title. Header row: status, project / ticket, Answer needed tag; icon actions right (Open, Pause/Resume, Cancel). An agent question renders full-width below the header in the warning-bordered dialog box, answer control and Send on one row, Cancel request with the no-implicit-approval note underneath. |
| Modals (all) | One shared shell, modelled on the ticket detail modal: square bordered container on `--surface` (body colour), 12px 20px header band on `--surface-elevated` with a bottom rule, mono 14px semibold title (icon allowed), 20px body padding, footer with top rule and icon buttons, no shadow. Applies to every antd Modal including confirms; page-specific modals only add width and body scrolling. |
| Toasts | Operation results use Ant Design `message` toasts from the shared `execute` helper: success auto-dismisses after 4s, errors after 8s, at most 3 stacked. Square bordered `--surface-elevated` body with no shadow; the semantic icon carries the type. No inline result line, so results never shift the page. Use `toast.warning` for non-blocking cautions. Blocking or persistent problems stay as inline `role="alert"` banners. |
| Manual ticket/detail | Centered 880px modal (full-width bordered, scrolling body) with a compact header (revision, title, status, one-line facts), one action row (approval explanation lives in an info tooltip) and Requirements / Execution / Activity tabs (attachments, run history, publication source). Markdown/Preview, revision and review safeguards unchanged. |
| Agent creation | Full-width workspace with a 256px conversation sidebar (collapsible to a 57px icon rail, choice kept in localStorage), centered 820px message column and 860px bottom composer. Below 768px, Conversations opens the same history controls in an Ant Design drawer. Current history is marked by border/background and weight, not color alone; selection retains existing save/attachment guards and closes the drawer only after success. Sidebar content is inset 24px from the page edge and 24px from its divider; header, chat titles and Chat settings share an 11px text inset; titles clamp to two lines and the current chat is a filled row. New chat and Chat settings carry Phosphor icons. User messages are compact right-aligned bubbles (6px 12px padding, no role labels); assistant responses remain unframed prose with icon actions (create tickets, copy, retry). Ready shows nothing; while responding, Send becomes a Stop icon button and the composer status line names the work; Failed/Disconnected keep a text tag. Create tickets appears only on eligible responses. Unnamed chats are titled "New chat" until the first accepted message names them. The pending-Send panel appears only for a saved Send or an unreadable browser store. Rename/archive/refresh, introductory guidance, process limitations and read-only historical records (retired plan/proposal flow) live in Chat settings, never inline beside the conversation. Model/thinking, attachments, Vim, context/research, recovery, historical records and response-level ticket creation remain available. Saved-ticket execution holds stay visible. |
| Settings | One Settings heading, icon section links (Appearance, Execution) and no intro paragraph. Appearance comes first and applies immediately in this browser. Execution defaults are stacked bordered sections (OMP & model, Run limits, Folder access), each led by an icon heading with an info Tooltip for the rationale; fields flow in an auto-fit grid, field icons sit in the control suffix and help is one short line. Visible safety lines stay (limits never restart work, human review before Done, folder access is not a sandbox). Footer: status icon plus icon buttons (Load saved, Save). |
| Plan | One page heading, generated section links, and a framed reading document constrained to 82ch. Local Markdown references explicitly open source in a new tab, preserving the workspace. |
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
Page, bounded-conversation and portal-modal body/code scrollbars use the board's `scrollbar-width: thin` and `scrollbar-color: var(--line) transparent`. Apply this explicitly to new portal scroll containers, which do not inherit selectors scoped beneath the workspace. Verify with overflowing content in Light and dark themes, not only short content. Drafting fills available main space with a flex conversation reader and a bottom composer. The reader scrolls independently; short windows, expanded controls and recovery notices can grow the surrounding main scroller rather than clipping actions. Do not add another full-page scroller inside the drafting panel. Conversation follows only near the bottom and otherwise offers Jump to latest.

Preserve labeled controls, keyboard navigation, focus outlines, unsaved-change confirmation, semantic status text and theme selection. Do not convey state through color alone. Check both a dark theme and Light after changing shared styles; verify enabled action/label contrast against its actual surface. Disabled controls must remain distinguishable but are not evidence that an enabled state was tested.

### Chat-first response creation

Removed the required connection, intent, plan, proposal-review and publication-confirmation UI from the main journey. Kept Ant Design controls, IBM Plex typography, square surfaces, theme tokens, the manual drawer and historical publication recovery. Attachments use the Markdown editor's Add files button or paste, never a separate chat file-input form; images in chat become authenticated retained-reference links instead of automatic image fetches. Model/skill controls reflect runtime discovery.

Actual isolated backend/browser verification exercised conversation → response action → single/multiple saved links, reload/backend restart, retained attachment downloads, explicit ticket editing/approval and separate manual creation. Tokyo Night and Light were visually inspected at 1440×1000 and 390×844, including the composer and inline hold feedback, without horizontal document overflow. A separate live-provider chat/skill/project-read → held-ticket journey passed. Sanitized screenshots and receipt: `/tmp/omp-chat-proof-Juy0BL/proof`; preserve before temporary-directory cleanup. These checks are not exhaustive accessibility certification or native-device IME testing.

Composer consolidation: actual React components with synthetic APIs were exercised at 1440px and 390px in Tokyo Night and Light. File selection inserted cursor-bound Markdown while newer text was preserved; a synthetic file-paste event inserted another reference; unsupported files showed an inline error without losing text. Send and Enter cleared text on fixture host acceptance; Shift+Enter retained a newline. Thinking selection and nested context/research disclosures remained operable; no horizontal document overflow was observed. Twelve focused tests, strict TypeScript and ESLint passed. This is UI-fixture verification, not a new live-provider or native clipboard/device certification.

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

Desktop board cards and their grips initiate native dragging; links and Actions retain their own interactions. Midpoint targeting shows insertion before a card or a dashed end placeholder using existing accent/surface tokens. Edge scrolling stays inside the horizontal board and vertical ticket lists. Status transitions still require explicit lifecycle confirmation; Actions remain the keyboard/touch alternative, not a claim of native touch-drag parity.

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

Installed OMP 18.13.3 restricted metadata discovery returned 18 models after the guard fix; no inference. Both the old-version rejection and blank-budget `0` display were reproduced before fixes. No real backend/provider/native compaction UI journey, backend regression suite, strict TypeScript or build was run for this change.

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

Private UI proof: `/tmp/omp-engineering-ui-mQQjTW/result.json` and adjacent screenshots. This is frontend/synthetic-API proof; backend/native/provider results and limitations are recorded separately in `docs/current-agent-workflow.md`.


### Unified agent workspace (U1)

The existing Create with Agent route now has saved workspace selection, creation, title editing, archive/restore and explicit editor saves. No extra navigation entry or route is introduced. Keep the conversation visible beside the right-hand review surface on desktop; below 1050px, stack the conversation and review surface without shrinking controls. IBM Plex, Ant Design geometry, square borders, theme tokens and the page-owned scrollbar remain authoritative.

Discussion includes the ordinary conversation workflow, response-intent selection and explicit read-only repository retrieval. Host-retrieved snapshots, unavailable sources, model assumptions and open questions retain distinct labels; retrieval is not correctness evidence. Plan reuses MarkdownEditor, explicit immutable saves, history and exact-revision approval. Historical revisions never replace current edits. Tasks exposes Auto/Single/Multiple generation, retained sets with rationale/source revision, stale warnings, expandable criteria/verification/dependencies and unresolved questions. Legacy single-ticket publication remains a separate disclosure reusing the parent form, attachment staging and confirmation. A plan is optional; plan approval does not authorize execution.

Saved discussion is not an unsaved change. Protect local prompt, title, plan and ticket edits on navigation/reload, workspace switching and proposal replacement. Switching saves edited text only after confirmation, then separately confirms dropping tab-local attachments; errors keep available editors. Staged attachment bytes are not durable and must be reattached after reload. Connect restores the saved discussion without sending, disconnect/unmount stops the process without deleting messages, and status polling never replaces human editors or automatically replays a turn.

Pending Send recovery appears above both columns with exact-request inspection and explicit host-state check, same-key retry and host-rejected discard. No automatic inference retry. Batch review keeps stable task keys, exposes internal and existing-ticket dependencies, warns before replacing saved or unsaved reviews, and offers explicit saved-review reload after conflicts. Exact preview and mode confirmation are required. Publication status remains visible for same-operation recovery; attachments are not included in batches. External research remains unavailable.

Actual-backend/protocol-child browser checks exercised plan/ticket replacement cancellation, exact plan approval and invalidation, saved state across views/reload/backend restart, model/thinking selection, stale-tab save/archive rejection, conflict recovery, archive/restore, failed/canceled turns and reviewed single-ticket attachment publication. Selected older workspaces restore after reload rather than being replaced by the newest discussion. Historical plan inspection retained current unsaved edits and exposed old revisions read-only; keyboard save was exercised.

Tokyo Night and Light were visually inspected at 1440px and 390px. The conversation and review surfaces use two columns on desktop and stack on mobile; long revision/workspace selects use zero-minimum grid tracks and stay within their panels. Document-width and revision-control bounds passed after correcting mobile intrinsic-width overflow. These checks are not exhaustive accessibility or real-model planning verification. Screenshots were inspected during execution, but the transient proof directory did not survive the later runtime restart; no retained screenshot bundle is claimed. Backend/native results and remaining limits are recorded in the current workflow.

### U1.1 / U2 proposal review verification

Actual Chromium drove the disposable backend and restricted protocol child through pending-Send reload/recovery, host research, generated proposal review, regeneration/failure retention, plan staleness and preserved human ticket edits. Tokyo Night and Light at 1440px and 390px were visually inspected; document widths matched viewports, controls wrapped without shrinking and the conversation stayed in the same workspace. Expanded proposal sections expose scope, criteria, verification and dependencies without a graph library. A concurrent authenticated-editor update was preserved behind a visible save conflict.

Proof: `/tmp/omp-u2-browser-8TTAyw/proof/result.json`, with three retained screenshots after owned-process cleanup. This is deterministic browser/protocol evidence, not paid-provider quality, exhaustive accessibility or U3 publication verification. See current workflow for check commands, the initial default-port launch incident and remaining limits.

## Route-review corrections (November 2026)

Direction remains the compact developer workspace: ENERGY 1 / RHYTHM 1 / MOTION 1. Solid primary accents preserve label contrast; square surfaces and IBM Plex retain the existing identity. Board framing is quieter to favor ticket content, and List uses aligned rows for scanning rather than repeated card footers. Mobile controls gain touch area without a larger text scale. Appearance is separate from execution saving because it persists immediately in the browser. Plan prose is constrained for reading, with generated links to real sections.

Chat initialization now distinguishes failure from loading and retries the selected conversation. A failed Send context check retains per-reference diagnostics after a workspace-version save. Concurrent Preview file paste explicitly reports rejected files and preserves accompanying text; existing stale-edit recovery retains the first upload's references. Folder browse failures disable registration until a successful navigation/retry. Evidence counts include notes; unresolved-check navigation expands and focuses the first non-passing receipt after the tab becomes visible.

Browser proof covered real authenticated Settings, project Board/List, manual drawer and Plan surfaces, plus isolated synthetic folder failure/retry, selected-chat load retry, blocked context after a version-changing save, unresolved receipt navigation and concurrent Preview paste. No ticket approvals, execution-permission changes, commits or provider turns were performed. These are scoped UI checks, not full feature-map, live-provider or native mobile clipboard certification.

### Equal outer control heights

Standard action buttons, inputs, selects and segmented switches share 32px desktop and 44px mobile outer height. Chat actions and ticket Actions no longer request the small button variant. Mobile segmented padding is removed so its 44px labels do not create a 48px container. Search clear buttons retain a 44px positioned hit area without increasing the input's layout height. Switch tracks, drag grips and multiline content retain their intentional geometry.

Changed TSX passed ESLint. Actual App components with synthetic APIs measured search, Board/List, ticket Actions, Disconnect and Check context at exactly 32px (1440px viewport) and 44px (390px), in Light and Tokyo Night. Search clear, Board/List switching, Actions open/Escape and blocked-context feedback worked; no horizontal document overflow or page exceptions were observed. Screenshots were inspected. This is scoped presentation/fixture proof, not live-provider or exhaustive accessibility verification.

### Native Ant Design action controls

Replaced handcrafted New ticket, Create with agent and Add project link styling with Ant Design anchor buttons and React Router click handlers. Move help now uses the existing Ant Design Popover/Button pattern. Deleted the competing mobile input/button/segmented sizing rules; a single responsive ConfigProvider token supplies the 44px mobile control size while desktop uses the native default. Native disclosures, drag targets and compact switch hit areas retain their accessibility sizing.

Changed TSX passed ESLint. Actual App/synthetic-API browser proof measured all nine project-header/board-toolbar controls at 32px on 1568px desktop and 44px on 390px mobile in Light and Tokyo Night. Move help opened and closed with Escape, New ticket opened its drawer and returned keyboard focus on Escape, and Create with agent navigated to the composer. No page exceptions were observed; screenshots were inspected. No provider turns or real project mutations were performed.


### Conversation layout revamp

Direction: ENERGY 1 / RHYTHM 1 / MOTION 1. The familiar chat composition is explicitly requested; OMP retains IBM Plex, square Ant Design controls and semantic theme colors. A constrained message column improves reading; right-aligned user surfaces distinguish authors without decorative stripes. The bottom composer stays aligned to the conversation, while a settings modal keeps history management and process limitations out of the reading flow. No new assets, dependencies, backend behavior or execution authority.

Changed TSX passed ESLint. Actual App/browser checks with synthetic APIs visually inspected Tokyo Night and Light at 1568px, 820px and 390px, without horizontal document/main overflow or recorded page exceptions. Toolbar buttons/selects measured native 32px desktop and token-owned 44px mobile. Exercised settings open/Escape/focus return, title save, refresh, archive cancel, model-settings disclosure, thinking selection, repository retrieval, context checks/reference-only selection, staged attachment insertion, blocked Send retaining text, attachment-switch cancellation, response-ticket result/hold links, New chat empty state and scroll-up/Jump to latest. This is scoped frontend-fixture proof, not live-provider, native-device keyboard/IME, backend publication, exhaustive accessibility, test-suite or build verification.

### Shared navbar and conversation space

Moved all route breadcrumbs into App's navbar and removed local project/chat trails. Chat's visible route heading and introductory paragraph no longer consume reading space; the semantic heading and guidance remain available to assistive technology and Chat settings respectively. History/New chat/settings moved into the requested sidebar and mobile drawer. Smaller composer text viewport and a shared action row reserve more room for messages without removing editing tools.

Changed App, Workspace and AgentTicketDraft code passed ESLint. Synthetic-API browser checks covered navbar location on all eleven route cases (Projects, Add project, project, New ticket, saved ticket, run, Settings, Plan, unknown path, unavailable project and chat), desktop ancestor navigation and the mobile ancestor menu with keyboard activation. No local breadcrumbs or horizontal document overflow remained. Final chat checks at 1568px, 820px and 390px in Tokyo Night and Light measured 56px/61px navbar heights and approximately 514px desktop / 374px phone message readers at 865px viewport height with a long draft. Screenshots were visually inspected; no page exceptions were recorded.

Sidebar checks covered switching both directions, selected-row state, drawer Escape/focus return, New chat, canceled unsaved switching retaining text, confirmed save-and-switch closing the drawer, relocated settings guidance, model disclosure and blocked context diagnostics. Zero provider turns, real ticket mutations or execution-authority changes. Route fixtures verify the shared shell, not every page's unchanged backend behavior. No build, test suite, full typecheck, exhaustive accessibility or native-device verification was run.

### Floating chat chrome

Conversation names remain in history and Chat settings, not a repeated content heading. A concise runtime label floats 12px from the reader's top-left; Stop appears beside it while responding. Latest is a separate native button floating bottom-center only when following is paused. Both are anchored to the conversation viewport, not the page; reader padding keeps the first/last content reachable. Showing Latest does not reduce reader height. Full operation/error/recovery feedback remains available.

Changed TSX passed ESLint. Actual App with synthetic APIs was inspected at 1568px and 390px in Tokyo Night and Light: top/left and bottom offsets measured 12px, no title or horizontal overflow, and unchanged reader height when Latest appeared. Keyboard activation returned to the bottom and hid Latest; Stop settled fixture busy to idle. Ready, Responding, Failed and Disconnected labels were exercised. No page exceptions, provider turns or real ticket changes; browser released. No build, test suite, full typecheck or native-device verification.

### Ticket-generation modal

Create tickets first asks for confirmation (it starts a model request), then opens an Ant Design modal. The modal shows host-reported generation/saving status, explicit errors, clarification questions, existing guarded recovery actions and saved-ticket links with the execution-hold explanation. No percentage or invented intermediate stages. Chat retains one compact ticket-status button per response to reopen the modal; Escape or Back to chat dismisses it without cancelling work. A collapsed source response identifies the input without duplicating the conversation by default.

Direction remains ENERGY 1 / RHYTHM 1 / MOTION 1. Existing theme tokens, square surfaces, typography and native responsive Ant Design control sizes keep the modal aligned with chat and composer. A bounded, scrollable modal body preserves access to long errors/results on mobile. No new assets, dependencies, backend workflow or execution authority.

Synthetic-API browser proof covered generating, saving, interrupted errors, retry, completed held-ticket links, source disclosure, close/reopen and keyboard activation at 1568px and 390px in Light and Tokyo Night, without horizontal page/modal-body overflow. Additional fixture checks exercised failed status refresh, clarification and inspect-before-resume publication recovery. Screenshots were inspected; no page exceptions were recorded. No live provider calls, real tickets or publication mutations were performed. This is scoped frontend evidence, not backend/provider verification.

Ticket modal sizing: 1040px desktop width and a viewport-relative body limit (`100dvh - 180px`) provide more reading room; native responsive margins and body scrolling remain. Synthetic browser checks with the source expanded measured 1040px on desktop and 374px at a 390px viewport in both themes, with the complete modal inside the viewport and no horizontal overflow. Source expansion and Escape worked; changed TSX passed ESLint.

### Generation model recovery and portal scrolling

Interrupted ticket generation without a publication exposes Change generation model. Model discovery uses the existing restricted metadata-only service; no model or thinking fallback is selected implicitly. The operator chooses both fields before Retry with selected model. Image requirements disable incompatible choices and remain backend-enforced. The persisted operation records its generation selection separately from immutable accepted-turn/source evidence and chat settings. Existing publication ownership, inspection, no-duplicate and creation-hold gates remain unchanged.

The modal body and source code blocks now explicitly use the same thin, theme-colored scrollbar as chat; portal rendering must not bypass shared conventions. A stable body gutter prevents layout jumps. Mobile model/thinking fields wrap onto full-width rows while retaining native 44px controls; desktop controls remain 32px. Disclosures retain 44px mobile hit areas and visible keyboard focus. Direction remains ENERGY 1 / RHYTHM 1 / MOTION 1; no new assets or dependencies.

Eight focused backend/protocol tests passed across workspace, response-operation and drafting suites, including unavailable-model replacement with unchanged source hash/chat/prompt, persisted selection after reopen, image/thinking rejection, held publication and no duplicate completed retry. Changed-code ESLint passed. Actual App/synthetic-API browser checks exercised explicit model/thinking choice, blocked text-only selection with images, text selection without images, discovery failure/reload, exact retry payload, close/reopen, retained unsent text and wheel-scrolling long source content. Tokyo Night/Light at 1568px and 390px showed no horizontal overflow; computed modal scrollbar width/color matched chat. Final fields measured 32px desktop and 44px mobile, with both mobile fields 316px wide.

The existing localhost:4310 server became unreachable during final inspection. Final screenshots/field geometry used an owned frontend-only Vite preview with synthetic APIs on 127.0.0.1:4311; no project backend was restarted. No live-provider generation, real ticket publication, build, full typecheck, native-device or exhaustive accessibility verification was performed.

### Inline clarification and shared model picker

Reading this as: ticket-drafting workspace for developers, existing square IBM Plex/Ant Design language, ENERGY 1 / RHYTHM 1 / MOTION 1.

Clarification places the same composer inside Ticket creation instead of requiring a return to chat before answering. There is one unsent draft and one mounted editor. Send reply pins the original response and questions into the submitted message; durable acceptance returns to chat, preserving newer typing. Creating tickets from the follow-up remains explicit. Closing/reopening preserves the unsent draft. Uncertain Send exposes the existing exact-request recovery rather than automatically retrying.

`ModelPicker` owns searchable, labeled model/thinking selects and responsive geometry. Discovery, supported levels, image restrictions, defaults, inheritance and saving remain caller-owned. Chat, clarification, generation recovery, Settings and ticket next-attempt overrides use it. Shared presentation never makes their settings global state.

Decision reasons: existing semantic accent identifies the primary action; IBM Plex retains workspace identity; square editor framing identifies shared draft ownership; adjacent questions and reply reduce navigation; wrapping grid tracks preserve readable model names; standard tokens preserve 32px desktop/44px mobile controls. No assets, cards, decorative icons or motion were added.

Verification: changed-code ESLint and seven focused pending-request/composer-state tests passed. Actual React surfaces used isolated synthetic APIs, not a backend/provider. Clarification was inspected at 1568px, 820px, 390px and 320px in Tokyo Night and Light; Settings and ticket pickers at 1568px and 390px. No document/modal horizontal overflow, one mounted editor, named fields and 13px controls were observed. Mobile selects/actions measured 44px. Modal helper, editor, picker and enabled primary-action text contrast measured at least 5.13:1 in the inspected pairings. No page runtime errors were recorded.

Recorded interactions: Create tickets opened questions; source disclosure opened with Enter; Check ticket creation refreshed status; model Beta and thinking high sent their exact scoped requests; Send reply included source/questions/answers, closed on acceptance and cleared only the submitted draft; a new completed response exposed Create tickets and saved held-ticket links; Escape/back/reopen preserved unsent text. A context error retained text without sending. Uncertain Send exposed recovery; exact retry, including after reload, retained key/body and cleared on acceptance. Typing during a held response survived acceptance. Generation retry sent the selected model/thinking. Settings discovery enabled model/thinking edits and Load saved settings restored defaults. Ticket selection reset thinking and returning to Workspace default restored inheritance. Mobile modal scrolling reached Send reply and both picker fields.

Private scoped proof: `/tmp/omp-inline-clarification-fixture/proof/result.json`, `desktop-dark.png` and `mobile-light.png`. Browser and owned frontend stopped; throwaway fixture scripts removed. Preserve proof before temporary-directory cleanup.

#### Scoped antislop delivery gate

Applies to changed controls and clarification journey, not whole-product certification. Unchanged backend validation/publication, live-provider behavior, native-device keyboard/clipboard and exhaustive accessibility remain unverified. No build or full-project typecheck ran.

- R-02 PASS: new UI copy uses periods/commas, no em dash.
- R-03 PASS: inspected 320/390/820/1568px modal layouts without overflow; mobile controls measured 44px.
- R-17 PASS: no product statistics added.
- R-18 PASS: no testimonials added.
- R-23 PASS: no assets or navigation structure created.
- R-24 PASS: existing real ticket/project destinations retained.
- R-25 PASS: inspected changed text pairings exceeded 4.5:1, minimum measured 5.13:1.
- R-26 PASS: model/thinking requests, reply, explicit follow-up creation and recovery actions observed.
- R-27 PASS: existing loading/error feedback retained; blocked context, pending recovery and empty reply observed.
- R-28 PASS: no FAQ added.
- R-32 PASS: native controls, Enter disclosure, Tab/select keys and Escape modal dismissal exercised.
- R-33 PASS: changes live directly in TSX/CSS, no rewrite script.
- R-34 PASS: Tokyo Night and Light inspected across affected surfaces.
- R-35 PASS: actual React UI ran; changed-control interaction evidence recorded above.
- R-36 PASS: no security, billing, customer or performance claims introduced.
- R-37 PASS: repository direction and explicit Design Read preceded implementation.
- R-38 PASS: product copy describes implemented behavior; verification data is explicitly synthetic.
- R-39 PASS: picker uses unique label/input associations and native Ant Design controls; existing pointer, disabled and focus rules retained; no motion introduced.
- R-40 PASS: no media, third-party scripts, late visual assets or performance figures introduced.
- R-01 PASS: existing semantic accent identifies Send reply, no gradient/glow added.
- R-04 PASS: existing attachment glyph retained for file action; no new icons.
- R-06 PASS: existing IBM Plex typography preserves developer-workspace identity.
- R-07 PASS: no background pattern added.
- R-08 PASS: no decorative arrows added.
- R-09 PASS: existing ticket operation labels retain actual states, no badges added.
- R-10 PASS: no glass effects added.
- R-12 PASS: existing modal elevation retained to distinguish its focused task.
- R-13 PASS: no glow added.
- R-14 PASS: no feature cards added.
- R-19 PASS: no new animation; native theme motion remains disabled.
- R-22 PASS: no illustrations added.
- Dials PASS: ENERGY 1 / RHYTHM 1 / MOTION 1 explicit.
- Dial consistency PASS: compact predictable fields, no decorative motion.
- Focal point PASS: questions/reply own the active modal task; Send reply is its primary action.
- Whitespace PASS: existing grid gaps separate questions, explanation and composer.
- Accent PASS: existing primary accent identifies the submission action.
- Identity PASS: square framed editor, IBM Plex and existing semantic palettes retained.
- Design Read PASS: declared above and before implementation.
- C-1 PASS: major visual decisions have explicit reasons above.
- C-2 PASS: changed selects and reply/recovery actions exercised.
- C-3 PASS: modal contains source, operation state, questions and reply, no template sections.
- C-4 PASS: inspected empty/loading/error/pending states, keyboard controls and responsive themes.
- C-5 PASS: no fabricated product claims added.
- R-05 PASS: layout follows the actual clarification task, not a landing-page template.
- R-11 PASS: existing square Ant Design geometry retained.
- R-15 PASS: Send reply and existing explicit ticket/recovery labels name their actions.
- R-16 PASS: new copy uses no marketing buzzwords.
- R-20 PASS: existing workspace typography, framing and response-bound ticket workflow retained.
- R-21 PASS: existing appearance selection unchanged; both themes inspected.
- R-29 PASS: existing semantic theme palette retained, no new colors.
- R-30 PASS: no other product's visual identity introduced.
- R-31 PASS: reasons for color, layout, typography, spacing and framing recorded above.

### Text-first composer

Direction: ENERGY 1 / RHYTHM 1 / MOTION 1. Input precedes secondary tools to prioritize writing; existing IBM Plex, semantic colors and square framing preserve workspace consistency. Message and Reply retain their accessible names without a visible heading. No document-editor layout or submission/upload logic changed.

Scoped delivery gate:
- Hard Gate PASS: actual MarkdownEditor fixture checked at 1440/820/390/320px in Tokyo Night and Light with no horizontal overflow; accessible textbox labels retained. Enter submission, Shift+Enter newline, attachment insertion, Send, Vim insert/Escape and keyboard toggle worked. Inspected input/tool/hint text contrast was at least 4.89:1; no new assets, claims, navigation, effects or media.
- Purpose-Gate PASS: only input/tool ordering and label visibility changed; existing attachment icon denotes files, typography matches the workspace, and no decorative technique was added.
- Liveliness PASS: declared calm dials match static compact controls; input comes first, existing primary accent identifies Send, and square IBM Plex framing remains the identity motif.
- Craftsmanship/Quality PASS: Light and dark desktop/mobile screenshots inspected; document-editor title/top toolbar preserved. Empty composer and enabled/disabled Send observed, both disclosures opened, and no browser runtime errors recorded. Changed TSX passed ESLint.

Verification used disposable synthetic component callbacks, not an authenticated backend, real upload storage or provider. No build, full suite, full typecheck or native-device verification ran. Temporary fixture sources were removed.

### Compact composer footer

Supersedes the three-row composer described above. Direction remains ENERGY 1 / RHYTHM 1 / MOTION 1. A single footer prioritizes writing; secondary controls open only when needed. Existing semantic colors, IBM Plex, square controls and attachment glyph preserve workspace identity. Sliders identify editor options, the stack identifies supplied context, and the upward arrow submits the message. No assets, dependencies or backend behavior added.

Scoped delivery gate:
- Hard Gate PASS: actual AgentTicketDraft/MarkdownEditor with synthetic API callbacks ran in Tokyo Night and Light at 1568/820/390/320px. All five footer actions shared one row; controls measured 32px desktop/44px mobile. Editor/model/context popovers fit without document overflow after correcting corner placement. Sampled enabled text/icon contrast in the footer and all three popovers exceeded 5.28:1. Accessible names, Enter/Shift+Enter, Vim insert/Escape, keyboard switch and Escape/focus return were exercised. No assets, fabricated claims, navigation or motion introduced.
- Purpose-Gate PASS: icons denote existing actions, popover elevation separates temporary settings, typography and palette remain the workspace's; no decorative effect added.
- Liveliness PASS: calm dials declared; input is the focal point, whitespace separates writing from one action row, the existing accent identifies Send, and square IBM Plex framing remains the identity motif.
- Craftsmanship/Quality PASS: desktop/mobile Light/dark screenshots inspected. Actual model/thinking changes, research retrieval, context checks, attachment selection, Enter/button submission and clarification reply were exercised. Blocked Send opened diagnostics, preserved text and submitted no turn; closing retained the visible error, and another failure reopened diagnostics. Empty and enabled/disabled Send states observed. Final changed-TSX ESLint passed; no browser runtime errors recorded.

Proof screenshots: `/tmp/composer-revamp-{dark,light}-{1568,390}.png` and `/tmp/composer-revamp-popup-{dark,light}.png`. Component-fixture evidence only: no authenticated backend, provider, real upload storage, build, full suite, full typecheck or native-device check. Disposable fixture sources removed; owned browser released.
