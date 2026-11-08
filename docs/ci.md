# CI and verification tiers

The [CI workflow](../.github/workflows/ci.yml) runs Tier A on pull requests targeting `main` and pushes to `main`. No workflow existed at the fetched `origin/main` baseline `33a5093f89415e13fef2638bd404b45c0c7854b3`; the existing native/provider gates and accounting caveat remain unchanged. Hosted GitHub Actions execution has **not been observed** for this change. Local checks are not hosted-run evidence.

## Tier A — deterministic, ordinary CI

Prerequisites: Linux/glibc, Git, and Bun **1.4.4**. CI uses `ubuntu-24.04`, not the moving `ubuntu-latest` label: Linux `/proc`, process groups, SQLite and glibc `renameat2(RENAME_NOREPLACE)` behavior are relevant to the tests. This is not macOS, Windows or musl compatibility coverage.

Equivalent commands from the repository root:

```sh
export OMP_BACKLOG_NATIVE_TESTS=0
export OMP_BACKLOG_LIVE_TESTS=0
export BUN_CONFIG_NO_ENV=1
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run lint
bunx vite build
bun test
```

Every command must succeed; no `continue-on-error`, ignored exit code or accounting-test exemption is configured. The job has a 20-minute deadline. Package scripts resolve TypeScript `--noEmit` and full-project ESLint; the explicit Vite command builds the frontend (there is no package `build` script). The checked-in lockfile supplies Vite, so `bunx vite build` uses the installed dependency, not an intentionally downloaded alternate version. Keep optional dependencies enabled: Vite/esbuild/Rollup platform binaries are supplied by locked packages. Dependency lifecycle scripts are explicitly disabled; there is no project install script or `trustedDependencies` requirement in the reviewed package manifest. Any newly necessary lifecycle script needs a separate security review, not blanket script enablement.

The suite uses disposable repositories, local databases and protocol-speaking child fixtures. It does not require installed OMP, provider credentials, a browser, a running application, or paid inference. The only suite-level native/live opt-ins found are `OMP_BACKLOG_NATIVE_TESTS=1` and `OMP_BACKLOG_LIVE_TESTS=1`; both are explicitly off. `OMP_BACKLOG_NATIVE_RECOVERY_CHILD` and `OMP_BACKLOG_NATIVE_RECOVERY_ROOT` are internal native-harness child controls, not independent opt-ins. `OMP_BACKLOG_LIVE_MODEL` only selects models in some already-enabled live tests. `BUN_CONFIG_NO_ENV=1` prevents local dotenv files from enabling tests or supplying credentials.

### Security and pins

- Workflow permission is only `contents: read`; checkout uses `persist-credentials: false`. No provider secrets are supplied. There is no `pull_request_target`, self-hosted runner, write permission, publication, deployment, commit, push or PR creation.
- Tests and build still execute repository code on an ephemeral GitHub-hosted runner. Disabling install scripts is not a sandbox for PR code. Do not attach credentials or persistent operator data to this job.
- Both actions use immutable commit SHAs, verified against their first-party GitHub tag refs: [checkout v4.2.2 → `11bd71901bbe5b1630ceea73d27597364c9af683`](https://api.github.com/repos/actions/checkout/git/ref/tags/v4.2.2), [setup-bun v2.0.2 → `735343b667d3e6f658f44d0eca948eb6282f2b76`](https://api.github.com/repos/oven-sh/setup-bun/git/ref/tags/v2.0.2). Reviewed inputs/runtime: [checkout action](https://github.com/actions/checkout/blob/11bd71901bbe5b1630ceea73d27597364c9af683/action.yml), [setup-bun action](https://github.com/oven-sh/setup-bun/blob/735343b667d3e6f658f44d0eca948eb6282f2b76/action.yml), [Bun download/cache implementation](https://github.com/oven-sh/setup-bun/blob/735343b667d3e6f658f44d0eca948eb6282f2b76/src/action.ts). Both actions use Node 20; Bun executable caching is disabled. This is a bounded configuration/source review, not an exhaustive audit of bundled action dependencies.
- Bun is an exact [1.4.4 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.4), not `latest` or a range. Action SHA pins do not make the hosted runner image or downloaded Bun release bytes immutable. Upgrade pins deliberately after reviewing upstream changes.
- Platform and install references: [Ubuntu 24.04 runner image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), [Bun Linux requirements](https://bun.com/docs/installation), [frozen installs and lifecycle policy](https://bun.com/docs/pm/cli/install).

Local P1 checks on Linux x64 / Bun 1.4.4: frozen install with scripts disabled reported no dependency changes; TypeScript, full ESLint and Vite production build passed. Vite retained its large-chunk warning. A Bun YAML assertion check passed for workflow parsing, main triggers, read-only permissions, immutable action-pin shape, disabled native/live flags and required command sequence. This is not an Actions runner execution or `actionlint` validation (`actionlint` is unavailable); first hosted run still must establish runner/action/download compatibility.

Full local ordinary suite with native/live flags off: **295 passed, 21 skipped, zero failures** across 37 files. The skips are the explicit native/live tier boundary, not an exemption for deterministic failures.

## Tier B — installed OMP, synthetic transport and discovery

This tier is **not** part of ordinary CI. The project does not lock an OMP distribution, its native artifacts or the separately installed pstack fork/skills in `bun.lock`; installing an unpinned global CLI/plugin during PR checks would not be a reproducible or adequately reviewed native job. Use an existing trusted Linux/glibc installation, record `omp --version`, exact package/source revision and plugin/skill revisions, and inspect upgrade compatibility before running. Application admission supports OMP major 18 plus RPC v2/capability checks; that is not an exact reproducibility pin. The previously documented installed version is 18.18.1, not a promise about every 18.x installation.

Run the groups explicitly, with paid tests disabled:

```sh
OMP_BACKLOG_NATIVE_TESTS=1 OMP_BACKLOG_LIVE_TESTS=0 BUN_CONFIG_NO_ENV=1 bun test server/recovery-native.test.ts
OMP_BACKLOG_NATIVE_TESTS=1 OMP_BACKLOG_LIVE_TESTS=0 BUN_CONFIG_NO_ENV=1 bun test server/rpc-native.test.ts
OMP_BACKLOG_NATIVE_TESTS=1 OMP_BACKLOG_LIVE_TESTS=0 BUN_CONFIG_NO_ENV=1 bun test server/engineering-native.test.ts server/restricted-native.test.ts
```

Recovery/RPC synthetic tests execute the real installed `omp`, native tools, journals and host checks against a bounded loopback no-auth `native-proof/synthetic-proof` endpoint; they do not call a paid model. Their [private profile](../server/fixtures/native-provider.ts) allowlists inherited environment keys, creates private HOME/XDG/auth discovery roots and disables retries, model fallback and unrelated background model features. Recovery child bootstrapping applies that environment before runtime initialization. Retained private `/tmp/omp-recovery-native-*/proof.json` bundles and incremental event streams distinguish pass, failure and inconclusive results; inspect printed paths rather than uploading private runtime trees to CI. Configuration isolation is not an OS filesystem/network sandbox.

Discovery/engineering controls additionally require an already installed and configured pstack fork with `skill:poteto-mode`, `skill:pstack-pi` and native `task`. They inspect real installed author discovery and disabled/missing controls without submitting inference; discovery is not proof of model quality or playbook adherence. Unlike private synthetic profiles, installed-discovery positive controls load the operator's installed configuration: inspect/trust those plugins first. No command here installs or alters global configuration.

**Known unresolved failure:** `server/rpc-native.test.ts` retains the discarded-turn accounting assertion: known usage totals **146 tokens** on the active branch but reports zero off-branch, including the final RPC sample. The documented 18.18.1 native results include this failure. Do not weaken assertions, filter it out while claiming a full native pass, or hide the command with `continue-on-error`. Run groups independently and report each outcome. Original-session accounting continuity is not complete lifetime usage or provider-billing proof. See [native evidence and limitations](current-agent-workflow.md#native-synthetic-provider-recovery).

## Tier C — explicitly authorized paid inference

Never enable this tier for an ordinary PR/push job or infer authorization from Tier A/B success. It requires separately authorized provider access/spend, a trusted configured installed OMP, disposable repositories/private application data, and pstack when exercising pstack cases. It may execute host commands and make guarded local commits inside its disposable project. Keep production projects, credentials and unrelated data outside that work.

After new explicit authorization for the chosen test, run only its exact file, for example:

```sh
OMP_BACKLOG_NATIVE_TESTS=0 OMP_BACKLOG_LIVE_TESTS=1 BUN_CONFIG_NO_ENV=1 bun test server/recovery-live.test.ts
```

Other separately selectable paid suites are `server/engineering-live.test.ts` and `server/concurrency-live.test.ts`; do not enable the flag on an unqualified `bun test`. The recovery fixture fixes Standard mode, `openai-codex/gpt-6.1-sol`, low thinking, 500,000 reported tokens, ten minutes, one correction and one recovery. Other live suites use their own finite limits; `OMP_BACKLOG_LIVE_MODEL` does not override the recovery fixture's fixed model. Reported-token caps are best effort, not hard lifetime-consumption or monetary limits.

Only naturally occurring failure followed by observed original-session recovery can establish `NATURAL_LIVE_RECOVERY_PASS`; synthetic injected recovery cannot. The prior real-provider CSV trial remains **PARTIAL** (first-attempt success, no recovery), not a new recovery pass. No Tier C execution is authorized by adding this workflow or guide. See [latest real-provider evidence](current-agent-workflow.md#latest-real-provider-validation) and [accounting limits](current-agent-workflow.md#live-recovery-fixture-and-accounting-limits).
