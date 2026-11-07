# OMP 18.18.0 compatibility assessment

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
