# OMP 18.16.0 compatibility and restricted startup

Date: 2026-11-05. Scope is the author RPC skill interface and the restricted model-discovery, drafting, and acceptance-review startup profile. This is not an exhaustive OMP security audit or OS sandbox claim.

## Native author interface

Installed OMP reports `18.16.0`. The actual author launch profile exposes native `skill:poteto-mode` and `skill:pstack-pi` through `get_available_commands`, and `task` through `get_state.dumpTools`. `--no-skills`, `--no-extensions`, and an isolated missing-plugin environment reject engineering preflight. A synthetic project-local verification skill remains discoverable alongside pstack.

Native `/skill:poteto-mode` dispatch reads and expands the installed router. A successful skill prompt returns an empty response object, not necessarily `agentInvoked: true`. Its native history message arrives asynchronously with `role: custom`, `customType: skill-prompt`, and `details` containing the name, resolved path, canonical prompt, and body line count. The host observes that record before creating the native goal. OMP trims surrounding prompt whitespace.

Exact-tag sources describe [command metadata](https://github.com/can1357/oh-my-pi/blob/v18.16.0/packages/coding-agent/src/slash-commands/available-commands.ts), [native skill dispatch and RPC responses](https://github.com/can1357/oh-my-pi/blob/v18.16.0/packages/coding-agent/src/modes/rpc/rpc-mode.ts), and [skill parsing/rendering](https://github.com/can1357/oh-my-pi/blob/v18.16.0/packages/coding-agent/src/extensibility/skills.ts). The implementation uses those native interfaces, not a copied skill tree or plugin-cache path.

## Ancestor plugin import reproduced and corrected

Independent source review found an existing namespace gap in the restricted profile. The app created a private `work/.git` anchor but no `work/.omp`. OMP's [project registry resolver](https://github.com/can1357/oh-my-pi/blob/v18.16.0/packages/coding-agent/src/discovery/helpers.ts#L1073-L1137) prefers eligible ancestor `.omp` directories even above that Git anchor. This behavior also exists in the [previously audited 18.13.3 resolver](https://github.com/can1357/oh-my-pi/blob/v18.13.3/packages/coding-agent/src/discovery/helpers.ts#L1073-L1137).

The direct [plugin package loader](https://github.com/can1357/oh-my-pi/blob/v18.16.0/packages/coding-agent/src/extensibility/plugins/loader.ts) can find an ancestor plugin dependency and its `omp.tools` manifest without an installed-plugin registry entry. [Custom-tool discovery](https://github.com/can1357/oh-my-pi/blob/v18.16.0/packages/coding-agent/src/extensibility/custom-tools/loader.ts#L261-L306) appends plugin tool paths separately from capability-provider filtering. [SDK startup](https://github.com/can1357/oh-my-pi/blob/v18.16.0/packages/coding-agent/src/sdk.ts#L2919-L2953) can import those modules before active-tool checks. Empty `dumpTools` alone therefore does not prove that executable discovery was excluded.

A disposable metadata-only reproduction used an ancestor package whose custom-tool module wrote a unique local marker and returned no tools. With only the Git anchor, the marker appeared despite empty active tools and no goal. With an empty private `work/.omp`, the marker did not appear. No inference, credentials, installation, or real project mutation was involved. Retained reproduction proof is `/tmp/backlog-ancestor-plugin-rtb6tU/proof.json`.

`installProfile()` now creates that empty `.omp` anchor alongside `.git`. This confines direct project-plugin namespace resolution to the private working directory. Existing disabled providers, empty extensions, private HOME/config, tool/skill/extension flags, and the restricted reviewer tool contract remain unchanged. Only exact `18.16.0` was added to the audited version list; unknown releases still reject.

The permanent opt-in regression in `server/restricted-native.test.ts` checks actual `installProfile()` behavior. Its sensitivity control removes only the generated namespace anchor by renaming it inside the disposable fixture, then confirms the otherwise identical ancestor module executes. The corrected arm requires no marker, no active tools or goal before host registration, and exactly `candidate_diff`, `candidate_source`, and `backlog_review` afterward.

## Stock inline command metadata

The fresh restricted session advertises stock `autoresearch` and `init` commands even with external discovery disabled. These are not ambient plugin imports. The [SDK injects the bundled autoresearch factory](https://github.com/can1357/oh-my-pi/blob/v18.16.0/packages/coding-agent/src/sdk.ts#L2949-L2952); [fresh control state is inactive](https://github.com/can1357/oh-my-pi/blob/v18.16.0/packages/coding-agent/src/autoresearch/state.ts#L181-L196). Its [lifecycle handlers](https://github.com/can1357/oh-my-pi/blob/v18.16.0/packages/coding-agent/src/autoresearch/index.ts) do not activate experiment tools or continuation in that state. `init` comes from a bundled prompt template.

The acceptance prompt has a fixed non-command prefix. Native extension/file-command dispatch requires a leading slash; a command mentioned later in ticket text or candidate output does not trigger that dispatch. This does not make those stock commands safe to invoke arbitrarily or grant the reviewer their capabilities.

## Executed checks and limits

- `OMP_BACKLOG_NATIVE_TESTS=1 bun test server/engineering-native.test.ts server/restricted-native.test.ts` passed all five tests on installed OMP 18.16.0. These are actual RPC startup/discovery and executable-import controls, not provider inference.
- Separate normal-author positive controls executed synthetic user/project extension modules. The restricted profile did not execute ambient/private extension sentinels, expose the synthetic skill canary, or emit recorded tool, host-URI, or inference activity. It exposed empty initial tools/no goal and exactly the three registered acceptance tools afterward. Proof is `/tmp/backlog-restricted-18.16-KC3Zkg/proof.json`.
- Actual live-provider Human review and Autonomous completion results are recorded separately in [Current agent workflow](current-agent-workflow.md#implementation-and-verification). Metadata success does not establish those outcomes.

Registered projects and host verification commands retain backend OS-user permissions. These controls do not attest exhaustive acceptance, arbitrary plugin safety, authorship against concurrent external writers, or every possible discovery location.
