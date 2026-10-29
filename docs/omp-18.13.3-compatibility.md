# OMP 18.13.3 compatibility check

Date: 2026-10-29. Scope: the restricted model-discovery/drafting startup profile and execution telemetry/compaction interfaces—not an exhaustive upstream security audit or provider test.

## Reproduction and fix

Installed `omp --version` returned `omp/18.13.3`. Calling this repository's `discoverExecutionModels('omp', '')` failed before RPC launch because `checkVersion()` accepted only 18.12.6 and 18.13.1. The same metadata-only reproduction passed after adding **only 18.13.3**, returning 18 models. No inference was submitted. Unknown releases still fail closed; the diagnostic now identifies a recognized detected version without echoing arbitrary executable output. Owning implementation: [server/drafting.ts](../server/drafting.ts), regression cases: [server/drafting.test.ts](../server/drafting.test.ts).

## Source review

Compared official tag-pinned sources directly between v18.13.1 and v18.13.3. The [upstream comparison](https://github.com/can1357/oh-my-pi/compare/v18.13.1...v18.13.3) is broad; conclusions below use the individual source files rather than treating a truncated comparison listing as complete.

- [CLI arguments](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/cli/args.ts), [config settings](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/config/settings.ts), [discovery index](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/discovery/index.ts), [plugin loader](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/extensibility/plugins/loader.ts), and [runtime initialization](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/modes/runtime-init.ts) were unchanged in the direct comparison. Agent/Claude/OMP plugin discovery and plugin-root loading files inspected were also unchanged.
- [main.ts](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/main.ts) retains `--no-tools`, `--no-skills`, `--no-extensions` handling, noninteractive protocol classification and explicit session-option construction. Saved-model fallback is now explicitly bound to interactive mode. Newly scheduled background session compression is inside deferred interactive startup work, not the restricted RPC metadata path.
- [sdk.ts](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/sdk.ts) retains explicit-only extension handling. New saved-model restore failure handling and source-registration cleanup do not authorize ambient discovery for this profile.
- [discovery/helpers.ts](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/discovery/helpers.ts) adds plugin registry revalidation and superseded-root tracking. Registry inputs remain resolved from supplied home/project paths. This app retains private HOME/config/working-directory namespaces, its local project anchor, empty extensions and disabled discovery providers; no profile permission was broadened.
- New [RPC dictation bridge](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/modes/rpc/rpc-dictation.ts) construction stores callbacks; the controller/microphone starts only from an explicit capture `start()`. This app sends no dictation commands.

Restricted discovery still checks empty tools/no goal and rejects unexpected tool, prompt, host or UI activity. These checks and startup controls reduce capabilities; they are **not OS isolation**. Metadata selection can make existing documented discovery/auth/connection-probe requests. Provider credentials remain inside OMP; no credential bytes were inspected, copied or logged during this check.

## Context and automatic compaction

- [RPC get_state/set_auto_compaction](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/modes/rpc/rpc-mode.ts) exposes model/thinking, `contextUsage`, `isCompacting`, and `autoCompactionEnabled`; the toggle delegates to `session.setAutoCompactionEnabled()`.
- [AgentSession](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/agent-session.ts) defaults that setter to `persist = false`: the override is session-scoped, not a machine-global config write. The same default was checked in 18.12.6 and 18.13.1.
- [SessionStats](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/session-stats.ts) computes context usage as used tokens, model context window and percentage. It is distinct from reported aggregate session tokens; local estimates/provider accounting may differ.
- [Native maintenance](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/session/session-maintenance.ts) owns compaction methods/thresholds. This app enables native automatic compaction and surfaces lifecycle/status; it does not add a host compaction/retry loop or reset cumulative run budgets.

The later explicitly optional uncapped-token mode uses the existing [RPC goal command](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/modes/rpc/rpc-goal.ts): `token_budget` is optional and, if supplied, must be a positive integer. [GoalRuntime](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/goals/runtime.ts) stores an omitted budget as undefined and renders remaining tokens as unbounded. Accordingly the dashboard stores explicit `null` privately but **omits** the native field, rather than sending null/zero/Infinity. Host accounting, finite time deadline and all non-token gates remain. Source inspection establishes this protocol contract, not a real uncapped provider run.

## Verification boundaries

Passed: version reproduction, then installed **restricted metadata discovery** returning 18 models; changed-code ESLint. Actual React UI with synthetic API independently covers ticket-specific model/thinking/budget controls and context/cumulative usage presentation; receipt linked from [current workflow](current-agent-workflow.md).

Not run for this change: inference, live drafting, live ticket implementation, real native compaction, exhaustive ambient-discovery sentinels, backend regression suite, strict TypeScript or build. Added protocol/guard/API regression tests were not executed under repository lint-only policy. Successful metadata discovery is not live-provider or execution verification.
