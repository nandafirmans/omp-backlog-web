# Requirements and approval

Entry points: project New ticket, optional Create with agent conversation and reviewed publication, Markdown and editable Preview, explicit import, ticket-panel Approve this revision, board Actions and drag confirmations, Board/List switch, direct ticket URL, outside file edits.

Drive starter: New ticket → fill CodeMirror Markdown with unique ID/title and Done when bullets → Create ticket. Inspect readable requirements, approve exact revision while project/global starts are paused. Edit Markdown, change observable criterion, Save revision. Expect Current revision not approved after save and reload. Read `.omp-backlog/tickets/T001/ticket.md` and authenticated state to confirm same saved bytes, changed revision, cleared approval and zero runs.

When affected, drive separately: Preview round-trip; imported Markdown; paste synthetic file with purpose label; attachment upload retry; stale-save conflict preserving draft; board Actions approve/retry/changes/Done and cancel; drag equivalents and keyboard movement. Do not infer these from ticket-panel approval. Verify original requirements/dependency gates after every alternate action.

Side effects: immutable requirement revision includes references; Markdown/attachment changes invalidate approval. Reorder does not change lifecycle status. Unsaved changes stay local until explicit save; leaving prompts.

Gotchas: unique frontmatter id/title/depends_on; exact criterion text matters. Uploading evidence as a requirement attachment changes revision. Removed/invalid or active work cannot be treated as arbitrary drag destinations.

## Optional agent-assisted creation

Keep manual creation/import independent: New ticket defaults to Manual Markdown and needs no OMP connection. For the assisted journey, connect explicitly, choose a discovered model and supported thinking level, and observe effective selections. If the isolated OMP default is unavailable, Send must stay disabled until an available model is selected; no silent fallback.

Drive file/skill completion in the prompt, including quoted paths with spaces. Add synthetic text/image references and an unsupported document. Check context: complete readable bytes are ready, unsupported/failed context blocks Send, and explicit reference-only exclusion preserves its final attachment. Test direct blocked-path requests separately from completion. Prior image history prevents switching to text-only in the same conversation.

Use an explicitly authorized real provider for clarification → follow-up → complete ticket proposal → Use draft. Verify unsaved-human-edit cancellation/confirmation, Markdown/Preview handoff and staged uploads. Before Create ticket, authenticated state and disk must show no new ticket/run. Test canceled final creation; in Automatic mode inspect the execution warning while global starts remain paused. Confirm full-payload creation and exact attachment hashes, not merely a success toast. Check manual creation independently.

Use the protocol child in `server/fixtures/drafting-child.ts` only for deterministic `FIXTURE:HOLD` cancellation and `FIXTURE:PROVIDER` sanitized-error UI checks; these are not provider runs. Preserve partial output and prompt, verify unsaved navigation cancellation, and stop owned children on discard/shutdown. Focused backend checks live in `server/drafting.test.ts`, `server/drafting-api.test.ts`, and `server/assisted-creation.test.ts`; they cover unsafe context, capabilities, payload/mode staleness, duplicate IDs, partial-upload admission and response-loss retries. Full-suite imports use explicit `ticketBoard.ts` to avoid Bun resolving the similarly named JSX module.

2026-10-24 commissioning: `/tmp/backlog-agent-smoke-PyWw4u/proof` retains published-ticket/mobile/Automatic-confirmation/cancellation/provider-fixture screenshots and final full-suite XML (70 passing tests, 628 assertions). Real drafting used `openai-codex/gpt-6.1-sol` at `low`; two live turns, three retained attachments, unsupported-PDF exclusion, zero implementation runs. Real OMP discovery sentinel control loaded outside the restricted profile and did not load inside it; the synthetic uncredentialed restricted profile failed metadata rather than invoking inference. Changed-file ESLint and strict TypeScript passed. No claim of full provider matrix, live ticket implementation, exhaustive feature coverage or OS sandboxing.
