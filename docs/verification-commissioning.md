# Commission a project verification recipe

Commissioning establishes that a particular recipe can execute a meaningful, bounded check of a named journey in a disposable environment. It is not ticket approval, autonomous-policy enablement, a full feature-map pass, or proof that future changes are correct. Use this procedure for onboarding a target repository into the existing Backlog execution/evidence/review flow; it adds no scheduler, retry engine or acceptance service.

## 1. Bound the authorization

Record the target repository, allowed disposable paths, permitted checks, runtime/attempt limits, network/external-service access and allowed process cleanup. Preparation-only work ends with the recipe and an unexecuted validation plan. Execution needs explicit authorization; do not interpret registration, a skill mention or ticket creation as permission.

Use synthetic data, a new private data directory, loopback binding and owned processes. Keep existing repositories, credentials, installed configuration and project policies untouched. Missing dependencies or browser binaries are blockers, not permission to install. Provider calls, disposable commits and external writes each require their own authority. Never use paid inference merely to commission a deterministic recipe.

**Complete when:** scope distinguishes preparation from execution, identifies resource ownership and states what must remain paused or inaccessible.

## 2. Inventory before choosing checks

Read the target's README, agent instructions, plan/current workflow, package scripts and existing verification skills. Inspect the actual frontend routes and handlers, server/API boundaries, persistence, command-line entry points and cleanup paths. Inventory installed runtimes, browser drivers, test harnesses and external dependencies without reading secret files. Reuse existing tooling rather than adding a framework.

Identify critical entry points and invariants: where a user starts, which operation changes state, how approval/authorization applies, which persisted side effects must survive reload and which failures must preserve data. Record startup and interactive setup separately from application execution. A health response alone proves neither authentication nor a provider's readiness.

Separate check tiers:

| Tier | Appropriate claim | Boundary |
| --- | --- | --- |
| Unit | Pure TypeScript behavior and edge cases | Does not prove React rendering, persistence or real API wiring |
| Integration | Server routes, persistence and lifecycle gates in isolated state | Protocol children are fixtures, not native OMP or provider proof |
| Browser | Real React UI actions, accessible controls, rendered outcomes and reload | Synthetic API responses prove UI behavior only; API writes do not prove UI actions |
| External dependency | Actual authorized OMP/provider/service behavior | Requires separate availability/access and execution authority; never infer from fixtures |

**Complete when:** every proposed claim has a driving entry point, observable outcome, independent side-effect check and explicit tier/prerequisites.

## 3. Create the project-local skill and map

Request creation at `.omp/skills/<skill-name>/SKILL.md` in the target repository, with valid `name` and `description` frontmatter. Keep that project's `features/` and helpers alongside it and version them with its code. A reusable commissioning workflow may be global; project-specific startup and verification recipes belong locally. Later tickets invoke `/skill:<skill-name>` only after the skill exists and is discoverable. Copying a foreign editor's skill directory or mentioning a future skill does not commission it.

Structure the skill as Launch → Doctor → Drive → Evidence → Cleanup. Specify exact working directory, installed prerequisites, isolated state/port selection, hidden interactive setup, read-only diagnosis, stable user selectors, failure handling and owned-process shutdown. Evidence must survive teardown and remain outside disposable application data. Bound the entire attempt, individual waits and harness repair attempts; watchers are not acceptance checks.

Seed a feature index and a small set of actual user-journey maps. For each journey record:

- Feature and every supported entry point, including alternate buttons, menus, keyboard/drag paths and direct URLs when relevant.
- Synthetic starting state and exact user actions, expected visible result, persistence/side effects and forbidden effects.
- Method/check tier, prerequisites, stable selectors and known blockers.
- Proof locations and pass/failed/blocked/not-run status for each entry point.

A starter inventory is not exhaustive. Explicit maintenance reconciles all mapped entries against source and live behavior; an affected-ticket check need not become a whole-project audit. Preserve product failures: classify documentation drift, harness gaps and product gaps separately rather than changing expectations to match a bug.

**Complete when:** another agent can follow one journey without hidden setup and the map makes unexercised alternatives visible.

### TypeScript/React example: approval invalidation

For an editor whose persisted approval binds to exact requirement bytes, use a criterion such as: “Editing and saving an approved requirement invalidates approval; reload retains the new bytes and no execution starts while scheduling is paused.” This is stronger than “the save button works.” A small example contract is:

```tsx
export type Requirement = { revision: string; approvedRevision: string | null };
export const isApproved = (value: Requirement) =>
  value.approvedRevision !== null && value.approvedRevision === value.revision;

export function ApprovalStatus({ value }: { value: Requirement }) {
  return <p role="status">{isApproved(value) ? 'Approved' : 'Not approved'}</p>;
}
```

Unit cases must include matching revisions, differing revisions and null approval. Integration coverage saves changed requirement bytes through the real server boundary and checks changed revision, cleared approval, persisted contents and zero new runs. Browser coverage creates/approves through the UI, edits/saves, observes “Not approved”, reloads, and corroborates saved state. Exercise alternate approval entry points independently when claimed. A mocked React render cannot establish server invalidation; a passing server test cannot establish accessible browser controls. OMP/provider execution is unnecessary for this criterion and must remain outside its claimed scope.

## 4. Make the recipe host-executable and reviewable

Before any policy enablement, prepare a recipe configuration matching [`VerificationRecipe`](../server/contracts.ts): exact argv array, nonempty repository-relative pinned files and integer timeout. For a hypothetical target with an existing bounded runner:

```json
{
  "argv": ["bun", ".omp/skills/verify-example/helpers/check.ts"],
  "files": [
    ".omp/skills/verify-example/SKILL.md",
    ".omp/skills/verify-example/helpers/check.ts",
    "package.json",
    "bun.lock"
  ],
  "timeoutSeconds": 180
}
```

This is an example shape, not an executable Backlog recipe: create and inspect the real runner first. Include all recipe instructions, helper imports/configuration and assertion files whose changes must invalidate commissioning, up to the current limit. Use explicit narrow checks rather than an implicit package-script chain. Pinning selected files does not recursively attest imported code or installed tooling; inventory those dependencies and retain their versions separately.

The current [host implementation](../server/autonomy.ts) accepts 1–64 argv elements (each at most 4096 characters, no control characters), 1–32 unique safe text file paths, and timeout 1–1800 seconds. It hashes argv, timeout and sorted file-content digests. Recipe/configuration drift requires explicit recommissioning. It executes argv directly with repository cwd and closed stdin: shell expansion, inline environment assignments and interactive prompts do not work as shell syntax. Put bounded setup in inspected code, not an opaque shell string.

There is no environment field in the recipe contract. Host execution inherits backend environment except `GIT_*`; it is not a secret-free sandbox. Document required variable names without values, establish safe nonsecret configuration inside the runner, and fail clearly on missing prerequisites. Do not read existing authentication files or print inherited environment. Environment contents, installed packages and browser binaries are not pinned by recipe identity. Current host process ownership/cleanup relies on Linux `/proc` and process groups; portable helper execution alone does not establish compatibility with that host path.

Host checks must finish with interpretable exit codes, concise sanitized assertion diagnostics and no lingering child work. Host output is bounded (approximately 60 KiB of collected text) and redacted; retain separate sanitized private proof if the diagnostic needs more context. A timeout/cancellation is blocked, not passed. The host rechecks exact candidate/recipe/workspace around execution; it does not execute in an OS sandbox or an immutable filesystem snapshot.

For [restricted review](../server/autonomy-review.ts), make the candidate's implementation, assertions, helper/configuration and relevant explanation inspectable as safe regular UTF-8 text in its Git tree. The distinct reviewer has only `candidate_diff`, `candidate_source` and `backlog_review`; no shell, browser, writes, arbitrary filesystem reads or project skill/plugin execution. Source/diff reads are bounded to 256000 bytes and reject unsafe/non-text blobs. Do not depend on an untracked private helper, secret artifact or huge generated blob as the only explanation of correctness. The reviewer receives host verification and author reports, but cannot independently browse arbitrary proof paths. Subjective/visual criteria lacking sufficient accessible evidence must remain inconclusive. Inspection access and a model's Pass are not execution receipts.

**Complete when:** exact argv can run noninteractively under backend conditions, its pinned inputs are explicit, meaningful assertions and relevant candidate source are reviewable, and unavailable evidence is recorded as a limitation.

## 5. Commission red → green in a disposable environment

With execution authority, first verify launch/doctor and a baseline journey. Then introduce one reversible, deliberately wrong product behavior only in an owned disposable copy. Keep the expectation unchanged. Run the same check: it must fail because the named invariant is violated, not because startup, imports or dependencies broke. Retain the mutation diff, recipe/work identities, actual command/exit, failed assertion/stage and sanitized proof. Restore only the deliberately changed bytes in that copy and rerun the same recipe to a passing result. Check persisted side effects, process shutdown and retained proof on both runs.

A missing selector can demonstrate sensitivity to a UI contract, but not necessarily to the deeper persistence invariant. Choose a defect matching the claim and state precisely which assertion detected it. Never inject failures into an active ticket, registered production repository, policy, credentials or a live paid run. A broken expectation/test is not a product-defect sensitivity demonstration. Do not weaken a test to obtain green.

When blocked, preserve partial proof and name the unmet prerequisite. An unexecuted recipe remains Draft; a launch failure does not establish defect detection. Repeated harness failure consumes the declared attempt bound rather than authorizing unlimited repair.

**Complete when:** an actual targeted disposable product defect goes red, correcting that defect goes green with unchanged assertions, both failures and successes are interpretable, and proof survives owned cleanup.

### Safe root-run Backlog scenario (proposed, not executed here)

The existing [starter helper](../.omp/skills/verify-backlog/helpers/smoke.mjs) is suitable for a narrow UI-contract sensitivity exercise without OMP/provider calls, commits or policy enablement:

1. Prepare an owned disposable copy containing the exact candidate source (including intended uncommitted changes), project-local skills, manifests/lockfile and Git metadata sufficient for the helper's `git rev-parse`/`git diff` observations. Use already-installed dependencies and an existing Playwright/Chromium installation; do not install or modify the source repository. Ensure `/tmp/opencode` exists with appropriate operator-controlled permissions. Record the copied candidate identity separately: helper HEAD plus tracked patch hash is not a complete inventory of untracked files.
2. From that copy, set `PLAYWRIGHT_MODULE` to the absolute path of the existing Playwright `index.mjs` and run `node .omp/skills/verify-backlog/helpers/smoke.mjs` with no fixture flags. The skill's Launch command shows one installed-CLI path resolution; resolve it once and use the actual installed module. Bound each invocation externally with enough grace for the helper's 120-second deadline and owned cleanup. Do not kill a process group whose ownership has not been established.
3. For the red run, change only the unapproved label in the copied `src/Workspace.tsx` ticket-facts approval ternary from `Current revision not approved` to `Current revision approved`. Leave helper assertions unchanged. Expected red: stage `revision invalidation`, waiting for the correct unapproved label after Save revision. This demonstrates detection of a false approval display, **not** a backend approval-invalidation mutation. The first approval display remains valid so the failure should reach the intended stage.
4. Preserve the red receipt and generated mutation diff privately. Restore the one copied label, then rerun the identical helper for green. Each invocation creates separate scratch/proof directories. Inspect `proof/result.json`: red status/exit and failure stage/location; green changed revision, null approvedRevision, exact disk/Markdown bytes, no runs, both scheduling gates paused, zero browser errors and `cleanup: true`. Confirm both proof files survive shutdown.
5. Retain sanitized proof outside the copy before operator-authorized disposal. Do not run `--review-fixture`, `--handoff-fixture` or `--commit-fixture` for this scenario; they add different authority/coverage. Missing prerequisites mean blocked. A root execution is still needed to establish any result; this document does not record one.

Current root prerequisite inventory reported no Playwright CLI, local Playwright package, global Playwright package or Chromium cache. With installs unauthorized, this browser re-drive is **blocked**, not feasible in the present environment. Keep the project skill and its historical receipts unchanged. Separately authorized recovery policy/runtime tests and private installed-OMP synthetic-provider recovery can supply deterministic verifier red/green, restricted candidate-inspection and cleanup evidence, but cannot clear this browser commissioning gap or prove real-provider recovery. Record their actual root-run results separately; none are asserted here.

The helper hides raw exception payloads intentionally: failures report sanitized type, stage and code location, not expected/actual application values. Check that this is enough to diagnose the deliberate label defect; otherwise commissioning has an interpretable-diagnostic gap, not a silent pass. Its 120-second timer initiates teardown, per-action waits are 15 seconds and child shutdown has a five-second SIGKILL fallback; the timer is not a guarantee against every OS-level hang. It stops owned setup/server children and closes its browser, preserves scratch, writes proof in `finally`, and verifies receipt access. Inspect actual cleanup results, not just those code paths. Import/prerequisite failures before its `try` may produce no receipt.

## 6. Record readiness without enabling policy

Use this evidence readiness checklist for the named recipe/candidate/journey:

- [ ] **Execution:** exact argv/cwd, work identity, tool versions, times, actual exit and proof retained; no inferred execution from a stored hash.
- [ ] **Meaningful assertions:** action → visible outcome → relevant persisted/forbidden side effects; unit/integration/browser/external claims separated.
- [ ] **Sensitivity:** targeted disposable product defect was detected with unchanged expectations, then corrected green; record precisely what it proves.
- [ ] **Failure interpretation:** failed invariant/stage and sanitized diagnostic are useful; blocked/not-run checks remain explicit.
- [ ] **Bounds and cleanup:** timeout, attempts and ownership defined; successful and failing runs stop owned work and retain proof.
- [ ] **No secrets:** no credentials, sessions, cookies, raw environment/state dumps, login screenshots, HARs or traces in retained proof.
- [ ] **Host compatibility:** noninteractive argv, pinned files, inherited-environment limitations, installed dependencies and Linux host assumptions reviewed; candidate source/assertions inspectable under restricted tools.
- [ ] **Coverage limits:** every claimed entry point/tier accounted for; alternatives, external prerequisites, subjective criteria and maintenance gaps named.

Record “ready for the demonstrated journey at this work/recipe identity” only when all applicable items have observed evidence. Otherwise record Draft/blocked with the precise gap. This readiness record does not save or enable autonomous policy, approve requirements, start scheduling or grant commits. A later separately authorized operator commissions the exact host configuration and confirms policy enablement through the existing completion-policy flow; changed recipes require renewed explicit commissioning. Keep the original session, deadlines, accounting, bounded corrections/recovery, fresh review and publication gates owned by the existing host.

Evidence classes remain distinct:

| Source | What it establishes |
| --- | --- |
| Author `backlog_evidence` / commissioning report | Agent-reported method/outcome/recipe; stored artifact identity is not command attestation |
| `HostVerification` (`host_execution`) | Actual argv/exit/times/output tied to candidate tree and recipe hash, with recorded environment metadata; not semantic completeness |
| `IndependentReview` | Fresh restricted nonauthor model judgment for every criterion on that tree; not an execution receipt or certainty |
| CI | Checks actually exercised on the CI checkout/environment; no automatic proof of local commissioning, live services, full map or policy enablement |

Run-owned sanitized proof must stay separate from requirement attachments, which change the approved revision. Preserve partial failures and provenance; do not replace them with a later success narrative.

## Current Backlog static reconciliation and limitations

This procedure was checked against the current source contracts and documentation, not by running commissioning checks:

- [`verify-backlog`](../.omp/skills/verify-backlog/SKILL.md) already supplies Launch/Doctor/Drive/Evidence/Cleanup, installed-tool-only execution, terminal owner setup, isolated loopback state, paused starter scheduling, private proof and owned cleanup. Its default helper covers login, registration, Markdown create/panel approval, saved edit invalidation and persisted bytes. It does not commission another project's recipe.
- All current maps were inspected: [access](../.omp/skills/verify-backlog/features/access.md), [projects](../.omp/skills/verify-backlog/features/projects.md), [tickets](../.omp/skills/verify-backlog/features/tickets.md) and [runs](../.omp/skills/verify-backlog/features/runs.md). Logout/throttling, alternate approval/retry/Done routes, rich editor behavior, assisted drafting, live recovery/compaction and other mapped branches require their own evidence. Optional protocol/review/handoff/commit fixtures prove only their documented scope and authority.
- The [feature index](../.omp/skills/verify-backlog/features/README.md) explicitly calls itself a starter map. Historical `/tmp` receipts describe the inspected work at their execution time, may no longer exist, and establish neither current readiness nor full-map coverage. This document adds no new passing receipt or exhaustive claim.
- [`maintain-backlog-verification`](../.omp/skills/maintain-backlog-verification/SKILL.md) remains the explicitly invoked full-map workflow: every required entry point, 15-minute attempts, two harness fixes per failing step, serial shared-instance driving and explicit unverified prerequisites. Commissioning one journey does not satisfy that maintenance pass.
- [README autonomous completion](../README.md#autonomous-completion-opt-in), [current workflow](current-agent-workflow.md#autonomous-completion), [PLAN verification integration](../PLAN.md) and [`contracts.ts`](../server/contracts.ts) retain the existing approval/evidence/host-review/publication distinction. This onboarding guidance supports later adoption acceptance; it does not claim that planned rollout or real-provider recovery is complete.
