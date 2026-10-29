# Trello-like kanban drag and drop

Research date: 2026-10-29. Research only; no implementation, dependency changes or browser testing. External requests used public documentation URLs and generic queries, not project content.

## Recommendation — synthesis, not a source mandate

**Keep native HTML dragging for desktop pointers, the existing Ant Design Actions menu for keyboard/touch, and the existing revision-bound action path.** Improve insertion targeting and, if needed after browser checks, bounded edge scrolling. No new drag library is needed for this scope. “Trello-like” means predictable card movement and visible insertion feedback, not unrestricted workflow transitions.

## What primary sources establish

| Source | Documented guidance/behavior | Implication — our interpretation |
| --- | --- | --- |
| Trello: Move cards or lists [1] | Drag cards up/down within a list or between lists; a card/context menu also exposes Move. | Offer both direct manipulation and explicit menu actions. Trello's generic lists do not define this app's execution permissions. |
| Trello: How to use Trello like a pro [2] | Board-background dragging and Shift + scrolling move the board horizontally. | Horizontal board navigation matters; this does not document card-drag autoscroll or justify intercepting every pointer gesture here. |
| MDN: Drag operations [3] | Set drag data/effectAllowed during dragstart; cancel dragover only for valid targets; set dropEffect during dragover. dragend fires whether the operation succeeds or fails, including Escape cancellation. setDragImage can use an element. | Keep a local source reference, move-only feedback, valid-target checks and unconditional cleanup. A card-sized drag image can improve a grip-only drag without making links/text draggable. |
| MDN: Kanban example [4] | Uses pointer coordinates and element bounds to choose an insertion point, a visible placeholder, no-op suppression and containment-aware dragleave cleanup. Its insertion heuristic is explicitly a judgment call. | Use a clear before/after marker. Midpoint targeting is a reasonable local choice, not a documented Trello algorithm or mandatory MDN rule. Do not copy its direct DOM moves into React's managed ticket list. |
| W3C: WCAG 2.5.7 Understanding [5] | Dragging functionality needs a single-pointer alternative without dragging; keyboard access is a separate requirement. Examples explicitly include up/down controls and task-board destination menus. Browser-provided overflow scrolling is distinguished from author-implemented drag scrolling. | Preserve click/tap Actions with Move up/down and allowed destinations, plus keyboard operation. Keyboard-only shortcuts would not provide the touch/pointer alternative. |
| W3C: Menu Button Pattern [6] | Enter/Space opens a menu and focuses its first item; trigger has button semantics, aria-haspopup and an accurate expanded state. | Reuse installed Ant Design Dropdown/Button; verify its actual rendered semantics and keyboard/focus behavior rather than assuming library use proves accessibility. |

## Local baseline and lifecycle boundaries

Inspected [README](../README.md#navigation), [design language](design-language.md), [TicketBoard.tsx](../src/TicketBoard.tsx), [ticketBoard.ts](../src/ticketBoard.ts), [workflow](current-agent-workflow.md#normal-ticket-lifecycle) and [package.json](../package.json). These are local source observations, not runtime verification:

- Pre-implementation baseline: board used grip-only native dragging, insertion-before/end feedback, Actions up/down, live status announcements and focus restoration. The item handler always targeted **before** that item, irrespective of pointer height; the column handler targeted the end. It had no explicit drag-edge scrolling logic. Later implementation/verification is recorded in [design language](design-language.md#card-drag-interactions), separately from this research.
- `insertionOrder` uses the full queue's neighbors, not only displayed cards. Keep that behavior under search, hidden statuses and attention filters; visual grouping must not renumber hidden work or change exact statuses.
- `transitionFor` allows only Draft → Ready (`approve`); Failed/Blocked/Interrupted → Ready (`retry`); Needs review → Ready (`changes` with durable feedback); Needs review → Done (`done`, human acceptance). Same-group moves reorder only. Active Running/Stopping/Paused, removed and error-bearing tickets are not movable.
- Preserve `move` as the shared drag/menu mutation path: explicit confirmation for transitions, current-revision run/evidence checks, stale-source recheck after confirmation, backend action request and error reporting. Do not infer approval from pointer release, mark Done optimistically, or assign status directly from a column ID.
- Existing permissions, dependencies, one global execution slot, paused ownership and workspace gates remain authoritative. Ready is not immediate execution; Done is not a handoff-gate release. [Local workflow](current-agent-workflow.md#human-review-and-corrective-attempts)

## Minimal implementation proposal

Recommendations for the implementing session, **not changes delivered by this note**:

1. **Position:** compare `clientY` with the hovered card's vertical midpoint. Upper half targets that card; lower half targets the next non-source card, or end. Resolve to the existing `before` anchor contract using the full group order, including hidden neighbors. Apply the same calculation on drop so marker and saved placement cannot disagree. Treat gaps, empty columns, self and unchanged positions deliberately. MDN supports coordinate-based placement but leaves the heuristic to the application. [3–4]
2. **Feedback:** retain the source card's layout footprint; render one stable themed insertion line/placeholder and move/not-allowed feedback. Update React state only when the logical target changes. Optionally call `setDragImage` with the existing card during dragstart; no clone/overlay subsystem is required. Clear feedback on drop, true column exit, dragend and unmount. [3–4]
3. **Scrolling:** preserve horizontal scrolling inside the board and independent vertical column scrolling, per [design language](design-language.md#responsive-and-accessibility-contract). First test native behavior; the cited docs do not guarantee nested-container edge autoscrolling. If insufficient, use one owned requestAnimationFrame callback to scroll the board horizontally and hovered column vertically near their respective edges, using native `Element.scrollBy`. Recompute placement as content scrolls; stop on exit/drop/cancel/unmount and when no scroll range remains. This is an application proposal, not Trello's documented implementation. Prefer instant increments, not stacked smooth animations. [2–3, 7]
4. **Keyboard/touch:** keep every permitted transition and within-column reorder available through click/tap Actions in Board and List. Verify Tab → Actions → Enter/Space → menu navigation → activation, Escape cancellation, confirmation focus and focus restoration after a card disappears under filters. Announce saved/unchanged/failed outcomes, not every dragover. Avoid replacing ordinary card/link semantics with a custom ARIA grid/listbox just for dragging. [5–6]
5. **Safety:** ignore unrelated external drags unless the local grip established a source. Do not deserialize dropped text into an action authorization. Retain revision/status checks at drop/confirmation and all server gates; cancellation or rejected requests leave persisted order/status unchanged. [3–4; local `move`/`transitionFor`]

### Native touch limitations

Native HTML drag and drop is **not a promise of consistent finger dragging**. MDN describes a mouse/drag-event model; current MDN compatibility data reports interfaces/attributes on mobile, but API presence does not establish a uniform touch initiation gesture, scrolling interaction or usable behavior on each device. Do not claim all mobile browsers lack support, or claim native dragging alone delivers touch parity. No touch hardware/browser testing was performed here. The minimal supported touch path is **tap Actions → move/reorder → confirm**, while retaining normal browser touch scrolling. Full touch dragging, if explicitly required later, needs separate device testing and implementation scope; no dependency or touch-action suppression is authorized by this note. [3, 5, 8]

## Verification to perform separately

Exercise desktop pointer drag above/below cards, gaps, first/last/empty destinations, long-column and horizontal edge scrolling, Escape/outside cancellation, filters and hidden neighbors. Independently exercise keyboard and tap Actions, all permitted transitions, confirmation cancellation, stale revisions, request failures and active-ticket rejection. Check a dark theme and Light at desktop/mobile widths, visible focus and non-color insertion feedback. These checks are proposed, not reported passing; no lint/build was run for this documentation-only change.

## Primary sources

1. [Atlassian Trello — Move cards or lists](https://support.atlassian.com/trello/docs/moving-cards-or-lists/), **Move cards**.
2. [Atlassian Trello — How to use Trello like a pro](https://support.atlassian.com/trello/docs/how-to-use-trello-like-a-pro/), **Drag board to scroll**.
3. [MDN — Drag operations](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Drag_operations), **Starting a drag**, **Drop feedback**, **A failed drop**, **Finishing the drag**; [API overview](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API), **Draggable items** and **Drag data store**.
4. [MDN — Kanban board with drag and drop](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Kanban_board), **Inserting at a particular location**, **Graying out the original task**. [Official source consulted](https://github.com/mdn/content/blob/main/files/en-us/web/api/html_drag_and_drop_api/kanban_board/index.md).
5. [W3C WAI — Understanding SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), **Relationship to keyboard accessibility requirements** and **Examples**. Informative explanation of [normative WCAG 2.2 criterion](https://www.w3.org/TR/WCAG22/#dragging-movements), not certification of this app.
6. [W3C WAI-ARIA APG — Menu Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/), **Keyboard Interaction**, **WAI-ARIA Roles, States, and Properties**.
7. [MDN — Element.scrollBy](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollBy), coordinates and behavior options.
8. MDN browser-compat-data: [DragEvent](https://github.com/mdn/browser-compat-data/blob/main/api/DragEvent.json), [draggable global attribute](https://github.com/mdn/browser-compat-data/blob/main/html/global_attributes.json), [DataTransfer](https://github.com/mdn/browser-compat-data/blob/main/api/DataTransfer.json). Compatibility metadata is not an end-to-end touch usability test.
