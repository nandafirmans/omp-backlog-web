# Phase 6 isolated concurrent execution

## Goal and boundary

Allow independent repositories to execute tickets concurrently without sharing run authority. Phase 6A keeps same-repository execution serialized. Separate working directories are not OS sandboxes. Author processes and commissioned host checks retain backend-user permissions.

Initial inspected branch is `main`, with clean HEAD `583fc9852c351b97b23aebf6d222a6f776d3422b`.

## Architecture decision

Retain one scheduler and the existing per-ticket lifecycle. Replace the runtime's nullable `Execution` owner with a map keyed by run ID. Persistent running, stopping, and paused runs remain capacity claims, including owners not attached to an in-memory execution after restart.

Each existing `Execution` owns its RPC process, immutable ticket snapshot, conversation, poll timer, deadline, host-work chain, abort controller, phase work, and autonomous lifecycle. Run-private directories continue to isolate author sessions, process identities, reviewer sessions, and evidence.

Admission remains serialized by the existing scheduler pump. It scans repositories by `lastStarted`, then repository ID, and tickets by queue order, then ticket ID. A busy workspace must be skipped rather than ending the scan. Capacity is checked again in the synchronous admission transaction before persisting the run and ticket claim.

The setting defaults to one and permits one through four owners. Reducing capacity does not cancel existing work. Global and project pause affect new admission only. Paused owners retain capacity. A stopping run retains ownership until all owned process work is observed stopped.

Workspace exclusion must compare canonical directory identities, overlapping paths, and canonical Git common directories. Distinct Git worktrees sharing metadata remain mutually exclusive in Phase 6A. Unknown workspace identity fails closed. Recovery uses durable per-run process identities and never attaches, duplicates, or automatically replays interrupted implementation.

The alternative was one runtime instance per repository with a global coordinator. It still needs centralized durable admission and alias-aware ownership, while adding control routing and coordinated recovery. The run map retains the current single admission authority with fewer lifecycle changes. Independent architecture review endorsed this choice and required persisted claims, guarded resume-after-close, duplicate-resume exclusion, and bidirectional operation locks.

## Singleton assumptions replaced

- The in-memory active owner, completion guard, dialog routing, pause and resume selection, and shutdown target.
- The scheduler's global claimed-run exclusion and one-admission return.
- Autonomous authority's rejection of every unrelated active run.
- Recovery's exemption for only one attached execution.
- UI selection of one global active run and global-slot explanations.
- Workspace operations that exclude only an exact registration ID rather than aliases of the same mutable workspace.

## Verification record

The final complete Bun suite passed 212 tests with seven opt-in tests skipped and no failures, across 32 files. Strict `tsc --noEmit` and repository-wide ESLint passed. The 15 required scenarios below have deterministic process/protocol coverage. Native/provider and browser observations remain separate evidence tiers.

The pre-change baseline suite had 179 passes, six skips and three failures. Two fixture tickets lacked a description before `Done when:`. The assisted-creation test pinned pre-multipart Markdown bytes. Fixtures now provide valid descriptions, and publication assertions retain revision/attachment atomicity without that incidental byte equality. Production ticket validation was not weakened.

After host restart, a further full run found ten pre-test `ENOENT` failures because five existing fixtures assumed `/tmp/opencode` already existed. They now create unique directories directly beneath `os.tmpdir()`. This changes test setup only, not application behavior or production data.

Independent review found two blockers after the first integrated suite passed 205 tests. Four publication-identity regressions and two resumed-reviewer control regressions reproduced the defects before correction. Publication now binds mutation and recovery to the admitted physical workspace. Resume releases its admission reservation after execution registration, allowing later pause/cancel without letting an older control clear a newer reservation. All seven targeted correction/concurrent-autonomy tests passed, followed by the 211-test suite. A Stopping run no longer offers unsupported cancellation. A later safety review found that legacy autonomous resume could mint missing workspace authority. A failing-before regression now covers that path, and autonomous continuation rejects missing admitted identity while retaining paused ownership for explicit reconciliation. Final checks include this additional regression.

Final independent control/recovery and filesystem/publication reviews passed their assigned scopes after correction. Earlier review covered scheduler fairness, autonomous completion and UI consistency. Review findings led to the resumed-phase control fix, physical-publication identity checks, legacy autonomous resume rejection and removal of invalid Stopping cancellation. These are independent role judgments, not proof of model-family diversity. Current final review exports are under `/tmp/omp-phase6-final-FVNdr4`.

| Executed check | Result |
| --- | --- |
| `bun test` | 212 passed, seven opt-in skips, zero failures |
| `bun test server/autonomy-runtime.test.ts -t 'legacy autonomous resume\|stops a resumed autonomous reviewer\|two independent autonomous owners'` | Four passed |
| `bun test server/execution.test.ts server/recovery.test.ts server/evidence.test.ts server/board-api.test.ts server/workspace-commit.test.ts` | 12 passed after portable temporary-directory correction |
| `OMP_BACKLOG_NATIVE_TESTS=1 bun test server/engineering-native.test.ts server/restricted-native.test.ts` | Five installed-OMP discovery/isolation tests passed |
| `OMP_BACKLOG_LIVE_TESTS=1 bun test server/concurrency-live.test.ts` | One bounded concurrent native/provider test passed |
| `tsc --noEmit` | Passed |
| `eslint .` | Passed |

No production build, application-repository commit, push, PR, merge or deployment was performed. Disposable Git commits occur only inside verification fixtures.

The required acceptance scenarios map to these executable checks:

| Scenario | Evidence location |
| --- | --- |
| 1. Two independent repositories overlap at capacity 2 | `runtime-integration.test.ts`, capacity-two held-child test; `concurrency-live.test.ts`, native/provider overlap smoke |
| 2. Third repository waits | Capacity-two held-child test |
| 3. Same-repository tickets serialize | Capacity-two held-child test; physical identity tests |
| 4. Completion admits eligible work | Capacity-two slot-reuse test |
| 5. Failure leaves peer unaffected | Provider-failure isolation test |
| 6. Independent pause and resume | Raced-resume/cancel test; resumed-autonomous-reviewer regressions |
| 7. Independent tokens and deadlines | Per-repository token and time exhaustion cases |
| 8. Restart reconciles multiple PIDs | Proven-survivor and unknown-owner recovery test |
| 9. Independent autonomous verification and commits | `autonomy-runtime.test.ts`, two independent autonomous owners with distinct candidates, criteria and host output |
| 10. Aliases and overlap cannot bypass exclusion | `workspace-identity.test.ts`, canonical roots, symlinks, nested directories, linked worktrees and bidirectional operation locks |
| 11. Global pause and project permissions | Capacity-reduction/global-pause test; project-permission/dependency test |
| 12. Dependencies require accepted Done | Parallel-admission dependency test; autonomous dependent-publication test |
| 13. Unknown/lost child ownership retains its claim | Multi-survivor recovery and legacy-identity tests |
| 14. Human review remains default | Existing Human Needs review cases and bounded native/provider smoke |
| 15. pstack, sessions and evidence stay run-specific | Native router/session integration cases; distinct autonomous receipts/sessions; native/provider proof |

All named test files are under `server/`. Held RPC dialogs, explicit process-event barriers, and a blocked FIFO snapshot read make races observable without relying on a fixed sleep to imply overlap. Polling deadlines observe real detached processes and filesystem events; they do not establish provider inference timing.

The separately executed installed-OMP discovery/isolation checks passed five tests. The latest bounded concurrent native/provider smoke passed with `openai-codex/gpt-6.1-sol`. Two live PIDs, 6137 and 6142, had distinct session identities and directories, reported only their own repository marker, and stopped at Human Needs review with no remaining owned PID. Current proof is `/tmp/omp-concurrency-live-ikskAk/proof.json`. This establishes overlapping provider-backed ticket lifecycles, not simultaneous inference or concurrent live-provider autonomous publication. An earlier smoke passed, but its temporary proof disappeared after host restart. An intervening live rerun failed; it is not counted as passing evidence.

Actual browser verification used isolated data at `/tmp/omp-phase6-browser-X6jqgp`. It exercised selected-run pause/resume, canceled and confirmed cancellation, independent dialog submission, slot release, global pause, capacity reduction while two runs remained alive, and per-project state. Settings were visually inspected at 1440px and 390px in Tokyo Night and Light. No document horizontal overflow was observed. A separate synthetic stopping snapshot confirmed inspection remained available with no invalid Cancel button. The owned servers/browser were stopped. Original screenshots, sanitized proof and exported reviews became unavailable after host restart; these are recorded observations, not currently downloadable artifacts.

The initial browser launcher incorrectly used Eval's `process.execPath`, which was `omp`, instead of Bun. Two disposable real OMP attempts exhausted their token limits. Those attempts are invalid verification experiments. The launcher was corrected to `env bun`, and explicit UI retries exercised the intended protocol fixture. Neither the failed experiments nor protocol success is live-provider autonomous proof.

## Remaining security boundaries

Physical workspace exclusion coordinates one backend's admitted runs and operator actions. It does not constrain external editors, other backend instances, shared build services, shared package caches, network access, or filesystem writes outside the selected repository. Keep one backend per data store. Unknown legacy workspace identities conservatively block admission until explicit reconciliation. No automatic install, credential access, push, PR, merge, deployment, or destructive recovery is authorized.

Legacy autonomous attempts without a recorded admitted workspace identity cannot resume or publish. Operator cancellation remains available for an observed stopped paused attempt, preserving partial work and evidence. Reconciliation followed by an explicitly authorized new attempt captures a fresh identity. Human legacy resume does not acquire autonomous completion authority.

## Readiness

Phase 6A is ready for controlled normal use across independent repositories with one backend per data store and existing project approval/completion policies. Capacity remains 1 by default; selecting 2 explicitly enables the verified cross-repository path. There are no unresolved independent-review blockers in the checked scopes.

Concurrent live-provider autonomous publication, simultaneous inference timing, every provider/model, full feature-map coverage and exhaustive accessibility remain unverified. Autonomous cross-repository host verification, restricted review, guarded commits and restart non-replay have deterministic child-process/Git coverage. Same-repository concurrency remains disabled.

## Files changed

- Execution and settings use `server/runtime.ts`, `server/contracts.ts`, `server/store.ts`, `server/api.ts`, `server/autonomy.ts`, `server/autonomy-policy.ts`, `server/workspace-commit.ts`, and new `server/workspace-identity.ts`.
- UI changes are in `src/Workspace.tsx` and `src/TicketBoard.tsx`.
- Regression and native-smoke coverage is in `server/runtime-integration.test.ts`, `server/autonomy-runtime.test.ts`, `server/autonomy.test.ts`, `server/workspace-identity.test.ts`, `server/concurrency-live.test.ts`, `server/settings-api.test.ts`, `server/execution.test.ts`, and `server/fixtures/autonomy-child.ts`.
- Baseline fixture and temporary-directory repairs are in `server/recovery.test.ts`, `server/board-api.test.ts`, `server/assisted-creation.test.ts`, `server/evidence.test.ts`, `server/workspace-commit.test.ts`, and the execution-settings fixture listed above.
- Documentation changes are in `AGENTS.md`, `PLAN.md`, `README.md`, `docs/current-agent-workflow.md`, and this document.

## Phase 6B recommendation

Do not enable same-repository concurrency merely by removing the common-directory exclusion. Each ticket needs a dedicated worktree, private branch, durable base commit, and isolated candidate capture and verification. The current local publication assumes one attached branch and working index. It must become publication into the ticket branch followed by a separate, serialized integration decision.

Only the host creates worktrees and ticket branches, publishes candidates, and integrates accepted work. Ticket agents retain no commit authority. Worktree creation does not authorize dependency installation or copying credentials and private sessions into the new workspace.

Integration must verify the exact integrated candidate, not reuse receipts for a pre-integration tree. If the target branch moved, detect conflicts and re-run verification and restricted review on the rebased or merged candidate before guarded publication. Dependencies become eligible only after their prerequisite is integrated and accepted Done, not after a private branch finishes.

Keep Git metadata operations serialized by canonical common-directory identity. Git index and ref locks are necessary but do not establish application-level integration ordering. Persist worktree path, ticket branch, base, candidate, integration intent, and process identity before side effects. Restart reconciliation must distinguish prepared publication, published ticket branch, integrated target, and uncertain states without replaying commits.

Cleanup requires observed process exit, durable evidence, known integration state, and explicit retention policy. Never prune a dirty, unknown, active, or user-owned worktree. Worktrees isolate tracked working files and indexes, not credentials, network access, external build output, shared caches, or OS permissions. Phase 6B requires separate implementation and crash/conflict verification before same-repository execution can be enabled.

Git's [worktree documentation](https://git-scm.com/docs/git-worktree) confirms that linked worktrees have private `HEAD` and index files while sharing other repository state. Its `lock` prevents pruning; it does not serialize ticket implementation or integration. `remove` refuses unclean worktrees without force. These are reasons to retain the Phase 6A common-directory exclusion and require application-owned integration and recovery in Phase 6B.