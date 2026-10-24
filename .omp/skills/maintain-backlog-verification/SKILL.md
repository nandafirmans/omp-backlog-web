---
name: maintain-backlog-verification
description: Explicitly reconcile Backlog verification feature maps against source and real application behavior without concealing product failures.
---

# Maintain Backlog Verification

Invoke explicitly; never turn a small ticket into an unsolicited full audit.

1. Read `../verify-backlog/SKILL.md`, `features/README.md` and all mapped entries. Inspect current README, routes, UI handlers, runtime gates and changed callers. List new/deleted entry points and stale instructions.
2. Use isolated Launch/Doctor, never real user data. Drive shared instance serially. Bound work to 15 minutes per attempt, two fixes per failing harness step; stop on missing prerequisites or no progress. No new installs, credentials, providers or execution permission implied.
3. Exercise every mapped feature and its required entry points for a full pass. Track pass/fail/blocked/not-run independently. Starter helper proves only its stated subset. Missing live-provider permission remains an explicit unverified boundary; do not claim full pass.
4. Classify failures: documentation drift → update recipe; harness gap → minimally fix and re-drive; product gap → preserve failure proof and report, do not change expected behavior to match bug. Product implementation needs its own authorized scope.
5. Update existing maps rather than duplicate ledgers. Keep stable user selectors, startup/setup, side effects, blockers and proof locations accurate. No model claim or final screenshot alone substitutes for observed actions and checked effects.
6. Retain sanitized proof and recipe/work identity, then clean up owned resources even on failure. Confirm artifacts survive. Summarize changed map entries, actual checks and unverified areas. Never grant Done or external-write permission.
