# Current agent workflow

This guide describes the implemented workflow, not full pstack parity. See [PLAN.md](../PLAN.md#10-planned-execution-loop-improvements) for delivery boundaries and remaining work, and [README.md](../README.md) for setup and navigation.

## What changed

| Addition | Current behavior |
| --- | --- |
| Verification skills | Project-local [verify-backlog](../.omp/skills/verify-backlog/SKILL.md) documents isolated launch, read-only diagnosis, real user journeys, evidence and cleanup. Its [feature map](../.omp/skills/verify-backlog/features/README.md) identifies relevant paths. [Maintenance](../.omp/skills/maintain-backlog-verification/SKILL.md) is explicitly invoked, not an automatic whole-project audit on every ticket. |
| Structured verification receipts | New runs report exact criterion, feature, entry point, method/command, outcome, details and recipe identity through `backlog_evidence`. These remain agent reports, not independently observed command execution. |
| Private run proof | Optional sanitized artifacts belong to the run, separate from requirement attachments. Downloads require authentication and check recorded size/hash. Proof survives run shutdown. |
| Durable review feedback | Request changes requires an explanation through ticket panel, board Actions or drag confirmation. Feedback remains linked to the reviewed run/revision and is included in subsequent authorized attempts. |
| Correct blocked shutdown | Host pauses goal continuation and stops owned child work without asking the model to complete an unmet goal. |
| Progress visibility | Run panel shows host-observed activity, deadline/budget and last reported session-token sample with its accounting basis. It does not infer percentage completion. |
| Operator reconciliation | Git changes or unavailable Git inspection create a persistent project gate. Operator reviews/reconciles through an explicitly confirmed local commit or in a terminal, then separately requests a clean recheck before new work can start. |
| Optional ticket drafting | New ticket retains its manual Markdown/import drawer. The sibling Create with agent action opens a dedicated Discuss / Review ticket page with an explicitly connected, capability-restricted OMP conversation, model/thinking controls and pasted file/skill context. Only reviewed explicit creation publishes a ticket; drafting never implements or approves it. |

### Agent-assisted creation

See [Create with agent](../README.md#create-with-agent-optional) for controls and limits. Conversation state is separate from ticket/run storage. Drafting uses a private startup namespace for audited OMP v18.12.6, disables executable discovery and model tools, resolves bounded selected context in host code, and escapes OMP's implicit file/model mention dispatch. Skills supply text only; their scripts cannot run. Normal execution retains its existing permissions and tools.

Model/thinking changes affect drafting only. PDF/Office and WebP remain explicitly reference-only unless replaced with readable input; unsupported context cannot silently disappear. Cancellation/errors preserve available output without replay. Drafting has no goal continuation, implementation evidence tools, approval or scheduler mutation.

Assisted creation stages the complete validated payload outside the watched ticket namespace and publishes atomically without overwriting an existing ID. Ten-minute confirmations bind payload hashes and current project mode; retries require the same unchanged publication. Automatic mode can admit a valid ticket after explicit creation, so its confirmation warns about implementation. Approved-only and Paused gates are unchanged. Manual creation/import remains available without OMP.

Verification for this addition: full Bun suite passed (70 tests, 628 assertions), changed-file ESLint and strict TypeScript passed. Isolated real-browser/live-provider drafting passed with `openai-codex/gpt-6.1-sol`, thinking `low`, clarification/follow-up, file/skill/text/image context, unsupported-PDF exclusion, editable Markdown/Preview handoff and complete three-attachment creation. Separate protocol-child browser checks covered cancellation, partial output, sanitized provider failure and unsaved navigation; these error fixtures are not live-provider failures. Real OMP executable-discovery positive-control/restricted-startup sentinel check passed without inference; the synthetic uncredentialed restricted profile itself returned a failed metadata snapshot, not provider-success evidence.

Private proof is retained under `/tmp/backlog-agent-smoke-PyWw4u/proof`. Browser smoke kept global scheduling paused and launched zero ticket implementation runs; it does not establish live implementation execution or exhaustive model/provider coverage.

The dedicated drafting-page UI was separately exercised in a real browser using actual Workspace/MarkdownEditor components and styles with an in-memory synthetic API: independent manual drawer and agent page, proposal handoff, retained unsent prompt/pasted file/human review edits across views, canceled overwrite, unresolved-context blocking, disconnect and route-unmount DELETE requests, canceled navigation and publication, and confirmed synthetic publication with the staged attachment. Desktop and 390px mobile surfaces were inspected; no horizontal document overflow was observed. Changed-file ESLint passed. This frontend smoke did not run OMP, validate real backend publication, or prove provider/process behavior; the earlier live-provider evidence above predates this layout change.

## Normal ticket lifecycle

```text
Create ticket with observable acceptance criteria and references
    ↓
Approve exact requirements revision
    ↓
Scheduler checks project/global permission, dependencies,
global execution slot, workspace handoff and Git status
    ↓
OMP receives immutable ticket/attachment snapshot
and reads applicable verification guidance/maps
    ↓
Investigate → implement → drive affected journeys
    └──────────── bounded fix/recheck on actionable failures
    ↓
Submit criterion receipts + optional sanitized artifacts
    ↓
Submit backlog_result → settle → stop owned work
    ↓
Needs review, never automatic Done
    ├─ Human accepts evidence → Done
    └─ Human requests changes + feedback → Ready for another attempt
```

The scheduler selects tickets; native OMP goal mode continues work within one ticket. There is no additional `/loop` or second scheduler. Only one ticket is active globally, and an observed paused run retains that slot.

Global Settings offers a discovered model dropdown and model-specific thinking levels, with explicit OMP defaults. Metadata discovery uses the restricted drafting profile and submits no prompt or goal; its default model can differ from normal execution configuration. Explicit thinking is checked and verified before a fresh run prompts; existing/resumed session thinking is preserved. These are global new-run settings, not per-ticket overrides. See [execution settings](../README.md#execution-model-and-thinking).

The v18.13.1 isolation update was checked against the [upstream v18.12.6…v18.13.1 changes](https://github.com/can1357/oh-my-pi/compare/v18.12.6...v18.13.1): discovery registry/root/plugin loaders remain unchanged, extension loading only adds realpath-based deduplication, and startup configuration still honors the restricted profile. Metadata-only discovery on installed v18.13.1 returned 18 models and exact `openai-codex/gpt-6.1-sol` selection with `off`, `low`, `medium`, `high`, `xhigh`, `max`. No provider inference or real ticket execution was exercised.

Verification for execution selectors: focused settings/drafting/runtime tests passed (24 tests, 332 assertions), and changed-code ESLint passed. A real browser rendered the actual Settings UI with synthetic API responses: model/thinking save, incompatible-level reset, discovery failure/explicit retry and mobile save-control reachability were exercised. Dark/Light desktop and 390px mobile were visually inspected, with no horizontal document overflow or recorded browser runtime errors. UI fixture proof is separate from installed-OMP metadata discovery and does not establish provider inference or real ticket execution.

Projects support Paused, Approved tickets only and Automatic execution permissions. Automatic is standing permission for eligible revisions, not a waiver of dependency, handoff, evidence or human acceptance gates. Dependencies require Done, not Needs review.

Markdown and requirement attachments determine the ticket revision. Changing them invalidates approval. A run retains its immutable snapshot, but proof from an older revision cannot accept newly edited requirements.

### Implementation and verification

Agent instructions require reading applicable project verification skills and relevant feature-map entries, then exercising affected entry points independently. One convenient UI route does not prove alternate routes. The host does not independently attest that the agent followed those instructions.

Agents must respect target repository check policy and time/token limits. Missing required setup or tools remain blocked/unverified; no automatic dependency installation, credential invention or weakened acceptance is authorized. Commissioning this app's verification skill does not commission a skill for every registered project.

### Completion and evidence gates

1. Record checks using `backlog_evidence`, with the exact run revision and criterion.
2. Report `passed`, `failed`, `blocked` or `not_run` honestly. Rechecking the same criterion/feature/entry point/method supersedes its earlier outcome; failures on different journeys remain unresolved.
3. Completion requires reported passing checks for every criterion and no unresolved failed/blocked/not-run checks among those submitted.
4. Submit `backlog_result` with exact revision and criterion-by-criterion evidence.
5. Host waits for settlement and observed owned-child shutdown before Needs review. A command exit, agent yield or success message alone cannot complete a ticket.
6. Human reviews evidence and visual/subjective requirements before Done.

These checks validate submitted coverage and reported outcomes, **not the truth of the reports or exhaustive feature-map coverage**. An agent can still make an unsupported claim; human review remains necessary.

Artifacts support simple png/jpg/txt/json filenames, up to 512 KiB each, 10 MiB per run and 100 receipts. Host records receipt identity/time and artifact bytes/hash, not semantic correctness. Downloads are forced attachments with safe-response headers. There is no automatic proof deletion; retention/deletion policy is separate.

Never submit credentials, cookies, sessions or other secrets as proof. Never upload verification output as requirement attachments: those are inputs, and changing them changes approval/revision. Existing runs without structured receipts remain readable as unverified legacy text evidence.

## Human review and corrective attempts

**Accept evidence → Done:** accepts only the current revision's run evidence. This releases dependency eligibility, not commit/merge/deploy permission or a workspace handoff gate.

**Request changes:** enter specific missing behavior or evidence. Blank feedback cannot be submitted; cancel leaves status unchanged. Confirmation returns the ticket to Ready, retaining the revision's approval. Feedback stays on the reviewed run/revision; later authorized attempts receive it, with older-revision context identified when applicable.

A new attempt still needs safe workspace handoff, execution permission, satisfied dependencies and the global slot. Status Ready is not a promise of immediate execution.

## Operator reconciliation

Selected policy: **operator-controlled reconciliation**, not automatic commits or per-ticket worktrees. The app now offers an explicitly confirmed local commit; terminal reconciliation remains available.

A project-level gate is recorded when initial admission finds Git changes, a stopped run leaves changes, interrupted-run recovery finds changes, or required Git inspection is unavailable. It blocks that project's new starts without consuming every queued ticket as a synthetic blocked run. Other projects can still use the global slot.

Home displays a warning. The project page shows the gate, affected files, originating run when available, and recovery instructions.

1. Review evidence, partial work and unrelated edits. Preserve them.
2. Reconcile in your terminal, or choose **Review & commit**: inspect HEAD-to-working-tree diffs/modes, select files, enter a message, review the exact selection, then explicitly Confirm commit. Selected working-tree versions replace any staged versions for those files; unselected staged/unstaged work is preserved. No push/reset/stash/worktree deletion or automatic agent commits. See [operator commit limits](../README.md#operator-controlled-local-commits).
3. Choose **Recheck workspace** and confirm. This performs authenticated, CSRF-protected Git inspection with optional locks disabled.
4. Only a clean observed workspace outside `.omp-backlog/`, with no running/stopping/paused work owning that workspace, can release the current gate. Stale gate IDs, dirty state and unavailable inspection are rejected.
5. Existing project/global permissions, dependencies and retry rules still apply. Clearing the gate may allow eligible queued work to start.

**Done, switching execution modes, and merely becoming clean do not clear a recorded gate.** Previously blocked tickets still require explicit retry. The scheduler checks Git again before each new start.

Git ignore rules still apply: this is not proof about ignored files or a security sandbox. Non-Git projects have no Git handoff/changed-file guarantee. Operator commits remain behind authentication/CSRF, revision-bound review, exclusive workspace-operation/index locks, and no owned run. Successful commit leaves the gate intact and does not wake the scheduler. No reconciliation of this repository or expense-tracker was performed while implementing this action; authorized commit checks use disposable repositories only.

## Blocked, failed, paused and interrupted work

- **Blocked:** submit partial evidence, exact unavailable prerequisite and required unblock action. Host pauses/stops continuation without falsely completing the goal. Preserve work and explicitly retry after resolving the prerequisite; dependents remain ineligible until Done.
- **Failed:** provider/check/execution errors or exhausted time/token budgets require review and explicit action. Limits are not silently increased.
- **Paused:** stops continuation, not side effects. Paused work retains the global slot; resuming preserves session/snapshot. Canceled questions remain unanswered, not consent.
- **Interrupted:** recovery checks surviving process identity/liveness before releasing ownership. Inspect partial work and explicitly retry; mutating actions are not automatically replayed.

Project/global pause prevents new starts; it does not stop an already active run. Use run pause to interrupt that work. Closing the browser does not stop execution.

## Safety and current limits

- Human owns final Done. Visual/subjective acceptance is not delegated to a green command.
- No automatic commits, stashes, resets, pushes, PR creation, merges, deployments or destructive cleanup are authorized by ordinary ticket execution.
- Owner sessions, CSRF, Host/Origin checks and private storage protect dashboard access. OMP itself runs with the backend OS user's permissions; projects are not sandboxes.
- Receipt methods, outcomes and recipe identities are agent-reported. Host currently attests storage/time/hash, not actual command execution or exact code/recipe/environment identity.
- Feature maps cover starter paths, not every feature. Each target project needs its own commissioned recipe.

## Verification performed

Implementation verification passed:

- ESLint for changed code; earlier core-slice verification also ran full-project ESLint.
- Focused deterministic suite: **15 tests, 153 assertions**, including evidence/access/integrity, blocked shutdown, feedback handoff and operator reconciliation. These counts describe the recorded implementation check, not a continuously refreshed CI status.
- Isolated browser journeys for login, project registration, ticket creation/approval/invalidation, receipt download, and review feedback through ticket panel, Actions and drag independently.
- Disposable Git/browser/protocol-fixture checks for canceled/dirty/clean rechecks, preserved synthetic output, gate persistence and retained global pause.
- Diff whitespace check; owned-process cleanup completed and private proof survived.

See [commissioning receipts](../.omp/skills/verify-backlog/features/README.md#commissioning-receipts) for paths and scope. Fixture reconciliation preserved generated files outside its disposable repository; no commits, stashes or resets were used, even in fixtures.

**Not established by the earlier execution/review checks:** live OMP ticket implementation, exhaustive feature-map coverage, independently observed agent checks, or permanent correctness after later edits. Those earlier delivery checks did not run strict typecheck or production build. The later optional-drafting addition above did pass strict TypeScript and live-provider drafting; that does not verify implementation execution. Passing a protocol-speaking child is not provider availability proof.

## Next adoption stages

1. Independently observed verification: approved check execution, exit status, bounded output and run/code/recipe identity. Failed or missing required checks must block completion without treating agent claims as host observations.
2. Explicitly authorized real OMP/provider smoke in a disposable project.
3. Full feature-map maintenance, with unverified prerequisites clearly recorded.
4. Opt-in onboarding and proven verification recipes for other registered projects.

Broader playbooks, independent reviewers and external automation remain separately scoped candidates. This guide grants no new execution or external-write permissions.
