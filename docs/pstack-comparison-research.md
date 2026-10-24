# Full pstack research and comparison

## External-source research

Source date: **October 24, 2026**. Scope: official upstream pstack, not this application's implementation. This section intentionally leaves **local project comparison to the parent researcher**, who audits the repository independently and appends that comparison. No local application source was audited for this section. No implementation, PLAN edit, installation, live app verification, automation creation, or upstream script execution was performed.

### Snapshot and attribution

The inspected snapshot is `cursor/plugins` commit **`e73df471cd4bd918367e99f3dd9c51bd53ddf5f0`**, the latest commit returned for `path=pstack`, committed October 23, 2026 at `22:56:09Z`. Main resolved to `9580c23696ac8d7abed0c166f2f9918800afb819`, October 24 at `03:27:39Z`. Both commits contain the **identical pstack tree `880564357e051d7c7802da1cb5d8df1d0b008299`**. Thus the earlier, fully inspected commit is also the current pstack content observed on the source date. Citations below pin that inspected commit unless explicitly labeled live documentation. [T]

The plugin version is **0.15.32**. Both manifests identify **Lauren Tan** as author; `LICENSE` says `Copyright (c) 2026 Lauren Tan`; README introduces the speaker as **poteto**. “Laurent Tan” is not the name in these primary sources. This supports package attribution, not a claim that one person authored every contribution. The inspected commit itself includes a coauthor trailer. MIT permits adaptation subject to preserving its notice and license in copies or substantial portions. [M; R; L; T]

**Core finding:** pstack is an explicitly invoked engineering-workflow library with some real command-line tools, not an always-on scheduler, verification oracle, permission system, or completion-enforcement hook. Its strongest portable contribution is the relationship between task, independent review, real-artifact proof, and durable evidence. Installing its prompts does not implement those guarantees. [M; MODE; TOOLS; V]

### Complete component census

The pinned recursive tree contains **200 files under `pstack/`**, including seven images and one Bun lockfile. Runtime-facing contents are **58 registered skills**, **23 poteto-mode playbooks**, **two agent definitions**, and the dormant Benny pack's **three additional instruction files**. The latter are not registered slash skills. Only `setup-pstack` among the 58 top-level skills omits `disable-model-invocation: true`; the other 57 require explicit invocation or deliberate reading/routing by the active workflow. [T; M; SK; B]

| Component class | What actually ships |
| --- | --- |
| Manifests | `plugin.json` and `.cursor-plugin/plugin.json`. Same name/version/author/license; Cursor manifest registers only `./skills/` and `./agents/`, plus logo/category/tags. |
| Slash commands | The skills below provide slash-command entry points. **No separate `commands/` tree or command implementations** exist. The 23 playbooks are not slash commands. |
| Agents | `agents/poteto-agent.md`, `agents/comment-sicko.md`. |
| Hooks/lifecycle registration | **No `hooks/`, `hooks.json`, lifecycle hooks, startup daemon, installed stop-hook, or precommit enforcement** in this plugin tree/manifest. “Before commit,” “before review,” and “done” rules are agent instructions unless a later workflow creates an executable check. |
| Rules/config | No shipped rules tree or MCP server configuration. Setup generates a user-level model rule; Benny setup modifies target-project plugin enablement and creates external user-owned configuration. |
| Helpers | `poteto-mode/scripts/`, `show-me-your-work/scripts/log.sh`, and `statechart/scripts/`, inventoried below. |
| Dormant automation | `automations/benny/`, requiring explicit setup and two separately configured live Cursor Automations. |
| Supporting material | README, MIT license, `.gitignore`, logo, guide index + ten chapters + six illustrations, Claude Code adapter, reference prompts/templates/examples. |
| Alternate harness | Repository-root `harness/pstack/claude-code/`, generated from selected pstack sources; marketplace points Claude Code there. Not another plugin inside Cursor's installed pstack folder. |

These presence/absence claims come from the recursive Git tree and explicit manifest registration, not from README omissions. [T; M; H]

### All 34 non-principle skills

Every row names a real `pstack/skills/<name>/SKILL.md`. Linked source owns the detailed contract. Except setup, these are passive instructions until an agent invokes/reads them; helper execution is separately identified below. [SK]

| Skill/source | Actual workflow and important limit |
| --- | --- |
| [`poteto-mode`][MODE] | Main router. Reads task, loads matching playbook, copies its steps verbatim into todos, records skips, routes skills, chooses model roles, owns delegates and final verification. Not a programmatic state machine. |
| [`poteto-help`][HELP] | Answers from actual skill/guide sources and returns a prompt to send. Help does not start costly work. Distinguishes actual work requests, which route into mode. |
| [`setup-pstack`][SETUP] | Detects available model slugs, asks budget and role choices, validates, overwrites model rule idempotently, confirms new-session effect, optionally offers app/formal verification generation. Does not install an app harness automatically. |
| [`in-your-own-words`][WORDS] | Restates user's goal/problem. No execution or verification. |
| [`sharpen`][SHARPEN] | Names professional methods, raw material and outside check, then rewrites prompt deeper without expanding scope or taking user's choices. Does not execute task. |
| [`how`][HOW] | Simple target: one read-only explainer. Complex target: two to four read-only explorers, then explainer. Returns architectural explanation, file ownership and gotchas. |
| [`why`][WHY] | Establishes code/history/PR anchor; discovers available MCPs and parallel source investigators, then confidence-preserving synthesizer. Seven evidence categories; missing sources recorded as gaps. Agent mode needed for MCP access, despite instructions not to write. |
| [`teach`][TEACH] | Runs how/why at appropriate scope, teaches progressively in plain terms with diagrams; preserves why's confidence qualifiers. Spatial explanations may request image generation. Not an implementation workflow. |
| [`recall`][RECALL] | Workspace/topic/time-scoped chat mining, shared-record sweep via why, then checks live PR/branch/ticket state. Default recent window seven days. Gives capsule/status/problems/next move, not raw transcripts. |
| [`ketchup`][KETCHUP] | Read-only catch-up since user's previous message, existing media, every outstanding human decision with evidence/risk/recommendation. Does not run apps/jobs or post externally. |
| [`ketchup-video`][VIDEO] | Ketchup with a short silent rendered slide video outside repo. At most ten slides; inspect rendered frame and reading time per slide. If rendering fails, disclose and provide calls only. No bundled video renderer. |
| [`blast-radius`][BLAST] | Follows breakage beyond diff and grep, reads actual pinned dependencies, identifies one load-bearing safety fact, proves it by running real code or explicitly marks unproven. Can create/run proof scripts; not read-only by definition. |
| [`architect`][ARCH] | Grounds with how/possibly why, uses arena to generate at least two structurally distinct usage-first designs, screens red flags, synthesizes types/module shape and rationale, then **implements by default**. Human checkpoint only when requested. Re-ground/scrap when architecture repeatedly resists implementation. |
| [`arena`][ARENA] | Same task to isolated candidates; parent-private rubric; cross-family judge after candidates finish; parent reads/scorers all, picks base, grafts best parts, verifies synthesis. N-1 on dropout is disclosed, not silently complete. |
| [`swarm`][SWARM] | Partition coverage or declared race rule; cloud workers by default; isolated outputs, exact revision/method contracts; aggregates PASS/ISSUES/BLOCKED. Missing SHA/method result gets one respawn, then recorded gap. Missing slice never passes. |
| [`interrogate`][INTERROGATE] | Same intent/diff/rubric to configured diverse-model read-only reviewers. Lead checks claims and buckets Act on/Consider/Noted/Dismissed. No automatic code changes; consensus high-signal, not proof. |
| [`tdd`][TDD] | Cheap local bug target or explicit request: failing-before test, minimal fix, passing-after. Expensive/unclear/integration-heavy path may use other executable regression evidence; no bad mock-heavy test just to satisfy ritual. |
| [`benchmark-checklist`][BENCH] | Inspect measurement harness/load, identify limiter, tune both sides, check physical limits/errors/work, normally at least five alternating runs with median/range and end-to-end relevance. Ballpark exception still checks errors and actual work. Missing core evidence produces inconclusive. |
| [`no-comments`][COMMENTS] | Invokes Comment Sicko; parent rejects scope/exception mistakes, at most one rerun, then fails if still rejected. Fixes accepted root-cause targets, architect sketch where needed; offers structural encoding of constraint comments. Aggressive deletion policy, not safe generic autoformatting. |
| [`typescript-best-practices`][TS] | Typed domain/boundary discipline, brands, discriminants, schema-derived types, exhaustiveness, real behavior tests; scoped paths `.ts`/`.tsx`, but still explicitly invoked. Reference examples, not a compiler/linter. |
| [`unslop`][UNSLOP] | Prompt-based prose cleanup with stable pattern IDs. Covers vague attribution, AI phrasing, jargon, formatting, overcompression. No executable prose checker. |
| [`bro`][BRO] | Restates last message plainly. No new research or action. |
| [`technical-writing`][WRITING] | Diátaxis document mode plus Google/STE/Global English sentence discipline, unslop; source vocabulary and reader clarity. Normative prompts, not machine-checked style. |
| [`figure-it-out`][FIGURE] | Designs task-specific falsifiable workflow, scales rigor, creates verification baseline first, loops small hypotheses, keeps decision trail. VERIFIED/NOT VERIFIED/INCONCLUSIVE distinct. Not a universal automatic agent loop. |
| [`show-me-your-work`][TRAIL] | Canonical append-only decision TSV; per-run ownership/start rows, evidence pointers, audit against transcript, different-family trail reviewer, Attention section. Local by default; commit only where authorized and auditability warrants. Shell helper formats rows but does not validate truth. |
| [`create-verification-skill`][V] | Generator for project-local verify skill and starter feature map, grounded in actual startup/control/isolation. Must execute generated launch→doctor→one mapped feature→evidence→cleanup before calling delivered. Not the everyday generated skill itself. |
| [`maintain-verification-skill`][VM] | Per-feature source readers plus coordinator-only live driving, all feature files covered, health/evidence/cleanup invariants. Edits only verification directory. Clean/changed/blocked; at most one proven correction PR. |
| [`create-formal-verification-skill`][F] | Select costly weakly-tested property, choose model checker/code verifier/proof tool; TLA+ default for interleavings, generated-input real-code checks if no verifier. Records code coverage/bounds/sync commit; must catch scratch real-code break. No product repair without request. |
| [`maintain-formal-verification-skill`][FM] | Baseline check, inspect every covered-code change since sync, update from source not desired result, rerun and mutation-prove sensitivity, classify in sync/updated/bug/blocked. Only verification edits unless authorized otherwise. Blocked check cannot advance sync commit. |
| [`statechart`][STATE] | Executable-backed TLA+→reader-facing Mermaid/PNG/counterexample stories; chart→TLA+ skeleton; actual-versus-agreed/fixed model comparison. Must replay code-model bugs against real code and disclose bounds/omissions. Model evidence is not whole-app proof. |
| [`automate-me`][ME] | Mines workspace-scoped history across slices, confirms preferences, drafts/updates personal mode via built-in create-skill + unslop. Subjective human iteration, not forced benchmark. Upstream ends in worktree/commit/PR workflow; requires separate local authorization. |
| [`reflect`][REFLECT] | Three transcript reviewers (judgment/tooling/divergent) + synthesizer, source spot-checks, structural fixes routed to backlog. Presents Accepted/Rejected/Backlog and waits approval before skill edits; files backlog without waiting. Never edits plugin cache or pushes/opens PR in this workflow. |
| [`correct`][CORRECT] | Finds repeated mistake classes (twice), favors architectural elimination→types/lint/CI→behavior tests→docs, proves new check on real past mistake, maintains rule/enforcer table. Creates repo changes/commits when run with authority; not just a retrospective. |
| [`make-bot-ui`][BOT] | Grok Bot webhook routine + server-side secret-request handoff + local page/server + Tailscale exposure. Uses platform routine/secret APIs, 8-second one-shot POST and harmless probe. Highly platform/network-specific; not a bundled web server. |

### All 24 principle skills

Each is `skills/principle-<name>/SKILL.md`, explicitly invoked and advisory unless another step encodes it into actual tooling. The mode indexes them, but requires reading a leaf in full before applying/citing it. Some leaves are intentionally tiny; their frontmatter holds much of the instruction. [P; MODE]

| Exact suffix after `principle-` | Actual direction / boundary |
| --- | --- |
| `laziness-protocol` | Consolidate decisions, smallest solving diff. |
| `foundational-thinking` | Data/access patterns first; isolate concurrent state; foundations help later phases; three simple lines can beat premature DRY. |
| `redesign-from-first-principles` | Incorporate new constraint as foundational, propagate references, deliver incrementally. |
| `attack-the-premise` | Two fixes fail same gate: write/test shared premise before third attempt. |
| `subtract-before-you-add` | Remove dead/redundant/stub complexity first, no speculative validators. Does not authorize removing actual security boundaries. |
| `minimize-reader-load` | Reduce both indirection and hidden mutable state, not merely LOC. |
| `outcome-oriented-execution` | Scoped reversible intermediate breakage allowed only in planned migration with explicit verification boundaries. |
| `experience-first` | Consumer and future maintainer experience outweigh implementation convenience. |
| `exhaust-the-design-space` | Novel architectural/UI shape earns two to three competing prototypes. |
| `build-the-lever` | Nontrivial work produces smallest rerunnable tool or delegate skill; deterministic transformation beats hand fan-out. |
| `model-the-domain` | Structure removes illegal states/branches; do not force abstraction onto clear local code. |
| `boundary-discipline` | Validate external inputs once; domain types/pure logic internally; hide wire/storage representation. |
| `type-system-discipline` | Brands, parsed boundaries, derived schemas; compiler rejects illegal states. |
| `make-operations-idempotent` | Reconcile actual state, rerun/crash-safe artifacts and recognizable stale ownership. |
| `migrate-callers-then-delete-legacy-apis` | Coordinated migration removes old API in same wave **when no external compatibility obligations exist**. |
| `separate-before-serializing-shared-state` | Eliminate sharing first; real shared invariants need structural locks/CAS/single-writer, not instructions alone. |
| `prove-it-works` | Inspect/run actual artifact, not summary/mtime/compilation; retain rerunnable proof. |
| `fix-root-causes` | Runtime repro→first wrong decision; legitimate-state guards can be correct fixes. |
| `sequence-verifiable-units` | Verify each bounded unit before next; delivery history explains failing-before/passing-after. |
| `test-behavior-not-implementation` | Must fail when observable behavior breaks and survive internal reshape. Mocked external boundary payload can be behavior. |
| `explain-the-number` | Measured limiter, errors/no-ops/noise/tuning ruled out; count/spread/context with number. |
| `guard-the-context-window` | Bound phases/turns, delegate bulk, keep reduced findings. |
| `never-block-on-the-human` | Reversible authorized work proceeds; product direction and irreversible/external actions still have boundaries. |
| `encode-lessons-in-structure` | Types/lint/runtime/scripts over repeated prose; judgment-only lessons may stay instructions. |

### All 23 playbooks and how they interact

Files below live in `skills/poteto-mode/playbooks/`. They are routed instruction lists, not separate plugins, agents, or registered commands. The lead chat owns their lifecycle. [PB; MODE]

| File | Flow, evidence, and stopping rule |
| --- | --- |
| `investigation.md` | Read-only how/why→cited explanation/recommendation. Explicitly no PR/babysit/architect unless handing back to a later implementation task. |
| `bug-fix.md` | Lead reproduces on actual surface; runtime hypotheses→mechanism→scoped delegate fix→same-surface passing repro; red-first cheap test where practical. |
| `perf-issue.md` | Actual baseline trace→how→cheapest performance strategy→fix→post trace/measurement artifact; benchmark checklist gates number. |
| `hillclimb.md` | Realistic workload, frozen sensitive harness, baseline, one hypothesis/change/measurement, regression gate, keep/revert and decision trail; stop on declared predicate or honestly exhausted worthwhile ideas. |
| `runtime-forensics.md` | Capture/instrument live process and confirm mechanism→source diagnosis, not code fix. “Read-only” means no product patch, but live instrumentation can alter runtime behavior. |
| `trace-forensics.md` | Existing fixed artifact→queryable representation→cause→source mapping; paired capture can confirm, otherwise strongest supported hypothesis. No rerun or unsolicited fix. |
| `feature.md` | how→architect→four-item throughput checkpoint→scoped code owner/arena where multiple shapes→actual surface verification→ordered delivery. Delegation/review separation mandatory in upstream contract. |
| `refactoring.md` | Pin observable behavior before movement→name simpler structure→small moves holding pin→real equivalence→reader-load benefit. Discovered feature/bug stays separate. |
| `prototype.md` | Decision first, isolated throwaway, lightest implementation, switchable variants, observed interaction/output, recommendation. Deliberately not production code or broad test infrastructure. |
| `visual-parity.md` | Immutable prechange screenshot baseline, one component at a time, image diff must be zero. No baseline or nonzero diff means no parity claim. |
| `authoring-a-skill.md` | Built-in create-skill, validate frontmatter/files/links, structural test when useful, PR workflow. |
| `eval.md` | Organic identical prompts, sanitized isolated environments, hidden rubric/model names, blinded cross-family judge, inspect actual transcripts and output shape, not chain-following self-report. |
| `babysit.md` | Declare drive/background/threads-only/check; forge and lowest-unmerged frontier; conflicts→threads→CI. Normally merge-ready only. One fresh build for flake; identical repeat reclassified. No general topology mutation or merge permission. |
| `shipping.md` | Independent per-PR real-surface verdict→only contiguous verified run from bottom→patch validity check→merge bottom-up→confirm actually merged on trunk, not merely queued. Never equates green CI with safe. |
| `autonomous-run.md` | Falsifiable exit predicate + native Cursor loop/event watcher/heartbeat, evidence-based iterations and trail. Does not prescribe universal attempt/time/token ceiling; genuine dead end surfaced without relaxing goal. |
| `orchestrate.md` | Standing multiday program: coordinator authors briefs, Task agents execute; pilot, rolling queue, one-writer stack frontier, SHA-keyed ledger, durable store, bounded retry/replacement, continuous landing and restart recovery. Collapse ceremony for simple work. CLI records state, never schedules agents. |
| `autopilot-full.md` | Independent PR owner per cloud VM from build to merge; root independently swarm-verifies code-ready head, fresh checks on later changes, exact-head/patch validity, operator gates first. Root audit tick on explicit go; operator stop sends zero-writes to owners. |
| `autopilot-stack.md` | Full-owner flow but one root owns topology and **operator owns landing**. Base-chained dependency order, owners never merge/retarget/restack. |
| `session-pickup.md` | Read previous trail/branch, reconstruct inherited state, don't redo completed investigation, route pending task; still verify inherited claims against original goal and actual artifact. |
| `pause-safely.md` | Explicit safe stop, no new work, cancel children, upstream WIP commit and off-context resume note. Not implied by “going to bed, keep going.” WIP commit needs local permission. |
| `multi-phase-plan.md` | **Plan-only**, prototype unknowns first, checklist per PR, unit/live/perf gates, ten live lanes, interaction review screenshots/video, operator go before execution; run check-plan. Tiny obvious work can skip plan. |
| `worktree-cleanup.md` | Audit candidate paths, cross-check pinned/active chats and descendants, inspect WIP, delete only confirmed set; simulator/cache reclamation possible. Highest data-loss risk; audit bucket is advice, never permission. |
| `opening-a-pr.md` | Worktree, small ordered commits, deslop/no-comments/writing, ready PR with concise scope/risk/proof, forge resolved once. Opening PR does **not** trigger babysit. General end-of-playbook rule has explicit investigation/prototype/etc. exceptions; not blanket permission. |

**Important interaction distinctions.** Arena compares alternative artifacts and synthesizes code/design. Swarm covers independent slices/races and synthesizes a report. Interrogate is adversarial review and does not auto-apply. How answers mechanism; why answers historical evidence; teach combines them. Figure-it-out designs one bespoke run; Autonomous run continues one task; Orchestrate coordinates a standing program. Full autopilot grants queue-scoped merge responsibility; stacked autopilot deliberately withholds it. [ARENA; SWARM; INTERROGATE; HOW; WHY; TEACH; FIGURE; PB]

### Agents, references, and non-executable support

- **`poteto-agent`** is background-capable delegate wrapper, not a replacement lead coordinator. Reads mode in full before work, using supplied absolute path; fallback searches Cursor plugin installation and selects highest manifest version; absent mode stops delegate. Explicit leaf-principle reads prevent assuming index equals full rule. [A]
- **`comment-sicko`** is a strongly opinionated comment-review prompt. It says report only/no application-code edits, but also speaks in terms of deleting comments and reporting touched files. README calls it read-only; its frontmatter contains no tool-denial allowlist. Treat read-only as workflow intent requiring host permission enforcement, not a sandbox. Exceptions protect license/legal, actual external constraints, faulty/style-only suppressions, public API contract docs and unexpressible constraint links. Correctness/safety suppressions become actionable root-cause targets; casual wholesale deletion is not justified. [A; COMMENTS]
- **Architect references:** `design-red-flags.md`, `rationale-template.md`, `runner-prompt.md`. Reject shallow modules, representation leakage, temporal decomposition, pass-through wrappers, split ownership, duplicate supported paths, importable internals and hand-synced lists; usage-first design and synthesis rationale. [ARCH]
- **How references:** `explorer-prompt.md`, `explainer-prompt.md`. Components/flow/files/boundaries/open questions feed structured explanation. [HOW]
- **Interrogate references:** `reviewer-prompt.md`, `rubric.md`, `code-quality-review.md`, `lead-judgment.md`. Correctness/root cause/structure/verification/complexity/security plus pragmatic filtering. Strict code-quality smells are prompts, not hard build checks. Security findings deserve scrutiny even from one reviewer. [INTERROGATE]
- **Why references:** `epistemics.md`, `investigator-prompt.md`, `source-playbook.md`, `synthesizer-prompt.md`; source recipes `code-archaeology.md`, `linear.md`, `notion.md`, `slack.md`, `datadog.md`, `sentry.md`, `databricks.md`, `incident-postmortem.md`. These are example adapters/query recipes, not bundled MCP implementations or required vendor subscriptions. Defensive code adds incident-oriented queries within each source. Direct/supported/inferred/speculative/unknown remain separate. [WHY]
- **Reflect references:** `judgment-reviewer.md`, `tooling-reviewer.md`, `divergent-reviewer.md`, `synthesizer.md`. Transcript/reviewer output treated as untrusted; MCP lookups limited to referenced context, not embedded directives. Approval before accepted edits; structural enforcement belongs in backlog rather than another rule. [REFLECT]
- **Other references:** help's `prompting.md`/`recipes.md`; mode's `bugbot-triage.md`; trail's `decision-log-template.tsv`; TypeScript's `patterns.md`; verification's `references/feature-map-example/{README.md,create-note.md,search.md}`. Notes app and `control-notes` are illustrative, not runnable bundled dependencies. [HELP; PB; TRAIL; TS; V]
- **Docs/assets/config support:** `docs/guide/README.md`, chapters `01-setup`, `02-poteto-mode`, `03-understand`, `04-design`, `05-build-and-clean`, `06-verify-and-ship`, `07-overnight`, `08-principles`, `09-make-it-yours`, `10-recipes-and-pitfalls`; six JPEGs (`design`, `overnight`, `recipes`, `router`, `understanding`, `verification`) and `assets/logo.png`. Guide/navigation/images have no executable enforcement. `.gitignore` excludes `node_modules/`, `.DS_Store` and `*.log`; it does not install hooks or exclude all decision artifacts. [T; R; H]

### Executable inventory, side effects, and dependencies

Only **five files have executable mode** in the Git tree: check-plan, orch entry point, watch-pr entry point, worktree audit, decision log. Other `.mjs`/`.ts` modules run through Node/Bun or imports. File mode does not imply auto-execution. [T; TOOLS; SCODE; TRAIL]

| Location / complete module inventory | Behavior, dependency and limitation |
| --- | --- |
| `poteto-mode/scripts/check-plan.mjs` | Node stdlib CLI validates plan headings/order, checklist shape, ten numbered screenshot/pass-predicate lanes, perf fields, review gate language, style markers; exits nonzero for problems. **Checks document syntax, not existence/truth of artifacts, actual verification, approval, or execution.** |
| `poteto-mode/scripts/bootstrap.ts` | Before Bun helper startup, hashes package.json + bun.lock and checks installed Commander marker. Missing/stale install runs **`bun install --frozen-lockfile` inside plugin scripts directory**, writes marker and restarts original process. Therefore even apparent read-only helper startup may install dependencies and needs writable location/network. |
| `poteto-mode/scripts/orch/orch.ts`, `orch/store.ts` | Bun CLI for init; unit add/set/list; ledger record/check; inbox push/drain; gate park/resolve; frontier set; standing orders; derived status. Plain TSV/JSON/Markdown, atomic temporary-file rename, exclusive lock with PID liveness recovery/force option. Git + gh/Origin reads compute PR chain/frontier, local refs supply SHAs. **Does not spawn, wait for, or wake agents; no daemon/scheduler.** Ledger stores supplied evidence pointer/verdict, not independent truth validation. PID lock is local-host process identity, not distributed fencing. |
| `poteto-mode/scripts/watch-pr/watch-pr`, `watch-pr/{cli.ts,github.ts,policy.ts,render.ts,types.ts}` | Bun+Commander+authenticated gh. CLI parses arguments; github reads PR/check/review state including GraphQL; policy classifies merge blockers/polls queue; render emits JSON/NDJSON or pretty text; types encode result variants. Watches single/connected-stack/frozen queued-stack. Conflicts/review/CI/forge merge gates/query errors yield distinct terminal results; queued mode WAITING/ADVANCE until COMPLETE, never READY. **GitHub-specific; does not repair code or merge.** |
| `poteto-mode/scripts/worktree-audit.sh` | Bash + Git, jq, rg, ordinary Unix tools; GNU/BSD stat/date handling. Reports size/age/ancestry/dirty/remote/PR/recent scoped transcript and suggested bucket. Does not delete worktrees, **but fetches remote base ref**, writes/deletes its temp PR file, reads private transcripts. Ancestry alone misses squash merges; pinned/live use still requires independent checking. Space-containing paths and regex-based transcript matching warrant care before portability reuse. |
| `show-me-your-work/scripts/log.sh` | Bash helper accepts file + five fields, creates directory/header, UTC timestamp, appends one TSV row; strips tabs/newlines/CR and prefixes spreadsheet-formula-leading cells. No evidence resolver, semantic validator, transcript auditor or multiwriter locking. Append-only is not tamper-proof. |
| `statechart/scripts/statechart.mjs` | Node entry point: from-spec, from-chart, render; parses args, snapshots inputs, orchestrates TLC/helpers/rendering, publishes generated outputs. Protects foreign output files and changed input content. Mapping files are executable JavaScript imports, **not untrusted declarative JSON**. |
| `statechart/scripts/tlc-tools.mjs` | Uses explicit `TLA2TOOLS` and `JAVA`, otherwise mise provisions pinned TLC 1.7.4 and Java temurin-25; first install documented about 305 MB. TLC jar checksum pinned. Empty temp cwd avoids trusting surrounding mise config. mise itself must exist; no permission to install it inferred. |
| `statechart/scripts/render.mjs` | Installs pinned `pele@1.8.0` + `@resvg/resvg-js@2.6.2` into user cache with npm and `--ignore-scripts`; renders Mermaid/SVG/PNG, font discovery via fc-match where available, themes/label wrapping. Network/cache/native package/font assumptions remain. |
| `statechart/scripts/chart-to-tla.mjs`, `compare-charts.mjs` | Parse supported Mermaid form into TLA+ skeleton/config/map and compare chart regions/transitions. Skeleton is not an automatically faithful extraction of arbitrary implementation; add real guards/state and review differences. |
| `statechart/scripts/tlc-to-chart.mjs`, `tlc-to-chart-args.mjs` | Parse conversion options; build reader-labeled quotient graph, bugs/stories/summary and per-bug chart outputs, compare proposed fix/agreed model. Hidden/self transitions and abstraction must be disclosed; labels determine what reader sees. |
| `statechart/scripts/lib.mjs` | Shared parsers for TLA values/states, TLC DOT/traces, Mermaid, rule/definition/source-citation analysis, region product/comparison and rendering palette checks. Supported parsers are not arbitrary-language correctness proofs. |
| `statechart/scripts/bug-states.mjs`, `chart-edges.mjs`, `chart-parts.mjs` | Bug-state classification/reachability/status ranks; graph edge selection/paths; common chart IDs/guards/frontmatter. |
| `statechart/scripts/map-view.mjs`, `read-check.mjs` | Guard/proxy state values and validate mapping reads across actual/second-model shapes; reject absent/incompatible field readings rather than print misleading undefined labels. |
| `statechart/scripts/property-loop.mjs`, `rule-book.mjs`, `second-replay.mjs`, `ways-in.mjs` | Temporal-property repeated-state story; rules/comments/source metadata; replay bug path in second model; compute approaches into violating states. Broken PROPERTY may have TLC counterexample but no drawn path. |
| `statechart/scripts/regions-chart.mjs`, `snapshot.mjs`, `spec-text.mjs`, `statechart-help.mjs` | Region diagram construction, input capture/change detection, generated rules/scaffold/mapping text, full CLI/output/exit-code documentation. These complete the **21 statechart modules**. |

Supporting package/config/test files are also inventoried: `poteto-mode/scripts/{package.json,bun.lock,check-plan.test.ts}`, `orch/orch.test.ts`, `watch-pr/{cli.test.ts,github.test.ts,policy.test.ts,fakes.test-helper.ts,types.compile.ts,tsconfig.json}`, plus statechart `scripts/test/{statechart.test.mjs,band.mmd,regions.mmd,sync.mmd,upload.mmd}`. Mode runtime dependency is **Commander 14.0.0**; dev dependencies are `bun-types`/TypeScript with `latest` manifest ranges and lockfile resolution. Package scripts define Bun tests and strict TypeScript check for watch-pr scope. Test presence is not evidence tests passed here, nor blanket strict checking of every helper. [TOOLS; SCODE]

**Upstream repository checks are not installed project hooks.** The pinned `.github/workflows/validate-plugins.yml` runs on matching pull-request paths, installs Ajv validators, validates plugin definitions, checks generated harness drift, and runs Node skill-script tests matching `pstack/skills/*/scripts/test/*.test.mjs`. It does not list the Bun helper test script or its strict watch-pr typecheck. Separate repository tool `scripts/check-pstack-docs.mjs` checks README/guide counts, skill/playbook/agent names, links/anchors and model defaults; it is not invoked by that pinned workflow. These checks protect upstream packaging/docs/script behavior, not the correctness of a downstream feature developed using pstack. [CI; DOCHECK]

**Watcher operational limits:** default poll 60 seconds, whole-stack sweep 300 seconds, consecutive query-error budget five, **timeout zero (disabled)**. `--status-only` exits zero after a status report even when that report is not “ready”; examine result kind/blockers, not exit zero alone. Polling covers forge status, not runtime feature correctness or ownership/authentication of a human merge grant. [WATCH]

**Statechart operational limits:** exit zero means rules hold **or exactly the explicitly expected broken rules break**; it never means “no bugs” without reading summary. Exit one covers unexpected break/expected break disappearing/chart disagreement; exit two means cannot finish, mapping/render/input/output/tool failure, or graph too large. Temporal PROPERTY failures are separate from invariant paths. Chart timing labels are not timed proofs; TLC has no wall clock here. `--cover` intentionally omits overview states/edges but records them. Some TLC error paths retain found bugs with a warning that coverage may be incomplete. Preserve `summary.json`, `stories.md`, Mermaid/PNGs, TLC configs/output and regeneration command, not only a pleasing diagram. [STATE; SCODE]

### Dormant Benny pack: full workflow, not installation by inclusion

Pack files are `FOR_AGENTS.md`, README, three instruction files under `skills/`, four reference files, and three templates. The three instruction files are **setup-benny**, **triage-issue-reports**, **reproduce-and-fix-issues**. References are control-adapter contract, feature-map example, verify-existing-fix and routing example. Templates are `configuration.example.yaml`, `triage-automation-prompt.md`, `reproduce-automation-prompt.md`. No executable Slack service, tracker adapter, app driver, trigger engine, or scheduler is bundled. [B]

1. **Setup only on request.** Point Cursor to FOR_AGENTS; merge complete pack into target `.cursor/automations/benny/`, preserving destination-only files and manually reconciling edits. Enable pstack in target `.cursor/settings.json`; verify shared skills from a **fresh project-scoped agent**, not incidental current-session/user install. Keep user config/maps outside copied pack. Commit required secret-free source/config before enabling automations; setup itself does not authorize commit. [B]
2. **Validate real integrations.** Explicit channel/thread identity, repository/default branch, tracker fields/actions including compensation, control skill, complete feature map, model availability, artifact retention and budgets. Missing capability fails closed. Optional Slack token is narrowly scoped and secret-managed, never sent to children. Run harmless bring-up→feature navigation/state→inspection→screenshot→recording→cleanup adapter check. [B]
3. **Create two live automations separately through built-in automate.** Reviewed draft/editor handoff and user readiness/approval for each. Existing automations are edited by user in editor; automate is creation-only in pack contract. No direct backend/deep-link shortcut. Both start from configured new Slack root reports; live prompt reads exact committed operational file, not plugin-cache path or copied instruction excerpt. Thread-safety test must pass before normal traffic. [B]
4. **Triage.** Freeze source coordinates, read whole thread/media, bounded cause/history/routing, classify, dedupe. Create only clear new bug/perf issue with source permalink and tracker rollback capability. Preflight parent before tracker write and post. One substantive source-thread verdict ends in configured bug/performance/other marker. Verify reply landed; compensate newly created issue if handoff fails. No root post, cross-post or speculative owner assignment. [B]
5. **Reproduce.** Wait silently for trusted triage identity's single marker in same source thread, within budget. Stop for other/missing/conflicting/untrusted verdict, human fixing ownership without artifact, or invalid coordinates. Existing PR/commit switches to verification rather than competing fix. Optional operations channel can hold one status root; source root remains forbidden. [B]
6. **Evidence before authored fix.** Correct app/account/environment/feature, exact real UI path twice with reset, broken discriminating final state, screenshot + full recording + read-only real-state corroboration where possible, independent media review. Could-not-reproduce/blocked stays operations/run output, not noisy source update. Confirmed repro gets at most one unprompted source reply and rejection window. One concrete setup correction allowed. [B]
7. **Bounded fix or existing-fix verification.** Existing artifact requires twice-broken baseline and twice-correct patched real UI with same inputs; no edits/replacement PR. New fix requires confirmed/media-approved repro, no ownership/artifact conflict, known runtime mechanism and effort/scope budget. Coordinator owns external writes; edit delegate only when tools/credentials genuinely exclude Slack writes. Red-first cheap test, focused/blast-radius checks and twice-correct patched UI before **draft PR only**, never merge/deploy. [B]
8. **Stop/cleanup.** Configured follow-up window, direct questions only, adapter cleanup and retention. Example budgets specify 45-second polling, 45-minute verdict wait, 10-minute triage follow-up, 30-minute total triage, 60-minute repro, 10-minute rejection, 90-minute fix and 45-minute operations follow-up; these are **template values**, not plugin-wide runtime enforcement. [B]

Benny's draft-only PR policy deliberately differs from general opening-a-pr's ready-only policy. Its scoped workflow owns this distinction. Its “immutable coordinates,” “no child Slack writes,” budgets, preflights and fail-closed rules are mostly prompts/config contracts; host tool isolation and actual compensating actions must make them real. Thread preflight followed by external write is not an atomic transaction across Slack and tracker. Do not describe this pack as exactly-once or race-free merely because prompts demand dedupe. [B; PB]

### Setup versus everyday development

| Phase | What changes and what should not be confused |
| --- | --- |
| Install/discover | Cursor `/add-plugin pstack`; explicit skill invocation afterward. No automatic lifecycle enforcement. Optional cursor-team-kit supplies referenced deslop/control workflows. |
| Personal setup | `setup-pstack` writes **`~/.cursor/rules/pstack-models.mdc`**, alwaysApply, budget comment + role mappings. Offers generation, not mandatory project modifications. Global user-state change needs authorization in an adaptation. |
| Project commissioning | Create real-app verify skill/feature map; optional property-specific formal skill; prove each generated procedure. Neither generator is the routine verification command afterward. |
| Daily change | User supplies goal, done predicate and fences; mode routes appropriate playbook, lead grounds/designs, delegates where useful, checks actual artifact, filters independent review, records limits. |
| PR review/landing | Opening, babysitting and shipping are separate. Green checks do not imply runtime verified, merge authorized or actually merged. |
| Maintenance | App-verification maintenance reconciles source + live features; formal maintenance traces sync commit and mutation-proves check sensitivity. |
| Optional automation | Benny is an additional Cursor-only integration project, not required to use daily pstack. |

Model setup offers unlimited/large/medium/small, mapping to max/xhigh/high/medium reasoning, not monetary caps. Roles include feature/refactoring, bug-fix, perf, hillclimb, judgment/prose, hardest tasks, how explorer/explainer, why investigators/synthesizer, reflect tooling/other lenses, arena runners/cross-judge pool, swarm workers, architect runners, interrogate reviewers. Default code roles use `grok-4.7-xhigh-fast`; judgment uses `claude-opus-5-5-xhigh`; default panels include both. Alias auto/inherit-parent omits explicit model, and alias panel seats still count. Detected availability must validate real slugs. Setup preserves nondefault family/list/alias choices on rerun and drops retired roles. Existing rules can pin outdated defaults. Role budget is a starting effort: mode adjusts effort/speed for task, generally standard speed except urgent work and verification's configured speed. No dollar/token ceiling follows from “small.” [SETUP; MODE]

### Evidence contract and failure handling

**Application verification.** Generated skill names exact Launch, Doctor, Drive, Evidence, Cleanup and Helpers. Empty-data launch must become usable, not just answer a port. Doctor is read-only ownership/version/auth health. Real user action and resulting state plus durable side effects are proof; internal setters/test-only endpoints are not. Stable roles/names/paths preferred over coordinates. Mock only existing production-isolated external boundaries, and inspect what a dry-run really mutates. Cleanup stops only owned processes/scratch, never proof. [V]

Feature map starts around three to five features, **not exhaustive coverage**. Each has Sub-features, every user entry point, literal driving recipe/outcome and Gotchas. Commissioning needs one mapped feature; maintenance covers every feature file from source and live at least once, while the map contract rejects substituting one convenient entry point for all others. Unavailable prerequisite is documented unreachable/blocked, not successful behavior. After surprises, doctor/reset/relaunch before more driving. Doctor drift receives one correction/retry; no universal retry cap for every generator failure is specified. Documentation drift, harness gap and actual product regression stay distinct. [V; VM]

**Formal verification.** State property/harm plainly; choose real code verifier versus abstract model deliberately; cite actual code and indivisible steps, record bounds/assumptions/files/functions/sync commit. Show each check can fail on intentional scratch break, restore baseline, rerun next-agent recipe. Never loosen property to hide current bug. A faithful bounded model pass is valuable, but does not establish arbitrary implementation, real authentication, external service behavior or full runtime correctness. Stale passing model is specifically identified as dangerous. [F; FM; STATE]

**Independent review/evidence.** Parent owns delegate work and inspects artifacts, not summary passthrough. Swarm needs exact revision/method receipts, coverage gaps stay gaps. Trail needs resolving evidence pointers and transcript audit, plus cross-family attention review. Shipping verdict must come from nonauthor real-surface verifier and cover current patch/head, with carefully justified patch-id/build equivalence exceptions; changed runtime lanes without comparable build output rerun. These are upstream instructions, not cryptographically attested receipts. [MODE; SWARM; TRAIL; PB]

**Different loop boundaries exist.** Orchestrate bounds child failure retries (two retries then abandon/replan), timeboxes briefs, tracks zombies/restarts and stops after repeated infrastructure aborts. Babysit permits one fresh flake build. Swarm allows one missing-contract respawn. Autonomous run/visual parity can continue until predicate without a universal elapsed-time/token cap, watcher defaults unbounded, and reasoning budget is not spend budget. Any OMP adaptation should impose explicit attempt/time/token/no-progress/cancellation limits rather than import “keep going” literally. [PB; WATCH; SETUP]

### Portability and security assessment

**Portable ideas, not claims about the local app:** scoped goal/done/evidence contract; usage-first deep modules; competing designs for genuinely uncertain shapes; independent reviewer separation; actual-user-path before/after proof; source+live feature-map upkeep; property sync/mutation tests; one writer per state/branch; revision-keyed evidence and honest blocked/inconclusive outcomes. These are host-independent patterns. [MODE; ARCH; V; FM; P]

**Needs host adapter:** Task schema, readonly semantics, per-role model catalogs, cloud/local placement, background completion/resume, persistent transcript paths, todo handling, native skill discovery, user-level rules and project settings, loop wake/cancellation, external posting and credential isolation. Standard SKILL.md syntax does not make those semantics portable. Most workflows default to cloud fan-out; using local processes/worktrees is not equivalent security or environmental isolation. [MODE; SWARM; H; CD]

**Native/platform dependencies:** Cursor custom modes and `/loop`; built-in create-skill/automate/autopilot overlap; Cursor Task/cloud agents, Bugbot/security reviewer, built-in PR tool, Automations routine APIs and secret-request cards; local transcript layout; Grok Bot webhook wake format. Unix/Bash/Git/gh and optional Origin are separate dependencies. iOS simulator cleanup requires macOS/Xcode and cannot be transplanted onto Linux. [MODE; PB; BOT; H; CD]

**Already-shipped alternative adapter:** official Claude Code marketplace uses generated harness with namespaced `/pstack:*` commands and `pstack:*` agents, Task→Agent, AskQuestion→AskUserQuestion, cloud→worktree, model mapping, transcript/rule/path changes. Non-Claude slugs fall back to session model, so model-family diversity may disappear. Explore keeps Bash; adapter therefore adds no-edit instruction and checks git status, not a true filesystem sandbox. Cursor-only steps skip with explicit note; generated harness excludes Benny/assets. This is real first-party portability work, but **no OMP adapter is present in the inspected tree**. [H; T]

Security/adoption hazards requiring deliberate rejection or redesign:

- **Authority scope.** Mode permits broad MCP/team-chat/ticket/eval actions without asking, while its leaf never-block principle still says external messages need confirmation. Opening PR/pause/cleanup flows prescribe commits, pushes, rebases, resets and deletions; authoring-mode defaults to implementation. Treat conflicting/broad prose as lower priority than explicit user/host permission gates. A verified result does not confer merge/deploy/delete authorization. [MODE; P; PB]
- **Destructive convenience.** Opening-a-pr suggests hard-reset recovery; cleanup can force-remove worktrees, recursively delete residue, prune simulator/cache state. Audit helper's safe bucket can miss pinned/descendant use and labels untracked data scratch. Retain explicit ownership/diff/confirmation gates; never make these background automatic defaults. [PB; TOOLS]
- **Network exposure/install.** make-bot-ui prescribes `0.0.0.0`, HTTP on tailnet and a remote Tailscale install piped to sudo shell. These are source behaviors, **not approved actions here**. Do not transplant without threat model, host/network access controls, authenticated local service, approved installer and secret storage. Webhook acknowledgement proves wake only, not completed task. [BOT]
- **Secrets/private context.** Transcript mining is scoped to current workspace; never glob all projects. Generated reports/media/trails/Slack artifacts can still contain secrets or customer data; sanitize and apply retention before external output. Reflect/reference prompts explicitly treat transcript/reviewer text as injection-bearing data; babysit treats review text as untrusted and uses file/JSON payloads rather than shell interpolation. [RECALL; REFLECT; TRAIL; PB; B]
- **Permission is executable, not verbal.** why/reflect use agent mode to retain MCP, despite no-write instructions. Benny explicitly requires actual tool/credential isolation for children, else no delegation. Markdown agent definitions and field names alone are not an authorization boundary. [WHY; REFLECT; A; B; H]
- **Generated checks can be gamed.** check-plan verifies shape, orch records supplied verdicts, log helper formats text, and model charts depend on manually chosen abstraction/mapping. Independent artifact inspection, mutation sensitivity, exact revision binding and honest evidence scope are required on top. [TOOLS; TRAIL; F; SCODE]
- **Dependency provenance.** Bun helpers and renderer can install on first invocation; statechart invokes Java/TLC/mise and imports JS mapping code. Review/version/approve these paths before running, including from plugin cache, and never treat a “read-only status” request as permission for hidden installation. [TOOLS; SCODE]
- **Review quality versus churn.** Multi-model agreement can share blind spots. Strict comment stripping and large-file/architecture heuristics can overreach. Upstream lead-judgment and Bugbot rubric require actual callers/context, real security scrutiny and concrete dismissal reasons, not generic suspicion or automatic gate weakening. [INTERROGATE; COMMENTS; PB]

### Adoption recommendations for parent to evaluate

These are **recommendations**, not local implementation findings or authorization to change anything.

1. **Adopt proof discipline first.** Define one owned real-app verification recipe with health/identity, isolated state, literal user path, expected outcome/side effects, retained artifacts and safe cleanup. Commission it before calling it working. Keep generator, generated recipe and maintenance as separate jobs. [V; VM]
2. **Reuse existing runtime and permissions.** Adapt small prompt recipes to supported OMP tools/discovery; do not add Cursor routing names, another scheduler/loop or cloud-agent assumption merely to resemble upstream. Parent must establish actual local capabilities independently. [H; MODE; PB]
3. **Bind evidence to immutable work.** Record revision/criterion/path/method/result/artifact and unverified prerequisites, independently inspect relevant receipts, and invalidate proof after meaningful patch/base/environment changes. Keep author verification, independent review and human acceptance distinct. [SWARM; TRAIL; PB]
4. **Scale review to uncertainty and risk.** Plain local edits do not need always-on arena/architect/ten-live-lane program ceremony. Use design alternatives for real shape forks, adversarial review for contested/high-risk change, repeatable baselines for perf, focused formal verification for costly invariants. Upstream itself collapses orchestration overhead for cheap units. [ARCH; INTERROGATE; BENCH; F; PB]
5. **Enforce chosen gates in host code/CI where warranted.** A Markdown checklist or self-reported TSV is not enforcement. Keep existing security validation, cancellation, budgets and acceptance controls; add measured checks only after parent establishes a gap. Structure beats duplicating a large principles corpus. [CORRECT; P; TOOLS]
6. **Defer high-cost/nonportable packs.** Do not adopt Benny without real authorized Slack/tracker/control integrations and compensating actions. Do not adopt make-bot-ui, global installs, destructive cleanup, auto-merge or indefinite loops as defaults. Reasoning-role configuration should not masquerade as spend control. [B; BOT; SETUP; PB; WATCH]

### Sources and retrieval limits

Only first-party repository content, GitHub's official Git/commit API for that repository, and Cursor's own linked skills documentation were used. Local prior verification research was read for orientation only; upstream contracts above were rechecked at this newer pinned snapshot. Public source retrieval/static inspection is evidence of **specified behavior/code**, not that pstack, its scripts/tests, remote integrations, or generated verifiers were successfully executed. No private project data was sent upstream. Existing unrelated working-tree changes were preserved. No lint/build/test was run for this Markdown-only research.

Source index follows. Directory citations identify the exact pinned component collection; individual skill references resolve to their complete SKILL.md, whose adjacent references/scripts are inventoried above.

| Citation ID | Primary source |
| --- | --- |
| T | [Recursive Git tree][T], plus commit/subtree provenance links below. |
| M / R / L | [Cursor manifest][M], [README][R], [license][L]. |
| SK / P / PB / A | [All skills][SK], [principle leaves within skills][P], [all playbooks][PB], [both agents][A]. |
| MODE / SETUP / HELP | [Mode][MODE], [setup][SETUP], [help][HELP]. |
| TOOLS / WATCH | [All mode helper sources/config/tests][TOOLS], [watcher CLI defaults/control flow][WATCH]. |
| STATE / SCODE | [Statechart skill][STATE], [all statechart implementation/help/tests][SCODE]. |
| V / VM / F / FM | [App generator][V], [app maintenance][VM], [formal generator][F], [formal maintenance][FM]. |
| B / H / CD | [Complete Benny pack][B], [Claude Code adapter][H], [live Cursor skills docs][CD]. |
| CI / DOCHECK | [Upstream validation workflow][CI], [upstream docs validator][DOCHECK]. |
| Other skill IDs | Linked directly from the complete non-principle inventory table above. |

[T]: https://api.github.com/repos/cursor/plugins/git/trees/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0?recursive=1
[M]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/.cursor-plugin/plugin.json
[R]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/README.md
[L]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/LICENSE
[SK]: https://github.com/cursor/plugins/tree/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills
[P]: https://github.com/cursor/plugins/tree/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills
[PB]: https://github.com/cursor/plugins/tree/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/poteto-mode/playbooks
[A]: https://github.com/cursor/plugins/tree/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/agents
[TOOLS]: https://github.com/cursor/plugins/tree/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/poteto-mode/scripts
[WATCH]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/poteto-mode/scripts/watch-pr/cli.ts
[SCODE]: https://github.com/cursor/plugins/tree/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/statechart/scripts
[B]: https://github.com/cursor/plugins/tree/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/automations/benny
[H]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/docs/harness/claude-code.md
[CD]: https://cursor.com/docs/skills
[CI]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/.github/workflows/validate-plugins.yml
[DOCHECK]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/scripts/check-pstack-docs.mjs
[MODE]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/poteto-mode/SKILL.md
[HELP]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/poteto-help/SKILL.md
[SETUP]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/setup-pstack/SKILL.md
[WORDS]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/in-your-own-words/SKILL.md
[SHARPEN]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/sharpen/SKILL.md
[HOW]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/how/SKILL.md
[WHY]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/why/SKILL.md
[TEACH]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/teach/SKILL.md
[RECALL]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/recall/SKILL.md
[KETCHUP]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/ketchup/SKILL.md
[VIDEO]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/ketchup-video/SKILL.md
[BLAST]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/blast-radius/SKILL.md
[ARCH]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/architect/SKILL.md
[ARENA]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/arena/SKILL.md
[SWARM]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/swarm/SKILL.md
[INTERROGATE]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/interrogate/SKILL.md
[TDD]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/tdd/SKILL.md
[BENCH]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/benchmark-checklist/SKILL.md
[COMMENTS]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/no-comments/SKILL.md
[TS]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/typescript-best-practices/SKILL.md
[UNSLOP]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/unslop/SKILL.md
[BRO]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/bro/SKILL.md
[WRITING]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/technical-writing/SKILL.md
[FIGURE]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/figure-it-out/SKILL.md
[TRAIL]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/show-me-your-work/SKILL.md
[V]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/create-verification-skill/SKILL.md
[VM]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/maintain-verification-skill/SKILL.md
[F]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/create-formal-verification-skill/SKILL.md
[FM]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/maintain-formal-verification-skill/SKILL.md
[STATE]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/statechart/SKILL.md
[ME]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/automate-me/SKILL.md
[REFLECT]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/reflect/SKILL.md
[CORRECT]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/correct/SKILL.md
[BOT]: https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/skills/make-bot-ui/SKILL.md

Additional provenance/related first-party retrievals:

- [Latest pstack-path commit API](https://api.github.com/repos/cursor/plugins/commits?path=pstack&per_page=1), [inspected commit](https://github.com/cursor/plugins/commit/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0).
- [Observed main commit](https://github.com/cursor/plugins/commit/9580c23696ac8d7abed0c166f2f9918800afb819), [its root Git tree](https://api.github.com/repos/cursor/plugins/git/trees/9580c23696ac8d7abed0c166f2f9918800afb819), [identical pstack subtree](https://api.github.com/repos/cursor/plugins/git/trees/880564357e051d7c7802da1cb5d8df1d0b008299).
- [Generic manifest](https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/pstack/plugin.json), [Cursor marketplace](https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/.cursor-plugin/marketplace.json), [Claude marketplace](https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/.claude-plugin/marketplace.json).
- [Harness generation source](https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/scripts/generate-pstack-harness-trees.mjs), [generated-tree README](https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/harness/pstack/README.md). Generator validates skill names/adapter vocabulary, copies selected sources, inserts adapter direction, rewrites links to excluded content, and `--check` detects generated drift; not an end-user lifecycle hook.
- [Cursor Team Kit README](https://github.com/cursor/plugins/blob/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/cursor-team-kit/README.md), confirming deslop/control-cli/control-ui are separate plugin skills.
- [Live Cursor Agent Skills documentation](https://cursor.com/docs/skills), retrieved October 24, 2026; not commit-pinned. Confirms explicit invocation flag, one-message versus Custom Mode persistence, skill discovery and built-ins. Personal sync is not the same as automation project availability; automation runs do not load synced personal skills.

## Local project comparison

Local audit date: October 24, 2026. This comparison describes the inspected working tree, including existing uncommitted work; it is not a claim that a tested release contains every code path. No application, provider, browser, upstream helper, install, lint, test, or build was run for this research. Sources below are local code/docs, not assumptions inferred from pstack.

### Bottom line

**Keep this app's runtime; adapt pstack's engineering workflows around it.** The existing app is a persistent, single-owner ticket executor with admission, dependency, process, budget, revision and human-review gates. pstack is primarily an explicitly invoked workflow library, plus helper tools and optional platform integrations. These are complementary layers, not interchangeable schedulers. A full copy would introduce unavailable Cursor tools and policy conflicts without independently establishing correctness. [MODE; PB; M; O1–O5]

There are two distinct adoption scopes:

1. **Developing omp-backlog-web:** commission its own verification skill, use scoped bug/feature/review recipes, maintain its feature map, and optionally model its risky lifecycle invariants.
2. **Projects managed by omp-backlog-web:** each target needs its own proven verification recipe and feature map. The host needs supported discovery, permission-aware invocation, retained run artifacts, review feedback and evidence provenance. One successful backlog-app recipe does not establish another app's setup, authentication or behavior. [V; VM; O1–O3; O6]

### Capability and gap matrix

| pstack capability | What this project has now | Gap / adoption decision |
| --- | --- | --- |
| Goal, done predicate and scope | Markdown ticket description, exact criteria, dependencies, approval-bound revision, immutable ticket/attachment snapshot. | Strong foundation. Add relevant verification recipe/feature references and explicit unverified boundaries; do not replace tickets with a second state system. [O2–O4] |
| Mode and task playbooks | One generic execution objective for every ticket; explicit `/skill:NAME` references instruct OMP to read installed skills. | No app-managed task router or selected playbook field. Start with a few OMP-compatible scoped recipes rather than mandatory 58-skill loading. Existing ticket body can carry explicit skill references. [MODE; PB; O2; O3; O6] |
| Persistent orchestration | SQLite state, filesystem reconciliation, global claim, repository fairness, dependencies, notifications, recovery. | Already provided by the app. pstack's orch helper stores coordination records but does not schedule agents. Do not add it as a competing authority or assume it improves current process ownership. [TOOLS; O2; O5] |
| Autonomous continuation | Native OMP goal mode configured for RPC; host time/token limits, cancellation, explicit retries. | Keep these. Native Cursor loop/wake contracts and indefinite watcher defaults are not portable substitutes. Preserve failed/blocked/inconclusive as non-success outcomes. [PB; WATCH; O2] |
| Application verification generator and recipe | Setup/dev commands, isolated-data guidance and deterministic tests; no checked-in SKILL.md or generated feature-map harness found during audit. | Commission a proven OMP-local recipe. Existing instructions and historical smoke notes are useful inputs, not an already registered reusable verification skill. [V; O1; O6; O8; O9] |
| Feature-map maintenance | README documents user paths; no checked-in maintained verification feature map. | Add source-plus-live drift checks with explicit invocation; commissioning one journey is not full maintenance coverage. Include board drag, Actions menu and ticket-panel equivalents as distinct affected entry points. [VM; O1; O7] |
| Real-artifact proof | Run has `transcript`, `changedFiles`, and `evidence: string[]`; UI renders text evidence and transcript. Tool names/errors are recorded, but successful tool results are not generally retained as structured proof. | Need run-owned artifact records, safe authenticated retrieval and criterion/feature links. Artifact existence alone does not verify semantics; distinguish observed records from authored claims. [TRAIL; V; O2; O3; O7] |
| Revision-bound evidence | `parseResult()` validates exact ticket revision, evidence uniqueness, criterion membership, text bounds and full coverage before complete. | Coverage is enforced; truth is not. Ticket revision hashes Markdown/attachments, not the entire product code or verification recipe. Record appropriate code/recipe/environment identity when capturing proof; meaningful changes require fresh relevant verification. [SWARM; PB; O2–O4] |
| Input attachments versus proof | Requirement attachments are hashed into revision; changes clear approval. Existing authenticated attachment routes serve those inputs. | Do not reuse requirement attachment uploads as run proof output: this changes the requirement revision. Add separately scoped proof storage and routes under private run ownership. [O3–O5] |
| Independent review | Human confirms current-revision evidence as Done; there is no first-class independent machine reviewer run/verdict in the inspected contracts. | Keep human acceptance. Add optional risk-scaled read-only review with exact reviewed work identity and retained findings; actual tool restrictions are needed, not a prompt promising read-only. No automatic multi-model fan-out or merge authority. [INTERROGATE; PB; O2; O3] |
| Corrective feedback | Request changes changes status to Ready and preserves revision approval; the action contract has no review-message field. Retry starts a fresh run; pause/resume preserves the same session. | Persist specific findings for the next authorized attempt. A fresh session should not silently lose the reason evidence was rejected. Reconcile existing edits before retry rather than bypass dirty-tree safety. [REFLECT; CORRECT; O2; O3] |
| Decision trail and catch-up | Per-run transcript, evidence, status and history; no structured decision trail, workspace chat search, or inherited-claim audit. | Useful later: concise decisions, outstanding human questions, evidence pointers and rejected approaches. Do not expose raw/private transcripts or add a duplicate status ledger; a TSV helper is not tamper-proof evidence. [TRAIL; RECALL; KETCHUP; O2; O7] |
| Bug/TDD/blast-radius workflow | Bun tests cover input/access/revision/runtime boundaries and process fixtures. Runtime prompt asks for investigation and observed checks. | Package same-surface failing-before/passing-after and affected-caller review into optional task recipes; retain fixtures as fixtures, not real-provider proof. No new test framework justified by pstack alone. [TDD; BLAST; PB; O2; O8; O9] |
| Performance/hillclimb workflow | No dedicated benchmark protocol or baseline/result entity in inspected contracts/scripts. | Add only for measured performance work: representative frozen workload, baseline, one hypothesis, actual work/error checks, repeated measurements, regression gate and explicit stop. Not required ceremony for every ticket. [BENCH; PB; O3; O8] |
| Formal verification/statechart | Deterministic lifecycle tests and documented lifecycle diagram; no TLA+/property-verifier tooling in app scripts/dependencies. | Optional targeted work for global-slot ownership, stop/recovery interleavings and revision acceptance invariants. Prove check sensitivity and code/model correspondence; approve tools/install first. Diagrams or model passes alone cannot replace real-code checks. [F; FM; STATE; O2; O8; O9] |
| Model-role setup and diverse delegates | One configurable model for new runs, or installed OMP default. No host role catalog, multi-reviewer budget ledger or cloud placement contract. | Adapt role mapping only when actual OMP delegation support, permission isolation and aggregate spend are established. Reasoning effort is not monetary limit; same-family fallback is not diversity. [SETUP; H; O2; O3] |
| Worktrees and branch ownership | Pre-existing Git changes block new work; agent prompt forbids commits, pushes, branch changes, deployments and destructive cleanup. No per-ticket worktree handoff. | Explicit policy decision required before stack/arena/autopilot/shipping adoption. Accepted changes can still leave the tree dirty and block the next ticket. Do not import cleanup/reset or automatic commit behavior. [PB; O1; O2] |
| PR watching, babysitting and shipping | No PR, forge, CI-watch or merge entity/API in inspected host contracts. Human Done is ticket acceptance, not merge/deploy. | Separate optional future integration with explicit external-write permissions and exact-head evidence. Green CI, watcher exit zero, Done and actual landing are different facts. [WATCH; PB; O3] |
| Benny/Slack/tracker/webhook automation | Authenticated local website, private-tailnet deployment guidance and no bundled Slack/tracker/webhook workflow. | Separate integration project, not part of initial parity. Needs secret management, trusted source coordinates, compensating writes, real adapter proof and isolated child capabilities. Do not import broad exposure/install defaults. [B; BOT; O1; O5] |
| Principle/type/comment/prose policies | Existing project conventions, strict TypeScript and ESLint scripts, boundary validation and security rules. | Reuse substantive compatible principles; enforce repeated objective mistakes in types/checks when warranted. Do not impose wholesale comment removal or rewrite architecture/style simply for upstream conformity. [P; COMMENTS; CORRECT; O4; O8] |

### Proposed adoption sequence

These are research recommendations, not a granted implementation order or expanded permissions. PLAN.md sections 10–11 remain planning-only.

1. **Commission proof:** create and execute this app's isolated verification recipe and starter feature map. Include safe empty-data owner setup, instance identity, real user actions, observed persistence, teardown and retained proof. Missing provider prerequisites block only the claimed real-provider tier, not unrelated UI verification.
2. **Make proof reviewable:** add private run-owned artifact/provenance support and review feedback. Require criterion/method/outcome/entry-point identity; preserve human acceptance. Version the recipe used and distinguish agent evidence from host observations. This is a host feature, not something copying a skill implements.
3. **Adapt a small daily-work core:** scoped investigation, bug fix, feature/refactoring, actual-surface verification, risk-scaled independent review and concise decision trail. Keep a single scheduler/goal owner, explicit budgets, no-progress exits and safe blocked shutdown. Discovery through `/skill:` is an existing entry point; mandatory runtime routing is a separate future feature.
4. **Close maintenance loop:** explicit feature-map maintenance, feedback delivery and targeted structural prevention of repeated mistakes. Extend to other registered repositories only after their own recipes are commissioned. Do not silently update requirements during an active immutable run.
5. **Add specialized methods on demand:** performance measurements, competing designs, formal checks and multi-model review only when task risk/uncertainty justifies their operational cost. Their tool/dependency requirements and verification boundaries need individual approval.
6. **Decide external autonomy separately:** worktree isolation, PR stacks/watchers/shipping, multiday programs and Benny require separate architecture/permission decisions. Do not equate desire for pstack workflows with authorization for automatic commits, external posts, merges, deploys or destructive cleanup.

### Suggested end-to-end target flow

```text
Project onboarding → proven project verification skill + feature map
    ↓
Draft ticket → scope/done predicate → exact-revision approval
    ↓
Existing scheduler admits one eligible ticket
    ↓
OMP reads selected task recipe + relevant verification map
    ↓
Inspect / reproduce → implement → drive affected real journeys
    └────────────── bounded fix/recheck on actionable failures
    ↓
Criterion evidence + run-owned proof + explicit unverified boundaries
    ↓
Optional authorized independent review → correction or findings
    ↓
backlog_result → actual settlement / child shutdown → Needs review
    ↓
Human accepts → Done; or records changes → safe authorized next attempt
```

Unavailable prerequisites, operator pause, budget exhaustion and no-progress stop are explicit non-success exits. Human Done releases dependency eligibility, not permission to commit/merge/deploy. Existing working-tree safety can still prevent another start until an approved handoff resolves it. [O1–O3]

### What the current plan covers and does not

Sections 10–11 already plan trustworthy verification, working-tree handoff, blocked-goal correction, progress, skill commissioning, feature-map maintenance, private run artifacts and review feedback. They do **not** yet implement any of those additions. Broader task playbooks, independent reviewer capabilities/model roles, decision trails, property verification and external automation remain staged candidates from this comparison—not promised pstack parity. The pinned inventory above provides a baseline for later component-by-component decisions. [O10]

### Local sources

- **O1:** [README.md](../README.md), Ticket workflow, Scheduling and recovery, Security boundaries, Verification commands. Existing browser/smoke descriptions are historical documentation, not checks rerun in this research.
- **O2:** [server/runtime.ts](../server/runtime.ts), `eligible()` (104–114), `parseResult()` (116–137), `stop()` (189–233), `settled()` (240–253), `onFrame()` (255–312), `launch()` (314–442), `cycle()` (497–557), `control()` and `answer()` (579 onward).
- **O3:** [server/contracts.ts](../server/contracts.ts), Repo/Ticket/Run/Settings/Runtime types; [server/api.ts](../server/api.ts), repository/settings endpoints (130–165), ticket/attachment routes (166–185), action/review routes (188–204).
- **O4:** [server/tickets.ts](../server/tickets.ts), `parseTicket()` (45–73), `readTicket()` revision hashing (101–118), reconciliation approval invalidation (138–163), `snapshotTicket()` (215 onward).
- **O5:** [server/store.ts](../server/store.ts), private storage and records/settings schema (24–65); [server/index.ts](../server/index.ts), strict loopback/Host/private-file configuration and coordinated shutdown.
- **O6:** [server/completions.ts](../server/completions.ts), `skillCompletions()` (103–153), OMP/Agent Dirs roots, metadata-only suggestions; local glob inspection found no checked-in `SKILL.md`. This does not establish absence of installed global skills or custom OMP configuration.
- **O7:** [src/Workspace.tsx](../src/Workspace.tsx), ticket review actions and `RunPanel()`; [src/TicketBoard.tsx](../src/TicketBoard.tsx), board confirmation/action paths. Existing uncommitted UI work was read and preserved.
- **O8:** [package.json](../package.json), setup/dev/lint/typecheck/test scripts and dependencies. No dedicated browser/benchmark/TLA+ package/script appears here; external installed tooling was not audited.
- **O9:** [server/runtime-integration.test.ts](../server/runtime-integration.test.ts), explicit protocol-fixture limit and lifecycle checks; [server/runtime.test.ts](../server/runtime.test.ts), admission and evidence-shape checks; [server/acceptance.test.ts](../server/acceptance.test.ts), input/revision/auth boundaries. Tests were inspected, not executed.
- **O10:** [PLAN.md](../PLAN.md), sections 10–11, planned not implemented; [prior OMP completion research](agent-completion-loop-research.md) and [prior Cursor verification research](cursor-verification-skill-research.md) provide additional source context.

No implementation or runtime verification is claimed. Research and the explicitly requested planning update preserve unrelated working-tree changes; no private project contents were uploaded to upstream services.
