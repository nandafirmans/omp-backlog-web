---
name: verify-backlog
description: Verify OMP Backlog Web through isolated real-browser journeys, preserving proof and distinguishing UI, fixture, and live-provider coverage.
---

# Verify Backlog

Commissioning status: starter browser journey commissioned; browser + protocol-fixture review journey also passed. See `features/README.md` for coverage and commissioning receipts. This is not full-app or live-provider verification.

## Launch

Run from repository root. Requires installed Bun, Node, util-linux `script`, Playwright and its Chromium browser. Never install missing dependencies silently.

```sh
PLAYWRIGHT_MODULE="$(dirname "$(readlink -f "$(command -v playwright)")")/index.mjs" node .omp/skills/verify-backlog/helpers/smoke.mjs
```

The helper creates a unique private `/tmp/opencode/backlog-verify-*` directory, an ephemeral loopback port and a fresh terminal-configured owner. Password exists only in process memory; no password, cookie, CSRF token or browser storage is printed or saved. It launches the real development server with fresh data and no remote origin, and registers only its own disposable repository. Never substitute the normal data directory or an existing project.

Append `--review-fixture` to exercise receipt rendering/download and change-request cancellation/feedback through ticket panel, board Actions and drag confirmation. This explicitly enables approved-only execution **only of the existing deterministic protocol child in the owned disposable repository**, pauses global starts before review, and ends with global starts paused. It never launches real OMP or a provider. Do not use fixture proof as real-provider evidence.

Append `--handoff-fixture` instead to include those review paths in a disposable Git repository and exercise operator reconciliation: canceled recheck, dirty rejection preserving work, external preservation of the synthetic file, persistent gate after reload, then explicit clean recheck. No commits/stashes/resets: helper simulates operator action by moving only its generated fixture file into its private scratch archive. No real repository is reconciled by the helper.

With explicit operator permission for disposable Git commits, use `--commit-fixture` alone to exercise Review & commit instead: initial dirty admission without implementation, dark/Light desktop/mobile review, keyboard selection, cancel/back/unsaved close, stale-content rejection, selected-file commits, preserved unselected work and separate clean Recheck. It creates commits only inside the helper-owned disposable Git repository, never this source tree or an existing project. Ends with global scheduling paused and zero implementation runs; no OMP/provider, push/reset/stash or hook invocation. Git/API regression coverage is in `server/workspace-commit.test.ts` (also creates disposable commits; request permission before running).

For exploratory work: use a new private data directory outside source and a free port; run `OMP_BACKLOG_DATA=<new-directory> bun server/setup.ts` interactively, then start `OMP_BACKLOG_DATA=<same-directory> OMP_BACKLOG_PORT=<port> bun run dev` with `OMP_BACKLOG_ORIGIN` unset. Keep password entry hidden. Do not read existing auth/environment files. Keep repositories and global scheduler paused unless a separately authorized execution journey requires otherwise.

## Doctor (read-only)

- Confirm exact owned URL, PID and data directory, not merely an answering port. Helper owns the spawned PID and checks that it stays alive.
- GET `/api/health`: expect `status: ok`, `runtime: bun`, `executionEnabled: true` after owner setup. This proves setup presence, not provider readiness.
- Before login, GET `/api/state`: expect 401. Do not store response cookies or session payloads as artifacts.
- After browser login, confirm fresh instance has no projects/runs. Missing browser/provider/setup prerequisites are blockers; never label skipped work passing.

## Drive

Read affected entries in `features/` before working. Helper drives the starter journey: actual terminal owner setup → browser login → pause global starts → save isolated root in Settings → folder-picker registration → ticket creation in Markdown → exact-revision approval → edit/save → approval invalidation → reload → inspect persisted side effects. Both repository and scheduler remain paused and no OMP/provider process starts.

For other journeys use the mapped user surfaces. Drive board dragging, Actions menu and ticket panel independently when affected; one path does not prove siblings. Use accessible roles/names or the CodeMirror `.cm-content[contenteditable=true]` surface, not injected application state. API reads and filesystem reads may corroborate UI actions; API writes are not substitutes for claimed UI coverage.

## Evidence

- Helper retains private `proof/result.json` and post-login screenshots; prints only outcome, artifact directory and blocker stage. No traces, HARs, auth screenshots, credential logs or raw state dumps.
- Receipt binds recipe hash, inspected worktree patch hash, Git HEAD, method, feature, actions, outcomes, viewport and check tier. Hashes identify observations, not an independently verified clean release.
- Bind ticket-run evidence to exact run/revision/criterion when applicable. Commissioning receipt is not ticket evidence and helper is not a live-provider test.
- Required claim: action → observed outcome → checked side effects. Screenshot alone is insufficient. Record failures and unverified boundaries; redact secrets before retaining any extra proof.
- Evidence stays separate from requirement attachments and outside disposable app data. Never upload proof to requirement attachments: they change revision/approval.

## Cleanup

Helper closes its browser and sends SIGTERM only to its owned server/setup process, waits for exit, and marks cleanup in receipt. Failed attempts follow the same path. A bounded SIGKILL fallback targets only that exact owned child; no OMP work is started. It verifies proof survives process teardown. Private scratch data is retained for operator inspection; no recursive deletion or global browser shutdown. Exploratory sessions must likewise stop only owned processes and retain proof. No automatic commits, resets, pushes, merges or deployments.

## Helpers

- `helpers/smoke.mjs`: bounded starter browser journey, optional `--review-fixture` review paths, `--handoff-fixture` Git handoff paths or explicitly authorized `--commit-fixture` operator commits, no dependency installation or provider invocation.
- Existing `bun run lint` is default code verification. Run tests/typecheck only when requested or required by an authorized verification journey; no build needed.
- `server/runtime-integration.test.ts`: protocol fixture, not live provider. Real OMP runs require explicit disposable-project execution permission and configured provider access. Do not inspect credentials to establish it.
- Maintenance: invoke `/skill:maintain-backlog-verification` explicitly; do not silently broaden ticket scope.
