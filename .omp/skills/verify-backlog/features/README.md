# Backlog verification map

Starter map, not exhaustive coverage. Run only affected journeys; full maintenance must account for every mapped entry point and every unverified prerequisite.

| Feature | Map | Starter helper coverage |
| --- | --- | --- |
| Owner and session | [access.md](access.md) | Terminal setup, browser login, unauthenticated API rejection |
| Projects and settings | [projects.md](projects.md) | Global pause, isolated root, picker registration, paused project |
| Requirements and approval | [tickets.md](tickets.md) | Markdown create/save, approve, edit invalidation, reload, on-disk bytes |
| Run and human review | [runs.md](runs.md) | `--review-fixture`: receipts/download, canceled/confirmed feedback through panel, Actions, drag; not live provider |

## Commissioning receipts

- Starter browser journey passed: `/tmp/opencode/backlog-verify-SesLYC/proof/result.json`.
- Browser + protocol-fixture review paths passed: `/tmp/opencode/backlog-verify-OD97zf/proof/result.json` (ticket panel, Actions menu, drag confirmation independently; blank feedback disabled; cancel unchanged; confirmed feedback survives reload; authenticated artifact download).
- Final re-drive after progress integration: `/tmp/opencode/backlog-verify-DEpP6s/proof/result.json`; same review paths plus persisted stopped-child progress display passed. Focused deterministic suite: 14 tests passed; full-project ESLint passed. Strict typecheck/build/live-provider checks were not run.
- Operator reconciliation Git/browser/protocol-fixture run passed: `/tmp/opencode/backlog-verify-qanhuh/proof/result.json`. Independently exercised canceled/dirty/clean rechecks after each review entry point, preserved synthetic output, persisted gate after reload, and retained global pause. Focused deterministic suite: 15 tests passed. No commits, stashes or resets, even in fixtures.
- Final handoff re-drive with optional Git locks disabled passed: `/tmp/opencode/backlog-verify-Y3gG2B/proof/result.json`. Focused suite passed (15 tests, 153 assertions), including paused-slot refusal and unavailable inspection; changed-file ESLint and diff whitespace check passed.
- Both retained screenshots and receipts after owned-process cleanup. Earlier failed commissioning receipts remain private; selector and synchronization harness fixes were re-driven, not hidden by changing product expectations.

Receipts describe inspected work identity at time of execution, not a permanent guarantee for later patches. Full map, board approval/retry/Done, rich-editor behavior and real model/provider execution remain unverified. Temporary private proof paths may need operator archiving before machine cleanup; never copy private data wholesale into source.
