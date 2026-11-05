# OMP Backlog project conventions

## Read first

- `README.md`: setup and operating instructions.
- `docs/current-agent-workflow.md`: implemented execution/review lifecycle and limitations.
- `PLAN.md`: scope, delivered work and remaining gates. Do not describe planned work as implemented.
- `docs/design-language.md`: required reference for frontend changes. Use the project board as the visual baseline; reuse existing Ant Design components, theme tokens, typography, control sizing and responsive patterns.

## UI consistency

- Preserve the shared full-width workspace, 24px bold page titles and square bordered surfaces. Use Ant Design's default control heights with the selected compact typography: 13px regular-weight control text. Route-action links match. Do not introduce page-specific display typography or a second component system.
- Keep manual ticket creation in its drawer and agent drafting on its separate Discuss / Review ticket page. Visual cleanup must preserve safety explanations, blocking feedback, keyboard access and unsaved-work protection.
- Verify affected surfaces at desktop and mobile widths in a dark theme and Light. Keep `docs/design-language.md` current when intentionally changing shared conventions.

## Tickets and verification skills

- Default ticket format: `id`, `title`, `depends_on` frontmatter; plain description and relevant constraints; `Done when:` with observable results and verification steps. Add sections only when needed.
- Keep project-specific verification skills in the target repository: `.omp/skills/<skill-name>/SKILL.md`, with its feature maps and helpers alongside it. Version them with that project's code; do not install them globally by default.
- Global skills are appropriate for reusable workflows, such as creating or maintaining project verification skills, not project-specific verification recipes.
- Distinguish creation paths from invocation: specify `.omp/skills/<skill-name>/SKILL.md` when asking to create a skill; use `/skill:<skill-name>` in later tickets to reference the discoverable skill. Do not assume the skill exists before commissioning it.
- This dashboard's verification recipe does not verify other registered projects. Commission and verify each target project's own recipe.

## Execution and acceptance

- Ticket creation, project initialization and skill mentions do not authorize execution. When asked to prepare only, do not install dependencies, launch apps, approve tickets, enable scheduling or run agents.
- Keep the existing scheduler and native OMP within-ticket continuation; do not add another loop or scheduler. One active ticket globally; paused work retains ownership.
- Approvals bind to exact requirement revisions; edits invalidate approval. Automatic mode grants standing execution permission, not exemption from safety or acceptance gates.
- Completion requires passing criterion reports with no unresolved submitted failed/blocked/not-run checks. Human-reviewed projects settle and stop before Needs review; a human accepts Done. Explicitly opted-in autonomous projects instead require exact-candidate host checks, fresh restricted nonauthor review, guarded local publication and stopped owned work before host Done. Dependencies require Done.
- Request changes requires durable feedback linked to the reviewed run/revision and passed to later authorized attempts. Ready does not bypass scheduling gates.
- Blocked work retains partial evidence and actionable unblock instructions; never falsely complete an unmet goal. Autonomous attempts permit only bounded same-session corrections and one commissioned incomplete-verification recovery; other blocked/failed/interrupted attempts require explicit retry, never automatic replay.

## Evidence and workspace safety

- `backlog_evidence` receipts remain agent claims. Autonomous host-command receipts attest the actual argv/exit/times and pinned candidate/recipe; independent reviews remain model judgments. Storage/artifact hashes alone do not establish execution or correctness. Keep all three provenance classes distinct.
- Store sanitized verification artifacts as private run proof, never requirement attachments that change the approved revision. Never include credentials or sessions.
- Human-reviewed and exceptional handoffs use operator-controlled reconciliation, preserving partial and unrelated edits. Explicit Review & commit selects reviewed working-tree versions and preserves unselected staging. Opted-in autonomous publication requires clean admission, exact authored-path/candidate matching, host verification and independent review; only the host may CAS-publish that tree. Both paths disable hooks/signing/push/reset/stash. Ticket agents still have no commit authority; no per-ticket worktree or shipping grant is implied.
- Dirty Git or unavailable inspection gates new starts for that project. Done, mode changes and merely becoming clean do not clear a recorded gate; explicit clean Recheck workspace is required, with no active/paused work owning that workspace. Other execution gates still apply.
- Outside explicit completion-policy publication or a separately confirmed operator commit, commits require separate authorization. Stash/reset/push/deploy/deletion remain unauthorized merely to advance the queue.
- Registered projects are not sandboxes: agent processes run with backend OS-user permissions. Skill references never grant credential access or permission to escape project scope.

## Verification and reporting

- Follow repository check policy: lint changed code when available; no build solely for verification unless requested. Add/update tests for behavior changes; run additional checks only as authorized.
- Use project-local verification guidance and drive affected entry points independently. Explicitly distinguish passed, blocked and unverified behavior; do not infer alternate journeys passed.
- Prefer disposable projects, synthetic data and owned-process cleanup for browser/protocol checks. Preserve proof after cleanup; never stop unrelated processes.
- Protocol-fixture success is not real OMP/provider verification. Never claim live-provider or exhaustive feature-map coverage without actually exercising it.
- Remaining adoption priorities: authorized live-provider lifecycle smoke, full feature-map maintenance, then opt-in onboarding with each project's commissioned recipe. Protocol success does not establish those gates; no wholesale pstack import or external shipping automation is implied.
