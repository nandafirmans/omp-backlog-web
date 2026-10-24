# Requirements and approval

Entry points: project New ticket, Markdown and editable Preview, explicit import, ticket-panel Approve this revision, board Actions and drag confirmations, Board/List switch, direct ticket URL, outside file edits.

Drive starter: New ticket → fill CodeMirror Markdown with unique ID/title and Done when bullets → Create ticket. Inspect readable requirements, approve exact revision while project/global starts are paused. Edit Markdown, change observable criterion, Save revision. Expect Current revision not approved after save and reload. Read `.omp-backlog/tickets/T001/ticket.md` and authenticated state to confirm same saved bytes, changed revision, cleared approval and zero runs.

When affected, drive separately: Preview round-trip; imported Markdown; paste synthetic file with purpose label; attachment upload retry; stale-save conflict preserving draft; board Actions approve/retry/changes/Done and cancel; drag equivalents and keyboard movement. Do not infer these from ticket-panel approval. Verify original requirements/dependency gates after every alternate action.

Side effects: immutable requirement revision includes references; Markdown/attachment changes invalidate approval. Reorder does not change lifecycle status. Unsaved changes stay local until explicit save; leaving prompts.

Gotchas: unique frontmatter id/title/depends_on; exact criterion text matters. Uploading evidence as a requirement attachment changes revision. Removed/invalid or active work cannot be treated as arbitrary drag destinations.
