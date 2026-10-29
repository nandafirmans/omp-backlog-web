# Native OMP compaction thresholds and footer telemetry

Research date: 2026-10-29. Scope: official `can1357/oh-my-pi` **v18.13.3** source, terminal context gauge, RPC telemetry and this app's integration gap. Research only; no code/configuration/runtime changes, credential inspection, inference, builds or tests. Recommendations below are not implemented.

## Recommendation

**Keep current context/capacity and native compaction status; do not draw supposedly exact threshold/speculation markers from today's RPC.** v18.13.3 computes these inside the OMP process but does not expose them through `get_state` or `get_session_stats`. Request a small, read-only upstream telemetry addition using the existing native resolvers; then render labeled markers in the existing app meter. Do not assume a universal 80%/85% trigger, read user configuration files, or add a host compaction loop. [U1–U3, U8–U10; L1–L4]

Version distinction: the existing [local compatibility check](omp-18.13.3-compatibility.md#reproduction-and-fix) records installed `omp/18.13.3`; this research did not rerun that command or inspect the installed package. GitHub's official [latest release API](https://api.github.com/repos/can1357/oh-my-pi/releases/latest) returned `v18.13.3`, published `2026-10-28T12:49:52Z`, during this research. Thus installed version **previously observed** and latest **published release observed now** agree; this is not a claim about unreleased `main` or future releases. [U0; L5]

## 1. Actual threshold resolution

Let `W` be the active model's real context window, and `T` the resolved compaction trigger, both in tokens. The engine's ordering is: [U1]

1. **Positive finite `thresholdTokens` wins.** Below `W`, use that exact limit (bounded to `[1, W−1]`). At or beyond `W`, fall back to the real window's prompt budget rather than waiting for an impossible trigger.
2. Otherwise, a positive finite `baseWindowTokens` replaces `W` with `min(W, baseWindowTokens)` for percentage/reserve arithmetic only. Provider capacity and overflow budgets still use the real window.
3. Positive finite `thresholdPercent`: clamp percentage to `[1, 99]`, then `T = floor(base × percentage / 100)`. A configured `100%` therefore resolves to 99%, not full capacity.
4. No positive percentage: use `promptBudgetTokens(base, settings)`, i.e. `max(0, min(base−1, base−resolvedReserve))`.

Reserve is normally `max(floor(base × 0.15), configured reserve ?? 16384)`. Small-window recovery substitutes `max(1, floor(base × 0.15))` when the **unset/defaulted** reserve would effectively consume the window, or when the effective reserve reaches/exceeds it. An explicit valid reserve retains its provenance; explicitly setting 16384 is not equivalent to leaving it unset. [U1]

Defaults in the coding-agent settings: enabled, async enabled, mid-turn enabled; percentage/token overrides `−1`; reserve unset; keep-recent 20,000; auto-continue enabled. Method order: `remote → snapcompact → handoff → shake → soft`. Idle compaction is separately disabled by default; if enabled, its defaults are a 200,000-token threshold and 300-second delay (cache policy can affect timing). The engine also exports default strategy `context-full`; coding-agent execution selects methods from its ordered list. [U1–U3]

**85% is a common default result, not a constant.** With no overrides, a 200,000-token window resolves to 170,000; a 32,768-token window resolves to 16,384 because the absolute reserve floor dominates. These are arithmetic examples from the resolver, not measurements of this installation. [U1]

### Model-specific policy matters

`resolveModelCompactionSettings()` applies the effective settings scope and optional `compaction.modelThresholds` map. Exact `provider/model` wins; otherwise longest matching trailing-`*` prefix wins. [U4]

| Model map value | Meaning |
| --- | --- |
| `400000` | **Base window**, not exact trigger: global percentage/reserve policy scales against this base; global fixed-token trigger is cleared. Default policy usually yields 340,000 here when real window is large enough. |
| `"f400000"` | Fixed 400,000-token trigger, subject to real-window fallback above. |
| `"80%"` | Replaces both threshold fields with percentage policy. |
| `null` | Clears an inherited entry. |

Model-map application can be disabled; per-agent threshold overrides are documented to take precedence by disabling model-map application for that agent. Model-hub entries can also opt a model into its extended window, so model ID alone is insufficient to infer capacity or trigger. The terminal host and maintenance loop share model-policy resolution. [U4–U5, U8]

## 2. Speculation lead, eligibility and actual timing

Native lead is derived, not a second configurable percentage:

```text
lead = min(32000, max(8192, floor(T × 0.125)))
speculation marker = max(0, T − lead)
threshold marker = T
marker percentage = marker tokens / real W × 100
```

At default `W=200000`, `T=170000`: lead 21,250; speculative boundary 148,750 (74.375%), threshold 85%. For sufficiently large triggers the lead caps at 32,000. These are conditional source-derived examples, not an installed-policy assertion. [U6, U8]

Only the **first available configured method** determines normal speculative eligibility: `remote`, `handoff`, or `soft` can speculate; local-first `snapcompact`/`shake` cannot. Remote availability requires a configured endpoint or supported native route; snapcompact requires image input on the active route. Skipping an unavailable method is different from falling through a local first method. [U3]

Actual start additionally requires enabled async compaction, a usable model/window, no current blocking compaction/handoff, and no `session_before_compact` extension interceptor. Experimental notes-backed context management uses a different path. Normal speculation starts only inside `[T−lead, T)`; one pass at a time, with armed-summary validation/refresh as history grows. Permanent native speculation failure can make later attempts skip remote. [U7]

**Terminal boundary is policy guidance, not a promise that work started there.** Its resolver checks enabled policy, async flag and method eligibility, but does not check all maintenance runtime exclusions above or the maintenance object's failed-native state. Exporting that resolver would reproduce footer positions; exporting runtime state separately is required to accurately say “summarizing” or “ready.” [U7–U8]

### Trigger timing and recovery

- Engine `shouldCompact()` uses **`contextTokens > T`**, not `>=`. It is checked before prompts, at safe continuing tool-loop boundaries (mid-turn enabled), and after successful turns. No continuously enforced wall-clock cutoff occurs when a rendered percentage crosses a line. [U1, U7]
- Decision tokens can differ from displayed context: native compaction floors provider usage by a local stored-conversation estimate, using `max(provider, stored estimate)`. Post-turn triggering initially uses billed context before subtracting pruning savings; stale pre-compaction assistant usage is discarded. A low displayed estimate therefore does not establish that native maintenance is wrong. [U1, U7, U11]
- Async grace can defer blocking maintenance above `T` while summary work runs, until `min(T+lead, W−8192)`; at that cap deferral stops. A valid armed result is applied at a maintenance boundary rather than waiting out grace. Hence crossing the threshold need not immediately show blocking compaction. [U7]
- Post-turn threshold handling can promote to a larger model before compacting. Overflow recovery also tries eligible promotion, otherwise compaction and retry. Byte/media payload rejection is not automatically token overflow; trusted payload failures have distinct guards and can exclude media-based methods. [U7]
- Successful overflow retry only requires rebuilt context to fit its prompt budget. Threshold auto-continuation requires stronger headroom: the native recovery band is **0.8 × T**, with rescue/dead-end handling to avoid repeatedly compacting near the same line. Do not display “compaction ended” as guaranteed continuation or completion. [U1, U7]
- Summarizer transient retries use native retry settings, exponential backoff/provider retry hints and retry caps; deterministic summarizer context overflow vetoes retrying the same input. Outer auto-compaction disables inner oneshot retries to avoid multiplying budgets. This app already sends `set_auto_retry: false`; do not confuse that setting with removing native overflow recovery/compaction continuation. [U7; L2]

## 3. Footer symbols: source-verified meanings

The **box-layout bridging context line** has four modes: `off` (solid accent), `percentage` (used/remainder), `annotated` (boundary markers), and default `embedded` (markers plus absorbed context labels). It is not the same thing as the `context_pct` text segment. [U9–U10]

| Marker | Unicode preset | Nerd preset | ASCII preset | Meaning |
| --- | --- | --- | --- | --- |
| `context.speculation` | `╎` | U+F055D, source calls it vector intersection | `:` | Configured speculative-start position, when eligible. |
| `context.compaction` | `┃` | U+F0068, source calls it auto-fix | `\|` | Resolved automatic-compaction threshold position. |
| `icon.auto` in `context_pct` | `⟲` | U+F0068 | `[A]` | Auto-compaction enabled; pulses accent/muted while speculation runs, stays accent when armed, otherwise follows usage color. |

Glyphs above come from preset maps, not screenshot interpretation. In particular U+F0068 is used both for the threshold marker and auto icon, so **position and rendering context matter**. A screenshot's actual font/preset/customization was not verified. [U10, U12]

Gauge markers render only in annotated/embedded mode, with auto-compaction enabled, a known valid boundary and at least eight gap cells. Placement is rounded to terminal cells; if both markers share a cell, threshold wins. Percent labels take precedence and are positioned to avoid boundaries when possible. Embedded labels reserve space for capacity; bar usage clamps to 100%, while an over-capacity label can still report >100%. One accent cell is drawn even for a fresh/unknown-usage known-window session. Do not infer exact token positions from screenshot pixel distance. [U9]

**Usage colors are not compaction thresholds.** `context-thresholds.ts` selects warning at 50% **or** 150,000 tokens, purple at 70% **or** 270,000, error at 90% **or** 500,000, whichever boundary is reached first. It formats known capacity as `<percent>%/<window>` and unknown capacity as `<tokens>/?`. These presentation limits are independent of native `T`. [U13]

## 4. RPC availability versus in-process/terminal data

Inspected both the RPC command/state types and concrete handlers, not just user-facing documentation. [U2, U14–U16]

| Data/path | v18.13.3 availability | App implication |
| --- | --- | --- |
| `get_state` | Active model, thinking, `isCompacting`, `autoCompactionEnabled`, `contextUsage: { tokens, contextWindow, percent }`, plus unrelated session data. | Enough for sampled occupancy and blocking maintenance state; **not thresholds, settings, speculation state or category split**. |
| `get_session_stats` | Cumulative input/output/reasoning/cache/total, message/tool counts, cost and other session stats; also aggregate `contextUsage`. | Accounting split is not current-context category split; no hidden threshold/settings response here. |
| `compact`; `set_auto_compaction` | Explicit maintenance action; enable/disable toggle. Setter delegates to session override (`persist=false` by default). | Neither command reads effective policy or sets threshold; do not trigger compaction merely to discover telemetry. |
| Auto-compaction events | Start: reason/action. End: action/result, aborted, willRetry, optional error/skipped. Manual lifecycle events also exist. | Useful retained observations; no speculative running/armed event or threshold fields in these definitions. |
| `AgentSession.compactionSpeculation` | In-process getter: `idle / running / armed`. Separate from `isCompacting`. | Terminal can pulse/show ready; existing RPC cannot reproduce it. `isCompacting=false` does not prove no background summary. |
| `getSessionCompactionBoundaries()` | In-process shared terminal policy resolver; returns threshold/speculation percentages or null. | Can support an upstream read-only RPC projection without reimplementing arithmetic in the app. |
| `getContextBreakdown()` / `computeSessionContextBreakdown()` | In-process messages/skills/system-tools/system-context/system-prompt split; richer display adds buffer/free/threshold. | Not returned by existing stats/state RPC. Category split is estimated/provider-anchored, not exact independent provider accounting. |
| Other standard RPC commands | Command union includes available models/commands, messages/entries/tree, etc.; **no `get_settings`, `get_config`, `get_context_breakdown`, or compaction-boundary query**. | Listing models/commands does not give effective scoped compaction settings; raw prompts/tools/messages are not an accurate/safe substitute. |

`get_state` includes raw `systemPrompt` and tool definitions for other clients. Continue the app's bounded field allowlist; do not persist or forward the entire response to expose a few markers. Threshold/config data should be projected to scalar telemetry **inside OMP**, not obtained by copying full settings or credential-bearing files. [U14; L1]

## 5. App gap and smallest viable integration

Current working-tree source, not a claim that these edits are committed or fully live-verified: [L1–L4]

- `server/runtime.ts` confirms native automatic compaction before execution, handles auto lifecycle start/end, and polls stats then state every three seconds. It does not read threshold configuration.
- `server/execution.ts:31–44` retains only model/thinking, estimated context tokens/window/sample/basis, enabled/active status.
- `server/contracts.ts` has no threshold, speculation boundary/state or context-breakdown fields.
- `src/RunUsage.tsx` correctly separates cumulative consumption from estimated context capacity, with a plain meter and native-policy explanation; no threshold markers are present.

**Proposed, not implemented:**

1. Add optional bounded telemetry upstream to `get_state` (or a dedicated read-only command): resolved threshold tokens/percent, optional speculation-start tokens/percent, runtime speculation state, active window/model identity and sampling/config revision. Reuse `getSessionCompactionBoundaries` for **footer parity**, plus `AgentSession.compactionSpeculation` for activity. If promising actual runtime eligibility rather than footer parity, include native runtime suppression reason/eligibility too; the footer resolver alone is insufficient.
2. Optionally expose numeric context categories via native `getContextBreakdown`, including its anchored/estimated basis. Keep prompts, schemas, paths, provider objects and full settings out. This is extra detail, not required for two boundary markers.
3. Only after exact-version/capability review, extend this app's existing telemetry allowlist/contracts and context meter. Label “Summary start” and “Compaction threshold”; distinguish configured boundaries from running/ready/compacting, keep sample timestamps, handle disabled/unavailable/null explicitly, and preserve separate cumulative budget. Missing fields on older releases mean **threshold unavailable**, never silently inferred 85%.
4. Until upstream support exists, retain current honest unknown state. A clearly labeled “default-policy illustration” is possible, but is not an accurate marker for an executing session. Avoid file scraping, prompt-based self-report, parsing footer ANSI, or changing compaction settings solely to make the display calculable.

### Unknowns and verification boundary

- Effective local/global/project/session/model/extension policy, current model window tier and real runtime suppression state were **not inspected**. Source defaults do not establish this installation's values.
- No live RPC/native-compaction/provider run or screenshot reproduction performed. Existing compatibility note verifies metadata discovery separately, not compaction behavior. No tests/builds needed or run for this documentation-only task.
- Proposed RPC projection is absent from the audited release; no claim that newest `main` supplies it. Future release support needs renewed schema/resolver review and targeted protocol/UI verification.

## Primary sources

All upstream source links pin **v18.13.3**; line links refer to that tag.

- **U0:** [Official release](https://github.com/can1357/oh-my-pi/releases/tag/v18.13.3); [latest release API](https://api.github.com/repos/can1357/oh-my-pi/releases/latest) (time-sensitive observation above).
- **U1:** Engine [settings/defaults](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/agent/src/compaction/compaction.ts#L169-L242), [reserve, strict trigger, decision floor and resolution](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/agent/src/compaction/compaction.ts#L331-L431).
- **U2:** Coding-agent [compaction settings](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/context-settings.ts#L105-L412).
- **U3:** [Method order and speculative-method eligibility](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/compaction-methods.ts#L44-L136).
- **U4:** [Model-map matching/application](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/config/compaction-threshold.ts#L123-L189), [entry parsing/null clearing](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/config/compaction-threshold.ts#L3-L77).
- **U5:** [Effective model policy and previews](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/model-compaction-threshold.ts#L25-L87), [extended-window planning](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/model-compaction-threshold.ts#L117-L150).
- **U6:** [Speculation lead formula](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/speculation-lead.ts#L1-L24).
- **U7:** Maintenance [runtime speculation/grace](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/session-maintenance.ts#L2211-L2350), [pre-prompt/mid-turn](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/session-maintenance.ts#L2721-L2935), [overflow](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/session-maintenance.ts#L2988-L3219), [post-turn threshold](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/session-maintenance.ts#L3437-L3522), [summarizer retries](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/session-maintenance.ts#L5552-L5726), [retry/headroom/continuation](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/session-maintenance.ts#L6000-L6118).
- **U8:** [Shared session boundary resolver and breakdown adapter](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/context-usage-runtime.ts#L20-L63); [pure UI boundary arithmetic](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/tui/src/status-line/context-usage.ts#L97-L137).
- **U9:** [Box footer gauge modes, cell placement and marker precedence](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/tui/src/status-line/component.ts#L3258-L3408).
- **U10:** [`context_pct` and auto icon rendering](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/tui/src/status-line/segments.ts#L841-L895).
- **U11:** [Context accounting/breakdown and aggregate usage](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/session-stats.ts#L284-L398); [stats/breakdown types](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/agent-session-types.ts#L556-L597).
- **U12:** Symbols: [Unicode boundaries](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/tui/src/theme/symbols.ts#L423-L429), [Nerd boundaries](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/tui/src/theme/symbols.ts#L753-L759), [ASCII boundaries](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/tui/src/theme/symbols.ts#L1215-L1221), auto icon [Unicode](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/tui/src/theme/symbols.ts#L506), [Nerd](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/tui/src/theme/symbols.ts#L909), [ASCII](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/tui/src/theme/symbols.ts#L1299).
- **U13:** [Independent context presentation thresholds/formatting](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/tui/src/chrome/context-thresholds.ts#L4-L118).
- **U14:** RPC [state handler](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2241-L2285), [compaction commands](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2573-L2584), [stats handler](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2630-L2633).
- **U15:** [Complete RPC command union/state interface](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/modes/rpc/rpc-types.ts#L47-L216); [compaction wire events](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/modes/rpc/wire/events.ts#L78-L108).
- **U16:** [Separate session compaction/speculation getters](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/agent-session.ts#L7277-L7285), [session-scoped setter](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/agent-session.ts#L7330-L7336); [blocking versus speculative maintenance state](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/session-maintenance.ts#L642-L655).

Local sources inspected:

- **L1:** [Telemetry allowlist](../server/execution.ts#L31-L44).
- **L2:** [Runtime](../server/runtime.ts): auto lifecycle handling, setup including `set_auto_retry`/`set_auto_compaction`, and three-second stats/state poll.
- **L3:** [Run progress contract](../server/contracts.ts).
- **L4:** [Usage UI](../src/RunUsage.tsx#L6-L32).
- **L5:** [Installed-version compatibility evidence and limits](omp-18.13.3-compatibility.md), [current workflow](current-agent-workflow.md#ticket-model-overrides-and-context-compaction).
