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
| Controls and metadata | IBM Plex Mono. Standard controls 38px high; small controls reserved for subordinate inline actions. | `--font-mono`, `--control-height`, App ConfigProvider |
| Helper text | Generally 13px. Smaller type only for secondary metadata, not primary actions or form labels. | `.muted`, `.path`, component metadata |
| Shape | Square panels, inputs, buttons and tags. Circles only for meaningful swatches/status marks and existing switches. | ConfigProvider `borderRadius: 0` |
| Surfaces | Workspace background, elevated framed work area, inset reading/editing area. One-pixel borders define ownership. | `--surface`, `--surface-elevated`, `--surface-inset`, `--line` |
| Color | Use semantic theme variables. Accent for selection/primary action; warning/danger retain real safety meanings. | `src/themes.ts`, App theme mapping |
| Motion | No entrance choreography or continuous effects. Existing hover/pressed/focus feedback only. Respect reduced motion. | ConfigProvider `motion: false`, shared CSS |

Self-hosted IBM Plex fonts and existing theme palettes remain authoritative. Do not add fonts, icon families, hardcoded page palettes or dependencies for visual consistency.

## Composition and components

- **Page header:** location/back navigation when needed, one route title, short description, contextual actions. Use the shared gutters and title scale. Controls may wrap on small screens.
- **Work surface:** border plus elevated surface. Toolbars use the same quiet tinted treatment as `.board-toolbar`; they are not floating marketing navigation.
- **Route actions:** `.home-action`, `.new-ticket-link` and `.agent-ticket-link` share geometry in `src/styles.css`. Keep React Router links for navigation. Primary links match primary buttons; secondary links match bordered buttons.
- **Local view switches:** existing Ant Design `Segmented`, with explicit accessible labels. Board/List, Discuss/Review ticket and Markdown/Preview remain separate scopes.
- **Forms:** labels above inputs, helper text adjacent, errors visible near the affected control. Use installed Ant Design inputs/selects/buttons, not styled native lookalikes.
- **Editors:** reuse MarkdownEditor and its existing CodeMirror skin, Vim support, completion and paste behavior. The chat composer is shorter than a document editor, not a second editor design system.
- **Empty states:** a compact heading, an explanation and a relevant next action. Conversation and board empty states use quiet dashed boundaries; no hero typography or decorative eyebrow sequence.
- **Feedback:** reuse `.notice`, `.error-banner`, `.warning-text`, status tags and existing dialogs. Never hide blocking errors or execution consequences for a cleaner screenshot.

## Screen-specific rules

| Surface | Preserve |
| --- | --- |
| Home | Project-first navigation, reusable route action, familiar folder cards and contextual scheduler controls. |
| Project board/list | Full-width viewport workspace; scrolling contained in the board; established cards, toolbar and footer. |
| Manual ticket/detail | Existing drawer, expandable width, Markdown/Preview, attachments, revision and review safeguards. |
| Agent creation | Separate full-width page, framed session toolbar/conversation/composer, Discuss/Review ticket switch. Review uses the same framed form language as settings/manual editing. |
| Settings | Shared route title, bordered form, native component sizing and visible safety explanations. |
| Plan | Shared route title and framed reading document. Document headings retain their own reading hierarchy. |
| Run evidence | Existing framed panel, metadata, readable transcript, explicit evidence provenance and contextual controls. |
| Login | Deliberate public-entry composition; its larger introductory headline is not a workspace page-title pattern. |

## Responsive and accessibility contract

At narrow widths, headers and controls wrap into a single-column flow. Keep horizontal scrolling inside editors, tables and the board rather than the document. Do not shrink text or controls to force desktop layouts onto mobile. Keep all actions reachable on short viewports.

Preserve labeled controls, keyboard navigation, focus outlines, unsaved-change confirmation, semantic status text and theme selection. Do not convey state through color alone. Check both a dark theme and Light after changing shared styles; verify enabled action/label contrast against its actual surface. Disabled controls must remain distinguishable but are not evidence that an enabled state was tested.

## Verification for this correction

Changed frontend code passed ESLint. A Vite-only real-browser smoke rendered the actual App, Workspace, MarkdownEditor and styles using synthetic session/state/drafting responses, with no backend or provider attached.

Observed at 1568px: Home, settings, plan, project and drafting route titles were 24px/700; both project creation links and drafting connection/model controls were 38px high. Manual creation still opened its drawer without the agent component. Synthetic connect/disconnect controls and Discuss/Review switching remained operable. Drafting Discuss was visually inspected with Kanagawa and Light at desktop and 390px mobile widths. Review mounted its framed editor on desktop and mobile; Home, settings, plan, board and drafting Review had no horizontal document overflow at 390px.

Screenshots were visually inspected for drafting, manual drawer and settings. This is presentation/synthetic-interaction proof, not live-provider verification, exhaustive accessibility certification or a Lighthouse performance result. Safety and process lifecycle behavior were not changed by this correction.
