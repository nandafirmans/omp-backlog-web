# OMP 18.18.0 compatibility assessment

## P0 scoped release acceptance — November 7, 2026

**Current decision: v18.18.0 is enabled for the existing native RPC and restricted-startup boundary.** This is a deliberate, limited acceptance of the known accounting risk for functional live-recovery validation, not evidence that complete lifetime usage reporting was repaired. The earlier blocked decision and failed 146-token regression below are preserved as historical audit evidence. All pre-existing exact-version checks, reviewer restrictions, deadlines, correction/recovery allowances and guarded local publication controls remain in place.

Native audits previously exercised 18.18.0 protocol negotiation, session/goal lifecycle, pstack skill invocation, restricted tool registration and ancestor plugin isolation. They did **not** prove paid-provider recovery or exhaustive task/worker behavior. `get_session_stats` can omit discarded/background usage, and the failing native cumulative-usage regression remains an open known limitation for *all* audited releases, including 18.16.0. Reported token caps are best-effort guardrails, **not guaranteed lifetime usage or monetary spending caps**. Do not increase or reset budgets to compensate.

The next separately authorized P0 gate is `OMP_BACKLOG_LIVE_TESTS=1 bun test server/recovery-live.test.ts` on a machine with installed authenticated OMP v18.18.0. This opt-in test may consume provider usage and might report PARTIAL/INCONCLUSIVE if no actual host-managed repair occurs. No live-provider test is claimed in this compatibility-only change. Keep the 146-token regression red until an upstream cumulative usage source can genuinely satisfy it.

---

### Earlier audit record (historical blocked decision)

## Supported-version decision

Assessment date is November 7, 2026. **OMP 18.18.0 remains blocked.** Startup isolation passed, but the audit exposed an existing token-accounting limitation: native session statistics omitted known discarded-turn usage. This is not a regression caused by the release. The outstanding accounting guarantee prevents extending the audited allowlist.

The application started on clean `main` at `a3d25edb0aac6b51746cf96526f01619400b3480`. Installed `/home/nandafirmans/.local/bin/omp --version` returned `omp/18.18.0`. No application commit, installation, global configuration change, authentication change, push, PR, or deployment was authorized or performed.

The existing exact allowlist remains `18.12.6`, `18.13.1`, `18.13.3`, and `18.16.0`. This assessment does not retrospectively prove cumulative billing completeness for those releases. The relevant statistics implementation is unchanged between 18.16.0 and 18.18.0.

## Exact upstream comparison

Sources are the official [18.17.0 release](https://github.com/can1357/oh-my-pi/releases/tag/v18.17.0), [18.18.0 release](https://github.com/can1357/oh-my-pi/releases/tag/v18.18.0), and [18.16.0...18.18.0 comparison](https://github.com/can1357/oh-my-pi/compare/v18.16.0...v18.18.0). The web comparison did not render its diff. An official Git checkout supplied the exact tagged tree comparison instead. No conclusion uses moving `main`.

| Tag | Commit |
| --- | --- |
| v18.16.0 | `650f3a108229ee11bf68ba3377f4e8c3391cd424` |
| v18.17.0 | `75e7801e247d4e3263439d4cc08ccad60dc64bdd` |
| v18.18.0 | `b5a6b2f7e5b6606b6562e678ead83f21738f34a0` |

Source paths below are relative to upstream `packages/coding-agent/src/`.

| Source | 18.16.0 blob | 18.18.0 blob |
| --- | --- | --- |
| `modes/rpc/rpc-mode.ts` | `5a2c6cc52935823b10356dba07aa7552894fe830` | `3ea84ee0183c42d77af5dcdcfcf2b7003a8ac5d4` |
| `sdk.ts` | `ef6a078183f1b967d1d98e2134999a9316252940` | `64e5d68a44ee3a2f5833c8feaa4bfc0fee9c5ef6` |
| `discovery/helpers.ts` | `e514d84e6bfde4704656a6a63dcdf5fefeb17c75` | Same blob |
| `extensibility/plugins/loader.ts` | `6f20fc18fe452aa6cff4d673437ead64ce7cd485` | Same blob |
| `extensibility/custom-tools/loader.ts` | `51d2d5db00db88bc074c6c45d166857249987077` | Same blob |
| `extensibility/skills.ts` | `edfc184d08a5360e0ef3fe64e0fbb8e62dc2d27d` | `69fa5074b27eccca8dd66caaa34c110ea6eda8d0` |
| `slash-commands/available-commands.ts` | `10ed511617d2e3785b6fd74ae014ddd1730f5b97` | Same blob |
| `session/session-stats.ts` | `9d89d8ec024e38c6a4536c7793ea18f53e69be78` | Same blob |
| `session/session-manager.ts` | `c6ab86184301c657d9fa8efa913771e4c4100281` | `97c726b71ce19f659725d3be2f703c095e5e1e9d` |

### Breaking API changes

No required Backlog RPC command-envelope change was found in the scoped source comparison. `get_session_stats` still forwards `session.getSessionStats()`. Protocol commands, events, frames, chunk transport, prompt-result, and settlement implementations are unchanged at the endpoint tags. RPC mode changes internal subagent handle types, adds a headless transcript-refresh method, and consolidates native todo persistence.

Upstream declares a native-library break replacing `parseShell()` with `RunTrace.present()` and `ShellVisualization`. Backlog invokes the CLI through JSONL RPC rather than importing that native API. It needs no corresponding adapter. Optional bash trace data now permits byte arrays as well as strings; no all-string trace parser was added here.

### Additive features

RPC bash results add optional truncation fields and trace metadata. `skills.manualSkills` adds manual-only catalog behavior. These additions do not justify permissive response parsing, invented defaults, or new reviewer capabilities.

### Behavioral changes

- [Skill loading](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/extensibility/skills.ts#L609-L620) marks matching admitted skills hidden. It does not remove them. Native command enumeration and `/skill:` invocation still resolve hidden skills. Catalog hiding is not authorization or executable-discovery isolation.
- Many concurrent [subagent runs can move to workers](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/thread/subagent-worker.ts). The threshold is nine in-flight runs, with default worker cap four. One discovered `task` tool or one child does not exercise worker placement.
- SDK startup now defers skill-description compression until the session cost gate exists. Completed compression attempts count toward the tree cost gate, not necessarily RPC session totals.
- Discarded assistant usage is now preserved in the journal. This does not make RPC active-window statistics cumulative.
- Cache warming now distinguishes paid attempts from valid cache-refresh observations. Failed or superseded attempts may retain usage without establishing a warm cache.
- Default text verbosity and initial thinking selection changed. Backlog continues to check an explicit configured model and thinking level rather than trusting a default.

### Security-sensitive changes

[SDK changes](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/sdk.ts) introduce per-session MCP views and worker-aware service boundaries. [Task-file approval](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/task/file-approval.ts) binds dispatch to the approved regular-file identity and rejects replacement. Worker custom-provider calls transfer tool declarations rather than executable tool instances. MCP invocation tracking uses unique identities even when providers reuse call IDs.

Worker auth delegates to the main process's canonical storage. Abort signals and link closure cross the thread boundary. Task usage aggregates assistant usage into parent task-result details. A lost worker can return zero counters as a failed-result sentinel; those zeros do not prove no provider consumption. These are source findings, not executed worker/auth/provider proofs.

### Changes irrelevant to this integration

TUI motion, clipboard, speech, link browsers, native desktop controls, session pin presentation, and shell visualization fixes do not require a Backlog transport rewrite. Their behavior was not independently validated here.

## Restricted startup and reviewer authority

`installProfile()` and `privateArgs()` were not weakened. The private HOME/config, disabled discovery providers, no-tools/extensions/skills flags, and private working-directory `.git` and `.omp` anchors remain. Normal author authentication remains inside OMP. The reviewer receives only `candidate_diff`, `candidate_source`, and `backlog_review`; it has no host-authorized shell, writes, credentials, arbitrary filesystem reads, URI requests, or external actions.

The empty private `.omp` is still necessary. A sentinel custom-tool module under an ancestor `.omp/plugins/node_modules` executed when only that anchor was removed, even with restricted flags. The protected configuration prevented its import. An empty active-tool list alone is not startup-import evidence.

Executed native evidence on actual 18.18.0:

- Existing native discovery and isolation suite passed all five tests. It covered installed pstack, disabled skills/extensions, isolated missing pstack, project verification skill discovery, ancestor import sensitivity, empty initial tools/no goal, and exact reviewer host-tool registration.
- An execution-capable independent reviewer ran seven additional disposable probes. Ambient and private user/project extension and custom-tool modules executed in permissive controls, then remained unexecuted under the protected profile. Synthetic author skill commands disappeared under restriction. An explicit fake config selector imported a package in its permissive control but could not reintroduce it through `installProfile()`.
- Protected runs reported no initial tools, skills, or goal; exactly the three host review tools after registration; unchanged generated config; no selected work frames; and observed owned-child exit.

The original recorded paths were `/tmp/omp-independent-isolation-probe.ts`, `/tmp/omp-independent-config-selector.ts`, and `/tmp/omp-independent-isolation-FUn1Vy/{results,selector-results}.json`. The original isolation JSON was unavailable after session continuation. The executed results were inspected earlier and remain transcript observations, not currently retained original proof. An initial read-only security reviewer lacked execution capability and reported BLOCKED, not a native pass. The later execution-capable reviewer supplied the runtime evidence.

These controls cover exercised startup discovery paths. They are not an OS sandbox, exhaustive discovery audit, proof of later dynamic behavior, or resistance to concurrent external filesystem mutation. Synthetic skill sentinels prove discovery isolation, not installed pstack identity or adherence.

## Native RPC and accounting findings

A direct real-process metadata probe negotiated protocol v2 and exercised `get_state`, `get_session_stats`, `get_available_commands`, `get_messages`, model enumeration, supported thinking levels, session identity, native auto-compaction enable/read-back, and clean shutdown. Restricted startup selected exact `openai-codex/gpt-6.1-sol`, listed 18 models, and reported `off`, `low`, `medium`, `high`, `xhigh`, and `max`. It submitted no prompt or goal. A configured compaction toggle is not proof of a compaction event.

### Native Standard and pstack controls

`server/rpc-native.test.ts` adds opt-in real-executable checks with private, credential-free configuration and an owned loopback OpenAI-compatible responder. It never links the real auth database or inherits API keys, broker settings, proxies, or provider endpoints. Synthetic responses prove native parsing and dispatch, not model reasoning, provider billing, or playbook adherence.

The Standard control passed without pstack skill discovery and sent no model requests. The pstack/RPC control passed using the actual installed `pstack-pi` skill directories, explicit native skill-name filters, and `skills.manualSkills: ['*']`. Hidden skills remained discoverable, native `task` remained available, and the actual `/skill:poteto-mode` invocation produced the prompt-bound native history record with its real installed path.

The same native test passed a real host-tool call/result round trip, an exact returned text payload above 1 MiB through protocol-v2 chunks, model enumeration/exact selection, supported thinking selection, auto-compaction configuration, goal create/pause/resume, durable session-file materialization, exact session/goal/router-history restoration, final usage sampling, and owned-process shutdown. Two scripted responses yielded exact native totals of input 122, output 28, cache read 30, cache write 8, and total 188. Those supplied counts test aggregation, not measured model output.

Goal continuation was explicitly disabled in this control. It establishes the native goal command and persistence contract, not automatic continuation or a full dashboard implementation/recovery lifecycle. Actual task delegation and worker placement were not exercised. Existing deterministic retry tests establish bounded read-only retries and forbidden mutation replay; no transient failure was induced inside the installed native process.

Initial new-fixture failures were corrected before the passing router check. `--skills` takes name filters, so explicit installed roots belong in `skills.customDirectories`. Goal command results contain `{goal, state}`, with `enabled` under `state`. One strict TypeScript inference error required an explicit result type. No application compatibility fallback or response relaxation was needed.

### Blocking cumulative usage discrepancy

[Discard persistence](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/session/session-manager.ts#L4076-L4114) writes removed assistant usage as an off-branch `model_usage` with purpose `discarded-turn`. The later active branch-summary entry is its sibling. [SessionStatsTracker](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/session/session-stats.ts#L71-L94) only visits active messages and active-branch usage within the current compaction/reset window.

The native no-provider probe `/tmp/omp-1818-accounting-probe.ts` resumed two explicitly synthetic version-3 journals. Both contained identical usage. Moving only the usage entry's branch membership supplied the sensitivity control.

| Native loaded journal | Input | Output | Cache read | Cache write | Known journal total | RPC total | Final RPC sample |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Usage on active branch | 101 | 17 | 23 | 5 | 146 | 146 | 146 |
| Off-branch discarded-turn usage | 101 | 17 | 23 | 5 | 146 | 0 | 0 |

Native session identity matched the journal header, tools remained empty, no model turn ran, the usage remained in the persisted file, and owned children stopped. Original proof was written to `/tmp/omp-1818-accounting-VixiTS/proof.json` and inspected during execution, but was unavailable after session continuation and to the final reviewer. The table records the root's observed native output, not a currently inspectable original receipt. It establishes native interpretation of an exact source-derived journal shape, not generation of an actual paid discarded turn. The permanent opt-in regression reproduces the accounting requirement.

Backlog samples RPC totals and preserves author maxima, then adds each independent reviewer's cumulative sample once. A maximum cannot recover usage that no sample ever included. This affects the basis of the original whole-attempt cap and repair/reviewer reserves; increasing caps or resetting accounting is not a fix. The same source also permits active-window drops after compaction/reset. Accounting is not provider billing.

There is no audited direct cumulative aggregate RPC alternative in this comparison. `get_entries` exposes the raw journal and `leafId`, but substituting it requires a separately designed aggregator covering rewrite/cursor invalidation, compaction/reset, assistant and model usage, task aggregates without double counting, reviewer sessions, failed/aborted turns, and shutdown. This assessment does not install that larger adapter or silently fall back to incomplete totals.

## Phase 7.2 preflight and next gate

The real `checkVersion()` still rejects installed 18.18.0 before the live test can call application model discovery or start an author. Direct native model discovery confirms the requested model and `low` thinking are available, but **Phase 7.2 remains blocked** by the unsupported-version decision above.

`server/recovery-live.test.ts` and its CSV scenario remain unchanged. Standard engineering mode, explicitly commissioned autonomous completion, the original 500,000-accounted-token cap, ten-minute deadline, one correction, one recovery allowance, and no automatic repeat remain intact. No provider-backed recovery or implementation test ran.

After the accounting contract is repaired, independently reviewed, and all compatibility gates pass, the operator's opt-in command is:

```sh
OMP_BACKLOG_LIVE_TESTS=1 bun test server/recovery-live.test.ts
```

That command is not currently unblocked and is not permission to spend provider tokens. Do not bypass or spoof the version guard.

## Remaining evidence limits

Real-provider implementation, discarded-turn generation, native compaction, high-concurrency worker placement, worker credential restriction inheritance, MCP sibling isolation under execution, and worker cancellation/accounting were not exercised. Source review and deterministic fixtures do not establish those native/provider outcomes. Actual router expansion is distinct from model adherence to its playbook. Standard selection never enables pstack automatically.

## Acceptance gate status

| Required gate | Assessment |
| --- | --- |
| Exact installed version | Passed. Actual executable reports `omp/18.18.0`. |
| Independent restricted startup | Passed for the exercised native sentinel paths. |
| Ancestor executable plugin blocked | Passed with an import-sensitive unanchored control. |
| Native RPC and command shapes | Scoped control passed. Cumulative usage invariant failed. |
| Standard OMP | Native no-pstack startup/control passed; no real-provider implementation run. |
| Pstack discovery and router invocation | Native discovery and prompt-bound invocation passed, including manual-only skills. Worker execution remains unverified. |
| Reviewer authority | Unchanged; native protected tool registration exposes exactly three tools. |
| Session usage and original budgets | Failed compatibility gate. Known off-branch consumption is absent from RPC totals; caps were not increased or reset. |
| Shutdown and restart safety | Native exact-session restart/owned shutdown passed; broader ownership/recovery guards retain deterministic fixture coverage. |
| Relevant regressions | The opt-in cumulative usage regression is red. Support cannot be enabled. |

The smallest safe outcome is a documented block and rerunnable failing native invariant, not a version-list edit. A future compatibility change must repair or replace the accounting contract, exercise worker-sensitive guarantees, rerun the native positive/negative controls, and pass the cumulative regression before extending the guard.

## Verification results

Commands below ran against the installed executable or the current repository. The native accounting failure is an acceptance failure, not a passing known-bug assertion.

| Check | Result |
| --- | --- |
| Focused recovery/runtime/read-retry command across six files | 75 passed, five native skips, zero failures |
| `OMP_BACKLOG_NATIVE_TESTS=1 bun test server/engineering-native.test.ts server/restricted-native.test.ts server/rpc-native.test.ts` | Seven passed, one failed. Sole failure is off-branch discarded usage returning zero instead of 146. |
| `bun test` | 287 passed, 15 opt-in skips, zero failures across 36 files |
| `bun run typecheck` | Passed after the new fixture's explicit type correction |
| `bun run lint` | Passed for the full project |
| `bunx vite build` | Passed with the existing warning about chunks above 500 kB |
| Actual application preflight plus direct native model metadata | Application rejected 18.18.0; direct native metadata confirmed the exact requested model and `low` |

The focused command used `server/engineering-native.test.ts`, `server/restricted-native.test.ts`, `server/recovery.test.ts`, `server/autonomous-recovery.test.ts`, `server/rpc-retry.test.ts`, and `server/runtime-integration.test.ts`. Native tests were enabled separately in the integrated command above. The ordinary suite deliberately skips native/provider tests; its green result does not erase the native accounting failure.

The root also reran the independent startup probe after inspecting its script. All five primary cases passed again; separate independent selector-injection evidence covers two additional cases. Historical scratch paths were `/tmp/omp-independent-isolation-bIVsgz` for the second primary proof and `/tmp/omp-upstream-1818-DcEFTM/source` for the tagged source checkout. Scratch paths are not promised retained evidence after continuation. Exact source commits, blob identities, observed command results, and the permanent native regression remain recorded here.

Modified files are `server/drafting.ts`, `server/drafting.test.ts`, `server/fixtures/drafting-child.ts`, `server/rpc-native.test.ts`, `README.md`, `docs/current-agent-workflow.md`, and this document. Production code changes only replace two stale supported-version messages with the existing derived label. The test fixture accepts arbitrary syntactic release strings so 18.18.0 rejection can be checked before any RPC child starts; it does not grant support. The new native regression preserves the missing cumulative-usage requirement rather than accepting zero.

Starting and ending application HEAD are both `a3d25edb0aac6b51746cf96526f01619400b3480`. No provider-backed implementation or recovery test ran.

## Final review and proof retention

Final independent security/evidence review found no patch-introduced security finding and endorsed retaining the compatibility block. It did not execute checks or independently certify the supplied runtime results. Its required correction was to qualify unavailable original `/tmp` accounting proof; the retention statements above now do so. The first ordinary reviewer failed with a provider usage limit and produced no verdict. The replacement used a distinct security-reviewer session, not a claim of model-family diversity.

The session-local decision trail also records malformed prefixes in its first three rows and date-only placeholder timestamps. Those timestamps are not measured event times. Some job/output pointers are transient. The trail is an explanatory record, not an execution receipt or clean machine-readable export.

## Phase 7.3 — cumulative accounting feasibility

**Decision: missing native capability; no partial ledger or version enablement.** The raw entry RPC can recover the isolated discarded-turn payload, but it cannot establish complete lifetime consumption for normal author execution. The application therefore still has no authoritative lifetime accounting source. Existing counters and historical “cumulative” labels must not be interpreted as a proven ledger or provider billing.

This follow-up starts at application HEAD `d2a4b5fe3f8e270c21161ec3d352ba6a4b75d50b`. Installed native OMP reports `omp/18.18.0`. The original 146-token assertion remains unchanged; returning zero is still a failure.

### Host accounting audit

| Path | Source and persistence | Guarantee / gap |
| --- | --- | --- |
| Author polling, `runtime.ts` launch interval | `get_session_stats`; autonomous `authorTokens` takes a maximum; human-reviewed progress takes the latest sample | Active-window samples, not lifetime events. A maximum cannot recover an unsampled discarded turn. |
| Author settlement, `authorStopped()` | Same sample before pausing/shutting down | Missing usage is still missing; sampling before shutdown does not prove no later consumption. |
| Pause/cancel/failure, `stop()` | Best-effort `finalSessionStats()`, followed by goal pause, abort and mandatory owned shutdown | Final-sample errors are swallowed. No accounting-completeness state is persisted. |
| Independent review, `reviewCandidate()` | Local sampled maximum; callback adds it to the previous reviewer total | Separate session consumption is added once per invocation, but no durable per-session usage-event checkpoint exists. Final-sample failure is swallowed. |
| Recovery/correction | Same author session, immutable configuration and deadline; `tokensBefore`/`tokensAfter` snapshots | Preserves observed counters, not unobserved consumption. |
| Limits and reserves | `assertAutonomyAuthority()`, launch/polling checks, `recoveryAllowance()` and `repairReserve()` consume these counters | Whole-attempt cap, 6,144-token repair admission and 4,096-token protected reserve inherit the accounting gap. Verification/review/publication authority checks do not repair it. |
| Backend restart | `Store.save('runs', run)` persists whole run JSON in SQLite; runtime reconciles process/workspace ownership | No usage-entry IDs, reconciliation cursor, last complete reconciliation or explicit uncertainty checkpoint. |
| Compaction | `sampleRunState()` records native context estimate and compaction telemetry separately | Context size is not consumption. No ledger reconciliation occurs at compaction or branch changes. |
| UI / proof | `RunUsage`, `LifecycleProgress`, `RecoveryHistory`, and `recovery-live.test.ts` consume stored samples/snapshots | Displays and proof arithmetic do not independently establish cumulative completeness. |

Standard and pstack use these same paths. No native goal budget, deadline, engineering-mode snapshot, correction/recovery allowance, reviewer tool, host acceptance gate or publication gate was changed.

### Public journal contract and event identities

At both exact endpoint tags, [`selectRpcEntries()`](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/modes/rpc/rpc-compat.ts) returns all canonical entries in append order, or entries strictly after the ID supplied in `since`. An unknown ID throws `Unknown entries cursor`; native dispatch returns a failed response with code `unknown_since`. `leafId` identifies the selected conversation branch, not an accounting high-water mark. The [18.16.0 selector](https://github.com/can1357/oh-my-pi/blob/650f3a108229ee11bf68ba3377f4e8c3391cd424/packages/coding-agent/src/modes/rpc/rpc-compat.ts) has the same semantics.

The [actual version-3 schema](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/session/session-entries.ts) gives entries `id`, `parentId`, `timestamp`, and optional `activeLeafId`. A `model_usage` has `purpose`, `api`, `provider`, `model`, `usage` and `stopReason`; an assistant carries usage inside `message`. These are journal-record identities, not a documented immutable provider-attempt identity. Replaying an entry must not add consumption again. `activeLeafId` must not filter lifetime consumption.

The native regression now also exercises cursor replay, strict-after slicing, an empty tail, off-branch retention and rejection without mutation of an unknown cursor. These checks validate the entry interface; they do not constitute a durable host ledger.

[`SessionEntryIndex.usageSnapshot()`](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/session/session-manager.ts#L425-L455) and [`SessionManager.getUsageStatistics()`](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/session/session-manager.ts#L3222-L3225) are different from RPC statistics: the index totals all currently loaded entries, including assistant usage, `model_usage` and parent task-result usage. That is broader than the active branch, but still not a provider-attempt lifetime ledger. RPC `get_session_stats` does not call it. Merely exposing that index through another RPC would not account for unjournaled side calls.

The [discard implementation](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/session/session-manager.ts#L4076-L4114) removes the assistant entry, rebuilds the index, then creates a new-ID `model_usage` carrying the removed usage. A host that previously counted the assistant cannot count this replacement as new consumption. There is no `replacesUsageEventId` in that usage entry; matching identical counts/timestamps is not proof. An unknown cursor requires reconciliation, not restarting from zero. A [branched session](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/session/session-manager.ts#L4144-L4225) can copy only the selected path to a new session/file; original-run accounting must retain the original lineage and cannot inherit the shorter conversation as its total.

`get_entries` has no page-size/byte-limit or journal-generation parameter. Incremental reads avoid old records but can still exceed Backlog's 64 MiB logical-frame bound in one response. A future adapter must fail uncertain on overflow, malformed/truncated records or invalidated history, never silently trim usage. Full reconciliation from the original journal can validate available records, but cannot recreate usage never journaled.

### Decisive missing evidence: background provider calls

Native [skill-description compression](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/extensibility/skill-descriptions.ts#L100-L149) calls `instrumentedCompleteSimple()` on a separately selected fast model. Its `onAttempt` callback records only `message.usage.cost.total` in the tree cost gate. The [description store and scheduling code](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/extensibility/skill-descriptions.ts#L298-L533) persist compressed text/unusable-answer cache rows, not token counts or usage-event identities. The [`CostGate`](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/session/cost-gate.ts#L52-L127) retains a process-local monetary counter; it is not a durable token ledger exposed by RPC.

Therefore a clean, apparently settled parent/child journal can omit independently consumed tokens. Deduplicating all visible `get_entries` records cannot prove completeness. Missing an aggregate RPC alone would not be a blocker; missing durable event evidence is. Disabling native skills/background behavior to make selected fixtures pass would change the requested execution behavior, not repair accounting.

A disposable real-18.18.0 loopback probe exercised this path without paid inference: visible synthetic skill, private empty cache/HOME/config, native discovery enabled only inside that private namespace, explicit `modelRoles.smol`, and a non-secret loopback-only authentication sentinel. One startup compression request received a valid streamed response with input 101, output 17 and total 118. Subsequent `get_session_stats` returned zero and `get_entries` contained neither assistant usage nor `model_usage`; owned shutdown was observed. The successful probe ran as `OMP_BACKLOG_NATIVE_TESTS=1 bun test server/rpc-native.test.ts -t native_skill_compression` while its temporary body was present, then was removed rather than pinning the missing behavior as a passing regression. This is a source-backed observed interface gap, not provider billing evidence or a retained standalone receipt.

Earlier probe iterations did not establish the gap: `auth:none` cannot satisfy the compressor's credential lookup; disabling native discovery kept the skill out of the visible catalog; a non-streaming fixture response was invalid for the selected streaming API. The final probe corrected those fixture prerequisites and passed its observation assertions. It did not launch a foreground prompt, task, worker or real provider.

Cache warming must not be confused with this gap: [`#recordCacheWarmUsage()`](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/session/agent-session.ts#L6243-L6261) does append `model_usage`. Such usage can still be absent from active-window statistics. Compaction side-call completeness remains unproven; no claim of complete compaction accounting follows from a compaction metadata entry.

### Child and reviewer attribution

Completed child usage is aggregated into parent `task` result `details.usage`, which [`SessionStatsTracker`](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/session/session-stats.ts) adds alongside parent assistant usage. Child journals and that parent aggregate are alternate representations: adding both double counts. `SingleResult.tokens`/progress counters are not interchangeable with full input/output/cache usage.

[`lostRunResult()`](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/thread/executor-routing.ts#L69-L105) returns a failed worker result with `tokens: 0`, `requests: 0`, and no `usage`. This is detectable failure, not evidence of zero consumption; affected work must remain uncertain. It does not by itself make an aggregator impossible, because a host could block that outcome.

[`RpcSubagentRegistry`](https://github.com/can1357/oh-my-pi/blob/b5a6b2f7e5b6606b6562e678ead83f21738f34a0/packages/coding-agent/src/modes/rpc/rpc-subagents.ts) removes terminal snapshots and retains at most 256 transcript references in memory. Child transcript reads use a byte cursor, report reset only when the offset exceeds current size, and return empty data for a missing file. This is observability, not a durable exhaustive child-usage inventory after restart. Completed, discarded, failed, interrupted and still-running children cannot be certified complete from a successful parent sample.

Independent reviewers must use their own immutable session IDs in any future ledger, then aggregate once by event/session identity. Existing reviewer maxima do not satisfy that contract. No new model tool is needed: accounting remains privileged host work; `candidate_diff`, `candidate_source`, and `backlog_review` remain the only reviewer tools.

### Minimal upstream API enhancement

Proposed new public `get_usage_ledger` RPC, not an API currently available in either audited tag:

- Immutable root/session identity and durable child lineage; unique provider-attempt/event identity surviving transcript discard, compaction and branch rewrites.
- Append-only usage receipts for foreground, child/worker and side calls, including skill compression, compaction and cache warming. Parent task aggregates explicitly reference covered events rather than masquerading as new consumption.
- Input/output/cache-read/cache-write and reported total tokens; reasoning metadata with documented overlap, not another blindly added field. Monetary cost remains separate.
- Durable attempt-start/finish or uncertainty markers. Lost workers, interrupted requests, provider-reported incomplete usage and failed persistence cannot become zero; completeness must explicitly remain unknown.
- Bounded incremental pages with stable cursor, journal generation, explicit invalid-cursor/error responses, and a reconciliation/completeness watermark covering all owned pending calls. Settlement alone is insufficient.

With that contract, Backlog can checkpoint `(runId, role, sessionId)`, event IDs, cursor/generation, token subtotals, last successful reconciliation and completeness in the existing SQLite store, transactionally before author/recovery/review/publication admission. Replays become idempotent; separate reviewer sessions aggregate once; missing evidence requires assistance. Original budgets and deadlines remain unchanged. This is a proposed architecture, **not implemented functionality**.

Polling and asynchronous in-flight requests can overshoot a token threshold even with a correct ledger. Neither tokens nor OMP cost estimates establish an exact provider monetary spending cap.

### Phase 7.3 executed checks and remaining acceptance

| Check | Observed result |
| --- | --- |
| Full ordinary `bun test` | 287 passed, 15 opt-in skips, zero failures across 36 files; 447.80 seconds. An earlier 300-second attempt timed out, not a completed suite result. |
| Focused `recovery`, `autonomous-recovery`, `rpc-retry`, `execution` | 44 passed, zero failures. |
| Native `engineering-native`, `restricted-native`, `rpc-native` | Seven passed, one failed. The unchanged off-branch 146-token invariant is the sole failure; active-branch 146 and the new cursor checks execute before it. |
| Focused native imported-journal check | Fails at the unchanged expected-146 assertion; observed off-branch total remains zero. Cursor replay/strict-after/empty-tail/unknown-cursor checks passed before that assertion in both branches. |
| Disposable native compression probe | One passed observation probe: supplied 118-token response, no journal usage receipt, zero RPC total. Not an acceptance pass. Probe removed afterward. |
| Strict TypeScript and full ESLint | Passed. |
| `bunx vite build` | Passed; warning about chunks above 500 kB remains. |

The full ordinary suite covers the existing autonomous runtime, engineering modes, recovery and publication fixtures; those passing protocol fixtures do not prove native accounting completeness. A combined six-file focused runtime attempt also exceeded its initial 300-second deadline. No paid Phase 7.2 live-recovery test ran. Native completed/failed/discarded/interrupted child and worker provider workloads were not launched; their attribution findings above are source evidence, not native execution claims.

Phase 7.3's durable ledger, completeness gates and requested new ledger regression matrix are **not delivered**: the prerequisite native event evidence is missing. The original native accounting regression intentionally remains red, and previously supported versions remain listed without inventing stronger accounting guarantees for them. OMP 18.18.0 is unsupported; Phase 7.2 real-provider validation remains blocked.

Changed files: `server/rpc-native.test.ts` (native cursor boundary assertions), `server/restricted-native.test.ts` (exact native model/thinking selection), `server/engineering-native.test.ts` (prevent discovery-only skill compression), `README.md`, `docs/current-agent-workflow.md`, and this document. Production runtime, contracts, store, recovery/live scenario and version/error-message allowlist remain unchanged. Starting and ending HEAD: `d2a4b5fe3f8e270c21161ec3d352ba6a4b75d50b`. No application commit, push, merge, deployment, tool installation or global OMP configuration change occurred.

After the final restricted-test assertions were added, `OMP_BACKLOG_NATIVE_TESTS=1 bun test server/restricted-native.test.ts` passed its one test, followed by passing strict TypeScript and full ESLint. Protected startup selected exact `openai-codex/gpt-6.1-sol`, exposed `low` as supported, retained exact model plus `low` after host selection, and registered only the three review tools. This submitted no inference.

The metadata-only author discovery fixture now sets `skills.manualSkills: ['*']` in its disposable overlay. Command discovery stays enabled; hiding catalog descriptions prevents startup description compression. Its final native run passed all four discovery controls, followed by passing strict TypeScript and full ESLint. Earlier discovery invocations inherited the installed author configuration and did not monitor background provider requests, so “no prompt submitted” must not be read as proof of zero incidental provider activity. No paid foreground/live-recovery workload was launched. Production author behavior and global configuration remain unchanged.

The separate `autonomy-runtime` diagnostic attempt exceeded 240 seconds without a completed verdict. Its cases are covered by the completed full-suite pass above; this timeout is not reported as a focused pass. The previously observed owned fixture PID no longer existed after that attempt; no unrelated process was stopped.
