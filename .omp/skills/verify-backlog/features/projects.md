# Projects and settings

Entry points: Home Add project; `/projects/new` folder picker; header Settings → Permitted folder roots; project Execution permission; Project settings popover; Home global pause.

Drive: pause all new starts. Set permitted roots to only the helper-created directory using Settings → Save settings. Add project, browse owned root and its `repository` child, then Register this directory. Expect project page, Execution = Paused and empty board. Reload and inspect authenticated state to confirm canonical path/mode. Starter helper keeps both pause gates and checks no runs exist.

Side effects: disposable settings root saved, exactly one canonical repository registered, private state outside repository source. No filesystem writes outside owned scratch and no scheduler execution.

Other checks when affected: root/symlink escape rejection; duplicate canonical directory rejection; project switch; automatic-mode confirmation cancellation; global pause must not stop an already running ticket. These are not starter-helper claims.

Operator handoff entry points: Home project warning; project Workspace handoff panel → Review originating run; Recheck workspace confirmation. Use `--handoff-fixture` for a disposable Git/browser/protocol scenario. Dirty output must persist a project gate without consuming subsequent tickets. Cancel preserves gate; dirty recheck must reject without changing file bytes. Simulate an operator preserving the synthetic output outside that owned repository; reload must still show gate. Explicit clean recheck releases only handoff, not global pause, requirements approval, dependencies or failed-ticket retry rules. Active/paused runs and stale gate IDs cannot be reconciled. No commits/resets/stashes/deletes granted.

Explicit operator commit entry point: Workspace handoff → Review & commit → per-file diff/mode/selection → message → Review commit → Confirm commit. Use `--commit-fixture` only with disposable-commit permission. Cover empty selection/message, keyboard operation, back/cancel/unsaved close, stale content, initial/selected commits, preserved unselected staged/unstaged work and persistent handoff after commit/reload. Recheck remains separate. Sensitive/unsupported files are disabled without exposing bytes; missing identity, external index locks, active/paused work, stale gate/review and concurrent Recheck must fail safely. Hooks/signing/filters do not run; no push/reset/stash or automatic agent commits. Inspect desktop/mobile in dark and Light. API/Git coverage: `server/workspace-commit.test.ts`.

Gotchas: default allowed root is `~/Development`; do not register a real directory merely to avoid changing disposable settings. Global pause lives on Home only. Non-Git scratch has no Git summary.
