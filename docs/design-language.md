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

| Surface | Preserve |
| --- | --- |
| Home | Project-first navigation, reusable route action, familiar folder cards and contextual scheduler controls. |
| Project board/list | Full-width viewport workspace; scrolling contained in the board; established cards, toolbar and footer. |
| Manual ticket/detail | Existing drawer, expandable width, Markdown/Preview, attachments, revision and review safeguards. |
| Agent creation | Separate full-width page; main page owns vertical scrolling, not an inset editor-panel scroller. Framed session toolbar/conversation/composer and Discuss/Review ticket switch. Review uses the same framed form language as settings/manual editing. |
| Settings | Shared route title, bordered form, native component sizing and visible safety explanations. |
| Plan | Shared route title and framed reading document. Document headings retain their own reading hierarchy. |
| Run evidence | Existing framed panel, metadata, readable transcript, explicit evidence provenance and contextual controls. |
| Login | Deliberate public-entry composition; its larger introductory headline is not a workspace page-title pattern. |

## Responsive and accessibility contract

At narrow widths, headers and controls wrap into a single-column flow. Keep horizontal scrolling inside editors, tables and the board rather than the document. Do not shrink text or controls to force desktop layouts onto mobile. Keep all actions reachable on short viewports.


Board/list workspaces retain a 480px minimum height at every width. The surrounding main container scrolls vertically when headers, warnings and the board no longer fit, rather than compressing the ticket viewport. Project headers do not shrink. Tall windows still fill available space without unnecessary page scrolling; horizontal overflow stays inside the board.
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
