# Autonomous ticket lifecycle: research and proposed workflow

> Historical pre-implementation research. The user subsequently authorized implementation; the opt-in local lifecycle is now described in [Current agent workflow](current-agent-workflow.md#autonomous-completion) and [PLAN section 12](../PLAN.md#12-opt-in-autonomous-local-completion). “Not implemented” below describes the research snapshot, not current code. Unexercised live-provider and sandbox claims remain unverified.

Research date: **2026-11-04**. This document answers whether OMP Backlog Web can run tickets through implementation, verification, independent review, local commit, and Done, while resolving ordinary blockers without routine human review. It also proposes the corresponding workflow and UI redesign. **Research and design only: none of the proposals below are implemented or authorized by this document.** No registered project was run, no upstream script was executed, no package was installed, and no commit, push, PR, merge, or deployment was performed. Local findings are a static source audit, not live-provider or browser verification.

**Scope correction:** the user's intended comparison is **pstack in Cursor, not Codex**. The report therefore uses current Cursor/pstack sources for the upstream comparison and keeps native OMP as the proposed execution runtime. No Codex migration is proposed.

## 1. Answer and authority boundaries

**Yes, this is technically achievable, with explicit project opt-in and enforced completion gates. No, the current application does not already do it, and installing pstack does not supply it.** Current OMP behavior deliberately ends successful execution at human review, prohibits agent commits, and requires operator-controlled reconciliation. pstack provides first-party autonomous workflow instructions; Cursor provides the underlying agent, automation, and permission capabilities. They do not establish an end-to-end OMP completion transaction without an intentional host implementation. [L1; L2; P2; P3; U1; U2]

The smallest useful target is:

> An opted-in, eligible ticket runs to a frozen candidate; required checks produce inspectable evidence; a separate nonauthor reviewer checks that candidate; bounded correction runs resolve demonstrated problems; the host creates one local completion commit for exactly that reviewed tree; the host records Done and releases dependents. Humans see completed work and genuine exceptions, not a standing approval queue.

That paragraph is a **proposal**, not shipped behavior. The following authority split should be explicit in both implementation and UI:

| Action | Proposed default under “Agent-reviewed + local commits” | Boundary |
| --- | --- | --- |
| Implement an eligible ticket | Allowed inside the ticket and project scope | Does not rewrite requirements or grant broader tools. |
| Run required verification | Allowed under commissioned project recipes | Unavailable or unproven checks remain unavailable, not passed. |
| Independent code/behavior review | Required before completion | Separate reviewer identity and artifact inspection, not the author's “looks good.” |
| Correct review findings | Allowed within bounded rounds and original scope | Changed candidate invalidates affected proof and review. |
| Local completion commit | Allowed after every completion gate passes | Exact owned files, reviewed tree, expected parent, no unrelated work. |
| Set Done | Host decision after verified local publication | Does not mean pushed, merged, released, or deployed. |
| Checkpoint/WIP commit | Separate, off by default | Never satisfies completion or releases dependents. |
| Push | Not allowed by this opt-in | Requires a separate explicit standing policy and credentials. |
| Create/update PR | Not allowed by this opt-in | External publication is distinct from a local commit. |
| Merge | Not allowed by this opt-in | Forge protections and independent current-code review remain separate. |
| Deploy, delete data, customer communication | Not allowed by this opt-in | Explicit action-specific authority and stronger controls required. |

pstack itself distinguishes these scopes. Babysit stops at merge-ready and says it does not authorize merging; Shipping requires independent per-PR verification before landing; Autopilot-full grants queue-scoped landing only after the operator's go; Autopilot-stack expressly does not merge; Benny stops at a draft PR and never merges or deploys. A generic request to “be autonomous” should not collapse those distinct grants into one permission. [P4; P5; P6; P7; P10]

**Safe blocker remediation: yes, conditionally. Universal autonomous unblocking: no.** Reversible, observable repairs within existing authority can proceed automatically and be reviewed. New credentials, security weakening, destructive repair, unclear ownership, genuine product decisions, and exhausted recovery bounds must escalate. This is not a reason to require human approval for every ordinary fix. It is a reason to encode the standing policy precisely. pstack's Orchestrate reserves real decisions and irreversible actions for the user, while directing the coordinator to handle retries, CI flakes, review triage, and ordinary mechanics itself. [P3; P4; P8]

## 2. Fresh upstream identity, version, and support

### Pinned observations

- `cursor/plugins` main resolved live to **`bb68f2365eceafa0cb2d253112f675acf5f144cc`** using the public Git remote. The inspected manifest at that revision is **pstack 0.15.36**, names **Lauren Tan** as author, and points to `cursor/plugins/tree/main/pstack`. The README introduces its author as **poteto** and links `x.com/poteto`. This is package attribution from its own sources, not proof that one person wrote every line. [P1; P2]
- The live path-scoped GitHub commit feed's newest pstack entry is **`c742dd61706fbacc1b95f1a20b7b988cf096ce6c`**, dated **2026-10-27T23:12:40Z**, titled “make Orchestrate agentic and delete the orch scripts.” The report pins inspected source links to the resolved main revision above rather than assuming older notes are current. [P0]

### Important changes since the existing research note

The older `docs/pstack-comparison-research.md` was used only for leads. **Its 0.15.32 snapshot is not the current snapshot.** In particular, do not design around the old `orch` CLI: current Orchestrate says to run with native `Task`, the Project tracker/store, and PR/CI event subscriptions when the harness has them; “Call no scripts, run no polling loops.” The upstream change explicitly removes the orch scripts. [P0; P3]

Current Autopilot-full also has more nuanced review reuse: full swarm at code-ready, another full swarm for major changes, a single verifier for rebase/conflict/minor fixes, and no verifier for wording-only changes. It requires green CI for each new head and current-code validity before landing. Shipping's patch/build-equivalence rules are careful workflow instructions, not a license to trust arbitrary stale proof. For OMP's initial implementation, exact candidate identity is simpler and safer than importing those equivalence exceptions. [P5; P6]

### Cursor-native workflow and the separate Claude Code adapter

| Host | What is actually present in first-party pstack source | What this does not establish |
| --- | --- | --- |
| Cursor | Native `pstack/` plugin; README installation and custom-mode/`/loop` instructions; workflows refer to Cursor Task, cloud agents, Bugbot, Automations, and optional control skills. | A packaged always-on ticket scheduler, OS isolation, or host-enforced quality gates. |
| Claude Code | Official generated `harness/pstack/claude-code/` tree; documented `/pstack:*` commands and tool/model/path mapping; generator explicitly targets `claude-code`. | Equivalent cloud isolation, model-family diversity, or Cursor-only features. Adapter maps cloud to worktrees and skips unsupported features. |

The Claude adapter's `readonly: true` mapping retains Bash and adds a no-edit instruction plus a status check; that is explicitly not the same thing as an enforced read-only filesystem. Non-Claude model slugs fall back to the session model, so requested cross-family diversity can disappear. As a brief host distinction only, the inspected official generated tree/generator contains a Claude Code target, not a Codex target. None of that changes the user's intended Cursor comparison or implies that OMP should migrate harnesses. [P2; P11; P12; P13]

## 3. What pstack really contributes

### Normative prompts versus executable guarantees

The manifest registers skills and agents. `poteto-mode` is an explicitly invoked skill with `disable-model-invocation: true`; it routes tasks to Markdown playbooks, directs the lead to own delegate results, and prescribes verification. These are meaningful agent instructions, **not an executable state machine or an authorization mechanism**. Current Orchestrate depends on the host's native tools and stores rather than providing a scheduler itself. This distinction is central to adapting the ideas responsibly. [P1; P3; P8]

| Source | Actual specified behavior | Relevant limit |
| --- | --- | --- |
| Poteto mode | Restate goal; ground nontrivial work; delegate deliberately; inspect actual delegate diffs; keep a trail for long autonomous tasks. Has broad reversible/external action language and an always-pause list. | Its autonomy language cannot override OMP policy, credentials, filesystem permissions, or explicit user fences. |
| Autonomous run | Define a falsifiable exit predicate; native Cursor `/loop`/watcher wake; smallest evidence-backed iterations; verify units; commit when progress advances; log each iteration; do not relax the predicate to claim success. | No universal total attempt/time/spend limit is specified. Do not import “keep going” as an unbounded retry policy. |
| Orchestrate | One owner per PR; fresh workers; separate-family nonauthor verifier at current head; inspect artifacts; durable native tracker/store; retry by cause, then drop/replan after two retries. | Markdown does not fence a late worker or atomically prevent stale writes. Host ownership and revision checks must do that. |
| Opening a PR | Worktrees; “commit liberally”; small ordered commits; cleanup before commit/review; forge selection; PR metadata. | Commits can precede final verification. It is not a completion-only commit contract. Its reset/dirty-worktree recovery prescriptions are unsuitable as unattended OMP defaults. |
| Shipping | Per-PR nonauthor runs parent versus head on a real surface; only contiguous verified stack prefix lands; check current patch/build validity; confirm actually merged into trunk. | Green CI, an approving bot, queued merge, and successful command exit are all expressly insufficient substitutes. |
| Autopilot-full | Operator gates first; one owner carries build to merge; separate root swarm; durable trails/pushes; refresh evidence for changed code; stop immediately on operator hold. | Its external pushes/merges are part of an explicit full-autopilot queue grant, not ordinary local ticket execution. |
| Pause safely | Explicit stop; cancel children; local `wip:` commit and off-context resume note, potentially noting broken tree. | A checkpoint is durability, not a verified completion or Done. |

Sources: [P3; P4; P5; P6; P8; P9; P14; P16].

### Independent review means more than another “PASS” string

Shipping is unusually explicit: only a verdict from an agent that **did not write the code** counts. That verifier runs the actual change as a user would, parent against head. CI and an approving bot review are not that verdict. Orchestrate asks for a different model family and current-head verdict; the coordinator reads the actual diff/artifact rather than relaying the worker's report. [P3; P5]

For an OMP adaptation, the resulting proposal is three separate records:

1. **Author evidence:** what the implementation agent says it ran or observed, preserving the current honest provenance.
2. **Execution evidence:** what a host-controlled runner actually executed against a recorded candidate, with command/recipe, exit status, logs, artifact hashes, and environment identity.
3. **Independent review:** what a fresh nonauthor session inspected and independently checked, its findings, disposition, and exact candidate identity.

A reviewer report remains a model judgment, not a mathematical proof. Another model family is a useful diversity option, not a guarantee of independence or correctness. The hard separation is that the reviewer did not author the candidate, cannot silently edit it while reviewing, and cannot approve a different tree. Passing checks and no findings should not imply unexercised visual, security, or production behavior. [P3; P5]

### Benny is a scoped automation pack, not universal autopilot

Benny's current README says its files are **dormant setup and automation sources**, not slash skills. Setup copies the pack, enables shared dependencies in the target project, keeps user-owned configuration outside it, commits secret-free setup before enablement, and separately reviews/enables the two Cursor automations. Their jobs are Slack issue triage and confirmed-bug repro with a possible bounded draft fix. [P10; P15]

Its strongest transferable safety patterns are:

- Freeze exact channel/thread coordinates; verify reply target before and after posting; coordinator owns external writes.
- Fail closed without configuration, required actions, a control adapter, or a matching feature-map path.
- Stop when a human owns the fix; switch to verification when a plausible existing PR/commit exists instead of racing it.
- Require twice-observed discriminating real-UI failure, independently reviewed media, and twice-correct patched behavior.
- Delegate editing only when tools and credentials actually exclude Slack writes; a prompt ban alone is insufficient.
- Bound repro/fix effort and scope; stop without a PR if evidence or regression gates fail.
- Make small ordered commits only where repository workflow permits; **draft PR only, never merge or deploy**. [P10]

Benny does not ship a generic OMP scheduler, a Slack/tracker integration for this repo, or a permission grant. Its preflight/dedupe instructions also do not make distributed posting and tracker creation an atomic exactly-once transaction. Import its scoped ownership/evidence approach, not its full integrations or its source-channel workflow. [P10; P15]

## 4. What Cursor supplies, and what remains a workflow contract

### Real background automation, separately configured authority

Cursor's official Automations documentation says automations run cloud agents on schedules or supported GitHub/GitLab/Slack/webhook/Linear and other events. Their configuration separates triggers, instructions, optional tools, repository context, activation, model, and execution identity. Repo-backed automations can open PRs; the PR creation tool is enabled by default. The PR-comment tool can approve, request changes, and dismiss reviews only when approvals are enabled. These are real platform capabilities, **not authority that OMP inherits by copying a pstack prompt**. [U1]

There are important configured-environment limits. An automation without a repository cannot edit code or open PRs. Source-control triggers have provider-specific coverage; fork PR triggers are generally unsupported apart from merged triggers. An MCP authentication failure can leave the run continuing without that server's tools. Connecting an MCP server exposes every tool it supplies, so tool/credential scope matters. Persistent memories can retain misleading or malicious input across runs. A workflow must fail its own required-capability gate instead of mistaking a surviving cloud run for full integration success. [U1]

Benny depends on that actual Cursor platform and separately configured Slack/tracker/control integrations. Poteto-mode's autonomous-run playbook depends on Cursor's native `/loop` wake; current Orchestrate depends on native Task, tracker/store, and subscriptions where the harness has them. OMP should adapt the roles and proof rules to **its existing scheduler and native continuation**, not recreate those Cursor integrations or add another timer to the same ticket queue. [P3; P9; P10; P15]

### Auto-review is tool-risk screening, not independent ticket acceptance

Cursor's current Run Modes documentation distinguishes **Auto-review**, **Allowlist**, and **Run Everything**. In Auto-review, allowlisted calls run immediately; supported other shell commands use the sandbox when possible; calls that do not use the sandbox go to a backend classifier. The classifier can make read-only source inquiries. A blocked call can lead the agent to a safer approach or to a user approval prompt. Run Everything executes every call automatically with no sandbox or classifier. Zero prompts therefore does not mean safe unattended completion. [U2]

The same official page expressly says **Auto-review is not a security boundary** and can make mistakes. The permissions reference says natural-language allow/block instructions are steering, not enforcement; allowlists are best-effort convenience, not a security guarantee. CLI permissions are separate from desktop permissions. Do not suggest broad `git`, arbitrary-shell, MCP wildcard, or Run Everything access simply to eliminate prompts. [U2; U3]

**Cursor Auto-review and pstack's independent code/behavior review solve different problems.** The former screens shell/MCP/Fetch calls; Shipping's verifier runs the change as a user would and must not be its author. An automatic tool approval cannot substitute for candidate-bound acceptance evidence or nonauthor review, and a quality reviewer cannot grant missing tool authority. [U2; P5]

### Sandboxing and Git: do not import another harness's rules

Cursor documents workspace read/write access for sandboxed terminal commands, with protected paths such as `.git/config`, `.git/hooks`, `.vscode`, `.cursorignore`, and sensitive Cursor configuration. Its network modes and sandbox configuration determine reachable domains; user/project/team policy precedence also matters. This is **not evidence that all `.git` writes are protected or that commits are universally blocked**, and no such claim is made here. Whether a particular commit command proceeds automatically depends on the actual Cursor mode, platform, and policy. pstack's commit instructions alone cannot establish that deployment's execution behavior. [U2; U3; P16]

On Linux, Cursor documents Landlock/seccomp requirements and an approval fallback when sandbox requirements are not met. No current-machine or target-project sandbox was exercised in this research. Local Cursor, Cursor cloud automation, and OMP's backend process are distinct execution contexts. Their isolation and credentials must be evaluated separately; current local product docs state OMP runs with the backend user's permissions. [U2; L2]

For OMP, the proposed deterministic publisher is grounded in **this repo's existing commit-tree/update-ref CAS implementation**, not an assumption about Cursor's Git restrictions. Keep model authors/reviewers out of unrestricted publication and expose only the narrow operation authorized by the standing project policy. This remains a design recommendation. [L4]

## 5. Current OMP Backlog Web: source-audited baseline

These findings were supplied by the main agent's current local audit and are cited to the code that owns them. They are **static findings, not exercised runtime behavior**. Exact line ranges are included so later implementation can recheck the current checkout.

| Area | Current behavior | Consequence for autonomous completion |
| --- | --- | --- |
| Admission | Eligible tickets exclude workspace handoff; only Draft/Ready are considered; approved mode needs exact-revision approval; dependencies require Done. [`runtime.ts:120–129`](../server/runtime.ts#L120-L129) | “Automatic” currently describes admission, not automatic completion. |
| Dirty state | Admission captures dirty state and records operator handoff. [`runtime.ts:190–203`](../server/runtime.ts#L190-L203) | Cannot silently sweep user changes into a ticket commit. |
| Terminal result | Settled complete becomes `needs_review`; blocked becomes `blocked`. [`runtime.ts:274–285`](../server/runtime.ts#L274-L285) | No shipped implement → independent review → auto-Done chain. |
| Agent authority | Objective prohibits commits, push, deploy, branch/reset operations; visual acceptance remains human; blocker suggestions are not authority. [`runtime.ts:477–489`](../server/runtime.ts#L477-L489) | Changing a prompt alone would conflict with existing product policy and enforcement. |
| Human actions | Exact-revision action guards; blocked recovery guards; Done requires `needs_review`, matching run, and evidence; change requests are explicit. [`api.ts:258–290`](../server/api.ts#L258-L290) | Autonomous completion needs an explicit host path with equivalent or stronger revision guards, not fabricated human feedback. |
| Reconciliation | Workspace recheck excludes active owners and dirty state. [`api.ts:208–223`](../server/api.ts#L208-L223) | Recovery must preserve ownership and handoff semantics. |
| Evidence | Receipt source is `agent_report`; checks cover submitted latest passes for every criterion. [`evidence.ts:17–29`](../server/evidence.ts#L17-L29), [`51–61`](../server/evidence.ts#L51-L61) | Current validation is not proof the host executed the check or that it describes an exact tree. |
| Local commits | Handoff/no-active-owner guard; reviewed snapshot expiry; explicit confirmation/message/files; commit-tree and update-ref CAS; handoff preserved; partial publication failure reported. [`workspace-commit.ts:25–28`](../server/workspace-commit.ts#L25-L28), [`177–184`](../server/workspace-commit.ts#L177-L184), [`213–223`](../server/workspace-commit.ts#L213-L223) | Reuse Git safety internals, but do not silently repurpose an operator-confirmation route as autonomous authority. Do not blindly retry partial publication. |
| UI | “Automatic” label describes eligible starts; handoff offers Review & commit / Recheck workspace; ticket actions include manual changes/Done; blocker recovery requires a note-bound human confirmation. [`Workspace.tsx:31`](../src/Workspace.tsx#L31), [`124–138`](../src/Workspace.tsx#L124-L138), [`427–428`](../src/Workspace.tsx#L427-L428), [`TicketBoard.tsx:249–250`](../src/TicketBoard.tsx#L249-L250), [`BlockedRecovery.tsx:44–70`](../src/BlockedRecovery.tsx#L44-L70) | Current interaction is intentionally human-in-the-loop. An autonomy feature needs an explicit UX contract, not just removing buttons. |

The written product policy agrees: [`current-agent-workflow.md:119–163`](current-agent-workflow.md#L119-L163) selects operator reconciliation, human Done, no automatic commits, explicit blocker retries, and honest agent-reported receipt provenance. [`PLAN.md:15–17`](../PLAN.md#L15-L17) retains fresh sessions, human completion, and no auto-commit. These must be intentionally revised during a future authorized implementation, not treated as accidental obstacles. [L1; L2; L3; L4]

## 6. Proposed smallest architecture, not shipped

### One lifecycle owner; no second scheduler

**Existing foundation, statically audited:** [`runtime.ts:614–680`](../server/runtime.ts#L614-L680) has one scheduler cycle and serialized reconciliation pump. It excludes an existing active/paused/claimed slot, selects fairly, checks workspace/eligibility, atomically claims the exact ticket revision, and launches without blocking the pump. Startup/periodic reconciliation is at [720–722](../server/runtime.ts#L720-L722). The objective expressly says the web scheduler owns selection and forbids `backlog-worker` or `/loop` at [479](../server/runtime.ts#L479). This is the scheduler to extend, not duplicate.

**Existing native continuation, statically audited:** [399–405](../server/runtime.ts#L399-L405) enables RPC goal continuation in a private overlay and launches `rpc-ui` with a persisted session file. [424–433](../server/runtime.ts#L424-L433) requires durable session ID/file and the same identity on resume. [495–518](../server/runtime.ts#L495-L518) sends the prompt and uses native goal `create` or `resume`; [524–542](../server/runtime.ts#L524-L542) observes state/stats every three seconds and checks identity. That observation polling is not a separate agent execution loop. [274–287](../server/runtime.ts#L274-L287) requires a valid actual `backlog_result` for settlement; a session simply stopping does not establish completion.

**Existing recovery, statically audited:** [554–599](../server/runtime.ts#L554-L599) compares persisted PID/start/boot identity with Linux `/proc`, signals only a matching surviving process group, keeps uncertain ownership stopping, and otherwise marks interrupted without replay. [683–698](../server/runtime.ts#L683-L698) requires an observed stopped PID and exclusive slot before resuming the immutable ticket snapshot. [725–732](../server/runtime.ts#L725-L732) clears timers/watchers, waits for the pump, and interrupts active work during shutdown. Preserve and extend those identity safeguards to reviewer roles and publication rather than replace them with an agent's status text.

Extend the existing scheduler/runtime to own **one durable ticket attempt across its phases**. Use its native OMP continuation for implementation and corrective work; start a fresh independent OMP reviewer session for review. The same scheduler admits/wakes/reconciles both roles. Do not introduce a separate coordinator daemon, polling loop, Cursor loop, queue framework, or second global slot.

A small lifecycle module should hide transition validation, authority checks, proof invalidation, and publication reconciliation behind one internal interface. UI and worker reports submit events; neither directly writes Done or grants itself Git authority. Keep the existing runtime/store as the source of truth rather than a parallel agent-maintained Markdown ledger. This is a design recommendation, not evidence that these phases already exist.

Proposed happy path:

```text
Ready → Implementing → Verifying → Independent review → Local commit → Done
                         ↑              |
                         └─ Correcting ─┘
```

Proposed exceptional paths:

```text
any active phase → Diagnosing blocker → bounded authorized recovery → prior phase
                                      └→ Needs assistance
any active phase → Paused / Interrupted → reconcile ownership and side effects
publication uncertain → Reconcile publication → Done or Needs assistance
```

Keep board-level statuses coarse. Most phases are run/lifecycle metadata, not six new draggable board columns. Dependencies continue waiting for Done, not an author's “complete,” a review start, or a WIP commit. Existing Human-reviewed behavior remains the default for projects that do not opt in.

### Versioned standing policy, distinct from execution mode

Add an explicit project lifecycle policy with two choices:

- **Human-reviewed:** preserve today's completion/commit interaction.
- **Agent-reviewed + local commits:** authorized tickets complete without routine human acceptance or commit confirmation, once deterministic gates pass.

Do not reuse `paused` / `approved` / `automatic` as the lifecycle policy. Those decide which tickets may start; the new policy decides how an admitted ticket may finish. Snapshot the exact policy revision at admission, together with ticket revision, verification recipe revisions, scope, budgets, allowed local effects, and reviewer requirements. Record the policy decision, actor, timestamp, and effective scope. Editing the policy is a real settings action, not something a ticket agent may do.

The opt-in should state its local-commit authority and limits once, clearly. Routine tickets then need **no per-ticket human approval** unless start mode separately requires approval. Policies can exclude sensitive paths/actions and require human decisions for genuine exceptions. Disabling autonomy prevents new privileged transitions and safely holds affected in-flight work; it must not be interpreted as retroactive approval or silently leave already granted external actions running.

### Immutable candidate and meaningful proof

Before review, freeze a candidate identity containing at least:

- Project/repository identity; ticket ID and immutable ticket revision; lifecycle-policy revision.
- Attempt ID, current role/run/session ID, ownership generation, and cancellation generation.
- Baseline parent commit and branch/ref; candidate Git tree or a reproducible content-addressed tree snapshot, including tracked modes and included untracked files.
- Explicit owned-path manifest and initial cleanliness observation; artifact locations outside the candidate.
- Required verification recipe/version, environment/dependency identity where material, and criterion IDs.

A ticket revision is not a code revision. A `HEAD` SHA is not the uncommitted working tree. A hash of a report is not proof of code execution. Preserve all three distinctions in storage and UI. Hash the actual candidate before and after each no-edit phase. If code, requirements, policy, required recipe, or a material environment changes, invalidate affected evidence/review and rerun rather than silently carrying a pass forward.

For the first release of this proposed design, **require an exact candidate match** instead of pstack's sophisticated patch/build-equivalence exceptions. No need to create a completion commit before review: use the frozen tree identity for review, then have the publisher create the commit from that exact tree. An author/session claiming “I am done” requests the next phase, not Done.

### Verification and reviewer separation

Commission a project verification recipe before advertising autonomous completion for behavior requiring it. The host should distinguish a runner's execution receipts from agent-entered descriptions. Store command/recipe identity, actual exit/result, start/end, candidate identity, and content-hashed output/artifact pointers. Independently confirm the observation needed for each criterion; a command returning zero is only evidence for what that command actually tests.

Run the reviewer in a fresh session that did not author this candidate. Give it original requirements, frozen base/candidate diff, relevant source context, required recipes, and raw evidence rather than the author's final persuasive summary alone. Deny application edits, commit/push, policy changes, and unrelated credentials. A real behavior verifier may need constrained scratch writes or an owned app instance; do not misleadingly call that an entirely read-only process. Keep its product checkout immutable and isolate its runtime state.

The reviewer returns structured **Pass / Changes required / Inconclusive**, findings tied to code/criteria, and evidence it independently inspected or reproduced. The host validates session role and exact candidate identity. A same-provider fresh session is still a separate reviewer, but label provider/model identity honestly; do not promise cross-family diversity if configured models cannot supply it. High-risk projects can require stronger review lanes by standing policy without forcing every ordinary ticket through an unnecessary panel.

### Bounded corrections and safe blocker recovery

Suggested initial policy defaults, to be tuned with measured project behavior: **two correction rounds**, **one cause-specific infrastructure retry**, and existing time/token limits retained across the whole lifecycle rather than reset per role. Add an explicit no-progress limit and cancellation checks. These are proposed defaults, not pstack or current OMP guarantees.

| Observation | Proposed automatic action | Escalate when |
| --- | --- | --- |
| Demonstrated candidate bug or missing acceptance evidence | Return concrete finding to author; correct; freeze new candidate; rerun affected checks/review. | Bounds exhausted; product intent ambiguous; repair exceeds ticket/policy scope. |
| Known transient infrastructure failure | One cause-specific retry/backoff inside the total budget. | Same failure repeats, identity uncertain, or service remains unavailable. |
| Owned stale local process/port conflict | Stop/restart only an identity-confirmed process created by this attempt. | Process belongs to another user/run or ownership cannot be proven. |
| Required dependency unavailable | Use already authorized project setup/locked dependencies in isolated scope. | New install authority, network target, system package, credentials, or privileged host changes are required. |
| Dependency ticket unfinished | Keep waiting; scheduler can run other eligible work. | Dependency cycle/invalid requirement requires a real decision. |
| Reviewer finding disputed | Independent reviewer checks the concrete disproof; retain disposition. | No defensible evidence, substantive unresolved disagreement, or budget exhausted. |
| Verification recipe appears wrong | Diagnose separately; preserve old proof; repair only under explicit policy, then revalidate sensitivity independently. | Proposed repair weakens a gate/property or broadens permissions without authority. |
| External/manual edit or branch movement | Stop mutation; preserve work; identify drift. | Never auto-stage/reset/stash/overwrite unknown work to clear the way. |
| Credential, security denial, destructive action, or genuine preference call | Surface one actionable exception with evidence and safe alternatives. | Do not retry by bypassing controls or ask another agent to approve its own missing authority. |

A blocker agent is a diagnostician and repair proposer/executor **inside existing authority**, not a permission issuer. Recovery must not turn a failed test into success by disabling it, soft-failing it, reducing coverage, changing the acceptance predicate, increasing limits, or modifying the standing policy. A recovered blocker receives independent evidence/review appropriate to its effect. Other projects/tickets may proceed when workspace and scheduler ownership permit.

Do not universally promote every small environment repair into another ticket or PR. Keep authorized, bounded recovery within the attempt; separate only genuinely distinct product changes. Avoid endless “review the recovery reviewer” chains: one policy gate, one author/corrector, and one independent reviewer suffice for routine work.

### Clean/dirty ownership and local publication

Retain clean admission as the minimum supported autonomous path. **Dirty on admission means preserve and require assistance, not “commit everything.”** Do not call a dirty-workspace gate resolved just because an agent says it owns the files. Capture clean baseline, reserve the workspace through author/check/review/publication, and detect later manual edits. Ignored files and external state require explicit ownership/exclusions; Git cleanliness is not a sandbox.

Reuse the existing commit implementation's safe primitives, not its human-only request contract. The proposed autonomous publisher accepts a previously authorized completion record rather than `confirmed: true` invented by an agent. It should:

1. Check current standing authority, cancellation state, ticket/policy revisions, owner generation, expected ref/parent, exact candidate tree, and all required independent gates.
2. Reject unexpected files/modes/staging/ref drift. Never use a broad `git add .` or absorb unrelated staged work.
3. Create the local commit from the frozen candidate with a persisted operation ID and commit metadata, then update the expected ref using compare-and-swap.
4. Confirm the published commit's parent/tree and reconcile the selected workspace/index safely without overwriting foreign edits.
5. Durably record commit ID and publication state, then transition to Done. Release only this lifecycle's verified ownership/gate; a pre-existing operator handoff is never implicitly cleared.

For the smallest first implementation, a truly clean start and exclusive workspace ownership make the completion commit straightforward. Per-ticket worktrees are an optional later isolation choice, not an excuse to add a second scheduler. Do not force auto-publication through the current modal's snapshot-expiry/explicit-confirm route or remove those protections from Human-reviewed mode. Existing commit failures that may have partially published require reconciliation, not blind retry. [L4]

**No-op completion needs an explicit product rule:** a ticket whose required behavior already exists may legitimately have no code change. Proposal: record independent proof and `Done · no changes required`, without an empty commit. If the product requires every ticket to have a commit, exclude no-op tickets from autonomous completion until that policy is defined rather than manufacture a meaningless change.

### Crash recovery, idempotency, and stale-worker fencing

Persist phase intent **before** dispatching a role or performing a commit. Use existing durable state and one scheduler, with a stable operation key such as `(project, ticketRevision, attempt, phase, candidateTree)`. An execution receipt, review outcome, and publication record reference the same identity. Reject late callbacks for a different attempt/candidate/owner generation. A stale worker must be technically unable to publish, not merely instructed to stop.

On restart, reconcile reality before reissuing work: live process/session identity, owned child processes, files/tree, candidate artifacts, current ref, and any existing commit-publication intent. Persist author identity and timestamp for commit creation so retries can converge on the intended object rather than make duplicates. The decisive publication check is ref/parent/tree plus durable operation identity, not a matching commit message.

Git ref updates and application-state writes are not a single atomic transaction. Account explicitly for:

- Intent recorded, no commit/ref effect: safely resume under the same identity after rechecks.
- Commit object exists, ref not moved: inspect expected parent/tree and retry only the CAS step if still valid.
- Ref moved to intended commit, Done not recorded: reconcile the existing publication and record Done; do not create a second commit.
- Ref moved elsewhere, or workspace reconciliation uncertain: preserve data and create an actionable exception.
- Done recorded but later ref/history changed externally: show commit/history drift; never silently recreate or rewrite history.

Cancellation/pause revokes future phases and publisher authorization, fences callbacks, and stops only owned processes. It cannot undo arbitrary external side effects already executed. Do not automatically replay mutation just because an agent process died. Exactly-once model execution is unnecessary and unrealistic; aim for at-most-one accepted publication and idempotent state reconciliation.

## 7. Proposed UI and operator experience, not shipped

### Direction: an exception-driven developer workspace

Retain the existing compact, full-width Ant Design board and theme language. The defining improvement is **“I see progress and results; I act only on exceptions.”** Do not turn the app into a chatbot page, approval wizard, or a second CI dashboard. Existing IBM Plex, square borders, semantic theme tokens, 24px/700 route titles, 13px/400 standard controls, native 32px sizing, minimal motion, and keyboard/mobile behavior remain authoritative. [L5]

### Project header and settings

Show two plainly named controls, not one overloaded “Automatic” setting:

- **Start policy:** Paused / Approved tickets only / Start eligible tickets automatically. Existing admission semantics remain.
- **Completion policy:** Human-reviewed / Agent-reviewed + local commits. Distinct setting with a concise visible authority summary.

Place the detailed lifecycle policy in the existing project/settings form conventions: allowed scope, verification recipe readiness, reviewer/model choice, correction/recovery bounds, and commit authority. A one-time explicit enablement confirmation states: “Agents may implement eligible tickets, verify, request independent review, create local commits, and mark Done. They may not push, open PRs, merge, or deploy.” Do not show this confirmation for each ticket afterward.

Keep external authorities as separately named future settings, off by default, rather than a broad “full access” switch. Display **Local only · Push off · Merge off · Deploy off** in a compact disclosure/summary where useful. Show policy revision and who changed it in audit details. If the project cannot supply required verification or isolation, explain the missing prerequisite before enabling, not after silent ticket failures.

### Board/list and progress

Keep the existing board/list switch and ticket navigation. Cards retain title, priority/dependencies, and coarse status; add a compact textual phase such as **Implementing**, **Verifying**, **Independent review**, **Correcting 1/2**, **Recovering**, or **Committing locally**. An agent is not Done because its last tool returned or because it submitted a report. Never use a green completion badge before final publication/state reconciliation.

For opted-in projects, routine `needs_review` should be an internal independent-review phase, not the human queue it is today. Human-reviewed projects keep their current controls. Do not reuse a human-only endpoint with fake approval events. Surface “Waiting on dependency” and “Recovering automatically” as honest waiting/progress states, not urgent human blockers.

Add a compact **Needs assistance** count/filter near the board toolbar. Keep genuinely actionable exceptions visually distinct from the ordinary In progress and Done lanes. If autonomous completion succeeds, show **Done · committed locally**, short commit ID, completion time, and a link to exact review/evidence. A no-change result says **Done · no changes required**. A checkpoint says **Checkpoint only · not completed**.

### Ticket/run detail

Reuse the current drawer/run page, existing Transcript / Evidence / Files / Usage tabs, and existing review safeguards. Add a compact stage strip above them with current phase and last real progress time, not speculative percent complete. A short completion summary answers:

- What changed against the ticket's goal?
- Which candidate/tree and ticket/policy revision were checked?
- What actually executed, what was only agent-reported, and what was not verified?
- Who authored and who independently reviewed it; review result and resolved findings?
- What local commit was created, with parent/tree and operation identity available in details?
- What was **not** done externally?

Group review findings by open/resolved/disproved with evidence-linked dispositions. Show corrective/recovery attempt counts and the remaining bound. Artifacts missing or expired must remain visible as missing; never keep an unqualified “verified” label after its basis is invalidated. Source provenance remains explicit: “Agent-reported,” “Host-executed,” and “Independent review” are different labels.

Keep **Pause this run** distinct from **Pause new starts** and from **Disable autonomous completion**. Explain each consequence. Do not make **Done** a routine required button in autonomous mode. Preserve human override/correction as a deliberate exceptional action with an audit reason, not an invisible pass.

### Exception Inbox and blocker recovery

The Exception Inbox is for events that need user help, not every unsuccessful tool call. Each item should provide a short, actionable briefing:

1. The missing decision/prerequisite and why policy cannot resolve it.
2. The exact ticket/run/revision and preserved workspace/commit state.
3. What the agent already tried, the concrete outcomes, and attempts exhausted.
4. The narrow requested action and its consequences.
5. A recommended safe next step, with evidence and alternatives in a disclosure.

Possible contextual actions are **Provide missing information**, **Choose behavior**, **Review unexpected workspace changes**, **Authorize this specific setup action**, **Retry after correction**, and **Stop ticket**. Do not offer a generic “Approve everything” or count a note save as authority. An action against stale ticket/policy/candidate identity must reject with a comprehensible refresh/reconcile path.

When recovery is already authorized, the app does the diagnosis and repair itself, labels it **Recovering automatically**, and returns to verification/review without a confirmation modal. After an exception is resolved, resume only the necessary phase under current revision/policy, preserving the prior failure trail. Do not rerun completed product work blindly, release unrelated workspace handoffs, or silently reset the lifetime recovery budget.

### Accessibility and presentation constraints

Use existing Ant Design `Tag`, `Steps` or a compact equivalent, `Tabs`, `Alert`, `Drawer`, `Form`, `Collapse`, and existing dialogs rather than a new design system. Use semantic text/icons in addition to color; reserve warning/danger for actual risk. No decorative animation, new fonts, or dependency-heavy visualization. Keep primary actions reachable on short/mobile screens; wrap header controls; retain bounded readers, focus outlines, unsaved-change protection, and understandable keyboard navigation. Required design verification later includes dark/light desktop/mobile, phase and exception transitions, stale-action rejection, and clear local-versus-external authority. This document does not claim those checks were performed. [L5]

## 8. Recommended cutover and acceptance conditions

This is a proposed sequence, not authorization to implement or start work:

1. Preserve Human-reviewed as default; define explicit project standing policy, immutable candidate/proof/review identities, and deterministic completion rules.
2. Extend the existing scheduler/runtime/store through verification, independent review, bounded correction/recovery, and publication reconciliation. Keep native OMP execution and one ownership path.
3. Add host-observed verification where needed; preserve honest agent-report provenance; commission recipes rather than relabeling existing receipts.
4. Reuse safe Git publication internals behind a separately authorized autonomous path, leaving operator confirmation/reconciliation intact for its existing use.
5. Add the project policy split, stage metadata, result summary, and exception inbox using existing UI conventions. Migrate old labels/contracts deliberately rather than leave two contradictory meanings of Automatic or Done.
6. Only a future explicitly authorized pilot on an isolated/disposable or designated project should exercise the whole path before enabling it broadly. No pilot was run for this research.

Required future acceptance scenarios:

- Eligible opted-in ticket completes implementation → verification → nonauthor review → exactly one correct local completion commit → Done with no routine human action.
- Human-reviewed projects retain their existing behavior; start policy and completion policy vary independently.
- A demonstrated reviewer finding causes bounded correction and fresh relevant proof; author's self-pass cannot bypass review.
- Wrong/missing criterion, inconclusive evidence, stale recipe, changed candidate, or reviewer mismatch cannot complete.
- Recoverable setup/infra issue is resolved within policy without spamming the human; unowned process, missing authority, or exhausted bounds creates one actionable exception.
- Dirty initial workspace or concurrent foreign edits are preserved; no broad staging/reset/stash or accidental unrelated commit.
- Stop, cancellation, policy revocation, stale callbacks, and late workers cannot publish.
- Crash before and after ref publication reconciles without duplicate commits or falsely marking Done; partial publication gets explicit treatment.
- No-op completion is honest; checkpoint commits never count as completion; dependents wait for Done.
- Local completion does not push, create a PR, merge, or deploy; credentials are absent where not needed.
- Dark/light, mobile, keyboard, stale-action and empty/error states communicate progress, authority, evidence provenance, and next action correctly.

## 9. Strongest evidence, limits, and unresolved decisions

### Strongest evidence

1. **Current local source deliberately prevents the requested lifecycle today.** Complete becomes `needs_review`; the objective forbids commits; operator publication is explicitly confirmed; Done is human-controlled. This is an intentional workflow redesign, not a hidden setting to enable. [L1; L2; L3; L4]
2. **pstack expressly supports autonomous implementation/review/landing within a grant**, and its shipping contract rejects author-only verification, bot approval, and green CI as substitutes for independent real-surface proof. It also distinguishes no-merge and draft-only workflows. [P3; P4; P5; P6; P7; P10]
3. **Current pstack Orchestrate now favors host-native tools, not its old CLI.** This supports adapting its ideas to the existing OMP scheduler rather than importing obsolete orchestration. [P0; P3]
4. **Cursor supplies genuine cloud automation, but tool approval is not ticket acceptance.** Automation configuration controls repository/tools/identity; Run Modes control execution; pstack supplies nonauthor behavior-verification instructions. These are separate layers, none automatically inherited by OMP. [U1; U2; P5]
5. **This repo already has the right native orchestration foundation.** Exact-revision admission, one serialized scheduler, persisted native goal/session continuation, process-identity recovery, and CAS Git publication are a better starting point than importing another scheduler. The proposed lifecycle adds enforced phases and evidence, not a new agent runtime. [L1; L4; native source ranges in section 6]

### Unresolved product/security decisions

These are design choices for future implementation, not facts discoverable by running the current app:

- Which projects/ticket categories may opt in, and which sensitive paths/effects remain excluded? Is visual acceptance delegated to commissioned behavior/visual lanes, or an exception for designated subjective tickets?
- What exact verification recipes and environment identities are sufficient for each project, and which are host-executable versus necessarily agent-driven? No real-project commissioning was performed here.
- Should a no-change ticket complete with evidence and no commit, as recommended, or remain an explicit exception?
- What local branch/ref receives completion commits, and can a policy ever allow pre-existing dirty state? Recommendation for the smallest version: existing intended local ref, clean-only admission, preserve all foreign work.
- What hard time/token/spend/no-progress limits and reviewer diversity are appropriate? The suggested two correction rounds/one infra retry are conservative proposed defaults, not measured settings.
- What actual execution isolation can native OMP enforce? Selecting a model or copying Cursor prompts does not supply Cursor's sandbox. Current product docs say OMP runs with the backend user's permissions. Host authorization and OS/tool isolation require a concrete implementation, not prompt-only claims. [L2; U2]
- What retention, redaction, and disk limits apply to raw logs, media, snapshot trees, and reviewer evidence? These can contain private project data even when they stay local.

### Retrieval and evidence limitations

GitHub REST API reads for repository/commit metadata returned HTTP 403. The research recovered public identity/source through GitHub pages, the repository's commit feed, raw pinned files, and read-only `git ls-remote`; it did not install or execute upstream code. Cursor product documentation is live and can change after this date; the pinned pstack revision need not match an installed plugin. No Cursor mode, classifier, cloud automation, pstack workflow, real agent session, registered-project app, integration, browser smoke, build, lint, formatter, or test was exercised. In particular, no source-only finding proves that an unattended Cursor deployment handles a given blocker safely or that its reviewer cannot edit code. This report establishes source-specified behavior and a proposed OMP design, not a completed autonomy implementation.

## Sources

Every P-source below is first-party `cursor/plugins` content pinned to the inspected main revision unless marked live feed. Every U-source is live official Cursor documentation. Local L-sources are the current repository's owning source/docs; their audit is static.

### pstack

[P0]: https://github.com/cursor/plugins/commits/main/pstack.atom
[P1]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/.cursor-plugin/plugin.json
[P2]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/README.md
[P3]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/skills/poteto-mode/playbooks/orchestrate.md
[P4]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/skills/poteto-mode/playbooks/babysit.md
[P5]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/skills/poteto-mode/playbooks/shipping.md
[P6]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/skills/poteto-mode/playbooks/autopilot-full.md
[P7]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/skills/poteto-mode/playbooks/autopilot-stack.md
[P8]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/skills/poteto-mode/SKILL.md
[P9]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/skills/poteto-mode/playbooks/autonomous-run.md
[P10]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/automations/benny/skills/reproduce-and-fix-issues/SKILL.md
[P11]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/docs/harness/claude-code.md
[P12]: https://github.com/cursor/plugins/tree/bb68f2365eceafa0cb2d253112f675acf5f144cc/harness/pstack
[P13]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/scripts/generate-pstack-harness-trees.mjs
[P14]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/skills/poteto-mode/playbooks/pause-safely.md
[P15]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/automations/benny/README.md
[P16]: https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/skills/poteto-mode/playbooks/opening-a-pr.md

- **P0:** [Live pstack commit feed][P0]; [October 27 Orchestrate deletion commit](https://github.com/cursor/plugins/commit/c742dd61706fbacc1b95f1a20b7b988cf096ce6c).
- **P1–P2:** [Manifest/author/version][P1]; [README/identity/install/host claims][P2].
- **P3–P9:** [Orchestrate][P3]; [Babysit][P4]; [Shipping][P5]; [Autopilot-full][P6]; [Autopilot-stack][P7]; [Poteto mode][P8]; [Autonomous run][P9].
- **P10–P16:** [Benny repro/fix contract][P10]; [Claude Code adapter][P11]; [Generated host tree][P12]; [Host generator][P13]; [Pause safely][P14]; [Benny README/setup][P15]; [Opening a PR/commit instructions][P16].

### Cursor platform

[U1]: https://cursor.com/docs/cloud-agent/automations.md
[U2]: https://cursor.com/docs/agent/security/run-modes
[U3]: https://cursor.com/docs/reference/permissions

- **U1:** [Automations: triggers, tools, repository context, identity, limits][U1].
- **U2:** [Run Modes: classifier, sandbox, protected paths, platform requirements][U2].
- **U3:** [permissions.json: precedence, steering versus enforcement, separate CLI rules][U3].

### Local owning source

[L1]: ../server/runtime.ts#L120-L129
[L2]: current-agent-workflow.md#L119-L163
[L3]: ../server/api.ts#L258-L290
[L4]: ../server/workspace-commit.ts#L177-L223
[L5]: design-language.md#L1-L40

- **L1:** [`server/runtime.ts`](../server/runtime.ts), ranges 120–129, 190–203, 274–285, 477–489 as itemized above.
- **L2:** [`docs/current-agent-workflow.md:119–163`][L2]; [`PLAN.md:15–17`](../PLAN.md#L15-L17).
- **L3:** [`server/api.ts:258–290`][L3] and [208–223](../server/api.ts#L208-L223); [`server/evidence.ts:17–29`](../server/evidence.ts#L17-L29), [51–61](../server/evidence.ts#L51-L61).
- **L4:** [`server/workspace-commit.ts:177–223`][L4] and [25–28](../server/workspace-commit.ts#L25-L28).
- **L5:** [`docs/design-language.md:1–40`][L5], [58–82](design-language.md#L58-L82); local UI ranges itemized in section 5.
